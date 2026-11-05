// The menu plugin: an Edit switch and claygoo in the top right, for anyone who can
// edit. Everything it draws is `clay="editor-ui"`, so none of it reaches the saved
// file, a sync frame, the dirty check or undo.
import { canEdit, isDraftMode, isEditMode, mode as startMode } from "../core/is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import CLAYGOO from "./menu/claygoo.svg.js";
import { modeRefusalText } from "../core/mode-refusal.js";
import { MENU_BASE, MENU_FLOATING, MENU_SKIN, MENU_TOUCH, MENU_SURFACE } from "./menu/style.js";
import { attachPlacement } from "./menu/placement.js";
import { attachActions } from "./menu/actions.js";
import { attachPeople } from "./menu/people.js";
import { attachVariants } from "./menu/variants.js";
import { followLook } from "../ui/page-colour.js";
import { mountEditorUI } from "../ui/editor-ui.js";

const SEO_ITEM = true;
const SKIN_VERSION = "1";
const EDGE_GAP = 8;
const DISMISS_ICON = '<svg viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1 0 5 4l4-4 1 1-4 4 4 4-1 1-4-4-4 4-1-1 4-4-4-4z"/></svg>';
const NOTE_MS = 6000;
const INTRO_GAP = 12;
const GRIP =
  '<svg viewBox="0 0 6 12" aria-hidden="true" focusable="false"><rect width="2" height="2"/><rect x="4" width="2" height="2"/>' +
  '<rect y="5" width="2" height="2"/><rect x="4" y="5" width="2" height="2"/><rect y="10" width="2" height="2"/><rect x="4" y="10" width="2" height="2"/></svg>';

// Built-in items keep fixed slots, so the order never depends on which plugin
// registered first. Any other id goes in its own section above the footer, in the
// order it was added.
// An item may also ask for the first or the last section with `section: "start" | "end"`.
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

// The first [clay-menu-slot] on the page holds the menu. With none, it floats in a corner.
function findSlot() {
  const slots = document.querySelectorAll("[clay-menu-slot]");
  if (slots.length > 1) console.warn("[clay] This page has more than one clay-menu-slot. The menu uses the first.");
  return slots[0] || null;
}

// A skin the page wrote, in <style clay-menu-skin="1" media="not all">. The media keeps it
// off the page itself. An unknown version means the default skin.
function pageSkin() {
  const style = document.querySelector("style[clay-menu-skin]");
  if (!style) return null;
  if (style.getAttribute("clay-menu-skin") !== SKIN_VERSION) {
    console.warn(`[clay] This runtime reads clay-menu-skin="${SKIN_VERSION}". The menu keeps its default look.`);
    return null;
  }
  return style.textContent;
}

function mount() {
  if (document.querySelector('clay-editor-ui[data-clay-ui="menu"]')) return;

  const slot = findSlot();
  const embedded = Boolean(slot);
  const skin = embedded ? pageSkin() : null;
  const hideSwitch = embedded && slot.hasAttribute("no-edit-switch");

  const root = document.createElement("div");
  root.className = "clay-menu-dock";
  root.setAttribute("clay", "editor-ui");
  root.setAttribute("part", "dock");
  if (embedded) root.dataset.embedded = "";
  root.dataset.corner = "top-right";
  root.innerHTML =
    `<div class="clay-menu" part="capsule" clay="editor-ui">` +
    `<button type="button" class="clay-menu-grip" aria-label="Move the menu. Drag it, or use the arrow keys to move it to another corner.">${GRIP}</button>` +
    `<button type="button" class="clay-menu-edit" part="edit" role="switch" aria-checked="false">` +
    `<span class="clay-menu-track" aria-hidden="true"><span class="clay-menu-thumb"></span></span>` +
    `<span class="clay-menu-label">Edit</span>` +
    `</button>` +
    `<span class="clay-menu-divider" aria-hidden="true"></span>` +
    `<button type="button" class="clay-menu-goo" part="button" aria-haspopup="menu" aria-expanded="false" aria-label="Clay menu">${CLAYGOO}</button>` +
    `</div>` +
    `<div class="clay-menu-list" part="list" role="menu" aria-label="Clay menu" hidden></div>` +
    `<div class="clay-menu-note" part="note" role="status" hidden></div>`;

  const grip = root.querySelector(".clay-menu-grip");
  const edit = root.querySelector(".clay-menu-edit");
  const goo = root.querySelector(".clay-menu-goo");
  const list = root.querySelector(".clay-menu-list");
  const noteEl = root.querySelector(".clay-menu-note");
  const items = new Map();

  if (embedded) {
    grip.hidden = true;
    const icon = slot.querySelector("template[clay-menu-icon]");
    if (icon) goo.replaceChildren(icon.content.cloneNode(true));
    const name = slot.getAttribute("clay-menu-label");
    if (name) {
      goo.setAttribute("aria-label", name);
      goo.title = name;
      list.setAttribute("aria-label", name);
    }
    if (hideSwitch) {
      edit.hidden = true;
      root.querySelector(".clay-menu-divider").hidden = true;
    }
  }

  // Embedded, the list opens in the top layer, so a header's overflow cannot clip it.
  const topLayer = embedded && typeof list.showPopover === "function";
  if (topLayer) list.setAttribute("popover", "manual");

  function placeList() {
    const anchor = goo.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = list;
    const left = Math.max(EDGE_GAP, Math.min(anchor.right - width, window.innerWidth - width - EDGE_GAP));
    const below = anchor.bottom + EDGE_GAP;
    const top = below + height > window.innerHeight - EDGE_GAP ? Math.max(EDGE_GAP, anchor.top - height - EDGE_GAP) : below;
    list.style.left = `${Math.round(left)}px`;
    list.style.top = `${Math.round(top)}px`;
  }

  // Focus inside the shadow root: document.activeElement only ever names the host.
  const focusedEl = () => root.getRootNode().activeElement || null;
  const isOpen = () => !list.hidden;

  function setExpanded(open) {
    list.hidden = !open;
    goo.setAttribute("aria-expanded", open ? "true" : "false");
    if (!topLayer) return;
    if (open) {
      list.showPopover();
      placeList();
    } else if (list.matches(":popover-open")) {
      list.hidePopover();
    }
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
    button.setAttribute("part", item.quiet ? "item quiet" : "item");
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
      if (item.run) item.run({ anchor: goo });
    });
    return button;
  }

  function itemNode(item) {
    if (item.text) {
      const line = document.createElement("p");
      line.className = "clay-menu-version";
      line.setAttribute("part", "text");
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
    if (item.dismiss) return dismissibleRow(item);
    return itemButton(item);
  }

  function dismissibleRow(item) {
    const row = document.createElement("div");
    row.className = "clay-menu-row";
    row.dataset.menuId = item.id;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("role", "menuitem");
    dismiss.setAttribute("part", "dismiss");
    dismiss.dataset.menuId = `${item.id}.dismiss`;
    dismiss.setAttribute("aria-label", item.dismiss.label);
    dismiss.title = item.dismiss.label;
    dismiss.innerHTML = DISMISS_ICON;
    dismiss.addEventListener("click", () => {
      removeItem(item.id);
      item.dismiss.run?.();
    });
    row.append(itemButton(item), dismiss);
    return row;
  }

  function sections() {
    const inSection = (name) => [...items.values()].filter((item) => item.section === name);
    const extra = [...items.keys()].filter((id) => !SLOTTED.has(id) && !items.get(id).section);
    const fixed = SECTIONS.map((ids) => (ids || extra).map((id) => items.get(id)).filter(Boolean));
    return [inSection("start"), ...fixed, inSection("end")].filter((group) => group.length);
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
        sep.setAttribute("part", "separator");
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

  function addItem({ id, label, run, badge, keys, disabled, text, pair, href, section, quiet, dismiss } = {}) {
    if (!id) return null;
    const item = clean({ id, label, run, badge, keys, disabled, href });
    if (text) item.text = true;
    if (Array.isArray(pair)) item.pair = pair.map(clean);
    if (section === "start" || section === "end") item.section = section;
    if (quiet) item.quiet = true;
    if (dismiss) item.dismiss = { label: String(dismiss.label || "Dismiss"), run: typeof dismiss.run === "function" ? dismiss.run : null };
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
    if (hideSwitch) addItem({ id: "clay.mode", label: currentMode() === "edit" ? "View mode" : "Edit mode", section: "start", run: () => edit.click() });
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

  const css = embedded ? [MENU_BASE, skin ?? MENU_SKIN, MENU_TOUCH] : [MENU_BASE, MENU_FLOATING, MENU_SKIN, MENU_TOUCH];
  const ui = mountEditorUI({ name: "menu", content: root, css, parent: slot || document.body, attributes: { "clay-mode-toggle": "" } });
  if (embedded) {
    window.addEventListener("resize", close);
    window.addEventListener("scroll", () => { if (topLayer && isOpen()) placeList(); }, { capture: true, passive: true });
  } else {
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
  }
  if (!skin) followLook(root, root.querySelector(".clay-menu"), MENU_SURFACE);

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

  window.clay.menu = { addItem, removeItem, open, close, note: showNote, embedded, button: goo };
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
