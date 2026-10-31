/**
 * identity.js — which recovery records belong to this document, and who is writing.
 *
 * Two tabs on one file must not overwrite each other's unsaved writing, and two
 * documents on one origin (every file on a hyperclay.com subdomain) must not share
 * a record at all. So a record is filed under a four-part scope plus a writer, and
 * this module is the one place that decides both.
 *
 * The document half is the host's own file identity: `documentid`, or the pre-rename
 * `htmlclayid` a document saved before that rename still carries on disk. It is read
 * from HOST_IDENTITY_ATTRS, never from the save-token list, because a name in that
 * list becomes a credential in the save URL. The root is read ONCE, here: a morph or
 * a stream restart can rewrite the root afterwards, and a re-read would file this
 * tab's writing under a document it is not looking at. `check()` reads the root
 * again only to report that mismatch, and never to change the scope.
 *
 * Without a host identity the exact pathname is the identity: no query, no hash, and
 * no decoding of distinct paths into one. A draft is always path-scoped, because a
 * visitor's draft never reaches the host's file and this browser is the only place
 * it lives. Nothing here makes a request; a draft must not ask the host anything.
 */

import { HOST_IDENTITY_ATTRS } from "../lib/root-attrs.js";

export const PATH_KIND = "path";
export const EDIT_MODE = "edit";
export const DRAFT_MODE = "draft";

/**
 * A fresh writer id, once per page load.
 *
 * Never from sessionStorage: a duplicated tab inherits that storage, and two tabs
 * holding one writer id would overwrite each other's recovery for the same key.
 *
 * @returns {string}
 */
export function newWriterId() {
  const minted = globalThis.crypto?.randomUUID?.();
  if (minted) return minted;
  return `wr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The durable file identity this response carries, or null.
 *
 * Host-injected and stripped before saving, so it names a file and not a revision.
 * A response carrying neither spelling is a downloaded copy, a local file, or a
 * host that mints no identity, and all three fall back to the pathname.
 *
 * @param {?Element} [root] - the document's root element
 * @returns {?{kind: string, identity: string}}
 */
export function hostIdentityOf(root = globalThis.document?.documentElement) {
  if (!root || typeof root.getAttribute !== "function") return null;
  for (const attr of HOST_IDENTITY_ATTRS) {
    const value = root.getAttribute(attr);
    if (value) return { kind: attr, identity: value };
  }
  return null;
}

/**
 * The pathname as an identity: no query, no hash, nothing decoded.
 *
 * Two URLs that differ only in how they were opened are one document. A caller
 * that hands over a whole URL string still gets the path, because filing one
 * document's writing under two identities is how recovery goes missing.
 *
 * @param {string} pathname
 * @returns {{kind: string, identity: string}}
 */
export function pathIdentityOf(pathname) {
  const identity = String(pathname || "/").split(/[?#]/)[0];
  return { kind: PATH_KIND, identity: identity || "/" };
}

/**
 * This page's recovery identity: its scope, its writer, and a check on the root.
 *
 * @param {Object} [options]
 * @param {string} [options.mode] - "edit" or "draft"
 * @param {?Element} [options.root]
 * @param {?Location} [options.location]
 * @param {string} [options.pathname]
 * @param {string} [options.origin]
 * @param {string} [options.writerId]
 * @returns {Object}
 */
/**
 * Whether two authorities are the same document, seen by the same account.
 *
 * `principalId` is the account, never a token, and a changed login is another principal:
 * a journal is replayed into the authority and principal it was written under or not at
 * all. A missing field is never equal to a missing field.
 *
 * @param {?Object} a
 * @param {?Object} b
 * @returns {boolean}
 */
export function sameAuthority(a, b) {
  if (!a || !b) return false;
  if (!a.host || !a.documentId || !a.principalId) return false;
  return a.host === b.host && a.documentId === b.documentId && a.principalId === b.principalId;
}

export function createIdentity({
  mode = EDIT_MODE,
  root = globalThis.document?.documentElement,
  location: where = globalThis.window?.location,
  pathname,
  origin,
  writerId,
} = {}) {
  const scopeMode = mode === DRAFT_MODE ? DRAFT_MODE : EDIT_MODE;
  const path = pathname ?? where?.pathname ?? "/";
  const from = origin ?? where?.origin ?? "";
  const pathIdentity = pathIdentityOf(path);
  const hostIdentity = scopeMode === DRAFT_MODE ? null : hostIdentityOf(root);
  const captured = hostIdentity ?? pathIdentity;
  const scope = [from, captured.kind, captured.identity, scopeMode];

  return {
    origin: from,
    pathname: path,
    mode: scopeMode,
    scope,
    writerId: writerId || newWriterId(),
    identityKind: captured.kind,
    identity: captured.identity,

    /**
     * Is the root still naming the document this page filed its records under?
     *
     * A mismatch is reported, never applied: records written under one identity are
     * not moved into another document's scope by a later root rewrite. A host
     * identity that appears after this load is a later binding, and the records stay
     * where they are until a confirmed move offers both scopes for review.
     *
     * @param {?Element} [next]
     * @returns {{ok: boolean, code: ?string}}
     */
    check(next = globalThis.document?.documentElement) {
      const found = hostIdentityOf(next);
      if (!hostIdentity) {
        return found ? { ok: true, code: null, bound: found, scope } : { ok: true, code: null };
      }
      if (!found) return { ok: false, code: "identity-missing", captured: hostIdentity, scope };
      if (found.kind !== hostIdentity.kind || found.identity !== hostIdentity.identity) {
        return { ok: false, code: "identity-mismatch", captured: hostIdentity, found, scope };
      }
      return { ok: true, code: null };
    },
  };
}
