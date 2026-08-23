const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config();

// Stapling the app is not the same as stapling the disk image the app arrives in.
//
// The afterSign hook notarizes and staples HyperclayLocal.app before electron-builder
// packages it, so the DMG we ship contains an app whose ticket is already attached and
// which launches offline. The DMG itself carries no ticket, so Gatekeeper's check of the
// download is an online one: on a first-run machine with no network, or with Apple's
// service slow, that is the check the user waits on.
//
// This hook closes that by submitting each finished .dmg and stapling the ticket to it.
// It runs after every artifact is built, which is the only point where the DMGs exist.
//
// The DMG must be signed for Apple to accept it, which is why build.dmg.sign is true.
// Signing a DMG clears the internet-enabled flag, which we do not use.
//
// Stapling writes the ticket into the .dmg, so its size and hash no longer match what
// electron-builder recorded in latest-mac.yml and the .dmg.blockmap just before this
// runs. That costs nothing today: post-build.js uploads only .dmg, .exe and .AppImage,
// so neither file is published, and the app has no electron-updater dependency and no
// autoUpdater call in src/ anyway, updating instead through release-info.json. Whoever
// turns electron-updater on has to regenerate both after this hook.
exports.default = async function stapleDmg(context) {
  const artifacts = (context.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (!artifacts.length) return;

  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('   ⚠️  Skipping DMG stapling (SKIP_NOTARIZE=true)\n');
    return;
  }

  const required = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length) {
    console.log('   ⚠️  Missing Apple credentials, leaving the DMGs unstapled');
    console.log(`   Missing: ${missing.join(', ')}\n`);
    return;
  }

  const credentials =
    `--apple-id "${process.env.APPLE_ID}" ` +
    `--team-id "${process.env.APPLE_TEAM_ID}" ` +
    `--password "${process.env.APPLE_APP_SPECIFIC_PASSWORD}"`;

  for (const dmg of artifacts) {
    console.log(`\n📀 Stapling ${path.basename(dmg)}`);
    // A failure here throws. The app inside is already notarized, so a half-stapled
    // set of artifacts would look fine locally and only show up as an online
    // Gatekeeper check on a user's machine, which is exactly the thing this exists
    // to remove.
    execSync(`xcrun notarytool submit "${dmg}" ${credentials} --wait`, { stdio: 'inherit' });
    execSync(`xcrun stapler staple "${dmg}"`, { stdio: 'inherit' });
    execSync(`xcrun stapler validate "${dmg}"`, { stdio: 'inherit' });
    console.log(`   ✅ ${path.basename(dmg)} stapled`);
  }
};
