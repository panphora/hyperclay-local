// Uploads (spec §9) on Hyperclay Local: discovery, the assets folder, content-hash
// naming, active-content refusal, and SVG served inert.

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
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

  const assets = (name = 'assets-index') => path.join(dir, name);

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

  test('stores the file in assets-<stem>/ and returns a URL relative to the document', async () => {
    const res = await upload(Buffer.from('PNGDATA'), 'cover.png');
    expect(res.status).toBe(200);
    const [file] = res.body.uploads;
    expect(file.url).toMatch(/^assets-index\/cover-[0-9a-f]{6}\.png$/);
    expect(file.bytes).toBe(7);
    expect(await fs.readFile(path.join(assets(), file.name), 'utf8')).toBe('PNGDATA');
  });

  test('the folder is named after the document, not shared across documents', async () => {
    await fs.writeFile(path.join(dir, 'about.html'), '<html>other</html>');
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/about.html');
    expect(res.body.uploads[0].url).toMatch(/^assets-about\//);
    await expect(fs.stat(assets('assets-about'))).resolves.toBeTruthy();
  });

  test('a document in a subfolder gets its assets folder beside it', async () => {
    await fs.mkdir(path.join(dir, 'blog'));
    await fs.writeFile(path.join(dir, 'blog', 'post.html'), '<html>p</html>');
    const res = await upload(Buffer.from('X'), 'a.png', 'http://localhost/blog/post.html');
    // Relative to /blog/post.html, so the browser resolves it to /blog/assets-post/…
    expect(res.body.uploads[0].url).toMatch(/^assets-post\//);
    await expect(fs.stat(path.join(dir, 'blog', 'assets-post'))).resolves.toBeTruthy();
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
      .get('/' + res.body.uploads[0].url)
      .set('Host', 'localhost');
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
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
    expect(decodeURIComponent(file.url.split('/')[1])).toBe(file.name);
    await expect(fs.stat(path.join(assets(), file.name))).resolves.toBeTruthy();
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
