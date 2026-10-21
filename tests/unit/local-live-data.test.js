// The HTTP shape of Local's live lane: POST /_/sync/data applies one frame and
// GET /_/sync/data reads the room's state. The real room core and the accepted
// local-authority are used, with an injected resolver standing in for the
// server's admitted-target lookup. Both handlers are driven through a real
// Express app and a loopback listener, so query/body parsing, headers and
// statuses are the ones a browser would see. No production route is mounted.

const express = require('express');
const request = require('supertest');
const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalLiveData } = require('../../src/main/local-live-data');
const { withStructureChange } = require('../../src/main/utils/write-queue');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const CANONICAL = '/tmp/live-data-doc.html';
const MOVED = '/tmp/live-data-doc-renamed.html';
const TARGET_ORIGIN = 'http://127.0.0.1:7000';
const PAGE = (n) => `<!doctype html><html><body><script type="application/json" merge="count" clay="live">{"n":${n}}</script></body></html>`;
const set = (value) => ({ op: 'set', path: ['n'], value });

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const waitFor = async (condition) => {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await new Promise((done) => setImmediate(done));
  }
  throw new Error('condition was never met');
};

// Deterministic epochs and a clock the test moves by hand; readSaved is served
// from memory; withDocument is one serialized chain the test can hold open to
// model a disk operation in flight.
function harness({ page = PAGE(0) } = {}) {
  const state = { now: 1000, epoch: 0, id: 0, reads: 0, documents: 0, readHold: null };
  const core = createRooms({ now: () => state.now, newEpoch: () => `e${++state.epoch}` });
  let hold = null;
  let chain = Promise.resolve();
  const withDocument = (resolve, fn) => {
    state.documents += 1;
    chain = chain.catch(() => {}).then(async () => {
      const current = typeof resolve === 'function' ? await resolve() : resolve;
      if (hold) await hold;
      return fn(current);
    });
    return chain;
  };
  const authority = createLocalAuthority({
    rooms: core,
    withDocument,
    readSaved: async () => {
      state.reads += 1;
      if (state.readHold) await state.readHold;
      return page;
    },
    now: () => state.now,
    newId: () => `id${++state.id}`,
  });
  const target = authority.bindTarget({
    rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: CANONICAL, origin: TARGET_ORIGIN, live: true,
  });

  let resolved = target;
  let fresh = null;
  let failure = null;
  const resolver = jest.fn((req, opts = {}) => {
    if (failure) throw failure;
    if (opts.fresh && fresh) return Promise.resolve(fresh);
    return opts.fresh ? Promise.resolve(resolved) : resolved;
  });

  return {
    authority,
    core,
    state,
    target,
    resolver,
    setResolved: (value) => { resolved = value; },
    setFresh: (value) => { fresh = value; },
    setFailure: (value) => { failure = value; },
    hold: (promise) => { hold = promise; },
    releaseHold: () => { hold = null; },
    holdRead: (promise) => { state.readHold = promise; },
    releaseRead: () => { state.readHold = null; },
  };
}

let h;
let server;
let origin;
let handlers;

beforeEach(async () => {
  h = harness();
  handlers = createLocalLiveData({ authority: h.authority, resolveTarget: h.resolver });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.post('/_/sync/data', (req, res) => handlers.post(req, res));
  app.get('/_/sync/data', (req, res) => handlers.state(req, res));
  server = await listenLoopback(app);
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  h.releaseHold();
  h.releaseRead();
  await closeLoopback();
});

const join = (clientId, target = h.target) => {
  const events = [];
  const member = h.authority.registerEditor(target, {
    clientId,
    send: (name, payload) => events.push({ name, payload }),
  });
  return { member, events };
};

const postFrame = (body, { clientId = 'cA', headers = {} } = {}) => {
  let req = request(server).post('/_/sync/data').set('Origin', origin).set('Sec-Fetch-Site', 'same-origin');
  if (clientId !== null) req = req.query({ 'client-id': clientId });
  return req.set(headers).send(body);
};

const getState = ({ clientId = null, since = null, headers = {} } = {}) => {
  let req = request(server).get('/_/sync/data');
  const query = {};
  if (clientId !== null) query['client-id'] = clientId;
  if (since !== null) query.since = since;
  if (Object.keys(query).length) req = req.query(query);
  return req.set(headers);
};

test('a first frame opens the room, bumps seq and publishes data plus the writer change', async () => {
  const a = join('cA');
  const b = join('cB');

  const res = await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ seq: 1, epoch: 'e1', receiptGeneration: 0 });
  expect(h.state.reads).toBe(1);
  expect(h.state.documents).toBe(1);
  expect(b.events).toEqual([
    {
      name: 'data',
      payload: { epoch: 'e1', seq: 1, name: 'count', ops: [set(7)], from: 'cA', n: 1, receiptGeneration: 0 },
    },
    { name: 'data-writer', payload: { epoch: 'e1', writer: 'cA' } },
  ]);

  const mine = await getState({ clientId: 'cA' });
  expect(mine.status).toBe(200);
  expect(mine.body.seq).toBe(1);
  expect(mine.body.stores.count.value).toEqual({ n: 7 });
  expect(mine.body.stores.count.seen).toEqual({ cA: 1 });
  expect(mine.body.conn).toBe(a.member.conn);

  const other = await getState({ clientId: 'cB' });
  expect(other.body.stores.count.value).toEqual({ n: 7 });
  expect(other.body.stores.count.seen).toEqual({});
  expect(other.body.conn).toBe(b.member.conn);

  // The second frame keeps the writer, so only `data` is published, and the
  // sequence moves on.
  a.events.length = 0;
  b.events.length = 0;
  const next = await postFrame({ name: 'count', n: 2, conn: b.member.conn, ops: [set(9)] }, { clientId: 'cB' });
  expect(next.body).toEqual({ seq: 2, epoch: 'e1', receiptGeneration: 0 });
  expect(b.events.map((event) => event.name)).toEqual(['data']);
  expect(a.events.map((event) => event.name)).toEqual(['data']);
  expect((await getState({ clientId: 'cB' })).body.stores.count.seen).toEqual({ cB: 2 });
  expect((await getState({ clientId: 'cB' })).body.stores.count.value).toEqual({ n: 9 });
});

test('a duplicate frame is answered with its landed seq and publishes nothing', async () => {
  const a = join('cA');
  const b = join('cB');
  const frame = { name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] };

  await postFrame(frame);
  b.events.length = 0;
  const again = await postFrame(frame);

  expect(again.status).toBe(200);
  expect(again.body).toEqual({ duplicate: true, seq: 1, epoch: 'e1' });
  expect(b.events).toEqual([]);
  expect((await getState()).body.seq).toBe(1);
});

test('a frame from another epoch is stale, changes nothing and publishes nothing', async () => {
  const a = join('cA');
  const b = join('cB');
  await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] });
  b.events.length = 0;

  const stale = await postFrame({ name: 'count', n: 2, conn: a.member.conn, epoch: 'e0', ops: [set(8)] });

  expect(stale.status).toBe(200);
  expect(stale.body).toEqual({ stale: true, epoch: 'e1' });
  expect(b.events).toEqual([]);
  expect((await getState()).body.seq).toBe(1);
  expect((await getState()).body.stores.count.value).toEqual({ n: 7 });
});

test('a frame without a current proof is 503 not-connected and touches no room', async () => {
  const a = join('cA');
  const b = join('cB');

  const wrongConn = await postFrame({ name: 'count', n: 1, conn: 'not-a-conn', ops: [set(1)] });
  expect(wrongConn.status).toBe(503);
  expect(wrongConn.headers['retry-after']).toBe('1');
  expect(wrongConn.body).toEqual({
    msg: "This tab is not on the document's live stream.", msgType: 'error', code: 'not-connected',
  });
  expect(b.events).toEqual([]);
  expect(h.core.get(CANONICAL)).toBeNull();
  expect(h.state.reads).toBe(0);

  // The same conn under another client id, or through another logical root, is
  // not a proof either.
  const wrongClient = await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(1)] }, { clientId: 'cB' });
  expect(wrongClient.body.code).toBe('not-connected');

  h.setResolved(h.authority.bindTarget({
    rootId: 'root-b', logicalPath: '/alias.html', canonicalPath: CANONICAL, origin: TARGET_ORIGIN, live: true,
  }));
  const wrongRoot = await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(1)] });
  expect(wrongRoot.status).toBe(503);
  expect(wrongRoot.body.code).toBe('not-connected');
  expect(h.core.get(CANONICAL)).toBeNull();
});

test('a cross-site, Origin-less or cross-fetch-metadata POST is 403 forbidden', async () => {
  const a = join('cA');
  const frame = { name: 'count', n: 1, conn: a.member.conn, ops: [set(1)] };

  const cross = await request(server).post('/_/sync/data?client-id=cA')
    .set('Origin', 'http://elsewhere.test').set('Sec-Fetch-Site', 'cross-site').send(frame);
  expect(cross.status).toBe(403);
  expect(cross.body).toEqual({ msg: 'Cross-site request blocked', msgType: 'error', code: 'forbidden' });

  const bare = await request(server).post('/_/sync/data?client-id=cA').set('Sec-Fetch-Site', 'cross-site').send(frame);
  expect(bare.status).toBe(403);

  const site = await request(server).post('/_/sync/data?client-id=cA')
    .set('Origin', origin).set('Sec-Fetch-Site', 'same-site').send(frame);
  expect(site.status).toBe(403);

  expect(h.core.get(CANONICAL)).toBeNull();
  expect(h.state.reads).toBe(0);

  // Sec-Fetch-Site absent (older clients) with the root's own Origin is admitted.
  const absent = await request(server).post('/_/sync/data?client-id=cA').set('Origin', origin).send(frame);
  expect(absent.status).toBe(200);
});

test('a malformed client id or body is 400 invalid-request, as JSON even for an HTML Accept', async () => {
  const a = join('cA');
  const frame = { name: 'count', n: 1, conn: a.member.conn, ops: [set(1)] };

  const noId = await postFrame(frame, { clientId: null });
  expect(noId.status).toBe(400);
  expect(noId.body).toEqual({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });

  const badId = await postFrame(frame, { clientId: 'not a client id' });
  expect(badId.status).toBe(400);
  expect(badId.body.code).toBe('invalid-request');

  const repeated = await request(server).post('/_/sync/data?client-id=cA&client-id=cB')
    .set('Origin', origin).send(frame);
  expect(repeated.status).toBe(400);

  const noConn = await postFrame({ name: 'count', n: 1, ops: [set(1)] });
  expect(noConn.status).toBe(400);

  const notAString = await postFrame({ name: 'count', n: 1, conn: 42, ops: [set(1)] });
  expect(notAString.status).toBe(400);

  const html = await request(server).post('/_/sync/data?client-id=cA')
    .set('Origin', origin).set('Accept', 'text/html').send({ name: 'count', n: 1, ops: [set(1)] });
  expect(html.status).toBe(400);
  expect(html.headers['content-type']).toMatch(/application\/json/);
  expect(html.body.msgType).toBe('error');

  expect(h.core.get(CANONICAL)).toBeNull();
  expect(h.state.reads).toBe(0);
});

test('the file plus sender bucket answers 429 after the burst and refills with time', async () => {
  const a = join('cA');
  const b = join('cB');

  for (let n = 1; n <= 40; n += 1) {
    const res = await postFrame({ name: 'count', n, conn: a.member.conn, ops: [set(1)] });
    expect(res.status).toBe(200);
  }

  const over = await postFrame({ name: 'count', n: 41, conn: a.member.conn, ops: [set(1)] });
  expect(over.status).toBe(429);
  expect(over.headers['retry-after']).toBe('1');
  expect(over.body).toEqual({ msg: 'Too many live updates. Slow down.', msgType: 'error', code: 'rate-limited' });

  // A second client id on the same file from the same sender buys no bucket.
  const other = await postFrame({ name: 'count', n: 1, conn: b.member.conn, ops: [set(1)] }, { clientId: 'cB' });
  expect(other.status).toBe(429);

  expect((await getState()).body.seq).toBe(40);

  h.state.now += 1000;
  const refilled = await postFrame({ name: 'count', n: 42, conn: a.member.conn, ops: [set(1)] });
  expect(refilled.status).toBe(200);
  expect(refilled.body.seq).toBe(41);
});

test('a member that disconnects during the cold read is not-connected with no frame effect', async () => {
  const a = join('cA');
  const b = join('cB');
  const gate = deferred();
  h.hold(gate.promise);

  // supertest only writes the request once its then is reached, so the promise
  // is taken here and the read is observed in flight.
  const pending = postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(1)] }).then((res) => res);
  await waitFor(() => h.state.documents === 1);
  a.member.close();
  gate.resolve();
  h.releaseHold();

  const res = await pending;
  expect(res.status).toBe(503);
  expect(res.headers['retry-after']).toBe('1');
  expect(res.body.code).toBe('not-connected');
  expect(b.events).toEqual([]);
  expect(h.core.get(CANONICAL).seq).toBe(0);
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['cB']);
});

test('a held warm room answers checkpointing at once, and state without the disk', async () => {
  const a = join('cA');
  const first = await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] });
  expect(first.body.seq).toBe(1);
  const documentsAfterOpen = h.state.documents;

  const token = h.core.holdPersistent(CANONICAL, { nodeId: h.target.identity });
  const gate = deferred();
  h.hold(gate.promise);

  const read = await getState({ clientId: 'cA' });
  expect(read.status).toBe(200);
  expect(read.body.seq).toBe(1);
  expect(h.state.documents).toBe(documentsAfterOpen);

  const pending = postFrame({ name: 'count', n: 2, conn: a.member.conn, epoch: 'e1', ops: [set(9)] });
  const refused = await pending;
  expect(refused.status).toBe(503);
  expect(refused.headers['retry-after']).toBe('1');
  expect(refused.body).toEqual({
    msg: 'This document is being saved. Try again shortly.', msgType: 'error', code: 'checkpointing',
  });
  expect(a.member.participating).toBe(true);
  expect(h.state.documents).toBe(documentsAfterOpen);
  expect((await getState()).body.seq).toBe(1);
  expect(a.events.filter((event) => event.name === 'data')).toHaveLength(1);

  h.core.releasePersistent(token);
  gate.resolve();
  h.releaseHold();

  const after = await postFrame({ name: 'count', n: 2, conn: a.member.conn, epoch: 'e1', ops: [set(9)] });
  expect(after.status).toBe(200);
  expect(after.body.seq).toBe(2);
  expect(a.events.filter((event) => event.name === 'data')).toHaveLength(2);
  expect((await getState()).body.stores.count.value).toEqual({ n: 9 });
});

test('GET picks the newest current connection, touches the room and gives only it a receipt', async () => {
  const older = join('cA');
  const newer = join('cA');

  const read = await getState({ clientId: 'cA' });
  expect(read.status).toBe(200);
  expect(read.headers['cache-control']).toBe('no-store');
  expect(read.body.conn).toBe(newer.member.conn);
  expect(newer.member.participating).toBe(true);
  expect(older.member.participating).toBe(false);

  // A supplied id with no live membership gets the shared state and no proof.
  const stranger = await getState({ clientId: 'cZ' });
  expect(stranger.body.conn).toBeNull();
  expect(stranger.body.stores.count.seen).toEqual({});

  newer.member.close();
  const left = await getState({ clientId: 'cA' });
  expect(left.body.conn).toBe(older.member.conn);

  older.member.close();
  const gone = await getState({ clientId: 'cA' });
  expect(gone.body.conn).toBeNull();
  expect(gone.body.stores.count.seen).toEqual({});

  // No id at all is allowed: the shared state, no conn.
  const anonymous = await getState();
  expect(anonymous.status).toBe(200);
  expect(anonymous.body.conn).toBeNull();
});

test('GET parses since as an epoch and seq, treats anything else as an initial read', async () => {
  const a = join('cA');
  const b = join('cB');
  await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] });
  await postFrame({ name: 'count', n: 2, conn: b.member.conn, ops: [set(9)] }, { clientId: 'cB' });

  const initial = await getState({ clientId: 'cA' });
  expect(initial.body.moves.count).toHaveLength(2);

  const upToDate = await getState({ clientId: 'cA', since: 'e1:2' });
  expect(upToDate.body.moves.count).toEqual([]);
  expect(upToDate.body.seq).toBe(2);

  const behind = await getState({ clientId: 'cA', since: 'e1:1' });
  expect(behind.body.moves.count).toHaveLength(1);
  expect(behind.body.moves.count[0].seq).toBe(2);

  const otherEpoch = await getState({ clientId: 'cA', since: 'e9:5' });
  expect(otherEpoch.body.moves.count).toHaveLength(2);

  const malformed = await getState({ clientId: 'cA', since: 'nope' });
  expect(malformed.body.moves.count).toHaveLength(2);

  const malformedId = await getState({ clientId: 'has spaces' });
  expect(malformedId.status).toBe(400);
  expect(malformedId.body.code).toBe('invalid-request');
});

test('GET refuses a cross-site fetch and admits one with no Origin', async () => {
  const a = join('cA');
  const frame = { name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] };

  const denied = await getState({ clientId: 'cA', headers: { Origin: 'http://elsewhere.test' } });
  expect(denied.status).toBe(403);
  expect(denied.body).toEqual({ msg: 'Cross-site request blocked', msgType: 'error', code: 'forbidden' });

  const crossSite = await getState({ clientId: 'cA', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  expect(crossSite.status).toBe(403);
  expect(h.state.reads).toBe(0);

  const sameSite = await getState({
    clientId: 'cA', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
  });
  expect(sameSite.status).toBe(200);
  expect((await postFrame(frame)).status).toBe(200);
});

test('core refusals keep their hosted statuses and never move the sequence', async () => {
  const a = join('cA');
  await postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] });

  const unknown = await postFrame({ name: 'nope', n: 2, conn: a.member.conn, ops: [set(7)] });
  expect(unknown.status).toBe(404);
  expect(unknown.body).toEqual({
    msg: 'No store by that name on this document.', msgType: 'error', code: 'unknown-store',
  });

  const badFrame = await postFrame({ name: 'count', n: 0, conn: a.member.conn, ops: [set(7)] });
  expect(badFrame.status).toBe(400);
  expect(badFrame.body.code).toBe('bad-frame');

  const badOp = await postFrame({ name: 'count', n: 3, conn: a.member.conn, ops: [{ op: 'add', path: ['n'], n: 'x' }] });
  expect(badOp.status).toBe(422);
  expect(badOp.body.code).toBe('bad-op');
  expect(badOp.body.msgType).toBe('error');

  expect((await getState()).body.seq).toBe(1);
  expect((await getState()).body.stores.count.value).toEqual({ n: 7 });
});

// The cold read is what makes the room, so a target retired and readmitted while
// that read is in flight is a target the room no longer belongs to.
const staleDuringColdRead = async () => {
  const gate = deferred();
  h.holdRead(gate.promise);
  await waitFor(() => h.state.reads === 1);
  await withStructureChange((token) => h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: 'doc.html', active: false }));
  await withStructureChange((token) => h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: 'doc.html', active: true }));
  expect(h.authority.isCurrentTarget(h.target)).toBe(false);
  gate.resolve();
  h.releaseRead();
};

test('a state read whose target goes stale during the cold open is 404, not the old room', async () => {
  const a = join('cA');
  const pending = getState({ clientId: 'cA' }).then((res) => res);
  await staleDuringColdRead();

  const res = await pending;
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ msg: 'No file here.', msgType: 'error', code: 'not-found' });
  expect(res.body.stores).toBeUndefined();
  expect(res.body.seq).toBeUndefined();
  expect(res.body.conn).toBeUndefined();
  expect(a.events).toEqual([]);
});

test('a frame whose target goes stale during the cold open is 404, not the old 503', async () => {
  const a = join('cA');
  const b = join('cB');
  const pending = postFrame({ name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] }).then((res) => res);
  await staleDuringColdRead();

  const res = await pending;
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ msg: 'No file here.', msgType: 'error', code: 'not-found' });
  expect(b.events).toEqual([]);
  expect(a.events).toEqual([]);
  expect(h.core.get(CANONICAL).seq).toBe(0);
});

test('a missing file is 404, a moved one 404, and an unexpected failure a generic 500', async () => {
  const a = join('cA');
  const frame = { name: 'count', n: 1, conn: a.member.conn, ops: [set(7)] };

  h.setFailure(Object.assign(new Error('ENOENT: no such file, open /tmp/private'), { code: 'ENOENT' }));
  const missing = await postFrame(frame);
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ msg: 'No file here.', msgType: 'error', code: 'not-found' });

  h.setFailure(Object.assign(new Error('consent refused'), { status: 403, code: 'forbidden' }));
  const refused = await getState({ clientId: 'cA' });
  expect(refused.status).toBe(403);
  expect(refused.body.code).toBe('forbidden');

  h.setFailure(Object.assign(new Error('bad document url'), { status: 400 }));
  const bad = await getState();
  expect(bad.status).toBe(400);
  expect(bad.body).toEqual({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });

  h.setFailure(Object.assign(new Error('no file'), { status: 404 }));
  expect((await postFrame(frame)).body.code).toBe('not-found');

  h.setFailure(new Error(`boom at ${CANONICAL}`));
  const unexpected = await postFrame(frame);
  expect(unexpected.status).toBe(500);
  expect(unexpected.body).toEqual({ msg: 'Live data failed.', msgType: 'error', code: 'internal-error' });
  expect(unexpected.text).not.toContain(CANONICAL);
  expect(unexpected.text).not.toContain('boom');

  h.setFailure(null);
  h.setFresh(h.authority.bindTarget({
    rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: MOVED, origin: TARGET_ORIGIN, live: true,
  }));
  const moved = await postFrame(frame);
  expect(moved.status).toBe(404);
  expect(moved.body).toEqual({ msg: 'No file here.', msgType: 'error', code: 'not-found' });
  expect(h.core.get(CANONICAL)).toBeNull();
  expect(h.core.get(MOVED)).toBeNull();
});
