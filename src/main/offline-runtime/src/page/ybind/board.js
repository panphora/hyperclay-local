import { orderedIds } from "../projection.js";
import { YDecodeError } from "./provider.js";

const FIELDS = { column: new Set(["alive", "name", "pos"]), card: new Set(["alive", "title", "owner", "due", "placement"]) };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id) => typeof id === "string" && id.length > 0 && !["__proto__", "constructor", "prototype"].includes(id);
const fail = (key) => { throw new YDecodeError("unsupported-content", `Unsupported board field: ${key}`); };

export const boardKey = (blockId, kind, entityId, field) => JSON.stringify([blockId, kind, entityId, field]);

export function resolveBoardFields(fields, blockId = null) {
  const groups = new Map();
  for (const [key, value] of fields) {
    let tuple;
    try { tuple = JSON.parse(key); } catch { fail(key); }
    if (!Array.isArray(tuple) || tuple.length !== 4) fail(key);
    const [owner, kind, entityId, field] = tuple;
    if (!validId(owner) || !validId(entityId) || !Object.hasOwn(FIELDS, kind) || !FIELDS[kind].has(field)) fail(key);
    if (field === "alive" ? typeof value !== "boolean"
      : field === "placement" ? !record(value) || Object.keys(value).sort().join(",") !== "columnId,pos" || typeof value.columnId !== "string" || typeof value.pos !== "string"
        : field === "owner" || field === "due" ? value !== null && typeof value !== "string"
          : typeof value !== "string") fail(key);
    if (owner !== blockId) continue;
    const bucket = groups.get(kind) ?? new Map();
    const entity = bucket.get(entityId) ?? {};
    entity[field] = value;
    bucket.set(entityId, entity);
    groups.set(kind, bucket);
  }
  const columns = Object.fromEntries([...(groups.get("column") ?? [])].filter(([, item]) => item.alive !== false).map(([id, item]) => [id, { pos: item.pos ?? "", name: item.name ?? "" }]));
  const cards = Object.fromEntries([...(groups.get("card") ?? [])].filter(([, item]) => item.alive !== false).map(([id, item]) => [id, { pos: item.placement?.pos ?? "", col: item.placement?.columnId ?? "", title: item.title ?? "", ...(item.owner != null ? { owner: item.owner } : {}), ...(item.due != null ? { due: item.due } : {}) }]));
  const columnIds = orderedIds(columns);
  const missing = [...new Set(Object.values(cards).map((card) => card.col))].filter((id) => !Object.hasOwn(columns, id)).sort();
  const cardIds = [...columnIds, ...missing].flatMap((columnId) => orderedIds(Object.fromEntries(Object.entries(cards).filter(([, card]) => card.col === columnId))));
  return {
    columns: Object.fromEntries(columnIds.map((id) => [id, columns[id]])),
    cards: Object.fromEntries(cardIds.map((id) => [id, cards[id]])),
  };
}
