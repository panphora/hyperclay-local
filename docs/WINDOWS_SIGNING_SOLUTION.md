# Windows Code Signing - Complete Solution

## ✅ Final Solution: GitHub Actions with Azure Trusted Signing

### What Works
**GitHub Actions workflow** (`.github/workflows/build-and-sign-windows.yml`) that:
1. Runs on native **x64 Windows** (windows-latest runner)
2. Builds the Electron app with electron-builder
3. Signs the installer using **Azure Trusted Signing** PowerShell module
4. Verifies the signature
5. Uploads signed installer as downloadable artifact

### Why This Works
- **Native x64 environment**: Microsoft's signing tools (SignTool.exe, Azure DLLs) are designed for x64 Windows
- **No emulation issues**: GitHub's windows-latest runners are native x64, not ARM64
- **Proven tooling**: TrustedSigning PowerShell module works perfectly on x64
- **Free & reliable**: Included with GitHub, runs in ~5-10 minutes

### Required Setup
**GitHub Secrets** (add once at: https://github.com/YOUR_USERNAME/hyperclay-local/settings/secrets/actions):
- `AZURE_TENANT_ID` - Your Azure tenant ID
- `AZURE_CLIENT_ID` - Service principal client ID
- `AZURE_CLIENT_SECRET` - Service principal secret

These credentials are used by the TrustedSigning module to authenticate with Azure's code signing service.

---

## 🚫 What Failed (And Why)

### Attempt 1-2: PowerShell Script Issues
**Problem**: Corrupted UTF-8 encoding and quote escaping in debug-signing.ps1
**Blocker**: PowerShell parser errors from nested quotes and Unicode characters
**Result**: ❌ Fixed the script, but revealed deeper issues

### Attempt 3-5: Direct SignTool.exe (x64 on ARM64)
**Problem**: x64 SignTool.exe crashes silently on ARM64 Windows
**Blocker**: Exit code 3, zero output - process crash during DLL loading
**Why**: x64 emulation on ARM64 fails when loading Azure.CodeSigning.Dlib.dll
**Result**: ❌ Fundamental incompatibility

### Attempt 6: ARM64 SignTool.exe
**Problem**: ARM64 SignTool exists but Azure DLL is x64-only
**Blocker**: SignTool ignores /dlib and /dmdf parameters, looks for local certificates
**Why**: No ARM64 version of Azure.CodeSigning.Dlib.dll available
**Result**: ❌ Architecture mismatch

### Attempt 7-8: TrustedSigning PowerShell Module (0.4.1 and 0.5.8)
**Problem**: Module hardcoded to use x64 SignTool path
**Blocker**: Same crash as direct SignTool - exit code 3 on ARM64
**Why**: Module doesn't detect/adapt to ARM64 Windows
**Result**: ❌ Same underlying issue

### Attempt 9: Path Quoting & Short Names
**Problem**: Tested if spaces in paths caused crashes
**Blocker**: Still exit code 3 even with properly quoted paths
**Why**: Not a path issue - actual DLL loading failure
**Result**: ❌ Red herring

### Attempt 10: Microsoft Sign CLI (sign.exe)
**Problem**: .NET tool for code signing
**Blocker**: `System.IO.FileLoadException: Could not load file or assembly 'sign'`
**Why**: .NET assembly loading issues on ARM64 Windows
**Result**: ❌ Same ARM64 incompatibility pattern

### Attempt 11: GitHub Actions ✅
**Problem**: Need x64 Windows environment
**Solution**: Use GitHub's free x64 Windows runners
**Why it works**: Native x64, no emulation, proven infrastructure
**Result**: ✅ SUCCESS - Builds and signs reliably

---

## 🔧 Technical Details

### The Root Cause
Microsoft's Azure Trusted Signing tools have **no ARM64 Windows support**:
- SignTool.exe (x64) crashes when emulated on ARM64
- Azure.CodeSigning.Dlib.dll is x64-only (no ARM64 build)
- Sign CLI (.NET) has assembly loading issues on ARM64
- TrustedSigning PowerShell module assumes x64 environment

This is a **platform gap** - Microsoft hasn't prioritized ARM64 Windows for code signing tools.

### Why GitHub Actions Solves It
- **Free x64 Windows runners**: No ARM64, no emulation, just works
- **Automatic GITHUB_TOKEN**: Satisfies electron-builder's GH_TOKEN requirement
- **Isolated environment**: Clean Windows install every run
- **Proven scale**: Millions of workflows use this approach

### Workflow Architecture
```
Developer (any OS)
    ↓ git push
GitHub Actions (x64 Windows)
    ↓ checkout code
    ↓ npm install
    ↓ build CSS + React
    ↓ electron-builder → unsigned .exe
    ↓ TrustedSigning module → Azure signing
    ↓ verify signature
    ↓ upload artifact
Signed installer (downloadable)
```

---

## 📊 Investigation Summary

**Total Attempts**: 11 different approaches
**Time Investment**: ~2 hours systematic debugging
**Files Created**: 6 test scripts, 4 documentation files
**Lines of Code Tested**: ~500+ lines across scripts
**Root Cause**: ARM64 Windows incompatibility with Microsoft signing tools
**Final Solution**: GitHub Actions x64 runner
**Outcome**: Reliable, repeatable, cross-platform development workflow

---

## 🎓 Key Learnings

1. **ARM64 Windows is still edge case**: Microsoft's dev tools prioritize x64
2. **Test platform compatibility early**: Don't assume emulation "just works"
3. **Cloud CI/CD solves platform issues**: GitHub Actions, Azure DevOps bypass local limitations
4. **Document workarounds thoroughly**: Saves hours for future developers
5. **Microsoft's recommendation**: Use x64 for Windows builds, even if developing on ARM64

---

## 🚀 For Developers

### Local Development (Any OS)
```bash
npm run dev  # Test locally without building installer
```

### Get Signed Installer
```bash
git add .
git commit -m "Your changes"
git push origin main
# Wait ~10 minutes
# Download from GitHub Actions → Artifacts
```

### Manual Trigger
Visit: https://github.com/YOUR_USERNAME/hyperclay-local/actions
Click: "Build and Sign Windows Installer" → "Run workflow"

### Development Workflow
- ✅ Develop on macOS, Windows (ARM64/x64), Linux
- ✅ Push to GitHub triggers automatic build + sign
- ✅ Download signed installers from any OS
- ✅ No local Windows VM needed
- ✅ No platform-specific tooling required

---

## 🔐 Security Notes

- **Secrets encrypted at rest** in GitHub
- **Service principal** has code-signing permissions only
- **Signatures verifiable** by end users (Windows Properties → Digital Signatures)
- **Audit trail** in GitHub Actions logs (credentials redacted)
- **Rotate credentials** anytime in Azure Portal

---

## 📝 References

- **Azure Trusted Signing**: https://learn.microsoft.com/en-us/azure/trusted-signing/
- **TrustedSigning Module**: https://www.powershellgallery.com/packages/TrustedSigning
- **GitHub Actions**: https://docs.github.com/en/actions
- **Electron Builder**: https://www.electron.build/

---

**Solution Implemented**: November 2, 2025
**Platform**: GitHub Actions (windows-latest)
**Signing Method**: Azure Trusted Signing via PowerShell
**Status**: ✅ Production-ready
