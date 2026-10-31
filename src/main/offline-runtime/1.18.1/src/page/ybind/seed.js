import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { toBase64 } from "../../vendor/yjs.vendor.js";
import { SEED, attrKeys, defaultOf, createPageDoc } from "./layout.js";
import { insertTokens } from "./writer.js";

export function seedFrom(pd, blocks) {
  const tx = (fn) => pd.ydoc.transact(fn, SEED);
  const toks = [];
  for (const b of blocks) {
    const type = b.t ?? "paragraph";
    const attrs = Object.fromEntries(attrKeys(schema.nodes[type]).map((k) => [k, b.attrs?.[k] ?? defaultOf(schema.nodes[type], k)]));
    toks.push({ k: "b", id: b.id, t: type, attrs });
    if (b.text) for (const ch of b.text) toks.push({ k: "c", ch, mk: "", ma: {} });
  }
  insertTokens(pd, pd.flow.length, toks, tx);
}

export function seedValue(blocks) {
  const doc = new Y.Doc();
  doc.clientID = 1;
  const y = {};
  let n = 0;
  doc.on("updateV2", (update) => { y[`seed-${String(n++).padStart(4, "0")}`] = toBase64(update); });
  seedFrom(createPageDoc(doc), blocks);
  return { v: 1, g: 0, y };
}
