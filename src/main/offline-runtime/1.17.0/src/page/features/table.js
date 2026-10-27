import { schema } from "../schema.js";
import { orderedIds } from "../model.js";
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, addColumn, addRow, deleteColumn, deleteRow, moveColumn, moveRow, renameColumn, selectTableCell, setCellText, setColumnKind, setColumnWidth, sortBy } from "../table.js";
import { COLUMN_KINDS } from "../rich/csv.js";
import { KIND_ICONS, KIND_LABELS, columnKinds } from "../table-kinds.js";
import { openPageMenu } from "../chrome.js";
import { loadChartPart } from "../items.js";
import { selectLine } from "../table-select.js";
import { TABLE_CSS } from "../table-style.js";
import { cellViews } from "../table-views.js";
import { asStep } from "../blocksel.js";

const N = schema.nodes;

const columns = (table) => orderedIds(table.attrs.cols);

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
    this.focusCol = null;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("div");
    this.dom.className = "page-table";
    this.dom.dataset.id = node.attrs.id ?? "";
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Table");
    const scroll = doc.createElement("div");
    scroll.className = "page-table-scroll";
    const table = doc.createElement("table");
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
    for (const control of [addRowButton, addColumnButton]) {
      control.contentEditable = "false";
      control.addEventListener("mousedown", (event) => event.preventDefault());
    }
    this.dom.append(scroll, addRowButton, addColumnButton);
    this.render();
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
    handle.dataset.col = colId;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize column ${col.name || `Column ${index + 1}`}`);
    handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
    handle.setAttribute("aria-valuemax", String(MAX_WIDTH));
    handle.setAttribute("aria-valuenow", String(this.widthOfColumn(colId)));
    handle.tabIndex = 0;
    handle.title = "Drag or use the arrow keys to resize, double-click to fit";
    handle.addEventListener("mousedown", (event) => event.preventDefault());
    handle.addEventListener("focus", () => { this.focusCol = colId; });
    handle.addEventListener("blur", () => this.commitWidth(colId));
    handle.addEventListener("keydown", (event) => this.resizeKey(event, colId));
    handle.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) this.commitWidth(colId);
    });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const start = event.clientX;
      const from = this.node.attrs.cols[colId].width ?? (th.getBoundingClientRect().width || DEFAULT_WIDTH);
      const rtl = this.dom.ownerDocument.defaultView.getComputedStyle?.(this.dom).direction === "rtl";
      let width = from;
      const move = (e) => {
        width = widthOf(from + (rtl ? start - e.clientX : e.clientX - start)) ?? from;
        const col = [...this.colgroup.children].find((el) => el.dataset.col === colId);
        if (col) { this.table.classList.add("is-sized"); col.style.width = `${width}px`; }
      };
      const up = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        if (width !== from) this.command(setColumnWidth(colId, width));
        else this.widths();
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
    });
    handle.addEventListener("dblclick", (event) => { event.preventDefault(); this.fit(colId); });
    return handle;
  }
  widthOfColumn(colId) {
    return this.node.attrs.cols[colId]?.width ?? DEFAULT_WIDTH;
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
    this.preview = { col: colId, width, base };
    const col = [...this.colgroup.children].find((element) => element.dataset.col === colId);
    if (col) { this.table.classList.add("is-sized"); col.style.width = `${width}px`; }
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
    if ((col.width ?? DEFAULT_WIDTH) === preview.width) { this.widths(); return false; }
    const cols = { ...table.attrs.cols, [colId]: { ...col, width: preview.width } };
    this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...table.attrs, cols })));
    return true;
  }
  command(run) {
    const pos = this.getPos();
    if (pos == null) return false;
    selectTableCell(this.view, pos, 0, 0);
    const done = run(this.view.state, this.view.dispatch);
    this.view.focus();
    return done;
  }
  fit(colId) {
    let widest = 0;
    for (const cell of this.contentDOM.querySelectorAll("td")) if (cell.dataset.col === colId) widest = Math.max(widest, textWidth(cell.firstElementChild ?? cell));
    const head = [...this.header.querySelectorAll("th")].find((th) => th.dataset.col === colId)?.querySelector("button");
    widest = Math.max(widest, head?.scrollWidth ?? 0);
    return this.command(setColumnWidth(colId, widest + 24));
  }
  render(refocusCol = null) {
    const doc = this.dom.ownerDocument;
    const row = doc.createElement("tr");
    const effective = columnKinds(this.node);
    this.widths();
    for (const [index, colId] of columns(this.node).entries()) {
      const col = this.node.attrs.cols[colId];
      const kind = effective[colId];
      const th = doc.createElement("th");
      th.dataset.col = colId;
      th.dataset.kind = kind;
      if (this.node.attrs.sort?.col === colId) th.setAttribute("aria-sort", this.node.attrs.sort.dir === "asc" ? "ascending" : "descending");
      const control = button(doc, col.name || `Column ${index + 1}`, (event) => {
        event.preventDefault();
        const run = (command) => () => { selectTableCell(this.view, this.getPos(), 0, index); command(this.view.state, this.view.dispatch); this.view.focus(); };
        const rename = () => {
          const input = doc.createElement("input");
          input.type = "text";
          input.value = col.name;
          input.setAttribute("aria-label", "Column name");
          const finish = (save) => {
            if (save && input.value.trim()) run(renameColumn(colId, input.value))();
            else if (input.isConnected) { input.replaceWith(control); control.focus(); }
          };
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); finish(true); }
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
            e.stopPropagation();
          });
          control.replaceWith(input);
          input.focus();
          input.select();
        };
        openPageMenu(this.view, control, [
          { label: "Rename", run: rename, focus: false },
          { label: "Kind ▸", icon: KIND_ICONS[kind], hint: col.kind ? KIND_LABELS[kind] : `Auto: ${KIND_LABELS[kind]}`, run: () => openPageMenu(this.view, control, [
            { label: "Auto", icon: col.kind ? "" : KIND_ICONS[kind], hint: col.kind ? "" : KIND_LABELS[kind], checked: !col.kind, run: run(setColumnKind(colId, "auto")) },
            ...COLUMN_KINDS.map((option) => ({ label: KIND_LABELS[option], icon: KIND_ICONS[option], checked: col.kind === option, run: run(setColumnKind(colId, option)) })),
          ]), focus: false },
          { label: "Sort ascending", icon: "↑", run: run(sortBy(colId, "asc")) },
          { label: "Sort descending", icon: "↓", run: run(sortBy(colId, "desc")) },
          { label: "Width ▸", icon: "↔", hint: col.width ? `${col.width}px` : "Auto", focus: false, run: () => openPageMenu(this.view, control, [
            { label: "Wider", icon: "+", run: () => this.command(setColumnWidth(colId, (col.width ?? (th.getBoundingClientRect().width || DEFAULT_WIDTH)) + 40)) },
            { label: "Narrower", icon: "−", run: () => this.command(setColumnWidth(colId, (col.width ?? (th.getBoundingClientRect().width || DEFAULT_WIDTH)) - 40)) },
            { label: "Fit to content", icon: "↔", run: () => this.fit(colId) },
            ...(col.width ? [{ label: "Reset width", icon: "×", run: () => this.command(setColumnWidth(colId, null)) }] : []),
          ]) },
          { label: "Chart this table", icon: "📊", run: () => { const at = this.getPos(); return loadChartPart(this.view).then(({ insertChartAfterTable }) => insertChartAfterTable(this.view, at)); } },
          { label: "Insert column left", icon: "+", run: run(addColumn(false)) },
          { label: "Insert column right", icon: "+", run: run(addColumn(true)) },
          ...(index > 0 ? [{ label: "Move left", icon: "←", run: run(moveColumn(-1)) }] : []),
          ...(index < columns(this.node).length - 1 ? [{ label: "Move right", icon: "→", run: run(moveColumn(1)) }] : []),
          { label: "Select column", icon: "▦", run: () => selectLine(this.view, this.getPos(), "col", index) },
          { label: "Delete column", icon: "×", run: run(deleteColumn) },
        ]);
      });
      control.dataset.kind = kind;
      th.append(control, this.resizer(colId, th, col, index));
      row.append(th);
    }
    this.header.replaceChildren(row);
    if (refocusCol) this.handleFor(refocusCol)?.focus();
  }
  update(node) {
    if (node.type !== N.table) return false;
    const focused = this.focusCol && this.dom.contains(this.dom.ownerDocument.activeElement);
    const preview = this.preview;
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    this.preview = null;
    this.render(focused ? this.focusCol : null);
    if (preview && node.attrs.cols[preview.col] && (node.attrs.cols[preview.col].width ?? DEFAULT_WIDTH) === preview.base) {
      this.previewWidth(preview.col, preview.width);
    }
    const effective = columnKinds(node);
    for (const cell of this.contentDOM.querySelectorAll("td[data-col]")) cell.dataset.kind = effective[cell.dataset.col] ?? "text";
    return true;
  }
  stopEvent(event) { return !!event.target.closest?.("thead"); }
  ignoreMutation(mutation) { return !this.contentDOM.contains(mutation.target); }
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
    this.dom.append(this.contentDOM);
    const menu = doc.createElement("button");
    menu.type = "button";
    menu.className = "page-table-row-menu";
    menu.textContent = "Row actions";
    menu.setAttribute("aria-label", "Row actions");
    menu.contentEditable = "false";
    menu.addEventListener("click", () => {
      const $cell = this.view.state.doc.resolve(this.getPos());
      const tablePos = $cell.before(1);
      const row = $cell.index(1);
      const run = (command) => () => { selectTableCell(this.view, tablePos, row, 0); command(this.view.state, this.view.dispatch); this.view.focus(); };
      const count = $cell.node(1).childCount;
      openPageMenu(this.view, menu, [
        { label: "Insert above", icon: "+", run: run(addRow(false)) },
        { label: "Insert below", icon: "+", run: run(addRow(true)) },
        ...(row > 0 ? [{ label: "Move up", icon: "↑", run: run(moveRow(-1)) }] : []),
        ...(row < count - 1 ? [{ label: "Move down", icon: "↓", run: run(moveRow(1)) }] : []),
        { label: "Select row", icon: "▦", run: () => selectLine(this.view, tablePos, "row", row) },
        { label: "Delete row", icon: "×", run: run(deleteRow) },
      ]);
    });
    this.menu = menu;
    this.dom.append(menu);
    this.update(node);
  }
  update(node) {
    if (node.type !== N.table_cell) return false;
    this.node = node;
    const $cell = this.view.state.doc.resolve(this.getPos());
    const table = $cell.node(1);
    this.dom.dataset.kind = columnKinds(table)[node.attrs.col] ?? "text";
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
    css: TABLE_CSS,
    dispose() {},
  };
}
