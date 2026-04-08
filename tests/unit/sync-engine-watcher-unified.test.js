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

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const { renameNode, moveNode, deleteNode } = require('../../src/sync-engine/api-client');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    syncEngine = require('../../src/sync-engine/index');
  });

  syncEngine.isRunning = true;
  syncEngine.nodeMap = new Map();
  syncEngine.pendingUnlinks = new Map();
  syncEngine.pendingActions = new Map();
  syncEngine.recentFolderRenameDescendants = new Map();
  syncEngine.folderIdentityWaiters = new Map();
  syncEngine.serverUrl = 'http://test';
  syncEngine.apiKey = 'test-key';
  syncEngine.syncFolder = '/tmp/test-sync';
  syncEngine.metaDir = '/tmp/test-meta';
  renameNode.mockClear();
  moveNode.mockClear();
  deleteNode.mockClear();
});

afterEach(() => {
  for (const { timerId } of syncEngine.pendingUnlinks.values()) {
    clearTimeout(timerId);
  }
  syncEngine.pendingUnlinks.clear();
});

describe('unified watcher — correlator', () => {
  it('rejects cross-type correlation (site unlink + upload add)', () => {
    syncEngine.nodeMap.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    expect(syncEngine.pendingUnlinks.size).toBe(1);

    const consumed = syncEngine._tryCorrelatePendingUnlink('foo.png', 'upload');
    expect(consumed).toBe(false);
    expect(syncEngine.pendingUnlinks.has('foo.html')).toBe(true);
  });

  it('correlates same-type rename', () => {
    syncEngine.nodeMap.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    const spy = jest.spyOn(syncEngine, '_correlateFileUnlinkAdd').mockResolvedValue();
    syncEngine._tryCorrelatePendingUnlink('bar.html', 'site');
    expect(spy).toHaveBeenCalledWith('foo.html', 'bar.html', expect.any(Object), 'rename', 'site');
    spy.mockRestore();
  });

  it('does not correlate when paths are identical', () => {
    syncEngine.nodeMap.set('1', {
      type: 'site',
      path: 'foo.html',
      checksum: 'abc',
      inode: 100
    });

    syncEngine._registerPendingUnlink('foo.html', 'site');
    const consumed = syncEngine._tryCorrelatePendingUnlink('foo.html', 'site');
    expect(consumed).toBe(false);
  });

  it('does not register pending unlink for untracked path', () => {
    syncEngine._registerPendingUnlink('unknown.html', 'site');
    expect(syncEngine.pendingUnlinks.size).toBe(0);
  });
});

describe('unified watcher — cascade suppression set', () => {
  beforeEach(() => {
    syncEngine.recentFolderRenameDescendants = new Map();
    syncEngine.FOLDER_RENAME_SUPPRESSION_TTL_MS = 3000;
  });

  it('marks descendants and consumes them on match', () => {
    syncEngine._markDescendantsForSuppression(['projects/new/a.html', 'projects/new/b.html']);
    expect(syncEngine.recentFolderRenameDescendants.size).toBe(2);

    expect(syncEngine._consumeSuppressedEvent('projects/new/a.html')).toBe(true);
    expect(syncEngine.recentFolderRenameDescendants.size).toBe(1);

    expect(syncEngine._consumeSuppressedEvent('projects/new/a.html')).toBe(false);

    expect(syncEngine._consumeSuppressedEvent('projects/new/b.html')).toBe(true);
  });

  it('expires entries after TTL', () => {
    jest.useFakeTimers();
    syncEngine._markDescendantsForSuppression(['projects/new/a.html']);
    jest.advanceTimersByTime(3500);
    expect(syncEngine._consumeSuppressedEvent('projects/new/a.html')).toBe(false);
    jest.useRealTimers();
  });

  it('unrelated paths are not consumed', () => {
    syncEngine._markDescendantsForSuppression(['projects/new/a.html']);
    expect(syncEngine._consumeSuppressedEvent('projects/other/b.html')).toBe(false);
    expect(syncEngine.recentFolderRenameDescendants.size).toBe(1);
  });
});
