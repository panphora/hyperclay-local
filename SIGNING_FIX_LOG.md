# Windows Signing Fix - Progress Log

**Date**: 2025-11-02
**Goal**: Fix Windows build and signing process for HyperclayLocal
**Platform**: ARM64 Windows (MSYS_NT-10.0-26200-ARM64)

---

## Understanding the Current Setup

### Components
- **Build Script**: `build-scripts/build-windows-simple.js`
- **Debug Script**: `debug-signing.ps1`
- **Signing Method**: Azure Trusted Signing (PowerShell module)
- **Target**: `dist/HyperclayLocal-Setup-1.1.0.exe`

### Known Issues
- SignTool.exe crashes with exit code 3
- ARM64 Windows + Azure Trusted Signing potentially unsupported combination
- Recent 8 commits in 18 minutes all trying to fix PowerShell string escaping

### Build Process Flow
1. Clean Windows artifacts
2. Build CSS with Tailwind
3. Build React bundle (production)
4. Run electron-builder (unsigned, Azure env vars cleared)
5. Sign resulting installer with PowerShell Invoke-TrustedSigning

---

## Attempt Log

### Attempt #1 - Initial Diagnostic
**Time**: Starting now
**Action**: Running debug-signing.ps1 to assess current state
**Expected**: Will check env vars, metadata.json, TrustedSigning module, installer existence, Azure connectivity
**Result**: ❌ FAILED - PowerShell syntax error on line 81

**Issue Found**: The debug script itself has a string escaping error:
```powershell
# BROKEN:
Write-Host "... -Files `"$installerPath`"" -ForegroundColor Cyan

# FIXED:
Write-Host ('... -Files "' + $installerPath + '"') -ForegroundColor Cyan
```

The nested quotes with backtick escaping were confusing PowerShell's parser. Used string concatenation instead.

---

### Attempt #2 - Diagnostic After Fix
**Action**: Running debug-signing.ps1 again with fixed syntax
**Result**: ❌ FAILED - Still had encoding issues

**Issue Found**: File had corrupted UTF-8 encoding (checkmarks/crosses shown as �o)
**Solution**: Completely rewrote file with clean ASCII/UTF-8 encoding

---

### Attempt #3 - Clean Diagnostic Run
**Action**: Running rewritten debug-signing.ps1
**Result**: ✅ SUCCESS - Script runs!

**Findings**:
- ❌ Azure env vars NOT SET (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
- ✅ metadata.json EXISTS at correct path
  - Endpoint: https://eus.codesigning.azure.net
  - Account: Hyperclay
  - Profile: HyperclayLocalPublicCertProfile
- ✅ TrustedSigning module INSTALLED (versions 0.4.1 and 0.5.8)
- ❌ Installer NOT BUILT YET (dist\HyperclayLocal-Setup-1.1.0.exe)
- ⚠️ Azure endpoint returns 404 (may be normal for HEAD request)

**Next Steps**:
1. Check if .env file exists with Azure credentials
2. Run the build process

---

### Attempt #4 - Check .env File
**Action**: Verify .env contains Azure credentials
**Result**: ✅ SUCCESS

All required variables present:
- AZURE_TENANT_ID=***
- AZURE_CLIENT_ID=***
- AZURE_CLIENT_SECRET=***

---

### Attempt #5 - Full Windows Build
**Action**: Running `npm run build-windows`
**Result**: ⚠️ PARTIAL SUCCESS

**What Worked**:
- ✅ Clean step completed
- ✅ CSS build completed (Tailwind)
- ✅ React production build completed
- ✅ Electron-builder package created
- ✅ NSIS installer built (89.5 MB)
- ✅ Unsigned installer: dist\HyperclayLocal-Setup-1.1.0.exe
- ✅ Azure credentials loaded from .env
- ✅ TrustedSigning module initiated signing

**What Failed**:
- ❌ SignTool.exe failed with exit code 3

**SignTool Command Used**:
```
C:\Users\David\AppData\Local\TrustedSigning\Microsoft.Windows.SDK.BuildTools\
Microsoft.Windows.SDK.BuildTools.10.0.22621.3233\bin\10.0.22621.0\x64\signtool.exe
sign /v /debug /fd SHA256
/dlib "...\Azure.CodeSigning.Dlib.dll"
/dmdf "...\metadata.json"
"...\HyperclayLocal-Setup-1.1.0.exe"
```

**Analysis**: The build process works perfectly until the actual code signing. This is the x64 SignTool on ARM64 Windows issue mentioned in the action plan.

---

### Attempt #6 - Manual Signing Test
**Action**: Test SignTool directly with verbose output
**Result**: ❌ FAILED - SignTool exit code 3 with NO output

**Analysis**: SignTool crashes silently. This could be:
1. Spaces in directory paths not properly quoted
2. ARM64 Windows + x64 SignTool incompatibility
3. DLL loading issues

---

### Attempt #7 - Test with Properly Quoted Paths
**Action**: User identified potential issue with spaces in directory names - adding explicit quotes to all paths
**Result**: ❌ FAILED - Still exit code 3, no output

---

### Attempt #8 - Discovery: ARM64 Architecture Issue
**Action**: Check system architecture and available SignTool versions
**Result**: ✅ MAJOR DISCOVERY!

**Key Findings**:
- PowerShell running as x64 (emulated on ARM64 Windows)
- x64 SignTool.exe crashes silently with exit code 3 (no output)
- **ARM64 SignTool.exe EXISTS** at: `...\bin\10.0.22621.0\arm64\signtool.exe`
- ARM64 SignTool RUNS but has different behavior

**ARM64 SignTool Test Results**:
- Exit code 1 instead of 3 (progress!)
- Actually produces error output (not silent crash)
- Error: "No certificates were found that met all the given criteria"
- It's looking for local certificates, ignoring /dlib and /dmdf parameters
- This suggests the Azure CodeSigning DLL (x64) may not be compatible with ARM64 SignTool

**DLL Situation**:
- Azure.CodeSigning.Dlib.dll only exists in x64 version
- Path: `...\Microsoft.Trusted.Signing.Client.1.0.53\bin\x64\Azure.CodeSigning.Dlib.dll`
- No ARM64 version found in `...\bin\arm64\`

---

### Attempt #9 - Test TrustedSigning Module 0.5.8
**Action**: Try newer module version (0.5.8 vs 0.4.1)
**Result**: ❌ FAILED - Same issue

Module 0.5.8:
- Downloaded newer packages automatically
- Microsoft.Windows.SDK.BuildTools 10.0.26100.4188 (newer)
- Microsoft.Trusted.Signing.Client 1.0.95 (newer)
- Still hardcoded to use x64 SignTool
- Still crashes with exit code 3

---

## Root Cause Analysis

**THE PROBLEM**: ARM64 Windows + x64 SignTool Incompatibility
- x64 SignTool.exe (required by TrustedSigning module) **crashes silently** on ARM64 Windows
- Exit code 3 with zero output = process crash, not normal failure
- ARM64 SignTool exists but Azure DLL is x64-only
- TrustedSigning PowerShell module is hardcoded to use x64 paths

**Why It Fails**:
1. TrustedSigning module uses x64 SignTool by default
2. x64 SignTool loads x64 Azure.CodeSigning.Dlib.dll
3. On ARM64 Windows, x64 binaries should work via emulation BUT...
4. Something in the DLL or SignTool causes a crash (exit code 3)
5. No error output because it's a process crash, not a handled error

---

## Possible Solutions

### Option A: Modify TrustedSigning Module
- Find where module constructs SignTool path
- Change from `x64` to `arm64`
- **Problem**: ARM64 SignTool won't load x64 DLL properly

### Option B: Force x64 PowerShell
- Run entire build in native x64 PowerShell (not ARM64)
- May have better x64-on-ARM emulation
- **To Try**: Use explicit x64 PowerShell path

### Option C: Use GitHub Actions (Recommended in Action Plan)
- Build on native x64 Windows runner
- No ARM64 compatibility issues
- Microsoft's tools assume x64

### Option D: Use Sign CLI (sign.exe)
- Module 0.5.8 mentions "SignCli" as alternative
- Package: sign 0.9.1-beta.24469.1
- May have better cross-platform support

### Option E: Direct Azure REST API
- Bypass SignTool entirely
- Call Azure Trusted Signing REST API directly
- Upload binary, get signed binary back

---

## Current Status

✅ **Build Works**: Unsigned installer builds perfectly (89.5 MB)
❌ **Signing Fails**: ARM64 + x64 SignTool incompatibility
🔧 **Blocker**: Microsoft's Azure signing tools not tested/working on ARM64 Windows

**Files Created During Investigation**:
- `debug-signing.ps1` - Fixed and working diagnostic script
- `test-signing.ps1` - Manual signing test
- `test-signtool-direct.ps1` - Direct SignTool test
- `test-signtool-arm64.ps1` - ARM64 SignTool test
- `test-dll-load.ps1` - Architecture detection
- `test-signing-v058.ps1` - Module 0.5.8 test

**Next Steps Needed** (awaiting user input):
1. Try Option B: Force x64 PowerShell
2. Try Option D: Use sign.exe CLI instead
3. Move to Option C: GitHub Actions
4. Find workaround for ARM64 Windows development
