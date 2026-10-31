// The page's readable projection: the saved <article> rendered from the live
// record, parsed back, and a revision hash over what it shows.
//
// No ProseMirror here: the view-mode renderer and the server can load it.
// Everything works on the projection model, an ordered list of items
//   { id, t, parent?, ...fields }
// which is a block's JSON without pos (order replaces it), without w, with
// defaults left out exactly as model.js blockJson leaves them out, with marks
// as runs, and with tables and boards holding ordered arrays instead of
// pos-keyed maps. parse(render(blocks)) equals project(blocks) for every kind.
import { chartModel, renderChartSvg } from "./rich/chart.js";
import { cellText } from "./rich/cell.js";
import { bounded, descriptors, entriesOf, keyOf, normalizeEntries } from "./format-codec.js";
import { nativeAttrs } from "./format-native.js";
import { safeSrc } from "./address.js";

export const ATOM = "￼";
export const BREAK = '@{"type":"hard_break"}';
const CODES = ["b", "i", "s", "c", "a"];
const TAGS = { b: "strong", i: "em", s: "s", c: "code" };
const NEST = ["a", "b", "i", "s", "c"];
const KNOWN = new Set(CODES);

// A block or an inline span the runtime has no schema for rides in an inert
// semantic envelope: canonical JSON, base64url, in one attribute. The block
// envelope holds the block record, the marks envelope the descriptors of one
// run, and the visible text stays the readable fallback.
export const OPAQUE = "data-clay-page-opaque";
export const VALUE = "data-clay-page-value";
export const MARKS = "data-clay-page-marks";
// A person mention's span states its id plainly beside the envelope that carries it:
// the label is the text, and a reader without the editor shows a name, never a link.
export const MENTION = "data-page-mention";
// A date mention reads as a `time` element: the text is the ISO date and `datetime`
// repeats it, so a reader without the editor shows the day and no zone or reminder.
export const DATE = "data-page-date";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENVELOPE = "1";
const STRUCTURAL = new Set(["id", "t", "parent", "c", "m"]);
const knownType = (t) => Object.hasOwn(DEFAULTS, t);

// Mirrors schema.js attrs minus id and pos (a test pins the two together).
export const DEFAULTS = {
  paragraph: { parent: null },
  heading: { parent: null, level: 2, pageIcon: null, pageCoverSrc: null, pageCoverAlt: "", pageCoverX: 50, pageCoverY: 50 },
  list_item: { parent: null, kind: "bullet", indent: 0, checked: false, owner: null, due: null },
  callout: { parent: null },
  quote: { parent: null },
  code_block: { parent: null, lang: "" },
  toggle: { parent: null, open: false, level: null },
  divider: { parent: null },
  toc: { parent: null, maxLevel: null },
  image: { parent: null, src: "", alt: "", caption: "", width: null, align: null },
  file: { parent: null, src: "", name: "", size: null, mime: null },
  table: { parent: null, cols: {}, sort: null },
  chart: { parent: null, source: null, kind: "line", x: null, series: [], title: "", highlight: null },
  board: { parent: null, columns: {}, cards: {} },
  tool: { parent: null, artifact: null, rev: null, state: {} },
  preserved: { parent: null, html: "" },
};
const TEXT = new Set(["paragraph", "heading", "list_item", "callout", "quote", "code_block", "toggle"]);
export const TOC_LABEL = "Table of contents";
export const TOC_ANCHOR = "page-block-";
export const blockAnchor = (id) => `${TOC_ANCHOR}${b64url(String(id ?? ""))}`;
const TOC_MAX_LEVEL = 3;
const tocLevel = (item) => (item.t === "heading"
  ? Math.min(6, Math.max(1, Number.isInteger(item.level) ? item.level : 2))
  : item.t === "toggle" && (item.level === 1 || item.level === 2 || item.level === 3) ? item.level : 0);
const tocTitle = (item) => item.t === "heading" && (item.level ?? 2) === 1 && (item.parent ?? null) === null;
const tocMax = (value) => (Number.isInteger(value) && value >= 1 && value <= 6 ? value : TOC_MAX_LEVEL);
const tocText = (item) => String(item.c ?? "").replace(/[\s\uFFFC]+/gu, " ").trim() || "Untitled";

export function tocEntries(model, maxLevel = TOC_MAX_LEVEL) {
  const max = tocMax(maxLevel);
  const title = model.find(tocTitle) ?? null;
  const out = [];
  for (const item of model) {
    const level = tocLevel(item);
    if (!item.id || !level || level > max || item === title) continue;
    out.push({ id: item.id, level, text: tocText(item) });
  }
  return out;
}

export function tocHtml(item, model) {
  const entries = tocEntries(model, item.maxLevel);
  const root = { level: 0, children: [] };
  const stack = [root];
  for (const entry of entries) {
    while (stack.length > 1 && stack[stack.length - 1].level >= entry.level) stack.pop();
    const node = { ...entry, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const list = (nodes) => `<ul>${nodes.map((node) => `<li><a href="#${blockAnchor(node.id)}">${escText(node.text)}</a>${node.children.length ? list(node.children) : ""}</li>`).join("")}</ul>`;
  const level = item.maxLevel == null ? "" : ` data-max-level="${escAttr(item.maxLevel)}"`;
  return `<nav aria-label="${TOC_LABEL}" data-type="toc" data-id="${escAttr(item.id ?? "")}"${level}>${entries.length ? list(root.children) : ""}</nav>`;
}

const same = (a, b) => canon(a) === canon(b);

// ---- order (model.js orderedIds, without ProseMirror) ----------------------

export function orderedIds(map) {
  return Object.keys(map).sort((x, y) => {
    const px = map[x].pos ?? "", py = map[y].pos ?? "";
    if (px !== py) return px < py ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// ---- envelopes --------------------------------------------------------------

const b64url = (text) => {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (text) => {
  const bin = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

// A key any object would take as its prototype rather than as data.
const hostile = (value) => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hostile);
  return Object.keys(value).some((key) => key === "__proto__" || hostile(value[key]));
};

// One envelope's JSON, under the codec's budget: deeper or larger refuses the
// whole source rather than cutting the envelope short.
function decodeJson(text) {
  let value;
  try { value = JSON.parse(fromB64url(text)); }
  catch { throw new SyntaxError("page: an envelope is not readable canonical JSON"); }
  try { bounded(value); }
  catch (error) { throw new SyntaxError(error.message); }
  if (hostile(value)) throw new SyntaxError("page: an envelope holds a prototype key");
  return value;
}

// A block envelope: a record, whose own type and structural fields are kept
// apart from it.
function recordOf(text) {
  const value = decodeJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("page: a block envelope is not a record");
  if ("id" in value || "pos" in value) throw new SyntaxError("page: a block envelope holds a structural field");
  if ("t" in value && (typeof value.t !== "string" || !value.t)) throw new SyntaxError("page: a block envelope names no type");
  return value;
}

// A marks envelope: the descriptors of one run, validated and put back in the
// codec's canonical order however they arrived.
function entriesOfEnvelope(text) {
  try { return normalizeEntries(decodeJson(text)); }
  catch (error) { throw error instanceof SyntaxError ? error : new SyntaxError(error.message); }
}

// The entries of a marks envelope as it arrived, validated by the same reader
// the article uses.
export const marksEntries = (text) => entriesOfEnvelope(text);

const envelopeOf = (value) => ` ${OPAQUE}="${ENVELOPE}" ${VALUE}="${escAttr(b64url(canon(value)))}"`;
const marksEnvelope = (entries) => (entries.length ? ` ${MARKS}="${escAttr(b64url(JSON.stringify(entries)))}"` : "");

// The same two envelopes as attribute maps, for the internal rich clipboard,
// which writes them onto its own elements instead of an article line.
export const envelopeAttrs = (record) => ({ [OPAQUE]: ENVELOPE, [VALUE]: b64url(canon(record)) });
export const marksAttrs = (entries) => ({ [MARKS]: b64url(JSON.stringify(normalizeEntries(entries))) });

// ---- marks ------------------------------------------------------------------

// inline.js unitsOf: runs [[n, key]] or per-unit keys -> one key per unit, or null.
export function unitsOf(m, length) {
  if (!Array.isArray(m)) return null;
  if (!Array.isArray(m[0])) return m.length === length ? m : null;
  const out = [];
  for (const run of m) {
    if (!Array.isArray(run) || !Number.isInteger(run[0]) || run[0] < 1 || typeof run[1] !== "string" || out.length + run[0] > length) return null;
    for (let i = 0; i < run[0]; i++) out.push(run[1]);
  }
  return out.length === length ? out : null;
}

export function runsOf(units) {
  const out = [];
  for (const key of units) {
    const last = out[out.length - 1];
    if (last && last[1] === key) last[0]++;
    else out.push([1, key]);
  }
  return out;
}

// A mark key as { marks: { b: true, a: ["href"] ... }, native: [...], entries: [...] }:
// the codes this runtime knows, the named descriptors of the four formats it
// writes (format-native.js), and the entries of every mark it has no code for,
// each in the codec's canonical order.
function marksOfKey(key) {
  const marks = {}, native = [];
  if (!key || key[0] === "@") return { marks, native: [], entries: [] };
  const opaque = [];
  for (const desc of descriptors(key)) {
    if (desc.name === undefined) {
      if (KNOWN.has(desc.code)) marks[desc.code] = desc.attrs ?? true;
      else opaque.push(desc);
      continue;
    }
    const attrs = nativeAttrs(desc.name, desc.attrs);
    if (attrs) native.push({ name: desc.name, attrs });
    else opaque.push(desc);
  }
  return { marks, native, entries: opaque.length ? entriesOf(opaque) : [] };
}

// One unit's key, as the record keeps it: the codes this runtime knows, then
// every descriptor it keeps for a newer runtime.
const unitKey = (key, text, i) => {
  if (!key) return "";
  if (key[0] === "@") return key === BREAK && text[i] === ATOM ? key : "";
  const { marks, native, entries } = marksOfKey(key);
  return keyOfMarks(safeMarks(marks), native.length ? [...entries, ...entriesOf(native)] : entries);
};

// A link to a script URL is never kept: it would run on the page's origin when a
// reader clicks it in the saved article.
const SCRIPT_URL = /^(javascript|vbscript|data):/i;
const safeMarks = (marks) => {
  if (marks.a && SCRIPT_URL.test(String(marks.a[0]).replace(/[\u0000-\u0020]/g, ""))) delete marks.a;
  return marks;
};

function keyOfMarks(marks, entries = []) {
  let key = "";
  for (const code of CODES) {
    if (!marks[code]) continue;
    key += code;
    if (Array.isArray(marks[code])) key += JSON.stringify(marks[code]);
  }
  return entries.length ? key + keyOf(entries) : key;
}

// ---- text normalization -----------------------------------------------------

// Whitespace that holds a newline is formatting in every block but code: it
// collapses to one space, and to nothing at either end. The editor never puts
// a newline in such a block (a line break is a hard_break atom), so its own
// text passes through unchanged.
export function normalizeText(c, units) {
  if (!c.includes("\n") && !c.includes("\r")) return { c, units };
  let out = "", keys = [];
  for (let i = 0; i < c.length;) {
    if (/\s/.test(c[i]) && c[i] !== " ") {
      let j = i;
      while (j < c.length && /\s/.test(c[j]) && c[j] !== " ") j++;
      const run = c.slice(i, j);
      if (/[\n\r]/.test(run)) {
        if (i > 0 && j < c.length) { out += " "; keys.push(units ? units[i] : ""); }
      } else {
        out += run;
        if (units) keys.push(...units.slice(i, j)); else keys.push(...run.split("").map(() => ""));
      }
      i = j;
    } else {
      out += c[i];
      keys.push(units ? units[i] : "");
      i++;
    }
  }
  return { c: out, units: keys };
}

function textFields(c, units) {
  const out = { c };
  if (units && units.some(Boolean)) out.m = runsOf(units);
  return out;
}

// ---- the record and its layout ----------------------------------------------

// Every live tag's value merged: { id: block } without w, tombstoned blocks gone.
export function blocksOfValues(values) {
  const blocks = {};
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const deleted = value.deleted || {};
    for (const [id, block] of Object.entries(value.blocks || {})) {
      if (deleted[id] || !block || typeof block !== "object") continue;
      const { w, ...rest } = block;
      blocks[id] = rest;
    }
  }
  return blocks;
}

// Blocks in order, each with the parent and indent the article can show: a
// parent is kept only when that toggle is open on the container stack (the
// outline's rule), and a list item's indent is clamped to one more than the
// item before it in its run, 0 for a run's first item.
function layout(blocks) {
  const out = [];
  const stack = [];
  let prev = null;
  for (const id of orderedIds(blocks)) {
    const b = blocks[id];
    const t = typeof b.t === "string" && b.t ? b.t : null;
    let parent = b.parent ?? null;
    if (parent !== null) {
      const at = stack.lastIndexOf(parent);
      if (at < 0) parent = null;
      stack.length = at < 0 ? 0 : at + 1;
    } else stack.length = 0;
    let indent = 0;
    if (t === "list_item") {
      const runs = prev && prev.t === "list_item" && prev.parent === parent;
      const want = Number.isInteger(b.indent) && b.indent > 0 ? b.indent : 0;
      indent = runs ? Math.min(want, prev.indent + 1) : 0;
    }
    const item = { id, b, t, parent, indent };
    out.push(item);
    prev = item;
    if (t === "toggle") stack.push(id);
  }
  return out;
}

const omitDefaults = (t, fields) => {
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (!(k in DEFAULTS[t]) || !same(v, DEFAULTS[t][k])) out[k] = v;
  return out;
};

const focal = (v) => Math.min(100, Math.max(0, Number.isFinite(+v) && v !== null && v !== "" ? +v : 50));

const columnWidth = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

function cellModel(value) {
  if (value === null || typeof value !== "object" || typeof value.c !== "string") return normalizeText(cellText(value), null).c;
  const raw = unitsOf(value.m, value.c.length);
  const units = raw && raw.map((k, i) => unitKey(k, value.c, i));
  if (!units) return normalizeText(cellText(value), null).c;
  const n = normalizeText(value.c, units);
  const fields = textFields(n.c, n.units);
  return fields.m ? fields : fields.c;
}

function projectTable(b) {
  const cols = b.cols && typeof b.cols === "object" ? b.cols : {};
  const rows = b.rows && typeof b.rows === "object" ? b.rows : {};
  const colIds = orderedIds(cols);
  return {
    cols: colIds.map((id) => ({ id, name: normalizeText(String(cols[id].name ?? ""), null).c, ...(cols[id].kind != null ? { kind: String(cols[id].kind) } : {}), ...(columnWidth(cols[id].width) ? { width: columnWidth(cols[id].width) } : {}) })),
    rows: orderedIds(rows).map((id) => ({ id, cells: Object.fromEntries(colIds.map((col) => [col, cellModel(rows[id].cells?.[col])])) })),
  };
}

function projectBoard(b) {
  const columns = b.columns && typeof b.columns === "object" ? b.columns : {};
  const cards = b.cards && typeof b.cards === "object" ? b.cards : {};
  const colIds = orderedIds(columns);
  const extra = [...new Set(Object.values(cards).map((k) => String(k.col ?? "")))].filter((c) => !columns[c]).sort();
  const order = [...colIds, ...extra];
  const byCol = (col) => orderedIds(Object.fromEntries(Object.entries(cards).filter(([, k]) => String(k.col ?? "") === col)));
  return {
    columns: colIds.map((id) => ({ id, name: normalizeText(String(columns[id].name ?? ""), null).c })),
    cards: order.flatMap((col) => byCol(col).map((id) => {
      const k = cards[id];
      return { id, col, title: normalizeText(String(k.title ?? ""), null).c, ...(k.owner != null ? { owner: String(k.owner) } : {}), ...(k.due != null ? { due: String(k.due) } : {}) };
    })),
  };
}

// The record a block envelope carries: its own type first, then every field the
// runtime keeps for the block, extras included.
const recordOfItem = (item) => {
  const { t, parent: _p, id: _i, ...fields } = item;
  return { t, ...fields };
};

// The fields of a known block the runtime has no schema attribute for. They are
// merged back only when serialized, inside the inert payload.
// Fields the renderer writes as visible markup, which the reader rebuilds from it.
const VISIBLE = { table: new Set(["rows"]) };

const extrasOfItem = (item) => {
  const out = {};
  for (const [k, v] of Object.entries(item)) if (!STRUCTURAL.has(k) && !VISIBLE[item.t]?.has(k) && !(knownType(item.t) && Object.hasOwn(DEFAULTS[item.t], k))) out[k] = v;
  return Object.keys(out).length ? envelopeOf(out) : "";
};

const extrasOfBlock = (t, b) => {
  const out = {};
  for (const [k, v] of Object.entries(b)) if (!STRUCTURAL.has(k) && k !== "pos" && !Object.hasOwn(DEFAULTS[t], k)) out[k] = v;
  return out;
};

function projectOne({ id, b, t, parent, indent }) {
  if (!t) return { id, t: "preserved", html: "" };
  if (!knownType(t)) {
    const { t: _t, id: _id, pos: _pos, parent: _p, ...rest } = b;
    // The text and its marks are kept as they stand, but marks in the older
    // per-unit form come back as runs, so one record has one revision whichever
    // form it was written in.
    if (typeof rest.c === "string" && rest.m !== undefined) {
      const units = unitsOf(rest.m, rest.c.length);
      if (units && units.some(Boolean)) rest.m = runsOf(units);
      else delete rest.m;
    }
    return { id, t, ...(parent ? { parent } : {}), ...rest };
  }
  const { t: _t, id: _id, pos, c, m, rows, cols, columns, cards, parent: _p, indent: _i, ...attrs } = b;
  const extras = extrasOfBlock(t, attrs);
  for (const k of Object.keys(extras)) delete attrs[k];
  const fields = { ...attrs, parent };
  if (t === "list_item") fields.indent = indent;
  if (t === "heading") Object.assign(fields, { level: clampLevel(attrs.level ?? 2), pageCoverSrc: safeSrc(fields.pageCoverSrc ?? null), pageCoverX: focal(fields.pageCoverX), pageCoverY: focal(fields.pageCoverY) });
  if (t === "toggle") fields.level = toggleLevel(attrs.level);
  if (t === "image" && fields.width != null) fields.width = widthOf(String(fields.width));
  if (t === "image") fields.align = alignOf(fields.align);
  if (t === "image" && typeof fields.caption === "string") fields.caption = normalizeText(fields.caption, null).c;
  if (t === "chart" && typeof fields.title === "string") fields.title = normalizeText(fields.title, null).c;
  if (t === "table") Object.assign(fields, projectTable(b));
  else if (t === "board") Object.assign(fields, projectBoard(b));
  const item = { id, t, ...omitDefaults(t, fields), ...extras };
  if (t === "table") { item.cols = fields.cols; item.rows = fields.rows; }
  if (t === "board") { item.columns = fields.columns; item.cards = fields.cards; }
  if (TEXT.has(t)) {
    const text = typeof c === "string" ? c : "";
    const raw = unitsOf(m, text.length);
    const units = raw && raw.map((k, i) => unitKey(k, text, i));
    if (t === "code_block") Object.assign(item, { c: text.replace(/\r\n?/g, "\n") });
    else {
      const n = normalizeText(text, units);
      Object.assign(item, textFields(n.c, n.units));
    }
  }
  return item;
}

// A record a newer writer left in an older writer's envelope, for a block type this
// build knows: the same projection a peer's record gets, without the fields this
// type does not declare.
function knownRecordItem(id, record, parent) {
  const { t } = record;
  const malformed = new SyntaxError(`page: an envelope names the known block type ${t}`);
  if (TEXT.has(t) ? record.c != null && typeof record.c !== "string" : record.c != null || record.m != null) throw malformed;
  let item;
  try { item = projectOne({ id, b: record, t, parent, indent: 0 }); }
  catch { throw malformed; }
  const fields = DEFAULTS[t];
  return Object.fromEntries(Object.entries(item).filter(([k]) => k === "id" || k === "t" || STRUCTURAL.has(k) || k === "rows" || Object.hasOwn(fields, k)));
}

const clampLevel = (l) => Math.min(6, Math.max(1, Number.isInteger(l) ? l : 2));
// A toggle heading is level 1 to 3; anything else is a plain toggle.
export const toggleLevel = (l) => (l === 1 || l === 2 || l === 3 ? l : null);
const widthOf = (s) => (/^\d+$/.test(s) ? Number(s) : s);
export const alignOf = (a) => (a === "left" || a === "right" ? a : null);

export function project(blocks) {
  return layout(blocks).map(projectOne);
}

// ---- revision -----------------------------------------------------------------

export const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}` : JSON.stringify(v ?? null));

// 64 bits from two FNV-1a lanes over UTF-16 units, as 16 hex digits.
export function hash64(text) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    a = Math.imul(a ^ u, 0x01000193) >>> 0;
    b = Math.imul(b ^ u, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export const revOf = (model) => hash64(canon(model));

// ---- render ---------------------------------------------------------------------

const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
const escAttr = (s) => escText(String(s)).replace(/"/g, "&quot;");
const attr = (name, value) => (value === null || value === undefined ? "" : ` ${name}="${escAttr(value)}"`);

// The element each of the four formats is read as in the saved article; the
// text color and the highlight carry their palette key as data-color.
const NATIVE_TAGS = { underline: "u", text_color: "span", highlight: "mark" };

export function renderInline(c, m, marksEnvelopes = true) {
  const units = unitsOf(m, c.length) || [];
  let html = "";
  const open = [];
  const closeTo = (n) => { while (open.length > n) html += `</${open.pop().tag}>`; };
  for (let i = 0; i < c.length;) {
    const key = units[i] || "";
    if (c[i] === ATOM && key[0] === "@") {
      closeTo(0);
      html += key === BREAK ? "<br>" : `<span data-atom="${escAttr(key)}"></span>`;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < c.length && (units[j] || "") === key && !(c[j] === ATOM && key[0] === "@")) j++;
    const { marks, native, entries } = marksOfKey(key);
    const want = NEST.filter((code) => marks[code]).map((code) => ({ code, sig: code + JSON.stringify(marks[code]), tag: code === "a" ? "a" : TAGS[code], href: code === "a" ? marks.a[0] : null }));
    for (const n of native) want.push({ sig: `native${n.name}${canon(n.attrs)}`, tag: NATIVE_TAGS[n.name], color: n.attrs.color ?? null });
    const mention = entries.find((entry) => entry.name === "mention");
    const date = entries.find((entry) => entry.name === "date");
    const day = date && DAY.test(String(date.attrs.date)) ? String(date.attrs.date) : null;
    if (entries.length && marksEnvelopes) want.push({ sig: `marks${canon(entries)}`, tag: day ? "time" : "span", entries, mention: mention?.attrs.id, day });
    let keep = 0;
    while (keep < open.length && keep < want.length && open[keep].sig === want[keep].sig) keep++;
    closeTo(keep);
    for (const w of want.slice(keep)) {
      if (w.entries) html += w.day ? `<time${attr("datetime", w.day)}${attr(DATE, "")}${marksEnvelope(w.entries)}>` : `<span${marksEnvelope(w.entries)}${attr(MENTION, w.mention)}>`;
      else if (w.tag === "a") html += `<a${attr("href", w.href)}>`;
      else html += w.color ? `<${w.tag}${attr("data-color", w.color)}>` : `<${w.tag}>`;
      open.push(w);
    }
    html += escText(c.slice(i, j));
    i = j;
  }
  closeTo(0);
  return html;
}

const inlineOf = (item) => renderInline(item.c ?? "", item.m);
const titleHtml = (item) => `<header${attr("data-id", item.id)} data-page-heading="1"${extrasOfItem(item)}>${item.pageCoverSrc ? `<img data-page-cover${attr("src", item.pageCoverSrc)}${attr("alt", item.pageCoverAlt ?? "")} style="object-position:${item.pageCoverX ?? 50}% ${item.pageCoverY ?? 50}%">` : ""}${item.pageIcon ? `<span data-page-icon aria-hidden="true">${escText(item.pageIcon)}</span>` : ""}<h1>${inlineOf(item)}</h1></header>`;
const toolData = (item) => item.artifact || item.rev || (item.state && Object.keys(item.state).length)
  ? `<script type="application/json" data-tool>${canon({ artifact: item.artifact ?? null, rev: item.rev ?? null, state: item.state ?? {} }).replace(/</g, "\\u003c")}</script>`
  : "";
// A header names its column for every cell under it: the table id and the column
// id together, so a copied column keeps a name no other table shares.
const headerId = (tableId, colId) => `${tableId}-${colId}`;
const cellHtml = (cell) => (typeof cell === "string" ? escText(cell) : cell && typeof cell === "object" ? renderInline(String(cell.c ?? ""), cell.m) : "");
const dataAttrs = (obj) => Object.entries(obj).map(([k, v]) => attr(`data-${k}`, v)).join("");

function renderLeaf(item, clean, tables) {
  const id = attr("data-id", item.id);
  if (!knownType(item.t)) return `<div${id}${envelopeOf(recordOfItem(item))}>${renderInline(item.c ?? "", item.m, false)}</div>`;
  const at = id + extrasOfItem(item);
  switch (item.t) {
    case "paragraph": return `<p${at}>${inlineOf(item)}</p>`;
    case "heading": { const h = `h${item.level ?? 2}`; return `<${h}${at}>${inlineOf(item)}</${h}>`; }
    case "callout": return `<aside${at} class="page-callout">${inlineOf(item)}</aside>`;
    case "quote": return `<blockquote${at}>${inlineOf(item)}</blockquote>`;
    case "code_block": return `<pre${at}${attr("data-lang", item.lang || null)}><code>${escText(item.c ?? "")}</code></pre>`;
    case "divider": return `<hr${at}>`;
    case "image": return `<figure${at} data-type="image"${attr("data-align", item.align ?? null)}><img${attr("src", item.src ?? "")}${attr("alt", item.alt ?? "")}${attr("width", item.width ?? null)}>${item.caption ? `<figcaption>${escText(item.caption)}</figcaption>` : ""}</figure>`;
    case "file": {
      const href = /^(https?:\/\/|\/(?!\/))/i.test(item.src ?? "") ? item.src : null;
      return `<div${at} data-type="file"${attr("data-src", item.src ?? "")}${attr("data-name", item.name ?? "")}${attr("data-size", item.size ?? null)}${attr("data-mime", item.mime ?? null)}><a${attr("href", href)} rel="noopener noreferrer">${escText(item.name || "file")}</a></div>`;
    }
    case "table": {
      const head = item.cols.map((c) => {
        const sorted = item.sort?.col === c.id ? (item.sort.dir === "desc" ? "descending" : "ascending") : null;
        return `<th${attr("data-col", c.id)}${attr("id", headerId(item.id, c.id))}${attr("data-kind", c.kind ?? null)}${attr("data-width", c.width ?? null)}${attr("style", c.width ? `width:${c.width}px` : null)} scope="col"${attr("aria-sort", sorted)}>${escText(c.name)}</th>`;
      }).join("");
      const body = item.rows.map((r) => `<tr${attr("data-id", r.id)}>${item.cols.map((c) => `<td${attr("headers", headerId(item.id, c.id))}>${cellHtml(r.cells[c.id])}</td>`).join("")}</tr>`).join("\n");
      return `<table${at} aria-label="Table"${attr("data-sort", item.sort != null ? JSON.stringify(item.sort) : null)}>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
    }
    case "chart": {
      const data = dataAttrs({ source: item.source ?? null, kind: item.kind ?? null, x: item.x ?? null, series: item.series ? JSON.stringify(item.series) : null, highlight: item.highlight ?? null });
      const chart = chartModel({ id: item.id, type: item.kind ?? "line", x: item.x, series: item.series ?? [], title: item.title ?? "", highlight: item.highlight }, tables.get(item.source));
      return `<figure${at} data-type="chart"${data}>${renderChartSvg(chart, { width: 640, height: 320 })}<figcaption>${escText(item.title ?? "")}</figcaption></figure>`;
    }
    case "board": {
      const cols = [...item.columns.map((c) => ({ ...c, known: true })), ...[...new Set(item.cards.map((k) => k.col))].filter((col) => !item.columns.some((c) => c.id === col)).map((col) => ({ id: col, known: false }))];
      const parts = cols.map((col) => {
        const cards = item.cards.filter((k) => k.col === col.id).map((k) => `<li${attr("data-id", k.id)}${attr("data-owner", k.owner ?? null)}${attr("data-due", k.due ?? null)}>${escText(k.title)}</li>`).join("");
        return `<div${attr("data-col", col.id)}${col.known ? "" : " data-missing"}>${col.known ? `<h4>${escText(col.name)}</h4>` : ""}<ul>${cards}</ul></div>`;
      });
      return `<section${at} data-type="board">\n${parts.join("\n")}\n</section>`;
    }
    case "tool": return `<section${at} data-type="tool">${toolData(item)}</section>`;
    case "preserved": return preservedHtml(item, clean, at);
    default: return "";
  }
}

// Markup the schema has no node for, kept as authored inside a marked wrapper.
const preservedHtml = (item, clean, id = attr("data-id", item.id)) => `<div${id} data-type="preserved">${clean.preserved(item.html || "")}</div>`;

const RAW = { preserved: (html) => html, fallback: (html) => html };

// Raw fragments as the parser of doc reads them back: unclosed or misnested tags
// balanced, so they cannot swallow the blocks after them. A tool's fallback is
// static markup (its code mounts from the store), so scripts, event handlers and
// script URLs are removed from it; preserved markup is kept as authored.
export function fragmentCleaner(doc) {
  const balance = (html, strip) => {
    if (!html) return "";
    const t = doc.createElement("template");
    t.innerHTML = html;
    if (strip) {
      for (const el of t.content.querySelectorAll("script")) el.remove();
      for (const el of t.content.querySelectorAll("*")) {
        for (const { name, value } of [...el.attributes]) {
          if (/^on/i.test(name) || (/^(href|src|action|formaction|xlink:href)$/i.test(name) && SCRIPT_URL.test(value.replace(/[\u0000-\u0020]/g, "")))) el.removeAttribute(name);
        }
      }
    }
    return t.innerHTML;
  };
  return { preserved: (html) => balance(html, false), fallback: (html) => balance(html, true) };
}

// The article's inner HTML: one line per block, and one line per list run
// (whitespace inside an <li> would be text). Tool fallbacks come from fallbackOf(id).
export function renderModel(model, { fallbackOf = () => "", clean = RAW } = {}) {
  const lines = [];
  const tables = new Map(model.filter((item) => item.t === "table").map((item) => [item.id, item]));
  const title = model.find(tocTitle) ?? null;
  const stack = [null];
  const lists = [];
  const add = (s) => { if (lists.length) lines[lines.length - 1] += s; else lines.push(s); };
  const closeLists = () => { while (lists.length) { const tag = lists[lists.length - 1]; lines[lines.length - 1] += `</li></${tag}>`; lists.pop(); } };
  for (const item of model) {
    const parent = item.parent ?? null;
    while (stack.length > 1 && stack[stack.length - 1] !== parent) { closeLists(); add("</details>"); stack.pop(); }
    if (item.t !== "list_item") closeLists();
    if (item.t === "list_item") {
      const d = item.indent ?? 0;
      const tag = item.kind === "ordered" ? "ol" : "ul";
      while (lists.length > d + 1) { add(`</li></${lists[lists.length - 1]}>`); lists.pop(); }
      if (lists.length === d + 1) {
        add(lists[d] === tag ? "</li>" : `</li></${lists[d]}>`);
        if (lists[d] !== tag) lists.pop();
      }
      if (lists.length < d + 1) { add(`<${tag}>`); lists.push(tag); }
      const box = item.kind === "check" ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}>` : "";
      add(`<li${attr("data-id", item.id)}${attr("data-owner", item.owner ?? null)}${attr("data-due", item.due ?? null)}${extrasOfItem(item)}>${box}${inlineOf(item)}`);
      continue;
    }
    if (item.t === "toggle") {
      const h = toggleLevel(item.level);
      add(`<details${attr("data-id", item.id)}${extrasOfItem(item)}${item.open ? " open" : ""}>${h ? `<summary><h${h}>${inlineOf(item)}</h${h}></summary>` : `<summary>${inlineOf(item)}</summary>`}`);
      stack.push(item.id);
      continue;
    }
    if (item.t === "tool") { add(`<section${attr("data-id", item.id)} data-type="tool">${toolData(item)}${clean.fallback(fallbackOf(item.id))}</section>`); continue; }
    if (item.t === "toc") { add(tocHtml(item, model)); continue; }
    if (item === title && (item.pageIcon || item.pageCoverSrc)) { add(titleHtml(item)); continue; }
    add(renderLeaf(item, clean, tables));
  }
  closeLists();
  while (stack.length > 1) { add("</details>"); stack.pop(); }
  return lines.join("\n");
}

export function renderBlocks(blocks, opts) {
  const model = project(blocks);
  return { html: renderModel(model, opts), rev: revOf(model), model };
}

// ---- parse ------------------------------------------------------------------------

const DROP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
const INLINE_TAGS = new Set(["A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "CODE", "DATA", "DEL", "DFN", "EM", "FONT", "I", "INS", "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR"]);

// The named descriptor an inline element stands for, when it is one of the four
// formats: <u>, <mark> and a <span data-color> with a palette key. Anything else
// is not a format this runtime reads natively.
function nativeOfEl(tag, el) {
  if (tag === "u") return { name: "underline", attrs: {} };
  if (tag !== "mark" && tag !== "span") return null;
  if (tag === "span" && !el.hasAttribute("data-color")) return null;
  const name = tag === "mark" ? "highlight" : "text_color";
  return { name, attrs: { color: el.getAttribute("data-color") } };
}

// Inline content of el as { c, units }, minus the children skip(child) names.
function inlineOfEl(el, skip = () => false) {
  let c = "";
  const units = [];
  const walk = (node, marks, entries) => {
    for (const child of node.childNodes) {
      if (skip(child)) continue;
      if (child.nodeType === 3) {
        c += child.data;
        const key = keyOfMarks(safeMarks({ ...marks }), entries);
        for (let i = 0; i < child.data.length; i++) units.push(key);
        continue;
      }
      if (child.nodeType !== 1 || DROP_TAGS.has(child.tagName)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "br") { c += ATOM; units.push(BREAK); continue; }
      if (tag === "span" && child.hasAttribute("data-atom")) { c += ATOM; units.push(child.getAttribute("data-atom")); continue; }
      const next = { ...marks };
      if ((tag === "span" || tag === "time") && child.hasAttribute(MARKS)) {
        walk(child, next, normalizeEntries([...entries, ...entriesOfEnvelope(child.getAttribute(MARKS))]));
        continue;
      }
      if (tag === "strong" || tag === "b") next.b = true;
      else if (tag === "em" || tag === "i") next.i = true;
      else if (tag === "s" || tag === "del" || tag === "strike") next.s = true;
      else if (tag === "code") next.c = true;
      else if (tag === "a" && child.hasAttribute("href")) next.a = [child.getAttribute("href")];
      const named = nativeOfEl(tag, child);
      walk(child, next, named ? [...entries, named] : entries);
    }
  };
  walk(el, {}, []);
  return normalizeText(c, units);
}

const text = (el) => normalizeText(el ? el.textContent : "", null).c;

// The block envelope an element carries, or null. A malformed, oversized or
// hostile one refuses the whole article: it never falls back to plain text.
const envelopeAt = (el) => {
  if (!el.hasAttribute(OPAQUE)) return null;
  if (el.getAttribute(OPAQUE) !== ENVELOPE) throw new SyntaxError(`page: unknown envelope version ${el.getAttribute(OPAQUE)}`);
  const text = el.getAttribute(VALUE);
  if (text === null) throw new SyntaxError("page: a block envelope holds no value");
  return recordOf(text);
};

// The record a block envelope carries, validated; null when the element carries
// no envelope at all.
export const envelopeRecord = (el) => envelopeAt(el);

// The extras a known element's envelope adds to it.
const extrasAt = (el) => {
  const value = envelopeAt(el);
  return value && typeof value.t !== "string" ? value : null;
};

export function parseArticle(article) {
  const items = [];
  const walk = (container, parent) => {
    let loose = null;
    const flushLoose = () => {
      if (!loose) return;
      const n = inlineOfEl(loose);
      if (n.c) items.push({ id: null, t: "paragraph", parent, ...textFields(n.c, n.units) });
      loose = null;
    };
    for (const node of [...container.childNodes]) {
      if (node.nodeType === 3 && !node.data.trim()) { if (loose) loose.appendChild(node.cloneNode()); continue; }
      if (node.nodeType === 8 || (node.nodeType === 1 && DROP_TAGS.has(node.tagName))) continue;
      if (node.nodeType === 3 || (node.nodeType === 1 && INLINE_TAGS.has(node.tagName))) {
        loose ??= container.ownerDocument.createElement("p");
        loose.appendChild(node.cloneNode(true));
        continue;
      }
      flushLoose();
      if (node.nodeType !== 1) continue;
      blockOf(node, parent);
    }
    flushLoose();
  };
  const idOf = (el) => el.getAttribute("data-id") || null;
  const push = (el, t, parent, fields) => {
    const extra = extrasAt(el);
    items.push({ id: idOf(el), t, parent, ...(extra ? { ...extra, ...fields } : fields) });
  };
  const list = (el, parent, depth) => {
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      const box = [...li.childNodes].find((n) => n.nodeType === 1 && n.tagName === "INPUT" && (n.getAttribute("type") || "").toLowerCase() === "checkbox");
      const nested = [...li.children].filter((n) => n.tagName === "UL" || n.tagName === "OL");
      const n = inlineOfEl(li, (child) => child === box || nested.includes(child));
      const kind = box ? "check" : el.tagName === "OL" ? "ordered" : "bullet";
      const fields = { parent, kind, indent: depth, checked: !!(box && box.hasAttribute("checked")), owner: li.getAttribute("data-owner"), due: li.getAttribute("data-due") };
      items.push({ id: idOf(li), t: "list_item", ...omitDefaults("list_item", fields), ...(extrasAt(li) ?? {}), ...textFields(n.c, n.units) });
      for (const sub of nested) list(sub, parent, depth + 1);
    }
  };
  const blockOf = (el, parent) => {
    const tag = el.tagName;
    const P = { parent };
    const record = envelopeAt(el);
    if (record && typeof record.t === "string") {
      if (record.t === "opaque_block") throw new SyntaxError(`page: an envelope names the known block type ${record.t}`);
      if (knownType(record.t)) {
        items.push(knownRecordItem(idOf(el), record, parent));
        return;
      }
      const { t, ...fields } = record;
      items.push({ id: idOf(el), t, parent, ...fields });
      return;
    }
    const onlyImage = tag === "P" && el.children.length === 1 && el.children[0].tagName === "IMG" && !el.textContent.trim();
    if (tag === "P" && !onlyImage) return push(el, "paragraph", parent, { ...omitDefaults("paragraph", P), ...tf(el) });
    if (/^H[1-6]$/.test(tag)) return push(el, "heading", parent, { ...omitDefaults("heading", { ...P, level: +tag[1] }), ...tf(el) });
    if (tag === "HEADER" && el.getAttribute("data-page-heading") === ENVELOPE) {
      const icon = el.querySelector(":scope > [data-page-icon]");
      const cover = el.querySelector(":scope > img");
      const [, x, y] = /object-position:\s*([-\d.]+)%\s+([-\d.]+)%/.exec(cover?.getAttribute("style") ?? "") ?? [];
      const cover0 = cover ? { pageCoverSrc: safeSrc(cover.getAttribute("src")), pageCoverAlt: cover.getAttribute("alt") ?? "", pageCoverX: focal(x), pageCoverY: focal(y) } : {};
      return push(el, "heading", parent, { ...omitDefaults("heading", { ...P, level: 1, pageIcon: icon ? icon.textContent : null, ...cover0 }), ...tf(el.querySelector(":scope > h1")) });
    }
    if (tag === "ASIDE") return push(el, "callout", parent, { ...omitDefaults("callout", P), ...tf(el) });
    if (tag === "BLOCKQUOTE") return push(el, "quote", parent, { ...omitDefaults("quote", P), ...tf(el) });
    if (tag === "PRE") {
      const code = el.querySelector(":scope > code");
      return push(el, "code_block", parent, { ...omitDefaults("code_block", { ...P, lang: el.getAttribute("data-lang") || "" }), c: (code || el).textContent });
    }
    if (tag === "HR") return push(el, "divider", parent, omitDefaults("divider", P));
    if (tag === "NAV" && el.getAttribute("aria-label") === TOC_LABEL) {
      const maxLevel = +(el.getAttribute("data-max-level") ?? 0);
      return push(el, "toc", parent, omitDefaults("toc", { ...P, maxLevel: maxLevel >= 1 && maxLevel <= 6 ? maxLevel : null }));
    }
    if (tag === "UL" || tag === "OL") return list(el, parent, 0);
    if (tag === "DETAILS") {
      const summary = el.querySelector(":scope > summary");
      const head = summary?.querySelector(":scope > h1, :scope > h2, :scope > h3");
      const at = items.length;
      push(el, "toggle", parent, { ...omitDefaults("toggle", { ...P, open: el.hasAttribute("open"), level: head ? Number(head.tagName[1]) : null }), ...tf(summary) });
      const body = el.ownerDocument.createElement("div");
      for (const n of [...el.childNodes]) if (n !== summary) body.appendChild(n.cloneNode(true));
      walk(body, { ref: at });
      return;
    }
    if (tag === "FIGURE" && el.getAttribute("data-type") === "chart") {
      const d = (k) => el.getAttribute(`data-${k}`);
      let series = [];
      try { series = JSON.parse(d("series") || "[]"); } catch {}
      return push(el, "chart", parent, omitDefaults("chart", { ...P, source: d("source"), kind: d("kind") || "line", x: d("x"), series, title: text(el.querySelector(":scope > figcaption")), highlight: d("highlight") }));
    }
    if (tag === "DIV" && el.getAttribute("data-type") === "file") {
      const size = el.getAttribute("data-size");
      return push(el, "file", parent, omitDefaults("file", { ...P, src: el.getAttribute("data-src") || "", name: el.getAttribute("data-name") || "", size: size === null || size === "" || !Number.isFinite(+size) ? null : +size, mime: el.getAttribute("data-mime") || null }));
    }
    const img = tag === "IMG" ? el : (tag === "FIGURE" || onlyImage) ? el.querySelector(":scope > img") : null;
    if (img) {
      const w = img.getAttribute("width");
      return push(el, "image", parent, omitDefaults("image", { ...P, src: img.getAttribute("src") || "", alt: img.getAttribute("alt") || "", caption: tag === "FIGURE" ? text(el.querySelector(":scope > figcaption")) : "", width: w === null ? null : widthOf(w), align: tag === "FIGURE" ? alignOf(el.getAttribute("data-align")) : null }));
    }
    if (tag === "TABLE") return push(el, "table", parent, tableOf(el, P));
    if (tag === "SECTION" && el.getAttribute("data-type") === "board") return push(el, "board", parent, boardOf(el, P));
    if (tag === "SECTION" && el.getAttribute("data-type") === "tool") {
      const data = el.querySelector(':scope > script[type="application/json"][data-tool]');
      let tool = {};
      try { tool = data ? JSON.parse(data.textContent) : {}; } catch {}
      return push(el, "tool", parent, omitDefaults("tool", { ...P, artifact: tool.artifact ?? null, rev: tool.rev ?? null, state: tool.state ?? {} }));
    }
    if (tag === "DIV" && el.getAttribute("data-type") === "preserved") return push(el, "preserved", parent, omitDefaults("preserved", { ...P, html: el.innerHTML }));
    if (tag === "DIV" && [...el.children].every((c) => INLINE_TAGS.has(c.tagName))) return push(el, "paragraph", parent, { ...omitDefaults("paragraph", P), ...tf(el) });
    const copy = el.cloneNode(true);
    copy.removeAttribute("data-id");
    return push(el, "preserved", parent, omitDefaults("preserved", { ...P, html: copy.outerHTML }));
  };
  const tf = (el) => { const n = el ? inlineOfEl(el) : { c: "", units: [] }; return textFields(n.c, n.units); };
  const tableOf = (el, P) => {
    const headRow = el.querySelector(":scope > thead > tr") || null;
    const ths = headRow ? [...headRow.children] : [];
    const cols = ths.map((th) => ({ id: th.getAttribute("data-col"), name: text(th), ...(th.hasAttribute("data-kind") ? { kind: th.getAttribute("data-kind") } : {}), ...(columnWidth(Number(th.getAttribute("data-width"))) ? { width: columnWidth(Number(th.getAttribute("data-width"))) } : {}) }));
    const trs = [...el.querySelectorAll(":scope > tbody > tr, :scope > tr")];
    const width = Math.max(cols.length, ...trs.map((tr) => tr.children.length), 0);
    while (cols.length < width) cols.push({ id: null, name: "" });
    const rows = trs.map((tr) => ({ id: tr.getAttribute("data-id"), cellsAt: [...tr.children].map((td) => { const fields = tf(td); return fields.m ? fields : fields.c; }) }));
    let sort = null;
    try { sort = el.hasAttribute("data-sort") ? JSON.parse(el.getAttribute("data-sort")) : null; } catch {}
    return { ...omitDefaults("table", { ...P, sort }), cols, rows };
  };
  const boardOf = (el, P) => {
    const columns = [], cards = [];
    for (const div of el.querySelectorAll(":scope > div[data-col], :scope > div")) {
      const col = div.getAttribute("data-col");
      const missing = div.hasAttribute("data-missing");
      const ref = missing ? { id: col } : { id: col, name: text(div.querySelector(":scope > h4")) };
      if (!missing) columns.push(ref);
      for (const li of div.querySelectorAll(":scope > ul > li")) {
        cards.push({ id: li.getAttribute("data-id"), colRef: ref, title: text(li), ...(li.hasAttribute("data-owner") ? { owner: li.getAttribute("data-owner") } : {}), ...(li.hasAttribute("data-due") ? { due: li.getAttribute("data-due") } : {}) });
      }
    }
    return { ...omitDefaults("board", P), columns, cards };
  };
  walk(article, null);
  return items;
}

// Ids for the parsed items. A data-id the page knows (known: id -> projected
// item) keeps its block; of two holders, the one whose content equals the
// known item keeps it, else the first. Everything else gets a fresh id that
// depends only on the seed and its place among the fresh ones, so the same
// file adopted twice gets the same ids.
export function resolveIds(items, { seed = "", known = new Map(), taken = new Set() } = {}) {
  let fresh = 0;
  const mint = (prefix) => `${prefix}-a${hash64(`${seed}|${prefix}|${fresh++}`).slice(0, 12)}`;
  const holders = new Map();
  items.forEach((item, i) => { if (item.id) (holders.get(item.id) ?? holders.set(item.id, []).get(item.id)).push(i); });
  const keeper = new Map();
  for (const [id, list] of holders) {
    const k = known.get(id);
    const eq = k ? list.find((i) => same(stripId(items[i]), stripId(k))) : undefined;
    keeper.set(id, eq ?? list[0]);
  }
  const ids = items.map((item, i) => (item.id && !(/^~|~\d+$/).test(item.id) && keeper.get(item.id) === i ? item.id : mint("b")));
  const out = items.map((item, i) => {
    const { id, parent, ...rest } = item;
    const p = parent && typeof parent === "object" ? ids[parent.ref] : parent;
    const res = { id: ids[i], t: rest.t, ...(p ? { parent: p } : {}), ...without(rest, ["t"]) };
    if (res.t === "table") {
      const seenC = new Set(), seenR = new Set();
      res.cols = res.cols.map((c) => ({ ...c, id: c.id && !seenC.has(c.id) ? (seenC.add(c.id), c.id) : mint("c") }));
      res.rows = res.rows.map((r) => ({ id: r.id && !seenR.has(r.id) ? (seenR.add(r.id), r.id) : mint("r"), cells: Object.fromEntries(res.cols.map((c, j) => [c.id, r.cellsAt[j] ?? ""])) }));
    }
    if (res.t === "board") {
      const seenK = new Set();
      const seenCol = new Set();
      for (const col of res.columns) { if (!col.id || seenCol.has(col.id)) col.id = mint("c"); seenCol.add(col.id); }
      res.cards = res.cards.map(({ colRef, ...k }) => ({ id: k.id && !seenK.has(k.id) ? (seenK.add(k.id), k.id) : mint("k"), col: colRef.id ?? "", title: k.title, ...(k.owner != null ? { owner: k.owner } : {}), ...(k.due != null ? { due: k.due } : {}) }));
      res.columns = res.columns.map(({ id, name }) => ({ id, name }));
    }
    return res;
  });
  void taken;
  return out;
}

const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const stripId = (item) => without(item, ["id", "parent"]);

export function parseModel(article, opts = {}) {
  return resolveIds(parseArticle(article), opts);
}
