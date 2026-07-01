// Real-engine orchestration test for the Hyperclay Local data-clobber guard.
// Run via `node --test` (npm run test:node), NOT jest: it exercises the dynamic
// import() of the pure-ESM hyper-html-api engine (apply/extract). The filename
// ends in `.node-test.js` so jest's testMatch skips it.
//
// Covers: cold seed, fire on destruction, the restore round-trip, revert via the
// recover file, pin-once across a write chain, baseline advance on a clean
// gesture, provenance, page-load seed-on-read, and cross-environment auto-clear.
// No network; a temp baseDir per test; liveSync notify is a no-op (no clients).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fsp = require('fs').promises;
const guard = require('../../src/main/data-loss-guard');

const NAME = 'app.html';

function page({ title = 'Title', items = ['a', 'b', 'c'] } = {}) {
  const lis = items.map((t) => `<li class="item">${t}</li>`).join('');
  return `<!DOCTYPE html><html><head>
<script type="application/json" data-rules-name="api" data-rules-version="1">
{ "title": "h1", "items": ".item[]" }
</script></head><body>
<h1>${title}</h1>
<ul id="list">${lis}</ul>
</body></html>`;
}

async function freshBaseDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'dlg-'));
}

// Cold-seed the baseline from a known-good prev, then run the clobber write.
async function seedThenWrite(baseDir, orig, clobber, prov = 'external') {
  await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: orig, prevContent: orig, prov: 'external' });
  return guard.runDataLossGuard({ baseDir, name: NAME, newHtml: clobber, prevContent: orig, prov });
}

test('provenanceForLocalSave maps the userDriven bit (missing reads ui-unknown)', () => {
  assert.strictEqual(guard.provenanceForLocalSave(true), 'ui-gestured');
  assert.strictEqual(guard.provenanceForLocalSave(false), 'ui-background');
  assert.strictEqual(guard.provenanceForLocalSave(undefined), 'ui-unknown');
});

test('first sight blind-seeds and does not fire (no prev to compare)', async () => {
  const baseDir = await freshBaseDir();
  const ev = await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: page(), prevContent: null, prov: 'external' });
  assert.strictEqual(ev, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.ok(g.baseline);
  assert.strictEqual(g.event, null);
});

test('external destruction fires with a client event', async () => {
  const baseDir = await freshBaseDir();
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a'] }), 'external');
  assert.ok(ev);
  assert.ok(ev.id);
  assert.strictEqual(ev.canRevert, true);
  assert.strictEqual(ev.lossSummary.provenance, 'external');
  assert.ok(ev.preview.length > 0);
});

test('a deliberate single-item removal under a gesture stays silent and advances the baseline', async () => {
  const baseDir = await freshBaseDir();
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a', 'b'] }), 'ui-gestured');
  assert.strictEqual(ev, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
  assert.strictEqual(g.uiWorkPending, true);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b']); // advanced to the blessed save
});

test('a big clobber fires even under a gesture', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ title: 'Keep', items: ['alpha', 'bravo', 'charlie', 'delta', 'echo'] });
  const clobber = page({ title: 'Keep', items: ['alpha'] });
  const ev = await seedThenWrite(baseDir, orig, clobber, 'ui-gestured');
  assert.ok(ev);
});

test('restore re-applies the recoverable data and clears the event', async () => {
  const baseDir = await freshBaseDir();
  const clobber = page({ items: ['a'] });
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), clobber, 'external');
  assert.strictEqual(ev.restorable, true);

  let written = null;
  const res = await guard.resolveGuard({
    baseDir, name: NAME, id: ev.id, choice: 'restore',
    currentHtml: clobber, writeBack: async (html) => { written = html; },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.status, 'restored');
  assert.ok(written.includes('<li class="item">a</li>'));
  assert.ok(written.includes('<li class="item">b</li>'));
  assert.ok(written.includes('<li class="item">c</li>'));
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
});

test('when the list was fully emptied, restore reports failed and revert is offered', async () => {
  const baseDir = await freshBaseDir();
  const emptied = page({ items: [] });
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), emptied, 'external');
  assert.strictEqual(ev.restorable, false); // no sibling to clone -> can't round-trip
  assert.strictEqual(ev.canRevert, true);

  const restoreRes = await guard.resolveGuard({
    baseDir, name: NAME, id: ev.id, choice: 'restore', currentHtml: emptied, writeBack: async () => {},
  });
  assert.strictEqual(restoreRes.ok, false);
  assert.strictEqual(restoreRes.statusCode, 422);

  let written = null;
  const revertRes = await guard.resolveGuard({
    baseDir, name: NAME, id: ev.id, choice: 'revert', currentHtml: emptied, writeBack: async (html) => { written = html; },
  });
  assert.strictEqual(revertRes.ok, true);
  assert.ok(written.includes('<li class="item">a</li>')); // whole-file last-good restored
});

test('dismiss accepts the current data as the new baseline and clears', async () => {
  const baseDir = await freshBaseDir();
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a'] }), 'external');
  const res = await guard.resolveGuard({
    baseDir, name: NAME, id: ev.id, choice: 'dismiss', currentHtml: page({ items: ['a'] }), writeBack: async () => {},
  });
  assert.strictEqual(res.ok, true);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a']);
});

test('pin-once: subsequent external destruction never overwrites the first recoverable data', async () => {
  const baseDir = await freshBaseDir();
  await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a', 'b'] }), 'external'); // fires, pins orig
  const before = await guard._readGuard(baseDir, NAME);
  const pinned = JSON.stringify(before.event.recoverableData);
  await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: page({ items: [] }), prevContent: page({ items: ['a', 'b'] }), prov: 'external' });
  const after = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(JSON.stringify(after.event.recoverableData), pinned);
  assert.deepStrictEqual(after.event.recoverableData.api.items, ['a', 'b', 'c']);
});

test('cross-environment auto-clear: an incoming write that restores the pinned data clears the event', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ items: ['a', 'b', 'c'] });
  const ev = await seedThenWrite(baseDir, orig, page({ items: ['a'] }), 'external');
  assert.ok(ev);
  const cleared = await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: orig, prevContent: page({ items: ['a'] }), prov: 'external' });
  assert.strictEqual(cleared, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
  assert.strictEqual(g.status, 'restored');
});

test('a pinned event is NOT auto-cleared when a later write MODIFIES (not restores) the recoverable atoms', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ title: 'Title', items: ['a', 'b', 'c'] });
  // Wipe the title -> fires, pins {title:'Title', items:[a,b,c]}.
  const ev = await seedThenWrite(baseDir, orig, page({ title: '', items: ['a', 'b', 'c'] }), 'external');
  assert.ok(ev);
  const pinned = JSON.parse(JSON.stringify((await guard._readGuard(baseDir, NAME)).event.recoverableData));

  // A later write refills the title with a DIFFERENT value (modification, not
  // restoration). The loss is NOT undone, so the event must stay pending and the
  // pinned recoverable data must be untouched (regression for the auto-clear that
  // used !anyDestruction, which treated modification as "undone").
  await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ title: 'Different', items: ['a', 'b', 'c'] }),
    prevContent: page({ title: '', items: ['a', 'b', 'c'] }), prov: 'external',
  });
  const g = await guard._readGuard(baseDir, NAME);
  assert.ok(g.event, 'event must stay pending after a modifying write');
  assert.deepStrictEqual(g.event.recoverableData, pinned); // pin-once intact
});

test('getGuardEvent seeds the baseline on first read without firing, then an external clobber fires', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ items: ['a', 'b', 'c'] });
  const onRead = await guard.getGuardEvent(baseDir, NAME, orig);
  assert.strictEqual(onRead, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b', 'c']);

  const ev = await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: page({ items: ['a'] }), prevContent: orig, prov: 'external' });
  assert.ok(ev);
  const again = await guard.getGuardEvent(baseDir, NAME, page({ items: ['a'] }));
  assert.strictEqual(again.id, ev.id);
});

test('getGuardEvent does not seed for an island-less page', async () => {
  const baseDir = await freshBaseDir();
  const noIsland = '<!DOCTYPE html><html><head></head><body><h1>plain</h1></body></html>';
  const onRead = await guard.getGuardEvent(baseDir, NAME, noIsland);
  assert.strictEqual(onRead, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g, null); // no guard file created
});

test('a data-rules-version skew fails open: the write proceeds, no guard action', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ items: ['a', 'b', 'c'] });
  await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: orig, prevContent: orig, prov: 'external' });
  const before = await guard._readGuard(baseDir, NAME);

  // newHtml whose api tag carries an unsupported version -> extractViaTag throws
  // -> safeExtractIsland is not-ok -> runDataLossGuard returns early (fail open).
  const skew = `<!DOCTYPE html><html><head>
<script type="application/json" data-rules-name="api" data-rules-version="2">
{ "title": "h1", "items": ".item[]" }
</script></head><body><h1>x</h1></body></html>`;
  const ev = await guard.runDataLossGuard({ baseDir, name: NAME, newHtml: skew, prevContent: orig, prov: 'external' });
  assert.strictEqual(ev, null);                                  // no throw, no event
  const after = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(after.event, null);
  assert.deepStrictEqual(after.baseline.data, before.baseline.data); // baseline untouched
});

test('external & ui-background non-firing writes never advance the baseline (external clears uiWorkPending, ui-background leaves it)', async () => {
  const baseDir = await freshBaseDir();
  // A clean ui-gestured save blesses items=['a','b'] and sets uiWorkPending.
  await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a', 'b'] }), 'ui-gestured');
  let g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.uiWorkPending, true);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b']);

  // external additions-only (non-firing): baseline NOT advanced, uiWorkPending cleared.
  const extEv = await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ items: ['a', 'b', 'c'] }), prevContent: page({ items: ['a', 'b'] }), prov: 'external',
  });
  assert.strictEqual(extEv, null);
  g = await guard._readGuard(baseDir, NAME);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b']); // never auto-blessed
  assert.strictEqual(g.uiWorkPending, false);                    // external clears it

  // Re-bless so uiWorkPending is true again.
  await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ items: ['a', 'b'] }), prevContent: page({ items: ['a', 'b'] }), prov: 'ui-gestured',
  });
  g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.uiWorkPending, true);

  // ui-background pure-modification (non-firing): baseline NOT advanced, and (per
  // the core spec) ui-background does not clear uiWorkPending — only external does.
  const bgEv = await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ title: 'Renamed', items: ['a', 'b'] }), prevContent: page({ items: ['a', 'b'] }), prov: 'ui-background',
  });
  assert.strictEqual(bgEv, null);
  g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.baseline.data.api.title, 'Title'); // not advanced to 'Renamed'
  assert.strictEqual(g.uiWorkPending, true);              // ui-background leaves it
});

test('auto-clear also fires when the recoverable data returns WITH legitimate additions (no destruction of the recoverable set)', async () => {
  const baseDir = await freshBaseDir();
  const orig = page({ items: ['a', 'b', 'c'] });
  const ev = await seedThenWrite(baseDir, orig, page({ items: ['a'] }), 'external'); // fires, pins a,b,c
  assert.ok(ev);
  // Incoming write restores a,b,c AND keeps a new item d (e.g. a concurrent add on
  // the other env). Not byte-equal to the pinned data, but nothing recoverable is
  // destroyed -> the loss is undone -> clear.
  const cleared = await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ items: ['a', 'b', 'c', 'd'] }), prevContent: page({ items: ['a'] }), prov: 'external',
  });
  assert.strictEqual(cleared, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
  assert.strictEqual(g.status, 'restored');
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b', 'c', 'd']); // adopts current
});

test('auto-clear does NOT fire on a partial restore (a recoverable atom is still missing -> warning preserved)', async () => {
  const baseDir = await freshBaseDir();
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a'] }), 'external'); // pins a,b,c
  assert.ok(ev);
  // Only a,b come back; c is still gone -> destruction of the recoverable set -> keep the event.
  const still = await guard.runDataLossGuard({
    baseDir, name: NAME, newHtml: page({ items: ['a', 'b'] }), prevContent: page({ items: ['a'] }), prov: 'external',
  });
  assert.strictEqual(still, null); // pinned event only bumps lastWriteAt; no NEW event returned
  const g = await guard._readGuard(baseDir, NAME);
  assert.ok(g.event); // warning preserved
  assert.deepStrictEqual(g.event.recoverableData.api.items, ['a', 'b', 'c']);
});

test('getGuardEvent re-validates on read: clears a stale event once the current content no longer destroys the recoverable set', async () => {
  const baseDir = await freshBaseDir();
  const ev = await seedThenWrite(baseDir, page({ items: ['a', 'b', 'c'] }), page({ items: ['a'] }), 'external'); // event pinned
  assert.ok(ev);
  // Still clobbered on read -> event surfaces.
  const stillThere = await guard.getGuardEvent(baseDir, NAME, page({ items: ['a'] }));
  assert.ok(stillThere && stillThere.id === ev.id);
  // Read with restored content -> stale event cleared, returns null.
  const onRestored = await guard.getGuardEvent(baseDir, NAME, page({ items: ['a', 'b', 'c'] }));
  assert.strictEqual(onRestored, null);
  const g = await guard._readGuard(baseDir, NAME);
  assert.strictEqual(g.event, null);
  assert.deepStrictEqual(g.baseline.data.api.items, ['a', 'b', 'c']);
});
