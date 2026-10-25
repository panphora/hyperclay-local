#!/usr/bin/env node

// The host ships a ClayJS release it did not build. The lock records a version, so a tree
// vendored from a checkout 151 commits past the tag would ship under that tag's name. This
// proves the bundled tree is byte-identical to the published npm release of the locked version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'check-offline-runtime-release';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(ROOT_DIR, 'offline-runtime.lock.json');
const BUNDLE_ROOT = path.join(ROOT_DIR, 'src/main/offline-runtime');
const INDEX = 'offline-manifest.json';
const RESOLVER = 'resolver.cjs';
const PUBLISHED_RESOLVER = 'dist/server/offline-runtime.cjs';

// The app reads exactly these files out of the bundle root: src/main/runtime-assets.js
// requires resolver.cjs, manifest.json and each listed version's offline-manifest.json.
const SHIPPED_MANIFEST = 'manifest.json';
const BUNDLE_ROOT_FILES = [SHIPPED_MANIFEST, RESOLVER];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { packDir: null, bundleRoot: BUNDLE_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--pack-dir' || arg === '--bundle-root') {
      if (!value || value.startsWith('--')) fail(`${arg} needs a directory`);
      options[arg === '--pack-dir' ? 'packDir' : 'bundleRoot'] = path.resolve(value);
      i += 1;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  return options;
}

function readLock() {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  if (!lock.selected || !Array.isArray(lock.versions) || !lock.versions.length) fail('offline-runtime.lock.json needs selected and versions');
  if (!lock.versions.includes(lock.selected)) fail('offline-runtime.lock.json selected is not in versions');
  return lock;
}

function packedPackage(version, packDir) {
  if (packDir) return { dir: path.join(packDir, version, 'package'), tmp: null };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-`));
  try {
    execFileSync('npm', ['pack', `@panphora/clayjs@${version}`, '--pack-destination', tmp, '--silent', '--min-release-age=0'], {
      cwd: tmp, stdio: ['ignore', 'pipe', 'pipe']
    });
    const tarball = fs.readdirSync(tmp).find(name => name.endsWith('.tgz'));
    if (!tarball) fail(`npm pack @panphora/clayjs@${version} wrote no tarball`);
    execFileSync('tar', ['-xzf', path.join(tmp, tarball), '-C', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { dir: path.join(tmp, 'package'), tmp };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function inside(container, relative) {
  if (!relative || typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) return null;
  const file = path.resolve(container, relative);
  const rel = path.relative(container, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

function insideBundle(versionDir, publicPath) {
  return inside(versionDir, publicPath);
}

function insidePackage(packageDir, source) {
  return inside(packageDir, source);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function regularFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// The shipped selector is what the app actually reads: src/main/runtime-assets.js requires
// <bundle-root>/manifest.json. It must agree with the lock the gate just verified.
function checkShippedManifest(options, lock, problems) {
  const file = path.join(options.bundleRoot, SHIPPED_MANIFEST);
  if (!regularFile(file)) {
    problems.push(fs.existsSync(file)
      ? `the shipped offline runtime ${SHIPPED_MANIFEST} is not a regular file.`
      : `the shipped offline runtime has no ${SHIPPED_MANIFEST}, so the release the app selects is unrecorded.`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    problems.push(`the shipped offline runtime ${SHIPPED_MANIFEST} is not readable JSON.`);
    return;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push(`the shipped offline runtime ${SHIPPED_MANIFEST} is not a JSON object.`);
    return;
  }
  if (!deepEqual(manifest.selected, lock.selected) || !deepEqual(manifest.versions, lock.versions)) {
    problems.push(`the shipped offline runtime ${SHIPPED_MANIFEST} does not match offline-runtime.lock.json (selected ${JSON.stringify(manifest.selected)}, versions ${JSON.stringify(manifest.versions)}).`);
  }
  if (!Array.isArray(manifest.versions) || !manifest.versions.includes(manifest.selected)) {
    problems.push(`the shipped offline runtime ${SHIPPED_MANIFEST} selects ${JSON.stringify(manifest.selected)}, which its versions list omits.`);
  }
}

// Nothing may sit beside the versions the app serves: only the manifest and resolver it reads.
function checkBundleRoot(options, lock, problems) {
  let entries;
  try {
    entries = fs.readdirSync(options.bundleRoot, { withFileTypes: true });
  } catch {
    problems.push(`the offline runtime bundle at ${options.bundleRoot} is not a readable directory.`);
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      problems.push(`the offline runtime bundle carries ${entry.name}, which is not a regular file or directory.`);
      continue;
    }
    if (entry.isDirectory()) {
      if (!lock.versions.includes(entry.name)) {
        problems.push(`the bundle carries the directory ${entry.name}/, which offline-runtime.lock.json does not list as a version.`);
      }
      continue;
    }
    if (!BUNDLE_ROOT_FILES.includes(entry.name)) {
      problems.push(`the bundle carries ${entry.name}, which src/main/runtime-assets.js does not read.`);
    }
  }
}

function readIndex(file, version, label, problems) {
  if (!regularFile(file)) {
    problems.push(`${label} is not a regular file.`);
    return null;
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    problems.push(`${label} is not readable JSON.`);
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${label} is not a JSON object.`);
    return null;
  }
  if (value.schema !== 1) {
    problems.push(`${label} has schema ${JSON.stringify(value.schema)}, not 1.`);
    return null;
  }
  if (value.version !== version) {
    problems.push(`${label} declares version ${JSON.stringify(value.version)}, not ${version}.`);
    return null;
  }
  const files = value.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    problems.push(`${label} lists no files.`);
    return null;
  }
  return value;
}

// Every regular file under the version is either listed by the index or the index itself.
function checkVersionTree(version, versionDir, bundled, problems) {
  const listed = new Set(Object.keys(bundled.files));
  listed.add(INDEX);
  const visit = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        problems.push(`ClayJS ${version} carries ${relative}, which is not a regular file.`);
        continue;
      }
      if (entry.isDirectory()) {
        visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!listed.has(relative)) {
        problems.push(`ClayJS ${version} carries ${relative}, which its offline index does not list.`);
      }
    }
  };
  visit(versionDir, '');
}

// Each listed entry names its source inside the published package. Those bytes are the ones
// the index describes, so a package that carries something else is not the release.
function checkPublishedAssets(version, packageDir, entries, problems) {
  for (const [publicPath, entry] of entries) {
    const source = entry && typeof entry.source === 'string' ? entry.source : null;
    const file = source ? insidePackage(packageDir, source) : null;
    if (!file) {
      problems.push(`ClayJS ${version} lists ${publicPath} with source ${JSON.stringify(entry && entry.source)}, which is not a relative path inside the published package.`);
      continue;
    }
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      problems.push(`ClayJS ${version} as published is missing ${source}, which its offline index lists for ${publicPath}.`);
      continue;
    }
    if (sha256(bytes) !== entry.sha256) {
      problems.push(`the published ClayJS ${version} ${publicPath} does not match its offline index sha256.`);
      continue;
    }
    if (Number.isInteger(entry.bytes) && bytes.length !== entry.bytes) {
      problems.push(`the published ClayJS ${version} ${publicPath} is ${bytes.length} bytes, but its offline index records ${entry.bytes}.`);
    }
  }
}

function checkVersion(version, selected, options, problems) {
  const versionDir = path.join(options.bundleRoot, version);
  let files = 0;
  const packed = packedPackage(version, options.packDir);
  try {
    const publishedFile = path.join(packed.dir, 'dist', INDEX);
    if (!fs.existsSync(publishedFile)) {
      problems.push(`ClayJS ${version} as published has no offline index. Publish a ClayJS release that carries dist/offline-manifest.json, then re-vendor this host from it.`);
      return 0;
    }
    const published = readIndex(publishedFile, version, `the published ClayJS ${version} offline index`, problems);
    if (!published) return 0;
    const bundledFile = path.join(versionDir, INDEX);
    if (!fs.existsSync(bundledFile)) {
      problems.push(`the bundled ClayJS ${version} has no ${INDEX}.`);
      return 0;
    }
    const bundled = readIndex(bundledFile, version, `the bundled ClayJS ${version} offline index`, problems);
    if (!bundled) return 0;
    if (!deepEqual(published, bundled)) {
      problems.push(`the bundled ClayJS ${version} is not the published release (its offline index differs). Re-vendor from the published package.`);
      return 0;
    }
    const entries = Object.entries(bundled.files);
    for (const [publicPath, entry] of entries) {
      const file = insideBundle(versionDir, publicPath);
      if (!file) {
        problems.push(`ClayJS ${version} lists ${JSON.stringify(publicPath)}, which is not a relative path inside its tree.`);
        continue;
      }
      let actual;
      try {
        actual = sha256(fs.readFileSync(file));
      } catch {
        problems.push(`ClayJS ${version} is missing ${publicPath}, which its offline index lists.`);
        continue;
      }
      if (actual !== entry.sha256) problems.push(`the bundled ClayJS ${version} ${publicPath} does not match its offline index sha256.`);
    }
    files = entries.length;
    checkVersionTree(version, versionDir, bundled, problems);
    checkPublishedAssets(version, packed.dir, entries, problems);
    if (version === selected) {
      const publishedResolver = path.join(packed.dir, PUBLISHED_RESOLVER);
      const bundledResolver = path.join(options.bundleRoot, RESOLVER);
      let same = false;
      if (regularFile(bundledResolver)) {
        try {
          same = Buffer.compare(fs.readFileSync(bundledResolver), fs.readFileSync(publishedResolver)) === 0;
        } catch {
          same = false;
        }
      }
      if (!same) problems.push(`the bundled resolver is not the published ClayJS ${version}'s dist/server/offline-runtime.cjs`);
    }
    return files;
  } finally {
    if (packed.tmp) fs.rmSync(packed.tmp, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = readLock();
  const problems = [];
  const results = [];
  checkBundleRoot(options, lock, problems);
  checkShippedManifest(options, lock, problems);
  for (const version of lock.versions) {
    let files = 0;
    try {
      files = checkVersion(version, lock.selected, options, problems);
    } catch (err) {
      const detail = String(err.stderr || '').trim().split('\n').slice(-3).join(' ');
      problems.push(`${version} could not be checked: ${detail || err.message}`);
    }
    results.push({ version, files });
  }
  for (const problem of problems) console.error(`${NAME}: ${problem}`);
  if (problems.length) {
    process.exitCode = 1;
    return;
  }
  for (const { version, files } of results) {
    console.log(`offline runtime: ${version} matches the published ClayJS release (${files} files)`);
  }
}

try {
  main();
} catch (err) {
  console.error(`${NAME}: ${err.message}`);
  process.exitCode = 1;
}
