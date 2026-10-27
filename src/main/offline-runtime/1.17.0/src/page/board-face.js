// The small board pieces the checklist and the board view and panel share, so
// the board's own view part can load without them.
export function el(doc, tag, cls, attrs = {}, text = null) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  if (text !== null) node.textContent = text;
  return node;
}

export const initialOf = (name) => ([...String(name).trim()][0] ?? "?").toUpperCase();

export const cardFace = (doc, name) => el(doc, "span", "page-board-face", { "aria-hidden": "true" }, initialOf(name));
