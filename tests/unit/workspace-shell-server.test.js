const fs = require('fs').promises;
const http = require('http');
const { fixture } = require('./workspace-fixture');

async function nextChunk(reader) {
  const { value, done } = await reader.read();
  if (done) throw new Error('The event stream ended early');
  return new TextDecoder().decode(value);
}

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
  expect(h.shell.origin).toMatch(/^http:\/\/localhost:\d+$/);
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
    text += await nextChunk(reader);
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

test('entryUrl answers a one-time link for a known root and nothing before start or for an unknown one', async () => {
  h = await fixture();
  expect(h.shell.entryUrl('root-a')).toBeNull();
  await h.start();
  const entry = h.shell.entryUrl('root-a');
  expect(entry).toMatch(new RegExp(`^${h.shell.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/enter\\?ticket=[A-Za-z0-9_-]+$`));
  expect(h.shell.entryUrl('no-such-root')).toBeNull();
});

test('a ticket enters the workspace, sets the session cookie, and is spent once', async () => {
  h = await fixture();
  await h.start();
  const entry = h.shell.entryUrl('root-a');
  const response = await fetch(entry, { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/roots/root-a/files');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const cookie = response.headers.get('set-cookie');
  const port = new URL(h.shell.origin).port;
  expect(cookie).toContain(`hyperclay-workspace-${port}=`);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Path=/');
  expect(cookie).toContain('Max-Age=86400');

  expect((await fetch(entry, { redirect: 'manual' })).status).toBe(403);
  expect((await fetch(`${h.shell.origin}/enter?ticket=made-up`, { redirect: 'manual' })).status).toBe(403);

  const spent = h.shell.entryUrl('root-a');
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 60_001);
  try {
    expect((await fetch(spent, { redirect: 'manual' })).status).toBe(403);
  } finally { clock.mockRestore(); }
});

test('the session cookie serves the workspace page with the token and only for the right value', async () => {
  h = await fixture();
  await h.start();
  const entry = await fetch(h.shell.entryUrl('root-a'), { redirect: 'manual' });
  const cookie = entry.headers.get('set-cookie').split(';')[0];
  const page = await fetch(`${h.shell.origin}/roots/root-a/files`, { headers: { Cookie: cookie } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(`<meta name="workspace-token" content="${h.shell.token}">`);
  const port = new URL(h.shell.origin).port;
  expect((await fetch(`${h.shell.origin}/roots/root-a/files`,
    { headers: { Cookie: `hyperclay-workspace-${port}=wrong` } })).status).toBe(403);
  expect((await fetch(`${h.shell.origin}/roots/root-a/files`)).status).toBe(403);
});

test('the browser page refuses to be framed, and the session cookie alone opens no API', async () => {
  h = await fixture();
  await h.start();
  const entry = await fetch(h.shell.entryUrl('root-a'), { redirect: 'manual' });
  const cookie = entry.headers.get('set-cookie').split(';')[0];
  const page = await fetch(`${h.shell.origin}/roots/root-a/files`, { headers: { Cookie: cookie } });
  expect(page.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  expect(page.headers.get('x-frame-options')).toBe('DENY');
  expect((await fetch(`${h.shell.origin}/api/roots`, { headers: { Cookie: cookie } })).status).toBe(403);
});

test('concurrent starts share one server, and stop closes it', async () => {
  h = await fixture();
  const started = await Promise.all([h.shell.start(), h.shell.start(), h.shell.start()]);
  expect(new Set(started.map(result => result.origin))).toEqual(new Set([h.shell.origin]));
  const origin = h.shell.origin;
  const tickets = [h.shell.entryUrl('root-a'), h.shell.entryUrl('root-a')];
  for (const ticket of tickets) expect((await fetch(ticket, { redirect: 'manual' })).status).toBe(302);
  await h.shell.stop();
  await expect(fetch(origin)).rejects.toThrow();
});

test('a browser tab joins the flush through its events stream', async () => {
  const results = [];
  const gone = [];
  h = await fixture({ onFlushResult: (client, result) => { results.push([client, result]); return true; },
    onFlushClientGone: client => gone.push(client) });
  const request = await h.start();
  const plain = await request('/api/events');
  const tab = await request('/api/events?flush=1');
  expect(h.shell.flushClients()).toEqual(['1']);
  h.shell.requestFlush('7:1');
  const reader = tab.body.getReader();
  let text = '';
  while (!text.includes('flushRequest')) text += await nextChunk(reader);
  const lines = text.split('\n').filter(line => line.startsWith('{')).map(JSON.parse);
  expect(lines).toEqual([{ flushClient: '1' }, { flushRequest: '7:1' }]);
  const participants = [{ id: 'p', name: 'A.html', revision: 2, durable: true }];
  const posted = await request('/api/flush-result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: '1', requestId: '7:1', participants }) });
  expect(await posted.json()).toEqual({ ok: true });
  expect(results).toEqual([['1', { requestId: '7:1', participants }]]);
  const stranger = await request('/api/flush-result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: '9', requestId: '7:1', participants }) });
  expect(await stranger.json()).toEqual({ ok: false });
  expect((await fetch(`${h.shell.origin}/api/flush-result`, { method: 'POST',
    body: JSON.stringify({ client: '1', requestId: '7:1', participants }) })).status).toBe(403);
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(gone).toEqual(['1']);
  expect(h.shell.flushClients()).toEqual([]);
  await plain.body.cancel();
});

test('the browser page carries the stand-in bridge, and the shell lives on localhost', async () => {
  h = await fixture();
  await h.start();
  expect(new URL(h.shell.origin).hostname).toBe('localhost');
  const entry = await fetch(h.shell.entryUrl('root-a'), { redirect: 'manual' });
  const cookie = entry.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(`${h.shell.origin}/roots/root-a/files`, { headers: { Cookie: cookie } })).text();
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  expect(() => new Function(script)).not.toThrow();
  expect(script).toContain('if (window.workspaceNative) return;');
});
