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

const selectedAliases = releases[manifest.selected]?.aliases ?? {};
const aliasHosts = [...new Set(Object.keys(selectedAliases).map((url) => new URL(url).host.toLowerCase()))];
const MAY_CANONICALIZE = /\/_\/clayjs\/|clay-runtime-map|&#|&sol;|&lowbar;/i;

// A document can only need projecting when it names clayjs (possibly with a character
// reference inside the URL) or the host of one of the release's exact aliases.
function mayProject(html) {
  const lower = html.toLowerCase();
  return lower.includes('clayjs') || lower.includes('&#') || aliasHosts.some((host) => lower.includes(host));
}

function projectHTML(html, options) {
  if (!mayProject(html)) return { html, mappings: [], skipped: [], unavailable: null };
  return projectRuntimeHTML(html, options);
}

function canonicalizeHTML(html, options) {
  if (!MAY_CANONICALIZE.test(html)) return { html, changed: 0, descriptorRemoved: false };
  return canonicalizeRuntimeHTML(html, options);
}

module.exports = { releases, selectedVersion: manifest.selected, resolve, resolveLocal,
  projectRuntimeHTML: projectHTML, canonicalizeRuntimeHTML: canonicalizeHTML, assetFor, readAsset };
