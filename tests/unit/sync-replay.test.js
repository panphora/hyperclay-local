// C5.2: a reconnecting tab resumes from its last position instead of refetching.
// The store proves completeness or says `resync`: a position it cannot cover
// (frames dropped, or a bucket created after that position, which covers a
// process restart and a reset) must never be answered with a silent gap.

const { ReplayStore } = require('../../src/main/sync-replay');

const TTL = 5 * 60 * 1000;
const MAX_FRAMES = 64;
const MAX_BYTES = 16 * 1024 * 1024;
const GLOBAL_MAX_FRAMES = 512;

function makeStore(start = 1_000_000) {
  let clock = start;
  const store = new ReplayStore({ now: () => clock });
  return { store, advance: (ms) => { clock += ms; }, at: () => clock };
}

function frame(file, lane, seq, message = `frame ${seq}`) {
  return { file, lane, seq, message };
}

describe('ReplayStore', () => {
  test('a first connection resumes at the current position with nothing to replay', () => {
    const { store } = makeStore();
    store.record(frame('a.html', 'live', 1_000_001));
    store.record(frame('a.html', 'live', 1_000_002));

    expect(store.resume('a.html', 'live', 0)).toEqual({
      baseline: 1_000_002,
      replay: [],
      resync: false
    });
  });

  test('a reconnect replays only frames above its position, in order', () => {
    const { store } = makeStore();
    store.record(frame('a.html', 'live', 1_000_001));
    store.record(frame('a.html', 'live', 1_000_002));
    store.record(frame('a.html', 'live', 1_000_003));

    expect(store.resume('a.html', 'live', 1_000_002)).toEqual({
      baseline: 1_000_002,
      replay: ['frame 1000003'],
      resync: false
    });
  });

  test('a position older than the bucket (restart) sets resync', () => {
    const { store } = makeStore(5_000_000);
    store.record(frame('a.html', 'live', 5_000_001));

    const resumed = store.resume('a.html', 'live', 1_000_000);
    expect(resumed.resync).toBe(true);
    expect(resumed.replay).toEqual(['frame 5000001']);
  });

  test('per-bucket frame cap drops the oldest and sets resync for a position below it', () => {
    const { store } = makeStore(1_000_000);
    for (let i = 1; i <= MAX_FRAMES + 6; i += 1) store.record(frame('a.html', 'live', 1_000_000 + i));

    expect(store.frames).toBe(MAX_FRAMES);
    expect(store.resume('a.html', 'live', 1_000_003).resync).toBe(true);
    expect(store.resume('a.html', 'live', 1_000_003).replay).toHaveLength(MAX_FRAMES);
    expect(store.resume('a.html', 'live', 1_000_060)).toEqual({
      baseline: 1_000_060,
      replay: ['frame 1000061', 'frame 1000062', 'frame 1000063', 'frame 1000064', 'frame 1000065', 'frame 1000066', 'frame 1000067', 'frame 1000068', 'frame 1000069', 'frame 1000070'],
      resync: false
    });
  });

  test('a frame over 16 MiB is not retained and marks resync', () => {
    const { store } = makeStore(1_000_000);
    const huge = `data: ${'x'.repeat(MAX_BYTES)}\n\n`;
    expect(Buffer.byteLength(huge)).toBeGreaterThan(MAX_BYTES);

    store.record(frame('a.html', 'live', 1_000_001, huge));
    store.record(frame('a.html', 'live', 1_000_002));

    expect(store.frames).toBe(1);
    const resumed = store.resume('a.html', 'live', 1_000_000);
    expect(resumed.resync).toBe(true);
    expect(resumed.replay).toEqual(['frame 1000002']);
  });

  test('global caps drop the globally oldest frame first', () => {
    const { store } = makeStore(0);
    const perBucket = 60;
    let seq = 0;
    for (let f = 0; f < 10; f += 1) {
      for (let i = 0; i < perBucket; i += 1) {
        seq += 1;
        store.record(frame(`f${f}.html`, 'live', seq));
      }
    }

    expect(store.frames).toBe(GLOBAL_MAX_FRAMES);
    expect(store.resume('f0.html', 'live', 1).replay).toEqual([]);
    expect(store.resume('f1.html', 'live', 88)).toEqual({
      baseline: 88,
      replay: Array.from({ length: 32 }, (_, i) => `frame ${89 + i}`),
      resync: false
    });
    expect(store.resume('f1.html', 'live', 87).resync).toBe(true);
    expect(store.resume('f9.html', 'live', 540).replay).toHaveLength(perBucket);
  });

  test('TTL expiry drops frames and marks resync', () => {
    const { store, advance } = makeStore(1_000_000);
    store.record(frame('a.html', 'live', 1_000_001));
    advance(TTL + 1);
    store.record(frame('a.html', 'live', 1_000_002 + TTL));

    expect(store.resume('a.html', 'live', 1_000_000)).toEqual({
      baseline: 1_000_000,
      replay: [`frame ${1_000_002 + TTL}`],
      resync: true
    });
    expect(store.frames).toBe(1);
  });

  test('reset(file) forces resync for any earlier position and none for a fresh one', () => {
    const { store } = makeStore(1_000_000);
    store.record(frame('a.html', 'live', 1_000_001));
    expect(store.resume('a.html', 'live', 1_000_001).resync).toBe(false);

    store.reset('a.html');
    expect(store.resume('a.html', 'live', 1_000_001)).toEqual({
      baseline: 1_000_001,
      replay: [],
      resync: true
    });
    expect(store.resume('a.html', 'live', 1_000_002).resync).toBe(false);
    expect(store.resume('a.html', 'saved', 1_000_001).resync).toBe(true);
    expect(store.resume('a.html', 'saved', 0).resync).toBe(false);
  });

  test('a position above lastSeq is treated as a first connection', () => {
    const { store } = makeStore(1_000_000);
    store.record(frame('a.html', 'live', 1_000_001));

    expect(store.resume('a.html', 'live', 9_000_000)).toEqual({
      baseline: 1_000_001,
      replay: [],
      resync: false
    });
  });

  test('lanes are separate buckets', () => {
    const { store } = makeStore(1_000_000);
    store.record(frame('a.html', 'live', 1_000_001, 'live frame'));
    store.record(frame('a.html', 'saved', 1_000_002, 'saved frame'));
    store.record(frame('a.html', 'other', 1_000_003, 'ignored frame'));

    expect(store.buckets.size).toBe(2);
    expect(store.resume('a.html', 'live', 1_000_001).replay).toEqual([]);
    expect(store.resume('a.html', 'saved', 1_000_001).replay).toEqual(['saved frame']);
  });
});
