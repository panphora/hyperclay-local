/**
 * slice.js — a generator that can be run twice two ways.
 *
 * Every expensive walk in save verification is written once, as a generator that yields
 * between whole units of work. `drain` runs it to completion in the calling task, which
 * is the synchronous function this module had before; `runSliced` resumes it and hands
 * the event loop back whenever a slice has spent its budget, so the same code can also
 * run across tasks. There is one implementation, so the two cannot drift apart.
 *
 * YIELD POINTS ARE COOPERATIVE, NOT PREEMPTIVE. A generator yields only between units of
 * work the walk itself chose, so nothing outside sees a half-built model or a half-paired
 * map: an abort runs the generator's `finally` blocks and returns `{ aborted: true }`
 * with no result at all, and the caller must treat a partial walk as no walk.
 *
 * LAZY. Nothing imports this from the editor's ready path; only source modules that
 * already load parse5 do.
 */

/** Run a generator to completion in this task and return its value. */
export function drain(gen) {
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

const viaTimer = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A task boundary that works in a hidden tab, where timers are throttled. */
const viaChannel = () => new Promise((resolve) => {
  if (typeof MessageChannel !== "function") { viaTimer().then(resolve); return; }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(null);
});

export const defaultYieldTask = () => {
  const scheduler = globalThis.scheduler;
  return scheduler?.yield ? scheduler.yield() : viaChannel();
};

const monotonic = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/**
 * Resume a generator, yielding to a task whenever a slice has spent `budgetMs`.
 *
 * Resolves with the generator's own return value, rejects with its exception. When
 * `signal` aborts, the generator is closed (`gen.return()`, so `finally` blocks run) and
 * the result is `{ aborted: true }`; nothing partial is handed back.
 */
export async function runSliced(gen, {
  budgetMs = 4,
  signal,
  now = monotonic,
  yieldTask = defaultYieldTask,
} = {}) {
  let sliceStart = now();
  for (;;) {
    if (signal?.aborted) { gen.return(undefined); return { aborted: true }; }
    const step = gen.next();
    if (step.done) return step.value;
    if (now() - sliceStart < budgetMs) continue;
    await yieldTask();
    sliceStart = now();
  }
}
