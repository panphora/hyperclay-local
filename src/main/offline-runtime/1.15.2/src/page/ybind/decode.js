import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { markKey } from "../inline.js";
import { ATOM, BREAK, DEFAULTS, blocksOfValues, runsOf } from "../projection.js";
import { createPageDoc, attrKeys, defaultOf, sameJson, PAGE_ROOTS } from "./layout.js";
import { resolveBoardFields } from "./board.js";
import { resolveTableFields } from "./table.js";
import { markName } from "./marks.js";
import { walk } from "./walk.js";
import { docFromValue, YDecodeError } from "./provider.js";
import { parseGoneIntents, parsePhysicalKey, RecoveryError } from "./recovery.js";

const copy = (value) => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
const unsupported = (message) => { throw new YDecodeError("unsupported-content", message); };
const hasContent = (root) => {
  if (root._map) for (const item of root._map.values()) if (!item.deleted) return true;
  for (let item = root._start; item; item = item.right) if (!item.deleted) return true;
  return false;
};
const invalidOrigin = (message) => { throw new YDecodeError("invalid-content", message); };
const ORIGIN_FIELDS = { span: ["length", "sourceClient", "sourceClock"], alias: ["sourceClient", "sourceClock"], boundary: ["blockId", "kind", "recoveryOf"] };
const BOUNDARY_KINDS = ["copy", "removed", "restore"];
const isClock = (value) => Number.isSafeInteger(value) && value >= 0;
const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const originId = (client, clock) => `${client}.${clock}`;
const boundaryIdentity = (record) => JSON.stringify([record.blockId, record.kind, record.recoveryOf ?? null]);

function validateFlow(pd) {
  if (pd.flow._map.size) unsupported("The page flow must contain text and block markers");
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.deleted) continue;
    const c = it.content;
    if (c instanceof Y.ContentString) continue;
    if (c instanceof Y.ContentFormat) {
      if (c.value !== null && !Object.hasOwn(schema.marks, markName(c.key))) unsupported(`Unsupported page mark: ${c.key}`);
      continue;
    }
    if (c instanceof Y.ContentEmbed) {
      const e = c.embed;
      if (e && Object.keys(e).length === 1 && ((typeof e.b === "string" && e.b) || e.br === 1)) continue;
    }
    unsupported("Unsupported content in the page flow");
  }
  for (const [id, attrs] of pd.attrs) {
    if (!(attrs instanceof Y.Map)) unsupported(`Unsupported attributes for page block: ${id}`);
  }
}

const inFlow = (pd, key) => {
  const id = typeof key === "string" ? parsePhysicalKey(key) : key;
  if (!id) return false;
  let item;
  try { item = Y.getItem(pd.ydoc.store, id); } catch { return false; }
  return item instanceof Y.Item && item.parent === pd.flow && item.id.clock <= id.clock && id.clock < item.id.clock + item.length;
};
const coverSource = (cover) => cover.charCodeAt(0) === 91 ? JSON.parse(cover)[1] : cover;
function validateRecovery(pd) {
  let intents;
  try {
    intents = parseGoneIntents(pd.gone, { strict: true });
  } catch (error) {
    if (error instanceof RecoveryError) throw new YDecodeError("invalid-content", error.message);
    throw error;
  }
  for (const record of intents.textDeletes) {
    const item = Y.getItem(pd.ydoc.store, { client: record.client, clock: record.clock });
    if (!(item instanceof Y.Item) || item.parent !== pd.flow || item.id.clock > record.clock || record.clock + record.length > item.id.clock + item.length) {
      throw new YDecodeError("invalid-content", `Invalid text-delete record: ${record.key}`);
    }
  }
  const invalid = (message) => { throw new YDecodeError("invalid-content", message); };
  for (const removal of intents.removals) {
    if (!inFlow(pd, removal.source)) invalid(`Invalid removal source: ${removal.key}`);
    if (removal.end !== null && !inFlow(pd, removal.end)) invalid(`Invalid removal end: ${removal.key}`);
  }
  for (const restore of intents.restores) {
    if (!inFlow(pd, restore.sourceKey)) invalid(`Invalid restore source: ${restore.key}`);
    for (const cover of restore.covers) if (!inFlow(pd, coverSource(cover))) invalid(`Invalid restore cover: ${restore.key}`);
  }
  for (const key of intents.copyActive) if (!inFlow(pd, key)) invalid(`Invalid copy-active record: ${key}`);
  for (const key of intents.attrs.keys()) if (!inFlow(pd, key)) invalid(`Invalid attribute override: ${key}`);
}

function validateOrigins(pd) {
  const aliases = new Map();
  const boundaries = new Map();
  const fieldsOf = (value, allowed, key) => {
    if (!isPlain(value)) invalidOrigin(`Invalid origin record: ${key}`);
    for (const field of Object.keys(value)) if (!allowed.includes(field)) invalidOrigin(`Unsupported origin field ${field} in ${key}`);
  };
  for (const [key, value] of pd.origins) {
    if (typeof key !== "string" || key.charCodeAt(0) !== 91) invalidOrigin(`Malformed origin key: ${key}`);
    let parts = null;
    try { parts = JSON.parse(key); } catch { invalidOrigin(`Malformed origin key: ${key}`); }
    if (!Array.isArray(parts) || typeof parts[0] !== "string") invalidOrigin(`Malformed origin key: ${key}`);
    const kind = parts[0];
    if (kind === "author") {
      if (parts.length !== 2 || !isClock(parts[1])) invalidOrigin(`Malformed origin key: ${key}`);
      if (typeof value !== "string" || !value) invalidOrigin(`Invalid author record: ${key}`);
      continue;
    }
    if (!Object.hasOwn(ORIGIN_FIELDS, kind)) unsupported(`Unsupported origin record: ${key}`);
    if (parts.length !== 3 || !isClock(parts[1]) || !isClock(parts[2])) invalidOrigin(`Malformed origin key: ${key}`);
    fieldsOf(value, ORIGIN_FIELDS[kind], key);
    if (kind === "span") {
      if (!Number.isSafeInteger(value.length) || value.length < 1 || !isClock(value.sourceClient) || !isClock(value.sourceClock) || !isClock(value.sourceClock + value.length - 1)) invalidOrigin(`Invalid span record: ${key}`);
      continue;
    }
    if (kind === "alias") {
      if (!isClock(value.sourceClient) || !isClock(value.sourceClock)) invalidOrigin(`Invalid alias record: ${key}`);
      aliases.set(originId(parts[1], parts[2]), { client: value.sourceClient, clock: value.sourceClock });
      continue;
    }
    if (typeof value.blockId !== "string" || !value.blockId || !BOUNDARY_KINDS.includes(value.kind)) invalidOrigin(`Invalid boundary record: ${key}`);
    if (value.recoveryOf !== undefined && !parsePhysicalKey(value.recoveryOf)) invalidOrigin(`Invalid boundary record: ${key}`);
    boundaries.set(originId(parts[1], parts[2]), value);
  }
  const claimed = new Map();
  for (const [key, record] of boundaries) {
    let at = key;
    const seen = new Set();
    while (!seen.has(at)) {
      seen.add(at);
      const alias = aliases.get(at);
      if (!alias) break;
      at = originId(alias.client, alias.clock);
    }
    if (seen.has(at) && aliases.has(at)) invalidOrigin(`Cyclic boundary alias: ${key}`);
    const previous = claimed.get(at);
    if (previous && boundaryIdentity(previous) !== boundaryIdentity(record)) invalidOrigin(`Conflicting boundary values: ${key}`);
    claimed.set(at, record);
  }
}

function blockOf(pd, block, index) {
  if (!Object.hasOwn(DEFAULTS, block.t)) unsupported(`Unsupported page block type: ${block.t}`);
  const type = schema.nodes[block.t];
  const attrs = pd.attrs.get(block.baseId);
  const table = block.t === "table" && !block.fields ? resolveTableFields(pd.tableFields, block.baseId, { cols: attrs?.get("cols"), rows: attrs?.get("rows") }) : null;
  const out = { t: block.t, pos: String(index + 1).padStart(8, "0") };
  for (const key of attrKeys(type)) {
    if (block.t === "board" && (key === "columns" || key === "cards")) continue;
    const value = block.fields ? block.fields[key] : table && (key === "cols" || key === "rows") ? table[key] : attrs?.has(key) ? attrs.get(key) : defaultOf(type, key);
    if (!sameJson(value, defaultOf(type, key))) out[key] = copy(value);
  }
  if (block.t === "table") out.rows = copy((block.fields ? block.fields.rows : table.rows) ?? {});
  if (block.t === "board") Object.assign(out, block.fields ? { columns: copy(block.fields.columns ?? {}), cards: copy(block.fields.cards ?? {}) } : resolveBoardFields(pd.boardFields, block.baseId));
  if (type.isTextblock) {
    let text = "";
    const units = [];
    for (const run of block.runs) {
      if (run.hole) continue;
      if (run.br) {
        if (block.t === "code_block") unsupported("A code block cannot contain a hard-break atom");
        text += ATOM;
        units.push(BREAK);
      } else {
        text += run.text;
        const key = markKey([...run.marks].sort((a, b) => a.type.rank - b.type.rank));
        for (let i = 0; i < run.text.length; i++) units.push(key);
      }
    }
    out.c = text;
    if (units.some(Boolean)) out.m = runsOf(units);
  }
  return out;
}

export function blocksFromYValue(value) {
  const doc = docFromValue(value, { strict: true });
  try {
    for (const [name, root] of doc.share) if (!PAGE_ROOTS.includes(name) && hasContent(root)) unsupported(`Unsupported page root: ${name}`);
    const pd = createPageDoc(doc);
    validateFlow(pd);
    resolveBoardFields(pd.boardFields);
    resolveTableFields(pd.tableFields);
    validateRecovery(pd);
    validateOrigins(pd);
    const visible = walk(pd).visible;
    const reserved = new Set(visible.filter((block) => !block.implicit).map((block) => block.id));
    const used = new Set();
    return Object.fromEntries(visible.map((block, index) => {
      let id = block.id;
      if (used.has(id) || (block.implicit && reserved.has(id))) {
        let copy = 2;
        do { id = `${block.id}~${copy++}`; } while (used.has(id) || reserved.has(id));
      }
      used.add(id);
      return [id, blockOf(pd, block, index)];
    }));
  } catch (error) {
    if (error instanceof YDecodeError) throw error;
    throw new YDecodeError("invalid-content", `Invalid Yjs page content: ${error.message}`);
  } finally {
    doc.destroy();
  }
}

export function blocksFromPageValues(values) {
  if (values.some((value) => !value || typeof value !== "object" || Array.isArray(value))) {
    throw new YDecodeError("invalid-value", "Expected a page data object");
  }
  if (!values.some((value) => Object.hasOwn(value, "y") || Object.hasOwn(value, "v"))) return blocksOfValues(values);
  if (values.length !== 1 || Object.hasOwn(values[0], "blocks") || Object.hasOwn(values[0], "deleted")) {
    throw new YDecodeError("invalid-value", "A Yjs page must have one page tag without hybrid block data");
  }
  return blocksFromYValue(values[0]);
}
