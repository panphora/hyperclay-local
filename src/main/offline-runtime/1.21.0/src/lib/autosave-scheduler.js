/**
 * Automatic-save scheduling.
 *
 * One automatic attempt at a time, and none until this module admits it: the idle
 * and maximum-wait state that used to live in the Mutation hub's debounce is here,
 * so nothing captures the page for a save that is still only an intention.
 *
 * The clock, the timers and the attempt are injected, so the cadence is executable
 * with fake time and testable without a DOM.
 */

export const IDLE_MS = 1500;
export const MIN_GAP_MS = 1200;
export const CONTINUOUS_MS = 10000;
export const MAX_COOLDOWN_MS = 30000;

// Adaptive spacing: make the gap after a save at least COST_MULTIPLIER times that
// save's synchronous cost, so a three-second save earns twelve seconds of quiet
// rather than spending the quiet window doing the next capture. On now that local
// recovery keeps every keystroke the longer gap could leave unsent.
export const ADAPTIVE_SPACING = true;
export const COST_MULTIPLIER = ADAPTIVE_SPACING ? 4 : 0;

// "No such time yet": before the first activity or the first completed save the
// page must be governed by its own timers, not by when this module was imported.
const NO_TIME = Number.NEGATIVE_INFINITY;

/**
 * The earliest moment the next automatic attempt may be admitted.
 *
 * A quiet period can flush after IDLE_MS even when the continuous-typing ceiling
 * is longer, and a save's own completion is never treated as an idle period: quiet
 * time starts no earlier than the save finished.
 */
export function nextAutoAt({ firstDirtyAt = NO_TIME, lastActivityAt = NO_TIME, finishedAt = NO_TIME, costMs = 0 } = {}) {
  const first = firstDirtyAt ?? NO_TIME;
  const last = lastActivityAt ?? NO_TIME;
  const finished = finishedAt ?? NO_TIME;
  const cooldown = Math.min(MAX_COOLDOWN_MS, Math.max(MIN_GAP_MS, COST_MULTIPLIER * costMs));
  const quietAt = Math.max(last, finished) + IDLE_MS;
  const continuousAt = Math.max(first + CONTINUOUS_MS, finished + cooldown);
  return Math.max(finished + MIN_GAP_MS, Math.min(quietAt, continuousAt));
}

export function createAutosaveScheduler({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  run = () => {}
} = {}) {
  let firstDirtyAt = null;
  let lastActivityAt = null;
  let finishedAt = NO_TIME;
  let costMs = 0;
  let timer = null;
  let timerAt = null;
  let pending = false;
  let running = false;

  function dueAt() {
    return nextAutoAt({ firstDirtyAt, lastActivityAt, finishedAt, costMs });
  }

  function schedule() {
    if (!pending || running) return;
    const at = dueAt();
    if (timer !== null) {
      if (timerAt === at) return;
      clearTimer(timer);
    }
    timerAt = at;
    timer = setTimer(fire, Math.max(0, at - now()));
  }

  function fire() {
    timer = null;
    timerAt = null;
    if (!pending || running) return;
    if (now() < dueAt()) {
      schedule();
      return;
    }
    admit();
  }

  function admit() {
    pending = false;
    running = true;
    firstDirtyAt = null;
    lastActivityAt = null;
    let attempt;
    try {
      attempt = run();
    } catch (err) {
      finish();
      return;
    }
    Promise.resolve(attempt).then(finish, finish);
  }

  function finish() {
    running = false;
    finishedAt = now();
    if (pending) schedule();
  }

  function noteActivity({ at = now() } = {}) {
    if (firstDirtyAt === null) firstDirtyAt = at;
    lastActivityAt = at;
    pending = true;
    schedule();
  }

  // An attempt asked for by something other than user activity (a merge that kept
  // this tab's edits). It respects holds and the cost spacing, and it invents no
  // input timestamp: with none recorded the idle and continuous terms are already
  // past, so the attempt is due as soon as the gap after the last save allows.
  function request() {
    pending = true;
    schedule();
  }

  // Cost of the synchronous preparation and completion work of the last admitted
  // attempt. React at once to a slow save, decay gradually. Skipped or coalesced
  // attempts report nothing and must not zero the estimate.
  function noteCost(sampleMs) {
    if (!(sampleMs > 0)) return;
    costMs = Math.max(sampleMs, costMs * 0.8);
  }

  return {
    noteActivity,
    request,
    noteCost,
    dueAt,
    costEstimate: () => costMs,
    pending: () => pending || running,
    running: () => running
  };
}
