// Image and file uploads. A file being uploaded is a bookmark in plugin state,
// drawn as a widget at a block boundary and mapped through every transaction.
// Nothing reaches the record until the host has answered with a URL; then one
// transaction inserts the block at the bookmark. A cancelled or failed upload
// leaves no trace in the record.
//
// The paste, the drop, the picker and the upload itself are here, so a file lands
// where it was dropped without waiting for anything. What an upload can then offer
// (retry, embedding, the alt text and width the chrome sets) is in the media view
// part, which loads with the first paste, drop, insert or upload.
import { state } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { outline } from "./blocks.js";
import { newId } from "./model.js";
import { asStep } from "./blocksel.js";
import { announce } from "./announce.js";
import { safeFileHref } from "./address.js";

const { Plugin, PluginKey } = state;
const N = schema.nodes;

export const mediaKey = new PluginKey("page-media");
export const EMBED_MAX = 1.5 * 1024 * 1024;
export const mediaRuntime = new WeakMap();

// The view part hands its upload actions back here when it installs, so the
// bookmark's own buttons reach them without this module importing it.
export const mediaParts = new WeakMap();

export const boundary = (doc, pos) => {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return $p.depth === 0 ? $p.pos : $p.after(1);
};

export function hostPlace(st, i) {
  const ents = outline(st.doc);
  const e = ents[Math.min(i, ents.length - 1)];
  const empty = e.node.type === N.paragraph && e.node.content.size === 0;
  return { hostId: e.node.attrs.id, at: empty ? e.at : ents[e.subEnd].end, parent: e.node.attrs.parent ?? null, replaceId: empty ? e.node.attrs.id : null };
}

const mediaState = {
  init: () => ({ items: [], placed: {}, picker: null }),
  apply(tr, value) {
    let { items, placed, picker } = value;
    if (tr.docChanged) items = items.map((it) => ({ ...it, pos: boundary(tr.doc, tr.mapping.map(it.pos, -1)) }));
    if (picker && tr.docChanged) {
      picker = { ...picker, place: { ...picker.place, at: boundary(tr.doc, tr.mapping.map(picker.place.at, -1)) } };
      if (picker.remove) {
        const from = tr.mapping.map(picker.remove.from, 1), to = tr.mapping.map(picker.remove.to, -1);
        picker = from <= to && tr.doc.textBetween(from, to) === picker.remove.text
          ? { ...picker, remove: { ...picker.remove, from, to } } : null;
      }
    }
    const m = tr.getMeta(mediaKey);
    if (m?.picker !== undefined) picker = m.picker;
    if (m?.add) items = [...items, ...m.add];
    if (m?.update) items = items.map((it) => (it.id === m.update.id ? { ...it, ...m.update } : it));
    if (m?.placed) {
      const { id, at, size, blockId } = m.placed;
      const done = value.items.find((it) => it.id === id);
      items = items.filter((it) => it.id !== id).map((it) => (done && it.pos === at && it.group === done.group && it.order > done.order ? { ...it, pos: it.pos + size } : it));
      if (done) placed = { ...placed, [done.group]: [...(placed[done.group] || []), blockId] };
    }
    if (m?.remove) items = items.filter((it) => it.id !== m.remove);
    for (const g of Object.keys(placed)) if (!items.some((it) => it.group === g)) { placed = { ...placed }; delete placed[g]; }
    return { items, placed, picker };
  },
};

function dropEmptyHost(tr, hostId, placedIds) {
  if (!hostId) return;
  let prev = null, hit = null;
  tr.doc.forEach((n, off) => { if (n.attrs.id === hostId && prev && placedIds.includes(prev.attrs.id)) hit = { n, off }; prev = n; });
  if (hit && hit.n.type === N.paragraph && hit.n.content.size === 0) tr.delete(hit.off, hit.off + hit.n.nodeSize);
}

export function placeTr(st, id, attrs) {
  const { items, placed } = mediaKey.getState(st);
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  const at = boundary(st.doc, it.pos);
  const blockId = newId();
  const node = (it.kind === "image" ? N.image : N.file).create({ ...attrs, id: blockId, pos: null, parent: it.parent });
  const tr = st.tr.insert(at, node);
  if (!items.some((x) => x.group === it.group && x.id !== id)) dropEmptyHost(tr, it.replaceId, [...(placed[it.group] || []), blockId]);
  return asStep(tr).setMeta(mediaKey, { placed: { id, at, size: node.nodeSize, blockId } });
}

export function removeTr(st, id) {
  const { items, placed } = mediaKey.getState(st);
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  const tr = st.tr;
  if (!items.some((x) => x.group === it.group && x.id !== id)) dropEmptyHost(tr, it.replaceId, placed[it.group] || []);
  if (tr.docChanged) asStep(tr);
  return tr.setMeta(mediaKey, { remove: id });
}

export function insertFiles(view, files, place = hostPlace(view.state, view.state.selection.$head.index(0))) {
  files = [...files].filter(Boolean);
  if (!files.length) return false;
  const group = newId("g");
  const add = files.map((file, order) => {
    const kind = /^image\//.test(file.type || "") ? "image" : "file";
    return {
      id: newId("u"), pos: place.at, group, order, file, kind, name: file.name || (kind === "image" ? "image" : "file"),
      parent: place.parent, replaceId: place.replaceId, state: "uploading", percent: 0,
      preview: kind === "image" && globalThis.URL?.createObjectURL ? URL.createObjectURL(file) : null,
    };
  });
  view.dispatch(view.state.tr.setMeta(mediaKey, { add }));
  for (const it of add) run(view, it);
  announce(view, files.length === 1 ? `Uploading ${add[0].name}` : `Uploading ${files.length} files`);
  return true;
}

export const live = (view, id) => mediaKey.getState(view.state).items.find((x) => x.id === id);
export const update = (view, id, patch) => view.dispatch(view.state.tr.setMeta(mediaKey, { update: { id, ...patch } }));
export const attrsFor = (it, src) => (it.kind === "image" ? { src, alt: "", caption: "" } : { src, name: it.name, size: it.file.size ?? null, mime: it.file.type || null });

export function settle(it, view, tr) {
  if (it.preview) URL.revokeObjectURL?.(it.preview);
  if (tr) view.dispatch(tr);
}

export async function run(view, it) {
  const rt = mediaRuntime.get(view);
  const abort = new AbortController();
  rt.aborts.set(it.id, abort);
  let last = -5;
  const onProgress = ({ percent }) => {
    if (percent - last < 5 && percent !== 100) return;
    last = percent;
    if (mediaRuntime.has(view) && live(view, it.id)) update(view, it.id, { percent });
  };
  let res;
  try { res = await rt.upload(it.file, { onProgress, signal: abort.signal }); }
  catch { res = { code: "network", msg: "Upload failed" }; }
  rt.aborts.delete(it.id);
  if (!mediaRuntime.has(view) || !live(view, it.id)) return;
  if (res?.ok) {
    const src = safeFileHref(res.uploads?.[0]?.url);
    if (src) {
      settle(it, view, placeTr(view.state, it.id, attrsFor(it, src)));
      announce(view, `${it.name} added`);
      return;
    }
    res = { code: "bad-response", msg: "The upload returned an invalid address" };
  }
  if (!res || typeof res !== "object") res = { code: "bad-response", msg: "The upload returned an invalid response" };
  if (res.code === "aborted") return settle(it, view, removeTr(view.state, it.id));
  if (res.code === "unsupported") {
    const canEmbed = /^image\/(png|jpeg|gif|webp)$/i.test(it.file.type) && it.file.size <= EMBED_MAX;
    const message = canEmbed
      ? "This host doesn't store files. You can keep this image inside the document, which makes the document larger."
      : it.kind === "image" && it.file.size > EMBED_MAX ? "This host doesn't store files, and this image is over 1.5 MB, too large to keep inside the document." : "This host doesn't store files.";
    update(view, it.id, { state: canEmbed ? "embed-choice" : "error", code: res.code, message });
    announce(view, `${it.name}: ${message}`);
    return;
  }
  const message = res.code === "timeout" ? "The upload timed out. It may have arrived; trying again is safe." : res.msg || "Upload failed";
  update(view, it.id, { state: "error", code: res.code, message });
  announce(view, `${it.name}: ${message}`);
}

const htmlHasText = (html) => html.replace(/<(meta|style|img)\b[^>]*>/gi, "").replace(/<[^>]+>/g, "").trim() !== "";

export function mediaPlugin({ upload, features = null }) {
  // Only the bookmark widget waits for the view part: the upload and its block
  // are core, and the block draws through the schema until the part arrives.
  const showBookmark = (view) => {
    if (!features || features.has("media") || !mediaRuntime.has(view)) return;
    features.ensure("media").catch(() => {});
  };
  return new Plugin({
    key: mediaKey,
    state: mediaState,
    view(view) {
      const doc = view.dom.ownerDocument;
      const input = doc.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      input.className = "page-file-input";
      view.dom.parentElement.append(input);
      mediaRuntime.set(view, { upload, aborts: new Map(), input });
      input.addEventListener("change", () => {
        const files = [...(input.files ?? [])];
        const picker = mediaKey.getState(view.state).picker;
        view.dispatch(view.state.tr.setMeta(mediaKey, { picker: null }));
        if (files.length && picker) {
          const { remove } = picker;
          if (remove && view.state.doc.textBetween(remove.from, remove.to) === remove.text) {
            view.dispatch(asStep(view.state.tr.delete(remove.from, remove.to)));
          }
          const index = indexOfId(view.state.doc, picker.place.hostId);
          if (!picker.place.hostId || index >= 0) {
            insertFiles(view, files, index >= 0 ? hostPlace(view.state, index) : picker.place);
            showBookmark(view);
          }
        }
        input.value = "";
        view.focus();
      });
      input.addEventListener("cancel", () => view.dispatch(view.state.tr.setMeta(mediaKey, { picker: null })));
      const onClick = (e) => {
        const b = e.target.closest?.(".page-upload-btn");
        if (!b) return;
        e.preventDefault();
        const part = mediaParts.get(view);
        const id = b.dataset.upload;
        if (b.dataset.act === "retry") part?.retryUpload(view, id);
        else if (b.dataset.act === "embed") part?.embedUpload(view, id);
        else part?.cancelUpload(view, id);
      };
      view.dom.addEventListener("click", onClick);
      return {
        destroy() {
          view.dom.removeEventListener("click", onClick);
          const rt = mediaRuntime.get(view);
          mediaRuntime.delete(view);
          for (const it of mediaKey.getState(view.state).items) if (it.preview) URL.revokeObjectURL?.(it.preview);
          for (const a of rt.aborts.values()) a.abort();
          input.remove();
        },
      };
    },
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        const files = [...(data?.files ?? [])];
        if (!files.length || view.state.selection.$from.parent.type.spec.code) return false;
        if (htmlHasText(data.getData("text/html") || "")) return false;
        const place = hostPlace(view.state, view.state.selection.$head.index(0));
        event.preventDefault();
        insertFiles(view, files, place);
        showBookmark(view);
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length) return false;
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!hit) return false;
        const ents = outline(view.state.doc);
        const i = Math.min(view.state.doc.resolve(hit.pos).index(0), ents.length - 1);
        const r = view.nodeDOM(ents[i].at)?.getBoundingClientRect?.();
        const before = r && event.clientY < r.top + r.height / 2;
        event.preventDefault();
        const place = { at: before ? ents[i].at : ents[ents[i].subEnd].end, parent: ents[i].node.attrs.parent ?? null, replaceId: null };
        insertFiles(view, files, place);
        showBookmark(view);
        return true;
      },
    },
  });
}

const indexOfId = (doc, id) => {
  let found = -1;
  doc.forEach((n, _, i) => { if (n.attrs.id === id) found = i; });
  return found;
};

export function pickFiles(view, accept, place = hostPlace(view.state, view.state.selection.$head.index(0)), remove = null) {
  const rt = mediaRuntime.get(view);
  if (!rt) return false;
  const picker = { place, remove: remove && { ...remove, text: view.state.doc.textBetween(remove.from, remove.to) } };
  view.dispatch(view.state.tr.setMeta(mediaKey, { picker }));
  rt.input.accept = accept;
  rt.input.click();
  return true;
}
