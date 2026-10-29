// ClayJS's page menu reads `document.actions` from `GET /_/meta` and POSTs to the
// same-origin address each action names. This host offers five, each naming its
// document with Document-URL: reveal, versions, export, codeEditor and duplicate.
// The decisions live in main, so this file pins the wire contract the server owes:
// the block, the five routes, the path each hook receives, and the refusals.

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { freeCopyName, freeZipName } = require('../../src/main/utils/free-name');

let dir;
let server;
let root;

const file = (...segments) => path.join(dir, ...segments);

const meta = (href) => {
  const req = request(server).get('/_/meta').set('Host', 'localhost');
  return href ? req.set('Document-URL', href) : req;
};

const post = (route, { href = 'http://localhost/index.html', headers = {} } = {}) => {
  const req = request(server)
    .post(route)
    .set('Host', 'localhost')
    .set('Origin', `http://localhost:${server.address().port}`);
  if (href) req.set('Document-URL', href);
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req;
};

const actions = () => ({
  reveal: jest.fn(async () => ({ ok: true })),
  versions: jest.fn(async () => ({ ok: true })),
  export: jest.fn(async () => ({ ok: true })),
  codeEditor: jest.fn(async () => ({ ok: true })),
  duplicate: jest.fn(async () => ({ ok: true, href: 'http://localhost:9/index-copy.html' })),
});

const app = (documentActions = null) => listenLoopback(createApp({
  root, devHooks: null, isKnownPath: null, documentActions,
}));

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-actions-')));
  await fs.mkdir(file('notes'), { recursive: true });
  await fs.writeFile(file('index.html'), '<html><body>index</body></html>');
  await fs.writeFile(file('notes', 'doc.html'), '<html><body>doc</body></html>');
  root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await closeLoopback();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  jest.restoreAllMocks();
});

describe('discovery offers the five document actions', () => {
  test('a document block carries the five posts when the hooks are wired', async () => {
    server = await app(actions());

    const res = await meta('http://localhost/index.html');

    expect(res.status).toBe(200);
    expect(res.body.document.actions).toEqual({
      reveal: { post: '/_/reveal' },
      versions: { post: '/_/versions-folder' },
      export: { post: '/_/export' },
      codeEditor: { post: '/_/code-editor' },
      duplicate: { post: '/_/duplicate' },
    });
  });

  test('without the hooks the block carries no actions', async () => {
    server = await app();

    const res = await meta('http://localhost/index.html');

    expect(res.status).toBe(200);
    expect(res.body.document.writable).toBe(true);
    expect(res.body.document.actions).toBeUndefined();
  });
});

describe('each action calls its hook with the document it names', () => {
  const cases = [
    ['/_/reveal', 'reveal', 'http://localhost/index.html', () => file('index.html'), { ok: true }],
    ['/_/versions-folder', 'versions', 'http://localhost/index.html', () => 'index.html', { ok: true }],
    ['/_/export', 'export', 'http://localhost/notes/doc.html', () => file('notes', 'doc.html'), { ok: true }],
    ['/_/code-editor', 'codeEditor', 'http://localhost/notes/doc.html', () => 'notes/doc.html', { ok: true }],
    ['/_/duplicate', 'duplicate', 'http://localhost/notes/doc.html', () => 'notes/doc.html',
      { ok: true, href: 'http://localhost:9/index-copy.html' }],
  ];

  test.each(cases)('%s runs %s once and replies with its answer', async (route, action, href, expected, answer) => {
    const hooks = actions();
    server = await app(hooks);

    const res = await post(route, { href });

    expect(hooks[action]).toHaveBeenCalledTimes(1);
    expect(hooks[action]).toHaveBeenCalledWith('root-a', expected());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(answer);
  });

  test('a hook in the answer carries its href through', async () => {
    const hooks = actions();
    hooks.duplicate.mockResolvedValue({ ok: true, href: 'http://localhost:9/doc-copy.html' });
    server = await app(hooks);

    const res = await post('/_/duplicate', { href: 'http://localhost/index.html' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, href: 'http://localhost:9/doc-copy.html' });
  });

  test('a refusal is a 500 carrying the hook\u2019s message', async () => {
    const hooks = actions();
    hooks.export.mockResolvedValue({ ok: false, message: '\u201Cindex.html\u201D could not be exported.' });
    server = await app(hooks);

    const res = await post('/_/export');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, message: '\u201Cindex.html\u201D could not be exported.' });
  });
});

describe('the actions refuse what they cannot act on', () => {
  test('a cross-site POST is a 403 and no hook runs', async () => {
    const hooks = actions();
    server = await app(hooks);

    const res = await post('/_/reveal', { headers: { 'Sec-Fetch-Site': 'cross-site' } });

    expect(res.status).toBe(403);
    expect(hooks.reveal).not.toHaveBeenCalled();
  });

  test('no Document-URL is a 400 and no hook runs', async () => {
    const hooks = actions();
    server = await app(hooks);

    const res = await post('/_/reveal', { href: null });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, message: 'No document named.' });
    expect(hooks.reveal).not.toHaveBeenCalled();
  });

  test('a document that does not exist is a 404 and no hook runs', async () => {
    const hooks = actions();
    server = await app(hooks);

    const res = await post('/_/duplicate', { href: 'http://localhost/missing.html' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(hooks.duplicate).not.toHaveBeenCalled();
  });

  test('a host without the hooks answers 404', async () => {
    server = await app();

    const res = await post('/_/code-editor');

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  test('the bare address belongs to no one; only the marker form answers', async () => {
    const hooks = actions();
    server = await app(hooks);

    const res = await request(server).post('/reveal').set('Host', 'localhost')
      .set('Origin', `http://localhost:${server.address().port}`)
      .set('Document-URL', 'http://localhost/index.html');

    expect(res.status).toBe(404);
    expect(hooks.reveal).not.toHaveBeenCalled();
  });
});

describe('the free names an action may take', () => {
  const taker = (taken) => async (target) => taken.has(target);

  test('a duplicate takes -copy, then -copy-2, then -copy-3', async () => {
    expect(await freeCopyName('/docs', 'A.html', taker(new Set()))).toBe('A-copy.html');
    expect(await freeCopyName('/docs', 'A.html', taker(new Set(['/docs/A-copy.html'])))).toBe('A-copy-2.html');
    expect(await freeCopyName('/docs', 'A.html',
      taker(new Set(['/docs/A-copy.html', '/docs/A-copy-2.html'])))).toBe('A-copy-3.html');
  });

  test('a duplicate keeps a document with no extension whole', async () => {
    expect(await freeCopyName('/docs', 'notes', taker(new Set()))).toBe('notes-copy');
  });

  test('an export takes <stem>.zip, then <stem> 2.zip', async () => {
    expect(await freeZipName('/downloads', 'A', taker(new Set()))).toBe('A.zip');
    expect(await freeZipName('/downloads', 'A', taker(new Set(['/downloads/A.zip'])))).toBe('A 2.zip');
    expect(await freeZipName('/downloads', 'A',
      taker(new Set(['/downloads/A.zip', '/downloads/A 2.zip'])))).toBe('A 3.zip');
  });
});
