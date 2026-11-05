import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { nodeFromBlock, newId, keyBetween } from "./model.js";
import { parseCsv, tableFromCsv, CsvError } from "./rich/csv.js";
import { TABLE_IMPORT_LIMIT, insertTableNode } from "./table.js";
import { safeFileHref } from "./address.js";
import { asStep } from "./blocksel.js";
import { holdSlashRange, heldSlashRange } from "./chrome.js";

const { Plugin } = state;
const inputs = new WeakMap();

const readText = (file) => typeof file.text === "function" ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

function error(view, message) {
  const doc = view.dom.ownerDocument;
  let notice = view.dom.parentElement.querySelector(".page-csv-error");
  if (!notice) {
    notice = doc.createElement("div");
    notice.className = "page-csv-error";
    notice.setAttribute("role", "alert");
    view.dom.parentElement.append(notice);
  }
  notice.textContent = message;
}

function tableNode(parsed) {
  let count = 0;
  const data = tableFromCsv(parsed, { maxBytes: TABLE_IMPORT_LIMIT, newId: () => newId(count++ < parsed.header.length ? "c" : "r") });
  if (!Object.keys(data.cols).length) return null;
  if (!Object.keys(data.rows).length) {
    const cells = Object.fromEntries(Object.keys(data.cols).map((id) => [id, ""]));
    data.rows[newId("r")] = { pos: keyBetween(), cells };
  }
  return { node: nodeFromBlock(schema, newId(), { t: "table", pos: null, cols: data.cols, rows: data.rows }), truncated: data.truncated };
}

async function confirmTruncation({ kept, total }) {
  const message = `This file has ${total} rows. The first ${kept} fit in a table.`;
  let confirm = globalThis.clay?.confirm;
  let modal = globalThis.clay?.modal;
  if (!confirm) {
    confirm = (await import("../ui/dialogs.js")).consent;
    modal = (await import("../ui/modal.js")).default;
  }
  const promise = confirm(message);
  if (modal) modal.yes = `Insert first ${kept} rows and attach the file`;
  try { await promise; return true; } catch { return false; }
}

const tableIndex = (doc, id) => {
  let found = -1;
  doc.forEach((node, _offset, index) => { if (found < 0 && node.type === schema.nodes.table && node.attrs.id === id) found = index; });
  return found;
};

const emptyTable = (table) => {
  let empty = true;
  table.descendants((node) => { if (node.isText) empty = false; return empty; });
  return empty;
};

// From a table's menu: an empty table is filled in place (it keeps its id,
// order and parent), a table with content gets the imported one below it.
function placeImported(view, node, tableId, attachment) {
  const st = view.state;
  const index = tableIndex(st.doc, tableId);
  if (index < 0) return insertTableNode(st, view.dispatch, node, null, attachment);
  let at = 0;
  for (let i = 0; i < index; i++) at += st.doc.child(i).nodeSize;
  const table = st.doc.child(index);
  if (!emptyTable(table) || attachment) {
    const next = st.doc.maybeChild(index + 1);
    const parent = table.attrs.parent ?? null;
    const pos = keyBetween(table.attrs.pos, next?.attrs.pos ?? null);
    const placed = node.type.create({ ...node.attrs, pos, parent }, node.content);
    const end = at + table.nodeSize;
    const tr = st.tr.insert(end, placed);
    if (attachment) tr.insert(end + placed.nodeSize, attachment.type.create({ ...attachment.attrs, pos: keyBetween(pos, next?.attrs.pos ?? null), parent }, attachment.content));
    tr.setSelection(state.TextSelection.create(tr.doc, end + 3));
    view.dispatch(asStep(tr).scrollIntoView());
    return true;
  }
  const filled = node.type.create({ ...node.attrs, id: table.attrs.id, pos: table.attrs.pos, parent: table.attrs.parent }, node.content);
  const tr = st.tr.replaceWith(at, at + table.nodeSize, filled);
  tr.setSelection(state.TextSelection.create(tr.doc, at + 3));
  view.dispatch(asStep(tr).scrollIntoView());
  return true;
}

export async function importCsv(view, file, { upload, remove = null, table = null } = {}) {
  try {
    view.dom.parentElement.querySelector(".page-csv-error")?.remove();
    const parsed = parseCsv(await readText(file));
    const result = tableNode(parsed);
    if (!result) { error(view, "Couldn't read this CSV: no columns."); return false; }
    let attachment = null;
    if (result.truncated) {
      if (!(await confirmTruncation(result.truncated))) return false;
      const response = await upload?.(file);
      const src = safeFileHref(response?.uploads?.[0]?.url);
      if (!response?.ok || !src) { error(view, "Couldn't attach the original CSV."); return false; }
      attachment = schema.nodes.file.create({ id: newId(), src, name: file.name, size: file.size ?? null, mime: file.type || "text/csv" });
    }
    if (view.isDestroyed) return false;
    if (table) return placeImported(view, result.node, table, attachment);
    const held = remove ? heldSlashRange(view.state) : null;
    if (remove && !held) placeAfterBlock(view, remove.block);
    const inserted = insertTableNode(view.state, view.dispatch, result.node, held, attachment);
    return inserted;
  } catch (cause) {
    if (cause instanceof CsvError) error(view, `Couldn't read this CSV: unclosed quote on line ${cause.line}.`);
    else error(view, "Couldn't read this CSV.");
    return false;
  }
}

export function pickCsv(view, remove = null, table = null) {
  const input = inputs.get(view);
  if (!input) return false;
  if (remove) holdSlashRange(view, remove);
  input._remove = remove ? { ...remove, block: blockIdAt(view.state.doc, remove.from) } : null;
  input._table = table;
  input.click();
  return true;
}

const blockIdAt = (doc, pos) => doc.child(doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0)).attrs.id;

function placeAfterBlock(view, id) {
  const st = view.state;
  let at = null;
  st.doc.forEach((node, offset) => { if (at === null && node.attrs.id === id) at = offset; });
  if (at === null) return false;
  view.dispatch(st.tr.setSelection(state.TextSelection.near(st.doc.resolve(at))));
  return true;
}

const csvFiles = (files) => [...files].filter((file) => /\.csv$/i.test(file.name || "") || /^(text\/csv|application\/csv)$/i.test(file.type || ""));

export function csvImportPlugin({ upload }) {
  return new Plugin({
    view(view) {
      const input = view.dom.ownerDocument.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv";
      input.hidden = true;
      input.className = "page-csv-input";
      view.dom.parentElement.append(input);
      inputs.set(view, input);
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) importCsv(view, file, { upload, remove: input._remove, table: input._table });
        input._remove = null;
        input._table = null;
        input.value = "";
      });
      return { destroy() { inputs.delete(view); input.remove(); } };
    },
    props: {
      handlePaste(view, event) {
        const files = csvFiles(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        importCsv(view, files[0], { upload });
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        const files = csvFiles(event.dataTransfer?.files || []);
        if (moved || !files.length) return false;
        event.preventDefault();
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (hit) view.dispatch(view.state.tr.setSelection(state.TextSelection.near(view.state.doc.resolve(hit.pos))));
        importCsv(view, files[0], { upload });
        return true;
      },
    },
  });
}
