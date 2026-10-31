import { resolveModules, MODULES, PLUGIN_PATHS } from "./loader-logic.js";
import onDomReady from "./lib/dom-ready.js";
import { initTheme } from "./ui/theme-config.js";
import { ephemeral } from "./lib/ephemeral.js";
import { storage } from "./lib/doc-storage.js";
import { trash } from "./lib/trash.js";
import { effect } from "./lib/effect.js";
import { style } from "./lib/style.js";
import { derived } from "./lib/derived.js";
import { assets } from "./lib/assets.js";
import { bootPhase } from "./core/boot-phase.js";
import { mergeEngine } from "./sync/merge-engine.js";
import { mergeManifests, preloadEntries } from "./lib/preload.js";

// The plugin name a late path announces: the loader's own name-to-path table,
// read the other way.
const PLUGIN_NAMES = Object.fromEntries(
  Object.entries(PLUGIN_PATHS).flatMap(([name, spec]) =>
    spec.ownerPath ? [[spec.path, name], [spec.ownerPath, name]] : [[spec.path, name]]
  )
);

// Every namespace this page imported, boot's plan and a live entry's alike: one record,
// so an entry skips what boot has and the edit members find their modules.
const loaded = {};

// clay:plugin-ready fires at most once per plugin per page: boot's late tail and a live
// entry can both reach the same module.
const announced = new Set();

function announce(path) {
  if (announced.has(path)) return;
  announced.add(path);
  document.dispatchEvent(new CustomEvent("clay:plugin-ready", { detail: { plugin: PLUGIN_NAMES[path] } }));
}

// A live entry's hint fetch: the bootstrap's cached one, preloading the plan the entry will
// import. It lives here, beside the helper, because one more static edge into the reader's
// graph is one more chunk of every reader's closure.
const editHints = (loadEditHints, manifest, plan, hasSapJs) => () =>
  loadEditHints().then((hints) => {
    preloadEntries(mergeManifests(manifest, hints), [...plan.core, ...plan.plugins, ...plan.late], { isEditMode: true, hasSapJs });
    return hints;
  });

function domReady() {
  return new Promise((resolve) => onDomReady(resolve));
}

// Where this document came from, when it is a copy of a starter template.
function templateSource() {
  const meta = document.querySelector('meta[name="hyper-source"]');
  return meta ? meta.getAttribute("content") : null;
}

// `base` has been unused since 1.1.0 (the loader imports through MODULES) and
// stays anyway: /v1/clay.js and /v1/src/loader.js are cached independently, so
// for a while after a deploy a browser can pair either file with the other's
// previous release. A call shape that differs between them leaves the page with
// no clayjs at all. The optional arguments after the third come only from the chunked
// bootstrap: the manifest a reader downloads, the edit supplement an explicit
// ?editmode=true page fetched beside it, and the cached fetch of that supplement for
// every other resolved edit or draft. Their absence means no preloading.
export async function boot(base, params, readyResolve, manifest = null, supplement = null, loadEditHints = null) {
  initTheme();
  const draftMode = await MODULES["core/draft-mode.js"]();
  draftMode.noteBootParams(params);

  await domReady();                                    // Mutation observes document.body
                                                       // unconditionally, and a <head> placement
                                                       // would otherwise observe null

  const editMode = await MODULES["core/is-edit-mode.js"]();
  const { isEditMode, isDraftMode, isOwner, siteVisibility, canEdit } = editMode;

  // A draft saved by its visitor never reaches the host, and hostMeta() answers
  // bareHost() for it, so the request would fetch an answer nothing reads.
  if (isEditMode && !isDraftMode) import("./core/host-permission.js").then((m) => m.checkHostPermission()).catch(() => {});

  // richclay's vendor build detects edit mode via this legacy global; set it
  // before any plugin import so its autoInit sees the right value. Overwrite
  // even a pre-set value: resolution already consumed it (lowest precedence),
  // and a conflicting leftover would make richclay disable itself.
  window.__hyperclayEditMode = isEditMode;

  const regionPolicy = await MODULES["lib/region-policy.js"]();

  const hasSap = Boolean(document.querySelector("[sap]"));
  const hasVariants = document.querySelectorAll("head style[clay-variant]").length >= 2;
  // derive.js imports the sapjs core only when no sap.js script took the page over.
  const hasSapJs = Boolean(document.querySelector('script[src*="sap.js"]'));
  bootPhase.holdSettle = hasSap && isEditMode;
  const plan = resolveModules(params, isEditMode, { isDraftMode, hasSap, hasVariants, canEdit, templateSource: templateSource() });
  // Where edits land, resolved once: a visitor draft saves into its draft slot, the
  // demo plugin into localStorage, and everything else to the host. setMode takes no
  // destination, and V4 has no draft-to-host transition.
  if (plan.plugins.includes("plugins/demo.js")) editMode.commitModeFacts({ destination: "demo" });
  preloadEntries(mergeManifests(manifest, supplement), [...plan.core, ...plan.plugins], { isEditMode, isDraftMode, hasSapJs });
  // A resolved initial edit or draft fetches the release's hint index, whether or not
  // the URL announced it. It lands beside preparation and only ever adds modulepreloads:
  // a failed fetch defers hints, never an import already mapped.
  if ((isEditMode || isDraftMode) && !supplement && loadEditHints) {
    loadEditHints()
      .then((hints) => preloadEntries(mergeManifests(manifest, hints), [...plan.core, ...plan.plugins], { isEditMode, isDraftMode, hasSapJs }))
      .catch(() => {});
  }
  // Not awaited by boot: an entry that overlaps the tail waits on this rather than
  // import the same paths a second time.
  let settleLate;
  const lateDone = new Promise((resolve) => { settleLate = resolve; });
  // The reader's transport choice comes from the plan just resolved, never from the
  // URL: when generic sync loaded, it owns the saved lane and the reader follows
  // the frames it applies rather than opening a second stream.
  const readerOptions = { sync: plan.plugins.includes("sync/live-sync.js") };

  for (const path of plan.core) {
    loaded[path] = await MODULES[path](); // sequential: order is load-bearing
    // The loader starts what it imports: a target that exports `install` gets it called
    // here, once, in this order. A module another road reaches (a live switch, a second
    // entry) then reuses that same installation instead of adding a second one.
    loaded[path].install?.();
  }

  assembleCore(loaded, { isDraftMode, isOwner, siteVisibility }, regionPolicy);
  attachEditCore(loaded); // window.clay MUST be assembled before any plugin import
  // A document that signs the live-switch contract hands its boot to the mode dispatcher.
  // Nothing is fetched for it here: the decision and the controller behind it wait for the
  // first switch, so this costs a reader with a declaration no more than one attribute.
  if (document.documentElement.getAttribute("clay-mode-switch") === "live") {
    const editing = resolveModules(params, true, { isDraftMode, hasSap, hasVariants, canEdit, templateSource: templateSource() });
    loaded["core/edit-mode.js"].noteLiveSwitch({
      edit: editing,
      // The plan a view boot would have resolved, not the edit plan this boot resolved: an
      // exit imports it and starts its reader, and an edit-only module belongs to the
      // session being left.
      view: resolveModules(params, false, { isDraftMode, hasSap, hasVariants, canEdit, templateSource: templateSource() }),
      loaded,
      modules: MODULES,
      // A live entry attaches the edit plugins after boot: clay.plugins names them from then on.
      attach: (path, mod) => {
        attachPluginMember(path, mod);
        const name = PLUGIN_NAMES[path];
        const named = window.clay.plugins;
        if (name && Array.isArray(named) && !named.includes(name)) window.clay.plugins = Object.freeze([...named, name]);
      },
      attachEditCore,
      announce,
      loadEditHints: loadEditHints ? editHints(loadEditHints, manifest, editing, hasSapJs) : null,
      late: lateDone,
    });
  }
  // An explicit initial edit drains the preboot participant queue and enables its
  // leases before a plugin can take input. A reader returns at the first line.
  await loaded["core/edit-mode.js"].activateInitialMode();
  window.clay.plugins = Object.freeze([...plan.plugins, ...plan.late].map((path) => PLUGIN_NAMES[path]));
  // What an edit session here would load, so view-mode chrome can offer an edit-only feature.
  const editPlan = isEditMode ? plan : resolveModules(params, true, { isDraftMode, hasSap, hasVariants, canEdit, templateSource: templateSource() });
  window.clay.editPlugins = Object.freeze([...editPlan.plugins, ...editPlan.late].map((path) => PLUGIN_NAMES[path]));

  for (const path of plan.plugins) {
    // A plugin that throws on evaluation degrades to absent. Unguarded, its
    // rejection propagated out of boot() and left clay.ready pending forever, so
    // every `await clay.ready` on the page hung: one broken optional module took
    // the whole client with it. (The allSettled below covers the plugins' async
    // `ready` exports, never their evaluation.)
    let mod;
    try {
      mod = await MODULES[path]();
    } catch (err) {
      console.error(`clayjs: plugin "${path}" failed to load, continuing without it:`, err);
      continue;
    }
    loaded[path] = mod;
    if (path === "plugins/page-view.js") mod.start(readerOptions);
    attachPluginMember(path, mod, loaded); // immediately, not after the loop: hypercms's ?cms=true
                                     // auto-open runs as a microtask queued during ITS evaluation
                                     // (before boot resumes) and reads clay.RichClay and clay.undo,
                                     // which earlier plugins must have attached by then
  }

  // Plugins with async setup (sortable's vendor fetch) export `ready`; hold
  // clay.ready until they finish. allSettled: a failed plugin degrades, never blocks boot.
  await Promise.allSettled(plan.plugins.map((path) => loaded[path]?.ready).filter(Boolean));

  if (hasSap) mountDerivedEngine(loaded);

  installViewModeNotice(editMode);
  readyResolve(window.clay);
  document.dispatchEvent(new CustomEvent("clay:ready", { detail: { clay: window.clay } }));
  if (plan.late.length) loadLate(plan.late, editMode).then(settleLate, settleLate);
  else settleLate();
}

// An edit-only plugin belongs to the edit session that resolved it. Once the page has
// left edit, importing it would start an editor in a view, so the tail drops it instead:
// the module is not fetched, not attached and not announced. Dropping is not a reload —
// nothing is re-imported with a cache-busting URL, and a later entry asks the module
// cache for the same single instance.
//
// A transition in flight counts as left: until it commits, `isEditMode` still reads the
// mode being left, and a module that evaluated then would start an unadopted session. The
// modules ask the same question themselves (`startsAtImport`), so an import already in
// flight when the exit began starts nothing either.
const stale = (path, editMode) =>
  PLUGIN_PATHS[PLUGIN_NAMES[path]]?.editOnly && !editMode.startsAtImport();

// Plugins no first paint or keystroke waits for. They load after the editor takes input
// (right away on a page without one), one at a time and in plan order, and a failure
// degrades to absent as at boot.
async function loadLate(paths, editMode) {
  try {
    await window.clay.page?.ready;
  } catch {}
  for (const path of paths) {
    if (stale(path, editMode)) continue;
    try {
      const mod = await MODULES[path]();
      // The session can end while the fetch is in flight, so ask again before the module
      // is given a page to wire itself into.
      if (stale(path, editMode)) continue;
      loaded[path] = mod;
      attachPluginMember(path, mod, loaded);
      await mod.ready;
      if (stale(path, editMode)) continue;
      announce(path);
    } catch (err) {
      console.error(`clayjs: plugin "${path}" failed to load, continuing without it:`, err);
      document.dispatchEvent(new CustomEvent("clay:plugin-failed", { detail: { plugin: PLUGIN_NAMES[path] } }));
    }
  }
}

// The explicit mount phase for a derive engine (sapjs or its core). It runs after
// frozen regions recorded their authored markup (save-freeze, core wave) and
// visitor drafts were restored (plugins), so the first pass paints the page those
// produced, and the held boot baseline settles on that painted page. Sap.mount()
// skips roots already mounted, so sapjs's own later mount at clay.ready is a no-op.
export function mountDerivedEngine(loaded) {
  const save = loaded["core/save.js"];
  let fileSignature = null;
  try {
    fileSignature = save ? save.currentPaintSignature() : null;
  } catch (err) {
    console.error("clayjs: could not read the page's painted values:", err);
  }
  try {
    if (window.Sap && typeof window.Sap.mount === "function") window.Sap.mount();
  } catch (err) {
    console.error("clayjs: the derive engine failed to mount:", err);
  } finally {
    save?.releaseBootSettle();
  }
  if (save && fileSignature != null) save.schedulePaintHeal(fileSignature);
}

function assembleCore(loaded, { isDraftMode, isOwner, siteVisibility }, regionPolicy) {
  const clay = window.clay;

  const mutation = loaded["lib/mutation.js"];
  const editModeMod = loaded["core/edit-mode.js"];

  Object.assign(clay, {
    toggleEditMode: editModeMod.toggleEditMode,
    setMode: editModeMod.setMode,
    modeLifecycle: editModeMod.modeLifecycle,
    isDraftMode,
    isOwner,
    siteVisibility,
    Mutation: mutation.default,
    region: regionPolicy.windowRegionShape,
  });

  // Getters over the live mode facts, never copies: the lifecycle commits a new mode
  // and these read it back, so `clay.mode` stays a string that cannot go stale.
  for (const key of ["mode", "isEditMode", "canEdit"]) {
    Object.defineProperty(clay, key, { get: () => editModeMod[key], enumerable: true, configurable: true });
  }

  clay.assets = assets;

  const pageData = loaded["core/page-data.js"];

  clay.readData = pageData.readData;
  clay.writeData = pageData.writeData;
  clay.ephemeral = ephemeral;
  clay.storage = storage;
  // About the document rather than the page, and asked for on use: a reader never
  // downloads the discovery client for it.
  clay.host = {
    get versions() {
      return import("./core/host-meta.js").then((m) => m.hostVersions());
    },
  };
  clay.trash = trash;
  clay.derived = derived;
  clay.effect = effect;
  clay.style = style;
  clay.morph = (oldEl, newEl, options) => mergeEngine().then(({ morph }) => morph(oldEl, newEl, options));
}

// The edit half of the assembly: boot runs it right after the always half, and a live entry
// runs it once its edit core has landed. It adds what those modules offer and replaces
// nothing already there, so a member a reader attached first survives.
function attachEditCore(loaded) {
  const clay = window.clay;

  const save = loaded["core/save.js"];
  if (save) {
    const saveFn = save.savePage || save.default;
    saveFn.force = save.savePageForce;
    saveFn.overwrite = save.saveOverwritingConflict;
    saveFn.flush = save.flushSave;
    saveFn.soon = save.savePageSoon;
    // What the host says it will store, and a measurement of candidate bytes. Both
    // are asked for on use: a reader has neither, and a page that never asks pays
    // nothing.
    saveFn.limits = save.saveLimits;
    saveFn.inspect = save.inspectSaveSize;
    // An upgrade-capable reader's temporary save object hands its `replace` to the function.
    if (clay.save !== saveFn && typeof clay.save?.replace === "function") saveFn.replace = clay.save.replace;
    if (clay.save !== saveFn) clay.save = saveFn;
  }
  // The close warning's own predicate, reachable without a capture. It falls back to
  // false rather than to absent: the module is edit-only, and a document that cannot
  // save has nothing unsaved. Older clayjs has no such member, and that is the answer
  // a host feature-detects.
  clay.hasUnsavedChanges =
    loaded["core/unsaved-warning.js"]?.hasUnsavedChanges ?? clay.hasUnsavedChanges ?? (() => false);
  const snapshot = loaded["core/snapshot.js"];
  if (snapshot) {
    if (!clay.getHTML) clay.getHTML = snapshot.getPageContents;
    if (!clay.addDocumentTransform) clay.addDocumentTransform = snapshot.addDocumentTransform;
    if (!clay.onSnapshot) clay.onSnapshot = snapshot.onSnapshot;
  }
  const cacheBustMod = loaded["lib/cache-bust.js"];
  if (cacheBustMod && !clay.cacheBust) {
    clay.cacheBust = cacheBustMod.default;
  }
  // Edit mode only, and absent entirely in view mode: a reader has nothing to
  // recover and must never open the database. The facade is here; the store behind
  // it arrives when the page's first adapter registers a channel.
  const recoveryMod = loaded["core/recovery.js"];
  if (recoveryMod && !clay.recovery) clay.recovery = recoveryMod.recovery;
}

function attachPluginMember(path, mod, namespaces = loaded) {
  const clay = window.clay;

  if (path === "plugins/undo.js") {
    clay.undo = mod.undo || mod.default;
  } else if (path === "plugins/unsent.js") {
    clay.unsent = mod.unsent;
  } else if (path === "sync/live-sync.js") {
    clay.morph = mod.morph;
    clay.conflicts = mod.conflicts;
    namespaces["core/page-data.js"].setPageDataLiveSync(mod.liveSync);
  } else if (path === "plugins/live.js") {
    clay.live = mod.live;
  } else if (path === "plugins/page.js") {
    clay.page = mod.page;
  } else if (path === "plugins/upgrade.js") {
    clay.save = clay.save || {};
    clay.save.replace = mod.replace;
  } else if (path === "plugins/cms.js") {
    clay.cms = mod.cms || mod.default;
  } else if (path === "plugins/upload.js") {
    clay.upload = mod.upload || mod.default;
  } else if (path === "plugins/people.js") {
    clay.people = mod.people;
    clay.author = mod.author;
    Object.defineProperty(clay, "me", { get: mod.currentMe, configurable: true, enumerable: true });
  } else if (path === "plugins/message.js") {
    clay.message = mod.message;
  } else if (path === "plugins/wire.js") {
    clay.wire = mod.wire || mod.default;
  } else if (path === "plugins/ai-edit.js") {
    clay.aiEdit = mod.aiEdit || mod.default;
  } else if (path === "plugins/demo.js") {
    clay.demo = mod.demo;
  } else if (path === "plugins/richclay.js") {
    clay.RichClay = mod.RichClay || mod.default;
  } else if (path === "plugins/quickcrop.js") {
    clay.quickcrop = mod.quickcrop || mod.default;
  } else if (path === "plugins/sortable.js") {
    // With the module, not with its vendor: a move answers before a drag can start.
    clay.sortable = mod.sortable;
  } else if (path === "plugins/source.js") {
    clay.source = mod.source || mod.default;
  } else if (path === "plugins/visitor-drafts.js" || path === "plugins/visitor-drafts-owner.js") {
    clay.visitorDrafts = mod.visitorDrafts;
  } else if (path === "plugins/bind-text.js") {
    clay.bindText = mod.bindText;
  }
}

function installViewModeNotice(editMode) {
  if (editMode.isEditMode) return;
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("[trigger-save]")) return;
    if (editMode.isEditMode) return;
    console.info("clayjs: you're not the owner of this page; changes stay local");
    document.dispatchEvent(new CustomEvent("clay:view-save-attempt"));
  });
}
