// A selection as a peer can name it, and a peer's target read back in this tab's
// document: stable block ids, guarded Yjs relative positions, and the winning
// copy's coordinates. Nothing here is stored or saved; a target is built from the
// current document and thrown away.
import * as Y from "../../vendor/yjs.vendor.js";
import { toBase64, fromBase64 } from "../../vendor/yjs.vendor.js";
import { state as pmState } from "../../vendor/prosemirror.vendor.js";
import { yBefore, yAfter } from "./tokens.js";
import { posAtY, yIndexAt, cellPoint, cellRange } from "./positions.js";
import { BlockSelection } from "../blocks.js";

// A block selection publishes its ids, bounded so one person can never make a
// target too large for the host to accept.
export const MAX_BLOCK_IDS = 128;

const blockIdOf = ($pos) => ($pos.depth ? $pos.node(1).attrs.id : null);
const inTable = ($pos) => !!$pos.depth && $pos.node(1).type.name === "table";

const relativeTo = (pd, doc, w, pos, assoc) =>
  toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(pd.flow, yIndexAt(doc, w.holes, pos, w.visible), assoc)));

/**
 * One selection as a peer publishes it, or null when it has no page coordinates
 * (a mixed selection, a caret with no block, a table range across cells).
 */
export function encodeSelection({ pd, w, doc }, selection) {
  if (!pd || !w || !doc || !selection) return null;
  if (selection instanceof pmState.TextSelection) {
    const $anchor = selection.$anchor, $head = selection.$head;
    if (inTable($anchor) || inTable($head)) {
      const anchor = cellPoint(doc, $anchor.pos), head = cellPoint(doc, $head.pos);
      if (!anchor || !head || anchor.table !== head.table || anchor.row !== head.row || anchor.col !== head.col) return null;
      return { kind: "cell", block: anchor.table, row: anchor.row, col: anchor.col };
    }
    const from = Math.min(selection.from, selection.to);
    const end = ($pos) => {
      const block = blockIdOf($pos);
      if (block === null) return null;
      return { block, rel: relativeTo(pd, doc, w, $pos.pos, selection.empty || $pos.pos === from ? 0 : -1) };
    };
    const anchor = end($anchor), head = end($head);
    return anchor && head ? { kind: "text", anchor, head } : null;
  }
  if (selection instanceof BlockSelection || selection instanceof pmState.NodeSelection) {
    const ids = [];
    if (selection instanceof BlockSelection) {
      const { lo, hi } = selection.span();
      doc.forEach((node, _at, index) => { if (index >= lo && index <= hi) ids.push(node.attrs.id); });
    } else {
      const node = doc.nodeAt(selection.from);
      if (node) ids.push(node.attrs.id);
    }
    if (!ids.length) return null;
    if (ids.length > MAX_BLOCK_IDS) {
      const focused = blockIdOf(selection.$from);
      return focused ? { kind: "blocks", ids: [focused] } : null;
    }
    return { kind: "blocks", ids };
  }
  return null;
}

const indexOf = (pd, end) => {
  if (!end || typeof end !== "object" || typeof end.block !== "string" || !end.block || typeof end.rel !== "string" || !end.rel) return null;
  let rel;
  try { rel = Y.decodeRelativePosition(fromBase64(end.rel)); } catch { return null; }
  let abs;
  try { abs = Y.createAbsolutePositionFromRelativePosition(rel, pd.ydoc); } catch { return null; }
  // A position that names another shared type is not this document's: the peer
  // wrote against a document this tab does not hold.
  if (!abs || abs.type !== pd.flow) return null;
  return abs.index;
};

// Whether the flow still holds text at that index: a join keeps it, a deletion
// and an undone Restore do not.
const aliveAt = (pd, index) => {
  let at = 0;
  for (let it = pd.flow._start; it; it = it.right) {
    const end = at + it.length;
    if (index < end) return !it.deleted;
    at = end;
  }
  return false;
};

const liveMarker = (pd, id) => {
  for (let it = pd.flow._start; it; it = it.right) if (!it.deleted && it.content instanceof Y.ContentEmbed && it.content.embed?.b === id) return true;
  return false;
};

// Where a flow index sits inside its own block, read from the flow itself: the
// marker the index follows and how far into that block's text it is. A moved
// block leaves its old text behind as a hidden copy, so the index still names the
// block that was moved and the offset the person had.
const offsetInBlock = (pd, index) => {
  let at = 0, id = null, start = 0;
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.content instanceof Y.ContentEmbed && it.content.embed?.b !== undefined) {
      id = it.content.embed.b;
      start = at + it.length;
    }
    at += it.length;
    if (at > index && id !== null) return { id, offset: index - start };
  }
  return id === null ? null : { id, offset: index - start };
};

const placeInBlock = (doc, id, offset) => {
  let found = null;
  doc.forEach((node, pos) => { if (found === null && node.attrs.id === id && node.isTextblock) found = pos + 1 + Math.min(Math.max(offset, 0), node.content.size); });
  return found;
};

// A failed resolution is null, never a neighbouring block: the caller hides it
// instead of drawing it somewhere plausible. A block that moved is the same
// logical block at a new place, so it is placed by its id and the offset the
// person had; a block that is hidden or gone has no place here at all.
const placeEnd = ({ pd, w, doc }, end) => {
  const index = indexOf(pd, end);
  if (index === null) return null;
  const pos = posAtY(doc, w.holes, w.tokens, index, w.visible);
  if (blockIdOf(doc.resolve(pos)) === end.block) return pos;
  const spot = offsetInBlock(pd, index);
  if (spot && spot.id === end.block) {
    const moved = placeInBlock(doc, end.block, spot.offset);
    if (moved !== null) return moved;
  }
  // A block that still exists in the flow but not in the document is hidden, and a
  // position that landed elsewhere is not this caret's. A block the peer named that
  // no longer exists anywhere was joined into the one that now holds its text, and
  // the relative position says where in it.
  if (liveMarker(pd, end.block) || !aliveAt(pd, index)) return null;
  // A position inside a hole is text this tab does not show; only a position in
  // visible text may stand in for a block that was joined away.
  if (w.holes.some((hole) => index >= yBefore(w.holes, hole.at) && index < yAfter(w.holes, hole.at))) return null;
  return doc.resolve(pos).parent.inlineContent ? pos : null;
};

/**
 * A published selection read back in this tab's current document: page
 * positions, or null when any part of it no longer names this document's text.
 * A hidden block, a deleted one, a position from another document or bytes that
 * do not decode are all nulls, and a null is a caret that is not drawn.
 */
export function decodeSelection({ pd, w, doc }, selection) {
  if (!pd || !w || !doc || !selection || typeof selection !== "object") return null;
  if (selection.kind === "text") {
    const anchor = placeEnd({ pd, w, doc }, selection.anchor);
    const head = placeEnd({ pd, w, doc }, selection.head);
    if (anchor === null || head === null) return null;
    return { kind: "text", from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }
  if (selection.kind === "cell") {
    const cell = cellRange(doc, { table: selection.block, row: selection.row, col: selection.col, offset: 0 });
    if (!cell) return null;
    return { kind: "cell", from: cell.from, to: cell.to, block: cell.block, row: cell.row, col: cell.col };
  }
  if (selection.kind === "blocks") {
    const ids = [];
    const ranges = [];
    for (const id of Array.isArray(selection.ids) ? selection.ids : []) {
      doc.forEach((node, at) => {
        if (node.attrs.id !== id || ids.includes(id)) return;
        ids.push(id);
        ranges.push({ from: at, to: at + node.nodeSize });
      });
    }
    return ranges.length ? { kind: "blocks", ids, ranges } : null;
  }
  return null;
}
