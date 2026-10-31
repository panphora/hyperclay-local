// Markdown import: the tokens marked's lexer returns become the page's flat block
// records (model.js), so a file arrives without marked rendering anything. Raw HTML
// stays inert: a block of it is a preserved block, cleaned of scripts, event handlers
// and script URLs, and inline markup is literal text. A construct the schema cannot
// express is kept as a literal code block and named in `unsupported`; a link or
// image address the editor refuses is left out and named in `refused`, its text
// kept. Nothing is dropped, and a limit refuses with a code rather than mutating.
import { schema } from "./schema.js";
import { markKey, runsOf } from "./inline.js";
import { keysBetween, newId } from "./model.js";
import { fragmentCleaner } from "./projection.js";
import { safeHref, safeSrc } from "./address.js";

// HTML in a file someone sent is kept for its formatting, never for what it can load or
// run: anything that embeds or fetches another document goes, and so does every address
// that runs script, whichever attribute holds it.
const EMBEDS = "iframe, frame, frameset, object, embed, applet, meta, base, link, form, style, animate, set, animateMotion, animateTransform, portal";
const LOADERS = /^(srcdoc|data|formaction|codebase|archive|ping|background|poster|lowsrc|dynsrc)$/i;
const SCRIPTED = /^\s*(javascript|vbscript|data):/i;
function cleanImported(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const el of t.content.querySelectorAll(EMBEDS)) el.remove();
  for (const el of t.content.querySelectorAll("*")) {
    for (const { name, value } of [...el.attributes]) {
      if (LOADERS.test(name) || SCRIPTED.test(value.replace(/[\u0000-\u0020]/g, ""))) el.removeAttribute(name);
    }
  }
  return t.innerHTML;
}

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_DEPTH = 32;
export const MAX_BLOCKS = 10000;

export class MarkdownImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MarkdownImportError";
    this.code = code;
  }
}

const ATOM = "\uFFFC";
const BREAK = { type: "hard_break" };
const BLOCK = new Set(["paragraph", "heading", "list", "blockquote", "code", "table", "hr", "html", "def", "space"]);
const encoder = new TextEncoder();
const M = schema.marks;

const sorted = (marks) => marks.slice().sort((a, b) => a.type.rank - b.type.rank);

function added(marks, name, attrs) {
  if (marks.some((mark) => mark.type === M[name])) return marks;
  return sorted([...marks, M[name].create(attrs)]);
}

// One text block's inline content as the record keeps it: c, and m as runs (one
// key per UTF-16 unit, packed), exactly as flatten and runsOf write it; `parts`
// splits around an image, which the schema only carries as a block of its own.
function inlineOf(tokens, { images = true, refused = [], unsupported = [] } = {}) {
  const parts = [];
  let c = "";
  let m = [];
  const flush = () => {
    if (c) parts.push({ c, m });
    c = "";
    m = [];
  };
  const text = (value, marks) => {
    const str = String(value ?? "");
    if (!str) return;
    const key = markKey(sorted(marks));
    c += str;
    for (let i = 0; i < str.length; i++) m.push(key);
  };
  const atom = (json) => { c += ATOM; m.push("@" + JSON.stringify(json)); };
  const walk = (list, marks) => {
    for (const token of list ?? []) {
      const type = token?.type;
      if (typeof type !== "string") throw new MarkdownImportError("malformed-input", "A Markdown token has no type.");
      switch (type) {
        case "text":
          if (Array.isArray(token.tokens)) walk(token.tokens.filter((child) => typeof child?.type === "string" && !BLOCK.has(child.type)), marks);
          else text(token.text, marks);
          break;
        case "escape": text(token.text, marks); break;
        case "strong": walk(token.tokens, added(marks, "strong")); break;
        case "em": walk(token.tokens, added(marks, "em")); break;
        case "del":
        case "strike": walk(token.tokens, added(marks, "strike")); break;
        case "codespan": text(token.text, added(marks, "code")); break;
        case "br": atom(BREAK); break;
        case "link": {
          const href = safeHref(token.href);
          if (href) walk(token.tokens, added(marks, "link", { href }));
          else {
            refused.push({ type: "link", href: String(token.href ?? "") });
            walk(token.tokens, marks);
          }
          break;
        }
        case "image": {
          const image = { src: String(token.href ?? ""), alt: String(token.text ?? ""), title: token.title ?? "" };
          if (!images) { text(image.alt, marks); break; }
          flush();
          parts.push({ image });
          break;
        }
        // Raw HTML is inert: its text stays text, never a node or a mark.
        case "html": text(token.text ?? token.raw, marks); break;
        case "checkbox": break;
        default:
          unsupported.push({ type, text: String(token.raw ?? token.text ?? "") });
          text(token.raw ?? token.text, marks);
          break;
      }
    }
  };
  walk(tokens, []);
  flush();
  return { parts };
}

export function importMarkdownTokens(tokens) {
  if (!Array.isArray(tokens)) throw new MarkdownImportError("malformed-input", "Markdown import needs the lexer's token list.");
  let size = 0;
  for (const token of tokens) {
    if (!token || typeof token !== "object" || typeof token.type !== "string") throw new MarkdownImportError("malformed-input", "A Markdown token has no type.");
    size += encoder.encode(String(token.raw ?? "")).length;
  }
  if (size > MAX_BYTES) throw new MarkdownImportError("input-too-large", `Markdown import is limited to ${MAX_BYTES} bytes; this file is ${size}.`);

  const blocks = [];
  const unsupported = [];
  const refused = [];
  const used = new Set();
  const fresh = (prefix) => {
    let id = newId(prefix);
    while (used.has(id)) id = newId(prefix);
    used.add(id);
    return id;
  };
  const push = (value) => {
    if (blocks.length + 1 > MAX_BLOCKS) throw new MarkdownImportError("too-many-blocks", `Markdown import is limited to ${MAX_BLOCKS} blocks.`);
    blocks.push(value);
  };
  const deeper = (ctx) => {
    const depth = ctx.depth + 1;
    if (depth > MAX_DEPTH) throw new MarkdownImportError("nesting-too-deep", `Markdown import is limited to ${MAX_DEPTH} levels of nesting.`);
    return depth;
  };
  const block = (t, attrs, { c, m }) => {
    const value = { t, ...attrs, c };
    if (m.some(Boolean)) value.m = runsOf(m);
    return value;
  };
  const imageOf = (image) => {
    const src = safeSrc(image.src);
    if (src) return { t: "image", src, ...(image.alt ? { alt: image.alt } : {}), ...(image.title ? { caption: image.title } : {}) };
    refused.push({ type: "image", href: image.src });
    return image.alt ? block("paragraph", {}, { c: image.alt, m: [] }) : null;
  };
  const textBlocks = (t, attrs, inline) => {
    for (const part of inline.parts) {
      if (!part.image) { push(block(t, attrs, part)); continue; }
      const value = imageOf(part.image);
      if (value) push(value);
    }
  };
  const paragraph = (inline, ctx) => textBlocks(ctx.quote ? "quote" : "paragraph", {}, inline);
  const inline = (tokens, options = {}) => inlineOf(tokens, { refused, unsupported, ...options });
  const literal = (token) => {
    const raw = String(token.raw ?? token.text ?? "");
    unsupported.push({ type: token.type, text: raw });
    push({ t: "code_block", lang: "markdown", c: raw });
  };

  const walk = (list, ctx) => {
    for (const token of list ?? []) {
      const type = token?.type;
      if (typeof type !== "string") throw new MarkdownImportError("malformed-input", "A Markdown token has no type.");
      switch (type) {
        case "space": break;
        case "heading": {
          const level = Math.min(6, Math.max(1, Number.parseInt(token.depth, 10) || 1));
          textBlocks("heading", level === 2 ? {} : { level }, inline(token.tokens, { images: false }));
          break;
        }
        case "paragraph":
        case "text": paragraph(inline(token.tokens ?? [token]), ctx); break;
        case "hr": push({ t: "divider" }); break;
        case "code": push({ t: "code_block", ...(token.lang ? { lang: String(token.lang) } : {}), c: String(token.text ?? "") }); break;
        case "html": {
          const raw = String(token.text ?? token.raw ?? "");
          unsupported.push({ type: "HTML block cleaned", text: raw });
          push({ t: "preserved", html: cleanImported(fragmentCleaner(document).fallback(raw)) });
          break;
        }
        case "blockquote": {
          const depth = deeper(ctx);
          walk(token.tokens, { ...ctx, depth, quote: true });
          break;
        }
        case "list": {
          const depth = deeper(ctx);
          const level = ctx.indent ?? 0;
          const kind = token.ordered ? "ordered" : "bullet";
          for (const item of token.items ?? []) {
            let own = { c: "", m: [] };
            const rest = [];
            for (const child of item?.tokens ?? []) {
              const childType = child?.type;
              if (childType === "checkbox" || childType === "space") continue;
              if (childType === "text" || childType === "paragraph") {
                if (own.c) own = { c: own.c + ATOM, m: [...own.m, "@" + JSON.stringify(BREAK)] };
                const tokens = childType === "paragraph" ? child.tokens ?? [] : [child];
                for (const part of inline(tokens, { images: false }).parts) {
                  own = { c: own.c + part.c, m: [...own.m, ...part.m] };
                }
                rest.push(...(child.tokens ?? []).filter((nested) => typeof nested?.type === "string" && BLOCK.has(nested.type) && nested.type !== "space"));
              } else rest.push(child);
            }
            const itemKind = item?.task ? "check" : kind;
            const attrs = {
              ...(itemKind === "bullet" ? {} : { kind: itemKind }),
              ...(level ? { indent: level } : {}),
              ...(item?.task && item.checked ? { checked: true } : {}),
            };
            push(block("list_item", attrs, own));
            if (rest.length) walk(rest, { ...ctx, depth, indent: level + 1, quote: false });
          }
          break;
        }
        case "table": {
          const header = token.header ?? [];
          if (!header.length) { literal(token); break; }
          const cell = (tokens) => inline(tokens, { images: false }).parts[0] ?? { c: "", m: [] };
          const colIds = header.map(() => fresh("c"));
          const colPos = keysBetween(null, null, header.length);
          const cols = Object.fromEntries(colIds.map((id, i) => [id, { pos: colPos[i], name: cell(header[i]?.tokens).c }]));
          // The header line is the column names, drawn as <thead>; the body holds the data rows.
          const rows = token.rows?.length ? token.rows : [[]];
          const rowPos = keysBetween(null, null, rows.length);
          const values = rows.map((row) => Object.fromEntries(colIds.map((id, i) => {
            const part = cell(row?.[i]?.tokens);
            return [id, part.m.some(Boolean) ? { c: part.c, m: runsOf(part.m) } : part.c];
          })));
          push({ t: "table", cols, rows: Object.fromEntries(values.map((cells, i) => [fresh("r"), { pos: rowPos[i], cells }])) });
          break;
        }
        default: literal(token); break;
      }
    }
  };

  walk(tokens, { depth: 0, indent: 0, quote: false });

  const positions = keysBetween(null, null, blocks.length);
  const out = {};
  blocks.forEach((value, i) => { out[fresh("b")] = { ...value, pos: positions[i] }; });
  return { blocks: out, unsupported, refused };
}
