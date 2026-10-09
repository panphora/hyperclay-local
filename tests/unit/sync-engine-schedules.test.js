/**
 * The race harness (sync-structural step 1).
 *
 * Real filesystem operations on real temp directories, every watcher event
 * those operations produce, many seeded orders with seeded async delays,
 * against an in-memory server. Invariants are checked after every fake API
 * call and at quiescence (plan §2.7):
 *
 *   I1 a catch-up pass never deletes, moves or renames anything under uploads/
 *   I2 no node outside the operation's targets is deleted, moved or renamed
 *   I3 a folder rename or move sends one relocate and nothing for descendants
 *   I4 no unrelated folder is renamed into uploads/ on disk
 *   I5 no pre-existing bytes are lost without an operation that deleted them
 *   I6 every scenario ran a schedule and sent a call (or proved the no-op)
 *
 * Nothing under uploads/ is asserted for a live delete or move: that policy is
 * undecided, so those scenarios only check I1, I2, I4 and I5.
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
  const fsSync = require('fs');
  const { seams } = require('../helpers/fs-scenario');
  return {
    ...real,
    getInode: jest.fn(async (filePath) => {
      await seams.wait();
      if (seams.inodeAlias.has(filePath)) return seams.inodeAlias.get(filePath);
      try {
        return fsSync.statSync(filePath).ino;
      } catch {
        return null;
      }
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
const { AsyncLocalStorage } = require('async_hooks');
const api = require('../../src/sync-engine/api-client');
const fsScenario = require('../helpers/fs-scenario');
const { FakeServer, install } = require('../helpers/sync-fake-server');

const SCHEDULES = Number(process.env.SCHEDULES || 60);
// Which lane a request came from. A call the live lane started before a pass
// began keeps the live lane's context, so the pass is never blamed for it.
const lane = new AsyncLocalStorage();
const MUTATIONS = new Set(['deleteNode', 'moveNode', 'renameNode']);
const UPLOADS = 'uploads';

jest.setTimeout(600000);

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function drain(turns = 6) {
  for (let i = 0; i < turns; i++) await tick();
}

async function advance(ms) {
  if (ms > 0) jest.advanceTimersByTime(ms);
  await drain(2);
}

const underUploads = (rel) => !!rel && (rel === UPLOADS || rel.startsWith(`${UPLOADS}/`));

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

// --- scenarios -------------------------------------------------------------

const BASE_TREE = {
  'uploads/assets-a/x.png': 'x',
  'work/page.html': '<p>w</p>',
  'work/sub/b.png': 'b'
};

const BASE_IDS = {
  10: 'uploads',
  11: 'uploads/assets-a',
  12: 'uploads/assets-a/x.png',
  20: 'work',
  21: 'work/page.html',
  22: 'work/sub',
  23: 'work/sub/b.png'
};

const DEEP_FILES = 50;
const deepTree = {};
const deepIds = { 30: 'deep' };
for (let i = 0; i < DEEP_FILES; i += 1) {
  const name = `f${String(i).padStart(2, '0')}.txt`;
  deepTree[`deep/${name}`] = `body-${i}`;
  deepIds[31 + i] = `deep/${name}`;
}

const deepDescendants = Object.keys(deepIds).map(Number).filter((id) => id !== 30);

function scenario(extra) {
  const { tree = {}, ids = {}, ops = [], targets = [], ...rest } = extra;
  return {
    ...rest,
    tree: { ...BASE_TREE, ...tree },
    ids: { ...BASE_IDS, ...ids },
    ops,
    targets
  };
}

const SCENARIOS = [
  scenario({
    id: 'E7',
    failing: ['tree', 'free'],
    title: 'trash uploads/ while renaming work/ to work2/',
    ops: [
      { op: 'trash', path: 'uploads' },
      { op: 'rename', from: 'work', to: 'work2' }
    ],
    targets: [10, 11, 12, 20]
  }),
  scenario({
    id: 'E7base',
    failing: ['tree', 'free'],
    title: 'no-uploads control: trash docs/ while renaming work/ to work2/',
    tree: { 'docs/d.html': '<p>d</p>' },
    ids: { 30: 'docs', 31: 'docs/d.html' },
    ops: [
      { op: 'trash', path: 'docs' },
      { op: 'rename', from: 'work', to: 'work2' }
    ],
    targets: [20, 30, 31]
  }),
  scenario({
    id: 'E8',
    failing: ['tree', 'free'],
    title: 'uploads/ renamed and renamed back while a pass runs',
    ops: [
      { op: 'rename', from: 'uploads', to: 'uploads-old' },
      { op: 'rename', from: 'uploads-old', to: 'uploads', at: 500 }
    ],
    targets: [10, 11, 12],
    midReconcile: true
  }),
  scenario({
    id: 'E8base',
    failing: ['tree', 'free'],
    title: 'no-uploads control: work/ renamed and renamed back while a pass runs',
    ops: [
      { op: 'rename', from: 'work', to: 'work2' },
      { op: 'rename', from: 'work2', to: 'work', at: 500 }
    ],
    midReconcile: true
  }),
  scenario({
    id: 'E5',
    failing: ['tree', 'free'],
    title: 'a new untitled folder after a rename reaches the server',
    tree: { 'untitled folder/a.png': 'a' },
    ids: { 40: 'untitled folder', 41: 'untitled folder/a.png' },
    ops: [
      { op: 'rename', from: 'untitled folder', to: 'photos' },
      { op: 'mkdir', path: 'untitled folder' }
    ],
    targets: [40],
    expectOnServer: ['untitled folder', 'photos']
  }),
  scenario({
    id: 'E1',
    failing: ['tree', 'free'],
    title: 'an untracked child of a renamed uploads folder leaves no ghost folder',
    tree: { 'uploads/assets-new/n.png': 'n' },
    ops: [{ op: 'rename', from: 'uploads', to: 'uploads-old' }],
    targets: [10, 11, 12],
    forbidServerPrefix: ['uploads-old']
  }),
  scenario({
    id: 'E2',
    failing: ['tree', 'free'],
    title: 'a file rename while a pass runs sends the rename once',
    ops: [{ op: 'rename', from: 'work/page.html', to: 'work/page2.html' }],
    targets: [21],
    midReconcile: true,
    relocateOnce: [{ id: 21, descendants: [], forbidCreateNames: ['page2.html'] }]
  }),
  scenario({
    id: 'deep',
    failing: ['tree', 'free'],
    title: 'a 50-file folder renamed sends one rename',
    tree: deepTree,
    ids: deepIds,
    ops: [{ op: 'rename', from: 'deep', to: 'deep2' }],
    targets: [30],
    relocateOnce: [{ id: 30, descendants: deepDescendants, forbidCreateNames: ['deep', 'deep2'] }]
  }),
  scenario({
    id: 'W5a',
    failing: ['tree', 'free'],
    title: 'work/ and uploads/ moved together into archive/',
    ops: [
      { op: 'mkdir', path: 'archive' },
      { op: 'move', from: 'work', to: 'archive/work' },
      { op: 'move', from: 'uploads', to: 'archive/uploads' }
    ],
    targets: [10, 11, 12, 20],
    relocateOnce: [{ id: 20, descendants: [21, 22, 23] }]
  }),
  scenario({
    id: 'W5base',
    failing: ['tree', 'free'],
    title: 'no-uploads control: two ordinary folders moved together keep their node ids',
    tree: { 'docs/d.html': '<p>d</p>' },
    ids: { 40: 'docs', 41: 'docs/d.html' },
    ops: [
      { op: 'mkdir', path: 'archive' },
      { op: 'move', from: 'work', to: 'archive/work' },
      { op: 'move', from: 'docs', to: 'archive/docs' }
    ],
    targets: [20, 40],
    relocateOnce: [
      { id: 20, descendants: [21, 22, 23] },
      { id: 40, descendants: [41] }
    ]
  }),
  scenario({
    id: 'restore-interrupted',
    title: 'downloads fail during a restore of uploads/, then the next pass runs',
    ops: [{ op: 'trash', path: 'uploads' }],
    targets: [10, 11, 12],
    after: [{ kind: 'reconcileAll', failDownloads: true }, { kind: 'reconcileAll' }]
  }),
  scenario({
    id: 'pass-during-trash',
    title: 'a pass runs during a pending trash of uploads/',
    ops: [{ op: 'trash', path: 'uploads' }],
    targets: [10, 11, 12],
    midReconcile: true
  }),
  scenario({
    id: 'nested-replaced',
    title: 'uploads/assets-a replaced by an empty folder with a new inode',
    ops: [
      { op: 'trash', path: 'uploads/assets-a' },
      { op: 'mkdir', path: 'uploads/assets-a' }
    ],
    targets: [11, 12]
  }),
  scenario({
    id: 'freed-inode',
    title: 'a new folder that reuses uploads/ freed inode is not renamed into uploads/',
    ops: [
      { op: 'trash', path: 'uploads' },
      { op: 'mkdir', path: 'new-project' },
      { op: 'write', path: 'new-project/notes.txt', body: 'mine' }
    ],
    targets: [10, 11, 12],
    reuseInode: { from: 'uploads', to: 'new-project' }
  }),
  scenario({
    id: 'occupied-putback',
    title: 'uploads/ renamed away and a new uploads/ appears before the rename back',
    ops: [
      { op: 'rename', from: 'uploads', to: 'uploads-old' },
      { op: 'mkdir', path: 'uploads' }
    ],
    targets: [10, 11, 12]
  }),
  scenario({
    id: 'rename-back',
    failing: ['tree', 'free'],
    title: 'a rename and a rename back within 500 ms send nothing',
    ops: [
      { op: 'rename', from: 'work', to: 'work2' },
      { op: 'rename', from: 'work2', to: 'work', at: 500 }
    ],
    allowZeroCalls: true
  }),
  scenario({
    id: 'attachment-moved-live',
    title: 'an attachment moved out of uploads/ while the app runs',
    ops: [{ op: 'move', from: 'uploads/assets-a/x.png', to: 'work/x.png' }],
    targets: [12],
    after: [{ kind: 'reconcileAll' }]
  }),
  scenario({
    id: 'attachment-moved-catchup',
    title: 'an attachment moved out of uploads/ during catch-up',
    ops: [{ op: 'move', from: 'uploads/assets-a/x.png', to: 'work/x.png' }],
    targets: [12],
    after: [{ kind: 'reconcileAll' }],
    settledReconcile: true
  }),
  scenario({
    id: 'slow-delete-uploads',
    title: 'a slow recursive delete of uploads/ spread over more than 5 s',
    ops: [{ op: 'slow-rm', path: 'uploads', spanMs: 5200 }],
    targets: [10, 11, 12],
    midReconcile: true,
    allowZeroCalls: true
  }),
  scenario({
    id: 'slow-delete-docs',
    title: 'no-uploads control: a slow recursive delete of an ordinary folder',
    tree: { 'docs/d.html': '<p>d</p>', 'docs/sub/e.png': 'e' },
    ids: { 30: 'docs', 31: 'docs/d.html', 32: 'docs/sub', 33: 'docs/sub/e.png' },
    ops: [{ op: 'slow-rm', path: 'docs', spanMs: 5200 }],
    targets: [30, 31, 32, 33],
    midReconcile: true,
    loseResponse: 'deleteNode'
  })
];

// --- one run ---------------------------------------------------------------

async function runOne(spec, seed, mode, baseDir) {
  // Two streams: the plan (orders, gaps, scheduled actions) is consumed in a
  // fixed sequence, so it stays the same run to run; the seams are consumed
  // once per async call, which the engine decides.
  const planRand = fsScenario.rng(seed * 2654435761 + (mode === 'free' ? 97 : 1));
  const seamRand = fsScenario.rng((seed ^ 0x5bf03635) * 40503 + (mode === 'free' ? 131 : 7));
  const root = fsScenario.mkroot(spec.tree, baseDir);
  const outside = fsScenario.mkoutside(baseDir);
  const metaDir = fsSync.mkdtempSync(nodePath.join(baseDir, 'meta-'));

  const ledger = fsScenario.ledgerFor(root, spec.ids);
  const serverNodes = fsScenario.serverNodesFor(root, spec.ids);
  const uploadsInode = spec.ids[10] === UPLOADS ? fsSync.statSync(nodePath.join(root, UPLOADS)).ino : null;

  const { stream } = fsScenario.planOps(root, outside, spec.ops, planRand, mode);

  fsScenario.seams.wait = async () => {
    const n = Math.floor(seamRand() * 3);
    for (let i = 0; i < n; i += 1) await tick();
  };
  fsScenario.seams.inodeAlias = new Map();
  if (spec.reuseInode) {
    fsScenario.seams.inodeAlias.set(nodePath.join(root, spec.reuseInode.to), uploadsInode);
  }

  const server = new FakeServer(serverNodes, {
    delay: async () => {
      const n = Math.floor(seamRand() * 3);
      for (let i = 0; i < n; i += 1) await tick();
    }
  });
  install(api, server);
  if (spec.loseResponse) server.loseResponseFor(spec.loseResponse);

  const state = {
    violations: [],
    calls: 0,
    schedules: 0,
    paused: false,
    diskRenamesIntoUploads: []
  };

  const fail = (invariant, detail) => {
    const message = `${invariant}: ${detail}`;
    if (!state.violations.includes(message)) state.violations.push(message);
  };

  server.onCall = (call) => {
    state.calls += 1;
    if (!MUTATIONS.has(call.name)) return;
    if (lane.getStore() === 'catchup' && underUploads(call.pathBefore)) {
      fail('I1', `catch-up pass sent ${call.name} for ${call.pathBefore}`);
    }
    if (call.nodeId !== null && !spec.targets.includes(call.nodeId)) {
      fail('I2', `${call.name} touched node ${call.nodeId} (${call.pathBefore})`);
    }
  };

  const realRename = fsSync.promises.rename;
  const renameSpy = jest.spyOn(fsSync.promises, 'rename').mockImplementation(async (from, to) => {
    let fromInode = null;
    try {
      fromInode = fsSync.statSync(from).ino;
    } catch {
      fromInode = null;
    }
    const result = await realRename(from, to);
    if (to === nodePath.join(root, UPLOADS) && fromInode !== uploadsInode) {
      state.diskRenamesIntoUploads.push(from);
    }
    return result;
  });

  const engine = makeEngine(root, metaDir, ledger);
  let generation = 1;

  const reconcile = async ({ failDownloads = false } = {}) => {
    if (failDownloads) server.failContent = true;
    state.schedules += 1;
    try {
      await lane.run('catchup', () => engine.reconcileAll(server.inventory(), { generation: generation++ }));
    } catch {
      // A pass may refuse or throw; the invariants still hold for what it sent.
    } finally {
      if (failDownloads) server.failContent = false;
    }
    await drain();
  };

  const pause = () => {
    state.paused = true;
    state.schedules += 1;
    engine.runner.state = 'paused';
    engine.dropPendingWork();
  };

  const resume = () => {
    state.paused = false;
    state.schedules += 1;
    engine.runner.state = 'live';
  };

  let midIndex = -1;
  if (spec.midReconcile) {
    const firstOfSecondOp = stream.findIndex((event) => (event.group || 0) >= 1);
    midIndex = firstOfSecondOp >= 0 ? firstOfSecondOp : Math.max(1, Math.floor(stream.length / 2));
  }

  let scheduledOnce = false;

  try {
    for (let i = 0; i < stream.length; i += 1) {
      const event = stream[i];
      await advance(event.delay);
      if (event.remove) {
        fsSync.rmSync(nodePath.join(root, event.rel), { recursive: true, force: true });
      }
      if (i === midIndex) {
        await reconcile();
        scheduledOnce = true;
      }
      if (planRand() < 0.35) {
        if (state.paused) resume();
        else if (planRand() < 0.35) pause();
        else {
          await reconcile();
          scheduledOnce = true;
        }
      }
      engine._dispatchRaw(event.event, event.rel);
      await drain(2);
    }
    if (!scheduledOnce) {
      await reconcile();
      scheduledOnce = true;
    }
    if (state.paused) resume();

    for (let round = 0; round < 12; round += 1) {
      jest.advanceTimersByTime(2000);
      await drain();
      await engine.processQueue();
      await drain();
      if (round > 5 && engine.syncQueue.isEmpty() && !engine.syncQueue.isProcessingQueue()
        && engine.pendingUnlinks.size === 0) break;
    }

    for (const action of spec.after || []) {
      await reconcile(action);
      await drain();
      jest.advanceTimersByTime(2000);
      await drain();
      await engine.processQueue();
      await drain();
    }

    for (let round = 0; round < 8; round += 1) {
      jest.advanceTimersByTime(2000);
      await drain();
      await engine.processQueue();
      await drain();
    }
  } finally {
    renameSpy.mockRestore();
  }

  // I4: no unrelated folder was renamed into uploads/ on disk.
  for (const from of state.diskRenamesIntoUploads) {
    fail('I4', `renamed ${from} into uploads/`);
  }

  // I5: no pre-existing bytes lost without an operation that deleted them.
  const deletedByOps = spec.ops
    .filter((op) => op.op === 'rm' || op.op === 'slow-rm')
    .map((op) => op.path);
  const deletedByAnOp = (rel) => deletedByOps.some((p) => rel === p || rel.startsWith(`${p}/`));
  const diskHashes = new Set();
  for (const dir of [root, outside]) {
    for (const [, entry] of fsScenario.walk(dir)) {
      if (entry.bytes) diskHashes.add(fsScenario.checksumOf(entry.bytes));
    }
  }
  for (const [id, entry] of ledger) {
    if (!entry.checksum) continue;
    const node = server.get(Number(id));
    if (node && node.content && fsScenario.checksumOf(node.content) === entry.checksum) continue;
    if (diskHashes.has(entry.checksum)) continue;
    if (deletedByAnOp(entry.path)) continue;
    fail('I5', `bytes for ${entry.path} are gone and no operation deleted them`);
  }

  // I3: one relocate per folder, nothing for its descendants.
  for (const target of spec.relocateOnce || []) {
    const relocates = server.calls.filter((call) =>
      (call.name === 'renameNode' || call.name === 'moveNode') && call.nodeId === target.id);
    const removes = server.calls.filter((call) => call.name === 'deleteNode' && call.nodeId === target.id);
    if (relocates.length !== 1) fail('I3', `node ${target.id} got ${relocates.length} relocate calls`);
    if (removes.length) fail('I3', `node ${target.id} got ${removes.length} delete calls`);
    for (const child of target.descendants || []) {
      const touched = server.calls.filter((call) => MUTATIONS.has(call.name) && call.nodeId === child);
      if (touched.length) fail('I3', `descendant ${child} was touched ${touched.length} times`);
    }
    for (const name of target.forbidCreateNames || []) {
      const created = server.calls.filter((call) => call.name === 'createNode' && call.args[0] === name);
      if (created.length) fail('I3', `a node named ${name} was created`);
    }
  }

  // Ghost folders and the paths the operation must leave on the server.
  for (const prefix of spec.forbidServerPrefix || []) {
    const ghost = server.paths().filter((rel) => rel === prefix || rel.startsWith(`${prefix}/`));
    if (ghost.length) fail('I3', `ghost node(s) on the server: ${ghost.join(', ')}`);
  }
  for (const rel of spec.expectOnServer || []) {
    if (!server.hasPath(rel)) fail('I3', `${rel} never reached the server`);
  }

  engine.syncQueue.clear();
  fsSync.rmSync(root, { recursive: true, force: true });
  fsSync.rmSync(outside, { recursive: true, force: true });
  fsSync.rmSync(metaDir, { recursive: true, force: true });

  return state;
}

async function runScenario(spec, mode) {
  const baseDir = fsSync.mkdtempSync(nodePath.join(os.tmpdir(), 'race-base-'));
  const failures = [];
  let schedules = 0;
  let calls = 0;
  try {
    for (let seed = 1; seed <= SCHEDULES; seed += 1) {
      const state = await runOne(spec, seed, mode, baseDir);
      schedules += state.schedules;
      calls += state.calls;
      if (state.violations.length) {
        failures.push(`seed ${seed}: ${state.violations.join(' ; ')}`);
      }
    }
  } finally {
    fsSync.rmSync(baseDir, { recursive: true, force: true });
  }
  return { failures, schedules, calls };
}

function defineScenario(spec) {
  for (const mode of ['tree', 'free']) {
    const title = `${spec.id}: ${spec.title} [${mode}]`;
    const body = async () => {
      const { failures, schedules, calls } = await runScenario(spec, mode);
      if (process.env.RACE_REPORT) {
        process.stdout.write(
          `${title} schedules=${schedules} calls=${calls} failing-seeds=${failures.length}\n`
          + failures.map((failure) => `  ${failure}\n`).join('')
        );
      }
      expect(schedules).toBeGreaterThan(0);
      if (!spec.allowZeroCalls) expect(calls).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    };
    if (spec.failing && spec.failing.includes(mode)) test.failing(title, body);
    else test(title, body);
  }
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the sync engine race harness', () => {
  for (const spec of SCENARIOS) defineScenario(spec);
});
