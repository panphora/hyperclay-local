export const PERSON_COLORS = Object.freeze(['#6b4fa8', '#2f6a9e', '#9a6a1c', '#a8463d', '#2f7a69', '#4f6178', '#3f7d3a', '#a2457a']);

export function colorIndexOf(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % PERSON_COLORS.length;
}

export function personColor(id) {
  return PERSON_COLORS[colorIndexOf(id)];
}

export function initialsOf(name) {
  const letters = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0]);
  return letters.join("").toUpperCase() || "?";
}
