// Spec §4 and §9's registry: `format` is a CAPABILITY, announced by name, because a
// client cannot discover it any other way. §4 line 164 is the exact rule this host was
// breaking: "A host that does not declare `format` ignores the attribute entirely." So
// a client reading the extension list and finding no `format` may take its bytes to be
// stored as sent, and this host was reformatting them anyway.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

// Indentation the beautifier will visibly rewrite, so "was it reformatted" is a
// question the test can answer from the bytes rather than by trusting a flag.
const RAGGED = '<body>\n<div>\n<p>one</p>\n<p>two</p>\n</div>\n</body>';
const OPTED_IN = `<!DOCTYPE html><html formathtml="true">${RAGGED}</html>`;
const OPTED_OUT = `<!DOCTYPE html><html>${RAGGED}</html>`;
const WRONG_VALUE = `<!DOCTYPE html><html formathtml="yes">${RAGGED}</html>`;

describe('the format capability', () => {
  let dir;
  let app;

  const save = (html) => request(app)
    .post('/save')
    .set('Page-URL', 'http://localhost:4321/index.html')
    .set('Content-Type', 'text/plain')
    .send(html);

  const onDisk = () => fs.readFile(path.join(dir, 'index.html'), 'utf8');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fmt-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('the host announces format', async () => {
    const res = await request(app)
      .get('/_/meta')
      .set('Document-URL', 'http://localhost:4321/index.html');

    expect(res.body.extensions).toContain('format');
  });

  // The announcement has to be true, which is the half that makes it worth anything.
  // These three pin the §4 contract the name promises.
  test('a document that asks for formatting is reformatted', async () => {
    await save(OPTED_IN);

    const stored = await onDisk();
    expect(stored).not.toBe(OPTED_IN);
    expect(stored).toMatch(/\n\s+<p>one<\/p>/);
  });

  test('a document that does not ask is stored as sent', async () => {
    await save(OPTED_OUT);
    expect(await onDisk()).toBe(OPTED_OUT);
  });

  // Read by VALUE, not by presence: §4 is explicit that any other value means verbatim.
  test('any value other than true is not an opt-in', async () => {
    await save(WRONG_VALUE);
    expect(await onDisk()).toBe(WRONG_VALUE);
  });

  // §4 line 168, and the reason the two capabilities are entangled: when a host
  // reformats, the stamp it hands back has to describe the bytes on disk, or the
  // client's next If-Match is refused for a change it made itself.
  test('the stamp a reformatting save returns matches the reformatted bytes', async () => {
    const first = await save(OPTED_IN);
    expect(first.status).toBe(200);

    const again = await request(app)
      .post('/save')
      .set('Page-URL', 'http://localhost:4321/index.html')
      .set('Content-Type', 'text/plain')
      .set('If-Match', first.body.etag)
      .send(OPTED_IN);

    expect(again.status).toBe(200);
  });
});
