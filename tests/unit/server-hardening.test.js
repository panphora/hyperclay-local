// A0 (directory-listing XSS + href encoding), A2 (global Host validation),
// A3 (canonical path resolution + symlink consent), A4 (error handler),
// A5 (sites-versions reserved).

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const {
  createApp,
  isLoopbackHostHeader,
  escapeHtml,
  encodePathSegments,
  addWordBreaks
} = require('../../src/main/server.js');

// The data-loss guard writes into .hyperclay/guard detached from the request by
// design, so it can still be running when a test finishes. Let it settle and
// retry, otherwise cleanup races it and throws ENOTEMPTY.
async function cleanup(dir) {
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

describe('A2: Host header validation', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'host-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), '<html>ok</html>');
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  describe('isLoopbackHostHeader', () => {
    test('accepts loopback names and IPv4 loopback with and without a port', () => {
      expect(isLoopbackHostHeader('localhost')).toBe(true);
      expect(isLoopbackHostHeader('localhost:4321')).toBe(true);
      expect(isLoopbackHostHeader('127.0.0.1')).toBe(true);
      expect(isLoopbackHostHeader('127.0.0.1:4321')).toBe(true);
      expect(isLoopbackHostHeader('127.1.2.3:80')).toBe(true);
    });

    test('accepts IPv6 literals — splitting host on ":" would mangle these', () => {
      expect(isLoopbackHostHeader('[::1]')).toBe(true);
      expect(isLoopbackHostHeader('[::1]:4321')).toBe(true);
      expect(isLoopbackHostHeader('[0:0:0:0:0:0:0:1]')).toBe(true);
      expect(isLoopbackHostHeader('[0:0:0:0:0:0:0:1]:4321')).toBe(true);
    });

    test('rejects non-loopback IPv6 literals', () => {
      expect(isLoopbackHostHeader('[::2]:4321')).toBe(false);
      expect(isLoopbackHostHeader('[2001:db8::1]:4321')).toBe(false);
    });

    test('rejects remote hosts, empty and malformed values', () => {
      expect(isLoopbackHostHeader('evil.com')).toBe(false);
      expect(isLoopbackHostHeader('evil.com:4321')).toBe(false);
      expect(isLoopbackHostHeader('')).toBe(false);
      expect(isLoopbackHostHeader(undefined)).toBe(false);
      expect(isLoopbackHostHeader('localhost.evil.com')).toBe(false);
    });

    test('is not fooled by userinfo or path tricks', () => {
      expect(isLoopbackHostHeader('localhost@evil.com')).toBe(false);
      expect(isLoopbackHostHeader('evil.com/localhost')).toBe(false);
    });
  });

  test('a rebound Host is rejected on the static read path, not just /bus', async () => {
    const res = await request(app).get('/index.html').set('Host', 'evil.com');
    expect(res.status).toBe(403);
  });

  test('a rebound Host is rejected on /save', async () => {
    const res = await request(app)
      .post('/_/save')
      .set('Host', 'evil.com')
      .set('Page-URL', 'http://localhost:4321/index.html')
      .set('Content-Type', 'text/plain')
      .send('<html>x</html>');
    expect(res.status).toBe(403);
  });

  test('an IPv6 loopback Host is accepted', async () => {
    const res = await request(app).get('/index.html').set('Host', '[::1]:4321');
    expect(res.status).toBe(200);
  });

  test('a loopback Host is accepted', async () => {
    const res = await request(app).get('/index.html').set('Host', '127.0.0.1:4321');
    expect(res.status).toBe(200);
  });
});

describe('A0: directory listing escaping and href encoding', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'listing-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('escapeHtml then addWordBreaks never splits an entity apart', () => {
    const out = addWordBreaks(escapeHtml(`a<b>c&d"e'f`));
    expect(out).not.toMatch(/&[a-z#0-9]*<wbr>/);
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&#39;');
  });

  test('a filename carrying a script payload is escaped, not rendered', async () => {
    const hostile = 'note<img src=x onerror="alert(1)">.html';
    await fs.writeFile(path.join(dir, hostile), '<html>x</html>');

    const res = await request(app).get('/');
    expect(res.status).toBe(200);

    // The payload must not survive as live markup anywhere in the page.
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).not.toContain('onerror="alert(1)"');
    expect(res.text).toContain('&lt;img');
  });

  test('the href is percent-encoded, so # ? and % do not truncate the link', async () => {
    await fs.writeFile(path.join(dir, '50% off #1.html'), '<html>x</html>');

    const res = await request(app).get('/');
    expect(res.text).toContain('href="/50%25%20off%20%231.html"');
    expect(res.text).not.toContain('href="/50% off #1.html"');
  });

  test('encodePathSegments encodes each segment but keeps the separators', () => {
    expect(encodePathSegments('a b/c#d/50% off.html'))
      .toBe('a%20b/c%23d/50%25%20off.html');
  });

  test('breadcrumb links are percent-encoded too', async () => {
    await fs.mkdir(path.join(dir, 'my folder'));
    await fs.mkdir(path.join(dir, 'my folder', 'sub dir'));

    const res = await request(app).get('/my%20folder/sub%20dir');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/my%20folder"');
  });

  test('sites-versions is not advertised in the listing', async () => {
    await fs.mkdir(path.join(dir, 'sites-versions'));
    await fs.writeFile(path.join(dir, 'real.html'), '<html>x</html>');

    const res = await request(app).get('/');
    expect(res.text).toContain('real.html');
    expect(res.text).not.toContain('sites-versions');
  });
});

describe('A0 + A3: a name with %, # and a space survives listing, click and save', () => {
  let dir;
  let app;
  const NAME = '50% off #1.html';

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'roundtrip-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(dir, NAME), '<html>original</html>');
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('the listed href, followed literally, serves the file', async () => {
    const listing = await request(app).get('/');
    const href = /href="(\/50[^"]*\.html)"/.exec(listing.text)[1];

    // This is exactly what a browser sends when the user clicks the link.
    const res = await request(app).get(href);
    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>original</html>');
  });

  test('saving back through that same URL writes the right file', async () => {
    const encoded = encodePathSegments(NAME);
    const res = await request(app)
      .post('/_/save')
      .set('Page-URL', `http://localhost:4321/${encoded}`)
      .set('Content-Type', 'text/plain')
      .send('<html>saved</html>');

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, NAME), 'utf8')).toContain('saved');
  });

  // Express decodes regex-route captures itself (router/layer.js decode_param).
  // These two routes are the only regex-capture consumers, so they are the only
  // places a second decode can land: it throws URIError on a literal % and
  // silently resolves the wrong file for an escaped %20.
  test('the /tailwindcss route does not double-decode the name', async () => {
    const res = await request(app).get(`/tailwindcss/${encodePathSegments('50% off #1')}.css`);
    expect(res.status).not.toBe(400);
  });

  // The sibling /_/api route carries the identical fix but is not covered here:
  // it returns 500 for any name in this bare harness (including "plain.html"),
  // so a test could not tell the decode bug from the harness limitation.

  test('a name with a space and non-ASCII is reachable', async () => {
    await fs.writeFile(path.join(dir, 'café notes.html'), '<html>unicode</html>');

    const res = await request(app).get('/' + encodeURIComponent('café notes.html'));
    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>unicode</html>');
  });

  test('a malformed percent sequence is a 400, not a 500', async () => {
    const res = await request(app).get('/%E0%A4%A.html');
    expect(res.status).toBe(400);
  });

  test('the original bytes are served without a UTF-8 round trip', async () => {
    // Latin-1 0xE9; decoding this as UTF-8 and re-encoding would corrupt it.
    const raw = Buffer.concat([Buffer.from('<html>caf'), Buffer.from([0xe9]), Buffer.from('</html>')]);
    await fs.writeFile(path.join(dir, 'latin1.html'), raw);

    const res = await request(app).get('/latin1.html').buffer().parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(Buffer.compare(res.body, raw)).toBe(0);
  });
});

describe('A3: symlink escape blocked on both GET and POST', () => {
  let dir;
  let outside;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'symlink-')));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'outside-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    app = createApp(dir);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET');
    await fs.writeFile(path.join(outside, 'victim.html'), '<html>victim</html>');
  });

  afterEach(async () => {
    await cleanup(dir);
    await cleanup(outside);
    jest.restoreAllMocks();
  });

  test('GET through an unregistered out-of-tree link is refused', async () => {
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));

    const res = await request(app).get('/link.txt');
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('TOP SECRET');
  });

  test('GET through an out-of-tree link to an .html file is refused', async () => {
    await fs.symlink(path.join(outside, 'victim.html'), path.join(dir, 'link.html'));

    const res = await request(app).get('/link.html');
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('victim');
  });

  test('POST /save through an out-of-tree link does not overwrite the target', async () => {
    await fs.symlink(path.join(outside, 'victim.html'), path.join(dir, 'link.html'));

    const res = await request(app)
      .post('/_/save')
      .set('Page-URL', 'http://localhost:4321/link.html')
      .set('Content-Type', 'text/plain')
      .send('<html>PWNED</html>');

    expect(res.status).toBe(403);
    expect(await fs.readFile(path.join(outside, 'victim.html'), 'utf8')).toBe('<html>victim</html>');
  });

  test('a link through an out-of-tree DIRECTORY is refused too', async () => {
    await fs.symlink(outside, path.join(dir, 'linkdir'));

    const res = await request(app).get('/linkdir/secret.txt');
    expect(res.status).toBe(403);
  });

  test('traversal via encoded dot segments is refused', async () => {
    const res = await request(app).get('/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect([400, 403]).toContain(res.status);
  });

  test('an in-tree symlink still works (consent is about leaving the tree)', async () => {
    await fs.writeFile(path.join(dir, 'real.html'), '<html>real</html>');
    await fs.symlink(path.join(dir, 'real.html'), path.join(dir, 'alias.html'));

    const res = await request(app).get('/alias.html');
    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>real</html>');
  });

  test('a link present at open time is consented, not denied', async () => {
    // Consent is registered by the open-time walk, so the link must exist
    // BEFORE the folder is opened — which is the whole distinction.
    await fs.symlink(path.join(outside, 'victim.html'), path.join(dir, 'preexisting.html'));

    const consenting = createApp(dir);
    const res = await request(consenting).get('/preexisting.html');

    expect(res.status).toBe(200);
    expect(res.text).toBe('<html>victim</html>');
  });
});

describe('A4 + A5: dotfiles and internal directories', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reserved-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    app = createApp(dir);
  });

  afterEach(async () => {
    await cleanup(dir);
    jest.restoreAllMocks();
  });

  test('a dotfile returns a clean 404 and never its contents', async () => {
    await fs.writeFile(path.join(dir, '.env'), 'SECRET=1');

    const res = await request(app).get('/.env');
    expect(res.status).toBe(404);
    expect(res.text).toBe('File not found');
    expect(res.text).not.toContain('SECRET');
  });

  test('a file inside a dot directory returns a clean 404', async () => {
    await fs.mkdir(path.join(dir, '.hyperclay/api'), { recursive: true });
    await fs.writeFile(path.join(dir, '.hyperclay/api/index.json'), '{"private":true}');

    const res = await request(app).get('/.hyperclay/api/index.json');
    expect(res.status).toBe(404);
    expect(res.text).toBe('File not found');
  });

  test('sites-versions is reserved and never served', async () => {
    await fs.mkdir(path.join(dir, 'sites-versions/mysite'), { recursive: true });
    await fs.writeFile(path.join(dir, 'sites-versions/mysite/2026-01-01-00-00-00-000Z.html'), '<html>backup</html>');

    const file = await request(app).get('/sites-versions/mysite/2026-01-01-00-00-00-000Z.html');
    expect(file.status).toBe(404);
    expect(file.text).not.toContain('backup');

    const listing = await request(app).get('/sites-versions');
    expect(listing.status).toBe(404);
  });

  test('a missing file returns 404, not 500', async () => {
    const res = await request(app).get('/nope.html');
    expect(res.status).toBe(404);
  });

  test('a directory requested with an .html-looking URL is a 404, not a crash', async () => {
    await fs.mkdir(path.join(dir, 'weird.html'));

    const res = await request(app).get('/weird.html');
    expect(res.status).toBe(404);
  });
});
