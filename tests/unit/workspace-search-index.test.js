const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { SearchIndex } = require('../../src/main/workspace/search-index');
const { fixture } = require('./workspace-fixture');

let dir;
let index;
let h;
afterEach(async () => {
  if (index) await index.close();
  if (h) await h.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  index = null; h = null; dir = null;
});

async function root() {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-search-'));
  const folder = path.join(dir, 'documents');
  await fs.mkdir(folder);
  return { id: 'root-a', path: folder };
}

test('the worker indexes visible document text but skips runtime and editor UI', async () => {
  const item = await root();
  await fs.writeFile(path.join(item.path, 'example.html'), `<title>Café Notes</title>
    <article data-page><h1>Readable words</h1><p>Fresh details here.</p></article>
    <script>secretScriptNeedle</script><style>.secretStyleNeedle{}</style>
    <template>secretTemplateNeedle</template><svg>secretSvgNeedle</svg>
    <noscript>secretNoscriptNeedle</noscript><div clay="editor-ui">secretChromeNeedle</div>
    <div clay="editor">secretEditorNeedle</div><div contenteditable="false">secretControlNeedle</div>
    <div data-clay-ui>secretUiNeedle</div>`);
  await fs.mkdir(path.join(item.path, '.trash'));
  await fs.writeFile(path.join(item.path, '.trash/hidden.html'), '<p>trashNeedle</p>');
  await fs.mkdir(path.join(item.path, '.hyperclay'));
  await fs.writeFile(path.join(item.path, '.hyperclay/version.html'), '<p>versionNeedle</p>');
  index = new SearchIndex(item, dir);
  expect((await index.query('cafe')).map(hit => hit.path)).toEqual(['example.html']);
  expect((await index.query('details'))[0].snippet).toContain('Fresh details');
  for (const needle of ['secretScriptNeedle', 'secretStyleNeedle', 'secretTemplateNeedle',
    'secretSvgNeedle', 'secretNoscriptNeedle', 'secretChromeNeedle', 'secretEditorNeedle',
    'secretControlNeedle', 'secretUiNeedle', 'trashNeedle', 'versionNeedle']) {
    expect(await index.query(needle)).toEqual([]);
  }
});

test('observer changes refresh content search; a corrupt cache rebuilds; cancellation terminates the worker', async () => {
  const item = await root();
  await fs.writeFile(path.join(item.path, 'note.html'), '<p>First token</p>');
  index = new SearchIndex(item, dir);
  const first = await index.ready;
  expect(first.files).toBe(1);
  expect(await index.query('second')).toEqual([]);
  await fs.writeFile(path.join(item.path, 'note.html'), '<p>Second token</p>');
  index.update('note.html');
  expect((await index.query('second')).map(hit => hit.path)).toEqual(['note.html']);
  await index.close();
  index = null;
  const cacheDir = path.join(dir, 'search-index');
  const cache = path.join(cacheDir, (await fs.readdir(cacheDir))[0]);
  await fs.writeFile(cache, '{bad json');
  index = new SearchIndex(item, dir);
  expect((await index.ready).cached).toBe(false);
  expect((await index.query('second')).map(hit => hit.path)).toEqual(['note.html']);
  await index.close();
  await expect(index.query('second')).rejects.toThrow('closed');
});

test('the shell returns name matches first and content matches with a snippet', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'cafe.html'), '<p>Name only</p>');
  await fs.writeFile(path.join(h.dir, 'other.html'), '<p>About a Café and its coffee.</p>');
  await fs.writeFile(path.join(h.dir, 'script.html'), '<script>cafe</script>');
  const request = await h.start();
  const response = await request('/api/roots/root-a/search?q=cafe');
  expect(response.status).toBe(200);
  const { items } = await response.json();
  expect(items.map(item => item.path)).toEqual(['cafe.html', 'other.html']);
  expect(items[0].snippet).toBeUndefined();
  expect(items[1].snippet).toContain('Café');
  await fs.writeFile(path.join(h.dir, 'other.html'), '<p>Changed to orange.</p>');
  h.observer.emit('raw', { event: 'change', rel: 'other.html' });
  let updated;
  for (let attempt = 0; attempt < 20; attempt++) {
    updated = await (await request('/api/roots/root-a/search?q=orange')).json();
    if (updated.items.some(item => item.path === 'other.html')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  expect(updated.items.map(item => item.path)).toEqual(['other.html']);
});

test('10,000 documents with 2 to 20 KB of text produce nonzero hits and report time, latency and RSS', async () => {
  const item = await root();
  const chunks = Array.from({ length: 19 }, (_, n) => ('common lavender meadow '.repeat(Math.ceil((2000 + n * 1000) / 23))).slice(0, 2000 + n * 1000));
  for (let start = 0; start < 10000; start += 100) {
    await Promise.all(Array.from({ length: 100 }, (_, offset) => {
      const n = start + offset;
      const suffix = n === 9999 ? ' rareorchidword' : '';
      return fs.writeFile(path.join(item.path, `doc-${String(n).padStart(5, '0')}.html`), `<p>${chunks[n % chunks.length]}${suffix}</p>`);
    }));
  }
  index = new SearchIndex(item, dir);
  const stats = await index.ready;
  const commonStart = performance.now();
  const common = await index.query('common');
  const commonMs = Math.round(performance.now() - commonStart);
  const rareStart = performance.now();
  const rare = await index.query('rareorchidword');
  const rareMs = Math.round(performance.now() - rareStart);
  expect(stats.files).toBe(10000);
  expect(common.length).toBeGreaterThan(0);
  expect(rare.map(hit => hit.path)).toEqual(['doc-09999.html']);
  console.log('SEARCH_BENCHMARK', JSON.stringify({ files: stats.files, indexMs: stats.indexMs,
    commonMs, rareMs, peakRssBytes: stats.peakRss, commonHits: common.length, rareHits: rare.length }));
}, 120000);
