import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { idKey, parseKey, sameJson } from "./layout.js";
import { marksFromAttributes, marksKey } from "./marks.js";

export const hashText = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const covers = (it, id) => it.id.client === id.client && id.clock >= it.id.clock && id.clock < it.id.clock + it.length;

export const pickCopy = (list) => list.reduce((x, y) => (y.brk.client < x.brk.client || (y.brk.client === x.brk.client && y.brk.clock < x.brk.clock) ? y : x));

export function walk(pd) {
  const store = pd.ydoc.store;
  const starts = new Map();
  pd.gone.forEach((rec, key) => {
    let it = null;
    try { it = Y.getItem(store, parseKey(key)); } catch { it = null; }
    if (it && !it.deleted && it.content instanceof Y.ContentEmbed && it.content.embed.b !== undefined && it.id.client === parseKey(key).client && it.id.clock === parseKey(key).clock) starts.set(it, { key, rec, end: rec.e ? parseKey(rec.e) : null });
  });
  const segs = [];
  const orphans = [];
  let cur = null, prevId = "start", hiding = null;
  const cattrs = {};
  const typeOf = (id) => { const m = pd.attrs.get(id); return (m && m.get("t")) || "paragraph"; };
  const open = (id, brk, implicit) => {
    cur = { kind: "b", id, baseId: id, brk, implicit, runs: [], len: implicit ? 0 : 1, atom: false };
    if (!implicit) { cur.t = typeOf(id); cur.atom = !schema.nodes[cur.t]?.isTextblock; }
    else cur.t = "paragraph";
    segs.push(cur);
    prevId = id;
  };
  const flush = () => {
    if (!hiding) return;
    if (hiding.resume) hiding.resume.runs.push({ hole: hiding.len });
    else segs.push({ kind: "h", len: hiding.len, key: hiding.active[0]?.key });
    cur = hiding.resume;
    hiding = null;
  };
  const settle = (a) => {
    if (a.text) orphans.push({ key: a.key, id: a.rec.b, text: a.text, h: hashText(a.text) });
  };
  for (let it = pd.flow._start; it; it = it.right) {
    if (hiding) {
      const liveBreak = !it.deleted && it.content instanceof Y.ContentEmbed && it.content.embed.b !== undefined;
      const keep = [];
      for (const a of hiding.active) {
        if (a.end ? covers(it, a.end) : liveBreak) settle(a);
        else keep.push(a);
      }
      hiding.active = keep;
      if (!keep.length) flush();
    }
    const start = starts.get(it);
    if (start) {
      const a = { key: start.key, rec: start.rec, end: start.end, text: "" };
      if (hiding) hiding.active.push(a);
      else hiding = { active: [a], len: 0, resume: cur };
      hiding.len += 1;
      continue;
    }
    if (it.deleted) continue;
    const c = it.content;
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; continue; }
    if (hiding) {
      const piece = c instanceof Y.ContentString ? c.str : c instanceof Y.ContentEmbed ? (c.embed.b !== undefined ? "\u00b6" : "\n") : "";
      if (c instanceof Y.ContentString || c instanceof Y.ContentEmbed) { for (const a of hiding.active) a.text += piece; hiding.len += it.length; }
      continue;
    }
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; continue; }
    if (c instanceof Y.ContentEmbed) {
      const e = c.embed;
      if (e.b !== undefined) open(e.b, { client: it.id.client, clock: it.id.clock }, false);
      else {
        if (!cur || cur.atom) open(`~${prevId}`, null, true);
        cur.runs.push({ br: true });
        cur.len += 1;
      }
      continue;
    }
    if (c instanceof Y.ContentString) {
      if (!cur || cur.atom) open(`~${prevId}`, null, true);
      const marks = marksFromAttributes(cattrs, cur.t);
      cur.runs.push({ text: c.str, marks, mk: marksKey(marks) });
      cur.len += c.str.length;
    }
  }
  if (hiding) { for (const a of hiding.active) settle(a); flush(); }
  const groups = new Map();
  for (const s of segs) {
    if (s.kind !== "b" || s.implicit) continue;
    (groups.get(s.baseId) ?? groups.set(s.baseId, []).get(s.baseId)).push(s);
  }
  const textOfSeg = (s) => s.runs.map((r) => (r.br ? "\n" : r.hole ? "" : r.text)).join("");
  for (const [base, list] of groups) {
    if (list.length < 2) continue;
    const win = pickCopy(list);
    for (const s of list) {
      if (s === win) continue;
      s.hide = true;
      if (!(sameJson(s.runs, win.runs) && s.t === win.t) && textOfSeg(s)) orphans.push({ key: `d${s.brk.client}.${s.brk.clock}`, id: base, text: textOfSeg(s), h: hashText(textOfSeg(s)), copy: true });
    }
  }
  const visible = [];
  const holes = [];
  let tokens = 0;
  for (const s of segs) {
    if (s.kind === "h") { holes.push({ at: tokens, len: s.len }); continue; }
    if (s.hide) {
      holes.push({ at: tokens, len: s.len + s.runs.reduce((n, r) => n + (r.hole ?? 0), 0) });
      continue;
    }
    visible.push(s);
    let off = s.implicit ? 0 : 1;
    for (const r of s.runs) {
      if (r.hole) holes.push({ at: tokens + off, len: r.hole });
      else off += r.br ? 1 : r.text.length;
    }
    tokens += s.len;
  }
  return { visible, holes, orphans, tokens };
}
