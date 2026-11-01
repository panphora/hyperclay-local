'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { candidateJobGraph } = require('../../scripts/release-candidate');
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
  expect(action.runs.steps[0]).toMatchObject({ uses: 'actions/download-artifact@v4', with: { name: 'candidate' } });
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
  expect(steps.slice(-2).map(step => step.with.name)).toEqual(['identity', 'candidate']);
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

test('outputs have private retention and single-file GitHub archives', () => {
  for (const id of ['build-macos', 'build-windows', 'build-linux-x64', 'build-linux-arm64', 'linux-update-signing', 'update-feed']) {
    const steps = workflow.jobs[id].steps;
    expect(steps.at(-2).run).toBe(`node ../trusted/scripts/platform-candidate-outputs.js retain ${id}`);
    expect(steps.at(-2).env.AWS_ACCESS_KEY_ID).toBe('${{ secrets.R2_CANDIDATES_ACCESS_KEY_ID }}');
    expect(steps.at(-1)).toMatchObject({ with: { name: id, path: `retained/${id}.tar.gz` } });
  }
  const helper = fs.readFileSync(path.join(root, 'scripts/platform-candidate-outputs.js'), 'utf8');
  expect(helper).toContain("Bucket: 'hyperclay-candidates'");
  expect(helper).toContain('Metadata: { sha256: digest(body) }');
  expect(helper).toContain('/out`');
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
    expect(steps.find(step => step.uses === 'actions/download-artifact@v4').with.name).toBe(`build-${job.platform}`);
    const command = steps.find(step => step.run?.includes('bash tests/linux/run-all.sh'));
    expect(command.env.CHECKS).toBe(job.id.replace(`${job.platform}-`, ''));
    expect(command.run).not.toMatch(/head|ls |build:run/);
    expect(steps.some(step => step.run?.includes('SHA256SUMS.json'))).toBe(true);
  }
});

test('archive extraction executes and rejects traversal and links', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-workflow-'));
  try {
    const helper = path.join(root, 'scripts/platform-candidate-archive.py');
    const fixture = spawnSync('python3', ['-c', `
import io,tarfile,pathlib
root=pathlib.Path(${JSON.stringify(temp)})
for name,member,kind in [('good','package.json','file'),('escape','../escape','file'),('link','link','link')]:
 with tarfile.open(root/(name+'.tar.gz'),'w:gz') as archive:
  info=tarfile.TarInfo(member)
  if kind=='link': info.type=tarfile.SYMTYPE; info.linkname='/tmp/target'; archive.addfile(info)
  else: info.size=2; archive.addfile(info,io.BytesIO(b'{}'))
`], { encoding: 'utf8' });
    expect(fixture.status).toBe(0);
    for (const name of ['good', 'escape', 'link']) {
      const result = spawnSync('python3', [helper, path.join(temp, `${name}.tar.gz`), path.join(temp, name)], { encoding: 'utf8' });
      expect(result.status).toBe(name === 'good' ? 0 : 1);
    }
    expect(fs.readFileSync(path.join(temp, 'good/package.json'), 'utf8')).toBe('{}');
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
    fs.writeFileSync(path.join(temp, 'transfer/candidate.tar.gz'), 'archive-fixture');
    const metadata = { Metadata: { sha256: hash('archive-fixture') }, LastModified: '2026-11-01T00:00:00Z' };
    fs.writeFileSync(path.join(temp, 'transfer/object.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(temp, 'candidate/candidate.json'), '{}');
    const pkg = { name: 'hyperclay-local-electron', version: '1.34.0' };
    fs.writeFileSync(path.join(temp, 'candidate/package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(temp, 'candidate/package-lock.json'), JSON.stringify({ packages: { '': pkg } }));
    const env = { ...process.env, APP: 'hyperclay-local', CANDIDATE_SHA256: hash('{}'),
      ATTEMPT: 'fixture', MANIFEST_IDENTITY: 'a'.repeat(64), WORKFLOW_SHA: 'b'.repeat(40) };
    const command = workflow.jobs.verify.steps.find(step => step.run?.includes('head-object')).run;
    const blocks = [...command.matchAll(/node <<'NODE'\n([\s\S]*?)\nNODE/g)].map(match => match[1]);
    expect(blocks).toHaveLength(2);
    const execute = block => spawnSync(process.execPath, ['-e', block], { cwd: temp, env, encoding: 'utf8' });
    for (const block of blocks) expect(execute(block).status).toBe(0);
    const identity = spawnSync(process.execPath, [path.join(root, 'scripts/release-candidate.js'), 'identity', 'transfer/inputs.json', 'identity'], { cwd: temp, encoding: 'utf8' });
    expect(identity.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(temp, 'identity/identity.json'))).candidate_sha256).toBe(hash('{}'));
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
    fs.writeFileSync(path.join(candidate, '.platform-context.json'), '{"releaseDate":"2026-11-01T00:00:00.000Z"}');
    fs.writeFileSync(path.join(candidate, 'signatures/policy.json'), '{"linuxUpdates":false}');
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/platform-candidate-outputs.js'), ...args], {
      cwd: candidate, encoding: 'utf8', env: { ...process.env, CANDIDATE_KEY: 'attempts/fixture/candidate.tar.gz' }
    });
    expect(run('feeds').status).toBe(0);
    expect(fs.readdirSync(path.join(candidate, 'feeds')).sort()).toEqual(['latest-mac.yml', 'latest.yml']);
    const mac = fs.readFileSync(path.join(candidate, 'feeds/latest-mac.yml'), 'utf8');
    expect(mac).toContain("releaseDate: '2026-11-01T00:00:00.000Z'");
    expect(mac).toContain('https://local.hyperclay.com/releases/1.34.0/');
    expect(run('retain', 'update-feed').status).toBe(0);
    const writes = fs.readFileSync(path.join(candidate, 'storage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(writes).toHaveLength(3);
    expect(writes.map(write => write.Key).sort()).toEqual([
      'attempts/fixture/out/latest-mac.yml', 'attempts/fixture/out/latest.yml', 'attempts/fixture/out/update-feed.tar.gz'
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
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
