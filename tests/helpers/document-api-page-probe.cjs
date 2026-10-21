const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../../src/main/server');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { documentEtag } = require('../../src/main/spec-wire');
const { pageFixture } = require('./page-fixture');

async function run() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-page-api-')));
  const file = path.join(dir, 'doc.html');
  const fixture = pageFixture();
  await fs.writeFile(file, fixture.html);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const root = { id: 'root-a', kind: 'team', path: dir, port: 0 };
  const server = require('node:http').createServer(createApp({ root, localAuthority: authority, devHooks: null }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = authority.bindTarget({ rootId: root.id, logicalPath: 'doc.html', canonicalPath: file, origin });
  const members = ['a', 'b'].map((clientId) => authority.registerEditor(target, { clientId, send: () => {} }));
  await authority.roomFor(target, () => ({ canonicalPath: file, identity: target.identity }));
  const get = () => request(server).get('/_/api/doc.html');
  const post = (data, etag, revision) => request(server).post('/_/api/doc.html')
    .set('Content-Type', 'application/json').set('If-Match', etag)
    .set('Page-If-Match', revision).send(JSON.stringify(data));
  const versions = path.join(dir, '.hyperclay', 'versions');
  try {
    const first = await get();
    assert.equal(first.status, 200);
    assert.equal(first.body.body, 'abc');
    assert.equal(first.headers['page-revision'], fixture.revision);
    const selected = await request(server).get('/_/api/doc.html').query({ data: '{body:"article p"}' });
    assert.equal(selected.status, 200);
    assert.equal(selected.body.body, 'abc');
    assert.equal(selected.headers['page-revision'], fixture.revision);
    assert.equal((await request(server).get('/_/meta')).body.extensions.includes('page'), true);
    const missing = await request(server).post('/_/api/doc.html')
      .set('Content-Type', 'application/json').set('If-Match', first.headers.etag)
      .send(JSON.stringify({ body: 'new' }));
    assert.equal(missing.status, 428);
    assert.equal((await post({ body: 'new' }, '"old"', first.headers['page-revision'])).status, 412);
    assert.equal((await post({ body: 'new' }, '*', first.headers['page-revision'])).status, 412);
    const invalid = await post({ rev: 'fake' }, first.headers.etag, first.headers['page-revision']);
    assert.equal(invalid.status, 422);
    assert.equal(await fs.readFile(file, 'utf8'), fixture.html);
    assert.deepEqual(await fs.readdir(versions).catch(() => []), []);

    const room = authority.rooms.get(file);
    const occupied = authority.rooms.holdPersistent(file, { nodeId: room.nodeId });
    try {
      const conflict = await post({ body: 'new' }, first.headers.etag, first.headers['page-revision']);
      assert.equal(conflict.status, 503);
      assert.equal(conflict.body.code, 'checkpointing');
    } finally {
      authority.rooms.releasePersistent(occupied);
    }
    const accepted = await request(server).post('/_/sync/data?client-id=b')
      .set('Origin', origin).set('Document-URL', `${origin}/doc.html`)
      .send({ conn: members[1].conn, name: 'page', n: 1, epoch: room.epoch,
        pageGeneration: room.pageTransition?.id ?? null,
        ops: [{ op: 'set', path: ['y', 'edit-b-1'], value: fixture.update }] });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.body.seq > 0);
    const beforeRoom = JSON.stringify(authority.rooms.state(room));
    const beforeBytes = await fs.readFile(file, 'utf8');
    const beforeBackups = await fs.readdir(versions).catch(() => []);
    const stale = await post({ body: 'new' }, first.headers.etag, first.headers['page-revision']);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'revision-stale');
    assert.equal(await fs.readFile(file, 'utf8'), beforeBytes);
    assert.equal(JSON.stringify(authority.rooms.state(room)), beforeRoom);
    assert.deepEqual(await fs.readdir(versions).catch(() => []), beforeBackups);
    const fresh = await get();
    assert.equal(fresh.body.body, 'ac');
    assert.notEqual(fresh.headers['page-revision'], first.headers['page-revision']);
    const written = await post({ body: 'new' }, fresh.headers.etag, fresh.headers['page-revision']);
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.equal(written.body.body, 'new');
    assert.notEqual(written.headers['page-revision'], fresh.headers['page-revision']);
    const stored = await fs.readFile(file, 'utf8');
    assert.match(stored, />new<\/p>/);
    assert.equal(documentEtag(stored), written.headers.etag);
    assert.ok(authority.rooms.state(room).stores.page.value.y);
    console.log('page API proof passed');
  } finally {
    for (const member of members) member.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
