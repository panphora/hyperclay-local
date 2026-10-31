import * as Y from '../vendor/yjs.vendor.js';
import { toBase64, fromBase64 } from '../vendor/yjs.vendor.js';
import { PART_KEY, isBase64, entriesOf } from '../page/ybind/parts.js';
import { rangesOf, unite, within, docRanges } from '../page/ybind/containment.js';

export const COMPACTION = Object.freeze({
  version: 1,
  loose: 32,
  soft: 16,
  activeBytes: 3840 * 1024,
  deleteReserve: 64 * 1024,
  newPerFrame: 4,
  tailFloor: 64 * 1024,
  leaseMs: 60 * 1000,
  retired: 8192,
});

export const ROOM_ERROR_STATUS = Object.freeze({
  'checkpoint-required': 503, 'page-full': 409, 'compaction-failed': 409,
  'page-immutable': 409, 'page-batch': 409, 'page-update-invalid': 422, 'page-upgrade': 404,
});

export const CLIENT_KEY = /^[ur][0-9a-z]+(-[0-9a-z]+){2}$/;
export const HOST_KEY = /^[ctf][0-9a-z]{8}-[0-9a-z]+(-[0-9a-z]+)?$/;
const CHECKPOINT_KEY = /^(seed|c[0-9a-z]{8}-[0-9a-z]+)$/;

export const isCheckpointKey = (key) => CHECKPOINT_KEY.test(key);

export function pageShape(y, limits = COMPACTION) {
  let checkpoints = 0, loose = 0, parts = 0, legacy = 0;
  for (const key of Object.keys(y)) {
    if (PART_KEY.test(key)) { parts++; continue; }
    if (isCheckpointKey(key)) checkpoints++;
    else loose++;
    if (!CLIENT_KEY.test(key) && !HOST_KEY.test(key) && key !== 'seed') legacy++;
  }
  return { checkpoints, loose, parts, legacy, normal: parts === 0 && checkpoints <= 1 && loose <= limits.loose };
}

export function planCompaction(y, { overflow = false } = {}, limits = COMPACTION) {
  const shape = pageShape(y, limits);
  const entries = entriesOf(y);
  const checkpoint = entries.filter(([key]) => isCheckpointKey(key));
  const loose = entries.filter(([key]) => !isCheckpointKey(key));
  const looseBytes = loose.reduce((sum, [, v]) => sum + v.length, 0);
  const checkpointBytes = checkpoint.reduce((sum, [, v]) => sum + v.length, 0);
  const full = !shape.normal || overflow || looseBytes > Math.max(limits.tailFloor, checkpointBytes / 4);
  if (full) return { kind: 'full', sources: entries };
  if (loose.length < 2 || shape.loose < limits.soft) return null;
  return { kind: 'tail', sources: loose };
}

export function buildCandidate({ kind, sources, encode = Y.encodeStateAsUpdateV2 }) {
  const updates = sources.map(([, v]) => fromBase64(v));
  if (kind === 'tail') {
    const merged = Y.mergeUpdatesV2(updates);
    const index = rangesOf(merged);
    for (const update of updates) if (!within(index, rangesOf(update))) return { failure: 'not-covered' };
    return { update: toBase64(merged) };
  }
  const doc = new Y.Doc({ gc: true });
  try {
    for (const update of updates) Y.applyUpdateV2(doc, update);
    if (doc.store.pendingStructs || doc.store.pendingDs) {
      const merged = Y.mergeUpdatesV2(updates);
      const index = rangesOf(merged);
      for (const update of updates) if (!within(index, rangesOf(update))) return { failure: 'not-covered' };
      return { update: toBase64(merged), pending: true };
    }
    const index = docRanges(doc);
    for (const update of updates) if (!within(index, rangesOf(update))) return { failure: 'not-covered' };
    const out = toBase64(encode(doc));
    const check = new Y.Doc({ gc: true });
    try {
      Y.applyUpdateV2(check, fromBase64(out));
      const stored = docRanges(check);
      if (!stored.complete) return { failure: 'not-covered' };
      for (const update of updates) if (!within(stored, rangesOf(update))) return { failure: 'not-covered' };
    } finally { check.destroy(); }
    return { update: out };
  } catch (error) {
    return { failure: 'invalid-update', message: error?.message || String(error) };
  } finally {
    doc.destroy();
  }
}

export function checkUpdate(text) {
  if (typeof text !== 'string' || !isBase64(text)) return null;
  try {
    const { items, deletes } = rangesOf(fromBase64(text));
    let deleted = 0;
    for (const spans of deletes.values()) for (const [from, to] of spans) deleted += to - from;
    return { deleted, inserts: items.size > 0 };
  } catch {
    return null;
  }
}

export function admitPageOps({ y, ops, state, limits }) {
  if (state.compaction !== limits.version) return { error: 'page-upgrade' };
  let added = 0;
  let deleted = 0;
  let inserts = false;
  for (const op of ops) {
    const key = op.path?.[1];
    if (op.op !== 'set' || typeof key !== 'string' || !CLIENT_KEY.test(key)) return { error: 'page-immutable' };
    if (Object.hasOwn(y, key)) {
      if (y[key] !== op.value) return { error: 'page-immutable' };
      continue;
    }
    if (state.retired.has(key)) return { error: 'page-immutable' };
    const checked = checkUpdate(op.value);
    if (!checked) return { error: 'page-update-invalid' };
    added += 1;
    deleted += checked.deleted;
    inserts ||= checked.inserts;
  }
  if (added > limits.newPerFrame) return { error: 'page-batch' };
  // A page whose compaction failed keeps taking edits up to its byte limit, as a room
  // without compaction does, and refuses past it as full instead of waiting for a fold.
  if (state.failed) return { added, deleted, inserts, limit: limits.activeBytes + (inserts ? 0 : limits.deleteReserve), shape: null, failed: true };
  const shape = pageShape(y, limits);
  if (!shape.normal || shape.loose + added > limits.loose) return { error: 'checkpoint-required', retryAfter: 0 };
  return { added, deleted, inserts, limit: limits.activeBytes + (inserts ? 0 : limits.deleteReserve), shape };
}

export function contained(roomEntries, fileValue, rangesFor) {
  const index = unite(roomEntries.map(([k, v]) => rangesFor(k, v)));
  return within(index, rangesOf(fromBase64(fileValue)));
}

const UNIQUE_KEY = (key) => CLIENT_KEY.test(key) || HOST_KEY.test(key);

export function createRangeCache(max = 256) {
  const cache = new Map();
  return (key, value) => {
    const hit = cache.get(key);
    if (hit && hit.value === value) return hit.ranges;
    const ranges = rangesOf(fromBase64(value));
    cache.delete(key);
    cache.set(key, { value, ranges });
    if (cache.size > max) cache.delete(cache.keys().next().value);
    return ranges;
  };
}

export function unionFileEntries({ y, fileY, retired, rangesFor, keyFor = (i, key) => key }) {
  const roomEntries = entriesOf(y);
  const have = new Map(roomEntries);
  let index = null;
  const adds = [];
  for (const [key, value] of entriesOf(fileY ?? {})) {
    if (have.get(key) === value) continue;
    if (retired.has(key) && UNIQUE_KEY(key)) continue;
    let ranges;
    try { ranges = rangesOf(fromBase64(value)); } catch { continue; }
    index ??= unite(roomEntries.map(([k, v]) => rangesFor(k, v)));
    if (!within(index, ranges)) adds.push([key, value]);
  }
  return adds.map(([key, value], i) => [keyFor(i, key), value]);
}
