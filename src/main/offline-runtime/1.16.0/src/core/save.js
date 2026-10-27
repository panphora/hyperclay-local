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
import { captureForComparisonAndDirty, captureForSaveAndComparison, captureForDirtyCheck, captureSaveClone, releaseCaptureArtifact } from "./snapshot.js";
import { saveLimit, saveLimits, inspectSaveSize } from "./save-size.js";
import { paintSignature } from "../lib/derived.js";
import { NO_TRIGGER_AUTOSAVE_SELECTOR } from "../lib/region-policy.js";
import { seedEtag, learnConditionalSaves, lastSeenEtag, recordEtag } from "./etag.js";
import { startDirtyGate, gateCaptureToken, gateClearIfUnchanged, gateRevision, pageMaybeDirty } from "../lib/dirty-gate.js";
import { hasUnsavedState } from "../lib/unsaved-state.js";
import { autosaveActive } from "../lib/autosave-state.js";
import { registerStyleAdoption } from "../lib/style-adoption.js";
import { ROOT_LIBRARY_ATTRS, SAVE_TOKEN_ATTRS, LEGACY_SAVE_TOKEN_ATTRS, HOST_RESPONSE_ATTRS } from "../lib/root-attrs.js";
import { logSaveCheck, logBaseline } from "../lib/autosave-debug-gate.js";
import { initUserGesture, markExplicitSave, clearExplicitSave } from "../lib/user-gesture.js";
// A deliberate import cycle: unsaved-warning reads this module's saved baseline, and
// flush asks the SAME bytes question the close warning asks, through `bytesUnsaved`.
// Both read across it at call time, never while a module is evaluating, so neither
// side sees a half-built module.
import { bytesUnsaved } from "./unsaved-warning.js";
import { bootPhase } from "./boot-phase.js";
import { createAutosaveScheduler } from "../lib/autosave-scheduler.js";
import { noteRecoveryCapture, noteRecoverySettled } from "./recovery.js";

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
  if (autosaveSuspended > 0) return;
  if (soonDeferred) {
    soonDeferred = false;
    soonTimer = setTimeout(fireSoon, 0);
  }
  if (!autosaveMissed) return;
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
// THE SAVE SESSION
// ============================================
//
// One lifetime per admitted editing session: `start` when the page admits input,
// `quiesce` while an exit is being decided, `resume` when that exit is refused, `stop`
// once it is committed. What the session owns is ADMISSION: whether an ordinary save and
// the automatic lane may write right now.
//
// What it does not own is the page's saved bytes. A quiesce is not a reload, so the
// session never runs the boot settle again, never takes a capture for itself and never
// writes a baseline: the bytes an exit is reconciled against are the ones the last
// accepted save (or the served file) left behind, and the next real save carries the
// snapshot's own capture identity.
//
// Work that arrives while admission is closed stays pending and stays visible. A denied
// save writes nothing, clears no gate token and keeps the explicit-save intent armed, so
// the page keeps reporting the bytes it still holds; the session also records the dirty
// gate's revision, so an exit can prove nothing new arrived while it was closed instead
// of assuming quiet.
let quiescedSessions = 0;
let parkedWork = false;
let parkedAutosave = false;
// Whether the page still held bytes no save had written when its session stopped. A
// view-time write is not that: an entry takes the page as it stands. Work an editing
// session left unsaved is the person's, and absorbing it into a baseline would make it
// read as saved, so the next entry refuses instead.
let unsavedAtStop = false;

/**
 * Whether a save may go out right now.
 *
 * An open session admits everything. A closed one admits only the caller that holds a
 * permit minted for the generation currently owning the page — the exit's own barrier.
 */
export function savesAdmitted(permit = null) {
  return quiescedSessions === 0 || permitHolds(permit);
}

/**
 * Edited bytes a closed session parked, that no accepted save has covered since. The DOM
 * still holds them and the host does not, in whatever mode the page is in by then, so the
 * close warning reads this rather than the committed mode.
 */
export function sessionParked() {
  return parkedWork;
}

// The bytes a stopping session leaves behind, that no save has written: parked work is
// work even when the page has been put back since, and a capture that throws counts as
// work, because "nothing is unsaved" is the one answer that can lose something.
function heldWork() {
  if (parkedWork) return true;
  try {
    const current = captureForDirtyCheck({ flushUndo: false });
    if (styleAdoptionPending(current)) return false;
    return current !== lastSavedDirty;
  } catch {
    return true;
  }
}

/**
 * One editing session's admission lifetime.
 *
 * `changedWhileClosed` answers the exit's own question — did the page gain work while
 * admission was closed? — from the gate's revision, which is why a quiesce costs no
 * capture. `stop` releases the hold without replaying anything: the exit that stops a
 * session has already accounted for the bytes, and a refused one resumes instead.
 */
export function saveSession() {
  let phase = "idle";
  let revisionAtQuiesce = 0;

  return {
    get phase() {
      return phase;
    },
    get open() {
      return phase === "open";
    },
    changedWhileClosed() {
      return phase === "quiesced" && gateRevision() !== revisionAtQuiesce;
    },
    start() {
      if (phase !== "idle") return;
      phase = "open";
    },
    quiesce() {
      if (phase !== "open") return;
      phase = "quiesced";
      revisionAtQuiesce = gateRevision();
      quiescedSessions++;
    },
    resume() {
      if (phase !== "quiesced") return;
      phase = "open";
      quiescedSessions--;
      if (quiescedSessions > 0) return;
      replayParkedAutosave();
      releaseDeferredSoon();
    },
    stop() {
      if (phase === "stopped") return;
      const wasQuiesced = phase === "quiesced";
      // A session that ran and is now over answers for the bytes it leaves behind, so an
      // entry after it can tell the person's work from what a script did in view.
      if ((wasQuiesced || phase === "open") && heldWork()) unsavedAtStop = true;
      phase = "stopped";
      if (!wasQuiesced) return;
      quiescedSessions--;
      if (quiescedSessions === 0) releaseDeferredSoon();
    },
  };
}

// ============================================
// THE MODE PARTICIPANT
// ============================================
//
// A live entry imports this module while the page is still in view, so the installs the
// boot road performs at evaluation are inert there. The participant is how an entry asks
// for them: `prepare` builds the session, `enable` performs the installs once per page,
// and `adoptEntryBaseline` takes the entry's baseline from the represented file.

// Page-lifetime: a second entry starts its session and installs nothing again.
let servicesInstalled = false;
// The last accepted save, as the receipt an exit hands the next reader.
let acceptedSave = null;
// The version the kept baselines were taken at. A second entry can then tell the person's
// work from what the file delivered.
let baselineEtag = null;
let baselineKept = false;

/**
 * The bytes and stamp of this session's last accepted save, or null when it made none.
 *
 * A save belongs to the session it was made in: an exit hands the next reader its
 * own save, never an older session's, or a clean session would hand back a file
 * another tab has since replaced.
 */
export function acceptedReceipt(generation = saveGenerationAt) {
  if (!acceptedSave || acceptedSave.generation !== generation) return null;
  const { bytes, etag } = acceptedSave;
  return { bytes, etag };
}

/**
 * Adopt the represented file as this session's baseline, after every document transform
 * is installed. One capture, both baselines, the settled mark and its event: the boot
 * settle's job without a second settle over the reader's DOM.
 *
 * A second entry keeps the first one's baseline, taken at a version of the file. A page
 * that moved while it was in view is taken as it now stands: a clock, a counter or a
 * reader's own repaint is the page's doing, not the person's, and refusing it would block
 * every entry for as long as that write stays. What is refused is the one case that is
 * the person's: the session it ran left work no save wrote, and nothing says the file
 * moved — which a stamp the host never answered and a baseline this page never kept both
 * leave open.
 */
export function adoptEntryBaseline({ represented } = {}) {
  const token = gateCaptureToken();
  const { forComparison, forDirty } = captureForComparisonAndDirty();
  const etag = typeof represented?.etag === "string" && represented.etag ? represented.etag : null;

  // Work a session left unsaved is the person's. A version the file has moved past is
  // the page's own doing, and refusing it would block every entry for as long as that
  // write stays; a stamp that is missing, or a baseline this page never kept, cannot say
  // the file did not move, so those are refused exactly as the stamped path refuses them.
  const moved = baselineKept && etag !== null && etag !== baselineEtag;
  if (!moved && unsavedAtStop && (forComparison !== lastSavedContents || forDirty !== lastSavedDirty)) {
    return { ok: false, code: "pending-input" };
  }

  unsavedAtStop = false;
  setLastSavedBaselines(forComparison, forDirty);
  baselineContents = forComparison;
  baselineActive = false;
  baselineSettledAt = true;
  baselineEtag = etag;
  baselineKept = true;
  gateClearIfUnchanged(token);
  document.documentElement.setAttribute('savestatus', 'saved');
  document.dispatchEvent(new CustomEvent('clay:baseline-settled'));
  return { ok: true };
}

// The host's conditional-save capability is learned from discovery, which is a request
// of its own, and the commit that enters edit cannot wait for it. The session keeps the
// promise and the save path waits on it, so the first save after a live entry still
// carries If-Match instead of going out unconditional because the answer was in flight.
let capabilityKnown = Promise.resolve(false);
let capabilityPending = false;
const learnCapability = () => {
  capabilityPending = true;
  return learnConditionalSaves()
    .catch(() => false)
    .then((supported) => {
      capabilityPending = false;
      return supported;
    });
};

/**
 * The save system as a mode participant: a fresh session plus the page's installs on a
 * live entry, and, on adoption, a session in phase `open` over what the import already
 * installed and nothing new.
 */
export function modeParticipant() {
  return {
    id: "clay:save",
    order: 10,
    prepare(context = {}) {
      const session = saveSession();
      if (context.initial === true) session.start();
      return {
        enable() {
          // Every session learns the capability and records the stamp it represents:
          // a live entry included, and a re-entry after the stamp advanced in view.
          capabilityKnown = learnCapability();
          const etag = context.represented?.etag;
          if (typeof etag === "string" && etag) recordEtag(etag);
          if (context.initial === true) return;
          installOnce();
          session.start();
        },
        quiesce: () => session.quiesce(),
        resume: () => session.resume(),
        dispose: () => session.stop(),
      };
    },
  };
}

// What `init` installed for a boot in edit. The baseline is not among it: `adoptEntryBaseline`
// settles that from the represented file, and the boot settle would settle over the reader's DOM.
function installOnce() {
  if (servicesInstalled) return;
  servicesInstalled = true;
  startDirtyGate();
  initUserGesture();
  initSaveKeyboardShortcut();
  initHyperclaySaveButton();
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

// A save asked for while a session has admission closed. It writes nothing, so nothing
// about the page's state may move: no capture, no gate token, no baseline. Only work that
// would be lost is recorded, so a save asked for on a clean page cannot make the close
// warning fire later for a page that lost nothing.
function sessionClosed(msg) {
  if (pageMaybeDirty() || hasUnsavedState()) parkedWork = true;
  return skipped_(msg);
}

// The exit's own flush is not an ordinary save: it is the barrier writing the bytes the
// exit is about to account for, so it runs under a permit. Nothing else does — a Cmd+S or
// a [trigger-save] press while admission is closed stays parked.
//
// A permit is an opaque identity bound to ONE mode generation: it is minted by the
// controller that owns that generation, it stops admitting the moment the next generation
// commits, and it is revoked when the barrier that owns it finishes. That is what keeps a
// delayed callback from writing across a switch, and it is why there is no public `force`
// flag here: nothing a page can call mints one of these.
const livePermits = new Set();
let saveGenerationAt = 0;

/** The mode generation ordinary saves are being admitted against. */
export function saveGeneration() {
  return saveGenerationAt;
}

/**
 * A new generation has committed. Permits minted for the old one stop admitting: an exit
 * that was flushing generation N must not write once generation N+1 owns the page.
 */
export function setSaveGeneration(generation) {
  if (typeof generation === 'number') saveGenerationAt = generation;
}

/** Mint a permit for one generation. Opaque, and only this module reads what it means. */
export function openSavePermit(generation = saveGenerationAt) {
  const permit = Object.freeze({ generation });
  livePermits.add(permit);
  return permit;
}

/** Revoke a permit: the barrier that owned it is over. Idempotent. */
export function closeSavePermit(permit) {
  livePermits.delete(permit);
}

function permitHolds(permit) {
  return !!permit && livePermits.has(permit) && permit.generation === saveGenerationAt;
}

/**
 * Tell the recovery service how this capture settled.
 *
 * One place, so every outcome is reported exactly once: a confirmed success is the
 * only one that can acknowledge a recovery copy, and it acknowledges only what this
 * capture's own bytes covered. A skip, a refusal, an error and an unknown outcome
 * release the capture and leave every copy where it is.
 */
function settleRecoveryCapture(captureId, result) {
  if (captureId == null) return;
  noteRecoverySettled({ captureId, ok: result.ok === true, etag: result.etag ?? null });
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
function applySaveResult(result, forComparison, forDirty, label, gateToken, forSave = null, captureId = null, quietConflict = false) {
  settleRecoveryCapture(captureId, result);
  if (result.ok) {
    // These bytes are on the host now, so nothing a closed session parked is still
    // waiting for a write.
    parkedWork = false;
    // Both baselines advance from the SAME pre-request capture, never from the
    // live DOM, so an edit made while the request was on the wire stays unsaved.
    setLastSavedBaselines(forComparison, forDirty);
    lastSavedBytes = forSave;
    // The receipt a mode exit hands the next reader, and the version the baselines above
    // were taken at: both describe the bytes the host just accepted.
    acceptedSave = { bytes: forSave, etag: lastSeenEtag(), generation: saveGenerationAt };
    baselineEtag = acceptedSave.etag;
    baselineKept = true;
    // These bytes are on the host now, so nothing an earlier session left is still only here.
    unsavedAtStop = false;
    unsavedChanges = false;
    // Generation-checked: clears the scoped-sync dirty gate only if nothing
    // changed while this save was on the wire.
    gateClearIfUnchanged(gateToken);
    // The server's severity rides through untouched: a save can land AND carry a
    // warning, and the UI module is what decides how to render that.
    setSaveState('saved', result.msg || 'Saved', result.msgType, {
      etag: result.etag ?? null,
      captureId
    });
    logBaseline(label, `${lastSavedContents.length} chars`);
    releaseConflictHold();
  } else if (result.msgType === 'conflict') {
    // A refused heal leaves the tab as it was: still clean, no save event, no
    // hold. The save that beat it reaches this tab through sync.
    if (quietConflict) {
      if (savingTimeout) {
        clearTimeout(savingTimeout);
        savingTimeout = null;
      }
      document.documentElement.setAttribute('savestatus', 'saved');
      return;
    }
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
  // Through the scheduler, not straight back into the automatic lane: this runs
  // inside the completed attempt, and a second full capture in the same task is
  // exactly the work the split into admission-then-capture exists to remove.
  pendingAutosave = false;
  autosaveScheduler.request();
}

// The host's advertised save ceiling, and a measurement of bytes that are not this
// page's document. Neither sends anything; `inspect` also captures nothing and
// claims nothing, because an import preview asks about candidate bytes.
export { saveLimits, inspectSaveSize };

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

const monotonic = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * One save attempt, explicit or automatic.
 *
 * Both kinds take the same single combined capture — the save domain, the
 * autosave comparison domain and the dirty domain all come from one live snapshot
 * — and differ only in the question they ask of it. An explicit attempt asks the
 * dirty question, so an edit inside a batching region is written. An automatic one
 * asks the autosave question under the load-time baseline veto, so neither boot
 * churn nor batching churn saves on its own.
 *
 * @param {{kind: 'explicit' | 'automatic'}} options
 * @param {Function} callback - Optional callback for custom handling
 * @returns {Promise<{msg: string, msgType: string}>}
 */
function attemptSave(options, callback = () => {}) {
  // The first save of a session still learning the host's conditional-save capability
  // waits for that answer, so it carries If-Match when the host honours one.
  if (capabilityPending) return capabilityKnown.then(() => attemptSave(options, callback));
  if (!adoptionsQueued) return attemptSaveNow(options, callback);
  return adoptionQueue.then(() => attemptSaveNow(options, callback));
}

function attemptSaveNow({ kind, permit = null }, callback = () => {}) {
  const explicit = kind === 'explicit';

  return new Promise((resolve) => {
    if (!isEditMode && !window.clay?.testMode) {
      if (explicit) clearExplicitSave();
      const skipped = skipped_('Not in edit mode');
      callback(skipped);
      return resolve(skipped);
    }

    // A session has admission closed: the page is between modes, and neither lane writes
    // until it decides. An automatic attempt is remembered so `resume` replays it.
    if (!savesAdmitted(permit)) {
      if (!explicit) parkedAutosave = true;
      const skipped = sessionClosed('Save session is quiesced');
      callback(skipped);
      return resolve(skipped);
    }

    // A save is already on the wire. Remember that a newer state is waiting rather
    // than dropping it: the in-flight request carries the older bytes, and if no
    // further mutation happens to retrigger autosave, the newer ones would never
    // reach disk at all.
    // Not cleared here: pendingSave means this request is deferred, not
    // abandoned, and drainPendingSave is what eventually sends it.
    if (explicit) {
      if (heldForPreview(callback, resolve)) return;
      if (isSaveInProgress()) {
        pendingSave = true;
        const skipped = skipped_('Save already in progress');
        callback(skipped);
        return resolve(skipped);
      }
    } else {
      if (previewHold > 0) {
        previewAutosaveMissed = true;
        const skipped = skipped_(saveHoldReason());
        callback(skipped);
        return resolve(skipped);
      }
      if (isSaveInProgress() && !baselineActive && ownSaveOnWire) {
        pendingAutosave = true;
        const skipped = skipped_('Save already in progress');
        callback(skipped);
        return resolve(skipped);
      }
      // The dirty gate counts every change no save has accounted for, and it is
      // the cheap half of the old dirtyMatchesLastSave check. When it says clean
      // there is nothing to compare, so answer like the old comparison did and
      // take no capture at all: no snapshot hooks, no sync serialization, no
      // clay:snapshot-ready. While the page is still settling the capture itself
      // is the veto, so the gate cannot stand in for it yet.
      if (!baselineActive && !pageMaybeDirty()) {
        const skipped = skipped_('No changes to save');
        callback(skipped);
        return resolve(skipped);
      }
    }

    // The source map asks a save to wait here: after the gates, before the capture.
    const prepare = window.clay?.source?.ensureForSave?.();
    if (prepare) return prepare.then(() => resolve(attemptSaveNow({ kind, permit }, callback)));

    // From here this call answers: it either writes, or reports why it did not,
    // and the soon() callers waiting on the save queued behind the one that was
    // on the wire when they asked get that answer.
    const soonQueued = explicit ? takeSoonQueued() : [];
    const settleSoonQueued = (result) => soonQueued.forEach((done) => done(result));

    // Check if offline - set DOM state immediately for UI feedback
    // but still try the fetch (navigator.onLine can be wrong)
    const wasOffline = !navigator.onLine;
    if (wasOffline) {
      setOfflineStateQuiet();
    }

    // Single capture: clone once, get all three versions
    // forSave strips non-persisted regions ([no-save]/[save-remove])
    // forComparison additionally strips every autosave-off region
    const startedAt = monotonic();
    let capture, forSave, forComparison, forDirty, captureId;
    const gateToken = gateCaptureToken();
    try {
      capture = captureForSaveAndComparison({ requestRefresh: true, forRequest: true });
      ({ forSave, forComparison, forDirty, captureId } = capture);
    } catch (err) {
      console.error(`${explicit ? 'savePage' : 'savePageThrottled'}: captureForSaveAndComparison failed`, err);
      if (explicit) {
        clearExplicitSave();
        setSaveState('error', err.message, '', { sent: false, code: err.code ?? null });
      } else {
        setSaveState('error', err.message);
      }
      const result = { msg: err.message, msgType: 'error', code: explicit ? (err.code ?? null) : null, etag: null };
      if (typeof callback === 'function') {
        callback(result);
      }
      resolve(result);
      settleSoonQueued(result);
      return;
    }
    const preparedMs = monotonic() - startedAt;

    // The recovery hook sees the accepted capture's exact bytes, before anything is
    // sent, so a copy can be proved to be in them rather than merely to be nearby.
    noteRecoveryCapture({ captureId, html: forSave });

    if (explicit) {
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
        releaseCaptureArtifact(capture);
        const skipped = skipped_('No changes to save');
        settleRecoveryCapture(captureId, skipped);
        callback(skipped);
        resolve(skipped);
        settleSoonQueued(skipped);
        return;
      }
    } else {
      // For autosave: while the page is still settling, content must differ from
      // BOTH the load-time baseline and the last save, so module setup churn cannot
      // trigger a save. Once settled, the baseline veto is disarmed and only the
      // last save matters — otherwise undoing back to the page's original state
      // can never be persisted, because it matches the baseline forever.
      const differsFromBaseline = !baselineActive || forComparison !== baselineContents;
      const differsFromLastSave = forComparison !== lastSavedContents;

      logSaveCheck('throttled vs baseline', !differsFromBaseline);
      logSaveCheck('throttled vs lastSave', !differsFromLastSave);

      if (!(differsFromBaseline && differsFromLastSave)) {
        // This capture's comparison leaves out batching (no-trigger-autosave)
        // regions, which the gate counts, so on a page that has one the dirty
        // domain must match too before the gate is cleared.
        let clear = false;
        try {
          clear = !differsFromLastSave && (!document.querySelector(NO_TRIGGER_AUTOSAVE_SELECTOR)
            || (pageMaybeDirty() && forDirty === lastSavedDirty));
        } catch (err) {
          console.error('savePageThrottled: dirty domain check failed', err);
        }
        if (clear) gateClearIfUnchanged(gateToken);
        autosaveScheduler.noteCost(preparedMs);
        releaseCaptureArtifact(capture);
        const skipped = skipped_('No changes to save');
        settleRecoveryCapture(captureId, skipped);
        callback(skipped);
        resolve(skipped);
        return;
      }

      unsavedChanges = true;

      // A save that is not this lane's own (a raw saveHtml) may still be on the
      // wire. The capture has already been taken, so answer like the explicit lane
      // and keep these newer bytes queued behind it.
      if (isSaveInProgress()) {
        pendingSave = true;
        releaseCaptureArtifact(capture);
        const skipped = skipped_('Save already in progress');
        settleRecoveryCapture(captureId, skipped);
        callback(skipped);
        resolve(skipped);
        return;
      }
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
      const completedAt = monotonic();
      applySaveResult(result, comparison.forComparison, comparison.forDirty, 'updated after save', gateToken, forSave, captureId);
      if (!explicit) autosaveScheduler.noteCost(preparedMs + (monotonic() - completedAt));
      if (typeof callback === 'function') {
        callback(result);
      }
      resolve(result);
      settleSoonQueued(result);
      drainPendingSave();
    }, { capture });
  });
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
  return attemptSave({ kind: 'explicit' }, callback);
}

// The exit flush's own entry, inside its permit. Not exported: the only caller is the
// barrier below, which is the one save a closed session must still be able to send.
function savePagePermitted(permit, callback = () => {}) {
  return attemptSave({ kind: 'explicit', permit }, callback);
}

/**
 * Force-save the current page (skips dirty check).
 *
 * @param {Function} callback - Optional callback for custom handling
 * @returns {Promise<{msg: string, msgType: string}>}
 */
export function savePageForce(callback = () => {}, { quietConflict = false } = {}) {
  if (capabilityPending) return capabilityKnown.then(() => savePageForce(callback, { quietConflict }));
  return new Promise((resolve) => {
    if (!isEditMode && !window.clay?.testMode) {
      const skipped = skipped_('Not in edit mode');
      callback(skipped);
      return resolve(skipped);
    }

    // A forced save is still an ordinary one for admission: only the exit's own flush
    // carries the permit.
    if (!savesAdmitted()) {
      const skipped = sessionClosed('Save session is quiesced');
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

    const prepare = window.clay?.source?.ensureForSave?.();
    if (prepare) return prepare.then(() => resolve(savePageForce(callback, { quietConflict })));

    const wasOffline = !navigator.onLine;
    if (wasOffline) {
      setOfflineStateQuiet();
    }

    let capture, forSave, forComparison, forDirty, captureId;
    const gateToken = gateCaptureToken();
    try {
      capture = captureForSaveAndComparison({ requestRefresh: true, forRequest: true });
      ({ forSave, forComparison, forDirty, captureId } = capture);
    } catch (err) {
      console.error('savePageForce: captureForSaveAndComparison failed', err);
      setSaveState('error', err.message, '', { sent: false, code: err.code ?? null });
      const result = { msg: err.message, msgType: 'error', code: err.code ?? null, etag: null };
      if (typeof callback === 'function') {
        callback(result);
      }
      return resolve(result);
    }

    noteRecoveryCapture({ captureId, html: forSave });

    setSavingState();

    const comparison = { forComparison, forDirty };
    inFlightComparisons.add(comparison);
    ownSaveOnWire = true;
    saveCapturedHtml(forSave, captureId, (result) => {
      ownSaveOnWire = false;
      inFlightComparisons.delete(comparison);
      applySaveResult(result, comparison.forComparison, comparison.forDirty, 'updated after force save', gateToken, forSave, captureId, quietConflict);
      if (typeof callback === 'function') {
        callback(result);
      }
      resolve(result);
      drainPendingSave();
    }, { capture });
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
export async function flushSave({ keepalive = false, timeoutMs = 15000, permit = null } = {}) {
  if (!isEditMode) return { state: 'view', etag: null };
  const deadline = Date.now() + timeoutMs;
  // A caller with no permit of its own is the plain `clay.save.flush`: it mints one for
  // the generation that owns the page now, so a flush during a transition is still a
  // write in this generation and never the next one's.
  const held = permit || openSavePermit();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(flushError('Save timed out.', 'failed')), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([flushBytes(keepalive, deadline, held), timeout]);
  } catch (err) {
    if (err && typeof err.state === 'string') throw err;
    throw flushError(err?.message || 'Save failed', 'failed');
  } finally {
    clearTimeout(timer);
    if (!permit) closeSavePermit(held);
  }
}

async function flushBytes(keepalive, deadline, permit) {
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
    const result = await withKeepalive(keepalive, () => savePagePermitted(permit));
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

// The automatic lane's own throttle. It is the floor under the scheduler: a call
// that arrives inside the window rides the trailing attempt instead of capturing.
const throttledAutomatic = throttle(callback => attemptSave({ kind: 'automatic' }, callback), 1200);

const SOON_MS = 250;
const SOON_MAX_MS = 1000;
let soonTimer = null;
let soonStarted = 0;
let soonWaiters = [];
// Callers whose timer fired while a save was on the wire. Their call queued one
// behind it, and they wait for THAT save's result: the skipped answer to their
// own call describes nothing they asked for.
let soonQueuedWaiters = [];
// The timer fired while autosave was suspended. The callers keep waiting and
// resumeAutosave arms the timer again.
let soonDeferred = false;

const takeSoonQueued = () => {
  const waiters = soonQueuedWaiters;
  soonQueuedWaiters = [];
  return waiters;
};

function fireSoon() {
  soonTimer = null;
  if (autosaveSuspended > 0 || !savesAdmitted()) {
    soonDeferred = true;
    return;
  }
  const waiters = soonWaiters;
  soonWaiters = [];
  if (isSaveInProgress()) {
    soonQueuedWaiters.push(...waiters);
    savePage();
    return;
  }
  savePage().then((result) => waiters.forEach((done) => done(result)));
}

export function savePageSoon() {
  const now = Date.now();
  if (soonTimer === null) soonStarted = now;
  else clearTimeout(soonTimer);
  return new Promise((resolve) => {
    soonWaiters.push(resolve);
    soonTimer = setTimeout(fireSoon, Math.max(0, Math.min(SOON_MS, soonStarted + SOON_MAX_MS - now)));
  });
}

// The automatic attempt a closed session parked. Replayed when admission comes back, so
// an edit typed while the page was between modes still reaches disk.
function replayParkedAutosave() {
  if (!parkedAutosave) return;
  parkedAutosave = false;
  savePageThrottled();
}

// A soon() timer that fired while admission was closed: the callers are still waiting on
// a save that has not been attempted, so arm it again in the same way resumeAutosave does.
function releaseDeferredSoon() {
  if (!soonDeferred) return;
  soonDeferred = false;
  soonTimer = setTimeout(fireSoon, 0);
}

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
// True once a person edited the page during the boot settle. The settled capture is
// skipped then, so the edit is never absorbed into the saved baseline.
let bootUserEdited = false;

// A repaint that leaves the page's painted values different from the file's means
// the file is stale: an agent wrote a record without painting it. One clean,
// autosaving tab saves the painted page so the bytes on disk heal. The delay is
// jittered and the check reruns when it fires, so when several tabs repaint the
// same frame, the first save reaches the others and they skip.
const PAINT_HEAL_MIN_MS = 250;
const PAINT_HEAL_SPREAD_MS = 1250;
let paintHealTimer = null;

const HEAL_KEY = 'clay:paint-heal:' + location.pathname;

function hashSignature(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function healedFrom(signature) {
  try { return localStorage.getItem(HEAL_KEY) === hashSignature(signature); } catch { return false; }
}

function noteHealedFrom(signature) {
  try { localStorage.setItem(HEAL_KEY, hashSignature(signature)); } catch {}
}

/** The painted values of the page as it would be saved. */
export function currentPaintSignature() {
  return paintSignature(captureSaveClone({ flushUndo: false }));
}

/**
 * Save the page if its painted values differ from the file's. `fileSignature` is
 * the file's paintSignature, or a function returning it (or null when unknown)
 * when the timer fires.
 */
export function schedulePaintHeal(fileSignature) {
  if (!isEditMode || isDraftMode) return;
  clearTimeout(paintHealTimer);
  paintHealTimer = setTimeout(async () => {
    paintHealTimer = null;
    if (adoptionsQueued) await adoptionQueue;
    const onDisk = typeof fileSignature === 'function' ? fileSignature() : fileSignature;
    if (onDisk == null || !autosaveActive() || !baselineSettled() || isSaveConflicted() || autosaveIsSuspended()) return;
    if (captureForDirtyCheck({ flushUndo: false }) !== lastSavedDirty) return;
    if (onDisk === currentPaintSignature()) return;
    if (healedFrom(onDisk)) return;
    noteHealedFrom(onDisk);
    savePageForce(() => {}, { quietConflict: true });
  }, PAINT_HEAL_MIN_MS + Math.random() * PAINT_HEAL_SPREAD_MS);
}

// parse5 is 38.5 KB Brotli, and an owned style is the only reason this module names
// it, so the stripper loads the first time a script writes one. `clay.style()` stays
// synchronous: it queues the identity here and the strip runs when the module lands.
// Every reader that compares bytes awaits the queue first; see
// `styleAdoptionPending` for the one synchronous reader that cannot.
let adoptionStripper = null;
let adoptionLoad = null;
let adoptionsQueued = 0;
let adoptionQueue = Promise.resolve();
// A person edited since the oldest adoption now queued. The style write is not one,
// so the pending window cannot speak for the page's bytes once this is true.
let editedSinceAdoption = false;
// The identities whose strip has not landed yet, oldest first, with the exact
// attribute bytes their saved tag carries.
const pendingStyles = [];

function loadAdoptionStripper() {
  adoptionLoad ??= import("./style-comparisons.js").catch(error => {
    adoptionLoad = null;
    console.error('style-comparisons failed to load', error);
    return null;
  });
  return adoptionLoad;
}

async function stripAdoptedStyle(identity) {
  try {
    if (!adoptionStripper) adoptionStripper = (await loadAdoptionStripper())?.styleComparisonStripper ?? null;
    if (!adoptionStripper) return;
    const strip = adoptionStripper(identity);
    lastSavedContents = strip(lastSavedContents);
    lastSavedDirty = strip(lastSavedDirty);
    baselineContents = strip(baselineContents);
    for (const comparison of inFlightComparisons) {
      comparison.forComparison = strip(comparison.forComparison);
      comparison.forDirty = strip(comparison.forDirty);
    }
  } catch (error) {
    console.error('style adoption failed', error);
  } finally {
    adoptionsQueued--;
    pendingStyles.shift();
  }
}

// The bytes a saved owned tag of this identity carries in the stored baselines. The
// capture writes attribute values with `&` and `"` escaped and every other character
// as itself, so the marker is the exact form the serializer wrote.
const attrValue = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function styleIdentityMarkers(identity) {
  if (identity.name !== undefined) {
    const markers = [`data-name="${attrValue(identity.name)}"`];
    if (identity.legacyId !== undefined) markers.push(`id="${attrValue(identity.legacyId)}"`);
    return markers;
  }
  // The identity is a base URL, while the file may hold the href relative to the
  // page, so the path alone counts too.
  const markers = [attrValue(identity.href)];
  try {
    const { pathname } = new URL(identity.href);
    if (pathname) markers.push(attrValue(pathname));
  } catch {}
  return markers;
}

/** Whether a stored baseline, or a save already in flight, carries the owned tag. */
function baselineCarriesStyle(markers) {
  const stored = [lastSavedContents, lastSavedDirty, baselineContents];
  for (const comparison of inFlightComparisons) stored.push(comparison.forComparison, comparison.forDirty);
  return stored.some(html => html && markers.some(marker => marker && html.includes(marker)));
}

// A stored page with the pending owned tags taken out, found by the exact attribute
// bytes the capture writes and expanded to the element around them. The real strip is
// parse5's; this only answers "is anything ELSE different", so a span it misses or
// over-reaches leaves the page reading dirty, never clean.
function withoutOwnedStyles(html, pending) {
  const spans = [];
  for (const { markers, tag } of pending) {
    for (const marker of markers) {
      for (let at = html.indexOf(marker); at >= 0; at = html.indexOf(marker, at + marker.length)) {
        const start = html.lastIndexOf('<', at);
        if (start < 0 || html.slice(start + 1, start + 1 + tag.length).toLowerCase() !== tag) continue;
        const close = tag === 'style' ? html.indexOf('</style', at) : at;
        if (close < 0) continue;
        const end = html.indexOf('>', close);
        if (end >= 0) spans.push([start, end + 1]);
      }
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let offset = 0;
  for (const [from, to] of spans) {
    if (from < offset) continue;
    out += html.slice(offset, from);
    offset = to;
  }
  return out + html.slice(offset);
}

registerStyleAdoption(identity => {
  const markers = styleIdentityMarkers(identity);
  // Nothing to strip means nothing to load: a Document whose file has no such tag
  // never asks for parse5. A false hit only costs the parse, which decides precisely.
  if (!baselineCarriesStyle(markers)) return;
  if (!adoptionsQueued) editedSinceAdoption = false;
  adoptionsQueued++;
  pendingStyles.push({ markers, tag: identity.name !== undefined ? 'style' : 'link' });
  adoptionQueue = adoptionQueue.then(() => stripAdoptedStyle(identity));
});

/** Resolves once every style written so far has been stripped from the baselines. */
export function styleAdoptionsSettled() {
  return adoptionQueue;
}

/**
 * The window a style adoption opens. A fresh capture leaves an owned style out
 * (writing one marks it no-dirty), while the stored baselines still carry it until
 * the stripper lands, so a synchronous reader in that window reads the page as
 * dirty. That is only the adoption's own doing while nothing else differs: an edit
 * since the adoption was queued, work an owner registered, a save on the wire, or
 * any other byte `current` (the caller's own capture) carries turn this off. A clean
 * adoption is clean before and after the baseline settles, so no settle condition
 * belongs here.
 */
export function styleAdoptionPending(current) {
  if (!adoptionsQueued) return false;
  if (editedSinceAdoption || hasUnsavedState()) return false;
  // Parked work is work too: a save a closed session refused leaves the baselines
  // untouched, so without this the adoption window would speak for the page's bytes
  // while they are still waiting to be written.
  if (isSaveInProgress() || pendingSave || pendingAutosave || parkedWork) return false;
  if (typeof current !== 'string') return false;
  return current === withoutOwnedStyles(lastSavedDirty, pendingStyles);
}

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
const MAX_HOLD_MS = 10000;   // A held settle releases itself after this

let settleNow = null;

/**
 * The loader's mount phase calls this once the derive engine has taken its first
 * pass. The settle runs at once on the painted page, unless a person already
 * edited or a save already installed a baseline (captureBaseline's guard).
 */
export function releaseBootSettle() {
  bootPhase.holdSettle = false;
  if (settleNow) settleNow();
}

function initBaselineCapture() {
  if (!isEditMode) return;

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

  // Track user edits to avoid overwriting real changes. Every real edit counts,
  // whatever the target and however the page takes it: the editor handles keys and
  // clicks itself, a checklist box cancels mousedown, a picker or a menu item is a
  // click, a drop is neither key nor click. A style write is not an edit (it is
  // marked no-dirty), so a clean adoption stays clean. These stay attached after the
  // settle: an adoption queued later opens the same window again.
  const userEditEvents = ['keydown', 'pointerdown', 'drop', 'input', 'change', 'paste'];
  const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta']);
  const markUserEdited = (e) => {
    if (e.type === 'keydown' && modifierKeys.has(e.key)) return;
    editedSinceAdoption = true;
    if (!settled) bootUserEdited = true;
  };
  userEditEvents.forEach(evt => document.addEventListener(evt, markUserEdited, true));

  // Called when mutations settle OR max timeout reached
  const captureBaseline = () => {
    if (settled) return;
    settled = true;

    // Cleanup listeners
    if (unsubscribeMutation) unsubscribeMutation();

    // Adoption only removes owned styles from comparison state. It does not
    // advance this revision. A save or sync installation does, even when its
    // comparison bytes match, so settle cannot absorb a later unsent edit.
    if (!bootUserEdited && baselineRevision === immediateRevision) {
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
      logBaseline('settled skipped', bootUserEdited ? 'user edited' : 'save occurred during settle');
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
  settleNow = captureBaseline;

  // While the loader holds the settle for a derive engine's first pass, neither
  // the quiet timer nor the max timeout may settle; releaseBootSettle does.
  const settle = () => {
    if (!bootPhase.holdSettle) captureBaseline();
  };

  // Start settle observer - fires when no mutations for SETTLE_MS.
  // require:'autosave' so churn in no-save / save-* / no-watch regions doesn't
  // keep resetting the settle timer or count toward the baseline.
  unsubscribeMutation = Mutation.onAnyChange(
    { debounce: SETTLE_MS, omitChangeDetails: true, require: 'autosave' },
    settle
  );

  // Max timeout fallback
  setTimeout(() => {
    if (!settled) settle();
  }, MAX_SETTLE_MS);

  // The loader releases a held settle after the derive engine mounts. If boot
  // never gets there (a plugin's ready stalls, boot throws), release it anyway.
  setTimeout(() => {
    if (!settled && bootPhase.holdSettle) releaseBootSettle();
  }, MAX_HOLD_MS);
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

  // The page is between modes: no automatic attempt is admitted, and the activity that
  // asked for one is remembered so `resume` replays it instead of losing the edit.
  if (!savesAdmitted()) {
    parkedAutosave = true;
    const skipped = sessionClosed('Save session is quiesced');
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

  // The capture happens inside the attempt, after the throttle admits it: the
  // page is not copied to answer "is there anything to save?" any more, and an
  // admitted attempt takes one snapshot for both the decision and the bytes.
  // The throttled promise can reject now that a throwing save no longer strands
  // its callers (see throttle.js), and both autosave call sites are fire-and-forget,
  // with no reach into this module's error path. Catch it here, the one place that
  // owns that path, so every caller keeps the never-rejects contract savePage
  // documents and a throw surfaces as a failed save instead of an unhandled rejection.
  return throttledAutomatic(callback).catch(err => {
    const result = { ok: false, msg: err?.message || 'Save failed', msgType: 'error', code: null, etag: null };
    setSaveState('error', result.msg);
    return result;
  });
}

// The one automatic-save scheduler. Every automatic trigger (a mutation, a
// [persist] input, a merge that owes a save) only reports activity or intent to
// it, and it admits the attempt through this module's automatic lane.
export const autosaveScheduler = createAutosaveScheduler({
  now: monotonic,
  run: () => savePageThrottled()
});

/**
 * Initialize keyboard shortcut for save (CMD/CTRL+S)
 */
export function initSaveKeyboardShortcut() {
  document.addEventListener("keydown", function(event) {
    let isMac = window.navigator.platform.match("Mac");
    let metaKeyPressed = isMac ? event.metaKey : event.ctrlKey;
    if (metaKeyPressed && event.keyCode == 83) {
      // The listener outlives its session, so the mode is read now: after an exit the
      // page is the reader's and the browser's own Save has to work.
      if (!isEditMode) return;
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

  // The same discovery document states the host's save ceiling. Asked here for the
  // same reason and the same way: joined to the memoized answer, never awaited, so
  // the limit is known long before the first save and no save ever waits on it.
  saveLimit();

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
