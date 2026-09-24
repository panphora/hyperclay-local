/**
 * C3 §5.6/§9: the engine methods the session runner calls.
 *
 * `reconcileAll` reconciles the disk against the inventory the runner already
 * listed (one list, not two), `refreshNode` re-reads one node per invalidation
 * with at most one list in flight for the session, and `dropPendingWork` ends a
 * generation: the queue goes, the waiters settle, and a stale signal writes
 * nothing.
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
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
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

const crypto = require('crypto');

// The local file every read returns, and its checksum as the baseline records it.
const LOCAL_HTML = '<html>content</html>';
const SAME = crypto.createHash('sha256').update(LOCAL_HTML).digest('hex').substring(0, 16);

const localFile = (rel) => ({ path: `/test/sync/${rel}`, relativePath: rel, mtime: new Date('2024-01-01'), size: 10 });

// A list carrying `complete: true` promises it is the whole inventory.
function completeList(nodes = []) {
  return Object.assign(nodes, { complete: true });
}

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
  });

  syncEngine.syncFolder = '/test/sync';
  syncEngine.metaDir = '/test/meta';
  syncEngine.serverUrl = 'http://localhyperclay.com';
  syncEngine.apiKey = 'hcsk_test';
  syncEngine.isRunning = true;
  syncEngine.repo.seed();

  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.writeFile.mockResolvedValue();
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue(LOCAL_HTML);
  fileOps.readFileBuffer.mockResolvedValue(Buffer.from(LOCAL_HTML));
  fileOps.calculateBufferChecksum.mockImplementation(
    jest.requireActual('../../src/sync-engine/file-operations').calculateBufferChecksum
  );
  fileOps.fileExists.mockReturnValue(true);
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
  fileOps.getLocalFolders.mockResolvedValue(new Map());

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.getInode.mockResolvedValue(12345);

  // The executor stat()s the local file for the modifiedAt it stamps on a write.
  jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ mtime: new Date('2024-01-01'), size: 10 });
});

describe('reconcileAll', () => {
  it('reconciles from the inventory it was handed without listing again', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'page.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    syncEngine.lastSyncedAt = Date.now();
    fileOps.getLocalFiles.mockResolvedValue(new Map([['page.html', localFile('page.html')]]));
    apiClient.getNodeContent.mockResolvedValue({ content: LOCAL_HTML, checksum: 'etag-new', modifiedAt: '2024-01-01T00:00:00Z' });

    await syncEngine.reconcileAll(completeList([
      { id: 11, type: 'site', name: 'page.html', path: '', etag: 'etag-new', parentId: 0 }
    ]), { generation: 4 });

    expect(apiClient.listNodes).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(expect.anything(), 11);
    expect(fileOps.writeFile).toHaveBeenCalled();
    expect(syncEngine.serverNodesComplete).toBe(true);
  });

  it('writes nothing when its signal was already aborted', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'page.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([['page.html', localFile('page.html')]]));
    const controller = new AbortController();
    controller.abort();

    await syncEngine.reconcileAll(completeList([]), { generation: 3, signal: controller.signal });

    expect(apiClient.listNodes).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).not.toHaveBeenCalled();
    expect(fileOps.writeFile).not.toHaveBeenCalled();
  });
});

describe('refreshNode', () => {
  it('lists once for parallel invalidations and decides that node', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'page.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    apiClient.listNodes.mockResolvedValue(completeList([
      { id: 11, type: 'site', name: 'page.html', path: '', etag: 'etag-new', parentId: 0 }
    ]));
    apiClient.getNodeContent.mockResolvedValue({ content: LOCAL_HTML, checksum: 'etag-new', modifiedAt: '2024-01-01T00:00:00Z' });

    const actions = await Promise.all([
      syncEngine.refreshNode(11, { generation: 2 }),
      syncEngine.refreshNode('11', { generation: 2 })
    ]);

    expect(apiClient.listNodes).toHaveBeenCalledTimes(1);
    expect(actions[0]).toBe('download');
    expect(fileOps.writeFile).toHaveBeenCalled();
  });

  it('trashes the local file of a node the complete inventory omits', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'gone.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    apiClient.listNodes.mockResolvedValue(completeList([]));

    const action = await syncEngine.refreshNode(11, { generation: 3 });

    expect(action).toBe('trash-local');
    expect(fileOps.moveFile).toHaveBeenCalled();
  });

  it('writes nothing when the generation ends while it is listing', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'page.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    let releaseList = null;
    apiClient.listNodes.mockImplementation(() => new Promise((resolve) => { releaseList = resolve; }));
    apiClient.getNodeContent.mockResolvedValue({ content: LOCAL_HTML, checksum: 'etag-new', modifiedAt: '2024-01-01T00:00:00Z' });

    const pending = syncEngine.refreshNode(11, { generation: 2 });
    await Promise.resolve();
    expect(apiClient.listNodes).toHaveBeenCalledTimes(1);

    syncEngine.dropPendingWork();
    releaseList(completeList([
      { id: 11, type: 'site', name: 'page.html', path: '', etag: 'etag-new', parentId: 0 }
    ]));

    await expect(pending).resolves.toBeNull();
    expect(apiClient.getNodeContent).not.toHaveBeenCalled();
    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(fileOps.moveFile).not.toHaveBeenCalled();
  });

  it('does nothing at all when its signal is stale', async () => {
    syncEngine.repo.seed([[11, { type: 'site', path: 'page.html', remoteEtag: SAME, localChecksum: SAME, syncedAt: Date.now() }]]);
    const controller = new AbortController();
    controller.abort();

    await syncEngine.refreshNode(11, { generation: 4, signal: controller.signal });

    expect(apiClient.listNodes).not.toHaveBeenCalled();
    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(fileOps.moveFile).not.toHaveBeenCalled();
  });
});

describe('dropPendingWork and whenQueueEmpty', () => {
  it('clears the queue, settles the waiters and bumps the generation', async () => {
    const settled = jest.fn();
    syncEngine.queueSync('change', 'page.html');
    const pending = syncEngine.whenQueueEmpty().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    const generation = syncEngine.generation;
    syncEngine.dropPendingWork();
    await pending;

    expect(settled).toHaveBeenCalled();
    expect(syncEngine.generation).toBe(generation + 1);
    expect(syncEngine.syncQueue.isEmpty()).toBe(true);
  });
});
