/**
 * C3.4: the one executor and the conflict store.
 *
 * Every action `decide` returns has an executor case, the baseline advances
 * only after the write or the acknowledgment succeeded, an uncertain outcome
 * refetches before it is judged, and a conflict never loses bytes: the local
 * file stays in place, the remote bytes land under `.hyperclay/conflicts/`, and
 * `conflicts.json` records it until the user picks mine or theirs.
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

const backup = require('../../src/main/utils/backup');
const fileOps = require('../../src/sync-engine/file-operations');
const { SyncEngine } = require('../../src/sync-engine/index');
const store = require('../../src/sync-engine/reconcile/conflicts');
const { executeDecision, resolveConflict } = require('../../src/sync-engine/reconcile/execute');
const { A } = require('../../src/sync-engine/reconcile/decide');

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

const LOCAL_BYTES = '<h1>mine</h1>';
const REMOTE_BYTES = '<h1>theirs</h1>';
const LOCAL_SUM = checksum(LOCAL_BYTES);
const REMOTE_ETAG = 'aaaa1111bbbb2222';
const REMOTE_SUM = checksum(REMOTE_BYTES);
const REMOTE_ETAG_2 = 'cccc3333dddd4444';
const SV_1 = 'st1';

let root;
let metaDir;
let engine;

async function makeEngine() {
  root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'reconcile-root-')));
  metaDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reconcile-meta-'));
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

async function readLocalFile(rel) {
  return fsp.readFile(path.join(root, rel), 'utf8');
}

async function exists(rel) {
  try {
    await fsp.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

function seedSite({ rel = 'board.html', content = LOCAL_BYTES, remoteEtag = REMOTE_ETAG, localChecksum = LOCAL_SUM } = {}) {
  engine.repo.seed([['901', {
    type: 'site',
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

function remoteContent(content = REMOTE_BYTES, etag = REMOTE_ETAG, structureVersion = 'st2', sum = etag) {
  return {
    content,
    nodeType: 'site',
    modifiedAt: '2026-09-23T12:00:00.000Z',
    checksum: sum,
    etag,
    structureVersion
  };
}

async function readRecords() {
  return store.load(metaDir);
}

beforeEach(async () => {
  jest.clearAllMocks();
  // The backup helpers are the existing ones; stamp the bytes they are handed
  // so a test can prove the backup ran before the overwrite.
  backup.seen = null;
  backup.createBackupIfExists.mockImplementation(async (filePath) => {
    backup.seen = await fsp.readFile(filePath, 'utf8');
  });
  api.getNodeContent.mockResolvedValue(remoteContent());
  api.putNodeContent.mockResolvedValue({ nodeId: 901, checksum: REMOTE_ETAG_2, etag: REMOTE_ETAG_2, structureVersion: 'st2' });
  api.createNode.mockResolvedValue({ id: 1200, type: 'site', name: 'new.html', parentId: 0, etag: REMOTE_ETAG_2, structureVersion: 'st3' });
  api.deleteNode.mockResolvedValue({ success: true });
  await makeEngine();
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(metaDir, { recursive: true, force: true });
});

describe('protocol 2 preconditions ride the wire', () => {
  const wire = jest.requireActual('../../src/sync-engine/api-client');
  const conn = { serverUrl: 'http://localhost:5', syncBase: '/_/sync', apiKey: 'hcsk_test', accountId: 42, protocol: 2 };

  async function call(fn) {
    const original = global.fetch;
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          success: true,
          content: 'body',
          nodeType: 'site',
          checksum: REMOTE_ETAG,
          etag: REMOTE_ETAG,
          structureVersion: 'st9',
          node: { id: 901, type: 'site', name: 'board.html', parentId: 0 }
        })
      };
    });
    try {
      await fn();
    } finally {
      global.fetch = original;
    }
    return calls[0];
  }

  it('a PUT carries If-Match with the etag the baseline last agreed on', async () => {
    const { url, init } = await call(() => wire.putNodeContent(conn, 901, '<h1>mine</h1>', { ifMatch: REMOTE_ETAG }));
    expect(url).toBe('http://localhost:5/_/sync/nodes/901/content');
    expect(init.headers['If-Match']).toBe(`"${REMOTE_ETAG}"`);
    expect(init.headers['X-Sync-Protocol']).toBe('2');
    expect(init.headers['X-Sync-Account-ID']).toBe('42');
  });

  it('a DELETE carries expectedVersion in the query string', async () => {
    const { url, init } = await call(() => wire.deleteNode(conn, 901, { expectedVersion: SV_1 }));
    expect(url).toBe(`http://localhost:5/_/sync/nodes/901?expectedVersion=${SV_1}`);
    expect(init.method).toBe('DELETE');
  });

  it('a cascade DELETE keeps both parameters', async () => {
    const { url } = await call(() => wire.deleteNode(conn, 901, { cascade: true, expectedVersion: SV_1 }));
    expect(url).toBe(`http://localhost:5/_/sync/nodes/901?cascade=true&expectedVersion=${SV_1}`);
  });

  it('rename and move carry expectedVersion in the body', async () => {
    const rename = await call(() => wire.renameNode(conn, 901, 'b.html', { expectedVersion: SV_1 }));
    expect(JSON.parse(rename.init.body)).toEqual({ newName: 'b.html', expectedVersion: SV_1 });

    const move = await call(() => wire.moveNode(conn, 901, 0, 'b.html', { expectedVersion: SV_1 }));
    expect(JSON.parse(move.init.body)).toEqual({ targetParentId: 0, newName: 'b.html', expectedVersion: SV_1 });
  });

  it('a rename without expectedVersion keeps the old body shape', async () => {
    const rename = await call(() => wire.renameNode(conn, 901, 'b.html'));
    expect(JSON.parse(rename.init.body)).toEqual({ newName: 'b.html' });
  });
});

describe('executeDecision — one case per action kind', () => {
  it('noop writes nothing and calls nothing', async () => {
    await seedSite();
    const result = await executeDecision(engine, '901', { action: A.NOOP });

    expect(result).toEqual({ action: A.NOOP });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.getNodeContent).not.toHaveBeenCalled();
    expect(await readLocalFile('board.html')).toBe(LOCAL_BYTES);
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
  });

  it('a noop pass refreshes a stale structureVersion', async () => {
    await seedSite();
    const result = await executeDecision(engine, '901', { action: A.NOOP }, { structureVersion: 'st5' });

    expect(result).toEqual({ action: A.NOOP });
    expect(engine.repo.getBaseline('901').structureVersion).toBe('st5');
    expect(api.putNodeContent).not.toHaveBeenCalled();
  });

  it('defer writes nothing', async () => {
    await seedSite();
    const result = await executeDecision(engine, '901', { action: A.DEFER });

    expect(result).toEqual({ action: A.DEFER });
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
  });

  it('upload PUTs the local bytes with If-Match and advances both checksums', async () => {
    await seedSite({ content: '<h1>edited</h1>', remoteEtag: REMOTE_ETAG, localChecksum: REMOTE_ETAG });
    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(api.putNodeContent).toHaveBeenCalledTimes(1);
    expect(api.putNodeContent.mock.calls[0][0]).toMatchObject({ protocol: 2, accountId: 42 });
    expect(api.putNodeContent.mock.calls[0][1]).toBe(901);
    expect(api.putNodeContent.mock.calls[0][2]).toBe('<h1>edited</h1>');
    expect(api.putNodeContent.mock.calls[0][3].ifMatch).toBe(REMOTE_ETAG);

    expect(result).toEqual({ action: A.UPLOAD, etag: REMOTE_ETAG_2, checksum: REMOTE_ETAG_2 });
    expect(engine.repo.getBaseline('901')).toEqual({
      remoteEtag: REMOTE_ETAG_2,
      localChecksum: REMOTE_ETAG_2,
      structureVersion: 'st2',
      uploadBlocked: false
    });
    expect(await readLocalFile('board.html')).toBe('<h1>edited</h1>');
  });

  it('download backs up, writes and records the written checksum beside the remote etag', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    const result = await executeDecision(engine, '901', { action: A.DOWNLOAD });

    expect(result).toEqual({ action: A.DOWNLOAD, checksum: REMOTE_SUM });
    expect(await readLocalFile('board.html')).toBe(REMOTE_BYTES);
    expect(backup.createBackupIfExists).toHaveBeenCalledTimes(1);
    expect(backup.seen).toBe(LOCAL_BYTES);
    expect(engine.repo.getBaseline('901')).toEqual({
      remoteEtag: REMOTE_ETAG,
      localChecksum: REMOTE_SUM,
      structureVersion: 'st2',
      uploadBlocked: false
    });
  });

  it('adopt records the agreement without touching the file or the server', async () => {
    await writeLocalFile('board.html', REMOTE_BYTES);
    const result = await executeDecision(engine, 902, { action: A.ADOPT }, {
      path: 'board.html',
      type: 'site',
      etag: REMOTE_SUM
    });

    expect(result).toEqual({ action: A.ADOPT, checksum: REMOTE_SUM });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.createNode).not.toHaveBeenCalled();
    expect(engine.repo.getBaseline(902)).toEqual({
      remoteEtag: REMOTE_SUM,
      localChecksum: REMOTE_SUM,
      structureVersion: null,
      uploadBlocked: false
    });
    expect(engine.repo.get(902).path).toBe('board.html');
  });

  it('adopt keeps the listed structureVersion', async () => {
    await writeLocalFile('board.html', REMOTE_BYTES);
    const result = await executeDecision(engine, 903, { action: A.ADOPT }, {
      path: 'board.html',
      type: 'site',
      etag: REMOTE_SUM,
      structureVersion: 'st7'
    });

    expect(result).toEqual({ action: A.ADOPT, checksum: REMOTE_SUM });
    expect(engine.repo.getBaseline(903).structureVersion).toBe('st7');
  });

  it('conflict keeps the local bytes, parks the remote bytes and records it', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    const result = await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    expect(result.action).toBe(A.CONFLICT);
    expect(await readLocalFile('board.html')).toBe(LOCAL_BYTES);

    const copy = path.join('conflicts', 'board.remote-aaaa1111.html');
    expect(result.record.remoteCopy).toBe(path.join('.hyperclay', copy));
    expect(await readLocalFile(path.join('.hyperclay', copy))).toBe(REMOTE_BYTES);

    expect(await readRecords()).toEqual({
      901: {
        kind: 'both-edited',
        path: 'board.html',
        localChecksum: LOCAL_SUM,
        remoteEtag: REMOTE_ETAG,
        remoteCopy: path.join('.hyperclay', copy),
        detectedAt: expect.any(Number)
      }
    });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.createNode).not.toHaveBeenCalled();
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);

    // `.hyperclay/` is not scanned, so the parked copy is never queued for upload.
    expect([...(await fileOps.getLocalFiles(root)).keys()]).toEqual(['board.html']);
  });

  it('trash-local moves the file into .trash and forgets the node', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    const result = await executeDecision(engine, '901', { action: A.TRASH_LOCAL });

    expect(result).toEqual({ action: A.TRASH_LOCAL, path: 'board.html' });
    expect(await exists('board.html')).toBe(false);
    expect(await readLocalFile(path.join('.trash', 'board.html'))).toBe(LOCAL_BYTES);
    expect(engine.repo.get('901')).toBeUndefined();
  });

  it('delete-remote DELETEs with expectedVersion and drops the baseline', async () => {
    engine.repo.seed([['901', {
      type: 'site',
      path: 'board.html',
      inode: 11,
      remoteEtag: REMOTE_ETAG,
      localChecksum: LOCAL_SUM,
      structureVersion: SV_1,
      checksum: LOCAL_SUM,
      syncedAt: 1
    }]]);
    const result = await executeDecision(engine, '901', { action: A.DELETE_REMOTE });

    expect(result).toEqual({ action: A.DELETE_REMOTE, path: 'board.html' });
    expect(api.deleteNode).toHaveBeenCalledWith(expect.anything(), 901, { expectedVersion: SV_1 });
    expect(engine.repo.get('901')).toBeUndefined();
  });

  it('create-remote POSTs the file the server has never seen', async () => {
    await writeLocalFile('new.html', REMOTE_BYTES);
    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, {
      path: 'new.html',
      type: 'site',
      parentId: 0
    });

    expect(result).toEqual({ action: A.CREATE_REMOTE, nodeId: 1200, etag: REMOTE_ETAG_2 });
    expect(api.createNode).toHaveBeenCalledTimes(1);
    const posted = api.createNode.mock.calls[0][1];
    expect(posted).toEqual({
      type: 'site',
      name: 'new.html',
      parentId: 0,
      content: REMOTE_BYTES,
      modifiedAt: expect.any(Object)
    });
    // A Date from the real fs module is not an instanceof this vm realm's Date.
    expect(Object.prototype.toString.call(posted.modifiedAt)).toBe('[object Date]');
    expect(Number.isNaN(posted.modifiedAt.getTime())).toBe(false);
    expect(engine.repo.getBaseline(1200)).toEqual({
      remoteEtag: REMOTE_ETAG_2,
      localChecksum: REMOTE_ETAG_2,
      structureVersion: 'st3',
      uploadBlocked: false
    });
    expect(engine.repo.get(1200)).toMatchObject({ type: 'site', path: 'new.html', parentId: 0 });
  });

  it('forget drops the entry', async () => {
    await seedSite();
    const result = await executeDecision(engine, '901', { action: A.FORGET });

    expect(result).toEqual({ action: A.FORGET });
    expect(engine.repo.get('901')).toBeUndefined();
  });
});

describe('the conflict store', () => {
  it('412 records a rejected conflict with the server etag and does not retry', async () => {
    await seedSite({ content: '<h1>edited</h1>', remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    const precondition = Object.assign(new Error('Precondition failed'), {
      statusCode: 412,
      code: 'conflict',
      etag: REMOTE_ETAG_2
    });
    api.putNodeContent.mockRejectedValue(precondition);
    api.getNodeContent.mockResolvedValue(remoteContent(REMOTE_BYTES, REMOTE_ETAG_2));

    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(result.action).toBe(A.CONFLICT);
    expect(result.kind).toBe('rejected');
    expect(api.putNodeContent).toHaveBeenCalledTimes(1);
    expect(await readLocalFile('board.html')).toBe('<h1>edited</h1>');

    const records = await readRecords();
    expect(records['901']).toMatchObject({
      kind: 'rejected',
      path: 'board.html',
      localChecksum: checksum('<h1>edited</h1>'),
      remoteEtag: REMOTE_ETAG_2
    });
    expect(await readLocalFile(records['901'].remoteCopy)).toBe(REMOTE_BYTES);
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
  });

  it('local edits do not upload while a record exists', async () => {
    await seedSite({ content: '<h1>edited</h1>', remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(result.action).toBe(A.CONFLICT);
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(await exists(path.join('.hyperclay', 'conflicts', 'board.remote-aaaa1111.html'))).toBe(true);
  });

  it('keep mine uploads with If-Match set to the recorded etag', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });
    api.putNodeContent.mockClear();

    const result = await resolveConflict(engine, { path: 'board.html', choice: 'mine' });

    expect(result).toEqual({ ok: true });
    expect(api.putNodeContent).toHaveBeenCalledTimes(1);
    expect(api.putNodeContent.mock.calls[0][3].ifMatch).toBe(REMOTE_ETAG);
    expect(await readRecords()).toEqual({});
    expect(await exists(path.join('.hyperclay', 'conflicts', 'board.remote-aaaa1111.html'))).toBe(false);
    expect(engine.repo.getBaseline('901')).toMatchObject({ remoteEtag: REMOTE_ETAG_2, localChecksum: REMOTE_ETAG_2 });
    expect(await readLocalFile('board.html')).toBe(LOCAL_BYTES);
  });

  it('keep theirs backs up then overwrites', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    const result = await resolveConflict(engine, { path: 'board.html', choice: 'theirs' });

    expect(result).toEqual({ ok: true });
    expect(backup.seen).toBe(LOCAL_BYTES);
    expect(await readLocalFile('board.html')).toBe(REMOTE_BYTES);
    expect(await readRecords()).toEqual({});
    expect(await exists(path.join('.hyperclay', 'conflicts', 'board.remote-aaaa1111.html'))).toBe(false);
    expect(engine.repo.getBaseline('901')).toEqual({
      remoteEtag: REMOTE_ETAG,
      localChecksum: REMOTE_SUM,
      structureVersion: SV_1,
      uploadBlocked: false
    });
    expect(api.putNodeContent).not.toHaveBeenCalled();
  });

  it('remote frames for a conflicted node only refresh the remote copy', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    const newer = '<h1>theirs again</h1>';
    api.getNodeContent.mockResolvedValue(remoteContent(newer, REMOTE_ETAG_2, 'st3'));
    const result = await executeDecision(engine, '901', { action: A.DOWNLOAD });

    expect(result.action).toBe(A.CONFLICT);
    expect(await readLocalFile('board.html')).toBe(LOCAL_BYTES);

    const records = await readRecords();
    expect(records['901'].remoteEtag).toBe(REMOTE_ETAG_2);
    expect(records['901'].localChecksum).toBe(LOCAL_SUM);
    expect(await readLocalFile(records['901'].remoteCopy)).toBe(newer);
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
  });

  it('a 412 while resolving mine refreshes the record and leaves it open', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'both-edited' });

    api.putNodeContent.mockRejectedValue(Object.assign(new Error('Precondition failed'), {
      statusCode: 412,
      code: 'conflict',
      etag: REMOTE_ETAG_2
    }));
    const newer = '<h1>theirs again</h1>';
    api.getNodeContent.mockResolvedValue(remoteContent(newer, REMOTE_ETAG_2, 'st3'));

    const result = await resolveConflict(engine, { path: 'board.html', choice: 'mine' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('stale-etag');
    const records = await readRecords();
    expect(records['901'].remoteEtag).toBe(REMOTE_ETAG_2);
    expect(await readLocalFile(records['901'].remoteCopy)).toBe(newer);
  });

  it('keep mine on a remote-deleted node POSTs the local bytes', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'remote-deleted' });
    expect((await readRecords())['901']).toMatchObject({ kind: 'remote-deleted', remoteCopy: null });

    const result = await resolveConflict(engine, { path: 'board.html', choice: 'mine' });

    expect(result).toEqual({ ok: true });
    expect(api.putNodeContent).not.toHaveBeenCalled();
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(api.createNode.mock.calls[0][1].content).toBe(LOCAL_BYTES);
    expect(await readRecords()).toEqual({});
    expect(engine.repo.getBaseline(1200)).toMatchObject({ remoteEtag: REMOTE_ETAG_2, localChecksum: REMOTE_ETAG_2 });
  });

  it('keep theirs on a remote-deleted node moves the file to .trash', async () => {
    await seedSite({ content: LOCAL_BYTES, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await executeDecision(engine, '901', { action: A.CONFLICT, conflictKind: 'remote-deleted' });

    const result = await resolveConflict(engine, { path: 'board.html', choice: 'theirs' });

    expect(result).toEqual({ ok: true });
    expect(await exists('board.html')).toBe(false);
    expect(await readLocalFile(path.join('.trash', 'board.html'))).toBe(LOCAL_BYTES);
    expect(await readRecords()).toEqual({});
  });

  it('a name-conflict on create becomes a conflict, never a rename', async () => {
    await writeLocalFile('new.html', LOCAL_BYTES);
    api.createNode.mockRejectedValue(Object.assign(new Error('a node with that name exists'), {
      statusCode: 409,
      code: 'name-conflict'
    }));

    const result = await executeDecision(engine, null, { action: A.CREATE_REMOTE }, { path: 'new.html', type: 'site', parentId: 0 });

    expect(result.action).toBe(A.CONFLICT);
    expect(result.kind).toBe('name-taken');
    expect(api.createNode).toHaveBeenCalledTimes(1);
    expect(api.renameNode).not.toHaveBeenCalled();
    expect(await readLocalFile('new.html')).toBe(LOCAL_BYTES);
    expect((await readRecords())['new.html']).toMatchObject({ kind: 'name-taken', path: 'new.html' });
  });

  it('resolving a path with no record refuses', async () => {
    expect(await resolveConflict(engine, { path: 'board.html', choice: 'mine' })).toEqual({ ok: false, error: 'no-conflict' });
    expect(await resolveConflict(engine, { path: 'board.html', choice: 'sideways' })).toEqual({ ok: false, error: 'bad-choice' });
  });
});

describe('an uncertain outcome refetches before it is judged', () => {
  it('an upload whose answer never arrives advances only when the bytes match', async () => {
    const edited = '<h1>edited</h1>';
    await seedSite({ content: edited, remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    api.putNodeContent.mockRejectedValue(new Error('socket hang up'));
    api.getNodeContent.mockResolvedValue(remoteContent(edited, REMOTE_ETAG_2, 'st2', checksum(edited)));

    const result = await executeDecision(engine, '901', { action: A.UPLOAD });

    expect(result).toEqual({ action: A.UPLOAD, etag: REMOTE_ETAG_2, checksum: REMOTE_ETAG_2, recovered: true });
    expect(engine.repo.getBaseline('901')).toMatchObject({ remoteEtag: REMOTE_ETAG_2, localChecksum: REMOTE_ETAG_2 });
  });

  it('an upload whose refetch shows the old bytes is still an error', async () => {
    await seedSite({ content: '/tmp-not-written', remoteEtag: REMOTE_ETAG, localChecksum: LOCAL_SUM });
    await writeLocalFile('board.html', '<h1>edited</h1>');
    api.putNodeContent.mockRejectedValue(new Error('socket hang up'));
    api.getNodeContent.mockResolvedValue(remoteContent(REMOTE_BYTES, REMOTE_ETAG));

    await expect(executeDecision(engine, '901', { action: A.UPLOAD })).rejects.toThrow('socket hang up');
    expect(engine.repo.getBaseline('901').remoteEtag).toBe(REMOTE_ETAG);
  });
});
