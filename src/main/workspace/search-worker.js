const fs = require('fs').promises;
const path = require('upath');
const { parentPort, workerData } = require('worker_threads');
const { Parser } = require('htmlparser2');

const VERSION = 1;
const DOCUMENT = /\.(?:html|htmlclay)$/i;
const HIDDEN = new Set(['node_modules', 'sites-versions', 'tailwindcss', '.trash', '.hyperclay']);
const OMIT = new Set(['script', 'style', 'template', 'svg', 'noscript']);
const index = new Map();
let saveTimer = null;
let peakRss = process.memoryUsage().rss;

function visible(rel) {
  return rel.split('/').every(part => part && !part.startsWith('.') && !HIDDEN.has(part));
}

function fold(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function extract(html) {
  let title = '';
  const text = [];
  const stack = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      const parent = stack.at(-1);
      const omitted = Boolean(parent?.omitted) || OMIT.has(name) ||
        ['editor', 'editor-ui'].includes(attributes.clay) ||
        attributes.contenteditable === 'false' || Object.hasOwn(attributes, 'data-clay-ui');
      stack.push({ name, omitted });
      if (!omitted && name !== 'title') text.push(' ');
    },
    ontext(value) {
      const current = stack.at(-1);
      if (!current || current.omitted) return;
      if (stack.some(item => item.name === 'title')) title += value;
      else text.push(value);
    },
    onclosetag() { stack.pop(); },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  return {
    title: title.replace(/\s+/gu, ' ').trim(),
    text: text.join('').replace(/\s+/gu, ' ').trim(),
  };
}

const stamp = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;

async function indexFile(rel) {
  if (!visible(rel) || !DOCUMENT.test(rel)) return;
  const file = path.join(workerData.rootPath, rel);
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) { index.delete(rel); return; }
  const identity = stamp(stat);
  if (index.get(rel)?.stamp === identity) return;
  const html = await fs.readFile(file, 'utf8');
  const { title, text } = extract(html);
  index.set(rel, { path: rel, stamp: identity, title, text });
  if (index.size % 100 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
}

async function walk(parent = '') {
  const directory = path.join(workerData.rootPath, parent);
  const children = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const child of children) {
    const rel = parent ? `${parent}/${child.name}` : child.name;
    if (!visible(rel) || child.isSymbolicLink()) continue;
    if (child.isDirectory()) await walk(rel);
    else if (child.isFile()) await indexFile(rel);
  }
}

async function writeCache() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await fs.mkdir(path.dirname(workerData.cachePath), { recursive: true });
  const temporary = `${workerData.cachePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ version: VERSION, rootPath: workerData.rootPath, entries: [...index.values()] }));
  await fs.rename(temporary, workerData.cachePath);
}

async function loadCache() {
  try {
    const cache = JSON.parse(await fs.readFile(workerData.cachePath, 'utf8'));
    if (cache.version !== VERSION || cache.rootPath !== workerData.rootPath || !Array.isArray(cache.entries)) return false;
    for (const entry of cache.entries) {
      if (typeof entry.path !== 'string' || typeof entry.stamp !== 'string' ||
          typeof entry.text !== 'string' || typeof entry.title !== 'string' || !visible(entry.path)) throw new Error('Invalid cache entry');
      index.set(entry.path, entry);
    }
    return true;
  } catch { index.clear(); return false; }
}

function scheduleCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeCache().catch(error => parentPort.postMessage({ type: 'error', message: error.message })), 1000);
  saveTimer.unref?.();
}

async function update(rel) {
  if (!visible(rel)) return;
  const file = path.join(workerData.rootPath, rel);
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat || stat.isSymbolicLink()) {
    for (const key of [...index.keys()]) if (key === rel || key.startsWith(`${rel}/`)) index.delete(key);
  } else if (stat.isDirectory()) {
    await walk(rel);
  } else {
    await indexFile(rel);
  }
  scheduleCache();
}

function query(value) {
  const q = fold(value.trim());
  if (!q) return [];
  const hits = [];
  for (const entry of index.values()) {
    const inTitle = fold(entry.title).indexOf(q);
    const inText = fold(entry.text).indexOf(q);
    if (inTitle < 0 && inText < 0) continue;
    const source = inText >= 0 ? entry.text : entry.title;
    const at = inText >= 0 ? inText : inTitle;
    const start = Math.max(0, at - 48);
    const end = Math.min(source.length, start + 118);
    const snippet = `${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
    hits.push({ path: entry.path, snippet });
  }
  return hits;
}

let queue = Promise.resolve();
parentPort.on('message', message => {
  queue = queue.then(async () => {
    if (message.type === 'update') await update(message.path);
    else if (message.type === 'query') parentPort.postMessage({ type: 'result', id: message.id, hits: query(message.query) });
  }).catch(error => parentPort.postMessage({ type: 'error', id: message.id, message: error.message }));
});

queue = queue.then(async () => {
  const start = performance.now();
  const cached = await loadCache();
  const before = new Set(index.keys());
  await walk();
  for (const rel of before) {
    const stat = await fs.lstat(path.join(workerData.rootPath, rel)).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) index.delete(rel);
  }
  await writeCache();
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  parentPort.postMessage({ type: 'ready', stats: {
    files: index.size, cached, indexMs: Math.round(performance.now() - start), peakRss,
  } });
}).catch(error => parentPort.postMessage({ type: 'error', message: error.message }));

module.exports = { extract, fold };
