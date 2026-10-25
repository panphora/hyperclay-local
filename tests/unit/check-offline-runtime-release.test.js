'use strict';

// The gate that stops a release whose bundled ClayJS runtime is not the published release.
// Every fixture is a scratch tree under the OS temp directory: a tiny bundled runtime, a
// matching unpacked package for --pack-dir, and one broken variant per failure. Nothing here
// touches the network or the real vendored runtime.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-offline-runtime-release.mjs');
const NAME = 'check-offline-runtime-release';
const LOCK = JSON.parse(fs.readFileSync(path.join(REPO, 'offline-runtime.lock.json'), 'utf8'));
const VERSION = LOCK.selected;

const FILES = {
  'all.js': { source: 'dist/all.js', type: 'text/javascript; charset=utf-8' },
  'page/index.html': { source: 'dist/page/index.html', type: 'text/html; charset=utf-8' }
};
const RESOLVER = 'module.exports = 1;\n';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function indexFor(version, contents) {
  const files = {};
  for (const [publicPath, entry] of Object.entries(FILES)) {
    files[publicPath] = { source: entry.source, sha256: sha256(contents[publicPath]), bytes: contents[publicPath].length, type: entry.type };
  }
  return { schema: 1, version, chunkBuild: 'fixture', files, aliases: {}, onlineOnly: [] };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${NAME}-test-`));
  const contents = {};
  for (const publicPath of Object.keys(FILES)) contents[publicPath] = Buffer.from(`/* ${publicPath} */\n`);
  const bundle = path.join(root, 'bundle');
  const versionDir = path.join(bundle, VERSION);
  for (const [publicPath, bytes] of Object.entries(contents)) write(path.join(versionDir, publicPath), bytes);
  write(path.join(versionDir, 'offline-manifest.json'), JSON.stringify(indexFor(VERSION, contents), null, 2) + '\n');
  write(path.join(bundle, 'resolver.cjs'), RESOLVER);
  const pack = path.join(root, 'pack');
  const packageRoot = path.join(pack, VERSION, 'package');
  write(path.join(packageRoot, 'dist/offline-manifest.json'), JSON.stringify(indexFor(VERSION, contents), null, 2) + '\n');
  write(path.join(packageRoot, 'dist/server/offline-runtime.cjs'), RESOLVER);
  return { root, bundle, pack, packageRoot, versionDir, contents };
}

function run(tree) {
  return spawnSync(process.execPath, [SCRIPT, '--pack-dir', tree.pack, '--bundle-root', tree.bundle], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
}

function problems(result) {
  return result.stderr.split('\n').filter(Boolean);
}

describe('check-offline-runtime-release', () => {
  const trees = [];
  function tree() {
    const made = fixture();
    trees.push(made.root);
    return made;
  }

  afterEach(() => {
    while (trees.length) fs.rmSync(trees.pop(), { recursive: true, force: true });
  });

  test('accepts a bundled runtime that is byte-identical to the published release', () => {
    const result = run(tree());
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`offline runtime: ${VERSION} matches the published ClayJS release (2 files)\n`);
    expect(result.stderr).toBe('');
  });

  test('refuses a published release that carries no offline index', () => {
    const made = tree();
    fs.rmSync(path.join(made.packageRoot, 'dist/offline-manifest.json'));
    const result = run(made);
    expect(result.status).toBe(1);
    expect(problems(result)).toEqual([
      `${NAME}: ClayJS ${VERSION} as published has no offline index. Publish a ClayJS release that carries dist/offline-manifest.json, then re-vendor this host from it.`
    ]);
  });

  test('refuses a bundled index that differs from the published one', () => {
    const made = tree();
    const index = JSON.parse(fs.readFileSync(path.join(made.packageRoot, 'dist/offline-manifest.json'), 'utf8'));
    index.files['all.js'].sha256 = '0'.repeat(64);
    fs.writeFileSync(path.join(made.packageRoot, 'dist/offline-manifest.json'), JSON.stringify(index, null, 2) + '\n');
    const result = run(made);
    expect(result.status).toBe(1);
    expect(problems(result)).toEqual([
      `${NAME}: the bundled ClayJS ${VERSION} is not the published release (its offline index differs). Re-vendor from the published package.`
    ]);
  });

  test('refuses a bundled file whose bytes do not match the index', () => {
    const made = tree();
    write(path.join(made.versionDir, 'all.js'), Buffer.from('/* tampered */\n'));
    const result = run(made);
    expect(result.status).toBe(1);
    expect(problems(result)).toEqual([
      `${NAME}: the bundled ClayJS ${VERSION} all.js does not match its offline index sha256.`
    ]);
  });

  test('refuses a bundled resolver that is not the published resolver', () => {
    const made = tree();
    write(path.join(made.bundle, 'resolver.cjs'), 'module.exports = 2;\n');
    const result = run(made);
    expect(result.status).toBe(1);
    expect(problems(result)).toEqual([
      `${NAME}: the bundled resolver is not the published ClayJS ${VERSION}'s dist/server/offline-runtime.cjs`
    ]);
  });
});
