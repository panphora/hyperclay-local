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

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');
const PARENT_DIR = path.join(ROOT_DIR, '..');

const EXTERNAL_FILES = [
  {
    path: path.join(PARENT_DIR, 'hyperclay/server-pages/hyperclay-local.edge'),
    name: 'hyperclay-local.edge'
  },
  {
    path: path.join(PARENT_DIR, 'hyperclay-website/vault/DOCS/12 Hyperclay Local - Desktop App Documentation.md'),
    name: 'Hyperclay Local Documentation.md'
  }
];

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
  // Get target version
  const targetVersion = process.argv[2] || getCurrentVersion();

  console.log('');
  console.log(`${colors.cyan}Updating external docs to version ${targetVersion}${colors.reset}`);
  console.log('');

  let updatedCount = 0;
  let skippedCount = 0;
  const updatedFiles = [];

  for (const file of EXTERNAL_FILES) {
    // Check if file exists
    if (!fs.existsSync(file.path)) {
      logWarn(`Skipped ${file.name} (file not found)`);
      logInfo(`  Expected: ${file.path}`);
      skippedCount++;
      continue;
    }

    // Read content
    const content = fs.readFileSync(file.path, 'utf8');

    // Detect old version
    const oldVersion = detectOldVersion(content);
    if (!oldVersion) {
      logWarn(`Skipped ${file.name} (no version found in file)`);
      skippedCount++;
      continue;
    }

    // Check if already up to date
    if (oldVersion === targetVersion) {
      logSuccess(`${file.name} already at ${targetVersion}`);
      continue;
    }

    // Update content
    const updatedContent = updateVersionInContent(content, oldVersion, targetVersion);

    // Write back
    fs.writeFileSync(file.path, updatedContent);
    logSuccess(`Updated ${file.name} (${oldVersion} → ${targetVersion})`);
    updatedFiles.push(file);
    updatedCount++;
  }

  // Summary
  console.log('');
  if (updatedCount > 0) {
    console.log(`${colors.green}Updated ${updatedCount} file(s)${colors.reset}`);
    console.log('');
    console.log(`${colors.yellow}Remember to commit these changes in their respective repos:${colors.reset}`);
    updatedFiles.forEach(file => {
      console.log(`  ${file.path}`);
    });
  } else if (skippedCount === EXTERNAL_FILES.length) {
    logError('No files were updated (all skipped or not found)');
    process.exit(1);
  } else {
    console.log('All files already up to date.');
  }
  console.log('');
}

main();
