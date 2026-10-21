import { isEditMode } from "../core/is-edit-mode.js";
import { saveToken } from "../core/host-attrs.js";
import { hostMeta, hostSupports } from "../core/host-meta.js";

/**
 * clay.wire — a per-file control channel between this page and a local process.
 *
 * The page sends a request ("rewrite the section I circled"), a process running
 * in the user's own terminal answers with progress and a terminal frame. An
 * editing process changes the file and the result reaches this page through
 * live-sync. A structured helper can instead return a bounded result on the
 * terminal frame without touching the document.
 *
 * Three constraints shape everything below.
 *
 * It must not import the sync plugin. `sync/live-sync.js` opens an EventSource
 * on evaluation, so a static import here would give every wire page a live-sync
 * connection it never asked for. The one thing this module needs from live-sync,
 * "a disk frame just landed", arrives as the `clay:sync-applied` DOM event, which
 * couples the two through the document rather than through the module graph.
 *
 * It runs in view mode (`editOnly: false` in the loader's plugin table), because
 * the `/htmlfile questions` consumer and every read-only review page need it. So
 * nothing here may assume the save lane exists: on a view-mode page `clay.save`
 * is absent, and the save-protection below is skipped entirely rather than
 * guarded at each call site.
 *
 * The stream is lazy. A browser allows six connections per origin, the pool is
 * shared across tabs, and live-sync already holds one per tab, so a second
 * permanent stream means three tabs of one project saturate the origin and the
 * next save queues behind them. The wire is idle between requests by definition,
 * so it connects on the first in-flight request and disconnects after the last
 * one ends.
 */

// Every request carries a deadline, from before its POST until it ends. Nothing
// else can end one: the wire has no "the handler detached" signal, and a handler
// that acknowledged and then died would otherwise leave the request open, its
// promise unresolved, and saving paused for the rest of the session. That is the
// worst outcome available here, worse than reporting a slow agent as failed,
// because the page silently stops saving.
//
// It runs on two lengths. Before the first frame, the handler has taken the
// request (the POST already reports delivered: 0 when nobody was attached) and
// only has to say so.
const ACK_TIMEOUT_MS = 15000;

// Raw handlers keep an inactivity deadline: every frame rearms it, and `wire
// serve` streams the child's stdout as status frames, so an agent that reports
// what it is doing keeps its request alive indefinitely. A structured handler
// instead announces its fixed execution budget in the acknowledgement.
const SILENCE_TIMEOUT_MS = 120000;

const STRUCTURED_TIMEOUT_GRACE_MS = 15000;

// `wire/done` means the handler finished writing the file. It does not mean this
// page has rendered the change: that arrives on the live-sync lane after the
// watcher's quiet interval, and nothing orders the two. So a finished request
// waits in `landing` for the disk frame, and gives up waiting after this.
const LANDING_TIMEOUT_MS = 4000;

const SAVE_FLUSH_TIMEOUT_MS = 5000;

// A long review session sends many requests. Records outlive their request so a
// UI can still show what happened, so the map needs a ceiling; terminated ones
// are dropped oldest-first.
const MAX_RECORDS = 50;

const OPEN_STATES = new Set(["sent", "acked"]);

// Once a request has ended it stays ended. Several things can arrive after the
// end and each would otherwise rewrite it: a POST that was already on the wire
// when the user cancelled, an ack timer that fires after a fast error, a done
// for a request the handler also errored.
const TERMINAL_STATES = new Set(["done", "error", "cancelled"]);

const HELPER_EXTENSION = "wire";

const records = new Map();
const listeners = new Set();

let stream = null;
let streamReady = null;
let landingWatch = 0;
let landingHandler = null;

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Every URL is resolved against the real origin. A `<base href>` in the authored
// document would otherwise point this page's control channel at an origin the
// document chose, which is the same trap live-sync documents on its own stream.
function wireURL(path) {
  return new URL(path, window.location.origin).href;
}

// The document's save token rides on both legs of the wire.
//
// A helper-bound channel is the one place "one wire per file" has to be
// isolation rather than addressing. A page names only its own URL, but the host
// resolves that through the same funnel the save route uses, and that funnel
// admits any registered path on this origin. Without the token, another
// document's page on the same loopback origin could subscribe to this file's
// channel and push requests that run this file's helpers.
//
// A host that has no helper bound to the file ignores the token on both legs, so
// this is unconditional here and costs a document nothing.
function wireToken() {
  const token = saveToken();
  return typeof token === "string" && token !== "" ? token : null;
}

function view(rec) {
  return {
    id: rec.id,
    type: rec.type,
    state: rec.state,
    helper: rec.helper,
    text: rec.text,
    result: rec.result,
    error: rec.error,
    errorCode: rec.errorCode,
    errorDetails: rec.errorDetails,
    errorSource: rec.errorSource,
    startedAt: rec.startedAt,
  };
}

// The second argument is the inbound frame that caused this emit, when one did,
// and null otherwise. Today only `wire/status` passes it, which is the one case
// a snapshot cannot describe on its own: `rec.text` is sticky across later
// states, so a listener accumulating status lines has no other way to tell a new
// line from the same line arriving again under a new state. Terminal outcomes
// need no frame, since `handle.done` settles for every one of them.
function emit(rec, frame) {
  const snapshot = view(rec);
  for (const fn of listeners) {
    try {
      fn(snapshot, frame || null);
    } catch (err) {
      console.error("clay.wire: a listener threw", err);
    }
  }
  document.dispatchEvent(new CustomEvent("clay:wire-state", { detail: snapshot }));
}

function setState(rec, state) {
  if (rec.state === state) return;
  rec.state = state;
  emit(rec);
}

// The request deadline. Armed before the POST, then replaced by the handler's
// raw inactivity window or structured execution budget when it acknowledges.
function arm(rec, ms, message, { cancelFirst = false, errorCode = null } = {}) {
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => {
    rec.timer = null;
    if (cancelFirst) postCancel(rec);
    finish(rec, "error", message, { errorCode, errorSource: "client" });
  }, ms);
}

function disarm(rec) {
  clearTimeout(rec.timer);
  rec.timer = null;
}

function prune() {
  if (records.size <= MAX_RECORDS) return;
  for (const [id, rec] of records) {
    if (records.size <= MAX_RECORDS) break;
    if (!OPEN_STATES.has(rec.state) && rec.state !== "landing") records.delete(id);
  }
}

// --- the stream ------------------------------------------------------------

// A page never names a file and never asks for the handler role. Its target
// comes from its own URL, through the same funnel live-sync's save uses, and any
// file it supplied would be discarded server-side; the handler slot is refused
// to browsers outright, since a page holding it could receive every request on
// the file, including other tabs', and answer with fabricated terminal frames.
function openStream() {
  if (streamReady) return streamReady;

  // In the query, not a header: native EventSource takes no custom headers, and
  // the access log records URL.Path without the query.
  const token = wireToken();
  const path = `/_/wire/subscribe?page-url=${encodeURIComponent(window.location.href)}`
    + (token ? `&token=${encodeURIComponent(token)}` : "");
  stream = new EventSource(wireURL(path));

  stream.onmessage = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    handleFrame(frame);
  };

  // Native EventSource reconnects on its own and carries Last-Event-ID, and wire
  // frames are stamped with one, so the server replays any terminal frame this
  // page missed during the gap: an in-flight request recovers without help. A
  // request cancelled during the gap is dropped by handleFrame, since its record
  // is no longer open. What a reconnect cannot bring back is a status frame,
  // which is display only. So there is nothing to do here.
  stream.onerror = () => {};

  streamReady = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.onopen = finish;
    // Sending is more important than subscribing: a request that never goes out
    // because the stream would not open is worse than one whose early frames
    // are missed.
    setTimeout(finish, 2000);
  });
  return streamReady;
}

function closeStreamIfIdle() {
  for (const rec of records.values()) {
    if (OPEN_STATES.has(rec.state)) return;
  }
  if (!stream) return;
  stream.close();
  stream = null;
  streamReady = null;
}

function handleFrame(frame) {
  if (!frame || typeof frame.id !== "string") return;
  const rec = records.get(frame.id);
  // An id this page did not issue, or one it has stopped caring about. Cancel
  // means stop completely, so a cancelled request's late frames are dropped here
  // rather than reopening a lifecycle the user ended.
  if (!rec || !OPEN_STATES.has(rec.state)) return;

  switch (frame.type) {
    case "wire/ack":
      // Rearmed, not cleared. The handler acknowledges within milliseconds of
      // picking a request up, so clearing here would leave every working request
      // with no deadline at all.
      if (
        frame.payload?.mode === "jsonl" &&
        Number.isFinite(frame.payload.budgetMs) &&
        frame.payload.budgetMs > 0
      ) {
        rec.structured = true;
        arm(
          rec,
          frame.payload.budgetMs + STRUCTURED_TIMEOUT_GRACE_MS,
          "the helper did not finish within its execution budget",
          { cancelFirst: true, errorCode: "helper_timeout" }
        );
      } else {
        arm(rec, SILENCE_TIMEOUT_MS, "the agent stopped responding");
      }
      setState(rec, "acked");
      break;
    case "wire/status":
      if (!rec.structured) arm(rec, SILENCE_TIMEOUT_MS, "the agent stopped responding");
      rec.text = typeof frame.text === "string" ? frame.text : "";
      rec.state = "acked";
      notifyStatus(rec, frame);
      emit(rec, frame);
      break;
    case "wire/done":
      rec.result = Object.prototype.hasOwnProperty.call(frame, "payload") ? frame.payload : null;
      if (rec.document === "edit") land(rec);
      else finish(rec, "done", null);
      break;
    case "wire/error":
      finishError(rec, frame);
      break;
    default:
      break;
  }
}

function notifyStatus(rec, frame) {
  if (!rec.onStatus || typeof frame.text !== "string") return;
  const status = { text: frame.text };
  if (
    frame.payload &&
    typeof frame.payload === "object" &&
    Object.prototype.hasOwnProperty.call(frame.payload, "progress")
  ) {
    status.progress = frame.payload.progress;
  }
  try {
    rec.onStatus(status);
  } catch (err) {
    console.error("clay.wire: an onStatus listener threw", err);
  }
}

function finishError(rec, frame) {
  const payload = frame.payload;
  const structured =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload.source === "application" || payload.source === "host") &&
    typeof payload.code === "string" &&
    payload.code;
  const error = typeof frame.text === "string" && frame.text
    ? frame.text
    : "the handler reported an error";

  if (!structured) {
    finish(rec, "error", error);
    return;
  }

  const state = payload.source === "host" && payload.code === "helper_cancelled"
    ? "cancelled"
    : "error";
  finish(rec, state, error, {
    errorCode: payload.code,
    errorDetails: Object.prototype.hasOwnProperty.call(payload, "details") ? payload.details : null,
    errorSource: payload.source,
  });
}

// --- the landing state -----------------------------------------------------

// `clay:sync-applied` fires on every successful remote morph, from live-sync's
// single apply choke point, whether or not the sync plugin was loaded by this
// page's own URL. Listening for it is what makes "done" mean "you can see it"
// instead of "the agent stopped typing", and it costs no import.
function watchLandings() {
  if (landingHandler) return;
  landingHandler = (event) => {
    // Both apply paths dispatch this event. A peer frame is another tab's edit,
    // so completing a landing on one would report done for bytes that are not
    // the ones this request asked for.
    if (event.detail?.source === "peer") return;
    // One record per frame, oldest first (Map iteration is insertion order). A
    // frame proves one landing and says nothing about any other request, and a
    // request left waiting still ends on its own next frame or its timer.
    for (const rec of records.values()) {
      if (rec.state === "landing") {
        finish(rec, "done", null);
        return;
      }
    }
  };
  document.addEventListener("clay:sync-applied", landingHandler);
}

function unwatchLandingsIfIdle() {
  if (landingWatch > 0 || !landingHandler) return;
  document.removeEventListener("clay:sync-applied", landingHandler);
  landingHandler = null;
}

function land(rec) {
  if (TERMINAL_STATES.has(rec.state) || rec.state === "landing") return;
  disarm(rec);
  rec.state = "landing";
  landingWatch++;
  watchLandings();
  rec.landingTimer = setTimeout(() => {
    // The change may have landed in a way this page cannot observe (no sync
    // plugin, a frame that morphed nothing). Reporting done late is right;
    // reporting a working agent as failed is not.
    finish(rec, "done", null);
  }, LANDING_TIMEOUT_MS);
  emit(rec);
  // The wire is done with this request even though the page is still waiting for
  // its bytes, so the connection can go now.
  closeStreamIfIdle();
}

function finish(rec, state, error, fields = {}) {
  if (TERMINAL_STATES.has(rec.state)) return;
  const wasLanding = rec.state === "landing";
  disarm(rec);
  clearTimeout(rec.landingTimer);
  rec.landingTimer = null;
  // A POST still on the wire has nothing left to report to, and an unbounded
  // fetch is the one thing the deadline cannot otherwise reach.
  rec.abort?.abort();
  if (wasLanding) {
    landingWatch--;
    unwatchLandingsIfIdle();
  }
  rec.error = error;
  if (Object.prototype.hasOwnProperty.call(fields, "errorCode")) rec.errorCode = fields.errorCode;
  if (Object.prototype.hasOwnProperty.call(fields, "errorDetails")) rec.errorDetails = fields.errorDetails;
  if (Object.prototype.hasOwnProperty.call(fields, "errorSource")) rec.errorSource = fields.errorSource;
  rec.state = state;
  if (rec.signal && rec.signalHandler) {
    rec.signal.removeEventListener("abort", rec.signalHandler);
    rec.signalHandler = null;
  }
  releaseSaving(rec);
  emit(rec);
  closeStreamIfIdle();
  prune();
  if (rec.settle) {
    const settle = rec.settle;
    rec.settle = null;
    settle(view(rec));
  }
}

// --- save protection -------------------------------------------------------
//
// Two outbound problems the scoped live-sync merge does not touch, because it
// fixes the return path only.
//
// Save before send: autosave is debounced, so a request sent within that window
// hands the agent a file that does not contain the paragraph the user just typed
// and is asking about.
//
// Suspend autosave while a request is in flight: the save is last-writer-wins
// with a backup, not a reject. An autosave landing inside the watcher's poll and
// quiet window posts the pre-agent document, the server backs the agent's bytes
// up and still writes the browser's, the watcher's revalidation then fails, and
// nothing is published. The handler reports done, the page shows success, and
// the agent's work exists only in Backups.
//
// The lever is the save lane's own suspension, not a mutation-hub pause. Two
// reasons. The [persist] input autosave never goes through the hub at all — it is
// a raw input listener and a timer (autosave.js) — so a hub pause misses the
// clobber it is supposed to prevent. And pausing the hub blinds the scoped-sync
// dirty gate, whose one invariant is that it may over-report but must never
// under-report: a DOM edit the user made during the request would then read as
// clean, and the agent's frame would full-morph it away.

let saveDepth = 0;
let saveLane = null;

// Imported lazily and only in edit mode, through one shared promise. The module
// is not loaded on a view-mode page, so a static import from this
// `editOnly: false` plugin would drag the save lane into view mode to do nothing.
let saveLaneReady = null;
function loadSaveLane() {
  if (!saveLaneReady) saveLaneReady = import("../core/save.js");
  return saveLaneReady;
}

async function holdSaving(rec) {
  if (!isEditMode || rec.holdsSave) return;
  // Resolve the module BEFORE claiming the hold. Claiming it first and awaiting
  // afterwards leaves a window where a cancel releases a hold that was never
  // taken, and the import that resumes after it suspends a lane nothing will
  // ever resume.
  const lane = await loadSaveLane();
  if (rec.state !== "sent") return;
  saveLane = lane;
  rec.holdsSave = true;
  if (saveDepth++ > 0) return;
  lane.suspendAutosave();
}

function releaseSaving(rec) {
  if (!rec.holdsSave) return;
  rec.holdsSave = false;
  if (--saveDepth > 0) return;
  saveDepth = 0;
  saveLane?.resumeAutosave();
}

function once(eventName, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      document.removeEventListener(eventName, settle);
      resolve();
    };
    document.addEventListener(eventName, settle);
    setTimeout(settle, timeout);
  });
}

/**
 * Put what the user is looking at on disk, or fail the request.
 *
 * The wire's promise is that the agent reads the document the user is asking
 * about. A flush that could not deliver that has to end the request: posting
 * anyway means an agent editing a file without the paragraph it was asked about,
 * silently, which is worse than an error the UI can show.
 */
async function flushSave() {
  if (!isEditMode) return;
  const clay = window.clay;
  if (!clay || typeof clay.save !== "function") return;

  // isSaveInProgress comes from the module, not from clay.internals: that
  // surface is an opt-in satellite script, absent on every page the loader
  // builds, so reading it here made "is a save on the wire" permanently false.
  const { isSaveInProgress } = await import("../core/save-core.js");
  // A held save means another operation owns the page's persisted state, not a
  // page with nothing to save: posting now could hand the agent stale bytes.
  const { savesHeld, saveHoldReason } = await import("../core/save.js");
  if (savesHeld()) throw new Error(saveHoldReason());
  const deadline = Date.now() + SAVE_FLUSH_TIMEOUT_MS;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (isSaveInProgress()) {
      await once("clay:save-saved", Math.max(0, deadline - Date.now()));
    }

    const result = await clay.save();
    // `ok` is the outcome and msgType is the server's severity, so a save that
    // landed with a warning is a success. `skipped` covers two outcomes: nothing
    // to save, and a save already on the wire. Only the second means these bytes
    // never left, and asking whether one is still in progress tells them apart.
    if (result?.ok) return;
    if (result?.msgType === "skipped" && !isSaveInProgress()) return;
    if (result?.msgType === "error" || result?.msgType === "unknown") {
      throw new Error(`could not save this page first: ${result.msg || result.msgType}`);
    }
    if (Date.now() >= deadline) break;
  }
  throw new Error("could not save this page before sending");
}

// --- sending ---------------------------------------------------------------

async function postFrame(body, signal) {
  const headers = {
    "Content-Type": "application/json",
    "Page-URL": window.location.href,
  };
  const token = wireToken();
  if (token) headers["Save-Token"] = token;
  const response = await fetch(wireURL("/_/wire/send"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  let reply = null;
  try {
    reply = await response.json();
  } catch {
    reply = null;
  }
  return { ok: response.ok, status: response.status, reply };
}

/**
 * Send one request and track it to a terminal state.
 *
 * Returns a handle immediately; `handle.done` resolves with the final snapshot
 * and never rejects, because a failed request is an outcome the UI renders
 * rather than an exception it catches.
 */
function send(payload, opts = {}) {
  const id = typeof opts.id === "string" && opts.id ? opts.id : newId();
  const type = typeof opts.type === "string" && opts.type ? opts.type : "wire/request";
  const hasHelper = Object.prototype.hasOwnProperty.call(opts, "helper");
  const helper = hasHelper && typeof opts.helper === "string" && opts.helper ? opts.helper : null;
  const documentMode = opts.document === undefined ? (helper ? "none" : "edit") : opts.document;

  if (hasHelper && !helper) {
    return rejected(id, type, null, "helper must be a nonempty string", "invalid_helper");
  }
  if (documentMode !== "edit" && documentMode !== "none") {
    return rejected(
      id,
      type,
      helper,
      'document must be "edit" or "none"',
      "invalid_document"
    );
  }

  // The id is request identity on the wire, on both sides: a reused one would
  // route the first request's frames to the second record, leaving the first
  // unresolvable and its save hold never released. Refused as an outcome rather
  // than thrown, so a UI renders it the way it renders any other failure.
  if (records.has(id)) {
    return rejected(
      id,
      type,
      helper,
      "a request with this id is already on the wire",
      "duplicate_request"
    );
  }

  const rec = {
    id,
    type,
    state: "sent",
    helper,
    document: documentMode,
    structured: false,
    onStatus: typeof opts.onStatus === "function" ? opts.onStatus : null,
    text: "",
    result: null,
    error: null,
    errorCode: null,
    errorDetails: null,
    errorSource: null,
    startedAt: Date.now(),
    timer: null,
    landingTimer: null,
    abort: typeof AbortController === "function" ? new AbortController() : null,
    holdsSave: false,
    settle: null,
    signal: opts.signal && typeof opts.signal.addEventListener === "function" ? opts.signal : null,
    signalHandler: null,
  };
  rec.done = new Promise((resolve) => {
    rec.settle = resolve;
  });
  records.set(id, rec);
  emit(rec);

  if (rec.signal) {
    rec.signalHandler = () => cancel(id);
    rec.signal.addEventListener("abort", rec.signalHandler, { once: true });
    if (rec.signal.aborted) rec.signalHandler();
  }

  const dispatch = async () => {
    // The record is re-checked after every await. A cancel can land in any of
    // these gaps, and a step that ran on regardless would open a stream nobody
    // closes or post a request the user already took back.
    if (rec.state !== "sent") return;
    if (rec.helper) {
      const supported = await hostSupports(HELPER_EXTENSION);
      if (rec.state !== "sent") return;
      if (!supported) {
        finish(rec, "error", "this host does not support named wire helpers", {
          errorCode: "helper_protocol_unsupported",
          errorSource: "client",
        });
        return;
      }
    }

    if (rec.document === "edit") {
      await holdSaving(rec);
      if (rec.state !== "sent") return;

      await flushSave();
      if (rec.state !== "sent") return;
    }

    // Subscribe before posting. A handler can acknowledge in single-digit
    // milliseconds, a fresh subscription deliberately replays nothing, and only
    // terminal frames are retained at all, so posting first is how a page ends
    // up watching a request whose ack it already missed.
    await openStream();
    if (rec.state !== "sent") {
      closeStreamIfIdle(); // the stream this cancelled request just opened
      return;
    }

    // Armed BEFORE the POST, not after it. A stalled fetch would otherwise leave
    // the request unbounded, and an ack that arrives while the POST is still in
    // flight — the ordinary case, since the page subscribed first — would be
    // followed by a fresh ack timer that fails a healthy request 15s later.
    arm(
      rec,
      ACK_TIMEOUT_MS,
      "the agent never answered",
      rec.helper ? { cancelFirst: true, errorCode: "ack_timeout" } : undefined
    );

    const body = { type: rec.type, id: rec.id, text: opts.text, payload };
    if (rec.helper) body.helper = rec.helper;
    if (rec.helper || opts.document !== undefined) body.document = rec.document;
    const { ok, status, reply } = await postFrame(body, rec.abort?.signal);

    // A frame may have moved this request on while its own POST was in flight.
    // Only a request still waiting on that POST may be failed by it.
    if (rec.state !== "sent") return;

    if (!ok) {
      finish(rec, "error", `the wire refused this request (${status})`);
      return;
    }
    // A typed refusal on the reply beats the generic reading of delivered: 0.
    // The host sends the same refusal down the stream, but the reply and the
    // stream are two connections with no ordering between them, so settling on
    // delivered: 0 first would discard it and report "no agent is attached" for a
    // handler that was attached and refused for a specific, reportable reason.
    const refused = reply && reply.refused;
    if (refused && typeof refused.code === "string" && refused.code) {
      finish(rec, "error", refused.message || "the handler refused this request", {
        errorCode: refused.code,
        errorSource: refused.source === "application" ? "application" : "host",
        errorDetails: null,
      });
      return;
    }
    if (!reply || reply.delivered === 0) {
      // Accepted by the router and taken by nobody. Reporting this as an error
      // rather than a pending request is the difference between a UI that says
      // "start an agent" and one that spins forever.
      finish(rec, "error", "no agent is attached to this file");
    }
  };

  dispatch().catch((err) => {
    finish(rec, "error", err && err.message ? err.message : String(err));
  });

  return {
    id,
    get state() {
      return rec.state;
    },
    done: rec.done,
    cancel: () => cancel(id),
  };
}

function rejected(id, type, helper, error, errorCode) {
  const rec = {
    id,
    type,
    state: "error",
    helper,
    text: "",
    result: null,
    error,
    errorCode,
    errorDetails: null,
    errorSource: "client",
    startedAt: Date.now(),
  };
  return {
    id,
    get state() {
      return rec.state;
    },
    done: Promise.resolve(view(rec)),
    cancel: () => false,
  };
}

/**
 * Stop completely: the request ends here, its late frames are ignored, and the
 * handler is asked to stop. A cancel that only hid the spinner would leave the
 * agent writing the file the user just took back.
 */
function cancel(id) {
  const rec = records.get(id);
  if (!rec || !OPEN_STATES.has(rec.state)) return false;
  postCancel(rec);
  finish(rec, "cancelled", null);
  return true;
}

function postCancel(rec) {
  postFrame({ type: "wire/cancel", id: rec.id }).catch(() => {});
}

function get(id) {
  const rec = records.get(id);
  return rec ? view(rec) : undefined;
}

function list() {
  return [...records.values()].map(view);
}

function isBusy() {
  for (const rec of records.values()) {
    if (OPEN_STATES.has(rec.state)) return true;
  }
  return false;
}

function on(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function helpers() {
  const meta = await hostMeta({ fresh: true });
  if (!meta.extensions.includes(HELPER_EXTENSION)) return [];
  const declared = meta.document?.helpers;
  if (!Array.isArray(declared)) return [];
  return declared
    .filter((helper) =>
      helper &&
      typeof helper.name === "string" &&
      ["ready", "denied", "unavailable"].includes(helper.state)
    )
    .map(({ name, state }) => ({ name, state }));
}

export const wire = { send, cancel, get, list, isBusy, on, helpers };

export default wire;
