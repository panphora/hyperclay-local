// Block selection: Esc, the grip and Shift+click select whole blocks, and every
// block command (delete, duplicate, move, indent, copy) acts on "the current
// span", the block selection or the blocks a text selection touches, lifted to
// whole sibling subtrees. BlockSelection itself lives in blocks.js because
// moveSpanTr needs it.
import { state, history, view as pmView, keymap } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { outline, siblingSpan, touchedBlocks, BlockSelection, STEP } from "./blocks.js";
import { keysBetween, newId, orderedIds, REMOTE } from "./model.js";
import { announce } from "./announce.js";
import { rectKey } from "./table-rect-key.js";

const { Selection, TextSelection, NodeSelection, Plugin, PluginKey } = state;
const N = schema.nodes;

export const asStep = (tr) => history.closeHistory(tr).setMeta(STEP, true);

export function selectBlocks(doc, a, b = a, ents = outline(doc)) {
  const { lo, hi } = siblingSpan(ents, Math.min(a, b), Math.max(a, b));
  const from = ents[lo].at, to = ents[hi].end;
  return a <= b ? new BlockSelection(doc.resolve(from), doc.resolve(to)) : new BlockSelection(doc.resolve(to), doc.resolve(from));
}

export function currentSpan(st, ents = outline(st.doc)) {
  const [a, b] = touchedBlocks(st.doc, st.selection, ents);
  return siblingSpan(ents, a, b);
}

const visibleIdx = (ents, i, dir) => {
  for (let j = i; j >= 0 && j < ents.length; j += dir) if (!ents[j].hidden) return j;
  return -1;
};

export function selectCurrentBlock(st, dispatch) {
  if (st.selection instanceof BlockSelection) return false;
  const i = Math.min(st.selection.$head.index(0), st.doc.childCount - 1);
  if (dispatch) dispatch(st.tr.setSelection(selectBlocks(st.doc, i)));
  return true;
}

export const stepBlock = (dir) => (st, dispatch) => {
  const sel = st.selection;
  if (!(sel instanceof BlockSelection)) return false;
  const ents = outline(st.doc);
  const { lo, hi } = sel.span(st.doc);
  const i = dir < 0 ? visibleIdx(ents, lo - 1, -1) : visibleIdx(ents, hi + 1, 1);
  if (i < 0) return true;
  if (dispatch) dispatch(st.tr.setSelection(selectBlocks(st.doc, i)).scrollIntoView());
  return true;
};

function rootAt(ents, lo, hi, side) {
  if (side < 0) return lo;
  let r = lo;
  while (ents[r].subEnd < hi) r = ents[r].subEnd + 1;
  return r;
}

function prevRoot(ents, i) {
  for (let j = i - 1; j >= 0; j--) if (ents[j].up === ents[i].up) return j;
  return i;
}

export const extendBlock = (dir) => (st, dispatch) => {
  const sel = st.selection;
  if (!(sel instanceof BlockSelection)) return false;
  const ents = outline(st.doc);
  const { lo, hi } = sel.span(st.doc);
  const fwd = sel.anchor <= sel.head;
  const anchorIdx = fwd ? lo : rootAt(ents, lo, hi, 1);
  let headIdx = fwd ? rootAt(ents, lo, hi, 1) : lo;
  if (dir > 0) {
    if (fwd || lo === hi || headIdx === anchorIdx) headIdx = visibleIdx(ents, (fwd ? hi : headIdx) + 1, 1);
    else headIdx = visibleIdx(ents, ents[headIdx].subEnd + 1, 1);
  } else {
    if (!fwd || headIdx === anchorIdx) headIdx = visibleIdx(ents, (fwd ? headIdx : lo) - 1, -1);
    else headIdx = prevRoot(ents, headIdx);
  }
  if (headIdx < 0) return true;
  if (dispatch) dispatch(st.tr.setSelection(selectBlocks(st.doc, anchorIdx, headIdx, ents)).scrollIntoView());
  return true;
};

export function deleteBlocks(st, dispatch) {
  const sel = st.selection;
  if (!(sel instanceof BlockSelection)) return false;
  if (dispatch) {
    const tr = st.tr.delete(sel.from, sel.to);
    if (tr.doc.content.size === 0) tr.insert(0, N.paragraph.create());
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(sel.from, tr.doc.content.size)), -1));
    dispatch(asStep(tr).scrollIntoView());
  }
  return true;
}

function freshBoard({ columns = {}, cards = {} }) {
  const order = orderedIds(columns);
  const ids = new Map(order.map((id) => [id, newId("c")]));
  const columnKeys = keysBetween(null, null, order.length);
  const nextCards = {};
  for (const col of new Set([...order, ...Object.values(cards).map((card) => card.col)])) {
    const inColumn = orderedIds(Object.fromEntries(Object.entries(cards).filter(([, card]) => card.col === col)));
    const keys = keysBetween(null, null, inColumn.length);
    inColumn.forEach((id, i) => { nextCards[newId("k")] = { ...cards[id], col: ids.get(col) ?? col, pos: keys[i] }; });
  }
  return { columns: Object.fromEntries(order.map((id, i) => [ids.get(id), { ...columns[id], pos: columnKeys[i] }])), cards: nextCards };
}

export function duplicateBlocks(st, dispatch) {
  const ents = outline(st.doc);
  if (!ents.length) return false;
  const { lo, hi } = currentSpan(st, ents);
  if (dispatch) {
    const ids = new Map();
    for (let k = lo; k <= hi; k++) if (ents[k].node.type === N.toggle && ents[k].node.attrs.id) ids.set(ents[k].node.attrs.id, newId());
    const nodes = [];
    for (let k = lo; k <= hi; k++) {
      const n = ents[k].node, p = n.attrs.parent ?? null;
      nodes.push(n.type.create({ ...n.attrs, ...(n.type === N.board ? freshBoard(n.attrs) : {}), id: ids.get(n.attrs.id) ?? null, pos: null, parent: ids.get(p) ?? p }, n.content, n.marks));
    }
    const at = ents[hi].end, size = at - ents[lo].at;
    const tr = st.tr.insert(at, nodes);
    const s = st.selection;
    tr.setSelection(s instanceof BlockSelection
      ? new BlockSelection(tr.doc.resolve(at), tr.doc.resolve(at + size))
      : TextSelection.create(tr.doc, s.anchor + size, s.head + size));
    dispatch(asStep(tr).scrollIntoView());
  }
  return true;
}

const endOfFirstText = (doc, ents, lo, hi) => {
  for (let k = lo; k <= hi; k++) if (ents[k].node.isTextblock) return ents[k].end - 1;
  return -1;
};

export function exitToText(st, dispatch) {
  const sel = st.selection;
  if (!(sel instanceof BlockSelection)) return false;
  const ents = outline(st.doc);
  const { lo, hi } = sel.span(st.doc);
  if (dispatch) {
    const at = endOfFirstText(st.doc, ents, lo, hi);
    dispatch(st.tr.setSelection(at >= 0 ? TextSelection.create(st.doc, at) : NodeSelection.create(st.doc, ents[lo].at)));
  }
  return true;
}

// The top-level table holding both ends of the selection, as block boundaries.
const tableAround = ({ $from, $to }) => {
  if ($from.depth < 2 || $to.depth < 2) return null;
  const node = $from.node(1);
  return node.type.name === "table" && $to.node(1) === node ? { from: $from.before(1), to: $from.after(1) } : null;
};

// Mod-a widens one step at a time: the text of the block or table cell, then the table
// around a cell, then every block.
export function selectAllBlocks(st, dispatch) {
  const sel = st.selection;
  const { $from, $to } = sel;
  const inText = $from.parent.isTextblock && $from.sameParent($to) && !rectKey.getState(st);
  const whole = inText && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  if (inText && !whole && $from.parent.content.size) {
    if (dispatch) dispatch(st.tr.setSelection(TextSelection.create(st.doc, $from.start(), $from.end())));
    return true;
  }
  const table = tableAround(sel);
  if (table && !(sel instanceof BlockSelection && sel.from === table.from && sel.to === table.to)) {
    if (dispatch) dispatch(st.tr.setSelection(new BlockSelection(st.doc.resolve(table.from), st.doc.resolve(table.to))));
    return true;
  }
  if (dispatch) dispatch(st.tr.setSelection(new BlockSelection(st.doc.resolve(0), st.doc.resolve(st.doc.content.size))));
  return true;
}

export const typeIntoBlocks = (view, text) => {
  const st = view.state, sel = st.selection;
  if (!(sel instanceof BlockSelection)) return false;
  const ents = outline(st.doc);
  const { lo, hi } = sel.span(st.doc);
  const at = endOfFirstText(st.doc, ents, lo, hi);
  const tr = st.tr;
  if (at < 0) {
    const to = ents[hi].end;
    tr.insert(to, N.paragraph.create({ parent: ents[lo].node.attrs.parent ?? null }));
    tr.setSelection(TextSelection.create(tr.doc, to + 1));
    asStep(tr);
  } else tr.setSelection(TextSelection.create(tr.doc, at));
  tr.insertText(text);
  view.dispatch(tr.scrollIntoView());
  return true;
};

const leaveSummaryDown = (st, dispatch, view) => {
  const sel = st.selection;
  if (!(sel instanceof TextSelection) || !view?.endOfTextblock("down")) return false;
  const { $anchor: $a, $head: $h } = sel;
  if ($a.depth !== 1 || $a.parent.type !== N.toggle || $a.parent.attrs.open || $a.index(0) !== $h.index(0)) return false;
  const ents = outline(st.doc);
  const i = $a.index(0);
  const j = visibleIdx(ents, ents[i].subEnd + 1, 1);
  if (j < 0) return false;
  if (dispatch) dispatch(st.tr.setSelection(selectBlocks(st.doc, i, j, ents)).scrollIntoView());
  return true;
};

const only = (cmd) => (st, d, v) => st.selection instanceof BlockSelection && cmd(st, d, v);

export const blockSelKeys = {
  Escape: (st, d) => exitToText(st, d) || selectCurrentBlock(st, d),
  Enter: only(exitToText),
  ArrowUp: stepBlock(-1),
  ArrowDown: stepBlock(1),
  "Shift-ArrowUp": extendBlock(-1),
  "Shift-ArrowDown": (st, d, v) => extendBlock(1)(st, d) || leaveSummaryDown(st, d, v),
  Backspace: deleteBlocks,
  "Alt-Backspace": deleteBlocks,
  "Ctrl-h": deleteBlocks,
  Delete: deleteBlocks,
  "Mod-d": duplicateBlocks,
  "Mod-a": selectAllBlocks,
};

export const blockSelKey = new PluginKey("page-blocksel");

const countOf = (st) => {
  const sel = st.selection;
  const { lo, hi } = sel.span(st.doc);
  return outline(st.doc).filter((e) => e.i >= lo && e.i <= hi && !e.hidden).length;
};

export function blockSelectionPlugin() {
  const keys = keymap.keymap(blockSelKeys);
  return new Plugin({
    key: blockSelKey,
    state: {
      init: () => 0,
      apply: (tr, notice, prev, next) => (tr.getMeta(REMOTE) && prev.selection instanceof BlockSelection && !(next.selection instanceof BlockSelection) ? notice + 1 : notice),
    },
    props: {
      handleKeyDown: (view, event) => keys.props.handleKeyDown(view, event),
      handleTextInput: (view, from, to, text) => typeIntoBlocks(view, text),
      decorations(st) {
        const sel = st.selection;
        if (!(sel instanceof BlockSelection)) return null;
        const decos = [];
        st.doc.nodesBetween(sel.from, sel.to, (n, pos) => {
          decos.push(pmView.Decoration.node(pos, pos + n.nodeSize, { class: "page-block-selected" }));
          return false;
        });
        return pmView.DecorationSet.create(st.doc, decos);
      },
      createSelectionBetween(view, $anchor, $head) {
        const sel = view.state.selection;
        return sel instanceof BlockSelection && $anchor.pos === sel.anchor && $head.pos === sel.head ? sel : null;
      },
      handleDOMEvents: {
        mousedown(view, event) {
          const sel = view.state.selection;
          if (!event.shiftKey || !(sel instanceof BlockSelection) || event.button !== 0) return false;
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!hit) return false;
          const ents = outline(view.state.doc);
          const j = Math.min(view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos).index(0), ents.length - 1);
          const { lo, hi } = sel.span(view.state.doc);
          const anchorIdx = sel.anchor <= sel.head ? lo : rootAt(ents, lo, hi, 1);
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(selectBlocks(view.state.doc, anchorIdx, j, ents)));
          return true;
        },
      },
    },
    view: () => ({
      update(view, prev) {
        const a = view.state.selection, b = prev.selection;
        if (a instanceof BlockSelection && !a.eq(b)) {
          const n = countOf(view.state);
          announce(view, `${n} ${n === 1 ? "block" : "blocks"} selected`);
        } else if (b instanceof BlockSelection && !(a instanceof BlockSelection)) {
          announce(view, blockSelKey.getState(view.state) !== blockSelKey.getState(prev) ? "Block selection cleared because the document changed" : "Selection cleared");
        }
      },
    }),
  });
}
