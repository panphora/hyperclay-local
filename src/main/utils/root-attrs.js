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

const TOKEN_ATTRS = ['savetoken', 'htmlclaytoken'];

// Scoped to the opening <html> tag and nothing else. A global replace would reach into
// the body and edit a code sample that merely quotes the attribute.
const OPEN_HTML_TAG = /<html\b[^>]*>/i;
const attrPattern = (name) => new RegExp(`\\s+${name}=("[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');

/**
 * Remove the save token from a document's root element, under either spelling.
 *
 * @param {string} html
 * @returns {string} the same string when there was nothing to remove
 */
function stripSaveToken(html) {
  if (typeof html !== 'string') return html;
  return html.replace(OPEN_HTML_TAG, (tag) =>
    TOKEN_ATTRS.reduce((acc, name) => acc.replace(attrPattern(name), ''), tag)
  );
}

module.exports = { stripSaveToken, TOKEN_ATTRS };
