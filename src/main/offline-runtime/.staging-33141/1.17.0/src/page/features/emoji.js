// Emoji: the Emoji action opens a picker of a small bundled glyph list and choosing one
// writes that glyph into the document as ordinary Unicode text. The glyph is the whole
// record — no mark, no node, no attribute and no format floor — so a reader shows it with
// nothing of this loaded, and a variation selector, a skin tone, a flag's regional pair, a
// keycap or a joined family goes in as the one grapheme a person sees, never split. The
// list is fetched the first time the picker opens and kept; a fetch that failed is not
// kept, so the next opening asks again.
import { state } from "../../vendor/prosemirror.vendor.js";
import { asStep } from "../blocksel.js";
import { composing } from "../markdown.js";
import { createMentionPicker } from "../mention-picker.js";

// One glyph, as a person sees it: counting code points or UTF-16 units would call a
// joined family seven things and a keycap several, and cut one in half.
export function graphemes(text) {
  const value = String(text ?? "");
  const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
  return segmenter ? [...segmenter.segment(value)].map((part) => part.segment) : [...value];
}

export const isEmojiText = (value) => graphemes(value).length === 1 && !/^\s*$/.test(String(value ?? ""));

// The data module's groups, flattened into the rows a picker lists: the glyph first, so the
// row reads as the emoji and its name, and the searchable words after it.
export function emojiEntries(groups) {
  const list = [];
  for (const [group, rows] of Object.entries(groups ?? {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const [char, name, keywords = ""] = row ?? [];
      if (typeof char !== "string" || typeof name !== "string") continue;
      list.push({ id: `${group}:${name}`, char, name: `${char} ${name}`, keywords: `${name} ${keywords}` });
    }
  }
  return list;
}

export const filterEmoji = (list, query) => {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((entry) => entry.char === q || entry.keywords.toLowerCase().includes(q));
};

// The list as one fetch for the life of a session: the first opening loads it, the next
// openings reuse it, and a fetch that failed leaves nothing cached so it is asked for again.
export function emojiLibrary(load = () => import("../emoji-data.js")) {
  let pending = null;
  return () => {
    pending ??= Promise.resolve()
      .then(() => load())
      .then((mod) => emojiEntries(mod.EMOJI))
      .catch((error) => { pending = null; throw error; });
    return pending;
  };
}

export function createFeature({ view = null, load = () => import("../emoji-data.js") } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  const library = emojiLibrary(load);
  let session = null;

  // The text the command belongs to, read from the document again at the commit: the picker
  // holds no focus and writes nothing, so a caret that moved, a selection that is no longer
  // the one the command was asked for or a place that takes no text all mean the bookmark no
  // longer holds, and the command refuses rather than writing the glyph somewhere else.
  function bookmark(s) {
    const st = view.state;
    const sel = st.selection;
    if (sel.from !== s.from || sel.to !== s.to) return null;
    if (s.from < 0 || s.to > st.doc.content.size) return null;
    const $from = st.doc.resolve(s.from);
    const $to = st.doc.resolve(s.to);
    if (!$from.parent.isTextblock || $from.parent !== $to.parent) return null;
    return { from: s.from, to: s.to };
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

  // The one place a glyph reaches the document: the selection's text is replaced by it in a
  // single transaction, with no mark and nothing else added.
  function insertEmoji(at, char) {
    const tr = view.state.tr.insertText(char, at.from, at.to);
    tr.setSelection(state.TextSelection.create(tr.doc, at.from + char.length));
    view.dispatch(asStep(tr));
    view.focus();
    return { ok: true, emoji: char };
  }

  function choose(index) {
    const s = session;
    if (!s) return { ok: false, code: "not-editing" };
    const entry = s.picker.personAt(index);
    const at = bookmark(s);
    if (!entry || at === null || !isEmojiText(entry.char)) {
      close();
      if (!entry) return { ok: false, code: "no-emoji" };
      if (at === null) return { ok: false, code: "stale-target" };
      return { ok: false, code: "invalid-emoji" };
    }
    close();
    return insertEmoji(at, entry.char);
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

  async function open(args = {}) {
    close();
    const s = { from: view.state.selection.from, to: view.state.selection.to, picker: null, listen: [] };
    s.picker = createMentionPicker({ document: doc, label: "Insert an emoji", empty: "No emoji found", onPick: (index) => choose(index) });
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

    let list;
    try {
      list = await library();
    } catch (error) {
      close();
      return { ok: false, code: "unavailable", error };
    }
    if (session !== s) return { ok: false, code: "not-editing" };
    if (bookmark(s) === null) {
      close();
      return { ok: false, code: "stale-target" };
    }
    s.picker.show(filterEmoji(list, args?.query), place(s));
    anchor(s);
    return { ok: true, picker: true };
  }

  return {
    // The Emoji action: the picker at the caret, offering the bundled list. It writes
    // nothing until one is chosen.
    async run(args) {
      return open(args);
    },
    dispose() { close(); },
  };
}
