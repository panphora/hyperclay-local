// The canonical Local room registry: one identity per canonical file, a proof
// per connection, and room events that only reach current live members. The
// disk boundary (withDocument) is injected, so cold-load coalescing and the
// warm fast path are observable without touching a real file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority, LocalAuthorityError } = require('../../src/main/local-authority');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');

const tag = (name, value) => `<script type="application/json" merge="${name}" clay="live">${JSON.stringify(value)}</script>`;
const doc = (value) => `<!doctype html><html><body>${tag('count', value)}</body></html>`;

const CANONICAL = '/tmp/authority-doc.html';
const ALIAS = '/tmp/authority-alias.html';

const dirs = [];
function tempDoc(name, html) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'authority-binding-')));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function confirmSave(authority, target, html) {
  return withDocumentWrite(async () => target, async (resolved, token) => {
    await fs.promises.writeFile(resolved.canonicalPath, html);
    return authority.confirmKnownWrite(resolved, html, token);
  });
}

function harness({ html = doc({ n: 0 }), readSaved } = {}) {
  const state = { now: 1000, epoch: 0, id: 0 };
  const leaves = [];
  const reads = [];
  const core = createRooms({ now: () => state.now, newEpoch: () => `e${++state.epoch}` });
  const rooms = {
    ...core,
    leave(room, clientId, remaining) {
      leaves.push({ key: room.key, clientId, remaining: [...remaining] });
      return core.leave(room, clientId, remaining);
    },
  };
  const withDocumentCalls = [];
  let chain = Promise.resolve();
  const withDocument = (resolveTarget, fn) => {
    withDocumentCalls.push(1);
    const target = typeof resolveTarget === 'function' ? resolveTarget() : resolveTarget;
    chain = chain.catch(() => {}).then(() => fn(target));
    return chain;
  };
  const authority = createLocalAuthority({
    rooms,
    withDocument,
    readSaved: readSaved ?? (async (target) => {
      reads.push(target.canonicalPath);
      return html;
    }),
    now: () => state.now,
    newId: () => `id${++state.id}`,
  });
  const bind = (over = {}) => authority.bindTarget({
    rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: CANONICAL, origin: 'http://127.0.0.1:7000', live: true, ...over,
  });
  return { authority, core, state, leaves, reads, withDocumentCalls, bind };
}

test('binds one stable identity per canonical file, reused across root aliases', () => {
  const h = harness();
  const a = h.bind();
  const alias = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', canonicalPath: CANONICAL, origin: 'http://127.0.0.1:7001' });
  const other = h.bind({ logicalPath: '/other.html', canonicalPath: ALIAS });

  expect(a.identity).toBe(alias.identity);
  expect(a.identity).not.toBe(other.identity);
  expect(a.rootId).toBe('root-a');
  expect(alias.logicalPath).toBe('/alias/doc.html');
  expect(alias.origin).toBe('http://127.0.0.1:7001');
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(alias)).toBe(true);
});

test('currentEditor matches the exact live proof and newestEditor selects the latest', () => {
  const h = harness();
  const target = h.bind();
  const send = () => {};
  const first = h.authority.registerEditor(target, { clientId: 'c1', send });
  const second = h.authority.registerEditor(target, { clientId: 'c1', send });

  expect(first.conn).not.toBe(second.conn);
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['c1']);
  expect(h.authority.currentEditor(target, 'c1', first.conn)).toBe(first);
  expect(h.authority.currentEditor(target, 'c1', 'id-nope')).toBeNull();
  expect(h.authority.currentEditor(target, 'c2', first.conn)).toBeNull();
  expect(h.authority.currentEditor({ ...target, rootId: 'root-b' }, 'c1', first.conn)).toBeNull();
  expect(h.authority.currentEditor({ ...target, logicalPath: '/elsewhere.html' }, 'c1', first.conn)).toBeNull();
  expect(h.authority.currentEditor({ ...target, origin: 'http://127.0.0.1:9999' }, 'c1', first.conn)).toBeNull();
  expect(h.authority.currentEditor({ ...target, identity: 'other-identity' }, 'c1', first.conn)).toBeNull();
  expect(h.authority.newestEditor(target, 'c1')).toBe(second);
  expect(h.authority.newestEditor({ ...target, rootId: 'root-b' }, 'c1')).toBeNull();
});

test('closing one of two connections of a client waits; the last one leaves once', async () => {
  const h = harness();
  const target = h.bind();
  const room = await h.authority.roomFor(target, () => target);
  const sendA = jest.fn();
  const sendB = jest.fn();
  const b = h.authority.registerEditor(target, { clientId: 'cB', send: sendB });
  const a1 = h.authority.registerEditor(target, { clientId: 'cA', send: sendA });
  const a2 = h.authority.registerEditor(target, { clientId: 'cA', send: sendA });
  expect(h.core.apply(room, 'cA', { name: 'count', n: 1, ops: [{ op: 'set', path: ['n'], value: 5 }] }).writer).toBe('cA');
  h.core.touch(room, 'cB');

  a1.close();
  a1.close();
  expect(h.leaves).toEqual([]);
  expect(h.authority.currentEditor(target, 'cA', a1.conn)).toBeNull();
  expect(h.authority.currentEditor(target, 'cA', a2.conn)).toBe(a2);
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['cB', 'cA']);

  a2.close();
  expect(h.leaves).toEqual([{ key: CANONICAL, clientId: 'cA', remaining: ['cB'] }]);
  expect(sendB).toHaveBeenCalledWith('data-writer', { epoch: room.epoch, writer: 'cB' });
  expect(sendA).not.toHaveBeenCalledWith('data-writer', expect.anything());
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['cB']);

  expect(h.authority.publish(CANONICAL, 'data', { seq: 2, epoch: room.epoch })).toBe(1);
  expect(sendB).toHaveBeenCalledWith('data', { seq: 2, epoch: room.epoch });
  expect(b.participating).toBe(false);
});

test('closeRoot stops only its own root; the alias root keeps editing', async () => {
  const h = harness();
  const a = h.bind();
  const b = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' });
  const room = await h.authority.roomFor(a, () => a);
  const sendA = jest.fn();
  const sendB = jest.fn();
  const memberA = h.authority.registerEditor(a, { clientId: 'cA', send: sendA });
  const memberB = h.authority.registerEditor(b, { clientId: 'cB', send: sendB });
  const legacyA = h.authority.registerSnapshot(a, { lane: 'live', legacy: true });
  const viewerB = h.authority.registerSnapshot(b, { lane: 'saved' });

  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  expect(h.core.apply(room, 'cA', { name: 'count', n: 1, ops: [{ op: 'set', path: ['n'], value: 7 }] }).seq).toBe(1);

  h.authority.closeRoot('root-a');
  expect(h.authority.currentEditor(a, 'cA', memberA.conn)).toBeNull();
  expect(h.authority.currentEditor(b, 'cB', memberB.conn)).toBe(memberB);
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['cB']);
  expect(h.leaves).toEqual([{ key: CANONICAL, clientId: 'cA', remaining: ['cB'] }]);
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  legacyA();
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);

  expect(h.authority.publishState(CANONICAL)).toBe(1);
  expect(sendB).toHaveBeenCalledWith('data-state', h.core.state(room, 'cB'));
  expect(sendA).not.toHaveBeenCalled();

  h.authority.closeRoot('root-b');
  expect(h.authority.connectedIds(CANONICAL)).toEqual([]);
  expect(h.leaves).toEqual([
    { key: CANONICAL, clientId: 'cA', remaining: ['cB'] },
    { key: CANONICAL, clientId: 'cB', remaining: [] },
  ]);
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(false);
  viewerB();
});

test('publishState sends each member its own receipt, never another editor or a viewer', async () => {
  const h = harness();
  const target = h.bind();
  const room = await h.authority.roomFor(target, () => target);
  const sendA = jest.fn();
  const sendB = jest.fn();
  h.authority.registerEditor(target, { clientId: 'cA', send: sendA });
  h.authority.registerEditor(target, { clientId: 'cB', send: sendB });
  h.core.apply(room, 'cA', { name: 'count', n: 1, ops: [{ op: 'set', path: ['n'], value: 5 }] });
  const viewer = jest.fn();
  const disposeViewer = h.authority.registerSnapshot(target, { lane: 'saved' });

  expect(h.authority.publishState(CANONICAL)).toBe(2);
  expect(sendA).toHaveBeenCalledTimes(1);
  expect(sendB).toHaveBeenCalledTimes(1);
  const [eventA, stateA] = sendA.mock.calls[0];
  const [eventB, stateB] = sendB.mock.calls[0];
  expect(eventA).toBe('data-state');
  expect(eventB).toBe('data-state');
  expect(stateA.stores.count.value).toEqual({ n: 5 });
  expect(stateA.stores.count.seen).toEqual({ cA: 1 });
  expect(stateB.stores.count.seen).toEqual({});
  expect(stateA.epoch).toBe(stateB.epoch);
  expect(viewer).not.toHaveBeenCalled();

  disposeViewer();
  disposeViewer();
  expect(h.authority.publishState(CANONICAL)).toBe(2);
});

test('legacy live subscriptions and unread members block editing; a saved viewer alone does not', () => {
  const h = harness();
  const target = h.bind();
  const live = h.authority.registerSnapshot(target, { lane: 'live' });
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(false);

  const legacy = h.authority.registerSnapshot(target, { lane: 'live', legacy: true });
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  legacy();
  legacy();

  const send = jest.fn();
  const member = h.authority.registerEditor(target, { clientId: 'cA', send });
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  expect(h.authority.markParticipating(member)).toBe(member);
  expect(member.participating).toBe(true);
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(false);

  const second = h.authority.registerEditor(target, { clientId: 'cB', send });
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  second.close();
  expect(h.authority.markParticipating(second)).toBeNull();
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(false);
  live();
});

test('cold loads coalesce through withDocument and a warm room skips the boundary', async () => {
  const h = harness();
  const target = h.bind();
  const first = h.authority.roomFor(target, () => target);
  const second = h.authority.roomFor(target, () => target);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.withDocumentCalls).toHaveLength(2);

  const [roomA, roomB] = await Promise.all([first, second]);
  expect(roomA).toBe(roomB);
  expect(roomA.nodeId).toBe(target.identity);
  expect(h.reads).toEqual([CANONICAL]);

  const warm = await h.authority.roomFor(target, () => {
    throw new Error('warm lookups must not resolve through the disk boundary');
  });
  expect(warm).toBe(roomA);
  expect(h.withDocumentCalls).toHaveLength(2);
  expect(h.reads).toEqual([CANONICAL]);
});

test('roomFor reports moved and missing documents with typed codes', async () => {
  const h = harness();
  const target = h.bind();
  await expect(h.authority.roomFor(target, () => ({ ...target, canonicalPath: ALIAS })))
    .rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });
  await expect(h.authority.roomFor(target, () => null))
    .rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'not-found' });
  await expect(h.authority.roomFor(target, () => ({ ...target, identity: 'other-identity' })))
    .rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });

  const gone = harness({ readSaved: async () => { const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err; } });
  const missing = gone.bind();
  await expect(gone.authority.roomFor(missing, () => missing))
    .rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'not-found' });
  expect(LocalAuthorityError.prototype).toBeInstanceOf(Error);
});

test('roomFor resets a room left over from a stale document identity', async () => {
  const h = harness();
  const target = h.bind();
  const stale = h.core.open(CANONICAL, doc({ n: 9 }), { nodeId: 'stale-node' });
  expect(stale.epoch).toBe('e1');

  const room = await h.authority.roomFor(target, () => target);
  expect(room.nodeId).toBe(target.identity);
  expect(room.epoch).toBe('e2');
  expect(room.seq).toBe(0);
  expect(h.reads).toEqual([CANONICAL]);
});

test('roomFor refuses a new room over the core capacity without reading the file', async () => {
  const h = harness();
  const target = h.bind();
  const original = h.authority.rooms.mayFit;
  h.authority.rooms.mayFit = () => false;

  expect(await h.authority.roomFor(target, () => target)).toBeNull();
  expect(h.reads).toEqual([]);
  expect(h.withDocumentCalls).toHaveLength(0);
  h.authority.rooms.mayFit = original;
});

test('publish refuses unknown events and drops a member whose send throws', () => {
  const h = harness();
  const target = h.bind();
  const boom = jest.fn(() => { throw new Error('socket gone'); });
  const member = h.authority.registerEditor(target, { clientId: 'cA', send: boom });
  const snapshot = h.authority.registerSnapshot(target, { lane: 'live', legacy: true });

  expect(h.authority.publish(CANONICAL, 'html', {})).toBe(0);
  expect(h.authority.publish(CANONICAL, 'saved', {})).toBe(0);
  expect(h.authority.publish(CANONICAL, 'data', { seq: 1 })).toBe(0);
  expect(h.authority.connectedIds(CANONICAL)).toEqual([]);
  expect(h.authority.currentEditor(target, 'cA', member.conn)).toBeNull();
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(true);
  snapshot();
  expect(h.authority.hasUnjoinedEditors(CANONICAL)).toBe(false);
});

test('sweep marks empty rooms and prunes only this authority\'s idle rate buckets', () => {
  const h = harness();
  const target = h.bind();
  const bucket = `${CANONICAL}|127.0.0.1`;

  let granted = 0;
  while (h.authority.rateLimit(bucket)) granted += 1;
  expect(granted).toBe(40);
  h.state.now += 1000;
  granted = 0;
  while (h.authority.rateLimit(bucket)) granted += 1;
  expect(granted).toBe(25);

  h.state.now += 60001;
  h.authority.sweep();
  expect(h.authority.rateLimit(bucket)).toBe(true);
});

test('sweep closes the empty window on an open room and keeps a connected one', async () => {
  const h = harness();
  const target = h.bind();
  const room = await h.authority.roomFor(target, () => target);
  expect(room.emptySince).toBeNull();

  h.authority.sweep();
  expect(room.emptySince).toBe(1000);

  h.authority.registerEditor(target, { clientId: 'cA', send: () => {} });
  expect(room.emptySince).toBeNull();
  h.core.apply(room, 'cA', { name: 'count', n: 1, ops: [{ op: 'set', path: ['n'], value: 3 }] });
  h.state.now += 2 * 60 * 1000 + 1;
  h.authority.sweep();
  expect(h.authority.rooms.get(CANONICAL)).toBe(room);
  expect(room.emptySince).toBeNull();
});

test('findBoundTarget answers only the exact logical root/path/origin it bound', () => {
  const h = harness();
  const target = h.bind();
  const member = h.authority.registerEditor(target, { clientId: 'cA', send: () => {} });

  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7000' })).toBe(target);
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/other.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7001' })).toBeNull();
  expect(h.authority.findBoundTarget()).toBeNull();

  // A second logical root bound to the same canonical file is its own entry and
  // keeps the one identity.
  const alias = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' });
  const aliasMember = h.authority.registerEditor(alias, { clientId: 'cB', send: () => {} });
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' })).toBe(alias);
  expect(alias.identity).toBe(target.identity);
  member.close();
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' })).toBe(alias);
  aliasMember.close();
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' })).toBeNull();
});

test('a retargeted alias stops receiving the saved broadcast of the file it left', async () => {
  const aPath = tempDoc('a.html', doc({ n: 0 }));
  const bPath = tempDoc('b.html', doc({ n: 0 }));
  const h = harness();
  const leftLive = { broadcast: jest.fn() };
  const movedLive = { broadcast: jest.fn() };
  const writerLive = { broadcast: jest.fn() };

  h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', canonicalPath: aPath, origin: 'http://127.0.0.1:7001', live: leftLive });
  const target = h.bind({ canonicalPath: aPath, live: writerLive });
  h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', canonicalPath: bPath, origin: null, live: movedLive });

  const html = doc({ n: 1 });
  await confirmSave(h.authority, target, html);

  expect(leftLive.broadcast).not.toHaveBeenCalled();
  expect(movedLive.broadcast).not.toHaveBeenCalled();
  expect(writerLive.broadcast).toHaveBeenCalledTimes(1);
  expect(writerLive.broadcast).toHaveBeenCalledWith('/doc.html', { html, sender: 'server-save' }, { lane: 'saved' });
});

test('a first nonbroadcasting binding does not shadow a later broadcasting binding', async () => {
  const aPath = tempDoc('a.html', doc({ n: 0 }));
  const h = harness();
  const live = { broadcast: jest.fn() };

  h.bind({ rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: aPath, origin: 'http://127.0.0.1:7000', live: null });
  const target = h.bind({ rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: aPath, origin: 'http://127.0.0.1:7001', live });

  const html = doc({ n: 1 });
  await confirmSave(h.authority, target, html);

  expect(live.broadcast).toHaveBeenCalledTimes(1);
  expect(live.broadcast).toHaveBeenCalledWith('/doc.html', { html, sender: 'server-save' }, { lane: 'saved' });
});

test('registerRoot keys each root by id and closeRoot drops only that root’s bindings', () => {
  const h = harness();
  const a = h.bind();
  const alias = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' });
  const memberA = h.authority.registerEditor(a, { clientId: 'cA', send: () => {} });
  const memberB = h.authority.registerEditor(alias, { clientId: 'cB', send: () => {} });

  expect(h.authority.registerRoot({ id: 'root-a', path: '/tmp/root-a', canonicalPath: '/tmp/root-a-canonical' }))
    .toEqual({ id: 'root-a', canonicalPath: '/tmp/root-a-canonical' });
  h.authority.registerRoot({ id: 'root-b', path: '/tmp/root-b' });
  expect(() => h.authority.registerRoot({})).toThrow('registerRoot requires root id');
  expect(() => h.authority.registerRoot({ id: 'root-c' })).toThrow('registerRoot requires canonical root path');

  h.authority.closeRoot('root-a');

  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' })).toBe(alias);
  expect(alias.identity).toBe(a.identity);
  expect(h.authority.currentEditor(alias, 'cB', memberB.conn)).toBe(memberB);
  expect(h.authority.connectedIds(CANONICAL)).toEqual(['cB']);
  expect(memberA.close()).toBeUndefined();

  memberB.close();
});

test('closing and reopening a root with the same path leaves the old target stale', async () => {
  const h = harness();
  const file = tempDoc('doc.html', doc({ n: 0 }));
  const root = path.dirname(file);
  const origin = 'http://127.0.0.1:7000';
  const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: file, origin, live: true };
  h.authority.registerRoot({ id: 'root-a', canonicalPath: root, path: root }, { owner: 'server' });
  const old = h.authority.bindTarget(location);
  const room = await h.authority.roomFor(old, () => old);

  expect(h.authority.isCurrentTarget(old)).toBe(true);
  expect(room.nodeId).toBe(old.identity);

  h.authority.closeRoot('root-a');
  h.authority.registerRoot({ id: 'root-a', canonicalPath: root, path: root }, { owner: 'server' });

  // The same path and the same canonical identity came back, so only the dropped
  // route and the new incarnation can tell the old target from the new one.
  expect(h.authority.identityAt(file)).toBe(old.identity);
  expect(h.authority.isCurrentTarget(old)).toBe(false);
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin })).toBeNull();

  const fresh = h.authority.bindTarget(location);
  const freshMember = h.authority.registerEditor(fresh, { clientId: 'cA', send: () => {} });
  expect(fresh).not.toBe(old);
  expect(h.authority.isCurrentTarget(fresh)).toBe(true);
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin })).toBe(fresh);
  expect(h.authority.currentEditor(fresh, 'cA', freshMember.conn)).toBe(freshMember);
  expect(await h.authority.roomFor(fresh, () => fresh)).toBe(room);
  // The reopened root's route holds the same path and identity again, so the old
  // target is stale by its incarnation alone.
  expect(h.authority.isCurrentTarget(old)).toBe(false);
});

test('an alias bound before its root is registered stays current after registration', async () => {
  const h = harness();
  const target = h.bind();
  const alias = h.bind({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' });
  const member = h.authority.registerEditor(alias, { clientId: 'cB', send: () => {} });

  expect(h.authority.isCurrentTarget(target)).toBe(true);
  expect(h.authority.isCurrentTarget(alias)).toBe(true);

  h.authority.registerRoot({ id: 'root-a', path: '/tmp/root-a', canonicalPath: '/tmp/root-a-canonical' });
  h.authority.registerRoot({ id: 'root-b', path: '/tmp/root-b' });

  expect(h.authority.isCurrentTarget(target)).toBe(true);
  expect(h.authority.isCurrentTarget(alias)).toBe(true);
  expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: '/alias/doc.html', origin: 'http://127.0.0.1:7001' })).toBe(alias);
  expect(h.authority.currentEditor(alias, 'cB', member.conn)).toBe(member);

  h.authority.closeRoot('root-a');
  expect(h.authority.isCurrentTarget(target)).toBe(false);
  expect(h.authority.isCurrentTarget(alias)).toBe(true);
  member.close();
});
