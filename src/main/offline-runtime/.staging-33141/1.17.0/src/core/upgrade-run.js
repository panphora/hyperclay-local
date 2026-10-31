import { replace as replaceDocument } from "./save-replace.js";
import { lastSeenEtag } from "./etag.js";
import { claimDocumentOperation, releaseDocumentOperation } from "./save-core.js";
import { isNewerVersion } from "./version.js";
import { upgrade, readMeta } from "../vendor/hyper-html-api-upgrade.vendor.js";

const MANIFEST_FAILED = "The new version could not be downloaded. Nothing was changed.";
const SAVE_FAILED = "The upgrade could not be saved. Nothing was changed.";
const CONFLICT = "This document changed somewhere else. Reload and try again.";
const BUSY = "Something else is changing this document. Nothing was changed.";
const UNDECLARED = "This document does not say which parts are its data, so it cannot be upgraded safely. Nothing was changed.";
const PAGE_LOST = "The new version has no place for this page's content. Nothing was changed.";

async function digestOf(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchOrNull(fetchFn, url) {
  try {
    const res = await fetchFn(url, { credentials: "omit" });
    if (!res || !res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

function manifestUrl(update, doc, loc) {
  if (update && typeof update.latestUrl === "string" && update.latestUrl) return update.latestUrl;
  const source = readMeta(doc, "hyper-source");
  if (!source) return null;
  try {
    const url = new URL(source, loc ? loc.href : undefined);
    url.pathname = url.pathname.replace(/\.html$/, ".json");
    return url.href;
  } catch {
    return null;
  }
}

function templateOf(doc) {
  const value = readMeta(doc, "clay-template");
  if (!value) return null;
  const [id, variant] = value.split(/\s+/);
  return id && variant ? { id, variant } : null;
}

function leavesOf(value, path = "", out = []) {
  if (Array.isArray(value)) {
    for (const item of value) leavesOf(item, `${path}[]`, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) leavesOf(item, path ? `${path}.${key}` : key, out);
    return out;
  }
  if (value !== null && value !== undefined) out.push({ path, value });
  return out;
}

function valuesAt(data, pattern) {
  let current = [data];
  for (const part of String(pattern).split(".")) {
    const list = part.endsWith("[]");
    const key = list ? part.slice(0, -2) : part;
    const next = [];
    for (const node of current) {
      const value = key ? node?.[key] : node;
      if (list) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}

export function lostValues(before, after, renames = {}) {
  const kept = new Map();
  for (const { path, value } of leavesOf(after)) {
    const key = `${path}\u0000${String(value)}`;
    kept.set(key, (kept.get(key) || 0) + 1);
  }
  const lost = [];
  for (const { path, value } of leavesOf(before)) {
    const key = `${path}\u0000${String(value)}`;
    if (kept.get(key) > 0) {
      kept.set(key, kept.get(key) - 1);
      continue;
    }
    const renamed = renames[path];
    if (typeof renamed === "string" && valuesAt(after, renamed).some((candidate) => candidate === value)) continue;
    lost.push({ path, value });
  }
  return lost;
}

async function evaluateTransform(code) {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await new Function("url", "return import(url)")(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function declaredRenames(htmlText) {
  const sourceDoc = new DOMParser().parseFromString(htmlText, "text/html");
  const tag = sourceDoc.querySelector('script[type="text/hyper-upgrade"]');
  if (!tag) return {};
  const mod = await evaluateTransform(tag.textContent || "");
  return mod && mod.renames && typeof mod.renames === "object" ? mod.renames : {};
}

// The page editor's content is its article and the live stores beside it, not values a
// rules tag can name: the upgrade carries them whole into the new version's article.
const PAGE_STORE = 'script[clay~="live"][merge]';

function carryPage(doc, afterDoc, article) {
  const target = afterDoc.querySelector("article[data-page]");
  if (!target) return null;
  target.replaceWith(afterDoc.importNode(article, true));
  for (const store of doc.querySelectorAll(PAGE_STORE)) {
    const name = store.getAttribute("merge");
    if (name !== "page" && !name.startsWith("page.")) continue;
    const copy = afterDoc.importNode(store, true);
    const existing = [...afterDoc.querySelectorAll(PAGE_STORE)].find((el) => el.getAttribute("merge") === name);
    if (existing) existing.replaceWith(copy);
    else afterDoc.querySelector("article[data-page]").after(copy);
  }
  const doctype = afterDoc.doctype ? `<!DOCTYPE ${afterDoc.doctype.name}>\n` : "";
  return doctype + afterDoc.documentElement.outerHTML;
}

export async function prepare(update, {
  doc = document,
  loc = location,
  fetchFn = (url, init) => fetch(url, init),
} = {}) {
  const clay = (typeof window !== "undefined" && window.clay) || {};
  if (clay.isDraftMode) return { ok: false, code: "draft" };
  if (!update || typeof update.version !== "string") return { ok: false, code: "unavailable", message: MANIFEST_FAILED };

  const latestUrl = manifestUrl(update, doc, loc);
  if (!latestUrl) return { ok: false, code: "unavailable", message: MANIFEST_FAILED };

  const manifestRes = await fetchOrNull(fetchFn, latestUrl);
  if (!manifestRes) return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  let latest;
  try {
    latest = await manifestRes.json();
  } catch {
    return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  }
  if (!latest || typeof latest !== "object") return { ok: false, code: "unavailable", message: MANIFEST_FAILED };

  const template = templateOf(doc);
  if (!template || latest.id !== template.id || latest.variant !== template.variant) {
    return { ok: false, code: "template", message: "This upgrade is for a different document." };
  }
  const fromVersion = readMeta(doc, "hyper-version");
  if (!fromVersion || typeof latest.version !== "string" || !isNewerVersion(latest.version, fromVersion)) {
    return { ok: false, code: "not-newer", message: "There is no newer version to install." };
  }
  if (typeof latest.html !== "string" || !latest.html) return { ok: false, code: "unavailable", message: MANIFEST_FAILED };

  let htmlUrl;
  try {
    htmlUrl = new URL(latest.html, latestUrl).href;
  } catch {
    return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  }
  if (!/^https:\/\/hyperclay\.com\/templates\//.test(htmlUrl)) {
    return { ok: false, code: "source", message: "This upgrade is not from the template host." };
  }

  const htmlRes = await fetchOrNull(fetchFn, htmlUrl);
  if (!htmlRes) return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  let htmlText;
  try {
    htmlText = await htmlRes.text();
  } catch {
    return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  }
  const digest = await digestOf(new TextEncoder().encode(htmlText));
  if (!digest || digest !== String(latest.sha256 || "").toLowerCase()) {
    return { ok: false, code: "unavailable", message: MANIFEST_FAILED };
  }

  let result;
  let renames;
  try {
    renames = await declaredRenames(htmlText);
    result = await upgrade.run({
      sourceUrl: htmlUrl,
      doc,
      loc,
      fromVersion,
      fetchFn: async () => ({ ok: true, status: 200, text: async () => htmlText }),
    });
  } catch (err) {
    return { ok: false, code: "transform", message: err && err.message ? err.message : MANIFEST_FAILED };
  }
  const afterDoc = new DOMParser().parseFromString(result.html, "text/html");
  const before = upgrade.extractAll(doc).dataByName;
  const article = doc.querySelector("article[data-page]");
  if (!article && !Object.keys(before || {}).length) {
    return { ok: false, code: "undeclared", message: UNDECLARED };
  }
  let html = result.html;
  if (article) {
    const carried = carryPage(doc, afterDoc, article);
    if (!carried) return { ok: false, code: "lost", lost: [], discarded: 0, message: PAGE_LOST };
    html = carried;
  }
  const after = upgrade.extractAll(afterDoc).dataByName;
  const lost = lostValues(before, after, renames);
  const discarded = result.summary && result.summary.totals ? result.summary.totals.discarded || 0 : 0;
  if (lost.length || discarded > 0) {
    return { ok: false, code: "lost", lost, discarded, message: lossMessage(lost, discarded) };
  }
  return { ok: true, html, version: result.toVersion || latest.version };
}

function lossMessage(lost, discarded) {
  const names = lost.slice(0, 5).map(({ path }) => path);
  const more = lost.length > names.length ? ` and ${lost.length - names.length} more` : "";
  if (names.length) return `This upgrade would lose data: ${names.join(", ")}${more}. Nothing was changed.`;
  return `This upgrade would lose ${discarded} value${discarded === 1 ? "" : "s"}. Nothing was changed.`;
}

function flushFailure(err) {
  const state = err && err.state;
  if (state === "conflict") return { ok: false, code: "conflict", message: CONFLICT };
  const reason = err && err.message ? err.message : "The document could not be saved.";
  return { ok: false, code: "flush", state: state || "failed", message: reason };
}

export async function apply(update, {
  doc = document,
  loc = location,
  fetchFn = (url, init) => fetch(url, init),
  clay = typeof window !== "undefined" ? window.clay : null,
  reload = () => window.location.reload(),
  replace = null,
  etag,
} = {}) {
  const pageClay = clay || {};
  if (pageClay.isDraftMode) return { ok: false, code: "draft" };

  // An upgrade flushes this generation and then replaces it with another, so it speaks
  // for the whole document while it runs: a mode switch cannot start its barrier in the
  // middle of one, and two upgrades cannot interleave their flushes and writes.
  const operation = claimDocumentOperation("upgrade");
  if (!operation) return { ok: false, code: "busy", message: BUSY };
  try {
    return await applyUnderSlot(update, { doc, loc, fetchFn, clay, reload, replace, etag });
  } finally {
    releaseDocumentOperation(operation);
  }
}

async function applyUnderSlot(update, { doc, loc, fetchFn, clay, reload, replace, etag }) {
  const pageClay = clay || {};

  if (pageClay.isEditMode && pageClay.save && typeof pageClay.save.flush === "function") {
    let flushed;
    try {
      flushed = await pageClay.save.flush();
    } catch (err) {
      return flushFailure(err);
    }
    if (flushed && typeof flushed.state === "string" && flushed.state !== "saved" && flushed.state !== "clean" && flushed.state !== "view") {
      return { ok: false, code: "flush", state: flushed.state, message: "This document has changes that could not be saved. Nothing was changed." };
    }
  }

  const prepared = await prepare(update, { doc, loc, fetchFn });
  if (!prepared.ok) return prepared;

  const save = typeof replace === "function"
    ? replace
    : pageClay.save && typeof pageClay.save.replace === "function"
      ? pageClay.save.replace
      : replaceDocument;
  let result;
  try {
    result = await save(prepared.html, { etag: etag !== undefined ? etag : lastSeenEtag() });
  } catch {
    return { ok: false, code: "failed", message: SAVE_FAILED };
  }
  if (!result || !result.ok) {
    const code = result && result.code ? result.code : "failed";
    if (code === "conflict") return { ok: false, code, message: CONFLICT };
    if (code === "forbidden") return { ok: false, code, message: "You are not allowed to save this document." };
    if (code === "unsupported") return { ok: false, code, message: "This host cannot save the upgrade." };
    return { ok: false, code, message: SAVE_FAILED };
  }
  reload();
  return { ok: true, html: prepared.html, version: prepared.version, etag: result.etag };
}

function element(doc, tag, props = {}) {
  const node = doc.createElement(tag);
  node.setAttribute("clay", "editor-ui");
  for (const [key, value] of Object.entries(props)) {
    if (key === "style") node.setAttribute("style", value);
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  return node;
}

function downloadName(loc) {
  const last = (loc && loc.pathname ? loc.pathname : "/").split("/").filter(Boolean).pop();
  let name = last || "page.html";
  try {
    name = decodeURIComponent(name);
  } catch {}
  return /\.html?$/i.test(name) ? name : `${name}.html`;
}

// A view-mode tab has no save capture, and edits nothing, so the copy is the stored file
// this upgrade is about to replace. Only a host without version history asks for it.
export async function pageBytes(clay, { loc = location, fetchFn = (url, init) => fetch(url, init) } = {}) {
  if (typeof clay.getHTML === "function") return clay.getHTML();
  const res = await fetchFn(loc.href, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(`copy fetch ${res.status}`);
  return res.text();
}

export async function downloadCopy({ clay, doc = document, loc = location, fetchFn } = {}) {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  try {
    const bytes = await pageBytes(clay, { loc, fetchFn });
    const url = URL.createObjectURL(new Blob([bytes], { type: "text/html" }));
    const a = doc.createElement("a");
    a.setAttribute("clay", "editor-ui");
    a.href = url;
    a.download = downloadName(loc);
    a.style.setProperty("display", "none", "important");
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 40000);
    return true;
  } catch {
    return false;
  }
}

async function hasHistory(clay) {
  const host = clay && clay.host;
  if (!host || !host.versions) return false;
  try {
    return (await host.versions) === true;
  } catch {
    return false;
  }
}

export async function start(update, options = {}) {
  const doc = options.doc || document;
  const clay = options.clay || (typeof window !== "undefined" ? window.clay : null) || {};
  if (clay.isDraftMode) return null;
  if (!update || typeof update.version !== "string") return null;

  const versions = await hasHistory(clay);
  const root = element(doc, "div", {
    role: "dialog",
    "aria-modal": "true",
    "data-clay-upgrade": "",
    style: "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,17,21,.42);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;",
  });
  const panel = element(doc, "div", {
    style: "width:min(460px,100%);padding:20px;border-radius:14px;background:var(--clay-ui-bg,#fff);color:var(--clay-ui-fg,#1f2328);box-shadow:0 18px 48px -16px rgba(0,0,0,.55);font-size:14px;line-height:1.5;",
  });
  const title = element(doc, "h2", { text: `Upgrade to version ${update.version}`, style: "margin:0 0 8px;font-size:16px;" });
  const body = element(doc, "p", {
    text: `Your data moves into version ${update.version}. The page's layout and code are replaced; your current version stays in this document's history.`,
    style: "margin:0 0 16px;",
  });
  const status = element(doc, "p", { role: "status", style: "margin:0 0 12px;min-height:1.5em;" });
  const actions = element(doc, "div", { style: "display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;" });
  const buttonStyle = "padding:7px 12px;border-radius:8px;border:1px solid rgba(23,28,36,.2);background:transparent;color:inherit;font:inherit;cursor:pointer;";
  const cancel = element(doc, "button", { type: "button", text: "Cancel", style: buttonStyle });
  const download = versions ? null : element(doc, "button", { type: "button", text: "Download a copy first", style: buttonStyle });
  const agree = element(doc, "button", {
    type: "button",
    text: "Upgrade",
    style: `${buttonStyle}border-color:transparent;background:#2f6fed;color:#fff;font-weight:600;`,
  });
  if (!versions) agree.disabled = true;

  if (download) actions.append(download);
  actions.append(cancel, agree);
  panel.append(title, body, status, actions);
  root.append(panel);
  doc.body.appendChild(root);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
  };

  if (download) {
    download.addEventListener("click", async () => {
      if (await downloadCopy({ clay, doc, loc: options.loc, fetchFn: options.fetchFn })) {
        agree.disabled = false;
        status.textContent = "Your copy was downloaded.";
      } else {
        status.textContent = "The copy could not be downloaded. Nothing was changed.";
      }
    });
  }

  cancel.addEventListener("click", close);

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  agree.addEventListener("click", async () => {
    agree.disabled = true;
    if (download) download.disabled = true;
    status.textContent = `Upgrading to version ${update.version}…`;
    const result = await apply(update, options);
    if (result.ok) {
      close();
      resolveDone(result);
      return;
    }
    status.textContent = result.message || SAVE_FAILED;
    agree.disabled = false;
    if (download) download.disabled = false;
    resolveDone(result);
  });

  return { root, title, body, status, cancel, download, upgrade: agree, close, done };
}
