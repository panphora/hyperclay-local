const KINDS = { "merge-tokens": "tokens", "merge-max": "max" };

export function attributeMerge(el, name) {
  if (!name.startsWith("data-") || name === "data-id" || !el?.closest) return null;
  for (const [attr, kind] of Object.entries(KINDS)) {
    const owner = el.closest(`[${attr}]`);
    if (owner && owner.getAttribute(attr).split(/\s+/).includes(name)) return kind;
  }
  return null;
}
