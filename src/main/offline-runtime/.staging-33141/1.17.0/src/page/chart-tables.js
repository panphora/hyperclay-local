import { schema } from "./schema.js";
import { orderedIds } from "./model.js";

// The tables a chart can be drawn from: a top-level table with at least one
// column. The insert menu reads this without the chart module itself, which only
// a document that takes a chart loads.
export function chartTables(doc) {
  const tables = [];
  doc.forEach((node) => { if (node.type === schema.nodes.table && orderedIds(node.attrs.cols).length) tables.push(node); });
  return tables;
}
