// D1 admission state: canonical and per-root logical admission events plus a
// read-only prequeue claim. The real authority, the real document boundary and
// the real structure boundary are used, so a claim is validated under the same
// token a production caller would hold.

const fs = require('fs');
const os = require('os');
const path = require('upath');
const { createRooms, stampOf, serializeLive } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { documentEtag } = require('../../src/main/spec-wire');

const dirs = [];
function tempRoot() {
  const dir = path.resolve(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'authority-admission-'))));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function harness() {
  let ids = 0;
  const authority = createLocalAuthority({
    withDocument: (resolveTarget, fn) => Promise.resolve().then(async () => fn(await resolveTarget())),
    readSaved: async () => '<html></html>',
    now: () => 1000,
    newId: () => `id${++ids}`,
  });
  return { authority, root: tempRoot() };
}

const retire = (authority, options) => withStructureChange((token) => authority.setAdmission(token, { ...options, active: false }));
const admit = (authority, options) => withStructureChange((token) => authority.setAdmission(token, { ...options, active: true }));
const validate = (authority, claim, location) => withDocumentWrite(
  async () => ({ canonicalPath: location.canonicalPath }),
  (target, token) => authority.validateAdmission(claim, location, token),
);

describe('D1 admission state', () => {
  test('a read-only capture allocates no record and leaves identityAt null', async () => {
    const h = harness();
    const canonical = path.join(h.root, 'doc.html');
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical };
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'server' });

    const claim = h.authority.captureAdmission(location);

    expect(Object.isFrozen(claim)).toBe(true);
    expect(claim.canonicalPath).toBe(canonical);
    expect(claim.logicalPath).toBe('doc.html');
    expect(claim.incarnation).not.toBeNull();
    expect(claim.identity).toBeNull();
    expect(claim.canonicalRevision).toBe(0);
    expect(claim.logicalRevision).toBe(0);
    expect(h.authority.identityAt(canonical)).toBeNull();
    expect(h.authority.identityAt(canonical, { rootId: 'root-a', logicalPath: '/doc.html' })).toBeNull();
    expect(h.authority.captureAdmission(location)).toEqual(claim);
    await expect(validate(h.authority, claim, location)).resolves.toBe(true);
  });

  test('an upload owner may accept its first binding while still refusing retirement', async () => {
    const h = harness();
    const canonical = path.join(h.root, 'doc.html');
    fs.writeFileSync(canonical, '<html></html>');
    const location = { rootId: 'root-a', logicalPath: 'doc.html', canonicalPath: canonical };
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const claim = h.authority.captureAdmission(location);

    const target = h.authority.bindTarget({ ...location, origin: null, live: false });
    expect(target.identity).toBe(h.authority.identityAt(canonical));
    await expect(validate(h.authority, claim, location)).rejects.toMatchObject({ code: 'moved' });
    await expect(withDocumentWrite(
      async () => ({ canonicalPath: canonical }),
      (_locked, token) => h.authority.validateAdmission(claim, location, token, { allowInitialBind: true }),
    )).resolves.toBe(true);

    await retire(h.authority, location);
    await expect(withDocumentWrite(
      async () => ({ canonicalPath: canonical }),
      (_locked, token) => h.authority.validateAdmission(claim, location, token, { allowInitialBind: true }),
    )).rejects.toMatchObject({ code: 'moved' });
  });

  test('an exact retirement fails the old claim and refuses a fresh one', async () => {
    const h = harness();
    const canonical = path.join(h.root, 'doc.html');
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical };
    const claim = h.authority.captureAdmission(location);

    await retire(h.authority, { canonicalPath: canonical });

    expect(h.authority.isRetired(location)).toBe(true);
    expect(h.authority.identityAt(canonical)).toBeNull();
    const rejected = await validate(h.authority, claim, location).catch((err) => err);
    expect(rejected.code).toBe('moved');
    expect(rejected.message).not.toMatch(/network|unauthorized|expired|api key/i);

    const fresh = h.authority.captureAdmission(location);
    expect(fresh.canonicalRevision).toBeGreaterThan(claim.canonicalRevision);
    await expect(validate(h.authority, fresh, location)).rejects.toMatchObject({ code: 'moved' });
  });

  test('a folder-prefix retirement fails an unopened descendant but not a sibling', async () => {
    const h = harness();
    const oldDir = path.join(h.root, 'old');
    const child = path.join(oldDir, 'child.html');
    const olderDoc = path.join(h.root, 'older', 'doc.html');
    const childLocation = { rootId: 'root-a', logicalPath: '/old/child.html', canonicalPath: child };
    const siblingLocation = { rootId: 'root-a', logicalPath: '/older/doc.html', canonicalPath: olderDoc };
    const childClaim = h.authority.captureAdmission(childLocation);
    const siblingClaim = h.authority.captureAdmission(siblingLocation);

    await retire(h.authority, { rootId: 'root-a', logicalPath: '/old', canonicalPath: oldDir, prefix: true });

    expect(h.authority.isRetired(childLocation)).toBe(true);
    expect(h.authority.isRetired(siblingLocation)).toBe(false);
    expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: '/older' })).toBe(false);
    expect(h.authority.identityAt(child)).toBeNull();
    await expect(validate(h.authority, childClaim, childLocation)).rejects.toMatchObject({ code: 'moved' });
    await expect(validate(h.authority, siblingClaim, siblingLocation)).resolves.toBe(true);
  });

  test('a later active child re-admits that child only', async () => {
    const h = harness();
    const oldDir = path.join(h.root, 'old');
    const child = path.join(oldDir, 'child.html');
    const other = path.join(oldDir, 'other.html');
    const childLocation = { rootId: 'root-a', logicalPath: '/old/child.html', canonicalPath: child };
    const otherLocation = { rootId: 'root-a', logicalPath: '/old/other.html', canonicalPath: other };

    await retire(h.authority, { rootId: 'root-a', logicalPath: '/old', canonicalPath: oldDir, prefix: true });
    await admit(h.authority, { rootId: 'root-a', logicalPath: '/old/child.html', canonicalPath: child });

    expect(h.authority.isRetired(childLocation)).toBe(false);
    expect(h.authority.isRetired(otherLocation)).toBe(true);
    const childClaim = h.authority.captureAdmission(childLocation);
    await expect(validate(h.authority, childClaim, childLocation)).resolves.toBe(true);
    const otherClaim = h.authority.captureAdmission(otherLocation);
    await expect(validate(h.authority, otherClaim, otherLocation)).rejects.toMatchObject({ code: 'moved' });
  });

  test('an exact create at a retired directory does not admit its old children', async () => {
    const h = harness();
    const oldDir = path.join(h.root, 'old');
    const child = path.join(oldDir, 'child.html');
    const childLocation = { rootId: 'root-a', logicalPath: '/old/child.html', canonicalPath: child };

    await retire(h.authority, { rootId: 'root-a', logicalPath: '/old', canonicalPath: oldDir, prefix: true });
    await admit(h.authority, { rootId: 'root-a', logicalPath: '/old', canonicalPath: oldDir });

    expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: '/old', canonicalPath: oldDir })).toBe(false);
    expect(h.authority.isRetired(childLocation)).toBe(true);
    await expect(validate(h.authority, h.authority.captureAdmission(childLocation), childLocation))
      .rejects.toMatchObject({ code: 'moved' });
  });

  test('a later retired parent supersedes an older active child', async () => {
    const h = harness();
    const dir = path.join(h.root, 'dir');
    const child = path.join(dir, 'child.html');
    const location = { rootId: 'root-a', logicalPath: '/dir/child.html', canonicalPath: child };

    await admit(h.authority, { rootId: 'root-a', logicalPath: '/dir/child.html', canonicalPath: child });
    expect(h.authority.isRetired(location)).toBe(false);
    const claim = h.authority.captureAdmission(location);

    await retire(h.authority, { rootId: 'root-a', logicalPath: '/dir', canonicalPath: dir, prefix: true });

    expect(h.authority.isRetired(location)).toBe(true);
    await expect(validate(h.authority, claim, location)).rejects.toMatchObject({ code: 'moved' });
  });

  test('a move away and back refuses the old claim even with the same identity', async () => {
    const h = harness();
    const away = path.join(h.root, 'away');
    fs.mkdirSync(away);
    const canonical = path.join(h.root, 'doc.html');
    fs.writeFileSync(canonical, '<html></html>');
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical };
    const target = h.authority.bindTarget({ ...location, origin: 'http://127.0.0.1:7000', live: false });
    const claim = h.authority.captureAdmission(location);

    fs.renameSync(canonical, path.join(away, 'doc.html'));
    await retire(h.authority, { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical });
    expect(h.authority.identityAt(canonical)).toBeNull();

    fs.renameSync(path.join(away, 'doc.html'), canonical);
    await admit(h.authority, { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical });

    expect(h.authority.identityAt(canonical)).toBe(target.identity);
    expect(h.authority.isRetired(location)).toBe(false);
    await expect(validate(h.authority, claim, location)).rejects.toMatchObject({ code: 'moved' });
    const fresh = h.authority.captureAdmission(location);
    expect(fresh.identity).toBe(target.identity);
    await expect(validate(h.authority, fresh, location)).resolves.toBe(true);
  });

  test('a logical retirement affects root A but not alias root B', async () => {
    const h = harness();
    const canonical = path.join(h.root, 'doc.html');
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const target = h.authority.bindTarget({ rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical, origin: 'http://127.0.0.1:7000', live: false });
    const aLocation = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical };
    const bLocation = { rootId: 'root-b', logicalPath: '/doc.html', canonicalPath: canonical };
    const aClaim = h.authority.captureAdmission(aLocation);
    const bClaim = h.authority.captureAdmission(bLocation);

    await retire(h.authority, { rootId: 'root-a', logicalPath: '/doc.html' });

    expect(h.authority.isRetired(aLocation)).toBe(true);
    expect(h.authority.isRetired(bLocation)).toBe(false);
    expect(h.authority.identityAt(canonical, { rootId: 'root-a', logicalPath: '/doc.html' })).toBeNull();
    expect(h.authority.identityAt(canonical, { rootId: 'root-b', logicalPath: '/doc.html' })).toBe(target.identity);
    await expect(validate(h.authority, aClaim, aLocation)).rejects.toMatchObject({ code: 'moved' });
    await expect(validate(h.authority, bClaim, bLocation)).resolves.toBe(true);
  });

  test('close and re-register invalidates a claim while a second owner does not', async () => {
    const h = harness();
    const canonical = path.join(h.root, 'doc.html');
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical };
    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const claim = h.authority.captureAdmission(location);
    expect(claim.incarnation).not.toBeNull();

    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'sync' });
    await expect(validate(h.authority, claim, location)).resolves.toBe(true);

    h.authority.closeRoot('root-a', { owner: 'server' });
    await expect(validate(h.authority, claim, location)).resolves.toBe(true);

    h.authority.closeRoot('root-a', { owner: 'sync' });
    await expect(validate(h.authority, claim, location)).rejects.toMatchObject({ code: 'moved' });

    h.authority.registerRoot({ id: 'root-a', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    await expect(validate(h.authority, claim, location)).rejects.toMatchObject({ code: 'moved' });
    const fresh = h.authority.captureAdmission(location);
    expect(fresh.incarnation).not.toBe(claim.incarnation);
    await expect(validate(h.authority, fresh, location)).resolves.toBe(true);
  });
});

// D1 structure preparation: the real rooms package, the real structure gate and
// real holds. Every hold counted here came from rooms.holdPersistent, and every
// rekey counted here came from rooms.rekeyPersistent.

let realHolds = 0;
let realRekeys = 0;

const tag = (name, value, { ephemeral = false } = {}) =>
  `<script type="application/json" merge="${name}" clay="live${ephemeral ? ' ephemeral' : ''}">${JSON.stringify(value)}</script>`;
const page = (value) => `<!doctype html><html><body>${tag('count', value)}</body></html>`;
const ephemeralPage = (value) => `<!doctype html><html><body>${tag('draft', value, { ephemeral: true })}</body></html>`;

function structureHarness() {
  let ids = 0;
  let epochs = 0;
  const root = tempRoot();
  const core = createRooms({ now: () => 1000, newEpoch: () => `e${++epochs}` });
  const holds = [];
  const releases = [];
  const rekeys = [];
  const leaves = [];
  const rooms = {
    ...core,
    leave(room, clientId, remaining) {
      leaves.push({ key: room.key, clientId, remaining: [...remaining] });
      return core.leave(room, clientId, remaining);
    },
    holdPersistent(key, options) {
      const token = core.holdPersistent(key, options);
      holds.push(key);
      realHolds += 1;
      return token;
    },
    releasePersistent(token) {
      releases.push(token);
      return core.releasePersistent(token);
    },
    rekeyPersistent(token, key) {
      rekeys.push(key);
      realRekeys += 1;
      return core.rekeyPersistent(token, key);
    },
  };
  const authority = createLocalAuthority({
    rooms,
    withDocument: (resolveTarget, fn) => Promise.resolve().then(async () => fn(await resolveTarget())),
    readSaved: async () => page({ n: 0 }),
    now: () => 1000,
    newId: () => `id${++ids}`,
  });
  authority.registerRoot({ id: 'root-a', canonicalPath: root, path: root }, { owner: 'server' });

  const open = ({ logicalPath, canonicalPath, html = page({ n: 0 }) }) => {
    const target = authority.bindTarget({
      rootId: 'root-a', logicalPath, canonicalPath, origin: 'http://127.0.0.1:7000', live: false,
    });
    return { target, room: core.open(canonicalPath, html, { nodeId: target.identity }) };
  };
  const stepOf = ({ from, to, fromRel, toRel, canonical = from, toCanonical = to, isDir = false, isSymlink = false }) => ({
    from: { location: from, canonical, isDir, isSymlink },
    to: to ? { location: to, canonical: toCanonical } : null,
    fromRel,
    toRel,
  });
  const withPlan = (steps, fn) => withStructureChange(async (token) => {
    const plan = authority.prepareStructure(token, { rootId: 'root-a', steps });
    try { return await fn(plan, token); }
    finally { authority.releaseStructure(plan, token); }
  });
  const refuse = (steps) => withStructureChange((token) => {
    let plan;
    try {
      plan = authority.prepareStructure(token, { rootId: 'root-a', steps });
    } catch (err) {
      return err;
    }
    authority.releaseStructure(plan, token);
    throw new Error('prepareStructure accepted a refused plan');
  });

  return { authority, core, rooms, root, holds, releases, rekeys, leaves, open, stepOf, withPlan, refuse };
}

describe('D1 structure preparation', () => {
  test('clean A and B rooms prepare both prefixes and leave every room unchanged', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const keysBefore = h.core.keys();

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(plan.preview)).toBe(true);
      expect(Object.isFrozen(plan.preview.steps)).toBe(true);
      expect(plan.preview.rootId).toBe('root-a');
      expect(plan.preview.prefixCounts).toEqual([0, 1, 2]);
      expect(plan.preview.steps).toEqual([
        {
          from: { location: bPath, canonical: bPath, isDir: false, isSymlink: false },
          to: { location: cPath, canonical: cPath },
          fromRel: 'B.html',
          toRel: 'C.html',
        },
        {
          from: { location: aPath, canonical: aPath, isDir: false, isSymlink: false },
          to: { location: bPath, canonical: bPath },
          fromRel: 'A.html',
          toRel: 'B.html',
        },
      ]);

      expect(h.holds).toEqual([aPath, bPath]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.keys()).toEqual(keysBefore);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.core.get(bPath)).toBe(b.room);
      expect(h.core.get(aPath).epoch).toBe(a.room.epoch);
      expect(h.core.get(bPath).epoch).toBe(b.room.epoch);
      expect(h.core.get(aPath).seq).toBe(0);
      expect(h.core.get(bPath).nodeId).toBe(b.target.identity);
      expect(h.core.get(cPath)).toBeNull();
      expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
      expect(h.authority.identityAt(bPath)).toBe(b.target.identity);

      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(2);
      expect(await h.authority.releaseStructure(plan, token)).toBe(false);
      expect(h.releases).toHaveLength(2);
    });

    const again = h.rooms.holdPersistent(aPath, { nodeId: a.target.identity, requireClean: true });
    expect(again).toBeTruthy();
    h.core.releasePersistent(again);
  });

  test('a dirty persistent store refuses before any map change and releases the earlier hold', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const applied = h.core.apply(b.room, 'cB', {
      name: 'count', n: 1, epoch: b.room.epoch, ops: [{ op: 'set', path: ['n'], value: 5 }],
    }, { connected: ['cB'] });
    expect(applied.error).toBeUndefined();
    const store = h.core.get(bPath).stores.get('count');
    expect(store.landed).not.toBe(store.last);

    const keysBefore = h.core.keys();
    const refused = await h.refuse([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ]);

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('peers-editing');
    expect(refused.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(h.holds).toEqual([aPath]);
    expect(h.releases).toHaveLength(1);
    expect(h.rekeys).toEqual([]);
    expect(h.core.keys()).toEqual(keysBefore);
    expect(h.core.get(bPath)).toBe(b.room);
    expect(h.authority.identityAt(aPath)).toBe(a.target.identity);

    const again = h.rooms.holdPersistent(aPath, { nodeId: a.target.identity, requireClean: true });
    expect(again).toBeTruthy();
    h.core.releasePersistent(again);
  });

  test('ephemeral-only activity is not a dirty refusal', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath, html: ephemeralPage({ n: 0 }) });
    const applied = h.core.apply(a.room, 'cA', {
      name: 'draft', n: 1, epoch: a.room.epoch, ops: [{ op: 'set', path: ['n'], value: 3 }],
    }, { connected: ['cA'] });
    expect(applied.error).toBeUndefined();
    const store = h.core.get(aPath).stores.get('draft');
    expect(store.ephemeral).toBe(true);
    expect(store.landed).not.toBe(store.last);

    await h.withPlan([h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' })], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 1]);
      expect(h.holds).toEqual([aPath]);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(1);
    });
  });

  test('a reserved destination and an unplanned occupant both refuse with no hold', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const keysBefore = h.core.keys();

    const reservation = h.core.reservePageReplacement(cPath, {
      nodeId: 'page-node', html: '<!doctype html><html><body></body></html>',
    });
    expect(h.core.get(cPath)).toBeNull();
    expect(h.core.pageReserved(cPath)).toBe(true);

    const converting = await h.refuse([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ]);

    expect(converting.code).toBe('destination-exists');
    expect(h.holds).toEqual([]);
    expect(h.releases).toEqual([]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.keys()).toEqual(keysBefore);

    h.core.releasePage(reservation);
    expect(h.core.pageReserved(cPath)).toBe(false);
    const c = h.open({ logicalPath: 'C.html', canonicalPath: cPath });

    const occupied = await h.refuse([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ]);

    expect(occupied.code).toBe('destination-exists');
    expect(h.holds).toEqual([]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.keys()).toEqual([aPath, bPath, cPath]);
    expect(h.core.get(cPath)).toBe(c.room);
    expect(h.core.get(bPath)).toBe(b.room);
    expect(h.core.get(aPath)).toBe(a.room);
  });

  test('a directory step carries its descendants and refuses an occupied destination child', async () => {
    const h = structureHarness();
    const dir = path.join(h.root, 'dir');
    const moved = path.join(h.root, 'dir2');
    const child = path.join(dir, 'child.html');
    const clash = path.join(moved, 'child.html');
    const c = h.open({ logicalPath: 'dir/child.html', canonicalPath: child });

    await h.withPlan([h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'dir2', isDir: true })], async (plan) => {
      expect(plan.preview.prefixCounts).toEqual([0, 1]);
      expect(h.holds).toEqual([child]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.get(child)).toBe(c.room);
    });

    const other = h.open({ logicalPath: 'dir2/child.html', canonicalPath: clash });
    const refused = await h.refuse([h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'dir2', isDir: true })]);

    expect(refused.code).toBe('destination-exists');
    expect(h.holds).toEqual([child]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.get(child)).toBe(c.room);
    expect(h.core.get(clash)).toBe(other.room);
  });

  test('a room whose identity no longer matches its record is held, never rekeyed', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    h.core.drop(aPath);
    const stale = h.core.open(aPath, page({ n: 0 }), { nodeId: 'stale-node' });
    expect(stale.nodeId).toBe('stale-node');
    expect(h.authority.identityAt(aPath)).toBe(a.target.identity);

    await h.withPlan([h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' })], async () => {
      expect(h.holds).toEqual([aPath]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.get(aPath)).toBe(stale);
      expect(h.core.get(bPath)).toBeNull();
      expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
    });
  });

  test('a trash step prepares a removal with no destination', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });

    await h.withPlan([h.stepOf({ from: aPath, to: null, fromRel: 'A.html', toRel: null })], async (plan) => {
      expect(plan.preview.prefixCounts).toEqual([0, 1]);
      expect(plan.preview.steps[0].to).toBeNull();
      expect(plan.preview.steps[0].toRel).toBeNull();
      expect(h.holds).toEqual([aPath]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
    });
  });

  test('a final symlink holds the external room and prepares no canonical rekey', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const link = path.join(h.root, 'link.html');
    fs.symlinkSync(content, link);
    const renamed = path.join(h.root, 'renamed.html');
    const alias = h.open({ logicalPath: 'link.html', canonicalPath: content });

    await h.withPlan([h.stepOf({
      from: link, to: renamed, fromRel: 'link.html', toRel: 'renamed.html',
      canonical: content, isSymlink: true,
    })], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 0]);
      expect(plan.preview.steps[0].from.isSymlink).toBe(true);
      expect(plan.preview.steps[0].from.canonical).toBe(content);
      expect(plan.preview.steps[0].from.location).toBe(link);
      expect(h.holds).toEqual([content]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.keys()).toEqual([content]);
      expect(h.core.get(content)).toBe(alias.room);
      expect(h.core.get(renamed)).toBeNull();
      expect(h.authority.identityAt(content)).toBe(alias.target.identity);
      expect(path.resolve(fs.realpathSync(link))).toBe(content);

      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(1);
    });
  });

  test('a registered root, its ancestor, an unregistered root and a cross-root destination refuse', async () => {
    const h = structureHarness();
    const otherRoot = tempRoot();
    h.authority.registerRoot({ id: 'root-b', canonicalPath: otherRoot, path: otherRoot }, { owner: 'server' });
    const aPath = path.join(h.root, 'A.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const parent = path.dirname(h.root);

    const onRoot = await h.refuse([h.stepOf({
      from: h.root, to: path.join(parent, 'moved'), fromRel: 'root', toRel: 'moved', isDir: true,
    })]);
    expect(onRoot.code).toBe('root-boundary');

    const onAncestor = await h.refuse([h.stepOf({
      from: parent, to: path.join(h.root, 'moved'), fromRel: 'parent', toRel: 'moved', isDir: true,
    })]);
    expect(onAncestor.code).toBe('root-boundary');

    const crossRoot = await h.refuse([h.stepOf({
      from: aPath, to: path.join(otherRoot, 'A.html'), fromRel: 'A.html', toRel: 'A.html',
    })]);
    expect(crossRoot.code).toBe('root-boundary');

    const unregistered = await withStructureChange((token) =>
      h.authority.prepareStructure(token, { rootId: 'root-z', steps: [] })).catch((err) => err);
    expect(unregistered.code).toBe('root-boundary');

    expect(h.holds).toEqual([]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.get(aPath)).toBe(a.room);
    expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
  });

  test('the descriptor contract and the exclusive token are both enforced', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    h.open({ logicalPath: 'A.html', canonicalPath: aPath });

    expect(() => h.authority.prepareStructure(null, { rootId: 'root-a', steps: [] }))
      .toThrow('Structure boundary ownership required');

    const unnormalized = await h.refuse([h.stepOf({
      from: `${h.root}/./A.html`, to: null, fromRel: 'A.html', toRel: null,
    })]);
    expect(unnormalized).toBeInstanceOf(TypeError);

    const shape = await h.refuse([{ from: { location: aPath, canonical: aPath }, to: null, fromRel: 'A.html', toRel: null }]);
    expect(shape).toBeInstanceOf(TypeError);

    await h.withPlan([h.stepOf({ from: aPath, to: null, fromRel: 'A.html', toRel: null })], async (plan, token) => {
      expect(() => h.authority.releaseStructure(plan, null)).toThrow('Structure boundary ownership required');
      expect(h.holds).toEqual([aPath]);
      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(await h.authority.releaseStructure(plan, token)).toBe(false);
    });
  });

  test('a wrong live token cannot release a plan', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });

    const plan = await withStructureChange((token) => h.authority.prepareStructure(token, {
      rootId: 'root-a',
      steps: [h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' })],
    }));
    expect(h.holds).toEqual([aPath]);

    const refused = await withStructureChange((token) => {
      try {
        h.authority.releaseStructure(plan, token);
        return null;
      } catch (err) {
        return err;
      }
    });

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('invalid-reservation');
    expect(h.releases).toEqual([]);
    expect(h.core.get(aPath)).toBe(a.room);
    expect(() => h.rooms.holdPersistent(aPath, { nodeId: a.target.identity, requireClean: true }))
      .toThrow('checkpointing');
  });

  test('two affected rooms with the same node ID refuse and release the first hold', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const twin = h.core.reset(bPath, page({ n: 0 }), { nodeId: a.target.identity });
    expect(twin.nodeId).toBe(a.target.identity);

    const refused = await h.refuse([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ]);

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('checkpointing');
    expect(refused.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(h.holds).toEqual([aPath]);
    expect(h.releases).toHaveLength(1);
    expect(h.rekeys).toEqual([]);
    expect(h.core.get(aPath)).toBe(a.room);
    expect(h.core.get(bPath)).toBe(twin);

    const again = h.rooms.holdPersistent(aPath, { nodeId: a.target.identity, requireClean: true });
    expect(again).toBeTruthy();
    h.core.releasePersistent(again);
  });

  test('an untracked source cannot move onto a page-reserved or occupied destination', async () => {
    const h = structureHarness();
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const dPath = path.join(h.root, 'D.html');
    const ghost = path.join(h.root, 'ghost.html');
    h.open({ logicalPath: 'B.html', canonicalPath: bPath });

    const reservation = h.core.reservePageReplacement(cPath, {
      nodeId: 'page-node', html: '<!doctype html><html><body></body></html>',
    });
    const reserved = await h.refuse([
      h.stepOf({ from: ghost, to: cPath, fromRel: 'ghost.html', toRel: 'C.html' }),
    ]);
    expect(reserved.code).toBe('destination-exists');
    expect(h.holds).toEqual([]);
    expect(h.rekeys).toEqual([]);
    h.core.releasePage(reservation);

    const occupant = h.core.open(cPath, page({ n: 0 }), { nodeId: 'c-node' });
    const occupied = await h.refuse([
      h.stepOf({ from: ghost, to: cPath, fromRel: 'ghost.html', toRel: 'C.html' }),
    ]);
    expect(occupied.code).toBe('destination-exists');
    expect(h.holds).toEqual([]);
    expect(h.core.get(cPath)).toBe(occupant);

    await h.withPlan([
      h.stepOf({ from: bPath, to: dPath, fromRel: 'B.html', toRel: 'D.html' }),
      h.stepOf({ from: ghost, to: bPath, fromRel: 'ghost.html', toRel: 'B.html' }),
    ], async (plan) => {
      expect(plan.preview.prefixCounts).toEqual([0, 1, 1]);
      expect(plan.preview.steps).toHaveLength(2);
      expect(h.holds).toEqual([bPath]);
      expect(h.rekeys).toEqual([]);
      expect(h.core.get(cPath)).toBe(occupant);
    });
  });

  test('a final symlink with no source binding cannot move onto an occupied logical destination', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const link = path.join(h.root, 'link.html');
    fs.symlinkSync(content, link);
    const cPath = path.join(h.root, 'C.html');
    const c = h.open({ logicalPath: 'C.html', canonicalPath: cPath });

    const refused = await h.refuse([h.stepOf({
      from: link, to: cPath, fromRel: 'link.html', toRel: 'C.html',
      canonical: content, isSymlink: true,
    })]);

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('destination-exists');
    expect(h.holds).toEqual([]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.get(cPath)).toBe(c.room);
    expect(h.core.keys()).toEqual([cPath]);
    expect(path.resolve(fs.realpathSync(link))).toBe(content);
  });

  test('release is idempotent and frees every hold for the next transaction', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      expect(h.holds).toEqual([aPath, bPath]);
      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(2);
      expect(await h.authority.releaseStructure(plan, token)).toBe(false);
      expect(h.releases).toHaveLength(2);
      expect(Object.isFrozen(plan.preview.steps)).toBe(true);

      const next = h.authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [h.stepOf({ from: aPath, to: cPath, fromRel: 'A.html', toRel: 'C.html' })],
      });
      expect(h.holds).toEqual([aPath, bPath, aPath]);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.core.get(bPath)).toBe(b.room);
      expect(await h.authority.releaseStructure(next, token)).toBe(true);
      expect(h.releases).toHaveLength(3);
    });
  });

  test('the group took real holds and preparation never rekeyed a room', () => {
    expect(realHolds).toBeGreaterThan(0);
    expect(realRekeys).toBe(0);
  });
});

// D1 structure commit: one confirmed prefix per lifecycle, applied synchronously
// under the same exclusive structure token the physical work ran under. Every
// rekey counted here came from rooms.rekeyPersistent and every leave from the
// real rooms.leave.

const savedPage = (value, { epoch, seq, client, n }) =>
  `<!doctype html><html><body><script type="application/json" merge="count" clay="live" live-at="${stampOf(epoch, seq, serializeLive(value))}" live-by="${client}:${n}">${serializeLive(value)}</script></body></html>`;

// One frame applied to the room, then the save that landed it: the room keeps a
// persistent value and a receipt and stays clean enough to hold.
function applySaved(core, key, clientId, n) {
  const room = core.get(key);
  const applied = core.apply(room, clientId, {
    name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: n }],
  }, { connected: [clientId] });
  expect(applied.error).toBeUndefined();
  core.fileWritten(key, savedPage({ n }, { epoch: room.epoch, seq: room.seq, client: clientId, n: 1 }));
  return room;
}

describe('D1 structure commit', () => {
  test('committing one rename keeps A at A and moves B\u2019s room and record to C', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const location = { rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath };
    const claim = h.authority.captureAdmission(location);

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 1, 2]);
      fs.renameSync(bPath, cPath);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([cPath]);
      expect(h.core.keys()).toEqual([aPath, cPath]);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.core.get(bPath)).toBeNull();
      expect(h.core.get(cPath)).toBe(b.room);
      expect(h.core.get(cPath).epoch).toBe(b.room.epoch);
      expect(h.core.get(cPath).seq).toBe(b.room.seq);
      expect(h.core.get(cPath).nodeId).toBe(b.target.identity);
      expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
      expect(h.authority.identityAt(cPath)).toBe(b.target.identity);
      expect(h.authority.identityAt(bPath)).toBeNull();
      expect(h.authority.isRetired(location)).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'C.html', canonicalPath: cPath })).toBe(false);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'C.html', origin: 'http://127.0.0.1:7000' })).toBeNull();

      // The second hold was never used, and the caller's finally releases both.
      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(2);
      expect(await h.authority.releaseStructure(plan, token)).toBe(false);
      expect(h.releases).toHaveLength(2);
    });

    const rejected = await validate(h.authority, claim, location).catch((err) => err);
    expect(rejected.name).toBe('LocalAuthorityError');
    expect(rejected.code).toBe('moved');
    expect(rejected.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(fs.existsSync(bPath)).toBe(false);
    expect(fs.existsSync(cPath)).toBe(true);
  });

  test('committing both renames preserves both rooms and the old B claim', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    expect(applySaved(h.core, bPath, 'cB', 7)).toBe(b.room);
    const store = b.room.stores.get('count');
    const receipt = b.room.lastN.get('count\ncB');
    const state = h.core.state(b.room, 'cB');
    const location = { rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath };
    const claim = h.authority.captureAdmission(location);

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      fs.renameSync(bPath, cPath);
      fs.renameSync(aPath, bPath);
      expect(h.authority.commitStructure(plan, 2, token)).toBe(2);

      expect(h.rekeys).toEqual([cPath, bPath]);
      expect(h.core.keys()).toEqual([cPath, bPath]);
      expect(h.core.get(cPath)).toBe(b.room);
      expect(h.core.get(bPath)).toBe(a.room);
      expect(h.core.get(cPath).epoch).toBe(b.room.epoch);
      expect(h.core.get(cPath).seq).toBe(b.room.seq);
      expect(h.core.get(cPath).stores.get('count')).toBe(store);
      expect(h.core.get(cPath).stores.get('count').value).toEqual({ n: 7 });
      expect(h.core.get(cPath).lastN.get('count\ncB')).toBe(receipt);
      expect(h.core.state(h.core.get(cPath), 'cB')).toEqual(state);
      expect(h.core.get(bPath).epoch).toBe(a.room.epoch);
      expect(h.core.get(bPath).seq).toBe(a.room.seq);
      expect(h.core.get(bPath).nodeId).toBe(a.target.identity);
      expect(h.authority.identityAt(cPath)).toBe(b.target.identity);
      expect(h.authority.identityAt(bPath)).toBe(a.target.identity);
      expect(h.authority.identityAt(aPath)).toBeNull();
      expect(h.authority.isRetired(location)).toBe(false);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'A.html', canonicalPath: aPath })).toBe(true);
    });

    expect((await validate(h.authority, claim, location).catch((err) => err)).code).toBe('moved');
  });

  test('an old claim for B fails after B moves away and back', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const location = { rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath };
    const claim = h.authority.captureAdmission(location);

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      fs.renameSync(bPath, cPath);
      fs.renameSync(aPath, bPath);
      h.authority.commitStructure(plan, 2, token);
      expect(h.core.get(bPath)).toBe(a.room);
      expect(h.core.get(cPath)).toBe(b.room);
    });

    expect((await validate(h.authority, claim, location).catch((err) => err)).code).toBe('moved');

    await h.withPlan([
      h.stepOf({ from: bPath, to: aPath, fromRel: 'B.html', toRel: 'A.html' }),
      h.stepOf({ from: cPath, to: bPath, fromRel: 'C.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      fs.renameSync(bPath, aPath);
      fs.renameSync(cPath, bPath);
      h.authority.commitStructure(plan, 2, token);

      expect(h.rekeys.slice(2)).toEqual([aPath, bPath]);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.core.get(bPath)).toBe(b.room);
      expect(h.core.get(bPath).nodeId).toBe(b.target.identity);
      expect(h.authority.identityAt(bPath)).toBe(b.target.identity);
    });

    expect(h.authority.isRetired(location)).toBe(false);
    expect((await validate(h.authority, claim, location).catch((err) => err)).code).toBe('moved');
    const fresh = h.authority.captureAdmission(location);
    expect(fresh.identity).toBe(b.target.identity);
    await expect(validate(h.authority, fresh, location)).resolves.toBe(true);
  });

  test('a zero completion commits nothing and releases every unused hold', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const keysBefore = h.core.keys();
    const location = { rootId: 'root-a', logicalPath: 'A.html', canonicalPath: aPath };
    const claim = h.authority.captureAdmission(location);

    await h.withPlan([
      h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' }),
      h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' }),
    ], async (plan, token) => {
      expect(h.authority.commitStructure(plan, 0, token)).toBe(0);

      expect(h.core.keys()).toEqual(keysBefore);
      expect(h.core.get(aPath)).toBe(a.room);
      expect(h.core.get(bPath)).toBe(b.room);
      expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
      expect(h.authority.identityAt(bPath)).toBe(b.target.identity);
      expect(h.authority.isRetired(location)).toBe(false);
      expect(h.rekeys).toEqual([]);
      expect(h.releases).toEqual([]);
      expect(h.leaves).toEqual([]);
      expect(h.holds).toEqual([aPath, bPath]);

      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(2);
    });

    await expect(validate(h.authority, claim, location)).resolves.toBe(true);
  });

  test('a trash step drops its room and record and frees the key for the next step', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const location = { rootId: 'root-a', logicalPath: 'A.html', canonicalPath: aPath };
    const claim = h.authority.captureAdmission(location);

    await h.withPlan([
      h.stepOf({ from: aPath, to: null, fromRel: 'A.html', toRel: null }),
      h.stepOf({ from: bPath, to: aPath, fromRel: 'B.html', toRel: 'A.html' }),
    ], async (plan, token) => {
      fs.unlinkSync(aPath);
      fs.renameSync(bPath, aPath);
      expect(h.authority.commitStructure(plan, 2, token)).toBe(2);

      // The trash hold released inside the commit, so step two rekeyed into its key.
      expect(h.releases).toHaveLength(1);
      expect(h.rekeys).toEqual([aPath]);
      expect(h.core.keys()).toEqual([aPath]);
      expect(h.core.get(aPath)).toBe(b.room);
      expect(h.core.get(aPath).nodeId).toBe(b.target.identity);
      expect(h.core.get(aPath).epoch).toBe(b.room.epoch);
      expect(h.authority.identityAt(aPath)).toBe(b.target.identity);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath })).toBe(true);
      expect(h.authority.isRetired(location)).toBe(false);

      expect(await h.authority.releaseStructure(plan, token)).toBe(true);
      expect(h.releases).toHaveLength(2);
    });

    expect((await validate(h.authority, claim, location).catch((err) => err)).code).toBe('moved');
    expect(fs.existsSync(bPath)).toBe(false);
    expect(fs.existsSync(aPath)).toBe(true);
    expect(h.authority.identityAt(aPath)).toBe(b.target.identity);
  });

  test('a directory step rekeys both descendants, retires the unopened one and keeps a sibling', async () => {
    const h = structureHarness();
    const dir = path.join(h.root, 'dir');
    const moved = path.join(h.root, 'dir2');
    const one = path.join(dir, 'one.html');
    const two = path.join(dir, 'two.html');
    const unopened = path.join(dir, 'unopened.html');
    const sibling = path.join(h.root, 'sibling.html');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(one, page({ n: 0 }));
    fs.writeFileSync(two, page({ n: 0 }));
    fs.writeFileSync(unopened, page({ n: 0 }));
    fs.writeFileSync(sibling, page({ n: 0 }));
    const a = h.open({ logicalPath: 'dir/one.html', canonicalPath: one });
    const b = h.open({ logicalPath: 'dir/two.html', canonicalPath: two });
    const s = h.open({ logicalPath: 'sibling.html', canonicalPath: sibling });
    const siblingLocation = { rootId: 'root-a', logicalPath: 'sibling.html', canonicalPath: sibling };
    const siblingClaim = h.authority.captureAdmission(siblingLocation);

    await h.withPlan([
      h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'dir2', isDir: true }),
    ], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 2]);
      expect(h.holds).toEqual([one, two]);
      fs.renameSync(dir, moved);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([path.join(moved, 'one.html'), path.join(moved, 'two.html')]);
      expect(h.core.get(path.join(moved, 'one.html'))).toBe(a.room);
      expect(h.core.get(path.join(moved, 'two.html'))).toBe(b.room);
      expect(h.core.get(path.join(moved, 'one.html')).epoch).toBe(a.room.epoch);
      expect(h.core.get(sibling)).toBe(s.room);
      expect(h.core.get(one)).toBeNull();
      expect(h.authority.identityAt(path.join(moved, 'one.html'))).toBe(a.target.identity);
      expect(h.authority.identityAt(path.join(moved, 'two.html'))).toBe(b.target.identity);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir/one.html', canonicalPath: one })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir/unopened.html', canonicalPath: unopened })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir2/one.html', canonicalPath: path.join(moved, 'one.html') })).toBe(false);
      expect(h.authority.isRetired(siblingLocation)).toBe(false);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'dir2/one.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
    });

    await expect(validate(h.authority, siblingClaim, siblingLocation)).resolves.toBe(true);
    expect(fs.existsSync(path.join(moved, 'unopened.html'))).toBe(true);
  });

  test('an unbound physical source retires its old logical path after the rename', async () => {
    const h = structureHarness();
    const oldPath = path.join(h.root, 'old.html');
    const newPath = path.join(h.root, 'new.html');
    fs.writeFileSync(oldPath, page({ n: 0 }));

    await h.withPlan([h.stepOf({ from: oldPath, to: newPath, fromRel: 'old.html', toRel: 'new.html' })], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 0]);
      fs.renameSync(oldPath, newPath);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'old.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'new.html' })).toBe(false);
      expect(h.authority.isRetired({ canonicalPath: oldPath })).toBe(true);
      expect(h.rekeys).toEqual([]);
    });
  });

  test('a directory move detaches its symlink route without moving the external room', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const dir = path.join(h.root, 'dir');
    const moved = path.join(h.root, 'moved');
    fs.mkdirSync(dir);
    fs.symlinkSync(content, path.join(dir, 'link.html'));
    const alias = h.open({ logicalPath: 'dir/link.html', canonicalPath: content });
    const oldMember = h.authority.registerEditor(alias.target, { clientId: 'old', send: jest.fn() });
    h.authority.registerRoot({ id: 'root-b', canonicalPath: external, path: external }, { owner: 'server' });
    const other = h.authority.bindTarget({
      rootId: 'root-b', logicalPath: 'doc.html', canonicalPath: content, origin: 'http://127.0.0.1:7001', live: false,
    });
    const otherMember = h.authority.registerEditor(other, { clientId: 'other', send: jest.fn() });

    await h.withPlan([h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'moved', isDir: true })], async (plan, token) => {
      expect(h.holds).toEqual([content]);
      fs.renameSync(dir, moved);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);
      expect(h.core.get(content)).toBe(alias.room);
      expect(h.rekeys).toEqual([]);
      expect(h.authority.connectedIds(content)).toEqual(['other']);
      expect(h.authority.currentEditor(alias.target, 'old', oldMember.conn)).toBeNull();
      expect(h.authority.currentEditor(other, 'other', otherMember.conn)).toBe(otherMember);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir/link.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'doc.html', canonicalPath: content })).toBe(false);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'dir/link.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
    });
  });

  test('moving a final symlink changes only its root logical route', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const link = path.join(h.root, 'link.html');
    fs.symlinkSync(content, link);
    const renamed = path.join(h.root, 'renamed.html');
    const alias = h.open({ logicalPath: 'link.html', canonicalPath: content });
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const other = h.authority.bindTarget({
      rootId: 'root-b', logicalPath: 'other.html', canonicalPath: content, origin: 'http://127.0.0.1:7001', live: false,
    });
    const send = jest.fn();
    const member = h.authority.registerEditor(other, { clientId: 'cB', send });

    await h.withPlan([h.stepOf({
      from: link, to: renamed, fromRel: 'link.html', toRel: 'renamed.html', canonical: content, isSymlink: true,
    })], async (plan, token) => {
      fs.renameSync(link, renamed);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([]);
      expect(h.leaves).toEqual([]);
      expect(h.core.keys()).toEqual([content]);
      expect(h.core.get(content)).toBe(alias.room);
      expect(h.core.get(content).nodeId).toBe(alias.target.identity);
      expect(h.core.get(renamed)).toBeNull();
      expect(h.authority.identityAt(content)).toBe(alias.target.identity);
      expect(h.authority.connectedIds(content)).toEqual(['cB']);
      expect(h.authority.currentEditor(other, 'cB', member.conn)).toBe(member);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'link.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'renamed.html' })).toBe(false);
      expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'other.html', canonicalPath: content })).toBe(false);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'link.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'renamed.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: 'other.html', origin: 'http://127.0.0.1:7001' })).toBe(other);
    });

    expect(path.resolve(fs.realpathSync(renamed))).toBe(content);
    expect(fs.existsSync(link)).toBe(false);
    member.close();
    expect(h.leaves).toHaveLength(1);
  });

  test('a relative symlink whose post-move canonical target differs keeps the old target', async () => {
    const h = structureHarness();
    const one = path.join(h.root, 'one');
    const two = path.join(h.root, 'two');
    fs.mkdirSync(one);
    fs.mkdirSync(two);
    const content = path.join(one, 'doc.html');
    const movedContent = path.join(two, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    fs.writeFileSync(movedContent, page({ n: 0 }));
    const link = path.join(one, 'link.html');
    fs.symlinkSync('doc.html', link);
    const renamed = path.join(two, 'link.html');
    const alias = h.open({ logicalPath: 'one/link.html', canonicalPath: content });

    await h.withPlan([h.stepOf({
      from: link, to: renamed, fromRel: 'one/link.html', toRel: 'two/link.html',
      canonical: content, toCanonical: movedContent, isSymlink: true,
    })], async (plan, token) => {
      fs.renameSync(link, renamed);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([]);
      expect(h.core.keys()).toEqual([content]);
      expect(h.core.get(content)).toBe(alias.room);
      expect(h.core.get(movedContent)).toBeNull();
      expect(h.authority.identityAt(content)).toBe(alias.target.identity);
      expect(h.authority.identityAt(movedContent)).toBeNull();
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'one/link.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'two/link.html' })).toBe(false);
    });

    expect(path.resolve(fs.realpathSync(renamed))).toBe(movedContent);
  });

  test('a member closed late after its key gained another occupant never leaves the new room', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const send = jest.fn();
    const member = h.authority.registerEditor(a.target, { clientId: 'cA', send });

    await h.withPlan([h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' })], async (plan, token) => {
      fs.renameSync(bPath, cPath);
      h.authority.commitStructure(plan, 1, token);

      h.core.drop(aPath);
      const fresh = h.core.open(aPath, page({ n: 0 }), { nodeId: 'other-node' });
      expect(fresh).not.toBe(a.room);
      const applied = h.core.apply(fresh, 'cA', {
        name: 'count', n: 1, epoch: fresh.epoch, ops: [{ op: 'set', path: ['n'], value: 9 }],
      }, { connected: ['cA'] });
      expect(applied.error).toBeUndefined();
      expect(fresh.writer).toBe('cA');

      member.close();

      expect(h.leaves).toEqual([]);
      expect(h.core.get(aPath)).toBe(fresh);
      expect(fresh.writer).toBe('cA');
      expect(fresh.emptySince).toBeNull();
      expect(fresh.stores.get('count').value).toEqual({ n: 9 });
      expect(send).not.toHaveBeenCalled();
      expect(h.authority.connectedIds(aPath)).toEqual([]);
    });
  });

  test('a copied step clears the confirmed stamp while a rename keeps it', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const html = page({ n: 3 });
    fs.writeFileSync(aPath, html);
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath, html });

    await withDocumentWrite(async () => a.target, async (target, token) => {
      await fs.promises.writeFile(target.canonicalPath, html);
      return h.authority.confirmKnownWrite(target, html, token);
    });
    expect(h.authority.confirmedStamp(aPath)).toBeTruthy();

    await h.withPlan([h.stepOf({ from: aPath, to: bPath, fromRel: 'A.html', toRel: 'B.html' })], async (plan, token) => {
      fs.renameSync(aPath, bPath);
      expect(h.authority.commitStructure(plan, 1, token, { copiedSteps: [0] })).toBe(1);

      expect(h.rekeys).toEqual([bPath]);
      expect(h.core.get(bPath)).toBe(a.room);
      expect(h.core.get(bPath).nodeId).toBe(a.target.identity);
      expect(h.authority.identityAt(bPath)).toBe(a.target.identity);
      expect(h.authority.confirmedStamp(bPath)).toBeNull();
    });

    const rebind = h.authority.bindTarget({
      rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath, origin: 'http://127.0.0.1:7000', live: false,
    });
    expect(rebind.identity).toBe(a.target.identity);
    await withDocumentWrite(async () => rebind, async (target, token) => {
      await fs.promises.writeFile(target.canonicalPath, html);
      return h.authority.confirmKnownWrite(target, html, token);
    });
    expect(h.authority.confirmedStamp(bPath)).toBeTruthy();

    await h.withPlan([h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' })], async (plan, token) => {
      fs.renameSync(bPath, cPath);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys.slice(1)).toEqual([cPath]);
      expect(h.core.get(cPath)).toBe(a.room);
      expect(h.authority.identityAt(cPath)).toBe(a.target.identity);
      expect(h.authority.confirmedStamp(cPath)).toBeTruthy();
    });
  });

  test('a wrong token, a double commit, an invalid count and a released plan refuse', async () => {
    const h = structureHarness();
    const aPath = path.join(h.root, 'A.html');
    const bPath = path.join(h.root, 'B.html');
    const cPath = path.join(h.root, 'C.html');
    const ghost = path.join(h.root, 'ghost.html');
    const a = h.open({ logicalPath: 'A.html', canonicalPath: aPath });
    const b = h.open({ logicalPath: 'B.html', canonicalPath: bPath });
    const aLocation = { rootId: 'root-a', logicalPath: 'A.html', canonicalPath: aPath };

    const refuse = (fn) => {
      try {
        fn();
        return null;
      } catch (err) {
        return err;
      }
    };

    // A plan is usable only under the structure token that prepared it.
    const foreign = await withStructureChange((token) => h.authority.prepareStructure(token, {
      rootId: 'root-a',
      steps: [h.stepOf({ from: aPath, to: ghost, fromRel: 'A.html', toRel: 'ghost.html' })],
    }));
    expect(h.holds).toEqual([aPath]);

    const wrongToken = await withStructureChange((token) => refuse(() => h.authority.commitStructure(foreign, 1, token)));
    expect(wrongToken.name).toBe('LocalAuthorityError');
    expect(wrongToken.code).toBe('invalid-reservation');
    expect(wrongToken.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(h.core.get(aPath)).toBe(a.room);
    expect(h.authority.identityAt(aPath)).toBe(a.target.identity);
    expect(h.rekeys).toEqual([]);
    expect(h.leaves).toEqual([]);
    expect(() => h.rooms.holdPersistent(aPath, { nodeId: a.target.identity, requireClean: true }))
      .toThrow('checkpointing');

    await withStructureChange((token) => {
      const plan = h.authority.prepareStructure(token, {
        rootId: 'root-a',
        steps: [h.stepOf({ from: bPath, to: cPath, fromRel: 'B.html', toRel: 'C.html' })],
      });
      expect(h.holds).toEqual([aPath, bPath]);
      const unchanged = () => {
        expect(h.core.get(bPath)).toBe(b.room);
        expect(h.authority.identityAt(bPath)).toBe(b.target.identity);
        expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'B.html', canonicalPath: bPath })).toBe(false);
        expect(h.rekeys).toEqual([]);
        expect(h.leaves).toEqual([]);
      };

      const unknown = refuse(() => h.authority.commitStructure({}, 0, token));
      expect(unknown.code).toBe('invalid-reservation');
      unchanged();

      expect(() => h.authority.commitStructure(plan, 1, null)).toThrow('Structure boundary ownership required');
      unchanged();

      for (const completed of [0.5, -1, 2, '1', null, undefined]) {
        const refused = refuse(() => h.authority.commitStructure(plan, completed, token));
        expect(refused.code).toBe('invalid-reservation');
      }
      for (const copied of [[0, 0], ['0'], [-1], [0.5], [1], null]) {
        const refused = refuse(() => h.authority.commitStructure(plan, 1, token, { copiedSteps: copied }));
        expect(refused.code).toBe('invalid-reservation');
      }
      unchanged();

      expect(h.authority.commitStructure(plan, 0, token)).toBe(0);
      unchanged();

      const twice = refuse(() => h.authority.commitStructure(plan, 0, token));
      expect(twice.code).toBe('invalid-reservation');

      expect(h.authority.releaseStructure(plan, token)).toBe(true);
      const released = refuse(() => h.authority.commitStructure(plan, 0, token));
      expect(released.code).toBe('invalid-reservation');
      unchanged();
    });

    expect(h.core.get(aPath)).toBe(a.room);
    expect(h.core.keys()).toEqual([aPath, bPath]);
    expect(h.authority.isRetired(aLocation)).toBe(false);
    expect(h.releases).toHaveLength(1);
  });

  test('the commit group rekeyed real rooms', () => {
    expect(realRekeys).toBeGreaterThan(0);
  });
});

// D1 alias routes: registered roots that expose the same physical folder, plus
// an unrelated root. A move in one root must hold, detach and retire every other
// root's old route entry, while a route that does not move stays bound and the
// external room itself keeps its key, object, epoch and identity.

describe('D1 alias routes', () => {
  const aliasRoom = (h, { rootId, logicalPath, canonicalPath, origin }) => {
    const target = h.authority.bindTarget({ rootId, logicalPath, canonicalPath, origin, live: false });
    return { target, room: h.core.open(canonicalPath, page({ n: 0 }), { nodeId: target.identity }) };
  };
  const join = (h, target, clientId) => h.authority.registerEditor(target, { clientId, send: jest.fn() });

  test('a directory move holds one external room once and retires the entry in every alias root', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const dir = path.join(h.root, 'dir');
    const moved = path.join(h.root, 'moved');
    fs.mkdirSync(dir);
    fs.symlinkSync(content, path.join(dir, 'link.html'));
    const third = tempRoot();
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    h.authority.registerRoot({ id: 'root-c', canonicalPath: third, path: third }, { owner: 'server' });

    const a = aliasRoom(h, { rootId: 'root-a', logicalPath: 'dir/link.html', canonicalPath: content, origin: 'http://127.0.0.1:7000' });
    const b = aliasRoom(h, { rootId: 'root-b', logicalPath: 'dir/link.html', canonicalPath: content, origin: 'http://127.0.0.1:7001' });
    const c = aliasRoom(h, { rootId: 'root-c', logicalPath: 'other.html', canonicalPath: content, origin: 'http://127.0.0.1:7002' });
    const memberA = join(h, a.target, 'cA');
    const memberB = join(h, b.target, 'cB');
    const memberC = join(h, c.target, 'cC');
    const room = h.core.get(content);
    const epoch = room.epoch;
    const keysBefore = h.core.keys();
    const locationB = { rootId: 'root-b', logicalPath: 'dir/link.html', canonicalPath: content };
    const claimB = h.authority.captureAdmission(locationB);
    const holdsBefore = realHolds;

    await h.withPlan([
      h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'moved', isDir: true }),
    ], async (plan, token) => {
      expect(h.holds).toEqual([content]);
      expect(realHolds - holdsBefore).toBe(1);
      fs.renameSync(dir, moved);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([]);
      expect(h.core.keys()).toEqual(keysBefore);
      expect(h.core.get(content)).toBe(room);
      expect(h.core.get(content).epoch).toBe(epoch);
      expect(h.core.get(content).nodeId).toBe(a.target.identity);
      expect(h.authority.connectedIds(content)).toEqual(['cC']);
      expect(h.authority.currentEditor(a.target, 'cA', memberA.conn)).toBeNull();
      expect(h.authority.currentEditor(b.target, 'cB', memberB.conn)).toBeNull();
      expect(h.authority.currentEditor(c.target, 'cC', memberC.conn)).toBe(memberC);
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir/link.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'dir/link.html' })).toBe(true);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'dir/link.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: 'dir/link.html', origin: 'http://127.0.0.1:7001' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-c', logicalPath: 'other.html', origin: 'http://127.0.0.1:7002' })).toBe(c.target);
      expect(h.authority.isRetired({ rootId: 'root-c', logicalPath: 'other.html' })).toBe(false);

      for (const rootId of ['root-a', 'root-b']) {
        expect(h.authority.isRetired({ rootId, logicalPath: 'moved/link.html' })).toBe(false);
        expect(h.authority.captureAdmission({ rootId, logicalPath: 'moved/link.html' }).logicalRevision)
          .toBeGreaterThan(claimB.logicalRevision);
      }
    });

    expect(fs.existsSync(dir)).toBe(false);
    expect(path.resolve(fs.realpathSync(path.join(moved, 'link.html')))).toBe(content);
    const rejected = await validate(h.authority, claimB, locationB).catch((err) => err);
    expect(rejected.name).toBe('LocalAuthorityError');
    expect(rejected.code).toBe('moved');
    expect(rejected.message).not.toMatch(/network|unauthorized|expired|api key/i);
  });

  test('an occupied logical destination in an alias root refuses before any hold', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const free = path.join(h.root, 'free.html');
    const occupied = path.join(h.root, 'occupied.html');
    fs.writeFileSync(free, page({ n: 0 }));
    const b = aliasRoom(h, { rootId: 'root-b', logicalPath: 'occupied.html', canonicalPath: content, origin: 'http://127.0.0.1:7001' });
    join(h, b.target, 'cB');

    const refused = await h.refuse([
      h.stepOf({ from: free, to: occupied, fromRel: 'free.html', toRel: 'occupied.html' }),
    ]);

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('destination-exists');
    expect(refused.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(h.holds).toEqual([]);
    expect(h.rekeys).toEqual([]);
    expect(h.core.get(content)).toBe(b.room);
    expect(h.authority.connectedIds(content)).toEqual(['cB']);
    expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: 'occupied.html', origin: 'http://127.0.0.1:7001' })).toBe(b.target);
    expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'occupied.html' })).toBe(false);
    expect(fs.existsSync(free)).toBe(true);
    expect(fs.existsSync(occupied)).toBe(false);
  });

  test('a dirty external room refuses for an alias root and leaves disk and every binding untouched', async () => {
    const h = structureHarness();
    const external = path.join(fs.realpathSync.native(os.tmpdir()), `zz-d1d-peer-${process.pid}`);
    fs.mkdirSync(external, { recursive: true });
    dirs.push(external);
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const dir = path.join(h.root, 'dir');
    const moved = path.join(h.root, 'moved');
    const one = path.join(dir, 'one.html');
    fs.mkdirSync(dir);
    fs.writeFileSync(one, page({ n: 0 }));
    fs.symlinkSync(content, path.join(dir, 'link.html'));
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const o = h.open({ logicalPath: 'dir/one.html', canonicalPath: one });
    const b = aliasRoom(h, { rootId: 'root-b', logicalPath: 'dir/link.html', canonicalPath: content, origin: 'http://127.0.0.1:7001' });
    join(h, b.target, 'cB');
    const room = h.core.get(content);
    const applied = h.core.apply(room, 'cB', {
      name: 'count', n: 1, epoch: room.epoch, ops: [{ op: 'set', path: ['n'], value: 5 }],
    }, { connected: ['cB'] });
    expect(applied.error).toBeUndefined();
    const store = room.stores.get('count');
    expect(store.landed).not.toBe(store.last);
    const keysBefore = h.core.keys();

    const refused = await h.refuse([
      h.stepOf({ from: dir, to: moved, fromRel: 'dir', toRel: 'moved', isDir: true }),
    ]);

    expect(refused.name).toBe('LocalAuthorityError');
    expect(refused.code).toBe('peers-editing');
    expect(refused.message).not.toMatch(/network|unauthorized|expired|api key/i);
    expect(h.holds).toEqual([one]);
    expect(h.releases).toHaveLength(1);
    expect(h.rekeys).toEqual([]);
    expect(h.core.keys()).toEqual(keysBefore);
    expect(h.core.get(content)).toBe(room);
    expect(h.core.get(one)).toBe(o.room);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(moved)).toBe(false);
    expect(path.resolve(fs.realpathSync(path.join(dir, 'link.html')))).toBe(content);
    expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: 'dir/link.html', origin: 'http://127.0.0.1:7001' })).toBe(b.target);
    expect(h.authority.connectedIds(content)).toEqual(['cB']);
    expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'dir/link.html' })).toBe(false);
    expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'dir/link.html' })).toBe(false);

    const freed = h.rooms.holdPersistent(one, { nodeId: o.target.identity, requireClean: true });
    h.core.releasePersistent(freed);
    const dirtyProbe = h.rooms.holdPersistent(content, { nodeId: room.nodeId });
    h.core.releasePersistent(dirtyProbe);
  });

  test('a final symlink step holds one room once for both alias roots and rekeys nothing', async () => {
    const h = structureHarness();
    const external = tempRoot();
    const content = path.join(external, 'doc.html');
    fs.writeFileSync(content, page({ n: 0 }));
    const link = path.join(h.root, 'link.html');
    fs.symlinkSync(content, link);
    const renamed = path.join(h.root, 'renamed.html');
    h.authority.registerRoot({ id: 'root-b', canonicalPath: h.root, path: h.root }, { owner: 'server' });
    const a = aliasRoom(h, { rootId: 'root-a', logicalPath: 'link.html', canonicalPath: content, origin: 'http://127.0.0.1:7000' });
    const b = aliasRoom(h, { rootId: 'root-b', logicalPath: 'link.html', canonicalPath: content, origin: 'http://127.0.0.1:7001' });
    const memberA = join(h, a.target, 'cA');
    const memberB = join(h, b.target, 'cB');
    const room = h.core.get(content);
    const epoch = room.epoch;
    const keysBefore = h.core.keys();
    const locationB = { rootId: 'root-b', logicalPath: 'link.html', canonicalPath: content };
    const claimB = h.authority.captureAdmission(locationB);
    const holdsBefore = realHolds;

    await h.withPlan([h.stepOf({
      from: link, to: renamed, fromRel: 'link.html', toRel: 'renamed.html', canonical: content, isSymlink: true,
    })], async (plan, token) => {
      expect(plan.preview.prefixCounts).toEqual([0, 0]);
      expect(h.holds).toEqual([content]);
      expect(realHolds - holdsBefore).toBe(1);
      fs.renameSync(link, renamed);
      expect(h.authority.commitStructure(plan, 1, token)).toBe(1);

      expect(h.rekeys).toEqual([]);
      expect(h.core.keys()).toEqual(keysBefore);
      expect(h.core.get(content)).toBe(room);
      expect(h.core.get(content).epoch).toBe(epoch);
      expect(h.core.get(content).nodeId).toBe(a.target.identity);
      expect(h.core.get(renamed)).toBeNull();
      expect(h.authority.connectedIds(content)).toEqual([]);
      expect(h.authority.currentEditor(a.target, 'cA', memberA.conn)).toBeNull();
      expect(h.authority.currentEditor(b.target, 'cB', memberB.conn)).toBeNull();
      expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: 'link.html' })).toBe(true);
      expect(h.authority.isRetired({ rootId: 'root-b', logicalPath: 'link.html' })).toBe(true);
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'link.html', origin: 'http://127.0.0.1:7000' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-b', logicalPath: 'link.html', origin: 'http://127.0.0.1:7001' })).toBeNull();
      for (const rootId of ['root-a', 'root-b']) {
        expect(h.authority.isRetired({ rootId, logicalPath: 'renamed.html' })).toBe(false);
        expect(h.authority.captureAdmission({ rootId, logicalPath: 'renamed.html' }).logicalRevision)
          .toBeGreaterThan(claimB.logicalRevision);
      }
    });

    expect(fs.existsSync(link)).toBe(false);
    expect(path.resolve(fs.realpathSync(renamed))).toBe(content);
    const rejected = await validate(h.authority, claimB, locationB).catch((err) => err);
    expect(rejected.code).toBe('moved');
  });
});

// D2a staged admission: a writer claims a location before queueing, then stages a
// write target inside the real document boundary. Nothing is allocated until the
// stat after the write confirms, and only an explicit create may clear a
// retirement, at that same confirmation. The staged target is a proof of the one
// boundary that admitted it: a later document gate cannot confirm it.

describe('D2a staged admission', () => {
  function stagedHarness() {
    let ids = 0;
    const root = tempRoot();
    const authority = createLocalAuthority({
      withDocument: (resolveTarget, fn) => withDocumentWrite(resolveTarget, fn),
      readSaved: async () => page({ n: 0 }),
      now: () => 1000,
      newId: () => `id${++ids}`,
    });
    authority.registerRoot({ id: 'root-a', canonicalPath: root, path: root }, { owner: 'server' });
    return { authority, root, idCount: () => ids };
  }

  const stage = (authority, claim, location, options) => withDocumentWrite(
    async () => ({ canonicalPath: location.canonicalPath }),
    (target, token) => authority.admitWriteTarget(claim, location, token, options),
  );

  const withStage = (authority, claim, location, options, fn) => withDocumentWrite(
    async () => ({ canonicalPath: location.canonicalPath }),
    async (_locked, token) => {
      const target = authority.admitWriteTarget(claim, location, token, options);
      return fn(target, token);
    },
  );

  const writeAndConfirm = (authority, target, html, options) => withDocumentWrite(
    async () => ({ canonicalPath: target.canonicalPath }),
    async (resolved, token) => {
      await fs.promises.writeFile(target.canonicalPath, html);
      return authority.confirmKnownWrite(target, html, token, options);
    },
  );

  test('a staged target allocates nothing and one confirmed write installs it once', async () => {
    const h = stagedHarness();
    const canonical = path.join(h.root, 'doc.html');
    const origin = 'http://127.0.0.1:7000';
    const live = { broadcast: jest.fn() };
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical, origin, live };

    const claim = h.authority.captureAdmission(location);
    expect(claim.identity).toBeNull();

    const html = page({ n: 1 });
    const { staged, stamp } = await withStage(h.authority, claim, location, undefined, async (target, token) => {
      expect(Object.isFrozen(target)).toBe(true);
      expect(target.identity).toBe('id1');
      expect(h.idCount()).toBe(1);
      expect(h.authority.identityAt(canonical)).toBeNull();
      expect(h.authority.identityAt(canonical, { rootId: 'root-a', logicalPath: '/doc.html' })).toBeNull();
      expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin })).toBeNull();
      expect(h.authority.confirmedStamp(canonical)).toBeNull();
      expect(live.broadcast).not.toHaveBeenCalled();

      await fs.promises.writeFile(canonical, html);
      return { staged: target, stamp: await h.authority.confirmKnownWrite(target, html, token) };
    });

    expect(stamp.identity).toBe('id1');
    expect(stamp.etag).toBe(documentEtag(html));
    expect(h.authority.identityAt(canonical)).toBe('id1');
    expect(h.authority.confirmedStamp(canonical)).toBe(stamp);
    expect(h.idCount()).toBe(1);
    expect(live.broadcast).toHaveBeenCalledTimes(1);
    expect(live.broadcast).toHaveBeenCalledWith('/doc.html', { html, sender: 'server-save' }, { lane: 'saved' });

    const again = page({ n: 2 });
    const second = await writeAndConfirm(h.authority, staged, again);

    expect(second.identity).toBe('id1');
    expect(h.authority.identityAt(canonical)).toBe('id1');
    expect(h.idCount()).toBe(1);
    expect(live.broadcast).toHaveBeenCalledTimes(2);

    const member = h.authority.registerEditor(staged, { clientId: 'cA', send: () => {} });
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/doc.html', origin })).toBe(staged);
    member.close();
  });

  test('a failed write or a stat failure leaves the staged identity and admission absent', async () => {
    const h = stagedHarness();
    const missing = path.join(h.root, 'missing', 'doc.html');
    const live = { broadcast: jest.fn() };
    const location = { rootId: 'root-a', logicalPath: '/missing/doc.html', canonicalPath: missing, origin: null, live };

    const claim = h.authority.captureAdmission(location);
    const html = page({ n: 1 });

    const nulled = await withStage(h.authority, claim, location, undefined, async (staged, token) => {
      expect(staged.identity).toBe('id1');

      await expect(fs.promises.writeFile(missing, html)).rejects.toMatchObject({ code: 'ENOENT' });

      expect(h.authority.identityAt(missing)).toBeNull();
      expect(h.authority.rooms.get(missing)).toBeNull();
      expect(h.authority.confirmedStamp(missing)).toBeNull();
      expect(h.authority.isRetired(location)).toBe(false);
      expect(h.authority.captureAdmission(location)).toEqual(claim);

      return h.authority.confirmKnownWrite(staged, html, token);
    });

    expect(nulled).toBeNull();
    expect(h.authority.identityAt(missing)).toBeNull();
    expect(h.authority.rooms.get(missing)).toBeNull();
    expect(h.authority.confirmedStamp(missing)).toBeNull();
    expect(h.authority.captureAdmission(location)).toEqual(claim);
    expect(h.idCount()).toBe(1);
    expect(live.broadcast).not.toHaveBeenCalled();
  });

  test('an ordinary staged write refuses a retired path and an explicit create clears it only on confirmation', async () => {
    const h = stagedHarness();
    const dir = path.join(h.root, 'sub');
    const canonical = path.join(dir, 'doc.html');
    const location = { rootId: 'root-a', logicalPath: '/sub/doc.html', canonicalPath: canonical, origin: null, live: false };

    const before = h.authority.captureAdmission(location);
    await retire(h.authority, { rootId: 'root-a', logicalPath: '/sub/doc.html', canonicalPath: canonical });

    expect(h.authority.isRetired(location)).toBe(true);
    await expect(stage(h.authority, before, location)).rejects.toMatchObject({ code: 'moved' });
    await expect(stage(h.authority, before, location, { explicitCreate: true })).rejects.toMatchObject({ code: 'moved' });
    expect(fs.existsSync(dir)).toBe(false);

    const fresh = h.authority.captureAdmission(location);
    await expect(stage(h.authority, fresh, location)).rejects.toMatchObject({ code: 'moved' });

    const html = page({ n: 1 });
    const stamp = await withStage(h.authority, fresh, location, { explicitCreate: true }, async (staged, token) => {
      expect(staged.identity).toBe('id1');
      expect(h.authority.isRetired(location)).toBe(true);
      expect(h.authority.identityAt(canonical)).toBeNull();
      expect(h.authority.captureAdmission(location)).toEqual(fresh);

      fs.mkdirSync(dir);
      await fs.promises.writeFile(canonical, html);
      return h.authority.confirmKnownWrite(staged, html, token);
    });

    expect(stamp.identity).toBe('id1');
    expect(h.authority.isRetired(location)).toBe(false);
    expect(h.authority.identityAt(canonical)).toBe('id1');
    const readmitted = h.authority.captureAdmission(location);
    expect(readmitted.canonicalRevision).toBeGreaterThan(fresh.canonicalRevision);
    await expect(validate(h.authority, readmitted, location)).resolves.toBe(true);
    await expect(validate(h.authority, fresh, location)).rejects.toMatchObject({ code: 'moved' });
  });

  test('a stale claim, a retire/readmit cycle and an old record all refuse explicit create', async () => {
    const h = stagedHarness();
    const canonical = path.join(h.root, 'doc.html');
    fs.writeFileSync(canonical, page({ n: 0 }));
    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: canonical, origin: null, live: false };
    const bound = h.authority.bindTarget(location);

    const claim = h.authority.captureAdmission(location);
    expect(claim.identity).toBe(bound.identity);

    await retire(h.authority, { canonicalPath: canonical });

    await expect(stage(h.authority, claim, location, { explicitCreate: true })).rejects.toMatchObject({ code: 'moved' });

    const retiredClaim = h.authority.captureAdmission(location);
    expect(retiredClaim.identity).toBe(bound.identity);
    expect(h.authority.identityAt(canonical)).toBeNull();
    await expect(stage(h.authority, retiredClaim, location, { explicitCreate: true })).rejects.toMatchObject({ code: 'moved' });

    await admit(h.authority, { canonicalPath: canonical });

    await expect(stage(h.authority, retiredClaim, location, { explicitCreate: true })).rejects.toMatchObject({ code: 'moved' });
    await expect(stage(h.authority, retiredClaim, location)).rejects.toMatchObject({ code: 'moved' });
    expect(h.authority.identityAt(canonical)).toBe(bound.identity);
    expect(h.idCount()).toBe(1);
  });

  test('a confirmed staged write evicts the same root/path binding of the file it left', async () => {
    const h = stagedHarness();
    const aPath = path.join(h.root, 'a.html');
    const bPath = path.join(h.root, 'b.html');
    fs.writeFileSync(aPath, page({ n: 0 }));
    fs.writeFileSync(bPath, page({ n: 0 }));
    const originA = 'http://127.0.0.1:7000';
    const leftLive = { broadcast: jest.fn() };
    const aliasLive = { broadcast: jest.fn() };
    const writerLive = { broadcast: jest.fn() };

    const left = h.authority.bindTarget({ rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: aPath, origin: originA, live: leftLive });
    const alias = h.authority.bindTarget({
      rootId: 'root-b', logicalPath: '/alias/doc.html', canonicalPath: aPath, origin: 'http://127.0.0.1:7001', live: aliasLive,
    });

    const location = { rootId: 'root-a', logicalPath: '/doc.html', canonicalPath: bPath, origin: originA, live: writerLive };
    const html = page({ n: 1 });
    const { staged, stamp } = await withStage(h.authority, h.authority.captureAdmission(location), location, undefined, async (target, token) => {
      expect(target.identity).not.toBe(left.identity);
      await fs.promises.writeFile(bPath, html);
      return { staged: target, stamp: await h.authority.confirmKnownWrite(target, html, token) };
    });

    expect(stamp.identity).toBe(staged.identity);
    expect(h.authority.identityAt(bPath)).toBe(staged.identity);
    expect(h.authority.identityAt(aPath)).toBe(left.identity);
    expect(writerLive.broadcast).toHaveBeenCalledTimes(1);
    expect(writerLive.broadcast).toHaveBeenCalledWith('/doc.html', { html, sender: 'server-save' }, { lane: 'saved' });

    const again = page({ n: 2 });
    await writeAndConfirm(h.authority, alias, again);

    expect(aliasLive.broadcast).toHaveBeenCalledTimes(1);
    expect(aliasLive.broadcast).toHaveBeenCalledWith('/alias/doc.html', { html: again, sender: 'server-save' }, { lane: 'saved' });
    expect(leftLive.broadcast).not.toHaveBeenCalled();
    expect(h.authority.identityAt(aPath)).toBe(left.identity);
  });

  test('a staged target that escaped its document boundary refuses confirmation under another token', async () => {
    const h = stagedHarness();
    const canonical = path.join(h.root, 'unbound.html');
    const before = page({ n: 0 });
    fs.writeFileSync(canonical, before);
    const origin = 'http://127.0.0.1:7000';
    const live = { broadcast: jest.fn() };
    const location = { rootId: 'root-a', logicalPath: '/unbound.html', canonicalPath: canonical, origin, live };

    const claim = h.authority.captureAdmission(location);
    expect(claim.identity).toBeNull();

    const escaped = [];
    const staged = await withStage(h.authority, claim, location, undefined, (target) => {
      escaped.push(target);
      return target;
    });

    expect(escaped).toHaveLength(1);
    expect(escaped[0]).toBe(staged);
    expect(staged.identity).toBe('id1');
    expect(h.idCount()).toBe(1);
    expect(fs.readFileSync(canonical, 'utf8')).toBe(before);

    const html = page({ n: 1 });
    await expect(withDocumentWrite(
      async () => ({ canonicalPath: canonical }),
      (_locked, token) => h.authority.confirmKnownWrite(staged, html, token),
    )).rejects.toMatchObject({
      code: 'invalid-reservation',
      message: 'staged write target belongs to another document boundary',
    });

    expect(h.authority.identityAt(canonical)).toBeNull();
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: '/unbound.html', origin })).toBeNull();
    expect(h.authority.confirmedStamp(canonical)).toBeNull();
    expect(h.authority.captureAdmission(location)).toEqual(claim);
    expect(h.authority.isRetired(location)).toBe(false);
    expect(h.authority.rooms.get(canonical)).toBeNull();
    expect(h.idCount()).toBe(1);
    expect(live.broadcast).not.toHaveBeenCalled();
    expect(fs.readFileSync(canonical, 'utf8')).toBe(before);
  });

  test('a confirmed explicit creation stays current after its active admission event', async () => {
    const h = stagedHarness();
    const dir = path.join(h.root, 'sub');
    const canonical = path.join(dir, 'doc.html');
    const origin = 'http://127.0.0.1:7000';
    const location = { rootId: 'root-a', logicalPath: 'sub/doc.html', canonicalPath: canonical, origin, live: false };

    await retire(h.authority, { rootId: 'root-a', logicalPath: 'sub/doc.html', canonicalPath: canonical });
    const claim = h.authority.captureAdmission(location);
    expect(claim.identity).toBeNull();

    const html = page({ n: 1 });
    const staged = await withStage(h.authority, claim, location, { explicitCreate: true }, async (target, token) => {
      fs.mkdirSync(dir);
      await fs.promises.writeFile(canonical, html);
      await h.authority.confirmKnownWrite(target, html, token);
      return target;
    });

    expect(h.authority.isRetired(location)).toBe(false);
    expect(h.authority.identityAt(canonical)).toBe(staged.identity);
    expect(h.authority.isCurrentTarget(staged)).toBe(true);

    const member = h.authority.registerEditor(staged, { clientId: 'cA', send: () => {} });
    expect(h.authority.currentEditor(staged, 'cA', member.conn)).toBe(member);
    expect(h.authority.newestEditor(staged, 'cA')).toBe(member);
    expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: 'sub/doc.html', origin })).toBe(staged);
    member.close();
  });
});
