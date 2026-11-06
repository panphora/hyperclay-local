// The document format floor as the save wire carries it: the canonical
//   <meta name="clay-page-format" content="1">
// marker (absence is floor 0, a floor only rises) and the `X-Clay-Page-Format`
// capability header every page write declares. Core code because every save sends
// the header; what content needs which floor lives in `page/format-level.js`.

import { PAGE_FORMAT } from "./page-format-wire.js";
export { PAGE_FORMAT, PAGE_FORMAT_HEADER } from "./page-format-wire.js";
export const PAGE_FORMAT_META = "clay-page-format";
export const PAGE_FORMAT_EXTENSION = "page-format-v1";
export const PAGE_FORMAT_UPGRADE = "page-format-upgrade-required";

// Every helper here is a plain function with no top-level work, so a client that
// imports one of them carries only that one.
const level = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

const metaTag = (html) => /<meta\b[^>]*\bname\s*=\s*["']?clay-page-format["']?[^>]*>/i.exec(html);

// A capability as a request declares it: a missing or unreadable header is no
// capability at all, so it can never authorize a write.
export function formatCapability(value) {
  if (typeof value === "number") return level(value);
  if (typeof value !== "string" || !/^\s*\d+\s*$/.test(value)) return 0;
  return level(Number(value));
}

// The floor a document carries. Absent or unreadable metadata is floor 0.
export function pageFormatFloor(html) {
  if (typeof html !== "string") return 0;
  const tag = metaTag(html);
  if (!tag) return 0;
  const content = /\bcontent\s*=\s*["']?(\d+)/i.exec(tag[0]);
  return content ? level(Number(content[1])) : 0;
}

// The same document with its floor marker set to `floor`, or with every marker
// gone at 0. Canonical by construction, so it is idempotent: a document already
// at that floor comes back unchanged.
export function withPageFormatFloor(html, floor) {
  const want = level(floor);
  if (typeof html !== "string" || !want) return html;
  const tag = metaTag(html);
  if (tag && pageFormatFloor(tag[0]) === want) return html;
  const marker = `<meta name="${PAGE_FORMAT_META}" content="${want}">`;
  if (tag) return html.slice(0, tag.index) + marker + html.slice(tag.index + tag[0].length);
  const at = /<\/head\s*>/i.exec(html) || /<body\b/i.exec(html);
  return at ? html.slice(0, at.index) + marker + html.slice(at.index) : marker + html;
}

// The floor this tab last saw the document at. A save goes out with its capture
// repaired to this floor, so a capture taken before activation cannot drop the
// marker by omitting it.
let known = 0;
export const knownPageFormatFloor = () => known;
export function notePageFormatFloor(value) {
  known = Math.max(known, level(value));
  return known;
}
