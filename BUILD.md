# Building & Releasing HyperclayLocal

## Quick Reference

| Platform | Build Command | Signing Method |
|----------|---------------|----------------|
| macOS | `npm run mac-build:run` | Local (Developer ID + Notarization) |
| Windows | `npm run win-build:run` | GitHub Actions (Azure Trusted Signing) |
| Linux | `npm run linux-build:run` | None required |

---

## Prerequisites

### All Platforms
- Node.js 18+
- npm

### macOS Signing
Requires a Mac with:
- Apple Developer Program membership ($99/year)
- "Developer ID Application" certificate in Keychain
- App-specific password from appleid.apple.com

### Windows Signing
Requires:
- GitHub repository with Actions enabled
- Azure Trusted Signing account
- GitHub Secrets configured (see below)

---

## macOS Build

macOS apps are built and signed locally on a Mac.

### Setup (One-time)

1. **Install certificate**: In Xcode → Settings → Accounts → Manage Certificates → Create "Developer ID Application"

2. **Create app-specific password**: Go to appleid.apple.com → Security → Generate app-specific password

3. **Set environment variables** (add to `.env` or export):
   ```bash
   export APPLE_ID="your-apple-id@example.com"
   export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="YOUR10CHAR"
   ```

### Build

```bash
npm run mac-build:run
```

This will:
1. Build the React app and CSS
2. Package with electron-builder
3. Sign with your Developer ID certificate
4. Submit for Apple notarization
5. Output DMG files for Intel and Apple Silicon in `dist/`

### Check Notarization Status

```bash
npm run mac-build:finalize
```

---

## Windows Build

Windows builds use GitHub Actions because Azure Trusted Signing tools don't work reliably on ARM64 Windows.

### Setup (One-time)

Add these secrets to your GitHub repository at:
`https://github.com/YOUR_USERNAME/hyperclay-local/settings/secrets/actions`

| Secret | Description |
|--------|-------------|
| `AZURE_TENANT_ID` | Your Azure tenant ID |
| `AZURE_CLIENT_ID` | Service principal client ID |
| `AZURE_CLIENT_SECRET` | Service principal secret |

### Build

```bash
# Trigger the GitHub Actions workflow
npm run win-build:run

# Check build status
npm run win-build:status

# Download signed installer when complete
npm run win-build:download
```

The signed installer will be downloaded to `executables/`.

### Manual Trigger

You can also trigger the workflow from GitHub:
1. Go to Actions tab in your repository
2. Click "Build and Sign Windows Installer"
3. Click "Run workflow"

---

## Linux Build

Linux builds don't require code signing.

```bash
npm run linux-build:run
```

Output: AppImage in `dist/`

---

## Release Process

### 1. Update Version

Update version in these files:
- `package.json`
- `README.md` (download links)
- `src/main/main.js` (lines 21, 417)

### 2. Build All Platforms

```bash
# macOS (run on Mac)
npm run mac-build:run

# Linux (run on Mac or Linux)
npm run linux-build:run

# Windows (triggers GitHub Actions)
npm run win-build:run
```

### 3. Download Windows Installer

```bash
npm run win-build:status  # Wait for completion
npm run win-build:download
```

### 4. Upload to CDN

```bash
npm run upload-to-r2
```

### 5. Verify

- Check uploads at `https://local.hyperclay.com/`
- Update download page at `../hyperclay/server-pages/hyperclay-local.edge`

---

## Build Scripts Reference

### Main Build Commands
- `npm run mac-build:run` - Build signed macOS DMG
- `npm run mac-build:local` - Build unsigned macOS DMG (for testing)
- `npm run win-build:run` - Trigger Windows build on GitHub Actions
- `npm run win-build:download` - Download signed Windows installer
- `npm run linux-build:run` - Build Linux AppImage
- `npm run build-all` - Build macOS and Linux (not Windows)

### CDN Management
- `npm run upload-to-r2` - Upload executables to R2 CDN

### Utility
- `npm run clean` - Clean all dist files
- `npm run clean-mac` - Clean macOS builds only
- `npm run clean-windows` - Clean Windows builds only
- `npm run clean-linux` - Clean Linux builds only

---

## Troubleshooting

### macOS: "App is damaged" error
```bash
xattr -cr "/Applications/HyperclayLocal.app"
```

### macOS: Notarization fails
- Verify Apple ID credentials are correct
- Check that your Developer ID certificate is valid
- Ensure hardened runtime is enabled in `package.json`

### Windows: Workflow fails at signing step
- Check GitHub secrets are set correctly (no extra spaces)
- Verify Azure credentials are still valid
- Check Azure Trusted Signing account is active

### Windows: Can't download artifacts
- Artifacts expire after 90 days
- Re-run workflow to generate new ones

### Linux: Permission denied
```bash
chmod +x HyperclayLocal-*.AppImage
```

---

## Output Sizes

- macOS DMG: ~100-115 MB
- Windows EXE: ~86 MB
- Linux AppImage: ~114 MB
