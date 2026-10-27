/*
   [onmutation] - Trigger code when this element or its children change

   Usage:
   <div onmutation="console.log('My content changed')">
     <span contenteditable>Edit me</span>
   </div>

   Unlike [onglobalmutation]/[onpagemutation] which fires on ANY DOM change,
   [onmutation] only fires when the element itself or its descendants mutate.
*/
import Mutation from "../lib/mutation.js";

async function executeMutation(element) {
  try {
    const code = element.getAttribute('onmutation');
    if (!code) return;
    const asyncFn = new Function(`return (async function() { ${code} })`)();
    await asyncFn.call(element);
  } catch (error) {
    console.error('Error in onmutation execution:', error);
  }
}

function init() {
  // Source from the single shared observer instead of one MutationObserver per
  // [onmutation] element. For each change, fire every [onmutation] element whose
  // subtree it belongs to: walk up from the element whose subtree actually
  // changed — the still-attached parent for add/remove (the removed node is
  // detached), otherwise the changed element itself — and run any [onmutation]
  // ancestor, exactly as a per-element subtree observer would. An element's own
  // insertion is its parent's childList change, so (correctly) doesn't fire it.
  //
  // require:'observed' makes it region-aware (skips no-watch / extension noise),
  // which the old per-element observers were not. It stays PAUSABLE (the
  // default): a live-sync morph must NOT fire the hook, or the hook's own DOM
  // writes would autosave → broadcast → morph the other tab → fire the same hook
  // → broadcast back, looping forever. Skipping morphs is safe because the other
  // tab already ran this identical hook, so the morph carries the result.
  Mutation.onAnyChange({ require: 'observed' }, (changes) => {
    const toFire = new Set();
    for (const change of changes) {
      let el = (change.type === 'add' || change.type === 'remove') ? change.parent : change.element;
      while (el && el.nodeType === 1) {
        if (el.hasAttribute('onmutation')) toFire.add(el);
        el = el.parentElement;
      }
    }
    toFire.forEach(executeMutation);
  });
}

export { init };
export default init;
