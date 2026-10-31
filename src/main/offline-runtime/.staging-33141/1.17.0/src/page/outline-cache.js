// One outline per document: a ProseMirror document never changes, so its outline is
// built on first ask and reused by every pointer frame, menu and drag until the next edit.
import { outline } from "./blocks.js";

const outlines = new WeakMap();

export function outlineOf(doc) {
  let ents = outlines.get(doc);
  if (!ents) outlines.set(doc, ents = outline(doc));
  return ents;
}
