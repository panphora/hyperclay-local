/**
 * The initial-sync folder pass (C3 §5.5, §9): every tracked folder and every
 * listed folder is decided from `{ tracked, local, remote, complete }` through
 * `decideFolder` and executed by the one executor. These cases pin the two bugs
 * the rewrite fixed: a resync no longer drops every listed folder out of the
 * node map, and a folder the user deleted while offline is propagated instead of
 * being recreated — unless a teammate changed something under it, the pass is a
 * bootstrap or a first one, or the watcher still owns the path. A folder delete
 * cascades once for the whole subtree, absence needs an ENOENT to prove it, and
 * a session failure ends the pass rather than being swallowed.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({
  EventSource: jest.fn()
}));

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    notify: jest.fn(),
    broadcast: jest.fn(),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastFileSaved: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

const fileOps = require('../../src/sync-engine/file-operations');
const apiClient = require('../../src/sync-engine/api-client');
const nodeMapModule = require('../../src/sync-engine/node-map');

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map', () => {
  const actual = jest.requireActual('../../src/sync-engine/node-map');
  return {
    ...actual,
    load: jest.fn(),
    save: jest.fn(),
    loadState: jest.fn(),
    saveState: jest.fn(),
    loadTombstones: jest.fn(),
    saveTombstones: jest.fn(),
    getInode: jest.fn(),
    walkDescendants: jest.fn(actual.walkDescendants)
  };
});

const crypto = require('crypto');
function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

const localFile = (rel) => ({ path: `/test/sync/${rel}`, relativePath: rel, mtime: new Date('2024-01-01'), size: 100 });

// A list carrying `complete: true` promises it is the whole inventory; only such
// a list may ever justify a local delete (protocol 2).
function completeList(nodes = []) {
  return Object.assign(nodes, { complete: true });
}

// A listed node: `dir` is the parent's path, so the node's own path is
// `dir ? dir/name : name` (see relPathOf).
const node = (id, type, name, dir, parentId, etag) => (etag === undefined
  ? { id, type, name, path: dir, parentId }
  : { id, type, name, path: dir, parentId, etag });

const localFolder = (rel) => [rel, { fullPath: `/test/sync/${rel}` }];

const realBufferChecksum = jest.requireActual('../../src/sync-engine/file-operations').calculateBufferChecksum;
const STUB_STAT = { mtime: new Date('2024-01-01'), mtimeMs: 1704067200000, size: 100, mode: 0o644 };

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
  });

  syncEngine.syncFolder = '/test/sync';
  syncEngine.serverUrl = 'http://localhyperclay.com';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
  syncEngine.stats = {
    filesProtected: 0,
    filesDownloaded: 0,
    filesUploaded: 0,
    filesDownloadedSkipped: 0,
    filesUploadedSkipped: 0,
    uploadsDownloaded: 0,
    uploadsUploaded: 0,
    uploadsProtected: 0,
    uploadsSkipped: 0,
    lastSync: null,
    errors: []
  };

  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.writeFile.mockResolvedValue();
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.readFileBuffer.mockImplementation(async (filePath) => Buffer.from(await fileOps.readFile(filePath)));
  fileOps.calculateBufferChecksum.mockImplementation(realBufferChecksum);
  fileOps.fileExists.mockResolvedValue(true);
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
  fileOps.getLocalFolders.mockResolvedValue(new Map());

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);

  apiClient.listNodes.mockResolvedValue(completeList([]));
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>server</html>',
    nodeType: 'site',
    etag: 'etag-new',
    checksum: 'etag-new',
    modifiedAt: '2024-06-01T00:00:00Z'
  });

  // The executor stat()s the local file for the modifiedAt it stamps on a
  // server write; the suite mocks file-operations, so this is mocked with it.
  jest.spyOn(require('fs').promises, 'stat').mockResolvedValue(STUB_STAT);
});

// The directory scan missed it and a stat proves it is really gone.
function gone() {
  fileOps.getFileStats.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
}

const SAME = checksum('<html>content</html>');
const UPLOAD_ETAG = 'b1';

// The tree of case 2: `proj` with a page and a subfolder holding an upload.
function seedOfflineDeletedTree() {
  syncEngine.repo.seed([
    ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
    ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }],
    ['12', { type: 'folder', path: 'proj/sub', parentId: 10, inode: 333 }],
    ['13', { type: 'upload', path: 'proj/sub/b.png', parentId: 12, inode: 131, remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }]
  ]);
  syncEngine.lastSyncedAt = Date.now();
}

function offlineDeletedInventory() {
  return completeList([
    node(10, 'folder', 'proj', '', 0),
    node(11, 'site', 'page.html', 'proj', 10, SAME),
    node(12, 'folder', 'sub', 'proj', 10),
    node(13, 'upload', 'b.png', 'proj/sub', 12, UPLOAD_ETAG)
  ]);
}

function emptyDisk() {
  fileOps.getLocalFolders.mockResolvedValue(new Map());
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
}

describe('performInitialFolderSync — a resync keeps a listed folder (bug 1)', () => {
  test('a listed folder with its directory on disk stays tracked and is not re-created', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();

    fileOps.getLocalFiles.mockResolvedValue(new Map([['proj/page.html', localFile('proj/page.html')]]));
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('proj')]));

    await syncEngine.reconcileAll(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, SAME)
    ]), { generation: 1 });

    expect(syncEngine.repo.has('10')).toBe(true);
    expect(syncEngine.repo.has('11')).toBe(true);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(fileOps.ensureDirectory).not.toHaveBeenCalled();
  });
});

describe('performInitialFolderSync — an offline folder delete propagates (bug 2)', () => {
  test('the folder is deleted on the server with one cascade for its subtree', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(offlineDeletedInventory(), { generation: 1 });

    expect(apiClient.deleteNode).toHaveBeenCalledTimes(1);
    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ cascade: true }));
    expect(fileOps.ensureDirectory).not.toHaveBeenCalled();
    expect(syncEngine.repo.size).toBe(0);
  });

  test('a teammate edit under the folder restores it instead', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: 'old', localChecksum: 'old' }],
      ['13', { type: 'upload', path: 'proj/b.png', parentId: 10, inode: 131, remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, 'etag-new'),
      node(13, 'upload', 'b.png', 'proj', 10, UPLOAD_ETAG)
    ]), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalledWith(expect.anything(), 10, expect.anything());
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 11);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
  });

  test('a subfolder under a restored folder is restored, not deleted', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: 'old', localChecksum: 'old' }],
      ['12', { type: 'folder', path: 'proj/sub', parentId: 10, inode: 333 }],
      ['13', { type: 'upload', path: 'proj/sub/b.png', parentId: 12, inode: 131, remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, 'etag-new'),
      node(12, 'folder', 'sub', 'proj', 10),
      node(13, 'upload', 'b.png', 'proj/sub', 12, UPLOAD_ETAG)
    ]), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj/sub');
    expect(syncEngine.repo.has('12')).toBe(true);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
  });

  test('a new remote child restores the folder too', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }],
      ['13', { type: 'upload', path: 'proj/b.png', parentId: 10, inode: 131, remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, SAME),
      node(13, 'upload', 'b.png', 'proj', 10, UPLOAD_ETAG),
      node(14, 'site', 'new.html', 'proj', 10, 'new-etag')
    ]), { generation: 1 });

    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
    expect(apiClient.deleteNode).not.toHaveBeenCalledWith(expect.anything(), 10, expect.anything());
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 14);
  });
});

describe('performInitialFolderSync — a pass that may not delete', () => {
  test('a bootstrap pass restores the folder instead of deleting it', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(offlineDeletedInventory(), { generation: 1, bootstrap: true });

    expect(apiClient.deleteNode).not.toHaveBeenCalledWith(expect.anything(), 10, expect.anything());
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
  });

  test('a first pass (no lastSyncedAt) restores the folder instead of deleting it', async () => {
    seedOfflineDeletedTree();
    syncEngine.lastSyncedAt = null;
    emptyDisk();
    gone();

    await syncEngine.reconcileAll(offlineDeletedInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalledWith(expect.anything(), 10, expect.anything());
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
  });

  test('a legacy list forgets and deletes nothing', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }]
    ]);
    syncEngine.lastSyncedAt = Date.now();

    await syncEngine.performInitialFolderSync([]);

    expect(syncEngine.repo.has('10')).toBe(true);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('a pending unlink is the watcher’s to send', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    gone();
    syncEngine.pendingUnlinks.set('proj', { timerId: 0, nodeId: '10', type: 'folder', entry: {}, ledger: [] });

    await syncEngine.performInitialFolderSync(offlineDeletedInventory());

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(fileOps.ensureDirectory).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('10')).toBe(true);
    expect(syncEngine.repo.has('12')).toBe(true);
  });

  test('absence needs an ENOENT: a present directory is never a delete', async () => {
    seedOfflineDeletedTree();
    emptyDisk();

    await syncEngine.performInitialFolderSync(offlineDeletedInventory());

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('absence needs an ENOENT: an unreadable one is not evidence either', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    fileOps.getFileStats.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await syncEngine.performInitialFolderSync(offlineDeletedInventory());

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });
});

describe('performInitialFolderSync — creating and relocating folders', () => {
  test('a new server folder is created locally, cascade-marked and tracked', async () => {
    fileOps.ensureDirectory.mockResolvedValue('/test/sync/new');

    await syncEngine.performInitialFolderSync([
      node(20, 'folder', 'new', '', 0)
    ]);

    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/new');
    expect(syncEngine.cascade.consume('new')).toBe(true);
    expect(syncEngine.repo.get('20')).toMatchObject({ type: 'folder', path: 'new', parentId: 0 });
  });

  test('a folder delete carries the version it was decided from', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    syncEngine.protocol = 2;
    emptyDisk();
    gone();

    apiClient.listNodes.mockResolvedValue(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(99, 'site', 'teammate.html', 'proj', 10, 'teammate-etag'),
      node(11, 'site', 'page.html', 'proj', 10, SAME)
    ]));

    await syncEngine.performInitialFolderSync(completeList([
      { ...node(10, 'folder', 'proj', '', 0), structureVersion: 'v1' },
      node(11, 'site', 'page.html', 'proj', 10, SAME)
    ]));

    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, { expectedVersion: 'v1', cascade: true });
  });

  test('an offline folder rename is sent by inode and re-points its descendants', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('renamed')]));
    gone();
    nodeMapModule.getInode.mockImplementation(async (p) => (p === '/test/sync/renamed' ? 222 : 12345));

    await syncEngine.performInitialFolderSync(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, SAME)
    ]));

    expect(apiClient.renameNode).toHaveBeenCalledWith(expect.anything(), 10, 'renamed');
    expect(syncEngine.repo.get('10').path).toBe('renamed');
    expect(syncEngine.repo.get('11').path).toBe('renamed/page.html');
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('a legacy list naming the folder never deletes it', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    gone();
    syncEngine.serverNodesComplete = false;

    await syncEngine.performInitialFolderSync([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, SAME),
      node(12, 'folder', 'sub', 'proj', 10),
      node(13, 'upload', 'b.png', 'proj/sub', 12, UPLOAD_ETAG)
    ]);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('10')).toBe(true);
  });

  test('a failed rename never falls through to a delete', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('renamed')]));
    gone();
    nodeMapModule.getInode.mockImplementation(async (p) => (p === '/test/sync/renamed' ? 222 : 12345));
    apiClient.renameNode.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 409, code: 'name-conflict' }));

    await syncEngine.performInitialFolderSync(completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'page.html', 'proj', 10, SAME)
    ]));

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('10').path).toBe('proj');
  });
});

describe('performInitialFolderSync — a session failure ends the pass', () => {
  test('a 401 on the folder delete reaches the caller', async () => {
    seedOfflineDeletedTree();
    emptyDisk();
    gone();
    apiClient.deleteNode.mockRejectedValue(Object.assign(new Error('invalid key'), { statusCode: 401, code: 'invalid-key' }));

    await expect(syncEngine.performInitialFolderSync(offlineDeletedInventory())).rejects.toMatchObject({
      statusCode: 401
    });
  });
});

describe('performInitialFolderSync — a relocated folder carries its subtree', () => {
  function seedRenamedTree() {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'a', parentId: null, inode: 222 }],
      ['11', { type: 'folder', path: 'a/sub', parentId: 10, inode: 333 }],
      ['12', { type: 'site', path: 'a/sub/p.html', parentId: 11, inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('a2'), localFolder('a2/sub')]));
    gone();
    nodeMapModule.getInode.mockImplementation(async (p) => {
      if (p === '/test/sync/a2') return 222;
      if (p === '/test/sync/a2/sub') return 333;
      return 12345;
    });
  }

  function renamedInventory() {
    return completeList([
      node(10, 'folder', 'a', '', 0),
      node(11, 'folder', 'sub', 'a', 10),
      node(12, 'site', 'p.html', 'a/sub', 11, SAME)
    ]);
  }

  test('a subfolder moves with its renamed parent', async () => {
    seedRenamedTree();

    await syncEngine.performInitialFolderSync(renamedInventory());

    expect(apiClient.renameNode).toHaveBeenCalledTimes(1);
    expect(apiClient.renameNode).toHaveBeenCalledWith(expect.anything(), 10, 'a2');
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(fileOps.ensureDirectory).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('11').path).toBe('a2/sub');
    expect(syncEngine.repo.get('12').path).toBe('a2/sub/p.html');
  });

  test('a failed parent rename leaves the children alone', async () => {
    seedRenamedTree();
    apiClient.renameNode.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 409, code: 'name-conflict' }));

    await syncEngine.performInitialFolderSync(renamedInventory());

    expect(apiClient.renameNode).toHaveBeenCalledTimes(1);
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('11').path).toBe('a/sub');
    expect(syncEngine.stats.errors.length).toBe(1);
  });

  test('a move into a new local folder creates it on the server first', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('archive'), localFolder('archive/proj')]));
    gone();
    nodeMapModule.getInode.mockImplementation(async (p) => (p === '/test/sync/archive/proj' ? 222 : 12345));
    apiClient.createNode.mockResolvedValue({ id: 50, parentId: 0 });

    await syncEngine.performInitialFolderSync(completeList([
      node(10, 'folder', 'proj', '', 0)
    ]));

    expect(apiClient.createNode).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ type: 'folder', name: 'archive' }));
    expect(apiClient.moveNode).toHaveBeenCalledWith(expect.anything(), 10, 50);
    expect(syncEngine.repo.get('10').path).toBe('archive/proj');
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('a 401 on the relocation send ends the pass', async () => {
    seedRenamedTree();
    apiClient.renameNode.mockRejectedValue(Object.assign(new Error('unauthorized'), { statusCode: 401, code: 'invalid-key' }));

    await expect(syncEngine.performInitialFolderSync(renamedInventory())).rejects.toMatchObject({
      statusCode: 401
    });
  });
});

describe('performInitialFolderSync — a rename without a usable inode is recognised by content', () => {
  function seedFolderWithoutInode() {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: null }],
      ['11', { type: 'site', path: 'proj/p.html', inode: 111, remoteEtag: SAME, localChecksum: SAME }]
    ]);
    syncEngine.lastSyncedAt = Date.now();
    gone();
  }

  // The real fileExists is synchronous and the root check reads it too; answers are per path.
  function existingPaths(paths) {
    fileOps.fileExists.mockImplementation((p) => p === '/test/sync' || paths.includes(p));
  }

  function inventory() {
    return completeList([
      node(10, 'folder', 'proj', '', 0),
      node(11, 'site', 'p.html', 'proj', 10, SAME)
    ]);
  }

  test('the one local-only folder holding the same file, unchanged, is the rename', async () => {
    seedFolderWithoutInode();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('renamed')]));
    existingPaths(['/test/sync/renamed/p.html']);

    await syncEngine.performInitialFolderSync(inventory());

    expect(apiClient.renameNode).toHaveBeenCalledWith(expect.anything(), 10, 'renamed');
    expect(syncEngine.repo.get('10').path).toBe('renamed');
    expect(syncEngine.repo.get('11').path).toBe('renamed/p.html');
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
  });

  test('two lookalike candidates are no evidence: the decision path runs', async () => {
    seedFolderWithoutInode();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('renamed'), localFolder('copy')]));
    existingPaths(['/test/sync/renamed/p.html', '/test/sync/copy/p.html']);

    await syncEngine.performInitialFolderSync(inventory());

    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ cascade: true }));
    expect(syncEngine.repo.size).toBe(0);
  });

  test('a changed file is not a match', async () => {
    seedFolderWithoutInode();
    fileOps.getLocalFolders.mockResolvedValue(new Map([localFolder('renamed')]));
    existingPaths(['/test/sync/renamed/p.html']);
    fileOps.readFile.mockImplementation(async (p) => (p === '/test/sync/renamed/p.html'
      ? '<html>changed</html>'
      : '<html>content</html>'));

    await syncEngine.performInitialFolderSync(inventory());

    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({ cascade: true }));
    expect(syncEngine.repo.size).toBe(0);
  });
});
