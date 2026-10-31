// Puts a generated vendor skin (src/ui/skins/*.js) on the page.
//
// A skin is one `@layer clay-skin { ... }` block whose declarations are all
// !important. Important declarations in the earliest cascade layer beat the host
// page's unlayered !important rules and every later layer, and a layer's position is
// fixed where its name first appears, so the skin goes in ahead of every other
// stylesheet in <head>. It is runtime-only: never saved, never watched, never sent to
// a peer, and a second call for the same name reuses the element.
import { RUNTIME_ONLY, pageScheme } from './bevel-controls.js';

const isSkin = (node) => node.nodeType === 1 && node.hasAttribute('data-clay-skin');

function firstNonSkin(head) {
  for (const node of head.childNodes) if (!isSkin(node)) return node;
  return null;
}

function placed(head, el) {
  if (el.parentNode !== head) return false;
  for (let node = el.previousSibling; node; node = node.previousSibling) if (!isSkin(node)) return false;
  return true;
}

const installed = new Map();

// A vendor that sets no color-scheme of its own inherits the page's, and a page that
// declares none computes `normal`, which resolves every light-dark() pin to light.
// ClayJS's own surfaces follow the reader's preference there (pageScheme), so a skin
// installed with its roots gives them the same scheme.
function schemeRule(roots) {
  return `\n@layer clay-skin{:is(${roots.join(', ')}){color-scheme:${pageScheme()} !important}}`;
}

/**
 * Install or refresh one skin.
 * @param {string} name  one element per name
 * @param {string} css   the skin module's CSS export
 * @param {{ roots?: string[] }} [options]  roots to give the page's scheme
 * @returns {HTMLStyleElement}
 */
export function installSkin(name, css, { roots } = {}) {
  installed.set(name, { css, roots });
  const head = document.head || document.documentElement;
  let el = null;
  for (const node of head.querySelectorAll('style[data-clay-skin]')) {
    if (node.getAttribute('data-clay-skin') === name) el = node;
  }
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('clay', RUNTIME_ONLY);
    el.setAttribute('data-clay-skin', name);
  }
  const text = roots ? css + schemeRule(roots) : css;
  if (el.textContent !== text) el.textContent = text;
  if (!placed(head, el)) head.insertBefore(el, firstNonSkin(head));
  return el;
}

// A live-sync merge can put a peer's stylesheet ahead of a skin, and a page can change
// its scheme; after every applied frame each skin goes back in front, re-read.
if (typeof document !== 'undefined') {
  document.addEventListener('clay:sync-applied', () => {
    for (const [name, { css, roots }] of installed) installSkin(name, css, { roots });
  });
}
