const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createAutoNamer } = require('../../src/main/workspace/auto-name');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, atomicWriteFile } = require('../../src/main/utils/write-queue');

let dir;
afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); dir = null; });

async function setup(html = '<article data-page><h1>First Heading</h1></article>') {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-name-'));
  const root = { id: 'root-a', path: path.join(dir, 'root') };
  await fs.mkdir(root.path);
  let rel = 'untitled.html';
  await fs.writeFile(path.join(root.path, rel), html);
  const room = { key: path.join(root.path, rel), nodeId: 'node-1', emptySince: Date.now() };
  let dirty = false;
  let editor = false;
  let pending = null;
  const authority = {
    rooms: new Map([[room.key, room]]),
    identityAt: () => room.nodeId,
    hasParticipatingEditors: () => editor,
    checkpointTargets: () => [{ rootId: root.id, logicalPath: rel }],
  };
  const checkpoint = { dirty: () => dirty, pending: () => pending };
  const rename = jest.fn(async (_, from, name) => {
    const destination = path.join(root.path, name);
    if (await fs.stat(destination).catch(() => null)) throw Object.assign(new Error('Taken'), { reason: 'conflict' });
    await fs.rename(path.join(root.path, from), destination);
    rel = name;
    return { path: name };
  });
  const namer = createAutoNamer({ appDataPath: dir, authority, checkpoint, rootFor: () => root, rename });
  await namer.record(root, 'untitled.html', 'page');
  return { namer, root, room, rename, authority, checkpoint, setDirty: value => { dirty = value; },
    setEditor: value => { editor = value; }, setPending: value => { pending = value; },
    setRel: value => { rel = value; } };
}

test('an Untitled page takes its first saved heading after departure and persists no marker in HTML', async () => {
  const { namer, root, room } = await setup();
  namer.departed(room);
  let stored;
  for (let i = 0; i < 50; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    stored = JSON.parse(await fs.readFile(path.join(dir, 'auto-named.json'), 'utf8'));
    if (stored.entries.length === 0) break;
  }
  expect(await fs.readFile(path.join(root.path, 'first-heading.html'), 'utf8'))
    .toBe('<article data-page><h1>First Heading</h1></article>');
  expect(namer.entries.size).toBe(0);
  expect(stored.entries).toEqual([]);
});

test('a taken heading uses a suffix, while an empty heading leaves the record', async () => {
  const { namer, root, room } = await setup();
  await fs.writeFile(path.join(root.path, 'first-heading.html'), 'occupant');
  await namer.settle(room.key);
  expect(await fs.readFile(path.join(root.path, 'first-heading-2.html'), 'utf8'))
    .toContain('First Heading');
  await fs.rm(dir, { recursive: true, force: true });
  dir = null;
  const empty = await setup('<article data-page><h1> </h1></article>');
  await empty.namer.settle(empty.room.key);
  expect(empty.namer.entries.size).toBe(1);
});

test('dirty rooms and arriving editors prevent auto naming, and a person rename drops the record', async () => {
  const { namer, root, room, rename, setDirty, setEditor } = await setup();
  setDirty(true);
  await namer.settle(room.key);
  setDirty(false);
  setEditor(true);
  await namer.settle(room.key);
  expect(rename).not.toHaveBeenCalled();
  await fs.rename(path.join(root.path, 'untitled.html'), path.join(root.path, 'mine.html'));
  await namer.command(root, { command: 'rename', path: 'untitled.html', name: 'mine.html' }, 'mine.html');
  expect(namer.entries.size).toBe(0);
  await namer.settle(room.key);
  expect(rename).not.toHaveBeenCalled();
});

test('a non-page is not recorded, an external move follows the inode, and deletion drops the record', async () => {
  const { namer, root, room, setRel } = await setup();
  await namer.record(root, 'untitled.html', 'blank');
  expect(namer.entries.size).toBe(1);
  await fs.mkdir(path.join(root.path, 'Moved'));
  await fs.rename(path.join(root.path, 'untitled.html'), path.join(root.path, 'Moved/untitled.html'));
  setRel('Moved/untitled.html');
  await namer.observe(root, 'add', 'Moved/untitled.html');
  expect([...namer.entries.values()][0].path).toBe('Moved/untitled.html');
  expect(await fs.readFile(path.join(dir, 'auto-named.json'), 'utf8')).toContain('Moved/untitled.html');
  room.emptySince = null;
  await namer.settle(room.key);
  expect(namer.entries.size).toBe(1);
  await fs.unlink(path.join(root.path, 'Moved/untitled.html'));
  await namer.observe(root, 'unlink', 'Moved/untitled.html');
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const stored = JSON.parse(await fs.readFile(path.join(dir, 'auto-named.json'), 'utf8'));
    if (stored.entries.length === 0) break;
  }
  expect(namer.entries.size).toBe(0);
});

test('an external rename to a personal name ends auto naming', async () => {
  const { namer, root } = await setup();
  await fs.rename(path.join(root.path, 'untitled.html'), path.join(root.path, 'mine.html'));
  await namer.observe(root, 'add', 'mine.html');
  expect(namer.entries.size).toBe(0);
});

test('a confirmed atomic save keeps auto naming eligible', async () => {
  const { namer, root, room } = await setup();
  const oldIdentity = [...namer.entries.values()][0].fileIdentity;
  await fs.writeFile(path.join(root.path, 'replacement.html'), '<article data-page><h1>Updated</h1></article>');
  await fs.rename(path.join(root.path, 'replacement.html'), path.join(root.path, 'untitled.html'));
  const stamp = await fs.stat(room.key, { bigint: true });
  await namer.confirmedWrite(room.key, { identity: room.nodeId, ...stamp });
  await namer.observe(root, 'change', 'untitled.html');
  expect(namer.entries.size).toBe(1);
  expect([...namer.entries.values()][0].fileIdentity).not.toEqual(oldIdentity);
  await namer.settle(room.key);
  expect(await fs.readFile(path.join(root.path, 'updated.html'), 'utf8')).toContain('Updated');
});

test('the authority confirms its own atomic save to the auto namer', async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'auto-name-confirmed-')));
  const root = { id: 'root-a', path: dir };
  const file = path.join(dir, 'untitled.html');
  const first = '<article data-page><h1>First</h1></article>';
  const updated = '<article data-page><h1>Updated</h1></article>';
  await fs.writeFile(file, first);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const target = authority.bindTarget({ rootId: root.id, logicalPath: 'untitled.html',
    canonicalPath: file, origin: 'http://localhost:4000' });
  const room = authority.rooms.open(file, first, { nodeId: target.identity });
  authority.rooms.leave(room, null, []);
  const rename = jest.fn(async (_, from, name) => fs.rename(path.join(dir, from), path.join(dir, name)));
  const namer = createAutoNamer({ appDataPath: path.join(dir, 'meta'), authority,
    checkpoint: { dirty: () => false, pending: () => null }, rootFor: () => root, rename });
  authority.setCheckpointService({ confirmedWrite: namer.confirmedWrite, wake: () => {} });
  await namer.record(root, 'untitled.html', 'page');
  await withDocumentWrite(() => target, async (_locked, token) => {
    await atomicWriteFile(file, updated);
    await authority.confirmKnownWrite(target, updated, token);
  });
  expect(authority.checkpointTargets(file)).toHaveLength(1);
  expect(authority.rooms.get(file)).toBe(room);
  expect(room.emptySince).not.toBeNull();
  expect(namer.entries.size).toBe(1);
  await namer.observe(root, 'change', 'untitled.html');
  expect(namer.entries.size).toBe(1);
  expect([...namer.entries.values()][0].fileIdentity.ino).toBe(String((await fs.stat(file, { bigint: true })).ino));
  await namer.settle(file);
  expect(rename).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(dir, 'updated.html'), 'utf8')).toBe(updated);
});

test('a replacement while stopped cannot inherit auto naming after restart', async () => {
  const { root, room, rename, authority, checkpoint } = await setup();
  await fs.writeFile(path.join(root.path, 'replacement.html'), '<article data-page><h1>Replacement</h1></article>');
  await fs.rename(path.join(root.path, 'replacement.html'), room.key);
  const restarted = createAutoNamer({ appDataPath: dir, authority, checkpoint, rootFor: () => root, rename });
  await restarted.settle(room.key);
  expect(rename).not.toHaveBeenCalled();
  expect(restarted.entries.size).toBe(0);
  expect(await fs.readFile(room.key, 'utf8')).toContain('Replacement');
});

test('an observed replacement drops auto naming before departure', async () => {
  const { namer, root, room, rename } = await setup();
  await fs.writeFile(path.join(root.path, 'replacement.html'), '<article data-page><h1>Replacement</h1></article>');
  await fs.rename(path.join(root.path, 'replacement.html'), room.key);
  await namer.observe(root, 'change', 'untitled.html');
  await namer.settle(room.key);
  expect(rename).not.toHaveBeenCalled();
  expect(namer.entries.size).toBe(0);
});

test('an unknown inode never matches an auto-name record', async () => {
  const { namer, room, rename } = await setup();
  [...namer.entries.values()][0].fileIdentity.ino = '0';
  await namer.settle(room.key);
  expect(rename).not.toHaveBeenCalled();
  expect(namer.entries.size).toBe(0);
});

test('the checkpoint exposes scheduled work until an editor arrival cancels it', async () => {
  const room = { key: '/tmp/page.html', nodeId: 'node-1' };
  const authority = { rooms: new Map([[room.key, room]]), roomIsDirty: () => true };
  const checkpoint = createLocalCheckpoint({ authority, withDocument: () => {},
    immediate: fn => fn, cancelImmediate: () => {} });
  expect(checkpoint.departed(room)).toBe(true);
  const pending = checkpoint.pending(room.key);
  expect(pending).toBeInstanceOf(Promise);
  expect(checkpoint.arrived(room.key)).toBe(true);
  expect(await pending).toEqual({ kind: 'cancelled' });
  expect(checkpoint.pending(room.key)).toBeNull();
});

test('a clean retry wakes the auto namer after the first checkpoint attempt failed', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-name-retry-'));
  const key = path.join(dir, 'untitled.html');
  await fs.writeFile(key, '<article data-page><h1>Ready</h1></article>');
  const room = { key, nodeId: 'node-1', emptySince: Date.now() };
  let dirty = true;
  let attempts = 0;
  const rooms = new Map([[key, room]]);
  rooms.markSaved = () => { dirty = false; };
  const authority = {
    rooms, roomIsDirty: () => dirty, hasParticipatingEditors: () => false,
    checkpointTargets: () => [{ rootId: 'root-a', identity: 'node-1', logicalPath: 'untitled.html' }],
    captureAdmission: () => ({}), validateAdmission: () => {},
    reconcileDisk: async () => ({ kind: 'current' }),
  };
  const checkpoint = createLocalCheckpoint({
    authority, withDocument: async (_, fn) => {
      if (++attempts === 1) throw new Error('temporary write failure');
      return fn(null, {});
    },
    loadCore: async () => ({ captureCheckpoint: () => ({}), isCheckpointCurrent: () => true }),
    setTimer: () => 1, clearTimer: () => {}, logError: () => {},
  });
  const departed = jest.fn();
  checkpoint.setAutoNamer({ departed });
  checkpoint.registerWriter('root-a', () => {});
  expect((await checkpoint.attempt(key)).kind).toBe('transient');
  expect(departed).not.toHaveBeenCalled();
  expect((await checkpoint.retry(key)).kind).toBe('current');
  expect(departed).toHaveBeenCalledWith(room);
});
