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
- Check build status with `npm run win-build:status`
- Local Windows build scripts have been removed (`build-windows-simple.js`, `build-windows-with-env.js`)
- The GitHub workflow outputs final `.exe` installer directly to `dist/`

## Changes Needed

### 1. Update `package.json` electron-builder configuration
- Add `buildResources` directory pointing to `build/`
- Configure `directories.output` to keep as `dist`
- Add `directories.buildResources` as `dist/.build` for intermediate files
- Ensure all platform configs (mac, win, linux) produce only final installers in `dist/`

### 2. Modify electron-builder to use intermediate directory
Configure electron-builder's working directory to use `dist/.build/` for:
- Unpacked app directories (`mac/`, `mac-arm64/`, `win-unpacked/`, etc.)
- NSIS temporary files (`.nsis.7z`)
- Builder YAML files (`builder-debug.yml`, `builder-effective-config.yaml`)

Keep only final artifacts in `dist/`:
- DMG files and blockmaps
- EXE installer files and blockmaps
- AppImage files
- Auto-update metadata files (`latest-mac.yml`, `latest.yml`, etc.)

### 3. Update webpack configuration
- Keep `bundle.js`, `bundle.js.map`, `bundle.js.LICENSE.txt` in `dist/`
- These are needed as source files for electron-builder

### 4. Update `clean-dist.js` script
- Preserve `bundle.js*` files (webpack output - source for electron-builder)
- Remove all electron-builder outputs (both final and intermediate)
- Add option to clean only intermediate builds (`dist/.build/`)
- Add option to clean everything including webpack bundle

### 5. Update build scripts to auto-clean
- Modify `build-all`, `build-mac`, `build-linux` scripts (Windows builds remotely)
- Each should run appropriate clean command before building
- Ensure clean happens AFTER webpack build but BEFORE electron-builder

### 6. Add `.gitignore` entry
- Add `dist/.build/` to `.gitignore`
- Keep existing `dist/` ignore patterns

### 7. Update GitHub Actions workflow (if needed)
- Ensure `.github/workflows/build-and-sign-windows.yml` outputs to `dist/` structure
- Workflow already uses `clean-windows` script which should handle new structure
- Verify downloaded installer lands in correct location

## Expected Final Structure

```
dist/
├── bundle.js                           # Webpack output (kept)
├── bundle.js.map                       # Webpack output (kept)
├── bundle.js.LICENSE.txt               # Webpack output (kept)
├── HyperclayLocal-Setup-1.1.0.exe      # Windows installer (downloaded from GitHub Actions)
├── HyperclayLocal-Setup-1.1.0.exe.blockmap
├── HyperclayLocal-1.1.0.dmg            # macOS Intel (built locally)
├── HyperclayLocal-1.1.0.dmg.blockmap
├── HyperclayLocal-1.1.0-arm64.dmg      # macOS ARM (built locally)
├── HyperclayLocal-1.1.0-arm64.dmg.blockmap
├── HyperclayLocal-1.1.0.AppImage       # Linux (built locally)
├── latest-mac.yml                      # Auto-update metadata (local)
├── latest.yml                          # Auto-update metadata (Windows - from GitHub)
└── .build/                             # Intermediate artifacts (hidden, local only)
    ├── mac/
    ├── mac-arm64/
    ├── linux-unpacked/
    ├── builder-debug.yml
    └── builder-effective-config.yaml
```

**Note:** `win-unpacked/` and other Windows intermediate artifacts are generated remotely in GitHub Actions and not downloaded locally.

## Implementation Order

1. Update `.gitignore` first (safeguard)
2. Update `package.json` electron-builder config to use intermediate directory
3. Test that electron-builder respects new structure (macOS and Linux only)
4. Update `clean-dist.js` to handle new structure
5. Update build scripts (`build-mac`, `build-linux`, `build-all`) to use cleaning
6. Verify GitHub Actions workflow works with new structure
7. Test each platform build to verify structure

## Current Issues to Fix

- Outdated DMG files (v1.0.0 instead of v1.1.0) with old naming "Hyperclay Local" (space)
- Missing Windows installer (only unpacked build exists locally)
- Unnecessary unpacked folders at root level (`mac/`, `mac-arm64/`, `win-unpacked/`)
- Development bundle instead of production build in some cases

## Notes

- All builds will use `HyperclayLocal` (no space) for consistency across platforms
- Current old builds have "Hyperclay Local" (with space) - these will be cleaned up
