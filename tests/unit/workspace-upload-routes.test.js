const fs = require('fs').promises;
const path = require('path');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { jest.restoreAllMocks(); if (h) await h.close(); h = null; });

function multipart(bytes, name = 'image.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  return form;
}

test('upload uses a canonical parent and the root upload writer', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'Notes'));
  await fs.writeFile(path.join(h.dir, 'Notes', 'A.html'), '<html><body>A</body></html>');
  await h.startRoot();
  const request = await h.start();
  const uploaded = await request('/api/roots/root-a/upload?path=Notes', { method: 'POST', body: multipart('image') });
  expect(uploaded.status).toBe(200);
  const result = await uploaded.json();
  expect(result.path).toMatch(/^uploads\/assets-a\/image-[0-9a-f]{6}\.png$/);
  expect(await fs.readFile(path.join(h.dir, result.path), 'utf8')).toBe('image');
  const invalid = await request('/api/roots/root-a/upload?path=..%2Foutside', { method: 'POST', body: multipart('x') });
  expect(invalid.status).toBe(403);
});

test('upload into a folder with no document goes to that folder', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'Empty'));
  await h.startRoot();
  const request = await h.start();
  const uploaded = await request('/api/roots/root-a/upload?path=Empty', { method: 'POST', body: multipart('image') });
  expect(uploaded.status).toBe(200);
  const result = await uploaded.json();
  expect(result.path).toMatch(/^Empty\/image-[0-9a-f]{6}\.png$/);
  expect(await fs.readFile(path.join(h.dir, result.path), 'utf8')).toBe('image');
  expect(await fs.readdir(path.join(h.dir, 'Empty'))).toEqual([result.path.split('/')[1]]);
});

test('upload preserves the root 413 refusal', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html><body>A</body></html>');
  await h.startRoot();
  const request = await h.start();
  const response = await request('/api/roots/root-a/upload?path=', {
    method: 'POST', body: multipart(new Uint8Array(25 * 1024 * 1024 + 1)),
  });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: 'too-large' });
});

test('a lost upload response is unknown without a replay', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html><body>A</body></html>');
  await h.startRoot();
  const request = await h.start();
  const original = global.fetch;
  let dispatched = 0;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('/_/upload')) {
      dispatched++;
      await original(url, options);
      throw new Error('response lost');
    }
    return original(url, options);
  });
  const response = await request('/api/roots/root-a/upload?path=', { method: 'POST', body: multipart('x') });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ reason: 'unknown' });
  expect(dispatched).toBe(1);
  expect((await fs.readdir(path.join(h.dir, 'uploads', 'assets-a'))).length).toBe(1);
});
