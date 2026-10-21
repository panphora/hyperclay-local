/**
 * user-gesture — the "was a human driving this write?" signal for the
 * data-clobber guard. Small and dedicated (NOT behaviorCollector, which is the
 * analytics collector).
 *
 * How it works: capture-phase listeners for trusted user-intent events stamp
 * `lastTrustedGestureTs` (and set a same-turn `gestureTaskActive` flag, cleared
 * on the next macrotask). The Mutation hub calls `isUserDrivenNow()`
 * synchronously when it processes a DOM change. A change reads as user-driven if
 * it lands in the same turn as a gesture OR within `RECENT_GESTURE_MS` of the
 * last trusted gesture. The recency window is what attributes CROSS-TURN
 * first-party edits: a button's `click` handler runs a turn after its
 * `pointerdown`, and a confirm-modal delete runs a macrotask after the Confirm
 * gesture (theModal defers its resolve via setTimeout) — both mutate a few ms
 * after the gesture, inside the window. A background setTimeout / fetch().then()
 * mutation with no recent gesture reads background. Synthetic dispatchEvent /
 * el.click() are isTrusted=false, so a script can't fake a gesture.
 *
 * Why a bounded recency window and not `navigator.userActivation`: its transient
 * window is ~5s and consumable — too loose for a recovery tool, since a
 * background clobber within 5s of any click would read user-driven and suppress
 * the chip (silent data loss). `RECENT_GESTURE_MS` is an owned, tight window
 * stamped only by trusted gestures, so it's unspoofable and an order of
 * magnitude less exposed.
 *
 * The accumulated bit rides every save the page makes; the server splits a
 * UI-gestured save from a background-script save with it.
 */

// `change` and `submit` are included intentionally. Both are reachable with
// isTrusted=true from script (checkbox.click(), form.requestSubmit(), a
// submit-button .click()), so a nefarious script could fake a gesture and suppress
// the chip. That is out of scope by design: this panel catches ACCIDENTAL
// deletion, not malicious intent, and we assume scripts are helpful. Listening for
// them attributes legitimate script- or control-driven form edits as driven, which
// avoids false-positive chips. (A synthetic dispatchEvent stays isTrusted=false.)
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'click', 'keydown', 'beforeinput', 'change', 'submit', 'paste', 'drop', 'cut'];

// A cross-turn first-party edit (click handler, confirm-modal delete) mutates
// within a few ms of its trusted gesture; 500ms is ample margin while keeping
// the false-negative window (a background clobber near a gesture) an order of
// magnitude tighter than navigator.userActivation's ~5s.
const RECENT_GESTURE_MS = 500;

let gestureTaskActive = false;
let lastTrustedGestureTs = -Infinity;
// Set by the first trusted gesture and never cleared. Live sync reads it at the
// load-time settle: a page nobody has touched yet holds no one's edit.
let anyGesture = false;
let userDrivenSinceLastSave = false;
let explicitSaveIntent = false;
let installed = false;

// Monotonic clock for the recency window — never moves backward, so a system
// clock change can't widen or break the window (Date.now() can jump).
function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function markGestureTurn() {
  anyGesture = true;
  gestureTaskActive = true;
  lastTrustedGestureTs = now();
  // Clear the same-turn flag on the next macrotask. The MutationObserver
  // microtask for a change made synchronously in this turn drains BEFORE this
  // fires; cross-turn changes fall back to the recency window above.
  setTimeout(() => { gestureTaskActive = false; }, 0);
}

function onGesture(e) {
  if (!e || !e.isTrusted) return;
  markGestureTurn();
}

/**
 * Install the capture-phase gesture listeners (idempotent). Call once in edit
 * mode. save.js does this for every editable page: gesture provenance is not an
 * autosave feature, and gating it on <html autosave> left every manual-save page
 * reporting its human edits as background writes.
 */
export function initUserGesture() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  for (const type of GESTURE_EVENTS) {
    document.addEventListener(type, onGesture, true);
  }
}

/**
 * True iff a trusted gesture drove this exact turn, OR one happened within
 * RECENT_GESTURE_MS. The Mutation hub calls this synchronously per change batch.
 */
export function isUserDrivenNow() {
  if (gestureTaskActive) return true;
  return (now() - lastTrustedGestureTs) < RECENT_GESTURE_MS;
}

/**
 * Record that an autosave-relevant change happened in a user-driven turn. Called
 * by the Mutation hub (per autosave-filtered batch) and by the [persist] input
 * path (a trusted input is itself the gesture+change).
 */
export function markUserDriven() {
  userDrivenSinceLastSave = true;
}

/** True once any trusted gesture has reached the page. */
export function gestureSeen() {
  return anyGesture;
}

/**
 * Read-and-reset the accumulated bit. Called at the ACTUAL save send (not on a
 * save that never ships), so it survives the autosave debounce and coalescing.
 * @returns {boolean}
 */
export function consumeUserDriven() {
  const v = userDrivenSinceLastSave;
  userDrivenSinceLastSave = false;
  return v;
}

/**
 * Record that a person asked for THIS save (Cmd+S, a [trigger-save] button).
 *
 * Deliberately NOT markUserDriven(). That bit accumulates until a save actually
 * ships, which is right for "an edit happened in a human turn" but wrong here: a
 * person pressing Save on a clean page produces no save at all, so the bit stays
 * armed and rides whatever BACKGROUND write happens next, reporting it as human.
 * That is precisely the write the recovery guard exists to catch.
 *
 * This one is scoped to a single save attempt. The send consumes it; an attempt
 * that ends without sending clears it.
 */
export function markExplicitSave() {
  explicitSaveIntent = true;
}

/** Read-and-reset, at the actual send. */
export function consumeExplicitSave() {
  const v = explicitSaveIntent;
  explicitSaveIntent = false;
  return v;
}

/** The save attempt ended without sending anything. */
export function clearExplicitSave() {
  explicitSaveIntent = false;
}

/** Test seam: force-reset state. */
export function _resetUserGesture() {
  gestureTaskActive = false;
  lastTrustedGestureTs = -Infinity;
  userDrivenSinceLastSave = false;
  anyGesture = false;
  explicitSaveIntent = false;
}

/**
 * Test seam: open a gesture turn as a trusted event would, without a real
 * trusted event (jsdom can't forge isTrusted). Same semantics as onGesture: the
 * turn is active synchronously and cleared on the next macrotask, and the
 * recency timestamp is stamped.
 */
export function _simulateGestureTurn() {
  markGestureTurn();
}
