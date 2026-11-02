'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { expectedShard, verifyShard, verifyUnion } = require('../../scripts/release-test-shard');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const cli = path.resolve(__dirname, '../../scripts/release-test-shard.js');
let fixture;
let allFiles;
let jestShards;

function runJest(...args) {
  const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'),
    '--config', path.join(fixture, 'jest.config.js'), '--rootDir', fixture,
    '--runInBand', '--listTests', '--json', ...args], {
    cwd: fixture, encoding: 'utf8', timeout: 120000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Fixture Jest exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

beforeAll(() => {
  fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-shard-')));
  fs.mkdirSync(path.join(fixture, 'nested'));
  fs.writeFileSync(path.join(fixture, 'jest.config.js'),
    "module.exports = { testEnvironment: 'node', testMatch: ['**/*.test.js'] };\n");
  for (let i = 0; i < 25; i += 1) {
    const dir = i % 2 ? fixture : path.join(fixture, 'nested');
    fs.writeFileSync(path.join(dir, `sample-${i}.test.js`),
      "test('passes', () => expect(1 + 1).toBe(2));\n");
  }
  allFiles = runJest();
  jestShards = [1, 2, 3].map(index => runJest(`--shard=${index}/3`));
});

afterAll(() => {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

function cleanReport(index = 1, rootDir = fixture) {
  const files = expectedShard(allFiles, index, 3, rootDir);
  return {
    success: true,
    numTotalTestSuites: files.length,
    testResults: files.map(name => ({ name, status: 'passed' }))
  };
}

function verify(report, extra = {}) {
  return verifyShard({ allFiles, index: 1, total: 3, rootDir: fixture, report, ...extra });
}

testPosix('expectedShard matches Jest exactly for all three shards', () => {
  expect(allFiles).toHaveLength(25);
  expect(allFiles.every(file => path.isAbsolute(file))).toBe(true);
  expect(jestShards.map(files => files.length)).toEqual([9, 8, 8]);
  for (let index = 1; index <= 3; index += 1) {
    expect(expectedShard(allFiles, index, 3, fixture).sort()).toEqual(jestShards[index - 1].slice().sort());
  }
});

test('shards are disjoint and their exact union is the real fixture list', () => {
  const shards = [1, 2, 3].map(index => expectedShard(allFiles, index, 3, fixture));
  expect(new Set(shards.flat()).size).toBe(allFiles.length);
  expect(shards.flat().sort()).toEqual(allFiles.slice().sort());
  expect(verifyUnion(allFiles, 3, fixture)).toEqual({ ok: true, problems: [] });
});

testPosix('path hashing normalizes Windows separators like Jest', () => {
  const posixFiles = allFiles.map(file => `C:/repo/${path.posix.relative(fixture, file)}`);
  const windowsFiles = posixFiles.map(file => file.replace(/\//g, '\\'));
  for (let index = 1; index <= 3; index += 1) {
    expect(expectedShard(windowsFiles, index, 3, 'C:\\repo').map(file => file.replace(/\\/g, '/')))
      .toEqual(expectedShard(posixFiles, index, 3, 'C:/repo'));
  }
});

test('clean shard report passes', () => {
  expect(verify(cleanReport())).toEqual({ ok: true, problems: [] });
});

test.each([
  ['missing-file', report => { report.testResults.pop(); }],
  ['wrong-shard', report => {
    report.testResults.push({ name: expectedShard(allFiles, 2, 3, fixture)[0], status: 'passed' });
  }],
  ['unknown-file', report => {
    report.testResults.push({ name: path.join(fixture, 'unknown.test.js'), status: 'passed' });
  }],
  ['duplicate-file', report => { report.testResults.push({ ...report.testResults[0] }); }],
  ['suite-not-passed', report => { report.testResults[0].status = 'failed'; }],
  ['suite-not-passed', report => { report.testResults[0].status = 'pending'; }],
  ['suite-not-passed', report => {
    report.testResults[0].testExecError = { message: 'worker died' };
  }],
  ['suite-count', report => { report.numTotalTestSuites += 1; }],
  ['report-unsuccessful', report => { report.success = false; }],
  ['invalid-report', report => { delete report.testResults; }]
])('refuses %s', (problem, mutate) => {
  const report = cleanReport();
  mutate(report);
  const result = verify(report);
  expect(result.ok).toBe(false);
  expect(result.problems.some(message => message.startsWith(`${problem}:`))).toBe(true);
});

test.each(['focused', 'skipped'])('a %s suite with conditional skips counts as completed', status => {
  const report = cleanReport();
  report.testResults[0].status = status;
  expect(verify(report)).toEqual({ ok: true, problems: [] });
});

test('suite execution error in Jest JSON is refused', () => {
  const report = cleanReport();
  report.testResults[0] = { name: report.testResults[0].name, status: 'failed',
    message: 'A jest worker process exited unexpectedly' };
  expect(verify(report).problems).toContain(
    `suite-not-passed: ${report.testResults[0].name} (status=failed)`);
});

test('empty discovery is refused', () => {
  expect(verify({ success: true, numTotalTestSuites: 0, testResults: [] }, { allFiles: [] }))
    .toEqual({ ok: false, problems: ['empty-discovery: no test files discovered'] });
  expect(verifyUnion([], 3).ok).toBe(false);
});

test('more shards than files can have empty shards', () => {
  expect(expectedShard([allFiles[0]], 3, 3, fixture)).toEqual([]);
  expect(verify({ success: true, numTotalTestSuites: 0, testResults: [] }, {
    allFiles: [allFiles[0]], index: 3
  })).toEqual({ ok: true, problems: [] });
});

test('union detects repeated discovery paths', () => {
  expect(verifyUnion([allFiles[0], allFiles[0]], 3, fixture).problems)
    .toEqual([`union-count: ${allFiles[0]} assigned 2 times`]);
});

test.each([[0, 3], [4, 3], [1, 0], [1, 1.5]])('refuses invalid shard %s/%s', (index, total) => {
  expect(() => expectedShard([], index, total)).toThrow('invalid-shard');
});

function runCli(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: fixture, encoding: 'utf8', timeout: 120000 });
}

test('CLI verifies clean and bad reports, printing every problem on its own line', () => {
  const list = path.join(fixture, 'list.json');
  const reportFile = path.join(fixture, 'report.json');
  fs.writeFileSync(list, JSON.stringify(allFiles));
  const report = cleanReport();
  fs.writeFileSync(reportFile, JSON.stringify(report));
  const args = ['verify', '--list', list, '--report', reportFile, '--shard', '1/3'];
  const clean = runCli(...args);
  expect(clean.error).toBeUndefined();
  expect(clean.status).toBe(0);
  expect(clean.stderr).toBe('');
  report.testResults.pop();
  report.numTotalTestSuites -= 1;
  report.success = false;
  fs.writeFileSync(reportFile, JSON.stringify(report));
  const bad = runCli(...args);
  expect(bad.status).toBe(1);
  expect(bad.stderr.trim().split('\n')).toEqual(verify(report).problems);
});

test('CLI plan prints per-shard counts as JSON', () => {
  const list = path.join(fixture, 'plan-list.json');
  fs.writeFileSync(list, JSON.stringify(allFiles));
  const result = runCli('plan', '--list', list, '--total', '3');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    { shard: '1/3', count: 9 }, { shard: '2/3', count: 8 }, { shard: '3/3', count: 8 }
  ]);
});

test('CLI rejects invalid arguments', () => {
  const result = runCli('verify');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('invalid-arguments:');
});
