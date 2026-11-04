/**
 * session.js — the source map at work: fetch, model, pair, render, adopt.
 *
 * On by default in edit mode; `exclude=source` turns it off. The mechanism lives in
 * core/source-map.js; this file is the
 * session around it: fetch the bytes this document was loaded from, pair them to
 * the page, render the save through them, verify, and re-pair when the file moves
 * under us. plugins/source.js is the thin facade over it and imports it on demand, so
 * nothing here — and with it core/source-map.js and parse5 — is evaluated until a save
 * needs it or code reads `clay.source.ready`.
 *
 * FOUR MOMENTS
 *
 *   boot          fetch the source, model it, refuse anything that is not this
 *                 document, and pair it against a save clone.
 *   save          render; verify; send the render if it verifies and today's full
 *                 serialization if it does not, counting the second case.
 *   accepted      re-model against the bytes the host took, so the next save is
 *                 measured from what is on disk rather than from what was there at
 *                 boot.
 *   sync-applied  re-pair, because a morph replaces live nodes and the map is keyed
 *                 by node identity.
 *
 * The accepted-save re-model is deferred and coalesced, so it never sits between a save
 * landing and the page hearing about it. A sync frame's re-pair shares that idle refresh,
 * so a burst of frames costs one walk, and a save, `text()` or `locate()` that comes
 * before it runs it first, so none of them work from a map the morph made stale.
 *
 * NOTHING HERE BLOCKS BOOT. The install is async and the loader does not wait for
 * it. Only the save that asked for it waits, and a save after a failed install is the
 * ordinary full serialization rather than an error. For a large document that wait is
 * itself sliced: the model is parsed across tasks, and so is a queued repair, on the same
 * driver and the same threshold the save's own preparation uses.
 *
 * ON DEMAND
 *
 * Nothing here runs at import: `start` is the one entry, and the facade calls it when a
 * save needs the parser or a reader asks for `clay.source.ready`. `release` takes an
 * install back — the renderer, a scheduled refresh and the installed flag — and bumps
 * `state.session`, so an answer that arrives after the session ended installs nothing.
 *
 * WHEN IT DOES NOTHING
 *
 * Any of these leaves the save pipeline untouched, and each says so once in the
 * console rather than repeatedly at save time:
 *
 *   the source fetch fails, redirects, or is not text/html
 *   the fetched bytes disagree with the live document outside <html>
 *   the render throws
 *   the render does not verify
 */

import {
  model,
  modelSteps,
  checkSource,
  locate,
  nodeAt,
  pair,
  pairCapturedSteps,
  pairSteps,
  render,
  verifyForSaveSteps,
  verifyRenderedSteps
} from '../core/source-map.js';
import { drain, runSliced } from '../lib/slice.js';
import {
  attachCaptureArtifact,
  captureSaveClone,
  currentCaptureContext,
  originalSnapshotNode,
  setSaveRenderer
} from '../core/snapshot.js';
import { keepaliveHeld, onSaveAccepted } from '../core/save-core.js';
import { SLICED_SAVE_MIN_BYTES } from '../core/save-slices.js';
import { lastSeenEtag } from '../core/etag.js';

const state = {
  installed: false,
  refused: null,
  // How many sessions have been uninstalled. An install applies nothing when the session
  // that asked for it has ended in the meantime, so a late answer cannot put a renderer
  // or a map back into view.
  session: 0,
  model: null,
  map: null,
  stats: null,
  saves: 0,
  reprints: 0,
  lastReprint: null,
  partialReprints: 0,
  lastPartialReprint: null,
  // What the last render produced, so the save the host accepts can be counted and
  // announced as what it was. Cleared once reported.
  lastOutcome: null,
  lastRenderMs: null,
  lastBytes: null,
  timing: { fetch: null, model: null, pair: null, refresh: null },
  refreshes: 0,
  // How many times the map has been rebuilt from the page since this module
  // installed. A candidate's map is only valid while this is unchanged: a morph
  // replaces live nodes, and a disk frame replaces the model.
  repairs: 0,
  refreshQueued: false,
  pendingBytes: null,
  refetch: false,
  // How many times newer file bytes have replaced the model: an accepted save, a disk
  // frame, or a newer fetch. A fetch answers about the file at the moment the host read
  // it, so this is what tells a late answer that something newer already landed.
  adoptions: 0,
};

// How many times a boot fetch asks again after a save or a disk frame overtook it before
// it gives up and leaves saves on the full serialization.
const SUPERSEDED_RETRIES = 2;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The main-thread time one slice of an install or a repair may spend before handing the
// page back. The same budget the save's own preparation takes.
const SLICED_STEP_BUDGET_MS = 4;

// What an install's steps answer when a save or a disk frame replaced the file while they
// ran: no answer at all, and the caller asks again.
const SUPERSEDED = Object.freeze({ superseded: true });

/**
 * Whether a walk over bytes this big runs across tasks instead of in one.
 *
 * The threshold and both exceptions are the save's (core/save-slices.js): below
 * `SLICED_SAVE_MIN_BYTES` the one-task walk is cheaper than the scheduling, a hidden tab
 * has no typing to protect and its timers are throttled, and a keepalive save belongs to
 * a page that is going away and cannot wait for a task boundary.
 */
function slicesWalk(bytes) {
  if (document.hidden) return false;
  if (keepaliveHeld()) return false;
  return bytes >= SLICED_SAVE_MIN_BYTES;
}

const PROJECTED_MAP_PREFIX = '<script type="application/json" id="clay-runtime-map"';

/**
 * Bytes a host projected for its own delivery are not the file: the runtime URLs in them
 * point at the local mirror and may carry a descriptor the file never held. Modelling them
 * would make this tab's next save copy the projection back into the file.
 */
const isProjected = (text) => text.includes(PROJECTED_MAP_PREFIX) || text.includes('/_/clayjs/');

/**
 * The bytes this document was loaded from.
 *
 * Every guard here is about one failure: writing somebody else's page into this
 * file. `redirect: 'manual'` and the `redirected` check catch a host that answers a
 * logged-out request with a login page at another URL; the content-type check
 * catches one that answers with JSON or an error page; `cache: 'no-store'` keeps a
 * stale cached copy of an older version of this document out of the model. The
 * shape check in checkSource is the backstop for whatever gets past all three.
 */
async function fetchSource(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    credentials: 'same-origin',
    headers: { 'Clay-Source': '1' }
  });
  if (!res.ok) throw new Error(`source fetch: status ${res.status}`);
  if (res.redirected || res.type === 'opaqueredirect') throw new Error('source fetch: redirected');
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('text/html')) throw new Error(`source fetch: content-type ${type || 'missing'}`);
  const text = await res.text();
  if (text.includes(PROJECTED_MAP_PREFIX)) throw new Error('source fetch: projected response');
  return text;
}

/**
 * Pair the model against the page.
 *
 * Over a SAVE CLONE, not the live DOM. The clone is in the file's own domain: edit
 * mode deactivated back to the inert attribute forms, [no-save] regions gone, every
 * document transform run. Pairing the live DOM instead would compare
 * `contenteditable="true"` against the file's `inert-contenteditable="true"` and lose
 * the two strongest signature tiers on every activated element and every ancestor of
 * one. The map is keyed through snapshot provenance to the LIVE node, because the
 * clone is rebuilt on every save and its nodes are new objects each time.
 *
 * This capture is an INSPECTION, not a save, and it happens at boot and again on every
 * incoming live-sync frame. So it takes neither of the two things a save capture does
 * on its way past: it does not close the undo batch, which at boot and mid-typing
 * would split the user's undo history at a point they did not make, and it does not
 * run the page's own [onbeforesave] and [onbeforesnapshot] handlers, which are author
 * JavaScript that can do anything and are meant to run once per save. The cost is that
 * a page using those handlers pairs against a tree slightly behind the one it will
 * save, which costs some formatting fidelity on the nodes a handler touches and
 * nothing else, because the render is verified either way.
 */
function pairAgainstPage(m) {
  const clone = captureSaveClone({ flushUndo: false, authored: false });
  return pair(clone, m, originalSnapshotNode);
}

function* pairAgainstPageSteps(m) {
  const clone = captureSaveClone({ flushUndo: false, authored: false });
  return yield* pairSteps(clone, m, originalSnapshotNode);
}

/**
 * The version a set of bytes names for itself, or null when nothing stamped it.
 *
 * A host writes `documentetag` on the root of the bytes it stored, so a fetch answers
 * with the version it read, which is not necessarily the one this page was built from.
 */
function stampedVersion(m) {
  const html = m.doc && m.doc.childNodes.find((node) => node.nodeName === 'html');
  const attr = html && Array.isArray(html.attrs)
    ? html.attrs.find((attribute) => attribute.name === 'documentetag')
    : null;
  return attr && attr.value ? attr.value : null;
}

/**
 * The version this session represents: the file the reader handed it, else the version this
 * tab last saw, else — for an explicit edit boot, which has no reader — the version the
 * document was served with.
 */
function heldVersion(context) {
  const represented = context && context.represented && context.represented.etag;
  if (represented) return represented;
  const seen = lastSeenEtag();
  if (seen) return seen;
  return context === null ? document.documentElement.getAttribute('documentetag') || null : null;
}

/**
 * A fetch is an answer about the file as it was when the host read it, and a boot fetch
 * can come back after the file has moved on. Bytes that name a version this page does
 * not hold are that newer file: adopting them would pair this page against content it
 * never received, and the next save would print its older bytes back over them. The
 * stamp and the model go together, so neither is taken from a late answer.
 */
function staleVersion(m, context) {
  const stamp = stampedVersion(m);
  const held = heldVersion(context);
  if (!stamp || !held || stamp === held) return null;
  return `source refused: the fetch answered version ${stamp} while this page holds ${held}`;
}

async function install(sourceUrl, context = null, attempt = 0, render = true, latest = null) {
  const session = state.session;
  const t0 = now();
  const generation = state.adoptions;
  state.refused = null;
  // Bytes this page already holds for the file — the reader's receipt, an accepted save,
  // a disk frame — are the file, so the install starts from them instead of asking the
  // host for a copy it has just written. Every check below runs on whichever answer it
  // gets, so this is a request saved and not a guard skipped.
  const receipt = latest ? latest() : null;
  const receiptBytes = receipt && typeof receipt.bytes === 'string' && !isProjected(receipt.bytes)
    ? receipt.bytes
    : null;
  try {
    const src = receiptBytes !== null ? receiptBytes : await fetchSource(sourceUrl);
    if (session !== state.session) return null;
    const t1 = now();
    const answer = await runInstallSteps({ src, context, render, session, generation, t0, t1 });
    if (answer !== SUPERSEDED) return answer;
    // A save was accepted, or a disk frame carried newer bytes, while this answer was on
    // its way. Those bytes are the file now, so ask again rather than adopt an older
    // answer; a page that will not hold still is refused instead of retried forever.
    if (attempt < SUPERSEDED_RETRIES) return install(sourceUrl, context, attempt + 1, render, latest);
    throw new Error('source refused: a save replaced the file while the fetch was in flight');
  } catch (err) {
    // Not an error the page can do anything about, and not a failure of the save:
    // saves go out exactly as they would without this plugin. Said once.
    if (session !== state.session) return null;
    state.refused = String(err && err.message ? err.message : err);
    console.info(`clayjs: source map off (${state.refused}); saves use the full serialization`);
    return null;
  }
}

/**
 * Model and pair the bytes an install fetched, as steps.
 *
 * `drain` is the install this module always had and `runSliced` is the same walk across
 * tasks, so a large document's first use hands the page back while its model is parsed
 * and again while the page is paired against it: the pairing has a step form too, and
 * yields every `YIELD_EVERY` nodes hashed or bound.
 *
 * Nothing is written to the session until the last yield is behind it, and an install
 * whose page moved underneath it answers `SUPERSEDED` or null rather than installing a
 * model of bytes the file no longer holds.
 */
function* installSteps(job) {
  const m = yield* modelSteps(job.src);
  const refused = checkSource(m, document);
  if (refused) throw new Error(`source refused: ${refused}`);
  const stale = staleVersion(m, job.context);
  if (stale) throw new Error(stale);
  if (state.adoptions !== job.generation) return SUPERSEDED;
  const t2 = now();
  yield;
  if (state.session !== job.session) return null;
  if (state.adoptions !== job.generation) return SUPERSEDED;
  const { map, stats } = yield* pairAgainstPageSteps(m);
  if (state.session !== job.session) return null;
  if (state.adoptions !== job.generation) return SUPERSEDED;
  const t3 = now();

  state.model = m;
  state.map = map;
  state.stats = stats;
  state.timing = { fetch: job.t1 - job.t0, model: t2 - job.t1, pair: t3 - t2, refresh: null };
  state.installed = true;
  if (job.render) setSaveRenderer(renderSave, { steps: renderSaveSteps });
  return summary();
}

/**
 * Run one install's steps in this task or across tasks, by the document's size.
 *
 * A session that ends while the walk yields aborts it, so a late answer installs nothing,
 * which is the rule the fetch half already followed.
 */
async function runInstallSteps(job) {
  if (!slicesWalk(job.src.length)) return drain(installSteps(job));
  const signal = { get aborted() { return state.session !== job.session; } };
  const answer = await runSliced(installSteps(job), { budgetMs: SLICED_STEP_BUDGET_MS, signal });
  return answer && answer.aborted === true ? null : answer;
}

/**
 * Render one save, or hand back today's bytes.
 *
 * Exported so a test can drive the whole path, including the fallback, without a
 * server: `renderSave(clone, today, { breakText: true })` makes every text node
 * reprint, which changes the bytes while leaving the tree identical, and the verifier
 * must still pass it — a tree comparison is the right answer there, and reading that
 * pass as "the verifier is blind" is a mistake this project has already made once.
 * `{ corrupt: 'drop-first-text' }` is the one that must be REJECTED: it changes the
 * tree, which is exactly what the verifier is for.
 *
 * A render that does not verify is not thrown away whole. verify says where it first
 * differs; that element is printed in full and the render tried again, widening to the
 * parent while it still fails. Everything outside the printed elements is still the
 * author's bytes. Only when the widening reaches <html>, or the failure has no node to
 * point at (the prologue, a parse-error count), is today's full serialization sent.
 *
 * Nothing is counted or announced here. A render is not a save: an autosave that
 * found nothing changed, a refused save and a failed request all rendered. The
 * outcome is recorded, and `adopt` reports it when the host accepts these exact bytes.
 *
 * A render that belongs to a save capture also hands that capture a private artifact:
 * the model of the bytes it just verified, paired with the clone it verified them
 * against, so the save the host accepts does not parse and pair those same bytes a
 * second time. It is a candidate, not an answer: `adopt` installs it only if the host
 * took these exact bytes and nothing has replaced the page's pairing since. A page
 * with its own [onbeforesave] or [onbeforesnapshot] handlers gets none, because those
 * handlers can edit the clone after the capture and the inspection path is what
 * describes the live page there.
 */
export function renderSave(clone, today, opts = {}) {
  return drain(renderSaveSteps(clone, today, opts));
}

/**
 * The same render, sliced: exactly one generator, so a save can run its verification
 * across tasks without a second copy of this logic. Every assignment to the session
 * happens after the last yield of its phase, so a slice that is aborted leaves the
 * session as it was found and the next save renders from the same state.
 *
 * The generation the render started from is recorded, because a morph or an accepted
 * save can re-pair the map while the verifier is yielding. A render whose bytes were
 * laid out against a map that has since been rebuilt describes a page that is no longer
 * here, so it is refused like any other render that cannot be trusted: today's bytes.
 */
export function* renderSaveSteps(clone, today, opts = {}) {
  if (!state.installed) return today;
  // A refresh still waiting for idle time runs now, so this save never renders from a
  // map a morph made stale. It pairs against the page, not this clone: onbeforesave may
  // have changed the clone, and the map must describe the live page.
  yield* refreshNowSteps();
  const session = state.session;
  const generation = state.repairs;
  const capture = currentCaptureContext();
  const adoptable = !!capture && !capture.authoredHandlers;
  const print = new Set();
  let firstDiff = null;
  for (let round = 0; round <= MAX_PRINT_ROUNDS; round++) {
    let out;
    try {
      out = render(clone, state.map, state.model, originalSnapshotNode, { ...opts, print });
    } catch (err) {
      return fallback('render threw: ' + (err && err.message ? err.message : err), today);
    }
    // The verifier's retained parse is a cost, so it is only asked for when there is a
    // capture that could adopt it.
    const v = adoptable
      ? yield* verifyForSaveSteps(out.text, today, document, clone, state.model.parseErrors)
      : yield* verifyRenderedSteps(out.text, today, document, clone, state.model.parseErrors, false);
    if (v.ok) {
      const stale = renderSuperseded(session, generation);
      if (stale) return fallback(stale, today);
      const outcome = print.size
        ? { text: out.text, scope: 'partial', reason: firstDiff, printed: print.size }
        : { text: out.text, scope: null };
      const paired = v.model ? yield* pairCapturedSteps(clone, v.model, originalSnapshotNode) : null;
      const late = renderSuperseded(session, generation);
      if (late) return fallback(late, today);
      state.lastRenderMs = out.ms;
      state.lastBytes = out.text.length;
      state.lastOutcome = outcome;
      if (v.model) offerCandidate(v.model, out.text, capture, paired);
      return out.text;
    }
    if (firstDiff === null) firstDiff = v.diff;
    if (!v.at || !widen(clone, nodeAt(clone, v.at), print)) return fallback(firstDiff, today);
  }
  return fallback(firstDiff, today);
}

/**
 * Why a render this generator laid out can no longer be trusted, or null. Only a yield
 * can make this answer yes: a drained render never leaves this task.
 */
function renderSuperseded(session, generation) {
  if (state.session !== session) return 'render refused: the session ended while this render ran';
  if (!state.installed) return 'render refused: the source map was uninstalled while this render ran';
  if (state.repairs !== generation) return 'render refused: the map was re-paired while this render ran';
  return null;
}

/**
 * Hand this capture the model of the bytes it just verified, or nothing.
 *
 * The pairing is the whole point of the artifact: it must describe the live page, so
 * it is built by walking the verified clone and that model together. Anything that
 * does not correspond, node for node, leaves the capture without an artifact, and the
 * accepted save takes the inspection path it takes today.
 */
function offerCandidate(m, html, capture, paired) {
  if (!paired) return;
  attachCaptureArtifact({
    captureId: capture.captureId,
    html,
    source: {
      model: m,
      map: paired.map,
      stats: paired.stats,
      repairGeneration: state.repairs,
      outcome: state.lastOutcome,
    },
  });
}

const MAX_PRINT_ROUNDS = 8;

/**
 * Add the next element to print: the one holding `node`, or, when that is already
 * inside a printed element, that element's parent. false when the only element left is
 * the root, which is the full serialization by another name.
 */
function widen(clone, node, print) {
  let el = node && node.nodeType === 1 ? node : node && node.parentNode;
  for (let a = el; a && a !== clone; a = a.parentNode) {
    if (print.has(a)) { print.delete(a); el = a.parentNode; break; }
  }
  if (!el || el.nodeType !== 1 || el === clone) return false;
  print.add(el);
  return true;
}

/** Send today's full serialization, and remember that this render was a fallback. */
function fallback(reason, today) {
  state.lastOutcome = { text: today, scope: 'full', reason };
  return today;
}

/**
 * The fallback, and the alarm.
 *
 * Reported for a save the host accepted. The bytes that went out were today's, so the
 * floor of this whole mechanism is the behaviour it replaces. The event and the
 * counter are how a reprint gets fixed
 * in the renderer or in the page, which is the only place it should ever be fixed: a
 * verifier loosened to make this counter look better would pass exactly the writes it
 * exists to stop.
 */
function reprint(reason) {
  state.reprints++;
  state.lastReprint = reason;
  console.warn('clayjs: source map did not verify, saving the full serialization instead:', reason);
  document.dispatchEvent(new CustomEvent('clay:save-reprinted', { detail: { reason, scope: 'full' } }));
}

/**
 * Part of the document was printed rather than copied. Counted apart from a full
 * reprint because they are different news: this one kept the author's bytes everywhere
 * else, and its rate says how often the renderer and the page disagree about one
 * element, which is where the next renderer fix is.
 */
function partialReprint(reason, printed) {
  state.partialReprints++;
  state.lastPartialReprint = reason;
  console.info(`clayjs: source map printed ${printed} element(s) in full to match the page:`, reason);
  document.dispatchEvent(new CustomEvent('clay:save-reprinted', { detail: { reason, scope: 'partial', printed } }));
}

/**
 * The host took these bytes, so this is what the file holds now.
 *
 * Deferred, like the re-pair below and for the same reason: re-modelling walks the
 * whole document, and doing it inline would put that walk between the save landing
 * and the page being told about it. Only the most recent accepted bytes matter, so a
 * burst of saves costs one refresh.
 *
 * It is also where a save is counted, because it is the one place that knows a save
 * reached the file.
 *
 * A capture that rendered its own verified bytes brought a candidate with them, and
 * when the host took exactly those bytes that candidate IS the file: installing it is
 * a few assignments instead of a parse of the accepted bytes and a whole-document
 * re-pair. Everything else — a raw save, a fallback, a candidate whose pairing a morph
 * has since invalidated, a disk version that arrived while the save was in flight —
 * takes the guarded repair path, which is the behaviour this replaces.
 */
function adopt(bytes, accepted) {
  state.adoptions++;
  if (!state.installed) return;
  report(bytes, accepted && accepted.artifact ? accepted.artifact.source.outcome : null);
  if (adoptCandidate(bytes, accepted)) return;
  state.pendingBytes = bytes;
  scheduleRefresh();
}

/**
 * Install a capture's candidate model, if it is this save's and still describes the page.
 *
 * Three things have to agree, and each is a different mistake. The bytes: the artifact
 * is the model of the string that exact render returned, not of a later one. The
 * capture: `save.js` keeps the artifact with its request, so the ID rules out a
 * candidate that reached an accepted listener by any other route. The generation: a
 * morph replaces live nodes and a disk frame replaces the model, so a map built before
 * one is keyed to a page that is no longer here.
 */
function adoptCandidate(bytes, accepted) {
  const artifact = accepted && accepted.artifact;
  if (!artifact || !artifact.source) return false;
  if (artifact.html !== bytes) return false;
  if (accepted.captureId === null || accepted.captureId === undefined) return false;
  if (artifact.captureId !== accepted.captureId) return false;
  if (artifact.source.repairGeneration !== state.repairs) return false;
  if (state.refreshQueued || state.pendingBytes !== null) return false;
  state.model = artifact.source.model;
  state.map = artifact.source.map;
  state.stats = artifact.source.stats;
  return true;
}

/**
 * Count and announce an accepted save, if these are the bytes the last render
 * produced. Bytes this module did not render (a caller of `saveHtml` with its own
 * string, or an older render) are not its save to report.
 */
function report(bytes, fromCapture = null) {
  const outcome = state.lastOutcome && state.lastOutcome.text === bytes ? state.lastOutcome : fromCapture;
  if (!outcome || outcome.text !== bytes) return;
  if (state.lastOutcome === outcome) state.lastOutcome = null;
  state.saves++;
  if (outcome.scope === 'full') reprint(outcome.reason);
  else if (outcome.scope === 'partial') partialReprint(outcome.reason, outcome.printed);
}

/**
 * A morph replaced live nodes, so the map is keyed by objects that are no longer in
 * the page, and it has to be re-paired either way. A DISK frame also carries the bytes
 * now on disk, written by somebody else: those become the model, the same as bytes this
 * tab saved, or the next save would copy the old formatting back over theirs. A peer
 * frame changed nothing on disk, so the model stays. The re-pair runs in idle time, or
 * earlier if a save, `text()` or `locate()` needs it first.
 */
function queueRepair(event) {
  const detail = event && event.detail;
  if (detail && detail.source === 'disk' && typeof detail.html === 'string') {
    // Newer bytes than anything already in flight, adopted or not: a fetch that started
    // before this frame cannot answer for the file the frame describes, so the boot
    // fetch asks again rather than installing the version it asked about.
    state.adoptions++;
  }
  if (!state.installed) return;
  if (detail && detail.source === 'disk' && typeof detail.html === 'string') {
    if (isProjected(detail.html)) state.refetch = true;
    else state.pendingBytes = detail.html;
  }
  scheduleRefresh();
}

/**
 * Re-model if a save was accepted, re-pair either way, once, off the critical path.
 *
 * Coalescing is what makes this safe as well as cheap. Saves are serialized, so the
 * most recent accepted bytes are the file; a refresh that skipped an intermediate
 * save would still land on the right answer, and one that ran them out of order could
 * not.
 */
function scheduleRefresh() {
  if (state.refreshQueued) return;
  state.refreshQueued = true;
  if (typeof requestIdleCallback === 'function') requestIdleCallback(refreshSoon, { timeout: 2000 });
  else setTimeout(refreshSoon, 0);
}

/**
 * The queued refresh, run the way this document's size allows: in the caller's task for a
 * small one, across tasks for a large one, so a repair nobody is waiting for does not hold
 * the page for its whole duration.
 */
function refreshSoon() {
  if (!slicesWalk(refreshBytes())) { refreshNow(); return; }
  runSlicedRefresh();
}

/**
 * How big the bytes a queued refresh is about to model are: the accepted save's or a disk
 * frame's when there are any, else the model this session already holds.
 */
function refreshBytes() {
  if (typeof state.pendingBytes === 'string') return state.pendingBytes.length;
  return state.model ? state.model.src.length : 0;
}

/**
 * A refresh across tasks, and the one thing a sliced walk needs that a drained one does
 * not: a walk that stopped because something newer arrived left the queue in place, and
 * that newer answer's `scheduleRefresh` had nothing to do because the flag was still set.
 * So the same work is asked for again here. A session that ended drops it instead.
 */
async function runSlicedRefresh() {
  const session = state.session;
  const signal = { get aborted() { return state.session !== session; } };
  try {
    await runSliced(refreshNowSteps(), { budgetMs: SLICED_STEP_BUDGET_MS, signal });
  } catch (err) {
    console.warn('clayjs: source map could not run the queued repair:', err);
  }
  if (!state.refreshQueued || !state.installed || state.session !== session) return;
  state.refreshQueued = false;
  scheduleRefresh();
}

/**
 * Run a queued refresh now, in this task. A no-op when none is queued, which is also what
 * makes the idle callback of a refresh that `text()` or `locate()` already ran harmless.
 * Everything that reads the session synchronously comes through here: it must answer in
 * the caller's task, so it drains the same steps the idle refresh may resume across tasks.
 */
function refreshNow() {
  drain(refreshNowSteps());
}

/**
 * The same refresh, sliced: modelling yields, and nothing the session holds is written
 * until the last yield is behind it.
 *
 * An aborted slice must leave the queued refresh queued, with its bytes, so the work is
 * simply done again — nothing is half-adopted, and no counter is charged twice. That is
 * why the queue is read into locals and committed at the end, and why a newer model,
 * adoption or session arriving during a yield abandons this attempt rather than
 * overwriting it: the newer one left its own refresh queued.
 */
export function* refreshNowSteps() {
  if (!state.refreshQueued) return;
  if (!state.installed) { state.refreshQueued = false; return; }
  const session = state.session;
  const repairs = state.repairs;
  const adoptions = state.adoptions;
  const bytes = state.pendingBytes;
  const refetch = state.refetch && bytes === null;
  const t = now();
  // The two halves fail independently, so they are tried independently. A refused
  // re-model used to skip the re-pair with it, and the re-pair is the half that
  // cannot be skipped: a morph replaced live nodes, so the old map is keyed by
  // objects no longer in the page, and every save after that reprints the whole
  // document until something else queues a refresh. The previous model still
  // describes real bytes, so re-pairing against it is the right answer.
  let m = state.model;
  if (bytes !== null) {
    try {
      const next = yield* modelSteps(bytes);
      const refused = checkSource(next, document);
      if (refused) throw new Error(refused);
      m = next;
    } catch (err) {
      console.warn('clayjs: source map kept the previous model, the accepted bytes did not model:', err);
    }
  }
  yield;
  if (!superseded(session, repairs, adoptions)) return;
  let paired = null;
  try {
    paired = pairAgainstPage(m);
  } catch (err) {
    // The map is now stale rather than wrong: it still describes the pairing as of
    // the last successful refresh. Renders off a stale map verify or fall back like
    // any other, so this costs formatting fidelity and nothing else.
    console.warn('clayjs: source map could not re-pair, continuing on the previous map:', err);
  }
  state.refreshQueued = false;
  state.pendingBytes = null;
  if (refetch) state.refetch = false;
  // Counted even when the re-pair above failed: either way this page is not the page a
  // candidate captured before it was built against.
  state.repairs++;
  if (paired) {
    state.model = m;
    state.map = paired.map;
    state.stats = paired.stats;
    state.refreshes++;
    state.timing.refresh = now() - t;
  }
  if (refetch) refetchModel();
}

/** Whether something newer than the refresh this generator started arrived while it yielded. */
function superseded(session, repairs, adoptions) {
  return state.session === session && state.installed
    && state.repairs === repairs && state.adoptions === adoptions;
}

/**
 * Take the model from the file itself, after a disk frame arrived with bytes this host
 * projected rather than bytes on disk.
 *
 * The re-pair has already run against the previous model, which still describes real
 * bytes, so a fetch that fails or is refused costs nothing: the model stays as it was
 * and the same warning the refused branch gives says so. Anything that replaced the
 * model while the fetch was in flight is newer than these bytes and keeps the answer.
 */
function refetchModel() {
  const generation = state.repairs;
  const adoption = state.adoptions;
  fetchSource(window.location.href)
    .then((src) => {
      const next = model(src);
      const refused = checkSource(next, document);
      if (refused) throw new Error(refused);
      return next;
    })
    .then((m) => {
      // A save landed, or a newer fetch answered, while this one was in flight: its bytes
      // describe a file this page has already moved past.
      if (state.repairs !== generation || state.adoptions !== adoption) return;
      try {
        state.repairs++;
        state.adoptions++;
        const { map, stats } = pairAgainstPage(m);
        state.model = m;
        state.map = map;
        state.stats = stats;
        state.refreshes++;
      } catch (err) {
        console.warn('clayjs: source map could not re-pair, continuing on the previous map:', err);
      }
    })
    .catch((err) => {
      console.warn('clayjs: source map kept the previous model, the accepted bytes did not model:', err);
    });
}

function summary() {
  const s = state.stats;
  return {
    installed: state.installed,
    refused: state.refused,
    sourceBytes: state.model ? state.model.src.length : null,
    paired: s ? s.paired : 0,
    unresolved: s ? s.unresolved : 0,
    unmatchedLive: s ? s.unmatchedLive.length : 0,
    unmatchedSource: s ? s.unmatchedSource.length : 0,
    attrDiffs: s ? s.attrDiffs.length : 0,
    saves: state.saves,
    reprints: state.reprints,
    lastReprint: state.lastReprint,
    partialReprints: state.partialReprints,
    lastPartialReprint: state.lastPartialReprint,
    lastRenderMs: state.lastRenderMs,
    lastBytes: state.lastBytes,
    refreshes: state.refreshes,
    timing: state.timing,
  };
}

/**
 * The bytes this module believes are on disk right now. A refresh still queued from a save
 * or a disk frame runs first, so this is never the file before that.
 */
export function text() {
  refreshNow();
  return state.model ? state.model.src : null;
}

/**
 * Where a live element is in `text()`: `{ from, to, line, column }`, or null.
 *
 * Offsets and `column` are UTF-16 code units into `text()`, not bytes. Slice `text()` with them
 * and the answer is exact; hand them to something that counts bytes and it is wrong on any
 * document with non-ASCII content, which is the kind of mistake that shows up months later in
 * one customer's file.
 *
 * null whenever this module cannot answer, which includes the whole document when the session
 * never installed or refused it. `stats().installed` and `stats().refused` say which, and an
 * agent that cannot tell "this element is new" from "this document has no map" will eventually
 * write into a file it was never modelling.
 */
export function locateLive(node) {
  refreshNow();
  return state.installed && node ? locate(node, state.map, state.model) : null;
}

/** What did not pair, for working out why a document reprints more than it should. */
export function unpaired() {
  refreshNow();
  return state.stats
    ? { live: state.stats.unmatchedLive.slice(0, 50), source: state.stats.unmatchedSource.slice(0, 50) }
    : null;
}

export function stats() {
  refreshNow();
  return summary();
}

export const installed = () => state.installed;

/**
 * How many times the map has been rebuilt since this session installed.
 *
 * A render is refused when this changes while it runs, so a save that prepares across
 * tasks falls back to today's bytes rather than a pairing that no longer describes the page.
 */
export const repairGeneration = () => state.repairs;

/** The facade's dispose: take the install back, and invalidate whatever was still loading. */
export function release() {
  uninstall();
}

/**
 * Take an install back: the renderer, a scheduled refresh, and the installed state that
 * lets the hook and the listener do anything. The map and the model stay, so `text()` and
 * `locateLive()` keep answering about the last file this module modelled while a view is
 * reading it.
 */
function uninstall() {
  state.session++;
  state.installed = false;
  state.refreshQueued = false;
  state.pendingBytes = null;
  state.refetch = false;
  setSaveRenderer(null);
}

/**
 * The install a session's demand asks for.
 *
 * `context` is the mode entry's own context, when there was one: `represented` is the file
 * the reader handed that session. `latest` is the facade's newest receipt, read when the
 * install starts so a save or disk frame that landed while the parser loaded is the file
 * this session models rather than an answer older than it.
 */
export function start({ context = null, latest = null } = {}) {
  return install(window.location.href, context, 0, true, latest);
}

/** Bytes the host took. Re-models against them, or records them for the install to use. */
export { adopt as adoptAccepted };

// Registered once, when the session first loads: both bodies return while no session is
// installed, so a page that never demands the parser never runs either.
onSaveAccepted(adopt);
document.addEventListener('clay:sync-applied', queueRepair);
