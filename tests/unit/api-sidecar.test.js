const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Keep the ESM engine out of jest — the IO layer never needs the real extractor.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn()
}));

const { extractViaTag } = require('../../src/main/utils/data-extractor');
const {
  sidecarRelPath,
  resolveSidecarPath,
  writeApiSidecarData,
  writeApiSidecar,
  deleteApiSidecar,
  readFreshSidecar
} = require('../../src/main/utils/api-sidecar');

describe('sidecarRelPath', () => {
  test('maps names to .hyperclay/api/<name>.json, stripping .html/.htmlclay', () => {
    expect(sidecarRelPath('index.html')).toBe('.hyperclay/api/index.json');
    expect(sidecarRelPath('blog/post.html')).toBe('.hyperclay/api/blog/post.json');
    expect(sidecarRelPath('notes.htmlclay')).toBe('.hyperclay/api/notes.json');
    expect(sidecarRelPath('a/b/c/deep.html')).toBe('.hyperclay/api/a/b/c/deep.json');
  });
});

describe('resolveSidecarPath', () => {
  test('rejects a name that escapes the base directory', () => {
    const base = '/tmp/base';
    expect(() => resolveSidecarPath(base, '../'.repeat(10) + 'etc/passwd.html')).toThrow(/escapes/);
  });
});

describe('api-sidecar filesystem ops', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-'));
    extractViaTag.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const read = (name) => fs.readFile(path.join(dir, '.hyperclay/api', name), 'utf8');

  test('writeApiSidecarData writes bare JSON (no wrapper, no hash)', async () => {
    await writeApiSidecarData(dir, 'index.html', { title: 'Hi' });
    expect(await read('index.json')).toBe('{"title":"Hi"}');
  });

  test('writes empty [] and {} (valid data, not deleted)', async () => {
    await writeApiSidecarData(dir, 'a.html', []);
    await writeApiSidecarData(dir, 'b.html', {});
    expect(await read('a.json')).toBe('[]');
    expect(await read('b.json')).toBe('{}');
  });

  test('overwrites an existing sidecar', async () => {
    await writeApiSidecarData(dir, 'index.html', { v: 1 });
    await writeApiSidecarData(dir, 'index.html', { v: 2 });
    expect(await read('index.json')).toBe('{"v":2}');
  });

  test('null data deletes the sidecar and is a no-op when already absent', async () => {
    await writeApiSidecarData(dir, 'index.html', { a: 1 });
    await writeApiSidecarData(dir, 'index.html', null);
    await expect(read('index.json')).rejects.toThrow();
    await expect(writeApiSidecarData(dir, 'index.html', null)).resolves.toBeUndefined();
  });

  test('non-fatal: swallows a serialization error instead of throwing', async () => {
    const circular = {};
    circular.self = circular;
    await expect(writeApiSidecarData(dir, 'index.html', circular)).resolves.toBeUndefined();
  });

  test('writeApiSidecar writes on a tag and deletes on null', async () => {
    extractViaTag.mockResolvedValueOnce({ title: 'X' });
    await writeApiSidecar(dir, 'index.html', '<html>has tag</html>');
    expect(await read('index.json')).toBe('{"title":"X"}');

    extractViaTag.mockResolvedValueOnce(null);
    await writeApiSidecar(dir, 'index.html', '<html>no tag</html>');
    await expect(read('index.json')).rejects.toThrow();
  });

  test('writeApiSidecar deletes a stale file when the extractor throws', async () => {
    await writeApiSidecarData(dir, 'index.html', { stale: true });
    const err = new Error('bad version');
    err.name = 'UnknownRulesVersion';
    extractViaTag.mockRejectedValueOnce(err);
    await writeApiSidecar(dir, 'index.html', '<html>bad tag</html>');
    await expect(read('index.json')).rejects.toThrow();
  });

  test('deleteApiSidecar removes the file', async () => {
    await writeApiSidecarData(dir, 'index.html', { a: 1 });
    await deleteApiSidecar(dir, 'index.html');
    await expect(read('index.json')).rejects.toThrow();
  });

  test('readFreshSidecar returns text only when the sidecar is at least as new as the source', async () => {
    await writeApiSidecarData(dir, 'index.html', { a: 1 });
    const sidecarPath = path.join(dir, '.hyperclay/api/index.json');
    const st = await fs.stat(sidecarPath);
    expect(await readFreshSidecar(dir, 'index.html', st.mtimeMs - 1000)).toBe('{"a":1}');
    expect(await readFreshSidecar(dir, 'index.html', st.mtimeMs + 1000)).toBeNull();
    expect(await readFreshSidecar(dir, 'missing.html', 0)).toBeNull();
  });
});
