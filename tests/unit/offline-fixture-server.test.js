const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Step 8 of the offline-local-hosts plan: another host's contract test launches this
// host as a child process, fetches the whole bundled ClayJS release through it and
// saves through it, with no browser. Everything here goes over HTTP to a real server,
// so what the other host relies on is what is exercised: the command's READY line, the
// bytes at every runtime URL, the projection a document GET carries, and the save.

const { documentEtag } = require('../../src/main/spec-wire');
const {
  servedDocumentEtag,
  withoutInjectedDocumentEtag
} = require('../helpers/served-metadata');
const runtimeAssets = require('../../src/main/runtime-assets');

const selected = runtimeAssets.selectedVersion;
const index = require(`../../src/main/offline-runtime/${selected}/offline-manifest.json`);
const SCRIPT = path.join(__dirname, '../../scripts/offline-fixture-server.mjs');

// The kanban template's runtime tags, verbatim: a document this host ships with.
const RUNTIME_SCRIPTS = [
  '<script src="https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,ai-edit"></script>',
  '<script src="https://clayjs.com/v1/sap.js"></script>',
  '<script src="https://clayjs.com/v1/clay-router.js"></script>',
];

const BOARD = `<!DOCTYPE html>
<html lang="en" autosave>
<head>
<meta charset="utf-8">
<title>Launch Plan \u00b7 Kanban</title>
${RUNTIME_SCRIPTS.join('\n')}
</head>
<body><p>one card</p></body>
</html>`;

const NOTE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>note</title>
</head>
<body><p>no runtime here</p></body>
</html>`;

let dir;
let child;
let ready;
let stderr = '';
let stdout = '';

function start() {
  return new Promise((resolve, reject) => {
    child = spawn('node', [SCRIPT, '--root', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (!ready && newline !== -1) {
        const line = stdout.slice(0, newline);
        resolve(line);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!ready) reject(new Error(`fixture server exited ${code} before READY: ${stderr}`));
    });
  });
}

const fetchBytes = async (url, options = {}) => {
  const res = await fetch(url, { redirect: 'manual', ...options });
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body };
};

const send = (save, etag, body) => fetchBytes(save.url, {
  method: save.method,
  headers: { ...save.headers, 'If-Match': etag },
  body,
});

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'offline-fixture-')));
  await fs.mkdir(path.join(dir, 'notes', '2026'), { recursive: true });
  await fs.writeFile(path.join(dir, 'board.html'), BOARD);
  await fs.writeFile(path.join(dir, 'notes', '2026', 'doc.html'), NOTE);
  ready = await start();
  ready = JSON.parse(ready.replace(/^READY /, ''));
});

afterAll(async () => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('the offline fixture server', () => {
  test('announces the selected release and every document it serves', () => {
    expect(ready.host).toBe('hyperclay-local');
    expect(ready.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(ready.runtime).toBe(`/_/clayjs/${selected}/`);
    expect(Object.keys(ready.documents).sort()).toEqual(['board.html', 'notes/2026/doc.html']);
    expect(ready.documents['board.html'].url).toBe(`${ready.baseURL}/board.html`);
    expect(ready.documents['notes/2026/doc.html'].url).toBe(`${ready.baseURL}/notes/2026/doc.html`);
    expect(ready.documents['board.html'].save).toEqual({
      method: 'POST',
      url: `${ready.baseURL}/_/save`,
      headers: {
        'Document-URL': `${ready.baseURL}/board.html`,
        'Content-Type': 'text/plain;charset=UTF-8',
        'Sec-Fetch-Site': 'same-origin',
        Origin: ready.baseURL,
      },
    });
  });

  test('every file of the selected release is answered with the index bytes', async () => {
    const answered = new Set();

    for (const [publicPath, entry] of Object.entries(index.files)) {
      const { res, body } = await fetchBytes(`${ready.baseURL}${ready.runtime}${publicPath}`);

      expect([publicPath, res.status]).toEqual([publicPath, 200]);
      expect([publicPath, crypto.createHash('sha256').update(body).digest('hex')])
        .toEqual([publicPath, entry.sha256]);
      answered.add(publicPath);
    }

    expect(answered.size).toBe(Object.keys(index.files).length);
    expect(answered.size).toBeGreaterThan(400);
  });

  test('a document with a runtime URL is served projected, and one without is served byte for byte', async () => {
    const board = await fetchBytes(ready.documents['board.html'].url);
    const boardHtml = board.body.toString('utf8');

    expect(board.res.status).toBe(200);
    expect(boardHtml).toContain('id="clay-runtime-map"');
    expect(boardHtml).toContain(`/_/clayjs/${selected}/clay.js?plugins=sortable,people,upload,sync,ai-edit`);
    expect(boardHtml).not.toContain('src="https://clayjs.com');
    expect(servedDocumentEtag(board.body)).toBe(documentEtag(await fs.readFile(path.join(dir, 'board.html'))));

    const note = await fetchBytes(ready.documents['notes/2026/doc.html'].url);
    const onDisk = await fs.readFile(path.join(dir, 'notes', '2026', 'doc.html'));

    expect(note.res.status).toBe(200);
    expect(Buffer.compare(withoutInjectedDocumentEtag(note.body), onDisk)).toBe(0);
    expect(servedDocumentEtag(note.body)).toBe(documentEtag(onDisk));
  });

  test('a save of the projected document writes the public URLs and the change', async () => {
    const board = await fetchBytes(ready.documents['board.html'].url);
    const projected = board.body.toString('utf8');
    const edited = projected.replace('<p>one card</p>', '<p>one card, edited</p>');
    expect(edited).not.toBe(projected);

    const stale = await send(ready.documents['board.html'].save, 'not-the-stamp', edited);
    expect(stale.res.status).toBe(412);
    expect(await fs.readFile(path.join(dir, 'board.html'), 'utf8')).toBe(BOARD);

    const { res } = await send(ready.documents['board.html'].save, servedDocumentEtag(board.body), edited);

    expect(res.status).toBe(200);
    const onDisk = await fs.readFile(path.join(dir, 'board.html'), 'utf8');
    expect(onDisk).toContain('<p>one card, edited</p>');
    expect(onDisk).toContain('https://clayjs.com/v1/clay.js?plugins=sortable,people,upload,sync,ai-edit');
    expect(onDisk).toContain('https://clayjs.com/v1/sap.js');
    expect(onDisk).not.toContain('/_/clayjs/');
    expect(onDisk).not.toContain('clay-runtime-map');
    expect(onDisk).not.toContain('documentetag');
  });

  // Windows cannot deliver SIGTERM to a child; the graceful exit is checked on macOS and Linux.
  (process.platform === 'win32' ? test.skip : test)('SIGTERM shuts it down with exit 0 and the port stops answering, and stdout held one line', async () => {
    const port = Number(new URL(ready.baseURL).port);
    const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

    child.kill('SIGTERM');

    expect(await exited).toBe(0);
    await expect(fetch(`${ready.baseURL}${ready.runtime}clay.js`)).rejects.toThrow();
    await expect(new Promise((resolve, reject) => {
      const socket = require('net').connect(port, '127.0.0.1', () => { socket.destroy(); resolve(); });
      socket.once('error', reject);
    })).rejects.toThrow();
    expect(stdout.split('\n').filter((line) => line !== '')).toHaveLength(1);
    expect(stdout.startsWith('READY {')).toBe(true);
  });
});
