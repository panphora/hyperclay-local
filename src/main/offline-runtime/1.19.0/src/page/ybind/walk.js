import * as Y from "../../vendor/yjs.vendor.js";
import { schema } from "../schema.js";
import { idKey, parseKey, sameJson } from "./layout.js";
import { marksFromAttributes, marksKey } from "./marks.js";
import { aliasKey, createOriginIndex } from "./origins.js";
import { COPY_LOST, copyActiveKey, copyLostKey, parseGoneIntents, recoveredRoot, recoveredSource } from "./recovery.js";

export const hashText = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const covers = (it, id) => it.id.client === id.client && id.clock >= it.id.clock && id.clock < it.id.clock + it.length;

const lostCopySource = (cover) => {
  if (typeof cover !== "string" || cover.charCodeAt(0) !== 91) return null;
  let parts;
  try { parts = JSON.parse(cover); } catch { return null; }
  return Array.isArray(parts) && parts.length === 2 && parts[0] === COPY_LOST && typeof parts[1] === "string" ? parts[1] : null;
};

export const pickCopy = (list) => list.reduce((x, y) => (y.brk.client < x.brk.client || (y.brk.client === x.brk.client && y.brk.clock < x.brk.clock) ? y : x));

export function walk(pd, index = null) {
  const owned = index ? null : createOriginIndex(pd.origins);
  try {
    return walkFlow(pd, owned ?? index);
  } finally {
    if (owned) owned.dispose();
  }
}

function walkFlow(pd, index) {
  const store = pd.ydoc.store;
  const intents = parseGoneIntents(pd.gone);
  const liveBySource = new Map();
  const markerCount = new Map();
  for (let it = pd.flow._start; it; it = it.right) {
    if (it.deleted || !(it.content instanceof Y.ContentEmbed) || it.content.embed.b === undefined) continue;
    markerCount.set(it.content.embed.b, (markerCount.get(it.content.embed.b) ?? 0) + 1);
    const sourceKey = idKey(index.resolve(it.id));
    const prior = liveBySource.get(sourceKey);
    if (!prior || it.id.client < prior.id.client || (it.id.client === prior.id.client && it.id.clock < prior.id.clock)) liveBySource.set(sourceKey, it);
  }
  const liveSources = new Set(liveBySource.keys());
  const movedSources = new Set();
  const retired = [];
  const copyBoundary = (client, clock) => {
    const sourceKey = `${client}.${clock}`;
    const record = index.boundaryOf({ client, clock });
    if (!record || record.kind !== "copy") return;
    if (intents.copyActive.has(sourceKey)) { if (record.recoveryOf) movedSources.add(record.recoveryOf); }
    else if (liveSources.has(sourceKey)) retired.push({ key: copyActiveKey(sourceKey), sourceKey, source: { client, clock }, operationId: null, blockId: record.blockId, end: null, sv: [], legacy: false, implicit: true });
  };
  const markers = index.markers?.() ?? null;
  const candidateSets = new Map();
  if (markers) {
    for (const entry of markers.records) if (entry.live && entry.kind === "boundary") copyBoundary(entry.client, entry.clock);
  } else for (const key of pd.origins.keys()) {
    let parts;
    try { parts = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(parts) || parts.length !== 3 || (parts[0] !== "boundary" && parts[0] !== "alias")) continue;
    const [, client, clock] = parts;
    if (!Number.isSafeInteger(client) || client < 0 || !Number.isSafeInteger(clock) || clock < 0) continue;
    if (parts[0] === "boundary") copyBoundary(client, clock);
    const clocks = candidateSets.get(client) ?? candidateSets.set(client, new Set()).get(client);
    clocks.add(clock);
  }
  const promotedCopies = [];
  const implicitKeys = new Set(retired.map((removal) => removal.key));
  for (const restore of intents.restores) for (const cover of restore.covers) {
    const sourceKey = lostCopySource(cover);
    if (sourceKey === null || implicitKeys.has(cover) || !liveBySource.has(sourceKey)) continue;
    implicitKeys.add(cover);
    promotedCopies.push({ key: cover, sourceKey, source: parseKey(sourceKey), operationId: null, blockId: liveBySource.get(sourceKey).content.embed.b, end: null, sv: [], legacy: false, implicit: true });
  }
  const removals = retired.length || promotedCopies.length ? [...intents.removals, ...retired, ...promotedCopies] : intents.removals;
  const starts = new Map();
  const removalStarts = new Map();
  const removalsBySource = new Map();
  for (const removal of removals) {
    const sourceList = removalsBySource.get(removal.sourceKey) ?? removalsBySource.set(removal.sourceKey, []).get(removal.sourceKey);
    sourceList.push(removal);
    let it = null;
    if (removal.implicit) it = liveBySource.get(removal.sourceKey);
    else try { it = Y.getItem(store, removal.source); } catch { it = null; }
    const stableSource = idKey(index.resolve(removal.source));
    const live = liveBySource.get(stableSource);
    if ((!it || it.deleted) && live?.content.embed.b === removal.blockId) it = live;
    if (!it) continue;
    if (removal.legacy) {
      if (!it.deleted && it.content instanceof Y.ContentEmbed && it.content.embed.b === removal.blockId && idKey(index.resolve(it.id)) === stableSource) starts.set(it, { key: removal.key, blockId: removal.blockId, end: removal.end ? parseKey(removal.end) : null });
      continue;
    }
    const list = removalStarts.get(it) ?? removalStarts.set(it, []).get(it);
    list.push(removal);
  }
  const coverBySource = new Map();
  const restoredSources = new Set(intents.restores.map((restore) => restore.sourceKey));
  const recoveryRecord = (it, id) => {
    const source = recoveredSource(id);
    if (source === null) return null;
    const record = index.boundaryOf({ client: it.id.client, clock: it.id.clock });
    return record && record.blockId === id && record.recoveryOf === source ? record : null;
  };
  const boundarySource = (it, id) => {
    const record = recoveryRecord(it, id);
    return record && record.kind === "restore" ? record.recoveryOf : null;
  };
  const movedSource = (it, id) => {
    const record = recoveryRecord(it, id);
    return record && record.kind === "copy" ? record.recoveryOf : null;
  };
  const markerSource = (it, id) => {
    const source = boundarySource(it, id);
    return source !== null && restoredSources.has(source) && removalsBySource.has(source) ? source : null;
  };
  for (const restore of intents.restores) {
    const set = coverBySource.get(restore.sourceKey) ?? coverBySource.set(restore.sourceKey, new Set()).get(restore.sourceKey);
    for (const key of restore.covers) set.add(key);
  }
  const recoveredMarkers = new Map();
  if (restoredSources.size) for (let it = pd.flow._start; it; it = it.right) {
    if (it.deleted) continue;
    const source = it.content instanceof Y.ContentEmbed ? markerSource(it, it.content.embed && it.content.embed.b) : null;
    if (source === null) continue;
    const list = recoveredMarkers.get(source) ?? recoveredMarkers.set(source, []).get(source);
    list.push(it);
  }
  const exposed = (sourceKey) => {
    const removals = removalsBySource.get(sourceKey);
    if (!removals || !removals.length) return false;
    const cover = coverBySource.get(sourceKey);
    if (!cover) return false;
    for (const removal of removals) if (!cover.has(removal.key)) return false;
    return (recoveredMarkers.get(sourceKey)?.length ?? 0) > 0 || movedSources.has(sourceKey);
  };
  const segs = [];
  const orphans = [];
  const hidden = [];
  const fences = [], stops = [];
  let cur = null, prevId = "start", hiding = null, at = 0;
  const cattrs = {};
  let styled = null;
  // The format state a block starts and ends with, so one block can be walked again on its
  // own (walk-delta.js) and the next block's marks proven unchanged.
  const fmt = () => { for (const key in cattrs) return { ...cattrs }; return null; };
  const typeOf = (id) => { const m = pd.attrs.get(id); return (m && m.get("t")) || "paragraph"; };
  const hideUnit = (len) => {
    if (!len) return;
    if (cur && !cur.atom) cur.runs.push({ hole: len });
    else segs.push({ kind: "h", len, key: null });
  };
  const openRecovered = (sourceKey, it, moved = false) => {
    const root = recoveredRoot(sourceKey, removalsBySource.get(sourceKey) ?? [], intents);
    const id = `recovered:${sourceKey}`;
    const t = root ? root.type : "paragraph";
    const opaque = !Object.hasOwn(schema.nodes, t);
    const f = fmt();
    if (cur) cur.fmtOut = f;
    cur = { kind: "b", id, baseId: id, brk: { client: it.id.client, clock: it.id.clock }, implicit: false, runs: [], len: 1, atom: !opaque && !schema.nodes[t]?.isTextblock, opaque, recovered: true, restored: !moved, sourceKey, t, fields: root ? root.attrs : null, fmtIn: f, fmtOut: null };
    segs.push(cur);
    prevId = id;
  };
  const open = (id, brk, implicit) => {
    const f = fmt();
    if (cur) cur.fmtOut = f;
    cur = { kind: "b", id, baseId: id, brk, implicit, runs: [], len: implicit ? 0 : 1, atom: false, items: !implicit && (markerCount.get(id) ?? 0) > 1 ? [] : null, fmtIn: f, fmtOut: null };
    if (!implicit) {
      cur.t = typeOf(id);
      // A type this runtime has no schema for still owns the text and marks up to
      // the next block marker: it is not an atom whose following text becomes an
      // implicit paragraph, and it is never rewritten as one.
      cur.opaque = !Object.hasOwn(schema.nodes, cur.t);
      cur.atom = !cur.opaque && !schema.nodes[cur.t]?.isTextblock;
    } else cur.t = "paragraph";
    segs.push(cur);
    prevId = id;
  };
  const flush = () => {
    if (!hiding) return;
    if (hiding.len) {
      if (hiding.resume) hiding.resume.runs.push({ hole: hiding.len });
      else segs.push({ kind: "h", len: hiding.len, key: hiding.active[0]?.key });
    }
    cur = hiding.resume;
    hiding = null;
  };
  const settle = (a) => {
    if (a.legacy && a.text) orphans.push({ key: a.key, id: a.blockId, text: a.text, h: hashText(a.text) });
    hidden.push({ key: a.key, sourceKey: a.sourceKey, blockId: a.blockId, end: a.end, sv: a.sv, at: a.at, live: a.live, items: a.items });
  };
  const matchesEnd = (it, end, after = -1) => {
    if (covers(it, end) && end.clock > after) return true;
    return markerIdsWithin(it).some((id) => {
      if (id.clock <= after || !pd.origins.has(aliasKey(id.client, id.clock))) return false;
      const resolved = index.resolve(id);
      return resolved.client === end.client && resolved.clock === end.clock;
    });
  };
  const markerClocks = markers ? markers.clocks : new Map([...candidateSets].map(([client, clocks]) => [client, [...clocks].sort((a, b) => a - b)]));
  const markerIdsWithin = (it) => {
    const clocks = markerClocks.get(it.id.client) ?? [];
    let lo = 0, hi = clocks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (clocks[mid] < it.id.clock) lo = mid + 1; else hi = mid; }
    const ids = [];
    for (let i = lo; i < clocks.length && clocks[i] < it.id.clock + it.length; i++) ids.push({ client: it.id.client, clock: clocks[i] });
    return ids;
  };
  const deletedEdgesIn = (it, after = -1) => (it.deleted ? markerIdsWithin(it).flatMap((id) => {
    if (id.clock <= after) return [];
    const sourceKey = idKey(index.resolve(id));
    const record = index.boundaryOf(id);
    if (!record || (record.kind !== "removed" && record.kind !== "copy") || liveSources.has(sourceKey)) return [];
    return [{ blockId: record.blockId, sourceKey }];
  }) : []);
  // `after` limits an end to what lies past a removal's own source: Yjs merges adjacent deleted
  // items, so a removal can start and end inside the same one, on some replicas and not others.
  const endsIn = (it, a, { deletedEdges, boundary = false, edge, after = -1 }) => a.end ? matchesEnd(it, a.end, after) : a.implicit ? boundary || deletedEdges.some((e) => e.sourceKey !== a.sourceKey) : (boundary && edge !== a.blockId) || deletedEdges.some((e) => e.blockId !== a.blockId);
  const proj = [];
  const endsOf = (removal) => ({ blockId: removal.blockId, end: removal.end ? parseKey(removal.end) : null, implicit: removal.implicit === true, sourceKey: removal.sourceKey });
  for (let it = pd.flow._start; it; it = it.right) {
    const here = at;
    if (!it.deleted && it.countable) at += it.length;
    if (hiding || proj.length) {
      const edge = !it.deleted && it.content instanceof Y.ContentEmbed ? it.content.embed.b : undefined;
      const boundary = edge !== undefined && boundarySource(it, edge) === null;
      const deletedEdges = deletedEdgesIn(it);
      const ends = (a) => endsIn(it, a, { deletedEdges, boundary, edge });
      if (hiding) {
        const keep = [];
        for (const a of hiding.active) { if (ends(a)) settle(a); else keep.push(a); }
        hiding.active = keep;
        if (!keep.length) flush();
      }
      for (let i = proj.length - 1; i >= 0; i--) {
        proj[i].active = proj[i].active.filter((a) => !ends(a));
        if (!proj[i].active.length) proj.splice(i, 1);
      }
    }
    const removals = removalStarts.get(it);
    if (removals) {
      if (it.deleted) stops.push({ client: it.id.client, clock: it.id.clock, len: it.length });
      if (!hiding && exposed(removals[0].sourceKey)) {
        if (!it.deleted) hideUnit(it.length);
        proj.push({ active: removals.map(endsOf), sourceKey: removals[0].sourceKey, root: null });
        continue;
      }
      if (!hiding && it.deleted) fences.push({ client: it.id.client, clock: it.id.clock });
      for (const removal of removals) {
        const a = { legacy: false, implicit: removal.implicit === true, key: removal.key, sourceKey: removal.sourceKey, blockId: removal.blockId, end: removal.end ? parseKey(removal.end) : null, sv: removal.sv, at: here, live: !it.deleted, items: [] };
        const after = it.deleted && covers(it, removal.source) ? removal.source.clock : null;
        if (after !== null && endsIn(it, a, { deletedEdges: deletedEdgesIn(it, after), after })) { settle(a); continue; }
        if (hiding) hiding.active.push(a);
        else hiding = { active: [a], len: 0, resume: cur };
      }
      if (hiding && !it.deleted) hiding.len += it.length;
      continue;
    }
    const start = starts.get(it);
    if (start) {
      if (it.deleted) stops.push({ client: it.id.client, clock: it.id.clock, len: it.length });
      if (!hiding && exposed(start.key)) {
        if (!it.deleted) hideUnit(it.length);
        proj.push({ active: [{ blockId: start.blockId, end: start.end }], sourceKey: start.key, root: null });
        continue;
      }
      const a = { legacy: true, key: start.key, sourceKey: start.key, blockId: start.blockId, end: start.end, sv: [], at: here, live: true, items: [], text: "" };
      if (hiding) hiding.active.push(a);
      else hiding = { active: [a], len: 0, resume: cur };
      hiding.len += 1;
      continue;
    }
    if (it.deleted) continue;
    const c = it.content;
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; styled = null; continue; }
    if (hiding) {
      if (c instanceof Y.ContentString || c instanceof Y.ContentEmbed) {
        const piece = c instanceof Y.ContentString ? c.str : c.embed.b !== undefined ? "\u00b6" : "\n";
        const raw = { ...cattrs };
        for (const a of hiding.active) {
          if (a.legacy) a.text += piece;
          a.items.push({ at: here, id: idKey(it.id), client: it.id.client, clock: it.id.clock, length: it.length, kind: c instanceof Y.ContentString ? "text" : c.embed.b !== undefined ? "marker" : "br", text: c instanceof Y.ContentString ? c.str : null, blockId: c instanceof Y.ContentEmbed && c.embed.b !== undefined ? c.embed.b : null, raw });
        }
        hiding.len += it.length;
      }
      continue;
    }
    if (c instanceof Y.ContentFormat) { if (c.value === null) delete cattrs[c.key]; else cattrs[c.key] = c.value; continue; }
    if (c instanceof Y.ContentEmbed) {
      const source = markerSource(it, c.embed.b);
      if (source !== null) {
        const target = proj.find((entry) => entry.sourceKey === source && !entry.root);
        if (target && !movedSources.has(source)) { openRecovered(source, it); target.root = cur; }
        else hideUnit(it.length);
        continue;
      }
      if (boundarySource(it, c.embed.b) !== null) { hideUnit(it.length); continue; }
      const moved = movedSource(it, c.embed.b);
      if (moved !== null) { openRecovered(moved, it, true); continue; }
      const e = c.embed;
      if (e.b !== undefined) open(e.b, { client: it.id.client, clock: it.id.clock }, false);
      else {
        if (!cur || cur.atom) open(`~${prevId}`, null, true);
        cur.runs.push({ br: true });
        if (cur.items) cur.items.push({ at: here, id: idKey(it.id), client: it.id.client, clock: it.id.clock, length: it.length, kind: "br", text: null, blockId: null, raw: { ...cattrs } });
        cur.len += 1;
      }
      continue;
    }
    if (c instanceof Y.ContentString) {
      if (!cur || cur.atom) open(`~${prevId}`, null, true);
      const code = cur.t === "code_block";
      if (!styled || styled.code !== code) {
        const marks = marksFromAttributes(cattrs, cur.t);
        styled = { code, marks, mk: marksKey(marks) };
      }
      cur.runs.push({ text: c.str, marks: styled.marks, mk: styled.mk });
      if (cur.items) cur.items.push({ at: here, id: idKey(it.id), client: it.id.client, clock: it.id.clock, length: it.length, kind: "text", text: c.str, blockId: null, raw: { ...cattrs } });
      cur.len += c.str.length;
    }
  }
  if (hiding) { for (const a of hiding.active) settle(a); flush(); }
  if (cur) cur.fmtOut = fmt();
  const groups = new Map();
  for (const s of segs) {
    if (s.kind !== "b" || s.implicit) continue;
    (groups.get(s.baseId) ?? groups.set(s.baseId, []).get(s.baseId)).push(s);
  }
  const textOfSeg = (s) => s.runs.map((r) => (r.br ? "\n" : r.hole ? "" : r.text)).join("");
  const copies = new Map();
  const lostCopies = [];
  for (const [base, list] of groups) {
    if (list.length < 2) continue;
    const win = pickCopy(list);
    for (const s of list) {
      if (s === win) continue;
      s.hide = true;
      (copies.get(base) ?? copies.set(base, []).get(base)).push(idKey(s.brk));
      if (!(sameJson(s.runs, win.runs) && s.t === win.t) && textOfSeg(s)) {
        orphans.push({ key: `d${s.brk.client}.${s.brk.clock}`, id: base, text: textOfSeg(s), h: hashText(textOfSeg(s)), copy: true });
        if (s.items?.length) {
          const sourceKey = idKey(index.resolve(s.brk));
          const key = copyLostKey(sourceKey);
          lostCopies.push({ key, sourceKey, source: { client: s.brk.client, clock: s.brk.clock }, operationId: null, blockId: base, end: null, sv: [], legacy: false, implicit: true });
          hidden.push({ key, sourceKey, blockId: base, end: null, sv: [], at: s.items[0].at, live: true, items: s.items });
        }
      }
    }
  }
  const visible = [];
  const holes = [];
  let tokens = 0;
  for (const s of segs) {
    if (s.kind === "h") { holes.push({ at: tokens, len: s.len }); continue; }
    if (s.hide) {
      holes.push({ at: tokens, len: s.len + s.runs.reduce((n, r) => n + (r.hole ?? 0), 0) });
      continue;
    }
    visible.push(s);
    let off = s.implicit ? 0 : 1;
    for (const r of s.runs) {
      if (r.hole) holes.push({ at: tokens + off, len: r.hole });
      else off += r.br ? 1 : r.text.length;
    }
    tokens += s.len;
  }
  return { visible, holes, orphans, tokens, copies, hidden, removals: lostCopies.length ? [...removals, ...lostCopies] : removals, fences, stops };
}
