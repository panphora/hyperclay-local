const fs = require('fs').promises;
const realFs = require('fs');
const path = require('path');
const os = require('os');

const { withFileLock, atomicWriteFile } = require('../../src/main/utils/write-queue');

describe('withFileLock', () => {
  test('serializes the whole read-modify-write region, not just the write', async () => {
    // The bug this exists to prevent: two requests read the same stale base and
    // each compute from it, so one increment is lost. Serializing only the write
    // would still let both reads see "1".
    let stored = 1;
    const readModifyWrite = async () => {
      const base = stored;
      await new Promise((r) => setTimeout(r, 10)); // the interleaving window
      stored = base + 1;
    };

    await Promise.all([
      withFileLock('/tmp/interleave', readModifyWrite),
      withFileLock('/tmp/interleave', readModifyWrite)
    ]);

    expect(stored).toBe(3);
  });

  test('without the lock the same region loses an update (control)', async () => {
    let stored = 1;
    const readModifyWrite = async () => {
      const base = stored;
      await new Promise((r) => setTimeout(r, 10));
      stored = base + 1;
    };

    await Promise.all([readModifyWrite(), readModifyWrite()]);

    expect(stored).toBe(2);
  });

  test('preserves submission order', async () => {
    const order = [];
    const task = (n) => withFileLock('/tmp/order', async () => {
      await new Promise((r) => setTimeout(r, 10 - n));
      order.push(n);
    });

    await Promise.all([task(1), task(2), task(3)]);

    expect(order).toEqual([1, 2, 3]);
  });

  test('different keys do not block each other', async () => {
    let released;
    const blocked = new Promise((r) => { released = r; });

    const first = withFileLock('/tmp/key-a', () => blocked);
    let secondRan = false;
    const second = withFileLock('/tmp/key-b', async () => { secondRan = true; });

    await second;
    expect(secondRan).toBe(true);

    released();
    await first;
  });

  test('a rejected task does not poison the next waiter', async () => {
    const failing = withFileLock('/tmp/poison', async () => { throw new Error('boom'); });
    await expect(failing).rejects.toThrow('boom');

    await expect(withFileLock('/tmp/poison', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('atomicWriteFile', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-')));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('writes content and creates missing parent directories', async () => {
    const target = path.join(dir, 'nested', 'deep', 'file.html');
    await atomicWriteFile(target, '<html>hi</html>');

    expect(await fs.readFile(target, 'utf8')).toBe('<html>hi</html>');
  });

  test('crash during save leaves the previous file completely intact', async () => {
    const target = path.join(dir, 'page.html');
    await fs.writeFile(target, '<html>ORIGINAL</html>', 'utf8');

    // Simulate the process dying at the moment of publication. Everything
    // before the rename has already happened.
    const rename = jest.spyOn(realFs.promises, 'rename')
      .mockRejectedValueOnce(new Error('ENOSPC: simulated crash'));

    await expect(atomicWriteFile(target, '<html>NEW</html>')).rejects.toThrow('simulated crash');
    expect(rename).toHaveBeenCalled();

    // The served file is never partial: it is either the old bytes or the new
    // bytes, never a truncation of either.
    expect(await fs.readFile(target, 'utf8')).toBe('<html>ORIGINAL</html>');

    // And the temp file is cleaned up rather than left behind.
    expect(await fs.readdir(dir)).toEqual(['page.html']);
  });

  test('a failed write leaves no temp file behind', async () => {
    const target = path.join(dir, 'page.html');
    jest.spyOn(realFs.promises, 'rename').mockRejectedValueOnce(new Error('nope'));

    await expect(atomicWriteFile(target, 'x')).rejects.toThrow('nope');
    expect(await fs.readdir(dir)).toEqual([]);
  });

  test('a concurrent reader never observes partial content', async () => {
    const target = path.join(dir, 'page.html');
    const original = '<html>' + 'A'.repeat(200000) + '</html>';
    const replacement = '<html>' + 'B'.repeat(200000) + '</html>';
    await fs.writeFile(target, original, 'utf8');

    const writing = atomicWriteFile(target, replacement);

    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      try { seen.add(await fs.readFile(target, 'utf8')); } catch {}
    }
    await writing;
    seen.add(await fs.readFile(target, 'utf8'));

    for (const body of seen) {
      expect([original, replacement]).toContain(body);
    }
  });

  test('preserves the existing file mode rather than re-moding to 0600', async () => {
    const target = path.join(dir, 'page.html');
    await fs.writeFile(target, 'old', 'utf8');
    await fs.chmod(target, 0o644);

    await atomicWriteFile(target, 'new');

    expect((await fs.stat(target)).mode & 0o777).toBe(0o644);
  });

  test('writes Buffer content verbatim when encoding is null', async () => {
    const target = path.join(dir, 'blob.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80]);

    await atomicWriteFile(target, bytes, null);

    expect(Buffer.compare(await fs.readFile(target), bytes)).toBe(0);
  });
});
