import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { attrKeys, defaultOf, sameJson, idKey, isHigh, isLow, mintOp } from "./layout.js";
import { markName, isCancel } from "./marks.js";
import { sameTok, yAfter, yBefore } from "./tokens.js";

export function setAttrs(pd, id, t, attrs) {
  let m = pd.attrs.get(id);
  if (!m) { m = new Y.Map(); pd.attrs.set(id, m); }
  const type = schema.nodes[t];
  if (m.get("t") !== t) m.set("t", t);
  for (const k of attrKeys(type)) {
    const cur = m.has(k) ? m.get(k) : defaultOf(type, k);
    if (!sameJson(cur, attrs[k])) m.set(k, attrs[k]);
  }
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

export function insertTokens(pd, yIdx, toks, tx = (fn) => fn()) {
  let i = yIdx;
  for (const part of chunksOf(toks)) tx(() => { i += insertChunk(pd, i, part); });
  return i - yIdx;
}

function insertChunk(pd, yIdx, toks) {
  let i = yIdx, run = "", runMk = null, runMa = null;
  const flush = () => {
    if (!run) return;
    pd.flow.insert(i, run, runAttributes(pd, ctxAt(pd, i), runMa ?? {}));
    i += run.length;
    run = "";
  };
  const embed = (e) => { pd.flow.insertEmbed(i, e, Object.fromEntries(ctxAt(pd, i))); i += 1; };
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

export function deletePieces(pd, holes, ranges) {
  for (let r = ranges.length - 1; r >= 0; r--) {
    const [ka, kb] = ranges[r];
    if (kb <= ka) continue;
    const inner = holes.filter((h) => h.at > ka && h.at < kb);
    const pieces = [];
    let from = ka;
    for (const h of inner) { pieces.push([from, h.at]); from = h.at; }
    pieces.push([from, kb]);
    for (let q = pieces.length - 1; q >= 0; q--) {
      const [a, b] = pieces[q];
      if (b > a) pd.flow.delete(yAfter(holes, a), b - a);
    }
  }
}

export function applyRegion(ctx, ta, oldToks, newToks) {
  const { pd, holes, bt } = ctx;
  let p = 0;
  while (p < oldToks.length && p < newToks.length && sameTok(oldToks[p], newToks[p])) p++;
  let s = 0;
  while (s < oldToks.length - p && s < newToks.length - p && sameTok(oldToks[oldToks.length - 1 - s], newToks[newToks.length - 1 - s])) s++;
  const charAt = (t) => (t && t.k === "c" ? t.ch.charCodeAt(0) : -1);
  if (p > 0 && isHigh(charAt(oldToks[p - 1])) && (isLow(charAt(oldToks[p])) || isLow(charAt(newToks[p])))) p--;
  if (s > 0 && isLow(charAt(oldToks[oldToks.length - s])) && (isHigh(charAt(oldToks[oldToks.length - s - 1])) || isHigh(charAt(newToks[newToks.length - s - 1])))) s--;
  const om = oldToks.slice(p, oldToks.length - s), nm = newToks.slice(p, newToks.length - s);
  const start = ta + p;
  const end = start + om.length;
  const obs = om.filter((t) => t.k === "b").map((t) => t.id).join(",");
  const sameBreaks = om.some((t) => t.k === "b") && obs === nm.filter((t) => t.k === "b").map((t) => t.id).join(",");
  if (!sameBreaks) {
    const softAt = new Set();
    om.forEach((t, j) => {
      if (t.k !== "b" || !t.brk) return;
      const abs = start + j;
      let next = abs + 1;
      while (next < bt.length && bt[next].k !== "b") next++;
      const whole = next <= end && next !== abs + 1;
      const nextBrk = next < bt.length ? bt[next].brk : null;
      if (!whole) return;
      ctx.tx(() => pd.gone.set(idKey(t.brk), { b: t.id, e: nextBrk ? idKey(nextBrk) : null }));
      softAt.add(abs);
    });
    const keep = [];
    let from = start;
    for (let q = start; q < end; q++) if (softAt.has(q)) { if (q > from) keep.push([from, q]); from = q + 1; }
    if (end > from) keep.push([from, end]);
    ctx.tx(() => deletePieces(pd, holes, keep));
    if (nm.length) insertTokens(pd, yBefore(holes, start), nm, ctx.tx);
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
    if (e.d) ctx.tx(() => deletePieces(pd, holes, [e.d]));
    else insertTokens(pd, yBefore(holes, e.at), e.i.toks, ctx.tx);
  }
  for (const [ob, nb] of attrs) ctx.tx(() => {
    const base = ob.id;
    const m = pd.attrs.get(base);
    if (m) {
      if (ob.t !== nb.t) m.set("t", nb.t);
      for (const kk of attrKeys(schema.nodes[nb.t])) { const cur = m.has(kk) ? m.get(kk) : defaultOf(schema.nodes[nb.t], kk); if (!sameJson(cur, nb.attrs[kk])) m.set(kk, nb.attrs[kk]); }
    } else setAttrs(pd, base, nb.t, nb.attrs);
  });
}

export function markRange(ctx, a, b, name, val, toks) {
  const { pd, holes } = ctx;
  const op = `${name}~${mintOp(pd)}`;
  const rid = mintOp(pd);
  let i = a;
  while (i < b) {
    if (toks[i].k !== "c") { i++; continue; }
    let j = i; while (j < b && toks[j].k === "c") j++;
    const ya = yAfter(holes, i), yl = yAfter(holes, j - 1) + 1 - ya;
    if (val !== null) pd.flow.format(ya, yl, { [op]: val });
    else {
      let pos = 0;
      for (const part of pd.flow.toDelta()) {
        const len = typeof part.insert === "string" ? part.insert.length : 1;
        const s0 = Math.max(pos, ya), e0 = Math.min(pos + len, ya + yl);
        if (e0 > s0 && part.attributes) {
          const clear = {};
          for (const [kk, v] of Object.entries(part.attributes)) if (markName(kk) === name && !isCancel(kk) && v !== null) clear[`${kk}!${rid}`] = true;
          if (Object.keys(clear).length) pd.flow.format(s0, e0 - s0, clear);
        }
        pos += len;
      }
    }
    i = j;
  }
}
