// The menu plugin: an Edit switch and claygoo in the top right, for anyone who can
// edit. Everything it draws is `clay="editor-ui"`, so none of it reaches the saved
// file, a sync frame, the dirty check or undo.
import { canEdit, isDraftMode, isEditMode, mode as startMode } from "../core/is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import CLAYGOO from "./menu/claygoo.svg.js";
import { modeRefusalText } from "../core/mode-refusal.js";
import MENU_CSS, { MENU_SURFACE } from "./menu/style.js";
import { attachPlacement } from "./menu/placement.js";
import { attachActions } from "./menu/actions.js";
import { attachPeople } from "./menu/people.js";
import { attachVariants } from "./menu/variants.js";
import { followLook } from "../ui/page-colour.js";
import { mountEditorUI } from "../ui/editor-ui.js";

const SEO_ITEM = true;
const NOTE_MS = 6000;
const INTRO_GAP = 12;
const GRIP =
  '<svg viewBox="0 0 6 12" aria-hidden="true" focusable="false"><rect width="2" height="2"/><rect x="4" width="2" height="2"/>' +
  '<rect y="5" width="2" height="2"/><rect x="4" y="5" width="2" height="2"/><rect y="10" width="2" height="2"/><rect x="4" y="10" width="2" height="2"/></svg>';

// Built-in items keep fixed slots, so the order never depends on which plugin
// registered first. Any other id goes in its own section above the footer, in the
// order it was added.
const SECTIONS = [
  ["clay.undo", "clay.cms", "clay.ai", "clay.code"],
  ["seo", "clay.variants.keep", "clay.share", "clay.people"],
  ["clay.duplicate", "clay.download", "clay.export", "clay.reveal"],
  ["clay.versions"],
  null,
  ["upgrade"],
];
const SLOTTED = new Set(SECTIONS.flat().filter(Boolean));

// clay.mode is the live answer; the imported mode is the one the page booted with.
const currentMode = () =>
  window.clay && typeof window.clay.mode === "string" ? window.clay.mode : startMode;

function mount() {
  if (document.querySelector('clay-editor-ui[data-clay-ui="menu"]')) return;

  const root = document.createElement("div");
  root.className = "clay-menu-dock";
  root.setAttribute("clay", "editor-ui");
  root.dataset.corner = "top-right";
  root.innerHTML =
    `<div class="clay-menu" clay="editor-ui">` +
    `<button type="button" class="clay-menu-grip" aria-label="Move the menu. Drag it, or use the arrow keys to move it to another corner.">${GRIP}</button>` +
    `<button type="button" class="clay-menu-edit" role="switch" aria-checked="false">` +
    `<span class="clay-menu-track" aria-hidden="true"><span class="clay-menu-thumb"></span></span>` +
    `<span class="clay-menu-label">Edit</span>` +
    `</button>` +
    `<span class="clay-menu-divider" aria-hidden="true"></span>` +
    `<button type="button" class="clay-menu-goo" aria-haspopup="menu" aria-expanded="false" aria-label="Clay menu">${CLAYGOO}</button>` +
    `</div>` +
    `<div class="clay-menu-list" role="menu" aria-label="Clay menu" hidden></div>` +
    `<div class="clay-menu-note" role="status" hidden></div>`;

  const grip = root.querySelector(".clay-menu-grip");
  const edit = root.querySelector(".clay-menu-edit");
  const goo = root.querySelector(".clay-menu-goo");
  const list = root.querySelector(".clay-menu-list");
  const noteEl = root.querySelector(".clay-menu-note");
  const items = new Map();

  // Focus inside the shadow root: document.activeElement only ever names the host.
  const focusedEl = () => root.getRootNode().activeElement || null;
  const isOpen = () => !list.hidden;

  function setExpanded(open) {
    list.hidden = !open;
    goo.setAttribute("aria-expanded", open ? "true" : "false");
  }

  const buttons = () => [...list.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')];

  function focusItem(index) {
    const all = buttons();
    if (!all.length) return;
    all[(index + all.length) % all.length].focus();
  }

  function close() {
    if (!isOpen()) return;
    setExpanded(false);
  }

  let actions = null;
  let people = null;

  function open() {
    if (isOpen()) return;
    people?.close({ restore: false });
    actions?.refresh();
    render();
    setExpanded(true);
  }

  function itemButton(item) {
    const link = item.href && !item.disabled;
    const button = document.createElement(link ? "a" : "button");
    if (link) {
      button.href = item.href;
      button.target = "_blank";
      button.rel = "noopener";
    } else {
      button.type = "button";
    }
    button.setAttribute("role", "menuitem");
    button.dataset.menuId = item.id;
    if (item.badge && item.id === "upgrade") {
      const label = document.createElement("span");
      label.className = "clay-menu-upgrade";
      label.textContent = item.label;
      button.append(label);
    } else {
      button.textContent = item.label;
    }
    if (item.keys) {
      const kbd = document.createElement("kbd");
      kbd.textContent = item.keys;
      button.append(kbd);
    }
    if (item.disabled) button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", () => {
      if (item.disabled) return;
      close();
      if (item.run) item.run();
    });
    return button;
  }

  function itemNode(item) {
    if (item.text) {
      const line = document.createElement("p");
      line.className = "clay-menu-version";
      line.dataset.menuId = item.id;
      line.textContent = item.label;
      return line;
    }
    if (item.pair) {
      const pair = document.createElement("div");
      pair.className = "clay-menu-pair";
      pair.dataset.menuId = item.id;
      for (const part of item.pair) pair.append(itemButton(part));
      return pair;
    }
    return itemButton(item);
  }

  function sections() {
    const extra = [...items.keys()].filter((id) => !SLOTTED.has(id));
    return SECTIONS.map((ids) => (ids || extra).map((id) => items.get(id)).filter(Boolean)).filter((group) => group.length);
  }

  function render() {
    const now = focusedEl();
    const focused = now && list.contains(now) ? now.dataset.menuId : null;
    list.textContent = "";
    sections().forEach((group, index) => {
      if (index) {
        const sep = document.createElement("div");
        sep.className = "clay-menu-sep";
        sep.setAttribute("role", "separator");
        list.append(sep);
      }
      for (const item of group) list.append(itemNode(item));
    });
    const dot = goo.querySelector(".clay-menu-dot");
    const wanted = [...items.values()].some((item) => item.badge);
    if (wanted && !dot) {
      const mark = document.createElement("span");
      mark.className = "clay-menu-dot";
      mark.setAttribute("aria-hidden", "true");
      goo.append(mark);
    } else if (!wanted && dot) {
      dot.remove();
    }
    if (focused) {
      const again = buttons().find((button) => button.dataset.menuId === focused);
      if (again) again.focus();
      else focusItem(0);
    }
  }

  const clean = ({ id, label, run, badge, keys, disabled, href }) => ({
    id,
    href: typeof href === "string" ? href : "",
    label: String(label ?? ""),
    run: typeof run === "function" ? run : null,
    badge: Boolean(badge),
    keys: keys ? String(keys) : "",
    disabled: Boolean(disabled),
  });

  function addItem({ id, label, run, badge, keys, disabled, text, pair, href } = {}) {
    if (!id) return null;
    const item = clean({ id, label, run, badge, keys, disabled, href });
    if (text) item.text = true;
    if (Array.isArray(pair)) item.pair = pair.map(clean);
    items.set(id, item);
    render();
    return id;
  }

  function removeItem(id) {
    if (items.delete(id)) render();
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

  const applyHidden = () => {
    root.hidden = !canEdit && currentMode() !== "edit";
  };

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
    // Disabling the focused switch drops focus to the body; it goes back once the switch is done.
    const hadFocus = focusedEl() === edit;
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
    if (hadFocus && edit.isConnected && !focusedEl() && document.activeElement === document.body) edit.focus();
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
    if (isOpen() && !event.composedPath().includes(root)) close();
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
    const at = all.indexOf(focusedEl());
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
    if (root.dataset.corner.startsWith("top")) {
      root.style.top = `${Math.round(intro.getBoundingClientRect().bottom) + INTRO_GAP}px`;
    } else {
      root.style.removeProperty("top");
    }
  }

  const replace = () => {
    if (watched) place(watched);
    else root.style.removeProperty("top");
  };

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

  const ui = mountEditorUI({ name: "menu", content: root, css: [MENU_CSS], attributes: { "clay-mode-toggle": "" } });
  attachPlacement({
    dock: root,
    container: ui.shadow,
    grip,
    storage: window.clay.storage && window.clay.storage.local,
    onMove: replace,
    onDragStart: () => {
      close();
      people?.close({ restore: false });
    },
  });
  reserveSpace();
  if (typeof ResizeObserver === "function") new ResizeObserver(reserveSpace).observe(root);

  new MutationObserver(watchIntro).observe(doc.body, { childList: true });
  watchIntro();
  followLook(root, root.querySelector(".clay-menu"), MENU_SURFACE);

  const openSeo = () => import("./menu/seo.js").then((m) => m.open({ returnFocus: goo }));

  actions = attachActions({ addItem, note: showNote, currentMode });
  people = attachPeople({ root, capsule: root.querySelector(".clay-menu"), addItem, removeItem, closeMenu: close, note: showNote });
  attachVariants({ root, capsule: root.querySelector(".clay-menu"), addItem, removeItem, note: showNote, currentMode });

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

  // A view-mode owner's hint can be stale: the host's own answer decides, and a page the
  // host will not let this caller save hides the menu rather than offer a refused switch.
  followCapability = applyHidden;
  if (currentMode() !== "edit") import("../core/host-permission.js").then((m) => m.checkHostPermission()).catch(() => {});

  window.clay.menu = { addItem, removeItem, open, close, note: showNote };
  document.dispatchEvent(new CustomEvent("clay:menu-ready"));
}

let mounted = false;
let followCapability = null;

const shouldMount = () => (canEdit || isEditMode) && !isDraftMode;

function mountOnce() {
  if (mounted || !shouldMount()) return;
  mounted = true;
  mount();
}

if (!isDraftMode) {
  onDomReady(mountOnce);
  document.addEventListener("clay:capabilitychange", () => {
    mountOnce();
    followCapability?.();
  });
}
