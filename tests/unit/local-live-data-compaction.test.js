// D13 server compaction in Hyperclay Local, behind a setting that is off by
// default: the state read declares the capability, the room answers the new
// refusal codes, and a compactor's commit reaches an editor through Local's own
// frame path. The real room core, authority and handlers are used, with the
// express app and loopback listener every other local-live-data test uses.
// Finally the clayjs conformance fixture runs over a Local host adapter.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const express = require('express');
const request = require('supertest');
const { createRooms, pageCompactionWorkerUrl } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority, unpackedWorkerUrl } = require('../../src/main/local-authority');
const { createLocalLiveData } = require('../../src/main/local-live-data');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

jest.setTimeout(30000);

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE = fs.readFileSync(path.join(__dirname, '../fixtures/ypage-template.html'), 'utf8');
const SEED = JSON.parse(/<script type="application\/json" merge="page" clay="live">(.*?)<\/script>/.exec(TEMPLATE)[1]).y.seed;
const CANONICAL = '/tmp/compaction-doc.html';
const TARGET_ORIGIN = 'http://127.0.0.1:7000';
const KEY = (n) => `u1a2b3c4d-inst-${n.toString(36)}`;
const set = (n) => ({ op: 'set', path: ['y', KEY(n)], value: SEED });

const waitFor = async (condition) => {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('condition was never met');
};

let server;
let origin;
let open;

async function start({ pageCompaction, compaction = null } = {}) {
  const state = { now: 1000, epoch: 0, id: 0 };
  const rooms = createRooms({
    now: () => state.now,
    newEpoch: () => `e${++state.epoch}`,
    ...(compaction ? { compaction } : {}),
  });
  const authority = createLocalAuthority({
    rooms,
    withDocument: async (resolve, fn) => fn(await resolve()),
    readSaved: async () => TEMPLATE,
    now: () => state.now,
    newId: () => `id${++state.id}`,
    pageCompaction,
  });
  const target = authority.bindTarget({ rootId: 'root', logicalPath: 'doc.html', canonicalPath: CANONICAL, origin: TARGET_ORIGIN, live: true });
  const handlers = createLocalLiveData({ authority, resolveTarget: async () => target });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.post('/_/sync/data', (req, res) => handlers.post(req, res));
  app.get('/_/sync/data', (req, res) => handlers.state(req, res));
  server = await listenLoopback(app);
  origin = `http://127.0.0.1:${server.address().port}`;

  const room = await authority.roomFor(target, async () => target);
  const tabA = { clientId: 'tabA', events: [] };
  const member = authority.registerEditor(target, { clientId: tabA.clientId, send: (name, payload) => tabA.events.push({ name, payload }) });
  const body = (n) => ({ conn: member.conn, name: 'page', n: n + 1, epoch: room.epoch, compaction: 1, pageGeneration: room.pageTransition?.id ?? null, ops: [set(n)] });
  const post = (n, { clientId = 'tabA' } = {}) => request(server).post('/_/sync/data')
    .set('Origin', origin).set('Sec-Fetch-Site', 'same-origin')
    .query({ 'client-id': clientId })
    .send(body(n));
  const readState = ({ compaction: capable = null, clientId = 'tabA' } = {}) => {
    const query = { 'client-id': clientId };
    if (capable !== null) query.compaction = capable;
    return request(server).get('/_/sync/data').query(query).set('Origin', origin).set('Sec-Fetch-Site', 'same-origin');
  };
  open = { state, rooms, authority, target, room, tabA, member, post, readState };
  return open;
}

afterEach(async () => {
  if (open) open.authority.close();
  open = null;
  await closeLoopback();
});

describe('page compaction behind the setting', () => {
  test('off: the state carries no compaction descriptor and a frame is admitted as before', async () => {
    const h = await start({ pageCompaction: false });
    expect(h.authority.compactor).toBeNull();

    const state = await h.readState({ compaction: 1 });
    expect(state.status).toBe(200);
    expect(state.body.stores.page.value.y.seed).toBe(SEED);
    expect(state.body.stores.page.compaction).toBeUndefined();

    const admitted = await h.post(1);
    expect(admitted.status).toBe(200);
    expect(admitted.body).toEqual({ seq: 1, epoch: 'e1', receiptGeneration: 0 });
    expect(h.tabA.events.map((event) => event.name)).toEqual(['data', 'data-writer']);
  });

  test('on: an apply over the loose bound answers 503 checkpoint-required', async () => {
    const h = await start({ pageCompaction: true, compaction: { loose: 2, soft: 16 } });
    expect(h.authority.compactor).not.toBeNull();

    expect((await h.post(0)).status).toBe(200);
    expect((await h.post(1)).status).toBe(200);
    const refused = await h.post(2);

    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('checkpoint-required');
  });

  test('on: a compactor commit reaches an editor as a data frame, and page-full answers 409', async () => {
    const h = await start({ pageCompaction: true, compaction: { activeBytes: 200, tailFloor: 64 } });

    const first = await h.post(0);
    expect(first.status).toBe(503);
    expect(first.body.code).toBe('checkpoint-required');

    await waitFor(() => h.tabA.events.some((event) => event.name === 'data' && event.payload.from === 'compactor'));
    const frame = h.tabA.events.find((event) => event.name === 'data' && event.payload.from === 'compactor').payload;
    expect(frame).toMatchObject({ epoch: 'e1', name: 'page', from: 'compactor', n: 0 });
    expect(frame.seq).toBe(1);
    expect(frame.ops.some((op) => op.op === 'set' && /^c[0-9a-z]{8}-/.test(op.path[1]))).toBe(true);
    expect(frame.receiptGeneration).toBe(0);

    const full = await h.post(1);
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('page-full');
  });

  test('on: a state read without compaction=1 hides the page store', async () => {
    const h = await start({ pageCompaction: true, compaction: {} });

    const old = await h.readState();
    expect(old.status).toBe(200);
    expect(old.body.stores.page).toBeUndefined();

    const capable = await h.readState({ compaction: 1 });
    expect(capable.body.stores.page.value.y.seed).toBe(SEED);
    expect(capable.body.stores.page.compaction).toMatchObject({ v: 1 });
  });
});

describe('the packaged worker path', () => {
  test('resolves from the installed package and rewrites an app.asar path', () => {
    const worker = require.resolve('@panphora/clayjs/dist/server/page-compaction-worker.cjs');
    expect(fs.existsSync(worker)).toBe(true);
    expect(fileURLToPath(pageCompactionWorkerUrl())).toBe(worker);

    expect(unpackedWorkerUrl(worker).href).toBe(pathToFileURL(worker).href);

    const packed = path.join('/Applications/Hyperclay Local.app/Contents/Resources/app.asar',
      'node_modules/@panphora/clayjs/dist/server/page-compaction-worker.cjs');
    const unpacked = unpackedWorkerUrl(packed).href;
    expect(unpacked).toContain('app.asar.unpacked/node_modules/@panphora/clayjs/dist/server/page-compaction-worker.cjs');
    expect(unpacked).not.toContain('app.asar/');
  });
});

describe('the D13 conformance fixture over a Local host', () => {
  test('seeds 1 to 3 admit, compact and merge legacy edits', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tests/helpers/local-page-room-conformance.mjs'), '1', '3', '300', '3'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
    const line = out.split('\n').find((entry) => entry.startsWith('CONFORMANCE '));
    expect(line).toBeDefined();
    const runs = JSON.parse(line.slice('CONFORMANCE '.length));

    expect(runs.map((run) => run.seed)).toEqual([1, 2, 3]);
    for (const run of runs) {
      expect(run.admitted).toBeGreaterThan(0);
      expect(run.full).toBeGreaterThan(0);
      expect(run.legacyMerged).toBeGreaterThan(0);
      expect(run.broadcasts).toBeGreaterThan(0);
    }
  });
});
