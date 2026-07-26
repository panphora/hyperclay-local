const formatHtml = require('../../src/main/format-html');
const { formatHtmlDetailed, hasHtmlRoot } = formatHtml;

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
    ['a TAB separates attributes just like a space', '<!DOCTYPE html><html\tformathtml="true"><head><title>x</title></head><body><div><p>hi</p></div></body></html>'],
    ['a realistic page nested 30 deep with real content still formats', '<!DOCTYPE html><html formathtml="true"><head><title>x</title></head><body>' + '<div class="wrapper layout">'.repeat(30) + '<p>Some actual sentence of body copy here.</p><a href="/link">a link</a>'.repeat(6) + '</div>'.repeat(30) + '</body></html>']
  ];

  test.each(formatted)('reformats: %s', (_name, src) => {
    expect(formatHtml(src)).not.toBe(src);
  });

  const guarded = [
    ['nesting deeper than the depth ceiling', '<html formathtml="true"><body>' + '<div>'.repeat(300) + 'x' + '</div>'.repeat(300) + '</body></html>'],
    ['degenerate near-empty nesting grows past 3x', '<html formathtml="true"><body>' + '<div>'.repeat(100) + 'x' + '</div>'.repeat(100) + '</body></html>'],
    ['deep nesting with many leaves would amplify output', '<html formathtml="true"><body>' + '<div>'.repeat(250) + '<p>x</p>'.repeat(500) + '</div>'.repeat(250) + '</body></html>']
  ];

  test.each(guarded)('opts in but is stored unformatted when formatting would blow up: %s', (_name, src) => {
    expect(formatHtml(src)).toBe(src);
  });

  test('does not spend unbounded time or memory on a deep hostile document', () => {
    const evil = '<html formathtml="true"><body>' + '<div>'.repeat(255) + '<p>x</p>'.repeat(400000) + '</div>'.repeat(255) + '</body></html>';
    const start = Date.now();
    const out = formatHtml(evil);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(out).toBe(evil);
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

describe('formatHtmlDetailed (decline reasons, attribute-aware size guard)', () => {
  const bigAttrs = (n) => Array.from({ length: n }, (_, i) => `z${i}`).join(' ');

  test('declined is null and the document is formatted when it opts in', () => {
    const src = doc(' formathtml="true"');
    const { output, declined } = formatHtmlDetailed(src);
    expect(declined).toBe(null);
    expect(output).not.toBe(src);
    expect(output).toBe(formatHtml(src));
  });

  test('declined is null and bytes are preserved when it never opts in', () => {
    const src = doc('');
    const { output, declined } = formatHtmlDetailed(src);
    expect(declined).toBe(null);
    expect(output).toBe(src);
  });

  test('declines with "depth" past the nesting ceiling, bytes preserved', () => {
    const src = '<html formathtml="true"><body>' + '<div>'.repeat(300) + 'x' + '</div>'.repeat(300) + '</body></html>';
    const { output, declined } = formatHtmlDetailed(src);
    expect(declined).toBe('depth');
    expect(output).toBe(src);
  });

  test('declines with "growth" when a small document merely expands past 3x', () => {
    const src = '<html formathtml="true"><body>' + '<div>'.repeat(100) + 'x' + '</div>'.repeat(100) + '</body></html>';
    const { output, declined } = formatHtmlDetailed(src);
    expect(declined).toBe('growth');
    expect(output).toBe(src);
  });

  // Regression: force-expand-multiline puts every attribute on its own line, so a SHALLOW
  // document (depth well under the ceiling) packed with many-attribute tags would still make
  // beautify allocate hundreds of MB and crash. The attribute-aware size pre-check must decline
  // it as "size" (not "growth" after the fact, not "depth") in bounded time, before beautify runs.
  test('declines a shallow attribute bomb with "size" before beautify runs', () => {
    const src = '<html formathtml="true"><body>' + '<div>'.repeat(200) + `<i ${bigAttrs(1500)}>x</i>`.repeat(1000) + '</div>'.repeat(200) + '</body></html>';
    const start = Date.now();
    const { output, declined } = formatHtmlDetailed(src);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(declined).toBe('size');
    expect(output).toBe(src);
  });

  // Regression: beautify re-indents each line of a formatted text node by depth*indent spaces,
  // so a deeply nested newline-heavy text node (depth just under the ceiling, NOT an attribute
  // bomb) would slip a per-tag/per-attribute-only projection and make beautify allocate 200MB+
  // or crash. The size pre-check must charge those newlines and decline "size" in bounded time.
  test('declines a deep newline-heavy text node with "size" before beautify runs', () => {
    const src = '<html formathtml="true">' + '<div>'.repeat(255) + 'x\n'.repeat(200000) + '</div>'.repeat(255) + '</html>';
    const start = Date.now();
    const { output, declined } = formatHtmlDetailed(src);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(declined).toBe('size');
    expect(output).toBe(src);
  });
});

// Deliberately NOT jsdom-differential the way formatOptIn above is. A real parser always
// synthesizes an implied <html> root, even for a truncated '<html', so jsdom would disagree on
// exactly the truncation case that hasHtmlRoot exists to refuse.
describe('hasHtmlRoot (spec §4 save-body gate)', () => {
  const complete = [
    ['a normal document', doc('')],
    ['no doctype, bare <html>', '<html><head><title>x</title></head><body>hi</body></html>'],
    ['a BOM before the doctype', '\uFEFF' + doc('')],
    ['a comment before the root', '<!-- hello --><html><body>hi</body></html>'],
    ['a processing instruction before the root', '<?xml version="1.0"?><html><body>hi</body></html>'],
    ['uppercase <HTML>', '<!DOCTYPE html><HTML><BODY>hi</BODY></HTML>'],
    ['a self-closed root', '<html/>'],
    ['root attributes, including formathtml="false"', doc(' lang="en" formathtml="false"')]
  ];

  test.each(complete)('accepts: %s', (_name, src) => {
    expect(hasHtmlRoot(src)).toBe(true);
  });

  const refused = [
    ['an empty body', ''],
    ['whitespace only', '   '],
    ['a fragment', '<div>hi</div>'],
    ['a JSON body', '{"content":"x"}'],
    ['text before the root', 'hi<html><body>hi</body></html>'],
    ['<htmlx> is a different element', '<htmlx><body>hi</body></htmlx>'],
    ['an unterminated root tag', '<html'],
    ['a root tag whose quoted attribute never closes', '<html lang="en><body>hi</body></html>'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}]
  ];

  test.each(refused)('refuses: %s', (_name, src) => {
    expect(hasHtmlRoot(src)).toBe(false);
  });
});
