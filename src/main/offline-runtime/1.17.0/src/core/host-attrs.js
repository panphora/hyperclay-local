/**
 * host-attrs.js — the attributes a host puts on <html>, and what they mean.
 *
 * These are ephemeral: the host injects them into the response and strips them
 * back out of whatever the client saves, so they never reach disk. clayjs only
 * ever reads them, and reads them here so the two spellings of the save token
 * cannot drift between the edit-mode ladder and the save lane.
 */

import { SAVE_TOKEN_ATTRS, LEGACY_SAVE_TOKEN_ATTRS } from "../lib/root-attrs.js";

// The version of the bytes this response was built from, captured ONCE, here.
//
// §5's discovery answers about whatever is on disk when the ANSWER is built, which is
// a later moment than the navigation that delivered this page: the file can change in
// between, and its answer then names a revision this tab has never seen. The root
// attribute is the only place that says which one this tab is actually looking at, so
// it is read at module evaluation and never again. A later re-read would pick up
// whatever a morph or a stream restart left on the root, which is exactly the claim
// this value exists to avoid.
export const servedDocumentEtag =
  typeof document === "undefined"
    ? null
    : document.documentElement.getAttribute("documentetag") || null;

// Whether the host serves this site privately, captured ONCE, for the same reason as
// the etag above: it describes this response, and a morph may later rewrite the root.
// null when the host said nothing (HTML Clay, Hyperclay Local, a downloaded copy) or
// said something this library does not recognize.
const SITE_VISIBILITIES = new Set(["private", "public"]);
export const servedSiteVisibility = (() => {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.getAttribute("sitevisibility");
  return SITE_VISIBILITIES.has(value) ? value : null;
})();

let warnedAboutLegacyToken = false;

/**
 * Say so, once, when this response carries only the pre-rename save token.
 *
 * Dropping the old spelling is a deliberate break (see root-attrs.js), and its failure
 * mode is the kind worth spending five lines on: the host that serves the old name also
 * sets the edit-mode cookie, so the page stays editable and every save 404s. Without
 * this the reader sees a working page that quietly keeps nothing. With it the console
 * names the cause and the fix, which is the whole difference between a break and a bug.
 */
function warnAboutLegacyToken() {
  if (warnedAboutLegacyToken) return;
  const carries = LEGACY_SAVE_TOKEN_ATTRS.some(
    (attr) => document.documentElement.getAttribute(attr)
  );
  if (!carries) return;
  warnedAboutLegacyToken = true;
  console.warn(
    "[clay] This page was served with the pre-1.9.0 save token (" +
      LEGACY_SAVE_TOKEN_ATTRS.join(", ") +
      "), which this version no longer accepts. Saving will fail until the host is " +
      "updated. If this is HTML Clay, upgrade it to 1.9.0 or newer."
  );
}

/**
 * The per-document save token this response carries, or null.
 *
 * Walks SAVE_TOKEN_ATTRS and not the wider HOST_TOKEN_ATTRS: whatever comes back
 * is put straight into the save URL and gates edit mode, so a durable file
 * identity in that list would be treated as a capability it is not.
 *
 * @returns {?string}
 */
export function saveToken() {
  if (typeof document === "undefined") return null;
  for (const attr of SAVE_TOKEN_ATTRS) {
    const value = document.documentElement.getAttribute(attr);
    if (value) return value;
  }
  warnAboutLegacyToken();
  return null;
}

/**
 * True when the host handed this response a save token this version accepts.
 *
 * Only `savetoken` counts. A response carrying nothing but the pre-rename spelling is
 * FALSE here and true from `servedStaleToken()`, which is the whole point of the pair.
 *
 * @returns {boolean}
 */
export function hasSaveToken() {
  return saveToken() !== null;
}

/**
 * True when this response carries ONLY the pre-rename save token.
 *
 * That combination means one thing: the host is older than the rename and cannot be
 * saved to by this version. It is worth its own name because two separate things act
 * on it. Edit mode goes off, so the page does not offer editing it cannot keep, and
 * stale-host-notice.js says why on the page, since the console line reaches a
 * developer and nobody else.
 *
 * @returns {boolean}
 */
export function servedStaleToken() {
  if (typeof document === "undefined") return false;
  if (saveToken() !== null) return false;
  return LEGACY_SAVE_TOKEN_ATTRS.some(
    (attr) => document.documentElement.getAttribute(attr)
  );
}
