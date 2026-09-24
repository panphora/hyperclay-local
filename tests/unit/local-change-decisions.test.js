/**
 * R-L5 (M9/M10): a local change is never decided against a list that cannot
 * know its node.
 *
 * `createRemote` drops the inventory cached before the node it just created, a
 * node the repo tracks but the cache omits is re-listed once before `decide`
 * may read it as deleted, and a file the repo does not track but the list shows
 * is decided under the listed node's id instead of the string "null".
 *
 * The engine, the disk and the metadata are real (temp dirs); only the server
 * (api-client) is a fake.
 */

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

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn(async () => ({}))
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn(async () => ({}))
}));

jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  listNodes: jest.fn(),
  getNodeContent: jest.fn(),
  putNodeContent: jest.fn(),
  createNode: jest.fn(),
  deleteNode: jest.fn()
}));

const fsp = require('fs').promises;
const os = require('os');
const path = require('upath');
const crypto = require('crypto');

const api = require('../../src/sync-engine/api-client');
const { SyncEngine } = require('../../src/sync-engine/index');

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
const completeList = (nodes) => Object.assign([...nodes], { complete: true });

const MINE = '<html><body>mine</body></html>';
const MINE_SUM = checksum(MINE);

const createdNode = ({ id, name, etag = MINE_SUM }) =>
  ({ id, type: 'site', name, parentId: null, path: '', etag, checksum: etag });

const dirs = [];
let root = null;
let metaDir = null;
let engine = null;

async function tmpDir(prefix) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

const full = (rel) => path.join(root, rel);

async function write(rel, bytes) {
  await fsp.mkdir(path.dirname(full(rel)), { recursive: true });
  await fsp.writeFile(full(rel), bytes);
}

async function exists(rel) {
  try {
    await fsp.access(full(rel));
    return true;
  } catch {
    return false;
  }
}

async function makeEngine() {
  root = await tmpDir('rl5-root-');
  metaDir = await tmpDir('rl5-meta-');
  engine = new SyncEngine();
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.serverUrl = 'https://hyperclay.test';
  engine.apiKey = 'hcsk_test';
  engine.syncBase = '/_/team/acme/sync';
  engine.protocol = 2;
  engine.accountId = 42;
  engine.deviceId = 'device-1';
  engine.isRunning = true;
  engine.live = { markBrowserSave: jest.fn(), broadcast: jest.fn() };
  engine.snapshots = { take: () => null };
  return engine;
}

beforeEach(async () => {
  // mockReset, not clearAllMocks: a `mockResolvedValueOnce` queue that a test
  // did not consume must not decide the next one.
  for (const fn of [api.listNodes, api.getNodeContent, api.putNodeContent, api.createNode, api.deleteNode]) {
    fn.mockReset();
  }
  api.listNodes.mockResolvedValue(completeList([]));
  await makeEngine();
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
  root = null;
  metaDir = null;
  engine = null;
});

describe('applyLocalChange against a cached inventory', () => {
  it('a second event for a file just created from the desktop does not trash it', async () => {
    await write('new.html', MINE);
    api.createNode.mockResolvedValue(createdNode({ id: 901, name: 'new.html' }));
    api.listNodes
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(completeList([createdNode({ id: 901, name: 'new.html' })]));

    await engine.applyLocalChange({ type: 'add', filename: 'new.html' });

    expect(engine.repo.getBaseline('901')).toMatchObject({ remoteEtag: MINE_SUM, localChecksum: MINE_SUM });
    expect(engine.serverNodesCache).toBeNull();

    // The list a session is holding was read before the node existed: a frame
    // that started earlier can land it after the create invalidated the cache.
    engine.serverNodesCache = [];
    engine.serverNodesCacheTime = Date.now();

    await engine.applyLocalChange({ type: 'change', filename: 'new.html' });

    expect(await exists('new.html')).toBe(true);
    expect(await exists(path.join('.trash', 'new.html'))).toBe(false);
    expect(engine.repo.getBaseline('901')).toMatchObject({ remoteEtag: MINE_SUM, localChecksum: MINE_SUM });
    expect(api.listNodes).toHaveBeenCalledTimes(2);
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.deleteNode).not.toHaveBeenCalled();
  });

  it('a local add at a path the list already shows is adopted under that node\'s id', async () => {
    await write('b.html', MINE);
    api.listNodes.mockResolvedValue(completeList([createdNode({ id: 22, name: 'b.html' })]));

    await engine.applyLocalChange({ type: 'add', filename: 'b.html' });

    expect(engine.repo.get('22')).toBeTruthy();
    expect(engine.repo.get('null')).toBeUndefined();
    expect(engine.repo.getBaseline('22')).toMatchObject({ remoteEtag: MINE_SUM, localChecksum: MINE_SUM });
    expect(api.createNode).not.toHaveBeenCalled();
  });

  it('a tracked file the fresh list still omits is decided as decide says for a missing remote', async () => {
    await engine.repo.set('901', {
      type: 'site',
      path: 'gone.html',
      remoteEtag: MINE_SUM,
      localChecksum: MINE_SUM,
      syncedAt: Date.now()
    });
    await write('gone.html', MINE);

    await engine.applyLocalChange({ type: 'change', filename: 'gone.html' });

    expect(api.listNodes).toHaveBeenCalled();
    expect(await exists('gone.html')).toBe(false);
    expect(await exists(path.join('.trash', 'gone.html'))).toBe(true);
    expect(engine.repo.get('901')).toBeUndefined();
  });
});
