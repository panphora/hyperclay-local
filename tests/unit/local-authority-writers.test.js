// B2: post-persistence confirmation. A real temp file, the real document boundary
// and the real rooms package, so every count asserted below is an actual operation
// rather than a mocked expectation.

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
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn(),
  parseExtractionRules: jest.fn(),
  writeViaTag: jest.fn(),
  writeWithRules: jest.fn()
}));

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('upath');

// A request still in flight when a test fails is destroyed by closeLoopback; owning its
// rejection keeps that from becoming an uncaught error that ends the whole jest run.
const inFlight = (promise) => { promise.catch(() => {}); return promise; };
const request = require('supertest');
const { createRooms } = require('@panphora/clayjs/server/rooms');
const { liveSync } = require('livesync-hyperclay');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { createRootLive } = require('../../src/main/utils/root-live');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { documentEtag } = require('../../src/main/spec-wire');
const { extractViaTag, writeViaTag } = require('../../src/main/utils/data-extractor');
const { RootObserver } = require('../../src/main/root-observer');
const dataGuard = require('../../src/main/data-loss-guard.js');

const tag = (name, value) => `<script type="application/json" merge="${name}" clay="live">${JSON.stringify(value)}</script>`;
const doc = (value) => `<!doctype html><html><body>${tag('count', value)}</body></html>`;

const dirs = [];
function tempDir() {
  const dir = path.resolve(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-writers-'))));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function harness({ file = 'doc.html', initial = doc({ n: 0 }) } = {}) {
  const dir = tempDir();
  const canonicalPath = path.join(dir, file);
  fs.writeFileSync(canonicalPath, initial);

  const core = createRooms({});
  const fileWrittenCalls = [];
  const rooms = {
    ...core,
    fileWritten(key, html, opts) {
      fileWrittenCalls.push({ key, html });
      return core.fileWritten(key, html, opts);
    },
  };
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });

  const broadcasts = new Map();
  const liveFor = (id) => ({
    broadcast: (rel, payload, opts) => {
      if (!broadcasts.has(id)) broadcasts.set(id, []);
      broadcasts.get(id).push({ rel, payload, opts });
    },
  });
  const bind = (over = {}) => authority.bindTarget({
    rootId: 'root-a', logicalPath: '/doc.html', canonicalPath, origin: 'http://127.0.0.1:7000',
    live: liveFor(over.rootId ?? 'root-a'), ...over,
  });
  return { dir, canonicalPath, authority, core, fileWrittenCalls, broadcasts, bind };
}

async function persist({ authority, target, bytes, options }) {
  let stamp = null;
  await withDocumentWrite(async () => target, async (resolved, token) => {
    await fs.promises.writeFile(resolved.canonicalPath, bytes);
    stamp = await authority.confirmKnownWrite(resolved, bytes, token, options);
  });
  return stamp;
}

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

test('an HTML write confirms the final bytes and reconciles one open room', async () => {
  const h = harness();
  const target = h.bind();
  const events = [];
  const member = h.authority.registerEditor(target, {
    clientId: 'cA', send: (event, payload) => events.push([event, payload]),
  });
  await h.authority.roomFor(target, async () => ({ canonicalPath: h.canonicalPath, identity: target.identity }));

  const html = doc({ n: 1 });
  const stamp = await persist({ authority: h.authority, target, bytes: html });

  expect(stamp.identity).toBe(target.identity);
  expect(stamp.etag).toBe(documentEtag(html));
  expect(stamp.size).toBe(BigInt(Buffer.byteLength(html)));
  expect(typeof stamp.ino).toBe('bigint');
  expect(typeof stamp.mtimeNs).toBe('bigint');
  expect(h.fileWrittenCalls).toEqual([{ key: h.canonicalPath, html }]);
  expect(events.filter(([event]) => event === 'data-state')).toHaveLength(1);
  expect(h.broadcasts.get('root-a')).toHaveLength(1);
  member.close();
});

test('two logical aliases each receive exactly one saved event', async () => {
  const h = harness();
  const a = h.bind();
  const b = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' });

  const html = doc({ n: 2 });
  await persist({ authority: h.authority, target: a, bytes: html });

  expect(h.broadcasts.get('root-a')).toEqual([
    { rel: '/doc.html', payload: { html, sender: 'server-save' }, opts: { lane: 'saved' } },
  ]);
  expect(h.broadcasts.get('root-b')).toEqual([
    { rel: '/alias/doc.html', payload: { html, sender: 'server-save' }, opts: { lane: 'saved' } },
  ]);
  expect(a.identity).toBe(b.identity);
});

test('the method manufactures no delayed second confirmation', async () => {
  const h = harness();
  const target = h.bind();
  const html = doc({ n: 3 });
  const stamp = await persist({ authority: h.authority, target, bytes: html });
  const writes = h.fileWrittenCalls.length;
  const sent = h.broadcasts.get('root-a').length;

  await new Promise((resolve) => setTimeout(resolve, 25));

  expect(stamp).not.toBeNull();
  expect(writes).toBe(1);
  expect(sent).toBe(1);
  expect(h.fileWrittenCalls).toHaveLength(writes);
  expect(h.broadcasts.get('root-a')).toHaveLength(sent);
});

test('a Buffer asset records a stamp but emits no HTML', async () => {
  const h = harness({ file: 'asset.png', initial: Buffer.from([0, 1, 2, 3]) });
  const target = h.bind({ logicalPath: '/asset.png' });
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

  const stamp = await persist({ authority: h.authority, target, bytes });

  expect(stamp.identity).toBe(target.identity);
  expect(stamp.etag).toBe(documentEtag(bytes));
  expect(stamp.size).toBe(BigInt(bytes.length));
  expect(typeof stamp.dev).toBe('bigint');
  expect(typeof stamp.ino).toBe('bigint');
  expect(typeof stamp.mtimeNs).toBe('bigint');
  expect(h.fileWrittenCalls).toHaveLength(0);
  expect(h.broadcasts.size).toBe(0);
});

test('a root stays registered while any owner remains, and a retarget is refused', () => {
  const h = harness();
  const target = h.bind();
  const member = h.authority.registerEditor(target, { clientId: 'cA', send: () => {} });
  const find = () => h.authority.findBoundTarget({
    rootId: 'root-a', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7000',
  });

  h.authority.registerRoot({ id: 'root-a', path: '/tmp/root-a' });
  h.authority.registerRoot({ id: 'root-a', path: '/tmp/root-a' }, { owner: 'session-1' });
  expect(() => h.authority.registerRoot({ id: 'root-a', path: '/tmp/root-a-other' })).toThrow();

  h.authority.closeRoot('root-a');
  expect(find()).toBe(target);
  expect(h.authority.currentEditor(target, 'cA', member.conn)).toBe(member);

  h.authority.closeRoot('root-a', { owner: 'session-1' });
  expect(find()).toBeNull();

  expect(() => h.authority.closeRoot('root-unknown')).not.toThrow();
  member.close();
});

describe('B4: the root data API through the shared boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractViaTag.mockReset();
    writeViaTag.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    jest.restoreAllMocks();
  });

  async function waitFor(check, what, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${what}`);
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

  const savedBroadcasts = () =>
    liveSync.broadcast.mock.calls.filter(([, , opts]) => opts && opts.lane === 'saved');

  const dataPost = (server, name, body) =>
    request(server)
      .post(`/_/api/${name}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

  test('a root API POST confirms the final bytes in the room and both alias saved lanes once', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const indexPath = path.join(h.dir, 'doc.html');
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    const b = await startApp({ dir: h.dir, rootId: 'root-b', authority: h.authority });

    // The one room, opened over the very binding this root's route uses.
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: indexPath, origin: a.origin, live: a.live
    });
    const room = await h.authority.roomFor(target, async () => ({
      canonicalPath: indexPath, identity: target.identity
    }));
    expect(room).toBeTruthy();
    // A second root aliases the same canonical file, so the confirmation owes it a lane too.
    h.authority.bindTarget({
      rootId: 'root-b', logicalPath: 'doc.html', canonicalPath: indexPath, origin: b.origin, live: b.live
    });

    writeViaTag.mockResolvedValue({ html: doc({ n: 1 }), changed: true, spliced: true });
    extractViaTag.mockResolvedValue({ n: 1 });
    liveSync.broadcast.mockClear();

    const res = await dataPost(a.server, 'doc.html', { n: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ n: 1 });
    const written = fs.readFileSync(indexPath, 'utf8');
    expect(h.fileWrittenCalls).toEqual([{ key: indexPath, html: written }]);

    const reconciled = h.core.get(indexPath);
    expect(h.core.state(reconciled).stores.count.value).toEqual({ n: 1 });

    const sent = savedBroadcasts();
    expect(sent.map(([key]) => key).sort()).toEqual(['root-a:doc.html', 'root-b:doc.html']);
    for (const [, payload, opts] of sent) {
      expect(payload).toEqual({ html: written, sender: 'data-api' });
      expect(opts).toEqual({ lane: 'saved' });
    }
  });

  test('a root API GET sidecar refresh waits behind a held write and reads the newer bytes', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const indexPath = path.join(h.dir, 'doc.html');
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority: h.authority });
    extractViaTag.mockResolvedValue({ n: 1 });

    // A document write (what a save holds) on the same canonical file, kept open
    // with the shared file slot so the refresh below has to queue behind it.
    const heldTarget = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: indexPath, origin: a.origin, live: a.live
    });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holder = withDocumentWrite(async () => heldTarget, () => held);
    await new Promise((resolve) => setImmediate(resolve));

    const pending = request(a.server).get('/_/api/doc.html').then((res) => res);
    pending.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));

    // Held: the refresh has not read or extracted anything yet.
    expect(extractViaTag).not.toHaveBeenCalled();

    const newer = doc({ n: 1 });
    fs.writeFileSync(indexPath, newer);
    release();
    await holder;

    const res = await pending;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ n: 1 });
    expect(extractViaTag).toHaveBeenCalledTimes(1);
    expect(extractViaTag.mock.calls[0][0]).toContain('"n":1');
    expect(fs.readFileSync(path.join(h.dir, '.hyperclay', 'api-v2', 'doc.html.json'), 'utf8')).toBe('{"n":1}');
  });

  test('a stale queued root API write refuses 409 before any backup or write', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const indexPath = path.join(h.dir, 'doc.html');
    const before = fs.readFileSync(indexPath);

    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const { authority, claims } = countClaims(h.authority);
    const a = await startApp({ dir: h.dir, rootId: 'root-a', authority });
    writeViaTag.mockResolvedValue({ html: doc({ n: 1 }), changed: true });

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holder = withStructureChange(async (token) => {
      await held;
      h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: indexPath, active: false });
    });
    await new Promise((resolve) => setImmediate(resolve));

    const pending = dataPost(a.server, 'doc.html', { n: 1 }).then((res) => res);
    pending.catch(() => {});
    await waitFor(() => claims.length >= 1, 'the write to capture its claim');
    release();
    await holder;

    const res = await pending;

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'moved-or-deleted'
    });
    expect(fs.readFileSync(indexPath)).toEqual(before);
    expect(fs.existsSync(path.join(h.dir, '.hyperclay', 'versions'))).toBe(false);
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(writeViaTag).not.toHaveBeenCalled();
  });
});

describe('B5: the authority Restore and data-loss writeBack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    jest.restoreAllMocks();
  });

  const VERSION = '2020-01-01-00-00-00-000+0000.html';

  const savedBroadcasts = () =>
    liveSync.broadcast.mock.calls.filter(([, , opts]) => opts && opts.lane === 'saved');

  const makeRoot = (id, dir) => {
    const root = { id, kind: 'team', path: dir, port: 0 };
    return { root, live: createRootLive(root) };
  };

  async function startApp({ root, live, authority = null, observer = null, isKnownPath = null }) {
    const ctx = {
      root, live, devHooks: null, isKnownPath, observer,
      helpers: null, syncEngineFor: null, person: null, localAuthority: authority,
    };
    const server = await listenLoopback(createApp(ctx));
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
  }

  async function waitFor(check, what, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  const seedVersion = (dir, rel, name, html) => {
    const versionDir = path.join(dir, '.hyperclay', 'versions', rel.replace(/\.(html|htmlclay)$/i, ''));
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, name), html);
    return versionDir;
  };

  // The one structure transaction the server drives: the physical removal, then
  // the committed prefix that drops the record and retires both names.
  const retireDocument = (authority, docPath) => withStructureChange(async (token) => {
    const plan = authority.prepareStructure(token, {
      rootId: 'root-a',
      steps: [structureStep({ from: docPath, to: null, fromRel: 'doc.html', toRel: null })]
    });
    try {
      fs.unlinkSync(docPath);
      authority.commitStructure(plan, 1, token);
    } finally {
      authority.releaseStructure(plan, token);
    }
  });

  test('an authority Restore writes the version and publishes one saved event per alias', async () => {
    const h = harness({ initial: doc({ n: 2 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const versionDir = seedVersion(h.dir, 'doc.html', VERSION, doc({ n: 1 }));

    const rootA = makeRoot('root-a', h.dir);
    const observer = new RootObserver(rootA.root, { live: rootA.live });
    const changes = [];
    observer.on('change', (event) => changes.push(event));
    const rootB = makeRoot('root-b', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority: h.authority, observer });
    const b = await startApp({ root: rootB.root, live: rootB.live, authority: h.authority });

    const targetA = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, origin: a.origin, live: rootA.live,
    });
    h.authority.bindTarget({
      rootId: 'root-b', logicalPath: 'doc.html', canonicalPath: docPath, origin: b.origin, live: rootB.live,
    });
    const room = await h.authority.roomFor(targetA, async () => ({
      canonicalPath: docPath, identity: targetA.identity,
    }));
    expect(room).toBeTruthy();
    liveSync.broadcast.mockClear();
    liveSync.notify.mockClear();

    const res = await request(a.server).post(`/_/restore/doc.html/${VERSION}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, msg: `Restored ${VERSION}`, msgType: 'success' });

    // The restored bytes are what is on disk, and the one open room reconciled to them.
    const written = fs.readFileSync(docPath, 'utf8');
    expect(written).toContain('"n":1');
    expect(written).not.toContain('"n":2');
    expect(h.core.state(h.core.get(docPath)).stores.count.value).toEqual({ n: 1 });

    // Mandatory safety copy of the bytes the restore replaced, still in the store.
    const safety = fs.readdirSync(versionDir)
      .map((name) => fs.readFileSync(path.join(versionDir, name), 'utf8'))
      .filter((bytes) => bytes.includes('"n":2'));
    expect(safety.length).toBeGreaterThan(0);

    // One saved publication per alias, carrying the bytes that landed. The observer
    // must not add a second one for the root that ran the restore.
    const sent = savedBroadcasts();
    expect(sent.map(([key]) => key).sort()).toEqual(['root-a:doc.html', 'root-b:doc.html']);
    for (const [, payload, opts] of sent) {
      expect(payload).toEqual({ html: written, sender: 'server-save' });
      expect(opts).toEqual({ lane: 'saved' });
    }

    // The edit-mode notification still happens, and still emits the observer change.
    expect(liveSync.notify).toHaveBeenCalledTimes(1);
    expect(liveSync.notify).toHaveBeenCalledWith(
      'root-a:doc.html',
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'external-change', html: written }),
      }),
      undefined
    );
    expect(changes.map((event) => event.kind)).toEqual(['external']);
    expect(changes[0].html).toBe(written);
    observer.stop();
  });

  test('a stale queued restore refuses 409 before any safety backup', async () => {
    const h = harness({ initial: doc({ n: 2 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const versionDir = seedVersion(h.dir, 'doc.html', VERSION, doc({ n: 1 }));
    const before = fs.readFileSync(docPath);
    const versionsBefore = fs.readdirSync(versionDir);

    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const { authority, claims } = countClaims(h.authority);
    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const target = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, origin: a.origin, live: rootA.live,
    });
    expect(h.authority.identityAt(docPath)).toBe(target.identity);

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const holder = withStructureChange(async (token) => {
      await held;
      h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, active: false });
    });
    await new Promise((resolve) => setImmediate(resolve));

    const pending = request(a.server).post(`/_/restore/doc.html/${VERSION}`).then((res) => res);
    pending.catch(() => {});
    await waitFor(() => claims.length >= 1, 'the restore to capture its claim');
    release();
    await holder;

    const res = await pending;

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: 'This file has been moved or deleted. Please refresh the page.',
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
    });
    expect(fs.readFileSync(docPath)).toEqual(before);
    expect(fs.readdirSync(versionDir)).toEqual(versionsBefore);
    expect(h.authority.identityAt(docPath)).toBeNull();
  });

  test('an ordinary version restores to a retired, absent document and a fresh claim validates', async () => {
    const h = harness({ initial: doc({ n: 2 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const versionDir = seedVersion(h.dir, 'doc.html', VERSION, doc({ n: 1 }));
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });

    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({
      root: rootA.root, live: rootA.live, authority: h.authority, isKnownPath: () => false,
    });
    const location = { rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath };
    const target = h.authority.bindTarget({ ...location, origin: a.origin, live: rootA.live });
    expect(h.authority.identityAt(docPath)).toBe(target.identity);

    // Moved away: the file is gone, the authority drops that generation's record
    // and retires the canonical and the logical name.
    await retireDocument(h.authority, docPath);
    expect(fs.existsSync(docPath)).toBe(false);
    expect(h.authority.isRetired(location)).toBe(true);
    expect(h.authority.identityAt(docPath)).toBeNull();

    // Every real rename: this restore's one atomic publication.
    let renames = 0;
    const fsp = require('fs').promises;
    const realRename = fsp.rename;
    jest.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      renames += 1;
      return realRename.call(fsp, from, to);
    });

    const res = await request(a.server).post(`/_/restore/doc.html/${VERSION}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, msg: `Restored ${VERSION}`, msgType: 'success' });

    const written = fs.readFileSync(docPath, 'utf8');
    expect(written).toContain('"n":1');
    expect(renames).toBeGreaterThan(0);
    expect(h.fileWrittenCalls).toEqual([{ key: docPath, html: written }]);
    expect(savedBroadcasts().map(([key]) => key)).toEqual(['root-a:doc.html']);

    // The confirmation installed the staged identity and cleared the retirement.
    expect(h.authority.isRetired(location)).toBe(false);
    expect(h.authority.identityAt(docPath)).not.toBeNull();
    expect(h.authority.confirmedStamp(docPath)).not.toBeNull();
    const fresh = h.authority.captureAdmission(location);
    await expect(withDocumentWrite(
      async () => ({ canonicalPath: docPath }),
      (_locked, token) => h.authority.validateAdmission(fresh, location, token),
    )).resolves.toBe(true);

    // The source version survived, and no safety copy of the replaced document
    // was made: it was absent, so there were no bytes to lose.
    const names = fs.readdirSync(versionDir);
    expect(names).toContain(VERSION);
    for (const name of names) {
      if (name === VERSION) continue;
      expect(fs.readFileSync(path.join(versionDir, name), 'utf8')).not.toContain('"n":2');
    }
  });

  test('Restore refuses a retired name occupied by an untracked file', async () => {
    const h = harness({ initial: doc({ n: 2 }) });
    const docPath = path.join(h.dir, 'doc.html');
    seedVersion(h.dir, 'doc.html', VERSION, doc({ n: 1 }));
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });

    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({
      root: rootA.root, live: rootA.live, authority: h.authority, isKnownPath: () => true,
    });
    h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, origin: a.origin, live: rootA.live,
    });
    await retireDocument(h.authority, docPath);
    const untracked = doc({ n: 99 });
    fs.writeFileSync(docPath, untracked);

    const res = await request(a.server).post(`/_/restore/doc.html/${VERSION}`);

    expect(res.status).toBe(409);
    expect(res.body.msg).toBe('This file has been moved or deleted. Please refresh the page.');
    expect(fs.readFileSync(docPath, 'utf8')).toBe(untracked);
    expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath })).toBe(true);
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });

  test('a restore whose source version is missing leaves the document absent and retired', async () => {
    const h = harness({ initial: doc({ n: 2 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const versionDir = seedVersion(h.dir, 'doc.html', VERSION, doc({ n: 1 }));
    const versionsBefore = fs.readdirSync(versionDir);
    const MISSING = '2021-02-02-00-00-00-000+0000.html';

    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({
      root: rootA.root, live: rootA.live, authority: h.authority, isKnownPath: () => false,
    });
    const location = { rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath };
    h.authority.bindTarget({ ...location, origin: a.origin, live: rootA.live });
    await retireDocument(h.authority, docPath);
    expect(h.authority.isRetired(location)).toBe(true);

    const res = await request(a.server).post(`/_/restore/doc.html/${MISSING}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      ok: false,
      error: 'version not found',
      msg: 'version not found',
      msgType: 'error',
      code: 'not-found',
    });
    // The early return confirmed nothing, so the retirement stands.
    expect(fs.existsSync(docPath)).toBe(false);
    expect(fs.readdirSync(versionDir)).toEqual(versionsBefore);
    expect(h.authority.isRetired(location)).toBe(true);
    expect(h.authority.identityAt(docPath)).toBeNull();
    expect(h.authority.confirmedStamp(docPath)).toBeNull();
    expect(h.authority.findBoundTarget({ ...location, origin: a.origin })).toBeNull();
    expect(h.fileWrittenCalls).toHaveLength(0);
    expect(savedBroadcasts()).toHaveLength(0);
  });

  test('a no-authority restore keeps its current behavior', async () => {
    const dir = tempDir();
    const docPath = path.join(dir, 'doc.html');
    fs.writeFileSync(docPath, doc({ n: 2 }));
    const versionDir = seedVersion(dir, 'doc.html', VERSION, doc({ n: 1 }));
    const server = await listenLoopback(createApp(dir));

    const res = await request(server).post(`/_/restore/doc.html/${VERSION}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, msg: `Restored ${VERSION}`, msgType: 'success' });
    const written = fs.readFileSync(docPath, 'utf8');
    expect(written).toContain('"n":1');
    expect(written).not.toContain('"n":2');

    // The mandatory safety copy of the replaced bytes is still made, and the
    // no-authority publication still goes out on the saved lane.
    const safety = fs.readdirSync(versionDir)
      .map((name) => fs.readFileSync(path.join(versionDir, name), 'utf8'))
      .filter((bytes) => bytes.includes('"n":2'));
    expect(safety.length).toBeGreaterThan(0);
    expect(savedBroadcasts()).toEqual([
      ['doc.html', { html: written, sender: 'server-save' }, { lane: 'saved' }],
    ]);
  });

  test('an authority data-loss revert publishes through writeBack and confirms the final bytes', async () => {
    const original = '<!DOCTYPE html><html><body><main data-island="a">GOOD</main></body></html>';
    const clobbered = '<!DOCTYPE html><html><body><main data-island="a"></main></body></html>';
    const h = harness({ initial: original });
    const docPath = path.join(h.dir, 'doc.html');

    const rootA = makeRoot('root-a', h.dir);
    const rootB = makeRoot('root-b', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority: h.authority });
    const b = await startApp({ root: rootB.root, live: rootB.live, authority: h.authority });

    const targetA = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, origin: a.origin, live: rootA.live,
    });
    h.authority.bindTarget({
      rootId: 'root-b', logicalPath: 'doc.html', canonicalPath: docPath, origin: b.origin, live: rootB.live,
    });
    const room = await h.authority.roomFor(targetA, async () => ({
      canonicalPath: docPath, identity: targetA.identity,
    }));
    expect(room).toBeTruthy();

    fs.writeFileSync(docPath, clobbered);
    // This file mocks the data extractor the real guard detects through, so the
    // detector is a focused stub; everything below it is the real route, the real
    // boundary, the real rooms package and the real publication helper.
    const restored = '<!DOCTYPE html><html><body><main data-island="a">GOOD</main><p>reverted</p></body></html>';
    const guardSpy = jest.spyOn(dataGuard, 'resolveGuard').mockImplementation(async ({ writeBack }) => {
      await writeBack(restored);
      return { ok: true, choice: 'revert', status: 'reverted' };
    });
    liveSync.broadcast.mockClear();

    const res = await request(a.server)
      .post('/data-loss')
      .send({ file: 'doc.html', id: 'event-1', choice: 'revert' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, choice: 'revert', status: 'reverted' });
    expect(guardSpy).toHaveBeenCalledTimes(1);
    expect(guardSpy.mock.calls[0][0].name).toBe('doc.html');

    const written = fs.readFileSync(docPath, 'utf8');
    expect(written).toContain('GOOD');
    // The confirmation ran through the real rooms package on the canonical path.
    expect(h.fileWrittenCalls).toEqual([{ key: docPath, html: written }]);
    const sent = savedBroadcasts();
    expect(sent.map(([key]) => key).sort()).toEqual(['root-a:doc.html', 'root-b:doc.html']);
    for (const [, payload, opts] of sent) {
      expect(payload).toEqual({ html: written, sender: 'server-save' });
      expect(opts).toEqual({ lane: 'saved' });
    }
  });
});

describe('B6: the authority upload and standalone Tailwind cache miss', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    jest.restoreAllMocks();
  });

  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(check, what, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) return;
      await settle(5);
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  const makeRoot = (id, dir) => {
    const root = { id, kind: 'team', path: dir, port: 0 };
    return { root, live: createRootLive(root) };
  };

  async function startApp({ root, live, authority = null }) {
    const ctx = {
      root, live, devHooks: null, isKnownPath: null, observer: null,
      helpers: null, syncEngineFor: null, person: null, localAuthority: authority,
    };
    const server = await listenLoopback(createApp(ctx));
    return { server, origin: `http://127.0.0.1:${server.address().port}` };
  }

  const uploadRequest = (server, { origin, docName, filename, bytes }) =>
    request(server)
      .post('/_/upload')
      .set('Origin', origin)
      .set('Document-URL', `${origin}/${docName}`)
      .attach('file', Buffer.from(bytes), filename);

  // The exact content-hash name storeUpload's first candidate takes, so a fixture
  // can retire or occupy that path before the request arrives.
  const candidateName = (bytes, filename = 'photo.png') => {
    const dot = filename.lastIndexOf('.');
    const stem = dot <= 0 ? filename : filename.slice(0, dot);
    const ext = dot <= 0 ? '' : filename.slice(dot);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    return `${stem}-${digest.slice(0, 6)}${ext}`;
  };

  const saveRequest = (server, { origin, docName, html }) =>
    request(server)
      .post('/save')
      .set('Document-URL', `${origin}/${docName}`)
      .set('Content-Type', 'text/html')
      .send(html);

  function startPausedUpload({ server, host, docUrl, filename, bytes }) {
    const boundary = 'b6-paused-boundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.from(bytes);
    const half = Math.floor(body.length / 2);
    let sent = 0;
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: '/_/upload',
      headers: {
        Host: host,
        Origin: `http://${host}`,
        'Document-URL': docUrl,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
    });
    const started = new Promise((resolve, reject) => {
      req.on('socket', (socket) => socket.once('connect', resolve));
      req.on('error', reject);
    });
    const response = new Promise((resolve, reject) => {
      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
    });
    started.catch(() => {});
    response.catch(() => {});
    req.write(head);
    req.write(body.slice(0, half));
    sent += half;
    return {
      started,
      bytesSent: () => sent,
      finish() { req.write(body.slice(half)); req.write(tail); sent += body.length - half; req.end(); },
      response,
    };
  }

  test('an upload body read holds no boundary while a document save runs', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const rootA = makeRoot('root-a', h.dir);

    const { authority, claims } = countClaims(h.authority);

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const host = a.origin.replace('http://', '');

    const up = startPausedUpload({
      server: a.server, host, docUrl: `${a.origin}/doc.html`, filename: 'photo.png', bytes: Buffer.from('PNGDATA'),
    });
    await up.started;
    await waitFor(() => claims.length >= 1, 'the upload to capture its admission claim');
    await settle(100);

    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual({ rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath });
    expect(h.authority.identityAt(docPath)).toBeNull();
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'doc.html', origin: a.origin })).toBeNull();

    // The body is still mid-flight; were the read inside the boundary this save
    // could not run.
    const saved = await saveRequest(a.server, { origin: a.origin, docName: 'doc.html', html: doc({ n: 1 }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(h.dir, 'doc.html'), 'utf8')).toContain('"n":1');

    up.finish();
    const res = await up.response;
    expect(res.status).toBe(200);
  });

  test('an upload holds the exclusive boundary until its bytes land', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority: h.authority });

    const fsp = require('fs').promises;
    const realMkdir = fsp.mkdir;
    let mkdirReached = false;
    let releaseMkdir;
    const mkdirGate = new Promise((resolve) => { releaseMkdir = resolve; });
    jest.spyOn(fsp, 'mkdir').mockImplementation(async (p, opts) => {
      if (String(p).includes(`${path.sep}uploads${path.sep}assets-`)) {
        mkdirReached = true;
        await mkdirGate;
      }
      return realMkdir.call(fsp, p, opts);
    });

    const uploading = inFlight(uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes: Buffer.from('PNGDATA') })
      .then((r) => r));

    await waitFor(() => mkdirReached, 'the upload to reach its mkdir');
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    expect(fs.existsSync(assetsDir)).toBe(false);

    let saved = null;
    const saving = saveRequest(a.server, { origin: a.origin, docName: 'doc.html', html: doc({ n: 1 }) })
      .then((r) => { saved = r; return r; });

    await settle(150);
    expect(saved).toBeNull();

    releaseMkdir();
    const upRes = await uploading;
    expect(upRes.status).toBe(200);
    const saveRes = await saving;
    expect(saveRes.status).toBe(200);

    const entries = fs.readdirSync(assetsDir);
    expect(entries).toHaveLength(1);
    expect(fs.readFileSync(path.join(assetsDir, entries[0]))).toEqual(Buffer.from('PNGDATA'));
  });

  test('a stale queued upload refuses 409 before any upload folder is made', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const before = fs.readFileSync(docPath);

    const { authority, claims } = countClaims(h.authority);

    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority });

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const holder = withStructureChange(async (token) => {
      entered();
      await held;
      authority.setAdmission(token, {
        rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, active: false,
      });
    });
    await started;

    const uploading = inFlight(uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes: Buffer.from('PNGDATA') })
      .then((r) => r));
    await waitFor(() => claims.length >= 1, 'the upload to capture its admission claim');
    release();
    await holder;

    const res = await uploading;
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'conflict',
    });
    expect(fs.existsSync(path.join(h.dir, 'uploads'))).toBe(false);
    expect(fs.readFileSync(docPath)).toEqual(before);
  });

  test('a paused upload body whose owner a structure move retires answers 409', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const docPath = path.join(h.dir, 'doc.html');
    const before = fs.readFileSync(docPath);

    const { authority, claims } = countClaims(h.authority);
    const confirmations = [];
    authority.confirmKnownWrite = async (target, bytes, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, bytes, token, opts);
    };

    const fsp = require('fs').promises;
    const realOpen = fsp.open;
    let assetWrites = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx') assetWrites++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const host = a.origin.replace('http://', '');

    const bytes = Buffer.from('PNGDATA');
    const up = startPausedUpload({
      server: a.server, host, docUrl: `${a.origin}/doc.html`, filename: 'photo.png', bytes,
    });
    await up.started;
    await waitFor(() => claims.length >= 1, 'the upload to capture its admission claim');
    expect(up.bytesSent()).toBeGreaterThan(0);

    await withStructureChange((token) => authority.setAdmission(token, {
      rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: docPath, active: false,
    }));

    up.finish();
    const res = await up.response;
    expect(up.bytesSent()).toBe(bytes.length);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.text)).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'conflict',
    });
    expect(assetWrites).toBe(0);
    expect(confirmations).toHaveLength(0);
    expect(fs.existsSync(path.join(h.dir, 'uploads'))).toBe(false);
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'doc.html', origin: a.origin })).toBeNull();
    expect(fs.readFileSync(docPath)).toEqual(before);
  });

  test('a retired, absent assets directory is created once and admitted as an active prefix', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const location = { rootId: 'root-a', logicalPath: 'uploads/assets-doc', canonicalPath: assetsDir };

    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false, prefix: true }));
    expect(h.authority.isRetired(location)).toBe(true);
    expect(fs.existsSync(assetsDir)).toBe(false);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, bytes, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, bytes, token, opts);
    };

    const fsp = require('fs').promises;
    const realMkdir = fsp.mkdir;
    const mkdirs = [];
    jest.spyOn(fsp, 'mkdir').mockImplementation(async (p, opts) => {
      if (String(p) === assetsDir) mkdirs.push(p);
      return realMkdir.call(fsp, p, opts);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const bytes = Buffer.from('PNGDATA');
    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });

    expect(res.status).toBe(200);
    expect(res.body.uploads).toHaveLength(1);
    expect(mkdirs).toHaveLength(1);
    expect(fs.statSync(assetsDir).isDirectory()).toBe(true);
    const entries = fs.readdirSync(assetsDir);
    expect(entries).toEqual([res.body.uploads[0].name]);
    expect(fs.readFileSync(path.join(assetsDir, entries[0]))).toEqual(bytes);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].canonicalPath).toBe(path.join(assetsDir, entries[0]));
    expect(h.authority.isRetired(location)).toBe(false);
  });

  test('a retired assets directory occupied by an untracked folder refuses 409 before any asset write', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const location = { rootId: 'root-a', logicalPath: 'uploads/assets-doc', canonicalPath: assetsDir };
    const kept = path.join(assetsDir, 'kept.png');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(kept, 'KEPT');

    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false, prefix: true }));
    expect(h.authority.isRetired(location)).toBe(true);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, bytes, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, bytes, token, opts);
    };

    const fsp = require('fs').promises;
    const realMkdir = fsp.mkdir;
    const mkdirs = [];
    jest.spyOn(fsp, 'mkdir').mockImplementation(async (p, opts) => {
      if (String(p) === assetsDir) mkdirs.push(p);
      return realMkdir.call(fsp, p, opts);
    });
    const realOpen = fsp.open;
    let assetWrites = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx') assetWrites++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes: Buffer.from('PNGDATA') });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'conflict',
    });
    expect(mkdirs).toHaveLength(0);
    expect(assetWrites).toBe(0);
    expect(confirmations).toHaveLength(0);
    expect(fs.readdirSync(assetsDir)).toEqual(['kept.png']);
    expect(fs.readFileSync(kept, 'utf8')).toBe('KEPT');
    expect(h.authority.isRetired(location)).toBe(true);
  });

  test('a queued upload whose assets directory is retired while it waits refuses 409 before mkdir', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const location = { rootId: 'root-a', logicalPath: 'uploads/assets-doc', canonicalPath: assetsDir };

    const { authority, claims } = countClaims(h.authority);
    const confirmations = [];
    authority.confirmKnownWrite = async (target, bytes, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, bytes, token, opts);
    };

    const fsp = require('fs').promises;
    const realMkdir = fsp.mkdir;
    const mkdirs = [];
    jest.spyOn(fsp, 'mkdir').mockImplementation(async (p, opts) => {
      if (String(p) === assetsDir) mkdirs.push(p);
      return realMkdir.call(fsp, p, opts);
    });
    const realOpen = fsp.open;
    let assetWrites = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx') assetWrites++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const holder = withStructureChange(async (token) => {
      entered();
      await held;
      authority.setAdmission(token, { ...location, active: false, prefix: true });
    });
    await started;

    const uploading = inFlight(uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes: Buffer.from('PNGDATA') })
      .then((r) => r));
    await waitFor(() => claims.length >= 2, 'the upload to capture its directory claim');
    expect(claims[1]).toEqual(location);

    release();
    await holder;

    const res = await uploading;
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'conflict',
    });
    expect(mkdirs).toHaveLength(0);
    expect(assetWrites).toBe(0);
    expect(confirmations).toHaveLength(0);
    expect(fs.existsSync(path.join(h.dir, 'uploads'))).toBe(false);
    expect(h.authority.isRetired(location)).toBe(true);
  });

  test('an absent retired upload candidate is created with wx and admitted only on confirmation', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const bytes = Buffer.from('PNGDATA');
    const name = candidateName(bytes);
    const candidate = path.join(assetsDir, name);
    const location = { rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}`, canonicalPath: candidate };
    fs.mkdirSync(assetsDir, { recursive: true });

    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false }));
    expect(h.authority.isRetired(location)).toBe(true);
    expect(fs.existsSync(candidate)).toBe(false);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, written, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, written, token, opts);
    };

    const fsp = require('fs').promises;
    const realOpen = fsp.open;
    let opens = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx' && String(p) === candidate) opens++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });

    expect(res.status).toBe(200);
    expect(res.body.uploads).toEqual([{ name, url: `/_/uploads/assets-doc/${name}`, bytes: bytes.length, access: 'local' }]);
    expect(opens).toBe(1);
    expect(fs.readFileSync(candidate)).toEqual(bytes);

    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].canonicalPath).toBe(candidate);
    const identity = h.authority.identityAt(candidate, { rootId: 'root-a', logicalPath: location.logicalPath });
    expect(identity).not.toBeNull();
    expect(identity).toBe(confirmations[0].identity);
    expect(h.authority.confirmedStamp(candidate).etag).toBe(documentEtag(bytes));
    expect(h.authority.isRetired(location)).toBe(false);
  });

  test('a retired upload candidate occupied by an untracked file refuses 409 before any wx', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const bytes = Buffer.from('PNGDATA');
    const name = candidateName(bytes);
    const candidate = path.join(assetsDir, name);
    const location = { rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}`, canonicalPath: candidate };
    const occupant = Buffer.from('OCCUPANT');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(candidate, occupant);

    await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false }));
    expect(h.authority.isRetired(location)).toBe(true);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, written, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, written, token, opts);
    };

    const fsp = require('fs').promises;
    const realOpen = fsp.open;
    let opens = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx' && String(p) === candidate) opens++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      msg: 'This file has been moved or deleted. Please refresh the page.',
      msgType: 'error',
      code: 'conflict',
    });
    expect(opens).toBe(0);
    expect(fs.readFileSync(candidate)).toEqual(occupant);
    expect(fs.readdirSync(assetsDir)).toEqual([name]);
    expect(confirmations).toHaveLength(0);
    expect(h.authority.identityAt(candidate, { rootId: 'root-a', logicalPath: location.logicalPath })).toBeNull();
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: location.logicalPath, origin: a.origin })).toBeNull();
    expect(h.authority.isRetired(location)).toBe(true);
  });

  test('a denied wx open on a fresh candidate leaves no identity, binding or confirmation', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const bytes = Buffer.from('PNGDATA');
    const name = candidateName(bytes);
    const candidate = path.join(assetsDir, name);
    const location = { rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}`, canonicalPath: candidate };
    fs.mkdirSync(assetsDir, { recursive: true });
    const before = h.authority.captureAdmission(location);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, written, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, written, token, opts);
    };

    const fsp = require('fs').promises;
    const realOpen = fsp.open;
    let opens = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx' && String(p) === candidate) {
        opens++;
        const error = new Error('denied by the fixture');
        error.code = 'EACCES';
        throw error;
      }
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });

    expect(res.status).toBe(500);
    expect(opens).toBe(1);
    expect(fs.existsSync(candidate)).toBe(false);
    expect(confirmations).toHaveLength(0);
    expect(h.authority.identityAt(candidate, { rootId: 'root-a', logicalPath: location.logicalPath })).toBeNull();
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: location.logicalPath, origin: a.origin })).toBeNull();
    const after = h.authority.captureAdmission(location);
    expect(after.identity).toBeNull();
    expect(after.canonicalRevision).toBe(before.canonicalRevision);
    expect(after.logicalRevision).toBe(before.logicalRevision);
  });

  test('an active identical upload deduplicates to one file with one confirmation', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);
    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const bytes = Buffer.from('PNGDATA');
    const name = candidateName(bytes);
    const candidate = path.join(assetsDir, name);

    const confirmations = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, written, token, opts) => {
      confirmations.push(target);
      return h.authority.confirmKnownWrite(target, written, token, opts);
    };

    const fsp = require('fs').promises;
    const realOpen = fsp.open;
    let opens = 0;
    jest.spyOn(fsp, 'open').mockImplementation(async (p, flags, mode) => {
      if (flags === 'wx' && String(p) === candidate) opens++;
      return realOpen.call(fsp, p, flags, mode);
    });

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const first = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });
    expect(first.status).toBe(200);
    expect(first.body.uploads[0].name).toBe(name);
    expect(opens).toBe(1);
    expect(confirmations).toHaveLength(1);
    const identity = h.authority.identityAt(candidate, { rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}` });
    expect(identity).not.toBeNull();

    const second = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });
    expect(second.status).toBe(200);
    expect(second.body.uploads[0].name).toBe(name);
    expect(second.body.uploads[0].bytes).toBe(bytes.length);
    expect(opens).toBe(2);
    expect(confirmations).toHaveLength(1);
    expect(fs.readdirSync(assetsDir)).toEqual([name]);
    expect(fs.readFileSync(candidate)).toEqual(bytes);
    expect(h.authority.identityAt(candidate, { rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}` })).toBe(identity);
    expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: `uploads/assets-doc/${name}`, canonicalPath: candidate })).toBe(false);
  });

  test('a binary upload stamps the authority with the bytes that landed', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const rootA = makeRoot('root-a', h.dir);

    const stamps = [];
    const authority = Object.create(h.authority);
    authority.confirmKnownWrite = async (target, bytes, token, opts) => {
      const stamp = await h.authority.confirmKnownWrite(target, bytes, token, opts);
      stamps.push({ target, bytes, stamp });
      return stamp;
    };

    const a = await startApp({ root: rootA.root, live: rootA.live, authority });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const res = await uploadRequest(a.server, { origin: a.origin, docName: 'doc.html', filename: 'photo.png', bytes });
    expect(res.status).toBe(200);
    expect(res.body.uploads).toHaveLength(1);

    const assetsDir = path.join(h.dir, 'uploads', 'assets-doc');
    const entries = fs.readdirSync(assetsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(res.body.uploads[0].name);
    expect(fs.readFileSync(path.join(assetsDir, entries[0]))).toEqual(bytes);

    expect(stamps).toHaveLength(1);
    expect(stamps[0].target.canonicalPath).toBe(path.join(assetsDir, entries[0]));
    expect(stamps[0].bytes).toEqual(bytes);
    expect(stamps[0].stamp.etag).toBe(documentEtag(bytes));
    expect(stamps[0].stamp.size).toBe(BigInt(bytes.length));
  });

  test('a standalone Tailwind cache miss queues behind a source write and serves the newer CSS', async () => {
    const h = harness({ initial: doc({ n: 0 }) });
    const pagePath = path.join(h.dir, 'page.html');
    fs.writeFileSync(pagePath, '<html><head><link data-tailwind rel="stylesheet" href="/tailwindcss/page.css"></head><body class="p-4">hi</body></html>');
    const cssPath = path.join(h.dir, '.hyperclay', 'tailwindcss', 'page.css');
    const marker = '/* published by the concurrent source write */';

    const rootA = makeRoot('root-a', h.dir);
    const a = await startApp({ root: rootA.root, live: rootA.live, authority: h.authority });

    const heldTarget = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: pagePath, origin: a.origin, live: rootA.live,
    });
    let publishCss;
    const cssGate = new Promise((resolve) => { publishCss = resolve; });
    const holder = withDocumentWrite(async () => heldTarget, async () => {
      await cssGate;
      await fs.promises.mkdir(path.dirname(cssPath), { recursive: true });
      await fs.promises.writeFile(cssPath, marker);
    });

    const pending = request(a.server).get('/tailwindcss/page.css').then((r) => r);
    pending.catch(() => {});
    await settle(100);
    publishCss();
    await holder;

    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.text).toBe(marker);

    const logs = console.log.mock.calls.map(([first]) => String(first));
    expect(logs.some((line) => line.includes('Auto-generated Tailwind CSS'))).toBe(false);
    expect(fs.readFileSync(cssPath, 'utf8')).toBe(marker);
  });
});
