const fs = require('fs').promises;
const path = require('path');
const { documentEtag } = require('../../src/main/spec-wire');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { jest.restoreAllMocks(); if (h) await h.close(); h = null; });

const page = text => `<!doctype html><html><head></head><body><p>${text}</p></body></html>`;
const source = '/api/roots/root-a/source';
const put = (request, body) => request(source, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });

test('source reads stored bytes and stamp, saves through the root, and keeps the bridge off disk', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), page('before'));
  await h.startRoot();
  const request = await h.start();
  const before = await (await request(`${source}?path=A.html`)).json();
  expect(before).toEqual({ html: page('before'), etag: documentEtag(page('before')) });
  const document = await (await request('/api/roots/root-a/document?path=A.html')).json();
  const framed = await (await fetch(document.frameUrl)).text();
  expect(framed).toContain('data-hyperclay-bridge');
  expect(before.html).not.toContain('data-hyperclay-bridge');
  const savedResponse = await put(request, { path: 'A.html', html: framed.replace('before', 'after'),
    etag: before.etag, operationId: 'save-1' });
  expect(savedResponse.status).toBe(200);
  const saved = await savedResponse.json();
  const disk = await fs.readFile(path.join(h.dir, 'A.html'), 'utf8');
  expect(saved).toEqual({ kind: 'saved', html: disk, etag: documentEtag(disk) });
  expect(disk).not.toContain('data-hyperclay-bridge');
  expect(await (await request(`${source}?path=A.html`)).json()).toEqual({ html: disk, etag: saved.etag });
  const download = await request('/api/roots/root-a/download?path=A.html');
  expect(download.headers.get('content-disposition')).toContain('attachment');
  expect(await download.text()).toBe(disk);
  expect(await (await request('/api/roots/root-a/download?path=A.html')).text()).not.toContain('data-hyperclay-bridge');
});

test('stale save preserves the root status and current stamp', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), page('before'));
  await h.startRoot();
  const request = await h.start();
  const response = await put(request, { path: 'A.html', html: page('mine'), etag: 'stale', operationId: 'save-2' });
  expect(response.status).toBe(412);
  expect(await response.json()).toMatchObject({ reason: 'conflict', code: 'conflict', etag: documentEtag(page('before')) });
  expect(await fs.readFile(path.join(h.dir, 'A.html'), 'utf8')).toBe(page('before'));
});

test('a lost upstream save response is unknown and the shell does not replay it', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), page('before'));
  await h.startRoot();
  const request = await h.start();
  const original = global.fetch;
  let dispatched = 0;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('/_/save')) {
      dispatched++;
      await original(url, options);
      throw new Error('response lost');
    }
    return original(url, options);
  });
  const response = await put(request, { path: 'A.html', html: page('after'),
    etag: documentEtag(page('before')), operationId: 'lost-1' });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ reason: 'unknown' });
  expect(dispatched).toBe(1);
  expect(await fs.readFile(path.join(h.dir, 'A.html'), 'utf8')).toBe(page('after'));
});

test('the Code tab declares page format 1, so a floor-1 document still saves from it', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), page('before'));
  await h.startRoot();
  const request = await h.start();
  const original = global.fetch;
  let declared = null;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('/_/save')) declared = options.headers['x-clay-page-format'];
    return original(url, options);
  });
  const response = await put(request, { path: 'A.html', html: page('after'),
    etag: documentEtag(page('before')), operationId: 'floor-1' });
  expect(response.status).toBe(200);
  expect(declared).toBe('1');
});
