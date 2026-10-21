// What the block menu lists and how a pick changes the page: the block types a
// textblock can be turned into, the things that can be inserted, how a search
// ranks them, and the transactions behind them. Pure data and transactions: the
// menu itself lives in chrome.js.
import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { isKey, keyBetween, newId } from "./model.js";
import { outline, subtreeRange } from "./blocks.js";
import { asStep } from "./blocksel.js";
import { pickFiles, hostPlace } from "./media.js";
import { makeTable, insertTableNode } from "./table.js";
import { pickCsv } from "./csv-import.js";

const { TextSelection } = state;
const N = schema.nodes;

export const BLOCK_TYPES = [
  { key: "text", label: "Text", icon: "T", type: "paragraph", aliases: ["p", "paragraph", "plain"] },
  { key: "h1", label: "Heading 1", icon: "H1", type: "heading", attrs: { level: 1 }, hint: "#", aliases: ["h1", "title"] },
  { key: "h2", label: "Heading 2", icon: "H2", type: "heading", attrs: { level: 2 }, hint: "##", aliases: ["h2", "subtitle"] },
  { key: "h3", label: "Heading 3", icon: "H3", type: "heading", attrs: { level: 3 }, hint: "###", aliases: ["h3"] },
  { key: "bullet", label: "Bulleted list", icon: "•", type: "list_item", attrs: { kind: "bullet" }, hint: "-", aliases: ["ul", "bullet", "list", "unordered"] },
  { key: "ordered", label: "Numbered list", icon: "1.", type: "list_item", attrs: { kind: "ordered" }, hint: "1.", aliases: ["ol", "num", "numbered", "ordered"] },
  { key: "check", label: "Checklist", icon: "☐", type: "list_item", attrs: { kind: "check" }, hint: "[]", aliases: ["todo", "to-do", "task", "check", "checkbox"] },
  { key: "toggle", label: "Toggle", icon: "▸", type: "toggle", attrs: { open: true }, hint: ">", aliases: ["collapse", "details", "fold"] },
  { key: "callout", label: "Callout", icon: "!", type: "callout", aliases: ["note", "aside", "info"] },
  { key: "code", label: "Code", icon: "</>", type: "code_block", hint: "```", aliases: ["pre", "snippet"] },
];

export const INSERT_ITEMS = [
  { key: "divider", label: "Divider", icon: "—", hint: "---", aliases: ["hr", "line", "separator", "rule"], insert: "divider" },
  { key: "image", label: "Image", icon: "▣", aliases: ["img", "picture", "photo"], insert: "image" },
  { key: "file", label: "File", icon: "⎘", aliases: ["upload", "attachment", "pdf"], insert: "file" },
  { key: "table", label: "Table", icon: "▦", aliases: ["grid", "spreadsheet"], insert: "table" },
  { key: "csv", label: "Import CSV…", icon: "⇧", aliases: ["comma separated", "import"], insert: "csv" },
];

export const MENU_ITEMS = [...BLOCK_TYPES, ...INSERT_ITEMS];

// Which entry of BLOCK_TYPES a block is, for the toolbar's "Text ▾" label.
export function blockTypeOf(node) {
  const t = node.type.name;
  return BLOCK_TYPES.find((b) => b.type === t && (!b.attrs
    || (t === "heading" ? b.attrs.level === node.attrs.level : t === "list_item" ? b.attrs.kind === node.attrs.kind : true))) ?? BLOCK_TYPES[0];
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

export function turnInto(st, index, item) {
  return st.doc.child(index).isTextblock ? retype(st.tr, index, item) : null;
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

// Exact name or alias first, then label prefix, word or alias prefix,
// substring; equal ranks keep menu order. No fuzzy matching.
export function rankItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const rank = (it) => {
    const label = it.label.toLowerCase();
    const names = [it.key, ...(it.aliases || []), ...(it.hint ? [it.hint] : [])].map((s) => s.toLowerCase());
    if (label === q || names.includes(q)) return 0;
    if (label.startsWith(q)) return 1;
    if ([...label.split(/\s+/), ...names].some((s) => s.startsWith(q))) return 2;
    if ([label, ...names].some((s) => s.includes(q))) return 3;
    return Infinity;
  };
  return items.map((it, order) => ({ it, order, rank: rank(it) })).filter((x) => x.rank !== Infinity).sort((a, b) => a.rank - b.rank || a.order - b.order).map((x) => x.it);
}

// What a pick does in the insert menu for the block at `index`. A divider and
// the file pickers have their own placement; a block type retypes an empty line
// and otherwise goes into a new block below the line's whole subtree.
export function runItem(view, item, index, remove = null) {
  const st = view.state;
  if (item.insert === "image" || item.insert === "file") return pickFiles(view, item.insert === "image" ? "image/*" : "", hostPlace(st, index), remove);
  if (item.insert === "csv") return pickCsv(view, remove);
  if (item.insert === "table") return insertTableNode(st, view.dispatch, makeTable(), remove);
  let tr = st.tr;
  if (remove) tr.delete(remove.from, remove.to);
  const node = tr.doc.child(index);
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
