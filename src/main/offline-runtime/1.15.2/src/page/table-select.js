// Rectangle selection in a table: drag across cells or Shift+click, or pick
// Select row / Select column from a handle menu. The rectangle lives in plugin
// state by table, row and column ids, so a peer's edit keeps it while those
// ids exist. Copy writes tab-separated text plus an HTML table; Delete clears
// the covered cells; a paste starts at the top-left cell.
import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { cellValue, orderedIds } from "./model.js";
import { cellText } from "./rich/cell.js";
import { clipboardSerializer } from "./blocks.js";
import { asStep } from "./blocksel.js";
import { announce } from "./announce.js";
import { REMOTE_META } from "./ybind/layout.js";
import { rectKey } from "./table-rect-key.js";

const { Plugin, TextSelection } = state;
const N = schema.nodes;
export { rectKey };

const findTable = (doc, id) => {
  let found = null;
  doc.forEach((node, pos) => { if (!found && node.type === N.table && node.attrs.id === id) found = { node, pos }; });
  return found;
};

export function rectCells(doc, rect) {
  if (!rect) return null;
  const found = findTable(doc, rect.table);
  if (!found) return null;
  const rowIds = [];
  found.node.forEach((row) => rowIds.push(row.attrs.id));
  const colIds = orderedIds(found.node.attrs.cols);
  const r = [rowIds.indexOf(rect.anchor[0]), rowIds.indexOf(rect.head[0])];
  const c = [colIds.indexOf(rect.anchor[1]), colIds.indexOf(rect.head[1])];
  if (r.includes(-1) || c.includes(-1)) return null;
  const top = Math.min(...r), bottom = Math.max(...r), left = Math.min(...c), right = Math.max(...c);
  const cells = [];
  let rowPos = found.pos + 1;
  found.node.forEach((row, _o, i) => {
    if (i >= top && i <= bottom) {
      const line = [];
      let at = rowPos + 1;
      row.forEach((cell, _p, j) => { if (j >= left && j <= right) line.push({ cell, pos: at }); at += cell.nodeSize; });
      cells.push(line);
    }
    rowPos += row.nodeSize;
  });
  return { ...found, top, bottom, left, right, cells };
}

const cellIds = (doc, pos) => {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type === N.table_cell && d >= 3) return { table: $pos.node(d - 2).attrs.id, row: $pos.node(d - 1).attrs.id, col: $pos.node(d).attrs.col, start: $pos.start(d) };
  }
  return null;
};

export function setRect(view, anchorPos, headPos) {
  const a = cellIds(view.state.doc, anchorPos), h = cellIds(view.state.doc, headPos);
  if (!a || !h || a.table !== h.table) return false;
  const rect = { table: a.table, anchor: [a.row, a.col], head: [h.row, h.col] };
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, h.start)).setMeta(rectKey, rect);
  view.dispatch(tr);
  const found = rectCells(view.state.doc, rect);
  const count = found ? (found.bottom - found.top + 1) * (found.right - found.left + 1) : 0;
  announce(view, `${count} ${count === 1 ? "cell" : "cells"} selected`);
  return true;
}

export function selectLine(view, tablePos, what, index) {
  const table = view.state.doc.nodeAt(tablePos);
  if (table?.type !== N.table || !table.childCount) return false;
  const lastRow = table.childCount - 1, lastCol = table.child(0).childCount - 1;
  const at = (row, col) => {
    let pos = tablePos + 1;
    for (let i = 0; i < row; i++) pos += table.child(i).nodeSize;
    pos++;
    for (let j = 0; j < col; j++) pos += table.child(row).child(j).nodeSize;
    return pos + 1;
  };
  return what === "row" ? setRect(view, at(index, 0), at(index, lastCol)) : setRect(view, at(0, index), at(lastRow, index));
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

const quote = (text) => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function rectClipboard(found, doc) {
  const text = found.cells.map((line) => line.map(({ cell }) => quote(cellText(cellValue(cell)))).join("\t")).join("\n");
  const table = doc.createElement("table");
  const body = table.appendChild(doc.createElement("tbody"));
  for (const line of found.cells) {
    const tr = body.appendChild(doc.createElement("tr"));
    for (const { cell } of line) {
      const td = tr.appendChild(doc.createElement("td"));
      td.dataset.col = cell.attrs.col;
      td.append(clipboardSerializer.serializeFragment(cell.content, { document: doc }));
    }
  }
  return { text, html: table.outerHTML };
}

export function clearRect(st, dispatch) {
  const found = rectCells(st.doc, rectKey.getState(st));
  if (!found) return false;
  if (dispatch) {
    const tr = st.tr;
    for (const line of [...found.cells].reverse()) for (const { cell, pos } of [...line].reverse()) {
      if (cell.content.size) tr.delete(pos + 1, pos + cell.nodeSize - 1);
    }
    tr.setMeta(rectKey, rectKey.getState(st));
    dispatch(asStep(tr));
  }
  return true;
}

const write = (event, found, view) => {
  const { text, html } = rectClipboard(found, view.dom.ownerDocument);
  event.clipboardData.setData("text/plain", text);
  event.clipboardData.setData("text/html", html);
  event.preventDefault();
};

const extend = (dr, dc) => (st, dispatch, view) => {
  const rect = rectKey.getState(st);
  const found = rectCells(st.doc, rect);
  if (!found || !view) return false;
  const rowIds = [], colIds = orderedIds(found.node.attrs.cols);
  found.node.forEach((row) => rowIds.push(row.attrs.id));
  const r = Math.max(0, Math.min(rowIds.length - 1, rowIds.indexOf(rect.head[0]) + dr));
  const c = Math.max(0, Math.min(colIds.length - 1, colIds.indexOf(rect.head[1]) + dc));
  if (dispatch) dispatch(st.tr.setMeta(rectKey, { ...rect, head: [rowIds[r], colIds[c]] }));
  return true;
};

const cellOfEvent = (view, event) => {
  const td = event.target?.closest?.("td");
  if (!td || !view.dom.contains(td)) return null;
  try { return view.posAtDOM(td, 0); } catch { return null; }
};

export function tableSelectPlugin() {
  let drag = null;
  return new Plugin({
    key: rectKey,
    state: {
      init: () => null,
      apply(tr, value, _old, next) {
        const meta = tr.getMeta(rectKey);
        if (meta !== undefined) return meta;
        if (!value) return null;
        if (tr.selectionSet) return null;
        if (tr.docChanged && !tr.getMeta(REMOTE_META)) return null;
        return rectCells(next.doc, value) ? value : null;
      },
    },
    props: {
      attributes: (st) => (rectKey.getState(st) ? { class: "has-cell-rect" } : {}),
      createSelectionBetween: (view) => (rectKey.getState(view.state) ? view.state.selection : null),
      decorations(st) {
        const found = rectCells(st.doc, rectKey.getState(st));
        if (!found) return null;
        return pmView.DecorationSet.create(st.doc, found.cells.flat().map(({ cell, pos }) => pmView.Decoration.node(pos, pos + cell.nodeSize, { class: "is-cell-selected" })));
      },
      handleKeyDown(view, event) {
        const st = view.state;
        if (!rectKey.getState(st)) return false;
        if (event.key === "Escape") { view.dispatch(st.tr.setMeta(rectKey, null)); return true; }
        if (event.key === "Backspace" || event.key === "Delete") return clearRect(st, view.dispatch);
        if (event.shiftKey) {
          const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
          if (step) return extend(...step)(st, view.dispatch, view);
        }
        if (MODIFIERS.has(event.key) || ((event.metaKey || event.ctrlKey) && (event.key === "a" || event.key === "c" || event.key === "x" || event.key === "v"))) return false;
        view.dispatch(st.tr.setMeta(rectKey, null));
        return false;
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.button !== 0) return false;
          if (!event.shiftKey && rectKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(rectKey, null));
          const pos = cellOfEvent(view, event);
          if (pos === null) return false;
          if (event.shiftKey) {
            const rect = rectKey.getState(view.state);
            const anchor = (rect && anchorPos(view.state.doc, rect)) ?? view.state.selection.$anchor.pos;
            if (!cellIds(view.state.doc, anchor)) return false;
            event.preventDefault();
            return setRect(view, anchor, pos);
          }
          const doc = view.dom.ownerDocument;
          const start = pos;
          const move = (e) => {
            const at = cellOfEvent(view, e);
            if (at === null) return;
            const a = cellIds(view.state.doc, start), h = cellIds(view.state.doc, at);
            if (!a || !h || a.table !== h.table) return;
            const rect = rectKey.getState(view.state);
            if (a.row === h.row && a.col === h.col && !rect) return;
            if (rect && rect.head[0] === h.row && rect.head[1] === h.col) return;
            e.preventDefault();
            setRect(view, start, at);
          };
          const up = () => { doc.removeEventListener("mouseover", move); doc.removeEventListener("mouseup", up); drag = null; };
          drag?.();
          drag = up;
          doc.addEventListener("mouseover", move);
          doc.addEventListener("mouseup", up);
          return false;
        },
        copy(view, event) {
          const found = rectCells(view.state.doc, rectKey.getState(view.state));
          if (!found || !event.clipboardData) return false;
          write(event, found, view);
          return true;
        },
        cut(view, event) {
          const found = rectCells(view.state.doc, rectKey.getState(view.state));
          if (!found || !event.clipboardData) return false;
          write(event, found, view);
          clearRect(view.state, view.dispatch);
          return true;
        },
      },
    },
    view: () => ({ destroy: () => drag?.() }),
  });
}

function anchorPos(doc, rect) {
  const found = findTable(doc, rect.table);
  let out = null;
  found?.node.forEach((row, offset) => {
    if (row.attrs.id !== rect.anchor[0]) return;
    let at = found.pos + 1 + offset + 1;
    row.forEach((cell) => { if (cell.attrs.col === rect.anchor[1]) out = at + 1; at += cell.nodeSize; });
  });
  return out;
}

export const rectTopLeft = (st) => {
  const found = rectCells(st.doc, rectKey.getState(st));
  return found ? { row: found.top, cell: found.left, rows: found.bottom - found.top + 1, cols: found.right - found.left + 1 } : null;
};
