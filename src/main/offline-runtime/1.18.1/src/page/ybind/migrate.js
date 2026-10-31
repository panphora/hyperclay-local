import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { nodeFromBlock } from "../model.js";
import { flatten, markKey, marksOf } from "../inline.js";
import { ATOM, BREAK, DEFAULTS, blocksOfValues, orderedIds, unitsOf, runsOf, canon, hash64, parseModel } from "../projection.js";
import { blockFromItem } from "../adopt.js";
import { createPageDoc, attrKeys, defaultOf, SEED } from "./layout.js";
import { marksFields } from "./marks.js";
import { blocksFromYValue } from "./decode.js";
import { PART, enc } from "./provider.js";
import { boardKey } from "./board.js";

export class YMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = "YMigrationError";
    this.code = "invalid-source";
  }
}

const fail = (message) => { throw new YMigrationError(message); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => JSON.parse(canon(value));

function sourceBlocks(values) {
  if (!Array.isArray(values) || !values.length) fail("Expected at least one hybrid page value");
  for (const value of values) {
    if (!record(value) || !record(value.blocks) || Object.keys(value).some((key) => key !== "blocks" && key !== "deleted")) fail("Expected a hybrid page value with blocks and optional deleted ids");
    if (value.deleted != null && !record(value.deleted)) fail("Invalid hybrid page tombstones");
    for (const [id, block] of Object.entries(value.blocks)) {
      if (!value.deleted?.[id] && (!id || id === "__proto__" || !record(block))) fail(`Invalid hybrid page block: ${id}`);
      if (!value.deleted?.[id] && (/^~|~\d+$/).test(id)) fail(`Reserved hybrid page block id: ${id}`);
    }
  }
  return blocksOfValues(values);
}

// A mark key as the record keeps it: the codec validates every descriptor, and the
// known codes and the opaque ones come back in the order the binding writes them.
const canonicalKey = (key, id) => {
  let marks;
  try { marks = marksOf(schema, key); } catch { return fail(`Invalid mark key on block: ${id}`); }
  return markKey([...marks].sort((a, b) => a.type.rank - b.type.rank));
};

const markUnits = (block, id) => {
  const units = unitsOf(block.m, block.c.length);
  if (!units) fail(`Invalid mark runs on block: ${id}`);
  for (let i = 0; i < units.length; i++) {
    const key = units[i];
    if (typeof key !== "string") fail(`Invalid mark key on block: ${id}`);
    if (key.startsWith("@") && (key !== BREAK || block.c[i] !== ATOM)) fail(`Unsupported inline atom on block: ${id}`);
    if (block.t === "code_block" && key) fail(`Unsupported formatting in code block: ${id}`);
    if (!key.startsWith("@")) units[i] = canonicalKey(key, id);
  }
  return units;
};

// A block type this runtime has no schema for keeps the record it stands for: its
// own type, its text and marks and every other field a newer peer wrote on it.
function opaqueRecord(id, block, pos) {
  const out = { t: block.t, pos };
  for (const key of Object.keys(block)) {
    if (key === "t" || key === "pos" || key === "c" || key === "m") continue;
    out[key] = copy(block[key]);
  }
  if (block.c != null && typeof block.c !== "string") fail(`Invalid text on block: ${id}`);
  out.c = block.c ?? "";
  if (typeof block.c === "string" && block.m != null) {
    const units = markUnits(block, id);
    if (units.some(Boolean)) out.m = runsOf(units);
  } else if (block.m != null) fail(`Mark runs require flat text on block: ${id}`);
  return out;
}

function normalizeBlock(id, block, index) {
  const known = Object.hasOwn(DEFAULTS, block.t);
  if (!known && (typeof block.t !== "string" || !block.t || block.t === "opaque_block")) fail(`Unsupported hybrid block type: ${block.t}`);
  const pos = String(index + 1).padStart(8, "0");
  if (!known) return opaqueRecord(id, block, pos);
  const type = schema.nodes[block.t];
  const fields = attrKeys(type);
  const allowed = new Set(["t", "pos", "c", "m", ...fields, ...(block.t === "table" ? ["rows"] : [])]);
  const out = { t: block.t, pos };
  for (const key of Object.keys(block)) if (!allowed.has(key)) out[key] = copy(block[key]);
  for (const key of fields) {
    const value = block[key] === undefined ? defaultOf(type, key) : block[key];
    if (canon(value) !== canon(defaultOf(type, key))) out[key] = copy(value);
  }
  if (block.t === "table") {
    if (block.rows !== undefined && !record(block.rows)) fail(`Invalid table rows: ${id}`);
    out.rows = copy(block.rows ?? {});
  }
  if (!type.isTextblock) {
    if (block.c != null && block.c !== "" && !(Array.isArray(block.c) && !block.c.length)) fail(`Unexpected text on block: ${id}`);
    if (block.m != null && !(Array.isArray(block.m) && !block.m.length)) fail(`Unexpected marks on block: ${id}`);
    return out;
  }
  if (block.c != null && typeof block.c !== "string" && !Array.isArray(block.c)) fail(`Invalid text on block: ${id}`);
  if (typeof block.c === "string" && block.m != null) {
    markUnits(block, id);
  } else if (block.m != null) fail(`Mark runs require flat text on block: ${id}`);
  const node = nodeFromBlock(schema, id, block);
  node.check();
  const { c, m } = flatten(node.content);
  out.c = c;
  if (m.some(Boolean)) out.m = runsOf(m);
  return out;
}

export function buildPageValue(values, clientID) {
  let doc;
  try {
    const source = sourceBlocks(values);
    const ids = orderedIds(source);
    const blocks = Object.fromEntries(ids.map((id, index) => [id, normalizeBlock(id, source[id], index)]));
    doc = new Y.Doc();
    doc.clientID = clientID;
    const pd = createPageDoc(doc);
    let op = 0;
    doc.transact(() => {
      for (const id of ids) {
        const block = blocks[id];
        const { pos, c, m, ...fields } = block;
        if (block.t === "board") { delete fields.columns; delete fields.cards; }
        pd.attrs.set(id, new Y.Map(Object.entries(copy(fields))));
        if (block.t === "board") {
          for (const [columnId, column] of Object.entries(block.columns ?? {})) {
            pd.boardFields.set(boardKey(id, "column", columnId, "alive"), true);
            for (const field of ["name", "pos"]) pd.boardFields.set(boardKey(id, "column", columnId, field), column[field] ?? "");
          }
          for (const [cardId, card] of Object.entries(block.cards ?? {})) {
            pd.boardFields.set(boardKey(id, "card", cardId, "alive"), true);
            for (const field of ["title", "owner", "due"]) if (card[field] !== undefined) pd.boardFields.set(boardKey(id, "card", cardId, field), card[field]);
            pd.boardFields.set(boardKey(id, "card", cardId, "placement"), { columnId: card.col ?? "", pos: card.pos ?? "" });
          }
        }
        pd.flow.insertEmbed(pd.flow.length, { b: id }, {});
        if (!c) continue;
        let offset = 0;
        for (const [length, key] of runsOf(unitsOf(m, c.length) ?? Array(c.length).fill(""))) {
          if (key === BREAK) {
            for (let i = 0; i < length; i++) pd.flow.insertEmbed(pd.flow.length, { br: 1 }, {});
          } else {
            const attrs = Object.fromEntries(Object.entries(marksFields(marksOf(schema, key))).map(([name, value]) => [`${name}~${clientID}-m${(op++).toString(36)}`, value && typeof value === "object" ? copy(value) : value]));
            pd.flow.insert(pd.flow.length, c.slice(offset, offset + length), attrs);
          }
          offset += length;
        }
      }
    }, SEED);
    const text = enc(Y.encodeStateAsUpdateV2(doc));
    const count = Math.ceil(text.length / PART);
    const y = count <= 1 ? { seed: text } : Object.fromEntries(Array.from({ length: count }, (_, i) => [`seed.${i}.${count}`, text.slice(i * PART, (i + 1) * PART)]));
    const value = { v: 1, g: 0, y };
    if (canon(blocksFromYValue(value)) !== canon(blocks)) fail("Hybrid page data cannot be represented without loss");
    return value;
  } catch (error) {
    if (error instanceof YMigrationError) throw error;
    throw new YMigrationError(`Cannot migrate hybrid page: ${error.message}`);
  } finally {
    doc?.destroy();
  }
}

export function migrateHybridValues(values) {
  return buildPageValue(values, 1);
}

// A page's merge state rebuilt from its article alone. The client id comes from the content,
// so every rebuild of the same article is byte-identical (two tabs converge) and rebuilds of
// different articles never share Yjs item ids.
export function seedClientId(blocks) {
  const id = parseInt(hash64(`page-seed:v1:${canon(blocks)}`).slice(0, 8), 16) >>> 0;
  return id < 2 ? id + 2 : id;
}

export function seedPageFromArticle(article) {
  const items = parseModel(article, { seed: article.getAttribute("data-rev") ?? "" });
  const blocks = {};
  items.forEach((item, i) => {
    const block = blockFromItem(item, null);
    block.pos = String(i + 1).padStart(8, "0");
    blocks[item.id] = block;
  });
  return buildPageValue([{ blocks }], seedClientId(blocks));
}
