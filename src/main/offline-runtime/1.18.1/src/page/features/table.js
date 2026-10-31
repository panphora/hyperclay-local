import { schema } from "../schema.js";
import { orderedIds } from "../model.js";
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, addColumn, addRow, deleteColumn, deleteRow, moveColumn, moveRow, renameColumn, selectTableCell, setCellText, setColumnKind, setColumnWidth, setColumnWidths, clearColumnWidths, sortBy } from "../table.js";
import { COLUMN_KINDS } from "../rich/csv.js";
import { KIND_ICONS, KIND_LABELS, columnKinds } from "../table-kinds.js";
import { openPageMenu, reanchorPageMenu } from "../chrome.js";
import { loadChartPart } from "../items.js";
import { selectLine } from "../table-select.js";
import { TABLE_CSS } from "../table-style.js";
import { cellViews } from "../table-views.js";
import { asStep } from "../blocksel.js";
import { announce } from "../announce.js";
import { registerUnsavedState } from "../../lib/unsaved-state.js";

const N = schema.nodes;

const columns = (table) => orderedIds(table.attrs.cols);

const UNAVAILABLE = "That part of the table is no longer available.";
const GEAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="scale(0.6667)" stroke-width="2.25"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g></svg>';
const ACTIONS_CSS = `
.page-editor .page-table-actions { position: absolute; z-index: 2; bottom: 100%; inset-inline-end: 0; inset-inline-start: auto; width: 24px; height: 20px; padding: 0; display: grid; place-items: center; border: 1px solid var(--page-chrome-line-rest); border-bottom: 0; border-radius: 6px 6px 0 0; background: var(--page-chrome-bg-moved); color: var(--page-chrome-ink-moved); font: inherit; cursor: pointer; opacity: 1; }
.page-editor .page-table-actions:hover { background: var(--page-pop-hover); color: var(--page-ink-soft); }
@media (max-width: 560px) {
  .page-editor .page-table-actions { position: absolute; }
  .page-editor .page-table-actions::after { content: ""; position: absolute; inset: -12px; }
}
`;

const headerId = (tableId, colId) => `${tableId}-${colId}`;
const columnLabel = (col, index) => col.name || `Column ${index + 1}`;
const rowLabel = (row, index) => (row.childCount ? row.child(0).textContent.trim() : "") || `Row ${index + 1}`;

const tableById = (doc, id) => {
  let found = null;
  doc.forEach((node, offset) => { if (!found && node.type === N.table && node.attrs.id === id) found = { table: node, pos: offset }; });
  return found;
};
const rowIndexOf = (table, rowId) => (rowId == null ? 0 : [...table.content.content].findIndex((row) => row.attrs.id === rowId));
const colIndexOf = (table, colId) => (colId == null ? 0 : columns(table).indexOf(colId));

// A table command names its table, row and column when it is offered and finds them
// again here, so a peer's edit between the two can never hand it another one.
const selectOn = (view, target, kind) => {
  const found = tableById(view.state.doc, target.tableId);
  if (!found) return false;
  const index = kind === "row" ? rowIndexOf(found.table, target.rowId) : colIndexOf(found.table, target.colId);
  return index < 0 ? false : selectLine(view, found.pos, kind, index);
};
const runOn = (view, target, command) => {
  const found = tableById(view.state.doc, target.tableId);
  if (!found) return false;
  const row = rowIndexOf(found.table, target.rowId);
  const col = colIndexOf(found.table, target.colId);
  if (row < 0 || col < 0) return false;
  selectTableCell(view, found.pos, row, col);
  if (command(view.state, null) !== true) return false;
  return command(view.state, view.dispatch);
};

const FONT = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing"];
const textWidth = (el) => {
  const doc = el.ownerDocument;
  const style = doc.defaultView.getComputedStyle(el);
  const probe = doc.createElement("span");
  for (const key of FONT) probe.style[key] = style[key];
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", left: "-9999px", top: "0" });
  probe.textContent = el.textContent;
  doc.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.ceil(width);
};
const widthOf = (value) => (Number.isFinite(value) && value > 0 ? Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))) : null);

const button = (doc, label, action) => {
  const el = doc.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.setAttribute("aria-label", label);
  el.addEventListener("click", action);
  return el;
};

export class TableView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.preview = null;
    this.renaming = null;
    this.renamingUnsaved = null;
    this.menuAnchor = null;
    this.destroyed = false;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("div");
    this.dom.className = "page-table";
    this.dom.dataset.id = node.attrs.id ?? "";
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Table");
    const scroll = doc.createElement("div");
    scroll.className = "page-table-scroll";
    const table = doc.createElement("table");
    table.setAttribute("aria-label", "Table");
    this.table = table;
    this.colgroup = doc.createElement("colgroup");
    this.header = doc.createElement("thead");
    this.header.contentEditable = "false";
    this.contentDOM = doc.createElement("tbody");
    table.append(this.colgroup, this.header, this.contentDOM);
    scroll.append(table);
    const addRowButton = button(doc, "+", () => this.append("row"));
    addRowButton.className = "page-table-add-row";
    addRowButton.setAttribute("aria-label", "Add a row");
    addRowButton.title = "Add a row";
    const addColumnButton = button(doc, "+", () => this.append("column"));
    addColumnButton.className = "page-table-add-col";
    addColumnButton.setAttribute("aria-label", "Add a column");
    addColumnButton.title = "Add a column";
    const actions = doc.createElement("button");
    actions.type = "button";
    actions.className = "page-table-actions";
    actions.innerHTML = GEAR;
    actions.dataset.control = "actions";
    actions.setAttribute("aria-haspopup", "menu");
    actions.setAttribute("aria-expanded", "false");
    actions.setAttribute("aria-label", "Table actions");
    actions.title = "Table actions";
    this.actionsButton = actions;
    actions.addEventListener("click", (event) => {
      event.preventDefault();
      this.menuAnchor = actions;
      this.openActions();
    });
    actions.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.menuAnchor = actions;
      this.openActions();
    });
    for (const control of [addRowButton, addColumnButton, actions]) {
      control.contentEditable = "false";
      control.addEventListener("mousedown", (event) => event.preventDefault());
    }
    this.dom.append(scroll, addRowButton, addColumnButton, actions);
    this.render();
  }
  // The control a focus descriptor names, or null when it is gone.
  control(focus) {
    if (!focus || (focus.tableId && focus.tableId !== this.node.attrs.id)) return null;
    const all = [...this.dom.querySelectorAll(`[data-control="${focus.control}"]`)];
    return all.find((el) => (focus.colId == null || el.dataset.col === focus.colId)
      && (focus.rowId == null || el.dataset.row === focus.rowId)) ?? null;
  }
  controls(control) {
    return [...this.dom.querySelectorAll(`[data-control="${control}"]`)].filter((el) => !el.hidden && !el.closest("[hidden]"));
  }
  // Focus stays on the same control; when a peer removed it, the control that took
  // its place in the column or row, and otherwise the table's own exit.
  focusControl(focus) {
    if (!focus || (focus.tableId && focus.tableId !== this.node.attrs.id)) return null;
    const exact = this.control(focus);
    const peers = exact ? [] : this.controls(focus.control);
    const near = peers.length ? peers[Math.min(focus.index ?? 0, peers.length - 1)] : null;
    const target = exact ?? near ?? this.actionsButton;
    target?.focus?.();
    return target;
  }
  describe(element) {
    if (!element || !this.dom.contains(element)) return null;
    const control = element.dataset?.control;
    if (!control) return null;
    return {
      tableId: this.node.attrs.id,
      rowId: element.dataset.row ?? null,
      colId: element.dataset.col ?? null,
      control,
      index: this.controls(control).indexOf(element),
    };
  }
  // Cell views are updated after this one, so a row control a peer removed only
  // finds its replacement once the whole render is done.
  afterUpdate(focus) {
    queueMicrotask(() => {
      if (this.destroyed || this.view.isDestroyed) return;
      const active = this.dom.ownerDocument.activeElement;
      if (active && this.dom.contains(active)) return;
      this.focusControl(focus);
    });
  }
  act(target, command, said) {
    const done = runOn(this.view, target, command);
    announce(this.view, done ? said : UNAVAILABLE);
    return done;
  }
  // What a menu opened now acts on: the caret's cell of this table, by id.
  cellTarget(table = this.node) {
    const pos = this.getPos();
    const { $head } = this.view.state.selection;
    let row = 0, cell = 0;
    for (let depth = $head.depth; depth > 0; depth--) {
      if ($head.node(depth).type !== N.table) continue;
      if (pos != null && $head.before(depth) === pos) {
        row = depth < $head.depth ? $head.index(depth) : 0;
        cell = depth + 1 < $head.depth ? $head.index(depth + 1) : 0;
      }
      break;
    }
    const rows = [...table.content.content];
    return { tableId: table.attrs.id, rowId: rows[row]?.attrs.id ?? null, colId: columns(table)[cell] ?? null };
  }
  openActions() {
    const target = this.cellTarget();
    const table = tableById(this.view.state.doc, target.tableId)?.table;
    if (!table) return false;
    return this.actions(table, target);
  }
  actions(table, target) {
    const ids = columns(table);
    const index = Math.max(0, colIndexOf(table, target.colId));
    const row = Math.max(0, rowIndexOf(table, target.rowId));
    const col = table.attrs.cols[ids[index]] ?? {};
    const sort = table.attrs.sort;
    const at = (command, said) => () => this.act(target, command, said);
    const width = this.widthOfColumn(ids[index]);
    return openPageMenu(this.view, this.actionsButton, [
      { label: "Insert row above", icon: "+", run: at(addRow(false), "Row inserted") },
      { label: "Insert row below", icon: "+", run: at(addRow(true), "Row inserted") },
      ...(row > 0 ? [{ label: "Move row up", icon: "↑", run: at(moveRow(-1), "Row moved") }] : []),
      ...(row < table.childCount - 1 ? [{ label: "Move row down", icon: "↓", run: at(moveRow(1), "Row moved") }] : []),
      { label: "Delete row", icon: "×", run: at(deleteRow, "Row deleted") },
      { label: "Insert column left", icon: "+", run: at(addColumn(false), "Column inserted") },
      { label: "Insert column right", icon: "+", run: at(addColumn(true), "Column inserted") },
      ...(index > 0 ? [{ label: "Move column left", icon: "←", run: at(moveColumn(-1), "Column moved") }] : []),
      ...(index < ids.length - 1 ? [{ label: "Move column right", icon: "→", run: at(moveColumn(1), "Column moved") }] : []),
      ...(ids.length > 1 ? [{ label: "Delete column", icon: "×", run: at(deleteColumn, "Column deleted") }] : []),
      { label: "Sort ascending", icon: "↑", checked: sort?.col === ids[index] && sort.dir === "asc", run: at(sortBy(ids[index], "asc"), "Sorted ascending") },
      { label: "Sort descending", icon: "↓", checked: sort?.col === ids[index] && sort.dir === "desc", run: at(sortBy(ids[index], "desc"), "Sorted descending") },
      { label: "Chart this table", icon: "📊", run: () => { const at = this.getPos(); return loadChartPart(this.view).then(({ insertChartAfterTable }) => insertChartAfterTable(this.view, at)); } },
      { label: "Rename column", focus: false, run: () => this.beginRename(ids[index]) },
      { label: "Column width ▸", icon: "↔", hint: col.width ? `${col.width}px` : "Auto", focus: false, run: () => openPageMenu(this.view, this.actionsButton, [
        { label: "Wider", icon: "+", run: at(this.widthCommand(ids[index], width + 40), "Column width changed") },
        { label: "Narrower", icon: "−", run: at(this.widthCommand(ids[index], width - 40), "Column width changed") },
        { label: "Fit to content", icon: "↔", run: () => this.fit(ids[index]) },
        ...(this.isSized() ? [{ label: "Reset widths", icon: "×", run: at(clearColumnWidths(ids[index]), "Column widths reset") }] : []),
      ]) },
    ], { persist: true });
  }
  // The name field for a column. A peer's edit does not take it away while it has
  // the focus, and a cancelled one writes nothing. A name typed here is unsaved work
  // until Enter or a blur commits it, so the exit asks the registry by its name and
  // refuses while the field holds a name the table does not.
  beginRename(colId) {
    const control = this.control({ control: "column", colId });
    const col = this.node.attrs.cols[colId];
    if (!control || !col) return false;
    const doc = this.dom.ownerDocument;
    const tableId = this.node.attrs.id;
    const input = doc.createElement("input");
    input.type = "text";
    input.className = "page-table-rename";
    input.dataset.control = "rename";
    input.dataset.col = colId;
    input.value = col.name ?? "";
    input.setAttribute("aria-label", "Column name");
    const unsaved = registerUnsavedState({
      id: "table-rename",
      isPending: () => this.renaming === input && input.value.trim() !== (col.name ?? ""),
    });
    this.renamingUnsaved = unsaved;
    const finish = (save) => {
      if (this.renaming !== input) return;
      this.renaming = null;
      this.renamingUnsaved = null;
      unsaved.dispose();
      const value = input.value.trim();
      if (save && value) this.act({ tableId, colId }, renameColumn(colId, value), "Column renamed");
      if (input.isConnected) input.replaceWith(control);
      this.focusControl({ tableId, control: "column", colId });
    };
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
    this.renaming = input;
    control.replaceWith(input);
    input.focus();
    input.select();
    return true;
  }
  append(what) {
    const pos = this.getPos();
    if (pos == null) return;
    const last = what === "row" ? [this.node.childCount - 1, 0] : [0, this.node.child(0).childCount - 1];
    selectTableCell(this.view, pos, ...last);
    (what === "row" ? addRow(true) : addColumn(true))(this.view.state, this.view.dispatch);
    this.view.focus();
  }
  widths() {
    this.frozen = null;
    const sized = columns(this.node).some((id) => this.node.attrs.cols[id].width);
    const cols = columns(this.node).map((id) => {
      const col = this.dom.ownerDocument.createElement("col");
      col.dataset.col = id;
      const width = this.node.attrs.cols[id].width;
      if (sized) col.style.width = `${width ?? DEFAULT_WIDTH}px`;
      return col;
    });
    this.colgroup.replaceChildren(...cols);
    this.table.classList.toggle("is-sized", sized);
    this.table.style.width = sized ? `${columns(this.node).reduce((sum, id) => sum + (this.node.attrs.cols[id].width ?? DEFAULT_WIDTH), 0)}px` : "";
  }
  resizer(colId, th, col, index) {
    const doc = this.dom.ownerDocument;
    const handle = doc.createElement("span");
    handle.className = "page-table-resize";
    handle.dataset.control = "resize";
    handle.dataset.col = colId;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize column ${columnLabel(col, index)}`);
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.setAttribute("aria-valuemax", String(MAX_WIDTH));
    handle.setAttribute("aria-valuenow", String(this.widthOfColumn(colId)));
    handle.tabIndex = 0;
    handle.title = "Drag or use the arrow keys to resize, double-click to reset the table to the page width";
    handle.addEventListener("mousedown", (event) => event.preventDefault());
    handle.addEventListener("blur", () => this.commitWidth(colId));
    handle.addEventListener("keydown", (event) => this.resizeKey(event, colId));
    handle.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) this.commitWidth(colId);
    });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const start = event.clientX;
      const from = this.widthOfColumn(colId);
      this.freeze();
      const rtl = this.dom.ownerDocument.defaultView.getComputedStyle?.(this.dom).direction === "rtl";
      let width = from;
      const move = (e) => {
        width = widthOf(from + (rtl ? start - e.clientX : e.clientX - start)) ?? from;
        this.showWidth(colId, width);
      };
      const up = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        if (width !== from) this.sizeColumn(colId, width);
        else this.widths();
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
    });
    handle.addEventListener("dblclick", (event) => { event.preventDefault(); this.command(colId, clearColumnWidths(colId)); });
    return handle;
  }
  isSized() {
    return columns(this.node).some((id) => this.node.attrs.cols[id].width);
  }
  // A table with no widths fills the page, so its columns are measured as drawn.
  drawnWidths() {
    const widths = {};
    for (const th of this.header.querySelectorAll("th")) widths[th.dataset.col] = Math.round(th.getBoundingClientRect().width) || DEFAULT_WIDTH;
    return widths;
  }
  widthOfColumn(colId) {
    const width = this.node.attrs.cols[colId]?.width;
    if (width) return width;
    return this.isSized() ? DEFAULT_WIDTH : this.drawnWidths()[colId] ?? DEFAULT_WIDTH;
  }
  // Before a preview changes one column of a table that fills the page, every
  // column is pinned at its drawn width, so the others stay where they are.
  // Those widths are kept for the gesture: the table's total follows the
  // previewed column, and the commit saves them rather than measuring again.
  freeze() {
    if (this.isSized() || this.frozen) return;
    this.frozen = this.drawnWidths();
    for (const col of this.colgroup.children) col.style.width = `${this.frozen[col.dataset.col]}px`;
    this.table.style.width = `${Object.values(this.frozen).reduce((sum, w) => sum + w, 0)}px`;
    this.table.classList.add("is-sized");
  }
  showWidth(colId, width) {
    const col = [...this.colgroup.children].find((el) => el.dataset.col === colId);
    if (!col) return;
    this.table.classList.add("is-sized");
    col.style.width = `${width}px`;
    if (this.frozen) this.table.style.width = `${Object.values({ ...this.frozen, [colId]: width }).reduce((sum, w) => sum + w, 0)}px`;
  }
  widthCommand(colId, width) {
    return this.isSized() ? setColumnWidth(colId, width) : setColumnWidths({ ...(this.frozen ?? this.drawnWidths()), [colId]: width }, colId);
  }
  sizeColumn(colId, width) {
    return this.command(colId, this.widthCommand(colId, width));
  }
  handleFor(colId) {
    return [...this.header.querySelectorAll(".page-table-resize")].find((handle) => handle.dataset.col === colId) ?? null;
  }
  // The arrow keys, Home, End, Enter and Escape preview a width; the key that
  // stops repeating, Enter, or leaving the handle commits the one command.
  resizeKey(event, colId) {
    const step = event.shiftKey ? 50 : 10;
    const base = this.preview?.col === colId ? this.preview.width : this.widthOfColumn(colId);
    let next;
    if (event.key === "ArrowLeft") next = base - step;
    else if (event.key === "ArrowRight") next = base + step;
    else if (event.key === "Home") next = MIN_WIDTH;
    else if (event.key === "End") next = MAX_WIDTH;
    else if (event.key === "Enter") { event.preventDefault(); this.commitWidth(colId); return; }
    else if (event.key === "Escape") { event.preventDefault(); this.cancelWidth(colId); return; }
    else return;
    event.preventDefault();
    this.previewWidth(colId, Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next))));
  }
  previewWidth(colId, width) {
    const base = this.preview?.col === colId ? this.preview.base : this.widthOfColumn(colId);
    this.freeze();
    this.preview = { col: colId, width, base };
    this.showWidth(colId, width);
    const handle = this.handleFor(colId);
    if (handle) handle.setAttribute("aria-valuenow", String(width));
  }
  cancelWidth(colId) {
    if (this.preview?.col === colId) this.preview = null;
    this.widths();
    this.handleFor(colId)?.setAttribute("aria-valuenow", String(this.widthOfColumn(colId)));
  }
  // The table and the column are looked up again here: a peer may have removed
  // either one while the preview was up, and then there is nothing to commit.
  commitWidth(colId) {
    const preview = this.preview;
    if (!preview || preview.col !== colId) return false;
    this.preview = null;
    const pos = this.getPos();
    const table = pos == null ? null : this.view.state.doc.nodeAt(pos);
    const col = table?.type === N.table && table.attrs.id === this.node.attrs.id ? table.attrs.cols[colId] : null;
    if (!col) { this.widths(); return false; }
    if ((col.width ?? preview.base) === preview.width) { this.widths(); return false; }
    const seed = columns(table).some((id) => table.attrs.cols[id].width) ? {} : this.frozen ?? this.drawnWidths();
    const cols = { ...table.attrs.cols };
    for (const [id, width] of Object.entries(seed)) if (cols[id]) cols[id] = { ...cols[id], width };
    cols[colId] = { ...col, width: preview.width };
    this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...table.attrs, cols })));
    return true;
  }
  command(colId, command) {
    const done = runOn(this.view, { tableId: this.node.attrs.id, colId }, command);
    this.view.focus();
    return done;
  }
  fit(colId) {
    let widest = 0;
    for (const cell of this.contentDOM.querySelectorAll("td")) if (cell.dataset.col === colId) widest = Math.max(widest, textWidth(cell.querySelector("span") ?? cell));
    const head = [...this.header.querySelectorAll("th")].find((th) => th.dataset.col === colId)?.querySelector("button");
    widest = Math.max(widest, head?.scrollWidth ?? 0);
    return this.sizeColumn(colId, widest + 24);
  }
  render(focus = null) {
    const doc = this.dom.ownerDocument;
    const row = doc.createElement("tr");
    const effective = columnKinds(this.node);
    const tableId = this.node.attrs.id;
    this.widths();
    for (const [index, colId] of columns(this.node).entries()) {
      const col = this.node.attrs.cols[colId];
      const kind = effective[colId];
      const name = columnLabel(col, index);
      const th = doc.createElement("th");
      th.dataset.col = colId;
      th.dataset.kind = kind;
      th.setAttribute("scope", "col");
      th.id = headerId(tableId, colId);
      if (this.node.attrs.sort?.col === colId) th.setAttribute("aria-sort", this.node.attrs.sort.dir === "asc" ? "ascending" : "descending");
      const control = doc.createElement("button");
      control.type = "button";
      control.className = "page-table-col-menu";
      control.textContent = name;
      control.dataset.control = "column";
      control.dataset.col = colId;
      control.dataset.kind = kind;
      control.setAttribute("aria-haspopup", "menu");
      control.setAttribute("aria-expanded", "false");
      control.setAttribute("aria-label", `${name} column actions`);
      control.addEventListener("click", (event) => {
        event.preventDefault();
        this.menuAnchor = control;
        const target = { tableId, colId };
        const run = (command, said) => () => this.act(target, command, said);
        openPageMenu(this.view, control, [
          { label: "Rename", run: () => this.beginRename(colId), focus: false },
          { label: "Kind ▸", icon: KIND_ICONS[kind], hint: col.kind ? KIND_LABELS[kind] : `Auto: ${KIND_LABELS[kind]}`, run: () => openPageMenu(this.view, control, [
            { label: "Auto", icon: col.kind ? "" : KIND_ICONS[kind], hint: col.kind ? "" : KIND_LABELS[kind], checked: !col.kind, run: run(setColumnKind(colId, "auto"), `Kind ${KIND_LABELS[kind]}`) },
            ...COLUMN_KINDS.map((option) => ({ label: KIND_LABELS[option], icon: KIND_ICONS[option], checked: col.kind === option, run: run(setColumnKind(colId, option), `Kind ${KIND_LABELS[option]}`) })),
          ]), focus: false },
          { label: "Sort ascending", icon: "↑", run: run(sortBy(colId, "asc"), "Sorted ascending") },
          { label: "Sort descending", icon: "↓", run: run(sortBy(colId, "desc"), "Sorted descending") },
          { label: "Width ▸", icon: "↔", hint: col.width ? `${col.width}px` : "Auto", focus: false, run: () => openPageMenu(this.view, control, [
            { label: "Wider", icon: "+", run: run(this.widthCommand(colId, this.widthOfColumn(colId) + 40), "Column width changed") },
            { label: "Narrower", icon: "−", run: run(this.widthCommand(colId, this.widthOfColumn(colId) - 40), "Column width changed") },
            { label: "Fit to content", icon: "↔", run: () => this.fit(colId) },
            ...(this.isSized() ? [{ label: "Reset widths", icon: "×", run: run(clearColumnWidths(colId), "Column widths reset") }] : []),
          ]) },
          { label: "Chart this table", icon: "📊", run: () => { const at = this.getPos(); return loadChartPart(this.view).then(({ insertChartAfterTable }) => insertChartAfterTable(this.view, at)); } },
          { label: "Insert column left", icon: "+", run: run(addColumn(false), "Column inserted") },
          { label: "Insert column right", icon: "+", run: run(addColumn(true), "Column inserted") },
          ...(index > 0 ? [{ label: "Move left", icon: "←", run: run(moveColumn(-1), "Column moved") }] : []),
          ...(index < columns(this.node).length - 1 ? [{ label: "Move right", icon: "→", run: run(moveColumn(1), "Column moved") }] : []),
          { label: "Select column", icon: "▦", run: () => selectOn(this.view, target, "col") },
          { label: "Delete column", icon: "×", run: run(deleteColumn, "Column deleted") },
        ], { persist: true });
      });
      th.append(control, this.resizer(colId, th, col, index));
      row.append(th);
    }
    const opened = this.menuAnchor;
    this.header.replaceChildren(row);
    if (opened) {
      const next = this.control({ tableId, control: opened.dataset.control, colId: opened.dataset.col ?? null, rowId: opened.dataset.row ?? null });
      this.menuAnchor = next && next !== opened && reanchorPageMenu(this.view, opened, next) ? next : null;
    }
    if (focus) this.focusControl(focus);
  }
  update(node) {
    if (node.type !== N.table) return false;
    const focused = this.describe(this.dom.ownerDocument.activeElement);
    const preview = this.preview;
    const renaming = this.renaming?.isConnected && focused?.control === "rename";
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    this.preview = null;
    // A peer's edit does not take the name being typed out of the field.
    if (renaming) this.widths();
    else this.render(focused);
    if (preview && node.attrs.cols[preview.col] && (node.attrs.cols[preview.col].width ?? preview.base) === preview.base) {
      this.previewWidth(preview.col, preview.width);
    }
    const effective = columnKinds(node);
    for (const cell of this.contentDOM.querySelectorAll("td[data-col]")) cell.dataset.kind = effective[cell.dataset.col] ?? "text";
    if (focused && !renaming) this.afterUpdate(focused);
    return true;
  }
  stopEvent(event) { return !!event.target.closest?.("thead, .page-table-actions, .page-table-add-row, .page-table-add-col"); }
  ignoreMutation(mutation) { return !this.contentDOM.contains(mutation.target); }
  destroy() {
    this.destroyed = true;
    this.renaming = null;
    this.renamingUnsaved?.dispose();
    this.renamingUnsaved = null;
    this.menuAnchor = null;
    this.preview = null;
  }
}


export class TableCellView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.date = null;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("td");
    cellViews.set(this.dom, this);
    this.dom.dataset.col = node.attrs.col;
    this.contentDOM = doc.createElement("span");
    const menu = doc.createElement("button");
    menu.type = "button";
    menu.className = "page-table-row-menu";
    menu.innerHTML = GEAR;
    menu.dataset.control = "row";
    menu.setAttribute("aria-haspopup", "menu");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Row actions");
    menu.title = "Row actions";
    menu.contentEditable = "false";
    menu.addEventListener("click", () => {
      const target = this.target();
      if (!target) return;
      const found = tableById(this.view.state.doc, target.tableId);
      if (!found) return;
      const at = (command, said) => () => {
        const done = runOn(this.view, target, command);
        announce(this.view, done ? said : UNAVAILABLE);
        return done;
      };
      const row = Math.max(0, rowIndexOf(found.table, target.rowId));
      const count = found.table.childCount;
      openPageMenu(this.view, menu, [
        { label: "Insert above", icon: "+", run: at(addRow(false), "Row inserted") },
        { label: "Insert below", icon: "+", run: at(addRow(true), "Row inserted") },
        ...(row > 0 ? [{ label: "Move up", icon: "↑", run: at(moveRow(-1), "Row moved") }] : []),
        ...(row < count - 1 ? [{ label: "Move down", icon: "↓", run: at(moveRow(1), "Row moved") }] : []),
        { label: "Select row", icon: "▦", run: () => selectOn(this.view, target, "row") },
        { label: "Delete row", icon: "×", run: at(deleteRow, "Row deleted") },
      ], { persist: true });
    });
    this.menu = menu;
    this.dom.append(menu, this.contentDOM);
    this.update(node);
  }
  // The row and column this cell names when its menu opens; both are looked up
  // again by id when a row of the menu runs.
  target() {
    const pos = this.getPos();
    const $cell = pos == null ? null : this.view.state.doc.resolve(pos);
    const table = $cell?.node(1);
    if (!table || table.type !== N.table) return null;
    return { tableId: table.attrs.id, rowId: $cell.node(2).attrs.id ?? null, colId: this.node.attrs.col ?? null };
  }
  update(node) {
    if (node.type !== N.table_cell) return false;
    this.node = node;
    const $cell = this.view.state.doc.resolve(this.getPos());
    const table = $cell.node(1);
    const row = $cell.node(2);
    const index = $cell.index(1);
    this.dom.dataset.col = node.attrs.col;
    this.dom.setAttribute("headers", headerId(table.attrs.id, node.attrs.col));
    this.dom.dataset.kind = columnKinds(table)[node.attrs.col] ?? "text";
    this.menu.dataset.col = node.attrs.col;
    this.menu.dataset.row = row.attrs.id ?? "";
    this.menu.setAttribute("aria-label", `Row actions: ${rowLabel(row, index)}`);
    this.menu.hidden = $cell.index(2) !== 0;
    if (this.dom.dataset.kind !== "date") this.closeDate();
    return true;
  }
  openDate() {
    if (this.date || this.dom.dataset.kind !== "date") return false;
    const doc = this.dom.ownerDocument;
    const input = doc.createElement("input");
    input.type = "date";
    input.className = "page-table-date";
    input.contentEditable = "false";
    input.setAttribute("aria-label", "Pick a date");
    const current = this.node.textContent.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(current)) input.value = current;
    input.addEventListener("change", () => {
      if (input.value) setCellText(this.view, this.getPos(), input.value);
      this.closeDate();
      this.view.focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.closeDate(); this.view.focus(); }
      event.stopPropagation();
    });
    input.addEventListener("blur", () => this.closeDate());
    this.date = input;
    this.dom.append(input);
    try { input.showPicker?.(); } catch {}
    return true;
  }
  closeDate() {
    const input = this.date;
    this.date = null;
    if (input?.isConnected) input.remove();
  }
  destroy() { this.closeDate(); }
  stopEvent(event) { return !!event.target.closest?.(".page-table-row-menu, .page-table-date"); }
  ignoreMutation(mutation) { return !this.contentDOM.contains(mutation.target); }
}

export function createFeature() {
  return {
    id: "table",
    nodeViews: {
      table: (node, view, getPos) => new TableView(node, view, getPos),
      table_cell: (node, view, getPos) => new TableCellView(node, view, getPos),
    },
    css: TABLE_CSS + ACTIONS_CSS,
    dispose() {},
  };
}
