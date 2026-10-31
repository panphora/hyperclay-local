// Person mentions: @ opens a picker of people, and choosing one writes that person's name
// into the document as ordinary text with the `mention` mark over it. The label is the name
// the command saw, so a later rename never rewrites somebody's prose, and the id is the
// people registry's reference: nothing here notifies anyone, looks up an account or speaks
// to the network. Loaded the first time somebody types @, and disposed with the exit.
import { state } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { asStep } from "../blocksel.js";
import { composing } from "../markdown.js";
import { createMentionPicker, filterPeople, peopleFrom } from "../mention-picker.js";
import { runFormatted } from "../format-command.js";

// clay.people's own id grammar (plugins/people.js): a mention keeps an id the registry made.
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TRIGGER = "@";
const QUERY_MAX = 100;

export function createFeature({ view = null } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  const registry = () => globalThis.clay?.people ?? null;
  let session = null;

  // The query the picker belongs to, read from the document again on every keystroke and
  // again at the commit: a deleted @, a caret that left the block or a peer that replaced
  // the text means the bookmark no longer holds, and the command refuses rather than
  // handing the person whoever took that place.
  function bookmark(s) {
    const st = view.state;
    if (!st.selection.empty) return null;
    const head = st.selection.head;
    if (head <= s.from || head - s.from > QUERY_MAX + 1 || head > st.doc.content.size) return null;
    const $from = st.doc.resolve(s.from);
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
    if (head > $from.end() || head < $from.start()) return null;
    // The @ has to start a word: the beginning of a block, or after a space.
    if ($from.parentOffset && !/\s/.test(st.doc.textBetween(s.from - 1, s.from, "", "\n"))) return null;
    if (st.doc.textBetween(s.from, s.from + 1) !== TRIGGER) return null;
    return { head, query: st.doc.textBetween(s.from + 1, head) };
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

  function draw(s) {
    s.picker.show(filterPeople(peopleFrom(s.saved, s.allowed), s.query), place(s));
    anchor(s);
  }

  function close() {
    const s = session;
    if (!s) return;
    session = null;
    for (const [target, type, fn, options] of s.listen) target.removeEventListener(type, fn, options);
    if (view.dom.getAttribute("aria-activedescendant")?.startsWith(`${s.picker.el.id}-`)) view.dom.removeAttribute("aria-activedescendant");
    s.picker.destroy();
  }

  function refresh() {
    const s = session;
    if (!s || view.composing) return;
    const at = bookmark(s);
    if (!at) return close();
    s.query = at.query;
    draw(s);
  }

  async function choose(index) {
    const s = session;
    if (!s) return { ok: false, code: "not-editing" };
    const person = s.picker.personAt(index);
    const at = bookmark(s);
    const usable = person && at && at.query === s.query && ID.test(String(person.id ?? "")) && String(person.name ?? "").trim();
    if (!usable) {
      close();
      return { ok: false, code: person ? "stale-target" : "no-person" };
    }
    const label = String(person.name).trim();
    close();
    // The gate awaits, so the bookmark is read again here: a caret that moved, a query that
    // changed or a block that went away means the target no longer holds and nothing is
    // written.
    return runFormatted(view, () => {
      const now = bookmark(s);
      if (!now || now.query !== s.query) return { ok: false, code: "stale-target" };
      // One transaction: the revalidated query becomes the name and its mark, then one
      // unmarked space so typing at the edge of a mention stays plain text.
      const tr = view.state.tr.insertText(label, s.from, now.head);
      tr.addMark(s.from, s.from + label.length, schema.marks.mention.create({ id: person.id }));
      tr.insertText(" ", s.from + label.length);
      tr.setSelection(state.TextSelection.create(tr.doc, s.from + label.length + 1));
      view.dispatch(asStep(tr));
      view.focus();
      return { ok: true, id: person.id, label };
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

  // The host's list arrives after the picker is already up: the people the document names
  // show first, and a failed or missing list leaves exactly those. Neither presence nor an
  // account lookup is a source of candidates.
  function roster(s) {
    const available = registry()?.available;
    if (!available) return;
    Promise.resolve().then(() => available()).then((allowed) => {
      if (session !== s) return;
      s.allowed = Array.isArray(allowed) ? allowed : null;
      draw(s);
    }).catch(() => {});
  }

  function open(from) {
    close();
    const picker = createMentionPicker({ document: doc, onPick: (index) => choose(index) });
    const s = { from, picker, query: "", allowed: null, saved: [], listen: [] };
    try { s.saved = registry()?.list?.() ?? []; } catch { s.saved = []; }
    session = s;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      s.listen.push([target, type, fn, options]);
    };
    listen(doc, "keydown", (event) => key(event), true);
    listen(view.dom, "input", () => refresh());
    listen(view.dom, "keyup", () => refresh());
    listen(view.dom, "compositionend", () => refresh());
    listen(doc, "mousedown", (event) => { if (!s.picker.el.contains(event.target)) close(); }, true);
    (view.dom.parentElement ?? doc.body).appendChild(picker.el);
    const at = bookmark(s);
    if (!at) {
      close();
      return { ok: false, code: "stale-target" };
    }
    s.query = at.query;
    draw(s);
    roster(s);
    return { ok: true, picker: true };
  }

  return {
    // {from} is the @ the person typed; without one this is the Mention action, which types
    // that @ at the caret and opens the same picker on it.
    async run(args = {}) {
      let from = Number.isInteger(args?.from) ? args.from : null;
      if (from === null) {
        const st = view.state;
        const $from = st.selection.$from;
        if (!st.selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return { ok: false, code: "stale-target" };
        from = st.selection.from;
        const tr = view.state.tr.insertText(TRIGGER);
        tr.setSelection(state.TextSelection.create(tr.doc, from + 1));
        view.dispatch(tr);
      }
      return open(from);
    },
    dispose() { close(); },
  };
}
