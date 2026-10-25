/**
 * save-core.js — Network save functionality
 *
 * This module handles sending page contents to the server.
 * It uses snapshot.js for capturing the DOM state.
 *
 * For full save system with state management, use save.js instead.
 */

import { isEditMode, isDraftMode } from "./is-edit-mode.js";
import { draftTransport } from "./draft-mode.js";
import { consumeUserDriven, consumeExplicitSave, markUserDriven } from "../lib/user-gesture.js";
import { saveToken } from "./host-attrs.js";
import { lastSeenEtag, conditionalSaves, recordEtag } from "./etag.js";
import { hostMeta } from "./host-meta.js";
import "./runtime-url.js";
import {
  getPageContents,
  onSnapshot,
  addDocumentTransform,
  currentCaptureId,
  captureArtifact,
  releaseCaptureArtifact
} from "./snapshot.js";

// =============================================================================
// STATE
// =============================================================================

let saveInProgress = false;
const SAVE_PATH = '/_/save';
const SAVE_TIMEOUT_MS = 12000;
// The browser caps a keepalive body (Chromium refuses one over 64 KB), and it counts
// BYTES: the hint is only attached to a save whose UTF-8 encoding fits well inside that.
const KEEPALIVE_MAX_BODY = 60000;
// Set by `withKeepalive`, read once by the next `sendOnce`: the hint belongs to one
// request, not to the save pipeline.
let nextSaveKeepalive = false;

// Listeners for "the host took these exact bytes". This is the only place in the
// library that knows both the body that went out and that the host accepted it, and
// the two together are what make the bytes a fact about the file rather than a guess:
// a capture says what we would send, a success says a write happened, and only their
// conjunction says what is on disk. The source map uses it to re-model, so the next
// save is measured from the file as it now is.
//
// Not a DOM event, deliberately. The whole document rides in the argument, and a
// CustomEvent would put it on a bus any script on the page can listen to.
const saveAcceptedHooks = [];

// Headers another module asks every save to carry, by name.
const extraSaveHeaders = new Map();

/**
 * Add a header to every save from now on, or remove it with a null value.
 *
 * @param {string} name
 * @param {string|null} value
 */
export function setSaveHeader(name, value) {
  if (value == null) extraSaveHeaders.delete(name);
  else extraSaveHeaders.set(name, String(value));
}

/**
 * Send the next save with `keepalive`, so a request whose page is going away (a tab
 * closing, a navigation) is still finished by the transport.
 *
 * A transport hint and nothing more: the save is the same save, and the body has to
 * fit the browser's keepalive cap for the hint to go on the wire at all.
 *
 * @param {boolean} keepalive
 * @param {Function} run - the save to run with the hint set
 * @returns {Promise<Object>} whatever `run` resolves with
 */
export async function withKeepalive(keepalive, run) {
  nextSaveKeepalive = Boolean(keepalive);
  try {
    return await run();
  } finally {
    nextSaveKeepalive = false;
  }
}

/**
 * Check if a save is currently in progress.
 * @returns {boolean}
 */
export function isSaveInProgress() {
  return saveInProgress;
}

/**
 * Run a callback with the bytes the host just accepted.
 *
 * Called once per accepted save, after the response, with the exact body that was
 * sent. Never called for a refused, failed or skipped save, and never in test mode,
 * where nothing reached a host.
 *
 * @param {Function} callback - Receives the accepted HTML string
 */
export function onSaveAccepted(callback) {
  saveAcceptedHooks.push(callback);
}

function notifySaveAccepted(html, captureId, artifact = null) {
  for (const hook of saveAcceptedHooks) {
    try {
      // The artifact is the capture's own private model of these bytes, and it is
      // offered only when it exists: a raw save and a capture without one keep the
      // shape they had.
      const accepted = artifact
        ? { captureId: captureId ?? null, artifact }
        : { captureId: captureId ?? null };
      hook(html, accepted);
    } catch (err) {
      console.error('clayjs: onSaveAccepted hook failed:', err);
    }
  }
}

// Listeners for "this exact body is about to leave". One call per real fetch, with
// the capture identity the bytes came from, so a recovery can bind its evidence to
// the request rather than guess from timing or from the newest global capture.
const saveAttemptHooks = [];
// Listeners for "this logical save has settled", once each. The point is the pair
// (which capture, which actual sends), which is what an uncertain attempt later
// has to prove.
const saveOutcomeHooks = [];

/**
 * Observe each real send of a save, synchronously before the fetch.
 *
 * @param {Function} listener - Receives {captureId, saveId, html, etag}
 * @returns {Function} unsubscribe
 */
export function onSaveAttempt(listener) {
  saveAttemptHooks.push(listener);
  return () => {
    const index = saveAttemptHooks.indexOf(listener);
    if (index >= 0) saveAttemptHooks.splice(index, 1);
  };
}

/**
 * Observe the settlement of one logical save, after any accepted hook and before
 * the caller's callback.
 *
 * @param {Function} listener - Receives {captureId, result, attempts, sent}
 * @returns {Function} unsubscribe
 */
export function onSaveOutcome(listener) {
  saveOutcomeHooks.push(listener);
  return () => {
    const index = saveOutcomeHooks.indexOf(listener);
    if (index >= 0) saveOutcomeHooks.splice(index, 1);
  };
}

function notifySaveAttempt(attempt) {
  for (const hook of saveAttemptHooks) {
    try {
      hook(attempt);
    } catch (err) {
      console.error('clayjs: onSaveAttempt hook failed:', err);
    }
  }
}

function notifySaveOutcome(outcome) {
  for (const hook of saveOutcomeHooks) {
    try {
      hook(outcome);
    } catch (err) {
      console.error('clayjs: onSaveOutcome hook failed:', err);
    }
  }
}

// =============================================================================
// RE-EXPORTS FROM SNAPSHOT (for backwards compat)
// =============================================================================

export { getPageContents, onSnapshot, addDocumentTransform };

// =============================================================================
// THE RESULT
// =============================================================================
// One shape from every entry point: {ok, msg, msgType, code, etag}. There used to
// be three shapes — two callback conventions and a hand-built third — which is how
// a skipped save came to be read as a successful one.
//
// `ok` is the OUTCOME: did these bytes reach the server and get accepted. `msgType`
// is the SEVERITY, and it belongs to the server, which can answer a perfectly good
// save with 'warning' (htmlclay does, when an outside process touched the file).
// Reading the severity as the outcome means treating that warning as a failure.

function successResult(data) {
  return {
    ok: true,
    msg: data.msg ?? 'Saved',
    msgType: data.msgType || 'success',
    code: data.code ?? null,
    etag: data.etag ?? null
  };
}

// =============================================================================
// THE ATTEMPT ID (spec §6, `receipts`)
// =============================================================================
// A save that times out leaves two questions open at once: did our write land,
// and did somebody else write. The client cannot answer either from the outside.
// Guessing "it was me" is what the old reconcile-on-timeout did, and when the
// guess was wrong it adopted a stamp describing a peer's bytes this tab had never
// seen, so the next save overwrote them with no refusal and no notice. Refusing to
// guess is safe but shows a person a conflict bar for a few seconds of bad wifi.
//
// So this tab stamps every attempt with an opaque id and asks the host the one
// question only the host can answer: are the bytes you are storing the ones this
// save sent? A host that answers turns an indeterminate save into a determinate
// one, and the person sees nothing at all.
//
// The ids this tab has sent, newest last. A 412 carrying one of them is the host
// saying "your OWN earlier save is what moved this document", which is a late
// duplicate and not a conflict with anybody. Bounded because it is only ever
// searched for a recent send.
const sentIds = [];
const SENT_ID_MEMORY = 8;

// The attempt whose answer never arrived, or null. It holds only what is needed to
// ask about it later: which id it carried, and which stamp it was sent against.
//
// It survives ONLY while the question is genuinely open. A host that answers, in
// either direction, closes it, which is what keeps the conflict bar from claiming
// a refusal might be the person's own save when the host has already said it is
// not. An unreachable host leaves it set, and that is the honest old behaviour:
// the stamp is kept, the next save is refused rather than accepted, and the notice
// says so.
let unknownAttempt = null;

/** True while an earlier save may or may not have landed (spec §7). */
export function saveFateIsUnknown() {
  return unknownAttempt !== null;
}

/**
 * A fresh id for one save attempt.
 *
 * Uniqueness per attempt is the whole property: two tabs sharing an id would each
 * read the other's receipt as proof of their own write. `getRandomValues` into a
 * zeroed array is the failure that would do exactly that, silently, so a missing
 * crypto implementation falls back to something random rather than to zeros.
 */
export function mintSaveId() {
  const uuid = window.crypto?.randomUUID?.();
  if (uuid) return uuid;
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  // Three segments, not one: §6 asks for at least 128 bits, and one `Math.random()`
  // truncated to ten base-36 characters carries about 52. A timestamp is not entropy,
  // so it cannot make up the difference between two tabs minting in the same
  // millisecond, which is the collision that matters.
  const segment = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${Date.now().toString(36)}-${segment()}${segment()}${segment()}`;
}

function rememberSentId(saveId) {
  sentIds.push(saveId);
  if (sentIds.length > SENT_ID_MEMORY) sentIds.shift();
}

/**
 * Did this tab send this id at all?
 *
 * The weaker of the two questions asked of a receipt, and it belongs only to the
 * late-duplicate rule: a 412 naming ANY id this tab sent means this tab's own
 * earlier save is what moved the document, which is enough to adopt that stamp and
 * send again, because sending again is all that follows. It is never enough to
 * conclude that a particular save landed. That needs identity with that save's own
 * id, which is what recoverUnknownSave asks.
 */
function sentByThisTab(saveId) {
  return typeof saveId === "string" && saveId !== "" && sentIds.includes(saveId);
}

/** Test-only: forget every id and any open question. */
export function resetSaveAttempts() {
  sentIds.length = 0;
  unknownAttempt = null;
}

function errorResult(err) {
  const timedOut = err.name === 'AbortError';
  // Spec §6: a 412 is a REFUSED save, not a failed one. The host wrote nothing and
  // its document is byte-identical to what it was, and the bytes we tried to write
  // are still on this page. Reporting that as 'error' would give the one outcome
  // where nothing went wrong the one severity that means something did, and would
  // put it through the same retry-and-toast path as a dead server.
  // The status is authoritative (§3), so the 412 alone decides this. Reading `code`
  // as well let any other status claim a conflict, and it bought nothing: a proxy
  // answering 412 with no body carries no code to read, so the fallback never
  // covered the case it was written for. What it did cover was htmlclay's
  // truncation refusal, a 409 that lifts itself within a second, which suspended
  // autosave over a condition that had already cleared.
  const conflicted = !timedOut && err.status === 412;
  // A save the host has already applied is proof a write happened, but not proof
  // of what the document holds now: the client's edits are neither confirmed on
  // disk nor known to be absent. It is an uncertain outcome, like a timeout, and
  // until recovery lands it is carried as one rather than reported as a failure.
  const alreadyApplied = !timedOut && !conflicted && err.code === 'save-already-applied';
  return {
    ok: false,
    msg: timedOut ? 'Server not responding' : (err.message || 'Save failed'),
    // A timeout is not evidence the write failed. The request may well have landed,
    // so this reports "we do not know" rather than asserting something false.
    msgType: timedOut || alreadyApplied ? 'unknown' : (conflicted ? 'conflict' : 'error'),
    code: timedOut ? 'timeout' : (conflicted ? 'conflict' : (err.code ?? null)),
    changedBy: conflicted ? (err.changedBy ?? null) : null,
    // A refusal that may be answering this tab's own timed-out write. Only the
    // notice uses it, and only to word itself; nothing decides anything on it.
    afterTimeout: conflicted && unknownAttempt !== null,
    // The stamp the host refused this save against: the version that beat it.
    // Live sync compares it with the frames it merges to know when the refusal
    // is answered.
    conflictEtag: conflicted ? (err.etag ?? null) : null,
    // The host's answer, null when none came (a lost connection or a timeout).
    status: Number.isInteger(err.status) ? err.status : null,
    // An attempt of this save timed out, so it may have landed whatever the
    // final answer says.
    hadTimeout: timedOut || err.hadTimeout === true,
    // The typed refusal behind `code`, kept for the caller: `page-capacity` carries
    // which limit was hit, the conversion codes carry which condition failed.
    reason: err.reason ?? null,
    // Only meaningful while a save can still retry; a caller sees how long the
    // host asked it to wait. Null when the host named no delay.
    retryAfter: err.retryAfter ?? null,
    // The host's answer to a save that already happened. Only `save-already-applied`
    // produces one, and recovery is what will act on it.
    saveOutcome: err.saveOutcome ?? null,
    etag: null
  };
}

function skippedResult(msg) {
  return { ok: false, msg, msgType: 'skipped', code: null, etag: null };
}

// The metadata a caller attaches to a capture was refused here, before anything
// went out. The host's own grammar is the only definition of valid, so an
// `invalid-header` here is the same answer a host would have given, without the
// request. Nothing about an ordinary save changes.
function invalidHeaderResult() {
  return { ok: false, msg: 'Invalid page conversion metadata', msgType: 'error', code: 'invalid-header', etag: null };
}

// How many extra sends one logical save may make while the host is still
// converting the page. `page-converting` is a pre-commit refusal, so the same
// body is worth offering again; anything else is surfaced on the first answer.
const PAGE_CONVERTING_MAX_RETRIES = 3;
const HTTP_DATE = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/;

/**
 * Decode a `Retry-After` header into whole seconds.
 *
 * The header is either an integer number of seconds or an HTTP date, per RFC 7231.
 * A date is measured against now, because that is the only clock both sides could
 * mean. Clamped to 0..3600 so a bogus or hostile value cannot park a save for a
 * day; anything that is neither shape, or absent, is null.
 */
function parseRetryAfter(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return Math.max(0, Math.min(3600, Number(raw)));
  if (!HTTP_DATE.test(raw)) return null;
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.min(3600, Math.round((when - Date.now()) / 1000)));
}

// The host grammar for `Page-Conversion`, from `server-lib/page-conversion.js`:
// `file` takes a 64-lowercase-hex baseline and no epoch; `room` takes the same
// baseline plus an epoch of [A-Za-z0-9-]{1,64}. Validating here means a caller
// with bad metadata gets a typed answer instead of a wasted round trip.
const CONVERSION_BASE = /^[0-9a-f]{64}$/;
const CONVERSION_EPOCH = /^[A-Za-z0-9-]{1,64}$/;

function formatConversionHeader(conversion) {
  if (conversion == null) return { header: null };
  if (typeof conversion !== 'object') return { invalid: true };
  const { source, base, epoch } = conversion;
  if (typeof base !== 'string' || !CONVERSION_BASE.test(base)) return { invalid: true };
  if (source === 'file') {
    if (epoch != null) return { invalid: true };
    return { header: `v1; source=file; base=${base}` };
  }
  if (source === 'room') {
    if (typeof epoch !== 'string' || !CONVERSION_EPOCH.test(epoch)) return { invalid: true };
    return { header: `v1; source=room; base=${base}; epoch=${epoch}` };
  }
  return { invalid: true };
}

// =============================================================================
// THE WIRE
// =============================================================================
// One request builder and one response decoder. Keeping two copies of the request
// is what let four separate wire bugs hide at once, each of which had to be found
// twice.

/**
 * Build the save request for this host.
 *
 * htmlclay (the local Go app for .htmlclay files) authenticates each save with a
 * per-file token on the root and carries it in the URL path, so the same token
 * works for fetch and EventSource. The platform and Hyperclay Local authenticate
 * by cookie and use the bare endpoint.
 *
 * A token save asks for no cookies at all. The token IS the credential, and a
 * credentialed cross-origin request needs Access-Control-Allow-Credentials back;
 * a host that mints per-document tokens must never send that header, because
 * `Origin: null` is forgeable and must not buy ambient authority. Asking anyway
 * gets every sandboxed save blocked before it leaves the browser.
 *
 * The endpoint is resolved against the real origin rather than left relative,
 * because a <base href> anywhere in the authored document would otherwise redirect
 * the save — and the per-document token in its path — to an origin the document
 * itself chose.
 *
 * The body is the document, as text, always. Spec §3: this route has exactly one
 * body shape. Everything else about the save travels in a header, which is how
 * §6's `conditional` capability added `If-Match` without touching the body, and
 * how anything later will be added too. There used to be a JSON envelope here
 * carrying the document alongside an unstripped snapshot; the snapshot's home is
 * the §10 relay, which the live-sync plugin already posts it to.
 *
 * @param {string} content - HTML to save
 * @param {boolean} userDriven - Whether a human gesture is behind this save
 * @param {AbortSignal} signal
 * @param {string} saveId - this attempt's §6 receipt id
 * @param {?string} etag - the stamp to send as If-Match, or null
 * @param {boolean} keepalive - whether to ask the transport to see the request through
 * @param {?string} conversionHeader - the `Page-Conversion` value for this logical save, or null
 * @returns {{url: string, options: Object}}
 */
export function buildSaveRequest(content, userDriven, signal, saveId, etag, keepalive = false, conversionHeader = null) {
  const token = saveToken();
  const path = token ? `${SAVE_PATH}/${token}` : SAVE_PATH;
  const options = {
    method: 'POST',
    credentials: token ? 'omit' : 'same-origin',
    signal,
    headers: {
      'Document-URL': window.location.href,
      // The older spelling of the same header, which htmlclay reads today.
      'Page-URL': window.location.href,
      // Spec §9's name for the provenance bit. `X-Hyperclay-User-Driven` was the
      // pre-spec spelling; every host reads Save-Trigger first and falls back to
      // it, so stored documents running an older client keep working.
      'Save-Trigger': userDriven ? 'user' : 'auto',
      // Spec §6 (`receipts`): which attempt this is. Sent to every host, because a
      // host that does not implement receipts ignores an unknown header, and
      // gating it on discovery would mean holding the save until an async lookup
      // resolved. Nothing is inferred from the header being accepted: only a host
      // that ANSWERS with the id has said anything.
      'Save-ID': saveId
    },
    body: content
  };

  for (const [name, value] of extraSaveHeaders) options.headers[name] = value;

  // The conversion request belongs to ONE logical save, and goes on every attempt
  // of it. Set after the process-global headers so the capture-bound value is the
  // one that describes these bytes.
  if (conversionHeader) options.headers['Page-Conversion'] = conversionHeader;

  if (etag) options.headers['If-Match'] = etag;

  if (keepalive && new Blob([content]).size < KEEPALIVE_MAX_BODY) options.keepalive = true;

  return { url: resolveSaveUrl(path), options };
}

/**
 * The stamp to send as If-Match, or null for a save that goes out unconditional.
 *
 * Two gates, and both are the point. The capability must have been announced by
 * name, because §5 forbids inferring one any other way, and a host that never
 * promised to honour If-Match may do anything at all with it. And a stamp must
 * actually be held: a host reads the header's PRESENCE, so an empty value is not a
 * softer version of the request, it is a save asking to be refused.
 */
function stampToSend() {
  const etag = lastSeenEtag();
  return conditionalSaves() && etag ? etag : null;
}

/**
 * The absolute URL a save goes to.
 *
 * A relative path is resolved by fetch against the DOCUMENT's base URL, which
 * `<base href>` sets and the author of a malleable document controls. Left
 * relative, a `<base href="https://elsewhere.example/">` sends the document and
 * the per-document token in the path to an origin the document picked. Pinning to
 * the real origin is the whole fix.
 *
 * The guard is not defensive noise. `window.location.origin` is the STRING "null"
 * on a file:// document, and `new URL(path, "null")` throws a TypeError, which
 * would escape synchronously here rather than becoming a failed save. Documents
 * opened from disk are a first-class case (an exported app is just a file), and
 * there is no origin to pin to and no host to save to there anyway, so the
 * relative path is both the honest answer and the one that cannot throw.
 *
 * @param {string} path - Root-relative save path
 * @returns {string}
 */
function resolveSaveUrl(path) {
  const origin = window.location.origin;
  if (!origin || origin === "null") return path;
  return new URL(path, origin).href;
}

function draftResponse(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Insufficient Storage", text: () => Promise.resolve(text) };
}

function sendToDraftStore(content) {
  const send = draftTransport();
  if (!send) return Promise.resolve(draftResponse(503, { msg: "Saving in this browser is not ready yet", msgType: "error", code: "draft-not-ready" }));
  return Promise.resolve().then(() => {
    try {
      send(content);
      return draftResponse(200, { msg: "Saved in this browser", msgType: "success" });
    } catch (error) {
      return draftResponse(507, { msg: "Couldn't save in this browser. Storage is full or turned off.", msgType: "error", code: error.code || "draft-storage" });
    }
  });
}

/**
 * Send one save and decode one response.
 *
 * Resolves with the server's JSON body: `msg` and `msgType` everywhere, plus
 * `code` and `etag` from a host that follows the spec. Rejects with the raw error,
 * carrying the server's message and `code` when it answered at all.
 *
 * The body is read as text and parsed defensively BEFORE the status is consulted.
 * Calling res.json() first meant a 200 with an empty body reported failure over a
 * save that had landed, and a 502 HTML error page surfaced as "Unexpected token '<'"
 * instead of the status.
 *
 * @param {string} content - HTML to save
 * @param {string} saveId - this attempt's receipt id
 * @param {?string} etag - the stamp to send as If-Match, or null
 * @param {Object} [context]
 * @param {?number} [context.captureId] - the capture these bytes came from
 * @param {?string} [context.conversionHeader] - per-logical-save conversion header
 * @param {Array} [context.attempts] - collects each unique actual send
 * @returns {Promise<Object>} The server's response body
 */
function sendOnce(content, saveId, etag, { captureId = null, conversionHeader = null, attempts = [] } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);

  // Read-and-reset the data-guard provenance bit at the ACTUAL send (past the
  // early returns in the callers), so it's never consumed on a save that never
  // ships.
  // Two independent ways a save is human: an edit made in a trusted turn, or a
  // person pressing Save. Both are consumed here, at the one point past every
  // early return, so neither can survive into an unrelated later save.
  const gestureDriven = consumeUserDriven();
  const explicitlyAsked = consumeExplicitSave();
  const userDriven = gestureDriven || explicitlyAsked;
  // Read-and-reset here too, at the one send that can still honour it: a save that
  // returns early never reaches this point, so the hint cannot leak onto a later one.
  const keepalive = nextSaveKeepalive;
  nextSaveKeepalive = false;
  const { url, options } = buildSaveRequest(content, userDriven, controller.signal, saveId, etag, keepalive, conversionHeader);
  rememberSentId(saveId);

  // A draft save is not a request to any host and has no receipt to recover, so it
  // is not an attempt as far as this feature is concerned.
  if (!isDraftMode) {
    if (!attempts.some(attempt => attempt.saveId === saveId && attempt.etag === (etag ?? null))) {
      attempts.push({ saveId, etag: etag ?? null });
    }
    notifySaveAttempt({ captureId, saveId, html: content, etag: etag ?? null });
  }

  return (isDraftMode ? sendToDraftStore(content) : fetch(url, options))
    .then(res => res.text().then(text => {
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (err) {
          if (res.ok) throw new Error('Server sent a response that was not JSON');
        }
      }
      if (!res.ok) {
        const error = new Error(data.msg || data.error || `HTTP ${res.status}: ${res.statusText}`);
        error.code = data.code ?? null;
        error.status = res.status;
        // Spec §6: a conflict may name what moved the document. Only the host can
        // know, and it often cannot, so this rides through as-is and the notice
        // falls back to a phrase that is true either way.
        error.changedBy = data.changedBy ?? null;
        // §6: the stamp of the bytes that caused the refusal, and the receipt for
        // them. Both are what let a refusal be recovered from instead of merely
        // reported: the stamp is what the retry has to carry, and the receipt says
        // whether the document was moved by this tab's own earlier save.
        error.etag = data.etag ?? null;
        error.saveId = data.saveId ?? null;
        // The refusal's own vocabulary. `reason` is the typed cause behind the
        // stable `code`, and both ride out unchanged so a caller can act on the
        // specific one. `saveOutcome` is the host's receipt answer to a duplicate
        // that already landed, and it is the whole reply to a client whose own
        // response was lost.
        error.reason = typeof data.reason === 'string' ? data.reason : null;
        error.saveOutcome = data.saveOutcome ?? null;
        error.retryAfter = parseRetryAfter(res.headers?.get?.('Retry-After'));
        throw error;
      }
      // The one place a stamp is ever learned from a save (§6). A response with no
      // etag clears it rather than keeping the old one, because the write we just
      // made means any stamp held here describes bytes the host no longer stores.
      recordEtag(data.etag ?? null);
      // A write the host answered: whatever an earlier timeout left uncertain,
      // this document's version is known again.
      unknownAttempt = null;
      return data;
    }))
    .catch(err => {
      console.error('Failed to save page:', err);
      // Spec §7: a timeout is INDETERMINATE. The stamp is deliberately NOT
      // reconciled against the host here; what this records is the question, so
      // recovery below can ask it. The old code adopted the host's current stamp
      // on the guess that our own write was what moved the document, which was
      // wrong exactly when somebody else wrote.
      if (err.name === 'AbortError') unknownAttempt = { saveId, etag };
      // The save never landed: re-arm the user-driven bit so the next (retry)
      // save still reports the human gesture instead of reading as background.
      if (userDriven) markUserDriven();
      throw err;
    })
    .finally(() => {
      clearTimeout(timeoutId);
    });
}

/**
 * Ask the host what became of the attempt whose answer never arrived (spec §7).
 *
 * One question, one round trip, and only two things to do with the answer:
 *
 *   - the host's receipt is ours, so the bytes it stores are the ones this save
 *     sent. The save landed. Adopt the stamp for those bytes and report success:
 *     the person sees a save that worked, because one did.
 *   - anything else, including a host that keeps no receipts at all: send the save
 *     again, under the ORIGINAL If-Match.
 *
 * The second case looks like it needs to know more than it does, and it does not,
 * because the stamp is what makes it safe. If our write did land, the stamp is now
 * stale and the re-send is REFUSED, carrying the host's receipt for the bytes that
 * refused it; that receipt is ours, and the late-duplicate rule in sendSave turns
 * it back into a finished save without a word to anybody. If somebody else wrote,
 * the same refusal carries their bytes and becomes an honest conflict. And if
 * nothing landed, the stamp still matches and the save simply goes through.
 *
 * So there is no branch here that guesses. Every outcome is decided by a host
 * answering a conditional request, which is the one thing in this protocol that
 * cannot be wrong.
 *
 * A host that cannot be reached leaves the question open, which is the older
 * behaviour and the honest one: the stamp is kept, the next save is refused rather
 * than accepted, and the notice says the refusal may be answering this tab's own
 * timed-out save.
 *
 * @returns {Promise<{landed: ?Object, resend: boolean}>}
 */
async function recoverUnknownSave() {
  const attempt = unknownAttempt;
  if (!attempt) return { landed: null, resend: false };

  const meta = await hostMeta({ fresh: true });
  const doc = meta.document;
  const stored = typeof doc?.etag === 'string' && doc.etag ? doc.etag : null;
  if (!stored) return { landed: null, resend: false };

  // THIS attempt's id, and no other. A receipt is proof about the save that carried
  // that exact id, so an earlier save of this same tab naming itself proves only
  // that the earlier save landed, which is a thing already known and says nothing
  // about this one. Matching any id this tab has sent turns the most ordinary
  // failure there is, a request that never left the browser, into a reported
  // success: the tab shows Saved, advances its baselines, drops the close warning,
  // and the bytes are on no disk anywhere. Membership is the right test one line
  // down in sendSave, where a 412 only ever leads to another conditional send.
  if (doc.saveId && doc.saveId === attempt.saveId) {
    // Proof, not inference: the host is saying the bytes it stores are the stored
    // form of the body THIS save sent. §6 lets a client adopt a stamp on exactly that.
    recordEtag(stored);
    unknownAttempt = null;
    return { landed: { msg: 'Saved', msgType: 'success', etag: stored }, resend: false };
  }

  // Positive proof, and nothing weaker, closes the question. A non-empty id that is
  // not ours names another save as the author of these bytes. An ABSENT id proves
  // nothing at all: §6 lets a host lose its pair to a restart or an eviction and stay
  // conforming, so a host that keeps receipts can report none for bytes this tab
  // really did write. Reading absence as "somebody else wrote" makes the notice tell
  // a person their own save was somebody else's change.
  if (doc.saveId) unknownAttempt = null;

  // The re-send carries the stamp the ORIGINAL save carried, which is the normative
  // rule and not a detail: the stamp this tab holds is mutable and moves for reasons
  // that have nothing to do with this save, because a disk-sourced live-sync frame
  // records the stamp of the bytes it applied. Re-sending under that one is a write
  // conditional on a version this save was never judged against, and the host accepts
  // it, replacing bytes the person has just been shown with bytes captured before
  // they arrived.
  //
  // No stamp at all means there is nothing to re-send under, so nothing is re-sent.
  // An unconditional recovery write has no comparison to refuse it and would replace
  // whatever landed while this tab was waiting, which is the loss this whole
  // capability exists to prevent.
  return { landed: null, resend: !!attempt.etag, etag: attempt.etag };
}

/**
 * Send one save, and see it through.
 *
 * Two things can happen that are not the save's own outcome, and both are handled
 * here rather than reported:
 *
 *   - the request timed out, so the host is asked what became of it,
 *   - the host refused with a receipt this tab recognises, which means its own
 *     earlier save is what moved the document. That is a late duplicate, not a
 *     conflict with anybody: take the stamp the refusal handed back and finish
 *     the save that was refused.
 *
 * Each recovery sends at most one further request, so a save can never loop.
 *
 * @param {string} content - HTML to save
 * @param {Object} [context]
 * @param {?number} [context.captureId] - the capture these bytes came from
 * @param {?string} [context.conversionHeader] - per-logical-save conversion header
 * @param {Array} [context.attempts] - collects each unique actual send
 * @returns {Promise<Object>} The server's response body
 */
async function sendSave(content, { captureId = null, conversionHeader = null, attempts = [] } = {}) {
  // The re-send below is a RETRY of this attempt, so it carries this same id:
  // whichever of the two requests the host ends up storing, its receipt then
  // answers for this save. A fresh id on the re-send would leave the first
  // request's landing unprovable.
  let saveId = mintSaveId();
  let etag = stampToSend();
  // Each recovery runs at most once, and they are counted apart because they are
  // different things. Re-sending after a timeout is worth doing once: a second
  // timeout says the host is not answering this document in time, and sending a
  // whole document a third time will not change that. Resolving a late duplicate
  // is fast and conclusive, so it gets its own turn regardless.
  let reSent = false;
  let duplicateResolved = false;
  // `page-converting` is the one refusal that is worth offering the same bytes
  // again: the host has written nothing and is telling us when it expects to be
  // ready. The capture these bytes came from is pinned here, so a capture made
  // while we wait — newer edits, a disk frame — cancels the retry instead of
  // being overwritten by stale bytes.
  let convertingRetries = 0;
  // A bound save retries only while its own capture is still the newest. A raw
  // save has no capture identity, so it uses the newest capture at send time.
  const retryGuard = captureId ?? currentCaptureId();
  for (;;) {
    try {
      return await sendOnce(content, saveId, etag, { captureId, conversionHeader, attempts });
    } catch (err) {
      if (reSent) err.hadTimeout = true;
      if (err.name === 'AbortError') {
        if (reSent) throw err;
        const { landed, resend, etag: original } = await recoverUnknownSave();
        if (landed) return landed;
        if (!resend) throw err;
        // Explicitly the original, never `stampToSend()` again.
        etag = original;
        reSent = true;
        continue;
      }

      if (err.status === 412 && !duplicateResolved && sentByThisTab(err.saveId)) {
        // Our own earlier save is what the host is refusing us against: a late
        // duplicate, not a conflict with anybody. Adopt the stamp for those bytes
        // and send the current ones on top of it. The retry is still conditional,
        // so anything that arrives in between still refuses it.
        recordEtag(err.etag ?? null);
        unknownAttempt = null;
        saveId = mintSaveId();
        // A new attempt, deliberately on the base the host just proved is this tab's
        // own work, rather than on the stamp the refused attempt carried.
        etag = stampToSend();
        duplicateResolved = true;
        continue;
      }

      if (err.code === 'page-converting' && convertingRetries < PAGE_CONVERTING_MAX_RETRIES) {
        if (currentCaptureId() !== retryGuard) throw err;
        convertingRetries += 1;
        // Default a missing or unparseable header to one second, so a host that
        // asks for a retry without naming a delay still gets a bounded one.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, err.retryAfter ?? 1) * 1000));
        if (currentCaptureId() !== retryGuard) throw err;
        continue;
      }

      throw err;
    }
  }
}

// =============================================================================
// SAVE FUNCTIONS
// =============================================================================

// One private implementation behind every entry point, so the hooks see the same
// thing whether the bytes came from a bound capture or a raw caller. `captureId`
// is null for a raw save: it belongs to no capture and can confirm none.
function runSave(html, captureId, callback, conversion, capture = null) {
  return new Promise((resolve) => {
    const attempts = [];
    // Read once, before the first request: the artifact belongs to the capture that
    // produced these bytes, and it is released however this save settles. A timeout
    // recovered through the host's receipt reaches `accepted` like any other success,
    // so it adopts the artifact of the request that landed.
    const artifact = captureArtifact(capture);
    const finished = (result, accepted = false) => {
      if (accepted) notifySaveAccepted(html, captureId ?? null, artifact);
      releaseCaptureArtifact(capture);
      notifySaveOutcome({
        captureId: captureId ?? null,
        result,
        attempts,
        sent: attempts.length > 0
      });
      if (typeof callback === 'function') callback(result);
      resolve(result);
    };

    if (!isEditMode && !window.clay?.testMode) {
      return finished(skippedResult('Not in edit mode'));
    }
    if (saveInProgress) {
      return finished(skippedResult('Save already in progress'));
    }

    // Refused locally and before the lane is claimed: no request is made, and the
    // caller gets the same typed `invalid-header` a host would have sent back.
    const formatted = formatConversionHeader(conversion);
    if (formatted.invalid) {
      return finished(invalidHeaderResult());
    }

    saveInProgress = true;

    // Test mode: skip network request, return mock success
    if (window.clay?.testMode) {
      setTimeout(() => {
        saveInProgress = false;
        finished(successResult({ msg: 'Test mode: save skipped' }));
      }, 0);
      return;
    }

    sendSave(html, { captureId, conversionHeader: formatted.header, attempts })
      .then(successResult, errorResult)
      // Clear the flag BEFORE handing the result back, so a caller that queues a
      // follow-up save can start it immediately rather than being told the lane
      // is busy by the save that just finished.
      .then(result => {
        saveInProgress = false;
        if (result.ok) notifySaveAccepted(html, captureId ?? null, artifact);
        finished(result);
      });
  });
}

/**
 * Save specific HTML content to the server.
 *
 * Returns a Promise resolving with {msg, msgType, code, etag} — the same object
 * passed to the callback. Never rejects.
 *
 * @param {string} html - HTML string to save
 * @param {Function} callback - Called with the result on completion
 * @returns {Promise<{msg: string, msgType: string, code: ?string, etag: ?string}>}
 *
 * @example
 * const {msg, msgType} = await saveHtml(myHtml);
 * if (msgType === 'error') console.error('Save failed:', msg);
 */
export function saveHtml(html, callback = () => {}) {
  return runSave(html, null, callback, null);
}

/**
 * Save HTML that came from a specific capture.
 *
 * The capture id travels only in-process: it is what lets an attempt hook and an
 * outcome hook agree that these bytes and that snapshot are the same save. A
 * `conversion` request rides every attempt of this one logical save and no other.
 *
 * @param {string} html
 * @param {?number} captureId
 * @param {Function} [callback]
 * @param {Object} [options]
 * @param {Object} [options.conversion] - {source:'file', base} or {source:'room', base, epoch}
 * @returns {Promise<Object>}
 */
export function saveCapturedHtml(html, captureId, callback = () => {}, { conversion, capture = null } = {}) {
  return runSave(html, captureId, callback, conversion, capture);
}

/**
 * Internal entry point for the dormant adoption path: request conversion while
 * saving a capture's body. Not published on `window.clay`.
 *
 * @param {Object} request
 * @param {string} request.html
 * @param {?number} request.captureId
 * @param {Object} request.conversion
 * @returns {Promise<Object>}
 */
export function saveConversion({ html, captureId, conversion }) {
  return runSave(html, captureId ?? null, undefined, conversion);
}

/**
 * Fetch HTML from a URL and save it to replace the current page.
 *
 * Returns a Promise resolving with {msg, msgType, code, etag}. Never rejects.
 *
 * The fetch status is checked before the body is used: without that, pointing this
 * at a path that 404s saved the server's error page over the user's document.
 *
 * @param {string} url - URL to fetch HTML from
 * @param {Function} callback - Called with the result on completion
 * @returns {Promise<{msg: string, msgType: string, code: ?string, etag: ?string}>}
 */
export function replacePageWith(url, callback = () => {}) {
  return new Promise((resolve) => {
    const done = (result) => {
      if (typeof callback === 'function') callback(result);
      resolve(result);
    };

    if (!isEditMode) return done(skippedResult('Not in edit mode'));
    if (saveInProgress) return done(skippedResult('Save already in progress'));
    if (isDraftMode) return done(false);

    // Resolved against the document's real location, not a <base href> the page
    // may have set.
    fetch(new URL(url, window.location.href).href)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Template fetch failed: HTTP ${res.status} ${res.statusText}`);
        }
        return res.text();
      })
      .then(html => saveHtml(html))
      .then(done)
      .catch(err => {
        console.error('Failed to fetch template:', err);
        done(errorResult(err));
      });
  });
}
