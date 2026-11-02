import { schema } from "./schema.js";
import { announce } from "./announce.js";
import { BOARD_ICONS, iconButton, boardOf, dueLabel, dueState, todayKey, placeAfter } from "./board-view.js";
import { el, cardFace } from "./board-face.js";
import { cardPanels } from "./board-views.js";

const NARROW = "(max-width: 1039.98px)";
const isTyping = (target) => /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
let count = 0;

export function cardPanel(view) {
  if (!cardPanels.has(view)) cardPanels.set(view, new CardPanel(view));
  return cardPanels.get(view);
}

export class CardPanel {
  constructor(view) {
    this.view = view;
    this.blockId = null;
    this.cardId = null;
    this.host = null;
    this.node = null;
    this.people = [];
    this.dueInput = null;
    this.rendering = false;
    this.titleBase = "";
    this.ownerBase = "";
    const doc = view.dom.ownerDocument;
    const id = `page-board-panel-${++count}`;
    this.scrim = el(doc, "div", "page-board-scrim", { "aria-hidden": "true" });
    this.dom = el(doc, "aside", "page-board-panel", { role: "dialog", "aria-modal": "false", "aria-labelledby": `${id}-title` });
    const top = el(doc, "div", "page-board-panel-top");
    this.title = el(doc, "textarea", "page-board-panel-title", { id: `${id}-title`, rows: 2, "aria-label": "Card title", spellcheck: "false", "data-focus": "title" });
    top.append(this.title, iconButton(doc, "page-board-icon page-board-close", "close", null, { "aria-label": "Close", "aria-keyshortcuts": "Escape", "data-action": "close", "data-focus": "close" }));
    this.ownerInput = el(doc, "input", "page-board-owner-input", { type: "text", "aria-label": "Owner name", placeholder: "Or type a name…", "data-focus": "owner-name" });
    this.fields = el(doc, "div", "page-board-fields");
    this.actions = el(doc, "div", "page-board-actions");
    this.dom.append(top, this.fields, this.actions);
    this.labels = { column: `${id}-column`, owner: `${id}-owner`, due: `${id}-due` };
    this.textField(this.title, () => this.commitTitle());
    this.textField(this.ownerInput, () => this.commitOwner());
    this.dom.addEventListener("click", (event) => this.click(event));
    this.dom.addEventListener("mousedown", (event) => { if (event.target.closest?.("button")) event.preventDefault(); });
    this.dom.addEventListener("change", (event) => { if (event.target.dataset.focus === "column") this.moveTo(event.target.value); });
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
    this.scrim.addEventListener("click", () => this.hide(true));
  }

  textField(input, commit) {
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commit(); }
      else if (event.key === "Escape") { event.preventDefault(); this.hide(true); }
    });
    input.addEventListener("blur", () => {
      if (this.rendering) return;
      setTimeout(() => { if (this.blockId !== null && input.ownerDocument.activeElement !== input) commit(); }, 0);
    });
  }

  get shell() { return this.view.dom.parentElement; }

  isOpen(blockId, cardId) { return this.blockId === blockId && this.cardId === cardId; }

  boardNode() {
    let found = null;
    this.view.state.doc.forEach((node) => { if (!found && node.type === schema.nodes.board && node.attrs.id === this.blockId) found = node; });
    return found;
  }

  card() { return this.boardNode()?.attrs.cards?.[this.cardId] ?? null; }

  boardButton(blockId, key) {
    const board = [...this.view.dom.querySelectorAll(".page-board")].find((node) => node.dataset.id === blockId);
    return board ? [...board.querySelectorAll("[data-focus]")].find((node) => node.dataset.focus === key && !node.disabled) ?? null : null;
  }

  setExpanded(on) {
    this.boardButton(this.blockId, `card:${this.cardId}`)?.setAttribute("aria-expanded", String(on));
  }

  open(blockId, cardId, host) {
    if (this.blockId !== null) {
      this.commit();
      this.setExpanded(false);
    }
    this.blockId = blockId;
    this.cardId = cardId;
    this.host = host;
    this.dueInput = null;
    if (!this.dom.isConnected) this.shell.append(this.scrim, this.dom);
    this.shell.classList.add("has-board-panel");
    const sheet = !!this.view.dom.ownerDocument.defaultView.matchMedia?.(NARROW).matches;
    this.dom.setAttribute("aria-modal", String(sheet));
    this.render(true);
    this.setExpanded(true);
    if (sheet) this.focusKey("close");
    else this.title.focus();
    this.loadPeople();
  }

  hide(refocus = false, commit = true) {
    if (this.blockId === null) return;
    if (commit) this.commit();
    const { blockId, cardId } = this;
    this.setExpanded(false);
    this.blockId = this.cardId = this.node = null;
    this.dueInput = null;
    this.scrim.remove();
    this.dom.remove();
    this.shell?.classList.remove("has-board-panel");
    if (refocus) this.boardButton(blockId, `card:${cardId}`)?.focus();
  }

  loadPeople() {
    const source = globalThis.clay?.people?.available;
    if (!source) return;
    Promise.resolve().then(() => source()).then((people) => {
      this.people = (Array.isArray(people) ? people : []).filter((person) => typeof person?.name === "string" && person.name);
      if (this.blockId !== null) this.render(false);
    }).catch(() => {});
  }

  run(name, ...args) {
    if (!this.host?.commands || !this.view.editable) return { status: "refused", code: "read-only" };
    const result = this.host.commands[name](this.blockId, this.cardId, ...args);
    if (result?.status === "refused") this.sync(true);
    return result;
  }

  commit() {
    this.commitTitle();
    this.commitOwner();
    if (this.dueInput) this.commitDue();
  }

  commitTitle() {
    const card = this.card();
    const title = this.title.value.replace(/\s*\n\s*/g, " ");
    this.title.value = title;
    if (card && title !== card.title) this.run("editCard", { title });
  }

  commitOwner() {
    const card = this.card();
    const typed = this.ownerInput.value.trim();
    this.ownerInput.value = typed;
    const owner = typed || null;
    if (card && owner !== (card.owner ?? null)) this.run("editCard", { owner });
  }

  commitDue() {
    const card = this.card();
    const due = this.dueInput?.value || null;
    this.dueInput = null;
    if (card && due !== (card.due ?? null)) this.run("editCard", { due });
    else if (this.blockId !== null) this.render(false);
  }

  openDue() {
    const doc = this.view.dom.ownerDocument;
    const input = el(doc, "input", "page-board-control page-board-date", { type: "date", "aria-labelledby": this.labels.due, "data-focus": "due-input" });
    input.value = this.card()?.due ?? "";
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); this.commitDue(); this.focusKey("due"); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.dueInput = null; this.render(false); this.focusKey("due"); }
    });
    input.addEventListener("blur", () => {
      if (this.rendering) return;
      setTimeout(() => { if (this.dueInput === input && doc.activeElement !== input) this.commitDue(); }, 0);
    });
    this.dueInput = input;
    this.render(false);
    input.focus();
    try { input.showPicker?.(); } catch {}
  }

  sync(force = false) {
    if (this.blockId === null) return;
    const node = this.boardNode();
    if (!force && node === this.node) return;
    const col = this.node?.attrs.cards?.[this.cardId]?.col;
    if (!node?.attrs.cards?.[this.cardId]) {
      const inside = this.dom.contains(this.view.dom.ownerDocument.activeElement);
      const blockId = this.blockId;
      this.hide(false, false);
      if (inside) (this.boardButton(blockId, `add:${col}`) ?? this.boardButton(blockId, "add-column"))?.focus();
      return;
    }
    this.render(false);
  }

  focusKey(key) {
    const target = [...this.dom.querySelectorAll("[data-focus]")].find((node) => node.dataset.focus === key && !node.disabled);
    target?.focus();
    return !!target;
  }

  render(fresh) {
    const doc = this.view.dom.ownerDocument;
    this.node = this.boardNode();
    const board = boardOf(this.node);
    const card = board.cards[this.cardId];
    if (!card) return this.hide(false, false);
    const active = doc.activeElement;
    const key = this.dom.contains(active) ? active.dataset.focus : null;
    const range = key && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
    this.rendering = true;
    try {
      const titleDirty = !fresh && this.title.value !== this.titleBase;
      this.titleBase = card.title ?? "";
      if (!titleDirty) this.title.value = this.titleBase;
      const ownerDirty = !fresh && this.ownerInput.value !== this.ownerBase;
      this.ownerBase = card.owner ?? "";
      if (!ownerDirty) this.ownerInput.value = this.ownerBase;
      this.fields.replaceChildren(this.columnField(board, card), this.ownerField(card), this.dueField(card));
      this.actions.replaceChildren(...this.actionButtons(board, card));
      if (key && key !== "title" && this.focusKey(key)) { if (range) doc.activeElement.setSelectionRange?.(...range); }
      else if (key === "up" || key === "down") this.focusKey(key === "up" ? "down" : "up");
    } finally {
      this.rendering = false;
    }
  }

  field(name, label, control, owner = false) {
    const doc = this.view.dom.ownerDocument;
    const row = el(doc, "div", `page-board-field${owner ? " is-owner" : ""}`);
    row.append(el(doc, "span", "page-board-label", { id: this.labels[name] }, label), control);
    return row;
  }

  columnField(board, card) {
    const doc = this.view.dom.ownerDocument;
    const wrap = el(doc, "span", "page-board-select");
    const select = el(doc, "select", "page-board-control", { "aria-labelledby": this.labels.column, "data-focus": "column", disabled: !board.columnIds.length });
    if (!board.lanes.has(card.col)) select.append(el(doc, "option", null, { value: "", selected: true, disabled: true }, "Deleted column"));
    for (const col of board.columnIds) select.append(el(doc, "option", null, { value: col, selected: col === card.col }, board.columns[col].name || "Untitled"));
    wrap.append(select);
    wrap.insertAdjacentHTML("beforeend", BOARD_ICONS.chevron);
    return this.field("column", "Column", wrap);
  }

  ownerField(card) {
    const doc = this.view.dom.ownerDocument;
    const box = el(doc, "div", "page-board-owners");
    const people = el(doc, "div", "page-board-people", { role: "group", "aria-labelledby": this.labels.owner });
    for (const person of this.people) {
      const chip = el(doc, "button", "page-board-person", { type: "button", "aria-pressed": String(person.name === card.owner), "data-action": "owner", "data-owner": person.name, "data-focus": `owner:${person.id ?? person.name}` });
      chip.append(cardFace(doc, person.name), el(doc, "span", null, {}, person.name));
      people.append(chip);
    }
    people.append(el(doc, "button", "page-board-person is-none", { type: "button", "aria-pressed": String(!card.owner), "data-action": "owner-none", "data-focus": "owner-none" }, "No owner"));
    box.append(people, this.ownerInput);
    return this.field("owner", "Owner", box, true);
  }

  dueField(card) {
    const doc = this.view.dom.ownerDocument;
    if (this.dueInput) return this.field("due", "Due", this.dueInput);
    const today = todayKey();
    const state = card.due ? dueState(card.due, today) : null;
    const label = card.due ? dueLabel(card.due, today, true) : null;
    const button = el(doc, "button", "page-board-control", { type: "button", "aria-label": card.due ? `Due ${label}${state === "overdue" ? ", overdue" : ""}` : "Set due date", "data-action": "due", "data-focus": "due" });
    if (card.due) {
      button.append(el(doc, "span", "page-board-due", { "data-due": state }, label));
      if (state === "overdue") button.append(el(doc, "span", "page-board-due-note", {}, "Overdue"));
    } else button.append(el(doc, "span", "page-board-control-text page-board-none", {}, "No date"));
    button.insertAdjacentHTML("beforeend", BOARD_ICONS.calendar);
    return this.field("due", "Due", button);
  }

  actionButtons(board, card) {
    const doc = this.view.dom.ownerDocument;
    const ids = board.lanes.get(card.col);
    const index = ids ? ids.indexOf(this.cardId) : -1;
    return [
      iconButton(doc, "page-board-btn", "up", "Move up", { "data-action": "up", "data-focus": "up", disabled: index <= 0 }),
      iconButton(doc, "page-board-btn", "down", "Move down", { "data-action": "down", "data-focus": "down", disabled: index < 0 || index >= ids.length - 1 }),
      iconButton(doc, "page-board-btn page-board-delete", "trash", "Delete card", { "data-action": "delete", "data-focus": "delete" }),
    ];
  }

  step(delta) {
    const card = this.card();
    const ids = card ? boardOf(this.node).lanes.get(card.col) : null;
    if (!ids) return;
    const index = ids.indexOf(this.cardId);
    this.run("moveCard", { columnId: card.col, afterId: delta < 0 ? placeAfter(ids, index) : ids[index + 1] });
  }

  moveTo(col) {
    const ids = boardOf(this.node).lanes.get(col)?.filter((id) => id !== this.cardId);
    if (ids) this.run("moveCard", { columnId: col, afterId: ids[ids.length - 1] ?? null });
  }

  remove() {
    const card = this.card();
    if (!card) return;
    const board = boardOf(this.node);
    const ids = board.lanes.get(card.col) ?? board.missing.get(card.col) ?? [];
    const index = ids.indexOf(this.cardId);
    const next = ids[index + 1] ?? ids[index - 1];
    const { blockId, cardId, host } = this;
    this.hide(false, false);
    if (!host?.commands || !this.view.editable || host.commands.removeCard(blockId, cardId).status !== "removed") return;
    announce(this.view, "Card deleted");
    const target = (next && this.boardButton(blockId, `card:${next}`)) || this.boardButton(blockId, `add:${card.col}`) || this.boardButton(blockId, "add-column");
    target?.focus();
  }

  click(event) {
    const target = event.target.closest?.("[data-action]");
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action !== "close") this.commitTitle();
    if (action === "close") this.hide(true);
    else if (action === "owner") { this.ownerInput.value = this.ownerBase; this.run("editCard", { owner: target.dataset.owner }); }
    else if (action === "owner-none") { this.ownerInput.value = this.ownerBase; this.run("editCard", { owner: null }); }
    else if (action === "due") this.openDue();
    else if (action === "up" || action === "down") this.step(action === "up" ? -1 : 1);
    else if (action === "delete") this.remove();
  }

  keydown(event) {
    const key = event.key.toLowerCase();
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.hide(true);
    } else if ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y") && !isTyping(event.target)) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) this.host?.redo?.();
      else this.host?.undo?.();
    } else if (event.key === "Tab" && this.dom.getAttribute("aria-modal") === "true") {
      const items = [...this.dom.querySelectorAll("button, input, select, textarea")].filter((node) => !node.disabled);
      if (event.target !== items[event.shiftKey ? 0 : items.length - 1]) return;
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0].focus();
    }
  }
}
