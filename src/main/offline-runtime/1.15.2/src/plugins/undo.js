// Re-exports the vendored hyper-undo singleton and auto-starts it in edit mode
// so apps "just work". The loader wires it onto clay.undo; the vendor's own
// window auto-export is suppressed by the bootstrap's __hyperclayNoAutoExport
// flag.

import { undo } from '../vendor/hyper-undo.vendor.js'
import { isEditMode } from '../core/is-edit-mode.js'
import { isTabLocalAttr } from '../lib/root-attrs.js'
import { isDerivedAttr } from '../lib/derived.js'
import { PERSIST } from '../lib/attr-aliases.js'

// Tab-local attributes (ephemeral state, route-active, root library state) are
// never undone. The shared mutation hub already drops them for the main
// instance; a scope made with create() runs its own observer, so it is told too.
const withTabLocal = (opts = {}) => {
  const own = opts.ignoreAttribute
  return {
    ...opts,
    ignoreAttribute: (name, target) => isTabLocalAttr(name, target) || isDerivedAttr(target, name) || (own ? own(name, target) : false),
  }
}

const createScope = undo.create.bind(undo)
undo.create = (opts) => createScope(withTabLocal(opts))

// A commit inside clay.effect drains the paused hub's records, so the effect's
// own writes reach autosave and re-trigger it. Warn once; the commit still runs.
const commit = undo.commit.bind(undo)
let warnedEffectCommit = false
undo.commit = (label, fn) => {
  if (!warnedEffectCommit && window.clay?.effect?.running) {
    warnedEffectCommit = true
    console.warn(`clay.effect: undo.commit("${label}") was called inside an effect. Run commands from event handlers, not from an effect.`)
  }
  return commit(label, fn)
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

function init() {
  if (!isEditMode) return
  // Defer until the body exists so the default scope (document.body) is valid.
  if (typeof document === 'undefined') return
  const start = () => {
    undo.start(withTabLocal({ bindKeys: true }))
    undo.on('undo', restoreControls)
    undo.on('redo', restoreControls)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
}

init()

export { undo, restoreControls }
export default undo
