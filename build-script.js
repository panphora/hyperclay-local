#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🏗️  Building Hyperclay Local Server (Electron)...\n');

// Check if we're on the right platform for certain builds
const platform = process.platform;
const arch = process.arch;

console.log(`📋 Build environment:`);
console.log(`   Platform: ${platform}`);
console.log(`   Architecture: ${arch}`);
console.log(`   Node.js: ${process.version}\n`);

// Function to run command and handle errors
function runCommand(command, description) {
  console.log(`🔨 ${description}...`);
  try {
    const output = execSync(command, { stdio: 'pipe', encoding: 'utf8' });
    if (output.trim()) {
      console.log(`   ${output.trim()}`);
    }
    console.log(`✅ ${description} completed\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed:`);
    console.error(`   ${error.message}\n`);
    return false;
  }
}

// Create a simple icon if none exists
const iconPath = path.join(__dirname, 'assets', 'icon.png');
if (!fs.existsSync(iconPath)) {
  console.log('📱 Creating placeholder icon...');
  // Create a simple 512x512 PNG using Node.js (requires a PNG library, or we skip)
  console.log('⚠️  No icon found - electron-builder will use default\n');
}

// Check dependencies
console.log('📦 Checking dependencies...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const hasElectron = packageJson.devDependencies?.electron;
  const hasBuilder = packageJson.devDependencies?.['electron-builder'];
  
  if (!hasElectron || !hasBuilder) {
    console.log('⚠️  Missing dependencies. Installing...');
    runCommand('npm install', 'Installing dependencies');
  } else {
    console.log('✅ Dependencies OK\n');
  }
} catch (error) {
  console.error('❌ Could not check package.json');
  process.exit(1);
}

// Build options
const builds = [];

// Determine which builds to run based on arguments
const args = process.argv.slice(2);
const buildAll = args.includes('--all') || args.length === 0;
const buildMac = buildAll || args.includes('--mac');
const buildWin = buildAll || args.includes('--win') || args.includes('--windows');
const buildLinux = buildAll || args.includes('--linux');

if (buildMac && (platform === 'darwin' || buildAll)) {
  builds.push({
    command: 'npm run build-mac',
    description: 'Building for macOS',
    platform: 'macOS'
  });
}

if (buildWin) {
  builds.push({
    command: 'npm run build-windows',
    description: 'Building for Windows',
    platform: 'Windows'
  });
}

if (buildLinux && (platform === 'linux' || buildAll)) {
  builds.push({
    command: 'npm run build-linux',
    description: 'Building for Linux',
    platform: 'Linux'
  });
}

if (builds.length === 0) {
  console.log('⚠️  No builds specified or platform not supported');
  console.log('📋 Usage: node build-script.js [--mac] [--windows] [--linux] [--all]');
  process.exit(0);
}

// Run builds
console.log(`🚀 Starting ${builds.length} build(s)...\n`);

let successful = 0;
let failed = 0;

for (const build of builds) {
  if (runCommand(build.command, build.description)) {
    successful++;
  } else {
    failed++;
    // Continue with other builds even if one fails
  }
}

// Summary
console.log('📊 Build Summary:');
console.log(`   ✅ Successful: ${successful}`);
console.log(`   ❌ Failed: ${failed}`);

if (successful > 0) {
  console.log('\n📦 Built applications are in the dist/ folder');
  
  // List built files
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath);
    console.log('\n📁 Generated files:');
    files.forEach(file => {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      const size = (stats.size / 1024 / 1024).toFixed(1);
      console.log(`   ${file} (${size} MB)`);
    });
  }
}

if (failed > 0) {
  console.log('\n⚠️  Some builds failed. Check error messages above.');
  process.exit(1);
} else {
  console.log('\n🎉 All builds completed successfully!');
}