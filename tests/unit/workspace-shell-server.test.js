const fs = require('fs').promises;
const http = require('http');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { if (h) await h.close(); h = null; });

test('starts lazily, gates shell HTML and every API read, and serves only manifest assets', async () => {
  h = await fixture();
  expect(h.shell.origin).toBeNull();
  const request = await h.start();
  const bare = await fetch(h.shell.origin);
  expect(bare.status).toBe(403);
  const html = await fetch(h.shell.origin, { headers: { 'X-Workspace-Bootstrap': h.shell.bootstrapSecret } });
  expect(html.status).toBe(200);
  const body = await html.text();
  expect(body).toContain(`content="${h.shell.token}"`);
  expect(body).toContain('id="workspace-root"');
  expect(body).not.toContain(h.shell.bootstrapSecret);
  const boot = await request('/api/bootstrap');
  expect(await boot.json()).toMatchObject({ protocol: 1, shellOrigin: h.shell.origin, appVersion: '1.31.1',
    account: { signedIn: false, username: null }, roots: [{ id: 'root-a', name: 'My files', origin: 'http://localhost:4321' }] });
  expect((await request('/api/roots')).status).toBe(200);
  expect((await fetch(h.shell.origin + '/api/roots')).status).toBe(403);
  expect((await request('/api/roots', { headers: { 'X-Workspace-Token': 'wrong' } })).status).toBe(403);
  expect((await request('/api/roots', { headers: { Origin: 'http://evil.test' } })).status).toBe(403);
  expect((await request('/api/roots', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  const wrongHost = await new Promise((resolve, reject) => {
    http.get(h.shell.origin + '/api/roots', { headers: { Host: 'evil.test', 'X-Workspace-Token': h.shell.token } },
      response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject);
  });
  expect(wrongHost).toBe(403);
  const manifest = require('@panphora/hyperclay-workspace/local-app/manifest.json');
  const asset = manifest.assets.find(item => item.path === manifest.entry.javascript);
  const assetResponse = await request(`/${asset.path}`);
  expect(assetResponse.status).toBe(200);
  expect(Number(assetResponse.headers.get('content-length')) || (await assetResponse.arrayBuffer()).byteLength).toBe(asset.bytes);
  expect((await request('/main.js')).status).toBe(404);
  expect((await request('/api/does-not-exist')).status).toBe(501);
});

test('package app is loaded by start, not by module import or construction', async () => {
  h = await fixture();
  const { createShellServer } = require('../../src/main/workspace/shell-server');
  expect(typeof createShellServer).toBe('function');
  expect(h.shell.origin).toBeNull();
  await h.start();
  expect(h.shell.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test('events carry one epoch and strictly increasing sequence and disconnect releases the listener', async () => {
  h = await fixture();
  await fs.writeFile(`${h.dir}/A.html`, '<html><body>A</body></html>');
  const request = await h.start();
  const response = await request('/api/events');
  expect(response.status).toBe(200);
  h.shell.rootsChanged();
  h.shell.connectionChanged(false);
  h.shell.syncChanged('root-a', 'paused');
  const reader = response.body.getReader();
  let text = '';
  while (text.split('\n').filter(line => line.startsWith('{')).length < 3) {
    text += new TextDecoder().decode((await reader.read()).value);
  }
  const events = text.split('\n').filter(line => line.startsWith('{')).map(JSON.parse);
  expect(events.map(event => event.type)).toEqual(['roots', 'connection', 'sync']);
  expect(events.map(event => event.seq)).toEqual([1, 2, 3]);
  expect(new Set(events.map(event => event.epoch)).size).toBe(1);
  await reader.cancel();
});

test('token stays out of document HTML, URLs, and console output', async () => {
  h = await fixture();
  await fs.writeFile(`${h.dir}/A.html`, '<html><body>A</body></html>');
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const request = await h.start();
    const response = await request('/api/roots/root-a/document?path=A.html');
    const document = await response.json();
    expect(document.frameUrl).not.toContain(h.shell.token);
    expect((await fs.readFile(`${h.dir}/A.html`, 'utf8'))).not.toContain(h.shell.token);
    expect(JSON.stringify(log.mock.calls) + JSON.stringify(error.mock.calls)).not.toContain(h.shell.token);
  } finally { log.mockRestore(); error.mockRestore(); }
});
