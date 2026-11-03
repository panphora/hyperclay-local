const { stripCopyContent, stripCopyBytes } = require('../../src/main/copy-content');
const cases = require('../fixtures/copy-content.json');

describe('stripping the copy-only content out of a document', () => {
  test.each(['no&#45;copy', 'n&#111;-copy', 'no&#45;copy-unless:paid&#45;forms'])('removes entity-encoded %s markers', token => {
    const html = `<body><script clay="${token}" src="https://signal.hyperclay.com/v1.js"></script><p>Keep</p></body>`;
    expect(stripCopyContent(html)).toBe('<body><p>Keep</p></body>');
    expect(stripCopyBytes(Buffer.from(html))).toEqual(Buffer.from('<body><p>Keep</p></body>'));
  });

  test('the fixture holds every agreed case', () => {
    expect(cases.length).toBe(18);
  });

  for (const item of cases) {
    test(item.name, () => {
      expect(stripCopyContent(item.input)).toBe(item.expected);
    });
  }

  test('a document with no marker is the same string, not a copy', () => {
    const html = '<body><p>Hello</p></body>';
    expect(stripCopyContent(html)).toBe(html);
  });

  test('an implicit list item end goes with the marked item, not with the next one', () => {
    const html = '<body>\n  <ul>\n    <li clay="no-copy">Promo\n    <li>Keep</li>\n  </ul>\n</body>\n';
    expect(stripCopyContent(html)).toBe('<body>\n  <ul><li>Keep</li>\n  </ul>\n</body>\n');
  });

  test('an implicit paragraph end goes with the marked element, and the open paragraph stays', () => {
    const html = '<body>\n  <p>Paragraph\n  <div clay="no-copy">Promo</div>\n  <p>Second\n</body>\n';
    expect(stripCopyContent(html)).toBe('<body>\n  <p>Paragraph\n  <p>Second\n</body>\n');
  });

  test('templates are traversed, nested ones included', () => {
    const html = '<body>\n  <template id="row">\n    <div class="card" clay="no-copy">\n' +
      '      <script>window.tracker={id:7};</script>\n    </div>\n    <template>\n' +
      '      <span clay="no-copy-unless:paid-forms">Paid</span>\n    </template>\n' +
      '    <p>Keep \u00e9\u4e2d\ud83c\udf89</p>\n  </template>\n</body>\n';
    expect(stripCopyContent(html)).toBe('<body>\n  <template id="row">\n    <template>\n    </template>\n' +
      '    <p>Keep \u00e9\u4e2d\ud83c\udf89</p>\n  </template>\n</body>\n');
  });
});

describe('stripping the copy-only content out of document bytes', () => {
  const bytes = text => Buffer.from(text, 'utf8');

  test('a document with no marker is the very same buffer', () => {
    const original = bytes('<body><p>Hello</p></body>');
    expect(stripCopyBytes(original)).toBe(original);
  });

  test('unicode around the ranges round-trips as the expected document', () => {
    const item = cases.find(entry => entry.name === 'unicode-before-and-around-ranges');
    expect(stripCopyBytes(bytes(item.input))).toEqual(bytes(item.expected));
  });

  test('crlf line endings round-trip as the expected document', () => {
    const item = cases.find(entry => entry.name === 'crlf-line-endings');
    expect(stripCopyBytes(bytes(item.input))).toEqual(bytes(item.expected));
  });

  test('a marked document that is not valid UTF-8 keeps every outside byte', () => {
    const before = Buffer.from([0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0x0a, 0x20, 0x20]);
    const invalid = Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0x80]);
    const marked = bytes('\n  <div clay="no-copy">Promo</div>\n  <p>Keep</p>\n</body>\n');
    const out = stripCopyBytes(Buffer.concat([before, invalid, marked]));
    expect(out).toEqual(Buffer.concat([before, invalid, bytes('\n  <p>Keep</p>\n</body>\n')]));
    expect(out.includes(invalid)).toBe(true);
  });

  test('an unmarked document that is not valid UTF-8 is returned untouched', () => {
    const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('no copy here')]);
    expect(stripCopyBytes(original)).toBe(original);
  });
});
