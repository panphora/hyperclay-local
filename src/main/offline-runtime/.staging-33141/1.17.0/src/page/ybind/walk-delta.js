// One keystroke changes one block. The walk over the whole flow (walk.js) costs a
// few milliseconds at 2,000 blocks whatever the keystroke did, so a transaction that
// only changed text inside one live block is read from the transaction itself, that
// block is walked again from its own marker, and the result is spliced into the
// previous walk. Anything else (a marker, an attribute, a recovery record, a move,
// text inside a removed block's region) returns null and the caller walks from the
// start. The caller proves the splice against a full walk when asked (walkSignature).
import * as Y from "../../vendor/yjs.vendor.js";
import { sameJson } from "./layout.js";
import { marksFromAttributes, marksKey } from "./marks.js";
import { yAfter } from "./tokens.js";
import { canonicalRevision } from "./recovery.js";

const TEXT_DELETE_PREFIX = '["text-delete",';

const isMarker = (it) => it.content instanceof Y.ContentEmbed && it.content.embed.b !== undefined;
const textual = (it) => it.content instanceof Y.ContentString || it.content instanceof Y.ContentFormat || (it.content instanceof Y.ContentEmbed && it.content.embed.b === undefined);

// The deleted items the walk acts on (removal and legacy starts), by client. Yjs merges
// neighbouring deleted items and may have replaced a marker's content, so a deleted item
// is matched by id range, never by content. Any other deleted item is skipped, as the
// walk skips it.
const stopIndex = (w) => {
  const by = new Map();
  for (const stop of w.stops) (by.get(stop.client) ?? by.set(stop.client, []).get(stop.client)).push(stop);
  return by;
};
const hitsStop = (it, stops) => {
  const list = stops.get(it.id.client);
  if (!list) return false;
  const lo = it.id.clock, hi = lo + it.length;
  return list.some((s) => s.clock < hi && lo < s.clock + s.len);
};

// The live marker whose block holds an item, or null when a stop lies between them.
const markerOf = (it, stops) => {
  for (let left = it.left; left; left = left.left) {
    if (left.deleted) { if (hitsStop(left, stops)) return null; continue; }
    if (isMarker(left)) return left;
  }
  return null;
};

// Reads a finished Yjs transaction and returns the one live marker whose block alone it
// changed, with whether it deleted anything, or null when the walk must start over.
export function captureDelta(pd, transaction, previous) {
  const stops = stopIndex(previous);
  for (const [type, keys] of transaction.changed) {
    if (type === pd.flow) continue;
    if (type !== pd.gone) return null;
    for (const key of keys) if (typeof key !== "string" || !key.startsWith(TEXT_DELETE_PREFIX)) return null;
  }
  const store = pd.ydoc.store;
  let marker = null;
  const claim = (it) => {
    if (!(it instanceof Y.Item)) return false;
    // A text-delete record is written beside the deletion it describes; the walk never reads it.
    if (it.parent === pd.gone) return typeof it.parentSub === "string" && it.parentSub.startsWith(TEXT_DELETE_PREFIX);
    if (it.parent !== pd.flow || !textual(it)) return false;
    const owner = markerOf(it, stops);
    if (!owner || (marker && owner !== marker)) return false;
    marker = owner;
    return true;
  };
  for (const [client, clock] of transaction.afterState) {
    for (let at = transaction.beforeState.get(client) ?? 0; at < clock;) {
      const it = Y.getItem(store, { client, clock: at });
      if (!claim(it)) return null;
      at = it.id.clock + it.length;
    }
  }
  let deleted = false;
  for (const [client, ranges] of transaction.deleteSet.clients) {
    for (const { clock, len } of ranges) {
      for (let at = clock; at < clock + len;) {
        const it = Y.getItem(store, { client, clock: at });
        if (!claim(it)) return null;
        deleted = true;
        at = it.id.clock + it.length;
      }
    }
  }
  return marker ? { marker, deleted } : null;
}

// Walks one live block again from its marker and splices it into the previous walk,
// or returns null when that block is not a plain visible one.
export function rewalk(pd, previous, marker) {
  const visible = previous.visible;
  let index = -1, start = 0;
  for (let i = 0; i < visible.length; i++) {
    const seg = visible[i];
    if (seg.brk && seg.brk.client === marker.id.client && seg.brk.clock === marker.id.clock) { index = i; break; }
    start += seg.len;
  }
  if (index < 0) return null;
  const old = visible[index];
  if (old.implicit || old.atom || old.opaque || old.recovered || old.items || old.hide || old.runs.some((r) => r.hole !== undefined)) return null;
  const stops = stopIndex(previous);
  const cattrs = { ...(old.fmtIn ?? {}) };
  let styled = null;
  const runs = [];
  let len = 1;
  for (let it = marker.right; it; it = it.right) {
    // A stop opens a hidden region inside this block's extent: that is the full walk's case.
    if (it.deleted) { if (hitsStop(it, stops)) return null; continue; }
    if (isMarker(it)) break;
    const c = it.content;
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; styled = null; continue; }
    if (c instanceof Y.ContentEmbed) { runs.push({ br: true }); len += 1; continue; }
    if (c instanceof Y.ContentString) {
      if (!styled) { const marks = marksFromAttributes(cattrs, old.t); styled = { marks, mk: marksKey(marks) }; }
      runs.push({ text: c.str, marks: styled.marks, mk: styled.mk });
      len += c.str.length;
    }
  }
  if (!sameJson(cattrs, old.fmtOut ?? {})) return null;
  const next = { ...previous, visible: visible.slice(), tokens: previous.tokens + len - old.len };
  next.visible[index] = { ...old, runs, len };
  const delta = len - old.len;
  if (delta) {
    const end = start + old.len;
    next.holes = previous.holes.map((h) => (h.at >= end ? { at: h.at + delta, len: h.len } : h));
    const physical = yAfter(previous.holes, start) + old.len;
    const moved = (entry) => (entry.at >= physical ? { ...entry, at: entry.at + delta } : entry);
    next.hidden = previous.hidden.map((entry) => (entry.at >= physical ? { ...entry, at: entry.at + delta, items: entry.items.map(moved) } : entry));
    for (let j = index + 1; j < visible.length; j += 1) {
      const seg = visible[j];
      if (seg.items?.length) next.visible[j] = { ...seg, items: seg.items.map(moved) };
    }
  }
  return next;
}

const run = (r) => (r.br ? "\n" : r.hole !== undefined ? { hole: r.hole } : { text: r.text, mk: r.mk });
// Run boundaries follow Yjs item boundaries, and Yjs merges clock-adjacent live items
// after any transaction; only the text and its marks reach the document.
const joined = (runs) => {
  const out = [];
  for (const r of runs.map(run)) {
    const last = out[out.length - 1];
    if (last && typeof last === "object" && typeof r === "object" && last.text !== undefined && r.text !== undefined && last.mk === r.mk) out[out.length - 1] = { text: last.text + r.text, mk: r.mk };
    else out.push(r);
  }
  return out;
};

// Everything a walk result holds, as one string, independent of key order and of the
// mark objects a run carries (their key stands for them).
// A fence or stop names a deleted item as it was when the walk ran; Yjs may since have
// merged it into a neighbour. The writer matches fences by containment (fenceAfter), so
// the item that holds the id now is what both walks mean.
const holder = (pd, id) => { const it = Y.getItem(pd.ydoc.store, { client: id.client, clock: id.clock }); return { client: it.id.client, clock: it.id.clock, len: it.length }; };
export const walkSignature = (pd, w) => canonicalRevision({ ...w, copies: [...w.copies], fences: w.fences.map((f) => holder(pd, f)), stops: w.stops.map((f) => holder(pd, f)), visible: w.visible.map((s) => ({ ...s, runs: joined(s.runs) })) });
