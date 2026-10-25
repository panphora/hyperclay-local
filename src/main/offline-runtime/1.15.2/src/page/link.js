// Link addresses the editor will store. #fragments, same-site paths, http(s),
// mailto and tel pass; a bare domain gets https:// and a bare address mailto:.
// Any other scheme (javascript:, data:, vbscript:, file:) is refused with null.
import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { safeHref } from "./address.js";
import { asStep } from "./blocksel.js";

const { Plugin, PluginKey, TextSelection } = state;
const { Decoration, DecorationSet } = pmView;
const LINK = schema.marks.link;

export { safeHref, safeSrc } from "./address.js";
export const isUrlText = (text) => /^(https?:\/\/|mailto:|tel:|www\.)\S+$/i.test(text.trim()) && safeHref(text) !== null;

export function linkRange(doc, pos) {
  const $p = doc.resolve(pos);
  if (!$p.parent.inlineContent) return null;
  const mark = LINK.isInSet(($p.nodeAfter ?? $p.nodeBefore)?.marks ?? []);
  if (!mark) return null;
  const kids = [];
  $p.parent.forEach((n, off) => kids.push({ n, off }));
  const i = kids.findIndex(({ n, off }) => off <= $p.parentOffset && $p.parentOffset <= off + n.nodeSize && mark.isInSet(n.marks));
  if (i < 0) return null;
  let a = i, b = i;
  while (a > 0 && mark.isInSet(kids[a - 1].n.marks)) a--;
  while (b < kids.length - 1 && mark.isInSet(kids[b + 1].n.marks)) b++;
  const start = $p.start();
  return { from: start + kids[a].off, to: start + kids[b].off + kids[b].n.nodeSize, href: mark.attrs.href };
}

export function setLinkTr(st, from, to, href) {
  const tr = st.tr.removeMark(from, to, LINK);
  if (href) tr.addMark(from, to, LINK.create({ href }));
  return asStep(tr);
}

export const linkKey = new PluginKey("page-link");
const popovers = new WeakMap();

const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_OPEN = svg('<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/>');
const ICON_REMOVE = svg('<path d="M4 4l8 8M12 4l-8 8"/>');

function el(doc, tag, cls, attrs = {}) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function linkAt(st, from, to) {
  let href = null;
  st.doc.nodesBetween(from, to, (n) => { const m = LINK.isInSet(n.marks); if (m) href = m.attrs.href; });
  return href;
}

class LinkPopover {
  constructor(view) {
    this.view = view;
    this.shell = view.dom.parentElement;
    this.doc = view.dom.ownerDocument;
    this.mode = null;
    this.range = null;
    const doc = this.doc;
    this.dom = el(doc, "div", "page-link", { role: "dialog", "aria-label": "Link", hidden: "" });
    this.input = el(doc, "input", "page-link-input", { type: "url", "aria-label": "Link address", placeholder: "Paste or type a link", autocomplete: "off", spellcheck: "false" });
    this.url = el(doc, "a", "page-link-url", { target: "_blank", rel: "noopener noreferrer" });
    this.open = el(doc, "a", "page-link-btn", { "data-act": "open", target: "_blank", rel: "noopener noreferrer", "aria-label": "Open link in a new tab", title: "Open in a new tab" });
    this.open.innerHTML = ICON_OPEN;
    this.edit = el(doc, "button", "page-link-btn", { type: "button", "data-act": "edit" });
    this.edit.textContent = "Edit";
    this.remove = el(doc, "button", "page-link-btn", { type: "button", "data-act": "remove", "aria-label": "Remove link", title: "Remove link" });
    this.remove.innerHTML = ICON_REMOVE;
    this.dom.append(this.input, this.url, this.open, this.edit, this.remove);
    this.shell.append(this.dom);
    popovers.set(view, this);
    this.dom.addEventListener("mousedown", (e) => { if (e.target !== this.input) e.preventDefault(); });
    this.edit.addEventListener("click", () => this.openEdit());
    this.remove.addEventListener("click", () => this.apply(""));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.apply(this.input.value); }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    this.onDocDown = (e) => { if (this.mode === "edit" && !this.dom.contains(e.target)) this.close(false); };
    this.doc.addEventListener("mousedown", this.onDocDown, true);
  }

  openEdit() {
    const st = this.view.state;
    const sel = st.selection;
    if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to) || !sel.$from.parent.inlineContent || sel.$from.parent.type.spec.code) return false;
    const around = sel.empty ? linkRange(st.doc, sel.head) : null;
    this.range = around ?? { from: sel.from, to: sel.to, href: sel.empty ? null : linkAt(st, sel.from, sel.to) };
    this.mode = "edit";
    this.view.dispatch(st.tr.setMeta(linkKey, { from: this.range.from, to: this.range.to }));
    this.render();
    this.input.value = this.range.href ?? "";
    this.input.removeAttribute("aria-invalid");
    this.input.focus();
    this.input.select();
    return true;
  }

  apply(raw) {
    const text = String(raw).trim();
    const href = text ? safeHref(text) : null;
    if (text && !href) { this.input.setAttribute("aria-invalid", "true"); return; }
    const st = this.view.state;
    const r = linkKey.getState(st) ?? (this.mode === "view" ? this.range : null);
    if (!r) return this.close();
    let tr;
    if (r.from === r.to) {
      if (!href) return this.close();
      tr = st.tr.insert(r.from, schema.text(text, [LINK.create({ href })]));
      tr.setSelection(TextSelection.create(tr.doc, r.from + text.length));
    } else {
      tr = setLinkTr(st, r.from, r.to, href);
      tr.setSelection(TextSelection.create(tr.doc, r.to));
    }
    this.view.dispatch(asStep(tr).setMeta(linkKey, null));
    this.close();
  }

  close(refocus = true) {
    this.mode = null;
    this.range = null;
    if (linkKey.getState(this.view.state)) this.view.dispatch(this.view.state.tr.setMeta(linkKey, null));
    this.dom.hidden = true;
    this.dom.dataset.mode = "";
    if (refocus) this.view.focus();
    this.update(this.view);
  }

  render() {
    const editing = this.mode === "edit";
    const href = safeHref(this.range?.href);
    this.dom.dataset.mode = this.mode ?? "";
    this.input.hidden = !editing;
    this.url.hidden = editing;
    this.edit.hidden = editing;
    this.open.hidden = !href;
    this.remove.hidden = !this.range?.href;
    if (href) { this.open.href = href; this.url.href = href; this.url.textContent = href.replace(/^https?:\/\//, ""); }
    else { this.open.removeAttribute("href"); this.url.removeAttribute("href"); this.url.textContent = ""; }
    this.dom.hidden = false;
    this.place();
  }

  place() {
    const r = this.range;
    if (!r) return;
    const shellBox = this.shell.getBoundingClientRect();
    const a = this.view.coordsAtPos(r.from), b = this.view.coordsAtPos(r.to, -1);
    this.dom.style.setProperty("--page-pop-x", `${Math.min(a.left, b.left) - shellBox.left}px`);
    this.dom.style.setProperty("--page-pop-y", `${Math.max(a.bottom, b.bottom) - shellBox.top + 6}px`);
  }

  update(view) {
    this.view = view;
    if (this.mode === "edit") {
      const range = linkKey.getState(view.state);
      if (range) { this.range = { ...this.range, ...range }; return this.place(); }
      this.mode = null;
      this.range = null;
      this.dom.hidden = true;
      this.dom.dataset.mode = "";
      return;
    }
    const sel = view.state.selection;
    const r = sel instanceof TextSelection && sel.empty && view.hasFocus() ? linkRange(view.state.doc, sel.head) : null;
    if (!r || sel.head === r.from || sel.head === r.to) {
      this.mode = null;
      this.range = null;
      this.dom.hidden = true;
      this.dom.dataset.mode = "";
      return;
    }
    this.mode = "view";
    this.range = r;
    this.render();
  }

  destroy() {
    this.doc.removeEventListener("mousedown", this.onDocDown, true);
    this.dom.remove();
    popovers.delete(this.view);
  }
}

export const openLinkEditor = (view) => popovers.get(view)?.openEdit() ?? false;

function pasteUrl(view, event) {
  if (event.clipboardData?.files?.length) return false;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!isUrlText(text)) return false;
  const sel = view.state.selection;
  if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to) || sel.$from.parent.type.spec.code) return false;
  const href = safeHref(text);
  const tr = sel.empty
    ? view.state.tr.replaceSelectionWith(schema.text(text.trim(), [LINK.create({ href })]), false)
    : setLinkTr(view.state, sel.from, sel.to, href);
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
  return true;
}

export function linkPlugin() {
  return new Plugin({
    key: linkKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const m = tr.getMeta(linkKey);
        if (m !== undefined) return m;
        if (!value || !tr.docChanged) return value;
        const from = tr.mapping.mapResult(value.from, 1);
        const to = tr.mapping.mapResult(value.to, value.from === value.to ? 1 : -1);
        if (from.deletedAcross || to.deletedAcross || (value.from !== value.to && from.pos >= to.pos)) return null;
        return { from: from.pos, to: to.pos };
      },
    },
    view: (view) => new LinkPopover(view),
    props: {
      decorations(st) {
        const r = linkKey.getState(st);
        return r && r.from < r.to ? DecorationSet.create(st.doc, [Decoration.inline(r.from, r.to, { class: "page-link-pending" })]) : null;
      },
      handleKeyDown(view, event) {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          return openLinkEditor(view) || true;
        }
        return false;
      },
      handlePaste: pasteUrl,
      handleClick(view, pos, event) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const r = linkRange(view.state.doc, pos);
        const href = safeHref(r?.href);
        if (!href) return false;
        view.dom.ownerDocument.defaultView.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
  });
}
