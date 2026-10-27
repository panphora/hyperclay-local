/**
 * Autosave Debug Gate
 *
 * The boot-size half of the autosave debug utility: a person who never turns
 * `clay:debug:autosave` on downloads nothing but this file. Each wrapper returns
 * before the dynamic import when debug is off, and forwards to the real logger
 * once it lands when it is on.
 */

const DEBUG_KEY = 'clay:debug:autosave';

export function isDebugEnabled() {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

function load() {
  return import('./autosave-debug.js').catch((err) => {
    console.warn('[autosave-debug] Failed to load the debug logger:', err);
    return null;
  });
}

export function logSaveCheck(label, matches) {
  if (!isDebugEnabled()) return;
  load().then((mod) => mod?.logSaveCheck(label, matches));
}

export function logBaseline(event, details = '') {
  if (!isDebugEnabled()) return;
  load().then((mod) => mod?.logBaseline(event, details));
}

export function logUnloadDiff(currentContents, lastSaved) {
  if (!isDebugEnabled()) return;
  load().then((mod) => mod?.logUnloadDiff(currentContents, lastSaved));
}

export function logUnloadDiffSync(currentContents, lastSaved) {
  if (!isDebugEnabled()) return;
  load().then((mod) => mod?.logUnloadDiffSync(currentContents, lastSaved));
}

export function preloadIfEnabled() {
  if (!isDebugEnabled()) return;
  load().then((mod) => mod?.preloadIfEnabled());
}
