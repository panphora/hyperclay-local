const fs = require('fs').promises;
const path = require('path');
const { resolveRuntimeURL, parseRuntimeURL, projectRuntimeHTML, canonicalizeRuntimeHTML } = require('./offline-runtime/resolver.cjs');

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

// The same resolution for a URL that is already one of this host's own:
// `resolveRuntimeURL` answers null to a `/_/clayjs/` URL because there is nothing to
// project, and the route serving those bytes needs the opposite answer.
function resolveLocal(rawURL, { documentURL } = {}) {
  const parsed = parseRuntimeURL(rawURL, { documentURL });
  if (!parsed || parsed.kind !== 'local') return null;
  const files = Object.hasOwn(releases, parsed.version) ? releases[parsed.version].files : null;
  return {
    kind: 'local',
    version: parsed.version,
    path: parsed.path,
    search: parsed.search,
    hash: parsed.hash,
    available: Boolean(files && Object.hasOwn(files, parsed.path)),
    canonicalURL: rawURL,
    localURL: `/_/clayjs/${parsed.version}/${parsed.rawPath}${parsed.search}${parsed.hash}`,
  };
}

async function readAsset(version, publicPath) {
  const asset = assetFor(version, publicPath);
  if (!asset) throw new Error(`No bundled ClayJS asset ${version}/${publicPath}`);
  return fs.readFile(asset.file);
}

// Parsing a large document costs seconds, and most documents name no runtime URL at all.
// A projection only rewrites clayjs.com URLs, and a canonicalization only undoes this
// host's /_/clayjs/ addresses and descriptor, so a document with neither is returned as is.
const MAY_PROJECT = /clayjs\.com/i;
const MAY_CANONICALIZE = /\/_\/clayjs\/|clay-runtime-map/i;

function projectHTML(html, options) {
  if (!MAY_PROJECT.test(html)) return { html, mappings: [], skipped: [], unavailable: [] };
  return projectRuntimeHTML(html, options);
}

function canonicalizeHTML(html, options) {
  if (!MAY_CANONICALIZE.test(html)) return { html, changed: 0, descriptorRemoved: false };
  return canonicalizeRuntimeHTML(html, options);
}

module.exports = { releases, selectedVersion: manifest.selected, resolve, resolveLocal,
  projectRuntimeHTML: projectHTML, canonicalizeRuntimeHTML: canonicalizeHTML, assetFor, readAsset };
