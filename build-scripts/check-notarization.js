const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

// Determine platform-specific submissions file
const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
const submissionsFile = path.join(__dirname, '..', `.notarization-submissions-${platform}.json`);

function checkStatus(submissionId) {
  try {
    const cmd = `xcrun notarytool info "${submissionId}" \
      --apple-id "${process.env.APPLE_ID}" \
      --team-id "${process.env.APPLE_TEAM_ID}" \
      --password "${process.env.APPLE_APP_SPECIFIC_PASSWORD}" \
      --output-format json`;

    const output = execSync(cmd, { encoding: 'utf8' });
    const info = JSON.parse(output);
    return info;
  } catch (error) {
    return { status: 'Error', message: error.message };
  }
}

function stapleTicket(appPath) {
  try {
    console.log(`\n   📎 Stapling ticket to ${path.basename(appPath)}...`);
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'pipe' });
    console.log(`   ✅ Ticket stapled successfully`);
    return true;
  } catch (error) {
    console.log(`   ❌ Stapling failed: ${error.message}`);
    return false;
  }
}

async function main() {
  // Check environment variables
  const requiredEnvVars = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('\nMake sure your .env file contains all required credentials.');
    process.exit(1);
  }

  // Load submissions
  if (!fs.existsSync(submissionsFile)) {
    console.log('ℹ️  No submissions found.');
    console.log('   Run `npm run mac-build:run` first to create notarization submissions.');
    return;
  }

  let submissions = JSON.parse(fs.readFileSync(submissionsFile, 'utf8'));
  let updated = false;

  console.log('\n🔍 Checking notarization status...\n');

  for (const submission of submissions) {
    if (submission.status === 'stapled') {
      // Already done, skip
      continue;
    }

    console.log(`📦 ${submission.appName} (${submission.arch})`);
    console.log(`   ID: ${submission.id}`);
    console.log(`   Submitted: ${new Date(submission.timestamp).toLocaleString()}`);

    const info = checkStatus(submission.id);

    if (info.status === 'Accepted') {
      console.log(`   ✅ Status: Accepted`);

      // Try to staple
      if (fs.existsSync(submission.appPath)) {
        if (stapleTicket(submission.appPath)) {
          submission.status = 'stapled';
          updated = true;
        }
      } else {
        console.log(`   ⚠️  App not found at: ${submission.appPath}`);
        console.log(`   💡 You may need to rebuild and resubmit`);
        submission.status = 'accepted-not-stapled';
        updated = true;
      }
    } else if (info.status === 'In Progress') {
      console.log(`   ⏳ Status: In Progress`);
      console.log(`   💡 Check again later`);
    } else if (info.status === 'Invalid') {
      console.log(`   ❌ Status: Invalid`);
      console.log(`   Message: ${info.statusSummary || 'No details available'}`);
      console.log(`   💡 View log: xcrun notarytool log "${submission.id}" --apple-id "$APPLE_ID" ...`);
      submission.status = 'invalid';
      updated = true;
    } else {
      console.log(`   ⚠️  Status: ${info.status}`);
      if (info.message) {
        console.log(`   Message: ${info.message}`);
      }
    }

    console.log('');
  }

  // Save updated statuses
  if (updated) {
    fs.writeFileSync(submissionsFile, JSON.stringify(submissions, null, 2));
  }

  // Summary
  const accepted = submissions.filter(s => s.status === 'stapled').length;
  const pending = submissions.filter(s => s.status === 'submitted').length;
  const invalid = submissions.filter(s => s.status === 'invalid').length;

  console.log('─'.repeat(50));
  console.log(`✅ Stapled: ${accepted}`);
  console.log(`⏳ Pending: ${pending}`);
  console.log(`❌ Invalid: ${invalid}`);
  console.log('─'.repeat(50));

  if (pending > 0) {
    console.log('\n💡 Run this command again later to check pending submissions.');
  }

  if (accepted === submissions.length && accepted > 0) {
    console.log('\n🎉 All submissions are notarized and stapled!');
    console.log('   Your apps are ready for distribution.');
  }
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
