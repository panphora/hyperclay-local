import { schema } from "../schema.js";
import { marksOf } from "../inline.js";
import { ATOM, BREAK, canon, unitsOf } from "../projection.js";
import { cellText } from "../rich/cell.js";
import { YDecodeError } from "./provider.js";

export const TABLE_FIELDS = Object.freeze({ row: Object.freeze(["alive", "pos"]), col: Object.freeze(["alive", "name", "kind", "width", "pos"]) });
const COL_FIELDS = ["name", "kind", "width", "pos"];
const OPTIONAL = new Set(["kind", "width"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id) => typeof id === "string" && id.length > 0 && !["__proto__", "constructor", "prototype"].includes(id);
const fail = (key) => { throw new YDecodeError("unsupported-content", `Unsupported table field: ${key}`); };
const copy = (value) => (value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value)));

export const tableKey = (tableId, kind, entityId, field) => JSON.stringify([tableId, kind, entityId, field]);

export function validCell(value) {
  if (typeof value === "string") return true;
  if (!record(value) || Object.keys(value).sort().join(",") !== "c,m" || typeof value.c !== "string") return false;
  if (!Array.isArray(value.m) || !value.m.every(Array.isArray)) return false;
  const units = unitsOf(value.m, value.c.length);
  if (!units) return false;
  return units.every((key, i) => {
    if (typeof key !== "string") return false;
    if (key.startsWith("@")) return key === BREAK && value.c[i] === ATOM;
    try { marksOf(schema, key); return true; } catch { return false; }
  });
}

const validValue = (field, value) => {
  if (field === "alive") return typeof value === "boolean";
  if (field === "width") return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);
  if (field === "kind") return value === null || typeof value === "string";
  return typeof value === "string";
};

// Peers can each delete a different last column or row; a table must keep one,
// so the first removed one by position stays until someone edits the table.
function keepOne(live, dead) {
  if (Object.keys(live).length) return;
  const [first] = Object.keys(dead).sort((x, y) => {
    const px = dead[x].pos ?? "", py = dead[y].pos ?? "";
    return px !== py ? (px < py ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
  });
  if (first) live[first] = dead[first];
}

export function resolveTableFields(fields, blockId = null, seed = null) {
  const rows = new Map(), cols = new Map(), cells = new Map();
  for (const [key, value] of fields) {
    let tuple;
    try { tuple = JSON.parse(key); } catch { fail(key); }
    if (!Array.isArray(tuple) || tuple.length !== 4) fail(key);
    const [owner, kind, entityId, field] = tuple;
    if (!validId(owner) || !validId(entityId)) fail(key);
    if (kind === "cell") {
      if (!validId(field) || !validCell(value)) fail(key);
    } else if (!Object.hasOwn(TABLE_FIELDS, kind) || !TABLE_FIELDS[kind].includes(field) || !validValue(field, value)) fail(key);
    if (owner !== blockId) continue;
    if (kind === "cell") {
      const row = cells.get(entityId) ?? new Map();
      row.set(field, value);
      cells.set(entityId, row);
      continue;
    }
    const bucket = kind === "row" ? rows : cols;
    const entity = bucket.get(entityId) ?? {};
    entity[field] = value;
    bucket.set(entityId, entity);
  }
  const outCols = { ...(record(seed?.cols) ? seed.cols : {}) };
  const outRows = { ...(record(seed?.rows) ? seed.rows : {}) };
  const deadCols = {}, deadRows = {};
  for (const [id, over] of cols) {
    const col = record(outCols[id]) ? { ...outCols[id] } : {};
    if (!Object.hasOwn(col, "pos")) col.pos = "";
    if (!Object.hasOwn(col, "name")) col.name = "";
    for (const field of COL_FIELDS) {
      if (!Object.hasOwn(over, field)) continue;
      if (over[field] === null) delete col[field];
      else col[field] = over[field];
    }
    if (over.alive === false || (!Object.hasOwn(outCols, id) && over.alive !== true)) {
      if (over.alive === false) deadCols[id] = col;
      delete outCols[id];
      continue;
    }
    outCols[id] = col;
  }
  for (const id of new Set([...rows.keys(), ...cells.keys()])) {
    const over = rows.get(id) ?? {};
    const row = { pos: "", cells: {}, ...(record(outRows[id]) ? outRows[id] : {}) };
    if (Object.hasOwn(over, "pos")) row.pos = over.pos;
    const own = cells.get(id);
    if (own) row.cells = { ...(record(row.cells) ? row.cells : {}), ...Object.fromEntries([...own].map(([colId, value]) => [colId, copy(value)])) };
    if (over.alive === false || (!Object.hasOwn(outRows, id) && over.alive !== true)) {
      if (over.alive === false) deadRows[id] = row;
      delete outRows[id];
      continue;
    }
    outRows[id] = row;
  }
  keepOne(outCols, deadCols);
  keepOne(outRows, deadRows);
  return { cols: outCols, rows: outRows };
}

export function plainTable(table) {
  const rows = {};
  for (const [id, row] of Object.entries(table?.rows ?? {})) {
    rows[id] = { ...row, cells: Object.fromEntries(Object.entries(record(row?.cells) ? row.cells : {}).map(([colId, value]) => [colId, cellText(value)])) };
  }
  return { cols: table?.cols ?? {}, rows };
}

const fieldOf = (entity, field) => entity?.[field] ?? (OPTIONAL.has(field) ? null : "");

export function tableChanges(tableId, fields, seed, before, after) {
  const out = [];
  const stored = (key, fallback) => (fields.has(key) ? fields.get(key) : fallback);
  const push = (key, value) => out.push([key, copy(value)]);
  const beforeCols = before?.cols ?? {}, afterCols = after?.cols ?? {};
  const beforeRows = before?.rows ?? {}, afterRows = after?.rows ?? {};
  for (const id of new Set([...Object.keys(beforeCols), ...Object.keys(afterCols)])) {
    const old = beforeCols[id], next = afterCols[id];
    if (!next) {
      if (old) push(tableKey(tableId, "col", id, "alive"), false);
      continue;
    }
    if (!old || stored(tableKey(tableId, "col", id, "alive"), true) === false) push(tableKey(tableId, "col", id, "alive"), true);
    for (const field of COL_FIELDS) {
      const key = tableKey(tableId, "col", id, field);
      const prior = old ? fieldOf(old, field) : stored(key, fieldOf(seed?.cols?.[id], field));
      if (canon(prior) !== canon(fieldOf(next, field))) push(key, fieldOf(next, field));
    }
  }
  for (const id of new Set([...Object.keys(beforeRows), ...Object.keys(afterRows)])) {
    const old = beforeRows[id], next = afterRows[id];
    if (!next) {
      if (old) push(tableKey(tableId, "row", id, "alive"), false);
      continue;
    }
    if (!old || stored(tableKey(tableId, "row", id, "alive"), true) === false) push(tableKey(tableId, "row", id, "alive"), true);
    const posKey = tableKey(tableId, "row", id, "pos");
    const pos = next.pos ?? "";
    if (stored(posKey, seed?.rows?.[id]?.pos ?? "") !== pos) push(posKey, pos);
    const cells = record(next.cells) ? next.cells : {};
    for (const colId of Object.keys(afterCols)) {
      const key = tableKey(tableId, "cell", id, colId);
      const value = cells[colId] ?? "";
      const prior = old && beforeCols[colId] ? old.cells?.[colId] ?? "" : stored(key, seed?.rows?.[id]?.cells?.[colId] ?? "");
      if (canon(prior) !== canon(value)) push(key, value);
    }
  }
  return out;
}

export function tableSeed(pd, id) {
  const map = pd.attrs.get(id);
  return { cols: map?.get("cols") ?? {}, rows: map?.get("rows") ?? {} };
}

export function writeTable(pd, id, before, after) {
  const seed = tableSeed(pd, id);
  for (const [key, value] of tableChanges(id, pd.tableFields, seed, before, after)) pd.tableFields.set(key, value);
}
