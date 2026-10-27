// clay.live(name): this page's <script type="application/json" merge="name"
// clay="live"> tag as a live object. The store (src/live/store.js) holds the
// value in memory and never writes the tag. This module carries the value in and
// out at file speed: it writes the value into every capture, confirms this tab's
// ops when the save that carried them is accepted (never from an incoming frame),
// and takes the values other tabs saved or relayed from each live-sync frame.

import { contains, parseBy, frameSet, descendants, unionRanges, formatBy } from "../live/provenance.js";
import { createStore } from "../live/store.js";
import { serializeLive, stampOf, parseStamp, textHash } from "../live/ops.js";
import { capturePageState, onSnapshot } from "../core/snapshot.js";
import { onSaveAccepted, onSaveAttempt, onSaveOutcome, isSaveInProgress } from "../core/save-core.js";
import { savePageForce, baselineSettled, isSaveConflicted, autosaveIsSuspended } from "../core/save.js";
import { withKeepalive } from "../core/save-core.js";
import { isEditMode } from "../core/is-edit-mode.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";
import { createCheckpoints } from "../live/checkpoint.js";
import { parseJsonRelaxed } from "../vendor/hyper-morph-json.vendor.js";
import * as hostMeta from "../core/host-meta.js";
import { createFastLane } from "../live/fast-lane.js";
import { createSaveHistoryRecovery, RECOVERY_WINDOW_MS } from "../live/save-history.js";
import { serverTransport } from "../live/server-lane.js";
import { localTransport, localLaneSupported } from "../live/local-lane.js";
import { captureYValue } from "../page/ybind/parts.js";
import { lastSeenEtag, recordEtag } from "../core/etag.js";

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const entries = new Map();

const captureAuthor = 'save_' + [...crypto.getRandomValues(new Uint32Array(4))].map((n) => n.toString(16).padStart(8, '0')).join('');
let captureNumber = 0;
let anonymousCaptures = 0;

export const HOLD_MS = 45_000;

function lineageOf(element) {
  const at = parseStamp(element.getAttribute('live-at'));
  if (!at || at.hash !== hashOfText(element.textContent)) return null;
  const raw = element.getAttribute('live-by');
  const by = raw === null ? null : parseBy(raw);
  if (raw !== null && !by) return null;
  if (by && by.v !== 2) return { disk: true };
  return { epoch: at.epoch, seq: at.seq, frames: frameSet(by), ancestors: descendants(by) };
}

function captureLineage(entry, forSave) {
  const base = entry.leftAt;
  if (!base || base.disk) return null;
  const pending = fast?.pendingFrames(entry.store.name, base, { reserve: forSave }) ?? { frames: [], complete: true };
  if (!pending.complete) return null;
  const frames = unionRanges(base.frames ?? [], pending.frames);
  const ancestors = base.ancestors ?? [];
  const text = serializeLive(entry.store.value);
  const key = JSON.stringify([base.epoch, base.seq, frames, ancestors, entry.store.mark, text]);
  if (entry.capture?.key === key) return entry.capture.value;
  const by = { v: 2, frames, ancestors, capture: [captureAuthor, captureNumber + 1] };
  const encoded = formatBy(by);
  const value = encoded ? { at: stampOf(base.epoch, base.seq, text), by: encoded } : null;
  entry.capture = { key, value };
  return value;
}


// Pins for the captures this tab has made but not settled, keyed by the capture
// id the core announced at clay:snapshot-ready. Each value is a Map of store
// name -> { mode, mark, canonical, at, by, key, ids, ... }. At most two survive:
// the capture whose exact body is on the wire, and the newest capture not yet
// sent.
const capturePins = new Map();
// The capture whose exact body is on the wire, and the newest capture that has
// not been sent. A newer unsent snapshot never displaces the sending capture.
let wireCaptureId = null;
let unsentCaptureId = null;
// The sending capture's exact evidence: the file-mode operation IDs its body was
// proven to carry, and the body itself until its recovery has hashed it.
let sending = null;
// One coordinator for every historical lookup (it owns the hashing, the query
// rounds and the absolute deadline, never a store), and the lookups in flight by
// the capture whose lost answer they are resolving.
const history = createSaveHistoryRecovery({ query: (request) => hostMeta.querySaveOutcome?.(request) ?? null });
const recoveries = new Map();

function pruneCaptures(entry) {
  if (!entry.captureOps.size) return;
  const pending = new Set(entry.store.pendingEntries().map((item) => item.id));
  for (const [key, captured] of entry.captureOps) {
    captured.ids = captured.ids.filter((id) => pending.has(id));
    if (!captured.ids.length) entry.captureOps.delete(key);
  }
  if (![...entry.captureOps.values()].some((captured) => captured.ended)) disarm(entry);
}

const onWire = (name, key) => {
  if (wireCaptureId === null || !isSaveInProgress()) return false;
  return capturePins.get(wireCaptureId)?.get(name)?.key === key;
};

function heldIds(name) {
  const entry = entries.get(name);
  if (!entry || !entry.captureOps.size) return [];
  const pending = new Set(entry.store.pendingEntries().map((item) => item.id));
  const ids = new Set();
  for (const [key, captured] of entry.captureOps) {
    if (!captured.ended && !onWire(name, key)) continue;
    for (const id of captured.ids) if (pending.has(id)) ids.add(id);
  }
  return [...ids];
}

function endedCapture(entry) {
  for (const [key, captured] of entry.captureOps) if (captured.ended) return [key, captured];
  return null;
}

registerUnsavedState({ id: "live:held", isPending: () => [...entries.values()].some((entry) => endedCapture(entry)) });

const inFlight = (entry) => [...entry.captureOps].some(([key, captured]) => !captured.ended && onWire(entry.store.name, key));

function describeOp({ op, path, n, value }) {
  const where = path.length ? path.join(".") : "the whole value";
  const text = op === "add" ? `${where} + ${n}` : op === "del" ? `${where} removed` : `${where} = ${JSON.stringify(value)}`;
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function arm(entry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    giveUp(entry);
  }, HOLD_MS);
}

function disarm(entry) {
  clearTimeout(entry.timer);
  entry.timer = null;
}

function giveUp(entry, { read = true } = {}) {
  const name = entry.store.name;
  const ids = heldIds(name);
  disarm(entry);
  entry.withheld = false;
  entry.reading = false;
  // The operations these IDs named are given up: no answer about them can settle
  // anything now.
  cancelRecovery(entry);
  if (ids.length) {
    const lost = entry.store.pendingEntries().filter((item) => ids.includes(item.id)).map((item) => item.op);
    if (entry.store.handle.status.mode === "file") entry.leftAt = null;
    entry.store.rebase(entry.store.authoritative, { source: "state", dropIds: ids });
    const shown = lost.slice(0, 5).map(describeOp).join("; ");
    const more = lost.length > 5 ? ` and ${lost.length - 5} more` : "";
    const message = `A save of "${name}" ended without an answer, so ${lost.length === 1 ? "this edit was" : "these edits were"} not sent again: ${shown}${more}. Check the value, and redo ${lost.length === 1 ? "it" : "any"} if missing.`;
    console.warn(`clay.live("${name}"): ${message}`, lost);
    document.dispatchEvent(new CustomEvent("clay:live-notice", { detail: { name, code: "save-uncertain", ops: lost, message } }));
  }
  if (read) fast?.release(name, { read: fast.roomBound(name) });
}

function settle(entry) {
  pruneCaptures(entry);
  const name = entry.store.name;
  // Authority already holds every operation this lookup was asking about.
  if (entry.recovery && !stillPending(entry)) cancelRecovery(entry);
  if (!entry.withheld || entry.reading || heldIds(name).length) return;
  if (!fast?.roomBound(name)) {
    entry.withheld = false;
    disarm(entry);
    return;
  }
  entry.reading = true;
  arm(entry);
  fast.release(name, { read: true });
}

function taken(name) {
  const entry = entries.get(name);
  if (!entry) return;
  // A state that passed the lane's read barrier is the fresh authority a
  // historical proof waited for: only newer edits may be saved from here.
  endRefresh(entry);
  if (!entry.withheld && !entry.reading) return;
  entry.withheld = false;
  entry.reading = false;
  if (![...entry.captureOps.values()].some((captured) => captured.ended)) disarm(entry);
}

// A store whose lost save durable history is still resolving. None of it is saved
// or checkpointed meanwhile: its own captured operations are withheld, and an
// answer that proves them is followed by a fresh room read before anything newer
// may be saved.
function historyPending() {
  for (const entry of entries.values()) {
    if (entry.recovery || entry.historicalRefreshPending) return true;
  }
  return false;
}

function stillPending(entry) {
  const pending = new Set(entry.store.pendingEntries().map((item) => item.id));
  const target = entry.recovery.targets.find(({ name }) => name === entry.store.name);
  return target?.ids.some((id) => pending.has(id)) ?? false;
}

// The file-mode stores a lost answer left in doubt, with the exact body whose
// attempts can still prove them. Null when this capture bound no such store.
function historyPlan(captureId) {
  if (!sending || sending.captureId !== captureId || typeof sending.html !== "string") return null;
  const targets = [];
  for (const [name, ids] of sending.qualified) {
    const entry = entries.get(name);
    if (!entry || !ids.length) continue;
    targets.push({ name, ids: [...ids], saved: sending.saved.get(name) });
  }
  if (!targets.length) return null;
  return { captureId, html: sending.html, targets };
}

// The body is needed until the one hash of it is taken, and no longer.
function releaseBody() {
  if (sending) sending.html = null;
}

// The barrier outlives the window: a store still waiting for its fresh read at
// the original deadline says so once, and stays blocked until one arrives.
function armRefresh(entry, deadline) {
  disarmRefresh(entry);
  const name = entry.store.name;
  entry.refreshTimer = setTimeout(() => {
    entry.refreshTimer = null;
    if (!entry.historicalRefreshPending) return;
    const message = `The save of "${name}" that ended without an answer did happen, but the value the file holds now must load before newer edits can be saved.`;
    console.warn(`clay.live("${name}"): ${message}`);
    document.dispatchEvent(new CustomEvent("clay:live-notice", { detail: { name, code: "save-history-refresh-required", message } }));
  }, Math.max(0, deadline - Date.now()));
}

// Only a room can hold state newer than the proven save. A fresh read that shows
// no room holds the store, or a lane that stopped, leaves the file as authority,
// and its conditional saves refuse a write they have not seen.
function endRefresh(entry) {
  if (!entry.historicalRefreshPending) return;
  entry.historicalRefreshPending = false;
  disarmRefresh(entry);
}

function disarmRefresh(entry) {
  if (entry.refreshTimer === null) return;
  clearTimeout(entry.refreshTimer);
  entry.refreshTimer = null;
}

// Another proof settled this store's capture first (its operations left pending
// through authority, or an accepted body confirmed them): the lookup is redundant.
function cancelRecovery(entry) {
  const record = entry.recovery;
  if (!record) return;
  entry.recovery = null;
  if (record.targets.some((target) => entries.get(target.name)?.recovery === record)) return;
  recoveries.delete(record.captureId);
  record.run?.cancel();
}

function cancelCaptureRecovery(captureId) {
  if (captureId === null || captureId === undefined) return;
  const record = recoveries.get(captureId);
  if (!record) return;
  recoveries.delete(captureId);
  for (const target of record.targets) {
    const entry = entries.get(target.name);
    if (entry && entry.recovery === record) entry.recovery = null;
  }
  record.run?.cancel();
}

// One absolute window from the logical save's settlement, over the body it sent
// and the at most two IDs its attempts used. The host has to advertise the
// capability first: without it there is nothing to ask, and the existing
// uncertainty path is the truthful one.
function startHistoryRecovery(plan, { result, attempts, startedAt }) {
  const { captureId, html } = plan;
  const record = { captureId, deadline: startedAt + RECOVERY_WINDOW_MS, targets: plan.targets, run: null };
  recoveries.set(captureId, record);
  for (const target of plan.targets) {
    const entry = entries.get(target.name);
    disarm(entry);
    entry.recovery = record;
  }
  hostMeta.hostSupports("save-history").then(
    (supported) => {
      if (recoveries.get(captureId) !== record) return;
      plan.html = null;
      if (!supported) return fallBackToRoom(captureId);
      record.run = history.start({
        captureId,
        html,
        attempts,
        initialOutcome: result?.saveOutcome ?? null,
        startedAt,
        onApplied: ({ saveId, requestHash }) => applyHistory(captureId, saveId, requestHash),
        onUnknown: ({ reason }) => failHistory(captureId, reason),
      });
    },
    () => {
      plan.html = null;
      fallBackToRoom(captureId);
    },
  );
}

// Durable history proved the capture happened. Its own operations leave pending
// without ever being sent again, and the store waits for a fresh room read before
// anything newer is saved.
function applyHistory(captureId, saveId, requestHash) {
  const record = recoveries.get(captureId);
  if (!record) return;
  recoveries.delete(captureId);
  for (const target of record.targets) {
    const entry = entries.get(target.name);
    if (!entry || entry.recovery !== record) continue;
    entry.recovery = null;
    // The flag first: nothing may start a save while these IDs move.
    entry.historicalRefreshPending = true;
    const pending = new Set(entry.store.pendingEntries().map((item) => item.id));
    const dropIds = target.ids.filter((id) => pending.has(id));
    // The file now holds the captured value: it is the authority until a room says otherwise.
    entry.store.rebase(JSON.parse(target.saved), { source: "state", dropIds });
    if (!fast) {
      endRefresh(entry);
      continue;
    }
    fast.release(entry.store.name, { read: true });
    armRefresh(entry, record.deadline);
  }
}

// The host never advertised save-history: there is nothing to ask, so the
// operations wait for this room to prove them, as any unanswered save does.
function fallBackToRoom(captureId) {
  const record = recoveries.get(captureId);
  if (!record) return;
  recoveries.delete(captureId);
  for (const target of record.targets) {
    const entry = entries.get(target.name);
    if (!entry || entry.recovery !== record) continue;
    entry.recovery = null;
    if (!fast?.roomBound(entry.store.name)) {
      giveUp(entry, { read: false });
      continue;
    }
    entry.withheld = true;
    entry.reading = true;
    arm(entry);
    fast.release(entry.store.name, { read: true });
  }
}

// No usable answer (the window expired, the body could not be hashed, the host
// answered nothing): the unresolved operations take the existing uncertainty
// path once, and are never replayed.
function failHistory(captureId, reason) {
  const record = recoveries.get(captureId);
  if (!record) return;
  recoveries.delete(captureId);
  for (const target of record.targets) {
    const entry = entries.get(target.name);
    if (!entry || entry.recovery !== record) continue;
    entry.recovery = null;
    giveUp(entry);
  }
}

function ended(entry, key, plan) {
  const captured = entry.captureOps.get(key);
  const name = entry.store.name;
  if (!captured) {
    if (entry.store.handle.status.mode === "file") entry.leftAt = null;
    return;
  }
  captured.ended = true;
  if (plan?.has(name)) {
    // Durable history is the only thing that can still prove these operations:
    // they wait for its answer, never for this room's receipts.
    entry.withheld = true;
    entry.reading = true;
    return;
  }
  if (!fast?.roomBound(name)) {
    giveUp(entry, { read: false });
    return;
  }
  entry.withheld = true;
  entry.reading = true;
  arm(entry);
  fast.release(name, { read: true });
}

// A JSON text as the value it holds, so formatting (spacing, key order) never
// decides a match.
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortedKeys(value[key]);
  return out;
}

function canonical(text) {
  try {
    return JSON.stringify(sortedKeys(parseJsonRelaxed(text)));
  } catch {
    return null;
  }
}

// The writer session a mode lease owns (see liveWriterParticipant). Null until one is
// prepared, and null again once it is disposed: a page whose loader has not registered
// a writer keeps the old rule, one lane per edit-mode tab. While a session has closed
// admission (entry preparing, or an exit draining what this tab still holds) no local
// op is framed and no checkpoint saves.
let writerSession = null;
const writerAdmitted = () => !writerSession || writerSession.admitted;

// Saved stores with changes no accepted save holds yet. Only an edit-mode tab
// saves. In file mode that is this tab's unconfirmed ops; in fast mode the room
// says the file does not reach its latest change, and only the writer saves.
function unsavedLiveChanges() {
  if (!isEditMode || !writerAdmitted()) return false;
  for (const entry of entries.values()) {
    if (entry.store.ephemeral) continue;
    if (entry.store.handle.status.mode === "fast") {
      if (fast?.isWriter() && entry.landed < entry.last) return true;
    } else if (entry.store.pending.length > 0) {
      return true;
    }
  }
  return false;
}

// Callbacks waiting for the file to catch up, run after every checkpoint save
// and every time the room reports a landing.
const fileWaiters = new Set();
function fileMoved() {
  for (const fn of [...fileWaiters]) fn();
}

const checkpoints = createCheckpoints({
  needsSave: unsavedLiveChanges,
  blocked: () => !writerAdmitted() || !baselineSettled() || isSaveConflicted() || autosaveIsSuspended() || historyPending(),
  save: () => savePageForce().finally(fileMoved),
  saveNow: () => withKeepalive(true, () => savePageForce()),
});

// The fast lane, on a host that advertises live-data. Started by the first
// clay.live() call in an edit-mode tab.
let fast = null;
let laneRequested = false;
// Bumped by every request and every release, so an answer that arrives after its
// session was released starts nothing.
let laneRequest = 0;
let serverLane = null;
// The host merges exact save provenance (live-by v2); without it a save that
// needs provenance is refused rather than risk applying an edit twice.
let provenanceHost = false;
let local = null;
// True from pagehide until the page is shown again (a page kept for back and
// forward): only a closing page's save is reported to the local room at capture.
let closing = false;

// A listener for the store behind a session: a reader's tag, and the values other
// tabs saved to it, keep following the file.
function sessionStores() {
  return [...entries.values()].filter((entry) => !entry.store.ephemeral);
}

// What this tab still holds that the page's own bytes cannot carry: ops a store in a
// room has not had acknowledged. A reader's own change is not one of them.
function liveWriterPending() {
  if (!writerSession || writerSession.admitted || !fast || fast.status.stopped) return false;
  for (const entry of sessionStores()) {
    if (entry.store.handle.status.mode === "fast" && entry.store.pending.length > 0) return true;
  }
  return false;
}

// Frame what the lane has not sent and wait for the room to take it. This is the one
// transfer that lets the writer be released: a checkpoint writes the room's value, so
// an unacknowledged op of this tab has to travel through the room, not the file.
export async function drainLiveWriter({ timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const frame = () => {
    for (const entry of sessionStores()) {
      if (entry.store.handle.status.mode !== "fast") continue;
      if (entry.store.pending.length > 0) fast?.release(entry.store.name);
    }
  };
  frame();
  while (liveWriterPending()) {
    if (Date.now() >= deadline) return { ok: false, code: "timeout" };
    await new Promise((resolve) => setTimeout(resolve, 5));
    frame();
  }
  return { ok: true };
}

registerUnsavedState({ id: "live:writer", isPending: liveWriterPending, flush: drainLiveWriter });

// The lane a session starts from: the reader's own ops are not this session's edits,
// and no position a previous session's lane reported is carried into this one.
function resetWriterSession() {
  for (const entry of entries.values()) {
    entry.framesSince = false;
    const ids = entry.store.pendingEntries().map((item) => item.id);
    if (ids.length) entry.store.rebase(entry.store.authoritative, { source: "state", dropIds: ids });
  }
}

// Give back everything the lane holds: the transport's subscription (its stream
// handlers and its local channel), the room position, and the request for a lane, so
// the next session starts a fresh one.
function releaseWriter() {
  const lane = fast;
  fast = null;
  laneRequested = false;
  laneRequest++;
  serverLane = null;
  local = null;
  provenanceHost = false;
  // The gates went with the lane: a second entry must not read this released one as ready.
  laneReady = null;
  writerReady = null;
  settleLane = null;
  settleWriter = null;
  lane?.stop();
}

/**
 * clay.live as a mode participant: the store's writer, started by the commit that
 * enters edit and released by the one that leaves it.
 *
 * `prepare` closes admission and puts the stores back on the reader's value, so
 * nothing a reader changed can be uploaded as this person's edit. `enable` starts
 * the tab's lane. `quiesce` closes admission again and drains the ops the room has
 * not acknowledged, so a refused exit resumes the very same lane. `dispose` (after the
 * barrier) stops the lane and forgets its subscription, its room and its send queue.
 */
export function liveWriterParticipant() {
  return {
    id: "clay:live",
    order: 200,
    prepare(context = {}) {
      // An adoption is the session this tab's edit boot started: the exit takes that one
      // back, and the entry asks for no second lane.
      if (context.initial === true) {
        if (!writerSession) writerSession = { admitted: true };
        return writerLease(writerSession, { adopted: true });
      }
      freshLaneGates();
      // The lane's transport opens with the preparation, not with the commit: the page
      // (order 400) waits on the room while it prepares, and it prepares before any
      // enable runs. Admission is still the commit's, so what a person does is what
      // reaches the room.
      const session = { admitted: false, wantsLane: true };
      writerSession = session;
      resetWriterSession();
      ensureLane();
      return writerLease(session);
    },
  };
}

function releaseHeld() {
  for (const entry of sessionStores()) {
    if (entry.store.pending.length > 0) fast?.release(entry.store.name);
  }
}

function writerLease(session, { adopted = false } = {}) {
  return {
    enable() {
      if (adopted || writerSession !== session) return;
      session.admitted = true;
      ensureLane();
      // A lane opened at preparation may already hold ops the page made before the
      // commit (an adoption's), which onLocal kept back while admission was closed.
      releaseHeld();
    },
    quiesce() {
      if (writerSession !== session) return;
      session.admitted = false;
      return drainLiveWriter();
    },
    resume() {
      if (writerSession !== session) return;
      session.admitted = true;
      releaseHeld();
    },
    dispose() {
      if (writerSession !== session) return;
      writerSession = null;
      releaseWriter();
    },
  };
}

export { liveWriterParticipant as modeParticipant };

// The page plugin's one-shot gates: the fast lane's setup, and the room's
// writer election. Both resolve null when this tab has no lane at all.
let laneReady = null;
let writerReady = null;
let settleLane = null;
let settleWriter = null;

// A fresh pair for a new session: the page plugin awaits these, and the ones a released
// session settled answer for a lane that no longer exists.
function freshLaneGates() {
  laneReady = new Promise((resolve) => { settleLane = resolve; });
  writerReady = new Promise((resolve) => { settleWriter = resolve; });
}

function laneGates() {
  if (!laneReady) freshLaneGates();
  return { laneReady, writerReady };
}

export function pageLaneReady() {
  return laneGates().laneReady;
}

export function pageWriterReady() {
  return laneGates().writerReady;
}

// The room's numbers moved: a file the room cannot rebuild from (landed -1) is
// saved over now, anything else on the usual deadline.
function liveMoved() {
  for (const entry of entries.values()) {
    if (!entry.store.ephemeral && entry.store.handle.status.mode === "fast" && entry.landed === -1) {
      checkpoints.soon();
      return;
    }
  }
  checkpoints.changed();
}

// Drop a store's ops through mark: a save that may have landed holds them.
function dropThrough(entry, mark) {
  entry.store.rebase(entry.store.authoritative, { source: "state", through: mark });
}

// A save ended without being accepted. maybeLanded: it may have reached the
// file (an error or a lost answer). Ops it carried in file mode go on (to the
// room, or the next save) when it surely did not land. When it may have, they
// are never sent again, and are given up unless proof of the file's value
// settles them first (see ended).
function endPin(pin, maybeLanded, plan = null) {
  if (!pin) return;
  for (const [name, saved] of pin) {
    const entry = entries.get(name);
    if (!entry || saved.mode !== "file") continue;
    if (maybeLanded || saved.maybeLanded) ended(entry, saved.key, plan);
    else {
      entry.captureOps.delete(saved.key);
      settle(entry);
    }
    if (entry.store.handle.status.mode === "fast") fast?.release(name);
  }
}

function dropCapture(captureId) {
  const pin = capturePins.get(captureId);
  capturePins.delete(captureId);
  if (wireCaptureId === captureId) wireCaptureId = null;
  if (unsentCaptureId === captureId) unsentCaptureId = null;
  return pin;
}

// A DOM result event is the shadow of a save the hooks already reported: the
// capture it settled is theirs to end. So this only ends a capture that never
// reached an attempt, and a capture made between the two keeps its pin.
function endDomPin(maybeLanded, ownerId = null) {
  const captureId = ownerId ?? wireCaptureId ?? unsentCaptureId;
  if (captureId === null) return;
  endPin(dropCapture(captureId), maybeLanded);
}

// A capture that sent nothing is definitely unsent. Otherwise only a 4xx proves
// the host wrote nothing, and only when no attempt timed out. A lost answer, a
// timeout, a 5xx or a historical duplicate may have landed.
function mayHaveLanded(result, sent) {
  const code = result?.code;
  const precommit = code === "page-converting" || code === "page-capacity";
  return code === "save-already-applied" || result?.hadTimeout === true ||
    (sent !== false && !precommit && !(result?.status >= 400 && result?.status < 500));
}

function laneOptions(transport) {
  return {
    transport,
    entries,
    onWriter: () => {
      checkpoints.changed();
      if (fast && fast.status.writer !== null) settleWriter?.(fast);
    },
    onApplied: liveMoved,
    onLanded: () => {
      liveMoved();
      fileMoved();
    },
    onCheckpoint: () => checkpoints.soon(),
    onLeave: (name, at) => {
      const entry = entries.get(name);
      if (entry?.store.handle.status.mode === "fast") entry.leftAt = { ...at, frames: [], ancestors: [] };
    },
    held: (name) => heldIds(name).length > 0,
    heldIds,
    hold: (name) => {
      const entry = entries.get(name);
      if (!entry) return false;
      // A lost answer durable history is still resolving is not this room's to
      // decide: its window outlives the request and the room's receipts.
      if (entry.recovery) return true;
      if (inFlight(entry)) {
        entry.withheld = true;
        return true;
      }
      giveUp(entry, { read: false });
      return false;
    },
    taken,
    onStop: () => {
      for (const entry of entries.values()) {
        endRefresh(entry);
        if (entry.recovery) continue;
        if (!inFlight(entry)) giveUp(entry, { read: false });
      }
    },
  };
}

// What this tab holds for every live tag, for the first room this browser
// starts: an open store's authoritative value (never its own unconfirmed ops,
// which its lane sends), or the tag's value.
function seedLocalRoom() {
  const values = new Map();
  for (const [name, tag] of liveTags(document, { warn: false })) {
    const entry = entries.get(name);
    if (entry) {
      values.set(name, { value: entry.store.authoritative, ephemeral: entry.store.ephemeral });
      continue;
    }
    try {
      const value = parseJsonRelaxed(tag.element.textContent);
      if (value !== null && typeof value === "object") values.set(name, { value, ephemeral: tag.ephemeral });
    } catch {}
  }
  return values;
}

function ensureLane() {
  laneGates();
  if (laneRequested || !(writerSession ? writerSession.admitted || writerSession.wantsLane : isEditMode)) return;
  laneRequested = true;
  const request = ++laneRequest;
  hostMeta.hostSupports("live-data").then(
    async (supported) => {
      const provenance = supported && (await hostMeta.hostSupports("live-provenance"));
      if (request !== laneRequest) return;
      serverLane = supported;
      provenanceHost = provenance;
      if (supported) {
        fast = createFastLane(laneOptions(serverTransport()));
      } else if (localLaneSupported()) {
        // The document's own floor picks the channel scope: a floor-1 document
        // never shares the lane a tab that cannot read it is on.
        local = localTransport({ seed: seedLocalRoom, floor: document.querySelector('meta[name="clay-page-format"]')?.getAttribute("content") });
        fast = createFastLane(laneOptions(local));
      } else {
        settleLane?.(null);
        settleWriter?.(null);
        return;
      }
      // The writer saves every store in the room, so every live tag is opened,
      // not only the ones this page's code asked for.
      for (const name of liveTags(document, { warn: false }).keys()) {
        if (entries.has(name)) continue;
        try {
          live(name);
        } catch {}
      }
      // A store still waiting for its fresh read needs its barrier on this lane
      // too: a lane that starts after the proof must not take its first state
      // blindly.
      for (const [name, entry] of entries) {
        if (entry.historicalRefreshPending) fast.release(name, { read: true });
      }
      fast.start();
      settleLane?.(fast);
      if (fast.status.writer !== null) settleWriter?.(fast);
    },
  ).catch(() => {
    settleLane?.(null);
    settleWriter?.(null);
  });
}

function isJsonType(type) {
  const t = (type || "").split(";")[0].trim().toLowerCase();
  return t === "application/json" || t.endsWith("+json");
}

// The live tags under root, by name. A name used twice is left out: neither tag
// can be the store.
export function liveTags(root = document, { warn = true } = {}) {
  const found = new Map();
  const duplicated = new Set();
  for (const el of root.querySelectorAll('script[merge][clay~="live"]')) {
    if (el.hasAttribute("src") || !isJsonType(el.getAttribute("type"))) continue;
    const name = el.getAttribute("merge");
    if (!NAME.test(name)) continue;
    if (found.has(name)) {
      duplicated.add(name);
      continue;
    }
    found.set(name, { name, ephemeral: el.getAttribute("clay").split(/\s+/).includes("ephemeral"), element: el });
  }
  for (const name of duplicated) {
    if (warn) console.warn(`clay.live: more than one live tag is named "${name}", so none of them is live`);
    found.delete(name);
  }
  return found;
}

function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

// In fast mode a capture writes the room's value, never this tab's unconfirmed
// ops (the room may still refuse them).
function textOf(entry) {
  const fastMode = entry.store.handle.status.mode === "fast";
  const current = fastMode ? entry.store.authoritative : entry.store.value;
  const value = fastMode && /^page(\.[0-9]+)?$/.test(entry.store.name) ? captureYValue(current) : current;
  if (entry.layout === "lines") return serializeLines(value);
  return entry.layout === "pretty" ? JSON.stringify(value, null, 2).replace(/</g, "\\u003c") : serializeLive(value);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// live-format="lines": each entry of each top-level object on its own line, so
// a version diff of a large store (a page's blocks) shows only the entries
// that changed.
export function serializeLines(value) {
  if (!isObject(value)) return serializeLive(value);
  const parts = Object.entries(value).map(([key, inner]) => {
    if (!isObject(inner) || !Object.keys(inner).length) return `${serializeLive(key)}:${serializeLive(inner)}`;
    return `${serializeLive(key)}:{\n${Object.entries(inner).map(([k, v]) => `${serializeLive(k)}:${serializeLive(v)}`).join(",\n")}\n}`;
  });
  return `{${parts.join(",\n")}}`;
}

// A value another tab saved or relayed. It never confirms this tab's ops: equal
// text from a peer is not this tab's save. through: this tab's ops the value
// already holds (its frames that landed before the value's stamp).
function hashOfText(text) {
  try {
    return textHash(serializeLive(parseJsonRelaxed(text)));
  } catch {
    return null;
  }
}

function receive(entry, text, source, dropIds) {
  let value;
  try {
    value = parseJsonRelaxed(text);
  } catch {
    return;
  }
  if (entry.store.rebase(value, { source, ...(dropIds?.length && { dropIds }) })) entry.framesSince = true;
}

// One open store and what the plugin follows about it. A staged store has no lane.
function openEntry(name, store, { layout = "line", leftAt = null, staged = null } = {}) {
  const entry = { store, layout, framesSince: false, last: 0, landed: 0, leftAt, captureOps: new Map(), withheld: false, reading: false, timer: null, recovery: null, historicalRefreshPending: false, refreshTimer: null, staged };
  entries.set(name, entry);
  store.onDelivery((event) => {
    if (event.code === "receipt-expired") document.dispatchEvent(new CustomEvent("clay:live-notice", {
      detail: { name, code: event.code, ops: event.ops, message: "The room retired an update receipt. Check the saved value before restoring this update." },
    }));
    if (event.phase === "refused" && event.code === "too-large" && !/^page(\.[0-9]+)?$/.test(name)) document.dispatchEvent(new CustomEvent("clay:live-notice", {
      detail: { name, code: "op-too-large", message: "That change was too large to share, so it was undone." },
    }));
    // The room was opened from a document with no store of this name, so the
    // page it holds is not the one this tab is editing.
    if (event.phase === "left" && event.code === "no-store" && /^page(\.[0-9]+)?$/.test(name)) document.dispatchEvent(new CustomEvent("clay:live-notice", {
      detail: { name, code: "unknown-store", message: `The room has no "${name}" store, so the page it holds is not the one this tab is editing.` },
    }));
  });
  store.onRebase((event) => {
    settle(entry);
    if (store.handle.status.mode === "file" && ["undone", "refused", "decided"].includes(event.cause)) entry.leftAt = null;
  });
  if (!store.ephemeral) store.onLocal(() => checkpoints.changed());
  store.onLocal((ops) => { if (!entry.staged && writerAdmitted()) fast?.local(name, ops, store.mark); });
  store.handle.on("change", () => {
    if (!store.ephemeral && store.handle.status.mode === "fast") checkpoints.changed();
  });
  if (!staged) {
    fast?.storeOpened(name);
    ensureLane();
  }
  return entry;
}

export function live(name) {
  const existing = entries.get(name);
  if (existing) return existing.store.handle;
  const tag = liveTags().get(name);
  if (!tag) throw new Error(`clay.live: this page has no <script type="application/json" merge="${name}" clay="live"> tag`);
  const text = tag.element.textContent;
  let value;
  try {
    value = parseJsonRelaxed(text);
  } catch (err) {
    throw new SyntaxError(`clay.live("${name}"): the tag's JSON does not parse: ${err.message}`);
  }
  const store = createStore({ name, value, ephemeral: tag.ephemeral });
  const layout = tag.element.getAttribute("live-format") === "lines" ? "lines" : text.includes("\n") ? "pretty" : "line";
  const entry = openEntry(name, store, { layout, leftAt: lineageOf(tag.element) });
  return entry.store.handle;
}

// A page whose file carries no state of its own yet: the seed in memory, no tag in
// the document, no request, until its first genuine op is written by the ordinary
// save. Only an accepted write opens its room.
export function stageStore(name, { value, represented = null, signal = null } = {}) {
  const existing = entries.get(name);
  if (existing && !existing.staged) throw new Error(`clay.live("${name}"): the store is open in a room`);
  const entry = existing ?? openEntry(name, createStore({ name, value, ephemeral: false }), { staged: { represented, signal } });
  return {
    handle: entry.store.handle,
    isPending: () => !!entry.staged && entry.store.pending.length > 0,
    flush: (options = {}) => flushStaged(entry, options),
    dispose() {
      if (entry.staged && entries.get(name) === entry) entries.delete(name);
    },
    // The session that staged this store is over, whether or not its first write was
    // accepted: the room keeps the value, and the next session stages its own from the
    // bytes it represents.
    close() {
      if (entries.get(name) === entry) entries.delete(name);
    },
  };
}

// The first write, through the save this tab would make anyway.
async function flushStaged(entry, { timeoutMs = 10_000 } = {}) {
  const staged = entry.staged;
  if (!staged || !entry.store.pending.length) return { ok: true };
  if (staged.conflict) return { ok: false, code: staged.conflict };
  const at = staged.represented?.etag || null;
  const held = lastSeenEtag();
  if (at && held && at !== held) return { ok: false, code: "stale-document" };
  if (at && !held) recordEtag(at);
  const result = await requestCheckpoint({ timeoutMs });
  return result.ok ? { ok: true } : { ok: false, code: staged.conflict ?? result.code ?? null };
}

function activateStaged(entry) {
  if (!entry.staged) return;
  entry.staged = null;
  // Its file had no tag and the live page never gets one: every later capture builds it.
  entry.tagless = true;
  fast?.storeOpened(entry.store.name);
  ensureLane();
}

// Every capture carries each saved store's current value. A never-saved store
// writes nothing: its tag keeps the text the file has.
onSnapshot((clone, { forSave, requestRefresh }) => {
  if (!entries.size) return;
  const tags = liveTags(clone, { warn: false });
  for (const entry of entries.values()) {
    if (entry.store.ephemeral) continue;
    let tag = tags.get(entry.store.name);
    // A staged store reaches the file here, where the boot would have put its tag, and
    // so does one that started that way, on every save after its first.
    if (!tag && (entry.staged || entry.tagless)) {
      const article = clone.querySelector("article[data-page]");
      if (!article) continue;
      const element = article.ownerDocument.createElement("script");
      element.setAttribute("type", "application/json");
      element.setAttribute("merge", entry.store.name);
      element.setAttribute("clay", "live");
      article.parentNode.insertBefore(element, article);
      tag = { name: entry.store.name, ephemeral: false, element };
    }
    if (!tag) continue;
    // A recovering store's own operations are not written again while the answer
    // about them is still open, and not before the value the file holds now has
    // loaded: this capture is refused, exactly as an unsupported host's is.
    if (forSave && (entry.recovery || entry.historicalRefreshPending)) {
      const needsRefresh = entry.historicalRefreshPending;
      if (needsRefresh && requestRefresh) fast?.release(entry.store.name, { read: true });
      const code = needsRefresh ? "save-history-refresh-required" : "save-history-pending";
      const message = needsRefresh
        ? `clay.live("${entry.store.name}"): the earlier save happened, but the current value must load before newer edits can be saved. Your edits are still in this tab.`
        : `clay.live("${entry.store.name}"): a save ended without an answer, so the saved value must be checked before this one is sent. Your edits are still in this tab.`;
      console.warn(`clay.live("${entry.store.name}"): ${message}`);
      if (!needsRefresh) document.dispatchEvent(new CustomEvent("clay:live-notice", { detail: { name: entry.store.name, code, message } }));
      throw Object.assign(new Error(message), { code });
    }
    const resent = forSave && entry.store.handle.status.mode === "file" ? endedCapture(entry)?.[1] : null;
    if (resent) {
      tag.element.textContent = resent.text;
      for (const [attribute, value] of [["live-at", resent.at], ["live-by", resent.by]]) {
        if (value === null) tag.element.removeAttribute(attribute);
        else tag.element.setAttribute(attribute, value);
      }
      continue;
    }
    const text = textOf(entry);
    tag.element.textContent = text;
    // The room position this value was written at, and a hash of the value: the
    // host merges a later write of the file from that position.
    if (entry.store.handle.status.mode === "fast" && fast) {
      tag.element.setAttribute("live-at", stampOf(fast.status.epoch, fast.status.seq, serializeLive(entry.store.authoritative)));
      tag.element.removeAttribute("live-by");
    } else {
      const needsProvenance = entry.store.pending.length > 0 || (entry.leftAt && !entry.leftAt.disk);
      const unknown = serverLane === null && entry.leftAt && !entry.leftAt.disk;
      if (forSave && needsProvenance && (unknown || (serverLane && !provenanceHost))) {
        const message = "This host must update its live data protocol before this save can be sent. Your edits are still in this tab.";
        console.warn(`clay.live("${entry.store.name}"): ${message}`);
        document.dispatchEvent(new CustomEvent("clay:live-notice", { detail: { name: entry.store.name, code: "provenance-unsupported", message } }));
        fast?.refresh();
        throw Object.assign(new Error(message), { code: "provenance-unsupported" });
      }
      const capture = captureLineage(entry, forSave);
      if (capture) {
        tag.element.setAttribute("live-at", capture.at);
        tag.element.setAttribute("live-by", capture.by);
      } else {
        tag.element.removeAttribute("live-at");
        tag.element.removeAttribute("live-by");
      }
    }
  }
});

// The save's own capture (the one that is sent): pin, per saved store, the mode
// it was captured in, the newest op it held, the value it wrote and (fast mode)
// the room position. onSnapshot has already written the clone. A pin still set
// belonged to a save that ended without acceptance.
document.addEventListener("clay:snapshot-ready", (event) => {
  if (event.detail?.forSave !== true || !entries.size) return;
  const captureId = event.detail.captureId ?? null;
  const tags = liveTags(event.detail.documentElement, { warn: false });
  const stores = new Map();
  for (const entry of entries.values()) {
    if (entry.store.ephemeral) continue;
    const tag = tags.get(entry.store.name);
    if (!tag) continue;
    const mode = entry.store.handle.status.mode === "fast" && fast ? "fast" : "file";
    const at = mode === "fast" ? { epoch: fast.status.epoch, seq: fast.status.seq } : null;
    const lineage = mode === "file" ? lineageOf(tag.element) : null;
    const proof = parseBy(tag.element.getAttribute("live-by"));
    const resent = mode === "file" ? endedCapture(entry) : null;
    const pending = entry.store.pendingEntries().map((e) => e.id);
    const carried = resent ? resent[1].ids.filter((id) => pending.includes(id)) : mode === "file" ? pending : [];
    const capture = mode === "file" && proof?.v === 2 ? proof.capture : null;
    const key = !carried.length ? null : resent ? resent[0] : capture ? JSON.stringify(capture) : `anonymous:${++anonymousCaptures}`;
    const mark = resent ? resent[1].mark : entry.store.mark;
    stores.set(entry.store.name, { mode, mark, canonical: canonical(tag.element.textContent), at, lineage, by: tag.element.getAttribute("live-by"), key, maybeLanded: !!resent, ids: carried });
    if (lineage && !lineage.disk && entry.leftAt) entry.leftAt = { ...entry.leftAt, ancestors: lineage.ancestors };
    if (capture && capture[0] === captureAuthor) captureNumber = Math.max(captureNumber, capture[1]);
    if (key) {
      entry.captureOps.set(key, { capture, ids: carried, ended: false, mark, text: tag.element.textContent, at: tag.element.getAttribute("live-at"), by: tag.element.getAttribute("live-by") });
      pruneCaptures(entry);
    }
    entry.framesSince = false;
    // A close save is answered after the page is gone: the local room learns
    // how far the file reaches now. Should the save fail, a later merge drops
    // those moves, never counts them twice.
    if (mode === "fast" && closing && checkpoints.flushing) local?.landed(entry.store.name, at);
  }
  // A newer capture replaces only an older capture that was never sent; the one
  // on the wire stays until its own outcome.
  if (unsentCaptureId !== null && unsentCaptureId !== wireCaptureId) {
    endPin(dropCapture(unsentCaptureId), false);
  }
  if (captureId !== null) {
    capturePins.set(captureId, stores);
    unsentCaptureId = captureId;
  }
});

// A refusal proves the host wrote nothing, unless an earlier attempt of the
// same save timed out: that one may have landed.
document.addEventListener("clay:save-conflict", (event) => {
  endDomPin(event.detail?.hadTimeout === true, event.detail?.captureId);
});
// A failed capture sent nothing. Otherwise only a 4xx proves the host wrote
// nothing, and only when no attempt timed out. A lost connection, a timeout
// or a 5xx (a proxy's 502 can follow a write) may have landed.
for (const type of ["clay:save-error", "clay:save-offline"]) {
  document.addEventListener(type, (event) => {
    const status = event.detail?.status;
    const code = event.detail?.code;
    const precommit = code === "page-converting" || code === "page-capacity";
    endDomPin(code === "save-already-applied" || event.detail?.hadTimeout === true ||
      (event.detail?.sent !== false && !precommit && !(status >= 400 && status < 500)), event.detail?.captureId);
  });
}

// The bytes a host just accepted. A store whose tag in them holds the value the
// save's own capture wrote (formatting aside):
//   captured in file mode: the ops it held are in the file. Folded into the
//   store's base when nothing arrived since the capture, only dropped when a
//   frame did (that frame descends from this save). A store now in fast mode
//   drops them: the room merges the file, and the lane, which held them,
//   frames what is left.
//   captured in fast mode: the file holds the room's value, none of this tab's
//   own ops. The host room sees the file land; a local room is told.
function confirmPin(html, pin) {
  if (!pin || typeof html !== "string") return;
  const tags = liveTags(parseHtml(html), { warn: false });
  for (const [name, saved] of pin) {
    const entry = entries.get(name);
    if (!entry) continue;
    const tag = tags.get(name);
    const mode = entry.store.handle.status.mode;
    if (!tag || canonical(tag.element.textContent) !== saved.canonical) {
      if (saved.mode === "file") {
        if (fast?.roomBound(name)) dropThrough(entry, saved.mark);
        if (mode === "fast") fast?.release(name);
        settle(entry);
      }
      continue;
    }
    if (saved.mode === "fast") {
      if (saved.at) local?.landed(name, saved.at);
      continue;
    }
    if (mode === "fast") {
      // The room merges the file, which holds these ops: they leave pending
      // without touching the room's value here. A local room never sees this
      // tab's own save come back, so it is handed the file.
      dropThrough(entry, saved.mark);
      local?.fileFrame(new Map([[name, { text: tag.element.textContent, at: parseStamp(tag.element.getAttribute("live-at")), seq: null }]]));
      fast?.release(name);
      // The room merged the file before answering, but its state may arrive
      // after this answer: read it, so the view holds these ops again.
      fast?.refresh();
    } else if (entry.framesSince) {
      if (!entry.leftAt || entry.leftAt.disk || fast?.roomBound(name)) dropThrough(entry, saved.mark);
    } else {
      entry.store.confirm(saved.mark);
      entry.leftAt = saved.lineage && tag.element.getAttribute("live-by") === saved.by ? saved.lineage : { disk: true };
      activateStaged(entry);
    }
    settle(entry);
  }
}

// The attempted body, parsed against the capture that claims it. Only a file-mode
// store whose tag still holds the captured canonical text, both provenance
// attributes and the exact captured operation IDs may have its IDs retired; a
// missing, duplicated or altered tag carries no proof.
function qualifyPin(captureId, pin, html) {
  const tags = liveTags(parseHtml(html), { warn: false });
  const qualified = new Map();
  const savedValues = new Map();
  for (const [name, saved] of pin) {
    saved.qualifiedIds = null;
    if (saved.mode !== "file" || saved.key === null) continue;
    const entry = entries.get(name);
    if (!entry) continue;
    const tag = tags.get(name);
    if (!tag) continue;
    if (canonical(tag.element.textContent) !== saved.canonical) continue;
    const captured = entry.captureOps.get(saved.key);
    if (!captured) continue;
    if (tag.element.getAttribute("live-at") !== captured.at) continue;
    if (tag.element.getAttribute("live-by") !== saved.by) continue;
    const pending = new Set(entry.store.pendingEntries().map((item) => item.id));
    const currentIds = new Set(captured.ids);
    const ids = saved.ids.filter((id) => pending.has(id) && currentIds.has(id));
    if (!ids.length) continue;
    saved.qualifiedIds = ids;
    qualified.set(name, ids);
    savedValues.set(name, saved.canonical);
  }
  sending = { captureId, qualified, saved: savedValues, html };
}

// The exact body is about to leave, under the capture that owns it. Find only
// that capture, keep it as the sending one, and qualify its stores against the
// body. A raw save has no capture and binds nothing.
onSaveAttempt(({ captureId, html }) => {
  if (captureId === null || captureId === undefined) return;
  const pin = capturePins.get(captureId);
  if (!pin) return;
  wireCaptureId = captureId;
  if (unsentCaptureId === captureId) unsentCaptureId = null;
  qualifyPin(captureId, pin, html);
});

// One logical save settled. End only its capture, and classify what may have
// landed. An accepted save was already confirmed by the accepted hook, so it is
// left alone here.
onSaveOutcome(({ captureId, result, attempts, sent }) => {
  if (captureId === null || captureId === undefined) return;
  if (result?.ok) return;
  const pin = capturePins.get(captureId);
  if (!pin) return;
  const stagedEntry = [...pin.keys()].map((name) => entries.get(name)).find((entry) => entry?.staged);
  // Nothing was written: the staged store is clean and nothing follows.
  if (stagedEntry && result.code === "page-nothing-to-write") {
    stagedEntry.store.confirm(stagedEntry.store.mark);
    dropCapture(captureId);
    releaseBody();
    settle(stagedEntry);
    return;
  }
  // This tab's value does not descend from the stored document: never send it again.
  if (stagedEntry && result.code === "page-lineage-stale") stagedEntry.staged.conflict = "conflict";
  dropCapture(captureId);
  const landed = mayHaveLanded(result, sent);
  const plan = landed ? historyPlan(captureId) : null;
  releaseBody();
  endPin(pin, landed, plan ? new Set(plan.targets.map((target) => target.name)) : null);
  if (plan) startHistoryRecovery(plan, { result, attempts, startedAt: Date.now() });
});

// The recovery integration's turn at an accepted save, when one journals this page.
// Registered by page code once it holds a `page.yjs` channel, so a page that journals
// nothing loads neither the proof builder nor the conditional client, and pays one null
// check per save.
let pageCheckpoints = null;

/**
 * Hand every accepted save to a page checkpoint integration, or null to stop.
 *
 * The integration builds the proof from the capture's pinned page state and the bytes
 * the host took; nothing here decides what is covered. Its answer is not awaited: a save
 * that succeeded is saved whether or not a journal can be retired, and a failure there
 * must never reach the save's own outcome.
 *
 * @param {?Function} install - ({capture, state, article, etag}) => unknown
 */
export function registerPageCheckpoints(install) {
  pageCheckpoints = install;
}

function offerCheckpoint(captureId, html) {
  if (!pageCheckpoints) return;
  // Read synchronously, before this capture is released: the value is the one its page
  // tag carried, and the edits that followed it are not in these bytes.
  const state = capturePageState(captureId);
  if (!state) return;
  let article = null;
  try { article = parseHtml(html).querySelector("article[data-page]")?.innerHTML ?? null; }
  catch (_) { article = null; }
  const etag = lastSeenEtag();
  Promise.resolve()
    .then(() => pageCheckpoints({ capture: String(captureId), state, article, etag }))
    .catch(() => {});
}

// An accepted body confirms the ops of the capture that sent it, and only those.
// A null context (a raw save) cannot consume a captured pin.
function handleAccepted(html, context) {
  const captureId = context?.captureId;
  if (captureId === null || captureId === undefined) return;
  offerCheckpoint(captureId, html);
  const pin = capturePins.get(captureId);
  if (!pin) return;
  dropCapture(captureId);
  releaseBody();
  cancelCaptureRecovery(captureId);
  confirmPin(html, pin);
}

onSaveAccepted(handleAccepted);

// The explicit legacy call: confirm the newest capture against these bytes, as
// direct callers and tests have always done.
export function confirmSaved(html) {
  const captureId = unsentCaptureId ?? wireCaptureId;
  const pin = captureId === null ? null : dropCapture(captureId);
  releaseBody();
  cancelCaptureRecovery(captureId);
  confirmPin(html, pin);
}

// Internal: the sending capture's qualified file-mode IDs, for the historical
// recovery that builds on this binding. Not published on window.clay.
export function sendingCapture() {
  return sending;
}

// A live-sync frame. A saved store in file mode takes the frame's value and
// replays its own unconfirmed ops over it. Every other live tag (never-saved
// stores, and tags no code has opened) takes the frame's text into the page, so
// the next save keeps what the file now says instead of the text this tab
// loaded with.
export function receiveFrame(html, seq = null) {
  if (typeof html !== "string" || !html) return;
  const incoming = liveTags(parseHtml(html), { warn: false });
  if (!incoming.size) return;
  if (local) {
    const frames = new Map();
    for (const [name, tag] of incoming) {
      if (tag.ephemeral) continue;
      frames.set(name, { text: tag.element.textContent, at: parseStamp(tag.element.getAttribute("live-at")), seq: Number.isInteger(seq) ? seq : null });
    }
    local.fileFrame(frames);
  }
  const page = liveTags(document, { warn: false });
  for (const [name, tag] of incoming) {
    const text = tag.element.textContent;
    const entry = entries.get(name);
    const at = tag.element.getAttribute("live-at");
    const by = tag.element.getAttribute("live-by");
    const pageTag = page.get(name)?.element;
    if (entry && !entry.store.ephemeral && entry.store.handle.status.mode === "file" && at !== null && by === null && (entry.withheld || heldIds(name).length)) {
      entry.withheld = true;
      continue;
    }
    // The page's tag keeps the lineage of the version this tab last took, so a
    // file-mode save claims what it descends from. A store out of the room
    // descends from the incoming value's room position when it is of this
    // room: its frames that landed at or before it are in that value and leave
    // pending, and its save stamps that position with its own live-by.
    // Only a capture counts (the value is the one its stamp hashes); for
    // anything else the page's tag takes the incoming lineage, as for a store
    // that was never in the room.
    let dropIds = [];
    if (entry && entry.store.handle.status.mode === "file") {
      const lineage = lineageOf(tag.element);
      const sameEpoch = lineage && !lineage.disk && (!fast?.status.epoch || lineage.epoch === fast.status.epoch);
      if (sameEpoch) dropIds = fast?.captured(name, lineage, parseBy(by)) ?? [];
      else if (lineage?.disk) dropIds = fast?.captured(name, parseStamp(at), null) ?? [];
      if (lineage && !lineage.disk) {
        for (const [key, captured] of entry.captureOps) if (captured.capture && contains(lineage.ancestors, ...captured.capture)) {
          dropIds.push(...captured.ids);
          entry.captureOps.delete(key);
        }
      }
      entry.leftAt = sameEpoch ? lineage : lineage?.disk ? lineage : null;
    }
    if (pageTag && (!entry || entry.store.handle.status.mode === "file")) {
      if (at === null) pageTag.removeAttribute("live-at");
      else if (pageTag.getAttribute("live-at") !== at) pageTag.setAttribute("live-at", at);
      if (by === null) pageTag.removeAttribute("live-by");
      else if (pageTag.getAttribute("live-by") !== by) pageTag.setAttribute("live-by", by);
    }
    if (entry && !entry.store.ephemeral) {
      // An old seed is never merged into a newer article before its first write.
      if (entry.staged) continue;
      if (entry.store.handle.status.mode === "file") receive(entry, text, "remote", dropIds);
      continue;
    }
    if (pageTag && pageTag.textContent !== text) pageTag.textContent = text;
  }
}

document.addEventListener("clay:sync-applied", (event) => receiveFrame(event.detail?.html, event.detail?.seq));

// The last chance to save live changes made since the previous checkpoint. A
// keepalive body is capped near 60 KB; a larger page's save may not finish.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && isEditMode && writerAdmitted()) checkpoints.flush();
});
window.addEventListener("pagehide", () => {
  closing = true;
  // A view, and an edit whose session has closed admission or been released, saves
  // nothing here: its bytes are the reader's, and the exit's own barrier writes them.
  if (!isEditMode || !writerAdmitted()) return;
  // A hide save still on the wire is answered after the page is gone too.
  const latest = unsentCaptureId ?? wireCaptureId;
  const pin = checkpoints.flushing && latest !== null ? capturePins.get(latest) : null;
  if (pin) {
    for (const [name, saved] of pin) if (saved.mode === "fast" && saved.at) local?.landed(name, saved.at);
  }
  checkpoints.flush();
});
window.addEventListener("pageshow", () => {
  closing = false;
});

// For the other live modules: the store behind a name, or every open store.
export function storeOf(name) {
  return entries.get(name)?.store || null;
}

// A caller that opened a store itself is done with it: the next entry reads the tag the
// reader now states. Only the store that caller opened is closed; one the app opened
// first, or a staged store, stays.
export function closeStore(name, store) {
  const entry = entries.get(name);
  if (entry && entry.store === store && !entry.staged) entries.delete(name);
}

export function openStores() {
  return [...entries.values()].map((entry) => entry.store);
}

// The fast lane, for tests and the local tab lane.
export function fastLane() {
  return fast;
}

// The page editor's pause save: checkpoint within ms of now. Only the room's
// writer saves, so in other tabs this changes nothing.
export function checkpointWithin(ms) {
  checkpoints.within(ms);
}

// Resolves { ok: true } once the file holds every live change this tab knows
// of now, or { ok: false, code: "timeout" }. The writer saves as soon as it
// can; another tab waits for the writer's save to land.
export function requestCheckpoint({ timeoutMs = 10_000 } = {}) {
  const target = new Map();
  for (const [name, entry] of entries) {
    if (entry.store.ephemeral) continue;
    target.set(name, entry.store.handle.status.mode === "fast" ? entry.last ?? 0 : null);
  }
  const reached = () => [...target].every(([name, last]) => {
    const entry = entries.get(name);
    if (!entry) return true;
    if (last === null || entry.store.handle.status.mode !== "fast") return entry.store.pending.length === 0;
    return (entry.landed ?? 0) >= last;
  });
  if (reached()) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      fileWaiters.delete(check);
      resolve(result);
    };
    const check = () => {
      if (reached()) finish({ ok: true });
    };
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs);
    fileWaiters.add(check);
    if (isEditMode && (!fast || fast.isWriter())) checkpoints.soon();
  });
}

export default live;
