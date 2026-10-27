// Flat lists and toggles for the page editor: the outline a flat document
// implies, the structure plugin that keeps `parent` and `indent` valid after
// local edits, the list, toggle and move commands, the collapse plugin and
// paste. Spec: plans/hyperclay/workspace-positioning/seats/default-page/v1/s3/MERGED-S3.md
import { model, state, view as pmView, commands, history } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { REMOTE, newId } from "./model.js";
import { safeHref, safeSrc } from "./link.js";
import { flatten, runsOf, unflatten, unitsOf } from "./inline.js";
import { OPAQUE_MARK, opaqueMark } from "./format-codec.js";
import { NATIVE_NAMES, nativeAttrs } from "./format-native.js";
import { DEFAULTS, MARKS, OPAQUE, envelopeAttrs, envelopeRecord, marksAttrs, marksEntries } from "./projection.js";

const alignOf = (a) => (a === "left" || a === "right" ? a : null);

const { Plugin, PluginKey, TextSelection, NodeSelection, Selection } = state;
const N = schema.nodes;
const isList = (n) => n.type === N.list_item;
const isToggle = (n) => n.type === N.toggle;
const parentOf = (n) => n.attrs.parent ?? null;

// Move, Tab and Shift-Tab are each their own undo step: the transaction closes
// the history group before it, and carries STEP so the editor closes the group
// after it too (createPageEditor).
export const STEP = "page-step";
export const MOVE = "page-move";
const asStep = (dispatch) => dispatch && ((tr) => dispatch(history.closeHistory(tr).setMeta(STEP, true)));

// ---- the outline ------------------------------------------------------------
//
// One entry per top-level block, in document order:
//   at, end   the block's start and end position
//   up        index of its outline parent, or -1. A list item with indent > 0
//             hangs under the nearest earlier item of its run with a smaller
//             indent; every other block hangs under the toggle named by parent.
//   depth     how many toggles it sits inside
//   hidden    some toggle above it is closed
//   subEnd    index of the last block of its subtree (itself when it has none)
// A subtree is always contiguous, so it is the range [ents[i].at, ents[subEnd].end].
export function outline(doc) {
  const ents = [];
  const toggleAt = new Map();
  let run = [];
  doc.forEach((node, at) => {
    const i = ents.length;
    const prev = ents[i - 1];
    const parent = parentOf(node);
    const t = parent !== null && toggleAt.has(parent) ? toggleAt.get(parent) : -1;
    let up = t;
    if (isList(node)) {
      if (!(prev && isList(prev.node) && parentOf(prev.node) === parent)) run = [];
      while (run.length && ents[run[run.length - 1]].node.attrs.indent >= node.attrs.indent) run.pop();
      if (run.length) up = run[run.length - 1];
      run.push(i);
    } else run = [];
    const hidden = t >= 0 && (ents[t].hidden || !ents[t].node.attrs.open);
    ents.push({ node, at, end: at + node.nodeSize, i, up, depth: t >= 0 ? ents[t].depth + 1 : 0, hidden, subEnd: i });
    if (isToggle(node) && node.attrs.id) toggleAt.set(node.attrs.id, i);
  });
  for (let j = ents.length - 1; j >= 0; j--) {
    const u = ents[j].up;
    if (u >= 0 && ents[j].subEnd > ents[u].subEnd) ents[u].subEnd = ents[j].subEnd;
  }
  return ents;
}

export const subtreeRange = (ents, i) => ({ from: ents[i].at, to: ents[ents[i].subEnd].end });

// ---- structure: parent and indent stay valid after any local edit -----------
//
// Rules, one forward pass:
//  1. A block's parent is null or a toggle on the chain the previous block
//     opens: the previous block's own toggle ancestors, plus the previous block
//     itself when it is a toggle. An invalid parent climbs its own chain
//     (through the old document for a toggle just deleted) until it is valid.
//  2. If the next block with a different parent names one deeper on that
//     chain, this block moves down to it, so blocks inserted inside a body
//     (one, or a pasted run of them) join the body instead of cutting it.
//  3. In a run of list items (contiguous items with one parent) the first has
//     indent 0 and each other at most the previous one's + 1. When an item is
//     clamped, its whole subtree moves by the same amount and its old siblings
//     move with it, so deleting a parent item promotes its children one level.
// A valid document comes back with no fixes.
export function structureFixes(doc, oldDoc = null) {
  const declared = new Map();
  oldDoc?.forEach((n) => { if (n.attrs.id) declared.set(n.attrs.id, parentOf(n)); });
  doc.forEach((n) => { if (n.attrs.id) declared.set(n.attrs.id, parentOf(n)); });
  const nodes = [];
  doc.forEach((node, at) => nodes.push({ node, at }));
  const ahead = new Array(nodes.length).fill(null);
  for (let i = nodes.length - 2; i >= 0; i--) {
    const next = parentOf(nodes[i + 1].node);
    ahead[i] = next !== parentOf(nodes[i].node) ? next : ahead[i + 1];
  }
  const fixes = [];
  let allowed = [null];
  let prev = null;
  let stack = [];
  nodes.forEach(({ node, at }, i) => {
    let p = parentOf(node);
    const seen = new Set();
    while (p !== null && !allowed.includes(p) && !seen.has(p)) { seen.add(p); p = declared.has(p) ? declared.get(p) : null; }
    if (!allowed.includes(p)) p = null;
    const q = ahead[i];
    if (allowed.indexOf(q) > allowed.indexOf(p)) p = q;
    const chain = allowed.slice(0, allowed.indexOf(p) + 1);

    let indent = node.attrs.indent;
    if (isList(node)) {
      const d = Number.isInteger(indent) && indent > 0 ? indent : 0;
      const continues = prev && isList(prev.node) && prev.parent === p;
      if (!continues) stack = [];
      while (stack.length && stack[stack.length - 1].orig > d) stack.pop();
      let shift = 0;
      if (stack.length) {
        const top = stack[stack.length - 1];
        shift = top.shift;
        if (top.orig === d) stack.pop();
      }
      indent = Math.max(0, Math.min(d - shift, continues ? prev.indent + 1 : 0));
      stack.push({ orig: d, shift: d - indent });
    } else stack = [];

    if (p !== parentOf(node) || (isList(node) && indent !== node.attrs.indent)) {
      fixes.push({ at, attrs: { ...node.attrs, parent: p, ...(isList(node) ? { indent } : {}) } });
    }
    prev = { node, parent: p, indent };
    allowed = isToggle(node) && node.attrs.id ? [...chain, node.attrs.id] : chain;
  });
  return fixes;
}

export function structurePlugin() {
  return new Plugin({
    appendTransaction(trs, old, next) {
      if (!trs.some((tr) => tr.docChanged && !tr.getMeta(REMOTE))) return null;
      const fixes = structureFixes(next.doc, old.doc);
      if (!fixes.length) return null;
      const tr = next.tr;
      for (const f of fixes) tr.setNodeMarkup(f.at, null, f.attrs);
      return tr;
    },
  });
}

// ---- spans ------------------------------------------------------------------

// The top-level indices the selection touches.
function touched(doc, sel, ents) {
  const a = doc.resolve(sel.from).index(0);
  let b = Math.min(doc.resolve(sel.to).index(0), ents.length - 1);
  if (b > a && sel.to <= ents[b].at) b--;
  return [Math.min(a, ents.length - 1), b];
}
export const touchedBlocks = touched;

// The selection lifted to whole sibling subtrees: [lo, hi] are block indices,
// every root in it shares the outline parent `up`.
export function siblingSpan(ents, a, b) {
  let lo = a;
  while (ents[lo].up >= 0 && b > ents[ents[lo].up].subEnd) lo = ents[lo].up;
  const up = ents[lo].up;
  let hi = ents[lo].subEnd;
  while (hi < b) hi = ents[hi + 1].subEnd;
  return { lo, hi, up };
}

// ---- block selection --------------------------------------------------------

// A selection of whole top-level blocks. anchor and head are block boundaries
// (depth-0 positions), so from..to covers whole blocks; the commands lift it to
// whole sibling subtrees (siblingSpan), so a selected toggle carries its body.
// It is invisible to ProseMirror (the DOM selection is hidden) and drawn with
// node decorations by blocksel.js.
const boundary = (doc, pos, side) => {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($p.depth === 0) return $p.pos;
  return side < 0 ? $p.before(1) : $p.after(1);
};
const blockRef = (e) => ({ id: e.node.attrs.id, at: e.at, node: e.node });
const matchesRef = (e, ref) => ref.id ? e.node.attrs.id === ref.id : e.at === ref.at && e.node.type === ref.node.type && e.node.content.eq(ref.node.content);

export function captureSpan(ents, lo, hi) {
  const roots = [];
  for (let i = lo; i <= hi; i = ents[i].subEnd + 1) roots.push(blockRef(ents[i]));
  return { roots, members: ents.slice(lo, hi + 1).map(blockRef) };
}

export function resolveSpan(ents, span) {
  const roots = span.roots.map((ref) => ents.findIndex((e) => matchesRef(e, ref))).filter((i) => i >= 0);
  if (!roots.length || roots.some((i) => ents[i].hidden)) return null;
  const lo = roots[0], up = ents[lo].up;
  let hi = ents[lo].subEnd;
  for (const i of roots.slice(1)) {
    if (i !== hi + 1 || ents[i].up !== up) return null;
    hi = ents[i].subEnd;
  }
  if (ents.slice(lo, hi + 1).some((e) => !span.members.some((ref) => matchesRef(e, ref)))) return null;
  return { lo, hi };
}

const mapSpan = (span, mapping) => {
  const map = (ref) => ({ ...ref, at: mapping.map(ref.at, 1) });
  return { roots: span.roots.map(map), members: span.members.map(map) };
};

export class BlockSelection extends Selection {
  map(doc, mapping) {
    return this.getBookmark().map(mapping).resolve(doc);
  }
  eq(other) {
    return other instanceof BlockSelection && other.anchor === this.anchor && other.head === this.head;
  }
  toJSON() {
    return { type: "page-block", anchor: this.anchor, head: this.head };
  }
  static fromJSON(doc, json) {
    return new BlockSelection(doc.resolve(json.anchor), doc.resolve(json.head));
  }
  getBookmark() {
    const { lo, hi } = this.span();
    return new BlockBookmark(this.anchor, this.head, captureSpan(outline(this.$from.doc), lo, hi));
  }
  span(doc = this.$from.doc) {
    return { lo: doc.resolve(this.from).index(0), hi: doc.resolve(this.to).index(0) - 1 };
  }
}
BlockSelection.prototype.visible = false;
Selection.jsonID("page-block", BlockSelection);

class BlockBookmark {
  constructor(anchor, head, span) { this.anchor = anchor; this.head = head; this.span = span; }
  map(mapping) {
    const fwd = this.anchor <= this.head;
    return new BlockBookmark(mapping.map(this.anchor, fwd ? 1 : -1), mapping.map(this.head, fwd ? -1 : 1), mapSpan(this.span, mapping));
  }
  resolve(doc) {
    const ents = outline(doc), span = resolveSpan(ents, this.span);
    if (!span) {
      const first = ents.find((e) => matchesRef(e, this.span.roots[0]));
      return Selection.near(doc.resolve(first?.at ?? boundary(doc, Math.min(this.anchor, this.head), -1)));
    }
    const from = ents[span.lo].at, to = ents[span.hi].end;
    return this.anchor <= this.head ? new BlockSelection(doc.resolve(from), doc.resolve(to)) : new BlockSelection(doc.resolve(to), doc.resolve(from));
  }
}

const prevSibling = (ents, i) => {
  for (let j = i - 1; j >= 0; j--) if (ents[j].up === ents[i].up) return j;
  return -1;
};

// Move blocks lo..hi so they start at `target` (a block boundary of the
// current doc, outside the span). Moved nodes get pos null: identityPlugin
// then gives exactly those blocks new keys between their new neighbours and
// leaves every other key alone. `attrs(ent)` returns attr changes per block.
export function moveIntent(ents, lo, hi, target, attrs = () => null) {
  const root = attrs(ents[lo]) || {};
  const parent = "parent" in root ? root.parent : parentOf(ents[lo].node);
  let afterId = null;
  for (let k = 0; k < ents.length && ents[k].end <= target; k++) {
    if (k >= lo && k <= hi) continue;
    if (parentOf(ents[k].node) === parent) afterId = ents[k].node.attrs.id;
  }
  const ids = [], changes = {};
  for (let k = lo; k <= hi; k++) {
    const n = ents[k].node, c = attrs(ents[k]);
    ids.push(n.attrs.id);
    if (c && "indent" in c && c.indent !== n.attrs.indent) changes[n.attrs.id] = { indent: c.indent };
  }
  return { ids, afterId, parent, attrs: changes };
}

export function moveSpanTr(st, ents, lo, hi, target, attrs = () => null, sel = st.selection) {
  const from = ents[lo].at, to = ents[hi].end, size = to - from;
  const nodes = [];
  for (let k = lo; k <= hi; k++) {
    const n = ents[k].node;
    nodes.push(n.type.create({ ...n.attrs, ...(attrs(ents[k]) || {}), pos: null }, n.content, n.marks));
  }
  const tr = st.tr.delete(from, to);
  const at = target > from ? target - size : target;
  tr.insert(at, nodes);
  const shift = at - from;
  if (sel instanceof BlockSelection) tr.setSelection(new BlockSelection(tr.doc.resolve(sel.anchor + shift), tr.doc.resolve(sel.head + shift)));
  else if (sel instanceof NodeSelection) tr.setSelection(NodeSelection.create(tr.doc, sel.from + shift));
  else tr.setSelection(TextSelection.create(tr.doc, sel.anchor + shift, sel.head + shift));
  return tr.setMeta(MOVE, moveIntent(ents, lo, hi, target, attrs));
}

// Attr changes that carry a span out of its outline parent P to P's level.
function leaveParent(ents, lo, up) {
  const p = ents[up].node;
  if (isToggle(p)) {
    const from = p.attrs.id, to = parentOf(p);
    return (e) => (parentOf(e.node) === from ? { parent: to } : null);
  }
  const delta = p.attrs.indent - ents[lo].node.attrs.indent;
  return (e) => (isList(e.node) ? { indent: e.node.attrs.indent + delta } : null);
}

// ---- move a block with its subtree ------------------------------------------
//
// dir -1 / +1. The unit is the selection lifted to whole sibling subtrees. It
// swaps with the previous / next sibling subtree; at the edge of its parent it
// steps out and lands just above / below the parent, at the parent's level.
export const moveBlock = (dir) => (st, dispatch) => {
  dispatch = asStep(dispatch);
  const ents = outline(st.doc);
  if (!ents.length) return false;
  const [a, b] = touched(st.doc, st.selection, ents);
  const { lo, hi, up } = siblingSpan(ents, a, b);
  let target, attrs = () => null;
  if (dir < 0) {
    const s = prevSibling(ents, lo);
    if (s >= 0) target = ents[s].at;
    else if (up >= 0) { target = ents[up].at; attrs = leaveParent(ents, lo, up); }
    else return true;
  } else {
    const next = hi + 1;
    if (next < ents.length && ents[next].up === up) target = ents[ents[next].subEnd].end;
    else if (up >= 0) { target = ents[ents[up].subEnd].end; attrs = leaveParent(ents, lo, up); }
    else return true;
  }
  if (dispatch) dispatch(moveSpanTr(st, ents, lo, hi, target, attrs).scrollIntoView());
  return true;
};

// ---- Tab / Shift-Tab --------------------------------------------------------

export const MAX_INDENT = 8;
const sameRun = (x, y) => isList(x.node) && isList(y.node) && parentOf(x.node) === parentOf(y.node);

export function indentBlocks(st, dispatch) {
  dispatch = asStep(dispatch);
  const ents = outline(st.doc);
  if (!ents.length) return false;
  const [a, b] = touched(st.doc, st.selection, ents);
  const first = ents[a];
  if (isList(first.node) && a > 0 && sameRun(ents[a - 1], first)) {
    if (first.node.attrs.indent > ents[a - 1].node.attrs.indent) return true;
    for (let k = a; k <= Math.max(b, first.subEnd); k++) if (ents[k].node.attrs.indent >= MAX_INDENT) return true;
    if (dispatch) {
      const tr = st.tr;
      let end = b;
      for (let k = a; k <= end; k++) end = Math.max(end, ents[k].subEnd);
      let deep = a - 1;
      for (let k = a; k <= end && sameRun(ents[k], first); k++) {
        tr.setNodeMarkup(ents[k].at, null, { ...ents[k].node.attrs, indent: ents[k].node.attrs.indent + 1 });
        deep = k;
      }
      tr.setMeta(MOVE, moveIntent(ents, a, deep, ents[a].at, (e) => (e.i >= a && e.i <= deep ? { indent: e.node.attrs.indent + 1 } : null)));
      dispatch(tr);
    }
    return true;
  }
  const s = prevSibling(ents, a);
  if (s < 0 || !isToggle(ents[s].node) || ents[s].subEnd !== a - 1) return true;
  if (dispatch) {
    const { hi } = siblingSpan(ents, a, b);
    const tr = st.tr, from = parentOf(first.node), to = ents[s].node.attrs.id;
    const adopted = [];
    for (let k = a; k <= hi; k++) {
      if (parentOf(ents[k].node) !== from) continue;
      tr.setNodeMarkup(ents[k].at, null, { ...ents[k].node.attrs, parent: to });
      adopted.push(ents[k].node.attrs.id);
    }
    if (!ents[s].node.attrs.open) tr.setNodeMarkup(ents[s].at, null, { ...ents[s].node.attrs, open: true });
    const intent = moveIntent(ents, a, hi, ents[a].at, (e) => (e.i >= a && e.i <= hi && parentOf(e.node) === from ? { parent: to } : null));
    tr.setMeta(MOVE, { ...intent, ids: adopted, attrs: ents[s].node.attrs.open ? intent.attrs : { ...intent.attrs, [to]: { open: true } } });
    dispatch(tr);
  }
  return true;
}

export function outdentBlocks(st, dispatch) {
  dispatch = asStep(dispatch);
  const ents = outline(st.doc);
  if (!ents.length) return false;
  const [a, b] = touched(st.doc, st.selection, ents);
  const first = ents[a];
  if (isList(first.node) && first.node.attrs.indent > 0) {
    if (dispatch) {
      const { lo, hi } = siblingSpan(ents, a, b);
      const tr = st.tr;
      const lowered = new Set();
      for (let k = a; k <= b;) {
        const e = ents[k];
        if (isList(e.node) && e.node.attrs.indent > 0) {
          for (let m = k; m <= e.subEnd; m++) {
            if (isList(ents[m].node)) {
              tr.setNodeMarkup(ents[m].at, null, { ...ents[m].node.attrs, indent: ents[m].node.attrs.indent - 1 });
              lowered.add(m);
            }
          }
        }
        k = e.subEnd + 1;
      }
      tr.setMeta(MOVE, moveIntent(ents, lo, hi, ents[lo].at, (e) => (lowered.has(e.i) ? { indent: e.node.attrs.indent - 1 } : null)));
      dispatch(tr);
    }
    return true;
  }
  const t = parentOf(first.node);
  if (t === null) return true;
  const { lo, hi } = siblingSpan(ents, a, b);
  let up = ents[lo].up;
  while (up >= 0 && !isToggle(ents[up].node)) up = ents[up].up;
  if (up < 0) return true;
  if (dispatch) {
    const attrs = leaveParent(ents, lo, up);
    const end = ents[up].subEnd;
    if (hi === end) {
      const tr = st.tr;
      for (let k = lo; k <= hi; k++) { const c = attrs(ents[k]); if (c) tr.setNodeMarkup(ents[k].at, null, { ...ents[k].node.attrs, ...c }); }
      tr.setMeta(MOVE, moveIntent(ents, lo, hi, ents[lo].at, attrs));
      dispatch(tr);
    } else dispatch(moveSpanTr(st, ents, lo, hi, ents[end].end, attrs).scrollIntoView());
  }
  return true;
}

// ---- Enter ------------------------------------------------------------------

function deleteFirst(st) {
  const tr = st.tr;
  if (!st.selection.empty) tr.deleteSelection();
  return tr;
}

export function enterListItem(st, dispatch) {
  const { $from, $to, empty } = st.selection;
  if ($from.depth !== 1 || !isList($from.parent) || !$from.sameParent($to)) return false;
  if (empty && $from.parent.content.size === 0) {
    const n = $from.parent;
    if (n.attrs.indent > 0) return outdentBlocks(st, dispatch);
    if (dispatch) dispatch(st.tr.setNodeMarkup($from.before(), N.paragraph, { id: n.attrs.id, pos: n.attrs.pos, parent: n.attrs.parent }));
    return true;
  }
  const tr = deleteFirst(st);
  const $pos = tr.selection.$from;
  const node = $pos.parent;
  const ents = outline(tr.doc);
  const i = $pos.index(0);
  const atStart = $pos.parentOffset === 0;
  const atEnd = $pos.parentOffset === node.content.size;
  const next = ents[i + 1];
  const deeper = atEnd && next && sameRun(next, ents[i]) && next.node.attrs.indent > node.attrs.indent;
  if (atStart) {
    tr.split($pos.pos, 1, [{ type: N.list_item, attrs: node.attrs }]);
    tr.setNodeMarkup(ents[i].at, null, { ...node.attrs, checked: false });
  } else {
    tr.split($pos.pos, 1, [{ type: N.list_item, attrs: { ...node.attrs, checked: false, indent: node.attrs.indent + (deeper ? 1 : 0) } }]);
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

export function enterToggle(st, dispatch) {
  const { $from, $to } = st.selection;
  if ($from.depth !== 1 || !isToggle($from.parent) || !$from.sameParent($to)) return false;
  const tr = deleteFirst(st);
  const $pos = tr.selection.$from;
  const node = $pos.parent;
  const ents = outline(tr.doc);
  const i = $pos.index(0), e = ents[i];
  const hasBody = e.subEnd > i;
  if (node.content.size === 0 && !hasBody) {
    tr.setNodeMarkup(e.at, N.paragraph, { id: node.attrs.id, pos: node.attrs.pos, parent: node.attrs.parent });
    if (dispatch) dispatch(tr);
    return true;
  }
  if ($pos.parentOffset === 0 && node.content.size > 0) {
    tr.insert(e.at, N.paragraph.create({ parent: parentOf(node) }));
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }
  const rest = node.content.cut($pos.parentOffset);
  if (node.attrs.open) {
    tr.split($pos.pos, 1, [{ type: N.paragraph, attrs: { parent: node.attrs.id } }]);
  } else {
    const end = ents[e.subEnd].end;
    const before = tr.steps.length;
    tr.delete($pos.pos, e.end - 1);
    const at = tr.mapping.slice(before).map(end);
    tr.insert(at, N.toggle.create({ parent: parentOf(node), open: false }, rest));
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

// Enter in an empty paragraph that ends a toggle's body steps out of the toggle.
export function exitToggleOnEmpty(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type !== N.paragraph || $from.parent.content.size) return false;
  const t = parentOf($from.parent);
  if (t === null) return false;
  const ents = outline(st.doc);
  const i = $from.index(0);
  const ti = ents.findIndex((x) => x.node.attrs.id === t);
  if (ti < 0 || ents[ti].subEnd !== i) return false;
  if (dispatch) {
    const id = ents[i].node.attrs.id, to = parentOf(ents[ti].node);
    const prev = i > 0 ? ents[i - 1].node : null;
    const tr = st.tr.setNodeMarkup(ents[i].at, null, { ...$from.parent.attrs, parent: to });
    tr.setMeta(MOVE, { ids: [id], afterId: prev ? prev.attrs.id : null, parent: parentOf(prev ?? ents[i].node), attrs: { [id]: { parent: to } } });
    dispatch(tr);
  }
  return true;
}

// Enter at the end of a paragraph or heading inside a toggle body: the new
// paragraph stays in the same body (the default split would make a root block).
export function enterBodyBlock(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const n = $from.parent;
  if (isList(n) || isToggle(n) || parentOf(n) === null || $from.parentOffset !== n.content.size) return false;
  if (dispatch) {
    const tr = st.tr.split($from.pos, 1, [{ type: N.paragraph, attrs: { parent: parentOf(n) } }]);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// ---- Backspace / Delete -----------------------------------------------------

export function backspaceListItem(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || !isList($from.parent) || $from.parentOffset !== 0) return false;
  if ($from.parent.attrs.indent > 0) return outdentBlocks(st, dispatch);
  const n = $from.parent;
  if (dispatch) dispatch(st.tr.setNodeMarkup($from.before(), N.paragraph, { id: n.attrs.id, pos: n.attrs.pos, parent: n.attrs.parent }));
  return true;
}

export function backspaceToggle(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || !isToggle($from.parent) || $from.parentOffset !== 0) return false;
  const n = $from.parent;
  if (dispatch) dispatch(st.tr.setNodeMarkup($from.before(), N.paragraph, { id: n.attrs.id, pos: n.attrs.pos, parent: n.attrs.parent }));
  return true;
}

// The collapsed toggle whose hidden body ends right before block i, if any.
function collapsedBefore(ents, i) {
  if (i <= 0 || !ents[i - 1].hidden) return -1;
  let j = i - 1;
  while (j >= 0 && ents[j].hidden) j--;
  return j >= 0 && isToggle(ents[j].node) && ents[j].subEnd >= i - 1 ? j : -1;
}

// Join a textblock's content onto the end of a summary line, leaving the body.
function joinIntoSummary(st, ents, ti, bi) {
  const tr = st.tr, b = ents[bi], sumEnd = ents[ti].end - 1;
  tr.delete(b.at, b.end);
  if (b.node.content.size) tr.insert(sumEnd, b.node.content);
  return tr.setSelection(TextSelection.create(tr.doc, sumEnd));
}

export function backspaceAfterCollapsed(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0 || !$from.parent.isTextblock) return false;
  const ents = outline(st.doc);
  const i = $from.index(0), ti = collapsedBefore(ents, i);
  if (ti < 0) return false;
  if (dispatch) dispatch(joinIntoSummary(st, ents, ti, i).scrollIntoView());
  return true;
}

export function deleteAtCollapsedEnd(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || !isToggle($from.parent) || $from.parent.attrs.open) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const ents = outline(st.doc);
  const ti = $from.index(0), ni = ents[ti].subEnd + 1;
  if (ni === ti + 1) return false;
  if (ni >= ents.length || !ents[ni].node.isTextblock) return true;
  if (dispatch) dispatch(joinIntoSummary(st, ents, ti, ni).scrollIntoView());
  return true;
}

// Delete at the end of a line just above a toggle. A plain paragraph's text
// moves onto the front of the summary, so the toggle keeps its body and open
// state; the default join would turn the toggle into a paragraph and release
// its body. Any other line (heading, list item, callout) would lose its format
// in that merge, so the caret steps into the summary instead.
export function deleteBeforeToggle(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1) return false;
  const n = $from.parent, i = $from.index(0);
  if (!n.isTextblock || n.type.spec.code || isToggle(n) || !n.content.size || $from.parentOffset !== n.content.size) return false;
  if (i + 1 >= st.doc.childCount || !isToggle(st.doc.child(i + 1))) return false;
  if (dispatch && n.type !== N.paragraph) dispatch(st.tr.setSelection(TextSelection.create(st.doc, $from.after() + 1)).scrollIntoView());
  else if (dispatch) {
    const at = $from.before();
    const tr = st.tr.insert($from.after() + 1, n.content).delete(at, $from.after());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1 + n.content.size)).scrollIntoView());
  }
  return true;
}

// Backspace and Delete at the edge of a code block never merge text into or
// out of it. An empty line on the other side is removed; otherwise the caret
// steps across to the neighbouring line.
const codeEdge = (dir) => (st, dispatch) => {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || !$from.parent.isTextblock) return false;
  const n = $from.parent, i = $from.index(0);
  if ($from.parentOffset !== (dir < 0 ? 0 : n.content.size)) return false;
  const ents = outline(st.doc);
  const ti = dir < 0 ? collapsedBefore(ents, i) : -1;
  const j = ti >= 0 ? ti : i + dir;
  if (j < 0 || j >= ents.length) return false;
  const o = ents[j].node;
  if (!o.isTextblock || (!n.type.spec.code && !o.type.spec.code)) return false;
  if (!dispatch) return true;
  const tr = st.tr, mine = ents[i], other = ents[j];
  const target = dir < 0 ? other.end - 1 : other.at + 1;
  if (!n.content.size && !n.type.spec.code) tr.delete(mine.at, mine.end).setSelection(TextSelection.create(tr.doc, tr.mapping.map(target)));
  else if (!o.content.size && !o.type.spec.code) tr.delete(other.at, other.end);
  else tr.setSelection(TextSelection.create(tr.doc, target));
  dispatch(tr.scrollIntoView());
  return true;
};
export const backspaceCodeEdge = codeEdge(-1);
export const deleteCodeEdge = codeEdge(1);

// Backspace at the start of the first paragraph, heading or code block of a
// toggle body joins it onto the summary line, which the default join cannot
// do. Later body blocks are left to the default join with the line above.
export function backspaceBodyBlock(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0 || !$from.parent.isTextblock) return false;
  const n = $from.parent;
  if (isList(n) || isToggle(n) || parentOf(n) === null) return false;
  const i = $from.index(0);
  if (st.doc.child(i - 1).attrs.id !== parentOf(n)) return false;
  if (dispatch) dispatch(joinIntoSummary(st, outline(st.doc), i - 1, i).scrollIntoView());
  return true;
}

// ---- open / closed ----------------------------------------------------------

export function setOpen(st, ti, open, ents = outline(st.doc)) {
  const e = ents[ti];
  return st.tr.setNodeMarkup(e.at, null, { ...e.node.attrs, open }).setMeta("addToHistory", false);
}

export function toggleOpenAtSelection(st, dispatch) {
  const { $from } = st.selection;
  if ($from.depth !== 1 || !isToggle($from.parent)) return false;
  if (dispatch) dispatch(setOpen(st, $from.index(0), !$from.parent.attrs.open));
  return true;
}

// ---- hidden ranges and the selection guard ----------------------------------

// [from, to] of every hidden body, outermost only: positions strictly inside
// one are inside hidden blocks. Each carries the toggle's entry.
export function hiddenRanges(ents) {
  const out = [];
  for (const e of ents) {
    if (!isToggle(e.node) || e.hidden || e.node.attrs.open || e.subEnd === e.i) continue;
    out.push({ line: e.at + 1, sumEnd: e.end - 1, from: e.end, to: ents[e.subEnd].end });
  }
  return out;
}

const inside = (r, p) => p > r.from && p < r.to;

// Where a selection endpoint inside a hidden range goes: forward to the first
// visible text after it, backward to the end of the summary line.
function snap(doc, ranges, r, dir) {
  if (dir > 0) {
    let p = r.to;
    for (;;) {
      const found = Selection.findFrom(doc.resolve(p), 1, true);
      if (!found) break;
      const again = ranges.find((x) => inside(x, found.head));
      if (!again) return found.head;
      p = again.to;
    }
  }
  return r.sumEnd;
}

// The selection with no endpoint inside a hidden body, and with a range that
// crosses a hidden body widened to start at that toggle's line, unless it
// starts exactly at the summary's end: then it starts after the body instead,
// so the toggle is not selected. Returns null when it is already fine.
// `dragging` defers the widening to mouseup.
export function guardSelection(doc, sel, ranges, dir = -1, dragging = false) {
  if (!ranges.length) return null;
  let { anchor, head } = sel;
  if (!(sel instanceof TextSelection)) {
    const r = ranges.find((x) => sel.from >= x.from && sel.from < x.to);
    return r ? TextSelection.create(doc, r.sumEnd) : null;
  }
  const hr = ranges.find((r) => inside(r, head));
  if (hr) head = snap(doc, ranges, hr, dir);
  const ar = ranges.find((r) => inside(r, anchor));
  if (ar) anchor = ar.sumEnd;
  if (!dragging && anchor !== head) {
    const from = Math.min(anchor, head), to = Math.max(anchor, head);
    const r = ranges.find((x) => (from > x.line || from === x.sumEnd) && from < x.from && to >= x.to);
    if (r) {
      const lo = from === r.sumEnd ? snap(doc, ranges, r, 1) : r.line;
      if (anchor < head) anchor = lo; else head = lo;
    }
  }
  if (anchor === sel.anchor && head === sel.head) return null;
  return TextSelection.create(doc, anchor, head);
}

// ---- ordered numbering ------------------------------------------------------

const ALPHA = (n) => { let s = ""; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const ROMAN = (n) => [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");

// Marker text for every ordered item, by entry index. A run restarts numbering;
// within a run each indent level counts its own ordered items, a deeper item
// never interrupts a shallower count, and any non-ordered item at a level
// restarts that level.
export function orderedMarkers(ents) {
  const out = new Map();
  let counts = [];
  ents.forEach((e, i) => {
    if (!isList(e.node)) { counts = []; return; }
    if (i > 0 && !sameRun(ents[i - 1], e)) counts = [];
    const d = e.node.attrs.indent;
    counts.length = d + 1;
    if (e.node.attrs.kind !== "ordered") { counts[d] = 0; return; }
    counts[d] = (counts[d] || 0) + 1;
    const n = counts[d];
    out.set(i, `${d % 3 === 0 ? n : d % 3 === 1 ? ALPHA(n) : ROMAN(n)}.`);
  });
  return out;
}

// ---- the collapse plugin ----------------------------------------------------

export const collapseKey = new PluginKey("page-collapse");

const STRUCTURAL = ["id", "parent", "indent", "kind", "open"];

// True when no block was added, removed or retyped and no attr the outline
// reads changed: typing, marks, checked, pos. Unchanged blocks are the same
// objects in both documents, so this is a pointer walk plus a few attr reads.
export function sameStructure(a, b) {
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    const x = a.child(i), y = b.child(i);
    if (x === y) continue;
    if (x.type !== y.type) return false;
    for (const k of STRUCTURAL) if (x.attrs[k] !== y.attrs[k]) return false;
  }
  return true;
}

function collapseState(doc) {
  const ents = outline(doc);
  return { decos: decorationsFor(doc, ents), ranges: hiddenRanges(ents) };
}

export function decorationsFor(doc, ents = outline(doc)) {
  const { Decoration, DecorationSet } = pmView;
  const markers = orderedMarkers(ents);
  const decos = [];
  for (const e of ents) {
    const attrs = {};
    if (e.hidden) { attrs.class = "page-hidden"; attrs["aria-hidden"] = "true"; }
    if (e.depth) attrs.style = `--page-depth:${e.depth}`;
    if (markers.has(e.i)) attrs["data-marker"] = markers.get(e.i);
    if (isToggle(e.node)) attrs["aria-expanded"] = e.node.attrs.open ? "true" : "false";
    if (Object.keys(attrs).length) decos.push(Decoration.node(e.at, e.end, attrs));
    if (isToggle(e.node) && !e.hidden) {
      decos.push(Decoration.widget(e.at + 1, () => disclosure(e.node), { side: -1, ignoreSelection: true, key: `t:${e.node.attrs.id}:${e.node.attrs.open}` }));
    }
  }
  return DecorationSet.create(doc, decos);
}

function disclosure(node) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "page-toggle-button";
  b.contentEditable = "false";
  b.setAttribute("aria-label", node.attrs.open ? "Collapse" : "Expand");
  b.setAttribute("data-toggle", node.attrs.id || "");
  return b;
}

export function collapsePlugin() {
  let dragging = false;
  return new Plugin({
    key: collapseKey,
    state: {
      init: (_, s) => collapseState(s.doc),
      apply(tr, value, old, s) {
        if (!tr.docChanged) return value;
        if (!sameStructure(old.doc, s.doc)) return collapseState(s.doc);
        const m = tr.mapping;
        return {
          decos: value.decos.map(m, s.doc),
          ranges: value.ranges.map((r) => ({ line: m.map(r.line, -1), sumEnd: m.map(r.sumEnd), from: m.map(r.from), to: m.map(r.to, -1) })),
        };
      },
    },
    appendTransaction(trs, old, next) {
      if (!trs.some((tr) => tr.docChanged || tr.selectionSet)) return null;
      // A caret hidden by a collapse goes back to the summary; one the user
      // moved into a hidden body keeps going the way it was moving.
      const moved = trs.some((tr) => tr.selectionSet);
      const dir = moved && next.selection.head >= old.selection.head ? 1 : -1;
      const sel = guardSelection(next.doc, next.selection, collapseKey.getState(next).ranges, dir, dragging);
      return sel ? next.tr.setSelection(sel) : null;
    },
    props: {
      decorations: (s) => collapseKey.getState(s).decos,
      handleDOMEvents: {
        mousedown: (view, event) => {
          const btn = event.target.closest?.(".page-toggle-button");
          if (btn) {
            event.preventDefault();
            const ents = outline(view.state.doc);
            const ti = ents.findIndex((e) => e.node.attrs.id === btn.dataset.toggle);
            if (ti >= 0) view.dispatch(setOpen(view.state, ti, !ents[ti].node.attrs.open, ents));
            return true;
          }
          dragging = true;
          const win = view.dom.ownerDocument.defaultView;
          const up = () => {
            dragging = false;
            win.removeEventListener("mouseup", up, true);
            const sel = guardSelection(view.state.doc, view.state.selection, collapseKey.getState(view.state).ranges, 1, false);
            if (sel) view.dispatch(view.state.tr.setSelection(sel));
          };
          win.addEventListener("mouseup", up, true);
          return false;
        },
      },
      handleKeyDown(view, event) {
        const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (!dir || event.altKey || event.metaKey || event.ctrlKey) return false;
        const { head } = view.state.selection;
        const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
        const edge = vertical ? (dir > 0 ? "down" : "up") : (dir > 0 ? "forward" : "backward");
        if (!view.endOfTextblock(edge)) return false;
        const ents = outline(view.state.doc);
        const { ranges } = collapseKey.getState(view.state);
        const $h = view.state.doc.resolve(head);
        const i = $h.index(0);
        let to = null;
        if (dir > 0) {
          const r = ranges.find((x) => x.from === ents[i].end);
          if (r) to = snap(view.state.doc, ranges, r, 1);
        } else {
          const ti = collapsedBefore(ents, i);
          // Extending backward takes the closed toggle whole: a head at the
          // summary end would be read as A1 (skip the toggle) and never move.
          if (ti >= 0) to = event.shiftKey ? ents[ti].at + 1 : ents[ti].end - 1;
        }
        if (to === null || to === head) return false;
        const anchor = event.shiftKey ? view.state.selection.anchor : to;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, to)).scrollIntoView());
        return true;
      },
    },
  });
}

// ---- paste ------------------------------------------------------------------

const LIST_LINE = /^([ \t]*)(?:([-*+•])|(\d+)[.)])[ \t]+(?:\[([ xX])\][ \t]+)?(.*)$/;

// Plain text whose lines are list lines becomes flat list items. Indent levels
// come from a stack of leading widths (a tab counts 4), so 2-space, 4-space and
// tab markdown all work. Text with no list line returns null: ProseMirror's
// default plain-text handling then applies.
export function parseListText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((l) => LIST_LINE.test(l))) return null;
  const widths = [];
  const nodes = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = LIST_LINE.exec(line);
    if (!m) { widths.length = 0; nodes.push(N.paragraph.create(null, line.trim() ? schema.text(line.trim()) : null)); continue; }
    const w = m[1].replace(/\t/g, "    ").length;
    while (widths.length && widths[widths.length - 1] > w) widths.pop();
    if (!widths.length || widths[widths.length - 1] < w) widths.push(w);
    const indent = Math.min(widths.length - 1, nodes.length && isList(nodes[nodes.length - 1]) ? nodes[nodes.length - 1].attrs.indent + 1 : 0);
    const kind = m[4] !== undefined ? "check" : m[3] !== undefined ? "ordered" : "bullet";
    nodes.push(N.list_item.create({ kind, indent, checked: m[4] === "x" || m[4] === "X" }, m[5] ? schema.text(m[5]) : null));
  }
  return new model.Slice(model.Fragment.from(nodes), 0, 0);
}

const LIST_TAGS = new Set(["UL", "OL"]);
const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "DETAILS", "SUMMARY", "TABLE", "HR", "FIGURE"]);

function checkState(li) {
  const box = li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox]");
  if (box) return { check: true, checked: box.checked || box.hasAttribute("checked") };
  const role = li.getAttribute("role") === "checkbox" || li.hasAttribute("aria-checked");
  if (role) return { check: true, checked: li.getAttribute("aria-checked") === "true" };
  if (li.hasAttribute("data-checked")) return { check: true, checked: li.getAttribute("data-checked") === "true" };
  const cls = li.className || "";
  if (/\b(checked|task-list-item|to-do)\b/.test(cls) || li.closest?.("ul.to-do-list, ul.contains-task-list")) {
    return { check: true, checked: /\bchecked\b/.test(cls) || !!li.querySelector(".checkbox-on") };
  }
  return { check: false, checked: false };
}

function listKind(li) {
  const style = (li.getAttribute("style") || "") + ";" + (li.parentElement?.getAttribute("style") || "");
  const t = /list-style-type\s*:\s*([a-z-]+)/i.exec(li.getAttribute("style") || "")?.[1];
  if (t) return /decimal|alpha|roman|latin|greek/.test(t) ? "ordered" : "bullet";
  void style;
  return li.parentElement?.tagName === "OL" ? "ordered" : "bullet";
}

// Rewrites pasted HTML so every list item, at any nesting, is one flat
// <div data-page-li> carrying kind, indent and checked, and every <details> is
// a <div data-page-toggle> followed by its body, each top-level body block
// marked with data-page-parent naming a temporary toggle key. Indent comes from
// aria-level when present (Google Docs), otherwise from the number of list
// ancestors (Notion, markdown renderers, GitHub), and is made relative to the
// shallowest item pasted.
export function flattenPastedHTML(html, doc = globalThis.document) {
  const root = doc.createElement("div");
  root.innerHTML = html;
  for (const b of root.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]')) b.replaceWith(...b.childNodes);
  let key = 0;
  const out = doc.createElement("div");

  const listDepth = (li) => {
    const aria = parseInt(li.getAttribute("aria-level"), 10);
    if (aria > 0) return aria - 1;
    let d = -1;
    for (let el = li.parentElement; el && el !== root; el = el.parentElement) if (LIST_TAGS.has(el.tagName)) d++;
    return Math.max(0, d);
  };

  const items = [];
  function emitLi(li, parentKey, target) {
    const div = doc.createElement("div");
    const { check, checked } = checkState(li);
    div.setAttribute("data-page-li", "");
    div.setAttribute("data-kind", check ? "check" : listKind(li));
    div.setAttribute("data-checked", checked ? "true" : "false");
    div.dataset.depth = String(listDepth(li));
    if (parentKey) div.setAttribute("data-page-parent", parentKey);
    let first = true;
    const rest = [];
    for (const child of [...li.childNodes]) {
      if (child.nodeType === 1 && LIST_TAGS.has(child.tagName)) { rest.push(child); continue; }
      if (child.nodeType === 1 && child.tagName === "INPUT") continue;
      if (child.nodeType === 1 && BLOCK_TAGS.has(child.tagName)) {
        if (!first) div.appendChild(doc.createElement("br"));
        for (const n of [...child.childNodes]) { if (!(n.nodeType === 1 && n.tagName === "INPUT")) div.appendChild(n); }
        first = false;
        continue;
      }
      div.appendChild(child);
      if (child.nodeType !== 3 || child.textContent.trim()) first = false;
    }
    target.appendChild(div);
    items.push(div);
    for (const list of rest) walk(list, parentKey, target);
  }

  // Text and inline elements between blocks gather into one paragraph per
  // line; a <br> between them starts the next line.
  function walk(node, parentKey, target) {
    let line = null;
    const inline = (n) => {
      if (!line) {
        line = doc.createElement("p");
        if (parentKey) line.setAttribute("data-page-parent", parentKey);
        target.appendChild(line);
      }
      line.appendChild(n);
    };
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1 && (child.tagName === "META" || child.tagName === "STYLE")) continue;
      if (child.nodeType === 1 && child.tagName === "BR") { line = null; continue; }
      if (child.nodeType !== 1) {
        if (child.nodeType === 3 && (line || child.textContent.trim())) inline(child);
        continue;
      }
      if (!BLOCK_TAGS.has(child.tagName) && child.tagName !== "ASIDE") { inline(child); continue; }
      line = null;
      if (LIST_TAGS.has(child.tagName)) { walk(child, parentKey, target); continue; }
      if (child.tagName === "LI") { emitLi(child, parentKey, target); continue; }
      if (child.tagName === "DETAILS") {
        const k = `paste-${++key}`;
        const summary = child.querySelector(":scope > summary");
        const t = doc.createElement("div");
        t.setAttribute("data-page-toggle", k);
        if (child.hasAttribute("open")) t.setAttribute("data-open", "true");
        if (parentKey) t.setAttribute("data-page-parent", parentKey);
        if (summary) t.append(...summary.childNodes);
        target.appendChild(t);
        for (const c of [...child.childNodes]) if (c !== summary) { const box = doc.createElement("div"); box.appendChild(c); walk(box, k, target); }
        continue;
      }
      if (child.tagName === "DIV" && !child.hasAttribute("data-page-li") && [...child.children].some((c) => BLOCK_TAGS.has(c.tagName))) { walk(child, parentKey, target); continue; }
      if (parentKey) child.setAttribute("data-page-parent", parentKey);
      target.appendChild(child);
    }
  }
  walk(root, null, out);
  const min = items.length ? Math.min(...items.map((d) => +d.dataset.depth)) : 0;
  let prev = null;
  for (const d of items) {
    const want = +d.dataset.depth - min;
    const adj = prev && d.previousElementSibling === prev ? +prev.getAttribute("data-indent") + 1 : 0;
    d.setAttribute("data-indent", String(Math.min(want, adj)));
    d.removeAttribute("data-depth");
    prev = d;
  }
  const splitImages = (node) => {
    if (node.nodeType !== 1 || node.tagName === "IMG") return [node.cloneNode(true)];
    const parts = [];
    let part = node.cloneNode(false);
    for (const child of node.childNodes) for (const piece of splitImages(child)) {
      if (piece.nodeType === 1 && piece.tagName === "IMG") {
        if (part.hasChildNodes()) parts.push(part);
        parts.push(piece);
        part = node.cloneNode(false);
      } else part.appendChild(piece);
    }
    if (part.hasChildNodes() || !parts.length) parts.push(part);
    return parts;
  };
  for (const child of [...out.children]) {
    if (!child.matches("p, h1, h2, h3, h4, h5, h6, aside, div[data-page-li], div.page-li") || !child.querySelector("img")) continue;
    const pieces = splitImages(child);
    const parent = child.getAttribute("data-page-parent");
    if (parent) for (const piece of pieces) piece.setAttribute("data-page-parent", parent);
    child.replaceWith(...pieces);
  }
  return out.innerHTML;
}

const numberAttr = (value, min = 0) => value !== null && value !== "" && Number.isInteger(+value) && +value >= min ? +value : null;
const parentAttr = (dom) => dom.getAttribute("data-page-parent") || null;

// A copied opaque mark is not one of the schema's marks, so the rules of the
// clipboard parser resolve mark names through a view of the schema that holds
// the internal one; every node a parse builds is the schema's own.
const opaqueType = opaqueMark([]).type;
const parseSchema = Object.create(schema, { marks: { value: { ...schema.marks, [OPAQUE_MARK]: opaqueType } } });

// The record of a pasted block envelope, or null when it is not one this
// runtime may keep: a malformed, oversized or hostile envelope, one naming a
// known block type, or one with no type of its own. A pasted element with no
// usable record is plain text, never a record this runtime made up.
const pastedRecord = (dom) => {
  let record;
  try { record = envelopeRecord(dom); } catch { return null; }
  if (!record || typeof record.t !== "string" || record.t === "opaque_block" || Object.hasOwn(DEFAULTS, record.t)) return null;
  return record;
};
const pastedOpaque = (dom) => {
  const record = pastedRecord(dom);
  if (!record) return false;
  return { raw: record, parent: parentAttr(dom) };
};
const pastedOpaqueContent = (dom) => {
  const record = pastedRecord(dom);
  if (!record || typeof record.c !== "string" || !record.c) return model.Fragment.empty;
  const units = unitsOf(record.m, record.c.length);
  return model.Fragment.from(unflatten(schema, record.c, units, schema.nodes.opaque_block));
};
const pastedOpaqueMarks = (dom) => {
  try { return { entries: marksEntries(dom.getAttribute(MARKS)) }; } catch { return false; }
};

// The clipboard parser: the schema has toDOM only, so paste gets its own rules.
export const clipboardParser = new model.DOMParser(parseSchema, [
  { tag: `div[${OPAQUE}]`, node: "opaque_block", getAttrs: pastedOpaque, getContent: pastedOpaqueContent },
  { tag: `span[${MARKS}]`, mark: OPAQUE_MARK, getAttrs: pastedOpaqueMarks },
  { tag: "div[data-page-li]", node: "list_item", getAttrs: (d) => ({ kind: d.getAttribute("data-kind") || "bullet", indent: +d.getAttribute("data-indent") || 0, checked: d.getAttribute("data-checked") === "true", parent: parentAttr(d) }) },
  { tag: "div.page-li", node: "list_item", getAttrs: (d) => ({ kind: d.getAttribute("data-kind") || "bullet", indent: +d.getAttribute("data-indent") || 0, checked: d.getAttribute("data-checked") === "true", parent: parentAttr(d) }) },
  { tag: "div[data-page-toggle]", node: "toggle", getAttrs: (d) => ({ id: d.getAttribute("data-page-toggle"), open: d.getAttribute("data-open") === "true", parent: parentAttr(d) }) },
  { tag: "div.page-toggle", node: "toggle", getAttrs: (d) => ({ id: d.getAttribute("data-id"), open: d.getAttribute("data-open") === "true", parent: null }) },
  { tag: "h1", node: "heading", getAttrs: (d) => ({ level: 1, parent: parentAttr(d) }) },
  { tag: "h2", node: "heading", getAttrs: (d) => ({ level: 2, parent: parentAttr(d) }) },
  { tag: "h3", node: "heading", getAttrs: (d) => ({ level: 3, parent: parentAttr(d) }) },
  { tag: "h4", node: "heading", getAttrs: (d) => ({ level: 3, parent: parentAttr(d) }) },
  { tag: "pre", node: "code_block", preserveWhitespace: "full", getAttrs: (d) => ({ lang: d.getAttribute("data-lang") || "", parent: parentAttr(d) }) },
  { tag: "hr", node: "divider", getAttrs: (d) => ({ parent: parentAttr(d) }) },
  { tag: "aside.page-callout", node: "callout", getAttrs: (d) => ({ parent: parentAttr(d) }) },
  { tag: 'figure:not([data-type]), figure[data-type="image"]', node: "image", getAttrs: (d) => {
    const img = d.querySelector("img"), src = safeSrc(img?.getAttribute("src"));
    return src ? { src, alt: img.getAttribute("alt") || "", caption: d.querySelector("figcaption")?.textContent || "", width: numberAttr(d.getAttribute("data-width") ?? img.getAttribute("width"), 1), align: alignOf(d.getAttribute("data-align")), parent: parentAttr(d) } : false;
  } },
  { tag: "img[src]", node: "image", getAttrs: (d) => {
    const src = safeSrc(d.getAttribute("src"));
    return src ? { src, alt: d.getAttribute("alt") || "", width: numberAttr(d.getAttribute("width"), 1), parent: parentAttr(d) } : false;
  } },
  { tag: 'div.page-file, div[data-type="file"]', node: "file", getAttrs: (d) => {
    const src = safeHref(d.getAttribute("data-src"));
    return src ? { src, name: d.getAttribute("data-name") || "file", size: numberAttr(d.getAttribute("data-size")), mime: d.getAttribute("data-mime") || null, parent: parentAttr(d) } : false;
  } },
  { tag: "p", node: "paragraph", getAttrs: (d) => ({ parent: parentAttr(d) }) },
  { tag: "br", node: "hard_break" },
  { tag: "strong", mark: "strong" },
  { tag: "b", mark: "strong", getAttrs: (d) => (/font-weight\s*:\s*(normal|[1-5]00)\b/.test(d.getAttribute("style") || "") ? false : null) },
  { tag: "span", mark: "strong", getAttrs: (d) => (/font-weight\s*:\s*(bold|[6-9]00)\b/.test(d.getAttribute("style") || "") ? null : false) },
  { tag: "em", mark: "em" },
  { tag: "i", mark: "em" },
  { tag: "span", mark: "em", getAttrs: (d) => (/font-style\s*:\s*italic/.test(d.getAttribute("style") || "") ? null : false) },
  { tag: "s", mark: "strike" },
  { tag: "del", mark: "strike" },
  { tag: "code", mark: "code" },
  { tag: "a[href]", mark: "link", getAttrs: (d) => { const href = safeHref(d.getAttribute("href")); return href ? { href } : false; } },
  { tag: "blockquote", node: "quote", getAttrs: (d) => ({ parent: parentAttr(d) }) },
  { tag: "u", mark: "underline" },
  { tag: "mark", mark: "highlight", getAttrs: (d) => nativeAttrs("highlight", { color: d.getAttribute("data-color") }) ?? false },
  { tag: "span[data-color]", mark: "text_color", getAttrs: (d) => nativeAttrs("text_color", { color: d.getAttribute("data-color") }) ?? false },
]);

// Every pasted block arrives with no id and no pos (identityPlugin mints and
// places them). Toggles alone get a fresh id here, because their bodies must
// name it; each pasted body is rewired to its toggle's new id. A block whose
// parent is not in the slice takes the parent of the block being pasted into,
// and pasted list items shift by that item's indent.
// Pasted into a paragraph or heading, a slice that starts or ends with a list
// item or toggle is closed on that side, so the items arrive whole instead of
// their first line merging into the paragraph.
export function remapPasted(slice, st) {
  const $from = st.selection.$from;
  const selected = st.selection instanceof BlockSelection;
  const host = selected ? st.doc.child(st.selection.span().lo) : $from.depth >= 1 ? $from.node(1) : null;
  const destParent = host ? parentOf(host) : null;
  const base = host && isList(host) ? host.attrs.indent : 0;
  const ids = new Map();
  slice.content.forEach((n) => { if (isToggle(n) && n.attrs.id) ids.set(n.attrs.id, newId()); });
  const nodes = [];
  slice.content.forEach((n) => {
    if (!n.type.spec.group?.includes("block")) { nodes.push(n); return; }
    const p = parentOf(n);
    const attrs = { ...n.attrs, pos: null, id: isToggle(n) ? (ids.get(n.attrs.id) ?? null) : null, parent: p !== null && ids.has(p) ? ids.get(p) : destParent };
    if (isList(n)) attrs.indent = n.attrs.indent + base;
    nodes.push(n.type.create(attrs, n.content, n.marks));
  });
  const intoText = !host || !(isList(host) || isToggle(host));
  const structural = (n) => n && (isList(n) || isToggle(n));
  const openStart = intoText && structural(nodes[0]) ? 0 : slice.openStart;
  const last = nodes[nodes.length - 1];
  const fresh = new Set(ids.values());
  const openEnd = intoText && (structural(last) || (last && fresh.has(parentOf(last)))) ? 0 : slice.openEnd;
  return new model.Slice(model.Fragment.from(nodes), selected ? 0 : openStart, selected ? 0 : openEnd);
}

// The clipboard serializer: the schema's toDOM, plus each copied block's
// owner (data-page-parent) and each toggle's id (data-page-toggle), so a copied
// toggle pastes with its body still inside it.
class ClipboardSerializer extends model.DOMSerializer {
  serializeFragment(fragment, options, target) {
    const out = super.serializeFragment(fragment, options, target);
    if (!fragment.firstChild?.isBlock) return out;
    const doms = [...out.childNodes];
    fragment.forEach((n, _, i) => {
      const dom = doms[i];
      if (!dom || dom.nodeType !== 1) return;
      if (parentOf(n) !== null) dom.setAttribute("data-page-parent", parentOf(n));
      if (isToggle(n) && n.attrs.id) dom.setAttribute("data-page-toggle", n.attrs.id);
      if (n.type === N.image && n.attrs.width) dom.setAttribute("data-width", String(n.attrs.width));
    });
    return out;
  }
}
const base = model.DOMSerializer.fromSchema(schema);

// A copied block this runtime has no schema for keeps its record in the
// projection's block envelope, with its own text as the readable fallback, and
// a copied opaque mark keeps its descriptors in the marks envelope. The record
// is the one the saved article keeps: its own type, every field it carried, and
// its text with its marks.
const opaqueRecord = (node) => {
  const { t, ...rest } = node.attrs.raw ?? {};
  const { c, m } = flatten(node.content);
  if (!c) return { t, ...rest };
  return { t, ...rest, c, ...(m.some(Boolean) ? { m: runsOf(m) } : {}) };
};
const opaqueNode = (node) => ["div", { "data-type": "newer-format", ...envelopeAttrs(opaqueRecord(node)) }, 0];
const opaqueMarks = (mark) => ["span", marksAttrs(mark.attrs.entries), 0];
const clipboardNodes = { ...base.nodes, opaque_block: opaqueNode };
const clipboardMarks = { ...base.marks, [OPAQUE_MARK]: opaqueMarks };

export const clipboardSerializer = new ClipboardSerializer(clipboardNodes, clipboardMarks);

// Several blocks pasted into a closed toggle's summary join its body, so the
// toggle opens first instead of hiding what was just pasted.
function pasteIntoClosedSummary(view, _event, slice) {
  const { $from } = view.state.selection;
  const host = $from.depth >= 1 ? $from.node(1) : null;
  if (!host || !isToggle(host) || host.attrs.open || slice.content.childCount < 2) return false;
  const tr = view.state.tr.setNodeMarkup($from.before(1), null, { ...host.attrs, open: true }).replaceSelection(slice);
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  return true;
}

// The four formats pasted in from elsewhere are floor-1 content too: a slice
// that holds one asks the gate before it is inserted, and text waits in the
// clipboard rather than being dropped when the answer is a refusal.
function writesFormat(slice) {
  let found = false;
  slice?.content?.descendants((node) => {
    if (found) return false;
    if (node.type === N.quote) found = true;
    else if (node.isText && node.marks.some((mark) => NATIVE_NAMES.has(mark.type.name))) found = true;
    return !found;
  });
  return found;
}

function pasteFormat(view, event, slice) {
  const from = view.state.selection.from, to = view.state.selection.to;
  const plain = () => {
    const text = slice.content.textBetween(0, slice.content.size, "\n", " ");
    if (!view.isDestroyed && text) view.dispatch(view.state.tr.insertText(text, from, to));
    return false;
  };
  import("./format-native-commands.js").then(({ pasteFormats }) => pasteFormats(view, slice, from, to), plain);
  return true;
}

export function pastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event, slice) {
        if (writesFormat(slice)) return pasteFormat(view, event, slice);
        return pasteIntoClosedSummary(view, event, slice);
      },
      clipboardSerializer,
      transformPastedHTML: (html) => flattenPastedHTML(html),
      clipboardParser,
      clipboardTextParser: (text, _$ctx, plain) => (plain ? null : parseListText(text)),
      transformPasted: (slice, view) => remapPasted(slice, view.state),
    },
  });
}

// ---- keymap -----------------------------------------------------------------

const backspace = commands.chainCommands(backspaceListItem, backspaceToggle, backspaceCodeEdge, backspaceBodyBlock, backspaceAfterCollapsed);
const del = commands.chainCommands(deleteAtCollapsedEnd, deleteBeforeToggle, deleteCodeEdge);

// Modified Backspace and Delete get the same guards as the plain keys, so none
// of them can reach baseKeymap's joins into a hidden body. Where no guard
// applies they fall through to the base keymap or the browser as before.
export const blockKeys = {
  Enter: commands.chainCommands(enterListItem, enterToggle, exitToggleOnEmpty, enterBodyBlock),
  Backspace: backspace,
  "Shift-Backspace": backspace,
  "Mod-Backspace": backspace,
  "Alt-Backspace": backspace,
  "Ctrl-h": backspace,
  Delete: del,
  "Shift-Delete": del,
  "Mod-Delete": del,
  "Alt-Delete": del,
  "Ctrl-d": del,
  "Ctrl-Alt-Backspace": del,
  Tab: indentBlocks,
  "Shift-Tab": outdentBlocks,
  "Mod-Shift-ArrowUp": moveBlock(-1),
  "Mod-Shift-ArrowDown": moveBlock(1),
  "Mod-Enter": toggleOpenAtSelection,
};
