const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { fixture } = require('./workspace-fixture');
const manifest = require('../../src/main/document-templates/manifest.json');
const { splitPage } = require('@panphora/clayjs/server/rooms');
const { readPageState } = require('../../src/main/page-state-store');

let h;
afterEach(async () => { if (h) await h.close(); h = null; });

async function command(request, body) {
  const response = await request('/api/roots/root-a/commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('bundled templates match their manifest and the hosted source when present', async () => {
  for (const item of manifest) {
    const bundled = await fs.readFile(path.join(__dirname, '../../src/main/document-templates', item.file));
    expect(bundled.length).toBe(item.bytes);
    expect(crypto.createHash('sha256').update(bundled).digest('hex')).toBe(item.sha256);
    const hosted = path.join(__dirname, '../../../hyperclay/public-assets/core-apps', item.file);
    if (await fs.stat(hosted).catch(() => null)) expect(bundled).toEqual(await fs.readFile(hosted));
  }
  expect(manifest.map(item => item.id)).toEqual(['page', 'blank', 'devlog', 'kanban', 'landing']);
});

test('each template creates its exact bytes in the selected folder without a backup', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'Notes'));
  const request = await h.start();
  for (const item of manifest) {
    const name = `${item.id}.html`;
    expect(await command(request, { command: 'create', parent: 'Notes', name, template: item.id }))
      .toEqual({ status: 200, body: { path: `Notes/${name}` } });
    const template = await fs.readFile(path.join(__dirname, '../../src/main/document-templates', item.file));
    // A page template's merge state goes to the sidecar, so the file it creates is
    // the template without that tag. Every other template is byte for byte.
    const { file, state } = splitPage(template.toString('utf8'));
    expect(await fs.readFile(path.join(h.dir, 'Notes', name)))
      .toEqual(state ? Buffer.from(file, 'utf8') : template);
    expect(await readPageState(h.dir, `Notes/${name}`)).toEqual(state);
  }
  expect(await fs.readdir(path.join(h.dir, 'Notes'))).toHaveLength(5);
  expect(await fs.stat(path.join(h.dir, '.hyperclay', 'versions')).catch(() => null)).toBeNull();
});

test('create of a page body stores a clean file and keeps its merge state in the sidecar', async () => {
  h = await fixture();
  const request = await h.start();

  expect(await command(request, { command: 'create', parent: '', name: 'page.html', template: 'page' }))
    .toEqual({ status: 200, body: { path: 'page.html' } });

  const stored = await fs.readFile(path.join(h.dir, 'page.html'), 'utf8');
  expect(stored).not.toContain('merge="page"');
  expect(stored).toContain('data-page="1"');
  const template = await fs.readFile(path.join(__dirname, '../../src/main/document-templates/page.html'), 'utf8');
  const { state } = splitPage(template);
  expect(await readPageState(h.dir, 'page.html')).toEqual(state);
  expect(state.tag).toContain('merge="page"');
});

test('create refuses occupied, unknown-template and unsafe names without changing files', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'taken.html'), 'kept');
  const request = await h.start();
  expect(await command(request, { command: 'create', parent: '', name: 'taken.html', template: 'blank' }))
    .toMatchObject({ status: 409, body: { reason: 'conflict' } });
  expect(await command(request, { command: 'create', parent: '', name: 'new.html', template: 'missing' }))
    .toMatchObject({ status: 501, body: { reason: 'unsupported' } });
  expect(await command(request, { command: 'create', parent: '../other', name: 'new.html', template: 'blank' }))
    .toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  expect(await command(request, { command: 'create', parent: '', name: '../other.html', template: 'blank' }))
    .toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  expect(await fs.readFile(path.join(h.dir, 'taken.html'), 'utf8')).toBe('kept');
  expect(await fs.stat(path.join(h.dir, 'new.html')).catch(() => null)).toBeNull();
});

test('create publishes one changed event for its document path', async () => {
  h = await fixture();
  const request = await h.start();
  const stream = await request('/api/events');
  const reader = stream.body.getReader();
  expect(await command(request, { command: 'create', parent: '', name: 'new.html', template: 'blank' }))
    .toEqual({ status: 200, body: { path: 'new.html' } });
  let output = '';
  while (!output.includes('"type":"changed"')) output += new TextDecoder().decode((await reader.read()).value);
  expect(output.split('\n').filter(line => line.includes('"type":"changed"'))).toHaveLength(1);
  expect(output).toContain('"paths":["new.html"]');
  await reader.cancel();
});
