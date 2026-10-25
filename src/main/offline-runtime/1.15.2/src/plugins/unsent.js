// Text typed into chrome and not yet sent (a comment box, a description being edited),
// kept per record and name, outside the file. A redraw or a reload brings it back.
//
// The record a field belongs to is named by an `unsent-key` attribute on its nearest
// such ancestor, and by the nearest `[data-id]` ancestor when there is none: a view
// with two draft fields under one record names each scope it wants kept apart. The
// name is the field's own `unsent` attribute. A draft is pending while the field's
// value differs from the base it started at, an emptied field included.
import { registerUnsavedState } from "../lib/unsaved-state.js";
import { storage } from "../lib/doc-storage.js";

const KEY = "unsent";
const drafts = new Map(Object.entries(storage.session.get(KEY) || {}));
const bases = new WeakMap();
const pending = registerUnsavedState({ id: "unsent", isPending: () => drafts.size > 0 });

const keyOf = (el) => {
  const scope = el.closest("[unsent-key]");
  const record = (scope && scope.getAttribute("unsent-key")) || el.closest("[data-id]")?.dataset.id;
  const name = el.getAttribute("unsent");
  return record && name ? `${record}|${name}` : null;
};
const split = (key) => { const at = key.indexOf("|"); return [key.slice(0, at), key.slice(at + 1)]; };

function persist() {
  storage.session.set(KEY, Object.fromEntries(drafts));
  pending.changed();
  document.dispatchEvent(new CustomEvent("clay:unsent-changed", { detail: { count: drafts.size } }));
}

document.addEventListener("beforeinput", (e) => {
  const el = e.target.closest?.("[unsent]");
  if (el && !bases.has(el)) bases.set(el, el.value);
}, true);

document.addEventListener("input", (e) => {
  const el = e.target.closest?.("[unsent]");
  const key = el && keyOf(el);
  if (!key) return;
  const base = bases.get(el) ?? drafts.get(key)?.base ?? "";
  if (el.value === base) {
    drafts.delete(key);
    bases.delete(el);
  } else {
    drafts.set(key, { base, text: el.value });
  }
  persist();
}, true);

function restore(el) {
  const key = keyOf(el);
  const draft = key && drafts.get(key);
  if (!draft) return;
  const current = el.value;
  bases.set(el, draft.base);
  el.value = draft.text;
  el.dispatchEvent(new CustomEvent("clay:unsent-restored", {
    bubbles: true,
    detail: { base: draft.base, current, stale: current !== draft.base },
  }));
}

new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) {
    if (node.nodeType !== 1) continue;
    if (node.matches("[unsent]")) restore(node);
    for (const el of node.querySelectorAll("[unsent]")) restore(el);
  }
}).observe(document.body, { childList: true, subtree: true });
for (const el of document.querySelectorAll("[unsent]")) restore(el);

export const unsent = {
  get size() { return drafts.size; },
  list: () => [...drafts].map(([key, d]) => { const [record, name] = split(key); return { record, name, ...d }; }),
  clear(el) { const key = keyOf(el); if (key && drafts.delete(key)) persist(); bases.delete(el); },
  drop(record, name) { if (drafts.delete(`${record}|${name}`)) persist(); },
};
