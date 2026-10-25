// A copy made from a starter template says where it came from: its `hyper-source`
// and `hyper-version` metas. Once per load, the person who can edit such a copy is
// asked whether a newer version was published, and gets one offer when it was: an
// item with a dot in the menu, or a notice with Upgrade and Not now when the page
// has no menu. Nothing here writes the document; the click lands on
// `clay:upgrade-requested`, which is where the upgrade itself picks it up.
//
// Silent on every other page: no metas (a copy made before templates carried them),
// a visitor, a draft, no network, a failed fetch, a bad digest or an equal version.
// The 24-hour cache and the dotted-version comparison are hyper-html-api's own.
import { isNewerVersion } from "../vendor/hyper-html-api-upgrade.vendor.js";

const CACHE_PREFIX = "hha:upgrade-check:";
const TTL_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "upgrade-dismissed";
const NOTICE = "A new version of this template is available.";

function readMeta(doc, name) {
  const el = doc.querySelector(`meta[name="${name}"]`);
  const content = el ? el.getAttribute("content") : null;
  return content && content.trim() ? content.trim() : null;
}

function readCache(key) {
  try {
    const raw = globalThis.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage (a private window): the next load asks again.
  }
}

async function digestOf(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchOrNull(fetchFn, url) {
  try {
    const res = await fetchFn(url, { credentials: "omit" });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

// `hyper-source` names the published HTML; its manifest is the same URL as JSON.
async function latestManifest(sourceHref, currentVersion, { fetchFn, now }) {
  const latestUrl = new URL(sourceHref);
  latestUrl.pathname = latestUrl.pathname.replace(/\.html$/, ".json");
  const cacheKey = `${CACHE_PREFIX}${latestUrl.href}:${currentVersion}`;
  const cached = readCache(cacheKey);
  if (cached && typeof cached.checkedAt === "number" && now - cached.checkedAt < TTL_MS) {
    return { latest: cached.latest, latestUrl };
  }
  const res = await fetchOrNull(fetchFn, latestUrl.href);
  if (!res) return { latest: null, latestUrl };
  let latest = null;
  try {
    latest = await res.json();
  } catch {
    return { latest: null, latestUrl };
  }
  writeCache(cacheKey, { checkedAt: now, latest });
  return { latest, latestUrl };
}

export async function findUpdate({
  doc = document,
  loc = location,
  fetchFn = (url, init) => fetch(url, init),
  now = Date.now(),
} = {}) {
  const clay = (typeof window !== "undefined" && window.clay) || {};
  // A visitor cannot act on the offer, and a draft is not the document the source
  // would replace. Neither fetches.
  if (!clay.canEdit || clay.isDraftMode) return null;

  const sourceUrl = readMeta(doc, "hyper-source");
  const currentVersion = readMeta(doc, "hyper-version");
  if (!sourceUrl || !currentVersion) return null;

  let source;
  try {
    source = new URL(sourceUrl, loc ? loc.href : undefined);
  } catch {
    return null;
  }
  if (!source.pathname.endsWith(".html")) return null;
  // A pristine published copy points at itself: it is the source, not a copy of one.
  if (loc && source.origin === loc.origin && source.pathname === loc.pathname) return null;
  const latestUrl = new URL(source.href);
  latestUrl.pathname = latestUrl.pathname.replace(/\.html$/, ".json");

  const { latest } = await latestManifest(source.href, currentVersion, { fetchFn, now });
  if (!latest || typeof latest !== "object") return null;
  if (typeof latest.version !== "string" || !isNewerVersion(latest.version, currentVersion)) return null;

  const storage = clay.storage && clay.storage.local;
  if (storage && storage.get(DISMISSED_KEY) === latest.version) return null;

  if (typeof latest.html !== "string" || !latest.html) return null;
  const htmlUrl = new URL(latest.html, latestUrl).href;
  const res = await fetchOrNull(fetchFn, htmlUrl);
  if (!res) return null;
  let bytes;
  try {
    bytes = await res.arrayBuffer();
  } catch {
    return null;
  }
  const digest = await digestOf(bytes);
  // A manifest whose digest does not match its HTML is a host that served the wrong
  // bytes. Nothing is offered, because nothing can be trusted to be that version.
  if (!digest || digest !== String(latest.sha256 || "").toLowerCase()) return null;

  return { version: latest.version, html: htmlUrl, sha256: digest, latestUrl: latestUrl.href };
}

function dismiss(version) {
  const clay = window.clay;
  const storage = clay && clay.storage && clay.storage.local;
  if (storage) storage.set(DISMISSED_KEY, version);
}

function menuPlanned(clay) {
  return Boolean(clay && Array.isArray(clay.plugins) && clay.plugins.includes("menu"));
}

function menuReady(clay) {
  return Boolean(clay && clay.menu && typeof clay.menu.addItem === "function");
}

function whenMenuReady(clay) {
  if (menuReady(clay) || !menuPlanned(clay)) return Promise.resolve();
  return new Promise((resolve) => {
    const onSettled = (event) => {
      if (!event.detail || event.detail.plugin !== "menu") return;
      document.removeEventListener("clay:plugin-ready", onSettled);
      document.removeEventListener("clay:plugin-failed", onSettled);
      resolve();
    };
    document.addEventListener("clay:plugin-ready", onSettled);
    document.addEventListener("clay:plugin-failed", onSettled);
  });
}

export async function announce(update, clay = typeof window !== "undefined" ? window.clay : null) {
  const run = () => document.dispatchEvent(new CustomEvent("clay:upgrade-requested", { detail: update }));
  await whenMenuReady(clay);
  if (menuReady(clay)) {
    clay.menu.addItem({ id: "upgrade", label: `Upgrade to version ${update.version}`, badge: true, run });
    return "menu";
  }
  if (clay && typeof clay.toastPersistent === "function") {
    clay.toastPersistent(NOTICE, "info", {
      actions: [
        { label: "Upgrade", onClick: run },
        { label: "Not now", onClick: () => dismiss(update.version) },
      ],
    });
    return "notice";
  }
  return null;
}

let started = false;

export async function start(options = {}) {
  if (started) return null;
  started = true;
  const clay = window.clay;
  // Toasts and the menu are drawn by satellites that may land after boot settles.
  await Promise.resolve(clay && clay.loaded && clay.loaded.ui).catch(() => {});
  const update = await findUpdate(options).catch(() => null);
  if (!update) return null;
  await announce(update);
  return update;
}

export async function replace(html, options) {
  const mod = await import("../core/save-replace.js");
  return mod.replace(html, options);
}

function onUpgradeRequested(event) {
  import("./upgrade-run.js")
    .then((mod) => mod.start(event.detail))
    .catch((err) => console.error("clayjs: the upgrade could not start:", err));
}

const bootClay = typeof window !== "undefined" ? window.clay : null;
if (bootClay && bootClay.canEdit && !bootClay.isDraftMode) {
  document.addEventListener("clay:upgrade-requested", onUpgradeRequested);
  const ready = bootClay.ready;
  if (ready && typeof ready.then === "function") ready.then(() => start(), () => {});
  else start();
}
