import { canEdit, isDraftMode, mode } from "./is-edit-mode.js";
import { setMode } from "./edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { PERSIST, resolveRegionPolicy } from "../lib/region-policy.js";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const chord = mac ? "⌘⇧E" : "Ctrl+Shift+E";

const NOTE_CSS = `.clay-mode-note {
  position: fixed;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 2147482000;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 10px 10px 10px 14px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 12px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  color: var(--clay-ui-fg, #1F2328);
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 8px 24px -12px rgba(23, 28, 36, .45);
  transition: opacity .25s ease, transform .25s ease;
}
.clay-mode-note kbd {
  font: inherit;
  font-weight: 600;
  padding: 1px 5px;
  border: 1px solid rgba(23, 28, 36, .2);
  border-radius: 5px;
  background: rgba(23, 28, 36, .07);
}
.clay-mode-note button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 16px;
  line-height: 1;
  color: inherit;
  background: none;
  cursor: pointer;
  opacity: .65;
}
.clay-mode-note button:hover { opacity: 1; background: rgba(23, 28, 36, .08); }
.clay-mode-note .clay-view-notice__edit {
  width: auto;
  padding: 0 10px;
  border: 1px solid rgba(23, 28, 36, .2);
  font-size: 13px;
  font-weight: 600;
  opacity: 1;
}
@media (prefers-color-scheme: dark) {
  .clay-mode-note .clay-view-notice__edit { border-color: rgba(233, 233, 236, .22); }
  .clay-mode-note {
    border-color: rgba(233, 233, 236, .16);
    color: var(--clay-ui-fg, #E9E9EC);
    background: var(--clay-ui-bg, #26282C);
    box-shadow: 0 8px 24px -12px rgba(0, 0, 0, .7);
  }
  .clay-mode-note kbd { border-color: rgba(233, 233, 236, .22); background: rgba(233, 233, 236, .1); }
  .clay-mode-note button:hover { background: rgba(233, 233, 236, .12); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-mode-note { transition: none; }
}
@media (max-width: 559px) {
  .clay-mode-note {
    left: calc(16px + env(safe-area-inset-left, 0px));
    right: calc(16px + env(safe-area-inset-right, 0px));
    max-width: none;
  }
}`;

// A note mounts in its own shadow root, so the page's CSS cannot restyle it. The helper is
// imported only when a note shows: this module loads on every page, a note rarely.
const closedNotes = new WeakSet();

function mountNote(content) {
  import("../ui/editor-ui.js").then(({ mountEditorUI }) => {
    if (!closedNotes.has(content)) mountEditorUI({ name: "mode-note", content, css: [NOTE_CSS] });
  });
}

function closeNote(content) {
  closedNotes.add(content);
  content.getRootNode().host?.remove();
}

function switchTo(next) {
  return setMode(next).then((r) => {
    if (r.ok) return;
    import("./mode-refusal.js").then(({ modeRefusalText }) => {
      const text = modeRefusalText(r);
      if (!text) return;
      // Templates that load no UI satellite still say why the switch did nothing.
      if (typeof window.clay?.toast === "function") window.clay.toast(text, "error");
      else if (typeof window.clay?.menu?.note === "function") window.clay.menu.note(text);
      else showNote(text);
    });
  });
}

function onKey(e) {
  if (!(canEdit || mode === "edit")) return;
  if (!(mac ? e.metaKey : e.ctrlKey) || !e.shiftKey || e.altKey || e.code !== "KeyE" || e.isComposing) return;
  e.preventDefault();
  switchTo(mode === "edit" ? "view" : "edit");
}

// A tab in view keeps nothing typed into it, and a page whose own script opens an
// editor at load (an OverType journal) accepts that typing all day. So for a person
// who can edit, the first edit to a field that saves in edit mode raises a notice
// that stays until the tab edits. Fields edit mode would unlock (inert
// contenteditable, viewmode:readonly, viewmode:disabled) raise it on the attempt.
const VIEW_NOTICE = "In view mode, so edits won't be saved.";
const SAVING_FIELD = ":is(input, textarea, select):is([persist], [clay-persist])";
const INERT_FIELD = "[editmode\\:contenteditable], [viewmode\\:readonly], [viewmode\\:disabled]";

let viewNotice = null;

function savedContent(el) {
  if (!el.isConnected) return false;
  const policy = resolveRegionPolicy(el);
  return policy.persist === PERSIST.FULL && !policy.extension;
}

function savingField(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el) return null;
  const field = el.closest(SAVING_FIELD) || el.closest(INERT_FIELD) || (el.isContentEditable ? el : null);
  return field && savedContent(field) ? field : null;
}

const liveField = (el) =>
  el.isContentEditable || (el.matches("input, textarea, select") && !el.readOnly && !el.disabled);

const watching = () => canEdit && mode === "view";

function onViewInput(e) {
  if (watching() && savingField(e.target)) showViewNotice();
}

// Bubbles on window, after the page's own handlers, so a single-key shortcut the
// page handled (and prevented) never reads as an attempt to type.
function onViewKey(e) {
  if (!watching() || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!(e.key.length === 1 && e.key !== " ") && e.key !== "Backspace" && e.key !== "Delete") return;
  const target = e.target;
  if (target?.nodeType !== 1 || liveField(target)) return;
  if (target !== document.body && !target.closest(INERT_FIELD)) return;
  const field = savingField(target === document.body ? document.getSelection()?.anchorNode : target);
  if (field?.matches(INERT_FIELD)) showViewNotice();
}

function onViewPointer(e) {
  if (!watching()) return;
  const field = e.target?.closest?.("[viewmode\\:disabled]");
  if (field && savedContent(field)) showViewNotice();
}

function showViewNotice() {
  if (viewNotice) return;
  console.warn('clayjs: this tab is in view mode, so edits made here are not saved. clay.setMode("edit") switches; a page that must edit as soon as it opens declares <html opens-in="edit">.');
  document.querySelector('clay-editor-ui[data-clay-ui="mode-note"]')?.remove();
  viewNotice = document.createElement("div");
  viewNotice.setAttribute("clay", "editor-ui");
  viewNotice.setAttribute("role", "alert");
  viewNotice.className = "clay-mode-note clay-view-notice";
  viewNotice.innerHTML = '<span></span><button type="button" class="clay-view-notice__edit">Switch to edit</button>';
  viewNotice.querySelector("span").textContent = VIEW_NOTICE;
  viewNotice.querySelector("button").addEventListener("click", () => switchTo("edit"));
  mountNote(viewNotice);
}

function onModeChange() {
  if (mode === "view" || !viewNotice) return;
  closeNote(viewNotice);
  viewNotice = null;
}

function showNote(message) {
  const note = document.createElement("div");
  note.setAttribute("clay", "editor-ui");
  note.setAttribute("role", "status");
  note.className = "clay-mode-note";
  note.innerHTML = `<span>This page opens in view mode. Press <kbd>${chord}</kbd> to edit.</span><button type="button" aria-label="Dismiss">×</button>`;
  if (message) note.querySelector("span").textContent = message;
  const close = () => closeNote(note);
  note.querySelector("button").addEventListener("click", close);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { once: true });
  setTimeout(close, 12000);
  mountNote(note);
}

if (!isDraftMode) {
  document.addEventListener("keydown", onKey);
  document.addEventListener("input", onViewInput, true);
  document.addEventListener("pointerdown", onViewPointer, true);
  window.addEventListener("keydown", onViewKey);
  document.addEventListener("clay:modechange", onModeChange);
  onDomReady(() => {
    if (!canEdit || mode !== "view" || document.querySelector("[clay-mode-toggle]")) return;
    // The note needs clay.storage, which the loader attaches after the core wave.
    const whenReady = (run) => {
      const ready = window.clay?.ready;
      if (window.clay?.storage || typeof ready?.then !== "function") queueMicrotask(run);
      else ready.then(run, () => {});
    };
    whenReady(() => {
      // A menu loads after ready and carries its own way in.
      if (window.clay?.menu || window.clay?.plugins?.includes?.("menu")) return;
      const store = window.clay?.storage?.local;
      if (!store || store.get("mode-note")) return;
      store.set("mode-note", true);
      showNote();
    });
  });
}
