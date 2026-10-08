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

jest.mock('../../src/sync-engine/file-operations', () => {
  const actual = jest.requireActual('../../src/sync-engine/file-operations');
  return { ...actual, readFileBuffer: jest.fn(actual.readFileBuffer) };
});

jest.mock('../../src/sync-engine/reconcile/execute', () => {
  const actual = jest.requireActual('../../src/sync-engine/reconcile/execute');
  return { ...actual, executeDecision: jest.fn(actual.executeDecision) };
});

const os = require('os');
const fsp = require('fs').promises;
const path = require('upath');
const crypto = require('crypto');

const fileOps = require('../../src/sync-engine/file-operations');
const { SyncEngine } = require('../../src/sync-engine/index');
const execute = require('../../src/sync-engine/reconcile/execute');
const { executeDecision, resolveConflict } = execute;
const { calculateChecksum, calculateFileChecksum } = require('../../src/sync-engine/utils');
const store = require('../../src/sync-engine/reconcile/conflicts');
const uploadBlocks = require('../../src/sync-engine/state/upload-blocks');
const { A } = require('../../src/sync-engine/reconcile/decide');

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

const BIG = 'x'.repeat(20);
const BIG_SUM = checksum(BIG);
const EDITED = 'y'.repeat(20);
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

const completeList = (nodes) => Object.assign([...nodes], { complete: true });

const uploadNode = ({ id, name, etag = REMOTE_ETAG }) =>
  ({ id, type: 'upload', name, parentId: 0, path: '', etag, checksum: etag, structureVersion: SV_1 });

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

  it('a raised cap re-queues every blocked file the new cap admits', async () => {
    await engine.setUploadLimit(10);
    await writeLocalFile('photo.png', BIG);
    await writeLocalFile('huge.mp4', 'x'.repeat(200));
    await engine.blockUpload('photo.png', 20, 10);
    await engine.blockUpload('huge.mp4', 200, 10);
    engine.isRunning = true;
    const queue = jest.spyOn(engine, 'queueSync').mockImplementation(() => {});

    await engine.setUploadLimit(100);

    expect(engine.uploadLimit).toBe(100);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith('change', 'photo.png');
  });

  it('a 413 with no cached cap teaches the cap so the next pass does not resend', async () => {
    await writeLocalFile('photo.png', BIG);
    api.createNode.mockRejectedValue(Object.assign(new Error('too large'), { statusCode: 413, code: 'too-large', limit: 15 }));

    const first = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });
    expect(first).toEqual({ action: A.NOOP, blocked: true });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(engine.uploadLimit).toBe(15);

    const second = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(second).toEqual({ action: A.NOOP, blocked: true });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 15 });
  });

  it('keep mine on an oversize attachment sends nothing, stays local and is remembered', async () => {
    await engine.setUploadLimit(10);
    await seedUpload({ content: BIG });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });
    api.putNodeContent.mockClear();

    const result = await resolveConflict(engine, { path: 'photo.png', choice: 'mine' });

    expect(result).toEqual({ ok: false, error: 'too-large' });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.createNode).not.toHaveBeenCalled();
    expect(await fsp.readFile(path.join(root, 'photo.png'), 'utf8')).toBe(BIG);
    expect(engine.blockedUploads()).toEqual([{ path: 'photo.png', bytes: 20, limit: 10 }]);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 10, reason: 'too-large' });
    expect((await store.load(metaDir))['901']).toMatchObject({ kind: 'both-edited', path: 'photo.png' });
  });

  it('keep mine on a remote-deleted oversize attachment does not create the node', async () => {
    await engine.setUploadLimit(10);
    await seedUpload({ content: BIG });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'remote-deleted' });

    const result = await resolveConflict(engine, { path: 'photo.png', choice: 'mine' });

    expect(result).toEqual({ ok: false, error: 'too-large' });
    expect(api.createNode).not.toHaveBeenCalled();
    expect(await fsp.readFile(path.join(root, 'photo.png'), 'utf8')).toBe(BIG);
    expect(engine.blockedUploads()).toEqual([{ path: 'photo.png', bytes: 20, limit: 10 }]);
    expect((await store.load(metaDir))['901']).toMatchObject({ kind: 'remote-deleted', path: 'photo.png' });
  });

  it('keep theirs clears the record the file was kept under', async () => {
    await engine.setUploadLimit(10);
    await seedUpload({ content: BIG });
    await engine.blockUpload('photo.png', 20, 10);
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    const result = await resolveConflict(engine, { path: 'photo.png', choice: 'theirs' });

    expect(result).toEqual({ ok: true });
    expect(engine.blockedUploads()).toEqual([]);
    expect((await readBlockFile()).files).toEqual({});
  });

  it('a downgrade leaves a synced attachment that is unchanged here alone', async () => {
    await engine.setUploadLimit(10);
    await seedUpload();

    const item = await engine.decideNode({
      nodeId: '901',
      rel: 'photo.png',
      entry: engine.repo.get('901'),
      remote: uploadNode({ id: 901, name: 'photo.png' }),
      localPresent: true,
      type: 'upload'
    });

    expect(item.decision.action).toBe(A.NOOP);
    expect(engine.blockedUploads()).toEqual([]);
    expect((await readBlockFile()).files).toEqual({});
  });

  it('a downgrade still downloads a newer remote version of an oversize attachment', async () => {
    await engine.setUploadLimit(10);
    await seedUpload();

    const item = await engine.decideNode({
      nodeId: '901',
      rel: 'photo.png',
      entry: engine.repo.get('901'),
      remote: uploadNode({ id: 901, name: 'photo.png', etag: REMOTE_ETAG_2 }),
      localPresent: true,
      type: 'upload'
    });

    expect(item.decision.action).toBe(A.DOWNLOAD);
    expect(engine.blockedUploads()).toEqual([]);
  });

  it('an edit to an oversize attachment is decided as an upload the executor keeps local', async () => {
    await engine.setUploadLimit(10);
    const full = await seedUpload({ content: EDITED });

    const item = await engine.decideNode({
      nodeId: '901',
      rel: 'photo.png',
      entry: engine.repo.get('901'),
      remote: uploadNode({ id: 901, name: 'photo.png' }),
      localPresent: true,
      type: 'upload'
    });
    expect(item.decision.action).toBe(A.UPLOAD);

    const result = await executeDecision(engine, item.nodeId, item.decision, item.context);

    expect(result).toEqual({ action: A.NOOP, blocked: true });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(fileOps.readFileBuffer).not.toHaveBeenCalledWith(full);
    expect(engine.blockedUploads()).toEqual([{ path: 'photo.png', bytes: 20, limit: 10 }]);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 10, reason: 'too-large' });
  });

  it('a watcher change on an oversize attachment is an upload, never a deletion', async () => {
    await engine.setUploadLimit(10);
    const full = await seedUpload({ content: EDITED });
    api.listNodes.mockResolvedValue(completeList([uploadNode({ id: 901, name: 'photo.png' })]));

    await engine.applyLocalChange({ type: 'change', filename: 'photo.png' });

    expect(execute.executeDecision).toHaveBeenCalledWith(engine, '901', { action: A.UPLOAD }, expect.anything());
    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(fileOps.readFileBuffer).not.toHaveBeenCalledWith(full);
    expect(await fsp.readFile(full, 'utf8')).toBe(EDITED);
    expect(engine.blockedUploads()).toEqual([{ path: 'photo.png', bytes: 20, limit: 10 }]);
    expect((await readBlockFile()).files['photo.png']).toMatchObject({ bytes: 20, limit: 10, reason: 'too-large' });
  });
});

describe('calculateFileChecksum', () => {
  it('reads the same digest calculateChecksum gives for the same bytes', async () => {
    const full = await writeLocalFile('photo.png', BIG);

    expect(await calculateFileChecksum(full)).toBe(await calculateChecksum(Buffer.from(BIG)));
  });
});

describe('upload-blocks.json', () => {
  it('a missing file is an empty state', async () => {
    expect(await uploadBlocks.load(metaDir)).toEqual({ limit: null, files: {} });
  });

  it('a corrupt file is an empty state', async () => {
    await fsp.writeFile(path.join(metaDir, 'upload-blocks.json'), '{ "limit": 10, "files": ');

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
