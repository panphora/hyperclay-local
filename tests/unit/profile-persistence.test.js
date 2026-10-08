const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeJsonAtomic } = require('../../src/main/settings-file');

const readOnlyDirUnsupported = () => process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);

describe('writeJsonAtomic', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-file-'));
    file = path.join(dir, 'settings.json');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    try { fs.chmodSync(dir, 0o700); } catch {}
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('writes readable JSON with owner-only mode and leaves no temp file', () => {
    const result = writeJsonAtomic(file, { profile: { enabled: true, id: 'L0c4lPr0f1l3Id0000000', name: 'Ada Chen' } });
    expect(result).toEqual({ ok: true });

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ profile: { enabled: true, id: 'L0c4lPr0f1l3Id0000000', name: 'Ada Chen' } });
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('creates the containing directory', () => {
    const nested = path.join(dir, 'one', 'two', 'settings.json');
    expect(writeJsonAtomic(nested, { ok: 1 })).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(nested, 'utf8'))).toEqual({ ok: 1 });
  });

  test('a failed write returns the error and leaves the old file untouched', () => {
    if (readOnlyDirUnsupported()) return;

    expect(writeJsonAtomic(file, { version: 'A' })).toEqual({ ok: true });
    fs.chmodSync(dir, 0o500);

    let second;
    expect(() => { second = writeJsonAtomic(file, { version: 'B' }); }).not.toThrow();
    expect(second.ok).toBe(false);
    expect(second.error).toBeTruthy();
    expect(typeof second.error.message).toBe('string');
    expect(second.error.message).toMatch(/EACCES|EPERM|permission denied/i);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 'A' });
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('flushes the temp file to disk before the rename', () => {
    const fsync = jest.spyOn(fs, 'fsyncSync');

    expect(writeJsonAtomic(file, { version: 'A' })).toEqual({ ok: true });

    expect(fsync).toHaveBeenCalledTimes(1);
  });

  test('retries the rename once when the first attempt is refused', () => {
    expect(writeJsonAtomic(file, { version: 'A' })).toEqual({ ok: true });

    const real = fs.renameSync;
    let calls = 0;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('x'), { code: 'EPERM' });
      return real.call(fs, from, to);
    });

    expect(writeJsonAtomic(file, { version: 'B' })).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 'B' });
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('a rename refused twice returns the error and leaves the old file intact', () => {
    expect(writeJsonAtomic(file, { version: 'A' })).toEqual({ ok: true });

    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('x'), { code: 'EBUSY' });
    });

    const result = writeJsonAtomic(file, { version: 'B' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('EBUSY');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 'A' });
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('an error other than a refused rename is not retried', () => {
    expect(writeJsonAtomic(file, { version: 'A' })).toEqual({ ok: true });

    const real = fs.renameSync;
    let calls = 0;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('x'), { code: 'ENOENT' });
      return real.call(fs, from, to);
    });

    const result = writeJsonAtomic(file, { version: 'B' });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 'A' });
  });

  test('round-trips unknown fields unchanged', () => {
    const data = {
      future: { x: 1, list: [1, 2, { deep: true }] },
      profile: { enabled: true, id: 'L0c4lPr0f1l3Id0000000', name: 'Ada Chen' },
      actor: { id: 42, origin: 'https://hyperclay.com', person: { id: 'q8Zr2mKx0vTn4yWb7cLd1e', name: 'Ada' } }
    };

    expect(writeJsonAtomic(file, data)).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(data);
  });
});
