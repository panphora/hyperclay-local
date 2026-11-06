// One drag or one `clay.sortable.move` as one semantic undo entry.
//
// The engine records primitives, not gestures. A move is the item leaving its source
// slot and arriving in the destination slot, so the entry is that remove and that add
// recorded inside `undo.command`; the engine pairs them into its own `move` step,
// checked against the item's identity and both sequences, so undo puts the card back
// without replaying the drag and redo moves it again.
//
// A gesture also writes while it happens. Sortable marks the item it picks up
// draggable and leaves style="" behind, and those writes are runtime, not authored
// content: they are ignored while the gesture is open (isRuntimeAttribute), and the
// writes the end of the gesture makes are held out of the automatic idle batch
// (holdMove/releaseMove) so a drag cannot also become a generic `Edit` entry.

const RUNTIME_ATTRS = new Set(['draggable', 'style'])

// The presses whose gesture may still be writing. Bounded: a press joins on pointerdown
// and leaves on its end, its cancel, or the session's dispose.
const open = new Set()

const engine = () => window.clay?.undo

const sameNodes = (a, b) => a.length === b.length && a.every((node, i) => node === b[i])

// The label a person reads in the history. A container names its own moves; a list
// that does not is simply "Move".
function moveLabel(result) {
  const named = result.from?.getAttribute?.('sortable-label') || result.to?.getAttribute?.('sortable-label')
  return named || 'Move'
}

// The press: what a drag started with, before the vendor touched anything.
export function beginMove(item) {
  const from = item?.parentElement
  if (!item || !from) return null
  const start = {
    item,
    from,
    children: [...from.children],
    next: item.nextSibling,
    previous: item.previousSibling,
    nodes: new Set([item, ...item.querySelectorAll('*')]),
    held: false,
  }
  open.add(start)
  return start
}

// A runtime attribute of the item a gesture holds: the vendor's own bookkeeping, which
// a mere click would otherwise write into the file and into history.
export function isRuntimeAttribute(name, target) {
  if (!RUNTIME_ATTRS.has(name)) return false
  for (const start of open) if (start.nodes.has(target)) return true
  return false
}

// The item a gesture holds: the vendor moves it many times during dragover or
// touchmove, and none of those moves is an edit; the one semantic move is recorded
// at the end.
export function isGestureItem(node) {
  for (const start of open) if (start.item === node) return true
  return false
}

// The engine's own exclusion bracket, opened before the gesture's final writes and
// closed right after its one entry: those writes reach neither the idle batch nor a
// command's capture. Reference-counted by the engine, so a release that arrives twice
// is harmless.
export function holdMove(start) {
  const undo = engine()
  if (!start || start.held || !undo?.pause) return false
  undo.pause()
  start.held = true
  return true
}

export function releaseMove(start) {
  if (!start) return
  open.delete(start)
  if (!start.held) return
  start.held = false
  engine()?.resume?.()
}

export function releaseAllMoves() {
  for (const start of [...open]) releaseMove(start)
}

// Something outside this gesture changed the source list, or took the item away. The
// start coordinates describe a list that is no longer there, so nothing is recorded:
// the card stays where the merged document put it, undo does not claim it, and the
// page is told why.
function drifted(start, result) {
  if (!start.item.isConnected || start.item.parentElement !== result.to) return true
  const before = start.children.filter((node) => node !== start.item)
  const after = [...start.from.children].filter((node) => node !== start.item)
  return !sameNodes(before, after)
}

// The drop left the card in the slot it started in: not a move, not an event, not an
// entry.
function sameSlot(start, result) {
  if (result.from !== result.to) return false
  const now = [...result.to.children]
  return sameNodes(now, start.children)
}

function removal(start) {
  const member = (node) => node && node.parentNode === start.from
  const next = member(start.next) ? start.next : null
  return {
    kind: 'remove',
    parent: start.from,
    nodes: [start.item],
    before: next,
    afterAuthored: next,
    beforeAuthored: member(start.previous) ? start.previous : null,
  }
}

function addition(result) {
  return {
    kind: 'add',
    parent: result.to,
    nodes: [result.item],
    before: result.item.nextSibling,
    afterAuthored: result.item.nextSibling,
    beforeAuthored: result.item.previousSibling,
  }
}

// Record one completed move from the start slot to the final slot. The runtime
// attributes are already restored by the time this runs, so no vendor write can reach
// the entry. Returns the engine's receipt, or null when this move earns no entry.
export function recordMove(start, result) {
  if (!start || !result || result.item !== start.item) return null
  const label = moveLabel(result)
  if (drifted(start, result)) {
    document.dispatchEvent(new CustomEvent('clay:undo-unavailable', {
      detail: { label, code: 'conflicted' },
    }))
    return null
  }
  if (sameSlot(start, result)) return null
  const undo = engine()
  if (!undo?.command || !undo?.record) return null
  holdMove(start)
  return undo.command(label, () => {
    undo.record(removal(start))
    undo.record(addition(result))
  })
}
