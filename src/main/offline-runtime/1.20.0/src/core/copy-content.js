// Copy-only content: marked regions that stay in the file, in normal saves, in snapshots
// and in recovery storage, and are removed only from the bytes of a copy someone asks for.
// The removal is a splice on the original string using parse5's source offsets, so every
// byte outside a removed range survives, templates and implicit end tags included.

import { parse } from "../vendor/parse5.vendor.js";

const CLAY = "clay";
const PAID_ONLY = "data-paid-only";
const NO_COPY = "no-copy";
const CONDITIONAL_FORMS = "no-copy-unless:paid-forms";
const CLAY_TOKENS = /[\t\n\f\r ]+/;

function attributeOf(node, name) {
  return node.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

function childrenOf(node) {
  return node.content ? [...(node.childNodes || []), node.content] : (node.childNodes || []);
}

function eachElement(node, visit) {
  visit(node);
  for (const child of childrenOf(node)) eachElement(child, visit);
}

function clayTokensOf(node) {
  return (attributeOf(node, CLAY) ?? "").split(CLAY_TOKENS);
}

// The marker is compared to a feature key exactly: no trim, no lowercase, so a typo, an
// empty value or `FORMS` strips nothing and the content stays, which is the direction
// that fails closed. `clay="no-copy-unless:paid-forms"` is the approved spelling of the
// same condition.
function paidMarkersOf(node) {
  const markers = [];
  const value = attributeOf(node, PAID_ONLY);
  if (value !== null) markers.push(value);
  if (clayTokensOf(node).includes(CONDITIONAL_FORMS)) markers.push("forms");
  return [...new Set(markers)];
}

function lastDescendantEnd(node) {
  let end = null;
  eachElement(node, (entry) => {
    const entryEnd = entry.sourceCodeLocation?.endOffset;
    if (typeof entryEnd === "number" && entryEnd >= 0 && (end === null || entryEnd > end)) end = entryEnd;
  });
  return end;
}

function endOffsetFor(node) {
  const location = node.sourceCodeLocation;
  if (typeof location?.endOffset === "number" && location.endOffset >= 0) return location.endOffset;
  const fallback = lastDescendantEnd(node) ?? location?.startTag?.endOffset ?? null;
  if (fallback === null) return null;
  console.warn(`clayjs: <${node.tagName}> has no end offset; removing through ${fallback}`);
  return fallback;
}

function markedRanges(html, features) {
  const ranges = [];
  eachElement(parse(html, { sourceCodeLocationInfo: true }), (node) => {
    const markers = paidMarkersOf(node);
    const unconditional = clayTokensOf(node).includes(NO_COPY);
    const conditional = features === null ? markers.length > 0 : markers.some((marker) => features.includes(marker));
    if (!unconditional && !conditional) return;
    const start = node.sourceCodeLocation?.startOffset;
    const end = typeof start === "number" ? endOffsetFor(node) : null;
    if (typeof start === "number" && start >= 0 && end !== null && end > start) ranges.push({ start, end });
  });
  return ranges.filter((range, index) => !ranges.some((other, otherIndex) =>
    otherIndex !== index && other.start <= range.start && range.end <= other.end));
}

function leadingRunStart(html, start) {
  const newline = html.lastIndexOf("\n", start - 1);
  if (newline < 0 || /\S/.test(html.slice(newline + 1, start))) return start;
  return html[newline - 1] === "\r" ? newline - 1 : newline;
}

function spliceRanges(html, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let stripped = html;
  let limit = html.length;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const { start, end } = sorted[index];
    if (end > limit) continue;
    const from = leadingRunStart(html, start);
    if (from >= end) continue;
    stripped = stripped.slice(0, from) + stripped.slice(end);
    limit = from;
  }
  return stripped;
}

// `features` decides the conditional regions: null (the default, and the offline
// destination) strips every one of them, while a list strips only the missing features
// it names. Unconditional `no-copy` content always goes.
export function stripCopyContent(html, features = null) {
  if (typeof html !== "string" || !/clay|data-paid-only/i.test(html)) return html;
  return spliceRanges(html, markedRanges(html, features));
}
