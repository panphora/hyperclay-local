// C5.3: spec §10's list form, ports of htmlclay/livesync_shared_test.go by name.
//
// The real library is used, not a mock: what is under test is the frame the two
// sides actually agree on — a named event carrying the library's own id line —
// and a mock would hand back whatever shape the test asked for.
//
// Every server is bound by listenLoopback on 127.0.0.1 and addressed by raw
// http.get through the port it reports; the bare `request(app)` a test reaches
// for first would bind a wildcard port and can be answered by another local
// listener (see tests/helpers/loopback.js).

const http = require('http');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { liveSync } = require('livesync-hyperclay');

const PAGE_A = '<!DOCTYPE html>\n<html><body>a</body></html>';
const PAGE_B = '<!DOCTYPE html>\n<html><body>b</body></html>';
const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

const A = 'a.htmlclay';
const B = 'b.htmlclay';

let dir;
let server;
let port;
let streams;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'shared-stream-')));
  await fs.writeFile(path.join(dir, A), PAGE_A);
  await fs.writeFile(path.join(dir, B), PAGE_B);
  const root = { id: 'legacy', kind: 'personal', path: dir, port: 0 };
  server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null }));
  root.port = server.address().port;
  port = root.port;
  streams = [];
});

afterEach(async () => {
  for (const stream of streams) stream.close();
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${port}`;
const enc = (href) => encodeURIComponent(href);
const sharedPath = (entries) => `/_/sync?${entries.map((e) => `s=${enc(e)}`).join('&')}`;

// One SSE event, or null for a part that is only a comment (`: connected`) or
// carries no data at all.
function parseEvent(part) {
  const ev = { name: '', id: '', data: '' };
  for (const line of part.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) ev.name = line.slice(7);
    else if (line.startsWith('id: ')) ev.id = line.slice(4);
    else if (line.startsWith('data: ')) ev.data += (ev.data ? '\n' : '') + line.slice(6);
  }
  return ev.data === '' ? null : ev;
}

// Raw http.get, so the connection is the one this test opened and every event is
// read exactly as a client reads it.
function openStream(target, headers = SAME_ORIGIN) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, headers }, (res) => {
      res.setEncoding('utf8');
      const events = [];
      const waiters = [];
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const ev = parseEvent(part);
          if (!ev) continue;
          const waiter = waiters.shift();
          if (waiter) waiter(ev);
          else events.push(ev);
        }
      });
      const stream = {
        status: res.statusCode,
        headers: res.headers,
        events,
        next(timeoutMs = 5000) {
          if (events.length) return Promise.resolve(events.shift());
          return new Promise((resolved, rejected) => {
            const timer = setTimeout(() => rejected(new Error('no frame arrived')), timeoutMs);
            waiters.push((ev) => { clearTimeout(timer); resolved(ev); });
          });
        },
        close() { req.destroy(); },
      };
      streams.push(stream);
      resolve(stream);
    });
    req.on('error', reject);
  });
}

async function waitFor(condition, what) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const subscribersOf = (file) => [...liveSync.subscribers(file)].length;

function parseCursor(ev) {
  expect(ev.name).toBe('cursor');
  return JSON.parse(ev.data);
}

describe('C5.3: the shared live-sync stream', () => {
  test('TestSharedStreamNamesEachSubscription', async () => {
    const shared = await openStream(sharedPath([`live:0:${base()}/${A}`, `saved:0:${base()}/${B}`]));
    expect(shared.status).toBe(200);
    expect(shared.headers['content-type']).toBe('text/event-stream');

    for (let i = 0; i < 2; i++) {
      const cursor = parseCursor(await shared.next());
      expect(cursor).toEqual({ sub: i, seq: expect.any(Number) });
    }

    // The same document on the single-document form, which receives unnamed frames.
    const single = await openStream(`/_/sync?document-url=${enc(`${base()}/${A}`)}&lane=live`);
    expect(single.status).toBe(200);
    const singleCursor = await single.next();
    expect(singleCursor.name).toBe('cursor');
    expect(singleCursor.id).not.toBe('');

    await waitFor(() => subscribersOf(A) === 2 && subscribersOf(B) === 1, 'both subscriptions to register');

    liveSync.broadcast(A, { html: '<html>peer</html>', sender: 'tab-1' });
    const named = await shared.next();
    expect(named.name).toBe('s0');
    expect(named.id).not.toBe('');
    expect(named.data).toContain('peer');

    const unnamed = await single.next();
    expect(unnamed.name).toBe('');
    expect(unnamed.data).toContain('peer');

    liveSync.broadcast(B, { html: '<html>saved</html>', sender: 'server-save' }, { lane: 'saved' });
    const saved = await shared.next();
    expect(saved.name).toBe('s1');
    expect(saved.data).toContain('saved');
  });

  test('TestSharedStreamResumesEachEntryFromItsOwnPosition', async () => {
    const first = await openStream(sharedPath([`live:0:${base()}/${A}`]));
    const start = parseCursor(await first.next());
    await waitFor(() => subscribersOf(A) === 1, 'the first stream to register');

    liveSync.broadcast(A, { html: '<html>one</html>', sender: 'tab-1' });
    liveSync.broadcast(A, { html: '<html>two</html>', sender: 'tab-1' });
    const one = await first.next();
    const two = await first.next();
    expect(one.name).toBe('s0');
    expect(two.name).toBe('s0');
    expect(one.id).not.toBe('');
    expect(two.id).not.toBe('');
    first.close();

    // One entry resumes from the last id it saw, one presents a position the host
    // cannot vouch for, and one is fresh.
    const resumed = await openStream(sharedPath([
      `live:${one.id}:${base()}/${A}`,
      `live:5:${base()}/${B}`,
      `saved:0:${base()}/${B}`,
    ]));
    const c0 = parseCursor(await resumed.next());
    expect(c0).toEqual({ sub: 0, seq: Number(one.id) });
    expect(await resumed.next()).toEqual({ name: 's0', id: two.id, data: two.data });
    const c1 = parseCursor(await resumed.next());
    expect(c1.sub).toBe(1);
    expect(c1.resync).toBe(true);
    const c2 = parseCursor(await resumed.next());
    expect(c2).toEqual({ sub: 2, seq: expect.any(Number) });

    // A position above the head is a fresh subscription, not a resync.
    const future = await openStream(sharedPath([`live:${start.seq + 1000000}:${base()}/${A}`]));
    const cf = parseCursor(await future.next());
    expect(cf.resync).toBeUndefined();
    expect(cf.error).toBeUndefined();
  });

  test('TestSharedStreamAnswersNotFoundInsideTheStream', async () => {
    const shared = await openStream(sharedPath([`live:0:${base()}/${A}`, `live:0:${base()}/nope.htmlclay`]));
    expect(shared.status).toBe(200);
    expect(parseCursor(await shared.next())).toEqual({ sub: 0, seq: expect.any(Number) });
    expect(parseCursor(await shared.next())).toEqual({ sub: 1, error: 'not-found' });

    await waitFor(() => subscribersOf(A) === 1, 'the resolved entry to register');
    liveSync.broadcast(A, { html: '<html>still here</html>', sender: 'tab-1' });
    expect((await shared.next()).name).toBe('s0');

    // A stream of nothing but unresolvable entries still opens.
    const only = await openStream(sharedPath([`saved:0:${base()}/nope.htmlclay`]));
    expect(only.status).toBe(200);
    expect(parseCursor(await only.next())).toEqual({ sub: 0, error: 'not-found' });
  });

  test('TestSharedStreamRefusesMalformedLists', async () => {
    const cases = [
      ['no subscriptions', '/_/sync'],
      ['empty value', '/_/sync?s='],
      ['two fields', sharedPath([`live:${base()}/${A}`])],
      ['bad since', sharedPath([`live:x:${base()}/${A}`])],
      ['negative', sharedPath([`live:-1:${base()}/${A}`])],
      ['unknown lane', sharedPath([`both:0:${base()}/${A}`])],
      ['one too many', sharedPath(Array.from({ length: 257 }, () => `live:0:${base()}/${A}`))],
    ];
    for (const [name, target] of cases) {
      const res = await openStream(target);
      res.close();
      expect(`${name}: ${res.status}`).toBe(`${name}: 400`);
    }

    // The cap itself is served.
    const atCap = await openStream(sharedPath(Array.from({ length: 256 }, () => `live:0:${base()}/${A}`)));
    expect(atCap.status).toBe(200);
  });

  test('TestSharedStreamIsSameOriginGated', async () => {
    const target = sharedPath([`live:0:${base()}/${A}`]);
    const refusals = [
      ['no Sec-Fetch-Site', {}],
      ['same-site', { 'Sec-Fetch-Site': 'same-site' }],
      ['a foreign Origin', { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://evil.example' }],
    ];
    for (const [name, headers] of refusals) {
      const res = await openStream(target, headers);
      res.close();
      expect(`${name}: ${res.status}`).toBe(`${name}: 403`);
    }
  });

  test('TestSharedStreamTeardownRemovesEveryRecord', async () => {
    const before = liveSync.getStats().connections;
    const shared = await openStream(sharedPath([`live:0:${base()}/${A}`, `saved:0:${base()}/${B}`]));
    await waitFor(() => subscribersOf(A) === 1 && subscribersOf(B) === 1, 'both records to register');

    shared.close();
    await waitFor(() => subscribersOf(A) === 0 && subscribersOf(B) === 0, 'both records to be removed');
    expect(liveSync.getStats().connections).toBe(before);
  });

  test('cursor precedes replay for each entry, in query order', async () => {
    const probe = await openStream(sharedPath([`live:0:${base()}/${A}`]));
    const start = parseCursor(await probe.next());
    probe.close();

    liveSync.broadcast(A, { html: '<html>a1</html>', sender: 'tab-1' });
    liveSync.broadcast(B, { html: '<html>b1</html>', sender: 'tab-1' });

    const shared = await openStream(sharedPath([`live:${start.seq}:${base()}/${A}`, `live:${start.seq}:${base()}/${B}`]));
    expect(parseCursor(await shared.next())).toEqual({ sub: 0, seq: start.seq });
    const a = await shared.next();
    expect(a.name).toBe('s0');
    expect(a.data).toContain('a1');
    const cursorB = parseCursor(await shared.next());
    expect(cursorB.sub).toBe(1);
    const b = await shared.next();
    expect(b.name).toBe('s1');
    expect(b.data).toContain('b1');
  });

  test('single-document stream opens with a cursor carrying an id, then replays after Last-Event-ID', async () => {
    const target = `/_/sync?document-url=${enc(`${base()}/${A}`)}&lane=live`;
    const first = await openStream(target);
    const cursor = await first.next();
    expect(cursor.name).toBe('cursor');
    expect(cursor.id).not.toBe('');
    expect(JSON.parse(cursor.data).seq).toBe(Number(cursor.id));
    first.close();

    liveSync.broadcast(A, { html: '<html>one</html>', sender: 'tab-1' });
    liveSync.broadcast(A, { html: '<html>two</html>', sender: 'tab-1' });

    const resumed = await openStream(target, { ...SAME_ORIGIN, 'Last-Event-ID': cursor.id });
    const resumedCursor = await resumed.next();
    expect(resumedCursor.name).toBe('cursor');
    expect(resumedCursor.id).toBe(cursor.id);
    expect(JSON.parse(resumedCursor.data).resync).toBeUndefined();
    for (const want of ['one', 'two']) {
      const ev = await resumed.next();
      expect(ev.name).toBe('');
      expect(ev.id).not.toBe('');
      expect(ev.data).toContain(want);
    }
  });

  // C5.3's reset hook: a file replaced or removed on disk invalidates every
  // position a client could resume from, so the next resume is told to resync.
  test('an external change or a removal on disk forces the next resume to resync', async () => {
    const observer = Object.assign(new EventEmitter(), { emptyPending: () => false });
    const root = { id: 'legacy', kind: 'personal', path: dir, port: 0 };
    const hooked = await listenLoopback(createApp({
      root, devHooks: null, isKnownPath: null, observer,
    }));
    root.port = hooked.address().port;
    port = root.port;

    const first = await openStream(sharedPath([`live:0:${base()}/${A}`]));
    parseCursor(await first.next());
    liveSync.broadcast(A, { html: '<html>before</html>', sender: 'tab-1' });
    const frame = await first.next();
    first.close();

    observer.emit('change', { rel: A, kind: 'external' });
    const after = await openStream(sharedPath([`live:${frame.id}:${base()}/${A}`]));
    expect(parseCursor(await after.next()).resync).toBe(true);

    liveSync.broadcast(A, { html: '<html>after</html>', sender: 'tab-1' });
    const next = await after.next();
    expect(next.name).toBe('s0');
    expect(next.data).toContain('after');

    observer.emit('remove', { rel: A });
    const removed = await openStream(sharedPath([`live:${next.id}:${base()}/${A}`]));
    expect(parseCursor(await removed.next()).resync).toBe(true);
  });

  // The stream records and resumes under `ctx.live.key(rel)`, so the same file
  // name in two roots is two channels — the C2 rule the replay store inherits.
  test('a team root resumes under its own live key', async () => {
    const root = { id: 'team1', kind: 'team', path: dir, port: 0 };
    const team = await listenLoopback(createApp({
      root, devHooks: null, isKnownPath: null,
    }));
    root.port = team.address().port;
    port = root.port;

    const probe = await openStream(sharedPath([`live:0:${base()}/${A}`]));
    const start = parseCursor(await probe.next());
    probe.close();

    liveSync.broadcast(A, { html: '<html>personal</html>', sender: 'tab-1' });
    liveSync.broadcast(`team1:${A}`, { html: '<html>team</html>', sender: 'tab-1' });

    const shared = await openStream(sharedPath([`live:${start.seq}:${base()}/${A}`]));
    parseCursor(await shared.next());
    const replayed = await shared.next();
    expect(replayed.name).toBe('s0');
    expect(replayed.data).toContain('team');

    liveSync.broadcast(`team1:${A}`, { html: '<html>sentinel</html>', sender: 'tab-1' });
    expect((await shared.next()).data).toContain('sentinel');
  });

  test('legacy /live-sync/stream still delivers onmessage frames', async () => {
    const legacy = await openStream(`/live-sync/stream?document-url=${enc(`${base()}/${A}`)}`);
    expect(legacy.status).toBe(200);
    expect((await legacy.next()).name).toBe('cursor');

    await waitFor(() => subscribersOf(A) === 1, 'the legacy stream to register');
    liveSync.broadcast(A, { html: '<html>legacy</html>', sender: 'tab-1' });
    const frame = await legacy.next();
    expect(frame.name).toBe('');
    expect(JSON.parse(frame.data).html).toBe('<html>legacy</html>');
  });
});
