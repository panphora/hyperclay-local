#!/usr/bin/env node

/**
 * Clean dist folder for specific platforms
 *
 * Usage:
 *   node build-scripts/clean-dist.js         # Clean all
 *   node build-scripts/clean-dist.js mac     # Clean macOS artifacts only
 *   node build-scripts/clean-dist.js windows # Clean Windows artifacts only
 *   node build-scripts/clean-dist.js linux   # Clean Linux artifacts only
 */

const fs = require('fs');
const path = require('path');
const { rimrafSync } = require('rimraf');

const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m'
};

const distDir = path.join(__dirname, '..', 'dist');
const platform = process.argv[2]?.toLowerCase();

function removeIfExists(itemPath, description) {
  if (fs.existsSync(itemPath)) {
    rimrafSync(itemPath);
    console.log(`  ${colors.green}✓${colors.reset} Removed ${description}`);
    return true;
  }
  return false;
}

function cleanMac() {
  console.log(`${colors.blue}🧹 Cleaning macOS build artifacts...${colors.reset}`);
  let cleaned = false;

  cleaned |= removeIfExists(path.join(distDir, 'mac'), 'dist/mac/');
  cleaned |= removeIfExists(path.join(distDir, 'mac-arm64'), 'dist/mac-arm64/');
  cleaned |= removeIfExists(path.join(distDir, 'mac-universal'), 'dist/mac-universal/');

  // Remove DMG files
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.dmg') || file.endsWith('.dmg.blockmap')) {
        removeIfExists(path.join(distDir, file), `dist/${file}`);
        cleaned = true;
      }
    });
  }

  // Remove macOS yml files
  cleaned |= removeIfExists(path.join(distDir, 'latest-mac.yml'), 'dist/latest-mac.yml');

  if (!cleaned) {
    console.log(`  ${colors.yellow}→${colors.reset} No macOS artifacts found to clean`);
  }
}

function cleanWindows() {
  console.log(`${colors.blue}🧹 Cleaning Windows build artifacts...${colors.reset}`);
  let cleaned = false;

  // Note: win-unpacked folders never exist locally (Windows builds are remote-only)
  // But we clean them for backwards compatibility if they somehow exist
  cleaned |= removeIfExists(path.join(distDir, 'win-unpacked'), 'dist/win-unpacked/');
  cleaned |= removeIfExists(path.join(distDir, 'win-ia32-unpacked'), 'dist/win-ia32-unpacked/');

  // Remove EXE and NSIS files
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.exe') || file.endsWith('.exe.blockmap') || file.endsWith('.nsis.7z')) {
        removeIfExists(path.join(distDir, file), `dist/${file}`);
        cleaned = true;
      }
    });
  }

  // Remove Windows yml files
  cleaned |= removeIfExists(path.join(distDir, 'latest.yml'), 'dist/latest.yml');

  if (!cleaned) {
    console.log(`  ${colors.yellow}→${colors.reset} No Windows artifacts found to clean`);
  }
}

function cleanLinux() {
  console.log(`${colors.blue}🧹 Cleaning Linux build artifacts...${colors.reset}`);
  let cleaned = false;

  cleaned |= removeIfExists(path.join(distDir, 'linux-unpacked'), 'dist/linux-unpacked/');
  cleaned |= removeIfExists(path.join(distDir, 'linux-arm64-unpacked'), 'dist/linux-arm64-unpacked/');
  cleaned |= removeIfExists(path.join(distDir, 'linux-armv7l-unpacked'), 'dist/linux-armv7l-unpacked/');

  // Remove AppImage files
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.AppImage') || file.endsWith('.snap') || file.endsWith('.deb') || file.endsWith('.rpm')) {
        removeIfExists(path.join(distDir, file), `dist/${file}`);
        cleaned = true;
      }
    });
  }

  // Remove Linux yml files
  cleaned |= removeIfExists(path.join(distDir, 'latest-linux.yml'), 'dist/latest-linux.yml');

  if (!cleaned) {
    console.log(`  ${colors.yellow}→${colors.reset} No Linux artifacts found to clean`);
  }
}

function cleanAll() {
  console.log(`${colors.blue}🧹 Cleaning all build artifacts...${colors.reset}`);

  if (fs.existsSync(distDir)) {
    const items = fs.readdirSync(distDir);
    let cleaned = false;

    items.forEach(item => {
      const itemPath = path.join(distDir, item);
      // Skip popover-bundle.js and related webpack output
      if (item === 'popover-bundle.js' ||
          item === 'popover-bundle.js.map' ||
          item === 'popover-bundle.js.LICENSE.txt') {
        return;
      }

      // Remove everything else
      const isDir = fs.statSync(itemPath).isDirectory();
      rimrafSync(itemPath);
      const suffix = isDir ? '/' : '';
      console.log(`  ${colors.green}✓${colors.reset} Removed dist/${item}${suffix}`);
      cleaned = true;
    });

    if (!cleaned) {
      console.log(`  ${colors.yellow}→${colors.reset} No artifacts found to clean (popover-bundle.js preserved)`);
    }
  } else {
    console.log(`  ${colors.yellow}→${colors.reset} dist/ folder doesn't exist`);
  }
}

// Main execution
console.log('');

switch(platform) {
  case 'mac':
  case 'macos':
  case 'darwin':
    cleanMac();
    break;
  case 'win':
  case 'windows':
    cleanWindows();
    break;
  case 'linux':
    cleanLinux();
    break;
  default:
    cleanAll();
}

console.log('');
