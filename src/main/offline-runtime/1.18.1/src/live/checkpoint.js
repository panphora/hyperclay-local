// Checkpoints for clay.live stores. A live change never marks the page unsaved
// (live tags are outside the comparison domains), so nothing else would ever save
// it. This does: at a fixed deadline CHECKPOINT_MS after the first unsaved change,
// so a steady stream of moves still saves on time, and once more, right away,
// when the tab is hidden or closed.

export const CHECKPOINT_MS = 8000;
export const RETRY_MS = 1000;

/**
 * @param {object} deps
 * @param {() => boolean} deps.needsSave - is there a live change no accepted save holds
 * @param {() => boolean} deps.blocked - must a save wait (settling, conflict, agent editing)
 * @param {() => Promise<object>} deps.save - the checkpoint save; resolves { ok, msgType }
 * @param {() => unknown} deps.saveNow - the hide/close save, sent with keepalive
 */
export function createCheckpoints({ needsSave, blocked, save, saveNow, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let deadline = null;
  let timer = null;
  let running = false;
  let flushing = false;
  // After a save that did not land, no save before this time (soon included).
  let retryAt = 0;

  function after(result) {
    const skipped = result && !result.ok && result.msgType === "skipped";
    retryAt = result?.ok || skipped ? 0 : now() + CHECKPOINT_MS;
    return skipped ? RETRY_MS : CHECKPOINT_MS;
  }

  function arm(at) {
    deadline = at;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, Math.max(0, at - now()));
  }

  function disarm() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    deadline = null;
  }

  async function run() {
    timer = null;
    deadline = null;
    if (!needsSave()) return;
    if (blocked()) {
      arm(now() + RETRY_MS);
      return;
    }
    running = true;
    let result = null;
    try {
      result = await save();
    } catch {
      result = null;
    } finally {
      running = false;
    }
    const wait = after(result);
    if (!needsSave()) return;
    // A save skipped because another was on the wire is retried soon; anything
    // else waits a full interval, so a failing host is not asked every second.
    arm(now() + wait);
  }

  return {
    // A live change happened. The first one after a save starts the clock; later
    // ones do not move it.
    changed() {
      if (deadline === null && !running) arm(now() + CHECKPOINT_MS);
    },
    // The tab is going away or out of sight: save now if anything is unsaved.
    // A save that did not land arms the clock again, as run() does.
    flush() {
      if (running || !needsSave() || blocked()) return;
      disarm();
      running = true;
      flushing = true;
      Promise.resolve()
        .then(saveNow)
        .catch(() => null)
        .then((result) => {
          running = false;
          flushing = false;
          const wait = after(result);
          if (!needsSave()) return;
          arm(now() + wait);
        });
    },
    // Save as soon as possible: the room asks for it (its log is half full, or
    // the file holds a version the room cannot rebuild from).
    soon() {
      if (running) return;
      const at = Math.max(now(), retryAt);
      if (deadline === null || at < deadline) arm(at);
    },
    // Save no later than ms from now (the page editor's pause save). Never
    // later than a deadline already set, never before a failed save's retry time.
    within(ms) {
      if (running) return;
      const at = Math.max(now() + ms, retryAt);
      if (deadline === null || at < deadline) arm(at);
    },
    // True while the hide/close save is being made.
    get flushing() {
      return flushing;
    },
    get deadline() {
      return deadline;
    },
  };
}
