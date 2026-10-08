/**
 * The reconcile applies the server's moves before it decides anything (C3 §5.6,
 * §9): when a teammate renames or moves a folder (or an upload) while this client
 * is offline, the node map still points at the old path. Each pass correlates the
 * move first — the folder pass relocates the directory through `applyRemotePath`
 * (parents first, descendants follow) and the upload pass runs the same
 * `correlateServerFile` the site pass runs — so a node the server moved is moved
 * locally, or restored, and is never deleted on the server. A relocation that
 * fails defers the folder's descendants for the rest of the pass. The control
 * case keeps a plain local delete a delete. Every case runs against the mocked
 * file-operations backed by an in-memory filesystem.
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
const utils = require('../../src/sync-engine/utils');
const apiClient = require('../../src/sync-engine/api-client');
const nodeMapModule = require('../../src/sync-engine/node-map');

jest.mock('../../src/sync-engine/file-operations');
jest.mock('../../src/sync-engine/utils', () => {
  const actual = jest.requireActual('../../src/sync-engine/utils');
  return { ...actual, calculateFileChecksum: jest.fn() };
});
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

const localFile = (rel) => ({ path: `/test/sync/${rel}`, relativePath: rel, mtime: new Date('2024-01-01'), size: 100 });

// A list carrying `complete: true` promises it is the whole inventory; only such
// a list may ever justify a local delete (protocol 2).
function completeList(nodes = []) {
  return Object.assign(nodes, { complete: true });
}

// A listed node: `dir` is the parent's path, so the node's own path is
// `dir ? dir/name : name` (see relPathOf).
const node = (id, type, name, dir, parentId, etag) => (etag === undefined
  ? { id, type, name, path: dir, parentId }
  : { id, type, name, path: dir, parentId, etag });

const localFolder = (rel) => [rel, { fullPath: `/test/sync/${rel}` }];

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
  syncEngine.isRunning = true;
  syncEngine.repo.seed();
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
  fileOps.writeFileBuffer.mockResolvedValue();
  fileOps.moveFile.mockResolvedValue();
  fileOps.readFile.mockResolvedValue('<html>content</html>');
  fileOps.readFileBuffer.mockImplementation(async (filePath) => Buffer.from(await fileOps.readFile(filePath)));
  fileOps.calculateBufferChecksum.mockImplementation(realBufferChecksum);
  utils.calculateFileChecksum.mockImplementation(async (filePath) => fileOps.calculateBufferChecksum(await fileOps.readFileBuffer(filePath)));
  fileOps.fileExists.mockResolvedValue(true);
  fileOps.getFileStats.mockResolvedValue({ mtime: new Date('2024-01-01'), size: 100 });
  fileOps.getLocalFiles.mockResolvedValue(new Map());
  fileOps.getLocalUploads.mockResolvedValue(new Map());
  fileOps.getLocalFolders.mockResolvedValue(new Map());

  nodeMapModule.load.mockResolvedValue(new Map());
  nodeMapModule.save.mockResolvedValue();
  nodeMapModule.getInode.mockResolvedValue(12345);

  apiClient.listNodes.mockResolvedValue(completeList([]));
  apiClient.deleteNode.mockResolvedValue({ success: true });
  apiClient.renameNode.mockResolvedValue({ success: true });
  apiClient.getNodeContent.mockResolvedValue({
    content: '<html>server</html>',
    nodeType: 'site',
    etag: 'etag-new',
    checksum: 'etag-new',
    modifiedAt: '2024-06-01T00:00:00Z'
  });

  // The executor stat()s the local file for the modifiedAt it stamps on a
  // server write; the suite mocks file-operations, so this is mocked with it.
  jest.spyOn(require('fs').promises, 'stat').mockResolvedValue(STUB_STAT);
});

// The directory scan missed it and a stat proves it is really gone.
function gone() {
  fileOps.getFileStats.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
}
const ROOT = '/test/sync/';
const rel = (a) => { const abs = a.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''); return abs.startsWith(ROOT) ? abs.slice(ROOT.length) : (abs === '/test/sync' ? '' : abs); };
const cs = (c) => realBufferChecksum(Buffer.from(c));
let files, dirs;
function parentsOf(r) { const out = []; const parts = r.split('/'); for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/')); return out; }
function fsInit(fileMap) {
  files = new Map(Object.entries(fileMap));
  dirs = new Set();
  for (const f of files.keys()) parentsOf(f).forEach(d => dirs.add(d));
}
function mkdirs(r) { if (!r) return; dirs.add(r); parentsOf(r).forEach(d => dirs.add(d)); }
function installFs() {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  fileOps.fileExists.mockImplementation((a) => rel(a) === '' || files.has(rel(a)) || dirs.has(rel(a)));
  fileOps.getFileStats.mockImplementation(async (a) => {
    const r = rel(a);
    if (dirs.has(r)) return { isDirectory: () => true, mtime: new Date(), size: 0 };
    if (files.has(r)) return { isDirectory: () => false, mtime: new Date(), size: 1 };
    throw enoent();
  });
  fileOps.ensureDirectory.mockImplementation(async (a) => mkdirs(rel(a)));
  fileOps.readFile.mockImplementation(async (a) => { if (!files.has(rel(a))) throw enoent(); return files.get(rel(a)); });
  fileOps.readFileBuffer.mockImplementation(async (a) => { if (!files.has(rel(a))) throw enoent(); return Buffer.from(files.get(rel(a))); });
  fileOps.writeFile.mockImplementation(async (a, c) => { files.set(rel(a), String(c)); mkdirs(parentsOf(rel(a)).pop()); });
  fileOps.writeFileBuffer.mockImplementation(async (a, c) => { files.set(rel(a), c.toString()); mkdirs(parentsOf(rel(a)).pop()); });
  fileOps.deleteFile.mockImplementation(async (a) => { files.delete(rel(a)); });
  fileOps.moveFile.mockImplementation(async (s, d) => {
    const rs = rel(s), rd = rel(d);
    mkdirs(parentsOf(rd).pop());
    if (files.has(rs)) { files.set(rd, files.get(rs)); files.delete(rs); return; }
    if (!dirs.has(rs)) throw enoent();
    for (const [f, c] of [...files]) if (f.startsWith(rs + '/')) { files.delete(f); files.set(rd + f.slice(rs.length), c); }
    for (const x of [...dirs]) if (x === rs || x.startsWith(rs + '/')) { dirs.delete(x); dirs.add(rd + x.slice(rs.length)); }
  });
  const isSite = (f) => /\.(html|htmlclay)$/i.test(f);
  fileOps.getLocalFiles.mockImplementation(async () => new Map([...files.keys()].filter(isSite).map(f => [f, localFile(f)])));
  fileOps.getLocalUploads.mockImplementation(async () => new Map([...files.keys()].filter(f => !isSite(f)).map(f => [f, localFile(f)])));
  fileOps.getLocalFolders.mockImplementation(async () => new Map([...dirs].map(d => [d, { fullPath: ROOT + d }])));
  nodeMapModule.getInode.mockImplementation(async (a) => 1000 + rel(a).length);
  apiClient.getNodeContent.mockImplementation(async (conn, id) => {
    const n = server.find(x => x.id === id);
    return { content: n.content, nodeType: n.type, etag: cs(n.content), checksum: cs(n.content), modifiedAt: '2024-06-01T00:00:00Z' };
  });
  apiClient.listNodes.mockImplementation(async () => inv());
  apiClient.putNodeContent.mockImplementation(async (conn, id, content) => { const n = server.find(x => x.id === id); n.content = content.toString(); n.etag = cs(n.content); return { etag: n.etag }; });
  apiClient.createNode.mockImplementation(async (conn, body) => { const id = 500 + server.length; const c = body.content ? body.content.toString() : ''; server.push({ id, type: body.type || 'upload', name: body.name, path: (() => { const par = server.find(n => n.id === body.parentId); return par ? (par.path ? par.path + '/' + par.name : par.name) : ''; })(), parentId: body.parentId, etag: cs(c), content: c }); return { id, etag: cs(c) }; });
  apiClient.createFolder && apiClient.createFolder.mockImplementation(async (conn, name, parentId) => { const id = 700 + server.length; server.push({ id, type: 'folder', name, path: '', parentId }); return { id, node: { id } }; });
  apiClient.deleteNode.mockImplementation(async (conn, id) => { server = server.filter(n => n.id !== id); return { success: true }; });
}
let server;
const sv = (id, type, name, dir, parentId, content) => ({ ...node(id, type, name, dir, parentId, content === undefined ? undefined : cs(content)), content });
const inv = () => completeList(server.map(({ content, ...n }) => ({ ...n })));
const base = (type, p, parentId, content) => ({ type, path: p, parentId, inode: 1000 + p.length, ...(content === undefined ? {} : { remoteEtag: cs(content), localChecksum: cs(content) }) });

function spyPlans() {
  const plans = [];
  const orig = syncEngine.runPlan.bind(syncEngine);
  syncEngine.runPlan = async (plan) => { plans.push(...plan.filter(i => i.decision.action !== 'noop').map(i => `${i.type}#${i.nodeId}@${i.path}:${i.decision.action}`)); return orig(plan); };
  return plans;
}
async function pass() {
  jest.clearAllMocks(); installFs();
  const plans = spyPlans();
  await syncEngine.reconcileAll(inv(), { generation: 1 });
  return plans;
}

const disk = () => [...files.keys()].sort();
const diskDirs = () => [...dirs].sort();
const moves = () => fileOps.moveFile.mock.calls.map(([s, d]) => [rel(s), rel(d)]);
const ensured = () => fileOps.ensureDirectory.mock.calls.map(([d]) => rel(d));
const mapPaths = () => Object.fromEntries([...syncEngine.repo].map(([id, entry]) => [id, entry.path]));

describe('a teammate moved a node while this client was offline', () => {
  beforeEach(() => { syncEngine.lastSyncedAt = Date.now(); });

  test('a renamed folder moves as a directory and its upload is not deleted', async () => {
    syncEngine.repo.seed([
      ['10', base('folder', 'proj', null)],
      ['11', base('site', 'proj/page.html', 10, 'P')],
      ['13', base('upload', 'proj/x.png', 10, 'X')]
    ]);
    fsInit({ 'proj/page.html': 'P', 'proj/x.png': 'X' });
    server = [sv(10, 'folder', 'proj2', '', 0), sv(11, 'site', 'page.html', 'proj2', 10, 'P'), sv(13, 'upload', 'x.png', 'proj2', 10, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(mapPaths()).toEqual({ 10: 'proj2', 11: 'proj2/page.html', 13: 'proj2/x.png' });
    expect(disk()).toEqual(['proj2/page.html', 'proj2/x.png']);
    expect(moves()).toEqual([['proj', 'proj2']]);
    expect(ensured()).not.toContain('proj2');

    const second = await pass();

    expect(second).toEqual([]);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(disk()).toEqual(['proj2/page.html', 'proj2/x.png']);
    expect(diskDirs()).toEqual(['proj2']);
    expect(mapPaths()).toEqual({ 10: 'proj2', 11: 'proj2/page.html', 13: 'proj2/x.png' });
  });

  test('an untracked offline file in the renamed folder lands under the new name', async () => {
    syncEngine.repo.seed([
      ['10', base('folder', 'proj', null)],
      ['11', base('site', 'proj/page.html', 10, 'P')],
      ['13', base('upload', 'proj/x.png', 10, 'X')]
    ]);
    fsInit({ 'proj/page.html': 'P', 'proj/x.png': 'X', 'proj/new.css': 'N' });
    server = [sv(10, 'folder', 'proj2', '', 0), sv(11, 'site', 'page.html', 'proj2', 10, 'P'), sv(13, 'upload', 'x.png', 'proj2', 10, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(disk()).toEqual(['proj2/new.css', 'proj2/page.html', 'proj2/x.png']);
    expect(diskDirs()).toEqual(['proj2']);
    expect(mapPaths()['503']).toBe('proj2/new.css');
    expect(apiClient.createNode.mock.calls.map(([, body]) => body)).toContainEqual(
      expect.objectContaining({ type: 'upload', name: 'new.css', parentId: 10 })
    );
  });

  test('an upload the server renamed is moved locally, not deleted', async () => {
    syncEngine.repo.seed([['13', base('upload', 'x.png', null, 'X')]]);
    fsInit({ 'x.png': 'X' });
    server = [sv(13, 'upload', 'y.png', '', 0, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(moves()).toEqual([['x.png', 'y.png']]);
    expect(disk()).toEqual(['y.png']);
    expect(mapPaths()).toEqual({ 13: 'y.png' });
  });

  test('an upload the server moved to another folder follows it there', async () => {
    syncEngine.repo.seed([['1', base('folder', 'a', null)], ['2', base('folder', 'b', null)], ['13', base('upload', 'a/x.png', 1, 'X')]]);
    fsInit({ 'a/x.png': 'X' }); mkdirs('b');
    server = [sv(1, 'folder', 'a', '', 0), sv(2, 'folder', 'b', '', 0), sv(13, 'upload', 'x.png', 'b', 2, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(moves()).toEqual([['a/x.png', 'b/x.png']]);
    expect(disk()).toEqual(['b/x.png']);
    expect(mapPaths()).toEqual({ 1: 'a', 2: 'b', 13: 'b/x.png' });
  });

  test('a folder moved under a new parent takes its nested subtree with it', async () => {
    syncEngine.repo.seed([
      ['9', base('folder', 'other', null)], ['10', base('folder', 'proj', null)], ['12', base('folder', 'proj/sub', 10)],
      ['11', base('site', 'proj/sub/page.html', 12, 'P')], ['13', base('upload', 'proj/sub/x.png', 12, 'X')]
    ]);
    fsInit({ 'proj/sub/page.html': 'P', 'proj/sub/x.png': 'X' }); mkdirs('other');
    server = [sv(9, 'folder', 'other', '', 0), sv(10, 'folder', 'proj', 'other', 9), sv(12, 'folder', 'sub', 'other/proj', 10),
      sv(11, 'site', 'page.html', 'other/proj/sub', 12, 'P'), sv(13, 'upload', 'x.png', 'other/proj/sub', 12, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(moves()).toEqual([['proj', 'other/proj']]);
    expect(disk()).toEqual(['other/proj/sub/page.html', 'other/proj/sub/x.png']);
    expect(mapPaths()).toEqual({
      9: 'other', 10: 'other/proj', 11: 'other/proj/sub/page.html', 12: 'other/proj/sub', 13: 'other/proj/sub/x.png'
    });

    const second = await pass();

    expect(second).toEqual([]);
    expect(moves()).toEqual([]);
    expect(disk()).toEqual(['other/proj/sub/page.html', 'other/proj/sub/x.png']);
  });

  test('a renamed parent and a moved child are both applied in one pass', async () => {
    syncEngine.repo.seed([
      ['10', base('folder', 'proj', null)], ['12', base('folder', 'proj/sub', 10)],
      ['13', base('upload', 'proj/sub/x.png', 12, 'X')], ['14', base('upload', 'proj/y.png', 10, 'Y')]
    ]);
    fsInit({ 'proj/sub/x.png': 'X', 'proj/y.png': 'Y' });
    server = [sv(10, 'folder', 'proj2', '', 0), sv(12, 'folder', 'sub', '', 0), sv(13, 'upload', 'x.png', 'sub', 12, 'X'), sv(14, 'upload', 'y.png', 'proj2', 10, 'Y')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(moves()).toEqual([['proj', 'proj2'], ['proj2/sub', 'sub']]);
    expect(disk()).toEqual(['proj2/y.png', 'sub/x.png']);
    expect(mapPaths()).toEqual({ 10: 'proj2', 12: 'sub', 13: 'sub/x.png', 14: 'proj2/y.png' });

    const second = await pass();

    expect(second).toEqual([]);
    expect(moves()).toEqual([]);
    expect(disk()).toEqual(['proj2/y.png', 'sub/x.png']);
  });

  test('a folder the user deleted, which a teammate moved, is restored under the new name', async () => {
    syncEngine.repo.seed([
      ['10', base('folder', 'proj', null)], ['11', base('site', 'proj/page.html', 10, 'P')], ['13', base('upload', 'proj/x.png', 10, 'X')]
    ]);
    fsInit({});
    server = [sv(10, 'folder', 'proj2', '', 0), sv(11, 'site', 'page.html', 'proj2', 10, 'P'), sv(13, 'upload', 'x.png', 'proj2', 10, 'X')];

    const plans = await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(plans).toEqual(expect.arrayContaining([
      'folder#10@proj2:download', 'site#11@proj2/page.html:download', 'upload#13@proj2/x.png:download'
    ]));
    expect(disk()).toEqual(['proj2/page.html', 'proj2/x.png']);
    expect(moves()).toEqual([]);
    expect(mapPaths()).toEqual({ 10: 'proj2', 11: 'proj2/page.html', 13: 'proj2/x.png' });
  });

  test('a file the server renamed and the user deleted is downloaded, for a site and an upload', async () => {
    syncEngine.repo.seed([['13', base('upload', 'x.png', null, 'X')], ['11', base('site', 'a.html', null, 'P')]]);
    fsInit({});
    server = [sv(13, 'upload', 'y.png', '', 0, 'X'), sv(11, 'site', 'b.html', '', 0, 'P')];

    const plans = await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(plans).toEqual(expect.arrayContaining(['site#11@b.html:download', 'upload#13@y.png:download']));
    expect(disk()).toEqual(['b.html', 'y.png']);
    expect(mapPaths()).toEqual({ 11: 'b.html', 13: 'y.png' });
  });

  test('an offline edit under a renamed folder is uploaded to the moved node, not deleted', async () => {
    syncEngine.repo.seed([['10', base('folder', 'proj', null)], ['13', base('upload', 'proj/x.png', 10, 'X')]]);
    fsInit({ 'proj/x.png': 'X-edited' });
    server = [sv(10, 'folder', 'proj2', '', 0), sv(13, 'upload', 'x.png', 'proj2', 10, 'X')];

    const plans = await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(moves()).toEqual([['proj', 'proj2']]);
    expect(disk()).toEqual(['proj2/x.png']);
    expect(files.get('proj2/x.png')).toBe('X-edited');
    expect(mapPaths()).toEqual({ 10: 'proj2', 13: 'proj2/x.png' });
    expect(plans).toContain('upload#13@proj2/x.png:upload');
    expect(apiClient.putNodeContent).toHaveBeenCalledTimes(1);
    const [, id, content, options] = apiClient.putNodeContent.mock.calls[0];
    expect(id).toBe(13);
    expect(content.toString()).toBe('X-edited');
    expect(options.ifMatch).toBe(cs('X'));
  });

  test('a folder whose new path is already occupied keeps both copies', async () => {
    syncEngine.repo.seed([['10', base('folder', 'proj', null)], ['13', base('upload', 'proj/x.png', 10, 'X')]]);
    fsInit({ 'proj/x.png': 'X', 'proj2/mine.txt': 'M' });
    server = [sv(10, 'folder', 'proj2', '', 0), sv(13, 'upload', 'x.png', 'proj2', 10, 'X')];

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(disk()).toContain('proj2/x.png');
    expect(disk()).toContain('proj2 (conflicted copy)/mine.txt');
    expect(mapPaths()).toEqual(expect.objectContaining({ 10: 'proj2', 13: 'proj2/x.png' }));
  });

  test('the control case: an untouched local delete is still sent', async () => {
    syncEngine.repo.seed([['13', base('upload', 'x.png', null, 'X')]]);
    fsInit({});
    server = [sv(13, 'upload', 'x.png', '', 0, 'X')];

    await pass();

    expect(apiClient.deleteNode).toHaveBeenCalledTimes(1);
    expect(apiClient.deleteNode.mock.calls[0][1]).toBe(13);
    expect(disk()).toEqual([]);
    expect(mapPaths()).toEqual({});
  });
});

describe("a teammate's folder rename this disk made offline", () => {
  beforeEach(() => { syncEngine.lastSyncedAt = Date.now(); });

  const withInodes = async (inodes) => {
    jest.clearAllMocks(); installFs();
    nodeMapModule.getInode.mockImplementation(async (a) => (rel(a) in inodes ? inodes[rel(a)] : 1000 + rel(a).length));
    const plans = spyPlans();
    await syncEngine.reconcileAll(inv(), { generation: 1 });
    return plans;
  };

  test("a teammate's new folder under a locally renamed folder lands under the new name", async () => {
    syncEngine.repo.seed([['1', { type: 'folder', path: 'a', parentId: null, inode: 222 }]]);
    fsInit({}); mkdirs('a2');
    server = [sv(1, 'folder', 'a', '', 0), sv(20, 'folder', 'new', 'a', 1)];

    await withInodes({ a2: 222 });

    expect(apiClient.renameNode).toHaveBeenCalledTimes(1);
    expect(apiClient.renameNode.mock.calls[0].slice(1, 3)).toEqual([1, 'a2']);
    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(diskDirs()).toEqual(['a2']);
    expect(disk().some(p => p.includes('conflicted copy'))).toBe(false);

    server = [sv(1, 'folder', 'a2', '', 0), sv(20, 'folder', 'new', 'a2', 1)];

    await withInodes({ a2: 222 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(diskDirs()).toEqual(['a2', 'a2/new']);
    expect(mapPaths()).toEqual({ 1: 'a2', 20: 'a2/new' });
    expect(disk().some(p => p.includes('conflicted copy'))).toBe(false);
    expect(diskDirs().some(p => p.includes('conflicted copy'))).toBe(false);
  });
});

describe('a server move this disk cannot follow', () => {
  beforeEach(() => { syncEngine.lastSyncedAt = Date.now(); });

  test('a failed folder move leaves its whole subtree in place, then converges', async () => {
    syncEngine.repo.seed([
      ['10', base('folder', 'proj', null)], ['12', base('folder', 'proj/sub', 10)],
      ['13', base('upload', 'proj/sub/x.png', 12, 'X')], ['11', base('site', 'proj/t.html', 10, 'T')]
    ]);
    fsInit({ 'proj/t.html': 'T', 'proj/sub/x.png': 'X' });
    server = [
      sv(10, 'folder', 'proj2', '', 0), sv(12, 'folder', 'sub', 'proj2', 10),
      sv(13, 'upload', 'x.png', 'proj2/sub', 12, 'X'), sv(11, 'site', 't.html', 'proj2', 10, 'T')
    ];
    jest.clearAllMocks(); installFs();
    const realMove = fileOps.moveFile.getMockImplementation();
    let failed = false;
    fileOps.moveFile.mockImplementation(async (s, d) => {
      if (!failed && rel(s) === 'proj' && rel(d) === 'proj2') {
        failed = true;
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      }
      return realMove(s, d);
    });
    spyPlans();

    await syncEngine.reconcileAll(inv(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(disk()).toEqual(['proj/sub/x.png', 'proj/t.html']);
    expect(diskDirs()).toEqual(['proj', 'proj/sub']);
    expect(disk().some(p => p.startsWith('proj2'))).toBe(false);

    await pass();

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.createNode).not.toHaveBeenCalled();
    expect(disk()).toEqual(['proj2/sub/x.png', 'proj2/t.html']);
    expect(diskDirs()).toEqual(['proj2', 'proj2/sub']);
    expect(mapPaths()).toEqual({ 10: 'proj2', 11: 'proj2/t.html', 12: 'proj2/sub', 13: 'proj2/sub/x.png' });
    expect(disk().concat(diskDirs()).some(p => p.includes('conflicted copy'))).toBe(false);
  });

  test('a failed relocation deletes nothing and never renames the node back', async () => {
    syncEngine.repo.seed([['13', base('upload', 'x.png', null, 'X')]]);
    fsInit({ 'x.png': 'X' });
    server = [sv(13, 'upload', 'y.png', '', 0, 'X')];
    jest.clearAllMocks(); installFs();
    fileOps.moveFile.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));

    const plans = spyPlans();
    await syncEngine.reconcileAll(inv(), { generation: 1 });

    expect(apiClient.deleteNode).not.toHaveBeenCalled();
    expect(apiClient.renameNode).not.toHaveBeenCalled();
    expect(plans).toContain('upload#13@y.png:download');
    expect(disk()).toEqual(['x.png', 'y.png']);
    expect(files.get('x.png')).toBe('X');
    expect(mapPaths()['13']).toBe('y.png');
  });
});
