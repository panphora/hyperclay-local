jest.mock('electron', () => {
  const dedicated = { protocol: { handle: jest.fn() } };
  const defaultSession = { protocol: { handle: jest.fn() } };
  return { session: { fromPartition: jest.fn(() => dedicated), defaultSession },
    net: { fetch: jest.fn(async () => new Response('network')) } };
});

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { session, net } = require('electron');
const { offlineSession, protocolMismatch } = require('../../src/main/workspace/offline-session');
const manifest = require('../../src/main/offline-runtime/manifest.json');

test('the manifest resolves every ClayJS URL in the five templates and every selected module import', async () => {
  const byUrl = new Map(manifest.files.map(file => [file.url, file]));
  expect(byUrl.size).toBe(manifest.files.length);
  for (const id of ['page', 'blank', 'devlog', 'kanban', 'landing']) {
    const html = await fs.readFile(path.join(__dirname, '../../src/main/document-templates', `${id}.html`), 'utf8');
    const $ = cheerio.load(html);
    $('[src], [href]').each((_, element) => {
      const url = $(element).attr('src') || $(element).attr('href');
      if (url?.startsWith('https://clayjs.com/v1/')) expect(byUrl.has(url)).toBe(true);
    });
  }
  const fakeFetch = async url => {
    const file = byUrl.get(url);
    expect(file).toBeDefined();
    return fs.readFile(path.join(__dirname, '../../src/main/offline-runtime', file.path), 'utf8');
  };
  for (const file of manifest.files) {
    const bytes = await fs.readFile(path.join(__dirname, '../../src/main/offline-runtime', file.path));
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    if (!file.path.endsWith('.js') || file.path === 'src/loader-logic.js') continue;
    const source = await fakeFetch(file.url);
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g)];
    for (const [, specifier] of imports) {
      const target = new URL(specifier, file.url).href;
      expect(byUrl.has(target)).toBe(true);
    }
  }
  expect(byUrl.has('https://clayjs.com/v1/src/vendor/prosemirror.vendor.js')).toBe(true);
  expect(byUrl.has('https://clayjs.com/v1/src/vendor/yjs.vendor.js')).toBe(true);
  expect(byUrl.has('https://clayjs.com/v1/src/page/themes/light-1.css')).toBe(true);
  expect(manifest.clayjsVersion).toBe(require('@panphora/clayjs/package.json').version);
});

test('the dedicated session serves exact manifest URLs and lets other URLs use the network', async () => {
  const dedicated = offlineSession();
  expect(offlineSession()).toBe(dedicated);
  expect(session.fromPartition).toHaveBeenCalledWith('persist:hyperclay-workspace');
  expect(dedicated.protocol.handle).toHaveBeenCalledTimes(1);
  expect(dedicated.protocol.handle.mock.calls[0][0]).toBe('https');
  expect(session.defaultSession.protocol.handle).not.toHaveBeenCalled();
  const handler = dedicated.protocol.handle.mock.calls[0][1];
  const item = manifest.files.find(file => file.url.includes('clay.js?plugins=page'));
  const response = await handler({ url: item.url });
  expect(Buffer.from(await response.arrayBuffer())).toEqual(
    await fs.readFile(path.join(__dirname, '../../src/main/offline-runtime', item.path)));
  expect(response.headers.get('content-type')).toBe(item.contentType);
  expect(response.headers.get('etag')).toBe(`"${item.sha256}"`);
  const unknown = { url: 'https://clayjs.com/v1/clay.js?plugins=unknown' };
  expect(await (await handler(unknown)).text()).toBe('network');
  expect(net.fetch).toHaveBeenCalledWith(unknown, { bypassCustomProtocolHandlers: true });
  expect(protocolMismatch()).toBe(false);
  expect(protocolMismatch(2)).toBe(true);
});
