import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { attrKeys, defaultOf, sameJson } from "./layout.js";
import { marksAttrs, marksFromAttributes } from "./marks.js";
import { createOriginIndex } from "./origins.js";
import { createProjectionMap } from "./projection-map.js";
import { walk } from "./walk.js";
import { resolveTableFields } from "./table.js";
import { resolveBoardFields } from "./board.js";

export const REMOVE = "remove";
export const RESTORE = "restore";
export const COPY_ACTIVE = "copy-active";
export const COPY_LOST = "copy-lost";
export const ATTR = "attr";
export const TEXT_DELETE = "text-delete";

export class RecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RecoveryError";
  }
}

const fail = (message) => { throw new RecoveryError(message); };
const isClock = (value) => Number.isSafeInteger(value) && value >= 0;
const isLength = (value) => Number.isSafeInteger(value) && value > 0;
const DIGITS = /^(?:0|[1-9]\d*)$/;
const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => (value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value)));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedList = (list) => [...list].sort(compare);

export const physicalKeyOf = (id) => `${id.client}.${id.clock}`;
export const authorKey = (client) => JSON.stringify(["author", client]);
export const removeKey = (sourceKey, operationId) => JSON.stringify([REMOVE, sourceKey, operationId]);
export const restoreKey = (sourceKey, operationId) => JSON.stringify([RESTORE, sourceKey, operationId]);
export const copyActiveKey = (sourceKey) => JSON.stringify([COPY_ACTIVE, sourceKey]);
export const copyLostKey = (sourceKey) => JSON.stringify([COPY_LOST, sourceKey]);
export const textDeleteKey = (client, clock, operationId) => JSON.stringify([TEXT_DELETE, client, clock, operationId]);
export const attrKey = (sourceKey, field) => JSON.stringify([ATTR, sourceKey, field]);

export function parsePhysicalKey(key) {
  if (typeof key !== "string") return null;
  const dot = key.indexOf(".");
  if (dot < 1 || dot === key.length - 1) return null;
  const left = key.slice(0, dot), right = key.slice(dot + 1);
  if (!DIGITS.test(left) || !DIGITS.test(right)) return null;
  const client = Number(left), clock = Number(right);
  return isClock(client) && isClock(clock) ? { client, clock } : null;
}

const checkFields = (value, allowed, key) => {
  if (!isPlain(value)) fail(`Invalid gone record: ${key}`);
  for (const field of Object.keys(value)) if (!allowed.includes(field)) fail(`Unsupported gone field ${field} in ${key}`);
};

const parseVector = (sv, key) => {
  if (!Array.isArray(sv)) fail(`Invalid state vector in ${key}`);
  const out = [];
  let previous = -1;
  for (const pair of sv) {
    if (!Array.isArray(pair) || pair.length !== 2) fail(`Invalid state vector in ${key}`);
    const [client, clock] = pair;
    if (!isClock(client) || !isClock(clock) || client <= previous) fail(`Invalid state vector in ${key}`);
    previous = client;
    out.push([client, clock]);
  }
  return out;
};

const isRemovalKey = (key) => {
  if (typeof key !== "string") return false;
  if (key.charCodeAt(0) !== 91) return parsePhysicalKey(key) !== null;
  let parts;
  try { parts = JSON.parse(key); } catch { return false; }
  if (!Array.isArray(parts) || !parsePhysicalKey(parts[1])) return false;
  if (parts[0] === REMOVE) return parts.length === 3 && typeof parts[2] === "string" && parts[2] !== "";
  return (parts[0] === COPY_ACTIVE || parts[0] === COPY_LOST) && parts.length === 2;
};

const recordOf = (value, key, out) => {
  if (key.charCodeAt(0) === 91) {
    let parts = null;
    try { parts = JSON.parse(key); } catch { fail(`Malformed gone key: ${key}`); }
    if (!Array.isArray(parts) || typeof parts[0] !== "string") fail(`Malformed gone key: ${key}`);
    if (parts[0] === REMOVE) {
      if (parts.length !== 3 || typeof parts[2] !== "string" || !parts[2]) fail(`Malformed gone key: ${key}`);
      const source = parsePhysicalKey(parts[1]);
      if (!source) fail(`Malformed gone key: ${key}`);
      checkFields(value, ["blockId", "end", "sv"], key);
      if (typeof value.blockId !== "string" || !value.blockId) fail(`Invalid removal record: ${key}`);
      const end = value.end ?? null;
      if (end !== null && !parsePhysicalKey(end)) fail(`Invalid removal record: ${key}`);
      out.removals.push({ key, sourceKey: parts[1], source, operationId: parts[2], blockId: value.blockId, end, sv: parseVector(value.sv, key), legacy: false });
      return;
    }
    if (parts[0] === RESTORE) {
      if (parts.length !== 3 || typeof parts[2] !== "string" || !parts[2]) fail(`Malformed gone key: ${key}`);
      if (!parsePhysicalKey(parts[1])) fail(`Malformed gone key: ${key}`);
      checkFields(value, ["covers", "baseline"], key);
      if (!Array.isArray(value.covers) || value.covers.some((cover) => !isRemovalKey(cover))) fail(`Invalid restore record: ${key}`);
      const baseline = value.baseline ?? {};
      checkFields(baseline, ["type", "attrs"], key);
      if (typeof baseline.type !== "string" || !isPlain(baseline.attrs)) fail(`Invalid restore record: ${key}`);
      out.restores.push({ key, sourceKey: parts[1], operationId: parts[2], covers: sortedList(value.covers), baseline: { type: baseline.type, attrs: copy(baseline.attrs) } });
      return;
    }
    if (parts[0] === COPY_ACTIVE) {
      if (parts.length !== 2 || !parsePhysicalKey(parts[1])) fail(`Malformed gone key: ${key}`);
      if (value !== true) fail(`Invalid copy-active record: ${key}`);
      out.copyActive.add(parts[1]);
      return;
    }
    if (parts[0] === TEXT_DELETE) {
      if (parts.length !== 4 || !isClock(parts[1]) || !isClock(parts[2]) || typeof parts[3] !== "string" || !parts[3]) fail(`Malformed gone key: ${key}`);
      checkFields(value, ["length", "actor", "sv"], key);
      if (!isLength(value.length) || !isClock(parts[2] + value.length - 1)) fail(`Invalid text-delete record: ${key}`);
      if (!isClock(value.actor)) fail(`Invalid text-delete record: ${key}`);
      out.textDeletes.push({ key, client: parts[1], clock: parts[2], length: value.length, actor: value.actor, sv: parseVector(value.sv, key) });
      return;
    }
    if (parts[0] === ATTR) {
      if (parts.length !== 3 || !parsePhysicalKey(parts[1]) || typeof parts[2] !== "string" || !parts[2]) fail(`Malformed gone key: ${key}`);
      if (value === undefined) fail(`Invalid attribute override: ${key}`);
      const fields = out.attrs.get(parts[1]) ?? new Map();
      fields.set(parts[2], copy(value));
      out.attrs.set(parts[1], fields);
      return;
    }
    fail(`Unsupported gone record: ${key}`);
  }
  const source = parsePhysicalKey(key);
  if (!source) fail(`Malformed gone key: ${key}`);
  checkFields(value, ["b", "e"], key);
  if (typeof value.b !== "string" || !value.b) fail(`Invalid gone record: ${key}`);
  const end = value.e ?? null;
  if (end !== null && !parsePhysicalKey(end)) fail(`Invalid gone record: ${key}`);
  out.removals.push({ key, sourceKey: key, source, operationId: null, blockId: value.b, end, sv: [], legacy: true });
};

const emptyIntents = () => ({ removals: [], restores: [], copyActive: new Set(), attrs: new Map(), textDeletes: [] });

const frozen = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) frozen(value[key]);
    Object.freeze(value);
  }
  return value;
};

const parsedRecord = (value, key) => {
  const out = emptyIntents();
  try {
    recordOf(value, key, out);
  } catch (error) {
    if (!(error instanceof RecoveryError)) throw error;
    return null;
  }
  for (const list of [out.removals, out.restores, out.textDeletes]) for (const record of list) frozen(record);
  for (const fields of out.attrs.values()) for (const fieldValue of fields.values()) frozen(fieldValue);
  return out;
};

const parsedGone = new WeakMap();

const foldRecord = (out, record) => {
  for (const removal of record.removals) out.removals.push(removal);
  for (const restore of record.restores) out.restores.push(restore);
  for (const textDelete of record.textDeletes) out.textDeletes.push(textDelete);
  for (const sourceKey of record.copyActive) out.copyActive.add(sourceKey);
  for (const [sourceKey, fields] of record.attrs) {
    const into = out.attrs.get(sourceKey) ?? new Map();
    for (const [field, fieldValue] of fields) into.set(field, fieldValue);
    out.attrs.set(sourceKey, into);
  }
};

// A document's gone map parsed once per write, in the map's own key order (Yjs keeps a key
// where it was first written, through deletes and rewrites). The observer keeps it current
// as transactions settle; keys a transaction that has not settled yet wrote are read again
// from the map. A new key adds its record to the totals; any other change rebuilds them
// from the records kept. Every call gets its own lists, as a fresh parse would.
const goneIndexes = new WeakMap();
const goneIndexOf = (gone) => {
  const known = goneIndexes.get(gone);
  if (known) return known;
  const entries = new Map();
  let totals = null;
  let added = [];
  const update = (key) => {
    const live = gone.has(key);
    const value = live ? gone.get(key) : undefined;
    const entry = entries.get(key);
    if (entry && entry.live === live && entry.value === value) return;
    const record = live ? parsedRecord(value, key) : null;
    if (!entry) {
      const next = { live, value, record };
      entries.set(key, next);
      if (live && record && totals) added.push(record);
      return;
    }
    entry.live = live;
    entry.value = value;
    entry.record = record;
    totals = null;
  };
  for (const key of gone._map.keys()) update(key);
  gone.observe((event) => { for (const key of event.keysChanged) update(key); });
  const index = {
    intents() {
      for (const t of gone.doc._transactionCleanups) for (const key of t.changed.get(gone) ?? []) update(key);
      if (!totals) {
        totals = emptyIntents();
        for (const entry of entries.values()) if (entry.record) foldRecord(totals, entry.record);
        added = [];
      } else if (added.length) {
        for (const record of added) foldRecord(totals, record);
        added = [];
      }
      return {
        removals: totals.removals.slice(),
        restores: totals.restores.slice(),
        copyActive: new Set(totals.copyActive),
        attrs: new Map([...totals.attrs].map(([sourceKey, fields]) => [sourceKey, new Map(fields)])),
        textDeletes: totals.textDeletes.slice(),
      };
    },
  };
  goneIndexes.set(gone, index);
  return index;
};

export function parseGoneIntents(gone, { strict = false, kept = true } = {}) {
  const out = emptyIntents();
  if (strict) {
    gone.forEach((value, key) => recordOf(value, key, out));
    return out;
  }
  if (kept && gone instanceof Y.Map && gone.doc) return goneIndexOf(gone).intents();
  if (!kept) {
    gone.forEach((value, key) => { const record = parsedRecord(value, key); if (record) foldRecord(out, record); });
    return out;
  }
  const previous = parsedGone.get(gone) ?? new Map();
  const parsed = new Map();
  gone.forEach((value, key) => {
    const hit = previous.get(key);
    const entry = hit && hit.value === value ? hit : { value, record: parsedRecord(value, key) };
    parsed.set(key, entry);
    if (entry.record) foldRecord(out, entry.record);
  });
  parsedGone.set(gone, parsed);
  return out;
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
};

export const canonicalRevision = (record) => JSON.stringify(canonical(record));

const typeNode = (name) => schema.nodes[name] ?? schema.nodes.paragraph;

const blockOf = (pd, id, overrides = null) => {
  const map = pd.attrs.get(id);
  const named = overrides?.get("t");
  const base = (map && map.get("t")) || "paragraph";
  const type = typeof named === "string" && schema.nodes[named] ? named : base;
  const node = typeNode(type);
  const attrs = {};
  for (const key of attrKeys(node)) attrs[key] = copy(map && map.has(key) ? map.get(key) : defaultOf(node, key));
  if (type === "table") Object.assign(attrs, copy(resolveTableFields(pd.tableFields, id, { cols: attrs.cols, rows: attrs.rows })));
  if (type === "board") Object.assign(attrs, copy(resolveBoardFields(pd.boardFields, id)));
  if (overrides) for (const [field, value] of overrides) if (field !== "t" && Object.hasOwn(attrs, field)) attrs[field] = copy(value);
  return { id, type, attrs };
};

const overridesOf = (fields) => {
  const out = {};
  if (!fields) return out;
  for (const field of [...fields.keys()].sort()) out[field] = copy(fields.get(field));
  return out;
};

export const RECOVERED_PREFIX = "recovered:";
export const recoveredSource = (id) => (typeof id === "string" && id.startsWith(RECOVERED_PREFIX) ? id.slice(RECOVERED_PREFIX.length) : null);

export function recoveredRoot(sourceKey, removals, intents) {
  const active = new Set(removals.map((removal) => removal.key));
  let best = null;
  for (const restore of intents.restores) {
    if (restore.sourceKey !== sourceKey) continue;
    const count = restore.covers.reduce((n, key) => n + (active.has(key) ? 1 : 0), 0);
    if (!best || count > best.count || (count === best.count && compare(restore.key, best.restore.key) < 0)) best = { restore, count };
  }
  if (!best) return null;
  const fields = intents.attrs.get(sourceKey);
  const named = fields?.get("t");
  const base = schema.nodes[best.restore.baseline.type] ? best.restore.baseline.type : "paragraph";
  const type = typeof named === "string" && schema.nodes[named] ? named : base;
  const node = typeNode(type);
  const attrs = {};
  for (const key of attrKeys(node)) {
    if (fields && fields.has(key)) attrs[key] = copy(fields.get(key));
    else if (Object.hasOwn(best.restore.baseline.attrs, key)) attrs[key] = copy(best.restore.baseline.attrs[key]);
    else attrs[key] = copy(defaultOf(node, key));
  }
  return { type, attrs, key: best.restore.key };
}

const rawOf = (attrs) => {
  const out = {};
  for (const key of Object.keys(attrs).sort()) out[key] = copy(attrs[key]);
  return out;
};

const displaced = (item, seen) => seen.some((vector) => item.clock >= (vector.get(item.client) ?? 0));

const mergeRanges = (list) => {
  const spans = [];
  for (const [start, end] of list.sort((a, b) => a[0] - b[0])) {
    const last = spans[spans.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }
  return spans;
};

const holdsClock = (spans, clock) => {
  let lo = 0, hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const span = spans[mid];
    if (clock < span.start) hi = mid - 1;
    else if (clock >= span.end) lo = mid + 1;
    else return true;
  }
  return false;
};

const visibleOriginIndex = (flow, walked, index) => {
  const ranges = createProjectionMap(walked, flow.length).physicalRanges(0, walked.tokens);
  const clocks = new Map();
  const collect = (item, from, to) => {
    for (const piece of index.resolveRange(item.id.client, item.id.clock + from, to - from)) {
      const list = clocks.get(piece.client);
      if (list) list.push([piece.clock, piece.clock + piece.length]);
      else clocks.set(piece.client, [[piece.clock, piece.clock + piece.length]]);
    }
  };
  let at = 0, cursor = 0;
  for (let item = flow._start; item && cursor < ranges.length; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const start = at;
    at += item.length;
    const content = item.content;
    const isText = content instanceof Y.ContentString;
    if (!isText && !(content instanceof Y.ContentEmbed)) continue;
    if (!isText && content.embed.b !== undefined) continue;
    while (cursor < ranges.length && ranges[cursor][1] <= start) cursor++;
    let range = cursor;
    while (range < ranges.length && ranges[range][0] < at) {
      collect(item, Math.max(start, ranges[range][0]) - start, Math.min(at, ranges[range][1]) - start);
      if (ranges[range][1] >= at) break;
      range++;
    }
    cursor = range;
  }
  const spans = new Map();
  for (const [client, list] of clocks) spans.set(client, mergeRanges(list));
  return (client, clock) => {
    const list = spans.get(client);
    return list ? holdsClock(list, clock) : false;
  };
};

const runOf = (index, item, seen, type, visible) => {
  const source = index.resolve({ client: item.client, clock: item.clock });
  const marks = item.kind === "text" ? marksAttrs(marksFromAttributes(item.raw, type)) : {};
  const baseline = !displaced(item, seen);
  return { client: item.client, clock: item.clock, length: item.length, sourceClient: source.client, sourceClock: source.clock, baseline, displaced: !baseline && !visible(source.client, source.clock), kind: item.kind, text: item.kind === "text" ? item.text : null, marks, raw: rawOf(item.raw) };
};

const pushRun = (runs, run) => {
  const previous = runs[runs.length - 1];
  if (previous && previous.kind === run.kind && previous.baseline === run.baseline && previous.displaced === run.displaced && previous.client === run.client && previous.clock + previous.length === run.clock && previous.sourceClient === run.sourceClient && previous.sourceClock + previous.length === run.sourceClock && sameJson(previous.marks, run.marks) && sameJson(previous.raw, run.raw)) {
    previous.length += run.length;
    if (previous.kind === "text") previous.text += run.text;
    return;
  }
  runs.push(run);
};

const runOut = (run, authorOf) => ({
  id: physicalKeyOf(run),
  length: run.length,
  source: physicalKeyOf({ client: run.sourceClient, clock: run.sourceClock }),
  baseline: run.baseline,
  displaced: run.displaced,
  kind: run.kind,
  ...(run.kind === "text" ? { text: run.text } : {}),
  marks: run.marks,
  raw: run.raw,
  author: authorOf(run.sourceClient),
});

function sourceRecord(pd, index, sourceKey, removals, hidden, intents, visible, groups) {
  const effective = (blockId, marker, overrides = null) => {
    const boundary = index.boundaryOf(marker);
    if (!boundary || boundary.blockId !== blockId || !boundary.recoveryOf) return blockOf(pd, blockId, overrides);
    const root = recoveredRoot(boundary.recoveryOf, groups.get(boundary.recoveryOf) ?? [], intents);
    const type = typeof overrides?.get("t") === "string" && schema.nodes[overrides.get("t")] ? overrides.get("t") : root?.type ?? "paragraph";
    const attrs = {};
    for (const key of attrKeys(typeNode(type))) attrs[key] = copy(overrides?.has(key) ? overrides.get(key) : root && Object.hasOwn(root.attrs, key) ? root.attrs[key] : defaultOf(typeNode(type), key));
    return { id: blockId, type, attrs };
  };
  const authorOf = (client) => {
    const token = pd.origins.get(authorKey(client));
    return typeof token === "string" && token ? token : null;
  };
  const ordered = [...removals].sort((a, b) => compare(a.key, b.key));
  const blockId = ordered[0].blockId;
  const fields = intents.attrs.get(sourceKey);
  const overrides = overridesOf(fields);
  const root = effective(blockId, ordered[0].source, fields);
  const seenByKey = new Map(ordered.map((removal) => [removal.key, new Map(removal.sv)]));
  const items = new Map();
  for (const removal of ordered) {
    const entry = hidden.get(removal.key);
    if (!entry) continue;
    const seen = seenByKey.get(removal.key);
    for (const item of entry.items) {
      const found = items.get(item.id);
      if (found) found.vectors.push(seen);
      else items.set(item.id, { item, vectors: [seen] });
    }
  }
  const stream = [...items.values()].sort((a, b) => a.item.at - b.item.at);
  const blocks = [{ ...root, author: authorOf(index.resolve(ordered[0].source).client), runs: [] }];
  let current = blocks[0];
  for (const entry of stream) {
    const item = entry.item;
    if (item.kind === "marker") {
      if (index.boundaryOf({ client: item.client, clock: item.clock })?.kind === "restore") continue;
      if (!item.blockId || item.blockId === current.id) continue;
      const boundary = effective(item.blockId, { client: item.client, clock: item.clock });
      current = { ...boundary, author: authorOf(index.resolve({ client: item.client, clock: item.clock }).client), runs: [] };
      blocks.push(current);
      continue;
    }
    if (item.kind === "text") {
      for (let offset = 0; offset < item.length; offset++) {
        pushRun(current.runs, runOf(index, { ...item, clock: item.clock + offset, length: 1, text: item.text[offset] }, entry.vectors, current.type, visible));
      }
    } else pushRun(current.runs, runOf(index, item, entry.vectors, current.type, visible));
  }
  const out = {
    source: sourceKey,
    blockId,
    type: root.type,
    attrs: root.attrs,
    author: blocks[0].author,
    blocks: blocks.map((block) => ({ id: block.id, type: block.type, attrs: block.attrs, author: block.author, runs: block.runs.map((run) => runOut(run, authorOf)) })),
    removals: ordered.map((removal) => ({ key: removal.key, operationId: removal.operationId, end: removal.end, sv: removal.sv.map(([client, clock]) => [client, clock]) })),
    restores: intents.restores.filter((restore) => restore.covers.some((cover) => ordered.some((removal) => removal.key === cover))).sort((a, b) => compare(a.key, b.key)).map((restore) => ({ key: restore.key, covers: sortedList(restore.covers) })),
    copyActive: intents.copyActive.has(sourceKey),
    overrides,
    recoverable: blocks.some((block) => block.runs.some((run) => run.displaced)),
  };
  return { ...out, revision: canonicalRevision(out) };
}

const seenClock = (sv, client) => {
  for (const [c, clock] of sv) if (c === client) return clock;
  return 0;
};

const mayDisplace = (removal, entry) => {
  for (const item of entry.items) if (item.kind !== "marker" && item.clock + item.length - 1 >= seenClock(removal.sv, item.client)) return true;
  return false;
};

const bySource = (a, b) => {
  const left = parsePhysicalKey(a.source), right = parsePhysicalKey(b.source);
  return left.client - right.client || left.clock - right.clock;
};

function recoveryInputs(pd, index, options) {
  const walked = options.walked ?? walk(pd, index);
  const intents = options.intents ?? parseGoneIntents(pd.gone, { strict: options.strict === true });
  const hidden = new Map();
  for (const entry of walked.hidden ?? []) hidden.set(entry.key, entry);
  const groups = new Map();
  for (const removal of walked.removals ?? intents.removals) {
    const list = groups.get(removal.sourceKey);
    if (list) list.push(removal);
    else groups.set(removal.sourceKey, [removal]);
  }
  let visibleIndex = null;
  const visible = (client, clock) => {
    if (!visibleIndex) visibleIndex = visibleOriginIndex(pd.flow, walked, index);
    return visibleIndex(client, clock);
  };
  return { intents, hidden, groups, visible };
}

export function reduceRecovery(pd, options = {}) {
  const index = options.index ?? createOriginIndex(pd.origins);
  try {
    const { intents, hidden, groups, visible } = recoveryInputs(pd, index, options);
    const sources = new Map();
    for (const [sourceKey, removals] of groups) sources.set(sourceKey, sourceRecord(pd, index, sourceKey, removals, hidden, intents, visible, groups));
    return { sources, list: [...sources.values()].sort(bySource), intents };
  } finally {
    if (!options.index) index.dispose();
  }
}

export function reduceRecoverable(pd, options = {}) {
  const index = options.index ?? createOriginIndex(pd.origins);
  try {
    const { intents, hidden, groups, visible } = recoveryInputs(pd, index, options);
    const list = [];
    for (const [sourceKey, removals] of groups) {
      if (!removals.some((removal) => hidden.has(removal.key) && mayDisplace(removal, hidden.get(removal.key)))) continue;
      const record = sourceRecord(pd, index, sourceKey, removals, hidden, intents, visible, groups);
      if (record.recoverable) list.push(record);
    }
    return { list: list.sort(bySource), intents };
  } finally {
    if (!options.index) index.dispose();
  }
}
