// L0.fixtures: one deterministic fixture per ordering-contract row, driven through
// the real HTTP route, the real sync engine and the real rooms package. Every pause
// is an explicit promise and every count is an actual operation: a request that
// landed, bytes on disk, a room commit, a rename, a reservation, a publication.

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    configure: jest.fn(),
    onFrame: jest.fn(),
    broadcast: jest.fn(),
    notify: jest.fn(),
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

jest.mock('tailwind-hyperclay', () => ({
  ...jest.requireActual('tailwind-hyperclay'),
  compileTailwind: jest.fn()
}));

jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn().mockResolvedValue()
}));

jest.mock('../../src/main/data-loss-guard', () => ({
  ...jest.requireActual('../../src/main/data-loss-guard'),
  runDataLossGuard: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../src/sync-engine/api-client');

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('upath');
const request = require('supertest');

const { liveSync } = require('livesync-hyperclay');
const { compileTailwind } = require('tailwind-hyperclay');
const { createRooms, inspectPage, pageBaseline } = require('@panphora/clayjs/server/rooms');
const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, withStructureChange, pendingKeys } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { validateSegments } = require('../../src/main/utils/path-resolver');
const { documentEtag } = require('../../src/main/spec-wire');
const { attachLane } = require('../../src/sync-engine/state/sync-lane');
const NodeRepository = require('../../src/sync-engine/state/node-repository');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');
const sseHandlers = require('../../src/sync-engine/engine-sse');
const uploaderHandlers = require('../../src/sync-engine/engine-uploader');
const apiClient = require('../../src/sync-engine/api-client');

const tag = (name, value) => `<script type="application/json" merge="${name}" clay="live">${JSON.stringify(value)}</script>`;
const DOC = (value) => `<!DOCTYPE html><html><body>${tag('count', { n: value })}</body></html>`;
const PAGE = (value) => `<!DOCTYPE html><html><body>${tag('page', { v: 1, y: { doc: value } })}</body></html>`;
const HYBRID = (blocks) => `<!DOCTYPE html><html><body>${tag('page', { blocks })}</body></html>`;
const STYLED = (value) => '<!DOCTYPE html><html><head>'
  + '<link data-tailwind rel="stylesheet" href="/tailwindcss/styled.css">'
  + `</head><body>${tag('count', { n: value })}</body></html>`;

const dirs = [];

function tempDir() {
  const dir = path.resolve(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-schedules-'))));
  dirs.push(dir);
  return dir;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(check, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function bounded(promise, ms) {
  let timer;
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`schedule did not finish within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// One real authority over one real rooms core, with the reconciliation the
// confirmation performs recorded as it happens.
function harness({ liveBytes = null } = {}) {
  const dir = tempDir();
  const core = createRooms(liveBytes === null ? {} : { liveBytes });
  const fileWrittenCalls = [];
  const rooms = {
    ...core,
    fileWritten(key, html, opts) {
      fileWrittenCalls.push({ key, html });
      return core.fileWritten(key, html, opts);
    }
  };
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
  return { dir, core, rooms, authority, fileWrittenCalls };
}

async function startApp({ dir, rootId, authority = null, isKnownPath = null }) {
  const root = { id: rootId, kind: 'team', path: dir, port: 0 };
  const live = createRootLive(root);
  const ctx = {
    root,
    live,
    devHooks: null,
    isKnownPath,
    observer: null,
    helpers: null,
    syncEngineFor: null,
    person: null,
    localAuthority: authority
  };
  const server = await listenLoopback(createApp(ctx));
  return { server, root, live, origin: `http://127.0.0.1:${server.address().port}` };
}

const save = (server, name, body, headers = {}) => {
  const req = request(server)
    .post('/save')
    .set('Page-URL', `http://127.0.0.1:${server.address().port}/${name}`)
    .set('Content-Type', 'text/plain');
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send(body);
};

const savedBroadcasts = () =>
  liveSync.broadcast.mock.calls.filter(([, , opts]) => opts && opts.lane === 'saved');

// One structure step over the served folder, in the shape prepareStructure takes.
const structureStep = ({ from, to = null, fromRel, toRel = null, isDir = false }) => ({
  from: { location: from, canonical: from, isDir, isSymlink: false },
  to: to ? { location: to, canonical: to } : null,
  fromRel,
  toRel
});

// The real authority with its read-only claim counted, so a fixture can tell when a
// queued request has captured its location and is waiting on the gate.
const countClaims = (authority) => {
  const claims = [];
  const counting = Object.create(authority);
  counting.captureAdmission = (location) => {
    claims.push(location);
    return authority.captureAdmission(location);
  };
  return { authority: counting, claims };
};

function createEngine({ syncFolder, rootId, live, authority }) {
  const engine = Object.assign(new (require('events').EventEmitter)(), sseHandlers, uploaderHandlers);
  engine.syncFolder = syncFolder;
  engine.rootId = rootId;
  engine.generation = 1;
  engine.localAuthority = authority;
  engine.live = live;
  engine.resolveContainedPath = validateSegments;
  engine.repo = new NodeRepository();
  engine.repo.attach(path.join(syncFolder, 'meta'));
  engine.conn = { serverUrl: 'http://test', syncBase: '/_/sync', apiKey: 'k', accountId: null, protocol: 1 };
  engine.cascade = new CascadeSuppression();
  engine.stats = { filesDownloaded: 0, uploadsDownloaded: 0, errors: [] };
  engine.outbox = { consumeIfInFlight: () => false };
  engine.echoWindow = { mark: jest.fn() };
  attachLane(engine);
  return engine;
}

function broadcastsTo() {
  const calls = [];
  return { calls, live: { broadcast: (...args) => calls.push(args), markBrowserSave: jest.fn() } };
}

function pauseNextFetch() {
  const started = deferred();
  const response = deferred();
  apiClient.getNodeContent.mockImplementationOnce(() => {
    started.resolve();
    return response.promise;
  });
  return { started: started.promise, release: response.resolve };
}

describe('L0.fixtures: the write-ordering schedules through their real callers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    compileTailwind.mockReset();
    compileTailwind.mockResolvedValue('/* compiled */');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    for (const dir of dirs.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    jest.restoreAllMocks();
  });

  test('1. a save of an unrelated file lands while a held derived step keeps a queued folder move waiting', async () => {
    const h = harness();
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const aPath = path.join(h.dir, 'a.html');
    const bPath = path.join(h.dir, 'b.html');
    const cssPath = path.join(h.dir, '.hyperclay', 'tailwindcss', 'a.css');
    const folderDir = path.join(h.dir, 'folder');
    const movedDir = path.join(h.dir, 'moved');
    fs.writeFileSync(aPath, DOC(0));
    fs.writeFileSync(bPath, DOC(0));
    fs.mkdirSync(folderDir);
    fs.writeFileSync(path.join(folderDir, 'c.html'), DOC(0));

    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority, isKnownPath: () => true });

    const derived = deferred();
    compileTailwind.mockImplementationOnce(() => derived.promise);

    const order = [];
    let held = true;
    let moveStartedWhileHeld = null;
    const moveStarted = deferred();

    const derivedRequest = request(a.server).get('/tailwindcss/a.css').then((res) => {
      order.push('derived');
      return res;
    });
    await waitFor(() => compileTailwind.mock.calls.length === 1, 'the derived step to hold document A');
    expect(pendingKeys()).toEqual([aPath]);

    const savedB = await save(a.server, 'b.html', DOC(1));
    expect(savedB.status).toBe(200);
    order.push('b1');
    expect(fs.readFileSync(bPath, 'utf8')).toContain('"n":1');

    const move = withStructureChange(async (token) => {
      moveStartedWhileHeld = held;
      moveStarted.resolve();
      const plan = authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [structureStep({ from: folderDir, to: movedDir, fromRel: 'folder', toRel: 'moved', isDir: true })]
      });
      try {
        fs.renameSync(folderDir, movedDir);
        authority.commitStructure(plan, 1, token);
      } finally {
        authority.releaseStructure(plan, token);
      }
      order.push('move');
    });

    const laterSaves = ['b2', 'b3', 'b4'].map((label) =>
      save(a.server, 'b.html', DOC(2)).then((res) => {
        order.push(label);
        return res;
      }));
    await waitFor(
      () => claims.filter((location) => location.logicalPath === 'b.html').length >= 4,
      'the three later saves of B to queue behind the move'
    );
    expect(order).toEqual(['b1']);

    held = false;
    derived.resolve('/* derived a */');
    const [derivedRes, ...laterResults] = await bounded(
      Promise.all([derivedRequest, move.then(() => 'move'), ...laterSaves]),
      2000
    );
    await moveStarted.promise;

    expect(derivedRes.status).toBe(200);
    expect(derivedRes.text).toBe('/* derived a */');
    expect(fs.readFileSync(cssPath, 'utf8')).toBe('/* derived a */');
    expect(moveStartedWhileHeld).toBe(false);
    for (const res of laterResults.slice(1)) expect(res.status).toBe(200);
    expect(fs.existsSync(folderDir)).toBe(false);
    expect(fs.existsSync(path.join(movedDir, 'c.html'))).toBe(true);

    expect(order[0]).toBe('b1');
    expect(order.filter((label) => /^b\d$/.test(label)).length).toBe(4);
    for (const label of ['b2', 'b3', 'b4']) {
      expect(order.indexOf('move')).toBeLessThan(order.indexOf(label));
    }
    expect(pendingKeys()).toEqual([]);
    expect(savedBroadcasts()).toHaveLength(4);
  });

  test('2. a paused cloud fetch holds no gate, and its bytes apply only while the identity and claim are current', async () => {
    const h = harness();
    const file = path.join(h.dir, 'a.html');
    fs.writeFileSync(file, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority, isKnownPath: () => true });
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: h.dir, rootId: 'root-a', live: live.live, authority: h.authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'a.html', canonicalPath: file, origin: a.origin, live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: file, identity: target.identity
    }));
    expect(room).toBeTruthy();

    const fetch = pauseNextFetch();
    const download = engine.downloadFile(7, 'a.html');
    await fetch.started;

    // Zero gates: the paused fetch holds no file lock and no document boundary,
    // which is why a real save of the very same document completes here.
    expect(pendingKeys()).toEqual([]);
    const exclusiveGates = [];
    await withStructureChange(() => { exclusiveGates.push('exclusive'); });
    expect(exclusiveGates).toEqual(['exclusive']);
    const saved = await save(a.server, 'a.html', DOC(5));
    expect(saved.status).toBe(200);
    expect(saved.body.msg).toBe('Saved');
    expect(pendingKeys()).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toContain('"n":5');

    fetch.release({ content: DOC(9), modifiedAt: '2026-04-08T12:00:00Z' });
    await download;

    // The fetch's claim and the file's identity survived the save, so its bytes land.
    expect(fs.readFileSync(file, 'utf8')).toBe(DOC(9));
    expect(h.authority.identityAt(file)).toBe(target.identity);
    expect(h.core.state(h.core.get(file)).stores.count.value).toEqual({ n: 9 });
    expect(savedBroadcasts()).toHaveLength(2);
    expect(synced).toHaveBeenCalledTimes(1);

    // Same schedule again, with the identity replaced while the fetch is paused:
    // the fetched bytes must not apply.
    const staleFetch = pauseNextFetch();
    const staleDownload = engine.downloadFile(8, 'a.html');
    await staleFetch.started;

    const foreign = DOC(99);
    fs.writeFileSync(file, foreign);
    await withDocumentWrite(async () => ({ canonicalPath: file }), async (_locked, token) => {
      await h.authority.observeExternal(target, foreign, token);
    });
    const replaced = h.authority.identityAt(file);
    expect(replaced).not.toBe(target.identity);

    staleFetch.release({ content: DOC(7), modifiedAt: '2026-04-08T12:00:00Z' });
    await staleDownload;

    expect(fs.readFileSync(file, 'utf8')).toBe(foreign);
    expect(h.authority.identityAt(file)).toBe(replaced);
    expect(h.core.get(file)).toBeNull();
    expect(savedBroadcasts()).toHaveLength(2);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.stats.errors).toEqual([]);
    expect(pendingKeys()).toEqual([]);
  });

  test('3. a remote apply and a workspace folder move reach one engine and serialize without a reverse wait', async () => {
    const h = harness();
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const folderDir = path.join(h.dir, 'folder');
    const movedDir = path.join(h.dir, 'moved');
    const child = path.join(folderDir, 'a.html');
    const movedChild = path.join(movedDir, 'a.html');
    fs.mkdirSync(folderDir);
    fs.writeFileSync(child, DOC(0));

    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: h.dir, rootId: 'root-a', live: live.live, authority: h.authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'folder/a.html', canonicalPath: child, live: live.live
    });
    const room = h.core.open(child, DOC(0), { nodeId: target.identity });
    await engine.repo.set(5, { type: 'folder', path: 'folder' });
    await engine.repo.set(7, { type: 'site', path: 'folder/a.html' });

    const renameTargets = [];
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      renameTargets.push(String(to));
      return realRename.call(fsp, from, to);
    });

    const remote = DOC(4);
    const started = Date.now();
    const applied = engine.handleNodeSaved({
      nodeId: 7, nodeType: 'site', path: 'folder/a.html', content: remote, modifiedAt: '2026-04-08T12:00:00Z'
    });
    const moved = engine.handleNodeMoved({ nodeId: 5, nodeType: 'folder', oldPath: 'folder', newPath: 'moved' });

    await bounded(Promise.all([applied, moved]), 2000);
    const elapsed = Date.now() - started;

    expect(fs.existsSync(folderDir)).toBe(false);
    expect(fs.readFileSync(movedChild, 'utf8')).toBe(remote);
    expect(h.core.get(movedChild)).toBe(room);
    expect(h.authority.identityAt(movedChild)).toBe(target.identity);
    expect(engine.repo.get(7).path).toBe('moved/a.html');
    expect(engine.stats.errors).toEqual([]);
    expect(synced).toHaveBeenCalledTimes(2);
    expect(renameTargets.filter((target) => target === child)).toHaveLength(1);
    expect(renameTargets.filter((target) => target === movedDir)).toHaveLength(1);
    expect(renameTargets.length).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(2000);
    expect(pendingKeys()).toEqual([]);
  });

  test('4. a staging budget too small refuses a real save before any backup', async () => {
    const h = harness({ liveBytes: 4096 });
    const file = path.join(h.dir, 'page.html');
    const hybrid = HYBRID({ root: { id: 'r' } });
    fs.writeFileSync(file, hybrid);
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority, isKnownPath: () => true });
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file, origin: a.origin, live: a.live
    });
    const room = h.core.open(file, hybrid, { nodeId: target.identity });
    expect(room).toBeTruthy();
    const baseline = pageBaseline(inspectPage(hybrid).tags);
    const before = await fsp.readFile(file);

    const res = await save(a.server, 'page.html', PAGE('x'.repeat(8000)), {
      'If-Match': documentEtag(before),
      'Page-Conversion': `v1; source=room; base=${baseline}; epoch=${room.epoch}`
    });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      msg: 'Page conversion refused: budget',
      msgType: 'error',
      code: 'page-capacity',
      reason: 'budget'
    });
    expect(res.headers['retry-after']).toBe('60');
    expect(await fsp.readFile(file)).toEqual(before);
    expect(room.seq).toBe(0);
    expect(room.pageTransition).toBeUndefined();
    expect(h.core.state(room).stores.page.value).toEqual({ blocks: { root: { id: 'r' } } });
    expect(h.core.pageReserved(file)).toBe(false);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);

    // The same path still accepts a page that does fit its budget.
    const fits = await save(a.server, 'page.html', PAGE('ok'), {
      'If-Match': documentEtag(before),
      'Page-Conversion': `v1; source=room; base=${baseline}; epoch=${room.epoch}`
    });
    expect(fits.status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toContain('"ok"');
    expect(room.seq).toBe(1);
    expect(h.fileWrittenCalls).toHaveLength(1);
    expect(savedBroadcasts()).toHaveLength(1);
    expect(pendingKeys()).toEqual([]);
  });

  test('5. a disk failure before the rename leaves no room commit and frees the reservation', async () => {
    const h = harness();
    const file = path.join(h.dir, 'page.html');
    fs.writeFileSync(file, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority, isKnownPath: () => true });
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file, origin: a.origin, live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: file, identity: target.identity
    }));
    expect(room).toBeTruthy();
    const before = await fsp.readFile(file);

    let refuse = true;
    const failed = [];
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (refuse && String(to) === file) {
        failed.push(String(to));
        throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      }
      return realRename.call(fsp, from, to);
    });

    const res = await save(a.server, 'page.html', PAGE('AAAA'), { 'If-Match': documentEtag(before) });

    expect(failed).toEqual([file]);
    expect(res.status).toBe(500);
    expect(res.body.msgType).toBe('error');
    expect(await fsp.readFile(file)).toEqual(before);
    expect(room.seq).toBe(0);
    expect(room.pageTransition).toBeUndefined();
    expect(h.core.state(room).stores.count.value).toEqual({ n: 0 });
    expect(h.core.pageReserved(file)).toBe(false);
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);

    // The released reservation is what lets the next save reserve again.
    refuse = false;
    const retry = await save(a.server, 'page.html', PAGE('AAAA'), { 'If-Match': documentEtag(before) });

    expect(retry.status).toBe(200);
    expect(fs.readFileSync(file, 'utf8')).toContain('AAAA');
    expect(room.seq).toBe(1);
    expect(room.pageTransition.format).toBe('yjs');
    expect(h.core.state(room).stores.page.value).toEqual({ v: 1, y: { doc: 'AAAA' } });
    expect(h.core.pageReserved(file)).toBe(false);
    expect(h.fileWrittenCalls).toHaveLength(1);
    expect(savedBroadcasts()).toHaveLength(1);
    expect(pendingKeys()).toEqual([]);
  });

  test('6a. a Tailwind failure after the confirmed rename keeps the bytes, the room and one write', async () => {
    const h = harness();
    const file = path.join(h.dir, 'styled.html');
    fs.writeFileSync(file, STYLED(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority, isKnownPath: () => true });
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'styled.html', canonicalPath: file, origin: a.origin, live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: file, identity: target.identity
    }));
    expect(room).toBeTruthy();

    const writes = [];
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === file) writes.push(String(to));
      return realRename.call(fsp, from, to);
    });
    compileTailwind.mockImplementationOnce(() => {
      throw new Error('simulated Tailwind compiler failure');
    });

    const res = await save(a.server, 'styled.html', STYLED(1));

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Saved');
    const written = await fsp.readFile(file, 'utf8');
    expect(written).toContain('"n":1');
    expect(res.body.etag).toBe(documentEtag(written));
    expect(writes).toEqual([file]);
    expect(h.core.state(room).stores.count.value).toEqual({ n: 1 });
    expect(h.fileWrittenCalls).toEqual([{ key: file, html: written }]);
    expect(savedBroadcasts()).toHaveLength(1);
    expect(compileTailwind).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls.some(([first]) => String(first).includes('compileTailwind failed'))).toBe(true);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'tailwindcss', 'styled.css'))).rejects.toThrow();
    expect(pendingKeys()).toEqual([]);
  });

  test('6b. an SSE broadcast failure after the confirmed rename keeps the bytes, the room and one write', async () => {
    const h = harness();
    const file = path.join(h.dir, 'index.html');
    fs.writeFileSync(file, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority, isKnownPath: () => true });
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'index.html', canonicalPath: file, origin: a.origin, live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: file, identity: target.identity
    }));
    expect(room).toBeTruthy();

    const writes = [];
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === file) writes.push(String(to));
      return realRename.call(fsp, from, to);
    });
    liveSync.broadcast.mockImplementationOnce(() => {
      throw new Error('simulated SSE broadcast failure');
    });

    const res = await save(a.server, 'index.html', DOC(3));

    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Saved');
    const written = await fsp.readFile(file, 'utf8');
    expect(written).toContain('"n":3');
    expect(res.body.etag).toBe(documentEtag(written));
    expect(writes).toEqual([file]);
    expect(h.core.state(room).stores.count.value).toEqual({ n: 3 });
    expect(h.fileWrittenCalls).toEqual([{ key: file, html: written }]);
    expect(liveSync.broadcast).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls.some(([first]) => String(first).includes('saved broadcast failed'))).toBe(true);
    expect(pendingKeys()).toEqual([]);
  });
});
