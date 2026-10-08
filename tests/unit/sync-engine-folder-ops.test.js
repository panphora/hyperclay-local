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

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/node-map');

const fsSync = require('fs');
const os = require('os');
const nodePath = require('path');
const nodeMapModule = require('../../src/sync-engine/node-map');
const fileOps = require('../../src/sync-engine/file-operations');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');
const {
  createNode,
  renameNode,
  moveNode,
  deleteNode
} = require('../../src/sync-engine/api-client');
const realWalkDescendants = jest.requireActual('../../src/sync-engine/node-map').walkDescendants;
const realFileExists = jest.requireActual('../../src/sync-engine/file-operations').fileExists;

jest.mock('../../src/sync-engine/api-client');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
  });

  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.outbox = new Outbox();
  syncEngine.pendingUnlinks = new Map();
  syncEngine.cascade = new CascadeSuppression();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.serverNodesCache = null;

  fileOps.fileExists.mockReturnValue(true);
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(null);
  createNode.mockClear();
  renameNode.mockClear();
  moveNode.mockClear();
  deleteNode.mockClear();
});

describe('folder create', () => {
  it('creates a top-level folder with parentId=0', async () => {
    createNode.mockResolvedValueOnce({ id: 42, type: 'folder', name: 'projects', parentId: 0, path: '' });
    await syncEngine.createFolderOnServer('projects');

    expect(createNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://test', apiKey: 'test-key' }),
      { type: 'folder', name: 'projects', parentId: 0 }
    );
    expect(syncEngine.repo.get('42')).toEqual(expect.objectContaining({
      type: 'folder',
      path: 'projects'
    }));
  });

  it('creates a nested folder with the correct parentId', async () => {
    syncEngine.repo._map.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    createNode.mockResolvedValueOnce({ id: 20, type: 'folder', name: 'assets', parentId: 10, path: 'projects' });

    await syncEngine.createFolderOnServer('projects/assets');

    expect(createNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://test', apiKey: 'test-key' }),
      { type: 'folder', name: 'assets', parentId: 10 }
    );
  });

  it('is idempotent: returns early if folder is already in nodeMap', async () => {
    syncEngine.repo._map.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    await syncEngine.createFolderOnServer('projects');
    expect(createNode).not.toHaveBeenCalled();
  });
});

describe('folder rename cascade suppression', () => {
  it('pre-populates the suppression set with expected new descendant paths', () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'projects/old', parentId: 0 }],
      ['11', { type: 'site',   path: 'projects/old/a.html', checksum: 'a1', inode: 1 }],
      ['12', { type: 'upload', path: 'projects/old/b.png', checksum: 'b1', inode: 2 }]
    ]);
    syncEngine.cascade = new CascadeSuppression();

    const expectedPaths = [
      'projects/new',
      'projects/new/a.html',
      'projects/new/b.png'
    ];
    syncEngine.cascade.mark(expectedPaths);

    for (const p of expectedPaths) {
      expect(syncEngine.cascade.consume(p)).toBe(true);
    }
  });
});

describe('folder delete cleans up descendants in nodeMap', () => {
  it('removes all descendant entries when a folder is deleted', async () => {
    jest.useFakeTimers();

    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'projects', parentId: 0 }],
      ['11', { type: 'site',   path: 'projects/a.html', checksum: 'a', inode: 1 }],
      ['12', { type: 'upload', path: 'projects/b.png', checksum: 'b', inode: 2 }],
      ['13', { type: 'folder', path: 'projects/subfolder', parentId: 10 }],
      ['14', { type: 'site',   path: 'projects/subfolder/c.html', checksum: 'c', inode: 3 }]
    ]);

    const { walkDescendants } = require('../../src/sync-engine/node-map');
    walkDescendants.mockImplementation((map, folderPath) => {
      const prefix = folderPath + '/';
      const results = [];
      for (const [nodeId, entry] of map) {
        if (entry.path && entry.path.startsWith(prefix)) {
          results.push({ nodeId, entry });
        }
      }
      return results;
    });

    deleteNode.mockResolvedValueOnce({});
    // The real `fileExists` is synchronous: the root is present, the deleted path is gone.
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);

    syncEngine._registerPendingUnlink('projects', 'folder');

    jest.advanceTimersByTime(3100);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteNode).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://test', apiKey: 'test-key' }), 10, { cascade: true });
    expect(syncEngine.repo.size).toBe(0);

    jest.useRealTimers();
  });
});

describe('resolveParentIdByPath', () => {
  it('returns 0 for root', () => {
    expect(syncEngine.resolveParentIdByPath('')).toBe(0);
    expect(syncEngine.resolveParentIdByPath('.')).toBe(0);
    expect(syncEngine.resolveParentIdByPath('/')).toBe(0);
    expect(syncEngine.resolveParentIdByPath(null)).toBe(0);
  });

  it('resolves a folder path to its nodeId', () => {
    syncEngine.repo._map.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    expect(syncEngine.resolveParentIdByPath('projects')).toBe(10);
  });

  it('throws for untracked folder', () => {
    expect(() => syncEngine.resolveParentIdByPath('unknown')).toThrow('Target folder not tracked in nodeMap');
  });
});

// ===========================================================================
// The locked root uploads folder
// ===========================================================================

// The repo walks its own map through node-map's walkDescendants, which is
// mocked in this suite; the real prefix scan is what the watcher needs.
function useRealWalkDescendants() {
  nodeMapModule.walkDescendants.mockImplementation(realWalkDescendants);
}

// The watcher kicks its correlation off without awaiting it.
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('the locked root uploads folder — watcher delete', () => {
  it('sends no delete of any kind and asks for a reconcile', async () => {
    jest.useFakeTimers();

    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: null }],
      ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10 }],
      ['12', { type: 'upload', path: 'uploads/assets-a/x.png', checksum: 'x', inode: 1 }],
      ['13', { type: 'upload', path: 'uploads/assets-a/y.png', checksum: 'y', inode: 2 }]
    ]);
    useRealWalkDescendants();
    syncEngine.runner = { start: jest.fn() };
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);

    syncEngine._registerPendingUnlink('uploads/assets-a/x.png', 'upload');
    syncEngine._registerPendingUnlink('uploads/assets-a/y.png', 'upload');
    syncEngine._registerPendingUnlink('uploads', 'folder');

    jest.advanceTimersByTime(3100);
    await flush();

    expect(deleteNode).not.toHaveBeenCalled();
    expect(renameNode).not.toHaveBeenCalled();
    expect(syncEngine.runner.start).toHaveBeenCalledTimes(1);
    expect(syncEngine.repo.get('10').path).toBe('uploads');

    jest.useRealTimers();
  });

  it('a folder named uploads that is not at the root still sends its cascade delete', async () => {
    jest.useFakeTimers();

    syncEngine.repo.seed([
      ['20', { type: 'folder', path: 'work', parentId: null }],
      ['21', { type: 'folder', path: 'work/uploads', parentId: 20 }],
      ['22', { type: 'upload', path: 'work/uploads/x.png', checksum: 'x', inode: 1 }]
    ]);
    useRealWalkDescendants();
    syncEngine.runner = { start: jest.fn() };
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);
    deleteNode.mockResolvedValueOnce({});

    syncEngine._registerPendingUnlink('work/uploads', 'folder');

    jest.advanceTimersByTime(3100);
    await flush();

    expect(deleteNode).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://test', apiKey: 'test-key' }), 21, { cascade: true });
    expect(syncEngine.runner.start).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('deleting one file inside uploads still sends that file delete', async () => {
    jest.useFakeTimers();

    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: null }],
      ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10 }],
      ['12', { type: 'upload', path: 'uploads/assets-a/x.png', checksum: 'x', inode: 1 }]
    ]);
    useRealWalkDescendants();
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);
    deleteNode.mockResolvedValueOnce({});

    syncEngine._registerPendingUnlink('uploads/assets-a/x.png', 'upload');

    jest.advanceTimersByTime(3100);
    await flush();

    expect(deleteNode).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'http://test', apiKey: 'test-key' }), 12, { cascade: false });
    expect(syncEngine.repo.has('12')).toBe(false);

    jest.useRealTimers();
  });
});

describe('the locked root uploads folder — watcher rename', () => {
  it('renames the folder back, sends nothing, and leaves the files where they were', async () => {
    const root = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'hyperclay-locked-'));
    try {
      fsSync.mkdirSync(nodePath.join(root, 'uploads', 'assets-a'), { recursive: true });
      fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'), 'x');
      fsSync.writeFileSync(nodePath.join(root, 'uploads', 'assets-a', 'y.png'), 'y');

      syncEngine.syncFolder = root;
      syncEngine.repo.seed([
        ['10', { type: 'folder', path: 'uploads', parentId: null }],
        ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10 }],
        ['12', { type: 'upload', path: 'uploads/assets-a/x.png', checksum: 'x', inode: 1 }],
        ['13', { type: 'upload', path: 'uploads/assets-a/y.png', checksum: 'y', inode: 2 }]
      ]);
      useRealWalkDescendants();
      fileOps.fileExists.mockImplementation(realFileExists);
      syncEngine.runner = { start: jest.fn() };

      // The rename-back is performed on the real directory the mock is handed,
      // so the disk assertions below are about the disk, not about a call log.
      const rename = jest.spyOn(require('fs').promises, 'rename')
        .mockImplementation(async (from, to) => fsSync.renameSync(from, to));

      fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'uploads-old'));
      syncEngine._onUnlinkDir('uploads');
      syncEngine._onAddDir('uploads-old');
      await flush();

      expect(renameNode).not.toHaveBeenCalled();
      expect(moveNode).not.toHaveBeenCalled();
      expect(deleteNode).not.toHaveBeenCalled();
      expect(createNode).not.toHaveBeenCalled();
      expect(syncEngine.runner.start).not.toHaveBeenCalled();

      expect(fsSync.existsSync(nodePath.join(root, 'uploads'))).toBe(true);
      expect(fsSync.existsSync(nodePath.join(root, 'uploads', 'assets-a', 'x.png'))).toBe(true);
      expect(fsSync.existsSync(nodePath.join(root, 'uploads', 'assets-a', 'y.png'))).toBe(true);
      expect(fsSync.existsSync(nodePath.join(root, 'uploads-old'))).toBe(false);
      expect(syncEngine.repo.get('10').path).toBe('uploads');
      expect(rename).toHaveBeenCalledWith(nodePath.join(root, 'uploads-old'), nodePath.join(root, 'uploads'));
      expect(syncEngine.pendingUnlinks.size).toBe(0);
      rename.mockRestore();
    } finally {
      fsSync.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the locked root uploads folder — API backstop', () => {
  it('refuses a rename, move and delete of the folder and sends nothing', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: null }]
    ]);

    await expect(syncEngine._apiRenameNode(10, 'x')).rejects.toMatchObject({ code: 'locked-folder' });
    await expect(syncEngine._apiMoveNode(10, 0)).rejects.toMatchObject({ code: 'locked-folder' });
    await expect(syncEngine._apiDeleteNode(10, { cascade: true })).rejects.toMatchObject({ code: 'locked-folder' });

    expect(renameNode).not.toHaveBeenCalled();
    expect(moveNode).not.toHaveBeenCalled();
    expect(deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.outbox.has('rename', 10)).toBe(false);
    expect(syncEngine.outbox.has('move', 10)).toBe(false);
    expect(syncEngine.outbox.has('delete', 10)).toBe(false);
  });

  it('still sends the same calls for a folder named uploads that is not at the root', async () => {
    syncEngine.repo.seed([
      ['20', { type: 'folder', path: 'work/uploads', parentId: null }]
    ]);
    renameNode.mockResolvedValueOnce({});
    moveNode.mockResolvedValueOnce({});
    deleteNode.mockResolvedValueOnce({});

    await syncEngine._apiRenameNode(20, 'x');
    await syncEngine._apiMoveNode(20, 0, 'y');
    await syncEngine._apiDeleteNode(20, { cascade: true });

    expect(renameNode).toHaveBeenCalledWith(expect.anything(), 20, 'x');
    expect(moveNode).toHaveBeenCalledWith(expect.anything(), 20, 0, 'y');
    expect(deleteNode).toHaveBeenCalledWith(expect.anything(), 20, { cascade: true, expectedVersion: undefined });
  });
});
