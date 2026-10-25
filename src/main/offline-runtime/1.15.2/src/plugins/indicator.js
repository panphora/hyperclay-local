import { isEditMode } from "../core/is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { set, style } from "../lib/hostile-css.js";
import { bevelSurface, pageScheme } from "../ui/bevel-controls.js";
import { TOKENS, FONT_SANS } from "../ui/bevel.js";
import { saveFeedback } from "../core/save-feedback.js";

// No 'conflict' here on purpose. core/conflict-notice.js owns that state now,
// and it ships in every document rather than only the ones that turned this chip on.
// Both listen to clay:save-conflict, so keeping a label here put a chip in the corner
// saying the same thing as the bar at the same moment. Dropping it from this side
// leaves core unaware that this plugin exists, which is the direction that
// dependency has to point.
const LABELS = {
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
  offline: "Offline, not saved",
  retrying: "Saving…",
  blocked: "Can't save here",
};

// States that stay on screen instead of fading: a save still in flight, one that
// keeps trying, and one the host will not take without a person's help.
const STICKY = new Set(["saving", "retrying", "blocked"]);

const ALARMING = new Set(["error", "offline", "blocked"]);

const REST = [`background:${TOKENS.surface}`, `color:${TOKENS.ink}`, `border-color:${TOKENS["line-2"]}`];
const ALARM = [
  `background:${TOKENS["ox-soft"]}`,
  `color:${TOKENS.ox}`,
  `border-color:color-mix(in srgb, ${TOKENS.ox} 28%, ${TOKENS["ox-soft"]})`,
];

let el = null;
let hideTimer = null;

function ensure() {
  // Looked up on every call, never trusted once detached: a live-sync morph or a
  // caller can empty the body, and a detached chip would swallow every later state.
  if (el && el.isConnected) return el;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el = bevelSurface("div", [
    "position:fixed", "right:16px", "bottom:16px", "z-index:2147483000",
    "padding:4px 12px", `font:500 13px/1.6 ${FONT_SANS}`,
    "opacity:0", `transition:${reduced ? "none" : "opacity .25s"}`, "pointer-events:none",
    `color-scheme:${pageScheme()}`,
  ]);
  el.setAttribute("data-clay-indicator", "");
  el.setAttribute("role", "status");
  document.body.appendChild(el);
  return el;
}

function show(state) {
  if (!LABELS[state]) return;
  // A failed or offline save is the persistent toast's to report when clay-ui is loaded,
  // and so is saved when the page turned on clay.saveToast. Blocked is the exception:
  // the page cannot save at all, so the chip stays even beside the generic toast.
  const ownedByToast = state !== "blocked" &&
    (ALARMING.has(state) || (state === "saved" && saveFeedback.savedToast));
  if (saveFeedback.toasts && ownedByToast) {
    clearTimeout(hideTimer);
    if (el) {
      set(el, "opacity", "0");
      el.textContent = "";
      delete el.dataset.state;
    }
    return;
  }
  const node = ensure();
  node.textContent = LABELS[state];
  node.dataset.state = state;
  set(node, "color-scheme", pageScheme());
  style(node, ALARMING.has(state) ? ALARM : REST);
  set(node, "opacity", "1");
  clearTimeout(hideTimer);
  if (!STICKY.has(state)) hideTimer = setTimeout(() => { set(node, "opacity", "0"); }, 2200);
}

function init() {
  if (!isEditMode) return;
  saveFeedback.chip = true;
  for (const state of Object.keys(LABELS)) {
    document.addEventListener("clay:save-" + state, () => show(state));
  }
  document.addEventListener("clay:page-save-state", (event) => show(event.detail?.state));
}

onDomReady(init);
