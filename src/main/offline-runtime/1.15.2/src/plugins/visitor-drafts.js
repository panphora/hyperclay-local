import { isDraftMode, isEditMode, isOwner } from "../core/is-edit-mode.js";
import { hasSaveToken } from "../core/host-attrs.js";
import { draftSlot, setDraftTransport, setDraftFlush } from "../core/draft-mode.js";
import { createStore, safeStorage } from "./visitor-drafts/store.js";
import { createUiMemory } from "./visitor-drafts/ui-memory.js";
import { rememberSource, downloadUrl } from "./visitor-drafts/source.js";
import { mountPrompt } from "./visitor-drafts/prompt.js";
import { mountIntro } from "./visitor-drafts/intro.js";
import { mountOwnerChip } from "./visitor-drafts/owner-chip.js";
import { DOWNLOAD_URL, backToDraft, editOriginal, inertVisitorDrafts } from "./visitor-drafts/inert.js";

let store = null;
let restoredDetail = null;
let downloadLink = DOWNLOAD_URL;
let source = null;

const slot = draftSlot();
const rulesTag = document.querySelector('script[data-rules-name~="api"]');

if (isDraftMode && slot && rulesTag) {
  store = createStore();
  setDraftTransport((html) => store.write(html));
  const result = store.restore();
  restoredDetail = { restored: result.restored, hadDraft: result.hadDraft, parked: Boolean(result.parked), ...(result.partial && { partial: true }), ...(result.blocked && { blocked: true }) };
  document.dispatchEvent(new CustomEvent("clay:drafts-restored", { detail: restoredDetail }));
  const memory = createUiMemory(slot, safeStorage());
  source = rememberSource(memory);
  downloadLink = downloadUrl(source);
  const appName = document.querySelector('meta[name="application-name"]')?.content?.trim() || document.title.split(/:|\s\|\s/)[0].trim() || "This app";
  const template = document.querySelector("template[visitor-intro]");
  const start = () => {
    const prompt = mountPrompt({ memory, appName, link: downloadLink });
    mountIntro({ memory, template, appName, hadDraft: result.hadDraft });
    if (isOwner) mountOwnerChip();
    document.addEventListener("clay:drafts-store-failed", () => prompt.showError());
    document.addEventListener("clay:drafts-saved", () => prompt.clearError());
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start, { once: true }) : start();
  setDraftFlush(() => store.flush());
  window.addEventListener("storage", (event) => { if (event.key === store.key) store.adoptExternal(); });
  const flush = () => store.flush();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
} else if (!slot || !rulesTag) {
  const missing = [];
  if (!slot) missing.push('a visitor-drafts="<slot>" attribute on <html>');
  if (!rulesTag) missing.push('a <script data-rules-name~="api"> rules tag');
  console.warn(`visitor-drafts: this page keeps no draft (missing ${missing.join(" and ")})`);
} else if (isOwner && isEditMode && !hasSaveToken()) {
  mountOwnerChip();
}

export const ready = Promise.resolve();

export const visitorDrafts = store ? {
  active: true,
  slot: store.slot,
  key: store.key,
  hasDraft: () => Boolean(store.read()),
  restored: () => restoredDetail,
  saveNow: () => store.writeLive(),
  reset() {
    store.clear();
    window.location.reload();
    return true;
  },
  onRestore(fn) {
    if (restoredDetail) {
      fn(restoredDetail);
      return true;
    }
    document.addEventListener("clay:drafts-restored", (event) => fn(event.detail), { once: true });
    return false;
  },
  editOriginal,
  backToDraft,
  downloadUrl: () => downloadLink,
  source,
} : inertVisitorDrafts();
