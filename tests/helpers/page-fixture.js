const { execFileSync } = require('child_process');

function pageFixture(text = 'abc') {
  const script = `
    import * as Y from '@panphora/clayjs/src/vendor/yjs.vendor.js';
    import { seedValue } from '@panphora/clayjs/src/page/ybind/seed.js';
    import { docFromValue, enc } from '@panphora/clayjs/src/page/ybind/provider.js';
    import { readYValue, projection } from '@panphora/clayjs/page/yjs';
    const value = seedValue([{ id: 'p', t: 'paragraph', text: process.argv[1] }]);
    const page = await readYValue(value);
    const rendered = projection.renderBlocks(page.blocks);
    const html = '<!doctype html><html><head><script type="application/json" merge="page" clay="live">' +
      JSON.stringify(value) + '</script><script type="application/json" data-rules-name="api" data-rules-version="1">' +
      JSON.stringify({ body: 'article p', rev: 'article@data-rev' }) + '</script></head><body><article data-page="1" data-rev="' +
      rendered.rev + '">' + rendered.html + '</article></body></html>';
    const doc = docFromValue(value, { strict: true });
    doc.clientID = 123;
    doc.getText('flow').delete(2, 1);
    const update = enc(Y.encodeStateAsUpdateV2(doc));
    doc.destroy();
    console.log(JSON.stringify({ html, revision: page.revision, update }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, text], {
    cwd: process.cwd(), encoding: 'utf8',
  }));
}

module.exports = { pageFixture };
