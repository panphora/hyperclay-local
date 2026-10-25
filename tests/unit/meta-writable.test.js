// View-first V7: ClayJS offers Edit and enters edit mode from `document.writable`
// in `GET /_/meta`. Hyperclay Local is a single-user host, so every document it
// can serve is one the person running the app may save, and every path it cannot
// read is withheld by omission. This file pins that contract: the positive claim,
// the stamp beside it (which must be the same stamp a GET of the document serves),
// and the cases that answer without a document block at all.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { documentEtag } = require('../../src/main/spec-wire');
const { servedDocumentEtag } = require('../helpers/served-metadata');

const PLAIN = '<!DOCTYPE html>\n<html lang="en"><body><p>plain</p></body></html>';

const RUNTIME_SCRIPTS = [
  '<script src="https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,ai-edit"></script>',
  '<script src="https://clayjs.com/v1/sap.js"></script>',
];

const WITH_RUNTIME =
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${RUNTIME_SCRIPTS.join('\n')}\n</head>\n<body><p>runtime</p></body>\n</html>`;

let dir;
let app;

const file = (...segments) => path.join(dir, ...segments);

const meta = (href) => {
  const req = request(app).get('/_/meta').set('Host', 'localhost');
  return href ? req.set('Document-URL', href) : req;
};

const getRaw = (target) => request(app).get('/' + target).buffer().parse((r, cb) => {
  const chunks = [];
  r.on('data', (c) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
});

async function cleanup(target) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'meta-writable-')));
  await fs.mkdir(file('notes', '2026'), { recursive: true });
  await fs.mkdir(file('assets-doc'), { recursive: true });
  await fs.writeFile(file('index.html'), PLAIN);
  await fs.writeFile(file('notes', '2026', 'doc.html'), WITH_RUNTIME);
  await fs.writeFile(file('notes', 'readme.txt'), 'not a document\n');
  await fs.writeFile(file('assets-doc', 'x.html'), PLAIN);
  app = await listenLoopback(createApp(dir));
});

afterEach(async () => {
  await closeLoopback();
  await cleanup(dir);
});

describe('discovery announces the local document as writable', () => {
  test('a served document is writable and carries the stamp of its own bytes', async () => {
    const onDisk = await fs.readFile(file('index.html'));

    const res = await meta('http://localhost/index.html');

    expect(res.status).toBe(200);
    expect(res.body.document.writable).toBe(true);
    expect(res.body.document.etag).toBe(documentEtag(onDisk));
  });

  test('a document in a subfolder is writable and its stamp matches the served one', async () => {
    const onDisk = await fs.readFile(file('notes', '2026', 'doc.html'));

    const res = await meta('http://localhost/notes/2026/doc.html');

    expect(res.status).toBe(200);
    expect(res.body.document.writable).toBe(true);
    expect(res.body.document.etag).toBe(documentEtag(onDisk));
  });

  test('a projected document keeps the stamp of the bytes on disk', async () => {
    const onDisk = await fs.readFile(file('notes', '2026', 'doc.html'));
    const served = await getRaw('notes/2026/doc.html');

    expect(served.status).toBe(200);
    expect(Buffer.compare(served.body, onDisk)).not.toBe(0);

    const res = await meta('http://localhost/notes/2026/doc.html');

    expect(res.body.document.etag).toBe(servedDocumentEtag(served.body));
    expect(res.body.document.etag).toBe(documentEtag(onDisk));
  });

  test('the served stamp is the announced stamp for an unprojected document too', async () => {
    const served = await getRaw('index.html');

    const res = await meta('http://localhost/index.html');

    expect(served.status).toBe(200);
    expect(Buffer.compare(served.body, await fs.readFile(file('index.html')))).not.toBe(0);
    expect(res.body.document.etag).toBe(servedDocumentEtag(served.body));
  });
});

describe('discovery withholds the document block where no writable document is named', () => {
  test('a document that does not exist answers without one', async () => {
    const res = await meta('http://localhost/missing.html');

    expect(res.status).toBe(200);
    expect(res.body.document).toBeUndefined();
  });

  test('a path that escapes the root answers without one', async () => {
    const res = await meta('http://localhost/..%2Foutside.html');

    expect(res.status).toBe(200);
    expect(res.body.document).toBeUndefined();
  });

  test('a non-HTML file answers without one', async () => {
    const res = await meta('http://localhost/notes/readme.txt');

    expect(res.status).toBe(200);
    expect(res.body.document).toBeUndefined();
  });

  test('a page inside an uploads folder is a served file, so the block is present', async () => {
    const onDisk = await fs.readFile(file('assets-doc', 'x.html'));
    const served = await getRaw('assets-doc/x.html');

    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');

    const res = await meta('http://localhost/assets-doc/x.html');

    expect(res.status).toBe(200);
    expect(res.body.document.writable).toBe(true);
    expect(res.body.document.etag).toBe(documentEtag(onDisk));
  });
});

describe('untokened discovery describes the host, not a document', () => {
  test('without Document-URL the answer has spec and extensions and no document', async () => {
    const res = await meta();

    expect(res.status).toBe(200);
    expect(res.body.spec).toBe(1);
    expect(Array.isArray(res.body.extensions)).toBe(true);
    expect(res.body.extensions).toContain('conditional');
    expect(res.body.document).toBeUndefined();
  });
});
