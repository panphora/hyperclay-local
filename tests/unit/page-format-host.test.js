// Document 11 Step 6b: the page format floor is enforced at every write boundary.
// A document's floor is the `<meta name="clay-page-format">` marker (absent is 0,
// a floor only rises), and every page write declares what it can read in
// `X-Clay-Page-Format`. Each path below shows an accepted current-capability write
// and a refused legacy one against the same fixture, with the file and its page
// state sidecar untouched by the refusal.

jest.mock('../../src/main/data-loss-guard', () => ({
  ...jest.requireActual('../../src/main/data-loss-guard'),
  runDataLossGuard: jest.fn().mockResolvedValue(null)
}));

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('upath');
const os = require('os');
const { execFileSync } = require('child_process');
const request = require('supertest');

const { createRooms, splitPage } = require('@panphora/clayjs/server/rooms');
const { createApp, pageFormatSupported } = require('../../src/main/server.js');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { RootObserver } = require('../../src/main/root-observer');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { readPageState } = require('../../src/main/page-state-store');
const { documentEtag } = require('../../src/main/spec-wire');
const { pageFixture } = require('../helpers/page-fixture');

const PAGE = pageFixture();
const MARKER = '<meta name="clay-page-format" content="1">';
const FLOOR1 = PAGE.html.replace('<head>', `<head>${MARKER}`);
const NAME = 'page.html';
const STORE_NAME = 'store.html';
const STORE_DOC = `<!doctype html>\n<html><head>${MARKER}</head><body><script type="application/json" merge="store" clay="live">{"count":0}</script></body></html>\n`;
const UPGRADE = 'page-format-upgrade-required';

describe('the page format floor at every write boundary', () => {
  let dir;
  let authority;
  let observer;
  let live;
  let server;
  let apps;

  const filePath = (name = NAME) => path.join(dir, name);
  const onDisk = (name = NAME) => fs.readFile(filePath(name), 'utf8');
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const documentUrl = (name = NAME) => `${origin()}/${name}`;

  const startApp = async () => {
    const core = createRooms({});
    authority = createLocalAuthority({ rooms: core, withDocument: withDocumentWrite });
    const root = { id: `page-format-root-${apps.length}`, kind: 'personal', path: dir, port: 0 };
    live = createRootLive(root);
    observer = new RootObserver(root, { live, localAuthority: authority });
    server = await listenLoopback(createApp({
      root, live, observer, localAuthority: authority, devHooks: null, isKnownPath: null
    }));
    apps.push({ observer, root });
    return root;
  };

  const save = (html, headers = {}, name = NAME) => {
    const req = request(server)
      .post('/save')
      .set('Document-URL', documentUrl(name))
      .set('Content-Type', 'text/plain');
    for (const [key, value] of Object.entries(headers)) req.set(key, value);
    return req.send(html);
  };

  const getState = (headers = {}, name = NAME, clientId = null) => {
    const query = clientId ? `?client-id=${encodeURIComponent(clientId)}` : '';
    const req = request(server).get(`/_/sync/data${query}`).set('Document-URL', documentUrl(name));
    for (const [key, value] of Object.entries(headers)) req.set(key, value);
    return req;
  };

  const bindEditor = (clientId, name = NAME) => {
    const target = authority.bindTarget({
      rootId: apps[apps.length - 1].root.id, logicalPath: name, canonicalPath: filePath(name), origin: origin(), live: true,
    });
    const member = authority.registerEditor(target, { clientId, send: () => {} });
    return { target, member };
  };

  beforeEach(async () => {
    dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'page-format-host-'))));
    apps = [];
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    for (const app of apps) await app.observer.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('a save without capability is refused on a floor-1 document', async () => {
    await fs.writeFile(filePath(), FLOOR1);
    await startApp();

    const before = await onDisk();
    const beforeState = await readPageState(dir, NAME);
    const refused = await save(FLOOR1.replace(MARKER, ''));

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(UPGRADE);
    expect(refused.body.minimum).toBe(1);
    expect(await onDisk()).toBe(before);
    expect(await readPageState(dir, NAME)).toEqual(beforeState);

    const accepted = await save(FLOOR1.replace(MARKER, ''), { 'X-Clay-Page-Format': '1' });

    expect(accepted.status).toBe(200);
    expect(await onDisk()).toContain(MARKER);
  });

  test('a save activates the floor', async () => {
    await fs.writeFile(filePath(), PAGE.html);
    await startApp();

    const activated = await save(FLOOR1, { 'X-Clay-Page-Format': '1' });

    expect(activated.status).toBe(200);
    expect(await onDisk()).toContain(MARKER);

    const before = await onDisk();
    const beforeState = await readPageState(dir, NAME);
    const refused = await save(FLOOR1);

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(UPGRADE);
    expect(await onDisk()).toBe(before);
    expect(await readPageState(dir, NAME)).toEqual(beforeState);
  });

  test('a floor-0 document is unchanged', async () => {
    await fs.writeFile(filePath(), PAGE.html);
    await startApp();

    const res = await save(PAGE.html);

    expect(res.status).toBe(200);
    const stored = await onDisk();
    expect(stored).not.toContain('clay-page-format');
    expect(stored).toBe(splitPage(PAGE.html).file);
  });

  test('an undecodable page capture is refused and nothing changes', async () => {
    await fs.writeFile(filePath(), STORE_DOC.replace(MARKER, ''));
    await startApp();

    const before = await onDisk();
    const beforeState = await readPageState(dir, NAME);
    const synthetic = `<!DOCTYPE html><html><body><script type="application/json" merge="page" clay="live">${JSON.stringify({ v: 1, y: { doc: 'AAAA' } })}</script></body></html>`;
    const refused = await save(synthetic, { 'If-Match': documentEtag(before) });

    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('page-conversion-refused');
    expect(refused.body.reason).toBe('invalid-capture');
    expect(await onDisk()).toBe(before);
    expect(await readPageState(dir, NAME)).toEqual(beforeState);
  });

  test('the floor cannot rise under a connected older tab', async () => {
    await fs.writeFile(filePath(), PAGE.html);
    await startApp();
    bindEditor('cA');

    const legacy = await getState({}, NAME, 'cA');
    expect(legacy.status).toBe(200);

    const before = await onDisk();
    const beforeState = await readPageState(dir, NAME);
    const refused = await save(FLOOR1, { 'X-Clay-Page-Format': '1' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(UPGRADE);
    expect(refused.body.minimum).toBe(1);
    expect(await onDisk()).toBe(before);
    expect(await readPageState(dir, NAME)).toEqual(beforeState);

    const current = await getState({ 'X-Clay-Page-Format': '1' }, NAME, 'cA');
    expect(current.status).toBe(200);

    const stored = await save(FLOOR1, { 'X-Clay-Page-Format': '1' });
    expect(stored.status).toBe(200);
    expect(await onDisk()).toContain(MARKER);
  });

  test('live requests declare their capability', async () => {
    await fs.writeFile(filePath(), FLOOR1);
    await fs.writeFile(filePath(STORE_NAME), STORE_DOC);
    await startApp();
    bindEditor('cA');
    bindEditor('cA', STORE_NAME);

    const refusedRead = await getState({}, NAME, 'cA');
    expect(refusedRead.status).toBe(409);
    expect(refusedRead.body.code).toBe(UPGRADE);
    expect(refusedRead.body.stores).toBeUndefined();

    const acceptedRead = await getState({ 'X-Clay-Page-Format': '1' }, NAME, 'cA');
    expect(acceptedRead.status).toBe(200);
    expect(acceptedRead.body.stores.page.value).toBeTruthy();

    const state = await getState({ 'X-Clay-Page-Format': '1' }, STORE_NAME, 'cA');
    expect(state.status).toBe(200);
    const { conn } = state.body;
    expect(typeof conn).toBe('string');

    const frame = (n) => request(server)
      .post('/_/sync/data?client-id=cA')
      .set('Origin', origin())
      .set('Document-URL', documentUrl(STORE_NAME))
      .send({ conn, name: 'store', n, ops: [{ op: 'add', path: ['count'], n: 1 }] });

    const refusedWrite = await frame(1);
    expect(refusedWrite.status).toBe(409);
    expect(refusedWrite.body.code).toBe(UPGRADE);

    const acceptedWrite = await frame(2)
      .set('X-Clay-Page-Format', '1');
    expect(acceptedWrite.status).toBe(200);
    expect(acceptedWrite.body.seq).toBeGreaterThan(0);
  });

  // The page codec behind the data API is pure ESM, so its dynamic import cannot
  // run inside jest's CommonJS VM. The same real app runs in a child process, the
  // way the page fixture itself is produced, and the host answers over real HTTP.
  test('the data API keeps the floor and refuses a legacy page write', () => {
    const script = `
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const http = require('http');
(async () => {
  const { createApp } = require(process.cwd() + '/src/main/server.js');
  const { createLocalAuthority } = require(process.cwd() + '/src/main/local-authority');
  const { withDocumentWrite } = require(process.cwd() + '/src/main/utils/write-queue');
  const MARKER = '<meta name="clay-page-format" content="1">';
  const floorOne = process.env.PAGE_HTML.replace('<head>', '<head>' + MARKER);
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'page-format-api-')));
  const file = path.join(dir, 'page.html');
  await fs.writeFile(file, floorOne);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const root = { id: 'api-root', kind: 'personal', path: dir, port: 0 };
  const server = http.createServer(createApp({ root, localAuthority: authority, devHooks: null }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const head = await fetch(origin + '/_/api/page.html');
    const etag = head.headers.get('etag');
    const revision = head.headers.get('page-revision');
    const post = async (headers) => {
      const res = await fetch(origin + '/_/api/page.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag, 'Page-If-Match': revision, ...headers },
        body: JSON.stringify({ body: 'new' }),
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    };
    const before = await fs.readFile(file, 'utf8');
    const refused = await post({});
    const afterRefused = await fs.readFile(file, 'utf8');
    const accepted = await post({ 'X-Clay-Page-Format': '1' });
    const stored = await fs.readFile(file, 'utf8');
    console.log(JSON.stringify({ refused, accepted, unchanged: before === afterRefused, marker: stored.includes(MARKER), written: stored.includes('>new</p>') }));
  } finally {
    await new Promise((done) => server.close(done));
    await new Promise((done) => setTimeout(done, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
})().catch((error) => { console.error(error); process.exit(1); });
`;
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, PAGE_HTML: PAGE.html },
      encoding: 'utf8',
    });
    const result = JSON.parse(out.trim().split('\n').pop());

    expect(result.refused.status).toBe(409);
    expect(result.refused.body.code).toBe(UPGRADE);
    expect(result.refused.body.minimum).toBe(1);
    expect(result.unchanged).toBe(true);
    expect(result.accepted.status).toBe(200);
    expect(result.marker).toBe(true);
    expect(result.written).toBe(true);
  });

  test('restore keeps the floor', async () => {
    await fs.writeFile(filePath(), PAGE.html);
    await startApp();

    expect((await save(PAGE.html)).status).toBe(200);
    expect((await save(FLOOR1, { 'X-Clay-Page-Format': '1' })).status).toBe(200);
    expect(await onDisk()).toContain(MARKER);

    const list = await request(server).get(`/_/versions/${NAME}`);
    expect(list.status).toBe(200);
    const oldest = list.body.versions[list.body.versions.length - 1];
    expect(oldest).toBeTruthy();

    const restored = await request(server).post(`/_/restore/${NAME}/${oldest.name}`);

    expect(restored.status).toBe(200);
    expect(await onDisk()).toContain(MARKER);
  });

  test('the relay refuses a legacy tab on a floor-1 document', async () => {
    await fs.writeFile(filePath(), FLOOR1);
    await startApp();

    const subscribe = () => {
      const received = [];
      const sink = { write: (message) => { received.push(message); } };
      live.subscribe(NAME, sink, { lane: 'live' });
      return { received, close: () => live.unsubscribe(NAME, sink) };
    };
    const post = (headers) => {
      const req = request(server)
        .post('/_/live-sync/save')
        .set('Document-URL', documentUrl())
        .send({ snapshot: FLOOR1, sender: 'tab-1' });
      for (const [key, value] of Object.entries(headers)) req.set(key, value);
      return req;
    };

    const legacy = subscribe();
    const refused = await post({});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(UPGRADE);
    expect(legacy.received).toEqual([]);
    legacy.close();

    const current = subscribe();
    const accepted = await post({ 'X-Clay-Page-Format': '1' });
    expect(accepted.status).toBe(200);
    expect(current.received.length).toBe(1);
    current.close();
  });

  test('the extension needs a floor runtime, and the bundled release is one', async () => {
    const rooms = require('@panphora/clayjs/server/rooms');
    const bare = path.join(dir, 'bare-runtime');
    await fs.mkdir(bare, { recursive: true });
    expect(pageFormatSupported({ rooms, runtimeDir: bare })).toBe(false);

    const runtimeDir = path.join(dir, 'floor-runtime');
    await fs.mkdir(path.join(runtimeDir, 'src', 'core'), { recursive: true });
    await fs.writeFile(path.join(runtimeDir, 'src', 'core', 'page-format.js'), 'export const PAGE_FORMAT = 1;\n');
    expect(pageFormatSupported({ rooms, runtimeDir })).toBe(true);

    await startApp();
    const meta = await request(server).get('/_/meta').set('Document-URL', documentUrl());
    expect(meta.body.extensions).toContain('page-format-v1');
  });
});
