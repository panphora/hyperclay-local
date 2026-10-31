// The table of contents: the headings a document has and the anchors that link to them.
// The saved renderer and the editor's node view ask one helper; a reader's reveal and
// the anchor decoder live in toc-link.js, which nothing but a followed link loads.
export { TOC_ANCHOR, TOC_LABEL, blockAnchor, tocHtml, tocEntries } from "./projection.js";
export { idFromHref } from "./toc-link.js";
