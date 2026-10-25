// The always-wave core as one module graph for the built release. The chunk build
// makes this an entry and rewrites the loader's always-wave thunks to read the
// namespace each path names here, so a page fetches one file instead of five while
// the loader still activates the core before any plugin, in this order.
//
// The import list is CORE_WAVES.always (src/loader-logic.js), written out because
// import statements cannot be computed. tests/unit/build/reader-core-order.test.js
// runs the built graph and the source graph and compares their evaluation order, so
// a module added to that wave without a line here fails a test instead of quietly
// moving to the end. Source mode never imports this file.
import * as mutation from "./lib/mutation.js";
import * as editMode from "./core/edit-mode.js";
import * as modeKey from "./core/mode-key.js";
import * as staleHostNotice from "./core/stale-host-notice.js";
import * as pageData from "./core/page-data.js";

// Keyed by the logical path the loader and the manifest use.
export const core = {
  "lib/mutation.js": mutation,
  "core/edit-mode.js": editMode,
  "core/mode-key.js": modeKey,
  "core/stale-host-notice.js": staleHostNotice,
  "core/page-data.js": pageData,
};
