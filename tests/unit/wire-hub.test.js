// W1.1: the wire hub, pure. A port of the hub half of htmlclay's
// internal/server/wire.go (its tests live in wire_test.go). The clock is injected
// and the subscribers are fakes with offer/stop spies, so replay, retention and
// eviction are decided by the test rather than by sockets or the wall clock.

const { WireHub, WireError, createWireSub, envelopeJSON } = require('../../src/main/wire-hub');

const KEY = '/f.htmlclay';
const MAX_SUBS = 8; // maxWireSubs, wire.go:48
const MAX_TERMINALS = 32; // maxWireTerminals, wire.go:50
const TERMINAL_TTL_MS = 5 * 60 * 1000; // wireTerminalTTL, wire.go:51
const MAX_BUFFERED = 1 << 20; // WIRE_MAX_BUFFERED, the Node stand-in for wireQueueSize
const GLOBAL_MAX_TERMINAL_BYTES = 8 << 20; // wireGlobalMaxTerminalBytes, wire.go:59

// Driven exactly as the hub drives an SSE response: offer() takes a frame or
// refuses it, and a refusal is what evicts. accept:false is the slow consumer the
// Go tests build with a one-entry channel.
function fakeSub({ key = KEY, handler = false, mode, accept = true } = {}) {
  const sub = {
    key,
    handler,
    mode,
    removed: false,
    frames: [],
    offer: jest.fn((frame) => {
      if (!accept) return false;
      sub.frames.push(frame);
      return true;
    }),
    stop: jest.fn()
  };
  return sub;
}

const seqOf = (frame) => Number(frame.match(/^id: (\d+)\n/)[1]);
const request = (id) => ({ v: 1, type: 'wire/request', id, file: KEY });

describe('WireHub', () => {
  let clock;
  let hub;

  beforeEach(() => {
    clock = 1700000000000;
    hub = new WireHub({ now: () => clock });
  });

  // The hub has no timers, but nothing may be left subscribed across cases.
  afterEach(() => hub.shutdown());

  test('handler slot is exclusive', () => {
    const first = fakeSub({ handler: true });
    expect(() => hub.add(first, 0)).not.toThrow();

    const second = fakeSub({ handler: true });
    try {
      hub.add(second, 0);
      throw new Error('second handler admitted');
    } catch (error) {
      expect(error).toBeInstanceOf(WireError);
      expect(error.code).toBe('handler-taken');
    }

    // An observer alongside a handler is fine; tailing must not need the slot.
    expect(() => hub.add(fakeSub(), 0)).not.toThrow();
    expect(hub.handlerMode(KEY)).toBe('raw');

    // Releasing the slot lets the next handler in, so a reconnect is not
    // permanently locked out by its own predecessor.
    hub.remove(first);
    expect(() => hub.add(fakeSub({ handler: true }), 0)).not.toThrow();
  });

  test('observer cap is 8', () => {
    for (let i = 0; i < MAX_SUBS; i += 1) {
      expect(() => hub.add(fakeSub(), 0)).not.toThrow();
    }

    try {
      hub.add(fakeSub(), 0);
      throw new Error('cap not enforced');
    } catch (error) {
      expect(error).toBeInstanceOf(WireError);
      expect(error.code).toBe('busy');
    }
  });

  // The cap counts observers only, so the exclusive slot is reserved rather than
  // competed for: eight tails on a file must not lock the user's own agent out.
  test('a free handler slot is still takeable at the cap', () => {
    for (let i = 0; i < MAX_SUBS; i += 1) hub.add(fakeSub(), 0);
    expect(() => hub.add(fakeSub({ handler: true }), 0)).not.toThrow();
  });

  // "delivered" answers "is an agent there". Counting subscriber writes would
  // answer yes because the page's own observer stream takes a copy of the page's
  // own request.
  test("delivered counts handlers only; the sender's own observer copy does not count", () => {
    hub.add(fakeSub(), 0);
    expect(hub.publish(KEY, request('r1'))).toEqual({ handlers: 0, observers: 1, published: true });

    hub.add(fakeSub({ handler: true }), 0);
    expect(hub.publish(KEY, request('r2'))).toEqual({ handlers: 1, observers: 1, published: true });
  });

  test('replay returns only terminals above Last-Event-ID, sorted', () => {
    const { cursor } = hub.add(fakeSub(), 0);
    hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r1', file: KEY, text: 'working' });
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r1', file: KEY });
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r2', file: KEY });
    hub.publish(KEY, { v: 1, type: 'wire/error', id: 'r3', file: KEY });

    // The retained outcomes are deliberately out of insertion order, because the
    // Go hub replays from a map: order has to come from the sequence, not from the
    // order they arrived in.
    const channel = hub.chans.get(KEY);
    channel.terminal = new Map([...channel.terminal].reverse());

    const { cursor: resumedFrom, replay } = hub.add(fakeSub(), cursor);
    expect(resumedFrom).toBe(cursor);

    // Only terminal frames are retained: a lost status is repaired by the next
    // frame, and a lost terminal is repaired by nothing.
    expect(replay).toHaveLength(3);
    expect(replay.some((frame) => frame.includes('wire/status'))).toBe(false);

    const seqs = replay.map(seqOf);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.every((seq) => seq > cursor)).toBe(true);
  });

  // A fresh subscription replays nothing. A page reloaded after cancelling a
  // request has no memory of the cancel, so a replayed terminal would resurrect
  // it and "stop completely" would not survive a reload.
  test('a fresh subscription replays nothing', () => {
    hub.add(fakeSub(), 0);
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r1', file: KEY });

    const { cursor, replay } = hub.add(fakeSub(), 0);
    expect(replay).toEqual([]);

    // Its position is taken at subscribe time, so the outcome of a request that
    // ended before it subscribed stays below the cursor and every frame published
    // from here on sorts above it.
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r2', file: KEY });
    const terminal = hub.chans.get(KEY).terminal;
    expect(terminal.get('r1').seq).toBeLessThan(cursor);
    expect(terminal.get('r2').seq).toBeGreaterThan(cursor);
  });

  test('first terminal wins', () => {
    hub.add(fakeSub(), 0);
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r1', file: KEY });
    hub.publish(KEY, { v: 1, type: 'wire/error', id: 'r1', file: KEY, text: 'too late' });

    const { cursor, replay } = hub.add(fakeSub(), 0);
    expect(cursor).toBeGreaterThan(0);

    const resumed = hub.add(fakeSub(), 1);
    expect(resumed.replay).toHaveLength(1);
    expect(resumed.replay[0]).toContain('wire/done');
    expect(resumed.replay[0]).not.toContain('too late');
  });

  // Bounded subscribers evict rather than grow, matching the live-sync hub. A
  // subscriber that cannot keep up loses its stream instead of the server losing
  // its memory.
  test('a subscriber whose offer fails is evicted and stopped', () => {
    const slow = fakeSub({ accept: false });
    hub.add(slow, 0);

    for (let i = 0; i < 5; i += 1) {
      hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r1', file: KEY, text: 'x' });
    }

    expect(slow.offer).toHaveBeenCalledTimes(1);
    expect(slow.stop).toHaveBeenCalledTimes(1);
    expect(slow.removed).toBe(true);
    expect(hub.chans.has(KEY)).toBe(false);
  });

  // A channel keeps itself alive while it holds a retained outcome, and nothing
  // revisits a file whose handler has gone. Without a sweep that is one channel
  // per file ever touched, for the life of the site.
  test('channel is dropped once its terminals expire and it has no subscribers', () => {
    const sub = fakeSub();
    hub.add(sub, 0);
    hub.publish(KEY, { v: 1, type: 'wire/done', id: 'r1', file: KEY });
    hub.remove(sub);

    expect(hub.chans.has(KEY)).toBe(true);

    clock += 2 * TERMINAL_TTL_MS;

    // Any later hub operation sweeps, so the map is bounded by live use.
    const other = fakeSub({ key: '/g.htmlclay' });
    hub.add(other, 0);
    hub.remove(other);

    expect(hub.chans.has(KEY)).toBe(false);
    expect(hub.terminalBytes).toBe(0);
  });

  // The per-file caps bound one channel; a page may send on any registered path on
  // its origin, so a loop over a tree would pin the per-file maximum for every
  // file at once and no per-file limit would ever fire.
  test('terminal retention is bounded per channel (32) and across channels (8 MiB)', () => {
    const big = 'x'.repeat(64 << 10);
    for (let file = 0; file < 40; file += 1) {
      const key = `/f${file}.htmlclay`;
      const sub = fakeSub({ key });
      hub.add(sub, 0);
      for (let req = 0; req < MAX_TERMINALS + 8; req += 1) {
        hub.publish(key, { v: 1, type: 'wire/done', id: `r${req}`, file: key, text: big });
      }
      hub.remove(sub);
    }

    let counted = 0;
    for (const channel of hub.chans.values()) {
      expect(channel.terminal.size).toBeLessThanOrEqual(MAX_TERMINALS);
      for (const terminal of channel.terminal.values()) counted += terminal.frame.length;
    }

    expect(hub.terminalBytes).toBeLessThanOrEqual(GLOBAL_MAX_TERMINAL_BYTES);
    expect(counted).toBe(hub.terminalBytes);
  });

  // A named request cannot ride a raw handler, and the refusal is an outcome like
  // any other: a page that was not watching when it happened still learns of it.
  test('named helper request to a raw handler is refused with helper_protocol_unsupported and retained', () => {
    const handler = fakeSub({ handler: true });
    hub.add(handler, 0);
    const observer = fakeSub();
    const { cursor } = hub.add(observer, 0);

    expect(hub.rejectNamedForRawHandler(KEY, { id: 'r1', helper: 'search' }))
      .toEqual({ rejected: true, observers: 1 });

    expect(handler.offer).not.toHaveBeenCalled();
    const frame = observer.frames[0];
    expect(frame).toContain('"type":"wire/error"');
    expect(frame).toContain('"from":"process"');
    expect(frame).toContain('"helper":"search"');
    expect(frame).toContain('"text":"this handler does not support named helpers"');
    expect(frame).toContain('"payload":{"source":"host","code":"helper_protocol_unsupported"}');

    expect(hub.add(fakeSub(), cursor).replay).toEqual([frame]);

    // Nothing to refuse without a handler, and a jsonl handler speaks the protocol.
    expect(hub.rejectNamedForRawHandler('/g.htmlclay', { id: 'r2' }))
      .toEqual({ rejected: false, observers: 0 });

    hub.add(fakeSub({ key: '/h.htmlclay', handler: true, mode: 'jsonl' }), 0);
    expect(hub.handlerMode('/h.htmlclay')).toBe('jsonl');
    expect(hub.rejectNamedForRawHandler('/h.htmlclay', { id: 'r3', helper: 'search' }))
      .toEqual({ rejected: false, observers: 0 });
  });

  // A handler never receives its own output. Its subscriber queue is there for the
  // requests it exists to answer, and echoing its own frames into it means a helper
  // reporting progress faster than the dispatcher drains the echo is evicted from
  // its own handler slot, taking the request's terminal frame down with it.
  test('a handler never receives its own published frame', () => {
    const handler = fakeSub({ handler: true });
    hub.add(handler, 0);
    const observer = fakeSub();
    hub.add(observer, 0);

    expect(hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r1', file: KEY }, handler))
      .toEqual({ handlers: 0, observers: 1, published: true });
    expect(handler.offer).not.toHaveBeenCalled();
    expect(observer.offer).toHaveBeenCalledTimes(1);

    // Only a subscriber that actually holds the slot publishes through it, and
    // there is nothing to publish into on a file with no channel.
    const stranger = fakeSub();
    expect(hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r2', file: KEY }, stranger))
      .toEqual({ handlers: 0, observers: 0, published: false });
    expect(hub.publish('/untouched.htmlclay', { v: 1, type: 'wire/status', id: 'r3' }))
      .toEqual({ handlers: 0, observers: 0, published: false });
  });

  // wireEnvelope's JSON tags, in order, with Go's omitempty behaviour: v, type, id
  // and file are always present, and nothing else is when it is empty.
  test('envelopeJSON keeps field order and omits empty fields', () => {
    expect(envelopeJSON({ v: 1, type: 'wire/request', id: 'r1', file: KEY }))
      .toBe('{"v":1,"type":"wire/request","id":"r1","file":"/f.htmlclay"}');

    expect(envelopeJSON({
      v: 1,
      type: 'wire/error',
      id: 'r2',
      from: 'process',
      file: KEY,
      helper: 'search',
      document: 'none',
      text: 'working',
      payload: { code: 'x' }
    })).toBe('{"v":1,"type":"wire/error","id":"r2","from":"process","file":"/f.htmlclay",'
      + '"helper":"search","document":"none","text":"working","payload":{"code":"x"}}');

    expect(envelopeJSON({
      v: 1,
      type: 'wire/status',
      id: 'r3',
      from: '',
      file: KEY,
      helper: '',
      document: '',
      text: '',
      payload: undefined
    })).toBe('{"v":1,"type":"wire/status","id":"r3","file":"/f.htmlclay"}');
  });

  test('shutdown stops every subscriber and refuses new ones', () => {
    const handler = fakeSub({ handler: true });
    const observer = fakeSub();
    const other = fakeSub({ key: '/g.htmlclay' });
    hub.add(handler, 0);
    hub.add(observer, 0);
    hub.add(other, 0);

    hub.shutdown();

    expect(handler.stop).toHaveBeenCalledTimes(1);
    expect(observer.stop).toHaveBeenCalledTimes(1);
    expect(other.stop).toHaveBeenCalledTimes(1);
    expect(handler.removed).toBe(true);
    expect(hub.chans.size).toBe(0);
    expect(hub.terminalBytes).toBe(0);

    try {
      hub.add(fakeSub(), 0);
      throw new Error('a subscriber was admitted after shutdown');
    } catch (error) {
      expect(error).toBeInstanceOf(WireError);
      expect(error.code).toBe('closed');
    }
    expect(hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r1', file: KEY }))
      .toEqual({ handlers: 0, observers: 0, published: false });

    // Idempotent, like the Go hub: a second shutdown is not a second teardown.
    hub.shutdown();
    expect(handler.stop).toHaveBeenCalledTimes(1);
  });

  // The eviction rule the hub hands a real stream: a response that is already over,
  // or that has taken more than MAX_BUFFERED bytes without draining, refuses the
  // frame, and refusing is what evicts the subscriber.
  test('createWireSub refuses a frame on a closed or backed-up response', () => {
    const res = { writableEnded: false, writableLength: 0, write: jest.fn(), end: jest.fn() };
    const sub = createWireSub({ key: KEY, handler: false, res });

    expect(sub.offer('frame')).toBe(true);
    expect(res.write).toHaveBeenCalledWith('frame');

    res.writableLength = MAX_BUFFERED + 1;
    expect(sub.offer('frame')).toBe(false);

    res.writableLength = 0;
    sub.stop();
    expect(res.end).toHaveBeenCalledTimes(1);

    res.writableEnded = true;
    expect(sub.offer('frame')).toBe(false);
    sub.stop();
    expect(res.end).toHaveBeenCalledTimes(1);

    const live = { writableEnded: false, writableLength: 0, write: jest.fn(), end: jest.fn() };
    hub.add(createWireSub({ key: KEY, res: live }), 0);
    live.writableLength = MAX_BUFFERED + 1;

    expect(hub.publish(KEY, { v: 1, type: 'wire/status', id: 'r1', file: KEY }))
      .toEqual({ handlers: 0, observers: 0, published: true });
    expect(live.end).toHaveBeenCalledTimes(1);
    expect(hub.chans.has(KEY)).toBe(false);
  });
});
