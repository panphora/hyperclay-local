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
import { registerUnsavedState } from "../../lib/unsaved-state.js";

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
 * merge. A capsule with no owned work has nothing to restore and is skipped silently, and
 * so is one from the generation before a save that already holds all its work: that save
 * reached the file after its tab stopped listening for the answer.
 *
 * @param {{records?: Array<Object>, current: {context: Object, state: Object}, into: Object}} options
 * @returns {{replayed: Array<Object>, review: Array<Object>}}
 */
function alreadyHeld(entry, current) {
  try {
    const { owned } = accumulateCapsule({ capsule: entry.capsule, batches: entry.batches });
    return owned.length > 0 && containsUpdate(canonicalPageBytes(current.state), owned);
  } catch {
    return false;
  }
}

export function replayJournals({ records = [], current, into } = {}) {
  const replayed = [];
  const review = [];
  for (const entry of capsulesOf(records)) {
    let parts;
    try {
      parts = admitCapsule({ capsule: entry.capsule, batches: entry.batches, current });
    } catch (error) {
      if (error?.code === "nothing-owned" || (error?.code === "foreign-generation" && alreadyHeld(entry, current))) continue;
      review.push({ capsule: entry.capsule, batches: entry.batches, code: error?.code ?? "invalid-capsule", message: error?.message ?? "This journal cannot be replayed" });
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
 * `scope` records how the document was named. A host that gives the document an identity
 * of its own is `"host"`; a host that gives it none, a local file among them, is `"path"`,
 * and then the exact pathname is the whole of what this page's identity is.
 *
 * @param {Object} [options]
 * @param {?Object} [options.meta] - the host's discovery answer
 * @param {?Location} [options.location]
 * @param {?Element} [options.root]
 * @returns {?{host: string, documentId: string, principalId: string, scope: "host"|"path"}}
 */
export function pageAuthority({ meta = null, location: where = globalThis.location, root = globalThis.document?.documentElement } = {}) {
  const host = where?.origin ?? "";
  if (!host) return null;
  const hostIdentity = hostIdentityOf(root);
  const scope = hostIdentity ? "host" : "path";
  const documentId = hostIdentity?.identity ?? pathIdentityOf(where?.pathname ?? "/").identity;
  if (!documentId) return null;
  const people = meta?.document?.people;
  const principalId = people && typeof people === "object" ? people.me?.id ?? null : documentId;
  if (!principalId) return null;
  return { host, documentId, principalId, scope };
}

const journalKey = (id) => (typeof id === "string" ? id : JSON.stringify(id));

// Is `next` a later accepted state than `base`? A state vector only grows, so one that
// is behind the base anywhere is an older save that finished late.
function newer(next, base) {
  if (!base.length) return true;
  const ahead = Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(base));
  const behind = Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(next));
  for (const [client, clock] of ahead) if ((behind.get(client) ?? 0) < clock) return false;
  return true;
}

// The part of a capsule the new base does not already hold: work a compaction merged in
// before the save that covered it reads as nothing once that save is the base.
function unsaved(base, part) {
  const bytes = bytesOf(part);
  if (!bytes || !bytes.length) return new Uint8Array(0);
  return containsUpdate(base, bytes) ? new Uint8Array(0) : bytes;
}

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
  const awaiting = [];
  const inflight = new Set();
  let bytesOfBase = bytesOf(base) ?? new Uint8Array(0);
  let resolved = null;
  let failure = null;
  let batches = 0;
  let batchBytes = 0;
  let episode = false;
  let carryBase = true;
  let holding = false;
  let rebasing = Promise.resolve(null);
  let compacting = null;
  let closed = false;

  const journal = {
    channel,
    key,
    onChange,
    // The context of the base the journal holds now: an accepted save moves it.
    context: () => ready.then(() => resolved),
    local: (bytes) => send(bytes, "local"),
    // Only while an episode is open: a peer's updates on their own are not this tab's work
    // to keep, and a page that has journaled nothing owns nothing.
    dependency: (bytes) => { if (episode) send(bytes, "dependency"); },
    records: () => [...records.values()],
    names,
    // The next record this journal commits, or null when the store refuses one or the
    // session closes: the destination a copy names is only real once it is on this device.
    next: () => new Promise((resolve) => { awaiting.push(resolve); }),
    // Does the work this journal holds carry exactly this block's text? The episode's own
    // base is here, so the answer needs no store and no page.
    covers: (blockId, text) => {
      const owned = [...records.values()].map((record) => record.update).filter((update) => update && update.byteLength);
      const capsule = {
        kind: "binary",
        version: 1,
        id: "journal",
        revision: 0,
        payload: {
          base: bytesOfBase,
          dependencies: new Uint8Array(0),
          owned: owned.length ? Y.mergeUpdatesV2(owned) : new Uint8Array(0),
        },
      };
      return coversText([capsule], blockId, text);
    },
    pending: () => inflight.size + (holding ? waiting.length : 0) + (failure ? 1 : 0),
    get failure() { return failure; },
    retire,
    rebase,
    compact,
    // An acknowledgement is metadata: it says a room holds the bytes and retires nothing.
    acknowledged: () => {
      if (closed || !resolved || !records.size || typeof channel.markAcknowledged !== "function") return Promise.resolve(null);
      return Promise.resolve(channel.markAcknowledged({ records: names(), authority: resolved.authority })).catch(() => null);
    },
    close: () => {
      closed = true;
      waiting.length = 0;
      settle(null);
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

  function settle(value) {
    for (const resolve of awaiting.splice(0)) resolve(value);
  }

  function retire(list) {
    for (const item of list || []) records.delete(journalKey(item?.id));
  }

  // An accepted save is the base the next replay starts from: the page reopens on it,
  // and the batches it retired are no longer there to build on. Rebases run one at a
  // time, appends wait for them, and a save older than the base already held is ignored.
  function rebase(state) {
    rebasing = rebasing.then(() => moveBase(bytesOf(state))).catch(() => null);
    return rebasing;
  }

  async function moveBase(next) {
    if (closed || !resolved || !next || !next.length || !newer(next, bytesOfBase)) return null;
    holding = true;
    try {
      while (inflight.size && !closed) await journal.next();
      if (closed) return null;
      const moved = typeof context === "function" ? await context(next) : context;
      if (!moved || !moved.authority) return null;
      if (episode) {
        const answer = typeof channel.rebase === "function"
          ? await channel.rebase({
              key,
              context: moved,
              rebuild: (payload) => ({
                base: next,
                dependencies: unsaved(next, payload.dependencies),
                owned: unsaved(next, payload.owned),
              }),
            })
          : null;
        // A writer whose capsule never reached the store starts its next one on this base.
        if (answer?.code === "missing") carryBase = true;
        else if (!answer?.ok) return null;
      }
      bytesOfBase = next;
      resolved = moved;
      for (const record of records.values()) record.context = moved;
      return moved;
    } finally {
      holding = false;
      if (resolved) for (const run of waiting.splice(0)) run(resolved);
    }
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
      settle(null);
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
          settle(null);
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
        settle({ id: receipt.id, revision: receipt.revision });
        if (batches >= COMPACT_BATCHES || batchBytes >= COMPACT_BYTES) compact();
      },
      () => {
        inflight.delete(token);
        failure = "error";
        settle(null);
        journal.onChange();
      },
    );
  }

  function dispatch(context, bytes, origin) {
    const first = carryBase;
    carryBase = false;
    write(context, bytes, origin, first);
  }

  function send(bytes, origin) {
    if (closed || !bytes || !bytes.byteLength || typeof channel.append !== "function") return;
    episode = true;
    if (resolved && !holding) dispatch(resolved, bytes, origin);
    else waiting.push((context) => dispatch(context, bytes, origin));
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
 * Where this tab's typing lives, and the wait that lets an exit leave edit.
 *
 * The answer is only ever as strong as the evidence behind it: a write whose transaction
 * has not committed is Pending, committed records are Stored, a room's confirmation makes
 * them Shared, and only a checkpoint that covers them makes the page Saved. The same
 * handle is the exit's barrier for the journal: every append already handed over commits,
 * and the store's own writes are down, before it answers. A journal that cannot write at
 * all holds nothing and says so once, as Unavailable, so a person is never stranded in
 * edit by a device that has stopped taking bytes.
 *
 * @param {Object} options
 * @param {Object} options.journal - this session's page journal
 * @param {?Object} [options.store] - the live page store, for its confirmations
 * @param {Function} [options.reduce] - the precedence reducer, (facts) => state or null
 * @param {Function} [options.onState] - (state) for every state the facts change to
 * @param {Function} [options.onUnavailable] - (code) when the journal cannot write
 * @returns {{checkpoint: Function, state: Function, dispose: Function}}
 */
export function watchJournal({ journal, store = null, reduce = () => null, onState = () => {}, onUnavailable = () => {} } = {}) {
  if (!journal) return { checkpoint() {}, state: () => null, dispose() {} };
  const seen = { acknowledged: false, checkpointed: false };
  let last = null;
  const state = () => {
    const failure = journal.failure ?? null;
    const records = journal.records().length;
    return reduce({
      unavailable: Boolean(failure),
      pending: failure ? 0 : journal.pending(),
      journaled: seen.acknowledged ? 0 : records,
      acknowledged: seen.acknowledged ? records : 0,
      checkpointed: seen.checkpointed && !records,
    });
  };
  const publish = () => {
    const next = state();
    if (!next || next === last) return last;
    last = next;
    if (next === "unavailable") onUnavailable(journal.failure);
    else onState(next);
    return next;
  };
  // The binding owns this callback and hears every append and refusal through it.
  const inner = journal.onChange;
  journal.onChange = () => { inner?.(); publish(); };
  // Work handed over now is work no room has seen and no checkpoint covers.
  const offLocal = store?.onLocal?.(() => {
    seen.acknowledged = false;
    seen.checkpointed = false;
    publish();
  });
  const offConfirm = store?.onConfirm?.(() => {
    seen.acknowledged = true;
    publish();
  });
  const blocked = () => Boolean(journal.failure);
  const source = registerUnsavedState({
    id: "page:journal",
    isPending: () => !blocked() && journal.pending() > 0,
    flush: async () => {
      if (blocked()) return { ok: true };
      while (!blocked() && journal.pending() > 0) {
        if (!(await journal.next())) break;
      }
      await Promise.resolve(journal.channel?.flush?.()).catch(() => null);
      return { ok: blocked() || journal.pending() === 0 };
    },
  });
  publish();
  return {
    checkpoint() {
      seen.checkpointed = true;
      publish();
    },
    state,
    dispose() {
      journal.onChange = inner;
      offLocal?.();
      offConfirm?.();
      source.dispose();
    },
  };
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

const posOf = (block) => (typeof block?.pos === "string" ? block.pos : "");
const idsInOrder = (blocks) =>
  Object.keys(blocks).sort((a, b) => {
    const left = posOf(blocks[a]);
    const right = posOf(blocks[b]);
    if (left !== right) return left < right ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

// The text of one block, cells included: what a person reads in a review, and what an
// insert-as-text offers back.
function blockText(block) {
  if (typeof block?.c === "string") return block.c;
  if (!block?.rows) return "";
  const parts = [];
  for (const row of Object.values(block.rows)) {
    for (const cell of Object.values(row?.cells ?? {})) {
      const text = typeof cell === "string" ? cell : typeof cell?.c === "string" ? cell.c : "";
      if (text) parts.push(text);
    }
  }
  return parts.join(" ");
}

/**
 * The page a set of records reconstructs, block by block.
 *
 * Records arrive in the store's shape — capsules with their batches — or as the updates
 * a live journal holds, and both read back as one page: they share a lineage, and Yjs
 * merges them by operation identity.
 *
 * @param {Array<Object>} [records]
 * @returns {?Object} the block model, by block id, or null when it cannot be decoded
 */
function pageOf(records = []) {
  const doc = new Y.Doc();
  try {
    for (const entry of capsulesOf(records)) {
      let parts;
      try {
        parts = accumulateCapsule(entry);
      } catch (_) {
        continue;
      }
      for (const bytes of [parts.base, parts.dependencies, parts.owned]) if (bytes.length) Y.applyUpdateV2(doc, bytes, NET);
    }
    for (const record of records || []) {
      const update = bytesOf(record?.update);
      if (update && update.length) Y.applyUpdateV2(doc, update, NET);
    }
    return blocksFromYValue({ v: 1, g: 0, y: { seed: toBase64(Y.encodeStateAsUpdateV2(doc)) } });
  } catch (_) {
    return null;
  } finally {
    doc.destroy();
  }
}

/**
 * The readable page a capsule reconstructs: one line per block, in the page's own order.
 *
 * A capsule that cannot be decoded at all reads as no text rather than as an error: a
 * review still says what it can, and nothing here decides whether it may be replayed.
 *
 * @param {{capsule: Object, batches?: Array<Object>}} options
 * @returns {string}
 */
export function reconstructText({ capsule, batches = [] } = {}) {
  let blocks;
  try {
    blocks = reconstructPage({ capsule, batches });
  } catch (_) {
    return "";
  }
  const lines = [];
  for (const id of idsInOrder(blocks)) {
    const text = blockText(blocks[id]);
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

/**
 * The review rows a page draws for the journals it may not replay.
 *
 * Each row keeps the capsule it came from, so the person can read it, download it or
 * copy its content, and nothing in a row is applied to the page.
 *
 * @param {Array<{capsule: Object, batches?: Array<Object>, code: string, message: string}>} [review]
 * @returns {Array<Object>}
 */
export function describeReview(review = []) {
  return (review || []).map((entry) => ({
    id: entry?.capsule?.id,
    revision: entry?.capsule?.revision ?? 0,
    code: entry?.code ?? "invalid-capsule",
    message: entry?.message ?? "This journal cannot be replayed",
    text: reconstructText({ capsule: entry?.capsule, batches: entry?.batches ?? [] }),
    capsule: entry?.capsule ?? null,
    batches: entry?.batches ?? [],
  }));
}

/**
 * Whether a capsule's own blocks reconstruct to exactly this text.
 *
 * Composition end asks this before retiring a shadow: an update the journal holds is a
 * transaction, and only a transaction carrying the same visible text means the typing
 * reached the document.
 *
 * @param {Array<Object>} records - the journal's records
 * @param {?string} blockId
 * @param {string} text
 * @returns {boolean}
 */
export function coversText(records = [], blockId = null, text = "") {
  const id = blockId == null ? "" : String(blockId);
  const want = typeof text === "string" ? text : "";
  if (!id || !want) return false;
  const blocks = pageOf(records);
  return Boolean(blocks && blocks[id] && blockText(blocks[id]) === want);
}

/** The channel that records where a reviewed capsule was copied to: one name, one version. */
export const COPY_CHANNEL = "page.copy";
export const COPY_VERSION = 1;

// One channel per service, registered the first time something is actually copied.
const copyChannels = new WeakMap();

/**
 * The copy-marker channel of one recovery service.
 *
 * @param {Object} service - `clay.recovery`
 * @returns {?Object} the channel api
 */
export function pageCopyChannel(service) {
  if (!service) return null;
  const existing = copyChannels.get(service);
  if (existing) return existing;
  const channel = service.register({ channel: COPY_CHANNEL, version: COPY_VERSION });
  copyChannels.set(service, channel);
  return channel;
}

const copyKey = (source) => `copy:${source?.key ?? ""}:${identityKey(source?.id)}`;

/**
 * The transfer marker naming one capsule's copy, if this store has one.
 *
 * @param {{records?: Array<Object>, source: {key: string, id: *}}} options
 * @returns {?{record: Object, source: Object, destination: Object}}
 */
export function markerFor({ records = [], source = null } = {}) {
  if (!source || source.id === undefined) return null;
  for (const record of records || []) {
    const payload = record?.payload;
    if (!payload?.source || !payload?.destination) continue;
    if (payload.source.key !== source.key) continue;
    if (identityKey(payload.source.id) !== identityKey(source.id)) continue;
    return { record, source: payload.source, destination: payload.destination };
  }
  return null;
}

/**
 * What one marker says about the copy it names.
 *
 * "copied" while the destination record is still in the journal: the copy is on this
 * device and nothing has proved it saved. "covered" once the destination is gone from
 * the journal, which only a checkpoint (or a dismissed destination) can do.
 *
 * @param {{marker: ?Object, records?: Array<Object>}} options
 * @returns {string} "open", "copied" or "covered"
 */
export function copyState({ marker = null, records = [] } = {}) {
  if (!marker?.destination) return "open";
  const id = marker.destination.id;
  const kept = (records || []).some((record) => record && identityKey(record.id) === identityKey(id));
  return kept ? "copied" : "covered";
}

/**
 * Insert a reviewed capsule's content as a copy, with fresh block ids.
 *
 * The content goes in through `insert`, which is the page's own document command and
 * names the destination record it committed; nothing of the capsule's Yjs operations is
 * merged into this page, so a changed lineage is never merged blindly. The source
 * capsule is not retired here: it survives until a checkpoint covers the destination,
 * and the marker written last says where that destination is. A copy already on this
 * device is never made twice, and a refused or failed insert leaves the source exactly
 * where it was.
 *
 * @param {Object} options
 * @param {Object} options.channel - the `page.yjs` channel api
 * @param {Object} options.copies - the copy-marker channel api
 * @param {{key: string, id: *, revision: number}} options.source
 * @param {Function} options.insert - () => Promise<{key: string, id: *, revision: number}>
 * @returns {Promise<{ok: boolean, code?: string, destination?: Object, marker?: Object}>}
 */
export async function recoverAsCopy({ channel, copies, source, insert } = {}) {
  if (!channel || !copies || !source || typeof insert !== "function") return { ok: false, code: "unavailable" };
  let list;
  let marks;
  try {
    [list, marks] = await Promise.all([channel.list(), copies.list()]);
  } catch (_) {
    return { ok: false, code: "unavailable" };
  }
  const marker = markerFor({ records: marks?.ok ? marks.records : [], source });
  if (marker) {
    const state = copyState({ marker, records: list?.ok ? list.records : [] });
    if (state === "copied") return { ok: false, code: "already-copied", marker };
    if (state === "covered") return { ok: false, code: "covered", marker };
  }
  let destination;
  try {
    destination = await insert();
  } catch (_) {
    return { ok: false, code: "insert-failed" };
  }
  if (!destination || destination.revision === undefined || destination.id === undefined) return { ok: false, code: "insert-failed" };
  copies.stage({
    key: copyKey(source),
    kind: "text",
    payload: {
      source: { key: source.key ?? "", id: source.id, revision: source.revision ?? 0 },
      destination: { key: destination.key ?? "", id: destination.id, revision: destination.revision },
    },
  });
  const written = await copies.flush();
  if (!written?.ok) return { ok: false, code: written?.code || "error", destination };
  return { ok: true, destination };
}

/** The channel a composition's visible text is kept on while it is not a transaction. */
export const IME_CHANNEL = "page.ime";
export const IME_VERSION = 1;

const IME_PREFIX = "composing:";

const imeChannels = new WeakMap();

/**
 * The composition-shadow channel of one recovery service.
 *
 * @param {Object} service - `clay.recovery`
 * @returns {?Object} the channel api
 */
export function pageImeChannel(service) {
  if (!service) return null;
  const existing = imeChannels.get(service);
  if (existing) return existing;
  const channel = service.register({ channel: IME_CHANNEL, version: IME_VERSION });
  imeChannels.set(service, channel);
  return channel;
}

/**
 * The shadow one composing block's visible text is kept under.
 *
 * Composition is never forced into a transaction: while it is active the block's text is
 * staged on a text channel, so a crash offers it as text. Composition end retires the
 * shadow only when a journaled update carries the same text — `covered`, or answered
 * from the records given — and anything else is kept and offered, because that typing
 * never reached the document.
 *
 * @param {{channel: ?Object, key: string}} options
 * @returns {?Object}
 */
export function openImeShadow({ channel = null, key = "" } = {}) {
  if (!channel) return null;

  async function drop(blockId) {
    let listed;
    try {
      listed = await channel.list();
    } catch (_) {
      return 0;
    }
    if (!listed?.ok) return 0;
    let retired = 0;
    for (const record of listed.records) {
      if (record?.payload?.blockId !== blockId) continue;
      try {
        const receipt = await channel.dismiss(record.id, { revision: record.revision });
        if (receipt?.ok) retired += 1;
      } catch (_) {}
    }
    return retired;
  }

  return {
    key,
    channel,
    keep({ blockId = null, text = "" } = {}) {
      const id = blockId == null ? "" : String(blockId);
      const value = typeof text === "string" ? text : "";
      if (!id || !value) return null;
      return channel.stage({ key: `${IME_PREFIX}${id}`, kind: "text", payload: { blockId: id, text: value } });
    },
    async clear({ blockId = null, text = "", covered = null, records = [] } = {}) {
      const id = blockId == null ? "" : String(blockId);
      if (!id) return { ok: false, code: "invalid" };
      const carried = typeof covered === "boolean" ? covered : coversText(records, id, text);
      if (!carried) return { ok: false, code: "not-covered" };
      const retired = await drop(id);
      return retired ? { ok: true, retired } : { ok: false, code: "not-covered" };
    },
    async list() {
      return channel.list();
    },
    dispose() {
      return channel.flush();
    },
  };
}

/**
 * The composition shadows a page's store holds as reviewable text.
 *
 * @param {Array<Object>} [records] - the composition channel's records
 * @returns {Array<{id: *, revision: number, blockId: string, text: string}>}
 */
export function imeEntries(records = []) {
  const out = [];
  for (const record of records || []) {
    if (!record || record.supported === false) continue;
    const payload = record.payload;
    if (!payload || typeof payload.text !== "string" || !payload.text) continue;
    if (typeof payload.blockId !== "string" || !payload.blockId) continue;
    out.push({ id: record.id, revision: record.revision, blockId: payload.blockId, text: payload.text });
  }
  return out;
}
