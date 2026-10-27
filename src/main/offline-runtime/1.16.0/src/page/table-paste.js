// Spreadsheet cells on the clipboard as a grid of cell values (a string, or
// { c, m } when a cell has marks or line breaks), and a new table from a grid.
// Google Sheets, Excel and Numbers put an HTML table and tab-separated text on
// the clipboard; the HTML keeps bold, italic and links, the text is the fallback.
import { schema } from "./schema.js";
import { keysBetween, newId, nodeFromBlock, cellValue } from "./model.js";
import { parseCsv } from "./rich/csv.js";
import { cellText } from "./rich/cell.js";
import { clipboardParser } from "./blocks.js";

function htmlGrid(html, doc) {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const Parser = doc.defaultView?.DOMParser ?? globalThis.DOMParser;
  if (!Parser) return null;
  const body = new Parser().parseFromString(html, "text/html").body;
  const tables = [...body.querySelectorAll("table")].filter((table) => !table.parentElement.closest("table"));
  if (tables.length !== 1) return null;
  const rest = body.cloneNode(true);
  for (const skip of rest.querySelectorAll("table, style, script, template, meta, title")) skip.remove();
  if (rest.textContent.trim()) return null;
  const table = tables[0];
  const rows = [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table);
  const grid = rows.map((tr) => [...tr.children].filter((cell) => cell.tagName === "TD" || cell.tagName === "TH").map((cell) => cellValue(clipboardParser.parse(cell, { topNode: schema.nodes.table_cell.create() }))));
  return { grid: grid.filter((row) => row.length), own: !!table.querySelector("td[data-col]") };
}

function textGrid(text) {
  if (!text || !text.includes("\t")) return null;
  const { header, rows } = parseCsv(text.replace(/\r?\n$/, ""), { delimiter: "\t" });
  return { grid: [header, ...rows], own: false };
}

export function gridFromClipboard(html, text, doc = globalThis.document) {
  let found = null;
  try { found = htmlGrid(html, doc); } catch { found = null; }
  if (!found) {
    try { found = textGrid(text); } catch { found = null; }
  }
  if (!found || !found.grid.length) return null;
  const width = Math.max(...found.grid.map((row) => row.length));
  for (const row of found.grid) while (row.length < width) row.push("");
  return { ...found, width, height: found.grid.length };
}

export function tableFromGrid(grid, { header = grid.length > 1 } = {}) {
  const width = Math.max(0, ...grid.map((row) => row.length));
  if (!width) return null;
  const names = header ? grid[0] : [];
  const body = header ? grid.slice(1) : grid;
  const ids = Array.from({ length: width }, () => newId("c"));
  const colPos = keysBetween(null, null, width);
  const cols = Object.fromEntries(ids.map((id, i) => [id, { pos: colPos[i], name: cellText(names[i] ?? "").replace(/\s+/g, " ").trim() || `Column ${i + 1}` }]));
  const lines = body.length ? body : [[]];
  const rowPos = keysBetween(null, null, lines.length);
  const rows = Object.fromEntries(lines.map((line, r) => [newId("r"), { pos: rowPos[r], cells: Object.fromEntries(ids.map((id, i) => [id, line[i] ?? ""])) }]));
  return nodeFromBlock(schema, newId(), { t: "table", pos: null, cols, rows });
}
