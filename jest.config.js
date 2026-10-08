const { localSuiteRefusal } = require('./scripts/local-suite-guard');

const refusal = localSuiteRefusal();
if (refusal) {
  console.error(refusal);
  process.exit(1);
}

// The release pipeline's suites are most of the suite's runtime and guard a script that changes
// rarely. HCL_TESTS=app (npm run test:app) leaves them out for everyday runs; releases run them all.
const RELEASE_TESTS = [
  '<rootDir>/tests/unit/release-[^/]*\\.test\\.js$',
  '<rootDir>/tests/unit/update-external-docs\\.test\\.js$',
  '<rootDir>/tests/unit/write-download-sizes\\.test\\.js$',
];

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', ...(process.env.HCL_TESTS === 'app' ? RELEASE_TESTS : [])],
  globalSetup: '<rootDir>/tests/helpers/real-git.js',
  collectCoverageFrom: [
    'src/sync-engine/**/*.js',
    'src/main/utils/**/*.js',
    '!**/node_modules/**'
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  verbose: true
};
