// One keystroke changes one block. The walk over the whole flow (walk.js) costs a
// few milliseconds at 2,000 blocks whatever the keystroke did, so a transaction that
// only changed text inside one live block is read from the transaction itself, that
// block is walked again from its own marker, and the result is spliced into the
// previous walk. Anything else (a marker, an attribute, a recovery record, a move,
// text inside a removed block's region) returns null and the caller walks from the
// start. The caller proves the splice against a full walk when asked (walkSignature).
import * as Y from "../../vendor/yjs.vendor.js";
import { idKey, sameJson } from "./layout.js";
import { marksFromAttributes, marksKey } from "./marks.js";
import { yAfter } from "./tokens.js";
import { canonicalRevision } from "./recovery.js";
import { tableFieldOwner } from "./table.js";
import { schema } from "../schema.js";

const TEXT_DELETE_PREFIX = '["text-delete",';

// The block whose attribute map a type is, or null.
const blockOfAttrs = (pd, type) => (type instanceof Y.AbstractType && type._item && type._item.parent === pd.attrs && typeof type._item.parentSub === "string" ? type._item.parentSub : null);
// The walk reads a block's type, and docOf reads every block's parent to break cycles.
const crossBlock = (key) => key === "t" || key === "parent";

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
// changed (or none), the marker of a block it split off that one (`split`, a new marker
// with a new attribute map), the blocks whose own fields it changed (table fields,
// attributes other than the type and the parent), whether it deleted anything and
// whether it wrote a format item; or null when the walk must start over. The walk never
// reads those fields: only those blocks' nodes are derived again.
export function captureDelta(pd, transaction, previous) {
  const stops = stopIndex(previous);
  const fields = new Set();
  const born = new Set();
  const tableKeys = transaction.changed.get(pd.tableFields) ?? new Set();
  for (const [type, keys] of transaction.changed) {
    if (type === pd.flow) continue;
    if (type === pd.attrs) {
      // A split writes the new block's first attribute map beside its marker. Only this
      // tab's own: an id it just minted, so no removal, restore or copy record can name it.
      if (!transaction.local) return null;
      for (const key of keys) {
        const map = pd.attrs.get(key);
        if (!(map instanceof Y.Map) || map._item.left || map._item.id.clock < (transaction.beforeState.get(map._item.id.client) ?? 0)) return null;
        born.add(key);
      }
      if (born.size > 1) return null;
      continue;
    }
    if (type === pd.tableFields) {
      for (const key of keys) {
        const owner = pd.tableFields.has(key) ? tableFieldOwner(key, pd.tableFields.get(key)) : null;
        if (owner === null) return null;
        fields.add(owner);
      }
      continue;
    }
    const block = blockOfAttrs(pd, type);
    if (block !== null) {
      for (const key of keys) if (crossBlock(key)) return null;
      fields.add(block);
      continue;
    }
    if (type !== pd.gone) return null;
    for (const key of keys) if (typeof key !== "string" || !key.startsWith(TEXT_DELETE_PREFIX)) return null;
  }
  const store = pd.ydoc.store;
  let marker = null, split = null, formats = false;
  const claim = (it) => {
    if (!(it instanceof Y.Item)) return false;
    // A text-delete record is written beside the deletion it describes; the walk never reads it.
    if (it.parent === pd.gone) return typeof it.parentSub === "string" && it.parentSub.startsWith(TEXT_DELETE_PREFIX);
    if (it.parent === pd.tableFields) return tableKeys.has(it.parentSub);
    if (it.parent === pd.attrs) return born.has(it.parentSub);
    if (it.parent !== pd.flow) {
      const block = blockOfAttrs(pd, it.parent);
      return block !== null && (born.has(block) || (fields.has(block) && !crossBlock(it.parentSub)));
    }
    if (isMarker(it)) {
      if (it.deleted || !born.has(it.content.embed.b)) return false;
      split = it;
    } else if (!textual(it)) return false;
    const owner = markerOf(it, stops);
    if (!owner || (marker && owner !== marker)) return false;
    marker = owner;
    if (it.content instanceof Y.ContentFormat) formats = true;
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
  if (born.size && !split) return null;
  return marker || fields.size ? { marker, split, deleted, formats, fields, remote: !transaction.local } : null;
}

const fmtOf = (cattrs) => { for (const key in cattrs) return { ...cattrs }; return null; };

// Walks one live block again from its marker and splices it into the previous walk,
// or returns null when that block is not a plain visible one. A block whose runs hold a
// hidden run (a removed or moved-away block's marker inside its extent) is walked again
// up to the first live marker, where its first hidden run starts; what follows is the
// previous walk's, moved by the change in length. That needs the format state there
// unchanged, so the transaction must not have written a format item. A split's new
// marker (`change.split`) ends the block there and opens the new block, which takes the
// rest of the extent.
export function rewalk(pd, previous, marker, change = null) {
  const formats = change?.formats ?? true, split = change?.split ?? null;
  const visible = previous.visible;
  let index = -1, start = 0;
  for (let i = 0; i < visible.length; i++) {
    const seg = visible[i];
    if (seg.brk && seg.brk.client === marker.id.client && seg.brk.clock === marker.id.clock) { index = i; break; }
    start += seg.len;
  }
  if (index < 0) return null;
  const old = visible[index];
  if (old.implicit || old.atom || old.opaque || old.recovered || old.hide) return null;
  const hole = old.runs.findIndex((r) => r.hole !== undefined);
  if (hole >= 0 && formats) return null;
  // A moved block keeps its old marker live under the removal that hides it, so its copy
  // records its items. They only decide something when another copy of the block is
  // visible too (walk.js, the post pass): that is the full walk's case.
  if (old.items && previous.copies.has(old.baseId)) return null;
  const stops = stopIndex(previous);
  const cattrs = { ...(old.fmtIn ?? {}) };
  let styled = null;
  const first = { ...old, runs: [], len: 1 };
  if (old.items) first.items = [];
  let cur = first, bounded = false;
  const origin = yAfter(previous.holes, start);
  let at = origin + 1;
  for (let it = marker.right; it; it = it.right) {
    // A stop opens a hidden region inside this block's extent: that is the full walk's case.
    if (it.deleted) { if (hitsStop(it, stops)) return null; continue; }
    if (isMarker(it) && (it !== split || cur !== first)) { bounded = true; break; }
    const here = at;
    if (it.countable) at += it.length;
    const c = it.content;
    if (it === split) {
      const id = c.embed.b;
      const t = pd.attrs.get(id)?.get("t") || "paragraph";
      if (!Object.hasOwn(schema.nodes, t) || !schema.nodes[t].isTextblock) return null;
      const f = fmtOf(cattrs);
      first.fmtOut = f;
      cur = { kind: "b", id, baseId: id, brk: { client: it.id.client, clock: it.id.clock }, implicit: false, runs: [], len: 1, atom: false, items: null, fmtIn: f, fmtOut: null, t, opaque: false };
      styled = null;
      continue;
    }
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; styled = null; continue; }
    if (c instanceof Y.ContentEmbed) {
      cur.runs.push({ br: true });
      if (cur.items) cur.items.push({ at: here, id: idKey(it.id), client: it.id.client, clock: it.id.clock, length: it.length, kind: "br", text: null, blockId: null, raw: { ...cattrs } });
      cur.len += 1;
      continue;
    }
    if (c instanceof Y.ContentString) {
      if (!styled) { const marks = marksFromAttributes(cattrs, cur.t); styled = { marks, mk: marksKey(marks) }; }
      cur.runs.push({ text: c.str, marks: styled.marks, mk: styled.mk });
      if (cur.items) cur.items.push({ at: here, id: idKey(it.id), client: it.id.client, clock: it.id.clock, length: it.length, kind: "text", text: c.str, blockId: null, raw: { ...cattrs } });
      cur.len += c.str.length;
    } else if (it.countable) return null;
  }
  let prefix = old.len;
  if (hole < 0) {
    if (!sameJson(cattrs, old.fmtOut ?? {})) return null;
  } else {
    if (!bounded) return null;
    // The tail after the hole keeps the marks it was read with, which follow the old
    // block's type: a split that changes the type is the full walk's case.
    if (cur.t !== old.t) return null;
    prefix = 1;
    for (let i = 0; i < hole; i++) prefix += old.runs[i].br ? 1 : old.runs[i].text.length;
  }
  const parts = cur === first ? [first] : [first, cur];
  const delta = parts.reduce((n, part) => n + part.len, 0) - prefix;
  const cut = origin + prefix;
  const moved = (entry) => (entry.at >= cut ? { ...entry, at: entry.at + delta } : entry);
  cur.fmtOut = old.fmtOut;
  if (hole >= 0) {
    cur.runs = cur.runs.concat(old.runs.slice(hole));
    cur.len += old.len - prefix;
    if (cur.items) cur.items = cur.items.concat(old.items.filter((item) => item.at >= cut).map(moved));
  }
  const next = { ...previous, visible: visible.slice(), tokens: previous.tokens + delta };
  next.visible.splice(index, 1, ...parts);
  if (delta) {
    const end = start + prefix;
    next.holes = previous.holes.map((h) => (h.at >= end ? { at: h.at + delta, len: h.len } : h));
    next.hidden = previous.hidden.map((entry) => (entry.at >= cut ? { ...entry, at: entry.at + delta, items: entry.items.map(moved) } : entry));
    for (let j = index + parts.length; j < next.visible.length; j += 1) {
      const later = next.visible[j];
      if (later.items?.length) next.visible[j] = { ...later, items: later.items.map(moved) };
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
