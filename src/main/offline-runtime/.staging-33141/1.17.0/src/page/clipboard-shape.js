// Lists and tables on the clipboard in the saved article's shape, so another app
// gets real lists and a header row and a Document reads them back as the same
// blocks. A copy nests list items as <ul>/<ol> by indent, leads a check item with
// its checkbox and names a table's columns in a <thead>; a toggle's own list items
// keep the editor's flat form, which carries their toggle. On paste,
// flattenPastedHTML turns the lists back into items and moves the slice's open
// depths (data-pm-slice, left on the dropped <ul>) to the first block, and the
// table rule in blocks.js reads a table through table() and rows() below; a
// Document's own table skips pasteTable's grid path for it. The text flavor is
// markdown list lines (parseListText reads them) and tab-separated table rows.
// blocks.js loads this module when an editor mounts, off the input-ready path.
import { model } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { keysBetween, newId, orderedIds } from "./model.js";
import { clipboardParser } from "./blocks.js";

const N = schema.nodes;
const parentOf = (n) => n.attrs.parent ?? null;

const copiedCols = (table) => {
  const used = new Set();
  table.forEach((row) => row.forEach((cell) => used.add(cell.attrs.col)));
  return orderedIds(table.attrs.cols).filter((id) => used.has(id));
};

function tableHead(table, dom) {
  const doc = dom.ownerDocument;
  const tr = doc.createElement("thead").appendChild(doc.createElement("tr"));
  for (const id of copiedCols(table)) {
    const col = table.attrs.cols[id], th = tr.appendChild(doc.createElement("th"));
    th.setAttribute("data-col", id);
    th.setAttribute("scope", "col");
    if (col.kind) th.setAttribute("data-kind", col.kind);
    if (col.width) { th.setAttribute("data-width", String(col.width)); th.style.width = `${col.width}px`; }
    th.textContent = col.name ?? "";
  }
  dom.prepend(tr.parentNode);
  if (table.attrs.sort) dom.setAttribute("data-sort", JSON.stringify(table.attrs.sort));
}

// The serializer's top-level elements, one per block of the fragment, rewritten in place.
export function copy(fragment, doms) {
  let lists = [];
  fragment.forEach((n, _, i) => {
    const dom = doms[i];
    if (!dom || dom.nodeType !== 1) return;
    if (n.type === N.table) tableHead(n, dom);
    if (n.type !== N.list_item || parentOf(n) !== null) { lists = []; return; }
    const doc = dom.ownerDocument, { indent, kind } = n.attrs, tag = kind === "ordered" ? "OL" : "UL";
    while (lists.length && lists.at(-1).indent > indent) lists.pop();
    if (lists.at(-1)?.indent === indent && lists.at(-1).list.tagName !== tag) lists.pop();
    if (!lists.length || lists.at(-1).indent < indent) {
      const list = doc.createElement(tag);
      if (lists.length) lists.at(-1).li.append(list); else dom.before(list);
      lists.push({ indent, list, li: null });
    }
    const li = doc.createElement("li");
    if (kind === "check") li.innerHTML = `<input type="checkbox" disabled${n.attrs.checked ? " checked" : ""}>`;
    li.append(...dom.childNodes);
    lists.at(-1).list.append(li);
    lists.at(-1).li = li;
    dom.remove();
  });
}

const quoteCell = (text) => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function text(slice) {
  if (!slice.content.firstChild?.type.spec.group?.includes("block")) return null;
  let out = "", runs = [], prevList = false;
  slice.content.forEach((n, _, i) => {
    const list = n.type === N.list_item;
    let line = n.textBetween(0, n.content.size, "\n\n");
    if (list) {
      const { indent, kind } = n.attrs;
      while (runs.length && runs.at(-1).indent > indent) runs.pop();
      if (runs.at(-1)?.indent === indent && runs.at(-1).kind !== kind) runs.pop();
      if (!runs.length || runs.at(-1).indent < indent) runs.push({ indent, kind, n: 0 });
      const run = runs.at(-1);
      const marker = kind === "ordered" ? `${++run.n}.` : kind === "check" ? `- [${n.attrs.checked ? "x" : " "}]` : "-";
      line = `${"    ".repeat(runs.length - 1)}${marker} ${line}`;
    } else runs = [];
    if (n.type === N.table) {
      const rows = [copiedCols(n).map((id) => quoteCell(n.attrs.cols[id].name ?? ""))];
      n.forEach((row) => { const cells = []; row.forEach((cell) => cells.push(quoteCell(cell.textContent))); rows.push(cells); });
      line = rows.map((row) => row.join("\t")).join("\n");
    }
    out += (i ? (prevList && list ? "\n" : "\n\n") : "") + line;
    prevList = list;
  });
  return out;
}

// A pasted table: its header row (a <thead> row, or a first row of <th>) names
// the columns, and a copied one keeps each column's id, kind and width; every
// other row is a row of cells. Rows get their ids and order keys from identityPlugin.
const tables = new WeakMap();
function pastedTable(dom) {
  if (tables.has(dom)) return tables.get(dom);
  const cellsOf = (tr) => [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");
  const trs = [...dom.querySelectorAll("tr")].filter((tr) => tr.closest("table") === dom);
  const head = trs.find((tr) => tr.parentElement.tagName === "THEAD") ?? (trs.length > 1 && cellsOf(trs[0]).every((c) => c.tagName === "TH") ? trs[0] : null);
  const body = trs.filter((tr) => tr !== head);
  const names = head ? cellsOf(head) : [];
  const width = Math.max(1, names.length, ...body.map((tr) => cellsOf(tr).length));
  const keys = keysBetween(null, null, width);
  const ids = [], cols = {};
  for (let i = 0; i < width; i++) {
    const th = names[i];
    let id = th?.getAttribute("data-col");
    if (!id || Object.hasOwn(cols, id)) id = newId("c");
    const kind = th?.getAttribute("data-kind"), w = Math.round(Number(th?.getAttribute("data-width")));
    cols[id] = { pos: keys[i], name: th?.textContent.replace(/\s+/g, " ").trim() || `Column ${i + 1}`, ...(kind ? { kind } : {}), ...(w > 0 ? { width: w } : {}) };
    ids.push(id);
  }
  const cell = (td, col) => (td ? clipboardParser.parse(td, { topNode: N.table_cell.create({ col }) }) : N.table_cell.create({ col }));
  const rows = (body.length ? body : [null]).map((tr) => N.table_row.create(null, ids.map((col, i) => cell(tr && cellsOf(tr)[i], col))));
  let sort = null;
  try { sort = JSON.parse(dom.getAttribute("data-sort")); } catch {}
  const found = { cols, sort: sort && ids.includes(sort.col) && (sort.dir === "asc" || sort.dir === "desc") ? { col: sort.col, dir: sort.dir } : null, rows: model.Fragment.from(rows) };
  tables.set(dom, found);
  return found;
}

export const table = (dom) => ({ cols: pastedTable(dom).cols, sort: pastedTable(dom).sort, parent: dom.getAttribute("data-page-parent") || null });
export const rows = (dom) => pastedTable(dom).rows;
