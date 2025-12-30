module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/sync-engine/**/*.js',
    'src/main/utils/**/*.js',
    '!**/node_modules/**'
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  verbose: true
};
