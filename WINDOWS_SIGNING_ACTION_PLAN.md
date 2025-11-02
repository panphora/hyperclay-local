# Windows Signing - Action Plan to Make It Work

## Current Situation
SignTool.exe crashes with exit code 3 when using Azure Trusted Signing DLL. This is happening to us on ARM64 Windows.

## Immediate Actions to Try

### Option 1: Use x64 SignTool on ARM64
The ARM64 Windows might be the issue. Try forcing x64 SignTool:
```powershell
# Use x86/x64 SignTool explicitly
"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
```

### Option 2: Direct SignTool Command (Skip PowerShell Module)
```cmd
# Set env vars
set AZURE_TENANT_ID=your-tenant-id
set AZURE_CLIENT_ID=your-client-id
set AZURE_CLIENT_SECRET=your-secret

# Direct signtool with dlib
signtool sign /fd SHA256 /v /du "https://hyperclay.com" ^
  /dlib "C:\Users\David\AppData\Local\TrustedSigning\Microsoft.Trusted.Signing.Client\Microsoft.Trusted.Signing.Client.1.0.53\bin\x64\Azure.CodeSigning.Dlib.dll" ^
  /dmdf "C:\Users\David\AppData\Local\TrustedSigning\Microsoft.Trusted.Signing.Client\Microsoft.Trusted.Signing.Client.1.0.53\bin\x64\metadata.json" ^
  "dist\HyperclayLocal Setup 1.1.0.exe"
```

### Option 3: Use GitHub Actions (Most Reliable)
Build locally, sign in GitHub Actions on Windows x64 runner:
```yaml
name: Sign Windows Binary
on:
  workflow_dispatch:
    inputs:
      artifact_url:
        description: 'URL to unsigned installer'
        required: true

jobs:
  sign:
    runs-on: windows-latest
    steps:
      - name: Download installer
        run: curl -o installer.exe "${{ github.event.inputs.artifact_url }}"

      - name: Install TrustedSigning Module
        run: Install-Module -Name TrustedSigning -Force

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
            -Files installer.exe

      - name: Upload signed
        uses: actions/upload-artifact@v3
        with:
          name: signed-installer
          path: installer.exe
```

### Option 4: Azure DevOps Pipeline
Use Azure's own CI/CD which definitely supports their signing:
```yaml
trigger: none

pool:
  vmImage: 'windows-latest'

steps:
- task: AzureKeyVault@2
  inputs:
    azureSubscription: 'YourSubscription'
    KeyVaultName: 'YourKeyVault'

- task: CodeSign@1
  inputs:
    filePath: '$(Build.SourcesDirectory)/dist/*.exe'
```

### Option 5: Use EV Code Signing Certificate Instead
Buy a traditional EV certificate ($300-600/year) and use regular signtool:
```cmd
signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "installer.exe"
```

## Debugging the Current Issue

### Test 1: Check if it's ARM64 specific
```powershell
# Check architecture
[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture

# Try x64 PowerShell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

### Test 2: Manual metadata.json
Create metadata.json manually:
```json
{
  "Endpoint": "https://eus.codesigning.azure.net",
  "CodeSigningAccountName": "Hyperclay",
  "CertificateProfileName": "HyperclayLocalPublicCertProfile"
}
```

### Test 3: Try older/newer SignTool
Download different Windows SDK versions and try their SignTool.exe

## Nuclear Option: Build & Sign on x64 Windows

Just spin up an x64 Windows VM or use a cloud service:
1. Push code to GitHub
2. SSH/RDP to x64 Windows machine
3. Pull code
4. Build and sign there
5. Copy back signed installer

## Most Practical Solution

**Use GitHub Actions with windows-latest runner**. It's free, reliable, and known to work with Azure Trusted Signing. We can trigger it manually when needed.

## The Real Problem

ARM64 Windows + Azure Trusted Signing is likely untested/unsupported combination. Microsoft's tools assume x64.

## Recommendation

1. Try GitHub Actions first (Option 3)
2. If you must sign locally, get an x64 Windows machine
3. Consider traditional EV certificate as fallback

Stop fighting the tools. Use what Microsoft actually tests: x64 Windows with their cloud services.