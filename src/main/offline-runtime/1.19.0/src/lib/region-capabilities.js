export const CAPABILITIES = Object.freeze({
  data: Object.freeze({ tokens: ['no-data'], bundles: ['editor-ui'] }),
  save: Object.freeze({ tokens: ['no-save'], bundles: ['editor-ui'] }),
  snapshot: Object.freeze({ tokens: ['no-snapshot'], bundles: ['editor-ui'] }),
  watch: Object.freeze({ tokens: ['no-watch'], bundles: ['editor-ui'] }),
  undo: Object.freeze({ tokens: ['no-undo'], bundles: ['editor-ui'] }),
  history: Object.freeze({ tokens: [], bundles: ['editor-ui'] }),
})

export const BUNDLES = Object.freeze({
  'editor-ui': Object.freeze(['no-data', 'no-save', 'no-snapshot', 'no-watch', 'no-undo']),
})

export const POLICY_TOKENS = Object.freeze([
  'no-save',
  'no-snapshot',
  'no-trigger-autosave',
  'no-dirty',
  'no-watch',
  'no-undo',
  'no-data',
  'freeze',
  'editor-ui',
  'live',
])

export function hasPolicyToken(element, token) {
  if (!element || element.nodeType !== 1) return false
  const clay = element.getAttribute?.('clay')
  return !!(
    (clay && clay.split(/\s+/).includes(token)) ||
    element.hasAttribute?.(token)
  )
}

export function expandsTo(element, token) {
  if (hasPolicyToken(element, token)) return true
  for (const [bundle, members] of Object.entries(BUNDLES)) {
    if (members.includes(token) && hasPolicyToken(element, bundle)) return true
  }
  return false
}

export function capabilitySelector(capability) {
  const definition = CAPABILITIES[capability]
  if (!definition) throw new Error(`Unknown region capability: ${capability}`)
  return [...definition.tokens, ...definition.bundles]
    .flatMap(token => [`[clay~="${token}"]`, `[${token}]`])
    .join(', ')
}

export function closestWithCapability(node, capability) {
  let element = node && node.nodeType === 1 ? node : node?.parentElement
  while (element && element.nodeType === 1) {
    const definition = CAPABILITIES[capability]
    if (!definition) throw new Error(`Unknown region capability: ${capability}`)
    if (definition.tokens.some(token => expandsTo(element, token)) ||
        definition.bundles.some(bundle => hasPolicyToken(element, bundle))) return element
    element = element.parentElement
  }
  return null
}

export function hasCapability(node, capability) {
  return !!closestWithCapability(node, capability)
}

export function isPolicyAttribute(name) {
  return name === 'clay' || POLICY_TOKENS.includes(name)
}
