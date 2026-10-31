// The save barrier: the one write an exit is allowed to make, and the pause around it.
//
// A switch has closed input admission before this runs, so an ordinary save cannot go
// out. The barrier is not an ordinary save: it carries a permit minted for the mode
// generation it is leaving, it fastens the work no save can write (registered models,
// uploads, a composer waiting on its person), it writes the page's bytes, and it answers
// only when the host has accepted bytes that include everything the page still holds.
//
// It also takes the document-operation slot, because a flush is only meaningful if
// nothing else replaces the document while it runs. A caller that already owns that slot
// (the mode controller's exit) hands its token in, so the barrier does not queue behind
// its own claim: a standalone call still claims one and releases it.
//
// This module is a dynamic target reached from the mode controller: a reader never
// fetches it.
import { claimDocumentOperation, releaseDocumentOperation, operationKind, saveFateIsUnknown } from "./save-core.js";
import { flushSave, isSaveConflicted, openSavePermit, closeSavePermit, saveGeneration } from "./save.js";
import { flushUnsaved, pendingIds } from "../lib/unsaved-state.js";
import { bytesUnsaved } from "./unsaved-warning.js";

const DEADLINE_MS = 15000;
const EXPIRED = Symbol("the barrier deadline passed");
// Two passes at most: the first writes, and a second only covers input that arrived
// while the first request was on the wire. Anything still unsaved after that refuses.
const MAX_PASSES = 2;

const refusal = (code, extra = {}) => ({ ok: false, code, ...extra });

// One wait of the barrier, bounded by its own deadline: a source whose flush never
// settles is the deadline's business, not an exit that never returns.
async function bounded(pending, deadline) {
  let timer = null;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(EXPIRED), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([Promise.resolve(pending), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export { claimDocumentOperation as claimOperation, releaseDocumentOperation as releaseOperation, operationKind };

/**
 * Fasten everything this page holds that a save cannot write, then write its bytes.
 *
 * Answers `{ ok: true, state, etag }` only when the host accepted bytes that include
 * every edit and every registered value on the page, under `generation`'s permit. Every
 * other answer is `{ ok: false, code }` from the transition vocabulary: `busy`,
 * `stale-document`, `pending-input`, `conflict`, `save-unknown`, `save-failed`,
 * `timeout`. Nothing about the page's state moves on a refusal, and nothing is aborted:
 * a write already on the wire keeps its own outcome.
 *
 * @param {Object} [options]
 * @param {number} [options.generation] - the mode generation this exit is leaving
 * @param {boolean} [options.keepalive]
 * @param {number} [options.timeoutMs] - the whole barrier, the pending-source flush
 *   included, so a source that never settles refuses as `timeout`
 * @param {Object} [options.operation] - the slot its caller already holds; claimed here when absent
 * @returns {Promise<{ok: boolean, code?: string, state?: string, etag?: ?string, pending?: string[]}>}
 */
export async function runSaveBarrier({ generation = saveGeneration(), keepalive = false, timeoutMs = DEADLINE_MS, operation = null } = {}) {
  const claimed = operation ? null : claimDocumentOperation("mode");
  if (!operation && !claimed) return refusal("busy");
  const deadline = Date.now() + timeoutMs;
  const permit = openSavePermit(generation);
  const abort = new AbortController();
  try {
    for (let pass = 0; ; pass++) {
      if (generation !== saveGeneration()) return refusal("stale-document");
      if (Date.now() >= deadline) return refusal("timeout");

      // Work that finishes on its own — a checkpoint, a queued upload — is asked to, under
      // this exit's own permit and inside its own deadline: the save such a source needs is
      // the one write a closed session still admits. A composer waiting on its person has no
      // flush and stays pending: that is a refusal, never a blur or a submit on their behalf.
      const context = {
        permit,
        deadline,
        keepalive,
        signal: abort.signal,
        timeoutMs: Math.max(0, deadline - Date.now()),
      };
      const sources = await bounded(flushUnsaved(context), deadline);
      if (sources === EXPIRED) return refusal("timeout", { pending: pendingIds() });
      if (!sources.ok) {
        if (isSaveConflicted()) return refusal("conflict", { pending: sources.pending });
        if (saveFateIsUnknown()) return refusal("save-unknown", { pending: sources.pending });
        return refusal("pending-input", { pending: sources.pending });
      }
      if (sources.pending.length) return refusal("pending-input", { pending: sources.pending });

      // Neither a conflict nor an unresolved fate is a failure a retry fixes.
      if (isSaveConflicted()) return refusal("conflict");
      if (saveFateIsUnknown()) return refusal("save-unknown");

      let result;
      try {
        result = await flushSave({ keepalive, timeoutMs: Math.max(0, deadline - Date.now()), permit });
      } catch (err) {
        if (err?.state === "conflict") return refusal("conflict");
        if (err?.state === "blocked") return refusal("pending-input", { pending: pendingIds() });
        if (saveFateIsUnknown()) return refusal("save-unknown");
        if (Date.now() >= deadline) return refusal("timeout");
        return refusal("save-failed");
      }

      if (result.state !== "clean" && result.state !== "saved") return refusal("save-failed");
      // The host answered, but an answer is only an exit when nothing is left behind.
      if (isSaveConflicted()) return refusal("conflict");
      if (saveFateIsUnknown()) return refusal("save-unknown");
      const pending = pendingIds();
      if (pending.length) return refusal("pending-input", { pending });
      if (bytesUnsaved()) {
        if (pass + 1 < MAX_PASSES && Date.now() < deadline) continue;
        return refusal("pending-input");
      }
      return { ok: true, state: result.state, etag: result.etag ?? null };
    }
  } finally {
    abort.abort();
    closeSavePermit(permit);
    if (claimed) releaseDocumentOperation(claimed);
  }
}
