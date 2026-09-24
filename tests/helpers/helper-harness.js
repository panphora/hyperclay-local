// A page-driven helper request, end to end: a temp root with one document in
// it, createApp in its ctx form with a fake `approve` and `ctx.helpers`, the
// server bound to 127.0.0.1 (see ./loopback.js for why never a wildcard), and a
// page's own EventSource and fetch on top of the real wire routes (CONTRACTS
// §11). The two W2.3 node suites share it: one approves a program the user
// picks, the other drives the built-in ai-edit helper.
//
// Everything this module opens — streams, server, temp folder, environment
// values — is closed by the time withHelperApp() resolves, so a suite leaves
// nothing running.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../../src/main/server.js');
const { RootServerPool } = require('../../src/main/root-servers.js');
const { listenLoopback } = require('./loopback');

// A document that declares the helpers it names, in the head, the way the
// declaration scan reads them.
function documentHTML({ helpers = ['search'], body = '<p>hello</p>' } = {}) {
  const meta = helpers.map((name) => `<meta name="htmlclay-helper" content="${name}">`).join('\n');
  return `<!DOCTYPE html>\n<html>\n<head>\n${meta}\n</head>\n<body>${body}</body>\n</html>\n`;
}

// The program a user picks in the approval dialog. It is a structured helper:
// reports the request envelope it received, and rewrites the document when the
// test asks for it, which is how the edit-mode case reads the baseline backup.
function writeProgram(dir) {
  const file = path.join(dir, 'search-program.js');
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('fs');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (process.env.HTMLCLAY_TEST_PID_FILE) fs.writeFileSync(process.env.HTMLCLAY_TEST_PID_FILE, String(process.pid));
  if (process.env.HTMLCLAY_TEST_REWRITE_DOC === '1' && process.env.HTMLCLAY_WIRE_FILE) {
    fs.writeFileSync(process.env.HTMLCLAY_WIRE_FILE, 'rewritten by the program');
  }
  process.stdout.write(JSON.stringify({
    type: 'status', text: 'Scanning', progress: { completed: 1, total: 2, unit: 'files' },
  }) + '\\n');
  const answer = () => process.stdout.write(JSON.stringify({
    type: 'result', value: { cwd: process.cwd(), envelope: JSON.parse(input) },
  }) + '\\n');
  if (process.env.HTMLCLAY_TEST_SLEEP === '1') {
    setInterval(() => {}, 1000);
    return;
  }
  if (process.env.HTMLCLAY_TEST_DELAY_MS) {
    setTimeout(answer, Number(process.env.HTMLCLAY_TEST_DELAY_MS));
    return;
  }
  answer();
});
`);
  fs.chmodSync(file, 0o755);
  return file;
}

// One SSE event, or null for a part that is only a comment (`: keepalive`).
function parseEvent(part) {
  const event = { name: '', id: '', data: '' };
  for (const line of part.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) event.name = line.slice(7);
    else if (line.startsWith('id: ')) event.id = line.slice(4);
    else if (line.startsWith('data: ')) event.data += (event.data ? '\n' : '') + line.slice(6);
  }
  return event;
}

// Raw http.get, so the bytes a test reads are the bytes a client reads. Every
// envelope is kept in `frames` as well as queued, because a test that has to
// prove an ABSENCE can only look at what already arrived.
function openStream({ port, target, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, headers }, (res) => {
      res.setEncoding('utf8');
      const frames = [];
      const queue = [];
      const waiters = [];
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const event = parseEvent(part);
          if (event.data === '') continue;
          const envelope = JSON.parse(event.data);
          frames.push(envelope);
          if (waiters.length) waiters.shift()(envelope);
          else queue.push(envelope);
        }
      });
      resolve({
        status: res.statusCode,
        headers: res.headers,
        frames,
        next(timeoutMs = 10000) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((resolved, rejected) => {
            const timer = setTimeout(() => rejected(new Error('no frame arrived')), timeoutMs);
            waiters.push((envelope) => { clearTimeout(timer); resolved(envelope); });
          });
        },
        close() { req.destroy(); },
      });
    });
    req.on('error', reject);
  });
}

// The ctx.helpers the dispatcher reads: settings the test owns, a fake approval
// that records who was asked and answers from `options`, and a fake ai-edit.
function fakeHelpers(state, options, account) {
  const aiEdit = options.aiEdit || {};
  const enabled = aiEdit.enabled;
  return {
    rootAccount: () => account,
    settings: () => state.settings,
    saveSettings: () => { state.saves += 1; },
    approve: async (info) => {
      state.approvals.push(info);
      if (options.approve) return options.approve(info, state);
      return { choice: 'allow', programPath: state.program };
    },
    aiEdit: {
      enabled: () => (typeof enabled === 'function' ? enabled() : enabled ?? true),
      run: aiEdit.run || (async () => ({ html: '<p>edited</p>', model: 'mock', stopReason: 'end_turn' })),
    },
  };
}

// The page side: the headers a browser attests, its subscription, and the POSTs
// it makes. A process attaching as the file's handler sends none of them.
function pageClient({ port, documentUrl, registry = null }) {
  const origin = `http://127.0.0.1:${port}`;
  const headers = {
    'Sec-Fetch-Site': 'same-origin',
    Origin: origin,
    'Document-URL': documentUrl,
  };
  const streams = registry || [];
  const open = async (target, extra) => {
    const stream = await openStream({ port, target, headers: extra });
    streams.push(stream);
    return stream;
  };
  return {
    origin,
    documentUrl,
    headers,
    subscribe: () => open('/_/wire/subscribe', headers),
    attachHandler: (file, mode = 'raw') => open(`/_/wire/subscribe?file=${encodeURIComponent(file)}&role=handler&mode=${mode}`, {}),
    async send(body) {
      const res = await fetch(`${origin}/_/wire/send`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, reply: await res.json() };
    },
    forDocument: (url) => pageClient({ port, documentUrl: url, registry: streams }),
    close() { for (const stream of streams) stream.close(); },
  };
}

// Frames for one request id, in order, up to and including its terminal frame.
async function awaitRequest(stream, id, timeoutMs = 15000) {
  const frames = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`no terminal frame for ${id}; saw ${types(frames)}`);
    let envelope;
    try {
      envelope = await stream.next(remaining);
    } catch {
      throw new Error(`no terminal frame for ${id}; saw ${types(frames)}`);
    }
    if (envelope.id !== id) continue;
    frames.push(envelope);
    if (envelope.type === 'wire/done' || envelope.type === 'wire/error') return frames;
  }
}

// Frames for several ids at once, up to and including each one's terminal
// frame: two requests in flight interleave, so a single-id reader would throw
// the other one's frames away.
async function awaitRequests(stream, ids, timeoutMs = 15000) {
  const wanted = new Set(ids);
  const collected = new Map(ids.map((id) => [id, []]));
  const deadline = Date.now() + timeoutMs;
  while (wanted.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`no terminal frame for ${[...wanted].join(', ')}`);
    let envelope;
    try {
      envelope = await stream.next(remaining);
    } catch {
      throw new Error(`no terminal frame for ${[...wanted].join(', ')}`);
    }
    if (!collected.has(envelope.id)) continue;
    collected.get(envelope.id).push(envelope);
    if (envelope.type === 'wire/done' || envelope.type === 'wire/error') wanted.delete(envelope.id);
  }
  return collected;
}

// The next frame matching `match`, or a rejection naming everything it saw.
async function awaitFrame(stream, match, timeoutMs = 15000) {
  const seen = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`no frame matched; saw ${types(seen)}`);
    let envelope;
    try {
      envelope = await stream.next(remaining);
    } catch {
      throw new Error(`no frame matched; saw ${types(seen)}`);
    }
    seen.push(envelope);
    if (match(envelope)) return envelope;
  }
}

function types(frames) {
  return frames.map((frame) => `${frame.type || '?'}:${frame.id || '?'}`).join(', ') || 'nothing';
}

async function withHelperApp(options, fn) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'helper-app-')));
  const docPath = path.join(dir, 'app.html');
  await fsp.writeFile(docPath, options.html ?? documentHTML());
  const program = writeProgram(dir);
  const state = {
    dir,
    docPath,
    program,
    settings: options.settings || {},
    approvals: [],
    saves: 0,
  };
  if (options.seed) options.seed(state);

  const account = options.account || { accountId: null, teamName: null };
  const ctx = {
    root: { id: 'legacy', kind: options.kind || 'personal', path: dir, port: 0 },
    helpers: fakeHelpers(state, options, account),
  };

  const app = createApp(ctx);
  const server = await listenLoopback(app);
  ctx.root.port = server.address().port;
  const page = pageClient({
    port: ctx.root.port,
    documentUrl: `http://127.0.0.1:${ctx.root.port}/app.html`,
  });

  const values = typeof options.env === 'function' ? options.env(state) : options.env || {};
  const applied = Object.keys(values);
  for (const key of applied) process.env[key] = values[key];
  // `saves` and `approvals` are read through getters: they change while the
  // app runs, and a copy taken here would still read zero afterwards.
  const harness = {
    dir,
    docPath,
    program,
    settings: state.settings,
    app,
    server,
    page,
    docUrl: page.documentUrl,
    get approvals() { return state.approvals; },
    get saves() { return state.saves; },
  };
  try {
    return await fn(harness);
  } finally {
    for (const key of applied) delete process.env[key];
    page.close();
    app.locals.wireHub.shutdown();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// A free port the kernel hands out and is about to have back: the root server
// is then the only listener on it (see ./loopback.js for why never a wildcard).
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// The same page-driven request through C1's pool and root server instead of a
// bare createApp, which is the seam main.js supplies with helpersFor(root): a
// case can see what a folder server that stops does to its helper children.
async function withHelperRootServer(options, fn) {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'helper-root-')));
  const docPath = path.join(dir, 'app.html');
  await fsp.writeFile(docPath, options.html ?? documentHTML());
  const program = writeProgram(dir);
  const state = {
    dir,
    docPath,
    program,
    settings: options.settings || {},
    approvals: [],
    saves: 0,
  };
  if (options.seed) options.seed(state);

  const account = options.account || { accountId: null, teamName: null };
  const root = { id: 'helper-root', kind: options.kind || 'personal', path: dir, port: await freePort() };
  const helpers = fakeHelpers(state, options, account);
  const pool = new RootServerPool({ devHooks: null, isKnownPath: null, helpersFor: () => helpers });
  await pool.sync([root], { enabled: true });
  const page = pageClient({
    port: root.port,
    documentUrl: `http://127.0.0.1:${root.port}/app.html`,
  });

  const values = typeof options.env === 'function' ? options.env(state) : options.env || {};
  const applied = Object.keys(values);
  for (const key of applied) process.env[key] = values[key];
  const harness = {
    dir,
    docPath,
    program,
    settings: state.settings,
    pool,
    page,
    docUrl: page.documentUrl,
    get approvals() { return state.approvals; },
    get saves() { return state.saves; },
  };
  try {
    return await fn(harness);
  } finally {
    for (const key of applied) delete process.env[key];
    page.close();
    await pool.stopAll();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

module.exports = {
  documentHTML,
  awaitRequest,
  awaitRequests,
  awaitFrame,
  withHelperApp,
  withHelperRootServer,
};
