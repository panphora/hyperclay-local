jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

// The remote writers refresh derived artifacts inside their critical section,
// which reaches the extractor. The real one loads hyper-html-api through a
// dynamic ESM import that needs --experimental-vm-modules, so stub it as the
// other suites do; these tests are about sync bookkeeping, not extraction.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
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
const Outbox = require('../../src/sync-engine/state/outbox');

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

function entry(p, cs, ino) {
  return { path: p, checksum: cs || null, inode: ino || null };
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
  syncEngine.username = 'testuser';
  syncEngine.clockOffset = 0;
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
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
  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>server content</html>',
    nodeType: 'site',
    modifiedAt: '2024-06-01T00:00:00Z',
    checksum: checksum('<html>server content</html>'),
    size: 26
  });
  apiClient.putNodeContent.mockResolvedValue({ nodeId: 1, checksum: 'abc' });
  apiClient.createNode.mockResolvedValue({ id: 1, type: 'site', name: 'test.html', parentId: 0, path: '' });
  apiClient.listNodes.mockResolvedValue([]);
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.moveNode.mockResolvedValue({ success: true });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
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

describe('detectLocalChanges — local delete', () => {
  test('deletes file on server when local file is gone', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('my-site.html', cs, 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42,
      expect.objectContaining({ expectedVersion: null })
    );
    expect(syncEngine.repo.has('42')).toBe(false);
  });

  test('re-downloads file when the remote changed after the local delete', async () => {
    // The baseline is explicit now: the remote etag moved off it, so the local
    // delete must not win.
    syncEngine.repo.seed([['42', {
      path: 'my-site.html', inode: 111, remoteEtag: 'abc', localChecksum: 'abc'
    }]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: 'def', modifiedAt: '2024-07-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42
    );
    expect(syncEngine.repo.has('42')).toBe(true);
  });

  test('skips detection for nodeIds not on server', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html')]]);

    const allServerNodes = [];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
  });

  test('deletes when the remote is unchanged and the file is gone locally', async () => {
    syncEngine.repo.seed([['42', {
      path: 'my-site.html', checksum: 'abc', inode: 111, syncedAt: new Date('2024-07-15').getTime()
    }]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: 'abc', modifiedAt: '2024-07-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42,
      expect.objectContaining({ expectedVersion: null })
    );
    expect(apiClient.getNodeContent).not.toHaveBeenCalled();
    expect(syncEngine.repo.has('42')).toBe(false);
  });

  test('re-downloads when the remote etag changed since the baseline', async () => {
    // The remote moved on since the baseline: the server change must win.
    syncEngine.repo.seed([['42', {
      path: 'my-site.html', inode: 111, remoteEtag: 'abc', localChecksum: 'abc'
    }]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: 'def', modifiedAt: '2024-07-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42
    );
    expect(syncEngine.repo.has('42')).toBe(true);
  });

  test('a legacy entry reads its checksum as the baseline', async () => {
    // Legacy entries carry one checksum for both halves: the remote etag
    // differing from it is the same conflict signal as a v2 baseline.
    syncEngine.repo.seed([['42', entry('my-site.html', 'abc', 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: 'def', modifiedAt: '2024-07-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.getNodeContent).toHaveBeenCalled();
  });
});

describe('detectLocalChanges — local move', () => {
  test('detects move when basename is same but path differs', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([
      ['42', entry('my-site.html', cs, 111)],
      ['100', { type: 'folder', path: 'blog', parentId: 0 }]
    ]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['blog/my-site.html', { path: '/test/sync/blog/my-site.html', relativePath: 'blog/my-site.html', mtime: new Date(), size: 100 }]
    ]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.moveNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42, 100
    );
    expect(syncEngine.repo.get('42').path).toBe('blog/my-site.html');
  });

  test('moves to root when target folder is "."', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('blog/my-site.html', cs, 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: 'blog', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date(), size: 100 }]
    ]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.moveNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42, 0
    );
  });
});

describe('detectLocalChanges — local rename (inode match)', () => {
  test('detects rename via inode match', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('old-name.html', cs, 99999)]]);

    nodeMapModule.getInode.mockResolvedValue(99999);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'old-name.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['new-name.html', { path: '/test/sync/new-name.html', relativePath: 'new-name.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.renameNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42, 'new-name.html'
    );
    expect(syncEngine.repo.get('42').path).toBe('new-name.html');
  });
});

describe('detectLocalChanges — local rename (checksum match)', () => {
  test('detects rename via checksum match when inode differs', async () => {
    const content = '<html>same content</html>';
    const cs = checksum(content);
    syncEngine.repo.seed([['42', entry('old-name.html', cs, 11111)]]);

    nodeMapModule.getInode.mockResolvedValue(22222);
    fileOps.readFile.mockResolvedValue(content);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'old-name.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['renamed.html', { path: '/test/sync/renamed.html', relativePath: 'renamed.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.renameNode).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'http://localhyperclay.com', apiKey: 'hcsk_test' }), 42, 'renamed.html'
    );
  });
});

describe('detectLocalChanges — server wins conflicts', () => {
  test('skips local change detection when server path differs from nodeMap (server moved it)', async () => {
    syncEngine.repo.seed([['42', entry('old-path.html', 'abc', 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'old-path.html', path: 'blog', checksum: 'abc', modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
  });
});

describe('detectLocalChanges — skips on first sync', () => {
  test('performInitialSync skips detectLocalChanges when lastSyncedAt is null', async () => {
    syncEngine.lastSyncedAt = null;
    syncEngine.repo.seed([['42', entry('my-site.html')]]);

    apiClient.listNodes.mockResolvedValue([
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: 'abc', modifiedAt: '2024-01-01T00:00:00Z' }
    ]);
    fileOps.getLocalFiles.mockResolvedValue(new Map());
    fileOps.readFile.mockResolvedValue('<html>server content</html>');

    await syncEngine.performInitialSync();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
  });
});

describe('SSE echo suppression', () => {
  test('skips handleNodeDeleted when outbox has matching op', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html')]]);
    syncEngine.outbox.markInFlight('delete', 42);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'my-site.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.outbox.has('delete', 42)).toBe(false);
  });

  test('skips handleNodeRenamed when outbox has matching op', async () => {
    syncEngine.repo.seed([['42', entry('old.html')]]);
    syncEngine.outbox.markInFlight('rename', 42);

    await syncEngine.handleNodeRenamed({
      nodeId: 42, nodeType: 'site',
      oldName: 'old.html', newName: 'new.html',
      oldPath: 'old.html', newPath: 'new.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.outbox.has('rename', 42)).toBe(false);
  });

  test('skips handleNodeMoved when outbox has matching op', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html')]]);
    syncEngine.outbox.markInFlight('move', 42);

    await syncEngine.handleNodeMoved({
      nodeId: 42, nodeType: 'site',
      oldPath: 'my-site.html', newPath: 'blog/my-site.html'
    });

    expect(fileOps.moveFile).not.toHaveBeenCalled();
    expect(syncEngine.outbox.has('move', 42)).toBe(false);
  });

  test('processes SSE normally when no outbox match', async () => {
    syncEngine.repo.seed([['42', entry('my-site.html')]]);
    fileOps.fileExists.mockResolvedValue(true);

    await syncEngine.handleNodeDeleted({
      nodeId: 42, nodeType: 'site',
      name: 'my-site.html', path: 'my-site.html'
    });

    expect(fileOps.moveFile).toHaveBeenCalled();
    expect(syncEngine.repo.has('42')).toBe(false);
  });
});

describe('detectLocalChanges marks outbox for SSE suppression', () => {
  test('marks delete in outbox before calling deleteNode', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('my-site.html', cs, 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    let capturedPendingAction = false;
    apiClient.deleteNode.mockImplementation(async () => {
      capturedPendingAction = syncEngine.outbox.has('delete', '42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(capturedPendingAction).toBe(true);
  });

  test('marks rename in outbox before calling renameNode', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('old-name.html', cs, 99999)]]);
    nodeMapModule.getInode.mockResolvedValue(99999);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'old-name.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['new-name.html', { path: '/test/sync/new-name.html', relativePath: 'new-name.html', mtime: new Date(), size: 100 }]
    ]);

    let capturedPendingAction = false;
    apiClient.renameNode.mockImplementation(async () => {
      capturedPendingAction = syncEngine.outbox.has('rename', '42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(capturedPendingAction).toBe(true);
  });

  test('marks move in outbox before calling moveNode', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([
      ['42', entry('my-site.html', cs, 111)],
      ['100', { type: 'folder', path: 'blog', parentId: 0 }]
    ]);
    fileOps.readFile.mockResolvedValue('<html>content</html>');

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['blog/my-site.html', { path: '/test/sync/blog/my-site.html', relativePath: 'blog/my-site.html', mtime: new Date(), size: 100 }]
    ]);

    let capturedPendingAction = false;
    apiClient.moveNode.mockImplementation(async () => {
      capturedPendingAction = syncEngine.outbox.has('move', '42');
      return { success: true };
    });

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(capturedPendingAction).toBe(true);
  });
});

describe('detectLocalChanges — file still at expected path', () => {
  test('skips files that are still at their expected path', async () => {
    const cs = checksum('<html>content</html>');
    syncEngine.repo.seed([['42', entry('my-site.html', cs, 111)]]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'my-site.html', path: '', checksum: cs, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map([
      ['my-site.html', { path: '/test/sync/my-site.html', relativePath: 'my-site.html', mtime: new Date(), size: 100 }]
    ]);

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(apiClient.moveNode).not.toHaveBeenCalled();
  });
});

describe('detectLocalChanges — API error handling', () => {
  test('continues processing after delete API failure', async () => {
    const cs1 = checksum('<html>site1</html>');
    const cs2 = checksum('<html>site2</html>');
    syncEngine.repo.seed([
      ['42', entry('site1.html', cs1, 111)],
      ['43', entry('site2.html', cs2, 222)]
    ]);

    const allServerNodes = [
      { id: 42, type: 'site', name: 'site1.html', path: '', checksum: cs1, modifiedAt: '2024-01-01T00:00:00Z' },
      { id: 43, type: 'site', name: 'site2.html', path: '', checksum: cs2, modifiedAt: '2024-01-01T00:00:00Z' }
    ];
    const localFiles = new Map();

    apiClient.deleteNode
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ success: true });

    await syncEngine.detectLocalChanges(allServerNodes, localFiles);

    expect(apiClient.deleteNode).toHaveBeenCalledTimes(2);
    expect(syncEngine.repo.has('42')).toBe(true);
    expect(syncEngine.repo.has('43')).toBe(false);
  });
});

describe('outbox TTL', () => {
  test('keys persist past the cleanup interval if within TTL', () => {
    syncEngine.outbox = new Outbox({ ttlMs: 30000 });
    syncEngine.outbox.markInFlight('rename', 42);

    // Sweep immediately — entry was just added, should survive
    syncEngine.outbox.sweep();

    expect(syncEngine.outbox.has('rename', 42)).toBe(true);
  });

  test('keys are evicted after the TTL elapses', () => {
    syncEngine.outbox = new Outbox({ ttlMs: 30000 });
    // Backdate: directly seed a 31s-old entry so sweep sees it as stale
    syncEngine.outbox._inFlight.set('rename:42', Date.now() - 31000);

    syncEngine.outbox.sweep();

    expect(syncEngine.outbox.has('rename', 42)).toBe(false);
  });

  test('only stale keys are evicted; fresh ones survive', () => {
    syncEngine.outbox = new Outbox({ ttlMs: 30000 });
    syncEngine.outbox._inFlight.set('rename:42', Date.now() - 31000); // stale
    syncEngine.outbox.markInFlight('move', 43);                        // fresh

    syncEngine.outbox.sweep();

    expect(syncEngine.outbox.has('rename', 42)).toBe(false);
    expect(syncEngine.outbox.has('move', 43)).toBe(true);
  });
});
