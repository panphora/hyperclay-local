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
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

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
  syncEngine.cascade = new CascadeSuppression();

  fileOps.moveFile.mockResolvedValue();
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.fileExists.mockResolvedValue(false);
  nodeMapModule.getInode.mockResolvedValue(12345);
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();
});

// =============================================================================
// walkDescendants returns mixed-type descendants of a folder
// =============================================================================

describe('Cross-type: walkDescendants with mixed nodeMap', () => {
  it('real walkDescendants returns mixed-type descendants of a folder', () => {
    const { walkDescendants } = jest.requireActual('../../src/sync-engine/node-map');

    const nodeMap = new Map();
    nodeMap.set('10', { type: 'folder', path: 'projects' });
    nodeMap.set('11', { type: 'site', path: 'projects/index.html' });
    nodeMap.set('12', { type: 'upload', path: 'projects/image.png' });
    nodeMap.set('13', { type: 'folder', path: 'projects/sub' });
    nodeMap.set('14', { type: 'site', path: 'projects/sub/nested.html' });
    nodeMap.set('20', { type: 'site', path: 'unrelated.html' });

    const descendants = walkDescendants(nodeMap, 'projects');

    expect(descendants).toHaveLength(4);
    const ids = descendants.map(d => d.nodeId).sort();
    expect(ids).toEqual(['11', '12', '13', '14']);
  });
});

// =============================================================================
// SSE folder rename cascades over mixed children
// =============================================================================

describe('Cross-type: SSE folder rename cascades over mixed children', () => {
  it('rewrites paths for site, upload, and sub-folder descendants in one pass', async () => {
    syncEngine.nodeMap.set('10', { type: 'folder', path: 'old', parentId: 0 });
    syncEngine.nodeMap.set('11', { type: 'site', path: 'old/page.html', checksum: 'a' });
    syncEngine.nodeMap.set('12', { type: 'upload', path: 'old/image.png', checksum: 'b' });
    syncEngine.nodeMap.set('13', { type: 'folder', path: 'old/sub' });
    syncEngine.nodeMap.set('14', { type: 'site', path: 'old/sub/nested.html', checksum: 'c' });

    nodeMapModule.walkDescendants.mockReturnValue([
      { nodeId: '11', entry: { type: 'site', path: 'old/page.html', checksum: 'a' } },
      { nodeId: '12', entry: { type: 'upload', path: 'old/image.png', checksum: 'b' } },
      { nodeId: '13', entry: { type: 'folder', path: 'old/sub' } },
      { nodeId: '14', entry: { type: 'site', path: 'old/sub/nested.html', checksum: 'c' } },
    ]);

    fileOps.fileExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await syncEngine.handleNodeRenamed({
      nodeId: 10,
      nodeType: 'folder',
      oldName: 'old',
      newName: 'new',
      oldPath: 'old',
      newPath: 'new'
    });

    expect(fileOps.moveFile).toHaveBeenCalledTimes(1);
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      path.join('/tmp/test-sync', 'old'),
      path.join('/tmp/test-sync', 'new')
    );

    expect(syncEngine.nodeMap.get('10').path).toBe('new');
    expect(syncEngine.nodeMap.get('11').path).toBe('new/page.html');
    expect(syncEngine.nodeMap.get('12').path).toBe('new/image.png');
    expect(syncEngine.nodeMap.get('13').path).toBe('new/sub');
    expect(syncEngine.nodeMap.get('14').path).toBe('new/sub/nested.html');

    expect(syncEngine.nodeMap.get('11').type).toBe('site');
    expect(syncEngine.nodeMap.get('11').checksum).toBe('a');
    expect(syncEngine.nodeMap.get('12').type).toBe('upload');
    expect(syncEngine.nodeMap.get('12').checksum).toBe('b');
    expect(syncEngine.nodeMap.get('14').type).toBe('site');
    expect(syncEngine.nodeMap.get('14').checksum).toBe('c');
  });
});

// =============================================================================
// Cascade suppression set is shared across mixed types
// =============================================================================

describe('Cross-type: cascade suppression set is shared across mixed types', () => {
  it('suppresses chokidar events for site, upload, and folder descendants of a renamed folder', () => {
    syncEngine.cascade.mark([
      'new',
      'new/page.html',
      'new/image.png',
      'new/sub',
      'new/sub/nested.html'
    ]);

    expect(syncEngine.cascade.consume('new')).toBe(true);
    expect(syncEngine.cascade.consume('new/page.html')).toBe(true);
    expect(syncEngine.cascade.consume('new/image.png')).toBe(true);
    expect(syncEngine.cascade.consume('new/sub')).toBe(true);
    expect(syncEngine.cascade.consume('new/sub/nested.html')).toBe(true);

    expect(syncEngine.cascade.consume('other.html')).toBe(false);
  });
});

// =============================================================================
// processQueue dispatches correctly for mixed nodeMap entries
// =============================================================================

describe('Cross-type: processQueue dispatches correctly for mixed nodeMap entries', () => {
  it('routes a folder add to createFolderOnServer', async () => {
    syncEngine.nodeMap.set('10', { type: 'folder', path: 'projects' });
    syncEngine.isRunning = true;

    const createFolderSpy = jest.spyOn(syncEngine, 'createFolderOnServer').mockResolvedValue();

    syncEngine.syncQueue = {
      isProcessingQueue: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      next: jest.fn().mockReturnValueOnce({ type: 'add', filename: 'projects' }),
      setProcessing: jest.fn(),
      clearRetry: jest.fn(),
    };

    await syncEngine.processQueue();

    expect(createFolderSpy).toHaveBeenCalledWith('projects');
    createFolderSpy.mockRestore();
  });

  it('routes a site add to uploadFile', async () => {
    syncEngine.nodeMap.set('11', { type: 'site', path: 'projects/index.html' });
    syncEngine.isRunning = true;

    const uploadFileSpy = jest.spyOn(syncEngine, 'uploadFile').mockResolvedValue();

    syncEngine.syncQueue = {
      isProcessingQueue: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      next: jest.fn().mockReturnValueOnce({ type: 'add', filename: 'projects/index.html' }),
      setProcessing: jest.fn(),
      clearRetry: jest.fn(),
    };

    await syncEngine.processQueue();

    expect(uploadFileSpy).toHaveBeenCalledWith('projects/index.html');
    uploadFileSpy.mockRestore();
  });

  it('routes an upload add to uploadUploadFile', async () => {
    syncEngine.nodeMap.set('12', { type: 'upload', path: 'projects/image.png' });
    syncEngine.isRunning = true;

    const uploadUploadFileSpy = jest.spyOn(syncEngine, 'uploadUploadFile').mockResolvedValue();

    syncEngine.syncQueue = {
      isProcessingQueue: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      next: jest.fn().mockReturnValueOnce({ type: 'add', filename: 'projects/image.png' }),
      setProcessing: jest.fn(),
      clearRetry: jest.fn(),
    };

    await syncEngine.processQueue();

    expect(uploadUploadFileSpy).toHaveBeenCalledWith('projects/image.png');
    uploadUploadFileSpy.mockRestore();
  });
});
