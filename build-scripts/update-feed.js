const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function macUpdateZips(files, version) {
  return files.filter((file) => file.endsWith('-mac.zip') && file.includes(`-${version}-`)).sort();
}

function fileEntry(dir, filename, baseUrl) {
  const bytes = fs.readFileSync(path.join(dir, filename));
  return {
    url: `${baseUrl}/${filename}`,
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
  const lines = [`version: ${version}`, 'files:'];
  for (const entry of entries) {
    lines.push(`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`);
  }
  lines.push(`path: ${entries[0].url}`, `sha512: ${entries[0].sha512}`, `releaseDate: '${releaseDate}'`);
  return lines.join('\n') + '\n';
}

module.exports = { macFeed, macUpdateZips };
