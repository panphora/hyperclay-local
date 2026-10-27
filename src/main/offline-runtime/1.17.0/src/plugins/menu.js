// The menu plugin: an Edit switch and claygoo in the top right, for anyone who can
// edit. Everything it draws is `clay="editor-ui"`, so none of it reaches the saved
// file, a sync frame, the dirty check or undo.
import { canEdit, isDraftMode, isEditMode, mode as startMode } from "../core/is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import CLAYGOO from "./menu/claygoo.svg.js";
import { modeRefusalText } from "../core/mode-refusal.js";

const SEO_ITEM = true;
const NOTE_MS = 6000;
const INTRO_GAP = 12;

const MENU_CSS = `.clay-menu {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 2147482000;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1;
  color: var(--clay-ui-fg, #1F2328);
}
.clay-menu-edit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
  font: inherit;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-menu-edit:disabled { cursor: progress; opacity: .7; }
.clay-menu-track {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 52px;
  height: 32px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 999px;
  background: var(--clay-ui-bg, #F4F4F5);
  transition: background-color .15s ease, border-color .15s ease;
}
.clay-menu-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #FAFAFB;
  box-shadow: 0 1px 2px rgba(23, 28, 36, .35);
  transition: transform .15s ease;
}
.clay-menu-edit[aria-checked="true"] .clay-menu-track {
  border-color: transparent;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-menu-edit[aria-checked="true"] .clay-menu-thumb { transform: translateX(20px); }
.clay-menu-label { font-size: 13px; line-height: 1; }
.clay-menu-goo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 50%;
  color: inherit;
  background: var(--clay-ui-bg, #F4F4F5);
  cursor: pointer;
}
.clay-menu-goo svg { display: block; width: 18px; height: auto; }
.clay-menu-dot {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-menu-list {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 184px;
  margin: 0;
  padding: 4px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 10px;
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 10px 28px -14px rgba(23, 28, 36, .5);
}
.clay-menu-list button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  text-align: left;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-menu-list button:hover,
.clay-menu-list button:focus-visible { outline: none; background: rgba(23, 28, 36, .08); }
.clay-menu-note {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 8px;
  line-height: 1.4;
  text-align: left;
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 10px 28px -14px rgba(23, 28, 36, .5);
}
@media (pointer: coarse) {
  .clay-menu-edit { min-height: 44px; padding: 6px 0; }
  .clay-menu-goo { width: 44px; height: 44px; }
}
@media (prefers-color-scheme: dark) {
  .clay-menu { color: var(--clay-ui-fg, #E9E9EC); }
  .clay-menu-track,
  .clay-menu-goo,
  .clay-menu-list,
  .clay-menu-note { border-color: rgba(233, 233, 236, .16); background: var(--clay-ui-bg, #26282C); }
  .clay-menu-track { background: rgba(233, 233, 236, .22); }
  .clay-menu-thumb { background: #E9E9EC; }
  .clay-menu-list button:hover,
  .clay-menu-list button:focus-visible { background: rgba(233, 233, 236, .12); }
}
@media (prefers-reduced-motion: reduce) {
  .clay-menu-track, .clay-menu-thumb { transition: none; }
}`;

// clay.mode is the live answer; the imported mode is the one the page booted with.
const currentMode = () =>
  window.clay && typeof window.clay.mode === "string" ? window.clay.mode : startMode;

function stylesOnce() {
  if (document.getElementById("clay-menu-style")) return;
  const style = document.createElement("style");
  style.id = "clay-menu-style";
  style.setAttribute("clay", "editor-ui");
  style.textContent = MENU_CSS;
  document.head.append(style);
}

function mount() {
  if (document.querySelector(".clay-menu")) return;
  stylesOnce();

  const root = document.createElement("div");
  root.className = "clay-menu";
  root.setAttribute("clay", "editor-ui");
  root.setAttribute("clay-mode-toggle", "");
  root.innerHTML =
    `<button type="button" class="clay-menu-edit" role="switch" aria-checked="false">` +
    `<span class="clay-menu-track" aria-hidden="true"><span class="clay-menu-thumb"></span></span>` +
    `<span class="clay-menu-label">Edit</span>` +
    `</button>` +
    `<button type="button" class="clay-menu-goo" aria-haspopup="menu" aria-expanded="false" aria-label="Clay menu">${CLAYGOO}</button>` +
    `<div class="clay-menu-list" role="menu" hidden></div>` +
    `<div class="clay-menu-note" role="status" hidden></div>`;

  const edit = root.querySelector(".clay-menu-edit");
  const goo = root.querySelector(".clay-menu-goo");
  const list = root.querySelector(".clay-menu-list");
  const noteEl = root.querySelector(".clay-menu-note");
  const items = new Map();

  const isOpen = () => !list.hidden;

  function setExpanded(open) {
    list.hidden = !open;
    goo.setAttribute("aria-expanded", open ? "true" : "false");
  }

  const buttons = () => [...list.querySelectorAll('[role="menuitem"]')];

  function focusItem(index) {
    const all = buttons();
    if (!all.length) return;
    all[(index + all.length) % all.length].focus();
  }

  function close() {
    if (isOpen()) setExpanded(false);
  }

  function open() {
    if (!isOpen()) setExpanded(true);
  }

  function render() {
    const hadFocus = list.contains(document.activeElement);
    list.textContent = "";
    for (const item of items.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.dataset.menuId = item.id;
      button.textContent = item.label;
      button.addEventListener("click", () => {
        close();
        if (item.run) item.run();
      });
      list.append(button);
    }
    const dot = goo.querySelector(".clay-menu-dot");
    const wanted = [...items.values()].some((item) => item.badge);
    if (wanted && !dot) {
      const mark = document.createElement("span");
      mark.className = "clay-menu-dot";
      goo.append(mark);
    } else if (!wanted && dot) {
      dot.remove();
    }
    if (hadFocus) focusItem(0);
  }

  function addItem({ id, label, run, badge } = {}) {
    if (!id) return null;
    items.set(id, {
      id,
      label: String(label ?? ""),
      run: typeof run === "function" ? run : null,
      badge: Boolean(badge),
    });
    render();
    return id;
  }

  function showNote(text) {
    if (!text) return;
    noteEl.textContent = text;
    noteEl.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      noteEl.hidden = true;
      noteEl.textContent = "";
    }, NOTE_MS);
  }

  let noteTimer = 0;
  let busy = false;

  function setChecked() {
    edit.setAttribute("aria-checked", currentMode() === "edit" ? "true" : "false");
  }
  setChecked();

  // The switch shows the mode that was committed, not the one a click asked for: a
  // change can land from the keyboard, from another plugin's lease or from a live entry
  // this menu did not start, and each commit is announced once on the document.
  document.addEventListener("clay:modechange", setChecked);

  edit.addEventListener("click", async () => {
    if (busy) return;
    const previous = edit.getAttribute("aria-checked");
    const next = currentMode() === "edit" ? "view" : "edit";
    busy = true;
    edit.setAttribute("aria-busy", "true");
    edit.disabled = true;
    let result;
    try {
      result = await window.clay?.setMode?.(next);
    } catch (err) {
      result = { ok: false, message: err && err.message };
    }
    // A reload is coming: stay busy until the page goes.
    if (result && result.reloading) return;
    busy = false;
    edit.removeAttribute("aria-busy");
    edit.disabled = false;
    if (result && result.ok === false) {
      edit.setAttribute("aria-checked", previous);
      const text = modeRefusalText(result);
      if (text) showNote(text);
    } else {
      setChecked();
    }
  });

  goo.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });

  document.addEventListener("click", (event) => {
    if (isOpen() && !root.contains(event.target)) close();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!isOpen()) return;
      event.preventDefault();
      close();
      goo.focus();
      return;
    }
    if (event.target === goo && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (isOpen()) close();
      else {
        open();
        focusItem(0);
      }
      return;
    }
    if (!isOpen()) return;
    if (event.key === "Enter" && list.contains(event.target)) {
      event.preventDefault();
      event.target.click();
      return;
    }
    const all = buttons();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(at < 0 ? 0 : at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(at < 0 ? all.length - 1 : at - 1);
    }
  });

  // The intro sits at the top right in normal flow, so the group moves below its
  // bottom edge while it is on the page, and back when it goes.
  const doc = document;
  let introObserver = null;
  let watched = null;

  function place(intro) {
    root.style.top = `${Math.round(intro.getBoundingClientRect().bottom) + INTRO_GAP}px`;
  }

  function watchIntro() {
    if (!root.isConnected) return;
    const intro = doc.querySelector(".clay-intro");
    if (intro === watched) return;
    if (introObserver) {
      introObserver.disconnect();
      introObserver = null;
    }
    watched = intro;
    if (!intro) {
      root.style.removeProperty("top");
      return;
    }
    if (typeof ResizeObserver === "function") {
      introObserver = new ResizeObserver(() => place(intro));
      introObserver.observe(intro);
    }
    place(intro);
  }

  const vars = document.createElement("style");
  vars.id = "clay-menu-vars";
  vars.setAttribute("clay", "editor-ui");
  document.head.append(vars);

  function reserveSpace() {
    const rect = root.getBoundingClientRect();
    vars.textContent =
      `:root { --clay-menu-width: ${Math.ceil(rect.width)}px; --clay-menu-height: ${Math.ceil(rect.height)}px; }`;
  }

  document.body.append(root);
  reserveSpace();
  if (typeof ResizeObserver === "function") new ResizeObserver(reserveSpace).observe(root);

  new MutationObserver(watchIntro).observe(doc.body, { childList: true });
  watchIntro();

  const openSeo = () => import("./menu/seo.js").then((m) => m.open());

  if (SEO_ITEM) {
    addItem({
      id: "seo",
      label: "SEO settings…",
      run: openSeo,
    });

    const storage = window.clay.storage && window.clay.storage.session;
    if (storage && storage.get("reopen-seo") === true) {
      storage.remove("reopen-seo");
      openSeo().catch(() => {});
    }
  }

  window.clay.menu = { addItem, open, close };
}

let mounted = false;

const shouldMount = () => (canEdit || isEditMode) && !isDraftMode;

function mountOnce() {
  if (mounted || !shouldMount()) return;
  mounted = true;
  mount();
}

if (!isDraftMode) {
  onDomReady(mountOnce);
  document.addEventListener("clay:capabilitychange", mountOnce);
}
