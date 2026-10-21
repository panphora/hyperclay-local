import { attrKeys, sameJson } from "./layout.js";
import { blockJson } from "../model.js";
import { marksKey, marksAttrs } from "./marks.js";

const implicitFlags = (doc, visible) => {
  const byId = new Map(), out = [];
  for (const segment of visible ?? []) {
    const flags = byId.get(segment.id) ?? [];
    flags.push(segment.implicit);
    byId.set(segment.id, flags);
  }
  const next = new Map();
  doc.forEach((block) => {
    const id = block.attrs.id;
    const index = next.get(id) ?? 0;
    out.push(byId.get(id)?.[index] ?? false);
    next.set(id, index + 1);
  });
  return out;
};
const pickAttrs = (node) => { const o = {}; for (const k of attrKeys(node.type)) o[k] = node.attrs[k]; if (node.type.name === "table") o.rows = blockJson(node).rows; return o; };

export function tokensOf(doc, alias = new Map(), visible = null) {
  const toks = [];
  const flags = implicitFlags(doc, visible);
  doc.forEach((block, _o, index) => {
    const implicit = flags[index] && !alias.has(block.attrs.id);
    const brk = visible ? visible[index]?.brk ?? null : null;
    if (!implicit) toks.push({ k: "b", id: flags[index] && alias.has(block.attrs.id) ? alias.get(block.attrs.id) : block.attrs.id, t: block.type.name, attrs: pickAttrs(block), brk });
    if (block.isTextblock) block.content.forEach((n) => {
      if (n.isText) { const ms = block.type.name === "code_block" ? [] : n.marks; const mk = marksKey(ms), ma = marksAttrs(ms); for (let i = 0; i < n.text.length; i++) toks.push({ k: "c", ch: n.text[i], mk, ma }); }
      else if (n.type.name === "hard_break") toks.push({ k: "h" });
    });
  });
  return toks;
}

export function tokenIndex(doc, alias = new Map(), visible = null) {
  const out = new Int32Array(doc.content.size + 1);
  let t = 0;
  const flags = implicitFlags(doc, visible);
  doc.forEach((block, o, index) => {
    const implicit = flags[index] && !alias.has(block.attrs.id);
    const open = implicit ? 0 : 1;
    if (block.isTextblock) {
      const n = block.content.size;
      out[o] = t;
      for (let j = 0; j <= n; j++) out[o + 1 + j] = t + open + j;
      out[o + 2 + n] = t + open + n;
      t += open + n;
    } else {
      out[o] = t;
      out[o + block.nodeSize] = t + open;
      t += open;
    }
  });
  return out;
}

export function textTokenRange(doc, from, to) {
  const left = doc.resolve(from), right = doc.resolve(to);
  if (left.depth !== 1 || right.depth !== 1 || left.index(0) !== right.index(0) || !left.parent.isTextblock) throw new RangeError("token range must stay inside one text block");
  const target = left.index(0);
  let prefix = 0, offset = 0, block = null;
  doc.forEach((node, at, index) => {
    if (index < target) prefix += node.isTextblock ? node.content.size + 1 : 1;
    else if (index === target) { block = node; offset = at; }
  });
  const startOffset = from - offset - 1, endOffset = to - offset - 1;
  const tokens = [];
  let cursor = 0;
  block.content.forEach((node) => {
    const a = Math.max(0, startOffset - cursor), b = Math.min(node.nodeSize, endOffset - cursor);
    if (a < b) {
      if (node.isText) {
        const marks = block.type.name === "code_block" ? [] : node.marks;
        const mk = marksKey(marks), ma = marksAttrs(marks);
        for (let i = a; i < b; i++) tokens.push({ k: "c", ch: node.text[i], mk, ma });
      } else if (node.type.name === "hard_break") tokens.push({ k: "h" });
    }
    cursor += node.nodeSize;
  });
  return { start: prefix + 1 + startOffset, end: prefix + 1 + endOffset, tokens };
}

export const sameTok = (a, b) => a.k === b.k && (a.k === "b" ? a.id === b.id && a.t === b.t && sameJson(a.attrs, b.attrs) : a.k === "h" || (a.ch === b.ch && a.mk === b.mk));


export const yAfter = (holes, k) => { let n = k; for (const h of holes) if (h.at <= k) n += h.len; return n; };
export const yBefore = (holes, k) => { let n = k; for (const h of holes) if (h.at < k) n += h.len; return n; };
