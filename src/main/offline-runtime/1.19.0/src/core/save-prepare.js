/**
 * save-prepare.js — a save capture's remaining work, run across tasks.
 *
 * A large document's verification is seconds of uninterrupted work, so a save that has
 * to do it prepares across tasks instead: `beginSaveCapture` takes the one atomic
 * snapshot in its caller's task, and this module resumes the job's steps, handing the
 * event loop back whenever a slice has spent its budget. Typing during that wait saves
 * the checkpoint that was captured and leaves later edits dirty.
 *
 * Nothing here decides whether a save may go out: the caller owns the lane, the epochs
 * and the request. This is the driver alone, so it stays off the editor's ready path —
 * a page whose documents are small never loads it.
 */

import { defaultYieldTask, runSliced } from "../lib/slice.js";

// The job itself is in the same lazily loaded graph: a save that prepares across tasks
// takes its capture here, so the generator it resumes is never on the ready path.
export { beginSaveCapture } from "./save-job.js";

const monotonic = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/**
 * Resume a capture's steps, measuring the main-thread time they spend.
 *
 * `activeMs` is the sum of the slices' own execution time, never the wait between them:
 * it is what the autosave scheduler is told about, so a slow host or a busy tab does not
 * lengthen the cooldown.
 *
 * @param {Generator} steps - `job.steps()` from `beginSaveCapture`
 * @param {Object} [options]
 * @param {number} [options.budgetMs] - main-thread time one slice may spend before yielding
 * @param {{aborted: boolean}} [options.signal] - read before every step; a job whose page
 *   changed underneath it stops here and hands back nothing
 * @returns {Promise<{result: ?Object, aborted: boolean, activeMs: number}>}
 */
export async function runPreparedSteps(steps, { budgetMs = 4, signal = null } = {}) {
  let activeMs = 0;
  let mark = monotonic();
  const yieldTask = async () => {
    activeMs += monotonic() - mark;
    await defaultYieldTask();
    mark = monotonic();
  };
  let outcome;
  try {
    outcome = await runSliced(steps, { budgetMs, signal, yieldTask });
  } finally {
    activeMs += monotonic() - mark;
  }
  const aborted = outcome !== null && typeof outcome === "object" && outcome.aborted === true;
  return { result: aborted ? null : outcome, aborted, activeMs };
}
