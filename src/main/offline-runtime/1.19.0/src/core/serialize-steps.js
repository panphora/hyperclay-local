/**
 * serialize-steps.js — the save's serializations as generators, for a document big enough
 * to prepare its save across tasks.
 *
 * Each one returns exactly the string its one-call twin in snapshot.js returns, built child
 * by child so it can yield between pieces. They live apart from snapshot.js because every
 * page loads that at boot, and only the sliced save (core/save-job.js, a lazy chunk) and a
 * sliced save's live-sync relay ever run these.
 */

import {
  clonePreventingOnclone,
  noscriptBlocks,
  prepareForCompare,
  swapNoscriptMarkers
} from './snapshot.js';
import { TAB_LOCAL_ROOT_ATTRS } from '../lib/root-attrs.js';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// How much serialized output a sliced save writes before it hands the page back, and how
// big a subtree has to be before it is serialized child by child instead of in one call.
const SLICE_BYTES = 64 * 1024;
const SLICE_MIN_ELEMENTS = 256;

function sliceable(el) {
  return el.namespaceURI === XHTML_NS
    && el.localName !== 'template'
    && el.getElementsByTagName('*').length >= SLICE_MIN_ELEMENTS;
}

/**
 * The children of `el`, each one step, `yield`ing every `SLICE_BYTES` of output. A text
 * or comment child is serialized inside `bare`, a childless copy of its parent, so its
 * escaping follows the same parent element the one-call serializer would use.
 */
function* serializeChildrenSteps(el, bare, out, budget) {
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && sliceable(child)) {
      yield* serializeElementSteps(child, out, budget);
      continue;
    }
    let piece;
    if (child.nodeType === 1) piece = child.outerHTML;
    else {
      bare.replaceChildren(child.cloneNode(false));
      piece = bare.innerHTML;
    }
    out.push(piece);
    budget.bytes += piece.length;
    if (budget.bytes >= SLICE_BYTES) {
      budget.bytes = 0;
      yield;
    }
  }
}

/**
 * `el.outerHTML`, built from its open tag, each child's own serialization and its end
 * tag, `yield`ing every `SLICE_BYTES` of output.
 */
function* serializeElementSteps(el, out, budget) {
  const bare = clonePreventingOnclone(el, false);
  const shell = bare.outerHTML;
  const endTag = `</${bare.localName}>`;
  out.push(shell.slice(0, shell.length - endTag.length));
  yield* serializeChildrenSteps(el, bare, out, budget);
  out.push(endTag);
}

/** `"<!DOCTYPE html>" + root.outerHTML`, in steps. */
export function* serializeTreeSteps(root) {
  const out = ["<!DOCTYPE html>"];
  yield* serializeElementSteps(root, out, { bytes: 0 });
  return out.join('');
}

/** `serializeClone`, in steps: the same bytes, `yield`ing every `SLICE_BYTES` of output. */
export function* serializeCloneSteps(clone) {
  const blocks = noscriptBlocks(clone);
  if (!blocks.length) return yield* serializeTreeSteps(clone);
  const raw = swapNoscriptMarkers(blocks);
  let html;
  try {
    html = yield* serializeTreeSteps(clone);
  } finally {
    for (const [el, kids] of blocks) el.replaceChildren(...kids);
  }
  for (const [marker, text] of raw) html = html.split(marker).join(text);
  return html;
}

/** `serializeForCompare`, in steps. */
export function* serializeForCompareSteps(clone) {
  prepareForCompare(clone);
  return yield* serializeTreeSteps(clone);
}

/** `serializeForSync`, in steps: the same bytes, `yield`ing every `SLICE_BYTES` of output. */
export function* serializeForSyncSteps(clone) {
  const bareRoot = clonePreventingOnclone(clone, false);
  for (const name of TAB_LOCAL_ROOT_ATTRS) bareRoot.removeAttribute(name);
  const shell = bareRoot.outerHTML;
  const endTag = `</${bareRoot.localName}>`;
  const out = ["<!DOCTYPE html>", shell.slice(0, shell.length - endTag.length)];
  yield* serializeChildrenSteps(clone, clonePreventingOnclone(clone, false), out, { bytes: 0 });
  out.push(endTag);
  return out.join('');
}
