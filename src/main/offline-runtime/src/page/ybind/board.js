import { canon, orderedIds } from "../projection.js";
import { YDecodeError } from "./provider.js";

export const BOARD_FIELDS = Object.freeze({ column: Object.freeze(["alive", "name", "pos"]), card: Object.freeze(["alive", "title", "owner", "due", "placement"]) });
const FIELDS = { column: new Set(BOARD_FIELDS.column), card: new Set(BOARD_FIELDS.card) };
const ENTITIES = [["column", "columns"], ["card", "cards"]];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (id) => typeof id === "string" && id.length > 0 && !["__proto__", "constructor", "prototype"].includes(id);
const fail = (key) => { throw new YDecodeError("unsupported-content", `Unsupported board field: ${key}`); };
const copy = (value) => (value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value)));

export const boardKey = (blockId, kind, entityId, field) => JSON.stringify([blockId, kind, entityId, field]);

function entitiesOf(fields, blockId) {
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
  return groups;
}

const columnOf = (item) => ({ pos: item.pos ?? "", name: item.name ?? "" });
const cardOf = (item) => ({ pos: item.placement?.pos ?? "", col: item.placement?.columnId ?? "", title: item.title ?? "", ...(item.owner != null ? { owner: item.owner } : {}), ...(item.due != null ? { due: item.due } : {}) });
const pick = (groups, kind, shape, alive) => Object.fromEntries([...(groups.get(kind) ?? [])].filter(([, item]) => (item.alive !== false) === alive).map(([id, item]) => [id, shape(item)]));

export function resolveBoardFields(fields, blockId = null) {
  const groups = entitiesOf(fields, blockId);
  const columns = pick(groups, "column", columnOf, true);
  const cards = pick(groups, "card", cardOf, true);
  const columnIds = orderedIds(columns);
  const missing = [...new Set(Object.values(cards).map((card) => card.col))].filter((id) => !Object.hasOwn(columns, id)).sort();
  const cardIds = [...columnIds, ...missing].flatMap((columnId) => orderedIds(Object.fromEntries(Object.entries(cards).filter(([, card]) => card.col === columnId))));
  return {
    columns: Object.fromEntries(columnIds.map((id) => [id, columns[id]])),
    cards: Object.fromEntries(cardIds.map((id) => [id, cards[id]])),
  };
}

export function removedBoardEntities(fields, blockId) {
  const groups = entitiesOf(fields, blockId);
  return { columns: pick(groups, "column", columnOf, false), cards: pick(groups, "card", cardOf, false) };
}

const DEFAULTS = { name: "", pos: "", title: "", owner: null, due: null, placement: { columnId: "", pos: "" } };
const fieldOf = (kind, entity, field) => {
  if (kind === "card" && field === "placement") return { columnId: entity.col ?? "", pos: entity.pos ?? "" };
  return entity[field] ?? DEFAULTS[field];
};

export function boardChanges(blockId, fields, before, after) {
  const out = [];
  for (const [kind, attr] of ENTITIES) {
    const was = record(before?.[attr]) ? before[attr] : {}, now = record(after?.[attr]) ? after[attr] : {};
    for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const old = was[id], next = now[id];
      if (!next) {
        if (old) out.push([boardKey(blockId, kind, id, "alive"), false]);
        continue;
      }
      if (!old) out.push([boardKey(blockId, kind, id, "alive"), true]);
      for (const field of BOARD_FIELDS[kind]) {
        if (field === "alive") continue;
        const key = boardKey(blockId, kind, id, field);
        const value = fieldOf(kind, next, field);
        const prior = old ? fieldOf(kind, old, field) : fields.has(key) ? fields.get(key) : DEFAULTS[field];
        if (canon(prior) !== canon(value)) out.push([key, copy(value)]);
      }
    }
  }
  return out;
}

export function writeBoard(pd, blockId, before, after) {
  for (const [key, value] of boardChanges(blockId, pd.boardFields, before, after)) pd.boardFields.set(key, value);
}
