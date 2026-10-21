export const CORE_WAVES = {
  always: [
    "lib/mutation.js",     // first: everything hangs off the hub; cms/sync need it in view mode too
    "core/edit-mode.js",   // both modes — matches today: 'edit-mode' is NOT in EDIT_MODE_ONLY
                           // (hyperclay.js:251-273 lists 'edit-mode-helpers', not 'edit-mode');
                           // toggleEditMode must exist in view mode, it's the way IN
    // always, deliberately: it speaks only when the host is too old to save to, which
    // is exactly the case where edit mode is off, so the editOnly wave would never
    // reach it. It draws nothing on any other page.
    "core/stale-host-notice.js",
    "core/page-data.js",
  ],
  editOnly: [
    "vendor/hyper-morph.vendor.js",
    "core/snapshot.js",
    // Before save.js: it takes the boot baseline as it evaluates, and a snapshot
    // transform registered after that made an untouched page read as unsaved.
    "core/persist.js", "core/admin-attrs.js",
    "core/save-core.js", "core/save.js",
    "core/conflict-notice.js",
    "core/unsaved-warning.js", "core/autosave.js",
    "attrs/save-freeze.js", "attrs/onaftersave.js", "attrs/refetch-on-save.js", "attrs/add-from.js",
    "lib/cache-bust.js",
  ],
};

export const PLUGIN_PATHS = {
  richclay:  { path: "plugins/richclay.js",        editOnly: true,  default: true },
  indicator: { path: "plugins/indicator.js",       editOnly: true,  default: false },
  sync:      { path: "sync/live-sync.js",          editOnly: false, default: false },
  // A live JSON tag as an in-memory object (clay.live). Not editOnly: a reader's
  // tab still shows the game, and its writes stay in that tab.
  live:      { path: "plugins/live.js",           editOnly: false, default: false },
  page:      { path: "plugins/page.js",           editOnly: true,  default: false },
  sortable:  { path: "plugins/sortable.js",        editOnly: true,  default: false },
  undo:      { path: "plugins/undo.js",            editOnly: true,  default: false },
  cms:       { path: "plugins/cms.js",             editOnly: false, default: false },
  quickcrop: { path: "plugins/quickcrop.js",       editOnly: false, default: false },
  // editOnly, because a file picker only ever appears in edit mode: the cms
  // injects its own editing toggle there and clayjs's edit-mode signal is a
  // superset of the cms's, so the plugin is present exactly when it can be used.
  upload:    { path: "plugins/upload.js",          editOnly: true,  default: false },
  // Who is editing and who wrote what. Not editOnly: a reader still sees names.
  people:    { path: "plugins/people.js",          editOnly: false, default: false },
  wire:      { path: "plugins/wire.js",            editOnly: false, default: false },
  // A visitor's contact form to the document's owner. Not editOnly: visitors are
  // who send messages.
  message:   { path: "plugins/message.js",         editOnly: false, default: false },
  // Edit mode only: the AI comment box is an editing gesture. Opt in with
  // `plugins=ai-edit`; it stays dormant on any host that does not list a ready
  // `ai-edit` helper.
  "ai-edit": { path: "plugins/ai-edit.js",         editOnly: true,  default: false },
  demo:      { path: "plugins/demo.js",            editOnly: false, default: false },
  // Saves the file's own bytes back instead of a fresh serialization of the DOM.
  // editOnly because a page that cannot save has nothing to preserve. On by default
  // because the fallback rate it is judged on can only be collected from real pages,
  // and a plugin nobody enables produces no number to judge. It costs a 48 KB parser
  // and one extra request at boot, both in edit mode only, and every save it cannot
  // verify is sent as the ordinary full serialization, so the floor is the behaviour
  // it replaces. `exclude=source` turns it off.
  source:    { path: "plugins/source.js",          editOnly: true,  default: true },
  "visitor-drafts": { path: "plugins/visitor-drafts.js", editOnly: false, default: false },
};

// One literal import per module the loader can ask for, so a bundler can see the
// whole graph. The loader used to build each specifier at runtime
// (`import(base + "/src/" + path)`), which no bundler can follow, and that alone
// stood between clayjs and the single-file build. A relative specifier resolves
// against this file, so on clayjs.com the URLs fetched are exactly the ones the
// computed form produced. The thunks keep every import lazy: nothing evaluates
// until the loader asks, in the loader's order, which is load-bearing.
// tests/unit/loader-modules.test.js proves every path in CORE_WAVES and
// PLUGIN_PATHS has an entry here and that each entry imports the file it names.
export const MODULES = {
  "core/is-edit-mode.js":       () => import("./core/is-edit-mode.js"),
  "core/draft-mode.js": () => import("./core/draft-mode.js"),
  "lib/region-policy.js":       () => import("./lib/region-policy.js"),
  "lib/mutation.js":            () => import("./lib/mutation.js"),
  "core/edit-mode.js":          () => import("./core/edit-mode.js"),
  "core/stale-host-notice.js":  () => import("./core/stale-host-notice.js"),
  "core/page-data.js":          () => import("./core/page-data.js"),
  "core/snapshot.js":           () => import("./core/snapshot.js"),
  "core/save-core.js":          () => import("./core/save-core.js"),
  "core/save.js":               () => import("./core/save.js"),
  "core/conflict-notice.js":     () => import("./core/conflict-notice.js"),
  "core/unsaved-warning.js":    () => import("./core/unsaved-warning.js"),
  "core/persist.js":            () => import("./core/persist.js"),
  "core/admin-attrs.js":        () => import("./core/admin-attrs.js"),
  "core/autosave.js":           () => import("./core/autosave.js"),
  "attrs/save-freeze.js":       () => import("./attrs/save-freeze.js"),
  "attrs/onaftersave.js":       () => import("./attrs/onaftersave.js"),
  "attrs/refetch-on-save.js":   () => import("./attrs/refetch-on-save.js"),
  "attrs/add-from.js":          () => import("./attrs/add-from.js"),
  "lib/cache-bust.js":          () => import("./lib/cache-bust.js"),
  "vendor/hyper-morph.vendor.js": () => import("./vendor/hyper-morph.vendor.js"),
  "plugins/richclay.js":        () => import("./plugins/richclay.js"),
  "plugins/indicator.js":       () => import("./plugins/indicator.js"),
  "sync/live-sync.js":          () => import("./sync/live-sync.js"),
  "plugins/live.js":            () => import("./plugins/live.js"),
  "plugins/page.js":            () => import("./plugins/page.js"),
  "plugins/sortable.js":        () => import("./plugins/sortable.js"),
  "plugins/undo.js":            () => import("./plugins/undo.js"),
  "plugins/cms.js":             () => import("./plugins/cms.js"),
  "plugins/quickcrop.js":       () => import("./plugins/quickcrop.js"),
  "plugins/upload.js":          () => import("./plugins/upload.js"),
  "plugins/people.js":          () => import("./plugins/people.js"),
  "plugins/wire.js":            () => import("./plugins/wire.js"),
  "plugins/message.js":         () => import("./plugins/message.js"),
  "plugins/ai-edit.js":         () => import("./plugins/ai-edit.js"),
  "plugins/demo.js":            () => import("./plugins/demo.js"),
  "plugins/visitor-drafts.js": () => import("./plugins/visitor-drafts.js"),
  "plugins/source.js":          () => import("./plugins/source.js"),
};

// `source` is last on purpose: its install captures a save clone, so it wants every
// plugin that registers a document transform to have registered it first.
const PLUGIN_ORDER = ["visitor-drafts", "richclay", "indicator", "sortable", "undo", "quickcrop", "upload", "people", "cms", "sync", "live", "page", "message", "wire", "ai-edit", "demo", "source"];

// A plugin that cannot do its whole job alone. hypercms reads the cropper through
// a capability lookup (`clay.quickcrop`) and silently uploads the raw file when it
// finds nothing, so `plugins=cms` has to bring quickcrop with it or image crop is
// dead with no error and no log. quickcrop loads BEFORE cms in the order above,
// because the loader attaches each plugin's member as it lands and cms reads what
// earlier plugins attached during its own evaluation.
// `upload` rides the same reasoning one step further. Without it the cms has no
// uploader to look up, so it embeds every picked image in the document as a data:
// URL: a two megabyte photo costs 2.7 MB of base64 on that save, on every future
// save, and in every stored version. With it the cms asks the host first and
// embeds only when the host does not store files, which is still the right answer
// on a plain file server.
//
// This is the only line in the capability that changes how an already-published
// page behaves, which is why it shipped alone, one release after the plugin it
// enables. Reverting it is reverting this line.
// ai-edit reads `clay.wire.helpers()` and sends through `clay.wire.send`, so a page
// that asks for it has to have the wire. The wire loads first in the order above.
// It does not bring undo: hyper-undo takes Cmd+Z for the whole window, text fields
// included, which a page that never asked for it should not get by default.
const IMPLIES = { cms: ["quickcrop", "upload"], "ai-edit": ["wire"], page: ["live"] };

function parseCsv(params, key, enabled, apply) {
  const raw = params.get(key);
  if (!raw) return;
  for (const token of raw.split(",")) {
    const name = token.trim();
    if (!name) continue;
    if (!PLUGIN_PATHS[name]) {
      console.warn(`clayjs: unknown plugin "${name}"`);
      continue;
    }
    apply(enabled, name);
  }
}

// Each of these talks to the host or writes outside the visitor's own record, so a
// page that keeps its edits in this browser cannot carry them.
const DRAFT_DROPS = ["sync", "live", "page", "upload", "quickcrop", "cms", "people", "wire", "ai-edit", "demo", "source"];

// [refetch-on-save] swaps its element for a fresh GET of the same URL after every
// save, which on a visitor's own draft is a request to the host.
const DRAFT_DROPS_CORE = ["attrs/refetch-on-save.js"];

export function resolveModules(params, isEditMode, { isDraftMode = false } = {}) {
  const core = [...CORE_WAVES.always];
  if (isEditMode) core.push(...CORE_WAVES.editOnly);

  const explicit = new Set();
  parseCsv(params, "plugins", explicit, (set, name) => set.add(name));
  const excluded = new Set();
  parseCsv(params, "exclude", excluded, (set, name) => set.add(name));

  const enabled = new Set(explicit);
  for (const [name, spec] of Object.entries(PLUGIN_PATHS)) {
    if (spec.default) enabled.add(name);
  }
  // ai-edit cannot run without the wire, so excluding the wire excludes it too.
  if (excluded.has("wire")) enabled.delete("ai-edit");
  // A default-on plugin that this mode drops brings nothing with it. An explicitly
  // asked for plugin still brings what it implies.
  for (const name of [...enabled]) {
    if (excluded.has(name)) continue;
    if (!explicit.has(name) && PLUGIN_PATHS[name].editOnly && !isEditMode) continue;
    for (const implied of IMPLIES[name] || []) enabled.add(implied);
  }
  for (const name of excluded) enabled.delete(name);
  if (isDraftMode) {
    for (const name of DRAFT_DROPS) enabled.delete(name);
    for (const path of DRAFT_DROPS_CORE) {
      const at = core.indexOf(path);
      if (at > -1) core.splice(at, 1);
    }
    enabled.add("visitor-drafts");
  }

  const plugins = [];
  for (const name of PLUGIN_ORDER) {
    if (!enabled.has(name)) continue;
    const spec = PLUGIN_PATHS[name];
    if (spec.editOnly && !isEditMode) continue;
    plugins.push(spec.path);
  }

  return { core, plugins };
}
