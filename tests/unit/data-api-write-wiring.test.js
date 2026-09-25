const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

// Mock the ESM engine wrapper so this jest suite stays pure-CJS; we're testing
// Express route ordering, the marker gate and the gates in front of the write,
// not the engine itself.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn(),
  writeViaTag: jest.fn()
}));

const { extractViaTag, writeViaTag } = require('../../src/main/utils/data-extractor');
const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

describe('data API write route wiring', () => {
  let dir;
  let app;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-wiring-'));
    extractViaTag.mockReset();
    writeViaTag.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
  });
  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    jest.restoreAllMocks();
  });

  async function writeSite(name, html) {
    const p = path.join(dir, name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, html);
  }

  test('POST /_/api/site.html writes through the save path and answers with fresh data + ETag', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    writeViaTag.mockResolvedValue({ html: '<html><body>y</body></html>', changed: true, spliced: true });
    extractViaTag.mockResolvedValue({ t: 'y' });

    const res = await request(app)
      .post('/_/api/site.html')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ t: 'y' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ t: 'y' });
    expect(res.headers.etag).toBeTruthy();
    expect(writeViaTag).toHaveBeenCalledWith('<html><body>x</body></html>', { t: 'y' }, 'api');
    expect(await fs.readFile(path.join(dir, 'site.html'), 'utf8')).toBe('<html><body>y</body></html>');
  });

  test('a non-JSON Content-Type is a 415 and the engine is never called', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    const res = await request(app)
      .post('/_/api/site.html')
      .set('Content-Type', 'text/plain')
      .send('{"t":"y"}');

    expect(res.status).toBe(415);
    expect(writeViaTag).not.toHaveBeenCalled();
  });

  test('a malformed JSON body is a 400', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    const res = await request(app)
      .post('/_/api/site.html')
      .set('Content-Type', 'application/json')
      .send('{"t":');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid JSON body');
    expect(writeViaTag).not.toHaveBeenCalled();
  });

  test('a cross-site request is refused before the handler runs', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    const res = await request(app)
      .post('/_/api/site.html')
      .set('Content-Type', 'application/json')
      .set('Sec-Fetch-Site', 'cross-site')
      .send('{"t":"y"}');

    expect(res.status).toBe(403);
    expect(writeViaTag).not.toHaveBeenCalled();
  });

  test('a bare /api/site.html POST is not the data API', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    const res = await request(app)
      .post('/api/site.html')
      .set('Content-Type', 'application/json')
      .send('{"t":"y"}');

    expect(res.status).not.toBe(200);
    expect(writeViaTag).not.toHaveBeenCalled();
  });

  test('GET /_/api/site.html carries an ETag', async () => {
    await writeSite('site.html', '<html><body>x</body></html>');
    extractViaTag.mockResolvedValue({ t: 'x' });

    const res = await request(app).get('/_/api/site.html');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ t: 'x' });
    expect(res.headers.etag).toBeTruthy();
  });
});
