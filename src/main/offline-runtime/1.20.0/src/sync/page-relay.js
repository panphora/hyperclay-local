import { importMap } from "../vendor/hyper-morph-identity.vendor.js";
import { serializeForSync } from "../core/snapshot.js";

const PAGE = /^page(\.[0-9]+)?$/;
const tags = (root) => [...root.querySelectorAll('script[merge][clay~="live"]')]
  .filter((el) => PAGE.test(el.getAttribute("merge")));

export function pageRelay(pending, acceptedHtml, identity) {
  // A capture with no page article has nothing to overlay, and a document without
  // one is not parsed at all: nothing outside the article would change.
  if (!pending.html.includes("data-page")) return pending;
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const outgoing = parse(pending.html);
  const article = outgoing.querySelector("article[data-page]");
  if (!article) return pending;
  const accepted = parse(acceptedHtml);
  const savedArticle = accepted.querySelector("article[data-page]");
  if (!savedArticle) return null;
  const oldIds = importMap(outgoing.documentElement, pending.identityMap);

  const replace = (old, source) => {
    const next = outgoing.importNode(source, true);
    const id = oldIds.get(old);
    if (id) oldIds.set(next, id);
    old.replaceWith(next);
    return next;
  };
  const nextArticle = replace(article, savedArticle);
  const prior = new Map(tags(outgoing).map((el) => [el.getAttribute("merge"), el]));
  for (const saved of tags(accepted)) {
    const name = saved.getAttribute("merge");
    const old = prior.get(name);
    if (old) replace(old, saved);
    else nextArticle.before(outgoing.importNode(saved, true));
    prior.delete(name);
  }
  for (const old of prior.values()) old.remove();
  const title = outgoing.querySelector("head > title");
  const savedTitle = accepted.querySelector("head > title");
  if (title && savedTitle) replace(title, savedTitle);
  else if (savedTitle) outgoing.head.append(outgoing.importNode(savedTitle, true));
  else title?.remove();

  const root = outgoing.documentElement;
  const identityMap = identity.exportMap(root, (node) => {
    const id = oldIds.get(node);
    if (!id) return null;
    identity.adopt(node, id);
    return node;
  });
  return { ...pending, html: serializeForSync(root), identityMap };
}
