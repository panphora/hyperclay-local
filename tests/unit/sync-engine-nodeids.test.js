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
const { liveSync } = require('livesync-hyperclay');

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const crypto = require('crypto');
function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function entry(p, cs, ino, type = 'site') {
  return { type, path: p, checksum: cs || null, inode: ino || null };
}

let syncEngine;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.syncFolder = '/test/sync';
  syncEngine.metaDir = '/test/meta';
  syncEngine.serverUrl = 'http://localhyperclay.com';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.username = 'testuser';
  syncEngine.clockOffset = 0;
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
  syncEngine.lastSyncedAt = null;
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
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.fileExists.mockResolvedValue(true);
  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>server content</html>',
    nodeType: 'site',
    modifiedAt: '2024-06-01T00:00:00Z',
    checksum: checksum('<html>server content</html>'),
    size: 26
  });
  apiClient.putNodeContent.mockResolvedValue({ nodeId: 1, checksum: 'abc' });
  apiClient.createNode.mockResolvedValue({ id: 1, type: 'site', name: 'test.html', parentId: 0, path: '' });
  apiClient.listNodes.mockResolvedValue([]);
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.moveNode.mockResolvedValue({ success: true });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('reconcileServerFile — nodeId move detection', () => {
  test('moves file when nodeId maps to a different local path', async () => {
    const content = '<html>my site</html>';
    const cs = checksum(content);

    syncEngine.repo.seed([['42', entry('my-site.html', cs, 111)]]);

    apiClient.listNodes.mockResolvedValue([
      { id: 42, type: 'site', name: 'my-site.html', path: 'blog', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/blog/my-site.html'
    );
  });

  test('downloads when nodeId has no mapping (first sync)', async () => {
    apiClient.listNodes.mockResolvedValue([
      { id: 42, type: 'site', name: 'new-site.html', path: '', checksum: 'abc', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      'http://localhyperclay.com',
      'hcsk_test',
      42
    );
  });

  test('populates nodeMap with object entries after reconciling each server file', async () => {
    const content = '<html>content</html>';
    const cs = checksum(content);

    apiClient.listNodes.mockResolvedValue([
      { id: 42, type: 'site', name: 'index.html', path: '', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' },
      { id: 73, type: 'site', name: 'about.html', path: '', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['index.html', { path: '/test/sync/index.html', relativePath: 'index.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['about.html', { path: '/test/sync/about.html', relativePath: 'about.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(syncEngine.repo.get('42').path).toBe('index.html');
    expect(syncEngine.repo.get('73').path).toBe('about.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });
});

describe('offline delete reconciliation', () => {
  test('skips entirely on first-ever sync (no lastSyncedAt)', async () => {
    syncEngine.repo.seed([['99', entry('deleted-on-server.html')]]);
    syncEngine.lastSyncedAt = null;

    apiClient.listNodes.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['deleted-on-server.html', { path: '/test/sync/deleted-on-server.html', relativePath: 'deleted-on-server.html', mtime: new Date('2024-01-01'), size: 100 }]
    ]));

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
  });

  test('trashes stale local file when nodeId missing from server', async () => {
    syncEngine.repo.seed([['99', entry('old-site.html')]]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.listNodes.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['old-site.html', { path: '/test/sync/old-site.html', relativePath: 'old-site.html', mtime: new Date('2024-01-01'), size: 100 }]
    ]));
    fileOps.fileExists.mockResolvedValue(true);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/old-site.html',
      '/test/sync/.trash/old-site.html'
    );
    expect(syncEngine.repo.has('99')).toBe(false);
  });

  test('preserves locally-edited file when mtime is newer than lastSyncedAt', async () => {
    const lastSync = new Date('2024-06-01').getTime();
    syncEngine.repo.seed([['99', entry('edited-locally.html')]]);
    syncEngine.lastSyncedAt = lastSync;

    apiClient.listNodes.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['edited-locally.html', { path: '/test/sync/edited-locally.html', relativePath: 'edited-locally.html', mtime: new Date('2024-07-01'), size: 200 }]
    ]));
    fileOps.fileExists.mockResolvedValue(true);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-07-01'), size: 200 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('99')).toBe(false);
  });

  test('trashed paths are removed from localFiles before upload pass', async () => {
    syncEngine.repo.seed([['99', entry('trashed.html')]]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.listNodes.mockResolvedValue([]);
    const localFiles = new Map([
      ['trashed.html', { path: '/test/sync/trashed.html', relativePath: 'trashed.html', mtime: new Date('2024-01-01'), size: 100 }]
    ]);
    fileOps.getLocalFiles.mockResolvedValue(localFiles);
    fileOps.fileExists.mockResolvedValue(true);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(apiClient.createNode).not.toHaveBeenCalled();
  });

  test('persists lastSyncedAt after successful sync', async () => {
    apiClient.listNodes.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(nodeMapModule.saveState).toHaveBeenCalledWith(
      '/test/meta',
      expect.objectContaining({ lastSyncedAt: expect.any(Number) })
    );
    expect(syncEngine.lastSyncedAt).toBeGreaterThan(0);
  });
});

describe('handleNodeRenamed', () => {
  test('renames local file and updates nodeMap', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html', 'abc', 111)]]);

    await syncEngine.handleNodeRenamed({
      nodeId: 42, nodeType: 'site',
      oldName: 'my-site.html', newName: 'new-name.html',
      oldPath: 'my-site.html', newPath: 'new-name.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/new-name.html'
    );
    expect(syncEngine.repo.get('42').path).toBe('new-name.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('renames file in subfolder correctly', async () => {
    syncEngine.repo.seed([['42', entry('blog/my-site.html', 'abc', 111)]]);

    await syncEngine.handleNodeRenamed({
      nodeId: 42, nodeType: 'site',
      oldName: 'my-site.html', newName: 'new-name.html',
      oldPath: 'blog/my-site.html', newPath: 'blog/new-name.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/blog/my-site.html',
      '/test/sync/blog/new-name.html'
    );
    expect(syncEngine.repo.get('42').path).toBe('blog/new-name.html');
  });

  test('updates nodeMap even when source file not found', async () => {
    syncEngine.repo.seed([['42', entry('gone.html', 'abc', 111)]]);
    fileOps.fileExists.mockResolvedValue(false);

    await syncEngine.handleNodeRenamed({
      nodeId: 42, nodeType: 'site',
      oldName: 'gone.html', newName: 'new.html',
      oldPath: 'gone.html', newPath: 'new.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('42').path).toBe('new.html');
  });

  test('suppresses watcher cascade with full old + new paths on sites', async () => {
    syncEngine.repo.seed([['42', entry('blog/my-site.html', 'abc', 111)]]);
    const cascadeSpy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine.handleNodeRenamed({
      nodeId: 42, nodeType: 'site',
      oldName: 'my-site.html', newName: 'new-name.html',
      oldPath: 'blog/my-site.html', newPath: 'blog/new-name.html'
    });

    expect(cascadeSpy).toHaveBeenCalledWith(['blog/my-site.html', 'blog/new-name.html']);
  });
});

describe('handleNodeMoved', () => {
  test('moves local file and updates nodeMap', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html', 'abc', 111)]]);

    await syncEngine.handleNodeMoved({
      nodeId: 42, nodeType: 'site',
      oldPath: 'my-site.html', newPath: 'blog/my-site.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/blog/my-site.html'
    );
    expect(syncEngine.repo.get('42').path).toBe('blog/my-site.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('uses nodeMap path over oldPath when available', async () => {
    syncEngine.repo.seed([['42', entry('actual-location.html', 'abc', 111)]]);

    await syncEngine.handleNodeMoved({
      nodeId: 42, nodeType: 'site',
      oldPath: 'old-location.html', newPath: 'blog/my-site.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/actual-location.html',
      '/test/sync/blog/my-site.html'
    );
  });

  test('updates map even when source file not found', async () => {
    syncEngine.repo.seed([['42', entry('gone.html')]]);
    fileOps.fileExists.mockResolvedValue(false);

    await syncEngine.handleNodeMoved({
      nodeId: 42, nodeType: 'site',
      oldPath: 'gone.html', newPath: 'blog/my-site.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('42').path).toBe('blog/my-site.html');
  });

  test('suppresses watcher cascade with full old + new paths on sites', async () => {
    syncEngine.repo.seed([['42', entry('blog/my-site.html', 'abc', 111)]]);
    const cascadeSpy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine.handleNodeMoved({
      nodeId: 42, nodeType: 'site',
      oldPath: 'blog/my-site.html', newPath: 'projects/my-site.html'
    });

    expect(cascadeSpy).toHaveBeenCalledWith(['blog/my-site.html', 'projects/my-site.html']);
  });
});

describe('handleNodeDeleted', () => {
  test('trashes local file and removes from nodeMap', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'my-site.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/.trash/my-site.html'
    );
    expect(syncEngine.repo.has('42')).toBe(false);
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('uses nodeMap path over data.path', async () => {
    syncEngine.repo.seed([['42', entry('blog/actual-name.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'different-name.html', path: 'different-name.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/blog/actual-name.html',
      '/test/sync/.trash/blog/actual-name.html'
    );
  });

  test('removes from nodeMap even when file not found locally', async () => {
    syncEngine.repo.seed([['42', entry('gone.html')]]);
    fileOps.fileExists.mockResolvedValue(false);

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'gone.html', path: 'gone.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('42')).toBe(false);
  });

  test('suppresses watcher cascade with full path on sites', async () => {
    syncEngine.repo.seed([['42', entry('blog/my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);
    const cascadeSpy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'blog/my-site.html'
    });

    expect(cascadeSpy).toHaveBeenCalledWith(['blog/my-site.html']);
  });
});

describe('handleNodeSaved — site nodeId tracking', () => {
  test('writes content and updates nodeMap', async () => {
    fileOps.readFile.mockRejectedValue(new Error('ENOENT'));

    await syncEngine.handleNodeSaved({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'my-site.html',
      content: '<html></html>', checksum: 'abc',
      modifiedAt: '2024-06-01T00:00:00Z'
    });

    expect(syncEngine.repo.get('42').path).toBe('my-site.html');
    expect(syncEngine.repo.get('42').type).toBe('site');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('updates nodeMap on checksum match (skip write)', async () => {
    const content = '<html>existing</html>';
    const cs = checksum(content);
    fileOps.readFile.mockResolvedValue(content);

    await syncEngine.handleNodeSaved({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'my-site.html',
      content: content, checksum: cs,
      modifiedAt: '2024-06-01T00:00:00Z'
    });

    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(syncEngine.repo.get('42').path).toBe('my-site.html');
    expect(syncEngine.repo.get('42').type).toBe('site');
  });
});

describe('uploadFile — nodeId from response', () => {
  test('records nodeId in map with object entry after successful upload', async () => {
    fileOps.readFile.mockResolvedValue('<html>content</html>');
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-06-01'), size: 100 });
    apiClient.listNodes.mockResolvedValue([]);
    apiClient.createNode.mockResolvedValue({ id: 42, type: 'site', name: 'my-site.html', parentId: 0, path: '' });

    await syncEngine.uploadFile('my-site.html');

    const mapEntry = syncEngine.repo.get('42');
    expect(mapEntry.path).toBe('my-site.html');
    expect(mapEntry.checksum).toBeTruthy();
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('does not update map when response has no nodeId', async () => {
    fileOps.readFile.mockResolvedValue('<html>content</html>');
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-06-01'), size: 100 });
    apiClient.listNodes.mockResolvedValue([]);
    apiClient.createNode.mockResolvedValue({ type: 'site', name: 'my-site.html', parentId: 0, path: '' });

    await syncEngine.uploadFile('my-site.html');

    expect(syncEngine.repo.size).toBe(0);
  });
});
