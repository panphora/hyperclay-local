import { state, keymap } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { keyBetween, keysBetween, newId, orderedIds, cellContent } from "./model.js";
import { placeAt } from "./ybind/board-commands.js";
import { parseDecimal, COLUMN_KINDS } from "./rich/csv.js";
import { columnKinds, KIND_ICONS, KIND_LABELS } from "./table-kinds.js";
import { asStep } from "./blocksel.js";
import { openPageMenu } from "./chrome.js";
import { insertChartAfterTable } from "./chart.js";
import { REMOTE_META } from "./ybind/layout.js";
import { gridFromClipboard, tableFromGrid } from "./table-paste.js";
import { rectTopLeft, selectLine } from "./table-select.js";
import toast from "../ui/toast.js";

const { Plugin, TextSelection } = state;
const N = schema.nodes;
export const TABLE_IMPORT_LIMIT = 256 * 1024;

const columns = (table) => orderedIds(table.attrs.cols);
const tableAt = (st) => {
  const $pos = st.selection.$head;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type === N.table) {
      const table = $pos.node(depth);
      const row = depth < $pos.depth ? $pos.index(depth) : 0;
      const cell = depth + 1 < $pos.depth ? $pos.index(depth + 1) : 0;
      return { table, pos: $pos.before(depth), row, cell };
    }
  }
  return null;
};

const cellPos = (doc, tablePos, row, cell) => {
  const table = doc.nodeAt(tablePos);
  if (!table || !table.childCount) return null;
  row = Math.max(0, Math.min(row, table.childCount - 1));
  cell = Math.max(0, Math.min(cell, table.child(row).childCount - 1));
  let pos = tablePos + 1;
  for (let i = 0; i < row; i++) pos += table.child(i).nodeSize;
  pos++;
  for (let i = 0; i < cell; i++) pos += table.child(row).child(i).nodeSize;
  return pos + 1;
};

const emptyRow = (cols, pos = keyBetween()) => N.table_row.create({ id: newId("r"), pos }, cols.map((col) => N.table_cell.create({ col })));
const copyTable = (table, attrs, rows) => N.table.create({ ...table.attrs, ...attrs }, rows);

function changeTable(st, dispatch, change) {
  const found = tableAt(st);
  if (!found) return false;
  const result = change(found.table, found);
  if (!result) return false;
  if (dispatch) {
    const { table, row = found.row, cell = found.cell } = result;
    const tr = st.tr.replaceWith(found.pos, found.pos + found.table.nodeSize, table);
    const at = cellPos(tr.doc, found.pos, row, cell);
    if (at !== null) tr.setSelection(TextSelection.create(tr.doc, at));
    dispatch(asStep(tr));
  }
  return true;
}

export function insertTableNode(st, dispatch, table, remove = null, attachment = null) {
  const index = st.selection.$head.index(0);
  const current = st.doc.child(index);
  let at = 0;
  for (let i = 0; i < index; i++) at += st.doc.child(i).nodeSize;
  const replace = current.isTextblock && (current.content.size === 0 || (remove?.from === at + 1 && remove?.to === at + current.nodeSize - 1));
  const next = st.doc.maybeChild(index + 1);
  const pos = replace ? current.attrs.pos : keyBetween(current.attrs.pos, next?.attrs.pos ?? null);
  const node = table.type.create({ ...table.attrs, pos, parent: current.attrs.parent ?? null }, table.content);
  if (dispatch) {
    const tr = st.tr;
    if (remove) tr.delete(remove.from, remove.to);
    const mappedAt = tr.mapping.map(at);
    const currentAfter = tr.doc.child(index);
    const inserted = replace ? mappedAt : mappedAt + currentAfter.nodeSize;
    tr.replaceWith(inserted, replace ? mappedAt + currentAfter.nodeSize : inserted, node);
    if (attachment) {
      const file = attachment.type.create({ ...attachment.attrs, pos: keyBetween(pos, next?.attrs.pos ?? null), parent: current.attrs.parent ?? null }, attachment.content);
      tr.insert(inserted + node.nodeSize, file);
    }
    tr.setSelection(TextSelection.create(tr.doc, cellPos(tr.doc, inserted, 0, 0)));
    dispatch(asStep(tr).scrollIntoView());
  }
  return true;
}

export function makeTable(rows = 3, cols = 3) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return null;
  const ids = Array.from({ length: cols }, () => newId("c"));
  const positions = keysBetween(null, null, cols);
  const map = Object.fromEntries(ids.map((id, i) => [id, { pos: positions[i], name: `Column ${i + 1}` }]));
  const rowPositions = keysBetween(null, null, rows);
  const children = rowPositions.map((pos) => emptyRow(ids, pos));
  return N.table.create({ id: newId(), cols: map }, children);
}

export const insertTable = (rows = 3, cols = 3) => (st, dispatch) => {
  const node = makeTable(rows, cols);
  return node ? insertTableNode(st, dispatch, node) : false;
};

const moveTo = (advance) => (st, dispatch) => {
  const found = tableAt(st);
  if (!found || st.selection.$head.parent.type !== N.table_cell) return false;
  const width = found.table.child(found.row).childCount;
  let row = found.row, cell = found.cell;
  if (advance === "down") row++;
  else {
    cell += advance;
    if (cell >= width) { row++; cell = 0; }
    if (cell < 0) { row--; cell = width - 1; }
  }
  if (row < 0) return true;
  if (row >= found.table.childCount) {
    if (advance === -1) return true;
    return appendAndMove(st, dispatch, found, cell);
  }
  if (dispatch) dispatch(st.tr.setSelection(TextSelection.create(st.doc, cellPos(st.doc, found.pos, row, cell))).scrollIntoView());
  return true;
};

function appendAndMove(st, dispatch, found, cell) {
  const rows = [...found.table.content.content];
  rows.push(emptyRow(columns(found.table), keyBetween(rows.at(-1).attrs.pos, null)));
  if (dispatch) {
    const tr = st.tr.replaceWith(found.pos, found.pos + found.table.nodeSize, copyTable(found.table, { sort: null }, rows));
    tr.setSelection(TextSelection.create(tr.doc, cellPos(tr.doc, found.pos, rows.length - 1, cell)));
    dispatch(asStep(tr).scrollIntoView());
  }
  return true;
}

export const nextCell = moveTo(1);
export const prevCell = moveTo(-1);
export const cellBelow = moveTo("down");

export const addRow = (after = true) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const rows = [...table.content.content];
  const index = found.row + (after ? 1 : 0);
  const pos = keyBetween(rows[index - 1]?.attrs.pos ?? null, rows[index]?.attrs.pos ?? null);
  rows.splice(index, 0, emptyRow(columns(table), pos));
  return { table: copyTable(table, { sort: null }, rows), row: index };
});

export const deleteRow = (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const rows = [...table.content.content];
  if (rows.length === 1) {
    const row = rows[0];
    rows[0] = N.table_row.create(row.attrs, columns(table).map((col) => N.table_cell.create({ col })));
  } else rows.splice(found.row, 1);
  return { table: copyTable(table, { sort: null }, rows), row: Math.min(found.row, rows.length - 1) };
});

const placeColumn = (cols, ids, index, id, fields) => {
  const { pos, rekey } = placeAt(ids, (col) => cols[col]?.pos ?? "", index);
  const next = { ...cols, [id]: { ...fields, pos } };
  for (const [col, key] of rekey) next[col] = { ...next[col], pos: key };
  return next;
};

export const addColumn = (after = true) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const ids = columns(table);
  const index = found.cell + (after ? 1 : 0);
  const id = newId("c");
  const cols = placeColumn(table.attrs.cols, ids, index, id, { name: `Column ${ids.length + 1}` });
  const rows = table.content.content.map((row) => {
    const cells = [...row.content.content];
    cells.splice(index, 0, N.table_cell.create({ col: id }));
    return N.table_row.create(row.attrs, cells);
  });
  return { table: copyTable(table, { cols }, rows), cell: index };
});

export const deleteColumn = (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const ids = columns(table);
  if (ids.length <= 1) return null;
  const cols = { ...table.attrs.cols };
  delete cols[ids[found.cell]];
  const rows = table.content.content.map((row) => N.table_row.create(row.attrs, row.content.content.filter((_, i) => i !== found.cell)));
  return { table: copyTable(table, { cols, sort: table.attrs.sort?.col === ids[found.cell] ? null : table.attrs.sort }, rows), cell: Math.min(found.cell, ids.length - 2) };
});

export const moveRow = (delta) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const to = found.row + delta;
  if (to < 0 || to >= table.childCount) return null;
  const rows = [...table.content.content];
  const [row] = rows.splice(found.row, 1);
  rows.splice(to, 0, row);
  const pos = keyBetween(rows[to - 1]?.attrs.pos ?? null, rows[to + 1]?.attrs.pos ?? null);
  rows[to] = N.table_row.create({ ...row.attrs, pos }, row.content);
  return { table: copyTable(table, { sort: null }, rows), row: to };
});

export const moveColumn = (delta) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const ids = columns(table);
  const to = found.cell + delta;
  if (to < 0 || to >= ids.length) return null;
  const order = [...ids];
  const [id] = order.splice(found.cell, 1);
  order.splice(to, 0, id);
  const cols = placeColumn(table.attrs.cols, order.filter((col) => col !== id), to, id, table.attrs.cols[id]);
  const rows = table.content.content.map((row) => {
    const cells = [...row.content.content];
    const [cell] = cells.splice(found.cell, 1);
    cells.splice(to, 0, cell);
    return N.table_row.create(row.attrs, cells);
  });
  return { table: copyTable(table, { cols }, rows), cell: to };
});

export const MIN_WIDTH = 48, MAX_WIDTH = 1200, DEFAULT_WIDTH = 160;
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

export const setColumnWidth = (colId, width) => (st, dispatch) => changeTable(st, dispatch, (table) => {
  const col = table.attrs.cols[colId];
  if (!col) return null;
  const next = width === null ? null : widthOf(width);
  if (width !== null && next === null) return null;
  if ((col.width ?? null) === next) return null;
  const { width: _old, ...rest } = col;
  const cols = { ...table.attrs.cols, [colId]: next === null ? rest : { ...col, width: next } };
  return { table: copyTable(table, { cols }, table.content), cell: columns(table).indexOf(colId) };
});

export const renameColumn = (colId, name) => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !String(name).trim()) return null;
  const cols = { ...table.attrs.cols, [colId]: { ...table.attrs.cols[colId], name: String(name).trim() } };
  return { table: copyTable(table, { cols }, table.content) };
});

export const setColumnKind = (colId, kind) => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !(kind === "auto" || COLUMN_KINDS.includes(kind))) return null;
  const { kind: _old, ...rest } = table.attrs.cols[colId];
  const cols = { ...table.attrs.cols, [colId]: kind === "auto" ? rest : { ...table.attrs.cols[colId], kind } };
  return { table: copyTable(table, { cols, sort: table.attrs.sort?.col === colId ? null : table.attrs.sort }, table.content) };
});

export const sortBy = (colId, dir = "asc") => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !["asc", "desc"].includes(dir)) return null;
  const index = columns(table).indexOf(colId);
  const kind = columnKinds(table)[colId];
  const values = [...table.content.content].map((row, previous) => ({ row, previous, text: row.child(index).textContent.trim() }));
  values.sort((a, b) => {
    if (!a.text || !b.text) return !a.text && !b.text ? a.previous - b.previous : !a.text ? 1 : -1;
    const av = kind === "number" ? parseDecimal(a.text) : a.text;
    const bv = kind === "number" ? parseDecimal(b.text) : b.text;
    if (av == null || bv == null) return av == null && bv == null ? a.previous - b.previous : av == null ? 1 : -1;
    const compare = kind === "number" ? av - bv : kind === "date" ? (av < bv ? -1 : av > bv ? 1 : 0) : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    return compare ? (dir === "asc" ? compare : -compare) : a.previous - b.previous;
  });
  const positions = keysBetween(null, null, values.length);
  const rows = values.map(({ row }, i) => N.table_row.create({ ...row.attrs, pos: positions[i] }, row.content));
  return { table: copyTable(table, { sort: { col: colId, dir } }, rows) };
});

// Pasted cells overwrite the cells from `at` (the caret's cell by default)
// rightwards and down, adding rows below the table when the paste needs them.
// Cells past the last column are dropped.
export const pasteGrid = (grid, at = null) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const ids = columns(table);
  const row0 = at?.row ?? found.row, col0 = at?.cell ?? found.cell;
  const rows = [...table.content.content];
  grid.forEach((line, i) => {
    const r = row0 + i;
    if (r >= rows.length) rows.push(emptyRow(ids, keyBetween(rows.at(-1).attrs.pos, null)));
    const cells = [...rows[r].content.content];
    line.forEach((value, j) => {
      if (col0 + j < ids.length) cells[col0 + j] = N.table_cell.create({ col: ids[col0 + j] }, cellContent(schema, value));
    });
    rows[r] = N.table_row.create(rows[r].attrs, cells);
  });
  const width = Math.max(1, ...grid.map((line) => line.length));
  return { table: copyTable(table, { sort: null }, rows), row: row0 + grid.length - 1, cell: Math.min(col0 + width - 1, ids.length - 1) };
});

const tableSize = (node) => new TextEncoder().encode(JSON.stringify(node.toJSON())).length;

export function pasteTable(view, event) {
  const data = event.clipboardData;
  if (!data || data.files?.length) return false;
  const st = view.state;
  if (st.selection.$from.parent.type.spec.code) return false;
  const rect = rectTopLeft(st);
  const text = data.getData("text/plain").replace(/\r?\n$/, "");
  const found = gridFromClipboard(data.getData("text/html"), data.getData("text/plain"), view.dom.ownerDocument)
    ?? (rect && text && !/[\r\n]/.test(text) ? { grid: [[text]], width: 1, height: 1, own: false } : null);
  if (!found) return false;
  if (rect && rect.rows * rect.cols > 1 && found.width * found.height === 1) {
    return pasteGrid(Array.from({ length: rect.rows }, () => Array(rect.cols).fill(found.grid[0][0])), { row: rect.row, cell: rect.cell })(st, view.dispatch);
  }
  if (rect) return pasteGrid(found.grid, { row: rect.row, cell: rect.cell })(st, view.dispatch);
  if (st.selection.$head.parent.type === N.table_cell) {
    if (found.width * found.height < 2) return false;
    return pasteGrid(found.grid)(st, view.dispatch);
  }
  if (found.width * found.height < 2) return false;
  if (found.height < 2 && !/<table[\s>]/i.test(data.getData("text/html"))) return false;
  const table = tableFromGrid(found.grid, { header: !found.own && found.height > 1 });
  if (!table) return false;
  if (tableSize(table) > TABLE_IMPORT_LIMIT) {
    toast("This paste is too large for one table.", "error");
    return true;
  }
  const { from, to, empty, $from, $to } = st.selection;
  if (!empty && $from.index(0) !== $to.index(0)) {
    const tr = st.tr.deleteSelection();
    return insertTableNode(st.apply(tr), (inner) => {
      for (const step of inner.steps) tr.step(step);
      tr.setSelection(TextSelection.create(tr.doc, inner.selection.from));
      view.dispatch(asStep(tr).scrollIntoView());
    }, table);
  }
  return insertTableNode(st, view.dispatch, table, empty ? null : { from, to });
}

export const tableKeys = keymap.keymap({ Tab: nextCell, "Shift-Tab": prevCell, Enter: cellBelow, "Mod-Enter": addRow(true) });

export function tablePlugin() {
  return new Plugin({
    props: {
      handlePaste: pasteTable,
      handleClickOn(view, _pos, node, nodePos, event, direct) {
        if (node.type !== N.table_cell || !direct || event.button) return false;
        const desc = view.nodeDOM(nodePos);
        const cellView = desc && cellViews.get(desc);
        if (cellView) cellView.openDate();
        return false;
      },
    },
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged && !tr.getMeta(REMOTE_META))) return null;
      const old = new Map();
      oldState.doc.forEach((node) => { if (node.type === N.table) old.set(node.attrs.id, node); });
      const tr = newState.tr;
      newState.doc.forEach((table, pos) => {
        if (table.type !== N.table || !table.attrs.sort) return;
        const before = old.get(table.attrs.id), col = table.attrs.sort.col;
        if (!before) return;
        const cells = (node) => Object.fromEntries(node.content.content.map((row) => [row.attrs.id, row.content.content.find((cell) => cell.attrs.col === col)?.textContent]));
        const previous = cells(before), current = cells(table);
        if (Object.keys(previous).length !== Object.keys(current).length || Object.keys(previous).some((id) => previous[id] !== current[id] || !Object.hasOwn(current, id))) {
          tr.setNodeMarkup(pos, null, { ...table.attrs, sort: null });
        }
      });
      return tr.docChanged ? tr : null;
    },
  });
}

const button = (doc, label, action) => {
  const el = doc.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.setAttribute("aria-label", label);
  el.addEventListener("click", action);
  return el;
};

export function setCellText(view, cellPos, text) {
  const cell = view.state.doc.nodeAt(cellPos);
  if (cell?.type !== N.table_cell) return false;
  const tr = view.state.tr.replaceWith(cellPos + 1, cellPos + cell.nodeSize - 1, text ? schema.text(text) : []);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + text.length)));
  return true;
}

export function selectTableCell(view, tablePos, row, cell) {
  const pos = cellPos(view.state.doc, tablePos, row, cell);
  if (pos === null) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return true;
}

export class TableView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
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
  resizer(colId, th) {
    const doc = this.dom.ownerDocument;
    const handle = doc.createElement("span");
    handle.className = "page-table-resize";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize column");
    handle.title = "Drag to resize, double-click to fit";
    handle.addEventListener("mousedown", (event) => event.preventDefault());
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
  render() {
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
          { label: "Chart this table", icon: "📊", run: () => insertChartAfterTable(this.view, this.getPos()) },
          { label: "Insert column left", icon: "+", run: run(addColumn(false)) },
          { label: "Insert column right", icon: "+", run: run(addColumn(true)) },
          ...(index > 0 ? [{ label: "Move left", icon: "←", run: run(moveColumn(-1)) }] : []),
          ...(index < columns(this.node).length - 1 ? [{ label: "Move right", icon: "→", run: run(moveColumn(1)) }] : []),
          { label: "Select column", icon: "▦", run: () => selectLine(this.view, this.getPos(), "col", index) },
          { label: "Delete column", icon: "×", run: run(deleteColumn) },
        ]);
      });
      control.dataset.kind = kind;
      th.append(control, this.resizer(colId, th));
      row.append(th);
    }
    this.header.replaceChildren(row);
  }
  update(node) {
    if (node.type !== N.table) return false;
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    this.render();
    const effective = columnKinds(node);
    for (const cell of this.contentDOM.querySelectorAll("td[data-col]")) cell.dataset.kind = effective[cell.dataset.col] ?? "text";
    return true;
  }
  stopEvent(event) { return !!event.target.closest?.("thead"); }
  ignoreMutation(mutation) { return !this.contentDOM.contains(mutation.target); }
}

const cellViews = new WeakMap();

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
