import { schema } from "./schema.js";
import { blockJson } from "./model.js";
import { project } from "./projection.js";

export function tablesFromDoc(doc) {
  const tables = [];
  let name = "";
  doc.forEach((node) => {
    if (node.type === schema.nodes.heading) name = node.textContent;
    if (node.type !== schema.nodes.table) return;
    const table = project({ [node.attrs.id]: blockJson(node) })[0];
    tables.push({ id: table.id, name: name || `Table ${tables.length + 1}`, cols: table.cols, rows: table.rows });
  });
  return tables;
}

export function toolContext(doc, title) {
  const outline = [];
  doc.forEach((node) => {
    if (node.type === schema.nodes.heading) outline.push({ level: node.attrs.level, text: node.textContent });
  });
  return { title, outline, tables: tablesFromDoc(doc) };
}
