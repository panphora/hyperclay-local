import { capabilitySelector, hasCapability, CAPABILITIES, expandsTo, hasPolicyToken } from './region-capabilities.js'

const UNSUPPORTED_SELECTOR = /:(?:focus(?:-within|-visible)?|hover|active|visited|defined)\b/i

function copyControlState(source, copy) {
  if (!/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(source.tagName || '')) return
  const type = (source.getAttribute?.('type') || '').toLowerCase()
  if ('value' in source && 'value' in copy && source.tagName !== 'OPTION' && type !== 'checkbox' && type !== 'radio' && type !== 'file') copy.value = source.value
  if (source.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) copy.checked = source.checked
  // Each surviving option carries its own selection, so a <select> whose excluded
  // options were removed from the copy keeps the rest in step with the page.
  if (source.tagName === 'OPTION') copy.selected = source.selected
  if ('indeterminate' in source && 'indeterminate' in copy) copy.indeterminate = source.indeterminate
}

function matchesWithin(node, selector, boundary, inherit) {
  if (inherit) return !!node.closest?.(selector)
  let current = node
  while (current?.nodeType === 1) {
    if (current.matches(selector)) return true
    if (current === boundary) break
    current = current.parentElement
  }
  return false
}

// One native deep clone, then a lockstep walk of the two isomorphic trees that
// records provenance, collects controls, and marks excluded subtrees for removal.
// The browser's clone is far cheaper than importing node by node. The root answers
// for its ancestors once; below it the walk is top-down, so with inheritance each
// element answers only for its own markers: an excluded ancestor is never entered.
function excluded(source, capability, capabilityMatch, exclude, boundary, inherit) {
  return (inherit
    ? hasCapability(source, capability)
    : matchesWithin(source, capabilityMatch, boundary, false)) ||
    !!(exclude && (inherit && source !== boundary ? source.matches(exclude) : matchesWithin(source, exclude, boundary, inherit)))
}

// The test closestWithCapability makes at each level, for this element alone.
function hasOwnCapability(element, capability) {
  const definition = CAPABILITIES[capability]
  return definition.tokens.some(token => expandsTo(element, token)) ||
    definition.bundles.some(bundle => hasPolicyToken(element, bundle))
}

const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'])

function pairTree(source, copy, maps, drop) {
  if (source.nodeType === 1 && drop(source)) { maps.dropped.push(copy); return }
  maps.cloneToLive.set(copy, source)
  maps.liveToClone.set(source, copy)
  let sourceChildren = source
  let copyChildren = copy
  if (source.nodeType === 1) {
    if (CONTROL_TAGS.has(source.tagName)) maps.controls.push(source, copy)
    if (source.tagName === 'TEMPLATE') {
      // The deep clone also copied the template's own child nodes, which are not its
      // content and were never part of the view.
      while (copy.firstChild) copy.removeChild(copy.firstChild)
      sourceChildren = source.content
      copyChildren = copy.content
      maps.cloneToLive.set(copyChildren, sourceChildren)
      maps.liveToClone.set(sourceChildren, copyChildren)
    }
  } else if (source.nodeType !== 11) return
  let c = copyChildren.firstChild
  for (let s = sourceChildren.firstChild; s && c; s = s.nextSibling) {
    pairTree(s, c, maps, drop)
    c = c.nextSibling
  }
}

export function createContentView(context, { capability = 'data', exclude = null, inherit = true, provenance = null } = {}) {
  if (!context) throw new TypeError('createContentView requires a DOM context')
  const sourceDocument = context.nodeType === 9 ? context : context.ownerDocument
  if (!sourceDocument?.implementation?.createHTMLDocument) {
    throw new TypeError('createContentView requires an HTML DOM implementation')
  }
  const inertDocument = sourceDocument.implementation.createHTMLDocument('')
  const cloneToLive = provenance || new WeakMap()
  const liveToClone = new WeakMap()
  const sourceRoot = context.nodeType === 9 ? context.documentElement : context
  if (exclude) inertDocument.documentElement.matches(exclude)
  const capabilityMatch = capabilitySelector(capability)
  const drop = inherit
    ? (el) => hasOwnCapability(el, capability) || !!(exclude && el.matches(exclude))
    : (el) => excluded(el, capability, capabilityMatch, exclude, sourceRoot, false)
  let root = null
  if (sourceRoot.nodeType !== 1 || !excluded(sourceRoot, capability, capabilityMatch, exclude, sourceRoot, inherit)) {
    root = inertDocument.importNode(sourceRoot, true)
    const maps = { cloneToLive, liveToClone, dropped: [], controls: [] }
    pairTree(sourceRoot, root, maps, drop)
    for (const node of maps.dropped) node.remove()
    // Control state is copied once the copy holds only what the view keeps, so a
    // <select> sees exactly the options the old node-by-node import gave it.
    for (let i = 0; i < maps.controls.length; i += 2) copyControlState(maps.controls[i], maps.controls[i + 1])
  }
  if (context.nodeType === 9 && root) {
    inertDocument.replaceChild(root, inertDocument.documentElement)
    liveToClone.set(context, inertDocument)
    cloneToLive.set(inertDocument, context)
  }

  const assertSelector = selector => {
    if (UNSUPPORTED_SELECTOR.test(selector)) {
      throw new Error(`Filtered content queries do not support stateful selector: ${selector}`)
    }
  }

  return {
    root,
    document: inertDocument,
    capability,
    selector: capabilitySelector(capability),
    cloneToLive,
    liveToClone,
    original(node) { return cloneToLive.get(node) || null },
    cloneOf(node) { return liveToClone.get(node) || null },
    query(selector, queryRoot = root) {
      assertSelector(selector)
      return Array.from(queryRoot.querySelectorAll(selector), node => cloneToLive.get(node) || node)
    },
    text(node = root) {
      const projected = node === root ? root : liveToClone.get(node)
      return projected?.textContent || ''
    },
    html(node = root) {
      const projected = node === root ? root : liveToClone.get(node)
      return projected?.innerHTML ?? ''
    },
    clone(node = root) {
      const projected = node === root ? root : liveToClone.get(node)
      return projected ? inertDocument.importNode(projected, true) : null
    },
  }
}

export function cleanContentClone(node, options) {
  return createContentView(node, options).root
}
