const { documentEtag, ifMatchSatisfied } = require('../../src/main/spec-wire.js');

// The expected stamps below were produced by running hyperclay's own
// server-lib/spec-wire.js documentEtag over these exact inputs, and are the same
// table htmlclay's Go twin is pinned to (internal/specwire/specwire_test.go). That
// is what makes this a three-host agreement test rather than a restatement of the
// code under test: if any host changes how a stamp is computed, one of the three
// fails.
//
// It matters because an etag is a promise BETWEEN hosts, and this host in
// particular receives documents from the other two: a file synced down from
// hyperclay.com carries the stamp the browser saw there, and if this process
// computes a different one, the first conditional save after the sync is refused
// with a conflict nobody can explain and no retry can clear.
const VECTORS = [
  ['', 'e3b0c44298fc1c14'],
  ['<html></html>', 'b633a587c652d023'],
  ['<!DOCTYPE html><html lang="en"><body>hi</body></html>', 'af7bce6cbe4ad9d2'],
  ['a', 'ca978112ca1bbdca'],
  ['ünïcödé ✅', '19b726abb86d3027'],
  ['<html>\n\ttabs and newlines\n</html>', '23be88e6982ef0fa']
];

describe('documentEtag agrees with the other two hosts', () => {
  test.each(VECTORS)('%p stamps as the value hyperclay computes', (input, want) => {
    expect(documentEtag(input)).toBe(want);
  });

  test('a stamp is sixteen lowercase hex characters', () => {
    expect(documentEtag('anything')).toMatch(/^[0-9a-f]{16}$/);
  });

  // An empty document has a stamp like any other. It is NOT the same as having no
  // document, which is why `*` gets its own rule below rather than being answered
  // by comparing stamps.
  test('an absent body stamps as the empty document', () => {
    expect(documentEtag(null)).toBe(documentEtag(''));
    expect(documentEtag(undefined)).toBe(documentEtag(''));
  });
});

describe('ifMatchSatisfied follows RFC 9110 §13.1.1', () => {
  const stored = '<html>current</html>';
  const tag = documentEtag(stored);

  test('the current bare stamp matches', () => {
    expect(ifMatchSatisfied(tag, stored)).toBe(true);
  });

  test('a stale stamp does not', () => {
    expect(ifMatchSatisfied(documentEtag('<html>old</html>'), stored)).toBe(false);
  });

  test('the stamp may be quoted', () => {
    expect(ifMatchSatisfied(`"${tag}"`, stored)).toBe(true);
  });

  // Looser than the RFC's strong comparison, and deliberate: our stamp is a digest
  // of the exact stored bytes, so there is no weak form of it to confuse it with.
  test('a weak prefix is accepted, in either case', () => {
    expect(ifMatchSatisfied(`W/"${tag}"`, stored)).toBe(true);
    expect(ifMatchSatisfied(`w/${tag}`, stored)).toBe(true);
  });

  test('a list matches if any member does', () => {
    expect(ifMatchSatisfied(`"deadbeefdeadbeef", "${tag}"`, stored)).toBe(true);
    expect(ifMatchSatisfied('"deadbeefdeadbeef", "cafebabecafebabe"', stored)).toBe(false);
  });

  // `*` asks only that the document exist at all, which is why the function takes
  // the stored bytes rather than a stamp: there is no second convention needed for
  // "the document is empty" versus "there is no document".
  test('* requires a document to be there', () => {
    expect(ifMatchSatisfied('*', stored)).toBe(true);
    expect(ifMatchSatisfied('*', '')).toBe(false);
    expect(ifMatchSatisfied('*', null)).toBe(false);
  });

  // A client that computed its stamp wrong is refused, rather than quietly dropped
  // back to last-write-wins, which is the one outcome a conditional save exists to
  // prevent.
  test('an empty field value matches nothing', () => {
    expect(ifMatchSatisfied('', stored)).toBe(false);
    expect(ifMatchSatisfied('   ', stored)).toBe(false);
    expect(ifMatchSatisfied(',,', stored)).toBe(false);
    expect(ifMatchSatisfied(null, stored)).toBe(false);
  });
});
