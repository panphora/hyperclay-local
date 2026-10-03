// Real-engine test for the caller-rules core: a POST that carries its own ?data=
// mapping (tagless documents included) and the GET that reads the same projection
// back and stamps the stored bytes. Run via `node --test` (npm run test:node),
// NOT jest: jest's config is plain CJS with no ESM support, and this exercises the
// dynamic import() of the pure-ESM hyper-html-api engine plus a real fs commit.
// The route step wires this file into test:node.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { applySiteDataLocal, extractSiteDataLocal } = require('../../src/main/utils/data-api');
const { documentEtag } = require('../../src/main/spec-wire');

// Tagless on purpose: nothing in the document names a mapping, so every write
// below has to come from the caller's own parameter.
const TAGLESS =
  '<!doctype html>\r\n<html>\r\n<head>\r\n<title>t</title>\r\n</head>\r\n<body>\r\n<h1>Hello</h1>\r\n<h2>Sub</h2>\r\n<p>&copy;</p>\r\n</body>\r\n</html>\r\n';

const TAGGED = (body) =>
  `<!doctype html>\r\n<html>\r\n<head>\r\n<script data-rules-name="api" data-rules-version="1">${body}</script>\r\n</head>\r\n<body>\r\n<h1>Hello</h1>\r\n<h2>Sub</h2>\r\n</body>\r\n</html>\r\n`;

async function withSite(name, html, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-query-write-node-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, html);
  const commits = { count: 0 };
  const commit = async (content) => {
    commits.count += 1;
    await fs.writeFile(file, content);
    return content;
  };
  try {
    return await fn({ dir, file, commit, commits });
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

test('an explicit mapping writes a tagless .html document and commits once', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { title: 'World' }, { commit, dataParam: '{title:"h1"}' });

    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { title: 'World' });
    assert.strictEqual(commits.count, 1);

    const written = await fs.readFile(file, 'utf8');
    assert.ok(written.includes('<h1>World</h1>'), 'the caller-named heading must hold the new text');
    assert.ok(written.includes('<h2>Sub</h2>'), 'a heading the mapping does not name must survive');
    assert.ok(written.includes('<p>&copy;</p>\r\n'), 'the entity and the line endings must survive verbatim');
    assert.ok(!written.includes('Hello'), 'the old heading text must be gone');
  });
});

test('an explicit mapping writes a tagless .htmlclay document too', async () => {
  await withSite('site.htmlclay', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(dir, 'site.htmlclay', { sub: 'New Sub' }, { commit, dataParam: '{sub:"h2"}' });

    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { sub: 'New Sub' });
    assert.strictEqual(commits.count, 1);
    assert.ok((await fs.readFile(file, 'utf8')).includes('<h2>New Sub</h2>'));
  });
});

test('an explicit mapping overrides a valid api tag', async () => {
  await withSite('site.html', TAGGED('{title:"h1"}'), async ({ dir, file, commit }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { heading: 'New Sub' }, { commit, dataParam: '{heading:"h2"}' });

    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { heading: 'New Sub' });

    const written = await fs.readFile(file, 'utf8');
    assert.ok(written.includes('<h2>New Sub</h2>'), 'the caller-named heading must hold the new text');
    assert.ok(written.includes('<h1>Hello</h1>'), 'the tag-named heading must be left alone');
    assert.ok(written.includes('{title:"h1"}'), 'the rules tag itself must survive verbatim');
  });
});

test('an explicit mapping overrides a malformed api tag, which alone is a 400', async () => {
  await withSite('site.html', TAGGED('{bad'), async ({ dir, file, commit }) => {
    const byTag = await applySiteDataLocal(dir, 'site.html', { title: 'x' }, { commit });
    assert.strictEqual(byTag.status, 400);
    assert.strictEqual(byTag.json.error, 'Malformed api rules tag');

    const byRules = await applySiteDataLocal(dir, 'site.html', { title: 'World' }, { commit, dataParam: '{title:"h1"}' });
    assert.strictEqual(byRules.status, 200);
    assert.deepStrictEqual(byRules.json, { title: 'World' });
    assert.ok((await fs.readFile(file, 'utf8')).includes('<h1>World</h1>'));
  });
});

test('an unknown body key is a 400 Write rejected and writes nothing', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(dir, 'site.html', { heading: 'x' }, { commit, dataParam: '{title:"h1"}' });

    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Write rejected');
    assert.deepStrictEqual(r.json.details, { unknownKeys: ['heading'], unmatched: [] });
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);
  });
});

test('a rule whose selector matches nothing is a 400 Write rejected and writes nothing', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(
      dir,
      'site.html',
      { title: 'x', away: 'y' },
      { commit, dataParam: '{title:"h1",away:".nope"}' }
    );

    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Write rejected');
    assert.deepStrictEqual(r.json.details, { unknownKeys: [], unmatched: [{ path: 'away', selector: '.nope' }] });
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);
  });
});

test('an absent or empty dataParam is refused before the file is read', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    for (const dataParam of [undefined, null, '']) {
      const r = await applySiteDataLocal(dir, 'site.html', { title: 'x' }, { commit, dataParam });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.json.error, 'Missing data parameter');
      assert.ok(r.json.example, 'the refusal keeps its example');
    }
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);

    // No file at all: the parameter is still the thing that answers.
    const absent = await applySiteDataLocal(dir, 'gone.html', { title: 'x' }, { dataParam: '' });
    assert.strictEqual(absent.status, 400);
    assert.strictEqual(absent.json.error, 'Missing data parameter');
  });
});

test('repeated dataParam values (an array) are refused, never guessed at', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(
      dir,
      'site.html',
      { title: 'x' },
      { commit, dataParam: ['{title:"h1"}', '{title:"h2"}'] }
    );

    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Invalid extraction rules');
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);
  });
});

test('malformed or unusable rules are a 400 Invalid extraction rules and write nothing', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const malformed = await applySiteDataLocal(dir, 'site.html', { title: 'x' }, { commit, dataParam: '{bad' });
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(malformed.json.error, 'Invalid extraction rules');
    assert.ok(malformed.json.details.includes('Invalid extraction rules syntax'));

    // The engine refuses a scalar mapping too; it keeps the caller-parameter wording.
    const scalar = await applySiteDataLocal(dir, 'site.html', { title: 'x' }, { commit, dataParam: '5' });
    assert.strictEqual(scalar.status, 400);
    assert.strictEqual(scalar.json.error, 'Invalid extraction rules');

    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);

    const absent = await applySiteDataLocal(dir, 'gone.html', { title: 'x' }, { dataParam: '{bad', commit });
    assert.strictEqual(absent.status, 400, 'a bad parameter must not become a 404 on an absent file');
  });
});

test('a body the document already matches never reaches commit', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const first = await applySiteDataLocal(dir, 'site.html', { title: 'World' }, { commit, dataParam: '{title:"h1"}' });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(commits.count, 1);

    const second = await applySiteDataLocal(dir, 'site.html', { title: 'World' }, { commit, dataParam: '{title:"h1"}' });
    assert.strictEqual(second.status, 200);
    assert.deepStrictEqual(second.json, { title: 'World' });
    assert.strictEqual(commits.count, 1);
    assert.strictEqual(second.headers.ETag, first.headers.ETag);
    assert.ok((await fs.readFile(file, 'utf8')).includes('<h1>World</h1>'));
  });
});

test('a stale If-Match refuses the caller-rules write with the stored stamp', async () => {
  await withSite('site.html', TAGLESS, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(
      dir,
      'site.html',
      { title: 'World' },
      { commit, dataParam: '{title:"h1"}', ifMatch: '"nope"' }
    );

    assert.strictEqual(r.status, 412);
    assert.strictEqual(r.headers.ETag, documentEtag(Buffer.from(TAGLESS, 'utf8')));
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), TAGLESS);
  });
});

test('a rule reaching into a harmless script is refused with no partial write', async () => {
  const html =
    '<!doctype html>\r\n<html>\r\n<head>\r\n<script>var x = 1;</script>\r\n</head>\r\n<body>\r\n<h1>Hello</h1>\r\n</body>\r\n</html>\r\n';
  await withSite('site.html', html, async ({ dir, file, commit, commits }) => {
    const r = await applySiteDataLocal(
      dir,
      'site.html',
      { title: 'World', code: 'var x = 2;' },
      { commit, dataParam: '{title:"h1",code:"script"}' }
    );

    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'Write refused');
    assert.deepStrictEqual(r.json.details, [{ target: '<script>', reason: 'inside <script>, which is not content' }]);
    assert.strictEqual(commits.count, 0);
    assert.strictEqual(await fs.readFile(file, 'utf8'), html, 'the heading write in the same body must not land either');
  });
});

test('the caller GET after a caller-rules write returns the source ETag and the projection', async () => {
  await withSite('site.htmlclay', TAGLESS, async ({ dir, file, commit }) => {
    const written = await applySiteDataLocal(
      dir,
      'site.htmlclay',
      { title: 'World' },
      { commit, dataParam: '{title:"h1"}' }
    );
    assert.strictEqual(written.status, 200);

    const read = await extractSiteDataLocal(dir, 'site.htmlclay', '{title:"h1"}');
    assert.strictEqual(read.status, 200);
    assert.deepStrictEqual(read.json, { title: 'World' });
    assert.strictEqual(
      read.headers.ETag,
      documentEtag(await fs.readFile(file)),
      'the stamp must describe the stored bytes'
    );
    assert.strictEqual(read.headers.ETag, written.headers.ETag, 'read and write must agree on the stamp');

    const other = await extractSiteDataLocal(dir, 'site.htmlclay', '{sub:"h2"}');
    assert.deepStrictEqual(other.json, { sub: 'Sub' });
  });
});
