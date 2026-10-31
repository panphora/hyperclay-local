/**
 * The edit-only half of the conflict ledger.
 *
 * `conflicts.js` is the one conflict module a reader and an editor both load, and a
 * reader never records a conflict: it has nothing unsaved for an incoming frame to
 * win over. So the copy a reload has to keep, and the store it goes to, live here.
 * `conflicts.js` starts this fetch as it evaluates in edit mode, and hands it the
 * material it cannot rebuild; a conflict that arrives before it lands is queued
 * there and drains the moment it does.
 */

import { TAB_LOCAL_ROOT_ATTRS } from '../lib/root-attrs.js';
import { serializeRecoveryClone } from '../core/snapshot.js';
import { rowOf } from '../core/conflict-presentation.js';

// The recovery half of this module is fetched, not imported: no recovery code is in
// the boot graph, and a page that never loses anything never downloads it. The copy
// itself is made synchronously below and queued here, so what has to be preserved is
// preserved before anything is released; the queue drains the moment the module
// arrives. Until it does, the live record is the only copy, which is where this
// started.
const DURABLE_QUEUE_MAX = 20;
let durable = null;
let loadingDurable = false;
const durableQueue = [];

function loadDurable() {
  if (durable || loadingDurable) return;
  loadingDurable = true;
  import('../recovery/conflicts.js').then(
    (module) => {
      durable = module;
      loadingDurable = false;
      drainDurable();
    },
    (error) => {
      loadingDurable = false;
      console.error('clayjs: the conflict recovery module could not be downloaded; conflicts stay in this tab only', error);
    }
  );
}

function drainDurable() {
  if (!durable) {
    loadDurable();
    return;
  }
  while (durableQueue.length) {
    const spec = durableQueue.shift();
    try {
      durable.recordConflicts(spec);
    } catch (err) {
      console.error('clayjs: the conflict could not be stored for a later reload; it is still here', err);
    }
  }
}

// The losing text a reload has to keep, as the notice already words it. Everything
// here is plain text: the row's own name, the sentence that explains it, and the two
// sides, with the rest of the copy in the stored root.
function conflictEntry(rec, context) {
  let row = null;
  try {
    row = rowOf(rec);
  } catch (_) {}
  const full = (side) => (!side ? '' : (side.cutBefore ? '\u2026' : '') + side.before + side.hit + side.after + (side.cutAfter ? '\u2026' : ''));
  return {
    id: String(rec.id),
    kind: String(rec.kind ?? ''),
    key: rec.recovery?.key == null ? '' : String(rec.recovery.key),
    name: row?.name ? String(row.name) : '',
    sentence: row?.sentence ? String(row.sentence) : '',
    yours: full(row?.yours),
    now: full(row?.now),
    context,
  };
}

// The pre-apply root as the bytes a save would have written, with the root
// attributes this response and this tab own removed first: a recovery copy never
// carries a save token, a file id or this library's own UI state.
function recoveryHtml(apply) {
  try {
    const source = apply.recoveryRoot ?? apply.root;
    const clone = source?.cloneNode?.(true);
    if (!clone) return null;
    for (const name of TAB_LOCAL_ROOT_ATTRS) clone.removeAttribute(name);
    return serializeRecoveryClone(clone, { prepared: apply.domain === 'save' });
  } catch (err) {
    console.error('clayjs: the conflict recovery page could not be serialized; the conflict text is still stored', err);
    return null;
  }
}

// Copy the material before anything is released, and never let the store's failure
// reach the ledger: a quota or a blocked database leaves the live record exactly
// where it was. Losing the copy to this queue is bounded, never silent.
export function keep({ apply, records }) {
  try {
    durableQueue.push({
      apply: { id: apply.id, source: apply.source, domain: apply.domain, seq: apply.seq, etag: apply.etag, ticket: apply.ticket },
      root: recoveryHtml(apply),
      conflicts: records.map(({ rec, context }) => conflictEntry(rec, context)),
    });
    if (durableQueue.length > DURABLE_QUEUE_MAX) durableQueue.shift();
    drainDurable();
  } catch (err) {
    console.error('clayjs: the conflict could not be stored for a later reload; it is still here', err);
  }
}

// An acknowledged conflict leaves the store with the ledger record it came from:
// nothing here reads it back, and a store that cannot be reached just keeps it.
export function dismiss(ids) {
  import('../recovery/conflicts.js').then(
    (module) => module.dismissConflicts(ids),
    () => {}
  ).catch(() => {});
}
