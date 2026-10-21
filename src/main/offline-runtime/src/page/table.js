import { state, keymap } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { keyBetween, keysBetween, newId, orderedIds } from "./model.js";
import { parseDecimal } from "./rich/csv.js";
import { asStep } from "./blocksel.js";
import { openPageMenu } from "./chrome.js";
import { insertChartAfterTable } from "./chart.js";
import { REMOTE_META } from "./ybind/layout.js";

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
  const map = Object.fromEntries(ids.map((id, i) => [id, { pos: positions[i], name: `Column ${i + 1}`, kind: "text" }]));
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

export const addColumn = (after = true) => (st, dispatch) => changeTable(st, dispatch, (table, found) => {
  const ids = columns(table);
  const index = found.cell + (after ? 1 : 0);
  const id = newId("c");
  const cols = { ...table.attrs.cols, [id]: { pos: keyBetween(table.attrs.cols[ids[index - 1]]?.pos ?? null, table.attrs.cols[ids[index]]?.pos ?? null), name: `Column ${ids.length + 1}`, kind: "text" } };
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

export const renameColumn = (colId, name) => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !String(name).trim()) return null;
  const cols = { ...table.attrs.cols, [colId]: { ...table.attrs.cols[colId], name: String(name).trim() } };
  return { table: copyTable(table, { cols }, table.content) };
});

export const setColumnKind = (colId, kind) => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !["text", "number", "date"].includes(kind)) return null;
  const cols = { ...table.attrs.cols, [colId]: { ...table.attrs.cols[colId], kind } };
  return { table: copyTable(table, { cols, sort: table.attrs.sort?.col === colId ? null : table.attrs.sort }, table.content) };
});

export const sortBy = (colId, dir = "asc") => (st, dispatch) => changeTable(st, dispatch, (table) => {
  if (!table.attrs.cols[colId] || !["asc", "desc"].includes(dir)) return null;
  const index = columns(table).indexOf(colId);
  const kind = table.attrs.cols[colId].kind ?? "text";
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

export const tableKeys = keymap.keymap({ Tab: nextCell, "Shift-Tab": prevCell, Enter: cellBelow, "Mod-Enter": addRow(true) });

export function tablePlugin() {
  return new Plugin({
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
    this.header = doc.createElement("thead");
    this.header.contentEditable = "false";
    this.contentDOM = doc.createElement("tbody");
    table.append(this.header, this.contentDOM);
    scroll.append(table);
    this.dom.append(scroll);
    this.render();
  }
  render() {
    const doc = this.dom.ownerDocument;
    const row = doc.createElement("tr");
    for (const [index, colId] of columns(this.node).entries()) {
      const col = this.node.attrs.cols[colId];
      const th = doc.createElement("th");
      th.dataset.col = colId;
      th.dataset.kind = col.kind ?? "text";
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
          { label: "Kind ▸", run: () => openPageMenu(this.view, control, ["text", "number", "date"].map((kind) => ({ label: kind[0].toUpperCase() + kind.slice(1), run: run(setColumnKind(colId, kind)) }))), focus: false },
          { label: "Sort ascending", run: run(sortBy(colId, "asc")) },
          { label: "Sort descending", run: run(sortBy(colId, "desc")) },
          { label: "Chart this table", run: () => insertChartAfterTable(this.view, this.getPos()) },
          { label: "Insert column left", run: run(addColumn(false)) },
          { label: "Insert column right", run: run(addColumn(true)) },
          { label: "Delete column", run: run(deleteColumn) },
        ]);
      });
      control.dataset.kind = col.kind ?? "text";
      th.append(control);
      row.append(th);
    }
    this.header.replaceChildren(row);
  }
  update(node) {
    if (node.type !== N.table) return false;
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    this.render();
    for (const cell of this.contentDOM.querySelectorAll("td[data-col]")) cell.dataset.kind = node.attrs.cols[cell.dataset.col]?.kind ?? "text";
    return true;
  }
  stopEvent(event) { return !!event.target.closest?.("thead"); }
}

export class TableCellView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("td");
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
      openPageMenu(this.view, menu, [
        { label: "Insert above", run: run(addRow(false)) },
        { label: "Insert below", run: run(addRow(true)) },
        { label: "Delete row", run: run(deleteRow) },
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
    this.dom.dataset.kind = table.attrs.cols[node.attrs.col]?.kind ?? "text";
    this.menu.hidden = $cell.index(2) !== 0;
    return true;
  }
  stopEvent(event) { return !!event.target.closest?.(".page-table-row-menu"); }
}
