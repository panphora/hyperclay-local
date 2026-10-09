/**
 * The structure job.
 *
 * Real temp roots, a real disk snapshot, the ledger seeded from the real
 * inodes, and the fake server standing in for /sync/nodes. Every case drives the
 * job the way the watcher will in step 5: markDirty, the quiet window, then the
 * lane.
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

jest.mock('../../src/sync-engine/file-operations', () => {
  const real = jest.requireActual('../../src/sync-engine/file-operations');
  const { seams } = require('../helpers/fs-scenario');
  const delayed = (fn) => async (...args) => {
    await seams.wait();
    return fn(...args);
  };
  return {
    ...real,
    readFile: delayed(real.readFile),
    readFileBuffer: delayed(real.readFileBuffer)
  };
});

jest.mock('../../src/sync-engine/node-map', () => {
  const real = jest.requireActual('../../src/sync-engine/node-map');
  const { seams } = require('../helpers/fs-scenario');
  return {
    ...real,
    getInode: jest.fn(async (filePath) => {
      await seams.wait();
      if (seams.inodeAlias.has(filePath)) return seams.inodeAlias.get(filePath);
      return real.getInodeSync(filePath);
    }),
    save: jest.fn(async () => {
      await seams.wait();
    }),
    saveState: jest.fn(async () => {
      await seams.wait();
    }),
    saveTombstones: jest.fn(async () => {
      await seams.wait();
    }),
    loadTombstones: jest.fn(async () => new Map())
  };
});

const fsSync = require('fs');
const os = require('os');
const nodePath = require('path');
const api = require('../../src/sync-engine/api-client');
const fsScenario = require('../helpers/fs-scenario');
const { FakeServer, install } = require('../helpers/sync-fake-server');
const { getInodeSync } = require('../../src/sync-engine/node-map');

jest.setTimeout(30000);

const tick = () => new Promise((resolve) => setImmediate(resolve));

const BASE_TREE = {
  'uploads/assets-a/x.png': 'x',
  'work/page.html': '<p>w</p>'
};

const BASE_IDS = {
  10: 'uploads',
  11: 'uploads/assets-a',
  12: 'uploads/assets-a/x.png',
  20: 'work',
  21: 'work/page.html'
};

const QUIET_MS = 500;
const HOLD_MS = 3000;

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
  engine.runner = { start: jest.fn(), pause: jest.fn(), state: 'live' };
  return engine;
}

const roots = [];

function setup({ tree = BASE_TREE, ids = BASE_IDS } = {}) {
  const baseDir = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'structure-'));
  roots.push(baseDir);
  const root = fsScenario.mkroot(tree, baseDir);
  const metaDir = fsSync.mkdtempSync(nodePath.join(baseDir, 'meta-'));
  const ledger = fsScenario.ledgerFor(root, ids);
  const server = new FakeServer(fsScenario.serverNodesFor(root, ids));
  install(api, server);
  const engine = makeEngine(root, metaDir, ledger);
  return { root, metaDir, ledger, server, engine };
}

/** Drive one job: the quiet window, then the lane. */
async function runJob(engine) {
  jest.advanceTimersByTime(QUIET_MS);
  await engine._lane;
}

async function runWake(engine) {
  jest.advanceTimersByTime(HOLD_MS);
  await engine._lane;
}

async function drainQueue(engine) {
  for (let i = 0; i < 6; i += 1) {
    jest.advanceTimersByTime(2000);
    await engine._lane;
    await tick();
  }
}

const callsNamed = (server, name) => server.calls.filter((call) => call.name === name);
const idsOf = (server, name) => callsNamed(server, name).map((call) => call.nodeId);

function errorsOf(engine) {
  const events = [];
  engine.on('sync-error', (event) => events.push(event));
  return events;
}

function massTree() {
  const tree = { 'uploads/assets-m': null };
  const ids = { 10: 'uploads', 60: 'uploads/assets-m' };
  for (let i = 0; i < 25; i += 1) {
    const name = `m${String(i).padStart(2, '0')}.png`;
    tree[`uploads/assets-m/${name}`] = `m-${i}`;
    ids[61 + i] = `uploads/assets-m/${name}`;
  }
  return { tree, ids };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  while (roots.length) fsSync.rmSync(roots.pop(), { recursive: true, force: true });
});

test('review: catchup preserves mass-delete hold until user chooses', async () => {
  const { root, engine, server } = setup(massTree());
  fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
  engine.markDirty('uploads/assets-m');
  await runJob(engine);
  await runWake(engine);
  expect(engine._structureState().massDelete.files).toBe(25);
  await engine.reconcileAll(server.inventory(), { generation: 1 });
  expect({ downloads: callsNamed(server, 'getNodeContent').length,
    folderRestored: fsSync.existsSync(nodePath.join(root, 'uploads/assets-m'))
  }).toEqual({ downloads: 0, folderRestored: false });
});

test('review: live folder deletion preserves new remote child under protocol 2', async () => {
  const { root, engine, server } = setup();
  engine.protocol = 2;
  fsSync.rmSync(nodePath.join(root, 'work'), { recursive: true });
  engine.markDirty('work');
  await runJob(engine);
  await server.createNode(null, { type: 'site', name: 'teammate.html', parentId: 20, content: '<p>new remote work</p>' });
  server.get(20).version++;
  await runWake(engine);
  expect({ calls: api.deleteNode.mock.calls.map(c => [c[1], c[2]]),
    newRemoteFileSurvived: server.hasPath('work/teammate.html')
  }).toEqual({ calls: [], newRemoteFileSurvived: true });
});

test('review: live file deletion preserves remotely edited content on protocol 1', async () => {
  const { root, engine, server } = setup();
  fsSync.rmSync(nodePath.join(root, 'work/page.html'));
  engine.markDirty('work/page.html');
  await runJob(engine);
  await server.putNodeContent(null, 21, '<p>new remote work</p>');
  await runWake(engine);
  expect(idsOf(server, 'deleteNode')).toEqual([]);
  expect(server.get(21)).not.toBeNull();
});

test('review: renamed and edited file uploads its new content', async () => {
  const { root, engine, server } = setup();
  fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
  fsSync.writeFileSync(nodePath.join(root, 'work/page2.html'), '<p>edited</p>');
  engine._dispatchRaw('unlink', 'work/page.html');
  engine._dispatchRaw('add', 'work/page2.html');
  engine._dispatchRaw('change', 'work/page2.html');
  await runJob(engine);
  jest.advanceTimersByTime(1000);
  await engine.whenQueueEmpty();
  expect(server.relPathOf(21)).toBe('work/page2.html');
  expect(server.get(21).content.toString()).toBe('<p>edited</p>');
});

test('review: file restored during hold uploads changed bytes', async () => {
  const { root, engine, server } = setup();
  fsSync.rmSync(nodePath.join(root, 'work/page.html'));
  engine._dispatchRaw('unlink', 'work/page.html');
  await runJob(engine);
  fsSync.writeFileSync(nodePath.join(root, 'work/page.html'), '<p>replacement</p>');
  engine._dispatchRaw('add', 'work/page.html');
  await runJob(engine);
  jest.advanceTimersByTime(4000);
  await engine.whenQueueEmpty();
  expect(server.get(21).content.toString()).toBe('<p>replacement</p>');
});

test('review: returning deleted attachment folder restores original node identities', async () => {
  const { root, engine, server } = setup();
  fsSync.rmSync(nodePath.join(root, 'uploads/assets-a'), { recursive: true });
  engine.markDirty('uploads/assets-a');
  await runJob(engine);
  await runWake(engine);
  expect(idsOf(server, 'deleteNode')).toEqual([11]);
  fsSync.mkdirSync(nodePath.join(root, 'uploads/assets-a'));
  fsSync.writeFileSync(nodePath.join(root, 'uploads/assets-a/x.png'), 'x');
  engine._dispatchRaw('addDir', 'uploads/assets-a');
  engine._dispatchRaw('add', 'uploads/assets-a/x.png');
  await runJob(engine);
  jest.advanceTimersByTime(1000);
  await engine.whenQueueEmpty();
  expect({ oldFolderLive: !!server.get(11), oldFileLive: !!server.get(12),
    restores: idsOf(server, 'restoreNode'), newIds: idsOf(server, 'createNode')
  }).toEqual({ oldFolderLive: true, oldFileLive: true, restores: [11], newIds: [] });
});

test('review: SSE inventory read before queued rename must not undo it', async () => {
  const { root, engine, server } = setup();
  fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
  engine.markDirty('work/page.html');
  engine.markDirty('work/page2.html');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const relocation = engine.serial(async () => {
    await gate;
    await engine.runStructureJobInLane();
  });
  await tick();
  const refresh = engine.refreshNode(21, { generation: 1 });
  for (let i = 0; i < 6; i++) await tick();
  expect(callsNamed(server, 'listNodes').length).toBe(1);
  release();
  await relocation;
  await refresh;
  expect(server.relPathOf(21)).toBe('work/page2.html');
  expect({ ledger: engine.repo.get('21').path,
    oldPathOnDisk: fsSync.existsSync(nodePath.join(root, 'work/page.html')),
    newPathOnDisk: fsSync.existsSync(nodePath.join(root, 'work/page2.html'))
  }).toEqual({ ledger: 'work/page2.html', oldPathOnDisk: false, newPathOnDisk: true });
});

test('review: partial recovery must not bypass pending mass-delete choice', async () => {
  const { root, engine, server } = setup(massTree());
  fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
  engine.markDirty('uploads/assets-m');
  await runJob(engine);
  await runWake(engine);
  expect(engine._structureState().massDelete.files).toBe(25);
  fsSync.mkdirSync(nodePath.join(root, 'uploads/assets-m'));
  for (let i = 0; i < 21; i++) {
    fsSync.writeFileSync(nodePath.join(root, `uploads/assets-m/m${String(i).padStart(2, '0')}.png`), `m-${i}`);
  }
  engine.markDirty('uploads/assets-m');
  await runJob(engine);
  await runWake(engine);
  expect(engine._structureState().massDelete).not.toBeNull();
  expect(idsOf(server, 'deleteNode')).toEqual([]);
});

test('review: catchup stops sending structural operations after pause', async () => {
  const { root, engine, server } = setup({
    tree: { 'work/a.html': '<p>a</p>', 'work/b.html': '<p>b</p>' },
    ids: { 20: 'work', 21: 'work/a.html', 22: 'work/b.html' }
  });
  fsSync.renameSync(nodePath.join(root, 'work/a.html'), nodePath.join(root, 'work/aa.html'));
  fsSync.renameSync(nodePath.join(root, 'work/b.html'), nodePath.join(root, 'work/bb.html'));
  server.onCall = call => {
    if (call.name === 'renameNode' && call.nodeId === 21) {
      engine.runner.state = 'paused';
      engine.dropPendingWork();
    }
  };
  await engine.reconcileAll(server.inventory(), { generation: 1 });
  expect(idsOf(server, 'renameNode')).toEqual([21]);
});

test('review: cancelled mutation must not advance ledger to an unsent rename', async () => {
  const { root, engine, server } = setup();
  fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
  engine.markDirty('work/page2.html');
  jest.spyOn(engine, '_expectedVersion').mockImplementationOnce(async () => {
    engine.runner.state = 'paused';
    engine.dropPendingWork();
    return undefined;
  });
  await runJob(engine);
  expect(idsOf(server, 'renameNode')).toEqual([]);
  expect(engine.repo.get('21').path).toBe('work/page.html');
});

test('review: occupied uploads restoration does not block unrelated new files forever', async () => {
  const { root, engine, server } = setup();
  fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'uploads-old'));
  fsSync.mkdirSync(nodePath.join(root, 'uploads'));
  fsSync.writeFileSync(nodePath.join(root, 'work/new.html'), '<p>new</p>');
  engine.markDirty('uploads-old');
  engine.markDirty('work/new.html');
  const restores = jest.spyOn(engine, 'restoreLockedFolder');
  for (let i = 0; i < 5; i++) await runJob(engine);
  expect({ restoreAttempts: restores.mock.calls.length,
    rootStillDirty: engine._structureState().dirty.has(''),
    newFileOnServer: server.hasPath('work/new.html')
  }).toEqual({ restoreAttempts: 1, rootStillDirty: false, newFileOnServer: true });
});

const TREE_WITH_OTHER = {
  'uploads/assets-a/x.png': 'x',
  'work/page.html': '<p>w</p>',
  'work/other.html': '<p>o</p>'
};

const IDS_WITH_OTHER = {
  10: 'uploads',
  11: 'uploads/assets-a',
  12: 'uploads/assets-a/x.png',
  20: 'work',
  21: 'work/page.html',
  22: 'work/other.html'
};

test('F1 a folder name the server refuses still lets the batch send its deletes', async () => {
  const { root, engine, server } = setup({ tree: TREE_WITH_OTHER, ids: IDS_WITH_OTHER });
  const errors = errorsOf(engine);
  server.onCall = (call) => {
    if (call.name === 'createNode' && !/^[a-z0-9_-]+$/.test(call.args[0]) && !/\./.test(call.args[0])) {
      throw Object.assign(new Error('Folder name must be lowercase letters, numbers, hyphens, underscores only'), { statusCode: 400 });
    }
  };
  fsSync.mkdirSync(nodePath.join(root, 'untitled folder'));
  engine._dispatchRaw('addDir', 'untitled folder');
  fsSync.rmSync(nodePath.join(root, 'work/page.html'));
  engine._dispatchRaw('unlink', 'work/page.html');
  await runJob(engine);
  await runWake(engine);
  await runWake(engine);
  fsSync.rmSync(nodePath.join(root, 'work/other.html'));
  engine._dispatchRaw('unlink', 'work/other.html');
  await runJob(engine);
  await runWake(engine);
  await runWake(engine);
  expect(idsOf(server, 'deleteNode')).toEqual([21, 22]);
  expect(errors.filter((event) => event.type === 'validation')).toHaveLength(1);
});

test('F1b a rename to a name the server refuses stops every later op in every batch', async () => {
  const { root, engine, server } = setup({ tree: TREE_WITH_OTHER, ids: IDS_WITH_OTHER });
  const errors = errorsOf(engine);
  server.onCall = (call) => {
    if (call.name === 'renameNode' && /[A-Z ]/.test(call.args[1])) {
      throw Object.assign(new Error('Invalid site name'), { statusCode: 400 });
    }
  };
  fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/Page.html'));
  engine._dispatchRaw('unlink', 'work/page.html');
  engine._dispatchRaw('add', 'work/Page.html');
  await runJob(engine);
  fsSync.rmSync(nodePath.join(root, 'work/other.html'));
  engine._dispatchRaw('unlink', 'work/other.html');
  fsSync.writeFileSync(nodePath.join(root, 'work/zz.html'), '<p>z</p>');
  engine._dispatchRaw('add', 'work/zz.html');
  await runJob(engine);
  await runWake(engine);
  await runWake(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'deleteNode')).toEqual([22]);
  expect(errors.filter((event) => event.type === 'validation')).toHaveLength(1);
});

test('F2 a browser save refreshes the ledger identity, so a later Finder rename is one rename', async () => {
  const { root, engine, server } = setup();
  const abs = nodePath.join(root, 'work/page.html');
  const tmp = nodePath.join(root, 'work/.page.html.1.1.tmp');
  fsSync.writeFileSync(tmp, '<p>edited in the browser</p>');
  fsSync.renameSync(tmp, abs);
  await engine.serial(() => engine.applyLocalChange({ type: 'change', filename: 'work/page.html' }));
  expect(engine.repo.get('21').inode).toBe(getInodeSync(abs));

  fsSync.renameSync(abs, nodePath.join(root, 'work/page2.html'));
  engine._dispatchRaw('unlink', 'work/page.html');
  engine._dispatchRaw('add', 'work/page2.html');
  await runJob(engine);
  await runWake(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'renameNode')).toEqual([21]);
  expect(idsOf(server, 'createNode')).toEqual([]);
});

test('F3 an invalidation inside the quiet window leaves the rename to the structure job', async () => {
  const { root, engine, server } = setup();
  fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
  engine._dispatchRaw('unlink', 'work/page.html');
  await engine.refreshNode(21, {});
  engine._dispatchRaw('add', 'work/page2.html');
  await runJob(engine);
  await runWake(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'deleteNode')).toEqual([]);
  expect(idsOf(server, 'renameNode')).toEqual([21]);
});

test('F4 an offline folder rename and a child rename give two renames and no delete', async () => {
  const { root, engine, server } = setup({
    tree: { 'proj/page.html': '<p>p</p>', 'proj/keep.html': '<p>k</p>' },
    ids: { 10: 'proj', 11: 'proj/page.html', 12: 'proj/keep.html' }
  });
  fsSync.renameSync(nodePath.join(root, 'proj'), nodePath.join(root, 'renamed'));
  fsSync.renameSync(nodePath.join(root, 'renamed/page.html'), nodePath.join(root, 'renamed/index.html'));
  await engine.reconcileAll(server.inventory(), { generation: 1 });
  for (let i = 0; i < 6; i += 1) await tick();
  expect(idsOf(server, 'renameNode')).toEqual([10, 11]);
  expect(idsOf(server, 'createNode')).toEqual([]);
  expect(idsOf(server, 'deleteNode')).toEqual([]);
});

test('F4b an offline rename of an attachment inside a renamed folder keeps its node', async () => {
  const { root, engine, server } = setup({ tree: { 'docs/a.png': 'a' }, ids: { 10: 'docs', 11: 'docs/a.png' } });
  fsSync.renameSync(nodePath.join(root, 'docs'), nodePath.join(root, 'docs2'));
  fsSync.mkdirSync(nodePath.join(root, 'docs2/sub'));
  fsSync.renameSync(nodePath.join(root, 'docs2/a.png'), nodePath.join(root, 'docs2/sub/a.png'));
  await engine.reconcileAll(server.inventory(), { generation: 1 });
  for (let i = 0; i < 6; i += 1) await tick();
  expect(idsOf(server, 'deleteNode')).toEqual([]);
  expect(idsOf(server, 'renameNode')).toEqual([10]);
  expect(idsOf(server, 'moveNode')).toEqual([11]);
  expect(server.hasPath('docs2/sub/a.png')).toBe(true);
});

test('F5 moving a nested folder up and a file into it in one window keeps one folder', async () => {
  const { root, engine, server } = setup({
    tree: { 'p/q/a.html': '<p>a</p>', 'r.html': '<p>r</p>' },
    ids: { 30: 'p', 31: 'p/q', 32: 'p/q/a.html', 33: 'r.html' }
  });
  fsSync.renameSync(nodePath.join(root, 'p/q'), nodePath.join(root, 'q'));
  fsSync.renameSync(nodePath.join(root, 'r.html'), nodePath.join(root, 'q/r.html'));
  engine._dispatchRaw('unlinkDir', 'p/q');
  engine._dispatchRaw('unlink', 'r.html');
  engine._dispatchRaw('addDir', 'q');
  engine._dispatchRaw('add', 'q/r.html');
  for (let i = 0; i < 4; i += 1) {
    await runJob(engine);
    await runWake(engine);
  }
  await drainQueue(engine);
  expect(idsOf(server, 'createNode')).toEqual([]);
  expect(server.paths().filter((rel) => rel === 'q' || rel.startsWith('q/')).sort())
    .toEqual(['q', 'q/a.html', 'q/r.html']);
});

test('F7 a copy-back restores only after its own write has landed', async () => {
  const { root, engine, server } = setup();
  const rel = 'uploads/assets-a/x.png';
  const abs = nodePath.join(root, rel);
  fsSync.rmSync(abs);
  engine._dispatchRaw('unlink', rel);
  await runJob(engine);
  await runWake(engine);

  fsSync.writeFileSync(abs, 'PARTIAL');
  fsSync.writeFileSync(nodePath.join(root, 'work/new.html'), '<p>n</p>');
  engine._dispatchRaw('add', 'work/new.html');
  await runJob(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'restoreNode')).toEqual([]);

  fsSync.writeFileSync(abs, 'PARTIAL-AND-THE-REST');
  engine._dispatchRaw('add', rel);
  await runJob(engine);
  await runWake(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'restoreNode')).toEqual([12]);
  expect(server.get(12).content.toString()).toBe('PARTIAL-AND-THE-REST');
});

test('F8 an editor backup by rename is ignored and the node keeps its path', async () => {
  const { root, engine, server } = setup();
  const abs = nodePath.join(root, 'work/page.html');
  fsSync.renameSync(abs, `${abs}~`);
  fsSync.writeFileSync(abs, '<p>saved by emacs</p>');
  engine._dispatchRaw('add', 'work/page.html~');
  engine._dispatchRaw('change', 'work/page.html');
  await runJob(engine);
  await runWake(engine);
  await drainQueue(engine);
  expect(idsOf(server, 'renameNode')).toEqual([]);
  expect(engine.repo.get('21').path).toBe('work/page.html');
  expect(server.relPathOf(21)).toBe('work/page.html');
});

test('F10 ignored OS files do not count toward the mass-delete breaker', async () => {
  const tree = { 'uploads/assets-a/x.png': 'x' };
  const ids = { 10: 'uploads', 11: 'uploads/assets-a', 12: 'uploads/assets-a/x.png' };
  for (let i = 0; i < 5; i += 1) {
    tree[`uploads/junk-${i}/Thumbs.db`] = `junk-${i}`;
    ids[70 + i] = `uploads/junk-${i}`;
    ids[80 + i] = `uploads/junk-${i}/Thumbs.db`;
  }
  const { root, engine, server } = setup({ tree, ids });
  const errors = errorsOf(engine);
  for (let i = 0; i < 5; i += 1) {
    fsSync.rmSync(nodePath.join(root, `uploads/junk-${i}/Thumbs.db`));
    engine._dispatchRaw('unlink', `uploads/junk-${i}/Thumbs.db`);
  }
  await runJob(engine);
  await runWake(engine);
  expect(engine._structureState().massDelete).toBeNull();
  expect(errors.filter((event) => event.type === 'mass-delete')).toEqual([]);
  expect(idsOf(server, 'deleteNode')).toEqual([]);
});
