const fs = require('fs');
const os = require('os');
const path = require('upath');
const { createRooms, serializeLive, stampOf, splitPage } = require('@panphora/clayjs/server/rooms');
const { readPageState } = require('../../src/main/page-state-store');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { validateSegments } = require('../../src/main/utils/path-resolver');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { withLocalDocumentWrite } = require('../../src/sync-engine/local-boundary');
const { executeDecision } = require('../../src/sync-engine/reconcile/execute');
const CascadeSuppression = require('../../src/sync-engine/state/cascade-suppression');

// C2: the engine's own remote writers through the shared boundary. Real temp
// files, the real document boundary and the real rooms package, so every count
// asserted below is an actual disk, room or stamp operation.
jest.mock('../../src/sync-engine/api-client');
jest.mock('../../src/main/utils/derived-artifacts', () => ({
  refreshDerivedArtifacts: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn().mockResolvedValue(undefined),
}));

const EventEmitter = require('events');
const NodeRepository = require('../../src/sync-engine/state/node-repository');
const sseHandlers = require('../../src/sync-engine/engine-sse');
const uploaderHandlers = require('../../src/sync-engine/engine-uploader');
const initialSyncHandlers = require('../../src/sync-engine/engine-initial-sync');
const watcherHandlers = require('../../src/sync-engine/engine-watcher');
const apiClient = require('../../src/sync-engine/api-client');
const { documentEtag } = require('../../src/main/spec-wire');
const { A } = require('../../src/sync-engine/reconcile/decide');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const tag = (name, value) => `<script type="application/json" merge="${name}" clay="live">${JSON.stringify(value)}</script>`;
const doc = (value) => `<!doctype html><html><body>${tag('count', value)}</body></html>`;

describe('D3: authority-owned deletes', () => {
  function setup() {
    const rooms = createRooms({});
    const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
    authority.registerRoot({ id: 'root-a', canonicalPath: dir, path: dir }, { owner: 'server' });
    const instance = createEngine({ syncFolder: dir, rootId: 'root-a', live: { broadcast: jest.fn(), markBrowserSave: jest.fn() }, authority });
    Object.assign(instance, initialSyncHandlers, watcherHandlers);
    return { rooms, authority, instance };
  }

  test('file delete retires the old URL only after moving the clean room to trash', async () => {
    const { rooms, authority, instance } = setup();
    const file = path.join(dir, 'a.html');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: file });
    rooms.open(file, doc({ n: 0 }), { nodeId: target.identity });
    await instance.repo.set(7, { type: 'site', path: 'a.html' });

    await instance._applyFileDelete(7, 'a.html', 'site');

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(path.join(dir, '.trash', 'a.html'), 'utf8')).toBe('<html>a</html>');
    expect(rooms.get(file)).toBeNull();
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: file })).toBe(true);
    expect(instance.repo.has(7)).toBe(false);
  });

  test('a dirty room refuses a file delete before disk and node map change', async () => {
    const { rooms, authority, instance } = setup();
    const file = path.join(dir, 'a.html');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: file });
    const room = rooms.open(file, doc({ n: 0 }), { nodeId: target.identity });
    expect(rooms.apply(room, 'client', {
      name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 1 }],
    }, { connected: ['client'] }).error).toBeUndefined();
    await instance.repo.set(7, { type: 'site', path: 'a.html' });

    await expect(instance._applyFileDelete(7, 'a.html', 'site')).rejects.toMatchObject({ code: 'peers-editing' });

    expect(fs.readFileSync(file, 'utf8')).toBe('<html>a</html>');
    expect(rooms.get(file)).toBe(room);
    expect(instance.repo.has(7)).toBe(true);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: file })).toBe(false);
  });

  test('a missing folder retires its unopened descendants and removes its node map entries', async () => {
    const { authority, instance } = setup();
    await instance.repo.set(7, { type: 'folder', path: 'gone' });
    await instance.repo.set(8, { type: 'site', path: 'gone/child.html' });

    await instance._applyFolderDelete(7, 'gone');

    expect(instance.repo.has(7)).toBe(false);
    expect(instance.repo.has(8)).toBe(false);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'gone/child.html', canonicalPath: path.join(dir, 'gone', 'child.html') })).toBe(true);
  });

  test('a missing file relocation leaves the sync time unchanged when the destination is absent', async () => {
    const { authority, instance } = setup();
    await instance.repo.set(7, { type: 'site', path: 'missing.html', syncedAt: 12345 });

    await instance._applyFileRelocate(7, 'missing.html', 'new.html', 'site');

    expect(instance.repo.get(7)).toEqual(expect.objectContaining({ path: 'new.html', syncedAt: 12345 }));
    expect(fs.existsSync(path.join(dir, 'new.html'))).toBe(false);
    expect(authority.isRetired({
      rootId: 'root-a', logicalPath: 'missing.html', canonicalPath: path.join(dir, 'missing.html'),
    })).toBe(true);
  });

  test('folder trash collision commits retirement and drops each descendant room', async () => {
    const { rooms, authority, instance } = setup();
    const oldDir = path.join(dir, 'work');
    const child = path.join(oldDir, 'child.html');
    fs.mkdirSync(oldDir);
    fs.writeFileSync(child, doc({ n: 0 }));
    fs.mkdirSync(path.join(dir, '.trash', 'work'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.trash', 'work', 'existing.html'), 'keep');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'work/child.html', canonicalPath: child });
    rooms.open(child, doc({ n: 0 }), { nodeId: target.identity });
    await instance.repo.set(7, { type: 'folder', path: 'work' });
    await instance.repo.set(8, { type: 'site', path: 'work/child.html' });

    await instance._applyFolderDelete(7, 'work');

    expect(fs.existsSync(oldDir)).toBe(false);
    const relocated = fs.readdirSync(path.join(dir, '.trash')).filter((name) => name.startsWith('work.'));
    expect(relocated).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, '.trash', relocated[0], 'child.html'), 'utf8')).toBe(doc({ n: 0 }));
    expect(fs.readFileSync(path.join(dir, '.trash', 'work', 'existing.html'), 'utf8')).toBe('keep');
    expect(rooms.get(child)).toBeNull();
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'work/child.html', canonicalPath: child })).toBe(true);
    expect(instance.repo.has(7)).toBe(false);
    expect(instance.repo.has(8)).toBe(false);
  });

  test('an occupied file destination moves aside first and rekeys both clean rooms', async () => {
    const { rooms, authority, instance } = setup();
    const source = path.join(dir, 'a.html');
    const destination = path.join(dir, 'b.html');
    const aside = path.join(dir, 'b (conflicted copy).html');
    const a = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source });
    const b = authority.bindTarget({ rootId: 'root-a', logicalPath: 'b.html', canonicalPath: destination });
    const aRoom = rooms.open(source, doc({ n: 0 }), { nodeId: a.identity });
    const bRoom = rooms.open(destination, doc({ n: 0 }), { nodeId: b.identity });
    await instance.repo.set(7, { type: 'site', path: 'a.html' });

    await instance._applyFileRelocate(7, 'a.html', 'b.html', 'site');

    expect(fs.readFileSync(destination, 'utf8')).toBe('<html>a</html>');
    expect(fs.readFileSync(aside, 'utf8')).toBe('<html>b</html>');
    expect(rooms.get(destination)).toBe(aRoom);
    expect(rooms.get(aside)).toBe(bRoom);
    expect(authority.identityAt(destination)).toBe(a.identity);
    expect(authority.identityAt(aside)).toBe(b.identity);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source })).toBe(true);
  });

  test('a dirty destination refuses relocation before either rename or tombstone', async () => {
    const { rooms, authority, instance } = setup();
    const destination = path.join(dir, 'b.html');
    const b = authority.bindTarget({ rootId: 'root-a', logicalPath: 'b.html', canonicalPath: destination });
    const room = rooms.open(destination, doc({ n: 0 }), { nodeId: b.identity });
    expect(rooms.apply(room, 'client', {
      name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 2 }],
    }, { connected: ['client'] }).error).toBeUndefined();
    await instance.repo.set(7, { type: 'site', path: 'a.html' });

    await expect(instance._applyFileRelocate(7, 'a.html', 'b.html', 'site'))
      .rejects.toMatchObject({ code: 'peers-editing' });

    expect(fs.readFileSync(path.join(dir, 'a.html'), 'utf8')).toBe('<html>a</html>');
    expect(fs.readFileSync(destination, 'utf8')).toBe('<html>b</html>');
    expect(instance.repo.get(7).path).toBe('a.html');
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: path.join(dir, 'a.html') })).toBe(false);
  });

  test('a room made dirty after a confirmed flush refuses relocation before rename', async () => {
    const { rooms, authority, instance } = setup();
    const source = path.join(dir, 'a.html');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source });
    const room = rooms.open(source, doc({ n: 0 }), { nodeId: target.identity });
    await instance.repo.set(7, { type: 'site', path: 'a.html' });
    expect(rooms.apply(room, 'client', {
      name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 1 }],
    }, { connected: ['client'] }).error).toBeUndefined();
    const savedValue = serializeLive({ n: 1 });
    const saved = `<!doctype html><html><body><script type="application/json" merge="count" clay="live" live-at="${stampOf(room.epoch, room.seq, savedValue)}" live-by="client:1">${savedValue}</script></body></html>`;
    fs.writeFileSync(source, saved);
    rooms.fileWritten(source, saved);
    expect(room.stores.get('count').landed).toBe(room.stores.get('count').last);
    expect(rooms.apply(room, 'client', {
      name: 'count', n: 2, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 2 }],
    }, { connected: ['client'] }).error).toBeUndefined();

    await expect(instance._applyFileRelocate(7, 'a.html', 'c.html', 'site'))
      .rejects.toMatchObject({ code: 'peers-editing' });

    expect(fs.readFileSync(source, 'utf8')).toBe(saved);
    expect(fs.existsSync(path.join(dir, 'c.html'))).toBe(false);
    expect(rooms.get(source)).toBe(room);
    expect(instance.repo.get(7).path).toBe('a.html');
  });

  test('a failed second rename commits only the completed occupant aside', async () => {
    const { rooms, authority, instance } = setup();
    const source = path.join(dir, 'a.html');
    const destination = path.join(dir, 'b.html');
    const aside = path.join(dir, 'b (conflicted copy).html');
    const a = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source });
    const b = authority.bindTarget({ rootId: 'root-a', logicalPath: 'b.html', canonicalPath: destination });
    const aRoom = rooms.open(source, doc({ n: 0 }), { nodeId: a.identity });
    const bRoom = rooms.open(destination, doc({ n: 0 }), { nodeId: b.identity });
    await instance.repo.set(7, { type: 'site', path: 'a.html' });
    const rename = fs.promises.rename;
    let renames = 0;
    const spy = jest.spyOn(fs.promises, 'rename').mockImplementation((from, to) => {
      renames += 1;
      if (renames === 2) return Promise.reject(Object.assign(new Error('second rename failed'), { code: 'EACCES' }));
      return rename(from, to);
    });
    try {
      await expect(instance._applyFileRelocate(7, 'a.html', 'b.html', 'site'))
        .rejects.toThrow('second rename failed');
    } finally {
      spy.mockRestore();
    }

    expect(renames).toBe(2);
    expect(fs.readFileSync(source, 'utf8')).toBe('<html>a</html>');
    expect(fs.readFileSync(aside, 'utf8')).toBe('<html>b</html>');
    expect(fs.existsSync(destination)).toBe(false);
    expect(rooms.get(source)).toBe(aRoom);
    expect(rooms.get(aside)).toBe(bRoom);
    expect(authority.identityAt(source)).toBe(a.identity);
    expect(authority.identityAt(aside)).toBe(b.identity);
    expect(instance.repo.get(7).path).toBe('a.html');
  });

  test('a folder relocation rekeys an open child and retires unopened old descendants', async () => {
    const { rooms, authority, instance } = setup();
    const oldDir = path.join(dir, 'old');
    fs.mkdirSync(oldDir);
    const oldChild = path.join(oldDir, 'child.html');
    fs.writeFileSync(oldChild, doc({ n: 0 }));
    fs.writeFileSync(path.join(oldDir, 'unopened.html'), '<html>other</html>');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'old/child.html', canonicalPath: oldChild });
    const room = rooms.open(oldChild, doc({ n: 0 }), { nodeId: target.identity });
    await instance.repo.set(7, { type: 'folder', path: 'old' });
    await instance.repo.set(8, { type: 'site', path: 'old/child.html' });

    await instance._applyFolderRelocate(7, 'old', 'new');

    const newChild = path.join(dir, 'new', 'child.html');
    expect(fs.readFileSync(newChild, 'utf8')).toBe(doc({ n: 0 }));
    expect(rooms.get(newChild)).toBe(room);
    expect(authority.identityAt(newChild)).toBe(target.identity);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'old/unopened.html', canonicalPath: path.join(oldDir, 'unopened.html') })).toBe(true);
    expect(instance.repo.get(8).path).toBe('new/child.html');
  });

  test('a child write boundary finishes before a queued folder move rekeys its room', async () => {
    const { rooms, authority, instance } = setup();
    const oldDir = path.join(dir, 'old');
    fs.mkdirSync(oldDir);
    const oldChild = path.join(oldDir, 'child.html');
    fs.writeFileSync(oldChild, doc({ n: 0 }));
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'old/child.html', canonicalPath: oldChild });
    const room = rooms.open(oldChild, doc({ n: 0 }), { nodeId: target.identity });
    await instance.repo.set(7, { type: 'folder', path: 'old' });
    await instance.repo.set(8, { type: 'site', path: 'old/child.html' });
    let entered;
    let release;
    const started = new Promise((resolve) => { entered = resolve; });
    const held = new Promise((resolve) => { release = resolve; });
    const saving = withDocumentWrite(async () => ({ canonicalPath: oldChild }), async () => {
      entered();
      await held;
      fs.writeFileSync(oldChild, doc({ n: 1 }));
    });
    await started;
    const moving = instance._applyFolderRelocate(7, 'old', 'new');
    await flush();
    expect(fs.existsSync(oldChild)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'new', 'child.html'))).toBe(false);

    release();
    await saving;
    await moving;

    const newChild = path.join(dir, 'new', 'child.html');
    expect(fs.readFileSync(newChild, 'utf8')).toBe(doc({ n: 1 }));
    expect(rooms.get(newChild)).toBe(room);
    expect(authority.identityAt(newChild)).toBe(target.identity);
  });

  test('initial sync correlation moves the room with the file it matches', async () => {
    const { rooms, authority, instance } = setup();
    const source = path.join(dir, 'a.html');
    const destination = path.join(dir, 'b.html');
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source });
    const room = rooms.open(source, doc({ n: 0 }), { nodeId: target.identity });
    const localFiles = new Map([
      ['a.html', { path: source }],
      ['b.html', { path: destination }],
    ]);
    const map = new Map([['7', { type: 'site', path: 'a.html' }]]);

    await instance.correlateServerFile({ nodeId: 7, path: 'b.html' }, localFiles, map);

    expect(map.get('7').path).toBe('b.html');
    expect(localFiles.has('b (conflicted copy).html')).toBe(true);
    expect(fs.readFileSync(destination, 'utf8')).toBe('<html>a</html>');
    expect(rooms.get(destination)).toBe(room);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'a.html', canonicalPath: source })).toBe(true);
  });

  test('locked folder restoration holds the structure gate and preserves its room', async () => {
    const { rooms, authority, instance } = setup();
    const oldFolder = path.join(dir, 'moved-uploads');
    const oldChild = path.join(oldFolder, 'photo.html');
    fs.mkdirSync(oldFolder);
    fs.writeFileSync(oldChild, doc({ n: 0 }));
    const target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'moved-uploads/photo.html', canonicalPath: oldChild });
    const room = rooms.open(oldChild, doc({ n: 0 }), { nodeId: target.identity });

    expect(await instance.restoreLockedFolder('moved-uploads')).toBe(true);

    const newChild = path.join(dir, 'uploads', 'photo.html');
    expect(fs.readFileSync(newChild, 'utf8')).toBe(doc({ n: 0 }));
    expect(rooms.get(newChild)).toBe(room);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'moved-uploads/photo.html', canonicalPath: oldChild })).toBe(true);
  });

  test('locked folder restoration reports an occupied destination even when the source vanished', async () => {
    const { instance } = setup();
    fs.mkdirSync(path.join(dir, 'uploads'));

    expect(await instance.restoreLockedFolder('missing-uploads')).toBe('occupied');
    expect(fs.existsSync(path.join(dir, 'uploads'))).toBe(true);
  });
});

let dir;
let engine;

beforeEach(() => {
  dir = path.resolve(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-engine-boundary-'))));
  fs.writeFileSync(path.join(dir, 'a.html'), '<html>a</html>');
  fs.writeFileSync(path.join(dir, 'b.html'), '<html>b</html>');
  const authority = createLocalAuthority({ rooms: createRooms({}), withDocument: withDocumentWrite });
  jest.spyOn(authority, 'captureAdmission');
  engine = {
    syncFolder: dir,
    rootId: 'root-a',
    generation: 1,
    localAuthority: authority,
    live: { broadcast: jest.fn() },
    resolveContainedPath: validateSegments,
  };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function holdStructure() {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const pending = withStructureChange(async () => {
    entered();
    await held;
  });
  await started;
  return { release, pending };
}

function waitForClaim(authority, filePath) {
  const capture = authority.captureAdmission;
  if (capture.mock.calls.some(([location]) => location.canonicalPath === filePath)) return Promise.resolve();
  return new Promise((resolve) => {
    const original = capture.getMockImplementation();
    capture.mockImplementation((location) => {
      const claim = original(location);
      if (location.canonicalPath === filePath) {
        capture.mockImplementation(original);
        resolve();
      }
      return claim;
    });
  });
}

function pauseNextFetch() {
  let began;
  let finish;
  let settled = false;
  const started = new Promise((resolve) => { began = resolve; });
  const response = new Promise((resolve) => { finish = resolve; });
  apiClient.getNodeContent.mockImplementationOnce(() => {
    began();
    return response;
  });
  return {
    started,
    get settled() { return settled; },
    release(value) { settled = true; finish(value); },
  };
}

test('a queued engine write skips a generation that ended before admission', async () => {
  const filePath = path.join(dir, 'a.html');
  const blocker = await holdStructure();
  let entered = 0;
  const pending = withLocalDocumentWrite(engine, 'a.html', async () => {
    entered++;
    await fs.promises.writeFile(filePath, '<html>stale</html>');
  }, { generation: 1 });
  await waitForClaim(engine.localAuthority, filePath);

  engine.generation = 2;
  blocker.release();
  await blocker.pending;

  expect(await pending).toEqual({ stale: true });
  expect(entered).toBe(0);
  expect(fs.readFileSync(filePath, 'utf8')).toBe('<html>a</html>');
});

test('a queued engine write skips an alias whose canonical target changed', async () => {
  const alias = path.join(dir, 'alias.html');
  const original = path.join(dir, 'a.html');
  fs.symlinkSync('a.html', alias);
  const blocker = await holdStructure();
  let entered = 0;
  const pending = withLocalDocumentWrite(engine, 'alias.html', async () => { entered++; });
  await waitForClaim(engine.localAuthority, original);

  fs.unlinkSync(alias);
  fs.symlinkSync('b.html', alias);
  blocker.release();
  await blocker.pending;

  expect(await pending).toEqual({ stale: true });
  expect(entered).toBe(0);
  expect(fs.readFileSync(original, 'utf8')).toBe('<html>a</html>');
  expect(fs.readFileSync(path.join(dir, 'b.html'), 'utf8')).toBe('<html>b</html>');
});

function createEngine({ syncFolder, rootId, live, authority }) {
  const engine = Object.assign(new EventEmitter(), sseHandlers, uploaderHandlers);
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
  return engine;
}

function createAuthority() {
  const core = createRooms({});
  const fileWritten = [];
  const rooms = {
    ...core,
    fileWritten(key, html, opts) {
      fileWritten.push({ key, html });
      return core.fileWritten(key, html, opts);
    },
  };
  const authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
  jest.spyOn(authority, 'captureAdmission');
  return { authority, fileWritten };
}

function broadcastsTo() {
  const calls = [];
  return { calls, live: { broadcast: (...args) => calls.push(args), markBrowserSave: jest.fn() } };
}

describe('C2: the engine remote writers through the shared boundary', () => {
  test('an SSE site apply reaches the open room and publishes once per root alias', async () => {
    const filePath = path.join(dir, 'index.html');
    const before = doc({ n: 0 });
    const after = doc({ n: 1 });
    fs.writeFileSync(filePath, before);

    const { authority, fileWritten } = createAuthority();
    const a = broadcastsTo();
    const b = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: a.live, authority });
    const alias = authority.bindTarget({
      rootId: 'root-b', logicalPath: 'alias/index.html', canonicalPath: filePath, origin: null, live: b.live,
    });

    const events = [];
    const member = authority.registerEditor(alias, {
      clientId: 'cB', send: (event, payload) => events.push([event, payload]),
    });
    await authority.roomFor(alias, async () => ({ canonicalPath: filePath, identity: alias.identity }));

    const synced = jest.fn();
    engine.on('file-synced', synced);

    await engine._applyNodeSavedSite({
      nodeId: 7,
      nodeType: 'site',
      path: 'index.html',
      content: after,
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe(after);
    expect(fileWritten).toEqual([{ key: filePath, html: after }]);

    const states = events.filter(([event]) => event === 'data-state');
    expect(states).toHaveLength(1);
    expect(states[0][1].stores.count.value).toEqual({ n: 1 });

    expect(a.calls).toEqual([['index.html', { html: after, sender: 'sync-engine' }, { lane: 'saved' }]]);
    expect(b.calls).toEqual([['alias/index.html', { html: after, sender: 'sync-engine' }, { lane: 'saved' }]]);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.repo.get(7)).toEqual(expect.objectContaining({ type: 'site', path: 'index.html' }));
    member.close();
  });

  test('a downloader paused on the cloud fetch never holds the document boundary', async () => {
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, '<html>local</html>');

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const target = authority.bindTarget({
      rootId: 'root-a', logicalPath: 'index.html', canonicalPath: filePath, origin: 'http://127.0.0.1:7000', live: live.live,
    });

    const fetch = pauseNextFetch();

    const download = engine.downloadFile(7, 'index.html');
    await fetch.started;
    expect(apiClient.getNodeContent).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('<html>local</html>');

    await withDocumentWrite(async () => target, async (resolved) => {
      await fs.promises.writeFile(resolved.canonicalPath, '<html>browser</html>');
    });

    expect(fetch.settled).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('<html>browser</html>');

    fetch.release({ content: '<html>remote</html>', modifiedAt: '2026-04-08T12:00:00Z' });
    await download;

    expect(fs.readFileSync(filePath, 'utf8')).toBe('<html>remote</html>');
  });

  test('a site download that pauses while its alias retargets writes the old bytes nowhere', async () => {
    const aliasPath = path.join(dir, 'alias.html');
    const aPath = path.join(dir, 'a.html');
    const bPath = path.join(dir, 'b.html');
    fs.symlinkSync('a.html', aliasPath);

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const before = apiClient.getNodeContent.mock.calls.length;
    const fetch = pauseNextFetch();

    const pending = engine.downloadFile(7, 'alias.html');
    await fetch.started;

    fs.unlinkSync(aliasPath);
    fs.symlinkSync('b.html', aliasPath);

    fetch.release({ content: '<html>remote</html>', modifiedAt: '2026-04-08T12:00:00Z' });
    await pending;

    expect(apiClient.getNodeContent.mock.calls.length - before).toBe(1);
    expect(fs.readFileSync(aPath, 'utf8')).toBe('<html>a</html>');
    expect(fs.readFileSync(bPath, 'utf8')).toBe('<html>b</html>');
    expect(fs.existsSync(path.join(dir, '.hyperclay'))).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(engine.repo.has(7)).toBe(false);
  });

  test('an upload apply writes through the canonical target and stamps the exact bytes', async () => {
    const realPath = path.join(dir, 'photo.png');
    const aliasPath = path.join(dir, 'alias.png');
    fs.writeFileSync(realPath, Buffer.from([0x00, 0x01, 0x02]));
    fs.symlinkSync('photo.png', aliasPath);

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    apiClient.getNodeContent.mockResolvedValueOnce({
      content: bytes,
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
      nodeType: 'upload',
      size: bytes.length,
    });

    await engine._applyNodeSavedUpload({
      nodeId: 42,
      nodeType: 'upload',
      name: 'alias.png',
      path: 'alias.png',
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });

    expect(fs.lstatSync(aliasPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(realPath)).toEqual(bytes);
    expect(confirm).toHaveBeenCalledTimes(1);

    const stamp = await confirm.mock.results[0].value;
    const stat = fs.statSync(realPath, { bigint: true });
    expect(stamp.identity).toBe(authority.identityAt(realPath));
    expect(stamp.etag).toBe(documentEtag(bytes));
    expect(stamp.size).toBe(BigInt(bytes.length));
    expect(stamp.ino).toBe(stat.ino);
    expect(stamp.dev).toBe(stat.dev);

    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(engine.repo.get(42)).toEqual(expect.objectContaining({
      type: 'upload',
      path: 'alias.png',
      checksum: 'cs-remote',
    }));
  });

  test('an upload apply that pauses while its alias retargets writes the old bytes nowhere', async () => {
    const aliasPath = path.join(dir, 'alias.png');
    const aPath = path.join(dir, 'photo-a.png');
    const bPath = path.join(dir, 'photo-b.png');
    fs.writeFileSync(aPath, Buffer.from([0x0a, 0x0a]));
    fs.writeFileSync(bPath, Buffer.from([0x0b, 0x0b]));
    fs.symlinkSync('photo-a.png', aliasPath);

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const before = apiClient.getNodeContent.mock.calls.length;
    const fetch = pauseNextFetch();

    const pending = engine._applyNodeSavedUpload({
      nodeId: 42,
      nodeType: 'upload',
      name: 'alias.png',
      path: 'alias.png',
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });
    await fetch.started;

    fs.unlinkSync(aliasPath);
    fs.symlinkSync('photo-b.png', aliasPath);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    fetch.release({ content: bytes, modifiedAt: '2026-04-08T12:00:00Z', checksum: 'cs-remote', size: bytes.length });
    await pending;

    expect(apiClient.getNodeContent.mock.calls.length - before).toBe(1);
    expect(fs.readFileSync(aPath)).toEqual(Buffer.from([0x0a, 0x0a]));
    expect(fs.readFileSync(bPath)).toEqual(Buffer.from([0x0b, 0x0b]));
    expect(fs.existsSync(path.join(dir, '.hyperclay'))).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(engine.repo.has(42)).toBe(false);
    expect(engine.stats.uploadsDownloaded).toBe(0);
  });

  test('an upload download that pauses while its alias retargets writes the old bytes nowhere', async () => {
    const aliasPath = path.join(dir, 'alias.png');
    const aPath = path.join(dir, 'binary-a.png');
    const bPath = path.join(dir, 'binary-b.png');
    fs.writeFileSync(aPath, Buffer.from([0x0a, 0x0a]));
    fs.writeFileSync(bPath, Buffer.from([0x0b, 0x0b]));
    fs.symlinkSync('binary-a.png', aliasPath);

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const before = apiClient.getNodeContent.mock.calls.length;
    const fetch = pauseNextFetch();

    const pending = engine.downloadUploadFile('alias.png', 42);
    await fetch.started;

    fs.unlinkSync(aliasPath);
    fs.symlinkSync('binary-b.png', aliasPath);

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    fetch.release({ content: bytes, modifiedAt: '2026-04-08T12:00:00Z', checksum: 'cs-remote', size: bytes.length });
    await pending;

    expect(apiClient.getNodeContent.mock.calls.length - before).toBe(1);
    expect(fs.readFileSync(aPath)).toEqual(Buffer.from([0x0a, 0x0a]));
    expect(fs.readFileSync(bPath)).toEqual(Buffer.from([0x0b, 0x0b]));
    expect(fs.existsSync(path.join(dir, '.hyperclay'))).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(engine.repo.has(42)).toBe(false);
  });

  test('a queued generation change skips the site write, the room and the repo', async () => {
    const filePath = path.join(dir, 'index.html');
    fs.writeFileSync(filePath, '<html>local</html>');

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    authority.bindTarget({
      rootId: 'root-a', logicalPath: 'index.html', canonicalPath: filePath, origin: null, live: live.live,
    });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const blocker = await holdStructure();
    const pending = engine._applyNodeSavedSite({
      nodeId: 9,
      nodeType: 'site',
      path: 'index.html',
      content: '<html>remote</html>',
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });
    for (let attempt = 0; attempt < 100 && !authority.identityAt(filePath); attempt++) {
      await flush();
    }
    expect(authority.identityAt(filePath)).toBeTruthy();

    engine.generation = 2;
    blocker.release();
    await blocker.pending;
    await pending;

    expect(fs.readFileSync(filePath, 'utf8')).toBe('<html>local</html>');
    expect(fs.existsSync(path.join(dir, 'sites-versions'))).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(engine.repo.has(9)).toBe(false);
    expect(engine.stats.filesDownloaded).toBe(0);
  });
});

function createReconcileEngine({ syncFolder, rootId, live, authority }) {
  const engine = new EventEmitter();
  engine.syncFolder = syncFolder;
  engine.metaDir = path.join(syncFolder, 'meta');
  engine.rootId = rootId;
  engine.generation = 1;
  engine.localAuthority = authority;
  engine.live = live;
  engine.resolveContainedPath = validateSegments;
  engine.repo = new NodeRepository();
  engine.repo.attach(path.join(syncFolder, 'meta'));
  engine.cascade = new CascadeSuppression();
  engine.conn = { serverUrl: 'http://test', syncBase: '/_/sync', apiKey: 'k', accountId: null, protocol: 1 };
  return engine;
}

function waitForTarget(authority, filePath) {
  if (authority.identityAt(filePath)) return Promise.resolve();
  return waitForClaim(authority, filePath);
}

function controlledDirectoryChange(engine) {
  const order = [];
  const real = engine._applyRemoteFsChange.bind(engine);
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  engine._applyRemoteFsChange = async (paths, fn) => {
    order.push('mkdir');
    entered();
    await held;
    return real(paths, fn);
  };
  return { order, started, release };
}

describe('C3: reconcile writes and folder creation through the boundaries', () => {
  test('a reconcile HTML download writes the remote bytes and confirms one room plus one saved event per alias', async () => {
    const filePath = path.join(dir, 'index.html');
    const before = doc({ n: 0 });
    const after = doc({ n: 1 });
    fs.writeFileSync(filePath, before);

    const { authority, fileWritten } = createAuthority();
    const a = broadcastsTo();
    const b = broadcastsTo();
    const engine = createReconcileEngine({ syncFolder: dir, rootId: 'root-a', live: a.live, authority });
    const alias = authority.bindTarget({
      rootId: 'root-b', logicalPath: 'alias/index.html', canonicalPath: filePath, origin: null, live: b.live,
    });

    const events = [];
    const member = authority.registerEditor(alias, {
      clientId: 'cB', send: (event, payload) => events.push([event, payload]),
    });
    await authority.roomFor(alias, async () => ({ canonicalPath: filePath, identity: alias.identity }));

    const synced = jest.fn();
    engine.on('file-synced', synced);

    apiClient.getNodeContent.mockResolvedValueOnce({
      content: after,
      nodeType: 'site',
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
      etag: 'cs-remote',
      structureVersion: 'st2',
    });

    const result = await executeDecision(engine, '7', { action: A.DOWNLOAD }, { path: 'index.html', type: 'site', parentId: 0 });

    expect(result.action).toBe(A.DOWNLOAD);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(after);
    expect(fileWritten).toEqual([{ key: filePath, html: after }]);

    const states = events.filter(([event]) => event === 'data-state');
    expect(states).toHaveLength(1);
    expect(states[0][1].stores.count.value).toEqual({ n: 1 });

    expect(a.calls).toEqual([['index.html', { html: after, sender: 'sync-engine' }, { lane: 'saved' }]]);
    expect(b.calls).toEqual([['alias/index.html', { html: after, sender: 'sync-engine' }, { lane: 'saved' }]]);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.repo.get('7')).toEqual(expect.objectContaining({ type: 'site', path: 'index.html', remoteEtag: 'cs-remote' }));
    member.close();
  });

  test('a reconcile binary download records the stamp of the bytes it wrote', async () => {
    const filePath = path.join(dir, 'photo.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createReconcileEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    apiClient.getNodeContent.mockResolvedValueOnce({
      content: bytes,
      nodeType: 'upload',
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
      etag: 'cs-remote',
      size: bytes.length,
    });

    const result = await executeDecision(engine, '42', { action: A.DOWNLOAD }, { path: 'photo.png', type: 'upload', parentId: 0 });

    expect(result.action).toBe(A.DOWNLOAD);
    expect(fs.readFileSync(filePath)).toEqual(bytes);
    expect(confirm).toHaveBeenCalledTimes(1);

    const stamp = await confirm.mock.results[0].value;
    const stat = fs.statSync(filePath, { bigint: true });
    expect(stamp.identity).toBe(authority.identityAt(filePath));
    expect(stamp.etag).toBe(documentEtag(bytes));
    expect(stamp.size).toBe(BigInt(bytes.length));
    expect(stamp.ino).toBe(stat.ino);
    expect(stamp.dev).toBe(stat.dev);

    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.repo.get('42')).toEqual(expect.objectContaining({ type: 'upload', path: 'photo.png', remoteEtag: 'cs-remote' }));
  });

  test('a reconcile download that pauses while its alias retargets writes the old bytes nowhere', async () => {
    const aliasPath = path.join(dir, 'alias.html');
    const aPath = path.join(dir, 'a.html');
    const bPath = path.join(dir, 'b.html');
    fs.symlinkSync('a.html', aliasPath);

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createReconcileEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const before = apiClient.getNodeContent.mock.calls.length;
    const fetch = pauseNextFetch();

    const pending = executeDecision(engine, '7', { action: A.DOWNLOAD }, { path: 'alias.html', type: 'site', parentId: 0 });
    await fetch.started;

    fs.unlinkSync(aliasPath);
    fs.symlinkSync('b.html', aliasPath);

    fetch.release({
      content: '<html>remote</html>',
      nodeType: 'site',
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
      etag: 'cs-remote',
      structureVersion: 'st2',
    });

    expect(await pending).toEqual({ action: A.DOWNLOAD, stale: true });
    expect(apiClient.getNodeContent.mock.calls.length - before).toBe(1);
    expect(fs.readFileSync(aPath, 'utf8')).toBe('<html>a</html>');
    expect(fs.readFileSync(bPath, 'utf8')).toBe('<html>b</html>');
    expect(fs.existsSync(path.join(dir, '.hyperclay'))).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(engine.repo.has('7')).toBe(false);
  });

  test('a queued generation change skips the SSE folder mkdir, the repo entry and the success event', async () => {
    const folderPath = path.join(dir, 'projects');

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const blocker = await holdStructure();
    const pending = engine._applyNodeSavedFolder({ nodeId: 60, nodeType: 'folder', path: 'projects', parentId: 0 });
    await waitForTarget(authority, folderPath);

    engine.generation = 2;
    blocker.release();
    await blocker.pending;
    await pending;

    expect(fs.existsSync(folderPath)).toBe(false);
    expect(engine.repo.has(60)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
  });

  test('a queued generation change skips the reconcile folder mkdir, the repo entry and the success event', async () => {
    const folderPath = path.join(dir, 'proj');

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createReconcileEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    const blocker = await holdStructure();
    const pending = executeDecision(engine, '10', { action: A.DOWNLOAD }, { path: 'proj', type: 'folder', parentId: 0 });
    await waitForTarget(authority, folderPath);

    engine.generation = 2;
    blocker.release();
    await blocker.pending;

    expect(await pending).toEqual({ action: A.DOWNLOAD, stale: true });
    expect(fs.existsSync(folderPath)).toBe(false);
    expect(engine.repo.has('10')).toBe(false);
    expect(synced).not.toHaveBeenCalled();
  });

  test('an admitted folder creation excludes a concurrent document writer', async () => {
    const folderPath = path.join(dir, 'made');

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const control = controlledDirectoryChange(engine);

    const pending = engine._applyNodeSavedFolder({ nodeId: 61, nodeType: 'folder', path: 'made', parentId: 0 });
    await control.started;

    let writerRan = false;
    const writer = withLocalDocumentWrite(engine, 'a.html', async (target) => {
      writerRan = true;
      await fs.promises.writeFile(target.canonicalPath, '<html>writer</html>');
    });
    await waitForTarget(authority, path.join(dir, 'a.html'));
    for (let attempt = 0; attempt < 20; attempt++) await flush();

    expect(writerRan).toBe(false);
    expect(fs.existsSync(folderPath)).toBe(false);

    control.release();
    await pending;
    await writer;

    expect(writerRan).toBe(true);
    expect(fs.statSync(folderPath).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'a.html'), 'utf8')).toBe('<html>writer</html>');
    expect(engine.repo.get(61)).toEqual(expect.objectContaining({ type: 'folder', path: 'made', parentId: 0 }));
  });
});

describe('D2c1: the engine claims a document before it queues', () => {
  test('a queued write claims nothing and refuses a location retired while it waited', async () => {
    const filePath = path.join(dir, 'a.html');
    const authority = engine.localAuthority;
    const before = fs.readFileSync(filePath, 'utf8');

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = withStructureChange(async (token) => {
      entered();
      await held;
      authority.setAdmission(token, {
        rootId: 'root-a', logicalPath: 'a.html', canonicalPath: filePath, active: false,
      });
    });
    await started;

    let writes = 0;
    const pending = withLocalDocumentWrite(engine, 'a.html', async (target) => {
      writes++;
      await fs.promises.writeFile(target.canonicalPath, '<html>stale</html>');
    }, { generation: 1 });
    await waitForClaim(authority, filePath);

    expect(authority.identityAt(filePath)).toBeNull();
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'a.html', origin: null })).toBeNull();

    release();
    await gate;

    expect(await pending).toEqual({ stale: true });
    expect(writes).toBe(0);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(authority.identityAt(filePath)).toBeNull();
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'a.html', origin: null })).toBeNull();
  });

  test('a remote file download installs one identity, one binding and one room confirmation', async () => {
    const filePath = path.join(dir, 'fresh.html');
    const body = doc({ n: 1 });

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    apiClient.getNodeContent.mockResolvedValueOnce({
      content: body,
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
    });

    expect(fs.existsSync(filePath)).toBe(false);
    await engine.downloadFile(7, 'fresh.html');

    expect(fs.readFileSync(filePath, 'utf8')).toBe(body);
    expect(confirm).toHaveBeenCalledTimes(1);

    const stamp = await confirm.mock.results[0].value;
    expect(stamp.identity).toBe(authority.identityAt(filePath));
    expect(stamp.etag).toBe(documentEtag(body));
    expect(authority.confirmedStamp(filePath)).not.toBeNull();
    expect(fileWritten).toEqual([{ key: filePath, html: body }]);
    expect(live.calls).toEqual([['fresh.html', { html: body, sender: 'sync-engine' }, { lane: 'saved' }]]);

    const member = authority.registerEditor(confirm.mock.calls[0][0], { clientId: 'cA', send: () => {} });
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'fresh.html', origin: null }))
      .toEqual(expect.objectContaining({ canonicalPath: filePath, identity: stamp.identity }));
    member.close();
  });

  test('a downloaded page body with a tag stores the clean file and its merge state beside it', async () => {
    const filePath = path.join(dir, 'page.html');
    const page = fs.readFileSync(path.join(__dirname, '../fixtures/ypage-template.html'), 'utf8');
    const { authority } = createAuthority();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: broadcastsTo().live, authority });
    apiClient.getNodeContent.mockResolvedValueOnce({
      content: page,
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-page',
    });

    await engine.downloadFile(7, 'page.html');

    const stored = fs.readFileSync(filePath, 'utf8');
    expect(stored).not.toContain('merge="page"');
    expect(stored).toContain('data-page="1"');
    expect(await readPageState(dir, 'page.html')).toEqual(splitPage(page).state);
  });

  test('a write the disk refuses before confirmation leaves no identity, binding or room', async () => {
    const sub = path.join(dir, 'locked');
    const filePath = path.join(sub, 'new.html');
    fs.mkdirSync(sub);

    const { authority, fileWritten } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });

    let writes = 0;
    fs.chmodSync(sub, 0o555);
    let failure;
    try {
      failure = await withLocalDocumentWrite(engine, 'locked/new.html', async (target) => {
        writes++;
        await fs.promises.writeFile(target.canonicalPath, doc({ n: 1 }));
      }).then(() => null, (error) => error);
    } finally {
      fs.chmodSync(sub, 0o755);
    }

    expect(failure).not.toBeNull();
    expect(writes).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readdirSync(sub)).toEqual([]);
    expect(authority.identityAt(filePath)).toBeNull();
    expect(authority.confirmedStamp(filePath)).toBeNull();
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'locked/new.html', origin: null })).toBeNull();
    expect(authority.rooms.get(filePath)).toBeNull();
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
  });

  test('an explicit create at a retired name refuses a present file and succeeds when absent', async () => {
    const docPath = path.join(dir, 'retired.html');
    const location = { rootId: 'root-a', logicalPath: 'retired.html', canonicalPath: docPath };
    const untracked = doc({ n: 9 });

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });

    fs.writeFileSync(docPath, untracked);
    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false }));
    expect(authority.isRetired(location)).toBe(true);

    let writes = 0;
    const refused = await withLocalDocumentWrite(engine, 'retired.html', async (target) => {
      writes++;
      await fs.promises.writeFile(target.canonicalPath, doc({ n: 1 }));
    }, { explicitCreate: true });

    expect(refused).toEqual({ stale: true });
    expect(writes).toBe(0);
    expect(fs.readFileSync(docPath, 'utf8')).toBe(untracked);
    expect(authority.isRetired(location)).toBe(true);
    expect(authority.identityAt(docPath)).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(fileWritten).toHaveLength(0);

    const body = doc({ n: 1 });
    fs.unlinkSync(docPath);
    let createdTarget = null;
    const created = await withLocalDocumentWrite(engine, 'retired.html', async (target, token) => {
      writes++;
      createdTarget = target;
      await fs.promises.writeFile(target.canonicalPath, body);
      return authority.confirmKnownWrite(target, body, token, { sender: 'sync-engine' });
    }, { explicitCreate: true });

    expect(writes).toBe(1);
    expect(fs.readFileSync(docPath, 'utf8')).toBe(body);
    expect(created.identity).toBe(authority.identityAt(docPath));
    expect(authority.isRetired(location)).toBe(false);
    expect(fileWritten).toEqual([{ key: docPath, html: body }]);
    expect(live.calls).toEqual([['retired.html', { html: body, sender: 'sync-engine' }, { lane: 'saved' }]]);

    const member = authority.registerEditor(createdTarget, { clientId: 'cA', send: () => {} });
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'retired.html', origin: null }))
      .toEqual(expect.objectContaining({ canonicalPath: docPath, identity: created.identity }));
    member.close();
  });

  test('an explicit-create-capable overwrite keeps an existing file admission revision', async () => {
    const filePath = path.join(dir, 'a.html');
    const location = { rootId: 'root-a', logicalPath: 'a.html', canonicalPath: filePath };
    const authority = engine.localAuthority;
    const before = authority.captureAdmission(location);
    const body = doc({ n: 4 });
    let writes = 0;

    await withLocalDocumentWrite(engine, 'a.html', async (target, token) => {
      writes++;
      await fs.promises.writeFile(filePath, body);
      await authority.confirmKnownWrite(target, body, token, { sender: 'sync-engine' });
    }, { explicitCreate: true });

    const after = authority.captureAdmission(location);
    expect(writes).toBe(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(body);
    expect(after.canonicalRevision).toBe(before.canonicalRevision);
    expect(after.logicalRevision).toBe(before.logicalRevision);
    expect(authority.confirmedStamp(filePath)).not.toBeNull();
  });
});

describe('D2c2: the engine confirms a directory before it admits it', () => {
  test('a queued folder create claims nothing and refuses a location retired while it waited', async () => {
    const folderPath = path.join(dir, 'queued');
    const location = { rootId: 'root-a', logicalPath: 'queued', canonicalPath: folderPath };

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);
    const mkdir = jest.spyOn(fs.promises, 'mkdir');
    mkdir.mockClear();

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = withStructureChange(async (token) => {
      entered();
      await held;
      authority.setAdmission(token, { ...location, active: false, prefix: true });
    });
    await started;

    const pending = engine._applyNodeSavedFolder({ nodeId: 62, nodeType: 'folder', path: 'queued', parentId: 0 });
    await waitForTarget(authority, folderPath);

    expect(authority.identityAt(folderPath)).toBeNull();
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'queued', origin: null })).toBeNull();

    release();
    await gate;
    await pending;

    expect(authority.isRetired(location)).toBe(true);
    expect(mkdir).not.toHaveBeenCalled();
    expect(fs.existsSync(folderPath)).toBe(false);
    expect(engine.repo.has(62)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
    expect(live.calls).toHaveLength(0);
  });

  test('a retired folder the disk is missing is created and clears its own and a child retirement', async () => {
    const folderPath = path.join(dir, 'projects');
    const childPath = path.join(dir, 'projects/child');
    const location = { rootId: 'root-a', logicalPath: 'projects', canonicalPath: folderPath };
    const childLocation = { rootId: 'root-a', logicalPath: 'projects/child', canonicalPath: childPath };

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);
    const mkdir = jest.spyOn(fs.promises, 'mkdir');
    mkdir.mockClear();

    await withStructureChange((token) => {
      authority.setAdmission(token, { ...location, active: false, prefix: true });
      authority.setAdmission(token, { ...childLocation, active: false, prefix: true });
    });
    expect(authority.isRetired(location)).toBe(true);
    expect(authority.isRetired(childLocation)).toBe(true);
    expect(fs.existsSync(folderPath)).toBe(false);

    const control = controlledDirectoryChange(engine);
    const pending = engine._applyNodeSavedFolder({ nodeId: 63, nodeType: 'folder', path: 'projects', parentId: 0 });
    await control.started;

    expect(authority.isRetired(location)).toBe(true);
    expect(fs.existsSync(folderPath)).toBe(false);
    expect(engine.repo.has(63)).toBe(false);
    expect(synced).not.toHaveBeenCalled();

    control.release();
    await pending;

    expect(mkdir.mock.calls.filter(([target]) => target === folderPath)).toHaveLength(1);
    expect(fs.statSync(folderPath).isDirectory()).toBe(true);
    expect(authority.isRetired(location)).toBe(false);
    expect(authority.isRetired(childLocation)).toBe(false);
    expect(authority.identityAt(folderPath)).toBeNull();
    expect(authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'projects', origin: null })).toBeNull();
    expect(engine.repo.get(63)).toEqual(expect.objectContaining({ type: 'folder', path: 'projects', parentId: 0 }));
    expect(synced).toHaveBeenCalledTimes(1);
    expect(live.calls).toHaveLength(0);
  });

  test('a retired folder path the disk already holds is refused without a repo entry', async () => {
    const folderPath = path.join(dir, 'occupied');
    const location = { rootId: 'root-a', logicalPath: 'occupied', canonicalPath: folderPath };

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);
    const mkdir = jest.spyOn(fs.promises, 'mkdir');
    mkdir.mockClear();

    fs.mkdirSync(folderPath);
    fs.writeFileSync(path.join(folderPath, 'untracked.html'), '<html>kept</html>');
    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false, prefix: true }));

    await engine._applyNodeSavedFolder({ nodeId: 64, nodeType: 'folder', path: 'occupied', parentId: 0 });

    expect(mkdir).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(folderPath, 'untracked.html'), 'utf8')).toBe('<html>kept</html>');
    expect(authority.isRetired(location)).toBe(true);
    expect(authority.identityAt(folderPath)).toBeNull();
    expect(engine.repo.has(64)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
    expect(live.calls).toHaveLength(0);
  });

  test('a refused mkdir leaves the retirement in force and writes no repo entry', async () => {
    const locked = path.join(dir, 'locked');
    const folderPath = path.join(locked, 'projects');
    const location = { rootId: 'root-a', logicalPath: 'locked/projects', canonicalPath: folderPath };
    fs.mkdirSync(locked);

    const { authority } = createAuthority();
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);
    const mkdir = jest.spyOn(fs.promises, 'mkdir');
    mkdir.mockClear();

    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false, prefix: true }));

    fs.chmodSync(locked, 0o555);
    let failure;
    try {
      failure = await engine._applyNodeSavedFolder({ nodeId: 65, nodeType: 'folder', path: 'locked/projects', parentId: 0 })
        .then(() => null, (error) => error);
    } finally {
      fs.chmodSync(locked, 0o755);
    }

    expect(failure).not.toBeNull();
    expect(mkdir.mock.calls.filter(([target]) => target === folderPath)).toHaveLength(1);
    expect(fs.existsSync(folderPath)).toBe(false);
    expect(authority.isRetired(location)).toBe(true);
    expect(engine.repo.has(65)).toBe(false);
    expect(synced).not.toHaveBeenCalled();
    expect(live.calls).toHaveLength(0);
  });
});

describe('D2c3b: a confirmed remote create at a retired absent name', () => {
  test('an SSE site creation at a retired absent name writes once, confirms once and clears retirement', async () => {
    const filePath = path.join(dir, 'retired.html');
    const location = { rootId: 'root-a', logicalPath: 'retired.html', canonicalPath: filePath };
    const body = doc({ n: 5 });

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false }));
    expect(authority.isRetired(location)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);

    await engine._applyNodeSavedSite({
      nodeId: 7,
      nodeType: 'site',
      path: 'retired.html',
      content: body,
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe(body);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(authority.isRetired(location)).toBe(false);
    expect(fileWritten).toEqual([{ key: filePath, html: body }]);
    expect(live.calls).toHaveLength(1);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.repo.get(7)).toEqual(expect.objectContaining({ type: 'site', path: 'retired.html' }));
  });

  test('a binary remote download at a retired absent name keeps the binary stamp and remote modified time', async () => {
    const filePath = path.join(dir, 'retired.png');
    const location = { rootId: 'root-a', logicalPath: 'retired.png', canonicalPath: filePath };
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const modifiedAt = '2026-04-08T12:00:00Z';

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false }));
    expect(authority.isRetired(location)).toBe(true);

    apiClient.getNodeContent.mockResolvedValueOnce({
      content: bytes,
      modifiedAt,
      checksum: 'cs-remote',
      nodeType: 'upload',
      size: bytes.length,
    });

    await engine.downloadFile(42, 'retired.png');

    expect(fs.readFileSync(filePath)).toEqual(bytes);
    expect(fs.statSync(filePath).mtime.getTime()).toBe(new Date(modifiedAt).getTime());
    expect(confirm).toHaveBeenCalledTimes(1);

    const stamp = await confirm.mock.results[0].value;
    expect(stamp.identity).toBe(authority.identityAt(filePath));
    expect(stamp.etag).toBe(documentEtag(bytes));
    expect(stamp.size).toBe(BigInt(bytes.length));
    expect(authority.confirmedStamp(filePath)).not.toBeNull();
    expect(authority.isRetired(location)).toBe(false);
    expect(fileWritten).toHaveLength(0);
    expect(synced).toHaveBeenCalledTimes(1);
  });

  test('a reconcile download at a retired absent name confirms, installs the repo entry and clears retirement', async () => {
    const filePath = path.join(dir, 'retired.html');
    const location = { rootId: 'root-a', logicalPath: 'retired.html', canonicalPath: filePath };
    const body = doc({ n: 8 });

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createReconcileEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false }));
    expect(authority.isRetired(location)).toBe(true);

    apiClient.getNodeContent.mockResolvedValueOnce({
      content: body,
      nodeType: 'site',
      modifiedAt: '2026-04-08T12:00:00Z',
      checksum: 'cs-remote',
      etag: 'cs-remote',
      structureVersion: 'st2',
    });

    const result = await executeDecision(engine, '7', { action: A.DOWNLOAD }, { path: 'retired.html', type: 'site', parentId: 0 });

    expect(result.action).toBe(A.DOWNLOAD);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(body);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(authority.isRetired(location)).toBe(false);
    expect(fileWritten).toEqual([{ key: filePath, html: body }]);
    expect(synced).toHaveBeenCalledTimes(1);
    expect(engine.repo.get('7')).toEqual(expect.objectContaining({ type: 'site', path: 'retired.html', remoteEtag: 'cs-remote' }));
  });

  test('a delayed SSE event for a node ID tracked at another path refuses the retired old name', async () => {
    const oldPath = path.join(dir, 'old.html');
    const newPath = path.join(dir, 'new.html');
    const location = { rootId: 'root-a', logicalPath: 'old.html', canonicalPath: oldPath };
    fs.writeFileSync(newPath, doc({ n: 2 }));

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });
    const synced = jest.fn();
    engine.on('file-synced', synced);

    await engine.repo.set(7, { type: 'site', path: 'new.html', checksum: 'cs-old', syncedAt: Date.now() });
    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: false }));
    expect(authority.isRetired(location)).toBe(true);

    await engine._applyNodeSavedSite({
      nodeId: 7,
      nodeType: 'site',
      path: 'old.html',
      content: doc({ n: 3 }),
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.hyperclay'))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(fileWritten).toHaveLength(0);
    expect(live.calls).toHaveLength(0);
    expect(synced).not.toHaveBeenCalled();
    expect(authority.isRetired(location)).toBe(true);
    expect(engine.repo.get(7)).toEqual(expect.objectContaining({ type: 'site', path: 'new.html' }));
  });

  test('a remote site update to an existing active file keeps its admission revisions', async () => {
    const filePath = path.join(dir, 'a.html');
    const location = { rootId: 'root-a', logicalPath: 'a.html', canonicalPath: filePath };
    const body = doc({ n: 6 });

    const { authority, fileWritten } = createAuthority();
    const confirm = jest.spyOn(authority, 'confirmKnownWrite');
    const live = broadcastsTo();
    const engine = createEngine({ syncFolder: dir, rootId: 'root-a', live: live.live, authority });

    await engine.repo.set(7, { type: 'site', path: 'a.html', checksum: 'cs-old', syncedAt: Date.now() });
    await withStructureChange((token) => authority.setAdmission(token, { ...location, active: true }));
    const before = authority.captureAdmission(location);

    await engine._applyNodeSavedSite({
      nodeId: 7,
      nodeType: 'site',
      path: 'a.html',
      content: body,
      checksum: 'cs-remote',
      modifiedAt: '2026-04-08T12:00:00Z',
    });

    const after = authority.captureAdmission(location);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(body);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fileWritten).toEqual([{ key: filePath, html: body }]);
    expect(after.canonicalRevision).toBe(before.canonicalRevision);
    expect(after.logicalRevision).toBe(before.logicalRevision);
  });
});
