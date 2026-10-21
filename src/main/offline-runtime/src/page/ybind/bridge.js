import * as Y from "../../vendor/yjs.vendor.js";
import { REMOTE_META, LOCAL, HISTORY_META, attrKeys, sameJson } from "./layout.js";
import { walk, hashText } from "./walk.js";
import { docOf } from "./doc.js";
import { localGroup } from "./group.js";
import { tokenIndex, yBefore } from "./tokens.js";
import { state as pmState } from "../../vendor/prosemirror.vendor.js";
import { repairSiblings } from "../model.js";

const yIndexAt = (doc, holes, pos, visible) => yBefore(holes, tokenIndex(doc, new Map(), visible)[pos]);

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

export const shapeOf = (doc) => { const out = []; doc.forEach((b) => out.push([b.type.name, b.attrs.id, JSON.stringify(Object.fromEntries(attrKeys(b.type).map((k) => [k, b.attrs[k]]))), b.isTextblock || b.type.name === "table" ? JSON.stringify(b.content.toJSON()) : null])); return JSON.stringify(out); };
export const bareShape = (doc) => { const out = []; doc.forEach((b) => out.push([b.type.name, JSON.stringify(Object.fromEntries(attrKeys(b.type).map((k) => [k, b.attrs[k]]))), b.isTextblock || b.type.name === "table" ? JSON.stringify(b.content.toJSON()) : null])); return JSON.stringify(out); };
export function sameBareShape(a, b) {
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    const left = a.child(i), right = b.child(i);
    if (left.type !== right.type) return false;
    if (attrKeys(left.type).some((key) => !sameJson(left.attrs[key], right.attrs[key]))) return false;
    if ((left.isTextblock || left.type.name === "table") && !left.content.eq(right.content)) return false;
  }
  return true;
}

export function docDiff(oldDoc, newDoc) {
  const start = oldDoc.content.findDiffStart(newDoc.content);
  if (start === null) return null;
  let { a: endA, b: endB } = oldDoc.content.findDiffEnd(newDoc.content);
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) { endA += overlap; endB += overlap; }
  return { start, endA, endB };
}


export function keepViewPos(derived, current = null) {
  const previous = new Map();
  current?.forEach((block) => { if (block.attrs.id) previous.set(block.attrs.id, block); });
  const blocks = [];
  derived.forEach((block) => blocks.push(block));
  const positions = blocks.map((block) => ({ id: block.attrs.id, pos: previous.get(block.attrs.id)?.attrs.pos ?? block.attrs.pos }));
  const changes = repairSiblings(positions, "b");
  let changed = false;
  const placed = blocks.map((block, index) => {
    const pos = changes[index]?.pos ?? positions[index].pos;
    let content = block.content;
    if (block.type.name === "table") {
      const oldRows = new Map();
      previous.get(block.attrs.id)?.forEach((row) => { if (row.attrs.id) oldRows.set(row.attrs.id, row.attrs.pos); });
      const rows = [];
      block.forEach((row) => rows.push(row));
      const rowPositions = rows.map((row) => ({ id: row.attrs.id, pos: oldRows.get(row.attrs.id) ?? row.attrs.pos }));
      const rowChanges = repairSiblings(rowPositions, "r");
      const placedRows = rows.map((row, i) => {
        const rowPos = rowChanges[i]?.pos ?? rowPositions[i].pos;
        return rowPos === row.attrs.pos ? row : row.type.create({ ...row.attrs, pos: rowPos }, row.content, row.marks);
      });
      if (placedRows.some((row, i) => row !== rows[i])) content = placedRows;
    }
    if (pos === block.attrs.pos && content === block.content) return block;
    changed = true;
    return block.type.create({ ...block.attrs, pos }, content, block.marks);
  });
  return changed ? derived.type.create(derived.attrs, placed) : derived;
}

export function createBridge({ pd, onNotice = () => {}, stats = { groups: 0, mismatch: 0, renders: 0, first: null }, captureTimeout = 500 }) {
  let view = null;
  let w = walk(pd);
  const um = new Y.UndoManager([pd.flow, pd.attrs, pd.gone], { trackedOrigins: new Set([LOCAL]), captureTimeout, captureTransaction: (tr) => tr.meta.get(HISTORY_META) !== false });
  const noticed = new Map();
  const refresh = () => {
    w = walk(pd);
    for (const o of w.orphans) {
      const k = `${o.key}:${o.h}`;
      if (!noticed.has(k)) {
        const notice = { kind: "deleted-block-edit", ...o };
        noticed.set(k, notice);
        onNotice(notice);
      }
    }
    return docOf(pd, w);
  };
  let saved = null;
  const render = (own = false, fresh = null) => {
    stats.renders++;
    const keep = saved;
    saved = null;
    const derived = keepViewPos(fresh ?? refresh(), view.state.doc);
    const d = docDiff(view.state.doc, derived);
    if (!d) return;
    const tr = view.state.tr.replace(d.start, d.endA, derived.slice(d.start, d.endB)).setMeta(REMOTE_META, true).setMeta("addToHistory", false);
    if (own) tr.setMeta("yundo", true);
    if (keep) {
      const at = (rel) => { const abs = Y.createAbsolutePositionFromRelativePosition(rel, pd.ydoc); return abs ? posAtY(tr.doc, w.holes, w.tokens, abs.index, w.visible) : null; };
      const anchor = at(keep.anchor), head = at(keep.head);
      if (anchor !== null && head !== null) tr.setSelection(pmState.TextSelection.create(tr.doc, anchor, head));
    }
    view.dispatch(tr);
  };
  const onBefore = (t) => {
    if (!view || t.origin === LOCAL || t.origin === um || saved) return;
    const sel = view.state.selection;
    if (!(sel instanceof pmState.TextSelection)) return;
    if ([sel.$anchor, sel.$head].some((pos) => pos.depth && pos.node(1).type.name === "table")) return;
    const rel = (pos) => Y.createRelativePositionFromTypeIndex(pd.flow, yIndexAt(view.state.doc, w.holes, pos, w.visible));
    saved = { anchor: rel(sel.anchor), head: rel(sel.head) };
  };
  const onAfter = (t) => {
    if (!view || t.origin === LOCAL) { saved = null; return; }
    render(t.origin === um);
  };
  pd.ydoc.on("beforeTransaction", onBefore);
  pd.ydoc.on("afterTransaction", onAfter);
  return {
    pd, stats, render, um,
    attach(v) {
      view = v;
      w = walk(pd);
    },
    dispose() {
      pd.ydoc.off("beforeTransaction", onBefore);
      pd.ydoc.off("afterTransaction", onAfter);
      um.destroy();
      view = null;
    },
    get walk() { return w; },
    get notices() { return [...noticed.values()]; },
    dispatch(tr) {
      const { state, transactions } = view.state.applyTransaction(tr);
      const local = transactions.filter((t) => t.docChanged && !t.getMeta(REMOTE_META));
      view.updateState(state);
      if (!local.length) return;
      w = walk(pd);
      const history = transactions.every((t) => t.getMeta("addToHistory") !== false);
      localGroup(pd, local, w, stats, um, history);
      const derived = refresh();
      if (!sameBareShape(derived, view.state.doc)) {
        stats.mismatch++;
        stats.first ??= { before: bareShape(local[0].before), pm: bareShape(view.state.doc), y: bareShape(derived) };
      }
      render(false, derived);
    },
    restore(key) {
      if (!pd.gone.has(key)) return;
      um.stopCapturing();
      pd.ydoc.transact(() => { pd.gone.delete(key); }, LOCAL);
      um.stopCapturing();
      render();
    },
    undo() { return um.undo() !== null; },
    redo() { return um.redo() !== null; },
  };
}
