import { createPageEditor } from "../page/editor.js";
import { readFile, installAdoption } from "../page/adopt-boot.js";
import { classifyFile } from "../page/adopt.js";
import { renderFromTags } from "../page/save-projection.js";
import { blocksFromYValue } from "../page/ybind/decode.js";
import { createYPageBinding } from "../page/ybind/binding.js";
import { yValueOf } from "../page/ybind/provider.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";
import { hostMeta } from "../core/host-meta.js";
import { storeOf, checkpointWithin, requestCheckpoint, fastLane, pageLaneReady, pageWriterReady } from "./live.js";
import { HyperMorph } from "../vendor/hyper-morph.vendor.js";
import { saveStateFor, BLOCKED_TEXT, RETRY_TEXT, downloadPageCopy, copyPageText } from "../page/save-states.js";
import { toastPersistent, dismissPersistent } from "../ui/toast.js";
import { createToolHost } from "../page/tools.js";
import { createAiTool } from "../page/ai-tool.js";
import { tablesFromDoc } from "../page/tool-data.js";
import { capabilityAdvertised } from "../page/rich/page-tool.js";

const ARTICLE_SEL = "article[data-page]";
const TAG_SEL = 'script[type="application/json"][merge="page"][clay~="live"]';
const BLOCKED = { state: "blocked", code: "unsupported-host", message: "This host does not support page editing" };
const RETRY_BOUND_MS = 45000;
const GENERIC_ERROR = "Couldn't save";
const GENERIC_OFFLINE = "Offline, not saved";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

let generation = 0;
let active = null;

// Shorter than installAdoption's 10 s hold, so an unelected room still adopts.
export const WRITER_WAIT_MS = 8_000;

function abandon(inst) {
  if (active === inst) active = null;
}

function dispatchState(state, code, message) {
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

function showBlocked(inst, code, message) {
  clearRetry(inst);
  dismissGeneric();
  dispatchState("blocked", code, message);
  toastPersistent(BLOCKED_TEXT, "error", {
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
  dispatchState("saved", null, "");
}

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
  listen(inst, "clay:save-saved", (event) => {
    applySaveState(inst, saveStateFor({ ok: true }), null, event.detail?.msg ?? "");
  });
  listen(inst, "clay:live-notice", (event) => {
    if (event.detail?.name !== "page") return;
    const code = event.detail?.code ?? null;
    applySaveState(inst, saveStateFor({ code }), code, event.detail?.message ?? "");
  });
}

function restoreArticle(inst) {
  const article = inst.article;
  if (!article) return;
  let html = inst.bootHtml;
  let rev = inst.bootRev;
  if (inst.store) {
    try {
      const rendered = renderFromTags([JSON.stringify(inst.store.value)]);
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

function dispose() {
  generation += 1;
  const inst = active;
  active = null;
  if (!inst) return;
  if (inst.retryTimer) {
    clearTimeout(inst.retryTimer);
    inst.retryTimer = null;
  }
  for (const [type, handler] of inst.listeners) document.removeEventListener(type, handler);
  inst.listeners = [];
  dismissPersistent(RETRY_TEXT);
  dismissPersistent(BLOCKED_TEXT);
  try { inst.adoption?.dispose(); } catch (error) { console.error("clayjs: page plugin adoption failed to dispose", error); }
  try { inst.view?.destroy(); } catch (error) { console.error("clayjs: page plugin view failed to destroy", error); }
  inst.aiTool?.dispose();
  inst.toolHost?.dispose();
  if (inst.article) {
    const shell = inst.article.querySelector(".page-shell");
    if (shell) shell.remove();
  }
  try { inst.binding?.dispose(); } catch (error) { console.error("clayjs: page plugin binding failed to dispose", error); }
  try { inst.binding?.ydoc?.destroy(); } catch (error) { console.error("clayjs: page plugin document failed to destroy", error); }
  restoreArticle(inst);
}

async function run(inst, gen, options = {}) {
  const articles = document.querySelectorAll(ARTICLE_SEL);
  const tags = document.querySelectorAll(TAG_SEL);
  if (!articles.length && !tags.length) return abandon(inst);
  if (articles.length !== 1 || tags.length !== 1) {
    console.warn(`clayjs: page plugin needs exactly one article[data-page] and one merge="page" live tag; found ${articles.length} article(s) and ${tags.length} tag(s), leaving the page as saved HTML`);
    return abandon(inst);
  }

  const article = articles[0];
  const file = readFile(document);
  if (!file) return abandon(inst);
  let value = null;
  try { value = HyperMorph.parseJsonRelaxed(tags[0].textContent); } catch (error) { value = null; }
  if (!isPlainObject(value) || value.v !== 1 || !isPlainObject(value.y) || Object.hasOwn(value, "blocks") || Object.hasOwn(value, "deleted")) {
    console.warn("clayjs: page plugin: the page tag is not a strict Yjs page, leaving the page as saved HTML");
    return abandon(inst);
  }
  try {
    blocksFromYValue(value);
  } catch (error) {
    console.warn("clayjs: page plugin: the page tag is not a valid Yjs page, leaving the page as saved HTML", error);
    return abandon(inst);
  }
  const source = { article: file.article, tags: [value] };

  let meta = null;
  try { meta = await hostMeta(); } catch (error) { meta = null; }
  if (gen !== generation) return;
  if (!meta || !Array.isArray(meta.extensions) || !meta.extensions.includes("page")) {
    showBlocked(inst, BLOCKED.code, BLOCKED.message);
    return;
  }

  let handle;
  try {
    handle = window.clay.live("page");
  } catch (error) {
    console.warn("clayjs: page plugin could not open the page store", error);
    return abandon(inst);
  }
  await handle.ready;
  if (gen !== generation) return;
  const store = storeOf("page");
  if (!store) return abandon(inst);
  inst.store = store;

  let flushFailed = false;
  let registered = null;
  const trackFlush = async (call) => {
    const result = await call();
    flushFailed = result?.ok === false;
    registered?.changed();
    return result;
  };
  const binding = createYPageBinding({
    store,
    checkpointWithin,
    requestCheckpoint,
    registerUnsavedState: (def) => {
      registered = registerUnsavedState({
        id: def.id,
        isPending: () => flushFailed || def.isPending(),
        flush: () => trackFlush(() => def.flush()),
      });
      return registered;
    },
  });
  inst.binding = binding;
  inst.flush = (options) => trackFlush(() => binding.flush(options));
  listenForSaves(inst);

  inst.source = source;
  inst.article = article;
  inst.bootHtml = source.article.innerHTML;
  inst.bootRev = source.article.getAttribute("data-rev");

  let toolsStore = null;
  if (document.querySelector('script[type="application/json"][merge="page.tools"][clay~="live"]')) {
    try {
      toolsStore = window.clay.live("page.tools");
      await toolsStore.ready;
    } catch (error) {
      console.warn("clayjs: page plugin could not open the tool store", error);
    }
  }
  if (gen !== generation) return;
  let editorView = null;
  const toolHost = createToolHost({
    store: toolsStore, mode: "edit",
    tables: () => tablesFromDoc(editorView?.state.doc ?? binding.doc()).map(({ id, cols, rows }) => ({ id, cols, rows })),
  });
  inst.toolHost = toolHost;
  const transport = window.clay?.wire?.pageTool ?? options.transport ?? null;
  if (capabilityAdvertised(meta)) {
    inst.aiTool = createAiTool({ getView: () => inst.view, store: toolsStore, transport, acceptState: options.acceptState });
  }
  article.innerHTML = "";
  const view = createPageEditor(article, {
    doc: binding.doc(),
    dispatch: binding.dispatch,
    history: false,
    undo: binding.undo,
    redo: binding.redo,
    editable: false,
    toolHost,
    onAiTool: inst.aiTool ? (_view, remove) => inst.aiTool.open({ remove }) : null,
    reviseTool: inst.aiTool ? (toolId, rev) => inst.aiTool.open({ target: { toolId, rev } }) : null,
  });
  editorView = view;
  inst.view = view;
  binding.attach(view);

  // A hand-edited article is adopted by the room's elected writer only. With a
  // lane but no writer yet, this tab claims the room (a redundant set of an
  // existing Yjs update: a valid nonempty frame that changes nothing) and then
  // waits for the election, so exactly one tab adopts.
  const needsAdoption = classifyFile(source.article, source.tags).kind === "adopt";
  const ready = !needsAdoption ? Promise.resolve() : (async () => {
    const lane = await pageLaneReady();
    if (!lane) return;
    if (gen !== generation) return;
    if (lane.status.writer === null) {
      const y = store.value.y;
      const keys = Object.keys(y);
      const key = keys.length ? keys[0] : `claim-${binding.ydoc.clientID.toString(36)}`;
      const value = keys.length ? y[keys[0]] : yValueOf(binding.ydoc).y.seed;
      store.handle.set(["y", key], value);
    }
    // A lane that never reports a writer must not cost the hand edit: give up
    // before adoption's own bound, and adopt as the file-mode tab would.
    let timer;
    await Promise.race([pageWriterReady(), new Promise((resolve) => { timer = setTimeout(resolve, WRITER_WAIT_MS); })]);
    clearTimeout(timer);
  })();

  const adoption = installAdoption({
    view,
    source,
    ready,
    isAdopter: () => {
      const lane = fastLane();
      return !lane || lane.status.writer === null ? true : lane.isWriter();
    },
    requestCheckpoint: () => checkpointWithin(0),
  });
  inst.adoption = adoption;

  await adoption.idle();
  if (gen !== generation) return;
  view.setProps({ editable: () => true });
}

function install(options = {}) {
  dispose();
  const gen = ++generation;
  const inst = { gen, article: null, view: null, binding: null, adoption: null, source: null, store: null, toolHost: null, aiTool: null, bootHtml: "", bootRev: null, flush: null, listeners: [], retryTimer: null, retryShown: false };
  active = inst;
  return run(inst, gen, options).catch((error) => {
    console.error("clayjs: page plugin failed to install", error);
    if (active === inst) dispose();
  });
}

export const page = {
  ready: null,
  install,
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

page.ready = install();

export default page;
