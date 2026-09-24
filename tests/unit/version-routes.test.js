// F1: htmlclay's three version routes -- list, read, restore -- answered by a
// document's path under the served folder instead of a token, out of the same
// `.hyperclay/versions/` store the save path writes.
//
// The property that matters most here is the address: a route that answered
// WITHOUT the `/_/` marker would shadow a user's own `versions/` folder, so the
// fall-through case is tested as deliberately as the routes themselves.

const fs = require('fs').promises;
const http = require('http');
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { createBackup } = require('../../src/main/utils/backup.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const PAGE = (n) => `<!DOCTYPE html><html lang="en"><body><p>${n}</p></body></html>`;

// A version name whose instant is far in the future, so the publisher's
// "reuse the newest committed instant" rule fires and the next backup lands in
// the same millisecond with a collision suffix.
const FUTURE_STAMP = '2031-01-01-00-00-00-000+0000.html';

// chmod 0 is not a refusal on Windows: there is no mode that makes a file
// unreadable to its owner, so that one case has nothing to prove there.
const describeUnlessWindows = process.platform === 'win32' ? describe.skip : describe;

// A client that normalizes the URL before it goes out (supertest and anything
// built on a URL parser) collapses `..`, which would make a traversal probe test
// the client instead of the host. This puts the raw bytes on the wire.
function rawRequest(port, method, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('version history routes', () => {
  let dir;
  let server;

  const versionsDir = (...segments) => path.join(dir, '.hyperclay', 'versions', ...segments);
  const docPath = (...segments) => path.join(dir, ...segments);

  const save = (html, name = 'board.html') => request(server)
    .post('/save')
    .set('Document-URL', `http://localhost:4321/${name}`)
    .set('Content-Type', 'text/plain')
    .send(html);

  const list = (name = 'board.html') => request(server).get(`/_/versions/${name}`);
  const readVersion = (name, version) => request(server).get(`/_/version/${name}/${version}`);
  const restore = (name, version, headers = {}) => {
    const req = request(server).post(`/_/restore/${name}/${version}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  };

  const versionBytes = (site, version) => fs.readFile(versionsDir(site, version), 'utf8');

  // The listing's own order: newest instant first, then the higher collision
  // suffix of that instant. Read here rather than trusted from the response.
  function newestFirst(entries) {
    return [...entries].sort((a, b) => (new Date(b.time) - new Date(a.time)) || (b.seq - a.seq));
  }

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'versions-routes-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    server = await listenLoopback(createApp(dir));
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.chmod(path.join(dir, 'board.html'), 0o644).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('three saves are three versions, newest first, in htmlclay\'s entry shape', async () => {
    // The document does not exist before the first save, so there is no
    // pre-save snapshot to count: exactly one version per save.
    for (const n of ['one', 'two', 'three']) {
      expect((await save(PAGE(n))).status).toBe(200);
    }

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('board.html');
    expect(res.body.versions).toHaveLength(3);

    for (const entry of res.body.versions) {
      expect(typeof entry.name).toBe('string');
      expect(entry.size).toBeGreaterThan(0);
      expect(typeof entry.seq).toBe('number');
      // ISO 8601 with the offset resolved, which is what a client parses.
      expect(new Date(entry.time).toISOString()).toBe(entry.time);
    }

    expect(res.body.versions.map((e) => e.name)).toEqual(
      newestFirst(res.body.versions).map((e) => e.name)
    );

    // The newest version holds what the last save wrote.
    const newest = res.body.versions[0];
    expect(await versionBytes('board', newest.name)).toContain('<p>three</p>');
    expect(await versionBytes('board', res.body.versions[2].name)).toContain('<p>one</p>');

    // Three saves three milliseconds apart on a normal clock leave every name
    // unsuffixed; a collision suffix is the subject of its own test below.
    const instants = new Set(res.body.versions.map((e) => e.time));
    if (instants.size === 3) expect(res.body.versions.map((e) => e.seq)).toEqual([0, 0, 0]);
  });

  test('two versions of one instant are both kept and numbered 0 and 1', async () => {
    await fs.mkdir(versionsDir('board'), { recursive: true });
    await fs.writeFile(versionsDir('board', FUTURE_STAMP), PAGE('first'));
    // The clock is behind the newest committed instant, so the publisher reuses
    // that instant and takes the next collision suffix.
    expect(await createBackup(dir, 'board', PAGE('second'))).toBeTruthy();

    const res = await list();
    expect(res.body.versions).toHaveLength(2);
    const [newest, older] = res.body.versions;
    expect(newest.time).toBe(older.time);
    expect(newest.seq).toBe(1);
    expect(older.seq).toBe(0);
    expect(newest.name).toBe(`2031-01-01-00-00-00-000+0000-001.html`);
    expect(older.name).toBe(FUTURE_STAMP);
  });

  test('without the marker the route is not there, and the folder serves normally', async () => {
    await fs.mkdir(docPath('versions'), { recursive: true });
    const served = PAGE('a folder named versions');
    await fs.writeFile(docPath('versions', 'board.html'), served);

    const res = await request(server).get('/versions/board.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe(served);
  });

  test('a nested document lists its own directory, not the folder root\'s', async () => {
    expect((await save(PAGE('nested one'), 'notes/board.html')).status).toBe(200);
    expect((await save(PAGE('nested two'), 'notes/board.html')).status).toBe(200);

    const nested = await list('notes/board.html');
    expect(nested.status).toBe(200);
    expect(nested.body.name).toBe('board.html');
    expect(nested.body.versions).toHaveLength(2);

    // The root board.html has its own (empty) history: the path is the identity.
    const root = await list();
    expect(root.status).toBe(200);
    expect(root.body.versions).toEqual([]);
  });

  test('a version name that is not one generated filename is 400', async () => {
    const res = await readVersion('board.html', 'not-a-version.html');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('invalid version name');
    expect(res.body.msg).toBe('invalid version name');
    expect(res.headers['cache-control']).toBe('no-store');

    const wrongExt = await readVersion('board.html', '2026-01-01-00-00-00-000+0000.txt');
    expect(wrongExt.status).toBe(400);
  });

  test('a traversal in the document path is refused and reads nothing outside', async () => {
    // A sibling folder outside the served one, holding a real document AND a real
    // versions store for it, so a route that resolved the path lexically rather
    // than validating its segments would have something to list and to read.
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'versions-outside-')));
    const version = '2026-01-01-00-00-00-000+0000.html';
    await fs.mkdir(path.join(outside, '.hyperclay', 'versions', 'outside'), { recursive: true });
    await fs.writeFile(path.join(outside, '.hyperclay', 'versions', 'outside', version), PAGE('outside the served folder'));
    await fs.writeFile(path.join(outside, 'outside.html'), PAGE('outside the served folder'));

    const rel = path.relative(dir, path.join(outside, 'outside.html')).split(path.sep).join('/');
    expect(rel.startsWith('../')).toBe(true);

    const port = server.address().port;
    try {
      const listed = await rawRequest(port, 'GET', `/_/versions/${rel}`);
      expect(listed.status).toBe(400);
      expect(listed.body).not.toContain('outside the served folder');
      expect(listed.body).not.toContain(version);

      const read = await rawRequest(port, 'GET', `/_/version/${rel}/${version}`);
      expect(read.status).toBe(400);
      expect(read.body).not.toContain('outside the served folder');

      const write = await rawRequest(port, 'POST', `/_/restore/${rel}/${version}`);
      expect(write.status).toBe(400);
      expect(await fs.readFile(path.join(outside, 'outside.html'), 'utf8'))
        .toBe(PAGE('outside the served folder'));
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test('read returns the version\'s own bytes, uncacheable', async () => {
    await save(PAGE('one'));
    await save(PAGE('two'));

    const listed = await list();
    const target = listed.body.versions[1];
    const res = await readVersion('board.html', target.name);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe(await versionBytes('board', target.name));

    const missing = await readVersion('board.html', '2026-01-01-00-00-00-000+0000.html');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not-found');
  });

  test('restore writes the version and leaves a safety version of what it replaced', async () => {
    await save(PAGE('one'));
    await save(PAGE('two'));
    const before = await list();
    const target = before.body.versions[1];
    expect(await versionBytes('board', target.name)).toBe(PAGE('one'));

    const res = await restore('board.html', target.name);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ ok: true, msg: `Restored ${target.name}`, msgType: 'success' });
    expect(await fs.readFile(docPath('board.html'), 'utf8')).toBe(PAGE('one'));

    // The safety copy is mandatory: the bytes the restore replaced are still
    // recoverable, under a name that did not exist before it ran.
    const known = new Set(before.body.versions.map((e) => e.name));
    const after = await list();
    const added = after.body.versions.filter((e) => !known.has(e.name));
    expect(added.length).toBeGreaterThan(0);
    const safety = [];
    for (const entry of added) {
      if ((await versionBytes('board', entry.name)) === PAGE('two')) safety.push(entry);
    }
    expect(safety).toHaveLength(1);
  });

  test('a restore reaches edit-mode tabs through the observer', async () => {
    const observer = { publishExternal: jest.fn() };
    const ctx = { root: { id: 'version-routes-root', kind: 'personal', path: dir, port: 0 }, devHooks: null, isKnownPath: null, observer };
    const observed = await listenLoopback(createApp(ctx));

    const post = (html) => request(observed)
      .post('/save')
      .set('Document-URL', 'http://localhost:4321/board.html')
      .set('Content-Type', 'text/plain')
      .send(html);

    expect((await post(PAGE('one'))).status).toBe(200);
    expect((await post(PAGE('two'))).status).toBe(200);
    const listed = await request(observed).get('/_/versions/board.html');
    const target = listed.body.versions[1];

    const res = await request(observed).post(`/_/restore/board.html/${target.name}`);
    expect(res.status).toBe(200);
    expect(observer.publishExternal).toHaveBeenCalledTimes(1);
    const [rel, bytes, msg] = observer.publishExternal.mock.calls[0];
    expect(rel).toBe('board.html');
    expect(bytes.toString('utf8')).toBe(PAGE('one'));
    expect(msg).toBe('board.html was restored from a backup');
  });

  describeUnlessWindows('an unreadable current file', () => {
    test('refuses the restore rather than destroying it with no safety copy', async () => {
      await save(PAGE('one'));
      await save(PAGE('two'));
      const target = (await list()).body.versions[1];
      await fs.chmod(docPath('board.html'), 0o000);

      const res = await restore('board.html', target.name);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('current file cannot be read, so no safety backup is possible');

      await fs.chmod(docPath('board.html'), 0o644);
      // Nothing was written, and no version was added.
      expect(await fs.readFile(docPath('board.html'), 'utf8')).toBe(PAGE('two'));
      expect((await list()).body.versions).toHaveLength(2);
    });
  });

  test('restore of a version that is not a document is 422 and writes nothing', async () => {
    await save(PAGE('one'));
    const junk = await createBackup(dir, 'board', 'not a complete document');
    const name = path.basename(junk);

    const res = await restore('board.html', name);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('invalid-document');
    expect(res.body.msgType).toBe('error');
    expect(await fs.readFile(docPath('board.html'), 'utf8')).toBe(PAGE('one'));
  });

  test('a cross-site restore is 403', async () => {
    await save(PAGE('one'));
    await save(PAGE('two'));
    const target = (await list()).body.versions[1];

    const res = await restore('board.html', target.name, { 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(res.body.msgType).toBe('error');
    expect(await fs.readFile(docPath('board.html'), 'utf8')).toBe(PAGE('two'));
  });
});
