const {
  readHelperNames,
  validHelperName,
  SCAN_LIMIT,
  MAX_NAMES,
} = require('../../src/main/helpers/declarations');

const meta = (content, name = 'htmlclay-helper') => `<meta name="${name}" content="${content}">`;
const read = (html) => readHelperNames(Buffer.from(html));

describe('readHelperNames', () => {
  test('reads declared names in document order', () => {
    expect(read(`<html><head>${meta('search')}${meta('ai-edit')}</head><body></body></html>`))
      .toEqual(['search', 'ai-edit']);
  });

  test('reads names written with uppercase attribute names', () => {
    expect(read('<head><meta NAME="htmlclay-helper" CONTENT="search"></head>')).toEqual(['search']);
  });

  test('reads a name declared twice once', () => {
    expect(read(`<head>${meta('search')}${meta('search')}</head>`)).toEqual(['search']);
  });

  test('stops at the eighth name', () => {
    expect(MAX_NAMES).toBe(8);

    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => meta(`n${i}`)).join('');
    const nine = eight + meta('n9');
    expect(read(`<head>${nine}</head>`)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
  });

  test('skips invalid names rather than stopping', () => {
    const junk = [
      meta(''),
      meta('Search'),
      meta('-search'),
      meta('search-'),
      meta('search two'),
      meta('a'.repeat(33)),
      meta('search_two'),
    ].join('');
    expect(read(`<head>${junk}${meta('ok-1')}</head>`)).toEqual(['ok-1']);
  });

  test('requires the name attribute to be exactly htmlclay-helper', () => {
    expect(read(`<head>${meta('search', 'HTMLCLAY-HELPER')}</head>`)).toEqual([]);
    expect(read(`<head>${meta('search', 'htmlclay-helper-x')}</head>`)).toEqual([]);
    expect(read(`<head>${meta('search', 'other')}</head>`)).toEqual([]);
  });

  test('stops at the body start tag', () => {
    expect(read(`${meta('search')}<body>${meta('ai-edit')}`)).toEqual(['search']);
  });

  test('stops at a non-head start tag', () => {
    expect(read(`<head>${meta('search')}<div>${meta('ai-edit')}</div></head>`)).toEqual(['search']);
    expect(read(`<head>${meta('search')}<p>${meta('ai-edit')}`)).toEqual(['search']);
  });

  test('stops at non-whitespace text and skips whitespace', () => {
    expect(read(`<head>${meta('search')}hello${meta('ai-edit')}</head>`)).toEqual(['search']);
    expect(read(`<head>\n  ${meta('search')}\n  ${meta('ai-edit')}\n</head>`)).toEqual(['search', 'ai-edit']);
  });

  test('stops at the head end tag', () => {
    expect(read(`<head>${meta('search')}</head>${meta('ai-edit')}`)).toEqual(['search']);
  });

  test('stops at the br end tag', () => {
    expect(read(`${meta('search')}</br>${meta('ai-edit')}`)).toEqual(['search']);
  });

  test('ignores a declaration inside a template element', () => {
    expect(read(`<head><template>${meta('search')}</template>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
  });

  test('ignores a declaration inside a script element', () => {
    expect(read(`<head><script>${meta('search')}</script>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
  });

  test('ignores a declaration inside a noscript element', () => {
    expect(read(`<head><noscript>${meta('search')}</noscript>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
    expect(read(`<head><noscript>text</noscript>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
  });

  test('does not stop for text inside a title or style element', () => {
    expect(read(`<head><title>search</title>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
    expect(read(`<head><style>body</style>${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
  });

  test('reads a declaration after other head elements', () => {
    expect(read(`<head><base href="/"><link rel="stylesheet" href="a.css">${meta('search')}</head>`))
      .toEqual(['search']);
  });

  test('ignores declarations past the scan limit', () => {
    expect(SCAN_LIMIT).toBe(512 * 1024);

    const padding = ' '.repeat(SCAN_LIMIT);
    expect(read(`<head>${padding}${meta('search')}</head>`)).toEqual([]);

    const beforeLimit = read(`<head>${meta('search')}${padding}${meta('ai-edit')}</head>`);
    expect(beforeLimit).toEqual(['search']);
  });

  test('skips a comment', () => {
    expect(read(`<head><!-- ${meta('search')} -->${meta('ai-edit')}</head>`)).toEqual(['ai-edit']);
  });
});

describe('validHelperName', () => {
  test('accepts lowercase letters, digits and inner hyphens', () => {
    expect(validHelperName('search')).toBe(true);
    expect(validHelperName('ai-edit')).toBe(true);
    expect(validHelperName('gpt-4o-mini')).toBe(true);
    expect(validHelperName('0')).toBe(true);
    expect(validHelperName('a'.repeat(32))).toBe(true);
  });

  test('refuses an empty name', () => {
    expect(validHelperName('')).toBe(false);
  });

  test('refuses a leading or trailing hyphen', () => {
    expect(validHelperName('-search')).toBe(false);
    expect(validHelperName('search-')).toBe(false);
    expect(validHelperName('-')).toBe(false);
  });

  test('refuses names longer than 32 bytes', () => {
    expect(validHelperName(`${'a'.repeat(31)}b`)).toBe(true);
    expect(validHelperName(`${'a'.repeat(32)}b`)).toBe(false);
  });

  test('refuses uppercase letters and punctuation', () => {
    expect(validHelperName('Search')).toBe(false);
    expect(validHelperName('search_two')).toBe(false);
    expect(validHelperName('search two')).toBe(false);
    expect(validHelperName('search/two')).toBe(false);
  });
});
