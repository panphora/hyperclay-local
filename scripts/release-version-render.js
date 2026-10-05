'use strict';

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const ANY_VERSION = '\\d+\\.\\d+\\.\\d+';

function invalid(message) {
  return Object.assign(new Error(message), { code: 'RELEASE_VERSION_INVALID' });
}

function requireVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value) ||
      value.split('.').some(part => Number(part) > 65535)) {
    throw invalid('Release versions must be plain X.Y.Z with components at most 65535');
  }
  return value.split('.').map(Number);
}

function renderReleaseVersion(input, options) {
  const { packageJson, readme, website } = input || {};
  const { previousVersion, version } = options || {};
  if ([packageJson, readme, website].some(value => typeof value !== 'string')) {
    throw invalid('Release version input must contain three text files');
  }
  const before = requireVersion(previousVersion);
  const after = requireVersion(version);
  const firstDifference = after.findIndex((value, index) => value !== before[index]);
  if (firstDifference < 0 || after[firstDifference] < before[firstDifference]) {
    throw invalid('Release version must be greater than the previous version');
  }
  let pkg;
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    throw invalid('Release package.json must contain valid JSON');
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg) || pkg.version !== previousVersion) {
    throw invalid('Release package.json must match the previous version');
  }
  pkg.version = version;
  const rewrite = content => content
    .replace(new RegExp(`HyperclayLocal-Setup-${ANY_VERSION}`, 'g'), `HyperclayLocal-Setup-${version}`)
    .replace(new RegExp(`HyperclayLocal-${ANY_VERSION}`, 'g'), `HyperclayLocal-${version}`)
    .replace(new RegExp(`data-version="${ANY_VERSION}"`, 'g'), `data-version="${version}"`);
  return {
    packageJson: JSON.stringify(pkg, null, 2) + '\n',
    readme: rewrite(readme),
    website: rewrite(website),
  };
}

module.exports = { renderReleaseVersion };
