const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const request = require('supertest');
const { createApp } = require('../../src/main/server');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite, withStructureChange } = require('../../src/main/utils/write-queue');
const { pageFixture } = require('./page-fixture');

async function run() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-checkpoint-')));
  const file = path.join(dir, 'doc.html');
  const fixture = pageFixture();
  const html = fixture.html.replace('</head>', '<script type="application/json" merge="game" clay="live">{"score":0}</script></head>');
  await fs.writeFile(file, html);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  await withStructureChange(() => authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }));
  const tasks = [];
  const checkpoint = createLocalCheckpoint({
    authority, withDocument: withDocumentWrite,
    immediate: (fn) => { tasks.push(fn); return fn; },
    cancelImmediate: (fn) => { const at = tasks.indexOf(fn); if (at >= 0) tasks.splice(at, 1); },
  });
  authority.setCheckpointService(checkpoint);
  const root = { id: 'root-a', kind: 'team', path: dir, port: 0 };
  const server = http.createServer(createApp({ root, localAuthority: authority, localCheckpoint: checkpoint, devHooks: null }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = authority.bindTarget({ rootId: root.id, logicalPath: 'doc.html', canonicalPath: file, origin });
  const members = ['a', 'b'].map((clientId) => authority.registerEditor(target, { clientId, send: () => {} }));
  const room = await authority.roomFor(target, () => ({ canonicalPath: file, identity: target.identity }));
  const frame = (clientId, member, name, n, ops) => request(server).post(`/_/sync/data?client-id=${clientId}`)
    .set('Origin', origin).set('Document-URL', `${origin}/doc.html`)
    .send({ conn: member.conn, name, n, epoch: room.epoch,
      pageGeneration: room.pageTransition?.id ?? null, ops });
  try {
    assert.equal((await frame('b', members[1], 'page', 1,
      [{ op: 'set', path: ['y', 'edit-b-1'], value: fixture.update }])).status, 200);
    assert.equal((await frame('a', members[0], 'game', 1,
      [{ op: 'add', path: ['score'], n: 1 }])).status, 200);
    assert.equal(authority.roomIsDirty(room), true);
    members[0].close();
    assert.equal(tasks.length, 0);
    members[1].close();
    assert.equal(tasks.length, 1);
    tasks.shift()();
    const saved = await checkpoint.attempt(file);
    assert.equal(saved.kind, 'ok', JSON.stringify(saved));
    assert.equal(authority.roomIsDirty(room), false);
    const written = await fs.readFile(file, 'utf8');
    assert.match(written, /<p data-id="p">ac<\/p>/);
    const restart = `
      import { readFileSync } from 'node:fs';
      import { liveTags } from '@panphora/clayjs/server/rooms';
      import { readYValue } from '@panphora/clayjs/page/yjs';
      const html = readFileSync(process.argv[1], 'utf8');
      const tags = Object.fromEntries(liveTags(html).map(tag => [tag.name, JSON.parse(tag.text)]));
      const page = await readYValue(tags.page);
      console.log(JSON.stringify({ text: page.blocks.p.c, score: tags.game.score,
        article: html.match(/<article[^>]*>([\\s\\S]*?)<\\/article>/)[1] }));
    `;
    const decoded = JSON.parse(execFileSync(process.execPath,
      ['--input-type=module', '-e', restart, file], { cwd: process.cwd(), encoding: 'utf8' }));
    assert.deepEqual(decoded, { text: 'ac', score: 1, article: '<p data-id="p">ac</p>' });
    const versionDir = path.join(dir, '.hyperclay', 'versions', 'doc');
    const versionsBefore = await fs.readdir(versionDir);
    assert.equal((await checkpoint.retry(file)).kind, 'clean');
    assert.deepEqual(await fs.readdir(versionDir), versionsBefore);
    const sameValue = authority.rooms.apply(room, 'a', { name: 'game', n: 2,
      ops: [{ op: 'set', path: ['score'], value: 1 }], epoch: room.epoch });
    assert.ok(sameValue.seq > 0);
    assert.equal(authority.roomIsDirty(room), true);
    assert.equal((await checkpoint.retry(file)).kind, 'current');
    assert.equal(authority.roomIsDirty(room), false);
    assert.deepEqual(await fs.readdir(versionDir), versionsBefore);

    const incompletePath = path.join(dir, 'incomplete.html');
    await fs.writeFile(incompletePath, fixture.html);
    const incompleteTarget = authority.bindTarget({
      rootId: root.id, logicalPath: 'incomplete.html', canonicalPath: incompletePath, origin,
    });
    const incompleteMember = authority.registerEditor(incompleteTarget, { clientId: 'c', send: () => {} });
    const incompleteRoom = await authority.roomFor(incompleteTarget,
      () => ({ canonicalPath: incompletePath, identity: incompleteTarget.identity }));
    const midpoint = Math.ceil(fixture.update.length / 2);
    const firstPart = authority.rooms.apply(incompleteRoom, 'c', {
      name: 'page', n: 1, epoch: incompleteRoom.epoch,
      pageGeneration: incompleteRoom.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'later.0.2'], value: fixture.update.slice(0, midpoint) }],
    }, { connected: ['c'] });
    assert.ok(firstPart.seq > 0);
    const partial = await checkpoint.attempt(incompletePath);
    assert.deepEqual({ kind: partial.kind, reason: partial.reason }, { kind: 'refused', reason: 'incomplete-page' });
    assert.equal(await fs.readFile(incompletePath, 'utf8'), fixture.html);
    assert.deepEqual(await fs.readdir(path.join(dir, '.hyperclay', 'versions', 'incomplete')).catch(() => []), []);
    const secondPart = authority.rooms.apply(incompleteRoom, 'c', {
      name: 'page', n: 2, epoch: incompleteRoom.epoch,
      pageGeneration: incompleteRoom.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'later.1.2'], value: fixture.update.slice(midpoint) }],
    }, { connected: ['c'] });
    assert.ok(secondPart.seq > firstPart.seq);
    assert.equal((await checkpoint.retry(incompletePath)).kind, 'ok');
    assert.match(await fs.readFile(incompletePath, 'utf8'), /<p data-id="p">ac<\/p>/);
    incompleteMember.close();

    const latePath = path.join(dir, 'late.html');
    await fs.writeFile(latePath, html);
    const lateTarget = authority.bindTarget({ rootId: root.id, logicalPath: 'late.html', canonicalPath: latePath, origin });
    const lateRoom = await authority.roomFor(lateTarget, () => ({ canonicalPath: latePath, identity: lateTarget.identity }));
    const firstEdit = authority.rooms.apply(lateRoom, 'd', {
      name: 'page', n: 1, epoch: lateRoom.epoch, pageGeneration: lateRoom.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-d-1'], value: fixture.update }],
    });
    assert.ok(firstEdit.seq > 0);
    let writerStarted;
    const started = new Promise((resolve) => { writerStarted = resolve; });
    let releaseWriter;
    const waiting = new Promise((resolve) => { releaseWriter = resolve; });
    checkpoint.registerWriter(root.id, async (write) => {
      assert.equal(write.filePath, latePath);
      writerStarted();
      await waiting;
      await fs.writeFile(latePath, write.content);
      await authority.confirmKnownWrite(write.target, write.content, write.token);
      return write.content;
    });
    const inFlight = checkpoint.attempt(latePath);
    await started;
    const lateEdit = authority.rooms.apply(lateRoom, 'd', {
      name: 'game', n: 2, epoch: lateRoom.epoch,
      ops: [{ op: 'add', path: ['score'], n: 1 }],
    });
    assert.ok(lateEdit.seq > firstEdit.seq);
    releaseWriter();
    assert.equal((await inFlight).kind, 'ok');
    assert.match(await fs.readFile(latePath, 'utf8'), /<p data-id="p">ac<\/p>/);
    assert.equal(authority.rooms.state(lateRoom).stores.game.value.score, 1);
    assert.equal(authority.roomIsDirty(lateRoom), true);

    const next = authority.registerEditor(target, { clientId: 'a', send: () => {} });
    assert.equal((await frame('a', next, 'game', 3, [{ op: 'add', path: ['score'], n: 1 }])).status, 200);
    next.close();
    assert.equal(tasks.length, 1);
    await fs.unlink(file);
    await withDocumentWrite(() => ({ canonicalPath: file }), (_locked, token) =>
      authority.observeExternal(target, null, token, { removed: true }));
    tasks.shift()();
    const stale = await checkpoint.attempt(file, room);
    assert.equal(stale.kind, 'refused');
    assert.equal(stale.reason, 'invalid-identity');
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    const recovered = path.join(dir, '.hyperclay', 'recovered', 'doc');
    const copies = await fs.readdir(recovered);
    assert.ok(copies.length > 0);
    assert.ok((await fs.readFile(path.join(recovered, copies[0]), 'utf8')).includes('"score":2'));
    console.log('checkpoint proof passed');
  } finally {
    for (const member of members) member.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
