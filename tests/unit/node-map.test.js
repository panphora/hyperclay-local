const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { load, save, loadState, saveState, getInode } = require('../../src/sync-engine/node-map');

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-map-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('node map load/save', () => {
  test('returns empty map when no file exists', async () => {
    const map = await load(tmpDir);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  test('round-trips a map through save and load', async () => {
    const original = new Map([
      ['42', { path: 'index.html', checksum: 'abc123', inode: 12345 }],
      ['73', { path: 'blog/hello.html', checksum: 'def456', inode: 67890 }]
    ]);

    await save(tmpDir, original);
    const loaded = await load(tmpDir);

    expect(loaded.size).toBe(2);
    expect(loaded.get('42')).toEqual({ path: 'index.html', checksum: 'abc123', inode: 12345 });
    expect(loaded.get('73')).toEqual({ path: 'blog/hello.html', checksum: 'def456', inode: 67890 });
  });

  test('creates meta directory if missing', async () => {
    const metaDir = path.join(tmpDir, 'nested', 'meta');
    await save(metaDir, new Map([['1', { path: 'test.html', checksum: null, inode: null }]]));
    const stat = await fs.stat(metaDir);
    expect(stat.isDirectory()).toBe(true);
  });

  test('overwrites existing map on save', async () => {
    await save(tmpDir, new Map([['1', { path: 'old.html', checksum: null, inode: null }]]));
    await save(tmpDir, new Map([['2', { path: 'new.html', checksum: null, inode: null }]]));

    const loaded = await load(tmpDir);
    expect(loaded.size).toBe(1);
    expect(loaded.has('1')).toBe(false);
    expect(loaded.get('2')).toEqual({ path: 'new.html', checksum: null, inode: null });
  });

  test('returns empty map on corrupt JSON', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'node-map.json'), '{not valid json');

    const map = await load(tmpDir);
    expect(map.size).toBe(0);
  });
});

describe('node map migration from old format', () => {
  test('migrates plain string values to object format', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'node-map.json'),
      JSON.stringify({ '42': 'index.html', '73': 'blog/hello.html' })
    );

    const loaded = await load(tmpDir);

    expect(loaded.size).toBe(2);
    expect(loaded.get('42')).toEqual({ path: 'index.html', checksum: null, inode: null });
    expect(loaded.get('73')).toEqual({ path: 'blog/hello.html', checksum: null, inode: null });
  });

  test('handles mixed old and new format entries', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'node-map.json'),
      JSON.stringify({
        '42': 'old-format.html',
        '73': { path: 'new-format.html', checksum: 'abc', inode: 999 }
      })
    );

    const loaded = await load(tmpDir);

    expect(loaded.get('42')).toEqual({ path: 'old-format.html', checksum: null, inode: null });
    expect(loaded.get('73')).toEqual({ path: 'new-format.html', checksum: 'abc', inode: 999 });
  });
});

describe('getInode', () => {
  test('returns inode for an existing file', async () => {
    const filePath = path.join(tmpDir, 'test.html');
    await fs.writeFile(filePath, 'content');

    const inode = await getInode(filePath);

    expect(typeof inode).toBe('number');
    expect(inode).toBeGreaterThan(0);
  });

  test('returns null for non-existent file', async () => {
    const inode = await getInode(path.join(tmpDir, 'nonexistent.html'));
    expect(inode).toBeNull();
  });

  test('returns consistent inode for same file', async () => {
    const filePath = path.join(tmpDir, 'test.html');
    await fs.writeFile(filePath, 'content');

    const inode1 = await getInode(filePath);
    const inode2 = await getInode(filePath);

    expect(inode1).toBe(inode2);
  });
});

describe('sync state load/save', () => {
  test('returns empty object when no file exists', async () => {
    const state = await loadState(tmpDir);
    expect(state).toEqual({});
  });

  test('round-trips lastSyncedAt', async () => {
    const ts = Date.now();
    await saveState(tmpDir, { lastSyncedAt: ts });
    const state = await loadState(tmpDir);
    expect(state.lastSyncedAt).toBe(ts);
  });

  test('returns empty object on corrupt JSON', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'sync-state.json'), 'broken');

    const state = await loadState(tmpDir);
    expect(state).toEqual({});
  });
});
