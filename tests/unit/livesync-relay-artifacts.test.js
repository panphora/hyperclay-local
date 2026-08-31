const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

// Spec §10 names two artifacts on one relay address, and the field says which
// audience each is for. A snapshot is the sending tab's working state, edit
// controls and unsaved `no-save` content included, and goes to the other EDITORS.
// A document is the durable stripped one and goes to the VIEWERS. This handler
// used to read only the snapshot, so a client asking for viewers to be updated
// without a save behind it was answered `success` and reached nobody.
jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    broadcast: jest.fn(),
    notify: jest.fn(),
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
    subscribeUser: jest.fn(),
    unsubscribeUser: jest.fn(),
    broadcastToUser: jest.fn()
  }
}));

const { liveSync } = require('livesync-hyperclay');
const { createApp, getAndClearSnapshot } = require('../../src/main/server.js');

const PAGE = 'http://localhost:4321/index.html';
const DOCUMENT = '<!DOCTYPE html><html><body><p>durable</p></body></html>';
const SNAPSHOT = '<!DOCTYPE html><html><body><p>working</p><div class="toolbar"></div></body></html>';

describe('the relay reads both §10 artifacts', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-artifacts-'));
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const post = (body) =>
    request(app).post('/sync').set('Document-URL', PAGE).send(body);

  test('a document is fanned out to the viewers', async () => {
    const res = await post({ document: DOCUMENT, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      { html: DOCUMENT, sender: 'tab-1' },
      { lane: 'saved' }
    );
  });

  test('a document never reaches the editors', async () => {
    // The 200 is load-bearing: without it a build that refuses documents outright
    // satisfies "nothing reached the editors" by relaying nothing at all.
    const res = await post({ document: DOCUMENT, sender: 'tab-1' });
    expect(res.status).toBe(200);

    const toEditors = liveSync.broadcast.mock.calls.filter(([, , opts]) => opts?.lane === 'live');
    expect(toEditors).toEqual([]);
  });

  test('a snapshot still goes to the editors and not the viewers', async () => {
    await post({ snapshot: SNAPSHOT, sender: 'tab-1' });

    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      { html: SNAPSHOT, sender: 'tab-1' },
      { lane: 'live' }
    );
    const toViewers = liveSync.broadcast.mock.calls.filter(([, , opts]) => opts?.lane === 'saved');
    expect(toViewers).toEqual([]);
  });

  // The pre-spec spelling of `snapshot`, and the spec address does not read it.
  // Nothing frozen posts it there: /sync is new, and both clients pair the key with
  // the address in one wire profile chosen once for the life of the page. Reading it
  // anyway would buy nothing and cost the thing this train is for, since hyperclay's
  // spec route recognises only `snapshot` and `document`.
  test('the spec address does not read the legacy artifact name', async () => {
    const res = await post({ html: SNAPSHOT, sender: 'tab-1' });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // The pre-spec address reads it forever. Every published hyperclayjs and the inline
  // script in every Collection dashboard send it there, and no library update reaches
  // them.
  test('the pre-spec address still reads the legacy artifact name', async () => {
    const res = await request(app)
      .post('/live-sync/save')
      .set('Document-URL', PAGE)
      .send({ html: SNAPSHOT, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      expect.objectContaining({ html: SNAPSHOT, sender: 'tab-1' }),
      { lane: 'live' }
    );
  });

  // Refused rather than guessed at: one body carrying both names no single
  // audience, and picking one would deliver the other to nobody while answering
  // as though it had been relayed.
  test('a body carrying both artifacts is refused', async () => {
    const res = await post({ document: DOCUMENT, snapshot: SNAPSHOT, sender: 'tab-1' });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  test('a body carrying neither is refused', async () => {
    const res = await post({ sender: 'tab-1' });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // Presence, not string-ness, and this is the case that separates the two: a real
  // snapshot paired with a broken document is a confused client, and a string check
  // would quietly relay the good half rather than say so. hyperclay's relay holds the
  // same rule, and one route that answers two hosts differently is the whole class of
  // bug this train exists to remove.
  test('a real snapshot beside a broken document is still both', async () => {
    const res = await post({ snapshot: SNAPSHOT, document: 42, sender: 'tab-1' });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // The other side of the same rule: a client building { snapshot, document } in JS
  // naturally nulls the half it is not using, and that is one artifact, not two.
  test('an explicit null names no lane', async () => {
    const res = await post({ snapshot: SNAPSHOT, document: null, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      { html: SNAPSHOT, sender: 'tab-1' },
      { lane: 'live' }
    );
  });

  // The same bar the save lane holds bytes to. These reach every open tab through a
  // morph, so a fragment or a JSON blob turns each of them into something that is not
  // a document.
  test.each([
    ['a fragment', '<p>just a paragraph</p>'],
    ['an empty string', ''],
    ['a JSON blob', '{"not":"html"}']
  ])('%s is refused as not a document', async (_label, payload) => {
    const res = await post({ snapshot: payload, sender: 'tab-1' });

    expect(res.status).toBe(422);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // ...but that bar is new, and it belongs to the new address only. A saved document
  // is a frozen client: it hardcodes whatever library version wrote it and runs for
  // years with no way for an update to reach its inline script. hyperclayjs exports
  // captureBodyForSync(), which returns body innerHTML with no <html> root, and every
  // page built against it posts that fragment to /live-sync/save. Holding the new rule
  // there would break those pages permanently and silently.
  test('the pre-spec address still takes a fragment', async () => {
    const fragment = '<div id="app">body innerHTML, the way captureBodyForSync returns it</div>';
    const res = await request(app)
      .post('/live-sync/save')
      .set('Document-URL', PAGE)
      .send({ html: fragment, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      { html: fragment, sender: 'tab-1', identityMap: undefined },
      { lane: 'live' }
    );
  });

  // The same rule taken to its uncomfortable end. This host has always relayed an
  // empty string, and HTML Clay has always refused one, so the two disagree here. The
  // spec address settles it (both answer 422), but the pre-spec address cannot be
  // settled retroactively: the frozen clients that exist are the ones that talked to
  // THIS host, and each keeps the behavior it was built against.
  test('the pre-spec address still relays an empty artifact, as it always has', async () => {
    const res = await request(app)
      .post('/live-sync/save')
      .set('Document-URL', PAGE)
      .send({ html: '', sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalledWith(
      'index.html',
      expect.objectContaining({ html: '' }),
      { lane: 'live' }
    );
  });

  // Receivers use identityMap to pair elements across a morph by stable id instead of
  // by content scoring, which is what keeps focus, scroll position and half-typed
  // input where they were. hyperclay has always forwarded it; this host never did, so
  // live sync in the desktop app quietly lost that state on every frame.
  //
  // Asserted on the payload object rather than through toHaveBeenCalledWith, because
  // that matcher ignores an undefined property: an assertion written the obvious way
  // passes just as happily on a build that drops the field.
  test('the element identity map rides along to the editors', async () => {
    const identityMap = { '0': 'a', '0.1': 'b' };
    await post({ snapshot: SNAPSHOT, sender: 'tab-1', identityMap });

    const [, payload] = liveSync.broadcast.mock.calls.find(([, , o]) => o?.lane === 'live');
    expect(payload.identityMap).toEqual(identityMap);
  });

  // A viewer has no working state to preserve, so there is nothing for a map to pair.
  test('the identity map does not ride the viewer lane', async () => {
    const res = await post({ document: DOCUMENT, sender: 'tab-1', identityMap: { '0': 'a' } });
    expect(res.status).toBe(200);

    const [, payload] = liveSync.broadcast.mock.calls.find(([, , o]) => o?.lane === 'saved');
    expect(payload.identityMap).toBeUndefined();
  });

  // Shape-checked and then treated as opaque, the same check hyperclay makes: a client
  // sending an array or a string is confused about the field, and a receiver walking
  // it would have no way to say so.
  test.each([
    ['an array', []],
    ['a string', 'x'],
    ['null', null],
    ['a number', 7]
  ])('an identity map that is %s is refused', async (_label, identityMap) => {
    const res = await post({ snapshot: SNAPSHOT, sender: 'tab-1', identityMap });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // Absent is not the same as malformed: a client that sends no map at all is every
  // pre-spec client, and refusing them would break live sync outright.
  test('no identity map at all still relays', async () => {
    const res = await post({ snapshot: SNAPSHOT, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast).toHaveBeenCalled();
  });

  // Spec §6: the stamp of what this host stored for the bytes a tab just saved. The saving
  // tab attaches it to the snapshot it relays after its save returns, so a receiver adopts
  // the stamp as part of applying the content it describes and cannot do one without the
  // other. It reaches editors only, because only an editor saves.
  //
  // The frame this replaces was a stamp with no content, sent by the host. It reached
  // nobody, and had it arrived it would have raced the snapshot it belonged to: a save and
  // its tab's relay POST are two concurrent requests, so a receiver could take the new stamp
  // while still holding the old bytes and its next save would then pass If-Match and
  // overwrite a save it had never seen.
  test('an etag on a snapshot reaches the editors', async () => {
    await post({ snapshot: SNAPSHOT, sender: 'tab-1', etag: 'stored-4' });

    const payload = liveSync.broadcast.mock.calls[0][1];
    expect(payload.etag).toBe('stored-4');
    expect(payload.html).toBe(SNAPSHOT);
  });

  test('a document carries no etag: a viewer has no save to answer for', async () => {
    const res = await post({ document: DOCUMENT, sender: 'tab-1', etag: 'stored-4' });

    expect(res.status).toBe(200);
    const payload = liveSync.broadcast.mock.calls[0][1];
    expect(payload.etag).toBeUndefined();
  });

  test.each([
    ['a number', 7],
    ['an object', {}],
    ['an array', []]
  ])('an etag that is %s is refused', async (_label, etag) => {
    const res = await post({ snapshot: SNAPSHOT, sender: 'tab-1', etag });

    expect(res.status).toBe(400);
    expect(liveSync.broadcast).not.toHaveBeenCalled();
  });

  // Absent is not malformed, same as the identity map above: every pre-spec client sends
  // no stamp, and they must go on relaying exactly as they do today.
  test('no etag at all still relays', async () => {
    const res = await post({ snapshot: SNAPSHOT, sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(liveSync.broadcast.mock.calls[0][1].etag).toBeUndefined();
  });

  // §10 states it flatly: /_/sync never writes to disk, whichever field it
  // carries. Relaying is continuous and safe to lose; saving is a deliberate act
  // with one route and one set of consequences.
  test('neither artifact reaches the disk', async () => {
    await post({ document: DOCUMENT, sender: 'tab-1' });
    await post({ snapshot: SNAPSHOT, sender: 'tab-2' });

    await expect(fs.readFile(path.join(dir, 'index.html'), 'utf8')).rejects.toThrow();
  });

  // The platform-sync cache holds the unstripped working state this file owes the
  // platform on its next upload. A document is the stripped artifact, so caching it
  // there would upload a page with the person's live editor state missing from it.
  test('a document does not displace the cached snapshot', async () => {
    await post({ snapshot: SNAPSHOT, sender: 'tab-1' });
    await post({ document: DOCUMENT, sender: 'tab-2' });

    expect(getAndClearSnapshot('index.html').html).toBe(SNAPSHOT);
  });

  test('a document alone caches nothing to upload', async () => {
    const res = await post({ document: DOCUMENT, sender: 'tab-1' });
    expect(res.status).toBe(200);

    expect(getAndClearSnapshot('index.html')).toBeNull();
  });
});
