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

const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

// Every attribute a block record holds, known or not, without the structural
// position: the record an opaque block keeps and writes back unchanged.
const rawOf = (pd, b) => {
  const out = {};
  const m = pd.attrs.get(b.baseId);
  if (m) m.forEach((value, key) => { if (key !== "pos") out[key] = copy(value); });
  out.t = b.t;
  return out;
};

// `nodes`, when given, maps a walk segment to a node already proven equal to what this
// function would build for it (the bridge fills it from the view): that block costs
// nothing to derive again, and the same node object comes back.
export function docOf(pd, w, nodes = null) {
  const build = (b) => {
    if (b.opaque) {
      const fields = b.recovered ? { ...copy(b.fields ?? {}) } : rawOf(pd, b);
      return { b, type: schema.nodes.opaque_block, fields, opaque: true };
    }
    const type = schema.nodes[b.t] ?? schema.nodes.paragraph;
    return { b, type, fields: { ...(b.fields ?? fieldsOf(pd, b, type)) } };
  };
  const blocks = w.visible.map((b) => { const node = nodes?.get(b); return node ? { b, node } : build(b); });
  const byId = new Map(blocks.map((block, i) => [block.b.id, i]));
  const parentOf = (i) => (blocks[i].node ? blocks[i].node.attrs.parent : blocks[i].fields.parent);
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
      id = parentOf(byId.get(id));
    }
    if (!positions.has(id)) continue;
    const cycle = chain.slice(positions.get(id));
    const lowest = cycle.reduce((left, right) => {
      const a = rankOf(blocks[byId.get(left)]), b = rankOf(blocks[byId.get(right)]);
      return a.clock < b.clock || (a.clock === b.clock && a.client < b.client) ? left : right;
    });
    const at = byId.get(lowest);
    if (blocks[at].node) blocks[at] = build(blocks[at].b);
    blocks[at].fields.parent = null;
  }
  const built = blocks.map(({ b, node, type, fields, opaque }) => {
    if (node) return node;
    if (opaque) {
      const content = [];
      for (const r of b.runs) {
        if (r.hole) continue;
        if (r.br) content.push(schema.nodes.hard_break.create());
        else content.push(schema.text(r.text, r.marks));
      }
      return type.create({ id: b.id, pos: null, raw: fields }, content);
    }
    const attrs = { id: b.id, pos: null, ...fields };
    if (type.name === "table" && Object.keys(attrs.rows ?? {}).length && Object.keys(attrs.cols ?? {}).length) return nodeFromBlock(schema, b.id, { t: "table", ...attrs });
    if (!type.isTextblock) return type.create(attrs);
    const content = [];
    for (const r of b.runs) {
      if (r.hole) continue;
      if (r.br) content.push(schema.nodes.hard_break.create());
      else content.push(schema.text(r.text, r.marks));
    }
    return type.create(attrs, content);
  });
  return built.length ? schema.nodes.doc.create(null, built) : schema.nodes.doc.createAndFill();
}
