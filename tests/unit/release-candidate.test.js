'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { candidateJobGraph, verifyCandidate, summarize, identityArtifact } = require('../../scripts/release-candidate');

const expectedIds = [
  'verify',
  'test-macos-1', 'test-macos-2', 'test-macos-3',
  'test-linux-x64-1', 'test-linux-x64-2', 'test-linux-x64-3',
  'test-linux-arm64-1', 'test-linux-arm64-2', 'test-linux-arm64-3',
  'test-windows', 'conformance', 'license', 'audit', 'offline-runtime',
  'build-macos', 'build-windows', 'build-linux-x64', 'build-linux-arm64',
  'linux-x64-appimage-launch', 'linux-x64-server-save', 'linux-x64-popover', 'linux-x64-autostart',
  'linux-arm64-appimage-launch', 'linux-arm64-server-save', 'linux-arm64-popover', 'linux-arm64-autostart',
  'linux-update-signing', 'update-feed'
];
const inputs = { app: 'hyperclay-local', attempt: 'attempt-3.2',
  manifest_identity: 'a'.repeat(64), candidate_sha256: 'b'.repeat(64), workflow_sha: 'c'.repeat(40) };
const green = () => Object.fromEntries(expectedIds.map(id => [id, 'passed']));

test('full inventory has exactly every required job, without release-only exclusions', () => {
  const graph = candidateJobGraph();
  expect(graph.map(job => job.id)).toEqual(expectedIds);
  expect(graph.filter(job => job.shard)).toHaveLength(9);
  for (const job of graph.filter(job => job.id.startsWith('test-'))) {
    expect(job.command).toMatch(/^npm test -- --runInBand/);
    expect(job.command).not.toMatch(/HCL_TESTS|testPathIgnore|exclude/);
    if (job.shard) expect(job.helper).toBe('scripts/release-test-shard.js');
  }
  expect(graph.find(job => job.id === 'audit').command)
    .toBe('npm audit --omit=dev --audit-level=critical');
});

test('graph has no edge from any test job to any build job', () => {
  const graph = candidateJobGraph();
  const byId = new Map(graph.map(job => [job.id, job]));
  function ancestors(job) {
    return job.needs.flatMap(id => [byId.get(id), ...ancestors(byId.get(id))]);
  }
  for (const job of graph.filter(job => job.kind === 'build')) {
    expect(ancestors(job).some(parent => parent.kind === 'test')).toBe(false);
    expect(job.needs).toEqual(['verify']);
  }
  for (const job of graph.filter(job => job.kind === 'test')) expect(job.needs).toEqual(['verify']);
  for (const job of graph.filter(job => job.kind === 'desktop')) {
    expect(job.needs).toEqual(['verify', `build-${job.platform}`]);
  }
});

test('red macOS test leaves macOS build running and reported, then completed', () => {
  const results = { ...green(), 'test-macos-1': 'failed', 'build-macos': 'running' };
  const summary = summarize(results);
  expect(summary.ok).toBe(false);
  expect(summary.complete).toBe(false);
  expect(summary.failed).toEqual(['test-macos-1']);
  expect(summary.jobs).toContainEqual({ id: 'build-macos', status: 'running' });
  expect(candidateJobGraph().find(job => job.id === 'build-macos').needs
    .every(id => results[id] === 'passed')).toBe(true);
  results['build-macos'] = 'passed';
  expect(summarize(results).complete).toBe(true);
  expect(summarize(results).failed).toEqual(['test-macos-1']);
});

test('Windows signing failure leaves Linux and macOS builds reported', () => {
  const summary = summarize({ ...green(), 'build-windows': 'failed' });
  expect(summary.ok).toBe(false);
  expect(summary.complete).toBe(true);
  expect(summary.failed).toEqual(['build-windows']);
  for (const id of ['build-macos', 'build-linux-x64', 'build-linux-arm64']) {
    expect(summary.jobs).toContainEqual({ id, status: 'passed' });
    expect(candidateJobGraph().find(job => job.id === id).needs).toEqual(['verify']);
  }
});

test('feed preparation and Linux signing require their builds and retain their outputs', () => {
  const graph = candidateJobGraph();
  expect(graph.find(job => job.id === 'linux-update-signing')).toMatchObject({
    needs: ['verify', 'build-linux-x64', 'build-linux-arm64'],
    outputs: ['executables/*.AppImage.sig'],
    optionalKey: { name: 'HLOCAL_UPDATE_SEED', missing: 'omit-linux-feeds-and-signatures',
      invalid: 'fail', untrusted: 'fail' }
  });
  expect(graph.find(job => job.id === 'update-feed')).toMatchObject({
    needs: ['verify', 'build-macos', 'build-windows', 'build-linux-x64', 'build-linux-arm64',
      'linux-update-signing'],
    outputs: ['executables/latest-mac.yml', 'executables/latest.yml'],
    conditionalOutputs: { HLOCAL_UPDATE_SEED: ['executables/latest-linux.yml',
      'executables/latest-linux-arm64.yml'] }
  });
});

test.each(['update-feed', 'linux-update-signing'])('failed %s makes summary red', id => {
  expect(summarize({ ...green(), [id]: 'failed' })).toMatchObject({
    ok: false, complete: true, failed: [id], problems: [`${id}: failed`]
  });
});

test.each(expectedIds)('missing %s makes summary incomplete', id => {
  const results = green();
  delete results[id];
  expect(summarize(results)).toMatchObject({ ok: false, complete: false, missing: [id],
    problems: [`${id}: missing`] });
});

test('only all passed jobs qualify; cancelled, skipped and unknown statuses remain red', () => {
  expect(summarize(green())).toMatchObject({ ok: true, complete: true, problems: [] });
  for (const status of ['cancelled', 'skipped', 'infrastructure-failed', 'success', null]) {
    expect(summarize({ ...green(), license: status })).toMatchObject({ ok: false, failed: ['license'] });
  }
  expect(summarize({}).missing).toEqual(expectedIds);
});

test('identity artifact has exactly the contract fields and verifies against dispatch', () => {
  expect(identityArtifact(inputs)).toEqual({ workflow_sha: inputs.workflow_sha,
    candidate_sha256: inputs.candidate_sha256, attempt: inputs.attempt,
    manifest_identity: inputs.manifest_identity });
  expect(verifyCandidate({ identity: identityArtifact(inputs), expected: inputs }))
    .toEqual({ ok: true, problems: [] });
});

test.each(['attempt', 'manifest_identity', 'candidate_sha256', 'workflow_sha'])('refuses mismatched %s', field => {
  const result = verifyCandidate({ identity: { ...identityArtifact(inputs), [field]: 'wrong' }, expected: inputs });
  expect(result).toEqual({ ok: false, problems: [`${field}: identity does not match dispatch`] });
});

test('refuses wrong app, missing values and invalid digests', () => {
  expect(verifyCandidate({ identity: inputs, expected: { ...inputs, app: 'htmlclay' } }).ok).toBe(false);
  expect(verifyCandidate({ identity: { ...inputs, app: 'htmlclay' }, expected: inputs }).ok).toBe(false);
  expect(verifyCandidate({ identity: {}, expected: {} }).problems).toHaveLength(5);
  expect(() => identityArtifact({ ...inputs, candidate_sha256: 'bad' })).toThrow('invalid digest');
});

test('no candidate job or step uploads or publishes', () => {
  for (const job of candidateJobGraph()) {
    expect(job.id).not.toMatch(/upload|publish/i);
    expect(job.kind).not.toMatch(/upload|publish/i);
    for (const step of job.steps || []) expect(step.kind).not.toMatch(/upload|publish/i);
  }
});

test('CLI prints graph, refuses invalid identity, summarizes and writes identity.json', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-candidate-'));
  const cli = path.resolve(__dirname, '../../scripts/release-candidate.js');
  const file = path.join(directory, 'input.json');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  try {
    expect(JSON.parse(run('graph').stdout).map(job => job.id)).toEqual(expectedIds);
    fs.writeFileSync(file, JSON.stringify(inputs));
    expect(run('identity', file, directory).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'identity.json'), 'utf8')))
      .toEqual(identityArtifact(inputs));
    fs.writeFileSync(file, JSON.stringify({ identity: identityArtifact(inputs), expected: inputs }));
    expect(run('verify', file).status).toBe(0);
    fs.writeFileSync(file, JSON.stringify({ identity: {}, expected: inputs }));
    expect(run('verify', file).status).toBe(1);
    fs.writeFileSync(file, JSON.stringify(green()));
    expect(run('summarize', file).status).toBe(0);
    fs.writeFileSync(file, '{}');
    const red = run('summarize', file);
    expect(red.status).toBe(1);
    expect(JSON.parse(red.stdout).missing).toEqual(expectedIds);
    expect(run('identity').status).toBe(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
