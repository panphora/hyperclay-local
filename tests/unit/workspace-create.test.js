const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { fixture } = require('./workspace-fixture');
const manifest = require('../../src/main/document-templates/manifest.json');
const { splitPage } = require('@panphora/clayjs/server/rooms');
const { readPageState, logicalDocument, storePageState } = require('../../src/main/page-state-store');

async function nextChunk(reader) {
  const { value, done } = await reader.read();
  if (done) throw new Error('The event stream ended early');
  return new TextDecoder().decode(value);
}

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
  while (!output.includes('"type":"changed"')) output += await nextChunk(reader);
  expect(output.split('\n').filter(line => line.includes('"type":"changed"'))).toHaveLength(1);
  expect(output).toContain('"paths":["new.html"]');
  await reader.cancel();
});

describe('an untagged page template', () => {
  const rel = 'untitled.html';
  const source = '/api/roots/root-a/source';
  const fixtureFile = path.join(__dirname, '../fixtures/untagged-page-template.html');

  const templateTag = async () => splitPage(
    await fs.readFile(path.join(__dirname, '../../src/main/document-templates/page.html'), 'utf8')
  ).state.tag;

  // The host's own creation step, given the untagged bytes: split out the merge state
  // (there is none) and write the file the template describes.
  const create = async () => {
    h = await fixture();
    const html = await fs.readFile(fixtureFile, 'utf8');
    await fs.writeFile(path.join(h.dir, rel), await storePageState(h.dir, rel, html));
    return html;
  };

  const editAndSave = async () => {
    const html = await create();
    await h.startRoot();
    const request = await h.start();
    const before = await (await request(`${source}?path=${rel}`)).json();
    const tagged = html.replace('<article', `${await templateTag()}\n<article`);
    const response = await request(source, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel, html: tagged, etag: before.etag, operationId: 'save-untagged' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe('saved');
  };

  test('creation stores the template byte for byte and keeps no page state', async () => {
    const html = await create();
    expect(await fs.readFile(path.join(h.dir, rel))).toEqual(Buffer.from(html, 'utf8'));
    expect(await readPageState(h.dir, rel)).toBeNull();
  });

  test('the first edit-mode save moves the tag to the sidecar', async () => {
    await editAndSave();
    const stored = await fs.readFile(path.join(h.dir, rel), 'utf8');
    expect(stored).not.toContain('merge="page"');
    const state = await readPageState(h.dir, rel);
    expect(state.tag).toContain('merge="page"');
  });

  test('reopening the document puts the tag back exactly once', async () => {
    await editAndSave();
    const stored = await fs.readFile(path.join(h.dir, rel), 'utf8');
    const document = await logicalDocument(h.dir, rel, stored);
    expect(document.split('merge="page"')).toHaveLength(2);
    expect(document).toContain('data-page="1"');
  });
});
