// The page plugin's ProseMirror schema.
//
// Every top-level node is one block of the live record (src/page/model.js): it
// carries `id` (its key in the store), `pos` (its fractional order key) and
// `parent` (the toggle it sits inside, or null). The document is flat on
// purpose: lists are items with `kind` and `indent`, a toggle's body is the
// blocks naming it as parent. Two people editing two items of one list then
// touch two keys, never one shared array.
//
// toDOM here draws the editing surface. The saved, readable HTML is the
// projection's job, not this file's.
import { model } from "../vendor/prosemirror.vendor.js";
import { safeHref, safeFileHref } from "./address.js";

const block = { id: { default: null }, pos: { default: null }, parent: { default: null } };
const ref = (n, extra = {}) => ({ "data-id": n.attrs.id, ...extra });

export const schema = new model.Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: block,
      toDOM: (n) => ["p", ref(n), 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      defining: true,
      attrs: { ...block, level: { default: 2 } },
      toDOM: (n) => [`h${n.attrs.level}`, ref(n), 0],
    },
    list_item: {
      group: "block",
      content: "inline*",
      attrs: {
        ...block,
        kind: { default: "bullet" },
        indent: { default: 0 },
        checked: { default: false },
        owner: { default: null },
        due: { default: null },
      },
      toDOM: (n) => ["div", ref(n, {
        class: "page-li",
        "data-kind": n.attrs.kind,
        "data-indent": String(n.attrs.indent),
        "data-checked": n.attrs.checked ? "true" : "false",
      }), 0],
    },
    quote: {
      group: "block",
      content: "inline*",
      attrs: block,
      toDOM: (n) => ["blockquote", ref(n), 0],
    },
    callout: {
      group: "block",
      content: "inline*",
      attrs: block,
      toDOM: (n) => ["aside", ref(n, { class: "page-callout" }), 0],
    },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: { ...block, lang: { default: "" } },
      toDOM: (n) => ["pre", ref(n, { "data-lang": n.attrs.lang }), ["code", 0]],
    },
    toggle: {
      group: "block",
      content: "inline*",
      attrs: { ...block, open: { default: false } },
      toDOM: (n) => ["div", ref(n, { class: "page-toggle", "data-open": n.attrs.open ? "true" : "false" }), 0],
    },
    divider: {
      group: "block",
      atom: true,
      attrs: block,
      toDOM: (n) => ["hr", ref(n)],
    },
    image: {
      group: "block",
      atom: true,
      draggable: true,
      attrs: { ...block, src: { default: "" }, alt: { default: "" }, caption: { default: "" }, width: { default: null }, align: { default: null } },
      toDOM: (n) => ["figure", ref(n, { "data-type": "image", ...(n.attrs.width ? { "data-width": String(n.attrs.width) } : {}), ...(n.attrs.align ? { "data-align": n.attrs.align } : {}) }), ["img", { src: n.attrs.src, alt: n.attrs.alt }], ["figcaption", n.attrs.caption]],
    },
    file: {
      group: "block",
      atom: true,
      attrs: { ...block, src: { default: "" }, name: { default: "" }, size: { default: null }, mime: { default: null } },
      toDOM: (n) => ["div", ref(n, { class: "page-file", "data-type": "file", "data-src": safeFileHref(n.attrs.src) ?? "", "data-name": n.attrs.name, "data-size": n.attrs.size == null ? "" : String(n.attrs.size), "data-mime": n.attrs.mime ?? "" }),
        ["a", { href: safeFileHref(n.attrs.src), target: "_blank", rel: "noopener noreferrer" }, n.attrs.name || "file"]],
    },
    table: {
      group: "block",
      content: "table_row+",
      isolating: true,
      attrs: { ...block, cols: { default: {} }, sort: { default: null } },
      toDOM: (n) => ["table", ref(n), ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      attrs: { id: { default: null }, pos: { default: null } },
      toDOM: (n) => ["tr", ref(n), 0],
    },
    table_cell: {
      content: "inline*",
      isolating: true,
      attrs: { col: { default: null } },
      toDOM: (n) => ["td", { "data-col": n.attrs.col }, 0],
    },
    chart: {
      group: "block",
      atom: true,
      attrs: {
        ...block,
        source: { default: null },
        kind: { default: "line" },
        x: { default: null },
        series: { default: [] },
        title: { default: "" },
        highlight: { default: null },
      },
      toDOM: (n) => ["figure", ref(n, { "data-type": "chart" })],
    },
    board: {
      group: "block",
      atom: true,
      attrs: { ...block, columns: { default: {} }, cards: { default: {} } },
      toDOM: (n) => ["section", ref(n, { "data-type": "board" })],
    },
    tool: {
      group: "block",
      atom: true,
      attrs: { ...block, artifact: { default: null }, rev: { default: null }, state: { default: {} } },
      toDOM: (n) => ["section", ref(n, { "data-type": "tool" })],
    },
    preserved: {
      group: "block",
      atom: true,
      attrs: { ...block, html: { default: "" } },
      toDOM: (n) => ["div", ref(n, { "data-type": "preserved" })],
    },
    // A block type a newer peer wrote and this runtime has no schema for. It keeps
    // the original record in raw and its inline content for mapping, and it shows
    // an inert fallback: no content DOM to edit, no command that rewrites it.
    opaque_block: {
      group: "block",
      content: "inline*",
      atom: true,
      isolating: true,
      selectable: true,
      attrs: { ...block, raw: { default: null } },
      toDOM: (n) => ["div", ref(n, { "data-type": "newer-format", "data-format": String(n.attrs.raw?.t ?? ""), contenteditable: "false" }),
        ["span", { class: "page-newer-format" }, `Newer format: ${String(n.attrs.raw?.t ?? "")}`],
        ["span", { class: "page-newer-format-text" }, n.textContent]],
    },

    text: { group: "inline" },
    hard_break: {
      group: "inline",
      inline: true,
      selectable: false,
      toDOM: () => ["br"],
    },
  },
  marks: {
    strong: { toDOM: () => ["strong", 0] },
    em: { toDOM: () => ["em", 0] },
    strike: { toDOM: () => ["s", 0] },
    code: { toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM: (m) => ["a", { href: safeHref(m.attrs.href) }, 0],
    },
    // A person mention is ordinary text with this mark over it: the name is the label
    // and `id` is the people registry's reference. It links nowhere and notifies nobody.
    mention: {
      attrs: { id: {} },
      inclusive: false,
      excludes: "mention date link",
      toDOM: (m) => ["span", { "data-page-mention": m.attrs.id }, 0],
    },
    // A date mention is the calendar date as ordinary ISO text with this mark over it:
    // `date` is YYYY-MM-DD, and no time, zone, reminder or relative word is stored.
    date: {
      attrs: { date: {} },
      inclusive: false,
      excludes: "mention date link",
      toDOM: (m) => ["time", { datetime: m.attrs.date, "data-page-date": "" }, 0],
    },
    // The floor-1 formats (format-native.js): written as named descriptors,
    // drawn as the elements the saved article keeps for them.
    underline: { toDOM: () => ["u", 0] },
    text_color: {
      attrs: { color: {} },
      toDOM: (m) => ["span", { "data-color": m.attrs.color }, 0],
    },
    highlight: {
      attrs: { color: {} },
      toDOM: (m) => ["mark", { "data-color": m.attrs.color }, 0],
    },
  },
});
