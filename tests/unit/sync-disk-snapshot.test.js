const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { snapshotDisk } = require('../../src/sync-engine/reconcile/disk-snapshot');

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcl-snapshot-'));
});

afterEach(async () => {
  await fs.chmod(root, 0o755).catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
});

async function write(rel, content = 'x') {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const skipUnreadable = process.platform === 'win32' || runningAsRoot;

describe('snapshotDisk', () => {
  it('records files and folders with a type and a strong inode', async () => {
    await write('alpha.txt', 'hello');
    await fs.mkdir(path.join(root, 'beta'));
    await write('beta/inner.txt', 'world');

    const { entries, unreadable } = await snapshotDisk(root);

    expect(unreadable.size).toBe(0);
    expect(entries.get('alpha.txt')).toMatchObject({ type: 'file', size: 5 });
    expect(entries.get('alpha.txt').inode).toMatch(/^\d+:\d+$/);
    expect(entries.get('alpha.txt').mtimeMs).toEqual(expect.any(Number));
    expect(entries.get('beta')).toMatchObject({ type: 'folder' });
    expect(entries.get('beta').inode).toMatch(/^\d+:\d+$/);
    expect(entries.get('beta/inner.txt')).toMatchObject({ type: 'file', size: 5 });
    expect(entries.get('beta/inner.txt').inode).toMatch(/^\d+:\d+$/);
  });

  it('returns entries in sorted path order', async () => {
    await write('gamma.txt');
    await write('alpha.txt');
    await write('beta/inner.txt');

    const { entries } = await snapshotDisk(root);

    expect([...entries.keys()]).toEqual(['alpha.txt', 'beta', 'beta/inner.txt', 'gamma.txt']);
  });

  it('skips symbolic links', async () => {
    await write('real.txt', 'real');
    await write('target/inner.txt', 'inner');
    await fs.symlink(path.join(root, 'real.txt'), path.join(root, 'link.txt'));
    await fs.symlink(path.join(root, 'target'), path.join(root, 'linkdir'));

    const { entries } = await snapshotDisk(root);

    expect(entries.has('link.txt')).toBe(false);
    expect(entries.has('linkdir')).toBe(false);
    expect(entries.has('real.txt')).toBe(true);
    expect(entries.has('target/inner.txt')).toBe(true);
  });

  it('skips an ignored path together with its subtree', async () => {
    await write('keep.txt');
    await write('skip/a.txt');
    await write('skip/sub/b.txt');
    await write('skipped-file.txt');

    const { entries } = await snapshotDisk(root, {
      ignore: (rel) => rel === 'skip' || rel === 'skipped-file.txt'
    });

    expect([...entries.keys()]).toEqual(['keep.txt']);
  });

  (skipUnreadable ? it.skip : it)('puts an unreadable folder in unreadable and omits its children', async () => {
    await write('open.txt');
    await write('locked/a.txt');
    const locked = path.join(root, 'locked');
    await fs.chmod(locked, 0o000);

    try {
      const { entries, unreadable } = await snapshotDisk(root);

      expect([...unreadable]).toEqual(['locked']);
      expect(entries.has('locked')).toBe(true);
      expect(entries.has('locked/a.txt')).toBe(false);
      expect(entries.has('open.txt')).toBe(true);
    } finally {
      await fs.chmod(locked, 0o755);
    }
  });

  it('returns an empty result for a root that does not exist', async () => {
    const { entries, unreadable } = await snapshotDisk(path.join(root, 'missing'));

    expect(entries.size).toBe(0);
    expect(unreadable.size).toBe(0);
  });
});
