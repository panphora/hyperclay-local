// Spec §6 on Hyperclay Local: discovery, the stamp on every save answer, If-Match,
// the 412 that writes nothing, and an honest `changedBy`.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { documentEtag } = require('../../src/main/spec-wire.js');

const DOC = '<!DOCTYPE html><html lang="en"><body><p>one</p></body></html>';

describe('conditional saves', () => {
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

  const onDisk = () => fs.readFile(path.join(dir, 'index.html'), 'utf8');

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cond-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), DOC);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  // §6 forbids announcing the name and then not honouring it: a client that reads
  // `conditional` stops guarding itself, so the announcement is a promise.
  test('the host announces conditional', async () => {
    const res = await meta();
    expect(res.body.extensions).toContain('conditional');
  });

  test('meta carries the stamp of what is on disk', async () => {
    const res = await meta();
    expect(res.body.document.etag).toBe(documentEtag(await onDisk()));
  });

  // A client with no stamp of its own has nowhere else to get one without saving
  // first, which is exactly the unguarded save §6 exists to prevent.
  test('meta withholds the whole document block for a file that is not there', async () => {
    const res = await request(app)
      .get('/_/meta')
      .set('Document-URL', 'http://localhost:4321/missing.html');
    expect(res.body.document).toBeUndefined();
    expect(res.body.extensions).toContain('conditional');
  });

  test('every save answer carries a stamp', async () => {
    const res = await save('<!DOCTYPE html><html lang="en"><body><p>two</p></body></html>');
    expect(res.status).toBe(200);
    expect(res.body.etag).toMatch(/^[0-9a-f]{16}$/);
  });

  // The bytes stored, never the bytes sent. This host reformats every document on
  // the way in, so stamping the sent bytes would hand back a stamp that no later
  // If-Match could ever match, refusing the client's next save forever.
  test('the stamp is of the stored bytes, not the sent ones', async () => {
    const sent = '<!DOCTYPE html><html lang="en" formathtml="true"><body><p>two</p></body></html>';
    const res = await save(sent);

    const stored = await onDisk();
    // Asserted, not assumed: if formathtml ever stops reformatting, the two stamps
    // coincide and the rest of this test would pass while proving nothing.
    expect(stored).not.toBe(sent);
    expect(res.body.etag).toBe(documentEtag(stored));
    expect(res.body.etag).not.toBe(documentEtag(sent));
  });

  test('the stamp a save returns is the one its next save can use', async () => {
    const first = await save('<!DOCTYPE html><html lang="en"><body><p>two</p></body></html>');
    const second = await save(
      '<!DOCTYPE html><html lang="en"><body><p>three</p></body></html>',
      { 'If-Match': first.body.etag }
    );
    expect(second.status).toBe(200);
    expect(await onDisk()).toContain('three');
  });

  // The loop a real client runs: seed the stamp from discovery, save with it, keep
  // the stamp the save returned, save again. If any link computes a stamp
  // differently the second save is refused, so this is the test that catches a
  // mismatch between what meta reports, what a save returns, and what the next save
  // is judged against. clayjs takes the seed from `meta.document.etag` and the
  // capability from `meta.extensions`, so these are the exact two fields it reads.
  test('a client can save repeatedly from the stamps it is given', async () => {
    const discovery = await meta();
    expect(discovery.body.extensions).toContain('conditional');

    let stamp = discovery.body.document.etag;
    for (const n of ['two', 'three', 'four']) {
      const res = await save(
        `<!DOCTYPE html><html lang="en"><body><p>${n}</p></body></html>`,
        { 'If-Match': stamp }
      );
      expect(res.status).toBe(200);
      stamp = res.body.etag;
    }
    expect(await onDisk()).toContain('four');
  });

  test('a stale stamp is refused with 412 and nothing is written', async () => {
    const stale = documentEtag('<html>something else entirely</html>');
    const before = await onDisk();

    const res = await save('<!DOCTYPE html><html lang="en"><body><p>lost</p></body></html>', {
      'If-Match': stale
    });

    expect(res.status).toBe(412);
    expect(res.body.code).toBe('conflict');
    expect(await onDisk()).toBe(before);
  });

  // So a client can recover in one round trip rather than refetching the document
  // to learn what it should have sent.
  test('the refusal carries the current stamp', async () => {
    const res = await save('<!DOCTYPE html><html lang="en"><body><p>lost</p></body></html>', {
      'If-Match': documentEtag('<html>stale</html>')
    });
    expect(res.body.etag).toBe(documentEtag(await onDisk()));
  });

  // An absent header is the core save: last write wins, no questions asked. A host
  // must not start refusing saves from clients that never opted in.
  test('a save with no If-Match is unconditional', async () => {
    const res = await save('<!DOCTYPE html><html lang="en"><body><p>two</p></body></html>');
    expect(res.status).toBe(200);
    expect(await onDisk()).toContain('two');
  });

  // Not the same as absent: this is a client that computed its stamp wrong, and
  // dropping it back to last-write-wins would silently remove the protection it
  // asked for.
  test('an empty If-Match is refused, not treated as absent', async () => {
    const before = await onDisk();
    const res = await save('<!DOCTYPE html><html lang="en"><body><p>lost</p></body></html>', {
      'If-Match': ''
    });
    expect(res.status).toBe(412);
    expect(await onDisk()).toBe(before);
  });

  test('* saves over a document that exists', async () => {
    const res = await save('<!DOCTYPE html><html lang="en"><body><p>two</p></body></html>', {
      'If-Match': '*'
    });
    expect(res.status).toBe(200);
  });

  test('* refuses when the document is not there', async () => {
    const res = await request(app)
      .post('/save')
      .set('Page-URL', 'http://localhost:4321/absent.html')
      .set('Content-Type', 'text/plain')
      .set('If-Match', '*')
      .send('<!DOCTYPE html><html lang="en"><body><p>new</p></body></html>');

    expect(res.status).toBe(412);
    await expect(fs.readFile(path.join(dir, 'absent.html'), 'utf8')).rejects.toThrow();
  });

  describe('changedBy', () => {
    // The one attribution this host can make honestly. Everything in the folder
    // belongs to the person running the app, so a second writer that this process
    // put there from a browser is another tab of theirs.
    test('a second tab is named', async () => {
      const first = await save('<!DOCTYPE html><html lang="en"><body><p>tab two saved</p></body></html>');

      const res = await save('<!DOCTYPE html><html lang="en"><body><p>tab one</p></body></html>', {
        'If-Match': documentEtag(DOC)
      });

      expect(res.status).toBe(412);
      expect(res.body.changedBy).toBe('another-tab');
      expect(first.body.etag).toBe(res.body.etag);
    });

    // The case a digest comparison cannot see. An editor writes something else and
    // then undoes it, so the bytes on disk are once again the ones this host wrote,
    // and every stamp matches again. The write that actually moved the file back was
    // external, so `changedBy` must be omitted rather than name one of this person's
    // own tabs. The mtime is what still remembers: it moved twice and does not return.
    test('an outside writer who undoes their change is still not named', async () => {
      const target = path.join(dir, 'index.html');
      const mine = '<!DOCTYPE html><html lang="en"><body><p>mine</p></body></html>';

      const first = await save(mine);
      expect(first.status).toBe(200);
      const written = await onDisk();

      // Out and back, from outside. The delay is so the second write lands on a
      // distinct mtime from the save above; without it the test could pass on a
      // coarse-grained clock for the wrong reason.
      await fs.writeFile(target, '<html><body>an editor was here</body></html>');
      await new Promise((r) => setTimeout(r, 20));
      await fs.writeFile(target, written);

      expect(await onDisk()).toBe(written);

      const res = await save('<!DOCTYPE html><html lang="en"><body><p>third</p></body></html>', {
        'If-Match': documentEtag(DOC)
      });

      expect(res.status).toBe(412);
      expect(res.body.changedBy).toBeUndefined();
    });

    // A text editor, a git checkout, the sync engine pulling a newer copy down. §6
    // says a host that cannot tell omits the field, and that a confident wrong
    // attribution is worse than none: naming the person's own tab for an edit they
    // made in vim is alarming and false.
    test('an outside writer is not named', async () => {
      await fs.writeFile(path.join(dir, 'index.html'), '<html>edited in a text editor</html>');

      const res = await save('<!DOCTYPE html><html lang="en"><body><p>mine</p></body></html>', {
        'If-Match': documentEtag(DOC)
      });

      expect(res.status).toBe(412);
      expect(res.body).not.toHaveProperty('changedBy');
    });

    // The refusal is the contract; the attribution is a nicety. A client reads the
    // two answers completely differently: one asks the person to choose, the other
    // gets retried.
    test('an outside writer is still refused', async () => {
      await fs.writeFile(path.join(dir, 'index.html'), '<html>edited in a text editor</html>');
      const before = await onDisk();

      const res = await save('<!DOCTYPE html><html lang="en"><body><p>mine</p></body></html>', {
        'If-Match': documentEtag(DOC)
      });

      expect(res.status).toBe(412);
      expect(await onDisk()).toBe(before);
    });
  });

  // An etag is a promise made BETWEEN hosts: the same document synced from
  // hyperclay.com must stamp the same here, so the stamp is over the BYTES on disk.
  // Reading the file as text first replaces every byte that is not valid UTF-8 with
  // U+FFFD, and hashing that stamps something the file does not contain. A client
  // carrying a stamp from another host would then be refused a save for a document
  // that never changed, with no way to explain the 412.
  //
  // The fixture is deliberately not valid UTF-8. A lone 0xFF cannot begin any UTF-8
  // sequence, so the decoded form and the stored bytes can never hash alike.
  describe('the stamp is over bytes, not over decoded text', () => {
    const RAW = Buffer.concat([
      Buffer.from('<!DOCTYPE html><html lang="en"><body><p>'),
      Buffer.from([0xff]),
      Buffer.from('</p></body></html>')
    ]);

    beforeEach(async () => {
      await fs.writeFile(path.join(dir, 'index.html'), RAW);
    });

    test('discovery stamps the bytes on disk', async () => {
      const decoded = RAW.toString('utf8');
      expect(documentEtag(decoded)).not.toBe(documentEtag(RAW));

      const res = await meta();
      expect(res.body.document.etag).toBe(documentEtag(RAW));
    });

    test('the stamp discovery announces is the one a save accepts', async () => {
      const announced = (await meta()).body.document.etag;
      const res = await save(DOC, { 'If-Match': announced });

      expect(res.status).toBe(200);
      expect(await onDisk()).toContain('<p>one</p>');
    });
  });

  // A read that fails for any reason other than "there is no file yet" leaves this
  // host unable to compare anything, and that must not be answered as though the file
  // were empty. Doing so turns the failure into an authorization: the refusal hands
  // back the empty-content etag as if it described the file, and a client that does
  // the obvious thing and retries with the stamp it was just given is let through to
  // replace bytes nobody could read. Nothing backs them up either, because the
  // first-save backup reads the same unreadable file.
  describe('an unreadable document is refused, never read as empty', () => {
    const target = () => path.join(dir, 'index.html');

    // Skipped rather than silently vacuous where mode bits do not bite: root ignores
    // them, and Windows has no equivalent.
    const canDenyReads = async () => {
      await fs.chmod(target(), 0o000);
      try {
        await fs.readFile(target());
        return false;
      } catch {
        return true;
      }
    };

    afterEach(async () => {
      await fs.chmod(target(), 0o644).catch(() => {});
    });

    test('a conditional save against unreadable bytes is refused and writes nothing', async () => {
      if (!(await canDenyReads())) return;

      const before = documentEtag('');
      const res = await save('<html><body>replacement</body></html>', { 'If-Match': before });

      expect(res.status).toBe(500);
      expect(res.body.code).not.toBe('conflict');

      await fs.chmod(target(), 0o644);
      expect(await onDisk()).toBe(DOC);
    });

    test('the refusal never hands back a stamp a retry could use', async () => {
      if (!(await canDenyReads())) return;

      const res = await save('<html><body>replacement</body></html>', { 'If-Match': '*' });

      expect(res.status).toBe(500);
      expect(res.body.etag).toBeUndefined();

      await fs.chmod(target(), 0o644);
      expect(await onDisk()).toBe(DOC);
    });
  });
});
