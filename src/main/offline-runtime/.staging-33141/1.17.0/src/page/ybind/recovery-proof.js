/**
 * recovery-proof.js — what a checkpoint covers, and what makes a proof a proof.
 *
 * A checkpoint covers a journaled record only when merging that record's owned bytes
 * into the accepted page state changes neither an insertion nor a deletion. A state
 * vector cannot answer that: inserting `abc` and then deleting `b` leaves the state
 * vector where it was while the bytes carry the deletion. So coverage here is a byte
 * comparison, it is sufficient but not necessary, and malformed input is an error that
 * keeps the record rather than retiring it.
 *
 * A proof is made by the save integration from the capture it saved under and the bytes
 * it read back. No room acknowledgement, `requestCheckpoint()` success, state vector or
 * ETag order becomes a proof, and nothing here asks a host anything: the accepted page
 * state and the receipt arrive in the proof itself.
 */

import { encodeStateAsUpdateV2 } from "../../vendor/yjs.vendor.js";
import { docFromValue } from "./provider.js";
import { indexOf, indexContains } from "./containment.js";

export class PageProofError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PageProofError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PageProofError(code, message); };
const HEX = /^[0-9a-f]{64}$/;
const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
const bytesOf = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
};
const identityKey = (id) => (typeof id === "string" ? id : JSON.stringify(id));
const copyId = (id) => (Array.isArray(id) ? [...id] : id);
const copyState = (state) => ({ v: state.v, g: state.g, y: { ...(state.y ?? {}) } });

export const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Whether applying `update` on top of `checkpoint` adds nothing: no insertion, no
 * deletion. Compared by structure (the items and deletions the checkpoint holds), since
 * merged bytes are not stable across merge orders. An update whose dependencies the
 * checkpoint lacks is not contained: Yjs would hold it pending rather than refuse it. The
 * checkpoint is integrated once for as long as its bytes are held, and each update after
 * it is read, not applied.
 *
 * @param {Uint8Array} checkpoint - canonical or merged Yjs V2 update bytes
 * @param {Uint8Array} update - the bytes to look for
 * @returns {boolean}
 */
export function containsUpdate(checkpoint, update) {
  return indexContains(indexOf(checkpoint), update);
}

export async function digestHex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

// The last few states decoded, by their entries: a proof, its validation, the file debt
// and the journal's rebase all ask for the same state's bytes after one accepted save.
const CANONICAL_MAX = 4;
const canonical = [];
const sameState = (memo, state) => {
  if (memo.v !== state.v || memo.g !== state.g) return false;
  const keys = Object.keys(state.y ?? {});
  if (keys.length !== memo.y.size) return false;
  for (const key of keys) if (memo.y.get(key) !== state.y[key]) return false;
  return true;
};

/**
 * The accepted page state as one canonical update, decoded strictly.
 *
 * Pending structs, missing part and a delete set naming an unknown item all refuse:
 * a checkpoint nobody can decode proves nothing about a journaled record. The same state
 * answers with the same bytes, which no caller may change.
 *
 * @param {Object} state - a version 1 page value
 * @returns {Uint8Array}
 */
export function canonicalPageBytes(state) {
  const hit = state && typeof state === "object" && state.y && typeof state.y === "object" ? canonical.find((memo) => sameState(memo, state)) : null;
  if (hit) return hit.bytes;
  let doc;
  try {
    doc = docFromValue(state, { strict: true });
  } catch (error) {
    fail("invalid-state", `The accepted page state does not decode: ${error.message}`);
  }
  let bytes;
  try {
    bytes = encodeStateAsUpdateV2(doc);
    indexOf(bytes, doc);
  } finally {
    doc.destroy();
  }
  if (canonical.length >= CANONICAL_MAX) canonical.shift();
  canonical.push({ v: state.v, g: state.g, y: new Map(Object.entries(state.y)), bytes });
  return bytes;
}

// The same answer `sameAuthority` gives in recovery/identity.js, written here because the
// edit bundle already pays for this module through the provider: importing the generic
// recovery layer from the page proof would split it into a chunk every editor load pays.
const sameAuthority = (a, b) => Boolean(a && b) && Boolean(a.host && a.documentId && a.principalId) && a.host === b.host && a.documentId === b.documentId && a.principalId === b.principalId;
const sameGeneration = (a, b) => Boolean(a && b) && typeof a.generation === "string" && Boolean(a.generation) && a.generation === b.generation;

/**
 * Assemble the proof a checkpoint is retired with.
 *
 * Each named record carries the bytes it owns and the context it was journaled under, so
 * the validator can refuse a record written under another generation without asking the
 * store or a host. `state` must be the exact accepted page state and `article` the final
 * outgoing canonical article; their digests are taken here, over these bytes.
 *
 * @param {Object} options
 * @param {string} options.capture - the capture the save belongs to
 * @param {Array<{id: *, revision: number, update: Uint8Array, context: ?Object}>} options.records
 * @param {{authority: Object, lineage: Object}} options.accepted - the identity and generation it was saved under
 * @param {string} options.article - the final outgoing canonical article
 * @param {Object} options.state - the accepted page state
 * @param {{file: string, pageState: string}} options.receipt - the persisted pair
 * @param {boolean} [options.saved]
 * @returns {Promise<Object>}
 */
export async function pageProof({ capture, records = [], accepted, article, state, receipt, saved = true } = {}) {
  const entries = [];
  for (const record of records) {
    if (!record || record.id === undefined || typeof record.revision !== "number") fail("invalid-record", "A proof names each record by id and revision");
    const update = bytesOf(record.update);
    if (!update || !update.length) fail("invalid-record", "A proof needs the bytes each record owns");
    entries.push({ id: copyId(record.id), revision: record.revision, update: update.slice(), context: record.context ?? null });
  }
  if (typeof article !== "string") fail("missing-article", "A proof names the final outgoing article");
  const stateBytes = canonicalPageBytes(state);
  return {
    saved: saved === true,
    capture,
    accepted,
    article,
    state: copyState(state),
    stateDigest: await digestHex(stateBytes),
    articleDigest: await digestHex(encoder.encode(article)),
    receipt,
    records: entries,
  };
}

// Checklist items 1, 2, 4 and 5, over the proof alone. Item 3 is the per-record coverage
// test below, and the projection of the state onto the article is the producer's to make:
// a proof whose state is not the one it was made over fails its own digest.
async function checkProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) fail("missing-proof", "A page checkpoint needs a proof");
  if (proof.saved !== true) fail("not-saved", "Only a save that succeeded under admission makes a proof");
  if (typeof proof.capture !== "string" || !proof.capture) fail("missing-capture", "A proof belongs to the capture it saved");
  const receipt = proof.receipt;
  if (!receipt || typeof receipt.file !== "string" || !receipt.file || typeof receipt.pageState !== "string" || !receipt.pageState) {
    fail("missing-receipt", "A proof names the persisted file and page-state pair");
  }
  const accepted = proof.accepted;
  if (!accepted || !accepted.authority || !accepted.lineage || typeof accepted.lineage.generation !== "string" || !accepted.lineage.generation) {
    fail("missing-identity", "A proof names the authority and generation it was saved under");
  }
  if (typeof proof.article !== "string") fail("missing-article", "A proof names the final outgoing article");
  if (!Array.isArray(proof.records)) fail("missing-records", "A proof names the records it covers");
  if (typeof proof.stateDigest !== "string" || !HEX.test(proof.stateDigest)) fail("missing-digest", "A proof carries the accepted state digest");
  if (typeof proof.articleDigest !== "string" || !HEX.test(proof.articleDigest)) fail("missing-digest", "A proof carries the final article digest");
  const stateBytes = canonicalPageBytes(proof.state);
  if (await digestHex(stateBytes) !== proof.stateDigest) fail("state-digest-mismatch", "The page state is not the one the proof was made over");
  if (await digestHex(encoder.encode(proof.article)) !== proof.articleDigest) fail("article-digest-mismatch", "The article is not the one the proof was made over");
  const entries = new Map();
  for (const entry of proof.records) {
    if (!entry || entry.id === undefined || typeof entry.revision !== "number") fail("invalid-record", "A proof names each record by id and revision");
    const update = bytesOf(entry.update);
    if (!update || !update.length) fail("invalid-record", "A proof needs the bytes each record owns");
    entries.set(identityKey(entry.id), entry);
  }
  return { stateBytes, entries, accepted };
}

// A record is covered only by a state that still carries it, saved under the same
// authority and the same generation it was journaled under.
function covers(checked, entry) {
  const context = entry.context;
  if (!context || !sameAuthority(context.authority, checked.accepted.authority)) return false;
  if (!sameGeneration(context.lineage, checked.accepted.lineage)) return false;
  const update = bytesOf(entry.update);
  return Boolean(update) && update.length > 0 && containsUpdate(checked.stateBytes, update);
}

/**
 * The records a page checkpoint proof covers, and no others.
 *
 * Registered as `validateCheckpoint` on the `page.yjs` channel. It runs before the
 * store's transaction, may only narrow the caller's list, and throws on a proof it
 * cannot decode so that an error keeps every record.
 *
 * @param {Object} proof
 * @param {Array<{id: *, revision: number}>} records - what the caller observed
 * @returns {Promise<Array<{id: *, revision: number}>>}
 */
export async function validatePageCheckpoint(proof, records = []) {
  const checked = await checkProof(proof);
  return (records || []).filter((record) => {
    if (!record || record.id === undefined || typeof record.revision !== "number") return false;
    const entry = checked.entries.get(identityKey(record.id));
    return Boolean(entry) && entry.revision === record.revision && covers(checked, entry);
  });
}
