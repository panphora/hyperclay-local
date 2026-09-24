// C6.1: the surface the round-trip driver waits on — `whenAllIdle` resolving
// once every session is at rest (idle, paused, or conflicted with nothing
// queued) and rejecting with the snapshot on timeout, and a `snapshot()` that
// carries no API key. The fakes are the ones `sync-manager-status.test.js`
// builds: a real engine per session against a mocked api, a mocked
// EventSource, and one root.

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
const apiClient = require('../../src/sync-engine/api-client');
const fileOps = require('../../src/sync-engine/file-operations');
const initialSync = require('../../src/sync-engine/engine-initial-sync');
const nodeMap = require('../../src/sync-engine/node-map');
const { createRootLive } = require('../../src/main/utils/root-live');
const { RootObserver } = require('../../src/main/root-observer');
const { SyncManager } = require('../../src/main/sync-manager');

const API_KEY = 'hcsk_test';

// A list the runner accepts as the whole inventory (protocol 2).
const completeList = (nodes) => Object.assign([...nodes], { complete: true });

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
let userData = null;
let rootA = null;
let sessionA = null;

function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function makeRoot(id, dir) {
  return { id, kind: 'team', path: dir, port: 5000, trustedAt: null };
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

// The account carries the key, among fields the snapshot must not carry.
function account() {
  return {
    id: 11,
    username: 'acme',
    displayName: 'Acme',
    kind: 'team',
    role: 'editor',
    syncBase: '/_/team/acme/sync',
    sync: { enabled: true, reason: null },
    apiKey: API_KEY
  };
}

function discovery(accounts = []) {
  return { success: true, protocol: 2, features: {}, actor: { id: 17, username: 'alex' }, accounts };
}

const statusOf = (sessionId) => manager.statuses().find((status) => status.sessionId === sessionId);

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

  const dirA = tmpDir('sync-manager-idle-a-');
  fs.writeFileSync(path.join(dirA, 'index.html'), '<html><body>a</body></html>');
  userData = tmpDir('sync-manager-idle-userdata-');

  rootA = makeRoot('root-a', dirA);
  sessionA = makeSession('session-a', rootA.id, 11);

  observers = new Map();
  manager = new SyncManager({
    userData,
    deviceId: 'device-1',
    serverUrl: 'http://test',
    getApiKey: () => API_KEY,
    settingsStore: {
      get: () => ({ syncEnabled: true, hasApiKey: true, roots: [rootA], syncSessions: [sessionA] }),
      save: jest.fn()
    },
    observerFor: (rootId) => {
      if (!observers.has(rootId)) {
        observers.set(rootId, new RootObserver(rootA, { live: createRootLive(rootA) }));
      }
      return observers.get(rootId);
    },
    takeSnapshot: jest.fn(() => ({ html: '<html></html>' }))
  });
});

afterEach(async () => {
  if (manager) {
    manager.stopDiscoveryTimer();
    await manager.stopAll();
  }
  for (const observer of observers.values()) await observer.stop();
  manager = null;
  observers = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('SyncManager whenAllIdle', () => {
  it('whenAllIdle resolves once every session is idle or paused', async () => {
    let releaseList = null;
    apiClient.listNodes.mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));

    await manager.start(sessionA, rootA);
    const entry = manager.sessions.get(sessionA.id);
    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => entry.runner.state === 'reconciling');

    let settled = false;
    const idle = manager.whenAllIdle({ timeoutMs: 10_000 }).then((snapshot) => { settled = true; return snapshot; });
    // Two poll intervals pass without the wait ending: reconciling is not rest.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(settled).toBe(false);
    expect(statusOf(sessionA.id).status).toBe('syncing');

    releaseList(completeList([]));
    await waitFor(() => entry.runner.state === 'live');
    const idleSnapshot = await idle;
    expect(idleSnapshot.sessions).toEqual([
      expect.objectContaining({ sessionId: sessionA.id, status: 'idle', pendingCount: 0 })
    ]);

    entry.runner.pause('removed');
    const pausedSnapshot = await manager.whenAllIdle({ timeoutMs: 5000 });
    expect(pausedSnapshot.sessions).toEqual([
      expect.objectContaining({ sessionId: sessionA.id, status: 'paused' })
    ]);
  });

  it('whenAllIdle rejects on timeout with the snapshot in the message', async () => {
    let releaseList = null;
    apiClient.listNodes.mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));

    await manager.start(sessionA, rootA);
    const entry = manager.sessions.get(sessionA.id);
    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => entry.runner.state === 'reconciling');

    let error = null;
    try {
      await manager.whenAllIdle({ timeoutMs: 300 });
    } catch (thrown) {
      error = thrown;
    }

    expect(error.message).toMatch(/^whenAllIdle timeout: \{/);
    const reported = JSON.parse(error.message.replace('whenAllIdle timeout: ', ''));
    expect(reported.sessions.find((status) => status.sessionId === sessionA.id).status).toBe('syncing');

    releaseList(completeList([]));
    await waitFor(() => entry.runner.state === 'live');
  });

  it('snapshot never contains the api key', async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([account()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.refreshAccounts();
    await manager.start(sessionA, rootA);
    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => manager.sessions.get(sessionA.id).runner.state === 'live');

    const snapshot = manager.snapshot();

    expect(JSON.stringify(snapshot)).not.toContain(API_KEY);
    expect(snapshot.discovery.accounts).toEqual([
      { id: 11, username: 'acme', kind: 'team', role: 'editor', sync: { enabled: true, reason: null } }
    ]);
    expect(snapshot.settings).toEqual({ roots: [rootA], syncSessions: [sessionA] });
    expect(snapshot.sessions.map((status) => status.sessionId)).toEqual([sessionA.id]);
  });
});
