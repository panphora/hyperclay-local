const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Spec §9: the save token is ephemeral, and a host takes it back out of whatever the
// client returns. This host injects none of its own, which is why it was missing the
// strip entirely, and why it matters anyway: a document that has been served by a host
// that DOES inject one carries the attribute in the bytes the browser sends back.
//
// A token that reaches disk is permanent. It also poisons the file for every host after
// that: a current client reads a document carrying only the pre-rename spelling as an
// out-of-date HTML Clay, turns edit mode off, and puts a notice on the page naming a
// product that is not the one running.

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { liveSync } = require('livesync-hyperclay');

const DOC = (attrs) => `<!DOCTYPE html>\n<html${attrs}><body><p>hi</p></body></html>`;

let dir;
let app;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'token-strip-')));
  await fs.writeFile(path.join(dir, 'index.html'), DOC(''));
  app = await listenLoopback(createApp(dir));
});

afterEach(async () => {
  await closeLoopback();
});

const save = (html) => request(app)
  .post('/save')
  .set('Document-URL', 'http://localhost:4321/index.html')
  .set('Content-Type', 'text/plain')
  .send(html);

const stored = () => fs.readFile(path.join(dir, 'index.html'), 'utf8');

describe('a save never writes the credential to disk', () => {
  test.each([
    ['savetoken', ' savetoken="tok-current"'],
    ['htmlclaytoken', ' htmlclaytoken="tok-legacy"'],
  ])('strips %s', async (name, attr) => {
    const res = await save(DOC(attr));

    expect(res.status).toBe(200);
    const onDisk = await stored();
    expect(onDisk).not.toContain(name);
    expect(onDisk).toContain('<p>hi</p>');
  });

  // Both spellings at once is what a current HTML Clay serves, so this is the
  // ordinary case rather than an edge one.
  test('strips both when a document carries both, and keeps everything else', async () => {
    const res = await save(DOC(' lang="en" savetoken="a" htmlclaytoken="b" data-keep="1"'));

    expect(res.status).toBe(200);
    const onDisk = await stored();
    expect(onDisk).not.toContain('savetoken');
    expect(onDisk).not.toContain('htmlclaytoken');
    expect(onDisk).toContain('lang="en"');
    expect(onDisk).toContain('data-keep="1"');
  });

  // The strip is scoped to the opening tag. A document that merely writes about the
  // attribute keeps what it wrote.
  test('leaves the attribute alone where it is content rather than a credential', async () => {
    const doc = '<!DOCTYPE html>\n<html><body><pre>savetoken="documented"</pre></body></html>';
    const res = await save(doc);

    expect(res.status).toBe(200);
    expect(await stored()).toContain('savetoken="documented"');
  });

  // The stamp has to describe the bytes that reached disk, or the client's next
  // conditional save is refused against a value it could never match.
  test('the etag it returns matches the stored bytes, not the ones sent', async () => {
    const res = await save(DOC(' savetoken="tok-current"'));

    expect(res.status).toBe(200);
    const meta = await request(app)
      .get('/_/meta')
      .set('Document-URL', 'http://localhost:4321/index.html');
    expect(res.body.etag).toBe(meta.body.document.etag);
  });
});

describe('a relay never hands one tab another tab credential', () => {
  // A real subscriber rather than a spy on broadcast: what matters is the frame that
  // reaches a peer, and the sibling repo learned the hard way that asserting the call
  // instead of the delivery hides a payload the library discards.
  function fakeTab(lane) {
    const frames = [];
    const res = {
      write(msg) {
        const m = msg.match(/^data: (.+)\n\n$/);
        if (m) frames.push(JSON.parse(m[1]));
      },
    };
    liveSync.subscribe('index.html', res, { lane });
    return { res, frames };
  }

  let editor;
  beforeEach(() => { editor = fakeTab('live'); });
  afterEach(() => { liveSync.unsubscribe('index.html', editor.res); });

  test('a snapshot reaches the other editors with the token gone', async () => {
    const res = await request(app)
      .post('/_/sync')
      .set('Document-URL', 'http://localhost:4321/index.html')
      .send({ snapshot: DOC(' savetoken="tok-current"'), sender: 'tab-1' });

    expect(res.status).toBe(200);
    expect(editor.frames).toHaveLength(1);
    expect(editor.frames[0].html).not.toContain('savetoken');
    expect(editor.frames[0].html).toContain('<p>hi</p>');
  });
});
