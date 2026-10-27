// The page editor's chrome: a faint toolbar, a plus button beside the caret's
// line, a toolbar over a text selection and a block menu (from the plus or "/").
// At rest everything is faint; moving the pointer adds .is-moved to the shell,
// which themes darken by a small step. All of it is themed through the
// --page-* tokens in editor.js (contract: default-page/v1/look/THEME-CONTRACT.md).
import { state, commands } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { BlockSelection, siblingSpan, moveBlock, indentBlocks, outdentBlocks } from "./blocks.js";
import { outlineOf } from "./outline-cache.js";
import { currentSpan, selectBlocks, duplicateBlocks, deleteBlocks, asStep, typeIntoBlocks } from "./blocksel.js";
import { openAltEditor, setImageAttrs } from "./media.js";
import { BlockDrag } from "./drag.js";
import { openLinkEditor } from "./link.js";
import { BLOCK_TYPES, MENU_ITEMS, blockTypeOf, turnInto, insertAfter, rankItems, runItem, retype, canTurnInto, insertItemsFor, loadChartPart } from "./items.js";
import toast from "../ui/toast-lazy.js";
import { pickCsv } from "./csv-import.js";
import { HISTORY_INTENT, typingIntent } from "./history-intent.js";
import { composing } from "./markdown.js";
import { announce } from "./announce.js";

export { BLOCK_TYPES, blockTypeOf, turnInto, insertAfter } from "./items.js";

const { Plugin, PluginKey, TextSelection, NodeSelection } = state;
const M = schema.marks;
const N = schema.nodes;

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const selectedRoots = (st) => {
  const ents = outlineOf(st.doc);
  const { lo, hi } = st.selection.span(st.doc);
  return ents.slice(lo, hi + 1).filter((e) => e.up === ents[lo].up);
};

const imageId = (view, index) => view.state.doc.child(index).attrs.id;
const blockStart = (doc, index) => { let at = 0; for (let i = 0; i < index; i++) at += doc.child(i).nodeSize; return at; };

// The editor attributes a menu lends it while it is open. A slash menu puts them
// back as it found them; every other menu clears them.
const POPUP_ATTRS = ["aria-haspopup", "aria-controls", "aria-activedescendant"];
const TARGET_GONE = "That block is no longer available.";
const CANNOT_CONVERT = "This block holds content from a newer version, so it can't be converted here.";

// The part of the window the person can see: the visual viewport when the
// browser has one, so a keyboard or a pinch does not hide the bar.
export function phoneViewport(win) {
  const v = win.visualViewport;
  return v ? { left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height }
    : { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight };
}

export function phoneBarBox(v, width, height, safeBottom = 0) {
  const inset = PHONE_INSET;
  const w = Math.min(width, Math.max(0, v.width - inset * 2));
  return {
    left: v.left + (v.width - w) / 2,
    top: Math.max(v.top + inset, v.top + v.height - height - safeBottom - inset),
    width: w,
  };
}

export function blockLink(id, loc = globalThis.location) {
  return `${loc.origin}${loc.pathname}${loc.search}#${encodeURIComponent(id)}`;
}

function copyBlockLink(id) {
  if (!id) return;
  const done = () => toast("Link copied");
  const failed = () => toast("Could not copy the link.", "error");
  const write = globalThis.navigator?.clipboard?.writeText;
  if (!write) { failed(); return; }
  globalThis.navigator.clipboard.writeText(blockLink(id)).then(done, failed);
}

export const ACTION_ITEMS = [
  { key: "up", label: "Move up", icon: "↑", hint: `${MOD}⇧↑`, run: (view) => moveBlock(-1)(view.state, view.dispatch) },
  { key: "down", label: "Move down", icon: "↓", hint: `${MOD}⇧↓`, run: (view) => moveBlock(1)(view.state, view.dispatch) },
  { key: "indent", label: "Indent", icon: "→", hint: "Tab", run: (view) => indentBlocks(view.state, view.dispatch) },
  { key: "outdent", label: "Outdent", icon: "←", hint: "⇧Tab", run: (view) => outdentBlocks(view.state, view.dispatch) },
  { key: "duplicate", label: "Duplicate", icon: "⧉", hint: `${MOD}D`, run: (view) => duplicateBlocks(view.state, view.dispatch) },
  { key: "delete", label: "Delete", icon: "×", hint: "Del", run: (view) => deleteBlocks(view.state, view.dispatch) },
  { key: "turn", label: "Turn into", icon: "↻", hint: "›", only: "text", run: (view, chrome) => chrome.openMenu("turn", chrome.plus) },
  { key: "link", label: "Copy link", icon: "🔗", run: (view, chrome, index) => copyBlockLink(view.state.doc.child(index).attrs.id) },
  { key: "alt", label: "Alt text…", icon: "Aa", only: "image", focus: false, run: (view, chrome, index) => openAltEditor(view, imageId(view, index)) },
  { key: "small", label: "Small", icon: "▫", only: "image", run: (view, chrome, index) => setImageAttrs(view, imageId(view, index), { width: 240 }) },
  { key: "medium", label: "Medium", icon: "◻", only: "image", run: (view, chrome, index) => setImageAttrs(view, imageId(view, index), { width: 480 }) },
  { key: "full", label: "Full width", icon: "⬜", only: "image", run: (view, chrome, index) => setImageAttrs(view, imageId(view, index), { width: null }) },
  { key: "chart", label: "Chart this table", icon: "📊", only: "table", run: (view, chrome, index) => { const at = blockStart(view.state.doc, index); return loadChartPart(view).then(({ insertChartAfterTable }) => insertChartAfterTable(view, at)); } },
  { key: "csv", label: "Import CSV…", icon: "⇧", only: "table", focus: false, run: (view, chrome, index) => pickCsv(view, null, view.state.doc.child(index).attrs.id) },
];

const actionsFor = (st) => {
  if (!(st.selection instanceof BlockSelection)) return [];
  const roots = selectedRoots(st);
  const text = roots.every((e) => e.node.isTextblock);
  const image = roots.length === 1 && roots[0].node.type === N.image;
  const table = roots.length === 1 && roots[0].node.type === N.table;
  return ACTION_ITEMS.filter((a) => (a.only === "text" ? text : a.only === "image" ? image : a.only === "table" ? table : true));
};

const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  grip: svg('<path stroke-width="2.2" d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01"/>'),
  strong: svg('<path d="M5 3h4a2.5 2.5 0 0 1 0 5H5zM5 8h4.6a2.5 2.5 0 0 1 0 5H5z"/>'),
  em: svg('<path d="M10 3H6.5M9.5 13H6M9 3l-2 10"/>'),
  strike: svg('<path d="M3 8h10M10.8 5.2C10.5 4 9.4 3.2 8 3.2c-1.7 0-2.8.9-2.8 2.1M5.2 10.8c.3 1.2 1.4 2 2.8 2 1.7 0 2.8-.9 2.8-2.1"/>'),
  code: svg('<path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5"/>'),
  link: svg('<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7"/>'),
  bullet: svg('<path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/><path stroke-width="2.4" d="M3 4.5h.01M3 8h.01M3 11.5h.01"/>'),
  ordered: svg('<path d="M7 4.5h6.5M7 8h6.5M7 11.5h6.5M2.5 3.5l1-.5v3M2.5 9.3c.2-.5.6-.8 1.1-.8.6 0 1 .4 1 .9 0 .9-2.1 1.4-2.1 2.6h2.1"/>'),
  check: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8.2l1.8 1.8 3.4-4"/>'),
  more: svg('<path stroke-width="2.2" d="M3 8h.01M8 8h.01M13 8h.01"/>'),
};
const TOOLS = [
  ["strong", "Bold"],
  ["em", "Italic"],
  ["strike", "Strikethrough"],
  ["link", "Link"],
  ["bullet", "Bulleted list"],
  ["ordered", "Numbered list"],
  ["check", "Checklist"],
  ["code", "Code"],
];
// The four controls a phone toolbar keeps: bold, italic, link and the menu that
// holds everything else. Wider screens show every tool.
const PHONE_TOOLS = new Set(["strong", "em", "link"]);
const MORE_ACTIONS = new Set(["up", "down", "indent", "outdent"]);
const PHONE_BAR_WIDTH = 204, PHONE_BAR_HEIGHT = 52, PHONE_INSET = 8;
const LIST_KINDS = new Set(["bullet", "ordered", "check"]);
const LINE_TYPES = new Set(["paragraph", "heading", "list_item"]);

// The top-level blocks a toolbar command acts on. A nonempty selection's end is
// exclusive, so a block that only starts there is left out.
const blocksIn = (st) => {
  const sel = st.selection;
  if (sel instanceof BlockSelection) return selectedRoots(st).map((e) => e.i);
  const { $from, $to, empty } = sel;
  const last = Math.min(!empty && $to.depth === 0 ? $to.index(0) - 1 : $to.index(0), st.doc.childCount - 1);
  const out = [];
  for (let i = $from.index(0); i <= last; i++) out.push(i);
  return out;
};

const listable = (st) => blocksIn(st).filter((i) => { const n = st.doc.child(i); return n.isTextblock && n.type !== N.code_block; });
const isKind = (node, kind) => node.type === N.list_item && node.attrs.kind === kind;
const listActive = (st, kind) => { const idx = listable(st); return idx.length > 0 && idx.every((i) => isKind(st.doc.child(i), kind)); };

const lineText = (node) => {
  let text = "";
  node.forEach((c) => { text += c.isText ? c.text : c.type === N.hard_break ? "\n" : ""; });
  return text;
};

// The selection covers whole lines when it runs from the start of its first
// block to the end of its last, and every block is a plain line of text.
function wholeLines(st) {
  const { $from, $to, empty } = st.selection;
  if (empty || !(st.selection instanceof TextSelection) || $from.depth !== 1 || $to.depth !== 1) return null;
  if ($from.parentOffset !== 0 || $to.parentOffset !== $to.parent.content.size) return null;
  const idx = blocksIn(st);
  return idx.every((i) => LINE_TYPES.has(st.doc.child(i).type.name)) ? idx : null;
}

function codeBlockTr(st, idx) {
  const first = st.doc.child(idx[0]);
  const from = st.selection.$from.before(1);
  const to = st.selection.$to.after(1);
  const text = idx.map((i) => lineText(st.doc.child(i))).join("\n");
  const { id, pos, parent } = first.attrs;
  const tr = st.tr.replaceWith(from, to, N.code_block.create({ id, pos, parent }, text ? schema.text(text) : null));
  return tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + text.length));
}

// The way back: each selected code block becomes one text line per line of code.
// The first line keeps the block's id; the rest get new ids from the identity plugin.
function codeLinesTr(st, idx) {
  const tr = st.tr;
  const from = st.doc.resolve(st.selection.from).before(1);
  let end = 0;
  for (const i of [...idx].reverse()) {
    let at = 0;
    for (let k = 0; k < i; k++) at += st.doc.child(k).nodeSize;
    const node = st.doc.child(i);
    const { id, pos, parent } = node.attrs;
    const lines = node.textContent.split("\n").map((line, k) => N.paragraph.create(k === 0 ? { id, pos, parent } : { parent }, line ? schema.text(line) : null));
    tr.replaceWith(at, at + node.nodeSize, lines);
    if (!end) end = at + lines.reduce((n, l) => n + l.nodeSize, 0);
  }
  end = tr.mapping.slice(1).map(end);
  return tr.setSelection(TextSelection.create(tr.doc, from + 1, end - 1));
}

const allCode = (st) => { const idx = blocksIn(st); return idx.length > 0 && idx.every((i) => st.doc.child(i).type === N.code_block) ? idx : null; };

function toolActive(st, name) {
  if (LIST_KINDS.has(name)) return listActive(st, name);
  if (name === "code" && allCode(st)) return true;
  const type = M[name];
  const { from, to, empty, $from } = st.selection;
  if (empty) return !!type.isInSet(st.storedMarks || $from.marks());
  return st.doc.rangeHasMark(from, to, type);
}

function runList(view, kind) {
  const st = view.state;
  const off = listActive(st, kind);
  const item = BLOCK_TYPES.find((b) => b.key === (off ? "text" : kind));
  const idx = listable(st).filter((i) => off || !isKind(st.doc.child(i), kind));
  if (idx.some((i) => !canTurnInto(st.doc.child(i), item))) {
    announce(view, CANNOT_CONVERT);
    return;
  }
  const tr = st.tr;
  for (const i of idx) retype(tr, i, item);
  if (tr.docChanged) view.dispatch(asStep(tr));
}

// The four formats this release adds are commands the format gate may refuse, and
// a refusal is a notice rather than a change. The menu that offers them, and the
// commands behind it, load the first time one is chosen (format-native-commands.js).
const nativeMenu = (view, chrome, name) => import("./format-native-commands.js").then((menu) => menu.nativeMenu(view, name, chrome.more));

function runMark(view, name) {
  if (name === "link") return openLinkEditor(view);
  const st = view.state;
  const code = name === "code" ? allCode(st) : null;
  const lines = name === "code" && !code ? wholeLines(st) : null;
  if (LIST_KINDS.has(name)) runList(view, name);
  else if (code) view.dispatch(asStep(codeLinesTr(st, code)).scrollIntoView());
  else if (lines && lines.some((i) => !canTurnInto(st.doc.child(i), BLOCK_TYPES.find((b) => b.key === "code")))) announce(view, CANNOT_CONVERT);
  else if (lines) view.dispatch(asStep(codeBlockTr(st, lines)).scrollIntoView());
  else commands.toggleMark(M[name])(st, view.dispatch);
  view.focus();
}

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function toolButton(name, label) {
  const b = el("button", `page-tool${PHONE_TOOLS.has(name) ? " page-tool-primary" : " page-tool-desk"}`, { type: "button", "data-cmd": name, "aria-label": label, title: label });
  b.innerHTML = ICONS[name];
  return b;
}

const MOVED_MS = 1600;
let menuCount = 0;
export const chromeKey = new PluginKey("page-chrome");
const chromeFor = new WeakMap();

// A range a slash menu chose, held in plugin state so it follows the document
// while the action it belongs to waits for code to load.
export const slashRangeKey = new PluginKey("page-slash-range");
const slashRangeState = {
  init: () => null,
  apply(tr, value) {
    let held = value;
    if (held && tr.docChanged) {
      const from = tr.mapping.map(held.from, 1), to = tr.mapping.map(held.to, -1);
      held = from <= to && tr.doc.textBetween(from, to) === held.text ? { ...held, from, to } : null;
    }
    const m = tr.getMeta(slashRangeKey);
    if (m !== undefined) held = m;
    return held;
  },
};

export const slashRangePlugin = () => new Plugin({ key: slashRangeKey, state: slashRangeState });

export const holdSlashRange = (view, range) => {
  const text = range ? view.state.doc.textBetween(range.from, range.to) : null;
  view.dispatch(view.state.tr.setMeta(slashRangeKey, range ? { ...range, text } : null));
};

export const heldSlashRange = (st) => {
  const held = slashRangeKey.getState(st);
  return held ? { from: held.from, to: held.to } : null;
};

export function openPageMenu(view, anchor, items) {
  const chrome = chromeFor.get(view);
  if (!chrome) return false;
  chrome.openMenu("external", anchor);
  chrome.menu.externalItems = items;
  chrome.renderMenu();
  return true;
}

class Chrome {
  constructor(view, onAiTool) {
    this.view = view;
    this.onAiTool = onAiTool;
    this.shell = view.dom.parentElement;
    this.menu = null;
    this.priorAria = null;
    this.movedTimer = 0;
    this.hover = null;
    this.pendingHover = null;
    this.win = view.dom.ownerDocument.defaultView ?? globalThis;
    this.frame = null;
    this.destroyed = false;
    this.probe = null;
    this.roving = null;

    this.dock = el("div", "page-dock", { role: "toolbar", "aria-label": "Formatting" });
    this.turn = el("button", "page-tool page-tool-turn page-tool-desk", { type: "button", "aria-haspopup": "menu" });
    this.more = el("button", "page-tool page-tool-primary page-tool-more", { type: "button", "aria-label": "More", title: "More", "aria-haspopup": "menu" });
    this.more.innerHTML = ICONS.more;
    this.dock.append(this.turn, el("span", "page-tool-sep page-tool-desk"), ...TOOLS.map(([n, l]) => toolButton(n, l)), this.more);
    this.plus = el("button", "page-plus", { type: "button", "aria-label": "Add a block", title: "Add a block" });
    this.plus.innerHTML = ICONS.plus;
    this.grip = el("button", "page-grip", { type: "button", "aria-label": "Block actions", title: "Drag to move, click for actions", "aria-haspopup": "menu" });
    this.grip.innerHTML = ICONS.grip;
    this.bubble = el("div", "page-bubble", { role: "toolbar", "aria-label": "Selection", hidden: "" });
    this.bubble.append(...TOOLS.map(([n, l]) => toolButton(n, l)));
    this.menuId = `page-menu-${++menuCount}`;
    this.menuEl = el("div", "page-menu", { role: "menu", id: this.menuId, hidden: "" });
    this.scrim = el("div", "page-scrim", { hidden: "" });
    this.shell.insertBefore(this.dock, view.dom);
    this.shell.append(this.plus, this.grip, this.bubble, this.scrim, this.menuEl);

    const keepFocus = (e) => e.preventDefault();
    for (const part of [this.dock, this.plus, this.grip, this.bubble, this.menuEl]) part.addEventListener("mousedown", keepFocus);
    for (const bar of [this.dock, this.bubble]) {
      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-cmd]");
        if (b) runMark(this.view, b.dataset.cmd);
      });
    }
    this.turn.addEventListener("click", () => this.toggleMenu("turn", this.turn));
    this.more.addEventListener("click", () => this.toggleMenu("more", this.more));
    this.dock.addEventListener("keydown", (e) => this.dockKey(e));
    this.plus.addEventListener("click", () => this.fromPlus());
    this.grip.addEventListener("click", (e) => {
      if (e.detail === 0) this.gripAction(this.gutterIndex());
    });
    this.drag = new BlockDrag(view, this.grip, { index: () => this.gutterIndex(), onClick: (i) => this.gripAction(i) });
    this.scrim.addEventListener("click", () => this.closeMenu());
    this.menuEl.addEventListener("click", (e) => {
      const row = e.target.closest(".page-menu-item");
      if (row) this.pick(Number(row.dataset.index));
    });
    this.menuEl.addEventListener("keydown", (e) => {
      if (this.key(e)) e.preventDefault();
    });
    this.onMove = (e) => {
      this.shell.classList.add("is-moved");
      clearTimeout(this.movedTimer);
      this.movedTimer = setTimeout(() => this.shell.classList.remove("is-moved"), MOVED_MS);
      this.trackHover(e);
    };
    this.onKey = () => {
      clearTimeout(this.movedTimer);
      this.shell.classList.remove("is-moved");
      this.pendingHover = null;
      this.setHover(null);
    };
    this.onLeave = () => { this.pendingHover = null; this.setHover(null); };
    this.onResize = () => this.scheduleLayout();
    this.onDocDown = (e) => {
      if (!this.menu) return;
      if ([this.menuEl, this.plus, this.grip, this.turn].some((part) => part.contains(e.target))) return;
      this.closeMenu();
    };
    document.addEventListener("mousedown", this.onDocDown, true);
    this.shell.addEventListener("mousemove", this.onMove);
    this.shell.addEventListener("mouseleave", this.onLeave);
    this.shell.addEventListener("keydown", this.onKey);
    this.win.addEventListener("resize", this.onResize);
    this.win.addEventListener("scroll", this.onResize, true);
    this.win.visualViewport?.addEventListener("resize", this.onResize);
    this.win.visualViewport?.addEventListener("scroll", this.onResize);
    this.update(view, null);
  }

  blockIndex() {
    const st = this.view.state, sel = st.selection;
    const pos = sel instanceof BlockSelection || sel instanceof NodeSelection ? sel.from : sel.head;
    return Math.min(st.doc.resolve(pos).index(0), st.doc.childCount - 1);
  }

  isPhone() {
    return !!this.win?.matchMedia?.("(max-width: 560px)").matches;
  }

  gutterIndex() {
    if (this.isPhone()) return this.blockIndex();
    this.settleHover();
    return Math.min(this.hover ?? this.blockIndex(), this.view.state.doc.childCount - 1);
  }

  dockControls() {
    const all = [...this.dock.querySelectorAll("button")].filter((b) => this.rendered(b));
    return this.isPhone() ? all.filter((b) => b.classList.contains("page-tool-primary")) : all;
  }

  // Every transaction asks whether the roving control is still usable: one style read for
  // that control, not one for every button in the dock.
  inRoving(control) {
    if (!control || !this.dock.contains(control)) return false;
    if (this.isPhone() && !control.classList.contains("page-tool-primary")) return false;
    return this.rendered(control);
  }

  rendered(control) {
    if (control.hidden) return false;
    const style = this.win?.getComputedStyle?.(control);
    return !style || style.display !== "none";
  }

  setRoving(target) {
    this.roving = target;
    const roving = new Set(this.dockControls());
    for (const b of this.dock.querySelectorAll("button")) b.tabIndex = b === target && roving.has(b) ? 0 : -1;
  }

  // The block selection's own Escape still runs first, and then the keyboard
  // leaves the writing surface for the toolbar.
  leaveToToolbar() {
    queueMicrotask(() => {
      if (!this.view.isDestroyed) this.focusToolbar();
    });
  }

  focusToolbar() {
    const [first] = this.dockControls();
    if (!first) return false;
    this.setRoving(first);
    first.focus();
    return true;
  }

  // Left and Right walk the toolbar; Escape hands the keyboard back to the
  // editor. Tab is left alone, so it leaves the toolbar.
  dockKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.view.focus();
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const list = this.dockControls();
    const at = list.indexOf(event.target);
    if (at < 0) return;
    event.preventDefault();
    const next = list[(at + (event.key === "ArrowRight" ? 1 : -1) + list.length) % list.length];
    this.setRoving(next);
    next.focus();
  }

  // The blocks a menu's commands act on, by id, so a peer's edit between opening
  // the menu and running the command cannot retarget them.
  selectionIds() {
    const st = this.view.state;
    return blocksIn(st).map((i) => st.doc.child(i).attrs.id);
  }

  idIndex(id) {
    let found = -1;
    this.view.state.doc.forEach((n, _, i) => { if (n.attrs.id === id) found = i; });
    return found;
  }

  // Where Escape sends focus: the control that opened the menu when it can hold
  // focus, otherwise the editor.
  invoker() {
    const m = this.menu;
    if (!m || m.slashAt !== null) return this.view.dom;
    const a = m.anchor;
    return a && a !== this.view.dom && (a.tagName === "BUTTON" || a.hasAttribute("tabindex")) ? a : this.view.dom;
  }

  // A block action from the phone menu acts on the caret's block when nothing
  // more is selected, as the desktop command does.
  selectCaretBlock(ids = null) {
    const st = this.view.state;
    if (st.selection instanceof BlockSelection) return;
    const found = (ids ?? []).map((id) => this.idIndex(id)).filter((i) => i >= 0);
    const first = found.length ? found[0] : this.blockIndex();
    this.view.dispatch(st.tr.setSelection(selectBlocks(st.doc, first, found.length ? found[found.length - 1] : first)));
  }

  gripAction(index) {
    if (this.menu) this.closeMenu();
    else this.openActions(this.grip, index);
  }

  trackHover(event) {
    if (this.menu || this.drag.state || [this.plus, this.grip, this.dock, this.bubble].some((part) => part.contains(event.target))) return;
    this.pendingHover = { clientY: event.clientY };
    this.scheduleLayout();
  }

  // The pointer's block, read once per frame from the newest move.
  hoverAt(clientY) {
    const view = this.view;
    const hit = view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 2, top: clientY });
    if (!hit) return;
    const doc = view.state.doc;
    const ents = outlineOf(doc);
    let i = Math.min(doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos).index(0), ents.length - 1);
    while (i > 0 && ents[i].hidden) i--;
    this.hover = i;
  }

  setHover(i) {
    if (i === this.hover) return;
    this.hover = i;
    this.scheduleLayout();
  }

  settleHover() {
    if (!this.pendingHover) return;
    const { clientY } = this.pendingHover;
    this.pendingHover = null;
    this.hoverAt(clientY);
  }

  fromPlus() {
    this.view.focus();
    const i = this.gutterIndex();
    this.openMenu("insert", this.plus, null, null, this.view.state.doc.child(i).attrs.id);
  }

  toggleMenu(mode, anchor) {
    if (this.menu) this.closeMenu();
    else this.openMenu(mode, anchor);
  }

  openMenu(mode, anchor, slashAt = null, ids = null, anchorId = null) {
    this.menu = { mode, anchor, slashAt, anchorId, ids: ids ?? (mode === "insert" ? [] : this.selectionIds()), query: "", active: 0, items: [] };
    anchor.setAttribute("aria-expanded", "true");
    if (slashAt !== null) {
      if (!this.priorAria) this.priorAria = POPUP_ATTRS.map((name) => [name, this.view.dom.getAttribute(name)]);
      this.view.dom.setAttribute("aria-haspopup", "listbox");
    } else this.view.dom.setAttribute("aria-haspopup", "menu");
    this.view.dom.setAttribute("aria-controls", this.menuId);
    this.renderMenu();
  }

  closeMenu() {
    this.menu?.anchor.setAttribute("aria-expanded", "false");
    this.menu = null;
    this.menuEl.hidden = true;
    this.scrim.hidden = true;
    if (this.priorAria) {
      for (const [name, value] of this.priorAria) {
        if (value === null) this.view.dom.removeAttribute(name);
        else this.view.dom.setAttribute(name, value);
      }
      this.priorAria = null;
    } else for (const name of POPUP_ATTRS) this.view.dom.removeAttribute(name);
  }

  // Everything the phone toolbar folds away: the rest of the formatting, and the
  // block actions the desktop menu carries. The move commands are the same ones.
  moreItems() {
    const tools = TOOLS.filter(([name]) => !PHONE_TOOLS.has(name))
      .map(([name, label]) => ({ key: name, label, icon: ICONS[name], run: (view) => runMark(view, name) }));
    const actions = ACTION_ITEMS.filter((a) => MORE_ACTIONS.has(a.key)).map((a) => ({ ...a, blocks: true }));
    return [
      ...tools,
      { key: "underline", label: "Underline", icon: "U", hint: `${MOD}u`, run: (view, chrome) => nativeMenu(view, chrome, "underline") },
      { key: "text_color", label: "Text color", icon: "A", hint: "\u203a", run: (view, chrome) => nativeMenu(view, chrome, "text_color") },
      { key: "highlight", label: "Highlight", icon: "\u25A0", hint: "\u203a", run: (view, chrome) => nativeMenu(view, chrome, "highlight") },
      { key: "turn", label: "Turn into", icon: "\u21bb", run: (view, chrome) => chrome.openMenu("turn", chrome.more) },
      { key: "insert", label: "Insert", icon: "+", run: (view, chrome) => chrome.openMenu("insert", chrome.more, null, null, view.state.doc.child(chrome.blockIndex()).attrs.id) },
      ...actions,
    ];
  }

  menuItems(m) {
    if (m.mode === "external") return m.externalItems || [];
    if (m.mode === "actions") return actionsFor(this.view.state);
    if (m.mode === "more") return this.moreItems();
    const items = m.mode === "turn" ? BLOCK_TYPES : insertItemsFor(this.view.state, this.onAiTool
      ? [...MENU_ITEMS, { key: "ai", label: "Make a tool with AI…", icon: "✦", aliases: ["tool", "generate"], insert: "ai" }]
      : MENU_ITEMS);
    return rankItems(items, m.query);
  }

  // The types the blocks in the selection are now. A mixed selection has more
  // than one and so checks no row.
  currentTypes() {
    const st = this.view.state;
    return new Set(blocksIn(st).map((i) => blockTypeOf(st.doc.child(i)).key));
  }

  openActions(anchor = this.plus, at = null) {
    const st = this.view.state;
    const ents = outlineOf(st.doc);
    const sel = st.selection;
    const inside = at !== null && sel instanceof BlockSelection && sel.span(st.doc).lo <= at && at <= sel.span(st.doc).hi;
    const { lo, hi } = at === null || inside ? currentSpan(st, ents) : siblingSpan(ents, at, at);
    this.view.dispatch(st.tr.setSelection(selectBlocks(st.doc, lo, hi, ents)));
    const ids = [];
    for (let i = lo; i <= hi; i++) ids.push(st.doc.child(i).attrs.id);
    this.openMenu("actions", anchor, null, ids);
  }

  renderMenu() {
    const m = this.menu;
    m.items = this.menuItems(m);
    m.active = Math.min(m.active, Math.max(0, m.items.length - 1));
    const slash = m.slashAt !== null;
    const current = m.mode === "turn" ? this.currentTypes() : null;
    this.menuEl.setAttribute("role", slash ? "listbox" : "menu");
    const nodes = [];
    if (m.mode === "turn") {
      const title = el("div", "page-menu-title");
      title.textContent = m.query ? `Turn into “${m.query}”` : "Turn into";
      nodes.push(title);
    }
    if (!m.items.length) {
      const none = el("div", "page-menu-empty");
      none.textContent = "No matching blocks";
      nodes.push(none);
    }
    m.items.forEach((b, i) => {
      const active = i === m.active;
      const checked = current ? current.size === 1 && b.key === [...current][0] : (typeof b.checked === "boolean" ? b.checked : null);
      const role = m.mode === "turn" ? "menuitemradio" : typeof checked === "boolean" ? "menuitemcheckbox" : slash ? "option" : "menuitem";
      const row = el("button", `page-menu-item${active ? " is-active" : ""}`, { type: "button", role, tabindex: !slash && active ? "0" : "-1", id: `${this.menuId}-${i}`, "data-index": String(i), ...(role === "menuitemradio" ? {} : { "aria-selected": active ? "true" : "false" }), ...(typeof checked === "boolean" ? { "aria-checked": String(checked) } : {}) });
      const icon = el("span", "page-menu-icon");
      icon.textContent = b.icon || "";
      const label = el("span", "page-menu-label");
      label.textContent = b.label;
      if (b.description) {
        const text = el("span", "page-menu-text");
        const description = el("span", "page-menu-desc");
        description.textContent = b.description;
        text.append(label, description);
        row.append(icon, text);
      } else row.append(icon, label);
      if (b.hint) {
        const hint = el("span", "page-menu-hint");
        hint.textContent = b.hint;
        row.append(hint);
      }
      nodes.push(row);
    });
    this.menuEl.replaceChildren(...nodes);
    if (slash && m.items.length) this.view.dom.setAttribute("aria-activedescendant", `${this.menuId}-${m.active}`);
    else this.view.dom.removeAttribute("aria-activedescendant");
    this.menuEl.hidden = false;
    this.scrim.hidden = false;
    this.scheduleLayout();
    if (!slash) this.menuEl.querySelectorAll("button")[m.active]?.focus();
  }

  pick(i) {
    const m = this.menu;
    const item = m?.items[i];
    if (!item) return;
    const st = this.view.state;
    const remove = m.slashAt !== null && st.selection.head >= m.slashAt ? { from: m.slashAt - 1, to: st.selection.head } : null;
    // Resolve what the menu chose against the current document: a block a peer
    // removed cancels the command instead of handing it whatever took its place.
    const wanted = m.mode === "insert" ? (m.anchorId ? [m.anchorId] : []) : m.ids;
    const stale = wanted.some((id) => !id || this.idIndex(id) < 0);
    const index = wanted.length ? this.idIndex(wanted[0]) : -1;
    this.closeMenu();
    if (stale && m.mode !== "external") {
      announce(this.view, TARGET_GONE);
      this.view.focus();
      return;
    }
    if (m.mode === "turn") {
      if (wanted.some((id) => !canTurnInto(st.doc.child(this.idIndex(id)), item))) {
        announce(this.view, CANNOT_CONVERT);
        this.view.focus();
        return;
      }
      const turn = () => {
        const tr = this.view.state.tr;
        for (const id of wanted) {
          const at = this.idIndex(id);
          if (at >= 0) retype(tr, at, item);
        }
        if (tr.docChanged) this.view.dispatch(asStep(tr).scrollIntoView());
        return true;
      };
      // A block type from a later format asks the gate before it writes.
      if (item.type === "quote") {
        const view = this.view;
        import("./format-native-commands.js").then((menu) => menu.gateTurn(view, turn));
      } else turn();
      this.view.focus();
    } else if (m.mode === "actions" || m.mode === "more" || m.mode === "external") {
      if (item.blocks) this.selectCaretBlock(wanted);
      item.run(this.view, this, index >= 0 ? index : this.blockIndex());
      if (!this.menu && item.focus !== false) this.view.focus();
    } else {
      if (item.insert === "ai") this.onAiTool(this.view, remove);
      else runItem(this.view, item, index >= 0 ? index : this.blockIndex(), remove);
    }
  }

  // Keys while the menu is open; anything else falls through to the editor.
  key(event) {
    if (composing(event, this.view)) return false;
    const m = this.menu;
    if (!m) {
      if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey
        && this.view.state.selection instanceof BlockSelection) this.leaveToToolbar();
      return false;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && m.mode === "actions"
      && this.view.state.selection instanceof BlockSelection) {
      this.closeMenu();
      this.view.focus();
      deleteBlocks(this.view.state, this.view.dispatch);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (m.items.length) {
        m.active = (m.active + (event.key === "ArrowDown" ? 1 : -1) + m.items.length) % m.items.length;
        this.renderMenu();
      }
      return true;
    }
    if (event.key === "Enter") {
      if (m.items.length) this.pick(m.active);
      return true;
    }
    if (event.key === "Escape") {
      const target = this.invoker();
      this.closeMenu();
      if (target === this.view.dom) this.view.focus();
      else target?.focus?.();
      return true;
    }
    return false;
  }

  // "/" typed at the start of a line or after a space opens the menu; the text
  // typed after it filters. With no match the menu stays up saying so, until a
  // space ends the session or Backspace brings a match back.
  slashQuery() {
    const m = this.menu;
    if (!m || m.slashAt === null) return;
    const { $head } = this.view.state.selection;
    const start = $head.start();
    if ($head.pos < m.slashAt || m.slashAt < start || this.view.state.doc.textBetween(m.slashAt - 1, m.slashAt) !== "/") return this.closeMenu();
    m.query = this.view.state.doc.textBetween(m.slashAt, $head.pos);
    m.active = 0;
    if (/\s$/.test(m.query) && !this.menuItems(m).length) return this.closeMenu();
    this.renderMenu();
  }

  scheduleLayout() {
    if (this.frame !== null || this.destroyed) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      if (this.destroyed) return;
      const layout = this.measureLayout();
      this.paintLayout(layout);
    });
  }

  // The safe-area inset the browser reports, read through one hidden probe.
  safeBottom() {
    if (!this.probe) {
      this.probe = el("div", "page-safe-probe");
      this.shell.append(this.probe);
    }
    return parseFloat(this.win.getComputedStyle(this.probe).paddingBottom) || 0;
  }

  // A menu stays inside the visible viewport, above the bar when there is room.
  menuBox(bar) {
    const v = phoneViewport(this.win);
    const maxHeight = Math.max(0, v.height - PHONE_INSET * 2);
    const width = Math.min(280, Math.max(0, v.width - PHONE_INSET * 2));
    const applied = this.menuEl.style.getPropertyValue("--page-pop-max");
    this.menuEl.style.removeProperty("--page-pop-max");
    const natural = this.menuEl.offsetHeight || 0;
    if (applied) this.menuEl.style.setProperty("--page-pop-max", applied);
    const height = Math.min(natural, maxHeight);
    const left = Math.max(v.left + PHONE_INSET, Math.min(bar.left, v.left + v.width - PHONE_INSET - width));
    let top = bar.top - 6 - height;
    if (top < v.top + PHONE_INSET) top = Math.min(bar.top + bar.height + 6, v.top + v.height - PHONE_INSET - height);
    return { left, top, width, maxHeight };
  }

  // Every geometry read the chrome needs, taken in one pass for the frame.
  measureLayout() {
    const view = this.view;
    const st = view.state;
    this.settleHover();
    const shellBox = this.shell.getBoundingClientRect();
    const edBox = view.dom.getBoundingClientRect();
    const i = this.gutterIndex();
    let at = 0;
    for (let k = 0; k < i; k++) at += st.doc.child(k).nodeSize;
    const dom = view.nodeDOM(at);
    const out = { textLeft: edBox.left - shellBox.left, gutter: null, bubble: null, menu: null, bar: null, desk: false };
    if (dom && dom.getBoundingClientRect) {
      const r = dom.getBoundingClientRect();
      const lineH = parseFloat(getComputedStyle(dom).lineHeight) || r.height;
      out.gutter = { top: r.top - shellBox.top + Math.min(r.height, lineH) / 2, left: r.left - shellBox.left };
    }
    const phone = this.isPhone();
    // The fixed toolbar sits inside the visible viewport, so an on-screen keyboard
    // or a pan cannot carry it off screen.
    if (phone) {
      const v = phoneViewport(this.win);
      const height = this.dock.offsetHeight || PHONE_BAR_HEIGHT;
      out.bar = { ...phoneBarBox(v, this.dock.offsetWidth || PHONE_BAR_WIDTH, height, this.safeBottom()), height };
    } else {
      out.desk = !!this.dock.style.left;
    }
    const sel = st.selection;
    if (!this.bubble.hidden && !phone) {
      const a = view.coordsAtPos(sel.from), b = view.coordsAtPos(sel.to, -1);
      const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
      out.bubble = { x: mid - shellBox.left, y: Math.min(a.top, b.top) - shellBox.top };
    }
    if (this.menu && phone) {
      const box = this.menuBox(out.bar);
      out.menu = { x: box.left, y: box.top, width: box.width, maxHeight: box.maxHeight };
    } else if (this.menu) {
      const m = this.menu;
      let left, top;
      if (m.slashAt !== null) {
        const c = view.coordsAtPos(m.slashAt - 1);
        left = c.left;
        top = c.bottom + 6;
        const height = this.menuEl.offsetHeight;
        if (top + height > this.win.innerHeight - 8 && c.top - 6 - height >= 8) top = c.top - 6 - height;
      } else {
        const r = m.anchor === this.plus ? (dom?.getBoundingClientRect?.() ?? edBox) : m.anchor.getBoundingClientRect();
        left = r.left;
        top = r.bottom + 6;
      }
      out.menu = { x: Math.max(8, Math.min(left - shellBox.left, shellBox.width - 280)), y: top - shellBox.top };
    }
    return out;
  }

  // The placement style writes, from the frame's measurements alone.
  paintLayout(layout) {
    if (layout.bar) {
      this.dock.style.left = `${layout.bar.left}px`;
      this.dock.style.top = `${layout.bar.top}px`;
      this.dock.style.width = `${layout.bar.width}px`;
      this.grip.style.setProperty("--page-grip-lift", `${layout.bar.height}px`);
    } else {
      if (layout.desk) for (const side of ["left", "top", "width"]) this.dock.style.removeProperty(side);
      this.grip.style.removeProperty("--page-grip-lift");
    }
    if (layout.gutter) {
      for (const part of [this.plus, this.grip]) {
        part.style.setProperty("--page-plus-top", `${layout.gutter.top}px`);
        part.style.setProperty("--page-plus-left", `${layout.gutter.left}px`);
      }
    }
    this.plus.style.setProperty("--page-text-left", `${layout.textLeft}px`);
    if (layout.bubble) {
      this.bubble.style.setProperty("--page-pop-x", `${layout.bubble.x}px`);
      this.bubble.style.setProperty("--page-pop-y", `${layout.bubble.y}px`);
    }
    if (layout.menu) {
      this.menuEl.style.setProperty("--page-pop-x", `${layout.menu.x}px`);
      this.menuEl.style.setProperty("--page-pop-y", `${layout.menu.y}px`);
      if (layout.menu.width !== undefined) {
        this.menuEl.style.setProperty("--page-pop-width", `${layout.menu.width}px`);
        this.menuEl.style.setProperty("--page-pop-max", `${layout.menu.maxHeight}px`);
      }
    }
  }

  update(view, prev) {
    this.view = view;
    if (this.menu && this.menu.slashAt === null && prev && prev.doc !== view.state.doc) {
      const hadFocus = this.menuEl.contains(document.activeElement);
      this.closeMenu();
      if (hadFocus) view.focus();
    }
    const st = view.state;
    const node = st.doc.child(this.blockIndex());
    this.turn.textContent = `${blockTypeOf(node).label} ▾`;
    for (const b of this.dock.querySelectorAll("[data-cmd]")) b.setAttribute("aria-pressed", String(toolActive(st, b.dataset.cmd)));
    const showBubble = !st.selection.empty && st.selection instanceof TextSelection && view.hasFocus();
    this.bubble.hidden = !showBubble;
    if (showBubble) for (const b of this.bubble.querySelectorAll("[data-cmd]")) b.setAttribute("aria-pressed", String(toolActive(st, b.dataset.cmd)));
    this.grip.classList.toggle("is-on", st.selection instanceof BlockSelection);
    if (!this.inRoving(this.roving)) this.setRoving(this.dockControls()[0]);
    this.slashQuery();
    this.scheduleLayout();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    clearTimeout(this.movedTimer);
    this.drag.destroy();
    this.shell.removeEventListener("mousemove", this.onMove);
    this.shell.removeEventListener("mouseleave", this.onLeave);
    this.shell.removeEventListener("keydown", this.onKey);
    this.win.removeEventListener("resize", this.onResize);
    this.win.removeEventListener("scroll", this.onResize, true);
    this.win.visualViewport?.removeEventListener("resize", this.onResize);
    this.win.visualViewport?.removeEventListener("scroll", this.onResize);
    document.removeEventListener("mousedown", this.onDocDown, true);
    for (const part of [this.dock, this.plus, this.grip, this.bubble, this.scrim, this.menuEl, this.probe]) part?.remove();
  }
}

export function chromePlugin({ onAiTool = null } = {}) {
  let chrome = null;
  return new Plugin({
    key: chromeKey,
    view(view) {
      chrome = new Chrome(view, onAiTool);
      chromeFor.set(view, chrome);
      return chrome;
    },
    props: {
      handleKeyDown(view, event) {
        if (!chrome) return false;
        if (event.key === "/" && (event.metaKey || event.ctrlKey) && !event.altKey && !chrome.menu) {
          event.preventDefault();
          chrome.openActions();
          return true;
        }
        return chrome.key(event);
      },
      handleTextInput(view, from, to, text) {
        if (text !== "/" || !chrome) return false;
        const inserted = typeIntoBlocks(view, text);
        if (inserted) from = view.state.selection.from - 1;
        const $from = view.state.doc.resolve(from);
        if ($from.depth !== 1 || !$from.parent.isTextblock || $from.parent.type.spec.code) return inserted;
        if ($from.parentOffset > 0 && !/\s/.test(view.state.doc.textBetween(from - 1, from, "", "\n"))) return inserted;
        if (!inserted) view.dispatch(view.state.tr.insertText("/", from, to).setMeta(HISTORY_INTENT, typingIntent(view.state, from, to, "/")));
        const at = Math.min(view.state.doc.resolve(from).index(0), view.state.doc.childCount - 1);
        chrome.openMenu("insert", chrome.plus, from + 1, null, view.state.doc.child(at).attrs.id);
        return true;
      },
      handleDOMEvents: {
        keydown(view, event) { return composing(event, view); },
        blur(view) {
          if (chrome) chrome.bubble.hidden = true;
          return false;
        },
      },
    },
  });
}
