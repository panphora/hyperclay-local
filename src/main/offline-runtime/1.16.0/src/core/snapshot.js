/**
 * snapshot.js — The source of truth for page state
 *
 * THE SAVE/SYNC PIPELINE:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  1. CLONE         document.documentElement.cloneNode()  │
 *   └─────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  2. SNAPSHOT HOOKS       onSnapshot callbacks           │
 *   │                          (form value sync)              │
 *   │                                                         │
 *   │     ✓ Used by: SAVE and LIVE-SYNC                       │
 *   └─────────────────────────────────────────────────────────┘
 *                              │
 *              ┌───────────────┴───────────────┐
 *              ▼                               ▼
 *   ┌─────────────────────────┐     ┌─────────────────────────┐
 *   │  3a. PREPARE HOOKS      │     │  3b. DONE               │
 *   │  addDocumentTransform   │     │  (live-sync stops here) │
 *   │  [onbeforesave]         │     │                         │
 *   │  [save-remove]          │     │  → emits snapshot-ready │
 *   │                         │     └─────────────────────────┘
 *   │  ✓ Used by: SAVE only   │
 *   └─────────────────────────┘
 *              │
 *              ▼
 *   ┌─────────────────────────┐
 *   │  4. SERIALIZE           │
 *   │  "<!DOCTYPE html>"      │
 *   │  + outerHTML, unless a  │
 *   │  save renderer is set   │
 *   │  (setSaveRenderer)      │
 *   │                         │
 *   │  → sent to server       │
 *   └─────────────────────────┘
 */

import { stripExtensionNoise } from '../lib/extension-noise.js';
import { restoreAuthoredUrls } from '../lib/authored-url.js';
import { STRIP_FROM_SAVE, STRIP_FROM_COMPARISON, STRIP_FROM_DIRTY_CHECK, NO_TRIGGER_AUTOSAVE_SELECTOR, SNAPSHOT_REMOVE_SELECTOR } from '../lib/region-policy.js';
import { TAB_LOCAL_ROOT_ATTRS, stripRouteAttrs } from '../lib/root-attrs.js';
import { stripEphemeral } from '../lib/ephemeral.js';
import { stripDerived } from '../lib/derived.js';
import { createContentView } from '../lib/content-dom.js';

// =============================================================================
// HOOK REGISTRIES
// =============================================================================

const snapshotHooks = [];       // Phase 2: Always run (form sync)
const documentTransforms = [];  // Phase 3a: Save and change check (strip admin)
const snapshotProvenance = new WeakMap();

// Phase 4, and there is only ever one. Everything else in this file is a list
// because many things want a turn; serializing the document is one decision, so a
// second renderer would be two answers to "what bytes does this save send".
let saveRenderer = null;

// The capture identity for save captures. A refused save that may retry reads it
// before sending and again before each retry: a capture newer than the one those
// bytes describe means the attempt is already superseded and must not be re-sent.
// It is an opaque local count, monotone per loaded module, and never goes on the
// wire; it is what binds one capture to the exact requests that carried its body.
let captureCounter = 0;

export function currentCaptureId() {
  return captureCounter;
}

export function originalSnapshotNode(cloneNode) {
  return snapshotProvenance.get(cloneNode) || null;
}

// The private artifact a save renderer may hand back for one capture: the model of
// the exact bytes it returned, paired with the tree it was given, so an accepted save
// can adopt it instead of parsing and pairing the accepted bytes again. It is keyed by
// the capture result object the caller gets, so it lives exactly as long as the save
// that produced it and there is no registry to grow.
const captureArtifacts = new WeakMap();
// The capture being serialized right now. Only a save capture has one; an inspection
// capture and a direct `captureForSave` have no request behind them to adopt anything.
let activeCapture = null;

/**
 * The capture the save renderer is producing bytes for, or null.
 *
 * Read by the renderer to find out whose bytes these are, and to attach the artifact
 * with attachCaptureArtifact. Per call, not global state: it is set for exactly the
 * synchronous serialization of one save clone.
 */
export function currentCaptureContext() {
  return activeCapture;
}

/**
 * Attach the artifact to the capture being serialized.
 *
 * Ignored outside a save capture, because an artifact nobody can accept is a parse and
 * a pairing paid for nothing.
 */
export function attachCaptureArtifact(artifact) {
  if (activeCapture && artifact) activeCapture.artifact = artifact;
}

/** The artifact this capture's renderer attached, or null. */
export function captureArtifact(result) {
  return result ? captureArtifacts.get(result) || null : null;
}

/** Forget a capture's artifact: it was skipped, refused, or has now settled. */
export function releaseCaptureArtifact(result) {
  if (result) captureArtifacts.delete(result);
}

/**
 * Does this clone hold an authored save handler, template contents included?
 *
 * Those handlers are page JavaScript that can change the clone after the capture, so
 * the accepted bytes may no longer describe the live page node for node; a pairing
 * rebuilt by walking the two together would be describing the handler's tree. The
 * inspection path stays for those pages.
 */
function hasAuthoredSaveHandlers(root) {
  const visit = (el) => {
    if (el.hasAttribute('onbeforesave') || el.hasAttribute('onbeforesnapshot')) return true;
    const kids = el.localName === 'template' && el.content ? el.content : el;
    for (const child of kids.children) if (visit(child)) return true;
    return false;
  };
  return root.nodeType === 1 ? visit(root) : false;
}

function stripSnapshotRegions(clone) {
  for (const el of clone.querySelectorAll(SNAPSHOT_REMOVE_SELECTOR)) el.remove();
}

/**
 * Run every authored handler of one kind over a clone, and never let one of them
 * take the page down with it.
 *
 * These attributes hold page-author JavaScript, and the capture pipeline runs on
 * the boot path: save.js captures a baseline during module evaluation, inside the
 * dynamic import the loader awaits. An unguarded throw in one page attribute
 * therefore cost the document its entire client rather than costing that one
 * handler its effect.
 *
 * @param {HTMLElement} clone
 * @param {string} attr - e.g. 'onbeforesave'
 */
function runAuthoredHandlers(clone, attr) {
  for (const el of clone.querySelectorAll(`[${attr}]`)) {
    stripSnapshotRegions(clone);
    if (el !== clone && !clone.contains(el)) continue;
    try {
      new Function(el.getAttribute(attr)).call(el);
    } catch (err) {
      console.error(`[${attr}] handler failed:`, err);
    }
  }
}

let cloneCanonicalizer = null;

export function setCloneCanonicalizer(canonicalize) {
  cloneCanonicalizer = canonicalize;
}

// A document parsed from received bytes gets the same canonical URLs a capture has, so a merge
// compares like with like. A no-op until save-core registers the canonicalizer.
export function canonicalizeReceived(doc) {
  cloneCanonicalizer?.(doc);
  return doc;
}

/**
 * Register a hook that runs on EVERY snapshot (save AND sync).
 * Use for: syncing form values to the clone.
 *
 * @param {Function} callback - Receives the cloned document element
 */
export function onSnapshot(callback) {
  snapshotHooks.push(callback);
}

/**
 * Replace the save-domain serializer.
 *
 * Given the prepared save clone and the bytes `clone.outerHTML` would have sent, it
 * returns the bytes to send instead. The source map (plugins/source.js) is the only
 * caller: it renders the file's own bytes back out with only the changed regions
 * reprinted, so a save stops rewriting 88% of an authored document's lines.
 *
 * It runs on the save path with a person's document in its hands, so the contract is
 * narrow. It must return a complete document. It must not touch the clone, which is
 * also the source of both comparison baselines. And it must be able to answer with
 * `today` unchanged, because that is what it has to do whenever it is not certain:
 * the caller here treats a throw the same way, so the floor of any renderer is the
 * serialization it replaced.
 *
 * Comparison and dirty-check captures deliberately do NOT go through it. Those
 * strings are only ever compared against each other, so they gain nothing from
 * source fidelity and would pay a full render on every keystroke's dirty check.
 *
 * @param {?Function} renderer - (clone, today) => string, or null to restore outerHTML
 */
export function setSaveRenderer(renderer) {
  saveRenderer = renderer;
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * `clone.outerHTML`, except that a <noscript> holding only text is written raw.
 *
 * The page parsed with scripting on, so a <noscript> holds the author's markup as one
 * text node, and the page's own serializer writes it back raw. The clone lives in a
 * document with no window (createContentView), where scripting is off, and Chrome's
 * serializer escapes that text there: `<p>` went to disk as `&lt;p&gt;`, which a reload
 * reads as literal text, and every later save escaped it again. The text is swapped for
 * a marker only while serializing, so the clone holds the same nodes when this returns.
 */
function serializeClone(clone) {
  const blocks = [];
  const collect = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.localName === 'noscript' && child.namespaceURI === XHTML_NS) {
        const kids = Array.from(child.childNodes);
        if (kids.length && kids.every((n) => n.nodeType === 3)) blocks.push([child, kids]);
        continue;
      }
      collect(child.localName === 'template' && child.content ? child.content : child);
    }
  };
  collect(clone);
  if (!blocks.length) return "<!DOCTYPE html>" + clone.outerHTML;
  const nonce = Math.random().toString(36).slice(2);
  const raw = blocks.map(([el, kids], i) => {
    const marker = `\uE000clay-noscript-${nonce}-${i}\uE000`;
    el.replaceChildren(el.ownerDocument.createTextNode(marker));
    return [marker, kids.map((n) => n.data).join('')];
  });
  let html;
  try {
    html = "<!DOCTYPE html>" + clone.outerHTML;
  } finally {
    for (const [el, kids] of blocks) el.replaceChildren(...kids);
  }
  for (const [marker, text] of raw) html = html.split(marker).join(text);
  return html;
}

/**
 * The bytes a save sends: the prepared clone, through the save renderer if one is
 * installed.
 *
 * The try/catch is not defensive noise around a renderer that already catches its
 * own errors. That one catches in order to COUNT, and to fire the event that says a
 * document reprinted; this one is the guarantee that no bug in an optional plugin can
 * cost somebody a save.
 */
function serializeSaveClone(clone, context = null) {
  const today = serializeClone(clone);
  if (!saveRenderer) return today;
  const previous = activeCapture;
  activeCapture = context;
  try {
    return saveRenderer(clone, today);
  } catch (err) {
    console.error('clayjs: save renderer failed, sending the full serialization', err);
    return today;
  } finally {
    activeCapture = previous;
  }
}

/**
 * Register a transform that runs over a detached clone when preparing to save.
 * Use for: stripping admin elements, cleanup.
 *
 * It is a TRANSFORM, not a save lifecycle event: it runs over the clone that
 * gets saved AND over the clone used to answer "has anything changed", and that
 * second one runs on dirty checks that never become a save. So it must be pure
 * and repeatable — no counters, no logging, no network. The two clones have
 * different visibility rules, which is why neither run can be skipped.
 *
 * @param {Function} callback - Receives the cloned document element
 */
export function addDocumentTransform(callback) {
  documentTransforms.push(callback);
}

// =============================================================================
// CAPTURE FUNCTIONS
// =============================================================================

/**
 * PHASE 1-2: Clone the DOM and run snapshot hooks.
 *
 * This is the "canonical" state — form values synced, nothing stripped.
 * Used as the base for both saving and syncing.
 *
 * @returns {HTMLElement} Cloned document element with snapshot hooks applied
 */
function clonePreventingOnclone(node, deep = true) {
  const prev = window.__preventOnclone;
  window.__preventOnclone = true;
  try { return node.cloneNode(deep); }
  finally { window.__preventOnclone = prev; }
}

export function captureSnapshot({ flushUndo = true, authored = true, forSave = false, requestRefresh = false, context = null } = {}) {
  // Force-close any pending undo idle batch BEFORE cloning the DOM, so the
  // snapshot reflects a clean undo boundary. Without this, a save that fires
  // mid-typing would leave the idle batch open across the save boundary, and
  // Cmd+Z after save would restore to a state earlier than the last save.
  // No-op when undo isn't loaded or no batch is pending.
  // flushUndo: false is for captures that are not save boundaries (the scoped
  // live-sync dirty oracle runs per incoming frame, and flushing there would
  // shatter the user's undo batches mid-typing).
  if (flushUndo && typeof window !== 'undefined' && window.clay?.undo?.flush) {
    window.clay.undo.flush();
  }

  // The view records each clone node's live original straight into the provenance
  // map as it clones, including the nodes inside a <template>'s content fragment,
  // so the source map can ask which live node any clone node came from.
  const view = createContentView(document.documentElement, { capability: 'snapshot', provenance: snapshotProvenance });
  const clone = view.root;

  for (const hook of snapshotHooks) {
    stripSnapshotRegions(clone);
    hook(clone, { original: originalSnapshotNode, forSave, requestRefresh });
  }

  // Put back any URL clay rewrote at runtime (cache-bust, refetch-on-save) so
  // the file keeps what the page author wrote. Before onbeforesnapshot, so an
  // authored handler sees the same URLs the file will.
  restoreAuthoredUrls(clone);

  cloneCanonicalizer?.(clone);

  stripSnapshotRegions(clone);
  // Whether the page authors its own save handlers, read here because this is the
  // snapshot BEFORE either of them runs: a handler can add the other one, and it is the
  // page as captured that decides whether the save can be paired without an inspection.
  if (context) context.authoredHandlers = hasAuthoredSaveHandlers(clone);

  // authored: false is for a capture that is not a save and not a frame the page will
  // see. The attributes hold page-author JavaScript, so running them is a side effect
  // the author asked for once per save, not once per capture.
  if (authored) runAuthoredHandlers(clone, 'onbeforesnapshot');

  stripSnapshotRegions(clone);

  // Browser-extension noise (password-manager menus, Grammarly overlays, and
  // marker attributes on real inputs) is not page content. Drop it from every
  // snapshot so it never reaches a save, a comparison, or a live-sync broadcast.
  stripExtensionNoise(clone);

  // Router state says where this tab is, not what the document holds.
  stripRouteAttrs(clone);

  // So does ephemeral state: a selection, an open dialog, a marked attribute.
  stripEphemeral(clone);

  return clone;
}

/**
 * Prepare an already-captured snapshot for saving.
 * Mutates the clone — only call once per snapshot.
 *
 * @param {HTMLElement} clone - A snapshot from captureSnapshot()
 * @returns {HTMLElement} The same clone, in the save domain
 */
function prepareCloneForSave(clone, { authored = true } = {}) {
  stripSnapshotRegions(clone);
  // Run inline [onbeforesave] handlers
  if (authored) runAuthoredHandlers(clone, 'onbeforesave');

  // Run registered prepare hooks ([freeze]/[save-freeze] innerHTML restore lives here)
  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }

  stripSnapshotRegions(clone);

  // Strip [no-save] / legacy [save-remove] LAST (snapshot-algorithm step 7): a
  // prepare hook (freeze restore) can re-inject [no-save] content into the clone,
  // so the strip must run after the hooks or that content leaks to disk.
  for (const el of clone.querySelectorAll(STRIP_FROM_SAVE)) {
    el.remove();
  }

  stripDiagnosticBeacons(clone);

  return clone;
}

// sapjs marks an element it cannot run with a sap-error beacon. It describes this
// tab's engine, never the document, so no save carries it.
function stripDiagnosticBeacons(clone) {
  for (const el of clone.querySelectorAll("[sap-error]")) el.removeAttribute("sap-error");
}

/**
 * The save-domain clone, for a caller that needs the tree rather than the bytes.
 *
 * The source map pairs against this rather than against the live DOM, because this is
 * the tree in the file's own domain: edit mode deactivated back to the inert
 * attribute forms, [no-save] gone, every transform run. Every node in it that came
 * from the page can be traced back with originalSnapshotNode.
 *
 * Emits no snapshot-ready event: this capture must never feed the send pipeline.
 *
 * A caller that is only INSPECTING the tree passes `{ flushUndo: false, authored:
 * false }`. Both defaults are right for a save and wrong for anything else: flushing
 * closes the undo batch, so a capture taken mid-typing splits the user's undo history
 * at a point they did not make, and the authored handlers are page JavaScript that is
 * meant to run once per save, not once per capture.
 *
 * @returns {HTMLElement}
 */
export function captureSaveClone({ flushUndo = true, authored = true } = {}) {
  return prepareCloneForSave(captureSnapshot({ flushUndo, authored }), { authored });
}

// Attributes that render exactly like their absence. A scroll lock or a browser
// extension that resets an inline style leaves `style=""` behind, and the dirty
// check must not read that as an edit the person would lose on close.
const EMPTY_INERT_ATTRS = ['style', 'class'];

function serializeForCompare(clone) {
  stripDerived(clone);
  for (const name of EMPTY_INERT_ATTRS) {
    if (clone.getAttribute(name) === '') clone.removeAttribute(name);
    for (const el of clone.querySelectorAll(`[${name}=""]`)) el.removeAttribute(name);
  }
  return "<!DOCTYPE html>" + clone.outerHTML;
}

/**
 * Capture snapshot prepared for dirty/change comparison.
 *
 * Like captureForSave but also strips every region whose autosave-trigger is off
 * (no-trigger-autosave, freeze, no-watch, plus the legacy equivalents), so their
 * churn never marks the page dirty.
 *
 * @returns {string} HTML string with all autosave-off regions stripped
 */
export function captureForComparison({ flushUndo = true } = {}) {
  const clone = captureSnapshot({ flushUndo });

  // Run inline [onbeforesave] handlers
  runAuthoredHandlers(clone, 'onbeforesave');

  // Strip before hooks (hooks see the "final" state)
  for (const el of clone.querySelectorAll(STRIP_FROM_COMPARISON)) {
    el.remove();
  }

  // Run registered prepare hooks
  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }

  stripSnapshotRegions(clone);

  return serializeForCompare(clone);
}

/**
 * Capture in the DIRTY domain: like captureForComparison, but it KEEPS
 * no-trigger-autosave regions.
 *
 * The two domains answer different questions. "Should this edit start an
 * autosave?" is the autosave domain (captureForComparison). "Is there anything
 * here the person would lose?" is this one — an edit inside a batching region is
 * a real edit that an explicit save must write and a close must warn about.
 *
 * On a document with no such region this returns bytes identical to
 * captureForComparison, which is what keeps the two baselines comparable.
 *
 * @returns {string}
 */
export function captureForDirtyCheck({ flushUndo = true } = {}) {
  const clone = captureSnapshot({ flushUndo });

  runAuthoredHandlers(clone, 'onbeforesave');

  for (const el of clone.querySelectorAll(STRIP_FROM_DIRTY_CHECK)) {
    el.remove();
  }

  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }

  stripSnapshotRegions(clone);

  return serializeForCompare(clone);
}

/**
 * Both comparison domains from ONE snapshot, with no save clone and no
 * snapshot-ready event.
 *
 * For the callers that need to install or check both baselines without sending
 * anything: the load-time baseline capture and live-sync's post-morph baseline
 * setter. Taking two separate snapshots there would cost two full DOM clones per
 * boot and per applied frame, for bytes that are usually identical.
 *
 * @returns {{ forComparison: string, forDirty: string }}
 */
export function captureForComparisonAndDirty({ flushUndo = true } = {}) {
  const clone = captureSnapshot({ flushUndo });

  runAuthoredHandlers(clone, 'onbeforesave');

  const dirtyClone = clone.querySelector(NO_TRIGGER_AUTOSAVE_SELECTOR)
    ? clonePreventingOnclone(clone)
    : null;

  for (const el of clone.querySelectorAll(STRIP_FROM_COMPARISON)) {
    el.remove();
  }
  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }
  stripSnapshotRegions(clone);
  const forComparison = serializeForCompare(clone);

  let forDirty = forComparison;
  if (dirtyClone) {
    for (const el of dirtyClone.querySelectorAll(STRIP_FROM_DIRTY_CHECK)) {
      el.remove();
    }
    for (const hook of documentTransforms) {
      stripSnapshotRegions(dirtyClone);
      hook(dirtyClone);
    }
    stripSnapshotRegions(dirtyClone);
    forDirty = serializeForCompare(dirtyClone);
  }

  return { forComparison, forDirty };
}

/**
 * Single-capture function for both saving and comparison.
 *
 * Clones the DOM once, then clones that clone for comparison.
 * More efficient than calling captureForSave() and captureForComparison() separately.
 *
 * @param {Object} options
 * @param {boolean} options.emitForSync - Whether to emit snapshot-ready event (default: true)
 * @param {boolean} options.forRequest - These bytes go to a host, so the renderer may
 *   attach the verified model they came from, for the accepted save to adopt
 * @returns {{ forSave: string, forComparison: string, forDirty: string, captureId: number }}
 */
export function captureForSaveAndComparison({ emitForSync = true, flushUndo = true, requestRefresh = false, forRequest = false } = {}) {
  if (!Number.isSafeInteger(captureCounter + 1)) throw new Error('Save capture identity exhausted');
  const captureId = ++captureCounter;
  // The context this capture's renderer may attach a private artifact to, and the
  // record of whether the page has its own save handlers. It never reaches the object
  // this function returns: that keeps its four public fields.
  //
  // Only for a capture whose bytes go to a host. A capture taken for anything else (a
  // live-sync disk base, a download, an inspection) has no request to adopt it, so it
  // pays neither the retained parse nor the pairing.
  const context = forRequest ? { captureId, authoredHandlers: false, artifact: null } : null;
  const clone = captureSnapshot({ flushUndo, forSave: emitForSync, requestRefresh, context });

  // Emit for live-sync before any stripping.
  //
  // A listener gets the very clone this function goes on to serialize into
  // forSave, forComparison and forDirty — that sharing is the point, it saves a
  // second full DOM clone per save. So a listener may READ it and must not write
  // to it: anything it changes lands in the saved bytes and in both baselines,
  // and a baseline the dirty check cannot reproduce warns on close forever.
  if (emitForSync) {
    document.dispatchEvent(new CustomEvent('clay:snapshot-ready', {
      detail: { documentElement: clone, forSave: true, captureId }
    }));
  }

  // Run inline [onbeforesave] handlers
  runAuthoredHandlers(clone, 'onbeforesave');

  // Clone for comparison before stripping (cheaper than cloning live DOM)
  const compareClone = clonePreventingOnclone(clone);

  // The dirty domain differs from the autosave domain only inside
  // no-trigger-autosave regions, so a document without one pays nothing: the two
  // strip sets remove exactly the same nodes and one string serves both. The
  // predicate reads the captured clone after authored handlers have run, and
  // covers all three spellings via the policy's own selector.
  const dirtyClone = clone.querySelector(NO_TRIGGER_AUTOSAVE_SELECTOR)
    ? clonePreventingOnclone(clone)
    : null;

  // Save clone: run hooks (freeze restore lives here), THEN strip [no-save]/[save-remove]
  // LAST (snapshot-algorithm step 7) so freeze-restored [no-save] content can't leak to disk.
  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }
  stripSnapshotRegions(clone);
  for (const el of clone.querySelectorAll(STRIP_FROM_SAVE)) {
    el.remove();
  }
  stripDiagnosticBeacons(clone);
  const forSave = serializeSaveClone(clone, context);

  // Compare clone: strip every autosave-off region, then run hooks
  for (const el of compareClone.querySelectorAll(STRIP_FROM_COMPARISON)) {
    el.remove();
  }
  for (const hook of documentTransforms) {
    stripSnapshotRegions(compareClone);
    hook(compareClone);
  }
  stripSnapshotRegions(compareClone);
  const forComparison = serializeForCompare(compareClone);

  // Dirty clone: same shape as the compare clone, one selector weaker.
  let forDirty = forComparison;
  if (dirtyClone) {
    for (const el of dirtyClone.querySelectorAll(STRIP_FROM_DIRTY_CHECK)) {
      el.remove();
    }
    for (const hook of documentTransforms) {
      stripSnapshotRegions(dirtyClone);
      hook(dirtyClone);
    }
    stripSnapshotRegions(dirtyClone);
    forDirty = serializeForCompare(dirtyClone);
  }

  const result = { forSave, forComparison, forDirty, captureId };
  if (context && context.artifact) captureArtifacts.set(result, context.artifact);
  return result;
}

/**
 * Capture for a protected live-sync merge: the save-domain and loss-domain
 * clones of ONE snapshot, plus a WeakMap pairing every loss-domain element to
 * its save-clone twin.
 *
 * The pairing is recorded immediately after the compare clone is created,
 * while the two trees are still isomorphic; each side's strips then remove
 * nodes independently without disturbing it.
 *
 * The compare clone strips STRIP_FROM_DIRTY_CHECK, not STRIP_FROM_COMPARISON:
 * the merge asks "would applying this frame destroy work?", which is the same
 * question the close warning asks, so it must use the same domain. The autosave
 * domain is the wrong one here because it strips no-trigger-autosave, and an
 * unsaved edit in a batching region is exactly the work the merge exists to
 * protect. Disposable churn stays out of both domains via no-dirty, which is
 * what keeps a self-churning region from promoting a dirty root to <body> and
 * holding every frame forever.
 *
 * Dirty roots map through pairMap to save-domain subtrees (the same domain as
 * the file on disk), which still carry the freeze / no-watch children the
 * compare clone strips.
 *
 * Never emits snapshot-ready (this capture must not feed the send pipeline)
 * and never flushes the undo batch (it runs per incoming frame, not per save).
 *
 * @returns {{ saveClone: HTMLElement, compareClone: HTMLElement, pairMap: WeakMap }}
 */
export function captureForMerge() {
  const clone = captureSnapshot({ flushUndo: false });

  runAuthoredHandlers(clone, 'onbeforesave');

  const compareClone = clonePreventingOnclone(clone);

  const pairMap = new WeakMap();
  (function pair(compareEl, saveEl) {
    pairMap.set(compareEl, saveEl);
    const compareKids = compareEl.children;
    const saveKids = saveEl.children;
    for (let i = 0; i < compareKids.length; i++) {
      pair(compareKids[i], saveKids[i]);
    }
  })(compareClone, clone);

  for (const hook of documentTransforms) {
    stripSnapshotRegions(clone);
    hook(clone);
  }
  stripSnapshotRegions(clone);
  for (const el of clone.querySelectorAll(STRIP_FROM_SAVE)) {
    el.remove();
  }
  stripDiagnosticBeacons(clone);

  for (const el of compareClone.querySelectorAll(STRIP_FROM_DIRTY_CHECK)) {
    el.remove();
  }
  for (const hook of documentTransforms) {
    stripSnapshotRegions(compareClone);
    hook(compareClone);
  }
  stripSnapshotRegions(compareClone);

  return { saveClone: clone, compareClone, pairMap };
}

/**
 * PHASE 1-4: Full pipeline for saving to server.
 *
 * Captures snapshot, emits for live-sync, then prepares for save.
 * This is the main entry point for the save process.
 *
 * @param {Object} options
 * @param {boolean} options.emitForSync - Whether to emit snapshot-ready event (default: true)
 * @returns {string} Full HTML string ready for server
 */
export function captureForSave({ emitForSync = true } = {}) {
  const clone = captureSnapshot();

  // Emit for live-sync before stripping admin elements
  // Sends full cloned documentElement so live-sync can extract head and body
  if (emitForSync) {
    document.dispatchEvent(new CustomEvent('clay:snapshot-ready', {
      detail: { documentElement: clone }
    }));
  }

  return serializeSaveClone(prepareCloneForSave(clone));
}

/**
 * The bytes a live-sync broadcast carries: the snapshot, minus the root
 * attributes that belong to this tab alone. A third serialization of the same
 * clone alongside the snapshot and the document, and the only one that crosses
 * into another person's browser.
 *
 * Takes the clone rather than capturing one, because the caller already has the
 * snapshot-ready clone and capturing again would run every hook a second time.
 * (Not to be confused with captureBodyForSync below, which is the older
 * body-innerHTML helper and unrelated to the live-sync lane.)
 *
 * It must not write to the clone. The caller derives forSave and both comparison
 * baselines from this same object once every listener has returned, so anything
 * left behind lands in the saved bytes and in both baselines.
 *
 * This used to strip the tab-local attributes in place and set them again in a
 * finally, which looked exact and was not: an attribute list is ordered by
 * insertion, so putting a name back appended it. On htmlclay, whose injectAttr
 * splices the token and file id in right after `<html`, every save then installed
 * a baseline whose root tag was ordered differently from the one any later dirty
 * check builds off the live DOM — same names, same values, same length, never
 * equal again. Closing an already-saved document warned every time, and
 * savePageThrottled's "no changes to save" short-circuit never fired.
 *
 * The open tag is serialized from a childless copy instead, so the shared clone is
 * never touched and there is no restore to get wrong. The copy is one element, not
 * the tree.
 */
export function serializeForSync(clone) {
  const bareRoot = clonePreventingOnclone(clone, false);
  for (const name of TAB_LOCAL_ROOT_ATTRS) bareRoot.removeAttribute(name);

  // Split the end tag off by LENGTH rather than searching for one: an authored
  // attribute value holding "</html>" would fool any indexOf-based split and
  // truncate the broadcast.
  const shell = bareRoot.outerHTML;
  const endTag = `</${bareRoot.localName}>`;
  // The doctype, so this artifact is a complete document like every other one this
  // module produces. Spec section 2 asks for that, and it costs nothing on the wire:
  // a receiver parses the string and morphs documentElement against documentElement,
  // so the prologue is consumed by the parser and never reaches the morph.
  return "<!DOCTYPE html>" + shell.slice(0, shell.length - endTag.length) + clone.innerHTML + endTag;
}

/**
 * PHASE 1-2 (body only): For live-sync between admin users.
 *
 * Includes admin elements — no stripping.
 * Note: Prefer listening to 'clay:snapshot-ready' event instead,
 * which reuses the save's clone.
 *
 * @returns {string} Body innerHTML with form values synced
 */
export function captureBodyForSync() {
  const clone = captureSnapshot();
  return clone.querySelector('body').innerHTML;
}

/**
 * The bytes a save would send, without saving anything.
 *
 * Emits no snapshot-ready event (safe for comparison), and with no options it is
 * exactly `captureForSave({ emitForSync: false })`.
 *
 * `transform(root)` edits the detached clone and nothing else, and runs before
 * prepareCloneForSave so the authored hooks, the transforms and the [no-save] strip
 * still have their say. It must be synchronous: a preview that finished later would
 * describe a page that has moved on, so a thenable is refused rather than awaited.
 * There is no global registration, so no other save ever sees these edits, and the
 * renderer runs without a capture context, so nothing can adopt these bytes as a model.
 */
export function getPageContents({ transform = null, flushUndo = true } = {}) {
  if (!transform && flushUndo) return captureForSave({ emitForSync: false });
  const clone = captureSnapshot({ flushUndo });
  if (transform) {
    const pending = transform(clone);
    if (pending && typeof pending.then === 'function') {
      throw new TypeError('getHTML: the transform must be synchronous');
    }
  }
  return serializeSaveClone(prepareCloneForSave(clone));
}

/**
 * The page as this tab had it before a merge replaced some of it, as the bytes a
 * save would have written. The ledger's clone is shared and must come back
 * untouched, so this works on a copy. A snapshot-domain clone still needs the save
 * preparation (transforms, the [no-save] strip) but not the authored onbeforesave
 * handlers: this is a download, not a save. A save-domain clone is already prepared.
 */
export function serializeRecoveryClone(clone, { prepared = false } = {}) {
  const copy = clonePreventingOnclone(clone);
  return serializeClone(prepared ? copy : prepareCloneForSave(copy, { authored: false }));
}

/**
 * The live page as a save would write it, for a download: the save transforms and
 * the [no-save] strip, but no authored handler runs and the undo batch stays open.
 * Nothing is sent and no event fires.
 */
export function captureRecoveryPage() {
  return serializeSaveClone(captureSaveClone({ flushUndo: false, authored: false }));
}
