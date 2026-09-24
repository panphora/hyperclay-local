/**
 * C3 §5.9: the import of a migrated personal session's legacy metadata.
 *
 * The personal session C1's migration hands over has no account id and keeps
 * its baseline in the old `sync-meta/<legacyMetaDir>/` directory. Its first
 * start proves the session's identity through discovery, imports (copies and
 * converts) that baseline into `sync-meta/v2/<sessionId>/`, reconciles once with
 * `bootstrap: true`, and only then writes `identity.json` and switches the
 * session to the v2 directory. Offline it imports nothing. The legacy directory
 * is read, never written.
 *
 * The engine, the disk and the metadata are real (temp dirs); only the server
 * (api-client), the stream and the manager's settings store are fakes.
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
  refreshDerivedArtifacts: jest.fn(async () => ({}))
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

// Nothing here talks to a server for the clock.
jest.mock('../../src/sync-engine/utils', () => ({
  ...jest.requireActual('../../src/sync-engine/utils'),
  calibrateClock: jest.fn().mockResolvedValue(0)
}));

const os = require('os');
const path = require('upath');
const crypto = require('crypto');
const fsp = require('fs').promises;

const api = require('../../src/sync-engine/api-client');
const { SyncEngine } = require('../../src/sync-engine/index');
const { SyncManager } = require('../../src/main/sync-manager');
const { importLegacyMeta, IDENTITY_FILE } = require('../../src/sync-engine/reconcile/legacy-import');

const SESSION_ID = 'personal-session';
const ACCOUNT_ID = 42;
const ROOT_ID = 'personal-root';
const READY = { type: 'sync-ready', accountId: ACCOUNT_ID, sync: { enabled: true, reason: null } };
const SYNCED_AT = 1790000000000;

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

const BOARD = '<html><body>board</body></html>';
const NOTES = '<html><body>notes</body></html>';
const BOARD_SUM = checksum(BOARD);
const NOTES_SUM = checksum(NOTES);

const completeList = (nodes) => Object.assign([...nodes], { complete: true });

const site = ({ id, name, etag, size = 40 }) =>
  ({ id, type: 'site', name, parentId: null, path: '', size, etag, checksum: etag, modifiedAt: '2026-09-23T11:59:00.000Z' });
const upload = ({ id, name, etag, size = 12 }) =>
  ({ id, type: 'upload', name, parentId: null, path: '', size, etag, checksum: etag, modifiedAt: '2026-09-23T11:59:00.000Z' });

const remoteContent = (content, etag) => ({
  content,
  nodeType: 'site',
  modifiedAt: '2026-09-23T11:59:00.000Z',
  checksum: etag,
  etag
});

const LEGACY_BOARD = {
  type: 'site', path: 'board.html', parentId: null, inode: 77, checksum: BOARD_SUM, syncedAt: SYNCED_AT
};

function discovery(overrides = {}) {
  return {
    success: true,
    protocol: 2,
    actor: { id: 17, username: 'alex' },
    accounts: [{
      id: ACCOUNT_ID, kind: 'personal', username: 'alex', displayName: 'alex', role: 'owner',
      syncBase: '/_/sync', lifecycle: 'active', sync: { enabled: true, reason: null }
    }],
    ...overrides
  };
}

const dirs = [];
let manager = null;
let root = null;
let legacyDir = null;
let metaDir = null;
let engine = null;
let session = null;
let entry = null;

async function tmpDir(prefix) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

async function write(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
}

const readJson = async (file) => JSON.parse(await fsp.readFile(file, 'utf8'));
const exists = (file) => fsp.access(file).then(() => true, () => false);
const identityPath = () => path.join(metaDir, IDENTITY_FILE);

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for the session');
}

function fakeStream() {
  const stream = { options: null };
  stream.open = jest.fn((options) => { stream.options = options; });
  stream.close = jest.fn();
  stream.push = (data) => stream.options.onFrame({ data });
  return stream;
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.getAccounts.mockResolvedValue(discovery());
  api.listNodes.mockResolvedValue(completeList([]));
  api.getNodeContent.mockImplementation(async (conn, id) =>
    (id === 901 ? remoteContent(BOARD, BOARD_SUM) : remoteContent(NOTES, NOTES_SUM)));

  root = await tmpDir('legacy-root-');
  legacyDir = await tmpDir('legacy-meta-');
  metaDir = await tmpDir('legacy-v2-');
  engine = new SyncEngine();
  engine.sessionId = SESSION_ID;
  engine.accountId = null;
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.serverUrl = 'https://hyperclay.test';
  engine.apiKey = 'hcsk_test';
  engine.syncBase = '/_/sync';
  engine.protocol = 2;
  engine.deviceId = 'device-1';
  engine.isRunning = true;
  engine.live = { markBrowserSave: jest.fn(), broadcast: jest.fn(), notify: jest.fn() };
  engine.snapshots = { take: () => null };
  engine.startUnifiedWatcher = jest.fn();
  session = {
    id: SESSION_ID, rootId: ROOT_ID, accountId: null, kind: 'personal',
    cached: { username: 'alex' }, paused: null, legacyMetaDir: path.basename(legacyDir)
  };
  entry = { session, root: { id: ROOT_ID, kind: 'personal', path: root }, engine };
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (manager) await manager.stopAll();
  manager = null;
  for (const dir of dirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
  root = null;
  legacyDir = null;
  metaDir = null;
  engine = null;
  session = null;
  entry = null;
});

describe('importLegacyMeta', () => {
  it('imports the legacy map and keeps the legacy dir', async () => {
    const legacyState = { lastSyncedAt: SYNCED_AT, note: 'legacy' };
    const legacyMap = {
      901: LEGACY_BOARD,
      902: { type: 'upload', path: 'logo.png', parentId: null, inode: 78, syncedAt: SYNCED_AT },
      903: { type: 'site', path: 'gone.html', parentId: null, inode: 79, syncedAt: SYNCED_AT }
    };
    await write(path.join(legacyDir, 'node-map.json'), JSON.stringify(legacyMap, null, 2));
    await write(path.join(legacyDir, 'tombstones.json'), JSON.stringify({ 'old.html': SYNCED_AT }));
    await write(path.join(legacyDir, 'sync-state.json'), JSON.stringify(legacyState));
    await write(path.join(root, 'board.html'), BOARD);
    await write(path.join(root, 'logo.png'), 'mine');
    api.listNodes.mockResolvedValue(completeList([
      site({ id: 901, name: 'board.html', etag: BOARD_SUM }),
      upload({ id: 902, name: 'logo.png', etag: NOTES_SUM })
    ]));

    const pass = { bootstrap: null, lastSyncedAt: null };
    const realReconcile = engine.reconcileAll.bind(engine);
    jest.spyOn(engine, 'reconcileAll').mockImplementation(async (inventory, work) => {
      pass.bootstrap = work.bootstrap;
      pass.lastSyncedAt = engine.lastSyncedAt;
      return realReconcile(inventory, work);
    });

    const identityAtPersist = [];
    const persist = jest.fn(async () => {
      identityAtPersist.push(await exists(identityPath()));
    });

    const result = await importLegacyMeta(entry, { legacyDir, metaDir, persist, now: () => SYNCED_AT + 1000 });

    expect(result).toEqual({ ok: true, accountId: ACCOUNT_ID, actorId: 17, entries: 2 });
    expect(engine.accountId).toBe(ACCOUNT_ID);
    expect(engine.syncBase).toBe('/_/sync');

    // The converted baseline: 901 knew its checksum, 902 has none to know, so
    // its local file is matched by checksum and parked as unbound instead. 903
    // is absent from the disk and from the inventory, so the pass that knows
    // the legacy `lastSyncedAt` forgets it.
    const baseline = await readJson(path.join(metaDir, 'node-map.json'));
    expect(Object.keys(baseline).sort()).toEqual(['901', '902']);
    expect(baseline['901']).toEqual({
      type: 'site', path: 'board.html', parentId: null, inode: 77,
      remoteEtag: BOARD_SUM, localChecksum: BOARD_SUM, checksum: BOARD_SUM,
      structureVersion: null, syncedAt: SYNCED_AT
    });
    expect(baseline['902']).toMatchObject({ remoteEtag: null, localChecksum: null, structureVersion: null });

    // Tombstones and state came over, and the pass stamped the migration.
    expect(await readJson(path.join(metaDir, 'tombstones.json'))).toEqual({ 'old.html': SYNCED_AT });
    expect(await readJson(path.join(metaDir, 'sync-state.json'))).toEqual({
      lastSyncedAt: expect.any(Number),
      migratedAt: new Date(SYNCED_AT + 1000).toISOString()
    });

    // The legacy state reached the pass, and the pass deletes nothing.
    expect(pass).toEqual({ bootstrap: true, lastSyncedAt: SYNCED_AT });

    // Identity is written only once the baseline is on disk (5.9 step 5).
    expect(identityAtPersist).toEqual([true]);
    expect(await readJson(identityPath())).toEqual({
      serverUrl: 'https://hyperclay.test',
      actorId: 17,
      accountId: ACCOUNT_ID,
      rootId: ROOT_ID,
      rootRealpath: root
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, actorId: 17 });
    expect(engine.startUnifiedWatcher).toHaveBeenCalled();

    // Nothing on the server was written or deleted.
    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.createNode).not.toHaveBeenCalled();

    // The legacy directory still holds exactly what it held.
    expect((await fsp.readdir(legacyDir)).sort()).toEqual(['node-map.json', 'sync-state.json', 'tombstones.json']);
    expect(await readJson(path.join(legacyDir, 'node-map.json'))).toEqual(legacyMap);
    expect(await readJson(path.join(legacyDir, 'sync-state.json'))).toEqual(legacyState);
  });

  it('offline first start does no reconciliation', async () => {
    await write(path.join(legacyDir, 'node-map.json'), JSON.stringify({ 901: LEGACY_BOARD }));
    await write(path.join(root, 'board.html'), BOARD);
    api.getAccounts.mockRejectedValue(new Error('fetch failed'));

    await expect(importLegacyMeta(entry, { legacyDir, metaDir })).rejects.toThrow('fetch failed');

    // Identity was never proven: nothing was copied, listed or reconciled.
    expect(await exists(path.join(metaDir, 'node-map.json'))).toBe(false);
    expect(await exists(identityPath())).toBe(false);
    expect(api.listNodes).not.toHaveBeenCalled();
    expect(api.getNodeContent).not.toHaveBeenCalled();
    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(engine.repo.size).toBe(0);
    expect(engine.lastSyncedAt).toBeNull();
    expect(engine.startUnifiedWatcher).not.toHaveBeenCalled();
  });

  it('bootstrap pass never calls DELETE', async () => {
    // A baseline entry whose local file is gone and whose remote is unchanged:
    // a normal pass would delete it on the server.
    await write(path.join(legacyDir, 'node-map.json'), JSON.stringify({ 901: LEGACY_BOARD }));
    await write(path.join(legacyDir, 'sync-state.json'), JSON.stringify({ lastSyncedAt: SYNCED_AT }));
    api.listNodes.mockResolvedValue(completeList([site({ id: 901, name: 'board.html', etag: BOARD_SUM })]));

    const result = await importLegacyMeta(entry, { legacyDir, metaDir });

    expect(result.ok).toBe(true);
    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(api.getNodeContent).toHaveBeenCalledWith(expect.anything(), 901);
    await expect(fsp.readFile(path.join(root, 'board.html'), 'utf8')).resolves.toBe(BOARD);
    expect(await readJson(path.join(metaDir, 'node-map.json'))).toMatchObject({
      901: { remoteEtag: BOARD_SUM, localChecksum: BOARD_SUM }
    });
  });

  it('corrupt legacy map matches by checksum and marks the rest unbound', async () => {
    await write(path.join(legacyDir, 'node-map.json'), '{ this is not a map');
    await write(path.join(root, 'board.html'), BOARD);
    await write(path.join(root, 'notes.html'), 'mine');
    api.listNodes.mockResolvedValue(completeList([
      site({ id: 901, name: 'board.html', etag: BOARD_SUM }),
      site({ id: 902, name: 'notes.html', etag: NOTES_SUM })
    ]));

    const result = await importLegacyMeta(entry, { legacyDir, metaDir });

    expect(result.ok).toBe(true);

    // No baseline to load: the file the remote agrees with is adopted, the one
    // that differs has no baseline to say who is newer and is parked.
    const baseline = await readJson(path.join(metaDir, 'node-map.json'));
    expect(baseline['901']).toMatchObject({ remoteEtag: BOARD_SUM, localChecksum: BOARD_SUM });
    expect(baseline['902']).toBeUndefined();

    const records = await readJson(path.join(metaDir, 'conflicts.json'));
    expect(records['902']).toMatchObject({
      kind: 'unbound', path: 'notes.html', localChecksum: checksum('mine'), remoteEtag: NOTES_SUM
    });
    await expect(fsp.readFile(path.join(root, 'notes.html'), 'utf8')).resolves.toBe('mine');

    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(api.createNode).not.toHaveBeenCalled();
    expect(api.putNodeContent).not.toHaveBeenCalled();
  });
});

describe('the manager', () => {
  function makeManager({ userData, settings }) {
    const settingsStore = { get: () => settings, save: jest.fn() };
    const observer = {
      setRemoteApplyCheck: jest.fn(),
      subscribe: jest.fn(() => () => {}),
      start: jest.fn(),
      stop: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    };
    manager = new SyncManager({
      userData,
      deviceId: 'device-1',
      serverUrl: 'https://hyperclay.test',
      getApiKey: () => 'hcsk_test',
      settingsStore,
      observerFor: () => observer
    });
    return { manager, settingsStore };
  }

  it('a second start after a successful import does not import again', async () => {
    const userData = await tmpDir('legacy-userdata-');
    const folder = await tmpDir('legacy-launch-root-');
    const legacyName = '5f2b7c1d9e04';
    const legacy = path.join(userData, 'sync-meta', legacyName);
    const v2 = path.join(userData, 'sync-meta', 'v2', SESSION_ID);
    await write(path.join(legacy, 'node-map.json'), JSON.stringify({ 901: LEGACY_BOARD }));
    await write(path.join(legacy, 'sync-state.json'), JSON.stringify({ lastSyncedAt: SYNCED_AT }));
    await write(path.join(folder, 'board.html'), BOARD);
    api.listNodes.mockResolvedValue(completeList([site({ id: 901, name: 'board.html', etag: BOARD_SUM })]));

    const personal = {
      id: SESSION_ID, rootId: ROOT_ID, accountId: null, kind: 'personal',
      cached: { username: 'alex' }, paused: null, legacyMetaDir: legacyName
    };
    const personalRoot = { id: ROOT_ID, kind: 'personal', path: folder, port: 4321, trustedAt: null };
    const settings = { settingsVersion: 2, roots: [personalRoot], syncSessions: [personal] };
    const { manager, settingsStore } = makeManager({ userData, settings });
    const stream = fakeStream();
    jest.spyOn(SyncEngine.prototype, 'sessionStream').mockReturnValue(stream);

    await manager.start(personal, personalRoot, { syncBase: '/_/sync', protocol: 2 });
    const first = manager.sessions.get(SESSION_ID);
    // The session's first pass is the import, in the v2 directory, and it is
    // not identified until the import says so.
    expect(first.engine.legacyImport).toMatchObject({
      entry: expect.objectContaining({ session: personal }),
      options: { legacyDir: legacy, metaDir: v2 }
    });
    expect(personal.accountId).toBeNull();
    expect(personal.legacyMetaDir).toBe(legacyName);
    expect(first.engine.metaDir).toBe(v2);

    stream.push(READY);
    await waitFor(() => first.runner.state === 'live');

    expect(personal.accountId).toBe(ACCOUNT_ID);
    expect(personal.legacyMetaDir).toBeNull();
    expect(settingsStore.save).toHaveBeenCalled();
    expect(first.engine.legacyImport).toBeNull();
    expect(api.getAccounts).toHaveBeenCalledTimes(1);
    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(await readJson(path.join(v2, IDENTITY_FILE))).toMatchObject({ accountId: ACCOUNT_ID, rootId: ROOT_ID });
    await manager.stop(SESSION_ID);

    // A later launch: the session is identified, so it reconciles rather than
    // importing the legacy directory again.
    await write(path.join(legacy, 'node-map.json'), JSON.stringify({ 999: { path: 'ghost.html', checksum: 'ffff' } }));

    await manager.start(personal, personalRoot, { syncBase: '/_/sync', protocol: 2 });
    const second = manager.sessions.get(SESSION_ID);
    expect(second.engine.legacyImport).toBeUndefined();
    expect(second.engine.metaDir).toBe(v2);

    stream.push(READY);
    await waitFor(() => second.runner.state === 'live');

    expect(api.getAccounts).toHaveBeenCalledTimes(1);
    expect(Object.keys(await readJson(path.join(v2, 'node-map.json')))).toEqual(['901']);
    await manager.stop(SESSION_ID);
  });
});
