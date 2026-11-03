const { parse } = require('parse5');

const PAID_ONLY = 'data-paid-only';
const CLAY = 'clay';
const NO_COPY = 'no-copy';
const CONDITIONAL_FORMS = 'no-copy-unless:paid-forms';
const CLAY_TOKENS = /[\t\n\f\r ]+/;

function attributeOf(node, name) {
  return node.attrs?.find(attr => attr.name === name)?.value ?? null;
}

function childrenOf(node) {
  return node.content ? [...(node.childNodes || []), node.content] : (node.childNodes || []);
}

function eachElement(node, visit) {
  visit(node);
  for (const child of childrenOf(node)) eachElement(child, visit);
}

function clayTokensOf(node) {
  return (attributeOf(node, CLAY) ?? '').split(CLAY_TOKENS);
}

// The marker is compared to a feature key exactly: no trim, no lowercase, so a typo, an empty
// value or `FORMS` strips nothing and the document stays paid, which is the direction that fails
// closed. `clay="no-copy-unless:paid-forms"` is the approved spelling of the same condition.
function paidMarkersOf(node) {
  const markers = [];
  const value = attributeOf(node, PAID_ONLY);
  if (value !== null) markers.push(value);
  if (clayTokensOf(node).includes(CONDITIONAL_FORMS)) markers.push('forms');
  return [...new Set(markers)];
}

function lastDescendantEnd(node) {
  let end = null;
  eachElement(node, entry => {
    const entryEnd = entry.sourceCodeLocation?.endOffset;
    if (typeof entryEnd === 'number' && entryEnd >= 0 && (end === null || entryEnd > end)) end = entryEnd;
  });
  return end;
}

function endOffsetFor(node) {
  const location = node.sourceCodeLocation;
  if (typeof location?.endOffset === 'number' && location.endOffset >= 0) return location.endOffset;
  const fallback = lastDescendantEnd(node) ?? location?.startTag?.endOffset ?? null;
  if (fallback === null) return null;
  console.warn(`[copy-content] <${node.tagName}> has no end offset; removing through ${fallback}`);
  return fallback;
}

function markedRanges(html, features, { copies = false } = {}) {
  const ranges = [];
  eachElement(parse(html, { sourceCodeLocationInfo: true }), node => {
    const markers = paidMarkersOf(node);
    const unconditional = copies && clayTokensOf(node).includes(NO_COPY);
    const conditional = features === null ? markers.length > 0 : markers.some(marker => features.includes(marker));
    if (!unconditional && !conditional) return;
    const start = node.sourceCodeLocation?.startOffset;
    const end = typeof start === 'number' ? endOffsetFor(node) : null;
    if (typeof start === 'number' && start >= 0 && end !== null && end > start) ranges.push({ start, end });
  });
  return ranges.filter((range, index) => !ranges.some((other, otherIndex) =>
    otherIndex !== index && other.start <= range.start && range.end <= other.end));
}

function leadingRunStart(html, start) {
  const newline = html.lastIndexOf('\n', start - 1);
  if (newline < 0 || /\S/.test(html.slice(newline + 1, start))) return start;
  return html[newline - 1] === '\r' ? newline - 1 : newline;
}

// Cut the ranges out of the original string, last range first, and never reserialize: a document
// is DOM-as-state with namespaced attributes, so a parse/serialize round trip would rewrite bytes
// nobody asked to change. The whitespace-only run in front of a range goes with it, so no blank
// line is left behind.
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

// A copy carries no copy-only analytics or promos: the exact `no-copy` token, and the paid marker
// when the copy is made in the default offline context, where every condition applies.
function stripCopyContent(html, features = null) {
  if (typeof html !== 'string' || !/clay|data-paid-only/i.test(html)) return html;
  return spliceRanges(html, markedRanges(html, features, { copies: true }));
}

// One byte per character, so every source offset parse5 reports is a byte offset and every byte
// outside a removed range round-trips exactly, including a document that is not valid UTF-8. The
// original buffer is returned untouched when nothing was marked.
function stripCopyBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) return bytes;
  const text = bytes.toString('latin1');
  const cleaned = stripCopyContent(text);
  return cleaned === text ? bytes : Buffer.from(cleaned, 'latin1');
}

module.exports = { stripCopyContent, stripCopyBytes };
