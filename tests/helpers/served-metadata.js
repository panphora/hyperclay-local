// A document GET carries the stamp of the disk bytes it was built from as `documentetag`
// on the root element (spec §4 response metadata). That one attribute is therefore the
// only difference between a served document and the file on disk, and a test comparing
// the two has to take exactly it out.
//
// It is located by the root tag's own byte offsets and removed by slicing, not by a regex
// over the tag: a regex would also drop a `documentetag` the file itself carries, and it
// would stop at the first `>`, even one inside a quoted value. The scanner is the same one
// the save gate and the formatter use, so a test cannot disagree with the host about what
// the root is.
const { scanRootHtmlTag } = require('../../src/main/format-html');

const INJECTED = /^ documentetag="([^"]*)"/;

// latin1 is a byte view, so offsets located in it address the same bytes the host served.
// A string input (res.text) is left in its own coordinates.
const asText = (served) => (Buffer.isBuffer(served) ? served.toString('latin1') : String(served));

function locate(served) {
  const text = asText(served);
  const scan = text.startsWith('\xef\xbb\xbf') ? '   ' + text.slice(3) : text;
  const root = scanRootHtmlTag(scan);
  if (!root) return null;
  const match = INJECTED.exec(text.slice(root.start + 5, root.end));
  if (!match) return null;
  return { text, at: root.start + 5, length: match[0].length, value: match[1] };
}

// The stamp the response carried, or null when the response carried none.
function servedDocumentEtag(served) {
  const found = locate(served);
  return found ? found.value : null;
}

// The served body with that attribute — and nothing else — removed, in the same type it
// came in as.
function withoutInjectedDocumentEtag(served) {
  const found = locate(served);
  if (!found) return served;
  const out = found.text.slice(0, found.at) + found.text.slice(found.at + found.length);
  return Buffer.isBuffer(served) ? Buffer.from(out, 'latin1') : out;
}

module.exports = { servedDocumentEtag, withoutInjectedDocumentEtag };
