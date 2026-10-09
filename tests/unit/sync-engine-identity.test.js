const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const {
  getInode,
  getInodeSync,
  upgradeIdentities
} = require('../../src/sync-engine/node-map');

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

  test('differs from the identity of the folder that was deleted to make room', async () => {
    const gone = path.join(tmpDir, 'uploads');
    await fs.mkdir(gone);
    const oldIdentity = getInodeSync(gone);
    const oldIno = inoOf(gone);

    await fs.rm(gone, { recursive: true, force: true });
    const fresh = path.join(tmpDir, 'new-project');
    await fs.mkdir(fresh);
    const newIdentity = getInodeSync(fresh);

    expect(newIdentity).not.toBe(oldIdentity);
    if (inoOf(fresh) === oldIno) {
      expect(newIdentity).toBe(`${oldIno}:${newIdentity.split(':')[1]}`);
      expect(newIdentity).not.toBe(oldIdentity);
    }
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
