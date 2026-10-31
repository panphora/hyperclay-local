// Page cover: the picture a page may show above its title, and the two things a person
// does with it — put one there, and choose which part of it stays in view. It is a set of
// scalar attributes of the title heading, never a second store, so one person's icon and
// another's cover are different fields and neither overwrites the other. The file travels
// the media upload transport, and nothing reaches the record until the host answers with an
// address: one admitted transaction, after the gate, for the title the command was asked
// for. The preview never writes; one commit lands on release, Enter or Apply.
import { schema } from "../schema.js";
import { newId, keyBetween } from "../model.js";
import { asStep } from "../blocksel.js";
import { announce } from "../announce.js";
import { safeFileHref, safeSrc } from "../address.js";
import { EMBED_MAX, mediaRuntime } from "../media.js";
import { mountEditorUI } from "../../ui/editor-ui.js";

// How far one arrow key moves the focal point, in percent of the image.
const STEP = 5;

// The title is the document's first root H1, and only it carries a cover: a nested H1 is no
// title, and a second root H1 becomes the title only when it moves first. The rule is read
// here rather than beside the icon's, so a cover command downloads nothing it does not use.
function titleOf(doc) {
  let at = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type === schema.nodes.heading && node.attrs.level === 1 && node.attrs.parent == null) return { index: i, at, node };
    at += node.nodeSize;
  }
  return null;
}

// The bar sits in its own shadow root beside the editor, so the page's CSS cannot restyle
// it. The page's --page-* tokens still reach it, and it keeps the editor's font and colour.
const COVER_CSS = `
:host{font:inherit !important;color:inherit !important}
.page-cover-panel{display:flex;align-items:center;gap:8px;margin:8px 0;padding:6px 10px;border:1px solid var(--page-pop-line);border-radius:8px;background:var(--page-pop-bg);color:var(--page-pop-ink);box-shadow:var(--page-pop-shadow);font-size:.88em}
.page-cover-msg{max-width:34ch}
.page-cover-bar{flex:1;height:2px;border-radius:1px;background:var(--page-rule);overflow:hidden}
.page-cover-bar>span{display:block;height:100%;background:var(--page-progress, var(--page-ink-soft));transition:width 200ms}
.page-cover-btn{border:0;padding:4px 8px;border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer}
.page-cover-btn:hover{background:var(--page-pop-hover)}
.page-cover-panel[data-state="error"] .page-cover-msg{color:var(--page-danger, #9E3B2F)}
`;

const clamp = (value) => Math.min(100, Math.max(0, Math.round(value)));

// The format gate's own answer, as every command that writes a newer page format asks for
// it: the command's result when the gate admitted the write, the gate's refusal otherwise.
async function formatted(view, apply) {
  if (typeof view.runFormatCommand !== "function") return { ok: false, code: "page-format-unsupported" };
  const answer = await view.runFormatCommand(apply);
  return answer?.status === "applied" ? answer.result : { ok: false, code: answer?.code ?? answer?.status ?? "page-format-refused", retry: answer?.retry === true };
}
const readDataUrl = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(file); });

export function createFeature({ view = null, upload = null } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let session = null;

  function close() {
    const s = session;
    if (!s) return;
    session = null;
    for (const [target, type, fn, options] of s.listen) target.removeEventListener(type, fn, options);
    s.abort?.abort();
    s.input?.remove();
    s.ui?.remove();
    s.stopPick?.();
    if (s.state === "position") restore(s);
  }

  const listen = (s, target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    s.listen.push([target, type, fn, options]);
  };

  const button = (act, label) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "page-cover-btn";
    b.dataset.act = act;
    b.textContent = label;
    return b;
  };

  // One bar for the whole session: the upload's progress, its refusal, the embed offer, the
  // reposition's own message. It is runtime only, so nothing of it is in the record.
  function draw(s) {
    const box = s.panel ?? (s.panel = doc.createElement("div"));
    box.className = "page-cover-panel";
    box.dataset.state = s.state;
    box.setAttribute("contenteditable", "false");
    box.setAttribute("role", s.state === "uploading" ? "status" : "alert");
    box.textContent = "";
    const msg = doc.createElement("span");
    msg.className = "page-cover-msg";
    msg.textContent = s.message;
    box.append(msg);
    if (s.state === "uploading") {
      const bar = doc.createElement("span");
      bar.className = "page-cover-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(s.percent));
      const fill = doc.createElement("span");
      fill.style.width = `${s.percent}%`;
      bar.append(fill);
      box.append(bar, button("cancel", "Cancel"));
    } else if (s.state === "embed-choice") box.append(button("embed", "Keep this image inside the document"), button("cancel", "Close"));
    else if (s.state === "position") box.append(button("apply", "Apply"), button("cancel", "Cancel"));
    else box.append(button("cancel", "Close"));
    if (!s.ui) {
      const host = view.dom.parentElement;
      s.ui = mountEditorUI({ name: "page-cover", content: box, css: [COVER_CSS], parent: host ?? doc.body, before: host ? view.dom : null });
    }
  }

  function decide(s) {
    listen(s, s.panel, "click", (event) => {
      const b = event.target.closest?.("[data-act]");
      if (!b) return;
      event.preventDefault();
      if (b.dataset.act === "cancel") close();
      else if (b.dataset.act === "apply") apply(s);
      else if (b.dataset.act === "embed") embed(s);
    });
  }

  // The one place a cover reaches the document. The title the command was asked for is read
  // again here: one that was deleted, or one a heading that moved first displaced, is no
  // longer that title and the command refuses rather than decorating another page. A
  // document with no title grows one heading, whole, in this same transaction.
  function writeCover(owner, fields) {
    const title = titleOf(view.state.doc);
    if ((title ? title.node.attrs.id : null) !== owner) return { ok: false, code: "stale-target" };
    const tr = view.state.tr;
    if (!title) {
      const first = view.state.doc.maybeChild(0);
      tr.insert(0, schema.nodes.heading.create({ id: newId(), pos: keyBetween(null, first?.attrs.pos ?? null), parent: null, level: 1, ...fields }));
    } else tr.setNodeMarkup(title.at, null, { ...title.node.attrs, ...fields });
    view.dispatch(asStep(tr));
    return { ok: true, cover: true };
  }

  async function commitAndClose(s, fields) {
    const answer = await formatted(view, () => writeCover(s.owner, fields));
    if (session === s) close();
    if (answer?.ok) announce(view, "Cover added");
    return answer;
  }

  function pick(s) {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.className = "page-cover-input";
      input.hidden = true;
      (view.dom.parentElement ?? doc.body).appendChild(input);
      s.input = input;
      s.stopPick = () => resolve(null);
      let done = false;
      const finish = (file) => { if (done) return; done = true; resolve(file); };
      listen(s, input, "change", () => finish([...(input.files ?? [])][0] ?? null));
      listen(s, input, "cancel", () => finish(null));
      input.click();
    });
  }

  // The upload is media's own transport: the same host question, the same cancellation, the
  // same progress. Only an `unsupported` host is offered an embed, and only within the size
  // it can carry; every other answer is a refusal and embeds nothing.
  async function send(s, file) {
    const rt = mediaRuntime.get(view);
    const transport = rt?.upload ?? upload;
    if (typeof transport !== "function") {
      close();
      return { ok: false, code: "unavailable" };
    }
    const abort = new AbortController();
    s.abort = abort;
    rt?.aborts.set(s.id, abort);
    s.message = `Uploading ${file.name || "the image"}`;
    draw(s);
    let last = -5;
    const onProgress = ({ percent }) => {
      if (session !== s || (percent - last < 5 && percent !== 100)) return;
      last = percent;
      s.percent = percent;
      draw(s);
    };
    let res;
    try { res = await transport(file, { onProgress, signal: abort.signal }); }
    catch { res = { code: "network", msg: "Upload failed" }; }
    rt?.aborts.delete(s.id);
    if (session !== s || view.isDestroyed) return { ok: false, code: "not-editing" };
    if (res?.ok) {
      const src = safeFileHref(res.uploads?.[0]?.url);
      if (src) return commitAndClose(s, { pageCoverSrc: src, pageCoverAlt: "", pageCoverX: 50, pageCoverY: 50 });
      res = { code: "bad-response", msg: "The upload returned an invalid address" };
    }
    if (!res || typeof res !== "object") res = { code: "bad-response", msg: "The upload returned an invalid response" };
    if (res.code === "aborted") {
      close();
      return { ok: false, code: "cancelled" };
    }
    if (res.code === "unsupported") {
      const keep = /^image\/(png|jpeg|gif|webp)$/i.test(file.type) && file.size <= EMBED_MAX;
      s.state = keep ? "embed-choice" : "error";
      s.file = keep ? file : null;
      s.message = keep
        ? "This host doesn't store files. You can keep this image inside the document, which makes the document larger."
        : "This host doesn't store files, and this image is too large to keep inside the document.";
      draw(s);
      return { ok: false, code: "unsupported" };
    }
    s.state = "error";
    s.message = res.msg || "Upload failed";
    draw(s);
    return { ok: false, code: res.code ?? "error" };
  }

  async function embed(s) {
    const file = s.file;
    if (!file) return;
    const src = await readDataUrl(file);
    if (session !== s) return;
    const url = safeSrc(src);
    if (typeof url !== "string") {
      s.state = "error";
      s.message = "That image could not be kept inside the document.";
      draw(s);
      return;
    }
    return commitAndClose(s, { pageCoverSrc: url, pageCoverAlt: "", pageCoverX: 50, pageCoverY: 50 });
  }

  // Add cover: the file, then the host, then one write. The command answers with the file
  // chooser it opened, the way a picker does; nothing is written before the host answers,
  // and nothing at all if the title moved, the format gate refused, or the edit left while
  // the upload was in the air.
  function add() {
    close();
    const s = { id: newId("c"), owner: titleOf(view.state.doc)?.node.attrs.id ?? null, state: "uploading", percent: 0, message: "Choosing a cover", listen: [] };
    session = s;
    listen(s, doc, "keydown", (event) => {
      if (session !== s || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }, true);
    draw(s);
    decide(s);
    pick(s).then((file) => {
      if (session !== s) return;
      if (!file) close();
      else send(s, file);
    });
    return { ok: true, picker: true };
  }

  const coverImg = () => view.dom.querySelector("header[data-page-heading] img[data-page-cover]");

  function preview(s) {
    const img = coverImg();
    if (img) img.setAttribute("style", `object-position:${s.x}% ${s.y}%`);
  }

  function restore(s) {
    const title = titleOf(view.state.doc);
    const img = coverImg();
    if (!img || !title || title.node.attrs.id !== s.owner) return;
    img.setAttribute("style", `object-position:${title.node.attrs.pageCoverX}% ${title.node.attrs.pageCoverY}%`);
  }

  // The reposition commits once, for the block it was opened on, and only after the gate.
  async function apply(s) {
    if (session !== s) return { ok: false, code: "not-editing" };
    const { x, y } = s;
    close();
    return formatted(view, () => writeCover(s.owner, { pageCoverX: x, pageCoverY: y }));
  }

  // Reposition: the picture moves under the hand that placed it and the record does not,
  // until one commit on release, on Enter or on Apply. Escape puts it back.
  function reposition() {
    close();
    const title = titleOf(view.state.doc);
    if (!title || !title.node.attrs.pageCoverSrc) return { ok: false, code: "no-cover" };
    const s = {
      owner: title.node.attrs.id, state: "position", listen: [],
      x: title.node.attrs.pageCoverX, y: title.node.attrs.pageCoverY,
      message: "Drag the picture or use the arrow keys, then Apply",
    };
    session = s;
    draw(s);
    decide(s);
    listen(s, doc, "keydown", (event) => {
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === "Escape") { stop(); close(); }
      else if (event.key === "Enter") { stop(); apply(s); }
      else if (event.key === "ArrowLeft") { stop(); s.x = clamp(s.x - STEP); preview(s); }
      else if (event.key === "ArrowRight") { stop(); s.x = clamp(s.x + STEP); preview(s); }
      else if (event.key === "ArrowUp") { stop(); s.y = clamp(s.y - STEP); preview(s); }
      else if (event.key === "ArrowDown") { stop(); s.y = clamp(s.y + STEP); preview(s); }
    }, true);
    const img = coverImg();
    if (img) listen(s, img, "pointerdown", (event) => {
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      event.preventDefault();
      const at = { px: event.clientX, py: event.clientY, x: s.x, y: s.y };
      listen(s, doc, "pointermove", (move) => {
        s.x = clamp(at.x + ((move.clientX - at.px) / rect.width) * 100);
        s.y = clamp(at.y + ((move.clientY - at.py) / rect.height) * 100);
        preview(s);
      });
      listen(s, doc, "pointerup", () => apply(s));
    });
    return { ok: true, position: true };
  }

  return {
    run(args) {
      return args?.act === "position" ? reposition() : add();
    },
    dispose() { close(); },
  };
}
