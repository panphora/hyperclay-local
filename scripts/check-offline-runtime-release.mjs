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

function insideBundle(versionDir, publicPath) {
  if (!publicPath || path.isAbsolute(publicPath) || publicPath.includes('\\')) return null;
  const file = path.resolve(versionDir, publicPath);
  const rel = path.relative(versionDir, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readIndex(file, label, problems) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    problems.push(`${label} is not readable JSON.`);
    return null;
  }
}

function checkVersion(version, selected, options, problems) {
  const versionDir = path.join(options.bundleRoot, version);
  let files = 0;
  const packed = packedPackage(version, options.packDir);
  try {
    const publishedFile = path.join(packed.dir, 'dist', INDEX);
    const published = fs.existsSync(publishedFile) ? readIndex(publishedFile, `the published ClayJS ${version} offline index`, problems) : null;
    if (!published) {
      if (!fs.existsSync(publishedFile)) {
        problems.push(`ClayJS ${version} as published has no offline index. Publish a ClayJS release that carries dist/offline-manifest.json, then re-vendor this host from it.`);
      }
      return 0;
    }
    const bundledFile = path.join(versionDir, INDEX);
    const bundled = fs.existsSync(bundledFile) ? readIndex(bundledFile, `the bundled ClayJS ${version} offline index`, problems) : null;
    if (!bundled) {
      if (!fs.existsSync(bundledFile)) problems.push(`the bundled ClayJS ${version} has no ${INDEX}.`);
      return 0;
    }
    if (!deepEqual(published, bundled)) {
      problems.push(`the bundled ClayJS ${version} is not the published release (its offline index differs). Re-vendor from the published package.`);
    }
    const entries = Object.entries(bundled.files || {});
    for (const [publicPath, entry] of entries) {
      const file = insideBundle(versionDir, publicPath);
      if (!file) {
        problems.push(`ClayJS ${version} lists ${JSON.stringify(publicPath)}, which is not a relative path inside its tree.`);
        continue;
      }
      let actual;
      try {
        actual = sha256(file);
      } catch {
        problems.push(`ClayJS ${version} is missing ${publicPath}, which its offline index lists.`);
        continue;
      }
      if (actual !== entry.sha256) problems.push(`the bundled ClayJS ${version} ${publicPath} does not match its offline index sha256.`);
    }
    files = entries.length;
    if (version === selected) {
      const publishedResolver = path.join(packed.dir, PUBLISHED_RESOLVER);
      const bundledResolver = path.join(options.bundleRoot, RESOLVER);
      let same = false;
      try {
        same = Buffer.compare(fs.readFileSync(bundledResolver), fs.readFileSync(publishedResolver)) === 0;
      } catch {
        same = false;
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
