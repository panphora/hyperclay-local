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
const apiClient = require('../../src/sync-engine/api-client');
const nodeMapModule = require('../../src/sync-engine/node-map');
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');
const EchoWindow = require('../../src/sync-engine/state/echo-window');

let syncEngine;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.deviceId = 'test-device';
  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.outbox = new Outbox();
  syncEngine.echoWindow = new EchoWindow();
  syncEngine.cascade = new CascadeSuppression();
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

  fileOps.readFile.mockResolvedValue('');
  fileOps.writeFile.mockResolvedValue();
  fileOps.readFileBuffer.mockResolvedValue(Buffer.from(''));
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.fileExists.mockResolvedValue(false);
  fileOps.calculateBufferChecksum.mockReturnValue('mock-checksum');
  nodeMapModule.getInode.mockResolvedValue(12345);
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
  apiClient.getNodeContent.mockResolvedValue({
    content: Buffer.from([0x01, 0x02, 0x03]),
    nodeType: 'upload',
    modifiedAt: '2026-04-08T12:00:00Z',
    checksum: 'cs-fetched',
    size: 3
  });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('handleNodeSaved', () => {
  describe('site branch', () => {
    it('writes inline content to disk and updates nodeMap', async () => {
      fileOps.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      await syncEngine.handleNodeSaved({
        nodeId: 42,
        nodeType: 'site',
        name: 'index.html',
        path: 'index.html',
        content: '<html>hi</html>',
        checksum: 'cs-1',
        modifiedAt: '2026-04-08T12:00:00Z'
      });

      expect(fileOps.writeFile).toHaveBeenCalledWith(
        path.join('/tmp/test-sync', 'index.html'),
        '<html>hi</html>',
        expect.any(Date)
      );
      expect(syncEngine.repo.get('42')).toEqual(expect.objectContaining({
        type: 'site',
        path: 'index.html'
      }));
    });

    it('emits sync-error if site node-saved arrives without inline content', async () => {
      const errorSpy = jest.fn();
      syncEngine.on('sync-error', errorSpy);

      await syncEngine.handleNodeSaved({
        nodeId: 42,
        nodeType: 'site',
        name: 'index.html',
        path: 'index.html'
      });

      expect(errorSpy).toHaveBeenCalled();
      syncEngine.off('sync-error', errorSpy);
    });
  });

  describe('upload branch', () => {
    it('fetches content via getNodeContent and writes buffer to disk', async () => {
      await syncEngine.handleNodeSaved({
        nodeId: 50,
        nodeType: 'upload',
        name: 'image.png',
        path: 'image.png',
        checksum: 'cs-2',
        modifiedAt: '2026-04-08T12:00:00Z',
        size: 3
      });

      expect(apiClient.getNodeContent).toHaveBeenCalledWith('http://test', 'test-key', 50);
      expect(fileOps.writeFileBuffer).toHaveBeenCalled();
      expect(syncEngine.repo.get('50')).toEqual(expect.objectContaining({
        type: 'upload',
        path: 'image.png',
        checksum: 'cs-fetched'
      }));
    });

    it('skips fetch if local content already matches', async () => {
      fileOps.readFileBuffer.mockResolvedValueOnce(Buffer.from([0x01]));
      fileOps.calculateBufferChecksum.mockReturnValueOnce('cs-2');

      await syncEngine.handleNodeSaved({
        nodeId: 50,
        nodeType: 'upload',
        name: 'image.png',
        path: 'image.png',
        checksum: 'cs-2',
        modifiedAt: '2026-04-08T12:00:00Z'
      });

      expect(apiClient.getNodeContent).not.toHaveBeenCalled();
      expect(fileOps.writeFileBuffer).not.toHaveBeenCalled();
    });
  });

  describe('folder branch', () => {
    it('mkdirs the folder and adds to nodeMap', async () => {
      await syncEngine.handleNodeSaved({
        nodeId: 60,
        nodeType: 'folder',
        name: 'projects',
        path: 'projects',
        parentId: 0
      });

      expect(fileOps.ensureDirectory).toHaveBeenCalledWith(path.join('/tmp/test-sync', 'projects'));
      expect(syncEngine.repo.get('60')).toEqual(expect.objectContaining({
        type: 'folder',
        path: 'projects',
        parentId: 0
      }));
    });

    it('no-ops if folder is already tracked in nodeMap', async () => {
      syncEngine.repo._map.set('60', { type: 'folder', path: 'projects', parentId: 0 });

      await syncEngine.handleNodeSaved({
        nodeId: 60,
        nodeType: 'folder',
        name: 'projects',
        path: 'projects',
        parentId: 0
      });

      expect(fileOps.ensureDirectory).not.toHaveBeenCalled();
    });
  });

  describe('echo suppression', () => {
    it('skips application if outbox has matching save op', async () => {
      syncEngine.outbox.markInFlight('save', 42);

      await syncEngine.handleNodeSaved({
        nodeId: 42,
        nodeType: 'site',
        path: 'index.html',
        content: '<html></html>',
        checksum: 'cs-1'
      });

      expect(fileOps.writeFile).not.toHaveBeenCalled();
      expect(syncEngine.outbox.has('save', 42)).toBe(false);
    });
  });
});

describe('handleNodeRenamed', () => {
  beforeEach(() => {
    fileOps.fileExists.mockReset();
  });

  it('renames a site file on disk and updates nodeMap', async () => {
    syncEngine.repo._map.set('42', {
      type: 'site',
      path: 'old.html',
      checksum: 'cs',
      inode: 100
    });
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeRenamed({
      nodeId: 42,
      nodeType: 'site',
      oldName: 'old.html',
      newName: 'new.html',
      oldPath: 'old.html',
      newPath: 'new.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'old.html'),
      path.join('/tmp/test-sync', 'new.html')
    );
    expect(syncEngine.repo.get('42').path).toBe('new.html');
  });

  it('renames an upload', async () => {
    syncEngine.repo._map.set('50', {
      type: 'upload',
      path: 'old.png',
      checksum: 'cs',
      inode: 100
    });
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeRenamed({
      nodeId: 50,
      nodeType: 'upload',
      oldName: 'old.png',
      newName: 'new.png',
      oldPath: 'old.png',
      newPath: 'new.png'
    });

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.repo.get('50').path).toBe('new.png');
  });

  it('renames a folder via _applyFolderRelocate', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'old', parentId: 0 });
    syncEngine.repo._map.set('61', { type: 'site', path: 'old/a.html', checksum: 'a' });
    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'old/a.html', checksum: 'a' } }
    ]);

    await syncEngine.handleNodeRenamed({
      nodeId: 60,
      nodeType: 'folder',
      oldName: 'old',
      newName: 'new',
      oldPath: 'old',
      newPath: 'new'
    });

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.repo.get('60').path).toBe('new');
    expect(syncEngine.repo.get('61').path).toBe('new/a.html');
  });
});

describe('checkForRemoteChanges', () => {
  beforeEach(() => {
    syncEngine.syncQueue = { isProcessingQueue: jest.fn().mockReturnValue(false) };
    syncEngine.uploadFile = jest.fn().mockResolvedValue();
    syncEngine.downloadFile = jest.fn().mockResolvedValue();
    syncEngine.uploadUploadFile = jest.fn().mockResolvedValue();
    syncEngine.downloadUploadFile = jest.fn().mockResolvedValue();
    syncEngine.fetchAndCacheServerFiles = jest.fn().mockResolvedValue([]);
    syncEngine.fetchAndCacheServerUploads = jest.fn().mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());
    fileOps.getLocalUploads.mockResolvedValue(new Map());
  });

  describe('site reconciliation', () => {
    it('uploads the local file when local is newer than server', async () => {
      syncEngine.fetchAndCacheServerFiles.mockResolvedValue([
        { nodeId: 1, path: 'my-site.html', filename: 'my-site.html', checksum: 'cs-server', modifiedAt: '2024-01-01T00:00:00Z' }
      ]);
      fileOps.getLocalFiles.mockResolvedValue(new Map([
        ['my-site.html', { mtime: new Date('2026-01-01') }]
      ]));
      fileOps.readFile.mockResolvedValue('<html>local newer content</html>');

      await syncEngine.checkForRemoteChanges();

      expect(syncEngine.uploadFile).toHaveBeenCalledWith('my-site.html');
      expect(syncEngine.downloadFile).not.toHaveBeenCalled();
      expect(syncEngine.stats.filesProtected).toBe(1);
    });

    it('downloads from server when server version is newer', async () => {
      syncEngine.fetchAndCacheServerFiles.mockResolvedValue([
        { nodeId: 1, path: 'my-site.html', filename: 'my-site.html', checksum: 'cs-server', modifiedAt: '2026-01-01T00:00:00Z' }
      ]);
      fileOps.getLocalFiles.mockResolvedValue(new Map([
        ['my-site.html', { mtime: new Date('2024-01-01') }]
      ]));
      fileOps.readFile.mockResolvedValue('<html>old local content</html>');

      await syncEngine.checkForRemoteChanges();

      expect(syncEngine.downloadFile).toHaveBeenCalledWith(1);
      expect(syncEngine.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('upload reconciliation', () => {
    beforeEach(() => {
      fileOps.calculateBufferChecksum.mockReturnValue('cs-local-upload');
    });

    it('uploads the local file when local is newer than server', async () => {
      syncEngine.fetchAndCacheServerUploads.mockResolvedValue([
        { nodeId: 2, path: 'image.png', checksum: 'cs-server-upload', modifiedAt: '2024-01-01T00:00:00Z' }
      ]);
      fileOps.getLocalUploads.mockResolvedValue(new Map([
        ['image.png', { mtime: new Date('2026-01-01') }]
      ]));
      fileOps.readFileBuffer.mockResolvedValue(Buffer.from('local image content'));

      await syncEngine.checkForRemoteChanges();

      expect(syncEngine.uploadUploadFile).toHaveBeenCalledWith('image.png');
      expect(syncEngine.downloadUploadFile).not.toHaveBeenCalled();
      expect(syncEngine.stats.uploadsProtected).toBe(1);
    });

    it('downloads from server when server version is newer', async () => {
      syncEngine.fetchAndCacheServerUploads.mockResolvedValue([
        { nodeId: 2, path: 'image.png', checksum: 'cs-server-upload', modifiedAt: '2026-01-01T00:00:00Z' }
      ]);
      fileOps.getLocalUploads.mockResolvedValue(new Map([
        ['image.png', { mtime: new Date('2024-01-01') }]
      ]));
      fileOps.readFileBuffer.mockResolvedValue(Buffer.from('old local content'));

      await syncEngine.checkForRemoteChanges();

      expect(syncEngine.downloadUploadFile).toHaveBeenCalledWith('image.png', 2);
      expect(syncEngine.uploadUploadFile).not.toHaveBeenCalled();
    });
  });
});

describe('handleNodeDeleted', () => {
  beforeEach(() => {
    fileOps.fileExists.mockReset();
  });

  it('trashes a site file and removes from nodeMap', async () => {
    syncEngine.repo._map.set('42', { type: 'site', path: 'foo.html' });
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeDeleted({
      nodeId: 42,
      nodeType: 'site',
      name: 'foo.html',
      path: 'foo.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.repo.has('42')).toBe(false);
  });

  it('trashes a folder and cleans up all descendants in nodeMap', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'projects' });
    syncEngine.repo._map.set('61', { type: 'site', path: 'projects/a.html' });
    syncEngine.repo._map.set('62', { type: 'upload', path: 'projects/b.png' });
    fileOps.fileExists.mockResolvedValue(true);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'projects/a.html' } },
      { nodeId: '62', entry: { type: 'upload', path: 'projects/b.png' } }
    ]);

    await syncEngine.handleNodeDeleted({
      nodeId: 60,
      nodeType: 'folder',
      name: 'projects',
      path: 'projects'
    });

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.repo.size).toBe(0);
  });

  it('pre-populates suppression set before trashing folder', async () => {
    syncEngine.repo._map.set('60', { type: 'folder', path: 'projects' });
    syncEngine.repo._map.set('61', { type: 'site', path: 'projects/a.html' });
    fileOps.fileExists.mockResolvedValue(true);
    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '61', entry: { type: 'site', path: 'projects/a.html' } }
    ]);

    const spy = jest.spyOn(syncEngine.cascade, 'mark');

    await syncEngine.handleNodeDeleted({
      nodeId: 60,
      nodeType: 'folder',
      path: 'projects'
    });

    expect(spy).toHaveBeenCalled();
    const calledWithPaths = spy.mock.calls[0][0];
    expect(calledWithPaths).toContain('projects');
    expect(calledWithPaths).toContain('projects/a.html');

    spy.mockRestore();
  });
});
