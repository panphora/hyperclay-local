#!/usr/bin/env node

// No-op function for local builds that skip signing/notarization
// This is used as a placeholder for the afterSign hook

module.exports = async function(context) {
  console.log('⏭️  Skipping notarization (local build)');
  return Promise.resolve();
};
