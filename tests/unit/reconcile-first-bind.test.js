/**
 * C3 §5.8: the first bind of a team folder, and the team preview.
 *
 * A bind is the session's own first pass: the folder has to be empty (or hold
 * only the entries a Mac leaves behind), the volume has to have room, the
 * marker records the bind, every file goes through the executor's
 * adopt/download/conflict actions, and identity.json is written only after the
 * baseline. The manager's setupTeam and previewTeam are asserted on top of the
 * real bind.
 *
 * The engine, the disk and the metadata are real (temp dirs); only the server
 * (api-client), the stream and the manager's session start are fakes.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    notify: jest.fn(),
    broadcast: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  }
}));

jest.mock('eventsource', () => ({
  EventSource: jest.fn(function EventSource() {
    this.close = jest.fn();
  })
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn(async () => ({}))
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn(async () => {})
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  getAccounts: jest.fn(),
  listNodes: jest.fn(),
  getNodeContent: jest.fn(),
  putNodeContent: jest.fn(),
  createNode: jest.fn(),
  deleteNode: jest.fn()
}));

// The manager's start runs the real engine; nothing here talks to a server for
// the clock.
jest.mock('../../src/sync-engine/utils', () => ({
  ...jest.requireActual('../../src/sync-engine/utils'),
  calibrateClock: jest.fn().mockResolvedValue(0)
}));

// The manager's first bind is asserted; the bind itself is the real module.
jest.mock('../../src/sync-engine/reconcile/first-bind', () => ({
  ...jest.requireActual('../../src/sync-engine/reconcile/first-bind'),
  firstBind: jest.fn()
}));

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('upath');
const crypto = require('crypto');

const api = require('../../src/sync-engine/api-client');
const nodeMap = require('../../src/sync-engine/node-map');
const { SyncEngine } = require('../../src/sync-engine/index');
const { SyncManager } = require('../../src/main/sync-manager');
const bindModule = require('../../src/sync-engine/reconcile/first-bind');
const { firstBind, BIND_MARKER, IDENTITY_FILE } = jest.requireActual('../../src/sync-engine/reconcile/first-bind');

const SESSION_ID = 'session-a';
const ACCOUNT_ID = 42;
const ROOT_ID = 'root-a';
const READY = { type: 'sync-ready', accountId: ACCOUNT_ID, sync: { enabled: true, reason: null } };

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

const BOARD = '<html><body>board</body></html>';
const NOTES = '<html><body>notes</body></html>';
const BOARD_SUM = checksum(BOARD);
const NOTES_SUM = checksum(NOTES);

const completeList = (nodes) => Object.assign([...nodes], { complete: true });

const site = ({ id, name, etag, size = 40, parentId = null }) =>
  ({ id, type: 'site', name, parentId, path: '', size, etag, checksum: etag, modifiedAt: '2026-09-23T11:59:00.000Z' });
const upload = ({ id, name, etag, size, parentId = null }) =>
  ({ id, type: 'upload', name, parentId, path: '', size, etag, checksum: etag, modifiedAt: '2026-09-23T11:59:00.000Z' });
const folder = ({ id, name, parentId = null }) => ({ id, type: 'folder', name, parentId, path: '' });

function remoteContent(content, etag) {
  return {
    content,
    nodeType: typeof content === 'string' ? 'site' : 'upload',
    modifiedAt: '2026-09-23T11:59:00.000Z',
    checksum: etag,
    etag
  };
}

function discovery(overrides = {}) {
  return {
    success: true,
    protocol: 2,
    actor: { id: 17, username: 'alex' },
    accounts: [{
      id: ACCOUNT_ID, kind: 'team', username: 'acme', displayName: 'Acme', role: 'editor',
      syncBase: '/_/team/acme/sync', lifecycle: 'active', sync: { enabled: true, reason: null }
    }],
    ...overrides
  };
}

// The session's stream adapter (C3.6): `sync-ready` arrives once the open has
// landed, exactly like the adapter that synthesizes it for a legacy session.
function fakeStream({ ready = READY } = {}) {
  const stream = { options: null };
  stream.open = jest.fn((options) => {
    stream.options = options;
    if (ready) setImmediate(() => options.onFrame({ data: ready }));
  });
  stream.close = jest.fn();
  stream.push = (data) => stream.options.onFrame({ data });
  return stream;
}

const dirs = [];
let root = null;
let metaDir = null;
let engine = null;
let entry = null;

async function tmpDir(prefix) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for the bind');
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

const markerPath = () => path.join(metaDir, BIND_MARKER);
const identityPath = () => path.join(metaDir, IDENTITY_FILE);

async function writeMarker(marker) {
  await fsp.writeFile(markerPath(), JSON.stringify(marker, null, 2));
}

async function makeEntry() {
  root = await tmpDir('bind-root-');
  metaDir = await tmpDir('bind-meta-');
  engine = new SyncEngine();
  engine.sessionId = SESSION_ID;
  engine.accountId = ACCOUNT_ID;
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.serverUrl = 'https://hyperclay.test';
  engine.apiKey = 'hcsk_test';
  engine.syncBase = '/_/team/acme/sync';
  engine.protocol = 2;
  engine.deviceId = 'device-1';
  engine.isRunning = true;
  engine.live = { markBrowserSave: jest.fn(), broadcast: jest.fn() };
  engine.snapshots = { take: () => null };
  engine.stream = fakeStream();
  engine.startUnifiedWatcher = jest.fn();
  entry = { session: { id: SESSION_ID, rootId: ROOT_ID, accountId: ACCOUNT_ID, kind: 'team' }, root: { id: ROOT_ID, kind: 'team', path: root }, engine };
  return entry;
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.getAccounts.mockResolvedValue(discovery());
  api.listNodes.mockResolvedValue(completeList([]));
  api.getNodeContent.mockImplementation(async (conn, id) => (id === 901 ? remoteContent(BOARD, BOARD_SUM) : remoteContent(NOTES, NOTES_SUM)));
  await makeEntry();
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
  root = null;
  metaDir = null;
  engine = null;
  entry = null;
});

describe('firstBind', () => {
  it('refuses a folder that is not empty', async () => {
    await fsp.writeFile(path.join(root, 'notes.html'), 'mine');

    const result = await firstBind(entry);

    expect(result).toEqual({ ok: false, error: 'folder-not-empty', resumable: false });
    expect(engine.stream.open).not.toHaveBeenCalled();
    expect(api.listNodes).not.toHaveBeenCalled();
    expect(await exists(markerPath())).toBe(false);
  });

  it('ignores .DS_Store, Thumbs.db, desktop.ini and .hyperclay', async () => {
    await fsp.writeFile(path.join(root, '.DS_Store'), 'finder');
    await fsp.writeFile(path.join(root, 'Thumbs.db'), 'win');
    await fsp.writeFile(path.join(root, 'desktop.ini'), 'win');
    await fsp.mkdir(path.join(root, '.hyperclay', 'conflicts'), { recursive: true });

    const result = await firstBind(entry);

    expect(result).toEqual({ ok: true, files: 0, bytes: 0 });
    expect(await exists(identityPath())).toBe(true);
  });

  it('refuses when the volume has no room for the team', async () => {
    jest.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 4096 });
    api.listNodes.mockResolvedValue(completeList([
      upload({ id: 901, name: 'movie.bin', etag: BOARD_SUM, size: 4 * 1024 * 1024 })
    ]));

    const result = await firstBind(entry);

    expect(result).toEqual({ ok: false, error: 'disk-full', resumable: false });
    expect(await exists(markerPath())).toBe(false);
    expect(api.getNodeContent).not.toHaveBeenCalled();
  });

  it('emits progress per file and writes identity only after the baseline', async () => {
    const identityDuringBaseline = [];
    const realSave = nodeMap.save;
    jest.spyOn(nodeMap, 'save').mockImplementation(async (...args) => {
      identityDuringBaseline.push(await exists(identityPath()));
      return realSave.apply(nodeMap, args);
    });
    api.listNodes.mockResolvedValue(completeList([
      site({ id: 901, name: 'board.html', etag: BOARD_SUM, size: 30 }),
      upload({ id: 902, name: 'logo.png', etag: NOTES_SUM, size: 12 })
    ]));

    const progress = [];
    const result = await firstBind(entry, { onProgress: (item) => progress.push(item) });

    expect(result).toEqual({ ok: true, files: 2, bytes: 42 });
    // One report per file, four at a time, so the order of the two is not fixed.
    expect(progress).toHaveLength(2);
    expect(progress.map((item) => item.done).sort()).toEqual([1, 2]);
    expect(progress.every((item) =>
      item.sessionId === SESSION_ID && item.phase === 'download' && item.total === 2 && item.bytesTotal === 42)).toBe(true);
    expect(progress.find((item) => item.done === 1).bytesDone).toBeGreaterThan(0);
    expect(progress.find((item) => item.done === 2).bytesDone).toBe(42);

    // Every baseline write saw no identity.json yet: the baseline comes first.
    expect(identityDuringBaseline.length).toBeGreaterThan(0);
    expect(identityDuringBaseline.every((present) => present === false)).toBe(true);

    const baseline = JSON.parse(await fsp.readFile(path.join(metaDir, 'node-map.json'), 'utf8'));
    expect(Object.keys(baseline).sort()).toEqual(['901', '902']);
    expect(baseline['901']).toMatchObject({ path: 'board.html', remoteEtag: BOARD_SUM, localChecksum: BOARD_SUM });

    const identity = JSON.parse(await fsp.readFile(identityPath(), 'utf8'));
    expect(identity).toEqual({
      serverUrl: 'https://hyperclay.test',
      actorId: 17,
      accountId: ACCOUNT_ID,
      rootId: ROOT_ID,
      rootRealpath: root
    });
    expect(await exists(markerPath())).toBe(false);
    expect(engine.startUnifiedWatcher).toHaveBeenCalled();
    expect(engine.stream.close).toHaveBeenCalled();
  });

  it('resumes an interrupted bind by adopting matching files', async () => {
    await writeMarker({ accountId: ACCOUNT_ID, rootRealpath: root, startedAt: '2026-09-23T12:00:00.000Z' });
    await fsp.writeFile(path.join(root, 'board.html'), BOARD);
    await fsp.writeFile(path.join(root, 'notes.html'), 'mine');
    api.listNodes.mockResolvedValue(completeList([
      site({ id: 901, name: 'board.html', etag: BOARD_SUM }),
      site({ id: 902, name: 'notes.html', etag: NOTES_SUM })
    ]));

    const result = await firstBind(entry);

    expect(result).toEqual({ ok: true, files: 2, bytes: 80 });
    expect(api.getNodeContent).not.toHaveBeenCalledWith(expect.anything(), 901);
    expect(api.getNodeContent).toHaveBeenCalledWith(expect.anything(), 902);

    const baseline = JSON.parse(await fsp.readFile(path.join(metaDir, 'node-map.json'), 'utf8'));
    expect(baseline['901']).toMatchObject({ remoteEtag: BOARD_SUM, localChecksum: BOARD_SUM });

    const records = JSON.parse(await fsp.readFile(path.join(metaDir, 'conflicts.json'), 'utf8'));
    expect(records['902']).toMatchObject({ kind: 'unbound', path: 'notes.html', remoteEtag: NOTES_SUM });
    expect(await fsp.readFile(path.join(root, 'notes.html'), 'utf8')).toBe('mine');
  });

  it('downloads a file over local policy and marks it uploadBlocked', async () => {
    api.listNodes.mockResolvedValue(completeList([
      upload({ id: 902, name: 'movie.bin', etag: NOTES_SUM, size: 12 * 1024 * 1024 })
    ]));

    const result = await firstBind(entry);

    expect(result).toEqual({ ok: true, files: 1, bytes: 12 * 1024 * 1024 });
    expect(api.getNodeContent).toHaveBeenCalledWith(expect.anything(), 902);
    await expect(fsp.readFile(path.join(root, 'movie.bin'))).resolves.toEqual(Buffer.from(NOTES));
    expect(engine.repo.get('902')).toMatchObject({
      path: 'movie.bin',
      remoteEtag: NOTES_SUM,
      uploadBlocked: true
    });
  });
});

describe('the manager', () => {
  // The manager's own fake observer: a real one would watch a real folder.
  function fakeObserver() {
    return {
      setRemoteApplyCheck: jest.fn(),
      subscribe: jest.fn(() => () => {}),
      start: jest.fn(),
      stop: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    };
  }

  function makeManager({ userData = os.tmpdir(), observerFor = null } = {}) {
    const settings = { settingsVersion: 2, roots: [], syncSessions: [] };
    const settingsStore = { get: () => settings, save: jest.fn() };
    const manager = new SyncManager({
      userData,
      deviceId: 'device-1',
      serverUrl: 'https://hyperclay.test',
      getApiKey: () => 'hcsk_test',
      settingsStore,
      observerFor
    });
    return { manager, settings, settingsStore };
  }

  // C1's root helpers take their filesystem in an options object; the manager
  // offers the real ones by default and these for a test.
  const paths = {
    realPathOf: async (p) => p,
    home: '/home/test',
    exists: async () => false,
    isEmptyDir: async () => false,
    isFree: async () => true,
    random: () => 0
  };

  it('previews a team without creating anything', async () => {
    const { manager, settings } = makeManager();
    api.listNodes.mockResolvedValue(completeList([
      folder({ id: 900, name: 'assets' }),
      site({ id: 901, name: 'board.html', etag: BOARD_SUM, size: 30 }),
      upload({ id: 902, name: 'logo.png', etag: NOTES_SUM, size: 12 })
    ]));

    const result = await manager.previewTeam(ACCOUNT_ID);

    expect(result).toEqual({ ok: true, files: 2, bytes: 42 });
    expect(api.listNodes).toHaveBeenCalledWith(expect.objectContaining({
      syncBase: '/_/team/acme/sync', accountId: ACCOUNT_ID, protocol: 2, apiKey: 'hcsk_test'
    }));
    expect(api.getNodeContent).not.toHaveBeenCalled();
    expect(settings).toEqual({ settingsVersion: 2, roots: [], syncSessions: [] });
  });

  it('refuses to set up a team folder the user has not trusted', async () => {
    const { manager, settingsStore } = makeManager();

    const result = await manager.setupTeam({ accountId: ACCOUNT_ID, folder: '/home/test/hyperclay/acme' });

    expect(result).toEqual({ ok: false, error: 'untrusted' });
    expect(settingsStore.save).not.toHaveBeenCalled();
    expect(api.listNodes).not.toHaveBeenCalled();
  });

  it('creates the root and the session and then runs the first bind', async () => {
    const { manager, settings, settingsStore } = makeManager();
    const rootsChanged = jest.fn();
    manager.on('roots-changed', rootsChanged);
    const fakeEngine = { syncBase: null };
    jest.spyOn(manager, 'start').mockImplementation(async (session, root) => {
      manager.sessions.set(session.id, { session, root, engine: fakeEngine, runner: null });
      return { success: true };
    });
    jest.spyOn(manager, 'startRunner').mockReturnValue(null);
    bindModule.firstBind.mockResolvedValue({ ok: true, files: 3, bytes: 30 });

    const result = await manager.setupTeam({
      accountId: ACCOUNT_ID,
      folder: '/home/test/hyperclay/acme',
      trusted: true,
      ...paths
    });

    expect(result).toEqual({ ok: true, files: 3, bytes: 30 });
    expect(settings.roots).toHaveLength(1);
    expect(settings.roots[0]).toMatchObject({
      kind: 'team', path: '/home/test/hyperclay/acme', port: 5432, formerAccount: null
    });
    expect(settings.roots[0].trustedAt).toEqual(expect.any(String));
    expect(settings.syncSessions).toHaveLength(1);
    expect(settings.syncSessions[0]).toMatchObject({
      rootId: settings.roots[0].id,
      accountId: ACCOUNT_ID,
      kind: 'team',
      cached: { username: 'acme', displayName: 'Acme', role: 'editor' },
      paused: null,
      legacyMetaDir: null
    });
    expect(settingsStore.save).toHaveBeenCalled();
    expect(rootsChanged).toHaveBeenCalledWith({ roots: settings.roots });
    expect(manager.start).toHaveBeenCalledWith(settings.syncSessions[0], settings.roots[0],
      { syncBase: '/_/team/acme/sync', protocol: 2, firstBind: true });
    expect(bindModule.firstBind).toHaveBeenCalledWith(
      expect.objectContaining({ session: settings.syncSessions[0], root: settings.roots[0], engine: fakeEngine }),
      expect.objectContaining({
        account: expect.objectContaining({ id: ACCOUNT_ID }),
        actorId: 17,
        metaDir: path.join(manager.userData, 'sync-meta', 'v2', settings.syncSessions[0].id),
        onProgress: expect.any(Function)
      })
    );
    expect(manager.startRunner).toHaveBeenCalledTimes(1);
  });

  it('drops the root and the session when the bind refuses', async () => {
    const { manager, settings } = makeManager();
    const created = [];
    jest.spyOn(manager, 'start').mockImplementation(async (session, root) => {
      created.push(session);
      manager.sessions.set(session.id, { session, root, engine: {}, runner: null });
      return { success: true };
    });
    const stop = jest.spyOn(manager, 'stop').mockResolvedValue({ success: true });
    bindModule.firstBind.mockResolvedValue({ ok: false, error: 'folder-not-empty', resumable: false });

    const result = await manager.setupTeam({
      accountId: ACCOUNT_ID,
      folder: '/home/test/hyperclay/acme',
      trusted: true,
      ...paths
    });

    expect(result).toEqual({ ok: false, error: 'folder-not-empty', resumable: false });
    expect(stop).toHaveBeenCalledWith(created[0].id);
    expect(settings.roots).toEqual([]);
    expect(settings.syncSessions).toEqual([]);
  });

  it('keeps an interrupted bind so the next start can resume it', async () => {
    const { manager, settings } = makeManager();
    jest.spyOn(manager, 'start').mockImplementation(async (session, root) => {
      manager.sessions.set(session.id, { session, root, engine: {}, runner: null });
      return { success: true };
    });
    jest.spyOn(manager, 'stop').mockResolvedValue({ success: true });
    bindModule.firstBind.mockResolvedValue({ ok: false, error: 'offline', reason: 'fetch failed', resumable: true });

    const result = await manager.setupTeam({
      accountId: ACCOUNT_ID,
      folder: '/home/test/hyperclay/acme',
      trusted: true,
      ...paths
    });

    expect(result).toEqual({ ok: false, error: 'offline', reason: 'fetch failed', resumable: true });
    expect(settings.roots).toHaveLength(1);
    expect(settings.syncSessions).toHaveLength(1);
  });

  it('a saved session with bind-in-progress.json resumes the bind on start', async () => {
    const userData = await tmpDir('bind-userdata-');
    const folder = await tmpDir('bind-launch-root-');
    const sessionMetaDir = path.join(userData, 'sync-meta', 'v2', SESSION_ID);
    await fsp.mkdir(sessionMetaDir, { recursive: true });
    await fsp.writeFile(path.join(sessionMetaDir, BIND_MARKER), JSON.stringify({
      accountId: ACCOUNT_ID, rootRealpath: folder, startedAt: '2026-09-23T12:00:00.000Z'
    }));
    await fsp.writeFile(path.join(folder, 'board.html'), BOARD);
    expect(await exists(path.join(sessionMetaDir, IDENTITY_FILE))).toBe(false);
    api.listNodes.mockResolvedValue(completeList([
      site({ id: 901, name: 'board.html', etag: BOARD_SUM, size: 30 }),
      site({ id: 902, name: 'notes.html', etag: NOTES_SUM, size: 30 })
    ]));

    const session = {
      id: SESSION_ID, rootId: ROOT_ID, accountId: ACCOUNT_ID, kind: 'team',
      cached: { username: 'acme' }, paused: null, legacyMetaDir: null
    };
    const teamRoot = { id: ROOT_ID, kind: 'team', path: folder, port: 5432, trustedAt: null };
    const observer = fakeObserver();
    const { manager } = makeManager({ userData, observerFor: () => observer });
    jest.spyOn(SyncEngine.prototype, 'sessionStream').mockReturnValue(fakeStream());
    jest.spyOn(SyncEngine.prototype, 'startUnifiedWatcher').mockImplementation(() => {});
    // The module's firstBind is a spy for the bind tests; the resume runs the real one.
    bindModule.firstBind.mockImplementation(firstBind);

    try {
      const result = await manager.start(session, teamRoot, { syncBase: '/_/team/acme/sync', protocol: 2 });

      expect(result.success).toBe(true);
      expect(manager.sessions.get(SESSION_ID).engine.metaDir).toBe(sessionMetaDir);
      expect(bindModule.firstBind).toHaveBeenCalledWith(
        expect.objectContaining({ session, root: teamRoot }),
        expect.objectContaining({ metaDir: sessionMetaDir, onProgress: expect.any(Function) })
      );

      // The file already on disk carried the remote etag, so the bind adopted it
      // instead of downloading it again; only the missing file was fetched.
      const contentGets = (nodeId) =>
        api.getNodeContent.mock.calls.filter(([, id]) => id === nodeId).length;
      expect(contentGets(901)).toBe(0);
      expect(contentGets(902)).toBe(1);
      expect(await fsp.readFile(path.join(folder, 'board.html'), 'utf8')).toBe(BOARD);
      await expect(fsp.readFile(path.join(folder, 'notes.html'), 'utf8')).resolves.toBe(NOTES);

      expect(await exists(path.join(sessionMetaDir, IDENTITY_FILE))).toBe(true);
      expect(await exists(path.join(sessionMetaDir, BIND_MARKER))).toBe(false);
      expect(session.legacyMetaDir).toBeNull();
    } finally {
      // The engine leaves a timer and the session a stream open: both stop here.
      await manager.stop(SESSION_ID);
    }
  });
});
