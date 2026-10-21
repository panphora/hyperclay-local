/**
 * region-policy.js — the region capability model.
 *
 * A region declares how it participates in the framework via a small set of
 * orthogonal tokens. The canonical spelling is the space-separated `clay`
 * attribute (`clay="no-save no-undo"`); bare naked attributes are still
 * resolved for back-compat. They apply to an element and its descendants:
 *
 *   no-save               — not written to the saved file (stripped). Live at runtime.
 *   no-trigger-autosave   — saved, and still counts as unsaved work, but editing it does
 *                           not start an autosave. Durable work the person batches by hand.
 *   no-dirty              — saved, but its content is disposable: no autosave, no close
 *                           warning, and an incoming sync frame may replace it.
 *   no-undo               — edits here are not recorded in the undo stack.
 *   no-watch              — invisible to the whole mutation system (high-churn regions). Still saved.
 *   freeze                — saved as authored (runtime changes not persisted). Live at runtime.
 *
 * Four legacy markers map onto bundles of the above for back-compat. They all
 * additionally gain "watched" (behaviors now run inside them):
 *
 *   mutations-ignore  ->  no-watch
 *   save-remove       ->  no-save  no-undo
 *   save-ignore       ->  no-dirty  no-undo
 *   save-freeze       ->  freeze  no-undo
 *
 * save-ignore maps to no-dirty, NOT to no-trigger-autosave. hyper-morph has always
 * defined it as local-instance chrome ("explicit leave me alone") and sync-ignores
 * it, and every real use of it in the wild is a generated stylesheet <link>. Calling
 * it a spelling of no-trigger-autosave gave clayjs a durable region that hyper-morph
 * refuses to sync, which is a contradiction no merge domain can express.
 *
 * Separately, a snapshot-layer marker controls whether an element appears in any
 * snapshot at all (save file, live-sync broadcast, and dirty-comparison):
 *
 *   snapshot-remove / no-snapshot  — removed from every snapshot. Runtime-only
 *     local chrome. hyper-morph also treats it as sync-ignored, so a live-sync
 *     receiver preserves its own copy instead of deleting it. Handled in
 *     snapshot.js, not by the policy axes below; no-snapshot is the consistent
 *     alias for the original snapshot-remove.
 *
 * resolveRegionPolicy() walks an element's self-or-ancestor chain once and
 * returns the four independent axes the rest of the framework keys off:
 *   { watched, autosaveTriggered, dirtyTracked, undoable, persist, extension }
 */

import { EXTENSION_NODE_SELECTOR } from './extension-noise.js';
import { capabilitySelector, expandsTo, hasCapability, hasPolicyToken, POLICY_TOKENS } from './region-capabilities.js';

export const PERSIST = { FULL: 'full', FROZEN: 'frozen', NONE: 'none' };

// The canonical region tokens (spelled in the `clay` attribute or as bare attrs).
export const REGION_ATTRS = ['no-save', 'no-trigger-autosave', 'no-dirty', 'no-undo', 'no-watch', 'no-data', 'freeze', 'editor-ui', 'live'];

// Every canonical token spellable inside the space-separated `clay` attribute.
// Exported: this list used to exist as a private CLAY_TOKENS that nothing read,
// while callers hardcoded their own copies.
export const TOKENS = [...POLICY_TOKENS];

// True when a region marker is present, whether spelled as a `clay` token
// (whitespace-token semantics, matching [clay~=token]) or a legacy bare attribute.
const hasRegionToken = hasPolicyToken;

/**
 * Add a canonical region token to an element's `clay` attribute, preserving any
 * tokens already there. The one place that knows how the attribute is spelled, so
 * a caller that needs to mark a region cannot invent a second merge.
 *
 * @param {Element} el
 * @param {string} token - a canonical token, e.g. 'no-trigger-autosave'
 */
export function addRegionToken(el, token) {
  const tokens = new Set((el.getAttribute("clay") || "").trim().split(/\s+/).filter(Boolean));
  if (tokens.has(token)) return;
  tokens.add(token);
  el.setAttribute("clay", Array.from(tokens).join(" "));
}

// Serializer selectors (recognize the clay-token spelling FIRST, then new + legacy bare).
export const STRIP_FROM_SAVE = `${capabilitySelector('save')}, [save-remove]`;
export const FREEZE_SELECTOR = '[clay~="freeze"], [freeze], [save-freeze]';
// forComparison additionally strips every region whose autosave-trigger is off,
// so their churn never marks the page dirty — including the no-watch /
// mutations-ignore footgun (their content stays in the saved file, but is no
// longer counted as a change).
export const STRIP_FROM_COMPARISON =
  '[clay~="no-save"], [clay~="no-trigger-autosave"], [clay~="no-dirty"], [clay~="freeze"], [clay~="no-watch"], [no-save], [save-remove], [no-trigger-autosave], [no-dirty], [save-ignore], [freeze], [save-freeze], [no-watch], [mutations-ignore], [clay~="live"]';

// Every spelling of no-trigger-autosave: the ONE difference between the autosave
// domain and the dirty domain. A document containing none of these has identical
// domains, which is what lets captureForSaveAndComparison short-circuit.
// Derived here rather than written out at the call site so a page using the
// legacy `save-ignore` spelling cannot get a dirty domain the policy disagrees
// with — the split-brain where savePage() skips while the close warning fires.
export const NO_TRIGGER_AUTOSAVE_SELECTOR =
  '[clay~="no-trigger-autosave"], [no-trigger-autosave]';

// Live JSON stores (clay="live" on a merge= JSON script). Saved, stripped from both
// comparison domains, and ignored by the live-sync merge: the live plugin owns the value.
export const LIVE_SELECTOR = '[clay~="live"]';

// Disposable regions: saved, but their content is explicitly not work. Stripped
// from BOTH comparison domains, skipped by the merge on both sides, and never
// counted by the close warning. This is the declared signal that lets the merge
// stop guessing whether churn inside a batching region was a person or a renderer.
export const NO_DIRTY_SELECTOR =
  '[clay~="no-dirty"], [no-dirty], [save-ignore]';

// forDirtyCheck strips everything forComparison does EXCEPT no-trigger-autosave.
// An edit inside such a region is a real edit: the person can save it by hand and
// must be warned about it on close. It just doesn't start an autosave by itself.
// no-watch stays stripped — a region invisible to the mutation system cannot be
// dirty-tracked either, and counting it would re-freeze the live-sync baseline
// the way the mounted-tool bug did (see dirty-gate.js).
export const STRIP_FROM_DIRTY_CHECK =
  '[clay~="no-save"], [clay~="no-dirty"], [clay~="freeze"], [clay~="no-watch"], [no-save], [save-remove], [no-dirty], [save-ignore], [freeze], [save-freeze], [no-watch], [mutations-ignore], [clay~="live"]';

// Snapshot-layer marker: removed from EVERY snapshot (save, live-sync broadcast,
// dirty-comparison) in snapshot.js. `no-snapshot` is the consistent alias for the
// original `snapshot-remove`; hyper-morph treats both as sync-ignored so a
// live-sync receiver keeps its own local copy instead of deleting it.
export const SNAPSHOT_REMOVE_SELECTOR = `${capabilitySelector('snapshot')}, [snapshot-remove]`;
export const NO_DATA_SELECTOR = capabilitySelector('data');

// Ancestor-aware, because the strip removes a marked element together with its
// whole subtree: a child of a no-snapshot region is just as absent from every
// snapshot as the region itself, and answering false for it was a lie callers
// acted on.
export function isSnapshotRemoved(node) {
  const element = startElement(node);
  return !!(element && element.closest && element.closest(SNAPSHOT_REMOVE_SELECTOR));
}

export function isDataExcluded(node) {
  return hasCapability(node, 'data');
}

const PERSIST_RANK = { full: 0, frozen: 1, none: 2 };
const RANK_PERSIST = ['full', 'frozen', 'none'];

function startElement(node) {
  return node && node.nodeType !== 1 ? node.parentElement : node;
}

/**
 * Walk an element's self-or-ancestor chain once and resolve its region axes.
 *
 * @param {Node} node
 * @returns {{watched:boolean, autosaveTriggered:boolean, dirtyTracked:boolean, undoable:boolean, persist:string, extension:boolean}}
 */
export function resolveRegionPolicy(node) {
  let element = startElement(node);

  // Browser-extension injected content is never page content, for any consumer.
  if (element && element.closest && element.closest(EXTENSION_NODE_SELECTOR)) {
    return { watched: false, autosaveTriggered: false, dirtyTracked: false, undoable: false, persist: PERSIST.FULL, extension: true };
  }

  let watched = true;
  let undoable = true;
  let autosaveOff = false;
  let dirtyOff = false;
  let persistRank = 0;

  while (element && element.nodeType === 1) {
    if (element.hasAttribute) {
      // new naked attributes
      if (expandsTo(element, 'no-watch')) watched = false;
      if (hasRegionToken(element, 'no-trigger-autosave')) autosaveOff = true;
      if (hasRegionToken(element, 'no-dirty')) { autosaveOff = true; dirtyOff = true; }
      // A live JSON store: saved, but its value lives in memory and the live plugin
      // writes it into each save clone, so the tag itself is never work to track.
      if (hasRegionToken(element, 'live')) { autosaveOff = true; dirtyOff = true; undoable = false; }
      if (expandsTo(element, 'no-undo')) undoable = false;
      if (expandsTo(element, 'no-save')) persistRank = Math.max(persistRank, PERSIST_RANK.none);
      if (hasRegionToken(element, 'freeze')) persistRank = Math.max(persistRank, PERSIST_RANK.frozen);
      // legacy markers -> bundles
      if (hasRegionToken(element, 'mutations-ignore')) watched = false;
      if (hasRegionToken(element, 'save-remove')) { persistRank = Math.max(persistRank, PERSIST_RANK.none); undoable = false; }
      if (hasRegionToken(element, 'save-ignore')) { autosaveOff = true; dirtyOff = true; undoable = false; }
      if (hasRegionToken(element, 'save-freeze')) { persistRank = Math.max(persistRank, PERSIST_RANK.frozen); undoable = false; }
    }
    element = element.parentElement;
  }

  // Implication rules (no-save wins over freeze automatically via Math.max above):
  //   no-watch  ⟹ no autosave + no undo (can't track what isn't watched)
  //   no-save / freeze ⟹ no autosave (nothing live to persist)
  //   no-watch  ⟹ not dirty-tracked either (can't track what isn't watched)
  //   no-save / freeze ⟹ not dirty-tracked (nothing live to persist)
  // no-trigger-autosave deliberately does NOT clear dirtyTracked: that is the
  // whole distinction between the two axes. no-dirty is the token that clears
  // both, for content that is saved but is not work.
  if (!watched) { autosaveOff = true; undoable = false; dirtyOff = true; }
  if (persistRank > 0) { autosaveOff = true; dirtyOff = true; }

  return {
    watched,
    autosaveTriggered: !autosaveOff,
    dirtyTracked: !dirtyOff,
    undoable,
    persist: RANK_PERSIST[persistRank],
    extension: false,
  };
}

/**
 * Cheap intake-level check: is a node invisible to EVERY consumer?
 *
 * Only no-watch / mutations-ignore (and extension noise) qualify — they're the
 * one universal drop, so the observer can skip walking those subtrees entirely.
 * All other region attributes are resolved per-consumer in Mutation._notify.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function isInert(node) {
  let element = startElement(node);
  if (element && element.closest && element.closest(EXTENSION_NODE_SELECTOR)) return true;
  while (element && element.nodeType === 1) {
    if (element.hasAttribute &&
        (expandsTo(element, 'no-watch') || hasRegionToken(element, 'mutations-ignore'))) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

/**
 * Combine two resolved policies into the stricter of each axis. Used to merge a
 * removed (detached) element's own markers with its still-attached parent's.
 */
export function strictestPolicy(a, b) {
  return {
    watched: a.watched && b.watched,
    autosaveTriggered: a.autosaveTriggered && b.autosaveTriggered,
    dirtyTracked: a.dirtyTracked && b.dirtyTracked,
    undoable: a.undoable && b.undoable,
    persist: PERSIST_RANK[a.persist] >= PERSIST_RANK[b.persist] ? a.persist : b.persist,
    extension: a.extension || b.extension,
  };
}

// Literal `skip:[...]` escape-hatch tokens -> axis predicate.
const SKIP_TOKEN_PREDICATES = {
  'no-watch': p => !p.watched,
  'mutations-ignore': p => !p.watched,
  'no-save': p => p.persist === PERSIST.NONE,
  'save-remove': p => p.persist === PERSIST.NONE,
  'freeze': p => p.persist === PERSIST.FROZEN,
  'save-freeze': p => p.persist === PERSIST.FROZEN,
  'no-trigger-autosave': p => !p.autosaveTriggered,
  'no-dirty': p => !p.dirtyTracked,
  'save-ignore': p => !p.dirtyTracked,
  'no-undo': p => !p.undoable,
};

/**
 * Should a consumer skip a change in this region?
 *
 * @param {object} policy   resolved region policy
 * @param {string} [require] axis the consumer needs: 'observed' | 'autosave' | 'dirty' | 'undo'
 * @param {string[]} [skip]  literal attribute escape-hatch (any match -> skip)
 * @returns {boolean}
 */
export function skipForPolicy(policy, require, skip) {
  if (policy.extension) return true;
  if (skip && skip.length) {
    return skip.some(tok => SKIP_TOKEN_PREDICATES[tok]?.(policy) || false);
  }
  switch (require) {
    case 'observed': return !policy.watched;
    case 'autosave': return !policy.autosaveTriggered;
    case 'dirty': return !policy.dirtyTracked;
    case 'undo': return !policy.undoable;
    default:
      // No require declared: preserve the legacy four-marker skip so unmodified
      // consumers behave exactly as before. (Undo-only opt-outs still pass.)
      return !policy.watched || !policy.autosaveTriggered || policy.persist !== PERSIST.FULL;
  }
}

// The canonical region API the vendored hyper-undo (a separate bundle that can't
// import this module) delegates "is this undoable?" to via clay.region, so the two
// can no longer drift. The loader assembles this onto clay in assembleCore.
// ONE object, served to both clay.region and clay.internals.region.
//
// They had drifted into two shapes with different key spellings for the same
// selectors, and both are documented, so this is an additive union rather than a
// choice between them: every name either surface published still resolves.
export const regionShape = {
  resolveRegionPolicy,
  isInert,
  isSnapshotRemoved,
  isDataExcluded,
  skipForPolicy,
  strictestPolicy,
  addRegionToken,
  PERSIST,
  TOKENS,
  REGION_ATTRS,

  // Flat UPPERCASE names: what clay.region has always published.
  STRIP_FROM_SAVE,
  STRIP_FROM_COMPARISON,
  STRIP_FROM_DIRTY_CHECK,
  NO_TRIGGER_AUTOSAVE_SELECTOR,
  NO_DIRTY_SELECTOR,
  SNAPSHOT_REMOVE_SELECTOR,
  NO_DATA_SELECTOR,
  FREEZE_SELECTOR,

  // Nested camelCase: what clay.internals.region has always published.
  selectors: {
    stripFromSave: STRIP_FROM_SAVE,
    stripFromComparison: STRIP_FROM_COMPARISON,
    stripFromDirtyCheck: STRIP_FROM_DIRTY_CHECK,
    noTriggerAutosave: NO_TRIGGER_AUTOSAVE_SELECTOR,
    noDirty: NO_DIRTY_SELECTOR,
    snapshotRemove: SNAPSHOT_REMOVE_SELECTOR,
    noData: NO_DATA_SELECTOR,
    freeze: FREEZE_SELECTOR,
  },
};

// The name the loader imported before the two shapes merged.
export const windowRegionShape = regionShape;
