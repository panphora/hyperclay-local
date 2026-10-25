import { schema } from "../schema.js";

export const markName = (k) => k.split("!")[0].split("~")[0];
export const isCancel = (k) => k.includes("!");
export const marksAttrs = (marks) => { const o = {}; for (const m of marks) o[m.type.name] = m.attrs && Object.keys(m.attrs).length ? { ...m.attrs } : true; return o; };
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
  return [...best].filter(([n]) => schema.marks[n]).map(([n, v]) => schema.marks[n].create(v === true ? null : v));
}
