/**
 * clay-router — URL-hash params as tab-local attributes.
 *
 *   #entry=e-7f3a&view=week
 *     → <html route-entry="e-7f3a" route-view="week">
 *     → route-active="entry" on the child of [route="entry"] whose data-id is e-7f3a
 *
 * show-when:route-view="week" and CSS on [route-active] do the rest. ClayJS core
 * treats route-* on the root and route-active anywhere as tab-local (root-attrs.js),
 * so none of this is saved, marked dirty, undone, or sent to a peer.
 */

const NAME = /^[a-z][a-z0-9-]*$/;
const PREFIX = "route-";
const ACTIVE = "route-active";
const SPEC = /^\s*([a-z][a-z0-9-]*)(?:\s+by\s+(\S+))?\s*$/;

let current = {};
let lastUnmatched = "";
let started = false;
let observer = null;
let queued = false;

/** Parse a hash into params. A hash with no "=" (a plain #anchor) carries none. */
export function parseHash(hash) {
  const params = Object.create(null);
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw.includes("=")) return params;
  for (const [name, value] of new URLSearchParams(raw)) {
    if (!NAME.test(name) || name === "active") {
      console.warn(`clay-router: ignoring hash param "${name}"; names are lowercase letters, digits and hyphens, and "active" is reserved`);
      continue;
    }
    if (value !== "") params[name] = value;
  }
  return params;
}

export function formatHash(params) {
  const sp = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value != null && value !== "") sp.set(name, String(value));
  }
  const s = sp.toString();
  return s ? "#" + s : "";
}

function mirrorRoot(params) {
  const root = document.documentElement;
  for (const attr of [...root.attributes]) {
    if (attr.name.startsWith(PREFIX) && !(attr.name.slice(PREFIX.length) in params)) root.removeAttribute(attr.name);
  }
  for (const [name, value] of Object.entries(params)) {
    if (root.getAttribute(PREFIX + name) !== value) root.setAttribute(PREFIX + name, value);
  }
}

// Stamp the matching child of every [route] container; return the declared
// params that have a value but matched nothing.
function stamp(params) {
  const keep = new Set();
  const declared = new Set();
  const matched = new Set();
  for (const container of document.querySelectorAll("[route]")) {
    const m = SPEC.exec(container.getAttribute("route") || "");
    if (!m) continue;
    const [, name, by = "data-id"] = m;
    declared.add(name);
    const value = params[name];
    if (value == null) continue;
    for (const child of container.children) {
      if (child.getAttribute(by) !== value) continue;
      keep.add(child);
      matched.add(name);
      if (child.getAttribute(ACTIVE) !== name) child.setAttribute(ACTIVE, name);
    }
  }
  for (const el of document.querySelectorAll(`[${ACTIVE}]`)) {
    if (!keep.has(el)) el.removeAttribute(ACTIVE);
  }
  return [...declared].filter((name) => params[name] != null && !matched.has(name)).sort();
}

/** Re-read the hash and re-apply it. Writes only what differs; fires clay:route only on a change. */
export function apply() {
  const params = parseHash(location.hash);
  mirrorRoot(params);
  const unmatched = document.body ? stamp(params) : [];
  const previous = current;
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(params)])]
    .filter((name) => previous[name] !== params[name]);
  current = params;
  const unmatchedKey = unmatched.join(" ");
  if (!changed.length && unmatchedKey === lastUnmatched) return;
  lastUnmatched = unmatchedKey;
  document.dispatchEvent(new CustomEvent("clay:route", {
    detail: { params: { ...params }, previous: { ...previous }, changed, unmatched },
  }));
}

export function get() {
  return { ...current };
}

/**
 * Merge `patch` into the hash. null or "" removes a param. A push makes a history
 * entry, so Back undoes it; { replace: true } does not.
 */
export function set(patch, { replace = false } = {}) {
  const next = parseHash(location.hash);
  for (const [name, value] of Object.entries(patch || {})) {
    if (value == null || value === "") delete next[name];
    else next[name] = String(value);
  }
  const hash = formatHash(next);
  if (hash === (location.hash.includes("=") ? location.hash : "")) return;
  const bare = location.pathname + location.search;
  if (replace) {
    history.replaceState(history.state, "", bare + hash);
    apply();
  } else if (hash) {
    location.hash = hash;
  } else {
    history.pushState(history.state, "", bare);
    apply();
  }
}

function queueApply() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    apply();
  });
}

// A record added to or removed from a [route] container changes what matches,
// and so does a [route] container arriving whole.
function onChildList(records) {
  for (const r of records) {
    if (r.type !== "childList") continue;
    if (r.target.nodeType === 1 && r.target.hasAttribute("route")) { queueApply(); return; }
    for (const n of r.addedNodes) {
      if (n.nodeType === 1 && (n.hasAttribute("route") || n.querySelector("[route]"))) { queueApply(); return; }
    }
  }
}

function onDomReady() {
  apply();
  if (!observer && typeof MutationObserver === "function") {
    observer = new MutationObserver(onChildList);
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export function start() {
  if (started) return;
  started = true;
  mirrorRoot(parseHash(location.hash));
  window.addEventListener("hashchange", apply);
  document.addEventListener("clay:sync-applied", queueApply);
  document.addEventListener("clay:ready", queueApply);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onDomReady, { once: true });
  else onDomReady();
}

/** Tear down listeners and forget state. For tests. */
export function stop() {
  started = false;
  current = {};
  lastUnmatched = "";
  window.removeEventListener("hashchange", apply);
  document.removeEventListener("clay:sync-applied", queueApply);
  document.removeEventListener("clay:ready", queueApply);
  document.removeEventListener("DOMContentLoaded", onDomReady);
  if (observer) observer.disconnect();
  observer = null;
}

const route = { get, set, apply };

const clay = (window.clay = window.clay || {});
clay.route = route;
start();

export default route;
