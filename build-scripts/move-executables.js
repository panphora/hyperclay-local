#!/usr/bin/env node

/**
 * Move final executable installers from dist/ to executables/
 *
 * This script moves the distribution-ready installers (.dmg, .exe, .AppImage, etc.)
 * from the dist/ folder to a dedicated executables/ folder, keeping dist/ clean
 * for intermediate build artifacts.
 *
 * Usage:
 *   node build-scripts/move-executables.js         # Move all executables
 *   node build-scripts/move-executables.js mac     # Move only macOS executables
 *   node build-scripts/move-executables.js windows # Move only Windows executables
 *   node build-scripts/move-executables.js linux   # Move only Linux executables
 */

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const distDir = path.join(__dirname, '..', 'dist');
const executablesDir = path.join(__dirname, '..', 'executables');
const platform = process.argv[2]?.toLowerCase();

// Ensure executables directory exists
if (!fs.existsSync(executablesDir)) {
  fs.mkdirSync(executablesDir, { recursive: true });
  console.log(`${colors.cyan}📁 Created executables/ directory${colors.reset}`);
}

function moveFile(sourcePath, filename) {
  const destPath = path.join(executablesDir, filename);

  if (fs.existsSync(sourcePath)) {
    // If destination exists, remove it first
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }

    fs.renameSync(sourcePath, destPath);
    console.log(`  ${colors.green}✓${colors.reset} Moved ${filename} → executables/`);
    return true;
  }
  return false;
}

function moveMacExecutables() {
  console.log(`${colors.blue}📦 Moving macOS executables...${colors.reset}`);
  let moved = false;

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.dmg') || file.endsWith('.dmg.blockmap')) {
        moved |= moveFile(path.join(distDir, file), file);
      }
    });

    // Move latest-mac.yml for auto-updates
    const macYml = 'latest-mac.yml';
    if (fs.existsSync(path.join(distDir, macYml))) {
      moved |= moveFile(path.join(distDir, macYml), macYml);
    }
  }

  if (!moved) {
    console.log(`  ${colors.yellow}→${colors.reset} No macOS executables found to move`);
  }
}

function moveWindowsExecutables() {
  console.log(`${colors.blue}📦 Moving Windows executables...${colors.reset}`);
  let moved = false;

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.exe') || file.endsWith('.exe.blockmap')) {
        moved |= moveFile(path.join(distDir, file), file);
      }
    });

    // Move latest.yml for auto-updates
    const winYml = 'latest.yml';
    if (fs.existsSync(path.join(distDir, winYml))) {
      moved |= moveFile(path.join(distDir, winYml), winYml);
    }
  }

  if (!moved) {
    console.log(`  ${colors.yellow}→${colors.reset} No Windows executables found to move`);
  }
}

function moveLinuxExecutables() {
  console.log(`${colors.blue}📦 Moving Linux executables...${colors.reset}`);
  let moved = false;

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      if (file.endsWith('.AppImage') || file.endsWith('.snap') ||
          file.endsWith('.deb') || file.endsWith('.rpm')) {
        moved |= moveFile(path.join(distDir, file), file);
      }
    });

    // Move latest-linux.yml for auto-updates
    const linuxYml = 'latest-linux.yml';
    if (fs.existsSync(path.join(distDir, linuxYml))) {
      moved |= moveFile(path.join(distDir, linuxYml), linuxYml);
    }
  }

  if (!moved) {
    console.log(`  ${colors.yellow}→${colors.reset} No Linux executables found to move`);
  }
}

function moveAllExecutables() {
  console.log(`${colors.blue}📦 Moving all executables...${colors.reset}`);
  let moved = false;

  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    files.forEach(file => {
      // Move all installer files and update metadata
      if (file.endsWith('.dmg') || file.endsWith('.dmg.blockmap') ||
          file.endsWith('.exe') || file.endsWith('.exe.blockmap') ||
          file.endsWith('.AppImage') || file.endsWith('.snap') ||
          file.endsWith('.deb') || file.endsWith('.rpm') ||
          file === 'latest-mac.yml' || file === 'latest.yml' || file === 'latest-linux.yml') {
        moved |= moveFile(path.join(distDir, file), file);
      }
    });
  }

  if (!moved) {
    console.log(`  ${colors.yellow}→${colors.reset} No executables found to move`);
  }
}

// Main execution
console.log('');

switch(platform) {
  case 'mac':
  case 'macos':
  case 'darwin':
    moveMacExecutables();
    break;
  case 'win':
  case 'windows':
    moveWindowsExecutables();
    break;
  case 'linux':
    moveLinuxExecutables();
    break;
  default:
    moveAllExecutables();
}

console.log('');
console.log(`${colors.cyan}✨ Executables are now in: ./executables/${colors.reset}`);
console.log('');
