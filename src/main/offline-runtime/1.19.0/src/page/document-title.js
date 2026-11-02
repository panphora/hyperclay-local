export const UNTITLED = "Untitled";

export function documentTitle(items, { custom = false, currentTitle = "", keepWithoutHeading = false } = {}) {
  if (custom) return currentTitle;
  const first = items.find(item =>
    item.t === "heading" && (item.level ?? 2) === 1 && item.parent == null
  );
  // A file the editor has not adopted yet (see adoptAuthoredTitle) may carry a title
  // its author wrote with no H1 behind it; a renderer that cannot ask keeps it.
  if (!first && keepWithoutHeading && !["", UNTITLED].includes(String(currentTitle).trim())) return currentTitle;
  return String(first?.c ?? "").replace(/[\s\uFFFC]+/gu, " ").trim() || UNTITLED;
}
