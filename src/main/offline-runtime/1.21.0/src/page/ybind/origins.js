import * as Y from "../../vendor/yjs.vendor.js";

export const ORIGINS_ORIGIN = "page-origins";
export const UNDO_OVERLAP_ORIGIN = "page-undo-overlap-repair";

export const spanKey = (client, clock) => JSON.stringify(["span", client, clock]);
export const aliasKey = (client, clock) => JSON.stringify(["alias", client, clock]);
export const boundaryKey = (client, clock) => JSON.stringify(["boundary", client, clock]);

const BOUNDARY_KINDS = ["copy", "removed", "restore"];
const DIGITS = /^(?:0|[1-9]\d*)$/;
const idKey = (client, clock) => `${client}.${clock}`;
const isClock = (value) => Number.isSafeInteger(value) && value >= 0;
const isLength = (value) => Number.isSafeInteger(value) && value > 0;
const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const conflicting = (key) => new Error(`Conflicting immutable origin record: ${key}`);

const isSourceKey = (value) => {
  if (typeof value !== "string") return false;
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) return false;
  const client = value.slice(0, dot), clock = value.slice(dot + 1);
  return DIGITS.test(client) && DIGITS.test(clock) && isClock(Number(client)) && isClock(Number(clock));
};

const boundaryRecord = (value) => {
  if (!isPlain(value)) return null;
  for (const field of Object.keys(value)) if (field !== "blockId" && field !== "kind" && field !== "recoveryOf") return null;
  if (typeof value.blockId !== "string" || !value.blockId) return null;
  if (!BOUNDARY_KINDS.includes(value.kind)) return null;
  if (value.recoveryOf !== undefined && !isSourceKey(value.recoveryOf)) return null;
  return value.recoveryOf === undefined ? { blockId: value.blockId, kind: value.kind } : { blockId: value.blockId, kind: value.kind, recoveryOf: value.recoveryOf };
};

const sameBoundary = (a, b) => a.blockId === b.blockId && a.kind === b.kind && a.recoveryOf === b.recoveryOf;

// The keys walkFlow reads boundary and alias positions from: any key that parses to
// ["boundary" | "alias", client, clock], whatever its value.
const markerKey = (key) => {
  let parts;
  try { parts = JSON.parse(key); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 3 || (parts[0] !== "boundary" && parts[0] !== "alias")) return null;
  return isClock(parts[1]) && isClock(parts[2]) ? parts : null;
};

const recordKey = (key) => {
  if (typeof key !== "string" || key.charCodeAt(0) !== 91) return null;
  let parts;
  try { parts = JSON.parse(key); } catch { return null; }
  if (!Array.isArray(parts) || parts.length !== 3) return null;
  if (parts[0] !== "span" && parts[0] !== "alias" && parts[0] !== "boundary") return null;
  return isClock(parts[1]) && isClock(parts[2]) ? parts : null;
};

export function createOriginIndex(origins) {
  const spans = new Map();
  const aliases = new Map();
  const aliasClocks = new Map();
  const boundaries = new Map();

  const lower = (list, clock) => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].clock < clock) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const lowerClock = (list, clock) => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < clock) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const markAlias = (client, clock, present) => {
    const list = aliasClocks.get(client) ?? [];
    const at = lowerClock(list, clock);
    const there = list[at] === clock;
    if (present && !there) list.splice(at, 0, clock);
    else if (!present && there) list.splice(at, 1);
    if (list.length) aliasClocks.set(client, list);
    else aliasClocks.delete(client);
  };
  // Boundary and alias keys in the map's key order (Yjs keeps a key where it was first
  // written), and each client's clocks that have one, sorted, for walkFlow.
  const markerRecords = [];
  const markerEntries = new Map();
  const markerCounts = new Map();
  const markerClocks = new Map();
  const trackMarker = (key, live) => {
    let entry = markerEntries.get(key);
    if (entry === undefined) {
      const parts = markerKey(key);
      entry = parts ? { kind: parts[0], client: parts[1], clock: parts[2], live: false } : null;
      markerEntries.set(key, entry);
      if (entry) markerRecords.push(entry);
    }
    if (!entry || entry.live === live) return;
    entry.live = live;
    const counts = markerCounts.get(entry.client) ?? markerCounts.set(entry.client, new Map()).get(entry.client);
    const list = markerClocks.get(entry.client) ?? markerClocks.set(entry.client, []).get(entry.client);
    const n = (counts.get(entry.clock) ?? 0) + (live ? 1 : -1);
    if (n) counts.set(entry.clock, n);
    else counts.delete(entry.clock);
    const at = lowerClock(list, entry.clock);
    if (live && n === 1) list.splice(at, 0, entry.clock);
    else if (!live && n === 0) list.splice(at, 1);
    if (!list.length) { markerClocks.delete(entry.client); markerCounts.delete(entry.client); }
  };
  const apply = (key, value) => {
    trackMarker(key, value !== undefined);
    const parts = recordKey(key);
    if (!parts) return;
    const [kind, client, clock] = parts;
    if (kind === "alias") {
      const valid = Boolean(value && isClock(value.sourceClient) && isClock(value.sourceClock));
      if (valid) aliases.set(idKey(client, clock), { client: value.sourceClient, clock: value.sourceClock });
      else aliases.delete(idKey(client, clock));
      markAlias(client, clock, valid);
      return;
    }
    if (kind === "boundary") {
      const record = boundaryRecord(value);
      if (record) boundaries.set(idKey(client, clock), record);
      else boundaries.delete(idKey(client, clock));
      return;
    }
    const list = spans.get(client) ?? [];
    const at = lower(list, clock);
    if (list[at]?.clock === clock) list.splice(at, 1);
    if (value && isLength(value.length) && isClock(value.sourceClient) && isClock(value.sourceClock)) {
      list.splice(lower(list, clock), 0, { client, clock, length: value.length, sourceClient: value.sourceClient, sourceClock: value.sourceClock });
    }
    if (list.length) spans.set(client, list);
    else spans.delete(client);
  };
  for (const key of origins._map.keys()) apply(key, origins.get(key));
  const observer = (event) => { for (const key of event.keysChanged) apply(key, origins.get(key)); };
  origins.observe(observer);

  const hasAlias = (client, clock) => {
    const list = aliasClocks.get(client);
    return list !== undefined && list[lowerClock(list, clock)] === clock;
  };

  const resolve = (id) => {
    const alias = hasAlias(id.client, id.clock) ? aliases.get(idKey(id.client, id.clock)) : undefined;
    if (alias) return { client: alias.client, clock: alias.clock };
    const list = spans.get(id.client);
    if (!list) return { client: id.client, clock: id.clock };
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].clock <= id.clock) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    if (found < 0) return { client: id.client, clock: id.clock };
    const record = list[found];
    const offset = id.clock - record.clock;
    if (offset >= record.length) return { client: id.client, clock: id.clock };
    return { client: record.sourceClient, clock: record.sourceClock + offset };
  };

  const resolveRange = (client, clock, length) => {
    const out = [];
    const push = (sourceClient, sourceClock, size) => {
      const last = out[out.length - 1];
      if (last && last.client === sourceClient && last.clock + last.length === sourceClock) last.length += size;
      else out.push({ client: sourceClient, clock: sourceClock, length: size });
    };
    const list = spans.get(client) ?? [];
    const marks = aliasClocks.get(client) ?? [];
    const end = clock + length;
    let s = lower(list, clock + 1) - 1, a = lowerClock(marks, clock), at = clock;
    while (at < end) {
      if (a < marks.length && marks[a] === at) {
        const target = aliases.get(idKey(client, at));
        push(target.client, target.clock, 1);
        at += 1;
        a += 1;
      } else {
        let stop = end;
        if (a < marks.length && marks[a] < stop) stop = marks[a];
        if (s + 1 < list.length && list[s + 1].clock < stop) stop = list[s + 1].clock;
        const span = s >= 0 ? list[s] : null;
        if (span && at < span.clock + span.length) {
          stop = Math.min(stop, span.clock + span.length);
          push(span.sourceClient, span.sourceClock + at - span.clock, stop - at);
        } else push(client, at, stop - at);
        at = stop;
      }
      while (s + 1 < list.length && list[s + 1].clock <= at) s += 1;
    }
    return out;
  };

  const boundaryOf = (id) => {
    if (!id || !isClock(id.client) || !isClock(id.clock)) return null;
    if (!hasAlias(id.client, id.clock)) {
      const record = boundaries.get(idKey(id.client, id.clock));
      return record ? { ...record } : null;
    }
    let key = idKey(id.client, id.clock);
    const seen = new Set();
    while (!seen.has(key)) {
      seen.add(key);
      const alias = aliases.get(key);
      if (!alias) break;
      key = idKey(alias.client, alias.clock);
    }
    if (seen.has(key) && aliases.has(key)) return null;
    const record = boundaries.get(key);
    return record ? { ...record } : null;
  };

  const writeSpan = (client, clock, value) => {
    const key = spanKey(client, clock);
    const old = origins.get(key);
    if (old !== undefined && (old.length !== value.length || old.sourceClient !== value.sourceClient || old.sourceClock !== value.sourceClock)) throw conflicting(key);
    const list = spans.get(client) ?? [];
    const at = lower(list, clock);
    for (const other of [list[at - 1], list[at]]) {
      if (other && other.clock !== clock && other.clock < clock + value.length && clock < other.clock + other.length) throw conflicting(key);
    }
    if (old === undefined) origins.set(key, value);
  };

  const recordSpans = (entries) => {
    const run = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const value = { length: run.length, sourceClient: first.source.client, sourceClock: first.source.clock };
      if (!isClock(value.sourceClock + value.length - 1)) throw new Error(`Unsafe origin span: ${spanKey(first.dest.client, first.dest.clock)}`);
      writeSpan(first.dest.client, first.dest.clock, value);
      run.length = 0;
    };
    for (const entry of entries) {
      if (!entry?.dest || !entry?.source) throw new Error("Invalid origin destination");
      const dest = entry.dest, source = entry.source;
      if (!isClock(dest.client) || !isClock(dest.clock) || !isClock(source.client) || !isClock(source.clock)) throw new Error("Invalid origin destination");
      const flat = resolve(source);
      const prev = run[run.length - 1];
      if (prev && prev.dest.client === dest.client && prev.dest.clock + 1 === dest.clock && prev.source.client === flat.client && prev.source.clock + 1 === flat.clock) run.push({ dest, source: flat });
      else { flush(); run.push({ dest, source: flat }); }
    }
    flush();
  };

  const recordAlias = (dest, source) => {
    if (!dest || !source || !isClock(dest.client) || !isClock(dest.clock) || !isClock(source.client) || !isClock(source.clock)) throw new Error("Invalid origin destination");
    const flat = resolve(source);
    const key = aliasKey(dest.client, dest.clock);
    const old = origins.get(key);
    if (old !== undefined && (old.sourceClient !== flat.client || old.sourceClock !== flat.clock)) throw conflicting(key);
    if (old === undefined) origins.set(key, { sourceClient: flat.client, sourceClock: flat.clock });
  };

  const recordBoundary = (dest, value) => {
    if (!dest || !isClock(dest.client) || !isClock(dest.clock)) throw new Error("Invalid origin destination");
    const record = boundaryRecord(value);
    if (!record) throw new Error(`Invalid boundary record: ${boundaryKey(dest.client, dest.clock)}`);
    const key = boundaryKey(dest.client, dest.clock);
    const existing = origins.get(key);
    if (existing === undefined) { origins.set(key, record); return; }
    const previous = boundaryRecord(existing);
    if (!previous || !sameBoundary(previous, record)) throw conflicting(key);
  };

  // null while a transaction that wrote origin records has not settled: the observer has
  // not seen those keys yet, and walkFlow then reads the map's keys itself.
  const markers = () => {
    for (const t of origins.doc?._transactionCleanups ?? []) if (t.changed.has(origins)) return null;
    return { records: markerRecords, clocks: markerClocks };
  };

  return {
    origins, resolve, resolveRange, recordSpans, recordAlias, recordBoundary, boundaryOf, markers,
    get size() { return origins.size; },
    dispose() { origins.unobserve(observer); },
  };
}

export function unitIds(flow, from, to) {
  const out = [];
  let at = 0;
  for (let item = flow._start; item && at < to; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const start = at;
    at += item.length;
    if (at <= from) continue;
    const lo = Math.max(0, from - start);
    const hi = Math.min(item.length, to - start);
    for (let offset = lo; offset < hi; offset++) out.push({ client: item.id.client, clock: item.id.clock + offset });
  }
  return out;
}

const coversOriginal = (records, self, id) => records.some((record) => {
  if (record.actor === self || record.client !== id.client) return false;
  if (id.clock < record.clock || id.clock >= record.clock + record.length) return false;
  return record.sv.some(([client, clock]) => client === id.client && clock > id.clock);
});

const livePhysicalIndex = (flow, id) => {
  let at = 0;
  for (let item = flow._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    if (item.id.client === id.client && item.id.clock <= id.clock && id.clock < item.id.clock + item.length) return at + id.clock - item.id.clock;
    at += item.length;
  }
  return null;
};

const repairOverlaps = (pd, dests) => {
  const indexes = [];
  for (const dest of dests) {
    const at = livePhysicalIndex(pd.flow, dest);
    if (at !== null) indexes.push(at);
  }
  indexes.sort((a, b) => a - b);
  const ranges = [];
  for (const at of indexes) {
    const last = ranges[ranges.length - 1];
    if (last && at <= last[1]) last[1] = Math.max(last[1], at + 1);
    else ranges.push([at, at + 1]);
  }
  for (let i = ranges.length - 1; i >= 0; i--) {
    const [from, to] = ranges[i];
    if (to > from) pd.flow.delete(from, to - from);
  }
};

export function installUndoOrigins(pd, um, index = createOriginIndex(pd.origins), textDeletes = () => []) {
  const hook = (transaction) => {
    if (transaction.origin !== um || !um.currStackItem) return;
    const spans = [];
    const aliases = [];
    const repairs = [];
    const records = textDeletes(pd.gone);
    Y.iterateDeletedStructs(transaction, um.currStackItem.deletions, (item) => {
      if (!(item instanceof Y.Item) || item.parent !== pd.flow || !item.countable || !item.redone) return;
      const marker = item.content instanceof Y.ContentEmbed && item.content.embed?.b !== undefined;
      for (let offset = 0; offset < item.length; offset++) {
        const original = { client: item.id.client, clock: item.id.clock + offset };
        const source = index.resolve(original);
        let dest = { client: item.redone.client, clock: item.redone.clock + offset };
        let live = Y.getItem(pd.ydoc.store, dest);
        while (live instanceof Y.Item && live.redone) {
          dest = { client: live.redone.client, clock: live.redone.clock + dest.clock - live.id.clock };
          live = Y.getItem(pd.ydoc.store, dest);
        }
        if (!(live instanceof Y.Item) || live.deleted) continue;
        if (dest.clock < (transaction.beforeState.get(dest.client) ?? 0)) continue;
        if (!marker && coversOriginal(records, pd.ydoc.clientID, original)) { repairs.push(dest); continue; }
        (marker ? aliases : spans).push({ dest, source });
      }
    });
    if (spans.length || aliases.length) pd.ydoc.transact(() => {
      if (spans.length) index.recordSpans(spans);
      for (const alias of aliases) index.recordAlias(alias.dest, alias.source);
    }, ORIGINS_ORIGIN);
    if (repairs.length) pd.ydoc.transact(() => repairOverlaps(pd, repairs), UNDO_OVERLAP_ORIGIN);
  };
  pd.ydoc.on("beforeObserverCalls", hook);
  return () => pd.ydoc.off("beforeObserverCalls", hook);
}
