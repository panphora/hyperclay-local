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
const realGetInodeSync = jest.requireActual('../../src/sync-engine/node-map').getInodeSync;

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
  nodeMapModule.getInodeSync.mockImplementation(realGetInodeSync);
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

  it('refuses a rename, move and delete of a nested node under uploads and sends nothing', async () => {
    syncEngine.repo.seed([
      [11, { type: 'folder', path: 'uploads/assets-a', parentId: 10 }]
    ]);

    await expect(syncEngine._apiRenameNode(11, 'x')).rejects.toMatchObject({ code: 'locked-folder' });
    await expect(syncEngine._apiMoveNode(11, 0)).rejects.toMatchObject({ code: 'locked-folder' });
    await expect(syncEngine._apiDeleteNode(11, { cascade: true })).rejects.toMatchObject({ code: 'locked-folder' });

    expect(renameNode).not.toHaveBeenCalled();
    expect(moveNode).not.toHaveBeenCalled();
    expect(deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.outbox.has('rename', 11)).toBe(false);
    expect(syncEngine.outbox.has('move', 11)).toBe(false);
    expect(syncEngine.outbox.has('delete', 11)).toBe(false);
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
