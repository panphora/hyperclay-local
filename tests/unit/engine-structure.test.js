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

describe('the structure job schedule', () => {
  it('runs one job 500 ms after the last of three marks 400 ms apart', async () => {
    const { engine } = setup();
    const jobs = jest.spyOn(engine, 'runStructureJobInLane');

    engine.markDirty('work/page.html');
    jest.advanceTimersByTime(400);
    engine.markDirty('work/page.html');
    jest.advanceTimersByTime(400);
    engine.markDirty('work/page.html');
    jest.advanceTimersByTime(400);

    expect(jobs).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    await engine._lane;
    expect(jobs).toHaveBeenCalledTimes(1);
  });

  it('caps the wait at 5 s from the first mark when marks keep coming', async () => {
    const { engine } = setup();
    const jobs = jest.spyOn(engine, 'runStructureJobInLane');

    for (let i = 0; i < 13; i += 1) {
      if (i) jest.advanceTimersByTime(400);
      engine.markDirty('work/page.html');
    }

    expect(jobs).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    await engine._lane;
    expect(jobs).toHaveBeenCalledTimes(1);
  });
});

describe('the structure job applies one batch', () => {
  it('sends one rename for a file renamed on disk, keeps the other fields and tombstones the old path', async () => {
    const { root, engine, server } = setup();
    const before = { ...engine.repo.get('21') };

    fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
    engine.markDirty('work/page2.html');
    await runJob(engine);

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[21, 'page2.html']]);
    expect(callsNamed(server, 'moveNode')).toEqual([]);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(callsNamed(server, 'createNode')).toEqual([]);

    const after = engine.repo.get('21');
    expect(after.path).toBe('work/page2.html');
    expect(after.type).toBe(before.type);
    expect(after.parentId).toBe(before.parentId);
    expect(after.inode).toBe(before.inode);
    expect(after.checksum).toBe(before.checksum);
    expect(after.remoteEtag).toBe(before.remoteEtag);
    expect(after.localChecksum).toBe(before.localChecksum);
    expect(engine.repo.isTombstoned('work/page.html')).toBe(true);
  });

  it('sends exactly one rename for a folder with three children and rewrites every descendant path', async () => {
    const { root, engine, server } = setup({
      tree: { 'work/a.png': 'a', 'work/sub/b.png': 'b', 'work/sub/c.png': 'c' },
      ids: {
        20: 'work',
        21: 'work/a.png',
        22: 'work/sub',
        23: 'work/sub/b.png',
        24: 'work/sub/c.png'
      }
    });

    fsSync.renameSync(nodePath.join(root, 'work'), nodePath.join(root, 'work2'));
    engine.markDirty('work2');
    await runJob(engine);

    expect(callsNamed(server, 'renameNode').map((call) => [call.nodeId, call.args[1]])).toEqual([[20, 'work2']]);
    expect(callsNamed(server, 'moveNode')).toEqual([]);
    expect(engine.repo.get('20').path).toBe('work2');
    expect(engine.repo.get('21').path).toBe('work2/a.png');
    expect(engine.repo.get('22').path).toBe('work2/sub');
    expect(engine.repo.get('23').path).toBe('work2/sub/b.png');
    expect(engine.repo.get('24').path).toBe('work2/sub/c.png');
  });

  it('sends nothing for a file deleted until the hold has passed, then deletes it and drops the entry', async () => {
    const { root, engine, server } = setup();

    fsSync.rmSync(nodePath.join(root, 'work/page.html'));
    engine.markDirty('work/page.html');
    await runJob(engine);
    expect(server.calls).toEqual([]);

    await runWake(engine);
    expect(idsOf(server, 'deleteNode')).toEqual([21]);
    expect(engine.repo.get('21')).toBeUndefined();
  });

  it('sends nothing for a file deleted and written back within two seconds', async () => {
    const { root, engine, server } = setup();

    fsSync.rmSync(nodePath.join(root, 'work/page.html'));
    engine.markDirty('work/page.html');
    await runJob(engine);

    fsSync.writeFileSync(nodePath.join(root, 'work/page.html'), '<p>w</p>');
    engine.markDirty('work/page.html');
    await runJob(engine);

    expect(server.calls).toEqual([]);
  });

  it('renames a renamed uploads folder back on disk and sends nothing', async () => {
    const { root, engine, server } = setup();

    fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'uploads-old'));
    engine.markDirty('uploads-old');
    await runJob(engine);

    expect(fsSync.existsSync(nodePath.join(root, 'uploads'))).toBe(true);
    expect(fsSync.existsSync(nodePath.join(root, 'uploads-old'))).toBe(false);
    expect(fsSync.existsSync(nodePath.join(root, 'uploads/assets-a/x.png'))).toBe(true);
    expect(server.calls).toEqual([]);
  });

  it('sends nothing and asks for a reconcile when the uploads root is gone', async () => {
    const { root, engine, server } = setup();
    const reconcile = jest.spyOn(engine, 'requestReconcile');

    fsSync.rmSync(nodePath.join(root, 'uploads'), { recursive: true });
    engine.markDirty('uploads');
    await runJob(engine);
    expect(server.calls).toEqual([]);

    await runWake(engine);
    expect(server.calls).toEqual([]);
    expect(reconcile).toHaveBeenCalled();
  });

  it('holds 25 attachments removed at once, emits one mass-delete and does not emit again', async () => {
    const { tree, ids } = massTree();
    const { root, engine, server } = setup({ tree, ids });
    const errors = errorsOf(engine);

    fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);

    await runWake(engine);
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(errors.map((event) => event.type)).toEqual(['mass-delete']);
    expect(errors[0].files).toBe(25);

    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    expect(errors.map((event) => event.type)).toEqual(['mass-delete']);
  });

  it('sends the deletes a mass-delete choice of delete asks for', async () => {
    const { tree, ids } = massTree();
    const { root, engine, server } = setup({ tree, ids });
    const errors = errorsOf(engine);

    fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    await runWake(engine);
    expect(errors[0].files).toBe(25);

    const resolved = await engine.resolveMassDelete('delete');

    expect(resolved).toBe(true);
    expect(callsNamed(server, 'deleteNode').map((call) => [call.nodeId, call.args[1].cascade])).toEqual([[60, true]]);
    expect(engine.repo.get('60')).toBeUndefined();
    expect(engine.repo.get('61')).toBeUndefined();
  });

  it('asks for a reconcile when the mass-delete choice is restore', async () => {
    const { tree, ids } = massTree();
    const { root, engine } = setup({ tree, ids });
    const reconcile = jest.spyOn(engine, 'requestReconcile');

    fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    await runWake(engine);

    const resolved = await engine.resolveMassDelete('restore');

    expect(resolved).toBe(true);
    expect(reconcile).toHaveBeenCalled();
  });

  it('restores the same node when an attachment comes back after its delete', async () => {
    const { root, engine, server } = setup();
    const rel = 'uploads/assets-a/x.png';
    const abs = nodePath.join(root, rel);

    fsSync.rmSync(abs);
    engine.markDirty(rel);
    await runJob(engine);
    await runWake(engine);
    expect(idsOf(server, 'deleteNode')).toEqual([12]);

    fsSync.writeFileSync(abs, 'x');
    engine.markDirty(rel);
    await runJob(engine);

    expect(idsOf(server, 'restoreNode')).toEqual([12]);
    expect(engine.repo.get('12').path).toBe(rel);
    expect(callsNamed(server, 'createNode')).toEqual([]);
  });

  it('stops the batch and asks for a reconcile when the server fails', async () => {
    const { root, engine, server } = setup({
      tree: { 'work/a.png': 'a', 'work/b.png': 'b' },
      ids: { 20: 'work', 21: 'work/a.png', 22: 'work/b.png' }
    });
    const reconcile = jest.spyOn(engine, 'requestReconcile');
    server.onCall = (call) => {
      if (call.name === 'renameNode') {
        throw Object.assign(new Error('server exploded'), { statusCode: 500 });
      }
    };

    fsSync.renameSync(nodePath.join(root, 'work/a.png'), nodePath.join(root, 'work/a2.png'));
    fsSync.renameSync(nodePath.join(root, 'work/b.png'), nodePath.join(root, 'work/b2.png'));
    engine.markDirty('work/a2.png');
    engine.markDirty('work/b2.png');
    await runJob(engine);

    expect(idsOf(server, 'renameNode')).toEqual([21]);
    expect(engine.repo.get('21').path).toBe('work/a.png');
    expect(engine.repo.get('22').path).toBe('work/b.png');
    expect(engine.repo.isTombstoned('work/a.png')).toBe(false);
    expect(reconcile).toHaveBeenCalled();
  });

  it('queues a new file only once its own path has been marked', async () => {
    const { root, engine } = setup();
    const queued = jest.spyOn(engine, 'queueSync');

    fsSync.writeFileSync(nodePath.join(root, 'work/new.png'), 'n');
    engine.markDirty('work/page.html');
    await runJob(engine);
    expect(queued).not.toHaveBeenCalled();

    engine.markDirty('work/new.png');
    await runJob(engine);
    expect(queued).toHaveBeenCalledWith('add', 'work/new.png');
  });

  it('applies no op when the session drops its work between the snapshot and the apply', async () => {
    const { root, engine, server } = setup();
    const applied = jest.spyOn(engine, '_applyStructureOp');

    fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
    engine.markDirty('work/page2.html');
    jest.advanceTimersByTime(QUIET_MS);

    // The job is inside the lane and parked in the snapshot now.
    await tick();
    expect(engine.inLane()).toBe(true);
    engine.dropPendingWork();
    await engine._lane;

    expect(applied).not.toHaveBeenCalled();
    expect(callsNamed(server, 'renameNode')).toEqual([]);
    expect(engine.repo.get('21').path).toBe('work/page.html');
  });
});

describe('the structure job review regressions', () => {
  it('keeps a folder a teammate added to during the hold and brings it back on reconcile', async () => {
    const { root, engine, server } = setup();
    engine.protocol = 2;
    const reconcile = jest.spyOn(engine, 'requestReconcile');

    fsSync.rmSync(nodePath.join(root, 'work'), { recursive: true });
    engine.markDirty('work');
    await runJob(engine);
    await server.createNode(null, { type: 'site', name: 'teammate.html', parentId: 20, content: '<p>new remote work</p>' });
    server.get(20).version += 1;
    await runWake(engine);

    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(reconcile).toHaveBeenCalled();

    await engine.reconcileAll(server.inventory(), { generation: 1 });

    expect(fsSync.existsSync(nodePath.join(root, 'work'))).toBe(true);
    expect(fsSync.existsSync(nodePath.join(root, 'work/page.html'))).toBe(true);
    expect(fsSync.existsSync(nodePath.join(root, 'work/teammate.html'))).toBe(true);
  });

  it('keeps a file a teammate edited during its hold', async () => {
    const { root, engine, server } = setup();
    const reconcile = jest.spyOn(engine, 'requestReconcile');

    fsSync.rmSync(nodePath.join(root, 'work/page.html'));
    engine.markDirty('work/page.html');
    await runJob(engine);
    await server.putNodeContent(null, 21, '<p>teammate edit</p>');
    await runWake(engine);

    expect(callsNamed(server, 'deleteNode')).toEqual([]);
    expect(reconcile).toHaveBeenCalled();
  });

  it('holds every path of a pending mass delete and sends no delete after a partial recovery', async () => {
    const { tree, ids } = massTree();
    const { root, engine, server } = setup({ tree, ids });

    fsSync.rmSync(nodePath.join(root, 'uploads/assets-m'), { recursive: true });
    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    await runWake(engine);

    const pending = engine._structureState().massDelete;
    expect(pending.files).toBe(25);
    for (const rel of pending.paths) expect(engine.holdsPath(rel)).toBe(true);
    expect(engine.holdsPath('uploads/assets-m/m00.png')).toBe(true);

    fsSync.mkdirSync(nodePath.join(root, 'uploads/assets-m'));
    for (let i = 0; i < 4; i += 1) {
      const name = `m${String(i).padStart(2, '0')}.png`;
      fsSync.writeFileSync(nodePath.join(root, `uploads/assets-m/${name}`), `m-${i}`);
    }
    engine.markDirty('uploads/assets-m');
    await runJob(engine);
    await runWake(engine);

    expect(engine._structureState().massDelete).not.toBeNull();
    expect(idsOf(server, 'deleteNode')).toEqual([]);
  });

  it('uploads the new bytes for a rename and an edit inside the quiet window', async () => {
    const { root, engine, server } = setup();

    fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
    fsSync.writeFileSync(nodePath.join(root, 'work/page2.html'), '<p>edited</p>');
    engine._dispatchRaw('unlink', 'work/page.html');
    engine._dispatchRaw('add', 'work/page2.html');
    engine._dispatchRaw('change', 'work/page2.html');
    await runJob(engine);
    jest.advanceTimersByTime(1000);
    await engine.processQueue();
    await engine.whenQueueEmpty();

    expect(server.relPathOf(21)).toBe('work/page2.html');
    expect(server.get(21).content.toString()).toBe('<p>edited</p>');
  });

  it('reports a cancelled rename and leaves the ledger alone', async () => {
    const { root, engine, server } = setup();
    const cancel = async () => {
      engine.runner.state = 'paused';
      engine.dropPendingWork();
      return undefined;
    };
    jest.spyOn(engine, '_expectedVersion').mockImplementationOnce(cancel).mockImplementationOnce(cancel);

    fsSync.renameSync(nodePath.join(root, 'work/page.html'), nodePath.join(root, 'work/page2.html'));
    engine.markDirty('work/page2.html');

    expect(await engine._apiRenameNode(21, 'page2.html')).toBe(false);

    await engine._applyRelocate({ id: 21, shape: 'rename', from: 'work/page.html', to: 'work/page2.html' });

    expect(callsNamed(server, 'renameNode')).toEqual([]);
    expect(engine.repo.get('21').path).toBe('work/page.html');
    expect(engine.repo.isTombstoned('work/page.html')).toBe(false);
  });

  it('restores the original ids when a deleted attachment folder comes back', async () => {
    const { root, engine, server } = setup();

    fsSync.rmSync(nodePath.join(root, 'uploads/assets-a'), { recursive: true });
    engine.markDirty('uploads/assets-a');
    await runJob(engine);
    await runWake(engine);
    expect(idsOf(server, 'deleteNode')).toEqual([11]);

    fsSync.mkdirSync(nodePath.join(root, 'uploads/assets-a'));
    fsSync.writeFileSync(nodePath.join(root, 'uploads/assets-a/x.png'), 'x');
    engine.markDirty('uploads/assets-a');
    engine.markDirty('uploads/assets-a/x.png');
    await runJob(engine);

    expect(idsOf(server, 'restoreNode')).toEqual([11]);
    expect(engine.repo.get('11').path).toBe('uploads/assets-a');
    expect(engine.repo.get('12').path).toBe('uploads/assets-a/x.png');
    expect(callsNamed(server, 'createNode')).toEqual([]);
  });

  it('asks once when the uploads destination is occupied and does not retry in a loop', async () => {
    const { root, engine } = setup();
    const errors = errorsOf(engine);
    const dirty = jest.spyOn(engine, 'markDirty');

    fsSync.renameSync(nodePath.join(root, 'uploads'), nodePath.join(root, 'uploads-old'));
    fsSync.mkdirSync(nodePath.join(root, 'uploads'));
    fsSync.writeFileSync(nodePath.join(root, 'work/new.html'), '<p>new</p>');
    engine.markDirty('uploads-old');
    engine.markDirty('work/new.html');
    dirty.mockClear();

    await runJob(engine);
    engine.markDirty('uploads-old');
    await runJob(engine);
    engine.markDirty('uploads-old');
    await runJob(engine);

    expect(errors.map((event) => event.type)).toEqual(['uploads-occupied']);
    expect(dirty.mock.calls.filter(([rel]) => rel === '')).toEqual([]);
    expect(engine._structure.timer).toBeNull();
  });

  it('sends a later delete in the batch when the server refuses a create with a 4xx', async () => {
    const { root, engine, server } = setup();
    const errors = errorsOf(engine);
    server.onCall = (call) => {
      if (call.name === 'createNode') {
        throw Object.assign(new Error('That name is not allowed'), { statusCode: 400 });
      }
    };

    fsSync.mkdirSync(nodePath.join(root, 'newfolder'));
    engine.markDirty('newfolder');
    fsSync.rmSync(nodePath.join(root, 'work/page.html'));
    engine.markDirty('work/page.html');
    await runJob(engine);
    await runWake(engine);

    expect(idsOf(server, 'deleteNode')).toEqual([21]);
    expect(errors.filter((event) => event.type === 'validation')).toHaveLength(1);
  });
});

describe('the uploads backstop outside a job', () => {
  it('refuses a delete of a node under uploads and sends nothing', async () => {
    const { engine, server } = setup();

    await expect(engine._apiDeleteNode(12)).rejects.toMatchObject({ code: 'locked-folder' });

    expect(api.deleteNode).not.toHaveBeenCalled();
    expect(callsNamed(server, 'deleteNode')).toEqual([]);
  });
});

describe('createFolderOnServer', () => {
  it('returns null and sends no create for a path that is not on disk', async () => {
    const { engine, server } = setup();

    const created = await engine.createFolderOnServer('ghost');

    expect(created).toBeNull();
    expect(api.createNode).not.toHaveBeenCalled();
    expect(callsNamed(server, 'createNode')).toEqual([]);
  });
});
