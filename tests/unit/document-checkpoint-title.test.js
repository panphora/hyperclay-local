const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { captureCheckpoint, isCheckpointCurrent, renderCheckpoint } = require('@panphora/clayjs/server/checkpoint');
const { createRooms, serializeLive } = require('@panphora/clayjs/server/rooms');
const { JSDOM } = require('jsdom');

const repoRoot = path.join(__dirname, '..', '..');
const packageRoot = path.join(repoRoot, 'node_modules', '@panphora', 'clayjs');
const version = require('@panphora/clayjs/package.json').version;
const checkpointPath = require.resolve('@panphora/clayjs/server/checkpoint');
console.log('clayjs under test:', version, checkpointPath);

let hasHelper = true;
try { require.resolve('@panphora/clayjs/src/page/document-title.js'); } catch { hasHelper = false; }
const skip = !hasHelper && version === '1.15.2';
const maybe = skip ? test.skip : test;
const skipped = skip
  ? ' (skipped until hypersave installs a ClayJS release with the shared title helper; installed 1.15.2 predates it)'
  : '';

// A release past 1.15.2 must carry the helper: if it does not, the case below fails saying so.
function requireHelper() {
  if (hasHelper) return;
  throw new Error(`@panphora/clayjs ${version} does not ship src/page/document-title.js, the shared title helper these checkpoint cases need`);
}

const tag = (name, value) =>
  `<script type="application/json" clay="live" merge="${name}">${serializeLive(value)}</script>`;
const html = (value, extra = '') =>
  `<!doctype html><html><head><title>Keep this title</title>${extra}</head><body><article data-page data-rev="old">old article</article>${tag('page', value)}</body></html>`;
const createDocument = () => new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: undefined, resources: undefined,
}).window.document;

function pageValue(blocks) {
  const script = `
    import { seedValue } from '@panphora/clayjs/src/page/ybind/seed.js';
    console.log(JSON.stringify(seedValue(${JSON.stringify(blocks)})));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot, encoding: 'utf8',
  }));
}

function roomOf(blocks, extra = '') {
  const rooms = createRooms({ newEpoch: () => 'checkpoint-test' });
  const source = html(pageValue(blocks), extra);
  const room = rooms.open('/test.html', source, { nodeId: 'node-1' });
  const capture = () => captureCheckpoint(room, { nodeId: 'node-1', roomKey: '/test.html' });
  const render = (text = source, pinned = capture()) => renderCheckpoint(text, pinned, { createDocument });
  return { room, source, capture, render };
}

test('the installed ClayJS package resolves inside this repository', () => {
  expect(typeof version).toBe('string');
  expect(version.length).toBeGreaterThan(0);
  expect(checkpointPath.startsWith(packageRoot + path.sep)).toBe(true);
});

maybe(`renderCheckpoint derives the title from the first root H1${skipped}`, () => {
  requireHelper();
  const { capture, render } = roomOf([{ id: 'h', t: 'heading', text: 'Built & titled', attrs: { level: 1 } }]);
  const pinned = capture();
  const result = render();
  expect(result.kind).toBe('ok');
  expect(result.html).toContain('<title>Built &amp; titled</title>');
  expect(isCheckpointCurrent(result.html, pinned)).toBe(true);
});

maybe(`a custom-mode page keeps its own title and stays current${skipped}`, () => {
  requireHelper();
  const { capture, render } = roomOf(
    [{ id: 'h', t: 'heading', text: 'Built & titled', attrs: { level: 1 } }],
    '<meta name="clay-seo-title-mode" content="custom">',
  );
  const pinned = capture();
  const result = render();
  expect(result.kind).toBe('ok');
  expect(result.html).toContain('<title>Keep this title</title>');
  expect(isCheckpointCurrent(result.html, pinned)).toBe(true);
});
