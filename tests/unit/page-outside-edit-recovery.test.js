const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('upath');
const assert = require('node:assert/strict');
const { splitPage } = require('@panphora/clayjs/server/rooms');
const { createBackup } = require('../../src/main/utils/backup');
const { documentEtag } = require('../../src/main/spec-wire');
const { RootServer } = require('../../src/main/root-servers');
const { RootObserver } = require('../../src/main/root-observer');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { createLocalCheckpoint } = require('../../src/main/local-checkpoint');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { storePageState, logicalBytes } = require('../../src/main/page-state-store');
const { execFileSync } = require('node:child_process');
const { pageFixture } = require('../helpers/page-fixture');

// A Yjs update that types more after what the room holds.
function typeMore(value) {
  const script = `
    import * as Y from '@panphora/clayjs/src/vendor/yjs.vendor.js';
    import { docFromValue, enc } from '@panphora/clayjs/src/page/ybind/provider.js';
    const doc = docFromValue(${JSON.stringify(value)}, { strict: true });
    doc.getText('flow').insert(3, 'NEW');
    console.log(JSON.stringify(enc(Y.encodeStateAsUpdateV2(doc))));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' }));
}

// An outside edit the open room keeps waits for a tab to merge it in. Until then
// the room's unsaved edits get a recovered copy holding them, not the outside edit.
async function run(mode, { second = false } = {}) {
  const dir = path.resolve(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `outside-edit-${mode}-`))));
  const file = path.join(dir, 'A.html');
  const older = pageFixture('abc');
  const stored = pageFixture('xyz');
  await fs.writeFile(file, await storePageState(dir, 'A.html', older.html));
  await createBackup(dir, 'A', splitPage(older.html).file);
  await fs.writeFile(file, await storePageState(dir, 'A.html', stored.html));
  await createBackup(dir, 'A', splitPage(stored.html).file);
  const authority = createLocalAuthority({ withDocument: withDocumentWrite });
  const checkpoint = createLocalCheckpoint({ authority, withDocument: withDocumentWrite });
  authority.setCheckpointService(checkpoint);
  const root = { id: 'root-a', kind: 'personal', path: dir, port: 0 };
  const published = [];
  const server = new RootServer(root, { localAuthority: authority, localCheckpoint: checkpoint,
    observer: { publishExternal: (...args) => published.push(args) } });
  try {
    assert.equal((await server.start()).ok, true);
    const origin = `http://127.0.0.1:${server.server.address().port}`;
    const target = authority.bindTarget({ rootId: root.id, logicalPath: 'A.html', canonicalPath: file, origin });
    const room = await authority.roomFor(target, () => ({ rootId: root.id, logicalPath: 'A.html', canonicalPath: file, identity: target.identity }));
    const edited = authority.rooms.apply(room, 'editor', { name: 'page', n: 1, epoch: room.epoch,
      pageGeneration: room.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-1'], value: stored.update }] });
    assert.equal(edited.error, undefined);
    assert.equal(authority.roomIsDirty(room), true);
    const before = await logicalBytes(dir, 'A.html', await fs.readFile(file));
    const incoming = mode === 'stale-save'
      ? splitPage(older.html).file.replace('>abc<', '>outside<')
      : splitPage(stored.html).file.replace('>xyz<', '>outside<');
    const write = async (html) => {
      if (mode === 'same-rev-disk') {
        const observer = new RootObserver(root, { localAuthority: authority, live: { notify() {}, broadcast() {} } });
        observer._runDataGuard = () => {};
        await fs.writeFile(file, html);
        await observer._raw('change', 'A.html');
        await observer.stop();
      } else {
        const current = await logicalBytes(dir, 'A.html', await fs.readFile(file));
        const saved = await fetch(`${origin}/save`, { method: 'POST', headers: { Origin: origin,
          'Page-URL': `${origin}/A.html`, 'Content-Type': 'text/plain', 'If-Match': documentEtag(current) }, body: html });
        assert.equal(saved.status, 200);
      }
    };
    const recovered = async () => {
      const copiesDir = path.join(dir, '.hyperclay/recovered/A');
      const copies = await fs.readdir(copiesDir).catch(() => []);
      return Promise.all(copies.map(n => fs.readFile(path.join(copiesDir, n), 'utf8')));
    };
    expect(documentEtag(before)).toBeTruthy();
    await write(incoming);
    const contents = await recovered();
    expect(authority.rooms.get(file)).toBe(room);
    expect(contents).toHaveLength(1);
    expect(contents[0]).toContain('>xz<');
    expect(contents[0]).not.toContain('>outside<');
    if (!second) return;
    assert.equal(authority.rooms.apply(room, 'editor', { name: 'page', n: 2, epoch: room.epoch,
      pageGeneration: room.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-2'], value: typeMore(room.stores.get('page').value) }] }).error, undefined);
    await write(incoming.replace('>outside<', '>second outside<'));
    const after = await recovered();
    expect(after).toHaveLength(2);
    expect(after.filter((html) => html.includes('>xzNEW<'))).toHaveLength(1);
    expect(after.some((html) => html.includes('outside<'))).toBe(false);
  } finally { await server.stop(); await fs.rm(dir, { recursive: true, force: true }); }
}

// Each case drives real rooms, and the first one pays for loading them; 5 s is too
// tight for that on a busy Windows runner.
jest.setTimeout(30000);

describe('an outside edit over a dirty room keeps its unsaved edits as a recovered copy', () => {
  test('a save at the current revision', () => run('same-rev-save'));
  test('a save based on an older version', () => run('stale-save'));
  test('a disk write at the current revision', () => run('same-rev-disk'));
  test('a second save before any tab merged the first keeps the newer typing', () => run('same-rev-save', { second: true }));
  test('a second disk write before any tab merged the first keeps the newer typing', () => run('same-rev-disk', { second: true }));
});
