import { isEditMode } from "./is-edit-mode.js";
import { downloadStored } from "./conflict-download.js";
import { bevelSurface, bevelText, bevelButton, pageScheme, paintLook, setShown } from "../ui/bevel-controls.js";
import { TOKENS } from "../ui/bevel.js";
import { set } from "../lib/hostile-css.js";

// The one quiet word about how large this document is.
//
// `clay:save-size` is a measurement of a real save attempt, never a live reading, so
// every sentence here says "At the last save attempt": the number is the bytes the last
// attempt measured, and nothing claims the page is that size now. Most documents never
// reach the host's advertised limit, so save.js fetches this module only when one does,
// and it draws nothing until then.
//
// One element, updated in place: a save on a phone fires often, and a notice per save
// would be a toast storm. A later measurement below the near threshold takes it away,
// and so does leaving edit: the notice is editor chrome, not part of the page.
//
// The download is the safe copy this library already offers for the current document
// (conflict-download.js's `downloadStored`), a file openable in a browser rather than a
// save the host would refuse.

const NEAR_MESSAGE = "Download a copy, then reduce its size; saving still works.";
const OVER_MESSAGE = "Download a copy to keep your work.";

let root = null;
let sentence = null;
let copy = null;
let listeners = null;

// A size a person can read at a glance. Kilobyte precision under a megabyte, one
// decimal above it: the question is "how close is this to the limit", not the exact byte.
function readable(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "an unknown size";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} bytes`;
}

function words({ bytes, maxBytes, state }) {
  const measured = `At the last save attempt: ${readable(bytes)} of ${readable(maxBytes)}.`;
  return state === "over"
    ? `This host can't save a file this size. ${measured} ${OVER_MESSAGE}`
    : `This file is getting large. ${measured} ${NEAR_MESSAGE}`;
}

// A phone keyboard shrinks the visual viewport but leaves fixed elements pinned to the
// layout viewport, so a bottom-anchored bar parks itself behind the keyboard. Same fix
// as the conflict notice.
function place() {
  if (!root) return;
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  set(root, "bottom", `calc(${16 + lift}px + env(safe-area-inset-bottom,0px))`);
}

// The safe copy the conflict notice offers, for the same reason: a file the person can
// open has to exist outside a host that will not store these bytes. It already reports
// its own failure.
function download() {
  downloadStored({});
}

function build() {
  root = bevelSurface("div", [
    "position:fixed", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483000", "display:flex", "align-items:center", "gap:10px 12px",
    "width:max-content", "max-width:calc(100vw - 24px)", "flex-wrap:wrap",
    "padding:8px 8px 8px 14px", "text-align:left", `color-scheme:${pageScheme()}`,
  ]);
  // An injected element is in no document on disk, and `editor-ui` is the bundle that
  // says so: not saved, not watched, not in any snapshot, not undoable, not data. The
  // controls inside carry the same markers, as every other notice this library draws.
  root.setAttribute("clay", "editor-ui");
  root.setAttribute("data-clay-save-size", "");
  root.setAttribute("role", "status");
  sentence = bevelText("span", [], "");
  copy = bevelButton("Download my copy", { small: true, onClick: download });
  setShown(copy, false, "inline-flex");
  root.append(sentence, copy);
  document.body.appendChild(root);
  place();
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
}

function render(size) {
  if (!root) build();
  sentence.textContent = words(size);
  // Only an oversize document offers the copy: a near one still saves, and its text
  // already recommends downloading one.
  setShown(copy, size.state === "over", "inline-flex");
  place();
  paintLook(root, { background: TOKENS.surface });
}

function clear() {
  if (!root) return;
  window.visualViewport?.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("scroll", place);
  root.remove();
  root = null;
  sentence = null;
  copy = null;
}

function onSaveSize(event) {
  const size = event?.detail;
  if (!size) return;
  if (size.state === "near" || size.state === "over") render(size);
  else clear();
}

function onModeChange() {
  if (!isEditMode) stop();
}

// announceSaveSize (save-size.js) asks for this file on the first measurement that is near or over,
// and hands it the event that asked: it is replayed here, after the listeners are on,
// exactly as if it had arrived on a page that already held the notice.
export function start(trigger) {
  if (!isEditMode) return;
  listeners ||= new AbortController();
  document.addEventListener("clay:save-size", onSaveSize, { signal: listeners.signal });
  document.addEventListener("clay:modechange", onModeChange, { signal: listeners.signal });
  if (trigger?.type === "clay:save-size") onSaveSize(trigger);
}

// A committed exit takes the notice with it: the handlers, the node it drew and the
// measurement it was drawing. A later entry starts again from whatever the next save
// measures.
export function stop() {
  listeners?.abort();
  listeners = null;
  clear();
}
