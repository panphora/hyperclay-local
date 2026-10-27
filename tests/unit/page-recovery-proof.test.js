// Document 12 Step 4b: the conditional page-state read. A client that accepted one set of
// document bytes asks this host which page state it stored for exactly those bytes, and
// which page lineage (generation) that state belongs to. Only with that answer can it
// prove a checkpoint covers its journaled edits and clear them.
//
// The two things this file is as much about as the happy path: the read is conditional on
// the stamp of the bytes on disk, so a state is never handed to a client holding different
// bytes; and a generation continues only across writes that descend from the record for
// the file on disk, so a file replaced from outside (or a sidecar written before this
// field existed) is never served as proven state.

jest.mock('../../src/main/data-loss-guard', () => ({
  ...jest.requireActual('../../src/main/data-loss-guard'),
  runDataLossGuard: jest.fn().mockResolvedValue(null)
}));

const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('upath');
const os = require('os');
const crypto = require('crypto');
const request = require('supertest');

const { splitPage, createRooms } = require('@panphora/clayjs/server/rooms');
const { createApp } = require('../../src/main/server.js');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { RootObserver } = require('../../src/main/root-observer');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { createRootLive } = require('../../src/main/utils/root-live');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { readPageState, readPageRecord, writePageState, pageStatePath } = require('../../src/main/page-state-store');

const FIXTURE = fsSync.readFileSync(path.join(__dirname, '../fixtures/ypage-template.html'), 'utf8');
const NAME = 'page.html';
const REV = '093360993130d818';
const NEWER_REV = 'newer-rev';
const SEED = /"seed":"([^"]+)"/.exec(FIXTURE)[1];
const GENERATION = /^[0-9a-f]{32}$/;

// A page document with a new article revision, new article text and a new merge state, the
// way a page editor (or a code view) sends one: both halves of the document move, so the
// save is a new page revision rather than a re-seed of the old one.
const page = (rev, text) => FIXTURE
  .replace(`data-rev="${REV}"`, `data-rev="${rev}"`)
  .replace('<p data-id="p1"></p>', `<p data-id="p1">${text}</p>`)
  .replace(SEED, `${SEED.slice(0, -4)}AAAA`);

const T1 = splitPage(FIXTURE).state.tag;
const NEWER = page(NEWER_REV, 'edited');
const T2 = splitPage(NEWER).state.tag;

describe('the conditional page-state read', () => {
  let dir;
  let apps;

  const startApp = async () => {
    const core = createRooms({});
    const authority = createLocalAuthority({ rooms: core, withDocument: withDocumentWrite });
    const root = { id: `page-recovery-root-${apps.length}`, kind: 'personal', path: dir, port: 0 };
    const live = createRootLive(root);
    const observer = new RootObserver(root, { live, localAuthority: authority });
    const server = await listenLoopback(createApp({
      root, live, observer, localAuthority: authority, devHooks: null, isKnownPath: null
    }));
    const app = { server, observer };
    apps.push(app);
    return app;
  };

  const documentUrl = (app) => `http://127.0.0.1:${app.server.address().port}/${NAME}`;

  const save = (app, html, headers = {}) => {
    const req = request(app.server)
      .post('/save')
      .set('Document-URL', documentUrl(app))
      .set('Content-Type', 'text/plain');
    for (const [key, value] of Object.entries(headers)) req.set(key, value);
    return req.send(html);
  };

  const meta = (app) => request(app.server).get('/_/meta').set('Document-URL', documentUrl(app));

  const pageState = (app, headers = {}) => {
    let req = request(app.server).get('/_/page-state').set('Document-URL', documentUrl(app));
    for (const [key, value] of Object.entries(headers)) req.set(key, value);
    return req;
  };

  const etagOf = async (app) => (await meta(app)).body.document.etag;

  const sidecar = async () => JSON.parse(await fs.readFile(pageStatePath(dir, NAME), 'utf8'));

  beforeEach(async () => {
    dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'page-recovery-proof-'))));
    apps = [];
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await fs.writeFile(path.join(dir, NAME), FIXTURE);
  });

  afterEach(async () => {
    await closeLoopback();
    for (const app of apps) await app.observer.stop();
    // The data-loss guard runs detached by design, so it can still be writing into
    // .hyperclay/guard after the response.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('generation survives a later save and a fresh process', async () => {
    const app = await startApp();
    expect((await save(app, FIXTURE)).status).toBe(200);
    expect((await save(app, NEWER)).status).toBe(200);
    expect(T2).not.toBe(T1);

    // The new record descends from the one for the file it replaced, so it keeps that
    // page's lineage, and so does the record it keeps beside it.
    const stored = await sidecar();
    expect(stored.rev).toBe(NEWER_REV);
    expect(stored.tag).toBe(T2);
    expect(stored.generation).toMatch(GENERATION);
    expect(stored.prev).toMatchObject({ rev: REV, tag: T1, generation: stored.generation });

    // Nothing about the answer is held in this process: a fresh app on the same root
    // reads the same lineage out of the sidecar.
    await closeLoopback();
    await app.observer.stop();
    const fresh = await startApp();
    const etag = await etagOf(fresh);

    const res = await pageState(fresh, { 'If-Match': etag });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version: 1,
      documentId: null,
      generation: stored.generation,
      etag,
      stateHash: crypto.createHash('sha256').update(T2, 'utf8').digest('hex'),
      tag: T2
    });
    expect(res.headers.etag).toBe(etag);
  });

  test('the read is conditional on the current etag', async () => {
    const app = await startApp();
    expect((await save(app, FIXTURE)).status).toBe(200);
    const etag = await etagOf(app);

    const stale = await pageState(app, { 'If-Match': 'not-the-stamp' });
    expect(stale.status).toBe(412);
    expect(stale.body).toEqual({ error: 'page state unavailable', code: 'etag-mismatch', etag });
    expect(stale.headers.etag).toBe(etag);

    // `*` and a list name no single revision, so neither can prove which bytes a state
    // belongs to: this read refuses both rather than guessing.
    const star = await pageState(app, { 'If-Match': '*' });
    expect(star.status).toBe(412);
    expect(star.body.code).toBe('etag-mismatch');
    expect(star.body.etag).toBe(etag);

    const list = await pageState(app, { 'If-Match': `${etag}, "another-stamp"` });
    expect(list.status).toBe(412);
    expect(list.body.code).toBe('etag-mismatch');

    const missing = await pageState(app);
    expect(missing.status).toBe(428);
    expect(missing.body.code).toBe('precondition-required');

    const ok = await pageState(app, { 'If-Match': etag });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      version: 1,
      documentId: null,
      generation: (await sidecar()).generation,
      etag,
      stateHash: crypto.createHash('sha256').update(T1, 'utf8').digest('hex'),
      tag: T1
    });
    expect(ok.headers.etag).toBe(etag);
  });

  test('a file replaced from outside starts a new generation', async () => {
    const app = await startApp();
    expect((await save(app, FIXTURE)).status).toBe(200);
    const before = await sidecar();
    expect(before.generation).toMatch(GENERATION);

    // Somebody replaced the document outside this app: a new article revision, and no
    // record for it in the sidecar.
    const outside = page('outside-rev', 'replaced');
    await fs.writeFile(path.join(dir, NAME), outside);

    const unknown = await pageState(app, { 'If-Match': await etagOf(app) });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('no-page-state');

    expect((await save(app, outside)).status).toBe(200);
    const after = await sidecar();
    expect(after.rev).toBe('outside-rev');
    expect(after.generation).toMatch(GENERATION);
    expect(after.generation).not.toBe(before.generation);

    const proven = await pageState(app, { 'If-Match': await etagOf(app) });
    expect(proven.status).toBe(200);
    expect(proven.body.generation).toBe(after.generation);
    expect(proven.body.tag).toBe(splitPage(outside).state.tag);
  });

  test('an interrupted write keeps the record for the file on disk', async () => {
    const app = await startApp();
    expect((await save(app, FIXTURE)).status).toBe(200);
    const before = await sidecar();
    const diskEtag = await etagOf(app);

    // The crash between the sidecar and the file: a record for a revision the file never
    // received. The file on disk still has its own record, and that is what is served.
    const interrupted = splitPage(page('interrupted-rev', 'never landed')).state;
    expect(interrupted.tag).not.toBe(before.tag);
    await writePageState(dir, NAME, interrupted);

    const still = await pageState(app, { 'If-Match': diskEtag });
    expect(still.status).toBe(200);
    expect(still.body.tag).toBe(before.tag);
    expect(still.body.generation).toBe(before.generation);

    // The write lands: the file now carries the new article, and the record already
    // waiting for it is the one the read answers.
    await fs.writeFile(path.join(dir, NAME), splitPage(page('interrupted-rev', 'never landed')).file);

    const landed = await pageState(app, { 'If-Match': await etagOf(app) });
    expect(landed.status).toBe(200);
    expect(landed.body.tag).toBe(interrupted.tag);
    expect(landed.body.generation).toBe(before.generation);
  });

  test('an old sidecar without generation is never served as proven state', async () => {
    const app = await startApp();

    // A record written before this host kept generations: the same fields, no lineage.
    const file = pageStatePath(dir, NAME);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ v: 1, rev: REV, tag: T1 }));

    const etag = await etagOf(app);
    const res = await pageState(app, { 'If-Match': etag });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('no-page-state');
    expect(res.body.etag).toBe(etag);
    await expect(readPageRecord(dir, NAME, REV)).resolves.toBeNull();

    // Composition is unchanged: the record is still this document's merge state, so the
    // page still serves (and stamps) as the composed document.
    await expect(readPageState(dir, NAME)).resolves.toEqual({ v: 1, rev: REV, tag: T1 });
    expect(await etagOf(app)).toBe(etag);
  });

  test('meta names the resource and keeps the capability off', async () => {
    const app = await startApp();
    expect((await save(app, FIXTURE)).status).toBe(200);

    const res = await meta(app);

    expect(res.body.document.pageState).toEqual({ href: '/_/page-state' });
    expect(res.body.extensions).not.toContain('page-recovery-v1');
  });
});
