#!/usr/bin/env node

/**
 * Update version numbers in external documentation files.
 *
 * Usage:
 *   node scripts/update-external-docs.js           # Uses version from package.json
 *   node scripts/update-external-docs.js 1.2.0    # Uses specified version
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');
const PARENT_DIR = path.join(ROOT_DIR, '..');

const STATIC_FILES = [
  {
    path: path.join(PARENT_DIR, 'hyperclay/server-pages/hyperclay-local.edge'),
    name: 'hyperclay-local.edge'
  }
];

const DOCS_DIR = path.join(PARENT_DIR, 'hyperclay-website/vault/DOCS');

function findDocsFile() {
  if (!fs.existsSync(DOCS_DIR)) return null;
  const files = fs.readdirSync(DOCS_DIR).filter(f =>
    f.endsWith('.md') && /hyperclay local/i.test(f)
  );
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
    if (/HyperclayLocal-\d+\.\d+\.\d+/.test(content)) {
      return { path: path.join(DOCS_DIR, file), name: file };
    }
  }
  return null;
}

// ============================================
// COLORS
// ============================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function logSuccess(msg) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function logWarn(msg) { console.log(`${colors.yellow}⚠${colors.reset} ${msg}`); }
function logError(msg) { console.log(`${colors.red}✗${colors.reset} ${msg}`); }
function logInfo(msg) { console.log(`${colors.blue}→${colors.reset} ${msg}`); }

// ============================================
// GIT HELPERS
// ============================================

function git(repoPath, cmd) {
  return execSync(`git ${cmd}`, { cwd: repoPath, encoding: 'utf8' }).trim();
}

function isRepoDirty(repoPath) {
  const status = git(repoPath, 'status --porcelain');
  return status.length > 0;
}

function stashRepo(repoPath) {
  const repoName = path.basename(repoPath);
  if (isRepoDirty(repoPath)) {
    git(repoPath, 'stash push -m "temp: update-external-docs"');
    logInfo(`Stashed changes in ${repoName}`);
    return true;
  }
  return false;
}

function commitAndPushFile(filePath, version) {
  const repoPath = findGitRoot(filePath);
  const relativePath = path.relative(repoPath, filePath);
  const repoName = path.basename(repoPath);

  git(repoPath, `add "${relativePath}"`);
  git(repoPath, `commit -m "chore: update Hyperclay Local download links to v${version}"`);
  git(repoPath, 'push');
  logSuccess(`Committed and pushed in ${repoName}`);
}

function popStash(repoPath) {
  const repoName = path.basename(repoPath);
  git(repoPath, 'stash pop');
  logInfo(`Restored stashed changes in ${repoName}`);
}

function findGitRoot(filePath) {
  let dir = path.dirname(filePath);
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`No git repo found for ${filePath}`);
}

// ============================================
// VERSION DETECTION
// ============================================

function getCurrentVersion() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function detectOldVersion(content) {
  // Look for version pattern in download URLs
  const match = content.match(/HyperclayLocal-(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

// ============================================
// UPDATE LOGIC
// ============================================

function updateVersionInContent(content, oldVersion, newVersion) {
  // Replace all version occurrences in download URLs and filenames
  // Patterns: HyperclayLocal-X.X.X and HyperclayLocal-Setup-X.X.X
  const oldEscaped = oldVersion.replace(/\./g, '\\.');

  let updated = content;

  // HyperclayLocal-X.X.X (dmg, AppImage)
  updated = updated.replace(
    new RegExp(`HyperclayLocal-${oldEscaped}`, 'g'),
    `HyperclayLocal-${newVersion}`
  );

  // HyperclayLocal-Setup-X.X.X (exe)
  updated = updated.replace(
    new RegExp(`HyperclayLocal-Setup-${oldEscaped}`, 'g'),
    `HyperclayLocal-Setup-${newVersion}`
  );

  return updated;
}

// ============================================
// MAIN
// ============================================

function main() {
  const targetVersion = process.argv[2] || getCurrentVersion();

  console.log('');
  console.log(`${colors.cyan}Updating external docs to version ${targetVersion}${colors.reset}`);
  console.log('');

  // Build file list: static files + dynamically discovered docs file
  const allFiles = [...STATIC_FILES];
  const docsFile = findDocsFile();
  if (docsFile) {
    allFiles.push(docsFile);
  } else {
    logWarn('No "Hyperclay Local" docs file with download links found in vault/DOCS/');
  }

  // First pass: identify files that need updating
  let skippedCount = 0;
  const filesToUpdate = [];

  for (const file of allFiles) {
    if (!fs.existsSync(file.path)) {
      logWarn(`Skipped ${file.name} (file not found)`);
      logInfo(`  Expected: ${file.path}`);
      skippedCount++;
      continue;
    }

    const content = fs.readFileSync(file.path, 'utf8');
    const oldVersion = detectOldVersion(content);

    if (!oldVersion) {
      logWarn(`Skipped ${file.name} (no version found in file)`);
      skippedCount++;
      continue;
    }

    if (oldVersion === targetVersion) {
      logSuccess(`${file.name} already at ${targetVersion}`);
      continue;
    }

    const updatedContent = updateVersionInContent(content, oldVersion, targetVersion);
    filesToUpdate.push({ ...file, oldVersion, updatedContent });
  }

  if (filesToUpdate.length === 0) {
    console.log('');
    if (skippedCount === allFiles.length) {
      logError('No files were updated (all skipped or not found)');
      process.exit(1);
    } else {
      console.log('All files already up to date.');
    }
    console.log('');
    return;
  }

  // Stash dirty repos before making changes
  const stashedRepos = new Set();
  for (const file of filesToUpdate) {
    const repoPath = findGitRoot(file.path);
    if (!stashedRepos.has(repoPath) && stashRepo(repoPath)) {
      stashedRepos.add(repoPath);
    }
  }

  // Write updates
  for (const file of filesToUpdate) {
    fs.writeFileSync(file.path, file.updatedContent);
    logSuccess(`Updated ${file.name} (${file.oldVersion} → ${targetVersion})`);
  }

  // Commit and push
  console.log('');
  for (const file of filesToUpdate) {
    commitAndPushFile(file.path, targetVersion);
  }

  // Pop stashes
  for (const repoPath of stashedRepos) {
    popStash(repoPath);
  }

  console.log('');
  console.log(`${colors.green}Updated and pushed ${filesToUpdate.length} file(s)${colors.reset}`);
  console.log('');
}

main();
