const fs = require('fs').promises;
const path = require('path');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { if (h) await h.close(); h = null; });

const post = (request, route, body) => request(`/api/roots/root-a/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('consent read is empty and device or capture decisions are refused without storing them', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html><body>A</body></html>');
  const request = await h.start();
  expect(await (await request('/api/roots/root-a/consents?path=A.html')).json())
    .toEqual({ granted: [], denied: [] });
  for (const permission of ['camera', 'microphone', 'display-capture']) {
    const grant = await post(request, 'consents', { path: 'A.html', permission, decision: 'grant' });
    expect(grant.status).toBe(403);
    expect(await grant.json()).toMatchObject({ reason: 'forbidden' });
  }
  const deny = await post(request, 'consents', { path: 'A.html', permission: 'camera', decision: 'deny' });
  expect(deny.status).toBe(501);
  expect(await (await request('/api/roots/root-a/consents?path=A.html')).json())
    .toEqual({ granted: [], denied: [] });
});

test('personal roots cannot resolve sync conflicts', async () => {
  h = await fixture();
  const request = await h.start();
  const response = await post(request, 'conflicts/resolve', { path: 'A.html', keep: 'mine' });
  expect(response.status).toBe(501);
  expect(await response.json()).toMatchObject({ reason: 'unsupported' });
});

test('team roots send mine and theirs to their existing sync session and refuse unsupported both', async () => {
  const syncManager = { resolveConflict: jest.fn().mockResolvedValue({ ok: true }) };
  h = await fixture({ kind: 'team', syncSessions: [{ id: 'session-1', rootId: 'root-a' }], syncManager });
  const request = await h.start();
  for (const keep of ['mine', 'theirs']) {
    const response = await post(request, 'conflicts/resolve', { path: 'A.html', keep });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  }
  expect(syncManager.resolveConflict.mock.calls.map(([value]) => value)).toEqual([
    { sessionId: 'session-1', path: 'A.html', choice: 'mine' },
    { sessionId: 'session-1', path: 'A.html', choice: 'theirs' },
  ]);
  const both = await post(request, 'conflicts/resolve', { path: 'A.html', keep: 'both' });
  expect(both.status).toBe(501);
  expect(await both.json()).toMatchObject({ reason: 'unsupported' });
  expect(syncManager.resolveConflict).toHaveBeenCalledTimes(2);
});
