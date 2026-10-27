// The reader's half of a live switch: what the saved lane hands to an entry without
// stopping, and what it takes back when the entry is refused.
//
// A reader owns the saved lane — the transport it opened, or the frames generic sync
// applies to the page — and a switch needs that one lane, never a second stream. So
// preparation holds the queue instead of closing it: an apply already on the wire
// finishes, a file that arrives meanwhile keeps its place, and a repair the host asked
// for stays owed. `reconcile` applies what was held, `resume` gives the lane back
// exactly as it was, and `commit` retires it only onto a receipt a successor can build
// from. Nothing here clears a buffer, aborts a request or stops a stream before commit.
//
// This is a dynamic target: a reader that never enters edit never fetches it.

const fail = (message, code) => Object.assign(new Error(`clayjs: ${message}`), { code });

const newer = (staged, candidate) =>
  !staged || candidate.seq === null || staged.seq === null || candidate.seq > staged.seq ? candidate : staged;

/**
 * A transport's handoff, built out of the transport's own takeover points: `adopt`
 * moves the acknowledged sink here, so nothing is applied and the receipt still moves
 * only onto bytes a sink took. `stop` is never called before commit.
 *
 * `yieldArticle` gives the article up to a switch that mounts over it and
 * `reclaimArticle` takes it back when that switch is refused; both are the reader's
 * own, so the queue and the receipt never move while the article is not its.
 *
 * @param {Object} lane
 * @param {Object} lane.stream - the transport this reader opened
 * @param {function(Object): boolean} lane.apply - apply one file to the article
 * @param {function(): boolean} lane.retire - give up the article and its claim
 * @param {function(): boolean} lane.yieldArticle - release the article, keep the queue
 * @param {function(): boolean} lane.reclaimArticle - take the article back and repaint
 */
function streamHandoff({ stream, apply, retire, yieldArticle = () => false, reclaimArticle = () => false }) {
  let staged = null;
  let yielded = false;
  stream.adopt({
    onSnapshot: (candidate) => {
      staged = newer(staged, candidate);
      return true;
    },
  });
  const take = () => {
    const candidate = staged;
    staged = null;
    return candidate;
  };
  return {
    get represented() {
      return stream.represented;
    },
    // The newest file this reader holds: a snapshot the transport took while the
    // switch prepared is a file the session was not built from.
    get held() {
      return staged ?? stream.represented;
    },
    yieldArticle() {
      if (yielded || !yieldArticle()) return false;
      yielded = true;
      return true;
    },
    reclaimArticle() {
      if (!yielded || !reclaimArticle()) return false;
      yielded = false;
      return true;
    },
    reconcile() {
      const candidate = take();
      if (candidate && !apply(candidate)) return Promise.reject(fail("the switch could not apply the saved file", "load-failed"));
      return Promise.resolve();
    },
    resume() {
      stream.adopt({ onSnapshot: apply });
      const candidate = take();
      if (candidate) apply(candidate);
    },
    commit() {
      // Whatever the old owner was never shown goes on screen first: the receipt a
      // successor is built from and the article it replaces must name one file. An
      // article already yielded belongs to the switch: it reconciled the queue and
      // refused anything newer before asking for this commit, so nothing staged is
      // its to paint, and the read-only half only stops the stream and retires.
      if (!yielded) {
        const candidate = take();
        if (candidate && !apply(candidate)) return false;
      }
      if (stream.represented.bytes === null) return false;
      stream.stop();
      return retire();
    },
  };
}

/**
 * A reader's handoff: its own transport, or the engine that feeds the page.
 *
 * @param {Object} reader
 * @param {?Object} reader.stream - the transport this reader owns, if any
 * @param {Object} reader.options - `{ signal, deadline }` for the lane
 * @param {function(Object): boolean} reader.apply - apply one file to the article
 * @param {function(): boolean} reader.retire - give up the article and its claim
 * @param {function(): boolean} reader.yieldArticle - release the article, keep the queue
 * @param {function(): boolean} reader.reclaimArticle - take the article back and repaint
 * @returns {Promise<Object>}
 */
export async function readerHandoff({ stream, options, apply, retire, yieldArticle = () => false, reclaimArticle = () => false }) {
  if (stream) return streamHandoff({ stream, apply, retire, yieldArticle, reclaimArticle });
  const lane = await import("./live-sync.js").then(({ liveSync }) => liveSync.prepareHandoff(options));
  return {
    get represented() {
      return lane.represented;
    },
    get held() {
      return lane.held;
    },
    yieldArticle,
    reclaimArticle,
    reconcile: () => lane.reconcile(),
    resume: () => lane.resume(),
    commit: () => lane.commit() && retire(),
  };
}

/**
 * A sync engine's handoff: hold the saved lane's frames and the repair it owes, and
 * answer with the file it last applied.
 *
 * @param {Object} lane - the engine instance
 * @param {Object} options - `{ signal, deadline }`
 * @returns {Promise<Object>}
 */
export async function engineHandoff(lane, { signal, deadline = 15000 } = {}) {
  const until = Date.now() + deadline;
  // An apply already in flight is the one thing preparation waits for: its bytes are
  // the file the switch will be built from.
  while (lane._morphInFlight) {
    if (signal?.aborted) {
      lane._handoffHeld = false;
      throw fail("the switch was cancelled", "aborted");
    }
    if (Date.now() >= until) {
      lane._handoffHeld = false;
      throw fail("the apply did not settle", "timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const queued = () => lane._pendingHtml != null || lane._pendingExternal != null;
  return {
    get represented() {
      return lane._represented;
    },
    // The newest file the lane holds, queued or applied: a frame the engine took
    // while the switch prepared is newer than the one on the page, and a session
    // built from the older one must refuse rather than stop the lane over it.
    get held() {
      let newest = lane._represented;
      if (lane._pendingHtml != null) {
        newest = newer(newest, {
          bytes: lane._pendingHtml,
          etag: lane._pendingEtag ?? null,
          seq: lane._pendingSeq ?? null,
        });
      }
      if (lane._pendingExternal) {
        newest = newer(newest, {
          bytes: lane._pendingExternal.html,
          etag: lane._pendingExternal.etag ?? null,
          seq: lane._pendingExternal.seq ?? null,
        });
      }
      return newest;
    },
    async reconcile() {
      if (!lane._handoff || lane.isDestroyed) return;
      for (let pass = 0; pass < 8; pass++) {
        if (lane._morphInFlight) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          continue;
        }
        if (!queued()) return;
        await lane._runPending();
      }
      if (queued()) throw fail("the held frame could not be applied", "load-failed");
    },
    resume() {
      if (!lane._handoff) return;
      lane._handoff = null;
      lane._handoffHeld = false;
      lane._scheduleNextFrame();
    },
    commit() {
      if (!lane._represented.bytes) return false;
      lane._handoff = null;
      lane._handoffHeld = false;
      lane.stop();
      return true;
    },
  };
}
