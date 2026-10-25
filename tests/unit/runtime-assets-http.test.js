const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Step 5 of the offline-local-hosts plan: a document opened in a plain browser still
// loads its runtime from `https://clayjs.com/v1/...`, which is unreachable offline.
// This host answers those bytes itself at `/_/clayjs/<version>/<path>` and rewrites
// every served document's runtime URLs to them, with ClayJS's descriptor so the
// client saves the public URLs back.

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { documentEtag } = require('../../src/main/spec-wire');
const { injectDocumentEtag } = require('../../src/main/utils/root-attrs.js');
const {
  servedDocumentEtag,
  withoutInjectedDocumentEtag
} = require('../helpers/served-metadata');
const runtimeAssets = require('../../src/main/runtime-assets');

const selected = runtimeAssets.selectedVersion;
const index = require(`../../src/main/offline-runtime/${selected}/offline-manifest.json`);
const bundle = (publicPath) => fs.readFile(path.join(__dirname, `../../src/main/offline-runtime/${selected}/${publicPath}`));

// The kanban template's runtime tags, verbatim: a document this host ships with.
const RUNTIME_SCRIPTS = [
  '<script src="https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,ai-edit"></script>',
  '<script src="https://clayjs.com/v1/sap.js"></script>',
  '<script src="https://clayjs.com/v1/clay-router.js"></script>',
];

const DOC = (head = '<title>plain</title>', body = '<p>hi</p>') =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>${body}</body>\n</html>`;

const WITH_RUNTIME = (indent) => DOC(`${indent}${RUNTIME_SCRIPTS.join(`\n${indent}`)}`);

let dir;
let app;

const file = (...segments) => path.join(dir, ...segments);

// Bytes in, bytes out: a served document is compared against the file, and the file
// may not be valid UTF-8.
const text = (res) => res.body.toString('utf8');

const send = (target, { method = 'get', headers = {}, server = app } = {}) =>
  request(server)[method](target).set(headers).buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-assets-http-')));
  await fs.writeFile(file('index.html'), DOC());
  app = await listenLoopback(createApp(dir));
});

afterEach(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the bundled ClayJS release is served from this host', () => {
  test('every file in the release index answers with its own bytes', async () => {
    const answered = new Set();

    for (const [publicPath, entry] of Object.entries(index.files)) {
      const res = await send(`/_/clayjs/${selected}/${publicPath}`);

      expect([publicPath, res.status]).toEqual([publicPath, 200]);
      expect([publicPath, res.headers['content-type']]).toEqual([publicPath, entry.type]);
      expect([publicPath, res.headers.etag]).toEqual([publicPath, `"${entry.sha256}"`]);
      expect([publicPath, crypto.createHash('sha256').update(res.body).digest('hex')])
        .toEqual([publicPath, entry.sha256]);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      answered.add(publicPath);
    }

    expect(answered.size).toBe(Object.keys(index.files).length);
    expect(answered.size).toBeGreaterThan(400);
  });

  test('HEAD answers the same headers with no body, and the ETag revalidates', async () => {
    const entry = index.files['clay.js'];
    const etag = `"${entry.sha256}"`;

    const head = await request(app).head(`/_/clayjs/${selected}/clay.js`);
    expect(head.status).toBe(200);
    expect(head.headers['content-type']).toBe(entry.type);
    expect(head.headers.etag).toBe(etag);
    expect(head.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(head.headers['x-content-type-options']).toBe('nosniff');
    expect(head.headers['content-length']).toBe(String(entry.bytes));
    expect(head.text).toBeUndefined();

    const conditional = await send(`/_/clayjs/${selected}/clay.js`, { headers: { 'If-None-Match': etag } });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.etag).toBe(etag);
    expect(conditional.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(conditional.body.length).toBe(0);

    const stale = await send(`/_/clayjs/${selected}/clay.js`, { headers: { 'If-None-Match': '"something-else"' } });
    expect(stale.status).toBe(200);
    expect(Buffer.compare(stale.body, await bundle('clay.js'))).toBe(0);

    // The query a projected document's tag carries is the browser's, not a path.
    const queried = await send(`/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit`);
    expect(queried.status).toBe(200);
    expect(Buffer.compare(queried.body, await bundle('clay.js'))).toBe(0);
  });

  test('anything that is not one of those files 404s and is not cached', async () => {
    const misses = [
      `/_/clayjs/9.9.9/clay.js`,
      `/_/clayjs/${selected}/not-in-this-release.js`,
      `/_/clayjs/${selected}/../package.json`,
      `/_/clayjs/${selected}/%2e%2e/package.json`,
      `/_/clayjs/${selected}/m%2f..%2f..%2fpackage.json`,
      `/_/clayjs/${selected}/`,
    ];

    for (const target of misses) {
      const res = await send(target);
      expect([target, res.status]).toEqual([target, 404]);
      expect([target, res.headers['cache-control']]).toEqual([target, 'no-store']);
      expect([target, res.body.toString('utf8')]).toEqual([target, 'Not found']);
    }
  });

  // The marker is what makes the lane a system route. Without it the path is a user's
  // own folder name, and only the static catch-all may answer.
  test('the same path without the marker is not answered by this route', async () => {
    const res = await send(`/clayjs/${selected}/clay.js`);

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).not.toBe('public, max-age=31536000, immutable');
    expect(Buffer.compare(res.body, await bundle('clay.js'))).not.toBe(0);
  });
});

describe('a served document points its runtime at this host', () => {
  test('its runtime URLs are local, keep their queries, and carry the descriptor', async () => {
    await fs.writeFile(file('index.html'), WITH_RUNTIME(''));
    const onDisk = await fs.readFile(file('index.html'));

    const res = await send('/index.html');
    const html = text(res);

    expect(res.status).toBe(200);
    expect(html).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit"`);
    expect(html).toContain(`src="/_/clayjs/${selected}/sap.js"`);
    expect(html).toContain(`src="/_/clayjs/${selected}/clay-router.js"`);
    expect(html).toContain('id="clay-runtime-map"');
    expect(html).not.toContain('src="https://clayjs.com');
    expect(res.headers.vary).toBe('Clay-Source');

    // The stamp still describes the bytes on disk, and the file is untouched.
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(onDisk));
    expect(Buffer.compare(withoutInjectedDocumentEtag(res.body), onDisk)).not.toBe(0);
    expect(Buffer.compare(await fs.readFile(file('index.html')), onDisk)).toBe(0);
  });

  // The source plugin asks for the canonical bytes, which must be the document as the
  // client's next save has to write it: unprojected.
  test('Clay-Source: 1 gets exactly the disk bytes plus the stamp', async () => {
    await fs.writeFile(file('index.html'), WITH_RUNTIME(''));
    const onDisk = await fs.readFile(file('index.html'));

    const res = await send('/index.html', { headers: { 'Clay-Source': '1' } });

    expect(res.status).toBe(200);
    expect(res.headers.vary).toBe('Clay-Source');
    expect(Buffer.compare(res.body, injectDocumentEtag(onDisk, documentEtag(onDisk)))).toBe(0);
    expect(text(res)).toContain('https://clayjs.com/v1/clay.js?plugins=');
    expect(text(res)).not.toContain('clay-runtime-map');
  });

  test('a document with no runtime URL is served byte for byte', async () => {
    const onDisk = await fs.readFile(file('index.html'));

    const res = await send('/index.html');

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, injectDocumentEtag(onDisk, documentEtag(onDisk)))).toBe(0);
  });

  test('a nested document is projected too', async () => {
    await fs.mkdir(file('notes', '2026'), { recursive: true });
    await fs.writeFile(file('notes', '2026', 'doc.html'), WITH_RUNTIME('  '));

    const res = await send('/notes/2026/doc.html');

    expect(res.status).toBe(200);
    expect(text(res)).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit"`);
    expect(text(res)).toContain('id="clay-runtime-map"');
  });

  // A file that is not valid UTF-8 is never re-encoded, so it cannot be projected
  // either: the response has to be the bytes that are stored.
  test('a document that is not valid UTF-8 is served unprojected', async () => {
    const broken = Buffer.concat([
      Buffer.from('<!DOCTYPE html>\n<html>\n<head>\n'),
      Buffer.from([0xff, 0xfe, 0x80]),
      Buffer.from(`\n<script src="https://clayjs.com/v1/clay.js"></script>\n</head>\n<body></body>\n</html>`),
    ]);
    await fs.writeFile(file('index.html'), broken);

    const res = await send('/index.html');

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, injectDocumentEtag(broken, documentEtag(broken)))).toBe(0);
    expect(text(res)).toContain('https://clayjs.com/v1/clay.js');
    expect(text(res)).not.toContain('clay-runtime-map');
  });
});

describe('a framed workspace request', () => {
  test('still carries the bridge, and is projected', async () => {
    await fs.writeFile(file('index.html'), WITH_RUNTIME(''));
    const framed = await listenLoopback(createApp({
      root: { id: 'root-a', kind: 'personal', path: dir, port: 4321 },
      workspaceFrame: (rootId, rel, wireId) => ({ wireId, shellOrigin: 'http://localhost:4321' }),
    }));

    const res = await send('/index.html?workspace-frame=7', { server: framed });

    expect(res.status).toBe(200);
    expect(text(res)).toContain('data-hyperclay-bridge');
    expect(text(res)).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit"`);
    expect(text(res)).not.toContain('src="https://clayjs.com');
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(await fs.readFile(file('index.html'))));
  });
});
