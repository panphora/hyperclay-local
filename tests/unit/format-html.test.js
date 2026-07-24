const formatHtml = require('../../src/main/format-html');

const doc = (root, body = '<div><p>hi</p></div>') =>
  `<!DOCTYPE html><html${root}><head><title>x</title></head><body>${body}</body></html>`;

describe('formatHtml (opt-in, root-anchored, jsdom-validated)', () => {
  const unchanged = [
    ['no attribute', doc('')],
    ['formathtml="false"', doc(' formathtml="false"')],
    ['any other value', doc(' formathtml="yes"')],
    ['value is case-sensitive: "TRUE" is not opt-in', doc(' formathtml="TRUE"')],
    ['empty value', doc(' formathtml=""')],
    ['bare attribute with no value', doc(' formathtml')],
    ['trailing space in the value', doc(' formathtml="true "')],
    ['NBSP is not attribute whitespace (value is "true\\u00A0")', doc(' formathtml=true\u00A0')],
    ['formathtml="true" on a non-root custom element', doc('', '<html-widget formathtml="true"></html-widget>')],
    ['decoy inside a body comment', doc('', '<!-- <html formathtml="true"> -->')],
    ['decoy in a comment before the root', '<!DOCTYPE html><!-- <html formathtml="true"> --><html><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['formathtml=true as a substring of another attribute value', '<html data-x="x formathtml=true"><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['single-quoted attribute value wrapping formathtml="true"', `<html data-note='x formathtml="true" y'><head><title>x</title></head><body><div><p>hi</p></div></body></html>`],
    ['entity-encoded value (read by literal value, not decoded)', '<html formathtml="tr&#117;e"><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['stray quote in a root attribute does not escape the tag (decoy on a child div)', '<html x=a"><head><title>x</title></head><body><div formathtml=true>hi"there</div></body></html>'],
    ['=formathtml is a single attribute named "=formathtml", not formathtml', '<html =formathtml=true><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['unterminated root tag (quote never closes) is dropped, not opt-in', "<html formathtml=true lang='><head><title>x</title></head><body><div><p>hi</p></div></body></html>"],
    ['content before the root is not a root opt-in', '<div><html formathtml="true"></html></div>'],
    ['duplicate formathtml: first occurrence wins (first is "false")', doc(' formathtml="false" formathtml="true"')],
    ['<htmlx> is a different element, not the root <html>', '<!DOCTYPE html><htmlx formathtml="true"><head><title>x</title></head><body><div><p>hi</p></div></body></htmlx>'],
    ['unquoted value: a trailing slash joins the value ("true/"), so not opt-in', '<!DOCTYPE html><html formathtml=true/><head><title>x</title></head><body><div><p>hi</p></div></body></html>']
  ];

  test.each(unchanged)('leaves bytes exactly as sent: %s', (_name, src) => {
    expect(formatHtml(src)).toBe(src);
  });

  const formatted = [
    ['root formathtml="true"', doc(' formathtml="true"')],
    ['single-quoted true', doc(" formathtml='true'")],
    ['unquoted true', doc(' formathtml=true')],
    ['attribute name is case-insensitive', doc(' FORMATHTML="true"')],
    ['finds formathtml after an earlier attribute value containing ">"', doc(' data-rule="x > y" formathtml="true"')],
    ['a bare attribute before formathtml="true"', doc(' data formathtml="true"')],
    ['real opt-in after a pre-root comment decoy', '<!DOCTYPE html><!-- <html> --><html formathtml="true"><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['duplicate formathtml: first occurrence wins (first is "true")', doc(' formathtml="true" formathtml="false"')],
    ['BOM before the document still finds the root opt-in', '\uFEFF' + doc(' formathtml="true"')],
    ['a TAB separates attributes just like a space', '<!DOCTYPE html><html\tformathtml="true"><head><title>x</title></head><body><div><p>hi</p></div></body></html>']
  ];

  test.each(formatted)('reformats: %s', (_name, src) => {
    expect(formatHtml(src)).not.toBe(src);
  });

  test('does not catastrophically backtrack on malformed unclosed input', () => {
    const evil = '<html ' + '"a'.repeat(80000);
    const start = Date.now();
    const out = formatHtml(evil);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out).toBe(evil);
  });

  test('stays linear on a comment that never closes', () => {
    const evil = '<!--' + '-'.repeat(500000);
    const start = Date.now();
    const out = formatHtml(evil);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out).toBe(evil);
  });
});
