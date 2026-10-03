const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const os = require('node:os');
const request = require('supertest');
const { createApp } = require('../../src/main/server');
const { documentEtag } = require('../../src/main/spec-wire');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const HTML = '<!doctype html><html><head></head><body><h1>Hello</h1><h2>Other</h2></body></html>';
const query = '?data=' + encodeURIComponent('{title:h1}');
const tagged = (value) => `<script data-rules-name="api" data-rules-version="1">{title:h1}</script><h1>${value}</h1>`;
async function fixture(fn) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'json-routes-')));
  const server = await listenLoopback(createApp(dir));
  try { await fn(dir, server); }
  finally {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}
const post = (server, url, data) => request(server).post(url).set('Content-Type', 'application/json').send(JSON.stringify(data));

for (const extension of ['html', 'htmlclay']) {
  for (const prefix of ['/', '/_/api/']) {
    test(`${prefix} tagless ${extension} read and write, ETag, no-op, stale write`, async () => fixture(async (dir, server) => {
      const name = `site.${extension}`;
      const file = path.join(dir, name);
      await fs.writeFile(file, HTML);
      const url = prefix + name + query;
      const read = await request(server).get(url);
      assert.equal(read.status, 200);
      assert.deepEqual(read.body, { title: 'Hello' });
      assert.equal(read.headers.etag, documentEtag(Buffer.from(HTML)));
      const write = await post(server, url, { title: 'World' }).set('If-Match', read.headers.etag);
      assert.equal(write.status, 200, JSON.stringify(write.body));
      assert.deepEqual(write.body, { title: 'World' });
      const other = await request(server).get((prefix === '/' ? '/_/api/' : '/') + name + query);
      assert.deepEqual(other.body, write.body);
      assert.equal(other.headers.etag, write.headers.etag);
      const stamp = (await fs.stat(file)).mtimeMs;
      assert.equal((await post(server, url, { title: 'World' })).status, 200);
      assert.equal((await fs.stat(file)).mtimeMs, stamp);
      assert.equal((await post(server, url, { title: 'Stale' }).set('If-Match', read.headers.etag)).status, 412);
      assert.match(await fs.readFile(file, 'utf8'), /<h1>World<\/h1>/);
    }));
  }
}

test('supplied rules override malformed tags and never fall back on bad input', async () => fixture(async (dir, server) => {
  const html = '<script data-rules-name="api">{bad</script>' + HTML;
  await fs.writeFile(path.join(dir, 'site.htmlclay'), html);
  for (const prefix of ['/', '/_/api/']) {
    assert.equal((await request(server).get(prefix + 'site.htmlclay' + query)).status, 200);
    assert.equal((await post(server, prefix + 'site.htmlclay' + query, { title: 'Hello' })).status, 200);
    for (const bad of ['?data=', '?data=%7Bbad', '?data=%FF', '?data=%ZZ', '?data=' + encodeURIComponent('{title:"["}'), query + '&data=h2']) {
      assert.equal((await request(server).get(prefix + 'site.htmlclay' + bad)).status, 400, `GET ${prefix}${bad}`);
      assert.equal((await post(server, prefix + 'site.htmlclay' + bad, { title: 'wrong' })).status, 400, `POST ${prefix}${bad}`);
    }
    assert.equal((await post(server, prefix + 'site.htmlclay?data=null', { title: 'wrong' })).status, 400);
  }
  assert.equal(await fs.readFile(path.join(dir, 'site.htmlclay'), 'utf8'), html);
}));

test('plain aliases preserve origin, payload and content policy checks', async () => fixture(async (dir, server) => {
  await fs.writeFile(path.join(dir, 'site.htmlclay'), HTML);
  const url = '/site.htmlclay' + query;
  assert.equal((await post(server, url, { title: 'wrong' }).set('Origin', 'https://example.com')).status, 403);
  assert.equal((await request(server).post(url).set('Content-Type', 'text/plain').send('{}')).status, 415);
  assert.equal((await request(server).post(url).set('Content-Type', 'application/json').send('{bad')).status, 400);
  assert.equal((await post(server, url, { title: 'x'.repeat(1024 * 1024) })).status, 413);
  assert.equal((await post(server, url, { unknown: 'wrong' })).status, 400);
  const guarded = '<script>const n = 1;</script>' + HTML;
  await fs.writeFile(path.join(dir, 'site.htmlclay'), guarded);
  const refused = await post(server, '/site.htmlclay?data=' + encodeURIComponent('{title:h1,code:script}'), { title: 'wrong', code: 'changed' });
  assert.equal(refused.status, 400);
  assert.equal(await fs.readFile(path.join(dir, 'site.htmlclay'), 'utf8'), guarded);
  const plain = await post(server, '/site.htmlclay', { title: 'wrong' });
  assert.match(plain.headers['content-type'], /text\/html/);
  assert.equal(await fs.readFile(path.join(dir, 'site.htmlclay'), 'utf8'), guarded);
  assert.notEqual((await post(server, '/_/save/site.htmlclay' + query, { title: 'wrong' })).status, 200);
}));

test('encoded nested names, SPA paths and user api folders retain their file identity', async () => fixture(async (dir, server) => {
  await fs.mkdir(path.join(dir, 'api'));
  const name = 'api/50% off.htmlclay';
  await fs.writeFile(path.join(dir, name), HTML);
  const url = '/api/50%25%20off.htmlclay/route' + query;
  assert.equal((await post(server, url, { title: 'Changed' })).status, 200);
  assert.deepEqual((await request(server).get('/_/api/api/50%25%20off.htmlclay' + query)).body, { title: 'Changed' });
  const page = await request(server).get('/api/50%25%20off.htmlclay');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.equal((await request(server).get('/missing.htmlclay' + query)).status, 404);
}));

test('same-basename tag caches remain independent through reads, writes and deletion', async () => fixture(async (dir, server) => {
  await fs.mkdir(path.join(dir, 'nested'));
  const names = ['nested/soup.html', 'nested/soup.htmlclay'];
  for (let i = 0; i < names.length; i++) await fs.writeFile(path.join(dir, names[i]), tagged(String(i)));
  await fs.mkdir(path.join(dir, '.hyperclay/api/nested'), { recursive: true });
  await fs.writeFile(path.join(dir, '.hyperclay/api/nested/soup.json'), '{"title":"legacy"}');
  for (const i of [0, 1, 0, 1]) {
    const result = await request(server).get('/_/api/' + names[i]);
    assert.deepEqual(result.body, { title: String(i) });
    assert.equal(result.headers.etag, documentEtag(await fs.readFile(path.join(dir, names[i]))));
  }
  assert.equal((await post(server, '/_/api/' + names[0], { title: 'updated' })).status, 200);
  assert.deepEqual((await request(server).get('/_/api/' + names[1])).body, { title: '1' });
  await fs.unlink(path.join(dir, names[0]));
  assert.equal((await request(server).get('/_/api/' + names[0])).status, 404);
  assert.deepEqual((await request(server).get('/_/api/' + names[1])).body, { title: '1' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, '.hyperclay/api-v2', names[1] + '.json'), 'utf8')), { title: '1' });
}));

test('invalid rules for an omitted body field fail before any commit', async () => fixture(async (dir, server) => {
  const file = path.join(dir, 'site.htmlclay');
  await fs.writeFile(file, HTML);
  for (const prefix of ['/', '/_/api/']) {
    const result = await post(server, prefix + 'site.htmlclay?data=' + encodeURIComponent('{title:h1,unused:"["}'), { title: 'wrong' });
    assert.equal(result.status, 400);
    assert.equal(await fs.readFile(file, 'utf8'), HTML);
    await assert.rejects(fs.stat(path.join(dir, '.hyperclay/versions')));
  }
}));


test('plain data writes in system-named folders use the JSON API body reader', async () => fixture(async (dir, server) => {
  for (const folder of ['save', 'sync', 'live-sync', 'data-loss']) {
    await fs.mkdir(path.join(dir, folder));
    const file = path.join(dir, folder, 'site.htmlclay');
    await fs.writeFile(file, HTML);
    const url = '/' + folder + '/site.htmlclay' + query;
    const result = await post(server, url, { title: 'Changed' });
    assert.equal(result.status, 200, folder + JSON.stringify(result.body));
    assert.deepEqual(result.body, { title: 'Changed' });
    const bytes = await fs.readFile(file, 'utf8');
    assert.equal((await post(server, url, { title: 'x'.repeat(1024 * 1024) })).status, 413, folder);
    assert.equal(await fs.readFile(file, 'utf8'), bytes);
  }
}));


test('legacy double-extension caches cannot be mistaken for new source caches', async () => fixture(async (dir, server) => {
  await fs.writeFile(path.join(dir, 'x.html'), tagged('current'));
  await fs.mkdir(path.join(dir, '.hyperclay/api'), { recursive: true });
  await fs.writeFile(path.join(dir, '.hyperclay/api/x.html.json'), '{"title":"old x.html.html data"}');
  const result = await request(server).get('/_/api/x.html');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { title: 'current' });
  assert.equal(result.headers.etag, documentEtag(await fs.readFile(path.join(dir, 'x.html'))));
}));
