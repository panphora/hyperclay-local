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
  getServerBaseUrl: (url) => url || 'http://localhost:3000'
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

function entry(p, cs, ino) {
  return { path: p, checksum: cs || null, inode: ino || null };
}

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.syncFolder = '/test/sync';
  syncEngine.serverUrl = 'http://localhost:3000';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.username = 'testuser';
  syncEngine.clockOffset = 0;
  syncEngine.isRunning = true;
  syncEngine.nodeMap = new Map();
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
  apiClient.downloadFromServer.mockResolvedValue({
    content: '<html>server content</html>',
    modifiedAt: '2024-06-01T00:00:00Z',
    checksum: checksum('<html>server content</html>')
  });
  apiClient.uploadToServer.mockResolvedValue({ success: true, nodeId: 1 });
  apiClient.fetchServerFiles.mockResolvedValue([]);
  apiClient.deleteFileOnServer.mockResolvedValue({ success: true });
  apiClient.renameFileOnServer.mockResolvedValue({ success: true });
  apiClient.moveFileOnServer.mockResolvedValue({ success: true });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);
});

describe('reconcileServerFile — nodeId move detection', () => {
  test('moves file when nodeId maps to a different local path', async () => {
    const content = '<html>my site</html>';
    const cs = checksum(content);

    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);

    apiClient.fetchServerFiles.mockResolvedValue([
      { nodeId: 42, filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
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
    apiClient.fetchServerFiles.mockResolvedValue([
      { nodeId: 42, filename: 'new-site', path: 'new-site.html', checksum: 'abc', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(apiClient.downloadFromServer).toHaveBeenCalledWith(
      'http://localhost:3000',
      'hcsk_test',
      'new-site'
    );
  });

  test('populates nodeMap with object entries after reconciling each server file', async () => {
    const content = '<html>content</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { nodeId: 42, filename: 'index', path: 'index.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' },
      { nodeId: 73, filename: 'about', path: 'about.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['index.html', { path: '/test/sync/index.html', relativePath: 'index.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['about.html', { path: '/test/sync/about.html', relativePath: 'about.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(syncEngine.nodeMap.get('42').path).toBe('index.html');
    expect(syncEngine.nodeMap.get('73').path).toBe('about.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });
});

describe('offline delete reconciliation', () => {
  test('skips entirely on first-ever sync (no lastSyncedAt)', async () => {
    syncEngine.nodeMap = new Map([['99', entry('deleted-on-server.html')]]);
    syncEngine.lastSyncedAt = null;

    apiClient.fetchServerFiles.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['deleted-on-server.html', { path: '/test/sync/deleted-on-server.html', relativePath: 'deleted-on-server.html', mtime: new Date('2024-01-01'), size: 100 }]
    ]));

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
  });

  test('trashes stale local file when nodeId missing from server', async () => {
    syncEngine.nodeMap = new Map([['99', entry('old-site.html')]]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.fetchServerFiles.mockResolvedValue([]);
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
    expect(syncEngine.nodeMap.has('99')).toBe(false);
  });

  test('preserves locally-edited file when mtime is newer than lastSyncedAt', async () => {
    const lastSync = new Date('2024-06-01').getTime();
    syncEngine.nodeMap = new Map([['99', entry('edited-locally.html')]]);
    syncEngine.lastSyncedAt = lastSync;

    apiClient.fetchServerFiles.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['edited-locally.html', { path: '/test/sync/edited-locally.html', relativePath: 'edited-locally.html', mtime: new Date('2024-07-01'), size: 200 }]
    ]));
    fileOps.fileExists.mockResolvedValue(true);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-07-01'), size: 200 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.has('99')).toBe(false);
  });

  test('trashed paths are removed from localFiles before upload pass', async () => {
    syncEngine.nodeMap = new Map([['99', entry('trashed.html')]]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.fetchServerFiles.mockResolvedValue([]);
    const localFiles = new Map([
      ['trashed.html', { path: '/test/sync/trashed.html', relativePath: 'trashed.html', mtime: new Date('2024-01-01'), size: 100 }]
    ]);
    fileOps.getLocalFiles.mockResolvedValue(localFiles);
    fileOps.fileExists.mockResolvedValue(true);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(apiClient.uploadToServer).not.toHaveBeenCalled();
  });

  test('persists lastSyncedAt after successful sync', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(nodeMapModule.saveState).toHaveBeenCalledWith(
      '/test/sync',
      expect.objectContaining({ lastSyncedAt: expect.any(Number) })
    );
    expect(syncEngine.lastSyncedAt).toBeGreaterThan(0);
  });
});

describe('handleFileRenamed', () => {
  test('renames local file and updates nodeMap', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', 'abc', 111)]]);

    await syncEngine.handleFileRenamed(42, 'my-site', 'new-name');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/new-name.html'
    );
    expect(syncEngine.nodeMap.get('42').path).toBe('new-name.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('renames file in subfolder correctly', async () => {
    syncEngine.nodeMap = new Map([['42', entry('blog/my-site.html', 'abc', 111)]]);

    await syncEngine.handleFileRenamed(42, 'my-site', 'new-name');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/blog/my-site.html',
      '/test/sync/blog/new-name.html'
    );
    expect(syncEngine.nodeMap.get('42').path).toBe('blog/new-name.html');
  });

  test('skips when nodeId not in map', async () => {
    syncEngine.nodeMap = new Map();

    await syncEngine.handleFileRenamed(999, 'old', 'new');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
  });

  test('uses toFileId for markBrowserSave', async () => {
    syncEngine.nodeMap = new Map([['42', entry('blog/my-site.html', 'abc', 111)]]);

    await syncEngine.handleFileRenamed(42, 'my-site', 'new-name');

    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('blog/my-site');
    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('blog/new-name');
  });
});

describe('handleFileMoved', () => {
  test('moves local file and updates nodeMap', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', 'abc', 111)]]);

    await syncEngine.handleFileMoved(42, 'my-site', 'my-site.html', 'blog/my-site.html');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/blog/my-site.html'
    );
    expect(syncEngine.nodeMap.get('42').path).toBe('blog/my-site.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('uses nodeMap path over fromPath when available', async () => {
    syncEngine.nodeMap = new Map([['42', entry('actual-location.html', 'abc', 111)]]);

    await syncEngine.handleFileMoved(42, 'my-site', 'old-location.html', 'blog/my-site.html');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/actual-location.html',
      '/test/sync/blog/my-site.html'
    );
  });

  test('updates map even when source file not found', async () => {
    syncEngine.nodeMap = new Map([['42', entry('gone.html')]]);
    fileOps.fileExists.mockResolvedValue(false);

    await syncEngine.handleFileMoved(42, 'my-site', 'gone.html', 'blog/my-site.html');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.get('42').path).toBe('blog/my-site.html');
  });

  test('uses toFileId for markBrowserSave', async () => {
    syncEngine.nodeMap = new Map([['42', entry('blog/my-site.html', 'abc', 111)]]);

    await syncEngine.handleFileMoved(42, 'my-site', 'blog/my-site.html', 'projects/my-site.html');

    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('blog/my-site');
    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('projects/my-site');
  });
});

describe('handleFileDeleted', () => {
  test('trashes local file and removes from nodeMap', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleFileDeleted(42, 'my-site');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      '/test/sync/.trash/my-site.html'
    );
    expect(syncEngine.nodeMap.has('42')).toBe(false);
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('uses nodeMap path over file parameter', async () => {
    syncEngine.nodeMap = new Map([['42', entry('blog/actual-name.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleFileDeleted(42, 'different-name');

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/blog/actual-name.html',
      '/test/sync/.trash/blog/actual-name.html'
    );
  });

  test('removes from nodeMap even when file not found locally', async () => {
    syncEngine.nodeMap = new Map([['42', entry('gone.html')]]);
    fileOps.fileExists.mockResolvedValue(false);

    await syncEngine.handleFileDeleted(42, 'gone');

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.has('42')).toBe(false);
  });

  test('uses toFileId for markBrowserSave', async () => {
    syncEngine.nodeMap = new Map([['42', entry('blog/my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleFileDeleted(42, 'my-site');

    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('blog/my-site');
  });
});

describe('handleFileSaved — nodeId tracking', () => {
  test('updates nodeMap with object entry when nodeId is provided', async () => {
    fileOps.readFile.mockRejectedValue(new Error('ENOENT'));

    await syncEngine.handleFileSaved('my-site', '<html></html>', 'abc', '2024-06-01T00:00:00Z', 42);

    expect(syncEngine.nodeMap.get('42').path).toBe('my-site.html');
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('updates nodeMap on checksum match (skip write)', async () => {
    const content = '<html>existing</html>';
    const cs = checksum(content);
    fileOps.readFile.mockResolvedValue(content);

    await syncEngine.handleFileSaved('my-site', content, cs, '2024-06-01T00:00:00Z', 42);

    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(syncEngine.nodeMap.get('42').path).toBe('my-site.html');
  });

  test('does not update nodeMap when nodeId is undefined', async () => {
    fileOps.readFile.mockRejectedValue(new Error('ENOENT'));

    await syncEngine.handleFileSaved('my-site', '<html></html>', 'abc', '2024-06-01T00:00:00Z', undefined);

    expect(syncEngine.nodeMap.size).toBe(0);
  });
});

describe('uploadFile — nodeId from response', () => {
  test('records nodeId in map with object entry after successful upload', async () => {
    fileOps.readFile.mockResolvedValue('<html>content</html>');
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-06-01'), size: 100 });
    apiClient.fetchServerFiles.mockResolvedValue([]);
    apiClient.uploadToServer.mockResolvedValue({ success: true, nodeId: 42 });

    await syncEngine.uploadFile('my-site.html');

    const mapEntry = syncEngine.nodeMap.get('42');
    expect(mapEntry.path).toBe('my-site.html');
    expect(mapEntry.checksum).toBeTruthy();
    expect(nodeMapModule.save).toHaveBeenCalled();
  });

  test('does not update map when response has no nodeId', async () => {
    fileOps.readFile.mockResolvedValue('<html>content</html>');
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-06-01'), size: 100 });
    apiClient.fetchServerFiles.mockResolvedValue([]);
    apiClient.uploadToServer.mockResolvedValue({ success: true });

    await syncEngine.uploadFile('my-site.html');

    expect(syncEngine.nodeMap.size).toBe(0);
  });
});
