/**
 * The catch-up pass's structure step on a real disk.
 *
 * These port the folder-pass cases that used to be decided from mocked scans:
 * the pass now diffs the ledger against a real snapshot of a temp root, so the
 * pairing it sends — a rename by inode, a move into a new folder, the rename
 * back of the locked uploads folder — is the pairing the disk itself proves.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => s }
}));

jest.mock('eventsource', () => ({ EventSource: jest.fn() }));

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

jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/sync-engine/file-operations', () => jest.requireActual('../../src/sync-engine/file-operations'));
jest.mock('../../src/sync-engine/node-map', () => jest.requireActual('../../src/sync-engine/node-map'));

const fsSync = require('fs');
const os = require('os');
const nodePath = require('path');
const api = require('../../src/sync-engine/api-client');
const fsScenario = require('../helpers/fs-scenario');
const { FakeServer, install } = require('../helpers/sync-fake-server');

jest.setTimeout(30000);

const MUTATIONS = ['renameNode', 'moveNode', 'deleteNode', 'createNode'];

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function drain(turns = 6) {
  for (let i = 0; i < turns; i++) await tick();
}

function makeEngine(root, metaDir, ledger) {
  let engine;
  jest.isolateModules(() => {
    const { SyncEngine } = require('../../src/sync-engine/index');
    engine = new SyncEngine();
  });
  engine.isRunning = true;
  engine.serverUrl = 'http://test';
  engine.apiKey = 'test-key';
  engine.syncFolder = root;
  engine.metaDir = metaDir;
  engine.lastSyncedAt = Date.now();
  engine.repo.seed(ledger);
  engine.runner = { start: jest.fn(), state: 'live' };
  return engine;
}

const roots = [];

function setup({ tree, ids, extraNodes = [] }) {
  const baseDir = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'catchup-'));
  roots.push(baseDir);
  const root = fsScenario.mkroot(tree, baseDir);
  const metaDir = fsSync.mkdtempSync(nodePath.join(baseDir, 'meta-'));
  const ledger = fsScenario.ledgerFor(root, ids);
  const server = new FakeServer([...fsScenario.serverNodesFor(root, ids), ...extraNodes]);
  install(api, server);
  const engine = makeEngine(root, metaDir, ledger);
  return { root, metaDir, ledger, server, engine };
}

const callsNamed = (server, name) => server.calls.filter((call) => call.name === name);
const idsOf = (server, name) => callsNamed(server, name).map((call) => call.nodeId);
const mutationsOf = (server) => server.calls.filter((call) => MUTATIONS.includes(call.name));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  while (roots.length) fsSync.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('a catch-up pass on a real disk relocates by inode', () => {
  test('an offline file rename is sent as one rename and keeps its node id', async () => {
    const { root, engine, server } = setup({
      tree: { 'work/page.html': '<p>w</p>' },
      ids: { 20: 'work', 21: 'work/page.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'work', 'page.html'), nodePath.join(root, 'work', 'index.html'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[21, 'index.html']]);
    expect(mutationsOf(server).map((call) => call.name)).toEqual(['renameNode']);
    expect(engine.repo.get('21').path).toBe('work/index.html');
  });

  test('an offline file move to the root is sent as one move and keeps its node id', async () => {
    const { root, engine, server } = setup({
      tree: { 'work/page.html': '<p>w</p>' },
      ids: { 20: 'work', 21: 'work/page.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'work', 'page.html'), nodePath.join(root, 'page.html'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(mutationsOf(server).map((call) => [call.name, call.nodeId])).toEqual([['moveNode', 21]]);
    expect(server.relPathOf(21)).toBe('page.html');
    expect(engine.repo.get('21').path).toBe('page.html');
  });

  test('a lookalike with the same bytes but a new inode is a new file, and the original is deleted', async () => {
    const { root, engine, server } = setup({
      tree: { 'work/page.html': '<p>w</p>' },
      ids: { 20: 'work', 21: 'work/page.html' }
    });

    fsSync.rmSync(nodePath.join(root, 'work', 'page.html'));
    fsSync.writeFileSync(nodePath.join(root, 'work', 'copy.html'), '<p>w</p>');
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(callsNamed(server, 'renameNode')).toEqual([]);
    expect(idsOf(server, 'deleteNode')).toEqual([21]);
    expect(callsNamed(server, 'createNode').map((call) => call.args[0])).toEqual(['copy.html']);
  });

  test('an offline folder rename is sent by inode and re-points its descendants', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/page.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/page.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[10, 'renamed']]);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(engine.repo.get('10').path).toBe('renamed');
    expect(engine.repo.get('11').path).toBe('renamed/page.html');
  });

  test('a failed rename never falls through to a delete', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/page.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/page.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
    api.renameNode.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));

    await engine.reconcileAll(server.inventory(), { generation: 1 }).catch(() => {});
    await drain();

    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(idsOf(server, 'getNodeContent')).not.toContain(11);
    expect(callsNamed(server, 'createNode')).toEqual([]);
    expect(engine.repo.get('10').path).toBe('proj');
  });

  test('a subfolder moves with its renamed parent', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/sub/p.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/sub', 12: 'proj/sub/p.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[10, 'renamed']]);
    expect(callsNamed(server, 'moveNode')).toEqual([]);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(engine.repo.get('11').path).toBe('renamed/sub');
    expect(engine.repo.get('12').path).toBe('renamed/sub/p.html');
  });

  test('a failed parent rename leaves the children alone', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/sub/p.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/sub', 12: 'proj/sub/p.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
    api.renameNode.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));

    await engine.reconcileAll(server.inventory(), { generation: 1 }).catch(() => {});
    await drain();

    expect(api.renameNode.mock.calls.map((call) => call.slice(1, 3))).toEqual([[10, 'renamed']]);
    expect(callsNamed(server, 'moveNode')).toEqual([]);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(engine.repo.get('11').path).toBe('proj/sub');
    expect(engine.repo.get('12').path).toBe('proj/sub/p.html');
  });

  test('a move into a new local folder creates it on the server first', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/page.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/page.html' }
    });

    fsSync.mkdirSync(nodePath.join(root, 'archive'));
    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'archive/proj'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    const created = callsNamed(server, 'createNode').find((call) => call.args[0] === 'archive');
    const moved = callsNamed(server, 'moveNode')[0];
    expect(created).toBeDefined();
    expect(server.calls.indexOf(created)).toBeLessThan(server.calls.indexOf(moved));
    expect([moved.nodeId, moved.args[1]]).toEqual([10, created.nodeId]);
    expect(engine.repo.get('10').path).toBe('archive/proj');
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
  });

  test('a 401 on the relocation send ends the pass', async () => {
    const { root, engine, server } = setup({
      tree: { 'proj/sub/p.html': '<p>p</p>' },
      ids: { 10: 'proj', 11: 'proj/sub', 12: 'proj/sub/p.html' }
    });

    fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
    api.renameNode.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { statusCode: 401 }));

    const pass = engine.reconcileAll(server.inventory(), { generation: 1 }).then(
      () => null,
      (error) => error
    );
    const rejected = await pass;
    await drain();

    expect(mutationsOf(server)).toEqual([]);
    expect(rejected).toMatchObject({ statusCode: 401 });
  });
});

describe('a catch-up pass on a real disk restores the locked uploads folder', () => {
  test('an uploads folder renamed while the app was closed is renamed back on disk', async () => {
    const { root, engine, server } = setup({
      tree: { 'uploads/assets-a/x.png': 'x' },
      ids: { 10: 'uploads', 11: 'uploads/assets-a', 12: 'uploads/assets-a/x.png' }
    });

    fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'uploads-old'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(fsSync.existsSync(nodePath.join(root, 'uploads/assets-a/x.png'))).toBe(true);
    expect(fsSync.existsSync(nodePath.join(root, 'uploads-old'))).toBe(false);
    expect(idsOf(server, 'renameNode')).toEqual([]);
    expect(idsOf(server, 'moveNode')).toEqual([]);
    expect(idsOf(server, 'deleteNode')).toEqual([]);
  });
});

describe("a teammate's folder under a locally renamed folder", () => {
  test("a teammate's new folder under a locally renamed folder lands under the new name", async () => {
    const { root, engine, server } = setup({
      tree: { a: null },
      ids: { 1: 'a' },
      extraNodes: [{ id: 20, type: 'folder', name: 'new', parentId: 1 }]
    });

    fsSync.renameSync(nodePath.join(root, 'a'), nodePath.join(root, 'a2'));
    await engine.reconcileAll(server.inventory(), { generation: 1 });
    await drain();

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[1, 'a2']]);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(callsNamed(server, 'createNode')).toEqual([]);
    expect(fsSync.existsSync(nodePath.join(root, 'a2/new'))).toBe(true);
    expect(engine.repo.get('1').path).toBe('a2');
    expect(engine.repo.get('20').path).toBe('a2/new');
  });
});
