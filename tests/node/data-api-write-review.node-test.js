// End-to-end review test for POST /_/api/<file>: the real Express app, the real
// hyper-html-api engine and the real commitDocument, nothing mocked, driven over
// HTTP. Run via `node --test` (see tests/unit/data-api-write-review.test.js for
// why jest cannot host it): jest's vm sandbox cannot run the engine's dynamic
// ESM import without --experimental-vm-modules, which this repo's jest config
// does not set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const os = require('node:os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { documentEtag } = require('../../src/main/spec-wire.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const SITE =
  '<!DOCTYPE html>\r\n' +
  '<html><head><script type="application/json" data-rules-name="api" data-rules-version="1">{title:"h1",items:"li[]"}</script></head><body>\r\n' +
  "<h1 class='x'>Hello</h1>\r\n" +
  '<ul><li>A</li><li>B</li></ul>\r\n' +
  '<p>&copy; keep</p>\r\n' +
  '</body></html>';

// The engine splices: it re-serialises the one element the rule rewrote, and that
// element's single-quoted attribute comes back double-quoted. Every byte outside
// it — the rules tag, the entity, the list, every CRLF — is the byte that was
// stored before.
const WRITTEN = SITE.replace(`<h1 class='x'>Hello</h1>`, '<h1 class="x">World</h1>');

// The api tag the write rules are read out of, with an arbitrary rules body.
function siteWithRules(rules) {
  return (
    '<!DOCTYPE html>\r\n' +
    `<html><head><script type="application/json" data-rules-name="api" data-rules-version="1">${rules}</script></head><body>\r\n` +
    '<h1>Hello</h1>\r\n' +
    '</body></html>'
  );
}

async function withSite(name, bytes, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-write-review-'));
  const file = path.join(dir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  const server = await listenLoopback(createApp(dir));
  try {
    return await fn({ dir, file, server, url: `/_/api/${name}` });
  } finally {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

const post = (server, url, body) =>
  request(server).post(url).set('Content-Type', 'application/json').send(body);

test('a write lands through the real engine and the real commit path', async () => {
  await withSite('site.html', SITE, async ({ dir, file, server, url }) => {
    const res = await post(server, url, JSON.stringify({ title: 'World' }));

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { title: 'World', items: ['A', 'B'] });

    const disk = await fs.readFile(file);
    assert.equal(disk.toString('utf8'), WRITTEN, 'only the heading changed');
    assert.ok(WRITTEN.includes('<p>&copy; keep</p>\r\n'), 'the entity and its CRLF survive');

    const versions = await fs.readdir(path.join(dir, '.hyperclay', 'versions'));
    assert.deepEqual(versions, ['site'], 'a version backup was published');

    assert.equal(res.headers.etag, documentEtag(disk), 'the ETag describes the bytes on disk');
  });
});

test('a non-UTF-8 file is refused with 400 and nothing is written', async () => {
  const bytes = Buffer.concat([
    Buffer.from('<!DOCTYPE html>\r\n<html><head><script type="application/json" data-rules-name="api" data-rules-version="1">{title:"h1"}</script></head><body>\r\n<h1>caf'),
    Buffer.from([0xe9]),
    Buffer.from('</h1>\r\n</body></html>\r\n')
  ]);
  await withSite('site.html', bytes, async ({ file, server, url }) => {
    const res = await post(server, url, JSON.stringify({ title: 'World' }));

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Unsupported encoding');
    assert.deepEqual(await fs.readFile(file), bytes, 'the stored bytes are untouched');
  });
});

test('a rule that targets a read-only DOM property is a 400', async () => {
  await withSite('site.html', siteWithRules('{t:"h1",tag:"h1@tagName"}'), async ({ server, url }) => {
    const res = await post(server, url, JSON.stringify({ tag: 'H2' }));

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Read-only rule');
  });
});

test('an oversize body is a 413 in JSON, not an HTML error page', async () => {
  await withSite('site.html', SITE, async ({ server, url }) => {
    const res = await post(server, url, `{"title":"${'a'.repeat(1_100_000)}"}`);

    assert.equal(res.status, 413);
    assert.equal(res.body.error, 'Payload Too Large');
    assert.match(res.headers['content-type'], /application\/json/);
  });
});

test('a bare POST /_/api writes index.html, as a bare GET reads it', async () => {
  await withSite('index.html', SITE, async ({ file, server }) => {
    const res = await post(server, '/_/api', JSON.stringify({ title: 'World' }));

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { title: 'World', items: ['A', 'B'] });
    assert.equal((await fs.readFile(file, 'utf8')), WRITTEN, 'the write reached index.html');
  });
});

test('a GET carries the ETag of the bytes it read', async () => {
  await withSite('site.html', SITE, async ({ file, server, url }) => {
    const res = await request(server).get(url);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { title: 'Hello', items: ['A', 'B'] });
    assert.equal(res.headers.etag, documentEtag(await fs.readFile(file)));
  });
});
