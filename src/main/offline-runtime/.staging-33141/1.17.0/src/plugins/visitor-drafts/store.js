import { extractData, applyData, engine } from "../../vendor/hyper-html-api-data.vendor.js";
import { draftSlot, setDraftStoreFailed } from "../../core/draft-mode.js";

export const KEY_PREFIX = "clay:visitor-drafts:";
export const RECORD_VERSION = 1;

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

// Three-way merge of this tab's value with another tab's, from the value both
// started at. Top-level keys and nested objects merge per field. A list both tabs
// changed is a conflict, since a card moved between lists or a reorder cannot be
// told apart from a delete and an add: this tab's value wins.
export function merge3(base, mine, theirs) {
  if (same(mine, theirs) || same(theirs, base)) return { value: mine, conflict: false };
  if (same(mine, base)) return { value: theirs, conflict: false };
  if (isPlain(mine) && isPlain(theirs)) {
    const value = {};
    let conflict = false;
    for (const name of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const part = merge3(isPlain(base) ? base[name] : undefined, mine[name], theirs[name]);
      conflict ||= part.conflict;
      if (part.value !== undefined) value[name] = part.value;
    }
    return { value, conflict };
  }
  return { value: mine, conflict: true };
}

function storageFailure(doc, error) {
  setDraftStoreFailed(true);
  doc.dispatchEvent(new CustomEvent("clay:drafts-store-failed", { detail: { error } }));
  const failure = new Error("Couldn't save in this browser. Storage is full or turned off.");
  failure.code = "draft-storage";
  return failure;
}

export function createStore({ doc = document, storage = safeStorage(), now = () => new Date() } = {}) {
  const slot = draftSlot(doc);
  const key = KEY_PREFIX + slot;
  const rules = engine.findRulesIn(doc, "api").rules;

  let lastRaw = null;
  let base = null;
  let unparked = null;
  let stopped = false;

  function getRaw() {
    try { return storage ? storage.getItem(key) : null; } catch { return null; }
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
