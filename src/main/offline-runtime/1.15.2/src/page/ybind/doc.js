import { schema } from "../schema.js";
import { nodeFromBlock } from "../model.js";
import { attrKeys, defaultOf } from "./layout.js";
import { resolveBoardFields } from "./board.js";
import { resolveTableFields } from "./table.js";
import { attrKey } from "./recovery.js";

export const fieldsOf = (pd, b, type) => {
  const m = pd.attrs.get(b.baseId);
  const out = {};
  for (const k of attrKeys(type)) out[k] = m && m.has(k) ? m.get(k) : defaultOf(type, k);
  if (type.name === "board") Object.assign(out, resolveBoardFields(pd.boardFields, b.baseId));
  if (type.name === "table") Object.assign(out, resolveTableFields(pd.tableFields, b.baseId, { cols: out.cols, rows: out.rows }));
  return out;
};

export function docOf(pd, w) {
  const blocks = w.visible.map((b) => {
    const type = schema.nodes[b.t] ?? schema.nodes.paragraph;
    return { b, type, fields: { ...(b.fields ?? fieldsOf(pd, b, type)) } };
  });
  const byId = new Map(blocks.map((block) => [block.b.id, block]));
  const rankOf = (block) => {
    const item = block.b.recovered
      ? pd.gone._map.get(attrKey(block.b.sourceKey, "parent"))
      : pd.attrs.get(block.b.baseId)?._map.get("parent");
    return item?.id ?? { clock: -1, client: -1 };
  };
  for (const start of byId.keys()) {
    const positions = new Map(), chain = [];
    let id = start;
    while (byId.has(id) && !positions.has(id)) {
      positions.set(id, chain.length);
      chain.push(id);
      id = byId.get(id).fields.parent;
    }
    if (!positions.has(id)) continue;
    const cycle = chain.slice(positions.get(id));
    const lowest = cycle.reduce((left, right) => {
      const a = rankOf(byId.get(left)), b = rankOf(byId.get(right));
      return a.clock < b.clock || (a.clock === b.clock && a.client < b.client) ? left : right;
    });
    byId.get(lowest).fields.parent = null;
  }
  const nodes = blocks.map(({ b, type, fields }) => {
    const attrs = { id: b.id, pos: null, ...fields };
    if (type.name === "table" && Object.keys(attrs.rows ?? {}).length) return nodeFromBlock(schema, b.id, { t: "table", ...attrs });
    if (!type.isTextblock) return type.create(attrs);
    const content = [];
    for (const r of b.runs) {
      if (r.hole) continue;
      if (r.br) content.push(schema.nodes.hard_break.create());
      else content.push(schema.text(r.text, r.marks));
    }
    return type.create(attrs, content);
  });
  return nodes.length ? schema.nodes.doc.create(null, nodes) : schema.nodes.doc.createAndFill();
}
