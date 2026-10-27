/**
 * upload-task.js — one upload with an identity of its own: state, progress, cancel, retry.
 *
 * `upload()` answers once, at the end, which is all a caller that embeds on failure
 * has ever needed. An editor that shows a row per picture needs more than that: which
 * upload a progress callback belongs to, whether it can still be cancelled, and a
 * retry that is a new attempt of the same thing rather than a second copy of it.
 *
 *   const task = clay.upload.start(file, { requiredAccess: "document-or-local" });
 *   const off = task.subscribe(({ state, percent }) => draw(state, percent));
 *   await task.result;        // { ok, msg, msgType, code, uploads }
 *   task.cancel();
 *   await task.retry();       // a new attempt, same file, same id
 *   task.dispose();
 *
 * States are `uploading`, `succeeded`, `failed` and `cancelled`. The id is stable for
 * the life of the task; `attempt` counts up only on an explicit retry, so a callback
 * arriving from an attempt that has already ended can be recognized and ignored.
 *
 * The transport is the same XMLHttpRequest the single-shot path always used, for the
 * same reason: fetch cannot report upload progress. What changed is that one terminal
 * function now settles an attempt for every signal — response, timeout, cancel, a
 * throw while starting — and only the caller that wins emits and resolves. A timeout
 * therefore stays a timeout, and a load that arrives after an abort cannot announce a
 * second ending. `upload()` never rejects for an ordinary transport failure, and
 * neither does a task; programmer misuse (no file, an unknown `requiredAccess`)
 * throws before anything starts instead.
 */

import { hostMeta, hostMetaOutcome } from "../core/host-meta.js";
import { saveToken } from "../core/host-attrs.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";

const UPLOAD_PATH = "/_/upload";
const UPLOAD_TIMEOUT_MS = 120000;

// What each `requiredAccess` name accepts from the host, both in `document.upload.access`
// before the request and on every upload the host returns afterwards. A host that
// reports `document` binds each new URL to that document's live read policy; a local
// host reports `local`, meaning its own file-serving rules rather than a hosted sharing
// ACL. Anything else — a missing field, `public`, a value this library has never heard
// of — is insufficient, and the caller that asked for privacy is told so instead of
// being handed a URL it might paste somewhere permanent.
const REQUIRED_ACCESS = {
  document: ["document"],
  local: ["local"],
  "document-or-local": ["document", "local"]
};

// Retry is a new attempt of the same bytes, which only makes sense when asking again
// could plausibly answer differently. A policy refusal (too large, wrong type, not
// allowed here) is the host's decision about this file, so the row explains it and
// leaves retry out; `network`, `timeout`, `error` and `bad-response` are the host
// having no answer or a broken one, and a cancel is a person who may want to go on.
export const RETRYABLE_CODES = new Set(["network", "timeout", "error", "bad-response", "aborted"]);

/**
 * Whether this task's current ending permits a retry.
 *
 * The one table `task.retry()` and the row's Retry button both obey, so the button can
 * never offer an attempt the task would refuse.
 *
 * @param {Object} snapshot - a task snapshot
 * @returns {boolean}
 */
export function canRetry(snapshot) {
  if (!snapshot) return false;
  if (snapshot.state === "cancelled") return true;
  if (snapshot.state !== "failed") return false;
  return RETRYABLE_CODES.has(snapshot.result?.code ?? null);
}

// The tasks this page has started and nobody has disposed. An upload outlives the edit
// session that started it: the selected file and a stored URL are the person's work, and
// a teardown that cancelled the request or forgot the result would throw away bytes nobody
// has inserted yet. Only an upload still on the wire counts as pending work — its fate is
// unknown, so it is asked to finish before an exit may call the page clean. A result the
// host already accepted is not pending: inserting it is the caller's next move, not a
// write anyone is waiting on.
const tasks = new Set();

const uploading = () => [...tasks].some((task) => task.state === "uploading");

async function flushUploads() {
  const inFlight = [...tasks].filter((task) => task.state === "uploading").map((task) => task.result);
  if (!inFlight.length) return { ok: true };
  await Promise.allSettled(inFlight);
  return { ok: !uploading() };
}

const pending = registerUnsavedState({ id: "upload", isPending: uploading, flush: flushUploads });

// New attempts are admitted while no edit session is leaving. The exit closes admission
// before its barrier, so an upload started after that would be bytes nobody waits for.
// With no session running (a page that never uses the lifecycle) admission is open, which
// is what every caller of this module has always had.
let session = null;

const admitsAttempts = () => session?.admitted !== false;

let taskCount = 0;

function nextId() {
  taskCount += 1;
  return `upload-${taskCount}`;
}

function result(ok, msg, msgType, code, uploads = []) {
  return { ok, msg, msgType, code, uploads };
}

function emit(name, detail) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(`clay:upload-${name}`, { detail }));
}

/**
 * Read a `requiredAccess` name into the access values it accepts.
 *
 * Throws for a name that is not in the table: this is a caller's typo, not a host's
 * answer, and silently treating it as "no requirement" would hand back exactly the
 * URL the caller was trying to avoid.
 *
 * @param {?string} name
 * @returns {?string[]}
 */
export function checkRequiredAccess(name) {
  if (name == null) return null;
  const wanted = REQUIRED_ACCESS[name];
  if (!wanted) {
    throw new TypeError(`Unknown requiredAccess: ${String(name)}. Use one of ${Object.keys(REQUIRED_ACCESS).join(", ")}.`);
  }
  return wanted;
}

/**
 * Store one file on the host, once, as a single attempt.
 *
 * The whole pipeline behind both entry points: what the host says it supports, what
 * this document is allowed to do, the announced size cap, the request, and — when the
 * caller named a `requiredAccess` — the access the host reported on each returned
 * upload. Every exit is the one result shape, and none of them rejects.
 *
 * @param {File|Blob} file
 * @param {Object} [options]
 * @param {function} [options.onProgress] - ({loaded, total, percent})
 * @param {AbortSignal} [options.signal]
 * @param {?string} [options.requiredAccess] - "document", "local" or "document-or-local"
 * @param {string} [options.taskId] - used on the global events only
 * @param {number} [options.attempt] - used on the global events only
 * @returns {Promise<{ok: boolean, msg: string, msgType: string, code: ?string, uploads: Array}>}
 */
export async function runUpload(file, { onProgress, signal, requiredAccess, taskId = nextId(), attempt = 1 } = {}) {
  const wantedAccess = checkRequiredAccess(requiredAccess);

  if (!file) return result(false, "No file to upload", "error", "bad-request");

  const cancelled = () => result(false, "Upload cancelled", "error", "aborted");
  if (!admitsAttempts()) return cancelled();

  // A retry asks again rather than reading the memoized answer: the host that was
  // unreachable (or briefly refused) is exactly the thing a second attempt is for.
  let meta;
  try {
    meta = await hostMeta(attempt > 1 ? { fresh: true } : undefined);
  } catch (_) {
    meta = { extensions: [], document: null };
  }
  if (signal?.aborted) return cancelled();
  // A host that should have answered and did not has not said this document cannot
  // upload. It is a network failure, and asking again may well be answered.
  if (hostMetaOutcome(meta) === "failed") {
    return result(false, "Couldn't reach the host to upload", "error", "network");
  }
  if (!meta.extensions.includes("upload")) {
    // Not an error. This is a document open from a plain file server, or a bare
    // core host, and embedding is what it should do.
    return result(false, "This host does not store uploaded files", "skipped", "unsupported");
  }
  // The host stores files, but not for this caller on this document: the spec withholds the
  // document's upload block by omission, and a client that finds none does not upload. Not
  // "unsupported", because embedding instead would route around the host's own decision.
  if (signal?.aborted) return cancelled();
  if (!meta.document?.upload) {
    return result(false, "You can't add files to this document", "error", "forbidden");
  }
  // Asked for before the bytes leave: a caller that cannot use a publicly readable URL
  // must not spend a person's upload finding out. Read from the host's own metadata and
  // never inferred from the page URL, the plan or the filename.
  if (signal?.aborted) return cancelled();
  if (wantedAccess) {
    const offered = meta.document.upload.access;
    if (!wantedAccess.includes(offered)) {
      return result(false, "This host does not keep uploaded files private to this document", "error", "privacy-unsupported");
    }
  }

  // The one local pre-check the spec asks for, and the only reason `maxBytes` is
  // published: refusing a 40 MB photo here costs nothing, and sending it to be
  // refused costs the person the whole upload first. Deliberately the ONLY thing
  // decided locally. `document.upload.allowed` is not read as a veto: it can be
  // stale (a plan upgraded in another tab, a share link granted since load), and
  // the host answers the real reason with its own code on the request itself.
  if (signal?.aborted) return cancelled();
  const cap = meta.document?.upload?.maxBytes;
  if (typeof cap === "number" && cap > 0 && file.size > cap) {
    return result(false, `That file is larger than this host accepts (${cap} bytes)`, "error", "too-large");
  }

  // The access check lives inside `postFile`, before it announces success: a downgrade
  // must never have emitted `clay:upload-done` first.
  return postFile(file, { onProgress, signal, taskId, attempt, requiredAccess: wantedAccess });
}

/**
 * Check the access the host reported on a successful upload.
 *
 * A caller that asked for a private URL sends the bytes on the strength of metadata
 * that can change under it (a deployment setting flipped, a proxy answering for the
 * host). The returned uploads are the host's own claim about what it stored, so the
 * claim is verified too. A downgrade keeps the uploads in the result — a person can
 * still copy or download the URL deliberately — but the result is not a success, so
 * no caller inserts it silently.
 */
function verifyAccess(answer, wantedAccess) {
  if (!wantedAccess || !answer.ok) return answer;
  const uploads = answer.uploads || [];
  const kept = uploads.every((upload) => wantedAccess.includes(upload?.access));
  if (kept) return answer;
  return result(false, "The host stored the file without the access it promised", "error", "privacy-unsupported", uploads);
}

/**
 * The request itself: one attempt, one ending.
 *
 * @param {File|Blob} file
 * @param {Object} [options]
 * @param {function} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.taskId]
 * @param {number} [options.attempt]
 * @param {?string|?string[]} [options.requiredAccess] - a name, or what `checkRequiredAccess` read it into
 * @returns {Promise<{ok: boolean, msg: string, msgType: string, code: ?string, uploads: Array}>}
 */
export function postFile(file, { onProgress, signal, taskId, attempt, requiredAccess } = {}) {
  const wantedAccess = Array.isArray(requiredAccess) ? requiredAccess : checkRequiredAccess(requiredAccess);
  return new Promise((resolve) => {
    // Additive, on the events only: a listener that shows one row per upload can tell
    // two of them apart, and old callers that read only `msg` never notice the fields.
    const events = { taskId, attempt };
    const token = saveToken();
    const path = token ? `${UPLOAD_PATH}/${token}` : UPLOAD_PATH;
    // Absolute against the real origin, never left relative: a <base href> in the
    // authored document would otherwise redirect this request, and the
    // per-document token in its path, to an origin the document chose.
    const url = new URL(path, window.location.origin).href;

    let xhr = null;
    let settled = false;
    let timeoutId = null;

    // One terminal function for every signal. Whichever one wins emits and resolves;
    // every later one — a timeout firing during an already-cancelled request, a load
    // arriving after an abort — finds `settled` set and changes nothing.
    function finish(value, eventName, detail) {
      if (settled) return false;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (eventName) emit(eventName, { ...detail, ...events });
      resolve(value);
      return true;
    }

    function fail(msg, msgType, code) {
      return finish(result(false, msg, msgType, code), "error", { msg, code });
    }

    function onTimeout() {
      // A timeout is not evidence the upload failed. The bytes may well have
      // landed, so this says "we do not know" rather than asserting a failure,
      // and the content-hash name makes the retry idempotent if the caller resends.
      // Settle first, abort second: aborting first would let the abort handler
      // report a cancelled upload that was really a request nobody answered.
      const value = result(false, "Upload timed out", "unknown", "timeout");
      if (finish(value, "error", { msg: value.msg, code: value.code })) xhr.abort();
    }

    function onAbort() {
      if (finish(result(false, "Upload cancelled", "skipped", "aborted"))) xhr?.abort();
    }

    // XMLHttpRequest for one reason: fetch cannot report upload progress. A photo
    // over a phone connection is the case this whole capability is for, and a
    // picker that sits there saying nothing for twenty seconds reads as broken.
    try {
      xhr = new XMLHttpRequest();
    } catch (_) {
      return fail("This browser could not start the upload", "error", "error");
    }

    timeoutId = setTimeout(onTimeout, UPLOAD_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (settled) return;
      if (!event.lengthComputable) return;
      const detail = {
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100)
      };
      emit("progress", { ...detail, ...events });
      if (onProgress) {
        try { onProgress(detail); } catch (_) { /* a caller's drawing must not kill the upload */ }
      }
    });

    xhr.addEventListener("load", () => {
      // After an abort or a timeout this answer is stale, and the request already has
      // its ending. Reporting a second one would let a cancelled upload insert a URL.
      if (settled) return;
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) { body = {}; }

      if (xhr.status >= 200 && xhr.status < 300) {
        const uploads = Array.isArray(body.uploads) ? body.uploads : [];
        if (!uploads.length || typeof uploads[0]?.url !== "string") {
          return fail("The host accepted the file but did not say where it put it", "error", "bad-response");
        }
        // The returned uploads are the host's own claim about what it stored, so the
        // claim is checked before anything calls this a success: a downgrade keeps the
        // uploads but announces an error, never a done.
        const value = verifyAccess(
          result(true, body.msg ?? "Uploaded", body.msgType || "success", body.code ?? null, uploads),
          wantedAccess
        );
        if (value.ok) return finish(value, "done", { uploads });
        return finish(value, "error", { msg: value.msg, code: value.code, uploads });
      }

      // The host's own code when it sent one, so a caller branches on the reason
      // rather than pattern-matching a message. Falling back to the status keeps
      // a host that answers a bare 413 readable.
      const code = body.code || STATUS_CODES[xhr.status] || "error";
      return fail(body.msg || `Upload failed (${xhr.status})`, "error", code);
    });

    xhr.addEventListener("error", () => fail("Upload failed", "error", "network"));
    xhr.addEventListener("abort", () => finish(result(false, "Upload cancelled", "skipped", "aborted")));

    try {
      xhr.open("POST", url, true);
      // The exact equivalent of the save lane's `credentials: 'omit'` in the case
      // where the two differ: a sandboxed document is cross-origin to its own host,
      // and asking for credentials there needs Access-Control-Allow-Credentials
      // back, which a token-minting host must never send.
      xhr.withCredentials = false;
      xhr.setRequestHeader("Document-URL", window.location.href);

      // FormData, so the file streams as bytes. No FileReader and no base64: a
      // whole-file string costs a third more bytes and holds the entire file in
      // memory twice.
      const form = new FormData();
      form.append("file", file, file.name || "upload");

      emit("start", { name: file.name || null, size: file.size ?? null, ...events });
      xhr.send(form);
    } catch (_) {
      fail("The upload could not be sent", "error", "error");
    }
  });
}

/**
 * Start one upload and hand back the task that owns it.
 *
 * The first attempt begins here, so subscribing immediately sees `uploading` rather
 * than an empty state that never lasted. The file is held until `dispose()` — a failed
 * attempt must be retryable without asking the person to pick it again.
 *
 * @param {File|Blob} file
 * @param {Object} [options]
 * @param {?string} [options.requiredAccess] - "document", "local" or "document-or-local"
 * @param {function} [options.onProgress] - ({loaded, total, percent}) for the current attempt
 * @returns {Object} task
 */
export function start(file, options = {}) {
  if (!file) throw new TypeError("clay.upload.start needs a file");
  checkRequiredAccess(options.requiredAccess);

  const id = nextId();
  const requiredAccess = options.requiredAccess ?? null;
  const onProgress = options.onProgress || null;

  let held = file;
  let attempt = 0;
  let state = "uploading";
  let loaded = 0;
  let total = null;
  let percent = null;
  let outcome = null;
  let controller = null;
  let current = null;
  let disposed = false;
  // The attempt a cancel settled by hand. Its own late answer must not replace the
  // cancelled state the person was already shown.
  let cancelledAttempt = 0;
  const listeners = new Set();

  function readSnapshot() {
    return { id, attempt, state, loaded, total, percent, result: outcome };
  }

  function publish() {
    if (!listeners.size) return;
    const snapshot = readSnapshot();
    for (const listener of [...listeners]) {
      try { listener(snapshot); } catch (_) { /* a caller's drawing must not kill the upload */ }
    }
  }

  function runAttempt() {
    attempt += 1;
    // The attempt this closure belongs to. Anything arriving for an older one is
    // ignored rather than applied to the upload the person is now watching.
    const mine = attempt;
    controller = new AbortController();
    state = "uploading";
    loaded = 0;
    total = null;
    percent = null;
    outcome = null;

    current = runUpload(held, {
      requiredAccess,
      signal: controller.signal,
      taskId: id,
      attempt: mine,
      onProgress: (progress) => {
        if (disposed || mine !== attempt) return;
        loaded = progress.loaded;
        total = progress.total;
        percent = progress.percent;
        publish();
        if (onProgress) {
          try { onProgress(progress); } catch (_) { /* a caller's drawing must not kill the upload */ }
        }
      }
    }).then((value) => {
      if (!disposed && mine === attempt && mine !== cancelledAttempt) {
        outcome = value;
        // 100% transmitted is not success: only the host's answer says the bytes were
        // stored, and until it arrives the attempt is still uploading.
        state = value.ok ? "succeeded" : value.code === "aborted" ? "cancelled" : "failed";
        publish();
      }
      pending.changed();
      return value;
    });

    publish();
    pending.changed();
    return current;
  }

  const task = {
    id,
    get attempt() { return attempt; },
    get state() { return state; },
    get file() { return held; },
    get result() { return current; },
    snapshot: readSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("subscribe needs a function");
      if (disposed) return () => {};
      listeners.add(listener);
      try { listener(readSnapshot()); } catch (_) { /* a caller's drawing must not kill the upload */ }
      return () => listeners.delete(listener);
    },
    // Terminal for this attempt only: the bytes may be on the host already, so nothing
    // is deleted, and its eventual answer cannot be mistaken for a finished upload.
    // A retry is what asks again.
    cancel() {
      if (disposed) return;
      // The wait for the host's metadata is part of the attempt, so a cancel during it
      // settles now rather than when the answer arrives. The request is still aborted,
      // and whatever it eventually says cannot overwrite this.
      if (state === "uploading") {
        cancelledAttempt = attempt;
        state = "cancelled";
        outcome = result(false, "Upload cancelled", "error", "aborted");
        publish();
        pending.changed();
      }
      controller?.abort();
    },
    retry() {
      // One attempt at a time, and no resurrecting a success: two calls from one button
      // press share the attempt already running instead of sending the file twice.
      // The same table the Retry button obeys, so the button never offers a retry the
      // task would refuse.
      // A closed session is not a reason to spend the recovery: the task keeps its ending
      // and its file, and a retry after the next entry asks again.
      if (disposed || !admitsAttempts() || !canRetry(readSnapshot())) return current;
      return runAttempt();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      listeners.clear();
      held = null;
      tasks.delete(task);
      pending.changed();
    }
  };

  tasks.add(task);
  runAttempt();
  return task;
}

/**
 * Uploads as a mode participant.
 *
 * `prepare` takes the session's admission, closed until the commit; `enable` opens it,
 * `quiesce` closes it before the exit barrier and `resume` reopens it for a refused exit.
 * Adoption (`initial`) is a lease over a session that is already open, because an explicit
 * edit boot admits uploads from its first keystroke. `dispose` closes it for a session that
 * has ended and takes nothing else: the tasks started under it keep their selected files,
 * their stored results and their own endings, because those belong to the callers that
 * asked for them, not to the mode that was running.
 */
export function uploadParticipant() {
  return {
    id: "clay:upload",
    order: 340,
    prepare(context = {}) {
      const lease = { admitted: context.initial === true };
      session = lease;
      return {
        enable() {
          if (session === lease) lease.admitted = true;
        },
        quiesce() {
          if (session === lease) lease.admitted = false;
        },
        resume() {
          if (session === lease) lease.admitted = true;
        },
        dispose() {
          if (session === lease) lease.admitted = false;
        },
      };
    },
  };
}

const STATUS_CODES = {
  402: "payment-required",
  413: "too-large",
  415: "unsupported-type",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found"
};
