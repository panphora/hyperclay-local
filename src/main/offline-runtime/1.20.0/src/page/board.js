import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { isKey, keyBetween, keysBetween, newId } from "./model.js";
import { outline } from "./blocks.js";
import { asStep } from "./blocksel.js";

const { TextSelection } = state;
const N = schema.nodes;

export const BOARD_COLUMNS = Object.freeze(["To do", "In progress", "Done"]);

const keyAfter = (pos, next) => (isKey(pos) && (next === null || (isKey(next) && pos < next)) ? keyBetween(pos, next) : null);

export function makeBoard(names = BOARD_COLUMNS) {
  const positions = keysBetween(null, null, names.length);
  const columns = Object.fromEntries(names.map((name, i) => [newId("c"), { pos: positions[i], name }]));
  return N.board.create({ id: newId(), columns, cards: {} });
}

// The board takes the place of an empty line, otherwise it goes after the
// line's whole subtree at the line's own level. An empty paragraph follows it
// and holds the caret, so typing goes on below the board.
export function insertBoardNode(st, dispatch, board = makeBoard(), remove = null, index = null) {
  const tr = st.tr;
  if (remove) tr.delete(remove.from, remove.to);
  index ??= tr.doc.resolve(tr.mapping.map(st.selection.head)).index(0);
  const ents = outline(tr.doc);
  const line = tr.doc.child(index);
  const empty = line.isTextblock && line.content.size === 0;
  const last = empty ? index : ents[index].subEnd;
  const from = empty ? ents[index].at : ents[last].end;
  const next = ents[last + 1]?.node.attrs.pos ?? null;
  const parent = line.attrs.parent ?? null;
  const pos = empty ? line.attrs.pos : keyAfter(ents[last].node.attrs.pos, next);
  const placed = N.board.create({ ...board.attrs, pos, parent });
  const after = N.paragraph.create({ id: newId(), pos: keyAfter(pos, next), parent });
  tr.replaceWith(from, empty ? ents[index].end : from, [placed, after]);
  tr.setSelection(TextSelection.create(tr.doc, from + placed.nodeSize + 1));
  if (dispatch) dispatch(asStep(tr).scrollIntoView());
  return true;
}
