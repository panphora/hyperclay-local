// Which resolved module a live switch can start and take back, keyed by the path the
// loader resolves. This module is data only — it imports nothing and evaluates nothing —
// and it is a dynamic target: a reader never fetches it.
//
// A path that is not a row here is unsupported, never assumed supported, so a plugin that
// arrives through an implication, a default, a `[sap]` root or template metadata is
// checked exactly like one the URL named. The caller takes the reload path before
// anything is prepared.
//
//   "neutral"  page-lifetime machinery that acts only under the committed mode or write
//              admission, so a live entry can import it and leave it alone
//   "export"   the module's namespace exports `modeParticipant`, prepared as a lease
//   "reader"   the view plan's reader, owned by the transition rather than a lease
//   function   a reader-loaded module whose participant lives in its edit chunk:
//              `(mod) => Promise<participant>`, so the reader never loads it
export const MODULE_SUPPORT = {
  // The always wave: state mirrors, a key handler and the facades both modes read.
  "lib/mutation.js": "neutral",
  "core/preserve-authored.js": "neutral",
  "core/edit-mode.js": "neutral",
  "core/mode-key.js": "neutral",
  "core/stale-host-notice.js": "neutral",
  "core/page-data.js": "neutral",
  // Snapshot, save core and the facades over them: functions and transforms read at
  // capture and save time, never at evaluation.
  "core/snapshot.js": "neutral",
  "core/save-core.js": "neutral",
  "core/recovery.js": "neutral",
  "core/unsaved-warning.js": "neutral",
  // These run on a save capture or after a saved event, which only a committed edit
  // produces, and each handler rechecks the mode or admission at event time, so an old
  // edit event is never replayed after an exit.
  "attrs/onaftersave.js": "neutral",
  "attrs/refetch-on-save.js": "neutral",
  "lib/cache-bust.js": "neutral",
  "attrs/save-freeze.js": "neutral",
  "core/persist.js": "neutral",
  "attrs/add-from.js": "neutral",
  "core/etag.js": "neutral",
  // The modules that keep a session and hand the controller a lease.
  "core/save.js": "export",
  "core/conflict-notice.js": "export",
  "core/autosave.js": "export",
  "core/admin-attrs.js": "export",
  "plugins/indicator.js": "export",
  "plugins/richclay.js": "export",
  "plugins/sortable.js": "export",
  "plugins/undo.js": "export",
  "plugins/unsent.js": "export",
  "plugins/upload.js": "export",
  "plugins/people.js": "export",
  "plugins/live.js": "export",
  "plugins/page.js": "export",
  "plugins/visitor-drafts-owner.js": "export",
  // A view boot already loaded these three, and each reads the mode at event time.
  "plugins/menu.js": "neutral",
  "plugins/upgrade.js": "neutral",
  "plugins/derive.js": "neutral",
  // A binding has no import-time work, and its disposal belongs to the application's own
  // participant.
  "plugins/bind-text.js": "neutral",
  // The view plan's reader, owned by the transition rather than a lease: the controller
  // prepares no lease for a `"reader"` row.
  "plugins/page-view.js": "reader",
  // The source map fetches, pairs and installs a save renderer, so it is a session: the
  // lease installs on a live entry and clears the renderer when the page goes back to view.
  "plugins/source.js": "export",
  // Generic sync: the module a reader and an editor both load, and the one whose
  // session starts regardless of mode. Its participant is in the edit chunk.
  "sync/live-sync.js": (mod) => mod.liveSync.editParticipant(),
  // The channel to a local process: its lease holds admission for the edit requests it
  // sends, so a live entry opens it at the commit and an exit closes it again.
  "plugins/wire.js": "export",
  // The AI composer: the lease builds the chrome on a live entry and takes it down again.
  "plugins/ai-edit.js": "export",
  // The CMS: the source owns the session, so the lease that opens it is the one that
  // closes it.
  "plugins/cms.js": "export",
};

export const PAGE_FEATURE_SUPPORT = {
  "page/ybind/recovery.js": { owner: "plugins/page.js", lifecycle: "child" },
  "page/recovery-ui.js": { owner: "plugins/page.js", lifecycle: "child" },
};

export const supportFor = (path) =>
  Object.prototype.hasOwnProperty.call(MODULE_SUPPORT, path) ? MODULE_SUPPORT[path] : null;
