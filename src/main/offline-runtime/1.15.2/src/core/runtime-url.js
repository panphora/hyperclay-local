import { setCloneCanonicalizer } from "./snapshot.js";
import {
  LOCAL_PREFIX,
  canonicalizeRuntimeURL,
  parseRuntimeURL,
} from "../lib/offline-runtime.js";
import { RUNTIME_ALIASES } from "./runtime-aliases.js";

export const RUNTIME_MAP_ID = "clay-runtime-map";

const RUNTIME_REL = new Set(["stylesheet", "preload", "modulepreload"]);

let cachedText = null;
let cachedDescriptor = null;

function parseDescriptor(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || value.schema !== 1) return null;
  return value;
}

export function runtimeDescriptor() {
  if (typeof document === "undefined") return null;
  const element = document.getElementById(RUNTIME_MAP_ID);
  if (!element) return null;
  const text = element.textContent ?? "";
  if (text === cachedText) return cachedDescriptor;
  cachedText = text;
  cachedDescriptor = parseDescriptor(text);
  return cachedDescriptor;
}

const RUNTIME_SELECTOR = `script[src*="${LOCAL_PREFIX}"], link[href*="${LOCAL_PREFIX}"], #${RUNTIME_MAP_ID}`;

// Native selector first: this runs on every capture, dirty checks included, and almost every page
// has nothing to canonicalize.
function holdsRuntime(root) {
  if (root.querySelector(RUNTIME_SELECTOR)) return true;
  for (const template of root.querySelectorAll("template")) {
    if (holdsRuntime(template.content)) return true;
  }
  return false;
}

function elements(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    for (const child of node.children ?? []) {
      found.push(child);
      stack.push(child);
      if (child.content) stack.push(child.content);
    }
  }
  return found;
}

function candidateAttribute(element) {
  if (element.tagName === "SCRIPT" && element.hasAttribute("src")) return "src";
  if (element.tagName !== "LINK" || !element.hasAttribute("href")) return null;
  const rel = (element.getAttribute("rel") ?? "").toLowerCase();
  return rel.split(/\s+/).some((token) => RUNTIME_REL.has(token)) ? "href" : null;
}

export function canonicalizeRuntimeClone(clone) {
  if (!clone || !holdsRuntime(clone)) return;

  const candidates = [];
  let runtime = false;
  for (const element of elements(clone)) {
    if (element.getAttribute("id") === RUNTIME_MAP_ID) {
      element.remove();
      continue;
    }
    const name = candidateAttribute(element);
    if (!name) continue;
    candidates.push({ element, name });
    if (!runtime && (element.getAttribute(name) ?? "").includes(LOCAL_PREFIX)) runtime = true;
  }
  if (!runtime) return;

  const documentURL = location.href;
  const descriptor = runtimeDescriptor();
  for (const { element, name } of candidates) {
    const value = element.getAttribute(name);
    const parsed = parseRuntimeURL(value, { documentURL });
    if (!parsed || parsed.kind !== "local") continue;
    element.setAttribute(name, canonicalizeRuntimeURL(value, { descriptor, documentURL, aliases: RUNTIME_ALIASES }));
  }
}

setCloneCanonicalizer(canonicalizeRuntimeClone);
