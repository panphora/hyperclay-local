/**
 * containment.js — whether an update adds anything to a state, asked without applying it.
 *
 * Applying an update changes nothing exactly when every item it carries is already there,
 * by id, and every id it deletes is already deleted. So a state is read once into ranges,
 * the clock ranges its items occupy and the ranges it deletes, and each update is then
 * read, never applied: a hundred records cost one reading of the state, not a hundred.
 *
 * Two kinds of state answer. A state integrated into a document answers exactly as
 * applying would, and one that leaves anything pending contains nothing. The union of some
 * entries' own ranges answers for content: an update inside it adds no item and no explicit
 * deletion any of those entries lacks, so retiring it loses nothing they do not hold. It can
 * miss a deletion Yjs only makes while integrating, never claim one. A state vector alone
 * proves nothing about deletions.
 */

import { Doc, Skip, applyUpdateV2, decodeUpdateV2, createDeleteSetFromStructStore } from "../../vendor/yjs.vendor.js";

function merged(map) {
  for (const [client, list] of map) {
    list.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const range of list) {
      const last = out[out.length - 1];
      if (last && range[0] <= last[1]) { if (range[1] > last[1]) last[1] = range[1]; }
      else out.push([range[0], range[1]]);
    }
    map.set(client, out);
  }
  return map;
}

const add = (map, client, from, to) => {
  if (to <= from) return;
  const list = map.get(client);
  if (list) list.push([from, to]);
  else map.set(client, [[from, to]]);
};

/**
 * The clock ranges one update's items occupy and the ranges it deletes.
 *
 * @param {Uint8Array} update - a V2 update
 * @returns {{items: Map<number, Array<[number, number]>>, deletes: Map<number, Array<[number, number]>>}}
 */
export function rangesOf(update) {
  const { structs, ds } = decodeUpdateV2(update);
  const items = new Map();
  for (const struct of structs) if (!(struct instanceof Skip)) add(items, struct.id.client, struct.id.clock, struct.id.clock + struct.length);
  const deletes = new Map();
  for (const [client, list] of ds.clients) for (const { clock, len } of list) add(deletes, client, clock, clock + len);
  return { items: merged(items), deletes: merged(deletes) };
}

/**
 * The ranges several entries hold together.
 *
 * @param {Array<Object>} list - from rangesOf() or unite()
 * @returns {Object}
 */
export function unite(list) {
  if (list.length === 1) return list[0];
  const items = new Map();
  const deletes = new Map();
  for (const ranges of list) {
    for (const [client, spans] of ranges.items) for (const [from, to] of spans) add(items, client, from, to);
    for (const [client, spans] of ranges.deletes) for (const [from, to] of spans) add(deletes, client, from, to);
  }
  return { items: merged(items), deletes: merged(deletes) };
}

function inside(spans, from, to) {
  if (!spans) return false;
  let lo = 0, hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid];
    if (from < span[0]) hi = mid - 1;
    else if (from >= span[1]) lo = mid + 1;
    else return to <= span[1];
  }
  return false;
}

/**
 * Whether every item and deletion of `ranges` is already inside `state`.
 *
 * @param {Object} state - from unite(), rangesOf() or indexOf()
 * @param {Object} ranges - from rangesOf()
 * @returns {boolean}
 */
export function within(state, ranges) {
  if (state.complete === false) return false;
  for (const [client, spans] of ranges.items) for (const [from, to] of spans) if (!inside(state.items.get(client), from, to)) return false;
  for (const [client, spans] of ranges.deletes) for (const [from, to] of spans) if (!inside(state.deletes.get(client), from, to)) return false;
  return true;
}

/**
 * A document's state as ranges: every item from clock 0 to its state, and every deletion
 * it holds, its own and the ones integration made.
 *
 * @param {Doc} doc
 * @returns {Object}
 */
export function docRanges(doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) return { complete: false };
  const items = new Map();
  for (const [client, structs] of doc.store.clients) {
    const last = structs[structs.length - 1];
    add(items, client, 0, last.id.clock + last.length);
  }
  const deletes = new Map();
  for (const [client, list] of createDeleteSetFromStructStore(doc.store).clients) for (const { clock, len } of list) add(deletes, client, clock, clock + len);
  return { complete: true, items, deletes: merged(deletes) };
}

/**
 * The state some updates make together, integrated once.
 *
 * @param {Array<Uint8Array>} updates
 * @returns {Object}
 */
export function stateIndex(updates) {
  const doc = new Doc({ gc: false });
  try {
    for (const update of updates) applyUpdateV2(doc, update);
    return docRanges(doc);
  } finally {
    doc.destroy();
  }
}

const indexes = new WeakMap();

/**
 * The state one checkpoint's bytes make, read once for as long as those bytes are held.
 * The bytes are never written to after they are indexed.
 *
 * @param {Uint8Array} bytes
 * @param {Doc} [doc] - the document these bytes were just encoded from, when there is one
 * @returns {Object}
 */
export function indexOf(bytes, doc = null) {
  let index = indexes.get(bytes);
  if (!index) {
    index = doc ? docRanges(doc) : stateIndex([bytes]);
    indexes.set(bytes, index);
  }
  return index;
}

/**
 * Whether applying `update` to the indexed state would add no item and no deletion.
 *
 * @param {Object} index - from indexOf() or stateIndex()
 * @param {Uint8Array} update
 * @returns {boolean}
 */
export function indexContains(index, update) {
  return index.complete !== false && within(index, rangesOf(update));
}
