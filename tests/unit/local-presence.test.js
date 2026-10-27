// Local authority presence: per-tab sessions, numbered record and page targets, the TTL,
// the token bucket, and the roster each admitted stream is told. Two real SSE streams on
// one real document exchange a target over a real loopback listener, so what is asserted
// is the frames a browser sees rather than a mock's expectations.
//
// Presence is advisory and ephemeral. Nothing here may write to a room value, a checkpoint
// or a sidecar, which is why one test takes a picture of the folder before and after a
// whole exchange and requires the two to match.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createPresenceRelay } = require('../../src/main/presence');
const { createApp } = require('../../src/main/server');
const { createRootLive } = require('../../src/main/utils/root-live');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const DOC = (body = 'hello') => `<!doctype html>\n<html><body><p>${body}</p></body></html>\n`;
const FILE = 'index.html';
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

const PAGE_TARGET = {
  kind: 'page',
  v: 1,
  epoch: 'epoch-1',
  generation: 0,
  selection: {
    kind: 'text',
    anchor: { block: 'p1', rel: 'AAAAAA==' },
    head: { block: 'p1', rel: 'AAAAAA==' },
  },
};
const RECORD_TARGET = { kind: 'record', id: 'c-1', field: 'title' };

const dirs = [];
function tempDir() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'local-presence-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await closeLoopback();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await wait(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function parseEvent(part) {
  const ev = { name: '', id: '', data: '' };
  for (const line of part.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) ev.name = line.slice(7);
    else if (line.startsWith('id: ')) ev.id = line.slice(4);
    else if (line.startsWith('data: ')) ev.data += (ev.data ? '\n' : '') + line.slice(6);
  }
  if (ev.data === '') return null;
  try {
    ev.payload = JSON.parse(ev.data);
  } catch (err) {
    ev.payload = null;
  }
  return ev;
}

// A real SSE client on its own socket, reading named frames off the wire.
function openStream(origin, target, { headers = {} } = {}) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...SAME_ORIGIN, ...headers },
    }, (res) => {
      const stream = {
        status: res.statusCode,
        events: [],
        closed: false,
        close() { req.destroy(); },
      };
      let buf = '';
      res.on('error', () => {});
      res.on('close', () => { stream.closed = true; });
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const ev = parseEvent(part);
          if (ev) stream.events.push(ev);
        }
      });
      resolve(stream);
    });
    req.on('error', reject);
  });
}

function request(origin, { method = 'GET', target, headers = {}, body = null }) {
  const url = new URL(target, origin);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch (err) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// A Local app on a real loopback port, serving one real folder, with the real authority.
async function startFixture() {
  const state = { now: 1_000_000 };
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, FILE), DOC());

  const rooms = createRooms({ now: () => state.now });
  const authority = createLocalAuthority({
    rooms,
    withDocument: withDocumentWrite,
    now: () => state.now,
  });
  const root = { id: 'root-a', kind: 'team', path: dir, port: 0 };
  const live = createRootLive(root);
  const app = createApp({
    root,
    live,
    devHooks: null,
    isKnownPath: null,
    observer: null,
    helpers: null,
    syncEngineFor: null,
    person: null,
    localAuthority: authority,
  });
  const server = await listenLoopback(app);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const documentUrl = (query = '') => `${origin}/${FILE}${query}`;

  const open = (clientId, lane = 'live', query = '') => {
    const params = [`document-url=${encodeURIComponent(documentUrl(query))}`, `lane=${lane}`];
    if (clientId) params.push(`client-id=${encodeURIComponent(clientId)}`);
    return openStream(origin, `/_/sync?${params.join('&')}`);
  };

  const postPresence = (clientId, body, extra = {}) => request(origin, {
    method: 'POST',
    target: `/_/presence${clientId ? `?client-id=${encodeURIComponent(clientId)}` : ''}`,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'Document-URL': documentUrl(),
      ...SAME_ORIGIN,
      ...extra,
    },
    body,
  });

  return { dir, origin, authority, open, postPresence, documentUrl };
}

const rosters = (stream) => stream.events.filter((ev) => ev.name === 'presence').map((ev) => ev.payload);
const roster = (stream) => rosters(stream).at(-1) ?? null;
const selfSession = (stream) => roster(stream)?.selfSession ?? null;
const sessions = (stream) => roster(stream)?.people[0]?.sessions ?? [];
const carets = (stream) => sessions(stream).map((session) => session.editing);
// Frames arrive as JSON, so a caret is compared by what it says rather than by identity.
const hasCaret = (stream, target) => carets(stream).some((caret) => JSON.stringify(caret) === JSON.stringify(target));
const treeOf = (dir) => {
  const entries = [];
  const walk = (at) => {
    for (const name of fs.readdirSync(at).sort()) {
      const full = path.join(at, name);
      const stats = fs.statSync(full);
      const rel = path.relative(dir, full);
      if (stats.isDirectory()) {
        entries.push(`${rel}/`);
        walk(full);
      } else {
        entries.push(`${rel}:${stats.size}`);
      }
    }
  };
  walk(dir);
  return entries;
};

describe('two tabs on one local document', () => {
  test('exchange a page target over their own streams', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    const b = await fx.open('tab-b');

    await waitFor(() => sessions(a).length === 2 && selfSession(a) && selfSession(b), 'two sessions');

    // Both tabs are this computer, and each is told which session is its own.
    expect(roster(a).people).toHaveLength(1);
    expect(roster(a).people[0].name).toBe('This computer');
    expect(roster(a).people[0].you).toBe(true);
    expect(roster(a).people[0].canEdit).toBe(true);
    expect(roster(a).anonymous).toBe(0);
    expect(sessions(a).map((session) => session.you)).toEqual([true, false]);
    expect(sessions(b).map((session) => session.you)).toEqual([false, true]);

    // The private token is this tab's, and neither it nor the client id is a public id.
    const mine = selfSession(a);
    expect(mine.token).toEqual(expect.any(String));
    expect(mine.id).not.toBe('tab-a');
    expect(mine.id).not.toBe(mine.token);
    expect(JSON.stringify(roster(b))).not.toContain('tab-a');

    const accepted = await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET });
    expect(accepted.status).toBe(204);

    await waitFor(() => hasCaret(b, PAGE_TARGET), 'the peer caret');
    expect(carets(a)).toEqual([PAGE_TARGET, null]);
    expect(sessions(b).find((session) => session.editing)).toEqual({
      id: mine.id,
      you: false,
      n: 1,
      editing: PAGE_TARGET,
    });

    a.close();
    b.close();
  });

  test('gives a saved-lane reader the roster and no page coordinate', async () => {
    const fx = await startFixture();
    const editor = await fx.open('tab-a');
    const reader = await fx.open('tab-r', 'saved');

    await waitFor(() => selfSession(editor) && roster(reader), 'the first roster');
    expect(selfSession(reader)).toBe(null);
    expect(roster(reader).people[0].name).toBe('This computer');

    const mine = selfSession(editor);
    expect((await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET })).status).toBe(204);
    await waitFor(() => hasCaret(editor, PAGE_TARGET), 'the editor caret');

    expect(JSON.stringify(rosters(reader))).not.toContain('epoch-1');
    expect(carets(reader)).toEqual([]);

    // A record target is what a reader already receives, so it still reaches this one.
    expect((await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 2, editing: RECORD_TARGET })).status).toBe(204);
    await waitFor(() => roster(reader).people[0].editing, 'the record marker');
    expect(roster(reader).people[0].editing).toEqual(RECORD_TARGET);
    expect(carets(reader)).toContainEqual(RECORD_TARGET);

    editor.close();
    reader.close();
  });

  test('drops the target when its stream disconnects', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    const b = await fx.open('tab-b');
    await waitFor(() => sessions(a).length === 2 && selfSession(a), 'two sessions');

    const mine = selfSession(a);
    await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET });
    await waitFor(() => hasCaret(b, PAGE_TARGET), 'the peer caret');

    a.close();
    await waitFor(() => sessions(b).length === 1, 'the departed session to leave the roster');
    expect(hasCaret(b, PAGE_TARGET)).toBe(false);
    expect(carets(b)).toEqual([null]);

    // The token that matched the closed stream matches nothing, and the tab has no live
    // stream left to own a target.
    const late = await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 2, editing: PAGE_TARGET });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe('not-connected');

    b.close();
  });

  test('resolves the workspace frame and the plain browser shape to one authority', async () => {
    const fx = await startFixture();
    const plain = await fx.open('tab-a');
    const framed = await fx.open('tab-c', 'live', '?workspace-frame=7');

    await waitFor(() => sessions(plain).length === 2 && selfSession(framed), 'two sessions');

    const mine = selfSession(framed);
    expect((await fx.postPresence('tab-c', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET })).status).toBe(204);
    await waitFor(() => hasCaret(plain, PAGE_TARGET), 'the caret on the other shape');

    plain.close();
    framed.close();
  });

  test('writes nothing to disk during a whole presence exchange', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    await waitFor(() => selfSession(a), 'the first roster');
    const before = treeOf(fx.dir);

    const b = await fx.open('tab-b');
    await waitFor(() => sessions(a).length === 2, 'the second session');
    const mine = selfSession(a);
    await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET });
    await waitFor(() => hasCaret(b, PAGE_TARGET), 'the peer caret');
    await fx.postPresence('tab-a', { v: 1, session: mine.token, n: 2, editing: null });
    await waitFor(() => carets(b).length > 0 && carets(b).every((caret) => caret === null), 'the clear');

    expect(treeOf(fx.dir)).toEqual(before);
    a.close();
    b.close();
  });
});

describe('the presence route refuses what it did not admit', () => {
  test('answers only on the marked address', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    await waitFor(() => selfSession(a), 'the first roster');
    const mine = selfSession(a);
    const body = { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET };

    const bare = await request(fx.origin, {
      method: 'POST',
      target: '/presence?client-id=tab-a',
      headers: { Origin: fx.origin, 'Content-Type': 'application/json', 'Document-URL': fx.documentUrl(), ...SAME_ORIGIN },
      body,
    });
    expect(bare.status).toBe(404);

    const unknown = await request(fx.origin, {
      method: 'POST',
      target: '/_/presence/extra',
      headers: { Origin: fx.origin, 'Content-Type': 'application/json' },
      body,
    });
    expect(unknown.status).toBe(404);

    expect((await fx.postPresence('tab-a', body)).status).toBe(204);
    a.close();
  });

  test('refuses cross-origin, foreign-host and headerless requests', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    await waitFor(() => selfSession(a), 'the first roster');
    const mine = selfSession(a);
    const body = { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET };

    const crossOrigin = await fx.postPresence('tab-a', body, { Origin: 'http://evil.example' });
    expect(crossOrigin.status).toBe(403);

    const crossSite = await fx.postPresence('tab-a', body, { 'Sec-Fetch-Site': 'cross-site' });
    expect(crossSite.status).toBe(403);

    const foreignHost = await fx.postPresence('tab-a', body, { Host: 'evil.example' });
    expect(foreignHost.status).toBe(403);

    const noDocument = await fx.postPresence('tab-a', body, { 'Document-URL': '' });
    expect(noDocument.status).toBe(400);

    expect((await fx.postPresence('tab-a', body)).status).toBe(204);
    a.close();
  });

  test('refuses a forged session, a stranger tab and a malformed body', async () => {
    const fx = await startFixture();
    const a = await fx.open('tab-a');
    const b = await fx.open('tab-b');
    await waitFor(() => selfSession(a) && selfSession(b), 'two sessions');
    const mine = selfSession(a);

    const forged = await fx.postPresence('tab-a', { v: 1, session: 'not-a-token', n: 1, editing: PAGE_TARGET });
    expect(forged.status).toBe(403);
    expect(forged.json.code).toBe('forbidden');

    const stranger = await fx.postPresence('tab-z', { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET });
    expect(stranger.status).toBe(409);

    for (const body of [
      { v: 1, session: mine.token, n: 1, editing: PAGE_TARGET, extra: true },
      { v: 2, session: mine.token, n: 1, editing: PAGE_TARGET },
      { v: 1, session: mine.token, n: -1, editing: PAGE_TARGET },
      { v: 1, session: '', n: 1, editing: PAGE_TARGET },
      { v: 1, session: mine.token, n: 1 },
      { editing: '1.2', v: 1 },
      { v: 1, session: mine.token, n: 1, editing: { kind: 'page', v: 1, epoch: 'e', generation: 0, selection: { kind: 'blocks', ids: [] } } },
    ]) {
      const refused = await fx.postPresence('tab-a', body);
      expect({ body, status: refused.status }).toEqual({ body, status: 400 });
    }

    expect(carets(b).every((caret) => caret === null)).toBe(true);
    a.close();
    b.close();
  });
});

describe('metadata names presence only where the relay runs', () => {
  test('advertises the three names with a relay and none without one', async () => {
    const fx = await startFixture();
    const withRelay = await request(fx.origin, {
      target: '/_/meta',
      headers: { 'Document-URL': fx.documentUrl() },
    });
    expect(withRelay.status).toBe(200);
    expect(withRelay.json.extensions).toEqual(expect.arrayContaining([
      'presence', 'page-awareness-v1', 'record-awareness-v1',
    ]));

    const dir = tempDir();
    fs.writeFileSync(path.join(dir, FILE), DOC());
    const barren = createApp({ root: { id: 'root-b', kind: 'team', path: dir, port: 0 }, live: null, localAuthority: null });
    const server = await listenLoopback(barren);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const without = await request(origin, {
      target: '/_/meta',
      headers: { 'Document-URL': `${origin}/${FILE}` },
    });
    expect(without.status).toBe(200);
    expect(without.json.extensions).not.toContain('presence');
    expect(without.json.extensions).not.toContain('page-awareness-v1');
    expect(without.json.extensions).not.toContain('record-awareness-v1');
  });
});

describe('the relay orders, bounds and expires what it accepted', () => {
  function relayHarness() {
    const clock = { now: 1_000_000 };
    const relay = createPresenceRelay({ now: () => clock.now });
    const connect = (clientId, lane = 'live') => {
      const stream = { frames: [] };
      const connection = relay.connect({
        canonicalPath: '/tmp/presence.html',
        lane,
        clientId,
        send: (name, payload) => {
          stream.frames.push({ name, payload });
        },
      });
      const last = () => stream.frames.at(-1)?.payload ?? null;
      return { connection, stream, last, self: () => last()?.selfSession ?? null };
    };
    const advance = (ms) => { clock.now += ms; };
    return { relay, connect, advance };
  }

  test('gives two tabs two sessions and a reconnect a fresh token', () => {
    const h = relayHarness();
    const first = h.connect('tab-a');
    const second = h.connect('tab-b');

    expect(first.self().id).not.toBe(second.self().id);
    expect(first.self().token).not.toBe(second.self().token);
    expect(first.self().token.length).toBeGreaterThan(20);

    const old = first.self().token;
    first.connection.close();
    const again = h.connect('tab-a');
    expect(again.self().token).not.toBe(old);
    expect(h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session: old, n: 1, editing: PAGE_TARGET }))
      .toEqual({ status: 'forbidden' });
    again.connection.close();
    second.connection.close();
  });

  test('ignores a number it has already passed, so a stale frame cannot bring a clear back', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const b = h.connect('tab-b');
    const session = a.self().token;

    const send = (n, editing) => h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session, n, editing });
    expect(send(1, PAGE_TARGET).status).toBe('ok');
    expect(send(2, null).status).toBe('ok');
    expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([null, null]);

    expect(send(1, PAGE_TARGET).status).toBe('stale');
    expect(send(2, PAGE_TARGET).status).toBe('stale');
    h.relay.publishRoster('/tmp/presence.html');
    expect(b.last().people[0].sessions.every((entry) => entry.editing === null)).toBe(true);

    expect(send(3, PAGE_TARGET).status).toBe('ok');
    expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([PAGE_TARGET, null]);
    a.connection.close();
    b.connection.close();
  });

  test('accepts a burst of twenty then refuses until the bucket refills', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const session = a.self().token;
    const send = (n) => h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session, n, editing: PAGE_TARGET });

    for (let n = 1; n <= 20; n++) expect(send(n).status).toBe('ok');
    expect(send(21).status).toBe('rate-limited');
    h.advance(1000);
    expect(send(21).status).toBe('ok');
    a.connection.close();
  });

  test('refuses a target beyond the size bound and leaves the last one standing', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const b = h.connect('tab-b');
    const session = a.self().token;
    const send = (n, editing) => h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session, n, editing });

    expect(send(1, PAGE_TARGET).status).toBe('ok');
    const huge = {
      ...PAGE_TARGET,
      selection: { kind: 'blocks', ids: Array.from({ length: 128 }, () => 'x'.repeat(200)) },
    };
    expect(send(2, huge)).toEqual({ status: 'invalid', reason: 'size' });
    expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([PAGE_TARGET, null]);
    a.connection.close();
    b.connection.close();
  });

  test('republishes when a target expires, without waiting for another frame', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const b = h.connect('tab-b');
    const session = a.self().token;

    jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
    try {
      expect(h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session, n: 1, editing: PAGE_TARGET }).status).toBe('ok');
      expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([PAGE_TARGET, null]);

      h.advance(15001);
      jest.advanceTimersByTime(15001);
      expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([null, null]);
    } finally {
      jest.useRealTimers();
    }
    a.connection.close();
    b.connection.close();
  });

  test('keeps the legacy single-field report to a dotted path or a record', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const reader = h.connect('tab-r', 'saved');

    expect(h.relay.report('/tmp/presence.html', { clientId: 'tab-a', editing: '1.2' })).toEqual({ status: 'ok', target: '1.2' });
    expect(reader.last().people[0].editing).toBe('1.2');

    expect(h.relay.report('/tmp/presence.html', { clientId: 'tab-a', editing: RECORD_TARGET }).status).toBe('ok');
    expect(reader.last().people[0].editing).toEqual(RECORD_TARGET);

    expect(h.relay.report('/tmp/presence.html', { clientId: 'tab-a', editing: PAGE_TARGET }).status).toBe('invalid');
    expect(h.relay.report('/tmp/presence.html', { clientId: 'tab-a', editing: '#id' }).status).toBe('invalid');
    expect(h.relay.report('/tmp/presence.html', { clientId: 'tab-z', editing: '1.2' }).status).toBe('not-connected');
    a.connection.close();
    reader.connection.close();
  });

  test('never makes a page target a person-level edit', () => {
    const h = relayHarness();
    const a = h.connect('tab-a');
    const b = h.connect('tab-b');
    expect(h.relay.setTarget('/tmp/presence.html', { clientId: 'tab-a', session: a.self().token, n: 1, editing: PAGE_TARGET }).status).toBe('ok');
    expect('editing' in b.last().people[0]).toBe(false);
    expect(b.last().people[0].sessions.map((entry) => entry.editing)).toEqual([PAGE_TARGET, null]);
    a.connection.close();
    b.connection.close();
  });
});

describe('the Local copy agrees with the ClayJS reference', () => {
  const CLAYJS = path.resolve(__dirname, '../../../clayjs/src/sync/presence-target.js');
  const CLAYJS_PATH = path.resolve(__dirname, '../../../clayjs/src/sync/editing-path.js');

  const CONSTANTS = [
    'PRESENCE_VERSION', 'MAX_TARGET_BYTES', 'MAX_PAGE_ID_BYTES', 'MAX_REL_BYTES', 'MAX_RECORD_ID',
    'MAX_SELECTION_IDS', 'RECORD_FIELDS', 'COALESCE_MS', 'RENEW_MS', 'EXPIRE_MS',
    'RATE_PER_SECOND', 'RATE_BURST',
  ];

  const VALUES = () => [
    null, undefined, '1.2', '0', '', '#id', '1..2', 'a', 5, true, [], {},
    { kind: 'nope' }, { kind: 'record', id: 'a' }, { kind: 'record', id: 'a', field: 'title' },
    { kind: 'record', id: 'a', field: 'nope' }, { kind: 'record', id: 'x'.repeat(129) },
    { kind: 'record', id: 'a', extra: true }, { kind: 'record', id: 'a b' },
    PAGE_TARGET, { ...PAGE_TARGET, v: 2 }, { ...PAGE_TARGET, generation: -1 },
    { ...PAGE_TARGET, selection: { kind: 'blocks', ids: [] } },
    { ...PAGE_TARGET, selection: { kind: 'cell', block: 't', row: 'r', col: 'c' } },
    { ...PAGE_TARGET, selection: { kind: 'blocks', ids: Array.from({ length: 128 }, () => 'x'.repeat(200)) } },
  ];

  // The sibling checkout is an ES module; read it, swap its one import for the regex it
  // names, and evaluate it as the same contract this host ships.
  function loadReference() {
    const editingPath = fs.readFileSync(CLAYJS_PATH, 'utf8');
    const found = editingPath.match(/export const EDITING_PATH = (\/[^\n]+\/);/);
    if (!found) throw new Error('no EDITING_PATH in the ClayJS checkout');
    const pathExpression = found[1];
    // eslint-disable-next-line no-new-func
    const referencePath = new Function(`return ${pathExpression};`)();
    const reference = fs.readFileSync(CLAYJS, 'utf8');
    const names = [...reference.matchAll(/^export (?:const|function) (\w+)/gm)].map((match) => match[1]);
    const source = reference
      .replace(/import \{ EDITING_PATH \} from '\.\/editing-path\.js';/, `const EDITING_PATH = ${pathExpression};`)
      .replace(/^export /gm, '');
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', `${source}\nmodule.exports = { ${names.join(', ')} };`)(module, module.exports);
    return { contract: module.exports, editingPath: referencePath };
  }

  test('holds the same constants and accepts and refuses the same values', () => {
    if (!fs.existsSync(CLAYJS)) {
      console.warn(`[Presence] No ClayJS checkout at ${CLAYJS}; the parity check is skipped.`);
      return;
    }
    const { contract: theirs, editingPath: theirPath } = loadReference();
    const ours = require('../../src/main/presence-target');

    for (const name of CONSTANTS) expect({ [name]: ours[name] }).toEqual({ [name]: theirs[name] });
    expect(ours.EDITING_PATH.source).toBe(theirPath.source);
    expect(ours.EDITING_PATH.flags).toBe(theirPath.flags);

    for (const value of VALUES()) {
      expect({ value, result: ours.validateTarget(value) }).toEqual({ value, result: theirs.validateTarget(value) });
    }
    expect(ours.normalizeEditing(PAGE_TARGET)).toBe(null);
    expect(ours.normalizeEditing('1.2')).toBe('1.2');
    expect(ours.normalizeEditing(RECORD_TARGET)).toEqual(RECORD_TARGET);
  });
});
