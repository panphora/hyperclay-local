// What the served file wrote for the attributes edit mode rewrites, and for the
// contents of [freeze] regions, recorded the first time each element appears. The
// always wave carries this so the record is made in view mode, before the reader or a
// widget can paint over the authored form; leaving edit mode hands the spelling back.
// Capturing is a pure read: this module imports no writer and no lifecycle engine.

import Mutation from "../lib/mutation.js";
import { FREEZE_SELECTOR } from "../lib/region-policy.js";
import { ROUTE_ACTIVE_ATTR } from "../lib/root-attrs.js";
import { stripEphemeral } from "../lib/ephemeral.js";

export const CONTROLLED_SELECTOR =
  '[editmode\\:contenteditable], [viewmode\\:disabled], [viewmode\\:readonly]';

const authored = new WeakMap();
const originals = new WeakMap();

export function captureAuthored(el) {
  let seen = authored.get(el);
  if (!seen) {
    const order = el.getAttributeNames();
    const values = {};
    for (const name of order) values[name] = el.getAttribute(name);
    seen = { order, values };
    authored.set(el, seen);
  }
  return seen;
}

// The authored value, or null when the file did not have the attribute at all.
export function authoredAttr(el, name) {
  if (!el) return null;
  const { values } = captureAuthored(el);
  return name in values ? values[name] : null;
}

// An attribute that was removed and written again lands at the end of the list, and
// attribute order is what a saved file compares: an untouched page would come back
// with `disabled` moved. Rebuilding the list in the recorded order is the only way to
// hand the file back exactly what it served. Runs only when something actually moved,
// and only on the way out of edit.
export function restoreAuthoredOrder(el) {
  const seen = authored.get(el);
  if (!seen) return;
  const current = el.getAttributeNames();
  const desired = [
    ...seen.order.filter((name) => current.includes(name)),
    ...current.filter((name) => !seen.order.includes(name)),
  ];
  if (desired.every((name, i) => name === current[i])) return;
  const values = desired.map((name) => [name, el.getAttribute(name)]);
  for (const name of current) el.removeAttribute(name);
  for (const [name, value] of values) el.setAttribute(name, value);
}

// Active value, then inert value, then what the file wrote, then the default.
export function canonicalContentEditableValue(el) {
  return (
    el.getAttribute("contenteditable") ??
    el.getAttribute("inert-contenteditable") ??
    authoredAttr(el, "inert-contenteditable") ??
    authoredAttr(el, "contenteditable") ??
    "true"
  );
}

export function canonicalContentEditable(el) {
  el.setAttribute("inert-contenteditable", canonicalContentEditableValue(el));
  el.removeAttribute("contenteditable");
}

// The authored original is what the file keeps, so it must hold no router stamp and no
// ephemeral state: either can be set on a child before this capture runs.
function authoredInnerHTML(el) {
  const html = el.innerHTML;
  if (!el.querySelector(`[${ROUTE_ACTIVE_ATTR}]`) && !html.includes("ephemeral") && !html.includes("<dialog")) return html;
  const copy = el.cloneNode(true);
  for (const s of copy.querySelectorAll(`[${ROUTE_ACTIVE_ATTR}]`)) s.removeAttribute(ROUTE_ACTIVE_ATTR);
  for (const child of copy.children) stripEphemeral(child);
  return copy.innerHTML;
}

export function captureFrozen(el) {
  if (!originals.has(el)) originals.set(el, authoredInnerHTML(el));
}

export function frozenOriginal(el) {
  return originals.get(el);
}

export function captureAll() {
  for (const el of document.querySelectorAll(CONTROLLED_SELECTOR)) captureAuthored(el);
  for (const el of document.querySelectorAll(FREEZE_SELECTOR)) captureFrozen(el);
}

captureAll();

Mutation.onAddElement({
  selectorFilter: CONTROLLED_SELECTOR,
  require: "observed",
  pausable: false,
  debounce: 0
}, (changes) => {
  changes.forEach(({ element }) => captureAuthored(element));
});

Mutation.onAddElement({
  selectorFilter: FREEZE_SELECTOR,
  require: "observed",
  pausable: false,
  debounce: 0
}, (changes) => {
  changes.forEach(({ element }) => captureFrozen(element));
});
