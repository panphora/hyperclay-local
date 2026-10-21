import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { nodeFromBlock, newId, keyBetween } from "./model.js";
import { parseCsv, tableFromCsv, CsvError } from "./rich/csv.js";
import { TABLE_IMPORT_LIMIT, insertTableNode } from "./table.js";
import { safeFileHref } from "./address.js";

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

export async function importCsv(view, file, { upload, remove = null } = {}) {
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
    const inserted = insertTableNode(view.state, view.dispatch, result.node, remove, attachment);
    return inserted;
  } catch (cause) {
    if (cause instanceof CsvError) error(view, `Couldn't read this CSV: unclosed quote on line ${cause.line}.`);
    else error(view, "Couldn't read this CSV.");
    return false;
  }
}

export function pickCsv(view, remove = null) {
  const input = inputs.get(view);
  if (!input) return false;
  input._remove = remove;
  input.click();
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
        if (file) importCsv(view, file, { upload, remove: input._remove });
        input._remove = null;
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
