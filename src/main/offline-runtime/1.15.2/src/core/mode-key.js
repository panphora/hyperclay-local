import { canEdit, isDraftMode, mode } from "./is-edit-mode.js";
import { setMode } from "./edit-mode.js";
import onDomReady from "../lib/dom-ready.js";

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
@media (prefers-color-scheme: dark) {
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

function styles() {
  if (document.getElementById("clay-mode-note-style")) return;
  const style = document.createElement("style");
  style.id = "clay-mode-note-style";
  style.setAttribute("clay", "editor-ui");
  style.textContent = NOTE_CSS;
  document.head.append(style);
}

function onKey(e) {
  if (!(mac ? e.metaKey : e.ctrlKey) || !e.shiftKey || e.altKey || e.code !== "KeyE" || e.isComposing) return;
  e.preventDefault();
  setMode(mode === "edit" ? "view" : "edit").then((r) => {
    if (!r.ok && r.code === "save-failed") window.clay?.toast?.("Couldn't save, so this page stays in edit mode.", "error");
  });
}

function showNote() {
  styles();
  const note = document.createElement("div");
  note.setAttribute("clay", "editor-ui");
  note.setAttribute("role", "status");
  note.className = "clay-mode-note";
  note.innerHTML = `<span>This page opens in view mode. Press <kbd>${chord}</kbd> to edit.</span><button type="button" aria-label="Dismiss">×</button>`;
  const close = () => note.remove();
  note.querySelector("button").addEventListener("click", close);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { once: true });
  setTimeout(close, 12000);
  document.body.append(note);
}

if (canEdit && !isDraftMode) {
  document.addEventListener("keydown", onKey);
  onDomReady(() => {
    if (mode !== "view" || document.querySelector("[clay-mode-toggle]")) return;
    queueMicrotask(() => {
      if (window.clay?.menu) return;
      const store = window.clay?.storage?.local;
      if (!store || store.get("mode-note")) return;
      store.set("mode-note", true);
      showNote();
    });
  });
}
