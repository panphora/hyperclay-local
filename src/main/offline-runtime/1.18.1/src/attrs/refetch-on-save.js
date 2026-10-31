import Mutation from '../lib/mutation.js';
import { urlAttrFor, writeRuntimeUrl, markSuperseded, isSuperseded } from '../lib/authored-url.js';

/** Remove an element without letting the removal read as a user edit. */
function removeQuietly(el) {
  if (!el.parentNode) return;
  Mutation.pause();
  try {
    el.remove();
  } finally {
    Mutation.resume();
  }
}

function swapElement(el) {
  const attr = urlAttrFor(el);
  if (!attr) return;

  // A second save landing inside the two-second overlap would otherwise swap the
  // element that is already on its way out, and clone the clone.
  if (isSuperseded(el)) return;

  const url = new URL(el.getAttribute(attr), location.href);
  url.searchParams.set('v', Date.now());
  const isSameOrigin = url.origin === location.origin;
  const runtimeValue = isSameOrigin ? url.pathname + url.search : url.href;

  Mutation.pause();
  try {
    const newEl = document.createElement(el.tagName);
    for (const { name, value } of el.attributes) {
      newEl.setAttribute(name, value);
    }
    // Record-if-absent carries over any authored URL the copied attributes
    // already held, so cacheBust and refetch on one element keep the original.
    writeRuntimeUrl(newEl, attr, runtimeValue);

    markSuperseded(el);
    el.insertAdjacentElement('afterend', newEl);

    newEl.onload = () => removeQuietly(el);
    setTimeout(() => removeQuietly(el), 2000);
  } finally {
    Mutation.resume();
  }
}

function init() {
  document.addEventListener('clay:save-saved', () => {
    document.querySelectorAll('[refetch-on-save]').forEach(swapElement);
  });
}

init();

export default init;
