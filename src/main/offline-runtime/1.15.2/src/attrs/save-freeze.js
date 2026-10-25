/**
 * [freeze] / [save-freeze] Custom Attribute
 *
 * Freezes an element's innerHTML for save purposes.
 * The live DOM can change freely, but the saved HTML always
 * contains the original content captured when the element first appeared.
 *
 * Usage:
 *   <div clay="freeze">Content that JS will modify at runtime</div>
 *
 * The original innerHTML is captured:
 *   - On page load, for all existing freeze elements
 *   - On DOM insertion, for dynamically added freeze elements
 *
 * At save time, the clone's innerHTML is replaced with the stored original.
 * Changes inside freeze elements do not trigger autosave dirty checks.
 */

import { onSnapshot, addDocumentTransform } from "../core/snapshot.js";
import { isEditMode } from "../core/is-edit-mode.js";
import { FREEZE_SELECTOR } from "../lib/region-policy.js";
import { ROUTE_ACTIVE_ATTR } from "../lib/root-attrs.js";
import { stripEphemeral } from "../lib/ephemeral.js";
import Mutation from "../lib/mutation.js";

const originals = new WeakMap();

const saveFreeze = { debug: false };

function log(...args) {
  if (saveFreeze.debug) console.log('[save-freeze]', ...args);
}

// The captured original is what the file keeps, so it must hold no router stamp
// and no ephemeral state: either can be set on a child before this capture runs.
function authoredInnerHTML(el) {
  const html = el.innerHTML;
  if (!el.querySelector(`[${ROUTE_ACTIVE_ATTR}]`) && !html.includes("ephemeral") && !html.includes("<dialog")) return html;
  const copy = el.cloneNode(true);
  for (const s of copy.querySelectorAll(`[${ROUTE_ACTIVE_ATTR}]`)) s.removeAttribute(ROUTE_ACTIVE_ATTR);
  for (const child of copy.children) stripEphemeral(child);
  return copy.innerHTML;
}

function capture(el) {
  if (!originals.has(el)) {
    originals.set(el, authoredInnerHTML(el));
    log('captured original', originals.get(el).substring(0, 80) + '...');
  }
}

function captureAll() {
  const els = document.querySelectorAll(FREEZE_SELECTOR);
  log('captureAll found', els.length, 'elements');
  for (const el of els) {
    capture(el);
  }
}

// Which cloned element holds which authored innerHTML, for the current snapshot.
// Keyed by the cloned element itself: the prepare phase runs on the same clone
// object the snapshot phase saw, so identity is the pairing. An attribute marker
// would work too, right up until clay:snapshot-ready — which fires BETWEEN the two
// phases — hands the still-marked clone to live-sync and demo mode, both of which
// serialize it on the spot.
let pending = new WeakMap();

// Phase 2. The clone is a verbatim cloneNode of the live root and nothing has been
// stripped from it yet, so pairing by position is sound HERE and nowhere else.
function freezeSnapshot(clone, provenance) {
  pending = new WeakMap();

  const cloneElements = clone.querySelectorAll(FREEZE_SELECTOR);

  log('freezing clone:', cloneElements.length);

  for (const cloneElement of cloneElements) {
    const liveElement = provenance.original(cloneElement);
    if (!liveElement || !originals.has(liveElement)) continue;
    const original = originals.get(liveElement);
    pending.set(cloneElement, original);
    if (cloneElement.innerHTML !== original) {
      log('restoring original');
      cloneElement.innerHTML = original;
    }
  }
}

// Phase 3a. Re-freeze anything an [onbeforesave] handler changed between the two
// phases. Nothing to clean up: the pairing never entered the document.
function freezePrepare(clone) {
  for (const el of clone.querySelectorAll(FREEZE_SELECTOR)) {
    const original = pending.get(el);
    if (original !== undefined && el.innerHTML !== original) {
      log('re-restoring original after prepare-phase change');
      el.innerHTML = original;
    }
  }
}

function init() {
  log('init, isEditMode:', isEditMode);
  if (!isEditMode) return;

  captureAll();

  // Capture the original innerHTML of dynamically added [freeze]/[save-freeze]
  // regions. Folded onto the single Mutation observer (Phase 2 — was its own).
  // debounce:0 so we snapshot the authored content before any runtime edit
  // mutates it; the callback is a pure read into a WeakMap (no DOM writes).
  // require:'observed' (skip only no-watch); pausable:false so a morphed-in
  // freeze region is still captured. Mutation observes document.documentElement,
  // so a [freeze] added directly to <head> at runtime is captured like any other.
  Mutation.onAddElement({
    selectorFilter: FREEZE_SELECTOR,
    require: 'observed',
    pausable: false,
    debounce: 0
  }, (changes) => {
    changes.forEach(({ element }) => capture(element));
  });

  // Phase 2: Freeze in snapshot — before snapshot-ready fires.
  // This prevents live-sync from writing unfrozen content to disk.
  onSnapshot(freezeSnapshot);

  // Phase 3a: Freeze again in prepare, for anything changed between the phases
  // (e.g. onbeforesave handlers). Pairs by the WeakMap phase 2 filled, because by
  // now the clone has lost its [no-snapshot] subtrees and position means nothing.
  addDocumentTransform(freezePrepare);
}

init();

export default saveFreeze;
