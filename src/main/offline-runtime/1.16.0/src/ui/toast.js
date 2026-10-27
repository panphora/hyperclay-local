// a nice, simple alert
// ❗️ don't use too much text!
//
// The Hyperclay dashboard's toast (Bevel's React toast with the dashboard's overrides),
// drawn inline: a 3px tone edge, a 16px Bevel glyph, 13.5px semibold text, a quiet close.
import { set } from "../lib/hostile-css.js";
import { bevelBox, bevelSurface, bevelText, bevelButton, pageScheme, protectIcon } from "./bevel-controls.js";
import { TOKENS, RULES, GLYPHS } from "./bevel.js";

const TONES = {
  success: { edge: TOKENS.teal, icon: GLYPHS.toastSuccess },
  error: { edge: TOKENS.ox, icon: GLYPHS.toastWarning },
  warning: { edge: TOKENS.brass, icon: GLYPHS.toastWarning },
  info: { edge: TOKENS.brass, icon: GLYPHS.toastInfo },
};

const CLOSE_ICON = GLYPHS.toastClose;

const HIDDEN = ["opacity:0", "transform:translateX(24px)"];

function motion() {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? "none" : "opacity .5s ease-in-out, transform .5s ease-in-out";
}

// Looked up on every call, never cached: a live-sync morph or a caller can empty the
// body, and a detached stack would swallow every toast after it.
function stack() {
  const existing = document.querySelector("[data-clay-toasts]");
  if (existing) return existing;
  const box = bevelBox("div", [
    "position:fixed", "top:18px", "right:18px", "z-index:9999",
    "display:flex", "flex-direction:column", "align-items:flex-end", "gap:10px",
    "width:min(330px, calc(100vw - 36px))", "pointer-events:none",
  ]);
  box.setAttribute("data-clay-toasts", "");
  box.setAttribute("aria-live", "polite");
  document.body.append(box);
  return box;
}

function build(message, type, { detail = "", actions = [] } = {}) {
  const tone = TONES[type];
  const el = bevelSurface("div", [
    "display:flex", "align-items:flex-start", ...RULES.toast, "width:100%",
    `border-inline-start:3px solid ${tone.edge}`,
    "cursor:pointer", "pointer-events:auto", `color-scheme:${pageScheme()}`,
    ...HIDDEN, `transition:${motion()}`,
  ]);
  el.setAttribute("data-clay-toast", type);
  const body = bevelBox("div", ["flex:1 1 auto", "min-width:0", "display:flex", "flex-direction:column", "gap:8px"]);
  const head = bevelBox("div", ["display:flex", "align-items:flex-start", "gap:8px"]);
  const glyph = bevelText("span", ["display:inline-grid", "flex:none", "padding-top:1px", `color:${tone.edge}`]);
  glyph.innerHTML = tone.icon;
  protectIcon(glyph.firstElementChild, 16);
  // A message can carry a filename, and a filename is whatever whoever wrote the
  // file chose. It goes in as text so markup in a name can never become markup here.
  const text = bevelText("span", ["flex:1 1 auto", "min-width:120px", ...RULES.toastTitle, "overflow-wrap:anywhere"], message);
  head.append(glyph, text);
  body.append(head);
  // Detail and actions are the same untrusted text as the title: textContent for
  // both, so a reason string can never become markup in the toast either.
  if (detail) {
    body.append(bevelText("span", ["display:block", `color:${TOKENS.muted}`, "overflow-wrap:anywhere"], detail));
  }
  if (actions.length) {
    const row = bevelBox("div", ["display:flex", "flex-wrap:wrap", "gap:8px"]);
    for (const { label, onClick } of actions) {
      row.append(bevelButton(label, { small: true, variant: "quiet", onClick }));
    }
    body.append(row);
  }
  el.append(body);
  return el;
}

// The dashboard's toast close: a bare 24px square in the muted ink, the sunk ground on hover.
function closeButton(onClick) {
  const b = bevelBox("button", [
    "flex:none", "display:inline-grid", "place-items:center", ...RULES.toastClose,
    "cursor:pointer",
  ]);
  b.type = "button";
  b.setAttribute("aria-label", "Dismiss");
  b.title = "Dismiss";
  b.innerHTML = CLOSE_ICON;
  protectIcon(b.firstElementChild, 14);
  const paint = (lit) => {
    set(b, "color", lit ? TOKENS.ink : TOKENS.muted);
    set(b, "background", lit ? TOKENS.sunk : "transparent");
  };
  b.addEventListener("pointerenter", () => paint(true));
  b.addEventListener("pointerleave", () => paint(false));
  b.addEventListener("focus", () => { paint(true); set(b, "outline", `2px solid ${TOKENS.brass}`); set(b, "outline-offset", "1px"); });
  b.addEventListener("blur", () => { paint(false); set(b, "outline", "none"); });
  b.addEventListener("click", onClick);
  return b;
}

function reveal(el) {
  stack().append(el);
  setTimeout(() => {
    set(el, "opacity", "1");
    set(el, "transform", "none");
  }, 10);
}

function dismiss(el, after) {
  set(el, "opacity", "0");
  set(el, "transform", "translateX(24px)");
  setTimeout(() => {
    el.remove();
    after?.();
  }, 500);
}

function toast(message, messageType = "success") {
  const el = build(message, TONES[messageType] ? messageType : "success");
  el.addEventListener("click", () => dismiss(el));
  reveal(el);
  setTimeout(() => dismiss(el), 6600);
}

// Track active persistent toasts by message
const activePersistentToasts = new Map();

// Persistent toast function - doesn't auto-dismiss, requires click to close
function toastPersistent(message, messageType = "warning", { detail = "", actions = [] } = {}) {
  const existing = activePersistentToasts.get(message);
  if (existing) {
    dismiss(existing);
    activePersistentToasts.delete(message);
  }

  const el = build(message, TONES[messageType] ? messageType : "warning", { detail, actions });
  set(el, "cursor", "default");
  const close = closeButton((e) => {
    e.stopPropagation();
    // A newer toast with the same message may have taken this entry since.
    dismiss(el, () => { if (activePersistentToasts.get(message) === el) activePersistentToasts.delete(message); });
  });
  el.append(close);

  activePersistentToasts.set(message, el);
  reveal(el);
}

// Takes down the persistent toast showing this message, if one is up.
function dismissPersistent(message) {
  const el = activePersistentToasts.get(message);
  if (!el) return;
  activePersistentToasts.delete(message);
  dismiss(el);
}

export { toastPersistent, dismissPersistent };
export default toast;
