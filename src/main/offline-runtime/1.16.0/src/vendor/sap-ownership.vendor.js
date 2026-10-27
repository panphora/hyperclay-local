// GENERATED — do not edit. Vendored from sapjs/src/ownership.js
// via sapjs `npm run propagate`, which writes every client's copy from one
// table. Edit the sapjs source and re-run.

// What sapjs paints on an element, read from that element's own attributes. No
// expression runs and no engine state is read, so a host can ask it of any tree:
// the live page, a snapshot clone, or a parsed frame. Self-contained on purpose:
// ClayJS vendors this file verbatim.

export const BEACON = "sap-error";

const WHEN = /^(show-when|hide-when|option|option-not):/;
// Identity and the attributes that declare the record itself are never paint
// output. Form state is, unless a bind or persist owns it.
const NEVER = new Set([
  "id", "data-id", "class", "style",
  "sap", "scope", "items", "item", "bind", "state", "template", "cms-template", "sap-ignore",
]);
const FORM_STATE = new Set(["value", "checked", "selected"]);

function recordOwnsFormState(el) {
  return el.hasAttribute("bind") || el.hasAttribute("persist") || !!el.closest("select[bind]");
}

function inert(el) {
  return el.localName === "template" || el.hasAttribute("template") || el.hasAttribute("cms-template") || el.hasAttribute("sap-ignore");
}

// The [sap] root an element is painted under, or null when it sits outside every
// app or inside a subtree the engine never reads. A subtree just removed from the
// page has no ancestors left to ask; `host`, the element it was removed from,
// continues the walk, so the answer matches the one it had while attached.
export function appOf(el, host = null) {
  let top = null;
  for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
    if (inert(cur)) return null;
    if (cur.hasAttribute("sap")) return cur;
    top = cur;
  }
  return host && top && !top.isConnected ? appOf(host) : null;
}

function declares(el, name) {
  const decl = el.getAttribute("state");
  if (!decl) return false;
  for (const token of decl.trim().split(/\s+/)) {
    if (token.split("=")[0].split(":")[0] === name) return true;
  }
  return false;
}

function paintsHidden(el) {
  if (el.hasAttribute("show")) return true;
  for (const a of el.attributes) if (WHEN.test(a.name)) return true;
  return false;
}

// True when a sapjs paint writes attribute `name` on `el`.
export function ownsAttr(el, name, host = null) {
  if (!el || el.nodeType !== 1 || !name) return false;
  if (name === BEACON) return !!appOf(el, host);
  if (NEVER.has(name)) return false;
  if (FORM_STATE.has(name) && recordOwnsFormState(el)) return false;
  if (name === "hidden") return paintsHidden(el) && !!appOf(el, host);
  return el.hasAttribute("attr:" + name) && !declares(el, name) && !!appOf(el, host);
}

// Everything a paint writes on `el`: whole attributes, class tokens, --custom
// properties in style, and whether text owns its children. Null when nothing.
export function paintsOf(el) {
  if (!el || el.nodeType !== 1 || !appOf(el)) return null;
  let out = null;
  const add = (key, v) => ((out || (out = { attrs: [], classes: [], vars: [], text: false }))[key].push(v));
  for (const a of el.attributes) {
    const n = a.name;
    if (n === "text" || n.startsWith("text:")) {
      if (!el.hasAttribute("bind")) (out || (out = { attrs: [], classes: [], vars: [], text: false })).text = true;
    }
    else if (n.startsWith("attr:")) {
      const target = n.slice(5);
      if (target && !NEVER.has(target) && !(FORM_STATE.has(target) && recordOwnsFormState(el)) && !declares(el, target)) add("attrs", target);
    } else if (n.startsWith("class:")) add("classes", n.slice(6));
    else if (n.startsWith("css:")) add("vars", "--" + n.slice(4));
  }
  if (paintsHidden(el)) add("attrs", "hidden");
  if (el.hasAttribute(BEACON)) add("attrs", BEACON);
  return out;
}

// Calls visit(el, paints) for every painted element under root, in document order.
export function eachPainted(root, visit) {
  if (!root || root.nodeType !== 1 && root.nodeType !== 9) return;
  const apps = root.nodeType === 1 && root.hasAttribute("sap")
    ? [root]
    : [...root.querySelectorAll("[sap]")].filter((app) => !app.parentElement || !app.parentElement.closest("[sap]"));
  for (const app of apps) {
    for (const el of [app, ...app.querySelectorAll("*")]) {
      const p = paintsOf(el);
      if (p) visit(el, p);
    }
  }
}

// Removes every painted value from a detached tree, in place: owned attributes,
// owned class tokens and --properties, and the children of text paints.
export function stripPaints(root) {
  eachPainted(root, (el, p) => {
    for (const name of p.attrs) if (el.hasAttribute(name)) el.removeAttribute(name);
    for (const token of p.classes) if (el.classList.contains(token)) el.classList.remove(token);
    if (!el.getAttribute("class") && el.hasAttribute("class") && p.classes.length) el.removeAttribute("class");
    for (const v of p.vars) if (el.style.getPropertyValue(v) !== "") el.style.removeProperty(v);
    if (p.vars.length && el.hasAttribute("style") && !el.getAttribute("style").trim()) el.removeAttribute("style");
    if (p.text && el.firstChild) el.replaceChildren();
  });
}
