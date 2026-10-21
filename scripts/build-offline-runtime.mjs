import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = dirname(require.resolve('@panphora/clayjs/package.json'));
const destination = join(repo, 'src/main/offline-runtime');
const templates = join(repo, 'src/main/document-templates');
const { version: clayjsVersion } = require('@panphora/clayjs/package.json');
const { resolveModules } = await import(pathToFileURL(join(packageRoot, 'src/loader-logic.js')));
const ids = ['page', 'blank', 'devlog', 'kanban', 'landing'];
const urls = new Set();
const paths = new Set();
const queue = [];
const plans = [];

function add(rel) {
  if (paths.has(rel)) return;
  paths.add(rel);
  queue.push(rel);
}

function packagePath(urlPath) {
  const rel = urlPath.replace(/^\/v1\//, '');
  if (rel.startsWith('src/')) return rel;
  if (rel === 'clay.standalone.js') return `dist/${rel}`;
  return `entries/${rel}`;
}

for (const id of ids) {
  const $ = load(await readFile(join(templates, `${id}.html`), 'utf8'));
  $('[src], [href]').each((_, element) => {
    const value = $(element).attr('src') || $(element).attr('href');
    if (!value?.startsWith('https://clayjs.com/v1/')) return;
    const url = new URL(value);
    urls.add(url.href);
    add(packagePath(url.pathname));
    if (url.pathname.endsWith('/clay.js')) plans.push(resolveModules(url.searchParams, true));
  });
}

add('src/loader.js');
add('src/core/draft-mode.js');
add('src/core/is-edit-mode.js');
add('src/lib/region-policy.js');
for (const plan of plans) for (const rel of [...plan.core, ...plan.plugins]) add(`src/${rel}`);
for (const theme of await readdir(join(packageRoot, 'src/page/themes'))) {
  if (theme.endsWith('.css')) add(`src/page/themes/${theme}`);
}

function references(source) {
  const found = [];
  const literal = /\b(?:from\s*|import\s*\(\s*|import\s*|export\s+[^;]*?from\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of source.matchAll(literal)) found.push(match[1]);
  for (const match of source.matchAll(/\bbase\s*\+\s*["']\/(src\/[^"']+)["']/g)) found.push(`/${match[1]}`);
  for (const match of source.matchAll(/\bimport\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const assignment = new RegExp(`\\b(?:const|let)\\s+${match[1]}\\s*=\\s*["'](\\.{1,2}\\/[^"']+)["']`).exec(source);
    if (!assignment) throw new Error(`Unresolved dynamic import ${match[1]}`);
    found.push(assignment[1]);
  }
  return found;
}

while (queue.length) {
  const rel = queue.shift();
  const source = await readFile(join(packageRoot, rel), 'utf8');
  if (rel === 'src/loader-logic.js') continue;
  if (!rel.endsWith('.js')) continue;
  for (const specifier of references(source)) {
    const next = specifier.startsWith('/') ? specifier.slice(1) : join(dirname(rel), specifier);
    const normalized = relative(packageRoot, resolve(packageRoot, next));
    if (normalized.startsWith('..') || normalized === '') throw new Error(`Import escapes ClayJS: ${rel} -> ${specifier}`);
    add(normalized);
  }
}

await mkdir(destination, { recursive: true });
const files = [];
const contentType = rel => extname(rel) === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
for (const rel of [...paths].sort()) {
  const bytes = await readFile(join(packageRoot, rel));
  const served = rel.startsWith('src/') ? rel : rel.replace(/^(entries|dist)\//, '');
  const url = `https://clayjs.com/v1/${served}`;
  const variants = [...urls].filter(value => new URL(value).pathname === new URL(url).pathname);
  if (!variants.length) variants.push(url);
  await mkdir(dirname(join(destination, served)), { recursive: true });
  await writeFile(join(destination, served), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const variant of variants) files.push({ url: variant, path: served, sha256, contentType: contentType(served) });
}
files.sort((a, b) => a.url.localeCompare(b.url));
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ clayjsVersion, files }, null, 2) + '\n');

async function removeStale(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await removeStale(file);
    else if (relative(destination, file) !== 'manifest.json' && ![...paths].some(rel =>
      (rel.startsWith('src/') ? rel : rel.replace(/^(entries|dist)\//, '')) === relative(destination, file))) await unlink(file);
  }
}
await removeStale(destination);
