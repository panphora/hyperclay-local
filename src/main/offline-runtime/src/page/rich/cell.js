const ATOM = "\uFFFC";
const BREAK = '@{"type":"hard_break"}';

export function cellText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || typeof value !== "object" || typeof value.c !== "string") return "";
  const keys = [];
  for (const run of Array.isArray(value.m) ? value.m : []) {
    if (!Array.isArray(run)) keys.push(run);
    else for (let i = 0; i < run[0] && keys.length < value.c.length; i++) keys.push(run[1]);
  }
  let out = "";
  for (let i = 0; i < value.c.length; i++) out += value.c[i] === ATOM && keys[i] === BREAK ? "\n" : value.c[i];
  return out;
}
