const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Spec §4 response metadata, one attribute: a document GET carries the stamp of the exact
// bytes it was built from, on the root element, as `documentetag`. A tab uses it to tell
// whether the version it loaded is still the one on disk, so the stamp has to describe the
// disk buffer and nothing else, and it is response-scoped exactly like a save token: it
// never reaches a file and never reaches another tab.

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { liveSync } = require('livesync-hyperclay');
const { documentEtag } = require('../../src/main/spec-wire');
const { injectDocumentEtag, stripSaveToken } = require('../../src/main/utils/root-attrs.js');
const { scanRootHtmlTag } = require('../../src/main/format-html');
const {
  servedDocumentEtag,
  withoutInjectedDocumentEtag
} = require('../helpers/served-metadata');

const DOC = (attrs = '', body = '<p>hi</p>') =>
  `<!DOCTYPE html>\n<html${attrs}><body>${body}</body></html>`;

// Exactly the text this host inserts, so a test can name it, count it, and take only it
// back out of a served response.
const INJECTED = ' documentetag="';

let dir;
let app;

const file = () => path.join(dir, 'index.html');

// The data-loss guard writes into .hyperclay/guard detached from the request by design, so
// it can still be running when a test finishes. Let it settle and retry, otherwise cleanup
// races it and throws ENOTEMPTY.
async function cleanup(target) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'document-etag-')));
  await fs.writeFile(file(), DOC());
  app = await listenLoopback(createApp(dir));
});

afterEach(async () => {
  await closeLoopback();
  await cleanup(dir);
});

// Bytes in, bytes out: res.text decodes, and this feature exists partly because a document
// may not be valid UTF-8.
const getRaw = (name = 'index.html', headers = {}) =>
  request(app).get('/' + name).set(headers).buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });

const rootAttrsOf = (text) => {
  const root = scanRootHtmlTag(text);
  return root ? text.slice(root.start + 5, root.end) : null;
};

describe('a document GET carries the stamp of the bytes it was built from', () => {
  test('the served stamp is the file\'s own stamp, and the file is never written', async () => {
    const onDisk = await fs.readFile(file());

    const res = await getRaw();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const stamp = servedDocumentEtag(res.body);
    expect(stamp).not.toBeNull();
    expect(stamp).toBe(documentEtag(onDisk));
    expect(Buffer.compare(withoutInjectedDocumentEtag(res.body), onDisk)).toBe(0);
    expect(Buffer.compare(await fs.readFile(file()), onDisk)).toBe(0);
  });

  test('two GETs are byte-identical and neither one touches the file', async () => {
    const first = await getRaw();
    const before = await fs.stat(file());
    const second = await getRaw();
    const after = await fs.stat(file());

    expect(Buffer.compare(first.body, second.body)).toBe(0);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  test('the stamp changes when the file changes, and describes the new bytes', async () => {
    const before = await getRaw();
    const changed = Buffer.from(DOC(' lang="en"', '<p>changed</p>'), 'utf8');
    await fs.writeFile(file(), changed);

    const after = await getRaw();

    expect(servedDocumentEtag(after.body)).toBe(documentEtag(changed));
    expect(servedDocumentEtag(after.body)).not.toBe(servedDocumentEtag(before.body));
    expect(Buffer.compare(withoutInjectedDocumentEtag(after.body), changed)).toBe(0);
  });

  // The repair GET is what a tab makes after its first subscription, and it is not a
  // navigation: the attribute must not depend on the request looking like a document load.
  test('a non-document fetch gets it too', async () => {
    const onDisk = await fs.readFile(file());

    const res = await getRaw('index.html', {
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      Accept: '*/*'
    });

    expect(res.status).toBe(200);
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(onDisk));
  });

  // No root start-tag means no place to put response metadata, and guessing one would edit
  // bytes the host has no business touching. Such a document keeps its previous serving
  // behaviour exactly.
  test('a file with no explicit root is served byte for byte', async () => {
    const fragment = Buffer.from('not a document, just bytes', 'utf8');
    await fs.writeFile(path.join(dir, 'fragment.html'), fragment);

    const res = await getRaw('fragment.html');

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, fragment)).toBe(0);
    expect(res.body.toString('latin1')).not.toContain('documentetag');
  });
});

describe('the attribute lands on the real root and nothing else', () => {
  test('a Latin-1 byte in the body and in a root attribute survives the trip', async () => {
    const raw = Buffer.concat([
      Buffer.from('<html data-note="caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('"><body>caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('</body></html>', 'ascii')
    ]);
    await fs.writeFile(path.join(dir, 'latin1.html'), raw);

    const res = await getRaw('latin1.html');

    expect(servedDocumentEtag(res.body)).toBe(documentEtag(raw));
    expect(Buffer.compare(withoutInjectedDocumentEtag(res.body), raw)).toBe(0);
  });

  test('a UTF-8 BOM is kept and the stamp still lands on the root', async () => {
    const raw = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<html lang="en"><body><p>hi</p></body></html>', 'utf8')
    ]);
    await fs.writeFile(path.join(dir, 'bom.html'), raw);

    const res = await getRaw('bom.html');

    expect(res.body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(raw));
    expect(Buffer.compare(withoutInjectedDocumentEtag(res.body), raw)).toBe(0);
  });

  // The old root-tag regex ended the tag at the first `>`, even one inside a quoted value,
  // which is how a real host could fail to strip a credential out of `data-rule="a > b"`.
  test('a quoted ">" in a root attribute does not hide the root', async () => {
    const raw = Buffer.from('<html data-rule="a > b" lang="en"><body>x</body></html>', 'utf8');
    await fs.writeFile(path.join(dir, 'rule.html'), raw);

    const res = await getRaw('rule.html');

    expect(servedDocumentEtag(res.body)).toBe(documentEtag(raw));
    expect(res.body.toString('utf8')).toContain('data-rule="a > b"');
    expect(Buffer.compare(withoutInjectedDocumentEtag(res.body), raw)).toBe(0);
  });

  test('a decoy <html documentetag> inside a comment is left alone', async () => {
    const source = `<!DOCTYPE html>\n<!-- <html documentetag="decoy"> -->\n<html lang="en"><body>x</body></html>`;
    const raw = Buffer.from(source, 'utf8');
    await fs.writeFile(path.join(dir, 'decoy.html'), raw);

    const res = await getRaw('decoy.html');

    const served = res.body.toString('utf8');
    // The decoy keeps its bytes, and the root still carries exactly one stamp.
    expect(served).toContain('<!-- <html documentetag="decoy"> -->');
    expect(rootAttrsOf(served).match(/documentetag=/g)).toHaveLength(1);
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(raw));
  });

  test('injecting twice leaves exactly one attribute', () => {
    const once = injectDocumentEtag(Buffer.from(DOC(' lang="en"'), 'utf8'), 'stamp-one');
    const twice = injectDocumentEtag(once, 'stamp-two');

    expect(twice.toString('utf8').split(INJECTED)).toHaveLength(2);
    expect(servedDocumentEtag(twice)).toBe('stamp-two');
  });

  test('a stamp already on disk is replaced rather than doubled', async () => {
    const raw = Buffer.from(DOC(' documentetag="stale" lang="en"'), 'utf8');
    await fs.writeFile(file(), raw);

    const res = await getRaw();

    const served = res.body.toString('utf8');
    expect(served.split(INJECTED)).toHaveLength(2);
    expect(servedDocumentEtag(res.body)).toBe(documentEtag(raw));
    expect(served).toContain('lang="en"');
    expect(served).not.toContain('stale');
  });

  test('stripping a root attribute leaves the rest of the document alone', () => {
    // A save body arrives decoded as UTF-8, so a BOM is that character and non-ASCII
    // content is real text; neither may be disturbed by taking an attribute off the root.
    const withToken = '\uFEFF<html savetoken="tok" data-note="caf\u00e9"><body>caf\u00e9</body></html>';
    const expected = '\uFEFF<html data-note="caf\u00e9"><body>caf\u00e9</body></html>';

    expect(stripSaveToken(withToken)).toBe(expected);
  });
});

describe('a stamp the client sent back never reaches disk or another tab', () => {
  const save = (html) => request(app)
    .post('/_/save')
    .set('Document-URL', 'http://localhost:4321/index.html')
    .set('Content-Type', 'text/plain')
    .send(html);

  test('a save strips it from the root and keeps everything else', async () => {
    const sent = `<!DOCTYPE html>\n<html documentetag="from-a-response" data-rule="a > b" lang="en">` +
      `<body><div documentetag="child">x</div><pre>documentetag="quoted in a sample"</pre></body></html>`;

    const res = await save(sent);

    expect(res.status).toBe(200);
    const onDisk = await fs.readFile(file(), 'utf8');
    expect(rootAttrsOf(onDisk)).not.toContain('documentetag');
    expect(onDisk).toContain('data-rule="a > b"');
    expect(onDisk).toContain('lang="en"');
    // Scoped to the root tag: a same-named attribute on a child, and one merely quoted in
    // the document's own text, are content rather than response metadata.
    expect(onDisk).toContain('<div documentetag="child">x</div>');
    expect(onDisk).toContain('documentetag="quoted in a sample"');
  });

  test('a save token after a quoted ">" is stripped too', async () => {
    const res = await save(DOC(' data-rule="a > b" savetoken="tok"'));

    expect(res.status).toBe(200);
    const onDisk = await fs.readFile(file(), 'utf8');
    expect(onDisk).not.toContain('savetoken');
    expect(onDisk).toContain('data-rule="a > b"');
  });

  test('the etag a save returns describes the stored bytes, not the sent ones', async () => {
    const res = await save(DOC(' documentetag="from-a-response" lang="en"'));

    expect(res.status).toBe(200);
    const meta = await request(app)
      .get('/_/meta')
      .set('Document-URL', 'http://localhost:4321/index.html');
    expect(res.body.etag).toBe(meta.body.document.etag);
    expect(res.body.etag).toBe(documentEtag(Buffer.from(await fs.readFile(file()))));
  });

  // A real subscriber rather than a spy on broadcast: what matters is the frame a peer
  // receives, and asserting the call instead of the delivery hides a payload the library
  // filters out.
  function fakeTab(lane) {
    const frames = [];
    const res = {
      write(msg) {
        const m = msg.match(/^(?:id: \d+\n)?data: (.+)\n\n$/);
        if (m) frames.push(JSON.parse(m[1]));
      }
    };
    liveSync.subscribe('index.html', res, { lane });
    return { res, frames };
  }

  test('a relayed snapshot reaches the other editor without it', async () => {
    const editor = fakeTab('live');
    try {
      const res = await request(app)
        .post('/_/sync')
        .set('Document-URL', 'http://localhost:4321/index.html')
        .send({ snapshot: DOC(' documentetag="from-a-response"', '<p>hi</p>'), sender: 'tab-1' });

      expect(res.status).toBe(200);
      expect(editor.frames).toHaveLength(1);
      expect(editor.frames[0].html).not.toContain('documentetag');
      expect(rootAttrsOf(editor.frames[0].html)).not.toContain('documentetag');
      expect(editor.frames[0].html).toContain('<p>hi</p>');
    } finally {
      liveSync.unsubscribe('index.html', editor.res);
    }
  });

  test('a relayed document reaches viewers without it', async () => {
    const viewer = fakeTab('saved');
    try {
      const res = await request(app)
        .post('/_/sync')
        .set('Document-URL', 'http://localhost:4321/index.html')
        .send({ document: DOC(' documentetag="from-a-response"', '<p>hi</p>'), sender: 'tab-1' });

      expect(res.status).toBe(200);
      expect(viewer.frames).toHaveLength(1);
      expect(viewer.frames[0].html).not.toContain('documentetag');
      expect(viewer.frames[0].html).toContain('<p>hi</p>');
    } finally {
      liveSync.unsubscribe('index.html', viewer.res);
    }
  });

  // A stored version can carry the metadata it was served with, and a restore writes those
  // bytes back to the live file.
  test('a restore writes the version without it', async () => {
    const VERSION = '2031-01-01-00-00-00-000+0000.html';
    const versionsDir = path.join(dir, '.hyperclay', 'versions', 'index');
    await fs.mkdir(versionsDir, { recursive: true });
    await fs.writeFile(path.join(versionsDir, VERSION),
      `<!DOCTYPE html>\n<html documentetag="from-a-response" lang="en"><body><p>older</p></body></html>`);

    const res = await request(app).post(`/_/restore/index.html/${VERSION}`);

    expect(res.status).toBe(200);
    const onDisk = await fs.readFile(file(), 'utf8');
    expect(rootAttrsOf(onDisk)).not.toContain('documentetag');
    expect(onDisk).toContain('lang="en"');
    expect(onDisk).toContain('<p>older</p>');
  });
});
