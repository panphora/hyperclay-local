/**
 * recovery.js — `clay.recovery`, the shared local recovery service.
 *
 * One store per document and mode, and one API every edit-mode document can use:
 * an app registers a channel for the records it can journal and gets back an object
 * whose methods work immediately. The core here is the queue and the status; the
 * IndexedDB implementation and the identity that scopes it are imported only when a
 * channel registers, so a page that journals nothing downloads neither, and a reader
 * never opens the database at all.
 *
 * This is a recovery copy, not a save. Nothing here is allowed to become proof that
 * the host accepted anything: a completed transaction means this browser kept a
 * copy, and that is all it means. HTML stays the saved source, and a page never
 * renders from these records.
 *
 * A document is covered only for the channels its adapters register. There is no
 * whole-document observer behind this, by design.
 */

import { mode as pageMode } from "./is-edit-mode.js";

// Replaceable text is debounced after typing stops, and forced out after five
// seconds of continuous typing so a fast writer is never more than that behind.
const DEBOUNCE_MS = 500;
const MAX_INTERVAL_MS = 5000;

const TEXT = "text";

// Compaction thresholds: 64 batch records or 1 MiB of batch bytes, whichever comes
// first, merged into the writer's capsule. A merge is never in the typing path.
const COMPACT_BATCHES = 64;
const COMPACT_BYTES = 1024 * 1024;

// How much uncommitted work one channel holds in memory when the database refuses a
// write. Refusing a further append is loud and visible; dropping an older one is not.
const MAX_QUEUED_BATCHES = 256;
const MAX_QUEUED_BYTES = 1024 * 1024;

function pageWriterId() {
  const minted = globalThis.crypto?.randomUUID?.();
  if (minted) return minted;
  return `wr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function recordKey(id) {
  return Array.isArray(id) ? id.join("\u0000") : String(id);
}

function sameId(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((part, at) => part === right[at]);
  }
  return left === right;
}

function mintedId(revision) {
  return globalThis.crypto?.randomUUID?.() ?? `rec-${revision}-${Math.random().toString(36).slice(2)}`;
}

function copyPayload(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  return value;
}

/**
 * Is this saved payload exactly the writing that was staged?
 *
 * Both sides use the adapter's fixed field order and every field is compared as it
 * stands, so a body that differs anywhere is different writing. Nothing is trimmed,
 * normalized or parsed: a save proves it holds these exact bytes or it proves
 * nothing, and a near match is what would delete the only copy of something.
 *
 * @param {*} saved - what the adapter read out of the accepted HTML
 * @param {*} staged - what the caller staged
 * @returns {boolean}
 */
function payloadsMatch(saved, staged) {
  if (saved === staged) return true;
  if (!saved || !staged || typeof saved !== "object" || typeof staged !== "object") return false;
  if (saved instanceof Uint8Array || staged instanceof Uint8Array) {
    if (!(saved instanceof Uint8Array) || !(staged instanceof Uint8Array)) return false;
    if (saved.length !== staged.length) return false;
    for (let at = 0; at < saved.length; at++) if (saved[at] !== staged[at]) return false;
    return true;
  }
  const left = Object.keys(staged);
  const right = Object.keys(saved);
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at++) {
    if (left[at] !== right[at]) return false;
    if (staged[left[at]] !== saved[right[at]]) return false;
  }
  return true;
}

// Every service in this page, so a save can hand its capture to each of them
// without save.js importing one particular instance. A service with no channel
// registered has no candidates and answers without touching the HTML.
const services = new Set();

/**
 * Pin what one save capture's exact bytes cover, before the request goes out.
 *
 * Called by save.js with the capture's own serialized bytes and its id. Nothing is
 * acknowledged here: only the settled result of this very capture can clear a copy.
 *
 * @param {{captureId: *, html: string}} capture
 */
export function noteRecoveryCapture({ captureId, html } = {}) {
  if (!services.size) return;
  for (const service of services) service.capture(captureId, html);
}

/**
 * Report how a capture settled.
 *
 * Only a confirmed success acknowledges, and only for the capture whose exact bytes
 * covered a revision. A skip, a refusal, an error and an unknown outcome release the
 * capture and clear nothing.
 *
 * @param {{captureId: *, ok: boolean, etag: ?string}} settled
 */
export function noteRecoverySettled({ captureId, ok = false, etag = null } = {}) {
  if (!services.size) return;
  for (const service of services) service.settle(captureId, ok === true, etag);
}

/**
 * Build one recovery service.
 *
 * The returned object is what the loader publishes as `clay.recovery`. Its own
 * state is per page load: the writer id, the open database and the queue. Tests
 * and, later, an embedded caller can build another one without touching this page's.
 *
 * @param {Object} [options]
 * @param {string} [options.mode] - "edit" or "draft"
 * @param {string} [options.writerId]
 * @param {?IDBFactory} [options.indexedDB]
 * @param {number} [options.maxScopeBytes]
 * @param {number} [options.maxDbBytes]
 * @param {Function} [options.now]
 * @returns {Object}
 */
export function createRecovery({
  mode = pageMode === "draft" ? "draft" : "edit",
  writerId = pageWriterId(),
  indexedDB,
  maxScopeBytes,
  maxDbBytes,
  now,
} = {}) {
  const channels = new Map();
  const listeners = new Set();
  const captures = new Map();
  let prepared = null;
  let identity = null;
  let store = null;
  let status = { ok: true, code: null, durable: false };

  function snapshot() {
    return {
      ok: status.ok,
      code: status.code,
      durable: status.durable,
      usage: store?.status().usage ?? null,
      identityMismatch: identity ? identity.check().ok === false : false,
    };
  }

  function announce(entry) {
    const detail = {
      channel: entry.channel,
      status: snapshot(),
      count: entry.pending.size,
      revisions: [...entry.pending.values()].map(({ id, revision }) => ({ id, revision })),
    };
    for (const fn of entry.listeners) {
      try {
        fn(detail);
      } catch (_) {}
    }
    for (const fn of listeners) {
      try {
        fn(detail);
      } catch (_) {}
    }
  }

  // Once per failure episode, and once when it clears. A page whose storage is gone
  // must not queue a console line per keystroke, and a warning may only clear after
  // a transaction actually completed.
  function note(result) {
    if (result && result.ok) {
      const wasOk = status.ok;
      status = { ok: true, code: null, durable: true };
      if (!wasOk) for (const entry of channels.values()) announce(entry);
      return;
    }
    const code = result?.code || "error";
    if (status.ok || status.code !== code) {
      status = { ok: false, code, durable: false };
      for (const entry of channels.values()) announce(entry);
      return;
    }
    status = { ok: false, code, durable: false };
  }

  async function prepare() {
    const [{ createIdentity }, { createStore }] = await Promise.all([
      import("../recovery/identity.js"),
      import("../recovery/store.js"),
    ]);
    identity = createIdentity({ mode, writerId });
    store = createStore({ scope: identity.scope, indexedDB, maxScopeBytes, maxDbBytes, now });
    const opened = await store.open();
    // Reaching the database is not a durable copy. Only a completed write is.
    if (opened.ok) status = { ok: true, code: null, durable: false };
    else note(opened);
    return opened;
  }

  function ensurePrepared() {
    if (!prepared) {
      prepared = prepare().catch((err) => ({ ok: false, code: err?.name === "DataCloneError" ? "uncloneable" : "unavailable" }));
    }
    return prepared;
  }

  // What this service holds that one capture's exact bytes could cover. The saved
  // map is read once per channel per capture, and only when this service has a copy
  // that could be covered at all.
  function coverageOf(entry, html) {
    let saved;
    try {
      saved = entry.readSaved(html);
    } catch (_) {
      return [];
    }
    if (!saved || typeof saved.get !== "function") return [];
    const covered = [];
    for (const record of entry.held.values()) {
      if (record.kind !== TEXT) continue;
      if (!saved.has(record.key)) continue;
      if (!payloadsMatch(saved.get(record.key), record.payload)) continue;
      covered.push({ id: record.id, revision: record.revision });
    }
    return covered;
  }

  function capture(captureId, html) {
    if (captureId == null || typeof html !== "string") return;
    const covered = new Map();
    for (const entry of channels.values()) {
      if (typeof entry.readSaved !== "function" || !entry.held.size) continue;
      const list = coverageOf(entry, html);
      if (list.length) covered.set(entry.channel, list);
    }
    if (covered.size) captures.set(captureId, covered);
  }

  async function acknowledgeCovered(entry, covered, etag, captureId) {
    const opened = await ensurePrepared();
    if (!opened.ok) return;
    for (const { id, revision } of covered) {
      const receipt = await store.acknowledge(id, { revision, etag, captureId });
      note(receipt);
      const slot = recordKey(id);
      const held = entry.held.get(slot);
      if (held && held.revision <= revision) entry.held.delete(slot);
    }
    announce(entry);
  }

  // A settled save is the only thing that clears anything, and it clears exactly
  // what its own capture covered. The work joins the channel's write queue, so an
  // acknowledgement is ordered against every put this service has already queued:
  // a copy that reaches the database late meets the watermark it was refused by.
  function settle(captureId, ok, etag) {
    const covered = captures.get(captureId);
    if (!covered) return Promise.resolve();
    captures.delete(captureId);
    if (!ok) return Promise.resolve();
    const waits = [];
    for (const [channel, list] of covered) {
      const entry = channels.get(channel);
      if (!entry) continue;
      const run = () => acknowledgeCovered(entry, list, etag, captureId);
      entry.writing = entry.writing.then(run, run);
      waits.push(entry.writing);
    }
    return Promise.all(waits).then(() => undefined, () => undefined);
  }

  function schedule(entry) {
    const at = now?.() ?? Date.now();
    if (!entry.burstStart) entry.burstStart = at;
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, entry.burstStart + MAX_INTERVAL_MS - at));
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.burstStart = 0;
      flush(entry).catch(() => {});
    }, wait);
  }

  function stage(entry, { key, kind = TEXT, baseEtag = null, base = null, payload = null, lineage = null } = {}) {
    const name = key == null ? "" : String(key);
    if (!name) throw new TypeError("clay.recovery.stage needs a key");
    const at = now?.() ?? Date.now();
    const revision = ++entry.revision;
    const id = kind === TEXT ? [entry.channel, name, writerId] : (globalThis.crypto?.randomUUID?.() ?? `rec-${revision}-${Math.random().toString(36).slice(2)}`);
    const slot = recordKey(id);
    const previous = entry.pending.get(slot);
    const record = {
      id,
      kind,
      channel: entry.channel,
      version: entry.version,
      key: name,
      writerId,
      revision,
      status: "journaled",
      baseEtag,
      base: copyPayload(base),
      payload: copyPayload(payload),
      lineage,
      created: previous?.created ?? at,
      updated: at,
    };
    entry.pending.set(slot, record);
    entry.held.set(slot, { id, kind, key: name, revision, payload: record.payload });
    schedule(entry);
    announce(entry);
    return { id, revision };
  }

  async function writePending(entry) {
    const batch = [...entry.pending.values()];
    if (!batch.length) return { ok: true, stored: [] };
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code };
    const stored = [];
    let failure = null;
    for (const record of batch) {
      const receipt = await store.put(record);
      if (receipt.ok) {
        const slot = recordKey(record.id);
        if (entry.pending.get(slot) === record) entry.pending.delete(slot);
        if (receipt.skipped) {
          const held = entry.held.get(slot);
          if (held && held.revision === record.revision) entry.held.delete(slot);
        } else {
          stored.push({ id: record.id, revision: record.revision });
        }
      } else {
        failure = failure || receipt.code || "error";
      }
    }
    note(failure ? { ok: false, code: failure } : { ok: true });
    announce(entry);
    return failure ? { ok: false, code: failure } : { ok: true, stored };
  }

  // --- the binary channel -------------------------------------------------------
  //
  // A page channel journals Yjs updates as bytes: one immutable capsule per writer
  // and key carrying the episode's base, its received dependencies and its owned
  // local work, plus one small batch per append. Nothing here knows what the bytes
  // mean; the merge and the checkpoint proof come from the registration.

  function binaryOf(entry, key) {
    return [entry.channel, key, writerId];
  }

  function capsuleFor(entry, capsuleId, context, at, base) {
    return {
      id: capsuleId,
      kind: "binary",
      channel: entry.channel,
      version: entry.version,
      writerId,
      revision: 0,
      context,
      payload: {
        base: base ?? new Uint8Array(0),
        dependencies: new Uint8Array(0),
        owned: new Uint8Array(0),
      },
      acknowledged: null,
      created: at,
      updated: at,
    };
  }

  function queueBatch(entry, record, capsule) {
    if (entry.batchQueue.size >= MAX_QUEUED_BATCHES) return false;
    if (entry.queuedBytes + record.payload.byteLength > MAX_QUEUED_BYTES) return false;
    entry.batchQueue.set(recordKey(record.id), { record, capsule });
    entry.queuedBytes += record.payload.byteLength;
    return true;
  }

  async function writeBatchQueue(entry) {
    if (!entry.batchQueue.size) return { ok: true };
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code };
    const stored = [];
    let failure = null;
    for (const [slot, item] of [...entry.batchQueue.entries()]) {
      const receipt = await store.appendBinary(item.record, item.capsule);
      if (!receipt.ok) {
        failure = failure || receipt.code || "error";
        continue;
      }
      entry.batchQueue.delete(slot);
      entry.queuedBytes = Math.max(0, entry.queuedBytes - item.record.payload.byteLength);
      if (receipt.skipped) continue;
      entry.batches += 1;
      entry.batchBytes += item.record.payload.byteLength;
      stored.push({ id: item.record.id, revision: item.record.revision });
    }
    note(failure ? { ok: false, code: failure } : { ok: true });
    announce(entry);
    return failure ? { ok: false, code: failure } : { ok: true, stored };
  }

  /**
   * Journal one binary update, and resolve only once it is on disk.
   *
   * The id, the revision and the bytes are fixed before the first await, so a caller
   * that reuses its buffer cannot change what was handed over, and a write that fails
   * keeps exactly those bytes for the next attempt. Failure is reported, never thrown:
   * the caller still holds the live document and has to say it is not durable.
   */
  async function append(entry, { key, context = null, update, origin = "local", base = null } = {}) {
    const name = key == null ? "" : String(key);
    if (!name) throw new TypeError("clay.recovery.append needs a key");
    if (!(update instanceof Uint8Array) && !(update instanceof ArrayBuffer)) {
      throw new TypeError("clay.recovery.append needs binary bytes");
    }
    const at = now?.() ?? Date.now();
    const revision = ++entry.revision;
    const capsuleId = binaryOf(entry, name);
    const record = {
      id: mintedId(revision),
      kind: "binary-batch",
      channel: entry.channel,
      version: entry.version,
      writerId,
      revision,
      capsuleId,
      origin: origin === "dependency" ? "dependency" : "local",
      context,
      payload: copyPayload(update),
      updated: at,
    };
    const capsule = capsuleFor(entry, capsuleId, context, at, base == null ? null : copyPayload(base));
    const opened = await ensurePrepared();
    if (!opened.ok) {
      if (!queueBatch(entry, record, capsule)) return { ok: false, code: "over-budget" };
      return { ok: false, code: opened.code };
    }
    const receipt = await store.appendBinary(record, capsule);
    note(receipt);
    announce(entry);
    if (!receipt.ok) {
      if (!queueBatch(entry, record, capsule)) return { ok: false, code: receipt.code };
      return { ok: false, code: receipt.code };
    }
    entry.batches += 1;
    entry.batchBytes += record.payload.byteLength;
    if (receipt.skipped) return { ok: true, id: record.id, revision, skipped: true };
    planCompaction(entry);
    return { ok: true, id: record.id, revision };
  }

  /**
   * Record that a room accepted the writer's work: metadata only, no bytes moved.
   */
  async function markAcknowledged(entry, { records = [], authority = null, epoch = null, sequence = null } = {}) {
    const observed = (records || []).filter((record) => record && record.id !== undefined && typeof record.revision === "number");
    if (!observed.length) return { ok: true, acknowledged: 0 };
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code };
    const receipt = await store.acknowledgeBinary({
      channel: entry.channel,
      version: entry.version,
      writerId,
      records: observed,
      authority,
      epoch,
      sequence,
    });
    note(receipt);
    announce(entry);
    return receipt.ok ? { ok: true, acknowledged: receipt.acknowledged } : { ok: false, code: receipt.code };
  }

  /**
   * Retire records a proof covers.
   *
   * The validator runs here, before any transaction is opened and never inside one,
   * and may only narrow the caller's own list: an id and revision the caller did not
   * observe can never be retired, whoever returns it. Without a validator nothing is
   * retired, because nothing has been proved.
   */
  async function checkpoint(entry, { records = [], proof = null } = {}) {
    const observed = (records || []).filter((record) => record && record.id !== undefined && typeof record.revision === "number");
    if (!observed.length) return { ok: true, retired: [] };
    if (typeof entry.validateCheckpoint !== "function") return { ok: true, retired: [] };
    let answer;
    try {
      answer = await entry.validateCheckpoint(proof, observed.map(({ id, revision }) => ({ id, revision })));
    } catch (_) {
      return { ok: false, code: "invalid", retired: [] };
    }
    if (!Array.isArray(answer)) return { ok: false, code: "invalid", retired: [] };
    const covered = observed.filter((record) =>
      answer.some((item) => item && item.revision === record.revision && sameId(item.id, record.id))
    );
    if (!covered.length) return { ok: true, retired: [] };
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code, retired: [] };
    const receipt = await store.checkpointBinary({
      channel: entry.channel,
      version: entry.version,
      writerId,
      records: covered,
    });
    note(receipt);
    announce(entry);
    return receipt.ok ? { ok: true, retired: receipt.retired } : { ok: false, code: receipt.code, retired: [] };
  }

  function withBytes(value) {
    return value && typeof value.byteLength === "number" && value.byteLength > 0 ? value : null;
  }

  /**
   * Merge the observed batches into their capsule, outside any transaction, then swap.
   *
   * A swap that lost the head re-reads everything and tries again, so a compaction
   * that raced an append or another compaction never deletes input it did not merge.
   */
  async function swapBatches(entry, observed) {
    for (let tries = 0; tries < 3; tries++) {
      let capsuleId = null;
      const inputs = [];
      for (const { id, revision } of observed) {
        const read = await store.get(id);
        if (!read.ok || !read.record) continue;
        const record = read.record;
        if (record.revision !== revision || record.kind !== "binary-batch" || !record.capsuleId) continue;
        if (!capsuleId) capsuleId = record.capsuleId;
        if (!sameId(capsuleId, record.capsuleId)) continue;
        inputs.push(record);
      }
      if (!capsuleId || !inputs.length) return { ok: true, retired: [] };
      const head = await store.get(capsuleId);
      if (!head.ok || !head.record) return { ok: false, code: "missing" };
      const capsule = head.record;
      const owned = [withBytes(capsule.payload?.owned), ...inputs.filter((record) => record.origin !== "dependency").map((record) => withBytes(record.payload))].filter(Boolean);
      const dependencies = [
        withBytes(capsule.payload?.dependencies),
        ...inputs.filter((record) => record.origin === "dependency").map((record) => withBytes(record.payload)),
      ].filter(Boolean);
      const mergedOwned = owned.length ? copyPayload(await entry.merge(owned)) : new Uint8Array(0);
      const mergedDependencies = dependencies.length ? copyPayload(await entry.merge(dependencies)) : new Uint8Array(0);
      const revision = Math.max(entry.revision, capsule.revision) + 1;
      entry.revision = revision;
      const swapped = await store.compactBinary({
        channel: entry.channel,
        version: entry.version,
        capsuleId,
        expectedRevision: capsule.revision,
        replacement: {
          revision,
          updated: now?.() ?? Date.now(),
          payload: {
            base: capsule.payload?.base ?? new Uint8Array(0),
            dependencies: mergedDependencies,
            owned: mergedOwned,
          },
        },
        inputs: inputs.map((record) => ({ id: record.id, revision: record.revision })),
      });
      if (swapped.ok) {
        entry.batches = 0;
        entry.batchBytes = 0;
        return { ok: true, retired: swapped.retired, revision: swapped.revision };
      }
      if (swapped.code !== "stale") return { ok: false, code: swapped.code };
    }
    return { ok: false, code: "stale" };
  }

  async function compact(entry, { records = [] } = {}) {
    if (typeof entry.merge !== "function") return { ok: false, code: "invalid", retired: [] };
    const observed = (records || []).filter((record) => record && record.id !== undefined && typeof record.revision === "number");
    if (!observed.length) return { ok: true, retired: [] };
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code, retired: [] };
    const receipt = await swapBatches(entry, observed);
    note(receipt);
    announce(entry);
    return receipt.ok ? { ok: true, retired: receipt.retired } : { ok: false, code: receipt.code, retired: [] };
  }

  function planCompaction(entry) {
    if (typeof entry.merge !== "function" || entry.compaction) return;
    if (entry.batches < COMPACT_BATCHES && entry.batchBytes < COMPACT_BYTES) return;
    entry.compaction = (async () => {
      const listed = await store.list();
      if (!listed.ok) return;
      const mine = listed.records.filter(
        (record) => record.channel === entry.channel && record.kind === "binary-batch" && record.writerId === writerId
      );
      if (!mine.length) return;
      await compact(entry, { records: mine.map(({ id, revision }) => ({ id, revision })) });
    })()
      .catch(() => {})
      .finally(() => {
        entry.compaction = null;
      });
  }

  function flush(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.burstStart = 0;
    const run = async () => {
      const queued = await writeBatchQueue(entry);
      if (!queued.ok) return queued;
      return writePending(entry);
    };
    entry.writing = entry.writing.then(run, run);
    return entry.writing;
  }

  async function list(entry) {
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code, records: [], status: snapshot() };
    const result = await store.list();
    note(result);
    if (!result.ok) return { ok: false, code: result.code, records: [], status: snapshot() };
    const records = result.records
      .filter((record) => record.channel === entry.channel)
      .map((record) => ({ ...record, supported: record.version === entry.version }));
    return { ok: true, records, status: snapshot() };
  }

  async function dismiss(entry, id, { revision } = {}) {
    const opened = await ensurePrepared();
    if (!opened.ok) return { ok: false, code: opened.code };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.burstStart = 0;
    await entry.writing;
    const slot = recordKey(id);
    const queued = entry.pending.get(slot);
    if (queued && (revision === undefined || queued.revision === revision)) entry.pending.delete(slot);
    const held = entry.held.get(slot);
    if (held && (revision === undefined || held.revision === revision)) entry.held.delete(slot);
    const receipt = await store.remove(id, { revision });
    note(receipt);
    announce(entry);
    return receipt.ok ? { ok: true, id, revision } : { ok: false, code: receipt.code };
  }

  function subscribe(entry, fn) {
    entry.listeners.add(fn);
    return () => entry.listeners.delete(fn);
  }

  function dispose(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.burstStart = 0;
    const flushed = flush(entry).catch(() => ({ ok: false, code: "aborted" }));
    entry.listeners.clear();
    channels.delete(entry.channel);
    if (!channels.size) services.delete(handle);
    return flushed;
  }

  const handle = { capture, settle };

  function channelApi(entry) {
    return {
      channel: entry.channel,
      version: entry.version,
      stage: (spec) => stage(entry, spec),
      flush: () => flush(entry),
      list: () => list(entry),
      dismiss: (id, options) => dismiss(entry, id, options),
      append: (spec) => append(entry, spec),
      markAcknowledged: (spec) => markAcknowledged(entry, spec),
      checkpoint: (spec) => checkpoint(entry, spec),
      compact: (spec) => compact(entry, spec),
      subscribe: (fn) => subscribe(entry, fn),
      dispose: () => dispose(entry),
    };
  }

  /**
   * Take responsibility for one kind of record in this document.
   *
   * Returns synchronously, before anything asynchronous has happened: the queue is
   * in memory from the first `stage`. A channel is a name, a version and, for text,
   * the two functions that let a review compare stored writing with a saved file
   * without a second implementation of the entry format.
   *
   * @param {Object} spec
   * @param {string} spec.channel
   * @param {number} [spec.version]
   * @param {Function} [spec.readSaved] - (html) => Map<key, payload>
   * @param {Function} [spec.describe] - (record) => {label, text}
   * @param {Function} [spec.validateCheckpoint] - (proof, records) => the subset a proof covers
   * @param {Function} [spec.merge] - (Uint8Array[]) => Uint8Array, the channel's own merge
   * @returns {Object}
   */
  function register({
    channel,
    version = 1,
    readSaved = null,
    describe = null,
    validateCheckpoint = null,
    merge = null,
  } = {}) {
    if (!channel || typeof channel !== "string") throw new TypeError("clay.recovery.register needs a channel name");
    const existing = channels.get(channel);
    if (existing) {
      throw new Error(`clay.recovery: the "${channel}" channel is already registered at version ${existing.version}`);
    }
    const entry = {
      channel,
      version,
      readSaved,
      describe,
      validateCheckpoint,
      merge,
      revision: 0,
      pending: new Map(),
      held: new Map(),
      batchQueue: new Map(),
      queuedBytes: 0,
      batches: 0,
      batchBytes: 0,
      compaction: null,
      timer: null,
      burstStart: 0,
      writing: Promise.resolve(),
      listeners: new Set(),
    };
    channels.set(channel, entry);
    services.add(handle);
    ensurePrepared();
    return channelApi(entry);
  }

  return {
    register,
    status: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const recovery = createRecovery();
