// Markdown shortcuts typed at the start of a block: "# " to "### ", "- ", "1. ",
// "[] ", "> ", three backticks and "---", and a "| a | b |" row ended by Enter. Each retypes the block in place, keeping
// its id, pos and parent, so the change reads as a retype and not a delete and an
// insert. Backspace right after a shortcut puts the typed text back.
import { inputrules, keymap } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { retype, replaceWithDivider } from "./items.js";
import { asStep } from "./blocksel.js";
import { insertTableNode } from "./table.js";
import { tableFromGrid } from "./table-paste.js";
import { safeHref } from "./address.js";

const { InputRule } = inputrules;
const N = schema.nodes;

const inlineCode = (st, start, end) => st.doc.rangeHasMark(start, end, schema.marks.code)
  || !!schema.marks.code.isInSet(st.storedMarks || st.selection.$from.marks());

const blockRule = (re, item, from = ["paragraph"], entire = false) => new InputRule(re, (st, match, start, end) => {
  const $s = st.doc.resolve(start);
  if (!st.selection.empty || $s.depth !== 1 || $s.parentOffset !== 0 || !from.includes($s.parent.type.name)) return null;
  if ((entire && end !== $s.end()) || inlineCode(st, start, end)) return null;
  return asStep(retype(st.tr.delete(start, end), $s.index(0), typeof item === "function" ? item(match) : item));
});

const dividerRule = new InputRule(/^---$/, (st, match, start, end) => {
  const $s = st.doc.resolve(start);
  if (!st.selection.empty || $s.depth !== 1 || $s.parent.type !== N.paragraph || $s.parentOffset !== 0 || $s.parent.content.size !== end - start) return null;
  if (inlineCode(st, start, end)) return null;
  return asStep(replaceWithDivider(st.tr, $s.index(0)));
});

// Inline shortcuts typed around text: **bold** and __bold__ to strong, *italic*
// and _italic_ to em, `code`, ~~strike~~, and [label](address) to a link. The
// delimiters are deleted and the mark is added over the body, which stays where
// it is, so the marks it already carries survive. Backspace right after puts the
// delimiter characters back through the input rule's own undo.
const OPENS = "\\s\\(\\[\\{'\u2018\u201C\u0022";
const OPENS_ONE = new RegExp(`[${OPENS}]`);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bodyRe = (exclude) => `([^\\s${exclude}](?:[\\s\\S]*?[^\\s${exclude}])?)`;

export const composing = (event, view) => !!event?.isComposing || event?.keyCode === 229 || !!view?.composing;

const trailingBackslashes = (text) => {
  let n = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) n++;
  return n;
};

// An opening delimiter needs the start of a textblock or whitespace and opening
// punctuation before it, and neither delimiter may be escaped.
const opensAt = (st, at) => {
  const $at = st.doc.resolve(at);
  if (!$at.parent.inlineContent) return false;
  if (trailingBackslashes($at.parent.textBetween(0, $at.parentOffset, null, "\uFFFC")) % 2) return false;
  return $at.parentOffset === 0 || OPENS_ONE.test($at.parent.textBetween($at.parentOffset - 1, $at.parentOffset));
};

const inline = (st, match, start, end, markOf) => {
  const mark = markOf(match);
  if (!mark || !st.selection.empty) return null;
  if (start < 0 || start > end || end > st.doc.content.size) return null;
  const $start = st.doc.resolve(start), $end = st.doc.resolve(end);
  if (!$start.sameParent($end) || !$start.parent.inlineContent) return null;
  const [all, prefix, body, close] = match;
  if (inlineCode(st, start, end)) return null;
  const open = all.slice(prefix.length, all.length - body.length - close.length);
  const from = start + prefix.length;
  if (!opensAt(st, from)) return null;
  if (trailingBackslashes(all.slice(0, all.length - close.length)) % 2) return null;
  const pending = all.length - (end - start);
  if (pending < 0) return null;
  const tr = st.tr;
  if (pending) tr.insertText(all.slice(-pending), end, end);
  const bodyStart = from + open.length;
  const bodyEnd = bodyStart + body.length;
  tr.delete(bodyEnd, start + all.length);
  tr.delete(from, bodyStart);
  tr.addMark(from, from + body.length, mark);
  tr.removeStoredMark(mark.type);
  return asStep(tr);
};

const inlineRule = (re, markOf) => new InputRule(
  re,
  (st, match, start, end) => inline(st, match, start, end, markOf),
  { inCodeMark: false },
);

const markRule = (open, close, type) => inlineRule(
  new RegExp(`(^|[${OPENS}])${escapeRe(open)}${bodyRe(escapeRe(close))}(${escapeRe(close)})$`),
  () => type.create(),
);

const linkRule = inlineRule(
  new RegExp(`(^|[${OPENS}])\\[${bodyRe("\\[\\]")}(\\]\\([^()\\s]*\\))$`),
  (match) => {
    const href = safeHref(match[3].slice(2, -1));
    return href ? schema.marks.link.create({ href }) : null;
  },
);

const INLINE_RULES = [
  markRule("**", "**", schema.marks.strong),
  markRule("__", "__", schema.marks.strong),
  markRule("*", "*", schema.marks.em),
  markRule("_", "_", schema.marks.em),
  markRule("`", "`", schema.marks.code),
  markRule("~~", "~~", schema.marks.strike),
  linkRule,
];

const LISTS = ["paragraph", "list_item"];

export const MARKDOWN_RULES = [
  blockRule(/^(#{1,3})\s$/, (m) => ({ type: "heading", attrs: { level: m[1].length } })),
  blockRule(/^[-*+]\s$/, { type: "list_item", attrs: { kind: "bullet" } }, LISTS),
  blockRule(/^\d+[.)]\s$/, { type: "list_item", attrs: { kind: "ordered" } }, LISTS),
  blockRule(/^\[( |x|X)?\]\s$/, (m) => ({ type: "list_item", attrs: { kind: "check", checked: !!m[1] && m[1] !== " " } }), LISTS),
  blockRule(/^>\s$/, { type: "toggle", attrs: { open: true } }),
  blockRule(/^```$/, { type: "code_block" }, ["paragraph"], true),
  dividerRule,
  ...INLINE_RULES,
];

// The shortest shortcut that quotes a line: `" ` typed at the start of a
// paragraph. It writes a floor-1 block, so it asks the format gate first and
// converts only when the gate answered applied; the transaction it dispatches is
// the input-rule one, recorded on this plugin so Backspace puts the literal `" `
// back and undo keeps the conversion whole. The typed space is never swallowed:
// when the format cannot be written the space is inserted as itself, and a line
// that changed while the gate waited takes no write at all.
function quoteShortcut(plugin, view, from, to, text) {
  if (text !== " " || from !== to) return false;
  const st = view.state;
  const $from = st.doc.resolve(from);
  const node = $from.parent;
  if ($from.depth !== 1 || node.type !== N.paragraph || $from.parentOffset !== 1 || node.textContent !== '"') return false;
  if (!view.editable || typeof view.runFormatCommand !== "function") return false;
  const plain = () => {
    if (view.isDestroyed || view.state.doc !== st.doc) return;
    view.dispatch(view.state.tr.insertText(" ", from, to));
  };
  const at = $from.before(1);
  import("./format-native-commands.js").then(({ quoteFromSpace }) => quoteFromSpace(plugin, view, { at, from, to }, plain), plain);
  return true;
}

export const markdownPlugin = () => {
  const plugin = inputrules.inputRules({ rules: MARKDOWN_RULES });
  const rules = plugin.props.handleTextInput;
  plugin.props.handleTextInput = (view, from, to, text) => quoteShortcut(plugin, view, from, to, text) || rules(view, from, to, text);
  return plugin;
};

// "| Name | Owner |" then Enter at the end of a paragraph: the paragraph becomes
// a table with those column names and one empty row, the caret in its first cell.
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;

export function tableFromMarkdownRow(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type !== N.paragraph || $from.parentOffset !== $from.parent.content.size) return false;
  if (inlineCode(st, $from.start(), $from.end())) return false;
  const match = TABLE_ROW.exec($from.parent.textContent);
  if (!match) return false;
  const names = match[1].split("|").map((name) => name.trim());
  if (!names.some(Boolean)) return false;
  const table = tableFromGrid([names, names.map(() => "")], { header: true });
  return insertTableNode(st, dispatch, table, { from: $from.start(), to: $from.end() });
}

export const markdownKeys = () => keymap.keymap({
  Enter: (st, dispatch, view) => !composing(null, view) && tableFromMarkdownRow(st, dispatch),
});

export function backspaceToParagraph(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0) return false;
  const n = $from.parent;
  if (!(n.type === N.heading || n.type === N.callout || n.type === N.quote || (n.type === N.code_block && n.content.size === 0))) return false;
  if (dispatch) dispatch(asStep(st.tr.setNodeMarkup($from.before(), N.paragraph, { id: n.attrs.id, pos: n.attrs.pos, parent: n.attrs.parent })));
  return true;
}
