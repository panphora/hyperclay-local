const crypto = require('crypto');

// The Malleable HTML File conditional contract (spec §6), as this host implements it.
// It is the third copy of these two functions: hyperclay has the ESM original at
// server-lib/spec-wire.js and htmlclay has a Go twin at internal/specwire. An etag is
// a promise made BETWEEN hosts — a document synced from hyperclay.com to this folder
// must produce the same stamp here — so the three are pinned to each other by tests
// that use vectors taken from hyperclay's own JS, not by shared code they cannot share.

// Spec §6: an `etag` stamps the bytes the host STORED, never the bytes it was sent.
// The two differ on every save here, because formatHtml reformats the document before
// it is written, so stamping the sent bytes would tell a client its disk holds
// something it does not, and its next If-Match would be refused for no reason.
//
// Takes a Buffer or a string. Callers reading from disk pass the Buffer: decoding
// first replaces every byte that is not valid UTF-8 with U+FFFD, and hashing that
// stamps something the file does not contain. A string is correct only where the
// string is what produced the bytes, as on the save path, where the same value is
// written and then stamped.
function documentEtag(storedHtml) {
  return crypto.createHash('sha256').update(storedHtml || '').digest('hex').substring(0, 16);
}

// Does an If-Match field value permit writing over these stored bytes?
//
// Our own clients and the conformance page send one bare stamp, but RFC 9110 §13.1.1
// spells the field as `*` or a comma-separated list of entity-tags, each optionally
// quoted and weak. A third-party client on a public spec that follows HTTP would
// otherwise get a 412 it could never explain. Weak tags count as matches, which is
// looser than the RFC's strong comparison and deliberate: our stamp is a digest of the
// exact stored bytes, so there is no weak form of it to confuse it with.
//
// Callers pass the stored bytes rather than a stamp, so `*` can be answered without
// inventing a second convention for "the document is empty" versus "there is no
// document". An empty or absent field value matches nothing, so a client that computed
// its stamp wrong is refused rather than quietly dropped back to last-write-wins.
function ifMatchSatisfied(fieldValue, storedBytes) {
  const stored = storedBytes || '';
  const field = String(fieldValue ?? '').trim();
  if (field === '*') return stored.length > 0;

  const current = documentEtag(stored);
  return field.split(',').some(entry => {
    const tag = entry.trim().replace(/^W\//i, '').replace(/^"(.*)"$/, '$1');
    return tag !== '' && tag === current;
  });
}

module.exports = { documentEtag, ifMatchSatisfied };
