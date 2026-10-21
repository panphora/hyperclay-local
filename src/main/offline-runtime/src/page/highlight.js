// Syntax colours for code blocks. A code block with a language gets inline
// decorations from Shiki, loaded on first use (src/vendor/shiki/). Only blocks
// on screen are highlighted, and only after typing pauses. Colours are
// --page-code-token-* variables, so each page theme sets them.
import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { asStep } from "./blocksel.js";

const { Plugin, PluginKey } = state;
const { Decoration, DecorationSet } = pmView;

// Keep in step with LANGS in scripts/build-shiki-vendor.mjs.
export const LANGS = [
  ["", "Plain text"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["jsx", "JSX"],
  ["tsx", "TSX"],
  ["json", "JSON"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["python", "Python"],
  ["shellscript", "Shell"],
  ["sql", "SQL"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["java", "Java"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["ruby", "Ruby"],
  ["php", "PHP"],
  ["yaml", "YAML"],
  ["markdown", "Markdown"],
  ["diff", "Diff"],
  ["swift", "Swift"],
  ["kotlin", "Kotlin"],
  ["xml", "XML"],
];
const IDS = new Set(LANGS.map(([id]) => id));
const ALIASES = { js: "javascript", mjs: "javascript", ts: "typescript", py: "python", sh: "shellscript", bash: "shellscript", shell: "shellscript", zsh: "shellscript", rb: "ruby", yml: "yaml", md: "markdown", htm: "html", golang: "go", rs: "rust", "c++": "cpp", cs: "csharp", "c#": "csharp", kt: "kotlin" };

export const langOf = (lang) => {
  const k = String(lang ?? "").trim().toLowerCase();
  const id = ALIASES[k] ?? k;
  return IDS.has(id) ? id : "";
};

let shiki = null;
export async function tokenize(code, lang) {
  shiki ??= import("../vendor/shiki/shiki.vendor.js");
  const { codeToTokensBase } = await shiki;
  return codeToTokensBase(code, { lang, theme: "page" });
}

const FOREGROUND = "var(--page-code-foreground)";
const styleOf = (t) => {
  const s = [];
  if (t.color && t.color !== FOREGROUND) s.push(`color: ${t.color}`);
  if (t.fontStyle & 1) s.push("font-style: italic");
  if (t.fontStyle & 2) s.push("font-weight: 600");
  if (t.fontStyle & 4) s.push("text-decoration: underline");
  return s.join("; ");
};

export const highlightKey = new PluginKey("page-highlight");


const CACHE_SIZE = 200;

// Each pass rebuilds every code block's colours from a cache of token runs keyed
// by language and text, so colours follow undo, retyping and deletion without
// tracking what each edit did to the old decorations. While new text waits for
// its tokens, the block keeps its old colours, mapped through the edit, so
// typing never flashes the block uncoloured.
class Highlighter {
  constructor(view, run, delay) {
    this.view = view;
    this.run = run;
    this.delay = delay;
    this.cache = new Map();
    this.pending = new Set();
    this.visible = new Set();
    this.targets = new Map();
    this.timer = 0;
    const IO = view.dom.ownerDocument.defaultView.IntersectionObserver;
    this.io = IO ? new IO((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.id;
        if (this.targets.get(id) === e.target) this.visible[e.isIntersecting ? "add" : "delete"](id);
      }
      this.schedule(0);
    }, { rootMargin: "200px 0px" }) : null;
    this.schedule(0);
  }

  update(view, prev) {
    if (!prev || view.state.doc !== prev.doc) this.schedule(this.delay);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pass(), ms);
  }

  pass() {
    const { view } = this;
    if (view.isDestroyed) return;
    const decos = [];
    const seen = new Map();
    const current = highlightKey.getState(view.state);
    view.state.doc.forEach((node, pos) => {
      if (node.type !== schema.nodes.code_block) return;
      const id = node.attrs.id;
      const dom = view.nodeDOM(pos);
      if (dom) seen.set(id, dom);
      const lang = langOf(node.attrs.lang);
      if (!lang) return;
      const text = node.textContent;
      const key = `${lang}\n${text}`;
      const tokens = this.cache.get(key);
      if (tokens) {
        for (const t of tokens) {
          const style = styleOf(t);
          if (style && t.content) decos.push(Decoration.inline(pos + 1 + t.offset, pos + 1 + t.offset + t.content.length, { style }));
        }
      } else {
        decos.push(...current.find(pos, pos + node.nodeSize));
        if ((this.io && !this.visible.has(id)) || this.pending.has(key)) return;
        this.pending.add(key);
        this.run(text, lang).then((lines) => lines.flat(), () => []).then((flat) => {
          this.pending.delete(key);
          this.cache.set(key, flat);
          if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value);
          this.schedule(0);
        });
      }
    });
    this.track(seen);
    const sig = (list) => list.map((d) => `${d.from}:${d.to}:${d.type.attrs.style}`).join("|");
    if (sig(decos) === sig(highlightKey.getState(view.state).find())) return;
    view.dispatch(view.state.tr.setMeta(highlightKey, decos).setMeta("addToHistory", false));
  }

  track(seen) {
    if (!this.io) return;
    for (const [id, dom] of this.targets) {
      if (seen.get(id) === dom) continue;
      this.io.unobserve(dom);
      this.targets.delete(id);
      this.visible.delete(id);
    }
    for (const [id, dom] of seen) {
      if (this.targets.get(id) === dom) continue;
      this.targets.set(id, dom);
      this.io.observe(dom);
    }
  }

  destroy() {
    clearTimeout(this.timer);
    this.io?.disconnect();
  }
}

export function highlightPlugin({ tokenize: run = tokenize, delay = 300 } = {}) {
  return new Plugin({
    key: highlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const decos = tr.getMeta(highlightKey);
        return decos ? DecorationSet.create(tr.doc, decos) : set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (st) => highlightKey.getState(st) },
    view: (view) => new Highlighter(view, run, delay),
  });
}

// A code block with a language picker in its top corner. The picker is not part
// of the content: ProseMirror ignores its events and mutations.
export class CodeBlockView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("pre");
    this.contentDOM = doc.createElement("code");
    this.select = doc.createElement("select");
    this.select.className = "page-code-lang";
    this.select.contentEditable = "false";
    this.select.setAttribute("aria-label", "Code language");
    for (const [id, label] of LANGS) this.select.append(new Option(label, id));
    this.select.addEventListener("change", () => this.setLang(this.select.value));
    this.dom.append(this.select, this.contentDOM);
    this.render(node);
  }

  render(node) {
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    const lang = langOf(node.attrs.lang);
    if (lang) this.dom.dataset.lang = lang;
    else delete this.dom.dataset.lang;
    this.select.value = lang;
  }

  setLang(lang) {
    const pos = this.getPos();
    if (pos == null || lang === langOf(this.node.attrs.lang)) return;
    this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, lang })));
    this.view.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.render(node);
    return true;
  }

  stopEvent(event) { return this.select.contains(event.target); }
  ignoreMutation(m) { return m.type !== "selection" && this.select.contains(m.target); }
}
