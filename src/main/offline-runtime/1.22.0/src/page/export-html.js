// The readable snapshot: one static HTML document rendered from the live page
// model through the same projection the saved page carries, plus the inventory
// of every image, attachment, chart and embed it references. Nothing here
// fetches, downloads or writes a file: inlining those resources and the export
// action belong to the feature that calls this.
//
// The document keeps the content and drops the machinery: no script, stylesheet,
// live tag, save hook or block envelope, every toggle open, and a table of
// contents as a plain list rather than links into a page that is not running.
import { fragmentCleaner, renderModel } from "./projection.js";
import { documentTitle } from "./document-title.js";

/** A snapshot that cannot be produced without lying about its contents. */
export class PageExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PageExportError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PageExportError(code, message); };

// A reference the document may carry: bytes already inside the file, an address
// on the origin the page was read from, or a plain http(s) URL. A script URL or a
// second document in a data URL is refused by name, never dropped in silence.
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);/i;
const SCRIPT_URL = /^(?:javascript|vbscript|data):/i;
const REMOTE = /^https?:\/\//i;
const ROOTED = /^\/(?!\/)/;
const squash = (value) => String(value ?? "").trim().replace(/[\u0000-\u0020]/g, "");
const carriable = (value) => DATA_IMAGE.test(value) || !SCRIPT_URL.test(value);

function reference(raw) {
  const s = squash(raw);
  if (!s || s.startsWith("#")) return null;
  if (DATA_IMAGE.test(s)) return { url: s, inline: true };
  if (/^\/\//.test(s)) return { url: `https:${s}`, inline: false };
  if (ROOTED.test(s) || REMOTE.test(s)) return { url: s, inline: false };
  return undefined;
}

const RESOURCE_TAGS = { img: "image", iframe: "embed", embed: "embed", object: "embed", video: "embed", audio: "embed", source: "embed", track: "embed" };
const SOURCE_ATTR = { object: "data" };
const STATIC_MEDIA = /<(?:img|svg|video|audio|canvas|iframe|table)\b/i;
const STATIC_TEXT = /<(?:meta|style|img|br|hr|input)\b[^>]*>/gi;

const blockOf = (el) => el.closest?.("[data-id]")?.getAttribute("data-id") || null;
const where = (kind, blockId) => (blockId ? `${kind} in block ${blockId}` : kind);

// Every reference the document carries, in the order it appears, each named by the
// block that holds it. Charts are listed too: their drawing is already SVG inside
// the file, so they name no address and need nothing fetched.
function resourcesOf(container) {
  const out = [];
  const seen = new Set();
  const add = (kind, raw, blockId) => {
    const ref = reference(raw);
    if (ref === undefined) {
      fail("unsafe-url", `The ${where(kind, blockId)} points at ${String(raw).trim().slice(0, 120)}, which a reading copy cannot carry`);
    }
    if (!ref) return;
    const key = `${kind}\u0000${ref.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, url: ref.url, blockId: blockId ?? null, inline: ref.inline });
  };
  for (const el of container.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    const kind = RESOURCE_TAGS[tag];
    if (kind) add(kind, el.getAttribute(SOURCE_ATTR[tag] ?? "src"), blockOf(el));
    if (tag === "img" || tag === "source") {
      for (const candidate of String(el.getAttribute("srcset") ?? "").split(",")) add("image", candidate.trim().split(/\s+/)[0], blockOf(el));
    }
  }
  for (const el of container.querySelectorAll('[data-type="file"]')) {
    add("attachment", el.getAttribute("data-src"), blockOf(el));
    add("attachment", el.querySelector("a[href]")?.getAttribute("href"), blockOf(el));
  }
  for (const el of container.querySelectorAll('figure[data-type="chart"]')) {
    const blockId = blockOf(el);
    const key = `chart\u0000${blockId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "chart", url: null, blockId: blockId ?? null, inline: true });
  }
  return out;
}

// The article as a reader gets it: no script, stylesheet or runtime attribute, and
// no link to a script URL. A resource the document needs was already checked.
function scrub(container) {
  for (const el of [...container.querySelectorAll("script, style, link, meta, base")]) el.remove();
  for (const el of container.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      const attr = name.toLowerCase();
      if (attr.startsWith("on") || attr === "clay" || attr === "merge" || attr === "live" || attr === "srcdoc" || attr.startsWith("data-clay") || attr.startsWith("clay-")) {
        el.removeAttribute(name);
        continue;
      }
      if (/^(href|src|action|formaction|poster|data-src|xlink:href)$/.test(attr) && !carriable(squash(value))) el.removeAttribute(name);
    }
  }
}

// The table of contents reads as a nested list of its entries; its anchors point at
// a page that is not running here.
function plainToc(container) {
  for (const nav of container.querySelectorAll('nav[data-type="toc"]')) {
    for (const link of [...nav.querySelectorAll("a")]) link.replaceWith(link.ownerDocument.createTextNode(link.textContent));
  }
}

const openToggles = (model) => model.map((item) => (item.t === "toggle" ? { ...item, open: true } : item));

const hasStatic = (html, clean) => {
  const cleaned = clean.fallback(String(html ?? ""));
  return STATIC_MEDIA.test(cleaned) || cleaned.replace(STATIC_TEXT, "").replace(/<[^>]+>/g, "").trim() !== "";
};

const escText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const READER_CSS = `:root { color-scheme: light dark; }
body { margin: 0; background: #ffffff; color: #37352f; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; }
article[data-page] { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; }
article[data-page] > * { margin: 0.7em 0; }
header[data-page-heading] { position: relative; margin-bottom: 1.6em; }
header[data-page-heading] img[data-page-cover] { display: block; width: 100%; max-height: 18rem; object-fit: cover; border-radius: 6px; margin-bottom: 1em; }
header[data-page-heading] span[data-page-icon] { display: block; font-size: 2.6em; line-height: 1.2; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; font-weight: 650; margin: 1.2em 0 0.3em; }
h1 { font-size: 2em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.2em; }
p, li { max-width: 100%; }
a { color: #0b6bcb; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid rgba(55, 53, 47, 0.2); color: #5b5952; }
aside.page-callout { border: 1px solid rgba(55, 53, 47, 0.14); border-radius: 6px; padding: 0.8em 1em; background: rgba(55, 53, 47, 0.04); }
pre { overflow-x: auto; padding: 0.9em 1em; border-radius: 6px; background: rgba(55, 53, 47, 0.06); font-size: 0.9em; }
code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.92em; }
pre code { font-size: inherit; }
details { margin: 0.4em 0; }
details > summary { cursor: pointer; font-weight: 600; }
details > summary h1, details > summary h2, details > summary h3 { display: inline; margin: 0; }
hr { border: 0; border-top: 1px solid rgba(55, 53, 47, 0.18); }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid rgba(55, 53, 47, 0.18); padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
th { background: rgba(55, 53, 47, 0.04); font-weight: 600; }
figure { margin: 1em 0; }
figure img { max-width: 100%; height: auto; border-radius: 4px; }
figcaption { font-size: 0.88em; color: #78766f; margin-top: 0.4em; }
figure[data-type="chart"] svg { max-width: 100%; height: auto; }
section[data-type="board"] { display: flex; gap: 1em; overflow-x: auto; align-items: flex-start; }
section[data-type="board"] > div { min-width: 12rem; border: 1px solid rgba(55, 53, 47, 0.14); border-radius: 6px; padding: 0.6em 0.8em; }
section[data-type="board"] h4 { margin: 0 0 0.4em; font-size: 0.95em; }
section[data-type="board"] ul { list-style: none; margin: 0; padding: 0; }
section[data-type="board"] li { border: 1px solid rgba(55, 53, 47, 0.14); border-radius: 4px; padding: 0.4em 0.5em; margin-bottom: 0.4em; }
nav[data-type="toc"] ul { list-style: none; padding-left: 0; }
nav[data-type="toc"] ul ul { padding-left: 1.2em; }
li > input[type="checkbox"] { margin-right: 0.4em; }
[data-type="file"] a { display: inline-block; padding: 0.4em 0.7em; border: 1px solid rgba(55, 53, 47, 0.18); border-radius: 4px; }
@media (prefers-color-scheme: dark) {
  body { background: #191919; color: #d4d4d4; }
  aside.page-callout, th, pre { background: rgba(255, 255, 255, 0.06); }
  th, td, section[data-type="board"] > div, section[data-type="board"] li, [data-type="file"] a { border-color: rgba(255, 255, 255, 0.16); }
  a { color: #6cb0f5; }
}`;

function standalone(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escText(title)}</title>
<style>
${READER_CSS}
</style>
</head>
<body>
<article data-page="1">
${body}
</article>
</body>
</html>
`;
}

/**
 * One readable HTML document for the page model, and the resources it references.
 * An address the file cannot carry, or a tool with no static rendering, throws a
 * PageExportError naming what stopped it rather than producing a truncated file.
 */
export function renderExportHtml(model, { title = null, fallbackOf = null, doc = globalThis.document } = {}) {
  if (!Array.isArray(model)) throw new TypeError("page: an export renders a projection model");
  const clean = fragmentCleaner(doc);
  const fallback = fallbackOf ?? ((id) => model.find((item) => item.id === id)?.artifact?.fallbackHtml ?? "");
  for (const item of model) {
    if (item.t === "tool" && !hasStatic(fallback(item.id), clean)) {
      fail("unsupported-tool", `Block ${item.id} holds a tool with no static rendering, which a reading copy cannot show`);
    }
  }
  const container = doc.createElement("div");
  container.innerHTML = renderModel(openToggles(model), { fallbackOf: fallback, clean });
  const resources = resourcesOf(container);
  scrub(container);
  plainToc(container);
  const name = title ?? documentTitle(model);
  return { html: standalone(name, container.innerHTML), title: name, resources };
}
