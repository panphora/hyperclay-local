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
const Outbox = require('../../src/sync-engine/state/outbox');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

let syncEngine;

beforeEach(() => {
  jest.clearAllMocks();

  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    syncEngine = new SyncEngine();
  });

  syncEngine.isRunning = true;
  syncEngine.repo.seed([]);
  syncEngine.pendingUnlinks = new Map();
  syncEngine.outbox = new Outbox();
  syncEngine.cascade = new CascadeSuppression();
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

describe('unified watcher — cascade suppression set', () => {
  beforeEach(() => {
    syncEngine.cascade = new CascadeSuppression();
  });

  it('marks descendants and consumes them on match', () => {
    syncEngine.cascade.mark(['projects/new/a.html', 'projects/new/b.html']);
    expect(syncEngine.cascade.size).toBe(2);

    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(true);
    expect(syncEngine.cascade.size).toBe(1);

    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(false);

    expect(syncEngine.cascade.consume('projects/new/b.html')).toBe(true);
  });

  it('expires entries after TTL', () => {
    jest.useFakeTimers();
    syncEngine.cascade.mark(['projects/new/a.html']);
    jest.advanceTimersByTime(3500);
    expect(syncEngine.cascade.consume('projects/new/a.html')).toBe(false);
    jest.useRealTimers();
  });

  it('unrelated paths are not consumed', () => {
    syncEngine.cascade.mark(['projects/new/a.html']);
    expect(syncEngine.cascade.consume('projects/other/b.html')).toBe(false);
    expect(syncEngine.cascade.size).toBe(1);
  });
});

describe('unified watcher — startUnifiedWatcher', () => {
  function fakeObserver() {
    return {
      setRemoteApplyCheck: jest.fn(),
      subscribe: jest.fn(() => () => {}),
      start: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    };
  }

  it('startUnifiedWatcher twice subscribes once', () => {
    const observer = fakeObserver();
    syncEngine.observer = observer;

    syncEngine.startUnifiedWatcher();
    syncEngine.startUnifiedWatcher();

    expect(observer.subscribe).toHaveBeenCalledTimes(1);
    expect(observer.on).toHaveBeenCalledTimes(1);
    expect(syncEngine._subscribedObserver).toBe(observer);
    expect(observer.start).not.toHaveBeenCalled();
  });
});
