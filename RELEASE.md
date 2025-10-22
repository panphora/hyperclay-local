# Hyperclay Local - Release Guide

## Release Steps

1. Update version in `package.json`
2. Update version in `README.md`
3. Update version in `main.js` (lines 21, 417)
4. Commit and push version bump
5. `npm run build-all`
6. `node post-build.js` (upload executables to CDN)
7. Verify CDN uploads at `https://local.hyperclay.com/`
8. Update download page at `../hyperclay/server-pages/hyperclay-local.edge`
