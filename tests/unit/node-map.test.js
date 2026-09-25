const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {
  load,
  save,
  loadState,
  saveState,
  getInode,
  loadTombstones,
  saveTombstones,
  readBaseline,
  applyBaseline
} = require('../../src/sync-engine/node-map');
const NodeRepository = require('../../src/sync-engine/state/node-repository');

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
    expect(loaded.get('42')).toEqual({ type: 'site', path: 'index.html', checksum: 'abc123', inode: 12345 });
    expect(loaded.get('73')).toEqual({ type: 'site', path: 'blog/hello.html', checksum: 'def456', inode: 67890 });
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
    expect(loaded.get('2')).toEqual({ type: 'site', path: 'new.html', checksum: null, inode: null });
  });

  test('concurrent saves land in call order, so the newest map is the one on disk', async () => {
    const realRename = fs.rename.bind(fs);
    let delayed = false;
    const spy = jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return realRename(from, to);
    });
    try {
      const older = new Map([['1', { path: 'a.html' }]]);
      const newer = new Map([['1', { path: 'a.html' }], ['2', { path: 'b.html' }]]);
      await Promise.all([save(tmpDir, older), save(tmpDir, newer)]);
      const onDisk = JSON.parse(await fs.readFile(path.join(tmpDir, 'node-map.json'), 'utf8'));
      expect(Object.keys(onDisk).sort()).toEqual(['1', '2']);
    } finally {
      spy.mockRestore();
    }
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
    expect(loaded.get('42')).toEqual({ type: 'site', path: 'index.html', checksum: null, inode: null });
    expect(loaded.get('73')).toEqual({ type: 'site', path: 'blog/hello.html', checksum: null, inode: null });
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

    expect(loaded.get('42')).toEqual({ type: 'site', path: 'old-format.html', checksum: null, inode: null });
    expect(loaded.get('73')).toEqual({ type: 'site', path: 'new-format.html', checksum: 'abc', inode: 999 });
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

describe('tombstone load/save', () => {
  test('returns empty map when file missing', async () => {
    const m = await loadTombstones(tmpDir);
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(0);
  });

  test('round-trips tombstones through save and load', async () => {
    const now = Date.now();
    const original = new Map([
      ['a/stale.html', now],
      ['folder/inner/other.html', now - 1000]
    ]);
    await saveTombstones(tmpDir, original);
    const loaded = await loadTombstones(tmpDir);
    expect(loaded.size).toBe(2);
    expect(loaded.get('a/stale.html')).toBe(now);
    expect(loaded.get('folder/inner/other.html')).toBe(now - 1000);
  });

  test('prunes entries older than 7 days on load', async () => {
    const now = Date.now();
    const stale = now - (8 * 24 * 60 * 60 * 1000); // 8 days
    const fresh = now - (1 * 60 * 60 * 1000);       // 1 hour
    await saveTombstones(tmpDir, new Map([['old.html', stale], ['new.html', fresh]]));
    const loaded = await loadTombstones(tmpDir);
    expect(loaded.has('old.html')).toBe(false);
    expect(loaded.has('new.html')).toBe(true);
  });

  test('returns empty map on corrupt JSON', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'tombstones.json'), '{not valid');
    const m = await loadTombstones(tmpDir);
    expect(m.size).toBe(0);
  });

  test('ignores entries with non-numeric values', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'tombstones.json'),
      JSON.stringify({ 'a.html': 'not a number', 'b.html': Date.now() })
    );
    const loaded = await loadTombstones(tmpDir);
    expect(loaded.has('a.html')).toBe(false);
    expect(loaded.has('b.html')).toBe(true);
  });
});

describe('baseline entry format v2', () => {
  const V2_ENTRY = {
    type: 'site',
    path: 'board.html',
    parentId: null,
    inode: 1234567,
    remoteEtag: '3f9a0c1d2b4e5f60',
    localChecksum: '3f9a0c1d2b4e5f60',
    structureVersion: '9c1e',
    uploadBlocked: false,
    syncedAt: 1790000000000
  };

  test('an old checksum-only entry reads as etag and local checksum alike', () => {
    const baseline = readBaseline({ type: 'site', path: 'board.html', checksum: 'abc123', inode: 1 });
    expect(baseline).toEqual({
      remoteEtag: 'abc123',
      localChecksum: 'abc123',
      structureVersion: null,
      uploadBlocked: false
    });
  });

  test('an entry without a checksum reads as an unknown baseline', () => {
    expect(readBaseline({ type: 'folder', path: 'blog', parentId: null, inode: 7 })).toEqual({
      remoteEtag: null,
      localChecksum: null,
      structureVersion: null,
      uploadBlocked: false
    });
    expect(readBaseline({ type: 'site', path: 'board.html', checksum: null, inode: 1 }).remoteEtag).toBeNull();
  });

  test('a node with no entry has no baseline', () => {
    expect(readBaseline(undefined)).toBeNull();
    expect(readBaseline(null)).toBeNull();
  });

  test('a v2 entry reads back every field decide needs', () => {
    expect(readBaseline(V2_ENTRY)).toEqual({
      remoteEtag: '3f9a0c1d2b4e5f60',
      localChecksum: '3f9a0c1d2b4e5f60',
      structureVersion: '9c1e',
      uploadBlocked: false
    });
    expect(readBaseline({ ...V2_ENTRY, uploadBlocked: true }).uploadBlocked).toBe(true);
  });

  test('a map saved in the old shape loads and maps', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'node-map.json'),
      JSON.stringify({
        '901': { type: 'site', path: 'board.html', inode: 1234567, checksum: 'abc123', syncedAt: 1790000000000 }
      })
    );

    const loaded = await load(tmpDir);
    const entry = loaded.get('901');

    expect(entry.checksum).toBe('abc123');
    expect(readBaseline(entry)).toEqual({
      remoteEtag: 'abc123',
      localChecksum: 'abc123',
      structureVersion: null,
      uploadBlocked: false
    });
  });

  test('a v2 entry round-trips through save and load', async () => {
    await save(tmpDir, new Map([['901', { ...V2_ENTRY }]]));

    const loaded = await load(tmpDir);
    expect(loaded.get('901')).toEqual(V2_ENTRY);
    expect(readBaseline(loaded.get('901'))).toEqual({
      remoteEtag: '3f9a0c1d2b4e5f60',
      localChecksum: '3f9a0c1d2b4e5f60',
      structureVersion: '9c1e',
      uploadBlocked: false
    });
  });

  test('an update that sets only some new fields keeps the others', () => {
    const next = applyBaseline({ ...V2_ENTRY, checksum: '3f9a0c1d2b4e5f60' }, { remoteEtag: 'etag-2' });

    expect(next).toEqual({ ...V2_ENTRY, checksum: '3f9a0c1d2b4e5f60', remoteEtag: 'etag-2' });
    expect(readBaseline(next)).toEqual({
      remoteEtag: 'etag-2',
      localChecksum: '3f9a0c1d2b4e5f60',
      structureVersion: '9c1e',
      uploadBlocked: false
    });
  });

  test('writing localChecksum keeps checksum equal to it', () => {
    const next = applyBaseline(
      { type: 'site', path: 'board.html', checksum: 'old-sum', inode: 1 },
      { remoteEtag: 'etag-2', localChecksum: 'sum-2' }
    );

    expect(next.checksum).toBe('sum-2');
    expect(next.localChecksum).toBe('sum-2');
    expect(next.remoteEtag).toBe('etag-2');
  });

  test('the first update of a legacy entry takes its etag from the old checksum', () => {
    const next = applyBaseline(
      { type: 'site', path: 'board.html', inode: 1, checksum: 'legacy-sum', syncedAt: 1 },
      { localChecksum: 'sum-2' }
    );

    expect(next).toEqual({
      type: 'site',
      path: 'board.html',
      inode: 1,
      syncedAt: 1,
      remoteEtag: 'legacy-sum',
      localChecksum: 'sum-2',
      structureVersion: null,
      uploadBlocked: false,
      checksum: 'sum-2'
    });
  });

  test('a partial update round-trips through save and load', async () => {
    const entry = applyBaseline(
      { type: 'site', path: 'board.html', inode: 1, checksum: 'legacy-sum', syncedAt: 1 },
      { localChecksum: 'sum-2' }
    );
    await save(tmpDir, new Map([['901', entry]]));

    const loaded = await load(tmpDir);
    expect(readBaseline(loaded.get('901'))).toEqual({
      remoteEtag: 'legacy-sum',
      localChecksum: 'sum-2',
      structureVersion: null,
      uploadBlocked: false
    });
    expect(loaded.get('901').checksum).toBe('sum-2');
    expect(loaded.get('901').path).toBe('board.html');
  });
});

describe('NodeRepository baseline API', () => {
  test('updateBaseline merges fields, mirrors checksum and persists', async () => {
    const repo = new NodeRepository();
    repo.attach(tmpDir);
    repo.seed([['901', { type: 'site', path: 'board.html', inode: 1234567, checksum: 'legacy-sum', syncedAt: 1 }]]);

    expect(repo.getBaseline('901')).toEqual({
      remoteEtag: 'legacy-sum',
      localChecksum: 'legacy-sum',
      structureVersion: null,
      uploadBlocked: false
    });

    await repo.updateBaseline('901', { remoteEtag: 'etag-2', localChecksum: 'sum-2' });

    const reloaded = new NodeRepository();
    reloaded.attach(tmpDir);
    await reloaded.load();

    expect(reloaded.getBaseline('901')).toEqual({
      remoteEtag: 'etag-2',
      localChecksum: 'sum-2',
      structureVersion: null,
      uploadBlocked: false
    });
    expect(reloaded.get('901').checksum).toBe('sum-2');
    expect(reloaded.get('901').path).toBe('board.html');
    expect(reloaded.get('901').inode).toBe(1234567);
  });

  test('getBaseline is null for a node with no entry', () => {
    const repo = new NodeRepository();
    repo.attach(tmpDir);
    expect(repo.getBaseline('404')).toBeNull();
    expect(repo.getBaseline(null)).toBeNull();
  });

  test('updateBaseline on a missing entry changes nothing', async () => {
    const repo = new NodeRepository();
    repo.attach(tmpDir);

    expect(await repo.updateBaseline('404', { remoteEtag: 'etag-2' })).toBeNull();
    expect(repo.size).toBe(0);
    await expect(fs.readFile(path.join(tmpDir, 'node-map.json'), 'utf8')).rejects.toThrow();
  });
});
