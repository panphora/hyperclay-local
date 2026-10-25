import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseJsonRelaxed } from 'hyper-morph/json-parse';
import { validateOp, checkOp, applyOp, applyTracked, undoTracked, sizeChange, cloneJson, serializeLive, textHash, diffOps } from './live-data-ops.js';
import { liveTags } from './live-data-tags.js';
import { checkPageConversion, PageConversionError } from './page-conversion.js';
import { checkPageInitial } from './page-write-admission.js';
import { inspectPage, isYPageValue, isHybridPageValue } from './page-admission.js';
import { makePageTransition, pageTransitionState } from './live-page-history.js';
export { liveTags } from './live-data-tags.js';

import { frameSet, contains, descendants, receiptHas, receiptBytes, saveReceipt, postReceipt, replaceReceipt, retireReceipt, RECEIPT_LIMIT } from './live-provenance.js';

const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const sizeOf = (value) => byteLength(serializeLive(value));

/**
 * Rooms for clay.live stores: one shared copy of a document's live JSON while
 * people are connected, ordered by one sequence number per room.
 *
 * A room starts from the saved file (the live tags in its HTML), never from a
 * tab: a tab can hold a stale or altered copy. Every accepted frame bumps the
 * room's seq; that order is the order every tab applies. A sender numbers its
 * own frames per store (n), so a retried POST whose first attempt landed is
 * answered as a duplicate instead of applied twice.
 * A write of the file merges: the room takes the file's value and replays its
 * own moves since the version the file descends from (the tag's live-at stamp
 * names it). Per store the room keeps a log of its moves, `last` (the seq of the
 * store's latest change) and `landed` (the seq from which the file plus the log
 * rebuilds the room's value; -1 when it cannot, and the writer saves now).
 *
 * Pure state: no Express, no SSE, no timers. The caller owns time (now), fan-out
 * and expiry scheduling.
 */

// liveBytes is the budget for every room together: each store's value and its
// log, as serialized bytes. Past it a new room is not opened and a frame that
// grows a store is answered busy. Real pages hold 2 to 4.5 bytes of heap per
// counted byte, so the rooms stay near 1 GB at most.
export const LIVE_LIMITS = Object.freeze({
  opsPerFrame: 128,
  storeBytes: 4 * 1024 * 1024,
  roomBytes: 6 * 1024 * 1024,
  liveBytes: 256 * 1024 * 1024,
  storesPerRoom: 16,
  rooms: 5000,
  retainMs: 2 * 60 * 1000,
  logEntries: 4096,
  logBytes: 256 * 1024,
  receipts: RECEIPT_LIMIT,
  // A state read's moves, over every store: past this, a store's moves are null
  // (the reader rebuilds from the value, as after the log is evicted).
  movesBytes: 1024 * 1024,
});

const PAGE = /^page(\.[0-9]+)?$/;
const isContainer = (v) => v !== null && typeof v === 'object';

// The stores a room starts with. A store over the store cap is left out, and so
// is any store that would take the room past its cap: tabs then keep those at
// save speed instead of having every op refused.
function seedStores(html, { pageOnly = false, heldBytes = 0, heldCount = 0 } = {}) {
  const stores = new Map();
  let total = heldBytes;
  for (const tag of liveTags(html)) {
    if (pageOnly && !PAGE.test(tag.name)) continue;
    if (stores.size + heldCount >= LIVE_LIMITS.storesPerRoom) break;
    let value;
    try {
      value = cloneJson(parseJsonRelaxed(tag.text));
    } catch {
      continue;
    }
    if (!isContainer(value)) continue;
    const bytes = byteLength(serializeLive(value));
    if (bytes > LIVE_LIMITS.storeBytes || total + bytes > LIVE_LIMITS.roomBytes) continue;
    total += bytes;
    stores.set(tag.name, {
      value,
      ephemeral: tag.ephemeral,
      bytes,
      from: tag.at ? { epoch: tag.at.epoch, seq: tag.at.seq } : null,
      last: 0,
      landed: 0,
      floor: 0,
      log: [],
      logBytes: 0,
      // Seqs of logged merges whose edit the file on disk holds.
      inFile: new Set(),
    });
  }
  return stores;
}

// Over a cap the oldest entries go, and a file older than the newest one gone
// can no longer be merged (floor). The file holds the oldest entries, so a
// writer that keeps saving only ever loses the merge of a restore that old.
function evict(store) {
  while (store.log.length > LIVE_LIMITS.logEntries || store.logBytes > LIVE_LIMITS.logBytes) {
    const gone = store.log.shift();
    store.logBytes -= gone.bytes;
    store.floor = gone.seq;
    store.inFile.delete(gone.seq);
  }
}

// The log bytes evict() would leave after one more entry of `bytes`.
function logAfter(store, bytes) {
  let count = store.log.length + 1;
  let total = store.logBytes + bytes;
  for (let i = 0; count > LIVE_LIMITS.logEntries || total > LIVE_LIMITS.logBytes; i++, count--) {
    total -= i < store.log.length ? store.log[i].bytes : bytes;
  }
  return total;
}

// The moves the file does not hold fill half the log: the writer should save
// now rather than at its deadline.
function pressed(store) {
  let count = 0;
  let bytes = 0;
  for (const entry of store.log) {
    if (store.landed !== -1 && entry.seq <= store.landed) continue;
    count += 1;
    bytes += entry.bytes;
  }
  return bytes > LIVE_LIMITS.logBytes / 2 || count > LIVE_LIMITS.logEntries / 2;
}

// The moves a store's log holds after since.seq, for a tab that applied
// everything through it. [] when nothing is newer; null when the log no longer
// reaches back that far (its floor is past since.seq). A log may start above
// since.seq + 1 with nothing missing: the seqs between went to other stores.
function movesSince(store, sinceSeq) {
  if (sinceSeq >= store.last) return [];
  if (sinceSeq < store.floor) return null;
  return store.log.filter((entry) => entry.seq > sinceSeq).map(({ seq, ops }) => ({ seq, ops }));
}

// Where in the room's history a written file starts. Its stamp's seq when the
// stamp is this room's. 0, before every move of this room, when it is a
// checkpoint of the room this one was seeded from, taken at or after the seed: a
// tab never sends a move of the old room to the new one, so none of this room's
// moves is in it. Anything else (no stamp, another lineage, a version older than
// the seed) descends from the last version the room knows the file held: saves
// are conditional.
function baseOf(room, store, at) {
  if (at && at.epoch === room.epoch && at.seq <= room.seq) return at.seq;
  if (at && store.from && at.epoch === store.from.epoch && at.seq >= store.from.seq) return 0;
  return store.landed;
}

// The file is a capture this room can place (baseOf's first two cases), not a
// descendant of the file on disk.
function placed(room, store, at) {
  return !!at && ((at.epoch === room.epoch && at.seq <= room.seq) || (!!store.from && at.epoch === store.from.epoch && at.seq >= store.from.seq));
}

// Exact sets are capture-bound. Legacy watermarks retain their old receipt check.
function provenBy(room, name, tag, stamped) {
  if (!tag.by || !stamped) return null;
  if (tag.by.v === 2) return tag.by;
  if (tag.at.epoch !== room.epoch) return null;
  const last = room.lastN.get(name + '\n' + tag.by.client);
  return tag.by.n <= (last ? last.n : 0) + 1 ? tag.by : null;
}

/**
 * @param {{ now?: () => number, newEpoch?: () => string, liveBytes?: number }} [options]
 */
// How long a document refused for the budget is refused again without its
// file being read, while the rooms stay as full.
export const REFUSED_MS = 10 * 60 * 1000;

/**
 * Whether a room holds accepted state the file does not: at least one non-ephemeral store whose
 * latest change (`last`) the file does not reach (`landed`), including `landed === -1`, where the
 * log no longer reaches the file's base. Presence never dirties a room. Read against the room
 * itself, so a sweep or a checkpoint decision never depends on a scheduled timer or a flag.
 */
export function roomIsDirty(room) {
  for (const store of room.stores.values()) {
    if (!store.ephemeral && store.last !== store.landed) return true;
  }
  return false;
}

export class PersistentReservationError extends Error {
  constructor(code) {
    super(`Persistent reservation refused: ${code}`);
    this.name = 'PersistentReservationError';
    this.code = code;
  }
}

export function createRooms({ now = Date.now, newEpoch = randomUUID, liveBytes = LIVE_LIMITS.liveBytes } = {}) {
  const rooms = new Map();
  const pageReservations = new Map();
  const reservedNodes = new Map();
  const persistentReservations = new Map();
  const persistentTokens = new Map();
  const releasedTokens = new WeakSet();
  // What every room holds, against LIVE_LIMITS.liveBytes.
  let used = 0;
  // Documents whose room did not fit the budget: key -> { held, at }.
  const refused = new Map();

  const build = (key, html, nodeId = null) => ({
    key,
    nodeId,
    fileHash: typeof html === 'string' ? textHash(html) : null,
    epoch: newEpoch(),
    seq: 0,
    stores: seedStores(html),
    writer: null,
    lastN: new Map(),
    lastSentAt: new Map(),
    seen: new Map(),
    emptySince: null,
    ...(inspectPage(html).kind === 'yjs' && { pageTransition: makePageTransition() }),
  });

  const roomBytes = (room) => {
    let total = 0;
    for (const s of room.stores.values()) total += s.bytes;
    return total;
  };
  const heldBy = (room) => {
    let total = (room.receiptBytes ?? 0) + (room.pageTransition?.bytes ?? 0);
    for (const s of room.stores.values()) total += s.bytes + s.logBytes;
    return total;
  };

  const pageSource = (key, nodeId) => {
    if (nodeId == null) throw new PageConversionError('invalid-document');
    if (pageReservations.has(key) || persistentReservations.has(key) || reservedNodes.has(String(nodeId))) throw new PageConversionError('page-converting');
    let room = rooms.get(key) ?? null;
    if (room && String(room.nodeId) !== String(nodeId)) {
      used -= heldBy(room);
      rooms.delete(key);
      room = null;
    }
    return room;
  };

  const reservePageTarget = (key, nodeId, room, html, details) => {
    const receipts = new Set([...(room?.lastN.keys() ?? [])].filter((key) => PAGE.test(key.slice(0, key.indexOf('\n')))));
    if (receipts.size >= LIVE_LIMITS.receipts ||
      (room?.pageTransition?.receiptCount ?? 0) + receipts.size > LIVE_LIMITS.receipts) throw new PageConversionError('receipt-capacity');
    const names = details.names ?? [...new Set([
      ...[...(room?.stores.keys() ?? [])].filter((name) => PAGE.test(name)),
      ...[...receipts].map((key) => key.slice(0, key.indexOf('\n'))),
    ])];
    const token = Object.freeze({ key, nodeId });
    let target = null;
    let budget = 0;
    if (room) {
      const sourceReceipts = new Map([...receipts].map((key) => [key, room.lastN.get(key)]));
      const transition = makePageTransition({ room, format: details.format, sources: names, receipts: sourceReceipts });
      const others = [...room.stores].filter(([name]) => !PAGE.test(name));
      const stores = seedStores(html, {
        pageOnly: true,
        heldBytes: others.reduce((sum, [, store]) => sum + store.bytes, 0),
        heldCount: others.length,
      });
      for (const store of stores.values()) store.from = null;
      budget = transition.bytes - (room.pageTransition?.historyBytes ?? 0) +
        [...stores.values()].reduce((sum, store) => sum + store.bytes, 0);
      const replacedBytes = [...room.stores].filter(([name]) => PAGE.test(name))
        .reduce((sum, [, store]) => sum + store.bytes + store.logBytes, 0);
      const growth = details.source === 'replacement' ? budget - replacedBytes : budget;
      if (details.source === 'replacement' ? growth > 0 && used + growth > liveBytes : used + budget > liveBytes) {
        throw new PageConversionError('budget');
      }
      target = { stores, transition };
    }
    used += budget;
    pageReservations.set(key, { token, room, html, ...details, names, receipts, target, budget, committed: false, drop: false });
    reservedNodes.set(String(nodeId), token);
    return token;
  };

  const reconcileFile = (room, key, html, { restored = false } = {}) => {
    // A tab's word that it merged the file's article holds for that file only:
    // the next write that changes it, outside or checkpoint, ends it.
    const seen = textHash(html);
    if (room.fileHash !== seen) {
      room.adopted = null;
      room.fileHash = seen;
    }
    const heldBefore = heldBy(room);
    let valueChanged = false;
    const landed = [];
    for (const tag of liveTags(html)) {
      if (pageReservations.has(key) && PAGE.test(tag.name)) continue;
      const store = room.stores.get(tag.name);
      // A never-saved store's tag is never written by a tab: the file is not its source.
      if (!store || store.ephemeral) continue;
      let value;
      try {
        value = cloneJson(parseJsonRelaxed(tag.text));
      } catch {
        continue;
      }
      if (!isContainer(value) || Array.isArray(value) !== Array.isArray(store.value)) continue;
      if (PAGE.test(tag.name)) {
        if (room.pageTransition?.format === 'yjs') {
          if (tag.name !== 'page' || !isYPageValue(value)) continue;
        } else if (isYPageValue(value, { complete: false })) continue;
      }
      const before = store.landed;
      const base = baseOf(room, store, tag.at);
      // A capture (stamped, and still the value its stamp names) holds no merge
      // past its stamp. Anything else descends from the file on disk, which
      // holds the merges in inFile: they are not replayed over it.
      const stamped = placed(room, store, tag.at) && tag.at.hash === textHash(serializeLive(value));
      if (base < store.floor) {
        store.landed = -1;
        if (before !== -1) landed.push(tag.name);
        continue;
      }
      // A restore proves neither frame inclusion nor descent from a capture.
      const by = restored ? null : provenBy(room, tag.name, tag, stamped);
      const frames = tag.at?.epoch === room.epoch ? frameSet(by) : [];
      const ancestry = descendants(by);
      const own = (entry) => {
        if (!by) return false;
        if (!entry.merge) return contains(frames, entry.from, entry.n);
        const p = entry.provenance;
        return by.v === 2 && p && p.at.epoch === tag.at.epoch && p.at.seq === tag.at.seq && contains(ancestry, ...p.capture);
      };
      if (stamped) store.inFile.clear();
      const entries = [];
      for (const entry of store.log) {
        if (entry.seq <= base) continue;
        if (own(entry)) store.inFile.add(entry.seq);
        else if (stamped || !store.inFile.has(entry.seq)) entries.push(entry);
      }
      for (const entry of entries) {
        for (const op of entry.ops) {
          try {
            checkOp(value, op);
            value = applyOp(value, op);
          } catch {}
        }
      }
      const text = serializeLive(value);
      if (text !== serializeLive(store.value)) {
        const bytes = byteLength(text);
        if (bytes > LIVE_LIMITS.storeBytes || roomBytes(room) - store.bytes + bytes > LIVE_LIMITS.roomBytes) {
          room.stores.delete(tag.name);
          valueChanged = true;
          continue;
        }
        // Logged like a frame, so a capture stamped before this merge gets it
        // replayed on top (leaf ops: a capture that holds it already is unchanged).
        const ops = diffOps(store.value, value);
        store.value = value;
        store.bytes = bytes;
        room.seq += 1;
        store.last = room.seq;
        const provenance = by?.v === 2 ? { at: { epoch: tag.at.epoch, seq: tag.at.seq }, by: by.frames, capture: by.capture } : null;
        const logged = byteLength(JSON.stringify(provenance ? { ops, provenance } : ops));
        store.log.push({ seq: room.seq, ops, bytes: logged, merge: true, ...(provenance && { provenance }) });
        store.inFile.add(room.seq);
        store.logBytes += logged;
        evict(store);
        valueChanged = true;
      }
      store.landed = entries.length ? base : store.last;
      if (store.landed !== before) landed.push(tag.name);
      // Saves record exact inclusion; only legacy captures advance a watermark.
      if (by?.v === 2) {
        for (const [client, ranges] of frames) {
          if (!saveReceipt(room, tag.name + '\n' + client, ranges, store.last, LIVE_LIMITS.receipts, pageReservations.get(key)?.receipts)) {
            room.receiptGeneration = (room.receiptGeneration ?? 0) + 1;
          }
        }
      } else if (by) {
        const nKey = tag.name + '\n' + by.client;
        const last = room.lastN.get(nKey);
        if ((!last || last.n < by.n) && (last || room.lastN.size < LIVE_LIMITS.receipts)) {
          replaceReceipt(room, nKey, postReceipt(last, by.n, store.last));
        }
      }
    }
    // A merge is never refused: it can take the rooms past the budget, and
    // then only frames that shrink a store land until they are under it.
    const heldDelta = heldBy(room) - heldBefore;
    if (!valueChanged && !landed.length) return { result: null, heldDelta };
    return { result: { room, valueChanged, landed }, heldDelta };
  };

  const heldRecord = (token) => {
    const record = persistentTokens.get(token);
    if (!record || record.token !== token) throw new PersistentReservationError('invalid-reservation');
    return record;
  };

  return {
    /**
     * Whether a room for key may fit the budget, without reading its file: false
     * while the last build of key was refused for the budget, in the last
     * REFUSED_MS, and it still would not fit. Cheap, so a document refused once
     * costs a file read at most once in that time while the rooms stay full.
     */
    mayFit(key) {
      const last = refused.get(key);
      if (!last) return true;
      if (now() - last.at > REFUSED_MS || used + last.held <= liveBytes) {
        refused.delete(key);
        return true;
      }
      return false;
    },

    reservePage(key, { nodeId, header, currentHtml, html, ifMatch }) {
      const room = pageSource(key, nodeId);
      const conversion = checkPageConversion({ header, currentHtml, html, ifMatch, room });
      if (!conversion) throw new PageConversionError('invalid-header');
      const { source, base, epoch, names } = conversion;
      return reservePageTarget(key, nodeId, room, html, { source, base, epoch, names, format: 'yjs' });
    },

    reservePageInitial(key, { nodeId, currentHtml, html, ifMatch }) {
      const room = pageSource(key, nodeId);
      checkPageInitial({ currentHtml, html, ifMatch, room });
      return reservePageTarget(key, nodeId, room, html, { source: 'initial', names: [], format: 'yjs' });
    },

    reservePageReplacement(key, { nodeId, html }) {
      const room = pageSource(key, nodeId);
      if (typeof html !== 'string') throw new PageConversionError('invalid-capture');
      return reservePageTarget(key, nodeId, room, html, { source: 'replacement', format: inspectPage(html).kind });
    },

    pageReserved(key) {
      return pageReservations.has(key);
    },

    commitPage(token) {
      const reservation = pageReservations.get(token?.key);
      if (!reservation || reservation.token !== token) throw new PageConversionError('invalid-reservation');
      if (reservation.committed) return reservation.result;
      const room = rooms.get(token.key) ?? null;
      if (room !== reservation.room) throw new PageConversionError('room-changed');
      if (!room) {
        reservation.committed = true;
        reservation.result = null;
        return null;
      }
      const before = heldBy(room);
      const { stores, transition } = reservation.target;
      for (const name of room.stores.keys()) if (PAGE.test(name)) room.stores.delete(name);
      for (const key of reservation.receipts) {
        room.receiptBytes = (room.receiptBytes ?? 0) - receiptBytes(room.lastN.get(key));
        room.lastN.delete(key);
      }
      room.seq += 1;
      let bytes = roomBytes(room);
      for (const [name, store] of stores) {
        if (room.stores.size >= LIVE_LIMITS.storesPerRoom || bytes + store.bytes > LIVE_LIMITS.roomBytes) continue;
        store.last = store.landed = store.floor = room.seq;
        room.stores.set(name, store);
        bytes += store.bytes;
      }
      room.pageTransition = transition;
      reservation.target = null;
      used += heldBy(room) - before - reservation.budget;
      reservation.budget = 0;
      reservation.committed = true;
      reservation.result = { room, valueChanged: true, landed: [] };
      return reservation.result;
    },

    releasePage(token) {
      const reservation = pageReservations.get(token?.key);
      if (!reservation || reservation.token !== token) return false;
      used -= reservation.budget;
      pageReservations.delete(token.key);
      reservedNodes.delete(String(token.nodeId));
      if (reservation.drop) {
        const room = rooms.get(token.key);
        if (room) used -= heldBy(room);
        rooms.delete(token.key);
      }
      return true;
    },

    holdPersistent(key, { nodeId, requireClean = false } = {}) {
      const room = rooms.get(key);
      if (!room || nodeId == null || room.nodeId == null || String(room.nodeId) !== String(nodeId)) {
        throw new PersistentReservationError('room-changed');
      }
      if (persistentReservations.has(key) || pageReservations.has(key) || reservedNodes.has(String(nodeId))) {
        throw new PersistentReservationError('checkpointing');
      }
      if (requireClean) {
        for (const store of room.stores.values()) {
          if (store.ephemeral) continue;
          if (store.landed === -1 || store.landed !== store.last) throw new PersistentReservationError('unlanded');
        }
      }
      const token = Object.freeze({});
      const record = { token, room, key, nodeId, html: null, preclaim: 0, result: undefined, written: false, drop: false };
      persistentReservations.set(key, record);
      persistentTokens.set(token, record);
      reservedNodes.set(String(nodeId), token);
      return token;
    },

    checkPersistent(token, { html } = {}) {
      const record = heldRecord(token);
      if (record.html !== null) throw new PersistentReservationError('invalid-reservation');
      if (rooms.get(record.key) !== record.room) throw new PersistentReservationError('room-changed');
      if (typeof html !== 'string') throw new PersistentReservationError('invalid-target');
      const candidate = new Map();
      const counts = new Map();
      for (const tag of liveTags(html, { includeDuplicates: true })) {
        counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
        if (!candidate.has(tag.name)) candidate.set(tag.name, tag);
      }
      for (const [name, store] of record.room.stores) {
        if (store.ephemeral) continue;
        const tag = candidate.get(name);
        if (!tag || tag.ephemeral || counts.get(name) !== 1) throw new PersistentReservationError('invalid-target');
        let value;
        try {
          value = cloneJson(parseJsonRelaxed(tag.text));
        } catch {
          throw new PersistentReservationError('invalid-target');
        }
        if (!isContainer(value) || Array.isArray(value) !== Array.isArray(store.value)) {
          throw new PersistentReservationError('invalid-target');
        }
        if (PAGE.test(name)) {
          if (record.room.pageTransition?.format === 'yjs') {
            if (name !== 'page' || !isYPageValue(value) || value.g !== store.value.g) {
              throw new PersistentReservationError('invalid-target');
            }
          } else if (isYPageValue(value, { complete: false })) throw new PersistentReservationError('invalid-target');
        }
      }
      for (const tag of candidate.values()) {
        if (tag.ephemeral) continue;
        const store = record.room.stores.get(tag.name);
        if (!store || store.ephemeral) throw new PersistentReservationError('invalid-target');
      }
      const currentHeld = heldBy(record.room);
      const projected = structuredClone(record.room);
      reconcileFile(projected, record.key, html, {});
      for (const [name, store] of record.room.stores) {
        if (!store.ephemeral && !projected.stores.has(name)) throw new PersistentReservationError('budget');
      }
      let projectedRoomBytes = 0;
      for (const store of projected.stores.values()) {
        if (store.bytes > LIVE_LIMITS.storeBytes) throw new PersistentReservationError('budget');
        projectedRoomBytes += store.bytes;
      }
      if (projectedRoomBytes > LIVE_LIMITS.roomBytes) throw new PersistentReservationError('budget');
      const projectedHeld = heldBy(projected);
      if (used - currentHeld + projectedHeld > liveBytes) throw new PersistentReservationError('budget');
      const preclaim = Math.max(0, projectedHeld - currentHeld);
      used += preclaim;
      record.html = html;
      record.preclaim = preclaim;
      return Object.freeze({ html });
    },

    writtenPersistent(token, { html } = {}) {
      const record = heldRecord(token);
      if (record.html === null || html !== record.html) throw new PersistentReservationError('not-prepared');
      if (record.written) return record.result;
      if (rooms.get(record.key) !== record.room) throw new PersistentReservationError('room-changed');
      const { result, heldDelta } = reconcileFile(record.room, record.key, html, {});
      used += heldDelta;
      used -= record.preclaim;
      record.preclaim = 0;
      record.written = true;
      record.result = result;
      return result;
    },

    rekeyPersistent(token, newKey) {
      const record = heldRecord(token);
      if (typeof newKey !== 'string' || newKey === '' || newKey === record.key) {
        throw new PersistentReservationError('invalid-target');
      }
      if (rooms.has(newKey) || pageReservations.has(newKey) || persistentReservations.has(newKey)) {
        throw new PersistentReservationError('destination-exists');
      }
      rooms.delete(record.key);
      rooms.set(newKey, record.room);
      refused.delete(newKey);
      persistentReservations.delete(record.key);
      persistentReservations.set(newKey, record);
      record.key = newKey;
      record.room.key = newKey;
    },

    releasePersistent(token) {
      const record = persistentTokens.get(token);
      if (!record || record.token !== token) {
        if (releasedTokens.has(token)) return false;
        throw new PersistentReservationError('invalid-reservation');
      }
      persistentTokens.delete(token);
      releasedTokens.add(token);
      persistentReservations.delete(record.key);
      if (reservedNodes.get(String(record.nodeId)) === token) reservedNodes.delete(String(record.nodeId));
      used -= record.preclaim;
      record.preclaim = 0;
      if (record.drop) {
        const room = rooms.get(record.key);
        if (room) used -= heldBy(room);
        rooms.delete(record.key);
      }
      return true;
    },

    /** The room for key, or null. */
    get(key) {
      return rooms.get(key) || null;
    },

    /** The room for key, created from html when absent; null when the registry is full. */
    open(key, html, { nodeId = null } = {}) {
      let room = rooms.get(key);
      if (room) {
        room.emptySince = null;
        return room;
      }
      if (pageReservations.has(key) || persistentReservations.has(key) || rooms.size >= LIVE_LIMITS.rooms) return null;
      room = build(key, html, nodeId);
      const held = heldBy(room);
      if (used + held > liveBytes) {
        refused.delete(key);
        refused.set(key, { held, at: now() });
        if (refused.size > LIVE_LIMITS.rooms) refused.delete(refused.keys().next().value);
        return null;
      }
      refused.delete(key);
      used += held;
      rooms.set(key, room);
      return room;
    },

    /** Start an existing room over from html (an outside edit changed a live tag): new epoch, seq 0. */
    reset(key, html, { nodeId } = {}) {
      if (pageReservations.has(key) || persistentReservations.has(key)) return null;
      const previous = rooms.get(key);
      if (!previous) return null;
      const room = build(key, html, nodeId === undefined ? previous.nodeId : nodeId);
      used -= heldBy(previous);
      const held = heldBy(room);
      if (used + held > liveBytes) {
        rooms.delete(key);
        return null;
      }
      used += held;
      rooms.set(key, room);
      return room;
    },

    /**
     * The file for key was written. Per saved store, the file's value with the
     * room's moves since its base (baseOf) replayed on top becomes the store's
     * value, logged as a diff at the next seq, and `landed` says how far the
     * file now reaches. A base the log no longer reaches leaves the value alone
     * and asks for a rewrite (landed -1).
     * A value that no longer fits takes the store out of the room. Returns null
     * when nothing changed, else { room, valueChanged, landed: names whose
     * landed alone moved }.
     */
    fileWritten(key, html, { restored = false } = {}) {
      if (persistentReservations.has(key)) throw new PersistentReservationError('checkpointing');
      const room = rooms.get(key);
      if (!room) return null;
      const { result, heldDelta } = reconcileFile(room, key, html, { restored });
      used += heldDelta;
      return result;
    },

    drop(key) {
      const reservation = pageReservations.get(key);
      if (reservation) {
        reservation.drop = true;
        return;
      }
      const persistent = persistentReservations.get(key);
      if (persistent) {
        persistent.drop = true;
        return;
      }
      const room = rooms.get(key);
      if (room) used -= heldBy(room);
      rooms.delete(key);
    },

    /**
     * Apply one frame { name, n, ops, epoch? } from clientId, atomically.
     * connected: client ids on the stream; when given, only a connected sender may take the writer slot.
     * @returns {{ seq: number, epoch: string, name: string, ops: object[], writer: string, checkpoint: boolean }
     *   | { duplicate: true, seq: number, epoch: string }
     *   | { busy: true, reason?: 'budget' }
     *   | { stale: true, epoch: string }
     *   | { error: 'bad-frame' | 'unknown-store' | 'bad-op' | 'too-large', message?: string }}
     */
    apply(room, clientId, frame, { connected } = {}) {
      const current = rooms.get(room.key);
      if (current === room && persistentReservations.has(room.key)) return { error: 'checkpointing' };
      if (!isContainer(frame)) return { error: 'bad-frame' };
      if (current !== room) return { stale: true, epoch: current?.epoch ?? null };
      if (pageReservations.has(room.key) && PAGE.test(frame.name)) return { error: 'page-converting' };
      // Made for an earlier room: the tab resends its ops once it has this room's state.
      if ((PAGE.test(frame.name) || frame.epoch !== undefined) && frame.epoch !== room.epoch) return { stale: true, epoch: room.epoch };
      const transition = PAGE.test(frame.name) ? room.pageTransition : null;
      if (PAGE.test(frame.name) && (transition?.format === 'yjs' || frame.pageGeneration !== undefined) &&
        (frame.pageGeneration ?? null) !== (transition?.id ?? null)) return { error: 'page-generation' };
      const converted = transition?.format === 'yjs';
      if (converted && frame.name !== 'page') return { error: 'page-format' };
      const store = room.stores.get(frame.name);
      if (!store) return { error: 'unknown-store' };
      if (!Number.isInteger(frame.n) || frame.n < 1) return { error: 'bad-frame' };
      if (!Array.isArray(frame.ops) || frame.ops.length === 0 || frame.ops.length > LIVE_LIMITS.opsPerFrame) {
        return { error: 'bad-frame' };
      }
      const hybridSource = PAGE.test(frame.name) && isHybridPageValue(store.value);
      let ops;
      if (converted) {
        try {
          ops = frame.ops.map(validateOp);
        } catch (err) {
          return { error: 'bad-op', message: err.message };
        }
        if (ops.some((op) => op.path.length !== 2 || op.path[0] !== 'y' ||
          !(op.op === 'del' || (op.op === 'set' && typeof op.value === 'string')))) return { error: 'page-format' };
      }
      const nKey = frame.name + '\n' + clientId;
      const last = room.lastN.get(nKey);
      // Answered with the seq the sender's last frame landed at, so the tab knows
      // which applied state holds it.
      if (receiptHas(last, frame.n)) return { duplicate: true, seq: frame.n <= last.n ? last.seq : last.savedSeq, epoch: room.epoch };
      if ((room.retiredReceipts?.get(nKey) ?? 0) > (frame.receiptGeneration ?? 0)) return { error: 'receipt-expired' };
      // A receipt is kept while its sender is connected. Full, the least recently
      // used receipt of a sender no longer connected makes room; with none, a new
      // sender waits.
      let victim = null;
      if (!last && room.lastN.size >= LIVE_LIMITS.receipts) {
        for (const key of room.lastN.keys()) {
          if (pageReservations.get(room.key)?.receipts.has(key)) continue;
          const sender = key.slice(key.indexOf('\n') + 1);
          if (!connected || !connected.includes(sender)) {
            victim = key;
            break;
          }
        }
        if (victim === null) return { busy: true };
      }
      // In place, never a copy: each op's change is sized from the one slot it
      // touched, and a frame that is refused is taken back op by op.
      let value = store.value;
      let bytes = store.bytes;
      const done = [];
      const undo = () => {
        for (let i = done.length - 1; i >= 0; i--) undoTracked(done[i]);
      };
      try {
        ops ??= frame.ops.map(validateOp);
        for (const op of ops) {
          const rec = applyTracked(value, op);
          if (!rec) continue;
          if (op.op === 'set' && isDeepStrictEqual(rec.old, rec.at === null ? rec.root : rec.at[rec.key])) {
            undoTracked(rec);
            continue;
          }
          done.push(rec);
          bytes += sizeChange(rec, sizeOf, bytes);
          value = rec.root;
        }
      } catch (err) {
        undo();
        return { error: 'bad-op', message: err.message };
      }
      if (converted && !isYPageValue(value, { complete: false })) {
        undo();
        return { error: 'page-format' };
      }
      if (!converted && PAGE.test(frame.name) && (isYPageValue(value, { complete: false }) ||
        (hybridSource && (Object.hasOwn(value, 'y') || Object.hasOwn(value, 'v'))))) {
        undo();
        return { error: 'page-conversion-required' };
      }
      if (bytes > LIVE_LIMITS.storeBytes || roomBytes(room) - store.bytes + bytes > LIVE_LIMITS.roomBytes) {
        undo();
        return { error: 'too-large' };
      }
      const logged = done.length ? byteLength(JSON.stringify(ops)) : 0;
      const grows = done.length ? bytes - store.bytes + logAfter(store, logged) - store.logBytes : 0;
      const retiredBytes = victim === null ? 0 : receiptBytes(room.lastN.get(victim));
      if (grows > 0 && used + grows - retiredBytes > liveBytes) {
        undo();
        return { busy: true, reason: 'budget' };
      }
      if (victim !== null) used += retireReceipt(room, victim);
      used += grows;
      store.value = value;
      store.bytes = bytes;
      if (done.length) {
        room.seq += 1;
        store.last = room.seq;
        store.log.push({ seq: room.seq, ops, bytes: logged, from: clientId, n: frame.n });
        store.logBytes += logged;
        evict(store);
      }
      // Least recently used first, so the cap forgets a sender long gone.
      used += replaceReceipt(room, nKey, postReceipt(last, frame.n, room.seq));
      room.retiredReceipts?.delete(nKey);
      room.lastSentAt.set(clientId, now());
      room.seen.set(clientId, now());
      if (PAGE.test(frame.name) && typeof frame.adopted === 'string' && frame.adopted.length <= 64) room.adopted = frame.adopted;
      const writerGone = room.writer && connected && !connected.includes(room.writer);
      if ((!room.writer || writerGone) && (!connected || connected.includes(clientId))) room.writer = clientId;
      return { seq: room.seq, epoch: room.epoch, name: frame.name, ops, writer: room.writer, checkpoint: pressed(store), receiptGeneration: room.receiptGeneration ?? 0, ...(transition && { pageGeneration: transition.id }) };
    },

    /** Everything a joining tab needs, with clientId's own receipt per store. Values are the room's own objects: serialize, never mutate. With since in this room's epoch, moves carries each store's log entries after since.seq (null where the log no longer reaches back that far). */
    state(room, clientId = null, since = undefined) {
      const stores = {};
      for (const [name, s] of room.stores) {
        const seen = {};
        const mine = clientId ? room.lastN.get(name + '\n' + clientId) : null;
        if (mine) seen[clientId] = mine.n;
        stores[name] = { value: s.value, ephemeral: s.ephemeral, from: s.from, landed: s.landed, floor: s.floor, last: s.last, seen, ...(mine?.saved?.length && { saved: mine.saved }) };
      }
      // A client's own read (since is its { epoch, seq }, or null for a first
      // read) carries moves: those after its seq in its own epoch, else this
      // epoch's from its start, so a tab rejoining after a room loss places the
      // heals other tabs already sent by their steps. A broadcast passes no since
      // and carries none.
      const provenance = { provenanceVersion: 2, receiptGeneration: room.receiptGeneration ?? 0 };
      if (room.pageTransition) {
        provenance.pageTransition = pageTransitionState(room.pageTransition, clientId);
      }
      if (since === undefined) return { epoch: room.epoch, seq: room.seq, writer: room.writer, stores, ...provenance };
      const from = since && since.epoch === room.epoch && Number.isInteger(since.seq) ? since.seq : 0;
      const moves = Object.fromEntries([...room.stores.keys()].map((name) => [name, null]));
      let budget = LIVE_LIMITS.movesBytes - byteLength(JSON.stringify(moves));
      for (const [name, s] of room.stores) {
        const list = movesSince(s, from);
        const bytes = list ? 2 + list.reduce((sum, move) => sum + byteLength(JSON.stringify(move)) + 1, 0) - (list.length ? 1 : 0) - 4 : 0;
        if (list && bytes > budget) {
          moves[name] = null;
          continue;
        }
        budget -= bytes;
        moves[name] = list;
      }
      return { epoch: room.epoch, seq: room.seq, writer: room.writer, stores, moves, ...provenance };
    },

    /** clientId read the room's state: it takes part, and may be elected writer. */
    touch(room, clientId) {
      if (clientId) room.seen.set(clientId, now());
    },

    /**
     * clientId left. When it was the writer, elect the remaining participant (a
     * connected client that posted or read the state) that sent most recently
     * (ties: the first in remaining), or nobody.
     * @param {string[]} remaining - client ids of editors still connected
     * @returns {{ writerChanged: boolean, writer: string | null }}
     */
    leave(room, clientId, remaining) {
      if (!remaining.length) room.emptySince = now();
      if (room.writer !== clientId) return { writerChanged: false, writer: room.writer };
      let best = null;
      let bestAt = -1;
      for (const id of remaining.filter((candidate) => room.seen.has(candidate))) {
        const at = room.lastSentAt.get(id) ?? 0;
        if (at > bestAt) {
          best = id;
          bestAt = at;
        }
      }
      room.writer = best;
      return { writerChanged: true, writer: best };
    },

    /**
     * Delete rooms that have been empty for retainMs or longer, and forget the
     * election records of senders that are no longer connected and have not been
     * seen for that long. Their receipts stay as long as the room: a sender that
     * comes back and resends gets a duplicate, never a second apply.
     * @param {(key: string) => string[]} [connectedOf] - client ids on a room's stream
     * @param {{ mayExpire?: (room: object) => boolean }} [options] - mayExpire refuses one room's
     *   deletion; a dirty room is retained for its checkpoint rather than retired unsaved
     */
    sweep(connectedOf = () => [], { mayExpire = () => true } = {}) {
      const t = now();
      for (const [key, room] of rooms) {
        if (!roomIsDirty(room) && mayExpire(room) && !pageReservations.has(key) && !persistentReservations.has(key) && room.emptySince !== null && t - room.emptySince >= LIVE_LIMITS.retainMs) {
          used -= heldBy(room);
          rooms.delete(key);
          continue;
        }
        const connected = connectedOf(key);
        for (const [id, at] of room.seen) {
          if (id === room.writer || connected.includes(id) || t - at < LIVE_LIMITS.retainMs) continue;
          room.seen.delete(id);
          room.lastSentAt.delete(id);
        }
      }
    },

    /**
     * The document this room holds now lives at another path (it was moved): the room follows it, so
     * its frames, its dirty state and its checkpoint keep naming one document instead of a stale
     * address. Refused when there is no room at `from`, when `to` is already another room's, or when
     * `from` is under a persistent reservation (that owner moves it with rekeyPersistent).
     */
    rekey(from, to) {
      const room = rooms.get(from);
      if (!room) return false;
      if (from === to) return true;
      if (rooms.has(to) || persistentReservations.has(from)) return false;
      rooms.delete(from);
      room.key = to;
      rooms.set(to, room);
      return true;
    },

    /**
     * The file was confirmed to hold this capture's values (`isCheckpointCurrent`), so per captured
     * store `landed` catches up to the seq the capture pinned. A store with later frames keeps them
     * dirty: only what the file really holds stops being unsaved.
     */
    markSaved(room, capture) {
      if (rooms.get(room.key) !== room) return false;
      let changed = false;
      for (const { name } of capture.stores) {
        const store = room.stores.get(name);
        if (!store || store.ephemeral || store.last > capture.seq) continue;
        if (store.landed === store.last) continue;
        store.landed = store.last;
        changed = true;
      }
      return changed;
    },

    /** Every room's key. */
    keys() {
      return [...rooms.keys()];
    },

    size() {
      return rooms.size;
    },

    /** The bytes every room holds, counted against LIVE_LIMITS.liveBytes. */
    used() {
      return used;
    },
  };
}
