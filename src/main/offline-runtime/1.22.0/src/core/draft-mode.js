const SLOT = /^[A-Za-z0-9._-]{1,100}$/;
export const DRAFT_ATTR = "visitor-drafts";
export const DRAFT_PLUGIN = "visitor-drafts";

let requested = false;
let transport = null;
let storeFailed = false;

const listed = (params, key) =>
  (params?.get?.(key) || "").split(",").map((name) => name.trim()).includes(DRAFT_PLUGIN);

export function noteBootParams(params) {
  requested = listed(params, "plugins") && !listed(params, "exclude");
}

export function draftSlot(doc = document) {
  const value = doc.documentElement.getAttribute(DRAFT_ATTR);
  return value && SLOT.test(value) ? value : null;
}

let warnedRules = false;

function rulesReady(doc) {
  const tag = doc.querySelector('script[data-rules-name~="api"]');
  if (!tag) return false;
  const version = tag.getAttribute("data-rules-version");
  let problem = null;
  if (version !== "1") {
    problem = `the api rules tag says data-rules-version="${version ?? ""}" and this version reads version 1`;
  } else {
    try { JSON.parse(tag.textContent); } catch { problem = "the api rules tag does not hold readable JSON"; }
  }
  if (!problem) return true;
  if (!warnedRules) {
    warnedRules = true;
    console.warn(`visitor-drafts: this page keeps no draft (${problem})`);
  }
  return false;
}

export function draftEligible(doc = document, loc = window.location) {
  return requested
    && (loc.protocol === "https:" || loc.protocol === "http:")
    && draftSlot(doc) !== null
    && rulesReady(doc);
}

export function setDraftTransport(fn) { transport = fn; }
export function draftTransport() { return transport; }
let flushHook = null;
export function setDraftFlush(fn) { flushHook = fn; }
export function flushDraft() {
  if (!flushHook) return true;
  try { return flushHook() !== false; } catch { return false; }
}
export function setDraftStoreFailed(value) { storeFailed = Boolean(value); }
export function draftStoreFailed() { return storeFailed; }
