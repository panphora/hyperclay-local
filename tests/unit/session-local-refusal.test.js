// CONTRACTS §6-7: a missing root folder or an `identity.json` that names
// another server, actor, account, root or real path pauses the session before
// its first pass reads a baseline; nothing is recreated and nothing is deleted.
//
// The manager is built the way sync-manager.test.js builds one: a real engine
// per session against a mocked api, the disk of temp dirs, and a fake stream.

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

const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeMap = require('../../src/sync-engine/node-map');
const initialSync = require('../../src/sync-engine/engine-initial-sync');
const { SyncEngine } = require('../../src/sync-engine');
const { SessionRunner } = require('../../src/sync-engine/reconcile/session-runner');
const { createRootLive } = require('../../src/main/utils/root-live');
const { SyncManager } = require('../../src/main/sync-manager');

const TEAM_ACCOUNT_ID = 21;
const SERVER_URL = 'http://test';

const dirs = [];
let manager = null;
let settings = null;
let settingsStore = null;
let observers = null;
let userData = null;

function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function makeRoot(dir, kind = 'team') {
  return { id: 'root-team', kind, path: dir, port: 4322, trustedAt: null };
}

function teamSession(overrides = {}) {
  return {
    id: 'session-team', rootId: 'root-team', accountId: TEAM_ACCOUNT_ID, kind: 'team',
    cached: { username: 'acme', displayName: 'Acme', role: 'editor' }, paused: null, legacyMetaDir: null,
    ...overrides
  };
}

function teamAccount(overrides = {}) {
  return {
    id: TEAM_ACCOUNT_ID, kind: 'team', username: 'acme', displayName: 'Acme', role: 'editor',
    syncBase: '/_/team/acme/sync', lifecycle: 'active', sync: { enabled: true, reason: null },
    ...overrides
  };
}

const discovery = (accounts) => ({
  success: true, protocol: 2, features: {}, actor: { id: 17, username: 'alex' }, accounts
});

// A saved session comes from the settings store at launch; `persistPaused`
// finds it there before its entry exists, exactly as in `startEnabledSessions`.
function register(session, root) {
  settings.roots = [...settings.roots, root];
  settings.syncSessions = [...settings.syncSessions, session];
}

function writeIdentity(session, identity) {
  const dir = manager.metaDirFor(session);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(identity));
}

function matchingIdentity(session, root) {
  return {
    serverUrl: SERVER_URL,
    actorId: 17,
    accountId: session.accountId,
    rootId: root.id,
    rootRealpath: fs.realpathSync(root.path),
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  nodeMap.getInode.mockResolvedValue(1);
  nodeMap.load.mockResolvedValue(new Map());
  nodeMap.loadTombstones.mockResolvedValue(new Map());
  nodeMap.loadState.mockResolvedValue({});
  nodeMap.saveState.mockResolvedValue();
  initialSync.performInitialFolderSync.mockResolvedValue();
  initialSync.performInitialSync.mockResolvedValue();
  initialSync.performInitialUploadSync.mockResolvedValue();

  jest.spyOn(SyncEngine.prototype, 'sessionStream').mockImplementation(function () {
    return {
      open: jest.fn(),
      close: jest.fn(),
    };
  });

  userData = tmpDir('session-local-refusal-userdata-');
  settings = { syncEnabled: true, hasApiKey: true, actor: { id: 17, username: 'alex' }, roots: [], syncSessions: [] };
  settingsStore = { get: () => settings, save: jest.fn() };
  observers = new Map();
  manager = new SyncManager({
    userData,
    deviceId: 'device-1',
    serverUrl: SERVER_URL,
    getApiKey: () => 'hcsk_test',
    settingsStore,
    observerFor: (rootId) => {
      if (!observers.has(rootId)) {
        observers.set(rootId, {
          setRemoteApplyCheck: jest.fn(),
          subscribe: jest.fn(() => () => {}),
          start: jest.fn(),
          stop: jest.fn(),
          on: jest.fn(),
          off: jest.fn(),
          live: createRootLive(null)
        });
      }
      return observers.get(rootId);
    },
    takeSnapshot: jest.fn(() => null)
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (manager) await manager.stopAll();
  manager = null;
  settings = null;
  settingsStore = null;
  observers = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('localRefusal at start', () => {
  it('a session whose root folder is missing is persisted paused folder-missing and its folder is not created', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    fs.rmSync(root.path, { recursive: true, force: true });
    register(session, root);

    const result = await manager.start(session, root);

    expect(result.success).toBe(true);
    expect(session.paused.reason).toBe('folder-missing');
    expect(fs.existsSync(root.path)).toBe(false);
    expect(initialSync.performInitialFolderSync).not.toHaveBeenCalled();
  });

  it('a session whose identity.json names another account is persisted paused identity-mismatch', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    register(session, root);
    writeIdentity(session, { ...matchingIdentity(session, root), accountId: 999 });

    const result = await manager.start(session, root);

    expect(result.success).toBe(true);
    expect(session.paused.reason).toBe('identity-mismatch');
  });

  it('a session with a matching identity.json starts unpaused', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    register(session, root);
    writeIdentity(session, matchingIdentity(session, root));

    const result = await manager.start(session, root);

    expect(result.success).toBe(true);
    expect(session.paused).toBeNull();
  });

  it('a session with no identity.json starts unpaused', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    register(session, root);

    const result = await manager.start(session, root);

    expect(result.success).toBe(true);
    expect(session.paused).toBeNull();
  });

  it('a folder-missing pause clears on the next start that finds the folder', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    fs.rmSync(root.path, { recursive: true, force: true });
    register(session, root);

    await manager.start(session, root);
    expect(session.paused.reason).toBe('folder-missing');

    fs.mkdirSync(root.path, { recursive: true });
    await manager.stop(session.id);
    await manager.start(session, root);

    expect(session.paused).toBeNull();
  });

  it('onDiscovery never resumes identity-mismatch', async () => {
    const session = teamSession();
    const root = makeRoot(tmpDir('session-local-refusal-root-'));
    register(session, root);
    writeIdentity(session, { ...matchingIdentity(session, root), accountId: 999 });

    await manager.start(session, root);
    expect(session.paused.reason).toBe('identity-mismatch');

    const entry = manager.sessions.get(session.id);
    const resume = jest.spyOn(SessionRunner.prototype, 'resume');
    manager.onDiscovery(discovery([teamAccount()]));

    expect(entry.runner.state).toBe('paused');
    expect(resume).not.toHaveBeenCalled();
    expect(session.paused.reason).toBe('identity-mismatch');
  });
});
