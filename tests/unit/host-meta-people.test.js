// Step 6 of the local identity plan: one app-wide profile, answered by every root
// server as `document.people.me` on document-scoped discovery. The profile belongs to
// the HOST, not to a document or a root, so the answer is the same in every root and
// `people` is announced as a capability whenever the app can supply one.
//
// Two things this file is as much about as the happy path:
//   - a server built without a provider answers exactly as it did before: no `people`
//     extension and no `people` key anywhere, which is every existing test's shape;
//   - the person is named only to a page on this root's own origin, and a person that
//     cannot be named right now is said inside `people` as `unavailable`, never as a
//     failed answer: a failed discovery turns off every capability on the page.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const DOCUMENT = '<!DOCTYPE html><html><body><p>hi</p></body></html>';
const PERSON = { id: 'personAAAA1', name: 'Ada' };

// The ten capabilities a host without a person already announced, and the same list
// with `people` in it. Sorted, because that is the order the route publishes.
const EXTENSIONS = ['conditional', 'data-read', 'data-write', 'format', 'receipts', 'scoped-stylesheet', 'sync', 'sync-worker', 'upload', 'wire'];
const WITH_PEOPLE = [...EXTENSIONS, 'people'].sort();

let dirs;
let apps;

// The data-loss guard writes into .hyperclay/guard detached from the request by design,
// so it can still be running when a test finishes. Let it settle and retry, otherwise
// cleanup races it and throws ENOTEMPTY.
async function cleanup(target) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

async function tempRoot() {
  const target = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'meta-people-')));
  await fs.writeFile(path.join(target, 'index.html'), DOCUMENT);
  dirs.push(target);
  return target;
}

// supertest is handed the LISTENING server, the way every other suite here does it:
// given a bare express app it binds a second listener of its own, and the Host header it
// sends then names a port this root is not on.
async function startRoot(target, person) {
  const root = { id: `meta-people-root-${apps.length}`, kind: 'personal', path: target, port: 0 };
  const server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null, person }));
  root.port = server.address().port;
  const started = { server, root };
  apps.push(started);
  return started;
}

const documentUrl = (root) => `http://127.0.0.1:${root.port}/index.html`;

const meta = ({ server, root }, headers = {}) => {
  let req = request(server).get('/_/meta').set('Document-URL', documentUrl(root));
  for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
  return req;
};

const save = ({ server, root }) => request(server)
  .post('/_/save')
  .set('Document-URL', documentUrl(root))
  .set('Content-Type', 'text/plain')
  .send(DOCUMENT);

const hashOf = async (target) =>
  crypto.createHash('sha256').update(await fs.readFile(path.join(target, 'index.html'))).digest('hex');

beforeEach(async () => {
  dirs = [];
  apps = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await closeLoopback();
  for (const target of dirs) await cleanup(target);
  jest.restoreAllMocks();
});

test('a server with no person provider answers exactly as it did before', async () => {
  const started = await startRoot(await tempRoot(), null);

  const res = await meta(started);

  expect(res.status).toBe(200);
  expect(res.body.extensions).toEqual(EXTENSIONS);
  expect(res.text).not.toContain('people');
});

test('the person is announced as a capability and answered as document.people.me', async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: PERSON }));

  const res = await meta(started);

  expect(res.status).toBe(200);
  expect(res.body.extensions).toEqual(WITH_PEOPLE);
  expect(res.body.document.people).toEqual({ me: { id: 'personAAAA1', name: 'Ada' } });
  expect(res.body.document.people).not.toHaveProperty('members');
  expect(res.headers['cache-control']).toBe('private, no-store');
});

test('sharing off is me: null, not a missing person', async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: null }));

  const res = await meta(started);

  expect(res.status).toBe(200);
  expect(res.body.document.people).toEqual({ me: null });
});

test('an unavailable person is answered inside people and does not stop saving', async () => {
  const dir = await tempRoot();
  const started = await startRoot(dir, () => ({ unavailable: true }));

  const res = await meta(started);

  expect(res.status).toBe(200);
  expect(res.body.document.etag).toBeTruthy();
  expect(res.body.document.people).toEqual({ me: null, unavailable: true });
  expect(res.headers['cache-control']).toBe('private, no-store');

  const saved = await save(started);
  expect(saved.status).toBe(200);
  expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toBe(DOCUMENT);
});

test('two roots answer the same person', async () => {
  const provider = () => ({ me: PERSON });
  const first = await startRoot(await tempRoot(), provider);
  const second = await startRoot(await tempRoot(), provider);

  const a = await meta(first);
  const b = await meta(second);

  expect(a.body.document.people).toEqual({ me: PERSON });
  expect(b.body.document.people).toEqual(a.body.document.people);
});

test('the answer follows the provider, with no server restart', async () => {
  let name = 'Ada';
  const started = await startRoot(await tempRoot(), () => ({ me: { id: 'personAAAA1', name } }));

  const first = await meta(started);
  expect(first.body.document.people.me.name).toBe('Ada');

  name = 'Grace';
  const second = await meta(started);
  expect(second.body.document.people.me.name).toBe('Grace');
});

test('a request naming no document, and one naming a missing file, get no person', async () => {
  const started = await startRoot(await tempRoot(), () => ({ unavailable: true }));

  const unscoped = await request(started.server).get('/_/meta');
  expect(unscoped.status).toBe(200);
  expect(unscoped.body.document).toBeUndefined();
  expect(unscoped.text).not.toContain('personAAAA1');
  expect(unscoped.text).not.toContain('Ada');

  const missing = await request(started.server)
    .get('/_/meta')
    .set('Document-URL', `http://127.0.0.1:${started.root.port}/not-there.html`);
  expect(missing.status).toBe(200);
  expect(missing.body.document).toBeUndefined();
  expect(missing.text).not.toContain('personAAAA1');
  expect(missing.text).not.toContain('Ada');
});

test('a foreign Origin gets the document facts and no person', async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: PERSON }));

  const res = await meta(started, { Origin: 'http://evil.example' });

  expect(res.status).toBe(200);
  expect(res.body.document).toBeDefined();
  expect(res.body.document.people).toBeUndefined();
  expect(res.text).not.toContain('personAAAA1');
  expect(res.text).not.toContain('Ada');
});

test('Origin: null gets no person', async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: PERSON }));

  const res = await meta(started, { Origin: 'null' });

  expect(res.status).toBe(200);
  expect(res.body.document).toBeDefined();
  expect(res.body.document.people).toBeUndefined();
  expect(res.text).not.toContain('personAAAA1');
  expect(res.text).not.toContain('Ada');
});

test('Fetch Metadata saying cross-site gets no person', async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: PERSON }));

  const res = await meta(started, { 'Sec-Fetch-Site': 'cross-site' });

  expect(res.status).toBe(200);
  expect(res.body.document).toBeDefined();
  expect(res.body.document.people).toBeUndefined();
  expect(res.text).not.toContain('personAAAA1');
  expect(res.text).not.toContain('Ada');
});

test("the app's own Origin gets the person", async () => {
  const started = await startRoot(await tempRoot(), () => ({ me: PERSON }));

  const res = await meta(started, { Origin: `http://127.0.0.1:${started.root.port}` });

  expect(res.status).toBe(200);
  expect(res.body.document.people).toEqual({ me: PERSON });
});

test('discovery in every person state writes nothing to the document', async () => {
  const dir = await tempRoot();
  const before = await hashOf(dir);

  const person = await startRoot(dir, () => ({ me: PERSON }));
  await meta(person);

  const off = await startRoot(dir, () => ({ me: null }));
  await meta(off);

  const unavailable = await startRoot(dir, () => ({ unavailable: true }));
  await meta(unavailable);

  let name = 'Ada';
  const live = await startRoot(dir, () => ({ me: { id: 'personAAAA1', name } }));
  await meta(live);
  name = 'Grace';
  await meta(live);

  expect(await hashOf(dir)).toBe(before);
});
