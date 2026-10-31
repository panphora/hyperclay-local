import { schema } from "../schema.js";
import { isKey, keyBetween, newId, orderedIds } from "../model.js";
import { canon } from "../projection.js";
import { LOCAL } from "./layout.js";
import { walk } from "./walk.js";
import { fieldsOf } from "./doc.js";
import { attrKey, recoveredSource } from "./recovery.js";
import { removedBoardEntities, writeBoard } from "./board.js";

const refuse = (code) => ({ status: "refused", code });
const copy = (value) => JSON.parse(JSON.stringify(value));
const CARD_FIELDS = ["title", "owner", "due"];
const DUE = /^\d{4}-\d{2}-\d{2}$/;
const validValue = (field, value) => {
  if (field === "title") return typeof value === "string";
  if (field === "due") return value === null || (typeof value === "string" && DUE.test(value));
  return value === null || (typeof value === "string" && value.length > 0);
};
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function slotKey(positions, index) {
  const lower = index > 0 ? positions[index - 1] : null;
  const upper = positions.slice(index).find((pos) => lower === null || pos > lower) ?? null;
  const fits = (key) => (lower === null || key > lower) && (upper === null || key < upper);
  for (const [a, b] of [[lower, upper], [null, upper], [lower, null]]) {
    if ((a !== null && !isKey(a)) || (b !== null && !isKey(b)) || (a !== null && b !== null && a >= b)) continue;
    const key = keyBetween(a, b);
    if (fits(key)) return key;
  }
  return `${positions.reduce((max, pos) => (pos > max ? pos : max), "")}V`;
}

export function placeAt(ids, posOf, index) {
  const positions = ids.map(posOf);
  const lower = index > 0 ? positions[index - 1] : null;
  let end = index;
  while (lower !== null && end < positions.length && positions[end] === lower) end++;
  if (end === index) return { pos: slotKey(positions, index), rekey: [] };
  const upper = positions.slice(end).find((pos) => pos > lower) ?? null;
  const keys = [];
  for (let i = index, prev = lower; i <= end; i++) keys.push(prev = slotKey(upper === null ? [prev] : [prev, upper], 1));
  return { pos: keys[0], rekey: ids.slice(index, end).map((id, i) => [id, keys[i + 1]]) };
}

const place = (map, ids, index) => {
  const { pos, rekey } = placeAt(ids, (id) => map[id].pos, index);
  for (const [id, next] of rekey) map[id] = { ...map[id], pos: next };
  return pos;
};

export function createBoardCommands({ pd, um = null, origins = null, render = () => {} }) {
  const boardAt = (blockId) => {
    if (typeof blockId !== "string") return null;
    const seg = walk(pd, origins).visible.find((candidate) => candidate.id === blockId);
    if (!seg || seg.t !== "board") return null;
    const fields = seg.fields ?? fieldsOf(pd, seg, schema.nodes.board);
    return { columns: copy(fields.columns ?? {}), cards: copy(fields.cards ?? {}) };
  };
  const commit = (blockId, before, after, result) => {
    const source = recoveredSource(blockId);
    um?.stopCapturing();
    pd.ydoc.transact(() => {
      if (!source) writeBoard(pd, blockId, before, after);
      else for (const attr of ["columns", "cards"]) if (canon(before[attr]) !== canon(after[attr])) pd.gone.set(attrKey(source, attr), copy(after[attr]));
    }, LOCAL);
    um?.stopCapturing();
    render();
    return result;
  };
  const cardsIn = (board, columnId, without = null) => orderedIds(Object.fromEntries(Object.entries(board.cards).filter(([id, card]) => card.col === columnId && id !== without)));
  const indexAfter = (ids, afterId) => (afterId === undefined ? ids.length : afterId === null ? 0 : ids.indexOf(afterId) + 1);
  const badAfter = (ids, afterId) => afterId !== undefined && afterId !== null && !ids.includes(afterId);
  const withBoard = (blockId, run) => {
    const board = boardAt(blockId);
    return board ? run(board, copy(board)) : refuse("missing-board");
  };

  return {
    read: (blockId) => boardAt(blockId),
    removed(blockId) {
      if (!boardAt(blockId)) return null;
      return recoveredSource(blockId) ? { columns: {}, cards: {} } : removedBoardEntities(pd.boardFields, blockId);
    },
    createColumn: (blockId, { name = "", afterId } = {}) => withBoard(blockId, (board, after) => {
      if (typeof name !== "string") return refuse("invalid-value");
      const ids = orderedIds(board.columns);
      if (badAfter(ids, afterId)) return refuse("missing-destination");
      const id = newId("c");
      after.columns[id] = { pos: place(after.columns, ids, indexAfter(ids, afterId)), name };
      return commit(blockId, board, after, { status: "created", id });
    }),
    renameColumn: (blockId, columnId, name) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.columns, columnId)) return refuse("missing-column");
      if (typeof name !== "string") return refuse("invalid-value");
      if (board.columns[columnId].name === name) return { status: "unchanged" };
      after.columns[columnId].name = name;
      return commit(blockId, board, after, { status: "changed" });
    }),
    moveColumn: (blockId, columnId, { afterId = null } = {}) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.columns, columnId)) return refuse("missing-column");
      const ids = orderedIds(board.columns).filter((id) => id !== columnId);
      if (badAfter(ids, afterId)) return refuse("missing-destination");
      const index = indexAfter(ids, afterId);
      const current = orderedIds(board.columns);
      if ([...ids.slice(0, index), columnId, ...ids.slice(index)].every((id, i) => id === current[i])) return { status: "unchanged" };
      after.columns[columnId].pos = place(after.columns, ids, index);
      return commit(blockId, board, after, { status: "moved" });
    }),
    removeColumn: (blockId, columnId) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.columns, columnId)) return refuse("missing-column");
      delete after.columns[columnId];
      return commit(blockId, board, after, { status: "removed", cards: cardsIn(board, columnId).length });
    }),
    restoreColumn: (blockId, columnId) => withBoard(blockId, (board, after) => {
      if (Object.hasOwn(board.columns, columnId)) return { status: "unchanged" };
      const removed = recoveredSource(blockId) ? null : removedBoardEntities(pd.boardFields, blockId).columns[columnId];
      if (!removed) return refuse("missing-column");
      after.columns[columnId] = removed;
      return commit(blockId, board, after, { status: "restored" });
    }),
    createCard: (blockId, { columnId, title = "", owner = null, due = null, afterId } = {}) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.columns, columnId)) return refuse("missing-column");
      if (!validValue("title", title) || !validValue("owner", owner) || !validValue("due", due)) return refuse("invalid-value");
      const ids = cardsIn(board, columnId);
      if (badAfter(ids, afterId)) return refuse("missing-destination");
      const id = newId("k");
      after.cards[id] = { pos: place(after.cards, ids, indexAfter(ids, afterId)), col: columnId, title, ...(owner !== null ? { owner } : {}), ...(due !== null ? { due } : {}) };
      return commit(blockId, board, after, { status: "created", id });
    }),
    editCard: (blockId, cardId, patch) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.cards, cardId)) return refuse("missing-card");
      if (!record(patch) || !Object.keys(patch).length || Object.keys(patch).some((field) => !CARD_FIELDS.includes(field))) return refuse("invalid-field");
      if (Object.entries(patch).some(([field, value]) => !validValue(field, value))) return refuse("invalid-value");
      const next = { ...board.cards[cardId] };
      for (const [field, value] of Object.entries(patch)) {
        if (value === null) delete next[field];
        else next[field] = value;
      }
      if (canon(next) === canon(board.cards[cardId])) return { status: "unchanged" };
      after.cards[cardId] = next;
      return commit(blockId, board, after, { status: "changed" });
    }),
    moveCard: (blockId, cardId, { columnId, afterId = null } = {}) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.cards, cardId)) return refuse("missing-card");
      if (!Object.hasOwn(board.columns, columnId)) return refuse("missing-column");
      const ids = cardsIn(board, columnId, cardId);
      if (badAfter(ids, afterId)) return refuse("missing-destination");
      const index = indexAfter(ids, afterId);
      const card = board.cards[cardId];
      if (card.col === columnId) {
        const current = cardsIn(board, columnId);
        if ([...ids.slice(0, index), cardId, ...ids.slice(index)].every((id, i) => id === current[i])) return { status: "unchanged" };
      }
      after.cards[cardId] = { ...card, col: columnId, pos: place(after.cards, ids, index) };
      return commit(blockId, board, after, { status: "moved" });
    }),
    removeCard: (blockId, cardId) => withBoard(blockId, (board, after) => {
      if (!Object.hasOwn(board.cards, cardId)) return refuse("missing-card");
      delete after.cards[cardId];
      return commit(blockId, board, after, { status: "removed" });
    }),
    restoreCard: (blockId, cardId) => withBoard(blockId, (board, after) => {
      if (Object.hasOwn(board.cards, cardId)) return { status: "unchanged" };
      const removed = recoveredSource(blockId) ? null : removedBoardEntities(pd.boardFields, blockId).cards[cardId];
      if (!removed) return refuse("missing-card");
      after.cards[cardId] = removed;
      return commit(blockId, board, after, { status: "restored" });
    }),
  };
}
