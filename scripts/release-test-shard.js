'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function validateShard(index, total) {
  if (!Number.isSafeInteger(total) || total < 1 ||
      !Number.isSafeInteger(index) || index < 1 || index > total) {
    throw new Error('invalid-shard: expected 1 <= index <= total, with positive integers');
  }
}

function validateFiles(allFiles) {
  if (!Array.isArray(allFiles) || allFiles.some(file => typeof file !== 'string' || !file)) {
    throw new Error('invalid-list: expected an array of test file paths');
  }
}

function expectedShard(allFiles, index, total, rootDir = process.cwd()) {
  validateShard(index, total);
  validateFiles(allFiles);
  const slash = value => value.replace(/\\/g, '/');
  const size = Math.floor(allFiles.length / total);
  const remainder = allFiles.length % total;
  const start = size * (index - 1) + Math.min(index - 1, remainder);
  const end = size * index + Math.min(index, remainder);
  return allFiles.map(file => ({
    file,
    hash: crypto.createHash('sha1')
      .update(path.posix.relative(slash(rootDir), slash(file))).digest('hex')
  })).sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
    .slice(start, end).map(result => result.file);
}

function verifyShard({ allFiles, index, total, report, rootDir = process.cwd() }) {
  const expected = new Set(expectedShard(allFiles, index, total, rootDir));
  const known = new Set(allFiles);
  const problems = [];
  if (allFiles.length === 0) problems.push('empty-discovery: no test files discovered');
  if (expected.size === 0 && allFiles.length >= total) {
    problems.push(`empty-shard: shard ${index}/${total} has no files`);
  }
  const results = Array.isArray(report?.testResults) ? report.testResults : [];
  if (!Array.isArray(report?.testResults)) problems.push('invalid-report: testResults must be an array');
  const seen = new Set();
  for (const result of results) {
    const name = result?.name;
    if (!known.has(name)) problems.push(`unknown-file: ${name}`);
    else if (!expected.has(name)) problems.push(`wrong-shard: ${name}`);
    if (seen.has(name)) problems.push(`duplicate-file: ${name}`);
    seen.add(name);
    if (result?.status !== 'passed' || result?.testExecError) {
      problems.push(`suite-not-passed: ${name} (status=${result?.status}${result?.testExecError ? ', testExecError' : ''})`);
    }
  }
  for (const name of expected) {
    if (!seen.has(name)) problems.push(`missing-file: ${name}`);
  }
  if (report?.numTotalTestSuites !== expected.size) {
    problems.push(`suite-count: expected ${expected.size}, received ${report?.numTotalTestSuites}`);
  }
  if (report?.success !== true) problems.push('report-unsuccessful: success must be true');
  return { ok: problems.length === 0, problems };
}

function verifyUnion(allFiles, total, rootDir = process.cwd()) {
  validateShard(1, total);
  validateFiles(allFiles);
  const counts = new Map(allFiles.map(file => [file, 0]));
  for (let index = 1; index <= total; index += 1) {
    for (const file of expectedShard(allFiles, index, total, rootDir)) {
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  }
  const problems = [];
  if (allFiles.length === 0) problems.push('empty-discovery: no test files discovered');
  for (const [file, count] of counts) {
    if (count !== 1) problems.push(`union-count: ${file} assigned ${count} times`);
  }
  return { ok: problems.length === 0, problems };
}

function main(argv) {
  const [command, ...args] = argv;
  const allowed = command === 'verify' ? ['--list', '--report', '--shard']
    : command === 'plan' ? ['--list', '--total'] : [];
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || options[args[i]]) {
      throw new Error('invalid-arguments: use verify --list <file> --report <file> --shard <i>/<n>, or plan --list <file> --total <n>');
    }
    options[args[i]] = args[i + 1];
  }
  if (!allowed.length || allowed.some(flag => !options[flag])) {
    throw new Error('invalid-arguments: missing command or required option');
  }
  const allFiles = JSON.parse(fs.readFileSync(options['--list'], 'utf8'));
  if (command === 'plan') {
    const total = Number(options['--total']);
    const union = verifyUnion(allFiles, total);
    if (!union.ok) {
      console.error(union.problems.join('\n'));
      return 1;
    }
    console.log(JSON.stringify(Array.from({ length: total }, (_, i) => ({
      shard: `${i + 1}/${total}`, count: expectedShard(allFiles, i + 1, total).length
    }))));
    return 0;
  }
  if (!/^\d+\/\d+$/.test(options['--shard'])) throw new Error('invalid-shard: use <i>/<n>');
  const [index, total] = options['--shard'].split('/').map(Number);
  const report = JSON.parse(fs.readFileSync(options['--report'], 'utf8'));
  const result = verifyShard({ allFiles, index, total, report });
  if (!result.ok) console.error(result.problems.join('\n'));
  return result.ok ? 0 : 1;
}

module.exports = { expectedShard, verifyShard, verifyUnion };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
