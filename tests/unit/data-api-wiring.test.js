const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

// Mock the ESM engine wrapper so this jest suite stays pure-CJS; we're testing
// Express route ordering + the marker gate, not extraction itself.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn()
}));

const { extractData, extractViaTag, parseExtractionRules } = require('../../src/main/utils/data-extractor');
const { createApp } = require('../../src/main/server.js');

describe('data API route wiring', () => {
  let dir;
  let app;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiring-'));
    extractData.mockReset();
    extractViaTag.mockReset();
    parseExtractionRules.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  async function writeSite(name, html) {
    const p = path.join(dir, name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, html);
  }

  test('/_/api/<name>.html returns extracted JSON and writes the sidecar', async () => {
    await writeSite('index.html', '<html>x</html>');
    extractViaTag.mockResolvedValue({ title: 'Hi' });
    const res = await request(app).get('/_/api/index.html');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: 'Hi' });
    expect(res.headers['x-served-by']).toBe('app-generated');
    expect(await fs.readFile(path.join(dir, '.hyperclay/api/index.json'), 'utf8')).toBe('{"title":"Hi"}');
  });

  test('bare /api/<name>.html falls through to static — serves the real file, not extraction', async () => {
    await writeSite('api/thing.html', '<html><body>REAL FILE</body></html>');
    const res = await request(app).get('/api/thing.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('REAL FILE');
    expect(extractViaTag).not.toHaveBeenCalled();
  });

  test('/_/api with no file → index.html data', async () => {
    await writeSite('index.html', '<html>x</html>');
    extractViaTag.mockResolvedValue({ root: true });
    const res = await request(app).get('/_/api');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ root: true });
  });

  test('/_/api/<name>.htmlclay works', async () => {
    await writeSite('notes.htmlclay', '<html>x</html>');
    extractViaTag.mockResolvedValue({ ok: 1 });
    const res = await request(app).get('/_/api/notes.htmlclay');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: 1 });
  });

  test('<name>.html?data=... intercepts before the static catch-all', async () => {
    await writeSite('index.html', '<html><h1>Hi</h1></html>');
    parseExtractionRules.mockResolvedValue({ title: 'h1' });
    extractData.mockResolvedValue({ title: 'Hi' });
    const res = await request(app).get('/index.html').query({ data: '{title:"h1"}' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ title: 'Hi' });
  });

  test('<name>.html without ?data= serves raw HTML', async () => {
    await writeSite('index.html', '<html><body>RAW</body></html>');
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('RAW');
    expect(extractData).not.toHaveBeenCalled();
  });

  test('nested SPA path resolves the .htmlclay file for ?data=', async () => {
    await writeSite('blog/app.htmlclay', '<html><h1>Blog</h1></html>');
    parseExtractionRules.mockResolvedValue({ t: 'h1' });
    extractData.mockResolvedValue({ t: 'Blog' });
    const res = await request(app).get('/blog/app.htmlclay/settings').query({ data: '{t:"h1"}' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ t: 'Blog' });
  });

  test('POST /_/save regenerates the sidecar', async () => {
    extractViaTag.mockResolvedValue({ saved: true });
    const res = await request(app)
      .post('/_/save')
      .set('page-url', 'http://localhost:4321/index.html')
      .set('Content-Type', 'application/json')
      .send({ content: '<html><body>hi</body></html>' });
    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, '.hyperclay/api/index.json'), 'utf8')).toBe('{"saved":true}');
  });
});
