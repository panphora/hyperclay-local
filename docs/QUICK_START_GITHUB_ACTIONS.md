# Quick Start: GitHub Actions for Code Signing

## 🎯 For Both macOS and Windows

This project uses **GitHub Actions** to automatically build and sign installers for both platforms. No local code signing setup needed!

---

## ✅ What You Get

Push code → GitHub builds and signs installers → Download ready-to-distribute apps

**Both platforms work the same way:**
- 🍎 macOS: Signed & notarized DMG
- 🪟 Windows: Code-signed EXE installer
- ⏱️ Total time: ~10 minutes
- 🆓 Completely free (included with GitHub)

---

## 🚀 Setup (One-Time, ~5 Minutes)

### Step 1: Add GitHub Secrets

Go to your repo settings:
```
https://github.com/YOUR_USERNAME/hyperclay-local/settings/secrets/actions
```

### For macOS Signing

Add these secrets (get values from your Apple Developer account):

| Secret Name | Description |
|-------------|-------------|
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your Team ID (from Apple Developer) |
| `SIGNING_IDENTITY` | Certificate name (e.g., "Developer ID Application: Your Name (TEAM_ID)") |

### For Windows Signing

Add these secrets (Azure Trusted Signing credentials):

| Secret Name | Description |
|-------------|-------------|
| `AZURE_TENANT_ID` | Your Azure tenant ID |
| `AZURE_CLIENT_ID` | Service principal client ID |
| `AZURE_CLIENT_SECRET` | Service principal secret |

### Step 2: That's It!

Workflows are already set up in `.github/workflows/`. Just push code and they run automatically.

---

## 📦 How to Use

### Automatic (Recommended)

Just push to main:
```bash
git add .
git commit -m "Your changes"
git push origin main
```

Both workflows trigger automatically and build signed installers.

### Manual Trigger

1. Go to: `https://github.com/YOUR_USERNAME/hyperclay-local/actions`
2. Click the workflow you want (macOS or Windows)
3. Click "Run workflow" → Select "main" branch → "Run workflow"

---

## 📥 Download Signed Installers

1. Wait for workflow to complete (~10 minutes)
2. Go to the workflow run page
3. Scroll to bottom → "Artifacts" section
4. Download:
   - **macOS**: `hyperclay-local-macos-signed` (contains DMG)
   - **Windows**: `hyperclay-local-windows-signed` (contains EXE)
5. Extract ZIP → You have signed installers!

---

## 🔍 Verify Signatures

### macOS
```bash
spctl -a -vv -t install YourApp.dmg
# Should show: "accepted" and "source=Notarized Developer ID"
```

### Windows
Right-click .exe → Properties → Digital Signatures tab
- Should show "Hyperclay" signature
- Status: "This digital signature is OK"

---

## 💡 Tips

### Develop Anywhere
- Work on macOS, Windows (ARM64 or x64), or Linux
- Use `npm run dev` for local testing
- Push to GitHub for signed builds
- No platform-specific tools needed locally

### Workflow Triggers
Both workflows run on:
- Push to `main` branch (with changes to `src/`, `package.json`, `build-scripts/`)
- Manual trigger via Actions UI
- Workflow dispatch API

### Debug Failed Builds
- Click on failed workflow run
- Check step-by-step logs
- Most issues: missing/incorrect secrets
- Verify secrets have no extra spaces

---

## 📚 More Information

- **Windows Details**: See `docs/WINDOWS_SIGNING_SOLUTION.md`
- **Workflow Files**: `.github/workflows/build-and-sign-*.yml`
- **GitHub Actions**: See Actions tab in your repo

---

## 🎉 Success!

You now have:
- ✅ Automated builds for macOS and Windows
- ✅ Code-signed installers (no SmartScreen warnings!)
- ✅ Notarized macOS apps (no Gatekeeper issues!)
- ✅ Professional distribution-ready installers
- ✅ Cross-platform development workflow

Push code → Get signed installers. It's that simple!
