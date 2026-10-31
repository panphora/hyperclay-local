// The commands behind the four formats this release adds — underline, text color,
// highlight and the quote block — and the rows the More menu offers them by.
//
// Nothing here is on the ready path. Every caller loads this module the first
// time one of the commands runs, so reading and drawing an existing document
// never fetches a transaction, a palette or a refusal notice.
//
// Every command that writes one of them goes through runFormat, which is the
// editor's own format gate: nothing is applied and no descriptor is written
// unless the gate answered "applied".
import { history } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { PALETTE, markable } from "./format-native.js";
import { announce } from "./announce.js";
import toast from "../ui/toast-lazy.js";
import { openPageMenu } from "./chrome.js";

// blocks.js's STEP, read here rather than imported from it: this module is part
// of the projection's graph, and blocks.js reads the projection's constants as it
// loads. A command of ours is one undo item by itself, like every other command.
const STEP = "page-step";
const asStep = (tr) => history.closeHistory(tr).setMeta(STEP, true);

const holds = (mark, attrs) => !!mark && Object.keys(mark.type.attrs).every((name) => mark.attrs[name] === attrs[name]);

function toggle(view, type, attrs) {
  const st = view.state;
  const { from, to, empty, $from } = st.selection;
  const tr = st.tr;
  if (empty) {
    if (holds(type.isInSet(st.storedMarks || $from.marks()), attrs)) tr.removeStoredMark(type);
    else tr.addStoredMark(type.create(attrs));
  } else {
    let all = true;
    st.doc.nodesBetween(from, to, (node) => {
      if (all && node.isText && !holds(type.isInSet(node.marks), attrs)) all = false;
    });
    if (all) tr.removeMark(from, to, type);
    else tr.addMark(from, to, type.create(attrs));
  }
  view.dispatch(asStep(tr));
  return true;
}

function remove(view, type) {
  const st = view.state;
  const tr = st.tr;
  if (st.selection.empty) tr.removeStoredMark(type);
  else tr.removeMark(st.selection.from, st.selection.to, type);
  view.dispatch(asStep(tr));
  return true;
}

// The gate, in one place: an editor mounted without one cannot write a floor-1
// format, and a refusal leaves the content exactly as it was.
export function runFormat(view, apply) {
  const run = view.runFormatCommand;
  if (typeof run !== "function") return Promise.resolve({ status: "unsupported-host", code: "page-format-unsupported", retry: false });
  return run(apply);
}

// A mark command: toggle it on the selection, or with reset take it off. A
// selection the mark cannot reach is refused before the gate is asked, so a code
// block never raises the document's floor.
export function formatMark(view, name, attrs = {}, { reset = false } = {}) {
  const type = schema.marks[name];
  if (!type) return Promise.resolve({ status: "refused", code: "unsupported-format" });
  if (!view.editable) return Promise.resolve({ status: "refused", code: "not-editable" });
  if (!markable(view.state, type)) return Promise.resolve({ status: "refused", code: "mark-not-allowed" });
  return runFormat(view, () => (reset ? remove(view, type) : toggle(view, type, attrs)));
}

// The four formats pasted in from elsewhere are floor-1 content too: the slice is
// inserted only once the gate answered applied. A refusal keeps the text and
// writes no descriptor; a selection that moved while the answer came back takes
// neither, and neither does a document that changed underneath the paste: the
// plain fallback would write at a place a peer edit has moved, so the text stays
// in the clipboard instead.
export function pasteFormats(view, slice, from, to) {
  const before = view.state.doc;
  const place = () => {
    if (view.isDestroyed) return false;
    const st = view.state;
    if (st.selection.from !== from || st.selection.to !== to) return false;
    view.dispatch(st.tr.replaceSelection(slice).scrollIntoView());
    return true;
  };
  const plain = () => {
    const text = slice.content.textBetween(0, slice.content.size, "\n", " ");
    if (!view.isDestroyed && text && view.state.doc === before) view.dispatch(view.state.tr.insertText(text, from, to));
    return false;
  };
  runFormat(view, place).then((result) => {
    if (result?.status === "applied") return;
    refuse(view, result?.message ?? "That format isn\u2019t available here.");
    plain();
  }, plain);
}

// The typed `" ` shortcut: the paragraph the reader is typing in became a quote,
// and the space that typed it goes with it. A refusal puts the space back as
// itself, so the typed character is never swallowed.
export function quoteFromSpace(plugin, view, { at, from, to }, plain) {
  const convert = () => {
    if (view.isDestroyed) return false;
    const now = view.state;
    const current = now.doc.nodeAt(at);
    if (!current || current.type !== schema.nodes.paragraph || current.textContent !== '"') return plain();
    const tr = now.tr.delete(at + 1, at + 2).setNodeMarkup(at, schema.nodes.quote, current.attrs);
    view.dispatch(asStep(tr.setMeta(plugin, { transform: tr, from, to, text: " " })));
    return true;
  };
  view.runFormatCommand(convert).then((result) => {
    if (result?.status === "applied") return;
    if (result) refuse(view, refusalText(result));
    plain();
  }, plain);
}

// The More menu's rows: the underline command, the palette of a color mark and
// the notice a refusal raises. The palette is fixed: nine keys and the way back
// to none, and no arbitrary color picker is offered.
const CANNOT_MARK = "This text can\u2019t take that format.";
const refusalText = (result) => (result.status === "upgrade-required" ? result.message : result.code === "mark-not-allowed" ? CANNOT_MARK : "That format isn\u2019t available here.");

// A refusal is said to a screen reader and shown, since a sighted reader whose
// click did nothing otherwise has no way to know why.
export const refuse = (view, text) => {
  if (view.isDestroyed) return;
  announce(view, text);
  toast(text, "error");
};

const notice = (view, result) => {
  if (result?.status !== "applied") refuse(view, refusalText(result ?? {}));
};

export const runNative = (view, name, attrs = {}, options = undefined) => {
  formatMark(view, name, attrs, options).then((result) => notice(view, result));
};

// A block command from a later format, like the turn into a quote: the write asks
// the gate first, and a refusal is a notice rather than a change.
export const gateTurn = (view, turn) => {
  runFormat(view, turn).then((result) => notice(view, result));
};

// The palette of one color mark, as its own short menu: the nine fixed keys and
// the way back to none.
export function nativeMenu(view, name, anchor) {
  if (name === "underline") return runNative(view, name);
  const colorLabel = name === "text_color" ? "Text" : "Highlight";
  const noneLabel = name === "text_color" ? "Automatic" : "No highlight";
  return openPageMenu(view, anchor, [
    ...PALETTE.map((color) => ({ key: `${name}_${color}`, label: `${colorLabel}: ${color[0].toUpperCase()}${color.slice(1)}`, icon: "\u25CF", run: (v) => runNative(v, name, { color }) })),
    { key: `${name}_none`, label: noneLabel, icon: "\u00d7", run: (v) => runNative(v, name, {}, { reset: true }) },
  ]);
}
