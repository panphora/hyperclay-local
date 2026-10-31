// The self-contained reading copy, as a command. One snapshot of the live model is
// taken and rendered through the projection, then each image and attachment the
// snapshot names is read once and written inside the file. Nothing downloads until
// the person has seen the captured title, the time it was taken and every resource
// the copy could not carry: a file that is missing something is never offered, and
// one that is offered has no address in it that would be fetched again.
import { project } from "../projection.js";
import { blockMap } from "../model.js";
import { PageExportError, renderExportHtml } from "../export-html.js";
import { inlineExportResources } from "../export-assets.js";
import { downloadHtml, documentName } from "../../core/download.js";
import { mountEditorUI } from "../../ui/editor-ui.js";

const MAX_NAME = 80;
const UNSAFE_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

// The captured title as a file name: one line, no path of its own, and the page's own
// name when a title has nothing a file name can keep.
function fileName(title) {
  const base = String(title ?? "").replace(UNSAFE_NAME, " ").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, MAX_NAME).trim();
  if (base) return `${base}.html`;
  try { return `${documentName()}.html`; } catch { return "page.html"; }
}

// The panel sits in its own shadow root beside the editor, so the page's CSS cannot restyle
// it. The page's --page-* tokens still reach it, and it keeps the editor's font and colour.
const PANEL_CSS = `
:host{font:inherit !important;color:inherit !important}
.page-export-panel{max-width:46ch;margin:8px 0;padding:10px 12px;border:1px solid var(--page-pop-line);border-radius:8px;background:var(--page-pop-bg);color:var(--page-pop-ink);box-shadow:var(--page-pop-shadow);font-size:.88em}
.page-export-title{margin:0 0 2px;font-weight:600}
.page-export-when{margin:0 0 6px;color:var(--page-ink-soft)}
.page-export-losses{margin:6px 0;padding-left:1.1em}
.page-export-losses li{margin:2px 0}
.page-export-acts{display:flex;gap:6px;margin-top:8px}
.page-export-btn{border:0;padding:4px 8px;border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer}
.page-export-btn:hover{background:var(--page-pop-hover)}
.page-export-panel[data-state="loss"] .page-export-title{color:var(--page-danger, #9E3B2F)}
`;

export function createFeature({ view = null, download = downloadHtml, fetch: fetchImpl = null, now = () => new Date() } = {}) {
  if (!view) return { run: () => ({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let session = null;
  let disposed = false;

  const listen = (s, target, type, fn) => {
    target.addEventListener(type, fn);
    s.listen.push([target, type, fn]);
  };

  const button = (act, label) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "page-export-btn";
    b.dataset.act = act;
    b.textContent = label;
    return b;
  };

  function close() {
    const s = session;
    if (!s) return;
    session = null;
    for (const [target, type, fn] of s.listen) target.removeEventListener(type, fn);
    s.abort?.abort();
    s.ui?.remove();
  }

  // One panel for the whole session: what was captured, what could not be carried, and
  // the one action that does anything — a download, and only when nothing is missing.
  function draw(s) {
    const box = s.panel ?? (s.panel = doc.createElement("aside"));
    box.className = "page-export-panel";
    box.dataset.state = s.ready ? "ready" : "loss";
    box.setAttribute("contenteditable", "false");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "false");
    box.setAttribute("aria-labelledby", "page-export-title");
    box.dataset.at = s.at.toISOString();
    box.setAttribute("tabindex", "-1");
    box.textContent = "";
    const title = doc.createElement("p");
    title.className = "page-export-title";
    title.id = "page-export-title";
    const heading = s.ready ? "Reading copy" : "This page cannot be a reading copy yet";
    title.textContent = s.title ? `${heading}: ${s.title}` : heading;
    const when = doc.createElement("p");
    when.className = "page-export-when";
    const said = `${s.at.toLocaleString()} · ${s.embedded} ${s.embedded === 1 ? "resource" : "resources"} inside the file`;
    when.textContent = said;
    box.append(title, when);
    if (s.losses.length) {
      const list = doc.createElement("ul");
      list.className = "page-export-losses";
      for (const entry of s.losses) {
        const item = doc.createElement("li");
        item.textContent = entry.message;
        list.append(item);
      }
      box.append(list);
    }
    const acts = doc.createElement("div");
    acts.className = "page-export-acts";
    if (s.ready) acts.append(button("download", "Download"), button("close", "Close"));
    else acts.append(button("retry", "Try again"), button("close", "Close"));
    box.append(acts);
    const first = acts.firstChild;
    if (!s.ui) s.ui = mountEditorUI({ name: "page-export", content: box, css: [PANEL_CSS], parent: view.dom.parentElement ?? doc.body });
    // The panel is what a person lands on: the download when there is one to take,
    // and the list of what stopped it when there is not.
    (s.ready ? first : box).focus?.();
  }

  function decide(s) {
    listen(s, s.panel, "click", (event) => {
      const b = event.target.closest?.("[data-act]");
      if (!b) return;
      event.preventDefault();
      if (b.dataset.act === "close") close();
      else if (b.dataset.act === "download") save(s);
      else if (b.dataset.act === "retry") run().catch((error) => console.error("clayjs: the reading copy could not be made", error));
    });
    listen(s, doc, "keydown", (event) => {
      if (event.key !== "Escape" || session !== s) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }, true);
  }

  // The one place a reading copy becomes a file. The download is handed the bytes that
  // were shown, never a second render, so what a person saw is what they get.
  function save(s) {
    if (!s.ready || disposed) return { ok: false, code: "not-editing" };
    const saved = download({ html: s.ready.html, name: s.ready.name });
    close();
    return { ok: saved === true, downloaded: saved === true };
  }

  async function run() {
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    close();
    const s = { at: now(), title: "", panel: null, listen: [], abort: new AbortController(), losses: [], embedded: 0, ready: null };
    // The model is read once, before anything is awaited: a peer's edit while the
    // resources arrive cannot change the file being made.
    const blocks = blockMap(view.state.doc);
    const model = project(blocks);
    const base = doc.baseURI;
    let rendered;
    try {
      rendered = renderExportHtml(model, {
        fallbackOf: (id) => (typeof blocks[id]?.artifact?.fallbackHtml === "string" ? blocks[id].artifact.fallbackHtml : ""),
        doc,
      });
    } catch (error) {
      if (!(error instanceof PageExportError)) throw error;
      s.title = null;
      s.losses = [{ code: error.code, message: error.message }];
      session = s;
      draw(s);
      decide(s);
      return { ok: false, code: error.code, message: error.message };
    }
    s.title = rendered.title || "Untitled";
    session = s;
    const transport = fetchImpl ?? globalThis.fetch;
    const result = await inlineExportResources(rendered.html, { resources: rendered.resources, base, fetch: transport, signal: s.abort.signal });
    if (disposed || view.isDestroyed || session !== s) return { ok: false, code: "not-editing" };
    s.embedded = result.embedded;
    s.losses = result.losses.slice();
    for (const entry of result.remote ?? []) {
      s.losses.push({ code: "remote-reference", message: `The ${entry.tag} in the reading copy still points at ${String(entry.value).slice(0, 120)}` });
    }
    if (!s.losses.length) s.ready = { html: result.html, name: fileName(s.title) };
    draw(s);
    decide(s);
    return s.ready
      ? { ok: true, title: s.title, name: s.ready.name, embedded: s.embedded }
      : { ok: false, code: "resource-losses", losses: s.losses };
  }

  return {
    run,
    dispose() {
      disposed = true;
      close();
    },
  };
}
