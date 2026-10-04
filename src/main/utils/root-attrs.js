'use strict';

// Spec §9: the save token is EPHEMERAL. A host injects it into the response and takes
// it back out of whatever the client returns, so it never reaches a person's file.
//
// This host injects no token of its own, which is exactly why it needs this. A document
// that has ever been served by a host that does inject one carries the attribute in the
// bytes a browser sends back, and with nothing removing it, the first save writes a
// credential into the file permanently. From then on every host serving that file looks,
// to a current client, like an out-of-date HTML Clay: clayjs reads a document carrying
// only the pre-rename spelling as a stale host, turns edit mode off and puts a notice on
// the page naming a product that is not running.
//
// Both spellings, forever. `htmlclaytoken` is the pre-rename name and a document saved
// under it goes on circulating for years with no update able to reach it, so a strip that
// knew only the current name would leave live credentials on disk.

const { scanRootHtmlTag } = require('../format-html');

const TOKEN_ATTRS = ['savetoken', 'htmlclaytoken'];

// This host's own response metadata, which is neither a credential nor document identity:
// `documentetag` carries the stamp of the disk bytes a document GET was built from, so a
// tab can tell whether the version it loaded is still the one on disk. It is
// response-scoped exactly like the token, so it leaves on the same paths and is never
// persisted — a stamp written to a file would stamp bytes that have since changed, and a
// relay would hand one tab an assertion about another tab's load.
const RESPONSE_ATTRS = ['documentetag'];

const EPHEMERAL_ATTRS = [...TOKEN_ATTRS, ...RESPONSE_ATTRS];

// One attribute of a start-tag, tokenized the way a browser does: the name runs to
// whitespace, `=`, `/` or the end of the tag, and the value is double-quoted,
// single-quoted or unquoted. Recognizing the whole attribute is what makes the strip
// safe: a `>` inside a quoted value does not end the tag, and `data-savetoken` is a
// different attribute than `savetoken` rather than a spelling of it.
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

// Remove the named attributes from the document's ROOT start-tag and nothing else. The
// root comes from the shared scan in format-html.js, so this edits the same tag the save
// gate and the formatter agree on, and the bytes before and after that tag are copied
// through untouched. A global replace would reach into the body and edit a code sample
// that merely quotes the attribute. The old whole-tag regex also ended the tag at the
// first `>`, even one inside a quoted value, so `data-rule="x > y" savetoken="…"` kept
// its token on disk.
function stripNames(html, names) {
  const root = scanRootHtmlTag(html);
  if (!root) return html;
  const attrs = html.slice(root.start + 5, root.end);
  const stripped = attrs.replace(ATTRIBUTE, (whole, name) =>
    (names.includes(name.toLowerCase()) ? '' : whole));
  return html.slice(0, root.start + 5) + stripped + html.slice(root.end);
}

/**
 * Remove the ephemeral root metadata — save tokens, and this host's own response stamp —
 * from a document a client sent back.
 *
 * The name is historical: a token was the only attribute here when it was written, and
 * every caller that must not persist response-scoped metadata (save, restore, relay)
 * already routes through it, so the stamp rides the same helper rather than drifting
 * beside it in a second stripper. Never a global body replace.
 *
 * @param {string} html
 * @returns {string} the same string when there was nothing to remove
 */
function stripSaveToken(html) {
  return typeof html === 'string' ? stripNames(html, EPHEMERAL_ATTRS) : html;
}

/**
 * Put the stamp of these exact bytes on the document's root element as `documentetag`,
 * replacing any value already there, and return what to serve.
 *
 * Bytes in, bytes out. Decoding the whole document as UTF-8 and re-encoding would rewrite
 * every byte that is not valid UTF-8, which is why serveHtml reads a Buffer in the first
 * place; latin1 is one code point per byte, so the tag can be located and sliced while
 * every byte outside the insertion point is copied by offset. A document with no complete
 * root <html> start-tag is returned exactly as it is: a client then falls back to its own
 * discovery, as it did before this attribute existed.
 *
 * @param {Buffer} bytes the bytes on disk, read once
 * @param {string} stamp the stamp of those same bytes, from documentEtag()
 * @returns {Buffer}
 */
function injectDocumentEtag(bytes, stamp) {
  const raw = bytes.toString('latin1');
  // The scan reads a UTF-8 BOM as a character rather than a byte, so the mark is
  // replaced by an equal-width run of spaces to keep every index in `raw`'s coordinates.
  const scan = raw.startsWith('\xef\xbb\xbf') ? '   ' + raw.slice(3) : raw;
  const root = scanRootHtmlTag(scan);
  if (!root) return bytes;
  const attrs = raw.slice(root.start + 5, root.end)
    .replace(ATTRIBUTE, (whole, name) => (RESPONSE_ATTRS.includes(name.toLowerCase()) ? '' : whole));
  const value = String(stamp).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return Buffer.concat([
    bytes.subarray(0, root.start + 5),
    Buffer.from(' documentetag="' + value + '"', 'ascii'),
    Buffer.from(attrs, 'latin1'),
    bytes.subarray(root.end)
  ]);
}

module.exports = { stripSaveToken, injectDocumentEtag, TOKEN_ATTRS, RESPONSE_ATTRS };
