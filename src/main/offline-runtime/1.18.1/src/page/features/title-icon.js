// Page icon: the one glyph a page shows beside its title. It is a scalar attribute of the
// title heading, never a second store, so a reader draws it as ordinary Unicode text with
// nothing of this loaded and the title's own words stay the title. The picker is the emoji
// feature's, fetched the first time it opens; this module loads when a document has an icon
// or somebody asks for one, and the command writes through the format gate.
import { schema } from "../schema.js";
import { newId, keyBetween } from "../model.js";
import { asStep } from "../blocksel.js";
import { composing } from "../markdown.js";
import { createMentionPicker } from "../mention-picker.js";
import { runFormatted } from "../format-command.js";

const TITLE_CSS = `
[data-page-heading]{display:block}
[data-page-heading]>span[data-page-icon]{display:inline-block;font-size:34px;line-height:1;margin-block-end:.2em}
[data-page-heading]>img[data-page-cover]{display:block;width:100%;height:180px;object-fit:cover;border-radius:var(--page-image-radius, 6px);margin-block-end:.6em}
[data-page-heading]>h1{font-family:var(--page-font-display);font-size:var(--page-h1-size);font-weight:var(--page-h1-weight);letter-spacing:var(--page-h1-tracking);line-height:var(--page-h1-line);color:var(--page-ink-strong);margin-block:0 .6em}
`;

// The emoji feature, fetched on first use: one list of glyphs, one way of finding one and
// one rule for what a single glyph is. A fetch that failed is not kept, so it is asked for
// again the next time.
let emojiParts = null;
const emojiModule = () => (emojiParts ??= import("./emoji.js").catch((error) => { emojiParts = null; throw error; }));

// One glyph, as a person sees it: a joined family is one, a skin tone is one, a keycap is
// one, and two letters are two. Without a segmenter this refuses rather than cutting a
// glyph in half, and the stored value is bounded in code points and bytes.
export function isIconGlyph(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.trim() || typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return false;
  if ([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length !== 1) return false;
  return [...text].length <= 32 && new TextEncoder().encode(text).length <= 128;
}

// The title is the document's first root H1, and only it carries a page icon: a nested H1
// is no title, and a second root H1 becomes the title only when it moves first.
export function titleOf(doc) {
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type === schema.nodes.heading && node.attrs.level === 1 && node.attrs.parent == null) return { index: i, at, node };
    at += node.nodeSize;
  }
  return null;
}

// The cover the page shows above its title: an ordinary image whose focal point is the
// part of it a person kept in view, so a reader draws it with nothing of this loaded.
function coverImg(doc, attrs) {
  const img = doc.createElement("img");
  img.setAttribute("data-page-cover", "");
  img.setAttribute("src", attrs.pageCoverSrc);
  img.setAttribute("alt", attrs.pageCoverAlt ?? "");
  img.setAttribute("style", `object-position:${attrs.pageCoverX}% ${attrs.pageCoverY}%`);
  return img;
}

// The decorated heading: the block's id on the wrapper and each part of the decoration
// beside the `h1` the text lives in. A heading with no icon draws the plain heading it
// always did, and one with a different glyph, cover or level is a new decoration, so the
// view is rebuilt from the node. The cover is drawn here too: it is the same wrapper, one
// part of it, not a second view.
class TitleHeadingView {
  constructor(node, view) {
    this.node = node;
    this.decorated = !!(node.attrs.pageIcon || node.attrs.pageCoverSrc);
    const doc = view.dom.ownerDocument;
    const head = doc.createElement(`h${node.attrs.level}`);
    head.setAttribute("data-id", node.attrs.id);
    this.dom = this.contentDOM = head;
    if (!this.decorated) return;
    const box = doc.createElement("header");
    box.setAttribute("data-id", node.attrs.id);
    box.setAttribute("data-page-heading", "1");
    head.removeAttribute("data-id");
    if (node.attrs.pageCoverSrc) box.append(coverImg(doc, node.attrs));
    if (node.attrs.pageIcon) {
      const mark = doc.createElement("span");
      mark.setAttribute("data-page-icon", "");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = node.attrs.pageIcon;
      box.append(mark);
    }
    box.append(head);
    this.dom = box;
  }
  update(node) {
    if (this.decorated !== !!(node.attrs.pageIcon || node.attrs.pageCoverSrc) || !node.sameMarkup(this.node)) return false;
    this.node = node;
    return true;
  }
  ignoreMutation(mutation) {
    return !this.contentDOM.contains(mutation.target);
  }
}

export function createFeature({ view = null } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let library = null;
  let session = null;

  function place() {
    try {
      const box = view.dom.parentElement?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const at = view.coordsAtPos(view.state.selection.from);
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

  // The one place an icon reaches the document. The title the command was asked for is read
  // again here: one that was deleted, or one a heading that moved first displaced, is no
  // longer that title and the command refuses rather than decorating another page. A
  // document with no title grows one heading, whole, in this same transaction.
  function writeIcon(s, char) {
    const title = titleOf(view.state.doc);
    const owner = title ? title.node.attrs.id : null;
    if (owner !== s.owner) return { ok: false, code: "stale-target" };
    const tr = view.state.tr;
    if (!title) {
      const first = view.state.doc.maybeChild(0);
      tr.insert(0, schema.nodes.heading.create({ id: newId(), pos: keyBetween(null, first?.attrs.pos ?? null), parent: null, level: 1, pageIcon: char }));
    } else tr.setNodeMarkup(title.at, null, { ...title.node.attrs, pageIcon: char });
    view.dispatch(asStep(tr));
    return { ok: true, icon: char };
  }

  async function choose(index) {
    const s = session;
    if (!s) return { ok: false, code: "not-editing" };
    const entry = s.picker.personAt(index);
    close();
    if (!entry) return { ok: false, code: "no-emoji" };
    if (!isIconGlyph(entry.char)) return { ok: false, code: "invalid-icon" };
    return runFormatted(view, () => writeIcon(s, entry.char));
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

  // The Add icon command: the emoji list, opened for the title. It writes nothing until one
  // is chosen, and nothing at all for a title that changed while the list was open.
  async function open(args) {
    close();
    const s = { owner: titleOf(view.state.doc)?.node.attrs.id ?? null, picker: null, listen: [] };
    s.picker = createMentionPicker({ document: doc, label: "Choose a page icon", empty: "No emoji found", onPick: (index) => choose(index) });
    session = s;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      s.listen.push([target, type, fn, options]);
    };
    listen(doc, "keydown", (event) => key(event), true);
    listen(view.dom, "input", () => close());
    listen(doc, "mousedown", (event) => { if (!s.picker.el.contains(event.target)) close(); }, true);
    (view.dom.parentElement ?? doc.body).appendChild(s.picker.el);

    let list, filter;
    try {
      const mod = await emojiModule();
      filter = mod.filterEmoji;
      library ??= mod.emojiLibrary();
      list = await library();
    } catch (error) {
      close();
      return { ok: false, code: "unavailable", error };
    }
    if (session !== s) return { ok: false, code: "not-editing" };
    s.picker.show(filter(list, args?.query), place());
    anchor(s);
    return { ok: true, picker: true };
  }

  return {
    nodeViews: { heading: (node, editorView) => new TitleHeadingView(node, editorView) },
    css: TITLE_CSS,
    async run(args) {
      return open(args);
    },
    dispose() { close(); },
  };
}
