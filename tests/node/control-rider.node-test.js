// Rider 1 (Hyperclay Local): applyRemoteResolution — apply an inbound cross-device
// Dismiss to the local guard store. Proves the hash-match clear, no-clear on
// mismatch, never-create, path safety, deadlock-freedom, and idempotency.
// See plans/hyperclay-local/sse-control-lane-plan.md §4c/§9.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require('../../src/main/data-loss-guard');
const core = require('../../src/main/data-loss-core.cjs');
const { liveSync } = require('livesync-hyperclay');

const ISLAND = { api: { title: 'hi', body: 'text' } };
const HASH = core.islandHash(ISLAND);

function seedEvent(baseDir, name, recoverableData) {
  return guard._writeGuard(baseDir, name, {
    baseline: { data: recoverableData, hash: core.islandHash(recoverableData), at: 1 },
    uiWorkPending: false,
    event: { id: 'E1', recoverableData, recoverableHtmlBackup: null, firstDetectedAt: 1, lastWriteAt: 1, lossSummary: {}, status: 'pending' },
    status: 'pending',
  });
}
function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rider-')); }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('deadlock/timeout')), ms))]);

test('hash match clears the event, sets status dismissed, notifies the REAL id, and COMPLETES (no nested-lock deadlock)', async () => {
  const baseDir = freshDir();
  const name = 'foo.html';
  fs.writeFileSync(path.join(baseDir, name), '<html><body>no api tag</body></html>');
  await seedEvent(baseDir, name, ISLAND);
  const notified = [];
  const orig = liveSync.notify;
  liveSync.notify = (n, msg) => { notified.push({ n, msg }); };
  let applied;
  try {
    applied = await withTimeout(guard.applyRemoteResolution({ baseDir, name, recoverableDataHash: HASH }), 4000);
  } finally {
    liveSync.notify = orig;
  }
  assert.equal(applied, true);
  const g = await guard._readGuard(baseDir, name);
  assert.equal(g.event, null);
  assert.equal(g.status, 'dismissed');
  // the browser chip only clears when the notified id matches the real event id (not null)
  const resolved = notified.find((x) => x.msg && x.msg.action === 'resolved');
  assert.ok(resolved, 'expected a resolved notify');
  assert.equal(resolved.msg.data.id, 'E1');
});

test('hash mismatch preserves the event (a distinct incident keeps its warning)', async () => {
  const baseDir = freshDir();
  const name = 'foo.html';
  await seedEvent(baseDir, name, ISLAND);
  const applied = await guard.applyRemoteResolution({ baseDir, name, recoverableDataHash: core.islandHash({ api: { title: 'other' } }) });
  assert.equal(applied, false);
  const g = await guard._readGuard(baseDir, name);
  assert.notEqual(g.event, null);
});

test('never creates an event from a resolution', async () => {
  const baseDir = freshDir();
  const applied = await guard.applyRemoteResolution({ baseDir, name: 'foo.html', recoverableDataHash: HASH });
  assert.equal(applied, false);
  assert.equal(await guard._readGuard(baseDir, 'foo.html'), null);
});

test('rejects path traversal / absolute / non-site / bad-hash before any fs read', async () => {
  const baseDir = freshDir();
  await seedEvent(baseDir, 'foo.html', ISLAND);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name: '../evil.html', recoverableDataHash: HASH }), false);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name: '/etc/passwd.html', recoverableDataHash: HASH }), false);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name: 'a\\b.html', recoverableDataHash: HASH }), false);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name: 'foo.txt', recoverableDataHash: HASH }), false);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name: 'foo.html', recoverableDataHash: 'not-a-hash' }), false);
  // the seeded event must be untouched by every rejected call
  const g = await guard._readGuard(baseDir, 'foo.html');
  assert.notEqual(g.event, null);
});

test('idempotent: a duplicate apply after a clear is a no-op', async () => {
  const baseDir = freshDir();
  const name = 'foo.html';
  fs.writeFileSync(path.join(baseDir, name), '<html></html>');
  await seedEvent(baseDir, name, ISLAND);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name, recoverableDataHash: HASH }), true);
  assert.equal(await guard.applyRemoteResolution({ baseDir, name, recoverableDataHash: HASH }), false);
});
