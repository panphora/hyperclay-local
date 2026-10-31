import { registerUnsavedState } from '../lib/unsaved-state.js';
import { releaseProtection } from './conflict-footprints.js';
import { isEditMode } from '../core/is-edit-mode.js';

// What incoming frames won over this tab's unsaved edits, kept for the life of
// the document until the person decides. Nothing here is read by a save, a
// baseline, a reconnect or a 412 release: a record leaves only through
// acknowledge(). Each apply keeps the clone the merge read as "mine", which is
// the recovery copy for Download and the source for Revert.

const REASONS = new Set(['accepted', 'reverted', 'reconciled']);
const nonce = Math.random().toString(36).slice(2, 8);
let counter = 0;
const records = new Map();
const applies = new Map();
const pending = new Set();
const resolvers = new Set();
let registration = null;

// The recording half is edit-only, like live sync's: a reader has nothing unsaved to
// lose. Edit mode starts the fetch as this file evaluates; a loss that arrives first
// waits in the queue below.
const EDIT_QUEUE_MAX = 20;
let edit = null;
let editLoad = null;
const editQueue = [];

export function loadEdit() {
  editLoad ??= import('./conflicts-edit.js').then(
    (module) => {
      edit = module;
      while (editQueue.length) edit.keep(editQueue.shift());
    },
    (error) => {
      editLoad = null;
      console.error('clayjs: the conflict recovery module could not be downloaded; conflicts stay in this tab only', error);
    }
  );
}

if (isEditMode) loadEdit();

function nextId(prefix = '') {
  return `${nonce}:${prefix}${++counter}`;
}

function register() {
  registration ||= registerUnsavedState({
    id: 'live-sync-conflicts',
    isPending: () => records.size > 0 || pending.size > 0,
  });
  return registration;
}

function changed(detail) {
  register().changed();
  document.dispatchEvent(new CustomEvent('clay:sync-conflicts-changed', {
    detail: { open: [...records.keys()], added: [], removedIds: [], updatedIds: [], ...detail },
  }));
}

// A report is a loss unless the engine says this tab's operation survived, or a
// hook kept the incoming change off the page. One the engine could not map to the
// live page ("missing-output") still replaced this tab's work: it shows, without
// a place to point at.
function isLoss(c) {
  const r = c.recovery;
  if (!r) return true;
  if (r.applied === false && r.unavailable === 'hook-veto') return false;
  return r.localLost !== false;
}

// The page names a conflict when it can: a record id, a label and a field, from the
// app's own registered resolver. What comes back is a name and an action for the
// notice, never a claim, and never a replacement for the generic ones.
const CONTEXT_FIELDS = ['kind', 'id', 'label', 'field'];

// What can be stored: the identity, the label and the field. An `open` action is a
// function bound to this page's tree and stays on the live record.
function contextFields(value) {
  if (!value || typeof value !== 'object') return null;
  const context = {};
  for (const field of CONTEXT_FIELDS) {
    const found = value[field];
    if (typeof found === 'string' && found) context[field] = found;
    else if (typeof found === 'number' && Number.isFinite(found)) context[field] = String(found);
  }
  return Object.keys(context).length ? context : null;
}

function contextOf(value) {
  const context = contextFields(value);
  if (!context) return null;
  if (typeof value.open === 'function') context.open = value.open;
  return context;
}

// The newest registration answers first: an app that changes its own resolver gets
// the new one without having to unregister the old.
function contextFor(rec, apply) {
  for (const resolver of [...resolvers].reverse()) {
    let answer;
    try {
      answer = resolver(rec, apply);
    } catch (err) {
      console.error('clayjs: a conflict context resolver threw; the conflict stays generic', err);
      continue;
    }
    const context = contextOf(answer);
    if (context) return context;
  }
  return null;
}

export function registerContext(resolver) {
  if (typeof resolver !== 'function') throw new TypeError('clay.conflicts.registerContext needs a resolver function');
  resolvers.add(resolver);
  return () => resolvers.delete(resolver);
}

function install(apply, raw) {
  const id = nextId();
  const rec = Object.assign(raw[0], {
    id, applyId: apply.id, source: apply.source, ticket: apply.ticket,
    rawReports: raw, claimedBy: null,
  });
  rec.context = contextFor(rec, apply);
  records.set(id, rec);
  apply.ids.add(id);
  return id;
}

export function beginApply({ source, seq = null, etag = null, domain, root, recoveryRoot = null }) {
  const id = nextId('a');
  applies.set(id, { id, source, seq, etag, ticket: 0, domain, root, recoveryRoot, ids: new Set() });
  pending.add(id);
  register().changed();
  return id;
}

function insertionProof(raw) {
  if (!raw.every((c) => c.kind === 'structure' && c.detail === 'insert-collision' && c.recovery?.applied === true && !c.recovery.unavailable && c.recovery.structure?.localAction === 'inserted' && c.recovery.structure.fragmentKind === 'element')) return null;
  const subject = raw[0].recovery.subject;
  if (subject?.local?.length !== 1 || subject.merged?.length !== 1 || subject.live?.length !== 1) return null;
  return { local: subject.local[0], merged: subject.merged[0], live: subject.live[0] };
}

function foldInsertions(groups) {
  const proofs = new Map(groups.map((raw) => [raw, insertionProof(raw)]));
  const below = (parent, child) => parent.length < child.length && parent.every((step, i) => step === child[i]);
  const at = (root, path) => path.reduce((node, step) => step === 'content' ? node?.content : node?.childNodes[step], root);
  const folded = new Map();
  for (const raw of groups) {
    const child = proofs.get(raw);
    let owner = raw;
    if (child) {
      for (const candidate of groups) {
        const parent = proofs.get(candidate);
        if (parent && parent.local.length < proofs.get(owner).local.length && below(parent.local, child.local) && below(parent.merged, child.merged) && (parent.live.contains(child.live) || at(parent.live, child.merged.slice(parent.merged.length)) === child.live)) owner = candidate;
      }
    }
    if (!folded.has(owner)) folded.set(owner, [...owner]);
    if (raw !== owner) folded.get(owner).push(...raw);
  }
  return [...folded.values()];
}

// What the store may keep of a record's context, read now, while the record still
// knows it: the identity, the label and the field, never the resolver's action, which
// is a function bound to this page's tree and stays on the live record.
function keepConflicts(apply, ids) {
  const kept = ids.map((id) => records.get(id)).filter(Boolean);
  if (!kept.length) return;
  const spec = { apply, records: kept.map((rec) => ({ rec, context: contextFields(rec.context) })) };
  if (edit) return edit.keep(spec);
  editQueue.push(spec);
  if (editQueue.length > EDIT_QUEUE_MAX) editQueue.shift();
  loadEdit();
}

export function completeApply(applyId, conflicts, { ticket }) {
  const apply = applies.get(applyId);
  if (!apply) return [];
  apply.ticket = ticket;
  const groups = new Map();
  for (const c of conflicts) {
    if (!isLoss(c)) continue;
    const key = c.recovery?.key ?? Symbol();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const ids = foldInsertions([...groups.values()]).map((raw) => install(apply, raw));
  if (ids.length) keepConflicts(apply, ids);
  pending.delete(applyId);
  if (!ids.length) applies.delete(applyId);
  if (ids.length) changed({ added: ids.map((id) => records.get(id)) });
  else register().changed();
  return ids;
}

export function failApply(applyId, error, { ticket = 0 } = {}) {
  const apply = applies.get(applyId);
  if (!apply) return [];
  apply.ticket = ticket;
  pending.delete(applyId);
  const id = install(apply, [{ kind: 'apply-incomplete', detail: null, error: String(error) }]);
  records.get(id).rawReports = [];
  keepConflicts(apply, [id]);
  changed({ added: [records.get(id)] });
  return [id];
}

export const conflicts = {
  get size() {
    return records.size;
  },
  list() {
    return [...records.values()];
  },
  get(id) {
    return records.get(id) || null;
  },
  acknowledge(ids, { reason } = {}) {
    if (!Array.isArray(ids)) throw new TypeError('clay.conflicts.acknowledge needs an array of ids');
    if (!REASONS.has(reason)) throw new TypeError(`clay.conflicts.acknowledge: unknown reason "${reason}"`);
    const removedIds = [];
    for (const id of ids) {
      const rec = records.get(id);
      if (!rec) continue;
      releaseProtection(rec);
      records.delete(id);
      removedIds.push(id);
      const apply = applies.get(rec.applyId);
      if (apply) {
        apply.ids.delete(id);
        if (!apply.ids.size) applies.delete(rec.applyId);
      }
    }
    if (removedIds.length) {
      changed({ removedIds, reason });
      import('./conflicts-edit.js').then(
        (module) => module.dismiss(removedIds),
        () => {}
      );
    }
    return { removedIds, remainingIds: [...records.keys()] };
  },
  claim(ids, { owner }) {
    if (!owner) throw new TypeError('clay.conflicts.claim needs an owner');
    for (const id of ids) {
      const rec = records.get(id);
      if (rec && rec.claimedBy && rec.claimedBy !== owner) {
        throw new Error(`conflict ${id} is already claimed by ${rec.claimedBy}`);
      }
    }
    const acquired = [];
    for (const id of ids) {
      const rec = records.get(id);
      if (rec && !rec.claimedBy) {
        rec.claimedBy = owner;
        acquired.push(id);
      }
    }
    if (acquired.length) changed({ updatedIds: acquired, reason: 'claimed' });
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        const freed = acquired.filter((id) => records.get(id)?.claimedBy === owner);
        for (const id of freed) records.get(id).claimedBy = null;
        if (freed.length) changed({ updatedIds: freed, reason: 'released' });
      },
    };
  },
  registerContext,
  contextFor,

  recoveryOf(id) {
    const rec = records.get(id);
    return rec ? applies.get(rec.applyId) || null : null;
  },
  hasPendingApply() {
    return pending.size > 0;
  },
};
