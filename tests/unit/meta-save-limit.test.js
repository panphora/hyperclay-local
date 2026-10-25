// What this host says it accepts: discovery's `document.maxBytes` is the largest
// save body /_/save takes, inclusive, measured as the uncompressed UTF-8 bytes of
// the HTML body — not characters, and never compressed bytes. A client uses it to
// warn before a save is refused, so the boundary below is the real one the save
// path enforces and the two must agree.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const ORIGINAL = '<html><body>original</body></html>';
const PREFIX = '<html><body>';
const SUFFIX = '</body></html>';

// A whole document whose UTF-8 encoding is exactly `bytes` long. The filler is
// made of `unit`, so a multibyte document reaches the same byte count with fewer
// characters than the limit.
function documentOfBytes(bytes, unit = 'a') {
  const room = bytes - Buffer.byteLength(PREFIX) - Buffer.byteLength(SUFFIX);
  const unitBytes = Buffer.byteLength(unit);
  const filler = unit.repeat(Math.floor(room / unitBytes)) + 'a'.repeat(room % unitBytes);
  return PREFIX + filler + SUFFIX;
}

async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('the advertised save limit is the one the save path enforces', () => {
  let dir;
  let app;
  let maxBytes;

  const meta = () => request(app)
    .get('/_/meta')
    .set('Host', 'localhost')
    .set('Document-URL', 'http://localhost/index.html');

  const save = (body) => request(app)
    .post('/_/save')
    .set('Host', 'localhost')
    .set('Document-URL', 'http://localhost/index.html')
    .set('Content-Type', 'text/plain; charset=utf-8')
    .send(body);

  const onDisk = () => fs.readFile(path.join(dir, 'index.html'));

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'savelimit-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), ORIGINAL);
    const res = await meta();
    maxBytes = res.body.document.maxBytes;
  });

  afterEach(async () => {
    await closeLoopback();
    jest.restoreAllMocks();
    await cleanup(dir);
  });

  test('discovery advertises the limit and leaves the upload limit alone', async () => {
    const res = await meta();
    expect(res.status).toBe(200);
    expect(Number.isSafeInteger(res.body.document.maxBytes)).toBe(true);
    expect(res.body.document.maxBytes).toBe(20 * 1024 * 1024);
    expect(res.body.document.upload).toEqual({
      allowed: true,
      maxBytes: 25 * 1024 * 1024,
      access: 'local'
    });
  });

  test('a body of exactly the advertised limit is accepted', async () => {
    const body = documentOfBytes(maxBytes);
    expect(Buffer.byteLength(body)).toBe(maxBytes);
    const res = await save(body);
    expect(res.status).toBe(200);
    expect((await onDisk()).length).toBe(maxBytes);
  });

  test('one byte over the advertised limit is refused and writes nothing', async () => {
    const body = documentOfBytes(maxBytes + 1);
    expect(Buffer.byteLength(body)).toBe(maxBytes + 1);
    const res = await save(body);
    expect(res.status).toBe(413);
    expect((await onDisk()).toString('utf8')).toBe(ORIGINAL);
  });

  test('a multibyte body is measured in UTF-8 bytes at the limit', async () => {
    const body = documentOfBytes(maxBytes, '\u00e9');
    expect(Buffer.byteLength(body)).toBe(maxBytes);
    expect(body.length).toBeLessThan(maxBytes);
    const res = await save(body);
    expect(res.status).toBe(200);
    expect((await onDisk()).length).toBe(maxBytes);
  });

  test('a multibyte body one byte over the limit is refused though shorter in characters', async () => {
    const body = documentOfBytes(maxBytes + 1, '\u00e9');
    expect(Buffer.byteLength(body)).toBe(maxBytes + 1);
    expect(body.length).toBeLessThan(maxBytes);
    const res = await save(body);
    expect(res.status).toBe(413);
    expect((await onDisk()).toString('utf8')).toBe(ORIGINAL);
  });
});
