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
import { autosaveScheduler, savesAdmitted } from "./save.js";
import { markUserDriven } from "../lib/user-gesture.js";
import { resolveRegionPolicy, skipForPolicy } from "../lib/region-policy.js";
import { PERSIST, AUTOSAVE } from "../lib/attr-aliases.js";
import { setAutosaveActive } from "../lib/autosave-state.js";

/**
 * Initialize auto-save on DOM changes
 *
 * The scheduler owns the quiet period and the maximum wait, so this subscriber
 * only reports that content changed. No debounce here: the hub's would be a
 * second timer measuring the same quiet window, and the page must not be copied
 * to answer a question the scheduler has not yet admitted.
 */
function initSavePageOnChange() {
  Mutation.onAnyChange({
    debounce: 0,
    omitChangeDetails: true,
    require: 'autosave'
  }, () => {
    if (!savesAdmitted()) return;
    autosaveScheduler.noteActivity();
  });
}

/**
 * Initialize auto-save on input events for [persist] elements
 * Form input values don't trigger DOM mutations, so we listen for input events
 */
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
    if (!savesAdmitted()) return;
    autosaveScheduler.noteActivity();
  }, true);
}

/**
 * Record editable input and composition activity while an automatic save is
 * pending.
 *
 * An active IME changes nothing in the canonical record yet, so a pause between
 * composition updates would read as quiet and the capture would land mid-word.
 * This records timing only: it makes no input dirty, so a frozen editor and a
 * no-save field still save nothing.
 */
function initRecordEditActivity() {
  const noteActivity = (e) => {
    if (!autosaveScheduler.pending()) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    const field = target.closest('input, textarea, select, [contenteditable]');
    if (!field) return;
    if (skipForPolicy(resolveRegionPolicy(field), 'dirty')) return;
    if (!savesAdmitted()) return;
    autosaveScheduler.noteActivity();
  };
  document.addEventListener('input', noteActivity, true);
  document.addEventListener('compositionupdate', noteActivity, true);
}

let installed = false;

/**
 * Loader-managed initialization, and the import's own: one subscription set per page.
 *
 * A live re-entry asks for the autosave this page already has, not a second one, so the
 * listeners above are installed once and an activity report they make while a save
 * session has admission closed is dropped rather than arming another timer.
 */
function install() {
  if (installed) return;
  if (!document.documentElement.matches(AUTOSAVE)) return;
  if (!isEditMode) return;
  installed = true;
  setAutosaveActive(true);
  // initUserGesture moved to save.js's init: gesture provenance belongs to every
  // editable page, not only the ones with <html autosave>.
  initSavePageOnChange();
  initSaveOnPersistInput();
  initRecordEditActivity();
}

// No window exports - the scheduler lives in save-system and savePageThrottled is
// exported from there

// Auto-init when module is imported
install();

export { install as init };
export default install;

/**
 * Auto-save as a mode participant.
 *
 * A live entry imports this module in view, where `install` above is inert, so the
 * participant is how the entry asks for it once the mode has committed. Nothing here
 * belongs to a session: the scheduler already parks an attempt a closed save session
 * refuses (`savePageThrottled`) and replays it on `resume`, and every attempt checks the
 * mode, so quiesce and dispose have nothing to undo. `initial: true` adopts the edit this
 * tab booted into, where the import's own `install` already ran: the lease starts nothing.
 */
export function modeParticipant() {
  return {
    id: "clay:autosave",
    order: 20,
    prepare(context = {}) {
      if (context.initial === true) return { enable() {}, quiesce() {}, resume() {}, dispose() {} };
      return { enable: install, quiesce() {}, resume() {}, dispose() {} };
    },
  };
}
