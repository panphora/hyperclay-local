import { servedStaleToken } from "./host-attrs.js";
import { isEditMode } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { set, make } from "../lib/hostile-css.js";

// The page's only visible word on a host too old to save to.
//
// This library reads one save-token name. A host older than that rename sends the
// other one, so there is no token here, and it also sets the owner cookie, so without
// help the page would open fully editable and 404 every save against a route that no
// longer matches. is-edit-mode.js takes editing away for that reason. This says why.
//
// It loads in the ALWAYS wave, not the edit-only one, which is the whole point: the
// case it exists for is precisely the case where edit mode is off, so a module gated on
// edit mode could never run in it. host-attrs.js also logs a line, and that line is for
// a developer. Somebody editing a document in a desktop app has no console open, and
// "why can I not edit this any more" is the question they are actually holding.
//
// One line, no choice to make: nothing on this page can fix it, so offering a button
// would be a lie. Dismissable, because after you have read it, it is only in the way.

const MESSAGE =
  "This page can't be edited: the app serving it is out of date. " +
  "Update HTML Clay to 1.9.0 or newer.";

let root = null;

// Bevel is fetched only when the warning is actually shown. This module loads on every
// page, view mode included, and almost none of them ever show it.
let ui = null;

// A phone keyboard shrinks the visual viewport but leaves fixed elements pinned to the
// layout viewport, so a bottom-anchored bar parks itself behind the keyboard. Same fix
// as the conflict notice.
function place() {
  if (!root) return;
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  set(root, "bottom", `calc(${16 + lift}px + env(safe-area-inset-bottom,0px))`);
}

function dismiss() {
  if (!root) return;
  set(root, "display", "none");
  window.visualViewport?.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("scroll", place);
}

function build() {
  root = ui.bevelSurface("div", [
    "position:fixed", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483001", "display:flex", "align-items:center", "gap:10px 12px",
    "width:max-content", "max-width:calc(100vw - 24px)", "flex-wrap:wrap",
    "padding:8px 8px 8px 14px", "text-align:left", `color-scheme:${ui.pageScheme()}`,
  ]);
  // Three markers, and each is load-bearing on a page that CAN save: this element is
  // injected, so it is in no document on disk and must never reach one, never wake the
  // watcher, and never ride out in a snapshot to somebody else's browser.
  root.setAttribute("clay", ui.RUNTIME_ONLY);
  root.setAttribute("data-clay-stale-host", "");
  root.setAttribute("role", "alert");

  const dot = make("span", ["all:initial", "color-scheme:inherit", "display:inline-block", "flex:none", "width:8px", "height:8px", "border-radius:50%", `background:${ui.TOKENS.ox}`]);
  dot.setAttribute("clay", ui.RUNTIME_ONLY);
  const close = ui.bevelButton("Dismiss", { small: true, variant: "quiet", onClick: dismiss });
  close.setAttribute("aria-label", "Dismiss this message");
  root.append(dot, ui.bevelText("span", [], MESSAGE), close);

  document.body.appendChild(root);
  place();
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
}

async function init() {
  if (!servedStaleToken()) return;
  // ?editmode=true outranks the stale-host check by design: that is a person at the
  // keyboard asking for editing on this load, and is-edit-mode.js gives it to them.
  // This notice never consulted that, so it appeared on a page that IS editable and
  // told its reader the opposite. The message is only true while editing is actually
  // off, so it is shown only then.
  if (isEditMode) return;
  const [controls, bevel] = await Promise.all([import("../ui/bevel-controls.js"), import("../ui/bevel.js")]);
  ui = { ...controls, TOKENS: bevel.TOKENS };
  build();
}

let shown = Promise.resolve();
onDomReady(() => { shown = init(); });

// Settles once the warning is on the page, or straight away when there is none to show.
export const whenShown = () => shown;
