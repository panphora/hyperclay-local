#!/usr/bin/env node

// The build now happens on a runner, so the installers never exist on this machine
// and their sizes cannot be read off disk. The release workflow measures them and
// publishes them in release-info.json; this reads that back and writes the numbers
// into the two places a human sees them.
//
// Every replacement is anchored on the filename it belongs to, never on a bare size
// pattern: the two files hold four sizes each, and an unanchored match would happily
// write the Linux number over the Windows one.
//
//   node scripts/write-download-sizes.js            # from published release-info.json
//   node scripts/write-download-sizes.js <path>     # from a local copy

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const RELEASE_INFO_URL = 'https://local.hyperclay.com/release-info.json';

function formatSize(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadReleaseInfo(source) {
  if (source) {
    return JSON.parse(fs.readFileSync(source, 'utf8'));
  }
  // Cache-busted: R2 sits behind a CDN, and reading back a stale copy would write
  // the previous release's sizes over the one just published.
  const response = await fetch(`${RELEASE_INFO_URL}?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Could not read ${RELEASE_INFO_URL}: HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const info = await loadReleaseInfo(process.argv[2]);

  if (!info.sizes) {
    throw new Error(
      `release-info.json for ${info.version} carries no sizes map. ` +
      'It was published before the workflow started recording them.'
    );
  }

  const pkgVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
  ).version;

  // Writing one version's sizes next to another version's download links would be
  // silently wrong on a live page, so refuse rather than guess.
  if (info.version !== pkgVersion) {
    throw new Error(
      `Published release is ${info.version} but this tree is ${pkgVersion}. ` +
      'Wait for the release to finish, or check out the version that shipped.'
    );
  }

  const targets = [
    // README: [HyperclayLocal-1.2.3.dmg](url) (101.9MB)
    {
      file: 'README.md',
      pattern: (name) => new RegExp(`(${escapeRegExp(name)}\\)) \\([^)]*\\)`, 'g'),
      replacement: (mb) => `$1 (${mb}MB)`,
    },
    // website: <a ... >HyperclayLocal-1.2.3.dmg</a> then the next dl-size span
    {
      file: 'website/index.html',
      pattern: (name) =>
        new RegExp(`(${escapeRegExp(name)}</a>\\s*<span class="dl-size">)[^<]*`, 'g'),
      replacement: (mb) => `$1${mb} MB`,
    },
  ];

  for (const target of targets) {
    const filePath = path.join(ROOT_DIR, target.file);
    let content = fs.readFileSync(filePath, 'utf8');

    for (const [name, bytes] of Object.entries(info.sizes)) {
      const mb = formatSize(bytes);
      const pattern = target.pattern(name);
      if (!pattern.test(content)) {
        throw new Error(`${target.file} has no size to update for ${name}`);
      }
      content = content.replace(target.pattern(name), target.replacement(mb));
    }

    fs.writeFileSync(filePath, content);
    console.log(`  ${target.file} updated for v${info.version}`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
