// C1.4: everything this app derives from a served folder lives under its
// `.hyperclay/` directory, so the folder's own files are never mixed with a
// version store or a generated stylesheet. The legacy `sites-versions/` store
// stays readable as a fallback and is never written again.
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
const dataGuard = require('../../src/main/data-loss-guard');
const { VERSIONS_DIR, TAILWIND_DIR, LEGACY_VERSIONS_DIR } = require('../../src/main/utils/artifact-paths');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const PAGE = 'http://localhost:4321/index.html';
const DOCUMENT = '<!DOCTYPE html><html><head>'
  + '<link data-tailwind rel="stylesheet" href="/tailwindcss/index.css">'
  + '</head><body class="p-4">saved</body></html>';

describe('C1.4: derived artifacts live under .hyperclay/', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-paths-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), '<html><body>original</body></html>');
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const save = () => request(app)
    .post('/save')
    .set('Document-URL', PAGE)
    .set('Content-Type', 'text/plain')
    .send(DOCUMENT);

  const legacyVersion = (body) =>
    path.join(dir, LEGACY_VERSIONS_DIR, 'index', '2026-01-01-00-00-00-000Z.html');

  async function plantLegacyVersion(body) {
    const file = legacyVersion(body);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return file;
  }

  test('a save writes the version and the stylesheet under .hyperclay/, and no sites-versions/', async () => {
    const res = await save();
    expect(res.status).toBe(200);

    const versions = await fs.readdir(path.join(dir, VERSIONS_DIR, 'index'));
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((name) => name.endsWith('.html'))).toBe(true);

    const css = await fs.readFile(path.join(dir, TAILWIND_DIR, 'index.css'), 'utf8');
    expect(css).toContain('.p-4');

    await expect(fs.access(path.join(dir, LEGACY_VERSIONS_DIR))).rejects.toThrow();
  });

  test('a legacy sites-versions entry still backs the guard when no new version exists', async () => {
    await plantLegacyVersion('<html><body>LEGACY GOOD</body></html>');

    const pinned = await dataGuard._captureRecoverPath(dir, 'index.html', null);

    expect(pinned).toContain(path.join('.hyperclay', 'guard'));
    expect(await fs.readFile(pinned, 'utf8')).toBe('<html><body>LEGACY GOOD</body></html>');
  });

  test('a .hyperclay version outranks a legacy one', async () => {
    await plantLegacyVersion('<html><body>LEGACY</body></html>');

    await save();

    const pinned = await dataGuard._captureRecoverPath(dir, 'index.html', null);
    const body = await fs.readFile(pinned, 'utf8');
    expect(body).toContain('class="p-4"');
    expect(body).not.toContain('LEGACY');
  });

  test('GET /.hyperclay/versions/... is 404 over HTTP', async () => {
    await save();
    const name = (await fs.readdir(path.join(dir, VERSIONS_DIR, 'index')))[0];
    const body = await fs.readFile(path.join(dir, VERSIONS_DIR, 'index', name), 'utf8');

    const res = await request(app).get(`/.hyperclay/versions/index/${name}`);

    expect(res.status).toBe(404);
    expect(res.text).not.toBe(body);
  });
});
