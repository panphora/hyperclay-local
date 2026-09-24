// C3.11: `startEnabledSessions` starts the personal session and every team
// session — at launch and whenever sync is switched on — under protocol 2, with
// the `syncBase` discovery names. A session discovery refuses still gets its
// entry, paused, so `onDiscovery` can start it once discovery allows it.
//
// The fakes are the ones `sync-manager.test.js` and `sync-manager-status.test.js`
// build: a real engine per session against a mocked api, the disk of temp dirs,
// and a fake stream (open/close with onFrame/onError) instead of a socket.

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
const apiClient = require('../../src/sync-engine/api-client');
const fileOps = require('../../src/sync-engine/file-operations');
const engineUtils = require('../../src/sync-engine/utils');
const initialSync = require('../../src/sync-engine/engine-initial-sync');
const nodeMap = require('../../src/sync-engine/node-map');
const { SyncEngine } = require('../../src/sync-engine');
const { createRootLive } = require('../../src/main/utils/root-live');
const { SyncManager } = require('../../src/main/sync-manager');

const PERSONAL_ACCOUNT_ID = 7;
const TEAM_ACCOUNT_ID = 21;
const READY = { type: 'sync-ready', accountId: TEAM_ACCOUNT_ID, sync: { enabled: true, reason: null } };

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
let settings = null;
let settingsStore = null;
let streams = null;
let observers = null;
let userData = null;
let personalRoot = null;
let teamRoot = null;
let personal = null;
let team = null;

function tmpDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

// The fake stream records the account id the engine's connection carried at the
// moment the stream opened: that is the `X-Sync-Account-ID` the connect sends.
function makeStream(engine) {
  const stream = {
    open: jest.fn((options) => {
      stream.options = options;
      stream.accountIdAtOpen = engine.conn.accountId;
    }),
    close: jest.fn(),
    push(data) { stream.options.onFrame({ data }); }
  };
  return stream;
}

function personalAccount(overrides = {}) {
  return {
    id: PERSONAL_ACCOUNT_ID, kind: 'personal', username: 'alex', displayName: 'alex', role: 'owner',
    syncBase: '/_/sync', lifecycle: 'active', sync: { enabled: true, reason: null },
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

const FEATURES_ON = {
  accountScopes: true,
  accountEvents: true,
  conditionalContent: true,
  conditionalStructure: true,
  completeInventory: true
};

function discovery(accounts, overrides = {}) {
  return {
    success: true, protocol: 2, features: FEATURES_ON, actor: { id: 17, username: 'alex' }, accounts, ...overrides
  };
}

// The connection every session was initialized on: what `calibrateClock` saw.
const connections = () => engineUtils.calibrateClock.mock.calls.map(([conn]) =>
  [conn.protocol, conn.syncBase, conn.accountId]);

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

  // One fake stream per engine: the runner opens it, a test pushes its frames.
  streams = [];
  jest.spyOn(SyncEngine.prototype, 'sessionStream').mockImplementation(function () {
    const stream = makeStream(this);
    streams.push(stream);
    return stream;
  });

  userData = tmpDir('sync-manager-launch-userdata-');
  personalRoot = {
    id: 'root-personal', kind: 'personal', path: tmpDir('sync-manager-launch-personal-'),
    port: 4321, trustedAt: null
  };
  teamRoot = {
    id: 'root-team', kind: 'team', path: tmpDir('sync-manager-launch-team-'),
    port: 4322, trustedAt: null
  };
  personal = {
    id: 'session-personal', rootId: personalRoot.id, accountId: PERSONAL_ACCOUNT_ID, kind: 'personal',
    cached: { username: 'alex', displayName: 'alex', role: 'owner' }, paused: null, legacyMetaDir: null
  };
  team = {
    id: 'session-team', rootId: teamRoot.id, accountId: TEAM_ACCOUNT_ID, kind: 'team',
    cached: { username: 'acme', displayName: 'Acme', role: 'editor' }, paused: null, legacyMetaDir: null
  };

  settings = { syncEnabled: true, hasApiKey: true, roots: [personalRoot, teamRoot], syncSessions: [personal, team] };
  settingsStore = { get: () => settings, save: jest.fn() };
  observers = new Map();
  manager = new SyncManager({
    userData,
    deviceId: 'device-1',
    serverUrl: 'http://test',
    getApiKey: () => 'hcsk_test',
    settingsStore,
    observerFor: (rootId) => {
      if (!observers.has(rootId)) {
        const root = [personalRoot, teamRoot].find((r) => r.id === rootId);
        observers.set(rootId, {
          setRemoteApplyCheck: jest.fn(),
          subscribe: jest.fn(() => () => {}),
          start: jest.fn(),
          stop: jest.fn(),
          on: jest.fn(),
          off: jest.fn(),
          live: createRootLive(root)
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
  streams = null;
  observers = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const streamFor = (sessionId) => manager.sessions.get(sessionId).runner.stream;

// A local edit as the folder observer delivers it: the change the watcher
// dispatches for a file the user saved. The app's subscription is what calls
// this; the tests drive it directly because the subscription is faked here.
async function localEdit(engine, rel) {
  engine._dispatchRaw('change', rel);
  await new Promise((resolve) => setImmediate(resolve));
}

// Same drain, under the fake timers the backoff test runs on.
const flush = () => jest.advanceTimersByTimeAsync(0);

describe('SyncManager.startEnabledSessions', () => {
  it("starts the personal and every team session under protocol 2 with discovery’s syncBase", async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));

    const statuses = await manager.startEnabledSessions();

    expect(statuses.map((status) => status.sessionId)).toEqual([personal.id, team.id]);
    expect(connections()).toEqual([
      [2, '/_/sync', PERSONAL_ACCOUNT_ID],
      [2, '/_/team/acme/sync', TEAM_ACCOUNT_ID]
    ]);

    // Every session reconciles against the protocol 2 inventory its own runner
    // lists: the personal session is no longer on the legacy transport.
    apiClient.listNodes.mockResolvedValue(completeList([]));
    for (const session of [personal, team]) streamFor(session.id).push(READY);
    await waitFor(() => manager.statuses().every((status) => status.status === 'idle'));

    expect(apiClient.listNodes.mock.calls.map(([conn]) => [conn.protocol, conn.syncBase])).toEqual([
      [2, '/_/sync'],
      [2, '/_/team/acme/sync']
    ]);
    expect(manager.statuses().every((status) => status.running)).toBe(true);
    expect(streams).toHaveLength(2);
  });

  it("a legacy personal session (accountId null) starts with the personal account’s syncBase", async () => {
    personal.accountId = null;
    personal.legacyMetaDir = 'legacy-personal';
    settings.syncSessions = [personal];
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));

    const statuses = await manager.startEnabledSessions();

    // It has no account id: discovery's personal account is what it is matched
    // by, so it syncs rather than pausing unavailable.
    expect(statuses.map((status) => status.sessionId)).toEqual([personal.id]);
    expect(personal.paused).toBeNull();
    expect(statuses[0].status).not.toBe('paused');
    expect(connections()).toEqual([[2, '/_/sync', PERSONAL_ACCOUNT_ID]]);
    expect(manager.sessions.get(personal.id).engine.syncBase).toBe('/_/sync');
  });

  it('a migrated personal session opens its protocol 2 stream with the personal account id from discovery', async () => {
    personal.accountId = null;
    personal.legacyMetaDir = 'legacy-personal';
    settings.syncSessions = [personal];
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.startEnabledSessions();
    const entry = manager.sessions.get(personal.id);
    const stream = streamFor(personal.id);
    await waitFor(() => stream.open.mock.calls.length === 1);

    // The session's own account id is still the import's to persist, but the
    // connection the stream opens on names the account discovery found: without
    // it the connect is refused with 428 and the session never leaves `error`.
    expect(personal.accountId).toBeNull();
    expect(stream.accountIdAtOpen).toBe(PERSONAL_ACCOUNT_ID);
    expect(entry.engine.conn).toMatchObject({ protocol: 2, accountId: PERSONAL_ACCOUNT_ID });

    stream.push(READY);
    await waitFor(() => entry.runner.state === 'live');

    // The listing the session reconciles carries the same id.
    expect(apiClient.listNodes.mock.calls[0][0]).toMatchObject({
      protocol: 2, syncBase: '/_/sync', accountId: PERSONAL_ACCOUNT_ID
    });
  });

  it('offline discovery keeps a migrated personal session offline and it retries', async () => {
    jest.useFakeTimers();
    try {
      personal.accountId = null;
      personal.legacyMetaDir = 'legacy-personal';
      settings.syncSessions = [personal];
      const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
      apiClient.getAccounts.mockRejectedValue(new Error('fetch failed'));

      await manager.startEnabledSessions();

      // The launch has its entry, and nothing is opened or listed: the resolve
      // itself failed, so the session backs off instead of opening a stream it
      // cannot identify on.
      const entry = manager.sessions.get(personal.id);
      const stream = streamFor(personal.id);
      await flush();
      expect(entry.runner.state).toBe('offline');
      expect(stream.open).not.toHaveBeenCalled();
      expect(apiClient.listNodes).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();

      // The network is back: the backoff restarts the session, which identifies
      // itself before it opens its stream.
      apiClient.getAccounts.mockResolvedValue(discovery([personalAccount()]));
      apiClient.listNodes.mockResolvedValue(completeList([]));
      await jest.advanceTimersByTimeAsync(5000);
      await flush();

      expect(entry.runner.state).toBe('starting');
      expect(stream.open).toHaveBeenCalledTimes(1);
      expect(stream.accountIdAtOpen).toBe(PERSONAL_ACCOUNT_ID);
      expect(entry.engine.conn.accountId).toBe(PERSONAL_ACCOUNT_ID);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the account id is persisted only by the import, not by the resolve', async () => {
    personal.accountId = null;
    personal.legacyMetaDir = 'legacy-personal';
    settings.syncSessions = [personal];
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.startEnabledSessions();
    const entry = manager.sessions.get(personal.id);
    const stream = streamFor(personal.id);
    await waitFor(() => stream.open.mock.calls.length === 1);

    // Resolving named the account to the engine; the session is not identified
    // and nothing about it is durable yet.
    expect(entry.engine.accountId).toBe(PERSONAL_ACCOUNT_ID);
    expect(personal.accountId).toBeNull();
    expect(personal.legacyMetaDir).toBe('legacy-personal');
    expect(settingsStore.save).not.toHaveBeenCalled();

    // The import's step 5 is what writes the id and moves the session off the
    // legacy directory.
    stream.push(READY);
    await waitFor(() => entry.runner.state === 'live');

    expect(personal.accountId).toBe(PERSONAL_ACCOUNT_ID);
    expect(personal.legacyMetaDir).toBeNull();
    expect(settingsStore.save).toHaveBeenCalled();
  });

  it('offline discovery starts sessions with the fallback syncBase', async () => {
    apiClient.getAccounts.mockRejectedValue(new Error('fetch failed'));
    apiClient.listNodes.mockResolvedValue(completeList([]));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const statuses = await manager.startEnabledSessions();

    expect(statuses.map((status) => [status.sessionId, status.paused])).toEqual([
      [personal.id, null],
      [team.id, null]
    ]);
    expect(connections()).toEqual([
      [2, '/_/sync', PERSONAL_ACCOUNT_ID],
      [2, '/_/team/acme/sync', TEAM_ACCOUNT_ID]
    ]);
    expect(logged).toHaveBeenCalled();
  });

  it('a team discovery lists as viewer starts paused with viewer and opens no stream', async () => {
    settings.syncSessions = [team];
    apiClient.getAccounts.mockResolvedValue(discovery([
      teamAccount({ sync: { enabled: false, reason: 'viewer' } })
    ]));

    const statuses = await manager.startEnabledSessions();

    expect(statuses).toEqual([
      expect.objectContaining({
        sessionId: team.id, status: 'paused', paused: { reason: 'viewer', since: expect.any(String) }
      })
    ]);
    expect(team.paused).toEqual({ reason: 'viewer', since: expect.any(String) });
    expect(settingsStore.save).toHaveBeenCalled();

    const entry = manager.sessions.get(team.id);
    expect(entry.runner.state).toBe('paused');
    expect(streamFor(team.id).open).not.toHaveBeenCalled();
    expect(entry.engine.sseConnection).toBeNull();

    // No stream, no inventory, no pass: nothing is downloaded or uploaded.
    expect(apiClient.listNodes).not.toHaveBeenCalled();
    expect(initialSync.performInitialFolderSync).not.toHaveBeenCalled();
    expect(initialSync.performInitialSync).not.toHaveBeenCalled();
    expect(initialSync.performInitialUploadSync).not.toHaveBeenCalled();
    expect(apiClient.putNodeContent).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
  });

  it('a team missing from discovery starts paused with removed', async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount()]));

    const statuses = await manager.startEnabledSessions();

    expect(statuses.map((status) => status.sessionId)).toEqual([personal.id, team.id]);
    expect(statuses[0].paused).toBeNull();
    expect(team.paused).toEqual({ reason: 'removed', since: expect.any(String) });
    expect(settingsStore.save).toHaveBeenCalled();

    const entry = manager.sessions.get(team.id);
    expect(entry.runner.state).toBe('paused');
    expect(streamFor(team.id).open).not.toHaveBeenCalled();
    expect(apiClient.listNodes).not.toHaveBeenCalled();
  });

  it('startEnabledSessions clears a persisted key-revoked pause when discovery answers', async () => {
    settings.syncSessions = [team];
    team.paused = { reason: 'key-revoked', since: '2026-09-23T00:00:00.000Z' };
    apiClient.getAccounts.mockResolvedValue(discovery([teamAccount()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.startEnabledSessions();

    // The discovery answered with the current key, so the pause it persisted is gone
    // and the session starts instead of waiting for one.
    const entry = manager.sessions.get(team.id);
    expect(team.paused).toBeNull();
    expect(settingsStore.save).toHaveBeenCalled();
    expect(entry.runner.state).toBe('starting');
    expect(streamFor(team.id).open).toHaveBeenCalledTimes(1);
  });

  it('startEnabledSessions pauses every session server-update-required when a feature is off', async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()], {
      features: { ...FEATURES_ON, completeInventory: false }
    }));

    const statuses = await manager.startEnabledSessions();

    expect(statuses.every((status) => status.status === 'paused')).toBe(true);
    for (const session of [personal, team]) {
      expect(session.paused).toEqual({ reason: 'server-update-required', since: expect.any(String) });
      const entry = manager.sessions.get(session.id);
      expect(entry.runner.state).toBe('paused');
      expect(streamFor(session.id).open).not.toHaveBeenCalled();
    }
    expect(apiClient.listNodes).not.toHaveBeenCalled();
  });

  it('a paused session resumes through onDiscovery once discovery enables it', async () => {
    settings.syncSessions = [team];
    team.paused = { reason: 'viewer', since: '2026-09-23T00:00:00.000Z' };
    apiClient.getAccounts.mockResolvedValue(discovery([teamAccount()]));

    await manager.startEnabledSessions();

    // The entry is there for `onDiscovery` to find, with its earlier reason and
    // timestamp standing: a session already paused re-persists nothing.
    const entry = manager.sessions.get(team.id);
    expect(entry.runner.state).toBe('paused');
    expect(team.paused).toEqual({ reason: 'viewer', since: '2026-09-23T00:00:00.000Z' });
    expect(streamFor(team.id).open).not.toHaveBeenCalled();
    expect(settingsStore.save).not.toHaveBeenCalled();

    apiClient.listNodes.mockResolvedValue(completeList([]));
    manager.onDiscovery(discovery([teamAccount()]));

    expect(entry.runner.state).toBe('starting');
    expect(streamFor(team.id).open).toHaveBeenCalledTimes(1);

    streamFor(team.id).push(READY);
    await waitFor(() => entry.runner.state === 'live');

    expect(team.paused).toBeNull();
    expect(settingsStore.save).toHaveBeenCalled();
    expect(apiClient.listNodes.mock.calls[0][0]).toMatchObject({ protocol: 2, syncBase: '/_/team/acme/sync' });
  });

  it('a session launched paused starts its watcher when discovery resumes it', async () => {
    settings.syncSessions = [team];
    apiClient.getAccounts.mockResolvedValue(discovery([
      teamAccount({ sync: { enabled: false, reason: 'viewer' } })
    ]));

    await manager.startEnabledSessions();

    const entry = manager.sessions.get(team.id);
    expect(entry.runner.state).toBe('paused');
    // Nothing watched the folder while the session waited: there is nothing to
    // watch for a session that cannot act on an event.
    expect(entry.engine.startUnifiedWatcher).not.toHaveBeenCalled();

    apiClient.listNodes.mockResolvedValue(completeList([]));
    manager.onDiscovery(discovery([teamAccount()]));

    // The resume is what subscribes the session, so the edit below is queued.
    expect(entry.engine.startUnifiedWatcher).toHaveBeenCalledTimes(1);
    streamFor(team.id).push(READY);
    await waitFor(() => entry.runner.state === 'live');

    await localEdit(entry.engine, 'index.html');

    expect(entry.engine.syncQueue.length()).toBe(1);
  });

  it('a local edit while paused is not queued, and resume reconciles it', async () => {
    settings.syncSessions = [team];
    apiClient.getAccounts.mockResolvedValue(discovery([
      teamAccount({ sync: { enabled: false, reason: 'viewer' } })
    ]));

    await manager.startEnabledSessions();

    const entry = manager.sessions.get(team.id);
    expect(entry.runner.state).toBe('paused');

    // An edit made while the session is paused is dropped on the floor: nothing
    // is queued for a later replay, and nothing is uploaded or created now.
    await localEdit(entry.engine, 'index.html');
    expect(entry.engine.syncQueue.length()).toBe(0);
    expect(apiClient.putNodeContent).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(initialSync.performInitialSync).not.toHaveBeenCalled();

    // Discovery enables it: the resume reconciles the disk in one pass, and that
    // pass — not the queue — is where the edit is picked up.
    apiClient.listNodes.mockResolvedValue(completeList([]));
    manager.onDiscovery(discovery([teamAccount()]));
    streamFor(team.id).push(READY);
    await waitFor(() => entry.runner.state === 'live');

    expect(apiClient.listNodes).toHaveBeenCalledTimes(1);
    expect(initialSync.performInitialFolderSync).toHaveBeenCalled();
    expect(initialSync.performInitialSync).toHaveBeenCalled();
    expect(initialSync.performInitialUploadSync).toHaveBeenCalled();
    expect(entry.engine.syncQueue.length()).toBe(0);
  });

  it('an offline launch starts the session offline and it syncs once the network returns', async () => {
    jest.useFakeTimers();
    try {
      settings.syncSessions = [team];
      const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
      apiClient.getAccounts.mockRejectedValue(new Error('fetch failed'));
      // The key cannot be proved and the listing cannot be read: the network is
      // gone. The real `calibrateClock` is the one that sees it, through its own
      // fetch, and it rejects with what `classifyError` calls offline.
      engineUtils.calibrateClock.mockImplementationOnce(
        jest.requireActual('../../src/sync-engine/utils').calibrateClock
      );
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
      apiClient.listNodes.mockRejectedValueOnce(new Error('fetch failed'));

      const statuses = await manager.startEnabledSessions();

      // The launch succeeded: init returned success without running a pass, the
      // session has its entry and its runner, and the runner is the one that
      // fails and backs off from here.
      const entry = manager.sessions.get(team.id);
      expect(statuses.map((status) => status.sessionId)).toEqual([team.id]);
      expect(global.fetch).toHaveBeenCalled();
      expect(initialSync.performInitialSync).not.toHaveBeenCalled();
      expect(entry.engine.isRunning).toBe(true);
      expect(entry.runner.state).toBe('starting');

      const stream = streamFor(team.id);
      expect(stream.open).toHaveBeenCalledTimes(1);
      stream.push(READY);
      await flush();

      expect(entry.runner.state).toBe('offline');
      expect(logged).toHaveBeenCalled();

      // The network is back: the backoff retry reopens the stream and reconciles.
      apiClient.listNodes.mockResolvedValue(completeList([]));
      await jest.advanceTimersByTimeAsync(5000);

      expect(stream.open).toHaveBeenCalledTimes(2);
      stream.push(READY);
      await flush();

      expect(entry.runner.state).toBe('live');
      expect(initialSync.performInitialSync).toHaveBeenCalled();
      expect(apiClient.listNodes).toHaveBeenCalledTimes(2);
    } finally {
      delete global.fetch;
      jest.useRealTimers();
    }
  });

  it('one session failing to start does not stop the others', async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));
    // The personal session's key is refused, so its init throws: the team
    // session after it still starts.
    engineUtils.calibrateClock.mockRejectedValueOnce(
      Object.assign(new Error('invalid key'), { statusCode: 401 })
    );
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const statuses = await manager.startEnabledSessions();

    expect(logged).toHaveBeenCalled();
    expect(statuses.map((status) => status.sessionId)).toEqual([personal.id, team.id]);
    const failed = manager.sessions.get(personal.id);
    expect(failed.engine.isRunning).toBe(false);
    expect(failed.runner.state).toBe('stopped');

    const entry = manager.sessions.get(team.id);
    expect(entry.engine.isRunning).toBe(true);
    expect(entry.runner.state).toBe('starting');
    expect(streamFor(team.id).open).toHaveBeenCalledTimes(1);
    expect(statuses[1].status).toBe('syncing');
  });

  it('stopAll stops every session', async () => {
    apiClient.getAccounts.mockResolvedValue(discovery([personalAccount(), teamAccount()]));
    apiClient.listNodes.mockResolvedValue(completeList([]));

    await manager.startEnabledSessions();
    const entries = [personal.id, team.id].map((id) => manager.sessions.get(id));
    for (const session of [personal, team]) streamFor(session.id).push(READY);
    await waitFor(() => manager.statuses().every((status) => status.status === 'idle'));

    await manager.stopAll();

    expect(manager.sessions.size).toBe(0);
    expect(manager.statuses()).toEqual([]);
    for (const entry of entries) {
      expect(entry.runner.state).toBe('stopped');
      expect(entry.engine.isRunning).toBe(false);
      expect(entry.runner.stream.close).toHaveBeenCalled();
    }
  });
});
