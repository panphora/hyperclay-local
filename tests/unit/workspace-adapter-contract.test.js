const fs = require('fs').promises;
const path = require('path');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { if (h) await h.close(); h = null; });

test('packed Local protocol and live shell agree on bootstrap, tree, list, search, document and commands', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'Notes'));
  await fs.writeFile(path.join(h.dir, 'Notes', 'café.html'), '<html><body>café</body></html>');
  const manifest = require('@panphora/hyperclay-workspace/local-app/manifest.json');
  const request = await h.start();
  const boot = await (await request('/api/bootstrap')).json();
  expect(boot.protocol).toBe(manifest.protocol);
  expect(boot.roots).toHaveLength(1);
  const id = boot.roots[0].id;
  const base = `/api/roots/${encodeURIComponent(id)}`;
  expect((await (await request(`${base}/tree`)).json()).entries.map(entry => entry.path)).toEqual(['Notes', 'Notes/café.html']);
  expect((await (await request(`${base}/list?parent=Notes&cursor=&sort=name`)).json()).items).toMatchObject([{ name: 'café.html' }]);
  expect((await (await request(`${base}/search?q=cafe&cursor=`)).json()).items).toMatchObject([{ path: 'Notes/café.html' }]);
  const document = await (await request(`${base}/document?path=Notes%2Fcaf%C3%A9.html`)).json();
  expect(document).toMatchObject({ entry: { path: 'Notes/café.html', kind: 'document' }, wireId: expect.any(Number) });
  expect(document.frameUrl).toContain('/Notes/caf%C3%A9.html?workspace-frame=');
  const response = await request(`${base}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'rename', path: 'Notes/café.html', name: 'renamed.html' }) });
  expect(await response.json()).toEqual({ path: 'Notes/renamed.html' });
  expect((await (await request(`${base}/document?path=Notes%2Frenamed.html`)).json()).wireId).toBe(document.wireId);
});

test.todo('runAdapterContract against the package Local adapter after the package exports it');
test.todo('L6 source read and save routes');
test.todo('L6 versions, restore, upload, download, consents, and conflict routes');
