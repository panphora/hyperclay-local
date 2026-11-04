export const PART_KEY = /^(.+)\.(\d+)\.(\d+)$/;
// A regexp group per quad keeps backtrack state per quad and overflows on a page of a few MB.
const NOT_BASE64 = /[^A-Za-z0-9+/]/;
export function isBase64(text) {
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const body = text.length - pad;
  if (NOT_BASE64.test(pad ? text.slice(0, body) : text)) return false;
  return pad ? body % 4 + pad === 4 : body % 4 !== 1;
}
const PART_CHARS = /^[A-Za-z0-9+/=\t\n\f\r ]*$/;

export function entriesOf(y) {
  const whole = [];
  const parts = new Map();
  for (const k of Object.keys(y).sort()) {
    const m = PART_KEY.exec(k);
    if (!m) { whole.push([k, y[k]]); continue; }
    const group = parts.get(m[1]) ?? { n: Number(m[3]), got: [] };
    group.got[Number(m[2])] = y[k];
    parts.set(m[1], group);
  }
  for (const [k, group] of parts) {
    let have = 0;
    for (let i = 0; i < group.n; i++) if (typeof group.got[i] === "string") have++;
    if (have === group.n) whole.push([k, group.got.join("")]);
  }
  return whole;
}

export function captureYValue(value) {
  if (value?.v !== 1 || !value.y || typeof value.y !== "object" || Array.isArray(value.y)) return value;
  const groups = new Map();
  for (const [key, text] of Object.entries(value.y)) {
    const part = PART_KEY.exec(key);
    if (!part) continue;
    const base = part[1], index = Number(part[2]), count = Number(part[3]);
    const group = groups.get(base) ?? { count, indices: new Set(), keys: [], invalid: false };
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index >= count || group.count !== count || group.indices.has(index) || typeof text !== "string" || !PART_CHARS.test(text)) group.invalid = true;
    group.indices.add(index);
    group.keys.push(key);
    groups.set(base, group);
  }
  const omit = new Set();
  for (const [base, group] of groups) {
    if (!group.invalid && !Object.hasOwn(value.y, base) && group.indices.size < group.count) {
      for (const key of group.keys) omit.add(key);
    }
  }
  if (!omit.size) return value;
  return { ...value, y: Object.fromEntries(Object.entries(value.y).filter(([key]) => !omit.has(key))) };
}
