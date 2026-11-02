/**
 * checkpoint-proof.js — the proof one accepted save produces, and the conditional read
 * that answers for bytes this tab did not write.
 *
 * Step 2 built the proof itself: the recorded revisions, the accepted page state, the
 * final article and the receipt, checked by `validatePageCheckpoint` before a store
 * retires anything. What it left here is the producer's half. A proof is made at the
 * accepted-save event, from the page state pinned to THAT capture, never from the live
 * store: an edit made after the capture is in the store and is not in the bytes the host
 * took, and reading the store when the response lands would cover it and clear it.
 *
 * Checklist item 2 lives here too. A state that no longer projects to the article that
 * went to disk proves nothing about those bytes, so an authored transform that changed
 * meaning, a page rebuilt from another article or a stale tag all produce no proof, and
 * the records stay.
 *
 * The second half is the conditional page-state client: the host's own copy of the page
 * state, asked for by the accepted ETag, for the cases a local capture cannot answer —
 * the server's checkpoint, another writer's, and a lost reply that only a verified
 * refetch can reconcile. Nothing here reads a cookie, a room sequence or a version
 * string: a 412, a 428 or a 404 keeps every record, and so does any state whose
 * identity, generation, digest or projection disagrees with what was accepted.
 *
 * It loads only when a recovery channel is registered: nothing else imports it.
 */

import { saveToken } from "../core/host-attrs.js";
import { setCapturePageState } from "../core/snapshot.js";
import { canonicalPageBytes, digestHex, pageProof, validatePageCheckpoint } from "./ybind/recovery-proof.js";
import { articleOfPageState, pageStateOfClone } from "./save-projection.js";

// The capture half. A save capture carries its page state only once something can prove
// it, so the reader is installed here rather than from the page bundle: a page that
// journals nothing never pays for it, and a page that does gets the state of the exact
// clone whose bytes it sends, after every transform.
setCapturePageState(pageStateOfClone);

/** The only page-state resource version this client reads. */
export const PAGE_STATE_VERSION = 1;

export class PageCheckpointError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PageCheckpointError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PageCheckpointError(code, message); };
const refused = (code, message) => ({ ok: false, code, message });
const HEX64 = /^[0-9a-f]{64}$/;
const GENERATION = /^[0-9a-f]{32}$/;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The state as this tab holds it, copied: a pinned capture's value shares its `y` map
// with the store's at the moment of the copy and must not share it after.
function copyState(state) {
  return { v: state.v, g: state.g, y: { ...(state.y ?? {}) } };
}

// The state the bytes are decoded from, strictly, and its canonical form.
function stateOfTag(tag) {
  let state;
  try { state = JSON.parse(tag); }
  catch (_) { fail("invalid-state", "The page state is not JSON"); }
  if (!isObject(state) || state.v !== 1) fail("invalid-state", "Expected a version 1 Yjs page value");
  return { state: copyState(state), bytes: canonicalPageBytes(state) };
}

const idKey = (value) => (value === null || value === undefined ? "" : String(value));

/**
 * Ask the host for the page state of one accepted version, conditionally.
 *
 * The ETag is the one the accepted save carried, so the answer is about those exact
 * bytes or about nothing. 412 (another version is stored), 428 (no condition was sent,
 * which no answer of ours can be), 404 (this host keeps no page state) and every other
 * failure are refusals with a code: the caller keeps its records and asks again later.
 *
 * @param {Object} options
 * @param {string} options.href - the resource discovery named in `document.pageState.href`
 * @param {string} options.etag - the ETag the accepted bytes were stored under
 * @param {Function} [options.fetch]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok: true, version: number, documentId: *, generation: string, etag: string, stateHash: string, tag: string}|{ok: false, code: string, message: string}>}
 */
export async function readPageState({ href, etag, fetch: doFetch = globalThis.fetch, signal = null } = {}) {
  if (typeof etag !== "string" || !etag) return refused("missing-etag", "A conditional read needs the accepted ETag");
  if (typeof href !== "string" || !href) return refused("no-page-state", "This host names no page-state resource");
  if (typeof doFetch !== "function") return refused("unavailable", "This tab cannot read the page state");
  const base = globalThis.location?.href ?? "http://localhost/";
  let url;
  try { url = new URL(href, base).href; }
  catch (_) { return refused("no-page-state", "The page-state resource is not a URL"); }
  const token = saveToken();
  let res;
  try {
    res = await doFetch(url, {
      method: "GET",
      credentials: token ? "omit" : "same-origin",
      headers: { "If-Match": etag, "Document-URL": globalThis.location?.href ?? base },
      cache: "no-store",
      redirect: "manual",
      signal,
    });
  } catch (_) {
    return refused("unavailable", "The page-state request did not complete");
  }
  if (!res || typeof res.status !== "number") return refused("unavailable", "The page-state request did not answer");
  if (res.status === 412) return refused("etag-mismatch", "Another version of this document is stored");
  if (res.status === 428) return refused("etag-required", "The host needs a condition this read cannot send");
  if (res.status === 404) return refused("no-page-state", "This host keeps no page state");
  if (!res.ok) return refused("unavailable", `The host answered ${res.status}`);

  let body;
  try { body = JSON.parse(await res.text()); }
  catch (_) { return refused("invalid-state", "The page-state answer is not JSON"); }
  if (!isObject(body) || body.version !== PAGE_STATE_VERSION) return refused("unsupported-version", "Unknown page-state version");
  if (typeof body.tag !== "string" || !body.tag) return refused("invalid-state", "The page-state answer carries no page tag");
  if (typeof body.stateHash !== "string" || !HEX64.test(body.stateHash)) return refused("invalid-state", "The page-state answer carries no state digest");
  if (typeof body.generation !== "string" || !GENERATION.test(body.generation)) return refused("invalid-state", "The page-state answer carries no generation");
  if (typeof body.etag !== "string" || !body.etag) return refused("invalid-state", "The page-state answer carries no ETag");
  if (!Object.hasOwn(body, "documentId")) return refused("invalid-state", "The page-state answer carries no document identity");
  return {
    ok: true,
    version: body.version,
    documentId: body.documentId,
    generation: body.generation,
    etag: body.etag,
    stateHash: body.stateHash,
    tag: body.tag,
  };
}

/**
 * Whether a conditional read answers for the version this tab accepted.
 *
 * Identity, generation, ETag, digest and projection, in that order: a state for another
 * document, another generation, another version of the same document or another article
 * is refused rather than used, and the receipt names the pair the host persisted.
 *
 * A host that gives the document no identity of its own answers null, and a page pinned
 * by path accepts that answer as its own: there is no id it could have answered instead.
 * Every other mismatch is still another document.
 *
 * @param {Object} read - an answer from readPageState()
 * @param {Object} options
 * @param {{authority: Object, lineage: Object}} options.accepted
 * @param {string} options.article - the final outgoing canonical article
 * @param {string} options.etag - the ETag the accepted save carried
 * @returns {Promise<{ok: true, state: Object, receipt: {file: string, pageState: string}}|{ok: false, code: string, message: string}>}
 */
export async function verifyPageState(read, { accepted, article, etag } = {}) {
  if (!read || read.ok !== true) return refused(read?.code ?? "unavailable", read?.message ?? "The page state was not read");
  const authority = accepted?.authority;
  const byPath = authority?.scope === "path" && read.documentId == null;
  if (!byPath && idKey(read.documentId) !== idKey(authority?.documentId)) return refused("foreign-document", "The page state belongs to another document");
  if (typeof accepted?.lineage?.generation !== "string" || read.generation !== accepted.lineage.generation) return refused("foreign-generation", "The page state belongs to another generation");
  if (read.etag !== etag) return refused("etag-mismatch", "The page state belongs to another version of this document");
  let stateBytes, state;
  try { ({ state, bytes: stateBytes } = stateOfTag(read.tag)); }
  catch (error) { return refused(error?.code ?? "invalid-state", error?.message ?? "The page state does not decode"); }
  if (await digestHex(stateBytes) !== read.stateHash) return refused("state-digest-mismatch", "The page state is not the one the host hashed");
  if (typeof article !== "string") return refused("missing-article", "A proof names the final outgoing article");
  let projected;
  try { projected = articleOfPageState(state); }
  catch (error) { return refused("invalid-state", error?.message ?? "The page state does not project"); }
  if (projected !== article) return refused("article-mismatch", "The page state does not project to the accepted article");
  return { ok: true, state, receipt: { file: read.etag, pageState: read.stateHash } };
}

// A proof is only worth the records the validator confirms, over the revisions the
// caller observed: a proof that covers nothing keeps everything.
async function covered(proof, records) {
  const observed = (records || []).map(({ id, revision }) => ({ id, revision }));
  try {
    return { ok: true, proof, covered: await validatePageCheckpoint(proof, observed) };
  } catch (error) {
    return refused(error?.code ?? "invalid-proof", error?.message ?? "The proof does not validate");
  }
}

/**
 * The proof of one accepted save, from the page state pinned to its capture.
 *
 * The receipt is the accepted ETag and the digest of the state the proof is made over,
 * which is this tab's own account that this capture was written and hashed. Nothing
 * about a later edit, a store value or an acknowledgement reaches this function.
 *
 * @param {Object} options
 * @param {string} options.capture - the capture the save belongs to
 * @param {Array<Object>} options.records - {id, revision, update, context} the caller observed
 * @param {{authority: Object, lineage: Object}} options.accepted
 * @param {string} options.article - the final outgoing canonical article
 * @param {Object} options.state - the page state pinned to that capture
 * @param {string} options.etag - the ETag the accepted save carried
 * @returns {Promise<{ok: true, proof: Object, covered: Array}|{ok: false, code: string, message: string}>}
 */
export async function captureProof({ capture, records = [], accepted, article, state = null, etag = null } = {}) {
  if (!state) return refused("no-capture-state", "No page state was pinned to this capture");
  if (typeof etag !== "string" || !etag) return refused("missing-etag", "An accepted save with no ETag proves no stored pair");
  if (typeof article !== "string") return refused("missing-article", "The accepted bytes hold no article");
  let projected, stateBytes;
  try {
    projected = articleOfPageState(state);
    stateBytes = canonicalPageBytes(state);
  } catch (error) {
    return refused(error?.code ?? "invalid-state", error?.message ?? "The pinned page state does not decode");
  }
  if (projected !== article) return refused("article-mismatch", "The pinned page state does not project to the accepted article");
  let proof;
  try {
    proof = await pageProof({
      capture,
      records,
      accepted,
      article,
      state,
      receipt: { file: etag, pageState: await digestHex(stateBytes) },
    });
  } catch (error) {
    return refused(error?.code ?? "invalid-proof", error?.message ?? "The proof could not be built");
  }
  return covered(proof, records);
}

/**
 * The proof of an accepted save, rebuilt from the page state the host persisted.
 *
 * The answer for the server's checkpoint, another writer's, and a save whose reply was
 * lost: identity, generation and digest are checked against that exact ETag first, and
 * only then is coverage asked. A host that cannot answer leaves the journal alone.
 *
 * @param {Object} options
 * @param {Object} options.read - an answer from readPageState()
 * @returns {Promise<{ok: true, proof: Object, covered: Array}|{ok: false, code: string, message: string}>}
 */
export async function refetchedProof({ read, capture, records = [], accepted, article, etag = null } = {}) {
  const verified = await verifyPageState(read, { accepted, article, etag });
  if (!verified.ok) return verified;
  let proof;
  try {
    proof = await pageProof({ capture, records, accepted, article, state: verified.state, receipt: verified.receipt });
  } catch (error) {
    return refused(error?.code ?? "invalid-proof", error?.message ?? "The proof could not be built");
  }
  return covered(proof, records);
}

/**
 * Retire exactly the records one accepted save covers.
 *
 * The pinned capture is tried first, because it needs no request and no host. Only a
 * capture that cannot prove these bytes asks the host, conditionally on the accepted
 * ETag. Whichever answers, the channel is handed the caller's observed list and the
 * proof together: it narrows the list to what the proof covers and never widens it, and
 * a refusal here retires nothing.
 *
 * @param {Object} options
 * @param {Object} options.channel - the `page.yjs` channel api
 * @param {Array<Object>} options.records - {id, revision, update, context} the caller observed
 * @param {string} options.capture
 * @param {{authority: Object, lineage: Object}} options.accepted
 * @param {string} options.article
 * @param {Object} [options.state] - the page state pinned to the capture
 * @param {string} options.etag
 * @param {?string} [options.href] - the page-state resource, or null
 * @param {Function} [options.read]
 * @param {Function} [options.fetch]
 * @returns {Promise<{ok: boolean, retired: Array, proof: ?Object, code?: string}>}
 */
export async function checkpointAccepted({
  channel,
  records = [],
  capture,
  accepted,
  article,
  state = null,
  etag = null,
  href = null,
  read = readPageState,
  fetch: doFetch,
} = {}) {
  if (!channel || typeof channel.checkpoint !== "function") return { ok: false, code: "no-channel", retired: [], proof: null };
  let proven = await captureProof({ capture, records, accepted, article, state, etag });
  if (!proven.ok) {
    const answer = await read({ href, etag, fetch: doFetch });
    proven = await refetchedProof({ read: answer, capture, records, accepted, article, etag });
  }
  if (!proven.ok) return { ok: false, code: proven.code, retired: [], proof: null };
  const answer = await channel.checkpoint({ records: proven.covered, proof: proven.proof });
  if (!answer || answer.ok !== true) return { ok: false, code: answer?.code ?? "checkpoint-failed", retired: [], proof: proven.proof };
  return { ok: true, retired: answer.retired ?? [], proof: proven.proof };
}
