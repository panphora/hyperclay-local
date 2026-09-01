// Spec §6's `receipts` on Hyperclay Local: the id of the save whose body produced
// the bytes on disk, reported from meta, from an accepted save, and from a refusal.
//
// The problem it exists for: a save whose response never arrives leaves the client
// unable to tell "it landed" from "it never ran". Without a receipt the only safe
// move is to hold its stamp and let the next save be refused, which shows a person
// a conflict notice for a few seconds of bad wifi. With one, the client asks the
// host whether its own save is what wrote the current bytes and carries on quietly.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { documentEtag } = require('../../src/main/spec-wire.js');

const DOC = '<!DOCTYPE html><html lang="en"><body><p>one</p></body></html>';
const page = n => `<!DOCTYPE html><html lang="en"><body><p>${n}</p></body></html>`;

describe('save receipts', () => {
  let dir;
  let app;

  const save = (html, headers = {}) => {
    const req = request(app)
      .post('/save')
      .set('Page-URL', 'http://localhost:4321/index.html')
      .set('Content-Type', 'text/plain');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send(html);
  };

  const meta = () => request(app)
    .get('/_/meta')
    .set('Document-URL', 'http://localhost:4321/index.html');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'receipt-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = await listenLoopback(createApp(dir));
    await fs.writeFile(path.join(dir, 'index.html'), DOC);
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  // §9: never alone. A receipt proves an earlier save ran, but the send that follows
  // a MISSING receipt is only safe because If-Match is there to refuse it.
  test('receipts is announced, and only alongside conditional', async () => {
    const res = await meta();
    expect(res.body.extensions).toContain('receipts');
    expect(res.body.extensions).toContain('conditional');
  });

  // The recovery path itself: this is what a client asks after a save it never got
  // an answer to.
  test('meta reports the id of the save that produced the stored bytes', async () => {
    const saved = await save(page('two'), { 'Save-ID': 'attempt-1' });
    expect(saved.status).toBe(200);

    const res = await meta();
    expect(res.body.document.saveId).toBe('attempt-1');
    expect(res.body.document.etag).toBe(saved.body.etag);
  });

  test('an accepted save echoes the id it was sent', async () => {
    const res = await save(page('two'), { 'Save-ID': 'attempt-1' });
    expect(res.status).toBe(200);
    expect(res.body.saveId).toBe('attempt-1');
  });

  // The verification is answer-time and needs no invalidation hooks, which is what
  // makes it safe against writers that have never heard of this host: a text editor,
  // a git checkout, the sync engine pulling a newer copy down.
  test('a write from outside invalidates the receipt', async () => {
    await save(page('two'), { 'Save-ID': 'attempt-1' });
    await fs.writeFile(path.join(dir, 'index.html'), page('somebody else'));

    const res = await meta();
    expect(res.body.document.saveId).toBeUndefined();
    expect(res.body.document.etag).toBe(documentEtag(page('somebody else')));
  });

  // Replaced on every write through this host, not merely verified. Answer-time
  // verification alone cannot tell these apart, because the bytes are back at a
  // value this host really did once write for that id.
  test('an id-less save clears the receipt, even when a later save restores the bytes', async () => {
    const first = page('two');
    await save(first, { 'Save-ID': 'attempt-1' });
    await save(page('three'));
    await save(first);

    const res = await meta();
    expect(res.body.document.etag).toBe(documentEtag(first));
    expect(res.body.document.saveId).toBeUndefined();
  });

  // §6's late-duplicate rule. A client recognising its own id on a 412 is being told
  // its own earlier save moved the document, which is not a conflict with anybody.
  test('a refusal carries the receipt of the bytes that caused it', async () => {
    const first = await save(page('two'), { 'Save-ID': 'attempt-1' });
    expect(first.status).toBe(200);

    const refused = await save(page('three'), {
      'If-Match': documentEtag('something that was never on disk'),
      'Save-ID': 'attempt-2'
    });
    expect(refused.status).toBe(412);
    expect(refused.body.code).toBe('conflict');
    expect(refused.body.saveId).toBe('attempt-1');
    expect(refused.body.etag).toBe(first.body.etag);
  });

  // The id is the client's proof, so a host that mints one hands a client proof of
  // a save that client never made.
  test('the host never mints a receipt', async () => {
    const res = await save(page('two'));
    expect(res.status).toBe(200);
    expect(res.body.saveId).toBeUndefined();
    expect((await meta()).body.document.saveId).toBeUndefined();
  });

  // Dropped, never truncated: a truncated id could collide with a different client's
  // id and hand somebody else's proof to the wrong tab.
  test('an overlong id is dropped rather than truncated', async () => {
    const huge = 'x'.repeat(500);
    const res = await save(page('two'), { 'Save-ID': huge });
    expect(res.status).toBe(200);
    expect(res.body.saveId).toBeUndefined();

    const doc = (await meta()).body.document;
    expect(doc.saveId).toBeUndefined();
    expect(doc.etag).toBe(res.body.etag);
  });
});
