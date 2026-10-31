import * as Y from "../../vendor/yjs.vendor.js";
import { LOCAL, REMOTE_META, mintOp } from "./layout.js";
import { state as pmState } from "../../vendor/prosemirror.vendor.js";
import { walk } from "./walk.js";
import { docOf } from "./doc.js";
import { createProjectionMap } from "./projection-map.js";
import { beforeFence } from "./writer.js";
import { unitIds } from "./origins.js";
import { attrKey, copyActiveKey, parseGoneIntents, physicalKeyOf, recoveredRoot, removeKey, restoreKey } from "./recovery.js";

const refuse = (code) => ({ status: "refused", code });

const attrsKey = (attrs) => {
  if (!attrs) return "";
  const out = [];
  for (const key of Object.keys(attrs).sort()) out.push(`${key}=${JSON.stringify(attrs[key])}`);
  return out.join("\n");
};

const visibleBlocks = (pd, current, view) => {
  const doc = view ? view.state.doc : null;
  const settled = doc && doc.childCount === current.visible.length && current.visible.every((seg, index) => doc.child(index).attrs.id === seg.id);
  const source = settled ? doc : docOf(pd, current);
  const out = [];
  source.forEach((node) => {
    if (node.attrs.id === null || node.attrs.id === undefined) return;
    out.push({ id: node.attrs.id, parent: node.attrs.parent ?? null, t: node.type.name });
  });
  return out;
};

const ancestors = (byId, id) => {
  const out = [];
  let cur = byId.get(id)?.parent ?? null;
  let guard = 0;
  while (cur !== null && cur !== undefined && guard++ <= byId.size) {
    out.push(cur);
    cur = byId.get(cur)?.parent ?? null;
  }
  return out;
};

const isAncestor = (byId, ancestor, id) => ancestors(byId, id).includes(ancestor);
const inSubtree = (byId, id, root) => id === root || isAncestor(byId, root, id);

const setAttr = (pd, seg, id, field, value) => {
  if (seg?.recovered) {
    const key = attrKey(seg.sourceKey, field);
    if ((pd.gone.has(key) ? pd.gone.get(key) : seg.fields?.[field] ?? null) !== value) pd.gone.set(key, value);
    return;
  }
  let map = pd.attrs.get(id);
  if (!map) { map = new Y.Map(); pd.attrs.set(id, map); }
  if (map.get(field) !== value) map.set(field, value);
};

const setParent = (pd, seg, id, parent) => setAttr(pd, seg, id, "parent", parent);

const MAX_INDENT = 8;
const ATTR_RULES = {
  indent: (value, block) => block.t === "list_item" && Number.isInteger(value) && value >= 0 && value <= MAX_INDENT,
  open: (value, block) => block.t === "toggle" && typeof value === "boolean",
  parent: (value, block, byId) => value === null || (typeof value === "string" && byId.get(value)?.t === "toggle" && !inSubtree(byId, value, block.id)),
};

const attrChanges = (args, byId) => {
  if (args?.attrs === undefined) return [];
  if (!args.attrs || typeof args.attrs !== "object" || Array.isArray(args.attrs)) return null;
  const out = [];
  for (const [id, fields] of Object.entries(args.attrs)) {
    const block = byId.get(id);
    if (!block || !fields || typeof fields !== "object" || Array.isArray(fields)) return null;
    for (const [field, value] of Object.entries(fields)) {
      if (!ATTR_RULES[field] || !ATTR_RULES[field](value, block, byId)) return null;
      out.push({ id, field, value });
    }
  }
  return out;
};

const flowUnits = (pd, origins) => {
  const ids = unitIds(pd.flow, 0, pd.flow.length);
  const out = [];
  let at = 0;
  for (const part of pd.flow.toDelta()) {
    const attrs = part.attributes;
    if (typeof part.insert === "string") {
      for (let i = 0; i < part.insert.length; i++) out.push({ ch: part.insert[i], attrs, source: origins.resolve(ids[at++]) });
    } else out.push({ embed: part.insert, attrs, source: origins.resolve(ids[at++]) });
  }
  if (at !== ids.length) throw new Error(`The flow delta has ${at} units but the document has ${ids.length}`);
  return out;
};

const liveRemovals = (pd, current, selected) => {
  const observed = new Map();
  for (const seg of current.visible) if (selected.has(seg.id) && seg.brk) observed.set(physicalKeyOf(seg.brk), seg.id);
  for (const id of selected) for (const key of current.copies.get(id) ?? []) observed.set(key, id);
  const out = [];
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.deleted || !(it.content instanceof Y.ContentEmbed)) continue;
    const id = it.content.embed?.b;
    if (id === undefined || observed.get(physicalKeyOf(it.id)) !== id) continue;
    let end = null;
    for (let next = it.right; next; next = next.right) {
      if (next.deleted || !(next.content instanceof Y.ContentEmbed)) continue;
      const other = next.content.embed?.b;
      if (other === undefined || other === id) continue;
      end = physicalKeyOf(next.id);
      break;
    }
    out.push({ key: physicalKeyOf(it.id), blockId: id, end });
  }
  return out;
};

export function moveBlocks({ pd, view, um, origins, render }, args = {}) {
  const ids = Array.isArray(args?.ids) ? [...new Set(args.ids)] : [];
  const afterId = args?.afterId === undefined ? null : args.afterId;
  const hasParent = args?.parent !== undefined;

  const current = walk(pd, origins);
  // An opaque block is an operation this runtime must refuse before writing: it
  // has no turn-into, it cannot be carried, and its record is never rewritten.
  const protectedIds = new Set(current.visible.filter((seg) => seg.opaque).map((seg) => seg.id));
  const list = visibleBlocks(pd, current, view);
  const byId = new Map(list.map((block) => [block.id, block]));
  const order = list.map((block) => block.id);

  if (!ids.length) return refuse("missing-source");
  for (const id of ids) if (!byId.has(id)) return refuse("missing-source");
  const changes = attrChanges(args, byId);
  if (!changes) return refuse("invalid-attrs");
  const parentChanges = changes.filter((change) => change.field === "parent");

  const roots = new Set(ids.filter((id) => !ids.some((other) => other !== id && isAncestor(byId, other, id))));
  const selected = list.filter((block) => ids.some((root) => inSubtree(byId, block.id, root)));
  const selectedSet = new Set(selected.map((block) => block.id));
  if (selected.some((block) => protectedIds.has(block.id)) || changes.some((change) => protectedIds.has(change.id))) return refuse("unsupported-format");

  const segments = new Map(current.visible.map((seg) => [seg.id, seg]));
  for (const block of selected) {
    const seg = segments.get(block.id);
    if (!seg || seg.implicit || !seg.brk) return refuse("missing-source");
  }

  let parent;
  if (hasParent) parent = args.parent ?? null;
  else {
    const parents = new Set(selected.filter((block) => roots.has(block.id)).map((block) => block.parent));
    if (parents.size !== 1) return refuse("invalid-parent");
    parent = [...parents][0];
  }
  if (hasParent && parent !== null) {
    const node = byId.get(parent);
    if (!node || node.t !== "toggle") return refuse("invalid-parent");
    if (selectedSet.has(parent)) return refuse("cycle");
  }
  if (afterId !== null) {
    if (typeof afterId !== "string" || !byId.has(afterId)) return refuse("missing-destination");
    if (selectedSet.has(afterId)) return refuse("cycle");
    if (byId.get(afterId).parent !== parent) return refuse("missing-destination");
  }

  const remaining = list.filter((block) => !selectedSet.has(block.id));
  let insertAt = 0;
  if (afterId === null) {
    if (parent !== null) {
      const first = remaining.findIndex((block) => block.parent === parent);
      const own = remaining.findIndex((block) => block.id === parent);
      insertAt = first >= 0 ? first : own < 0 ? 0 : own + 1;
    }
  } else {
    insertAt = remaining.findIndex((block) => block.id === afterId) + 1;
    while (insertAt < remaining.length && inSubtree(byId, remaining[insertAt].id, afterId)) insertAt++;
  }

  const desired = [...remaining.slice(0, insertAt), ...selected, ...remaining.slice(insertAt)];
  const sameOrder = desired.length === order.length && desired.every((block, index) => block.id === order[index]);
  const movedRoots = selected.filter((block) => roots.has(block.id) && block.parent !== parent);
  const movedIds = selected.map((block) => block.id);
  if (sameOrder && !movedRoots.length && !changes.length) return { status: "unchanged" };

  const caret = (() => {
    const sel = view?.state.selection;
    if (!(sel instanceof pmState.TextSelection)) return null;
    const at = (pos) => { const $pos = view.state.doc.resolve(pos); return $pos.depth ? { id: $pos.node(1).attrs.id, offset: $pos.parentOffset } : null; };
    const anchor = at(sel.anchor), head = at(sel.head);
    return anchor && head && (selectedSet.has(anchor.id) || selectedSet.has(head.id)) ? { anchor, head } : null;
  })();
  const restoreCaret = () => {
    if (!caret || !view) return;
    const place = ({ id, offset }) => {
      let found = null;
      view.state.doc.forEach((node, pos) => { if (found === null && node.attrs.id === id) found = pos + 1 + Math.min(offset, node.content.size); });
      return found;
    };
    const anchor = place(caret.anchor), head = place(caret.head);
    if (anchor !== null && head !== null) view.dispatch(view.state.tr.setSelection(pmState.TextSelection.create(view.state.doc, anchor, head)).setMeta(REMOTE_META, true).setMeta("addToHistory", false));
  };
  if (sameOrder) {
    um?.stopCapturing();
    pd.ydoc.transact(() => {
      if (parentChanges.length) for (const change of parentChanges) setParent(pd, segments.get(change.id), change.id, change.value);
      else for (const block of movedRoots) setParent(pd, segments.get(block.id), block.id, parent);
      for (const change of changes) if (change.field !== "parent") setAttr(pd, segments.get(change.id), change.id, change.field, change.value);
    }, LOCAL);
    um?.stopCapturing();
    render();
    restoreCaret();
    return { status: "moved", ids: movedIds };
  }

  const sv = [...Y.decodeStateVector(Y.encodeStateVector(pd.ydoc)).entries()].sort((left, right) => left[0] - right[0]);
  const operationId = mintOp(pd);
  const units = flowUnits(pd, origins);
  const before = createProjectionMap(current, pd.flow.length);
  const captured = [];
  let cursor = 0;
  for (const seg of current.visible) {
    if (selectedSet.has(seg.id)) {
      const block = [];
      for (const [from, to] of before.physicalRanges(cursor, cursor + seg.len)) for (let unit = from; unit < to; unit++) block.push(units[unit]);
      captured.push({ seg, units: block });
    }
    cursor += seg.len;
  }
  for (let index = 0; index < captured.length; index++) {
    const block = captured[index];
    if (block.seg.id !== movedIds[index]) throw new Error(`Captured ${block.seg.id} where ${movedIds[index]} was expected`);
    if (!block.units.length || block.units[0].embed === undefined || block.units[0].embed.b !== block.seg.id) throw new Error(`The selected block ${block.seg.id} has no physical marker to copy`);
  }

  const removals = liveRemovals(pd, current, selectedSet);
  const intents = parseGoneIntents(pd.gone);
  const promotions = new Map();
  for (const block of selected) {
    const seg = segments.get(block.id);
    if (!seg.recovered) continue;
    const removalsOf = current.removals.filter((removal) => removal.sourceKey === seg.sourceKey);
    const winner = recoveredRoot(seg.sourceKey, removalsOf, intents);
    const baseline = intents.restores.find((restore) => restore.key === winner?.key)?.baseline ?? { type: seg.t, attrs: seg.fields ?? {} };
    promotions.set(seg.sourceKey, { covers: removalsOf.map((removal) => removal.key), baseline: JSON.parse(JSON.stringify(baseline)) });
  }
  if (!removals.length) throw new Error("The selected blocks have no live physical markers to retire");

  um?.stopCapturing();
  pd.ydoc.transact(() => {
    for (const removal of removals) pd.gone.set(removeKey(removal.key, operationId), { blockId: removal.blockId, end: removal.end, sv });

    const after = walk(pd, origins);
    const map = createProjectionMap(after, pd.flow.length);
    const afterIds = after.visible.map((seg) => seg.id);
    let index = 0;
    if (insertAt > 0) {
      const found = afterIds.indexOf(remaining[insertAt - 1].id);
      index = found < 0 ? 0 : found + 1;
    }
    let position = 0;
    for (let i = 0; i < index; i++) position += after.visible[i].len;
    let cursor = map.toPhysical(position, "before");
    const spans = [];
    for (const block of captured) {
      const start = cursor;
      let text = null, textAttrs = null;
      const flush = () => {
        if (text === null) return;
        beforeFence(pd, cursor, after.fences, () => pd.flow.insert(cursor, text, textAttrs ?? undefined));
        cursor += text.length;
        text = null;
      };
      for (const unit of block.units) {
        if (unit.ch !== undefined) {
          if (text !== null && attrsKey(unit.attrs) !== attrsKey(textAttrs)) flush();
          if (text === null) { text = ""; textAttrs = unit.attrs; }
          text += unit.ch;
        } else {
          flush();
          beforeFence(pd, cursor, after.fences, () => pd.flow.insertEmbed(cursor, unit.embed, unit.attrs));
          cursor += 1;
        }
      }
      flush();
      const dest = unitIds(pd.flow, start, cursor);
      if (dest.length !== block.units.length) throw new Error(`Copied ${block.seg.id} as ${dest.length} units instead of ${block.units.length}`);
      for (let i = 1; i < block.units.length; i++) spans.push({ dest: dest[i], source: block.units[i].source });
      origins.recordBoundary(dest[0], block.seg.recovered ? { blockId: block.seg.id, kind: "copy", recoveryOf: block.seg.sourceKey } : { blockId: block.seg.id, kind: "copy" });
      if (block.seg.recovered) pd.gone.set(restoreKey(block.seg.sourceKey, operationId), promotions.get(block.seg.sourceKey));
      pd.gone.set(copyActiveKey(physicalKeyOf(dest[0])), true);
    }
    if (spans.length) origins.recordSpans(spans);
    if (parentChanges.length) for (const change of parentChanges) setParent(pd, segments.get(change.id), change.id, change.value);
    else for (const block of movedRoots) setParent(pd, segments.get(block.id), block.id, parent);
    for (const change of changes) if (change.field !== "parent") setAttr(pd, segments.get(change.id), change.id, change.field, change.value);
  }, LOCAL);
  um?.stopCapturing();
  render();
  restoreCaret();
  return { status: "moved", ids: movedIds };
}
