# Build Output Restructure Plan

## Goal
- Final distribution files (`.dmg`, `.exe`, `.AppImage`, etc.) in `dist/` at the top level
- Intermediate build artifacts (unpacked folders, debug files) in `dist/.build/` subdirectory
- Automatic cleanup before each build
- Clean separation between webpack output and electron-builder output

## Windows Build Process
- **Windows builds are done remotely via GitHub Actions** (`.github/workflows/build-and-sign-windows.yml`)
- Workflow triggers manually only via `npm run win-build:run`
- Signed installer must be downloaded with `npm run win-build:download`
  - **Auto-cleans old Windows builds before downloading** to prevent version accumulation
- Check build status with `npm run win-build:status`
- Local Windows build scripts have been removed (`build-windows-simple.js`, `build-windows-with-env.js`)
- The GitHub workflow outputs final `.exe` installer directly to `dist/`

## Changes Needed

### 1. Update `package.json` electron-builder configuration

**Current configuration (lines 35-42):**
```json
"build": {
  "appId": "com.hyperclay.local-server",
  "productName": "HyperclayLocal",
  "directories": {
    "output": "dist",
    "buildResources": "build"
  }
}
```

**Add to configuration:**
```json
"directories": {
  "output": "dist",
  "buildResources": "build",
  "app": "dist/.build"  // NEW: Moves unpacked app directories to dist/.build/
}
```

**Technical Details:**
- `directories.output` - Where final installers (.dmg, .exe, .AppImage) are placed
- `directories.buildResources` - Where icon files and build assets live (build/)
- `directories.app` - Where electron-builder stages the unpacked application before packaging
- By setting `app: "dist/.build"`, intermediate folders like `mac/`, `mac-arm64/`, `win-unpacked/` go into `dist/.build/` instead of `dist/`

### 2. Verify electron-builder behavior with intermediate directory

**What moves to `dist/.build/` (local builds only):**
- `mac/` - Unpacked macOS app (Intel)
- `mac-arm64/` - Unpacked macOS app (ARM64)
- `mac-universal/` - Unpacked universal macOS app (if built)
- `linux-unpacked/` - Unpacked Linux app
- `builder-debug.yml` - Debug configuration
- `builder-effective-config.yaml` - Effective configuration

**Windows artifacts (remote only, not downloaded):**
- `win-unpacked/` - Generated on GitHub Actions, never exists locally
- `.nsis.7z` - Generated on GitHub Actions, never exists locally

**What stays in `dist/`:**
- `*.dmg` - macOS disk images (Intel and ARM)
- `*.dmg.blockmap` - Block maps for delta updates
- `*.exe` - Windows installers
- `*.exe.blockmap` - Block maps for delta updates
- `*.AppImage` - Linux AppImage packages
- `latest-mac.yml` - macOS auto-update metadata (electron-updater)
- `latest.yml` - Windows auto-update metadata (electron-updater)
- `latest-linux.yml` - Linux auto-update metadata (electron-updater)
- `bundle.js*` - Webpack output (NOT moved, needed as source)

### 3. Verify webpack configuration (no changes needed)

**Current webpack output (config/webpack.config.js):**
```javascript
output: {
  path: path.resolve(__dirname, '../dist'),
  filename: 'bundle.js'
}
```

**Files generated:**
- `dist/bundle.js` - Compiled React application
- `dist/bundle.js.map` - Source maps for debugging
- `dist/bundle.js.LICENSE.txt` - Third-party license information

**Why these stay in `dist/`:**
- Webpack builds BEFORE electron-builder runs
- These files are SOURCE inputs to electron-builder (referenced in package.json `build.files`)
- electron-builder packages these into the final app
- They are NOT build artifacts; they are source code for the Electron app

### 4. Update `build-scripts/clean-dist.js`

**Current behavior:**
- `cleanAll()` - Removes everything in `dist/` EXCEPT `bundle.js*` files
- `cleanMac()` - Removes `dist/mac/`, `dist/mac-arm64/`, `*.dmg`, `latest-mac.yml`
- `cleanWindows()` - Removes `dist/win-unpacked/`, `*.exe`, `latest.yml`
- `cleanLinux()` - Removes `dist/linux-unpacked/`, `*.AppImage`, `latest-linux.yml`

**Changes needed:**

1. **Update `cleanMac()` to also check `dist/.build/`:**
```javascript
cleanMac() {
  removeIfExists(path.join(distDir, 'mac'), 'dist/mac/');
  removeIfExists(path.join(distDir, 'mac-arm64'), 'dist/mac-arm64/');
  removeIfExists(path.join(distDir, '.build/mac'), 'dist/.build/mac/');  // NEW
  removeIfExists(path.join(distDir, '.build/mac-arm64'), 'dist/.build/mac-arm64/');  // NEW
  // ... rest of function
}
```

2. **Update `cleanWindows()` - only clean final installer:**
```javascript
cleanWindows() {
  console.log(`${colors.blue}🧹 Cleaning Windows build artifacts...${colors.reset}`);
  let cleaned = false;

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
```

**What changed:**
- Removed `win-unpacked/` cleanup - never exists locally with remote builds
- Only cleans `.exe`, `.exe.blockmap`, `.nsis.7z` (if somehow present), and `latest.yml`
- Simplified logic since we don't need to handle intermediate directories

3. **Update `cleanLinux()` similarly:**
```javascript
cleanLinux() {
  removeIfExists(path.join(distDir, 'linux-unpacked'), 'dist/linux-unpacked/');
  removeIfExists(path.join(distDir, '.build/linux-unpacked'), 'dist/.build/linux-unpacked/');  // NEW
  // ... rest of function
}
```

4. **Update `cleanAll()` to handle `.build/` folder:**
```javascript
cleanAll() {
  // Current logic preserves bundle.js*
  // Add: Also clean dist/.build/ directory entirely
  removeIfExists(path.join(distDir, '.build'), 'dist/.build/');  // NEW
}
```

**New function to add:**
```javascript
function cleanIntermediate() {
  console.log(`${colors.blue}🧹 Cleaning intermediate build artifacts only...${colors.reset}`);
  removeIfExists(path.join(distDir, '.build'), 'dist/.build/');
}
```

### 5. Update build scripts to auto-clean

**Current npm scripts (package.json lines 25-27):**
```json
"build-all": "npm run build-icons && npm run clean && npm run build-css && npm run build-react-prod && electron-builder --mac --linux",
"build-mac": "npm run build-icons && npm run clean-mac && npm run build-css && npm run build-react-prod && electron-builder --mac",
"build-linux": "npm run build-icons && npm run clean-linux && npm run build-css && npm run build-react-prod && electron-builder --linux"
```

**Analysis - Already correct!**
The scripts already call clean commands BEFORE building:
1. `build-icons` - Generate platform icons
2. `clean-mac` / `clean-windows` / `clean-linux` - Remove old build artifacts
3. `build-css` - Compile Tailwind CSS
4. `build-react-prod` - Webpack production build → generates `bundle.js`
5. `electron-builder` - Package the app using `bundle.js` as input

**Order is correct:**
- Clean happens AFTER icon generation (icons are source files)
- Clean happens BEFORE webpack build
- electron-builder runs AFTER webpack completes

**No changes needed to npm scripts** - they already have proper ordering.

### 6. Add `.gitignore` entry

**Current `.gitignore` likely has:**
```
dist/
node_modules/
```

**Add specific entry:**
```
# Keep existing
dist/

# Add explicit entry for intermediate builds (for clarity/documentation)
dist/.build/
```

**Note:** Since `dist/` is already ignored, `dist/.build/` is technically already covered. However, adding an explicit entry documents the structure and makes it clear that `.build/` is intentionally separated.

### 7. Verify GitHub Actions workflow compatibility

**Workflow: `.github/workflows/build-and-sign-windows.yml`**

**Current relevant steps:**
```yaml
- name: Build unsigned installer with electron-builder
  run: npm run clean-windows && npx electron-builder --win

- name: Sign installer with Azure Trusted Signing
  run: |
    $installerPath = Resolve-Path "dist\HyperclayLocal-Setup-*.exe"
    # ... signing commands

- name: Upload signed installer
  uses: actions/upload-artifact@v4
  with:
    name: hyperclay-local-windows-signed
    path: dist/HyperclayLocal-Setup-*.exe
```

**Impact of `dist/.build/` change:**
- ✅ Final `.exe` installer still goes to `dist/` (not affected)
- ✅ `win-unpacked/` now goes to `dist/.build/win-unpacked/` (workflow doesn't care)
- ✅ Workflow only looks for `dist/*.exe` files - will continue to work
- ✅ `clean-windows` will clean both locations after update

**Download behavior:**
```bash
npm run win-build:download
# Runs: gh run download --name hyperclay-local-windows-signed --dir dist
```
- Downloads artifact to `dist/HyperclayLocal-Setup-1.1.0.exe`
- Only downloads the final `.exe` installer - NOT `win-unpacked/` or other intermediate files
- ✅ Correct location, no changes needed

**What GitHub Actions uploads as artifacts:**
```yaml
- name: Upload signed installer
  with:
    name: hyperclay-local-windows-signed
    path: dist/HyperclayLocal-Setup-*.exe  # Only the .exe, not win-unpacked/
```
This means `win-unpacked/` stays on the GitHub Actions runner and is never available locally.

## Expected Final Structure

```
dist/
├── bundle.js                           # Webpack output (kept)
├── bundle.js.map                       # Webpack output (kept)
├── bundle.js.LICENSE.txt               # Webpack output (kept)
├── HyperclayLocal-Setup-1.1.0.exe      # Windows installer (downloaded from GitHub Actions)
├── HyperclayLocal-Setup-1.1.0.exe.blockmap  # (if downloaded from GitHub Actions)
├── HyperclayLocal-1.1.0.dmg            # macOS Intel (built locally)
├── HyperclayLocal-1.1.0.dmg.blockmap
├── HyperclayLocal-1.1.0-arm64.dmg      # macOS ARM (built locally)
├── HyperclayLocal-1.1.0-arm64.dmg.blockmap
├── HyperclayLocal-1.1.0.AppImage       # Linux (built locally, optional)
├── latest-mac.yml                      # Auto-update metadata (macOS)
├── latest.yml                          # Auto-update metadata (Windows - downloaded from GitHub)
├── latest-linux.yml                    # Auto-update metadata (Linux, if built)
└── .build/                             # Intermediate artifacts (LOCAL BUILDS ONLY)
    ├── mac/                            # macOS unpacked (Intel)
    ├── mac-arm64/                      # macOS unpacked (ARM)
    ├── linux-unpacked/                 # Linux unpacked (if built)
    ├── builder-debug.yml               # Debug configuration
    └── builder-effective-config.yaml   # Effective configuration
```

**Important Notes:**
- **Windows intermediate artifacts never exist locally** - `win-unpacked/` and `.nsis.7z` are only generated on GitHub Actions runners
- **Only the final signed `.exe` is downloaded** to your local `dist/` folder via `npm run win-build:download`
- **Local `dist/.build/` only contains macOS and Linux unpacked apps** from local builds

## Implementation Order

### Step 1: Update `.gitignore` (safeguard)
Add explicit `dist/.build/` entry for documentation purposes.

**File:** `.gitignore`
```diff
dist/
+dist/.build/
node_modules/
```

### Step 2: Update `package.json` electron-builder config
Add `"app": "dist/.build"` to directories configuration.

**File:** `package.json` (lines ~35-42)
```diff
"directories": {
  "output": "dist",
  "buildResources": "build",
+ "app": "dist/.build"
}
```

### Step 3: Test local build (macOS only for now)
```bash
npm run build-mac
```

**Expected output structure:**
```
dist/
├── bundle.js
├── HyperclayLocal-1.1.0.dmg
├── HyperclayLocal-1.1.0-arm64.dmg
├── latest-mac.yml
└── .build/
    ├── mac/
    ├── mac-arm64/
    └── builder-*.yml
```

**If test fails:** Check electron-builder logs, verify `directories.app` is respected.

### Step 4: Update `clean-dist.js`
Add cleanup for both old locations and new `.build/` locations.

**File:** `build-scripts/clean-dist.js`
- Update `cleanMac()` - add `.build/mac*` cleanup
- Update `cleanWindows()` - add `.build/win-unpacked` cleanup
- Update `cleanLinux()` - add `.build/linux-unpacked` cleanup
- Update `cleanAll()` - add entire `.build/` cleanup

See Section 4 above for specific code changes.

### Step 5: Update npm scripts

**1. Update `win-build:download` in package.json:**
```diff
- "win-build:download": "gh run download --name hyperclay-local-windows-signed --dir dist"
+ "win-build:download": "npm run clean-windows && gh run download --name hyperclay-local-windows-signed --dir dist"
```

**Why:** Automatically cleans old Windows installers before downloading new ones.

**2. Verify other build scripts (no changes needed):**
The npm scripts already have correct ordering:
```
build-icons → clean → build-css → build-react-prod → electron-builder
```

### Step 6: Test Windows build remotely
```bash
# Trigger remote build
npm run win-build:run

# Wait ~5-10 minutes, check status
npm run win-build:status

# When complete, download (auto-cleans old Windows builds first)
npm run win-build:download
```

**Expected behavior:**
1. Removes old `HyperclayLocal-Setup-*.exe` files
2. Removes old `latest.yml` file
3. Downloads new `dist/HyperclayLocal-Setup-1.1.0.exe`

### Step 7: Test Linux build (if needed)
```bash
npm run build-linux
```

**Expected output structure:**
```
dist/
├── HyperclayLocal-1.1.0.AppImage
├── latest-linux.yml
└── .build/
    └── linux-unpacked/
```

### Step 8: Clean up old artifacts
```bash
npm run clean
```

Should remove:
- Old `dist/mac/`, `dist/mac-arm64/` folders (replaced by `dist/.build/mac*`)
- Old `dist/win-unpacked/` folder (from old local Windows builds - no longer supported)
- Old `dist/linux-unpacked/` folder (replaced by `dist/.build/linux-unpacked`)
- Old DMG files with "Hyperclay Local" naming (space in name)

**Going forward:**
- `win-unpacked/` will never be recreated locally (Windows builds are remote-only)
- Only `dist/.build/mac*` and `dist/.build/linux-unpacked` will exist locally

## Current Issues to Fix

- Outdated DMG files (v1.0.0 instead of v1.1.0) with old naming "Hyperclay Local" (space)
- Missing Windows installer locally (must download from GitHub Actions)
- Unnecessary unpacked folders at root level (`mac/`, `mac-arm64/`, `win-unpacked/` from old builds)
- Development bundle instead of production build in some cases

**Note:** `win-unpacked/` should never exist locally going forward - Windows builds are remote-only.

## Technical Background

### electron-builder Directory Configuration

electron-builder uses several directory options in `package.json`:

| Option | Purpose | Default | Our Setting |
|--------|---------|---------|-------------|
| `output` | Where final installers go | `dist` | `dist` |
| `buildResources` | Source assets (icons, etc.) | `build` | `build` |
| `app` | Unpacked app staging directory | `{output}/{platform}-unpacked` | `dist/.build` |

### Why Separate Intermediate from Final?

**Problems with current structure:**
1. Hard to identify what to upload/distribute (`dist/` has mix of files)
2. Large unpacked folders clutter the output
3. Debug YAML files mixed with distribution files
4. Harder to `.gitignore` selectively

**Benefits of `dist/.build/` separation:**
1. Clear distinction: `dist/*.dmg` = distribute, `dist/.build/` = ignore
2. Cleaner upload scripts (just grab `*.dmg`, `*.exe`, `*.AppImage`)
3. Faster git operations (fewer large files to scan)
4. Better for CI/CD artifact management

### Build Process Flow

```
Source Code
    ↓
[1] npm run build-icons
    ↓ (generates build/icon.icns, build/icon.ico)
[2] npm run clean-mac
    ↓ (removes old dist/mac/, dist/*.dmg, dist/.build/)
[3] npm run build-css
    ↓ (generates src/renderer/styles/renderer.css)
[4] npm run build-react-prod
    ↓ (webpack → dist/bundle.js)
[5] electron-builder --mac
    ↓
    ├─→ Stages unpacked app in dist/.build/mac/
    ├─→ Packages to dist/HyperclayLocal-1.1.0.dmg
    └─→ Generates dist/latest-mac.yml
```

### File Size Reference

Typical file sizes (v1.1.0):
- `bundle.js` - ~200 KB (webpack output)
- `bundle.js.map` - ~900 KB (source maps)
- `icon.icns` - ~250 KB (macOS icon)
- `icon.ico` - ~120 KB (Windows icon)
- `HyperclayLocal-1.1.0.dmg` - ~115 MB (macOS Intel)
- `HyperclayLocal-1.1.0-arm64.dmg` - ~107 MB (macOS ARM)
- `HyperclayLocal-Setup-1.1.0.exe` - ~90 MB (Windows installer)
- `dist/.build/mac/` - ~180 MB (unpacked, temporary)

## Notes

- All builds will use `HyperclayLocal` (no space) for consistency across platforms
- Current old builds have "Hyperclay Local" (with space) - these will be cleaned up
- The `dist/.build/` folder can be safely deleted anytime - it's regenerated on each build
- Only final installers (`.dmg`, `.exe`, `.AppImage`) and `bundle.js*` should be in `dist/` root

### Local vs Remote Build Artifacts

**Local machine (`dist/.build/`):**
- `mac/` and `mac-arm64/` - from local macOS builds
- `linux-unpacked/` - from local Linux builds (optional)
- `builder-*.yml` - from any local electron-builder run

**GitHub Actions only (never local):**
- `win-unpacked/` - Windows unpacked app (stays on runner)
- `.nsis.7z` - NSIS temporary files (stays on runner)

**Downloaded from GitHub Actions:**
- `HyperclayLocal-Setup-1.1.0.exe` - final signed installer only
