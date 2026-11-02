import { outline, structureFixes, moveIntent, moveSpanTr, BlockSelection, MAX_INDENT, MOVE } from "./blocks.js";
import { schema } from "./schema.js";

const N = schema.nodes;
const isList = (n) => n.type === N.list_item;
const isToggle = (n) => n.type === N.toggle;
const parentOf = (n) => n.attrs.parent ?? null;

function chainAfter(ents, byId, k) {
  if (k < 0) return [null];
  const chain = [];
  const n = ents[k].node;
  if (isToggle(n) && n.attrs.open && !ents[k].hidden) chain.unshift(n.attrs.id);
  for (let p = parentOf(n); p !== null && !chain.includes(p);) {
    const e = ents[byId.get(p)];
    if (!e) break;
    chain.unshift(p);
    p = parentOf(e.node);
  }
  const out = [null];
  for (const id of chain) {
    const e = ents[byId.get(id)];
    if (!e.node.attrs.open || e.hidden) break;
    out.push(id);
  }
  return out;
}

export function spanAttrs(ents, lo, hi, target) {
  const rootParent = parentOf(ents[lo].node);
  const delta = isList(ents[lo].node) ? target.indent - ents[lo].node.attrs.indent : 0;
  return (e) => {
    if (e.i < lo || e.i > hi || parentOf(e.node) !== rootParent) return null;
    return isList(e.node) ? { parent: target.parent, indent: e.node.attrs.indent + delta } : { parent: target.parent };
  };
}

function openToggle(tr, id) {
  let hit = null;
  tr.doc.forEach((n, off) => { if (n.attrs.id === id && isToggle(n)) hit = { n, off }; });
  if (hit && !hit.n.attrs.open) tr.setNodeMarkup(hit.off, null, { ...hit.n.attrs, open: true });
}

export function moveSpanTo(st, ents, lo, hi, target, sel = null) {
  const attrs = spanAttrs(ents, lo, hi, target);
  const from = ents[lo].at, to = ents[hi].end;
  const pick = sel ?? new BlockSelection(st.doc.resolve(from), st.doc.resolve(to));
  let tr;
  if (target.at === from || target.at === to) {
    tr = st.tr;
    for (let k = lo; k <= hi; k++) {
      const c = attrs(ents[k]);
      if (c) tr.setNodeMarkup(ents[k].at, null, { ...ents[k].node.attrs, ...c });
    }
    tr.setSelection(pick.map(tr.doc, tr.mapping));
    tr.setMeta(MOVE, moveIntent(ents, lo, hi, target.at, attrs));
  } else {
    tr = moveSpanTr(st, ents, lo, hi, target.at, attrs, pick);
  }
  if (target.open) {
    openToggle(tr, target.open);
    const move = tr.getMeta(MOVE);
    if (move) tr.setMeta(MOVE, { ...move, attrs: { ...move.attrs, [target.open]: { open: true } } });
  }
  return tr;
}

function legal(st, ents, lo, hi, target) {
  if (target.parent != null && ents.slice(lo, hi + 1).some((e) => e.node.attrs.id === target.parent)) return false;
  const size = ents[hi].end - ents[lo].at;
  const attrs = spanAttrs(ents, lo, hi, target);
  for (let k = lo; k <= hi; k++) if (isList(ents[k].node) && (attrs(ents[k])?.indent ?? ents[k].node.attrs.indent) > MAX_INDENT) return false;
  const tr = moveSpanTo(st, ents, lo, hi, target);
  const inPlace = target.at === ents[lo].at || target.at === ents[hi].end;
  const at = inPlace ? ents[lo].at : target.at > ents[lo].at ? target.at - size : target.at;
  return structureFixes(tr.doc, st.doc).every((f) => f.at >= at && f.at < at + size);
}

export function gapTargets(st, ents, lo, hi, next) {
  const byId = new Map();
  ents.forEach((e) => { if (isToggle(e.node) && e.node.attrs.id) byId.set(e.node.attrs.id, e.i); });
  const at = next < 0 ? st.doc.content.size : ents[next].at;
  if (at > ents[lo].at && at < ents[hi].end) return [];
  const k = (next < 0 ? ents.length : next) - 1;
  const chain = chainAfter(ents, byId, k);
  const start = chain.indexOf(next < 0 ? null : parentOf(ents[next].node));
  const out = [];
  for (const parent of chain.slice(Math.max(0, start))) {
    const base = parent === null ? 0 : ents[byId.get(parent)].depth + 1;
    const prev = k >= 0 && isList(ents[k].node) && parentOf(ents[k].node) === parent ? ents[k].node : null;
    const top = isList(ents[lo].node) ? (prev ? prev.attrs.indent + 1 : 0) : 0;
    for (let indent = 0; indent <= top; indent++) {
      const t = { at, parent, indent, depth: base + (isList(ents[lo].node) ? indent : 0) };
      if (legal(st, ents, lo, hi, t)) out.push(t);
    }
  }
  return out;
}

export function summaryTarget(st, ents, lo, hi, i) {
  const e = ents[i];
  if (!e || !isToggle(e.node) || e.node.attrs.open || e.hidden || (i >= lo && i <= hi)) return null;
  if (e.at > ents[lo].at && e.at < ents[hi].end) return null;
  const id = e.node.attrs.id;
  const target = { at: ents[e.subEnd].end, parent: id, indent: 0, depth: e.depth + 1, open: id };
  return legal(st, ents, lo, hi, target) ? target : null;
}

export function pickTarget(targets, depth) {
  let best = null;
  for (const t of targets) if (!best || Math.abs(t.depth - depth) < Math.abs(best.depth - depth)) best = t;
  return best;
}
