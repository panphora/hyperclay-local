# Windows Build Guide

This guide explains how to build signed Windows binaries on a Windows machine using electron-builder's native Azure Trusted Signing support.

## Prerequisites

1. **Windows VM or Machine**
2. **Node.js** - Version 18 or higher
3. **Git** - For cloning the repository

## Setup (One-time)

1. **Clone the repository**
   ```cmd
   git clone https://github.com/your-org/hyperclay-local.git
   cd hyperclay-local
   ```

2. **Install dependencies**
   ```cmd
   npm install
   ```

3. **Configure Azure credentials**

   Copy `.env.example` to `.env`:
   ```cmd
   copy .env.example .env
   ```

   Edit `.env` with your Azure Trusted Signing credentials:
   ```env
   AZURE_TENANT_ID=your-azure-tenant-id
   AZURE_CLIENT_ID=your-azure-client-id
   AZURE_CLIENT_SECRET=your-azure-client-secret
   ```

   The account name and certificate profile are already configured in `package.json`:
   - Account: `Hyperclay`
   - Profile: `HyperclayLocalPublicCertProfile`
   - Endpoint: `https://eus.codesigning.azure.net`

## Build

To build signed Windows binaries:

```cmd
npm run build-windows
```

This will:
- Load Azure credentials from `.env` file
- Clean previous Windows builds
- Build the React app (Webpack)
- Compile Tailwind CSS
- Package the Electron app for Windows x64
- **Automatically sign** all executables with Azure Trusted Signing
- Create NSIS installer

**Note:** The `npm run build-windows` script automatically loads environment variables from `.env` and passes them to electron-builder. This solves the issue where electron-builder's Azure signing couldn't find the credentials.

## Output

After successful build, you'll find:

- **Installer**: `dist/HyperclayLocal Setup 1.1.0.exe` (~86MB, signed)
- **Unpacked app**: `dist/win-unpacked/` (all .exe/.dll files signed)
- **Block map**: `dist/HyperclayLocal Setup 1.1.0.exe.blockmap`

## Transferring to macOS

1. Copy the installer to your Mac:
   ```cmd
   # From Windows, copy dist/HyperclayLocal Setup 1.1.0.exe to Mac
   ```

2. On macOS, upload to R2 (optional):
   ```bash
   npm run upload-to-r2
   ```

## Troubleshooting

### "Azure credentials missing"
Make sure `.env` exists and contains all three Azure credentials:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

### "HTTP 403 Forbidden" or signing fails
- Verify your Azure credentials are correct
- Confirm your service principal has permission to use the Trusted Signing service
- Check that the account name and certificate profile in `package.json` match your Azure setup

### Build without signing (for testing)
electron-builder will skip signing if Azure credentials are missing from `.env`.

## How it works

electron-builder has built-in support for Azure Trusted Signing:

1. Reads `azureSignOptions` from `package.json`
2. Uses Azure credentials from environment variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`)
3. Automatically signs all Windows executables during the build process
4. No additional tools or scripts required

## Notes

- The `.env` file is ignored by git (see `.gitignore`)
- NEVER commit `.env` to version control
- Signing happens automatically when credentials are present
- All nested binaries are properly signed (unlike manual `signtool` approaches)
