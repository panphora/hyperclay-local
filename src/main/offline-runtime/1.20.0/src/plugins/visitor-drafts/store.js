import { extractData, applyData, engine } from "../../vendor/hyper-html-api-data.vendor.js";
import { draftSlot, setDraftStoreFailed } from "../../core/draft-mode.js";

export const KEY_PREFIX = "clay:visitor-drafts:";
export const RECORD_VERSION = 1;

// The document a pathname names, spelled the way the hosts resolve it: the path up to
// and including the first segment that ends in .html or .htmlclay (anything after it is
// a route inside that document), repeated slashes as one, the root index.html as "/",
// and "/" for a host that serves one document at every path.
export function draftPath(pathname = window.location.pathname) {
  const clean = String(pathname || "/").replace(/\/{2,}/g, "/");
  const file = clean.match(/^(.*?\/[^/]+\.(?:html|htmlclay))(?:\/|$)/i);
  const path = file ? file[1] : "/";
  return path.toLowerCase() === "/index.html" ? "/" : path;
}

export const legacyKey = (slot) => KEY_PREFIX + slot;
export const draftKey = (slot, path = draftPath()) => `${KEY_PREFIX}${slot}@${path}`;

export function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function pathParts(label) {
  const parts = [];
  for (const match of label.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    parts.push(match[2] !== undefined ? Number(match[2]) : match[1]);
  }
  return parts;
}

function dropPath(data, label) {
  const parts = pathParts(label);
  let node = data;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node?.[parts[i]];
    if (node == null || typeof node !== "object") return;
  }
  if (node && typeof node === "object") delete node[parts[parts.length - 1]];
}

// True when everything `wanted` says is present in `got`. Extra fields in `got`
// (a rule the draft predates) and key order do not matter.
export function fitsInto(wanted, got) {
  if (Array.isArray(wanted)) {
    return Array.isArray(got) && got.length === wanted.length && wanted.every((item, i) => fitsInto(item, got[i]));
  }
  if (isPlain(wanted)) {
    return isPlain(got) && Object.keys(wanted).every((name) => fitsInto(wanted[name], got[name]));
  }
  return wanted === got;
}

function same(a, b) {
  return fitsInto(a, b) && fitsInto(b, a);
}

const hasIds = (rows) => Array.isArray(rows)
  && rows.every((row) => isPlain(row) && (typeof row.id === "string" || typeof row.id === "number"))
  && new Set(rows.map((row) => row.id)).size === rows.length;

// Fields a draft predates take the page's current value, matched by row id, so
// the engine pairs rows by what the visitor saved rather than by position.
function complete(draft, page, top = false) {
  if (isPlain(draft) && isPlain(page)) {
    const out = { ...draft };
    for (const name of Object.keys(page)) {
      if (name in draft) out[name] = complete(draft[name], page[name]);
      else if (!top) out[name] = page[name];
    }
    return out;
  }
  if (hasIds(draft) && hasIds(page)) {
    const byId = new Map(page.map((row) => [row.id, row]));
    return draft.map((row) => (byId.has(row.id) ? complete(row, byId.get(row.id)) : row));
  }
  return draft;
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

// Rows matched by id, when neither tab reordered the rows all three still have: a row
// one tab added is kept where that tab put it, a row one tab removed goes unless the
// other tab changed it, and a row both kept merges field by field. Anything else is
// null, and the caller treats the list as one value.
function mergeRows(base, mine, theirs) {
  const index = (rows) => new Map(rows.map((row) => [row.id, row]));
  const was = index(base);
  const mineById = index(mine);
  const theirsById = index(theirs);
  const shared = (rows) => rows.filter((row) => was.has(row.id) && mineById.has(row.id) && theirsById.has(row.id)).map((row) => row.id);
  const order = shared(base);
  if (!sameIds(order, shared(mine)) || !sameIds(order, shared(theirs))) return null;
  for (const [id, row] of was) {
    if (mineById.has(id) && !theirsById.has(id) && !same(mineById.get(id), row)) return null;
    if (!mineById.has(id) && theirsById.has(id) && !same(theirsById.get(id), row)) return null;
  }
  let conflict = false;
  const out = [];
  for (const row of mine) {
    if (was.has(row.id) && !theirsById.has(row.id)) continue;
    if (!theirsById.has(row.id)) { out.push(row); continue; }
    const part = mergeValue(was.get(row.id), row, theirsById.get(row.id), true);
    conflict ||= part.conflict;
    out.push(part.value);
  }
  theirs.forEach((row, i) => {
    if (was.has(row.id) || mineById.has(row.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((kept) => kept.id === theirs[j].id);
      if (k !== -1) { at = k + 1; break; }
    }
    out.splice(at, 0, row);
  });
  return { value: out, conflict };
}

function mergeValue(base, mine, theirs, rows) {
  if (same(mine, theirs) || same(theirs, base)) return { value: mine, conflict: false };
  if (same(mine, base)) return { value: theirs, conflict: false };
  if (isPlain(mine) && isPlain(theirs)) {
    const value = {};
    let conflict = false;
    for (const name of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const part = mergeValue(isPlain(base) ? base[name] : undefined, mine[name], theirs[name], rows);
      conflict ||= part.conflict;
      if (part.value !== undefined) value[name] = part.value;
    }
    return { value, conflict };
  }
  if (rows && hasIds(base) && hasIds(mine) && hasIds(theirs)) {
    const merged = mergeRows(base, mine, theirs);
    if (merged) return merged;
  }
  return { value: mine, conflict: true };
}

function countIds(value, counts = new Map()) {
  if (Array.isArray(value)) {
    if (hasIds(value)) for (const row of value) counts.set(row.id, (counts.get(row.id) || 0) + 1);
    for (const item of value) countIds(item, counts);
  } else if (isPlain(value)) {
    for (const item of Object.values(value)) countIds(item, counts);
  }
  return counts;
}

// Three-way merge of this tab's value with another tab's, from the value both started
// at. Objects merge per field and lists of rows with ids merge per row. A list merge that
// would hold one id in two places (a card moved to different lists in each tab) is
// undone, and that list is a conflict this tab wins, as is any reorder.
export function merge3(base, mine, theirs) {
  const merged = mergeValue(base, mine, theirs, true);
  const before = countIds(mine);
  for (const [id, count] of countIds(merged.value)) {
    if (count > 1 && count > (before.get(id) || 0)) return mergeValue(base, mine, theirs, false);
  }
  return merged;
}

function storageFailure(doc, error) {
  setDraftStoreFailed(true);
  doc.dispatchEvent(new CustomEvent("clay:drafts-store-failed", { detail: { error } }));
  const failure = new Error("Couldn't save in this browser. Storage is full or turned off.");
  failure.code = "draft-storage";
  return failure;
}

const savedAtOf = (raw) => {
  try { return String(JSON.parse(raw)?.savedAt ?? ""); } catch { return ""; }
};

// A draft saved before drafts were scoped to the document's path lives under the slot
// alone. It is copied into this path's key with its UI memory, and never written or
// removed: a tab still on an older ClayJS may write it again, and another document on
// this origin with the same slot may still need it. The marker keeps the old record's
// savedAt, so a later write by such a tab is caught up on the next load, and a reset
// never brings the old draft back.
export function adoptLegacy(slot, { path = draftPath(), storage = safeStorage() } = {}) {
  const from = legacyKey(slot);
  const to = draftKey(slot, path);
  const marker = to + ":legacy";
  try {
    const generation = storage?.getItem(to);
    const old = storage?.getItem(from);
    if (old == null) {
      // A visitor who only dismissed the intro has UI memory and no draft; it is copied once too.
      const ui = storage?.getItem(from + ":ui");
      if (ui != null && storage.getItem(to + ":ui") == null && storage.getItem(to + ":ui-legacy") == null) {
        storage.setItem(to + ":ui", ui);
        storage.setItem(to + ":ui-legacy", "1");
      }
      return "none";
    }
    const stamp = savedAtOf(old);
    const seen = storage.getItem(marker);
    if (seen === stamp) return "none";
    // A visitor who wrote to this document while the copy ran keeps what they typed.
    const current = storage.getItem(to);
    if (current !== generation) return "none";
    if (current == null || (seen != null && savedAtOf(current) === seen)) {
      storage.setItem(to, old);
    } else if (current !== old) {
      storage.setItem(to + ":conflict", old);
      console.warn("visitor-drafts: an older tab changed this draft after it moved; its copy was kept under", to + ":conflict");
    }
    if (seen == null) {
      const ui = storage.getItem(from + ":ui");
      if (ui != null && storage.getItem(to + ":ui") == null) storage.setItem(to + ":ui", ui);
    }
    storage.setItem(marker, stamp);
    return "copied";
  } catch {
    return "failed";
  }
}

export function createStore({ doc = document, storage = safeStorage(), now = () => new Date(), path = draftPath(), fallback = null } = {}) {
  const slot = draftSlot(doc);
  const key = draftKey(slot, path);
  const rules = engine.findRulesIn(doc, "api").rules;

  let lastRaw = null;
  let base = null;
  let unparked = null;
  let stopped = false;

  function getRaw() {
    try {
      if (!storage) return null;
      const raw = storage.getItem(key);
      return raw == null && fallback ? storage.getItem(fallback) : raw;
    } catch { return null; }
  }

  function parse(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isPlain(parsed) && parsed.v === RECORD_VERSION && isPlain(parsed.data)) return parsed;
    } catch {}
    return null;
  }

  function read() {
    const raw = getRaw();
    if (raw == null) return null;
    return { raw, record: parse(raw) };
  }

  function live() {
    return extractData(doc, rules);
  }

  // What a save would store right now: persisted controls keep typing in their
  // live value, which only the save capture copies into the markup.
  function captured() {
    const getHTML = window.clay?.getHTML;
    if (typeof getHTML !== "function") return live();
    return extractData(new DOMParser().parseFromString(getHTML.call(window.clay), "text/html"), rules);
  }

  function storedKeys() {
    try {
      if (typeof storage.keys === "function") return storage.keys();
      const names = [];
      for (let i = 0; i < storage.length; i++) names.push(storage.key(i));
      return names;
    } catch {
      return [];
    }
  }

  function snapshot() {
    try { return JSON.stringify(captured()); } catch { return null; }
  }

  function park(raw, { keepSlot = false } = {}) {
    const kept = storedKeys().find((name) => name.startsWith(key + ":unreadable:") && storage.getItem(name) === raw);
    if (kept) {
      unparked = null;
      if (!keepSlot) { try { storage.removeItem(key); } catch {} }
      return kept;
    }
    const parkedKey = key + ":unreadable:" + now().toISOString();
    try {
      storage.setItem(parkedKey, raw);
    } catch {
      unparked = raw;
      console.warn("visitor-drafts: this browser's saved copy no longer fits the page, and there is no room to keep it aside; nothing will be saved over it");
      return null;
    }
    unparked = null;
    if (!keepSlot) { try { storage.removeItem(key); } catch {} }
    console.warn(keepSlot
      ? "visitor-drafts: part of this browser's saved copy no longer fits the page; the original was kept under"
      : "visitor-drafts: this browser's saved copy no longer fits the page; it was kept under", parkedKey);
    return parkedKey;
  }

  // Applies `data` to a copy of the page first, so a draft that does not fit never
  // touches the live page. Top-level keys that do not read back are dropped.
  function fit(data) {
    const wanted = complete(JSON.parse(JSON.stringify(data)), live(), true);
    const dropped = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const trial = doc.cloneNode(true);
      try {
        applyData(trial, wanted, rules);
      } catch (error) {
        const unknown = error?.details?.unknownKeys ?? error?.unknownKeys;
        if (Array.isArray(unknown) && unknown.length) {
          for (const label of unknown) dropPath(wanted, label);
          continue;
        }
        const failing = Object.keys(wanted).filter((name) => {
          try { applyData(doc.cloneNode(true), { [name]: wanted[name] }, rules); return false; } catch { return true; }
        });
        if (!failing.length) return null;
        for (const name of failing) delete wanted[name];
        dropped.push(...failing);
        continue;
      }
      const got = extractData(trial, rules);
      const misfits = Object.keys(wanted).filter((name) => !fitsInto(wanted[name], got[name]));
      if (!misfits.length) return { data: wanted, dropped };
      for (const name of misfits) delete wanted[name];
      dropped.push(...misfits);
    }
    return null;
  }

  function parkedResult(raw) {
    const parkedKey = park(raw);
    if (!parkedKey) lastRaw = raw;
    base = live();
    return parkedKey
      ? { restored: false, hadDraft: true, parked: true }
      : { restored: false, hadDraft: true, parked: false, blocked: true };
  }

  function restore() {
    const found = read();
    if (!found) {
      base = live();
      return { restored: false, hadDraft: false };
    }
    if (!found.record) return parkedResult(found.raw);
    const fitted = fit(found.record.data);
    if (!fitted || !Object.keys(fitted.data).length) return parkedResult(found.raw);
    applyData(doc, fitted.data, rules);
    lastRaw = found.raw;
    base = live();
    if (fitted.dropped.length) {
      const parkedKey = park(found.raw, { keepSlot: true });
      return { restored: true, hadDraft: true, data: fitted.data, partial: true, parked: Boolean(parkedKey), blocked: !parkedKey };
    }
    return { restored: true, hadDraft: true, data: fitted.data };
  }

  // `base` may hold fields this page cannot read (carried from a tab on newer
  // rules), so only what the page captures is compared.
  function changed() {
    if (stopped) return false;
    try { return !fitsInto(captured(), base); } catch { return true; }
  }

  // One copy, the latest: a save that would replace another tab's change keeps it
  // here first, and does not save at all when there is no room for it.
  function keepConflict(raw) {
    const conflictKey = key + ":conflict";
    try {
      storage.setItem(conflictKey, raw);
    } catch (error) {
      throw storageFailure(doc, error);
    }
    console.warn("visitor-drafts: another tab changed the same thing; its copy was kept under", conflictKey);
  }

  // Another tab may have written since this tab last read or wrote: what only it
  // changed is taken. Fields the stored record has and this page's rules lack (a
  // tab opened before the owner added a field) are carried through, at any depth.
  function merge(mine) {
    const current = getRaw();
    const record = current == null ? null : parse(current);
    if (!record) return { data: mine, stored: null };
    let data = mine;
    if (current !== lastRaw) {
      const merged = merge3(base, mine, record.data);
      if (merged.conflict) keepConflict(current);
      data = merged.value;
    }
    data = complete(data, record.data);
    return { data, stored: same(data, record.data) ? current : null };
  }

  function adopt(data) {
    const fitted = fit(data);
    if (!fitted || !Object.keys(fitted.data).length) return null;
    applyData(doc, fitted.data, rules);
    try { window.Sap?.refresh?.(); } catch {}
    doc.dispatchEvent(new CustomEvent("clay:drafts-restored", { detail: { restored: true, hadDraft: true, parked: false, external: true } }));
    return fitted.data;
  }

  function write(html) {
    if (stopped) return null;
    if (unparked != null && park(unparked, { keepSlot: true }) === null) {
      throw storageFailure(doc, new Error("an earlier saved copy could not be kept aside"));
    }
    const mine = extractData(new DOMParser().parseFromString(html, "text/html"), rules);
    const current = getRaw();
    if (fitsInto(mine, base) && (current === lastRaw || current == null)) {
      setDraftStoreFailed(false);
      doc.dispatchEvent(new CustomEvent("clay:drafts-saved", { detail: { data: mine, unchanged: true } }));
      return mine;
    }
    const { data, stored } = merge(mine);
    const raw = stored ?? JSON.stringify({ v: RECORD_VERSION, savedAt: now().toISOString(), data });
    if (!stored) {
      try {
        if (!storage) throw new Error("no storage");
        storage.setItem(key, raw);
      } catch (error) {
        throw storageFailure(doc, error);
      }
    }
    const taken = Object.keys(mine).filter((name) => !fitsInto(mine[name], data[name]));
    if (taken.length) adopt(Object.fromEntries(taken.map((name) => [name, data[name]])));
    lastRaw = raw;
    base = data;
    setDraftStoreFailed(false);
    doc.dispatchEvent(new CustomEvent("clay:drafts-saved", { detail: { data } }));
    return data;
  }

  function writeLive() {
    try { write(window.clay.getHTML()); return true; } catch { return false; }
  }

  function flush() {
    if (stopped || !changed()) return true;
    return writeLive();
  }

  // A storage event can arrive late, so read the slot itself rather than trusting
  // the event's value. A tab with its own edit merges at its next save instead.
  function adoptExternal() {
    if (stopped) return false;
    const raw = getRaw();
    if (raw == null || raw === lastRaw || changed()) return false;
    const record = parse(raw);
    const adopted = record && adopt(record.data);
    if (!adopted) return false;
    lastRaw = raw;
    base = { ...base, ...adopted };
    return true;
  }

  function clear() {
    stopped = true;
    unparked = null;
    setDraftStoreFailed(false);
    try { storage.removeItem(key); } catch {}
  }

  return { slot, key, rules, read, restore, write, writeLive, flush, changed, adoptExternal, park, clear, snapshot };
}
