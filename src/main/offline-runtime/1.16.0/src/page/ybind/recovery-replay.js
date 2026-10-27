/**
 * recovery-replay.js — rebuild a page from one journaled capsule, and decide whether it
 * may be replayed at all.
 *
 * A capsule is one immutable base and everything the episode put on top of it: the
 * dependencies it received (a peer update a later local insert was built on) and the
 * local work it owns. Replaying all three into a fresh Y.Doc rebuilds the page as this
 * tab had it, read back through the strict decoder — no room, no host, no store.
 *
 * Admission is a separate question from reconstruction: a journal replays only into the
 * authority, principal and generation it was written under, only while the current page
 * still contains the capsule's base, and only into a page sharing its ancestry.
 */

import * as Y from "../../vendor/yjs.vendor.js";
import { toBase64 } from "../../vendor/yjs.vendor.js";
import { NET } from "./layout.js";
import { blocksFromYValue } from "./decode.js";
import { sameAuthority } from "../../recovery/identity.js";
import { sameLineage, sharesAncestry } from "./lineage.js";
import { canonicalPageBytes, containsUpdate } from "./recovery-proof.js";

export class PageReplayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PageReplayError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PageReplayError(code, message); };
const identityKey = (id) => (typeof id === "string" ? id : JSON.stringify(id));
const bytesOf = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
};
const sameId = (a, b) => identityKey(a) === identityKey(b);

function merge(values) {
  const parts = values.map(bytesOf).filter((bytes) => bytes && bytes.length);
  if (!parts.length) return new Uint8Array(0);
  if (parts.length === 1) return parts[0].slice();
  return Y.mergeUpdatesV2(parts);
}

/**
 * One writer's capsule and its batches as three self-contained updates.
 *
 * Batches are folded in by origin, so a duplicate batch or an update already compacted
 * into the capsule changes nothing: Yjs merges by operation identity. A batch naming
 * another capsule is an error rather than another page's bytes.
 *
 * @param {{capsule: Object, batches?: Array<Object>}} options
 * @returns {Object}
 */
export function accumulateCapsule({ capsule, batches = [] } = {}) {
  if (!capsule || capsule.kind !== "binary" || !capsule.payload) fail("invalid-capsule", "Replay needs a binary capsule");
  if (capsule.version !== undefined && capsule.version !== 1) fail("unknown-version", `Unknown page recovery capsule version: ${capsule.version}`);
  const dependencies = [capsule.payload.dependencies];
  const owned = [capsule.payload.owned];
  const seen = new Set();
  for (const batch of batches) {
    if (!batch || batch.kind !== "binary-batch" || !batch.payload) fail("invalid-batch", "Replay reads binary batches only");
    if (batch.capsuleId !== undefined && !sameId(batch.capsuleId, capsule.id)) fail("foreign-batch", "A batch belongs to another capsule");
    if (batch.id !== undefined) {
      if (seen.has(identityKey(batch.id))) continue;
      seen.add(identityKey(batch.id));
    }
    if (batch.origin === "dependency") dependencies.push(batch.payload);
    else owned.push(batch.payload);
  }
  return {
    id: capsule.id,
    context: capsule.context ?? null,
    revision: capsule.revision ?? 0,
    acknowledged: capsule.acknowledged ?? null,
    base: merge([capsule.payload.base]),
    dependencies: merge(dependencies),
    owned: merge(owned),
  };
}

// The capsule as one page value: the exact bytes a save would carry, so the strict
// decoder reads the same state a checkpoint would.
export function replayPageValue({ capsule, batches = [] } = {}) {
  const parts = accumulateCapsule({ capsule, batches });
  const doc = new Y.Doc();
  try {
    for (const bytes of [parts.base, parts.dependencies, parts.owned]) if (bytes.length) Y.applyUpdateV2(doc, bytes, NET);
    if (doc.store.pendingStructs || doc.store.pendingDs) fail("unresolved-update", "The capsule's updates are missing a prerequisite");
    return { v: 1, g: 0, y: { seed: toBase64(Y.encodeStateAsUpdateV2(doc)) } };
  } finally {
    doc.destroy();
  }
}

/**
 * The whole page a capsule reconstructs, decoded through the strict decoder.
 *
 * @param {{capsule: Object, batches?: Array<Object>}} options
 * @returns {Object} the block model, by block id
 */
export function reconstructPage({ capsule, batches = [] } = {}) {
  return blocksFromYValue(replayPageValue({ capsule, batches }));
}

/**
 * The capsule's parts, if this page may replay them.
 *
 * `current` is the page as it is now: its own authority, generation and accepted state.
 * A journal from another authority or principal is never applied, a journal from another
 * generation is a page that was replaced while the tab was away, and a page that no
 * longer contains the capsule's base has nothing to replay it onto.
 *
 * @param {{capsule: Object, batches?: Array<Object>, current: {context: Object, state: Object}}} options
 * @returns {Object} the accumulated parts, ready to apply
 */
export function admitCapsule({ capsule, batches = [], current } = {}) {
  const parts = accumulateCapsule({ capsule, batches });
  if (!parts.context?.authority) fail("missing-identity", "A capsule with no authority is never replayed");
  if (!current?.context?.authority) fail("missing-identity", "Replay needs the page's own authority");
  if (!sameAuthority(parts.context.authority, current.context.authority)) fail("foreign-authority", "This journal belongs to another document or account");
  if (!sameLineage(parts.context.lineage, current.context.lineage)) fail("foreign-generation", "This journal belongs to another generation of this page");
  const stateBytes = canonicalPageBytes(current.state);
  if (parts.base.length && !containsUpdate(stateBytes, parts.base)) fail("missing-base", "The page no longer contains the journal's base");
  if (!parts.owned.length) fail("nothing-owned", "This capsule owns no local work");
  if (!sharesAncestry(current.state, { v: 1, g: 0, y: { seed: toBase64(parts.owned) } })) fail("foreign-lineage", "This journal shares no ancestry with this page");
  return parts;
}
