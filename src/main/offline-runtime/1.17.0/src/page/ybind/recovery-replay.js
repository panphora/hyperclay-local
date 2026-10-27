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
import { sameAuthority, hostIdentityOf, pathIdentityOf } from "../../recovery/identity.js";
import { sameLineage, sharesAncestry, lineageOf } from "./lineage.js";
import { canonicalPageBytes, containsUpdate, digestHex, validatePageCheckpoint } from "./recovery-proof.js";
import { RECOVERY_ORIGIN } from "./provider.js";

/** The channel this adapter journals and replays: one name, one version, everywhere. */
export const PAGE_CHANNEL = "page.yjs";
export const PAGE_CHANNEL_VERSION = 1;

// When one writer's batches are merged into its capsule: past either threshold, and never
// over a record the store has not confirmed.
export const COMPACT_BATCHES = 64;
export const COMPACT_BYTES = 1024 * 1024;

/** The channel's own merge, for the binary store's compaction. */
export const mergePageUpdates = (parts) => Y.mergeUpdatesV2(parts);

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
  // The reconstructed page is what has to share this page's ancestry, base included:
  // this tab's own inserts carry its client alone, and never the page's.
  const rebuilt = merge([parts.base, parts.dependencies, parts.owned]);
  if (!sharesAncestry(current.state, { v: 1, g: 0, y: { seed: toBase64(rebuilt) } })) fail("foreign-lineage", "This journal shares no ancestry with this page");
  return parts;
}

/**
 * One writer's capsules, each with the batches that belong to it.
 *
 * A session that died before its batches were compacted leaves them behind, so a
 * capsule is only ever read together with every batch naming it, whichever session
 * wrote it.
 *
 * @param {Array<Object>} [records] - what the channel listed
 * @returns {Array<{capsule: Object, batches: Array<Object>}>}
 */
export function capsulesOf(records = []) {
  const capsules = new Map();
  const batches = new Map();
  for (const record of records || []) {
    if (!record || record.supported === false) continue;
    if (record.kind === "binary") {
      capsules.set(identityKey(record.id), record);
      continue;
    }
    if (record.kind !== "binary-batch" || record.capsuleId === undefined) continue;
    const key = identityKey(record.capsuleId);
    const list = batches.get(key) ?? [];
    list.push(record);
    batches.set(key, list);
  }
  return [...capsules.entries()].map(([key, capsule]) => ({ capsule, batches: batches.get(key) ?? [] }));
}

/**
 * Apply an admitted capsule's three parts into a live document.
 *
 * The recovery origin is its own: the provider offers the result to the room, and the
 * journal never takes it as this tab's own work, so a recovery is never journaled twice.
 *
 * @param {Object} doc - the Y.Doc the page is being edited in
 * @param {Object} parts - an `accumulateCapsule` result
 */
export function applyCapsule(doc, parts) {
  for (const bytes of [parts.base, parts.dependencies, parts.owned]) {
    if (bytes && bytes.length) Y.applyUpdateV2(doc, bytes, RECOVERY_ORIGIN);
  }
}

/**
 * Replay every capsule this page may replay, and name the ones it may not.
 *
 * Nothing is applied for a capsule that fails admission: a changed authority, a changed
 * generation, a base the page no longer contains or no shared ancestry is review, not a
 * merge. A capsule with no owned work has nothing to restore and is skipped silently.
 *
 * @param {{records?: Array<Object>, current: {context: Object, state: Object}, into: Object}} options
 * @returns {{replayed: Array<Object>, review: Array<Object>}}
 */
export function replayJournals({ records = [], current, into } = {}) {
  const replayed = [];
  const review = [];
  for (const entry of capsulesOf(records)) {
    let parts;
    try {
      parts = admitCapsule({ capsule: entry.capsule, batches: entry.batches, current });
    } catch (error) {
      if (error?.code === "nothing-owned") continue;
      review.push({ capsule: entry.capsule, code: error?.code ?? "invalid-capsule", message: error?.message ?? "This journal cannot be replayed" });
      continue;
    }
    applyCapsule(into, parts);
    replayed.push({ id: entry.capsule.id, revision: parts.revision, owned: parts.owned.length });
  }
  return { replayed, review };
}

/**
 * The context one episode's capsules are journaled under.
 *
 * A host that persists a page generation names it; without one, the generation is the
 * digest of the accepted base, so a page rebuilt from other bytes is another generation
 * and a page that has not changed keeps its own.
 *
 * @param {Object} options
 * @param {{host: string, documentId: string, principalId: string}} options.authority
 * @param {?string} options.generation
 * @param {?Uint8Array} options.base - the accepted state captured at the episode's start
 * @param {number} [options.formatFloor]
 * @returns {Promise<Object>}
 */
export async function pageJournalContext({ authority, generation = null, base = null, formatFloor = 0 } = {}) {
  const bytes = bytesOf(base) ?? new Uint8Array(0);
  const token = typeof generation === "string" && generation ? generation : await digestHex(bytes);
  return { authority, lineage: await lineageOf(token, bytes), formatFloor };
}

/**
 * The authority this page journals under, or null when it cannot be pinned.
 *
 * A host that names people names the account too, and an answer without one is not a
 * principal: replay waits for the next boot rather than filing work under a guess. A
 * host with no people support gives its document to whoever holds it, so the document's
 * own host identity is the principal there.
 *
 * @param {Object} [options]
 * @param {?Object} [options.meta] - the host's discovery answer
 * @param {?Location} [options.location]
 * @param {?Element} [options.root]
 * @returns {?{host: string, documentId: string, principalId: string}}
 */
export function pageAuthority({ meta = null, location: where = globalThis.location, root = globalThis.document?.documentElement } = {}) {
  const host = where?.origin ?? "";
  if (!host) return null;
  const documentId = hostIdentityOf(root)?.identity ?? pathIdentityOf(where?.pathname ?? "/").identity;
  if (!documentId) return null;
  const people = meta?.document?.people;
  const principalId = people && typeof people === "object" ? people.me?.id ?? null : documentId;
  if (!principalId) return null;
  return { host, documentId, principalId };
}

const journalKey = (id) => (typeof id === "string" ? id : JSON.stringify(id));

/**
 * The accepted page state an episode starts from, as the bytes its capsule keeps.
 *
 * @param {Object} state - a version 1 page value
 * @returns {Uint8Array}
 */
export const journalBase = (state) => canonicalPageBytes(state);

/**
 * The page channel of one recovery service, registered once per page load.
 *
 * A channel is registered at its own version and nothing calls it until a page can
 * actually journal: a reader and a page without a pinned identity register nothing.
 *
 * @param {Object} service - `clay.recovery`
 * @returns {Object} the channel api
 */
const channels = new WeakMap();
export function pageChannel(service) {
  if (!service) return null;
  const existing = channels.get(service);
  if (existing) return existing;
  const channel = service.register({
    channel: PAGE_CHANNEL,
    version: PAGE_CHANNEL_VERSION,
    validateCheckpoint: validatePageCheckpoint,
    merge: mergePageUpdates,
  });
  channels.set(service, channel);
  return channel;
}

/**
 * One session's journal in the shared recovery store.
 *
 * Every local update is handed over as it happens: the bytes and the id are fixed
 * synchronously, so a buffer reused after the call cannot change what was written, and
 * the append resolves only once its transaction committed. Nothing here waits for the
 * room, the network or the editor. Compaction names only the records the store has
 * confirmed, because an append still in flight or refused has no revision to swap and
 * must keep exactly the bytes it was given.
 *
 * @param {Object} options
 * @param {Object} options.channel - the `page.yjs` channel api
 * @param {string} options.key - the document this episode belongs to
 * @param {Function|Object} options.context - (base) => Promise<context>, or the context
 * @param {?Uint8Array} [options.base] - the accepted state the episode started from
 * @returns {Object}
 */
export function createPageJournal({ channel, key, context, base = null, onChange = () => {} }) {
  const records = new Map();
  const waiting = [];
  const inflight = new Set();
  const bytesOfBase = bytesOf(base) ?? new Uint8Array(0);
  let resolved = null;
  let failure = null;
  let batches = 0;
  let batchBytes = 0;
  let episode = false;
  let compacting = null;
  let closed = false;

  const journal = {
    channel,
    key,
    onChange,
    context: () => ready,
    local: (bytes) => send(bytes, "local"),
    // Only while an episode is open: a peer's updates on their own are not this tab's work
    // to keep, and a page that has journaled nothing owns nothing.
    dependency: (bytes) => { if (episode) send(bytes, "dependency"); },
    records: () => [...records.values()],
    names,
    pending: () => inflight.size + (failure ? 1 : 0),
    get failure() { return failure; },
    retire,
    compact,
    // An acknowledgement is metadata: it says a room holds the bytes and retires nothing.
    acknowledged: () => {
      if (closed || !resolved || !records.size || typeof channel.markAcknowledged !== "function") return Promise.resolve(null);
      return Promise.resolve(channel.markAcknowledged({ records: names(), authority: resolved.authority })).catch(() => null);
    },
    close: () => {
      closed = true;
      waiting.length = 0;
    },
  };

  const ready = Promise.resolve()
    .then(() => (typeof context === "function" ? context(bytesOfBase) : context))
    .catch(() => null)
    .then((value) => {
      resolved = value && value.authority ? value : null;
      if (!resolved) {
        closed = true;
        failure = "unavailable";
        waiting.length = 0;
        journal.onChange();
        return null;
      }
      for (const run of waiting.splice(0)) run(resolved);
      return resolved;
    });

  function retire(list) {
    for (const item of list || []) records.delete(journalKey(item?.id));
  }

  function names() {
    return [...records.values()].map(({ id, revision }) => ({ id, revision }));
  }

  function compact() {
    if (compacting || closed || !records.size || typeof channel.compact !== "function") return compacting;
    const named = names();
    compacting = Promise.resolve()
      .then(() => channel.compact({ records: named }))
      .then((receipt) => {
        if (!receipt?.ok) return receipt;
        retire(receipt.retired);
        batches = Math.max(0, batches - (receipt.retired?.length ?? 0));
        if (!batches) batchBytes = 0;
        return receipt;
      })
      .catch(() => null)
      .then((receipt) => {
        compacting = null;
        journal.onChange();
        return receipt;
      });
    return compacting;
  }

  function write(context, bytes, origin, first) {
    let answer;
    try {
      answer = channel.append({ key, context, update: bytes, origin, base: first ? bytesOfBase : null });
    } catch (_) {
      failure = "error";
      journal.onChange();
      return;
    }
    const token = {};
    inflight.add(token);
    Promise.resolve(answer).then(
      (receipt) => {
        inflight.delete(token);
        if (!receipt || receipt.ok !== true) {
          failure = receipt?.code ?? "error";
          journal.onChange();
          return;
        }
        failure = null;
        if (!receipt.skipped) {
          records.set(journalKey(receipt.id), { id: receipt.id, revision: receipt.revision, update: bytes, context });
          batches += 1;
          batchBytes += bytes.byteLength;
        }
        journal.onChange();
        if (batches >= COMPACT_BATCHES || batchBytes >= COMPACT_BYTES) compact();
      },
      () => {
        inflight.delete(token);
        failure = "error";
        journal.onChange();
      },
    );
  }

  function send(bytes, origin) {
    if (closed || !bytes || !bytes.byteLength || typeof channel.append !== "function") return;
    const first = !episode;
    episode = true;
    if (resolved) write(resolved, bytes, origin, first);
    else waiting.push((context) => write(context, bytes, origin, first));
  }

  return journal;
}

/**
 * This session's journal, opened from the host's own answer, or null.
 *
 * A host that cannot name who is writing, or a tab with no recovery service, journals
 * nothing: a page that cannot pin its identity never replays across sessions.
 *
 * @param {Object} options
 * @param {?Object} options.meta - the host's discovery answer
 * @param {Object} options.service - `clay.recovery`
 * @param {?Uint8Array} options.base - the accepted state captured before input
 * @param {Function} [options.onChange]
 * @returns {?Object}
 */
export function openPageJournal({ meta = null, service = null, base = null, onChange = () => {}, location, root } = {}) {
  const authority = pageAuthority({ meta, location, root });
  if (!authority) return null;
  const channel = pageChannel(service);
  if (!channel) return null;
  const generation = meta?.document?.pageState?.generation ?? null;
  const formatFloor = Array.isArray(meta?.extensions) && meta.extensions.includes("page-format-v1") ? 1 : 0;
  return createPageJournal({
    channel,
    key: [authority.host, authority.documentId].join(":"),
    context: (accepted) => pageJournalContext({ authority, generation, base: accepted, formatFloor }),
    base,
    onChange,
  });
}

/**
 * Replay this page's journal once, after the authority snapshot is adopted.
 *
 * @param {{journal: Object, state: Object, into: Object}} options
 * @returns {Promise<{replayed: Array<Object>, review: Array<Object>}>}
 */
export async function replayInto({ journal, state, into } = {}) {
  if (!journal) return { replayed: [], review: [] };
  const context = await journal.context();
  if (!context) return { replayed: [], review: [] };
  const listed = await journal.channel.list();
  if (!listed?.ok) return { replayed: [], review: [] };
  return replayJournals({ records: listed.records, current: { context, state }, into });
}
