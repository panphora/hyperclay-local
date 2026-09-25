// Real-engine parity test for the data-API write path. Run via `node --test`
// (npm run test:node), NOT jest: jest's config is plain CJS with no ESM support,
// and this exercises the dynamic import() of the pure-ESM hyper-html-api engine.
// The filename ends in `.node-test.js` (not `.test.js`) so jest's testMatch skips it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { applySiteDataLocal } = require('../../src/main/utils/data-api');

const SITE = '<!doctype html>\r\n<html><head><script data-rules-name="api" data-rules-version="1">{title:"h1",items:"li[]"}</script></head>\r\n<body>\r\n<h1 class=\'x\'>Hello</h1>\r\n<p>&copy;</p>\r\n<ul><li>A</li></ul>\r\n</body></html>\r\n';

async function withSite(html, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-write-node-'));
  const file = path.join(dir, 'site.html');
  await fs.writeFile(file, html);
  const commit = async (content) => {
    await fs.writeFile(file, content);
    return content;
  };
  try {
    return await fn({ dir, file, commit });
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

test('applySiteDataLocal writes through the api tag, content only', async () => {
  await withSite(SITE, async ({ dir, file, commit }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { title: 'World', items: ['A', 'B'] }, { commit });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { title: 'World', items: ['A', 'B'] });

    const written = await fs.readFile(file, 'utf8');
    // The entity and the line ending survive a write that only touched the
    // heading and the list: the engine splices, it does not serialise the DOM.
    assert.ok(written.includes('<p>&copy;</p>\r\n'), 'the untouched paragraph must survive verbatim');
    assert.ok(written.includes('<h1 class="x">World</h1>'), 'the heading must hold the new text');
    assert.ok(!written.includes('Hello'), 'the old heading text must be gone');
  });
});

test('a body that changes nothing is a 200 that never reaches commit', async () => {
  await withSite(SITE, async ({ dir, file }) => {
    let commits = 0;
    const commit = async (content) => {
      commits += 1;
      await fs.writeFile(file, content);
      return content;
    };
    const first = await applySiteDataLocal(dir, 'site.html', { title: 'World', items: ['A', 'B'] }, { commit });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(commits, 1);

    const second = await applySiteDataLocal(dir, 'site.html', { title: 'World' }, { commit });
    assert.strictEqual(second.status, 200);
    assert.deepStrictEqual(second.json, { title: 'World', items: ['A', 'B'] });
    assert.strictEqual(commits, 1);
  });
});

test('an unknown key is a 400 Write rejected', async () => {
  await withSite(SITE, async ({ dir, commit }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Write rejected');
    assert.deepStrictEqual(r.json.details, { unknownKeys: ['t'], unmatched: [] });
  });
});

test('a rule targeting a handler attribute is a 400 Write refused', async () => {
  const html = '<!doctype html>\r\n<html><head><script data-rules-name="api" data-rules-version="1">{h:"a@onclick"}</script></head>\r\n<body>\r\n<a href="#">Go</a>\r\n</body></html>\r\n';
  await withSite(html, async ({ dir, commit }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { h: 'x' }, { commit });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Write refused');
    assert.deepStrictEqual(r.json.details, [{ target: '<a>', reason: 'attribute "onclick" can run script' }]);
  });
});

test('a document with no api tag is a 400 No api rules tag', async () => {
  await withSite('<html><body><h1>x</h1></body></html>', async ({ dir, commit }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { t: 'x' }, { commit });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'No api rules tag');
  });
});
