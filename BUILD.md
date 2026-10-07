# Building & Releasing HyperclayLocal

## Release through Hypersave

For the full Hyperclay software train, use the established release entry point:

```bash
caffeinate -is hypersave --full-dangerous
```

For the desktop release alone, run this from the repository root:

```bash
npm run release
```

The command first finishes any recorded release. It starts a new version only after the previous publication and downstream work are verified. A higher requested version stays deferred when there is unfinished work; invoke the command again after that work completes to start it.

For a new release, the command checks the working tree, license and Electron UI gate, chooses a version without prompting, and records the source before dispatching GitHub Actions. Version advice comes from commit messages unless you supply `--major`, `--minor`, `--patch` or `--version=X.Y.Z`. The version update covers `package.json`, `README.md` and `website/index.html`.

GitHub Actions tests and builds macOS, Windows and Linux, signs and notarizes where required, and uploads the installers. Every job checks out the recorded source commit. The workflow checks that the source, version and attempt ID agree before building.

After publication is proven, the local command finishes download sizes, the desktop website and both documentation targets. Only verified completion is reported as a successful release. Local installation is attempted separately and its failure is recorded without invalidating an otherwise complete publication.

Commits, pushes, tags, workflow dispatches and site deployments wait outside Tuesday through Friday, 09:00 through 18:00 in `America/New_York`. The legacy `--ignore-window` option remains accepted but does not bypass this policy. A dry run still dispatches a workflow and is subject to that policy.

To reserve a version for the next Hypersave release, add `"hyperclay-local": "X.Y.Z"` to `~/.config/hypersave/planned-versions.json`, preserving its other entries. Do not pre-bump `package.json` to reserve a desktop version.

The individual platform commands below are standalone build tools. They do not replace the durable release coordinator or establish that a release is complete.

---

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
```

The signed installer is automatically uploaded to Cloudflare R2 by the GitHub Actions workflow.

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

## Release status and recovery

Read local status without loading signing settings, contacting a provider or changing release state:

```bash
node scripts/release.js --status-json
```

Use `--status-json` alone. It prints one JSON object. A producer read error exits with status 2. A readable response can still describe unfinished or blocked work, so exit 0 alone does not mean the release is complete.

Continue the recorded version:

```bash
npm run release -- --resume
```

Observe an existing attempt and finish a proven publication without preparing source or dispatching another build:

```bash
npm run release -- --resume --reconcile-only
```

This second command may finish website and documentation work. It is not a read-only command. Missing or ambiguous historical evidence remains pending; it does not authorize a fresh release. Neither command needs a new version merely because the previous run stopped after publication.

If CI is independently confirmed failed, first commit and push the same-version fix. Then select that full source commit explicitly:

```bash
npm run release -- --resume --resume-source="$(git rev-parse HEAD)"
```

Repair requires a different source at the same version and the selected source to match remote `main`. It records a new attempt for that release. An unknown workflow outcome is reconciled against its existing attempt identity instead of being dispatched again.

A website deployment whose outcome is unknown needs an explicit retry decision after inspection:

```bash
npm run release -- --resume --retry-site
```

This option only applies to the recorded unknown site attempt. It is not a general retry switch. Do not delete the release records or change the version to escape an unresolved outcome.

A build rehearsal uses the current committed version without publishing installers:

```bash
npm run release -- --dry-run
```

A dry run can build, sign and notarize on GitHub Actions. Its evidence cannot complete the publication lane.

Standalone command output is captured outside the checkout in a unique directory under `~/.cache/hyperclay-local/releases/`, with a temporary-directory fallback if necessary. The command prints the actual log path. When Hypersave owns capture, its run transcript is used instead. The checkout's old `release.log` is not used. A transcript failure remains visible as a failure.

---

## Build Scripts Reference

### Main Build Commands
- `npm run mac-build:run` - Build signed macOS DMG
- `npm run mac-build:local` - Build unsigned macOS DMG (for testing)
- `npm run win-build:run` - Trigger Windows build on GitHub Actions (auto-uploads to R2)
- `npm run linux-build:run` - Build Linux AppImage
- `npm run build-all` - Build macOS and Linux (not Windows)

### CDN Management
- `npm run upload-to-r2` - Upload executables to R2 CDN

### Utility
- `npm run clean` - Clean all dist files
- `npm run clean-mac` - Clean macOS builds only
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
