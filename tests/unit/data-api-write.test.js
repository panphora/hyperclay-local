const fs = require('fs').promises;
const path = require('path');
const os = require('os');

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn(),
  writeViaTag: jest.fn()
}));

const { extractViaTag, writeViaTag } = require('../../src/main/utils/data-extractor');
const { applySiteDataLocal } = require('../../src/main/utils/data-api');
const { documentEtag } = require('../../src/main/spec-wire');

const ORIGINAL = '<html><body>x</body></html>';

describe('applySiteDataLocal', () => {
  let dir;
  let file;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-write-'));
    file = path.join(dir, 'site.html');
    await fs.writeFile(file, ORIGINAL);
    writeViaTag.mockReset();
    extractViaTag.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    jest.restoreAllMocks();
  });

  const commitSpy = () =>
    jest.fn(async (html) => {
      await fs.writeFile(file, html);
      return html;
    });

  test('a changed write commits the new bytes and answers with the fresh data', async () => {
    const commit = commitSpy();
    writeViaTag.mockResolvedValue({ html: '<html>NEW</html>', changed: true, spliced: true });
    extractViaTag.mockResolvedValue({ t: 'NEW' });

    const r = await applySiteDataLocal(dir, 'site.html', { t: 'NEW' }, { commit });

    expect(r.status).toBe(200);
    expect(r.json).toEqual({ t: 'NEW' });
    expect(r.headers.ETag).toBe(documentEtag(Buffer.from('<html>NEW</html>')));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('<html>NEW</html>', ORIGINAL);
    expect(await fs.readFile(file, 'utf8')).toBe('<html>NEW</html>');
  });

  test('a body that changes nothing writes nothing', async () => {
    const commit = commitSpy();
    writeViaTag.mockResolvedValue({ html: ORIGINAL, changed: false, spliced: true });
    extractViaTag.mockResolvedValue({ t: 'x' });

    const r = await applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit });

    expect(r.status).toBe(200);
    expect(r.json).toEqual({ t: 'x' });
    expect(commit).not.toHaveBeenCalled();
    expect(await fs.readFile(file, 'utf8')).toBe(ORIGINAL);
  });

  test('a source that does not exist is a 404 and never reaches the engine', async () => {
    const commit = commitSpy();
    const r = await applySiteDataLocal(dir, 'gone.html', { t: 'x' }, { commit });

    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Site content not found');
    expect(writeViaTag).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  test('a stale If-Match is refused with the stored stamp and writes nothing', async () => {
    const commit = commitSpy();
    const r = await applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit, ifMatch: '"nope"' });

    expect(r.status).toBe(412);
    expect(r.headers.ETag).toBe(documentEtag(Buffer.from(ORIGINAL)));
    expect(writeViaTag).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  test('a fresh If-Match proceeds', async () => {
    const commit = commitSpy();
    writeViaTag.mockResolvedValue({ html: '<html>NEW</html>', changed: true, spliced: true });
    extractViaTag.mockResolvedValue({ t: 'NEW' });

    const r = await applySiteDataLocal(dir, 'site.html', { t: 'NEW' }, {
      commit,
      ifMatch: documentEtag(Buffer.from(ORIGINAL))
    });

    expect(r.status).toBe(200);
    expect(writeViaTag).toHaveBeenCalled();
  });

  test('every mapped engine error is a 400 with its own error string', async () => {
    const cases = [
      [Object.assign(new Error('no tag'), { name: 'NoRulesTag' }), 'No api rules tag'],
      [
        Object.assign(new Error('write rejected: 1 unknown key(s), 0 rule(s) with no matching element'), {
          name: 'WriteRejected',
          unknownKeys: ['x'],
          unmatched: []
        }),
        'Write rejected'
      ],
      [
        Object.assign(new Error('write refused: 1 write(s) broke the content-only policy'), {
          name: 'WriteRefused',
          refusals: [{ target: '<a>', reason: 'r' }]
        }),
        'Write refused'
      ],
      [Object.assign(new Error('shape mismatch'), { name: 'ShapeMismatch', mismatches: [] }), 'Shape mismatch'],
      [Object.assign(new Error('cannot add items to empty list'), { name: 'EmptyListInsert', path: ['items'] }), 'Cannot grow list'],
      [Object.assign(new Error('bad json'), { name: 'RulesParseError' }), 'Malformed api rules tag']
    ];

    for (const [err, expected] of cases) {
      const commit = commitSpy();
      writeViaTag.mockReset();
      writeViaTag.mockRejectedValue(err);
      const r = await applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit });
      expect(r.status).toBe(400);
      expect(r.json.error).toBe(expected);
      expect(commit).not.toHaveBeenCalled();
    }
  });

  test('a WriteRejected carries unknownKeys and unmatched as details', async () => {
    const commit = commitSpy();
    writeViaTag.mockRejectedValue(
      Object.assign(new Error('write rejected'), { name: 'WriteRejected', unknownKeys: ['x'], unmatched: [] })
    );

    const r = await applySiteDataLocal(dir, 'site.html', { x: 1 }, { commit });

    expect(r.status).toBe(400);
    expect(r.json.details).toEqual({ unknownKeys: ['x'], unmatched: [] });
  });

  test('an unmapped engine error propagates (→ 500 at the route)', async () => {
    const commit = commitSpy();
    writeViaTag.mockRejectedValue(Object.assign(new Error('boom'), { name: 'TypeError' }));

    await expect(applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit })).rejects.toThrow('boom');
    expect(commit).not.toHaveBeenCalled();
  });
});
