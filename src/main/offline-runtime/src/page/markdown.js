// Markdown shortcuts typed at the start of a block: "# " to "### ", "- ", "1. ",
// "[] ", "> ", three backticks and "---". Each retypes the block in place, keeping
// its id, pos and parent, so the change reads as a retype and not a delete and an
// insert. Backspace right after a shortcut puts the typed text back.
import { inputrules, state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { retype, replaceWithDivider } from "./items.js";
import { asStep } from "./blocksel.js";

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

const LISTS = ["paragraph", "list_item"];

export const MARKDOWN_RULES = [
  blockRule(/^(#{1,3})\s$/, (m) => ({ type: "heading", attrs: { level: m[1].length } })),
  blockRule(/^[-*+]\s$/, { type: "list_item", attrs: { kind: "bullet" } }, LISTS),
  blockRule(/^\d+[.)]\s$/, { type: "list_item", attrs: { kind: "ordered" } }, LISTS),
  blockRule(/^\[( |x|X)?\]\s$/, (m) => ({ type: "list_item", attrs: { kind: "check", checked: !!m[1] && m[1] !== " " } }), LISTS),
  blockRule(/^>\s$/, { type: "toggle", attrs: { open: true } }),
  blockRule(/^```$/, { type: "code_block" }, ["paragraph"], true),
  dividerRule,
];

export const markdownPlugin = () => inputrules.inputRules({ rules: MARKDOWN_RULES });

export function backspaceToParagraph(st, dispatch) {
  const { $from, empty } = st.selection;
  if (!empty || $from.depth !== 1 || $from.parentOffset !== 0) return false;
  const n = $from.parent;
  if (!(n.type === N.heading || n.type === N.callout || (n.type === N.code_block && n.content.size === 0))) return false;
  if (dispatch) dispatch(asStep(st.tr.setNodeMarkup($from.before(), N.paragraph, { id: n.attrs.id, pos: n.attrs.pos, parent: n.attrs.parent })));
  return true;
}
