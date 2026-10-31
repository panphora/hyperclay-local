// The page's boot code in one module: the page code and the chrome, recovery and title
// code beside it arrive through this file's static graph, and the plugin fetches it with
// one dynamic import. Loading the parts together is what keeps a module they share from
// being linked by two dynamic imports at once, and it is one download for a boot that
// needs them all. The parts a page chooses from its own tag (a table, a board, media, a
// tool) stay separate dynamic imports, issued once this has resolved.
//
// The editor is a download of its own, and it starts here rather than after this file
// so its fetch runs beside the page code's. It is not awaited: the page code, and the
// room participant the binding registers, must be ready while the editor is still on
// the wire. Its static graph is linked by the time this body runs, so the vendor it
// shares with the page code is already in cache when its own link begins.
export { installAdoption, ADOPTION_TIMEOUT_MS } from "./adopt-boot.js";
export { classifyFile, readBack } from "./adopt.js";
export { mergePageModels } from "./merge.js";
export { canon } from "./projection.js";
export { renderFromTags, acceptedPageState } from "./save-projection.js";
export { blocksFromYValue } from "./ybind/decode.js";
export { createYPageBinding } from "./ybind/binding.js";
export { yValueOf } from "./ybind/provider.js";
export { seedPageFromArticle } from "./ybind/migrate.js";
export { holdSlashRange, heldSlashRange } from "./chrome.js";
export { createRecoverList, focusBlock } from "./recover.js";
export { observeDocumentTitle } from "./document-title-runtime.js";
export { createFeatureLoader } from "./feature-loader.js";
import("./editor.js").catch(() => null);
