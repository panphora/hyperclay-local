const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const NodeRepository = require('../../src/sync-engine/state/node-repository');

let tmpDir;
let repo;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-tombstone-test-'));
  repo = new NodeRepository();
  repo.attach(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('NodeRepository tombstone API', () => {
  test('isTombstoned returns false initially', () => {
    expect(repo.isTombstoned('a/x.html')).toBe(false);
    expect(repo.tombstoneSize).toBe(0);
  });

  test('addTombstone records a path', async () => {
    await repo.addTombstone('a/x.html');
    expect(repo.isTombstoned('a/x.html')).toBe(true);
    expect(repo.tombstoneSize).toBe(1);
  });

  test('addTombstone ignores falsy paths', async () => {
    await repo.addTombstone(null);
    await repo.addTombstone('');
    await repo.addTombstone(undefined);
    expect(repo.tombstoneSize).toBe(0);
  });

  test('addTombstones records multiple paths in a single persist', async () => {
    await repo.addTombstones(['a/x.html', 'a/b/y.html', 'a/b/c/z.html']);
    expect(repo.isTombstoned('a/x.html')).toBe(true);
    expect(repo.isTombstoned('a/b/y.html')).toBe(true);
    expect(repo.isTombstoned('a/b/c/z.html')).toBe(true);
    expect(repo.tombstoneSize).toBe(3);
  });

  test('clearTombstone removes a path', async () => {
    await repo.addTombstone('a/x.html');
    await repo.clearTombstone('a/x.html');
    expect(repo.isTombstoned('a/x.html')).toBe(false);
    expect(repo.tombstoneSize).toBe(0);
  });

  test('set() auto-clears a tombstone when a new entry lands at that path', async () => {
    await repo.addTombstone('a/x.html');
    expect(repo.isTombstoned('a/x.html')).toBe(true);

    await repo.set('42', { type: 'site', path: 'a/x.html', checksum: 'abc', inode: 1 });
    expect(repo.isTombstoned('a/x.html')).toBe(false);
    expect(repo.tombstoneSize).toBe(0);
  });

  test('set() does NOT clear tombstones at other paths', async () => {
    await repo.addTombstones(['a/x.html', 'b/y.html']);
    await repo.set('42', { type: 'site', path: 'c/z.html', checksum: null, inode: null });
    expect(repo.isTombstoned('a/x.html')).toBe(true);
    expect(repo.isTombstoned('b/y.html')).toBe(true);
    expect(repo.tombstoneSize).toBe(2);
  });

  test('apply() batch-clears tombstones for every live entry path', async () => {
    await repo.addTombstones(['a/x.html', 'a/y.html', 'a/z.html']);
    await repo.apply(async (map) => {
      map.set('10', { type: 'site', path: 'a/x.html', checksum: null, inode: null });
      map.set('11', { type: 'site', path: 'a/y.html', checksum: null, inode: null });
    });
    expect(repo.isTombstoned('a/x.html')).toBe(false);
    expect(repo.isTombstoned('a/y.html')).toBe(false);
    expect(repo.isTombstoned('a/z.html')).toBe(true); // not re-created
    expect(repo.tombstoneSize).toBe(1);
  });

  test('loadTombstones persists across instances', async () => {
    await repo.addTombstones(['a/x.html', 'b/y.html']);
    expect(repo.tombstoneSize).toBe(2);

    const repo2 = new NodeRepository();
    repo2.attach(tmpDir);
    await repo2.loadTombstones();
    expect(repo2.isTombstoned('a/x.html')).toBe(true);
    expect(repo2.isTombstoned('b/y.html')).toBe(true);
  });

  test('set() persists tombstone removal across instances', async () => {
    await repo.addTombstone('a/x.html');
    await repo.set('42', { type: 'site', path: 'a/x.html', checksum: null, inode: null });

    const repo2 = new NodeRepository();
    repo2.attach(tmpDir);
    await repo2.loadTombstones();
    expect(repo2.isTombstoned('a/x.html')).toBe(false);
  });
});
