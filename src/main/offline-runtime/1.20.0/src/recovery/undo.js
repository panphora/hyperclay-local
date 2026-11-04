/**
 * undo.js — the durable half of a refused undo step.
 *
 * The undo stack belongs to this tab and this editing session: a reload starts with an
 * empty history, and the entry a person tried to take back is live DOM nodes and a
 * compiled replay plan, neither of which a reload can use. What a reload can keep is
 * the losing side as plain data — the label, the direction, why it was refused, the
 * targets with the page's own name for each, and every step's before and after.
 *
 * One internal channel, `clay.undo`, on the shared recovery service: registered the
 * first time a step is refused or the page keeps one of its own, never at boot and
 * never by a reader. A refused record is never the kind a save can cover, and this
 * channel registers nothing a save could read back, so a normal save dismisses
 * nothing here that a person has not dealt with. A record is still only a recovery
 * copy: it is not a save and the page never renders from it.
 */

import { representedEtag } from '../core/etag.js';
import { storage } from '../lib/doc-storage.js';
import { plainCopy, storedContext } from './conflicts.js';

export const UNDO_CHANNEL = 'clay.undo';
export const UNDO_VERSION = 1;
export const UNDO_KIND = 'conflict';
export const UNDO_TEXT = 'text';

// The same cheap read the conflicts channel keeps for the notice's shell: one small
// count in this document's own storage, so the next edit session learns that copies
// are waiting without opening the database. It is written here, on stage and on
// dismissal, and never read from the reader path, which loads neither module.
const HINT_KEY = 'undo';

/**
 * How many copies this document's store is holding for review, without opening the
 * database. Zero means a boot has nothing to show.
 *
 * @returns {number}
 */
export function pendingUndo() {
  const stored = storage.local.get(HINT_KEY);
  return Number.isFinite(stored?.count) && stored.count > 0 ? stored.count : 0;
}

function noteHint(count) {
  if (count > 0) storage.local.set(HINT_KEY, { count, at: Date.now() });
  else storage.local.remove(HINT_KEY);
}

function recoveryService() {
  const clay = globalThis.window?.clay ?? globalThis.clay;
  return clay?.recovery ?? null;
}

let registered = null;

function channel() {
  const service = recoveryService();
  if (!service || typeof service.register !== 'function') return null;
  if (registered?.service === service) return registered.channel;
  try {
    registered = {
      service,
      channel: service.register({ channel: UNDO_CHANNEL, version: UNDO_VERSION }),
    };
  } catch (_) {
    return null;
  }
  return registered.channel;
}

// One refused step and one direction are one record: the key is what a repeated click
// lands on, and what lets the older copy go.
const keyOf = (entryId, direction) => `refused:${entryId}:${direction}`;

function elementFor(id) {
  if (id == null || typeof document === 'undefined') return null;
  const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(String(id)) : String(id).replace(/["\\]/g, '\\$&');
  try {
    return document.querySelector(`[data-id="${escaped}"]`);
  } catch (_) {
    return null;
  }
}

// The registry itself stays with the ledger: `clay.conflicts` is where a page registered
// its resolver, and asking it here costs no module the reader carries and no download.
function pageRegistry() {
  const clay = globalThis.window?.clay ?? globalThis.clay;
  const conflicts = clay?.conflicts;
  return typeof conflicts?.contextFor === 'function' ? conflicts : null;
}

/**
 * The page's name for one refused target, asked of the same resolver registry the
 * conflict notice uses — the ledger's own `contextFor`, so the order, the throw and the
 * fields kept are one behaviour and not two.
 *
 * The subject is the target's id and the live element that id finds, which a resolver
 * written for the conflict ledger answers nothing for: it reads the record's own nodes,
 * and a refused step has none. Such a page gets the generic shape until it names this
 * subject too.
 *
 * @param {{id: ?string}} target
 * @returns {Object}
 */
export function contextForTarget({ id = null } = {}) {
  const target = id == null ? null : String(id);
  const registry = pageRegistry();
  const found = registry ? registry.contextFor({ source: 'undo', id: target, element: elementFor(target) }, null) : null;
  return found ?? { kind: null, id: target, label: null, field: null };
}

// One context per refused target, in the targets' own order.
function contextsOf(targets) {
  return targets.map((target) => storedContext(contextForTarget(target)));
}

// A step refused twice is the same losing material. The older record goes only once
// the newer one is durable, and only at the revision this tab can see, so a copy
// another tab replaced or a person dismissed is never removed by a guess.
async function supersede(ch, key, id) {
  let listed;
  try {
    listed = await ch.list();
  } catch (_) {
    return;
  }
  if (!listed?.ok) return;
  for (const record of listed.records) {
    if (record.key !== key || String(record.id) === String(id)) continue;
    try {
      await ch.dismiss(record.id, { revision: record.revision });
    } catch (_) {}
  }
}

// The whole stage, flush and supersede of one refusal, one call at a time: two refusals
// in the same tick would otherwise each delete the other's record as the older copy.
let keeping = Promise.resolve();

/**
 * Keep what a refused undo or redo would have restored, before anything in this tab
 * can be lost to a reload.
 *
 * The engine's own `describe(entryId)` is the source: it is plain data already, with
 * the refusal on it and every step's endpoints, so nothing here reads a DOM node or a
 * replay plan. A store that refuses the write leaves the copy in memory — the service
 * keeps it — and answers with the failure.
 *
 * @param {Object} engine - the started undo scope (`clay.undo`)
 * @param {{entryId: string, direction: string, code?: string}} receipt
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export function keepRefusal(engine, receipt) {
  const run = keeping.then(() => keepRefusalNow(engine, receipt));
  keeping = run.catch(() => {});
  return run;
}

async function keepRefusalNow(engine, receipt) {
  const ch = channel();
  if (!ch) return { ok: false, code: 'unavailable' };
  let described = null;
  try {
    described = engine?.describe?.(receipt?.entryId) ?? null;
  } catch (_) {
    described = null;
  }
  if (!described) return { ok: false, code: 'unknown-entry' };
  const refused = described.refused && typeof described.refused === 'object' ? described.refused : {};
  const direction = receipt?.direction ?? refused.direction ?? null;
  const targets = (Array.isArray(refused.targets) ? refused.targets : []).map((target) => ({
    id: target?.id == null ? null : String(target.id),
    kind: target?.kind == null ? null : String(target.kind),
  }));
  const key = keyOf(described.id ?? receipt?.entryId, direction);
  const payload = plainCopy({
    label: described.label ?? null,
    direction,
    code: receipt?.code ?? refused.code ?? null,
    targets,
    context: contextsOf(targets),
    steps: described.steps ?? [],
  }, [], '');
  let staged;
  try {
    staged = ch.stage({ key, kind: UNDO_KIND, baseEtag: representedEtag() ?? null, base: null, payload });
  } catch (err) {
    console.error('clayjs: the refused step could not be kept for a later reload; it is still in this tab\'s history', err);
    return { ok: false, code: 'error' };
  }
  const written = await ch.flush();
  if (written?.ok) {
    await supersede(ch, key, staged.id);
    await kept();
  }
  return written?.ok ? written : { ok: false, code: written?.code || 'error' };
}

/**
 * Keep one of the page's own records on the same channel: an app's unsent text or its
 * own unreviewed conflict material, staged under `app:<key>`.
 *
 * @param {{key: string, label?: ?string, context?: ?Object, payload?: ?Object}} spec
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function keep({ key, label = null, context = null, payload = null } = {}) {
  const ch = channel();
  if (!ch) return { ok: false, code: 'unavailable' };
  const name = key == null ? '' : String(key);
  if (!name) return { ok: false, code: 'invalid' };
  const body = payload && typeof payload === 'object' ? payload : {};
  const record = plainCopy({ ...body, label, context: storedContext(context) }, [], '');
  try {
    ch.stage({ key: `app:${name}`, kind: typeof body.text === 'string' ? UNDO_TEXT : UNDO_KIND, payload: record });
  } catch (err) {
    console.error('clayjs: the app\'s recovery copy could not be kept; it is still in this tab only', err);
    return { ok: false, code: 'error' };
  }
  const written = await ch.flush();
  if (written?.ok) await kept();
  return written;
}

/**
 * What this document's store holds for review, from every writer: a record belongs to
 * the document, not to the tab that made it.
 *
 * @returns {Promise<{ok: boolean, code?: string, records: Object[], status?: Object}>}
 */
export async function kept() {
  const ch = channel();
  if (!ch) return { ok: true, records: [] };
  const listed = await ch.list();
  if (listed?.ok) noteHint(Array.isArray(listed.records) ? listed.records.length : 0);
  return listed;
}

/**
 * Remove one kept record, at the revision the reviewer was looking at. A record that
 * moved since then is left exactly as it is.
 *
 * @param {*} id
 * @param {{revision?: number}} [options]
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function dismissKept(id, { revision } = {}) {
  const ch = channel();
  if (!ch) return { ok: false, code: 'unavailable' };
  const receipt = await ch.dismiss(id, { revision });
  if (receipt?.ok) {
    try {
      await kept();
    } catch (_) {}
  }
  return receipt;
}
