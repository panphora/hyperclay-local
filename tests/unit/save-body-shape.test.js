const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp, getAndClearSnapshot, startServer, stopServer } = require('../../src/main/server.js');

// Spec §3: /_/save takes the document as text, and this route has exactly one body
// shape. The route reads EVERY content type as text so a JSON body can be refused
// with a real message instead of arriving as an unparsed blank — which means the
// type matcher no longer rejects anything, and the shape check below is the only
// thing between a malformed request and the file.

const ORIGINAL = '<html><body>original</body></html>';

async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('POST /save accepts exactly one body shape', () => {
  let dir;
  let app;

  const post = (contentType, body) => request(app)
    .post('/save')
    .set('Host', 'localhost')
    .set('Page-URL', 'http://localhost/index.html')
    .set('Content-Type', contentType)
    .send(body);

  const onDisk = () => fs.readFile(path.join(dir, 'index.html'), 'utf8');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'shape-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), ORIGINAL);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup(dir);
  });

  it('writes a text document', async () => {
    const res = await post('text/plain', '<html><body>written</body></html>');
    expect(res.status).toBe(200);
    expect(await onDisk()).toContain('written');
  });

  // The old envelope. Refused by content type rather than by whether it parses, so
  // the rule is one a client can rely on.
  it.each([
    ['application/json', '{"content":"<html><body>x</body></html>"}'],
    ['application/json; charset=utf-8', '{"content":"<html><body>x</body></html>"}'],
    ['application/hal+json', '{"content":"<html><body>x</body></html>"}'],
    ['application/json', '{not json'],
  ])('refuses a JSON body with 415: %s', async (contentType, body) => {
    const res = await post(contentType, body);
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-type');
    expect(await onDisk()).toBe(ORIGINAL);
  });

  // The regression this file exists for. Every content type now parses as text, so
  // without a shape check this answered 200 and left the form body in the file.
  it.each([
    ['application/x-www-form-urlencoded', 'a=<html>junk</html>'],
    ['text/plain', 'just some words'],
    ['text/plain', '<p>a fragment, not a document</p>'],
    ['text/plain', ''],
  ])('refuses a body that is not a whole document: %s / %s', async (contentType, body) => {
    const res = await post(contentType, body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('invalid-document');
    expect(await onDisk()).toBe(ORIGINAL);
  });

  // hasHtmlRoot scans for a real top-level <html> element, so junk that merely
  // mentions the characters '<html' does not get through.
  it('a mention of <html inside junk is not a document', async () => {
    const res = await post('text/plain', 'see <html> for details');
    expect(res.status).toBe(422);
    expect(await onDisk()).toBe(ORIGINAL);
  });
});

describe('the pending-snapshot map does not outlive its folder', () => {
  let dirA;
  let dirB;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    dirA = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-a-')));
    dirB = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-b-')));
    await fs.writeFile(path.join(dirA, 'index.html'), '<html><body>A</body></html>');
    await fs.writeFile(path.join(dirB, 'index.html'), '<html><body>B</body></html>');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup(dirA);
    await cleanup(dirB);
  });

  // Entries are keyed by a path relative to the served folder, so two folders each
  // holding an index.html would otherwise share one. Folder A's snapshot uploaded
  // as folder B's gets broadcast verbatim into B's edit-mode tabs, where
  // hyper-morph merges A's document into B's page.
  it('a snapshot cached under folder A is gone once folder B is served', async () => {
    const appA = createApp(dirA);
    await request(appA)
      .post('/live-sync/save')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Page-URL', 'http://localhost/index.html')
      .send({ html: '<html><body>ONLY IN A</body></html>', sender: 'tab-a' });

    // Serving folder B is a fresh createApp, which is what a folder switch does.
    createApp(dirB);
    expect(getAndClearSnapshot('index.html')).toBeNull();
  });

  // The same clear must not break the ordinary case: within one served folder the
  // two lanes still merge into one entry.
  it('within one folder the save lane and the live-sync lane still merge', async () => {
    const app = createApp(dirA);
    await request(app)
      .post('/live-sync/save')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost:4321')
      .set('Page-URL', 'http://localhost/index.html')
      .send({ html: '<html><body>SNAP</body></html>', sender: 'tab-a' });
    await request(app)
      .post('/save')
      .set('Host', 'localhost')
      .set('Page-URL', 'http://localhost/index.html')
      .set('Content-Type', 'text/plain')
      .set('Save-Trigger', 'user')
      .send('<html><body>saved</body></html>');

    expect(getAndClearSnapshot('index.html')).toEqual({
      html: '<html><body>SNAP</body></html>',
      userDriven: true,
    });
  });
});
