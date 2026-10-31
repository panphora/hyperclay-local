// The saved table of contents' links: decode the anchor a link names, and reveal
// the block it points at in a reader. Loaded the first time a reader follows one.
const TOC_ANCHOR = "page-block-";

const fromB64url = (text) => {
  const bin = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
};

export function idFromHref(href) {
  const hash = String(href ?? "").replace(/^#/, "");
  if (!hash) return null;
  try {
    return hash.startsWith(TOC_ANCHOR) ? fromB64url(hash.slice(TOC_ANCHOR.length)) : decodeURIComponent(hash);
  } catch {
    return null;
  }
}

// A table of contents link in a saved page shows its target and opens every collapsed
// body above it: reading only, so nothing is saved, no history moves and no peer is
// told. A link whose block is gone, or to anywhere else, changes nothing.
export function followTocLink(article, href) {
  const id = idFromHref(href);
  if (id === null) return null;
  const target = [...article.querySelectorAll("[data-id]")].find((el) => el.getAttribute("data-id") === id) ?? null;
  if (!target) return null;
  for (let el = target.parentElement; el && el !== article; el = el.parentElement) if (el.tagName === "DETAILS") el.open = true;
  target.scrollIntoView?.({ block: "start" });
  return target;
}
