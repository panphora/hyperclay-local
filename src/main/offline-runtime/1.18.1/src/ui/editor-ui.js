import { addRegionToken } from "../lib/region-policy.js";

// Every interface ClayJS draws over a document mounts through here, inside an open
// shadow root, so the document's own CSS cannot restyle it. The host takes no box
// (display: contents) and stops inheritance at the boundary (all: initial); custom
// properties still cross, which is how theme tokens arrive.
export const HOST_CSS = `:host { all: initial !important; display: contents !important; }
:host([hidden]) { display: none !important; }
@media print { :host { display: none !important; } }`;

const sheetsByDocument = new WeakMap();
const guardedWindows = new WeakSet();

// A key event from a field inside a root reaches the page's listeners retargeted to the
// host, so a page's "is someone typing?" check sees no field and runs its shortcut (a
// "/" that focuses search, an arrow that turns a slide). Typing and caret keys stop at
// the window, before any page listener; the browser still types and moves the caret.
// Enter, Escape and Tab pass, since the fields' own handlers use them.
const CARET_KEYS = new Set(["Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

function keepTypingInside(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key?.length !== 1 && !CARET_KEYS.has(event.key)) return;
  const target = event.composedPath()[0];
  if (!target?.matches?.("input, textarea, select") && !target?.isContentEditable) return;
  if (target.getRootNode().host?.localName === "clay-editor-ui") event.stopPropagation();
}

function guardTyping(win) {
  if (!win || guardedWindows.has(win)) return;
  guardedWindows.add(win);
  for (const type of ["keydown", "keypress", "keyup"]) win.addEventListener(type, keepTypingInside, true);
}

function adopts(doc, shadow) {
  return "adoptedStyleSheets" in shadow && typeof doc.defaultView?.CSSStyleSheet?.prototype?.replaceSync === "function";
}

function sheetFor(doc, text) {
  let sheets = sheetsByDocument.get(doc);
  if (!sheets) sheetsByDocument.set(doc, (sheets = new Map()));
  let sheet = sheets.get(text);
  if (!sheet) {
    sheet = new doc.defaultView.CSSStyleSheet();
    sheet.replaceSync(text);
    sheets.set(text, sheet);
  }
  return sheet;
}

// The region policy walks parentElement, which stops at a shadow root, so the inner
// content needs its own editor-ui marker; the host's keeps it out of every capture.
export function mountEditorUI({ name, content, css = [], parent = document.body, before = null, attributes = {} }) {
  const doc = parent.ownerDocument;
  const host = doc.createElement("clay-editor-ui");
  host.setAttribute("data-clay-ui", name);
  addRegionToken(host, "editor-ui");
  for (const [key, value] of Object.entries(attributes)) host.setAttribute(key, value);
  addRegionToken(content, "editor-ui");

  const shadow = host.attachShadow({ mode: "open" });
  const texts = [HOST_CSS, ...css];
  if (adopts(doc, shadow)) {
    shadow.adoptedStyleSheets = texts.map((text) => sheetFor(doc, text));
  } else {
    for (const text of texts) {
      const style = doc.createElement("style");
      style.textContent = text;
      shadow.append(style);
    }
  }
  shadow.append(content);
  guardTyping(doc.defaultView);
  parent.insertBefore(host, before);

  return { host, shadow, content, remove: () => host.remove() };
}
