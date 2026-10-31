// Markdown export: the live page record as Markdown text, and the report of what the
// format could not carry. Nothing is dropped silently: a construct written as semantic
// HTML from the canonical projection is listed as an extension, and a construct whose
// meaning goes away is listed as a loss, each named per block. No parser is involved:
// the record is read once and the text is built from it.
import { project, renderModel, tocHtml, unitsOf } from "./projection.js";
import { descriptors } from "./format-codec.js";

const ATOM = "\uFFFC";
const BREAK = '@{"type":"hard_break"}';
const CODES = { b: "strong", i: "em", s: "strike", c: "code" };
const TEXTUAL = new Set(["paragraph", "heading", "list_item", "toggle", "quote", "callout", "code_block"]);
const KNOWN = new Set([
  "paragraph", "heading", "list_item", "quote", "callout", "code_block", "toggle",
  "divider", "toc", "image", "file", "table", "chart", "board", "tool", "preserved",
]);
// The characters that could start a construct wherever they stand, and the ones that
// could only at the start of a line: a list marker, a setext rule, a fence, and an
// ordered marker's dot. A backslash before one of them is Markdown's own escape, and
// the import reads it back as the character, so the text round-trips.
const SPECIAL = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "#", "!", ">", "|", "<", "&"]);
const STARTS = new Set(["-", "+", "=", "~"]);
function escText(value) {
  const text = String(value ?? "");
  let out = "";
  let line = "";
  for (const ch of text) {
    let escape = SPECIAL.has(ch);
    if (!escape && line === "" && STARTS.has(ch)) escape = true;
    if (!escape && ch === "." && line !== "" && /^\d+$/.test(line)) escape = true;
    out += escape ? `\\${ch}` : ch;
    line = ch === "\n" ? "" : line + ch;
  }
  return out;
}

// A code span of any content: a fence longer than the longest backtick run inside it,
// padded when the first or last character would otherwise touch the fence.
function codeSpan(text) {
  const value = String(text);
  const longest = (value.match(/`+/g) ?? []).reduce((long, run) => Math.max(long, run.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = /^[`\s]|[`\s]$/.test(value) ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function fence(body, lang = "") {
  const value = String(body ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const longest = (value.match(/`+/g) ?? []).reduce((long, run) => Math.max(long, run.length), 0);
  const mark = "`".repeat(Math.max(3, longest + 1));
  const info = String(lang ?? "").trim().split(/\s+/)[0].replace(/`/g, "");
  return `${mark}${info}\n${value}\n${mark}`;
}

// A link destination that would end the link at its first space or parenthesis is
// written in angle brackets instead.
const hrefText = (href) => (/[\s()<>]/.test(href) ? `<${href.trim().replace(/</g, "%3C").replace(/>/g, "%3E")}>` : href);

// One unit's mark key as what Markdown can write: the codes it has, the link it
// carries, and every mark it would have to drop.
function parseKey(key) {
  const codes = {};
  let href = null;
  const dropped = [];
  for (const desc of descriptors(key)) {
    if (desc.name === undefined) {
      if (desc.code === "a") href = String(desc.attrs?.[0] ?? "");
      else if (CODES[desc.code]) codes[CODES[desc.code]] = true;
      else dropped.push(desc.code);
      continue;
    }
    if (desc.name === "mention") {
      dropped.push("mention");
      continue;
    }
    if (desc.name === "date") continue;
    dropped.push(desc.name);
  }
  return { codes, href, dropped };
}

// A text block's inline content as Markdown. `note` names what is being dropped in
// this block, once per construct.
function inline(item, note) {
  const c = typeof item.c === "string" ? item.c : "";
  const units = unitsOf(item.m, c.length) ?? [];
  let out = "";
  for (let i = 0; i < c.length;) {
    const key = units[i] ?? "";
    if (c[i] === ATOM && key[0] === "@") {
      if (key === BREAK) out += "\\\n";
      else note("inline object");
      i++;
      continue;
    }
    let j = i + 1;
    while (j < c.length && (units[j] ?? "") === key && !(c[j] === ATOM && key[0] === "@")) j++;
    const raw = c.slice(i, j);
    const { codes, href, dropped } = parseKey(key);
    for (const name of dropped) note(name);
    let piece;
    if (codes.code) {
      piece = codeSpan(raw);
      for (const name of ["strong", "em", "strike"]) if (codes[name]) note(name);
    } else {
      const text = escText(raw);
      const lead = text.slice(0, text.length - text.trimStart().length);
      const trail = text.slice(text.trimEnd().length);
      let core = text.slice(lead.length, text.length - trail.length);
      if (core) {
        if (codes.em) core = `*${core}*`;
        if (codes.strong) core = `**${core}**`;
        if (codes.strike) core = `~~${core}~~`;
      }
      piece = lead + core + trail;
    }
    if (href) piece = `[${piece}](${hrefText(href)})`;
    out += piece;
    i = j;
  }
  return out;
}

const levelOf = (value, fallback = 2) => Math.min(6, Math.max(1, Number.isInteger(value) ? value : fallback));

// The canonical projection of one block, or of a toggle with its whole body. A chart
// is drawn against its source table, which is rendered after it and cut away again.
function htmlFor(item, model) {
  if (item.t === "toc") return tocHtml(item, model);
  if (item.t === "chart") {
    const html = renderModel([item, ...model.filter((one) => one.t === "table")]);
    const cut = html.indexOf("\n<table");
    return cut < 0 ? html : html.slice(0, cut);
  }
  return renderModel([item]);
}

const decorated = (item) => {
  const names = [];
  if (item.pageIcon != null && item.pageIcon !== "") names.push("Page icon");
  if (item.pageCoverSrc != null || item.pageCoverAlt != null || item.pageCoverX != null || item.pageCoverY != null) names.push("Page cover");
  return names;
};

// The blocks a toggle owns, which the projection nests inside it. The model lists a
// toggle before its body, in order, so the body is the run that names it as an ancestor.
function bodyOf(items, item) {
  const out = [];
  const at = items.indexOf(item);
  const byId = new Map(items.map((one) => [one.id, one]));
  for (let i = at + 1; i < items.length; i++) {
    let up = items[i].parent ?? null;
    let inside = false;
    for (let depth = 0; up && depth < 64; depth++) {
      if (up === item.id) { inside = true; break; }
      up = byId.get(up)?.parent ?? null;
    }
    if (!inside) break;
    out.push(items[i]);
  }
  return out;
}

export function exportMarkdown(blocks) {
  const model = project(blocks ?? {});
  const items = model.filter((one) => one && typeof one.t === "string");
  const title = items.find((one) => one.t === "heading" && (one.level ?? 2) === 1 && (one.parent ?? null) === null) ?? null;
  const extensions = [];
  const losses = [];
  const extension = (item, name) => extensions.push({ block: item.id ?? null, type: item.t, name });
  const noteFor = (item) => {
    const seen = new Set();
    return (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      losses.push({ block: item.id ?? null, type: item.t, name });
    };
  };

  const lines = [];
  let listOpen = false;
  const push = (text) => {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...String(text).split("\n"));
    listOpen = false;
  };
  const pushItem = (text) => {
    if (!listOpen && lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(text);
    listOpen = true;
  };
  const skip = new Set();

  for (const raw of model) {
    if (!raw || typeof raw.t !== "string" || skip.has(raw.id)) continue;
    const item = raw;
    const note = noteFor(item);
    const t = item.t;

    // A block type Markdown has no form for keeps only its text, and says so.
    if (t === "opaque_block" || !KNOWN.has(t)) {
      note(`opaque record (${String(item.raw?.t ?? t)})`);
      const text = TEXTUAL.has(t) ? inline(item, note) : typeof item.c === "string" ? escText(item.c) : "";
      if (text.trim()) push(text);
      continue;
    }

    if (t === "paragraph") {
      push(inline(item, note));
      continue;
    }

    if (t === "heading") {
      const names = item.id === title?.id ? decorated(item) : [];
      if (names.length) {
        for (const name of names) extension(item, name);
        push(htmlFor(item, model));
        continue;
      }
      if (item.pageIcon != null && item.pageIcon !== "") note("heading icon");
      push(`${"#".repeat(levelOf(item.level))} ${inline(item, note)}`.trimEnd());
      continue;
    }

    if (t === "toggle") {
      const level = item.level === 1 || item.level === 2 || item.level === 3 ? item.level : null;
      if (level) {
        note("toggle collapse");
        push(`${"#".repeat(level)} ${inline(item, note)}`);
        continue;
      }
      extension(item, "Toggle");
      const body = bodyOf(items, item);
      for (const one of body) skip.add(one.id);
      push(renderModel([item, ...body]));
      continue;
    }

    if (t === "list_item") {
      if (item.owner != null) note("owner");
      if (item.due != null) note("due date");
      const indent = Math.max(0, Math.min(8, Number.isInteger(item.indent) ? item.indent : 0));
      const marker = item.kind === "ordered" ? "1." : "-";
      const box = item.kind === "check" ? (item.checked ? " [x]" : " [ ]") : "";
      pushItem(`${"    ".repeat(indent)}${marker}${box} ${inline(item, note)}`.trimEnd());
      continue;
    }

    if (t === "quote") {
      const text = inline(item, note).split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
      push(text);
      continue;
    }

    if (t === "code_block") {
      push(fence(item.c, item.lang));
      continue;
    }

    if (t === "divider") {
      push("---");
      continue;
    }

    if (t === "image") {
      const src = String(item.src ?? "");
      if (item.width != null) note("image width");
      if (item.align != null) note("image alignment");
      if (!src) {
        note("image address");
        const alt = String(item.alt ?? "");
        if (alt) push(escText(alt));
        continue;
      }
      const alt = escText(item.alt ?? "");
      const caption = item.caption ? ` "${String(item.caption).replace(/"/g, '\\"')}"` : "";
      push(`![${alt}](${hrefText(src)}${caption})`);
      continue;
    }

    if (t === "file") {
      if (item.size != null) note("file size");
      if (item.mime != null) note("file type");
      const src = String(item.src ?? "");
      const name = escText(item.name || "file");
      push(src ? `[${name}](${hrefText(src)})` : name);
      continue;
    }

    if (t === "table") {
      const cols = Array.isArray(item.cols) ? item.cols : [];
      const rows = Array.isArray(item.rows) ? item.rows : [];
      for (const col of cols) {
        if (col.kind != null) note("column kind");
        if (col.width != null) note("column width");
      }
      if (item.sort != null) note("sort");
      if (!cols.length) {
        note("empty table");
        continue;
      }
      const cell = (value) => {
        const one = typeof value === "string" ? escText(value) : value && typeof value === "object" ? inline(value, note) : "";
        return one.replace(/\n/g, " ").trim();
      };
      const header = cols.map((col) => escText(col.name ?? "")).join(" | ");
      const rule = cols.map(() => "---").join(" | ");
      const body = rows.map((row) => `| ${cols.map((col) => cell(row.cells?.[col.id])).join(" | ")} |`);
      push([`| ${header} |`, `| ${rule} |`, ...body].join("\n"));
      continue;
    }

    if (t === "toc") {
      extension(item, "Table of contents");
      push(tocHtml(item, model));
      continue;
    }

    if (t === "chart") {
      extension(item, "Chart");
      push(htmlFor(item, model));
      continue;
    }

    if (t === "board") {
      extension(item, "Board");
      push(htmlFor(item, model));
      continue;
    }

    if (t === "tool") {
      extension(item, "Tool");
      push(htmlFor(item, model));
      continue;
    }

    if (t === "preserved") {
      extension(item, "Raw HTML");
      push(htmlFor(item, model));
      continue;
    }

    if (t === "callout") {
      extension(item, "Callout");
      push(htmlFor(item, model));
    }
  }

  const text = lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return { text: text ? `${text}\n` : "", extensions, losses, blocks: items.length };
}

// A name a download can carry: the page's, with the characters a filesystem refuses
// replaced, never a leading or trailing dot or space.
export function markdownFileName(name = "page") {
  const base = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  return `${base || "page"}.md`;
}
