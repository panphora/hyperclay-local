/**
 * store.js — the IndexedDB half of the recovery service.
 *
 * One database per browser (`clay-recovery`), three stores:
 *
 *   records     every recovery copy, text keys and immutable ids alike
 *   watermarks  per text key, the revision an accepted save has proved it covers
 *   meta        the running byte totals the budgets are checked against
 *
 * Loaded only when an adapter registers (core/recovery.js imports it dynamically),
 * so a page that journals nothing never opens the database and never downloads this
 * file. It is also the reason a test-only IndexedDB stays out of the runtime: no
 * module here imports one.
 *
 * Durable means one completed IndexedDB transaction. It does not promise that the
 * browser will keep the bytes: storage can be evicted, and a suspended tab or a
 * power cut can lose the last write. Every failure is reported as a code rather
 * than thrown, because the caller has to keep the in-memory text and say so.
 *
 * Composite keys are arrays, never delimited strings: `[scope, channel, key,
 * writerId]` is a key no path with a `:` in it can collide with.
 */

export const DB_NAME = "clay-recovery";
export const DB_VERSION = 1;
export const RECORDS = "records";
export const WATERMARKS = "watermarks";
export const META = "meta";

export const SCOPE_BUDGET_BYTES = 32 * 1024 * 1024;
export const DB_BUDGET_BYTES = 64 * 1024 * 1024;

const OPEN_TIMEOUT_MS = 5000;
const BY_SCOPE = "byScope";
const TOTAL_USAGE = ["usage", "*"];

const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

function utf8Length(value) {
  return encoder ? encoder.encode(value).length : value.length * 2;
}

function valueBytes(value) {
  if (typeof value === "string") return utf8Length(value);
  if (value && typeof value.byteLength === "number" && (value instanceof Uint8Array || value instanceof ArrayBuffer)) return value.byteLength;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + valueBytes(item), 0);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return 8;
  if (!value || typeof value !== "object") return 0;
  let bytes = 0;
  for (const [field, item] of Object.entries(value)) bytes += utf8Length(field) + valueBytes(item);
  return bytes;
}

/**
 * What one record costs against the budgets: its strings measured as UTF-8, binary
 * payloads by their byte length, everything else by its serialized metadata.
 *
 * @param {Object} record
 * @returns {number}
 */
export function recordBytes(record) {
  if (!record || typeof record !== "object") return 0;
  let bytes = 0;
  for (const [field, value] of Object.entries(record)) bytes += utf8Length(field) + valueBytes(value);
  return bytes;
}

/**
 * The failure code a thrown IndexedDB error means to a caller.
 *
 * Only one of these is about this device being full (`quota`); the rest are about
 * the database being unreachable, refused, or mid-upgrade somewhere else. None of
 * them is a save result, and none of them is durable.
 *
 * @param {*} error
 * @returns {string}
 */
export function codeFor(error) {
  const name = error?.name || "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return "quota";
  if (name === "VersionError") return "unknown-schema";
  if (name === "DataCloneError") return "uncloneable";
  if (name === "AbortError") return "aborted";
  if (name === "TransactionInactiveError" || name === "InvalidStateError") return "aborted";
  if (name === "SecurityError" || name === "UnknownError" || name === "NotSupportedError") return "unavailable";
  return "error";
}

/**
 * Are these two plain values the same?
 *
 * Contexts are compared inside a transaction, never by reference: the caller builds
 * a fresh object for every operation, and the stored one came back through a
 * structured clone. Binary parts are compared byte for byte.
 *
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
function sameValue(left, right) {
  if (left === right) return true;
  if (left instanceof ArrayBuffer) left = new Uint8Array(left);
  if (right instanceof ArrayBuffer) right = new Uint8Array(right);
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
    if (left.length !== right.length) return false;
    for (let at = 0; at < left.length; at++) if (left[at] !== right[at]) return false;
    return true;
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((field) => Object.prototype.hasOwnProperty.call(right, field) && sameValue(left[field], right[field]));
}

/**
 * Has this writer already retired (checkpointed or compacted) this revision?
 *
 * @param {?Array<Array<number>>} ranges
 * @param {number} revision
 * @returns {boolean}
 */
function isRetired(ranges, revision) {
  if (!Array.isArray(ranges) || typeof revision !== "number") return false;
  for (const range of ranges) {
    if (Array.isArray(range) && revision >= range[0] && revision <= range[1]) return true;
  }
  return false;
}

/**
 * Add one retired revision to a writer's ranges.
 *
 * A page that journals for an hour retires thousands of revisions, and the entry has
 * to stay small for as long as the writer lives, so neighbouring revisions become a
 * range instead of a list. Nothing is ever dropped by age: the writer is still alive
 * and a queued write for any of these revisions must still be refused.
 *
 * @param {?Array<Array<number>>} ranges
 * @param {number} revision
 * @returns {Array<Array<number>>}
 */
function retireRange(ranges, revision) {
  const sorted = (Array.isArray(ranges) ? ranges : []).map((range) => [range[0], range[1]]);
  sorted.push([revision, revision]);
  sorted.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

function slotKey(slot) {
  return JSON.stringify(slot);
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cursorAll(source, key) {
  return new Promise((resolve, reject) => {
    const req = key === undefined ? source.openCursor() : source.openCursor(key);
    const out = [];
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
  });
}

function upgrade(db) {
  if (!db.objectStoreNames.contains(RECORDS)) {
    // Keyed by the full text key, `[scope, channel, key, writerId]`, so two documents
    // or two modes on one origin cannot collide on a local id. `slots` holds it
    // rather than `key`, which is the adapter's own name for what it is journaling.
    // Immutable records carry a unique id and use it as their slot.
    const records = db.createObjectStore(RECORDS, { keyPath: "slot" });
    records.createIndex(BY_SCOPE, "scope");
  }
  if (!db.objectStoreNames.contains(WATERMARKS)) {
    db.createObjectStore(WATERMARKS, { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains(META)) {
    db.createObjectStore(META, { keyPath: "key" });
  }
}

/**
 * Open (and, the first time, create) the recovery database.
 *
 * A version this build does not know is left alone: opening an older version than
 * the one on disk throws VersionError, which is reported as `unknown-schema` so the
 * caller can offer the stored bytes for download without migrating or dropping
 * them. A blocked upgrade is reported as `blocked` rather than waited on forever.
 *
 * @param {?IDBFactory} factory
 * @returns {Promise<{ok: boolean, code?: string, db?: IDBDatabase}>}
 */
export function openDatabase(factory = globalThis.indexedDB, { name = DB_NAME, version = DB_VERSION } = {}) {
  return new Promise((resolve) => {
    if (!factory || typeof factory.open !== "function") {
      resolve({ ok: false, code: "unavailable" });
      return;
    }
    let req;
    try {
      req = factory.open(name, version);
    } catch (err) {
      resolve({ ok: false, code: codeFor(err) });
      return;
    }
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(answer);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "blocked" }), OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opening a newer version needs this connection to stand aside,
      // or its upgrade sits blocked for as long as this page stays open.
      db.onversionchange = () => {
        try {
          db.close();
        } catch (_) {}
      };
      finish({ ok: true, db });
    };
    req.onerror = () => finish({ ok: false, code: codeFor(req.error) });
    req.onblocked = () => finish({ ok: false, code: "blocked" });
  });
}

/**
 * The durable half of one document's recovery store.
 *
 * @param {Object} options
 * @param {string[]} options.scope - `[origin, identityKind, identity, mode]`
 * @param {?IDBFactory} [options.indexedDB]
 * @param {Function} [options.now]
 * @param {number} [options.maxScopeBytes]
 * @param {number} [options.maxDbBytes]
 * @returns {Object}
 */
export function createStore({
  scope,
  indexedDB: factory = globalThis.indexedDB,
  now = () => Date.now(),
  maxScopeBytes = SCOPE_BUDGET_BYTES,
  maxDbBytes = DB_BUDGET_BYTES,
} = {}) {
  if (!Array.isArray(scope) || scope.length !== 4) throw new TypeError("createStore needs a four-part scope");

  let opening = null;
  let db = null;
  let openAnswer = null;
  const usage = { scopeBytes: 0, dbBytes: null, maxScopeBytes, maxDbBytes };

  const status = () => ({
    ok: openAnswer?.ok !== false,
    code: openAnswer?.code ?? null,
    durable: openAnswer?.ok === true,
    usage: { ...usage },
  });

  async function open() {
    if (!opening) {
      opening = openDatabase(factory).then((answer) => {
        openAnswer = answer.ok ? { ok: true } : { ok: false, code: answer.code };
        if (answer.ok) db = answer.db;
        return answer;
      });
    }
    return opening;
  }

  const scopeUsageKey = ["usage", ...scope];

  async function readUsageTotals(meta, records) {
    const [scopeEntry, totalEntry] = await Promise.all([
      request(meta.get(scopeUsageKey)),
      request(meta.get(TOTAL_USAGE)),
    ]);
    if (scopeEntry && totalEntry) return { scopeBytes: scopeEntry.value, dbBytes: totalEntry.value };
    const all = await cursorAll(records);
    const recomputed = { scopeBytes: 0, dbBytes: 0 };
    for (const record of all) {
      const bytes = record.bytes ?? recordBytes(record);
      recomputed.dbBytes += bytes;
      if (sameScope(record.scope)) recomputed.scopeBytes += bytes;
    }
    return recomputed;
  }

  async function writeUsageTotals(meta, totals) {
    usage.scopeBytes = totals.scopeBytes;
    usage.dbBytes = totals.dbBytes;
    await Promise.all([
      request(meta.put({ key: scopeUsageKey, value: totals.scopeBytes })),
      request(meta.put({ key: TOTAL_USAGE, value: totals.dbBytes })),
    ]);
  }

  function sameScope(other) {
    return Array.isArray(other) && other.length === 4 && other.every((part, at) => part === scope[at]);
  }

  // The durable slot for one record id. Text ids are local to their channel; the
  // scope goes in front of them here and nowhere else.
  function keyOf(id) {
    return Array.isArray(id) ? [...scope, ...id] : id;
  }

  function runWrite(body) {
    return new Promise((resolve) => {
      if (!db) {
        resolve({ ok: false, code: openAnswer?.code || "unavailable" });
        return;
      }
      let tx;
      try {
        tx = db.transaction([RECORDS, WATERMARKS, META], "readwrite");
      } catch (err) {
        resolve({ ok: false, code: codeFor(err) });
        return;
      }
      const wasUsage = { ...usage };
      let settled = false;
      let failure = null;
      let result = null;
      const finish = (answer) => {
        if (settled) return;
        settled = true;
        resolve(answer);
      };
      const abort = (code) => {
        if (!failure) failure = code;
        try {
          tx.abort();
        } catch (_) {}
      };
      // A transaction that did not commit rolled every byte back, so the in-memory
      // totals have to roll back with it: the next budget check reads them.
      tx.oncomplete = () => {
        if (failure) Object.assign(usage, wasUsage);
        finish(failure ? { ok: false, code: failure } : { ok: true, result });
      };
      tx.onerror = () => {
        if (!failure) failure = codeFor(tx.error);
      };
      tx.onabort = () => {
        Object.assign(usage, wasUsage);
        finish({ ok: false, code: failure || codeFor(tx.error) || "aborted" });
      };
      const ctx = {
        tx,
        records: tx.objectStore(RECORDS),
        watermarks: tx.objectStore(WATERMARKS),
        meta: tx.objectStore(META),
        abort,
      };
      Promise.resolve()
        .then(() => body(ctx))
        .then(
          (value) => {
            result = value;
          },
          (err) => abort(codeFor(err))
        );
    });
  }

  async function writeRecord(ctx, record) {
    const { records, watermarks, meta } = ctx;
    const existing = await request(records.get(record.slot));
    if (existing && existing.revision > record.revision) return { ok: true, skipped: true, id: record.id, revision: record.revision };
    if (record.kind === "text") {
      const mark = await request(watermarks.get(record.slot));
      if (mark && mark.ackRevision >= record.revision) return { ok: true, skipped: true, id: record.id, revision: record.revision };
    }
    const totals = await readUsageTotals(meta, records);
    const delta = record.bytes - (existing?.bytes ?? 0);
    if (totals.scopeBytes + delta > maxScopeBytes || totals.dbBytes + delta > maxDbBytes) {
      return { ok: false, code: "over-budget" };
    }
    if (existing?.created) record.created = existing.created;
    await request(records.put(record));
    await writeUsageTotals(meta, { scopeBytes: totals.scopeBytes + delta, dbBytes: totals.dbBytes + delta });
    return { ok: true, id: record.id, revision: record.revision };
  }

  return {
    scope,

    open,

    status,

    /**
     * Write one recovery record.
     *
     * A revision an accepted save has already proved it covers, or one older than
     * the copy already on disk, is skipped rather than written: a queued write that
     * arrives late cannot resurrect writing that has been saved or replaced. An
     * over-budget write is refused with the older copy left exactly as it was.
     *
     * @param {Object} record
     * @returns {Promise<{ok: boolean, code?: string, id?: *, revision?: number, skipped?: boolean}>}
     */
    async put(record) {
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const prepared = { ...record, scope: [...scope], slot: keyOf(record.id) };
      prepared.bytes = recordBytes(prepared);
      const outcome = await runWrite((ctx) => writeRecord(ctx, prepared));
      if (!outcome.ok) return { ok: false, code: outcome.code };
      return outcome.result;
    },

    async get(id) {
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      let tx;
      try {
        tx = db.transaction([RECORDS], "readonly");
      } catch (err) {
        return { ok: false, code: codeFor(err) };
      }
      const record = await request(tx.objectStore(RECORDS).get(keyOf(id)));
      if (!record || !sameScope(record.scope)) return { ok: false, code: "missing" };
      return { ok: true, record };
    },

    async list() {
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code, records: [], status: status() };
      let tx;
      try {
        tx = db.transaction([RECORDS, META], "readonly");
      } catch (err) {
        return { ok: false, code: codeFor(err), records: [], status: status() };
      }
      const records = tx.objectStore(RECORDS);
      const meta = tx.objectStore(META);
      const [all, scopeEntry, totalEntry] = await Promise.all([
        cursorAll(records.index(BY_SCOPE), [...scope]),
        request(meta.get(scopeUsageKey)),
        request(meta.get(TOTAL_USAGE)),
      ]);
      if (scopeEntry) usage.scopeBytes = scopeEntry.value;
      else usage.scopeBytes = all.reduce((sum, record) => sum + (record.bytes ?? 0), 0);
      usage.dbBytes = totalEntry ? totalEntry.value : null;
      return { ok: true, records: all, status: status() };
    },

    /**
     * Compare-and-delete one record.
     *
     * The revision is what makes this safe: a review panel that was drawn over
     * revision 3 must not delete revision 5, which arrived while the person was
     * reading.
     *
     * @param {*} id
     * @param {{revision?: number}} [options]
     * @returns {Promise<{ok: boolean, code?: string, id?: *}>}
     */
    async remove(id, { revision } = {}) {
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const outcome = await runWrite(async (ctx) => {
        const slot = keyOf(id);
        const existing = await request(ctx.records.get(slot));
        if (!existing || !sameScope(existing.scope)) return { ok: false, code: "missing" };
        if (revision !== undefined && existing.revision !== revision) return { ok: false, code: "stale" };
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        await request(ctx.records.delete(slot));
        await writeUsageTotals(ctx.meta, {
          scopeBytes: Math.max(0, totals.scopeBytes - existing.bytes),
          dbBytes: Math.max(0, totals.dbBytes - existing.bytes),
        });
        return { ok: true, id };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    /**
     * Record that an accepted save covers one text revision, and drop what it covers.
     *
     * The watermark is written before and independently of the record because its job
     * outlives the record: a queued write for a covered revision can still be sitting
     * in memory, and it must be refused after the copy is gone. A newer revision from
     * the same writer, and every other writer, is untouched.
     *
     * @param {*} id - a text key
     * @param {{revision: number, etag?: ?string, captureId?: *, drop?: boolean}} options
     * @returns {Promise<{ok: boolean, code?: string, acknowledged?: number, deleted?: boolean}>}
     */
    async acknowledge(id, { revision, etag = null, captureId = null, drop = true } = {}) {
      if (typeof revision !== "number" || !Array.isArray(id)) return { ok: false, code: "invalid" };
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const slot = keyOf(id);
      const outcome = await runWrite(async (ctx) => {
        const mark = await request(ctx.watermarks.get(slot));
        const ackRevision = Math.max(mark?.ackRevision ?? 0, revision);
        await request(ctx.watermarks.put({ key: slot, ackRevision, etag, captureId, updated: now() }));
        const existing = await request(ctx.records.get(slot));
        if (!existing || !sameScope(existing.scope) || !drop || existing.revision > ackRevision) {
          return { ok: true, acknowledged: ackRevision, deleted: false };
        }
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        await request(ctx.records.delete(slot));
        await writeUsageTotals(ctx.meta, {
          scopeBytes: Math.max(0, totals.scopeBytes - existing.bytes),
          dbBytes: Math.max(0, totals.dbBytes - existing.bytes),
        });
        return { ok: true, acknowledged: ackRevision, deleted: true };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    /**
     * Append one batch record, creating its writer's capsule on the first append.
     *
     * Everything that could go wrong is decided inside the one transaction: the
     * capsule's channel, version and context, the writer's retired revisions, the
     * record's own revision and the budget. A revision an accepted checkpoint or a
     * compaction already retired is skipped, so a write that was queued while the
     * browser was busy cannot put back what was proved durable and then deleted.
     *
     * @param {Object} record - one `binary-batch` record
     * @param {?Object} capsule - the capsule to create when the writer has none yet
     * @returns {Promise<{ok: boolean, code?: string, id?: *, revision?: number, skipped?: boolean}>}
     */
    async appendBinary(record, capsule = null) {
      if (!record || record.id === undefined || typeof record.revision !== "number") return { ok: false, code: "invalid" };
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const prepared = { ...record, kind: "binary-batch", scope: [...scope], slot: keyOf(record.id) };
      prepared.bytes = recordBytes(prepared);
      const capsuleSlot = keyOf(record.capsuleId);
      const outcome = await runWrite(async (ctx) => {
        const head = await request(ctx.records.get(capsuleSlot));
        if (head) {
          if (!sameScope(head.scope) || head.kind !== "binary" || head.channel !== prepared.channel) {
            return { ok: false, code: "channel-mismatch" };
          }
          if (head.version !== prepared.version) return { ok: false, code: "unknown-version" };
          if (!sameValue(head.context, prepared.context)) return { ok: false, code: "context-mismatch" };
        }
        const mark = await request(ctx.watermarks.get(capsuleSlot));
        if (isRetired(mark?.retired, prepared.revision)) {
          return { ok: true, skipped: true, id: prepared.id, revision: prepared.revision };
        }
        const there = await request(ctx.records.get(prepared.slot));
        if (there && sameScope(there.scope) && there.revision >= prepared.revision) {
          return { ok: true, skipped: true, id: prepared.id, revision: prepared.revision };
        }
        let fresh = null;
        if (!head) {
          if (!capsule) return { ok: false, code: "missing" };
          fresh = { ...capsule, kind: "binary", scope: [...scope], slot: capsuleSlot };
          fresh.bytes = recordBytes(fresh);
        }
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        const delta = prepared.bytes + (fresh?.bytes ?? 0) - (there?.bytes ?? 0);
        if (totals.scopeBytes + delta > maxScopeBytes || totals.dbBytes + delta > maxDbBytes) {
          return { ok: false, code: "over-budget" };
        }
        if (fresh) await request(ctx.records.put(fresh));
        await request(ctx.records.put(prepared));
        await writeUsageTotals(ctx.meta, { scopeBytes: totals.scopeBytes + delta, dbBytes: totals.dbBytes + delta });
        return { ok: true, id: prepared.id, revision: prepared.revision };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    /**
     * Record that a room accepted this writer's work, and change nothing else.
     *
     * An acknowledgement is metadata: the bytes stay exactly where they are and no
     * revision is retired. Only a checkpoint does that. A record the caller observed
     * at another revision, or one that is already gone, is left alone.
     *
     * @param {{channel: string, version: number, records: Array<{id: *, revision: number}>, authority?: *, epoch?: *, sequence?: *}} options
     * @returns {Promise<{ok: boolean, code?: string, acknowledged?: number}>}
     */
    async acknowledgeBinary({ channel, version, writerId, records: targets = [], authority = null, epoch = null, sequence = null } = {}) {
      if (!Array.isArray(targets) || !targets.length) return { ok: true, acknowledged: 0 };
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const outcome = await runWrite(async (ctx) => {
        const capsules = new Map();
        for (const target of targets) {
          if (!target || target.id === undefined || typeof target.revision !== "number") continue;
          const slot = keyOf(target.id);
          const existing = await request(ctx.records.get(slot));
          if (!existing || !sameScope(existing.scope)) continue;
          if (existing.channel !== channel || existing.version !== version) continue;
          if (existing.writerId !== writerId) continue;
          if (existing.revision !== target.revision) continue;
          let capsule = existing;
          let capsuleSlot = slot;
          if (existing.kind !== "binary") {
            capsuleSlot = keyOf(existing.capsuleId);
            capsule = await request(ctx.records.get(capsuleSlot));
            if (!capsule || !sameScope(capsule.scope)) continue;
            if (capsule.channel !== channel || capsule.version !== version) continue;
          }
          capsules.set(slotKey(capsuleSlot), { capsuleSlot, capsule });
        }
        if (!capsules.size) return { ok: true, acknowledged: 0 };
        const acknowledged = { authority, epoch, sequence };
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        let delta = 0;
        for (const { capsuleSlot, capsule } of capsules.values()) {
          const updated = { ...capsule, acknowledged };
          updated.bytes = recordBytes(updated);
          delta += updated.bytes - capsule.bytes;
          await request(ctx.records.put(updated));
          const mark = await request(ctx.watermarks.get(capsuleSlot));
          await request(
            ctx.watermarks.put({
              ...(mark || {}),
              key: capsuleSlot,
              kind: "binary",
              retired: mark?.retired ?? [],
              acknowledged,
              updated: now(),
            })
          );
        }
        await writeUsageTotals(ctx.meta, { scopeBytes: Math.max(0, totals.scopeBytes + delta), dbBytes: Math.max(0, totals.dbBytes + delta) });
        return { ok: true, acknowledged: capsules.size };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    /**
     * Delete records a proof covers, and retire their revisions in the same commit.
     *
     * The watermark has to land with the deletion: a queued append for a covered
     * revision can still arrive afterwards, and it must be refused after the copy is
     * gone. Every revision is re-read here, so a record that changed after the proof
     * was checked stays. Nothing is deleted by channel, writer or age.
     *
     * @param {{channel: string, version: number, records: Array<{id: *, revision: number}>}} options
     * @returns {Promise<{ok: boolean, code?: string, retired?: Array<{id: *, revision: number}>}>}
     */
    async checkpointBinary({ channel, version, writerId, records: targets = [] } = {}) {
      if (!Array.isArray(targets) || !targets.length) return { ok: true, retired: [] };
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const outcome = await runWrite(async (ctx) => {
        const doomed = [];
        const marks = new Map();
        let bytes = 0;
        for (const target of targets) {
          if (!target || target.id === undefined || typeof target.revision !== "number") continue;
          const slot = keyOf(target.id);
          const existing = await request(ctx.records.get(slot));
          if (!existing || !sameScope(existing.scope)) continue;
          if (existing.channel !== channel || existing.version !== version) continue;
          if (existing.writerId !== writerId) continue;
          if (existing.revision !== target.revision) continue;
          doomed.push({ slot, existing });
          bytes += existing.bytes;
          const markSlot = existing.kind === "binary" ? slot : keyOf(existing.capsuleId);
          const at = slotKey(markSlot);
          if (!marks.has(at)) {
            marks.set(at, { markSlot, ranges: (await request(ctx.watermarks.get(markSlot)))?.retired ?? [] });
          }
          marks.get(at).ranges = retireRange(marks.get(at).ranges, existing.revision);
        }
        if (!doomed.length) return { ok: true, retired: [] };
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        for (const { slot } of doomed) await request(ctx.records.delete(slot));
        for (const { markSlot, ranges } of marks.values()) {
          const mark = await request(ctx.watermarks.get(markSlot));
          await request(
            ctx.watermarks.put({
              ...(mark || {}),
              key: markSlot,
              kind: "binary",
              retired: ranges,
              acknowledged: mark?.acknowledged ?? null,
              updated: now(),
            })
          );
        }
        await writeUsageTotals(ctx.meta, {
          scopeBytes: Math.max(0, totals.scopeBytes - bytes),
          dbBytes: Math.max(0, totals.dbBytes - bytes),
        });
        return { ok: true, retired: doomed.map(({ existing }) => ({ id: existing.id, revision: existing.revision })) };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    /**
     * Swap merged batches into their capsule, if the head is still the one that was read.
     *
     * The merge happened outside this transaction; this is only the swap. Every input
     * is re-read at the exact revision the caller observed and the capsule is checked
     * against the revision it had, so a compaction that lost a race changes nothing
     * and can be retried from the new head. Inputs are deleted only after a successful
     * comparison, a replacement that does not fit keeps every original, and the input
     * revisions are retired in this same commit.
     *
     * @param {{capsuleId: *, expectedRevision: number, replacement: Object, inputs?: Array<{id: *, revision: number}>}} options
     * @returns {Promise<{ok: boolean, code?: string, retired?: Array, revision?: number}>}
     */
    async compactBinary({ channel, version, capsuleId, expectedRevision, replacement = null, inputs = [] } = {}) {
      if (!replacement || typeof replacement.revision !== "number") return { ok: false, code: "invalid" };
      const opened = await open();
      if (!opened.ok) return { ok: false, code: opened.code };
      const capsuleSlot = keyOf(capsuleId);
      const outcome = await runWrite(async (ctx) => {
        const capsule = await request(ctx.records.get(capsuleSlot));
        if (!capsule || !sameScope(capsule.scope) || capsule.kind !== "binary") return { ok: false, code: "missing" };
        if (capsule.channel !== channel) return { ok: false, code: "channel-mismatch" };
        if (capsule.version !== version) return { ok: false, code: "unknown-version" };
        if (capsule.revision !== expectedRevision) return { ok: false, code: "stale" };
        if (replacement.revision <= capsule.revision) return { ok: false, code: "invalid" };
        const doomed = [];
        for (const input of inputs) {
          if (!input || input.id === undefined || typeof input.revision !== "number") return { ok: false, code: "stale" };
          const slot = keyOf(input.id);
          const existing = await request(ctx.records.get(slot));
          if (!existing || !sameScope(existing.scope)) return { ok: false, code: "stale" };
          if (existing.kind !== "binary-batch" || existing.channel !== capsule.channel || existing.version !== capsule.version) {
            return { ok: false, code: "stale" };
          }
          if (!sameValue(existing.capsuleId, capsule.id) || existing.revision !== input.revision) return { ok: false, code: "stale" };
          doomed.push({ slot, existing });
        }
        const updated = { ...capsule, revision: replacement.revision, payload: replacement.payload, updated: replacement.updated };
        updated.bytes = recordBytes(updated);
        let delta = updated.bytes - capsule.bytes;
        for (const { existing } of doomed) delta -= existing.bytes;
        const totals = await readUsageTotals(ctx.meta, ctx.records);
        if (totals.scopeBytes + delta > maxScopeBytes || totals.dbBytes + delta > maxDbBytes) {
          return { ok: false, code: "over-budget" };
        }
        for (const { slot } of doomed) await request(ctx.records.delete(slot));
        await request(ctx.records.put(updated));
        const mark = await request(ctx.watermarks.get(capsuleSlot));
        let retired = mark?.retired ?? [];
        for (const { existing } of doomed) retired = retireRange(retired, existing.revision);
        await request(
          ctx.watermarks.put({
            ...(mark || {}),
            key: capsuleSlot,
            kind: "binary",
            retired,
            acknowledged: mark?.acknowledged ?? capsule.acknowledged ?? null,
            updated: now(),
          })
        );
        await writeUsageTotals(ctx.meta, { scopeBytes: totals.scopeBytes + delta, dbBytes: totals.dbBytes + delta });
        return { ok: true, retired: doomed.map(({ existing }) => ({ id: existing.id, revision: existing.revision })), revision: updated.revision };
      });
      return outcome.ok ? outcome.result : { ok: false, code: outcome.code };
    },

    close() {
      try {
        db?.close();
      } catch (_) {}
      db = null;
      opening = null;
      openAnswer = null;
    },
  };
}
