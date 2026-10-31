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
 *   const task = clay.upload.start(file, { requiredAccess: "document-or-local" });
 *   const off = task.subscribe(({ state, percent }) => draw(state, percent));
 *   await task.result;
 *   task.retry();
 *   task.dispose();
 *
 * The result NEVER rejects, matching the save lane. One shape from every exit,
 * because two channels for three outcomes (stored, cannot store here, failed) is
 * the exact pattern save-core.js documents as the source of its own past bugs: a
 * "cannot store here" thrown as an error reads as a failure, and a caller that
 * catches it embeds when it should have stopped, or stops when it should have
 * embedded.
 *
 * Codes a caller branches on:
 *   unsupported          this host does not store files; embedding is correct
 *   payment-required     the host stores files, but not for this account
 *   too-large            over the host's cap, refused here or by the host
 *   unsupported-type     the host will not store this kind of file
 *   timeout              no answer; the upload may or may not have landed
 *   privacy-unsupported  the host stored (or would store) the file where others can
 *                        read it, so a URL from it must not be inserted anywhere
 *
 * The single-shot call and the task are the same transport and the same checks; the
 * task adds an identity so progress, cancel and an explicit retry belong to one
 * upload. `upload-task.js` holds both.
 */

import { checkRequiredAccess, runUpload, start, uploadParticipant } from "./upload-task.js";

/**
 * Store one file on the host.
 *
 * @param {File|Blob} file
 * @param {Object} [options]
 * @param {function} [options.onProgress] - ({loaded, total, percent})
 * @param {AbortSignal} [options.signal]
 * @param {?string} [options.requiredAccess] - "document", "local" or "document-or-local":
 *   the access the host must promise before the bytes are sent and report afterwards
 * @returns {Promise<{ok: boolean, msg: string, msgType: string, code: ?string, uploads: Array}>}
 */
export function upload(file, { requiredAccess, ...rest } = {}) {
  // A misspelt requirement is the caller's bug, not the host's answer, and it throws
  // here — before a request exists — rather than resolving as a failure the caller
  // might read as "the host refused" and embed around.
  checkRequiredAccess(requiredAccess);
  return runUpload(file, { ...rest, requiredAccess });
}

// The shared row (upload-ui.js) loads on first use, so a document that never uploads
// never downloads it, and clay.upload(file) keeps working untouched.
upload.mount = async (task, container) => (await import("./upload-ui.js")).mount(task, container);

// On the same function, so anything holding `clay.upload` has both and every existing
// `clay.upload(file)` call keeps working untouched.
upload.start = start;

// The factory lives with the transport it gates, and this is the path a plan resolves.
export { uploadParticipant as modeParticipant };

export default upload;
