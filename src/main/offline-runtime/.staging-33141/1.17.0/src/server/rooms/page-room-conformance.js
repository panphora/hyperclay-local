import * as Y from '../../vendor/yjs.vendor.js';
import { createRooms, LIVE_LIMITS } from './live-data-rooms.js';
import { COMPACTION, ROOM_ERROR_STATUS, buildCandidate, pageShape } from '../../live/page-compaction.js';
import { serializeLive, cloneJson, stampOf } from './live-data-ops.js';
import { entriesOf } from '../../page/ybind/parts.js';
import { rangesOf, within, docRanges } from '../../page/ybind/containment.js';

/**
 * The D13 page-room conformance fixture: a seeded run of several tabs, restarts,
 * resets and legacy file writes over one page room, driven through an adapter
 * that stands in for a host's wiring of the room. Every run throws with the seed
 * and the invariant it broke. The module reads no files: the caller passes the
 * template HTML in, so a host runs the same fixture over its own HTTP handlers,
 * error-status table, broadcast path and compactor.
 *
 * The adapter is a host's page room as its clients see it. All of its operations
 * act on the room the host serves for `key`, and every one of them answers in
 * wire terms:
 *
 *   limits
 *     The host's compaction limits: { version, loose, soft, activeBytes,
 *     leaseMs, tailFloor }. The fixture asserts against these.
 *
 *   advanceClock(ms)
 *     Move the host's clock forward by ms. The fixture advances time, it never
 *     reads it.
 *
 *   onCompactionDue(listener)
 *     Register the host's hook: listener({ key, overflow }) whenever a room of
 *     that key wants a compaction. Replaces any earlier listener.
 *
 *   open({ key, html, nodeId })
 *   restart({ key, html, nodeId })
 *   reset({ key, html, nodeId })
 *     Start the room for key from html: `open` on the host's registry, `restart`
 *     on a fresh registry (a new epoch, every job and frame stale), `reset` over
 *     the existing room. Answer { status: 200, body: { key, epoch, seq } }, or
 *     { status: 409, body: { error } } when the host refused.
 *
 *   readState({ key, tabId, capable })
 *     The JSON the client receives for a state read: { epoch, seq, writer,
 *     stores: { page: { value, ... }, ... }, ... }, with the page store's value
 *     as the client's re-read carries it. `tabId` is the reading client (null for
 *     a broadcast's read) and `capable` says whether it advertises the page
 *     compaction capability (default true). Answers { status: 404, body: null }
 *     when the host has no room for key.
 *
 *   apply({ key, tabId, frame })
 *     Apply one frame { name, n, epoch, pageGeneration, compaction, ops } from
 *     tabId, atomically. Answer { status: 200, body: { duplicate, seq, epoch, ... } }
 *     when the host took it, { status, body: { error, ... } } with the host's
 *     status for a refusal (the error code and any retryAfter), or
 *     { status: 409, body: { stale: true, epoch } } when the frame's epoch does
 *     not match the room the host serves.
 *
 *   fileWritten({ key, html })
 *     The file for key was written. Answer { status: 200, body: { valueChanged,
 *     landed } } (landed: the store names the file now reaches), or
 *     { status: 404, body: null } when the host has no such room.
 *
 *   usage({ key })
 *     What the host reports the room holds: { reported, receiptBytes,
 *     transitionBytes, reservedBytes, stores: { [name]: { bytes, logBytes } } }.
 *     `reported` is the host's own budget figure for every room it serves.
 *
 *   beginCompaction({ key, overflow })
 *     Start a compaction job. Answer { status: 200, body: { token, kind, sources } }
 *     (sources: the [key, value] entries the candidate must cover, as the host's
 *     compactor receives them), or { status: 409, body: null } when no job began.
 *
 *   buildCandidate({ job })
 *     Build the candidate for job ({ token, kind, sources }). Answer
 *     { status: 200, body: { update } } or { status: 409, body: { failure } }.
 *
 *   commitCompaction({ token, candidate })
 *     Commit the built candidate. Answer { status: 200, body: { kind, seq, epoch, ... } },
 *     or { status: 409, body: { refused } } with the host's refusal code.
 *
 *   abandonCompaction({ token })
 *     Drop job. Answer { status: 200, body: { abandoned: true } } or
 *     { status: 409, body: { abandoned: false } } when the token was stale.
 */

const NET = 'net';
const TAG = /merge="page" clay="live"(?: live-at="[^"]*")?>(.*?)<\/script>/;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * The default adapter: one page room hosted by createRooms. Refusals answer with
 * the host's status table (ROOM_ERROR_STATUS), reads answer with the JSON that
 * goes to a client, due compactions are begun, built and committed inline, and
 * restart swaps in a fresh registry with a new epoch and the same clock.
 */
export function createRoomsAdapter({ now = null, newEpoch = null, compaction = null } = {}) {
  if (!compaction) throw new Error('createRoomsAdapter needs compaction limits');
  const limits = Object.freeze({ ...COMPACTION, ...(typeof compaction === 'object' ? compaction : {}) });
  let offset = 0;
  let epochs = 0;
  const at = () => (typeof now === 'function' ? now() : 0) + offset;
  const epochOf = typeof newEpoch === 'function' ? newEpoch : () => `e${++epochs}`;
  let listener = () => {};
  let room = null;
  const registry = () => {
    const rooms = createRooms({ now: at, newEpoch: epochOf, compaction: limits });
    rooms.onCompactionDue((target, { overflow }) => listener({ key: target.key, overflow }));
    return rooms;
  };
  let rooms = registry();
  const current = (key) => (room && (key === undefined || room.key === key) ? room : (key === undefined ? null : rooms.get(key)));
  const opened = (next) => {
    if (!next) return { status: 409, body: { error: 'rooms-full' } };
    room = next;
    return { status: 200, body: { key: next.key, epoch: next.epoch, seq: next.seq } };
  };

  return {
    limits,
    advanceClock(ms = 0) {
      offset += ms;
    },
    onCompactionDue(fn) {
      listener = typeof fn === 'function' ? fn : () => {};
    },
    open({ key, html, nodeId = null } = {}) {
      return opened(rooms.open(key, html, { nodeId }));
    },
    restart({ key, html, nodeId = null } = {}) {
      rooms = registry();
      room = null;
      return opened(rooms.open(key, html, { nodeId }));
    },
    reset({ key, html, nodeId = null } = {}) {
      return opened(rooms.reset(key, html, { nodeId }));
    },
    readState({ key, tabId = null, capable = true } = {}) {
      const target = current(key);
      if (!target) return { status: 404, body: null };
      return { status: 200, body: rooms.state(target, tabId, undefined, { compaction: capable ? limits.version : undefined }) };
    },
    apply({ key, tabId = null, frame } = {}) {
      const target = current(key);
      if (!target) return { status: 404, body: { error: 'unknown-room' } };
      const answer = rooms.apply(target, tabId, frame);
      if (answer?.error) {
        return { status: ROOM_ERROR_STATUS[answer.error] ?? 409, body: { error: answer.error, ...(answer.retryAfter !== undefined && { retryAfter: answer.retryAfter }), ...(answer.message && { message: answer.message }) } };
      }
      if (answer?.busy) return { status: 409, body: { error: 'busy', ...(answer.reason && { reason: answer.reason }) } };
      if (answer?.stale) return { status: 409, body: { stale: true, epoch: answer.epoch ?? null } };
      return { status: 200, body: answer };
    },
    fileWritten({ key, html } = {}) {
      const out = rooms.fileWritten(key, html);
      if (!out) return { status: 404, body: null };
      return { status: 200, body: { valueChanged: Boolean(out.valueChanged), landed: out.landed ?? [] } };
    },
    usage({ key } = {}) {
      const target = current(key);
      if (!target) return { status: 404, body: null };
      const stores = {};
      for (const [name, s] of target.stores) stores[name] = { bytes: s.bytes, logBytes: s.logBytes };
      return {
        status: 200,
        body: {
          reported: rooms.used(),
          receiptBytes: target.receiptBytes ?? 0,
          transitionBytes: target.pageTransition?.bytes ?? 0,
          reservedBytes: target.compaction?.job?.reserved ?? 0,
          stores,
        },
      };
    },
    beginCompaction({ key, overflow = false } = {}) {
      const target = current(key);
      if (!target) return { status: 404, body: null };
      const job = rooms.beginCompaction(target, { overflow });
      if (!job) return { status: 409, body: null };
      return { status: 200, body: job };
    },
    buildCandidate({ job } = {}) {
      const result = buildCandidate({ kind: job.kind, sources: job.sources });
      return { status: result.failure ? 409 : 200, body: result };
    },
    commitCompaction({ token, candidate } = {}) {
      const answer = rooms.commitCompaction(token, candidate);
      return { status: answer.refused ? 409 : 200, body: answer };
    },
    abandonCompaction({ token } = {}) {
      const abandoned = rooms.abandonCompaction(token);
      return { status: abandoned ? 200 : 409, body: { abandoned: Boolean(abandoned) } };
    },
  };
}

/**
 * Run the fixture. Answers the same stats object as before:
 * { seed, admitted, refusedRetry, capacity, commits: { tail, full }, stale,
 *   staleChecked, restarts, resets, maxLoose, maxBytes, unchangedRefusals,
 *   reserve, landed, legacyWrites, legacyMerged, blocked, end }.
 */
export function runPageRoomConformance({ adapter, template, seed = 1, steps = 400, tabs: tabCount = 3, activeBytes = adapter.limits.activeBytes, tailFloor = adapter.limits.tailFloor, restarts = true, paste = 6000, log = false } = {}) {
  const KEY = 'doc';
  const r = rng(seed);
  const pick = (n) => Math.floor(r() * n);
  const limits = { activeBytes, loose: adapter.limits.loose, soft: adapter.limits.soft, leaseMs: adapter.limits.leaseMs, tailFloor };
  const htmlOf = (value, at = null) => template.replace(TAG, () => `merge="page" clay="live"${at ? ` live-at="${at}"` : ''}>${JSON.stringify(value)}</script>`);
  const fail = (message, extra = {}) => { throw Object.assign(new Error(`seed ${seed}: ${message}`), extra); };
  const dueSet = new Set();
  adapter.onCompactionDue(({ key, overflow }) => { if (key === KEY) dueSet.add({ key, overflow }); });
  const opened = adapter.open({ key: KEY, html: template, nodeId: 1 });
  if (opened.status !== 200) fail(`open refused with ${opened.status}`);

  const state = () => {
    const answer = adapter.readState({ key: KEY, capable: true });
    if (answer.status !== 200) fail(`state read refused with ${answer.status}`);
    return answer.body;
  };
  const page = () => state().stores.page.value;
  const usage = () => {
    const answer = adapter.usage({ key: KEY });
    if (answer.status !== 200) fail(`usage read refused with ${answer.status}`);
    return answer.body;
  };
  const held = (u) => u.receiptBytes + u.transitionBytes + u.reservedBytes +
    Object.values(u.stores).reduce((total, s) => total + s.bytes + s.logBytes, 0);

  const stats = { admitted: 0, refusedRetry: 0, capacity: 0, commits: { tail: 0, full: 0 }, stale: 0, staleChecked: 0, restarts: 0, resets: 0, maxLoose: 0, maxBytes: 0, unchangedRefusals: 0, reserve: 0, landed: 0 };
  const pending = [];
  let saved = cloneJson(page());
  const admitted = [];

  const tabs = Array.from({ length: tabCount }, (_, i) => {
    const doc = new Y.Doc();
    doc.clientID = 1000 + i;
    const t = { id: `t${i}`, doc, inst: `${seed}${i}x${pick(1e6).toString(36)}`, counter: 0, n: 0, outbox: [], inflight: null, known: new Set(), journal: [], blocked: false, epoch: null };
    doc.on('updateV2', (u, origin) => { if (origin === NET) return; t.journal.push(u); t.outbox.push(u); });
    return t;
  });

  const history = [{ value: saved, epoch: state().epoch, seq: state().seq }];
  const legacy = { doc: new Y.Doc(), n: 0, writes: 0, merged: 0, keys: {} };
  legacy.doc.clientID = 900;

  const check = (where) => {
    const u = usage();
    const bytes = u.stores.page.bytes;
    const shape = pageShape(page().y, limits);
    stats.maxLoose = Math.max(stats.maxLoose, shape.loose);
    stats.maxBytes = Math.max(stats.maxBytes, bytes);
    if (bytes > LIVE_LIMITS.storeBytes) fail(`${where}: store over the hard cap`);
    if (where === 'admit' && !shape.normal) fail(`${where}: admitted into a value out of normal form`, { shape });
    if (where === 'admit' && bytes > activeBytes + 64 * 1024) fail(`${where}: active value ${bytes} over ${activeBytes} plus the delete reserve`);
    if (bytes > activeBytes) stats.reserve++;
    if (u.reported !== held(u)) fail(`${where}: budget ${u.reported} != ${held(u)}`);
  };

  const contains = (updates) => {
    const d = new Y.Doc();
    for (const [, v] of entriesOf(page().y)) Y.applyUpdateV2(d, Y.fromBase64(v));
    const index = docRanges(d);
    d.destroy();
    return updates.every((u) => within(index, rangesOf(u)));
  };

  const legacyWrite = () => {
    const entry = history[pick(history.length)];
    const base = entry.value;
    for (const [, v] of entriesOf(base.y)) Y.applyUpdateV2(legacy.doc, Y.fromBase64(v), NET);
    const got = [];
    const on = (u, origin) => { if (origin !== NET) got.push(u); };
    legacy.doc.on('updateV2', on);
    const text = legacy.doc.getText('probe');
    text.insert(pick(text.length + 1), 'L'.repeat(1 + pick(r() < 0.2 ? 20000 : 60)));
    legacy.doc.off('updateV2', on);
    const update = Y.mergeUpdatesV2(got);
    const b64 = Y.toBase64(update);
    const key = `u900-${(legacy.n++).toString(36)}`;
    if (b64.length > 12 * 1024) {
      const parts = Math.ceil(b64.length / (12 * 1024));
      for (let i = 0; i < parts; i++) legacy.keys[`${key}.${i}.${parts}`] = b64.slice(i * 12 * 1024, (i + 1) * 12 * 1024);
    } else legacy.keys[key] = b64;
    const file = cloneJson(base);
    Object.assign(file.y, legacy.keys);
    if (r() < 0.3) file.y[`m900-${legacy.n}`] = Y.toBase64(Y.mergeUpdatesV2(entriesOf(base.y).map(([, v]) => Y.fromBase64(v))));
    const keysBefore = Object.keys(page().y);
    const valueBefore = cloneJson(page());
    const at = stampOf(entry.epoch, entry.seq, serializeLive(file));
    const out = adapter.fileWritten({ key: KEY, html: htmlOf(file, at) });
    legacy.writes++;
    const after = state();
    if (!after.stores.page) fail('a merge dropped the page store');
    const y = after.stores.page.value.y;
    if (keysBefore.some((k) => !(k in y) || y[k] !== valueBefore.y[k])) fail('a file merge deleted or changed a room key');
    if (!contains([update])) fail('a file merge lost the legacy edit');
    if (out.body?.valueChanged) legacy.merged++;
    if (out.body?.landed?.includes('page')) stats.landed++;
    admitted.push(update);
    const u = usage();
    if (u.reported !== held(u)) fail('budget after merge');
  };

  const sync = (t) => {
    const y = page().y;
    for (const [k, v] of entriesOf(y)) if (!t.known.has(k)) { t.known.add(k); Y.applyUpdateV2(t.doc, Y.fromBase64(v), NET); }
    const epoch = state().epoch;
    if (t.epoch !== epoch) {
      t.epoch = epoch;
      t.inflight = null;
      const scratch = new Y.Doc();
      for (const [, v] of entriesOf(y)) Y.applyUpdateV2(scratch, Y.fromBase64(v));
      const diff = Y.encodeStateAsUpdateV2(t.doc, Y.encodeStateVector(scratch));
      const covered = within(docRanges(scratch), rangesOf(Y.encodeStateAsUpdateV2(t.doc)));
      scratch.destroy();
      if (!covered) t.outbox.push(diff);
    }
  };

  const send = (t) => {
    if (t.blocked) return;
    if (!t.inflight) {
      if (!t.outbox.length) return;
      const merged = Y.mergeUpdatesV2(t.outbox);
      t.outbox = [];
      t.inflight = { key: `u${t.doc.clientID.toString(36)}-${t.inst}-${(t.counter++).toString(36)}`, value: Y.toBase64(merged), n: ++t.n, update: merged };
    }
    const f = t.inflight;
    const before = serializeLive(page());
    const seqBefore = state().seq;
    const now = state();
    const answer = adapter.apply({ key: KEY, tabId: t.id, frame: { name: 'page', n: f.n, epoch: now.epoch, pageGeneration: now.pageTransition?.id ?? null, compaction: 1, ops: [{ op: 'set', path: ['y', f.key], value: f.value }] } });
    const body = answer.body ?? {};
    if (body.error) {
      if (serializeLive(page()) !== before || state().seq !== seqBefore) fail(`refusal ${body.error} changed the room`);
      stats.unchangedRefusals++;
      if (body.error === 'checkpoint-required') { stats.refusedRetry++; return; }
      if (body.error === 'page-full') { stats.capacity++; t.blocked = true; return; }
      fail(`unexpected refusal ${body.error}`);
    }
    if (body.stale) { t.inflight = null; return; }
    if (!body.duplicate) { stats.admitted++; admitted.push(f.update); }
    t.known.add(f.key);
    t.inflight = null;
    check('admit');
  };

  const compactBegin = () => {
    if (!dueSet.size) return;
    const [{ overflow }] = dueSet;
    dueSet.clear();
    const answer = adapter.beginCompaction({ key: KEY, overflow });
    if (answer.status === 200) pending.push({ job: answer.body, epoch: state().epoch, value: serializeLive(page()) });
  };

  const compactFinish = () => {
    if (!pending.length) return;
    const entry = pending.shift();
    const { job } = entry;
    const choice = r();
    if (choice < 0.08) {
      adapter.advanceClock(limits.leaseMs + 1);
      const next = adapter.beginCompaction({ key: KEY });
      const before = serializeLive(page());
      const result = adapter.buildCandidate({ job });
      const answer = adapter.commitCompaction({ token: job.token, candidate: result.body });
      stats.staleChecked++;
      if (answer.status === 200) fail('an expired token committed');
      if (serializeLive(page()) !== before) fail('a stale commit changed the room');
      stats.stale++;
      if (next.status === 200) pending.push({ job: next.body, epoch: state().epoch });
      return;
    }
    if (choice < 0.12) { adapter.abandonCompaction({ token: job.token }); return; }
    const built = adapter.buildCandidate({ job });
    if (built.status !== 200) fail(`candidate failed: ${built.body.failure}`);
    const before = serializeLive(page());
    const answer = adapter.commitCompaction({ token: job.token, candidate: built.body });
    if (answer.status !== 200) {
      const refused = answer.body.refused;
      if (serializeLive(page()) !== before) fail(`refused commit ${refused} changed the room`);
      if (entry.epoch !== state().epoch) { stats.stale++; return; }
      if (refused !== 'stale-token') fail(`commit refused: ${refused}`);
      stats.stale++;
      return;
    }
    stats.commits[answer.body.kind]++;
    check('commit');
    if (!contains(admitted)) fail('a commit lost an admitted update');
  };

  const edit = (t) => {
    const text = t.doc.getText('probe');
    const len = text.length;
    const roll = r();
    if (roll < 0.55 || len < 50) text.insert(pick(len + 1), 'x'.repeat(1 + pick(roll < 0.05 ? paste : 80)) + t.id);
    else text.delete(pick(len), Math.min(len, 1 + pick(400)));
  };

  for (let step = 0; step < steps; step++) {
    adapter.advanceClock(50);
    const t = tabs[pick(tabs.length)];
    const roll = r();
    if (roll < 0.45) edit(t);
    else if (roll < 0.75) send(t);
    else if (roll < 0.82) compactBegin();
    else if (roll < 0.9) compactFinish();
    else if (roll < 0.95) { sync(t); saved = cloneJson(page()); history.push({ value: saved, epoch: state().epoch, seq: state().seq }); if (history.length > 8) history.shift(); }
    else if (roll < 0.97) legacyWrite();
    else if (restarts && roll < 0.985) {
      const before = saved;
      const next = adapter.restart({ key: KEY, html: htmlOf(before), nodeId: 1 });
      if (next.status !== 200) fail(`restart refused with ${next.status}`);
      dueSet.clear();
      pending.length = 0;
      stats.restarts++;
      for (const x of tabs) x.known = new Set();
      history.length = 0;
      history.push({ value: cloneJson(before), epoch: next.body.epoch, seq: next.body.seq });
      admitted.length = 0;
    } else if (restarts) {
      const next = adapter.reset({ key: KEY, html: htmlOf(saved), nodeId: 1 });
      if (next.status === 200) { stats.resets++; for (const x of tabs) x.known = new Set(); admitted.length = 0; history.length = 0; history.push({ value: cloneJson(saved), epoch: next.body.epoch, seq: next.body.seq }); }
    }
    const epoch = state().epoch;
    for (const x of tabs) if (x.epoch !== epoch) sync(x);
  }

  for (let round = 0; round < 400; round++) {
    let busy = false;
    for (const t of tabs) {
      sync(t);
      if (!t.blocked && (t.inflight || t.outbox.length)) { send(t); busy = true; }
    }
    if (dueSet.size) { compactBegin(); busy = true; }
    if (pending.length) { compactFinish(); busy = true; }
    adapter.advanceClock(50);
    if (!busy) break;
  }
  for (const t of tabs) sync(t);
  check('end');
  const lost = tabs.filter((t) => !t.blocked && !contains(t.journal));
  if (lost.length) fail(`edits lost for ${lost.map((t) => t.id)}`);
  const blocked = tabs.filter((t) => t.blocked);
  for (const t of blocked) {
    const mine = docRanges(t.doc);
    if (!t.journal.every((u) => within(mine, rangesOf(u)))) fail(`blocked tab ${t.id} lost its own edits`);
  }
  if (!blocked.length) {
    const roomDoc = new Y.Doc();
    for (const [, v] of entriesOf(page().y)) Y.applyUpdateV2(roomDoc, Y.fromBase64(v));
    const want = roomDoc.getText('probe').toString();
    for (const t of tabs) if (t.doc.getText('probe').toString() !== want) fail(`tab ${t.id} diverged`);
    roomDoc.destroy();
  }
  const end = page();
  const out = { seed, ...stats, legacyWrites: legacy.writes, legacyMerged: legacy.merged, blocked: blocked.length, end: { bytes: usage().stores.page.bytes, ...pageShape(end.y, limits) } };
  if (log) console.log(JSON.stringify(out));
  return out;
}
