import * as Y from "../../vendor/yjs.vendor.js";
import { transform } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { insideTextblocks } from "../model.js";
import { LOCAL, HISTORY_META, attrKeys, defaultOf, mintId, mintOp } from "./layout.js";
import { tokensOf, tokenIndex, textTokenRange, projectionOf, yAfter, sameTok } from "./tokens.js";
import { CHUNK_CHARS, insertTokens, applyRegion, markRange } from "./writer.js";
import { walk } from "./walk.js";
import { isOpaque, yjsFields } from "../format-codec.js";

const { AddMarkStep, RemoveMarkStep, AttrStep, ReplaceStep, Mapping } = transform;

const tableRange = (doc, from, to) => {
  const start = doc.resolve(from), end = doc.resolve(to);
  return [
    start.depth && start.node(1).type.name === "table" ? start.before(1) : from,
    end.depth && end.node(1).type.name === "table" ? end.after(1) : to,
  ];
};

const touchesTable = (doc, from, to) => {
  let found = false;
  doc.nodesBetween(from, to, (node) => { if (node.type.name === "table") found = true; return !found && node.type.name !== "table"; });
  return found;
};

export function localGroup(pd, transactions, w, stats, um = null, history = true, onFirstWrite = null, { join = false, open = false } = {}) {
  const first = () => { if (onFirstWrite) { const fn = onFirstWrite; onFirstWrite = null; fn(); } };
  const steps = [], docs = [], maps = [];
  for (const tr of transactions) tr.steps.forEach((s, i) => { steps.push(s); docs.push(tr.docs[i]); maps.push(s.getMap()); });
  if (!steps.length) return;
  const mapping = new Mapping(maps);
  const sv = [...Y.decodeStateVector(Y.encodeStateVector(pd.ydoc)).entries()].sort((a, b) => a[0] - b[0]);
  const operationId = mintOp(pd);
  const d0 = docs[0], dm = transactions[transactions.length - 1].doc;
  const visible = w.visible.length === 0 && d0.childCount === 1 && d0.firstChild.type.name === "paragraph"
    ? [{ id: d0.firstChild.attrs.id, implicit: true, t: "paragraph", len: 0 }]
    : w.visible;
  const alias = new Map();
  const implicit = [];
  { let tok = 0; visible.forEach((s) => { if (s.implicit) implicit.push({ tok, id: s.id, t: s.t }); tok += s.len; }); }
  implicit.sort((a, b) => b.tok - a.tok);
  for (const m of implicit) { m.alias = mintId(pd); alias.set(m.id, m.alias); }
  const holes = alias.size ? w.holes.map((h) => ({ at: h.at + implicit.filter((m) => m.tok < h.at).length, len: h.len })) : w.holes;
  const projection = projectionOf(w.tokens + alias.size, holes, pd.flow.length + alias.size);
  const regions = [];
  const markSteps = [];
  steps.forEach((step, i) => {
    const mark = step instanceof AddMarkStep || step instanceof RemoveMarkStep;
    if (mark && !touchesTable(docs[i], step.from, step.to)) { markSteps.push({ i, step }); return; }
    const back = new Mapping(maps.slice(0, i)).invert();
    const fwd = new Mapping(maps.slice(i + 1));
    const ranges = [];
    if (step instanceof AttrStep) ranges.push([step.pos, step.pos + 1, step.pos, step.pos + 1]);
    else if (mark) ranges.push([step.from, step.to, step.from, step.to]);
    else step.getMap().forEach((os, oe, ns, ne) => ranges.push([os, oe, ns, ne]));
    for (const [os, oe, ns, ne] of ranges) {
      const [oa, ob] = tableRange(d0, back.map(os, -1), back.map(oe, 1));
      const [na, nb] = tableRange(dm, fwd.map(ns, -1), fwd.map(ne, 1));
      regions.push({ oa, ob, na, nb });
    }
  });
  regions.sort((x, y) => x.oa - y.oa || x.na - y.na);
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && (r.oa <= last.ob || r.na <= last.nb)) { last.ob = Math.max(last.ob, r.ob); last.nb = Math.max(last.nb, r.nb); }
    else merged.push({ ...r });
  }
  const regional = !implicit.length && !markSteps.length && steps.every((step) => step instanceof ReplaceStep) && transactions.every(insideTextblocks);
  const ia = regional ? null : tokenIndex(d0, alias, visible);
  const ib = regional ? null : tokenIndex(dm, alias, visible);
  const bt = regional ? [] : tokensOf(d0, alias, visible);
  const at = regional ? [] : tokensOf(dm, alias, visible);
  const pieces = regional ? merged.map((r) => ({ r, old: textTokenRange(d0, r.oa, r.ob), next: textTokenRange(dm, r.na, r.nb) })) : null;
  const span = regional ? pieces.reduce((n, p) => n + p.next.end - p.next.start, 0) : merged.reduce((n, r) => n + (ib[r.nb] - ib[r.na]), 0);
  const chunked = span > CHUNK_CHARS;
  const tx = chunked ? (fn) => pd.ydoc.transact((tr) => { tr.meta.set(HISTORY_META, history); first(); fn(); }, LOCAL) : (fn) => fn();
  const ctx = { pd, map: projection, bt, tx, copies: w.copies, fences: w.fences, sv, operationId, recovered: new Map(w.visible.filter((seg) => seg.recovered).map((seg) => [seg.id, seg.sourceKey])) };
  const sig = (toks) => toks.filter((t) => t.k === "b").map((t) => `${t.id}|${t.t}|${JSON.stringify(t.attrs)}`).join("\n");
  const structural = !regional && (markSteps.length > 0 || sig(bt) !== sig(at));
  const write = () => {
    for (const m of implicit) {
      insertTokens(pd, yAfter(w.holes, m.tok), [{ k: "b", id: m.alias, t: m.t, attrs: Object.fromEntries(attrKeys(schema.nodes[m.t]).map((kk) => [kk, defaultOf(schema.nodes[m.t], kk)])) }], tx);
    }
    for (let q = merged.length - 1; q >= 0; q--) {
      if (regional) {
        const { r, old, next } = pieces[q];
        const oldSurvives = old.tokens.map((token, j) => {
          const left = mapping.mapResult(r.oa + j, 1);
          const right = mapping.mapResult(r.oa + j + 1, -1);
          const k = left.pos - r.na;
          return !left.deleted && !right.deleted && right.pos === left.pos + 1 && k >= 0 && k < next.tokens.length && sameTok(token, next.tokens[k]);
        });
        applyRegion(ctx, old.start, old.tokens, next.tokens, oldSurvives);
      } else {
        const r = merged[q];
        const ta = ia[r.oa], tb = ia[r.ob];
        applyRegion(ctx, ta, bt.slice(ta, tb), at.slice(ib[r.na], ib[r.nb]));
      }
    }
    const markWalk = markSteps.length ? walk(pd) : null;
    const markCtx = markWalk ? { ...ctx, map: projectionOf(markWalk.tokens, markWalk.holes, pd.flow.length) } : null;
    for (const { i, step } of markSteps) {
      const fwd = new Mapping(maps.slice(i + 1));
      const from = ib[fwd.map(step.from, 1)], to = ib[fwd.map(step.to, -1)];
      if (to <= from) continue;
      const name = step.mark.type.name;
      const val = step instanceof AddMarkStep ? (step.mark.attrs && Object.keys(step.mark.attrs).length ? { ...step.mark.attrs } : true) : null;
      // An opaque mark is not a live key: adding it writes each descriptor it
      // carries, and removing it erases nothing the command cannot understand.
      if (isOpaque(step.mark)) {
        if (val === null) continue;
        const fields = yjsFields(step.mark.attrs.entries);
        tx(() => { for (const [key, value] of Object.entries(fields)) markRange(markCtx, from, to, key, value, at); });
        continue;
      }
      tx(() => markRange(markCtx, from, to, name, val, at));
    }
  };
  if (!join) um?.stopCapturing();
  const timeout = um?.captureTimeout;
  if (um) um.captureTimeout = Infinity;
  try {
    if (chunked) write();
    else pd.ydoc.transact((tr) => { tr.meta.set(HISTORY_META, history); first(); write(); }, LOCAL);
  } finally {
    if (um) um.captureTimeout = timeout;
    if (!open) um?.stopCapturing();
  }
  stats.groups++;
  stats.lastGroup = { chunked, structural, regional, span };
}
