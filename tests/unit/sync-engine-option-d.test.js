/**
 * Option D regression tests — the node-map baseline discriminator that fixes the
 * download-then-delete data-loss bug.
 *
 * Bug: on a restart sync the engine downloaded server files missing locally, then
 * a delete-detection step running against a stale pre-download snapshot treated the
 * just-downloaded files as "deleted locally" and propagated deletes to the server.
 * Any file created server-side while the app was closed (collection records, sites,
 * folders) was wiped on restart.
 *
 * Fix: snapshot the nodeIds known at sync start; a server file missing locally whose
 * nodeId is NOT in that baseline is genuinely new (download, never delete-flag), and
 * one whose nodeId IS in the baseline is an offline delete/rename (don't redownload,
 * let detect propagate the delete or re-download on a server-edit conflict).
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({ EventSource: jest.fn() }));

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

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.syncFolder = '/test/sync';
  syncEngine.serverUrl = 'http://localhyperclay.com';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.username = 'testuser';
  syncEngine.clockOffset = 0;
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
  syncEngine.lastSyncedAt = new Date('2024-05-01').getTime();
  syncEngine.stats = {
    filesProtected: 0, filesDownloaded: 0, filesUploaded: 0,
    filesDownloadedSkipped: 0, filesUploadedSkipped: 0,
    uploadsDownloaded: 0, uploadsUploaded: 0, uploadsProtected: 0,
    uploadsSkipped: 0, lastSync: null, errors: []
  };

  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.writeFile.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.readFileBuffer.mockResolvedValue(Buffer.from('content'));
  fileOps.calculateBufferChecksum.mockReturnValue('bufcs');
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.fileExists.mockResolvedValue(true);
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
  fileOps.getLocalFolders.mockResolvedValue(new Map());

  apiClient.listNodes.mockResolvedValue([]);
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.moveNode.mockResolvedValue({ success: true });
  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>server</html>', nodeType: 'site',
    modifiedAt: '2024-06-01T00:00:00Z', checksum: 'srv', size: 20
  });

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);

  // Spy the download/upload primitives so the tests assert intent without disk/network I/O.
  syncEngine.downloadFile = jest.fn().mockResolvedValue();
  syncEngine.downloadUploadFile = jest.fn().mockResolvedValue();
  syncEngine.uploadUploadFile = jest.fn().mockResolvedValue();
  syncEngine.uploadFile = jest.fn().mockResolvedValue();
});

describe('Option D — new server files are downloaded, never deleted on restart', () => {
  test('new server UPLOAD (collection record) is downloaded and never deleted', async () => {
    // Nothing known locally; the record was created server-side while the app was off.
    apiClient.listNodes.mockResolvedValue([
      { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', size: 10, checksum: 'c1', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);
    fileOps.getLocalUploads.mockResolvedValue(new Map());

    await syncEngine.performInitialUploadSync();

    expect(syncEngine.downloadUploadFile).toHaveBeenCalledWith('qa/records/1.json', 7001);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('new server SITE is downloaded and never deleted', async () => {
    apiClient.listNodes.mockResolvedValue([
      { id: 8001, type: 'site', name: 'newpage.html', path: '', checksum: 'c2', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(syncEngine.downloadFile).toHaveBeenCalledWith(8001, 'newpage.html');
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('new server FOLDER is created and never cascade-deleted', async () => {
    apiClient.listNodes.mockResolvedValue([
      { id: 9001, type: 'folder', name: 'records', path: 'qa', parentId: 5 }
    ]);
    fileOps.getLocalFolders.mockResolvedValue(new Map());

    await syncEngine.performInitialFolderSync();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });
});

describe('Option D — offline deletes propagate (do not resurrect)', () => {
  test('offline-deleted UPLOAD is deleted on the server and not redownloaded', async () => {
    // Known upload, server unchanged since last sync, gone from local disk.
    syncEngine.repo.seed([
      ['7001', { type: 'upload', path: 'qa/records/1.json', checksum: 'c1', inode: 111, syncedAt: new Date('2024-05-01').getTime() }]
    ]);
    apiClient.listNodes.mockResolvedValue([
      { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', checksum: 'c1', modifiedAt: '2024-04-01T00:00:00Z' }
    ]);
    fileOps.getLocalUploads.mockResolvedValue(new Map());

    await syncEngine.performInitialUploadSync();

    expect(syncEngine.downloadUploadFile).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).toHaveBeenCalledWith('http://localhyperclay.com', 'hcsk_test', 7001, { cascade: false });
  });
});

describe('Folder safety — a failed local create never deletes the live server folder', () => {
  test('mkdir failure on a baseline folder does not propagate a server delete', async () => {
    // Baseline folder, still on the server at the same path, but missing from disk.
    syncEngine.repo.seed([
      ['9100', { type: 'folder', path: 'proj', parentId: null, inode: 222, syncedAt: new Date('2024-05-01').getTime() }]
    ]);
    apiClient.listNodes.mockResolvedValue([
      { id: 9100, type: 'folder', name: 'proj', path: '', parentId: null }
    ]);
    fileOps.getLocalFolders.mockResolvedValue(new Map());
    // Local recreate fails (e.g. a file occupies that path); the folder stays absent on disk.
    fileOps.ensureDirectory.mockRejectedValue(new Error('EEXIST: file already exists'));

    await syncEngine.performInitialFolderSync();

    // The footgun would have cascade-deleted the live server folder + subtree.
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });
});

describe('Option D — server-edit wins on delete conflict (uploads)', () => {
  test('upload deleted locally but edited on the server is re-downloaded, not deleted', async () => {
    syncEngine.lastSyncedAt = new Date('2024-01-01').getTime();
    syncEngine.repo.seed([
      ['7001', { type: 'upload', path: 'qa/records/1.json', checksum: 'c1', inode: 111, syncedAt: new Date('2024-01-01').getTime() }]
    ]);
    // Server modifiedAt is AFTER our last sync of this record.
    apiClient.listNodes.mockResolvedValue([
      { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', checksum: 'c1', modifiedAt: '2024-07-01T00:00:00Z' }
    ]);
    fileOps.getLocalUploads.mockResolvedValue(new Map());

    await syncEngine.performInitialUploadSync();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.downloadUploadFile).toHaveBeenCalledWith('qa/records/1.json', '7001');
  });
});
