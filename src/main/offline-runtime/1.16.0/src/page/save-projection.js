// The page's save transform: the clone's article is rendered from the clone's
// own page tags, which plugins/live.js has already written with the values this
// save carries. Statically importing save-freeze.js makes ES module evaluation
// register its transform first, so its restore of the load-time article can
// never run after this and undo it.
import "../attrs/save-freeze.js";
import { addDocumentTransform } from "../core/snapshot.js";
import { parseJsonRelaxed } from "../vendor/hyper-morph-json.vendor.js";
import { fragmentCleaner, project, renderModel, revOf } from "./projection.js";
import { documentTitle } from "./document-title.js";
import { customTitle, writeTitle } from "./document-title-dom.js";
import { blocksFromPageValues } from "./ybind/decode.js";
import { YDecodeError } from "./ybind/provider.js";

export const ARTICLE = "article[data-page]";
const PAGE = /^page(\.[0-9]+)?$/;

export function pageTags(root) {
  return [...root.querySelectorAll('script[merge][clay~="live"]')].filter((el) => PAGE.test(el.getAttribute("merge")));
}

// Captures run several times per save (save, comparison, dirty) and once per
// incoming frame (the merge's save clone). Comparison and dirty clones have
// neither the article nor the tags, so they return at once; the rest share one
// render while the tags hold the same text.
let memo = null;

export function renderFromTags(texts) {
  const key = texts.join("\u0000");
  if (memo && memo.key === key) return memo;
  const values = texts.map((text) => {
    try { return parseJsonRelaxed(text); }
    catch { throw new YDecodeError("invalid-json", "Cannot read the page data as JSON"); }
  });
  const blocks = blocksFromPageValues(values);
  const model = project(blocks);
  const fallbackOf = (id) => {
    const html = blocks[id]?.artifact?.fallbackHtml;
    return typeof html === "string" ? html : "";
  };
  memo = { key, html: renderModel(model, { fallbackOf, clean: fragmentCleaner(document) }), rev: revOf(model), model, title: documentTitle(model) };
  return memo;
}

export function projectInto(clone) {
  const article = clone.querySelector(ARTICLE);
  if (!article) return;
  const tags = pageTags(clone);
  if (!tags.length) return;
  const { html, rev, title } = renderFromTags(tags.map((el) => el.textContent));
  if (article.innerHTML !== html) article.innerHTML = html;
  article.setAttribute("data-rev", rev);
  if (!customTitle(clone)) writeTitle(clone, title);
}

addDocumentTransform(projectInto);
