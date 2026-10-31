import { orderedIds } from "./model.js";
import { effectiveKind } from "./rich/csv.js";

const cache = new WeakMap();

export function columnKinds(table) {
  let out = cache.get(table);
  if (out) return out;
  out = {};
  for (const [index, id] of orderedIds(table.attrs.cols).entries()) {
    const values = [];
    table.forEach((row) => { if (index < row.childCount) values.push(row.child(index).textContent.trim()); });
    out[id] = effectiveKind(table.attrs.cols[id].kind, values);
  }
  cache.set(table, out);
  return out;
}

export const KIND_ICONS = Object.freeze({ text: "Aa", number: "#", date: "📅" });
export const KIND_LABELS = Object.freeze({ text: "Text", number: "Number", date: "Date" });
