const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { runAdapterContract } = require('@panphora/hyperclay-workspace/testing');
const { createLocalWorkspaceAdapter, createLocalEventHub, createLocalQueryClient,
  createFetchTransport, localKey } = require('@panphora/hyperclay-workspace/local');
const { publishRecoveredCopy } = require('../../src/main/utils/backup');
const { fixture } = require('./workspace-fixture');

let h;
let contractActive = false;
afterEach(async () => { if (!contractActive && h) await h.close(); if (!contractActive) h = null; });

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

describe('packed Local adapter against the live shell', () => {
  let subject;
  let hub;
  let restoreRequest = null;
  let saveRequest = null;
  let nextConflict = null;
  let wireReceive;
  let epoch;
  let nextSeq = 1;

  beforeAll(async () => {
    contractActive = true;
    h = await fixture();
    const entries = [
      ['My Docs/résumé.html', '<!doctype html><html><body><p>source</p></body></html>'],
      ['Notes/drafts/café notes.html', '<html><body>notes</body></html>'],
      ['My Report.html', '<html><body>report</body></html>'],
      ['offline.html', '<html><body>offline</body></html>'],
      ['logo.png', 'PNG'],
      ...Array.from({ length: 61 }, (_, index) => [
        `Archive/${index === 0 ? 'café recipe.md' : `page-${String(index).padStart(3, '0')}.md`}`, 'text',
      ]),
    ];
    for (const folder of ['My Docs', 'Notes/drafts', 'Archive']) {
      await fs.mkdir(path.join(h.dir, folder), { recursive: true });
    }
    for (const [name, data] of entries) await fs.writeFile(path.join(h.dir, name), data);
    const versionHtml = '<!doctype html><html><body><p>older</p></body></html>';
    const version = await publishRecoveredCopy(h.dir, 'My Docs/résumé.html', versionHtml);
    await h.startRoot();
    await h.start();
    const boot = await (await fetch(h.shell.origin + '/api/bootstrap', {
      headers: { 'X-Workspace-Token': h.shell.token },
    })).json();
    epoch = boot.epoch;
    const root = boot.roots[0];
    const original = global.fetch;
    jest.spyOn(global, 'fetch').mockImplementation((url, options) => {
      if (String(url).endsWith('/_/save') && nextConflict) {
        const conflict = nextConflict;
        nextConflict = null;
        return Promise.resolve(new Response(JSON.stringify({ msg: 'Conflict', code: 'conflict', ...conflict }),
          { status: 412, headers: { 'Content-Type': 'application/json' } }));
      }
      return original(url, options);
    });
    const base = createFetchTransport({ shellOrigin: h.shell.origin, token: h.shell.token, fetch: global.fetch });
    const transport = {
      get: (...args) => base.get(...args),
      send(method, url, body, signal) {
        if (url.includes('/source?')) saveRequest = body;
        if (url.endsWith('/restore')) restoreRequest = body;
        return base.send(method, url, body, signal);
      },
      events(receive, state) {
        wireReceive = receive;
        return base.events(receive, state);
      },
    };
    hub = createLocalEventHub({ transport, epoch, online: true });
    const client = createLocalQueryClient();
    const key = name => localKey(root.id, name);
    const firstAdapter = createLocalWorkspaceAdapter({ transport, hub, client, root,
      viewerKey: 'local:viewer-a', shellOrigin: h.shell.origin });
    const secondAdapter = createLocalWorkspaceAdapter({ transport, hub, client, root,
      viewerKey: 'local:viewer-b', shellOrigin: h.shell.origin });
    const viewer = adapter => ({ adapter, identity: adapter.identity,
      documentKey: key('My Docs/résumé.html'), documentName: 'résumé.html',
      folderKey: key('Archive'), folderName: 'Archive',
      childKey: key('Archive/café recipe.md'), childName: 'café recipe.md',
      deepKey: key('Notes/drafts/café notes.html'), deepParentKey: key('Notes/drafts'),
      uploadKey: key('logo.png'), unsyncedKey: key('missing.html'),
      searchTerm: 'café', searchKey: key('Archive/café recipe.md') });
    subject = {
      name: 'live local shell', client, first: viewer(firstAdapter), second: viewer(secondAdapter),
      treeSize: entries.length + 4,
      documentProjections: () => client.getQueryCache().findAll({ queryKey: ['workspace'] })
        .filter(query => query.queryKey[3] === 'document' && query.state.data !== undefined)
        .map(query => query.state.data),
      notify: () => wireReceive({ type: 'changed', rootId: root.id,
        paths: ['My Report.html'], seq: nextSeq++, epoch }),
      source: {
        key: key('My Docs/résumé.html'),
        change: html => fsSync.writeFileSync(path.join(h.dir, 'My Docs', 'résumé.html'), html),
        lastSave: () => saveRequest,
        nextConflict: conflict => { nextConflict = conflict; },
      },
      versions: { key: key('My Docs/résumé.html'), id: `recovered-${version.filename}`,
        html: versionHtml, lastRestore: () => restoreRequest },
    };
  });

  afterAll(async () => {
    hub?.stop();
    jest.restoreAllMocks();
    if (h) await h.close();
    h = null;
    contractActive = false;
  });

  runAdapterContract([['live local shell', () => subject]]);
});
