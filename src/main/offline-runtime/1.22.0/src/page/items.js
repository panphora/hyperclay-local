// What the block menu lists and how a pick changes the page: the block types a
// textblock can be turned into, the things that can be inserted, how a search
// ranks them, and the transactions behind them. Pure data and transactions: the
// menu itself lives in chrome.js.
import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { isKey, keyBetween, newId } from "./model.js";
import { isOpaque, opaqueMark } from "./format-codec.js";
import { outline, subtreeRange } from "./blocks.js";
import { asStep } from "./blocksel.js";
import { pickFiles, hostPlace } from "./media.js";
import { makeTable, insertTableNode } from "./table.js";
import { pickCsv } from "./csv-import.js";
import { makeBoard, insertBoardNode } from "./board.js";
import { chartTables } from "./chart-tables.js";
import { viewFeatures } from "./view-hooks.js";
import { runFormatted } from "./format-command.js";

const { TextSelection } = state;
const N = schema.nodes;

export const BLOCK_TYPES = [
  { key: "text", label: "Text", description: "Plain writing", icon: "T", type: "paragraph", aliases: ["p", "paragraph", "plain"] },
  { key: "h1", label: "Heading 1", description: "Big section heading", icon: "H1", type: "heading", attrs: { level: 1 }, hint: "#", aliases: ["h1", "title"] },
  { key: "h2", label: "Heading 2", description: "Medium section heading", icon: "H2", type: "heading", attrs: { level: 2 }, hint: "##", aliases: ["h2", "subtitle"] },
  { key: "h3", label: "Heading 3", description: "Small section heading", icon: "H3", type: "heading", attrs: { level: 3 }, hint: "###", aliases: ["h3"] },
  { key: "bullet", label: "Bulleted list", description: "A simple list", icon: "•", type: "list_item", attrs: { kind: "bullet" }, hint: "-", aliases: ["ul", "bullet", "list", "unordered"] },
  { key: "ordered", label: "Numbered list", description: "A list with numbers", icon: "1.", type: "list_item", attrs: { kind: "ordered" }, hint: "1.", aliases: ["ol", "num", "numbered", "ordered"] },
  { key: "check", label: "Checklist", description: "Tasks to tick off", icon: "☐", type: "list_item", attrs: { kind: "check" }, hint: "[]", aliases: ["todo", "to-do", "task", "check", "checkbox"] },
  { key: "toggle", label: "Toggle", description: "Hide details under a line", icon: "▸", type: "toggle", attrs: { open: true }, hint: ">", aliases: ["collapse", "details", "fold"] },
  { key: "toggle-h1", label: "Toggle heading 1", description: "Collapsible heading", icon: "H1", type: "toggle", attrs: { open: true, level: 1 }, aliases: ["toggle heading"] },
  { key: "toggle-h2", label: "Toggle heading 2", description: "Collapsible heading", icon: "H2", type: "toggle", attrs: { open: true, level: 2 }, aliases: ["toggle heading"] },
  { key: "toggle-h3", label: "Toggle heading 3", description: "Collapsible heading", icon: "H3", type: "toggle", attrs: { open: true, level: 3 }, aliases: ["toggle heading"] },
  { key: "callout", label: "Callout", description: "Make a note stand out", icon: "!", type: "callout", aliases: ["note", "aside", "info"] },
  { key: "quote", label: "Quote", description: "Set text apart as a quotation", icon: "\u201c", type: "quote", hint: "\"", aliases: ["blockquote", "quotation", "cite"] },
  { key: "code", label: "Code", description: "Code with highlighting", icon: "</>", type: "code_block", hint: "```", aliases: ["pre", "snippet"] },
];

export const INSERT_ITEMS = [
  { key: "divider", label: "Divider", description: "A line between sections", icon: "—", hint: "---", aliases: ["hr", "line", "separator", "rule"], insert: "divider" },
  { key: "toc", label: "Table of contents", description: "Links to this page's headings", icon: "≡", aliases: ["toc", "contents", "outline", "index"], insert: "toc" },
  { key: "image", label: "Image", description: "Upload or paste a picture", icon: "▣", aliases: ["img", "picture", "photo"], insert: "image" },
  { key: "file", label: "File", description: "Attach any file", icon: "⎘", aliases: ["upload", "attachment", "pdf"], insert: "file" },
  { key: "table", label: "Table", description: "Rows and columns, paste from a spreadsheet", icon: "▦", aliases: ["grid", "spreadsheet"], insert: "table" },
  { key: "csv", label: "Import CSV…", description: "Turn a CSV file into a table", icon: "⇧", aliases: ["comma separated", "import"], insert: "csv" },
  { key: "board", label: "Board", description: "Cards in columns, like a kanban", icon: "▥", aliases: ["kanban", "cards", "columns", "status"], insert: "board" },
  { key: "mention", label: "Mention", description: "Name someone on the page", icon: "@", aliases: ["person", "people", "assign"], command: "mentions" },
  { key: "date", label: "Date", description: "Today, tomorrow or a calendar day", icon: "▧", aliases: ["calendar", "today", "tomorrow", "due"], command: "dates" },
  { key: "emoji", label: "Emoji", description: "Insert one glyph", icon: "☺", aliases: ["smiley", "glyph", "symbol"], command: "emoji" },
  { key: "import-markdown", label: "Import Markdown…", description: "Turn a Markdown file into blocks", icon: "M↓", aliases: ["md", "markdown", "import"], command: "importMarkdown" },
];

export const CHART_ITEM = { key: "chart", label: "Chart", description: "A bar or line chart from a table", icon: "📊", aliases: ["graph", "plot", "bar", "line"], insert: "chart" };

// The chart module and its view part load together, before the block draws: a
// document that never takes a chart never fetches either.
export const loadChartPart = (view) => (viewFeatures.get(view)?.ensure("chart") ?? Promise.resolve()).catch(() => {}).then(() => (view.isDestroyed ? null : import("./chart.js")));

export const MENU_ITEMS = [...BLOCK_TYPES, ...INSERT_ITEMS];

export const insertItemsFor = (st, items = MENU_ITEMS) => (chartTables(st.doc).length ? [...items, CHART_ITEM] : items);

// Which entry of BLOCK_TYPES a block is, for the toolbar's "Text ▾" label.
export function blockTypeOf(node) {
  const t = node.type.name;
  return BLOCK_TYPES.find((b) => b.type === t && (!b.attrs
    || (t === "heading" || t === "toggle" ? (b.attrs.level ?? null) === (node.attrs.level ?? null)
      : t === "list_item" ? b.attrs.kind === node.attrs.kind : true))) ?? BLOCK_TYPES[0];
}

const startOf = (doc, index) => {
  let at = 0;
  for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
  return at;
};

// Retype the top-level textblock at `index` of tr.doc into `item`. It keeps its
// id, pos and parent; a list item turned into another list kind keeps its indent.
export function retype(tr, index, item) {
  const at = startOf(tr.doc, index);
  const node = tr.doc.child(index);
  const keep = { id: node.attrs.id, pos: node.attrs.pos, parent: node.attrs.parent };
  if (node.type === N.list_item && item.type === "list_item") keep.indent = node.attrs.indent;
  return tr.setBlockType(at + 1, at + node.nodeSize - 1, N[item.type], { ...keep, ...(item.attrs || {}) });
}

// A command this runtime cannot carry out on the content it was given: the
// document and the clipboard keep what they hold.
export const REFUSED = Object.freeze({ status: "refused", code: "unsupported-format" });

const opaqueType = opaqueMark([]).type;
const holdsOpaque = (node) => {
  let found = false;
  node.forEach((child) => { if (!found && child.marks.some(isOpaque)) found = true; });
  return found;
};

// A block that is not a textblock cannot be turned into anything, and one this
// runtime cannot rewrite, or whose opaque marks the target type would erase, is
// refused rather than converted into something that lost them.
export function canTurnInto(node, item) {
  if (!node.isTextblock || node.type === N.opaque_block) return false;
  return !holdsOpaque(node) || N[item.type].allowsMarkType(opaqueType);
}

export function turnInto(st, index, item) {
  const node = st.doc.child(index);
  if (!node.isTextblock) return null;
  return canTurnInto(node, item) ? retype(st.tr, index, item) : REFUSED;
}

// A toggle heading writes a `level` only a newer page format reads, so its first
// write asks the format gate.
export const isToggleHeading = (item) => item.type === "toggle" && item.attrs?.level != null;

const indexOfId = (doc, id) => {
  let found = -1;
  doc.forEach((n, _, i) => { if (n.attrs.id === id) found = i; });
  return found;
};
const stale = { ok: false, code: "stale-target" };

// Turn every block named by `ids` into `item`. A block type from a later format,
// a quote or a toggle heading, asks the format gate first; after it answers the
// blocks are found again by id: one a peer moved away refuses instead of handing
// the type to whatever took its place.
export function turnBlocks(view, item, ids) {
  const at = () => ids.map((id) => indexOfId(view.state.doc, id));
  const write = () => {
    const found = at();
    if (found.includes(-1)) return stale;
    if (found.some((i) => !canTurnInto(view.state.doc.child(i), item))) return REFUSED;
    const tr = view.state.tr;
    for (const i of found) retype(tr, i, item);
    view.dispatch(asStep(tr).scrollIntoView());
    view.focus();
    return { ok: true };
  };
  if (isToggleHeading(item)) return runFormatted(view, write);
  // A block type from a later format, like the turn into a quote, asks the gate
  // before it writes, and a refusal is a notice rather than a change.
  if (item.type === "quote") return import("./format-native-commands.js").then((menu) => (view.isDestroyed ? false : menu.gateTurn(view, write)));
  return write();
}

// A new empty paragraph after the block at `index` and its subtree, at the
// block's own level, with the caret in it.
export function insertAfter(st, index, tr = st.tr) {
  const ents = outline(tr.doc);
  const { to } = subtreeRange(ents, index);
  const node = tr.doc.child(index);
  tr.insert(to, N.paragraph.create({ parent: node.attrs.parent ?? null }));
  return tr.setSelection(TextSelection.create(tr.doc, to + 1));
}

// A key strictly between two neighbours, or null when either is not a usable
// key (identityPlugin then repairs it).
const keyAfter = (pos, next) => (isKey(pos) && (next === null || (isKey(next) && pos < next)) ? keyBetween(pos, next) : null);

// The empty paragraph at `index` becomes a divider that keeps its id, pos and
// parent, followed by a new empty paragraph holding the caret. The new
// paragraph is given its id and key here, so the identity plugin appends no
// transaction after this one (which would end undoInputRule for a `---` rule).
export function replaceWithDivider(tr, index) {
  const at = startOf(tr.doc, index);
  const node = tr.doc.child(index);
  const next = tr.doc.maybeChild(index + 1);
  const { id, pos, parent } = node.attrs;
  tr.replaceWith(at, at + node.nodeSize, [
    N.divider.create({ id, pos, parent }),
    N.paragraph.create({ id: newId(), pos: keyAfter(pos, next ? next.attrs.pos : null), parent }),
  ]);
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

// Insert a divider for the block at `index`: in place of an empty paragraph,
// otherwise after the block's whole subtree at the block's own level.
export function insertDivider(st, index, tr = st.tr) {
  const node = tr.doc.child(index);
  if (node.type === N.paragraph && node.content.size === 0) return replaceWithDivider(tr, index);
  const ents = outline(tr.doc), end = ents[index].subEnd;
  const to = ents[end].end, next = ents[end + 1]?.node.attrs.pos ?? null;
  const pos = keyAfter(ents[end].node.attrs.pos, next), parent = node.attrs.parent ?? null;
  tr.insert(to, [
    N.divider.create({ id: newId(), pos, parent }),
    N.paragraph.create({ id: newId(), pos: keyAfter(pos, next), parent }),
  ]);
  return tr.setSelection(TextSelection.create(tr.doc, to + 2));
}

// The empty paragraph at `index` becomes a table of contents that keeps its id, pos and
// parent, followed by a new empty paragraph holding the caret.
export function replaceWithToc(tr, index) {
  const at = startOf(tr.doc, index);
  const node = tr.doc.child(index);
  const next = tr.doc.maybeChild(index + 1);
  const { id, pos, parent } = node.attrs;
  tr.replaceWith(at, at + node.nodeSize, [
    N.toc.create({ id, pos, parent, maxLevel: 3 }),
    N.paragraph.create({ id: newId(), pos: keyAfter(pos, next ? next.attrs.pos : null), parent }),
  ]);
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

// Insert a table of contents for the block at `index`: in place of an empty paragraph,
// otherwise after the block's whole subtree at the block's own level.
export function insertToc(st, index, tr = st.tr) {
  const node = tr.doc.child(index);
  if (node.type === N.paragraph && node.content.size === 0) return replaceWithToc(tr, index);
  const ents = outline(tr.doc), end = ents[index].subEnd;
  const to = ents[end].end, next = ents[end + 1]?.node.attrs.pos ?? null;
  const pos = keyAfter(ents[end].node.attrs.pos, next), parent = node.attrs.parent ?? null;
  tr.insert(to, [
    N.toc.create({ id: newId(), pos, parent, maxLevel: 3 }),
    N.paragraph.create({ id: newId(), pos: keyAfter(pos, next), parent }),
  ]);
  return tr.setSelection(TextSelection.create(tr.doc, to + 2));
}

// The skipped letters between a query and a candidate it can be read out of,
// or Infinity when it cannot. Only queries of 2 to 32 letters count, so a single
// letter never drags in half the menu.
function subsequenceCost(query, candidate) {
  if (query.length < 2 || query.length > 32) return Infinity;
  let at = -1;
  let cost = 0;
  for (const ch of query) {
    const next = candidate.indexOf(ch, at + 1);
    if (next < 0) return Infinity;
    cost += next - at - 1;
    at = next;
  }
  return cost;
}

// Exact name or alias first, then label prefix, word or alias prefix,
// substring, description word, and last a fuzzy subsequence of the label, key
// or aliases. Equal tiers keep the lower cost, then menu order.
export function rankItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const rank = (it) => {
    const label = it.label.toLowerCase();
    const names = [it.key, ...(it.aliases || []), ...(it.hint ? [it.hint] : [])].map((s) => s.toLowerCase());
    if (label === q || names.includes(q)) return [0, 0];
    if (label.startsWith(q)) return [1, 0];
    if ([...label.split(/\s+/), ...names].some((s) => s.startsWith(q))) return [2, 0];
    if ([label, ...names].some((s) => s.includes(q))) return [3, 0];
    if (q.length >= 3 && it.description && it.description.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return [4, 0];
    const cost = Math.min(...[label, it.key, ...(it.aliases || [])].map((s) => subsequenceCost(q, s.toLowerCase())));
    return cost === Infinity ? null : [5, cost];
  };
  return items.map((it, order) => ({ it, order, rank: rank(it) })).filter((x) => x.rank).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.order - b.order).map((x) => x.it);
}

function writeItem(view, item, index, remove) {
  const st = view.state;
  let tr = st.tr;
  if (remove) tr.delete(remove.from, remove.to);
  const node = tr.doc.child(index);
  if (node.isTextblock && node.content.size === 0 && !canTurnInto(node, item)) return REFUSED;
  if (item.insert === "divider") tr = insertDivider(st, index, tr);
  else if (node.isTextblock && node.content.size === 0) tr = retype(tr, index, item);
  else {
    tr = insertAfter(st, index, tr);
    tr = retype(tr, tr.doc.resolve(tr.selection.head).index(0), item);
  }
  view.dispatch(asStep(tr).scrollIntoView());
  view.focus();
  return true;
}

// A table of contents is a block only a newer page format reads, so its first write asks
// the format gate; the block the pick was made on is found again after it answers, so one
// a peer moved away refuses instead of handing the toc its place.
export function runTocItem(view, index, remove = null) {
  const st = view.state;
  const id = st.doc.maybeChild(index)?.attrs.id ?? null;
  const del = remove && { ...remove, text: st.doc.textBetween(remove.from, remove.to) };
  return runFormatted(view, () => {
    const now = view.state;
    const at = id === null ? -1 : indexOfId(now.doc, id);
    if (at < 0 || (del && now.doc.textBetween(del.from, del.to) !== del.text)) return stale;
    let tr = del ? now.tr.delete(del.from, del.to) : now.tr;
    tr = insertToc(now, indexOfId(tr.doc, id), tr);
    view.dispatch(asStep(tr).scrollIntoView());
    view.focus();
    return { ok: true };
  });
}

// The menus ask for an optional command through the editor's own entry point, at the moment
// somebody picks the row: importing it here keeps this module plain data, which the block
// menus, the Markdown rules and the editor all share, while the command still loads only on
// first use. `id` is the row it has in COMMAND_FEATURES.
export const runMenuCommand = (view, id, args) => import("./editor.js").then(({ runPageCommand }) => (view.isDestroyed ? { ok: false, code: "not-editing" } : runPageCommand(view, id, args)));

// A row whose work is an optional command: the typed query goes with the pick, and the
// command is asked for by its id.
function runCommandItem(view, id, remove) {
  if (remove) view.dispatch(view.state.tr.delete(remove.from, remove.to));
  return runMenuCommand(view, id, {});
}

// What a pick does in the insert menu for the block at `index`. A divider and
// the file pickers have their own placement; a block type retypes an empty line
// and otherwise goes into a new block below the line's whole subtree. A block
// type from a later format asks the format gate before it writes anything, and
// a toggle heading or a quote is found again after it answers: the block and the
// typed query that moved or changed refuse as a stale target.
export function runItem(view, item, index, remove = null) {
  const st = view.state;
  if (item.insert === "image" || item.insert === "file") return pickFiles(view, item.insert === "image" ? "image/*" : "", hostPlace(st, index), remove);
  if (item.insert === "csv") return pickCsv(view, remove);
  if (item.insert === "table") return insertTableNode(st, view.dispatch, makeTable(), remove, null, index);
  if (item.insert === "board") return insertBoardNode(st, view.dispatch, makeBoard(), remove, index);
  if (item.insert === "chart") return loadChartPart(view).then((part) => (part && !view.isDestroyed ? part.chartFromSlash(view, index, remove) : false));
  if (item.insert === "toc") return runTocItem(view, index, remove);
  if (item.command) return runCommandItem(view, item.command, remove);
  if (!isToggleHeading(item) && item.type !== "quote") return writeItem(view, item, index, remove);
  const id = st.doc.maybeChild(index)?.attrs.id ?? null;
  const del = remove && { ...remove, text: st.doc.textBetween(remove.from, remove.to) };
  return runFormatted(view, () => {
    const now = view.state;
    const at = id === null ? -1 : indexOfId(now.doc, id);
    // The typed query is found again too: a line that changed underneath refuses.
    if (at < 0 || (del && now.doc.textBetween(del.from, del.to) !== del.text)) return stale;
    return writeItem(view, item, at, del);
  });
}
