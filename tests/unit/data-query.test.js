const { readDataQuery } = require('../../src/main/utils/data-query');

test('recognizes the exact decoded data key and decodes the value once', () => {
  expect(readDataQuery('/site.html?%64ata=%7Btitle%3A%22h1%22%7D')).toEqual({ present: true, text: '{title:"h1"}' });
  expect(readDataQuery('/site.html?data=%2520+title')).toEqual({ present: true, text: '%20 title' });
  expect(readDataQuery('/site.html?other=data&data[]=h1')).toEqual({ present: false });
});

test('rejects duplicate, empty and undecodable query parameters', () => {
  for (const query of ['data', 'data=', 'data=h1&data=h2', 'data=%ZZ', 'data=%FF', 'data=h1&other=%ZZ', 'data=h1;other=h2']) {
    expect(readDataQuery('/site.html?' + query)).toMatchObject({ present: true, error: expect.any(Object) });
  }
  expect(readDataQuery('/site.html?other=%ZZ')).toEqual({ present: false });
});
