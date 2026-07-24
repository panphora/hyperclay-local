const formatHtml = require('../../src/main/format-html');

const build = (attr, body = '<div><p>hi</p></div>') =>
  `<!DOCTYPE html><html${attr}><head><title>x</title></head><body>${body}</body></html>`;

describe('formatHtml (opt-in formatting)', () => {
  test('returns a document with no formathtml attribute unchanged (byte-identical)', () => {
    const src = build('');
    expect(formatHtml(src)).toBe(src);
  });

  test('formats a document whose root carries formathtml="true"', () => {
    const src = build(' formathtml="true"');
    expect(formatHtml(src)).not.toBe(src);
  });

  test('returns formathtml="false" unchanged', () => {
    const src = build(' formathtml="false"');
    expect(formatHtml(src)).toBe(src);
  });

  test('returns any other value unchanged (read by value, not presence)', () => {
    const src = build(' formathtml="yes"');
    expect(formatHtml(src)).toBe(src);
  });

  test('accepts single quotes: formathtml=\'true\' is formatted', () => {
    const src = build(" formathtml='true'");
    expect(formatHtml(src)).not.toBe(src);
  });

  test('accepts an unquoted value: formathtml=true is formatted', () => {
    const src = build(' formathtml=true');
    expect(formatHtml(src)).not.toBe(src);
  });

  test('reads the value case-sensitively: formathtml="TRUE" is not opt-in', () => {
    const src = build(' formathtml="TRUE"');
    expect(formatHtml(src)).toBe(src);
  });

  test('ignores formathtml="true" on a non-root element (custom element in the body)', () => {
    const src = build('', '<html-widget formathtml="true"></html-widget>');
    expect(formatHtml(src)).toBe(src);
  });

  test('ignores a formathtml="true" decoy inside a body comment', () => {
    const src = build('', '<!-- <html formathtml="true"> -->');
    expect(formatHtml(src)).toBe(src);
  });

  test('finds formathtml after an earlier attribute value containing ">"', () => {
    const src = build(' data-rule="x > y" formathtml="true"');
    expect(formatHtml(src)).not.toBe(src);
  });
});
