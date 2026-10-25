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
// no clayjs at all. The optional fourth and fifth arguments come only from the
// chunked bootstrap: the manifest a reader downloads and, on a page that looked
// editable, the edit supplement beside it. Their absence means no preloading.
export async function boot(base, params, readyResolve, manifest = null, supplement = null) {
  initTheme();
  const draftMode = await MODULES["core/draft-mode.js"]();
  draftMode.noteBootParams(params);

  await domReady();                                    // Mutation observes document.body
                                                       // unconditionally, and a <head> placement
                                                       // would otherwise observe null

  const editMode = await MODULES["core/is-edit-mode.js"]();
  const { isEditMode, isDraftMode, isOwner, siteVisibility, canEdit, mode } = editMode;

  // A draft saved by its visitor never reaches the host, and hostMeta() answers
  // bareHost() for it, so the request would fetch an answer nothing reads.
  if (isEditMode && !isDraftMode) import("./core/host-meta.js").then((m) => m.hostMeta()).catch(() => {});

  // richclay's vendor build detects edit mode via this legacy global; set it
  // before any plugin import so its autoInit sees the right value. Overwrite
  // even a pre-set value: resolution already consumed it (lowest precedence),
  // and a conflicting leftover would make richclay disable itself.
  window.__hyperclayEditMode = isEditMode;

  const regionPolicy = await MODULES["lib/region-policy.js"]();

  const hasSap = Boolean(document.querySelector("[sap]"));
  // derive.js imports the sapjs core only when no sap.js script took the page over.
  const hasSapJs = Boolean(document.querySelector('script[src*="sap.js"]'));
  bootPhase.holdSettle = hasSap && isEditMode;
  const plan = resolveModules(params, isEditMode, { isDraftMode, hasSap, canEdit, templateSource: templateSource() });
  preloadEntries(mergeManifests(manifest, supplement), [...plan.core, ...plan.plugins], { isEditMode, isDraftMode, hasSapJs });
  const loaded = {};
  // The reader's transport choice comes from the plan just resolved, never from the
  // URL: when generic sync loaded, it owns the saved lane and the reader follows
  // the frames it applies rather than opening a second stream.
  const readerOptions = { sync: plan.plugins.includes("sync/live-sync.js") };

  for (const path of plan.core) {
    loaded[path] = await MODULES[path](); // sequential: order is load-bearing
  }

  assembleCore(loaded, { isDraftMode, isEditMode, isOwner, siteVisibility, canEdit, mode }, regionPolicy); // window.clay MUST be assembled
                                                               // before any plugin import
  window.clay.plugins = Object.freeze([...plan.plugins, ...plan.late].map((path) => PLUGIN_NAMES[path]));

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

  installViewModeNotice(isEditMode);
  readyResolve(window.clay);
  document.dispatchEvent(new CustomEvent("clay:ready", { detail: { clay: window.clay } }));
  if (plan.late.length) loadLate(plan.late, loaded);
}

// Plugins no first paint or keystroke waits for. They load after the editor takes input
// (right away on a page without one), one at a time and in plan order, and a failure
// degrades to absent as at boot.
async function loadLate(paths, loaded) {
  try {
    await window.clay.page?.ready;
  } catch {}
  for (const path of paths) {
    try {
      const mod = await MODULES[path]();
      loaded[path] = mod;
      attachPluginMember(path, mod, loaded);
      await mod.ready;
      document.dispatchEvent(new CustomEvent("clay:plugin-ready", { detail: { plugin: PLUGIN_NAMES[path] } }));
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

function assembleCore(loaded, { isDraftMode, isEditMode, isOwner, siteVisibility, canEdit, mode }, regionPolicy) {
  const clay = window.clay;

  const mutation = loaded["lib/mutation.js"];
  const editModeMod = loaded["core/edit-mode.js"];

  Object.assign(clay, {
    toggleEditMode: editModeMod.toggleEditMode,
    setMode: editModeMod.setMode,
    isDraftMode,
    isEditMode,
    canEdit,
    mode,
    isOwner,
    siteVisibility,
    Mutation: mutation.default,
    region: regionPolicy.windowRegionShape,
  });

  clay.assets = assets;

  const snapshot = loaded["core/snapshot.js"];
  const save = loaded["core/save.js"];
  const cacheBustMod = loaded["lib/cache-bust.js"];
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

  if (save) {
    const saveFn = save.savePage || save.default;
    saveFn.force = save.savePageForce;
    saveFn.overwrite = save.saveOverwritingConflict;
    saveFn.flush = save.flushSave;
    saveFn.soon = save.savePageSoon;
    clay.save = saveFn;
  }
  // The close warning's own predicate, reachable without a capture. It falls back to
  // false rather than to absent: the module is edit-only, and a document that cannot
  // save has nothing unsaved. Older clayjs has no such member, and that is the answer
  // a host feature-detects.
  clay.hasUnsavedChanges = loaded["core/unsaved-warning.js"]?.hasUnsavedChanges ?? (() => false);
  if (snapshot) {
    clay.getHTML = snapshot.getPageContents;
    clay.addDocumentTransform = snapshot.addDocumentTransform;
    clay.onSnapshot = snapshot.onSnapshot;
  }
  if (cacheBustMod) {
    clay.cacheBust = cacheBustMod.default;
  }
  clay.morph = (oldEl, newEl, options) => mergeEngine().then(({ morph }) => morph(oldEl, newEl, options));

  // Edit mode only, and absent entirely in view mode: a reader has nothing to
  // recover and must never open the database. The facade is here; the store behind
  // it arrives when the page's first adapter registers a channel.
  const recoveryMod = loaded["core/recovery.js"];
  if (recoveryMod) clay.recovery = recoveryMod.recovery;
}

function attachPluginMember(path, mod, loaded) {
  const clay = window.clay;

  if (path === "plugins/undo.js") {
    clay.undo = mod.undo || mod.default;
  } else if (path === "plugins/unsent.js") {
    clay.unsent = mod.unsent;
  } else if (path === "sync/live-sync.js") {
    clay.morph = mod.morph;
    clay.conflicts = mod.conflicts;
    loaded["core/page-data.js"].setPageDataLiveSync(mod.liveSync);
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
  } else if (path === "plugins/source.js") {
    clay.source = mod.source || mod.default;
  } else if (path === "plugins/visitor-drafts.js" || path === "plugins/visitor-drafts-owner.js") {
    clay.visitorDrafts = mod.visitorDrafts;
  } else if (path === "plugins/bind-text.js") {
    clay.bindText = mod.bindText;
  }
}

function installViewModeNotice(isEditMode) {
  if (isEditMode) return;
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("[trigger-save]")) return;
    console.info("clayjs: you're not the owner of this page; changes stay local");
    document.dispatchEvent(new CustomEvent("clay:view-save-attempt"));
  });
}
