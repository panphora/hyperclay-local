const fs = require('fs').promises;
const path = require('path');
const os = require('os');

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn()
}));

const { extractViaTag } = require('../../src/main/utils/data-extractor');
const { serveSiteApiLocal } = require('../../src/main/utils/data-api');

describe('serveSiteApiLocal', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-serve-'));
    extractViaTag.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const sidecarPath = (name) =>
    path.join(dir, '.hyperclay/api', name.replace(/\.(html|htmlclay)$/, '') + '.json');

  async function writeSite(name, html) {
    const p = path.join(dir, name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, html);
  }
  async function writeSidecar(name, json, mtimeOffsetMs) {
    const sp = sidecarPath(name);
    await fs.mkdir(path.dirname(sp), { recursive: true });
    await fs.writeFile(sp, json);
    if (mtimeOffsetMs !== undefined) {
      const t = new Date(Date.now() + mtimeOffsetMs);
      await fs.utimes(sp, t, t);
    }
    return sp;
  }

  test('miss → regenerate → 200 + X-Served-By + sidecar on disk', async () => {
    await writeSite('index.html', '<html>x</html>');
    extractViaTag.mockResolvedValue({ title: 'Hi' });
    const r = await serveSiteApiLocal(dir, 'index.html');
    expect(r.status).toBe(200);
    expect(r.headers['X-Served-By']).toBe('app-generated');
    expect(r.json).toEqual({ title: 'Hi' });
    expect(await fs.readFile(sidecarPath('index.html'), 'utf8')).toBe('{"title":"Hi"}');
  });

  test('fresh hit → raw body, extractor not called, not double-encoded', async () => {
    await writeSite('index.html', '<html>x</html>');
    await writeSidecar('index.html', '{"cached":true}', 10000); // newer than source
    const r = await serveSiteApiLocal(dir, 'index.html');
    expect(r.status).toBe(200);
    expect(r.raw).toBe('{"cached":true}');
    expect(r.json).toBeUndefined();
    expect(extractViaTag).not.toHaveBeenCalled();
  });

  test('stale sidecar (source newer) → regenerate', async () => {
    await writeSite('index.html', '<html>x</html>');
    await writeSidecar('index.html', '{"old":true}', -10000); // older than source
    extractViaTag.mockResolvedValue({ fresh: true });
    const r = await serveSiteApiLocal(dir, 'index.html');
    expect(r.json).toEqual({ fresh: true });
    expect(extractViaTag).toHaveBeenCalledTimes(1);
  });

  test('source missing → 404 and stale sidecar deleted', async () => {
    const sp = await writeSidecar('gone.html', '{"stale":1}');
    const r = await serveSiteApiLocal(dir, 'gone.html');
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Site content not found');
    await expect(fs.readFile(sp, 'utf8')).rejects.toThrow();
  });

  test('no api tag → 400 "No api rules tag" and stale sidecar deleted', async () => {
    await writeSite('index.html', '<html>x</html>');
    const sp = await writeSidecar('index.html', '{"stale":1}', -10000);
    extractViaTag.mockResolvedValue(null);
    const r = await serveSiteApiLocal(dir, 'index.html');
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('No api rules tag');
    await expect(fs.readFile(sp, 'utf8')).rejects.toThrow();
  });

  test('bad-tag errors map to the platform 400 shapes', async () => {
    await writeSite('index.html', '<html>x</html>');
    const cases = [
      [Object.assign(new Error('v2'), { name: 'UnknownRulesVersion' }), { error: 'Unsupported rules version', message: 'v2' }],
      [Object.assign(new Error('boom'), { name: 'RulesParseError' }), { error: 'Malformed api rules tag', message: 'The api rules tag body is not valid JSON.', details: 'boom' }],
      [new Error('bad selector here'), { error: 'Invalid selector in api rules tag', message: 'bad selector here' }]
    ];
    for (const [err, expected] of cases) {
      extractViaTag.mockReset();
      extractViaTag.mockRejectedValue(err);
      const r = await serveSiteApiLocal(dir, 'index.html');
      expect(r.status).toBe(400);
      expect(r.json).toEqual(expected);
    }
  });

  test('an unmapped extractor error propagates (→ 500 at the route)', async () => {
    await writeSite('index.html', '<html>x</html>');
    extractViaTag.mockRejectedValue(new Error('totally unexpected'));
    await expect(serveSiteApiLocal(dir, 'index.html')).rejects.toThrow('totally unexpected');
  });

  test('.htmlclay source resolves', async () => {
    await writeSite('notes.htmlclay', '<html>x</html>');
    extractViaTag.mockResolvedValue({ ok: 1 });
    const r = await serveSiteApiLocal(dir, 'notes.htmlclay');
    expect(r.status).toBe(200);
    expect(await fs.readFile(sidecarPath('notes.htmlclay'), 'utf8')).toBe('{"ok":1}');
  });
});
