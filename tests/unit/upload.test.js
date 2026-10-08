// Uploads (spec §9) on Hyperclay Local: discovery, the assets folder, content-hash
// naming, active-content refusal, and SVG served inert.

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const fs = require('fs').promises;
const http = require('http');
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp, refusedUpload } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('uploads', () => {
  let dir;
  let app;

  const upload = (buffer, filename, docUrl = 'http://localhost/index.html') => request(app)
    .post('/_/upload')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost:4321')
    .set('Document-URL', docUrl)
    .attach('file', buffer, filename);

  const assets = (name = 'assets-index') => path.join(dir, 'uploads', name);

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'upl-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), '<html>doc</html>');
  });

  afterEach(async () => {
    await closeLoopback();
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('stores the file in uploads/assets-<stem>/ and returns a host path', async () => {
    const res = await upload(Buffer.from('PNGDATA'), 'cover.png');
    expect(res.status).toBe(200);
    const [file] = res.body.uploads;
    expect(file.url).toMatch(/^\/_\/uploads\/assets-index\/cover-[0-9a-f]{6}\.png$/);
    expect(file.bytes).toBe(7);
    expect(await fs.readFile(path.join(assets(), file.name), 'utf8')).toBe('PNGDATA');
  });

  test('the folder is named after the document, not shared across documents', async () => {
    await fs.writeFile(path.join(dir, 'about.html'), '<html>other</html>');
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/about.html');
    expect(res.body.uploads[0].url).toMatch(/^\/_\/uploads\/assets-about\//);
    await expect(fs.stat(assets('assets-about'))).resolves.toBeTruthy();
  });

  test('a document in a subfolder still uploads into the root\'s uploads folder', async () => {
    await fs.mkdir(path.join(dir, 'blog'));
    await fs.writeFile(path.join(dir, 'blog', 'post.html'), '<html>p</html>');
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/blog/post.html');
    // The host path names the root\'s uploads folder, so moving the document never strands it.
    expect(res.body.uploads[0].url).toMatch(/^\/_\/uploads\/assets-post\//);
    await expect(fs.stat(path.join(dir, 'uploads', 'assets-post'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, 'blog', 'assets-post'))).rejects.toThrow();
  });

  test('a document name is slugged to the folder alphabet hyperclay.com uses', async () => {
    await fs.writeFile(path.join(dir, 'My Board.v2.html'), '<html>b</html>');
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/My Board.v2.html');
    expect(res.body.uploads[0].url).toMatch(/^\/_\/uploads\/assets-my-board-v2\//);
    await expect(fs.stat(path.join(dir, 'uploads', 'assets-my-board-v2'))).resolves.toBeTruthy();
  });

  test('identical bytes converge on ONE file rather than piling up copies', async () => {
    const a = await upload(Buffer.from('same'), 'photo.png');
    const b = await upload(Buffer.from('same'), 'photo.png');
    expect(a.body.uploads[0].url).toBe(b.body.uploads[0].url);
    expect(await fs.readdir(assets())).toHaveLength(1);
  });

  test('different bytes under the same filename both survive', async () => {
    const a = await upload(Buffer.from('one'), 'photo.png');
    const b = await upload(Buffer.from('two'), 'photo.png');
    expect(a.body.uploads[0].url).not.toBe(b.body.uploads[0].url);
    expect(await fs.readdir(assets())).toHaveLength(2);
  });

  test('eight concurrent uploads of different bytes all land', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => upload(Buffer.from(`body-${i}`), 'shot.png'))
    );
    for (const res of results) expect(res.status).toBe(200);
    expect(new Set(results.map((r) => r.body.uploads[0].name)).size).toBe(8);
    expect(await fs.readdir(assets())).toHaveLength(8);
  });

  test('active content is refused: an .html upload would run with the document\'s authority', async () => {
    const res = await upload(Buffer.from('<script>alert(1)</script>'), 'payload.html');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-type');
    await expect(fs.stat(assets())).rejects.toThrow();
  });

  test('a .js upload is refused too', async () => {
    const res = await upload(Buffer.from('alert(1)'), 'payload.js');
    expect(res.status).toBe(415);
  });

  test('SVG is stored, and served inert rather than inline', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const res = await upload(Buffer.from(svg), 'logo.svg');
    expect(res.status).toBe(200);

    const served = await request(app)
      .get(res.body.uploads[0].url)
      .set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a web-page upload is refused by type, whatever the extension says', async () => {
    for (const name of ['x.shtml', 'x.rss', 'x.atom', 'x.rdf', 'x.mml', 'X.HTML']) {
      const res = await upload(Buffer.from('<html>payload</html>'), name);
      expect(res.status).toBe(415);
      expect(res.body.code).toBe('unsupported-type');
    }
    await expect(fs.stat(assets())).rejects.toThrow();
  });

  test('a file with no extension, an unknown one, or a non-page type is accepted', async () => {
    for (const name of ['note', 'note.foo', 'a.zip', 'a.pdf', 'a.svg']) {
      const res = await upload(Buffer.from('<html>payload</html>'), name);
      expect(res.status).toBe(200);
    }
  });

  test('a file the browser cannot type is handed over as a download', async () => {
    for (const name of ['note', 'note.foo']) {
      const res = await upload(Buffer.from('<html>payload</html>'), name);
      const served = await request(app)
        .get(res.body.uploads[0].url)
        .set('Host', 'localhost');
      expect(served.status).toBe(200);
      expect(served.headers['content-type'].startsWith('application/octet-stream')).toBe(true);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  test('an image beside a document is typed by its extension and never sniffed', async () => {
    const res = await upload(Buffer.from('PNGDATA'), 'cover.png');
    const served = await request(app)
      .get(res.body.uploads[0].url)
      .set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('the answered host path serves the exact bytes back', async () => {
    const res = await upload(Buffer.from('PNGDATA'), 'cover.png');
    const served = await request(app).get(res.body.uploads[0].url).set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(Buffer.from(served.body).toString()).toBe('PNGDATA');
  });

  test('a page hand-placed in uploads/ is a download through /_/uploads/, never a page', async () => {
    await fs.mkdir(path.join(dir, 'uploads', 'assets-x'), { recursive: true });
    await fs.writeFile(path.join(dir, 'uploads', 'assets-x', 'page.html'), '<html>payload</html>');
    const served = await request(app).get('/_/uploads/assets-x/page.html').set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a folder under /_/uploads/ is a 404, never a listing', async () => {
    await fs.mkdir(path.join(dir, 'uploads', 'assets-x'), { recursive: true });
    await fs.writeFile(path.join(dir, 'uploads', 'assets-x', 'note.txt'), 'hi');
    const served = await request(app).get('/_/uploads/assets-x/').set('Host', 'localhost');
    expect(served.status).toBe(404);
    expect(served.text).not.toContain('note.txt');
  });

  test('a missing file under /_/uploads/ is a 404', async () => {
    const served = await request(app).get('/_/uploads/assets-x/missing.png').set('Host', 'localhost');
    expect(served.status).toBe(404);
  });

  test('traversal out of uploads/ is refused, and the file outside it is never returned', async () => {
    await fs.writeFile(path.join(dir, 'secret.txt'), 'SECRET');
    // Sent raw: a client library rewrites `..` and `%2e%2e` before the request
    // leaves, so going through one would test the client, not this route.
    const raw = (target) => new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: app.address().port, path: target, headers: { Host: 'localhost' } },
        (res) => {
          let text = '';
          res.on('data', (chunk) => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, text }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    for (const target of ['/_/uploads/../secret.txt', '/_/uploads/%2e%2e/secret.txt']) {
      const served = await raw(target);
      expect(served.status).toBeGreaterThanOrEqual(400);
      expect(served.status).toBeLessThan(500);
      expect(served.text).not.toContain('SECRET');
    }
  });

  test('a page type hand-placed inside an assets folder is served as an attachment', async () => {
    await fs.mkdir(path.join(dir, 'assets-doc'));
    await fs.writeFile(path.join(dir, 'assets-doc', 'x.shtml'), '<html>payload</html>');
    const served = await request(app).get('/assets-doc/x.shtml').set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a page type in an uploads folder is a download on the .html branch too', async () => {
    // The URL names it as a page, so the SPA branch would render it before the
    // Content-Disposition rule below was ever reached.
    await fs.mkdir(path.join(dir, 'assets-board'));
    await fs.writeFile(path.join(dir, 'assets-board', 'legacy.html'), '<html>payload</html>');
    const served = await request(app).get('/assets-board/legacy.html').set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a file with no extension is bytes, not the type its basename names', async () => {
    // send reads the bare basename as if it were an extension, so `html` came
    // back text/html and `svg` came back image/svg+xml, both inline.
    await fs.mkdir(path.join(dir, 'assets-board'));
    await fs.writeFile(path.join(dir, 'assets-board', 'html'), '<html>payload</html>');
    await fs.writeFile(path.join(dir, 'assets-board', 'svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    for (const name of ['html', 'svg']) {
      const served = await request(app).get(`/assets-board/${name}`).set('Host', 'localhost');
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('application/octet-stream');
    }
  });

  test('only the immediate parent folder counts as an uploads folder', async () => {
    await fs.mkdir(path.join(dir, 'assets-2024', 'site'), { recursive: true });
    await fs.writeFile(path.join(dir, 'assets-2024', 'site', 'page.xhtml'), '<html>payload</html>');
    const served = await request(app).get('/assets-2024/site/page.xhtml').set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBeUndefined();
  });

  test('the uploads-folder rule does not care about case, because the disk does not', async () => {
    await fs.mkdir(path.join(dir, 'Assets-Board'));
    await fs.writeFile(path.join(dir, 'Assets-Board', 'legacy.html'), '<html>payload</html>');
    const served = await request(app).get('/Assets-Board/legacy.html').set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
  });

  test('a script or XML type the extension list misses is refused by its own type', () => {
    const mime = require('express').static.mime;
    if (!mime.lookup('x3d')) mime.define({ 'model/x3d+xml': ['x3d'] });
    if (!mime.lookup('dae')) mime.define({ 'model/vnd.collada+xml': ['dae'] });
    if (!mime.lookup('ecma')) mime.define({ 'application/ecmascript': ['ecma'] });

    for (const name of ['x.x3d', 'x.dae', 'x.ecma']) expect(refusedUpload(name)).toBe(true);
    for (const name of ['x.svg', 'x.png', 'x']) expect(refusedUpload(name)).toBe(false);
  });

  test('a NUL in the filename cannot hide the extension the stored name will have', async () => {
    // filename* is decoded by busboy, and the NUL used to be stripped only when
    // the name was built, so `.ht\0ml` was checked as `ht\0ml` and stored as
    // `evil-<hash>.html`: served as a page beside the document.
    const boundary = '----hyperclay-nul-probe';
    const body = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename*=UTF-8''evil.ht%00ml\r\n` +
      `Content-Type: text/html\r\n\r\n` +
      '<script>alert(1)</script>\r\n' +
      `--${boundary}--\r\n`
    );
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Document-URL', 'http://localhost/index.html')
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(body);
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-type');
    await expect(fs.stat(assets())).rejects.toThrow();
  });

  test('a name already taken by DIFFERENT bytes is never overwritten', async () => {
    // The one case the exclusive create exists for. Content-hash naming means
    // different bytes normally get different names and never contend, so without
    // this the O_EXCL could be swapped for a plain write and every other test
    // here would still pass.
    const crypto = require('crypto');
    const content = Buffer.from('the real upload');
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    const taken = `photo-${digest.slice(0, 6)}.png`;
    await fs.mkdir(assets(), { recursive: true });
    await fs.writeFile(path.join(assets(), taken), 'SOMETHING ELSE');

    const res = await upload(content, 'photo.png');
    expect(res.status).toBe(200);
    expect(res.body.uploads[0].name).not.toBe(taken);
    expect(await fs.readFile(path.join(assets(), taken), 'utf8')).toBe('SOMETHING ELSE');
    expect(await fs.readFile(path.join(assets(), res.body.uploads[0].name), 'utf8')).toBe('the real upload');
  });

  test('a traversing filename cannot escape the assets folder', async () => {
    const res = await upload(Buffer.from('X'), '../../escaped.png');
    expect(res.status).toBe(200);
    expect(res.body.uploads[0].name).toMatch(/^escaped-[0-9a-f]{6}\.png$/);
    await expect(fs.stat(path.join(dir, '..', 'escaped.png'))).rejects.toThrow();
    expect(await fs.readdir(assets())).toHaveLength(1);
  });

  test('a name with a space comes back percent-encoded, and decodes to the stored name', async () => {
    const res = await upload(Buffer.from('X'), 'header photo.png');
    const [file] = res.body.uploads;
    expect(file.url).toContain('%20');
    expect(file.url.split('/')[3]).toBe('assets-index');
    expect(decodeURIComponent(file.url.split('/').pop())).toBe(file.name);
    await expect(fs.stat(path.join(assets(), file.name))).resolves.toBeTruthy();
    const served = await request(app).get(file.url).set('Host', 'localhost');
    expect(served.status).toBe(200);
  });

  test('a dot-prefixed filename is stored visibly rather than 404ing as a hidden file', async () => {
    const res = await upload(Buffer.from('X'), '.avatar.png');
    expect(res.status).toBe(200);
    expect(res.body.uploads[0].name.startsWith('.')).toBe(false);
  });

  test('no Document-URL is a 400, not a file at the root', async () => {
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .attach('file', Buffer.from('X'), 'a.png');
    expect(res.status).toBe(400);
  });

  test('uploading to a document that does not exist is a 404', async () => {
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/missing.html');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not-found');
  });

  test('a cross-origin upload is refused by the origin guard, before any file is written', async () => {
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'https://evil.example')
      .set('Document-URL', 'http://localhost/index.html')
      .attach('file', Buffer.from('X'), 'a.png');
    expect(res.status).toBe(403);
    await expect(fs.stat(assets())).rejects.toThrow();
  });

  test('a folder actually named "upload" is still served as a folder', async () => {
    await fs.mkdir(path.join(dir, 'upload'));
    await fs.writeFile(path.join(dir, 'upload', 'note.txt'), 'hi');
    const res = await request(app).get('/upload').set('Host', 'localhost');
    expect(res.status).toBe(200);
    expect(res.text).toContain('note.txt');
  });

  test('the upload lane is only reachable under /_/, never at a bare /upload', async () => {
    // The lane is claimed by the `/_/` marker, so a POST to the bare path must not
    // store anything. Without this the route would answer for any page that
    // happens to post to /upload, and a folder of that name would be shadowed.
    const res = await request(app)
      .post('/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Document-URL', 'http://localhost/index.html')
      .attach('file', Buffer.from('X'), 'a.png');
    expect(res.body.uploads).toBeUndefined();
    await expect(fs.stat(assets())).rejects.toThrow();
  });
});

describe('discovery', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'meta-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), '<html>doc</html>');
  });

  afterEach(async () => {
    await closeLoopback();
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('announces the spec version and the upload capability', async () => {
    const res = await request(app).get('/_/meta').set('Host', 'localhost');
    expect(res.status).toBe(200);
    expect(res.body.spec).toBe(1);
    expect(res.body.extensions).toContain('upload');
  });

  test('a named document carries its writability and its upload cap', async () => {
    const res = await request(app)
      .get('/_/meta')
      .set('Host', 'localhost')
      .set('Document-URL', 'http://localhost/index.html');
    expect(res.body.document.writable).toBe(true);
    expect(res.body.document.upload.allowed).toBe(true);
    expect(typeof res.body.document.upload.maxBytes).toBe('number');
  });

  test('a document that does not exist is answered by omission, not by a different status', async () => {
    const res = await request(app)
      .get('/_/meta')
      .set('Host', 'localhost')
      .set('Document-URL', 'http://localhost/nope.html');
    expect(res.status).toBe(200);
    expect(res.body.document).toBeUndefined();
    expect(res.body.spec).toBe(1);
  });

  test('a folder actually named "meta" is still served as a folder', async () => {
    await fs.mkdir(path.join(dir, 'meta'));
    await fs.writeFile(path.join(dir, 'meta', 'note.txt'), 'hi');
    const res = await request(app).get('/meta').set('Host', 'localhost');
    expect(res.status).toBe(200);
    expect(res.text).toContain('note.txt');
  });
});
