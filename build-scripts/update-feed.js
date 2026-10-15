const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function macUpdateZips(files, version) {
  return files.filter((file) => file.endsWith('-mac.zip') && file.includes(`-${version}-`)).sort();
}

// The sha512 query gives every distinct build its own cache key, so a CDN never answers
// a feed with bytes cached for another one. Hex, because electron-updater matches "arm64"
// and the arch name against the whole url string.
function fileEntry(dir, filename, baseUrl) {
  const bytes = fs.readFileSync(path.join(dir, filename));
  return {
    url: `${baseUrl}/${filename}?sha512=${crypto.createHash('sha512').update(bytes).digest('hex')}`,
    sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
    size: bytes.length
  };
}

// electron-updater picks the arm64 entry on Apple silicon by looking for "arm64" in its
// url, so the feed needs exactly one zip with it and one without.
function macFeed({ dir, version, baseUrl, releaseDate }) {
  const zips = macUpdateZips(fs.readdirSync(dir), version);
  const x64 = zips.filter((file) => !file.includes('arm64'));
  const arm64 = zips.filter((file) => file.includes('arm64'));
  if (x64.length !== 1 || arm64.length !== 1) {
    throw new Error(`Expected one x64 and one arm64 mac update zip for v${version} in ${dir}, found: ${zips.join(', ') || 'none'}`);
  }
  const entries = [x64[0], arm64[0]].map((file) => fileEntry(dir, file, baseUrl));
  return renderFeed(version, entries, releaseDate);
}

function renderFeed(version, entries, releaseDate) {
  const lines = [`version: ${version}`, 'files:'];
  for (const entry of entries) {
    lines.push(`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`);
  }
  lines.push(`path: ${entries[0].url}`, `sha512: ${entries[0].sha512}`, `releaseDate: '${releaseDate}'`);
  return lines.join('\n') + '\n';
}

function windowsInstallers(files, version) {
  return files.filter((file) => file === `HyperclayLocal-Setup-${version}.exe`);
}

// The installer must be the signed file CI uploads: electron-updater checks this sha512
// before it checks the Authenticode signature.
function windowsFeed({ dir, version, baseUrl, releaseDate }) {
  const installers = windowsInstallers(fs.readdirSync(dir), version);
  if (installers.length !== 1) {
    throw new Error(`Expected HyperclayLocal-Setup-${version}.exe in ${dir}`);
  }
  return renderFeed(version, [fileEntry(dir, installers[0], baseUrl)], releaseDate);
}

function linuxAppImages(files, version) {
  return files.filter((file) => file === `HyperclayLocal-${version}.AppImage` || file === `HyperclayLocal-${version}-arm64.AppImage`).sort();
}

// appimage-runtime.js rewrites every AppImage after electron-builder has hashed it, so
// electron-builder's own latest-linux*.yml describe bytes that were never published.
// electron-updater asks for latest-linux-arm64.yml on arm64 and latest-linux.yml on x64.
function linuxFeeds({ dir, version, baseUrl, releaseDate }) {
  return linuxAppImages(fs.readdirSync(dir), version).map((file) => [
    file.endsWith('-arm64.AppImage') ? 'latest-linux-arm64.yml' : 'latest-linux.yml',
    renderFeed(version, [fileEntry(dir, file, baseUrl)], releaseDate)
  ]);
}

module.exports = { macFeed, macUpdateZips, windowsFeed, windowsInstallers, linuxFeeds, linuxAppImages };
