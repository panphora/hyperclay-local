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
const {
  createNode,
  renameNode,
  moveNode,
  deleteNode
} = require('../../src/sync-engine/api-client');

jest.mock('../../src/sync-engine/api-client');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.isRunning = true;
  syncEngine.nodeMap = new Map();
  syncEngine.pendingActions = new Map();
  syncEngine.pendingUnlinks = new Map();
  syncEngine.recentFolderRenameDescendants = new Map();
  syncEngine.folderIdentityWaiters = new Map();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.serverNodesCache = null;

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
      expect.any(String),
      expect.any(String),
      { type: 'folder', name: 'projects', parentId: 0 }
    );
    expect(syncEngine.nodeMap.get('42')).toEqual(expect.objectContaining({
      type: 'folder',
      path: 'projects'
    }));
  });

  it('creates a nested folder with the correct parentId', async () => {
    syncEngine.nodeMap.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    createNode.mockResolvedValueOnce({ id: 20, type: 'folder', name: 'assets', parentId: 10, path: 'projects' });

    await syncEngine.createFolderOnServer('projects/assets');

    expect(createNode).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { type: 'folder', name: 'assets', parentId: 10 }
    );
  });

  it('is idempotent: returns early if folder is already in nodeMap', async () => {
    syncEngine.nodeMap.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    await syncEngine.createFolderOnServer('projects');
    expect(createNode).not.toHaveBeenCalled();
  });
});

describe('folder rename cascade suppression', () => {
  it('pre-populates the suppression set with expected new descendant paths', () => {
    syncEngine.nodeMap = new Map([
      ['10', { type: 'folder', path: 'projects/old', parentId: 0 }],
      ['11', { type: 'site',   path: 'projects/old/a.html', checksum: 'a1', inode: 1 }],
      ['12', { type: 'upload', path: 'projects/old/b.png', checksum: 'b1', inode: 2 }]
    ]);
    syncEngine.recentFolderRenameDescendants = new Map();

    const expectedPaths = [
      'projects/new',
      'projects/new/a.html',
      'projects/new/b.png'
    ];
    syncEngine._markDescendantsForSuppression(expectedPaths);

    for (const p of expectedPaths) {
      expect(syncEngine._consumeSuppressedEvent(p)).toBe(true);
    }
  });
});

describe('folder delete cleans up descendants in nodeMap', () => {
  it('removes all descendant entries when a folder is deleted', async () => {
    jest.useFakeTimers();

    syncEngine.nodeMap = new Map([
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

    syncEngine._registerPendingUnlink('projects', 'folder');

    jest.advanceTimersByTime(1600);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteNode).toHaveBeenCalledWith(expect.any(String), expect.any(String), 10);
    expect(syncEngine.nodeMap.size).toBe(0);

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
    syncEngine.nodeMap.set('10', { type: 'folder', path: 'projects', parentId: 0 });
    expect(syncEngine.resolveParentIdByPath('projects')).toBe(10);
  });

  it('throws for untracked folder', () => {
    expect(() => syncEngine.resolveParentIdByPath('unknown')).toThrow('Target folder not tracked in nodeMap');
  });
});
