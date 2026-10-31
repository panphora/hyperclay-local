// Markdown export: the Download Markdown action. It snapshots the live record once, so a
// peer's edit while the report is open cannot change the file, and it shows what the
// format could not carry before anything downloads: each block written as semantic HTML
// and each construct whose meaning goes away, named per block. No parser is fetched to
// export. The file goes through the page copy's own download helper, nothing here writes,
// enters history or marks the page saved, and an active composition is waited out rather
// than forced.
import { blockMap } from "../model.js";
import { downloadHtml, documentName } from "../../core/download.js";
import { exportMarkdown, markdownFileName } from "../export-markdown.js";

export function createFeature({ view = null, download = downloadHtml } = {}) {
  if (!view) return { run: () => Promise.resolve({ ok: false, code: "not-editing" }), dispose() {} };
  const doc = view.dom.ownerDocument;
  let session = null;
  let disposed = false;

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

  // The report: how much was written, every construct kept as HTML and every loss, then
  // Download and Cancel. It uses the editor's own menu markup, so it needs no stylesheet
  // of its own.
  function draw(s) {
    const parts = [];
    const line = (className, text) => {
      const el = doc.createElement("div");
      el.className = className;
      el.textContent = text;
      return el;
    };
    parts.push(line("page-menu-title", "Export as Markdown"));
    const counts = [`${s.report.blocks} block${s.report.blocks === 1 ? "" : "s"}`];
    if (s.report.extensions.length) counts.push(`${s.report.extensions.length} kept as HTML`);
    if (s.report.losses.length) counts.push(`${s.report.losses.length} lost`);
    parts.push(line("page-menu-title page-export-summary", counts.join(" \u00b7 ")));
    const section = (className, label, list) => {
      if (!list.length) return;
      const box = doc.createElement("div");
      box.className = className;
      box.append(line("page-menu-title", label));
      for (const one of list) {
        const row = line("page-export-row", one.name);
        row.dataset.block = one.block ?? "";
        row.dataset.type = one.type ?? "";
        box.append(row);
      }
      parts.push(box);
    };
    section("page-export-extensions", "Kept as HTML", s.report.extensions);
    section("page-export-losses", "Not kept in Markdown", s.report.losses);
    if (!s.report.extensions.length && !s.report.losses.length) parts.push(line("page-export-row", "Everything here is written as Markdown."));
    if (s.notice) {
      const failed = doc.createElement("p");
      failed.className = "page-export-error";
      failed.setAttribute("role", "alert");
      failed.textContent = s.notice;
      parts.push(failed);
    }
    const button = (what, label) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = "page-menu-item";
      el.dataset.export = what;
      el.textContent = label;
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", () => (what === "download" ? save() : cancel()));
      return el;
    };
    parts.push(button("download", `Download ${s.name}`), button("cancel", "Cancel"));
    s.panel.replaceChildren(...parts);
  }

  function save() {
    const s = session;
    if (!s) return { ok: false, code: "no-export" };
    if (download({ html: s.report.text, name: s.name, type: "text/markdown" })) {
      close();
      view.focus?.();
      return { ok: true, downloaded: true };
    }
    s.notice = "That download could not be made.";
    draw(s);
    return { ok: false, code: "download-failed" };
  }

  function key(event) {
    const s = session;
    if (!s || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter" && !event.target?.closest?.("[data-export]")) {
      event.preventDefault();
      event.stopPropagation();
      save();
    }
  }

  function open(report, name) {
    const panel = doc.createElement("div");
    panel.className = "page-menu page-export-preview";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Export Markdown");
    const s = { report, name, panel, notice: null, listen: [] };
    session = s;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      s.listen.push([target, type, fn, options]);
    };
    listen(doc, "keydown", (event) => key(event), true);
    listen(doc, "mousedown", (event) => { if (!s.panel.contains(event.target)) cancel(); }, true);
    (view.dom.parentElement ?? doc.body).appendChild(panel);
    draw(s);
    panel.querySelector('[data-export="download"]')?.focus?.();
    return { ok: true, preview: true };
  }

  // A composition is never forced: the export waits for the person to finish it, because
  // the record it reads is the one the composition is still writing into.
  function composed() {
    if (!view.composing) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        view.dom.removeEventListener("compositionend", done);
        resolve();
      };
      view.dom.addEventListener("compositionend", done);
    });
  }

  async function run() {
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    close();
    await composed();
    if (disposed || view.isDestroyed) return { ok: false, code: "not-editing" };
    const snapshot = blockMap(view.state.doc);
    let report;
    try {
      report = exportMarkdown(snapshot);
    } catch (error) {
      return { ok: false, code: "export-failed", error };
    }
    return open(report, markdownFileName(documentName()));
  }

  return {
    async run(args) {
      return run(args);
    },
    dispose() {
      disposed = true;
      close();
    },
  };
}
