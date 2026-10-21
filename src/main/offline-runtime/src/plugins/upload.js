/**
 * upload.js — store a file on the host instead of embedding it (spec §9).
 *
 * The problem this exists for: a document that cannot upload has to put the image
 * INSIDE itself as a data: URL. A two megabyte photo then costs 2.7 MB of base64
 * on this save, on every future save, and in every stored version. Embedding is
 * the right answer for a file nobody is serving, and the wrong answer everywhere
 * else, and until now clayjs had no way to tell the difference.
 *
 *   const result = await clay.upload(file, { onProgress, signal });
 *   // { ok, msg, msgType, code, uploads }
 *
 * The result NEVER rejects, matching the save lane. One shape from every exit,
 * because two channels for three outcomes (stored, cannot store here, failed) is
 * the exact pattern save-core.js documents as the source of its own past bugs: a
 * "cannot store here" thrown as an error reads as a failure, and a caller that
 * catches it embeds when it should have stopped, or stops when it should have
 * embedded.
 *
 * Codes a caller branches on:
 *   unsupported       this host does not store files; embedding is correct
 *   payment-required  the host stores files, but not for this account
 *   too-large         over the host's cap, refused here or by the host
 *   unsupported-type  the host will not store this kind of file
 *   timeout           no answer; the upload may or may not have landed
 */

import { hostMeta } from "../core/host-meta.js";
import { saveToken } from "../core/host-attrs.js";

const UPLOAD_PATH = "/_/upload";
const UPLOAD_TIMEOUT_MS = 120000;

function result(ok, msg, msgType, code, uploads = []) {
  return { ok, msg, msgType, code, uploads };
}

function emit(name, detail) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(`clay:upload-${name}`, { detail }));
}

/**
 * Store one file on the host.
 *
 * @param {File|Blob} file
 * @param {Object} [options]
 * @param {function} [options.onProgress] - ({loaded, total, percent})
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok: boolean, msg: string, msgType: string, code: ?string, uploads: Array}>}
 */
export async function upload(file, { onProgress, signal } = {}) {
  if (!file) return result(false, "No file to upload", "error", "bad-request");

  const meta = await hostMeta();
  if (!meta.extensions.includes("upload")) {
    // Not an error. This is a document open from a plain file server, or a bare
    // core host, and embedding is what it should do.
    return result(false, "This host does not store uploaded files", "skipped", "unsupported");
  }
  // The host stores files, but not for this caller on this document: the spec withholds the
  // document's upload block by omission, and a client that finds none does not upload. Not
  // "unsupported", because embedding instead would route around the host's own decision.
  if (!meta.document?.upload) {
    return result(false, "You can't add files to this document", "error", "forbidden");
  }

  // The one local pre-check the spec asks for, and the only reason `maxBytes` is
  // published: refusing a 40 MB photo here costs nothing, and sending it to be
  // refused costs the person the whole upload first. Deliberately the ONLY thing
  // decided locally. `document.upload.allowed` is not read as a veto: it can be
  // stale (a plan upgraded in another tab, a share link granted since load), and
  // the host answers the real reason with its own code on the request itself.
  const cap = meta.document?.upload?.maxBytes;
  if (typeof cap === "number" && cap > 0 && file.size > cap) {
    return result(false, `That file is larger than this host accepts (${cap} bytes)`, "error", "too-large");
  }

  return send(file, { onProgress, signal });
}

function send(file, { onProgress, signal }) {
  return new Promise((resolve) => {
    const token = saveToken();
    const path = token ? `${UPLOAD_PATH}/${token}` : UPLOAD_PATH;
    // Absolute against the real origin, never left relative: a <base href> in the
    // authored document would otherwise redirect this request, and the
    // per-document token in its path, to an origin the document chose.
    const url = new URL(path, window.location.origin).href;

    // XMLHttpRequest for one reason: fetch cannot report upload progress. A photo
    // over a phone connection is the case this whole capability is for, and a
    // picker that sits there saying nothing for twenty seconds reads as broken.
    const xhr = new XMLHttpRequest();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const fail = (msg, msgType, code) => {
      emit("error", { msg, code });
      finish(result(false, msg, msgType, code));
    };

    const timeoutId = setTimeout(() => {
      xhr.abort();
      // A timeout is not evidence the upload failed. The bytes may well have
      // landed, so this says "we do not know" rather than asserting a failure,
      // and the content-hash name makes the retry idempotent if the caller resends.
      fail("Upload timed out", "unknown", "timeout");
    }, UPLOAD_TIMEOUT_MS);

    const onAbort = () => {
      xhr.abort();
      finish(result(false, "Upload cancelled", "skipped", "aborted"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const detail = {
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100)
      };
      emit("progress", detail);
      if (onProgress) {
        try { onProgress(detail); } catch (_) { /* a caller's drawing must not kill the upload */ }
      }
    });

    xhr.addEventListener("load", () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) { body = {}; }

      if (xhr.status >= 200 && xhr.status < 300) {
        const uploads = Array.isArray(body.uploads) ? body.uploads : [];
        if (!uploads.length || typeof uploads[0]?.url !== "string") {
          return fail("The host accepted the file but did not say where it put it", "error", "bad-response");
        }
        emit("done", { uploads });
        return finish(result(true, body.msg ?? "Uploaded", body.msgType || "success", body.code ?? null, uploads));
      }

      // The host's own code when it sent one, so a caller branches on the reason
      // rather than pattern-matching a message. Falling back to the status keeps
      // a host that answers a bare 413 readable.
      const code = body.code || STATUS_CODES[xhr.status] || "error";
      return fail(body.msg || `Upload failed (${xhr.status})`, "error", code);
    });

    xhr.addEventListener("error", () => fail("Upload failed", "error", "network"));
    xhr.addEventListener("abort", () => finish(result(false, "Upload cancelled", "skipped", "aborted")));

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

    emit("start", { name: file.name || null, size: file.size ?? null });
    xhr.send(form);
  });
}

const STATUS_CODES = {
  402: "payment-required",
  413: "too-large",
  415: "unsupported-type",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found"
};

export default upload;
