// Typing joins one undo item the way it does in other editors: Mod-z removes the last
// word typed, not the last letter. Only the editor's own input path marks a
// transaction; a command or a programmatic dispatch stays one undo item by itself.
import { state } from "../vendor/prosemirror.vendor.js";
import { STEP } from "./blocks.js";

export const HISTORY_INTENT = "page-history-intent";
export const GROUP_MS = 500;

const blockIdAt = (doc, pos) => {
  const $pos = doc.resolve(pos);
  return $pos.depth ? $pos.node(1).attrs.id : null;
};

const markKey = (st) => (st.storedMarks ?? st.selection.$from.marks()).map((m) => `${m.type.name}:${JSON.stringify(m.attrs)}`).sort().join(",");

export function typingIntent(st, from, to, text) {
  return { kind: "insert", blockId: blockIdAt(st.doc, from), from, end: from + text.length, replaced: from !== to, text, marks: markKey(st), at: Date.now() };
}

export function continuesGroup(prev, next) {
  if (!prev || !next || prev.kind !== next.kind) return false;
  if (next.kind === "compose") return prev.id === next.id;
  if (prev.blockId !== next.blockId || next.at - prev.at > GROUP_MS) return false;
  if (next.kind === "insert") return !next.replaced && next.from === prev.end && next.marks === prev.marks && !(/\s$/.test(prev.text) && /^\S/.test(next.text));
  return next.direction === prev.direction && (next.direction < 0 ? next.to === prev.from : next.from === prev.from);
}

const DELETES = { deleteContentBackward: -1, deleteContentForward: 1 };
const pendingDeletes = new WeakMap();
const PENDING_MS = 1000;
export const DERIVED = "page-derived";

// A native deletion arrives as a DOM change with no handler, sometimes after a delayed flush
// (Android waits 20 ms), so the beforeinput that announced it is held with the document it saw
// and claimed by the next document change, whatever that change turns out to be.
export function takePendingDelete(view) {
  const mark = pendingDeletes.get(view) ?? null;
  pendingDeletes.delete(view);
  return mark;
}

export function deletionIntent(tr, mark) {
  if (!mark || tr.before !== mark.doc || Date.now() - mark.at > PENDING_MS || tr.getMeta(STEP) || tr.steps.length !== 1) return null;
  const step = tr.steps[0];
  if (step.slice?.size !== 0 || step.from === step.to) return null;
  const $from = tr.before.resolve(step.from), $to = tr.before.resolve(step.to);
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return null;
  return { kind: "delete", blockId: $from.depth ? $from.node(1).attrs.id : null, direction: mark.direction, from: step.from, to: step.to, at: mark.at };
}

export function intentOf(transactions, view = null) {
  const pending = view ? takePendingDelete(view) : null;
  const primary = transactions.filter((t) => !t.getMeta(DERIVED));
  if (primary.length !== 1) return null;
  const tr = primary[0];
  const composition = tr.getMeta("composition");
  if (composition != null) return { kind: "compose", id: composition, at: Date.now() };
  return tr.getMeta(HISTORY_INTENT) ?? deletionIntent(tr, pending);
}

export function historyIntentPlugin() {
  return new state.Plugin({
    props: {
      handleTextInput(view, from, to, text, deflt) {
        view.dispatch(deflt().setMeta(HISTORY_INTENT, typingIntent(view.state, from, to, text)));
        return true;
      },
      handleDOMEvents: {
        beforeinput(view, event) {
          const direction = DELETES[event.inputType];
          if (direction) pendingDeletes.set(view, { direction, at: Date.now(), doc: view.state.doc });
          return false;
        },
      },
    },
  });
}
