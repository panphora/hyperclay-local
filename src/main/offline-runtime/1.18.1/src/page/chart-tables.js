import { schema } from "./schema.js";
import { orderedIds } from "./model.js";

// The tables a chart can be drawn from: a top-level table with a labels column
// and at least one more to plot. The insert menu reads this without the chart module itself, which only
// a document that takes a chart loads.
export function chartTables(doc) {
  const tables = [];
  doc.forEach((node) => { if (node.type === schema.nodes.table && orderedIds(node.attrs.cols).length > 1) tables.push(node); });
  return tables;
}

// A table's name for a person: the heading before it with no other table in
// between, else its place among the tables, so a chart and the picker name it
// without a stored title.
export function tableName(doc, tableId) {
  let name = "";
  let count = 0;
  let found = null;
  doc.forEach((node) => {
    if (found !== null) return;
    if (node.type === schema.nodes.heading) name = node.textContent;
    if (node.type !== schema.nodes.table) return;
    count += 1;
    if (node.attrs.id === tableId) found = name || `Table ${count}`;
    name = "";
  });
  return found;
}
