/**
 * The uploads safety net (S5): a catch-up pass never deletes, moves or renames
 * anything under the root's uploads folder. Real directories and real inodes
 * throughout; only the remote API is mocked.
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

jest.mock('../../src/sync-engine/api-client');

const fsSync = require('fs');
const os = require('os');
const nodePath = require('path');
const upath = require('upath');
const apiClient = require('../../src/sync-engine/api-client');
const nodeMap = require('../../src/sync-engine/node-map');
const { SyncEngine } = require('../../src/sync-engine/index');
const realOps = jest.requireActual('../../src/sync-engine/file-operations');

const PAGE_HTML = '<html>content</html>';
const X_BYTES = 'x';
const csOf = (content) => realOps.calculateBufferChecksum(Buffer.from(content));
const SAME = csOf(PAGE_HTML);
const UPLOAD_ETAG = csOf(X_BYTES);

const completeList = (nodes = []) => Object.assign(nodes, { complete: true });
const node = (id, type, name, dir, parentId, etag) => (etag === undefined
  ? { id, type, name, path: dir, parentId }
  : { id, type, name, path: dir, parentId, etag });

let engine;
let root;

const ino = (...p) => fsSync.statSync(nodePath.join(root, ...p)).ino;
const identity = (...p) => nodeMap.getInodeSync(nodePath.join(root, ...p));
const exists = (...p) => fsSync.existsSync(nodePath.join(root, ...p));

function uploadsInventory() {
  return completeList([
    node(10, 'folder', 'uploads', '', 0),
    node(11, 'folder', 'assets-a', 'uploads', 10),
    node(12, 'upload', 'x.png', 'uploads/assets-a', 11, UPLOAD_ETAG),
    node(13, 'site', 'page.html', 'uploads/assets-a', 11, SAME)
  ]);
}

function seedUploads() {
  fsSync.mkdirSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true });
  fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), X_BYTES);
  fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), PAGE_HTML);
  return [
    ['10', { type: 'folder', path: 'uploads', parentId: 0, inode: identity('uploads') }],
    ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10, inode: identity('uploads', 'assets-a') }],
    ['12', { type: 'upload', path: 'uploads/assets-a/x.png', parentId: 11, inode: identity('uploads', 'assets-a', 'x.png'), remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }],
    ['13', { type: 'site', path: 'uploads/assets-a/page.html', parentId: 11, inode: identity('uploads', 'assets-a', 'page.html'), remoteEtag: SAME, localChecksum: SAME }]
  ];
}

function serveContent() {
  apiClient.getNodeContent.mockImplementation(async (_conn, id) => (Number(id) === 13
    ? { content: PAGE_HTML, nodeType: 'site', etag: SAME, checksum: SAME }
    : { content: Buffer.from(X_BYTES), nodeType: 'upload', etag: UPLOAD_ETAG, checksum: UPLOAD_ETAG }));
}

beforeEach(() => {
  jest.clearAllMocks();

  root = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'hyperclay-safety-'));
  fsSync.mkdirSync(nodePath.join(root, '.meta'));

  engine = new SyncEngine();

  engine.syncFolder = root;
  engine.metaDir = nodePath.join(root, '.meta');
  engine.serverUrl = 'http://test';
  engine.apiKey = 'test-key';
  engine.isRunning = true;
  engine.lastSyncedAt = Date.now();
  engine.runner = { state: 'online', start: jest.fn() };

  apiClient.listNodes.mockResolvedValue(completeList([]));
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.moveNode.mockResolvedValue({ success: true });
  let nextId = 900;
  apiClient.createNode.mockImplementation(async (_conn, body) => ({ id: nextId++, ...body }));
  serveContent();
});

afterEach(() => {
  engine.syncQueue.clear();
  fsSync.rmSync(root, { recursive: true, force: true });
});

describe('a catch-up pass never deletes or moves anything under uploads/', () => {
  test('I1: a restore interrupted after the folder pass (app quit) deletes nothing on the next pass', async () => {
    const seed = seedUploads();
    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });
    engine.repo.seed(seed);
    engine.serverNodesCache = uploadsInventory();
    engine.serverNodesComplete = true;

    // Pass 1: the app quits right after the folder pass made the directories.
    await engine.performInitialFolderSync(uploadsInventory());
    expect(exists('uploads', 'assets-a')).toBe(true);
    expect(exists('uploads', 'assets-a', 'x.png')).toBe(false);

    jest.clearAllMocks();
    engine.restoredFolders = [];
    apiClient.listNodes.mockResolvedValue(uploadsInventory());
    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });

  test('I2: a restore whose downloads failed deletes nothing on the next pass', async () => {
    const seed = seedUploads();
    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });
    engine.repo.seed(seed);
    apiClient.getNodeContent.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ENETUNREACH' }));

    apiClient.listNodes.mockResolvedValue(uploadsInventory());

    await engine.reconcileAll(uploadsInventory(), { generation: 1 }).catch(() => {});
    expect(exists('uploads', 'assets-a')).toBe(true);
    expect(exists('uploads', 'assets-a', 'x.png')).toBe(false);

    jest.clearAllMocks();
    serveContent();
    engine.restoredFolders = [];
    apiClient.listNodes.mockResolvedValue(uploadsInventory());
    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });

  test('a nested uploads folder that is missing is restored, never deleted', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    fsSync.rmSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true, force: true });

    apiClient.listNodes.mockResolvedValue(uploadsInventory());

    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });

  test('a folder reusing the freed uploads inode is not renamed back; the root is restored by download', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    const uploadsInode = seed[0][1].inode;
    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });
    fsSync.mkdirSync(nodePath.join(root, 'new-project'));
    fsSync.writeFileSync(nodePath.join(root, 'new-project', 'notes.txt'), 'mine');

    // The freed inode is handed to the new folder, as a reusing filesystem would.
    const realGetInode = nodeMap.getInode;
    const reuse = jest.spyOn(nodeMap, 'getInode').mockImplementation(async (p) =>
      (p === upath.join(root, 'new-project') ? uploadsInode : realGetInode(p)));

    try {
      apiClient.listNodes.mockResolvedValue(uploadsInventory());
      await engine.reconcileAll(uploadsInventory(), { generation: 1 });

      expect(exists('uploads', 'notes.txt')).toBe(false);
      expect(apiClient.renameNode).not.toHaveBeenCalled();
      expect(apiClient.moveNode).not.toHaveBeenCalled();
      expect(apiClient.deleteNode).not.toHaveBeenCalled();
      expect(exists('new-project', 'notes.txt')).toBe(true);
      expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
      expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
      expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    } finally {
      reuse.mockRestore();
    }
  });

  test('a nested uploads folder replaced with a new inode restores its files instead of deleting them', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    const originalInode = ino('uploads', 'assets-a');

    // The folder is gone and an empty directory with another inode is back at
    // its path before this pass ran (a partial restore, a Finder replace).
    fsSync.mkdirSync(nodePath.join(root, 'replacement'));
    const replacementInode = ino('replacement');
    fsSync.rmSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true, force: true });
    fsSync.renameSync(nodePath.join(root, 'replacement'), nodePath.join(root, 'uploads', 'assets-a'));
    expect(replacementInode).not.toBe(originalInode);

    apiClient.listNodes.mockResolvedValue(uploadsInventory());

    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });

  test('an unrelated local folder with an attachment\'s bytes is never renamed into uploads/', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    // Created before uploads/ goes, so it cannot reuse uploads/'s inode (ext4
    // hands a freed inode straight back): this test is about content, not reuse.
    fsSync.mkdirSync(nodePath.join(root, 'new-project', 'assets-a'), { recursive: true });
    expect(ino('new-project')).not.toBe(ino('uploads'));
    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });
    fsSync.writeFileSync(nodePath.join(root, 'new-project', 'assets-a', 'x.png'), X_BYTES);
    fsSync.writeFileSync(nodePath.join(root, 'new-project', 'notes.txt'), 'mine');

    apiClient.listNodes.mockResolvedValue(uploadsInventory());

    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(exists('new-project', 'notes.txt')).toBe(true);
    expect(exists('new-project', 'assets-a', 'x.png')).toBe(true);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });
});
