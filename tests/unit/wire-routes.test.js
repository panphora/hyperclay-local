// W1.2: the wire's two routes on a real per-folder app. Named ports of
// htmlclay/internal/server/wire_test.go, driven end to end: a temp root with a
// document in it, createApp in its ctx form, every server bound by listenLoopback
// and passed to supertest as the SERVER (a bare `request(app)` binds a wildcard
// port a loopback neighbour can answer, see tests/helpers/loopback.js).
//
// Streams are read with raw http.get, because what is under test is the bytes a
// client actually reads: the cursor event, the id line, the keepalive comment.
// Each test closes the streams it opened, and the suite closes every server.

const http = require('http');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { RootObserver } = require('../../src/main/root-observer.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const PAGE = '<!DOCTYPE html>\n<html><body>wire</body></html>';
const MAX_TEXT = 4 << 10; // maxWireText, wire.go:35
const MAX_BODY = 1 << 20; // maxWireBody, wire.go:34

let dir;
let ctx;
let app;
let hub;
let server;
let port;
let otherPort;
let streams;
let observers;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wire-routes-')));
  await fs.writeFile(path.join(dir, 'app.html'), PAGE);
  // A user folder actually named `wire/`, which the routes must not swallow.
  await fs.mkdir(path.join(dir, 'wire'));
  await fs.writeFile(path.join(dir, 'wire', 'page.html'), PAGE);
  await fs.writeFile(path.join(dir, 'wire', 'subscribe'), 'a file, not a stream\n');

  ctx = { root: { id: 'legacy', kind: 'personal', path: dir, port: 0 }, devHooks: null, isKnownPath: null };
  app = createApp(ctx);
  hub = app.locals.wireHub;
  server = await listenLoopback(app);
  ctx.root.port = server.address().port;
  port = ctx.root.port;

  // A real second origin, for "another local port is not this one".
  const other = await listenLoopback((req, res) => res.end('other'));
  otherPort = other.address().port;

  streams = [];
  observers = [];
});

afterEach(async () => {
  for (const stream of streams) stream.close();
  for (const observer of observers) await observer.stop();
  hub.shutdown();
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true });
});

const abs = (rel) => path.join(dir, rel);
const origin = () => `http://127.0.0.1:${port}`;
const documentUrl = () => `${origin()}/app.html`;
const enc = (value) => encodeURIComponent(value);

// What a page's EventSource and fetch send on this origin.
const pageHeaders = (extra = {}) => ({
  'Sec-Fetch-Site': 'same-origin',
  Origin: origin(),
  'Document-URL': documentUrl(),
  ...extra
});

// One SSE event, or null for a part that is only a comment (`: keepalive`).
function parseEvent(part) {
  const ev = { name: '', id: '', data: '' };
  for (const line of part.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) ev.name = line.slice(7);
    else if (line.startsWith('id: ')) ev.id = line.slice(4);
    else if (line.startsWith('data: ')) ev.data += (ev.data ? '\n' : '') + line.slice(6);
  }
  return ev;
}

// Raw http.get, so the connection is the one this test opened and every byte is
// read exactly as a client reads it. Non-SSE answers keep their status, headers
// and whole body so a 404 can be read for what it is.
function openStream(target, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, headers }, (res) => {
      res.setEncoding('utf8');
      const events = [];
      const waiters = [];
      let buf = '';
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const ev = parseEvent(part);
          if (ev.data === '') continue;
          if (waiters.length) waiters.shift()(ev);
          else events.push(ev);
        }
      });
      const stream = {
        status: res.statusCode,
        headers: res.headers,
        events,
        body() { return raw; },
        next(timeoutMs = 5000) {
          if (events.length) return Promise.resolve(events.shift());
          return new Promise((resolved, rejected) => {
            const timer = setTimeout(() => rejected(new Error('no frame arrived')), timeoutMs);
            waiters.push((ev) => { clearTimeout(timer); resolved(ev); });
          });
        },
        close() { req.destroy(); }
      };
      streams.push(stream);
      resolve(stream);
    });
    req.on('error', reject);
  });
}

const subscribe = (query, headers) => openStream(`/_/wire/subscribe?${query}`, headers);
const processStream = (rel, role, headers) =>
  subscribe(`file=${enc(abs(rel))}${role ? `&role=${role}` : ''}`, headers);

const post = (body, headers = {}) => request(server).post('/_/wire/send').set(headers).send(body);

const envOf = (ev) => JSON.parse(ev.data);

// The app is built before a test body runs and the wire reads `ctx.observer` per
// request rather than at mount time, so a test installs the observer it needs on
// the ctx the app already holds.
function useObserver(observer) {
  ctx.observer = observer;
  return observer;
}

// C2's RootObserver over the temp root, exactly what main.js gives a served
// folder. Nothing here reads a live frame, but the observer's external-change
// path does, so it gets a stub rather than the real livesync hub.
function realObserver() {
  const observer = new RootObserver(ctx.root, {
    live: { wasBrowserSave: () => false, notify: () => {}, broadcast: () => {} }
  });
  observers.push(observer);
  return useObserver(observer);
}

// A lease the caller can count: a fake observer answers `lease`/`poke` so a test
// can assert the call itself, which is all the wire does with it.
function fakeObserver() {
  return useObserver({ lease: jest.fn(() => () => {}), poke: jest.fn() });
}

// One event, or a rejection rather than a hung test. The timer is cleared on
// either path so nothing keeps the loop alive.
function once(emitter, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { emitter.off(event, onEvent); reject(new Error(`no ${event} event`)); }, timeoutMs);
    const onEvent = (payload) => { clearTimeout(timer); resolve(payload); };
    emitter.once(event, onEvent);
  });
}

describe('W1.2: the wire routes', () => {
  test('a header-free process is admitted', async () => {
    const stream = await subscribe(`file=${enc(abs('app.html'))}`);

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(stream.headers['cache-control']).toBe('no-store');
  });

  // Every folder here is its own origin and every one is same-site with every
  // other, so cross-site and same-site are both a 403 rather than one being
  // admitted as a local page.
  test('cross-site is 403', async () => {
    const stream = await subscribe(`file=${enc(abs('app.html'))}`, { 'Sec-Fetch-Site': 'cross-site' });

    expect(stream.status).toBe(403);
    expect(stream.headers['content-type']).toMatch(/^text\/plain/);
  });

  test('same-site is 403', async () => {
    const stream = await subscribe(`file=${enc(abs('app.html'))}`, { 'Sec-Fetch-Site': 'same-site' });

    expect(stream.status).toBe(403);
  });

  // An Origin must be this server's own, spelled exactly: `localhost:4321` and
  // `127.0.0.1:4321` are two origins, and the port is part of the comparison.
  test('a foreign Origin is 403, including another local port', async () => {
    const samePort = await subscribe(`file=${enc(abs('app.html'))}`, {
      'Sec-Fetch-Site': 'same-origin',
      Origin: `http://localhost:${port}`
    });
    expect(samePort.status).toBe(403);

    const other = await subscribe(`file=${enc(abs('app.html'))}`, {
      'Sec-Fetch-Site': 'same-origin',
      Origin: `http://localhost:${otherPort}`
    });
    expect(other.status).toBe(403);
  });

  // Chrome omits Origin on a same-origin GET, including EventSource's stream GET,
  // so the header is checked only when present.
  test('same-origin without an Origin header is admitted', async () => {
    const stream = await subscribe(`file=${enc(abs('app.html'))}`, {
      'Sec-Fetch-Site': 'same-origin',
      'Document-URL': documentUrl()
    });

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/^text\/event-stream/);
  });

  // An open tab cannot impersonate the user's agent: the exclusive slot is for a
  // program, and a page is refused before the file is even resolved.
  test('a page cannot take the handler role', async () => {
    const page = await subscribe(`file=${enc(abs('app.html'))}&role=handler`, pageHeaders());
    expect(page.status).toBe(403);

    const process = await processStream('app.html', 'handler');
    expect(process.status).toBe(200);
    expect(process.headers['content-type']).toMatch(/^text\/event-stream/);
  });

  // File and From are stamped by the SERVER, and a page's supplied file is
  // discarded: a page that could name its own path would launder a write through
  // the agent's authority into a file it can never touch.
  test('send stamps the canonical file and from; a supplied file from a page is ignored', async () => {
    const observer = await processStream('app.html');

    const fromPage = await post(
      { type: 'wire/request', id: 'r1', file: '/etc/passwd', text: 'hi' },
      pageHeaders()
    );
    expect(fromPage.status).toBe(200);
    expect(fromPage.body).toEqual({ ok: true, delivered: 0, observers: 1 });

    const pageFrame = envOf(await observer.next());
    expect(pageFrame.file).toBe('app.html');
    expect(pageFrame.from).toBe('page');

    const fromProcess = await post({ type: 'wire/status', id: 'r2', file: abs('app.html'), text: 'working' });
    expect(fromProcess.status).toBe(200);
    expect(fromProcess.body).toEqual({ ok: true, delivered: 0, observers: 1 });

    const processFrame = envOf(await observer.next());
    expect(processFrame.file).toBe('app.html');
    expect(processFrame.from).toBe('process');
    expect(processFrame.text).toBe('working');
  });

  // The router validates that a type is a wire type and that an id is present and
  // bounded. It never reads a payload, so it does not police the type set.
  test('send rejects a non-wire type', async () => {
    const named = await post({ type: 'note/x', id: 'r1', file: abs('app.html') });
    expect(named.status).toBe(400);
    expect(named.body).toMatchObject({ ok: false, error: 'invalid type' });

    const long = await post({ type: `wire/${'x'.repeat(60)}`, id: 'r1', file: abs('app.html') });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('invalid type');
  });

  test('send rejects an empty or 129-char id', async () => {
    const empty = await post({ type: 'wire/request', id: '', file: abs('app.html') });
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ ok: false, error: 'invalid id' });

    const long = await post({ type: 'wire/request', id: 'x'.repeat(129), file: abs('app.html') });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('invalid id');

    const ok = await post({ type: 'wire/request', id: 'x'.repeat(128), file: abs('app.html') });
    expect(ok.status).toBe(200);
  });

  test('send rejects bad JSON', async () => {
    const res = await request(server)
      .post('/_/wire/send')
      .set('Content-Type', 'application/json')
      .send('{"type":"wire/requ');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid JSON' });
  });

  // application/json is load-bearing rather than hygiene: it is not a CORS-simple
  // content type, so a cross-origin POST is forced into a preflight this host
  // never approves.
  test('send requires a JSON content type (415)', async () => {
    const res = await request(server)
      .post('/_/wire/send')
      .set('Content-Type', 'text/plain')
      .send('{"type":"wire/request","id":"r1"}');

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ ok: false, error: 'expected application/json', code: 'unsupported-type' });
  });

  // A GET on the send path is not a wire route: nothing consumes it, so it falls
  // through to the static catch-all and 404s rather than answering 405.
  test('GET on send is not a wire route', async () => {
    const res = await request(server).get('/_/wire/send').set('Sec-Fetch-Site', 'same-origin');

    expect(res.status).toBe(404);
  });

  test('a 1 MiB + 1 body is 413', async () => {
    const res = await post({ type: 'wire/request', id: 'big', file: abs('app.html'), text: 'x'.repeat(MAX_BODY) });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ ok: false, error: 'wire frame too large', code: 'too-large' });
  });

  // Free-form progress text is bounded at 4 KiB so a chatty handler cannot flood
  // observers' queues into eviction. Bytes, not characters.
  test('text over 4 KiB is truncated', async () => {
    const observer = await processStream('app.html');
    const sent = await post({ type: 'wire/status', id: 'r1', file: abs('app.html'), text: 'x'.repeat(5000) });

    expect(sent.status).toBe(200);
    const frame = envOf(await observer.next());
    expect(Buffer.byteLength(frame.text)).toBe(MAX_TEXT);
    expect(frame.text).toBe('x'.repeat(MAX_TEXT));
  });

  // W2's entry point, exercised here: a request that names a helper goes to the
  // host dispatcher and never to the exclusive handler slot, and the slot serves
  // only unnamed requests.
  test('with a named handler set, a helper request reaches it, not the handler slot', async () => {
    const calls = [];
    hub.setNamedRequestHandler(async (env, options) => { calls.push({ env, options }); });

    const rawHandler = await processStream('app.html', 'handler');
    const res = await post({ type: 'wire/request', id: 'r1', helper: 'search', text: 'find it' }, pageHeaders());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, delivered: 1, observers: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].env).toMatchObject({ type: 'wire/request', id: 'r1', file: 'app.html', helper: 'search', from: 'page' });
    expect(calls[0].options.file).toBe('app.html');
    expect(typeof calls[0].options.publish).toBe('function');
    expect(typeof calls[0].options.onCancel).toBe('function');

    // The handler's own stream saw no request frame: the dispatcher took it.
    expect(rawHandler.events).toEqual([]);
  });

  test("a named handler's published frames carry from: process", async () => {
    hub.setNamedRequestHandler(async (env, { publish }) => {
      publish({ type: 'wire/status', text: 'working' });
      publish({ type: 'wire/done' });
    });

    const observer = await processStream('app.html');
    await post({ type: 'wire/request', id: 'r1', helper: 'search' }, pageHeaders());

    const status = envOf(await observer.next());
    expect(status).toMatchObject({ v: 1, type: 'wire/status', id: 'r1', from: 'process', file: 'app.html', helper: 'search', text: 'working' });

    const done = envOf(await observer.next());
    expect(done).toMatchObject({ type: 'wire/done', from: 'process' });
  });

  test('a cancel for a named request calls the onCancel callback once', async () => {
    const cancelled = [];
    hub.setNamedRequestHandler(async (env, { onCancel }) => onCancel(env.id, () => cancelled.push(env.id)));

    await post({ type: 'wire/request', id: 'r1', helper: 'search' }, pageHeaders());

    const first = await post({ type: 'wire/cancel', id: 'r1', helper: 'search' }, pageHeaders());
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, delivered: 1, observers: 0 });
    expect(cancelled).toEqual(['r1']);

    await post({ type: 'wire/cancel', id: 'r1', helper: 'search' }, pageHeaders());
    expect(cancelled).toEqual(['r1']);
  });

  test('a thrown named handler publishes wire/error helper_failed', async () => {
    hub.setNamedRequestHandler(async () => { throw new Error('the dispatcher gave up'); });

    const observer = await processStream('app.html');
    const res = await post({ type: 'wire/request', id: 'r1', helper: 'search' }, pageHeaders());
    expect(res.status).toBe(200);

    const frame = envOf(await observer.next());
    expect(frame).toMatchObject({ type: 'wire/error', id: 'r1', from: 'process', text: 'the dispatcher gave up' });
    expect(frame.payload).toEqual({ source: 'host', code: 'helper_failed' });
  });

  // A page's first frame is a cursor: a named event that never reaches onmessage,
  // carrying the position it resumes from and sorting below every frame that
  // follows, so a stream that drops between the two resumes with the frame owed.
  test("a page's stream opens with a cursor whose id is positive and below every later frame", async () => {
    const stream = await processStream('app.html', null, { 'Sec-Fetch-Site': 'same-origin', 'Document-URL': documentUrl() });

    const cursor = await stream.next();
    expect(cursor.name).toBe('cursor');
    const cursorId = Number(cursor.id);
    expect(Number.isSafeInteger(cursorId)).toBe(true);
    expect(cursorId).toBeGreaterThan(0);
    expect(JSON.parse(cursor.data)).toEqual({ seq: cursorId });

    await post({ type: 'wire/done', id: 'r1', file: abs('app.html') });
    const frame = await stream.next();
    expect(Number(frame.id)).toBeGreaterThan(cursorId);
    expect(envOf(frame).type).toBe('wire/done');
  });

  // A process tailing the wire parses every data line as a frame and has no use
  // for a position it never presents, so it gets no cursor.
  test("a process's stream has no cursor frame", async () => {
    const stream = await processStream('app.html');

    await post({ type: 'wire/status', id: 'r1', file: abs('app.html'), text: 'working' });

    const first = await stream.next();
    expect(first.name).toBe('');
    expect(envOf(first)).toMatchObject({ type: 'wire/status', id: 'r1', from: 'process' });
  });

  // A 404 here is text/plain, never text/html: the CLI reads a text/html 404 as
  // "the recovery page holds this port" (wire_cli.go:515-536).
  test('unknown file answers 404 text/plain on subscribe', async () => {
    const stream = await subscribe(`file=${enc(path.join(os.tmpdir(), 'not-here.html'))}`);

    expect(stream.status).toBe(404);
    expect(stream.headers['content-type']).toMatch(/^text\/plain/);
    expect(stream.body()).toContain('Not Found');
  });

  test('unknown file answers 404 JSON on send', async () => {
    const res = await post({ type: 'wire/request', id: 'r1', file: path.join(os.tmpdir(), 'not-here.html') });

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({ ok: false, error: 'unknown file', msg: 'unknown file', code: 'not-found' });
  });

  // Containment and hidden/internal refusal happen first, as string work, so an
  // out-of-scope path is refused identically whether or not anything exists at it.
  test('a process path outside the root, hidden, or non-html is 404', async () => {
    const outside = await subscribe(`file=${enc(path.join(os.tmpdir(), 'other', 'page.html'))}`);
    expect(outside.status).toBe(404);

    const hidden = await subscribe(`file=${enc(abs('.hidden.html'))}`);
    expect(hidden.status).toBe(404);

    const notHtml = await subscribe(`file=${enc(abs('notes.txt'))}`);
    expect(notHtml.status).toBe(404);

    const relative = await subscribe(`file=${enc('app.html')}`);
    expect(relative.status).toBe(404);
  });

  test('/_/meta announces wire', async () => {
    const res = await request(server).get('/_/meta');

    expect(res.status).toBe(200);
    expect(res.body.extensions).toEqual(
      expect.arrayContaining(['sync', 'sync-worker', 'upload', 'wire'])
    );
  });

  // W1.4 removed the bus; no app mounts it, and the marker gate still 404s it.
  test('/_/bus/subscribe is 404', async () => {
    const res = await request(server).get('/_/bus/subscribe?channel=ok');

    expect(res.status).toBe(404);
  });

  // The routes act only on a `/_/wire/` request, so a user folder named `wire/`
  // — including one holding a file literally named `subscribe` — keeps being
  // served as a folder.
  test('a folder named wire/ is still served statically', async () => {
    const page = await request(server).get('/wire/page.html');
    expect(page.status).toBe(200);
    expect(page.text).toBe(PAGE);

    const bare = await request(server).get('/wire/subscribe');
    expect(bare.status).toBe(200);
    expect(String(bare.body)).toBe('a file, not a stream\n');
  });

  // W1.3. A handler takes a watch lease and a baseline backup, so an agent's write
  // to a document no tab has open still reaches the pages and is versioned. The
  // observer's own lease/poke behaviour is C2's; what these cases pin is that the
  // routes and the process lane call it, with the right file and at the right
  // moment (wire.go:732-790, :872-887).
  test('handler attach takes a baseline backup of an existing file', async () => {
    realObserver();

    const handler = await processStream('app.html', 'handler');
    expect(handler.status).toBe(200);

    // The version the user was looking at, taken before the handler can be asked
    // for anything: createApp resolves the attach BEFORE it flushes the headers.
    const versions = path.join(dir, '.hyperclay', 'versions', 'app.html');
    const names = await fs.readdir(versions);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.html$/);
    expect(await fs.readFile(path.join(versions, names[0]), 'utf8')).toBe(PAGE);
  });

  // An agent may be about to create the document it is answering for, and the
  // path resolver admits a file that does not exist yet, so attach must still
  // raise the lease. There is nothing to back up and no version to lose.
  test('handler attach on a missing file succeeds without a backup', async () => {
    const observer = realObserver();
    const lease = jest.spyOn(observer, 'lease');

    const handler = await processStream('new.html', 'handler');
    expect(handler.status).toBe(200);
    expect(lease).toHaveBeenCalledWith('new.html');

    await expect(fs.readdir(path.join(dir, '.hyperclay', 'versions', 'new.html')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('lease is raised on attach and released on close', async () => {
    const observer = realObserver();
    const lease = jest.spyOn(observer, 'lease');

    const handler = await processStream('app.html', 'handler');
    expect(lease).toHaveBeenCalledWith('app.html');
    expect(observer.leases).toBe(1);

    // A dropped handler must not hold the root open forever: main's observers map
    // releases the observer when the last lease does.
    const released = once(observer, 'lease-released');
    handler.close();
    const payload = await released;
    expect(payload).toEqual({ rel: 'app.html' });
    expect(observer.leases).toBe(0);
  });

  // The slot is exclusive, and the process that loses it never took the file: a
  // refused handler that raised a lease anyway would leave a watcher and a
  // baseline backup behind for a client that is not answering anything.
  test('a refused handler (409) leaves no lease', async () => {
    const observer = realObserver();
    const lease = jest.spyOn(observer, 'lease');

    const held = await processStream('app.html', 'handler');
    expect(held.status).toBe(200);
    expect(observer.leases).toBe(1);

    const refused = await processStream('app.html', 'handler');
    expect(refused.status).toBe(409);
    expect(lease).toHaveBeenCalledTimes(1);
    expect(observer.leases).toBe(1);

    const released = once(observer, 'lease-released');
    held.close();
    await released;
    expect(observer.leases).toBe(0);
  });

  // A process's terminal frame means the write is on disk and the page should see
  // it now rather than after the watcher's debounce. A page's frame is an answer
  // to a process that is doing the writing, and pages never write the file.
  test('a terminal frame from a process pokes the observer; from a page it does not', async () => {
    const observer = fakeObserver();

    await post({ type: 'wire/done', id: 'r1', file: abs('app.html') });
    expect(observer.poke).toHaveBeenCalledWith('app.html');

    observer.poke.mockClear();
    await post({ type: 'wire/done', id: 'r2', text: 'finished' }, pageHeaders());
    expect(observer.poke).not.toHaveBeenCalled();
  });
});
