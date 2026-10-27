import { serializeRecoveryClone, captureRecoveryPage } from "./snapshot.js";
import { rowOf } from "./conflict-presentation.js";

// Download my copy: one file, openable in a browser as the page this tab had, with
// the replaced edits listed in a JSON block for anyone (or any tool) putting them
// back by hand. Several applies lost edits: the newest one's page is the document,
// the older pages ride along as strings. Nothing here saves, acknowledges or
// releases anything.

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function documentName(pathname = location.pathname) {
  const last = pathname.split("/").filter(Boolean).pop();
  if (!last) return pathname.endsWith("/") || pathname === "" ? "index" : "page";
  let name = last;
  try { name = decodeURIComponent(last); } catch {}
  return name.replace(/\.(html?|htmlclay)$/i, "") || "page";
}

function embed(html, data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const block = `<script type="application/json" id="clay-lost-edits" clay="no-save">${json}</script>`;
  const at = html.lastIndexOf("</body>");
  return at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + block;
}

export function buildRecovery(records, { refused = false } = {}) {
  const ledger = window.clay?.conflicts || null;
  const applies = [];
  const seen = new Set();
  for (const r of records) {
    const apply = ledger?.recoveryOf(r.id);
    if (apply && !seen.has(apply.id)) { seen.add(apply.id); applies.push(apply); }
  }
  applies.sort((a, b) => (a.ticket || 0) - (b.ticket || 0));
  const pageOf = (a) => serializeRecoveryClone(a.recoveryRoot ?? a.root, { prepared: a.domain === "save" });

  let html;
  let older;
  if (refused || !applies.length) {
    html = captureRecoveryPage();
    older = applies;
  } else {
    html = pageOf(applies[applies.length - 1]);
    older = applies.slice(0, -1);
  }
  const edits = records.map((r) => {
    if (r.kind === "apply-incomplete") return { id: r.id, kind: "apply-incomplete", name: "Sync update that did not finish", error: r.error ?? null };
    const { id, name, kind, yours, now, sentence } = rowOf(r);
    return { id, name, kind, yours, now, sentence };
  });
  const data = {
    format: "clay-lost-edits",
    version: 1,
    savedAt: new Date().toISOString(),
    page: location.href,
    refused: !!refused,
    edits,
    earlierPages: older.map((a) => ({ applyId: a.id, source: a.source, html: pageOf(a) })),
  };
  return {
    html: embed(html, data),
    name: `${documentName()}-${refused ? "my-version" : "my-copy"}-${stamp()}.html`,
  };
}

export function downloadHtml({ html, name }) {
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.setAttribute("clay", "no-save no-watch no-snapshot");
    a.href = url;
    a.download = name;
    a.style.setProperty("display", "none", "important");
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked late: Safari cancels a download whose URL goes away too soon.
    setTimeout(() => URL.revokeObjectURL(url), 40000);
    return true;
  } catch (err) {
    console.error("clayjs: could not build the download", err);
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}

// The review panel's own copy: the page a reload kept, when there is one, with every
// stored row it drew listed beside it as JSON. The rows are already plain, so nothing
// here reads the ledger the tab no longer has.
export function downloadStored({ html = null, edits = [] } = {}) {
  try {
    const page = typeof html === "string" ? html : captureRecoveryPage();
    const data = {
      format: "clay-lost-edits",
      version: 1,
      savedAt: new Date().toISOString(),
      page: location.href,
      refused: false,
      edits: Array.isArray(edits) ? edits : [],
      earlierPages: [],
    };
    return downloadHtml({ html: embed(page, data), name: `${documentName()}-my-copy-${stamp()}.html` });
  } catch (err) {
    console.error("clayjs: could not build the download", err);
    return false;
  }
}

export function downloadRecovery(records, { refused = false } = {}) {
  try {
    const { html, name } = buildRecovery(records, { refused });
    return downloadHtml({ html, name });
  } catch (err) {
    console.error("clayjs: could not build the download", err);
    return false;
  }
}
