#!/usr/bin/env node

/**
 * Test script to verify reserved words validation
 */

const { validateSiteName, cantInclude, cantBeEqualTo } = require('./sync-engine/validation');

console.log('Testing reserved words validation...\n');

// Test cantInclude words (partial matches)
console.log('Testing cantInclude (partial match blocking):');
const includeTests = [
  'myaccount',     // Contains "account"
  'adminpanel',    // Contains "admin"
  'userprofile',   // Contains "user"
  'hyperclay-app', // Contains "hyperclay"
  'mysite',        // Should be valid
];

includeTests.forEach(name => {
  const result = validateSiteName(name + '.html');
  console.log(`  ${name}: ${result.valid ? '✅ Valid' : `❌ ${result.error}`}`);
});

// Test cantBeEqualTo words (exact matches)
console.log('\nTesting cantBeEqualTo (exact match blocking):');
const equalTests = [
  'api',       // Exact match - should fail
  'dashboard', // Exact match - should fail
  'login',     // Exact match - should fail
  'myapi',     // Not exact - should pass
  'api-v2',    // Not exact - should pass
  'my-site',   // Should be valid
];

equalTests.forEach(name => {
  const result = validateSiteName(name + '.html');
  console.log(`  ${name}: ${result.valid ? '✅ Valid' : `❌ ${result.error}`}`);
});

// Show counts
console.log('\n📊 Statistics:');
console.log(`  cantInclude words: ${cantInclude.length} (blocks partial matches)`);
console.log(`  cantBeEqualTo words: ${cantBeEqualTo.length} (blocks exact matches)`);
console.log(`  Total reserved patterns: ${cantInclude.length + cantBeEqualTo.length}`);

console.log('\n✅ Using the same validation logic as the hyperclay server!');