// Two session properties the class has to own: the live-sync key comes from the
// root (opts.live), and stop() freezes the session so a late network response
// cannot write, apply to the repo or reach a browser.

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
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

jest.mock('eventsource', () => ({
  EventSource: jest.fn()
}));

jest.mock('../../src/main/utils/utils', () => ({
  getServerBaseUrl: (url) => url || 'http://localhyperclay.com'
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn().mockResolvedValue(),
  createBinaryBackupIfExists: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn().mockResolvedValue(undefined)
}));

// init() validates the key against the platform; these tests are about the
// session wiring around it, not the handshake.
jest.mock('../../src/sync-engine/utils', () => ({
  ...jest.requireActual('../../src/sync-engine/utils'),
  calibrateClock: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/node-map');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { liveSync } = require('livesync-hyperclay');
const fileOps = require('../../src/sync-engine/file-operations');
const apiClient = require('../../src/sync-engine/api-client');
const nodeMapModule = require('../../src/sync-engine/node-map');
const { createRootLive } = require('../../src/main/utils/root-live');
const { SyncEngine } = require('../../src/sync-engine/index');

const flush = () => new Promise((resolve) => setImmediate(resolve));

let engine = null;
let syncFolder = null;

// init() does the whole session (initial syncs, watcher, stream); the parts not
// under test here are stubbed so the run stays off the network and off disk.
async function startEngine(opts) {
  engine = new SyncEngine();
  engine.performInitialFolderSync = jest.fn().mockResolvedValue();
  engine.performInitialSync = jest.fn().mockResolvedValue();
  engine.performInitialUploadSync = jest.fn().mockResolvedValue();
  engine.startUnifiedWatcher = jest.fn();
  engine.connectToStream = jest.fn();

  syncFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-generation-'));
  await engine.init(
    'hcsk_test',
    'acme',
    syncFolder,
    'http://test',
    'device-1',
    path.join(syncFolder, 'meta'),
    opts
  );
  return engine;
}

beforeEach(() => {
  jest.clearAllMocks();

  fileOps.writeFile.mockResolvedValue();
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.ensureDirectory.mockResolvedValue();
  fileOps.fileExists.mockResolvedValue(false);
  fileOps.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  fileOps.readFileBuffer.mockResolvedValue(Buffer.from('local body'));
  fileOps.calculateBufferChecksum.mockReturnValue('local-checksum');

  nodeMapModule.getInode.mockResolvedValue(1);
  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.loadTombstones.mockResolvedValue(new Map());
  nodeMapModule.loadState.mockResolvedValue({});
  nodeMapModule.saveState.mockResolvedValue();

  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>remote</html>',
    modifiedAt: '2026-04-08T12:00:00Z',
    checksum: 'remote-checksum'
  });
});

afterEach(async () => {
  if (engine && engine.isRunning) await engine.stop();
  if (syncFolder) fs.rmSync(syncFolder, { recursive: true, force: true });
  engine = null;
  syncFolder = null;
});

describe('per-root live keys', () => {
  it('keys a team session through its root id', async () => {
    await startEngine({ live: createRootLive({ id: 'r1', kind: 'team' }) });

    await engine.downloadFile(7, 'index.html');

    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('r1:index.html');
    expect(fileOps.writeFile).toHaveBeenCalled();
  });

  it('keeps the bare relative path when no opts.live is given', async () => {
    await startEngine();

    await engine.downloadFile(7, 'index.html');

    expect(liveSync.markBrowserSave).toHaveBeenCalledWith('index.html');
  });
});

describe('isRecentRemoteApply', () => {
  it('matches only the path of an event the engine just applied', async () => {
    await startEngine();

    await engine.repo.set(42, { type: 'site', path: 'index.html', checksum: 'cs', syncedAt: Date.now() });

    expect(engine.isRecentRemoteApply('index.html')).toBe(false);
    expect(engine.isRecentRemoteApply('other.html')).toBe(false);

    engine.echoWindow.mark('site', 42);

    expect(engine.isRecentRemoteApply('index.html')).toBe(true);
    expect(engine.isRecentRemoteApply('other.html')).toBe(false);
  });
});

describe('generation counter', () => {
  it('applies a remote upload that landed before stop()', async () => {
    await startEngine();
    const synced = jest.fn();
    engine.on('file-synced', synced);

    await engine.handleNodeSaved({
      nodeId: 42,
      nodeType: 'upload',
      name: 'photo.png',
      path: 'photo.png',
      checksum: 'remote-checksum',
      modifiedAt: '2026-04-08T12:00:00Z'
    });

    expect(fileOps.writeFileBuffer).toHaveBeenCalledWith(
      path.join(syncFolder, 'photo.png'),
      '<html>remote</html>',
      '2026-04-08T12:00:00Z'
    );
    expect(synced).toHaveBeenCalled();
  });

  it('ignores a getNodeContent response that lands after stop()', async () => {
    const live = {
      key: (rel) => rel,
      markBrowserSave: jest.fn(),
      wasBrowserSave: jest.fn(() => false),
      notify: jest.fn(),
      broadcast: jest.fn()
    };
    await startEngine({ live });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    let resolveContent;
    apiClient.getNodeContent.mockImplementation(
      () => new Promise((resolve) => { resolveContent = resolve; })
    );

    const pending = engine.handleNodeSaved({
      nodeId: 42,
      nodeType: 'upload',
      name: 'photo.png',
      path: 'photo.png',
      checksum: 'remote-checksum',
      modifiedAt: '2026-04-08T12:00:00Z'
    });

    await flush();
    expect(apiClient.getNodeContent).toHaveBeenCalled();

    await engine.stop();

    resolveContent({
      content: Buffer.from([1, 2, 3]),
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'remote-checksum'
    });
    await pending;
    await flush();

    expect(fileOps.writeFileBuffer).not.toHaveBeenCalled();
    expect(fileOps.writeFile).not.toHaveBeenCalled();
    expect(engine.repo.has(42)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(syncFolder, 'photo.png'))).toBe(false);
    expect(live.broadcast).not.toHaveBeenCalled();
    expect(live.markBrowserSave).not.toHaveBeenCalled();
  });
});
