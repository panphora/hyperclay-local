// End-to-end test for POST /_/api/<file> announcing its write to open tabs the
// way an external disk change does: the real Express app, the real
// hyper-html-api engine and the real commitDocument, nothing mocked. Run via
// `node --test` (npm run test:node), for the same reason
// data-api-write-review.node-test.js is: jest's vm sandbox cannot run the
// engine's dynamic ESM import.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const os = require('node:os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { documentEtag } = require('../../src/main/spec-wire.js');
const { RootObserver } = require('../../src/main/root-observer.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const SITE =
  '<!DOCTYPE html>\r\n' +
  '<html><head><script type="application/json" data-rules-name="api" data-rules-version="1">{title:"h1",items:"li[]"}</script></head><body>\r\n' +
  "<h1 class='x'>Hello</h1>\r\n" +
  '<ul><li>A</li><li>B</li></ul>\r\n' +
  '<p>&copy; keep</p>\r\n' +
  '</body></html>';

const WRITTEN = SITE.replace(`<h1 class='x'>Hello</h1>`, '<h1 class="x">World</h1>');

// chokidar's awaitWriteFinish threshold plus its poll interval, with room to
// spare: past this point a write the watcher was going to announce has been
// announced.
const SETTLE_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for the watcher');
}

// The served root's live transport, observed rather than mocked: the route and
// the write path call the same functions, so every frame is recorded here with
// no SSE client to sequence. `wasBrowserSave` keeps its real meaning for the
// observer — a write this host made is still one.
function createSpyLive() {
  const marked = new Set();
  const calls = { notify: [], broadcast: [], marks: [] };
  return {
    calls,
    key: (rel) => rel,
    subscribe: () => {},
    unsubscribe: () => {},
    notify: (rel, payload, opts) => { calls.notify.push({ rel, payload, opts }); },
    broadcast: (rel, payload, opts) => { calls.broadcast.push({ rel, payload, opts }); },
    markBrowserSave: (rel) => { marked.add(rel); calls.marks.push(rel); },
    wasBrowserSave: (rel) => marked.has(rel),
  };
}

// The frames this test counts: one notify per write, told apart from the
// data-loss guard's own notifications, which carry no sender.
const externalNotifies = (live, rel) => live.calls.notify.filter(
  (call) => call.rel === rel && call.payload?.data?.kind === 'external-change'
);

const broadcastsOf = (live, rel) => live.calls.broadcast.filter((call) => call.rel === rel);

// A served folder with one document in it, the app on its own live transport.
async function withSite(name, bytes, fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'api-announce-')));
  const file = path.join(dir, name);
  await fs.writeFile(file, bytes);
  const live = createSpyLive();
  const root = { id: `api-announce-${path.basename(dir)}`, kind: 'personal', path: dir, port: 0 };
  const server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null, live }));
  try {
    return await fn({ dir, file, server, live, url: `/_/api/${name}` });
  } finally {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

const post = (server, url, body) =>
  request(server).post(url).set('Content-Type', 'application/json').send(body);

const save = (server, name, html, headers = {}) => {
  const req = request(server)
    .post('/save')
    .set('Document-URL', `http://localhost:4321/${name}`)
    .set('Content-Type', 'text/plain');
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send(html);
};

test('an API write announces one external-change notify and one saved-lane broadcast', async () => {
  await withSite('site.html', SITE, async ({ file, server, live, url }) => {
    const res = await post(server, url, JSON.stringify({ title: 'World' }));
    assert.equal(res.status, 200);

    const disk = await fs.readFile(file);
    assert.equal(disk.toString('utf8'), WRITTEN, 'only the heading changed');

    const notified = externalNotifies(live, 'site.html');
    assert.equal(notified.length, 1, 'exactly one external-change notify for the file');
    assert.deepEqual(notified[0].payload, {
      msgType: 'warning',
      msg: 'site.html was updated through the data API',
      action: 'reload',
      data: { kind: 'external-change', html: WRITTEN, sender: 'data-api', etag: documentEtag(disk) },
    });
    assert.equal(notified[0].opts, undefined, 'the notify rides the default edit-mode lane');

    const broadcasts = broadcastsOf(live, 'site.html');
    assert.equal(broadcasts.length, 1, 'exactly one broadcast for the file');
    assert.deepEqual(broadcasts[0].payload, { html: WRITTEN, sender: 'data-api' });
    assert.deepEqual(broadcasts[0].opts, { lane: 'saved' });

    assert.deepEqual(live.calls.marks, ['site.html'], 'the watcher is told this host made the write');
  });
});

test('an API write makes a stale-If-Match save answer 412 with no tab to blame', async () => {
  await withSite('site.html', SITE, async ({ file, server, url }) => {
    const before = documentEtag(await fs.readFile(file));

    const written = await post(server, url, JSON.stringify({ title: 'World' }));
    assert.equal(written.status, 200);

    const res = await save(server, 'site.html', WRITTEN.replace('World', 'Third'), { 'If-Match': before });

    assert.equal(res.status, 412);
    assert.equal(res.body.code, 'conflict');
    assert.equal(res.body.changedBy, undefined, 'a data API write is not another tab');
    assert.equal(res.body.etag, documentEtag(await fs.readFile(file)));
    assert.equal((await fs.readFile(file, 'utf8')), WRITTEN, 'the refusal wrote nothing');
  });
});

test('a stale stamp after an ordinary save still names another tab', async () => {
  await withSite('site.html', SITE, async ({ file, server }) => {
    const before = documentEtag(await fs.readFile(file));

    const first = await save(server, 'site.html', WRITTEN);
    assert.equal(first.status, 200);
    assert.equal(first.body.etag, documentEtag(await fs.readFile(file)));

    const res = await save(server, 'site.html', SITE, { 'If-Match': before });

    assert.equal(res.status, 412);
    assert.equal(res.body.code, 'conflict');
    assert.equal(res.body.changedBy, 'another-tab', 'a save this host made is still a tab');
  });
});

test('the watcher does not announce the API write a second time', async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'api-announce-watch-')));
  const file = path.join(dir, 'site.html');
  await fs.writeFile(file, SITE);

  const live = createSpyLive();
  const root = { id: `api-announce-watch-${path.basename(dir)}`, kind: 'personal', path: dir, port: 0 };
  // The real observer over the real folder, so the write below has to get past
  // the watcher's own suppression rather than being asserted around it.
  const observer = new RootObserver(root, { live });
  const changes = [];
  observer.on('change', (event) => changes.push(event));
  observer.start();
  await new Promise((resolve) => observer.watcher.once('ready', resolve));
  const server = await listenLoopback(createApp({ root, devHooks: null, isKnownPath: null, live, observer }));

  try {
    const res = await post(server, '/_/api/site.html', JSON.stringify({ title: 'World' }));
    assert.equal(res.status, 200);

    // The watcher has to have seen the write and called it ours, or the silence
    // below proves nothing.
    await waitFor(() => changes.length === 1);
    assert.equal(changes[0].kind, 'self');
    assert.equal((await fs.readFile(file, 'utf8')), WRITTEN);

    await sleep(SETTLE_MS);

    assert.deepEqual(changes, [{ rel: 'site.html', kind: 'self' }], 'no external change was raised');
    const notified = externalNotifies(live, 'site.html');
    assert.equal(notified.length, 1, 'only the API write announced it');
    assert.equal(notified[0].payload.data.sender, 'data-api');
  } finally {
    await closeLoopback();
    await observer.stop();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
