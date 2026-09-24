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
jest.mock('../../src/sync-engine/node-map', () => {
  const actual = jest.requireActual('../../src/sync-engine/node-map');
  return {
    ...actual,
    load: jest.fn(),
    save: jest.fn(),
    loadState: jest.fn(),
    saveState: jest.fn(),
    loadTombstones: jest.fn(),
    saveTombstones: jest.fn(),
    getInode: jest.fn(),
    walkDescendants: jest.fn(actual.walkDescendants)
  };
});

const realBufferChecksum = jest.requireActual('../../src/sync-engine/file-operations').calculateBufferChecksum;
const STUB_STAT = { mtime: new Date('2024-01-01'), mtimeMs: 1704067200000, size: 100, mode: 0o644 };

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
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

  // Everything that reads or writes local bytes goes through file-operations,
  // which this suite mocks; the executor also stat()s the file for the
  // modifiedAt it stamps on a server write, so that is mocked with the rest.
  fileOps.readFileBuffer.mockImplementation(async (filePath) => Buffer.from(await fileOps.readFile(filePath)));
  fileOps.calculateBufferChecksum.mockImplementation(realBufferChecksum);
  jest.spyOn(require('fs').promises, 'stat').mockResolvedValue(STUB_STAT);
});

describe('Option D — new server files are downloaded, never deleted on restart', () => {
  test('new server UPLOAD (collection record) is downloaded and never deleted', async () => {
    // Nothing known locally; the record was created server-side while the app was off.
    apiClient.listNodes.mockResolvedValue([
      { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', size: 10, checksum: 'c1', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);
    fileOps.getLocalUploads.mockResolvedValue(new Map());

    await syncEngine.performInitialUploadSync();

    // The download runs through the executor now: one content GET for that node.
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 7001
    );
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('new server SITE is downloaded and never deleted', async () => {
    apiClient.listNodes.mockResolvedValue([
      { id: 8001, type: 'site', name: 'newpage.html', path: '', checksum: 'c2', modifiedAt: '2024-06-01T00:00:00Z' }
    ]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());

    await syncEngine.performInitialSync();

    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 8001
    );
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

    expect(apiClient.getNodeContent).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 7001,
      expect.objectContaining({ expectedVersion: null })
    );
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

describe('upload pass failures', () => {
  const newServerUpload = () => [
    { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', size: 10, checksum: 'c1', modifiedAt: '2024-06-01T00:00:00Z' }
  ];

  test('a 503 downloading an upload ends the pass', async () => {
    apiClient.listNodes.mockResolvedValue(newServerUpload());
    fileOps.getLocalUploads.mockResolvedValue(new Map());
    apiClient.getNodeContent.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 503 }));

    await expect(syncEngine.performInitialUploadSync()).rejects.toMatchObject({ statusCode: 503 });
  });

  test('a 401 downloading an upload ends the pass', async () => {
    apiClient.listNodes.mockResolvedValue(newServerUpload());
    fileOps.getLocalUploads.mockResolvedValue(new Map());
    apiClient.getNodeContent.mockRejectedValue(Object.assign(new Error('down'), { statusCode: 401 }));

    await expect(syncEngine.performInitialUploadSync()).rejects.toMatchObject({ statusCode: 401 });
  });

  test('a 412 downloading an upload is logged and the pass resolves', async () => {
    apiClient.listNodes.mockResolvedValue(newServerUpload());
    fileOps.getLocalUploads.mockResolvedValue(new Map());
    apiClient.getNodeContent.mockRejectedValue(Object.assign(new Error('rejected'), { statusCode: 412 }));
    const errorsBefore = syncEngine.stats.errors.length;

    await syncEngine.performInitialUploadSync();

    expect(syncEngine.stats.errors.length).toBeGreaterThan(errorsBefore);
  });
});

describe('Option D — server-edit wins on delete conflict (uploads)', () => {
  test('upload deleted locally but edited on the server is re-downloaded, not deleted', async () => {
    // The baseline is explicit: the remote etag moved off it, so the teammate's
    // edit is restored instead of the local delete winning.
    syncEngine.lastSyncedAt = new Date('2024-01-01').getTime();
    syncEngine.repo.seed([
      ['7001', { type: 'upload', path: 'qa/records/1.json', checksum: 'c1', inode: 111, syncedAt: new Date('2024-01-01').getTime() }]
    ]);
    apiClient.listNodes.mockResolvedValue([
      { id: 7001, type: 'upload', name: '1.json', path: 'qa/records', checksum: 'c2', modifiedAt: '2024-07-01T00:00:00Z' }
    ]);
    fileOps.getLocalUploads.mockResolvedValue(new Map());

    await syncEngine.performInitialUploadSync();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 7001
    );
  });
});
