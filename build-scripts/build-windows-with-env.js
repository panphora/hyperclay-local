const { execSync } = require('child_process');
const path = require('path');

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
  // Run the build with environment variables passed through
  execSync('npm run clean-windows && npm run build-css && npm run build-react-prod && electron-builder --win', {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Ensure Azure variables are explicitly passed
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
      AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
    }
  });

  console.log('\n✅ Build completed successfully!');
  console.log('   Output: dist\\Hyperclay Local Setup 1.1.0.exe\n');
} catch (error) {
  console.error('\n❌ Build failed');
  process.exit(1);
}
