import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { markKey } from "../inline.js";
import { ATOM, BREAK, DEFAULTS, blocksOfValues, runsOf } from "../projection.js";
import { createPageDoc, attrKeys, defaultOf, sameJson, PAGE_ROOTS } from "./layout.js";
import { resolveBoardFields } from "./board.js";
import { markName } from "./marks.js";
import { walk } from "./walk.js";
import { docFromValue, YDecodeError } from "./provider.js";

const copy = (value) => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
const unsupported = (message) => { throw new YDecodeError("unsupported-content", message); };
const hasContent = (root) => {
  if (root._map) for (const item of root._map.values()) if (!item.deleted) return true;
  for (let item = root._start; item; item = item.right) if (!item.deleted) return true;
  return false;
};

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

function blockOf(pd, block, index) {
  if (!Object.hasOwn(DEFAULTS, block.t)) unsupported(`Unsupported page block type: ${block.t}`);
  const type = schema.nodes[block.t];
  const attrs = pd.attrs.get(block.baseId);
  const out = { t: block.t, pos: String(index + 1).padStart(8, "0") };
  for (const key of attrKeys(type)) {
    if (block.t === "board" && (key === "columns" || key === "cards")) continue;
    const value = attrs?.has(key) ? attrs.get(key) : defaultOf(type, key);
    if (!sameJson(value, defaultOf(type, key))) out[key] = copy(value);
  }
  if (block.t === "table") out.rows = copy(attrs?.get("rows") ?? {});
  if (block.t === "board") Object.assign(out, resolveBoardFields(pd.boardFields, block.baseId));
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
