const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const http = require('http');
const request = require('supertest');
const yauzl = require('yauzl');

// Step 5b of the offline-local-hosts plan: a browser holding a projected document saves
// what it holds, and this host cannot rely on every client to put the public URLs back.
// An older ClayJS, a hand-written save, the JSON data API, a restored version, an
// incoming relay frame and a ZIP export can all carry this host's `/_/clayjs/` URLs or
// the projection descriptor. Bytes like that only work on this host, and platform sync
// would upload them, so every authoritative write is canonical -- and every frame a
// browser receives is projected.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn(),
  writeViaTag: jest.fn(),
}));

const { writeViaTag, extractViaTag } = require('../../src/main/utils/data-extractor');
const { createApp, getAndClearSnapshot, canonicalForWrite } = require('../../src/main/server.js');
const { documentEtag } = require('../../src/main/spec-wire');
const { stripSaveToken } = require('../../src/main/utils/root-attrs.js');
const { createBackup } = require('../../src/main/utils/backup.js');
const { exportDocumentZip } = require('../../src/main/export-zip');
const runtimeAssets = require('../../src/main/runtime-assets');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { servedDocumentEtag } = require('../helpers/served-metadata');

const selected = runtimeAssets.selectedVersion;
const project = (html) => runtimeAssets.projectRuntimeHTML(html, {
  releases: runtimeAssets.releases,
  selectedVersion: runtimeAssets.selectedVersion,
}).html;

// The kanban template's runtime tags, verbatim: a document this host ships with.
const RUNTIME_SCRIPTS = [
  '<script src="https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,ai-edit"></script>',
  '<script src="https://clayjs.com/v1/sap.js"></script>',
  '<script src="https://clayjs.com/v1/clay-router.js"></script>',
];

const DOC = (head = '<title>plain</title>', body = '<p>hi</p>') =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>${body}</body>\n</html>`;

const WITH_RUNTIME = (indent) => DOC(`${indent}${RUNTIME_SCRIPTS.join(`\n${indent}`)}`);

const PLAIN = '<!DOCTYPE html>\n<html lang="en">\n<body>\n<p>hi</p>\n</body>\n</html>';

const LOCAL_SCRIPT = () =>
  DOC(`<script src="/_/clayjs/${selected}/clay.js?plugins=page"></script>`);

const descriptor = (entries) =>
  `<script type="application/json" id="clay-runtime-map" clay="no-save no-watch no-snapshot">${JSON.stringify({ schema: 1, version: selected, entries })}</script>`;

const withDescriptor = (html, entries) => html.replace('</head>', `${descriptor(entries)}\n</head>`);

const PUBLIC = `https://clayjs.com/${selected}/clay.js?plugins=page`;
const LOCAL = `/_/clayjs/${selected}/clay.js?plugins=page`;

let dir;
let app;
let port;

const file = (...segments) => path.join(dir, ...(segments.length ? segments : ['index.html']));
const stored = (name = 'index.html') => fs.readFile(file(name), 'utf8');

// Bytes in, bytes out: a served document is compared against the file.
const text = (res) => res.body.toString('utf8');

const send = (target, { headers = {} } = {}) =>
  request(app).get(target).set(headers).buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

const save = (html, { name = 'index.html', headers = {} } = {}) => {
  const req = request(app)
    .post('/_/save')
    .set('Document-URL', `http://localhost:${port}/${name}`)
    .set('Content-Type', 'text/plain');
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send(html);
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-canonical-writes-')));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  writeViaTag.mockReset();
  extractViaTag.mockReset();
  app = await listenLoopback(createApp(dir));
  port = app.address().port;
  getAndClearSnapshot('index.html');
});

afterEach(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  jest.restoreAllMocks();
});

describe('a saved document that was served projected is stored canonical', () => {
  test('serve, edit, save and reopen keeps the public URLs and the edit', async () => {
    await fs.writeFile(file(), WITH_RUNTIME(''));
    const onDisk = await stored();

    const served = await send('/index.html');
    const servedHtml = text(served);
    expect(servedHtml).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit"`);
    expect(servedHtml).toContain(`src="/_/clayjs/${selected}/clay-router.js"`);
    expect(servedHtml).toContain('id="clay-runtime-map"');

    const edited = servedHtml.replace('<p>hi</p>', '<p>edited</p>');
    const res = await save(edited, { headers: { 'If-Match': servedDocumentEtag(served.body) } });

    expect([res.status, res.body.msg]).toEqual([200, 'Saved']);
    const written = await stored();
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
    expect(written).toBe(onDisk.replace('<p>hi</p>', '<p>edited</p>'));
    expect(written).toContain('https://clayjs.com/v1/clay.js?plugins=');
    expect(res.body.etag).toBe(documentEtag(Buffer.from(written, 'utf8')));

    const reopened = await send('/index.html');
    expect(text(reopened)).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit"`);
    expect(text(reopened)).toContain('id="clay-runtime-map"');
    expect(servedDocumentEtag(reopened.body)).toBe(documentEtag(Buffer.from(written, 'utf8')));
  });
});

describe('a save this host did not project is canonicalized anyway', () => {
  const localOnly = () => DOC(`<script src="${LOCAL}"></script>`);

  test('a local URL with no descriptor becomes the public URL', async () => {
    await fs.writeFile(file(), PLAIN);

    expect((await save(localOnly())).status).toBe(200);

    const written = await stored();
    expect(written).toContain(`src="${PUBLIC}"`);
    expect(written).not.toContain('/_/clayjs/');
  });

  test('a malicious descriptor entry writes no foreign URL', async () => {
    await fs.writeFile(file(), PLAIN);
    const html = withDescriptor(localOnly(), [{ original: 'https://evil.example/x.js', local: LOCAL }]);

    expect((await save(html)).status).toBe(200);

    const written = await stored();
    expect(written).not.toContain('evil.example');
    expect(written).not.toContain('/_/clayjs/');
    expect(written).toContain(`src="${PUBLIC}"`);
  });

  test.each([
    ['127.0.0.1', () => `127.0.0.1:${port}`],
    ['localhost', () => `localhost:${port}`],
  ])('a save through a %s Host header canonicalizes too', async (_label, host) => {
    await fs.writeFile(file(), PLAIN);

    const res = await request(app)
      .post('/_/save')
      .set('Host', host())
      .set('Document-URL', `http://localhost:${port}/index.html`)
      .set('Content-Type', 'text/plain')
      .send(localOnly());

    expect(res.status).toBe(200);
    expect(await stored()).toContain(`src="${PUBLIC}"`);
  });

  // An absolute loopback spelling of the same URL is the same local URL, whichever
  // loopback name the document was opened under.
  test('both loopback origins are treated as this host', () => {
    expect(canonicalForWrite(DOC(`<script src="http://localhost${LOCAL}"></script>`)))
      .toContain(`src="${PUBLIC}"`);
    expect(canonicalForWrite(DOC(`<script src="http://127.0.0.1${LOCAL}"></script>`)))
      .toContain(`src="${PUBLIC}"`);
  });
});

describe('a document with nothing to canonicalize is untouched', () => {
  test('a save writes the same bytes it writes without this step', async () => {
    await fs.writeFile(file(), PLAIN);
    const sent = PLAIN.replace('<html lang="en">', '<html lang="en" savetoken="tok-current">');

    expect((await save(sent)).status).toBe(200);
    expect(await stored()).toBe(stripSaveToken(sent));
    expect(await stored()).toBe(PLAIN);
  });

  test('a stale If-Match answers 412 and writes nothing', async () => {
    await fs.writeFile(file(), PLAIN);

    const res = await save(DOC('<title>plain</title>', '<p>new</p>'), { headers: { 'If-Match': 'stale' } });

    expect([res.status, res.body.code]).toEqual([412, 'conflict']);
    expect(await stored()).toBe(PLAIN);
  });
});

describe('a JSON data API write leaves disk canonical', () => {
  const apiWrite = (name, body) =>
    request(app)
      .post(`/_/api/${name}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

  test('on a non-page document', async () => {
    const local = DOC(`<script src="${LOCAL}"></script>`);
    await fs.writeFile(file('site.html'), local);

    writeViaTag.mockResolvedValue({ html: local.replace('<p>hi</p>', '<p>api</p>'), changed: true, spliced: true });
    extractViaTag.mockResolvedValue({ t: 'api' });

    const res = await apiWrite('site.html', { t: 'api' });

    expect([res.status, res.body]).toEqual([200, { t: 'api' }]);
    const written = await stored('site.html');
    expect(written).toContain(`src="${PUBLIC}"`);
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
    expect(written).toContain('<p>api</p>');
  });

  test('on a page-store document', async () => {
    const page = await fs.readFile(path.join(__dirname, '../fixtures/ypage-template.html'), 'utf8');
    const projected = project(page);
    expect(projected).toContain('/_/clayjs/');
    await fs.writeFile(file('board.html'), page);

    writeViaTag.mockResolvedValue({
      html: projected.replace('<h1 data-id="title"></h1>', '<h1 data-id="title">Changed</h1>'),
      changed: true,
      spliced: true,
    });
    extractViaTag.mockResolvedValue({ t: 'Changed' });

    const res = await apiWrite('board.html', { t: 'Changed' });

    expect([res.status, res.body]).toEqual([200, { t: 'Changed' }]);
    const written = await stored('board.html');
    expect(written).toContain('https://clayjs.com/v1/clay.js?plugins=page');
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
    expect(written).toContain('<h1 data-id="title">Changed</h1>');
  });
});

describe('a restored version is written canonical', () => {
  test('local URLs and a descriptor become the public URLs', async () => {
    await fs.writeFile(file(), PLAIN);
    const versionHtml = withDescriptor(LOCAL_SCRIPT(), [{ original: PUBLIC, local: LOCAL }]);
    const versionPath = await createBackup(dir, 'index', versionHtml);
    const versionName = path.basename(versionPath);

    const res = await request(app).post(`/_/restore/index.html/${versionName}`);

    expect(res.status).toBe(200);
    const written = await stored();
    expect(written).toContain(`src="${PUBLIC}"`);
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
  });
});

// A real SSE subscriber on its own socket, so what is asserted is the frame a browser
// receives rather than a mock's argument list.
function openStream(target) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target }, (res) => {
      const stream = { status: res.statusCode, events: [], close: () => req.destroy() };
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              stream.events.push(JSON.parse(line.slice(6)));
            } catch {}
          }
        }
      });
      res.on('error', () => {});
      resolve(stream);
    });
    req.on('error', reject);
  });
}

async function waitFor(condition, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('the relay hands browsers projected frames and the platform canonical bytes', () => {
  let stream;

  afterEach(() => {
    if (stream) stream.close();
    stream = null;
  });

  const relay = (body) =>
    request(app).post('/sync').set('Document-URL', `http://localhost:${port}/index.html`).send(body);

  test('a snapshot with local URLs', async () => {
    await fs.writeFile(file(), PLAIN);
    stream = await openStream(`/live-sync/stream?document-url=${encodeURIComponent(`http://localhost:${port}/index.html`)}`);
    await waitFor(() => stream.status === 200, 'the stream');

    const local = withDescriptor(LOCAL_SCRIPT(), [{ original: PUBLIC, local: LOCAL }]);
    const res = await relay({ snapshot: local, sender: 'tab-1' });

    expect(res.status).toBe(200);
    const cached = getAndClearSnapshot('index.html');
    expect(cached.html).toContain(`src="${PUBLIC}"`);
    expect(cached.html).not.toContain('/_/clayjs/');
    expect(cached.html).not.toContain('clay-runtime-map');

    await waitFor(() => stream.events.some((e) => e.sender === 'tab-1'), 'the projected frame');
    const frame = stream.events.find((e) => e.sender === 'tab-1');
    expect(frame.html).toContain(`src="${LOCAL}"`);
    expect(frame.html).toContain('id="clay-runtime-map"');
    expect(frame.html).not.toContain('src="https://clayjs.com');
  });

  test('a snapshot with public URLs reaches the subscriber projected', async () => {
    await fs.writeFile(file(), PLAIN);
    stream = await openStream(`/live-sync/stream?document-url=${encodeURIComponent(`http://localhost:${port}/index.html`)}`);
    await waitFor(() => stream.status === 200, 'the stream');

    expect((await relay({ snapshot: DOC(`<script src="${PUBLIC}"></script>`), sender: 'tab-2' })).status).toBe(200);

    await waitFor(() => stream.events.some((e) => e.sender === 'tab-2'), 'the projected frame');
    const frame = stream.events.find((e) => e.sender === 'tab-2');
    expect(frame.html).toContain(`src="${LOCAL}"`);
    expect(frame.html).toContain('id="clay-runtime-map"');
    expect(getAndClearSnapshot('index.html').html).toContain(`src="${PUBLIC}"`);
  });
});

describe('a ZIP export carries the canonical document', () => {
  const readZip = (zipPath) => new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      const entries = [];
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamError, readStream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          readStream.on('data', (chunk) => chunks.push(chunk));
          readStream.on('error', reject);
          readStream.on('end', () => {
            entries.push({ name: entry.fileName, content: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });

  test('a file on disk holding local URLs is exported with the public ones', async () => {
    const documentPath = file('board.html');
    const onDisk = withDescriptor(LOCAL_SCRIPT(), [{ original: PUBLIC, local: LOCAL }]);
    await fs.writeFile(documentPath, onDisk);
    const outPath = file('out.zip');

    expect(await exportDocumentZip(documentPath, outPath)).toBe(outPath);

    const entries = await readZip(outPath);
    const document = entries.find((entry) => entry.name.endsWith('/board.html'));
    expect(document).toBeTruthy();
    const html = document.content.toString('utf8');
    expect(html).toContain(`src="${PUBLIC}"`);
    expect(html).not.toContain('/_/clayjs/');
    expect(html).not.toContain('clay-runtime-map');

    expect(await fs.readFile(documentPath, 'utf8')).toBe(onDisk);
  });
});
