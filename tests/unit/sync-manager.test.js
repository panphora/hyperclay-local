// C2.5: one SyncEngine per session behind one SyncManager. Two sessions on two
// roots must run side by side — each with its own connection base, logger,
// listeners and root observer — so stopping one leaves the other intact.

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

// One EventSource per session, opened by the session runner (C3.7): the mock
// carries the `close` every real one has, so a stop or a pause can close it.
jest.mock('eventsource', () => ({
  EventSource: jest.fn(function EventSource() {
    this.close = jest.fn();
  })
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn().mockResolvedValue(),
  createBinaryBackupIfExists: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../src/sync-engine/utils', () => ({
  ...jest.requireActual('../../src/sync-engine/utils'),
  calibrateClock: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/node-map');

jest.mock('../../src/sync-engine/engine-initial-sync', () => ({
  ...jest.requireActual('../../src/sync-engine/engine-initial-sync'),
  performInitialFolderSync: jest.fn(),
  performInitialSync: jest.fn(),
  performInitialUploadSync: jest.fn()
}));

jest.mock('../../src/sync-engine/engine-watcher', () => ({
  ...jest.requireActual('../../src/sync-engine/engine-watcher'),
  startUnifiedWatcher: jest.fn()
}));

jest.mock('../../src/sync-engine/engine-sse', () => ({
  ...jest.requireActual('../../src/sync-engine/engine-sse'),
  connectToStream: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const eventsource = require('eventsource');
const sse = require('../../src/sync-engine/engine-sse');
const { SessionRunner } = require('../../src/sync-engine/reconcile/session-runner');
const apiClient = require('../../src/sync-engine/api-client');
const fileOps = require('../../src/sync-engine/file-operations');
const engineUtils = require('../../src/sync-engine/utils');
const initialSync = require('../../src/sync-engine/engine-initial-sync');
const nodeMap = require('../../src/sync-engine/node-map');
const { createRootLive } = require('../../src/main/utils/root-live');
const { RootObserver } = require('../../src/main/root-observer');
const { SyncManager } = require('../../src/main/sync-manager');

const FORWARDED = ['sync-start', 'sync-complete', 'sync-error', 'file-synced', 'sync-stats',
  'backup-created', 'sync-retry', 'sync-failed'];

const PATH = 'photo.png';

// A list the runner accepts as the whole inventory (protocol 2).
const completeList = (nodes) => Object.assign([...nodes], { complete: true });
const MARKER = 'remote-checksum';

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for the manager');
}

const dirs = [];
let manager = null;
let observers = null;
let takeSnapshot = null;
let userData = null;
let rootA = null;
let rootB = null;
let rootC = null;
let sessionA = null;
let sessionB = null;
let sessionC = null;

function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function makeRoot(id, dir, kind = 'team') {
  return { id, kind, path: dir, port: 5000, trustedAt: null };
}

function makeSession(id, rootId, accountId = null) {
  return {
    id,
    rootId,
    accountId,
    kind: 'team',
    cached: { username: 'acme', displayName: 'acme', role: 'owner' },
    paused: null
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  fileOps.writeFile.mockResolvedValue();
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.fileExists.mockResolvedValue(false);
  fileOps.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  fileOps.readFileBuffer.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  fileOps.calculateBufferChecksum.mockReturnValue('local-checksum');

  nodeMap.getInode.mockResolvedValue(1);
  nodeMap.load.mockResolvedValue(new Map());
  nodeMap.loadTombstones.mockResolvedValue(new Map());
  nodeMap.loadState.mockResolvedValue({});
  nodeMap.saveState.mockResolvedValue();
  initialSync.performInitialFolderSync.mockResolvedValue();
  initialSync.performInitialSync.mockResolvedValue();
  initialSync.performInitialUploadSync.mockResolvedValue();

  const dirA = tmpDir('sync-manager-a-');
  const dirB = tmpDir('sync-manager-b-');
  const dirC = tmpDir('sync-manager-c-');
  fs.writeFileSync(path.join(dirA, 'index.html'), '<html><body>a</body></html>');
  fs.writeFileSync(path.join(dirB, 'index.html'), '<html><body>b</body></html>');
  userData = tmpDir('sync-manager-userdata-');

  rootA = makeRoot('root-a', dirA);
  rootB = makeRoot('root-b', dirB);
  rootC = makeRoot('root-c', dirC);
  sessionA = makeSession('session-a', rootA.id, 11);
  sessionB = makeSession('session-b', rootB.id, 22);
  sessionC = makeSession('session-c', rootC.id, 33);

  observers = new Map();
  takeSnapshot = jest.fn((rel) => ({ html: `<html>${rel}</html>` }));
  manager = new SyncManager({
    userData,
    deviceId: 'device-1',
    serverUrl: 'http://test',
    getApiKey: () => 'hcsk_test',
    settingsStore: { get: () => ({ roots: [rootA, rootB, rootC], syncSessions: [] }), save: jest.fn() },
    observerFor: (rootId) => {
      if (!observers.has(rootId)) {
        const root = [rootA, rootB, rootC].find((r) => r.id === rootId);
        observers.set(rootId, new RootObserver(root, { live: createRootLive(root) }));
      }
      return observers.get(rootId);
    },
    takeSnapshot
  });
});

afterEach(async () => {
  if (manager) await manager.stopAll();
  for (const observer of observers.values()) await observer.stop();
  manager = null;
  observers = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('SyncManager sessions', () => {
  it('runs one engine per root and tags every forwarded event with its own ids', async () => {
    await manager.start(sessionA, rootA);
    await manager.start(sessionB, rootB, { syncBase: '/_/team/acme/sync' });

    expect(manager.get(sessionA.id)).not.toBe(manager.get(sessionB.id));
    expect(manager.forRoot(rootA.id)).toBe(manager.get(sessionA.id));
    expect(manager.forRoot(rootB.id)).toBe(manager.get(sessionB.id));
    expect(manager.statuses().filter((status) => status.running)).toHaveLength(2);

    const forwarded = [];
    for (const name of FORWARDED) manager.on(name, (data) => forwarded.push({ name, ...data }));

    for (const name of FORWARDED) manager.get(sessionA.id).emit(name, { marker: name });

    expect(forwarded.map((event) => [event.name, event.sessionId, event.rootId, event.accountId, event.marker]))
      .toEqual(FORWARDED.map((name) => [name, sessionA.id, rootA.id, 11, name]));

    manager.get(sessionA.id).snapshots.take('index.html');
    expect(takeSnapshot).toHaveBeenCalledWith('index.html', rootA.id);
  });

  it('reads a distinct connection base per session', async () => {
    await manager.start(sessionA, rootA);
    await manager.start(sessionB, rootB, { syncBase: '/_/team/acme/sync' });

    expect(engineUtils.calibrateClock.mock.calls.map(([conn]) => conn.syncBase))
      .toEqual(['/_/sync', '/_/team/acme/sync']);
    expect(engineUtils.calibrateClock.mock.calls[1][0]).toMatchObject({
      syncBase: '/_/team/acme/sync', protocol: 1, accountId: 22, apiKey: 'hcsk_test'
    });
    expect(manager.get(sessionA.id).metaDir).toBe(path.join(userData, 'sync-meta', 'v2', sessionA.id));
    expect(manager.get(sessionB.id).metaDir).toBe(path.join(userData, 'sync-meta', 'v2', sessionB.id));
  });

  it('stops one session without touching the other session or its root observer', async () => {
    await manager.start(sessionA, rootA);
    await manager.start(sessionB, rootB, { syncBase: '/_/team/acme/sync' });

    const engineA = manager.get(sessionA.id);
    const engineB = manager.get(sessionB.id);
    const observerA = observers.get(rootA.id);
    const observerB = observers.get(rootB.id);
    const releaseA = jest.spyOn(observerA, 'setRemoteApplyCheck');
    const releaseB = jest.spyOn(observerB, 'setRemoteApplyCheck');
    const forwarded = [];
    manager.on('sync-stats', (data) => forwarded.push(data));

    await manager.stop(sessionA.id);

    expect(manager.get(sessionA.id)).toBeNull();
    expect(engineA.isRunning).toBe(false);
    expect(engineA.apiKey).toBeNull();
    expect(engineA.listenerCount('sync-stats')).toBe(0);
    expect(releaseA).toHaveBeenCalledWith(null);

    expect(manager.get(sessionB.id)).toBe(engineB);
    expect(engineB.isRunning).toBe(true);
    expect(engineB.apiKey).toBe('hcsk_test');
    expect(engineB.listenerCount('sync-stats')).toBe(1);
    expect(releaseB).not.toHaveBeenCalledWith(null);
    expect(observerB.isRemoteApply).toEqual(expect.any(Function));

    engineB.emit('sync-stats', { filesUploaded: 3 });
    expect(forwarded).toEqual([{ filesUploaded: 3, sessionId: sessionB.id, rootId: rootB.id, accountId: 22 }]);
  });

  it('holds a third start until one of two running initial syncs finishes', async () => {
    const pendings = [];
    let held = 0;
    initialSync.performInitialFolderSync.mockImplementation(() => {
      held += 1;
      return held <= 2 ? new Promise((resolve) => pendings.push(resolve)) : Promise.resolve();
    });

    const a = manager.start(sessionA, rootA);
    const b = manager.start(sessionB, rootB, { syncBase: '/_/team/acme/sync' });
    await waitFor(() => initialSync.performInitialFolderSync.mock.calls.length === 2);

    const c = manager.start(sessionC, rootC);
    await waitFor(() => manager.initialWaiters.length === 1);
    expect(initialSync.performInitialFolderSync).toHaveBeenCalledTimes(2);

    pendings.shift()();
    pendings.shift()();
    await Promise.all([a, b, c]);

    expect(initialSync.performInitialFolderSync).toHaveBeenCalledTimes(3);
    expect(manager.statuses().filter((status) => status.running)).toHaveLength(3);
  });

  it('writes nothing when a remote upload lands after the session stopped', async () => {
    await manager.start(sessionA, rootA);

    const engineA = manager.get(sessionA.id);
    const synced = jest.fn();
    manager.on('file-synced', synced);

    let resolveContent = null;
    apiClient.getNodeContent.mockImplementation(() => new Promise((resolve) => { resolveContent = resolve; }));

    const pending = engineA.handleNodeSaved({
      nodeId: 42,
      nodeType: 'upload',
      name: PATH,
      path: PATH,
      checksum: MARKER,
      modifiedAt: '2026-04-08T12:00:00Z'
    });

    await waitFor(() => apiClient.getNodeContent.mock.calls.length === 1);

    await manager.stop(sessionA.id);

    resolveContent({ content: Buffer.from([1, 2, 3]), modifiedAt: '2026-04-08T12:00:00Z', checksum: MARKER });
    await pending;
    await flush();

    expect(fileOps.writeFileBuffer).not.toHaveBeenCalled();
    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(engineA.repo.has(42)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
  });

  it('constructs and starts one session runner per session (C3.7)', async () => {
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.start(sessionA, rootA);
    await manager.start(sessionB, rootB, { syncBase: '/_/team/acme/sync' });

    const a = manager.sessions.get(sessionA.id);
    const b = manager.sessions.get(sessionB.id);
    expect(a.runner).toBeInstanceOf(SessionRunner);
    expect(b.runner).toBeInstanceOf(SessionRunner);
    expect(a.runner).not.toBe(b.runner);
    expect(manager.get(sessionA.id).runner).toBe(a.runner);
    expect(manager.get(sessionB.id).runner).toBe(b.runner);
    expect(a.runner.state).toBe('starting');

    // The stream hands this session's runner its `sync-ready`; the runner then
    // lists the inventory itself and reaches `live`.
    eventsource.EventSource.mock.instances[0].onopen();
    eventsource.EventSource.mock.instances[1].onopen();
    await waitFor(() => a.runner.state === 'live' && b.runner.state === 'live');

    expect(apiClient.listNodes).toHaveBeenCalledTimes(2);
    expect(initialSync.performInitialFolderSync).toHaveBeenCalled();
    // The runner owns the session's stream, so the legacy transport never opens one.
    expect(sse.connectToStream).not.toHaveBeenCalled();
    expect(manager.get(sessionA.id).sseConnection).toBe(eventsource.EventSource.mock.instances[0]);
  });

  it('stops the session runner with its session (C3.7)', async () => {
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.start(sessionA, rootA);
    const entry = manager.sessions.get(sessionA.id);
    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => entry.runner.state === 'live');

    await manager.stop(sessionA.id);

    expect(entry.runner.state).toBe('stopped');
    expect(entry.engine.runner).toBeNull();
    expect(entry.engine.isRunning).toBe(false);
  });
});
