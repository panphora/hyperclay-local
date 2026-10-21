/**
 * root-attrs.js — the attributes that live on <html>, and who owns them.
 *
 * Three parties write to the root: the host at serve time, this library, and the
 * author. Only the author's belong to the document. The other two belong to one
 * response and one tab, which is why they are named here rather than inside the
 * modules that happen to read them — the observer has to ignore them, and a
 * peer's copy of them must never be applied.
 */

import { isEphemeralAttr, isMarkedAttr } from "./ephemeral.js";

// The save token, in the order a reader tries the two spellings. Spec §9 bounds it to
// per-file and per-tab and makes the host strip it before writing, so it never reaches
// disk. But §9 bounds only the save path, and §10 fans a snapshot out to other editors'
// browsers, which is the hole this module closes.
//
// Save tokens ONLY. host-attrs.js returns the first name it finds here and puts it
// straight into the save URL, so anything added to this list becomes a credential
// in a path. Durable identities go in HOST_IDENTITY_ATTRS, never in this one.
//
// One name, deliberately. §9 names exactly one save-token attribute.
//
// This is a knowing break, not an oversight. htmlclay is the only host that mints a save
// token at all (hyperclay and Hyperclay Local authorize by cookie and inject nothing),
// it serves both spellings only from 1.9.0, and a document loads this library from a
// rolling URL. So a document served by an htmlclay at or below 1.8.0 keeps edit mode,
// because that host also sets the isAdminOfCurrentResource cookie, and every save 404s,
// because that host registers only `POST /_/save/{token}`.
//
// Taken on purpose, and taken now because the cost only grows: htmlclay 1.8.0 is days
// old, the product is pre-launch, and the alternative is carrying a second credential
// name in the save path permanently, since "wait until the old hosts are gone" is a
// condition nobody ever measures. host-attrs.js says so plainly in the console when it
// finds the old name, so the failure names its own cause and its own fix.
//
// ⚠️ RELEASE ORDER: htmlclay 1.9.0, which injects both names, must publish BEFORE this.
export const SAVE_TOKEN_ATTRS = ["savetoken"];

// The pre-rename spelling. Never read as a credential, which is the point of it being
// here rather than above, and never removed from HOST_TOKEN_ATTRS below, which is a
// different job: a name a host may inject has to go on being stripped before a save and
// kept out of a peer's morph, or a live token gets written into a document or handed to
// another tab. htmlclay injects it forever, because documents frozen against an older
// client read it, so this name never leaves this file.
export const LEGACY_SAVE_TOKEN_ATTRS = ["htmlclaytoken"];

// Host-injected, but NOT credentials. This is htmlclay's durable file identity,
// stamped on every serve and absent from disk bytes, so it rides in the morph
// protection below for the same reason a token does: a morph of raw disk content
// would otherwise strip this tab's copy, and a peer's copy must never be applied.
//
// Two spellings, permanently, mirroring the token list above. htmlclay serves
// `documentid` and reads either, but a document saved before that rename holds
// `htmlclayid` on disk forever, and this list is what a morph consults. Knowing
// only the current name would leave every pre-rename file's identity unprotected,
// which is the failure this list exists to prevent.
//
// It was previously in the token list, where saveToken() returned it whenever a
// host minted no token of its own. That is reachable: htmlclay stamps the id on
// every serve but injects a token only for top-level document loads, and its save
// route strips only the token, so the id reaches disk. Any such file hosted
// somewhere tokenless made this library POST to /_/save/{id} with no cookie and
// hand edit mode to every visitor. Splitting this list off from the token list is
// what fixed that, and the split holds whatever token spellings are read above.
export const HOST_IDENTITY_ATTRS = ["documentid", "htmlclayid"];

// Response metadata, and neither of the other two. `documentetag` names the version
// of the bytes the host built THIS response from, which is the one thing neither the
// token nor the identity can say: a token grants a capability and an identity names a
// file, while the stamp names a revision. It rides on the response only, so an
// incoming morph must never apply a peer's copy and an outgoing sync must never carry
// this tab's. Read once, at module evaluation, by host-attrs.js — never re-read from
// the live root, which a morph may since have rewritten.
//
// Kept out of SAVE_TOKEN_ATTRS on purpose: host-attrs.js returns the first name it
// finds in that list straight into the save URL, and a version stamp is not a
// credential.
//
// `sitevisibility` is the host telling the owner's tab whether this site is served
// privately or publicly ("private" | "public"). It describes the response, not the
// file: the same bytes are private today and public tomorrow, so it must never be
// written to disk, and a peer tab's copy says nothing about what this tab was served.
export const HOST_RESPONSE_ATTRS = ["documentetag", "sitevisibility"];

// What a host may have injected, and therefore what has to be stripped before a save
// and kept out of an incoming morph. Wider than what is READ, on purpose: the old token
// spelling is still injected by every htmlclay, so it still has to be stripped, whether
// or not this library will accept it as a credential.
export const HOST_TOKEN_ATTRS = [
  ...SAVE_TOKEN_ATTRS,
  ...LEGACY_SAVE_TOKEN_ATTRS,
  ...HOST_IDENTITY_ATTRS,
];

// This library's own root state, and this tab's UI truth.
export const ROOT_LIBRARY_ATTRS = ["savestatus", "editmode", "pageowner", "draftmode"];

// Never copied between tabs: not written onto this root by an incoming morph, not
// sent out on a sync broadcast.
//
// Both directions matter, and each was found separately. Accepting a peer's token
// makes every later save go out as that peer, and keeps working after this tab's
// own access is revoked, because revocation cannot reach a token minted for
// somebody else. Accepting a peer's ABSENCE of one is the mirror failure logged in
// documentid.md §5: a token-stripped broadcast removes this tab's own token and it
// can no longer save at all.
export const TAB_LOCAL_ROOT_ATTRS = new Set([
  ...HOST_TOKEN_ATTRS,
  ...HOST_RESPONSE_ATTRS,
  ...ROOT_LIBRARY_ATTRS,
]);

/**
 * True when an incoming morph must be kept away from this attribute.
 * Scoped to the root: the same names anywhere else are the author's business.
 */
export function isTabLocalRootAttr(name, element) {
  return element === document.documentElement && TAB_LOCAL_ROOT_ATTRS.has(name);
}

// Router state. The router mirrors each URL-hash param onto the root as
// route-<name>, and stamps route-active on the record a param selects. Both say
// where this tab is in the document, not what the document holds, so they are
// tab-local like the library's own root state: never saved, never dirty, never
// undone, never sent to or taken from a peer. route-* is reserved on the root
// only; route-active is reserved on every element.
export const ROUTE_ROOT_PREFIX = "route-";
export const ROUTE_ACTIVE_ATTR = "route-active";

/**
 * True when `name` on `el` belongs to this tab rather than to the document:
 * every tab-local root attribute, route-* on a root, route-active anywhere, and
 * ephemeral state (lib/ephemeral.js) anywhere.
 * Works on the live root and on a snapshot clone's or parsed frame's root.
 */
export function isTabLocalAttr(name, el) {
  if (isEphemeralAttr(name, el)) return true;
  if (name === ROUTE_ACTIVE_ATTR) return true;
  if (!el || el.localName !== "html" || el.parentElement) return false;
  return TAB_LOCAL_ROOT_ATTRS.has(name) || name.startsWith(ROUTE_ROOT_PREFIX);
}

/**
 * hyper-morph's ignoreAttribute for tab-local state. While a merge is applied,
 * `merged` is the element the live one is becoming, so a frame that adds or
 * removes an ephemeral:NAME marker together with NAME is judged by the marker
 * as it ends up, not by attribute order.
 */
export function mergeIgnoresAttr(el, name, merged) {
  return isTabLocalAttr(name, merged || el);
}

/**
 * hyper-morph's beforeAttributeUpdated veto: a merge may neither write nor
 * remove a tab-local attribute. A marker-protected attribute is left to
 * mergeIgnoresAttr, which reads the marker from the merged element.
 */
export function mergeVetoesAttr(name, el) {
  return isTabLocalAttr(name, el) && !isMarkedAttr(name, el) ? false : undefined;
}

/** Remove router state from a snapshot clone: route-* on its root, route-active anywhere. */
export function stripRouteAttrs(root) {
  for (const attr of [...root.attributes]) {
    if (attr.name.startsWith(ROUTE_ROOT_PREFIX)) root.removeAttribute(attr.name);
  }
  for (const el of root.querySelectorAll(`[${ROUTE_ACTIVE_ATTR}]`)) el.removeAttribute(ROUTE_ACTIVE_ATTR);
}
