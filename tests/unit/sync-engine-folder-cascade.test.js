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
  createBackupIfExists: jest.fn().mockResolvedValue(),
  createBinaryBackupIfExists: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/node-map');

// upath, not path: every src/sync-engine module builds paths with upath, so an
// expectation built with Node's path asserts backslashes on Windows against the
// forward slashes the code actually produces.
const path = require('upath');
const fileOps = require('../../src/sync-engine/file-operations');
const nodeMapModule = require('../../src/sync-engine/node-map');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
  });

  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.repo.seed([]);
  syncEngine.outbox = new Outbox();
  syncEngine.cascade = new CascadeSuppression();

  fileOps.moveFile.mockResolvedValue();
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.fileExists.mockResolvedValue(false);
  nodeMapModule.getInode.mockResolvedValue(12345);
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
});

describe('_applyFolderRelocate', () => {
  it('rewrites descendant paths in nodeMap', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'projects/old', parentId: 0 });
    syncEngine.repo._map.set('61', { type: 'site', path: 'projects/old/a.html', checksum: 'a' });
    syncEngine.repo._map.set('62', { type: 'upload', path: 'projects/old/b.png', checksum: 'b' });
    syncEngine.repo._map.set('63', { type: 'folder', path: 'projects/old/sub' });
    syncEngine.repo._map.set('64', { type: 'site', path: 'projects/old/sub/c.html' });

    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'projects/old/a.html', checksum: 'a' } },
      { nodeId: '62', entry: { type: 'upload', path: 'projects/old/b.png', checksum: 'b' } },
      { nodeId: '63', entry: { type: 'folder', path: 'projects/old/sub' } },
      { nodeId: '64', entry: { type: 'site', path: 'projects/old/sub/c.html' } }
    ]);

    await syncEngine._applyFolderRelocate(60, 'projects/old', 'projects/new');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'projects/old'),
      path.join('/tmp/test-sync', 'projects/new')
    );
    expect(syncEngine.repo.get('60').path).toBe('projects/new');
    expect(syncEngine.repo.get('61').path).toBe('projects/new/a.html');
    expect(syncEngine.repo.get('62').path).toBe('projects/new/b.png');
    expect(syncEngine.repo.get('63').path).toBe('projects/new/sub');
    expect(syncEngine.repo.get('64').path).toBe('projects/new/sub/c.html');
  });

  it('pre-populates suppression set with both old and new paths', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'old' });
    syncEngine.repo._map.set('61', { type: 'site', path: 'old/a.html' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'old/a.html' } }
    ]);

    const spy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(spy).toHaveBeenCalled();
    const calledWithPaths = spy.mock.calls[0][0];
    expect(calledWithPaths).toContain('old');
    expect(calledWithPaths).toContain('new');
    expect(calledWithPaths).toContain('old/a.html');
    expect(calledWithPaths).toContain('new/a.html');

    spy.mockRestore();
  });

  it('updates nodeMap even if folder is missing on disk', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'old' });
    syncEngine.repo._map.set('61', { type: 'site', path: 'old/a.html' });
    fileOps.fileExists.mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'old/a.html' } }
    ]);

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('60').path).toBe('new');
    expect(syncEngine.repo.get('61').path).toBe('new/a.html');
  });

  it('moves the occupant aside when the new path is taken', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'old' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    nodeMapModule.walkDescendants.mockReturnValue([]);

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'new'),
      path.join('/tmp/test-sync', 'new (conflicted copy)')
    );
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'old'),
      path.join('/tmp/test-sync', 'new')
    );
    expect(syncEngine.repo.get('60').path).toBe('new');
  });

  it('suppresses watcher echo via suppression set, not outbox', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'old' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([]);

    const spy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(spy).toHaveBeenCalled();
    const calledWithPaths = spy.mock.calls[0][0];
    expect(calledWithPaths).toContain('old');
    expect(calledWithPaths).toContain('new');
    // outbox should NOT be set (would poison subsequent SSE events)
    expect(syncEngine.outbox.has('rename', 60)).toBe(false);
    expect(syncEngine.outbox.has('move', 60)).toBe(false);

    spy.mockRestore();
  });
});

describe('the locked root uploads folder — rename back', () => {
  const realWalkDescendants = jest.requireActual('../../src/sync-engine/node-map').walkDescendants;
  const realFileExists = jest.requireActual('../../src/sync-engine/file-operations').fileExists;

  it('renames the folder back, sends nothing and publishes no provisional path', async () => {
    const { renameNode, moveNode, deleteNode } = require('../../src/sync-engine/api-client');

    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: null, inode: 12345 }],
      ['11', { type: 'folder', path: 'uploads/assets-a', parentId: 10 }],
      ['12', { type: 'upload', path: 'uploads/assets-a/x.png', checksum: 'x', inode: 1 }]
    ]);
    nodeMapModule.walkDescendants.mockImplementation(realWalkDescendants);
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);

    const rename = jest.spyOn(require('fs').promises, 'rename').mockResolvedValue();

    syncEngine._onUnlinkDir('uploads');
    syncEngine._onAddDir('uploads-old');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(rename).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'uploads-old'),
      path.join('/tmp/test-sync', 'uploads')
    );
    expect(renameNode).not.toHaveBeenCalled();
    expect(moveNode).not.toHaveBeenCalled();
    expect(deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('10').path).toBe('uploads');
    expect(syncEngine.repo.get('11').path).toBe('uploads/assets-a');
    expect(syncEngine.repo.get('12').path).toBe('uploads/assets-a/x.png');

    // Both names and every descendant are suppressed, so the child events of
    // the operation are never taken for new files.
    expect(syncEngine.cascade.consume('uploads')).toBe(true);
    expect(syncEngine.cascade.consume('uploads-old')).toBe(true);
    expect(syncEngine.cascade.consume('uploads/assets-a')).toBe(true);
    expect(syncEngine.cascade.consume('uploads/assets-a/x.png')).toBe(true);
    expect(syncEngine.cascade.consume('uploads-old/assets-a')).toBe(true);
    expect(syncEngine.cascade.consume('uploads-old/assets-a/x.png')).toBe(true);

    rename.mockRestore();
  });

  it('asks for a reconcile instead when the folder cannot be renamed back', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'uploads', parentId: null, inode: 12345 }]
    ]);
    nodeMapModule.walkDescendants.mockImplementation(realWalkDescendants);
    fileOps.fileExists.mockImplementation((p) => p === syncEngine.syncFolder);
    syncEngine.runner = { start: jest.fn() };

    const rename = jest.spyOn(require('fs').promises, 'rename').mockRejectedValue(new Error('EACCES'));

    syncEngine._onUnlinkDir('uploads');
    syncEngine._onAddDir('uploads-old');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(syncEngine.runner.start).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalled();

    rename.mockRestore();
  });
});
