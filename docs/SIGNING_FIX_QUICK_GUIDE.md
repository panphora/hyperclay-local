# Windows Signing Fix - Quick Action Guide

## Current Status
✅ **Build works perfectly** - Unsigned installer at `dist\HyperclayLocal-Setup-1.1.0.exe` (89.5 MB)
❌ **Signing fails** - ARM64 Windows + x64 SignTool = crash (exit code 3)

## The Problem
- TrustedSigning module → x64 SignTool → x64 Azure DLL → crashes on ARM64 Windows
- ARM64 SignTool exists but Azure DLL is x64-only
- This is a Microsoft tooling gap for ARM64 Windows

---

## Solution 1: Sign on x64 Windows (RECOMMENDED - Fastest)

### Option A: GitHub Actions
Create `.github/workflows/sign-windows.yml`:
```yaml
name: Sign Windows Installer
on: workflow_dispatch

jobs:
  sign:
    runs-on: windows-latest  # Native x64
    steps:
      - uses: actions/checkout@v4

      - name: Download unsigned installer
        run: |
          # Upload your unsigned installer first, then download it
          # Or build it here

      - name: Install TrustedSigning
        run: Install-Module -Name TrustedSigning -Force -Scope CurrentUser

      - name: Sign
        env:
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
        run: |
          Invoke-TrustedSigning `
            -Endpoint https://eus.codesigning.azure.net `
            -CodeSigningAccountName Hyperclay `
            -CertificateProfileName HyperclayLocalPublicCertProfile `
            -Files "dist\HyperclayLocal-Setup-1.1.0.exe" `
            -FileDigest SHA256

      - name: Upload signed installer
        uses: actions/upload-artifact@v3
        with:
          name: signed-installer
          path: dist\HyperclayLocal-Setup-1.1.0.exe
```

**Pros**: Free, reliable, Microsoft's native environment
**Cons**: Need to set up GitHub secrets

### Option B: x64 Windows VM
- Spin up x64 Windows VM (Hyper-V, VirtualBox, cloud)
- Run `npm run build-windows` there
- Works exactly as intended

**Pros**: Full control
**Cons**: Need x64 machine/VM

---

## Solution 2: Use SignCli (EXPERIMENTAL - Worth trying first)

### Install .NET SignCli tool
```bash
dotnet tool install --global sign --version 0.9.1-beta.24469.1
```

### Create new signing script: `sign-with-cli.ps1`
```powershell
# Load env vars from .env
$envFile = Get-Content ".env" -Raw
foreach ($line in ($envFile -split "`n")) {
    if ($line -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        if ($name -like "AZURE_*") {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Use sign.exe instead of signtool.exe
sign code azure-trusted-signing `
    "$PWD\dist\HyperclayLocal-Setup-1.1.0.exe" `
    --trusted-signing-endpoint "https://eus.codesigning.azure.net" `
    --trusted-signing-account "Hyperclay" `
    --certificate-profile "HyperclayLocalPublicCertProfile" `
    --file-digest SHA256 `
    --verbosity detailed
```

### Update `build-windows-simple.js` line ~105
Replace PowerShell Invoke-TrustedSigning call with:
```javascript
execSync('powershell -ExecutionPolicy Bypass -File sign-with-cli.ps1', {
    stdio: 'inherit',
    env: process.env
});
```

**Pros**: May work on ARM64, modern Microsoft tool
**Cons**: Beta version, different CLI syntax

### SignCli Documentation
- Repo: https://github.com/dotnet/sign
- Trusted Signing docs: https://learn.microsoft.com/en-us/azure/trusted-signing/

---

## Solution 3: Force x64 PowerShell (QUICK TEST)

Edit `build-windows-simple.js` line ~109 to use x64 PowerShell:
```javascript
execSync('C:\\Windows\\SysNative\\WindowsPowerShell\\v1.0\\powershell.exe -ExecutionPolicy Bypass -File "${tempPs1}"', {
    // ... rest stays same
});
```

**Pros**: 1-line change
**Cons**: May still fail, SysNative might not help on ARM64

---

## Recommended Approach

**Day 1**: Try Solution 2 (SignCli) - 15 minutes
- Install sign tool
- Create sign-with-cli.ps1
- Test: `powershell -File sign-with-cli.ps1`

**If that fails**: Solution 1A (GitHub Actions) - 30 minutes
- Set up workflow
- Add secrets
- Push and trigger

**Result**: Signed builds working within the hour

---

## Files Ready for Testing

All diagnostic scripts are in repo root:
- `debug-signing.ps1` - Environment checker (works now)
- `test-signing.ps1` - Test current PowerShell method
- All test scripts can be deleted after fix

## Your Build Command
```bash
npm run build-windows
```

This will work once signing is fixed - everything else is solid!
