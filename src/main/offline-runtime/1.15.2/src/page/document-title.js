export const UNTITLED = "Untitled";

export function documentTitle(items, { custom = false, currentTitle = "" } = {}) {
  if (custom) return currentTitle;
  const first = items.find(item =>
    item.t === "heading" && (item.level ?? 2) === 1 && item.parent == null
  );
  return String(first?.c ?? "").replace(/[\s\uFFFC]+/gu, " ").trim() || UNTITLED;
}
