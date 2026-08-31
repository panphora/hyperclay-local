const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const request = require('supertest');

const { createApp, getAndClearSnapshot } = require('../../src/main/server.js');
const dataGuard = require('../../src/main/data-loss-guard.js');

// Spec §3: a save sends the document as text, so everything else about it rides
// in a header. The provenance bit used to be read only out of the JSON envelope's
// `userDriven` field, which meant a spec-shaped text save reached the data-clobber
// guard as ui-unknown and the human-gesture signal was lost.
//
// These drive the real app through supertest, so they cover the wiring in the
// /save handler and not just the header reader.
async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('the save trigger reaches the data guard from a header', () => {
  let dir;
  let app;
  let seen;

  const save = (extraHeaders = {}) => request(app)
    .post('/save')
    .set('Host', 'localhost')
    .set('Page-URL', 'http://localhost/index.html')
    .set('Content-Type', 'text/plain')
    .set(extraHeaders)
    .send('<html><body>written</body></html>');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    seen = [];
    jest.spyOn(dataGuard, 'provenanceForLocalSave').mockImplementation((userDriven) => {
      seen.push(userDriven);
      return 'ui-unknown';
    });
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), '<html><body>original</body></html>');
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('Save-Trigger: user marks the save as a human gesture', async () => {
    const res = await save({ 'Save-Trigger': 'user' });
    expect(res.status).toBe(200);
    expect(seen).toEqual([true]);
  });

  test('Save-Trigger: auto marks it as background', async () => {
    const res = await save({ 'Save-Trigger': 'auto' });
    expect(res.status).toBe(200);
    expect(seen).toEqual([false]);
  });

  // hyperclayjs 1.x still sends the pre-spec spelling. [legacy]
  test('the pre-spec header is still read when Save-Trigger is absent', async () => {
    const res = await save({ 'X-Hyperclay-User-Driven': '1' });
    expect(res.status).toBe(200);
    expect(seen).toEqual([true]);
  });

  // Not the same answer as `auto`: an old client that says nothing is unknown,
  // and the guard tie-breaks silent rather than treating it as a script.
  test('no trigger header at all reads as unknown', async () => {
    const res = await save();
    expect(res.status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  // The bit has to survive all the way to the sync engine, which reads it when it
  // uploads the file to the platform. It used to ride inside the snapshot entry,
  // and the accessor returned null whenever there was no snapshot, so a document
  // on a preset without live-sync would reach the platform guard as ui-unknown.
  test('the sync engine still gets the trigger when no snapshot exists', async () => {
    await save({ 'Save-Trigger': 'user' });

    const owed = getAndClearSnapshot('index.html');
    expect(owed).not.toBeNull();
    expect(owed.userDriven).toBe(true);
    expect(owed.html).toBeNull();
  });

  test('a background save records the bit as false, not as missing', async () => {
    await save({ 'Save-Trigger': 'auto' });
    expect(getAndClearSnapshot('index.html').userDriven).toBe(false);
  });

  // Reading it is also clearing it: the next upload must not reuse a stale bit.
  test('the entry is consumed once', async () => {
    await save({ 'Save-Trigger': 'user' });
    expect(getAndClearSnapshot('index.html').userDriven).toBe(true);
    expect(getAndClearSnapshot('index.html')).toBeNull();
  });

  // clayjs sets no Content-Type at all on the save. A browser's fetch stamps
  // text/plain on a string body, but nothing in the format requires that, and a
  // body reader that only accepts an explicit text/plain would drop the document
  // on the floor and report an invalid body.
  test('a body with no Content-Type at all is still read as the document', async () => {
    const res = await request(app)
      .post('/save')
      .set('Host', 'localhost')
      .set('Page-URL', 'http://localhost/index.html')
      .set('Save-Trigger', 'user')
      .send(Buffer.from('<html><body>no content type</body></html>'));

    expect(res.status).toBe(200);
    expect(seen).toEqual([true]);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8'))
      .toContain('no content type');
  });

  // Spec §3: one route, one body shape. The JSON envelope that used to carry
  // {content, snapshotHtml, userDriven} is refused outright, and nothing is
  // written, so a client sending the old shape learns it rather than half-working.
  test('a JSON body is refused with 415 and nothing is written', async () => {
    const res = await request(app)
      .post('/save')
      .set('Host', 'localhost')
      .set('Page-URL', 'http://localhost/index.html')
      .send({ content: '<html><body>written</body></html>', userDriven: true });

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-type');
    expect(seen).toEqual([]);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8'))
      .toBe('<html><body>original</body></html>');
  });
});
