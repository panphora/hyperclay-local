// The image and file blocks: their node views, the bookmark a pending upload draws
// at a block boundary, their CSS, and the upload work behind them. Loaded the first
// time a document has or takes one of these blocks, or on the first media paste,
// drop, insert or upload.
import { safeHref, safeFileHref } from "../address.js";
import { view as pmView } from "../../vendor/prosemirror.vendor.js";
import { asStep } from "../blocksel.js";
import { schema } from "../schema.js";
import { announce } from "../announce.js";
import { attrsFor, boundary, live, mediaKey, mediaParts, mediaRuntime, placeTr, removeTr, run, settle, update } from "../media.js";
import { mediaViews } from "../media-views.js";
import { addViewHook } from "../view-hooks.js";

const { Decoration, DecorationSet } = pmView;
const N = schema.nodes;
// The codes an upload is offered a retry for.
const RETRY = new Set(["timeout", "network", "error", "bad-response"]);

export const MEDIA_CSS = `
.page-editor .page-image { margin-inline: 0; }
.page-image-frame { position: relative; margin: 0 auto; max-width: 100%; }
.page-image-frame img { display: block; width: 100%; height: auto; border-radius: var(--page-image-radius, 6px); }
.page-image[data-broken] .page-image-frame { min-height: 80px; background: var(--page-code-bg); border-radius: var(--page-image-radius, 6px); }
.page-image-handle { position: absolute; top: 50%; inset-inline-end: 6px; width: 6px; height: 36px; margin-top: -18px; border-radius: 3px; background: var(--page-chrome-ink-moved); opacity: 0; cursor: ew-resize; touch-action: none; transition: opacity var(--page-fade); }
.page-image:hover .page-image-handle, .page-image.is-selected .page-image-handle { opacity: 1; }
.page-editor .page-image.page-block-selected { background: none; box-shadow: none; }
.page-editor .page-image.page-block-selected .page-image-frame { box-shadow: 0 0 0 6px var(--page-block-selected, rgba(88, 120, 170, 0.12)); border-radius: var(--page-image-radius, 6px); }
.page-image[data-align="left"] .page-image-frame { margin-left: 0; margin-right: auto; }
.page-image[data-align="right"] .page-image-frame { margin-left: auto; margin-right: 0; }
.page-image[data-align="left"] .page-image-caption { text-align: left; }
.page-image[data-align="right"] .page-image-caption { text-align: right; }
.page-image-align { position: absolute; top: 8px; inset-inline-end: 8px; display: none; gap: 1px; padding: 2px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: 7px; }
.page-image.is-selected .page-image-align, .page-image.page-block-selected .page-image-align { display: flex; }
.page-image-align button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 5px; background: none; color: inherit; cursor: pointer; }
.page-image-align button:hover, .page-image-align button[aria-pressed="true"] { background: var(--page-pop-hover); }
.page-image.is-selected .page-image-frame img { outline: 2px solid var(--page-selection); outline-offset: 2px; }
.page-image-caption { margin-top: 6px; color: var(--page-ink-soft); font-size: 0.88em; text-align: center; outline: none; }
.page-image-caption[data-empty]::before { content: attr(data-placeholder); color: var(--page-ink-faint); }
.page-image:not(.is-selected) .page-image-caption[data-empty]:not(:focus) { display: none; }
.page-file-link { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--page-rule); border-radius: 8px; color: var(--page-ink); text-decoration: none; }
.page-file-icon { color: var(--page-link, var(--page-accent)); }
.page-file-name { color: var(--page-link, var(--page-accent)); min-width: 0; overflow-wrap: anywhere; }
.page-file-meta { margin-inline-start: auto; color: var(--page-ink-faint); font-size: 0.88em; }
.page-upload { display: flex; align-items: center; gap: 10px; margin: var(--page-block-gap) 0; padding: 8px 12px; border: 1px dashed var(--page-rule); border-radius: 8px; color: var(--page-ink-soft); font-size: 0.88em; }
.page-upload-preview { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; opacity: 0.6; }
.page-upload-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-upload-bar { flex: 1; height: 2px; border-radius: 1px; background: var(--page-rule); overflow: hidden; }
.page-upload-bar > span { display: block; height: 100%; background: var(--page-progress, var(--page-ink-soft)); transition: width 200ms; }
.page-upload[data-state="error"] .page-upload-msg, .page-upload[data-state="embed-choice"] .page-upload-msg { flex: 1; }
.page-upload[data-state="error"] .page-upload-msg { color: var(--page-danger, #9E3B2F); }
.page-upload-btn { border: 0; padding: 4px 8px; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-upload-btn:hover { background: var(--page-pop-hover); }`;

function button(doc, act, label, id) {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "page-upload-btn";
  b.dataset.act = act;
  b.dataset.upload = id;
  b.textContent = label;
  return b;
}

function bookmarkDOM(doc, it) {
  const box = doc.createElement("div");
  box.className = "page-upload";
  box.dataset.state = it.state;
  box.dataset.kind = it.kind;
  box.contentEditable = "false";
  box.setAttribute("role", it.state === "uploading" ? "status" : "alert");
  if (it.preview) {
    const img = doc.createElement("img");
    img.className = "page-upload-preview";
    img.src = it.preview;
    img.alt = "";
    box.append(img);
  }
  const name = doc.createElement("span");
  name.className = "page-upload-name";
  name.textContent = it.name;
  box.append(name);
  if (it.state === "uploading") {
    const bar = doc.createElement("span");
    bar.className = "page-upload-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `Uploading ${it.name}`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(it.percent));
    const fill = doc.createElement("span");
    fill.style.width = `${it.percent}%`;
    bar.append(fill);
    box.append(bar, button(doc, "cancel", "Cancel", it.id));
    return box;
  }
  const msg = doc.createElement("span");
  msg.className = "page-upload-msg";
  msg.textContent = it.message;
  box.append(msg);
  if (it.state === "embed-choice") box.append(button(doc, "embed", "Keep this image inside the document", it.id));
  if (RETRY.has(it.code)) box.append(button(doc, "retry", "Retry", it.id));
  box.append(button(doc, "remove", "Remove", it.id));
  return box;
}

const MIN_WIDTH = 48;

const ALIGNS = [
  ["left", "Align left", '<path d="M2.5 3.5h11M2.5 6.5h6M2.5 9.5h11M2.5 12.5h6"/>'],
  ["center", "Centre", '<path d="M2.5 3.5h11M5 6.5h6M2.5 9.5h11M5 12.5h6"/>'],
  ["right", "Align right", '<path d="M2.5 3.5h11M7.5 6.5h6M2.5 9.5h11M7.5 12.5h6"/>'],
];

export class ImageView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("figure");
    this.dom.className = "page-image";
    this.dom.addEventListener("dragstart", (event) => { event.preventDefault(); event.stopPropagation(); });
    this.dom.draggable = false;
    this.frame = doc.createElement("div");
    this.frame.className = "page-image-frame";
    this.img = doc.createElement("img");
    this.img.draggable = false;
    this.img.addEventListener("error", () => this.dom.toggleAttribute("data-broken", true));
    this.img.addEventListener("load", () => this.dom.removeAttribute("data-broken"));
    this.handle = doc.createElement("span");
    this.handle.className = "page-image-handle";
    this.handle.setAttribute("aria-hidden", "true");
    this.handle.addEventListener("pointerdown", (e) => this.resize(e));
    this.alignBar = doc.createElement("div");
    this.alignBar.className = "page-image-align";
    this.alignBar.setAttribute("role", "toolbar");
    this.alignBar.setAttribute("aria-label", "Image alignment");
    for (const [value, label, path] of ALIGNS) {
      const b = doc.createElement("button");
      b.type = "button";
      b.dataset.align = value;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${path}</svg>`;
      this.alignBar.append(b);
    }
    this.alignBar.addEventListener("mousedown", (e) => e.preventDefault());
    this.alignBar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-align]");
      if (b) this.setAlign(b.dataset.align === "center" ? null : b.dataset.align);
    });
    this.frame.append(this.img, this.handle, this.alignBar);
    this.caption = doc.createElement("figcaption");
    this.caption.className = "page-image-caption";
    this.caption.contentEditable = "plaintext-only";
    this.caption.setAttribute("aria-label", "Caption");
    this.caption.dataset.placeholder = "Add a caption";
    this.caption.addEventListener("keydown", (e) => {
      if (e.isComposing || this.view.composing) return;
      if (e.key === "Enter") { e.preventDefault(); this.commitCaption(); this.view.focus(); }
      if (e.key === "Escape") { e.preventDefault(); this.caption.textContent = this.node.attrs.caption; this.view.focus(); }
    });
    this.caption.addEventListener("blur", () => this.commitCaption());
    this.caption.addEventListener("input", () => this.caption.toggleAttribute("data-empty", !this.caption.textContent));
    this.dom.append(this.frame, this.caption);
    this.render(node);
  }

  render(node) {
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    if (this.img.getAttribute("src") !== node.attrs.src) this.img.src = node.attrs.src;
    this.img.alt = node.attrs.alt || "";
    this.frame.style.width = node.attrs.width ? `${node.attrs.width}px` : "";
    if (node.attrs.align) this.dom.dataset.align = node.attrs.align;
    else delete this.dom.dataset.align;
    for (const b of this.alignBar.children) b.setAttribute("aria-pressed", String((node.attrs.align ?? "center") === b.dataset.align));
    if (this.dom.ownerDocument.activeElement !== this.caption) this.caption.textContent = node.attrs.caption || "";
    this.caption.toggleAttribute("data-empty", !node.attrs.caption);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.render(node);
    return true;
  }

  setAlign(align) {
    const pos = this.getPos();
    if (pos == null || align === (this.node.attrs.align ?? null)) return;
    this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, align })));
  }

  commitCaption() {
    const text = this.caption.textContent.replace(/\s+/g, " ").trim();
    const pos = this.getPos();
    if (pos == null || text === (this.node.attrs.caption || "")) return;
    this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, caption: text })));
  }

  resize(event) {
    event.preventDefault();
    event.stopPropagation();
    const col = this.view.dom.getBoundingClientRect().width;
    const start = this.frame.getBoundingClientRect().width;
    const rtl = this.dom.ownerDocument.defaultView.getComputedStyle(this.dom).direction === "rtl";
    const x0 = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    let width = this.node.attrs.width;
    const move = (e) => {
      const dx = (e.clientX - x0) * (rtl ? -1 : 1);
      width = Math.max(MIN_WIDTH, Math.min(Math.floor(col) || MIN_WIDTH, Math.round(start + dx)));
      this.frame.style.width = `${width}px`;
    };
    const done = (commit) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      const pos = this.getPos();
      if (commit && pos != null && width !== this.node.attrs.width) this.view.dispatch(asStep(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, width })));
      else this.frame.style.width = this.node.attrs.width ? `${this.node.attrs.width}px` : "";
    };
    const up = () => done(true);
    const cancel = () => done(false);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
  }

  selectNode() { this.dom.classList.add("is-selected"); }
  deselectNode() { this.dom.classList.remove("is-selected"); }
  stopEvent(event) { return this.caption.contains(event.target) || this.alignBar.contains(event.target) || event.target.classList?.contains("page-image-handle"); }
  ignoreMutation() { return true; }
}

const sizeLabel = (bytes) => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export class FileView {
  constructor(node, view) {
    this.node = node;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("div");
    this.dom.className = "page-file";
    this.dom.addEventListener("dragstart", (event) => { event.preventDefault(); event.stopPropagation(); });
    this.link = doc.createElement("a");
    this.link.className = "page-file-link";
    this.link.target = "_blank";
    this.link.rel = "noopener noreferrer";
    this.icon = doc.createElement("span");
    this.icon.className = "page-file-icon";
    this.icon.textContent = "⎘";
    this.name = doc.createElement("span");
    this.name.className = "page-file-name";
    this.meta = doc.createElement("span");
    this.meta.className = "page-file-meta";
    this.link.append(this.icon, this.name, this.meta);
    this.dom.append(this.link);
    this.render(node);
  }

  render(node) {
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    const href = safeHref(node.attrs.src);
    if (href) this.link.setAttribute("href", href);
    else this.link.removeAttribute("href");
    this.name.textContent = node.attrs.name || "file";
    this.meta.textContent = sizeLabel(node.attrs.size);
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.render(node);
    return true;
  }

  selectNode() { this.dom.classList.add("is-selected"); }
  deselectNode() { this.dom.classList.remove("is-selected"); }
  stopEvent(event) { return this.link.contains(event.target); }
  ignoreMutation() { return true; }
}

const readDataUrl = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(file); });

export async function embedUpload(view, id) {
  const it = live(view, id);
  if (!it || it.state !== "embed-choice") return;
  const src = await readDataUrl(it.file);
  if (!mediaRuntime.has(view) || !live(view, id)) return;
  settle(it, view, placeTr(view.state, id, attrsFor(it, src)));
  announce(view, "Saved inside the document");
}

export function retryUpload(view, id) {
  const it = live(view, id);
  if (!it) return;
  update(view, id, { state: "uploading", percent: 0, code: null, message: null });
  run(view, live(view, id));
}

export function cancelUpload(view, id) {
  const rt = mediaRuntime.get(view);
  const abort = rt?.aborts.get(id);
  const it = live(view, id);
  if (it) settle(it, view, removeTr(view.state, id));
  rt?.aborts.delete(id);
  abort?.abort();
}

// The bookmark a pending upload draws at its block boundary: the view part keeps it
// through the same hook the other parts use, so the plugin that takes the paste does
// not carry it.
function bookmarks(view, st) {
  const { items } = mediaKey.getState(st);
  const render = mediaViews.get(view) ?? null;
  if (!items.length || !render) return null;
  return DecorationSet.create(st.doc, items.map((it) => Decoration.widget(boundary(st.doc, it.pos), (view) => render(view.dom.ownerDocument, it), {
    side: -1000 + it.order, key: `${it.id}:${it.state}:${it.percent}`, stopEvent: () => true, ignoreSelection: true,
  })));
}

export function createFeature({ view = null } = {}) {
  if (view) mediaViews.set(view, bookmarkDOM);
  const part = { retryUpload, embedUpload, cancelUpload };
  if (view) mediaParts.set(view, part);
  const off = view ? addViewHook(view, { decorations: (st) => bookmarks(view, st) }) : () => {};
  return {
    id: "media",
    nodeViews: {
      image: (node, editorView, getPos) => new ImageView(node, editorView, getPos),
      file: (node, editorView) => new FileView(node, editorView),
    },
    css: MEDIA_CSS,
    dispose() {
      off();
      if (view && mediaViews.get(view) === bookmarkDOM) mediaViews.delete(view);
      if (view && mediaParts.get(view) === part) mediaParts.delete(view);
    },
  };
}
