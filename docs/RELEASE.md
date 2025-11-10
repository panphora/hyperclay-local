# Hyperclay Local - Release Guide

## Release Steps

1. Update version in `package.json`
2. Update version in `README.md`
3. Update version in `main.js` (lines 21, 417)
4. Commit and push version bump
5. Build all platforms:
   - macOS: `npm run mac-build:run`
   - Linux: `npm run linux-build:run`
   - Windows: `npm run win-build:run` (triggers GitHub Actions)
6. Download Windows installer: `npm run win-build:download`
7. Upload to CDN: `npm run upload-to-r2`
8. Verify CDN uploads at `https://local.hyperclay.com/`
9. Update download page at `../hyperclay/server-pages/hyperclay-local.edge`

## Build Scripts

All build-related scripts are in `build-scripts/`:
- `post-build.js` - Automatically uploads executables to R2 CDN after build
- `list-remote-executables.js` - List executables currently on CDN
- `remove-remote-executables.js` - Remove all executables from CDN

Run via npm scripts:
- `npm run list-remote-executables`
- `npm run remove-remote-executables`
