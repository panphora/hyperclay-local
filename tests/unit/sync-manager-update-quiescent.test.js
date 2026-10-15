// The update drain asks `whenQuiescentForUpdate`, which must see every place a
// session holds work that `stopAll` would drop: structure marks still
// debouncing, held deletions, items already taken off the queue, retry timers,
// and an offline session's queue. `whenAllIdle` keeps its looser meaning for the
// round-trip driver, so the first test pins the difference.

jest.mock('electron', () => ({ app: undefined, safeStorage: {} }));

const { SyncEngine } = require('../../src/sync-engine');
const { SyncManager } = require('../../src/main/sync-manager');
const { SessionRunner } = require('../../src/sync-engine/reconcile/session-runner');

const sessions = [];

function liveSession() {
  const engine = new SyncEngine();
  engine.isRunning = true;
  const manager = new SyncManager({
    userData: __dirname,
    settingsStore: { get: () => ({ roots: [], syncSessions: [] }) },
    getApiKey: () => null,
    observerFor: () => null
  });
  const runner = new SessionRunner({ engine, manager, stream: { close() {} } });
  runner.state = 'live';
  engine.runner = runner;
  manager.sessions.set('s1', {
    engine, runner, session: { id: 's1', accountId: 1 }, root: { id: 'r1' },
    observer: { setRemoteApplyCheck() {} }, listeners: [], conflicts: []
  });
  sessions.push(manager);
  return { engine, manager, runner };
}

afterEach(async () => {
  for (const manager of sessions.splice(0)) await manager.stopAll();
});

const quick = { timeoutMs: 400, settleMs: 50, pollMs: 10 };

describe('SyncManager update quiescence', () => {
  test('a structural deletion still debouncing blocks the drain, though whenAllIdle calls it idle', async () => {
    const { engine, manager } = liveSession();
    engine.repo.seed(new Map([['10', { path: 'uploads/photo.png', type: 'upload', inode: '1:2', checksum: 'old' }]]));
    engine.markDirty('uploads/photo.png');
    const structure = engine._structureState();

    expect(manager._allIdle()).toBe(true);
    expect(manager.updateQuiescent()).toBe(false);
    await expect(manager.whenQuiescentForUpdate(quick)).resolves.toBe(false);
    expect([...structure.dirty]).toEqual(['uploads/photo.png']);
    expect(structure.timer).not.toBeNull();
  });

  test('a deletion held before sending blocks the drain', async () => {
    const { engine, manager } = liveSession();
    engine._scheduleStructureWake(Date.now() + 60_000);
    expect(manager.updateQuiescent()).toBe(false);
  });

  test('an item taken off the queue and still executing blocks the drain', async () => {
    const { engine, manager } = liveSession();
    let started;
    let release;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    const finish = new Promise((resolve) => { release = resolve; });
    engine.applyLocalChange = async () => { started(); await finish; };
    engine.syncQueue.add('change', 'site.html');
    const running = engine.processQueue();
    await startedPromise;

    expect(engine.syncQueue.length()).toBe(0);
    expect(manager._allIdle()).toBe(true);
    await expect(manager.whenQuiescentForUpdate(quick)).resolves.toBe(false);

    release();
    await running;
    await expect(manager.whenQuiescentForUpdate(quick)).resolves.toBe(true);
  });

  test('lane work queued behind a running job blocks the drain until both finish', async () => {
    const { engine, manager } = liveSession();
    let release;
    const finish = new Promise((resolve) => { release = resolve; });
    const first = engine.serial(() => finish);
    const second = engine.serial(async () => {});
    expect(manager.updateQuiescent()).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(manager.updateQuiescent()).toBe(true);
  });

  test('a scheduled retry blocks the drain', async () => {
    const { engine, manager } = liveSession();
    const result = engine.syncQueue.scheduleRetry({ type: 'change', filename: 'site.html' }, Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), () => {});
    expect(result.shouldRetry).toBe(true);
    expect(engine.syncQueue.length()).toBe(0);
    expect(manager.updateQuiescent()).toBe(false);
  });

  test('an offline session with pending work is refused, and its queue kept', async () => {
    const { engine, manager, runner } = liveSession();
    runner.state = 'offline';
    engine.syncQueue.add('change', 'site.html');
    await expect(manager.whenQuiescentForUpdate(quick)).resolves.toBe(false);
    expect(engine.syncQueue.length()).toBe(1);
  });

  test('an initial pass in flight blocks the drain', async () => {
    const { manager } = liveSession();
    manager.initialRunning = 1;
    expect(manager.updateQuiescent()).toBe(false);
    manager.initialRunning = 0;
    expect(manager.updateQuiescent()).toBe(true);
  });

  test('a session at rest drains once the settle time has passed', async () => {
    const { manager } = liveSession();
    const startedAt = Date.now();
    await expect(manager.whenQuiescentForUpdate({ timeoutMs: 2000, settleMs: 150, pollMs: 10 })).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
  });

  test('work arriving during the settle time restarts it', async () => {
    const { engine, manager } = liveSession();
    const waiting = manager.whenQuiescentForUpdate({ timeoutMs: 300, settleMs: 200, pollMs: 10 });
    setTimeout(() => engine.markDirty('index.html'), 100);
    await expect(waiting).resolves.toBe(false);
  });
});
