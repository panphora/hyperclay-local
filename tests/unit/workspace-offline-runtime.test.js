jest.mock('electron', () => {
  const dedicated = { protocol: { handle: jest.fn() } };
  const defaultSession = { protocol: { handle: jest.fn() } };
  return { session: { fromPartition: jest.fn(() => dedicated), defaultSession },
    net: { fetch: jest.fn(async () => new Response('network')) } };
});

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { session, net } = require('electron');
const { offlineSession, protocolMismatch } = require('../../src/main/workspace/offline-session');
const runtimeAssets = require('../../src/main/runtime-assets');
const manifest = require('../../src/main/offline-runtime/manifest.json');
const lock = require('../../offline-runtime.lock.json');

const root = path.join(__dirname, '../../src/main/offline-runtime');
const templates = path.join(__dirname, '../../src/main/document-templates');
const indexOf = version => require(path.join(root, version, 'offline-manifest.json'));
const selected = manifest.selected;
const index = indexOf(selected);
const bytesOf = new Map();

function bundledBytes(version, publicPath) {
  const key = `${version}/${publicPath}`;
  if (!bytesOf.has(key)) bytesOf.set(key, fs.readFile(path.join(root, version, publicPath)));
  return bytesOf.get(key);
}

function protocolHandler() {
  const dedicated = offlineSession();
  return dedicated.protocol.handle.mock.calls[0][1];
}

test('the bundle carries every release the lock names, byte for byte', async () => {
  expect(manifest.schema).toBe(1);
  expect(manifest.versions).toEqual(lock.versions);
  expect(manifest.selected).toBe(lock.selected);
  expect(manifest.versions[0]).toBe(manifest.selected);
  let count = 0;
  for (const version of lock.versions) {
    const release = indexOf(version);
    expect(release.version).toBe(version);
    expect(release.schema).toBe(1);
    for (const [publicPath, entry] of Object.entries(release.files)) {
      const bytes = await bundledBytes(version, publicPath);
      expect(bytes.length).toBe(entry.bytes);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      count += 1;
    }
  }
  expect(count).toBe(manifest.files);
  expect(count).toBeGreaterThan(400);
});

test('the dedicated session answers every URL in the release index and nothing else', async () => {
  const dedicated = offlineSession();
  expect(offlineSession()).toBe(dedicated);
  expect(session.fromPartition).toHaveBeenCalledWith('persist:hyperclay-workspace');
  expect(dedicated.protocol.handle).toHaveBeenCalledTimes(1);
  expect(dedicated.protocol.handle.mock.calls[0][0]).toBe('https');
  expect(session.defaultSession.protocol.handle).not.toHaveBeenCalled();
  expect(protocolMismatch()).toBe(false);
  expect(protocolMismatch(2)).toBe(true);

  net.fetch.mockImplementation(async request => {
    throw new Error(`network fetch for ${request.url}`);
  });
  const handler = protocolHandler();
  const answered = new Set();
  for (const [publicPath, entry] of Object.entries(index.files)) {
    const bytes = await bundledBytes(selected, publicPath);
    for (const url of [`https://clayjs.com/v1/${publicPath}`, `https://clayjs.com/${selected}/${publicPath}`]) {
      const response = await handler({ url });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(entry.type);
      expect(response.headers.get('etag')).toBe(`"${entry.sha256}"`);
      expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
      answered.add(publicPath);
    }
  }
  expect(answered.size).toBe(Object.keys(index.files).length);
  expect([...answered].some(publicPath => publicPath.startsWith('m/'))).toBe(true);
  expect([...answered].some(publicPath => publicPath.startsWith('fonts/'))).toBe(true);
  expect(net.fetch).not.toHaveBeenCalled();
});

test('a loader query is answered with the bundled clay.js', async () => {
  const entry = index.files['clay.js'];
  const response = await protocolHandler()({
    url: 'https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,visitor-drafts,unsent,menu&exclude=richclay',
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe(entry.type);
  expect(Buffer.from(await response.arrayBuffer()).equals(await bundledBytes(selected, 'clay.js'))).toBe(true);
});

test('every clayjs.com URL in the five templates resolves to a bundled asset', async () => {
  const urls = new Set();
  for (const id of ['page', 'blank', 'devlog', 'kanban', 'landing']) {
    const html = await fs.readFile(path.join(templates, `${id}.html`), 'utf8');
    for (const match of html.matchAll(/https:\/\/clayjs\.com\/v1\/[^"'\s)<>]+/g)) urls.add(match[0]);
  }
  expect(urls.size).toBeGreaterThan(5);
  for (const url of urls) {
    const hit = runtimeAssets.resolve(url);
    expect([url, hit?.available]).toEqual([url, true]);
    expect([url, Boolean(runtimeAssets.assetFor(hit.version, hit.path))]).toEqual([url, true]);
  }
});

test('URLs outside the bundled release use the network', async () => {
  net.fetch.mockReset();
  net.fetch.mockImplementation(async () => new Response('network'));
  const handler = protocolHandler();
  const unknowns = [
    'https://clayjs.com/docs/',
    'https://clayjs.com/v2/clay.js',
    'https://clayjs.com/1.14.0/clay.js',
    'https://example.com/x.js',
  ];
  for (const url of unknowns) {
    const response = await handler({ url });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('network');
  }
  expect(net.fetch.mock.calls.map(([request]) => request.url)).toEqual(unknowns);
  expect(net.fetch).toHaveBeenCalledWith(expect.anything(), { bypassCustomProtocolHandlers: true });
});

test('assetFor only names paths the index carries', async () => {
  const spellings = [
    '../package.json',
    '../../package.json',
    'm/../../package.json',
    '..\\package.json',
    '/etc/passwd',
    'clay.js/../package.json',
    'constructor',
    '__proto__',
    'toString',
  ];
  for (const spelling of spellings) {
    expect([spelling, runtimeAssets.assetFor(selected, spelling)]).toEqual([spelling, null]);
    await expect(runtimeAssets.readAsset(selected, spelling)).rejects.toThrow(/No bundled ClayJS asset/);
  }
  expect(runtimeAssets.assetFor('0.0.0', 'clay.js')).toBeNull();
  expect(runtimeAssets.assetFor(selected, 'clay.js')).toEqual({
    file: path.join(root, selected, 'clay.js'),
    type: index.files['clay.js'].type,
    sha256: index.files['clay.js'].sha256,
    bytes: index.files['clay.js'].bytes,
  });
});
