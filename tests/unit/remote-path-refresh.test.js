/**
 * R-L2 (M1/M8): a teammate's rename or move is applied locally, never read as a
 * local delete, and never overwrites bytes the user wrote.
 *
 * `refreshNode` re-reads one node from a fresh list. When the listed path is not
 * the baseline path, the local file is moved there (or adopted if it is already
 * there), so `decide` never sees the tracked node as missing and deletes it on
 * the server. Whatever already sat at the destination is renamed to a
 * "conflicted copy" beside it, so nothing a user wrote is lost.
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
const THEIRS = '<html><body>theirs</body></html>';
const OCCUPANT = '<html><body>written by the user</body></html>';
const THEIRS_SUM = checksum(THEIRS);
const MINE_SUM = checksum(MINE);
const OCCUPANT_SUM = checksum(OCCUPANT);

const CONFLICT_COPY = 'b (conflicted copy).html';

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

async function readBytes(rel) {
  return fsp.readFile(full(rel), 'utf8');
}

async function exists(rel) {
  try {
    await fsp.access(full(rel));
    return true;
  } catch {
    return false;
  }
}

// Only what engine-session and the relocates under test need: a real sync
// folder, a real metadata dir and the baseline entries a session would hold.
async function makeEngine() {
  root = await tmpDir('rl2-root-');
  metaDir = await tmpDir('rl2-meta-');
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

const site = ({ id, name, parentPath = '', parentId = null, etag = 'e1' }) =>
  ({ id, type: 'site', name, parentId, path: parentPath, size: 1, etag, checksum: etag });

const folderNode = ({ id, name, parentPath = '', parentId = null }) =>
  ({ id, type: 'folder', name, parentId, path: parentPath });

beforeEach(async () => {
  jest.clearAllMocks();
  api.listNodes.mockResolvedValue(completeList([]));
  api.getNodeContent.mockResolvedValue({ content: MINE, checksum: 'e1', modifiedAt: '2026-01-01T00:00:00Z' });
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

describe('refreshNode after a remote move', () => {
  it('a remote rename of a file moves the local file and deletes nothing', async () => {
    await engine.repo.set('11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: MINE_SUM });
    await write('a.html', MINE);
    api.listNodes.mockResolvedValue(completeList([site({ id: 11, name: 'b.html' })]));

    await engine.refreshNode('11', { generation: 1 });

    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(await readBytes('b.html')).toBe(MINE);
    expect(await exists('a.html')).toBe(false);
    expect(await fsp.readdir(root)).toEqual(['b.html']);

    const entry = engine.repo.get('11');
    expect(entry.path).toBe('b.html');
    expect(entry.remoteEtag).toBe('e1');
    expect(entry.localChecksum).toBe(MINE_SUM);
  });

  it('a remote move into a folder moves the local file', async () => {
    await engine.repo.set('11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: MINE_SUM });
    await write('a.html', MINE);
    api.listNodes.mockResolvedValue(completeList([
      folderNode({ id: 20, name: 'docs' }),
      site({ id: 11, name: 'a.html', parentPath: 'docs', parentId: 20 })
    ]));

    await engine.refreshNode('11', { generation: 1 });

    expect(await readBytes('docs/a.html')).toBe(MINE);
    expect(await exists('a.html')).toBe(false);
    expect(engine.repo.get('11').path).toBe('docs/a.html');
    expect(api.deleteNode).not.toHaveBeenCalled();
  });

  it('a remote rename onto an occupied path moves the occupant to a conflicted copy', async () => {
    await engine.repo.set('11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: MINE_SUM });
    await write('a.html', MINE);
    await write('b.html', OCCUPANT);
    api.listNodes.mockResolvedValue(completeList([site({ id: 11, name: 'b.html' })]));

    await engine.refreshNode('11', { generation: 1 });

    expect(await readBytes('b.html')).toBe(MINE);
    expect(await readBytes(CONFLICT_COPY)).toBe(OCCUPANT);
    expect(await exists('a.html')).toBe(false);
    expect(engine.repo.get('11').path).toBe('b.html');
    expect(api.deleteNode).not.toHaveBeenCalled();
  });

  it('a remote folder rename relocates the folder and its descendants', async () => {
    await engine.repo.set('20', { type: 'folder', path: 'x', parentId: null });
    await engine.repo.set('11', { type: 'site', path: 'x/a.html', remoteEtag: 'e1', localChecksum: MINE_SUM });
    await write('x/a.html', MINE);
    api.listNodes.mockResolvedValue(completeList([
      folderNode({ id: 20, name: 'y' }),
      site({ id: 11, name: 'a.html', parentPath: 'y', parentId: 20 })
    ]));

    await engine.refreshNode('20', { generation: 1 });

    expect(await readBytes('y/a.html')).toBe(MINE);
    expect(await exists('x')).toBe(false);
    expect(engine.repo.get('20').path).toBe('y');
    expect(engine.repo.get('11').path).toBe('y/a.html');
    expect(api.deleteNode).not.toHaveBeenCalled();
  });

  it('a file already moved to the listed path is adopted', async () => {
    await engine.repo.set('11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: THEIRS_SUM });
    await write('b.html', THEIRS);
    api.listNodes.mockResolvedValue(completeList([site({ id: 11, name: 'b.html' })]));

    await engine.refreshNode('11', { generation: 1 });

    expect(engine.repo.get('11').path).toBe('b.html');
    expect(await readBytes('b.html')).toBe(THEIRS);
    expect(await fsp.readdir(root)).toEqual(['b.html']);
    expect(api.deleteNode).not.toHaveBeenCalled();
  });
});

describe('offline correlation', () => {
  it('offline correlation never overwrites an occupied destination', async () => {
    await engine.repo.set('11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: MINE_SUM });
    await write('a.html', MINE);
    await write('b.html', OCCUPANT);

    const localFiles = new Map([
      ['a.html', { path: full('a.html'), relativePath: 'a.html', size: MINE.length }],
      ['b.html', { path: full('b.html'), relativePath: 'b.html', size: OCCUPANT.length }]
    ]);
    const map = new Map([['11', { type: 'site', path: 'a.html', remoteEtag: 'e1', localChecksum: MINE_SUM }]]);
    const tracked = localFiles.get('a.html');
    const occupant = localFiles.get('b.html');

    await engine.correlateServerFile(
      { nodeId: 11, path: 'b.html', filename: 'b.html', checksum: 'e1' },
      localFiles,
      map
    );

    expect(await readBytes('b.html')).toBe(MINE);
    expect(await readBytes(CONFLICT_COPY)).toBe(OCCUPANT);
    expect(await exists('a.html')).toBe(false);
    expect(map.get('11').path).toBe('b.html');
    expect(localFiles.get(CONFLICT_COPY)).toBe(occupant);
    expect(localFiles.get('b.html')).toBe(tracked);
  });
});
