// D2e1 live admission: a fresh live target binds inside the document boundary it
// claims, and a cold room read asks for an unbound candidate inside the boundary
// it already owns. Real files, the real document and structure gates and the real
// createApp, so what is asserted is the request a client sends and the state the
// authority is left in -- not a mock.

const fs = require('fs');
const os = require('os');
const path = require('upath');
const http = require('http');

const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { startLiveDataFixture } = require('../helpers/local-live-data');

const FILE = 'index.html';
const DOC = (count) => `<!doctype html>\n<html><body><script type="application/json" merge="store" clay="live">{"count":${count}}</script></body></html>\n`;
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function getState(origin, { documentUrl, headers = {} } = {}) {
  const url = new URL('/_/sync/data', origin);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: { 'Document-URL': documentUrl, ...SAME_ORIGIN, ...headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const dirs = [];
const fixtures = [];
const gates = [];

afterEach(async () => {
  for (const gate of gates.splice(0)) {
    gate.act();
    gate.release();
    await gate.done.catch(() => {});
  }
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

// A real served folder, the real document boundary, and a readSaved that reads
// the real file and counts what it read.
function setup() {
  const dir = path.resolve(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'live-admission-'))));
  dirs.push(dir);
  const canonical = path.join(dir, FILE);
  fs.writeFileSync(canonical, DOC(0));
  const reads = [];
  let ids = 0;
  const authority = createLocalAuthority({
    withDocument: withDocumentWrite,
    readSaved: async (target) => {
      reads.push(target.canonicalPath);
      return fs.promises.readFile(target.canonicalPath, 'utf8');
    },
    newId: () => `id${++ids}`,
  });
  return { dir, canonical, authority, reads, ids: () => ids };
}

const fixtureFor = async (authority, dir) => {
  const fixture = await startLiveDataFixture({ authority, rootDir: dir, rootId: 'fixture' });
  fixtures.push(fixture);
  return fixture;
};

// The authority with its read-only claim counted, so a fixture can tell that a
// queued request has reached the gate before asserting on what is not there.
const countClaims = (authority) => {
  const claims = [];
  const counting = Object.create(authority);
  counting.captureAdmission = (location) => {
    claims.push(location);
    return authority.captureAdmission(location);
  };
  return { authority: counting, claims };
};

// A synchronous refusal, returned rather than thrown, so a registration that
// throws can be asserted on like the awaited ones.
const refusalOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
};

// A held exclusive structure gate. `hook` runs inside the boundary after the test
// asks for it, so a retirement lands under the token that owns the gate.
const holdStructure = (hook) => {
  const entered = deferred();
  const act = deferred();
  const applied = deferred();
  const finish = deferred();
  const gate = {
    token: null,
    ready: entered.promise,
    applied: applied.promise,
    act: () => act.resolve(),
    release: () => finish.resolve(),
  };
  if (!hook) applied.resolve();
  gate.done = withStructureChange(async (token) => {
    gate.token = token;
    entered.resolve();
    if (hook) {
      await act.promise;
      hook(token);
      applied.resolve();
    }
    await finish.promise;
  });
  gates.push(gate);
  return gate;
};

test('a fresh live GET binds only after the structure gate releases, then cold reads', async () => {
  const h = setup();
  const { authority, claims } = countClaims(h.authority);
  const fixture = await fixtureFor(authority, h.dir);
  const gate = holdStructure();
  await gate.ready;

  const pending = getState(fixture.origin, { documentUrl: `${fixture.origin}/${FILE}` });
  pending.catch(() => {});
  await waitFor(() => claims.length >= 1, 'the live request to capture its claim');

  expect(authority.identityAt(h.canonical)).toBeNull();
  expect(authority.rooms.get(h.canonical)).toBeNull();
  expect(h.reads).toEqual([]);
  expect(h.ids()).toBe(0);

  gate.release();
  await gate.done;
  const res = await pending;

  expect(res.status).toBe(200);
  expect(res.json.stores.store.value).toEqual({ count: 0 });
  expect(h.reads).toEqual([h.canonical]);
  const room = authority.rooms.get(h.canonical);
  expect(room).not.toBeNull();
  expect(room.nodeId).toBe(authority.identityAt(h.canonical));
});

test('a queued live GET retired while it waits gets the live refusal and leaves nothing', async () => {
  const h = setup();
  const { authority, claims } = countClaims(h.authority);
  const fixture = await fixtureFor(authority, h.dir);
  const location = { rootId: 'fixture', logicalPath: FILE, canonicalPath: h.canonical };
  const gate = holdStructure((token) => authority.setAdmission(token, { ...location, active: false }));
  await gate.ready;

  const pending = getState(fixture.origin, { documentUrl: `${fixture.origin}/${FILE}` });
  pending.catch(() => {});
  await waitFor(() => claims.length >= 1, 'the live request to capture its claim');
  expect(authority.identityAt(h.canonical)).toBeNull();
  expect(h.ids()).toBe(0);

  gate.act();
  await gate.applied;
  expect(authority.isRetired(location)).toBe(true);
  gate.release();
  await gate.done;

  const res = await pending;

  expect(res.status).toBe(404);
  expect(res.json).toEqual({ msg: 'No file here.', msgType: 'error', code: 'not-found' });
  expect(authority.rooms.get(h.canonical)).toBeNull();
  expect(h.reads).toEqual([]);
  expect(h.ids()).toBe(0);
});

test('two fresh live GETs that name one document both admit it', async () => {
  const h = setup();
  const { authority, claims } = countClaims(h.authority);
  const fixture = await fixtureFor(authority, h.dir);
  const gate = holdStructure();
  await gate.ready;

  const first = getState(fixture.origin, { documentUrl: `${fixture.origin}/${FILE}` });
  const second = getState(fixture.origin, { documentUrl: `${fixture.origin}/${FILE}` });
  first.catch(() => {});
  second.catch(() => {});
  await waitFor(() => claims.length >= 2, 'both live requests to capture their claims');
  expect(h.ids()).toBe(0);

  gate.release();
  await gate.done;
  const [a, b] = await Promise.all([first, second]);

  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(a.json.stores.store.value).toEqual({ count: 0 });
  expect(b.json.stores.store.value).toEqual({ count: 0 });
  expect(authority.identityAt(h.canonical)).not.toBeNull();
  expect(authority.rooms.get(h.canonical).nodeId).toBe(authority.identityAt(h.canonical));
});

test('a retired bound target is no longer a bound target', async () => {
  const h = setup();
  const origin = 'http://127.0.0.1:7000';
  const query = { rootId: 'root-a', logicalPath: FILE, origin };
  const target = h.authority.bindTarget({ ...query, canonicalPath: h.canonical, live: null });
  h.authority.registerEditor(target, { clientId: 'cA', send: () => {} });

  expect(h.authority.findBoundTarget(query)).toBe(target);

  await withStructureChange((token) => h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: FILE, active: false }));

  expect(h.authority.isRetired({ rootId: 'root-a', logicalPath: FILE })).toBe(true);
  expect(h.authority.findBoundTarget(query)).toBeNull();
});

test('a cold read failure for an unbound target leaves no identity', async () => {
  const h = setup();
  const origin = 'http://127.0.0.1:7000';
  fs.rmSync(h.canonical);
  const candidate = { rootId: 'root-a', logicalPath: FILE, origin, canonicalPath: h.canonical, live: null };

  await expect(h.authority.roomFor({ ...candidate, identity: undefined }, async () => candidate))
    .rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'not-found' });

  expect(h.authority.identityAt(h.canonical)).toBeNull();
  expect(h.authority.rooms.get(h.canonical)).toBeNull();
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: FILE, origin })).toBeNull();
  expect(h.ids()).toBe(0);
});

test('a warm room is not reused once its logical route is retired', async () => {
  const h = setup();
  const origin = 'http://127.0.0.1:7000';
  const target = h.authority.bindTarget({ rootId: 'root-a', logicalPath: FILE, canonicalPath: h.canonical, origin, live: null });
  const candidate = { rootId: 'root-a', logicalPath: FILE, origin, canonicalPath: h.canonical, live: null };

  const room = await h.authority.roomFor(target, async () => candidate);
  expect(room.nodeId).toBe(target.identity);
  expect(h.reads).toEqual([h.canonical]);

  await withStructureChange((token) => h.authority.setAdmission(token, { rootId: 'root-a', logicalPath: FILE, active: false }));

  await expect(h.authority.roomFor(target, () => {
    throw new Error('a retired target must not reach the disk boundary');
  })).rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });
  expect(h.authority.rooms.get(h.canonical)).toBe(room);
  expect(h.reads).toEqual([h.canonical]);
});

test('a target bound before a retire and reactivate of the same path is no longer current', async () => {
  const h = setup();
  const origin = 'http://127.0.0.1:7000';
  const location = { rootId: 'root-a', logicalPath: FILE, canonicalPath: h.canonical };
  h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
  const target = h.authority.bindTarget({ ...location, origin, live: null });
  const member = h.authority.registerEditor(target, { clientId: 'cA', send: () => {} });
  const room = await h.authority.roomFor(target, async () => target);

  expect(h.authority.isCurrentTarget(target)).toBe(true);
  expect(room.nodeId).toBe(target.identity);
  expect(h.reads).toEqual([h.canonical]);

  const before = h.authority.captureAdmission(location);
  await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false }));
  await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: true }));

  // The path, the identity, the incarnation and the retirement all came back, so
  // a comparison that omitted the admission revisions would call this stale
  // target current: only the two revisions below tell the generations apart.
  const after = h.authority.captureAdmission(location);
  expect({
    ...after,
    canonicalRevision: before.canonicalRevision,
    logicalRevision: before.logicalRevision,
  }).toEqual(before);
  expect(after.canonicalRevision).toBeGreaterThan(before.canonicalRevision);
  expect(after.logicalRevision).toBeGreaterThan(before.logicalRevision);
  expect(h.authority.isRetired(location)).toBe(false);
  expect(h.authority.identityAt(h.canonical)).toBe(target.identity);

  expect(h.authority.isCurrentTarget(target)).toBe(false);
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: FILE, origin })).toBeNull();
  expect(h.authority.currentEditor(target, 'cA', member.conn)).toBeNull();
  expect(h.authority.newestEditor(target, 'cA')).toBeNull();
  // The proof is stale, not absent: one real membership and one warm room remain.
  expect(h.authority.connectedIds(h.canonical)).toEqual(['cA']);
  expect(h.authority.rooms.get(h.canonical)).toBe(room);

  await expect(h.authority.roomFor(target, () => {
    throw new Error('a stale target must not reach the disk boundary');
  })).rejects.toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });
  expect(h.authority.rooms.get(h.canonical)).toBe(room);
  expect(h.reads).toEqual([h.canonical]);

  member.close();
  const fresh = h.authority.bindTarget({ ...location, origin, live: null });
  const freshMember = h.authority.registerEditor(fresh, { clientId: 'cA', send: () => {} });
  expect(h.authority.isCurrentTarget(fresh)).toBe(true);
  expect(h.authority.findBoundTarget({ rootId: 'root-a', logicalPath: FILE, origin })).toBe(fresh);
  expect(h.authority.currentEditor(fresh, 'cA', freshMember.conn)).toBe(freshMember);
  expect(await h.authority.roomFor(fresh, () => {
    throw new Error('a warm room must not resolve through the disk boundary');
  })).toBe(room);
  expect(h.reads).toEqual([h.canonical]);
  freshMember.close();
});

test('a stale target registers no snapshot, editor or room, while a fresh target still registers', async () => {
  const h = setup();
  const origin = 'http://127.0.0.1:7000';
  const location = { rootId: 'root-a', logicalPath: FILE, canonicalPath: h.canonical };
  h.authority.registerRoot({ id: 'root-a', canonicalPath: h.dir, path: h.dir }, { owner: 'server' });
  const target = h.authority.bindTarget({ ...location, origin, live: null });
  const allocated = h.ids();

  await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: false }));
  await withStructureChange((token) => h.authority.setAdmission(token, { ...location, active: true }));
  expect(h.authority.isCurrentTarget(target)).toBe(false);

  expect(refusalOf(() => h.authority.registerSnapshot(target, { lane: 'live', legacy: true })))
    .toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });
  expect(refusalOf(() => h.authority.registerEditor(target, { clientId: 'cA', send: () => {} })))
    .toMatchObject({ name: 'LocalAuthorityError', code: 'moved' });

  // The refusal allocated nothing: the record is the one the old target was bound
  // to, no identity was minted, no legacy snapshot or membership was added, no
  // room was opened and the disk was never read.
  expect(h.ids()).toBe(allocated);
  expect(h.authority.identityAt(h.canonical)).toBe(target.identity);
  expect(h.authority.connectedIds(h.canonical)).toEqual([]);
  expect(h.authority.hasUnjoinedEditors(h.canonical)).toBe(false);
  expect(h.authority.rooms.get(h.canonical)).toBeNull();
  expect(h.reads).toEqual([]);

  // The readmitted document is a fresh proof, and it registers normally.
  const fresh = h.authority.bindTarget({ ...location, origin, live: null });
  expect(h.authority.isCurrentTarget(fresh)).toBe(true);
  const dispose = h.authority.registerSnapshot(fresh, { lane: 'live', legacy: true });
  const member = h.authority.registerEditor(fresh, { clientId: 'cA', send: () => {} });
  expect(h.authority.connectedIds(h.canonical)).toEqual(['cA']);
  expect(h.authority.hasUnjoinedEditors(h.canonical)).toBe(true);
  expect((await h.authority.roomFor(fresh, async () => fresh)).nodeId).toBe(fresh.identity);
  expect(h.reads).toEqual([h.canonical]);

  member.close();
  dispose();
  expect(h.authority.connectedIds(h.canonical)).toEqual([]);
  expect(h.authority.hasUnjoinedEditors(h.canonical)).toBe(false);
});
