'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IDENTITY_FIELDS = ['workflow_sha', 'candidate_sha256', 'attempt', 'manifest_identity'];

function fullInventory() {
  const jobs = [{ id: 'verify', kind: 'verify', artifacts: ['identity'] }];
  for (const platform of ['macos', 'linux-x64', 'linux-arm64']) {
    for (let index = 1; index <= 3; index += 1) {
      jobs.push({ id: `test-${platform}-${index}`, kind: 'test', platform,
        shard: `${index}/3`, helper: 'scripts/release-test-shard.js',
        command: `npm test -- --runInBand --shard=${index}/3` });
    }
  }
  jobs.push({ id: 'test-windows', kind: 'test', platform: 'windows',
    command: 'npm test -- --runInBand' });
  jobs.push(
    { id: 'conformance', kind: 'test' },
    { id: 'license', kind: 'test' },
    { id: 'audit', kind: 'test', command: 'npm audit --omit=dev --audit-level=critical' },
    { id: 'offline-runtime', kind: 'test', command: 'node scripts/check-offline-runtime-release.mjs' }
  );
  for (const platform of ['macos', 'windows', 'linux-x64', 'linux-arm64']) {
    jobs.push({ id: `build-${platform}`, kind: 'build', platform, artifacts: [`build-${platform}`] });
  }
  for (const arch of ['x64', 'arm64']) {
    for (const check of ['appimage-launch', 'server-save', 'popover', 'autostart']) {
      jobs.push({ id: `linux-${arch}-${check}`, kind: 'desktop', platform: `linux-${arch}` });
    }
  }
  jobs.push(
    { id: 'linux-update-signing', kind: 'signing', artifacts: ['linux-update-signing'],
      needs: ['verify', 'build-linux-x64', 'build-linux-arm64'],
      outputs: ['executables/*.AppImage.sig'],
      optionalKey: { name: 'HLOCAL_UPDATE_SEED', missing: 'omit-linux-feeds-and-signatures',
        invalid: 'fail', untrusted: 'fail' } },
    { id: 'update-feed', kind: 'prepare', artifacts: ['update-feed'],
      needs: ['verify', 'build-macos', 'build-windows', 'build-linux-x64', 'build-linux-arm64',
        'linux-update-signing'],
      outputs: ['executables/latest-mac.yml', 'executables/latest.yml'],
      conditionalOutputs: { HLOCAL_UPDATE_SEED: ['executables/latest-linux.yml',
        'executables/latest-linux-arm64.yml'] } }
  );
  return jobs;
}

function candidateJobGraph(inventory = fullInventory()) {
  return inventory.map(job => ({ ...job,
    needs: job.needs ?? (job.kind === 'verify' ? []
      : job.kind === 'desktop' ? ['verify', `build-${job.platform}`] : ['verify'])
  }));
}

function candidateContract() {
  const graph = candidateJobGraph();
  return { checks: graph.map(job => job.id), artifacts: graph.flatMap(job => job.artifacts || []) };
}

function verifyCandidate({ identity, expected }) {
  const problems = [];
  if (expected?.app !== 'hyperclay-local' ||
      (identity?.app !== undefined && identity.app !== expected?.app)) {
    problems.push('app: expected hyperclay-local');
  }
  for (const field of IDENTITY_FIELDS) {
    const value = identity?.[field];
    if (typeof value !== 'string' || !value ||
        typeof expected?.[field] !== 'string' || !expected[field]) {
      problems.push(`${field}: missing identity or expected value`);
    } else if (value !== expected[field]) {
      problems.push(`${field}: identity does not match dispatch`);
    } else if (field !== 'attempt' &&
        !(field === 'workflow_sha' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(value)) {
      problems.push(`${field}: invalid digest`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function identityArtifact(inputs) {
  const result = verifyCandidate({ identity: inputs, expected: inputs });
  if (!result.ok) throw new Error(result.problems.join('\n'));
  return Object.fromEntries(IDENTITY_FIELDS.map(field => [field, inputs[field]]));
}

function summarize(results) {
  const jobs = candidateJobGraph().map(({ id }) => ({
    id, status: Object.prototype.hasOwnProperty.call(results || {}, id) ? results[id] : 'missing'
  }));
  const missing = jobs.filter(job => job.status === 'missing').map(job => job.id);
  const pending = jobs.filter(job => ['pending', 'queued', 'running', 'in_progress'].includes(job.status))
    .map(job => job.id);
  const failed = jobs.filter(job => job.status !== 'passed' &&
    !missing.includes(job.id) && !pending.includes(job.id)).map(job => job.id);
  const problems = jobs.filter(job => job.status !== 'passed')
    .map(job => `${job.id}: ${job.status}`);
  return { ok: problems.length === 0, complete: missing.length === 0 && pending.length === 0,
    jobs, missing, pending, failed, problems };
}

function main(argv) {
  const [command, file, directory] = argv;
  const counts = { graph: 1, contract: 1, verify: 2, summarize: 2, identity: 3 };
  if (argv.length !== counts[command]) {
    throw new Error('invalid-arguments: use graph, contract, verify <json>, summarize <results.json>, or identity <inputs.json> <directory>');
  }
  const input = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (command === 'identity') {
    const artifact = identityArtifact(input);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'identity.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    return 0;
  }
  const result = command === 'graph' ? candidateJobGraph()
    : command === 'contract' ? candidateContract()
    : command === 'verify' ? verifyCandidate(input) : summarize(input);
  console.log(JSON.stringify(result, null, 2));
  return result.ok === false ? 1 : 0;
}

module.exports = { candidateContract, candidateJobGraph, verifyCandidate, summarize, identityArtifact };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
