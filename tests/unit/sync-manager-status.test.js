// C3 §5.6 and §5.8: the statuses the popover's cards read — syncing, conflict,
// paused, offline, error — and the discovery triggers that keep them honest.
// The fakes are the ones `sync-manager.test.js` builds: a real engine per
// session against a mocked api, a mocked EventSource, and one root.

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

function discovery() {
  return { success: true, protocol: 2, features: {}, actor: { id: 17, username: 'alex' }, accounts: [] };
}

const statusOf = (sessionId) => manager.statuses().find((status) => status.sessionId === sessionId);
const conflictsFile = () => path.join(userData, 'sync-meta', 'v2', sessionA.id, 'conflicts.json');

function writeConflicts(records) {
  const file = conflictsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records, null, 2));
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

  const dirA = tmpDir('sync-manager-status-a-');
  fs.writeFileSync(path.join(dirA, 'index.html'), '<html><body>a</body></html>');
  userData = tmpDir('sync-manager-status-userdata-');

  rootA = makeRoot('root-a', dirA);
  sessionA = makeSession('session-a', rootA.id, 11);

  observers = new Map();
  manager = new SyncManager({
    userData,
    deviceId: 'device-1',
    serverUrl: 'http://test',
    getApiKey: () => 'hcsk_test',
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

describe('SyncManager statuses', () => {
  it('status is syncing while reconciling and idle when live with an empty queue', async () => {
    let releaseList = null;
    apiClient.listNodes.mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));

    await manager.start(sessionA, rootA);
    const entry = manager.sessions.get(sessionA.id);
    expect(entry.runner.state).toBe('starting');
    expect(statusOf(sessionA.id).status).toBe('syncing');

    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => entry.runner.state === 'reconciling');
    expect(statusOf(sessionA.id).status).toBe('syncing');

    releaseList(completeList([]));
    await waitFor(() => entry.runner.state === 'live');
    expect(statusOf(sessionA.id).status).toBe('idle');
    expect(statusOf(sessionA.id).pendingCount).toBe(0);
  });

  it('an open conflict record makes status conflict and lists { path, kind }', async () => {
    writeConflicts({ 901: { kind: 'both-edited', path: 'board.html', detectedAt: 1 } });

    await manager.start(sessionA, rootA);
    expect(statusOf(sessionA.id).status).toBe('conflict');
    expect(statusOf(sessionA.id).conflicts).toEqual([{ path: 'board.html', kind: 'both-edited' }]);

    // The executor's own `file-synced { action: 'conflict' }` refreshes the cache
    // the cards read, so the second conflict shows up without a restart.
    writeConflicts({
      901: { kind: 'both-edited', path: 'board.html', detectedAt: 1 },
      902: { kind: 'rejected', path: 'notes.html', detectedAt: 2 }
    });
    manager.get(sessionA.id).emit('file-synced', { file: 'notes.html', action: 'conflict', kind: 'rejected' });

    await waitFor(() => statusOf(sessionA.id).conflicts.length === 2);
    expect(statusOf(sessionA.id).conflicts).toEqual([
      { path: 'board.html', kind: 'both-edited' },
      { path: 'notes.html', kind: 'rejected' }
    ]);
  });

  it('paused comes from settings and status is paused', async () => {
    await manager.start(sessionA, rootA);
    manager.sessions.get(sessionA.id).runner.pause('removed');

    expect(statusOf(sessionA.id).status).toBe('paused');
    expect(statusOf(sessionA.id).paused).toEqual({ reason: 'removed', since: expect.any(String) });
    expect(sessionA.paused).toEqual({ reason: 'removed', since: expect.any(String) });
  });

  it('lastError records the runner\'s classified error', async () => {
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.start(sessionA, rootA);
    const entry = manager.sessions.get(sessionA.id);
    eventsource.EventSource.mock.instances[0].onopen();
    await waitFor(() => entry.runner.state === 'live');
    expect(statusOf(sessionA.id).lastError).toBe(null);

    eventsource.EventSource.mock.instances[0]
      .onerror(Object.assign(new Error('precondition required'), { statusCode: 428 }));

    expect(statusOf(sessionA.id).status).toBe('error');
    expect(statusOf(sessionA.id).lastError).toBe('precondition required');
  });

  it('a runner state change announces itself so the popover can redraw', async () => {
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.start(sessionA, rootA);
    const states = [];
    manager.on('status-changed', (data) => states.push(data.state));

    manager.sessions.get(sessionA.id).runner.pause('removed');

    expect(states).toEqual(['paused']);
  });
});

describe('discovery triggers', () => {
  it('the discovery timer calls refreshAccounts every five minutes and stops', async () => {
    jest.useFakeTimers();
    try {
      apiClient.getAccounts.mockResolvedValue(discovery());

      manager.startDiscoveryTimer();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(2);

      manager.stopDiscoveryTimer();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshAccountsIfStale skips a refresh within 30 seconds', async () => {
    jest.useFakeTimers();
    try {
      apiClient.getAccounts.mockResolvedValue(discovery());

      await manager.refreshAccountsIfStale(30_000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(1);

      await manager.refreshAccountsIfStale(30_000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(1);

      jest.setSystemTime(Date.now() + 30_001);
      await manager.refreshAccountsIfStale(30_000);
      expect(apiClient.getAccounts).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
