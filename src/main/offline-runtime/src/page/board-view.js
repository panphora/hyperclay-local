import { schema } from "./schema.js";
import { orderedIds } from "./model.js";
import { announce } from "./announce.js";
import { BoardDrag } from "./board-drag.js";

const N = schema.nodes;
const boardViews = new WeakMap();
const DUE = /^\d{4}-\d{2}-\d{2}$/;
let boards = 0;

const svg = (body, fill = false) => `<svg class="i" viewBox="0 0 16 16" width="16" height="16" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const BOARD_ICONS = {
  plus: svg('<path d="M8 3.25v9.5M3.25 8h9.5"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1.15"/><circle cx="8" cy="8" r="1.15"/><circle cx="12.5" cy="8" r="1.15"/>', true),
  chevron: svg('<path d="M4.75 6.5 8 9.75l3.25-3.25"/>'),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  up: svg('<path d="M8 12.75v-9.5M4.25 7 8 3.25 11.75 7"/>'),
  down: svg('<path d="M8 3.25v9.5M4.25 9 8 12.75 11.75 9"/>'),
  left: svg('<path d="M12.75 8h-9.5M7 4.25 3.25 8 7 11.75"/>'),
  right: svg('<path d="M3.25 8h9.5M9 4.25 12.75 8 9 11.75"/>'),
  trash: svg('<path d="M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.75h6.3l.6-8.75"/>'),
  calendar: svg('<rect x="2.75" y="3.5" width="10.5" height="9.75" rx="1.75"/><path d="M2.75 6.75h10.5M5.5 2v2.5M10.5 2v2.5"/>'),
  pencil: svg('<path d="M10.25 3.25l2.5 2.5-7 7H3.25v-2.5z"/>'),
  restore: svg('<path d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18M3.5 2.75v2.5H6"/>'),
};

export function el(doc, tag, cls, attrs = {}, text = null) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  if (text !== null) node.textContent = text;
  return node;
}

export function iconButton(doc, cls, icon, label, attrs = {}) {
  const button = el(doc, "button", cls, { type: "button", ...attrs });
  button.innerHTML = BOARD_ICONS[icon];
  if (label) button.append(label);
  return button;
}

export function boardOf(node) {
  const columns = node.attrs.columns ?? {}, cards = node.attrs.cards ?? {};
  const columnIds = orderedIds(columns);
  const lanes = new Map(columnIds.map((id) => [id, []]));
  const missing = new Map();
  for (const id of orderedIds(cards)) {
    const col = String(cards[id].col ?? "");
    if (lanes.has(col)) lanes.get(col).push(id);
    else missing.set(col, [...(missing.get(col) ?? []), id]);
  }
  return { columns, cards, columnIds, lanes, missing: new Map([...missing].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

const pad = (n) => String(n).padStart(2, "0");
export const todayKey = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const dueState = (due, today = todayKey()) => (!DUE.test(due) ? "later" : due < today ? "overdue" : due === today ? "today" : "later");
export function dueLabel(due, today = todayKey(), long = false) {
  if (!DUE.test(due)) return due;
  if (!long && due === today) return "Today";
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { ...(long ? { weekday: "short" } : {}), month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
export const initialOf = (name) => ([...String(name).trim()][0] ?? "?").toUpperCase();
export const placeAfter = (ids, index) => (index >= 2 ? ids[index - 2] : null);
const countOf = (doc, n) => el(doc, "span", "page-board-count", { "aria-label": `${n} ${n === 1 ? "card" : "cards"}` }, String(n));
const isTyping = (target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");

function dueBadge(doc, due) {
  const today = todayKey();
  const state = dueState(due, today);
  const badge = el(doc, "span", "page-board-due", { "data-due": state });
  badge.append(el(doc, "span", "page-board-sr", {}, "Due "), doc.createTextNode(dueLabel(due, today)));
  if (state === "overdue") badge.append(el(doc, "span", "page-board-sr", {}, ", overdue"));
  return badge;
}

export const cardFace = (doc, name) => el(doc, "span", "page-board-face", { "aria-hidden": "true" }, initialOf(name));

export class BoardView {
  constructor(node, view, getPos, { commands = null, undo = null, redo = null, panel = null } = {}) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.commands = commands;
    this.undo = undo;
    this.redo = redo;
    this.panel = panel;
    this.uid = `page-board-${++boards}`;
    this.menu = null;
    const views = boardViews.get(view) ?? new Map();
    boardViews.set(view, views);
    views.set(node.attrs.id, this);
    this.editing = null;
    this.rendering = false;
    const doc = view.dom.ownerDocument;
    this.dom = el(doc, "div", "page-board", { "data-type": "board", "data-id": node.attrs.id ?? "", role: "group", "aria-label": "Board" });
    this.dom.contentEditable = "false";
    this.trays = el(doc, "div", "page-board-trays");
    this.scroll = el(doc, "div", "page-board-scroll");
    this.lanes = el(doc, "div", "page-board-lanes");
    this.scroll.append(this.lanes);
    this.dom.append(this.trays, this.scroll);
    this.dom.addEventListener("click", (event) => this.click(event));
    this.dom.addEventListener("change", (event) => this.change(event));
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.dom.addEventListener("focusout", (event) => this.focusout(event));
    this.dom.addEventListener("mousedown", (event) => { if (event.target.closest?.("button")) event.preventDefault(); });
    this.dragger = new BoardDrag(this);
    this.render();
  }

  get blockId() { return this.node.attrs.id; }

  run(name, ...args) {
    if (!this.commands || !this.view.editable) return { status: "refused", code: "read-only" };
    const result = this.commands[name](this.blockId, ...args);
    if (result?.status === "refused") this.render();
    return result;
  }

  focusKey(key) {
    const target = key ? [...this.dom.querySelectorAll("[data-focus]")].find((node) => node.dataset.focus === key && !node.disabled) : null;
    if (!target) return false;
    target.focus();
    return target.ownerDocument.activeElement === target;
  }

  render() {
    const doc = this.dom.ownerDocument;
    const active = doc.activeElement;
    const key = active && this.dom.contains(active) ? active.dataset?.focus ?? null : null;
    const range = key && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
    this.rendering = true;
    try {
      this.board = boardOf(this.node);
      this.dom.dataset.id = this.blockId ?? "";
      const gone = this.commands?.removed?.(this.blockId) ?? { columns: {}, cards: {} };
      const removed = gone.columns ?? {};
      const deleted = Object.keys(gone.cards ?? {}).filter((id) => !Object.hasOwn(this.board.cards, id));
      this.trays.replaceChildren(...[...this.board.missing].map(([col, ids], index) => this.tray(col, ids, index, removed[col])));
      if (deleted.length) this.trays.append(this.deletedTray(deleted, gone.cards));
      else this.showDeleted = false;
      const lanes = this.board.columnIds.map((id, index) => this.lane(id, index));
      if (this.editing?.kind === "column") lanes.push(this.newLane());
      else lanes.push(iconButton(doc, "page-board-addcol", "plus", null, { "aria-label": "Add column", title: "Add column", "data-action": "add-column", "data-focus": "add-column" }));
      this.lanes.replaceChildren(...lanes);
      if (key && this.focusKey(key) && range) doc.activeElement.setSelectionRange?.(...range);
      this.dragger?.repaint();
    } finally {
      this.rendering = false;
    }
  }

  lane(colId, index) {
    const doc = this.dom.ownerDocument;
    const ids = this.board.lanes.get(colId);
    const name = this.board.columns[colId].name || "Untitled";
    const headingId = `${this.uid}-col-${index}`;
    const lane = el(doc, "div", "page-board-lane", { role: "group", "aria-labelledby": headingId, "data-col": colId });
    const head = el(doc, "div", "page-board-head", { "data-col": colId });
    const renaming = this.editing?.kind === "rename" && this.editing.id === colId;
    if (renaming) head.append(this.editing.input, el(doc, "span", "page-board-name page-board-sr", { id: headingId }, name), countOf(doc, ids.length));
    else {
      head.append(el(doc, "h4", "page-board-name", { id: headingId }, name), countOf(doc, ids.length));
      head.append(iconButton(doc, "page-board-icon page-board-colmenu", "more", null, { "aria-haspopup": "menu", "aria-expanded": String(this.menu === colId), "aria-label": `${name} column options`, "data-action": "colmenu", "data-col": colId, "data-focus": `colmenu:${colId}` }));
      if (this.menu === colId) head.append(this.columnMenu(colId, index, name));
    }
    const list = el(doc, "ol", "page-board-cards");
    for (const id of ids) {
      const item = el(doc, "li");
      item.append(this.card(id));
      list.append(item);
    }
    lane.append(head, list);
    if (this.editing?.kind === "card" && this.editing.id === colId) lane.append(this.editing.input);
    else lane.append(iconButton(doc, "page-board-add", "plus", "Add card", { "data-action": "add-card", "data-col": colId, "data-focus": `add:${colId}` }));
    return lane;
  }

  newLane() {
    const doc = this.dom.ownerDocument;
    const lane = el(doc, "div", "page-board-lane", { role: "group", "aria-label": "New column" });
    const head = el(doc, "div", "page-board-head");
    head.append(this.editing.input);
    lane.append(head);
    return lane;
  }

  card(id) {
    const doc = this.dom.ownerDocument;
    const card = this.board.cards[id];
    const button = el(doc, "button", "page-board-card", { type: "button", "aria-haspopup": "dialog", "aria-expanded": String(this.isOpen(id)), "data-action": "card", "data-card": id, "data-focus": `card:${id}` });
    button.append(el(doc, "span", "page-board-title", {}, card.title || "Untitled"));
    if (card.owner || card.due) {
      const meta = el(doc, "span", "page-board-meta");
      if (card.owner) {
        const owner = el(doc, "span", "page-board-owner");
        owner.append(cardFace(doc, card.owner), el(doc, "span", "page-board-owner-name", {}, card.owner));
        meta.append(owner);
      }
      if (card.due) meta.append(dueBadge(doc, card.due));
      button.append(meta);
    }
    return button;
  }

  tray(col, ids, index, removed) {
    const doc = this.dom.ownerDocument;
    const headingId = `${this.uid}-missing-${index}`;
    const tray = el(doc, "div", "page-board-tray", { role: "group", "aria-labelledby": headingId, "data-col": col });
    const head = el(doc, "div", "page-board-tray-head");
    head.append(el(doc, "h4", "page-board-name", { id: headingId }, removed ? `Cards from deleted column “${removed.name || "Untitled"}”` : "Cards from a deleted column"), countOf(doc, ids.length));
    if (removed) head.append(iconButton(doc, "page-board-btn page-board-restore", "restore", "Restore column", { "data-action": "restore-column", "data-col": col, "data-focus": `restore:${col}` }));
    const list = el(doc, "ol", "page-board-cards");
    for (const id of ids) {
      const item = el(doc, "li");
      item.append(this.card(id), this.moveSelect(id));
      list.append(item);
    }
    tray.append(head, list);
    return tray;
  }

  deletedTray(ids, cards) {
    const doc = this.dom.ownerDocument;
    const tray = el(doc, "div", "page-board-tray page-board-deleted", { role: "group", "aria-label": "Deleted cards" });
    const head = el(doc, "div", "page-board-tray-head");
    head.append(iconButton(doc, "page-board-btn page-board-deleted-toggle", "chevron", `Deleted cards (${ids.length})`, { "aria-expanded": String(!!this.showDeleted), "data-action": "toggle-deleted", "data-focus": "toggle-deleted" }));
    tray.append(head);
    if (!this.showDeleted) return tray;
    const list = el(doc, "ol", "page-board-deleted-list");
    for (const id of ids.sort((a, b) => (cards[a].pos ?? "") < (cards[b].pos ?? "") ? -1 : 1)) {
      const title = cards[id].title || "Untitled";
      const item = el(doc, "li", "page-board-deleted-item");
      item.append(el(doc, "span", "page-board-title", {}, title), iconButton(doc, "page-board-btn page-board-restore", "restore", "Restore", { "aria-label": `Restore ${title}`, "data-action": "restore-card", "data-card": id, "data-focus": `restore-card:${id}` }));
      list.append(item);
    }
    tray.append(list);
    return tray;
  }

  moveSelect(id) {
    const doc = this.dom.ownerDocument;
    const wrap = el(doc, "span", "page-board-select page-board-move");
    const select = el(doc, "select", null, { "aria-label": `Move ${this.board.cards[id].title || "Untitled"} to column`, "data-action": "orphan-move", "data-card": id, "data-focus": `move:${id}`, disabled: !this.board.columnIds.length });
    select.append(el(doc, "option", null, { value: "", selected: true, disabled: true, hidden: true }, "Move to column"));
    for (const col of this.board.columnIds) select.append(el(doc, "option", null, { value: col }, this.board.columns[col].name || "Untitled"));
    wrap.append(select);
    wrap.insertAdjacentHTML("beforeend", BOARD_ICONS.chevron);
    return wrap;
  }

  columnMenu(colId, index, name) {
    const doc = this.dom.ownerDocument;
    const last = this.board.columnIds.length - 1;
    const menu = el(doc, "div", "page-board-pop page-board-menu", { role: "menu", "aria-label": `${name} column` });
    const item = (action, label, icon, disabled = false) => iconButton(doc, `page-board-option${action === "delete-column" ? " is-danger" : ""}`, icon, label, { role: "menuitem", "data-action": action, "data-col": colId, "data-focus": `${action}:${colId}`, disabled });
    menu.append(item("rename", "Rename", "pencil"), item("left", "Move left", "left", index === 0), item("right", "Move right", "right", index === last), el(doc, "div", "page-board-sep", { role: "separator" }), item("delete-column", "Delete column", "trash"));
    return menu;
  }

  isOpen(cardId) { return this.panel?.isOpen(this.blockId, cardId) ?? false; }

  openMenu(colId) {
    this.menu = colId;
    this.render();
    this.dom.querySelector(".page-board-menu .page-board-option:not(:disabled)")?.focus();
  }

  closeMenu(refocus) {
    const colId = this.menu;
    this.menu = null;
    this.dom.querySelector(".page-board-menu")?.remove();
    for (const button of this.dom.querySelectorAll(".page-board-colmenu")) button.setAttribute("aria-expanded", "false");
    if (refocus) this.focusKey(`colmenu:${colId}`);
  }

  inlineInput(cls, label, key, value = "") {
    const input = el(this.dom.ownerDocument, "input", cls, { type: "text", "aria-label": label, "data-focus": key, placeholder: cls === "page-board-new" ? "Card title" : "Column name" });
    input.value = value;
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") { event.preventDefault(); this.finishEdit(true, true); }
      else if (event.key === "Escape") { event.preventDefault(); this.finishEdit(false, true); }
    });
    input.addEventListener("blur", () => {
      if (this.rendering) return;
      setTimeout(() => { if (this.editing?.input === input && input.ownerDocument.activeElement !== input) this.finishEdit(true, false); }, 0);
    });
    return input;
  }

  startEdit(kind, colId) {
    if (this.editing) this.finishEdit(true, false);
    this.menu = null;
    const name = kind === "rename" ? this.board.columns[colId]?.name ?? "" : "";
    const key = kind === "card" ? `new:${colId}` : kind === "column" ? "new-column" : `name:${colId}`;
    const input = this.inlineInput(kind === "card" ? "page-board-new" : "page-board-rename", kind === "card" ? "New card title" : "Column name", key, name);
    this.editing = { kind, id: colId, input };
    this.render();
    input.focus();
    input.select();
  }

  finishEdit(save, refocus) {
    const editing = this.editing;
    if (!editing) return;
    const value = editing.input.value.trim();
    if (editing.kind === "card" && save && value && refocus) {
      const result = this.run("createCard", { columnId: editing.id, title: value });
      if (result?.status !== "refused") editing.input.value = "";
      else if (!this.board.columns[editing.id]) {
        this.editing = null;
        this.render();
        this.focusKey("add-column");
        return;
      }
      this.focusKey(`new:${editing.id}`);
      return;
    }
    this.editing = null;
    let focus = editing.kind === "column" ? "add-column" : editing.kind === "card" ? `add:${editing.id}` : `colmenu:${editing.id}`;
    if (save && value) {
      if (editing.kind === "card") this.run("createCard", { columnId: editing.id, title: value });
      else if (editing.kind === "column") {
        const result = this.run("createColumn", { name: value });
        if (result.status === "created") focus = `add:${result.id}`;
      } else if (value !== this.board.columns[editing.id]?.name) this.run("renameColumn", editing.id, value);
    }
    this.render();
    if (refocus) this.focusKey(focus);
  }

  shiftColumn(colId, delta) {
    const ids = this.board.columnIds;
    const index = ids.indexOf(colId);
    this.menu = null;
    this.run("moveColumn", colId, { afterId: delta < 0 ? placeAfter(ids, index) : ids[index + 1] });
    this.render();
    this.focusKey(`colmenu:${colId}`);
  }

  deleteColumn(colId) {
    const ids = this.board.columnIds;
    const next = ids[ids.indexOf(colId) + 1] ?? ids[ids.indexOf(colId) - 1];
    this.menu = null;
    const result = this.run("removeColumn", colId);
    this.render();
    if (result.status !== "removed") return;
    announce(this.view, result.cards ? "Column deleted. Its cards are under Cards from a deleted column." : "Column deleted");
    if (!this.focusKey(`restore:${colId}`) && !this.focusKey(`colmenu:${next}`)) this.focusKey("add-column");
  }

  restoreCard(cardId) {
    if (this.run("restoreCard", cardId).status !== "restored") return;
    announce(this.view, "Card restored");
    this.focusKey(`card:${cardId}`) || this.focusKey("toggle-deleted");
  }

  restoreColumn(colId) {
    if (this.run("restoreColumn", colId).status !== "restored") return;
    announce(this.view, "Column restored");
    this.focusKey(`colmenu:${colId}`);
  }

  openCard(cardId) {
    this.menu = null;
    this.dom.querySelector(".page-board-menu")?.remove();
    this.panel?.open(this.blockId, cardId, { commands: this.commands, undo: this.undo, redo: this.redo });
  }

  click(event) {
    const target = event.target.closest?.("[data-action]");
    if (!target || !this.dom.contains(target) || target.disabled) return;
    const { action, col, card } = target.dataset;
    if (this.editing && action !== "add-card" && action !== "add-column" && action !== "rename") this.finishEdit(true, false);
    if (action === "card") this.openCard(card);
    else if (action === "colmenu") { if (this.menu === col) this.closeMenu(true); else this.openMenu(col); }
    else if (action === "rename") this.startEdit("rename", col);
    else if (action === "left" || action === "right") this.shiftColumn(col, action === "left" ? -1 : 1);
    else if (action === "delete-column") this.deleteColumn(col);
    else if (action === "add-card") this.startEdit("card", col);
    else if (action === "add-column") this.startEdit("column", null);
    else if (action === "restore-column") this.restoreColumn(col);
    else if (action === "restore-card") this.restoreCard(card);
    else if (action === "toggle-deleted") { this.showDeleted = !this.showDeleted; this.render(); this.focusKey("toggle-deleted"); }
  }

  change(event) {
    const select = event.target;
    if (select.dataset?.action !== "orphan-move" || !select.value) return;
    const card = select.dataset.card, col = select.value;
    const ids = this.board.lanes.get(col) ?? [];
    if (this.run("moveCard", card, { columnId: col, afterId: ids[ids.length - 1] ?? null }).status === "moved") this.focusKey(`card:${card}`);
  }

  keydown(event) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y") && !isTyping(event.target)) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) this.redo?.();
      else this.undo?.();
      return;
    }
    const menu = event.target.closest?.(".page-board-menu");
    if (!menu) return;
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      this.closeMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...menu.querySelectorAll(".page-board-option:not(:disabled)")];
      const at = items.indexOf(event.target);
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }

  focusout(event) {
    if (this.rendering || this.menu === null) return;
    const menu = this.dom.querySelector(".page-board-menu");
    if (menu?.contains(event.target) && !menu.contains(event.relatedTarget)) this.closeMenu(false);
  }

  update(node) {
    if (node.type !== N.board || node.attrs.id !== this.node.attrs.id) return false;
    const changed = !node.sameMarkup(this.node);
    this.node = node;
    if (changed) this.render();
    return true;
  }

  stopEvent() { return true; }

  ignoreMutation() { return true; }

  destroy() {
    const views = boardViews.get(this.view);
    const next = views?.get(this.blockId);
    if (this.editing && next && next !== this) {
      next.editing = this.editing;
      next.render();
    }
    if (next === this) views.delete(this.blockId);
    this.dragger.stop();
  }
}
