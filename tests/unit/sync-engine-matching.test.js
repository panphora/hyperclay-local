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
const { liveSync } = require('livesync-hyperclay');

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');

const crypto = require('crypto');
function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  // Re-require to get a fresh singleton
  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  // Set up minimal state so performInitialSync can run
  syncEngine.syncFolder = '/test/sync';
  syncEngine.serverUrl = 'http://localhost:3000';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.username = 'testuser';
  syncEngine.clockOffset = 0;
  syncEngine.isRunning = false;
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

  // Default mocks
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.writeFile.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.fileExists.mockReturnValue(true);
  apiClient.downloadFromServer.mockResolvedValue({
    content: '<html>server content</html>',
    modifiedAt: '2024-06-01T00:00:00Z',
    checksum: checksum('<html>server content</html>')
  });
  apiClient.uploadToServer.mockResolvedValue({ success: true });
});

describe('performInitialSync — file path matching and move', () => {
  test('moves local file to server path when same site name exists at different path', async () => {
    const content = '<html>my site</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
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
    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('my-site');

    // Should NOT try to download since the file was moved
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();

    // Should NOT try to upload the old path (it was removed from localFiles)
    expect(apiClient.uploadToServer).not.toHaveBeenCalled();
  });

  test('does not move when file exists at correct path', async () => {
    const content = '<html>my site</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'my-site', path: 'my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();
  });

  test('downloads file when it only exists on server', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'new-site', path: 'new-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z' }
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

  test('uploads file when it only exists locally', async () => {
    const content = '<html>local only</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['local-only.html', { path: '/test/sync/local-only.html', relativePath: 'local-only.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(apiClient.uploadToServer).toHaveBeenCalled();
  });

  test('moved file with matching checksum skips download', async () => {
    const content = '<html>same content</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    // File was moved
    expect(fileOps.moveFile).toHaveBeenCalled();

    // Checksums match so no download needed
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();
    expect(syncEngine.stats.filesDownloadedSkipped).toBe(1);
  });

  test('moved file with local newer preserves content', async () => {
    const localContent = '<html>local newer</html>';
    const serverContent = '<html>server older</html>';

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: checksum(serverContent), modifiedAt: '2024-01-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-06-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(localContent);
    // Return a date newer than server's modifiedAt
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-06-01'), size: 100 });

    await syncEngine.performInitialSync();

    // File was moved to match server organization
    expect(fileOps.moveFile).toHaveBeenCalled();

    // But local is newer so content is preserved (no download)
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();
    expect(syncEngine.stats.filesProtected).toBe(1);
  });

  test('handles move failure gracefully by falling back to download', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.moveFile.mockRejectedValue(new Error('EACCES: permission denied'));

    await syncEngine.performInitialSync();

    // Move failed, should fall back to downloading
    expect(apiClient.downloadFromServer).toHaveBeenCalledWith(
      'http://localhost:3000',
      'hcsk_test',
      'blog/my-site'
    );
  });

  test('does not move when names differ (only moves exact name matches)', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);

    // Local has a DIFFERENT site name — should not be moved
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['other-site.html', { path: '/test/sync/other-site.html', relativePath: 'other-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    // Server file should be downloaded since no local match
    expect(apiClient.downloadFromServer).toHaveBeenCalled();
    // Local file should be uploaded since no server match
    expect(apiClient.uploadToServer).toHaveBeenCalled();
  });
});
