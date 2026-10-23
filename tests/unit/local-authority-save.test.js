// B3a: the browser save owns the shared boundary. Every fixture below drives the
// real HTTP route against a real temp file, the real document boundary and the
// real rooms package, so each count asserted is an actual operation: a request
// that landed, bytes that are on disk, a room that reconciled, a backup that
// exists -- or provably does not.

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

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('upath');
const { testPosix } = require('../helpers/platform');
const request = require('supertest');

const { liveSync } = require('livesync-hyperclay');
const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { documentEtag } = require('../../src/main/spec-wire');

const DOC = (value) => `<!DOCTYPE html><html><body><script type="application/json" merge="count" clay="live">${JSON.stringify({ n: value })}</script></body></html>`;
const PAGE = (value) => `<!DOCTYPE html><html><body><script type="application/json" merge="page" clay="live">${JSON.stringify({ v: 1, y: { doc: value } })}</script></body></html>`;

const dirs = [];
function tempDir() {
  const dir = path.resolve(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-save-'))));
  dirs.push(dir);
  return dir;
}

async function waitFor(check, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// One real authority over one real rooms core, with the reconciliation the
// confirmation performs recorded as it happens.
function harness() {
  const dir = tempDir();
  const core = createRooms({});
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

// The real authority with its read-only claim counted, so a fixture can tell when
// a queued request has captured its location and is waiting on the gate.
const countClaims = (authority) => {
  const claims = [];
  const counting = Object.create(authority);
  counting.captureAdmission = (location) => {
    claims.push(location);
    return authority.captureAdmission(location);
  };
  return { authority: counting, claims };
};

describe('B3a: the browser save through the shared boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    // The data-loss guard runs detached by design, so it can still be writing
    // into .hyperclay/guard after the response. Let it settle, and retry the
    // removal if it lands mid-teardown.
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const dir of dirs.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
    jest.restoreAllMocks();
  });

  test('one save reconciles the room once and reaches both aliased roots', async () => {
    const h = harness();
    const indexPath = path.join(h.dir, 'index.html');
    fs.writeFileSync(indexPath, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    const b = await startApp({ dir: h.dir, rootId: 'root-b', authority: h.authority });

    // The document's one room, opened the way the live lane opens it, over the
    // very binding this root's own save uses.
    const target = h.authority.bindTarget({
      rootId: 'root-a',
      logicalPath: 'index.html',
      canonicalPath: indexPath,
      origin: a.origin,
      live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: indexPath,
      identity: target.identity
    }));
    expect(room).toBeTruthy();

    // A save through each root is what registers that root's logical alias.
    expect((await save(a.server, 'index.html', DOC(1))).status).toBe(200);
    expect((await save(b.server, 'index.html', DOC(2))).status).toBe(200);

    liveSync.broadcast.mockClear();
    h.fileWrittenCalls.length = 0;

    const res = await save(a.server, 'index.html', DOC(3));
    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Saved');

    const written = await fsp.readFile(indexPath, 'utf8');
    expect(res.body.etag).toBe(documentEtag(written));
    expect(h.fileWrittenCalls).toEqual([{ key: indexPath, html: written }]);

    // The one room holds what the save stored, not what the request sent.
    const reconciled = h.core.get(indexPath);
    expect(h.core.state(reconciled).stores.count.value).toEqual({ n: 3 });

    const sent = savedBroadcasts();
    expect(sent.map(([key]) => key).sort()).toEqual(['root-a:index.html', 'root-b:index.html']);
    for (const [, payload, opts] of sent) {
      expect(payload).toEqual({ html: written, sender: 'server-save' });
      expect(opts).toEqual({ lane: 'saved' });
    }
  });

  test('a first save of a document that does not exist yet still lands', async () => {
    const h = harness();
    const indexPath = path.join(h.dir, 'index.html');
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });

    const res = await save(a.server, 'index.html', DOC(1));

    expect(res.status).toBe(200);
    const written = await fsp.readFile(indexPath, 'utf8');
    expect(written).toContain('"n":1');
    expect(res.body.etag).toBe(documentEtag(written));
    expect(h.fileWrittenCalls).toEqual([{ key: indexPath, html: written }]);
    expect(savedBroadcasts()).toHaveLength(1);
  });

  test('a refused page conversion writes nothing and creates no backup', async () => {
    const h = harness();
    const indexPath = path.join(h.dir, 'index.html');
    fs.writeFileSync(indexPath, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    const before = await fsp.readFile(indexPath);

    const res = await save(a.server, 'index.html', DOC(1), {
      'If-Match': documentEtag(before),
      'Page-Conversion': `v1; source=file; base=${'a'.repeat(64)}`
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'Page conversion refused: invalid-source',
      msgType: 'error',
      code: 'page-conversion-refused',
      reason: 'invalid-source'
    });
    expect(await fsp.readFile(indexPath)).toEqual(before);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });

  test('an authorized page initialization commits one page transition', async () => {
    const h = harness();
    const indexPath = path.join(h.dir, 'index.html');
    fs.writeFileSync(indexPath, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    const target = h.authority.bindTarget({
      rootId: 'root-a',
      logicalPath: 'index.html',
      canonicalPath: indexPath,
      origin: a.origin,
      live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: indexPath,
      identity: target.identity
    }));
    expect(room).toBeTruthy();
    const before = await fsp.readFile(indexPath);

    const res = await save(a.server, 'index.html', PAGE('AAAA'), { 'If-Match': documentEtag(before) });

    expect(res.status).toBe(200);
    const written = await fsp.readFile(indexPath, 'utf8');
    expect(res.body.etag).toBe(documentEtag(written));
    // The reservation was held across the backup and the write, then committed
    // into the room this document already had.
    const committed = h.core.get(indexPath);
    expect(committed.pageTransition.format).toBe('yjs');
    expect(h.core.state(committed).stores.page.value).toEqual({ v: 1, y: { doc: 'AAAA' } });
    expect(h.fileWrittenCalls).toEqual([{ key: indexPath, html: written }]);
    expect(savedBroadcasts()).toHaveLength(1);
  });

  test('an unauthorized page initialization is refused with 428 before any write', async () => {
    const h = harness();
    const indexPath = path.join(h.dir, 'index.html');
    fs.writeFileSync(indexPath, DOC(0));
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    const before = await fsp.readFile(indexPath);

    const res = await save(a.server, 'index.html', PAGE('AAAA'));

    expect(res.status).toBe(428);
    expect(res.body).toEqual({
      msg: 'Page conversion refused: file-changed',
      msgType: 'error',
      code: 'page-condition-required',
      reason: 'file-changed'
    });
    expect(await fsp.readFile(indexPath)).toEqual(before);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
    expect(h.fileWrittenCalls).toHaveLength(0);
  });

  test('a legacy createApp(dir) save still succeeds and still publishes', async () => {
    const dir = tempDir();
    const indexPath = path.join(dir, 'index.html');
    fs.writeFileSync(indexPath, DOC(0));
    const server = await listenLoopback(createApp(dir));

    const res = await save(server, 'index.html', DOC(5));

    expect(res.status).toBe(200);
    const written = await fsp.readFile(indexPath, 'utf8');
    expect(written).toContain('"n":5');
    expect(res.body.etag).toBe(documentEtag(written));
    expect(savedBroadcasts()).toEqual([
      ['index.html', { html: written, sender: 'server-save' }, { lane: 'saved' }]
    ]);
  });

  test('a folder move admitted first makes a pre-resolved child save return 409', async () => {
    const h = harness();
    const oldDir = path.join(h.dir, 'old');
    const newDir = path.join(h.dir, 'new');
    fs.mkdirSync(oldDir);
    const oldFile = path.join(oldDir, 'page.html');
    const newFile = path.join(newDir, 'page.html');
    fs.writeFileSync(oldFile, DOC(0));
    h.authority.registerRoot({ id: 'root-a', path: h.dir, canonicalPath: h.dir }, { owner: 'server' });
    const target = h.authority.bindTarget({ rootId: 'root-a', logicalPath: 'old/page.html', canonicalPath: oldFile });
    const room = h.core.open(oldFile, DOC(0), { nodeId: target.identity });
    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const moving = withStructureChange(async (token) => {
      await held;
      const plan = h.authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [structureStep({ from: oldDir, to: newDir, fromRel: 'old', toRel: 'new', isDir: true })],
      });
      try {
        fs.renameSync(oldDir, newDir);
        h.authority.commitStructure(plan, 1, token);
      } finally {
        h.authority.releaseStructure(plan, token);
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    const pending = save(a.server, 'old/page.html', DOC(1)).then((res) => res);
    await waitFor(() => claims.length > 0, 'the save to capture the old child');

    release();
    await moving;
    const response = await pending;

    expect(response.status).toBe(409);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.readFileSync(newFile, 'utf8')).toBe(DOC(0));
    expect(h.core.get(newFile)).toBe(room);
    expect(h.authority.identityAt(newFile)).toBe(target.identity);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
  });

  test('an external replacement retires a queued save claim before it can write', async () => {
    const h = harness();
    const file = path.join(h.dir, 'page.html');
    fs.writeFileSync(file, DOC(0));
    h.authority.registerRoot({ id: 'root-a', path: h.dir, canonicalPath: h.dir }, { owner: 'server' });
    const oldTarget = h.authority.bindTarget({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file });
    const room = await h.authority.roomFor(oldTarget, async () => ({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file, identity: oldTarget.identity,
    }));
    expect(h.core.apply(room, 'client', {
      name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 7 }],
    }, { connected: ['client'] }).error).toBeUndefined();
    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority });
    const foreign = DOC(99);
    fs.writeFileSync(file, foreign);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const observed = withDocumentWrite(async () => ({ canonicalPath: file }), async (_target, token) => {
      entered();
      await held;
      await h.authority.observeExternal(oldTarget, foreign, token);
    });
    await started;
    const pending = save(a.server, 'page.html', DOC(1)).then((res) => res);
    await waitFor(() => claims.length > 0, 'the save to capture the old generation');

    release();
    await observed;
    const response = await pending;

    expect(response.status).toBe(409);
    expect(fs.readFileSync(file, 'utf8')).toBe(foreign);
    expect(h.authority.identityAt(file)).not.toBe(oldTarget.identity);
    expect(h.core.get(file)).toBeNull();
    expect(fs.readdirSync(path.join(h.dir, '.hyperclay', 'recovered', 'page'))).toHaveLength(1);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
  });

  test('a queued save whose name resolves elsewhere is refused before mkdir or backup', async () => {
    const h = harness();
    fs.mkdirSync(path.join(h.dir, 'sub-real'));
    fs.mkdirSync(path.join(h.dir, 'sub-other'));
    fs.symlinkSync('sub-real', path.join(h.dir, 'sub'));
    const known = [];
    const a = await startApp({
      dir: h.dir,
      rootId: 'root-a',
      authority: h.authority,
      isKnownPath: (...args) => { known.push(args); return true; }
    });

    // Hold the shared gate the way a structure move will, so the save below is
    // queued before its own resolver runs.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holder = withStructureChange(() => held);
    await new Promise((resolve) => setImmediate(resolve));

    const pending = save(a.server, 'sub/index.html', DOC(1)).then((res) => res);
    await waitFor(() => known.length >= 1, 'the route to resolve its target');

    // The name now points at a different file than the one this request claimed.
    fs.unlinkSync(path.join(h.dir, 'sub'));
    fs.symlinkSync('sub-other', path.join(h.dir, 'sub'));
    release();
    await holder;

    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'moved-or-deleted'
    });
    expect(fs.existsSync(path.join(h.dir, 'sub-other', 'index.html'))).toBe(false);
    expect(fs.existsSync(path.join(h.dir, 'sub-real', 'index.html'))).toBe(false);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });

  test.each([['canonical retirement', 'canonical'], ['logical retirement', 'logical']])(
    'a queued save whose captured identity was retired by %s is refused before any write', async (_, space) => {
      const h = harness();
      const indexPath = path.join(h.dir, 'index.html');
      fs.writeFileSync(indexPath, DOC(0));
      h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
      const { authority, claims } = countClaims(h.authority);
      const a = await startApp({ dir: h.dir, rootId: 'root-a', authority });
      const before = await fsp.readFile(indexPath);

      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const holder = withStructureChange(async (token) => {
        await held;
        h.authority.setAdmission(token, space === 'canonical'
          ? { canonicalPath: indexPath, active: false }
          : { rootId: 'root-a', logicalPath: 'index.html', active: false });
      });
      await new Promise((resolve) => setImmediate(resolve));

      const pending = save(a.server, 'index.html', DOC(1)).then((res) => res);
      await waitFor(() => claims.length >= 1, 'the save to capture its claim');
      release();
      await holder;

      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('moved-or-deleted');
      expect(await fsp.readFile(indexPath)).toEqual(before);
      await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
      expect(h.fileWrittenCalls).toHaveLength(0);
      expect(savedBroadcasts()).toHaveLength(0);
    }
  );

  test('a save whose claim was captured before a structure move is refused and recreates nothing', async () => {
    const h = harness();
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const sub = path.join(h.dir, 'sub');
    const movedSub = path.join(h.dir, 'sub-moved');
    const indexPath = path.join(sub, 'index.html');
    fs.mkdirSync(sub);
    fs.writeFileSync(indexPath, DOC(0));
    const original = await fsp.readFile(indexPath);

    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({
      dir: h.dir,
      rootId: 'root-a',
      authority,
      isKnownPath: () => true
    });

    // Hold the shared gate the way a structure move will, so the save below is
    // queued before its own resolver runs. The move and its commit happen inside
    // the same transaction, while the save waits.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const structure = withStructureChange(async (token) => {
      await held;
      const plan = h.authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [structureStep({ from: sub, to: movedSub, fromRel: 'sub', toRel: 'sub-moved', isDir: true })]
      });
      try {
        fs.renameSync(sub, movedSub);
        h.authority.commitStructure(plan, 1, token);
      } finally {
        h.authority.releaseStructure(plan, token);
      }
    });
    await new Promise((resolve) => setImmediate(resolve));

    const pending = save(a.server, 'sub/index.html', DOC(1)).then((res) => res);
    await waitFor(() => claims.length >= 1, 'the save to capture its claim');
    release();
    await structure;

    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'moved-or-deleted'
    });
    // The physical move really happened: the folder is gone and the document it
    // carried is untouched, so the refused save recreated neither.
    expect(fs.existsSync(movedSub)).toBe(true);
    expect(await fsp.readFile(path.join(movedSub, 'index.html'))).toEqual(original);
    expect(fs.existsSync(sub)).toBe(false);
    expect(fs.existsSync(indexPath)).toBe(false);
    await expect(fsp.access(path.join(h.dir, '.hyperclay', 'versions'))).rejects.toThrow();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });

  test('an accepted save lands before a queued structure move, which carries its bytes', async () => {
    const h = harness();
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const indexPath = path.join(h.dir, 'index.html');
    const movedPath = path.join(h.dir, 'moved.html');
    fs.writeFileSync(indexPath, DOC(0));

    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({
      dir: h.dir,
      rootId: 'root-a',
      authority,
      isKnownPath: () => true
    });

    // Every real rename: the save's own atomic publication, then the move's.
    let renames = 0;
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      renames += 1;
      return realRename.call(fsp, from, to);
    });
    const realRenameSync = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      renames += 1;
      return realRenameSync.call(fs, from, to);
    });

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holder = withStructureChange(() => held);
    await new Promise((resolve) => setImmediate(resolve));

    const pending = save(a.server, 'index.html', DOC(7)).then((res) => res);
    await waitFor(() => claims.length >= 1, 'the save to capture its claim');

    // Queued behind the save's own boundary, so the bytes it moves are the bytes
    // the save confirmed.
    const structure = withStructureChange(async (token) => {
      const plan = h.authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [structureStep({ from: indexPath, to: movedPath, fromRel: 'index.html', toRel: 'moved.html' })]
      });
      try {
        fs.renameSync(indexPath, movedPath);
        h.authority.commitStructure(plan, 1, token);
      } finally {
        h.authority.releaseStructure(plan, token);
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await holder;

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.msg).toBe('Saved');

    const moved = await fsp.readFile(movedPath, 'utf8');
    expect(moved).toContain('"n":7');
    expect(res.body.etag).toBe(documentEtag(moved));
    expect(h.fileWrittenCalls).toEqual([{ key: indexPath, html: moved }]);
    expect(savedBroadcasts()).toHaveLength(1);

    await structure;
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(fs.existsSync(movedPath)).toBe(true);
    expect(renames).toBeGreaterThanOrEqual(2);
  });

  testPosix('a first save the disk refuses leaves no authority identity or binding', async () => {
    const h = harness();
    const sub = path.join(h.dir, 'sub');
    const target = path.join(sub, 'new.html');
    fs.mkdirSync(sub);

    let ids = 0;
    const authority = createLocalAuthority({
      rooms: h.rooms,
      withDocument: withDocumentWrite,
      newId: () => `id${++ids}`
    });
    const a = await startApp({
      dir: h.dir,
      rootId: 'root-a',
      authority,
      isKnownPath: () => true
    });

    // A real refusal at the one step that publishes the bytes.
    fs.chmodSync(sub, 0o555);
    let res;
    try {
      res = await save(a.server, 'sub/new.html', DOC(1));
    } finally {
      fs.chmodSync(sub, 0o755);
    }

    expect(res.status).toBe(500);
    expect(res.body.msgType).toBe('error');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(sub)).toEqual([]);
    expect(authority.identityAt(target)).toBeNull();
    expect(authority.confirmedStamp(target)).toBeNull();
    expect(authority.findBoundTarget({
      rootId: 'root-a', logicalPath: 'sub/new.html', origin: a.origin
    })).toBeNull();
    expect(authority.rooms.get(target)).toBeNull();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });
});
