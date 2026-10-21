// The shared v2 stream: one physical connection per origin carrying several
// snapshot subscriptions and one member per live editor, so two editors of one
// document share its snapshot frames and still get separate proofs, separate
// receipts and separate named events.
//
// Every request goes over a real loopback listener to a real createApp serving
// real tiny documents, and every assertion is on the bytes a client sees. The
// authority is the caller's, with a clock and epochs the test sets, so a member's
// proof, its receipts and the room's sequence are all deterministic.

const http = require('http');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { createRooms } = require('@panphora/clayjs/server/rooms');
const { liveSync } = require('livesync-hyperclay');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { handleSharedSyncStreamV2 } = require('../../src/main/server');
const { createRootLive } = require('../../src/main/utils/root-live');
const { startLiveDataFixture } = require('../helpers/local-live-data');

const DOC = (count) => `<!doctype html>\n<html><body><script type="application/json" merge="store" clay="live">{"count":${count}}</script></body></html>\n`;
const ADD = { op: 'add', path: ['count'], n: 1 };
const FILE = 'index.html';
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// A bounded wait, for the assertions that a frame did NOT arrive.
const settle = () => wait(150);

function parseEvent(part) {
  const ev = { name: '', id: '', data: '' };
  for (const line of part.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) ev.name = line.slice(7);
    else if (line.startsWith('id: ')) ev.id = line.slice(4);
    else if (line.startsWith('data: ')) ev.data += (ev.data ? '\n' : '') + line.slice(6);
  }
  if (ev.data === '') return null;
  try {
    ev.payload = JSON.parse(ev.data);
  } catch {
    ev.payload = null;
  }
  return ev;
}

const named = (stream, name) => stream.events.filter((ev) => ev.name === name);

// The frames one member received for one room event: the index on the wire is
// what selects the recipient, so this is the recipient's own view.
const memberEvents = (stream, index, event) => stream.events
  .filter((ev) => ev.name === `m${index}` && ev.payload && ev.payload.event === event);

const parseCursor = (ev) => {
  expect(ev.name).toBe('cursor');
  return ev.payload;
};

// Every frame that carries data carries exactly one event name: a second one
// would make the frame's meaning depend on which line a parser read first.
const dataFrames = (raw) => raw
  .split('\n\n')
  .filter((part) => part.split('\n').some((line) => line.startsWith('data: ')));

const eventNamesOf = (frame) => frame.split('\n').filter((line) => line.startsWith('event: '));

// A real SSE client on its own socket. `read: false` leaves the response unread,
// which is how a connection that stopped reading is modelled.
function openStream(origin, target, headers = SAME_ORIGIN) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    }, (res) => {
      const stream = {
        status: res.statusCode,
        headers: res.headers,
        events: [],
        raw: '',
        closed: false,
        close() { req.destroy(); },
      };
      let buf = '';
      res.on('error', () => {});
      res.on('close', () => { stream.closed = true; });
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        stream.raw += chunk;
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const ev = parseEvent(part);
          if (ev) stream.events.push(ev);
        }
      });
      resolve(stream);
    });
    req.on('error', () => {});
  });
}

function request(origin, { method = 'GET', target, headers = {}, body = null }) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

const enc = (value) => encodeURIComponent(value);
const documentUrl = (fixture, name = FILE) => `${fixture.origin}/${name}`;

// The v2 list form: one `s` per subscription and one `m` per live editor, each
// value encoded whole, exactly as the worker encodes it.
const sharedV2 = (fixture, { s = [], m = [], v = 2, query = '' } = {}) => {
  const params = [];
  if (v !== undefined) params.push(`v=${v}`);
  for (const entry of s) params.push(`s=${enc(entry)}`);
  for (const member of m) params.push(`m=${enc(member)}`);
  return `/_/sync?${params.join('&')}${query}`;
};

const getState = (fixture, clientId) => request(fixture.origin, {
  target: `/_/sync/data?client-id=${enc(clientId)}`,
  headers: { 'Document-URL': documentUrl(fixture), ...SAME_ORIGIN },
});

const postFrame = (fixture, clientId, conn, { n = 1, ops = [ADD] } = {}) => request(fixture.origin, {
  method: 'POST',
  target: `/_/sync/data?client-id=${enc(clientId)}`,
  headers: {
    Origin: fixture.origin,
    'Content-Type': 'application/json',
    'Document-URL': documentUrl(fixture),
    ...SAME_ORIGIN,
  },
  body: JSON.stringify({ name: 'store', n, ops, conn }),
});

// Deterministic epochs and a clock the test moves by hand; readSaved reads the
// real file, so a room is opened from the document on disk.
function harness() {
  const state = { now: 1000, epoch: 0, id: 0 };
  const core = createRooms({ now: () => state.now, newEpoch: () => `e${++state.epoch}` });
  const authority = createLocalAuthority({
    rooms: core,
    withDocument: async (resolve, fn) => fn(await resolve()),
    readSaved: (target) => fs.readFile(target.canonicalPath, 'utf8'),
    now: () => state.now,
    newId: () => `id${++state.id}`,
  });
  return { state, core, authority };
}

// A response the test drives by hand: it records every write, counts its drain
// listeners, and can refuse writes or report a buffered length. The handler it is
// handed to is the real one, so what lands in `frames` is the real wire.
function syntheticResponse({ accepted = false } = {}) {
  const listeners = new Map();
  const res = {
    accepted,
    writes: 0,
    frames: [],
    drains: 0,
    destroys: 0,
    writableLength: 0,
    setHeader() {},
    flushHeaders() {},
    status() { return res; },
    type() { return res; },
    send() { return res; },
    destroy() { res.destroys += 1; },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      if (event === 'drain') res.drains += 1;
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    listenerCount(event) {
      return listeners.get(event)?.size || 0;
    },
    drain() {
      for (const fn of [...(listeners.get('drain') || [])]) fn();
    },
    write(message) {
      res.writes += 1;
      res.frames.push(message);
      return res.accepted;
    },
  };
  return res;
}

const syntheticRequest = (fixture) => {
  const req = new EventEmitter();
  req.headers = { host: `127.0.0.1:${fixture.root.port}`, 'sec-fetch-site': 'same-origin' };
  req.originalUrl = '/_/sync';
  return req;
};

// The authority's own binding, used only where the response is synthetic: the
// writer, not the path resolver, is what those tests exercise.
const bindTargets = (h, fixture, dir) => (req, { href } = {}) => {
  const name = new URL(href).pathname.replace(/^\//, '');
  return h.authority.bindTarget({
    rootId: fixture.root.id,
    logicalPath: name,
    canonicalPath: path.join(dir, name),
    origin: `http://${req.headers.host}`,
    live: null,
  });
};

let dir;
let fixtures;
let streams;
let links;

const fixtureFor = async (h, { rootId = 'shared', rootDir = dir } = {}) => {
  const fixture = await startLiveDataFixture({ authority: h.authority, rootDir, rootId });
  fixtures.push(fixture);
  return fixture;
};

const open = async (fixture, target) => {
  const stream = await openStream(fixture.origin, target);
  streams.push(stream);
  return stream;
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'live-data-shared-')));
  await fs.writeFile(path.join(dir, FILE), DOC(0));
  fixtures = [];
  streams = [];
  links = [];
});

afterEach(async () => {
  for (const stream of streams) stream.close();
  streams = [];
  for (const fixture of fixtures) await fixture.close();
  fixtures = [];
  for (const link of links) await fs.rm(link, { force: true });
  links = [];
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the shared v2 stream', () => {
  test('two editors share one connection with separate proofs, receipts and named events', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-two' });
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const doc = documentUrl(fixture);

    // One frame on each lane, recorded before the connection opens, so a fresh
    // subscription has a real position to be told and an empty replay.
    liveSync.broadcast(key, { html: '<html>live one</html>', sender: 'tab-1' }, { lane: 'live' });
    liveSync.broadcast(key, { html: '<html>saved one</html>', sender: 'server-save' }, { lane: 'saved' });

    const stream = await open(fixture, sharedV2(fixture, {
      s: [`live:0:${doc}`, `saved:0:${doc}`],
      m: [`cA:${doc}`, `cB:${doc}`],
    }));
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    await waitFor(() => stream.events.length >= 4, 'the readiness and cursor frames');

    // Readiness first: one cursor per member, in query order, indexed and with no
    // proof in it -- a conn belongs to the data lane's state read.
    expect(parseCursor(stream.events[0])).toEqual({ v: 2, member: 0 });
    expect(parseCursor(stream.events[1])).toEqual({ v: 2, member: 1 });
    const liveCursor = parseCursor(stream.events[2]);
    expect(liveCursor).toEqual({ v: 2, sub: 0, seq: expect.any(Number) });
    expect(liveCursor.seq).toBeGreaterThan(0);
    expect(parseCursor(stream.events[3])).toEqual({ v: 2, sub: 1, seq: liveCursor.seq });
    expect(stream.events.length).toBe(4);
    expect(stream.raw).not.toContain('conn');

    await waitFor(() => h.authority.connectedIds(canonical).length === 2, 'both members to register');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(true);

    // Each member's proof comes from the data lane, and only the state read that
    // selects a connection marks it joined.
    const connA = (await getState(fixture, 'cA')).json.conn;
    const connB = (await getState(fixture, 'cB')).json.conn;
    expect(typeof connA).toBe('string');
    expect(connB).not.toBe(connA);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);

    const first = await postFrame(fixture, 'cA', connA);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ seq: 1, epoch: 'e1', receiptGeneration: 0 });
    const second = await postFrame(fixture, 'cB', connB);
    expect(second.status).toBe(200);
    expect(second.json.seq).toBe(2);

    // Both members receive the same room frame, each under its own index.
    await waitFor(() => memberEvents(stream, 0, 'data').length === 2 && memberEvents(stream, 1, 'data').length === 2, 'both members to see both frames');
    const dataA = memberEvents(stream, 0, 'data');
    const dataB = memberEvents(stream, 1, 'data');
    expect(dataA[0].payload).toEqual({
      event: 'data',
      data: {
        epoch: 'e1',
        seq: 1,
        name: 'store',
        ops: [ADD],
        from: 'cA',
        n: 1,
        receiptGeneration: 0,
      },
    });
    expect(dataB[0].payload).toEqual(dataA[0].payload);
    expect(dataA[1].payload.data.from).toBe('cB');
    expect(dataA[0].id).toBe('');
    expect(dataB[0].id).toBe('');

    // A writer change is a named event too, and it arrives under the same index.
    // The writer slot is taken once and held until its holder leaves, so the
    // second editor's frame is data and not another writer change.
    await waitFor(() => memberEvents(stream, 0, 'data-writer').length === 1, 'the writer change');
    expect(memberEvents(stream, 0, 'data-writer')[0].payload).toEqual({ event: 'data-writer', data: { epoch: 'e1', writer: 'cA' } });
    expect(memberEvents(stream, 1, 'data-writer')[0].payload).toEqual(memberEvents(stream, 0, 'data-writer')[0].payload);

    // State is built per recipient: the index selects whose receipt arrives.
    expect(h.authority.publishState(canonical)).toBe(2);
    await waitFor(() => memberEvents(stream, 0, 'data-state').length === 1 && memberEvents(stream, 1, 'data-state').length === 1, 'both state frames');
    const stateA = memberEvents(stream, 0, 'data-state')[0].payload;
    const stateB = memberEvents(stream, 1, 'data-state')[0].payload;
    expect(stateA.event).toBe('data-state');
    expect(stateA.data.stores.store.seen).toEqual({ cA: 1 });
    expect(stateB.data.stores.store.seen).toEqual({ cB: 1 });
    expect(stateA.data.seq).toBe(2);

    // A named room event never moves a snapshot position: a fresh subscription is
    // told the same baseline, and replays nothing.
    expect(h.authority.publish(canonical, 'data', { epoch: 'e1', seq: 900, name: 'store', ops: [ADD], from: 'cA', n: 2 })).toBe(2);
    await waitFor(() => memberEvents(stream, 0, 'data').length === 3, 'the named frame');
    expect(memberEvents(stream, 0, 'data')[2].payload.data.seq).toBe(900);
    expect(memberEvents(stream, 1, 'data')[2].payload.data.seq).toBe(900);

    const resumed = await open(fixture, sharedV2(fixture, { s: [`live:0:${doc}`] }));
    await waitFor(() => resumed.events.length >= 1, 'the resumed cursor');
    expect(parseCursor(resumed.events[0])).toEqual({ v: 2, sub: 0, seq: liveCursor.seq });
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(true);
    resumed.close();
    await waitFor(() => !h.authority.hasUnjoinedEditors(canonical), 'the unmatched live marker to close');
    await settle();
    expect(named(resumed, 's0')).toEqual([]);
    expect(named(stream, 's0')).toEqual([]);

    // The snapshot lanes still work, each under its own index.
    liveSync.broadcast(key, { html: '<html>live two</html>', sender: 'tab-1' }, { lane: 'live' });
    liveSync.broadcast(key, { html: '<html>saved two</html>', sender: 'server-save' }, { lane: 'saved' });
    await waitFor(() => named(stream, 's0').length === 1 && named(stream, 's1').length === 1, 'both snapshot lanes');
    expect(named(stream, 's0')[0].data).toContain('live two');
    expect(named(stream, 's1')[0].data).toContain('saved two');

    // Every frame on the wire carries exactly one event name.
    const frames = dataFrames(stream.raw);
    expect(frames.length).toBe(stream.events.length);
    for (const frame of frames) expect(eventNamesOf(frame).length).toBe(1);
  });

  test('a not-found entry keeps the other entries open and registers nothing of its own', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-missing' });
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const doc = documentUrl(fixture);
    const missing = documentUrl(fixture, 'missing.html');

    const stream = await open(fixture, sharedV2(fixture, {
      s: [`live:0:${doc}`, `saved:0:${missing}`, `live:0:${missing}`],
      m: [`cA:${doc}`, `cB:${missing}`],
    }));
    expect(stream.status).toBe(200);
    await waitFor(() => stream.events.length >= 5, 'the readiness and cursor frames');
    expect(parseCursor(stream.events[0])).toEqual({ v: 2, member: 0 });
    expect(parseCursor(stream.events[1])).toEqual({ v: 2, member: 1, error: 'not-found' });
    expect(parseCursor(stream.events[2])).toEqual({ v: 2, sub: 0, seq: expect.any(Number) });
    expect(parseCursor(stream.events[3])).toEqual({ v: 2, sub: 1, error: 'not-found' });
    expect(parseCursor(stream.events[4])).toEqual({ v: 2, sub: 2, error: 'not-found' });
    expect(stream.events.length).toBe(5);

    // One member, one snapshot subscription: the missing entries registered
    // nothing, and the resolved one still carries the room.
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the resolvable member to register');
    expect(h.authority.connectedIds(canonical)).toEqual(['cA']);
    expect([...liveSync.subscribers(key)].length).toBe(1);
    expect(h.authority.publish(canonical, 'data', { seq: 5 })).toBe(1);
    await waitFor(() => memberEvents(stream, 0, 'data').length === 1, 'the surviving member to receive it');
    expect(memberEvents(stream, 0, 'data')[0].payload.data.seq).toBe(5);
    expect(named(stream, 'm1')).toEqual([]);

    liveSync.broadcast(key, { html: '<html>still here</html>', sender: 'tab-1' }, { lane: 'live' });
    await waitFor(() => named(stream, 's0').length === 1, 'the surviving subscription');
    expect(named(stream, 's0')[0].data).toContain('still here');
  });

  test('a saved viewer alone never raises the editor barrier', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-viewer' });
    const canonical = path.join(dir, FILE);
    const doc = documentUrl(fixture);
    const stream = await open(fixture, sharedV2(fixture, { s: [`saved:0:${doc}`] }));
    await waitFor(() => stream.events.length === 1, 'the saved cursor');
    expect(parseCursor(stream.events[0])).toEqual({ v: 2, sub: 0, seq: expect.any(Number) });
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
  });

  test('malformed, duplicate, unmatched and capped requests are refused before any header', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-refusals' });
    const canonical = path.join(dir, FILE);
    const doc = documentUrl(fixture);
    const missing = documentUrl(fixture, 'missing.html');
    const atCap = Array.from({ length: 256 }, () => `live:0:${doc}`);

    const cases = [
      ['no entries at all', '/_/sync?v=2'],
      ['another version', sharedV2(fixture, { v: 3, s: [`live:0:${doc}`] })],
      ['a version that is not a number', sharedV2(fixture, { v: 'two', s: [`live:0:${doc}`] })],
      ['members without v2', `/_/sync?s=${enc(`live:0:${doc}`)}&m=${enc(`cA:${doc}`)}`],
      ['an empty entry', sharedV2(fixture, { s: [''] })],
      ['a bad entry', sharedV2(fixture, { s: [`live:x:${doc}`] })],
      ['an entry with no member list', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA${doc}`] })],
      ['a member with no client id', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`:${doc}`] })],
      ['a malformed client id', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`c A:${doc}`] })],
      ['a duplicate member', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:${doc}`, `cA:${doc}`] })],
      ['a duplicate under another spelling', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:${doc}`, `cA:${fixture.origin}/./${FILE}`] })],
      ['an unmatched member', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:${missing}`] })],
      ['a member on a saved entry', sharedV2(fixture, { s: [`saved:0:${doc}`], m: [`cA:${doc}`] })],
      ['a member on another origin', sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:http://127.0.0.1:1/${FILE}`] })],
      ['one entry too many', sharedV2(fixture, { s: [...atCap, `live:0:${doc}`], m: [`cA:${doc}`] })],
      ['one member too many', sharedV2(fixture, { s: [`live:0:${doc}`], m: Array.from({ length: 257 }, (_, i) => `c${i}:${doc}`) })],
    ];

    for (const [name, target] of cases) {
      const res = await openStream(fixture.origin, target);
      res.close();
      expect(`${name}: ${res.status}`).toBe(`${name}: 400`);
      expect(`${name}: ${res.headers['content-type'] || ''}`).toBe(`${name}: text/plain; charset=utf-8`);
    }

    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(`${fixture.root.id}:${FILE}`)].length).toBe(0);

    // The cap itself is served, with the member that pairs with it.
    const capped = await open(fixture, sharedV2(fixture, { s: atCap, m: [`cA:${doc}`] }));
    expect(capped.status).toBe(200);
    await waitFor(() => capped.events.length >= 257, 'every entry cursor');
    expect(parseCursor(capped.events[0])).toEqual({ v: 2, member: 0 });
    expect(parseCursor(capped.events[1])).toEqual({ v: 2, sub: 0, seq: expect.any(Number) });
    expect(parseCursor(capped.events[256])).toEqual({ v: 2, sub: 255, seq: expect.any(Number) });
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the member at the cap to register');
  });

  test('a connection that closes while its documents are resolving registers nothing', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-closing' });
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const doc = documentUrl(fixture);

    // The real resolver's last step is an fs.stat; holding that open puts the
    // request inside the awaited resolution with its close tracking already
    // installed.
    const gate = deferred();
    const fsp = require('fs').promises;
    const realStat = fsp.stat;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    fsp.stat = async (...args) => {
      entered();
      await gate.promise;
      return realStat(...args);
    };

    try {
      const url = new URL(sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:${doc}`] }), fixture.origin);
      const req = http.get({
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: SAME_ORIGIN,
      });
      req.on('error', () => {});
      await started;
      req.destroy();
      await wait(50);
      gate.resolve();
      await settle();
    } finally {
      fsp.stat = realStat;
    }

    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
  });

  test('origin, host, marker and logical pairing admission', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'shared-admission' });
    const doc = documentUrl(fixture);
    const target = sharedV2(fixture, { s: [`live:0:${doc}`], m: [`cA:${doc}`] });

    for (const [name, headers] of [
      ['no Sec-Fetch-Site', {}],
      ['same-site', { 'Sec-Fetch-Site': 'same-site' }],
      ['a foreign Origin', { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://evil.example' }],
      ['a foreign Host', { ...SAME_ORIGIN, Host: 'evil.example' }],
    ]) {
      const res = await openStream(fixture.origin, target, headers);
      res.close();
      expect(`${name}: ${res.status}`).toBe(`${name}: 403`);
    }

    // A bare `/sync` is a user document's own path, not the marked lane: the v2
    // form belongs to `/_/sync` and nothing else.
    const bare = await openStream(fixture.origin, target.replace('/_/sync?', '/sync?'));
    bare.close();
    expect(bare.status).toBe(400);
    expect(bare.raw).toContain('document-url parameter required');

    // A member pairs with a live entry of the same normalized root/path, never
    // with another spelling of the same canonical file. `alias.html` is a symlink
    // to `index.html`, so the two names share one file and one room.
    await fs.symlink(path.join(dir, FILE), path.join(dir, 'alias.html'));
    links.push(path.join(dir, 'alias.html'));
    const aliased = await fixtureFor(h, { rootId: 'shared-alias' });
    const aliasDoc = documentUrl(aliased);
    const alias = documentUrl(aliased, 'alias.html');

    // Same origin, same canonical file, different logical path: a member pairs
    // with the name it asked for, not with an alias of the same file.
    const unmatched = await openStream(aliased.origin, sharedV2(aliased, {
      s: [`live:0:${aliasDoc}`],
      m: [`cA:${alias}`],
    }));
    unmatched.close();
    expect(unmatched.status).toBe(400);

    // A third entry names the other root's origin: it is not this connection's
    // document, so it gets its own not-found cursor and the others go on.
    const paired = await open(aliased, sharedV2(aliased, {
      s: [`live:0:${aliasDoc}`, `live:0:${alias}`, `live:0:${doc}`],
      m: [`cA:${alias}`],
    }));
    expect(paired.status).toBe(200);
    await waitFor(() => paired.events.length >= 4, 'the readiness and cursor frames');
    expect(parseCursor(paired.events[0])).toEqual({ v: 2, member: 0 });
    expect(parseCursor(paired.events[1])).toEqual({ v: 2, sub: 0, seq: expect.any(Number) });
    expect(parseCursor(paired.events[2])).toEqual({ v: 2, sub: 1, seq: expect.any(Number) });
    expect(parseCursor(paired.events[3])).toEqual({ v: 2, sub: 2, error: 'not-found' });

    // The two names are one canonical file: one room, one member, and the entry
    // no member asked for is the legacy barrier.
    const canonical = path.join(dir, FILE);
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the aliased member to register');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(true);
    expect(h.authority.publish(canonical, 'data', { seq: 7 })).toBe(1);
    await waitFor(() => memberEvents(paired, 0, 'data').length === 1, 'the aliased member to receive it');
    expect(memberEvents(paired, 0, 'data')[0].payload.data.seq).toBe(7);
  });
});

describe('the shared v2 writer', () => {
  const connect = async (h, fixture, res, { s, m }) => {
    const req = syntheticRequest(fixture);
    const ctx = { root: fixture.root, live: createRootLive(fixture.root), localAuthority: h.authority };
    const done = handleSharedSyncStreamV2(ctx, req, res, {
      resolveTarget: bindTargets(h, fixture, dir),
      s,
      m,
      v: '2',
    });
    await done;
    return { req, ctx };
  };

  test('a member resolving to another canonical file gets no proof', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'writer-moved' });
    const doc = documentUrl(fixture);
    const req = syntheticRequest(fixture);
    const res = syntheticResponse({ accepted: true });
    const ctx = { root: fixture.root, live: createRootLive(fixture.root), localAuthority: h.authority };
    const oldPath = path.join(dir, FILE);
    const movedPath = path.join(dir, 'moved.html');
    let calls = 0;
    await handleSharedSyncStreamV2(ctx, req, res, {
      resolveTarget: () => h.authority.bindTarget({
        rootId: fixture.root.id,
        logicalPath: FILE,
        canonicalPath: calls++ === 0 ? oldPath : movedPath,
        origin: fixture.origin,
        live: null,
      }),
      s: [`live:0:${doc}`],
      m: [`cA:${doc}`],
      v: '2',
    });

    expect(res.frames[0]).toBe('event: cursor\ndata: {"v":2,"member":0,"error":"not-found"}\n\n');
    expect(h.authority.connectedIds(oldPath)).toEqual([]);
    expect(h.authority.connectedIds(movedPath)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(oldPath)).toBe(true);
    req.emit('close');
    expect(h.authority.hasUnjoinedEditors(oldPath)).toBe(false);
  });

  test('33 refused writes across cursor, member and snapshot sinks tear the connection down once', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'writer-refused' });
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const doc = `http://127.0.0.1:${fixture.root.port}/${FILE}`;

    // One frame on the live lane so the connection writes through a snapshot sink
    // as well as its cursors and its members.
    liveSync.broadcast(key, { html: '<html>replayed</html>', sender: 'tab-1' }, { lane: 'live' });

    const res = syntheticResponse();
    await connect(h, fixture, res, {
      s: [`live:1:${doc}`, `saved:0:${doc}`],
      m: [`cA:${doc}`, `cB:${doc}`],
    });

    // Two member cursors, one cursor and one replay for the live entry, one
    // cursor for the saved entry.
    expect(res.writes).toBe(5);
    expect(res.destroys).toBe(0);
    expect(h.authority.connectedIds(canonical)).toEqual(['cA', 'cB']);
    expect([...liveSync.subscribers(key)].length).toBe(2);

    for (let i = 0; res.destroys === 0 && i < 100; i += 1) h.authority.publish(canonical, 'data', { seq: i });

    expect(res.writes).toBe(33);
    expect(res.destroys).toBe(1);
    expect(res.drains).toBe(1);
    expect(res.listenerCount('drain')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
    // Nothing retained keeps publishing.
    expect(h.authority.publish(canonical, 'data', { seq: 99 })).toBe(0);
    expect(res.writes).toBe(33);
  });

  test('one drain resets the refusal count', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'writer-drain' });
    const canonical = path.join(dir, FILE);
    const doc = `http://127.0.0.1:${fixture.root.port}/${FILE}`;

    const res = syntheticResponse();
    await connect(h, fixture, res, {
      s: [`live:0:${doc}`, `saved:0:${doc}`],
      m: [`cA:${doc}`, `cB:${doc}`],
    });
    expect(res.writes).toBe(4);

    while (res.writes < 20) h.authority.publish(canonical, 'data', { seq: res.writes });
    expect(res.writes).toBe(20);
    res.drain();
    while (res.writes < 52) h.authority.publish(canonical, 'data', { seq: res.writes });
    expect(res.writes).toBe(52);
    expect(res.destroys).toBe(0);

    for (let i = 0; res.destroys === 0 && i < 100; i += 1) h.authority.publish(canonical, 'data', { seq: res.writes });
    expect(res.writes).toBe(53);
    expect(res.destroys).toBe(1);
    expect(h.authority.connectedIds(canonical)).toEqual([]);
  });

  test('a buffer above 8 MiB drops the connection before it registers anything', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'writer-buffer' });
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const doc = `http://127.0.0.1:${fixture.root.port}/${FILE}`;

    const res = syntheticResponse({ accepted: true });
    res.writableLength = 8 * 1024 * 1024 + 1;
    await connect(h, fixture, res, {
      s: [`live:0:${doc}`, `saved:0:${doc}`],
      m: [`cA:${doc}`, `cB:${doc}`],
    });

    // The first write is refused by the buffer report, and the teardown that
    // follows takes every registration this connection had already made with it.
    expect(res.writes).toBe(1);
    expect(res.destroys).toBe(1);
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
    expect(h.authority.publish(canonical, 'data', { seq: 1 })).toBe(0);
  });
});
