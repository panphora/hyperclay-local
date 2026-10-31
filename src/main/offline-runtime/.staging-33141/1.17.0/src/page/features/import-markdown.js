// Markdown import: the Insert Markdown action. A person picks a .md file, the action
// measures it before anything parses it, fetches marked on the first import only, and
// turns the lexer's tokens into page blocks through the import codec. A preview lists
// what the schema could not keep, and Insert writes the blocks where the selection was,
// with fresh block, row and column ids, as one undo entry. The place is found again by
// block id once the file has been read: a target a peer deleted refuses rather than
// taking whatever holds its old offset, and one a peer moved keeps the blocks at its own
// new place.
import { state } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { keysBetween, newId, nodeFromBlock, orderedIds } from "../model.js";
import { asStep } from "../blocksel.js";
import { composing } from "../markdown.js";
import { project } from "../projection.js";
import { requiredPageFormat } from "../format-level.js";
import { runFormatted } from "../format-command.js";
import { MAX_BYTES, importMarkdownTokens } from "../import-markdown.js";
import { registerUnsavedState } from "../../lib/unsaved-state.js";

const PREVIEW = "markdown-import-preview";
const encoder = new TextEncoder();
const excerpt = (text) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > 60 ? `${value.slice(0, 60)}\u2026` : value;
};

const readText = (file) => (typeof file.text === "function" ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
}));

// marked is vendored behind the retryable clay.assets.load("marked"), so a document that
// never imports Markdown never downloads a parser. A fetch that failed is not kept.
const assetMarked = () => globalThis.clay?.assets?.load?.("marked") ?? import("../../vendor/marked.vendor.js");

const indexOfId = (doc, id) => {
  let found = -1;
  doc.forEach((node, _offset, index) => { if (found < 0 && node.attrs.id === id) found = index; });
  return found;
};

// The root block the selection is in, and whether the selection is text inside it. A
// block selection names the block it starts on and takes no text offset.
function blockAt(st) {
  const $from = st.selection.$from;
  if ($from.depth >= 1) return { node: $from.node(1), at: $from.before(1), textblock: $from.parent.isTextblock };
  const index = Math.min($from.index(0), Math.max(0, st.doc.childCount - 1));
  let at = 0;
  for (let i = 0; i < index; i++) at += st.doc.child(i).nodeSize;
  return { node: st.doc.child(index), at, textblock: false };
}

// What the import needs of the document: the line it was asked for, and the range of text
// it was asked at, as offsets inside that line. A peer's move changes where the line sits
// and never these, so the range is read again against the line found by id.
function targetOf(st) {
  const { node, at, textblock } = blockAt(st);
  const sel = st.selection;
  const fromOff = textblock ? Math.max(0, sel.from - at - 1) : 0;
  return {
    id: node.attrs.id,
    textblock,
    size: node.isTextblock ? node.content.size : 0,
    fromOff,
    toOff: textblock ? Math.max(fromOff, sel.to - at - 1) : 0,
  };
}

// A construct the schema cannot express is kept as literal content by the codec, so a
// model that reaches floor 1 is one a newer page format reads; anything the projector
// cannot read at all is treated the same way rather than written silently.
const needsFormat = (blocks) => {
  try {
    return requiredPageFormat(project(blocks)) > 0;
  } catch {
    return true;
  }
};

const messageOf = (answer) => {
  if (answer?.code === "page-format-upgrade-required") return "This document needs a newer page format before Markdown can be added. The preview stays open.";
  if (answer?.code === "page-format-unsupported") return "This host cannot record the newer page format this file needs. The preview stays open.";
  if (answer?.code === "stale-target") return "The place this import was started from changed. The preview stays open.";
  if (answer?.code === "empty-import") return "This file holds nothing that can be inserted.";
  return "The Markdown could not be inserted. The preview stays open.";
};

export function createFeature({ view = null, load = assetMarked } = {}) {
  if (!view) return { run: () => Promise.resolve({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let session = null;
  let marked = null;
  let disposed = false;
  // An unsent preview holds the mode exit open: the exit asks the unsaved-state registry
  // for its pending names, and this one is listed while the preview waits for a person.
  const unsaved = registerUnsavedState({ id: PREVIEW, isPending: () => session !== null });

  const markedModule = () => (marked ??= Promise.resolve().then(load).catch((error) => { marked = null; throw error; }));

  function place() {
    try {
      const box = view.dom.parentElement?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const at = view.coordsAtPos(Math.min(view.state.selection.from, view.state.doc.content.size));
      return { x: Math.max(8, at.left - box.left), y: at.bottom + 6 - box.top };
    } catch {
      return null;
    }
  }

  function close() {
    const s = session;
    if (!s) return false;
    session = null;
    for (const [target, type, fn, options] of s.listen) target.removeEventListener(type, fn, options);
    s.panel.remove();
    return true;
  }

  function cancel() {
    if (!close()) return { ok: false, code: "cancelled" };
    view.focus?.();
    return { ok: true, cancelled: true };
  }

  // The preview: the file's name, how much arrived, the constructs the schema could not
  // express and the addresses it refused, then Insert and Cancel. It is built from the
  // editor's own menu markup, so it needs no stylesheet of its own.
  function draw(s) {
    const parts = [];
    const line = (className, text) => {
      const el = doc.createElement("div");
      el.className = className;
      el.textContent = text;
      return el;
    };
    parts.push(line("page-menu-title", s.error ? "Couldn't read that Markdown" : `Import ${s.name}`));
    if (!s.error) {
      const counts = [`${s.count} block${s.count === 1 ? "" : "s"}`];
      if (s.unsupported.length) counts.push(`${s.unsupported.length} kept as written`);
      if (s.refused.length) counts.push(`${s.refused.length} address${s.refused.length === 1 ? "" : "es"} left out`);
      parts.push(line("page-menu-title page-import-summary", counts.join(" \u00b7 ")));
    }
    const rows = (className, list) => {
      const box = doc.createElement("div");
      box.className = className;
      box.replaceChildren(...list.map((text) => line("page-import-row", text)));
      return box;
    };
    if (s.unsupported.length) parts.push(rows("page-import-unsupported", s.unsupported.map((one) => `${one.type}: ${excerpt(one.text)}`)));
    if (s.refused.length) parts.push(rows("page-import-refused", s.refused.map((one) => `${one.type}: ${one.href}`)));
    const said = s.error ?? s.notice ?? null;
    if (said) {
      const failed = doc.createElement("p");
      failed.className = "page-import-error";
      failed.setAttribute("role", "alert");
      failed.textContent = said;
      parts.push(failed);
    }
    const button = (what, label) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = "page-menu-item";
      el.dataset.import = what;
      el.textContent = label;
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", () => (what === "insert" ? submit() : cancel()));
      return el;
    };
    const insert = button("insert", "Insert at the selection");
    insert.disabled = !!s.error;
    parts.push(insert, button("cancel", "Cancel"));
    s.panel.replaceChildren(...parts);
  }

  // The one place blocks reach the document, synchronous once the gate has answered. The
  // target is found by id, never by the offset it had: a line a peer deleted has no place
  // here, and one a peer moved keeps the blocks at the line's new place. The blocks go into
  // an empty line in its own place, between the two halves of the line being written in, or
  // after the block that was selected; a closed toggle opens first so what arrives is not
  // hidden inside it. Every block is given its own key here, so the identity plugin has
  // nothing to repair and the whole insert is one undo entry.
  function writeAt(target, blocks) {
    const st = view.state;
    const doc = st.doc;
    const index = indexOfId(doc, target.id);
    if (index < 0) return { ok: false, code: "stale-target" };
    const node = doc.child(index);
    if (target.textblock ? !node.isTextblock || node.content.size !== target.size : node.isTextblock) return { ok: false, code: "stale-target" };
    const nodes = orderedIds(blocks).map((id) => nodeFromBlock(schema, id, { ...blocks[id], pos: null, parent: null }));
    if (!nodes.length) return { ok: false, code: "empty-import" };
    let at = 0;
    for (let i = 0; i < index; i++) at += doc.child(i).nodeSize;
    const next = doc.maybeChild(index + 1);
    const toggle = node.type.name === "toggle";
    const cut = target.textblock && !toggle && node.content.size > 0;
    const replace = cut || (target.textblock && !toggle && node.content.size === 0);
    const fromOff = cut ? Math.min(target.fromOff, node.content.size) : 0;
    const toOff = cut ? Math.min(Math.max(fromOff, target.toOff), node.content.size) : 0;
    const head = cut && fromOff > 0 ? node.type.create({ ...node.attrs }, node.content.cut(0, fromOff)) : null;
    const tailContent = cut ? node.content.cut(toOff) : null;
    const tail = tailContent && tailContent.size ? node.type.create({ ...node.attrs, id: newId(), pos: null }, tailContent) : null;
    const lower = cut && !head ? (index > 0 ? doc.child(index - 1).attrs.pos : null) : node.attrs.pos;
    const keys = keysBetween(lower, next?.attrs.pos ?? null, nodes.length + (tail ? 1 : 0));
    const parent = toggle ? node.attrs.id : node.attrs.parent ?? null;
    const placed = nodes.map((one, i) => one.type.create({ ...one.attrs, pos: keys[i], parent }, one.content, one.marks));
    const last = tail ? tail.type.create({ ...tail.attrs, pos: keys[nodes.length] }, tail.content, tail.marks) : null;
    const tr = st.tr;
    if (replace) tr.replaceWith(at, at + node.nodeSize, [...(head ? [head] : []), ...placed, ...(last ? [last] : [])]);
    else tr.insert(at + node.nodeSize, placed);
    if (toggle && !node.attrs.open && placed.length > 0) tr.setNodeMarkup(at, null, { ...node.attrs, open: true });
    let end = at + (replace ? (head ? head.nodeSize : 0) : node.nodeSize);
    for (const one of placed) end += one.nodeSize;
    tr.setSelection(state.TextSelection.near(tr.doc.resolve(last ? end : Math.max(0, end - 1)), last ? 1 : -1));
    view.dispatch(asStep(tr).scrollIntoView());
    view.focus?.();
    return { ok: true, blocks: placed.length };
  }

  // Insert: floor 1 is asked for only if the content needs it, and the write happens
  // inside the gate's own apply, so a refusal leaves the document and the preview as they
  // were and the preview says why.
  async function submit() {
    const s = session;
    if (!s || s.error) return s ? { ok: false, code: "no-import" } : { ok: false, code: "not-editing" };
    if (s.notice) {
      s.notice = null;
      draw(s);
    }
    const apply = () => writeAt(s.target, s.blocks);
    const answer = s.floor ? await runFormatted(view, apply) : apply();
    if (answer?.ok) {
      close();
      return answer;
    }
    // The preview keeps the blocks for copying, and a refusal a later answer could lift
    // leaves Insert in place to ask again.
    if (session === s) {
      s.notice = messageOf(answer);
      draw(s);
    }
    return answer ?? { ok: false, code: "import-failed" };
  }

  function key(event) {
    const s = session;
    if (!s || composing(event, view)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter" && !event.target?.closest?.("[data-import]")) {
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  }

  // The file: the one a caller handed over, or the picker's own, which is removed again
  // whatever the person answers.
  function pick() {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,text/markdown,text/plain";
      input.hidden = true;
      input.className = "page-markdown-input";
      const done = (file) => {
        input.remove();
        resolve(file);
      };
      input.addEventListener("change", () => done(input.files?.[0] ?? null));
      input.addEventListener("cancel", () => done(null));
      (view.dom.parentElement ?? doc.body).appendChild(input);
      input.click();
    });
  }

  async function open(s, error = null) {
    s.error = error;
    const panel = doc.createElement("div");
    panel.className = "page-menu page-import-preview";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Import Markdown");
    s.panel = panel;
    session = s;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      s.listen.push([target, type, fn, options]);
    };
    listen(doc, "keydown", (event) => key(event), true);
    listen(doc, "mousedown", (event) => { if (!s.panel.contains(event.target)) cancel(); }, true);
    (view.dom.parentElement ?? doc.body).appendChild(panel);
    draw(s);
    const at = place();
    if (at) {
      panel.style.setProperty("--page-pop-x", `${at.x}px`);
      panel.style.setProperty("--page-pop-y", `${at.y}px`);
    }
    const insert = panel.querySelector('[data-import="insert"]');
    if (insert && !insert.disabled) insert.focus?.();
    return { ok: true, preview: true };
  }

  async function run(args = {}) {
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    close();
    const target = targetOf(view.state);
    const file = args?.file ?? (await pick());
    if (!file) return { ok: false, code: "cancelled" };
    if (typeof file.size === "number" && file.size > MAX_BYTES) return { ok: false, code: "input-too-large" };
    let text;
    try {
      text = await readText(file);
    } catch (error) {
      return { ok: false, code: "unreadable", error };
    }
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    if (encoder.encode(text).length > MAX_BYTES) return { ok: false, code: "input-too-large" };
    const s = { target, name: String(file.name ?? "Markdown"), blocks: {}, count: 0, unsupported: [], refused: [], floor: 0, panel: null, error: null, notice: null, listen: [] };
    let parsed;
    try {
      const mod = await markedModule();
      parsed = importMarkdownTokens(new mod.Marked().lexer(text));
    } catch (failure) {
      if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
      return open(s, String(failure?.message ?? "The Markdown could not be read."));
    }
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    s.blocks = parsed.blocks;
    s.count = Object.keys(parsed.blocks).length;
    s.unsupported = parsed.unsupported;
    s.refused = parsed.refused;
    s.floor = needsFormat(parsed.blocks) ? 1 : 0;
    return open(s);
  }

  return {
    async run(args) {
      return run(args);
    },
    dispose() {
      disposed = true;
      close();
      unsaved.dispose();
    },
  };
}
