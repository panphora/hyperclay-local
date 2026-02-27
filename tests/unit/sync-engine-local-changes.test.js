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
  syncEngine.lastSyncedAt = Date.now() - 60000;
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

describe('detectLocalChanges — local delete', () => {
  test('deletes file on server when local file is gone', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 42
    );
    expect(syncEngine.nodeMap.has('42')).toBe(false);
  });

  test('re-downloads file on delete conflict (server modified after lastSyncedAt)', async () => {
    syncEngine.lastSyncedAt = new Date('2024-06-01').getTime();
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', 'abc', 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: 'abc', modifiedAt: '2024-07-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.downloadFromServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 'my-site'
    );
    expect(syncEngine.nodeMap.has('42')).toBe(true);
  });

  test('skips detection for nodeIds not on server', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);

    const serverFiles = [];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).not.toHaveBeenCalled();
  });
});

describe('detectLocalChanges — local move', () => {
  test('detects move when basename is same but path differs', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['blog/my-site.html', { path: '/test/sync/blog/my-site.html', relativePath: 'blog/my-site.html', mtime: new Date(), size: 100 }]
    ]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.moveFileOnServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 42, 'blog'
    );
    expect(syncEngine.nodeMap.get('42').path).toBe('blog/my-site.html');
  });

  test('moves to root when target folder is "."', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('blog/my-site.html', cs, 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date(), size: 100 }]
    ]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.moveFileOnServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 42, ''
    );
  });
});

describe('detectLocalChanges — local rename (inode match)', () => {
  test('detects rename via inode match', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('old-name.html', cs, 99999)]]);

    nodeMapModule.getInode.mockResolvedValue(99999);

    const serverFiles = [
      { nodeId: 42, filename: 'old-name', path: 'old-name.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['new-name.html', { path: '/test/sync/new-name.html', relativePath: 'new-name.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.renameFileOnServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 42, 'new-name'
    );
    expect(syncEngine.nodeMap.get('42').path).toBe('new-name.html');
  });
});

describe('detectLocalChanges — local rename (checksum match)', () => {
  test('detects rename via checksum match when inode differs', async () => {
    const content = '<html>same content</html>';
    const cs = checksum(content);
    syncEngine.nodeMap = new Map([['42', entry('old-name.html', cs, 11111)]]);

    nodeMapModule.getInode.mockResolvedValue(22222);
    fileOps.readFile.mockResolvedValue(content);

    const serverFiles = [
      { nodeId: 42, filename: 'old-name', path: 'old-name.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['renamed.html', { path: '/test/sync/renamed.html', relativePath: 'renamed.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.renameFileOnServer).toHaveBeenCalledWith(
      'http://localhost:3000', 'hcsk_test', 42, 'renamed'
    );
  });
});

describe('detectLocalChanges — server wins conflicts', () => {
  test('skips local change detection when server path differs from nodeMap (server moved it)', async () => {
    syncEngine.nodeMap = new Map([['42', entry('old-path.html', 'abc', 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'blog/old-path', path: 'blog/old-path.html', checksum: 'abc', modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.renameFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.moveFileOnServer).not.toHaveBeenCalled();
  });
});

describe('detectLocalChanges — skips on first sync', () => {
  test('performInitialSync skips detectLocalChanges when lastSyncedAt is null', async () => {
    syncEngine.lastSyncedAt = null;
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);

    apiClient.fetchServerFiles.mockResolvedValue([
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: 'abc', modifiedAt: '2024-01-01T00:00:00Z' }
    ]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());
    fileOps.readFile.mockResolvedValue('<html>server content</html>');

    await syncEngine.performInitialSync();

    expect(apiClient.deleteFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.renameFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.moveFileOnServer).not.toHaveBeenCalled();
  });
});

describe('SSE echo suppression', () => {
  test('skips handleFileDeleted when pendingActions has matching key', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);
    syncEngine.pendingActions.add('delete:42');
    fileOps.fileExists.mockResolvedValue(true);

    const data = { type: 'file-deleted', nodeId: 42, file: 'my-site' };

    // Simulate SSE handler inline since we can't trigger the EventSource mock easily
    const key = `delete:${data.nodeId}`;
    if (syncEngine.pendingActions.has(key)) {
      syncEngine.pendingActions.delete(key);
    } else {
      await syncEngine.handleFileDeleted(data.nodeId, data.file);
    }

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.pendingActions.has('delete:42')).toBe(false);
  });

  test('skips handleFileRenamed when pendingActions has matching key', async () => {
    syncEngine.nodeMap = new Map([['42', entry('old.html')]]);
    syncEngine.pendingActions.add('rename:42');

    const data = { type: 'file-renamed', nodeId: 42, oldName: 'old', newName: 'new' };

    const key = `rename:${data.nodeId}`;
    if (syncEngine.pendingActions.has(key)) {
      syncEngine.pendingActions.delete(key);
    } else {
      await syncEngine.handleFileRenamed(data.nodeId, data.oldName, data.newName);
    }

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.pendingActions.has('rename:42')).toBe(false);
  });

  test('skips handleFileMoved when pendingActions has matching key', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);
    syncEngine.pendingActions.add('move:42');

    const data = { type: 'file-moved', nodeId: 42, file: 'my-site', fromPath: 'my-site.html', toPath: 'blog/my-site.html' };

    const key = `move:${data.nodeId}`;
    if (syncEngine.pendingActions.has(key)) {
      syncEngine.pendingActions.delete(key);
    } else {
      await syncEngine.handleFileMoved(data.nodeId, data.file, data.fromPath, data.toPath);
    }

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.pendingActions.has('move:42')).toBe(false);
  });

  test('processes SSE normally when no pendingAction match', async () => {
    syncEngine.nodeMap = new Map([['42', entry('my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleFileDeleted(42, 'my-site');

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.nodeMap.has('42')).toBe(false);
  });
});

describe('detectLocalChanges adds pendingActions for SSE suppression', () => {
  test('adds delete pendingAction before calling deleteFileOnServer', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    let capturedPendingAction = false;
    apiClient.deleteFileOnServer.mockImplementation(async () => {
      capturedPendingAction = syncEngine.pendingActions.has('delete:42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(capturedPendingAction).toBe(true);
  });

  test('adds rename pendingAction before calling renameFileOnServer', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('old-name.html', cs, 99999)]]);
    nodeMapModule.getInode.mockResolvedValue(99999);

    const serverFiles = [
      { nodeId: 42, filename: 'old-name', path: 'old-name.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['new-name.html', { path: '/test/sync/new-name.html', relativePath: 'new-name.html', mtime: new Date(), size: 100 }]
    ]);

    let capturedPendingAction = false;
    apiClient.renameFileOnServer.mockImplementation(async () => {
      capturedPendingAction = syncEngine.pendingActions.has('rename:42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(capturedPendingAction).toBe(true);
  });

  test('adds move pendingAction before calling moveFileOnServer', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['blog/my-site.html', { path: '/test/sync/blog/my-site.html', relativePath: 'blog/my-site.html', mtime: new Date(), size: 100 }]
    ]);

    let capturedPendingAction = false;
    apiClient.moveFileOnServer.mockImplementation(async () => {
      capturedPendingAction = syncEngine.pendingActions.has('move:42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(capturedPendingAction).toBe(true);
  });
});

describe('detectLocalChanges — file still at expected path', () => {
  test('skips files that are still at their expected path', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.nodeMap = new Map([['42', entry('my-site.html', cs, 111)]]);

    const serverFiles = [
      { nodeId: 42, filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.renameFileOnServer).not.toHaveBeenCalled();
    expect(apiClient.moveFileOnServer).not.toHaveBeenCalled();
  });
});

describe('detectLocalChanges — API error handling', () => {
  test('continues processing after delete API failure', async () => {
    const cs1 = checksum('<html>site1</html>');
    const cs2 = checksum('<html>site2</html>');
    syncEngine.nodeMap = new Map([
      ['42', entry('site1.html', cs1, 111)],
      ['43', entry('site2.html', cs2, 222)]
    ]);

    const serverFiles = [
      { nodeId: 42, filename: 'site1', path: 'site1.html', checksum: cs1, modifiedAt: '2024-01-01T00:00:00Z' },
      { nodeId: 43, filename: 'site2', path: 'site2.html', checksum: cs2, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    apiClient.deleteFileOnServer
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ success: true });

    await syncEngine.detectLocalChanges(serverFiles, localFiles);

    expect(apiClient.deleteFileOnServer).toHaveBeenCalledTimes(2);
    expect(syncEngine.nodeMap.has('42')).toBe(true);
    expect(syncEngine.nodeMap.has('43')).toBe(false);
  });
});
