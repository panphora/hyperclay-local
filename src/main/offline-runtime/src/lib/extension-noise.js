/**
 * extension-noise.js — browser-extension DOM noise the page should never own.
 *
 * Extensions touch the live page in two distinct ways, handled differently so a
 * save never loses real content:
 *   1. Standalone elements they own (password-manager menus, Grammarly overlays,
 *      translate banners, extension iframes/scripts) — remove them entirely.
 *   2. Marker attributes they stamp onto YOUR real inputs/forms — strip just the
 *      attribute and keep the element.
 *
 * The selectors are not stable public APIs; extend both lists from real captures.
 * Keep this file byte-identical to the copy in the other package (hyperclayjs and
 * hyper-undo each carry one) — their save/undo observers must agree, or one will
 * record/save what the other ignores.
 */

// Standalone elements browser extensions inject into the page — remove them entirely.
export const EXTENSION_NODE_SELECTORS = [
  '[src^="chrome-extension://"]', '[href^="chrome-extension://"]',
  '[src^="moz-extension://"]', '[href^="moz-extension://"]',
  '[src^="safari-web-extension://"]', '[href^="safari-web-extension://"]',
  '[id="1p-menu-live-region"]',
  'com-1password-button', 'com-1password-menu', 'com-1password-notification',
  'grammarly-extension', 'grammarly-desktop-integration',
  'lt-div', 'lt-card', 'lt-toolbar', 'lt-highlighter',
  '[data-lastpass-root]', '[data-lastpass-icon-root]', '[data-dashlane-shadowhost]',
  '[data-klarna-extension]', '[class*="klarna-extension"]',
  '.skiptranslate', '#goog-gt-tt', '.goog-te-banner-frame', '.goog-te-balloon-frame',
  'style.darkreader', 'style[data-darkreader-mode]', 'style[data-darkreader-scheme]',
  '#loom-companion-mv3', 'loom-container',
  '[ext-id]',
]

// Attribute-name prefixes extensions stamp onto YOUR real elements — strip the attribute, keep the element.
export const EXTENSION_ATTR_PREFIXES = [
  'data-grammarly', 'data-lt', 'data-1p', 'data-com-onepassword', 'data-lastpass', 'data-lp', 'data-kwimpala',
  'data-bitwarden', 'data-bw', 'data-dashlane', 'data-np', 'data-protonpass', 'data-proton-pass',
  'data-keeper', 'data-rf', 'data-roboform', 'data-honey', 'data-rakuten', 'data-capital-one',
  'data-wikibuy', 'data-klarna', 'data-darkreader', 'data-evernote', 'data-pocket', 'data-pin',
]

// Pre-joined once so hot paths call matches()/closest()/querySelectorAll() without re-joining.
export const EXTENSION_NODE_SELECTOR = EXTENSION_NODE_SELECTORS.join(',')

// One compiled test for "is this an extension marker attribute". The (?:-|$) boundary means a
// prefix like `data-lt` matches `data-lt` / `data-lt-foo` but never an app attribute like `data-ltr`.
export const EXTENSION_ATTR_PATTERN = new RegExp('^(?:' + EXTENSION_ATTR_PREFIXES.join('|') + ')(?:-|$)')

// Remove extension-injected elements and strip extension marker attributes from a (cloned) subtree, in place.
// Guarded so a malformed denylist entry degrades to "noise not stripped" rather than breaking the save.
export function stripExtensionNoise(root) {
  if (!root || !root.querySelectorAll) return
  try {
    for (const el of root.querySelectorAll(EXTENSION_NODE_SELECTOR)) el.remove()
    // querySelectorAll('*') never returns the root itself, so an extension stamp on
    // <html> used to ride into every saved file. The root is the one element an
    // extension can mark on a page with no other match.
    // The attribute list is only copied when a marker is found on it.
    const strip = (el) => {
      const attrs = el.attributes
      if (!attrs) return
      let found = null
      for (let i = 0; i < attrs.length; i++) {
        const name = attrs[i].name
        if (EXTENSION_ATTR_PATTERN.test(name.toLowerCase())) (found || (found = [])).push(name)
      }
      if (found) for (const name of found) el.removeAttribute(name)
    }
    strip(root)
    for (const el of root.querySelectorAll('*')) strip(el)
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[clay] stripExtensionNoise skipped:', e)
  }
}
