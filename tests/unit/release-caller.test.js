'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');

const { createBundle, completeBundle } = require('../helpers/release-status-fixture');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(900000);

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_SCRIPTS = path.join(ROOT, 'scripts');
const WORKFLOW_FILE = path.join(ROOT, '.github', 'workflows', 'release.yml');
const STATUS_GUARD = path.join(ROOT, 'tests', 'fixtures', 'release-status-cli-guard.js');
const FROZEN_COORDINATOR_SHA256 = '016845f208e832c3aa5f0574403acd60db38a84c60010448fc36efa34f9fa578';
const VERSION = '1.2.3';
const ATTEMPT_ID = '12345678-1234-4123-8123-123456789abc';
const RUN_DIR = typeof process.env.FLASHIMP_RUN_DIR === 'string' && process.env.FLASHIMP_RUN_DIR !== ''
  ? process.env.FLASHIMP_RUN_DIR
  : null;

const CALLER_GUARD = `
'use strict';
const Module = require('module');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const nativeLoad = Module._load;
const nativeSpawnSync = childProcess.spawnSync;
const nativeWriteSync = fs.writeSync;
const mode = process.env.RELEASE_CALLER_GUARD_MODE;
const failures = [];
let coordinatorLoads = 0;
let gitReads = 0;
function fail(message) {
  failures.push(message);
  throw new Error('release caller guard violation');
}
function base(request, parent, isMain) {
  try {
    const file = Module._resolveFilename(request, parent, isMain);
    return path.basename(file, path.extname(file));
  } catch {
    return null;
  }
}
Module._load = function (request, parent, isMain) {
  const name = request === 'dotenv' ? 'dotenv' : base(request, parent, isMain);
  if (name === 'release-coordinator') {
    coordinatorLoads += 1;
    if (mode !== 'acting') fail('loaded release-coordinator outside acting mode');
  }
  if (['dotenv', 'ui-pass-gate', 'release-status'].includes(name)) fail('loaded forbidden ' + name);
  return nativeLoad.apply(this, arguments);
};
childProcess.spawnSync = function (command, args, options) {
  if (mode !== 'acting' || command !== 'git' || !Array.isArray(args)) {
    return fail('unexpected spawnSync ' + String(command));
  }
  const prefix = ['-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
  if (args.length <= prefix.length || prefix.some((value, index) => args[index] !== value)) {
    return fail('git read prefix changed');
  }
  const allowed = ['rev-parse', 'symbolic-ref', 'remote', 'rev-list', 'ls-tree', 'cat-file',
    'ls-files', 'merge-base', 'diff', 'for-each-ref'];
  if (!allowed.includes(args[prefix.length]) || !options || options.shell !== false) {
    return fail('unexpected git operation');
  }
  gitReads += 1;
  return nativeSpawnSync.apply(this, arguments);
};
for (const name of ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork']) {
  childProcess[name] = function () { return fail('called child_process.' + name); };
}
process.exit = function () { return fail('called process.exit'); };
process.on('exit', () => {
  if (mode === 'acting' && coordinatorLoads !== 1) failures.push('acting mode did not load one coordinator');
  if (mode === 'acting' && gitReads === 0) failures.push('acting mode performed no native git reads');
  if (mode === 'early' && coordinatorLoads !== 0) failures.push('early mode loaded coordinator');
  if (failures.length === 0) return;
  nativeWriteSync(2, 'release caller guard violation\\n  ' + failures.join('\\n  ') + '\\n');
  process.exitCode = 97;
});
`;

const WORKFLOW_GUARD = `
'use strict';
const childProcess = require('child_process');
const nativeExecFileSync = childProcess.execFileSync;
const fs = require('fs');
const nativeWriteSync = fs.writeSync;
const failures = [];
let calls = 0;
function fail(message) {
  failures.push(message);
  throw new Error('workflow identity guard violation');
}
childProcess.execFileSync = function (command, args, options) {
  if (command !== 'git' || !Array.isArray(args) || args.length !== 2 ||
      args[0] !== 'rev-parse' || args[1] !== 'HEAD' ||
      !options || options.encoding !== 'utf8' || options.shell === true) {
    return fail('unexpected execFileSync');
  }
  calls += 1;
  return nativeExecFileSync.apply(this, arguments);
};
for (const name of ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'fork']) {
  childProcess[name] = function () { return fail('called child_process.' + name); };
}
process.on('exit', () => {
  if (calls !== 1) failures.push('expected exactly one git HEAD read, got ' + calls);
  if (failures.length === 0) return;
  nativeWriteSync(2, 'workflow identity guard violation\\n  ' + failures.join('\\n  ') + '\\n');
  process.exitCode = 97;
});
`;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function cleanEnv(home, extra = {}) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    ...extra
  };
  if (typeof process.env.LANG === 'string') env.LANG = process.env.LANG;
  return env;
}

function runNode({ script, args = [], cwd, env, guard }) {
  const argv = guard === undefined ? [script, ...args] : ['--require', guard, script, ...args];
  const result = childProcess.spawnSync(process.execPath, argv, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return {
    argv: [process.execPath, ...argv],
    cwd,
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function record(file, value) {
  if (RUN_DIR === null) return;
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.appendFileSync(path.join(RUN_DIR, file), `${JSON.stringify(value)}\n`);
}

function parseStatus(result) {
  expect(result.stdout.endsWith('\n')).toBe(true);
  expect(result.stdout.slice(0, -1).includes('\n')).toBe(false);
  const value = JSON.parse(result.stdout);
  expect(`${JSON.stringify(value)}\n`).toBe(result.stdout);
  return value;
}

function replaceHumanAdapters(source) {
  const begin = source.indexOf('async function chooseBump() {');
  const end = source.indexOf('async function main() {');
  if (begin < 0 || end <= begin) throw new Error('caller human adapters were not found');
  return source.slice(0, begin) + [
    'async function chooseBump() {',
    "  return 'patch';",
    '}',
    '',
    'async function newBuildGates({ kind }) {',
    "  throw Object.assign(new Error(\`fixture gate \${kind}\`), { code: 'FIXTURE_GATE' });",
    '}',
    '',
  ].join('\n') + source.slice(end);
}

testPosix('caller fresh worktree gate preserves porcelain columns', async () => {
  const source = fs.readFileSync(path.join(SOURCE_SCRIPTS, 'release.js'), 'utf8');
  const begin = source.indexOf('async function newBuildGates({ kind }) {');
  const end = source.indexOf('async function main() {', begin);
  if (begin < 0 || end <= begin) throw new Error('caller fresh worktree gate was not found');
  const gateSource = source.slice(begin, end);
  const owner = fs.mkdtempSync(path.join(os.tmpdir(), 'release-caller-worktree-'));
  const repo = path.join(owner, 'repo');
  const allowedPaths = ['package.json', 'README.md', 'website/index.html'];
  const fixtureBytes = new Map([
    ['package.json', Buffer.from('{"version":"1.2.3"}\n')],
    ['README.md', Buffer.from('# Fixture\n')],
    ['website/index.html', Buffer.from('<h1>Fixture</h1>\n')],
    ['notes.txt', Buffer.from('notes\n')],
    ['README.md ', Buffer.from('trailing space\n')]
  ]);

  function writeFixtureFile(relative, bytes) {
    const file = path.join(repo, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }

  async function runGate() {
    const calls = {
      dotenv: [], status: 0, statusOutput: '', auth: 0, license: 0, ui: 0, logs: []
    };
    const context = vm.createContext({
      path,
      ROOT_DIR: repo,
      FILES_TO_UPDATE: allowedPaths,
      require(request) {
        if (request !== 'dotenv') throw new Error(`unexpected require ${request}`);
        return {
          config(options) {
            calls.dotenv.push(options);
          }
        };
      },
      execSafe(command, options) {
        if (command === 'git status --porcelain') {
          if (options !== undefined) throw new Error('unexpected git status options');
          calls.status += 1;
          calls.statusOutput = childProcess.execFileSync('git', ['status', '--porcelain'], {
            cwd: repo,
            encoding: 'utf8'
          });
          return calls.statusOutput;
        }
        if (command === 'gh auth status') {
          if (!options || options.stdio !== 'pipe' || Object.keys(options).length !== 1) {
            throw new Error('unexpected gh auth status options');
          }
          calls.auth += 1;
          return '';
        }
        throw new Error(`unexpected command ${command}`);
      },
      logSection(message) {
        calls.logs.push(['section', message]);
      },
      log(message) {
        calls.logs.push(['log', message]);
      },
      logSuccess(message) {
        calls.logs.push(['success', message]);
      },
      logWarn(message) {
        calls.logs.push(['warn', message]);
      },
      verifyLicenseAblation() {
        calls.license += 1;
      },
      verifyUiPass() {
        calls.ui += 1;
      }
    });
    vm.runInContext(`${gateSource}\nthis.newBuildGates = newBuildGates;`, context, {
      filename: 'release.js:newBuildGates'
    });
    try {
      await context.newBuildGates({ kind: 'fresh' });
      return { calls, error: undefined };
    } catch (error) {
      return { calls, error };
    }
  }

  try {
    fs.mkdirSync(repo);
    for (const [relative, bytes] of fixtureBytes) writeFixtureFile(relative, bytes);
    childProcess.execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    childProcess.execFileSync('git', ['add', '--all'], { cwd: repo });
    childProcess.execFileSync('git', [
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'
    ], { cwd: repo });

    const positiveResults = [];
    for (const relative of allowedPaths) {
      const original = fixtureBytes.get(relative);
      const changed = Buffer.concat([original, Buffer.from('changed\n')]);
      writeFixtureFile(relative, changed);
      let result;
      try {
        result = await runGate();
        positiveResults.push({ relative, changed, ...result });
      } finally {
        writeFixtureFile(relative, original);
      }
    }

    const refusalResults = [];
    for (const relative of ['notes.txt', 'README.md ']) {
      const original = fixtureBytes.get(relative);
      const changed = Buffer.concat([original, Buffer.from('changed\n')]);
      writeFixtureFile(relative, changed);
      let result;
      try {
        result = await runGate();
        refusalResults.push({
          relative,
          bytesPreserved: fs.readFileSync(path.join(repo, relative)).equals(changed),
          ...result
        });
      } finally {
        writeFixtureFile(relative, original);
      }
    }

    const positiveCount = positiveResults.filter(result => result.error === undefined).length;
    const refusalCount = refusalResults.filter(result =>
      result.error && result.error.code === 'RELEASE_WORKTREE_DIRTY'
    ).length;
    console.log(`caller fresh worktree gate native counts: positive=${positiveCount} refusal=${refusalCount}`);

    expect(positiveCount).toBe(3);
    expect(refusalCount).toBe(2);
    for (const result of positiveResults) {
      expect(result.error).toBeUndefined();
      expect(result.calls.dotenv).toEqual([{ path: path.join(repo, '.env') }]);
      expect(result.calls.status).toBe(1);
      expect(result.calls.statusOutput).toBe(` M ${result.relative}\n`);
      expect(result.calls.auth).toBe(1);
      expect(result.calls.license).toBe(1);
      expect(result.calls.ui).toBe(1);
      expect(fs.readFileSync(path.join(repo, result.relative))).toEqual(fixtureBytes.get(result.relative));
    }
    for (const result of refusalResults) {
      expect(result.error).toMatchObject({ code: 'RELEASE_WORKTREE_DIRTY' });
      expect(result.calls.dotenv).toEqual([{ path: path.join(repo, '.env') }]);
      expect(result.calls.status).toBe(1);
      expect(result.calls.statusOutput.startsWith(' M ')).toBe(true);
      expect(result.calls.statusOutput.endsWith('\n')).toBe(true);
      expect(result.calls.auth).toBe(0);
      expect(result.calls.license).toBe(0);
      expect(result.calls.ui).toBe(0);
      expect(result.bytesPreserved).toBe(true);
      expect(fs.readFileSync(path.join(repo, result.relative))).toEqual(fixtureBytes.get(result.relative));
    }
    expect(childProcess.execFileSync('git', ['status', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8'
    })).toBe('');
  } finally {
    fs.rmSync(owner, { recursive: true, force: true });
  }
});

describePosix('caller CLI boundary', () => {
  let bundle;
  let scriptsDir;
  let releaseScript;
  let statusGuard;
  let callerGuard;
  let home;
  let transcript;

  beforeAll(async () => {
    bundle = createBundle();
    await completeBundle(bundle);
    scriptsDir = path.join(bundle.desktopRoot, 'scripts');
    fs.cpSync(SOURCE_SCRIPTS, scriptsDir, { recursive: true });
    releaseScript = path.join(scriptsDir, 'release.js');
    statusGuard = path.join(bundle.owner, 'status-guard.js');
    callerGuard = path.join(bundle.owner, 'caller-guard.js');
    fs.copyFileSync(STATUS_GUARD, statusGuard);
    fs.writeFileSync(callerGuard, CALLER_GUARD);
    home = path.join(bundle.owner, 'home');
    fs.mkdirSync(path.join(home, '.cache', 'hyperclay-local'), { recursive: true });
    fs.symlinkSync(bundle.cacheRoot, path.join(home, '.cache', 'hyperclay-local', 'releases'));
    transcript = path.join(bundle.owner, 'external-release.log');
  });

  afterAll(() => {
    if (bundle) fs.rmSync(bundle.owner, { recursive: true, force: true });
  });

  testPosix('caller CLI boundary keeps status JSON-only with unchanged zero and two exits', () => {
    const positive = runNode({
      script: releaseScript,
      args: ['--status-json'],
      cwd: scriptsDir,
      guard: statusGuard,
      env: cleanEnv(home, { HYPERCLAY_STATUS_CLI_GUARD_MODE: 'positive-read' })
    });
    record('release-caller-cli-cases.log', { case: 'status-positive', ...positive });
    expect(positive.exit).toBe(0);
    expect(positive.stderr).toBe('');
    const status = parseStatus(positive);
    expect(status.readError).toBeNull();
    expect(status.publish).toMatchObject({ phase: 'complete', pending: false });

    const packageFile = path.join(bundle.desktopRoot, 'package.json');
    const packageBytes = fs.readFileSync(packageFile);
    let invalid;
    try {
      fs.writeFileSync(packageFile, '{invalid-json');
      invalid = runNode({
        script: releaseScript,
        args: ['--status-json'],
        cwd: scriptsDir,
        guard: statusGuard,
        env: cleanEnv(home, { HYPERCLAY_STATUS_CLI_GUARD_MODE: 'positive-read' })
      });
    } finally {
      fs.writeFileSync(packageFile, packageBytes);
    }
    record('release-caller-cli-cases.log', { case: 'status-invalid-package', ...invalid });
    expect(invalid.exit).toBe(2);
    expect(invalid.stderr).toBe('');
    expect(parseStatus(invalid).readError).toEqual({
      code: 'STATUS_PACKAGE_INVALID',
      message: 'Desktop package.json has no usable release version'
    });

    const mixed = runNode({
      script: releaseScript,
      args: ['--status-json', '--resume'],
      cwd: scriptsDir,
      guard: statusGuard,
      env: cleanEnv(home, {
        HYPERCLAY_STATUS_CLI_GUARD_MODE: 'no-work',
        HYPERCLAY_STATUS_CLI_GUARD_FORBID_STATUS: '1'
      })
    });
    record('release-caller-cli-cases.log', { case: 'status-mixed-flags', ...mixed });
    expect(mixed.exit).toBe(2);
    expect(mixed.stdout).toBe('');
    expect(mixed.stderr).toBe('--status-json must be used alone\n');
    expect(fs.existsSync(transcript)).toBe(false);
  });

  testPosix('caller CLI boundary handles help and invalid flags before acting imports', () => {
    const env = cleanEnv(home, {
      HYPERSAVE_RELEASE_CAPTURE: '1',
      HYPERSAVE_RELEASE_LOG: transcript,
      RELEASE_CALLER_GUARD_MODE: 'early'
    });
    const help = runNode({
      script: releaseScript,
      args: ['--help'],
      cwd: scriptsDir,
      guard: callerGuard,
      env
    });
    record('release-caller-cli-cases.log', { case: 'help', ...help });
    expect(help.exit).toBe(0);
    expect(help.stderr).toBe('');
    expect(help.stdout).toContain('Finish the recorded release before starting another version.');
    expect(help.stdout).toContain('--reconcile-only');
    expect(help.stdout).toContain('--resume-source=SHA');

    const invalid = runNode({
      script: releaseScript,
      args: ['--not-a-release-flag'],
      cwd: scriptsDir,
      guard: callerGuard,
      env
    });
    record('release-caller-cli-cases.log', { case: 'invalid-flag', ...invalid });
    expect(invalid.exit).toBe(1);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain('Unknown or incomplete argument: --not-a-release-flag');
    expect(invalid.stderr).toContain('Use --help for usage information');
    expect(fs.existsSync(transcript)).toBe(false);
  });

  testPosix('caller CLI boundary enters the frozen real coordinator through human adapters', () => {
    const coordinatorFile = path.join(scriptsDir, 'release-coordinator.js');
    expect(sha256(fs.readFileSync(coordinatorFile))).toBe(FROZEN_COORDINATOR_SHA256);
    const original = fs.readFileSync(releaseScript, 'utf8');
    const stateFile = path.join(bundle.repoDir, 'state.json');
    const stateBytes = fs.readFileSync(stateFile);
    let result;
    try {
      fs.writeFileSync(releaseScript, replaceHumanAdapters(original));
      result = runNode({
        script: releaseScript,
        cwd: scriptsDir,
        guard: callerGuard,
        env: cleanEnv(home, {
          HYPERSAVE_RELEASE_CAPTURE: '1',
          HYPERSAVE_RELEASE_LOG: transcript,
          RELEASE_CALLER_GUARD_MODE: 'acting'
        })
      });
    } finally {
      fs.writeFileSync(releaseScript, original);
    }
    record('release-caller-cli-cases.log', { case: 'acting-real-coordinator', ...result });
    expect(result.exit).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('fixture gate fresh');
    expect(result.stdout).not.toContain('Release complete');
    expect(fs.readFileSync(stateFile)).toEqual(stateBytes);
    expect(fs.existsSync(transcript)).toBe(false);

    expect((original.match(/main\(\)\.catch/g) || [])).toHaveLength(1);
    expect(original).not.toMatch(/function (dispatchRelease|awaitRunVerdict|verifyPublishWindow|getCurrentVersion|deployWebsite|updateExternalDocs)\b/);
    expect(original).not.toContain('process.exit(');
  });
});

describe('caller workflow identity', () => {
  let owner;
  let repo;
  let guard;
  let body;
  let sourceSha;
  const cases = [];

  beforeAll(() => {
    owner = fs.mkdtempSync(path.join(os.tmpdir(), 'release-caller-workflow-'));
    repo = path.join(owner, 'repo');
    guard = path.join(owner, 'workflow-guard.js');
    fs.mkdirSync(repo);
    fs.writeFileSync(guard, WORKFLOW_GUARD);
    fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ version: VERSION })}\n`);
    childProcess.execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    childProcess.execFileSync('git', ['add', 'package.json'], { cwd: repo });
    childProcess.execFileSync('git', [
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'
    ], { cwd: repo });
    sourceSha = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    const workflow = yaml.load(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
    expect(workflow['run-name']).toBe(
      "release v${{ inputs.version }} ${{ inputs.dry_run && 'dry-run' || 'publish' }} sha=${{ inputs.source_sha }} attempt=${{ inputs.attempt_id }}"
    );
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.source_sha).toEqual({
      description: 'Exact recorded release source commit',
      required: true,
      type: 'string'
    });
    expect(inputs.attempt_id).toEqual({
      description: 'Recorded durable dispatch attempt UUID',
      required: true,
      type: 'string'
    });

    const jobs = workflow.jobs;
    const expectedJobs = [
      'verify', 'test-macos', 'test-windows', 'test-linux', 'license',
      'build-macos', 'build-linux', 'build-windows', 'upload'
    ];
    const checkoutRows = [];
    for (const [job, value] of Object.entries(jobs)) {
      for (const step of value.steps || []) {
        if (step.uses === 'actions/checkout@v4') checkoutRows.push({ job, ref: step.with && step.with.ref });
      }
    }
    expect(checkoutRows).toHaveLength(9);
    expect(checkoutRows.map(row => row.job).sort()).toEqual(expectedJobs.slice().sort());
    expect(checkoutRows.every(row => row.ref === '${{ inputs.source_sha }}')).toBe(true);
    expect(jobs.upload.if).toBe('${{ !inputs.dry_run }}');

    const identitySteps = jobs.verify.steps.filter(
      step => step.name === 'Recorded source and version match the workflow identity'
    );
    expect(identitySteps).toHaveLength(1);
    expect(identitySteps[0].env).toEqual({
      RELEASE_VERSION: '${{ inputs.version }}',
      RELEASE_SOURCE_SHA: '${{ inputs.source_sha }}',
      RELEASE_ATTEMPT_ID: '${{ inputs.attempt_id }}'
    });
    const match = /^node <<'NODE'\n([\s\S]+)\nNODE\n?$/.exec(identitySteps[0].run);
    expect(match).not.toBeNull();
    body = match[1];
    expect(body.trim()).not.toBe('');
    record('release-caller-workflow-cases.log', {
      case: 'yaml-structure',
      exit: 0,
      parser: require.resolve('js-yaml'),
      checkoutCount: checkoutRows.length,
      identityBodies: identitySteps.length,
      identityBytes: Buffer.byteLength(body)
    });
  });

  afterAll(() => {
    if (owner) fs.rmSync(owner, { recursive: true, force: true });
  });

  function runIdentity(name, changes = {}) {
    const env = cleanEnv(owner, {
      RELEASE_VERSION: changes.version || VERSION,
      RELEASE_SOURCE_SHA: changes.source || sourceSha,
      RELEASE_ATTEMPT_ID: changes.attempt || ATTEMPT_ID,
      GITHUB_SHA: changes.githubSha || sourceSha,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null'
    });
    const cwd = changes.cwd || repo;
    const result = childProcess.spawnSync(process.execPath, ['--require', guard, '-e', body], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    const row = { case: name, exit: result.status, stdout: result.stdout, stderr: result.stderr };
    cases.push(row);
    record('release-caller-workflow-cases.log', row);
    return row;
  }

  test('caller workflow identity accepts only the exact source version and attempt', () => {
    const positive = runIdentity('positive');
    expect(positive.exit).toBe(0);
    expect(positive.stderr).toBe('');
    expect(positive.stdout).toBe(`Releasing ${VERSION} from ${sourceSha}, attempt ${ATTEMPT_ID}\n`);

    const githubDrift = runIdentity('github-sha-drift', { githubSha: '0'.repeat(40) });
    expect(githubDrift.exit).not.toBe(0);
    expect(githubDrift.stderr).toContain('Workflow ref, checkout, source, version and durable attempt must agree');

    const otherSource = '1'.repeat(40);
    const checkoutDrift = runIdentity('checkout-drift', {
      source: otherSource,
      githubSha: otherSource
    });
    expect(checkoutDrift.exit).not.toBe(0);
    expect(checkoutDrift.stderr).toContain('Workflow ref, checkout, source, version and durable attempt must agree');

    const versionDrift = runIdentity('version-drift', { version: '1.2.4' });
    expect(versionDrift.exit).not.toBe(0);
    expect(versionDrift.stderr).toContain('Workflow ref, checkout, source, version and durable attempt must agree');

    const badAttempt = runIdentity('malformed-uuid', { attempt: 'not-a-uuid' });
    expect(badAttempt.exit).not.toBe(0);
    expect(badAttempt.stderr).toContain('Workflow ref, checkout, source, version and durable attempt must agree');
    expect(cases).toHaveLength(5);
  });
});
