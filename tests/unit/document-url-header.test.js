// Spec §3: a request names the document it targets with `Document-URL`. `Page-URL` is
// the pre-spec spelling, kept forever because stored documents hardcode it in inline
// fetch() calls no library update can reach.
//
// Every route is checked, because they did not grow this together: /_/meta, /_/upload
// and the sync relay each read the pair separately, and /_/save read `Page-URL` alone.
// So a client following the published spec was answered "Document-URL header required"
// on the one route the whole protocol is about, and the host test page found it on its
// first run.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');

const DOC = '<!DOCTYPE html><html lang="en"><body><p>doc</p></body></html>';
const HREF = 'http://localhost:4321/index.html';

describe('Document-URL names the target document on every route', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dochdr-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), DOC);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const saveWith = (header) => request(app)
    .post('/save')
    .set(header, HREF)
    .set('Content-Type', 'text/plain')
    .send('<!DOCTYPE html><html lang="en"><body><p>saved</p></body></html>');

  test('a save names its document with Document-URL', async () => {
    const res = await saveWith('Document-URL');

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toContain('saved');
  });

  test('a save still names it with the pre-spec Page-URL', async () => {
    const res = await saveWith('Page-URL');

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toContain('saved');
  });

  // Named, rather than left to whichever the router happened to read first: the two
  // headers can disagree, and a client migrating from one to the other sends both.
  test('Document-URL wins when both are sent', async () => {
    await fs.writeFile(path.join(dir, 'other.html'), DOC);

    const res = await request(app)
      .post('/save')
      .set('Document-URL', 'http://localhost:4321/other.html')
      .set('Page-URL', HREF)
      .set('Content-Type', 'text/plain')
      .send('<!DOCTYPE html><html lang="en"><body><p>into other</p></body></html>');

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'other.html'), 'utf8')).toContain('into other');
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).not.toContain('into other');
  });

  test('a save naming no document at all is refused', async () => {
    const res = await request(app)
      .post('/save')
      .set('Content-Type', 'text/plain')
      .send(DOC);

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/Document-URL/);
  });

  test('discovery reads Document-URL', async () => {
    const res = await request(app).get('/_/meta').set('Document-URL', HREF);
    expect(res.body.document).toBeDefined();
  });

  test('discovery still reads Page-URL', async () => {
    const res = await request(app).get('/_/meta').set('Page-URL', HREF);
    expect(res.body.document).toBeDefined();
  });

  test('the sync relay reads Document-URL', async () => {
    const res = await request(app)
      .post('/sync')
      .set('Document-URL', HREF)
      .send({ snapshot: DOC, sender: 'tab-1' });

    expect(res.status).toBe(200);
  });

  test('the sync relay still reads Page-URL', async () => {
    const res = await request(app)
      .post('/sync')
      .set('Page-URL', HREF)
      .send({ snapshot: DOC, sender: 'tab-1' });

    expect(res.status).toBe(200);
  });

  test('an upload reads Document-URL', async () => {
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Document-URL', HREF)
      .attach('file', Buffer.from('hello'), 'hello.txt');

    expect(res.status).toBe(200);
  });

  test('an upload still reads Page-URL', async () => {
    const res = await request(app)
      .post('/_/upload')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Page-URL', HREF)
      .attach('file', Buffer.from('hello'), 'hello.txt');

    expect(res.status).toBe(200);
  });
});
