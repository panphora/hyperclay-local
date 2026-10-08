'use strict';

const path = require('node:path');

// The full jest suite runs on the Hetzner test box, never on the Mac: the release-* suites build
// throwaway git repos and push to them for 15 to 60 minutes each, across every jest worker, while
// other sessions share the machine. GitHub Actions' macOS runners (CI set) still run it.

const VALUE_FLAGS = new Set([
  '--maxWorkers', '-w', '--config', '-c', '--rootDir', '--roots', '--shard', '--reporters',
  '--outputFile', '--coverageDirectory', '--testTimeout', '--maxConcurrency',
  '--workerIdleMemoryLimit', '--testPathIgnorePatterns', '--seed',
]);
const FOCUS_FLAGS = new Set([
  '--testPathPatterns', '--testPathPattern', '--testNamePattern', '-t', '--selectProjects',
  '--findRelatedTests', '--runTestsByPath', '--onlyChanged', '-o', '--changedSince', '--lastCommit',
  '--listTests', '--showConfig', '--clearCache', '--watch',
]);

const LOCAL_SUITE_MESSAGE = [
  'Refusing to run the full hyperclay-local jest suite on this Mac.',
  '',
  'The full suite runs on the Hetzner test box. From the repo root, in the background:',
  '  testbox run                                                   everyday: app tests + node:test',
  "  testbox run --command 'umask 022 && npm run test:full'        releases: adds the release tier",
  'Output lands in test-box-out/latest/. Exit 0 is green, 1 tests failed, 2 infrastructure.',
  '',
  'Focused runs stay local: npm test -- tests/path/to/file.test.js, or -t "<name>".',
  'Override only when David asks for a local full run: HYPERCLAY_LOCAL_LOCAL_SUITE=1 npm test',
].join('\n');

function isFullSuite(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('-')) return false;
    const name = arg.split('=')[0];
    if (FOCUS_FLAGS.has(name)) return false;
    if (VALUE_FLAGS.has(name) && !arg.includes('=')) i += 1;
  }
  return true;
}

function localSuiteRefusal({ argv = process.argv, platform = process.platform, env = process.env } = {}) {
  if (!['jest', 'jest.js'].includes(path.basename(argv[1] || ''))) return null;
  if (platform !== 'darwin' || env.CI || env.HYPERCLAY_LOCAL_LOCAL_SUITE === '1') return null;
  return isFullSuite(argv.slice(2)) ? LOCAL_SUITE_MESSAGE : null;
}

module.exports = { LOCAL_SUITE_MESSAGE, isFullSuite, localSuiteRefusal };
