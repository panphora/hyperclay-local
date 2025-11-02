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

  console.log('✍️  Signing installer with AzureSignTool...\n');

  // Build command as array for clarity
  const signArgs = [
    'azuresigntool', 'sign',
    '-kvu', 'https://eus.codesigning.azure.net',
    '-kva', 'Hyperclay',  // Account name
    '-kvt', process.env.AZURE_TENANT_ID,
    '-kvi', process.env.AZURE_CLIENT_ID,
    '-kvs', process.env.AZURE_CLIENT_SECRET,
    '-kvc', 'HyperclayLocalPublicCertProfile',  // Certificate profile
    '-v', `"${installerPath}"`
  ];

  const signCommand = signArgs.join(' ');

  // Log command (with secret hidden)
  console.log('Command:', signCommand.replace(process.env.AZURE_CLIENT_SECRET, '***SECRET***'));
  console.log('');

  execSync(signCommand, { stdio: 'inherit' });

  console.log('\n✅ Build and signing completed successfully!');
  console.log('   Output: dist\\HyperclayLocal Setup 1.1.0.exe (signed)\n');

} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}