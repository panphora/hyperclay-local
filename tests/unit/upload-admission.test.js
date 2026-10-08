/**
 * C3.12: an attachment over the account's per-file cap stays on this computer.
 *
 * The engine knows the cap from discovery (`limits.uploadBytes`), never sends a
 * file over it, treats a 413 `too-large` the same way, and remembers each such
 * file in the session's `upload-blocks.json`. The baseline is left where it was,
 * so the next pass asks again with the cap it has then.
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
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastFileSaved: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn(() => Promise.resolve({})),
  applyRemoteResolution: jest.fn()
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn(async () => {})
}));

jest.mock('../../src/main/utils/backup', () => ({
  createBackupIfExists: jest.fn(),
  createBinaryBackupIfExists: jest.fn()
}));

const api = require('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  listNodes: jest.fn(),
  getNodeContent: jest.fn(),
  putNodeContent: jest.fn(),
  createNode: jest.fn(),
  renameNode: jest.fn(),
  moveNode: jest.fn(),
  deleteNode: jest.fn()
}));

const os = require('os');
const fsp = require('fs').promises;
const path = require('upath');
const crypto = require('crypto');

const { SyncEngine } = require('../../src/sync-engine/index');
const { executeDecision } = require('../../src/sync-engine/reconcile/execute');
const uploadBlocks = require('../../src/sync-engine/state/upload-blocks');
const { A } = require('../../src/sync-engine/reconcile/decide');

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

const BIG = 'x'.repeat(20);
const BIG_SUM = checksum(BIG);
const REMOTE_ETAG = 'aaaa1111bbbb2222';
const REMOTE_ETAG_2 = 'cccc3333dddd4444';
const SV_1 = 'st1';

let root;
let metaDir;
let engine;

async function makeEngine() {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'upload-admission-root-')));
  metaDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'upload-admission-meta-'));
  engine = new SyncEngine();
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.serverUrl = 'http://localhost:5';
  engine.apiKey = 'hcsk_test';
  engine.accountId = 42;
  engine.protocol = 2;
  engine.live = { markBrowserSave: jest.fn(), broadcast: jest.fn() };
  engine.snapshots = { take: () => null };
  jest.spyOn(engine, 'emit');
  return engine;
}

async function writeLocalFile(rel, content) {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
  return full;
}

function seedUpload({ rel = 'photo.png', content = BIG, remoteEtag = REMOTE_ETAG, localChecksum = BIG_SUM } = {}) {
  engine.repo.seed([['901', {
    type: 'upload',
    path: rel,
    inode: 11,
    remoteEtag,
    localChecksum,
    structureVersion: SV_1,
    checksum: localChecksum,
    syncedAt: 1
  }]]);
  return writeLocalFile(rel, content);
}

async function readBlockFile() {
  return JSON.parse(await fsp.readFile(path.join(metaDir, 'upload-blocks.json'), 'utf8'));
}

beforeEach(async () => {
  jest.clearAllMocks();
  api.getNodeContent.mockResolvedValue({ content: BIG, nodeType: 'upload', checksum: REMOTE_ETAG, etag: REMOTE_ETAG });
  api.putNodeContent.mockResolvedValue({ nodeId: 901, checksum: REMOTE_ETAG_2, etag: REMOTE_ETAG_2, structureVersion: 'st2' });
  api.createNode.mockResolvedValue({ id: 1200, type: 'upload', name: 'photo.png', parentId: 0, etag: REMOTE_ETAG_2, structureVersion: 'st3' });
  await makeEngine();
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(metaDir, { recursive: true, force: true });
});

describe('an attachment over the cap stays local', () => {
  it('a create of an oversize attachment is never sent and is remembered', async () => {
    await engine.setUploadLimit(10);
    await writeLocalFile('photo.png', BIG);

    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(result).toEqual({ action: A.NOOP, blocked: true });
    expect(api.createNode).not.toHaveBeenCalled();
    const saved = await readBlockFile();
    expect(saved.files['photo.png']).toMatchObject({ bytes: 20, limit: 10, reason: 'too-large' });
    expect(engine.blockedUploads()).toEqual([{ path: 'photo.png', bytes: 20, limit: 10 }]);
  });

  it('an upload of an oversize attachment with a known baseline is never sent', async () => {
    await engine.setUploadLimit(10);
    await seedUpload();

    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(result).toEqual({ action: A.NOOP, blocked: true });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 10 });
  });

  it('a site of the same size is uploaded and never recorded', async () => {
    await engine.setUploadLimit(10);
    await writeLocalFile('page.html', BIG);

    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'page.html', type: 'site', parentId: 0 });

    expect(result.action).toBe(A.CREATE_REMOTE);
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(engine.blockedUploads()).toEqual([]);
    expect((await readBlockFile()).files).toEqual({});
  });

  it('no cap known means the attachment is sent', async () => {
    await writeLocalFile('photo.png', BIG);

    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(result.action).toBe(A.CREATE_REMOTE);
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(engine.blockedUploads()).toEqual([]);
  });

  it('a server 413 too-large blocks the create and takes the cap it reported', async () => {
    await writeLocalFile('photo.png', BIG);
    api.createNode.mockRejectedValue(Object.assign(new Error('too large'), { statusCode: 413, code: 'too-large', limit: 15 }));

    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(result).toEqual({ action: A.NOOP, blocked: true });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 15, reason: 'too-large' });
  });

  it('a 413 too-large on an upload blocks it too', async () => {
    await seedUpload();
    api.putNodeContent.mockRejectedValue(Object.assign(new Error('too large'), { statusCode: 413, code: 'too-large', limit: 15 }));

    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(result).toEqual({ action: A.NOOP, blocked: true });
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 15 });
  });

  it('a raised cap sends the file and drops the record', async () => {
    await engine.setUploadLimit(10);
    await writeLocalFile('photo.png', BIG);
    await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });
    expect(engine.blockedUploads()).toHaveLength(1);

    await engine.setUploadLimit(100);
    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(result.action).toBe(A.CREATE_REMOTE);
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(engine.blockedUploads()).toEqual([]);
    expect((await readBlockFile()).files).toEqual({});
  });
});

describe('upload-blocks.json', () => {
  it('a missing file is an empty state', async () => {
    expect(await uploadBlocks.load(metaDir)).toEqual({ limit: null, files: {} });
  });

  it('save then load round-trips the cap and the records', async () => {
    await uploadBlocks.save(metaDir, { limit: 10, files: { 'photo.png': { bytes: 20, limit: 10, reason: 'too-large', at: 'now' } } });

    expect(await uploadBlocks.load(metaDir)).toEqual({
      limit: 10,
      files: { 'photo.png': { bytes: 20, limit: 10, reason: 'too-large', at: 'now' } }
    });
  });
});
