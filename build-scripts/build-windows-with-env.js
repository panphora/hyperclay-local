const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
require('dotenv').config();

console.log('🔨 Building Windows installer with Azure code signing...\n');

// Check for required Azure credentials
const requiredVars = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
const missingVars = requiredVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error('❌ Missing required Azure credentials in .env:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\nPlease add these to your .env file.');
  process.exit(1);
}

console.log('✅ Azure credentials found');
console.log('   Tenant ID: ' + process.env.AZURE_TENANT_ID.substring(0, 8) + '...');
console.log('   Client ID: ' + process.env.AZURE_CLIENT_ID.substring(0, 8) + '...\n');

try {
  // Step 1: Build unsigned (skip electron-builder's buggy Azure signing)
  console.log('📦 Building unsigned installer...\n');
  execSync('npm run clean-windows && npm run build-css && npm run build-react-prod && electron-builder --win', {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Clear Azure credentials so electron-builder skips signing
      AZURE_TENANT_ID: undefined,
      AZURE_CLIENT_ID: undefined,
      AZURE_CLIENT_SECRET: undefined,
    }
  });

  console.log('\n✅ Unsigned build completed\n');

  // Step 2: Sign with AzureSignTool (more reliable than Microsoft's SignTool)
  console.log('✍️  Signing installer with AzureSignTool...\n');

  const installerPath = path.join(__dirname, '..', 'dist', 'HyperclayLocal Setup 1.1.0.exe');

  if (!fs.existsSync(installerPath)) {
    throw new Error(`Installer not found at: ${installerPath}`);
  }

  const signCommand = `azuresigntool sign -kvu "https://eus.codesigning.azure.net" -kvc "Hyperclay" -kvt "${process.env.AZURE_TENANT_ID}" -kvi "${process.env.AZURE_CLIENT_ID}" -kvs "${process.env.AZURE_CLIENT_SECRET}" -kvcert "HyperclayLocalPublicCertProfile" -v "${installerPath}"`;

  execSync(signCommand, {
    stdio: 'inherit'
  });

  console.log('\n✅ Build and signing completed successfully!');
  console.log('   Output: dist\\HyperclayLocal Setup 1.1.0.exe (signed)\n');
} catch (error) {
  console.error('\n❌ Build failed');
  console.error(error.message);
  process.exit(1);
}
