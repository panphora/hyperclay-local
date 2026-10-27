// cacheBust.js
// Cache-bust an element's href or src attribute by adding/updating a version query param

import Mutation from './mutation.js';
import { urlAttrFor, writeRuntimeUrl } from './authored-url.js';

function cacheBust(el) {
  const attr = urlAttrFor(el);
  if (!attr) return;

  const url = new URL(el.getAttribute(attr), location.href);
  url.searchParams.set('v', Date.now());

  // Paused because this is clay writing, not the person editing: it must not
  // schedule an autosave. Keeping it out of the SAVED FILE is a separate job,
  // done by remembering the authored URL and restoring it on every snapshot
  // clone (see authored-url.js) rather than by marking the region.
  Mutation.pause();
  try {
    writeRuntimeUrl(el, attr, url.href);
  } finally {
    Mutation.resume();
  }
}

export default cacheBust;
