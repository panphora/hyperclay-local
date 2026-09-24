/**
 * C3 §5.6: one state machine per sync session.
 *
 * The runner is driven by a fake stream (open/close with onFrame/onError), a
 * fake api and a fake engine, under fake timers, so the whole reconnect
 * sequence — sync-ready, buffering, invalidation, pause, backoff — is exercised
 * without a socket, a disk or a real second.
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

jest.mock('../../src/sync-engine/api-client');

const apiClient = require('../../src/sync-engine/api-client');
const { SessionRunner } = require('../../src/sync-engine/reconcile/session-runner');
const { SyncManager } = require('../../src/main/sync-manager');

const SESSION_ID = 'session-a';
const ACCOUNT_ID = 42;
const READY = { type: 'sync-ready', accountId: ACCOUNT_ID, role: 'editor', sync: { enabled: true, reason: null } };
const FEATURES_ON = {
  accountScopes: true,
  accountEvents: true,
  conditionalContent: true,
  conditionalStructure: true,
  completeInventory: true
};

function account(overrides = {}) {
  return {
    id: ACCOUNT_ID, kind: 'team', username: 'acme', displayName: 'Acme', role: 'editor',
    syncBase: '/_/team/acme/sync', lifecycle: 'active',
    sync: { enabled: true, reason: null },
    ...overrides
  };
}

function discovery(overrides = {}) {
  return { success: true, protocol: 2, features: FEATURES_ON, actor: { id: 17, username: 'alex' }, accounts: [account()], ...overrides };
}

// Fake timers mean a faked setImmediate never fires on its own, so the microtask
// queue is drained with a zero-length advance instead.
const flush = () => jest.advanceTimersByTimeAsync(0);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeStream() {
  const stream = {
    open: jest.fn((options) => { stream.options = options; }),
    close: jest.fn(),
    push(data) { stream.options.onFrame({ data }); },
    fail(error) { stream.options.onError(error); },
    opens() { return stream.open.mock.calls.length; }
  };
  return stream;
}

function makeEngine(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    generation: 0,
    relayLiveFrame: jest.fn(),
    reconcileAll: jest.fn().mockResolvedValue(),
    refreshNode: jest.fn().mockResolvedValue(),
    dropPendingWork: jest.fn(),
    whenQueueEmpty: jest.fn().mockResolvedValue(),
    _applyFileDelete: jest.fn(),
    rootPresent: () => true,
    ...overrides
  };
}

function makeManagerPort(overrides = {}) {
  return { persistPaused: jest.fn(), rediscover: jest.fn(), pauseAll: jest.fn(), ...overrides };
}

function session({ engine = {}, api = {}, manager = {}, stream = makeStream() } = {}) {
  const deps = {
    engine: makeEngine(engine),
    api: { listNodes: jest.fn().mockResolvedValue({ complete: true, nodes: [] }), ...api },
    stream,
    manager: makeManagerPort(manager)
  };
  const runner = new SessionRunner(deps);
  return { runner, ...deps };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('sync-ready and the first reconcile', () => {
  it('does not reconcile before sync-ready', async () => {
    const { runner, api, stream } = session();

    const started = runner.start();
    await flush();

    expect(runner.state).toBe('starting');
    expect(api.listNodes).not.toHaveBeenCalled();

    stream.push(READY);
    await started;

    expect(api.listNodes).toHaveBeenCalledTimes(1);
    expect(runner.state).toBe('live');
  });

  it('pauses with the reason a sync-ready that is not enabled carries', async () => {
    const { runner, engine, api, stream, manager } = session();

    const started = runner.start();
    stream.push({ type: 'sync-ready', accountId: ACCOUNT_ID, sync: { enabled: false, reason: 'viewer' } });
    await started;

    expect(runner.state).toBe('paused');
    expect(stream.close).toHaveBeenCalled();
    expect(engine.dropPendingWork).toHaveBeenCalled();
    expect(manager.persistPaused).toHaveBeenCalledWith(SESSION_ID, 'viewer');
    expect(api.listNodes).not.toHaveBeenCalled();
    expect(engine.reconcileAll).not.toHaveBeenCalled();
  });

  it('start pauses with folder-missing when the root is gone and opens no stream', async () => {
    const { runner, engine, manager, stream } = session({ engine: { rootPresent: () => false } });

    await runner.start();

    expect(runner.state).toBe('paused');
    expect(stream.open).not.toHaveBeenCalled();
    expect(manager.persistPaused).toHaveBeenCalledWith(SESSION_ID, 'folder-missing');
    expect(engine.reconcileAll).not.toHaveBeenCalled();
  });

  it('buffers node frames that arrive before the inventory and refreshes them after reconcile', async () => {
    const inventory = deferred();
    const statesAtRefresh = [];
    const { runner, engine, api, stream } = session({
      engine: { refreshNode: jest.fn(async () => { statesAtRefresh.push(runner.state); }) }
    });
    api.listNodes.mockReturnValue(inventory.promise);

    const started = runner.start();
    stream.push(READY);
    await flush();
    expect(runner.state).toBe('reconciling');

    stream.push({ type: 'node-saved', nodeId: 5, path: 'index.html', etag: 'etag-5' });
    expect(engine.refreshNode).not.toHaveBeenCalled();

    inventory.resolve({ complete: true, nodes: [] });
    await started;

    expect(engine.reconcileAll).toHaveBeenCalledTimes(1);
    expect(engine.refreshNode).toHaveBeenCalledWith('5', { generation: 1 });
    expect(statesAtRefresh).toEqual(['reconciling']);
    expect(engine.reconcileAll.mock.invocationCallOrder[0])
      .toBeLessThan(engine.refreshNode.mock.invocationCallOrder[0]);
    expect(runner.state).toBe('live');
  });
});

describe('live frames after the reconcile', () => {
  async function liveSession(overrides) {
    const parts = session(overrides);
    const started = parts.runner.start();
    parts.stream.push(READY);
    await started;
    expect(parts.runner.state).toBe('live');
    return parts;
  }

  it('turns a node frame into an invalidation, coalesced per node', async () => {
    const { runner, engine, stream } = await liveSession();

    stream.push({ type: 'node-saved', nodeId: 7, path: 'a.html', etag: 'etag-7' });
    stream.push({ type: 'node-saved', nodeId: 7, path: 'a.html', etag: 'etag-8' });
    await flush();

    expect(engine.refreshNode).toHaveBeenCalledTimes(1);
    expect(engine.refreshNode).toHaveBeenCalledWith('7', { generation: 1 });
    expect(runner.state).toBe('live');
  });

  it('relays a live-sync frame through the engine at any state', async () => {
    const { runner, engine, stream } = session();

    const started = runner.start();
    stream.push({ type: 'live-sync', file: 'a.html', html: '<p>x</p>', sender: 'other-device' });

    expect(engine.relayLiveFrame).toHaveBeenCalledWith(
      { type: 'live-sync', file: 'a.html', html: '<p>x</p>', sender: 'other-device' }
    );
    expect(runner.state).toBe('starting');

    stream.push(READY);
    await started;
  });

  it('answers whenIdle with the state the queue drained in', async () => {
    const { runner, engine } = await liveSession();

    engine.whenQueueEmpty.mockImplementation(() => {
      expect(runner.state).toBe('live');
      return Promise.resolve();
    });

    await expect(runner.whenIdle()).resolves.toBe('live');
  });
});

describe('stale generations', () => {
  it('a stale generation writes nothing', async () => {
    const held = deferred();
    const write = jest.fn();
    const { runner, engine, stream } = session({
      engine: {
        reconcileAll: jest.fn(async (inventory, { generation, signal }) => {
          await held.promise;
          if (signal.aborted || generation !== runner.generation) return;
          write();
        })
      }
    });

    const started = runner.start();
    stream.push(READY);
    await flush();
    expect(engine.reconcileAll).toHaveBeenCalledTimes(1);
    const { generation, signal } = engine.reconcileAll.mock.calls[0][1];

    runner.pause('viewer');

    expect(signal.aborted).toBe(true);
    expect(runner.generation).toBe(generation + 1);
    expect(runner.state).toBe('paused');

    held.resolve();
    await started;
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(engine.refreshNode).not.toHaveBeenCalled();
    expect(engine.whenQueueEmpty).not.toHaveBeenCalled();
    expect(runner.state).toBe('paused');
  });

  it('stop() closes the stream, drops the work and stays stopped', () => {
    const { runner, engine, stream } = session();

    runner.stop();

    expect(runner.state).toBe('stopped');
    expect(stream.close).toHaveBeenCalled();
    expect(engine.dropPendingWork).toHaveBeenCalled();
  });
});

describe('access refusals', () => {
  it('pauses plan-lapsed and persists it on a 402 from the stream', async () => {
    const { runner, engine, stream, manager } = session();

    runner.start();
    stream.fail({ statusCode: 402, code: 'payment-required' });
    await flush();

    expect(runner.state).toBe('paused');
    expect(manager.persistPaused).toHaveBeenCalledWith(SESSION_ID, 'plan-lapsed');
    expect(stream.close).toHaveBeenCalled();
    expect(engine.dropPendingWork).toHaveBeenCalled();
    expect(engine.reconcileAll).not.toHaveBeenCalled();
  });

  it('pauses viewer on a 403 the same way', async () => {
    const { runner, manager, stream } = session();

    runner.start();
    stream.fail({ statusCode: 403, code: 'viewer' });
    await flush();

    expect(runner.state).toBe('paused');
    expect(manager.persistPaused).toHaveBeenCalledWith(SESSION_ID, 'viewer');
  });

  it('pauses every session through the manager on a 401', async () => {
    const { runner, manager, stream } = session();

    runner.start();
    stream.fail({ statusCode: 401, code: 'invalid-key' });
    await flush();

    expect(manager.pauseAll).toHaveBeenCalledWith('key-revoked');
    expect(manager.persistPaused).not.toHaveBeenCalled();
    expect(runner.state).not.toBe('live');
  });

  it('closes the stream and rediscovers on account-changed', async () => {
    const { runner, manager, stream } = session();

    const started = runner.start();
    stream.push({ type: 'account-changed', accountId: ACCOUNT_ID, reason: 'role' });

    expect(stream.close).toHaveBeenCalled();
    expect(manager.rediscover).toHaveBeenCalledWith({ reason: 'role', sessionId: SESSION_ID });

    stream.push(READY);
    await started;
  });
});

describe('a rediscover that fails', () => {
  it('account-changed key-revoked pauses every session with key-revoked and does not rediscover', async () => {
    const { runner, manager, stream } = session();

    runner.start();
    stream.push({ type: 'account-changed', accountId: ACCOUNT_ID, reason: 'key-revoked' });

    expect(stream.close).toHaveBeenCalled();
    expect(manager.pauseAll).toHaveBeenCalledWith('key-revoked');
    expect(manager.rediscover).not.toHaveBeenCalled();

    await flush();
    expect(manager.rediscover).not.toHaveBeenCalled();
  });

  it('a rediscover that fails 401 pauses every session with key-revoked', async () => {
    const { runner, manager, stream } = session();
    manager.rediscover.mockRejectedValue(Object.assign(new Error('unauthorized'), { statusCode: 401 }));

    runner.start();
    stream.push({ type: 'account-changed', accountId: ACCOUNT_ID, reason: 'role' });
    await flush();

    expect(manager.rediscover).toHaveBeenCalledWith({ reason: 'role', sessionId: SESSION_ID });
    expect(manager.pauseAll).toHaveBeenCalledWith('key-revoked');
    expect(runner.state).not.toBe('live');
    expect(runner.lastError).toBe('unauthorized');
  });

  it('a rediscover that fails offline backs off and retries', async () => {
    const { runner, manager, stream } = session();
    manager.rediscover.mockRejectedValue(new Error('socket hang up'));

    runner.start();
    stream.push({ type: 'account-changed', accountId: ACCOUNT_ID, reason: 'role' });
    await flush();

    expect(runner.state).toBe('offline');
    await jest.advanceTimersByTimeAsync(4_999);
    expect(stream.opens()).toBe(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(2);
    expect(runner.state).toBe('starting');
  });

  it('a rediscover rejection is never unhandled', async () => {
    const unhandled = jest.fn();
    const { runner, manager, stream } = session();
    manager.rediscover.mockRejectedValue(Object.assign(new Error('unauthorized'), { statusCode: 401 }));
    process.on('unhandledRejection', unhandled);
    try {
      runner.start();
      stream.push({ type: 'account-changed', accountId: ACCOUNT_ID, reason: 'role' });
      await flush();
      await Promise.resolve();
      await flush();
      await Promise.resolve();
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('offline backoff', () => {
  it('backs off on an incomplete inventory and deletes nothing', async () => {
    const { runner, engine, api, stream } = session();
    api.listNodes.mockResolvedValue({
      complete: false,
      nodes: [{ id: 5, type: 'site', name: 'gone.html', path: '' }]
    });

    runner.start();
    stream.push(READY);
    await flush();

    expect(runner.state).toBe('offline');
    expect(engine.reconcileAll).not.toHaveBeenCalled();
    expect(engine._applyFileDelete).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(4_999);
    expect(stream.opens()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(2);
    expect(runner.state).toBe('starting');
  });

  it('backs off 5 s, 15 s, 60 s, then 60 s, and resets after a live reconcile', async () => {
    const lists = [];
    const { runner, api, stream } = session();
    api.listNodes.mockImplementation(() => {
      const list = deferred();
      lists.push(list);
      return list.promise;
    });

    runner.start();
    expect(stream.opens()).toBe(1);

    // Each failure lands after sync-ready but before the inventory, so the
    // ready timeout never fires and the ladder is the only timer in play.
    stream.fail(new Error('socket hang up'));
    expect(runner.state).toBe('offline');

    await jest.advanceTimersByTimeAsync(4_999);
    expect(stream.opens()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(2);
    stream.push(READY);
    stream.fail(new Error('still down'));

    await jest.advanceTimersByTimeAsync(14_999);
    expect(stream.opens()).toBe(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(3);
    stream.push(READY);
    stream.fail(new Error('still down'));

    await jest.advanceTimersByTimeAsync(59_999);
    expect(stream.opens()).toBe(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(4);
    stream.push(READY);
    stream.fail(new Error('still down'));

    await jest.advanceTimersByTimeAsync(59_999);
    expect(stream.opens()).toBe(4);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(5);
    stream.push(READY);
    stream.fail(new Error('still down'));

    await jest.advanceTimersByTimeAsync(59_999);
    expect(stream.opens()).toBe(5);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(6);

    // This restart's inventory lands and the reconcile reaches live.
    stream.push(READY);
    await flush();
    lists[lists.length - 1].resolve({ complete: true, nodes: [] });
    await flush();
    expect(runner.state).toBe('live');

    // The ladder is back at 5 s.
    stream.fail(new Error('down again'));
    await jest.advanceTimersByTimeAsync(4_999);
    expect(stream.opens()).toBe(6);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(7);
  });

  it('lets Retry-After override the ladder', async () => {
    const { runner, stream } = session();

    runner.start();
    stream.fail({ statusCode: 503, code: 'storage-changing', retryAfterMs: 7_000 });
    expect(runner.state).toBe('offline');

    await jest.advanceTimersByTimeAsync(6_999);
    expect(stream.opens()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(2);

    // a Retry-After does not advance the ladder: the next plain 503 is 5 s again
    stream.fail({ statusCode: 503 });
    await jest.advanceTimersByTimeAsync(4_999);
    expect(stream.opens()).toBe(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(stream.opens()).toBe(3);
  });
});

describe('SyncManager resume and rebind', () => {
  function makeSyncManager() {
    const settings = { settingsVersion: 2, syncSessions: [] };
    const settingsStore = { get: () => settings, save: jest.fn() };
    const manager = new SyncManager({
      userData: '/tmp/hyperclay-runner-test',
      deviceId: 'device-1',
      serverUrl: 'http://test',
      getApiKey: () => 'hcsk_test',
      settingsStore
    });
    return { manager, settingsStore, settings };
  }

  function addSession(manager, { id = SESSION_ID, accountId = ACCOUNT_ID, paused = null, state = 'paused' } = {}) {
    const session = { id, rootId: 'root-a', accountId, kind: 'team', cached: {}, paused };
    const runner = { state, start: jest.fn(), resume: jest.fn(), pause: jest.fn() };
    const engine = { sessionId: id, syncBase: '/_/sync', downloadFile: jest.fn() };
    manager.sessions.set(id, { session, root: { id: 'root-a', path: '/tmp/root-a' }, engine, runner });
    return { session, runner, engine };
  }

  it('resumes on discovery when the account is enabled again', () => {
    const { manager, settingsStore } = makeSyncManager();
    const { session, runner, engine } = addSession(manager, { paused: { reason: 'plan-lapsed', since: '2026-09-23T00:00:00.000Z' } });

    manager.onDiscovery(discovery());

    expect(runner.resume).toHaveBeenCalled();
    expect(engine.syncBase).toBe('/_/team/acme/sync');
    expect(session.cached).toEqual({ username: 'acme', displayName: 'Acme', role: 'editor' });
    expect(settingsStore.save).toHaveBeenCalled();
  });

  it('does not resume a key-revoked session on discovery', () => {
    const { manager } = makeSyncManager();
    const { runner, engine } = addSession(manager, { paused: { reason: 'key-revoked', since: '2026-09-23T00:00:00.000Z' } });

    manager.onDiscovery(discovery());

    expect(runner.resume).not.toHaveBeenCalled();
    expect(engine.syncBase).toBe('/_/sync');
  });

  it('resumes a server-update-required session only when every feature is true', () => {
    const { manager } = makeSyncManager();
    const { runner } = addSession(manager, { paused: { reason: 'server-update-required', since: '2026-09-23T00:00:00.000Z' } });

    manager.onDiscovery(discovery({ features: { accountScopes: true, accountEvents: true } }));
    expect(runner.resume).not.toHaveBeenCalled();

    manager.onDiscovery(discovery({ features: FEATURES_ON }));
    expect(runner.resume).toHaveBeenCalled();
  });

  it('rebinds on a rename without downloading anything', async () => {
    const { manager } = makeSyncManager();
    const { session, runner, engine } = addSession(manager, { paused: { reason: 'forbidden', since: '2026-09-23T00:00:00.000Z' } });
    apiClient.getAccounts.mockResolvedValue(discovery({
      accounts: [account({ username: 'acme-renamed', displayName: 'Acme Renamed', syncBase: '/_/team/acme-renamed/sync' })]
    }));

    await manager.rediscover({ reason: 'role', sessionId: SESSION_ID });

    expect(engine.syncBase).toBe('/_/team/acme-renamed/sync');
    expect(session.id).toBe(SESSION_ID);
    expect(session.cached).toEqual({ username: 'acme-renamed', displayName: 'Acme Renamed', role: 'editor' });
    expect(engine.downloadFile).not.toHaveBeenCalled();
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it('pauses instead of looping when a rediscover is refused for the same reason twice', async () => {
    const { manager } = makeSyncManager();
    const { runner } = addSession(manager, { paused: { reason: 'forbidden', since: '2026-09-23T00:00:00.000Z' } });
    apiClient.getAccounts.mockResolvedValue(discovery());

    await manager.rediscover({ reason: 'forbidden', sessionId: SESSION_ID });
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(runner.pause).not.toHaveBeenCalled();

    await manager.rediscover({ reason: 'forbidden', sessionId: SESSION_ID });

    expect(runner.pause).toHaveBeenCalledWith('forbidden');
    expect(runner.start).toHaveBeenCalledTimes(1);
  });

  it('pauses with removed when discovery no longer lists the account', async () => {
    const { manager, settingsStore } = makeSyncManager();
    const { runner } = addSession(manager);
    apiClient.getAccounts.mockResolvedValue(discovery({ accounts: [] }));

    await manager.rediscover({ reason: 'not-found', sessionId: SESSION_ID });

    expect(runner.pause).toHaveBeenCalledWith('removed');
    expect(settingsStore.save).not.toHaveBeenCalled();
  });

  it('persists the pause reason and clears it on resume', () => {
    const { manager, settingsStore, settings } = makeSyncManager();
    const { session } = addSession(manager);

    manager.persistPaused(SESSION_ID, 'viewer');
    expect(session.paused.reason).toBe('viewer');
    expect(session.paused.since).toEqual(expect.any(String));
    expect(settingsStore.save).toHaveBeenCalledWith(settings);

    manager.persistPaused(SESSION_ID, null);
    expect(session.paused).toBeNull();
  });

  it('pauses every session at once', () => {
    const { manager } = makeSyncManager();
    const a = addSession(manager, { id: 'session-a', state: 'live' });
    const b = addSession(manager, { id: 'session-b', state: 'live' });

    manager.pauseAll('key-revoked');

    expect(a.runner.pause).toHaveBeenCalledWith('key-revoked');
    expect(b.runner.pause).toHaveBeenCalledWith('key-revoked');
  });
});
