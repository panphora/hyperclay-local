// Date mentions: the Date action offers Today and Tomorrow, and choosing one writes that
// calendar day into the document as ordinary ISO text with the `date` mark over it. Both
// days are resolved once, when the command runs, from the local calendar rather than from a
// UTC instant, so the text a person reads is the day they picked; nothing here stores a
// time, a zone, a relative word or a reminder, and nothing speaks to the network. Loaded on
// the first Date action, and disposed with the exit.
import { state } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { asStep } from "../blocksel.js";
import { composing } from "../markdown.js";
import { createMentionPicker } from "../mention-picker.js";
import { runFormatted } from "../format-command.js";

const pad = (n) => String(n).padStart(2, "0");

// A calendar date, as the record stores it: no year padding games, no leap second, no
// zone. A day that does not exist is not a date, so 2023-02-29 is refused.
export function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

// Today, from the local calendar: the fields a person reads on their own wall clock, never
// `toISOString()` of a local time, which is tomorrow or yesterday for part of the day.
export const localISODate = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// A day after (or before) a date, by calendar arithmetic on the date alone: noon UTC keeps
// a daylight-saving shift from landing on the day before.
const dayAfter = (date, days) => {
  const moved = new Date(`${date}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
};

// What the picker lists: two days, both resolved here and once, labelled with the text each
// one writes. Nothing is stored and no day is invented later.
export const earlyDays = (today) => {
  const tomorrow = dayAfter(today, 1);
  return [
    { id: "today", name: `Today (${today})`, date: today },
    { id: "tomorrow", name: `Tomorrow (${tomorrow})`, date: tomorrow },
  ];
};

export function createFeature({ view = null } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let session = null;

  // The caret the command belongs to, read from the document again at the commit: the
  // picker holds no focus and writes nothing, so a caret that moved, a selection that is no
  // longer empty or a block that refuses marks all mean the bookmark no longer holds and the
  // command refuses rather than writing the date somewhere else.
  function bookmark(s) {
    const st = view.state;
    if (!st.selection.empty || st.selection.from !== s.from) return null;
    if (s.from < 0 || s.from > st.doc.content.size) return null;
    const $from = st.doc.resolve(s.from);
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
    if (!$from.parent.type.allowsMarkType(schema.marks.date)) return null;
    return s.from;
  }

  // Where the list hangs, in the page's own placement variables. A view that cannot measure
  // the caret (one outside a laid-out document) still gets its list, just not positioned.
  function place(s) {
    try {
      const box = view.dom.parentElement?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const at = view.coordsAtPos(s.from);
      return { x: Math.max(8, at.left - box.left), y: at.bottom + 6 - box.top };
    } catch {
      return null;
    }
  }

  function anchor(s) {
    const id = s.picker.activeId();
    if (id) view.dom.setAttribute("aria-activedescendant", id);
    else if (view.dom.getAttribute("aria-activedescendant")?.startsWith(s.picker.el.id)) view.dom.removeAttribute("aria-activedescendant");
  }

  function close() {
    const s = session;
    if (!s) return;
    session = null;
    for (const [target, type, fn, options] of s.listen) target.removeEventListener(type, fn, options);
    if (view.dom.getAttribute("aria-activedescendant")?.startsWith(`${s.picker.el.id}-`)) view.dom.removeAttribute("aria-activedescendant");
    s.picker.destroy();
  }

  // The one place a date reaches the document. Document 14 Step 8a wraps this call in the
  // format gate's `runFormatCommand`; nothing else in this module writes.
  function insertDateMention(at, date) {
    const label = String(date);
    // One transaction: the ISO text and its mark, then one unmarked space so typing at the
    // edge of a date stays plain text.
    const tr = view.state.tr.insertText(label, at, at);
    tr.addMark(at, at + label.length, schema.marks.date.create({ date: label }));
    tr.insertText(" ", at + label.length);
    tr.setSelection(state.TextSelection.create(tr.doc, at + label.length + 1));
    view.dispatch(asStep(tr));
    view.focus();
    return { ok: true, date: label };
  }

  async function choose(index) {
    const s = session;
    if (!s) return { ok: false, code: "not-editing" };
    const entry = s.picker.personAt(index);
    const at = bookmark(s);
    if (at === null || !entry || !isISODate(entry.date)) {
      close();
      if (!entry) return { ok: false, code: "no-date" };
      if (at === null) return { ok: false, code: "stale-target" };
      return { ok: false, code: "invalid-date" };
    }
    close();
    // The gate awaits, so the caret is read again here: one that moved, a selection that is
    // no longer a caret or a block that refuses marks means the target no longer holds, and
    // the date is not written anywhere.
    return runFormatted(view, () => {
      const now = bookmark(s);
      if (now === null) return { ok: false, code: "stale-target" };
      return insertDateMention(now, entry.date);
    });
  }

  function key(event) {
    const s = session;
    if (!s || composing(event, view)) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      stop();
      s.picker.move(event.key === "ArrowDown" ? 1 : -1);
      anchor(s);
    } else if (event.key === "Enter") {
      stop();
      choose(s.picker.index());
    } else if (event.key === "Escape" || event.key === "Tab") {
      stop();
      close();
    }
  }

  function open() {
    close();
    // Today is read once, here: a picker left open across midnight still writes the day the
    // command was asked for, and choosing Tomorrow never reads the clock again.
    const s = { from: view.state.selection.from, days: earlyDays(localISODate()), picker: null, listen: [] };
    s.picker = createMentionPicker({ document: doc, label: "Insert a date", empty: "No date to insert", onPick: (index) => choose(index) });
    session = s;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      s.listen.push([target, type, fn, options]);
    };
    listen(doc, "keydown", (event) => key(event), true);
    // Typing closes the list: the caret has moved on, and the command that opened it has
    // nothing to write where it no longer holds.
    listen(view.dom, "input", () => close());
    listen(doc, "mousedown", (event) => { if (!s.picker.el.contains(event.target)) close(); }, true);
    (view.dom.parentElement ?? doc.body).appendChild(s.picker.el);
    if (bookmark(s) === null) {
      close();
      return { ok: false, code: "stale-target" };
    }
    s.picker.show(s.days, place(s));
    anchor(s);
    return { ok: true, picker: true };
  }

  return {
    // The Date action: the picker at the caret, offering the two days resolved now. It
    // writes nothing until one is chosen.
    async run() {
      return open();
    },
    dispose() { close(); },
  };
}
