// The page's live record and its ProseMirror document, and the way between them.
//
// The record is a flat map of blocks keyed by id: { "b-k1": { t, pos, ...attrs, c, m } }.
// `t` is the node type, `pos` a fractional order key, `c` a text block's flat
// text and `m` its mark keys, one per UTF-16 unit, left out when there are none
// (inline.js). Attributes equal to their schema default are left out, so
// a block's JSON is as small as the block. A table keeps its rows as an object
// keyed by row id ({ pos, cells: { <col id>: text } }), never a list, because a
// list in a live store is written whole and two tabs adding rows keep one.
//
// Order is (pos, id): pos strings compare as plain strings, and the id breaks
// the tie two tabs inserting at the same spot leave behind. Ids and positions
// are only ever assigned by a local edit (identityPlugin), never on open.
import { model, state, transform } from "../vendor/prosemirror.vendor.js";
import { flatten, unflatten, unitsOf } from "./inline.js";

export const REMOTE = "clay-page-remote";

// ---- fractional order keys -------------------------------------------------

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export const isKey = (key) => typeof key === "string" && VALID_KEY.test(key);

// A key strictly between a and b, read as base-62 fractions 0.a and 0.b; a ""
// is zero and b null is one. No key ends in "0", so there is always room
// between two of them.
function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while ((a[n] || "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

export function keyBetween(a = null, b = null) {
  if (a !== null && !isKey(a)) throw new TypeError(`page: invalid order key ${a}`);
  if (b !== null && !isKey(b)) throw new TypeError(`page: invalid order key ${b}`);
  if (a !== null && b !== null && a >= b) throw new RangeError(`page: order key ${a} is not before ${b}`);
  return midpoint(a ?? "", b);
}

// n keys between a and b, spread by halving so a thousand-row import keeps
// short keys.
export function keysBetween(a, b, n) {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  const mid = keyBetween(a, b);
  const half = Math.floor(n / 2);
  return [...keysBetween(a, mid, half), mid, ...keysBetween(mid, b, n - half - 1)];
}

export function orderedIds(map) {
  return Object.keys(map).sort((x, y) => {
    const px = map[x].pos ?? "", py = map[y].pos ?? "";
    if (px !== py) return px < py ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function newId(prefix = "b") {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Date.now().toString(36)}${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

// ---- block JSON <-> node ---------------------------------------------------

const KEYED = new Set(["id", "pos"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (v) => (v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)));

function attrsJson(node) {
  const out = {};
  for (const [name, spec] of Object.entries(node.type.spec.attrs || {})) {
    if (KEYED.has(name)) continue;
    if (!same(node.attrs[name], spec.default)) out[name] = copy(node.attrs[name]);
  }
  return out;
}

export function blockJson(node) {
  const out = { t: node.type.name, pos: node.attrs.pos, ...attrsJson(node) };
  if (node.type.name === "table") {
    const rows = {};
    node.forEach((row) => {
      const cells = {};
      row.forEach((cell) => { cells[cell.attrs.col] = cell.textContent; });
      rows[row.attrs.id] = { pos: row.attrs.pos, cells };
    });
    out.rows = rows;
  } else if (node.type.spec.content) {
    const { c, m } = flatten(node.content);
    out.c = c;
    if (m.some(Boolean)) out.m = m;
  }
  return out;
}

export function blockMap(doc) {
  const map = {};
  doc.forEach((node) => { map[node.attrs.id] = blockJson(node); });
  return map;
}

export function nodeFromBlock(schema, id, blockValue) {
  const { t, pos, c, m, w, rows, ...attrs } = blockValue;
  if (t === "table") {
    const cols = orderedIds(attrs.cols || {});
    const { table_row: rowType, table_cell: cellType } = schema.nodes;
    const children = orderedIds(rows || {}).map((rid) => rowType.createChecked(
      { id: rid, pos: rows[rid].pos },
      cols.map((col) => {
        const text = rows[rid].cells?.[col];
        return cellType.createChecked({ col }, text ? schema.text(String(text)) : null);
      }),
    ));
    return schema.nodes.table.createChecked({ ...attrs, id, pos }, children);
  }
  const type = schema.nodes[t];
  if (!type) throw new RangeError(`page: unknown block type ${t}`);
  // A record from before the flat form holds ProseMirror's inline JSON.
  const content = typeof c === "string" ? unflatten(schema, c, unitsOf(m, c.length), type) : Array.isArray(c) && c.length ? model.Fragment.fromJSON(schema, c) : null;
  return type.create({ ...attrs, id, pos }, content);
}

export function docFromBlocks(schema, blocks) {
  const nodes = orderedIds(blocks).map((id) => nodeFromBlock(schema, id, blocks[id]));
  return nodes.length ? schema.nodes.doc.create(null, nodes) : schema.nodes.doc.createAndFill();
}

// The blocks a transaction touched, before and after, for diffOps. ProseMirror
// shares every unchanged node between the two documents, so identity is enough.
export function changedBlocks(before, after) {
  const index = (doc) => {
    const map = new Map();
    doc.forEach((node) => map.set(node.attrs.id, node));
    return map;
  };
  const b = index(before), a = index(after);
  const out = { before: {}, after: {} };
  for (const [id, node] of b) if (a.get(id) !== node) out.before[id] = blockJson(node);
  for (const [id, node] of a) if (b.get(id) !== node) out.after[id] = blockJson(node);
  return out;
}

// ---- identity: ids and order keys after a local edit -----------------------

// Indices of the longest run of keys, in document order, that is already
// strictly increasing. Those keep their pos; only the rest get new ones, so a
// moved block rewrites one key, not every key after it.
function longestIncreasing(keys) {
  const tails = [], tailAt = [], prev = new Array(keys.length).fill(-1);
  keys.forEach((key, i) => {
    if (key === null) return;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < key) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tailAt[lo - 1];
    tails[lo] = key;
    tailAt[lo] = i;
  });
  const keep = new Set();
  for (let i = tailAt[tails.length - 1] ?? -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

// For siblings [{ id, pos, rank }] in document order: the new { id, pos } each
// needs, or null. A missing id, or a second holder of an id, gets a fresh one.
// Of several holders, the highest rank keeps the id, the first on a tie: a
// split copies attrs to the new half, and a pasted copy lands beside the original.
export function repairSiblings(items, prefix) {
  const keeper = new Map();
  items.forEach(({ id, rank = 0 }, i) => {
    if (id && (!keeper.has(id) || rank > (items[keeper.get(id)].rank ?? 0))) keeper.set(id, i);
  });
  const fresh = items.map(({ id }, i) => !id || keeper.get(id) !== i);
  const keep = longestIncreasing(items.map(({ pos }, i) => (!fresh[i] && isKey(pos) ? pos : null)));
  const out = items.map(() => null);
  for (let i = 0; i < items.length;) {
    if (keep.has(i)) { i++; continue; }
    let j = i;
    while (j < items.length && !keep.has(j)) j++;
    const lower = i > 0 ? items[i - 1].pos : null;
    const upper = j < items.length ? items[j].pos : null;
    const keys = keysBetween(lower, upper, j - i);
    for (let k = i; k < j; k++) out[k] = { id: fresh[k] ? newId(prefix) : items[k].id, pos: keys[k - i] };
    i = j;
  }
  return out;
}

// True when every step of tr edits inside one top-level textblock: its text
// and marks change, never which blocks the page has, their order or attrs.
export function insideTextblocks(tr) {
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (step instanceof transform.ReplaceStep) {
      if (step.slice.openStart || step.slice.openEnd) return false;
      for (let j = 0; j < step.slice.content.childCount; j++) if (!step.slice.content.child(j).isInline) return false;
    } else if (!(step instanceof transform.AddMarkStep || step instanceof transform.RemoveMarkStep)) return false;
    const $from = tr.docs[i].resolve(step.from), $to = tr.docs[i].resolve(step.to);
    if ($from.depth !== 1 || $to.depth !== 1 || $from.index(0) !== $to.index(0) || !$from.parent.isTextblock) return false;
  }
  return true;
}

export function identityPlugin() {
  // Documents with nothing to repair. An edit inside textblocks keeps a
  // document that way, so it skips the walk over every block.
  const clean = new WeakSet();
  const ready = (doc) => {
    const ids = new Set();
    let previous = null, valid = true;
    doc.forEach((node) => {
      if (!node.attrs.id || ids.has(node.attrs.id) || !isKey(node.attrs.pos) || (previous !== null && previous >= node.attrs.pos)) valid = false;
      ids.add(node.attrs.id);
      previous = node.attrs.pos;
      if (node.type.name !== "table") return;
      const rows = new Set();
      let rowPrevious = null;
      node.forEach((row) => {
        if (!row.attrs.id || rows.has(row.attrs.id) || !isKey(row.attrs.pos) || (rowPrevious !== null && rowPrevious >= row.attrs.pos)) valid = false;
        rows.add(row.attrs.id);
        rowPrevious = row.attrs.pos;
      });
    });
    return valid;
  };
  return new state.Plugin({
    state: {
      init(_config, editor) { if (ready(editor.doc)) clean.add(editor.doc); return null; },
      apply() { return null; },
    },
    appendTransaction(transactions, old, next) {
      if (clean.has(old.doc) && transactions.every(insideTextblocks)) {
        clean.add(next.doc);
        return null;
      }
      if (!transactions.some((tr) => tr.docChanged && !tr.getMeta(REMOTE))) {
        if (clean.has(old.doc) && ready(next.doc)) clean.add(next.doc);
        return null;
      }
      const tr = next.tr;
      const fix = (node, at, change) => { if (change) tr.setNodeMarkup(at, null, { ...node.attrs, ...change }); };
      // Of two holders of an id, the one with the old block's content keeps it
      // (Enter at the start of a block moves its text down), then the one the
      // old block maps to (a pasted copy lands beside the original).
      const mapping = new transform.Mapping();
      for (const t of transactions) mapping.appendMapping(t.mapping);
      const was = new Map();
      const track = (node, at) => {
        if (!node.attrs.id) return;
        const r = mapping.mapResult(at, 1);
        was.set(node.attrs.id, { node, at: r.deleted ? null : r.pos });
      };
      old.doc.forEach((node, offset) => {
        track(node, offset);
        if (node.type.name === "table") node.forEach((row, rowOffset) => track(row, offset + 1 + rowOffset));
      });
      const rank = (node, at) => {
        const w = was.get(node.attrs.id);
        return w ? (w.node.content.eq(node.content) ? 2 : 0) + (w.at === at ? 1 : 0) : 0;
      };
      const items = (list) => list.map(({ node, at }) => ({ ...node.attrs, rank: rank(node, at) }));

      const top = [];
      next.doc.forEach((node, offset) => top.push({ node, at: offset }));
      repairSiblings(items(top), "b").forEach((change, i) => fix(top[i].node, top[i].at, change));

      for (const { node, at: offset } of top) {
        if (node.type.name !== "table") continue;
        const rows = [];
        node.forEach((row, rowOffset) => rows.push({ node: row, at: offset + 1 + rowOffset }));
        repairSiblings(items(rows), "r").forEach((change, i) => fix(rows[i].node, rows[i].at, change));
      }
      if (!tr.docChanged) clean.add(next.doc);
      return tr.docChanged ? tr : null;
    },
  });
}
