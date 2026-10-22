// The page editor's Yjs merge state is not stored in the user's file. The disk and the
// version history hold only the clean file, and every read that judges or seeds a
// document composes the sidecar back on: the save's If-Match, the served page, the
// data API's ETag, the room seed and the watcher's own classification.

jest.mock('../../src/main/data-loss-guard', () => ({
  ...jest.requireActual('../../src/main/data-loss-guard'),
  runDataLossGuard: jest.fn().mockResolvedValue(null)
}));

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { splitPage, composePage, createRooms } = require('@panphora/clayjs/server/rooms');
const { createApp } = require('../../src/main/server.js');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { RootObserver } = require('../../src/main/root-observer');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { documentEtag } = require('../../src/main/spec-wire.js');
const formatHtml = require('../../src/main/format-html');
const { scopeTailwindLink } = require('../../src/main/utils/tailwind-scoping.js');
const { readPageState, pageStatePath } = require('../../src/main/page-state-store');
const { servedDocumentEtag, withoutInjectedDocumentEtag } = require('../helpers/served-metadata');

const FIXTURE = fsSync.readFileSync(path.join(__dirname, '../fixtures/ypage-template.html'), 'utf8');
const SEED = 'AAACQQMEAQAIQgALJwAoAQUAJwAoAIUkHGF0dHJzdGl0bGVsZXZlbHRmbG93YXR0cnNwMXRFAQEEBQIBBwEAAAEBAQACQQACQQEBBwB9AXcHaGVhZGluZ3YBAWJ3BXRpdGxldwlwYXJhZ3JhcGh2AQFidwJwMQA=';
// The same document with only the page tag's own text changed: the file part is
// byte-identical, so a save of it changes nothing but the merge state.
const FIXTURE_RESEEDED = FIXTURE.replace(SEED, `${SEED.slice(0, -4)}AAAA`);

const SPLIT = splitPage(FIXTURE);
const LOGICAL = composePage(SPLIT.file, SPLIT.state);

const NAME = 'page.html';
const PLAIN = '<!DOCTYPE html><html lang="en"><body><p>one</p></body></html>';

describe('a page document is stored clean and read composed', () => {
  let dir;
  let authority;
  let observer;
  let live;
  let changes;
  let server;
  let opened;

  const filePath = () => path.join(dir, NAME);
  const onDisk = () => fs.readFile(filePath(), 'utf8');

  const save = (html, headers = {}, name = NAME) => {
    const req = request(server)
      .post('/save')
      .set('Page-URL', `http://127.0.0.1:${server.address().port}/${name}`)
      .set('Content-Type', 'text/plain');
    for (const [key, value] of Object.entries(headers)) req.set(key, value);
    return req.send(html);
  };

  const getRaw = (name = NAME) => request(server).get(`/${name}`).buffer().parse((res, cb) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  const versionFiles = async () => {
    const versionsDir = path.join(dir, '.hyperclay', 'versions', 'page');
    const names = await fs.readdir(versionsDir).catch(() => []);
    return names.sort();
  };

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'page-state-save-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // The one room, with its opening seed recorded: that seed is what an editor
    // loads into a cold document.
    const core = createRooms({});
    opened = [];
    const rooms = {
      ...core,
      open(key, html, opts) {
        opened.push({ key, html });
        return core.open(key, html, opts);
      }
    };
    authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
    const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
    live = createRootLive(root);
    observer = new RootObserver(root, { live, localAuthority: authority });
    changes = [];
    observer.on('change', (event) => changes.push(event));
    jest.spyOn(live, 'notify');
    jest.spyOn(live, 'broadcast');
    server = await listenLoopback(createApp({
      root, live, observer, localAuthority: authority, devHooks: null, isKnownPath: null
    }));
    await fs.writeFile(filePath(), FIXTURE);
  });

  afterEach(async () => {
    await closeLoopback();
    await observer.stop();
    // The data-loss guard runs detached by design, so it can still be writing into
    // .hyperclay/guard after the response.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('the save stores the clean file and keeps the merge state beside it', async () => {
    const res = await save(FIXTURE);

    expect(res.status).toBe(200);
    const disk = await onDisk();
    expect(disk).not.toContain('merge="page"');
    expect(disk).toContain('merge="page.tools"');
    expect(disk).toContain('<article class="page"');
    expect(disk).toContain('data-page="1"');

    const state = await readPageState(dir, NAME);
    expect(state).toEqual({ v: 1, rev: SPLIT.state.rev, tag: SPLIT.state.tag });
    const raw = await fs.readFile(pageStatePath(dir, NAME), 'utf8');
    expect(JSON.parse(raw)).toEqual({ v: 1, rev: SPLIT.state.rev, tag: SPLIT.state.tag });

    // The save route formats the body and stamps the result. This fixture opts into
    // neither formatHtml nor a Tailwind link rewrite, so the formatted body is the
    // document as sent, and the stamp is over its logical form.
    expect(formatHtml(scopeTailwindLink(NAME, FIXTURE))).toBe(FIXTURE);
    expect(res.body.etag).toBe(documentEtag(LOGICAL));
  });

  test('a GET serves the composed page and stamps that same document', async () => {
    const saved = await save(FIXTURE);

    const res = await getRaw();

    expect(res.status).toBe(200);
    const served = res.body.toString('utf8');
    expect(served).toContain('merge="page"');
    expect(served).toContain('merge="page.tools"');
    expect(served).toContain('data-page="1"');
    expect(servedDocumentEtag(res.body)).toBe(saved.body.etag);
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(LOGICAL));
  });

  test('the stamp the save returns is the one its next If-Match is judged against', async () => {
    const first = await save(FIXTURE);

    const second = await save(FIXTURE, { 'If-Match': first.body.etag });

    expect(second.status).toBe(200);
    expect(second.body.etag).toBe(first.body.etag);
  });

  // The code editor is sent the clean file and saves it back the way it got it, so
  // the save carries no merge state at all. It is still the same document: the
  // state the sidecar holds stays, and the stamp stays the one it was given.
  test('a save of the clean file keeps the merge state it did not carry', async () => {
    const first = await save(FIXTURE);
    const clean = await onDisk();
    expect(clean).not.toContain('merge="page"');

    const second = await save(clean, { 'If-Match': first.body.etag });

    expect(second.status).toBe(200);
    expect(second.body.etag).toBe(first.body.etag);
    expect(await onDisk()).toBe(clean);
    const state = await readPageState(dir, NAME);
    expect(state.tag).toBe(SPLIT.state.tag);
    const served = await getRaw();
    expect(served.body.toString('utf8')).toContain('merge="page"');
  });

  test('no version file carries the merge state', async () => {
    await save(FIXTURE);

    const versions = await versionFiles();
    expect(versions.length).toBeGreaterThan(0);
    for (const name of versions) {
      const text = await fs.readFile(path.join(dir, '.hyperclay', 'versions', 'page', name), 'utf8');
      expect(text).not.toContain('merge="page"');
      expect(text).toContain('data-page="1"');
    }
  });

  test('a save that changes only the merge state writes no new version', async () => {
    await save(FIXTURE);
    const before = await versionFiles();
    expect(before.length).toBeGreaterThan(0);

    const res = await save(FIXTURE_RESEEDED);

    expect(res.status).toBe(200);
    expect(await versionFiles()).toEqual(before);
    const state = await readPageState(dir, NAME);
    expect(state.tag).toBe(splitPage(FIXTURE_RESEEDED).state.tag);
    expect(state.tag).not.toBe(SPLIT.state.tag);
  });

  test('the observer does not report our own clean write as an outside edit', async () => {
    await save(FIXTURE);
    changes.length = 0;
    live.notify.mockClear();

    await observer._raw('change', NAME);

    expect(changes).toEqual([{ rel: NAME, kind: 'self' }]);
    expect(live.notify).not.toHaveBeenCalled();
  });

  test('a room is seeded from the composed document', async () => {
    await save(FIXTURE);
    authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }, { owner: 'server' });
    const target = authority.bindTarget({
      rootId: 'root-a', logicalPath: NAME, canonicalPath: filePath(), origin: null, live
    });

    // A cold room load resolves its target the way the live lane does: the bound
    // target, which carries the root and the logical name the seed is composed with.
    const room = await authority.roomFor(target, async () => target);

    expect(room).toBeTruthy();
    const seeded = opened[opened.length - 1].html;
    expect(seeded).toContain('merge="page"');
    expect(seeded).toContain('data-page="1"');
  });

  test('a document that is not a page saves byte for byte', async () => {
    await fs.writeFile(path.join(dir, 'plain.html'), PLAIN);

    const res = await save(PLAIN, {}, 'plain.html');

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'plain.html'), 'utf8')).toBe(PLAIN);
    expect(res.body.etag).toBe(documentEtag(PLAIN));
    await expect(fs.readdir(path.join(dir, '.hyperclay', 'page-state'))).rejects.toMatchObject({ code: 'ENOENT' });
    const served = await getRaw('plain.html');
    expect(withoutInjectedDocumentEtag(served.body).toString('utf8')).toBe(PLAIN);
    expect(servedDocumentEtag(served.body)).toBe(documentEtag(PLAIN));
  });
});
