// Re-exports the vendored hyper-undo singleton and auto-starts it in edit mode
// so apps "just work". The loader wires it onto clay.undo; the vendor's own
// window auto-export is suppressed by the bootstrap's __hyperclayNoAutoExport
// flag.

import { undo } from '../vendor/hyper-undo.vendor.js'
import { isEditMode, startsAtImport } from '../core/is-edit-mode.js'
import { isTabLocalAttr } from '../lib/root-attrs.js'
import { isDerivedAttr } from '../lib/derived.js'
import { PERSIST } from '../lib/attr-aliases.js'
import { isGestureItem, isRuntimeAttribute } from '../lib/undo/capture-move.js'
import { gateMarkDirty } from '../lib/dirty-gate.js'

// Tab-local attributes (ephemeral state, route-active, root library state) are
// never undone, and neither is what a drag's vendor writes on the item it holds:
// `draggable` and `style` are the gesture's own bookkeeping, and a click that
// writes them is not an edit. The shared mutation hub already drops tab-local
// attributes for the main instance; a scope made with create() runs its own
// observer, so it is told too.
// The page's own maintenance attributes, kept outside history by name (a card number a
// repair rewrites, for example): saved like any attribute, never an edit to undo.
const pageIgnored = new Set()
const withTabLocal = (opts = {}) => {
  const own = opts.ignoreAttribute
  return {
    ...opts,
    ignoreAttribute: (name, target, host) => pageIgnored.has(name) || isTabLocalAttr(name, target) || isDerivedAttr(target, name, host) || isRuntimeAttribute(name, target) || (own ? own(name, target, host) : false),
    isProtected: opts.isProtected || keepsOwnHistory,
    ignoreNode: opts.ignoreNode || isGestureItem,
  }
}

// Saved content that undo does not record (a richclay region, a no-undo block) has a
// history undo cannot restore, so a parent's undo or redo must not erase it. Chrome
// that is never saved (editor-ui) loses nothing and is not protected.
function keepsOwnHistory(node) {
  const policy = window.clay?.region?.resolveRegionPolicy
  if (!policy || node.nodeType !== 1) return false
  const own = policy(node)
  if (own.undoable !== false || own.persist === 'none') return false
  const parent = node.parentElement
  return !parent || policy(parent).undoable !== false
}

const createScope = undo.create.bind(undo)
undo.create = (opts) => createScope(withTabLocal(opts))

// The recording mode is the page's choice, and a session starts a new scope over the
// page as it stands: remember it here, so an exit and a re-entry come back in the mode
// the page picked instead of the default one.
let recording = null
const setRecording = undo.setRecording.bind(undo)
undo.setRecording = (mode) => {
  recording = mode ?? null
  return setRecording(mode)
}

// An authored history action is a user edit, and it writes the DOM while a sync
// frame's apply may hold both the mutation hub and the gate paused: neither feed
// records it then, and the apply would take the write into its saved baseline.
// So every commit, command, undo and redo that changed the document marks the
// page dirty at the gate's own entry point, whose count is what the capture token
// is compared against — an explicit mark advances it even while the gate is paused.
const lastEntryId = () => undo.history.at(-1)?.id ?? null

const command = undo.command.bind(undo)
undo.command = (label, fn) => {
  const receipt = command(label, fn)
  if (receipt) gateMarkDirty()
  return receipt
}

// Undo and redo mark it in afterReplay, which the engine calls on every path that
// replays a step: the facade and the keyboard shortcut bound to the engine itself.

// A commit inside clay.effect drains the paused hub's records, so the effect's
// own writes reach autosave and re-trigger it. Warn once; the commit still runs.
const commit = undo.commit.bind(undo)
let warnedEffectCommit = false
undo.commit = (label, fn) => {
  if (!warnedEffectCommit && window.clay?.effect?.running) {
    warnedEffectCommit = true
    console.warn(`clay.effect: undo.commit("${label}") was called inside an effect. Run commands from event handlers, not from an effect.`)
  }
  const before = lastEntryId()
  const receipt = commit(label, fn)
  if (receipt || lastEntryId() !== before) gateMarkDirty()
  return receipt
}

// Undo and redo restore attributes. A control the user has touched shows its
// live property instead (the WHATWG dirty flag), so copy the attributes back, as
// a sync merge does. Undo is the user's own request, so the focused field is
// restored too, with its selection clamped to the new length. Controls persist
// never writes (password, hidden, file) and regions undo does not record are
// left alone.
const CONTROLS = `input${PERSIST}:not([type="password"]):not([type="hidden"]):not([type="file"]), textarea${PERSIST}, select${PERSIST}`

function restoreControls() {
  const undoable = (el) => window.clay?.region?.resolveRegionPolicy?.(el)?.undoable !== false
  document.querySelectorAll(CONTROLS).forEach((el) => {
    if (!undoable(el)) return
    if (el.tagName === 'SELECT') {
      for (const opt of el.options) {
        const want = opt.hasAttribute('selected')
        if (opt.selected !== want) opt.selected = want
      }
      return
    }
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const want = el.hasAttribute('checked')
      if (el.checked !== want) el.checked = want
      return
    }
    const want = el.tagName === 'TEXTAREA'
      ? (el.getAttribute('data-value') ?? el.textContent)
      : (el.getAttribute('value') ?? '')
    if (el.value === want) return
    const focused = el === document.activeElement
    let start, end
    try { start = el.selectionStart; end = el.selectionEnd } catch {}
    el.value = want
    if (focused && start != null) {
      try { el.setSelectionRange(Math.min(start, want.length), Math.min(end, want.length)) } catch {}
    }
  })
}

// The engine emits its receipt only after a whole replay applied, so a refused
// undo or redo never reaches the control restore.
const afterReplay = (receipt) => {
  if (!receipt?.ok) return
  gateMarkDirty()
  restoreControls()
}

// A refusal is announced for whoever presents it: the engine's receipt, once.
const refuse = ({ entryId, label, direction, code }) => {
  document.dispatchEvent(new CustomEvent('clay:undo-refused', {
    detail: { ok: false, code, entryId, label, direction },
  }))
  keepRefused({ ok: false, code, entryId, label, direction })
}

// A refused step is kept as recovery before a reload can take it away: the refusal is
// announced synchronously above and the copy is made behind it, so a store that will
// not answer can never hold up the receipt. The module is fetched on the first refusal
// or the first app keep; no reader and no boot pays for it, and nothing it writes is a
// save.
let recoveryLoad = null

function loadRecovery() {
  recoveryLoad ??= import('../recovery/undo.js').catch((error) => {
    recoveryLoad = null
    console.error('clayjs: the undo recovery module could not be downloaded; a refused step stays in this tab only', error)
    return null
  })
  return recoveryLoad
}

async function keepRefused(receipt) {
  let written = { ok: false, code: 'unavailable' }
  try {
    const module = await loadRecovery()
    if (module) written = await module.keepRefusal(undo, receipt)
  } catch (_) {
    written = { ok: false, code: 'error' }
  }
  const detail = written?.ok === true
    ? { ok: true, entryId: receipt.entryId, direction: receipt.direction }
    : { ok: false, code: written?.code || 'error', entryId: receipt.entryId, direction: receipt.direction }
  document.dispatchEvent(new CustomEvent('clay:undo-kept', { detail }))
}

// The page's own records on the same channel and in the same store: `keep` stages one,
// `kept` is what a later session can review, and `dismissKept` is the explicit,
// revision-checked way one leaves. All three fetch the recovery module on demand.
const withRecovery = (call, fallback) => (...args) =>
  loadRecovery().then(
    (module) => (module ? module[call](...args) : fallback),
    () => fallback
  )

// An app's kept copy is announced like a refused step's, so the review notice shows it
// in this session instead of only after a reload.
const keepApp = withRecovery('keep', { ok: false, code: 'unavailable' })
undo.ignoreAttribute = (name) => {
  const key = String(name || '')
  if (!key) return () => {}
  pageIgnored.add(key)
  return () => { pageIgnored.delete(key) }
}

undo.keep = async (spec) => {
  const written = await keepApp(spec)
  if (written?.ok === true) {
    document.dispatchEvent(new CustomEvent('clay:undo-kept', { detail: { ok: true, key: spec?.key == null ? null : `app:${spec.key}` } }))
  }
  return written
}
undo.kept = withRecovery('kept', { ok: false, code: 'unavailable', records: [] })
undo.dismissKept = withRecovery('dismissKept', { ok: false, code: 'unavailable' })

// The page's own actions on a kept copy. A provider is asked about every record the
// review panel draws, and each action it returns becomes a button on that row, so a
// template offers Keep as new without the panel knowing what a card is. A provider
// that throws costs its own buttons only, never the row or the copy.
const reviewProviders = new Set()

undo.reviewActions = (fn) => {
  if (typeof fn !== 'function') return () => {}
  reviewProviders.add(fn)
  return () => { reviewProviders.delete(fn) }
}

undo.reviewActionsFor = (record) => {
  const actions = []
  for (const fn of reviewProviders) {
    let offered
    try {
      offered = fn(record)
    } catch (error) {
      console.error('clayjs: a review action could not describe itself; the copy stays reviewable', error)
      continue
    }
    for (const item of Array.isArray(offered) ? offered : []) {
      if (item && typeof item.run === 'function' && item.label) actions.push(item)
    }
  }
  return actions
}

// One event for whatever presents the history (Undo and Redo buttons, a refusal banner):
// after every entry, replay, refusal, dismissal and clear, and when a session starts or
// ends. `undo` and `redo` are the entries the next press would replay, with `refused`
// set on the one that was just refused.
const HISTORY_EVENTS = ['commit', 'undo', 'redo', 'refused', 'discard', 'clear']
const announceChange = () => {
  const live = !!session?.started
  document.dispatchEvent(new CustomEvent('clay:undo-change', {
    detail: {
      canUndo: live && undo.canUndo,
      canRedo: live && undo.canRedo,
      undo: (live && undo.history.at(-1)) || null,
      redo: (live && undo.future?.[0]) || null,
    },
  }))
}

// One edit session owns the page's DOM history. A session starts its own over the page as
// it stands, so nothing an earlier session recorded, and nothing a reader painted while the
// page was in view, is this session's to undo. The durable recovery records belong to the
// recovery service and outlive every session; nothing here reads, clears or rewrites them.
let session = null

function ownership() {
  return { started: false, admitted: false, subscriptions: [] }
}

const isStale = (context) => {
  if (!context) return false
  if (context.signal?.aborted) return true
  return typeof context.isCurrent === 'function' && !context.isCurrent()
}

// The default scope is document.body, so a boot that is still parsing waits for the body
// to exist before the session starts.
function bodyReady() {
  if (typeof document === 'undefined') return Promise.resolve()
  if (document.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
}

// One edit session over the live page. `enable` starts a fresh history and the control
// restore that follows it; `quiesce` closes recording so the exit barrier's writes are not
// entries, keeping the history itself; `resume` is the refused exit; `dispose` detaches
// exactly the subscriptions this session added and takes the history and its keydown
// binding back, so a later entry starts from nothing.
function undoLease(record) {
  return {
    enable() {
      if (record.started) return
      record.started = true
      record.admitted = true
      undo.start(withTabLocal({ bindKeys: true, ...(recording ? { recording } : {}) }))
      for (const type of ['undo', 'redo']) {
        undo.on(type, afterReplay)
        record.subscriptions.push({ type, handler: afterReplay })
      }
      undo.on('refused', refuse)
      record.subscriptions.push({ type: 'refused', handler: refuse })
      for (const type of HISTORY_EVENTS) {
        undo.on(type, announceChange)
        record.subscriptions.push({ type, handler: announceChange })
      }
      announceChange()
    },
    quiesce() {
      if (!record.admitted) return
      record.admitted = false
      undo.pause()
    },
    resume() {
      if (record.admitted) return
      record.admitted = true
      undo.resume()
    },
    dispose() {
      record.admitted = false
      if (session === record) session = null
      if (!record.started) return
      record.started = false
      for (const { type, handler } of record.subscriptions.splice(0)) undo.off(type, handler)
      undo.stop()
      announceChange()
    },
  }
}

/**
 * Undo as a mode participant: the history the commit that enters edit starts, and the one
 * the exit takes back.
 *
 * `prepare` waits for the body the default scope needs, and answers with the session's
 * lease; that wait can outlive the session that asked for it, so the generation is asked
 * again once the body exists. `enable` starts the history. `quiesce` stops recording
 * without losing what the session already holds. `dispose` hands back the subscriptions,
 * the history and the keydown binding.
 */
export function undoParticipant() {
  return {
    id: 'clay:undo',
    order: 350,
    async prepare(context = {}) {
      if (context.initial === true) return adopt()
      await bodyReady()
      if (isStale(context)) {
        throw Object.assign(new Error('clay:undo prepared for a stale generation'), { code: 'stale-document' })
      }
      return undoLease(session || (session = ownership()))
    },
  }
}

// The boot this tab already made, adopted instead of prepared: it is the history `init`
// below started, or, on a boot that started none, nothing to hand back.
async function adopt() {
  const lease = await ready
  return { enable() {}, quiesce: () => lease?.quiesce(), resume: () => lease?.resume(), dispose: () => lease?.dispose() }
}

// Auto-init when the module is imported; the loader awaits `ready` before resolving clay.ready
async function init() {
  if (!startsAtImport()) return null
  if (typeof document === 'undefined') return null
  const lease = await undoParticipant().prepare()
  lease.enable()
  return lease
}

const ready = init()

export { undo, restoreControls, init, ready }
export { undoParticipant as modeParticipant }
export default undo
