// The table of contents' node view: one `nav` of links to the document's headings,
// derived from the document itself. Loaded the first time a document has or takes one.
//
// Following a link reveals what a closed toggle hides without writing anything: in the
// editor the reveal lives in the collapse plugin's own state, so nothing is saved, no
// undo step is made and no peer is told.
import { state } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { blockMap } from "../model.js";
import { project } from "../projection.js";
import { outline, revealToggles } from "../blocks.js";
import { announce } from "../announce.js";
import { idFromHref, tocHtml } from "../toc.js";

const { TextSelection } = state;

// Show the block `id` and open the collapsed toggles above it for this reader only. A
// target the document no longer holds is a no-op that says so.
export function followTocLink(view, id) {
  const ents = outline(view.state.doc);
  const i = ents.findIndex((e) => e.node.attrs.id === id);
  if (i < 0) {
    announce(view, "That link's block is gone");
    return null;
  }
  const closed = [];
  for (let up = ents[i].up; up >= 0; up = ents[up].up) {
    if (ents[up].node.type === schema.nodes.toggle && !ents[up].open) closed.push(ents[up].node.attrs.id);
  }
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, ents[i].at + 1))
    .setMeta("addToHistory", false);
  view.dispatch(revealToggles(tr, closed).scrollIntoView());
  return ents[i];
}

export class TocView {
  constructor(node, view) {
    this.node = node;
    this.view = view;
    this.doc = view.state.doc;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("div");
    this.dom.className = "page-toc";
    this.dom.contentEditable = "false";
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Table of contents");
    this.dom.addEventListener("mousedown", (event) => { if (event.target.closest?.("a")) event.preventDefault(); });
    this.dom.addEventListener("click", (event) => {
      const link = event.target.closest?.("a");
      if (!link) return;
      event.preventDefault();
      const id = idFromHref(link.getAttribute("href"));
      if (id !== null) followTocLink(this.view, id);
    });
    this.render();
  }
  // ProseMirror calls this on every state update; the entries are rebuilt only when the
  // document itself changed, and then from one projection of it.
  update(node) {
    this.node = node;
    if (this.view.state.doc !== this.doc) {
      this.doc = this.view.state.doc;
      this.render();
    }
    return true;
  }
  render() {
    const html = tocHtml(this.node.attrs, project(blockMap(this.doc)));
    if (this.dom.innerHTML !== html) this.dom.innerHTML = html;
  }
  stopEvent(event) {
    return !!event.target.closest?.("a");
  }
  ignoreMutation() {
    return true;
  }
}

export function createFeature() {
  return {
    id: "toc",
    nodeViews: { toc: (node, view) => new TocView(node, view) },
    css: null,
    dispose() {},
  };
}
