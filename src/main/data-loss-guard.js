/**
 * data-loss-guard (Hyperclay Local) — the per-file guard store, detection
 * orchestration, the "restore my data" merge, and the panel transport for the
 * desktop app. CommonJS counterpart of hyperclay/server-lib/data-loss-guard.js;
 * shares the exact same detection brain (the vendored data-loss-core.cjs).
 *
 * Store: a private, sync-ignored JSON file per site at
 *   {baseDir}/.hyperclay/guard/<base>.json
 * (mirrors the .hyperclay/api/ sidecar pattern — already excluded by every sync
 * scan). Whole-file Revert backups live beside it as <base>.recover.html, or
 * fall back to the newest sites-versions/<base>/*.html for raw external writes.
 *
 * Everything here is NON-FATAL to the write: a guard failure logs and returns.
 * See plans/hyperclay-local/data-clobber-guard-plan.md.
 */
const fs = require('fs').promises;
const path = require('upath');
const cheerio = require('cheerio');
const { liveSync } = require('livesync-hyperclay');
const core = require('./data-loss-core.cjs');
const { extractViaTag } = require('./utils/data-extractor');
const { compareNewestFirst } = require('./utils/prune-versions');
const { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain } = require('./utils/real-dir-chain');

const {
  classifyDestruction,
  shouldFire,
  uiProvenance,
  lossSummary,
  islandsEqual,
  meaningful,
  isEmptyIsland,
} = core;

const RULES_NAME = 'api';
const GUARD_DIR = '.hyperclay/guard';

// Cached dynamic import of the ESM engine (apply/findRulesIn/errors) — same
// bridge pattern as utils/data-extractor.js. cheerio is a plain require.
let enginePromise = null;
function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('hyper-html-api/engine'),
      import('hyper-html-api/cheerio'),
    ]).then(([engine, cheerioAdapterMod]) => ({
      apply: engine.apply,
      findRulesIn: engine.findRulesIn,
      errors: engine.errors,
      cheerioAdapter: cheerioAdapterMod.default,
    }));
  }
  return enginePromise;
}

// --- extraction (async). { api: data } | null; throws on version skew. ---
async function extractIsland(html) {
  const data = await extractViaTag(html, RULES_NAME);
  return data === null || data === undefined ? null : { [RULES_NAME]: data };
}
async function safeExtractIsland(html) {
  try {
    return { ok: true, island: await extractIsland(html) };
  } catch {
    return { ok: false, island: null };
  }
}

const islandHash = core.islandHash;

// classifyDestruction + log the cost-guard fallback (plan §4: "log() the skip").
// The pure core only flags it on D; the environment wrapper does the logging.
function classify(base, inc) {
  const D = classifyDestruction(base, inc);
  if (D.fuzzyFallback) {
    console.warn('[data-guard] item list too large for fuzzy matching; used a coarser index-aligned compare (detection may be less precise).');
  }
  return D;
}

// The loss is undone only when the current island still CONTAINS every pinned
// recoverable atom (additions allowed). `!anyDestruction` alone is too loose: it
// also passes when a recoverable atom was MODIFIED to a different value or reset
// to a placeholder, which would silently drop the recovery chip without the data
// ever coming back. D here is classify(recoverableData, currentIsland).
function lossUndone(D) {
  return !D.anyDestruction && D.modifiedAtoms === 0 && D.placeholderResets === 0;
}

// ---------------------------------------------------------------------------
// Store — one JSON file per site, serialized by a per-file in-process lock.
// ---------------------------------------------------------------------------
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain alive but don't leak rejections into the next waiter.
  locks.set(key, next.catch(() => {}));
  return next;
}

function guardRelPath(name) {
  const base = name.replace(/\.(html|htmlclay)$/, '');
  return path.join(GUARD_DIR, base + '.json');
}
function resolveGuardPath(baseDir, name) {
  const abs = path.resolve(path.join(baseDir, guardRelPath(name)));
  const root = path.resolve(baseDir);
  if (!abs.startsWith(root + path.sep)) throw new Error('Guard path escapes base directory');
  return abs;
}
function recoverHtmlPath(baseDir, name) {
  const base = name.replace(/\.(html|htmlclay)$/, '');
  const abs = path.resolve(path.join(baseDir, GUARD_DIR, base + '.recover.html'));
  const root = path.resolve(baseDir);
  if (!abs.startsWith(root + path.sep)) throw new Error('Recover path escapes base directory');
  return abs;
}

async function readGuard(baseDir, name) {
  try {
    const txt = await fs.readFile(resolveGuardPath(baseDir, name), 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
async function writeGuard(baseDir, name, guard) {
  const abs = resolveGuardPath(baseDir, name);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Atomic write: a crash mid-write would otherwise corrupt the JSON and lose
  // the pinned recoverableData (readGuard self-heals to an empty guard).
  const tmp = abs + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(guard), 'utf8');
  await fs.rename(tmp, abs);
}
function emptyGuard() {
  return { baseline: null, uiWorkPending: false, event: null, status: 'none' };
}

// Newest sites-versions/<base>/*.html (the last-good full file for a raw write).
// Ranked by parsed instant, NOT by filename: legacy backup names are local wall
// time, which repeats across a DST fall-back, so a lexical sort could hand back
// the older of the two as "newest" and silently revert to stale content.
async function newestVersionPath(baseDir, name) {
  try {
    const base = name.replace(/\.(html|htmlclay)$/, '');
    const dir = path.join(baseDir, 'sites-versions', base);
    // Refuse a symlinked chain: the path this returns feeds a Revert that
    // overwrites the live file, so it must not resolve out of the served tree.
    const canonicalBase = await canonicalizeBase(baseDir);
    await assertRealDirChain(canonicalBase, rebaseOntoCanonical(canonicalBase, baseDir, dir));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.html'));
    if (!files.length) return null;

    const ranked = [];
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        ranked.push({ full, name: file, mtimeMs: (await fs.stat(full)).mtimeMs });
      } catch {}
    }
    if (!ranked.length) return null;
    // Same comparator the pruner uses, so "newest" means one thing everywhere:
    // instant first, then the collision suffix that orders a same-millisecond
    // burst.
    ranked.sort(compareNewestFirst);
    return ranked[0].full;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// runDataLossGuard — one detection pass for all three local write paths.
//
// baseDir       : sync folder
// name          : file path with extension (liveSync key shape)
// newHtml       : the bytes just written
// prevContent   : pre-write body (string) or null (raw watcher has only a hash)
// prov          : 'external' | 'ui-background' | 'ui-gestured'
//
// Returns the client-safe event when a loss is raised, else null. Never throws.
// ---------------------------------------------------------------------------
async function runDataLossGuard({ baseDir, name, newHtml, prevContent, prov }) {
  try {
    const inc = await safeExtractIsland(newHtml);
    if (!inc.ok) return null; // parse/version skew -> fail open

    let raised = null;
    let autoResolvedId = null;

    await withLock(`${baseDir}::${name}`, async () => {
      const guard = (await readGuard(baseDir, name)) || emptyGuard();

      // Cold start (seed-on-first-sight from KNOWN-GOOD content only).
      if (!guard.baseline) {
        if (prevContent != null) {
          const seed = await safeExtractIsland(prevContent);
          if (seed.ok && seed.island && !isEmptyIsland(seed.island)) {
            guard.baseline = { data: seed.island, hash: islandHash(seed.island), at: Date.now() };
            guard.uiWorkPending = false;
            // fall through and detect THIS write against the seed
          } else {
            await seedBlind(guard, inc.island);
            await writeGuard(baseDir, name, guard);
            return;
          }
        } else {
          // Raw watcher first sight — blind seed, can't detect this write.
          await seedBlind(guard, inc.island);
          await writeGuard(baseDir, name, guard);
          return;
        }
      }

      const base = guard.baseline.data;

      if (guard.event) {
        // Cross-environment auto-clear: the loss is undone once an incoming write
        // still CONTAINS every pinned recoverable atom — an exact restore, OR a
        // restore that also kept legitimate additions. `base` is the pinned
        // recoverableData while an event is open (pin-once never advances it), so
        // D measures destruction/modification of the recoverable set. A write that
        // merely modifies a recoverable atom to a new value has NOT restored it, so
        // lossUndone stays false and the (valid) warning is preserved.
        const D = classify(base, inc.island);
        if (lossUndone(D)) {
          autoResolvedId = guard.event.id;
          guard.event = null;
          guard.status = 'restored';
          guard.uiWorkPending = false;
          guard.baseline = { data: inc.island, hash: islandHash(inc.island), at: Date.now() };
          await writeGuard(baseDir, name, guard);
          return;
        }
        if (shouldFire(prov, guard.uiWorkPending, base, inc.island, D)) {
          guard.event.lastWriteAt = Date.now();
        }
        if (prov === 'external') guard.uiWorkPending = false;
        await writeGuard(baseDir, name, guard);
        return;
      }

      const D = classify(base, inc.island);
      const fire = shouldFire(prov, guard.uiWorkPending, base, inc.island, D);

      if (fire) {
        const recoverableHtmlBackup = await captureRecoverPath(baseDir, name, prevContent);
        const crypto = require('crypto');
        guard.event = {
          id: crypto.randomUUID(),
          recoverableData: base,
          recoverableHtmlBackup,
          firstDetectedAt: Date.now(),
          lastWriteAt: Date.now(),
          lossSummary: lossSummary(prov, D),
          status: 'pending',
        };
        guard.status = 'pending';
        if (prov === 'external') guard.uiWorkPending = false;
        await writeGuard(baseDir, name, guard);
        raised = guard.event;
        return;
      }

      if (prov === 'ui-gestured') {
        guard.baseline = { data: inc.island, hash: islandHash(inc.island), at: Date.now() };
        guard.uiWorkPending = true;
      } else if (prov === 'external') {
        guard.uiWorkPending = false;
      }
      await writeGuard(baseDir, name, guard);
    });

    if (autoResolvedId) {
      notifyResolved(name, autoResolvedId);
      return null;
    }
    if (raised) {
      const clientEvent = await toClientEvent(raised, newHtml);
      notifyRaised(name, clientEvent);
      return clientEvent;
    }
    return null;
  } catch (e) {
    console.error('[data-guard] runDataLossGuard failed (non-fatal):', e && e.message ? e.message : e);
    return null;
  }
}

async function seedBlind(guard, island) {
  if (island && !isEmptyIsland(island)) {
    guard.baseline = { data: island, hash: islandHash(island), at: Date.now() };
  }
  guard.uiWorkPending = false;
}

// The whole last-good file for Revert, always COPIED INTO THE GUARD'S OWN
// STORAGE. Prefer the pre-write body; else the newest sites-versions entry.
//
// Returning a sites-versions path directly (as this used to for raw writes)
// would pin a file the retention pruner is free to delete. The alternative —
// teaching the pruner an exemption list — would need that list consulted under
// a lock the pruner does not hold, which is a race. Copying the bytes here
// keeps the pruner a dumb, predictable function with no shared state.
async function captureRecoverPath(baseDir, name, prevContent) {
  let body = prevContent;

  if (body == null) {
    const versionPath = await newestVersionPath(baseDir, name);
    if (versionPath == null) return null;
    try {
      body = await fs.readFile(versionPath, 'utf8');
    } catch (e) {
      console.error('[data-guard] captureRecoverPath read failed:', e && e.message ? e.message : e);
      return null;
    }
  }

  try {
    const abs = recoverHtmlPath(baseDir, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
    return abs;
  } catch (e) {
    console.error('[data-guard] captureRecoverPath write failed:', e && e.message ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provenance for the local /save path (always a UI save, split by userDriven).
// ---------------------------------------------------------------------------
function provenanceForLocalSave(userDriven) {
  return uiProvenance(userDriven);
}

// ---------------------------------------------------------------------------
// Live transport.
// ---------------------------------------------------------------------------
function notifyRaised(name, clientEvent) {
  try {
    liveSync.notify(name, { msgType: 'data-loss', action: 'raised', msg: 'Saved data overwritten', data: clientEvent });
  } catch (e) {
    console.error('[data-guard] notifyRaised failed:', e && e.message ? e.message : e);
  }
}
function notifyResolved(name, eventId) {
  try {
    liveSync.notify(name, { msgType: 'data-loss', action: 'resolved', msg: 'Data guard resolved', data: { id: eventId } });
  } catch (e) {
    console.error('[data-guard] notifyResolved failed:', e && e.message ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// "Restore my data" merge (async). See the platform note re shapeMatch.
// ---------------------------------------------------------------------------
async function restoreDataOntoHtml(currentHtml, recoverableData) {
  const { apply, findRulesIn, cheerioAdapter } = await loadEngine();
  const $ = cheerio.load(currentHtml);
  const root = $.root();
  let found;
  try {
    found = findRulesIn(cheerioAdapter, root, RULES_NAME);
  } catch {
    return { failed: RULES_NAME };
  }
  if (!found || !recoverableData || !(RULES_NAME in recoverableData)) return { failed: RULES_NAME };
  const { rules } = found;
  const data = recoverableData[RULES_NAME];
  try {
    apply(cheerioAdapter, root, rules, data);
  } catch (e) {
    // Any apply failure (ShapeMismatch, EmptyListInsert when a clobber emptied a
    // list so there's no sibling to clone, etc.) means we can't cleanly
    // round-trip — offer Revert instead of writing a wrong restore.
    return { failed: RULES_NAME };
  }
  const mergedHtml = $.html();
  let reExtracted;
  try {
    reExtracted = await extractViaTag(mergedHtml, RULES_NAME);
  } catch {
    return { failed: RULES_NAME };
  }
  if (!islandsEqual({ [RULES_NAME]: reExtracted }, { [RULES_NAME]: data })) return { failed: RULES_NAME };
  return { html: mergedHtml };
}

// ---------------------------------------------------------------------------
// Client-safe event payload (now/yours preview + Restore dry-run).
// ---------------------------------------------------------------------------
async function toClientEvent(event, currentHtml) {
  const recoverable = event.recoverableData || {};
  let currentIsland = null;
  try {
    currentIsland = await extractIsland(currentHtml);
  } catch {
    currentIsland = null;
  }
  const dry = await restoreDataOntoHtml(currentHtml, recoverable);
  const preview = buildPreview(recoverable[RULES_NAME], currentIsland ? currentIsland[RULES_NAME] : null);
  return {
    id: event.id,
    firstDetectedAt: event.firstDetectedAt,
    lastWriteAt: event.lastWriteAt,
    lossSummary: event.lossSummary,
    fieldCount: preview.rows.length,
    preview: preview.rows,
    droppedAdditions: preview.droppedAdditions,
    restorable: !dry.failed,
    canRevert: event.recoverableHtmlBackup != null,
    status: event.status || 'pending',
  };
}

function buildPreview(recoverableData, currentData) {
  const rows = [];
  let droppedAdditions = 0;
  const rd = recoverableData && typeof recoverableData === 'object' ? recoverableData : {};
  const cd = currentData && typeof currentData === 'object' ? currentData : {};

  if (Array.isArray(rd) || Array.isArray(cd)) {
    const yoursN = Array.isArray(rd) ? rd.length : 0;
    const nowN = Array.isArray(cd) ? cd.length : 0;
    if (yoursN !== nowN) {
      rows.push({ key: 'items', now: nowN ? `${nowN} items` : '— empty —', yours: yoursN ? `${yoursN} items` : '— empty —' });
    }
    if (nowN > yoursN) droppedAdditions += nowN - yoursN;
    return { rows, droppedAdditions };
  }

  const keys = new Set([...Object.keys(rd), ...Object.keys(cd)]);
  for (const key of keys) {
    const yours = formatValue(rd[key]);
    const now = formatValue(cd[key]);
    if (yours !== now) rows.push({ key, now, yours });
    if (Array.isArray(rd[key]) && Array.isArray(cd[key]) && cd[key].length > rd[key].length) {
      droppedAdditions += cd[key].length - rd[key].length;
    }
  }
  return { rows, droppedAdditions };
}

function formatValue(v) {
  if (!meaningful(v)) return '— empty —';
  if (typeof v === 'string') return truncate(v.trim());
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
      return `${v.length} item${v.length === 1 ? '' : 's'}`;
    }
    return truncate(v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', '));
  }
  if (typeof v === 'object') return truncate(JSON.stringify(v));
  return String(v);
}
function truncate(s, n = 80) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Page-load read. Seeds the baseline from the current disk island on first
// sight (external-blessed) so an already-open file is covered.
// ---------------------------------------------------------------------------
async function getGuardEvent(baseDir, name, currentHtml) {
  try {
    const guard = await readGuard(baseDir, name);
    if (guard && guard.event) {
      // Re-validate on read: if the current content still contains every pinned
      // recoverable atom, the loss was already undone (restored/reverted elsewhere
      // and synced here) — clear the stale event instead of showing a dead chip.
      const cur = currentHtml != null ? await safeExtractIsland(currentHtml) : { ok: false };
      if (cur.ok && cur.island && lossUndone(classify(guard.event.recoverableData, cur.island))) {
        const resolvedId = guard.event.id;
        await clearEvent(baseDir, name, cur.island, 'restored');
        notifyResolved(name, resolvedId);
        return null;
      }
      return await toClientEvent(guard.event, currentHtml != null ? currentHtml : '');
    }
    if (currentHtml != null) {
      const seed = await safeExtractIsland(currentHtml);
      if (seed.ok && seed.island && !isEmptyIsland(seed.island)) {
        await withLock(`${baseDir}::${name}`, async () => {
          const g = (await readGuard(baseDir, name)) || emptyGuard();
          if (!g.baseline) {
            g.baseline = { data: seed.island, hash: islandHash(seed.island), at: Date.now() };
            g.uiWorkPending = false;
            await writeGuard(baseDir, name, g);
          }
        });
      }
    }
    return null;
  } catch (e) {
    console.error('[data-guard] getGuardEvent failed (non-fatal):', e && e.message ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve (dismiss / revert / restore). writeBack performs the actual save
// through the caller's backup-then-write helper so resolution is versioned.
// ---------------------------------------------------------------------------
async function resolveGuard({ baseDir, name, id, choice, currentHtml, writeBack }) {
  const guard = await readGuard(baseDir, name);
  if (!guard || !guard.event) return { ok: false, statusCode: 404, error: 'No pending data-loss event' };
  if (id && guard.event.id !== id) return { ok: false, statusCode: 409, error: 'Event id mismatch (already resolved?)' };
  const event = guard.event;

  if (choice === 'dismiss') {
    const cur = await safeExtractIsland(currentHtml || '');
    // forceBaseline: Dismiss accepts current even when the clobber emptied the
    // island, else the old baseline stays and the next write re-fires.
    await clearEvent(baseDir, name, cur.ok ? cur.island : null, 'dismissed', true);
    notifyResolved(name, event.id);
    // rider 1: return the control payload so server.js can nudge the platform
    // (and thence the owner's other devices). resolveGuard stays transport-pure.
    return {
      ok: true, choice, status: 'dismissed',
      control: { fileKey: name, recoverableDataHash: islandHash(event.recoverableData) },
    };
  }

  if (choice === 'restore') {
    const merged = await restoreDataOntoHtml(currentHtml || '', event.recoverableData);
    if (merged.failed) return { ok: false, statusCode: 422, error: 'Data could not be restored onto the current page; use Revert.' };
    await writeBack(merged.html);
    const after = await safeExtractIsland(merged.html);
    await clearEvent(baseDir, name, after.ok ? after.island : event.recoverableData, 'restored');
    notifyResolved(name, event.id);
    return { ok: true, choice, status: 'restored' };
  }

  if (choice === 'revert') {
    if (!event.recoverableHtmlBackup) return { ok: false, statusCode: 422, error: 'No whole-file backup is available to revert to.' };
    // Containment guard: the recover path is always under baseDir
    // (.hyperclay/guard or sites-versions); reject anything else in case a
    // tampered/corrupt guard file points the read elsewhere.
    const recoverAbs = path.resolve(event.recoverableHtmlBackup);
    if (!recoverAbs.startsWith(path.resolve(baseDir) + path.sep)) {
      return { ok: false, statusCode: 422, error: 'Recover path is outside the sync folder.' };
    }
    let html;
    try {
      html = await fs.readFile(recoverAbs, 'utf8');
    } catch {
      return { ok: false, statusCode: 422, error: 'Could not read the backup to revert to.' };
    }
    await writeBack(html);
    const after = await safeExtractIsland(html);
    await clearEvent(baseDir, name, after.ok ? after.island : null, 'reverted');
    notifyResolved(name, event.id);
    return { ok: true, choice, status: 'reverted' };
  }

  return { ok: false, statusCode: 400, error: 'Unknown choice' };
}

// The read-modify-write body of a clear, WITHOUT withLock. Shared by clearEvent
// (which wraps it in withLock) and applyRemoteResolution (which already holds the
// lock for the whole check-and-clear). Splitting this out is what avoids the
// non-reentrant withLock re-acquiring itself and hanging (plan §4c).
async function clearEventLocked(baseDir, name, keptIsland, status, forceBaseline = false) {
  const g = (await readGuard(baseDir, name)) || emptyGuard();
  g.event = null;
  g.status = status;
  g.uiWorkPending = false;
  if (forceBaseline) {
    // Dismiss: adopt current as the baseline even when empty (the SCOPE gate
    // keeps it quiet until data returns), so a dismissed wipe stays dismissed.
    g.baseline = keptIsland ? { data: keptIsland, hash: islandHash(keptIsland), at: Date.now() } : null;
  } else if (keptIsland && !isEmptyIsland(keptIsland)) {
    g.baseline = { data: keptIsland, hash: islandHash(keptIsland), at: Date.now() };
  }
  await writeGuard(baseDir, name, g);
}

async function clearEvent(baseDir, name, keptIsland, status, forceBaseline = false) {
  await withLock(`${baseDir}::${name}`, async () => {
    await clearEventLocked(baseDir, name, keptIsland, status, forceBaseline);
  });
}

// ---------------------------------------------------------------------------
// applyRemoteResolution — apply an inbound cross-device Dismiss (control lane,
// rider 1). Clears THIS device's matching event iff the pinned recoverableData
// hash equals the message's; never creates, never clears on mismatch. The whole
// check-and-clear runs under ONE withLock (via clearEventLocked, NOT clearEvent,
// which would re-acquire the same non-reentrant lock and hang). Non-fatal.
// Returns true only if this side actually cleared.
// ---------------------------------------------------------------------------
async function applyRemoteResolution({ baseDir, name, recoverableDataHash }) {
  try {
    // Remote input — this is THE containment guard for the rider: reject '..',
    // absolute, backslash, non-site, or a bad hash before any fs read.
    // (handleControlFrame is a generic transport hop and does NOT pre-validate a
    // rider's fileKey; readGuard/writeGuard also route through resolveGuardPath,
    // which throws on escape — defense in depth.)
    if (typeof name !== 'string' || name.startsWith('/') || name.includes('..') || name.includes('\\')) return false;
    if (!/\.(html|htmlclay)$/.test(name)) return false;
    if (!/^[0-9a-f]{64}$/.test(recoverableDataHash || '')) return false;
    let resolvedId = null;
    await withLock(`${baseDir}::${name}`, async () => {
      const g = await readGuard(baseDir, name);
      if (!g || !g.event) return;                                              // never create
      if (islandHash(g.event.recoverableData) !== recoverableDataHash) return; // keep warning on mismatch
      resolvedId = g.event.id;                                                 // real id for notifyResolved
      let cur = { ok: false, island: null };
      try { cur = await safeExtractIsland(await fs.readFile(path.join(baseDir, name), 'utf8')); } catch {}
      await clearEventLocked(baseDir, name, cur.ok ? cur.island : null, 'dismissed', true); // NO nested withLock
    });
    if (resolvedId) notifyResolved(name, resolvedId);
    return resolvedId != null;
  } catch (e) {
    console.error('[data-guard] applyRemoteResolution failed (non-fatal):', e && e.message ? e.message : e);
    return false;
  }
}

module.exports = {
  extractIsland,
  runDataLossGuard,
  provenanceForLocalSave,
  getGuardEvent,
  resolveGuard,
  applyRemoteResolution,
  restoreDataOntoHtml,
  toClientEvent,
  // test seams
  _readGuard: readGuard,
  _writeGuard: writeGuard,
  _resolveGuardPath: resolveGuardPath,
  _captureRecoverPath: captureRecoverPath,
  _newestVersionPath: newestVersionPath,
};
