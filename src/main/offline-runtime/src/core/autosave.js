/**
 * Auto-save system for clayjs
 *
 * Automatically saves page on DOM changes with throttling.
 * Gated by the <html autosave> attribute.
 *
 * Requires the 'save-system' module to be loaded first.
 *
 * Recommended companion modules:
 *   - 'unsaved-warning' - Warn before leaving with unsaved changes (required for beforeunload)
 */

import Mutation from "../lib/mutation.js";
import { isEditMode } from "./is-edit-mode.js";
import { savePageThrottled } from "./save.js";
import { markUserDriven } from "../lib/user-gesture.js";
import { resolveRegionPolicy, skipForPolicy } from "../lib/region-policy.js";
import { PERSIST, AUTOSAVE } from "../lib/attr-aliases.js";
import { setAutosaveActive } from "../lib/autosave-state.js";

/**
 * Initialize auto-save on DOM changes
 * Uses debounced mutation observer
 */
// A bare debounce resets on every change, so a page with anything that mutates
// faster than the delay — a clock, a countdown, a polling counter — pushes autosave
// into the future forever and it never fires, with nothing in the UI saying so.
// maxWait bounds that: however long the churn lasts, a save happens within
// AUTOSAVE_MAX_WAIT_MS of the first change it was waiting on. (The settled baseline
// capture in save.js already solved this for itself with MAX_SETTLE_MS.)
const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_MAX_WAIT_MS = 10000;

function initSavePageOnChange() {
  Mutation.onAnyChange({
    debounce: AUTOSAVE_DEBOUNCE_MS,
    maxWait: AUTOSAVE_MAX_WAIT_MS,
    omitChangeDetails: true,
    require: 'autosave'
  }, () => {
    savePageThrottled();
  });
}

/**
 * Initialize auto-save on input events for [persist] elements
 * Form input values don't trigger DOM mutations, so we listen for input events
 */
let inputSaveTimer = null;
function initSaveOnPersistInput() {
  document.addEventListener('input', (e) => {
    if (!e.target.closest(PERSIST)) return;
    // A trusted input on a [persist] field is itself a user-driven change the
    // Mutation hub can't see (form values aren't DOM mutations). Attribute it,
    // but only when the field is inside the dirty domain: a [persist] control in
    // a no-save or freeze region contributes nothing to the saved bytes, so
    // typing in one must not arm provenance for a later background write.
    if (e.isTrusted && !skipForPolicy(resolveRegionPolicy(e.target), 'dirty')) {
      markUserDriven();
    }
    clearTimeout(inputSaveTimer);
    inputSaveTimer = setTimeout(savePageThrottled, 1500);
  }, true);
}

function init() {
  if (!document.documentElement.matches(AUTOSAVE)) return;
  if (!isEditMode) return;
  setAutosaveActive(true);
  // initUserGesture moved to save.js's init: gesture provenance belongs to every
  // editable page, not only the ones with <html autosave>.
  initSavePageOnChange();
  initSaveOnPersistInput();
}

// No window exports - savePageThrottled is exported from save-system

// Auto-init when module is imported
init();

export default init;
