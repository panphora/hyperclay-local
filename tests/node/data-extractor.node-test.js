// Real-engine parity test for the data-extractor wrapper. Run via `node --test`
// (npm run test:node), NOT jest: jest's config is plain CJS with no ESM support,
// and this exercises the dynamic import() of the pure-ESM hyper-html-api engine.
// The filename ends in `.node-test.js` (not `.test.js`) so jest's testMatch skips it.
const test = require('node:test');
const assert = require('node:assert');
const { extractData, extractViaTag, parseExtractionRules } = require('../../src/main/utils/data-extractor');

test('extractViaTag extracts via a single-token api tag', async () => {
  const html = `<!DOCTYPE html><html><head>
    <script type="application/json" data-rules-name="api" data-rules-version="1">
    { "title": "h1", "items": ".item[]" }
    </script></head><body>
    <h1>Hello</h1><ul><li class="item">a</li><li class="item">b</li></ul>
    </body></html>`;
  assert.deepStrictEqual(await extractViaTag(html, 'api'), { title: 'Hello', items: ['a', 'b'] });
});

test('extractViaTag matches a multi-token tag and skips a [cms-template] seed row', async () => {
  const html = `<!DOCTYPE html><html><head>
    <script type="application/json" data-rules-name="api cms collection" data-rules-version="1">
    { "items": [".item", { "name": ".name" }] }
    </script></head><body><ul>
    <li class="item" cms-template style="display:none"><span class="name"></span></li>
    <li class="item"><span class="name">Real One</span></li>
    </ul></body></html>`;
  assert.deepStrictEqual(await extractViaTag(html, 'api'), { items: [{ name: 'Real One' }] });
});

test('extractViaTag returns null when no tag carries the api token', async () => {
  const html = `<html><head><script type="application/json" data-rules-name="cms" data-rules-version="1">{ "t": "h1" }</script></head><body><h1>x</h1></body></html>`;
  assert.strictEqual(await extractViaTag(html, 'api'), null);
});

test('extractViaTag throws UnknownRulesVersion at the wrong version', async () => {
  const html = `<html><head><script type="application/json" data-rules-name="api" data-rules-version="2">{ "t": "h1" }</script></head><body></body></html>`;
  await assert.rejects(() => extractViaTag(html, 'api'), (e) => e.name === 'UnknownRulesVersion');
});

test('extractData runs query-style rules; parseExtractionRules parses relaxed JSON', async () => {
  const html = `<html><body><h1>Title</h1><p class="x">one</p><p class="x">two</p></body></html>`;
  const rules = await parseExtractionRules('{title:"h1",xs:".x[]"}');
  assert.deepStrictEqual(await extractData(html, rules), { title: 'Title', xs: ['one', 'two'] });
});
