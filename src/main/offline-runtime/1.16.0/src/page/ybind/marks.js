import { schema } from "../schema.js";
import { entriesOfYjs, isOpaque, opaqueMark, yjsFields } from "../format-codec.js";

export const markName = (k) => k.split("!")[0].split("~")[0];
export const isCancel = (k) => k.includes("!");
export const marksAttrs = (marks) => { const o = {}; for (const m of marks) o[m.type.name] = m.attrs && Object.keys(m.attrs).length ? { ...m.attrs } : true; return o; };
// The Yjs fields a set of editor marks stands for. An opaque mark is not a live
// key of its own: its named descriptors go under their own names and its compact
// tokens under the reserved one.
export const marksFields = (marks) => {
  const o = {};
  for (const m of marks) {
    if (isOpaque(m)) { for (const [key, value] of Object.entries(yjsFields(m.attrs.entries))) o[key] = JSON.parse(JSON.stringify(value)); continue; }
    o[m.type.name] = m.attrs && Object.keys(m.attrs).length ? { ...m.attrs } : true;
  }
  return o;
};
export const marksKey = (marks) => marks.map((m) => m.type.name + (m.attrs && Object.keys(m.attrs).length ? JSON.stringify(m.attrs) : "")).sort().join("|");
export function marksFromAttributes(a, blockType) {
  if (blockType === "code_block") return [];
  const best = new Map();
  const cancelled = new Set();
  for (const k of Object.keys(a)) if (isCancel(k) && a[k]) cancelled.add(k.split("!")[0]);
  for (const k of Object.keys(a).sort()) {
    const v = a[k];
    if (v === null || v === undefined || isCancel(k) || cancelled.has(k)) continue;
    best.set(markName(k), v);
  }
  const marks = [];
  let unknown = null;
  for (const [n, v] of best) {
    if (schema.marks[n]) marks.push(schema.marks[n].create(v === true ? null : v));
    else (unknown ??= {})[n] = v;
  }
  // The walk asks this of every text run on every keystroke, and almost none carry a
  // mark from a newer version, so the codec runs only when one is there.
  if (unknown) {
    const opaque = entriesOfYjs(unknown);
    if (opaque.length) marks.push(opaqueMark(opaque));
  }
  return marks;
}
