'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { candidateJobGraph, candidateContract } = require('../../scripts/release-candidate');
const { testPosix } = require('../helpers/platform');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, '.github/workflows/platform-candidate.yml'), 'utf8');
const workflow = yaml.load(source);
const action = yaml.load(fs.readFileSync(path.join(root, '.github/actions/candidate/action.yml'), 'utf8'));
const graph = candidateJobGraph();

test('dispatch identity and the entire graph match the platform contract', () => {
  expect(workflow['run-name']).toBe('platform ${{ inputs.attempt }}');
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  const inputs = workflow.on.workflow_dispatch.inputs;
  expect(Object.keys(inputs).sort()).toEqual(['attempt', 'manifest_identity', 'candidate_sha256', 'app', 'candidate_key'].sort());
  for (const input of Object.values(inputs)) expect(input).toMatchObject({ required: true, type: 'string' });
  expect(Object.keys(workflow.jobs)).toEqual(graph.map(job => job.id));
  for (const job of graph) {
    expect(workflow.jobs[job.id].name).toBe(job.id);
    expect(workflow.jobs[job.id].needs || []).toEqual(job.needs);
  }
});

test('all work uses the extracted candidate and only trusted scripts come from checkout', () => {
  for (const job of graph.filter(job => job.id !== 'verify')) {
    const actual = workflow.jobs[job.id];
    expect(actual.defaults.run).toEqual({ shell: 'bash', 'working-directory': 'candidate' });
    expect(actual.steps[0]).toEqual({ uses: 'actions/checkout@v4', with: { ref: '${{ github.workflow_sha }}', path: 'trusted' } });
    expect(actual.steps[1].uses).toBe('./trusted/.github/actions/candidate');
    expect(actual.steps.filter(step => step.uses?.startsWith('actions/checkout'))).toHaveLength(1);
  }
  expect(action.runs.steps[0]).toMatchObject({ uses: 'actions/setup-node@v4' });
  expect(action.runs.steps.some(step => step.uses?.includes('download-artifact'))).toBe(false);
  const commands = action.runs.steps.map(step => step.run || '').join('\n');
  expect(commands).toContain('platform-candidate-archive.py');
  expect(commands).toContain('cd "$GITHUB_WORKSPACE/candidate"\nnpm ci --foreground-scripts');
  expect(source).not.toMatch(/cancel-in-progress|fail-fast: true/);
});

test('verification precedes identity and candidate transfer', () => {
  const steps = workflow.jobs.verify.steps;
  const verify = steps.find(step => step.name === 'Download and verify candidate before identity');
  expect(verify.run).toContain('object.Metadata.sha256');
  expect(verify.run).toContain("hash !== process.env.CANDIDATE_SHA256");
  expect(verify.run).toContain('release-candidate.js identity');
  expect(verify.run.indexOf('archive sha256 mismatch')).toBeLessThan(verify.run.indexOf('release-candidate.js identity'));
  expect(steps.at(-2).with.name).toBe('identity');
  expect(steps.at(-1).run).toContain('platform-candidate-transfer.js upload candidate.tar.gz');
  expect(steps.at(-1).run).toContain('platform-candidate-transfer.js upload context.json');
  expect(steps.slice(-2).every(step => !step.if)).toBe(true);
});

test('each shard retains full discovery and runs the completion verifier even after failure', () => {
  for (const job of graph.filter(job => job.shard)) {
    const steps = workflow.jobs[job.id].steps;
    const execution = steps.find(step => step.run?.includes('--outputFile='));
    expect(execution.run).toContain('--listTests --json --runInBand');
    expect(execution.run).toContain(`npm test -- --runInBand --shard=${job.shard} --json`);
    const verifier = steps.find(step => step.run?.includes('release-test-shard.js verify'));
    expect(verifier.if).toBe('always()');
    expect(verifier.run).toContain(`--shard ${job.shard}`);
    expect(steps.at(-1)).toMatchObject({ if: 'always()', with: { name: `diagnostics-${job.id}` } });
  }
});

test('outputs have private retention under the binding group mapping', () => {
  for (const id of ['build-macos', 'build-windows', 'build-linux-x64', 'build-linux-arm64', 'linux-update-signing', 'update-feed']) {
    const steps = workflow.jobs[id].steps;
    expect(steps.at(-1).run).toBe(`node ../trusted/scripts/platform-candidate-outputs.js retain ${id}`);
    expect(steps.at(-1).env.AWS_ACCESS_KEY_ID).toBe('${{ secrets.R2_CANDIDATES_ACCESS_KEY_ID }}');
  }
  const helper = fs.readFileSync(path.join(root, 'scripts/platform-candidate-outputs.js'), 'utf8');
  expect(helper).toContain("Bucket: 'hyperclay-candidates'");
  expect(helper).toContain('Metadata: { sha256: digest(body) }');
  expect(helper).toContain('`transfer/${name}`');
  expect(helper).toContain('`out/${file}`');
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      expect(step.uses || '').not.toMatch(/softprops\/action-gh-release/);
      expect(step.run || '').not.toMatch(/gh\s+release|post-build\.js|upload-to-r2|s3(?:api)?\s+(?:cp|sync|put-object)|git\s+push/);
    }
  }
  expect(workflow.permissions).toEqual({ contents: 'read' });
});

test('desktop checks consume their exact retained build without rebuilding', () => {
  for (const job of graph.filter(job => job.kind === 'desktop')) {
    const steps = workflow.jobs[job.id].steps;
    expect(steps.find(step => step.run?.includes('platform-candidate-transfer.js download')).run)
      .toBe(`node ../trusted/scripts/platform-candidate-transfer.js download build-${job.platform} ../incoming/build-${job.platform}/build-${job.platform}.tar.gz`);
    const command = steps.find(step => step.run?.includes('bash tests/linux/run-all.sh'));
    expect(command.env.CHECKS).toBe(job.id.replace(`${job.platform}-`, ''));
    expect(command.run).not.toMatch(/head|ls |build:run/);
    expect(steps.some(step => step.run?.includes('SHA256SUMS.json'))).toBe(true);
  }
});

testPosix('archive extraction preserves safe symlinks and executable bits and rejects escapes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-workflow-'));
  try {
    const helper = path.join(root, 'scripts/platform-candidate-archive.py');
    const fixture = spawnSync('python3', ['-c', `
import io,tarfile,pathlib
root=pathlib.Path(${JSON.stringify(temp)})
for name,member,kind in [('good','package.json','file'),('escape','../escape','file'),('link','link','link'),('safe-link','bin/link','safe-link'),('link-escape','bin/link','escape-link')]:
 with tarfile.open(root/(name+'.tar.gz'),'w:gz') as archive:
  info=tarfile.TarInfo(member)
  if kind in ('link','escape-link'): info.type=tarfile.SYMTYPE; info.linkname='/tmp/target' if kind=='link' else '../../outside'; archive.addfile(info)
  elif kind=='safe-link':
   target=tarfile.TarInfo('target'); target.size=2; target.mode=0o755; archive.addfile(target,io.BytesIO(b'{}'))
   info.type=tarfile.SYMTYPE; info.linkname='../target'; archive.addfile(info)
  else: info.size=2; archive.addfile(info,io.BytesIO(b'{}'))
`], { encoding: 'utf8' });
    expect(fixture.status).toBe(0);
    for (const name of ['good', 'escape', 'link', 'safe-link', 'link-escape']) {
      const result = spawnSync('python3', [helper, path.join(temp, `${name}.tar.gz`), path.join(temp, name)], { encoding: 'utf8' });
      expect(result.status).toBe(['good', 'safe-link'].includes(name) ? 0 : 1);
    }
    expect(fs.readFileSync(path.join(temp, 'good/package.json'), 'utf8')).toBe('{}');
    expect(fs.readlinkSync(path.join(temp, 'safe-link/bin/link'))).toBe('../target');
    expect(fs.readFileSync(path.join(temp, 'safe-link/bin/link'), 'utf8')).toBe('{}');
    expect(fs.statSync(path.join(temp, 'safe-link/target')).mode & 0o777).toBe(0o755);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('identity verification executes, accepts exact bytes and rejects archive or manifest mismatch', () => {
  const crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-identity-'));
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    fs.mkdirSync(path.join(temp, 'transfer'));
    fs.mkdirSync(path.join(temp, 'candidate'));
    fs.mkdirSync(path.join(temp, 'trusted/scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/release-candidate.js'), path.join(temp, 'trusted/scripts/release-candidate.js'));
    fs.writeFileSync(path.join(temp, 'transfer/candidate.tar.gz'), 'archive-fixture');
    const metadata = { Metadata: { sha256: hash('archive-fixture') }, ContentLength: Buffer.byteLength('archive-fixture'), LastModified: '2026-11-01T00:00:00Z' };
    fs.writeFileSync(path.join(temp, 'transfer/object.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(temp, 'candidate/candidate.json'), '{}');
    const pkg = { name: 'hyperclay-local-electron', version: '1.34.0' };
    fs.writeFileSync(path.join(temp, 'candidate/package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(temp, 'candidate/package-lock.json'), JSON.stringify({ packages: { '': pkg } }));
    const env = { ...process.env, APP: 'hyperclay-local', CANDIDATE_SHA256: hash('{}'),
      ATTEMPT: 'fixture-é', WORKFLOW_SHA: 'b'.repeat(40) };
    const record = { manifest: { app: env.APP, candidate_sha256: env.CANDIDATE_SHA256,
      prepared_tree_sha256: 'c'.repeat(64), version: pkg.version, workflow_sha: env.WORKFLOW_SHA,
      ...candidateContract(), attempt: env.ATTEMPT }, source_sha: 'd'.repeat(40), payload_date: '2026-10-30T12:34:56Z' };
    const saveRecord = () => {
      fs.writeFileSync(path.join(temp, 'candidate/platform-candidate.json'), JSON.stringify(record));
      const identity = spawnSync('python3', ['-c',
        'import hashlib,json,sys; print(hashlib.sha256(json.dumps(json.loads(sys.argv[1]),sort_keys=True,separators=(",",":")).encode()).hexdigest())',
        JSON.stringify(record.manifest)], { encoding: 'utf8' });
      expect(identity.status).toBe(0);
      env.MANIFEST_IDENTITY = identity.stdout.trim();
      metadata.Metadata['manifest-identity'] = env.MANIFEST_IDENTITY;
      fs.writeFileSync(path.join(temp, 'transfer/object.json'), JSON.stringify(metadata));
    };
    saveRecord();
    const command = workflow.jobs.verify.steps.find(step => step.run?.includes('head-object')).run;
    const blocks = [...command.matchAll(/node <<'NODE'\n([\s\S]*?)\nNODE/g)].map(match => match[1]);
    expect(blocks).toHaveLength(2);
    const execute = block => spawnSync(process.execPath, ['-e', block], { cwd: temp, env, encoding: 'utf8' });
    for (const block of blocks) {
      const result = execute(block);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
    expect(JSON.parse(fs.readFileSync(path.join(temp, 'transfer/context.json')))).toEqual({ payload_date: record.payload_date });
    const goodIdentity = env.MANIFEST_IDENTITY;
    env.MANIFEST_IDENTITY = 'a'.repeat(64);
    expect(execute(blocks[0]).stderr).toContain('R2 manifest identity mismatch');
    expect(execute(blocks[1]).stderr).toContain('Platform manifest identity mismatch');
    expect(execute(blocks[1]).status).toBe(1);
    env.MANIFEST_IDENTITY = goodIdentity;
    record.manifest.version = '9.9.9';
    saveRecord();
    expect(execute(blocks[1]).stderr).toContain('Platform manifest version mismatch');
    expect(execute(blocks[1]).status).toBe(1);
    record.manifest.version = pkg.version;
    record.manifest.checks.reverse();
    saveRecord();
    expect(execute(blocks[1]).stderr).toContain('checks do not match workflow graph');
    expect(execute(blocks[1]).status).toBe(1);
    record.manifest.checks.reverse();
    saveRecord();
    expect(execute(blocks[1]).status).toBe(0);
    const identity = spawnSync(process.execPath, [path.join(root, 'scripts/release-candidate.js'), 'identity', 'transfer/inputs.json', 'identity'], { cwd: temp, encoding: 'utf8' });
    expect(identity.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(temp, 'identity/identity.json'))).candidate_sha256).toBe(hash('{}'));
    metadata.ContentLength += 1;
    fs.writeFileSync(path.join(temp, 'transfer/object.json'), JSON.stringify(metadata));
    expect(execute(blocks[0]).stderr).toContain('ContentLength mismatch');
    metadata.ContentLength -= 1;
    fs.writeFileSync(path.join(temp, 'transfer/object.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(temp, 'transfer/candidate.tar.gz'), 'changed');
    expect(execute(blocks[0]).status).toBe(1);
    fs.writeFileSync(path.join(temp, 'candidate/candidate.json'), '{"changed":true}');
    expect(execute(blocks[1]).status).toBe(1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('feed bytes and retained archives execute against local storage fixtures', () => {
  const crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-outputs-'));
  const candidate = path.join(temp, 'candidate');
  try {
    for (const dir of ['executables', 'signatures', 'build-scripts', 'node_modules/@aws-sdk/client-s3']) {
      fs.mkdirSync(path.join(candidate, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(candidate, 'package.json'), '{"version":"1.34.0"}');
    fs.copyFileSync(path.join(root, 'build-scripts/update-feed.js'), path.join(candidate, 'build-scripts/update-feed.js'));
    fs.writeFileSync(path.join(candidate, 'node_modules/@aws-sdk/client-s3/index.js'), `
const fs = require('fs');
exports.PutObjectCommand = class { constructor(input) { this.input = input; } };
exports.S3Client = class { async send(command) {
  const { Body, ...input } = command.input;
  fs.appendFileSync('storage.jsonl', JSON.stringify({...input, body: Body.toString('base64')})+'\\n');
} };
`);
    for (const file of ['HyperclayLocal-1.34.0-x64-mac.zip', 'HyperclayLocal-1.34.0-arm64-mac.zip',
      'HyperclayLocal-Setup-1.34.0.exe', 'HyperclayLocal-1.34.0.AppImage', 'HyperclayLocal-1.34.0-arm64.AppImage']) {
      fs.writeFileSync(path.join(candidate, 'executables', file), `signed-fixture-${file}`);
    }
    fs.writeFileSync(path.join(candidate, '.platform-context.json'), '{"payload_date":"2026-10-30T12:34:56Z"}');
    fs.writeFileSync(path.join(candidate, 'signatures/policy.json'), '{"linuxUpdates":false}');
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/platform-candidate-outputs.js'), ...args], {
      cwd: candidate, encoding: 'utf8', env: { ...process.env, APP: 'hyperclay-local', CANDIDATE_SHA256: 'a'.repeat(64), ATTEMPT: 'fixture' }
    });
    expect(run('feeds').status).toBe(0);
    expect(fs.readdirSync(path.join(candidate, 'feeds')).sort()).toEqual(['latest-mac.yml', 'latest.yml']);
    const mac = fs.readFileSync(path.join(candidate, 'feeds/latest-mac.yml'), 'utf8');
    expect(mac).toContain("releaseDate: '2026-10-30T12:34:56.000Z'");
    expect(mac).toContain('https://local.hyperclay.com/releases/1.34.0/');
    expect(run('retain', 'update-feed').status).toBe(0);
    const writes = fs.readFileSync(path.join(candidate, 'storage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(writes).toHaveLength(3);
    expect(writes.map(write => write.Key).sort()).toEqual([
      `candidates/hyperclay-local/${'a'.repeat(64)}/fixture/out/latest-mac.yml`,
      `candidates/hyperclay-local/${'a'.repeat(64)}/fixture/out/latest.yml`,
      `candidates/hyperclay-local/${'a'.repeat(64)}/fixture/transfer/update-feed`
    ]);
    for (const write of writes) {
      expect(write.Bucket).toBe('hyperclay-candidates');
      expect(write.Metadata.sha256).toBe(crypto.createHash('sha256').update(Buffer.from(write.body, 'base64')).digest('hex'));
    }
    const extract = spawnSync('python3', [path.join(root, 'scripts/platform-candidate-archive.py'),
      path.join(temp, 'retained/update-feed.tar.gz'), path.join(temp, 'unpacked')], { encoding: 'utf8' });
    expect(extract.status).toBe(0);
    expect(fs.readFileSync(path.join(temp, 'unpacked/latest-mac.yml'), 'utf8')).toBe(mac);
    fs.writeFileSync(path.join(candidate, 'signatures/policy.json'), '{"linuxUpdates":true}');
    expect(run('feeds').status).toBe(0);
    expect(fs.readdirSync(path.join(candidate, 'feeds'))).toEqual(expect.arrayContaining(['latest-linux.yml', 'latest-linux-arm64.yml']));
    fs.writeFileSync(path.join(candidate, 'executables/latest-linux.yml'), 'electron-builder feed');
    expect(run('retain', 'build-linux-x64').status).toBe(0);
    const listed = spawnSync('tar', ['-tzf', path.join(temp, 'retained/build-linux-x64.tar.gz')], { encoding: 'utf8' });
    expect(listed.stdout).toContain('HyperclayLocal-1.34.0.AppImage');
    expect(listed.stdout).toContain('SHA256SUMS.json');
    expect(listed.stdout).not.toContain('latest-linux.yml');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('contract CLI prints exactly the graph ids and retained artifact names', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/release-candidate.js'), 'contract'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  const artifacts = ['identity', 'build-macos', 'build-windows', 'build-linux-x64',
    'build-linux-arm64', 'linux-update-signing', 'update-feed'];
  expect(JSON.parse(result.stdout)).toEqual({ checks: graph.map(job => job.id), artifacts });
  expect(graph.flatMap(job => job.artifacts || [])).toEqual(artifacts);
  for (const name of artifacts) {
    expect(Object.values(workflow.jobs).some(job => job.steps.some(step =>
      name === 'identity' ? step.uses === 'actions/upload-artifact@v4' && step.with.name === name
        : step.run === `node ../trusted/scripts/platform-candidate-outputs.js retain ${name}`))).toBe(true);
  }
});


test('GitHub artifact inventory allows only identity and check evidence, with contract job names', () => {
  const steps = [...Object.values(workflow.jobs).flatMap(job => job.steps), ...action.runs.steps];
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  expect(uploads.length).toBeGreaterThan(0);
  for (const step of uploads) {
    expect(step.with.name).toMatch(/^(identity|diagnostics-.+|suite-coverage|notarization-receipt)$/);
    const paths = step.with.path.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    for (const file of paths) {
      expect(file).not.toMatch(/(?:candidate\.tar|\.(?:tar|gz|zip|dmg|exe|AppImage|sig|blockmap)(?:$|[/*])|(?:^|\/)(?:dist|executables|retained|transfer|feeds|signatures|build[^/]*)(?:\/|$)|latest[^/]*\.ya?ml)/i);
      expect(file).toMatch(/^(identity\/identity\.json|candidate\/(?:diagnostics|linux-check-artifacts)\/[^*]*)$/);
    }
  }
  expect(steps.filter(step => step.uses?.startsWith('actions/download-artifact@'))).toEqual([]);
  expect(Object.values(workflow.jobs).map(job => job.name)).toEqual(candidateContract().checks);
});

test('private transfer uploads metadata and rejects corrupt or truncated downloads before use', () => {
  const crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-transfer-'));
  const originalEnv = { ...process.env };
  const bytes = Buffer.from('private installer fixture');
  let metadata;
  let stored;
  const calls = [];
  const aws = (program, args) => {
    expect(program).toBe('aws');
    calls.push(args);
    expect(args.slice(0, 5)).toEqual(['--endpoint-url', 'https://fixture.r2.cloudflarestorage.com', '--region', 'auto', 's3api']);
    expect(args[args.indexOf('--bucket') + 1]).toBe('hyperclay-candidates');
    expect(args[args.indexOf('--key') + 1]).toBe(`candidates/hyperclay-local/${'a'.repeat(64)}/fixture/transfer/build-windows`);
    if (args[5] === 'put-object') {
      stored = fs.readFileSync(args[args.indexOf('--body') + 1]);
      metadata = { Metadata: JSON.parse(args[args.indexOf('--metadata') + 1]), ContentLength: stored.length };
      return '{}';
    }
    if (args[5] === 'head-object') return JSON.stringify(metadata);
    if (args[5] === 'get-object') { fs.writeFileSync(args[6], stored); return '{}'; }
    throw Error('Unexpected AWS command');
  };
  try {
    Object.assign(process.env, { APP: 'hyperclay-local', CANDIDATE_SHA256: 'a'.repeat(64), ATTEMPT: 'fixture', R2_ACCOUNT_ID: 'fixture' });
    jest.doMock('node:child_process', () => ({ execFileSync: aws }));
    let transfer;
    jest.isolateModules(() => { ({ transfer } = require('../../scripts/platform-candidate-transfer')); });
    const input = path.join(temp, 'installer.exe');
    const output = path.join(temp, 'incoming/installer.exe');
    fs.writeFileSync(input, bytes);
    transfer('upload', 'build-windows', input);
    expect(metadata.Metadata.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    transfer('download', 'build-windows', output);
    expect(fs.readFileSync(output)).toEqual(bytes);
    metadata.ContentLength += 1;
    expect(() => transfer('download', 'build-windows', output)).toThrow('ContentLength mismatch');
    metadata.ContentLength -= 1;
    stored = Buffer.alloc(bytes.length, 'x');
    expect(() => transfer('download', 'build-windows', output)).toThrow('sha256');
    metadata.Metadata = {};
    expect(() => transfer('download', 'build-windows', output)).toThrow('sha256');
    expect(calls.filter(args => args[5] === 'put-object')).toHaveLength(1);
    process.env.ATTEMPT = '../escape';
    expect(() => transfer('download', 'build-windows', output)).toThrow('identity');
  } finally {
    process.env = originalEnv;
    jest.dontMock('node:child_process');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
