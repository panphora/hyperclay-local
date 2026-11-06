/**
 * like.js — a like button on any element, counted by the host.
 *
 *   <button like="post-1">♥</button>
 *   const result = await clay.like.toggle("post-1");   // { ok, on, count, error }
 *
 * Any element carrying `like` (its value names the item; an empty value falls back
 * to the element's `id`) toggles this visitor's like when clicked. The host finds
 * the items by reading the `like` attributes in the saved file, so an element starts
 * counting once the page is saved with it.
 *
 * Nothing the plugin draws is saved. The total goes in a `.like-count` span added
 * inside the element as `editor-ui`, and a liked element gets the tab-only word
 * `liked` (`[ephemeral~="liked"]`, Tailwind `ephemeral-liked:`). The visitor id and
 * which items this visitor liked live in memory, mirrored to `localStorage` when the
 * browser allows it.
 *
 * `clay:like` fires on the element after a successful toggle, with `{ item, on,
 * count }`; `clay:like-failed` fires when a toggle the visitor asked for failed with
 * a message. Cancel it to draw your own message instead of the toast. A host without
 * likes (a file opened from disk, HTML Clay) answers without counts, and the
 * elements stay inert.
 *
 * `toggle` never rejects, matching message and upload.
 */

const PATH = "/_/reactions";
const VISITOR_KEY = "clay-like-visitor";
const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
// A read that found nothing new is not repeated sooner than this.
const REFRESH_GAP_MS = 5000;

let counts = null;
// null until the host answers: true when it serves likes, false when it does not.
let supported = null;
let formToken = null;
let loading = null;
let loadedAt = 0;
let visitorId = null;
let liked = null;
const pending = new Set();

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function newVisitorId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function visitor() {
  if (visitorId) return visitorId;
  const stored = readStore(VISITOR_KEY);
  visitorId = stored && /^[A-Za-z0-9-]{16,64}$/.test(stored) ? stored : newVisitorId();
  if (visitorId !== stored) writeStore(VISITOR_KEY, visitorId);
  return visitorId;
}

const likedKey = () => `clay-liked:${location.pathname}`;

function likedItems() {
  if (!liked) {
    try { liked = new Set(JSON.parse(readStore(likedKey()) || "[]")); } catch { liked = new Set(); }
  }
  return liked;
}

function setLiked(item, on) {
  const items = likedItems();
  if (on) items.add(item);
  else items.delete(item);
  writeStore(likedKey(), JSON.stringify([...items]));
}

const itemOf = (el) => el.getAttribute("like") || el.id;

async function request(method, body) {
  let res;
  try {
    res = await fetch(PATH, {
      method,
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Document-URL": location.href },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    // A host without likes answers its HTML page at 200, or refuses the unknown path with a
    // plain 404 or 405 (HTML Clay, Hyperclay Local). Hyperclay's own refusals are JSON.
    if (res.ok || (method === "GET" && (res.status === 404 || res.status === 405))) {
      return { ok: false, unsupported: true, error: null };
    }
    return { ok: false, error: `The like couldn't be saved (${res.status}).` };
  }
  if (typeof data.formToken === "string") formToken = data.formToken;
  if (res.ok) return { ok: true, ...data };
  return { ok: false, code: data.code, error: data.error || data.msg || null };
}

function countSpan(el) {
  for (const child of el.children) {
    if (child.classList.contains("like-count") && child.getAttribute("clay") === "editor-ui") return child;
  }
  const span = document.createElement("span");
  span.className = "like-count";
  span.setAttribute("clay", "editor-ui");
  el.append(span);
  return span;
}

function paint() {
  if (!counts) return;
  const items = likedItems();
  for (const el of document.querySelectorAll("[like]")) {
    const item = itemOf(el);
    const count = counts[item]?.like;
    if (typeof count !== "number") continue;
    const span = countSpan(el);
    if (span.textContent !== String(count)) span.textContent = String(count);
    window.clay?.ephemeral?.toggle(el, "liked", items.has(item));
  }
}

/** Read the totals from the host and paint every `[like]` element. */
export function refresh() {
  if (!loading) {
    loading = request("GET")
      .then((result) => {
        if (result.unsupported) supported = false;
        else if (result.ok && result.counts) {
          supported = true;
          counts = result.counts;
          loadedAt = Date.now();
        }
        paint();
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

// An item the totals do not list yet: read again, but not on every click or mutation.
function refreshForMissing() {
  if (supported === false) return Promise.resolve();
  if (loading) return loading;
  if (counts && Date.now() - loadedAt < REFRESH_GAP_MS) return Promise.resolve();
  return refresh();
}

async function put(item, on) {
  const token = formToken;
  formToken = null;
  return request("PUT", { item, action: "like", visitor: visitor(), on, formToken: token });
}

async function attempt(item) {
  if (loading) await loading;
  if (!counts?.[item]) await refreshForMissing();
  if (supported === false || !counts?.[item]) return { ok: false, error: null };
  const on = !likedItems().has(item);
  let result = await put(item, on);
  // A spent or missing token: the refusal carried a fresh one, so try once more.
  if (result.code === "form-token") result = await put(item, on);
  if (!result.ok) return { ok: false, error: result.error };
  setLiked(item, on);
  if (counts?.[item]) counts[item].like = result.count;
  paint();
  return { ok: true, on, count: result.count, error: null };
}

/**
 * Toggle this visitor's like on one item.
 *
 * @param {string} item - the value of the element's `like` attribute
 * @returns {Promise<{ok: boolean, on?: boolean, count?: number, error: ?string}>}
 */
export async function toggle(item) {
  if (pending.has(item)) return { ok: false, error: null };
  pending.add(item);
  try {
    return await attempt(item);
  } catch {
    return { ok: false, error: "The like couldn't be saved. Try again." };
  } finally {
    pending.delete(item);
  }
}

async function onClick(event) {
  const el = event.target?.closest?.("[like]");
  if (!el || event.defaultPrevented || el.isContentEditable || supported === false) return;
  const item = itemOf(el);
  if (!item) return;
  event.preventDefault();
  const result = await toggle(item);
  if (result.ok) {
    el.dispatchEvent(new CustomEvent("clay:like", { bubbles: true, detail: { item, on: result.on, count: result.count } }));
    return;
  }
  if (!result.error) return;
  const failed = new CustomEvent("clay:like-failed", { bubbles: true, cancelable: true, detail: { item, error: result.error } });
  if (el.dispatchEvent(failed)) window.clay?.toast?.(result.error, "error");
}

function addedLikes(records) {
  const found = [];
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches("[like]")) found.push(node);
      found.push(...node.querySelectorAll("[like]"));
    }
  }
  return found;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onClick);
  // The loader's own helpers (clay.ephemeral, dom-ready) are reached at runtime, not
  // imported: a shared import would split a chunk out of the reader's boot.
  const start = () => {
    if (document.querySelector("[like]")) refresh();
    // An element added later (a new post, a live-sync merge) is painted on the next
    // frame, and an item the totals do not list yet triggers a fresh read.
    let queued = false;
    new MutationObserver((records) => {
      if (queued || supported === false) return;
      const added = addedLikes(records);
      if (!added.length) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (added.some((el) => !counts?.[itemOf(el)])) refreshForMissing();
        else paint();
      });
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const like = { toggle, refresh, counts: () => (counts ? structuredClone(counts) : null) };
export default like;
