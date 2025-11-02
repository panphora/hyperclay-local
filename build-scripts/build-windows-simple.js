const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load .env for Azure credentials
require('dotenv').config();

console.log('🔨 Building Windows installer with Azure signing\n');

// Verify Azure credentials exist (but don't pass them to electron-builder)
const requiredVars = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
const missingVars = requiredVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Missing Azure credentials in .env:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\nPlease add these to your .env file.');
  process.exit(1);
}

console.log('✅ Azure credentials loaded from .env');
console.log('   Tenant ID: ' + process.env.AZURE_TENANT_ID.substring(0, 8) + '...');
console.log('   Client ID: ' + process.env.AZURE_CLIENT_ID.substring(0, 8) + '...\n');

try {
  // Step 1: Build COMPLETELY unsigned (force disable signing)
  console.log('📦 Building unsigned installer...\n');
  console.log('   (Forcing electron-builder to skip ALL signing)\n');

  execSync('npm run clean-windows', { stdio: 'inherit' });
  execSync('npm run build-css', { stdio: 'inherit' });
  execSync('npm run build-react-prod', { stdio: 'inherit' });

  // Build without signing (no Azure config = no signing)
  // We need to temporarily clear Azure env vars so electron-builder doesn't auto-detect them
  const buildEnv = { ...process.env };
  delete buildEnv.AZURE_TENANT_ID;
  delete buildEnv.AZURE_CLIENT_ID;
  delete buildEnv.AZURE_CLIENT_SECRET;

  execSync('electron-builder --win', {
    stdio: 'inherit',
    env: buildEnv
  });

  console.log('\n✅ Unsigned installer built successfully\n');

  // Step 2: Sign with AzureSignTool
  const installerPath = path.join(__dirname, '..', 'dist', 'HyperclayLocal Setup 1.1.0.exe');

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Installer not found at: ${installerPath}`);
  }

  console.log('✍️  Signing installer with Azure Trusted Signing...\n');

  // Escape single quotes in values for PowerShell
  const escapePowerShell = (str) => str.replace(/'/g, "''");

  const tenantId = escapePowerShell(process.env.AZURE_TENANT_ID);
  const clientId = escapePowerShell(process.env.AZURE_CLIENT_ID);
  const clientSecret = escapePowerShell(process.env.AZURE_CLIENT_SECRET);
  const installerPathEscaped = escapePowerShell(installerPath);

  // Use Service Principal authentication with explicit parameters
  const psCommand = `
    # Convert client secret to SecureString
    $secureSecret = ConvertTo-SecureString -String '${clientSecret}' -AsPlainText -Force

    # Call with Service Principal authentication
    Invoke-TrustedSigning \`
      -FileDigest SHA256 \`
      -Endpoint https://eus.codesigning.azure.net \`
      -CodeSigningAccountName Hyperclay \`
      -CertificateProfileName HyperclayLocalPublicCertProfile \`
      -Files '${installerPathEscaped}' \`
      -AuthType ServicePrincipal \`
      -TenantId '${tenantId}' \`
      -ClientId '${clientId}' \`
      -ClientSecret $secureSecret
  `.trim();

  // Write to temp file to avoid command line escaping issues
  const tempPs1 = path.join(__dirname, '..', 'temp-sign.ps1');
  fs.writeFileSync(tempPs1, psCommand);

  console.log('Running PowerShell signing script...\n');

  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${tempPs1}"`, { stdio: 'inherit' });
    fs.unlinkSync(tempPs1); // Clean up temp file
  } catch (e) {
    fs.unlinkSync(tempPs1); // Clean up even on error
    throw e;
  }

  console.log('\n✅ Build and signing completed successfully!');
  console.log('   Output: dist\\HyperclayLocal Setup 1.1.0.exe (signed)\n');

} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}