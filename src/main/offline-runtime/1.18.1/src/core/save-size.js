/**
 * save-size.js — how large a save's exact bytes are, and the host's own ceiling (§9).
 *
 * `document.maxBytes` in discovery is the one place a host states what it will store:
 * the maximum uncompressed UTF-8 size of the HTML save body, inclusive. Only a
 * positive safe integer is an answer; missing, zero, negative, fractional and
 * nonnumeric all mean "unknown". Unknown refuses nothing: the save goes out and the
 * server stays authoritative. Nothing here guesses a ceiling from a hostname,
 * compression or a browser storage quota, and `document.upload.maxBytes` is a
 * different promise about different bytes.
 */

import { hostMeta } from "./host-meta.js";

// The limit the last discovery answer announced. Memoized beside `hostMeta`'s own
// memoized promise, because a save reads it synchronously: the request a person feels
// is the save, and holding it for a discovery round trip would make a first save wait
// out a timeout on a host that has no `/_/meta` at all. Until an answer lands the
// limit is unknown, which is the honest reading and refuses nothing.
let limit = null;
let measures = null;
let asked = null;

function advertised(meta) {
  const value = meta?.document?.maxBytes;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function adopt(meta) {
  limit = advertised(meta);
  measures = meta?.document?.maxBytesMeasures === 'file' ? 'file' : null;
  return limit;
}

// A Document's live state rides in one <script merge="page"> tag that Hyperclay
// stores apart from the file, and its limit (`maxBytesMeasures: 'file'`) is judged on
// the body without that tag, the way the host's splitPage() cuts it: the whole line
// when the tag stands alone on it, otherwise the tag itself. Where the host would not
// split (no tag, two tags), the cut here can only make the count smaller, so the
// host's own 413 stays the answer and nothing is refused that the host would store.
const PAGE_TAG = /<script\b[^>]*\bmerge=(["'])page\1[^>]*>[\s\S]*?<\/script\s*>/i;

export function storedFile(html, measure = measures) {
  if (measure !== 'file' || typeof html !== 'string') return html;
  const match = PAGE_TAG.exec(html);
  if (!match) return html;
  let start = match.index;
  let end = start + match[0].length;
  const from = html.lastIndexOf('\n', start - 1) + 1;
  const newline = html.indexOf('\n', end);
  const to = newline === -1 ? html.length : newline + 1;
  if (!/\S/.test(html.slice(from, start)) && !/\S/.test(html.slice(end, to))) { start = from; end = to; }
  return html.slice(0, start) + html.slice(end);
}

/**
 * How big these exact bytes are, against a limit that may not be known.
 *
 * @param {string} html - the bytes a save would send
 * @param {number} [maxBytes] - the host's advertised ceiling, if it advertised one
 * @returns {{bytes: number, maxBytes: ?number, state: 'unknown'|'ok'|'near'|'over'}}
 */
export function saveSize(html, maxBytes) {
  const bytes = new TextEncoder().encode(html).byteLength;
  const known = Number.isSafeInteger(maxBytes) && maxBytes > 0;
  return {
    bytes, maxBytes: known ? maxBytes : null,
    state: !known ? 'unknown' : bytes > maxBytes ? 'over' :
      bytes >= Math.ceil(maxBytes * 0.8) ? 'near' : 'ok'
  };
}

/**
 * The limit the last discovery answer advertised, without asking the host.
 *
 * @returns {?number}
 */
export function knownSaveLimit() {
  return limit;
}

/**
 * Ask the host what it accepts, once per page.
 *
 * Joins the memoized discovery answer, so this never costs a second request. `fresh`
 * asks again, for a caller that wants the ceiling as it stands now.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fresh]
 * @returns {Promise<?number>} the advertised limit, or null when it announced none
 */
export function saveLimit({ fresh = false } = {}) {
  if (fresh) {
    asked = hostMeta({ fresh: true }).then(adopt);
    return asked;
  }
  if (!asked) asked = hostMeta().then(adopt);
  return asked;
}

/**
 * `clay.save.limits`: the host's save ceiling, and whether it said one at all.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fresh]
 * @returns {Promise<{maxBytes: ?number}>}
 */
export function saveLimits({ fresh = false } = {}) {
  return saveLimit({ fresh }).then((maxBytes) => ({ maxBytes }));
}

/**
 * `clay.save.inspect`: measure bytes that are not this page's document.
 *
 * No capture, no send, no baseline, no save claim, and nothing said to anybody about
 * what this page currently holds: an import preview asks about candidate bytes.
 *
 * @param {string} html
 * @returns {Promise<{bytes: number, maxBytes: ?number, state: string}>}
 */
export async function inspectSaveSize(html) {
  const maxBytes = await saveLimit();
  return saveSize(storedFile(html), maxBytes);
}

/**
 * Say what the last real save attempt measured, on the document.
 *
 * @param {{bytes: number, maxBytes: ?number, state: string}} size
 */
export function announceSaveSize(size) {
  const event = new CustomEvent('clay:save-size', { detail: size });
  document.dispatchEvent(event);
  // The notice is fetched only by a measurement near or over the ceiling, so most edit
  // boots never download it; once loaded it listens for itself, and this replay of the
  // event that fetched it only redraws in place.
  if (size.state === 'near' || size.state === 'over') {
    import('./save-size-notice.js').then((notice) => notice.start(event), () => {});
  }
}
