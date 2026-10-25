const fs = require('fs').promises;
const path = require('path');
const { resolveRuntimeURL } = require('./offline-runtime/resolver.cjs');

const manifest = require('./offline-runtime/manifest.json');
const root = path.join(__dirname, 'offline-runtime');

const releases = {};
for (const version of manifest.versions) {
  const index = require(path.join(root, version, 'offline-manifest.json'));
  releases[version] = { version: index.version, files: index.files, aliases: index.aliases };
}

function resolve(rawURL, { documentURL } = {}) {
  return resolveRuntimeURL(rawURL, { releases, selectedVersion: manifest.selected, documentURL });
}

function assetFor(version, publicPath) {
  const files = Object.hasOwn(releases, version) ? releases[version].files : null;
  if (!files || typeof publicPath !== 'string' || !Object.hasOwn(files, publicPath)) return null;
  const entry = files[publicPath];
  return {
    file: path.join(root, version, publicPath),
    type: entry.type,
    sha256: entry.sha256,
    bytes: entry.bytes,
  };
}

async function readAsset(version, publicPath) {
  const asset = assetFor(version, publicPath);
  if (!asset) throw new Error(`No bundled ClayJS asset ${version}/${publicPath}`);
  return fs.readFile(asset.file);
}

module.exports = { releases, selectedVersion: manifest.selected, resolve, assetFor, readAsset };
