import { FEATURES, featureForNode, featureForType } from "../page/features/registry.js";
import { mergeEngine } from "../sync/merge-engine.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";
import { hostMeta } from "../core/host-meta.js";
import { savePageForce, holdAllSaves, releaseAllSaves, suspendAutosave, resumeAutosave, getLastSavedBytes, savesAdmitted } from "../core/save.js";
import { setSaveHeader, onSaveAccepted } from "../core/save-core.js";
import { lastSeenEtag, representedEtag, recordEtag } from "../core/etag.js";
import { captureForSaveAndComparison } from "../core/snapshot.js";
import { storeOf, stageStore, closeStore, checkpointWithin, requestCheckpoint, requestExitCheckpoint, fastLane, localLane, lanePending, pageLaneReady, pageWriterReady, registerPageCheckpoints } from "./live.js";
import { serializeLive } from "../live/ops.js";
import { parseJsonRelaxed } from "../vendor/hyper-morph-json.vendor.js";
import { saveStateFor, pageStateFor, BLOCKED_TEXT, RETRY_TEXT, downloadPageCopy, downloadSnapshot, copyPageText } from "../page/save-states.js";
import toast, { toastPersistent, dismissPersistent } from "../ui/toast-lazy.js";
import { claim } from "../page/runtime-owner.js";
import { authorIdentity } from "../page/ybind/author.js";
import { createInstall, disposeInstall, addDisposer, finishError, isCurrent, ownsView, runBoot, activateInput } from "../page/boot.js";
import { capabilityAdvertised } from "../page/tool-capability.js";
import { startsAtImport } from "../core/is-edit-mode.js";
import { toolViews } from "../page/tool-views.js";
import { style } from "../lib/hostile-css.js";

const ARTICLE_SEL = "article[data-page]";
const TAG_SEL = 'script[type="application/json"][merge="page"][clay~="live"]';
const BLOCKED = { state: "blocked", code: "unsupported-host", message: "This host does not support page editing" };
const STORE_TEXT = "Changes cannot be stored on this device. Download a copy to keep them.";
const RETRY_BOUND_MS = 45000;
const GENERIC_ERROR = "Couldn't save";
const GENERIC_OFFLINE = "Offline, not saved";
const REPLACED_TEXT = "This page was changed outside the editor. Reload to see it.";
const TOO_LARGE_TEXT = "That change is too large to share, so it was not saved. Reload the page to keep editing.";
export const PAGE_FULL_MESSAGE = "This page is full. Your recent changes are kept here; delete some content to keep editing.";
const OVERWRITTEN_TEXT = "Some changes you made were replaced by a change made outside the editor.";
const REPLACED_HOLD = "The page was changed outside the editor; reload to see it.";
const LOADING_MS = 150;
const LOADING_TEXT = "Loading the editor\u2026";
// The hold a managed session keeps between preparation and its commit: no save, no
// checkpoint and no live frame of this tab's reaches the file while the mode is still
// view. Released without replay, because a save missed here belongs to no session.
const SESSION_HOLD = "the page session has not committed yet";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A tag that is not a page this release reads. It is decided from the JSON alone, so a
// page that cannot be booted says so without the page's own code.
function unreadablePage(value) {
  if (!isPlainObject(value)) {
    console.warn("clayjs: page plugin: the page tag is not JSON, leaving the page as saved HTML");
    return "invalid-page-json";
  }
  if (value.v !== 1 || !isPlainObject(value.y) || Object.hasOwn(value, "blocks") || Object.hasOwn(value, "deleted")) {
    console.warn("clayjs: page plugin: the page tag is not a strict Yjs page, leaving the page as saved HTML");
    return "unsupported-page-format";
  }
  return null;
}

// The page's own code reaches ProseMirror and Yjs, so it is a separate download: the
// plugin chunk evaluates without either vendor, and the room join starts while it
// arrives. Every step that needs it awaits the one boot-pack import, which carries the
// page code and the parts they share in one static graph, so a module they share is
// never linked by two imports at once; the pack starts the editor's own download
// beside it. A step that needs it awaits pageCodeReady(); the synchronous paths read
// pageCode, which the boot has awaited before the room's state reaches them.
let pageCode = null;
let pageCodeLoading = null;
function pageCodeReady() {
  pageCodeLoading ??= import("../page/boot-pack.js").then((pack) => (pageCode = pack));
  return pageCodeLoading;
}

// The parts a document asks for, read off the document itself: the state a view holds
// can have gained a block the saved article never had, from the room or from an
// adoption, and input waits for those parts as it does for the saved article's.
function docFeatureIds(doc) {
  const ids = new Set();
  doc.forEach((node) => {
    const id = featureForNode(node);
    if (id) ids.add(id);
  });
  return [...ids];
}

// A wait longer than a moment says so. One quiet line inside the article, drawn as
// editor UI so it never reaches a snapshot, and gone the moment the boot settles.
function clearLoadingStatus(inst) {
  if (inst.statusTimer) {
    clearTimeout(inst.statusTimer);
    inst.statusTimer = null;
  }
  inst.statusNote?.remove();
  inst.statusNote = null;
}

function armLoadingStatus(inst, article) {
  clearLoadingStatus(inst);
  inst.statusTimer = setTimeout(() => {
    inst.statusTimer = null;
    if (!isCurrent(inst)) return;
    const note = article.ownerDocument.createElement("div");
    note.className = "page-boot-status";
    note.setAttribute("clay", "editor-ui");
    note.setAttribute("sap-ignore", "");
    note.setAttribute("role", "status");
    style(note, [
      "display:block", "margin:0 0 1em", "font:500 13px/1.6 system-ui, sans-serif",
      "color:color-mix(in srgb, currentColor 55%, transparent)", "user-select:none",
    ]);
    note.textContent = LOADING_TEXT;
    article.prepend(note);
    inst.statusNote = note;
  }, LOADING_MS);
}

let generation = 0;
let active = null;
// A boot that ends in error says so after the installation it ended is gone, so the
// result outlives the dispose that releases what that boot started.
let ended = null;

// Shorter than installAdoption's 10 s hold, so an unelected room still adopts.
export const WRITER_WAIT_MS = 8_000;

function scrollToHashBlock(view, loc = globalThis.location) {
  const raw = loc?.hash?.slice(1);
  if (!raw) return;
  let id;
  try { id = decodeURIComponent(raw); } catch { return; }
  let found = -1;
  view.state.doc.forEach((node, pos) => { if (found < 0 && node.attrs.id === id) found = pos; });
  if (found < 0) return;
  globalThis.requestAnimationFrame?.(() => view.nodeDOM(found)?.scrollIntoView?.({ block: "start" }));
}

function dispatchState(state, code = null, message = "") {
  document.dispatchEvent(new CustomEvent("clay:page-save-state", { detail: { state, code, message } }));
}

function dismissGeneric() {
  dismissPersistent(GENERIC_ERROR);
  dismissPersistent(GENERIC_OFFLINE);
}

function clearRetry(inst) {
  if (inst.retryTimer) {
    clearTimeout(inst.retryTimer);
    inst.retryTimer = null;
  }
  inst.retryShown = false;
  dismissPersistent(RETRY_TEXT);
}

function armRetry(inst, code, message) {
  dismissGeneric();
  dispatchState("retrying", code, message);
  // One clock for a run of temporary failures: a later retry of the same save
  // does not push the bound out again, and once it has passed the toast stands.
  if (inst.retryTimer || inst.retryShown) return;
  inst.retryTimer = setTimeout(() => {
    inst.retryTimer = null;
    inst.retryShown = true;
    toastPersistent(RETRY_TEXT, "warning");
  }, RETRY_BOUND_MS);
}

// The persistent save-state toasts a session raises, taken down together: at the page's
// own teardown the fade plays, and at a session's end, where nobody is left to read it,
// the nodes go now.
function dismissSaveStateToasts(inst, now = false) {
  if (inst.retryTimer) {
    clearTimeout(inst.retryTimer);
    inst.retryTimer = null;
  }
  dismissPersistent(RETRY_TEXT, { now });
  dismissPersistent(BLOCKED_TEXT, { now });
  dismissPersistent(STORE_TEXT, { now });
}

function showBlocked(inst, code, message, state = "blocked") {
  clearRetry(inst);
  dismissGeneric();
  dispatchState(state, code, message);
  toastPersistent(state === "unavailable" ? STORE_TEXT : BLOCKED_TEXT, "error", {
    detail: message,
    actions: [
      { label: "Download a copy", onClick: downloadPageCopy },
      { label: "Copy text", onClick: copyPageText },
    ],
  });
}

function showSaved(inst) {
  clearRetry(inst);
  dismissPersistent(BLOCKED_TEXT);
  dismissPersistent(STORE_TEXT);
  dispatchState("saved", null, "");
}

// An incoming document with no page tag whose article is not the one this tab
// last saved: something outside the editor replaced the page, and this tab's
// state no longer belongs to the file.
// On a host that keeps no page data every file comes untagged and is merged
// instead (adopt-boot.js); only a file with no lone article replaced the page.
function pageReplaced(html, savedRev, mergeTagless = false) {
  if (typeof html !== "string" || !html) return false;
  let doc;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return false; }
  const articles = doc.querySelectorAll(ARTICLE_SEL);
  if (mergeTagless) return articles.length !== 1 && !doc.querySelector(TAG_SEL);
  if (articles.length !== 1 || doc.querySelector(TAG_SEL)) return false;
  return articles[0].getAttribute("data-rev") !== savedRev;
}

function savedRevOf(inst) {
  if (!inst.store || !pageCode) return inst.savedRev;
  try { return pageCode.renderFromTags([JSON.stringify(inst.store.value)]).rev; } catch { return inst.savedRev; }
}

// Nothing of this tab's may reach the file again: the editor is read-only, the
// binding is detached from the store (no frame, no flush), and every save is
// held, so the old article cannot be written back over the replacement.
function stopEditing(inst) {
  const view = inst.view;
  if (view) {
    view.setProps({ editable: () => false });
    view.setProps({ dispatchTransaction: (tr) => view.updateState(view.state.apply(tr)) });
  }
  try { inst.binding?.dispose(); } catch (error) { console.error("clayjs: page plugin binding failed to dispose", error); }
  if (inst.savesHeld) return;
  inst.savesHeld = true;
  holdAllSaves(REPLACED_HOLD);
}

// The tab's own page, when the store no longer holds it (another page replaced it, or the
// room refused it): the saved document with the article rendered from the tab's document.
function downloadTabCopy(inst) {
  if (!inst.tabValue) return downloadPageCopy();
  const { forSave } = captureForSaveAndComparison({ emitForSync: false });
  const doc = new DOMParser().parseFromString(forSave, "text/html");
  const articles = doc.querySelectorAll(ARTICLE_SEL);
  if (articles.length !== 1) return downloadPageCopy();
  const rendered = pageCode.renderFromTags([JSON.stringify(inst.tabValue)]);
  articles[0].innerHTML = rendered.html;
  if (rendered.rev == null) articles[0].removeAttribute("data-rev");
  else articles[0].setAttribute("data-rev", rendered.rev);
  return downloadSnapshot(`<!DOCTYPE html>\n${doc.documentElement.outerHTML}`);
}

function stopWithNotice(inst, text) {
  if (inst.replaced) return;
  inst.replaced = true;
  stopEditing(inst);
  toastPersistent(text, "warning", {
    actions: [
      { label: "Reload", onClick: () => window.location.reload() },
      { label: "Download your copy", onClick: () => downloadTabCopy(inst) },
    ],
  });
}

const showReplaced = (inst) => stopWithNotice(inst, REPLACED_TEXT);
const showTooLarge = (inst) => stopWithNotice(inst, TOO_LARGE_TEXT);
const showFull = (inst, code) => {
  dispatchState("blocked", code, PAGE_FULL_MESSAGE);
  stopWithNotice(inst, PAGE_FULL_MESSAGE);
};

function applySaveState(inst, state, code, message) {
  if (state === "saved") showSaved(inst);
  else if (state === "retrying") armRetry(inst, code, message);
  else if (state === "blocked") showBlocked(inst, code, message);
}

function listen(inst, type, handler) {
  document.addEventListener(type, handler);
  inst.listeners.push([type, handler]);
}

function listenForSaves(inst) {
  listen(inst, "clay:save-error", (event) => {
    const code = event.detail?.code ?? null;
    // The host holds exactly what this tab would have written: nothing to report.
    if (code === "page-nothing-to-write") return;
    applySaveState(inst, saveStateFor({ code }), code, event.detail?.msg ?? "");
  });
  listen(inst, "clay:save-offline", (event) => {
    const code = event.detail?.code ?? null;
    applySaveState(inst, saveStateFor({ code, offline: true }), code, event.detail?.msg ?? "");
  });
  listen(inst, "clay:save-conflict", (event) => {
    const code = event.detail?.code ?? null;
    applySaveState(inst, saveStateFor({ code }), code, event.detail?.msg ?? "");
  });
  const onRefusedFirstWrite = (event) => { retryFirstWrite(inst, event); };
  listen(inst, "clay:save-conflict", onRefusedFirstWrite);
  listen(inst, "clay:save-error", onRefusedFirstWrite);
  listen(inst, "clay:save-saved", (event) => {
    applySaveState(inst, saveStateFor({ ok: true }), null, event.detail?.msg ?? "");
    inst.savedRev = savedRevOf(inst);
    inst.adoption?.saved(getLastSavedBytes());
  });
  listen(inst, "clay:live-notice", (event) => {
    if (event.detail?.name !== "page") return;
    if (event.detail?.code === "op-too-large") return;
    if (event.detail?.code === "unknown-store") {
      showReplaced(inst);
      return;
    }
    const code = event.detail?.code ?? null;
    applySaveState(inst, saveStateFor({ code }), code, event.detail?.message ?? "");
  });
}

// The page the host stores now, including any merge state it keeps beside the file.
async function readStoredArticle() {
  const response = await fetch(new URL(globalThis.location.href).href, { cache: "no-store" });
  if (!response?.ok) return null;
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = doc.querySelector(ARTICLE_SEL);
  if (!article) return null;
  const tag = doc.querySelector(TAG_SEL);
  return { article, value: tag ? parseJsonRelaxed(tag.textContent) : null, etag: response.headers?.get?.("etag") || null };
}

// A refused first write: the stored document has moved on, or it does not descend
// from the seed this tab staged. The stored document is read once, its merge state is
// kept (or seeded from the article), this tab's pending edit replays over it, and the write goes
// out once more against the version just read. A second refusal keeps the text in the
// tab and shows the conflict, exactly as a lone refusal does.
async function retryFirstWrite(inst, event) {
  const staged = inst.staged;
  if (!staged || inst.staleRetry || inst.replaced) return;
  const refusal = event?.detail?.code ?? null;
  if (refusal !== "page-lineage-stale" && refusal !== "conflict") return;
  if (!inst.store || !staged.isPending()) return;
  inst.staleRetry = true;
  try {
    const found = await readStoredArticle();
    if (!found || !isCurrent(inst)) return;
    const page = await pageCodeReady();
    if (!isCurrent(inst)) return;
    const seed = found.value ?? page.seedPageFromArticle(found.article.cloneNode(true));
    // This tab's next write is conditional on the version it has just read.
    const at = found.etag ?? event?.detail?.etag ?? null;
    if (at) recordEtag(at);
    // The tab's own edit replays over the stored page state; an op the
    // stored article cannot hold is dropped by the store, never written over it.
    inst.store.rebase(seed, { source: "state" });
    await savePageForce();
  } catch (error) {
    console.warn("clayjs: page plugin could not offer the refused first write again", error);
  }
}

function restoreArticle(inst) {
  const article = inst.article;
  if (!article) return;
  let html = inst.bootHtml;
  let rev = inst.bootRev;
  if (inst.store && pageCode) {
    try {
      const rendered = pageCode.renderFromTags([JSON.stringify(inst.store.value)]);
      html = rendered.html;
      rev = rendered.rev;
    } catch (error) {
      console.error("clayjs: page plugin could not render the saved article", error);
    }
  }
  article.innerHTML = html;
  if (rev == null) article.removeAttribute("data-rev");
  else article.setAttribute("data-rev", rev);
}

// What a mounted editor installs besides its view: the document listeners that
// follow saves and replacements, the room's subscription to it, its unsaved
// participant, the recovery list, the tool views and this install's claim on the
// article. A boot that ends without an editor releases the same resources here, so
// nothing stays wired to a view that is gone.
function releaseMounted(inst) {
  for (const [type, handler] of inst.listeners) document.removeEventListener(type, handler);
  inst.listeners = [];
  try { inst.adoption?.dispose(); } catch (error) { console.error("clayjs: page plugin adoption failed to dispose", error); }
  inst.adoption = null;
  try { inst.recover?.destroy(); } catch (error) { console.error("clayjs: page plugin recover list failed to dispose", error); }
  inst.recover = null;
  inst.aiTool?.dispose();
  inst.aiTool = null;
  inst.awareness?.dispose();
  inst.awareness = null;
  inst.toolHost?.dispose();
  inst.toolHost = null;
  if (inst.view) toolViews.delete(inst.view);
  if (inst.article) {
    const shell = inst.article.querySelector(".page-shell");
    if (shell) shell.remove();
  }
  try { inst.binding?.dispose(); } catch (error) { console.error("clayjs: page plugin binding failed to dispose", error); }
  try { inst.binding?.ydoc?.destroy(); } catch (error) { console.error("clayjs: page plugin document failed to destroy", error); }
  try { inst.staged?.close(); } catch (error) { console.error("clayjs: page plugin staged store failed to close", error); }
  inst.staged = null;
  if (inst.pageStore) {
    try { closeStore("page", inst.pageStore); } catch (error) { console.error("clayjs: page plugin store failed to close", error); }
    inst.pageStore = null;
  }
  inst.binding = null;
  inst.flush = null;
  inst.releaseArticle?.();
  inst.releaseArticle = null;
}

// Adoption did not land, so this tab must not hold a view of its own making: the
// mounted editor and everything it subscribed are released, its shell leaves the
// article, and the article comes back from the state the room accepted (or the
// source captured before the mount). The editor's own DOM is never read back into
// the page.
function abandonEditor(inst) {
  const view = inst.view;
  if (view && !view.isDestroyed && typeof view.destroy === "function") {
    try { view.destroy(); } catch (error) { console.error("clayjs: page plugin view failed to destroy", error); }
  }
  inst.titleObserver?.dispose();
  inst.titleObserver = null;
  clearLoadingStatus(inst);
  releaseMounted(inst);
  restoreArticle(inst);
}

function dispose() {
  generation += 1;
  const inst = active;
  active = null;
  setSaveHeader("Page-Write", null);
  registerPageCheckpoints(null);
  if (!inst) return;
  disposeInstall(inst);
  dismissSaveStateToasts(inst);
  dismissPersistent(REPLACED_TEXT);
  for (const message of inst.notices?.values() ?? []) dismissPersistent(message);
  if (inst.savesHeld) {
    inst.savesHeld = false;
    releaseAllSaves({ replay: false, reason: REPLACED_HOLD });
  }
  inst.titleObserver?.dispose();
  inst.titleObserver = null;
  clearLoadingStatus(inst);
  // A session torn down from here rather than by its own lease gives back the holds
  // it took, so nothing it closed stays closed.
  if (inst.sessionHeld) releaseAllSaves({ replay: false, reason: SESSION_HOLD });
  if (inst.autosaveSuspended) resumeAutosave();
  if (inst.view && !inst.view.isDestroyed) {
    try { inst.view.destroy(); } catch (error) { console.error("clayjs: page plugin view failed to destroy", error); }
  }
  releaseMounted(inst);
  restoreArticle(inst);
}

// The page's journal, its replay and the proof that retires it, all imported the first
// time a page can actually journal: a reader, a page without a pinned identity and a host
// with no recovery service pay for none of it.
let recoveryModules = null;

function pageRecovery() {
  if (!recoveryModules) {
    recoveryModules = Promise.all([
      import("../page/ybind/recovery-replay.js"),
      import("../page/checkpoint-proof.js"),
      import("../page/recovery-ui.js"),
    ])
      .then(([replay, proof, ui]) => ({ replay, proof, ui }))
      .catch((error) => {
        console.warn("clayjs: page journal could not load", error);
        return null;
      });
  }
  return recoveryModules;
}

// What this session journals under, or null when this page cannot pin an identity or this
// host has no recovery service: the document is then edited with no local copy, as before.
async function openJournal(meta, store) {
  const service = globalThis.window?.clay?.recovery ?? null;
  if (!service || !store) return null;
  const modules = await pageRecovery();
  if (!modules) return null;
  try {
    return modules.replay.openPageJournal({
      meta,
      service,
      base: modules.replay.journalBase(store.value),
    });
  } catch (error) {
    console.warn("clayjs: page journal could not open", error);
    return null;
  }
}

// Replay once, after the authority snapshot is adopted and before input starts. A capsule
// this page may not replay is kept and named for review; nothing of it is applied.
async function replayJournal(inst) {
  const journal = inst.binding?.journal;
  if (!journal || !inst.store) return { replayed: [], review: [] };
  const modules = await pageRecovery();
  if (!modules) return { replayed: [], review: [] };
  const outcome = await modules.replay.replayInto({ journal, state: inst.store.value, into: inst.binding.ydoc });
  // The recovered page is this tab's page now: it is offered to the room exactly as an
  // edit would be, and it is not one more journal and not one giant undo step.
  installJournalStatus(inst, modules);
  if (outcome.replayed.length) inst.binding.provider.settle();
  if (outcome.review.length) inst.recoveryReview = outcome.review;
  installRecoveryReview(inst, modules.ui)?.update({ rows: modules.replay.describeReview(outcome.review) });
  return outcome;
}

// The review of what this page may not replay, drawn in the editor's own chrome once per
// session, with the composition shadow that keeps typing which never became a
// transaction: one object, alive exactly as long as the session that mounted it.
function installRecoveryReview(inst, ui) {
  if (inst.recoveryPanel) return inst.recoveryPanel;
  const view = inst.view;
  const mount = view?.dom.closest(".page-shell") ?? inst.article;
  if (!mount) return null;
  const review = ui.createRecoveryReview({
    mount,
    getView: () => (inst.view && !inst.view.isDestroyed ? inst.view : null),
    getJournal: () => inst.binding?.journal ?? null,
    isCurrent: () => isCurrent(inst) && inst.inputOpen && !!inst.view && !inst.view.isDestroyed,
  });
  const detach = review.watch(view?.dom ?? null);
  addDisposer(inst, () => {
    detach();
    review.destroy();
  });
  inst.recoveryPanel = review;
  return review;
}

// One accepted save retires the records a proof covers, and no others.
function installCheckpointProof(inst) {
  registerPageCheckpoints(async ({ capture, state, article, etag }) => {
    const journal = inst.binding?.journal;
    if (!journal) return;
    const modules = await pageRecovery();
    const context = modules ? await journal.context() : null;
    if (!context) return;
    // Where this host serves the page state, if it serves one at all: asked here, because
    // a page that journals nothing never needs the answer.
    const { hostPageStateHref } = await import("../core/host-meta.js");
    const answer = await modules.proof.checkpointAccepted({
      channel: journal.channel,
      records: journal.records(),
      capture,
      accepted: context,
      article,
      state,
      etag,
      href: await hostPageStateHref(),
    });
    if (!answer.ok) return;
    journal.retire(answer.retired);
    inst.pageStatus?.checkpoint();
    await journal.rebase?.(modules.replay.journalBase(answer.proof.state));
  });
}

// Both live in the journal's module, which a page without a journal never loads.
function installJournalStatus(inst, modules) {
  const journal = inst.binding?.journal;
  if (!journal || inst.pageStatus) return inst.pageStatus ?? null;
  inst.pageStatus = modules.replay.watchJournal({
    journal,
    store: inst.store,
    reduce: pageStateFor,
    onState: (state) => dispatchState(state),
    onUnavailable: (code) => showBlocked(inst, code, "", "unavailable"),
  });
  addDisposer(inst, () => inst.pageStatus?.dispose());
  return inst.pageStatus;
}

export function createSteps(inst, options) {
  let meta = null;
  let binding = null;
  let editorView = null;
  let editorReadyResolve = null;
  let identity = null;
  let features = null;
  let featuresReady = null;
  let savedContent = [];
  let toolsStore = null;
  let aiTool = null;
  let toolsOpening = null;
  let chrome = null;
  let setEditorActive = null;

  // The view parts install onto the editor, which exists only after the mount; an
  // install that starts before it waits here, and a disposed install releases it.
  const editorReady = new Promise((resolve) => { editorReadyResolve = resolve; });
  inst.editorReadyResolve = editorReadyResolve;
  addDisposer(inst, () => editorReadyResolve?.());
  addDisposer(inst, () => clearLoadingStatus(inst));

  // The format gate, fetched when a newer-format command first asks for it: neither
  // the gate nor its host adapter is on the editor's ready path. One gate per session,
  // built against this editor installation, and disposed with the editor.
  let formatGate = null;
  let formatGateLoading = null;
  inst.loadFormatGate = () => {
    if (formatGate) return Promise.resolve(formatGate);
    formatGateLoading ??= Promise.all([import("../page/format-gate.js"), import("../page/format-host.js")])
      .then(([{ createFormatGate }, { createFormatHost }]) => {
        const host = createFormatHost();
        formatGate = createFormatGate({
          host,
          supported: host.supported,
          installed: () => identity?.token ?? null,
          revision: () => null,
          // A floor rise moves this tab to the lane scope of the format it now
          // writes, so a tab that cannot read that format never shares it. The
          // transport is this tab's to create, on its own schedule, so the gate
          // asks for it by the move rather than by the object.
          lane: {
            switchScope: (next, options) => {
              const transport = localLane();
              if (!transport) return { status: "refused", code: "lane-unavailable" };
              return transport.switchScope(next, { ...options, covered: Boolean(options?.covered) || !lanePending() });
            },
          },
        });
        return formatGate;
      })
      .catch((error) => {
        formatGateLoading = null;
        throw error;
      });
    return formatGateLoading;
  };

  // A document with a tool block, at boot or when one arrives, opens the store its
  // tools keep state in and the host that mounts them. A document with no tool
  // never waits for either.
  const TOOLS_SEL = 'script[type="application/json"][merge="page.tools"][clay~="live"]';
  const openTools = () => {
    if (toolsOpening) return toolsOpening;
    toolsOpening = (async () => {
      // A tool written into the article by hand or by an agent arrives without the
      // store its state lives in, and without one the tool could not keep its state:
      // the page gets the empty store an editor-made page starts with.
      if (!document.querySelector(TOOLS_SEL)) {
        const tools = document.createElement("script");
        tools.setAttribute("type", "application/json");
        tools.setAttribute("merge", "page.tools");
        tools.setAttribute("clay", "live");
        tools.textContent = "{}";
        document.head.appendChild(tools);
      }
      if (document.querySelector(TOOLS_SEL)) {
        try {
          toolsStore = window.clay.live("page.tools");
          await toolsStore.ready;
        } catch (error) {
          console.warn("clayjs: page plugin could not open the tool store", error);
        }
      }
      if (!isCurrent(inst)) return null;
      const [{ createToolHost }, { tablesFromDoc }] = await Promise.all([
        import("../page/tools.js"),
        import("../page/tool-data.js"),
      ]);
      if (!isCurrent(inst)) return null;
      const toolHost = createToolHost({
        store: toolsStore, mode: "edit",
        tables: () => tablesFromDoc(editorView?.state.doc ?? binding.doc()).map(({ id, cols, rows }) => ({ id, cols, rows })),
      });
      inst.toolHost = toolHost;
      if (capabilityAdvertised(meta)) {
        const { createAiTool } = await import("../page/ai-tool.js");
        if (!isCurrent(inst)) return null;
        const transport = window.clay?.wire?.pageTool ?? options.transport ?? null;
        aiTool = createAiTool({ getView: () => inst.view, store: toolsStore, transport, acceptState: options.acceptState });
        inst.aiTool = aiTool;
      }
      return toolHost;
    })().catch((error) => {
      toolsOpening = null;
      throw error;
    });
    return toolsOpening;
  };
  // One notice per feature a person needed and that failed, until Retry succeeds.
  const notices = new Map();
  const notifyFailed = (id) => {
    if (notices.has(id)) return;
    const message = `The ${id} controls could not load. Reload the page after saving.`;
    notices.set(id, message);
    toastPersistent(message, "warning", {
      actions: [{
        label: "Retry",
        onClick: () => {
          features.ensure(id).then(() => {
            const open = notices.get(id);
            if (!open) return;
            notices.delete(id);
            dismissPersistent(open);
          }, () => {});
        },
      }],
    });
  };
  inst.notices = notices;
  // Making or revising a tool opens the store and the host first, so the panel
  // keeps what it makes.
  const openAi = async ({ target = null, remove = null } = {}) => {
    if (chrome && editorView && remove) chrome.holdSlashRange(editorView, remove);
    await features.ensure("tool").catch(() => {});
    if (!isCurrent(inst) || !aiTool || !editorView) return;
    aiTool.open({ target, remove: remove ? chrome.heldSlashRange(editorView.state) : null });
  };
  const aiRequested = () => capabilityAdvertised(meta);

  // The article, its page tag and the file they describe, or the reason the page
  // is not edit mode's to mount. The file it found is captured here, before anything
  // moves; what the tag decodes to is the page's own code's to say, so it arrives in
  // source.ready while the room joins, and the join never waits for it.
  function readSource(inst) {
    const liveArticles = document.querySelectorAll(ARTICLE_SEL);
    // The file the reader represents, when there is one, states the page this session
    // edits; the live DOM is only the page an explicit edit boot found.
    const represented = typeof inst.context?.represented?.bytes === "string"
      ? new DOMParser().parseFromString(inst.context.represented.bytes, "text/html")
      : null;
    const articles = represented ? represented.querySelectorAll(ARTICLE_SEL) : liveArticles;
    const tags = represented ? represented.querySelectorAll(TAG_SEL) : document.querySelectorAll(TAG_SEL);
    if (!articles.length && !tags.length) return { ok: false, reason: "no-page" };
    // A page saved without its merge state (HTML Clay, an outside edit, a download)
    // is booted from its article alone: the seed is deterministic, so every tab
    // rebuilding the same article holds the same state and their edits merge. The tag
    // that states it is built here but reaches the document only for the first save
    // that writes it, so a boot that ends before that save leaves no tag behind for
    // the next install to read as a page the file already has.
    const seeded = articles.length === 1 && tags.length === 0;
    if (articles.length !== 1 || (!seeded && tags.length !== 1)) {
      console.warn(`clayjs: page plugin needs exactly one article[data-page] and one merge="page" live tag; found ${articles.length} article(s) and ${tags.length} tag(s), leaving the page as saved HTML`);
      return { ok: false, reason: "ambiguous-page" };
    }
    const element = liveArticles[0];
    if (!element) return { ok: false, reason: "no-page" };
    // The file the reader represented is the page this session edits: its tag and the
    // article the seed is built from come off those bytes once, so a tag another tab
    // changed and a reader's own local state cannot reach what is staged. The live
    // article stays the node the editor mounts over.
    const seedNode = articles[0];
    const tagNode = tags[0];
    // A tag this tab can read on its own is read here, so a page it cannot boot says so
    // before the room is opened.
    let value = null;
    if (!seeded) {
      try { value = parseJsonRelaxed(tagNode?.textContent); } catch (error) { value = null; }
      const unreadable = unreadablePage(value);
      if (unreadable) return { ok: false, reason: unreadable };
    }
    const source = { article: seedNode.cloneNode(true), tags: value ? [value] : null, element, blocks: null, seeded, seedValue: null };
    source.ready = (async () => {
      const code = await pageCodeReady();
      if (!isCurrent(inst)) return { ok: false, cancelled: true };
      if (seeded) {
        try {
          const meta = await hostMeta();
          const href = meta?.extensions?.includes("page-recovery-v1") && meta.document?.pageState?.href;
          const etag = inst.context?.represented ? inst.context.represented.etag : representedEtag() ?? lastSeenEtag();
          if (href && etag) {
            const { readPageState } = await import("../page/checkpoint-proof.js");
            const stored = await readPageState({ href, etag });
            if (!isCurrent(inst)) return { ok: false, cancelled: true };
            if (stored.ok) {
              if (stored.etag !== etag) return { ok: false, reason: "etag-mismatch" };
              value = parseJsonRelaxed(stored.tag);
              source.persisted = true;
            } else if (stored.code !== "no-page-state") {
              return { ok: false, reason: stored.code };
            }
          } else if (href) {
            const stored = await readStoredArticle();
            if (!isCurrent(inst)) return { ok: false, cancelled: true };
            if (!stored || !stored.article.isEqualNode(source.article)) return { ok: false, reason: "stale-document" };
            value = stored.value;
            source.persisted = value !== null;
          }
          value = source.seedValue = value ?? code.seedPageFromArticle(source.article.cloneNode(true));
        } catch (error) {
          console.warn("clayjs: page plugin could not rebuild the page it found, leaving the page as saved HTML", error);
          return { ok: false, reason: "invalid-page-source" };
        }
        const unreadable = unreadablePage(value);
        if (unreadable) return { ok: false, reason: unreadable };
        source.tags = [value];
      }
      try {
        source.blocks = code.blocksFromYValue(value);
      } catch (error) {
        console.warn("clayjs: page plugin: the page tag is not a valid Yjs page, leaving the page as saved HTML", error);
        return { ok: false, reason: "invalid-page-json" };
      }
      return { ok: true };
    })();
    armLoadingStatus(inst, element);
    return { ok: true, source };
  }

// The page store the session mounts, brought to the file the reader holds. A page store's
// value is a set of Yjs updates and this tab's own unsaved ops are updates of their own, so
// installing the file's value as the store's own leaves the unconfirmed work replayed over
// the page the file states; the binding that mounts next applies both sets in one Y
// document, which is the merge. False when the store cannot take the value, and the entry
// refuses rather than mounting a page the file does not state.
function mergeRepresentedPage(store, value) {
  if (unreadablePage(value)) return false;
  if (serializeLive(store.authoritative) === serializeLive(value)) return true;
  try {
    return store.rebase(value, { source: "state" });
  } catch (error) {
    console.warn("clayjs: page plugin could not reconcile the open page store with the saved file", error);
    return false;
  }
}

  // The page's own code, the editor it starts and the feature views the saved article
  // demands are separate downloads, and the page's own starts here beside the room join.
  // Nothing evaluates the editor until the coordinator calls it; the parts are
  // installed at the mount, so a failed one is the loader's own Retry notice there.
  async function loadEditorAssets(inst, source) {
    const codeImport = pageCodeReady();
    codeImport.catch(() => null);
    const read = await source.ready;
    if (!read.ok) return read;
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    const code = await codeImport;
    const featureIds = [...new Set(Object.values(source.blocks).map((block) => featureForType(block.t)).filter(Boolean))];
    features = code.createFeatureLoader({
      load: (id) => FEATURES[id].load(),
      install: async (id, mod) => {
        if (!editorView) await editorReady;
        if (!isCurrent(inst) || !editorView) return null;
        const context = { view: editorView, upload: options.upload, board: binding.board, undo: binding.undo, redo: binding.redo, revise: aiRequested() ? (toolId, rev) => { openAi({ target: { toolId, rev } }); } : null };
        if (id === "tool") {
          context.toolHost = await openTools();
          if (!isCurrent(inst)) return null;
        }
        return editor.installPageFeature(context, id, mod);
      },
      reportError: (error, id) => {
        console.error("clayjs: an editor feature failed to load", error);
        notifyFailed(id);
      },
    });
    // The fetch only warms the module: the install waits for the mounted view, and the
    // boot waits for that install before it enables input. A failure here is reported
    // by that install, which offers the feature's Retry.
    for (const id of featureIds) features.prepare(id).catch(() => null);
    let editor = null;
    try {
      editor = await import("../page/editor.js");
      setEditorActive = editor.setEditorActive;
      chrome = { holdSlashRange: code.holdSlashRange, heldSlashRange: code.heldSlashRange };
    } catch (error) {
      // A host that blocked the download keeps the saved article and reads this reason.
      console.error("clayjs: page plugin could not load the editor", error);
      return { ok: false, reason: "editor-assets-failed" };
    }
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    return { ok: true, editor: editor.createPageEditor, refreshView: editor.refreshMountedView, featureIds, code };
  }

  async function prepareAuthority(inst, source) {
    // The page's own code, with the editor it starts and the parts they share, is one
    // download: it starts here, beside authority, and only a page that must rebuild
    // its tag waits for it before the join. Nothing else on this path touches a vendor.
    const codePromise = pageCodeReady();
    try { meta = await hostMeta(); } catch (error) { meta = null; }
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    if (!meta || !Array.isArray(meta.extensions) || !meta.extensions.includes("page")) {
      showBlocked(inst, BLOCKED.code, BLOCKED.message);
      return { ok: false, reason: "missing-capability" };
    }

    // A host that keeps no page data keeps its files untagged, and every one of them
    // is merged by the boot instead of being read as a replacement.
    inst.mergeTagless = !meta.extensions.includes("live-data");
    // The one declaration that lets a host answer a seed-only body with nothing-to-write.
    setSaveHeader("Page-Write", "v1");
    // A seeded page is the one boot whose join needs the page code, which rebuilds
    // the seed the article states.
    let read = null;
    let code = null;
    if (source.seeded) {
      read = await source.ready;
      if (!read.ok) return read;
      code = await codePromise;
      if (!isCurrent(inst)) return { ok: false, cancelled: true };
    }
    // A tagless document has no page store for a room to hold, so its own is staged:
    // the seed in memory and no write until a person edits. A tagged document opens
    // the state the file already has.
    let handle;
    // Whether this session's own value is the store's: only a store the application
    // opened itself keeps a page of its own.
    let ownsStore = true;
    try {
      if (source.seeded) {
        const staged = stageStore("page", {
          value: source.seedValue,
          represented: options.represented ?? { bytes: source.article.outerHTML, etag: representedEtag() ?? lastSeenEtag() },
          persisted: source.persisted,
        });
        inst.staged = staged;
        handle = staged.handle;
      } else {
        const opened = storeOf("page") === null;
        ownsStore = opened;
        handle = window.clay.live("page");
        if (opened) inst.pageStore = storeOf("page");
      }
    } catch (error) {
      console.warn("clayjs: page plugin could not open the page store", error);
      return { ok: false, reason: "missing-page-store" };
    }
    try {
      await handle.ready;
    } catch (error) {
      console.warn("clayjs: page plugin could not join the page room", error);
      return { ok: false, reason: "admission-failed" };
    }
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    // A tag the page's own code cannot decode is the boot's reason to stop, and both
    // branches report the same one, so whichever settles first does not change it.
    read ??= await source.ready;
    if (!read.ok) return read;
    // A store the application opened itself keeps the page it was opened from, and the
    // file the reader holds is the page this session edits: the store is brought to that
    // file before anything mounts on it, and a store that cannot take it refuses the
    // entry rather than mounting a page the file does not state. A store that has joined
    // a room is the exception: the room is newer than any file, and its value stands.
    const inRoom = storeOf("page")?.handle?.status?.mode === "fast";
    if (!ownsStore && !inRoom && !mergeRepresentedPage(storeOf("page"), source.tags?.[0])) {
      return { ok: false, reason: "stale-store" };
    }
    code ??= await codePromise;
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    const store = storeOf("page");
    if (!store) return { ok: false, reason: "missing-page-store" };
    inst.store = store;

    let flushFailed = false;
    let registered = null;
    const trackFlush = async (call) => {
      const result = await call();
      flushFailed = result?.ok === false;
      registered?.changed();
      return result;
    };
    identity = authorIdentity();
    // The journal is installed before the editor is enabled, and whether or not this tab
    // can reach the room: a refused offer, a lost room and an oversize update all leave
    // the work in a document that a crash must still be able to recover.
    const journal = await openJournal(meta, store);
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    binding = code.createYPageBinding({
      store,
      onStopped: (reason) => {
        inst.tabValue = code.yValueOf(binding.ydoc);
        if (reason === "lineage") {
          fastLane()?.abandon?.("page");
          showReplaced(inst);
        } else if (reason === "page-full" || reason === "compaction-failed") {
          showFull(inst, reason);
        } else {
          showTooLarge(inst);
        }
      },
      authorToken: identity.token,
      ownedTokens: identity.owned,
      checkpointWithin,
      requestCheckpoint,
      requestExitCheckpoint: (options) => requestExitCheckpoint({ name: store.name, ...options }),
      journal,
      // An exit holds admission closed, which is the only time this tab's own input
      // still owing the file holds the leave: outside one, the binding reports what it
      // always reported.
      exitClosed: () => !savesAdmitted(),
      registerUnsavedState: (def) => {
        registered = registerUnsavedState({
          id: def.id,
          isPending: () => flushFailed || def.isPending(),
          flush: (options) => trackFlush(() => def.flush(options)),
        });
        return registered;
      },
    });
    inst.binding = binding;
    if (journal) installCheckpointProof(inst);
    inst.flush = (options) => trackFlush(() => binding.flush(options));
    listenForSaves(inst);
    return { ok: true, store, handle };
  }

// Other people's carets arrive on their own: the decorations load only where a
// host offers page awareness, after the editor is mounted, so neither a reader nor
// an editor on a host without presence pays for them.
function installAwareness(inst, view) {
  import("../page/awareness.js").then(async (mod) => {
    if (inst.view !== view) return;
    const handle = await mod.installPageAwareness({ binding: inst.binding, view });
    if (!handle) return;
    if (inst.view !== view || view.isDestroyed) { handle.dispose(); return; }
    inst.awareness = handle;
  }).catch((error) => console.error("clayjs: page plugin remote carets failed to load", error));
}

function mountAndAttach(inst, source, loaded) {
    const article = source.element;
    // The reader that showed this article gives its claim up here and keeps its queue,
    // so a preparation that fails after this point hands the article back.
    inst.context?.reader?.yieldArticle?.();
    // The claim comes before this install records the article as its own to
    // restore: a claim another runtime holds is refused, and neither the owner's
    // article nor this install's restoration ownership may change.
    try {
      inst.releaseArticle = claim(article, "editor");
    } catch (error) {
      console.error("clayjs: page plugin could not claim the article", error);
      return { ok: false, reason: "article-owned" };
    }
    inst.source = source;
    inst.article = article;
    inst.bootHtml = source.article.innerHTML;
    inst.bootRev = source.article.getAttribute("data-rev");
    inst.savedRev = inst.bootRev;
    listen(inst, "clay:sync-applied", (event) => {
      if (inst.replaced) return;
      if (!pageReplaced(event.detail?.html, inst.savedRev, inst.mergeTagless)) return;
      showReplaced(inst);
    });

    // A page with blocks whose view parts are still coming keeps its saved article on
    // screen, and the editor out of sight, until they are here. One with none of those
    // blocks has nothing to wait for, so its saved article goes now. Either way it is
    // this capture, taken before anything changes, that puts the article back.
    savedContent = [...article.childNodes].filter((node) => node !== inst.statusNote);
    // The shell is built out of the page, in an element of the same document, so a
    // creation that fails never leaves half an editor over the saved article.
    const staging = article.ownerDocument.createElement("div");
    let view = null;
    try {
      view = loaded.editor(staging, {
        doc: binding.doc(),
        dispatch: binding.dispatch,
        history: false,
        undo: binding.undo,
        redo: binding.redo,
        board: binding.board,
        editable: false,
        features,
        onAiTool: aiRequested() ? (_view, remove) => { openAi({ remove }); } : null,
        reviseTool: aiRequested() ? (toolId, rev) => { openAi({ target: { toolId, rev } }); } : null,
        formatGate: inst.loadFormatGate,
      });
    } catch (error) {
      console.error("clayjs: page plugin could not mount the editor", error);
      staging.replaceChildren();
      inst.releaseArticle?.();
      inst.releaseArticle = null;
      inst.article = null;
      return { ok: false, reason: "mount-failed" };
    }
    editorView = view;
    inst.view = view;
    const shell = view.dom.closest(".page-shell");
    // A shell still waiting for its boot takes no input of any kind: a control inside
    // a non-editable editor would otherwise write before the boot says ready. It is
    // cleared at the one place input is enabled.
    if (shell) shell.inert = true;
    if (loaded.featureIds.length && shell) shell.style.visibility = "hidden";
    // One synchronous move: the finished shell replaces the saved surface as a
    // single change, and the article element itself stays where it is.
    if (!loaded.featureIds.length) for (const node of savedContent) node.remove();
    if (shell) article.appendChild(shell);
    loaded.refreshView?.(view);
    binding.attach(view);
    installAwareness(inst, view);
    editorReadyResolve();
    // The parts the saved article demands install onto the mounted view now, whether
    // their fetch already landed or is still on the wire; the saved article stays and
    // input stays off until they are in.
    featuresReady = Promise.allSettled(loaded.featureIds.map((id) => features.ensure(id)));
    scrollToHashBlock(view);
    inst.recover = loaded.code.createRecoverList({
      binding,
      mount: view.dom.closest(".page-shell") ?? article,
      ownTokens: [identity.token, ...identity.owned],
      onRestored: (id) => loaded.code.focusBlock(view, id),
      onStale: () => toast("That change was updated. The list now shows the latest version.", "warning"),
    });
    inst.titleObserver = loaded.code.observeDocumentTitle(view);
    return { ok: true, view, featureIds: loaded.featureIds };
  }

  // Whether the room's page state already carries the hand edit: merging the article's
  // changes into the room's blocks changes nothing. It is the comparison a checkpoint
  // makes before it decides the room holds an edit, run against the room's state
  // instead of the saved tag, so a room a peer changed after the adoption holds the
  // edit too.
  async function roomHoldsArticle(inst, found) {
    try {
      const code = await pageCodeReady();
      const { HyperMorph } = await mergeEngine();
      const blocks = code.blocksFromYValue(inst.store.authoritative);
      const current = code.readBack(blocks, document);
      const merged = code.mergePageModels(found.baseItems, current, found.parsed, {
        doc: document,
        merge3: HyperMorph.merge3,
        mergeJson: HyperMorph.mergeJson,
      });
      return code.canon(merged.items) === code.canon(current);
    } catch {
      return false;
    }
  }

  // A tab that is not the room's writer does not adopt: the elected writer lands the
  // hand edit, and it reaches this tab as a page update through the room, which the
  // store hands to this tab's binding. A room that already holds the edit has nothing
  // to wait for. Otherwise the saved article stays up and takes no typing until the
  // writer's adoption arrives, and the wait is bounded like adoption itself.
  async function awaitWriterAdoption(inst, found) {
    const code = await pageCodeReady();
    if (await roomHoldsArticle(inst, found)) return { ok: true, outcome: "writer-adopts" };
    return new Promise((resolve) => {
      let off = null;
      let timer = null;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        timer = null;
        off?.();
        off = null;
        resolve(result);
      };
      addDisposer(inst, () => finish({ ok: false, cancelled: true }));
      off = inst.store.onRebase((event) => {
        if (event.source === "remote") finish({ ok: true, outcome: "writer-adopts" });
      });
      timer = setTimeout(() => {
        console.warn("page: gave up waiting for the writer\u0027s adoption; the hand edit was not adopted");
        finish({ ok: false, reason: "adoption-timeout" });
      }, code.ADOPTION_TIMEOUT_MS);
    });
  }

  async function adoptSource(inst, source, mounted) {
    const code = await pageCodeReady();
    // A hand-edited article is adopted by the room's elected writer only. With a
    // lane but no writer yet, this tab claims the room (a redundant set of an
    // existing Yjs update: a valid nonempty frame that changes nothing) and then
    // waits for the election, so exactly one tab adopts.
    // A seeded page was built from this article: nothing to adopt.
    const found = source.seeded ? { kind: "untouched" } : code.classifyFile(source.article, source.tags);
    const needsAdoption = found.kind === "adopt";
    const awaitWriter = async () => {
      const lane = await pageLaneReady();
      if (!lane) return;
      if (!isCurrent(inst)) return;
      if (lane.status.writer === null) {
        const y = inst.store.value.y;
        const keys = Object.keys(y);
        const key = keys.length ? keys[0] : `claim-${binding.ydoc.clientID.toString(36)}`;
        const value = keys.length ? y[keys[0]] : code.yValueOf(binding.ydoc).y.seed;
        inst.store.handle.set(["y", key], value);
        // The session is not admitted until the commit, so its ops stay in the tab: the
        // claim alone is framed now, before adoption writes anything, or no election runs.
        lane.release("page");
      }
      // A lane that never reports a writer must not cost the hand edit: give up
      // before adoption's own bound, and adopt as the file-mode tab would.
      let timer;
      await Promise.race([pageWriterReady(), new Promise((resolve) => { timer = setTimeout(resolve, WRITER_WAIT_MS); })]);
      clearTimeout(timer);
    };
    const ready = needsAdoption ? awaitWriter() : Promise.resolve();

    const adoption = code.installAdoption({
      view: mounted.view,
      source,
      ready,
      isAdopter: () => {
        const lane = fastLane();
        return !lane || lane.status.writer === null ? true : lane.isWriter();
      },
      requestCheckpoint: () => checkpointWithin(0),
      snapshot: () => captureForSaveAndComparison({ emitForSync: false }).forSave,
      mergeTagless: inst.mergeTagless,
      seeded: source.seeded,
      writerReady: awaitWriter,
      adopted: (rev) => fastLane()?.adopted?.("page", rev, inst.store.mark),
      notice: (counts) => {
        if (!counts.copy) return;
        toastPersistent(OVERWRITTEN_TEXT, "warning", {
          actions: [{ label: "Download your copy", onClick: () => downloadSnapshot(counts.copy) }],
        });
      },
    });
    inst.adoption = adoption;

    let outcome = await adoption.idle();
    if (!outcome) {
      await replayJournal(inst);
      return { ok: true, outcome: "unchanged" };
    }
    // Another tab is the room's writer, so this tab's adoption is the one that tab
    // lands: the wait ends when it reaches this tab, or as the timeout a refusal is.
    if (outcome.outcome === "writer-adopts") outcome = await awaitWriterAdoption(inst, found);
    // Adoption refused, timed out or failed: the room's state is the page's, not the
    // view this tab built over the saved article, so the editor goes and the article
    // comes back from what the room accepted. A disposed install restores nothing:
    // dispose already did.
    if (!outcome.ok && isCurrent(inst)) abandonEditor(inst);
    else if (isCurrent(inst)) await replayJournal(inst);
    return outcome;
  }

  // Everything input waits for, checked without turning anything on: the parts the
  // saved article demands, any part the document gained while the page booted, and this
  // installation's own view still in the article it claimed.
  async function prepareInput(inst, mounted) {
    // A replacement that landed while the page was still booting keeps the editor
    // read-only: the notice is already up, and this tab must not edit the old article.
    if (inst.replaced) return { ok: false, reason: "page-replaced" };
    await featuresReady;
    if (!isCurrent(inst)) return { ok: false, cancelled: true };
    // The gate: this installation's own view, still in the article it claimed, over
    // the binding the room accepted. Anything else is not something to type into.
    const shell = mounted.view.dom.closest(".page-shell");
    if (!ownsView(inst, mounted) || !shell || !shell.isConnected || mounted.view.isDestroyed) {
      return { ok: false, reason: "view-detached" };
    }
    // The document the view holds can ask for a part the saved article never did: a
    // peer put a table in the room, or a hand edit spliced one in during adoption.
    // Those are the last parts input waits for, before the article gives way.
    const booted = new Set(mounted.featureIds ?? []);
    const late = docFeatureIds(mounted.view.state.doc).filter((id) => !booted.has(id));
    if (late.length) {
      await Promise.allSettled(late.map((id) => features.ensure(id)));
      if (!isCurrent(inst)) return { ok: false, cancelled: true };
    }
    return { ok: true };
  }

  // The one place the saved article gives way to the editor, and the only place input
  // opens. It changes activation only, and only after preparation already passed, so
  // the commit that enters edit cannot fail here.
  function openInput(inst, mounted) {
    const shell = mounted.view.dom.closest(".page-shell");
    const showEditor = () => {
      for (const node of savedContent) node.remove();
      if (shell) shell.style.visibility = "";
    };
    // A replacement that landed during the feature wait keeps the editor read-only,
    // exactly as one that landed before it does.
    if (inst.replaced) {
      showEditor();
      stopEditing(inst);
      return { ok: false, reason: "page-replaced" };
    }
    if (inst.inputOpen) return { ok: true };
    if (!ownsView(inst, mounted) || !shell || !shell.isConnected || mounted.view.isDestroyed) {
      return { ok: false, reason: "view-detached" };
    }
    showEditor();
    shell.inert = false;
    setEditorActive?.(mounted.view, true);
    inst.inputOpen = true;
    clearLoadingStatus(inst);
    return { ok: true };
  }

  // A refused or unfinished exit closes admission again without touching a buffer, so
  // a `resume` puts the very same session back.
  function closeInput(inst) {
    if (!inst.inputOpen) return false;
    setEditorActive?.(inst.view, false, { quiesce: true });
    return true;
  }

  function resumeInput(inst) {
    if (!inst.inputOpen) return false;
    setEditorActive?.(inst.view, true);
    return true;
  }

  // The legacy boot: preparation and the commit are one, because there is no
  // coordinator to wait for.
  async function enableInput(inst, mounted) {
    const prepared = await prepareInput(inst, mounted);
    if (!prepared.ok) return prepared;
    return openInput(inst, mounted);
  }

  // A boot that ends without an editor gives up what its branches acquired: the room's
  // subscription, its save participant and its listeners. A boot that mounted a view
  // releases its own through the paths above and keeps the editor on screen.
  const release = (inst) => {
    if (inst.view) return;
    abandonEditor(inst);
  };

  const steps = { readSource, loadEditorAssets, prepareAuthority, mountAndAttach, adoptSource, prepareInput, openInput, closeInput, resumeInput, enableInput, release };
  inst.steps = steps;
  return steps;
}

async function run(inst, options = {}, { activate = true } = {}) {
  return runBoot(inst, createSteps(inst, options), { activate });
}

// One installation, and the boot it runs. A managed session is the same installation
// with its commit left to the coordinator: `activate: false` stops the boot where the
// editor is staged and still takes no input.
function begin(options = {}, { activate = true, context = null } = {}) {
  dispose();
  ended = null;
  const gen = ++generation;
  const inst = {
    ...createInstall({
      gen,
      isCurrent: () => gen === generation && (context?.isCurrent?.() ?? true),
      onPhase: (result) => {
        // A settled boot says so by taking the waiting line away, whatever it settled
        // as: there is nothing left to wait for.
        if (result.phase === "ready" || result.phase === "blocked" || result.phase === "error") clearLoadingStatus(inst);
        options.onPhase?.(result);
      },
    }),
    article: null, view: null, binding: null, adoption: null, source: null, store: null, toolHost: null, aiTool: null, bootHtml: "", bootRev: null, savedRev: null, staged: null, pageStore: null, releaseArticle: null, replaced: false, savesHeld: false, flush: null, loadFormatGate: null, listeners: [], retryTimer: null, retryShown: false, statusTimer: null, statusNote: null, notices: null, editorReadyResolve: null, context, inputOpen: false, sessionHeld: false, autosaveSuspended: false, staleRetry: false,
  };
  active = inst;
  const boot = run(inst, options, { activate }).catch((error) => {
    console.error("clayjs: page plugin failed to install", error);
    ended = finishError(inst, "boot-failed");
    if (active === inst) dispose();
    return ended;
  });
  return { inst, boot };
}

function install(options = {}) {
  return begin(options).boot;
}

// What a session's own end gives back, whether or not the coordinator still calls the
// page: its view, its listeners, its binding and its staged store go, and the article
// comes back from the page the host accepted rather than from the editor's own DOM.
function endSession(inst) {
  if (active === inst) {
    active = null;
    generation += 1;
  }
  setSaveHeader("Page-Write", null);
  disposeInstall(inst);
  dismissSaveStateToasts(inst, true);
  inst.titleObserver?.dispose();
  inst.titleObserver = null;
  clearLoadingStatus(inst);
  if (inst.view && !inst.view.isDestroyed) {
    try { inst.view.destroy(); } catch (error) { console.error("clayjs: page plugin view failed to destroy", error); }
  }
  inst.view = null;
  releaseMounted(inst);
  restoreArticle(inst);
}

// The save hold a managed session takes between its preparation and its commit: given
// back once, by the enable that commits it or by the preparation that fails.
function releaseSessionHold(inst) {
  if (!inst.sessionHeld) return;
  inst.sessionHeld = false;
  releaseAllSaves({ replay: false, reason: SESSION_HOLD });
}

// What both roads hold between the commit that enters edit and the one that leaves it:
// a refused exit is `quiesce` then `resume`, and the committed exit is `dispose`. Only a
// session preparation holds takes a save hold to give back; an adopted one took none.
function sessionLease(inst, { held = true } = {}) {
  return {
    // Synchronous after preparation: it opens admission, input and the lane's writes,
    // and nothing it does can fail. An adopted session is already open.
    enable() {
      if (!held) return;
      releaseSessionHold(inst);
      activateInput(inst);
    },
    quiesce() {
      // A composition in flight is not this session's to cut: the exit is refused, and
      // the text stays where the person is typing it.
      if (inst.view?.composing) {
        throw Object.assign(new Error("clayjs: a composition is still in progress"), { code: "composition" });
      }
      inst.steps?.closeInput?.(inst);
      // Scheduled autosaves stop here; the buffers, the selection and the exit's own
      // flush stay exactly as they were.
      if (!inst.autosaveSuspended) {
        inst.autosaveSuspended = true;
        suspendAutosave();
      }
    },
    resume() {
      releaseSessionHold(inst);
      if (inst.autosaveSuspended) {
        inst.autosaveSuspended = false;
        resumeAutosave();
      }
      inst.steps?.resumeInput?.(inst);
    },
    dispose() {
      releaseSessionHold(inst);
      if (inst.autosaveSuspended) {
        inst.autosaveSuspended = false;
        resumeAutosave();
      }
      endSession(inst);
    },
  };
}

// What the coordinator holds between the commit that enters edit and the one that
// leaves it: preparation is `ready`, the commit is `enable`, a refused exit is
// `quiesce` then `resume`, and the committed exit is `dispose`.
export function preparePageSession(context = null, options = {}) {
  holdAllSaves(SESSION_HOLD);
  const { inst, boot } = begin(options, { activate: false, context });
  inst.sessionHeld = true;
  const lease = sessionLease(inst, { held: true });
  // The facade reads a session as the boot that is staging it, so it settles at the
  // staging or at the blocked outcome, and never rejects.
  page.ready = boot.then(() => page.status);
  const ready = boot.then((result) => {
    if (!result?.deferred) {
      throw Object.assign(new Error("clayjs: the page session could not prepare"), { code: result?.reason ?? "load-failed" });
    }
    return undefined;
  });
  // A preparation the coordinator never holds, and never disposes either, must not
  // keep the page's saves closed: it gives its hold back as it fails, and a reader that
  // yielded the article takes it back before the failure reaches the coordinator.
  ready.catch(() => {
    releaseSessionHold(inst);
    try { context?.reader?.reclaimArticle?.(); } catch (error) { console.error("clayjs: the reader could not take the article back", error); }
  });
  return { ready, ...lease };
}

/**
 * The page as a mode participant: the editor the commit that enters edit opens, over
 * the page the host already stores, and the one the exit takes back. `prepare` stages
 * the article, the room and the editor without taking input or writing; the commit
 * enables the same session.
 */
export function pageParticipant(options = {}) {
  return {
    id: "clay:page",
    // After live (200) and upload (340): the page builds its stores over the admission
    // those two already opened.
    order: 400,
    prepare(context = {}) {
      // An adoption is the session this tab's edit boot started: the exit takes that one
      // back, and the entry starts none.
      if (context.initial === true) {
        if (!active) return { enable() {}, quiesce() {}, resume() {}, dispose() {} };
        return sessionLease(active, { held: false });
      }
      return preparePageSession(context, options);
    },
  };
}

export { pageParticipant as modeParticipant };

export const page = {
  ready: null,
  install,
  get status() {
    return active?.result ?? ended;
  },
  flush(options = {}) {
    const inst = active;
    if (!inst || !inst.flush) return Promise.resolve({ ok: false, code: "disposed" });
    return inst.flush(options);
  },
  dispose,
  get view() {
    return active?.view ?? null;
  },
};

// The page's accepted bytes are the only thing that clears what this tab owes the file,
// and one module-level observer is enough: the hook API has no unsubscribe, so a binding
// registers none of its own and the current session's binding answers each save.
onSaveAccepted((html) => {
  const binding = active?.binding;
  if (!binding?.filePending()) return;
  const state = pageCode?.acceptedPageState(html);
  if (state) binding.acceptFile(state);
});

// A live entry imports this module while the committed mode is still view: the install
// belongs to the explicit edit boot alone, and a managed session starts its own.
page.ready = startsAtImport() ? install() : null;

export default page;
