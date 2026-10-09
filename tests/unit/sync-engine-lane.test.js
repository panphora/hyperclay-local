/**
 * The engine lane.
 *
 * One promise chain per engine runs every piece of work that changes the
 * server, the local disk or the ledger, one job at a time. Public entry points
 * enqueue through `engine.serial`; the `...InLane` bodies they call never
 * enqueue again, so a job can call one without waiting on itself.
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
    getInode: jest.fn()
  };
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function drain(turns = 6) {
  for (let i = 0; i < turns; i += 1) await tick();
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const completeList = (nodes = []) => Object.assign(nodes, { complete: true });

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
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
  fileOps.getLocalFolders.mockResolvedValue(new Map());
  fileOps.fileExists.mockReturnValue(true);

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.loadTombstones.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.saveState.mockResolvedValue();
  nodeMapModule.saveTombstones.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);

  apiClient.listNodes.mockResolvedValue(completeList());
});

describe('engine.serial', () => {
  it('runs overlapping jobs strictly in turn', async () => {
    const order = [];
    const first = syncEngine.serial(async () => {
      order.push('first:start');
      await tick();
      order.push('first:end');
    });
    const second = syncEngine.serial(async () => {
      order.push('second:start');
      await tick();
      order.push('second:end');
    });

    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('returns the job result and a rejection does not break the chain', async () => {
    await expect(syncEngine.serial(async () => 'value')).resolves.toBe('value');
    await expect(syncEngine.serial(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    const ran = jest.fn();
    await syncEngine.serial(ran);

    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('does not start a second job while the first holds an API promise open', async () => {
    syncEngine.repo.seed([[21, { type: 'site', path: 'page.html', checksum: 'cs' }]]);
    let release = null;
    apiClient.renameNode.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const first = syncEngine.serial(() => syncEngine._apiRenameNode(21, 'page2.html'));
    let secondStarted = false;
    const second = syncEngine.serial(async () => { secondStarted = true; });

    await drain();
    expect(apiClient.renameNode).toHaveBeenCalledTimes(1);
    expect(secondStarted).toBe(false);

    release({});
    await Promise.all([first, second]);

    expect(secondStarted).toBe(true);
  });

  it('leaves the lane usable when dropPendingWork runs mid-chain', async () => {
    let release = null;
    const held = syncEngine.serial(() => new Promise((resolve) => { release = resolve; }));
    await drain();

    syncEngine.dropPendingWork();
    const after = syncEngine.serial(async () => 'after');
    release();

    await held;
    await expect(after).resolves.toBe('after');
  });

  it('runs an InLane body from inside the lane without deadlocking', async () => {
    const result = await withTimeout(
      syncEngine.serial(() => syncEngine.reconcileAllInLane(completeList(), { generation: 1 })),
      2000,
      'the lane deadlocked on its own InLane body'
    );

    expect(result).toBeUndefined();
  });

  it('whenQueueEmpty waits for the lane to drain', async () => {
    let release = null;
    const held = syncEngine.serial(() => new Promise((resolve) => { release = resolve; }));
    let idle = false;
    const idleWait = syncEngine.whenQueueEmpty().then(() => { idle = true; });

    await drain();
    expect(idle).toBe(false);

    release();
    await held;
    await idleWait;

    expect(idle).toBe(true);
  });
});
