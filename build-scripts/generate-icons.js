#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const SOURCE_ICON = path.join(BUILD_DIR, 'icon-1024.png');

console.log('🎨 Generating platform-specific icons...\n');

// Ensure build directory exists
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// Check if source icon exists, generate if possible
if (!fs.existsSync(SOURCE_ICON)) {
  const SVG_SOURCE = path.join(ROOT_DIR, 'assets', 'icons', 'icon.svg');

  if (commandExists('rsvg-convert') && fs.existsSync(SVG_SOURCE)) {
    console.log('🔄 Generating icon from SVG...');
    if (exec(
      `rsvg-convert -w 1024 -h 1024 -b white "${SVG_SOURCE}" -o "${SOURCE_ICON}"`,
      'Converting SVG to PNG with white background'
    )) {
      console.log(`   ✅ Created: ${SOURCE_ICON}\n`);
    } else {
      console.error('❌ Failed to convert SVG');
      process.exit(1);
    }
  } else {
    console.error('❌ Error: Source icon not found at', SOURCE_ICON);
    console.error('   Please run: rsvg-convert -w 1024 -h 1024 -b white assets/icons/icon.svg -o build/icon-1024.png');
    process.exit(1);
  }
}

function exec(command, description) {
  try {
    console.log(`   ${description}...`);
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Tray icons are generated manually - skipping automatic generation
console.log('⏭️  Skipping tray icon generation (using manually created icons)\n');

// Generate macOS .icns
if (process.platform === 'darwin' || commandExists('sips')) {
  console.log('📱 Generating macOS icon (.icns)...');

  const iconsetDir = path.join(BUILD_DIR, `temp-${process.pid}.iconset`);

  // Create iconset directory
  if (fs.existsSync(iconsetDir)) {
    fs.rmSync(iconsetDir, { recursive: true });
  }
  fs.mkdirSync(iconsetDir);

  // Generate all required sizes using sips
  const sizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
  ];

  for (const { size, name } of sizes) {
    const outputPath = path.join(iconsetDir, name);
    exec(
      `sips -z ${size} ${size} "${SOURCE_ICON}" --out "${outputPath}"`,
      `Generating ${name}`
    );
  }

  // Copy 1024x1024 for 512@2x
  fs.copyFileSync(SOURCE_ICON, path.join(iconsetDir, 'icon_512x512@2x.png'));
  console.log('   Generating icon_512x512@2x.png...');

  // Convert iconset to icns
  const icnsPath = path.join(BUILD_DIR, 'icon.icns');
  if (exec(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, 'Converting to .icns')) {
    console.log(`   ✅ Created: ${icnsPath}\n`);
  }

  // Clean up
  fs.rmSync(iconsetDir, { recursive: true });
} else {
  console.log('⚠️  Skipping macOS .icns generation (sips/iconutil not available)\n');
}

// Generate Windows .ico
if (commandExists('magick') || commandExists('convert')) {
  console.log('🪟 Generating Windows icon (.ico)...');

  const icoPath = path.join(BUILD_DIR, 'icon.ico');
  const magickCmd = commandExists('magick') ? 'magick' : 'convert';

  if (exec(
    `${magickCmd} "${SOURCE_ICON}" -define icon:auto-resize=256,128,64,48,32,16 "${icoPath}"`,
    'Converting to .ico'
  )) {
    console.log(`   ✅ Created: ${icoPath}\n`);
  }
} else {
  console.log('⚠️  Skipping Windows .ico generation (ImageMagick not available)');
  console.log('   Install with: brew install imagemagick\n');
}

// Copy source icon for Linux
console.log('🐧 Copying icon for Linux...');
const linuxIconPath = path.join(BUILD_DIR, 'icon.png');
fs.copyFileSync(SOURCE_ICON, linuxIconPath);
console.log(`   ✅ Created: ${linuxIconPath}\n`);

console.log('✨ Icon generation complete!\n');
