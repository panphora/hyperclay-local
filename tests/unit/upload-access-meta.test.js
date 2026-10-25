// Upload access metadata on Hyperclay Local: this host says `access: 'local'` in
// the document block, and on every upload result it returns. The original limits
// and path-consent refusals are unchanged.

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

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('upload access metadata', () => {
  let dir;
  let app;

  const upload = (buffer, filename, docUrl = 'http://localhost/index.html') => request(app)
    .post('/_/upload')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost:4321')
    .set('Document-URL', docUrl)
    .attach('file', buffer, filename);

  const uploadToFolder = (buffer, filename, folder) => request(app)
    .post('/_/upload')
    .set('Host', 'localhost')
    .set('Origin', 'http://localhost:4321')
    .set('Upload-Folder', encodeURIComponent(folder))
    .attach('file', buffer, filename);

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'upacc-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), '<html>doc</html>');
  });

  afterEach(async () => {
    await closeLoopback();
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('metadata reports the local trust model beside the unchanged cap', async () => {
    const res = await request(app)
      .get('/_/meta')
      .set('Host', 'localhost')
      .set('Document-URL', 'http://localhost/index.html');
    expect(res.status).toBe(200);
    expect(res.body.extensions).toContain('upload');
    expect(res.body.document.upload).toEqual({
      allowed: true,
      maxBytes: 25 * 1024 * 1024,
      access: 'local'
    });
  });

  test('a document upload result carries the same access value', async () => {
    const res = await upload(Buffer.from('PNGDATA'), 'cover.png');
    expect(res.status).toBe(200);
    const [file] = res.body.uploads;
    expect(file.access).toBe('local');
    expect(file).toMatchObject({ bytes: 7 });
    expect(typeof file.name).toBe('string');
    expect(file.url).toMatch(/^\/_\/uploads\/assets-index\/cover-[0-9a-f]{6}\.png$/);
  });

  test('a folder upload result carries it too', async () => {
    await fs.mkdir(path.join(dir, 'Shots'));
    const res = await uploadToFolder(Buffer.from('PNGDATA'), 'cover.png', 'Shots');
    expect(res.status).toBe(200);
    expect(res.body.uploads[0].access).toBe('local');
    expect(res.body.uploads[0].url).toMatch(/^\/Shots\/cover-[0-9a-f]{6}\.png$/);
  });

  test('the size limit is unchanged: an oversized upload is refused too-large', async () => {
    const tooBig = Buffer.alloc(25 * 1024 * 1024 + 1, 0x41);
    const res = await upload(tooBig, 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('too-large');
    await expect(fs.readdir(path.join(dir, 'uploads'))).rejects.toThrow();
  });

  test('the path-consent checks are unchanged: a cross-origin upload is refused and writes nothing', async () => {
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'https://evil.example')
      .set('Document-URL', 'http://localhost/index.html')
      .attach('file', Buffer.from('X'), 'a.png');
    expect(res.status).toBe(403);
    await expect(fs.stat(path.join(dir, 'uploads'))).rejects.toThrow();
  });

  test('the path-consent checks are unchanged: an upload folder outside the root is refused', async () => {
    const res = await uploadToFolder(Buffer.from('X'), 'a.png', '../outside');
    expect(res.status).toBe(400);
  });

  test('the path-consent checks are unchanged: traversal out of uploads/ still serves nothing', async () => {
    await fs.writeFile(path.join(dir, 'secret.txt'), 'SECRET');
    // Sent raw: a client library rewrites `..` and `%2e%2e` before the request leaves.
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
});
