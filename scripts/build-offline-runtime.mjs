import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(repo, 'src/main/offline-runtime');
const lock = JSON.parse(await readFile(join(repo, 'offline-runtime.lock.json'), 'utf8'));

function fail(message) {
  throw new Error(message);
}

function parseRoots(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--package-root') fail(`unknown argument ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail('--package-root needs a directory');
    roots.push(resolve(value));
    i += 1;
  }
  return roots;
}

async function versionOf(root) {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  } catch {
    return fail(`${root} is not a ClayJS package (no readable package.json)`);
  }
}

function checkLock() {
  if (!lock.selected || !Array.isArray(lock.versions) || !lock.versions.length) fail('offline-runtime.lock.json needs selected and versions');
  if (lock.versions[0] !== lock.selected) fail('offline-runtime.lock.json lists the selected version first');
  if (!lock.versions.includes(lock.selected)) fail('offline-runtime.lock.json selected is not in versions');
}

async function rootsByVersion() {
  const found = new Map();
  for (const root of parseRoots(process.argv.slice(2))) {
    const version = await versionOf(root);
    if (found.has(version)) fail(`two --package-root directories declare ClayJS ${version}`);
    found.set(version, root);
  }
  const installed = dirname(require.resolve('@panphora/clayjs/package.json'));
  const installedVersion = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version;
  for (const version of lock.versions) {
    if (found.has(version)) continue;
    if (installedVersion === version) found.set(version, installed);
    else fail(`ClayJS ${version} is locked but no --package-root provides it (the installed @panphora/clayjs is ${installedVersion})`);
  }
  return found;
}

function insideStaging(directory, publicPath) {
  if (!publicPath || isAbsolute(publicPath) || publicPath.includes('\\')) fail(`public path ${JSON.stringify(publicPath)} is not relative`);
  const file = resolve(directory, publicPath);
  const rel = relative(directory, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail(`public path ${JSON.stringify(publicPath)} escapes the release directory`);
  return file;
}

async function stageRelease(version, packageRoot, versionStaging) {
  const indexFile = join(packageRoot, 'dist/offline-manifest.json');
  let index;
  try {
    index = JSON.parse(await readFile(indexFile, 'utf8'));
  } catch {
    fail(`ClayJS ${version} has no offline index; pass --package-root <built checkout>`);
  }
  if (index.version !== version) fail(`ClayJS ${version}'s offline index declares ${index.version}`);
  if (index.schema !== 1) fail(`ClayJS ${version}'s offline index has schema ${index.schema}, not 1`);
  let bytes = 0;
  for (const [publicPath, entry] of Object.entries(index.files)) {
    const target = insideStaging(versionStaging, publicPath);
    const sourceFile = insideStaging(packageRoot, entry.source);
    let source;
    try {
      source = await readFile(sourceFile);
    } catch {
      fail(`ClayJS ${version}'s index names ${entry.source} for ${publicPath}, which the package does not carry`);
    }
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (sha256 !== entry.sha256) fail(`ClayJS ${version}/${publicPath}: bytes do not match the index`);
    if (source.length !== entry.bytes) fail(`ClayJS ${version}/${publicPath}: ${source.length} bytes, index says ${entry.bytes}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    bytes += source.length;
  }
  await writeFile(join(versionStaging, 'offline-manifest.json'), JSON.stringify(index, null, 2) + '\n');
  const { verifyOfflineClosure } = await import(pathToFileURL(join(packageRoot, 'scripts/verify-offline-closure.mjs')).href);
  const result = await verifyOfflineClosure({ publishedRoot: versionStaging });
  if (result.problems.length) fail(`ClayJS ${version} is not an offline closure:\n  ${result.problems.join('\n  ')}`);
  return { files: Object.keys(index.files).length, bytes };
}

async function main() {
  checkLock();
  const roots = await rootsByVersion();
  let staging = join(destination, `.staging-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  const totals = { files: 0, bytes: 0 };
  for (const version of lock.versions) {
    const staged = await stageRelease(version, roots.get(version), join(staging, version));
    totals.files += staged.files;
    totals.bytes += staged.bytes;
    console.log(`ClayJS ${version}: ${staged.files} files, ${(staged.bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  await copyFile(join(roots.get(lock.selected), 'dist/server/offline-runtime.cjs'), join(staging, 'resolver.cjs'));
  await writeFile(join(staging, 'manifest.json'), JSON.stringify({
    schema: 1,
    selected: lock.selected,
    versions: lock.versions,
    files: totals.files,
  }, null, 2) + '\n');

  const aside = join(repo, `src/main/offline-runtime.old-${process.pid}`);
  await rename(destination, aside);
  staging = join(aside, `.staging-${process.pid}`);
  try {
    await rename(staging, destination);
  } catch (err) {
    await rename(aside, destination);
    throw err;
  }
  await rm(aside, { recursive: true, force: true });
  console.log(`offline runtime: ${totals.files} files, ${(totals.bytes / 1024 / 1024).toFixed(2)} MB, selected ${lock.selected}`);
}

main().catch(err => {
  console.error(`build-offline-runtime: ${err.message}`);
  process.exit(1);
});
