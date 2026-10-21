const fs = require('fs').promises;
const path = require('path');
const { publishRecoveredCopy } = require('../../src/main/utils/backup');
const { documentEtag } = require('../../src/main/spec-wire');
const { fixture } = require('./workspace-fixture');

let h;
afterEach(async () => { if (h) await h.close(); h = null; });

const page = text => `<!doctype html><html><body><p>${text}</p></body></html>`;
const post = (request, body) => request('/api/roots/root-a/restore', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('versions include recovered copies, preview is inert, and restore checks the stamp and makes a safety backup', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), page('current'));
  const recovered = await publishRecoveredCopy(h.dir, 'A.html', page('recovered'));
  await h.startRoot();
  const request = await h.start();
  const list = await request('/api/roots/root-a/versions?path=A.html');
  expect(list.status).toBe(200);
  const versions = (await list.json()).versions;
  expect(versions).toEqual([expect.objectContaining({ id: `recovered-${recovered.filename}`,
    kind: 'recovered', savedAt: expect.any(String), bytes: Buffer.byteLength(page('recovered')) })]);
  const preview = await request(`/api/roots/root-a/version?path=A.html&id=${encodeURIComponent(versions[0].id)}`);
  expect(preview.headers.get('content-type')).toContain('application/json');
  expect(await preview.json()).toEqual({ id: versions[0].id, html: page('recovered') });
  const stale = await post(request, { path: 'A.html', versionId: versions[0].id,
    etag: 'stale', operationId: 'restore-stale' });
  expect(stale.status).toBe(412);
  expect(await stale.json()).toMatchObject({ reason: 'conflict', etag: documentEtag(page('current')) });
  expect(await fs.readFile(path.join(h.dir, 'A.html'), 'utf8')).toBe(page('current'));
  const restored = await post(request, { path: 'A.html', versionId: versions[0].id,
    etag: documentEtag(page('current')), operationId: 'restore-1' });
  expect(restored.status).toBe(200);
  expect(await restored.json()).toEqual({ kind: 'saved', etag: documentEtag(page('recovered')) });
  expect(await fs.readFile(path.join(h.dir, 'A.html'), 'utf8')).toBe(page('recovered'));
  const backups = await fs.readdir(path.join(h.dir, '.hyperclay', 'versions', 'A'));
  expect(backups.length).toBeGreaterThan(0);
  expect(await Promise.all(backups.map(name => fs.readFile(path.join(h.dir, '.hyperclay', 'versions', 'A', name), 'utf8'))))
    .toContain(page('current'));
});
