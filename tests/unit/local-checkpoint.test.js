const { execFileSync } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { createRooms, LIVE_LIMITS } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');

test('departure checkpoints the page and generic store, then a restarted decoder sees both', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../helpers/local-checkpoint-probe.cjs')], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
  });
  expect(output).toContain('checkpoint proof passed');
});

test('an arrival cancels departure and retries stop after 1, 5 and 30 seconds', async () => {
  const room = { key: '/tmp/test.html', nodeId: 'node-1', stores: new Map() };
  const rooms = { get: () => room, keys: () => [room.key] };
  const scheduled = [];
  const timers = [];
  const errors = [];
  const authority = {
    rooms, roomIsDirty: () => true, checkpointTargets: () => [{ rootId: 'root-a' }],
    captureAdmission: () => ({}), hasParticipatingEditors: () => false,
  };
  const service = createLocalCheckpoint({
    authority,
    withDocument: async () => { throw new Error('temporary disk failure'); },
    loadCore: async () => ({}),
    immediate: (fn) => { scheduled.push(fn); return fn; },
    cancelImmediate: (fn) => { scheduled.splice(scheduled.indexOf(fn), 1); },
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    logError: (...args) => errors.push(args),
  });
  service.registerWriter('root-a', async () => {});
  expect(service.departed(room)).toBe(true);
  expect(service.departed(room)).toBe(false);
  expect(scheduled).toHaveLength(1);
  expect(service.arrived(room.key)).toBe(true);
  expect(scheduled).toHaveLength(0);
  expect((await service.attempt(room.key)).retryInMs).toBe(1000);
  expect(timers.map((timer) => timer.ms)).toEqual([1000]);
  timers.shift();
  expect((await service.attempt(room.key)).retryInMs).toBe(5000);
  timers.shift();
  expect((await service.attempt(room.key)).retryInMs).toBe(30000);
  timers.shift();
  expect((await service.attempt(room.key)).exhausted).toBe(true);
  expect(errors.filter(([message]) => message.includes('unsaved live room'))).toHaveLength(1);
  expect(timers).toHaveLength(0);
});

test('the Local sweep retires a clean empty room and keeps an unsaved one', () => {
  let now = 0;
  const rooms = createRooms({ now: () => now });
  const authority = createLocalAuthority({ rooms, withDocument: async () => {} });
  const html = '<script type="application/json" merge="game" clay="live">{"score":0}</script>';
  const clean = rooms.open('/tmp/clean.html', html, { nodeId: 'clean' });
  const dirty = rooms.open('/tmp/dirty.html', html, { nodeId: 'dirty' });
  const accepted = rooms.apply(dirty, 'a', { name: 'game', n: 1,
    ops: [{ op: 'add', path: ['score'], n: 1 }] });
  expect(accepted.seq).toBeGreaterThan(0);
  rooms.leave(clean, null, []);
  rooms.leave(dirty, null, []);
  now = LIVE_LIMITS.retainMs + 1;
  authority.sweep();
  expect(rooms.get(clean.key)).toBeNull();
  expect(rooms.get(dirty.key)).toBe(dirty);
});

test('shutdown bounds a stuck checkpoint and reports the dirty room', async () => {
  const room = { key: '/tmp/stuck.html', nodeId: 'stuck' };
  const errors = [];
  const authority = {
    rooms: { get: () => room, keys: () => [room.key] },
    roomIsDirty: () => true,
    checkpointTargets: () => [{ rootId: 'root-a' }],
    captureAdmission: () => ({}),
  };
  const service = createLocalCheckpoint({
    authority,
    withDocument: () => new Promise(() => {}),
    loadCore: async () => ({}),
    logError: (...args) => errors.push(args),
  });
  service.registerWriter('root-a', async () => {});
  const result = await service.flushDirty({ timeoutMs: 5 });
  expect(result).toEqual({ attempted: 1, unsaved: [room.key], timedOut: true });
  expect(errors).toEqual([[expect.stringContaining('room still unsaved'), { key: room.key, nodeId: room.nodeId }]]);
});

test('a departure during a running checkpoint schedules the remaining dirty frame', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-departure-'));
  const key = path.join(dir, 'doc.html');
  await fs.writeFile(key, '<html></html>');
  const room = { key, nodeId: 'node-1', seq: 1, emptySince: Date.now() };
  const tasks = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const rooms = new Map([[key, room]]);
  rooms.markSaved = () => {};
  const authority = {
    rooms, roomIsDirty: () => true, hasParticipatingEditors: () => false,
    checkpointTargets: () => [{ rootId: 'root-a', identity: room.nodeId, logicalPath: 'doc.html' }],
    captureAdmission: () => ({}), validateAdmission: () => {},
    reconcileDisk: async () => ({ kind: 'current' }),
  };
  const checkpoint = createLocalCheckpoint({
    authority, withDocument: async (_, fn) => { started(); await gate; return fn(null, {}); },
    loadCore: async () => ({ captureCheckpoint: () => ({}), isCheckpointCurrent: () => true }),
    immediate: fn => { tasks.push(fn); return fn; }, cancelImmediate: () => {}, logError: () => {},
  });
  checkpoint.registerWriter('root-a', () => {});
  try {
    const first = checkpoint.attempt(key);
    await writing;
    expect(checkpoint.departed(room)).toBe(false);
    release();
    expect((await first).kind).toBe('current');
    expect(tasks).toHaveLength(1);
    expect(checkpoint.pending(key)).toBeInstanceOf(Promise);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a permanently refused dirty room expires after the retention period', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-expiry-'));
  const key = path.join(dir, 'doc.html');
  const html = '<html><body><script type="application/json" merge="count" clay="live">{"n":0}</script></body></html>';
  await fs.writeFile(key, html);
  let now = 0;
  const rooms = createRooms({ now: () => now });
  const { withDocumentWrite } = require('../../src/main/utils/write-queue');
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite, now: () => now });
  const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: key,
    origin: 'http://localhost:4000' });
  const room = rooms.open(key, html, { nodeId: target.identity });
  rooms.apply(room, 'tab', { name: 'count', n: 1, ops: [{ op: 'add', path: ['n'], n: 1 }] });
  rooms.leave(room, 'tab', []);
  const errors = [];
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite,
    loadCore: async () => ({ captureCheckpoint: () => { throw new Error('not a page'); } }),
    logError: (...args) => errors.push(args) });
  authority.setCheckpointService(checkpoint);
  checkpoint.registerWriter('root-a', () => {});
  try {
    expect((await checkpoint.attempt(key)).reason).toBe('invalid-document');
    expect(checkpoint.mayExpire(room)).toBe(true);
    now = LIVE_LIMITS.retainMs + 1;
    authority.sweep();
    expect(rooms.get(key)).toBeNull();
    expect(errors.filter(([message]) => message.includes('checkpoint refused'))).toHaveLength(1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('an unjoined arrival leaves a departure checkpoint scheduled', () => {
  const key = '/tmp/checkpoint-arrival.html';
  const rooms = createRooms();
  const authority = createLocalAuthority({ rooms, withDocument: async () => {} });
  const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: key,
    origin: 'http://localhost:4000' });
  const room = rooms.open(key, '<html></html>', { nodeId: target.identity });
  const arrived = jest.fn();
  authority.setCheckpointService({ arrived, departed: jest.fn() });
  const member = authority.registerEditor(target, { clientId: 'reader', send: () => {} });
  expect(arrived).not.toHaveBeenCalled();
  authority.markParticipating(member);
  expect(arrived).toHaveBeenCalledWith(key);
  member.close();
  expect(room).toBeTruthy();
});

test('a non-page document writes no rendered backup, and a page document that cannot render refuses', async () => {
  const html = '<!doctype html><html><head><script type="application/json" clay="live" merge="todos">{"items":["a"]}</script></head><body><ul></ul></body></html>';
  const room = { key: '/tmp/todo.html', nodeId: 'todo', stores: new Map() };
  const authority = { rooms: { get: () => room }, roomIsDirty: () => true };
  const core = reason => ({ captureCheckpoint: () => ({}), renderCheckpoint: () => ({ kind: 'refused', reason }) });
  const service = createLocalCheckpoint({ authority, withDocument: async () => {},
    loadCore: async () => core('invalid-document') });
  await expect(service.safetyBackup('/tmp/todo.html', html)).resolves.toBe(html);

  const page = '<!doctype html><html><body><article data-page="1"></article></body></html>';
  await expect(service.safetyBackup('/tmp/todo.html', page))
    .rejects.toThrow('Cannot back up live room: invalid-document');
  const refusing = createLocalCheckpoint({ authority, withDocument: async () => {},
    loadCore: async () => core('needs-adoption') });
  await expect(refusing.safetyBackup('/tmp/todo.html', page))
    .rejects.toThrow('Cannot back up live room: needs-adoption');
});
