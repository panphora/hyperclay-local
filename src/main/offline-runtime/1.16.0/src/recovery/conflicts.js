/**
 * conflicts.js — the durable half of the conflict ledger.
 *
 * The ledger (sync/conflicts.js) keeps what an incoming frame won over this tab's
 * editing, and it keeps it in memory: the root the merge read as "mine", the nodes
 * the report pointed at, the conflict records themselves. A reload takes every one
 * of those away, and replaying the paths afterwards would point at a DOM that is
 * not the one they were recorded against. So the ledger hands this module the
 * material it cannot rebuild — the pre-apply root as bytes, and the conflicts as
 * plain fields — and this module stores them in the shared recovery store.
 *
 * One record per apply: the root is stored once, and the conflicts reference it.
 * The word "durable" means one completed IndexedDB transaction, and nothing more:
 * a stored record is not a save, and the page never renders from it.
 *
 * What reaches IndexedDB is strings, numbers and booleans. A DOM node, a function,
 * a Map or anything else the structured clone algorithm would refuse is dropped
 * from the record and named in `dropped`, because one uncloneable field must not
 * cost somebody the whole copy. The store's own refusal (quota, unknown schema,
 * an unreachable database) is reported as a code and never removes the live
 * conflict, which is still the person's copy in this tab.
 */

import { storage } from "../lib/doc-storage.js";

export const CONFLICTS_CHANNEL = "clay.conflicts";
export const CONFLICTS_VERSION = 1;
export const CONFLICTS_KIND = "conflict";

// A cheap read for the notice's shell, which must not open the database on every
// edit boot. It says only that this document has stored conflicts to review.
const HINT_KEY = "conflicts";

const CONTEXT_FIELDS = ["kind", "id", "label", "field"];

function recoveryService() {
  const clay = globalThis.window?.clay ?? globalThis.clay;
  return clay?.recovery ?? null;
}

let registered = null;

function channel() {
  const service = recoveryService();
  if (!service || typeof service.register !== "function") return null;
  if (registered?.service === service) return registered.channel;
  try {
    registered = {
      service,
      channel: service.register({ channel: CONFLICTS_CHANNEL, version: CONFLICTS_VERSION }),
    };
  } catch (_) {
    return null;
  }
  return registered.channel;
}

/**
 * How many conflicts this document's store is holding for review, without opening
 * the database. Zero means the notice's shell stays asleep.
 *
 * @returns {number}
 */
export function pendingConflicts() {
  const stored = storage.local.get(HINT_KEY);
  return Number.isFinite(stored?.count) && stored.count > 0 ? stored.count : 0;
}

function noteHint(count) {
  if (count > 0) storage.local.set(HINT_KEY, { count, at: Date.now() });
  else storage.local.remove(HINT_KEY);
}

const DROPPED = Symbol("dropped");

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function copyField(value, dropped, field) {
  const type = typeof value;
  if (value === null || type === "string" || type === "number" || type === "boolean") return value;
  if (type === "undefined") return DROPPED;
  if (type !== "object") {
    dropped.push(field);
    return DROPPED;
  }
  if (Array.isArray(value)) {
    return value.map((item, at) => {
      const kept = copyField(item, dropped, `${field}[${at}]`);
      return kept === DROPPED ? null : kept;
    });
  }
  if (!isPlainObject(value)) {
    dropped.push(field);
    return DROPPED;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const kept = copyField(item, dropped, field ? `${field}.${key}` : key);
    if (kept !== DROPPED) out[key] = kept;
  }
  return out;
}

/**
 * A copy that survives the trip into IndexedDB: plain objects, arrays, strings,
 * numbers and booleans, with everything else dropped and named.
 *
 * @param {*} value
 * @param {string[]} [dropped] - collects the fields that could not be stored
 * @param {string} [field]
 * @returns {*}
 */
export function plainCopy(value, dropped = [], field = "") {
  const kept = copyField(value, dropped, field);
  return kept === DROPPED ? null : kept;
}

/**
 * The part of a conflict's context that can be stored: its identity, its label and
 * its field. The resolver's `open` is a function bound to this page's tree, so it
 * lives on the live record and never here.
 *
 * @param {*} context
 * @returns {?Object}
 */
export function storedContext(context) {
  if (!context || typeof context !== "object") return null;
  const out = {};
  for (const field of CONTEXT_FIELDS) {
    const value = context[field];
    if (typeof value === "string") {
      if (value) out[field] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[field] = String(value);
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Copy one apply and its conflicts into the recovery store, before the ledger
 * releases any of it.
 *
 * Returns synchronously with the staged ids: the copy is already in memory and the
 * write is under way. It is a recovery copy, not a durable receipt.
 *
 * @param {Object} spec
 * @param {Object} spec.apply - the ledger's apply, without its DOM roots
 * @param {?string} spec.root - the pre-apply root as saved bytes
 * @param {Object[]} spec.conflicts - plain conflict entries
 * @returns {{id: *, revision: number}[]}
 */
export function recordConflicts({ apply = {}, root = null, conflicts = [] } = {}) {
  const entries = [];
  for (const conflict of conflicts) {
    const dropped = [];
    const entry = plainCopy(conflict, dropped, "");
    if (!entry || typeof entry !== "object" || !entry.id) continue;
    if (dropped.length) entry.dropped = dropped;
    entries.push(entry);
  }
  if (!entries.length) return [];
  const payload = {
    apply: plainCopy(apply, [], "") ?? {},
    root: typeof root === "string" ? root : null,
    savedAt: Date.now(),
    conflicts: entries,
  };
  try {
    const ch = channel();
    if (!ch) return [];
    const staged = ch.stage({ key: String(apply.id ?? ""), kind: CONFLICTS_KIND, payload });
    ch.flush().catch(() => {});
    noteHint(pendingConflicts() + entries.length);
    return [{ id: staged.id, revision: staged.revision }];
  } catch (err) {
    // The live conflict is the copy that matters right now: nothing is removed here.
    console.error("clayjs: the conflict could not be stored for a later reload; it is still here", err);
    return [];
  }
}

const textOf = (value) => (typeof value === "string" ? value : value == null ? "" : String(value));

function usableConflict(conflict) {
  if (!conflict || typeof conflict !== "object") return null;
  const id = textOf(conflict.id);
  if (!id) return null;
  const context = storedContext(conflict.context);
  return {
    id,
    kind: textOf(conflict.kind),
    key: textOf(conflict.key),
    name: textOf(conflict.name),
    sentence: textOf(conflict.sentence),
    yours: textOf(conflict.yours),
    now: textOf(conflict.now),
    context,
    dropped: Array.isArray(conflict.dropped) ? conflict.dropped.map(textOf) : [],
  };
}

function usableRecord(record) {
  const payload = record?.payload;
  if (!payload || typeof payload !== "object") return null;
  const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts.map(usableConflict).filter(Boolean) : [];
  if (!conflicts.length) return null;
  const apply = payload.apply && typeof payload.apply === "object" ? payload.apply : {};
  return {
    id: record.id,
    revision: record.revision,
    supported: record.supported !== false,
    savedAt: Number.isFinite(payload.savedAt) ? payload.savedAt : null,
    apply,
    root: typeof payload.root === "string" ? payload.root : null,
    conflicts,
  };
}

/**
 * Every stored conflict for this document, from every writer: a record does not
 * belong to the tab that made it, because the tab that made it may be gone.
 *
 * @returns {Promise<{ok: boolean, code?: string, records: Object[], status?: Object}>}
 */
export async function listConflicts() {
  const ch = channel();
  if (!ch) return { ok: true, records: [] };
  let listed;
  try {
    listed = await ch.list();
  } catch (_) {
    return { ok: false, code: "error", records: [] };
  }
  if (!listed.ok) return { ok: false, code: listed.code, records: [] };
  const records = listed.records.map(usableRecord).filter(Boolean);
  noteHint(records.reduce((sum, record) => sum + record.conflicts.length, 0));
  return { ok: true, records, status: listed.status };
}

/**
 * Acknowledge conflicts, by the id the ledger gave them. This is the only way a
 * stored conflict leaves: a person said so, or a live conflict was accepted,
 * reverted or reconciled and its own record has already gone.
 *
 * Only the named conflicts go. A record that still holds another conflict keeps
 * its root, so the surviving text is never lost because a neighbour was dismissed;
 * the remainder is written under a new revision before the old one is deleted, so
 * a failed write leaves the original exactly as it was.
 *
 * @param {string[]} ids
 * @returns {Promise<{ok: boolean, code?: string, removed?: number}>}
 */
export async function dismissConflicts(ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => id != null).map(String));
  if (!wanted.size) return { ok: true, removed: 0 };
  const ch = channel();
  if (!ch) return { ok: true, removed: 0 };
  const listed = await listConflicts();
  if (!listed.ok) return { ok: false, code: listed.code };
  let removed = 0;
  for (const record of listed.records) {
    const remaining = record.conflicts.filter((entry) => !wanted.has(entry.id));
    if (remaining.length === record.conflicts.length) continue;
    removed += record.conflicts.length - remaining.length;
    if (!remaining.length) {
      await ch.dismiss(record.id, { revision: record.revision });
      continue;
    }
    ch.stage({
      key: String(record.id),
      kind: CONFLICTS_KIND,
      payload: { apply: record.apply, root: record.root, savedAt: record.savedAt, conflicts: remaining },
    });
    const written = await ch.flush();
    if (!written.ok) continue;
    await ch.dismiss(record.id, { revision: record.revision });
  }
  await listConflicts();
  // The notice may be holding a record this just changed.
  globalThis.document?.dispatchEvent(new CustomEvent("clay:conflict-store-changed"));
  return { ok: true, removed };
}
