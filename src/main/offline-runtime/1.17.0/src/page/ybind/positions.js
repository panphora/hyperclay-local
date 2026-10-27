// Where a position sits on the page: the map between a ProseMirror position in
// the projected document and an index in the page's Yjs `flow`. Extracted from
// bridge.js so the same functions keep this tab's own caret through a peer's edit
// and place a peer's caret here, instead of each approximating the other.
import { tokenIndex, yBefore } from "./tokens.js";

export const yIndexAt = (doc, holes, pos, visible) => yBefore(holes, tokenIndex(doc, new Map(), visible)[pos]);

export function posAtY(doc, holes, tokens, y, visible = null) {
  let lo = 0, hi = tokens;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (yBefore(holes, mid) <= y) lo = mid; else hi = mid - 1; }
  const idx = tokenIndex(doc, new Map(), visible);
  let first = -1;
  for (let p = 0; p < idx.length; p++) {
    if (idx[p] < lo) continue;
    if (idx[p] > lo) break;
    if (first < 0) first = p;
    if (doc.resolve(p).parent.inlineContent) return p;
  }
  return first < 0 ? doc.content.size : first;
}

export const cellPoint = (doc, pos) => {
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 3 || $pos.parent.type.name !== "table_cell") return null;
  return { table: $pos.node(1).attrs.id, row: $pos.node(2).attrs.id, col: $pos.parent.attrs.col, offset: $pos.parentOffset };
};

// The cell a point names, as its own range: what an outline draws and what a
// character offset would pretend to know.
export const cellRange = (doc, point) => {
  let found = null;
  doc.forEach((table, at) => {
    if (found !== null || table.type.name !== "table" || table.attrs.id !== point.table) return;
    table.forEach((row, rowAt) => {
      if (found !== null || row.attrs.id !== point.row) return;
      row.forEach((cell, cellAt) => {
        if (found === null && cell.attrs.col === point.col) found = { from: at + 2 + rowAt + cellAt, to: at + 2 + rowAt + cellAt + cell.nodeSize, block: point.table, row: point.row, col: point.col };
      });
    });
  });
  return found;
};

export const cellAt = (doc, point) => {
  const range = cellRange(doc, point);
  if (!range) return null;
  const cell = doc.nodeAt(range.from);
  return range.from + 1 + Math.min(point.offset ?? 0, cell ? cell.content.size : 0);
};
