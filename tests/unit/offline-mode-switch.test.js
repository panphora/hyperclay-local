jest.mock('electron', () => {
  const dedicated = { protocol: { handle: jest.fn() } };
  const defaultSession = { protocol: { handle: jest.fn() } };
  return {
    session: { fromPartition: jest.fn(() => dedicated), defaultSession },
    net: {
      fetch: jest.fn(async (request) => {
        throw new Error(`network fetch for ${request.url}`);
      })
    }
  };
});

const { execFileSync } = require('child_process');
const fs = require('fs').promises;
const readFileSync = require('fs').readFileSync;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const request = require('supertest');
const { net } = require('electron');

// Step 8 of the view-first plan: a switch from view to edit reloads the page into an
// edit boot (src/core/edit-mode.js), and a document opened in this host with no network
// has to load every file that boot asks for. The release that is bundled here is what
// answers, over the HTTP route and over the Electron offline session alike, and the
// save that follows has to be canonical so the reopened document projects again.

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { servedDocumentEtag } = require('../helpers/served-metadata');
const { offlineSession } = require('../../src/main/workspace/offline-session');
const runtimeAssets = require('../../src/main/runtime-assets');

const releaseRoot = path.join(__dirname, '../../src/main/offline-runtime');
const templates = path.join(__dirname, '../../src/main/document-templates');
const editSetScript = path.join(__dirname, '../fixtures/offline-mode/edit-set.mjs');

const selected = require('../../src/main/offline-runtime/manifest.json').selected;
const index = require(path.join(releaseRoot, selected, 'offline-manifest.json'));
const manifest = require(path.join(releaseRoot, selected, 'm/manifest.json'));
const chunks = manifest.entries;
const releaseDir = path.join(releaseRoot, selected);

const TEMPLATES = ['page', 'kanban', 'blank'];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The plugin query is the template's own, read from the clay.js tag it ships with.
function pluginQuery(id) {
  const html = readFileSync(path.join(templates, `${id}.html`), 'utf8');
  const match = /clay\.js\?([^"'\s>]+)/.exec(html);
  expect([id, Boolean(match)]).toEqual([id, true]);
  return match[1];
}

const sets = new Map();

function editSet(id) {
  if (!sets.has(id)) {
    const query = pluginQuery(id);
    const printed = execFileSync(process.execPath, ['--no-warnings', editSetScript, releaseDir, query], {
      encoding: 'utf8'
    });
    sets.set(id, { query, ...JSON.parse(printed) });
  }
  return sets.get(id);
}

let dir;
let app;
let port;

const file = (name = 'index.html') => path.join(dir, name);

// Bytes in, bytes out: a served document is compared against the file.
const text = (res) => res.body.toString('utf8');

const send = (target) =>
  request(app).get(target).buffer().parse((r, cb) => {
    const chunks_ = [];
    r.on('data', (c) => chunks_.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks_)));
  });

const save = (html, headers = {}) => {
  const req = request(app)
    .post('/_/save')
    .set('Document-URL', `http://localhost:${port}/index.html`)
    .set('Content-Type', 'text/plain');
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send(html);
};

function keyNames(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keyNames(inner, found);
    }
  }
  return found;
}

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'offline-mode-switch-')));
  app = await listenLoopback(createApp(dir));
  port = app.address().port;
});

afterAll(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('a switch to edit has every file it loads, offline', () => {
  test("each template's edit set is served over HTTP with its own bytes", async () => {
    const covered = [];

    for (const id of TEMPLATES) {
      const set = editSet(id);

      expect([id, set.missing]).toEqual([id, []]);
      expect([id, set.files.length > 50]).toEqual([id, true]);

      for (const publicPath of set.files) {
        expect([id, publicPath, Boolean(index.files[publicPath])]).toEqual([id, publicPath, true]);

        const res = await send(`/_/clayjs/${selected}/${publicPath}`);
        expect([id, publicPath, res.status]).toEqual([id, publicPath, 200]);
        expect([id, publicPath, sha256(res.body)]).toEqual([id, publicPath, index.files[publicPath].sha256]);
      }

      covered.push(id);
    }

    expect(covered).toEqual(TEMPLATES);
    expect(covered.length).toBe(3);

    // The edit boot's own entry points, not just the view boot's: the editor module each
    // page feature loads, and the lifecycle that drives the mode the reload lands in.
    const pageSet = new Set(editSet('page').files);
    expect(pageSet.has(`m/${chunks['page/editor.js']}`)).toBe(true);
    expect(pageSet.has(`m/${chunks['core/mode-lifecycle.js']}`)).toBe(true);
    expect(pageSet.has(`m/${manifest.runtime}`)).toBe(true);
    expect(pageSet.has(`m/${manifest.entries['loader.js']}`)).toBe(true);
  });

  test('HTTP and the Electron offline session answer the same bytes for every file', async () => {
    const union = new Set();
    for (const id of TEMPLATES) for (const publicPath of editSet(id).files) union.add(publicPath);
    expect(union.size).toBeGreaterThan(50);

    const handler = offlineSession().protocol.handle.mock.calls[0][1];
    let compared = 0;

    for (const publicPath of union) {
      const served = await send(`/_/clayjs/${selected}/${publicPath}`);
      expect([publicPath, served.status]).toEqual([publicPath, 200]);

      const response = await handler({ url: `https://clayjs.com/${selected}/${publicPath}` });
      expect([publicPath, response.status]).toEqual([publicPath, 200]);

      const offlineBytes = Buffer.from(await response.arrayBuffer());
      expect([publicPath, sha256(offlineBytes)]).toEqual([publicPath, sha256(served.body)]);
      compared += 1;
    }

    expect(compared).toBe(union.size);
    expect(compared).toBeGreaterThan(0);
    expect(net.fetch).not.toHaveBeenCalled();
  });

  test('a file the release does not carry is a miss on both counts', async () => {
    const misses = [
      `/_/clayjs/${selected}/src/no-such-file.js`,
      `/_/clayjs/9.9.9/clay.js`
    ];

    for (const target of misses) {
      const res = await send(target);
      expect([target, res.status]).toEqual([target, 404]);
      expect([target, res.headers['cache-control']]).toEqual([target, 'no-store']);
    }
  });

  test('the first edit saves canonical bytes, and the reopened document projects again', async () => {
    const template = await fs.readFile(path.join(templates, 'page.html'));
    await fs.writeFile(file(), template);
    const onDisk = await fs.readFile(file(), 'utf8');

    const served = await send('/index.html');
    const servedHtml = text(served);
    expect(servedHtml).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=page"`);
    expect(servedHtml).toContain('id="clay-runtime-map"');

    const edited = servedHtml.replace('<p data-id="p1"></p>', '<p data-id="p1">edited offline</p>');
    expect(edited).not.toBe(servedHtml);

    const res = await save(edited, { 'If-Match': servedDocumentEtag(served.body) });
    expect([res.status, res.body.msg]).toEqual([200, 'Saved']);

    const written = await fs.readFile(file(), 'utf8');
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
    expect(written).toContain('edited offline');
    expect(written).toBe(onDisk.replace('<p data-id="p1"></p>', '<p data-id="p1">edited offline</p>'));

    const reopened = await send('/index.html');
    expect(reopened.status).toBe(200);
    expect(text(reopened)).toContain(`src="/_/clayjs/${selected}/clay.js?plugins=page"`);
    expect(text(reopened)).toContain('edited offline');
    expect(text(reopened)).toContain('id="clay-runtime-map"');
  });

  test('the upgrade runner is bundled, and discovery announces no remote upgrade data', async () => {
    const upgradeFiles = [
      'src/plugins/upgrade.js',
      'src/core/upgrade-run.js',
      'src/plugins/upgrade-run.js',
      'src/vendor/hyper-html-api-upgrade.vendor.js',
      `m/${chunks['plugins/upgrade.js']}`
    ];

    for (const publicPath of upgradeFiles) {
      expect([publicPath, Boolean(index.files[publicPath])]).toEqual([publicPath, true]);

      const res = await send(`/_/clayjs/${selected}/${publicPath}`);
      expect([publicPath, res.status]).toEqual([publicPath, 200]);
      expect([publicPath, sha256(res.body)]).toEqual([publicPath, index.files[publicPath].sha256]);
    }

    const meta = await request(app).get('/_/meta').set('Document-URL', `http://localhost:${port}/index.html`);
    expect(meta.status).toBe(200);
    expect(keyNames(meta.body)).not.toContain('upgrade');
    expect(keyNames(meta.body).filter((key) => /upgrade/i.test(key))).toEqual([]);
  });
});
