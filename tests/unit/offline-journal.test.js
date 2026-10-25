jest.mock('electron', () => {
  const dedicated = { protocol: { handle: jest.fn() } };
  const defaultSession = { protocol: { handle: jest.fn() } };
  return { session: { fromPartition: jest.fn(() => dedicated), defaultSession },
    net: { fetch: jest.fn() } };
});

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const cheerio = require('cheerio');
const request = require('supertest');
const { net } = require('electron');

const { createApp } = require('../../src/main/server.js');
const runtimeAssets = require('../../src/main/runtime-assets');
const { offlineSession } = require('../../src/main/workspace/offline-session');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');
const { servedDocumentEtag } = require('../helpers/served-metadata');

const selected = runtimeAssets.selectedVersion;
const root = path.join(__dirname, '../../src/main/offline-runtime', selected);
const index = require(path.join(root, 'offline-manifest.json'));
const lock = require(path.join(root, 'compat/journal-assets.lock.json'));
const FIXTURES = path.join(__dirname, '../fixtures/journal');
const NAMES = ['journal-1.0.0.html', 'journal-1.1.0.html', 'journal-current.html'];
const LOCAL = `/_/clayjs/${selected}/`;
const FONT_HINTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const CLASSIC = Object.entries(lock.aliases).filter(([, entry]) => entry.path.endsWith('.js'));

const withoutEscapedAmpersands = (html) => html.replace(/&amp;/g, '&');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fixture = (name) => fs.readFile(path.join(FIXTURES, name), 'utf8');
const isAbsolute = (url) => /^https?:\/\//i.test(url);
const aliasKeys = new Set(Object.keys(index.aliases));

function resourcesOf(html) {
  const $ = cheerio.load(html);
  const found = [];
  $('script[src], link[href]').each((_, node) => {
    const tag = node.tagName;
    found.push({
      tag,
      rel: String($(node).attr('rel') || '').toLowerCase(),
      url: $(node).attr(tag === 'script' ? 'src' : 'href'),
    });
  });
  return found;
}

function isPublicRuntime(url) {
  return url.startsWith('https://clayjs.com/') || aliasKeys.has(url);
}

function localFor(url) {
  if (aliasKeys.has(url)) return `${LOCAL}${index.aliases[url]}`;
  return url.replace(/^https:\/\/clayjs\.com\/(?:v\d+|\d+\.\d+\.\d+)\//, LOCAL);
}

function publicPathOf(url) {
  const bare = url.split('?')[0].split('#')[0];
  return bare.startsWith(LOCAL) ? bare.slice(LOCAL.length) : null;
}

function entryElements(html) {
  const open = /<article class="entry"[^>]*>/g;
  const found = [];
  let match;
  while ((match = open.exec(html))) {
    if (!/data-id="[^"]+"/.test(match[0])) continue;
    const end = html.indexOf('</article>', match.index) + '</article>'.length;
    found.push(html.slice(match.index, end));
  }
  return found;
}

function addEntry(html, { id, body }) {
  const [first] = entryElements(html);
  expect(first).toBeTruthy();
  const start = html.indexOf(first);
  const added = first
    .replace(/data-id="[^"]+"/, `data-id="${id}"`)
    .replace(/(<code class="entry-body"[^>]*>)[\s\S]*?(<\/code>)/, `$1${body}$2`);
  return html.slice(0, start + first.length) + added + html.slice(start + first.length);
}

const node = () => ({
  appendChild() {}, insertBefore() {}, removeChild() {}, setAttribute() {}, getAttribute() { return null; },
  addEventListener() {}, removeEventListener() {}, remove() {}, focus() {},
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  childNodes: [], children: [], innerHTML: '', textContent: '',
  querySelector() { return null; }, querySelectorAll() { return []; },
});

function evaluate(body) {
  const document = {
    readyState: 'loading', documentElement: node(), head: node(), body: node(),
    createElement: node, createTextNode: () => ({ textContent: '' }),
    createDocumentFragment: node, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createTreeWalker: () => ({ nextNode: () => null }),
    createRange: () => ({ selectNodeContents() {}, setStart() {}, setEnd() {}, cloneContents: node }),
  };
  const sandbox = {
    console, document, navigator: { userAgent: 'node' }, location: { href: 'http://localhost/index.html' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {},
    fetch: () => { throw new Error('network fetch during compat evaluation'); },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInContext(body, vm.createContext(sandbox), { filename: 'journal-classic.js' });
  return sandbox;
}

let dir;
let app;
let port;

const file = () => path.join(dir, 'index.html');
const read = () => fs.readFile(file(), 'utf8');

const send = (target) => request(app).get(target).buffer().parse((res, cb) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

const text = (res) => res.body.toString('utf8');

const save = (html, headers = {}) => {
  const req = request(app)
    .post('/_/save')
    .set('Document-URL', `http://127.0.0.1:${port}/index.html`)
    .set('Content-Type', 'text/plain');
  for (const [name, value] of Object.entries(headers)) req.set(name, value);
  return req.send(html);
};

beforeAll(() => {
  global.fetch = jest.fn(async (url) => { throw new Error(`network fetch ${url}`); });
  net.fetch.mockImplementation(async (request_) => { throw new Error(`network fetch ${request_.url}`); });
});

afterAll(() => {
  delete global.fetch;
  net.fetch.mockReset();
});

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'offline-journal-')));
  app = await listenLoopback(createApp(dir));
  port = app.address().port;
});

afterEach(async () => {
  await closeLoopback();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  expect(global.fetch).not.toHaveBeenCalled();
});

describe('a real Journal is served with every runtime, library and font URL projected', () => {
  test.each(NAMES)('%s: the only URLs left absolute are the font preconnect hints', async (name) => {
    await fs.writeFile(file(), await fixture(name));

    const original = resourcesOf(await fixture(name));
    const resources = resourcesOf(text(await send('/index.html')));
    expect(resources.map((resource_) => resource_.tag)).toEqual(original.map((resource_) => resource_.tag));

    let projected = 0;
    for (const [position, before] of original.entries()) {
      if (!isPublicRuntime(before.url)) continue;
      projected += 1;
      expect([before.url, resources[position].url]).toEqual([before.url, localFor(before.url)]);
    }
    expect(projected).toBeGreaterThan(0);

    const external = resources.filter((resource_) => isAbsolute(resource_.url));
    console.log(`external URLs ${name}:`, external.map((resource_) => resource_.url));
    for (const resource_ of external) {
      const host = new URL(resource_.url).host;
      expect([resource_.url, resource_.tag, resource_.rel, FONT_HINTS.has(host)])
        .toEqual([resource_.url, 'link', 'preconnect', true]);
    }
    expect(external.length).toBeLessThanOrEqual(2);
  });

  test.each(NAMES)('%s: every projected URL serves the bundle\'s bytes and type', async (name) => {
    await fs.writeFile(file(), await fixture(name));

    const resources = resourcesOf(text(await send('/index.html')))
      .filter((resource_) => resource_.url.startsWith(LOCAL));
    expect(resources.length).toBeGreaterThan(0);

    for (const resource_ of resources) {
      const publicPath = publicPathOf(resource_.url);
      const entry = index.files[publicPath];
      expect([resource_.url, Boolean(entry)]).toEqual([resource_.url, true]);

      const res = await send(resource_.url);
      expect([resource_.url, res.status]).toEqual([resource_.url, 200]);
      expect([resource_.url, res.headers['content-type']]).toEqual([resource_.url, entry.type]);
      expect([resource_.url, digest(res.body)]).toEqual([resource_.url, entry.sha256]);
    }
  });
});

describe('an old Journal\'s exact CDN libraries resolve to the packaged compatibility files', () => {
  test.each(['journal-1.0.0.html', 'journal-1.1.0.html'])('%s: OverType and highlight.js load from the bundle', async (name) => {
    await fs.writeFile(file(), await fixture(name));
    const html = text(await send('/index.html'));
    expect(CLASSIC.length).toBe(2);

    for (const [originalURL, locked] of CLASSIC) {
      const local = `${LOCAL}${locked.path}`;
      expect([originalURL, html.includes(`src="${local}"`)]).toEqual([originalURL, true]);

      const res = await send(local);
      expect([local, res.status]).toEqual([local, 200]);
      expect([local, digest(res.body)]).toEqual([local, locked.sha256]);
      expect([local, index.files[locked.path].sha256]).toEqual([local, locked.sha256]);

      const scope = evaluate(res.body.toString('utf8'));
      if (locked.path.includes('overtype')) expect(typeof scope.OverType).toBe('function');
      else expect(scope.hljs.highlight('const a = 1', { language: 'javascript' }).value).toContain('hljs-');
    }
  });

  test('an unknown version, an appended query and another host stay external', async () => {
    const untouched = [
      'https://cdn.jsdelivr.net/npm/overtype@2.6.2/dist/overtype.min.js',
      'https://cdn.jsdelivr.net/npm/overtype@2.6.1/dist/overtype.min.js?x=1',
      'https://cdn.example.com/overtype-2.6.1.min.js',
    ];
    const scripts = ['https://clayjs.com/v1/clay.js', ...untouched].map((url) => `<script src="${url}"></script>`);
    await fs.writeFile(file(), `<!DOCTYPE html>\n<html lang="en">\n<head>\n${scripts.join('\n')}\n</head>\n<body><p>hi</p></body>\n</html>`);

    const html = text(await send('/index.html'));
    expect(html).toContain(`src="${LOCAL}clay.js"`);
    for (const url of untouched) expect(html).toContain(`src="${url}"`);
    expect(html).not.toContain('compat/');
  });
});

describe('the Google Fonts stylesheet alias is served from the bundle', () => {
  test.each(NAMES)('%s: its own url() references resolve to packaged fonts', async (name) => {
    await fs.writeFile(file(), await fixture(name));
    const resource_ = resourcesOf(text(await send('/index.html')))
      .find((found) => found.url === `${LOCAL}fonts/ibm-plex.css`);
    expect(resource_).toBeTruthy();

    const res = await send(resource_.url);
    expect([resource_.url, res.status]).toEqual([resource_.url, 200]);
    expect(res.headers['content-type']).toBe(index.files['fonts/ibm-plex.css'].type);

    const references = [...res.body.toString('utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
      .map((match) => match[1]);
    expect(references.length).toBeGreaterThan(0);

    const stylesheet = `http://127.0.0.1:${port}${resource_.url}`;
    for (const reference of references) {
      const font = new URL(reference, stylesheet);
      const answered = await send(font.pathname);
      expect([reference, answered.status]).toEqual([reference, 200]);
      expect([reference, /^font\//.test(answered.headers['content-type'])]).toEqual([reference, true]);
    }
  });
});

describe('the Electron workspace session answers the old CDN URLs without the network', () => {
  test('each exact alias is answered from the bundle with the compat bytes', async () => {
    const dedicated = offlineSession();
    const handler = dedicated.protocol.handle.mock.calls[0][1];
    net.fetch.mockClear();

    for (const [originalURL, locked] of Object.entries(lock.aliases)) {
      const response = await handler({ url: originalURL });

      expect([originalURL, response.status]).toEqual([originalURL, 200]);
      expect([originalURL, response.headers.get('content-type')]).toEqual([originalURL, index.files[locked.path].type]);
      expect([originalURL, digest(Buffer.from(await response.arrayBuffer()))]).toEqual([originalURL, locked.sha256]);
    }
    expect(net.fetch).not.toHaveBeenCalled();

    const exact = Object.keys(lock.aliases)[0];
    const queried = await handler({ url: `${exact}?x=1` }).then(() => 'answered', () => 'threw');
    expect(queried).toBe('threw');
    expect(net.fetch.mock.calls.map(([asked]) => asked.url)).toEqual([`${exact}?x=1`]);
  });
});

describe('the current Journal\'s late library loads come from the same bundle', () => {
  test('overtype, marked, highlight and two languages all serve with the index\'s hash', async () => {
    await fs.writeFile(file(), await fixture('journal-current.html'));
    const html = text(await send('/index.html'));

    const clayJS = text(await send(`${LOCAL}clay.js`));
    const at = clayJS.lastIndexOf('({');
    const descriptor = JSON.parse(clayJS.slice(at + 1, clayJS.indexOf('})', at) + 1));
    const loader = descriptor.preload.find((name) => name.startsWith('loader-'));
    expect(loader).toBeTruthy();
    const loaderJS = text(await send(`${LOCAL}${descriptor.dir}${loader}`));

    const table = new Map();
    for (const match of loaderJS.matchAll(/(["']?)([a-z][a-z/-]*)\1:\(\)=>import\("\.\/([^"]+)"\)/g)) {
      table.set(match[2], match[3]);
    }

    for (const id of ['overtype', 'marked', 'highlight', 'highlight/bash', 'highlight/javascript']) {
      const chunk = table.get(id);
      expect([id, Boolean(chunk)]).toEqual([id, true]);
      const publicPath = `${descriptor.dir}${chunk}`;
      expect([id, Boolean(index.files[publicPath])]).toEqual([id, true]);
      expect([id, html.includes(publicPath)]).toEqual([id, false]);

      const res = await send(`${LOCAL}${publicPath}`);
      expect([id, res.status]).toEqual([id, 200]);
      expect([id, digest(res.body)]).toEqual([id, index.files[publicPath].sha256]);
    }
  });
});

describe('a Journal entry written offline saves canonical and reopens projected', () => {
  const ID = 'offline1';
  const BODY = '# Written offline\n\nThe file is the database, and this entry never left the machine.';

  test.each(NAMES)('%s: the new entry and the original entries save with public runtime URLs', async (name) => {
    const original = await fixture(name);
    await fs.writeFile(file(), original);

    const served = await send('/index.html');
    const edited = addEntry(text(served), { id: ID, body: BODY });
    const res = await save(edited, { 'If-Match': servedDocumentEtag(served.body) });
    expect([res.status, res.body.msg]).toEqual([200, 'Saved']);

    const written = await read();
    expect(written).not.toContain('/_/clayjs/');
    expect(written).not.toContain('clay-runtime-map');
    expect(resourcesOf(written).map((resource_) => resource_.url))
      .toEqual(resourcesOf(original).map((resource_) => resource_.url));
    for (const entry of entryElements(original)) expect(written).toContain(entry);
    expect(written).toContain(`data-id="${ID}"`);
    expect(written).toContain(BODY);
    expect(withoutEscapedAmpersands(written))
      .toBe(withoutEscapedAmpersands(addEntry(original, { id: ID, body: BODY })));

    const reopened = text(await send('/index.html'));
    expect(resourcesOf(reopened).map((resource_) => resource_.url))
      .toEqual(resourcesOf(text(served)).map((resource_) => resource_.url));
    expect(reopened).toContain('clay-runtime-map');
    expect(resourcesOf(reopened).filter((resource_) => resource_.url.startsWith(LOCAL)).length).toBeGreaterThan(0);
  });
});
