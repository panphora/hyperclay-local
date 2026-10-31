/**
 * save-job.js — a save capture's remaining work as a resumable job.
 *
 * `beginSaveCapture` takes the one atomic look at the live page (`prepareSaveCapture`,
 * which stays on the eager side because every save needs it) and hands back a job whose
 * rest — the three serializations, the format marker and the renderer's verification — is
 * a generator. Nothing else here decides anything: what the job must not do while it is
 * half verified, and whether its bytes may go out, are the caller's (`core/save.js`).
 *
 * This module is reached only through the dynamic import that a save first takes the
 * sliced path with, so a page whose documents are small never loads it and the Document
 * editor's ready path never pays for it.
 */

import {
  completeSaveCapture,
  prepareSaveCapture,
  readCapturePageState,
  releaseSaveCapture,
  runSaveRenderer,
  serializeClone,
  serializeForCompare
} from './snapshot.js';

/**
 * Begin one save capture: everything that must see the live page in this call, then a job
 * whose remaining work is `job.steps()`. The job holds every value that work reads, so a
 * page edited between two steps cannot change the answer; `job.drop()` releases what it
 * captured.
 *
 * @param {Object} options
 * @param {boolean} options.emitForSync - Whether to emit snapshot-ready event (default: true)
 * @param {boolean} options.forRequest - These bytes go to a host, so the renderer may
 *   attach the verified model they came from, for the accepted save to adopt
 * @param {?{name: string, content: string}} options.pageFormatMarker - The document format
 *   these bytes must declare, as the attributes of the marker element. It goes into the
 *   save clone after the comparison domains are read and before the renderer verifies, so
 *   the bytes verified are the bytes sent; the comparison baselines stay marker-free,
 *   exactly as they do on the one-task path
 * @returns {{ captureId: number, steps: function(): Generator, drop: function(): void }}
 */
export function beginSaveCapture(options = {}) {
  const pin = prepareSaveCapture(options);
  return Object.freeze({
    captureId: pin.captureId,
    steps: () => saveSteps(pin),
    drop: () => releaseSaveCapture(pin),
  });
}

/**
 * Declare the document format these bytes carry, in the save clone only.
 *
 * The same marker `withPageFormatFloor` puts in the final string, applied to the tree the
 * renderer verifies so a prepared save cannot verify one document and send another. A
 * clone already at that floor is left exactly as it is, because the string transform
 * leaves such a document unchanged too.
 */
function setFormatMarker(clone, marker) {
  const head = clone.querySelector('head');
  if (!head) return;
  const existing = clone.querySelector(`meta[name="${marker.name}"]`);
  if (existing) {
    if (existing.getAttribute('content') !== marker.content) existing.setAttribute('content', marker.content);
    return;
  }
  const meta = clone.ownerDocument.createElement('meta');
  meta.setAttribute('name', marker.name);
  meta.setAttribute('content', marker.content);
  head.appendChild(meta);
}

/**
 * The renderer as a generator, resumed with the capture it belongs to active and put back
 * before every yield: this capture is never the active one while this task is not running
 * it.
 */
function* rendererSteps(clone, today, pin) {
  if (!pin.renderer) return today;
  let gen = null;
  for (;;) {
    let step;
    try {
      step = runSaveRenderer(pin.context, () => {
        gen ||= pin.rendererSteps ? pin.rendererSteps(clone, today) : false;
        return gen ? gen.next() : { done: true, value: pin.renderer(clone, today) };
      });
    } catch (err) {
      console.error('clayjs: save renderer failed, sending the full serialization', err);
      return today;
    }
    if (step.done) return step.value;
    yield;
  }
}

/** The resumable half of a save capture: three serializations, then the renderer. */
function* saveSteps(pin) {
  readCapturePageState(pin);
  const today = serializeClone(pin.clone);
  yield;
  const forComparison = pin.compareClone ? serializeForCompare(pin.compareClone) : null;
  yield;
  const forDirty = pin.dirtyClone ? serializeForCompare(pin.dirtyClone) : forComparison;
  yield;
  if (pin.pageFormatMarker) setFormatMarker(pin.clone, pin.pageFormatMarker);
  const forSave = yield* rendererSteps(pin.clone, today, pin);
  return completeSaveCapture(pin, { forSave, forComparison, forDirty });
}
