const fs = require('fs').promises;
const path = require('upath');
const { RootTree } = require('../../src/main/workspace/tree');
const { RootServer } = require('../../src/main/root-servers');
const { fixture } = require('./workspace-fixture');

let h;
let rootServer;
afterEach(async () => {
  if (rootServer) await rootServer.stop();
  rootServer = null;
  if (h) await h.close();
  h = null;
});

test('subscribes before the disk walk and applies a change during the walk', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'old.html'), '<html>old</html>');
  const original = fs.readdir;
  let fired = false;
  fs.readdir = async (...args) => {
    if (!fired && path.resolve(String(args[0])) === path.resolve(h.dir)) {
      fired = true;
      const names = await original(...args);
      await fs.writeFile(path.join(h.dir, 'new.html'), '<html>new</html>');
      h.observer.emit('raw', { event: 'add', rel: 'new.html' });
      return names;
    }
    return original(...args);
  };
  try {
    const tree = new RootTree(h.root, h.observer, () => {});
    await tree.start();
    expect(tree.all().map(entry => entry.path).sort()).toEqual(['new.html', 'old.html']);
    tree.close();
    expect(h.observer.listenerCount('raw')).toBe(0);
  } finally { fs.readdir = original; }
});

test('lists 50 entries per page, sorts Unicode names, and searches without case or accents', async () => {
  h = await fixture();
  await fs.mkdir(path.join(h.dir, 'Notes'));
  for (let i = 0; i < 51; i++) await fs.writeFile(path.join(h.dir, 'Notes', `note-${String(i).padStart(2, '0')}.html`), '<html></html>');
  await fs.writeFile(path.join(h.dir, 'Notes', 'café.html'), '<html></html>');
  await fs.writeFile(path.join(h.dir, 'Notes', 'Ångström.html'), '<html></html>');
  await fs.mkdir(path.join(h.dir, '.trash'));
  await fs.writeFile(path.join(h.dir, '.trash', 'hidden.html'), '<html></html>');
  const request = await h.start();
  const first = await (await request('/api/roots/root-a/list?parent=Notes&sort=name')).json();
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).toBeTruthy();
  const second = await (await request(`/api/roots/root-a/list?parent=Notes&sort=name&cursor=${first.nextCursor}`)).json();
  expect(second.items).toHaveLength(3);
  const names = [...first.items, ...second.items].map(item => item.name);
  expect(names).toEqual([...names].sort(new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare));
  expect(new Set(names).size).toBe(53);
  const reused = await request(`/api/roots/root-a/search?q=note&cursor=${first.nextCursor}`);
  expect(reused.status).toBe(409);
  const search = await (await request('/api/roots/root-a/search?q=CAFE')).json();
  expect(search.items.map(item => item.name)).toEqual(['café.html']);
  const tree = await (await request('/api/roots/root-a/tree')).json();
  expect(tree.entries.some(item => item.path.startsWith('.trash'))).toBe(false);
});

test('document IDs survive a command rename and invalid paths are refused', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html><body>A</body></html>');
  const request = await h.start();
  const before = await (await request('/api/roots/root-a/document?path=A.html')).json();
  expect(before.wireId).toBeGreaterThan(0);
  const renamed = await request('/api/roots/root-a/commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'rename', path: 'A.html', name: 'B.html' }),
  });
  expect(renamed.status).toBe(200);
  const after = await (await request('/api/roots/root-a/document?path=B.html')).json();
  expect(after.wireId).toBe(before.wireId);
  expect(after.frameUrl).toContain(`workspace-frame=${before.wireId}`);
  for (const invalid of ['/tmp/a.html', '../a.html', '.trash/a.html', '.hyperclay/a.html']) {
    const response = await request(`/api/roots/root-a/document?path=${encodeURIComponent(invalid)}`);
    expect(response.status).toBe(403);
    expect((await response.json()).reason).toBe('forbidden');
  }
});

test('only a registered frame request injects the package bridge, and save strips it', async () => {
  h = await fixture();
  await fs.writeFile(path.join(h.dir, 'A.html'), '<html><head></head><body>A</body></html>');
  h.root.port = 0;
  rootServer = new RootServer(h.root, { workspaceFrame: (...args) => h.shell.frame(...args) });
  expect((await rootServer.start()).ok).toBe(true);
  h.root.port = rootServer.server.address().port;
  const request = await h.start();
  const doc = await (await request('/api/roots/root-a/document?path=A.html')).json();
  const url = doc.frameUrl.replace('localhost', '127.0.0.1');
  const framed = await (await fetch(url)).text();
  const ordinary = await (await fetch(url.split('?')[0])).text();
  expect(framed).toContain('data-hyperclay-bridge');
  expect(ordinary).not.toContain('data-hyperclay-bridge');
  expect(framed).not.toContain(h.shell.token);
  const saved = await fetch(`http://127.0.0.1:${h.root.port}/_/save`, {
    method: 'POST', headers: { 'Content-Type': 'text/html', 'Document-URL': url.split('?')[0] }, body: framed,
  });
  expect(saved.status).toBe(200);
  const disk = await fs.readFile(path.join(h.dir, 'A.html'), 'utf8');
  expect(disk).not.toContain('data-hyperclay-bridge');
});

test('a framed windows-1252 document keeps its original bytes', async () => {
  h = await fixture();
  const bytes = Buffer.concat([
    Buffer.from('<html><head></head><body>caf', 'ascii'), Buffer.from([0xe9]),
    Buffer.from('</body></html>', 'ascii'),
  ]);
  await fs.writeFile(path.join(h.dir, 'A.html'), bytes);
  h.root.port = 0;
  rootServer = new RootServer(h.root, { workspaceFrame: (...args) => h.shell.frame(...args) });
  expect((await rootServer.start()).ok).toBe(true);
  h.root.port = rootServer.server.address().port;
  const request = await h.start();
  const doc = await (await request('/api/roots/root-a/document?path=A.html')).json();
  const response = await fetch(doc.frameUrl.replace('localhost', '127.0.0.1'));
  const served = Buffer.from(await response.arrayBuffer());
  expect(served.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true);
  expect(served.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  expect(served.toString('latin1')).toContain('data-hyperclay-bridge');
  expect(served.toString('latin1')).toContain('hostSuffix":"localhost"');
});

test('a framed document that starts with a BOM keeps it first and the bridge after the doctype', async () => {
  h = await fixture();
  const bytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<!doctype html><html><head><title>x</title></head><body>A</body></html>', 'ascii'),
  ]);
  await fs.writeFile(path.join(h.dir, 'A.html'), bytes);
  h.root.port = 0;
  rootServer = new RootServer(h.root, { workspaceFrame: (...args) => h.shell.frame(...args) });
  expect((await rootServer.start()).ok).toBe(true);
  h.root.port = rootServer.server.address().port;
  const request = await h.start();
  const doc = await (await request('/api/roots/root-a/document?path=A.html')).json();
  const response = await fetch(doc.frameUrl.replace('localhost', '127.0.0.1'));
  const served = Buffer.from(await response.arrayBuffer());
  expect(served.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const text = served.toString('utf8');
  expect(text.indexOf('<!doctype html>')).toBe(1);
  expect(text.indexOf('data-hyperclay-bridge')).toBeGreaterThan(text.indexOf('<!doctype html>'));
  expect(text.indexOf('data-hyperclay-bridge')).toBeGreaterThan(text.indexOf('<head>'));
});
