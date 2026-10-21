// The real Local HTTP surface for the live lane: the marked `/_/sync/data` POST
// and GET, and the direct `/live-sync/stream` + `/_/sync?document-url=` stream
// once a room registry exists. Every request goes over a real loopback listener
// to a real createApp serving real tiny documents, so what is asserted is the
// bytes and statuses a client sees -- SSE frames parsed out of the actual
// stream, not a mock.
//
// The authority is the caller's: its withDocument chain, clock and readSaved are
// the test's, which is what makes the cold-read, held-warm-room and rate
// schedules deterministic.

const http = require('http');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createRooms } = require('@panphora/clayjs/server/rooms');
const { liveSync } = require('livesync-hyperclay');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createApp, boundedWriter, handleAuthorityLiveStream } = require('../../src/main/server');
const { startLiveDataFixture } = require('../helpers/local-live-data');
const { createRootLive } = require('../../src/main/utils/root-live');
const { withStructureChange } = require('../../src/main/utils/write-queue');
const { EventEmitter } = require('events');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { servedDocumentEtag, withoutInjectedDocumentEtag } = require('../helpers/served-metadata');

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

// A real SSE client on its own socket. `read: false` leaves the response
// unread, which is how a stream that stopped reading is modelled.
function openStream(origin, target, { read = true } = {}) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: SAME_ORIGIN,
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
      if (read) {
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
      }
      resolve(stream);
    });
    req.on('error', () => {});
  });
}

const documentUrl = (fixture) => `${fixture.origin}/${FILE}`;

const streamTarget = (fixture, { clientId, lane = 'live' } = {}) => {
  const params = [`document-url=${encodeURIComponent(documentUrl(fixture))}`, `lane=${lane}`];
  if (clientId) params.push(`client-id=${encodeURIComponent(clientId)}`);
  return `/_/sync?${params.join('&')}`;
};

const openLive = (fixture, clientId, lane = 'live') => openStream(fixture.origin, streamTarget(fixture, { clientId, lane }));

const postFrame = (fixture, { clientId = 'cA', body, headers = {} } = {}) => request(fixture.origin, {
  method: 'POST',
  target: `/_/sync/data${clientId === null ? '' : `?client-id=${encodeURIComponent(clientId)}`}`,
  headers: {
    Origin: fixture.origin,
    'Content-Type': 'application/json',
    'Document-URL': documentUrl(fixture),
    ...SAME_ORIGIN,
    ...headers,
  },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const getState = (fixture, { clientId, since, headers = {} } = {}) => {
  const params = [];
  if (clientId) params.push(`client-id=${encodeURIComponent(clientId)}`);
  if (since) params.push(`since=${encodeURIComponent(since)}`);
  return request(fixture.origin, {
    target: `/_/sync/data${params.length ? `?${params.join('&')}` : ''}`,
    headers: { 'Document-URL': documentUrl(fixture), ...SAME_ORIGIN, ...headers },
  });
};

const frame = (conn, n) => ({ name: 'store', n, ops: [ADD], conn });

// Deterministic epochs and a clock the test moves by hand. readSaved reads the
// real file, so the room is opened from the document on disk; the withDocument
// chain is one serialized queue the test can hold open to model a disk write in
// flight, and readSaved can be held to model a slow read.
function harness() {
  const state = { now: 1000, epoch: 0, id: 0, reads: 0, documents: 0, hold: null, readHold: null };
  const leaves = [];
  const core = createRooms({ now: () => state.now, newEpoch: () => `e${++state.epoch}` });
  const rooms = {
    ...core,
    leave(room, clientId, remaining) {
      leaves.push({ key: room.key, clientId, remaining: [...remaining] });
      return core.leave(room, clientId, remaining);
    },
  };
  let chain = Promise.resolve();
  const withDocument = (resolve, fn) => {
    state.documents += 1;
    chain = chain.catch(() => {}).then(async () => {
      const target = typeof resolve === 'function' ? await resolve() : resolve;
      if (state.hold) await state.hold;
      return fn(target);
    });
    return chain;
  };
  const authority = createLocalAuthority({
    rooms,
    withDocument,
    readSaved: async (target) => {
      state.reads += 1;
      if (state.readHold) await state.readHold;
      return fs.readFile(target.canonicalPath, 'utf8');
    },
    now: () => state.now,
    newId: () => `id${++state.id}`,
  });
  return {
    state,
    core,
    rooms,
    authority,
    leaves,
    holdBoundary: (promise) => { state.hold = promise; },
    releaseBoundary: () => { state.hold = null; },
    holdRead: (promise) => { state.readHold = promise; },
    releaseRead: () => { state.readHold = null; },
  };
}

let dir;
let fixtures;
let aliases;
let streams;

const fixtureFor = async (h, { rootId = 'fixture', rootDir = dir } = {}) => {
  const fixture = await startLiveDataFixture({ authority: h.authority, rootDir, rootId });
  fixtures.push(fixture);
  return fixture;
};

const open = async (fixture, clientId, lane = 'live') => {
  const stream = await openLive(fixture, clientId, lane);
  streams.push(stream);
  return stream;
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'live-data-routes-')));
  await fs.writeFile(path.join(dir, FILE), DOC(0));
  fixtures = [];
  aliases = [];
  streams = [];
});

afterEach(async () => {
  for (const stream of streams) stream.close();
  streams = [];
  for (const fixture of fixtures) await fixture.close();
  fixtures = [];
  for (const alias of aliases) await fs.rm(alias, { force: true });
  aliases = [];
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the marked data lane', () => {
  test('two live editors get distinct proofs and separate receipts; a duplicate applies nothing', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);

    const a = await open(fixture, 'cA');
    const b = await open(fixture, 'cB');
    const viewer = await open(fixture, 'cView', 'saved');

    await waitFor(() => a.raw.includes(': connected\n\n') && b.raw.includes(': connected\n\n'), 'both streams to connect');
    // The replay and cursor bytes are the ones the legacy lane writes.
    expect(a.raw.startsWith('event: cursor\nid: ')).toBe(true);
    expect(named(a, 'cursor')[0].payload).toEqual({ seq: Number(named(a, 'cursor')[0].id) });

    const stateA = await getState(fixture, { clientId: 'cA' });
    const stateB = await getState(fixture, { clientId: 'cB' });
    expect(stateA.status).toBe(200);
    expect(stateA.headers['cache-control']).toBe('no-store');
    expect(typeof stateA.json.conn).toBe('string');
    expect(stateA.json.conn.length).toBeGreaterThan(0);
    expect(stateB.json.conn).not.toBe(stateA.json.conn);
    expect(stateA.json.seq).toBe(0);
    expect(stateA.json.epoch).toBe('e1');
    expect(h.authority.connectedIds(canonical)).toEqual(['cA', 'cB']);

    const first = await postFrame(fixture, { clientId: 'cA', body: frame(stateA.json.conn, 1) });
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ seq: 1, epoch: 'e1', receiptGeneration: 0 });

    await waitFor(() => named(a, 'data').length === 1 && named(b, 'data').length === 1, 'both editors to see the frame');
    expect(named(a, 'data')[0].id).toBe('');
    expect(named(a, 'data')[0].payload).toEqual({
      epoch: 'e1',
      seq: 1,
      name: 'store',
      ops: [ADD],
      from: 'cA',
      n: 1,
      receiptGeneration: 0,
    });
    expect(named(b, 'data')[0].payload).toEqual(named(a, 'data')[0].payload);

    const duplicate = await postFrame(fixture, { clientId: 'cA', body: frame(stateA.json.conn, 1) });
    expect(duplicate.status).toBe(200);
    expect(duplicate.json).toEqual({ duplicate: true, seq: 1, epoch: 'e1' });
    await settle();
    expect(named(a, 'data').length).toBe(1);
    expect(named(b, 'data').length).toBe(1);

    // A whole-value set through the same lane moves the sequence once more.
    const written = await postFrame(fixture, { clientId: 'cB', body: { name: 'store', n: 1, ops: [{ op: 'set', path: ['count'], value: 7 }], conn: stateB.json.conn } });
    expect(written.status).toBe(200);
    expect(written.json.seq).toBe(2);
    await waitFor(() => named(a, 'data').length === 2, 'the set frame');
    expect(named(a, 'data')[1].payload.ops).toEqual([{ op: 'set', path: ['count'], value: 7 }]);

    // Separate receipts: A holds its own, B holds nothing A sent.
    const afterA = await getState(fixture, { clientId: 'cA' });
    const afterB = await getState(fixture, { clientId: 'cB' });
    expect(afterA.json.seq).toBe(2);
    expect(afterA.json.stores.store.seen).toEqual({ cA: 1 });
    expect(afterB.json.stores.store.seen).toEqual({ cB: 1 });
    expect(afterA.json.stores.store.value).toEqual({ count: 7 });

    // Per-member state rides the same stream, each with its own receipt.
    expect(h.authority.publishState(canonical)).toBe(2);
    await waitFor(() => named(a, 'data-state').length === 1 && named(b, 'data-state').length === 1, 'both state frames');
    expect(named(a, 'data-state')[0].id).toBe('');
    expect(named(a, 'data-state')[0].payload.stores.store.seen).toEqual({ cA: 1 });
    expect(named(b, 'data-state')[0].payload.stores.store.seen).toEqual({ cB: 1 });
    expect(named(a, 'data-writer')[0].id).toBe('');

    // The saved lane is a snapshot subscriber: no named event, no membership.
    expect(named(viewer, 'data')).toEqual([]);
    expect(viewer.headers['content-type']).toContain('text/event-stream');
    expect(h.authority.connectedIds(canonical)).toEqual(['cA', 'cB']);
    expect((await getState(fixture, { clientId: 'cView' })).json.conn).toBeNull();

    liveSync.broadcast(`${fixture.root.id}:${FILE}`, { html: DOC(1), sender: 'file-system' }, { lane: 'saved' });
    await waitFor(() => named(viewer, '').length === 1, 'the saved snapshot');
    expect(named(viewer, '')[0].payload.html).toBe(DOC(1));
    await settle();
    expect(named(viewer, 'data')).toEqual([]);
    expect(named(viewer, 'data-state')).toEqual([]);
    expect(named(a, '')).toEqual([]);
  });

  test('a wrong client id, root, origin or proof is refused and changes nothing', async () => {
    const h = harness();
    const fixture = await fixtureFor(h, { rootId: 'root-a' });
    const other = await fixtureFor(h, { rootId: 'root-b' });
    const canonical = path.join(dir, FILE);

    const a = await open(fixture, 'cA');
    const conn = (await getState(fixture, { clientId: 'cA' })).json.conn;
    const body = frame(conn, 1);

    const wrongId = await postFrame(fixture, { clientId: 'cC', body });
    expect(wrongId.status).toBe(503);
    expect(wrongId.json).toEqual({ msg: "This tab is not on the document's live stream.", msgType: 'error', code: 'not-connected' });
    expect(wrongId.headers['retry-after']).toBe('1');

    const wrongProof = await postFrame(fixture, { clientId: 'cA', body: { ...body, conn: 'id-nope' } });
    expect(wrongProof.status).toBe(503);
    expect(wrongProof.json.code).toBe('not-connected');

    const wrongOrigin = await postFrame(fixture, { clientId: 'cA', body, headers: { Origin: 'http://127.0.0.1:9' } });
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.json.code).toBe('forbidden');

    // The same proof through another logical root is not this root's membership.
    const wrongRoot = await postFrame(other, { clientId: 'cA', body });
    expect(wrongRoot.status).toBe(503);
    expect(wrongRoot.json.code).toBe('not-connected');

    const state = await getState(fixture, { clientId: 'cA' });
    expect(state.json.seq).toBe(0);
    expect(state.json.stores.store.value).toEqual({ count: 0 });
    expect(h.authority.connectedIds(canonical)).toEqual(['cA']);
    await settle();
    expect(named(a, 'data')).toEqual([]);
  });

  test('an aliased root shares one canonical room, and the other root survives a close', async () => {
    const alias = `${dir}-alias`;
    await fs.symlink(dir, alias);
    aliases.push(alias);
    const h = harness();
    const a = await fixtureFor(h, { rootId: 'alias-a' });
    const b = await fixtureFor(h, { rootId: 'alias-b', rootDir: alias });
    const canonical = path.join(dir, FILE);

    const streamA = await open(a, 'cA');
    const streamB = await open(b, 'cB');
    const connA = (await getState(a, { clientId: 'cA' })).json.conn;
    const connB = (await getState(b, { clientId: 'cB' })).json.conn;
    expect(connA).not.toBe(connB);

    const posted = await postFrame(a, { clientId: 'cA', body: frame(connA, 1) });
    expect(posted.status).toBe(200);
    await waitFor(() => named(streamB, 'data').length === 1, 'the aliased root to see the frame');
    expect(named(streamB, 'data')[0].payload.from).toBe('cA');

    const stateB = await getState(b, { clientId: 'cB' });
    expect(stateB.json.epoch).toBe(posted.json.epoch);
    expect(stateB.json.seq).toBe(1);
    expect(stateB.json.stores.store.value).toEqual({ count: 1 });
    expect(h.authority.connectedIds(canonical)).toEqual(['cA', 'cB']);
    // A proof is scoped to its own logical root, path and origin.
    expect((await getState(b, { clientId: 'cA' })).json.conn).toBeNull();

    await a.close();
    expect(h.authority.connectedIds(canonical)).toEqual(['cB']);
    await waitFor(() => named(streamB, 'data-writer').length === 2, 'the writer change');
    expect(named(streamB, 'data-writer').map((ev) => ev.payload)).toEqual([
      { epoch: 'e1', writer: 'cA' },
      { epoch: 'e1', writer: 'cB' },
    ]);

    const second = await postFrame(b, { clientId: 'cB', body: frame(connB, 1) });
    expect(second.status).toBe(200);
    expect(second.json.seq).toBe(2);
    await waitFor(() => named(streamB, 'data').length === 2, 'the surviving root to apply a frame');
    expect((await getState(b, { clientId: 'cB' })).json.stores.store.value).toEqual({ count: 2 });
    expect(named(streamA, 'data').length).toBe(1);

    streamB.close();
    await waitFor(() => h.leaves.length === 2, 'both members to leave');
    expect(h.leaves).toEqual([
      { key: canonical, clientId: 'cA', remaining: ['cB'] },
      { key: canonical, clientId: 'cB', remaining: [] },
    ]);
  });

  test('a frame whose editor left during the cold read is refused with no frame effect', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);

    const a = await open(fixture, 'cA');
    const b = await open(fixture, 'cB');
    const connA = (await getState(fixture, { clientId: 'cA' })).json.conn;
    // The room is dropped so the frame below has to be read cold.
    h.rooms.drop(canonical);
    const readsBefore = h.state.reads;

    const read = deferred();
    h.holdRead(read.promise);
    const posting = postFrame(fixture, { clientId: 'cA', body: frame(connA, 1) });
    await waitFor(() => h.state.reads === readsBefore + 1, 'the cold read to start');
    a.close();
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the editor to leave the stream');
    read.resolve();
    h.releaseRead();

    const refused = await posting;
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe('not-connected');
    expect(refused.headers['retry-after']).toBe('1');
    expect((await getState(fixture, { clientId: 'cB' })).json.seq).toBe(0);
    await settle();
    expect(named(b, 'data')).toEqual([]);

    // A replacement stream: the old proof refuses, the fresh one applies once.
    const fresh = await open(fixture, 'cA');
    const connA2 = (await getState(fixture, { clientId: 'cA' })).json.conn;
    expect(connA2).not.toBe(connA);

    const stale = await postFrame(fixture, { clientId: 'cA', body: frame(connA, 1) });
    expect(stale.status).toBe(503);
    const applied = await postFrame(fixture, { clientId: 'cA', body: frame(connA2, 1) });
    expect(applied.status).toBe(200);
    expect(applied.json.seq).toBe(1);
    await waitFor(() => named(b, 'data').length === 1, 'the replacement frame');
    expect(named(fresh, 'data')[0].payload.seq).toBe(1);
  });

  test('a held persistent reservation answers checkpointing before the disk boundary releases', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);

    const a = await open(fixture, 'cA');
    const conn = (await getState(fixture, { clientId: 'cA' })).json.conn;
    const first = await postFrame(fixture, { clientId: 'cA', body: frame(conn, 1) });
    expect(first.status).toBe(200);
    expect(first.json.seq).toBe(1);

    const target = h.authority.findBoundTarget({ rootId: fixture.root.id, logicalPath: FILE, origin: fixture.origin });
    expect(target.canonicalPath).toBe(canonical);
    const token = h.core.holdPersistent(canonical, { nodeId: target.identity });

    const boundary = deferred();
    h.holdBoundary(boundary.promise);
    const documents = h.state.documents;
    const posting = postFrame(fixture, { clientId: 'cA', body: frame(conn, 2) });
    const refused = await Promise.race([posting, wait(1000).then(() => ({ status: 0, json: null, headers: {} }))]);
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe('checkpointing');
    expect(refused.headers['retry-after']).toBe('1');
    // The warm room never queued behind the held boundary.
    expect(h.state.documents).toBe(documents);

    const state = await getState(fixture, { clientId: 'cA' });
    expect(state.status).toBe(200);
    expect(state.json.seq).toBe(1);
    expect(state.json.stores.store.seen).toEqual({ cA: 1 });
    expect(state.json.stores.store.value).toEqual({ count: 1 });
    await settle();
    expect(named(a, 'data').length).toBe(1);

    h.releaseBoundary();
    h.core.releasePersistent(token);
    const applied = await postFrame(fixture, { clientId: 'cA', body: frame(conn, 2) });
    expect(applied.status).toBe(200);
    expect(applied.json.seq).toBe(2);
    await waitFor(() => named(a, 'data').length === 2, 'the released frame');
    expect(named(a, 'data')[1].payload.seq).toBe(2);
    expect((await getState(fixture, { clientId: 'cA' })).json.stores.store.value).toEqual({ count: 2 });
  });

  test('the body cap, parser order and rate bucket keep the lane its own limits', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);

    const a = await open(fixture, 'cA');
    const conn = (await getState(fixture, { clientId: 'cA' })).json.conn;

    const malformed = await postFrame(fixture, { clientId: 'cA', body: '{ not json' });
    expect(malformed.status).toBe(400);
    expect(malformed.json).toEqual({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });

    const oversized = await postFrame(fixture, {
      clientId: 'cA',
      body: JSON.stringify({ ...frame(conn, 1), pad: 'x'.repeat(70 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.json).toEqual({ msg: 'Live update refused: too-large.', msgType: 'error', code: 'too-large' });

    // The legacy lane keeps its own 10 MB limit: the same size parses there.
    const legacy = await request(fixture.origin, {
      method: 'POST',
      target: '/sync',
      headers: { Origin: fixture.origin, 'Content-Type': 'application/json', ...SAME_ORIGIN },
      body: JSON.stringify({ sender: 'cA', snapshot: 'x'.repeat(70 * 1024) }),
    });
    expect(legacy.status).toBe(400);
    expect(legacy.json.error).toBe('Document-URL header is required');

    // Errors changed no room state.
    expect((await getState(fixture, { clientId: 'cA' })).json.seq).toBe(0);

    // 40 accepted frames drain the burst; the next one is refused.
    for (let i = 0; i < 40; i += 1) {
      const accepted = await postFrame(fixture, { clientId: 'cA', body: frame(conn, 1) });
      expect(accepted.status).toBe(200);
    }
    expect((await getState(fixture, { clientId: 'cA' })).json.stores.store.value).toEqual({ count: 1 });

    const drained = await postFrame(fixture, { clientId: 'cA', body: frame(conn, 1) });
    expect(drained.status).toBe(429);
    expect(drained.json).toEqual({ msg: 'Too many live updates. Slow down.', msgType: 'error', code: 'rate-limited' });
    expect(drained.headers['retry-after']).toBe('1');

    // A second valid client on the same document shares the same bucket.
    await open(fixture, 'cB');
    const connB = (await getState(fixture, { clientId: 'cB' })).json.conn;
    const shared = await postFrame(fixture, { clientId: 'cB', body: frame(connB, 1) });
    expect(shared.status).toBe(429);

    // The clock replenishes the bucket.
    h.state.now += 2000;
    const replenished = await postFrame(fixture, { clientId: 'cA', body: frame(conn, 1) });
    expect(replenished.status).toBe(200);
    expect(replenished.json).toEqual({ duplicate: true, seq: 1, epoch: 'e1' });
    expect(named(a, 'data').length).toBe(1);
  });

  test('a marked data request needs the Document-URL header, not just the query', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const named = encodeURIComponent(documentUrl(fixture));

    // The query spelling is the stream route's, not the data lane's. Without the
    // header there is no document to resolve, and that refusal comes before the
    // origin, client-id and body checks, so no room state can be touched.
    const posted = await request(fixture.origin, {
      method: 'POST',
      target: `/_/sync/data?document-url=${named}&client-id=cA`,
      headers: { Origin: fixture.origin, 'Content-Type': 'application/json', ...SAME_ORIGIN },
      body: JSON.stringify(frame('unproven', 1)),
    });
    expect(posted.status).toBe(400);
    expect(posted.json).toEqual({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });

    const state = await request(fixture.origin, {
      target: `/_/sync/data?document-url=${named}&client-id=cA`,
      headers: SAME_ORIGIN,
    });
    expect(state.status).toBe(400);
    expect(state.json).toEqual({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });

    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.state.reads).toBe(0);

    // The same request with the header is served: what was refused is the missing
    // header, not the request.
    const withHeader = await getState(fixture, { clientId: 'cA' });
    expect(withHeader.status).toBe(200);
    expect(withHeader.json.epoch).toBe('e1');
    expect(withHeader.json.conn).toBeNull();
    expect(h.state.reads).toBe(1);
  });
});

describe('the direct stream with a registry', () => {
  // A response the real handler drives by hand, so a refusal can be asserted on
  // before anything reaches a socket.
  const streamResponse = () => {
    const listeners = new Map();
    const res = {
      statusCode: null,
      body: null,
      contentType: null,
      headerNames: [],
      flushed: 0,
      writes: 0,
      setHeader(name) { res.headerNames.push(name); },
      flushHeaders() { res.flushed += 1; },
      status(code) { res.statusCode = code; return res; },
      type(value) { res.contentType = value; return res; },
      send(value) { res.body = value; return res; },
      destroy() {},
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      removeListener(event, fn) { listeners.get(event)?.delete(fn); },
      write() { res.writes += 1; return true; },
    };
    return res;
  };

  test('a target that goes stale while it resolves is refused before headers and registers nothing', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;
    const location = { rootId: fixture.root.id, logicalPath: FILE, canonicalPath: canonical };
    const target = h.authority.bindTarget({ ...location, origin: fixture.origin, live: null });

    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false }));
    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: true }));
    expect(h.authority.isCurrentTarget(target)).toBe(false);

    const req = Object.assign(new EventEmitter(), { query: { 'client-id': 'cA' }, headers: {} });
    const res = streamResponse();
    const ctx = { root: fixture.root, live: createRootLive(fixture.root), localAuthority: h.authority };
    await handleAuthorityLiveStream(ctx, req, res, { file: FILE, lane: 'live', resolveTarget: async () => target });

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('File not found');
    expect(res.contentType).toBe('text/plain');
    expect(res.headerNames).toEqual([]);
    expect(res.flushed).toBe(0);
    expect(res.writes).toBe(0);
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
  });

  test('a malformed client id is refused before any header or registration', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);

    const bad = await request(fixture.origin, {
      target: `${streamTarget(fixture, {})}&client-id=not%20valid`,
      headers: SAME_ORIGIN,
    });
    expect(bad.status).toBe(400);
    expect(bad.headers['content-type']).toContain('text/plain');
    expect(bad.headers['content-type']).not.toContain('event-stream');
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
  });

  test('an anonymous live stream is the legacy barrier; a viewer never blocks; state clears participation', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;

    // A saved viewer alone registers a snapshot and no membership.
    const viewer = await open(fixture, 'cView', 'saved');
    await waitFor(() => [...liveSync.subscribers(key)].length === 1, 'the viewer subscription');
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    viewer.close();
    await waitFor(() => [...liveSync.subscribers(key)].length === 0, 'the viewer to leave');

    // An anonymous live stream is an old editor that has not joined server data.
    const legacy = await open(fixture, null);
    await waitFor(() => h.authority.hasUnjoinedEditors(canonical), 'the anonymous live barrier');
    expect(h.authority.connectedIds(canonical)).toEqual([]);

    // An identified but unread editor is also unjoined, until its own state read.
    const editor = await open(fixture, 'cX');
    const conn = (await getState(fixture, { clientId: 'cX' })).json.conn;
    expect(typeof conn).toBe('string');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(true);

    legacy.close();
    await waitFor(() => [...liveSync.subscribers(key)].length === 1, 'the anonymous stream to leave');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);

    const second = await open(fixture, 'cY');
    await waitFor(() => h.authority.connectedIds(canonical).length === 2, 'the second editor to join');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(true);
    second.close();
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the second editor to leave');
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
  });

  test('a response that stops reading is dropped by the production writer', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;

    const stream = await openStream(fixture.origin, streamTarget(fixture, { clientId: 'cA' }), { read: false });
    streams.push(stream);
    await waitFor(() => h.authority.connectedIds(canonical).length === 1, 'the editor to join');
    expect([...liveSync.subscribers(key)].length).toBe(1);

    const payload = { blob: 'x'.repeat(64 * 1024) };
    for (let i = 0; i < 300 && h.authority.connectedIds(canonical).length > 0; i += 1) {
      h.authority.publish(canonical, 'data', payload);
    }

    // One teardown: the membership and the snapshot subscription are gone.
    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
    expect(h.authority.publish(canonical, 'data', payload)).toBe(0);
  });

  test('stopping a root unregisters its registrations, and a repeat close is harmless', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;

    await open(fixture, 'cA');
    await open(fixture, 'cView', 'saved');
    await waitFor(() => [...liveSync.subscribers(key)].length === 2, 'both subscriptions');
    expect(h.authority.publish(canonical, 'data', { seq: 99 })).toBe(1);

    await fixture.close();
    await fixture.close();

    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    await waitFor(() => [...liveSync.subscribers(key)].length === 0, 'the subscriptions to end');
    expect(h.authority.publish(canonical, 'data', { seq: 100 })).toBe(0);
  });

  test('a replay that drops the writer registers no snapshot and no member', async () => {
    const h = harness();
    const fixture = await fixtureFor(h);
    const canonical = path.join(dir, FILE);
    const key = `${fixture.root.id}:${FILE}`;

    // Frames far larger than the writer's buffer, waiting in the live replay
    // bucket. A connection that resumes there is dropped while it replays and
    // before it subscribes anything, so nothing of it is left in the registry.
    const payload = { html: 'x'.repeat(3 * 1024 * 1024) };
    for (let i = 0; i < 4; i += 1) liveSync.broadcast(key, payload, { lane: 'live' });

    const stream = await openStream(fixture.origin, `${streamTarget(fixture, { clientId: 'cA' })}&lastEventId=1`, { read: false });
    streams.push(stream);
    expect(stream.status).toBe(200);
    await waitFor(() => stream.closed, 'the dropped connection');
    await settle();

    expect(h.authority.connectedIds(canonical)).toEqual([]);
    expect(h.authority.hasUnjoinedEditors(canonical)).toBe(false);
    expect([...liveSync.subscribers(key)].length).toBe(0);
    expect(h.authority.publish(canonical, 'data', { seq: 1 })).toBe(0);
  });
});

describe('boundedWriter', () => {
  const synthetic = (accepted = false) => {
    const listeners = new Map();
    return {
      writes: 0,
      ons: 0,
      removes: 0,
      writableLength: 0,
      on(event, fn) {
        this.ons += 1;
        listeners.set(event, fn);
      },
      removeListener(event, fn) {
        if (listeners.get(event) === fn) {
          listeners.delete(event);
          this.removes += 1;
        }
      },
      write() {
        this.writes += 1;
        return accepted;
      },
      drain() {
        const fn = listeners.get('drain');
        if (fn) fn();
      },
      hasDrain() {
        return listeners.has('drain');
      },
    };
  };

  test('32 refused writes drop the stream once, then it stops writing', () => {
    const res = synthetic();
    const drops = [];
    const writer = boundedWriter(res, () => drops.push(1));
    expect(res.ons).toBe(1);
    expect(res.hasDrain()).toBe(true);

    for (let i = 0; i < 33; i += 1) writer.write(`frame ${i}`);

    expect(res.writes).toBe(33);
    expect(drops).toEqual([1]);
    expect(writer.dropped).toBe(true);
    expect(res.hasDrain()).toBe(false);
    expect(res.removes).toBe(1);

    writer.write('after');
    expect(res.writes).toBe(33);
  });

  test('one drain resets the count', () => {
    const res = synthetic();
    const drops = [];
    const writer = boundedWriter(res, () => drops.push(1));

    for (let i = 0; i < 20; i += 1) writer.write('frame');
    expect(drops).toEqual([]);
    res.drain();
    for (let i = 0; i < 32; i += 1) writer.write('frame');
    expect(drops).toEqual([]);
    expect(res.writes).toBe(52);

    writer.write('frame');
    expect(drops).toEqual([1]);
  });

  test('a reported buffer above 8 MiB drops the stream', () => {
    const res = synthetic(true);
    const drops = [];
    const writer = boundedWriter(res, () => drops.push(1));
    res.writableLength = 8 * 1024 * 1024 + 1;

    writer.write('frame');

    expect(res.writes).toBe(1);
    expect(drops).toEqual([1]);
  });

  test('one writer counts across the cursor, named and snapshot sinks', () => {
    const res = synthetic();
    const drops = [];
    const writer = boundedWriter(res, () => drops.push(1));
    const sinks = [
      (message) => writer.write(message),
      (message) => writer.write(message),
      (message) => writer.write(message),
    ];

    for (let i = 0; i < 33; i += 1) sinks[i % 3](`frame ${i}`);

    expect(res.writes).toBe(33);
    expect(drops).toEqual([1]);
  });
});

describe('an app without a registry', () => {
  test('keeps its document metadata, its legacy stream and no data lane', async () => {
    const html = DOC(0);
    const root = { id: 'legacy', kind: 'personal', path: dir, port: 0 };
    const server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null }));
    root.port = server.address().port;
    const origin = `http://127.0.0.1:${root.port}`;

    const doc = await request(origin, { target: `/${FILE}` });
    expect(doc.status).toBe(200);
    expect(servedDocumentEtag(doc.text)).toBeTruthy();
    expect(withoutInjectedDocumentEtag(doc.text)).toBe(html);

    expect((await request(origin, { target: '/_/sync/data' })).status).toBe(404);
    const posted = await request(origin, {
      method: 'POST',
      target: '/_/sync/data',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(posted.status).toBe(404);

    const stream = await openStream(origin, `/_/sync?document-url=${encodeURIComponent(`${origin}/${FILE}`)}&lane=live&client-id=cA`);
    streams.push(stream);
    expect(stream.status).toBe(200);
    await waitFor(() => stream.raw.includes(': connected\n\n'), 'the legacy connected frame');
    expect(stream.raw.startsWith('event: cursor\nid: ')).toBe(true);
    const cursor = named(stream, 'cursor')[0];
    expect(cursor.id).toBe(String(Number(cursor.id)));
    expect(cursor.payload).toEqual({ seq: Number(cursor.id) });
    await settle();
    expect(named(stream, 'data')).toEqual([]);

    // The same document through a registry-bearing app serves the same bytes.
    const h = harness();
    const fixture = await fixtureFor(h);
    const served = await request(fixture.origin, { target: `/${FILE}` });
    expect(servedDocumentEtag(served.text)).toBe(servedDocumentEtag(doc.text));
    expect(withoutInjectedDocumentEtag(served.text)).toBe(html);
  });
});
