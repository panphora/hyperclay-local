# Windows Signing - Final Solution Plan

## Problem Analysis

The core issue: electron-builder's Azure signing integration is fundamentally broken:
1. SignTool.exe crashes with Azure DLL (exit code 3, msvcrt.dll fault)
2. Environment variable passing is inconsistent
3. PowerShell subprocess spawning loses context
4. Setting env vars to `undefined` passes string "undefined" instead of removing them

Current error shows electron-builder STILL trying to use its broken Azure signing even when we think we've disabled it.

## Root Cause

The `undefined` trick isn't working. When you set `AZURE_TENANT_ID: undefined` in Node.js env object, it becomes the STRING "undefined", not actually undefined. electron-builder sees this string and tries to use it.

## The Real Solution

**COMPLETELY BYPASS electron-builder's signing mechanism**

### Option A: Two-Stage Build (RECOMMENDED)

1. **Build without ANY signing config**
   - Remove `azureSignOptions` from package.json entirely
   - Build with `--win.sign=false` flag to explicitly disable signing
   - Don't manipulate env vars at all

2. **Sign with AzureSignTool after**
   - Use AzureSignTool on the output installer
   - Full control over the process
   - No electron-builder interference

### Option B: Custom Sign Tool Hook

1. Create dummy sign tool that always succeeds
2. Let electron-builder think it signed
3. Actually sign with AzureSignTool after

### Option C: Use electron-builder's customSign hook

1. Implement custom signing function
2. Call AzureSignTool from within
3. electron-builder handles file discovery

## Implementation Plan (Option A - Recommended)

### Step 1: Clean package.json
```json
// Remove from win section:
"azureSignOptions": { ... }  // DELETE THIS ENTIRE BLOCK
```

### Step 2: New build script
```javascript
// build-scripts/build-windows-simple.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env
require('dotenv').config();

// Check Azure credentials exist
if (!process.env.AZURE_TENANT_ID) {
  console.error('Missing AZURE_TENANT_ID in .env');
  process.exit(1);
}

// Step 1: Build unsigned
console.log('Building unsigned installer...');
execSync('npm run clean-windows', { stdio: 'inherit' });
execSync('npm run build-css', { stdio: 'inherit' });
execSync('npm run build-react-prod', { stdio: 'inherit' });
execSync('electron-builder --win --win.sign=false', {
  stdio: 'inherit',
  env: process.env // Pass full env, electron-builder will ignore Azure vars with --win.sign=false
});

// Step 2: Sign with AzureSignTool
const installer = path.join(__dirname, '..', 'dist', 'HyperclayLocal Setup 1.1.0.exe');
if (!fs.existsSync(installer)) {
  console.error('Installer not found:', installer);
  process.exit(1);
}

console.log('Signing installer...');
const signCmd = [
  'azuresigntool', 'sign',
  '-kvu', 'https://eus.codesigning.azure.net',
  '-kvc', 'Hyperclay',
  '-kvt', process.env.AZURE_TENANT_ID,
  '-kvi', process.env.AZURE_CLIENT_ID,
  '-kvs', process.env.AZURE_CLIENT_SECRET,
  '-kvcert', 'HyperclayLocalPublicCertProfile',
  '-v', `"${installer}"`
].join(' ');

execSync(signCmd, { stdio: 'inherit' });
console.log('Done!');
```

### Step 3: Update package.json script
```json
"build-windows": "node build-scripts/build-windows-simple.js"
```

## Alternative: Custom Sign Implementation (Option C)

If Option A fails, implement custom signing:

```javascript
// build-scripts/custom-azure-sign.js
exports.default = async function(config) {
  const { execSync } = require('child_process');

  // config.path = file to sign
  // config.hash = hash algorithm

  const signCmd = [
    'azuresigntool', 'sign',
    '-kvu', 'https://eus.codesigning.azure.net',
    '-kvc', 'Hyperclay',
    '-kvt', process.env.AZURE_TENANT_ID,
    '-kvi', process.env.AZURE_CLIENT_ID,
    '-kvs', process.env.AZURE_CLIENT_SECRET,
    '-kvcert', 'HyperclayLocalPublicCertProfile',
    '-v', `"${config.path}"`
  ].join(' ');

  execSync(signCmd, { stdio: 'inherit' });
};
```

Then in package.json:
```json
"win": {
  "sign": "./build-scripts/custom-azure-sign.js"
}
```

## Testing Strategy

1. **Test 1: Verify unsigned build works**
   - Run with `--win.sign=false`
   - Confirm no signing attempts
   - Installer should build successfully

2. **Test 2: Verify AzureSignTool works standalone**
   - Take unsigned installer
   - Run AzureSignTool command manually
   - Verify signature with `signtool verify`

3. **Test 3: Full pipeline**
   - Run complete build script
   - Verify signed installer works

## Fallback Plans

**If AzureSignTool fails:**
1. Try signtool.exe with Azure CLI auth instead of env vars
2. Use Azure Portal manual signing
3. Set up GitHub Actions Windows runner for signing

**If nothing works locally:**
1. Build unsigned locally
2. Upload to Azure Storage
3. Use Azure DevOps pipeline to sign
4. Download signed version

## Success Criteria

✅ Single command builds and signs on Windows
✅ No crashes or error messages
✅ Signed installer runs without security warnings
✅ Process takes < 5 minutes
✅ Works reliably every time

## Next Steps

1. Remove azureSignOptions from package.json
2. Implement build-windows-simple.js
3. Test on Windows VM
4. If fails, try custom sign hook
5. Document final working solution

## Key Insight

**STOP FIGHTING ELECTRON-BUILDER'S BROKEN AZURE INTEGRATION**

Just bypass it completely. Build unsigned, sign manually. Simple, reliable, debuggable.