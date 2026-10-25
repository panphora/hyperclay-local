import { parse } from "../../vendor/parse5.vendor.js";
import {
  canonicalizeRuntimeURL,
  parseRuntimeURL,
  resolveRuntimeURL,
} from "../../lib/offline-runtime.js";

export { canonicalizeRuntimeURL, parseRuntimeURL, resolveRuntimeURL };

export const DESCRIPTOR_ID = "clay-runtime-map";

const RUNTIME_REL = new Set(["stylesheet", "preload", "modulepreload"]);

function attributeOf(node, name) {
  for (const attr of node.attrs ?? []) {
    if (attr.name === name) return attr;
  }
  return null;
}

function isCandidate(node) {
  if (node.tagName === "script") return Boolean(attributeOf(node, "src"));
  if (node.tagName !== "link") return false;
  if (!attributeOf(node, "href")) return false;
  const rel = String(attributeOf(node, "rel")?.value ?? "").toLowerCase();
  return rel.split(/\s+/).some((token) => RUNTIME_REL.has(token));
}

function valueBounds(raw) {
  const eq = raw.indexOf("=");
  if (eq < 0) return null;
  let index = eq + 1;
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  const quote = raw[index] === '"' || raw[index] === "'" ? raw[index] : "";
  if (!quote) return { start: index, end: raw.length };
  const close = raw.lastIndexOf(quote);
  return { start: index + 1, end: close > index ? close : raw.length };
}

function elements(doc) {
  const found = [];
  const walk = (node) => {
    if (node.tagName) found.push(node);
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(doc);
  return found;
}

function candidates(doc, html) {
  const found = [];
  for (const node of elements(doc)) {
    if (!isCandidate(node)) continue;
    const name = node.tagName === "script" ? "src" : "href";
    const location = node.sourceCodeLocation?.attrs?.[name];
    if (!location) continue;
    const bounds = valueBounds(html.slice(location.startOffset, location.endOffset));
    if (!bounds) continue;
    found.push({
      node,
      value: attributeOf(node, name).value,
      raw: html.slice(location.startOffset + bounds.start, location.startOffset + bounds.end),
      valueStart: location.startOffset + bounds.start,
      valueEnd: location.startOffset + bounds.end,
      startOffset: node.sourceCodeLocation.startTag?.startOffset ?? node.sourceCodeLocation.startOffset,
    });
  }
  return found;
}

function applySplices(html, splices) {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  let out = html;
  for (const splice of ordered) {
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  }
  return out;
}

function descriptorTag(version, entries, aliases) {
  const descriptor = { schema: 1, version, entries };
  if (aliases) descriptor.aliases = aliases;
  const json = JSON.stringify(descriptor).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${DESCRIPTOR_ID}" clay="no-save no-watch no-snapshot">${json}</script>`;
}

export function projectRuntimeHTML(html, { releases, selectedVersion, documentURL } = {}) {
  const nodes = candidates(parse(html, { sourceCodeLocationInfo: true }), html);
  const resolved = nodes.map((node) => ({
    node,
    result: resolveRuntimeURL(node.value, { releases, selectedVersion, documentURL }),
  }));

  const versions = new Set();
  let missing = false;
  for (const { result } of resolved) {
    if (!result) continue;
    if (result.available === false) missing = true;
    versions.add(result.version);
  }
  if (missing || versions.size > 1) {
    return {
      html,
      mappings: [],
      skipped: [],
      unavailable: {
        reason: missing ? "release-missing" : "mixed-versions",
        versions: [...versions].sort(),
      },
    };
  }

  const mappings = [];
  const skipped = [];
  const splices = [];
  const aliases = {};
  const version = versions.size === 1 ? [...versions][0] : null;
  let insertAt = null;

  for (const { node, result } of resolved) {
    if (!result) continue;
    if (node.raw !== node.value) {
      skipped.push({ value: node.value, reason: "encoded" });
      continue;
    }
    splices.push({ start: node.valueStart, end: node.valueEnd, text: result.localURL });
    mappings.push({ original: node.value, local: result.localURL });
    if (result.kind === "alias") aliases[node.value] = result.path;
    if (insertAt === null) insertAt = node.startOffset;
  }

  if (!mappings.length) return { html, mappings, skipped, unavailable: null };

  const aliasMap = Object.keys(aliases).length ? aliases : null;
  splices.push({ start: insertAt, end: insertAt, text: descriptorTag(version, mappings, aliasMap) });
  return { html: applySplices(html, splices), mappings, skipped, unavailable: null };
}

function descriptorSpan(node) {
  const location = node.sourceCodeLocation;
  if (!location) return null;
  const start = location.startTag?.startOffset ?? location.startOffset;
  const end = location.endTag ? location.endTag.endOffset : location.endOffset;
  return { start, end };
}

function descriptorText(html, node) {
  const location = node.sourceCodeLocation;
  if (!location) return "";
  const start = location.startTag?.endOffset ?? location.startOffset;
  const end = location.endTag ? location.endTag.startOffset : location.endOffset;
  return html.slice(start, end);
}

export function canonicalizeRuntimeHTML(html, { releases, documentURL } = {}) {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const nodes = candidates(doc, html);
  const splices = [];
  let descriptor = null;
  let descriptorRemoved = false;

  for (const node of elements(doc)) {
    if (node.tagName !== "script" || attributeOf(node, "id")?.value !== DESCRIPTOR_ID) continue;
    const span = descriptorSpan(node);
    if (!span) continue;
    if (!descriptorRemoved) {
      try {
        descriptor = JSON.parse(descriptorText(html, node));
      } catch {
        descriptor = null;
      }
    }
    descriptorRemoved = true;
    splices.push({ start: span.start, end: span.end, text: "" });
  }

  let changed = 0;
  for (const node of nodes) {
    const parsed = parseRuntimeURL(node.value, { documentURL });
    if (!parsed || parsed.kind !== "local") continue;
    const replacement = canonicalizeRuntimeURL(node.value, { descriptor, releases, documentURL });
    if (replacement === node.value) continue;
    splices.push({ start: node.valueStart, end: node.valueEnd, text: replacement });
    changed += 1;
  }

  return { html: applySplices(html, splices), changed, descriptorRemoved };
}
