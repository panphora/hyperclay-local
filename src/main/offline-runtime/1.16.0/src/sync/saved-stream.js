/**
 * saved-stream.js — the receive-only transport a reader follows saved files with.
 *
 * A reader has no write half. It needs the saved lane's startup GET, its frames and
 * its reconnect repair, and nothing else: no POST, no PATCH, no live relay, no page
 * store to admit anything into, and no write credentials. So this is a transport of
 * its own rather than a mode of live-sync.js, and it imports neither the save lane,
 * the live lane, the snapshot pipeline, the merge engine nor the editor.
 *
 * It owns a REPRESENTED RECEIPT — `{ bytes, etag, seq }` — and moves it only when
 * `onSnapshot` acknowledges a complete apply. `bytes` is one unmodified HTML string
 * from an accepted frame or GET, `etag` belongs to those bytes, and `seq` is the
 * resume floor that apply is known to cover. Transport watermarks never become part
 * of it: a cursor says what the stream will replay, not what this page holds.
 *
 * Branches, spelled out because each one is a way to show a reader a file it does
 * not hold or to hide one it does:
 *
 *   - a full frame with a newer sequence validates and applies; a duplicate or an
 *     older one is ignored without moving the receipt;
 *   - a frame with no sequence (an unstamped legacy host) is processed in arrival
 *     order and keeps `seq: null` rather than inventing one;
 *   - a cursor with `resync: true`, the startup version check and any content-less
 *     external-change or ETag notice refetch the served file with `cache: 'no-store'`;
 *     a stamp alone never repairs missing bytes, and a notice never moves the receipt;
 *   - a cursor jump without resync is transport bookkeeping only: other lanes consume
 *     numbers, so a gap does not prove a content frame is missing;
 *   - every host sends a sequence, so that orders the frames: a newer one applies and
 *     one the receipt already covers is ignored. A stamp confirms identity only when
 *     both sides carry one;
 *   - a frame repeating the bytes the article holds moves the receipt and repaints
 *     nothing;
 *   - after a GET the cursor is a covered replay floor, not an ordering of versions.
 *     The fetched body's version is unconfirmed until a frame names it, and a frame
 *     naming another stamp refetches rather than overwrite bytes that may be newer. A
 *     host that stamps neither side is ordered by sequence;
 *   - a body read while frames were still arriving is discarded in favour of one the
 *     stream can place, but only twice: a steady writer would otherwise starve the
 *     reader of every fetched body;
 *   - a bad frame, a refused apply or a failed GET keeps the article and the receipt
 *     and reports a recoverable status; it never pretends the file was acknowledged;
 *   - stop aborts and invalidates every outstanding continuation, and nothing calls
 *     back after it.
 */

import { SyncStream } from './stream.js';
import { resolveWireProfile } from './wire-profile.js';

const LANE = 'saved';
const MAX_DISCARDS = 2;

function mintClientId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function mintResumeId() {
  try {
    const bytes = new Uint8Array(16);
    (globalThis.crypto || window.crypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * The version a fetched served document names on its own root, or null. Read from
 * the body, never from discovery: discovery answers about a later moment than any
 * response. Parsed detached, so this touches the live page nowhere.
 */
function readBodyStamp(html) {
  if (typeof html !== 'string' || html === '') return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.documentElement?.getAttribute('documentetag') || null;
}

const stampOf = (value) => (typeof value === 'string' && value ? value : null);

/**
 * The page URL every request in this module resolves against, or null when the page
 * has no host to follow. `file://` and a sandboxed frame have an opaque origin:
 * `window.location.origin` is the string `"null"` there and `new URL` refuses it as
 * a base, and a `file:` page URL names no server either way. Opening a stream on
 * such a page is not a failure to report, it is a request that does not exist.
 */
function resolvePageURL(documentURL) {
  const origin = window.location.origin;
  // The string `"null"` is what an opaque origin reports, and `new URL` refuses it
  // as a base before any `file:` page URL is even read.
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return null;
  const url = new URL(documentURL || window.location.href, origin);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

const seqOf = (value) => (Number.isSafeInteger(value) ? value : null);

function normalizeReceipt(represented) {
  if (represented == null) return Object.freeze({ bytes: null, etag: null, seq: null });
  if (typeof represented.bytes !== 'string' || represented.bytes === '') {
    throw new TypeError('createSavedStream: represented.bytes must be a full HTML string');
  }
  return Object.freeze({
    bytes: represented.bytes,
    etag: stampOf(represented.etag),
    seq: seqOf(represented.seq),
  });
}

/**
 * Follow saved frames for one reader.
 *
 * `onSnapshot(candidate)` runs synchronously and returns true only after the whole
 * candidate applied, so the receipt moves on acknowledgement and nowhere else. The
 * page URL is resolved against the real origin, never `document.baseURI`: a `<base>`
 * in the authored document must not choose where the reader streams or fetches.
 *
 * @param {Object} options
 * @param {string} [options.documentURL] - The page whose saved file to follow.
 * @param {?string} [options.servedEtag] - The stamp this response was served with.
 * @param {?{bytes: string, etag: ?string, seq: ?number}} [options.represented]
 * @param {function({bytes: string, etag: ?string, seq: ?number}): boolean} options.onSnapshot
 * @param {function(Object)} [options.onStatus]
 * @returns {{start: function(): Object, adopt: function(Object): Object, stop: function(), ready: ?Promise, represented: Object}}
 */
export function createSavedStream({ documentURL, servedEtag = null, represented = null, onSnapshot, onStatus } = {}) {
  if (typeof onSnapshot !== 'function') {
    throw new TypeError('createSavedStream: onSnapshot must be a function');
  }

  const pageURL = resolvePageURL(documentURL);
  const startupCheck = Boolean(stampOf(servedEtag));

  let receipt = normalizeReceipt(represented);
  // An opaque origin — `file://`, a sandboxed frame — has no host to stream from, and no
  // URL to resolve one against: there is no stream, and the reader holds the served
  // article alone. Returning an inert handle keeps that a no-stream rather than an
  // exception on the way to one.
  if (pageURL === null) {
    const idle = {
      ready: null,
      get represented() {
        return receipt;
      },
      adopt() {
        return idle;
      },
      start() {
        idle.ready = Promise.resolve(idle);
        return idle;
      },
      stop() {},
    };
    return idle;
  }
  // Whether the receipt's version is known to sit at the stream's position, so a
  // newer frame applies straight from the stream. An accepted GET body leaves this
  // false until a frame names its stamp.
  let matched = true;
  let watermark = receipt.seq ?? 0;
  let arrivals = 0;
  let discards = 0;
  // Where an acknowledged apply goes: the caller's `onSnapshot`, or the reader that
  // adopted this stream at acquisition (`adopt`).
  let sink = onSnapshot;
  let notify = onStatus;
  let generation = 0;
  let stopped = false;
  let stream = null;
  let repairJob = null;
  let pendingRepair = null;
  let repairPaused = false;
  // The roster this reader draws arrives as a named `presence` frame on this same
  // stream — there is no second connection — and the store behind it is a first-use
  // download, so a host that names nobody costs a reader nothing. A reader has no
  // write half, so the lease it takes cannot publish at all: its send refuses, and no
  // request leaves for a target a page tried to set in view mode.
  let presenceStore = null;
  let presenceLease = null;
  let presenceLoad = null;
  const presenceQueue = [];

  const active = (gen) => !stopped && gen === generation;

  function report(state, detail = {}) {
    if (stopped || typeof notify !== 'function') return;
    notify({ state, ...detail });
  }

  function leavePresence() {
    presenceQueue.length = 0;
    if (presenceLease) {
      presenceLease.detach();
      presenceLease = null;
    }
    presenceStore = null;
    presenceLoad = null;
  }

  // A frame that lands while the download is in flight waits in order, and a
  // download that failed keeps the queue so the next frame asks again.
  function takePresence(data) {
    if (presenceStore) {
      presenceStore.receive(data);
      return;
    }
    presenceQueue.push(data);
    if (presenceLoad) return;
    presenceLoad = import('./presence-store.js')
      .then(({ presence }) => {
        presenceStore = presence;
        presenceLease = presence.attachTransport({ send: () => Promise.resolve(false) });
        for (const frame of presenceQueue.splice(0)) presence.receive(frame);
        return presence;
      })
      .catch(() => {
        presenceLoad = null;
        return null;
      });
  }

  function closeStream() {
    leavePresence();
    if (!stream) return;
    const closing = stream;
    stream = null;
    closing.onopen = null;
    closing.onerror = null;
    closing.onmessage = null;
    closing.close();
  }

  function abortRepair() {
    if (!repairJob) return;
    const job = repairJob;
    repairJob = null;
    job.controller.abort();
  }

  /**
   * Record one accepted body. The only writer of `receipt`, and it writes only when
   * the candidate applied completely.
   */
  function accept(candidate) {
    if (stopped) return false;
    const next = {
      bytes: candidate.bytes,
      etag: stampOf(candidate.etag),
      seq: seqOf(candidate.seq),
    };
    if (typeof next.bytes !== 'string' || next.bytes === '') {
      report('recoverable', { reason: 'invalid-bytes', seq: next.seq });
      return false;
    }
    if (next.bytes === receipt.bytes && next.etag === receipt.etag && next.seq === receipt.seq) {
      return true;
    }
    let applied = false;
    try {
      applied = sink(Object.freeze(next)) === true;
    } catch {
      applied = false;
    }
    if (!applied) {
      report('recoverable', { reason: 'refused', seq: next.seq, etag: next.etag });
      return false;
    }
    receipt = Object.freeze(next);
    report('applied', { seq: receipt.seq, etag: receipt.etag });
    return true;
  }

  function latestSeq(reason, kind) {
    if (kind === 'startup') return null;
    const candidate = Math.max(reason.seq ?? 0, watermark);
    return candidate > 0 ? candidate : null;
  }

  function deferRepair(reason, why) {
    pendingRepair = reason;
    repairPaused = true;
    report('recoverable', { reason: why, seq: reason.seq ?? null });
  }

  function requestRepair(reason) {
    if (stopped) return;
    pendingRepair = { kind: reason.kind, seq: seqOf(reason.seq) };
    repairPaused = false;
    runRepair();
  }

  function runRepair() {
    if (stopped || repairJob || repairPaused || !pendingRepair) return;
    const gen = generation;
    const reason = pendingRepair;
    pendingRepair = null;
    const controller = new AbortController();
    repairJob = { controller };
    const arrivalsAtStart = arrivals;
    const watermarkAtStart = watermark;

    const settle = (body) => {
      if (repairJob && repairJob.controller === controller) repairJob = null;
      if (!active(gen) || controller.signal.aborted) return;
      if (body == null) {
        deferRepair(reason, 'repair-failed');
        return;
      }
      if (arrivals !== arrivalsAtStart || watermark !== watermarkAtStart) {
        // Something arrived while this body was read, so it may describe a page
        // this reader has already left. A reason queued by the arrival is newer
        // and owns the next attempt; otherwise ask again from the latest watermark.
        discards += 1;
        if (discards <= MAX_DISCARDS) {
          pendingRepair = pendingRepair ?? { kind: reason.kind, seq: latestSeq(reason, reason.kind) };
          runRepair();
          return;
        }
        // Twice is as long as a reader waits: under a steady writer every body is
        // read while a frame lands, so the third is applied, not dropped.
        acceptBody(body.text, { kind: reason.kind, seq: latestSeq(reason, reason.kind) }, body.etag);
        runRepair();
        return;
      }
      acceptBody(body.text, reason, body.etag);
      runRepair();
    };

    fetch(pageURL, { cache: 'no-store', signal: controller.signal })
      .then((response) =>
        response.ok
          ? response.text().then((text) => ({ text, etag: stampOf(response.headers?.get?.('etag')) }))
          : null
      )
      .then(settle)
      .catch(() => settle(null));
  }

  function acceptBody(html, reason, responseEtag) {
    // The response's own stamp names the body when the host sends one, otherwise the
    // served root attribute does. A discovery stamp is never attached, and identical
    // bytes already named by a stamp keep that name.
    const bodyStamp = stampOf(responseEtag) ?? readBodyStamp(html);
    const etag = bodyStamp ?? (html === receipt.bytes ? receipt.etag : null);
    const seq = reason.kind === 'startup' ? receipt.seq : reason.seq ?? receipt.seq;
    if (!accept({ bytes: html, etag, seq })) return;
    // This body is the baseline now, but its version stands at the stream's position
    // only once a frame names it: until then another stamp refetches.
    matched = false;
    discards = 0;
    repairPaused = false;
    report('current', { seq: receipt.seq, etag: receipt.etag });
  }

  // A frame repeating the bytes on screen: the receipt moves, nothing repaints.
  function advance(etag, seq) {
    const next = {
      bytes: receipt.bytes,
      etag: etag ?? receipt.etag,
      seq: seq ?? receipt.seq,
    };
    if (next.etag === receipt.etag && next.seq === receipt.seq) return;
    receipt = Object.freeze(next);
    report('current', { seq: receipt.seq, etag: receipt.etag });
  }

  function onFrame(bytes, rawEtag, seq) {
    const etag = stampOf(rawEtag);
    // An older sequence is a version this reader has already left: it never rewinds.
    if (seq !== null && receipt.seq !== null && seq <= receipt.seq) return;
    // A frame naming the represented stamp places it at the stream's position, so
    // the frames after it apply straight from the stream again.
    if (!matched && etag !== null && receipt.etag !== null) {
      if (etag !== receipt.etag) {
        requestRepair({ kind: 'unmatched', seq });
        return;
      }
      matched = true;
    }
    if (bytes === receipt.bytes) {
      advance(etag, seq);
      return;
    }
    if (accept({ bytes, etag, seq })) matched = true;
  }

  function onNotification(data, seq) {
    const info = data.data;
    if (info && info.kind === 'external-change') {
      if (typeof info.html === 'string') onFrame(info.html, info.etag, seq);
      else requestRepair({ kind: 'notice', seq });
      return;
    }
    if (typeof data.msg === 'string' && data.msg.endsWith('changed on disk outside this tab')) {
      requestRepair({ kind: 'notice', seq });
    }
  }

  function onMessage(raw, gen) {
    if (!active(gen)) return;
    arrivals++;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      report('recoverable', { reason: 'bad-json' });
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      report('recoverable', { reason: 'bad-frame' });
      return;
    }
    const seq = seqOf(data.seq);
    if (seq !== null && seq > watermark) watermark = seq;
    if (data.type === 'notification') {
      onNotification(data, seq);
      return;
    }
    if (data.error) {
      report('recoverable', { reason: 'server-error', seq });
      return;
    }
    if (typeof data.html !== 'string') {
      // A stamp with no document proves nothing about these bytes: refetch instead.
      if (stampOf(data.etag)) requestRepair({ kind: 'notice', seq });
      else report('recoverable', { reason: 'bad-frame', seq });
      return;
    }
    onFrame(data.html, data.etag, seq);
  }

  function onCursor(raw, gen) {
    if (!active(gen)) return;
    arrivals++;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const seq = seqOf(data.seq);
    if (seq !== null && seq > watermark) watermark = seq;
    if (data.resync === true) {
      requestRepair({ kind: 'resync', seq });
      return;
    }
    if (data.startup === true) requestRepair({ kind: 'startup', seq: null });
  }

  function onOpen(gen) {
    if (!active(gen)) return;
    report('open', { seq: receipt.seq, etag: receipt.etag });
    if (repairPaused) {
      repairPaused = false;
      runRepair();
      return;
    }
    // No served stamp means no provenance to check, so nothing here asks the
    // version question. A reader with no bytes at all has to ask for them, or a
    // quiet file would leave it with nothing to show.
    if (receipt.bytes === null && !startupCheck) requestRepair({ kind: 'startup', seq: null });
  }

  const handle = {
    ready: null,
    get represented() {
      return receipt;
    },
    // Take this stream over: a reader starting from an acquisition body adopts the
    // stream that fetched it, so one connection carries the file from then on.
    adopt({ onSnapshot: nextSink, onStatus: nextNotify } = {}) {
      if (typeof nextSink === 'function') sink = nextSink;
      if (typeof nextNotify === 'function') notify = nextNotify;
      return handle;
    },
    start() {
      stopped = false;
      const gen = ++generation;
      closeStream();
      abortRepair();
      pendingRepair = null;
      repairPaused = false;
      arrivals = 0;
      discards = 0;
      watermark = receipt.seq ?? 0;
      handle.ready = resolveWireProfile().then((resolved) => {
        if (!active(gen)) return handle;
        const resumeId = mintResumeId();
        const clientId = mintClientId();
        const path = resolved.profile.streamPath(pageURL, LANE, resumeId, clientId);
        // Resolved against the real origin: a <base href> would otherwise point
        // the reader's stream at an origin the authored document chose.
        const opened = new SyncStream(new URL(path, window.location.origin).href, {
          shared: resolved.sharedSync,
          sharedData: resolved.sharedData,
          documentURL: pageURL,
          lane: LANE,
          clientId,
          startupCheck,
        });
        stream = opened;
        opened.onopen = () => onOpen(gen);
        opened.onerror = () => { if (active(gen)) report('reconnecting'); };
        opened.onmessage = (event) => onMessage(event.data, gen);
        opened.addEventListener('cursor', (event) => onCursor(event.data, gen));
        // Named, so it never reaches `onmessage` and never looks like the saved file
        // it is not: who is present and the file a reader holds are separate
        // questions, and a roster frame moves no receipt and no resume cursor.
        opened.addEventListener('presence', (event) => {
          if (!active(gen)) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          if (data && typeof data === 'object' && !Array.isArray(data)) takePresence(data);
        });
        return handle;
      });
      return handle;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      closeStream();
      abortRepair();
      pendingRepair = null;
      repairPaused = false;
    },
  };

  return handle;
}
