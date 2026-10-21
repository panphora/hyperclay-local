const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const {
  getInode,
  getInodeSync,
  upgradeIdentities
} = require('../../src/sync-engine/node-map');
const { snapshotDisk } = require('../../src/sync-engine/reconcile/disk-snapshot');
const { diffTree } = require('../../src/sync-engine/reconcile/tree-diff');

const SHAPE = /^\d+:\d+$/;

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-identity-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const inoOf = (p) => String(fsSync.statSync(p, { bigint: true }).ino);

describe('a file identity', () => {
  test('is the same <digits>:<digits> string from getInode and getInodeSync', async () => {
    const filePath = path.join(tmpDir, 'page.html');
    await fs.writeFile(filePath, 'content');

    const fromAsync = await getInode(filePath);
    const fromSync = getInodeSync(filePath);

    expect(fromAsync).toMatch(SHAPE);
    expect(fromSync).toBe(fromAsync);
    expect(fromAsync.split(':')[0]).toBe(inoOf(filePath));
  });

  test('survives a rename in place', async () => {
    const before = path.join(tmpDir, 'before.html');
    await fs.writeFile(before, 'content');
    const identity = getInodeSync(before);

    const after = path.join(tmpDir, 'after.html');
    await fs.rename(before, after);

    expect(getInodeSync(after)).toBe(identity);
    expect(getInodeSync(before)).toBeNull();
  });

  test('a reused folder identity does not relocate an unrelated folder into uploads', async () => {
    const gone = path.join(tmpDir, 'uploads');
    const child = path.join(gone, 'photo.png');
    await fs.mkdir(gone);
    await fs.writeFile(child, 'original');
    const oldIdentity = getInodeSync(gone);
    const ledger = new Map([
      ['10', { type: 'folder', path: 'uploads', inode: oldIdentity }],
      ['11', { type: 'upload', path: 'uploads/photo.png', inode: getInodeSync(child) }]
    ]);

    await fs.rm(gone, { recursive: true, force: true });
    const fresh = path.join(tmpDir, 'new-project');
    await fs.mkdir(fresh);
    await fs.writeFile(path.join(fresh, 'notes.txt'), 'unrelated');
    const newIdentity = getInodeSync(fresh);
    expect(newIdentity).toMatch(SHAPE);

    const { entries } = await snapshotDisk(tmpDir);
    entries.get('new-project').inode = oldIdentity;
    const { ops } = diffTree({ ledger, disk: entries, mode: 'catchup' });

    expect(ops).toContainEqual({ op: 'restoreLocked', from: null });
    expect(ops).toContainEqual({ op: 'new', kind: 'folder', path: 'new-project' });
    expect(ops).not.toContainEqual({ op: 'restoreLocked', from: 'new-project' });

    const emptyLedger = new Map([['10', ledger.get('10')]]);
    const emptyOps = diffTree({ ledger: emptyLedger, disk: entries, mode: 'catchup' }).ops;
    expect(emptyOps).toContainEqual({ op: 'restoreLocked', from: null });
    expect(emptyOps).toContainEqual({ op: 'new', kind: 'folder', path: 'new-project' });
    expect(emptyOps).not.toContainEqual({ op: 'restoreLocked', from: 'new-project' });
  });
});

describe('upgradeIdentities', () => {
  test('gives an entry whose number is the file\'s own inode its full identity', async () => {
    const filePath = path.join(tmpDir, 'page.html');
    await fs.writeFile(filePath, 'content');

    const map = new Map([['7', { type: 'site', path: 'page.html', inode: Number(inoOf(filePath)) }]]);
    await upgradeIdentities(map, tmpDir);

    expect(map.get('7').inode).toBe(getInodeSync(filePath));
    expect(map.get('7').inode).toMatch(SHAPE);
  });

  test('leaves the number alone when the entry\'s path is gone', async () => {
    const map = new Map([['7', { type: 'site', path: 'gone.html', inode: 12345 }]]);
    await upgradeIdentities(map, tmpDir);

    expect(map.get('7').inode).toBe(12345);
  });

  test('leaves the number alone when it is another file\'s inode', async () => {
    const filePath = path.join(tmpDir, 'page.html');
    await fs.writeFile(filePath, 'content');

    const map = new Map([['7', { type: 'site', path: 'page.html', inode: Number(inoOf(filePath)) + 1 }]]);
    await upgradeIdentities(map, tmpDir);

    expect(map.get('7').inode).toBe(Number(inoOf(filePath)) + 1);
  });

  test('leaves an entry that already holds a string untouched', async () => {
    const filePath = path.join(tmpDir, 'page.html');
    await fs.writeFile(filePath, 'content');

    const map = new Map([['7', { type: 'site', path: 'page.html', inode: '42:99' }]]);
    await upgradeIdentities(map, tmpDir);

    expect(map.get('7').inode).toBe('42:99');
  });
});
