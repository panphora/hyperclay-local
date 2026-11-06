/**
 * save-slices.js — how big a document has to be before its work hands the page back.
 *
 * Two walks ask the same question and must answer it the same way: a save preparing its
 * bytes (core/save.js) and the source map installing or repairing its model
 * (source/session.js). The number lives here, on its own, because core/save.js
 * initializes the save system when it is imported: a source module that read the
 * threshold from it would start the editor's discovery requests behind the source
 * plugin's back, which is a fetch that plugin never asked for.
 */

// A document whose last save was at least this big prepares its next one across tasks.
// Verifying a file that size is seconds of uninterrupted work, and every keystroke behind
// it waits; below the threshold the one-task capture is cheaper than the scheduling.
export const SLICED_SAVE_MIN_BYTES = 300 * 1024;
