const { execFileSync } = require('child_process');
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
