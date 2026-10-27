/**
 * source.js — the facade over the source map.
 *
 * On by default in edit mode; `exclude=source` turns it off. The mechanism lives in
 * core/source-map.js and the session around it in source/session.js, and neither is
 * imported here: this file is the synchronous API a page reads (`clay.source`), the mode
 * lease, and the one demand that loads the rest.
 *
 * ON DEMAND
 *
 * The parser is 48 KB of parse5 plus the source map, and a page pays for it only when it
 * can change something. `prepare` installs a light lease and fetches nothing, `enable`
 * admits demand, and demand is exactly two things: a save that needs a byte-preserving
 * render, which asks `ensureForSave` from the save pipeline after its cheap gate, and
 * code in edit mode reading `clay.source.ready`. A clean autosave, a reader and a page
 * that never saves never load it, and an idle tail that fires after edit ready loads
 * nothing either.
 *
 * Before the session installs, `text()`, `locate()` and `stats()` answer the unavailable
 * values they always did, with `installed: false`. What the facade keeps in the meantime
 * is the newest bytes this page knows the file holds — the reader's receipt for the
 * session, an accepted save, a disk frame — so the install starts from the file rather
 * than asking the host for a copy it has just written, and a newer receipt supersedes an
 * older one.
 *
 * LIFECYCLE
 *
 * `prepare` installs the light lease, `enable` admits demand, `quiesce` keeps the
 * renderer for the exit's barrier save, and `dispose` takes it back and invalidates any
 * load still in flight: an answer that arrives after the session ended installs nothing.
 * A load that fails is the same logged, non-fatal outcome as before — saves go out exactly
 * as they would without this plugin — and `clay.source.ready` asks again.
 */

import { onSaveAccepted } from '../core/save-core.js';
import { startsAtImport } from '../core/is-edit-mode.js';

// Today's answer before the session installs: the same fields `stats()` returns, with
// `installed: false` and nothing counted.
const UNAVAILABLE = {
  installed: false,
  refused: null,
  sourceBytes: null,
  paired: 0,
  unresolved: 0,
  unmatchedLive: 0,
  unmatchedSource: 0,
  attrDiffs: 0,
  saves: 0,
  reprints: 0,
  lastReprint: null,
  partialReprints: 0,
  lastPartialReprint: null,
  lastRenderMs: null,
  lastBytes: null,
  refreshes: 0,
  timing: { fetch: null, model: null, pair: null, refresh: null },
};

// The loaded session. Null until something demands it.
let session = null;
// The mode entry that prepared this session, as the install needs it: what the reader
// said this tab represents.
let context = null;
// The newest bytes this page knows the file holds, and the version that came with them.
let receipt = null;
// Whether demand is admitted: an edit boot's own session, or a lease that was enabled.
let admitted = startsAtImport();
// How many sessions have ended. A load that resolves for an older one installs nothing,
// so a late answer cannot put a renderer or a map back into a view.
let epoch = 0;
// The install this session asked for, so two saves in the same breath share it.
let installing = null;
// Whether this session's one install attempt has already answered. A save waits for an
// attempt that is still running and never for one that is done: a refusal and a failed
// load are both answers, and the next save goes out as it would without the plugin.
// `clay.source.ready` is the way to ask again, and it retries.
let answered = false;

let loading = null;
function loadSession() {
  loading ??= import("../source/session.js").catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Keep these bytes as what this page believes the file holds. A newer one wins. */
function retain(bytes, etag, seq) {
  if (typeof bytes !== 'string') return;
  receipt = Object.freeze({ bytes, etag: etag ?? null, seq: seq ?? null });
}

/**
 * Start the one install this session needs, or hand back the one already running.
 *
 * The session module is imported here and nowhere else, so a page that never demands the
 * parser never evaluates source-map.js. A failed import clears the memo: the fallback is
 * today's save, and the next demand asks again.
 */
function installOnce() {
  if (installing) return installing;
  const mine = epoch;
  const entry = context;
  installing = loadSession().then((mod) => {
    session = mod;
    if (mine !== epoch) {
      installing = null;
      return null;
    }
    return mod.start({ context: entry, latest: () => receipt });
  }).catch((error) => {
    installing = null;
    console.info('clayjs: source map off (' + (error && error.message ? error.message : error) + '); saves use the full serialization');
    return null;
  }).then((value) => {
    if (mine === epoch) answered = true;
    return value;
  });
  return installing;
}

/**
 * The save pipeline's question: may this save be rendered through the source map?
 *
 * Called — through `clay.source.ensureForSave`, so a page that excluded this plugin asks
 * nothing — after the cheap gate that says a save may happen and before the one capture.
 * null means there is nothing to wait for: no session for this page, demand not admitted,
 * or this session's attempt has already answered. The save then goes out exactly as it
 * would without this plugin.
 */
function ensureForSave() {
  if (!admitted || answered) return null;
  return installOnce();
}

/** Take an install back: the renderer, a queued refresh, and any load still in flight. */
function end() {
  epoch++;
  admitted = false;
  answered = false;
  installing = null;
  context = null;
  if (session) session.release();
}

// An accepted save before the install is the file: the retained receipt becomes these
// bytes, and the session's superseded answer is what makes a newer one win.
onSaveAccepted((bytes, accepted) => {
  retain(bytes, receipt ? receipt.etag : null, receipt ? receipt.seq : null);
  if (session && !session.installed()) session.adoptAccepted(bytes, accepted);
});

// A disk frame is somebody else writing the file. Before the install it replaces the
// receipt the same way; after it, the session's own listener re-models from it.
document.addEventListener('clay:sync-applied', (event) => {
  const detail = event && event.detail;
  if (!detail || detail.source !== 'disk' || typeof detail.html !== 'string') return;
  retain(detail.html, detail.etag, detail.seq);
  if (session && !session.installed()) session.adoptAccepted(detail.html, null);
});

/** Render one save through the loaded session, or hand back today's bytes. */
export function renderSave(clone, today, opts = {}) {
  return session ? session.renderSave(clone, today, opts) : today;
}

export const source = {
  /**
   * The install, in edit mode: reading this is the second thing that demands the parser.
   * Null where there is nothing to install, which is what a view and a page without the
   * plugin have always answered.
   */
  get ready() {
    if (!admitted) return null;
    return installOnce();
  },
  stats: () => (session ? session.stats() : { ...UNAVAILABLE }),
  /** The bytes this module believes are on disk right now. */
  text: () => (session ? session.text() : null),
  /**
   * Where a live element is in those bytes: `{ from, to, line, column }`, or null.
   *
   * Offsets and `column` are UTF-16 code units into `text()`, not bytes. null whenever this
   * module cannot answer, which includes the whole document before the session installed.
   * `stats().installed` and `stats().refused` say which.
   */
  locate: (node) => (session ? session.locateLive(node) : null),
  /** What did not pair, for working out why a document reprints more than it should. */
  unpaired: () => (session ? session.unpaired() : null),
  /** The save pipeline's own ask: a promise to wait for before its capture, or null. */
  ensureForSave,
};

/**
 * The source map as a mode lease.
 *
 * `prepare` records the file this session represents and installs the light lease; it
 * fetches nothing and pairs nothing. `enable` admits demand, which is the only thing that
 * belongs to the commit. `quiesce` keeps the renderer for the exit's barrier save,
 * `resume` admits demand again after a refused exit, and `dispose` takes the session back
 * and invalidates whatever was still loading.
 *
 * `initial: true` is this tab's own edit boot, whose session is this one: the lease adopts
 * it, and the boot's demand installed — or did not — exactly as it would have.
 */
export function sourceParticipant() {
  return {
    id: 'clay:source',
    // After the save session (10), whose saves this renderer answers, and before the
    // page (400), whose editor takes the article the pairing is taken over.
    order: 30,
    prepare(entry = {}) {
      const represented = entry && entry.represented;
      if (represented) {
        context = { represented };
        retain(represented.bytes, represented.etag, represented.seq);
      }
      if (entry && entry.initial === true) {
        admitted = true;
        return { enable() {}, quiesce() {}, resume() {}, dispose: end };
      }
      const mine = ++epoch;
      admitted = false;
      answered = false;
      installing = null;
      return {
        enable() { if (mine === epoch) admitted = true; },
        quiesce() {},
        resume() { if (mine === epoch) admitted = true; },
        dispose() { if (mine === epoch) end(); },
      };
    },
  };
}

export { sourceParticipant as modeParticipant };

export default source;
