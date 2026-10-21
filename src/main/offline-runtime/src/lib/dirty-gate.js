/**
 * dirty-gate.js — "might this page hold unsaved edits?" as a cheap counter.
 *
 * Scoped live sync must decide, on every incoming frame, whether to pay for a
 * full capture-and-diff (the oracle) or apply the frame directly. This gate is
 * the cheap side of that decision. It may over-report (a false "dirty" just
 * runs the oracle, which then finds nothing), but it must never under-report:
 * a false "clean" full-morphs over a real unsaved edit.
 *
 * Two feeds, because neither alone sees everything:
 *   - the mutation hub (require: 'dirty'), which sees DOM changes but not
 *     value-property writes on form controls (typing fires no MutationRecord
 *     for .value), and
 *   - capture-phase input/change listeners on ALL form controls, not just
 *     [persist] ones, plus contenteditable hosts.
 *
 * The one hole left is a PROGRAMMATIC value write on a [persist] control: no
 * event, no MutationRecord. persistProbeDirty() closes it by comparing each
 * [persist] control's live state against its serialized default state, with a
 * per-element cache so a value the oracle or a save has already verified stops
 * costing a probe miss on every frame.
 *
 * Clearing is generation-checked: a save records the counter at capture time
 * and clears only if nothing changed while the request was on the wire, so
 * keystrokes during an in-flight save keep the gate dirty.
 */

import Mutation from './mutation.js';
import { isEditMode } from '../core/is-edit-mode.js';
import { STRIP_FROM_DIRTY_CHECK, SNAPSHOT_REMOVE_SELECTOR } from './region-policy.js';
import { PERSIST } from './attr-aliases.js';

let changes = 0;
let clearedAt = 0;
let paused = false;
let started = false;

// The state change, announced on the document: `clay:dirty` when work nothing has
// written appears, `clay:clean` when a save (or the oracle) has accounted for it. A
// burst of edits is ONE announcement, since what a listener wants is the state, not
// the edit. Only a transition is dispatched.
let announcedDirty = false;
let queued = false;

function scheduleAnnounce() {
  if (!isEditMode || queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (typeof document === 'undefined') return;
    const dirty = pageMaybeDirty();
    if (dirty === announcedDirty) return;
    announcedDirty = dirty;
    document.dispatchEvent(new CustomEvent(dirty ? 'clay:dirty' : 'clay:clean'));
  });
}

const PERSIST_CONTROLS = `input${PERSIST}, textarea${PERSIST}, select${PERSIST}`;

// Regions the loss oracle never sees. The hub feed already skips them, through
// `require: 'dirty'`, and the input feed has to skip them for the same reason:
// their content is stripped from the merge's compare clone, so an edit inside
// one can never produce a dirty root, and counting it marks the page dirty with
// nothing for the oracle to find — permanently, since only a save clears the
// counter and churn in these regions triggers none.
//
// The gate and the oracle must key off the SAME domain. This is the dirty
// domain, so no-trigger-autosave is deliberately absent: the oracle can now
// report an unsaved batching edit, so the gate has to arm for one. Disposable
// churn leaves via no-dirty, which is in both.
//
// This is not a relaxation of "never under-report". A control here is absent
// from the clone by definition, so there is nothing about it to under-report.
// It matters because a mounted tool (redpen's answer field, any panel that
// marks itself no-save) is a real <textarea> in the document: one keystroke in
// it used to freeze the live-sync save baseline for the rest of the session,
// after which every incoming disk change was diffed against a stale base, and
// the previous change was spliced back over the newer one and written to disk.
const GATE_IGNORE = `${STRIP_FROM_DIRTY_CHECK}, ${SNAPSHOT_REMOVE_SELECTOR}`;
const probeCache = new WeakMap();

// The [persist] probe has to honour GATE_IGNORE too. It scans by attribute, not
// through the mutation hub, so without this a programmatic .value write inside a
// no-dirty region pins the gate dirty forever even though every DOM mutation
// there is ignored — the one hole that would survive the domain switch.
function gatedPersistControls() {
  const out = [];
  for (const el of document.querySelectorAll(PERSIST_CONTROLS)) {
    if (el.closest(GATE_IGNORE)) continue;
    out.push(el);
  }
  return out;
}

function onUserInput(event) {
  // Deliberately NOT gated on `paused`: a morph never dispatches input or
  // change events, so anything arriving here is the user — including typing
  // during a morph's async resource wait, which must keep the page dirty.
  const el = event.target;
  if (!el || el.nodeType !== 1) return;
  if (!(el.matches('input, textarea, select') || el.isContentEditable)) return;
  if (el.closest(GATE_IGNORE)) return;
  changes++;
  scheduleAnnounce();
}

export function startDirtyGate() {
  if (started) return;
  started = true;
  Mutation.onAnyChange(
    { omitChangeDetails: true, require: 'dirty' },
    () => {
      if (!paused) {
        changes++;
        scheduleAnnounce();
      }
    }
  );
  document.addEventListener('input', onUserInput, true);
  document.addEventListener('change', onUserInput, true);
}

/** The morph-apply window: nothing that happens inside it is a user edit. */
export function pauseGate() { paused = true; }
export function resumeGate() { paused = false; }

function controlSignature(el) {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.selectedOptions, (o) => o.value).join('\u0000');
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked ? '1' : '0';
  }
  return el.value;
}

// True when the control's live state matches its serialized (attribute-level)
// state — i.e. a snapshot taken right now would carry nothing new for it.
// persist's own listeners keep attributes current for USER input; only
// programmatic writes diverge here.
function serializedStateMatches(el) {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options).every((o) => o.selected === o.defaultSelected);
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked === el.defaultChecked;
    }
    return el.value === el.defaultValue;
  }
  if (el instanceof HTMLTextAreaElement) {
    if (el.hasAttribute('data-value')) {
      return el.value === el.getAttribute('data-value');
    }
    return el.value === el.defaultValue;
  }
  return true;
}

export function persistProbeDirty() {
  for (const el of gatedPersistControls()) {
    const sig = controlSignature(el);
    if (probeCache.get(el) === sig) continue;
    if (serializedStateMatches(el)) {
      probeCache.set(el, sig);
      continue;
    }
    return true;
  }
  return false;
}

/** Call after the oracle verified the whole page clean against its baseline. */
export function probeMarkClean() {
  for (const el of gatedPersistControls()) {
    probeCache.set(el, controlSignature(el));
  }
  scheduleAnnounce();
}

export function pageMaybeDirty() {
  return changes > clearedAt || persistProbeDirty();
}

/**
 * Record the gate state at capture time. The save flow takes a token when it
 * clones the DOM and hands it back on success (or on a verified "no changes"),
 * so a clear can never swallow edits made while the save was in flight.
 */
export function gateCaptureToken() {
  const probe = [];
  for (const el of gatedPersistControls()) {
    probe.push([el, controlSignature(el)]);
  }
  return { gen: changes, probe };
}

/** A change nothing in the DOM recorded: the page holds text a save has not written. */
export function gateMarkDirty() {
  changes++;
  scheduleAnnounce();
}

export function gateClearIfUnchanged(token) {
  if (!token) return;
  if (changes === token.gen) {
    clearedAt = token.gen;
  }
  // Probe entries clear per element, and only if the element still holds the
  // exact value the capture carried — a programmatic write between capture
  // and completion stays dirty.
  for (const [el, sig] of token.probe) {
    if (controlSignature(el) === sig) probeCache.set(el, sig);
  }
  scheduleAnnounce();
}

if (typeof document !== 'undefined' && isEditMode) {
  startDirtyGate();
}

// Public for editors whose own surface is editor-ui (so neither gate feed sees it):
// a person's edit made while a live-sync frame waits on a resource would otherwise be
// recorded as saved. Set here, not in the loader, because the sync plugin is what
// loads this module.
if (typeof window !== 'undefined') {
  window.clay = window.clay || {};
  window.clay.markDirty = gateMarkDirty;
}
