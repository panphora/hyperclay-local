import { keysBetween } from "../model.js";

export class CsvError extends Error {
  constructor(code, line) {
    super(`CSV ${code} at line ${line}`);
    this.name = "CsvError";
    this.code = code;
    this.line = line;
  }
}

function detectedDelimiter(text) {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (ch === "\r" || ch === "\n")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text, { delimiter } = {}) {
  text = String(text).replace(/^\uFEFF/, "");
  delimiter ??= detectedDelimiter(text);
  if (typeof delimiter !== "string" || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new TypeError("CSV delimiter must be one non-newline character");
  const records = [];
  let row = [], field = "", quoted = false, line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (ch === "\r" || ch === "\n") {
        field += ch;
        if (ch === "\r" && text[i + 1] === "\n") field += text[++i];
        line++;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
      startLine = line;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
    } else field += ch;
  }
  if (quoted) throw new CsvError("unterminated-quote", startLine);
  if (row.length || field !== "" || (text && !/[\r\n]$/.test(text))) records.push([...row, field]);
  if (!records.length) return { header: [], rows: [] };
  const [header, ...rows] = records;
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  header.length = width;
  for (let i = 0; i < width; i++) header[i] ??= "";
  for (const r of rows) for (let i = r.length; i < width; i++) r.push("");
  return { header, rows };
}

export function parseDecimal(value) {
  if (typeof value !== "string" || !/^[+-]?(?:0|[1-9]\d*)(?:[.,]\d+)?$/.test(value)) return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function inferKinds(header, rows) {
  return header.map((_, col) => {
    const values = rows.map((row) => row[col] ?? "").filter((value) => value.trim() !== "");
    if (!values.length) return "text";
    const separators = new Set(values.map((value) => value.includes(",") ? "," : value.includes(".") ? "." : null).filter(Boolean));
    if (separators.size <= 1 && values.every((value) => parseDecimal(value) !== null)) return "number";
    if (values.every((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    })) return "date";
    return "text";
  });
}

export function tableFromCsv({ header, rows: inputRows }, { maxBytes = Infinity, newId } = {}) {
  if (typeof newId !== "function") throw new TypeError("tableFromCsv needs newId");
  const kinds = inferKinds(header, inputRows);
  const cols = {};
  const ids = header.map(() => newId());
  const colPositions = keysBetween(null, null, header.length);
  header.forEach((name, i) => { cols[ids[i]] = { pos: colPositions[i], name, kind: kinds[i] }; });
  const rows = {};
  const positions = keysBetween(null, null, inputRows.length);
  const encoder = new TextEncoder();
  let size = encoder.encode(JSON.stringify({ cols, rows })).length;
  let kept = 0;
  for (let i = 0; i < inputRows.length; i++) {
    const id = newId();
    const row = { pos: positions[i], cells: Object.fromEntries(ids.map((col, j) => [col, inputRows[i][j] ?? ""])) };
    const increment = encoder.encode(`${kept ? "," : ""}${JSON.stringify(id)}:${JSON.stringify(row)}`).length;
    if (size + increment > maxBytes) break;
    rows[id] = row;
    size += increment;
    kept++;
  }
  return { cols, rows, truncated: kept === inputRows.length ? null : { kept, total: inputRows.length } };
}
