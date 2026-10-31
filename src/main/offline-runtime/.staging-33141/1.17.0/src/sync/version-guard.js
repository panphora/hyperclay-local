// Two versions of one document never merge. A copy of a starter template carries
// `<meta name="hyper-version">`, and an upgrade replaces layout, code and data
// together; morphing that frame into a tab still showing the previous version would
// interleave two templates, so the frame is refused whole and the tab is told to
// reload instead.
//
// Only a page that states its own version can make this judgement, and only a frame
// that states one can disagree: a document without the meta behaves exactly as it did
// before, which is every page that is not a template copy.
//
// Holding the saves is not optional once the frame is refused. This tab's DOM is now
// a version the host no longer stores, and its next save would write that version
// back over the upgrade with no refusal to stop it.
import { isEditMode } from "../core/is-edit-mode.js";

export const UPGRADED_MESSAGE = "This document was upgraded.";

let stopped = false;

function metaOf(root, name) {
  const el = root.querySelector(`meta[name="${name}"]`);
  const value = el ? el.getAttribute("content") : null;
  return value && value.trim() ? value.trim() : null;
}

/** This page's own version, or null when it does not state one. */
export function pageVersion(doc = document) {
  return metaOf(doc, "hyper-version");
}

/** The version a saved frame carries, or null when it carries none. */
export function frameVersion(html) {
  if (typeof html !== "string" || !html.includes("hyper-version")) return null;
  return metaOf(new DOMParser().parseFromString(html, "text/html"), "hyper-version");
}

// One version is not another. A page that states none can make no such judgement.
function replacesMine(theirs) {
  const mine = pageVersion();
  return Boolean(mine) && Boolean(theirs) && theirs !== mine;
}

/**
 * Whether this frame must not be applied: it names a version other than this page's,
 * or an earlier frame already said so and nothing this tab holds is trustworthy since.
 */
export function upgradeReplaces(html) {
  if (stopped) return true;
  return replacesMine(frameVersion(html));
}

/**
 * The same judgement for an incoming document somebody else already parsed: the
 * reader holds the file's own tree and reads its head from there.
 */
export function upgradeReplacesDocument(other) {
  if (stopped) return true;
  if (!other || typeof other.querySelector !== "function") return false;
  return replacesMine(metaOf(other, "hyper-version"));
}

/**
 * Refuse this document from here on: every save is held, every later frame is
 * dropped, and the notice system is asked to show the reload prompt.
 *
 * @returns {Promise<void>} settles once the hold is in place
 */
export function stopForUpgrade() {
  if (stopped) return Promise.resolve();
  stopped = true;
  // The save lane is edit mode's, and a reader must not download it for a hold it
  // has no saves to apply. Already loaded wherever this can matter, so this is the
  // module's own copy rather than a fetch.
  const hold = isEditMode
    ? import("../core/save.js").then((save) => save.holdAllSaves(UPGRADED_MESSAGE), () => {})
    : Promise.resolve();
  // Where the shell (core/conflict-notice.js) is loaded, it is already listening and
  // fetches the notice for this event. A reader has no shell, so the notice is fetched
  // here and handed the event it would otherwise never see.
  const event = new CustomEvent("clay:document-upgraded", { detail: { message: UPGRADED_MESSAGE } });
  const drawn = isEditMode
    ? Promise.resolve()
    : import("../core/conflict-notice-ui.js").then((ui) => ui.start(event), () => {});
  document.dispatchEvent(event);
  return Promise.all([hold, drawn]).then(() => {});
}

export const _test = {
  reset() {
    stopped = false;
  },
};
