const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER = /^[1-9]\d{0,15}$/;
export const RANGE_LIMIT = 256;
export const RECEIPT_LIMIT = 4096;

const integer = (text) => NUMBER.test(text) && Number.isSafeInteger(Number(text));

export function unionRanges(...sets) {
  const clients = new Map();
  for (const set of sets) for (const [client, ranges] of set ?? []) {
    if (!clients.has(client)) clients.set(client, []);
    clients.get(client).push(...ranges.map(([lo, hi]) => [lo, hi]));
  }
  return [...clients].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([client, ranges]) => {
    const out = [];
    for (const [lo, hi] of ranges.sort((a, b) => a[0] - b[0])) {
      const last = out[out.length - 1];
      if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
      else out.push([lo, hi]);
    }
    return [client, out];
  }).filter(([, ranges]) => ranges.length);
}

export const rangeCount = (set) => set.reduce((n, [, ranges]) => n + ranges.length, 0);
export const hasNumber = (ranges, n) => !!ranges?.some(([lo, hi]) => lo <= n && n <= hi);
export const contains = (set, client, n) => hasNumber(set?.find(([id]) => id === client)?.[1], n);
export const identitySet = ([client, n]) => [[client, [[n, n]]]];
export const frameSet = (by) => by?.v === 2 ? by.frames : by ? [[by.client, [[1, by.n]]]] : [];
export const descendants = (by) => by?.v === 2 ? unionRanges(by.ancestors, identitySet(by.capture)) : [];

function parseRanges(text) {
  if (!text) return [];
  const out = [];
  let count = 0;
  for (const part of text.split(';')) {
    const fields = part.split(':');
    if (fields.length !== 2 || !CLIENT.test(fields[0]) || !fields[1]) return null;
    const ranges = [];
    for (const raw of fields[1].split(',')) {
      if (++count > RANGE_LIMIT) return null;
      const ends = raw.split('-');
      if (ends.length > 2 || !ends.every(integer)) return null;
      const lo = Number(ends[0]), hi = Number(ends[1] ?? ends[0]);
      if (hi < lo) return null;
      ranges.push([lo, hi]);
    }
    out.push([fields[0], ranges]);
  }
  return unionRanges(out);
}

function printRanges(set) {
  return unionRanges(set).map(([client, ranges]) => `${client}:${ranges.map(([lo, hi]) => lo === hi ? String(lo) : `${lo}-${hi}`).join(',')}`).join(';');
}

export function parseBy(text) {
  if (typeof text !== 'string' || text.length > 32768) return null;
  if (!text.startsWith('v2|')) {
    const m = /^([A-Za-z0-9_-]{1,64}):([1-9]\d{0,15})$/.exec(text);
    return m && integer(m[2]) ? { client: m[1], n: Number(m[2]) } : null;
  }
  const parts = text.split('|');
  if (parts.length !== 4) return null;
  const frames = parseRanges(parts[1]), ancestors = parseRanges(parts[2]);
  const capture = /^([A-Za-z0-9_-]{1,64}):([1-9]\d{0,15})$/.exec(parts[3]);
  if (!frames || !ancestors || !capture || !integer(capture[2])) return null;
  if (rangeCount(frames) + rangeCount(ancestors) + 1 > RANGE_LIMIT) return null;
  const id = [capture[1], Number(capture[2])];
  if (contains(ancestors, ...id)) return null;
  return { v: 2, frames, ancestors, capture: id };
}

export function formatBy(by) {
  const text = `v2|${printRanges(by.frames)}|${printRanges(by.ancestors)}|${by.capture[0]}:${by.capture[1]}`;
  return parseBy(text) ? text : null;
}

export function receiptHas(receipt, n) {
  return !!receipt && (n <= receipt.n || hasNumber(receipt.saved, n));
}

export function receiptBytes(receipt) {
  return receipt?.saved ? JSON.stringify({ saved: receipt.saved, savedSeq: receipt.savedSeq }).length : 0;
}

export function replaceReceipt(room, key, next) {
  const delta = receiptBytes(next) - receiptBytes(room.lastN.get(key));
  room.receiptBytes = (room.receiptBytes ?? 0) + delta;
  room.lastN.delete(key);
  room.lastN.set(key, next);
  return delta;
}

export function retireReceipt(room, key) {
  const bytes = receiptBytes(room.lastN.get(key));
  room.lastN.delete(key);
  room.receiptBytes = (room.receiptBytes ?? 0) - bytes;
  room.receiptGeneration = (room.receiptGeneration ?? 0) + 1;
  room.retiredReceipts ??= new Map();
  room.retiredReceipts.delete(key);
  room.retiredReceipts.set(key, room.receiptGeneration);
  if (room.retiredReceipts.size > RECEIPT_LIMIT) room.retiredReceipts.delete(room.retiredReceipts.keys().next().value);
  return -bytes;
}

export function saveReceipt(room, key, ranges, seq, limit, retained = null) {
  const last = room.lastN.get(key);
  if (!last && room.lastN.size >= limit) {
    let victim;
    for (const candidate of room.lastN.keys()) {
      if (retained?.has(candidate)) continue;
      victim = candidate;
      break;
    }
    if (victim === undefined) return false;
    retireReceipt(room, victim);
  }
  const next = last ? { ...last } : { n: 0, seq: 0 };
  const kept = unionRanges([['r', next.saved ?? []]], [['r', ranges]])[0]?.[1]
    .filter(([, hi]) => hi > next.n).map(([lo, hi]) => [Math.max(lo, next.n + 1), hi]) ?? [];
  if (kept.length > RANGE_LIMIT) {
    retireReceipt(room, key);
    next.saved = kept.slice(-RANGE_LIMIT);
    next.savedSeq = Math.max(next.savedSeq ?? 0, seq);
  } else {
    if (kept.length) {
      next.saved = kept;
      next.savedSeq = Math.max(next.savedSeq ?? 0, seq);
    } else {
      delete next.saved;
      delete next.savedSeq;
    }
  }
  replaceReceipt(room, key, next);
  return true;
}

export function postReceipt(last, n, seq) {
  const saved = (last?.saved ?? []).filter(([, hi]) => hi > n).map(([lo, hi]) => [Math.max(lo, n + 1), hi]);
  return { n, seq, ...(saved.length && { saved, savedSeq: last.savedSeq }) };
}
