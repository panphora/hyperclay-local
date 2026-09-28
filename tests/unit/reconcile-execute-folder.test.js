/**
 * Folder decisions in the reconcile executor: a folder download makes the
 * directory (cascade-marked so the watcher does not echo it) and records it at
 * the server's path, and a folder delete-remote cascades and drops the folder
 * with everything under it from the node map. A file delete still sends only
 * the expected version.
 */

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

const { executeDecision } = require('../../src/sync-engine/reconcile/execute');

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
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
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
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.readFileBuffer.mockImplementation(async (filePath) => Buffer.from(await fileOps.readFile(filePath)));
  fileOps.calculateBufferChecksum.mockImplementation(realBufferChecksum);
  fileOps.fileExists.mockResolvedValue(true);
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);

  // The executor stat()s the local file for the modifiedAt it stamps on a
  // server write; the suite mocks file-operations, so this is mocked with it.
  jest.spyOn(require('fs').promises, 'stat').mockResolvedValue(STUB_STAT);

  apiClient.deleteNode.mockResolvedValue({ success: true });
  syncEngine.assertRootPresent = () => {};
  syncEngine._expectedVersion = jest.fn().mockResolvedValue('sv-1');
  nodeMapModule.getInode.mockResolvedValue(null);
});

describe('executeDecision — a folder download', () => {
  test('creates the directory (cascade-marked) and records the folder in the node map', async () => {
    fileOps.ensureDirectory.mockResolvedValue('/test/sync/proj');

    const result = await executeDecision(syncEngine, '10', { action: 'download' }, { path: 'proj', type: 'folder', parentId: 0 });

    expect(result.action).toBe('download');
    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/proj');
    expect(syncEngine.cascade.consume('proj')).toBe(true);
    expect(syncEngine.repo.get('10')).toEqual({ type: 'folder', path: 'proj', parentId: 0, inode: null });
    expect(apiClient.getNodeContent).not.toHaveBeenCalled();
  });

  test('downloads a server-moved folder at its new path', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'old', parentId: 0, inode: 5 }]
    ]);

    await executeDecision(syncEngine, '10', { action: 'download' }, { path: 'moved/proj', type: 'folder', parentId: 7 });

    expect(fileOps.ensureDirectory).toHaveBeenCalledWith('/test/sync/moved/proj');
    expect(syncEngine.repo.get('10').path).toBe('moved/proj');
    expect(syncEngine.repo.get('10').parentId).toBe(7);
  });

  test('a directory that already existed is not left cascade-marked', async () => {
    fileOps.ensureDirectory.mockResolvedValue(undefined);

    await executeDecision(syncEngine, '10', { action: 'download' }, { path: 'proj', type: 'folder', parentId: 0 });

    expect(syncEngine.cascade.consume('proj')).toBe(false);
    expect(syncEngine.repo.get('10')).toEqual({ type: 'folder', path: 'proj', parentId: 0, inode: null });
  });
});

describe('executeDecision — a folder delete-remote', () => {
  test('cascades the server delete and drops the folder with its descendants', async () => {
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: 0, inode: 1 }],
      ['11', { type: 'site', path: 'proj/a.html', parentId: 10, inode: 2 }],
      ['12', { type: 'folder', path: 'proj/sub', parentId: 10, inode: 3 }],
      ['13', { type: 'upload', path: 'proj/sub/b.png', parentId: 12, inode: 4 }]
    ]);

    const result = await executeDecision(syncEngine, '10', { action: 'delete-remote' }, { path: 'proj', type: 'folder' });

    expect(result.action).toBe('delete-remote');
    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, { expectedVersion: 'sv-1', cascade: true });
    expect(syncEngine.repo.size).toBe(0);
  });

  test('a folder delete is sent against the version the decision was made from', async () => {
    syncEngine.protocol = 2;
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: 0, inode: 1 }]
    ]);

    await executeDecision(syncEngine, '10', { action: 'delete-remote' }, { path: 'proj', type: 'folder', structureVersion: 'v1' });

    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 10, { expectedVersion: 'v1', cascade: true });
    expect(syncEngine._expectedVersion).not.toHaveBeenCalled();
  });

  test('a file delete sends only the expected version', async () => {
    syncEngine.repo.seed([
      ['11', { type: 'site', path: 'a.html', parentId: 0, inode: 2 }]
    ]);

    await executeDecision(syncEngine, '11', { action: 'delete-remote' }, { path: 'a.html', type: 'site' });

    expect(apiClient.deleteNode).toHaveBeenCalledWith(expect.anything(), 11, { expectedVersion: 'sv-1' });
    expect(syncEngine.repo.size).toBe(0);
  });
});
