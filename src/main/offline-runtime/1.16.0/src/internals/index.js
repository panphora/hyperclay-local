/**
 * internals/index.js — the supported low-level surface.
 *
 * Everything here is reachable by direct module import whether we export it or
 * not, because src/ ships to npm and the CDN. What this file adds is the promise:
 * these names keep working, and anything not named here may change in a patch.
 *
 * Lower level than clay.* deliberately. These are the pieces the library builds
 * itself out of, so they assume you know the save lifecycle. The ergonomics are
 * your problem; the stability is ours.
 */

import { captureSnapshot, captureForSave, addDocumentTransform } from "../core/snapshot.js";
import { saveHtml, replacePageWith, isSaveInProgress } from "../core/save-core.js";
import { regionShape } from "../lib/region-policy.js";

const clay = (window.clay = window.clay || {});

clay.internals = {
  // The snapshot pipeline, read side. captureSnapshot gives you the clone before
  // any stripping; captureForSave gives you the bytes a save would send.
  captureSnapshot,
  captureForSave,

  // The same registry clay.addDocumentTransform writes to. Core only publishes that
  // name in edit mode, since core/snapshot.js is editOnly; this one is reachable from
  // the satellite alone, so a view-mode page can still register a transform.
  addDocumentTransform,

  // Write your own attribute without hardcoding our selectors. Doing it by hand is
  // how a custom attribute quietly stops respecting [no-save] two releases later.
  // The same object clay.region holds, so the two can no longer drift.
  region: regionShape,

  // The save lane under clay.save. saveHtml sends bytes you supply, so it bypasses
  // the snapshot pipeline entirely: whatever you hand it is what lands in the
  // person's file. Check isSaveInProgress first — firing into an in-flight save is
  // how you lose an edit.
  save: {
    saveHtml,
    replacePageWith,
    isSaveInProgress,
  },
};

export default clay.internals;
