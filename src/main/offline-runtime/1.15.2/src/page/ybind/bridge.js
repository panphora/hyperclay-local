import * as Y from "../../vendor/yjs.vendor.js";
import { REMOTE_META, LOCAL, HISTORY_META, attrKeys, sameJson, parseKey, mintOp } from "./layout.js";
import { walk, hashText } from "./walk.js";
import { docOf } from "./doc.js";
import { localGroup } from "./group.js";
import { tokenIndex, yBefore, yAfter } from "./tokens.js";
import { state as pmState } from "../../vendor/prosemirror.vendor.js";
import { repairSiblings } from "../model.js";
import { createOriginIndex, installUndoOrigins } from "./origins.js";
import { reduceRecovery, canonicalRevision, restoreKey, physicalKeyOf, authorKey, RECOVERED_PREFIX, parsePhysicalKey, parseGoneIntents } from "./recovery.js";
import { moveBlocks } from "./moves.js";
import { createBoardCommands } from "./board-commands.js";
import { continuesGroup, intentOf } from "../history-intent.js";
import { MOVE, BlockSelection } from "../blocks.js";

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

const tableSpan = (doc, pos) => {
  const $pos = doc.resolve(pos);
  return $pos.depth && $pos.node(1).type.name === "table" ? [$pos.before(1), $pos.after(1)] : null;
};

export function docDiff(oldDoc, newDoc) {
  let start = oldDoc.content.findDiffStart(newDoc.content);
  if (start === null) return null;
  let { a: endA, b: endB } = oldDoc.content.findDiffEnd(newDoc.content);
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) { endA += overlap; endB += overlap; }
  const oneTextblock = (doc, end) => { const $start = doc.resolve(start); return $start.parent.isTextblock && $start.sameParent(doc.resolve(end)); };
  if ((tableSpan(oldDoc, start) || tableSpan(oldDoc, endA)) && !(oneTextblock(oldDoc, endA) && oneTextblock(newDoc, endB))) {
    start = tableSpan(oldDoc, start)?.[0] ?? start;
    endA = tableSpan(oldDoc, endA)?.[1] ?? endA;
    endB = tableSpan(newDoc, endB)?.[1] ?? endB;
    return { start, endA, endB, tables: true };
  }
  return { start, endA, endB };
}

const cellPoint = (doc, pos) => {
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 3 || $pos.parent.type.name !== "table_cell") return null;
  return { table: $pos.node(1).attrs.id, row: $pos.node(2).attrs.id, col: $pos.parent.attrs.col, offset: $pos.parentOffset };
};

const cellAt = (doc, point) => {
  let found = null;
  doc.forEach((table, at) => {
    if (found !== null || table.type.name !== "table" || table.attrs.id !== point.table) return;
    table.forEach((row, rowAt) => {
      if (found !== null || row.attrs.id !== point.row) return;
      row.forEach((cell, cellAt) => {
        if (found === null && cell.attrs.col === point.col) found = at + 2 + rowAt + cellAt + 1 + Math.min(point.offset, cell.content.size);
      });
    });
  });
  return found;
};


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
      const rows = [];
      block.forEach((row) => rows.push(row));
      const rowPositions = rows.map((row) => ({ id: row.attrs.id, pos: row.attrs.pos }));
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

const freezeDeep = (value) => {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    Object.freeze(value);
  }
  return value;
};
const detached = (value) => freezeDeep(JSON.parse(JSON.stringify(value)));

const restoreIndexAt = (pd, sourceKey) => {
  const target = parseKey(sourceKey);
  let at = 0;
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.id.client === target.client && it.id.clock === target.clock) return it.deleted ? at : at + it.length;
    if (!it.deleted && it.countable) at += it.length;
  }
  return at;
};

const newestLocalMarker = (pd, blockId) => {
  let found = null;
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.id.client !== pd.ydoc.clientID || !(it.content instanceof Y.ContentEmbed) || it.content.embed?.b !== blockId) continue;
    if (!found || it.id.clock > found.clock) found = it.id;
  }
  return found;
};

export function createBridge({ pd, onNotice = () => {}, ownedTokens = [], authorToken = null, stats = { groups: 0, mismatch: 0, renders: 0, first: null }, captureTimeout = 500 }) {
  let view = null;
  let w = walk(pd);
  const origins = createOriginIndex(pd.origins);
  const um = new Y.UndoManager([pd.flow, pd.attrs, pd.gone, pd.tableFields, pd.boardFields], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout,
    captureTransaction: (tr) => tr.meta.get(HISTORY_META) !== false,
    deleteFilter: (item) => {
      if (item.parent !== pd.flow || !(item.content instanceof Y.ContentEmbed)) return true;
      const source = origins.resolve(item.id);
      return source.client !== item.id.client || source.clock !== item.id.clock || origins.boundaryOf(item.id)?.kind !== "copy";
    },
  });
  const offOrigins = installUndoOrigins(pd, um, origins, (gone) => parseGoneIntents(gone).textDeletes);
  const notified = new Set();
  const localTokens = new Set(authorToken ? [...ownedTokens, authorToken] : ownedTokens);
  let registerAuthor = authorToken ? () => {
    const key = authorKey(pd.ydoc.clientID);
    if (pd.origins.get(key) !== authorToken) pd.origins.set(key, authorToken);
  } : null;
  const dismissed = new Set();
  const recoveryListeners = new Set();
  let recoveryVersion = 0;
  let recoveryMemo = null;
  let recoverySignature = null;
  const personalNotice = (record) => {
    const owners = new Set();
    for (const block of record.blocks) for (const run of block.runs) {
      if (!run.displaced) continue;
      const ownClient = parsePhysicalKey(run.source)?.client === pd.ydoc.clientID;
      if (run.author && (ownClient || localTokens.has(run.author))) owners.add(run.author);
      else if (ownClient) owners.add(null);
    }
    if (!owners.size) return null;
    const authors = [...owners].filter(Boolean).sort();
    return { kind: "recovered-change", source: record.source, revision: record.revision, blockId: record.blockId, author: authors[0] ?? null, authors };
  };
  const recoveryState = () => {
    if (recoveryMemo && recoveryMemo.version === recoveryVersion) return recoveryMemo.snapshot;
    const reduced = reduceRecovery(pd, { index: origins });
    const recoverable = reduced.list.filter((record) => record.recoverable).map((record) => detached(record));
    const notices = detached(recoverable.map((record) => personalNotice(record)).filter((notice) => notice && !dismissed.has(`${notice.source}\u0000${notice.revision}`)));
    const snapshot = Object.freeze({ recoverable: Object.freeze(recoverable), notices: Object.freeze(notices) });
    recoveryMemo = { version: recoveryVersion, snapshot };
    return snapshot;
  };
  const recoverySignatureOf = (snapshot) => canonicalRevision({ recoverable: snapshot.recoverable.map((record) => [record.source, record.revision]), notices: snapshot.notices });
  const bumpRecovery = () => {
    recoveryVersion++;
    const snapshot = recoveryState();
    for (const notice of snapshot.notices) {
      const key = `${notice.source}\u0000${notice.revision}`;
      if (!notified.has(key)) { notified.add(key); onNotice(notice); }
    }
    if (!recoveryListeners.size) { recoverySignature = null; return; }
    const signature = recoverySignatureOf(snapshot);
    if (signature === recoverySignature) return;
    recoverySignature = signature;
    for (const listener of [...recoveryListeners]) listener(snapshot);
  };
  const refresh = () => {
    w = walk(pd);
    bumpRecovery();
    return docOf(pd, w);
  };
  let saved = null;
  let lastIntent = null;
  let groupOpen = false;
  let joining = false;
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
      const hiddenUnit = (y) => y >= 0 && w.holes.some((hole) => y >= yBefore(w.holes, hole.at) && y < yAfter(w.holes, hole.at));
      const placeIn = (id, offset) => {
        let found = null;
        tr.doc.forEach((node, pos) => { if (found === null && node.attrs.id === id && node.isTextblock) found = pos + 1 + Math.min(offset, node.content.size); });
        return found;
      };
      const at = (end) => {
        const abs = Y.createAbsolutePositionFromRelativePosition(end.right, pd.ydoc);
        if (!abs) return null;
        const pos = posAtY(tr.doc, w.holes, w.tokens, abs.index, w.visible);
        if (!end.block) return pos;
        const $pos = tr.doc.resolve(pos);
        if ($pos.depth && $pos.node(1).attrs.id === end.block.id) return pos;
        const left = end.left ? Y.createAbsolutePositionFromRelativePosition(end.left, pd.ydoc) : null;
        if (!hiddenUnit(abs.index) && !(left && hiddenUnit(left.index - 1))) return pos;
        return placeIn(end.block.id, end.block.offset) ?? pos;
      };
      const anchor = at(keep.anchor), head = at(keep.head);
      if (anchor !== null && head !== null) tr.setSelection(pmState.TextSelection.create(tr.doc, anchor, head));
    } else if (d.tables && view.state.selection instanceof pmState.TextSelection) {
      const anchor = cellPoint(view.state.doc, view.state.selection.anchor), head = cellPoint(view.state.doc, view.state.selection.head);
      const a = anchor && cellAt(tr.doc, anchor), h = head && cellAt(tr.doc, head);
      if (a !== null && a !== undefined && h !== null && h !== undefined) tr.setSelection(pmState.TextSelection.create(tr.doc, a, h));
    }
    view.dispatch(tr);
  };
  const onBefore = (t) => {
    if (groupOpen && !joining && t.origin === LOCAL) { um.stopCapturing(); groupOpen = false; }
    if (!view || t.origin === LOCAL || t.origin === um || saved) return;
    const sel = view.state.selection;
    if (!(sel instanceof pmState.TextSelection)) return;
    if ([sel.$anchor, sel.$head].some((pos) => pos.depth && pos.node(1).type.name === "table")) return;
    const end = ($pos) => {
      const index = yIndexAt(view.state.doc, w.holes, $pos.pos, w.visible);
      return {
        right: Y.createRelativePositionFromTypeIndex(pd.flow, index),
        left: index > 0 ? Y.createRelativePositionFromTypeIndex(pd.flow, index, -1) : null,
        block: $pos.depth ? { id: $pos.node(1).attrs.id, offset: $pos.parentOffset } : null,
      };
    };
    saved = { anchor: end(sel.$anchor), head: end(sel.$head) };
  };
  const onAfter = (t) => {
    if (t.origin !== LOCAL) { lastIntent = null; groupOpen = false; }
    if (!view) { bumpRecovery(); return; }
    if (t.origin === LOCAL) { saved = null; return; }
    render(t.origin === um);
  };
  const portMove = (tr, move) => {
    const result = moveBlocks({ pd, view, um, origins, render }, move);
    if (result.status === "refused") {
      stats.moveFallbacks = (stats.moveFallbacks ?? 0) + 1;
      return false;
    }
    const sel = tr.selection;
    if (sel instanceof pmState.TextSelection) return true;
    const doc = view.state.doc;
    let from = null, to = null;
    doc.forEach((node, pos) => {
      if (!move.ids.includes(node.attrs.id)) return;
      if (from === null) from = pos;
      to = pos + node.nodeSize;
    });
    if (from === null) return true;
    const next = sel instanceof pmState.NodeSelection
      ? pmState.NodeSelection.create(doc, from)
      : sel.anchor <= sel.head ? new BlockSelection(doc.resolve(from), doc.resolve(to)) : new BlockSelection(doc.resolve(to), doc.resolve(from));
    const reselect = view.state.tr.setSelection(next).setMeta(REMOTE_META, true).setMeta("addToHistory", false);
    view.dispatch(tr.scrolledIntoView ? reselect.scrollIntoView() : reselect);
    return true;
  };
  const board = createBoardCommands({ pd, um, origins, render: () => (view ? render() : refresh()) });
  pd.ydoc.on("beforeTransaction", onBefore);
  pd.ydoc.on("afterTransaction", onAfter);
  return {
    pd, stats, render, um, board,
    attach(v) {
      view = v;
      w = walk(pd);
    },
    dispose() {
      pd.ydoc.off("beforeTransaction", onBefore);
      pd.ydoc.off("afterTransaction", onAfter);
      offOrigins();
      origins.dispose();
      um.destroy();
      recoveryListeners.clear();
      view = null;
    },
    get walk() { return w; },
    get recoverable() { return recoveryState().recoverable; },
    get notices() { return recoveryState().notices; },
    subscribeRecovery(listener) {
      if (typeof listener !== "function") throw new TypeError("subscribeRecovery needs a listener");
      recoveryListeners.add(listener);
      const snapshot = recoveryState();
      if (recoverySignature === null) recoverySignature = recoverySignatureOf(snapshot);
      listener(snapshot);
      return () => { recoveryListeners.delete(listener); };
    },
    dismiss(sourceKey, revision) {
      dismissed.add(`${sourceKey}\u0000${revision}`);
      bumpRecovery();
    },
    dispatch(tr) {
      const move = tr.getMeta(MOVE);
      if (move && portMove(tr, move)) return;
      const { state, transactions } = view.state.applyTransaction(tr);
      const local = transactions.filter((t) => t.docChanged && !t.getMeta(REMOTE_META));
      view.updateState(state);
      if (!local.length) {
        if (transactions.some((t) => t.selectionSet && !t.getMeta(REMOTE_META))) {
          lastIntent = null;
          if (groupOpen) { um.stopCapturing(); groupOpen = false; }
        }
        return;
      }
      w = walk(pd);
      const history = transactions.every((t) => t.getMeta("addToHistory") !== false);
      const register = registerAuthor;
      registerAuthor = null;
      const intent = history ? intentOf(local, view) : null;
      const join = groupOpen && continuesGroup(lastIntent, intent);
      lastIntent = intent;
      joining = join;
      try {
        localGroup(pd, local, w, stats, um, history, register, { join, open: intent !== null });
      } finally {
        joining = false;
      }
      groupOpen = intent !== null;
      const derived = refresh();
      if (!sameBareShape(derived, view.state.doc)) {
        stats.mismatch++;
        stats.first ??= { before: bareShape(local[0].before), pm: bareShape(view.state.doc), y: bareShape(derived) };
      }
      render(false, derived);
    },
    // Restore inserts the displaced source as a normal block found by its Yjs identity, with no
    // provenance layer. Four edge cases are accepted because they are rare and lose no text
    // (David, 2026-10-21): two people restoring one source at once with different formatting
    // changes keep one person's formatting; undoing a Restore after a peer typed into it joins
    // the peer's text onto the previous block; a formatting-only change to a moved block is not
    // offered for recovery, only typed text is; a personal notice can name an author whose text
    // someone else removed later. The root fix is the provenance design this replaced
    // (e4-recovery-spec.md): keep each unit's original interval and each editor's independent
    // intentions per source, and re-expose the removed marker in place as a virtual position
    // instead of inserting a new block. Concurrent Restores then merge formatting intentions,
    // Undo re-hides exactly the restored units, a mark-only change becomes an intention the
    // list can offer, and a notice checks the surviving intervals before it names anyone.
    restore(sourceKey, revision) {
      const fresh = walk(pd, origins);
      const record = reduceRecovery(pd, { index: origins, walked: fresh }).sources.get(sourceKey);
      const visible = fresh.visible.find((seg) => seg.sourceKey === sourceKey || (seg.brk && physicalKeyOf(seg.brk) === sourceKey));
      if (visible) return { status: "resolved", id: visible.id };
      if (!record || record.revision !== revision) {
        const notice = recoveryState().notices.find((candidate) => candidate.source === sourceKey) ?? null;
        return { status: "stale", notice };
      }
      const blockId = `${RECOVERED_PREFIX}${sourceKey}`;
      um.stopCapturing();
      let marker = null;
      pd.ydoc.transact(() => {
        pd.gone.set(restoreKey(sourceKey, mintOp(pd)), { covers: record.removals.map((removal) => removal.key), baseline: { type: record.type, attrs: JSON.parse(JSON.stringify(record.attrs)) } });
        pd.flow.insertEmbed(restoreIndexAt(pd, sourceKey), { b: blockId });
        marker = newestLocalMarker(pd, blockId);
        origins.recordBoundary(marker, { blockId, kind: "restore", recoveryOf: sourceKey });
      }, LOCAL);
      um.stopCapturing();
      render();
      if (!w.visible.some((seg) => seg.sourceKey === sourceKey && seg.id === blockId)) throw new Error(`Restore did not project ${blockId}`);
      return { status: "restored", id: blockId };
    },
    moveBlocks(args) {
      return moveBlocks({ pd, view, um, origins, render }, args);
    },
    undo() { return um.undo() !== null; },
    redo() { return um.redo() !== null; },
  };
}
