// Control lane (Hyperclay Local side): envelope contract, canonical island hash,
// lane dispatch/registration, golden-hash extraction parity, and the best-effort
// postControlMessage client. See plans/hyperclay-local/sse-control-lane-plan.md §9.
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../../src/main/data-loss-core.cjs');
const laneCore = require('../../src/sync-engine/control-lane-core.cjs');
const lane = require('../../src/sync-engine/control-lane');
const apiClient = require('../../src/sync-engine/api-client');
const guard = require('../../src/main/data-loss-guard');

// --- envelope contract -----------------------------------------------------
test('buildEnvelope defaults v to 1 and passes payload through', () => {
  assert.deepEqual(laneCore.buildEnvelope('a/b', undefined, { x: 1 }), { type: 'a/b', v: 1, payload: { x: 1 } });
  assert.deepEqual(laneCore.buildEnvelope('a/b', 2, { x: 1 }), { type: 'a/b', v: 2, payload: { x: 1 } });
});

test('parseEnvelope validates shape and drops malformed frames', () => {
  assert.deepEqual(laneCore.parseEnvelope({ type: 'a/b', payload: {} }), { type: 'a/b', v: 1, payload: {} });
  assert.deepEqual(laneCore.parseEnvelope({ type: 'a/b', v: 3, payload: { a: 1 } }), { type: 'a/b', v: 3, payload: { a: 1 } });
  assert.equal(laneCore.parseEnvelope(null), null);
  assert.equal(laneCore.parseEnvelope('nope'), null);
  assert.equal(laneCore.parseEnvelope({ payload: {} }), null);            // no type
  assert.equal(laneCore.parseEnvelope({ type: '', payload: {} }), null);  // empty type
  assert.equal(laneCore.parseEnvelope({ type: 'a', payload: null }), null);
  assert.equal(laneCore.parseEnvelope({ type: 'a', payload: [] }), null); // array payload
  assert.equal(laneCore.parseEnvelope({ type: 'a', v: 0, payload: {} }), null);
  assert.equal(laneCore.parseEnvelope({ type: 'a', v: 1.5, payload: {} }), null);
  assert.equal(laneCore.parseEnvelope({ type: 'a', v: -1, payload: {} }), null);
});

test('LANE_FRAME_TYPE is the reserved transport type', () => {
  assert.equal(laneCore.LANE_FRAME_TYPE, 'control');
});

// --- canonical island hash -------------------------------------------------
test('islandHash is key-order independent, array-order sensitive, and 64-hex', () => {
  assert.equal(core.islandHash({ api: { a: 1, b: 2 } }), core.islandHash({ api: { b: 2, a: 1 } }));
  assert.equal(core.islandHash({ api: { x: { a: 1, b: 2 } } }), core.islandHash({ api: { x: { b: 2, a: 1 } } }));
  assert.notEqual(core.islandHash({ api: { list: [1, 2] } }), core.islandHash({ api: { list: [2, 1] } }));
  assert.notEqual(core.islandHash({ api: { t: 'a' } }), core.islandHash({ api: { t: 'b' } }));
  assert.equal(core.islandHash(null), core.islandHash(undefined));
  assert.match(core.islandHash({ api: { t: 'x' } }), /^[0-9a-f]{64}$/);
});

// --- golden-hash cross-environment parity (the test that actually guards rider 1) ---
// This GOLDEN must be byte-identical to the one asserted in the platform suite
// (hyperclay/tests/unit/control-rider.test.js). If the two extractors ever drift,
// one side's assertion fails and the lane would silently never cross-clear.
const GOLDEN = '3587d7ca312f4f4f921a818a58ea1b7b9a588c1b5550ed9bb19fff2498a1a9a2';
const FIXTURE = `<!DOCTYPE html><html><head>
<script type="application/json" data-rules-name="api" data-rules-version="1">
{ "title": "h1", "items": ".item[]" }
</script></head><body><h1>Hello</h1><ul><li class="item">x</li><li class="item">y</li></ul></body></html>`;
test('golden-hash parity: local extractor yields the shared canonical hash', async () => {
  const island = await guard.extractIsland(FIXTURE);
  assert.deepEqual(island, { api: { title: 'Hello', items: ['x', 'y'] } });
  assert.equal(core.islandHash(island), GOLDEN);
});

// --- lane dispatch ---------------------------------------------------------
test('dispatch routes known types, drops unknown, swallows throws, passes v/ctx', async () => {
  let seen = null;
  lane.registerControlHandler('t/known', async (payload, ctx) => { seen = { payload, ctx }; return true; });
  assert.deepEqual(await lane.dispatchControlEnvelope({ type: 't/known', v: 1, payload: { a: 1 } }, { baseDir: '/b' }), { applied: true });
  assert.deepEqual(seen.payload, { a: 1 });
  assert.equal(seen.ctx.v, 1);
  assert.equal(seen.ctx.baseDir, '/b');

  assert.deepEqual(await lane.dispatchControlEnvelope({ type: 'nope/x', payload: {} }, {}), { applied: false, reason: 'unknown-type' });
  assert.deepEqual(await lane.dispatchControlEnvelope({ payload: {} }, {}), { applied: false, reason: 'malformed' });

  lane.registerControlHandler('t/boom', async () => { throw new Error('boom'); });
  assert.deepEqual(await lane.dispatchControlEnvelope({ type: 't/boom', payload: {} }, {}), { applied: false, reason: 'error' });
});

test('a handler returning non-true reports applied:false', async () => {
  lane.registerControlHandler('t/false', async () => false);
  assert.deepEqual(await lane.dispatchControlEnvelope({ type: 't/false', payload: {} }, {}), { applied: false });
});

// --- postControlMessage: never throws --------------------------------------
test('postControlMessage resolves on 200 / 4xx / 5xx / network error, never throws, no apiFetch', async () => {
  const origFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true });
    assert.deepEqual(await apiClient.postControlMessage('http://x', 'k', { type: 'a', v: 1, payload: {} }), { delivered: true });
    global.fetch = async () => ({ ok: false, status: 404 });
    assert.deepEqual(await apiClient.postControlMessage('http://x', 'k', {}), { delivered: false });
    global.fetch = async () => ({ ok: false, status: 500 });
    assert.deepEqual(await apiClient.postControlMessage('http://x', 'k', {}), { delivered: false });
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    assert.deepEqual(await apiClient.postControlMessage('http://x', 'k', {}), { delivered: false });
  } finally {
    global.fetch = origFetch;
  }
});
