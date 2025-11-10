const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

exports.default = async function notarizeSubmit(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    console.log('   ✓ Not macOS, skipping notarization\n');
    return;
  }

  // Skip notarization if env var is set
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('   ⚠️  Skipping notarization (SKIP_NOTARIZE=true)\n');
    return;
  }

  // Check environment variables
  const requiredEnvVars = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    console.log('   ⚠️  Missing Apple credentials, skipping notarization');
    console.log(`   Missing: ${missingVars.join(', ')}\n`);
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const zipPath = `${appPath}.zip`;

  console.log('\n📤 Submitting for notarization...');
  console.log(`   App: ${appName}`);
  console.log(`   Path: ${appPath}`);

  try {
    // Create zip file for notarization
    console.log('   → Creating zip archive...');
    execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'pipe' });

    // Submit to Apple WITHOUT --wait
    console.log('   → Uploading to Apple (non-blocking)...');
    const submitCmd = `xcrun notarytool submit "${zipPath}" \
      --apple-id "${process.env.APPLE_ID}" \
      --team-id "${process.env.APPLE_TEAM_ID}" \
      --password "${process.env.APPLE_APP_SPECIFIC_PASSWORD}"`;

    const output = execSync(submitCmd, { encoding: 'utf8' });

    // Extract submission ID
    const idMatch = output.match(/id:\s+([a-f0-9-]+)/i);
    if (!idMatch) {
      throw new Error('Could not extract submission ID from notarytool output');
    }

    const submissionId = idMatch[1];
    console.log(`   ✅ Submitted! ID: ${submissionId}`);

    // Save submission ID to platform-specific file
    const submissionsFile = path.join(__dirname, '..', '.notarization-submissions-mac.json');
    let submissions = [];

    if (fs.existsSync(submissionsFile)) {
      try {
        submissions = JSON.parse(fs.readFileSync(submissionsFile, 'utf8'));
      } catch (e) {
        // File exists but is corrupted, start fresh
        submissions = [];
      }
    }

    submissions.push({
      id: submissionId,
      appName: appName,
      appPath: appPath,
      arch: context.arch === 1 ? 'arm64' : 'x64',
      timestamp: new Date().toISOString(),
      status: 'submitted'
    });

    fs.writeFileSync(submissionsFile, JSON.stringify(submissions, null, 2));
    console.log(`   📝 Saved to .notarization-submissions-mac.json`);

    // Clean up zip file
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    console.log('\n   💡 After ~5-10 minutes, finalize with: npm run mac-build:finalize\n');

  } catch (error) {
    console.error('\n   ❌ Notarization submission failed');
    console.error(`   Error: ${error.message}\n`);

    // Clean up zip file on error
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    // Don't throw - allow build to continue
    // The app is still signed, just not notarized yet
  }
};
