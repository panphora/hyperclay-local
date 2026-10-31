import * as Y from "../../vendor/yjs.vendor.js";
import { transform } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { nodeFromBlock } from "../model.js";
import { ATOM, BREAK, canon, normalizeText, renderBlocks, runsOf, unitsOf } from "../projection.js";
import { writeBoard } from "./board.js";
import { validCell, writeTable } from "./table.js";
import { blocksFromYValue } from "./decode.js";
import { docOf } from "./doc.js";
import { createPageDoc, attrKeys, defaultOf, mintOp } from "./layout.js";
import { createProjectionMap } from "./projection-map.js";
import { docFromValue, enc, PART, YDecodeError } from "./provider.js";
import { tokensOf, tokenIndex } from "./tokens.js";
import { walk } from "./walk.js";
import { applyRegion } from "./writer.js";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (message) => { throw new YDecodeError("invalid-content", message); };
const same = (a, b) => canon(a) === canon(b);
const copy = (value) => JSON.parse(JSON.stringify(value));
const idOk = (id) => typeof id === "string" && id.length > 0 && !["__proto__", "constructor", "prototype"].includes(id);

function jsonValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) && !record(value) || seen.has(value)) return false;
  seen.add(value);
  const valid = (Array.isArray(value) ? value : Object.values(value)).every((item) => jsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function tableEntities(kind, value) {
  if (!record(value)) return false;
  return Object.entries(value).every(([id, item]) => {
    if (!idOk(id) || !record(item) || typeof item.pos !== "string") return false;
    if (kind === "cols") return typeof item.name === "string" && (item.kind === undefined || typeof item.kind === "string") && (item.width === undefined || (typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0)) && Object.keys(item).every((key) => ["pos", "name", "kind", "width"].includes(key));
    return record(item.cells) && Object.entries(item.cells).every(([col, cell]) => idOk(col) && validCell(cell)) && Object.keys(item).every((key) => ["pos", "cells"].includes(key));
  });
}

function validAttr(type, key, value) {
  if (key === "columns" || key === "cards") return type === "board" && record(value);
  if (key === "cols" || key === "rows") return tableEntities(key, value);
  if (key === "state") return record(value);
  if (key === "sort" || key === "artifact") return value === null || record(value);
  if (key === "series") return Array.isArray(value) && value.every((id) => typeof id === "string");
  if (key === "width" || key === "size") return value === null || typeof value === "number" && value >= 0;
  if (key === "level") return Number.isInteger(value) && value >= 1 && value <= 6;
  if (key === "indent") return Number.isInteger(value) && value >= 0;
  if (["parent", "owner", "due", "align", "mime", "source", "x", "highlight", "rev"].includes(key)) return value === null || typeof value === "string";
  if (key === "checked" || key === "open") return typeof value === "boolean";
  return typeof value === "string";
}

function boardEntities(kind, value) {
  if (!record(value)) fail(`Expected board ${kind} as an object`);
  for (const [id, item] of Object.entries(value)) {
    if (!idOk(id) || !record(item)) fail(`Invalid board ${kind}: ${id}`);
    const required = kind === "columns" ? ["pos", "name"] : ["pos", "col", "title"];
    const allowed = kind === "columns" ? required : [...required, "owner", "due"];
    if (Object.keys(item).some((key) => !allowed.includes(key)) || required.some((key) => typeof item[key] !== "string") ||
      ["owner", "due"].some((key) => key in item && item[key] !== null && typeof item[key] !== "string")) fail(`Invalid board ${kind}: ${id}`);
  }
}

function validateContent(change, block) {
  if (!Object.hasOwn(change, "content")) return;
  const content = change.content;
  if (!schema.nodes[block.t].isTextblock || !record(content) || typeof content.c !== "string" || Object.keys(content).some((key) => key !== "c" && key !== "m")) fail(`Invalid content for block: ${change.id}`);
  if (content.m !== undefined) {
    const units = unitsOf(content.m, content.c.length);
    if (!units || units.some((key, index) => typeof key !== "string" || (key.startsWith("@") && (key !== BREAK || content.c[index] !== ATOM)) || (block.t === "code_block" && key))) fail(`Invalid marks for block: ${change.id}`);
  }
}

function validateChanges(changes, blocks) {
  if (!Array.isArray(changes)) fail("Expected an array of block changes");
  const seen = new Set();
  return changes.map((change) => {
    if (!record(change) || !idOk(change.id) || seen.has(change.id) || !Object.hasOwn(blocks, change.id) || Object.keys(change).some((key) => !["id", "content", "attrs"].includes(key)) || (!Object.hasOwn(change, "content") && !Object.hasOwn(change, "attrs")) || !jsonValue(change)) fail("Invalid block change");
    seen.add(change.id);
    const current = blocks[change.id];
    const type = schema.nodes[current.t];
    if (Object.hasOwn(change, "attrs") && (!record(change.attrs) || Object.entries(change.attrs).some(([key, value]) => !attrKeys(type).includes(key) || !validAttr(current.t, key, value)))) fail(`Invalid attributes for block: ${change.id}`);
    validateContent(change, current);
    if (current.t === "board") {
      if (Object.hasOwn(change.attrs ?? {}, "columns")) boardEntities("columns", change.attrs.columns);
      if (Object.hasOwn(change.attrs ?? {}, "cards")) boardEntities("cards", change.attrs.cards);
    }
    const next = { ...current, ...copy(change.attrs ?? {}) };
    if (change.content) { next.c = change.content.c; delete next.m; if (change.content.m !== undefined) next.m = copy(change.content.m); }
    try { nodeFromBlock(schema, change.id, next).check(); } catch (error) { fail(`Invalid block ${change.id}: ${error.message}`); }
    return { id: change.id, current, next, content: Object.hasOwn(change, "content"), attrs: change.attrs ?? {} };
  });
}

async function revisionOf(doc) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", Y.encodeStateAsUpdateV2(doc));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const projection = Object.freeze({ ATOM, BREAK, canon, normalizeText, renderBlocks, runsOf });

export async function readYValue(value) {
  const doc = docFromValue(value, { strict: true });
  try {
    const blocks = blocksFromYValue(value);
    return { blocks, revision: await revisionOf(doc) };
  } finally { doc.destroy(); }
}

export async function writeYValue(value, { expectedRevision, changes } = {}) {
  if (typeof expectedRevision !== "string" || !expectedRevision) throw new YDecodeError("missing-revision", "A page revision is required");
  let source, request;
  try { source = structuredClone(value); request = structuredClone(changes); }
  catch { throw new YDecodeError("invalid-value", "The page write must contain cloneable data"); }
  const { blocks, revision } = await readYValue(source);
  if (expectedRevision !== revision) throw new YDecodeError("stale-revision", "The page revision has changed");
  const edits = validateChanges(request, blocks);
  const doc = docFromValue(source, { strict: true });
  const pending = [];
  const onUpdate = (bytes) => pending.push(bytes);
  doc.on("updateV2", onUpdate);
  try {
    const pd = createPageDoc(doc);
    const w = walk(pd);
    const before = docOf(pd, w);
    const locations = new Map();
    before.forEach((node, offset) => locations.set(node.attrs.id, { node, offset }));
    const tr = new transform.Transform(before);
    const contentEdits = edits.filter((edit) => edit.content && (!same(edit.current.c, edit.next.c) || !same(edit.current.m, edit.next.m)))
      .sort((a, b) => (locations.get(b.id)?.offset ?? -1) - (locations.get(a.id)?.offset ?? -1));
    for (const edit of contentEdits) {
      const found = locations.get(edit.id);
      if (!found) fail(`Block is not directly editable: ${edit.id}`);
      const nextNode = nodeFromBlock(schema, edit.id, edit.next);
      tr.replaceWith(found.offset + 1, found.offset + found.node.nodeSize - 1, nextNode.content);
    }
    const after = new Map();
    tr.doc.forEach((node, offset) => after.set(node.attrs.id, { node, offset }));
    const oldTokens = tokensOf(before, new Map(), w.visible);
    const newTokens = tokensOf(tr.doc, new Map(), w.visible);
    const oldIndex = tokenIndex(before, new Map(), w.visible);
    const newIndex = tokenIndex(tr.doc, new Map(), w.visible);
    const sv = [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()].sort((a, b) => a[0] - b[0]);
    const ctx = { pd, map: createProjectionMap(w, pd.flow.length), bt: oldTokens, tx: (fn) => fn(), copies: w.copies, fences: w.fences, sv, operationId: mintOp(pd), recovered: new Map(w.visible.filter((seg) => seg.recovered).map((seg) => [seg.id, seg.sourceKey])) };
    doc.transact(() => {
      for (const edit of contentEdits) {
        const old = locations.get(edit.id), next = after.get(edit.id);
        const start = oldIndex[old.offset + 1], end = oldIndex[old.offset + old.node.nodeSize - 1];
        const nextStart = newIndex[next.offset + 1], nextEnd = newIndex[next.offset + next.node.nodeSize - 1];
        applyRegion(ctx, start, oldTokens.slice(start, end), newTokens.slice(nextStart, nextEnd));
      }
      for (const edit of edits) {
        const { id, current, next, attrs } = edit;
        if (current.t === "board" && (Object.hasOwn(attrs, "columns") || Object.hasOwn(attrs, "cards"))) writeBoard(pd, id, current, next);
        const table = current.t === "table" && !ctx.recovered.has(id) && pd.attrs.get(id)?.get("t") === "table";
        if (table && (Object.hasOwn(attrs, "cols") || Object.hasOwn(attrs, "rows"))) writeTable(pd, id, current, next);
        const map = pd.attrs.get(id);
        for (const key of Object.keys(attrs)) {
          if (current.t === "board" && (key === "columns" || key === "cards")) continue;
          if (table && (key === "cols" || key === "rows")) continue;
          const old = map?.has(key) ? map.get(key) : defaultOf(schema.nodes[current.t], key);
          if (!same(old, next[key])) {
            if (map) map.set(key, copy(next[key]));
            else { const created = new Y.Map(); created.set("t", current.t); created.set(key, copy(next[key])); pd.attrs.set(id, created); }
          }
        }
      }
    });
    const updates = {};
    let index = 0;
    for (const bytes of pending) {
      const encoded = enc(bytes);
      let key;
      do { key = `e${doc.clientID.toString(36)}-${(index++).toString(36)}`; } while (Object.keys(source.y).some((existing) => existing === key || existing.startsWith(`${key}.`)));
      if (encoded.length <= PART) updates[key] = encoded;
      else {
        const count = Math.ceil(encoded.length / PART);
        for (let part = 0; part < count; part++) updates[`${key}.${part}.${count}`] = encoded.slice(part * PART, (part + 1) * PART);
      }
    }
    const output = { ...source, y: { ...source.y, ...updates } };
    const result = await readYValue(output);
    return { value: output, updates, ...result };
  } finally { doc.off("updateV2", onUpdate); doc.destroy(); }
}

export { seedPageFromArticle } from "./migrate.js";
