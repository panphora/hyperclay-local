/**
 * The uploads safety net (S5): a catch-up pass never deletes, moves or renames
 * anything under the root's uploads folder, and the watcher pairs a folder add
 * by inode before path shape. Real directories and real inodes throughout;
 * only the remote API is mocked.
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
const exists = (...p) => fsSync.existsSync(nodePath.join(root, ...p));

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, tries = 400) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return predicate();
}

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
    ['10', { type: 'folder', path: 'uploads', parentId: 0, inode: ino('uploads') }],
    ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10, inode: ino('uploads', 'assets-a') }],
    ['12', { type: 'upload', path: 'uploads/assets-a/x.png', parentId: 11, inode: ino('uploads', 'assets-a', 'x.png'), remoteEtag: UPLOAD_ETAG, localChecksum: UPLOAD_ETAG }],
    ['13', { type: 'site', path: 'uploads/assets-a/page.html', parentId: 11, inode: ino('uploads', 'assets-a', 'page.html'), remoteEtag: SAME, localChecksum: SAME }]
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
  for (const { timerId } of engine.pendingUnlinks.values()) clearTimeout(timerId);
  engine.pendingUnlinks.clear();
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

    await engine.reconcileAll(uploadsInventory(), { generation: 1 }).catch(() => {});
    expect(exists('uploads', 'assets-a')).toBe(true);
    expect(exists('uploads', 'assets-a', 'x.png')).toBe(false);

    jest.clearAllMocks();
    serveContent();
    engine.restoredFolders = [];
    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'page.html'), 'utf8')).toBe(PAGE_HTML);
  });

  test('C1: a pass inside the grace period of a trash of uploads/ deletes nothing', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });

    // chokidar: children first, then the folders.
    engine._onUnlink('uploads/assets-a/x.png');
    engine._onUnlink('uploads/assets-a/page.html');
    engine._onUnlinkDir('uploads/assets-a');
    engine._onUnlinkDir('uploads');
    expect([...engine.pendingUnlinks.keys()]).toEqual(['uploads']);

    await engine.reconcileAll(uploadsInventory(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 12);
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 13);
    expect(fsSync.readFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'utf8')).toBe(X_BYTES);
  });

  test('a nested uploads folder that is missing is restored, never deleted', async () => {
    const seed = seedUploads();
    engine.repo.seed(seed);
    fsSync.rmSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true, force: true });

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
      await engine.reconcileAll(uploadsInventory(), { generation: 1 });

      expect(reuse).toHaveBeenCalledWith(upath.join(root, 'new-project'));
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

describe('the watcher pairs a folder add by inode first', () => {
  test('W5a: work/ and uploads/ moved together into archive/ keep both identities', async () => {
    fsSync.mkdirSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true });
    fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), X_BYTES);
    fsSync.mkdirSync(nodePath.join(root, 'work', 'sub'), { recursive: true });
    fsSync.writeFileSync(nodePath.join(root, 'work', 'page.html'), '<html>work</html>');
    fsSync.writeFileSync(nodePath.join(root, 'work', 'sub', 'b.png'), 'b');
    fsSync.mkdirSync(nodePath.join(root, 'archive'));

    engine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: 0, inode: ino('uploads') }],
      ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10, inode: ino('uploads', 'assets-a') }],
      ['12', { type: 'upload', path: 'uploads/assets-a/x.png', parentId: 11, inode: ino('uploads', 'assets-a', 'x.png'), checksum: UPLOAD_ETAG }],
      ['20', { type: 'folder', path: 'work', parentId: 0, inode: ino('work') }],
      ['21', { type: 'site', path: 'work/page.html', parentId: 20, inode: ino('work', 'page.html'), checksum: 'w' }],
      ['22', { type: 'folder', path: 'work/sub', parentId: 20, inode: ino('work', 'sub') }],
      ['23', { type: 'upload', path: 'work/sub/b.png', parentId: 22, inode: ino('work', 'sub', 'b.png'), checksum: 'b' }],
      ['50', { type: 'folder', path: 'archive', parentId: 0, inode: ino('archive') }]
    ]);

    fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'archive', 'uploads'));
    fsSync.renameSync(nodePath.join(root, 'work'), nodePath.join(root, 'archive', 'work'));

    engine._onUnlinkDir('work');
    engine._onUnlinkDir('uploads');
    engine._onAddDir('archive/uploads');
    engine._onAddDir('archive/uploads/assets-a');
    engine._onAdd('archive/uploads/assets-a/x.png');
    engine._onAddDir('archive/work');
    engine._onAddDir('archive/work/sub');
    engine._onAdd('archive/work/page.html');

    await waitFor(() => exists('uploads', 'assets-a', 'x.png')
      && engine.repo.get('10').path === 'uploads'
      && engine.repo.get('21').path === 'archive/work/page.html');
    await settle();

    expect(apiClient.moveNode).toHaveBeenCalledWith(expect.anything(), 20, 50);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(exists('archive', 'uploads')).toBe(false);
    expect(engine.repo.get('10').path).toBe('uploads');
    expect(engine.repo.get('21').path).toBe('archive/work/page.html');
  });

  test('W5base: two ordinary folders moved together each keep their own node', async () => {
    fsSync.mkdirSync(nodePath.join(root, 'docs', 'sub'), { recursive: true });
    fsSync.writeFileSync(nodePath.join(root, 'docs', 'a.html'), '<html>a</html>');
    fsSync.writeFileSync(nodePath.join(root, 'docs', 'sub', 'c.html'), '<html>c</html>');
    fsSync.mkdirSync(nodePath.join(root, 'work', 'sub'), { recursive: true });
    fsSync.writeFileSync(nodePath.join(root, 'work', 'page.html'), '<html>work</html>');
    fsSync.writeFileSync(nodePath.join(root, 'work', 'sub', 'b.png'), 'b');
    fsSync.mkdirSync(nodePath.join(root, 'archive'));

    engine.repo.seed([
      ['40', { type: 'folder', path: 'docs', parentId: 0, inode: ino('docs') }],
      ['41', { type: 'site', path: 'docs/a.html', parentId: 40, inode: ino('docs', 'a.html'), checksum: 'a' }],
      ['42', { type: 'folder', path: 'docs/sub', parentId: 40, inode: ino('docs', 'sub') }],
      ['43', { type: 'site', path: 'docs/sub/c.html', parentId: 42, inode: ino('docs', 'sub', 'c.html'), checksum: 'c' }],
      ['20', { type: 'folder', path: 'work', parentId: 0, inode: ino('work') }],
      ['21', { type: 'site', path: 'work/page.html', parentId: 20, inode: ino('work', 'page.html'), checksum: 'w' }],
      ['22', { type: 'folder', path: 'work/sub', parentId: 20, inode: ino('work', 'sub') }],
      ['23', { type: 'upload', path: 'work/sub/b.png', parentId: 22, inode: ino('work', 'sub', 'b.png'), checksum: 'b' }],
      ['50', { type: 'folder', path: 'archive', parentId: 0, inode: ino('archive') }]
    ]);

    fsSync.renameSync(nodePath.join(root, 'docs'), nodePath.join(root, 'archive', 'docs'));
    fsSync.renameSync(nodePath.join(root, 'work'), nodePath.join(root, 'archive', 'work'));

    engine._onUnlinkDir('work');
    engine._onUnlinkDir('docs');
    engine._onAddDir('archive/docs');
    engine._onAddDir('archive/docs/sub');
    engine._onAddDir('archive/work');
    engine._onAddDir('archive/work/sub');

    await waitFor(() => engine.repo.get('41').path === 'archive/docs/a.html'
      && engine.repo.get('21').path === 'archive/work/page.html');
    await settle();

    expect(apiClient.moveNode).toHaveBeenCalledWith(expect.anything(), 40, 50);
    expect(apiClient.moveNode).toHaveBeenCalledWith(expect.anything(), 20, 50);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(engine.repo.get('41').path).toBe('archive/docs/a.html');
    expect(engine.repo.get('21').path).toBe('archive/work/page.html');
    expect(engine.repo.get('43').path).toBe('archive/docs/sub/c.html');
    expect(engine.repo.get('23').path).toBe('archive/work/sub/b.png');
  });

  test('W7: a new folder reusing the freed uploads inode is not renamed into uploads/', async () => {
    fsSync.mkdirSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true });
    fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), X_BYTES);
    const seed = [
      ['10', { type: 'folder', path: 'uploads', parentId: 0, inode: ino('uploads') }],
      ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10, inode: ino('uploads', 'assets-a') }],
      ['12', { type: 'upload', path: 'uploads/assets-a/x.png', parentId: 11, inode: ino('uploads', 'assets-a', 'x.png'), checksum: UPLOAD_ETAG }]
    ];
    const uploadsInode = seed[0][1].inode;
    engine.repo.seed(seed);

    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true, force: true });
    fsSync.mkdirSync(nodePath.join(root, 'new-project'));
    fsSync.writeFileSync(nodePath.join(root, 'new-project', 'notes.txt'), 'mine');

    // The freed inode is handed to the new folder, as a reusing filesystem would.
    const realStatSync = fsSync.statSync;
    const stat = jest.spyOn(fsSync, 'statSync').mockImplementation((p, ...rest) => {
      const st = realStatSync(p, ...rest);
      if (p === upath.join(root, 'new-project')) {
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: uploadsInode });
      }
      return st;
    });

    try {
      engine._onUnlinkDir('uploads');
      engine._onAddDir('new-project');
      engine._onAdd('new-project/notes.txt');
      await flush();
      await settle();
    } finally {
      stat.mockRestore();
    }

    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(exists('new-project', 'notes.txt')).toBe(true);
    expect(exists('uploads')).toBe(false);
    expect(engine.pendingUnlinks.has('uploads')).toBe(true);
  });
});
