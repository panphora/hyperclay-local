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

const path = require('path');
const fileOps = require('../../src/sync-engine/file-operations');
const nodeMapModule = require('../../src/sync-engine/node-map');
const Outbox = require('../../src/sync-engine/state/outbox');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.nodeMap = new Map();
  syncEngine.outbox = new Outbox();
  syncEngine.recentFolderCascadePaths = new Map();

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
    syncEngine.nodeMap.set('60', { type: 'folder', path: 'projects/old', parentId: 0 });
    syncEngine.nodeMap.set('61', { type: 'site', path: 'projects/old/a.html', checksum: 'a' });
    syncEngine.nodeMap.set('62', { type: 'upload', path: 'projects/old/b.png', checksum: 'b' });
    syncEngine.nodeMap.set('63', { type: 'folder', path: 'projects/old/sub' });
    syncEngine.nodeMap.set('64', { type: 'site', path: 'projects/old/sub/c.html' });

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
    expect(syncEngine.nodeMap.get('60').path).toBe('projects/new');
    expect(syncEngine.nodeMap.get('61').path).toBe('projects/new/a.html');
    expect(syncEngine.nodeMap.get('62').path).toBe('projects/new/b.png');
    expect(syncEngine.nodeMap.get('63').path).toBe('projects/new/sub');
    expect(syncEngine.nodeMap.get('64').path).toBe('projects/new/sub/c.html');
  });

  it('pre-populates suppression set with both old and new paths', async () => {
    syncEngine.nodeMap.set('60', { type: 'folder', path: 'old' });
    syncEngine.nodeMap.set('61', { type: 'site', path: 'old/a.html' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'old/a.html' } }
    ]);

    const spy = jest.spyOn(syncEngine, '_markDescendantsForSuppression');

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
    syncEngine.nodeMap.set('60', { type: 'folder', path: 'old' });
    syncEngine.nodeMap.set('61', { type: 'site', path: 'old/a.html' });
    fileOps.fileExists.mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'old/a.html' } }
    ]);

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.get('60').path).toBe('new');
    expect(syncEngine.nodeMap.get('61').path).toBe('new/a.html');
  });

  it('bails out on collision at the new path', async () => {
    syncEngine.nodeMap.set('60', { type: 'folder', path: 'old' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    nodeMapModule.walkDescendants.mockReturnValue([]);

    await syncEngine._applyFolderRelocate(60, 'old', 'new');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.get('60').path).toBe('old');
  });

  it('suppresses watcher echo via suppression set, not outbox', async () => {
    syncEngine.nodeMap.set('60', { type: 'folder', path: 'old' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([]);

    const spy = jest.spyOn(syncEngine, '_markDescendantsForSuppression');

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
