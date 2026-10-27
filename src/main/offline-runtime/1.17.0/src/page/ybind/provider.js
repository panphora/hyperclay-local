import * as Y from "../../vendor/yjs.vendor.js";
import { toBase64, fromBase64 } from "../../vendor/yjs.vendor.js";
import { NET } from "./layout.js";
import { ORIGINS_ORIGIN } from "./origins.js";
import { PART_KEY, BASE64, entriesOf, captureYValue } from "./parts.js";
import { containsUpdate } from "./recovery-proof.js";

export { entriesOf } from "./parts.js";

export const enc = (u) => toBase64(u);
export const dec = (s) => fromBase64(s);

export const PART = 12 * 1024;

// The origin a replayed journal is applied through. It is offered to the room like any
// other local work and is never journaled again: a recovery is not this tab's typing.
export const RECOVERY_ORIGIN = "page-recovery";
const baseOf = (k) => PART_KEY.exec(k)?.[1] ?? k;

export function yValueOf(ydoc) {
  return { v: 1, g: 0, y: { seed: enc(Y.encodeStateAsUpdateV2(ydoc)) } };
}

export class YDecodeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "YDecodeError";
    this.code = code;
  }
}

function strictEntries(value) {
  if (value?.v !== 1 || !value.y || typeof value.y !== "object" || Array.isArray(value.y)) {
    throw new YDecodeError("invalid-value", "Expected a version 1 Yjs page value");
  }
  const groups = new Map();
  const whole = new Set();
  for (const [key, text] of Object.entries(value.y)) {
    if (typeof text !== "string") throw new YDecodeError("invalid-update", `Invalid Yjs update: ${key}`);
    const part = PART_KEY.exec(key);
    if (!part) { whole.add(key); continue; }
    const index = Number(part[2]), count = Number(part[3]);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index >= count) {
      throw new YDecodeError("invalid-update", `Invalid Yjs update part: ${key}`);
    }
    const group = groups.get(part[1]) ?? { count, indices: new Set() };
    if (group.count !== count || group.indices.has(index)) {
      throw new YDecodeError("invalid-update", `Conflicting Yjs update parts: ${part[1]}`);
    }
    group.indices.add(index);
    groups.set(part[1], group);
  }
  for (const [key, group] of groups) {
    if (whole.has(key)) throw new YDecodeError("invalid-update", `Conflicting Yjs update forms: ${key}`);
    if (group.indices.size !== group.count) throw new YDecodeError("incomplete-update", `Incomplete Yjs update: ${key}`);
  }
  return entriesOf(value.y);
}

export function docFromValue(value, { strict = false } = {}) {
  const entries = strict ? strictEntries(value) : entriesOf(value.y);
  const d = new Y.Doc();
  try {
    for (const [key, value] of entries) {
      const text = strict ? value.replace(/[\t\n\f\r ]/g, "") : value;
      if (strict && !BASE64.test(text)) throw new YDecodeError("invalid-update", `Invalid base64 in Yjs update: ${key}`);
      Y.applyUpdateV2(d, dec(text), NET);
    }
    if (strict && (d.store.pendingStructs || d.store.pendingDs)) {
      throw new YDecodeError("unresolved-update", "Yjs page updates have missing prerequisites");
    }
    return d;
  } catch (error) {
    d.destroy();
    if (strict && !(error instanceof YDecodeError)) {
      throw new YDecodeError("invalid-update", `Invalid Yjs page update: ${error.message}`);
    }
    throw error;
  }
}

const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
const utf8Bytes = (text) => (encoder ? encoder.encode(text).length : text.length * 2);
const sameDeletes = (a, b) => Y.equalDeleteSets(Y.createDeleteSetFromStructStore(a.store), Y.createDeleteSetFromStructStore(b.store));
const svEqual = (a, b) => { if (a.size !== b.size) return false; for (const [c, n] of a) if (b.get(c) !== n) return false; return true; };

export function createYProvider({ store, ydoc, compact: limits = {}, setTimer = setTimeout, clearTimer = clearTimeout, onStopped = () => {}, stats = { applied: 0, offered: 0, compactions: 0 }, journal = null }) {
  const initial = entriesOf(store.value.y);
  const known = new Set();
  // Set when this tab's page can no longer reach the room: "lineage" when the room holds
  // another page's history, "too-large" when the room refused an update for its size.
  // Nothing more is offered either way, and the tab keeps its own document.
  let stopped = null;
  const stop = (reason) => {
    if (stopped) return;
    stopped = reason;
    onStopped(reason);
  };
  let canCompact = !initial.some(([k]) => k[0] === "m");
  let counter = 0;
  const me = ydoc.clientID.toString(36);
  const nextKey = (p) => `${p}${me}-${(counter++).toString(36)}`;
  let timer = null;
  const generation = store.value.g;
  // Keys this tab wrote itself: the updates and offers the room has not confirmed yet.
  const own = new Set();

  const partsOf = (key, s) => {
    if (s.length <= PART) return [[key, s]];
    const n = Math.ceil(s.length / PART);
    return Array.from({ length: n }, (_, i) => [`${key}.${i}.${n}`, s.slice(i * PART, (i + 1) * PART)]);
  };
  const put = (key, bytes) => {
    canCompact = true;
    known.add(key);
    own.add(key);
    const parts = partsOf(key, enc(bytes));
    store.handle.update((data) => { for (const [k, v] of parts) data.y[k] = v; });
  };

  for (const [k] of initial) known.add(k);

  // Ahead of the stop guards, and of the room's own delivery: work this tab can no longer
  // offer, and work a refused offer took back, is still work a crash must not lose.
  const onUpdate = (u, origin) => {
    if (origin !== NET && origin !== ORIGINS_ORIGIN && origin !== RECOVERY_ORIGIN) journal?.local(u);
    if (stopped || origin === NET || origin === ORIGINS_ORIGIN) return;
    put(nextKey("u"), u);
  };
  ydoc.on("updateV2", onUpdate);

  const applyKey = (k, v) => {
    if (stopped || known.has(k)) return;
    canCompact = true;
    known.add(k);
    stats.applied++;
    const update = dec(v);
    Y.applyUpdateV2(ydoc, update, NET);
    // A received update can be the prerequisite of a later local insert, so the journal
    // keeps it beside the work it owns, and never counts it as this tab's own.
    journal?.dependency(update);
  };

  let wantReconcile = false;
  let reconcilePending = false;
  const schedule = (full, recovery) => {
    wantReconcile ||= full;
    reconcilePending ||= recovery;
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      const full = wantReconcile;
      if (full) reconcile();
      maybeCompact();
    }, 0);
  };

  const settle = () => { reconcile(); maybeCompact(); };

  function reconcile() {
    if (stopped) return false;
    const y = store.value.y;
    const scratch = new Y.Doc();
    for (const [, v] of entriesOf(y)) Y.applyUpdateV2(scratch, dec(v), NET);
    const sv = Y.encodeStateVector(scratch);
    const mine = Y.decodeStateVector(Y.encodeStateVector(ydoc));
    const theirs = Y.decodeStateVector(sv);
    if (svEqual(mine, theirs) && sameDeletes(ydoc, scratch)) { scratch.destroy(); wantReconcile = false; reconcilePending = false; return false; }
    const diff = Y.encodeStateAsUpdateV2(ydoc, sv);
    scratch.destroy();
    stats.offered++;
    put(nextKey("r"), diff);
    wantReconcile = false;
    reconcilePending = false;
    return true;
  }

  // A fold briefly holds the old entries and the merged snapshot together, so it
  // needs room for both under the host's 4 MB store cap, less 256 KB for frames in flight.
  const compact = { keys: 32, room: 3840 * 1024, ...limits };
  let fold = null;
  let quietUntil = 0;
  const COVER_MAX = 256;
  const coverCache = new Map();
  const drop = (keys) => store.handle.update((data) => { for (const k of keys) delete data.y[k]; });
  const keysOf = (auth, bases) => Object.keys(auth).filter((k) => bases.has(baseOf(k)));
  // A key is retired only while what this tab shows under it is still what the proof was
  // made over: a late write under the same key keeps its own entry.
  const retire = (auth, keys) => { const visible = store.value.y ?? {}; drop(keys.filter((k) => k in visible && visible[k] === auth[k])); };

  // `known` and the coverage memo keep live references only: the authoritative entries,
  // this tab's own unconfirmed writes and the fold in progress. Pruned after a rebase, a
  // fold and a refusal. A key that is forgotten can be decoded again; Yjs is idempotent.
  function prune() {
    const auth = store.authoritative.y ?? {};
    const visible = store.value.y ?? {};
    for (const k of own) if (!(k in visible)) own.delete(k);
    const held = fold ? [...fold.parts.map(([k]) => k), ...fold.inputs.keys()] : [];
    const retained = new Set([...Object.keys(auth), ...own, ...held]);
    for (const key of known) if (!retained.has(key)) known.delete(key);
    const values = new Map(entriesOf(auth));
    for (const [key, proof] of coverCache) if (!retained.has(key) || values.get(key) !== proof.value) coverCache.delete(key);
  }

  // Whether a fold's merged bytes already carry this input: merging it in again changes
  // neither an insertion nor a deletion. Equal state vectors say nothing about deletes.
  function coveredBy(key, value, foldKey, base) {
    let proof = coverCache.get(key);
    if (proof && proof.value !== value) { coverCache.delete(key); proof = null; }
    if (!proof) {
      if (coverCache.size >= COVER_MAX) coverCache.delete(coverCache.keys().next().value);
      proof = { value, folds: new Map() };
      coverCache.set(key, proof);
    }
    if (!proof.folds.has(foldKey)) proof.folds.set(foldKey, containsUpdate(base, dec(value)));
    return proof.folds.get(foldKey);
  }

  // An input the authority no longer has was retired already; one it holds differently
  // was rewritten after the fold was built, and the fold no longer speaks for it.
  const stillHeld = (auth, active) => { for (const [k, v] of active.held) if (auth[k] !== undefined && auth[k] !== v) return false; return true; };
  const coversInputs = (active) => {
    const base = dec(active.merged);
    for (const [k, v] of active.inputs) if (v !== null && !coveredBy(k, v, active.key, base)) return false;
    return true;
  };

  // Inputs retire only once the authority holds every proposed part with the identical
  // value, still holds each input as it was captured, and the fold covers every one of
  // them. Anything less keeps the originals; pending confirmation keeps them too.
  function finishFold(auth) {
    const active = fold;
    const whole = captureYValue({ v: 1, y: auth }).y;
    const arrived = active.parts.filter(([k, v]) => auth[k] === v && whole[k] === v);
    if (arrived.length !== active.parts.length) {
      if (store.pending.length) return false;
      fold = null;
      if (arrived.length) retire(auth, arrived.map(([k]) => k));
      quietUntil = entriesOf(auth).length + compact.keys;
      prune();
      return true;
    }
    if (store.pending.length || !stillHeld(auth, active) || !coversInputs(active)) return false;
    fold = null;
    retire(auth, keysOf(auth, active.inputs));
    prune();
    return true;
  }

  function dropCovered(auth, entries, crowded) {
    const folds = entries.filter(([k]) => k[0] === "m");
    const val = new Map(entries);
    const norm = new Map(folds);
    const normal = (k) => { const v = norm.get(k); if (typeof v === "string") norm.set(k, Y.mergeUpdatesV2([dec(v)])); return norm.get(k); };
    const covered = (k, v, mk) => coveredBy(k, v, mk, normal(mk));
    const gone = new Set();
    for (const [k, v] of entries) {
      if (!crowded && k[0] !== "m") continue;
      for (const [mk] of folds) {
        if (mk === k || gone.has(mk) || !covered(k, v, mk)) continue;
        if (k[0] === "m" && k < mk && covered(mk, val.get(mk), k)) continue;
        gone.add(k);
        break;
      }
    }
    if (!gone.size) return false;
    retire(auth, keysOf(auth, gone));
    return true;
  }

  function maybeCompact() {
    if (stopped || !canCompact || store.value.g !== generation) return false;
    const auth = store.authoritative.y;
    if (fold) return finishFold(auth);
    const entries = entriesOf(auth);
    const crowded = entries.length > Math.max(compact.keys, quietUntil);
    if (!crowded && entries.filter(([k]) => k[0] === "m").length < 2) return false;
    if (dropCovered(auth, entries, crowded)) { prune(); return true; }
    if (!crowded) return false;
    const merged = enc(Y.mergeUpdatesV2(entries.map(([, v]) => dec(v))));
    const key = nextKey("m");
    const parts = partsOf(key, merged);
    const candidate = { ...store.value, y: { ...store.value.y } };
    for (const [k, v] of parts) candidate.y[k] = v;
    if (utf8Bytes(JSON.stringify(candidate)) > compact.room) {
      quietUntil = entries.length + compact.keys;
      return false;
    }
    const captured = captureYValue({ v: 1, y: auth }).y;
    const incompleteFolds = Object.keys(auth).filter((k) => !(k in captured)).map(baseOf).filter((k) => k[0] === "m");
    const inputs = new Map(entries);
    for (const k of incompleteFolds) inputs.set(k, null);
    const held = new Map();
    for (const k of keysOf(auth, inputs)) if (inputs.get(baseOf(k)) !== null) held.set(k, captured[k] ?? auth[k]);
    fold = { key, parts, merged, inputs, held };
    known.add(key);
    store.handle.update((data) => { for (const [k, v] of parts) data.y[k] = v; });
    stats.compactions++;
    return true;
  }



  // Every page descends from a seed whose Yjs client is derived from its article, and
  // compaction keeps every client in the merged state. A room state that shares no client
  // with this tab's document is a page rebuilt from another article while the tab was away.
  const clientsOf = (y) => {
    const clients = new Set();
    for (const [, v] of entriesOf(y ?? {})) for (const c of Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(dec(v))).keys()) clients.add(c);
    return clients;
  };
  // A page whose article has no blocks seeds with no client at all; it still shares its
  // lineage with a room that holds the very update this tab started from.
  const started = new Map(initial);
  const sharesLineage = (y) => {
    const theirs = clientsOf(y);
    const mine = [...Y.decodeStateVector(Y.encodeStateVector(ydoc)).keys()];
    if (!theirs.size || !mine.length || mine.some((c) => theirs.has(c))) return true;
    return entriesOf(y ?? {}).some(([k, v]) => started.get(k) === v);
  };

  const off = store.onRebase((ev) => {
    if (stopped) return;
    const ops = ev.source === "remote" && ev.frame ? ev.frame.ops : null;
    const plain = ops && ops.every((op) => op.path[0] === "y" && op.path.length === 2 && !PART_KEY.test(op.path[1]));
    if (!plain && ev.cause !== "refused" && !sharesLineage(ev.next.y)) {
      stop("lineage");
      return;
    }
    if (plain) {
      for (const op of ops) if (op.op === "set") applyKey(op.path[1], op.value);
    } else {
      for (const [k, v] of entriesOf(ev.next.y ?? {})) applyKey(k, v);
    }
    prune();
    schedule(ev.source !== "remote" || !ops, ev.source !== "remote");
  });

  // A page update the room refused as too large is never offered again: the difference would
  // be refused on every offer. Every update of this tab's the room has not confirmed builds on
  // the refused one, so they are all taken back, with the parts of updates the room does not
  // hold whole, and the room's page stays one a checkpoint can render.
  const offDelivery = store.onDelivery((event) => {
    if (event.phase !== "refused") return;
    if (event.code !== "too-large" || stopped) { prune(); return; }
    stop("too-large");
    const auth = store.authoritative.y ?? {};
    const whole = captureYValue({ v: 1, y: auth }).y;
    const unconfirmed = Object.keys(store.value.y ?? {}).filter((k) => !(k in auth));
    const partial = Object.keys(auth).filter((k) => PART_KEY.test(k) && !(k in whole) && baseOf(k).slice(1).startsWith(`${me}-`));
    if (unconfirmed.length || partial.length) drop([...unconfirmed, ...partial]);
    prune();
  });

  return { known, stats, settle, reconcile, get reconcilePending() { return reconcilePending; }, get stopped() { return stopped; },
    // Test-only snapshot of the counters and cache sizes; no mutable set leaves the provider.
    _diagnostics: () => ({ known: known.size, cover: coverCache.size, fold: fold ? fold.parts.length : 0, generation }), compact: maybeCompact, dispose() { off(); offDelivery(); ydoc.off("updateV2", onUpdate); if (timer) clearTimer(timer); } };
}
