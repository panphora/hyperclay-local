import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { attrKeys, defaultOf, sameJson, idKey, isHigh, isLow, mintOp } from "./layout.js";
import { markName, isCancel } from "./marks.js";
import { sameTok } from "./tokens.js";
import { removeKey, attrKey, textDeleteKey, recoveredSource } from "./recovery.js";
import { resolveTableFields, tableSeed, writeTable } from "./table.js";
import { resolveBoardFields, writeBoard } from "./board.js";
import { createOriginIndex } from "./origins.js";

export function setAttrs(pd, id, t, attrs) {
  let m = pd.attrs.get(id);
  if (!m) { m = new Y.Map(); pd.attrs.set(id, m); }
  const type = schema.nodes[t];
  const table = t === "table" && m.get("t") === "table" && !recoveredSource(id);
  const board = t === "board" && !recoveredSource(id);
  const before = table ? resolveTableFields(pd.tableFields, id, tableSeed(pd, id)) : board ? resolveBoardFields(pd.boardFields, id) : null;
  if (m.get("t") !== t) m.set("t", t);
  for (const k of attrKeys(type)) {
    if (table && (k === "rows" || k === "cols")) continue;
    if (board && (k === "columns" || k === "cards")) continue;
    const cur = m.has(k) ? m.get(k) : defaultOf(type, k);
    if (!sameJson(cur, attrs[k])) m.set(k, attrs[k]);
  }
  if (table) writeTable(pd, id, before, attrs);
  if (board) writeBoard(pd, id, before, attrs);
}

export function ctxAt(pd, yIdx) {
  const attrs = new Map();
  let left = yIdx;
  for (let it = pd.flow._start; it && left > 0; it = it.right) {
    if (it.deleted) continue;
    const c = it.content;
    if (c instanceof Y.ContentFormat) { if (c.value === null) attrs.delete(c.key); else attrs.set(c.key, c.value); }
    else if (it.countable) left -= it.length;
  }
  return attrs;
}

export function liveKeys(ctx) {
  const cancelled = new Set();
  for (const [k, v] of ctx) if (isCancel(k) && v) cancelled.add(k.split("!")[0]);
  const out = [];
  for (const [k, v] of ctx) if (!isCancel(k) && v !== null && v !== undefined && !cancelled.has(k) && schema.marks[markName(k)]) out.push([k, v]);
  return out;
}

export function runAttributes(pd, ctx, want) {
  const rid = mintOp(pd);
  const changes = {};
  const have = liveKeys(ctx);
  const kept = new Set();
  for (const [k, v] of have) {
    const n = markName(k);
    const w = want[n];
    if (w !== undefined && sameJson(w === true ? true : w, v)) kept.add(n);
    else changes[`${k}!${rid}`] = true;
  }
  for (const [n, w] of Object.entries(want)) if (!kept.has(n)) changes[`${n}~${mintOp(pd)}`] = w;
  if (!Object.keys(changes).length) return undefined;
  return { ...Object.fromEntries(ctx), ...changes };
}

export const CHUNK_CHARS = 2000;

export function chunksOf(toks) {
  const out = [];
  let cur = [], n = 0;
  for (let q = 0; q < toks.length; q++) {
    cur.push(toks[q]);
    n += 1;
    if (n >= CHUNK_CHARS && q + 1 < toks.length) {
      const t = toks[q];
      if (t.k === "c" && isHigh(t.ch.charCodeAt(0))) continue;
      out.push(cur);
      cur = [];
      n = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function insertTokens(pd, yIdx, toks, tx = (fn) => fn(), fences = null) {
  let i = yIdx;
  for (const part of chunksOf(toks)) tx(() => { i += insertChunk(pd, i, part, fences); });
  return i - yIdx;
}

const fenceAfter = (pd, yIdx, fences) => {
  if (!fences || !fences.length) return null;
  let left = yIdx, it = pd.flow._start;
  while (it && left > 0) {
    if (!it.deleted && it.countable) { if (left < it.length) return null; left -= it.length; }
    it = it.right;
  }
  for (; it && (it.deleted || !it.countable); it = it.right) {
    if (it.deleted && fences.some((f) => f.client === it.id.client && f.clock >= it.id.clock && f.clock < it.id.clock + it.length)) return it;
  }
  return null;
};

// Yjs places an insertion after every deleted item to its right. A hidden range that starts at a
// deleted item would then swallow text typed just before it, so the fence counts as live for the call.
const beforeFence = (pd, yIdx, fences, fn) => {
  const fence = fenceAfter(pd, yIdx, fences);
  if (!fence) return fn();
  fence.deleted = false;
  try { return fn(); } finally { fence.deleted = true; if (pd.flow._searchMarker) pd.flow._searchMarker.length = 0; }
};

function insertChunk(pd, yIdx, toks, fences = null) {
  let i = yIdx, run = "", runMk = null, runMa = null;
  const flush = () => {
    if (!run) return;
    const attrs = runAttributes(pd, ctxAt(pd, i), runMa ?? {});
    beforeFence(pd, i, fences, () => pd.flow.insert(i, run, attrs));
    i += run.length;
    run = "";
  };
  const embed = (e) => { const attrs = Object.fromEntries(ctxAt(pd, i)); beforeFence(pd, i, fences, () => pd.flow.insertEmbed(i, e, attrs)); i += 1; };
  for (const t of toks) {
    if (t.k === "c") { if (runMk !== null && t.mk !== runMk) flush(); runMk = t.mk; runMa = t.ma; run += t.ch; }
    else if (t.k === "h") { flush(); runMk = null; embed({ br: 1 }); }
    else {
      flush(); runMk = null;
      embed({ b: t.id });
      setAttrs(pd, t.id, t.t, t.attrs);
    }
  }
  flush();
  return i - yIdx;
}

const recordTextDeletes = (pd, ctx, from, to) => {
  let at = 0;
  for (let it = pd.flow._start; it && at < to; it = it.right) {
    if (it.deleted || !it.countable) continue;
    const start = at;
    at += it.length;
    if (at <= from) continue;
    if (it.content instanceof Y.ContentEmbed && it.content.embed?.b !== undefined) continue;
    const lo = Math.max(0, from - start);
    const hi = Math.min(it.length, to - start);
    if (hi <= lo) continue;
    pd.gone.set(textDeleteKey(it.id.client, it.id.clock + lo, ctx.operationId), { length: hi - lo, actor: pd.ydoc.clientID, sv: ctx.sv });
  }
};

export function deletePieces(pd, map, ranges, ctx = null) {
  for (let r = ranges.length - 1; r >= 0; r--) {
    const [ka, kb] = ranges[r];
    if (kb <= ka) continue;
    const spans = map.physicalRanges(ka, kb);
    for (let q = spans.length - 1; q >= 0; q--) {
      const [a, b] = spans[q];
      if (b <= a) continue;
      if (ctx) recordTextDeletes(pd, ctx, a, b);
      pd.flow.delete(a, b - a);
    }
  }
}

function nextDistinct(pd, sourceKey, blockId) {
  let seen = false;
  for (let it = pd.flow._start; it; it = it.right) {
    const key = idKey(it.id);
    if (key === sourceKey) { seen = true; continue; }
    if (!seen) continue;
    const embed = it.content instanceof Y.ContentEmbed ? it.content.embed : null;
    if (embed && embed.b !== undefined && embed.b !== blockId) return key;
  }
  return null;
}

export function applyRegion(ctx, ta, oldToks, newToks, oldSurvives = null) {
  const { pd, map, bt } = ctx;
  const survives = (j) => oldSurvives === null || oldSurvives[j];
  let p = 0;
  while (p < oldToks.length && p < newToks.length && sameTok(oldToks[p], newToks[p]) && survives(p)) p++;
  let s = 0;
  while (s < oldToks.length - p && s < newToks.length - p && sameTok(oldToks[oldToks.length - 1 - s], newToks[newToks.length - 1 - s]) && survives(oldToks.length - 1 - s)) s++;
  const charAt = (t) => (t && t.k === "c" ? t.ch.charCodeAt(0) : -1);
  if (p > 0 && isHigh(charAt(oldToks[p - 1])) && (isLow(charAt(oldToks[p])) || isLow(charAt(newToks[p])))) p--;
  if (s > 0 && isLow(charAt(oldToks[oldToks.length - s])) && (isHigh(charAt(oldToks[oldToks.length - s - 1])) || isHigh(charAt(newToks[newToks.length - s - 1])))) s--;
  const om = oldToks.slice(p, oldToks.length - s), nm = newToks.slice(p, newToks.length - s);
  const start = ta + p;
  const end = start + om.length;
  const obs = om.filter((t) => t.k === "b").map((t) => t.id).join(",");
  const sameBreaks = om.some((t) => t.k === "b") && obs === nm.filter((t) => t.k === "b").map((t) => t.id).join(",");
  if (!sameBreaks) {
    const origins = createOriginIndex(pd.origins);
    try {
      for (const t of om) {
        if (t.k !== "b" || !t.brk) continue;
        const source = origins.resolve(t.brk);
        if (!origins.boundaryOf(source)) ctx.tx(() => origins.recordBoundary(source, { blockId: t.id, kind: "removed" }));
      }
    } finally {
      origins.dispose();
    }
    const softAt = new Set();
    om.forEach((t, j) => {
      if (t.k !== "b" || !t.brk) return;
      const abs = start + j;
      let next = abs + 1;
      while (next < bt.length && bt[next].k !== "b") next++;
      const whole = next <= end && next !== abs + 1;
      const nextBrk = next < bt.length ? bt[next].brk : null;
      if (!whole) return;
      ctx.tx(() => pd.gone.set(removeKey(idKey(t.brk), ctx.operationId), { blockId: t.id, end: nextBrk ? idKey(nextBrk) : null, sv: ctx.sv }));
      softAt.add(abs);
    });
    const keep = [];
    let from = start;
    for (let q = start; q < end; q++) if (softAt.has(q)) { if (q > from) keep.push([from, q]); from = q + 1; }
    if (end > from) keep.push([from, end]);
    ctx.tx(() => deletePieces(pd, map, keep, om.some((t) => t.k === "b") ? null : ctx));
    const kept = new Set(nm.filter((t) => t.k === "b").map((t) => t.id));
    for (const t of om) {
      if (t.k !== "b" || !t.brk || kept.has(t.id)) continue;
      for (const key of ctx.copies.get(t.id) ?? []) {
        const removal = removeKey(key, ctx.operationId);
        if (!pd.gone.has(removal)) ctx.tx(() => pd.gone.set(removal, { blockId: t.id, end: nextDistinct(pd, key, t.id), sv: ctx.sv }));
      }
    }
    if (nm.length) insertTokens(pd, map.toPhysical(start, "before"), nm, ctx.tx, ctx.fences);
    return;
  }
  const dels = [];
  const inss = [];
  const attrs = [];
  let cursor = start, oi = 0, ni = 0;
  while (oi < om.length || ni < nm.length) {
    let ob = oi; while (ob < om.length && om[ob].k !== "b") ob++;
    let nb = ni; while (nb < nm.length && nm[nb].k !== "b") nb++;
    const o = om.slice(oi, ob), n = nm.slice(ni, nb);
    if (o.length) dels.push([cursor, cursor + o.length]);
    if (n.length) inss.push({ at: cursor, toks: n });
    cursor += o.length;
    if (ob < om.length) { attrs.push([om[ob], nm[nb]]); cursor += 1; }
    oi = ob + (ob < om.length ? 1 : 0); ni = nb + (nb < nm.length ? 1 : 0);
    if (ob >= om.length && nb >= nm.length) break;
  }
  const events = [...dels.map((d) => ({ at: d[0], d })), ...inss.map((i) => ({ at: i.at, i }))].sort((x, y) => y.at - x.at || (x.d ? -1 : 1));
  for (const e of events) {
    if (e.d) ctx.tx(() => deletePieces(pd, map, [e.d], ctx));
    else insertTokens(pd, map.toPhysical(e.at, "before"), e.i.toks, ctx.tx, ctx.fences);
  }
  for (const [ob, nb] of attrs) ctx.tx(() => {
    const source = ctx.recovered.get(ob.id);
    if (source) {
      if (ob.t !== nb.t) pd.gone.set(attrKey(source, "t"), nb.t);
      for (const kk of attrKeys(schema.nodes[nb.t])) {
        if (!sameJson(ob.attrs[kk], nb.attrs[kk])) pd.gone.set(attrKey(source, kk), nb.attrs[kk]);
      }
      return;
    }
    const base = ob.id;
    const m = pd.attrs.get(base);
    if (m) {
      const table = ob.t === "table" && nb.t === "table" && m.get("t") === "table";
      const board = nb.t === "board";
      const boardBefore = board ? (ob.t === "board" && m.get("t") === "board" ? ob.attrs : resolveBoardFields(pd.boardFields, base)) : null;
      if (ob.t !== nb.t) m.set("t", nb.t);
      for (const kk of attrKeys(schema.nodes[nb.t])) {
        if (table && (kk === "rows" || kk === "cols")) continue;
        if (board && (kk === "columns" || kk === "cards")) continue;
        const cur = m.has(kk) ? m.get(kk) : defaultOf(schema.nodes[nb.t], kk);
        if (!sameJson(cur, nb.attrs[kk])) m.set(kk, nb.attrs[kk]);
      }
      if (table) writeTable(pd, base, ob.attrs, nb.attrs);
      if (board) writeBoard(pd, base, boardBefore, nb.attrs);
    } else setAttrs(pd, base, nb.t, nb.attrs);
  });
}

export function markRange(ctx, a, b, name, val, toks) {
  const { pd, map } = ctx;
  const op = `${name}~${mintOp(pd)}`;
  const rid = mintOp(pd);
  let i = a;
  while (i < b) {
    if (toks[i].k !== "c") { i++; continue; }
    let j = i; while (j < b && toks[j].k === "c") j++;
    const spans = map.physicalRanges(i, j);
    if (val !== null) for (const [ya, yb] of spans) pd.flow.format(ya, yb - ya, { [op]: val });
    else {
      let pos = 0;
      for (const part of pd.flow.toDelta()) {
        const len = typeof part.insert === "string" ? part.insert.length : 1;
        for (const [ya, yb] of spans) {
          if (pos >= yb) break;
          const s0 = Math.max(pos, ya), e0 = Math.min(pos + len, yb);
          if (e0 > s0 && part.attributes) {
            const clear = {};
            for (const [kk, v] of Object.entries(part.attributes)) if (markName(kk) === name && !isCancel(kk) && v !== null) clear[`${kk}!${rid}`] = true;
            if (Object.keys(clear).length) pd.flow.format(s0, e0 - s0, clear);
          }
        }
        pos += len;
      }
    }
    i = j;
  }
}
