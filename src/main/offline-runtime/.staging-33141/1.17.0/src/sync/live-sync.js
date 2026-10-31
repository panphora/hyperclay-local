/**
 * live-sync.js — Real-time sync between admin users
 *
 * HOW IT WORKS:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  1. LISTEN            snapshot-ready event from save    │
 *   │                       (full document with form values)  │
 *   └─────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  2. SEND          POST snapshot to the relay address    │
 *   │                 (after the save lands, with its stamp)  │
 *   └─────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  3. RECEIVE            SSE stream from server           │
 *   │                        (other clients' changes)         │
 *   └─────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  4. MORPH              HyperMorph full documentElement  │
 *   │                        (preserves focus, input values)  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * LANES: edit-mode tabs ride the 'live' lane (steps 1-4: they broadcast
 * pre-strip snapshots to peers and receive theirs). View-mode tabs ride the
 * 'saved' lane: receive-only (steps 3-4), fed post-strip on-disk HTML by the
 * server whenever the file is persisted (browser save, code editor, device
 * sync, template/restore, local external edits).
 *
 * INTEGRATES WITH: snapshot.js (receives snapshot-ready events)
 */

import { createIdentityStore } from "../vendor/hyper-morph-identity.vendor.js";
import { pageRelay } from "./page-relay.js";
import { loadedEngine, mergeEngine } from "./merge-engine.js";
import Mutation from "../lib/mutation.js";
import { NO_DIRTY_SELECTOR, LIVE_SELECTOR } from "../lib/region-policy.js";
import { EXTENSION_NODE_SELECTOR, EXTENSION_ATTR_PATTERN } from '../lib/extension-noise.js';
import { isEditMode, modeState } from "../core/is-edit-mode.js";
import { attributeMerge } from "./merge-declarations.js";
import { serializeForSync, captureForComparisonAndDirty, canonicalizeReceived, captureSnapshot, originalSnapshotNode, captureForMerge, captureForSaveAndComparison } from '../core/snapshot.js';
import { mergeIgnoresAttr, mergeVetoesAttr } from '../lib/root-attrs.js';
import { autosaveActive } from '../lib/autosave-state.js';
import { hostSupports } from '../core/host-meta.js';
import { PAGE_FORMAT, PAGE_FORMAT_HEADER } from '../core/page-format-wire.js';
import { knownPageFormatFloor, pageFormatFloor, withPageFormatFloor } from '../core/page-format.js';
import { onSaveAccepted } from '../core/save-accepted.js';
import { servedDocumentEtag } from '../core/host-attrs.js';
import { recordEtag, seedEtag, lastSeenEtag, conditionalSaves, representedEtag, forgetRepresentedEtag } from '../core/etag.js';
import { pageMaybeDirty, pauseGate, resumeGate, gateCaptureToken, gateClearIfUnchanged, gateMarkDirty } from '../lib/dirty-gate.js';
import { gestureSeen } from '../lib/user-gesture.js';
import { SyncStream } from './stream.js';
import { streamOpened, streamClosed, streamEvent, LIVE_EVENTS } from '../live/stream-bridge.js';
import { conflicts, conflictLedger, loadConflicts } from './conflicts-facade.js';
import { upgradeReplaces, stopForUpgrade } from './version-guard.js';
import { isDerivedAttr, ownsDerivedText, stripDerived, repaintDerived, paintSignatureOfHtml, derivedActive } from '../lib/derived.js';

// The edit-only half of live sync (save, admin and editing-sender code) is a
// separate chunk. Edit mode starts it as live-sync evaluates, so its modules
// stand where the old static imports left them before the first frame or save,
// and view mode never fetches it.
let edit = null;
let editLoad = null;

function loadEdit() {
  editLoad ??= new Promise((resolve) => setTimeout(resolve, 0))
    .then(() => import('./live-sync-edit.js'))
    .then((loaded) => (edit = loaded))
    .catch((error) => {
      editLoad = null;
      throw error;
    });
  return editLoad;
}

// The presence store is a first-use download for a reader too, so only the live lane
// asks for it: a view-mode tab names it nowhere and fetches none of it.
let presenceStore = null;
let presenceLoad = null;

function loadPresence() {
  presenceLoad ??= import('./presence-store.js')
    .then((mod) => (presenceStore = mod.presence))
    .catch((error) => {
      presenceLoad = null;
      throw error;
    });
  return presenceLoad;
}

// `entering` means an entry is importing this module: the controller starts the
// lane once the mode is committed, so this evaluation starts nothing and loads
// nothing. An explicit initial edit, and a reader's saved lane, are untouched.
const entering = modeState().phase === "entering";

if (isEditMode && !entering) loadEdit().catch(() => {});

// The conflict ledger is what a merge writes to, so an editor starts its download as
// this file evaluates rather than at the first merge: nothing on the edit path pays
// for it twice. A reader starts it with its first merged frame (or with the live lane).
if (isEditMode) loadConflicts().catch(() => {});

// Who else is on the document, and the block somebody else is editing: both are
// a download of their own. A reader alone on a page draws neither, so they
// arrive with the first roster frame; a frame that lands while the download is
// in flight waits in order, and anything read before it is the empty state a
// bare constructor gives.
let roster = null;
let rosterLoad = null;
let rosterQueue = [];

function applyRoster(data) {
  roster.presence.update(data);
  roster.editingMarker.update(data);
}

function loadRoster() {
  rosterLoad ??= Promise.all([import('./presence.js'), import('./editing-marker.js')])
    .then(([presenceMod, markerMod]) => {
      roster = { presence: presenceMod.presence, editingMarker: markerMod.editingMarker };
      const queued = rosterQueue;
      rosterQueue = [];
      for (const data of queued) applyRoster(data);
      return roster;
    })
    .catch((error) => {
      rosterLoad = null;
      throw error;
    });
  return rosterLoad;
}

// A download that failed keeps the queue, so the next frame asks again.
function takeRosterFrame(data) {
  if (roster) {
    applyRoster(data);
    return;
  }
  rosterQueue.push(data);
  loadRoster().catch(() => {});
}

// The receipt of a lane that has applied no saved file.
const NO_FILE = Object.freeze({ bytes: null, etag: null, seq: null });

// save.js returns this from savePageThrottled outside edit mode; a view-mode
// tab that somehow asks for a merge save gets the same answer without loading it.
const notInEditModeResult = () => ({
  msg: 'Not in edit mode',
  msgType: 'skipped',
  code: null,
  etag: null,
});

// What a live-sync merge never reads or touches on any side: editor chrome,
// content kept out of the save or the snapshot, the contents of frozen regions,
// and nodes browser extensions inject. The same set the 0.5 morph's sync policy
// ignored.
const SYNC_IGNORE_SELECTOR = [
  '[editor-ui]', '[clay~="editor-ui"]', '[save-ignore]', '[snapshot-remove]',
  '[no-snapshot]', '[no-save]', '[save-remove]', '[freeze] *', '[save-freeze] *',
  '[clay~="no-save"]', '[clay~="no-snapshot"]', '[clay~="freeze"] *',
  LIVE_SELECTOR,
  EXTENSION_NODE_SELECTOR,
].join(',');

// A frozen element is a scratchpad: the element is part of the document and
// merges like any other, but its contents belong to this tab. Every merge input
// has its frozen elements emptied, and hyper-morph's opaque option leaves the
// live contents alone. Painted output (lib/derived.js) is left out of every
// input the same way, and the engine repaints it once the merge has applied.
const FREEZE_SELECTOR = '[clay~="freeze"], [freeze], [save-freeze]';

function emptyScratchpads(root) {
  for (const el of root.querySelectorAll(FREEZE_SELECTOR)) el.replaceChildren();
  if (derivedActive()) stripDerived(root);
  return root;
}

function scratchpadsEmptied(input) {
  if (input == null) return input;
  const doc = typeof input === 'string' ? new DOMParser().parseFromString(input, 'text/html') : input;
  canonicalizeReceived(doc);
  emptyScratchpads(doc);
  return doc;
}

// Regions whose local state is never work to keep: disposable content
// (no-dirty) and regions the mutation system does not watch, whose churn the
// dirty gate already excludes. The incoming frame's version wins there.
const REMOTE_WINS_SELECTOR = [
  NO_DIRTY_SELECTOR,
  '[clay~="no-watch"]', '[no-watch]', '[mutations-ignore]',
].join(',');

// Host tokens, library state, router state and ephemeral state, on every side
// of a merge: the live root, a snapshot clone's root, a parsed frame's root.
// Extension marker attributes too: snapshots and frames never carry them, so a
// disk frame would otherwise strip them from the live inputs they belong to.
const isRootLocalAttr = (el, name, merged) =>
  mergeIgnoresAttr(el, name, merged) || EXTENSION_ATTR_PATTERN.test(name.toLowerCase());

// Identity an author wrote into the page, the fallback behind synthetic ids.
//
// Answered only where it is unique on its side. hyper-morph drops a duplicated
// id from its own index, but an identity answered here pre-empts the sender's
// map (`first`), so cards cloned from one template, all carrying the same
// data-id, lost their synthetic ids and paired by nothing while their children
// kept theirs and cross-paired. Answering null lets the map speak.
//
// `memo` caches one count per side tree for the length of one merge. It must
// not outlive the merge: a two-way call reads the live document as its local
// side, and the live document changes between frames.
const authoredAttr = (el) => el.getAttribute('data-id') || el.getAttribute('id') || null;

function countAuthored(root) {
  const counts = new Map();
  const visit = (el) => {
    if (el.matches(SYNC_IGNORE_SELECTOR)) return;
    const id = authoredAttr(el);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
    const kids = el.localName === 'template' && el.content ? el.content.children : el.children;
    for (const kid of kids) visit(kid);
  };
  const tops = root.nodeType === 9 ? [root.documentElement] : root.nodeType === 11 ? root.children : [root];
  for (const top of tops) if (top && top.nodeType === 1) visit(top);
  return counts;
}

const uniqueAuthoredIdentity = (memo) => (el) => {
  const id = authoredAttr(el);
  if (!id) return null;
  const root = el.getRootNode();
  let counts = memo.get(root);
  if (!counts) memo.set(root, (counts = countAuthored(root)));
  return counts.get(id) === 1 ? id : null;
};

const isIdMap = (m) => !!m && typeof m === 'object' && !Array.isArray(m);

/**
 * The version a fetched served document names on its own root, or null.
 *
 * The host injects this attribute into the response it builds from one read of
 * the file, so a served-document GET answers which version the body it just
 * returned actually is. Parsed detached: this reads one attribute and never
 * touches the live page, and a body that cannot be parsed simply offers no stamp.
 *
 * @param {string} html
 * @returns {?string}
 */
function readServedStamp(html) {
  if (typeof html !== 'string' || html === '') return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.documentElement?.getAttribute('documentetag') || null;
}

// The page just took a frame verified clean against its baseline, so it now IS
// the file on disk. Both saved baselines move together from one capture: leaving
// the dirty baseline behind would make the close warning fire on the frame's own
// content. Never flushes undo (this runs per incoming frame, not per save) and
// never emits snapshot-ready (it must not feed the send pipeline).
/**
 * Convert an incoming disk document from its saved (inert) form to the live
 * edit-mode form, exactly as boot does on page load, so the merge compares
 * like with like: without this, every disk frame would swap the live page's
 * contenteditable/onclick/admin state back to inert, killing the caret
 * mid-edit. Root attributes (editmode, savestatus, tokens) need no reversal
 * here; the merge's attribute veto keeps the live root's own.
 */
function activateIncomingDoc(rootEl, lane) {
  if (lane !== 'live' || !rootEl || !edit) return;
  edit.enableContentEditable(rootEl);
  edit.enableOnClick(rootEl);
  edit.enableAdminInputs(rootEl);
  edit.enableAdminResources(rootEl);
}

function pairedBaseline() {
  const { forComparison, forDirty } = captureForComparisonAndDirty({ flushUndo: false });
  return [forComparison, forDirty];
}

/**
 * The wires live in wire-profile.js: both halves of one sync pick a single profile
 * from `/_/meta`, and the reader's receive-only stream makes the same choice.
 */
import { WIRE_PROFILES, resolveWireProfile } from './wire-profile.js';

// Above this the relay body is a Blob built from parts, so the snapshot is never joined
// into one more full-size string on the main thread. The save body's own threshold (5h).
const RELAY_BODY_BLOB_MIN_BYTES = 1024 * 1024;

/**
 * The body of one relay POST: the bytes `JSON.stringify` of this object has always
 * produced, from parts when the snapshot is large. An absent value still leaves its key
 * out, exactly as before.
 */
function relayBody(profile, html, sender, identityMap, etag) {
  const rest = { sender, identityMap, ...(etag ? { etag } : {}) };
  if (html.length < RELAY_BODY_BLOB_MIN_BYTES) return JSON.stringify({ [profile.snapshotKey]: html, ...rest });
  return new Blob([`{${JSON.stringify(profile.snapshotKey)}:`, JSON.stringify(html), `,${JSON.stringify(rest).slice(1)}`], { type: 'application/json' });
}

class LiveSync {
  constructor() {
    this.sse = null;
    this.currentFile = null;
    this.lastHtml = null;
    // The disk lane's merge base: the file's bytes, in the save domain, as of
    // the most recent moment this tab's document agreed with the file. Three
    // things are such a moment: the seed at start(), a frame's synchronous
    // apply, and a save's capture. Each takes a ticket from _agreeSeq at that
    // moment and writes through _setDiskBase, which keeps the newest moment:
    // a save response landing after a later frame applied, or a frame whose
    // await outlasts a later save, can no longer rewind the base.
    this._diskBase = null;
    this._diskBaseTicket = 0;
    this._agreeSeq = 0;
    // The ticket of the save currently in flight, taken when it captured.
    this._saveTicket = 0;
    // The peer lane's base carries a ticket from the same counter as the disk
    // lane, so an accepted save and a frame install in the order the document
    // held their bytes, not the order their promises settled.
    this._peerBaseTicket = 0;
    // The newest accepted save's capture ticket. A frame older than it does not
    // adopt its own stamp: the save's response already recorded a newer one.
    this._acceptedSaveTicket = 0;
    // The ticket of the latest frame of either lane whose morph has run. The
    // boot settle must not replace a base a morph already moved past.
    this._morphTicket = 0;
    this.clientId = this.generateClientId();

    // Per-stream resume id for the htmlclay replay server's wire contract.
    // Regenerated on every start() (see below) so an explicit stop/start is a
    // brand-new stream that never inherits the old baseline. Native
    // EventSource reuses the same URL — and thus this id — on its own
    // automatic reconnect. Deliberately NOT the sender clientId, which is the
    // durable per-tab identity used for echo suppression.
    this.resumeId = null;

    // The sync serialization of the clone the CURRENT save was captured from,
    // held so the commit relay can pair the host's stamp with the content that
    // stamp actually describes. Set at snapshot-ready, which fires before the
    // save POST goes out, and consumed by _relayCommit when the response lands.
    // Never reconstructed from lastHtml: that is the newest accepted save or
    // applied frame, which can still lag the save in flight, and pairing a fresh
    // stamp with older bytes is the one thing spec §10 forbids.
    this._savedSnapshot = null;
    this._sendInFlight = false;
    this._queuedSend = null;

    // The chosen wire, and the in-flight discovery that chooses it. Memoized for the
    // life of the page: a host does not change its capabilities under a loaded
    // document, and hostMeta() memoizes the request itself.
    this._profile = null;
    this._profilePromise = null;
    this._sharedData = false;
    this._sharedSync = false;
    this._liveData = false;
    this._editing = null;
    this._presenceLease = null;
    // Set by the exit barrier: a sender discovered while it runs is built but stays
    // quiet until resume, so the exit publishes nobody.
    this._presenceQuiesced = false;
    this._ready = null;
    // Bumped by every start(), so a discovery that resolves after a stop/restart
    // cannot open a stream for the run that has already been torn down.
    this._startGen = 0;
    this.isPaused = false;
    this.isDestroyed = false;
    this.debug = false;

    // Lane on the shared per-file SSE channel. Edit mode: 'live' (owner-gated,
    // pre-strip peer snapshots + notifications). View mode: 'saved' (receive-
    // only post-strip on-disk HTML). This is only the lane a page starts with:
    // start() reads the committed mode, so one instance serves a reader's saved
    // lane and, after an entry, the live lane.
    this._lane = isEditMode ? 'live' : 'saved';
    // A lane chosen by hand (a test, or a live switch handing one over) is never
    // re-derived; otherwise every start() reads the committed mode.
    this._laneChosen = false;

    // Store handler reference for cleanup
    this._snapshotHandler = null;

    // High-water mark of server seqs we've seen on this channel (own echoes
    // count too). Server-broadcast payloads carry a monotonic seq
    // (Date.now()-based). We drop anything <= this to guard against rare
    // cases where a stale message lands after a newer one, e.g. buffered
    // replay, alt backend after reconnect, or an own-save echo arriving
    // after a peer's newer broadcast.
    this.lastSeenSeq = 0;

    // rAF-paced single-flight queue. Incoming updates overwrite a pending
    // slot; on each animation frame, if a slot is set and no morph is in
    // flight, run one morph against the latest pending payload. Burst
    // arrivals collapse to one morph per frame, keeping the receiver from
    // falling behind under load. A morph with external scripts returns a
    // Promise, so the in-flight flag prevents overlap.
    this._pendingHtml = null;
    this._pendingSeq = null;
    this._pendingIdentityMap = null;
    // The stamp a pending frame carries, adopted only if that frame applies
    // cleanly. It rides in the slot beside the bytes it describes so the two can
    // never be separated, which is the whole rule (§6, and §22 of the plan).
    this._pendingEtag = null;
    // Who the server says sent the pending frame, `{ id, name }`. Rides in the
    // slot for the same reason the stamp does: it describes these bytes and
    // nothing else, so a newer frame replacing them takes its author with it.
    // Reported on `clay:sync-applied` once the frame has actually applied.
    this._pendingBy = null;
    this._morphInFlight = false;
    this._rafHandle = null;

    // The saved file this lane last applied, `{ bytes, etag, seq }`: the receipt a
    // switch is handed, and the only record of it a same-body frame may move. A
    // metadata stamp is not a file, so it never advances this one.
    this._represented = NO_FILE;
    // A switch owns the queue from prepareHandoff() until it commits or resumes:
    // frames keep filling their slots and nothing morphs.
    this._handoff = null;
    this._handoffHeld = false;

    // Disk-sourced external changes (htmlclay watcher content) get their own
    // one-deep slot so a peer frame arriving in the same window can't
    // displace them. Drained in seq order alongside the peer slot.
    this._pendingExternal = null;   // { html, seq, saveEpoch, etag }

    // Newest external-change seq accepted for apply. Replayed or reordered
    // disk frames (and their fetch fallbacks) are dropped against this.
    this._lastExternalSeq = 0;

    // Bumped on every own save success. A queued disk frame older than our
    // own landed save is stale by construction: the save just made disk
    // equal our state.
    this._saveEpoch = 0;
    this._saveSavedHandler = null;
    this._saveConflictHandler = null;
    this._settledHandler = null;

    // The identityMap that came with lastHtml, so the peer-lane dirty diff
    // can resolve synthetic identities on its base tree.
    this._lastIdentityMap = null;

    // Bumped whenever an APPLY (or a reset) rewrites lastHtml. The boot settle
    // reads it: a lane a frame already replaced since start is not refreshed
    // from whatever DOM that frame left behind.
    this._applyGen = 0;

    // Hold-retry timers, one per pending slot. A held frame's slot and seq
    // watermark have already advanced, so nothing redelivers it; the retry
    // re-queues the same payload so it applies if the blocking local edit is
    // undone, and is dropped by the seq/epoch checks if it went stale.
    this._holdRetryPeer = null;
    this._holdRetryExt = null;

    // The startup check: the one fetch this class runs against the page it was
    // itself served, started once by the transport's first cursor and never
    // again. `_servedFetchId` numbers every served-document GET, so a response
    // that arrives after a newer GET was issued can tell it is superseded — only
    // the startup check acts on that, since a repair is re-issued rather than
    // re-read. `_startupRetry` is the single pending re-ask, coalesced so two
    // retries cannot pile up behind one another.
    this._servedFetchId = 0;
    this._startupRetry = null;
    this._engineRetry = null;

    // Whether each lane is currently holding. A hold is a safe outcome but a
    // silent one: without an event the page simply stops updating and nothing
    // can say why. These make the transitions observable in both directions.
    this._heldLive = false;
    this._heldExt = false;

    // Identity tracking for content-based morphing across live-sync updates.
    // Synthetic IDs (`<clientId>:<counter>`) live here only — never written to
    // the DOM, never serialized into saved HTML. hyper-morph’s identity store holds them
    // against the live elements so that the next save can produce the same
    // identityMap, and afterNodeMorphed transfers IDs from incoming parsed
    // elements onto the live elements they morphed into.
    this.identity = createIdentityStore(this.clientId);

    // Callbacks
    this.onConnect = null;
    this.onDisconnect = null;
    this.onUpdate = null;
    this.onError = null;
    this.onNotification = null;
  }

  // Compatibility: the raw engine reports of every open loss. The ledger
  // (clay.conflicts) is the real owner; nothing here removes a record.
  get unresolvedConflicts() {
    return conflicts.list().filter((c) => c.kind !== 'apply-incomplete');
  }

  _log(message, data = null) {
    if (!this.debug) return;
    const prefix = `[LiveSync ${new Date().toISOString()}]`;
    if (data !== null) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Mint the per-tab sender identity used for echo suppression. Lives on the
   * instance, never in storage: sessionStorage is COPIED into a duplicated tab,
   * so a persisted id made the duplicate treat the original's edits as its own
   * echoes and the two tabs silently stopped syncing. Instance lifetime is the
   * durability that matters, since EventSource auto-reconnect reuses this same
   * instance.
   */
  generateClientId() {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  /**
   * Generate a fresh per-stream resume id (URL-safe, well under the 128-byte
   * wire limit). Minted on every start(), never persisted: an explicit
   * stop/start must not reuse the previous stream's baseline.
   */
  generateResumeId() {
    try {
      const bytes = new Uint8Array(16);
      (globalThis.crypto || window.crypto).getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  /**
   * Seed both merge bases (the peer lane's and the disk lane's) with the page as
   * it stands, so a first frame that arrives after local edits merges instead of
   * holding. A page already dirty has no trustworthy base; it keeps null and holds.
   */
  _seedBases() {
    if (pageMaybeDirty()) return;
    const clone = captureSnapshot({ flushUndo: false });
    this._setPeerBase(serializeForSync(clone), this.identity.exportMap(clone, originalSnapshotNode), this._ticket());
    this._setDiskBase(captureForSaveAndComparison({ emitForSync: false }).forSave, this._ticket());
  }

  get lane() {
    return this._lane;
  }

  set lane(value) {
    this._lane = value;
    this._laneChosen = true;
  }

  /**
   * Start the LiveSync system
   * Can be called after stop() to restart with a new file
   *
   * The lane is read here, from the committed mode, unless the caller names one:
   * the same instance rides a reader's saved lane, becomes the live lane at an
   * entry, and comes back to the saved lane at an exit. `represented` is the
   * `{bytes, etag, seq}` receipt a switch hands over, so a restarted saved lane
   * has one before any frame arrives and a frame repeating it changes nothing.
   */
  start(file = null, { lane, represented } = {}) {
    // Reset destroyed flag to allow restart after stop()
    this.isDestroyed = false;

    // Prevent double-connect: clean up existing connection first
    if (this.sse || this._snapshotHandler) {
      this.cleanup();
    }

    this.currentFile = file || this.detectCurrentFile();

    if (!this.currentFile) {
      console.warn('[LiveSync] No file detected');
      return;
    }

    const committed = modeState().mode === 'edit' ? 'live' : 'saved';
    const wasLive = this.lane === 'live';
    this._lane = lane || (this._laneChosen ? this._lane : committed);

    // Reset state for new connection. Resetting lastSeenSeq is a new baseline,
    // so mint a fresh resume id — this stream must not resume the previous one.
    this.lastHtml = null;
    this._lastIdentityMap = null;
    // A ticket of its own, as the disk lane's reset takes: a save accepted or
    // a frame settling from before this start cannot land in the new run.
    this._peerBaseTicket = this._ticket();
    // The reset takes a ticket of its own, so a writer from before this start
    // (a save response still on the wire) cannot land in the new run.
    this._diskBase = null;
    this._diskBaseTicket = this._ticket();
    this._saveTicket = 0;
    this._savedSnapshot = null;
    this._applyGen++;
    this.lastSeenSeq = 0;
    this._lastExternalSeq = 0;
    this._represented = represented
      ? Object.freeze({ bytes: represented.bytes ?? null, etag: represented.etag ?? null, seq: represented.seq ?? null })
      : NO_FILE;
    // A saved lane a live session just gave back, holding no receipt, is the one case
    // that has to fetch the served file for itself: an initial-edit exit that saved
    // nothing still leaves a reader that can show and hand over a file.
    this._acquireEmptySaved = wasLive && this.lane === 'saved' && this._represented.bytes === null;
    this._pendingExternal = null;
    this.resumeId = this.generateResumeId();

    // Seed both merge bases now, so a first frame that arrives after local edits
    // merges instead of holding. A page still booting is refreshed at the settle
    // below: a base taken before a module built its DOM makes the first dirty merge
    // see both sides add that DOM, and keep it twice.
    if (this.lane === 'live') this._seedBases();
    // The live lane merges from its first frame, and every merge there reads the
    // ledger, so the download starts with the lane instead of delaying a frame.
    if (this.lane === 'live') loadConflicts().catch(() => {});

    console.log(`[LiveSync] Starting for: ${this.currentFile} (lane=${this.lane})`);
    // One discovery request stands between here and the stream. It is memoized and
    // bounded, and it does not gate ordinary saves — /_/save is a separate lane that
    // never moved. Snapshots produced during the window are queued, not dropped.
    const gen = ++this._startGen;
    if (this.lane === 'live' && !(edit ? edit.baselineSettled() : false)) {
      const applyGen = this._applyGen;
      const morphTicket = this._morphTicket;
      const saveEpoch = this._saveEpoch;
      const startHtml = this.lastHtml;
      const startDiskTicket = this._diskBaseTicket;
      const startDiskSeeded = this._diskBase !== null;
      this._settledHandler = () => {
        this._settledHandler = null;
        if (this.isDestroyed || this._startGen !== gen) return;
        // A person has touched the page: whatever they did (a drag, a button whose
        // handler edits a turn later) may be in it and not yet saved. Keep the start
        // seed, as 1.5.2 did; only an untouched tab gets the settled page as its base.
        if (gestureSeen()) return;
        // The settle clears the gate only when it saw no user edit, so a dirty page
        // here holds work the base must not absorb: keep the start seed.
        if (pageMaybeDirty()) return;
        // A save this tab sent is still unconfirmed: what it carries is not yet
        // common history, and a refused save must merge against the older base.
        if (this._saveTicket !== 0) return;
        // A frame morphed the page since start: its base is newer than
        // anything the settle would capture.
        if (this._morphTicket !== morphTicket) return;
        // Refresh each lane only while it still holds what start left. A frame, a
        // landed relay, an own save or a disk frame since then gave it a newer base
        // (an own save counts even when its relay failed and lastHtml never moved).
        // Only replace a seed start took, never fill a base start left empty: a page
        // dirty at start held its frames in 1.5.2, and its own scripts may still be
        // rewriting content the merge cannot reach.
        if (startHtml !== null && this._applyGen === applyGen && this._saveEpoch === saveEpoch && this.lastHtml === startHtml) {
          const clone = captureSnapshot({ flushUndo: false });
          this._setPeerBase(serializeForSync(clone), this.identity.exportMap(clone, originalSnapshotNode), this._ticket());
        }
        if (startDiskSeeded && this._diskBaseTicket === startDiskTicket) {
          this._setDiskBase(captureForSaveAndComparison({ emitForSync: false }).forSave, this._ticket());
        }
      };
      document.addEventListener('clay:baseline-settled', this._settledHandler, { once: true });
    }
    // Exposed so a caller (and the tests) can await the point where the stream is
    // actually open, rather than counting microtasks behind the discovery request.
    this._ready = Promise.all([
      this.lane === 'live' ? loadEdit() : null,
      this._resolveProfile(),
    ]).then(() => {
      if (this.isDestroyed || this._startGen !== gen) return;
      this.connect();
    });
    // View-mode tabs are receive-only: saves are edit-gated upstream, so a
    // snapshot listener would never fire — skip registering it.
    if (this.lane === 'live') {
      this.listenForSnapshots();
      // One presence transport per document, chosen from the host's own answer, and
      // one sender behind it: the generic marker publishes through the store, so a
      // page target and a caret path never talk over each other.
      loadPresence().then((store) => this._startPresence(store, gen), () => {});
      this._saveSavedHandler = (event) => {
        this._saveEpoch++;
        // The file now holds what this save wrote: the disk lane's new base,
        // dated at the save's capture, which is when the document held these
        // bytes. A frame that applied after that capture is newer and keeps
        // the base. A save this instance never saw capture (there is none
        // today) counts as now.
        const ticket = this._saveTicket || this._ticket();
        this._saveTicket = 0;
        if (ticket > this._acceptedSaveTicket) this._acceptedSaveTicket = ticket;
        const bytes = edit ? edit.getLastSavedBytes() : null;
        if (bytes != null) this._setDiskBase(bytes, ticket);
        this._relayCommit(event?.detail?.captureId, bytes);
      };
      document.addEventListener('clay:save-saved', this._saveSavedHandler);
      // A 412 can arrive after this tab already merged the version that beat it:
      // the winner's relay overtook the refusal. The refusal then names a stamp
      // this tab already holds, and nothing else would ever release the hold.
      // Deferred a microtask so the conflict notice's own listener has shown the
      // bar before this hides it.
      this._saveConflictHandler = (event) => {
        const refusedBy = event.detail && event.detail.etag;
        if (!refusedBy) return;
        queueMicrotask(() => {
          if (this.isDestroyed) return;
          if (refusedBy !== lastSeenEtag()) return;
          edit?.conflictResolvedBySync(refusedBy);
          this._saveAfterMerge(pageMaybeDirty(), false);
        });
      };
      document.addEventListener('clay:save-conflict', this._saveConflictHandler);
    }
  }

  /**
   * Clean up resources without marking as destroyed
   * Used internally by start() to prevent double-connect
   */
  cleanup() {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    streamClosed();

    // Nothing feeds the roster once the stream is gone, so leaving the stack up
    // would show a list of people who may all have left. A roster that never
    // loaded has drawn nothing, and its queued frames are dropped with the
    // stream that fed them.
    rosterQueue = [];
    if (roster) {
      roster.presence.clear();
      roster.editingMarker.clear();
    }

    if (this._editing) {
      this._editing.stop();
      this._editing = null;
    }
    // Only this run's lease: a successor that already attached keeps its roster. A
    // broadcast session is stopped, not just detached, so its heartbeat, channel and
    // goodbye go with the session that opened them.
    if (this._presenceLease) {
      const transport = this._presenceLease;
      this._presenceLease = null;
      if (typeof transport.stop === 'function') transport.stop();
      else transport.detach();
    }
    this._lastRoster = null;

    if (this._snapshotHandler) {
      document.removeEventListener('clay:snapshot-ready', this._snapshotHandler);
      this._snapshotHandler = null;
    }

    if (this._saveSavedHandler) {
      document.removeEventListener('clay:save-saved', this._saveSavedHandler);
      this._saveSavedHandler = null;
    }

    if (this._saveConflictHandler) {
      document.removeEventListener('clay:save-conflict', this._saveConflictHandler);
      this._saveConflictHandler = null;
    }

    if (this._settledHandler) {
      document.removeEventListener('clay:baseline-settled', this._settledHandler);
      this._settledHandler = null;
    }

    this._queuedSend = null;

    // Cancel any pending frame and clear the queue. A morph already in
    // flight cannot be aborted; the isDestroyed check in _runPending guards
    // its post-morph rescheduling so the queue stops cleanly.
    if (this._rafHandle != null) {
      this._cancelFrame(this._rafHandle);
      this._rafHandle = null;
    }
    this._pendingHtml = null;
    this._pendingSeq = null;
    this._pendingIdentityMap = null;
    this._pendingBy = null;
    this._pendingExternal = null;
    this._handoff = null;
    this._handoffHeld = false;
    clearTimeout(this._holdRetryPeer);
    clearTimeout(this._holdRetryExt);
    this._holdRetryPeer = null;
    this._holdRetryExt = null;

    // A stopped run's startup check must not act on what it finds: the next
    // fetch, if any, owns the question.
    clearTimeout(this._startupRetry);
    this._startupRetry = null;
    clearTimeout(this._engineRetry);
    this._engineRetry = null;
    this._servedFetchId++;
  }

  /**
   * Auto-detect the current site file path from the URL
   * Returns the path including extension (e.g., card-canvas.html)
   *
   * Handles:
   * - /                           -> index.html
   * - /about.html                 -> about.html
   * - /about.htmlclay             -> about.htmlclay
   * - /about.html/dashboard       -> about.html  (SPA route stripped)
   * - /blog/app.htmlclay/settings -> blog/app.htmlclay  (SPA route stripped)
   */
  detectCurrentFile() {
    let pathname = window.location.pathname;

    if (pathname === '/') {
      return 'index.html';
    }

    pathname = pathname.replace(/^\//, '');

    const htmlMatch = pathname.match(/^(.*?\.html(?:clay)?)/);
    if (htmlMatch) return htmlMatch[1];

    return pathname;
  }

  /**
   * Choose the wire profile from what the host advertises.
   *
   * Absence of `sync` selects the legacy wire rather than disabling live sync. That is
   * deliberate transition debt: §10 says an undiscovered capability is not opened at
   * all, but both deployed first-party hosts ran live sync for a long time without
   * advertising anything, and refusing to sync with them would be a regression against
   * every published version. Once the unannounced hosts are gone, absence should mean
   * off. A malformed answer, a 404 or a timeout all land here too, and all mean legacy.
   */
  _resolveProfile() {
    if (!this._profilePromise) {
      this._profilePromise = resolveWireProfile().then((resolved) => {
        this._sharedData = resolved.sharedData;
        this._sharedSync = resolved.sharedSync;
        this._liveData = resolved.liveData;
        this._profile = resolved.profile;
        this._log(`Wire profile: ${resolved.profile.name}`);
        return resolved.profile;
      });
    }
    return this._profilePromise;
  }

  /**
   * Report a hold transition on one lane, once per episode in each direction,
   * so a listener can raise a "sync paused until you save" notice and take it
   * back down again. Never fires twice for the same state.
   *
   * @param {string} lane   'live' or 'external'
   * @param {boolean} isHeld
   * @param {Element} [el]  the local element that could not be merged
   */
  _setHeld(lane, isHeld, el) {
    const key = lane === 'live' ? '_heldLive' : '_heldExt';
    if (this[key] === isHeld) return;
    this[key] = isHeld;
    // A hold that clears leaves this tab back in step, but every stamp frame that
    // arrived while it was held was refused and nothing re-sends them: stamps are
    // broadcast on a save, not on a merge. So the tab would go on holding a stamp
    // from before the hold and have its next save refused over a conflict that has
    // already resolved itself, which is this notice crying wolf. Ask the host for
    // the current one instead. Only once BOTH lanes are clear, because one lane
    // resuming while the other still holds means the tab is still behind.
    if (!isHeld && !this._heldLive && !this._heldExt) {
      seedEtag({ fresh: true, clearIfMissing: false });
    }
    document.dispatchEvent(new CustomEvent(isHeld ? 'clay:sync-held' : 'clay:sync-resumed', {
      detail: { lane, el: el || null },
    }));
  }

  /**
   * Drop a stamp that arrived with no document (spec §6).
   *
   * ⚠️ This used to TAKE it, and taking it was wrong. A stamp says "disk is at this
   * version"; adopting it says "and I hold those bytes". Only the second claim
   * makes the next save safe, and a frame with no content is no evidence for it.
   *
   * The race is real and it loses work. A peer's save and that peer's snapshot
   * relay are two concurrent requests, so a stamp travelling on its own can arrive
   * first. This tab would record it while its DOM still held the older content,
   * and its next save would then pass If-Match and overwrite the save it had never
   * received. The hold flags cannot cover that: a lane holds when an incoming
   * change could NOT be merged, not when one has yet to arrive.
   *
   * So a stamp now rides on the snapshot the saving tab relays after its save
   * returns, and `_doApplyUpdate` records it only once that content has merged.
   * Nothing sends a bare stamp any more — hyperclay's was deleted, and it had
   * never reached anyone, because the relay library refuses a payload with no
   * document in it. This stays as the rule rather than as compatibility: if some
   * host does send one, dropping it is correct.
   *
   * @param {Object} data - The decoded frame
   * @returns {boolean} True when this was a stamp-only frame and nothing should morph
   */
  _applyEtagFrame(data) {
    if (typeof data.etag !== 'string' || typeof data.html === 'string') return false;
    this._log('Dropping a stamp that arrived with no document: nothing proves this tab holds those bytes');
    return true;
  }

  /**
   * Connect to the SSE endpoint
   * Uses native EventSource reconnection behavior
   */
  connect() {
    if (this.isDestroyed) return;

    // Whichever wire discovery selected. start() does not call connect() until the
    // profile is known, so this is never null on the normal path.
    const profile = this._profile || WIRE_PROFILES.legacy;
    const path = profile.streamPath(window.location.href, this.lane, this.resumeId, this.clientId);
    // Resolved against the real origin: a <base href> in the authored document
    // would otherwise point the sync stream at an origin the document chose.
    this.sse = new SyncStream(new URL(path, window.location.origin).href, {
      shared: this._sharedSync,
      sharedData: this._sharedData,
      documentURL: window.location.href,
      lane: this.lane,
      clientId: this.clientId,
      keepAliveWhenHidden: this._liveData && this.lane === 'live',
      // Only a response that named its own version gives this tab anything to
      // compare against. On a host that served none there is no provenance to
      // check, and the page keeps its pre-1.9.0 startup behavior.
      startupCheck: Boolean(servedDocumentEtag),
    });

    // A saved reader that a live session handed back with no bytes has nothing to
    // show and nothing to hand the next entry. Ask the host for the served file once,
    // as a view boot does, so an initial-edit exit that saved nothing still leaves a
    // receipt.
    if (this._acquireEmptySaved) {
      this._acquireEmptySaved = false;
      this._fetchServedDocument(undefined, { repair: true });
    }

    this.sse.onopen = () => {
      console.log('[LiveSync] Connected');
      if (this._editing) this._editing.reconnected();
      // A reconnect is a new connection: the host issues it a new presence session,
      // and nothing this tab sent under the old one may stand.
      if (presenceStore) presenceStore.reconnect();
      if (this.onConnect) this.onConnect();
    };

    // clay.live's fast lane rides this stream: report it open and closed, and pass
    // on its named events (stream-bridge.js).
    this.sse.addEventListener('open', () => streamOpened({ clientId: this.clientId, lane: this.lane }));
    this.sse.addEventListener('error', () => streamClosed());
    for (const type of LIVE_EVENTS) {
      this.sse.addEventListener(type, (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        streamEvent(type, data);
      });
    }

    // The cursor frame is a NAMED SSE event, so it never reaches onmessage and
    // never looks like data. Its `resync` flag says the server could not retain
    // everything between where this client resumed and the baseline it is
    // sending: what this page holds is stale in a way no replay will fix.
    //
    // The repair is the token-free fetch of the served document this class
    // already runs for a change too large to send, so noticing the flag is the
    // whole of the work.
    this.sse.addEventListener('cursor', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      // Two different reasons for one refetch. `resync` is the server saying it
      // could not replay everything between where this client resumed and the
      // baseline it is sending. `startup` is this tab's own check of the page
      // it was served: the file may have changed between that response and this
      // first subscription, and a stamped response is the only thing that can
      // tell. One fetch covers both: a body that names its own version is
      // compared whatever asked for it, and the flag only decides what an
      // unstamped answer may do.
      if (!data || (data.resync !== true && data.startup !== true)) return;
      const repair = data.resync === true;
      const startup = data.startup === true && !repair;
      console.log(
        repair
          ? '[LiveSync] Server could not replay everything; refetching the document'
          : '[LiveSync] Checking the served document against the version this tab was served'
      );
      // _fetchServedDocument, deliberately, and not _fetchExternalChange: that
      // one drops a fetch whose seq is at or below the external watermark, and
      // the cursor baseline routinely is, since it is the server's high-water
      // mark and our own last applied change may already have reached it. A
      // resync that skipped itself for being "already seen" would leave the page
      // permanently stale, which is the exact failure the flag exists to report.
      this._fetchServedDocument(typeof data.seq === 'number' ? data.seq : undefined, {
        repair,
        startup,
      });
    });

    // The roster is a NAMED event for the same reason the cursor frame is: a tab
    // with no listener for it never sees a bare data line, so every published
    // client is counted in the roster without being sent one. The frame is
    // handed on untouched — who is named is the host's decision, taken per
    // recipient from that recipient's own access, and nothing here can widen it.
    this.sse.addEventListener('presence', (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      takeRosterFrame(data);
      this._lastRoster = data;
      if (this._editing) this._editing.roster(data);
    });

    this.sse.onmessage = (event) => {
      const data = JSON.parse(event.data);

      // Staleness check + watermark advance run FIRST — before the notification
      // and error branches — against the high-water mark of seqs we've seen
      // (own echoes count too, see below). Notification frames now carry a seq,
      // so a conservative-cursor replay after reconnect must not duplicate a
      // toast or let a later stale data frame apply an older snapshot. `seq` is
      // optional for back-compat with older servers that don't stamp it.
      const { seq } = data;
      if (typeof seq === 'number' && seq <= this.lastSeenSeq) {
        this._log(`Dropping stale message: seq=${seq}, lastSeen=${this.lastSeenSeq}`);
        return;
      }

      // Advance the watermark before the notification/sender branches so that
      // our own save echoes count toward "seen". Without this, a later
      // buffered/replayed message with a smaller seq could rewind us past our
      // local edit.
      if (typeof seq === 'number') {
        this.lastSeenSeq = seq;
      }

      // External disk changes ride the notification channel as first-class
      // content (data.kind === 'external-change'). They apply silently —
      // Google-Docs-style — so a handled one never reaches the toast branch.
      if (data.type === "notification") {
        if (this._maybeAcceptExternalChange(data)) return;
        this.handleNotification(data);
        return;
      }

      // Handle error events from server
      if (data.error) {
        console.error('[LiveSync] Server error:', data.error);
        if (this.onError) this.onError(new Error(data.error));
        return;
      }

      if (this._applyEtagFrame(data)) return;

      const { html, sender, identityMap } = data;

      // Ignore own changes — already reflected in the DOM, nothing to morph
      if (sender === this.clientId) {
        this._log('Ignoring own message (sender matches clientId)');
        return;
      }

      // Guard against invalid html
      if (typeof html !== 'string') {
        console.error('[LiveSync] Received invalid html, ignoring');
        return;
      }

      const etag = typeof data.etag === 'string' && data.etag ? data.etag : null;

      // On a host that stamps saves, every landed save is relayed with its stamp.
      // A live-lane frame without one is an older client's preview of a save that
      // may yet be refused; the stamped frame follows if it lands.
      if (this.lane === 'live' && !etag && conditionalSaves()) {
        this._log(`Dropping an unstamped live frame on a stamping host (seq=${seq})`);
        return;
      }

      // A saved frame repeating the file this lane already applied: the receipt moves
      // onto the new stamp and the page is not touched, because the bytes on screen
      // ARE these bytes.
      if (this.lane === 'saved' && html === this._represented.bytes) {
        this._represented = Object.freeze({ bytes: html, etag: etag || null, seq: seq ?? null });
        recordEtag(etag);
        return;
      }

      // The common case, and it costs nothing: a peer saved bytes this tab has
      // already applied, so the frame's only news is the stamp. Taking it without
      // a morph is exactly as safe as taking it after one, because the baseline
      // being equal IS the proof that this tab holds those bytes.
      if (etag && html === this.lastHtml) {
        this._log(`Taking the stamp from a peer save of content already applied (seq=${seq})`);
        recordEtag(etag);
        if (edit && edit.isSaveConflicted()) {
          edit.conflictResolvedBySync(etag);
          this._saveAfterMerge(pageMaybeDirty(), false);
        }
        return;
      }

      this._log(`Received update from: ${sender} (my clientId: ${this.clientId}, seq=${seq})`);
      this.applyUpdate(html, seq, identityMap, etag, data.by);
      if (this.onUpdate) this.onUpdate({ html, sender, seq, identityMap, etag });
    };

    // Native EventSource auto-reconnects on transient errors
    // We just surface the status via callbacks
    this.sse.onerror = () => {
      if (this.sse.readyState === EventSource.CONNECTING) {
        console.log('[LiveSync] Reconnecting...');
      } else if (this.sse.readyState === EventSource.CLOSED) {
        console.log('[LiveSync] Connection closed');
        if (this.onError) this.onError(new Error('Connection closed'));
      }
      if (this.onDisconnect) this.onDisconnect();
    };
  }

  /**
   * Listen for snapshot-ready events from the save system.
   * Receives the full cloned documentElement and sends it.
   */
  listenForSnapshots() {
    this._snapshotHandler = (event) => {
      // Only a save's own capture names what the next landed save stored, and
      // when. A capture made for any other reason (the public captureForSave)
      // must not replace the payload that save will relay, nor move its ticket.
      if (!event.detail || event.detail.forSave !== true) return;
      // Every save captures through this event, before its request goes out,
      // so this is the moment the save's bytes were true of the document. A
      // save made during a frame's await is still a save, and it is newer than
      // that frame.
      this._saveTicket = this._ticket();

      const { documentElement: clone } = event.detail;
      if (!clone) return;

      // Capture both synchronously inside the event handler — captureSnapshot's
      // caller continues to mutate the clone (strip [save-remove], run hooks)
      // after dispatchEvent returns, so reading outerHTML and walking children
      // must happen now.
      this._log('snapshot-ready received, preparing to send');
      const html = serializeForSync(clone);
      const identityMap = this.identity.exportMap(clone, originalSnapshotNode);

      // The save that follows this capture stores these bytes, so this is the
      // content its stamp will describe. Held for _relayCommit, and overwritten
      // by the next capture, so it always names the save currently in flight.
      this._savedSnapshot = {
        html,
        identityMap,
        ticket: this._saveTicket,
        captureId: event.detail.captureId ?? null,
      };
    };

    document.addEventListener('clay:snapshot-ready', this._snapshotHandler);
  }

  /**
   * Send a landed save's HTML to the relay (single-flight).
   *
   * One POST on the wire at a time, with at most one newer payload queued; a
   * fresher snapshot replaces the queued one, because peers only ever need the
   * latest state. Two concurrent fetches could reach the server in either order,
   * and last-write-wins then stored the OLDER snapshot for every peer.
   */
  _enqueueSend(html, identityMap, etag = null) {
    // Same one-deep queue the in-flight case uses, for the same reason: peers only
    // ever need the newest state, so a fresher snapshot replaces the waiting one.
    // Sending before the profile is known would have to guess an address.
    if (!this._profile) {
      this._queuedSend = { html, identityMap, etag };
      this._resolveProfile().then(() => this._flushQueuedSend());
      return;
    }
    if (this._sendInFlight) {
      this._queuedSend = { html, identityMap, etag };
      return;
    }
    this._postUpdate(html, identityMap, etag);
  }

  _flushQueuedSend() {
    if (this.isDestroyed || this._sendInFlight) return;
    const queued = this._queuedSend;
    if (!queued) return;
    this._queuedSend = null;
    this._postUpdate(queued.html, queued.identityMap, queued.etag);
  }

  /**
   * Tell the other editors what this tab's save stored, and under which stamp.
   *
   * Runs on clay:save-saved, by which point the save response has already been
   * recorded, so `lastSeenEtag()` is the stamp for the bytes that just landed.
   * The content is `_savedSnapshot`, captured by that save's own snapshot-ready
   * event, never `lastHtml`: a capture is not relayed until its save lands, so
   * peers only ever see versions the host accepted, each descending from the one
   * before. A host that returns no stamp still gets the relay, without one.
   */
  _relayCommit(captureId = null, acceptedHtml = null) {
    if (this.isDestroyed) return;
    const etag = lastSeenEtag();

    const held = this._savedSnapshot;
    // A capture taken after this save's own is somebody else's content: relay it
    // under its own save's stamp, never this one's. The legacy null-id shape keeps
    // matching, so a fixture that names no capture on either side still relays.
    if (held && (held.captureId ?? null) !== (captureId ?? null)) {
      this._log('Skipping send - snapshot belongs to a different capture');
      return;
    }

    // The content this save stored, captured with it. Consumed rather than left
    // behind, so a save-saved with no capture of its own can never reuse an
    // older save's bytes under a newer stamp.
    const pending = held;
    this._savedSnapshot = null;

    // No captured snapshot means nothing here knows which bytes this save
    // stored, and §10 is explicit that a stamp must never travel on its own.
    if (!pending || typeof pending.html !== 'string') return;

    // The capture is taken before the document transforms run, and the page
    // projection is one of them: a page's relay has to carry what the file now
    // holds, not the editor DOM the capture saw. Everything outside the page's
    // own elements stays the captured sync domain, `no-save` regions included.
    let payload = pending;
    if (typeof acceptedHtml === 'string') {
      try {
        payload = pageRelay(pending, acceptedHtml, this.identity);
      } catch (err) {
        // Stale page bytes are worse than no relay: the save stays accepted, and
        // peers get the next one.
        this._log(`Skipping send - page relay failed: ${err && err.message}`);
        return;
      }
      if (!payload) {
        this._log('Skipping send - accepted capture has no page article');
        return;
      }
    }

    // The relay cites this save's stamp, so it declares the floor those bytes went out
    // at: the save adds the format marker on its way out (core/save-core.js runSave),
    // after the capture this relay was built from. At floor 0 the html is unchanged.
    const sent = acceptedBytesFor(captureId) ?? acceptedHtml;
    const floor = typeof sent === 'string' ? pageFormatFloor(sent) : 0;
    payload = { ...payload, html: asSent(withPageFormatFloor(payload.html, Math.max(knownPageFormatFloor(), floor)), sent) };

    // Skip only an unstamped repeat, judged against the base as it stood. A
    // landed save is news even when its bytes equal the last relay: "Keep mine"
    // can restore exactly those bytes after the peers moved on, and they must
    // hear it.
    const repeat = !etag && payload.html === this.lastHtml;

    // The host accepted these bytes, so every later accepted save descends from
    // them: they are the peer lane's base from this moment, not once the relay
    // returns. A frame whose morph ran after this capture installs its own,
    // newer base when its resources settle, and the ticket keeps it there.
    this._setPeerBase(payload.html, payload.identityMap, payload.ticket);

    if (repeat) {
      this._log('Skipping send - HTML unchanged');
      return;
    }
    this._enqueueSend(payload.html, payload.identityMap, etag || null);
  }

  _postUpdate(html, identityMap, etag = null, attempt = 0) {
    this._log(`Sending update (HTML length: ${html.length})`);

    this._sendInFlight = true;
    let retry = false;

    // Absolute against the real origin, so a <base href> in the page cannot
    // redirect the whole document to an origin the author picked.
    const profile = this._profile || WIRE_PROFILES.legacy;
    fetch(new URL(profile.relayPath, window.location.origin).href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [profile.documentHeader]: window.location.href,
        [PAGE_FORMAT_HEADER]: String(PAGE_FORMAT),
      },
      body: relayBody(profile, html, this.clientId, identityMap, etag)
    }).then(response => {
      if (!response.ok) {
        console.warn('[LiveSync] Save returned status:', response.status);
        retry = response.status >= 500 || response.status === 408 || response.status === 429;
      }
    }).catch(err => {
      console.error('[LiveSync] Save failed:', err);
      if (this.onError) this.onError(err);
      retry = true;
    }).finally(() => {
      this._sendInFlight = false;
      const queued = this._queuedSend;
      this._queuedSend = null;
      if (queued) {
        this._postUpdate(queued.html, queued.identityMap, queued.etag);
        return;
      }
      // The relay of a landed save is the only one peers get, so a transient
      // failure is retried a few times. A newer save queued meanwhile replaces
      // it: peers only need the latest.
      if (!retry || !etag || attempt >= 3 || this.isDestroyed) return;
      this._sendInFlight = true;
      setTimeout(() => {
        this._sendInFlight = false;
        if (this.isDestroyed) return;
        const newer = this._queuedSend;
        this._queuedSend = null;
        if (newer) this._postUpdate(newer.html, newer.identityMap, newer.etag);
        else this._postUpdate(html, identityMap, etag, attempt + 1);
      }, 500 * 2 ** attempt);
    });
  }

  /**
   * Take this run's presence transport and, behind its own capability, the generic
   * editing marker that publishes through it. `gen` is the start() this belongs to,
   * so a discovery that answers after a stop attaches nothing.
   */
  _startPresence(store, gen) {
    if (this.isDestroyed || this._startGen !== gen || this._presenceLease) return null;
    return store.connect({ send: (body) => this._postPresence(body) })
      .then((transport) => {
        if (this.isDestroyed || this._startGen !== gen) {
          if (typeof transport?.stop === 'function') transport.stop();
          else transport?.detach();
          return null;
        }
        this._presenceLease = transport || null;
        return hostSupports('presence-editing');
      }, () => false)
      .then((supported) => {
        if (!supported || this.isDestroyed || this._startGen !== gen || this._editing) return;
        return loadEdit().then((mod) => {
          if (this.isDestroyed || this._startGen !== gen || this._editing) return;
          this._editing = new mod.EditingSender({});
          if (this._presenceQuiesced) this._editing.stop();
          else {
            this._editing.start();
            this._editing.roster(this._lastRoster);
          }
        });
      });
  }

  /**
   * The relay's half of a transport: one request carrying the body the store built.
   * A page target arrives in the extended envelope, a legacy path exactly as it
   * always has, and the host decides by the same connection ownership either way.
   */
  _postPresence(body) {
    const url = new URL('/_/presence', window.location.origin);
    url.searchParams.set('client-id', this.clientId);
    return fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Document-URL': window.location.href },
      body: JSON.stringify(body),
    }).then((response) => response.ok, () => false);
  }

  /**
   * Route an external disk change (htmlclay watcher) out of the notification
   * path. Returns true when the notification was consumed — the caller must
   * then skip the toast branch entirely (silent UX).
   *
   * New servers mark these with data.kind === 'external-change' and embed the
   * disk HTML (omitted only when it exceeds the server's size cap). Old
   * servers send a bare warning with the watcher's fixed message shape; both
   * content-less forms fall back to a token-free fetch of the served page.
   */
  _maybeAcceptExternalChange(data) {
    if (this.lane !== 'live') return false;
    const info = data.data;
    if (info && info.kind === 'external-change') {
      if (typeof info.html === 'string') {
        this._enqueueExternal(info.html, data.seq, info.etag, info.by);
      } else {
        this._fetchExternalChange(data.seq);
      }
      return true;
    }
    if (typeof data.msg === 'string' && data.msg.endsWith('changed on disk outside this tab')) {
      this._fetchExternalChange(data.seq);
      return true;
    }
    return false;
  }

  _enqueueExternal(html, seq, etag, by) {
    if (typeof seq === 'number') {
      if (seq <= this._lastExternalSeq) {
        this._log(`Dropping replayed external change: seq=${seq}`);
        return;
      }
      this._lastExternalSeq = seq;
    }
    this._pendingExternal = {
      html,
      seq,
      saveEpoch: this._saveEpoch,
      etag: typeof etag === 'string' && etag ? etag : null,
      // Carried for the same reason the stamp is, and null on every disk frame
      // today: hyperclay stamps an author on the two live relays and nowhere
      // else, so a change that arrived from the filesystem has no author to
      // name. The slot carries it so a host that does stamp one is believed.
      by: by ?? null,
    };
    this._scheduleNextFrame();
  }

  /**
   * Content-less fallback: fetch the served document. The request carries no
   * Sec-Fetch-Dest: document, so htmlclay serves it token-free; the morph's
   * root-attribute veto keeps this tab's own token either way. The result is
   * stamped with the triggering notification's seq and dropped if a newer
   * external change (or our own save) landed while it was in flight.
   */
  _fetchExternalChange(seq) {
    if (typeof seq === 'number') {
      if (seq <= this._lastExternalSeq) return;
      this._lastExternalSeq = seq;
    }
    this._fetchServedDocument(seq);
  }

  /**
   * GET the served document and queue it as an external change. No watermark
   * check of its own — callers own that — so it can also re-materialize a
   * frame the epoch check refused (the fetched body is whatever disk holds
   * NOW, which is always safe to apply).
   *
   * `startup` marks the one fetch that asks whether the page this tab was served
   * is still what disk holds. It differs from every other reason to fetch in that
   * an unchanged answer must do NOTHING: no queue, no apply, no baseline move, no
   * event, no stamp change. A no-op is not a missed frame here, it is the answer.
   * A body that names its own version is judged the same way, and a repair that
   * carries one is no exception.
   *
   * @param {number} [seq]
   * @param {Object} [options]
   * @param {number} [options.attempt] - Bounded retry count, carried through
   *   every re-ask so a page under constant churn stops asking.
   * @param {boolean} [options.repair] - The server could not replay everything.
   * @param {boolean} [options.startup] - The served page's version check.
   */
  _fetchServedDocument(seq, { attempt = 0, repair = false, startup = false } = {}) {
    // Content already on its way in is about to change what this check would be
    // comparing, and its version question is newer than this one. Let it land and
    // ask again; a check that judged the pre-frame DOM would answer about a page
    // that no longer exists.
    if (
      startup &&
      (this._morphInFlight || this._pendingHtml != null || this._pendingExternal != null)
    ) {
      this._retryStartup(attempt);
      return;
    }
    const epoch = this._saveEpoch;
    const startGen = this._startGen;
    const seenSeq = this.lastSeenSeq;
    const applyGen = this._applyGen;
    const fetchId = ++this._servedFetchId;
    if (repair && typeof seq !== 'number') seq = this._lastExternalSeq;
    fetch(new URL(window.location.href), { cache: 'no-store' })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (this.isDestroyed || html == null) return;
        if (this._startGen !== startGen) return;
        const stamp = readServedStamp(html);
        // A version question is asked by the startup check and by a repair whose
        // body names its own version. Every other fetch — including an ordinary
        // fallback whose body happens to carry a stamp — is content, and keeps
        // the hold/retry behavior the external lane has always had.
        const versionCheck = startup || (repair && Boolean(stamp));
        if (versionCheck) {
          // A newer GET owns this question: whatever it is reading describes a
          // later moment than this response does. Except for a repair, which is
          // the only answer a page the server could not replay has: the newer
          // GET may yet fail, and dropping this body would leave nothing to ask
          // again. Refetch it at the watermark the page has reached instead,
          // under the same bounded count the retry always had.
          if (fetchId !== this._servedFetchId) {
            if (repair) {
              this._retryStartup(
                attempt + 1,
                { repair, startup },
                typeof seq === 'number' ? Math.max(seq, this._lastExternalSeq) : seq
              );
            }
            return;
          }
          // The page moved while the GET was in flight — an own save, a frame,
          // or a morph. The comparison this check exists to make is against a
          // stationary page, so ask again rather than judge a version the tab has
          // already left. A failed startup GET is the one exception below: it
          // changes nothing and has nothing to retry toward.
          if (
            epoch !== this._saveEpoch ||
            seenSeq !== this.lastSeenSeq ||
            applyGen !== this._applyGen ||
            this._morphInFlight ||
            this._pendingHtml != null ||
            this._pendingExternal != null
          ) {
            this._retryStartup(attempt + 1, { repair, startup }, seq);
            return;
          }
          if (!stamp) {
            // No stamp on the body means the host did not answer the version
            // question, and an answer nobody gave must not be invented: a
            // startup check keeps exactly the stamp it holds and applies
            // nothing, fetched or forgotten. A repair still has a page the
            // server could not replay, so it keeps its unstamped fallback.
            if (!repair) return;
          } else if (stamp === representedEtag()) {
            // The file this tab was served, and nothing to do about it. The exception is
            // a saved-lane reader with no bytes: it has nothing to show and nothing to
            // hand the next entry, and these bytes ARE the file it starts from, so the
            // receipt moves even though the DOM is already showing them. That is the
            // saved lane's acquisition, and it is also the startup check of a page booted
            // in view, which is the same no-bytes reader asking which file it represents.
            if ((repair || startup) && this.lane === 'saved') {
              this._represented = Object.freeze({ bytes: html, etag: stamp, seq: seq ?? null });
            }
            return;
          }
        } else if (typeof seq === 'number' && seq < this._lastExternalSeq) {
          // A newer external change superseded this one, and its own fetch will
          // queue a body. Except for a repair: that one exists because the server
          // said replay cannot fix this page, so if the newer fetch fails there is
          // nothing else coming. Refetch rather than drop the only repair.
          if (repair && attempt < 3) {
            this._fetchServedDocument(this._lastExternalSeq, { attempt: attempt + 1, repair, startup });
          }
          return;
        } else if (this._saveEpoch > epoch) {
          // An own save landed while the GET was in flight, so this body may
          // predate it. Save-response order proves nothing about disk-write
          // order — refetch for the newest bytes instead of dropping.
          if (attempt < 3) {
            console.log('[LiveSync] Refetching external change: own save landed mid-fetch');
            this._fetchServedDocument(seq, { attempt: attempt + 1, repair, startup });
          }
          return;
        }
        // The stamp, when the body carries one, is the version of THESE bytes:
        // the same claim the navigation made about its own response, read from
        // the body rather than from discovery, which answers about a later
        // moment than any response. A body without one keeps the old fallback
        // — the apply leaves the stamp alone and etag.js asks the host. No
        // author either way, for the same reason: a GET answers what disk holds,
        // not who put it there.
        this._pendingExternal = {
          html,
          seq,
          saveEpoch: epoch,
          etag: stamp,
          by: null,
          // Why this body was fetched, kept beside it so the drain and the apply
          // can still tell a version check from an ordinary change. A body that
          // named its own version was judged against this tab's version, and the
          // drain must go on judging it that way. The epoch refetch below
          // re-issues a fetch whose caller may have been a repair.
          fetchOptions: { repair, startup, attempt, versionCheck },
          // What the check was made against, so the drain can tell whether the
          // answer it holds still describes the page that asked.
          startGen,
          seenSeq,
          applyGen,
          fetchId,
        };
        this._scheduleNextFrame();
      })
      .catch((err) => {
        this._log('External-change fetch failed', err);
        // The watermark already advanced for this seq; leaving it there
        // would drop the change forever. Roll back so a replay or a later
        // duplicate can redeliver it. A startup check has no seq to roll back
        // and no state to restore: it simply did not happen.
        if (typeof seq === 'number' && this._lastExternalSeq === seq) {
          this._lastExternalSeq = seq - 1;
        }
      });
  }

  /**
   * Ask the served-document question again, coalesced and bounded.
   *
   * A version check that finds the page mid-morph, mid-queue or mid-change cannot
   * answer, and the answer is the whole point of the fetch, so it re-asks. The
   * single timer means three arrivals in one frame collapse to one re-ask, and
   * `attempt` counts only the re-asks that got as far as a GET, so a page that
   * never settles stops asking rather than looping forever.
   *
   * The re-ask carries the options and seq of the fetch that could not answer,
   * so a re-asked repair is still a repair and still owns its cursor seq.
   *
   * @param {number} [attempt]
   * @param {Object} [options] - The original fetch options.
   * @param {number} [seq]
   */
  _retryStartup(attempt = 0, options = { startup: true }, seq) {
    if (this.isDestroyed || attempt > 3) return;
    clearTimeout(this._startupRetry);
    this._startupRetry = setTimeout(() => {
      this._startupRetry = null;
      if (this.isDestroyed) return;
      if (this._morphInFlight || this._pendingHtml != null || this._pendingExternal != null) {
        this._retryStartup(attempt, options, seq);
        return;
      }
      this._fetchServedDocument(seq, { ...options, attempt });
    }, 16);
  }

  /**
   * Apply an update received from the server. Morphs the entire document.
   *
   * Updates land in a single pending slot. On each animation frame, the
   * latest pending payload is morphed once; intermediate updates that
   * arrived between frames are skipped because they would be replaced
   * milliseconds later anyway. Burst arrivals collapse to roughly one morph
   * per frame, so the receiver always shows current state instead of
   * playing back a backlog of stale snapshots.
   *
   * @param {string} html - Full document HTML
   * @param {number} [seq] - Optional monotonic seq from the server
   * @param {Object} [identityMap] - Optional element-identity map from sender
   * @param {string} [etag] - Optional version stamp for these bytes
   * @param {Object} [by] - Optional `{ id, name }` author stamp for these bytes
   */
  applyUpdate(html, seq, identityMap, etag, by) {
    if (this.isDestroyed) return;
    this._pendingHtml = html;
    this._pendingSeq = seq;
    this._pendingIdentityMap = identityMap;
    // A newer frame replacing this one takes its stamp with it, and that is
    // correct: the stamp belongs to bytes that are no longer what will apply.
    // Losing it costs one honest 412 later, which is the safe direction.
    this._pendingEtag = etag ?? null;
    this._pendingBy = by ?? null;
    this._scheduleNextFrame();
  }

  /**
   * Hand the saved lane's queue to a switch without stopping it: an apply already in
   * flight finishes, a frame that arrives meanwhile keeps its slot, and a repair the
   * host asked for stays owed. The protocol itself is a dynamic target, so a page that
   * never switches modes never fetches it.
   *
   * @param {Object} [options] - `{ signal, deadline }`
   * @returns {Promise<{represented: Object, reconcile: function(): Promise<void>, resume: function(), commit: function(): boolean}>}
   */
  prepareHandoff(options = {}) {
    if (this._handoff) return Promise.resolve(this._handoff);
    if (this.isDestroyed) return Promise.reject(new Error('LiveSync: stopped'));
    this._handoffHeld = true;
    if (this._rafHandle != null) {
      this._cancelFrame(this._rafHandle);
      this._rafHandle = null;
    }
    return import('./saved-handoff.js')
      .then(({ engineHandoff }) => engineHandoff(this, options))
      .then((handoff) => (this._handoff = handoff));
  }

  /**
   * Schedule the next-frame morph if one isn't already pending. Skipped when
   * a morph is in flight; the morph's post-completion check will reschedule
   * if a newer payload arrived during it.
   */
  _scheduleNextFrame() {
    if (this.isDestroyed || this._handoffHeld) return;
    if (this._rafHandle != null) return;
    if (this._morphInFlight) return;
    this._rafHandle = this._requestFrame(() => this._runPending());
  }

  /**
   * Drain one pending payload per frame. Errors are caught and logged so a
   * single failed morph does not stop the queue.
   *
   * Two slots feed this: peer frames and disk-sourced external changes. When
   * both are pending, the lower seq applies first so the two lanes land in
   * server order; the other stays queued for the next frame.
   */
  async _runPending() {
    this._rafHandle = null;
    if (this.isDestroyed) return;

    if (!loadedEngine()) {
      this._morphInFlight = true;
      try {
        await mergeEngine();
      } catch (error) {
        this._log('Merge engine failed to load', error);
        this._engineRetry = setTimeout(() => this._scheduleNextFrame(), 2000);
        return;
      } finally {
        this._morphInFlight = false;
      }
      if (this.isDestroyed) return;
    }

    const ext = this._pendingExternal;
    const opts = ext?.fetchOptions || null;
    // A startup check and a stamped repair are both version checks: each one
    // judges its body against the version this tab represents, and each one
    // answers "nothing to do" when the two agree. An ordinary fetch, and an
    // unstamped repair, keep the pre-existing content behavior.
    const versionChecked = Boolean(opts?.startup || opts?.versionCheck);
    let runExternal = false;
    if (ext != null) {
      if (versionChecked && this._pendingHtml != null) {
        // A version check and a peer frame have no order to compare: the peer
        // slot's seq is a subscription cursor, not the version of the bytes it
        // carries, and the answer is only worth anything once the frame it
        // would be judging has landed. Drain the peer first and ask again.
        runExternal = false;
      } else if (this._pendingHtml == null) {
        runExternal = true;
      } else {
        runExternal = !(
          typeof ext.seq === 'number' &&
          typeof this._pendingSeq === 'number' &&
          this._pendingSeq < ext.seq
        );
      }
    }

    if (runExternal) {
      this._pendingExternal = null;
      // Stale-at-drain checks: a newer external change already superseded
      // this frame, our own save landed after it was queued, or the page moved
      // past what a version check was made against.
      if (typeof ext.seq === 'number' && ext.seq < this._lastExternalSeq) {
        if (versionChecked && opts?.repair) {
          // The repair is the only answer a page the server could not replay
          // has, and the newer change's own fetch may yet fail. Ask again once
          // that content has drained instead of dropping it here — at the
          // current watermark, since the seq this body carried is already
          // superseded and a re-ask that kept it would only be dropped again.
          this._retryStartup((opts.attempt || 0) + 1, opts, this._lastExternalSeq);
        } else {
          this._log('Dropping superseded external change at drain');
        }
      } else if (versionChecked && ext.startGen !== this._startGen) {
        // The run that asked is gone: this body answers nobody.
        this._log('Dropping superseded startup check at drain');
      } else if (versionChecked && ext.fetchId !== this._servedFetchId) {
        // A newer GET is already re-reading the document, so this body is
        // superseded — unless it is a repair, the one answer a page the server
        // could not replay has. The newer GET may yet fail, so ask again at the
        // watermark the page has reached rather than discard it; the bounded
        // count stops a page under constant churn.
        if (opts?.repair) {
          this._retryStartup((opts.attempt || 0) + 1, opts, this._lastExternalSeq);
        } else {
          this._log('Dropping superseded startup check at drain');
        }
      } else if (
        versionChecked &&
        (ext.saveEpoch !== this._saveEpoch ||
          ext.seenSeq !== this.lastSeenSeq ||
          ext.applyGen !== this._applyGen)
      ) {
        // The page changed after this check was made. Comparing the version it
        // holds against a page that has since moved would answer about neither,
        // so ask again rather than apply a body that may already be obsolete.
        this._retryStartup((opts.attempt || 0) + 1, opts, ext.seq);
      } else if (versionChecked && ext.etag != null && ext.etag === representedEtag()) {
        // Checked once more at the moment of truth, because a frame that applied
        // while this waited can have brought the very version disk holds.
        this._log('Startup check found the same version: nothing to apply');
      } else if (!versionChecked && ext.saveEpoch !== this._saveEpoch) {
        // The epoch moved, but save-response order does not prove disk-write
        // order: the frame's content may still be newer than our save.
        // Refetch the served document — applying what disk holds NOW is
        // always safe — instead of dropping the frame. Mode rides along: a
        // repair that comes back this way is still a repair.
        console.log('[LiveSync] Refetching external change: own save landed after queue');
        this._fetchServedDocument(ext.seq, opts || {});
      } else {
        this._morphInFlight = true;
        try {
          await this._doApplyExternal(ext.html, ext.seq, ext.etag, ext.by, opts);
        } catch (err) {
          console.error('[LiveSync] applyExternal failed:', err);
        } finally {
          this._morphInFlight = false;
        }
      }
    } else {
      const html = this._pendingHtml;
      const seq = this._pendingSeq;
      const identityMap = this._pendingIdentityMap;
      const etag = this._pendingEtag;
      const by = this._pendingBy;
      this._pendingHtml = null;
      this._pendingSeq = null;
      this._pendingIdentityMap = null;
      this._pendingEtag = null;
      this._pendingBy = null;
      if (html == null) return;

      this._morphInFlight = true;
      try {
        await this._doApplyUpdate(html, seq, identityMap, etag, by);
      } catch (err) {
        console.error('[LiveSync] applyUpdate failed:', err);
      } finally {
        this._morphInFlight = false;
      }
    }

    // A newer payload may have arrived during the morph, or the other slot
    // is still holding one. Schedule another frame to drain it. Without
    // this, late-arriving updates would sit forever until the next
    // applyUpdate call.
    if (!this.isDestroyed &&
        (this._pendingHtml != null || this._pendingExternal != null)) {
      this._scheduleNextFrame();
    }
  }

  /** A ticket for one moment the document agreed with the file. Later is greater. */
  _ticket() {
    return ++this._agreeSeq;
  }

  /**
   * Set the disk lane's base to `bytes`, dated at `ticket`, unless a later
   * moment already set it. Every writer goes through here; see the field.
   */
  _setDiskBase(bytes, ticket) {
    if (ticket <= this._diskBaseTicket) return;
    this._diskBase = bytes;
    this._diskBaseTicket = ticket;
  }

  /**
   * The one writer of the peer lane's base. Keeps the newest moment: a save
   * accepted after a later frame's morph, or a frame whose resource wait
   * outlasts a later save, can no longer rewind it.
   */
  _setPeerBase(html, identityMap, ticket) {
    if (ticket < this._peerBaseTicket) return false;
    this._peerBaseTicket = ticket;
    this.lastHtml = html;
    this._lastIdentityMap =
      identityMap && typeof identityMap === 'object' && !Array.isArray(identityMap)
        ? identityMap
        : null;
    return true;
  }

  _requestFrame(cb) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(cb);
    }
    return setTimeout(cb, 16);
  }

  _cancelFrame(handle) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  /**
   * Merge an incoming frame (a peer's broadcast or the file's bytes) into the
   * live document with hyper-morph, and return its report.
   *
   * With a base, the merge is three-way: the base the lane last agreed on, this
   * tab's state captured in the base's serialization domain, and the frame.
   * Both sides' edits survive; where both changed the same words the frame
   * wins and the report records a conflict. With no base (a clean tab before
   * its first seed), the frame is taken two-way. Callers hold before this when
   * the tab is dirty and has no base.
   *
   * Authored ids (data-id, id) outrank synthetic ones on every side, so a map
   * can never pair an element against a different element that carries the
   * same authored id.
   *
   * @param {string} html - the incoming frame
   * @param {object|null} identityMap - the sender's synthetic ids, if any
   * @param {object} lane
   * @param {string|null} lane.base - the lane's merge base
   * @param {object|null} [lane.baseIdentityMap] - synthetic ids for the base
   * @param {() => Element} lane.captureLocal - this tab's state in the base's domain
   * @param {boolean} lane.synthetic - whether this tab's synthetic ids apply
   * @param {object} [lane.extra] - extra mergeDocument options (the disk lane's beforeApply)
   */
  async _mergeIncoming(html, identityMap, { base, baseIdentityMap = null, captureLocal, synthetic, source = 'peer', seq = null, etag = null, extra = {} }) {
    if (!loadedEngine()) await mergeEngine();
    // The first merge is what a reader downloads the ledger for: this frame is the
    // one that may produce a conflict, and nothing before it could have. A ledger
    // already in hand is read synchronously, so a tab that has merged once begins
    // its next apply in the caller's own tick, as it always did.
    const { beginApply, completeApply, failApply, beginLineageCapture } = conflictLedger() || await loadConflicts();
    let lineageCapture;
    const mergeDocument = (options) => {
      lineageCapture = beginLineageCapture(conflicts.list());
      try {
        const pending = loadedEngine().HyperMorph.mergeDocument({ ...options, lineage: lineageCapture.lineage });
        lineageCapture.returned();
        return pending;
      } catch (error) {
        lineageCapture.invalidate(conflicts.list());
        lineageCapture.finish(conflicts.list());
        throw error;
      }
    };
    const store = this.identity;
    // A frame may neither write these onto our root nor, by not carrying them,
    // take ours away. Returning false is hyper-morph's veto for both directions.
    const beforeAttributeUpdated = mergeVetoesAttr;
    const authored = uniqueAuthoredIdentity(new WeakMap());
    const sideIdentity = (map) =>
      isIdMap(map) ? { first: authored, map, then: authored } : authored;
    const localIdentity = synthetic
      ? (el) => authored(el) || store.idOf(originalSnapshotNode(el) || el) || null
      : authored;

    // Elements the frame names by authored id may carry a synthetic id in the
    // sender's map too, and this tab's element with that authored id has to
    // adopt it: a receiver on the older runtime keys its live elements by
    // synthetic id alone, and a frame from this tab that used a fresh synthetic
    // id for the same card would make that receiver replace the card, losing
    // its listeners and state. The frame is parsed here so the map can be
    // resolved against the same nodes hyper-morph will see; a Document is
    // taken as given, so nothing is parsed twice.
    let remote = html;
    const syntheticByAuthored = new Map();
    if (isIdMap(identityMap)) {
      remote = new DOMParser().parseFromString(html, 'text/html');
      canonicalizeReceived(remote);
      const imported = loadedEngine().HyperMorph.importMap(remote.documentElement, identityMap);
      for (const el of remote.querySelectorAll('[data-id], [id]')) {
        const id = authored(el);
        const synthetic = id && imported.get(el);
        if (synthetic) syntheticByAuthored.set(id, synthetic);
      }
    }
    remote = scratchpadsEmptied(remote);

    const common = {
      live: document,
      remote,
      ignore: (el) => el.matches(SYNC_IGNORE_SELECTOR),
      opaque: (el) => el.matches(FREEZE_SELECTOR) || (derivedActive() && ownsDerivedText(el)),
      remoteWins: (el) => el.matches(REMOTE_WINS_SELECTOR),
      ignoreAttribute: (el, name, merged) => isRootLocalAttr(el, name, merged) || (derivedActive() && isDerivedAttr(merged || el, name)),
      attributeMerge,
      protectFocusedValue: true,
      keepLiveOnly: source === 'peer',
      scripts: { mergeTags: loadedEngine().mergeTagRecognizers },
      hooks: { beforeAttributeUpdated },
      ...extra,
    };
    // The gate token is taken before the capture so a clear can never swallow
    // typing that lands during the merge. It is also how typing during the
    // await is noticed at all: the mutation feed is paused for the apply and
    // vacuumed on resume, so nothing else schedules a save for it.
    const dirty = this.lane === 'live' && pageMaybeDirty();
    const token = gateCaptureToken();
    // We MUST await: the Promise resolves once new external scripts have
    // loaded and run. Resuming mutations earlier would let late scripts' DOM
    // changes look like user edits and echo back out.
    let pending;
    let localRoot = null;
    let applyId = null;
    if (base == null) {
      pending = mergeDocument({
        ...common,
        base: null,
        local: { root: emptyScratchpads(captureLocal()), toLive: originalSnapshotNode },
        identity: { local: localIdentity, remote: sideIdentity(identityMap) },
      });
    } else if (!dirty) {
      // A clean tab has no local changes, so its own capture stands in for the
      // base too: base and local are one tree. Merging the lane's recorded
      // base against a fresh capture would instead report every place the
      // live DOM does not round-trip through serialization (a raw <noscript>,
      // a <div> the parser lifted out of a <p>, a <table> given a <tbody>) as
      // a local edit, and a clean autosave tab would write that "edit" back to
      // disk on every frame. Still three-way: merge tags keep their base for
      // the JSON merge, and hyper-morph's clean-side shortcuts apply.
      const localRoot = emptyScratchpads(captureLocal());
      const baseDoc = localRoot.ownerDocument;
      if (baseDoc.documentElement !== localRoot) baseDoc.replaceChild(localRoot, baseDoc.documentElement);
      pending = mergeDocument({
        ...common,
        base: baseDoc,
        local: { root: localRoot, toLive: originalSnapshotNode },
        fastPath: true,
        identity: {
          base: localIdentity,
          local: localIdentity,
          remote: sideIdentity(identityMap),
        },
      });
    } else {
      const captured = captureLocal();
      // Download my copy serializes the page as it was, painted values included;
      // the merge itself needs them stripped.
      const recoveryRoot = captured.cloneNode(true);
      localRoot = emptyScratchpads(captured);
      applyId = beginApply({
        source, seq, etag, root: localRoot, recoveryRoot,
        domain: source === 'disk' ? 'save' : 'sync',
      });
      try {
        pending = mergeDocument({
          ...common,
          base: scratchpadsEmptied(base),
          local: { root: localRoot, toLive: originalSnapshotNode },
          identity: {
            base: sideIdentity(baseIdentityMap),
            local: localIdentity,
            remote: sideIdentity(identityMap),
          },
        });
      } catch (err) {
        failApply(applyId, err);
        throw err;
      }
    }
    // The apply itself ran synchronously inside mergeDocument; only resource
    // loads are still pending. This is the moment the frame's bytes were true
    // of the document, so the lane dates its base here, not after the await:
    // a save that captures during the wait is newer than this frame.
    const ticket = this._ticket();
    this._morphTicket = ticket;
    let report;
    try {
      report = await pending;
    } catch (err) {
      lineageCapture.invalidate(conflicts.list());
      try {
        if (applyId) failApply(applyId, err, { ticket });
      } finally {
        lineageCapture.finish(conflicts.list());
      }
      throw err;
    }
    const typedDuringWait = gateCaptureToken().gen !== token.gen;

    // What the frame won over this tab's unsaved edits goes to the ledger with
    // the clone the merge read as "mine". Earlier losses live in the ledger,
    // not in the page's dirty state.
    let conflictIds;
    try {
      lineageCapture.prepareComplete(report, conflicts.list());
      conflictIds = applyId ? completeApply(applyId, report.conflicts, { ticket }) : [];
    } finally {
      lineageCapture.finish(conflicts.list());
    }
    if (this.lane === 'live' && report.localDiverged) {
      gateMarkDirty();
    } else if (dirty && !report.localDiverged) {
      gateClearIfUnchanged(token);
    }
    // Synthetic ids converge: every live element the frame named takes the
    // sender's id, whether the frame named it by that id or by an authored id
    // the sender's map also covers. Never an authored data-id or id itself.
    const mapIds = new Set(isIdMap(identityMap) ? Object.values(identityMap) : []);
    for (const [el, id] of report.identities) {
      const synthetic = mapIds.has(id) ? id : syntheticByAuthored.get(id);
      if (synthetic) store.adopt(el, synthetic);
    }
    return { report, ticket, typedDuringWait, conflictIds };
  }

  /**
   * The automatic save a merge may owe: the merge kept this tab's edits
   * (convergence), or the person typed during the awaited apply (the mutation
   * feed was paused, so nothing else will schedule it). Only where autosave is
   * on.
   */
  _saveAfterMerge(diverged, typedDuringWait) {
    if (!(diverged || typedDuringWait)) return;
    if (!autosaveActive()) return;
    if (edit) edit.savePageThrottled();
    else notInEditModeResult();
  }

  /**
   * Actual morph work. Do not call directly. Use applyUpdate() so calls
   * pass through the rAF queue and don't overlap.
   * @param {string} html
   * @param {number} [seq]
   * @param {Object} [identityMap]
   * @param {string} [etag]
   * @param {Object} [by]
   * @returns {Promise<void>}
   */
  async _doApplyUpdate(html, seq, identityMap, etag, by = null) {
    // Another version of the document is not a change to this one, whichever lane
    // or slot it arrived on: a peer snapshot merges no more than a saved frame does,
    // and nothing applies after the first refusal. The guard holds the saves and
    // asks the notice to offer a reload.
    if (upgradeReplaces(html)) {
      await stopForUpgrade();
      return;
    }
    if (this.lane === 'live' && !edit) await loadEdit();
    this._log('applyUpdate - pausing mutations and morphing');
    this.isPaused = true;

    // Preserve scroll position: a remote edit that inserts or removes content
    // above the viewport would otherwise cause a visible jump. Capturing here
    // and restoring after the morph keeps the viewport stable. Browser
    // scroll-clamping handles the case where the document is now shorter.
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Pause mutation observer so morph doesn't trigger autosave
    Mutation.pause();
    pauseGate();

    let diverged = false;
    let typedDuringWait = false;
    let stamped = false;
    try {
      // Hold the whole frame only when this tab has unsaved edits and no
      // baseline to merge them against (the first frame of a fresh
      // connection). Nothing morphs and no baseline moves; the tab keeps its
      // local state. Deliberately NO proactive save here: a hold can fire on a
      // manual-save page, which must never auto-write. The retry re-queues the
      // same frame; the slot-empty check and the drain's staleness checks drop
      // it once superseded.
      if (this.lane === 'live' && pageMaybeDirty() && this.lastHtml === null) {
        console.log('[LiveSync] Holding incoming update: unsaved local edits and no baseline to merge against');
        this._setHeld('live', true, null);
        const epochAtHold = this._saveEpoch;
        const seenAtHold = this.lastSeenSeq;
        clearTimeout(this._holdRetryPeer);
        this._holdRetryPeer = setTimeout(() => {
          this._holdRetryPeer = null;
          if (this.isDestroyed || this._pendingHtml != null) return;
          if (this._saveEpoch !== epochAtHold) return;
          if (this.lastSeenSeq !== seenAtHold) return;
          this._pendingHtml = html;
          this._pendingSeq = seq;
          this._pendingIdentityMap = identityMap;
          this._pendingBy = by;
          this._scheduleNextFrame();
        }, 3000);
        return;
      }

      this._setHeld('live', false);

      // The frame merged, so this tab may take its stamp — but not yet. Adopting
      // the stamp and applying the bytes have to be the same event, and they only
      // are once the apply has actually happened. The morph below is awaited and
      // can reject, and a stamp recorded before it would sit on the old DOM with
      // nothing to undo it, so the next save would pass If-Match and replace a
      // version this tab never received. It is recorded after the await, beside
      // `lastHtml`, on the one path where the bytes definitely landed.
      //
      // The hold path above returns before that point, deliberately. A held tab is
      // knowingly missing what disk holds, and a stamp there would let its next
      // save replace that change with nobody told.

      const { report, ticket, typedDuringWait: typed, conflictIds } = await this._mergeIncoming(html, identityMap, {
        base: this.lastHtml,
        baseIdentityMap: this._lastIdentityMap,
        captureLocal: () => captureSnapshot({ flushUndo: false }),
        synthetic: true,
        source: 'peer',
        seq,
        etag,
      });
      diverged = report.localDiverged;
      typedDuringWait = typed;
      repaintDerived();

      // Restore viewport. Done after morph so layout has settled.
      window.scrollTo(scrollX, scrollY);

      // Only mark lastHtml after a successful morph so that a failed apply
      // doesn't desync our state and cause the next outbound save to be
      // mistakenly skipped as "unchanged". Note: lastSeenSeq is advanced at
      // receive time (in onmessage) so the staleness check covers own-save
      // echoes even when they don't reach this point.
      //
      // lastHtml is the RAW incoming frame even after a merge that kept local edits. A
      // patched serialization would poison the next frame's diff base (frame
      // two of a burst would read the protected section as clean and clobber
      // it) and could dedupe away the convergence send. Convergence is driven
      // by the explicit save below instead.
      // A save captured during this frame's resource wait and already accepted
      // is newer than the frame: it keeps the base, and its stamp too.
      this._setPeerBase(html, identityMap, ticket);
      this._applyGen++;

      // The stamp of section 6, taken now that the bytes it describes are the
      // bytes this tab is holding. Same line of reasoning as lastHtml directly
      // above, and deliberately the same moment: the two claims a page makes
      // when it adopts a stamp are "the host stores this version" and "I hold
      // it", and only the second one is this tab's to make.
      if (!(this._acceptedSaveTicket > ticket)) {
        if (typeof etag === 'string' && etag) {
          recordEtag(etag);
          stamped = true;
        } else {
          // Content nobody stamped: the DOM no longer holds the version this
          // tab was claiming, so the claim goes. A save accepted since this
          // frame captured keeps its own newer stamp.
          forgetRepresentedEtag();
        }
      }

      // Cross-lane baseline: the DOM now holds this frame's content, but the
      // DISK baseline (lastSavedContents) still describes pre-frame state. A
      // later dirty disk apply diffing against that stale baseline would
      // classify everything this frame brought as unsaved local edits and
      // splice it over newer disk bytes. A verified-clean apply is the one
      // moment the DOM is truthfully "as if saved", so the comparison
      // baseline advances here too. Skipped whenever the gate reports dirty
      // (including typing that arrived during the morph's async wait, which
      // must never be recorded as saved).
      //
      // The same moment moves the DISK LANE's base: the document now agrees
      // with what the file holds (a peer frame carries committed content, and
      // this tab kept nothing of its own over it), so the file's bytes, as this
      // tab would save them, are the disk lane's new base. Without this the
      // disk lane kept a base from before the peer's edit, and the next disk
      // frame read the peer's content as this tab's own edit and resurrected it
      // over a newer revert. Never taken over unsaved local changes: a dirty
      // gate or a diverged merge leaves the base where it was, and the
      // convergence save moves it once the merge is on disk.
      //
      if (
        this.lane === 'live' &&
        !diverged &&
        !pageMaybeDirty()
      ) {
        const { forSave, forComparison, forDirty } = captureForSaveAndComparison({
          emitForSync: false,
          flushUndo: false,
        });
        edit.setLastSavedBaselines(forComparison, forDirty);
        this._setDiskBase(forSave, this._ticket());
      }

      // Announce that a remote morph just landed, so document-level listeners
      // that are deaf to Mutation.pause (e.g. the hypercms form panel) can
      // re-sync. Fires only on a successful apply, and only for genuine remote
      // morphs — own-sender and stale-seq echoes are filtered upstream in
      // onmessage before applyUpdate is ever called. Covers every SSE morph
      // source (peer edit, version restore, body-swap) since they all funnel
      // through this single choke point.
      //
      // `source` is what lets a listener tell the two apply paths apart. clay.wire
      // waits for a DISK frame to call an agent's write landed, and another tab's
      // edit arriving first would otherwise report the wrong bytes as delivered.
      //
      // `by` is the server's answer about who sent these bytes, and it is on the
      // event rather than on the frame's arrival for one reason: a frame that held
      // returns above without reaching here, so nothing can name an author for a
      // change this tab never took. Null on every frame the host did not stamp.
      //
      // A frame on the SAVED lane is a file, not a preview: only the live lane
      // carries keystrokes nobody saved. Tagging both as `peer` made a view-mode
      // reader, which drops previews, ignore every save on a page that also names
      // `sync`. `lane` names the lane the frame came from either way.
      if (this.lane === 'saved') this._represented = Object.freeze({ bytes: html, etag: etag || null, seq: seq ?? null });

      document.dispatchEvent(new CustomEvent('clay:sync-applied', {
        detail: { seq, source: this.lane === 'saved' ? 'disk' : 'peer', lane: this.lane, by: by || null, html, report, unresolved: this.unresolvedConflicts, conflictIds }
      }));
    } finally {
      this._log('applyUpdate - morph complete, resuming mutations');
      Mutation.resume();
      resumeGate();
      // Defer past microtask boundary — MutationObserver callbacks fire before
      // this, so isPaused catches any stray snapshots from the morph itself.
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.isPaused = false;
    }

    // Convergence: a merge that kept this tab's edits produced a state (our
    // edits + their frame) that exists only in this DOM. Push it out explicitly
    // — the morph ran under Mutation.pause, so no autosave was triggered, and a
    // pending autosave debounce may already have fired mid-flight. Runs after
    // isPaused is lifted so the convergence save's relay reaches peers.
    // Only where autosave is on: a manual-save page must never auto-write, so
    // there the merge stays local, still dirty, until the person saves.
    if (stamped) edit?.conflictResolvedBySync(etag);
    this._saveAfterMerge(diverged, typedDuringWait);
  }

  /**
   * Apply an external disk change to this edit-mode tab. Same shape as
   * _doApplyUpdate with two differences: the incoming document is save
   * domain, so the merged document is edit-mode ACTIVATED before it applies
   * (inert attribute forms flipped live, as boot does on page load); and on a
   * clean apply the
   * save baseline advances to a post-morph local comparison capture — true by
   * construction, where any wire-derived baseline permanently mismatches
   * (token, doctype, transform and parse divergences). A dirty apply leaves
   * both baselines alone so the convergence save below sees its own changes
   * (and, via the save pipeline, refreshes both). A clean apply also rebuilds
   * lastHtml, because the peer lane's diff base must track what the DOM now
   * holds or a later dirty peer apply misclassifies this frame's content as
   * local edits.
   */
  async _doApplyExternal(html, seq, etag = null, by = null, fetchOptions = null) {
    // Another version of the document is not a change to this one: it does not
    // merge, and after it no later frame is applied either. The guard holds the
    // saves and asks the notice to offer a reload.
    if (upgradeReplaces(html)) {
      await stopForUpgrade();
      return;
    }
    if (this.lane === 'live' && !edit) await loadEdit();
    const priorDisk = this._diskBase;
    this._log(`applyExternal - external disk change (seq=${seq})`);
    this.isPaused = true;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    Mutation.pause();
    pauseGate();

    let diverged = false;
    let typedDuringWait = false;
    let stamped = false;
    try {
      // Hold the whole frame only when this tab has unsaved edits and no
      // baseline to merge them against. Lane-guarded like the peer path: a
      // view-mode tab's gate can still read dirty (a visitor typing into a
      // [persist] field), and it must take disk frames, never hold them.
      // Nothing morphs, no baseline moves, and deliberately NO proactive save
      // (a hold can fire on a manual-save page, which must never auto-write).
      // The frame's seq watermark has already advanced, so nothing redelivers
      // it on its own; the retry re-queues it with the epoch captured NOW, so
      // the drain's epoch check turns an intervening own save into a refetch
      // of current disk instead of a stale re-apply, and the seq check drops
      // it once a newer external change supersedes it.
      if (this.lane === 'live' && pageMaybeDirty() && this._diskBase === null) {
        console.log('[LiveSync] Holding external change: unsaved local edits and no baseline to merge against');
        this._setHeld('external', true, null);
        // A version check holds nothing: it has no frame to re-queue, and the
        // body it fetched describes disk as of its GET rather than a version
        // anyone named. Re-queueing those bytes would apply them over an edit
        // the person has not saved yet, and could even put a version back over
        // one a newer peer has already passed. So the hold takes the ordinary
        // three-second wait and then fetches afresh: whatever disk holds by then
        // is answered against the page as it stands by then. The hold is not a
        // retry attempt, so a person who stays dirty never exhausts the bounded
        // retries; the options ride along so a repair is still a repair.
        if (fetchOptions?.startup || fetchOptions?.versionCheck) {
          clearTimeout(this._holdRetryExt);
          this._holdRetryExt = setTimeout(() => {
            this._holdRetryExt = null;
            if (this.isDestroyed) return;
            const currentSeq =
              typeof seq === 'number' ? Math.max(seq, this._lastExternalSeq) : seq;
            this._retryStartup(0, fetchOptions, currentSeq);
          }, 3000);
          return;
        }
        const epochAtHold = this._saveEpoch;
        clearTimeout(this._holdRetryExt);
        this._holdRetryExt = setTimeout(() => {
          this._holdRetryExt = null;
          if (this.isDestroyed || this._pendingExternal != null) return;
          this._pendingExternal = { html, seq, saveEpoch: epochAtHold, etag, by };
          this._scheduleNextFrame();
        }, 3000);
        return;
      }

      this._setHeld('external', false);

      // All three sides are in the save domain, the file's own inert form: the
      // bytes this tab last saved or applied, this tab's save capture, and the
      // file. The merged document is activated for edit mode before it is
      // applied, exactly as boot would have, so every node, local or incoming,
      // goes live from its own saved form.
      const { report, ticket, typedDuringWait: typed, conflictIds } = await this._mergeIncoming(html, null, {
        base: this._diskBase,
        captureLocal: () => captureForMerge().saveClone,
        synthetic: false,
        source: 'disk',
        seq,
        etag,
        extra: { beforeApply: (doc) => activateIncomingDoc(doc.documentElement, this.lane) },
      });
      diverged = report.localDiverged;
      typedDuringWait = typed;
      repaintDerived();
      // The file holds these bytes and this tab has applied them. Dated at the
      // apply, so a save that captured during the await keeps its newer base.
      this._setDiskBase(html, ticket);

      window.scrollTo(scrollX, scrollY);

      // The stamp of section 6, adopted here and nowhere else: this is the moment
      // the bytes it describes reached this tab. It is taken after a merge that
      // kept local edits too, because the merge still incorporates the disk
      // bytes, and the convergence save at the bottom needs a stamp the host
      // will accept or the merge is refused and lost.
      //
      // A frame with no stamp (an older host, or the content-less fetch fallback
      // on a host that does not answer the version question) leaves this alone,
      // and the listener in etag.js falls back to asking the host. A save
      // accepted since this frame captured already recorded a newer stamp, and
      // this body, older than that save, must not rewind it — nor clear it.
      if (!(this._acceptedSaveTicket > ticket)) {
        if (typeof etag === 'string' && etag) {
          recordEtag(etag);
          stamped = true;
        } else {
          forgetRepresentedEtag();
        }
      }

      if (
        this.lane === 'live' &&
        !diverged &&
        !pageMaybeDirty()
      ) {
        // Clean apply: the DOM now IS the disk state, so a local comparison
        // capture of it is the truthful baseline. The next no-op save skips,
        // beforeunload stays quiet. The dirty re-check matters: typing that
        // arrived during the morph's async wait would otherwise be captured
        // into the baseline and recorded as saved without reaching disk.
        edit.setLastSavedBaselines(...pairedBaseline());
        edit.setUnsavedChanges(false);

        // Cross-lane baseline: the PEER diff base (lastHtml) would otherwise
        // still describe pre-frame state, and a later dirty peer apply would
        // classify this frame's content as local edits and splice it over a
        // newer peer frame. Rebuild it exactly the way the send pipeline
        // does, so it stays in the snapshot domain.
        const clone = captureSnapshot({ flushUndo: false });
        this._setPeerBase(serializeForSync(clone), this.identity.exportMap(clone, originalSnapshotNode), ticket);
        this._applyGen++;
      }

      if (this.lane === 'saved') this._represented = Object.freeze({ bytes: html, etag: etag || null, seq: seq ?? null });

      document.dispatchEvent(new CustomEvent('clay:sync-applied', {
        detail: {
          seq,
          source: 'disk',
          etag: typeof etag === 'string' && etag ? etag : null,
          by: by || null,
          // The bytes now on disk, exactly as they arrived. The source map models them
          // so this tab's next save copies from the file somebody else just wrote.
          html,
          report,
          conflictIds,
          unresolved: this.unresolvedConflicts,
        }
      }));
    } finally {
      this._log('applyExternal - morph complete, resuming mutations');
      Mutation.resume();
      resumeGate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.isPaused = false;
    }

    // Convergence: disk holds the writer's version, this DOM holds the merge
    // (our edits + their bytes). The baseline was left pre-external, so the
    // save sees both as changes and writes the merge back. Only where
    // autosave is on, as in the peer lane.
    if (stamped) edit?.conflictResolvedBySync(etag);
    this._saveAfterMerge(diverged, typedDuringWait);
    // A disk frame from a writer that does not paint (an agent, the data API)
    // changes records and leaves the painted values as they were. If the page's
    // repainted values differ from them once the timer fires, one tab saves so
    // the bytes on disk heal. A writer that paints is left alone.
    if (priorDisk != null && paintSignatureOfHtml(priorDisk) === paintSignatureOfHtml(html)) {
      if (edit) edit.schedulePaintHeal(() => (this._diskBase == null ? null : paintSignatureOfHtml(this._diskBase)));
    }
  }

  /**
   * Handle a notification message from the server
   * Shows a toast and emits an event for custom handling
   * @param {Object} data - { msgType, msg, action?, persistent? }
   */
  handleNotification({ msgType, msg, action, persistent, data }) {
    this._log(`Notification received: ${msgType} - ${msg}`);

    // The data-loss guard rides this channel but is NOT a toast — the panel
    // module handles it via the clay:notification event below.
    const isDataLoss = msgType === 'data-loss';

    // Show toast if available
    if (!isDataLoss) {
      if (persistent && window.toastPersistent) {
        window.toastPersistent(msg, msgType);
      } else if (window.toast) {
        window.toast(msg, msgType);
      } else {
        console.log(`[LiveSync] Notification: ${msg}`);
      }
    }

    // Emit event for custom handling (e.g., reload button, data-loss chip)
    document.dispatchEvent(new CustomEvent('clay:notification', {
      detail: { msgType, msg, action, persistent, data }
    }));

    // Call notification callback if set
    if (this.onNotification) {
      this.onNotification({ msgType, msg, action, persistent, data });
    }
  }

  /**
   * Stop LiveSync and clean up resources
   * Can call start() again to restart
   */
  stop() {
    this.cleanup();
    this.isDestroyed = true;
    console.log('[LiveSync] Stopped');
  }

  /**
   * The lifecycle participant for this module: the lease a live switch prepares,
   * enables at the commit and disposes at the exit. Its body is in the edit-only
   * chunk, so a reader never loads it.
   */
  editParticipant() {
    return loadEdit().then((mod) => mod.syncParticipant(this));
  }
}

// The bytes the host just accepted, exactly as they went out, and the capture they came
// from: a save adds the format marker on its way out, so only these say the floor.
let lastAccepted = null;
onSaveAccepted((html, accepted) => {
  lastAccepted = typeof html === 'string' ? { html, captureId: accepted?.captureId ?? null } : null;
});

const acceptedBytesFor = (captureId) =>
  lastAccepted && (lastAccepted.captureId ?? null) === (captureId ?? null) ? lastAccepted.html : null;

// A relay re-serializes the DOM, and that spelling is not the file's: a bare empty
// attribute comes back as `=""`. When the relay describes the same document the host
// stored, it carries the stored bytes themselves, so a peer reads what a reload would.
// One that holds regions the file leaves out (`no-save`) keeps its own serialization.
function asSent(html, sent) {
  if (typeof sent !== 'string' || sent === html) return html;
  const root = (source) => new DOMParser().parseFromString(source, 'text/html').documentElement;
  return root(html).isEqualNode(root(sent)) ? sent : html;
}

// Singleton instance
const liveSync = new LiveSync();

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined' && !entering) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => liveSync.start());
  } else {
    liveSync.start();
  }
}

// Export for the clayjs module system. The class itself is exported so
// tests can create fresh instances without driving the singleton's
// EventSource/snapshot wiring.
const morph = (oldEl, newEl, options) => mergeEngine().then(({ morph }) => morph(oldEl, newEl, options));
export { liveSync, LiveSync, morph, WIRE_PROFILES, conflicts, SYNC_IGNORE_SELECTOR, REMOTE_WINS_SELECTOR };
export default liveSync;
