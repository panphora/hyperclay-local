/**
 * Save system for clayjs
 *
 * Manual save with change detection, state management,
 * keyboard shortcuts, and save button support.
 *
 * For auto-save on DOM changes, also load the 'autosave' module.
 *
 * Built on top of save-core.js
 */

import throttle from "../lib/throttle.js";
import Mutation from "../lib/mutation.js";
import { isDraftMode, isEditMode, isOwner } from "./is-edit-mode.js";
import {
  saveCapturedHtml,
  getPageContents,
  replacePageWith as replacePageWithCore,
  addDocumentTransform,
  isSaveInProgress,
  saveFateIsUnknown,
  withKeepalive
} from "./save-core.js";
import { captureForComparison, captureForComparisonAndDirty, captureForSaveAndComparison, captureForDirtyCheck } from "./snapshot.js";
import { NO_TRIGGER_AUTOSAVE_SELECTOR } from "../lib/region-policy.js";
import { seedEtag, lastSeenEtag } from "./etag.js";
import { gateCaptureToken, gateClearIfUnchanged, pageMaybeDirty } from "../lib/dirty-gate.js";
import { hasUnsavedState } from "../lib/unsaved-state.js";
import { autosaveActive } from "../lib/autosave-state.js";
import { registerStyleAdoption } from "../lib/style-adoption.js";
import { styleComparisonStripper } from "./style-comparisons.js";
import { ROOT_LIBRARY_ATTRS, SAVE_TOKEN_ATTRS, LEGACY_SAVE_TOKEN_ATTRS, HOST_RESPONSE_ATTRS } from "../lib/root-attrs.js";
import { logSaveCheck, logBaseline } from "../lib/autosave-debug.js";
import { initUserGesture, markExplicitSave, clearExplicitSave } from "../lib/user-gesture.js";
// A deliberate import cycle: unsaved-warning reads this module's saved baseline, and
// flush asks the SAME bytes question the close warning asks, through `bytesUnsaved`.
// Both read across it at call time, never while a module is evaluating, so neither
// side sees a half-built module.
import { bytesUnsaved } from "./unsaved-warning.js";

// Keep this library's own root state out of the saved bytes.
//
// This used to write `savestatus="saved"` onto the clone instead of removing it,
// which stopped a mid-save "saving" from being baked in but still put a library
// attribute on disk. It is there today in four LOCAL_APPS documents. These three
// are this tab's UI truth, re-stamped on every load by edit-mode and by the save
// lane itself, so a stored copy is at best noise and at worst a lie: a file whose
// disk bytes say `savestatus="saved"` reads as saved before clayjs has booted.
//
// Scoped to the ROOT on purpose. `savestatus` on any other element is an authored
// attribute that `option:savestatus` reads, and stripping those would delete page
// content. Both clones get this, so the dirty comparison sees no difference.
addDocumentTransform(clone => {
  for (const name of ROOT_LIBRARY_ATTRS) clone.removeAttribute(name);
});

// Keep the host's save token out of the saved bytes, both spellings, and the response
// metadata with it.
//
// A save token is a credential for this response, never file content: htmlclay strips it
// from every save body on arrival, so it never reached disk anyway. Sending it made the
// source map, which models the bytes a save sent, describe a root tag one attribute
// longer than the file, and every offset after it was off by that much. The save
// itself is authorized by the URL, which reads the token from the live page. The
// document id is NOT stripped: htmlclay keeps it on disk on purpose.
//
// `documentetag` is the same kind of thing for a different reason. It names the version
// of the response this tab loaded, and it is replaced on every serve, so writing it to
// disk would freeze one response's stamp into the file and give the next reader a
// provenance claim about bytes nobody built a response from. Root only, like the rest of
// this transform: the same name on a child is the author's, and stripping those would
// delete page content.
addDocumentTransform(clone => {
  for (const name of [...SAVE_TOKEN_ATTRS, ...LEGACY_SAVE_TOKEN_ATTRS, ...HOST_RESPONSE_ATTRS]) clone.removeAttribute(name);
});

// ============================================
// SAVE STATE MANAGEMENT
// ============================================

let savingTimeout = null;

/**
 * Sets the save status on <html> and dispatches an event.
 *
 * @param {string} state - One of: 'saving', 'saved', 'offline', 'error', 'conflict'
 * @param {string} msg - Optional message (e.g., error details)
 * @param {string} msgType - Optional severity from the server (e.g., 'warning')
 * @param {Object} [extra] - Extra detail fields for the event (e.g. `changedBy`)
 */
function setSaveState(state, msg = '', msgType = '', extra = null) {
  if (savingTimeout) {
    clearTimeout(savingTimeout);
    savingTimeout = null;
  }

  document.documentElement.setAttribute('savestatus', state);

  const event = new CustomEvent(`clay:save-${state}`, {
    detail: { msg, msgType, timestamp: Date.now(), ...(extra || {}) }
  });
  document.dispatchEvent(event);
}

/**
 * Sets DOM state to 'offline' immediately, but does NOT fire an event.
 * Used for instant UI feedback before we know the final state.
 */
function setOfflineStateQuiet() {
  if (savingTimeout) {
    clearTimeout(savingTimeout);
    savingTimeout = null;
  }
  document.documentElement.setAttribute('savestatus', 'offline');
}

/**
 * Starts a debounced 'saving' state.
 * Only shows 'saving' if the save takes longer than 500ms.
 * This prevents UI flicker on fast saves.
 */
function setSavingState() {
  savingTimeout = setTimeout(() => {
    setSaveState('saving');
  }, 500);
}

// ============================================
// OFFLINE DETECTION
// ============================================

window.addEventListener('offline', () => {
  setOfflineStateQuiet();
});

window.addEventListener('online', () => {
  if (document.documentElement.getAttribute('savestatus') !== 'offline') return;
  savePage().then((result) => {
    // The page went offline with everything already saved, so there is nothing
    // to send and the offline chip is simply stale. Clear it directly rather
    // than through setSaveState: no save happened, and dispatching
    // clay:save-saved would run every [onaftersave] handler and light every
    // status chip as though one had.
    if (result.msgType === 'skipped' &&
        document.documentElement.getAttribute('savestatus') === 'offline') {
      document.documentElement.setAttribute('savestatus', 'saved');
    }
  });
});

// ============================================
// THE BASELINE IS THE BYTES WE SENT
// ============================================
// There is deliberately no post-save re-read of the live DOM here.
//
// One used to exist, because [onaftersave] handlers mutate the page after a save
// lands (cacheBust rewrites ?v= query params) and without it the page read dirty
// forever. But a re-read cannot tell that churn apart from something the user typed
// while the request was in flight, so it recorded those keystrokes as saved without
// ever sending them: the edit was gone, with no error, no dirty flag, and no
// close-tab warning.
//
// Post-save mutators are made invisible to the comparison instead. They remember
// what the URL was authored as and restore it on every snapshot clone, so the live
// DOM carries the busted URL and the file carries the authored one (authored-url.js,
// used by cache-bust.js and refetch-on-save.js). That leaves the baseline free to
// stay exactly what savePage sent, which is the only value true by construction.
//
// They used to mark what they touched `no-trigger-autosave` instead. That hid the
// rewrite from the comparison only once the marker had reached the baseline, so the
// FIRST save on any page using either helper was followed by a spurious dirty state
// and a false close warning. It self-healed on the next save, which is why it went
// unnoticed.

// Re-export from core for backward compatibility
export { addDocumentTransform, getPageContents };

let unsavedChanges = false;
// TWO SAVED BASELINES, one per comparison domain.
//
//   lastSavedContents — the AUTOSAVE domain (no-trigger-autosave stripped).
//     Answers "should this edit start a save on its own?" Autosave, the load
//     settle guard, the live-sync baseline and the scoped-sync merge oracle all
//     read this one, and none of them changes.
//   lastSavedDirty — the DIRTY domain (no-trigger-autosave kept). Answers "is
//     there anything here the person would lose?" Only an explicit savePage()
//     and the close warning read it.
//
// On a page with no batching region the two are byte-identical, so nothing about
// the split is observable there.
let lastSavedContents = '';
let lastSavedDirty = '';
let baselineRevision = 0;
const inFlightComparisons = new Set();
// A save was requested while one was on the wire; run one more when it settles.
let pendingSave = false;
// An autosave arrived while one of our saves was on the wire. When that save lands
// it runs the autosave check again, rules and all, rather than an explicit save.
let pendingAutosave = false;
// True while a savePage/savePageForce request is on the wire. Only those drain the
// queue when they land, so an autosave never queues behind a raw saveHtml call.
let ownSaveOnWire = false;

// ============================================
// AUTOSAVE SUSPENSION
// ============================================
//
// clay.wire holds this for the length of an agent request. The save is
// last-writer-wins with a backup, so an autosave landing while a local process is
// writing the same file posts the pre-agent document: the server backs the agent's
// bytes up and writes the browser's, the watcher's revalidation then fails, and
// the agent's work exists only in Backups while the page reports success.
//
// It suspends AUTOsave only. An explicit savePage — Cmd+S, a [trigger-save]
// button, or the wire's own pre-send flush — is a deliberate act and still runs.
//
// Reference counted, because two overlapping requests each hold it. A save
// skipped while suspended is replayed on release, or the user's edits would sit
// unsaved until something else happened to mutate the page.
let autosaveSuspended = 0;
let autosaveMissed = false;

export function suspendAutosave() {
  autosaveSuspended++;
}

export function resumeAutosave() {
  if (autosaveSuspended === 0) return;
  autosaveSuspended--;
  if (autosaveSuspended > 0 || !autosaveMissed) return;
  autosaveMissed = false;
  savePageThrottled();
}

// Whether an agent's request currently holds autosave off. A caller that forces a
// save on its own schedule (live data checkpoints) asks this first, because a
// forced save would write the browser's bytes over the agent's.
export function autosaveIsSuspended() {
  return autosaveSuspended > 0;
}

// ============================================
// THE ALL-SAVE HOLD
// ============================================
//
// While an operation owns the page's persisted state, no save goes out at all. A
// save asked for meanwhile is remembered and runs on release.
let previewHold = 0;
let previewMissed = false;
// An autosave skipped by the hold. Replayed as an autosave, so it keeps autosave
// rules (a batching-region edit still waits for an explicit save).
let previewAutosaveMissed = false;
const PREVIEW_HOLD_REASON = 'Waiting for the AI edit to be kept or reverted';
const holdReasons = new Map();

export function holdAllSaves(reason = PREVIEW_HOLD_REASON) {
  previewHold++;
  holdReasons.set(reason, (holdReasons.get(reason) || 0) + 1);
}

export function releaseAllSaves({ replay = true, reason = PREVIEW_HOLD_REASON } = {}) {
  const count = holdReasons.get(reason) || 0;
  if (count === 0) return;
  if (count === 1) holdReasons.delete(reason);
  else holdReasons.set(reason, count - 1);
  previewHold--;
  if (previewHold > 0) return;
  const missed = previewMissed;
  const autosaveMissedInHold = previewAutosaveMissed;
  previewMissed = false;
  previewAutosaveMissed = false;
  if (!replay) return;
  if (missed) savePage();
  else if (autosaveMissedInHold) savePageThrottled();
}

export function savesHeld() {
  return previewHold > 0;
}

export function saveHoldReason() {
  if (previewHold === 0) return null;
  return holdReasons.keys().next().value || PREVIEW_HOLD_REASON;
}

function heldForPreview(callback, resolve) {
  if (previewHold === 0) return false;
  previewMissed = true;
  clearExplicitSave();
  const skipped = skipped_(saveHoldReason());
  callback(skipped);
  resolve(skipped);
  return true;
}

// ============================================
// THE CONFLICT HOLD
// ============================================
//
// A 412 refuses this tab's bytes because the document changed since this tab last
// saw it (spec §6). Two things have to follow, and the second is the one that is
// easy to leave out.
//
// Nothing may be thrown away. The baselines do not advance on a refused save, so
// the edits stay dirty, the close warning still fires, and the person keeps what
// they typed. That falls out of applySaveResult and needs no special case.
//
// And autosave has to stop. Every autosave from here sends the same stamp and is
// refused for the same reason, so leaving it running means a save attempt every
// throttle window, forever, each one toasting a failure the person can do nothing
// about. The suspension clay.wire already owns is exactly the right lever: it
// stops AUTOsave only, so an explicit Cmd+S still goes out, and it replays one
// missed save on release so nothing typed during the hold is stranded.
//
// The hold is released when a save lands, whatever produced it: clay.save.overwrite,
// a live-sync frame that brought the page back in step, or the other tab going away.
let conflictHold = false;
let conflictEtag = null;

function holdForConflict(etag) {
  conflictEtag = etag ?? null;
  if (conflictHold) return;
  conflictHold = true;
  suspendAutosave();
}

function releaseConflictHold() {
  if (!conflictHold) return;
  conflictHold = false;
  conflictEtag = null;
  resumeAutosave();
}

/** True while this tab is refusing to autosave over a version it has not seen. */
export function isSaveConflicted() {
  return conflictHold;
}

/**
 * Live sync merged the version the host refused this tab over, and the tab now
 * holds that version's stamp, so the next save carries a stamp the host accepts.
 * Only that version answers the refusal: a frame with any other stamp (an older
 * save arriving late) leaves the hold alone. Autosave resumes, replaying one
 * missed save. On a manual-save page with unsaved work the root stays in
 * 'conflict' and the notice stays up until the person saves, since nothing has
 * been written yet. Not clay:save-saved: no save happened, and that event runs
 * every [onaftersave] handler. Either way clay:save-conflict-released fires, so a
 * notice can drop the refusal it was showing.
 */
export function conflictResolvedBySync(etag) {
  if (!conflictHold) return;
  if (conflictEtag && etag !== conflictEtag) return;
  conflictHold = false;
  conflictEtag = null;
  const awaitingManualSave = !autosaveActive() && pageMaybeDirty();
  if (!awaitingManualSave) {
    if (document.documentElement.getAttribute('savestatus') === 'conflict') {
      document.documentElement.setAttribute('savestatus', 'saved');
    }
    document.dispatchEvent(new CustomEvent('clay:save-conflict-resolved', {
      detail: { timestamp: Date.now() }
    }));
  }
  document.dispatchEvent(new CustomEvent('clay:save-conflict-released', { detail: { etag: etag ?? null } }));
  resumeAutosave();
}

function skipped_(msg) {
  return { ok: false, msg, msgType: 'skipped', code: null, etag: null };
}

/**
 * Apply one save result to the page's state.
 *
 * A 'skipped' result means the bytes never reached the wire, so the baseline must
 * NOT advance: recording content as saved when it was never sent is the same defect
 * as re-reading the live DOM after a save, one layer down. 'unknown' is a timeout,
 * where the write may or may not have landed, so it is not treated as success
 * either.
 */
function applySaveResult(result, forComparison, forDirty, label, gateToken, forSave = null, captureId = null) {
  if (result.ok) {
    // Both baselines advance from the SAME pre-request capture, never from the
    // live DOM, so an edit made while the request was on the wire stays unsaved.
    setLastSavedBaselines(forComparison, forDirty);
    lastSavedBytes = forSave;
    unsavedChanges = false;
    // Generation-checked: clears the scoped-sync dirty gate only if nothing
    // changed while this save was on the wire.
    gateClearIfUnchanged(gateToken);
    // The server's severity rides through untouched: a save can land AND carry a
    // warning, and the UI module is what decides how to render that.
    setSaveState('saved', result.msg || 'Saved', result.msgType);
    logBaseline(label, `${lastSavedContents.length} chars`);
    releaseConflictHold();
  } else if (result.msgType === 'conflict') {
    holdForConflict(result.conflictEtag);
    setSaveState('conflict', result.msg, result.msgType, {
      hadTimeout: result.hadTimeout === true,
      changedBy: result.changedBy ?? null,
      afterTimeout: result.afterTimeout === true,
      etag: result.conflictEtag ?? null,
      code: result.code ?? null,
      reason: result.reason ?? null,
      retryAfter: result.retryAfter ?? null,
      captureId,
    });
  } else if (result.msgType !== 'skipped') {
    const extra = {
      status: result.status ?? null,
      hadTimeout: result.hadTimeout === true,
      // The host's typed refusal, so a listener can react to the specific code
      // rather than reading the message. `retryAfter` is only set where the host
      // asked for a delay.
      code: result.code ?? null,
      reason: result.reason ?? null,
      retryAfter: result.retryAfter ?? null,
      captureId,
    };
    if (!navigator.onLine) {
      setSaveState('offline', result.msg, '', extra);
    } else {
      setSaveState('error', result.msg, '', extra);
    }
  }
}

// Run the save that arrived while this one was in flight. savePage does its own
// dirty check, so if nothing actually changed it resolves 'skipped' and stops:
// this cannot spin.
//
// Not while the last save's fate is still unknown, which happens only when the
// save timed out AND the host could not be asked what became of it. Sending then
// is sending into a question: the host is unreachable, so the save is most likely
// to time out too, and if it does reach a host that took the first write it is
// refused, which puts a conflict bar on screen seconds after a person typed,
// unprompted, over what is really a network problem. The queued state is KEPT, not
// dropped, so the newer bytes still go out on the next save; the page is still
// dirty, so an edit or a close warning will produce one.
function drainPendingSave() {
  if (!pendingSave && !pendingAutosave) return;
  if (saveFateIsUnknown()) return;
  if (pendingSave) {
    pendingSave = false;
    pendingAutosave = false;
    savePage();
    return;
  }
  pendingAutosave = false;
  savePageThrottled();
}

// State accessors for autosave module
export function getUnsavedChanges() { return unsavedChanges; }
export function setUnsavedChanges(val) { unsavedChanges = val; }
export function getLastSavedContents() { return lastSavedContents; }
export function getLastSavedDirty() { return lastSavedDirty; }

// The bytes the last successful save wrote. Live sync merges disk frames
// against them: they are what the file held when this tab last agreed with it.
let lastSavedBytes = null;
export function getLastSavedBytes() { return lastSavedBytes; }

/**
 * Install both saved baselines from one post-morph capture.
 *
 * live-sync calls this after applying a frame it verified clean, where the page
 * now IS the file on disk. Setting only the autosave baseline would leave the
 * dirty baseline describing the pre-frame page, and the close warning would then
 * warn about the frame's own content.
 */
export function setLastSavedBaselines(forComparison, forDirty) {
  lastSavedContents = forComparison;
  lastSavedDirty = forDirty;
  baselineRevision++;
}

// Kept for back-compat: a caller with one string means the page has no batching
// region, or it does not know about the split. Setting both from it is the safe
// reading, since the domains coincide exactly when there is no such region.
export function setLastSavedContents(val) {
  setLastSavedBaselines(val, val);
}

/**
 * Save the current page with change detection and state management.
 *
 * Returns a Promise that resolves with {msg, msgType} — the same object
 * passed to the callback. Promise never rejects; errors resolve with
 * msgType: 'error', skipped early-returns resolve with msgType: 'skipped'.
 *
 * @param {Function} callback - Optional callback for custom handling
 * @returns {Promise<{msg: string, msgType: string}>}
 */
export function savePage(callback = () => {}) {
  return new Promise((resolve) => {
    if (!isEditMode && !window.clay?.testMode) {
      clearExplicitSave();
      const skipped = skipped_('Not in edit mode');
      callback(skipped);
      return resolve(skipped);
    }

    if (heldForPreview(callback, resolve)) return;

    // A save is already on the wire. Remember that a newer state is waiting rather
    // than dropping it: the in-flight request carries the older bytes, and if no
    // further mutation happens to retrigger autosave, the newer ones would never
    // reach disk at all.
    // Not cleared here: pendingSave means this request is deferred, not
    // abandoned, and drainPendingSave is what eventually sends it.
    if (isSaveInProgress()) {
      pendingSave = true;
      const skipped = skipped_('Save already in progress');
      callback(skipped);
      return resolve(skipped);
    }

    // Check if offline - set DOM state immediately for UI feedback
    // but still try the fetch (navigator.onLine can be wrong)
    const wasOffline = !navigator.onLine;
    if (wasOffline) {
      setOfflineStateQuiet();
    }

    // Single capture: clone once, get both versions
    // forSave strips non-persisted regions ([no-save]/[save-remove])
    // forComparison additionally strips every autosave-off region
    let forSave, forComparison, forDirty, captureId;
    const gateToken = gateCaptureToken();
    try {
      ({ forSave, forComparison, forDirty, captureId } = captureForSaveAndComparison({ requestRefresh: true }));
    } catch (err) {
      console.error('savePage: captureForSaveAndComparison failed', err);
      clearExplicitSave();
      setSaveState('error', err.message, '', { sent: false, code: err.code ?? null });
      const result = { msg: err.message, msgType: 'error', code: err.code ?? null, etag: null };
      if (typeof callback === 'function') {
        callback(result);
      }
      return resolve(result);
    }

    // An explicit save asks the DIRTY question: write anything the person would
    // otherwise lose, including an edit inside a batching region that was never
    // going to autosave itself.
    unsavedChanges = (forDirty !== lastSavedDirty);
    logSaveCheck('savePage dirty check', !unsavedChanges);

    // Skip if content hasn't changed. Clearing the explicit intent here is the
    // whole point of scoping it: pressing Save on a clean page sends nothing, and
    // leaving "a human asked for this" armed would hand it to the next
    // background write and hide exactly the clobber the guard watches for.
    if (!unsavedChanges) {
      clearExplicitSave();
      gateClearIfUnchanged(gateToken);
      const skipped = skipped_('No changes to save');
      callback(skipped);
      return resolve(skipped);
    }

    // Start debounced 'saving' state (only shows if save takes >500ms)
    setSavingState();

    // Use the captured save path with our pre-captured content (avoids double capture)
    const comparison = { forComparison, forDirty };
    inFlightComparisons.add(comparison);
    ownSaveOnWire = true;
    saveCapturedHtml(forSave, captureId, (result) => {
      ownSaveOnWire = false;
      inFlightComparisons.delete(comparison);
      applySaveResult(result, comparison.forComparison, comparison.forDirty, 'updated after save', gateToken, forSave, captureId);
      if (typeof callback === 'function') {
        callback(result);
      }
      resolve(result);
      drainPendingSave();
    });
  });
}

/**
 * Force-save the current page (skips dirty check).
 *
 * @param {Function} callback - Optional callback for custom handling
 * @returns {Promise<{msg: string, msgType: string}>}
 */
export function savePageForce(callback = () => {}) {
  return new Promise((resolve) => {
    if (!isEditMode && !window.clay?.testMode) {
      const skipped = skipped_('Not in edit mode');
      callback(skipped);
      return resolve(skipped);
    }

    if (heldForPreview(callback, resolve)) return;

    if (isSaveInProgress()) {
      pendingSave = true;
      const skipped = skipped_('Save already in progress');
      callback(skipped);
      return resolve(skipped);
    }

    const wasOffline = !navigator.onLine;
    if (wasOffline) {
      setOfflineStateQuiet();
    }

    let forSave, forComparison, forDirty, captureId;
    const gateToken = gateCaptureToken();
    try {
      ({ forSave, forComparison, forDirty, captureId } = captureForSaveAndComparison({ requestRefresh: true }));
    } catch (err) {
      console.error('savePageForce: captureForSaveAndComparison failed', err);
      setSaveState('error', err.message, '', { sent: false, code: err.code ?? null });
      const result = { msg: err.message, msgType: 'error', code: err.code ?? null, etag: null };
      if (typeof callback === 'function') {
        callback(result);
      }
      return resolve(result);
    }

    setSavingState();

    const comparison = { forComparison, forDirty };
    inFlightComparisons.add(comparison);
    ownSaveOnWire = true;
    saveCapturedHtml(forSave, captureId, (result) => {
      ownSaveOnWire = false;
      inFlightComparisons.delete(comparison);
      applySaveResult(result, comparison.forComparison, comparison.forDirty, 'updated after force save', gateToken, forSave, captureId);
      if (typeof callback === 'function') {
        callback(result);
      }
      resolve(result);
      drainPendingSave();
    });
  });
}

// Resolve on the next save that settles, or reject once the deadline has passed.
// Every settled state is one, not just success: a save that failed is an answer about
// the page's bytes too, and the caller decides what to do with it.
function settled(deadline) {
  const events = ['clay:save-saved', 'clay:save-error', 'clay:save-offline', 'clay:save-conflict'];
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      for (const name of events) document.removeEventListener(name, onSettle);
    };
    const onSettle = () => {
      cleanup();
      resolve();
    };
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(Object.assign(new Error('Save timed out.'), { state: 'failed' }));
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error('Save timed out.'), { state: 'failed' }));
    }, remaining);
    for (const name of events) document.addEventListener(name, onSettle);
  });
}

function flushError(message, state) {
  return Object.assign(new Error(message), { state });
}

// Resolve when `name` fires on document, or reject at the deadline.
function nextEvent(name, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(flushError('Save timed out.', 'failed'));
    const timer = setTimeout(() => {
      document.removeEventListener(name, onEvent);
      reject(flushError('Save timed out.', 'failed'));
    }, remaining);
    const onEvent = () => { clearTimeout(timer); resolve(); };
    document.addEventListener(name, onEvent, { once: true });
  });
}

// Save now; answer only when the host has accepted the bytes the page holds now.
// Resolves { state: 'view' | 'clean' | 'saved', etag }. Rejects with an Error carrying
// state 'failed' (including a timeout), 'conflict', or 'blocked' (the bytes are on the
// host but the page holds work a save cannot write, registered through
// clay.registerUnsavedState; only a person can resolve that). Never overwrites.
// `keepalive` is a transport hint honoured under 60 KB of UTF-8.
export async function flushSave({ keepalive = false, timeoutMs = 15000 } = {}) {
  if (!isEditMode) return { state: 'view', etag: null };
  const deadline = Date.now() + timeoutMs;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(flushError('Save timed out.', 'failed')), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([flushBytes(keepalive, deadline), timeout]);
  } catch (err) {
    if (err && typeof err.state === 'string') throw err;
    throw flushError(err?.message || 'Save failed', 'failed');
  } finally {
    clearTimeout(timer);
  }
}

async function flushBytes(keepalive, deadline) {
  // Load-time module churn is not the person's work: autosave never saves it, and
  // neither does a flush. Wait for the baseline to settle (at most MAX_SETTLE_MS).
  if (!baselineSettled()) await nextEvent('clay:baseline-settled', deadline);

  let saved = false;
  let etag = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (isSaveInProgress()) await settled(deadline);
    if (isSaveConflicted()) throw flushError('This document has a conflict to resolve.', 'conflict');
    const token = gateCaptureToken();
    if (!bytesUnsaved()) {
      gateClearIfUnchanged(token);
      if (hasUnsavedState()) throw flushError('This document has unsaved work a save cannot write.', 'blocked');
      return { state: saved ? 'saved' : 'clean', etag: etag ?? lastSeenEtag() };
    }
    const result = await withKeepalive(keepalive, () => savePage());
    // The lane was busy (a drained pending save is on the wire): wait it out next turn.
    if (result.msgType === 'skipped') continue;
    if (!result.ok) throw flushError(result.msg || 'Save failed', result.msgType === 'conflict' || isSaveConflicted() ? 'conflict' : 'failed');
    saved = true;
    etag = result.etag ?? null;
  }
  throw flushError('The document kept changing while saving.', 'failed');
}

/**
 * Keep this tab's version, over the one the host is holding.
 *
 * The only exit from a conflict that keeps what is on screen. It asks the host for
 * the document's current stamp and force-saves with it, so the save that follows
 * carries a value the host will accept. If the host answers with no stamp at all,
 * the save goes out unconditional, which is last write wins, which is what the
 * person just asked for by name.
 *
 * Deliberately not automatic, and deliberately not what a second Cmd+S does. A
 * person pressing Save again has not been shown the other version, and reading
 * that as consent to replace it destroys exactly the copy this capability exists
 * to protect. The other two answers to a conflict need nothing from this library:
 * `location.reload()` takes the host's version, and a page that wants to merge
 * merges into its own DOM and then calls this.
 *
 * @param {Function} callback - Optional callback for custom handling
 * @returns {Promise<{ok: boolean, msg: string, msgType: string}>}
 */
export async function saveOverwritingConflict(callback = () => {}) {
  await seedEtag({ fresh: true });
  return savePageForce(callback);
}

/**
 * Fetch HTML from a URL and save it, then reload
 * Emits error event if save fails
 *
 * @param {string} url - URL to fetch from
 */
export function replacePageWith(url) {
  if (!isEditMode || isDraftMode) {
    return;
  }

  replacePageWithCore(url, (result) => {
    // Reload ONLY on a save that actually landed. A skipped result means the
    // replacement never happened (busy lane, or not in edit mode), and reloading
    // then presented a no-op as a completed swap.
    if (result.ok) {
      window.location.reload();
    } else if (result.msgType === 'skipped') {
      setSaveState('error', result.msg || 'Template not saved');
    } else {
      setSaveState('error', result.msg || 'Failed to save template');
    }
  });
}

// Throttled version of savePage for auto-save
const throttledSave = throttle(savePage, 1200);

// Baseline for autosave comparison
let baselineContents = '';
// The baseline veto only guards the load-time settle window; captureBaseline
// disarms it. See the comment there.
let baselineActive = true;
// True once the load-time settle has run. Live sync refreshes an untouched tab's
// merge bases at this moment: modules that build DOM at boot (an editor mounting
// from an editmode:resource script) are in the page by now.
let baselineSettledAt = false;
export function baselineSettled() { return baselineSettledAt; }

registerStyleAdoption(identity => {
  const strip = styleComparisonStripper(identity);
  lastSavedContents = strip(lastSavedContents);
  lastSavedDirty = strip(lastSavedDirty);
  baselineContents = strip(baselineContents);
  for (const comparison of inFlightComparisons) {
    comparison.forComparison = strip(comparison.forComparison);
    comparison.forDirty = strip(comparison.forDirty);
  }
});

// ============================================
// BASELINE CAPTURE (Settled Signal)
// ============================================
//
// WHY SETTLED SIGNAL:
// Modules run on load and mutate the DOM (add styles, modify attributes).
// A fixed delay (e.g., 1500ms) is arbitrary and either too short (misses slow
// mutations) or too long (delays baseline). Instead, we wait for mutations to
// stop, meaning all modules have finished their setup work.
//
// WHY IMMEDIATE + CONDITIONAL UPDATE:
// We set baseline immediately as a safety net. If the user edits or saves
// before settle completes, we don't overwrite their work. The settled snapshot
// only replaces baseline if no user input or baseline installation intervened.

const SETTLE_MS = 500;        // Wait for no mutations for this long
const MAX_SETTLE_MS = 3000;   // Max time to wait before forcing capture

function initBaselineCapture() {
  if (!isEditMode) return;

  let userEdited = false;
  let settled = false;
  let unsubscribeMutation = null;

  // Take immediate snapshot and set as baseline right away
  // This ensures saves during settle window work correctly
  // Store stripped version so comparisons are direct (no parsing needed)
  const { forComparison: immediateContents, forDirty: immediateDirty } = captureForComparisonAndDirty();
  setLastSavedBaselines(immediateContents, immediateDirty);
  const immediateRevision = baselineRevision;
  baselineContents = immediateContents;
  logBaseline('immediate capture', `${immediateContents.length} chars`);

  // Track user edits to avoid overwriting real changes
  const userEditEvents = ['input', 'change', 'paste'];
  const markUserEdited = (e) => {
    const target = e.target;
    const isEditable = target.isContentEditable ||
                       target.tagName === 'INPUT' ||
                       target.tagName === 'TEXTAREA' ||
                       target.tagName === 'SELECT';
    if (isEditable) userEdited = true;
  };
  userEditEvents.forEach(evt => document.addEventListener(evt, markUserEdited, true));

  // Called when mutations settle OR max timeout reached
  const captureBaseline = () => {
    if (settled) return;
    settled = true;

    // Cleanup listeners
    if (unsubscribeMutation) unsubscribeMutation();
    userEditEvents.forEach(evt => document.removeEventListener(evt, markUserEdited, true));

    // Adoption only removes owned styles from comparison state. It does not
    // advance this revision. A save or sync installation does, even when its
    // comparison bytes match, so settle cannot absorb a later unsent edit.
    if (!userEdited && baselineRevision === immediateRevision) {
      // Store stripped version so comparisons are direct (no parsing needed)
      const gateToken = gateCaptureToken();
      const { forComparison: contents, forDirty: contentsDirty } = captureForComparisonAndDirty();
      setLastSavedBaselines(contents, contentsDirty);
      baselineContents = contents;
      // Boot churn (modules rewriting attributes at DOM-ready) counted toward
      // the scoped-sync gate; the settled baseline is the proof it wasn't edits.
      gateClearIfUnchanged(gateToken);
      logBaseline('settled capture', `${contents.length} chars`);
    } else {
      logBaseline('settled skipped', userEdited ? 'user edited' : 'save occurred during settle');
    }

    // The load-time veto has done its job. It exists so setup churn from modules
    // booting cannot trigger a save, and that window is over once mutations have
    // settled. Leaving it armed for the life of the tab is what made an undo back
    // to the page's original state unsaveable: it differed from lastSavedContents
    // but matched baselineContents, so autosave vetoed it forever and only a manual
    // save could persist the revert.
    baselineActive = false;

    document.documentElement.setAttribute('savestatus', 'saved');
    baselineSettledAt = true;
    document.dispatchEvent(new CustomEvent('clay:baseline-settled'));
  };

  // Start settle observer - fires when no mutations for SETTLE_MS.
  // require:'autosave' so churn in no-save / save-* / no-watch regions doesn't
  // keep resetting the settle timer or count toward the baseline.
  unsubscribeMutation = Mutation.onAnyChange(
    { debounce: SETTLE_MS, omitChangeDetails: true, require: 'autosave' },
    captureBaseline
  );

  // Max timeout fallback
  setTimeout(() => {
    if (!settled) captureBaseline();
  }, MAX_SETTLE_MS);
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBaselineCapture);
} else {
  initBaselineCapture();
}

/**
 * Save the page with throttling, for use with auto-save.
 * Checks both baseline and last saved content to prevent saves from initial setup.
 *
 * Returns a Promise resolving with {msg, msgType}. Within-throttle-window calls
 * piggyback on the trailing-edge save and resolve with its result.
 *
 * @param {Function} callback - Optional callback
 * @returns {Promise<{msg: string, msgType: string}>}
 */
export function savePageThrottled(callback = () => {}) {
  if (!isEditMode) {
    const skipped = skipped_('Not in edit mode');
    callback(skipped);
    return Promise.resolve(skipped);
  }

  if (previewHold > 0) {
    previewAutosaveMissed = true;
    const skipped = skipped_(saveHoldReason());
    callback(skipped);
    return Promise.resolve(skipped);
  }

  // Every autosave path lands here — the mutation-driven one, the [persist] input
  // timer, and live-sync's convergence save after a protected apply — which is
  // why the suspension lives at this one entry rather than at each caller.
  if (autosaveSuspended > 0) {
    autosaveMissed = true;
    const skipped = skipped_('Autosave suspended');
    callback(skipped);
    return Promise.resolve(skipped);
  }

  // One of our saves is on the wire: queue this autosave instead of copying the
  // page to compare. When that save lands, drainPendingSave runs this check again.
  // Not while the page is settling, where every candidate save must pass the
  // baseline veto below.
  if (!baselineActive && ownSaveOnWire) {
    pendingAutosave = true;
    const skipped = skipped_('Save already in progress');
    callback(skipped);
    return Promise.resolve(skipped);
  }

  // For autosave: while the page is still settling, content must differ from BOTH
  // the load-time baseline and the last save, so module setup churn cannot trigger
  // a save. Once settled, the baseline veto is disarmed and only the last save
  // matters — otherwise undoing back to the page's original state can never be
  // persisted, because it matches the baseline forever.
  // Compare directly - stored versions are already stripped
  const gateToken = gateCaptureToken();
  let currentForCompare;
  let dirtyMatchesLastSave;
  try {
    currentForCompare = captureForComparison();
    // This comparison leaves out batching (no-trigger-autosave) regions, which the
    // gate counts, so on a page that has one the dirty domain must match too.
    dirtyMatchesLastSave = () => !document.querySelector(NO_TRIGGER_AUTOSAVE_SELECTOR)
      || (pageMaybeDirty() && captureForDirtyCheck({ flushUndo: false }) === lastSavedDirty);
  } catch (err) {
    console.error('savePageThrottled: captureForComparison failed', err);
    setSaveState('error', err.message);
    const result = { msg: err.message, msgType: 'error', code: null, etag: null };
    callback(result);
    return Promise.resolve(result);
  }
  const differsFromBaseline = !baselineActive || currentForCompare !== baselineContents;
  const differsFromLastSave = currentForCompare !== lastSavedContents;

  logSaveCheck('throttled vs baseline', !differsFromBaseline);
  logSaveCheck('throttled vs lastSave', !differsFromLastSave);

  if (!(differsFromBaseline && differsFromLastSave)) {
    let clear = false;
    try {
      clear = !differsFromLastSave && dirtyMatchesLastSave();
    } catch (err) {
      console.error('savePageThrottled: captureForDirtyCheck failed', err);
    }
    if (clear) gateClearIfUnchanged(gateToken);
    const skipped = skipped_('No changes to save');
    callback(skipped);
    return Promise.resolve(skipped);
  }

  unsavedChanges = true;
  // The throttled promise can reject now that a throwing save no longer strands
  // its callers (see throttle.js), and both autosave call sites are fire-and-forget,
  // with no reach into this module's error path. Catch it here, the one place that
  // owns that path, so every caller keeps the never-rejects contract savePage
  // documents and a throw surfaces as a failed save instead of an unhandled rejection.
  return throttledSave(callback).catch(err => {
    const result = { ok: false, msg: err?.message || 'Save failed', msgType: 'error', code: null, etag: null };
    setSaveState('error', result.msg);
    return result;
  });
}

/**
 * Initialize keyboard shortcut for save (CMD/CTRL+S)
 */
export function initSaveKeyboardShortcut() {
  document.addEventListener("keydown", function(event) {
    let isMac = window.navigator.platform.match("Mac");
    let metaKeyPressed = isMac ? event.metaKey : event.ctrlKey;
    if (metaKeyPressed && event.keyCode == 83) {
      event.preventDefault();
      // isTrusted, so a script calling dispatchEvent cannot manufacture human
      // provenance for a write the person never asked for.
      if (event.isTrusted) markExplicitSave();
      savePage();
    }
  });
}

/**
 * Initialize save button handler
 * Looks for elements with [trigger-save] attribute
 */
export function initHyperclaySaveButton() {
  document.addEventListener("click", event => {
    if (event.target.closest("[trigger-save]")) {
      // el.click() is isTrusted:false, so this cannot be faked from script.
      if (event.isTrusted) markExplicitSave();
      savePage();
    }
  });
}

/**
 * Initialize the save system (keyboard shortcut and save button)
 * For auto-save, also load the 'autosave' module
 */
export function init() {
  if (!isEditMode) return;

  // §6's stamp for a page that has never saved. Fired here and never awaited: the
  // request a person feels is the save, and a host with no /_/meta would make every
  // first save wait out a discovery timeout for an answer that was never coming.
  // Until the seed lands the first save goes out unconditional, which is last write
  // wins, which is what every save did before this existed. This is also the only
  // moment the seed can be useful at all: ask for it lazily at the first save and
  // it can never arrive in time for that save, and from the second save onward the
  // first save's own response has already supplied one.
  seedEtag();

  // Every editable page, not just autosave pages. A manual-save page makes
  // exactly the saves a person asked for, and used to report all of them as
  // background writes because this was installed behind the autosave gate.
  initUserGesture();
  initSaveKeyboardShortcut();
  initHyperclaySaveButton();
}

// Auto-init when module is imported
init();

export default savePage;
