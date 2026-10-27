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

/**
 * The page state a final save clone carries, or null.
 *
 * One page tag is one page state: a Yjs page never has two, a tag holding plain block
 * data is a page's own content rather than one, and a tag that does not parse is not one
 * either. The value is copied, because the store keeps writing to its own after the
 * capture and a checkpoint must prove the bytes this capture sent.
 *
 * Registered with core/snapshot only by the recovery integration, so a page that
 * journals nothing never reads it.
 *
 * @param {HTMLElement} root - the save clone, after every transform
 * @returns {?Object}
 */
export function pageStateOfClone(root) {
  const tags = pageTags(root);
  if (tags.length !== 1) return null;
  let value;
  try { value = parseJsonRelaxed(tags[0].textContent); }
  catch { return null; }
  const { v, g, y } = value ?? {};
  if (v !== 1 || !y || typeof y !== "object" || Array.isArray(y)) return null;
  return { v, g, y: { ...y } };
}

/**
 * The canonical article one page state projects to.
 *
 * The same projection the save writes into the capture's article, run over the state a
 * capture pinned or a host handed back. A state whose projection is not the article
 * that was accepted is not a proof of those bytes, whichever transform changed it.
 *
 * @param {Object|string} state - a page value, or the page tag text holding one
 * @returns {string}
 */
export function articleOfPageState(state) {
  return renderFromTags([typeof state === "string" ? state : JSON.stringify(state)]).html;
}

addDocumentTransform(projectInto);
