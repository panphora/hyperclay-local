/**
 * C3.5: the initial-sync pass decides instead of guessing.
 *
 * Every listed node, every tracked node the inventory omitted and every
 * local-only file is decided from `{ baseline, local, remote, complete }` and
 * executed through `executeDecision`. These cases pin the rules that used to
 * come from mtime comparisons or from an unproven list: a complete inventory
 * may trash a local file, a legacy one may not, a folder is forgotten and never
 * trashed, and a `node-changed` refusal re-lists once per pass. A failure that
 * belongs to the session rather than to the file (C3.11) ends the pass instead
 * of being swallowed: the runner is the one that pauses, backs off or goes
 * offline for it.
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

const fs = require('fs');
const os = require('os');
const path = require('path');

const fileOps = require('../../src/sync-engine/file-operations');
const apiClient = require('../../src/sync-engine/api-client');
const nodeMapModule = require('../../src/sync-engine/node-map');
const store = require('../../src/sync-engine/reconcile/conflicts');

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
function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

const localFile = (rel) => ({ path: `/test/sync/${rel}`, relativePath: rel, mtime: new Date('2024-01-01'), size: 100 });

// A list carrying `complete: true` promises it is the whole inventory; only such
// a list may ever justify a local delete (protocol 2).
function completeList(nodes = []) {
  return Object.assign(nodes, { complete: true });
}

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
});

describe('performInitialSync — the inventory decides, not mtime', () => {
  test('a folder absent from a complete inventory is forgotten, its files trashed', async () => {
    const same = checksum('<html>content</html>');
    syncEngine.repo.seed([
      ['10', { type: 'folder', path: 'proj', parentId: null, inode: 222 }],
      ['11', { type: 'site', path: 'proj/page.html', inode: 111, remoteEtag: same, localChecksum: same }]
    ]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.listNodes.mockResolvedValue(completeList());
    fileOps.getLocalFiles.mockResolvedValue(new Map([['proj/page.html', localFile('proj/page.html')]]));

    await syncEngine.performInitialSync();

    expect(syncEngine.repo.has('10')).toBe(false);
    expect(syncEngine.repo.has('11')).toBe(false);
    expect(fileOps.moveFile).toHaveBeenCalledWith(
      '/test/sync/proj/page.html',
      '/test/sync/.trash/proj/page.html'
    );
    // Never the folder itself: its local directory stays until it is empty.
    expect(fileOps.moveFile).not.toHaveBeenCalledWith('/test/sync/proj', expect.anything());
  });

  test('a legacy list (no complete field) deletes nothing', async () => {
    syncEngine.repo.seed([['99', {
      type: 'site', path: 'stale.html', inode: 111, remoteEtag: 'same', localChecksum: 'same'
    }]]);
    syncEngine.lastSyncedAt = Date.now();

    apiClient.listNodes.mockResolvedValue([]);
    fileOps.getLocalFiles.mockResolvedValue(new Map([['stale.html', localFile('stale.html')]]));

    await syncEngine.performInitialSync();

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('99')).toBe(true);
  });

  test('a legacy list still creates a new local file', async () => {
    apiClient.listNodes.mockResolvedValue([]);
    apiClient.createNode.mockResolvedValue({ id: 5, type: 'site', name: 'fresh.html', parentId: 0 });
    fileOps.getLocalFiles.mockResolvedValue(new Map([['fresh.html', localFile('fresh.html')]]));

    await syncEngine.performInitialSync();

    expect(apiClient.createNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'site', name: 'fresh.html' })
    );
  });

  test('a 409 node-changed re-lists once for the pass and decides that node again', async () => {
    const localBytes = '<html>mine v2</html>';
    syncEngine.repo.seed([['901', {
      type: 'site', path: 'board.html', inode: 1, remoteEtag: 'old', localChecksum: 'old'
    }]]);
    syncEngine.lastSyncedAt = Date.now();

    fileOps.readFile.mockResolvedValue(localBytes);
    fileOps.getLocalFiles.mockResolvedValue(new Map([['board.html', localFile('board.html')]]));

    const node = { id: 901, type: 'site', name: 'board.html', path: '', checksum: 'old', modifiedAt: '2024-01-01T00:00:00Z' };
    apiClient.listNodes
      .mockResolvedValueOnce([node])
      .mockResolvedValue([{ ...node, checksum: checksum(localBytes) }]);
    apiClient.putNodeContent.mockRejectedValueOnce(
      Object.assign(new Error('node changed'), { statusCode: 409, code: 'node-changed' })
    );

    await syncEngine.performInitialSync();

    expect(apiClient.listNodes).toHaveBeenCalledTimes(2);
    expect(syncEngine.repo.get('901').remoteEtag).toBe(checksum(localBytes));
  });
});

describe('runPlanItem — a session-level failure ends the pass', () => {
  const site = (id, name) => ({ id, type: 'site', name, path: '', checksum: 'old', modifiedAt: '2024-01-01T00:00:00Z' });

  // Two files decide to upload: the first one's failure is what the pass must
  // react to, the second one's absence is the proof it stopped.
  function seedTwoSites() {
    syncEngine.repo.seed([
      ['901', { type: 'site', path: 'board.html', inode: 1, remoteEtag: 'old', localChecksum: 'old' }],
      ['902', { type: 'site', path: 'notes.html', inode: 2, remoteEtag: 'old', localChecksum: 'old' }]
    ]);
    syncEngine.lastSyncedAt = Date.now();

    fileOps.readFile.mockResolvedValue('<html>mine v2</html>');
    fileOps.getLocalFiles.mockResolvedValue(new Map([
      ['board.html', localFile('board.html')],
      ['notes.html', localFile('notes.html')]
    ]));
    apiClient.listNodes.mockResolvedValue([site(901, 'board.html'), site(902, 'notes.html')]);
  }

  test('a 503 on one file ends the pass and reaches the caller', async () => {
    seedTwoSites();
    apiClient.putNodeContent.mockRejectedValueOnce(
      Object.assign(new Error('unavailable'), { statusCode: 503, retryAfterMs: 7000 })
    );

    await expect(syncEngine.performInitialSync()).rejects.toMatchObject({
      statusCode: 503,
      retryAfterMs: 7000
    });

    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
  });

  test('a 401 on one file ends the pass', async () => {
    seedTwoSites();
    apiClient.putNodeContent.mockRejectedValueOnce(
      Object.assign(new Error('invalid key'), { statusCode: 401, code: 'invalid-key' })
    );

    await expect(syncEngine.performInitialSync()).rejects.toMatchObject({ statusCode: 401 });

    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
  });

  test('a network failure on one file ends the pass', async () => {
    seedTwoSites();
    apiClient.putNodeContent.mockRejectedValueOnce(new Error('fetch failed'));

    await expect(syncEngine.performInitialSync()).rejects.toThrow('fetch failed');

    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
  });

  test('a 412 on one file is recorded and the pass continues', async () => {
    const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-pass-conflicts-'));
    syncEngine.metaDir = metaDir;
    try {
      seedTwoSites();
      apiClient.putNodeContent
        .mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { statusCode: 412 }))
        .mockResolvedValue({ etag: 'newetag' });

      await syncEngine.performInitialSync();

      expect(apiClient.putNodeContent).toHaveBeenCalledTimes(2);
      const records = store.list(await store.load(metaDir));
      expect(records.map((record) => record.path)).toEqual(['board.html']);
    } finally {
      fs.rmSync(metaDir, { recursive: true, force: true });
    }
  });
});
