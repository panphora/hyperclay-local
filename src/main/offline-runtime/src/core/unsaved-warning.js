/**
 * Unsaved Warning Module
 *
 * Warns users before leaving the page if there are unsaved changes.
 * Self-contained: compares current page content to last saved content on beforeunload.
 *
 * Works independently of autosave - no mutation observer needed during editing,
 * just a single comparison when the user tries to leave.
 *
 * Both current and stored content have [save-remove] stripped, so comparison is
 * direct with no parsing needed. [save-ignore] / no-trigger-autosave regions are
 * KEPT here: they don't trigger an autosave, so an edit in one is precisely the
 * kind that would be lost without a warning.
 *
 * Requires the 'save-system' module (automatically included as dependency).
 */

import { isEditMode, isDraftMode } from "./is-edit-mode.js";
import { draftStoreFailed, flushDraft } from "./draft-mode.js";
import { captureForDirtyCheck } from "./snapshot.js";
import { getLastSavedDirty } from "./save.js";
import { logUnloadDiffSync, preloadIfEnabled } from "../lib/autosave-debug.js";
import { hasUnsavedState } from "../lib/unsaved-state.js";

// One beforeunload let through, for the reload a person confirmed with two presses
// in the conflict notice. Nothing else is switched off: the next close still warns.
let discardPermit = false;
export function reloadAfterDiscard({ isCurrent, reload }) {
  if (!isCurrent()) return false;
  discardPermit = true;
  // Browsers fire beforeunload for a reload on their own schedule; a permit still
  // unused a second later means the navigation did not happen.
  setTimeout(() => { discardPermit = false; }, 1000);
  reload();
  return true;
}

// Pre-load diff library if debug mode is on (so it's ready for unload)
preloadIfEnabled();

// Gated on isEditMode, not isOwner. isOwner means the platform's admin cookie
// specifically, so gating on it switched the warning off for every host that
// authenticates another way: htmlclay, anything using a root save token, and any
// sandboxed document, which cannot read cookies at all. Those are exactly the
// documents where an unsaved edit is easiest to lose. If the page is editable,
// the person editing it deserves the warning.
//
// The same predicate is exposed as `clay.hasUnsavedChanges`, which a host asks
// synchronously before deciding whether a save is worth asking for.
export function hasUnsavedChanges() {
  if (!isEditMode) return false;

  // Work outside the DOM first: it needs no capture, and a capture that throws
  // must not hide it. The demo plugin does not save it either, so it warns there too.
  if (hasUnsavedState()) return true;
  if (isDraftMode) return draftStoreFailed();

  // The demo plugin saves the page's bytes into this browser's own storage, so
  // leaving loses none of them.
  if (window.clay?.demo) return false;

  return bytesUnsaved();
}

// The page's own bytes against the last bytes the host accepted. A capture that throws
// counts as unsaved: something on the page is broken, and "nothing to lose" is the one
// answer that can lose work.
//
// The DIRTY domain, not the autosave domain. An edit inside a no-trigger-autosave
// region never starts a save by itself, which is exactly why closing the tab on one has
// to warn: nothing else is going to write it.
export function bytesUnsaved() {
  if (!isEditMode) return false;
  try {
    return captureForDirtyCheck() !== getLastSavedDirty();
  } catch {
    return true;
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!isEditMode) return;

  if (discardPermit) {
    discardPermit = false;
    return;
  }

  const flushed = isDraftMode ? flushDraft() : true;
  if (flushed && !hasUnsavedChanges()) return;

  event.preventDefault();
  event.returnValue = '';
  // Debug only, after the decision: a capture that throws here must not cancel the warning.
  if (!window.clay?.demo && !hasUnsavedState()) {
    try {
      const currentForCompare = captureForDirtyCheck();
      const lastSaved = getLastSavedDirty();
      if (currentForCompare !== lastSaved) logUnloadDiffSync(currentForCompare, lastSaved);
    } catch {}
  }
});
