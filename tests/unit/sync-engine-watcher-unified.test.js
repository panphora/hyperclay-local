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
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const fileOps = require('../../src/sync-engine/file-operations');
const nodeMapModule = require('../../src/sync-engine/node-map');
const { renameNode, moveNode, deleteNode } = require('../../src/sync-engine/api-client');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.pendingUnlinks = new Map();
  syncEngine.outbox = new Outbox();
  syncEngine.cascade = new CascadeSuppression();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  renameNode.mockClear();
  moveNode.mockClear();
  deleteNode.mockClear();
});

afterEach(() => {
  for (const { timerId } of syncEngine.pendingUnlinks.values()) {
    clearTimeout(timerId);
  }
  syncEngine.pendingUnlinks.clear();
});

describe('unified watcher — correlator', () => {
  it('rejects cross-type correlation (site unlink + upload add)', () => {
    syncEngine.repo._map.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    expect(syncEngine.pendingUnlinks.size).toBe(1);

    const consumed = syncEngine._tryCorrelatePendingUnlink('foo.png', 'upload');
    expect(consumed).toBe(false);
    expect(syncEngine.pendingUnlinks.has('foo.html')).toBe(true);
  });

  it('correlates same-type rename', () => {
    syncEngine.repo._map.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    const spy = jest.spyOn(syncEngine, '_correlateFileUnlinkAdd').mockResolvedValue();
    syncEngine._tryCorrelatePendingUnlink('bar.html', 'site');
    expect(spy).toHaveBeenCalledWith('foo.html', 'bar.html', expect.any(Object), 'rename', 'site');
    spy.mockRestore();
  });

  it('does not correlate when paths are identical', () => {
    syncEngine.repo._map.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    const consumed = syncEngine._tryCorrelatePendingUnlink('foo.html', 'site');
    expect(consumed).toBe(false);
  });

  it('does not register pending unlink for untracked path', () => {
    syncEngine._registerPendingUnlink('unknown.html', 'site');
    expect(syncEngine.pendingUnlinks.size).toBe(0);
  });
});

describe('unified watcher — _correlateFileUnlinkAdd move+rename', () => {
  beforeEach(() => {
    nodeMapModule.getInode.mockResolvedValue(100);
    nodeMapModule.save.mockResolvedValue();
    fileOps.moveFile.mockResolvedValue();
    fileOps.ensureDirectory.mockResolvedValue();
    fileOps.fileExists.mockResolvedValue(true);
    syncEngine.invalidateServerNodesCache = jest.fn();
    // Provide a tracked folder so resolveParentIdByPath can find the target.
    syncEngine.repo._map.set('200', {
      type: 'folder',
      path: 'dest',
      inode: 200,
    });
  });

  it('issues ONE atomic moveNode(nodeId, targetParentId, newBasename) call for move+rename', async () => {
    syncEngine.repo._map.set('42', {
      type: 'site',
      path: 'src/foo.html',
      checksum: 'abc',
      inode: 100,
    });

    const pending = {
      nodeId: '42',
      type: 'site',
      entry: { type: 'site', path: 'src/foo.html', checksum: 'abc', inode: 100 },
    };

    await syncEngine._correlateFileUnlinkAdd(
      'src/foo.html',
      'dest/bar.html',
      pending,
      'move+rename',
      'site'
    );

    // Single atomic call — no separate rename leg.
    expect(moveNode).toHaveBeenCalledTimes(1);
    expect(moveNode).toHaveBeenCalledWith(
      'http://test',
      'test-key',
      42,
      200, // target parent id for 'dest' folder
      'bar.html' // new basename passed as the fifth arg
    );
    expect(renameNode).not.toHaveBeenCalled();
  });

  it('marks outbox only once with "move" (not rename+move)', async () => {
    syncEngine.repo._map.set('42', {
      type: 'site',
      path: 'src/foo.html',
      checksum: 'abc',
      inode: 100,
    });
    const spyMark = jest.spyOn(syncEngine.outbox, 'markInFlight');

    const pending = {
      nodeId: '42',
      type: 'site',
      entry: { type: 'site', path: 'src/foo.html', checksum: 'abc', inode: 100 },
    };

    await syncEngine._correlateFileUnlinkAdd(
      'src/foo.html',
      'dest/bar.html',
      pending,
      'move+rename',
      'site'
    );

    const moveMarks = spyMark.mock.calls.filter(c => c[0] === 'move');
    const renameMarks = spyMark.mock.calls.filter(c => c[0] === 'rename');
    expect(moveMarks.length).toBe(1);
    expect(renameMarks.length).toBe(0);

    spyMark.mockRestore();
  });

  it('updates repo entry to new path after successful move+rename', async () => {
    syncEngine.repo._map.set('42', {
      type: 'site',
      path: 'src/foo.html',
      checksum: 'abc',
      inode: 100,
    });
    moveNode.mockResolvedValue({ nodeId: 42, oldName: 'foo.html', newName: 'bar.html' });

    const pending = {
      nodeId: '42',
      type: 'site',
      entry: { type: 'site', path: 'src/foo.html', checksum: 'abc', inode: 100 },
    };

    await syncEngine._correlateFileUnlinkAdd(
      'src/foo.html',
      'dest/bar.html',
      pending,
      'move+rename',
      'site'
    );

    expect(syncEngine.repo.get('42').path).toBe('dest/bar.html');
  });
});

describe('unified watcher — _correlateFolderUnlinkAdd move+rename', () => {
  beforeEach(() => {
    nodeMapModule.getInode.mockResolvedValue(300);
    nodeMapModule.save.mockResolvedValue();
    // walkDescendants is a persistence helper delegated to by the repo.
    nodeMapModule.walkDescendants.mockReturnValue([]);
    fileOps.moveFile.mockResolvedValue();
    fileOps.ensureDirectory.mockResolvedValue();
    fileOps.fileExists.mockResolvedValue(true);
    syncEngine.invalidateServerNodesCache = jest.fn();
  });

  it('issues ONE atomic moveNode(nodeId, targetParentId, newBasename) call for folder move+rename', async () => {
    // Source folder at projects/old-name, plus a destination folder archive.
    syncEngine.repo._map.set('50', {
      type: 'folder',
      path: 'projects/old-name',
      parentId: 99,
      inode: 300,
    });
    syncEngine.repo._map.set('10', {
      type: 'folder',
      path: 'archive',
      parentId: 0,
      inode: 99,
    });

    const pending = {
      nodeId: '50',
      type: 'folder',
      entry: {
        type: 'folder',
        path: 'projects/old-name',
        parentId: 99,
        inode: 300,
      },
    };

    // No descendants → folder-identity check takes the empty-folder fast path.
    await syncEngine._correlateFolderUnlinkAdd(
      'projects/old-name',
      'archive/new-name',
      pending,
      'move+rename'
    );

    expect(moveNode).toHaveBeenCalledTimes(1);
    expect(moveNode).toHaveBeenCalledWith(
      'http://test',
      'test-key',
      50,
      10, // target parent id of 'archive'
      'new-name'
    );
    expect(renameNode).not.toHaveBeenCalled();
  });
});

describe('unified watcher — cascade suppression set', () => {
  beforeEach(() => {
    syncEngine.cascade = new CascadeSuppression();
  });

  it('marks descendants and consumes them on match', () => {
    syncEngine.cascade.mark(['projects/new/a.html', 'projects/new/b.html']);
    expect(syncEngine.cascade.size).toBe(2);

    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(true);
    expect(syncEngine.cascade.size).toBe(1);

    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(false);

    expect(syncEngine.cascade.consume('projects/new/b.html')).toBe(true);
  });

  it('expires entries after TTL', () => {
    jest.useFakeTimers();
    syncEngine.cascade.mark(['projects/new/a.html']);
    jest.advanceTimersByTime(3500);
    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(false);
    jest.useRealTimers();
  });

  it('unrelated paths are not consumed', () => {
    syncEngine.cascade.mark(['projects/new/a.html']);
    expect(syncEngine.cascade.consume('projects/other/b.html')).toBe(false);
    expect(syncEngine.cascade.size).toBe(1);
  });
});
