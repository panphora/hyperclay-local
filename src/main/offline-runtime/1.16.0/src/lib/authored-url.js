/**
 * authored-url.js — keeping a runtime URL rewrite out of the saved file.
 *
 * cacheBust and refetch-on-save both rewrite an href/src after a save, so the
 * browser re-fetches the asset. That write lands AFTER the save baseline was
 * taken, so without help it reads as an edit the person made: the page goes
 * dirty the instant a save succeeds, warns on close about work that was already
 * written, and on an autosave page saves again immediately.
 *
 * The old answer stamped the element `no-trigger-autosave` on the way past. It
 * worked only from the SECOND save on — the baseline already held the element
 * unmarked, so the first comparison stripped something the baseline contained
 * and the page read dirty anyway. It also spent a region marker, which changes
 * how undo, autosave and live-sync treat that subtree forever, to paper over a
 * serialization problem.
 *
 * This fixes the bytes instead. Remember what the URL was authored as, restore
 * it on every snapshot clone, and leave the region model alone. The live DOM
 * keeps the busted URL, the file keeps the authored one, and no comparison ever
 * sees a difference.
 */

const AUTHORED = 'clay-authored-url';
const RUNTIME = 'clay-runtime-url';
const ATTR = 'clay-url-attr';
const SUPERSEDED = 'clay-superseded';

// Every attribute this module owns. They live on the live element and are
// stripped from every clone, so none of them ever reaches the file.
const OWNED = [AUTHORED, RUNTIME, ATTR, SUPERSEDED];

/** Which attribute carries this element's URL, matching both call sites' rule. */
export function urlAttrFor(el) {
  return el.hasAttribute('href') ? 'href' : el.hasAttribute('src') ? 'src' : null;
}

/**
 * Write a clay-generated URL to the live DOM, remembering the authored one.
 *
 * Record-if-absent is the important part. A second cache-bust must not record
 * the first bust's output as the authored value, or the file accumulates `?v=`
 * stamps and the restore puts back a stale URL. It also makes the two helpers
 * compose: when refetch clones an element cacheBust already touched, the clone
 * carries the original authored value and keeps it.
 */
export function writeRuntimeUrl(el, attr, value) {
  if (!el.hasAttribute(AUTHORED)) {
    el.setAttribute(AUTHORED, el.getAttribute(attr) ?? '');
    el.setAttribute(ATTR, attr);
  }
  el.setAttribute(attr, value);
  el.setAttribute(RUNTIME, value);
}

/**
 * Mark an element that a replacement has been inserted next to.
 *
 * refetch-on-save leaves the old element in the DOM until the new one loads, so
 * for up to two seconds the page holds both. Every snapshot taken in that window
 * must serialize exactly one, or a capture differs from the baseline by a whole
 * duplicated element.
 */
export function markSuperseded(el) {
  el.setAttribute(SUPERSEDED, '');
}

export function isSuperseded(el) {
  return el.hasAttribute(SUPERSEDED);
}

/**
 * Restore authored URLs on a snapshot clone and drop every attribute this
 * module owns. Runs inside captureSnapshot, so it reaches the save clone, both
 * comparison clones, and the live-sync broadcast alike.
 */
export function restoreAuthoredUrls(clone) {
  for (const el of clone.querySelectorAll(`[${SUPERSEDED}]`)) {
    el.remove();
  }

  for (const el of clone.querySelectorAll(`[${AUTHORED}]`)) {
    const attr = el.getAttribute(ATTR);
    const authored = el.getAttribute(AUTHORED);
    const runtime = el.getAttribute(RUNTIME);

    // Restore only while the live value is still the one clay wrote. If the page
    // has changed it since, that is a real authored edit: restoring would
    // discard it silently, and keep discarding it on every save afterwards.
    if (attr && el.getAttribute(attr) === runtime) {
      if (authored) el.setAttribute(attr, authored);
      else el.removeAttribute(attr);
    }

    for (const name of OWNED) el.removeAttribute(name);
  }
}
