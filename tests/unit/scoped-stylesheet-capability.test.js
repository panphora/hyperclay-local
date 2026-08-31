// Spec §4 and §9's registry: this host rewrites one link element in a saved document,
// and §4 says stored bytes are the bytes sent. A host doing that while announcing
// nothing has told every client its documents are stored verbatim when they are not,
// which matters most to a client comparing what it sent against what is on disk. That
// is exactly what a conditional save does, and this host announces `conditional`.
//
// The announcement and the behaviour are asserted together on purpose. Either one alone
// can be true while the pair is a lie, and the lie is the thing §9 exists to prevent.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

// A link scoped to some OTHER document, which is what a rename leaves behind and the
// case where the rewrite actually changes bytes.
const STALE_LINK =
  '<!DOCTYPE html><html><head>' +
  '<link href="https://hyperclay.com/tailwindcss/somethingelse.css" rel="stylesheet">' +
  '</head><body><p>hi</p></body></html>';

const NO_LINK = '<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>';

describe('the scoped-stylesheet capability', () => {
  let dir;
  let app;

  const save = (html) => request(app)
    .post('/save')
    .set('Document-URL', 'http://localhost:4321/index.html')
    .set('Content-Type', 'text/plain')
    .send(html);

  const onDisk = () => fs.readFile(path.join(dir, 'index.html'), 'utf8');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('the host announces scoped-stylesheet', async () => {
    const res = await request(app).get('/_/meta');

    expect(res.status).toBe(200);
    expect(res.body.extensions).toContain('scoped-stylesheet');
  });

  test('and it is not an idle claim: a stale link is rewritten to this document', async () => {
    await save(STALE_LINK);

    const stored = await onDisk();
    expect(stored).toContain('/tailwindcss/index.css');
    expect(stored).not.toContain('somethingelse.css');
  });

  // The opt-in is the link. §9 says nothing else in the document may change, and a
  // document carrying no link is the case where "nothing else" has to mean nothing.
  test('a document with no such link is stored as sent', async () => {
    await save(NO_LINK);

    const stored = await onDisk();
    expect(stored).toContain('<p>hi</p>');
    expect(stored).not.toContain('tailwindcss');
  });
});
