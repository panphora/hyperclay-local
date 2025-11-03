# GitHub Actions Setup - Windows Signing

## What Was Created

A GitHub Actions workflow at `.github/workflows/build-and-sign-windows.yml` that:
1. Builds your app on native x64 Windows (windows-latest runner)
2. Signs the installer using Azure Trusted Signing
3. Verifies the signature
4. Uploads the signed installer as an artifact

## Required: Add GitHub Secrets

You need to add your Azure credentials as GitHub repository secrets:

### Step 1: Go to GitHub Settings
```
https://github.com/YOUR_USERNAME/hyperclay-local/settings/secrets/actions
```

### Step 2: Add these three secrets

Click "New repository secret" for each:

**Secret 1: AZURE_TENANT_ID**
- Name: `AZURE_TENANT_ID`
- Value: (get from your .env file)

**Secret 2: AZURE_CLIENT_ID**
- Name: `AZURE_CLIENT_ID`
- Value: (get from your .env file)

**Secret 3: AZURE_CLIENT_SECRET**
- Name: `AZURE_CLIENT_SECRET`
- Value: (get from your .env file)

### Quick command to see your values:
```bash
grep AZURE_ .env
```

## How to Use

### Option A: Manual Trigger (Recommended for testing)
1. Go to: `https://github.com/YOUR_USERNAME/hyperclay-local/actions`
2. Click "Build and Sign Windows Installer" workflow
3. Click "Run workflow" button
4. Select branch: `main`
5. Click green "Run workflow"
6. Wait ~5-10 minutes
7. Download signed installer from "Artifacts" section

### Option B: Automatic (on push to main)
The workflow runs automatically when you push changes to:
- `src/**`
- `package.json`
- `build-scripts/**`

## After Workflow Completes

1. **Check the run**: Click on the workflow run to see logs
2. **Download artifact**: Scroll to bottom, click "hyperclay-local-windows-signed"
3. **Extract and test**: Unzip and run the installer

## Verify It's Signed

Right-click the .exe → Properties → Digital Signatures tab
- Should show signature from "Hyperclay"
- Status should be "This digital signature is OK"

## Troubleshooting

### If workflow fails at "Sign installer" step:
- Check GitHub secrets are set correctly (no extra spaces)
- Check Azure credentials are still valid
- Look at detailed logs in GitHub Actions

### If signature verification fails:
- Azure Trusted Signing service might be having issues
- Check your Azure account status
- Verify certificate profile is active

## Next Steps

After you add the secrets:
1. Commit and push this workflow file
2. Go to GitHub Actions
3. Manually trigger the workflow
4. Download your signed installer!

## Local Development

For local ARM64 Windows development:
- Build unsigned with: `npm run build-windows` (will fail at signing)
- Or just: `npm run clean-windows && npm run build-css && npm run build-react-prod && npx electron-builder --win`
- Upload to GitHub, let Actions sign it

This is Microsoft's recommended approach for ARM64 Windows developers.
