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

jest.mock('fs/promises');
jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/node-map');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/utils', () => ({
  calculateChecksum: jest.fn(async (content) => `hash-${String(content).slice(0, 8)}`),
  calibrateClock: jest.fn(async () => 0),
  isLocalNewer: jest.fn(() => false),
  isFutureFile: jest.fn(() => false)
}));

const fs = require('fs/promises');
const nodeMapModule = require('../../src/sync-engine/node-map');
const fileOps = require('../../src/sync-engine/file-operations');
const apiClient = require('../../src/sync-engine/api-client');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

let syncEngine;

function seedRepo(entries) {
  syncEngine.repo.seed(entries);
}

function mockReaddirTree(tree) {
  fs.readdir.mockImplementation(async (dir, opts) => {
    const entries = tree[dir];
    if (!entries) {
      const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
    }
    if (opts && opts.withFileTypes) {
      return entries.map(e => ({
        name: e.name,
        isDirectory: () => e.isDirectory === true,
        isFile: () => e.isFile === true
      }));
    }
    return entries.map(e => e.name);
  });
}

function mockStat(sizeByPath) {
  fs.stat.mockImplementation(async (p) => {
    if (!(p in sizeByPath)) {
      const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
    }
    return { size: sizeByPath[p], mtime: new Date() };
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.outbox = new Outbox();
  syncEngine.pendingUnlinks = new Map();
  syncEngine.cascade = new CascadeSuppression();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/sync';
  syncEngine.metaDir = '/tmp/meta';
  syncEngine.serverNodesCache = null;

  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(null);

  // Use the real walkDescendants (prefix scan on the repo's internal Map) so
  // ledger snapshotting and reject-path repo cleanup actually see seeded entries.
  const realWalk = jest.requireActual('../../src/sync-engine/node-map').walkDescendants;
  nodeMapModule.walkDescendants = jest.fn(realWalk);

  fileOps.readFile.mockResolvedValue('html-content');
  fileOps.readFileBuffer.mockResolvedValue(Buffer.from('bin-content'));
  fileOps.calculateBufferChecksum.mockImplementation(buf => `bhash-${buf.toString().slice(0, 8)}`);

  apiClient.deleteNode.mockResolvedValue({ success: true });

  // Prevent the real queue from starting async upload work whenever a handler
  // fires during reject-path rescans. The tests assert spies on the handlers
  // directly; we only need to neutralize fallthrough side effects.
  syncEngine.queueSync = jest.fn();
});

afterEach(() => {
  for (const { timerId } of syncEngine.pendingUnlinks.values()) {
    clearTimeout(timerId);
  }
  syncEngine.pendingUnlinks.clear();
});

describe('_registerPendingUnlink ledger capture', () => {
  it('attaches a descendant ledger to folder pending-unlinks', () => {
    seedRepo([
      ['10', { type: 'folder', path: 'projects', parentId: 0 }],
      ['11', { type: 'site',   path: 'projects/a.html', checksum: 'ha', inode: 1 }],
      ['12', { type: 'upload', path: 'projects/img.png', checksum: 'hp', inode: 2 }],
      ['13', { type: 'folder', path: 'projects/sub', parentId: 10 }],
      ['14', { type: 'site',   path: 'projects/sub/deep.html', checksum: 'hd', inode: 3 }]
    ]);

    syncEngine._registerPendingUnlink('projects', 'folder');

    const pending = syncEngine.pendingUnlinks.get('projects');
    expect(pending).toBeDefined();
    expect(pending.ledger).toHaveLength(4);
    expect(pending.ledger.map(e => e.relPath).sort()).toEqual([
      'a.html',
      'img.png',
      'sub',
      'sub/deep.html'
    ]);
    expect(pending.ledger.find(e => e.relPath === 'a.html')).toMatchObject({
      type: 'site',
      basename: 'a.html',
      checksum: 'ha'
    });
    clearTimeout(pending.timerId);
  });

  it('does not attach a ledger to file pending-unlinks', () => {
    seedRepo([
      ['20', { type: 'site', path: 'solo.html', checksum: 's1', inode: 5 }]
    ]);

    syncEngine._registerPendingUnlink('solo.html', 'site');
    const pending = syncEngine.pendingUnlinks.get('solo.html');
    expect(pending.ledger).toBeNull();
    clearTimeout(pending.timerId);
  });
});

describe('_decideFolderIdentity — inode and empty paths', () => {
  it('confirms via inode-match without touching the filesystem', async () => {
    nodeMapModule.getInode.mockResolvedValueOnce(42);
    const plan = {
      newFullPath: '/tmp/sync/articles',
      pending: { entry: { inode: 42 } },
      ledger: [{ relPath: 'a.html', type: 'site', basename: 'a.html', checksum: 'ha' }]
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result).toEqual({ confirmed: true, reason: 'inode-match', newInode: 42 });
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it('confirms empty-folder when the ledger is empty', async () => {
    nodeMapModule.getInode.mockResolvedValueOnce(99);
    const plan = {
      newFullPath: '/tmp/sync/empty',
      pending: { entry: { inode: null } },
      ledger: []
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result).toEqual({ confirmed: true, reason: 'empty-folder', newInode: 99 });
    expect(fs.readdir).not.toHaveBeenCalled();
  });
});

describe('_decideFolderIdentity — content-based identity', () => {
  it('confirms via content-hash-match', async () => {
    mockReaddirTree({
      '/tmp/sync/articles': [
        { name: 'a.html', isFile: true }
      ]
    });
    mockStat({ '/tmp/sync/articles/a.html': 100 });
    fileOps.readFile.mockResolvedValueOnce('content-of-a');
    const plan = {
      newFullPath: '/tmp/sync/articles',
      pending: { entry: { inode: null } },
      ledger: [{
        relPath: 'a.html',
        type: 'site',
        basename: 'a.html',
        checksum: 'hash-content-'
      }]
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result.confirmed).toBe(true);
    expect(result.reason).toBe('content-hash-match');
    expect(result.matches.strong).toBe(1);
  });

  it('confirms via basename-majority-match when content differs', async () => {
    mockReaddirTree({
      '/tmp/sync/articles': [
        { name: 'a.html', isFile: true },
        { name: 'b.html', isFile: true },
        { name: 'c.html', isFile: true }
      ]
    });
    mockStat({
      '/tmp/sync/articles/a.html': 100,
      '/tmp/sync/articles/b.html': 100,
      '/tmp/sync/articles/c.html': 100
    });
    fileOps.readFile.mockResolvedValue('edited-after-rename');
    const plan = {
      newFullPath: '/tmp/sync/articles',
      pending: { entry: { inode: null } },
      ledger: [
        { relPath: 'a.html', type: 'site', basename: 'a.html', checksum: 'nope-a' },
        { relPath: 'b.html', type: 'site', basename: 'b.html', checksum: 'nope-b' },
        { relPath: 'c.html', type: 'site', basename: 'c.html', checksum: 'nope-c' }
      ]
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result.confirmed).toBe(true);
    expect(result.reason).toBe('basename-majority-match');
    expect(result.matches.weak).toBe(3);
  });

  it('rejects when fewer than half the ledger entries match by basename', async () => {
    mockReaddirTree({
      '/tmp/sync/newfolder': [
        { name: 'unrelated-1.html', isFile: true },
        { name: 'unrelated-2.html', isFile: true },
        { name: 'a.html', isFile: true }
      ]
    });
    mockStat({
      '/tmp/sync/newfolder/unrelated-1.html': 100,
      '/tmp/sync/newfolder/unrelated-2.html': 100,
      '/tmp/sync/newfolder/a.html': 100
    });
    fileOps.readFile.mockResolvedValue('different-content');
    const plan = {
      newFullPath: '/tmp/sync/newfolder',
      pending: { entry: { inode: null } },
      ledger: [
        { relPath: 'a.html', type: 'site', basename: 'a.html', checksum: 'old-a' },
        { relPath: 'b.html', type: 'site', basename: 'b.html', checksum: 'old-b' },
        { relPath: 'c.html', type: 'site', basename: 'c.html', checksum: 'old-c' },
        { relPath: 'd.html', type: 'site', basename: 'd.html', checksum: 'old-d' },
        { relPath: 'e.html', type: 'site', basename: 'e.html', checksum: 'old-e' }
      ]
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('content-mismatch');
    expect(result.matches.strong).toBe(0);
    expect(result.matches.weak).toBe(1);
  });

  it('rejects with scan-failed when the root readdir errors', async () => {
    fs.readdir.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    const plan = {
      newFullPath: '/tmp/sync/articles',
      pending: { entry: { inode: null } },
      ledger: [{ relPath: 'a.html', type: 'site', basename: 'a.html', checksum: 'ha' }]
    };

    const result = await syncEngine._decideFolderIdentity(plan);

    expect(result.confirmed).toBe(false);
    expect(result.reason).toBe('scan-failed');
  });
});

describe('_rejectFolderIdentity — cascade delete + rescan', () => {
  it('deletes descendants deepest-first, then the folder', async () => {
    seedRepo([
      ['10', { type: 'folder', path: 'projects' }],
      ['11', { type: 'folder', path: 'projects/sub' }],
      ['12', { type: 'site',   path: 'projects/sub/deep.html' }],
      ['13', { type: 'site',   path: 'projects/top.html' }]
    ]);
    mockReaddirTree({ '/tmp/sync/articles': [] });

    const plan = {
      oldPath: 'projects',
      newPath: 'articles',
      pending: { nodeId: '10', entry: { inode: null } },
      oldDescendants: [
        { nodeId: '11', entry: { path: 'projects/sub' } },
        { nodeId: '12', entry: { path: 'projects/sub/deep.html' } },
        { nodeId: '13', entry: { path: 'projects/top.html' } }
      ]
    };

    const deleteSpy = jest.spyOn(syncEngine, '_apiDeleteNode').mockResolvedValue({});

    await syncEngine._rejectFolderIdentity(plan, { reason: 'content-mismatch' });

    const callOrder = deleteSpy.mock.calls.map(c => c[0]);
    expect(callOrder).toEqual(['12', '13', '11', '10']);

    expect(syncEngine.repo.size).toBe(0);
  });

  it('queues new contents via rescan after rejection', async () => {
    seedRepo([['10', { type: 'folder', path: 'projects' }]]);

    mockReaddirTree({
      '/tmp/sync/articles': [
        { name: 'new1.html', isFile: true },
        { name: 'new2.html', isFile: true }
      ]
    });

    const siteAddSpy = jest.spyOn(syncEngine, '_handleSiteAdd').mockImplementation(() => {});
    const folderAddSpy = jest.spyOn(syncEngine, '_handleFolderAdd').mockImplementation(() => {});
    jest.spyOn(syncEngine, '_apiDeleteNode').mockResolvedValue({});

    const plan = {
      oldPath: 'projects',
      newPath: 'articles',
      pending: { nodeId: '10', entry: { inode: null } },
      oldDescendants: []
    };

    await syncEngine._rejectFolderIdentity(plan, { reason: 'content-mismatch' });

    expect(folderAddSpy).toHaveBeenCalledWith('articles');
    expect(siteAddSpy).toHaveBeenCalledWith('articles/new1.html');
    expect(siteAddSpy).toHaveBeenCalledWith('articles/new2.html');
  });

  it('continues when a descendant delete fails', async () => {
    seedRepo([
      ['10', { type: 'folder', path: 'projects' }],
      ['11', { type: 'site',   path: 'projects/a.html' }],
      ['12', { type: 'site',   path: 'projects/b.html' }]
    ]);
    mockReaddirTree({ '/tmp/sync/articles': [] });

    jest.spyOn(syncEngine, '_apiDeleteNode')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({});

    const plan = {
      oldPath: 'projects',
      newPath: 'articles',
      pending: { nodeId: '10', entry: { inode: null } },
      oldDescendants: [
        { nodeId: '11', entry: { path: 'projects/a.html' } },
        { nodeId: '12', entry: { path: 'projects/b.html' } }
      ]
    };

    await expect(
      syncEngine._rejectFolderIdentity(plan, { reason: 'content-mismatch' })
    ).resolves.toBeUndefined();

    expect(syncEngine.repo.size).toBe(0);
  });
});
