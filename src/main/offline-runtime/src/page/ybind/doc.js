import { schema } from "../schema.js";
import { nodeFromBlock } from "../model.js";
import { attrKeys, defaultOf } from "./layout.js";
import { resolveBoardFields } from "./board.js";

export const fieldsOf = (pd, b, type) => {
  const m = pd.attrs.get(b.baseId);
  const out = {};
  for (const k of attrKeys(type)) out[k] = m && m.has(k) ? m.get(k) : defaultOf(type, k);
  if (type.name === "board") Object.assign(out, resolveBoardFields(pd.boardFields, b.baseId));
  return out;
};

export function docOf(pd, w) {
  const nodes = w.visible.map((b) => {
    const type = schema.nodes[b.t] ?? schema.nodes.paragraph;
    const attrs = { id: b.id, pos: null, ...fieldsOf(pd, b, type) };
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
