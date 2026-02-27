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
  syncEngine.nodeMap = new Map();
  syncEngine.lastSyncedAt = null;
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
  apiClient.uploadToServer.mockResolvedValue({ success: true, nodeId: 999 });
  apiClient.deleteFileOnServer.mockResolvedValue({ success: true });
  apiClient.renameFileOnServer.mockResolvedValue({ success: true });
  apiClient.moveFileOnServer.mockResolvedValue({ success: true });
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);
});

describe('performInitialSync — nodeId-based move detection', () => {
  test('moves local file when nodeId maps to a different local path', async () => {
    const content = '<html>my site</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('my-site.html')]]);

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

  test('downloads file when it only exists on server', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'new-site', path: 'new-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
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
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('my-site.html')]]);

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
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: checksum(serverContent), modifiedAt: '2024-01-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-06-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('my-site.html')]]);

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
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('my-site.html')]]);

    fileOps.moveFile.mockRejectedValue(new Error('EACCES: permission denied'));

    await syncEngine.performInitialSync();

    // Move failed, should fall back to downloading
    expect(apiClient.downloadFromServer).toHaveBeenCalledWith(
      'http://localhost:3000',
      'hcsk_test',
      'blog/my-site'
    );
  });

  test('does not move when nodeId has no local mapping', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog/my-site', path: 'blog/my-site.html', checksum: 'abc123', modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    // Local has a DIFFERENT site — nodeMap has no entry for nodeId 1
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

describe('performInitialSync — duplicate filename handling', () => {
  test('nodeId-mapped file is moved even when duplicates exist', async () => {
    const content = '<html>matching</html>';
    const serverChecksum = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'projects/blog', path: 'projects/blog.html', checksum: serverChecksum, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['archive/blog.html', { path: '/test/sync/archive/blog.html', relativePath: 'archive/blog.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('archive/blog.html')]]);

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/archive/blog.html',
      '/test/sync/projects/blog.html'
    );
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();
  });

  test('orphan duplicate skipped during upload phase', async () => {
    const content = '<html>blog content</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'projects/blog', path: 'projects/blog.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    // Both exist locally: one at the correct path, one orphan
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['projects/blog.html', { path: '/test/sync/projects/blog.html', relativePath: 'projects/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    // Orphan should NOT be uploaded (name already exists on server)
    expect(apiClient.uploadToServer).not.toHaveBeenCalled();
  });

  test('sync-warning emitted for duplicate filenames', async () => {
    const content = '<html>content</html>';
    const cs = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'blog', path: 'blog.html', checksum: cs, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['archive/blog.html', { path: '/test/sync/archive/blog.html', relativePath: 'archive/blog.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue(content);
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    const warnings = [];
    syncEngine.on('sync-warning', (data) => warnings.push(data));

    await syncEngine.performInitialSync();

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('duplicate-filename');
    expect(warnings[0].filename).toBe('blog.html');
    expect(warnings[0].paths).toEqual(['drafts/blog.html', 'archive/blog.html']);
  });

  test('no warning emitted when filenames are unique', async () => {
    apiClient.fetchServerFiles.mockResolvedValue([]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['archive/about.html', { path: '/test/sync/archive/about.html', relativePath: 'archive/about.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    fileOps.readFile.mockResolvedValue('<html>content</html>');
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    const warnings = [];
    syncEngine.on('sync-warning', (data) => warnings.push(data));

    await syncEngine.performInitialSync();

    expect(warnings).toHaveLength(0);
  });

  test('move failure with nodeId mapping falls back to download', async () => {
    const content = '<html>matching</html>';
    const serverChecksum = checksum(content);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'projects/blog', path: 'projects/blog.html', checksum: serverChecksum, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([['1', entry('drafts/blog.html')]]);

    fileOps.moveFile.mockRejectedValue(new Error('EACCES: permission denied'));

    await syncEngine.performInitialSync();

    // Move was attempted for the nodeId-mapped file
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/drafts/blog.html',
      '/test/sync/projects/blog.html'
    );
    // Move failed, should fall back to downloading
    expect(apiClient.downloadFromServer).toHaveBeenCalledWith(
      'http://localhost:3000',
      'hcsk_test',
      'projects/blog'
    );
  });

  test('multiple server files with nodeId mappings resolve independently', async () => {
    const blogContent = '<html>blog</html>';
    const aboutContent = '<html>about</html>';
    const blogChecksum = checksum(blogContent);
    const aboutChecksum = checksum(aboutContent);

    apiClient.fetchServerFiles.mockResolvedValue([
      { filename: 'projects/blog', path: 'projects/blog.html', checksum: blogChecksum, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 1 },
      { filename: 'work/about', path: 'work/about.html', checksum: aboutChecksum, modifiedAt: '2024-06-01T00:00:00Z', nodeId: 2 }
    ]);

    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['drafts/blog.html', { path: '/test/sync/drafts/blog.html', relativePath: 'drafts/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['old/blog.html', { path: '/test/sync/old/blog.html', relativePath: 'old/blog.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['misc/about.html', { path: '/test/sync/misc/about.html', relativePath: 'misc/about.html', mtime: new Date('2024-05-01'), size: 100 }],
      ['archive/about.html', { path: '/test/sync/archive/about.html', relativePath: 'archive/about.html', mtime: new Date('2024-05-01'), size: 100 }]
    ]));

    syncEngine.nodeMap = new Map([
      ['1', entry('drafts/blog.html')],
      ['2', entry('archive/about.html')]
    ]);

    fileOps.readFile.mockImplementation((filePath) => {
      if (filePath.includes('blog')) return Promise.resolve(blogContent);
      if (filePath.includes('about')) return Promise.resolve(aboutContent);
      return Promise.resolve('');
    });
    fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-05-01'), size: 100 });

    await syncEngine.performInitialSync();

    // blog: drafts/blog.html mapped by nodeId → moved to projects/blog.html
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/drafts/blog.html',
      '/test/sync/projects/blog.html'
    );
    // about: archive/about.html mapped by nodeId → moved to work/about.html
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/archive/about.html',
      '/test/sync/work/about.html'
    );
    expect(fileOps.moveFile).toHaveBeenCalledTimes(2);

    // No downloads needed (checksums match after move)
    expect(apiClient.downloadFromServer).not.toHaveBeenCalled();
    // Orphans (old/blog.html, misc/about.html) should not be uploaded
    expect(apiClient.uploadToServer).not.toHaveBeenCalled();
  });
});

describe('handleFileSaved — SSE with duplicate on disk', () => {
  test('writes to server-specified path regardless of duplicates elsewhere', async () => {
    const content = '<html>updated blog</html>';
    const cs = checksum(content);

    fileOps.readFile.mockRejectedValue(new Error('ENOENT'));
    fileOps.writeFile.mockResolvedValue();
    fileOps.ensureDirectory.mockResolvedValue();

    syncEngine.syncFolder = '/test/sync';
    syncEngine.isRunning = true;

    await syncEngine.handleFileSaved('projects/blog', content, cs, '2024-06-01T00:00:00Z', 42);

    // Should write to the exact path derived from the file name
    expect(fileOps.writeFile).toHaveBeenCalledWith(
      '/test/sync/projects/blog.html',
      content,
      new Date('2024-06-01T00:00:00Z')
    );
    expect(syncEngine.stats.filesDownloaded).toBe(1);
  });
});

describe('handleFileSaved — SSE folder path preservation', () => {
  beforeEach(() => {
    fileOps.readFile.mockRejectedValue(new Error('ENOENT'));
    fileOps.writeFile.mockResolvedValue();
    fileOps.ensureDirectory.mockResolvedValue();
    syncEngine.syncFolder = '/test/sync';
    syncEngine.isRunning = true;
  });

  test('file with folder prefix writes to subfolder', async () => {
    const content = '<html>blog post</html>';
    const cs = checksum(content);

    await syncEngine.handleFileSaved('blog/hyperclay-is-ready', content, cs, '2024-06-01T00:00:00Z', 1);

    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/blog');
    expect(fileOps.writeFile).toHaveBeenCalledWith(
      '/test/sync/blog/hyperclay-is-ready.html',
      content,
      new Date('2024-06-01T00:00:00Z')
    );
  });

  test('file without folder prefix writes to root', async () => {
    const content = '<html>root site</html>';
    const cs = checksum(content);

    await syncEngine.handleFileSaved('my-site', content, cs, '2024-06-01T00:00:00Z', 1);

    expect(fileOps.writeFile).toHaveBeenCalledWith(
      '/test/sync/my-site.html',
      content,
      new Date('2024-06-01T00:00:00Z')
    );
  });

  test('deeply nested folder path creates full directory structure', async () => {
    const content = '<html>deep site</html>';
    const cs = checksum(content);

    await syncEngine.handleFileSaved('projects/2026/launch/deep-site', content, cs, '2024-06-01T00:00:00Z', 1);

    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/projects/2026/launch');
    expect(fileOps.writeFile).toHaveBeenCalledWith(
      '/test/sync/projects/2026/launch/deep-site.html',
      content,
      new Date('2024-06-01T00:00:00Z')
    );
  });

  test('file with .html extension does not double-append', async () => {
    const content = '<html>already has ext</html>';
    const cs = checksum(content);

    await syncEngine.handleFileSaved('blog/my-post.html', content, cs, '2024-06-01T00:00:00Z', 1);

    expect(fileOps.writeFile).toHaveBeenCalledWith(
      '/test/sync/blog/my-post.html',
      content,
      new Date('2024-06-01T00:00:00Z')
    );
  });

  test('skips write when checksums match (file already up to date)', async () => {
    const content = '<html>existing content</html>';
    const cs = checksum(content);

    fileOps.readFile.mockResolvedValue(content);

    await syncEngine.handleFileSaved('blog/my-post', content, cs, '2024-06-01T00:00:00Z', 1);

    expect(fileOps.writeFile).not.toHaveBeenCalled();
  });

});
