/**
 * parse-steps.js — the same parse5 parse, interrupted between slices.
 *
 * A whole-document save has to parse the bytes it is about to send, and on an 11 MB
 * document that one synchronous parse is most of the time the save spends on the main
 * thread. Slicing it cannot make it cheaper, only smaller per task, and it is worth
 * doing because a paused parse is still the same parse: one `Parser`, fed consecutive
 * slices of the exact final string, is what `Parser.parse` does in one call. Nothing
 * but the suspension point changes, so the tree, every `sourceCodeLocation` offset and
 * the parse errors come out identical to a one-shot `parse`.
 *
 * SO DO NOT RESET ANYTHING BETWEEN SLICES. The tokenizer's pending token, the
 * insertion mode, the open elements and the error counts all carry across a yield;
 * that state IS the parser. `parseAll` drains the same generator that `parseInSteps` resumes,
 * so the two forms cannot drift apart: a change to the loop is a change to both.
 *
 * LAZY. This module is imported only by source code that already loads parse5, so it
 * adds nothing to a page that never parses. `src/lib/slice.js` decides whether a yield
 * hands the event loop back: `scheduler.yield()` when the browser has it and a message
 * task otherwise — never a microtask, because a microtask does not return to the event
 * loop and the typing between two slices would still wait. Idle time is not used either:
 * a continuous typist must not starve the save.
 *
 * The errors are the same `Map` of code to count that `model` and the verifier keep,
 * and the caller's own `onParseError` still receives every event in order.
 */

import { Parser } from '../vendor/parse5.vendor.js';
import { drain, runSliced } from '../lib/slice.js';

const DEFAULT_CHUNK = 16384;
const DEFAULT_BUDGET_MS = 4;

/**
 * One parser, one error map, and the options the caller handed us — plus an
 * `onParseError` that counts first and then forwards, so the returned `errors` is
 * exactly what a one-shot caller would have built for itself.
 */
function beginParse(options) {
  const errors = new Map();
  const forward = options?.onParseError;
  const parser = new Parser({
    ...options,
    onParseError: (e) => {
      errors.set(e.code, (errors.get(e.code) || 0) + 1);
      forward?.(e);
    },
  });
  return { parser, errors };
}

/** Write the next slice and return where the one after it starts. */
function writeSlice(parser, html, cursor, chunk) {
  const end = Math.min(cursor + chunk, html.length);
  parser.tokenizer.write(html.slice(cursor, end), end >= html.length);
  return end;
}

/**
 * The whole document, one slice at a time, `yield`ing after each written chunk.
 *
 * `drain` runs this in one task and `runSliced` resumes it across tasks, so the parser is
 * written once and the one-shot and sliced forms cannot disagree about it.
 */
export function* parseSteps(html, options, { chunk = DEFAULT_CHUNK } = {}) {
  const { parser, errors } = beginParse(options);
  let cursor = 0;
  do {
    cursor = writeSlice(parser, html, cursor, chunk);
    if (cursor < html.length) yield;
  } while (cursor < html.length);
  return { document: parser.document, errors };
}

/** The whole document, in one task. */
export function parseAll(html, options) {
  return drain(parseSteps(html, options));
}

/**
 * The whole document, in slices of `chunk` characters, yielding to a task after roughly
 * `budgetMs` of writing.
 *
 * An abort returns `{ aborted: true }` and no document at all: a partial tree is not a
 * smaller version of this document, and nothing downstream may adopt it as one.
 */
export async function parseInSteps(html, options, {
  budgetMs = DEFAULT_BUDGET_MS,
  chunk = DEFAULT_CHUNK,
  yieldTask,
  signal,
} = {}) {
  return runSliced(parseSteps(html, options, { chunk }), { budgetMs, signal, yieldTask });
}
