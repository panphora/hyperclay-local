// Caller composition, first selection: the source and workflow routing of one
// desktop release. Every fixture is a real scratch checkout with a real local bare
// remote, a private release cache outside it, the real state/store/lock/source/
// workflow modules and the pinned Ferry lock snapshot. Provider answers are raw
// envelopes through the accepted read policy; only the human-facing build gates,
// version adviser and installer are recorded adapters. The recorded GitHub push
// destination is asserted on every transport call before only the primitive remote
// operation is redirected to the owned bare repository.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { execFileCaptured } = require('../../scripts/release-command');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createReleaseState, createLegacyPublicationState,
  transitionRelease } = require('../../scripts/release-transitions');
const { makeWorkflowAttempt } = require('../../scripts/release-workflow-identity');
const { prepareVersionIntent, reconcileVersionIntent } = require('../../scripts/release-source');
const { withReleaseLock } = require('../../scripts/release-lock');
const { runRelease } = require('../../scripts/release-coordinator');
const { readPublicationEvidence } = require('../../scripts/release-publication');
const { publicationAttemptDirectoryName } = require('../../scripts/release-publication-path');
const { readSizeEvidence } = require('../../scripts/release-size-evidence');
const { readSiteAttempt, readSiteEvidence } = require('../../scripts/release-site-evidence');
const { readCompletedTargetEvidence } = require('../../scripts/release-target-evidence');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(300000);

const VERSION = '1.29.0';
const OLD_VERSION = '1.28.0';
const REPO = 'fixture-owner/hyperclay-local';
const REPO_NAME = 'hyperclay-local';
const ORIGIN = `git@github.com:${REPO}.git`;
const WORKFLOW_PATH = '.github/workflows/release.yml';
const WORKFLOW_ID = 12345;
const RUN_ID = 456;
const NEW_RUN_ID = 457;
const WALL0 = Date.parse('2026-10-03T19:00:00.000Z');
const REQUIRED_PATHS = ['README.md', 'package.json', 'website/index.html'];

const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const FRESH_RELEASE_ID = '11111111-2222-4333-8444-555555555555';
const FRESH_ATTEMPT_ID = '99999999-8888-4777-8666-555555555555';
const REPAIR_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const TMP_BASE = fs.realpathSync.native(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-coordinator-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

fs.mkdirSync(NO_HOOKS, { recursive: true });
fs.writeFileSync(GIT_CONFIG, [
  '[user]',
  '\tname = Fixture',
  '\temail = fixture@example.com',
  '[init]',
  '\tdefaultBranch = main',
  '[commit]',
  '\tgpgsign = false',
  '[tag]',
  '\tgpgsign = false',
  '[core]',
  `\thooksPath = ${JSON.stringify(NO_HOOKS.replace(/\\/g, '/'))}`,
  '\tautocrlf = false',
  ''
].join('\n'));

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_CONFIG,
  GIT_OPTIONAL_LOCKS: '0'
};

const FERRY_PACKAGE = path.join(OWNER, 'native-ferry');
const FERRY_BIN = path.join(FERRY_PACKAGE, 'bin');
const FERRY_STATE = path.join(OWNER, 'native-ferry-state');
const FERRY_CORE = path.join(FERRY_PACKAGE, 'src', 'core');
const FERRY_MODULE = require.resolve('../../scripts/release-ferry');
const FERRY_CHILDREN = new Map();
fs.mkdirSync(FERRY_BIN, { recursive: true });
fs.mkdirSync(FERRY_CORE, { recursive: true });
fs.mkdirSync(FERRY_STATE, { recursive: true });
fs.writeFileSync(path.join(FERRY_PACKAGE, 'package.json'), '{"type":"module"}\n');
fs.writeFileSync(path.join(FERRY_BIN, 'ferry.js'), '#!/usr/bin/env node\n', { mode: 0o755 });
fs.symlinkSync(path.join(FERRY_BIN, 'ferry.js'), path.join(FERRY_BIN, 'ferry'));
for (const name of ['lock.js', 'paths.js']) {
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'release-ferry', name), path.join(FERRY_CORE, name));
}
fs.writeFileSync(path.join(FERRY_CORE, 'config.js'),
  'export function loadConfig() { return { root: process.env.FERRY_ROOT }; }\n');
const ferryEnv = () => ({ ...GIT_ENV, PATH: FERRY_BIN, FERRY_ROOT: OWNER, FERRY_STATE_DIR: FERRY_STATE });
const ferryLockPath = root => path.join(FERRY_STATE, 'locks',
  `${crypto.createHash('sha1').update(path.relative(OWNER, root)).digest('hex').slice(0, 16)}.lock`);
const FERRY_HOLDER = String.raw`
const { withFerryRepoLock } = require(process.argv[2]);
const release = new Promise(resolve => {
  process.on('message', message => { if (message && message.type === 'release') resolve(); });
  process.once('disconnect', resolve);
});
withFerryRepoLock(process.argv[1], async () => {
  process.send({ type: 'held' });
  await release;
}).then(() => process.exit(0), error => {
  process.stderr.write(String(error && error.stack || error));
  process.exit(1);
});
`;

async function withNativeFerryRepoLock(root, callback) {
  const relative = path.relative(OWNER, root);
  expect(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)).toBe(true);
  const child = childProcess.spawn(process.execPath, ['-e', FERRY_HOLDER, root, FERRY_MODULE], {
    cwd: root, env: ferryEnv(), stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let stderr = '';
  let spawnError = null;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  FERRY_CHILDREN.set(child, closed);
  child.stdout.resume();
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.once('error', error => { spawnError = error; readyReject(error); });
  child.on('message', message => { if (message && message.type === 'held') readyResolve(); });
  closed.then(({ code, signal }) => readyReject(new Error(`Ferry holder exited ${code}/${signal}: ${stderr}`)));
  const timer = setTimeout(() => readyReject(new Error('Native Ferry fixture did not acquire its lock')), 30000);
  let value;
  let primary = null;
  let exit;
  try {
    await ready;
    expect(JSON.parse(fs.readFileSync(ferryLockPath(root), 'utf8')).pid).toBe(child.pid);
    value = await callback();
    expect(JSON.parse(fs.readFileSync(ferryLockPath(root), 'utf8')).pid).toBe(child.pid);
  } catch (error) {
    primary = error;
  } finally {
    clearTimeout(timer);
    if (child.connected) child.send({ type: 'release' }, error => { if (error) child.kill('SIGKILL'); });
    const stop = setTimeout(() => child.kill('SIGKILL'), 10000);
    exit = await closed;
    clearTimeout(stop);
    FERRY_CHILDREN.delete(child);
  }
  if (primary !== null) throw primary;
  if (spawnError !== null) throw spawnError;
  expect({ code: exit.code, signal: exit.signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' });
  expect(fs.existsSync(ferryLockPath(root))).toBe(false);
  return value;
}

afterAll(async () => {
  for (const child of FERRY_CHILDREN.keys()) child.kill('SIGKILL');
  await Promise.all(FERRY_CHILDREN.values());
  fs.rmSync(OWNER, { recursive: true, force: true });
});

function git(cwd, args, extraEnv) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...GIT_ENV, ...(extraEnv || {}) }
  });
}

function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function packageFixture(version) {
  return `${JSON.stringify({
    name: 'hyperclay-local-electron',
    productName: 'HyperclayLocal',
    version,
    description: 'Hyperclay Local Server - Desktop App',
    build: { artifactName: 'HyperclayLocal-Setup-${version}.${ext}' },
    hyper: { status: 'active' }
  }, null, 2)}\n`;
}

function installerNames(version) {
  return [
    `HyperclayLocal-${version}-arm64.dmg`,
    `HyperclayLocal-${version}.dmg`,
    `HyperclayLocal-Setup-${version}.exe`,
    `HyperclayLocal-${version}.AppImage`,
    `HyperclayLocal-${version}-arm64.AppImage`
  ];
}

function readmeFixture(version) {
  return [
    '# Hyperclay Local',
    '',
    '## Download',
    '',
    ...installerNames(version).map((name) => `- [${name}](https://local.hyperclay.com/${name})`),
    ''
  ].join('\n');
}

function websiteFixture(version) {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '  <body>',
    `    <section class="section" id="downloads" data-version="${version}">`,
    ...installerNames(version).map((name) => `      <a class="dl-file" href="https://local.hyperclay.com/${name}">${name}</a>`),
    '    </section>',
    '  </body>',
    '</html>',
    ''
  ].join('\n');
}

let fixtureSeq = 0;

function makeFixture({ version = VERSION } = {}) {
  const dir = fs.mkdtempSync(path.join(OWNER, `fixture-${++fixtureSeq}-`));
  const remoteDir = path.join(dir, 'remotes');
  const parentDir = path.join(dir, 'parent');
  fs.mkdirSync(remoteDir);
  fs.mkdirSync(parentDir);

  const bare = path.join(remoteDir, `${REPO_NAME}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', bare]);

  const repo = path.join(parentDir, REPO_NAME);
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', ORIGIN]);
  write(repo, 'README.md', readmeFixture(version));
  write(repo, 'package.json', packageFixture(version));
  write(repo, 'website/index.html', websiteFixture(version));
  write(repo, 'src/app.js', 'module.exports = {};\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'release source']);
  const sourceSha = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['push', '-q', bare, 'main']);

  const cacheRoot = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(dir, 'cache-'))), 'releases');
  const identity = resolveRepoIdentity(repo, { readGit: createLocalGitReader().readGit, fs });
  const repoDir = statePaths(identity, { cacheRoot, fs }).repoDir;

  return { dir, repo, bare, cacheRoot, repoDir, identity, sourceSha };
}

function stateFileOf(fixture) {
  return statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs }).stateFile;
}

function laneFileOf(fixture, mode) {
  const paths = statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
  return mode === 'dry-run' ? paths.dryRunFile : paths.stateFile;
}

function historyFileOf(fixture, releaseId) {
  const paths = statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
  return path.join(paths.historyDir, `${releaseId}.json`);
}

function readLane(fixture, mode = 'publish') {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, mode, fs });
}

function putChain(fixture, chain) {
  let expected = null;
  for (const state of chain) {
    writeReleaseState(state, fixture.identity, { cacheRoot: fixture.cacheRoot, expectedRevision: expected });
    expected = state.revision;
  }
  return chain[chain.length - 1];
}

function putOne(fixture, state, expectedRevision) {
  writeReleaseState(state, fixture.identity, { cacheRoot: fixture.cacheRoot, expectedRevision });
  return state;
}

function at(minutes) {
  return new Date(WALL0 + minutes * 60000).toISOString();
}

function refusal(promise) {
  return Promise.resolve(promise).then(() => null, (error) => error);
}

function ghEnvelope(status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return `HTTP/2.0 ${status}\r\ncontent-type: application/json\r\n\r\n${payload}`;
}

function ghOk(body) {
  return { status: 0, stdout: ghEnvelope(200, body), stderr: '', error: null, signal: null };
}

function ghStatus(status) {
  return { status: 0, stdout: ghEnvelope(status), stderr: '', error: null, signal: null };
}

function definitionBody() {
  return { id: WORKFLOW_ID, path: WORKFLOW_PATH, state: 'active' };
}

function runBody({ attemptId, sourceSha, mode, version, runId = RUN_ID, status = 'completed', conclusion = 'success' }) {
  return {
    id: runId,
    display_title: `release v${version} ${mode} sha=${sourceSha} attempt=${attemptId}`,
    repository: { full_name: REPO },
    workflow_id: WORKFLOW_ID,
    event: 'workflow_dispatch',
    head_sha: sourceSha,
    run_attempt: 1,
    status,
    conclusion: status === 'completed' ? conclusion : null,
    created_at: '2026-10-03T19:01:00.000Z',
    updated_at: '2026-10-03T19:05:00.000Z',
    html_url: `https://github.com/${REPO}/actions/runs/${runId}`
  };
}

function routeGh(routes) {
  return (args) => {
    const method = args[4];
    const endpoint = args[10];
    for (const route of routes) {
      if (route.method !== method) continue;
      const matched = typeof route.match === 'string' ? endpoint.startsWith(route.match) : route.match.test(endpoint);
      if (matched) return typeof route.reply === 'function' ? route.reply(args, endpoint) : route.reply;
    }
    throw new Error(`unexpected gh call ${method} ${endpoint}`);
  };
}

function makeHarness(fixture, options = {}) {
  const ghCalls = [];
  const preflight = [];
  const remotes = [];
  const mutations = [];
  const gates = [];
  const installs = [];
  const ferryCalls = [];
  const logs = [];
  const uuidCalls = [];
  const uuids = (options.uuids || []).slice();
  let uuidIndex = 0;
  const clock = { wall: options.wall === undefined ? WALL0 : options.wall, mono: options.mono === undefined ? 1000 : options.mono };
  const reader = createLocalGitReader();

  const run = (command, args, opts = {}) => {
    if (command !== 'git' || opts.cwd !== fixture.repo) {
      throw new Error(`fixture mutation escaped its owned checkout: ${command}`);
    }
    mutations.push([command, ...args]);
    return execFileCaptured(command, args, { ...opts, echoStdout: false, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  const spawnRemote = (command, args, opts = {}) => {
    if (command !== 'git' || !Array.isArray(args) || !['ls-remote', 'push', 'fetch'].includes(args[0])) {
      throw new Error(`unexpected remote command: ${command} ${args && args.join(' ')}`);
    }
    const index = args[0] === 'fetch' ? 3 : 2;
    if (args[index] !== ORIGIN || args.filter((value) => value === ORIGIN).length !== 1) {
      throw new Error('remote argv must carry the exact recorded destination once');
    }
    if (opts.cwd !== fixture.repo) throw new Error('remote command escaped its owned checkout');
    const mapped = args.slice();
    mapped[index] = fixture.bare;
    remotes.push({ args: [...args], mapped: [...mapped] });
    return childProcess.spawnSync(command, mapped, { ...opts, env: GIT_ENV });
  };
  const providerRun = (file, args, opts = {}) => {
    if (file === 'git') {
      if (!(args[0] === 'ls-remote' && args[1] === '--exit-code' && args[2] === 'origin')) {
        throw new Error(`unexpected provider git call ${args.join(' ')}`);
      }
      if (opts.cwd !== fixture.repo) throw new Error('provider git call escaped its owned checkout');
      preflight.push([...args]);
      return childProcess.spawnSync(file, args.map((value) => (value === 'origin' ? fixture.bare : value)), { ...opts, env: GIT_ENV });
    }
    if (file !== 'gh') throw new Error(`unexpected executable ${file}`);
    if (typeof supplied.gh !== 'function') throw new Error('fixture has no provider route');
    ghCalls.push({ args: args.slice(), options: opts });
    return supplied.gh(args, opts);
  };

  const supplied = {
    run,
    spawnRemote,
    providerRun,
    wallNow: () => clock.wall,
    now: () => clock.mono,
    randomUUID: () => {
      if (uuidIndex >= uuids.length) throw new Error('fixture uuid sequence exhausted');
      const value = uuids[uuidIndex++];
      uuidCalls.push(value);
      if (typeof options.onUuid === 'function') options.onUuid(value, uuidCalls.length - 1);
      return value;
    },
    newBuildGates: async (input) => {
      gates.push(input);
      if (typeof options.onGate === 'function') await options.onGate(input);
    },
    withFerryRepoLock: async (root, callback) => {
      ferryCalls.push(root);
      return withNativeFerryRepoLock(root, callback);
    },
    log: (message) => { logs.push(String(message)); },
    sleep: async (ms) => { clock.mono += ms; }
  };
  if (options.fs !== undefined) supplied.fs = options.fs;
  if (options.install !== undefined) supplied.install = options.install;
  if (options.chooseBump !== undefined) supplied.chooseBump = options.chooseBump;
  if (options.signal !== undefined) supplied.signal = options.signal;

  return {
    supplied,
    clock,
    ghCalls,
    preflight,
    remotes,
    mutations,
    gates,
    installs,
    ferryCalls,
    logs,
    uuids,
    uuidCalls,
    posts: () => ghCalls.filter((call) => call.args[4] === 'POST'),
    gets: () => ghCalls.filter((call) => call.args[4] === 'GET'),
    pushes: () => remotes.filter((call) => call.args[0] === 'push'),
    tagMutations: () => mutations.filter((call) => call[1] === '-c' && call[2] === 'tag.gpgSign=false' && call[3] === 'tag'),
    reader
  };
}

function flagsFor(overrides = {}) {
  return {
    version: null,
    bump: null,
    resume: false,
    dryRun: false,
    reconcileOnly: false,
    resumeSource: null,
    retrySite: false,
    ignoreWindow: false,
    skipUiPass: false,
    help: false,
    ...overrides
  };
}

function release(fixture, overrides, harness) {
  return runRelease({ repoRoot: fixture.repo, cacheRoot: fixture.cacheRoot, flags: flagsFor(overrides) }, harness.supplied);
}

function sourceDeps(fixture, options = {}) {
  const calls = [];
  const remoteCalls = [];
  const ferryCalls = [];
  const wall = options.wall === undefined ? WALL0 : options.wall;
  const run = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    return execFileCaptured(command, args, { ...opts, echoStdout: false, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  const spawn = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    return childProcess.spawnSync(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  const spawnRemote = (command, args, opts = {}) => {
    const index = args[0] === 'fetch' ? 3 : 2;
    if (command !== 'git' || args[index] !== ORIGIN) {
      throw new Error(`unexpected remote invocation: git ${args.join(' ')}`);
    }
    const mapped = args.slice();
    mapped[index] = fixture.bare;
    remoteCalls.push([...args]);
    return childProcess.spawnSync(command, mapped, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  return {
    run,
    spawn,
    spawnRemote,
    fs: options.fs === undefined ? fs : options.fs,
    now: () => wall,
    randomUUID: () => crypto.randomUUID(),
    assertPublishWindow: () => {},
    withFerryRepoLock: async (root, callback) => {
      ferryCalls.push(root);
      return withNativeFerryRepoLock(root, callback);
    },
    calls,
    remoteCalls,
    ferryCalls
  };
}

function stalledLaneFs(stateFile) {
  return new Proxy(fs, {
    get(target, prop) {
      if (prop === 'renameSync') {
        return (from, to) => {
          if (to === stateFile) throw Object.assign(new Error('injected lane failure'), { code: 'EIO' });
          return fs.renameSync(from, to);
        };
      }
      return target[prop];
    }
  });
}

function fsyncFaultFs(match) {
  const payloads = new Map();
  return new Proxy(fs, {
    get(target, prop) {
      if (prop === 'writeFileSync') {
        return (file, data, ...rest) => {
          if (typeof file === 'number') {
            payloads.set(file, Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
          }
          return fs.writeFileSync(file, data, ...rest);
        };
      }
      if (prop === 'closeSync') {
        return (fd) => {
          const result = fs.closeSync(fd);
          payloads.delete(fd);
          return result;
        };
      }
      if (prop === 'fsyncSync') {
        return (fd) => {
          const payload = payloads.get(fd);
          if (typeof payload === 'string' && match(payload)) {
            throw Object.assign(new Error('injected state flush failure'), { code: 'EIO' });
          }
          return fs.fsyncSync(fd);
        };
      }
      return target[prop];
    }
  });
}

function readbackFaultFs(laneFile, predicate) {
  return new Proxy(fs, {
    get(target, prop) {
      if (prop === 'renameSync') {
        return (from, to) => {
          const result = fs.renameSync(from, to);
          if (to === laneFile) {
            let parsed = null;
            try {
              parsed = JSON.parse(fs.readFileSync(to, 'utf8'));
            } catch {
              parsed = null;
            }
            if (parsed !== null && predicate(parsed)) {
              parsed.revision += 1;
              fs.writeFileSync(to, `${JSON.stringify(parsed)}\n`);
            }
          }
          return result;
        };
      }
      return target[prop];
    }
  });
}

function dryRunChain(fixture, { releaseId = RELEASE_ID, attemptId = ATTEMPT_ID, conclusion = 'failure' } = {}) {
  const base = createReleaseState({
    releaseId,
    version: VERSION,
    mode: 'dry-run',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId,
    sourceSha: fixture.sourceSha,
    dispatchRef: 'main'
  });
  const ready = transitionRelease(base, { type: 'attempt-ready', at: at(1), attempt }, fixture.identity, { repoDir: fixture.repoDir });
  const requested = transitionRelease(ready, { type: 'dispatch-requested', at: at(2) }, fixture.identity, { repoDir: fixture.repoDir });
  const observed = transitionRelease(requested, {
    type: 'run-observed', at: at(3), runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion
  }, fixture.identity, { repoDir: fixture.repoDir });
  const failed = transitionRelease(observed, {
    type: 'ci-failed', at: at(4), error: { code: 'WORKFLOW_CI_FAILED', message: `Workflow ${conclusion}` }
  }, fixture.identity, { repoDir: fixture.repoDir });
  return [base, ready, requested, observed, failed];
}

function sourceReadyChain(fixture, { releaseId = RELEASE_ID, attemptId = ATTEMPT_ID } = {}) {
  const base = createReleaseState({
    releaseId,
    version: VERSION,
    mode: 'dry-run',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId,
    sourceSha: fixture.sourceSha,
    dispatchRef: 'main'
  });
  const ready = transitionRelease(base, { type: 'attempt-ready', at: at(1), attempt }, fixture.identity, { repoDir: fixture.repoDir });
  const requested = transitionRelease(ready, { type: 'dispatch-requested', at: at(2) }, fixture.identity, { repoDir: fixture.repoDir });
  return [base, ready, requested];
}

function publishSourceReady(fixture, { releaseId = RELEASE_ID } = {}) {
  return createReleaseState({
    releaseId,
    version: VERSION,
    mode: 'publish',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
}

function publishRejectedChain(fixture, { releaseId = RELEASE_ID, attemptId = ATTEMPT_ID } = {}) {
  const base = createReleaseState({
    releaseId,
    version: VERSION,
    mode: 'publish',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId,
    sourceSha: fixture.sourceSha,
    dispatchRef: `v${VERSION}`
  });
  const ready = transitionRelease(base, { type: 'attempt-ready', at: at(1), attempt }, fixture.identity, { repoDir: fixture.repoDir });
  const requested = transitionRelease(ready, { type: 'dispatch-requested', at: at(2) }, fixture.identity, { repoDir: fixture.repoDir });
  const rejected = transitionRelease(requested, {
    type: 'dispatch-rejected', at: at(3),
    error: { code: 'WORKFLOW_DISPATCH_REJECTED', message: 'GitHub definitively rejected the workflow dispatch' }
  }, fixture.identity, { repoDir: fixture.repoDir });
  return [base, ready, requested, rejected];
}

function publishRequestedChain(fixture, { releaseId = RELEASE_ID, attemptId = ATTEMPT_ID, unknown = false } = {}) {
  const chain = publishRejectedChain(fixture, { releaseId, attemptId }).slice(0, 3);
  if (!unknown) return chain;
  const unresolved = transitionRelease(chain[2], {
    type: 'dispatch-unknown', at: at(3),
    error: { code: 'WORKFLOW_DISPATCH_UNKNOWN', message: 'Workflow dispatch has no verified run identity' }
  }, fixture.identity, { repoDir: fixture.repoDir });
  return chain.concat([unresolved]);
}

function advanceHead(fixture) {
  write(fixture.repo, 'src/app.js', 'module.exports = { advanced: true };\n');
  git(fixture.repo, ['add', '-A']);
  git(fixture.repo, ['commit', '-q', '-m', 'unrelated advance']);
  return git(fixture.repo, ['rev-parse', 'HEAD']).trim();
}

function tagSnapshot(fixture) {
  return {
    local: git(fixture.repo, ['for-each-ref', '--format=%(objectname)%09%(*objectname)%09%(refname)',
      `refs/tags/v${VERSION}`]),
    remote: git(fixture.repo, ['ls-remote', '--tags', fixture.bare,
      `refs/tags/v${VERSION}`, `refs/tags/v${VERSION}^{}`])
  };
}

function tagOriginalSource(fixture) {
  git(fixture.repo, ['tag', '-a', `v${VERSION}`, fixture.sourceSha, '-m', `v${VERSION}`]);
  git(fixture.repo, ['push', '-q', fixture.bare, `refs/tags/v${VERSION}`]);
  return tagSnapshot(fixture);
}

function commitRepairSource(fixture, { version = VERSION, push = true, label = 'same-version repair' } = {}) {
  write(fixture.repo, 'package.json', packageFixture(version));
  write(fixture.repo, 'src/app.js', `module.exports = { repair: ${JSON.stringify(label)} };\n`);
  git(fixture.repo, ['add', 'package.json', 'src/app.js']);
  git(fixture.repo, ['commit', '-q', '-m', label]);
  const sourceSha = git(fixture.repo, ['rev-parse', 'HEAD']).trim();
  if (push) git(fixture.repo, ['push', '-q', fixture.bare, 'main']);
  return sourceSha;
}

function modernFailedChain(fixture) {
  const base = createReleaseState({
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId: ATTEMPT_ID,
    sourceSha: fixture.sourceSha,
    dispatchRef: `v${VERSION}`
  });
  const ready = transitionRelease(base, { type: 'attempt-ready', at: at(1), attempt },
    fixture.identity, { repoDir: fixture.repoDir });
  const requested = transitionRelease(ready, { type: 'dispatch-requested', at: at(2) },
    fixture.identity, { repoDir: fixture.repoDir });
  const observed = transitionRelease(requested, {
    type: 'run-observed', at: at(3), runId: RUN_ID, runAttempt: 1,
    runStatus: 'completed', conclusion: 'failure'
  }, fixture.identity, { repoDir: fixture.repoDir });
  const failed = transitionRelease(observed, {
    type: 'ci-failed', at: at(4),
    error: { code: 'WORKFLOW_CI_FAILED', message: 'Fixture CI failure' }
  }, fixture.identity, { repoDir: fixture.repoDir });
  return [base, ready, requested, observed, failed];
}

function setupModernRepair(options = {}) {
  const fixture = makeFixture();
  const originalTag = tagOriginalSource(fixture);
  const failed = putChain(fixture, modernFailedChain(fixture));
  const repairedSourceSha = options.identical
    ? fixture.sourceSha
    : commitRepairSource(fixture, {
      version: options.version,
      push: options.push,
      label: options.label
    });
  return { fixture, failed, repairedSourceSha, originalTag };
}

function legacyRunBody(fixture, overrides = {}) {
  return {
    id: RUN_ID,
    display_title: `release v${VERSION}`,
    repository: { full_name: REPO },
    workflow_id: WORKFLOW_ID,
    event: 'workflow_dispatch',
    head_sha: fixture.sourceSha,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'failure',
    created_at: '2026-10-03T19:01:00.000Z',
    updated_at: '2026-10-03T19:05:00.000Z',
    html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
    ...overrides
  };
}

function postHint(runId) {
  return ghOk({
    workflow_run_id: runId,
    run_url: `https://api.github.com/repos/${REPO}/actions/runs/${runId}`,
    html_url: `https://github.com/${REPO}/actions/runs/${runId}`
  });
}

function failureEvidenceFile(fixture, state, attemptId = state.attempts[0].id) {
  return path.join(fixture.repoDir, 'records', state.releaseId, 'artifacts',
    publicationAttemptDirectoryName(attemptId), 'failure.json');
}

describePosix('caller source and workflow', () => {
  testPosix('caller source and workflow: one dry-run POST proves completion in its own lane', async () => {
    const fixture = makeFixture();
    const harness = makeHarness(fixture, { uuids: [FRESH_RELEASE_ID, FRESH_ATTEMPT_ID] });
    harness.supplied.gh = routeGh([
      {
        method: 'GET',
        match: `repos/${REPO}/actions/workflows/release.yml`,
        reply: ghOk(definitionBody())
      },
      {
        method: 'GET',
        match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`,
        reply: ghOk(definitionBody())
      },
      {
        method: 'POST',
        match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
        reply: ghOk({
          workflow_run_id: RUN_ID,
          run_url: `https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}`,
          html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`
        })
      },
      {
        method: 'GET',
        match: `repos/${REPO}/actions/runs/${RUN_ID}`,
        reply: ghOk(runBody({ attemptId: FRESH_ATTEMPT_ID, sourceSha: fixture.sourceSha, mode: 'dry-run', version: VERSION }))
      }
    ]);

    const result = await release(fixture, { dryRun: true }, harness);

    expect(result.outcome).toBe('dry-run-complete');
    expect(harness.posts()).toHaveLength(1);
    expect(harness.posts()[0].args[10]).toBe(`repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`);
    const body = JSON.parse(harness.posts()[0].options.input);
    expect(body.ref).toBe('main');
    expect(body.inputs).toEqual({ version: VERSION, dry_run: true, source_sha: fixture.sourceSha, attempt_id: FRESH_ATTEMPT_ID });
    expect(harness.gates.map((gate) => gate.kind)).toEqual(['dry-run']);
    expect(harness.pushes()).toHaveLength(0);

    const dry = readLane(fixture, 'dry-run');
    expect(dry.phase).toBe('complete');
    expect(dry.releaseId).toBe(FRESH_RELEASE_ID);
    expect(dry.mode).toBe('dry-run');
    expect(dry.sourceSha).toBe(fixture.sourceSha);
    expect(dry.attempts).toHaveLength(1);
    expect(dry.attempts[0].dispatch).toBe('identified');
    expect(dry.attempts[0].conclusion).toBe('success');
    expect(readLane(fixture, 'publish')).toBeNull();
    expect(result.state).toEqual(dry);
  });

  testPosix('caller source and workflow: failed rehearsal archives before one fresh attempt while explicit resume stays failed', async () => {
    const archived = makeFixture();
    putChain(archived, dryRunChain(archived));
    const oldBytes = fs.readFileSync(laneFileOf(archived, 'dry-run'));
    const harness = makeHarness(archived, { uuids: [FRESH_RELEASE_ID, FRESH_ATTEMPT_ID] });
    harness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}`, reply: ghOk(runBody({ attemptId: ATTEMPT_ID, sourceSha: archived.sourceSha, mode: 'dry-run', version: VERSION, conclusion: 'failure' })) },
      { method: 'GET', match: `repos/${REPO}/actions/workflows/release.yml`, reply: ghOk(definitionBody()) },
      { method: 'GET', match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`, reply: ghOk(definitionBody()) },
      {
        method: 'POST',
        match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
        reply: ghOk({
          workflow_run_id: NEW_RUN_ID,
          run_url: `https://api.github.com/repos/${REPO}/actions/runs/${NEW_RUN_ID}`,
          html_url: `https://github.com/${REPO}/actions/runs/${NEW_RUN_ID}`
        })
      },
      { method: 'GET', match: `repos/${REPO}/actions/runs/${NEW_RUN_ID}`, reply: ghOk(runBody({ attemptId: FRESH_ATTEMPT_ID, sourceSha: archived.sourceSha, mode: 'dry-run', version: VERSION, runId: NEW_RUN_ID })) }
    ]);

    const result = await release(archived, { dryRun: true }, harness);

    expect(result.outcome).toBe('dry-run-complete');
    expect(harness.posts()).toHaveLength(1);
    expect(JSON.parse(harness.posts()[0].options.input).inputs.attempt_id).toBe(FRESH_ATTEMPT_ID);
    const dry = readLane(archived, 'dry-run');
    expect(dry.releaseId).toBe(FRESH_RELEASE_ID);
    expect(dry.revision).toBe(4);
    expect(dry.phase).toBe('complete');
    expect(fs.readFileSync(historyFileOf(archived, RELEASE_ID))).toEqual(oldBytes);
    expect(readLane(archived, 'publish')).toBeNull();

    const resumed = makeFixture();
    putChain(resumed, dryRunChain(resumed));
    const resumedBytes = fs.readFileSync(laneFileOf(resumed, 'dry-run'));
    const resumeHarness = makeHarness(resumed, { uuids: [] });
    resumeHarness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}`, reply: ghOk(runBody({ attemptId: ATTEMPT_ID, sourceSha: resumed.sourceSha, mode: 'dry-run', version: VERSION, conclusion: 'failure' })) }
    ]);

    const resumeResult = await release(resumed, { dryRun: true, resume: true }, resumeHarness);

    expect(resumeResult.outcome).toBe('failed-ci');
    expect(resumeHarness.posts()).toHaveLength(0);
    expect(fs.readFileSync(laneFileOf(resumed, 'dry-run'))).toEqual(resumedBytes);
    expect(fs.existsSync(historyFileOf(resumed, RELEASE_ID))).toBe(false);
    expect(readLane(resumed, 'dry-run').phase).toBe('failed-ci');
  });

  testPosix('caller source and workflow: an unresolved direct read never archives a failed rehearsal', async () => {
    const fixture = makeFixture();
    putChain(fixture, dryRunChain(fixture));
    const bytes = fs.readFileSync(laneFileOf(fixture, 'dry-run'));
    const harness = makeHarness(fixture, { uuids: [] });
    harness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}`, reply: ghStatus(404) }
    ]);

    const result = await release(fixture, { dryRun: true }, harness);

    expect(result.outcome).toBe('pending');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.kind).toBe('http');
    expect(result.error.httpStatus).toBe(404);
    expect(harness.posts()).toHaveLength(0);
    expect(harness.gates).toEqual([]);
    expect(harness.pushes()).toHaveLength(0);
    expect(fs.readFileSync(laneFileOf(fixture, 'dry-run'))).toEqual(bytes);
    expect(fs.existsSync(historyFileOf(fixture, RELEASE_ID))).toBe(false);
  });

  testPosix('caller source and workflow: requested and unknown attempts never POST even after HEAD advances', async () => {
    for (const unknown of [false, true]) {
      const fixture = makeFixture();
      putChain(fixture, publishRequestedChain(fixture, { unknown }));
      const bytes = fs.readFileSync(laneFileOf(fixture, 'publish'));
      const advanced = advanceHead(fixture);
      expect(advanced).not.toBe(fixture.sourceSha);
      const attemptId = ATTEMPT_ID;
      const harness = makeHarness(fixture, { uuids: [], wall: WALL0 + 3 * 60000 });
      harness.supplied.gh = routeGh([
        {
          method: 'GET',
          match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`,
          reply: ghOk({ total_count: 1, workflow_runs: [runBody({ attemptId, sourceSha: fixture.sourceSha, mode: 'publish', version: VERSION, conclusion: 'failure' })] })
        },
        { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}`, reply: ghOk(runBody({ attemptId, sourceSha: fixture.sourceSha, mode: 'publish', version: VERSION, conclusion: 'failure' })) }
      ]);

      const result = await release(fixture, { resume: true }, harness);

      expect(result.outcome).toBe('failed-ci');
      expect(harness.posts()).toHaveLength(0);
      expect(harness.gates).toEqual([]);
      expect(harness.pushes()).toHaveLength(0);
      expect(harness.remotes.filter((call) => call.args[0] === 'ls-remote')).toEqual([]);
      const lane = readLane(fixture, 'publish');
      expect(lane.attempts).toHaveLength(1);
      expect(lane.attempts[0].id).toBe(ATTEMPT_ID);
      expect(lane.phase).toBe('failed-ci');
      expect(fs.readFileSync(laneFileOf(fixture, 'publish'))).not.toEqual(bytes);
    }
  });

  testPosix('caller source and workflow: only an explicit resume continues a definitive rejection once', async () => {
    const ordinary = makeFixture();
    putChain(ordinary, publishRejectedChain(ordinary));
    const ordinaryBytes = fs.readFileSync(laneFileOf(ordinary, 'publish'));
    const ordinaryHarness = makeHarness(ordinary, { uuids: [], wall: WALL0 + 4 * 60000 });
    ordinaryHarness.supplied.gh = routeGh([]);
    const ordinaryResult = await release(ordinary, {}, ordinaryHarness);
    expect(ordinaryResult.outcome).toBe('rejected');
    expect(ordinaryHarness.posts()).toHaveLength(0);
    expect(ordinaryHarness.gates).toEqual([]);
    expect(fs.readFileSync(laneFileOf(ordinary, 'publish'))).toEqual(ordinaryBytes);

    const reconcileOnly = makeFixture();
    putChain(reconcileOnly, publishRejectedChain(reconcileOnly));
    const reconcileBytes = fs.readFileSync(laneFileOf(reconcileOnly, 'publish'));
    const reconcileHarness = makeHarness(reconcileOnly, { uuids: [], wall: WALL0 + 4 * 60000 });
    reconcileHarness.supplied.gh = routeGh([]);
    const reconcileResult = await release(reconcileOnly, { reconcileOnly: true }, reconcileHarness);
    expect(reconcileResult.outcome).toBe('rejected');
    expect(reconcileHarness.posts()).toHaveLength(0);
    expect(reconcileHarness.gates).toEqual([]);
    expect(fs.readFileSync(laneFileOf(reconcileOnly, 'publish'))).toEqual(reconcileBytes);

    const resumed = makeFixture();
    putChain(resumed, publishRejectedChain(resumed));
    const harness = makeHarness(resumed, { uuids: [REPAIR_ATTEMPT_ID], wall: WALL0 + 4 * 60000 });
    harness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/workflows/release.yml`, reply: ghOk(definitionBody()) },
      { method: 'GET', match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`, reply: ghOk(definitionBody()) },
      {
        method: 'POST',
        match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
        reply: ghOk({
          workflow_run_id: RUN_ID,
          run_url: `https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}`,
          html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`
        })
      },
      { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}`, reply: ghOk(runBody({ attemptId: REPAIR_ATTEMPT_ID, sourceSha: resumed.sourceSha, mode: 'publish', version: VERSION, conclusion: 'failure' })) }
    ]);

    const result = await release(resumed, { resume: true }, harness);

    expect(result.outcome).toBe('failed-ci');
    expect(harness.posts()).toHaveLength(1);
    const body = JSON.parse(harness.posts()[0].options.input);
    expect(body.inputs.attempt_id).toBe(REPAIR_ATTEMPT_ID);
    expect(body.ref).toBe(`v${VERSION}`);
    expect(harness.gates.map((gate) => gate.kind)).toEqual(['dispatch']);
    expect(harness.pushes()).toHaveLength(1);
    expect(harness.tagMutations()).toHaveLength(1);

    const lane = readLane(resumed, 'publish');
    expect(lane.attempts).toHaveLength(2);
    expect(lane.attempts[0].id).toBe(ATTEMPT_ID);
    expect(lane.attempts[0].dispatch).toBe('rejected');
    expect(lane.attempts[0].error.code).toBe('WORKFLOW_DISPATCH_REJECTED');
    expect(lane.attempts[1].id).toBe(REPAIR_ATTEMPT_ID);
    expect(lane.attempts[1].dispatch).toBe('identified');
    expect(lane.phase).toBe('failed-ci');
    expect(result.state).toEqual(lane);
  });

  testPosix('caller source and workflow: a source-ready reconcile-only invocation is inert', async () => {
    const fixture = makeFixture();
    putOne(fixture, publishSourceReady(fixture), null);
    const bytes = fs.readFileSync(laneFileOf(fixture, 'publish'));
    const harness = makeHarness(fixture, { uuids: [] });
    harness.supplied.gh = routeGh([]);

    const result = await release(fixture, { reconcileOnly: true }, harness);

    expect(result.outcome).toBe('pending');
    expect(result.error.code).toBe('RELEASE_PENDING');
    expect(harness.posts()).toHaveLength(0);
    expect(harness.gates).toEqual([]);
    expect(harness.remotes).toEqual([]);
    expect(harness.preflight).toEqual([]);
    expect(harness.mutations).toEqual([]);
    expect(fs.readFileSync(laneFileOf(fixture, 'publish'))).toEqual(bytes);
  });

  testPosix('caller source and workflow: reconcile-only binds a complete version journal and refuses an incomplete one', async () => {
    const incomplete = makeFixture({ version: OLD_VERSION });
    await withReleaseLock(incomplete.identity, async () => prepareVersionIntent({
      identity: incomplete.identity,
      repoDir: incomplete.repoDir,
      releaseId: RELEASE_ID,
      previousVersion: OLD_VERSION,
      version: VERSION
    }, sourceDeps(incomplete)), { cacheRoot: incomplete.cacheRoot });
    expect(readLane(incomplete, 'publish').phase).toBe('version-preparing');
    const incompleteBytes = fs.readFileSync(laneFileOf(incomplete, 'publish'));
    const incompleteHarness = makeHarness(incomplete, { uuids: [] });
    incompleteHarness.supplied.gh = routeGh([]);

    const refused = await refusal(release(incomplete, { reconcileOnly: true }, incompleteHarness));

    expect(refused).toBeInstanceOf(Error);
    expect(refused.code).toBe('RELEASE_SOURCE_PENDING');
    expect(incompleteHarness.posts()).toHaveLength(0);
    expect(incompleteHarness.gates).toEqual([]);
    expect(incompleteHarness.remotes).toEqual([]);
    expect(fs.readFileSync(laneFileOf(incomplete, 'publish'))).toEqual(incompleteBytes);

    const complete = makeFixture({ version: OLD_VERSION });
    await withReleaseLock(complete.identity, async () => prepareVersionIntent({
      identity: complete.identity,
      repoDir: complete.repoDir,
      releaseId: RELEASE_ID,
      previousVersion: OLD_VERSION,
      version: VERSION
    }, sourceDeps(complete)), { cacheRoot: complete.cacheRoot });
    const stallDeps = sourceDeps(complete, { fs: stalledLaneFs(stateFileOf(complete)) });
    const stalled = await refusal(withReleaseLock(complete.identity, async () => reconcileVersionIntent({
      identity: complete.identity,
      repoDir: complete.repoDir
    }, stallDeps), { cacheRoot: complete.cacheRoot }));
    expect(stalled).toBeInstanceOf(Error);
    expect(stalled.code).toBe('STATE_IO_FAILED');
    expect(readLane(complete, 'publish').phase).toBe('version-preparing');
    const completeHarness = makeHarness(complete, { uuids: [] });
    completeHarness.supplied.gh = routeGh([]);

    const result = await release(complete, { reconcileOnly: true }, completeHarness);

    expect(result.outcome).toBe('pending');
    expect(completeHarness.posts()).toHaveLength(0);
    expect(completeHarness.gates).toEqual([]);
    expect(completeHarness.remotes).toEqual([]);
    const bound = readLane(complete, 'publish');
    expect(bound.phase).toBe('source-ready');
    expect(bound.revision).toBe(1);
    expect(bound.sourceSha).toBe(git(complete.repo, ['rev-parse', 'HEAD']).trim());
    expect(result.state).toEqual(bound);
  });

  testPosix('caller source and workflow: a state flush failure before the requested acknowledgement prevents the POST', async () => {
    const fixture = makeFixture();
    putChain(fixture, sourceReadyChain(fixture).slice(0, 1));
    const bytes = fs.readFileSync(laneFileOf(fixture, 'dry-run'));
    const harness = makeHarness(fixture, {
      uuids: [FRESH_ATTEMPT_ID],
      fs: fsyncFaultFs((payload) => payload.includes('"dispatch":"requested"'))
    });
    harness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/workflows/release.yml`, reply: ghOk(definitionBody()) },
      { method: 'GET', match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`, reply: ghOk(definitionBody()) }
    ]);

    const error = await refusal(release(fixture, { dryRun: true }, harness));

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('WORKFLOW_STATE_WRITE_FAILED');
    expect(harness.posts()).toHaveLength(0);
    expect(harness.pushes()).toHaveLength(0);
    const saved = readLane(fixture, 'dry-run');
    expect(saved.revision).toBe(1);
    expect(saved.phase).toBe('workflow');
    expect(saved.attempts).toHaveLength(1);
    expect(saved.activeAttemptId).toBe(FRESH_ATTEMPT_ID);
    expect(saved.attempts[0].dispatch).toBe('ready');
    expect(saved.attempts[0].requestedAt).toBeNull();
    expect(saved.attempts[0].runId).toBeNull();
    expect(fs.readFileSync(laneFileOf(fixture, 'dry-run'))).not.toEqual(bytes);
  });

  testPosix('caller source and workflow: a filesystem readback mismatch prevents the subsequent action', async () => {
    const fixture = makeFixture();
    putChain(fixture, sourceReadyChain(fixture).slice(0, 1));
    const bytes = fs.readFileSync(laneFileOf(fixture, 'dry-run'));
    const harness = makeHarness(fixture, {
      uuids: [FRESH_ATTEMPT_ID],
      fs: readbackFaultFs(laneFileOf(fixture, 'dry-run'), (state) =>
        state.phase === 'workflow' && Array.isArray(state.attempts) &&
        state.attempts.length === 1 && state.attempts[0].dispatch === 'ready')
    });
    harness.supplied.gh = routeGh([
      { method: 'GET', match: `repos/${REPO}/actions/workflows/release.yml`, reply: ghOk(definitionBody()) }
    ]);

    const error = await refusal(release(fixture, { dryRun: true }, harness));

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('RELEASE_COORDINATOR_STATE_STALE');
    expect(harness.posts()).toHaveLength(0);
    expect(harness.pushes()).toHaveLength(0);
    expect(fs.readFileSync(laneFileOf(fixture, 'dry-run'))).not.toEqual(bytes);
  });

  testPosix('caller source and workflow: native Ferry bridge holds the real lock and releases after callback failure', async () => {
    const fixture = makeFixture();
    const lockUrl = pathToFileURL(path.join(FERRY_CORE, 'lock.js')).href;
    const relative = path.relative(OWNER, fixture.repo);
    const contender = String.raw`
import(process.argv[1]).then(async lock => {
  let entered = false;
  const value = await lock.tryRepoLock(process.argv[2], 'coordinator-contender', async () => {
    entered = true;
    return 'acquired';
  });
  process.stdout.write(JSON.stringify({ entered, value }));
}).catch(error => { process.stderr.write(String(error.stack)); process.exitCode = 1; });
`;
    const value = await withNativeFerryRepoLock(fixture.repo, async () => {
      const result = childProcess.spawnSync(process.execPath, ['-e', contender, lockUrl, relative], {
        cwd: fixture.repo, env: ferryEnv(), encoding: 'utf8', timeout: 10000
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({ entered: false, value: null });
      return 'applied';
    });
    expect(value).toBe('applied');
    const original = new Error('fixture callback failure');
    await expect(withNativeFerryRepoLock(fixture.repo, async () => { throw original; })).rejects.toBe(original);
    expect(fs.existsSync(ferryLockPath(fixture.repo))).toBe(false);
    expect(FERRY_CHILDREN.size).toBe(0);
  });
});

// Publication, tail and history fixture. This selection owns its own scratch
// checkouts, bare remotes and release cache; the desktop repo and both documentation
// repositories are ordinary repositories, the provider answers are raw envelopes
// through the accepted read policy and the size/site/docs producers are the real
// modules. The Ferry lock is the pinned native snapshot held by an IPC child.
const DOC_REPOS = ['hyperclay', 'hyperclay-website'];
const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_PATH = 'vault/DOCS/15 Hyperclay Local App.md';
const LLMS_PATH = 'public/llms.txt';
const SIZE_NAMES = installerNames(VERSION);
const SIZE_LABELS = ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux (x86_64)', 'Linux (ARM64)'];
const SIZE_OS_KEYS = ['mac-arm', 'mac-intel', 'windows', 'linux', 'linux-arm'];
const MB_OLD = [102.3, 108.8, 90.1, 123.7, 123.4];
const MB_NEW = [103.0, 109.7, 90.6, 124.0, 123.5];
const TAIL_WALL0 = WALL0 + 30 * 60000;
const HIGHER_VERSION = '1.30.0';
const UPLOAD_JOB_ID = 4242;
const VERIFIED_AT = '2026-10-03T19:05:00.000Z';
const WEBSITE_CONFIG = [
  '{',
  '  "name": "hyperclaylocal",',
  '  "compatibility_date": "2026-07-19",',
  '  "assets": { "directory": "./" },',
  '  "routes": [',
  '    { "pattern": "hyperclaylocal.com", "custom_domain": true },',
  '    { "pattern": "www.hyperclaylocal.com", "custom_domain": true }',
  '  ]',
  '}',
  ''
].join('\n');
const WEBSITE_IGNORE = [
  '# Not part of the public site served at hyperclaylocal.com',
  '.DS_Store',
  '.assetsignore',
  'wrangler.jsonc',
  '.wrangler',
  ''
].join('\n');
const BINARY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xff, 0xfe, 0x00, 0x7f, 0x80, 0xc3, 0x28]);
const BINARY_FONT = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x01, 0x02]);
const PLATFORM_VAULT = ['---', 'title: Platform', '---', '', 'Platform notes.', ''].join('\n');

const DEPLOY_CHILD = path.join(OWNER, 'tail-deploy-child.js');
fs.writeFileSync(DEPLOY_CHILD, [
  "'use strict';",
  "const crypto = require('crypto');",
  "const fs = require('fs');",
  "const path = require('path');",
  'const report = process.argv[2];',
  'const status = Number(process.argv[3]);',
  'const cwd = process.cwd();',
  "const digest = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, rel))).digest('hex');",
  'fs.writeFileSync(report, `${JSON.stringify({',
  '  cwd, index: digest("index.html"), wrangler: digest("wrangler.jsonc")',
  '})}\\n`);',
  'process.exit(status);',
  ''
].join('\n'));

function edgeBody(version) {
  return [
    "@component('components/layout/app', { title: 'Hyperclay Local' })",
    '  <script>',
    '    var downloads = {',
    `      macArm: { url: 'https://local.hyperclay.com/HyperclayLocal-${version}-arm64.dmg' },`,
    `      windows: { url: 'https://local.hyperclay.com/HyperclayLocal-Setup-${version}.exe' }`,
    '    };',
    `    var version = '${version}';`,
    '  </script>',
    '@end',
    ''
  ].join('\n');
}

function vaultBody(version) {
  return [
    '---',
    'title: Hyperclay Local App',
    '---',
    '',
    'Download Hyperclay Local:',
    '',
    `   - **macOS**: [HyperclayLocal-${version}-arm64.dmg](https://local.hyperclay.com/HyperclayLocal-${version}-arm64.dmg)`,
    `   - **Windows**: [HyperclayLocal-Setup-${version}.exe](https://local.hyperclay.com/HyperclayLocal-Setup-${version}.exe)`,
    '',
    `Install with \`chmod +x HyperclayLocal-${version}.AppImage\` after downloading.`,
    '',
    `This release is ${version}.`,
    ''
  ].join('\n');
}

function sizedReadme(mb) {
  const lines = ['# HyperclayLocal ' + VERSION, '', 'Download the app for your platform:', ''];
  SIZE_NAMES.forEach((name, index) => {
    lines.push(`   - **${SIZE_LABELS[index]}**: [${name}](https://local.hyperclay.com/${name}) (${Number(mb[index]).toFixed(1)}MB)`);
  });
  lines.push('', 'Install and run the app.', '');
  return lines.join('\n');
}

function sizedWebsite(mb) {
  const lines = [
    `<section class="section" id="downloads" data-version="${VERSION}">`,
    '  <ul class="dl-list">'
  ];
  SIZE_NAMES.forEach((name, index) => {
    lines.push(
      `    <li class="dl-row" data-os="${SIZE_OS_KEYS[index]}">`,
      `      <a class="dl-file" download href="https://local.hyperclay.com/${name}">${name}</a>`,
      `      <span class="dl-size">${Number(mb[index]).toFixed(1)} MB</span>`,
      '    </li>'
    );
  });
  lines.push('  </ul>', '</section>', '');
  return lines.join('\n');
}

function releaseInfoManifest(sourceSha, mb = MB_NEW) {
  const sizes = {};
  SIZE_NAMES.forEach((name, index) => { sizes[name] = Math.round(mb[index] * 1024 * 1024); });
  return {
    version: VERSION,
    commit: sourceSha,
    date: '2026-10-03T19:04:00.000Z',
    files: SIZE_NAMES.slice(),
    sizes
  };
}

function cleanTailName(name) {
  return name
    .replace(/^\d+\s+/, '')
    .replace(/\.md$/, '')
    .replace(/\s+-\s+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .toLowerCase();
}

function tailBodyOf(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
}

function tailSyncDocs(root) {
  const vaultDir = path.join(root, 'vault/DOCS');
  for (const name of fs.readdirSync(vaultDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const title = name.replace(/^\d+\s+/, '').replace(/\.md$/, '');
    writeWithMode(root, `content/docs/${cleanTailName(name)}.mdx`,
      `---\ntitle: ${title}\npublish: true\n---\n\n${tailBodyOf(fs.readFileSync(path.join(vaultDir, name), 'utf8'))}`);
  }
}

function tailLlmsTxt(root) {
  const docsDir = path.join(root, 'content/docs');
  const blocks = fs.readdirSync(docsDir)
    .filter(name => name.endsWith('.mdx'))
    .sort()
    .map(name => `## ${name.replace(/\.mdx$/, '')}\n\n${tailBodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8'))}`);
  writeWithMode(root, LLMS_PATH, blocks.join('\n---\n\n'));
}

function writeWithMode(root, rel, body, mode) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode === undefined) fs.writeFileSync(file, body);
  else fs.writeFileSync(file, body, { mode });
  return file;
}

function tailOwned(fixture, value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.startsWith(fixture.dir + path.sep);
}

function tailNpm(fixture, cwd, args) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('npm needs an absolute snapshot cwd');
  if (!tailOwned(fixture, cwd)) throw new Error(`npm cwd escaped the owned fixture: ${cwd}`);
  const [sub, script] = args;
  if (sub === 'ci') return '';
  if (sub === 'run' && script === 'sync-docs') { tailSyncDocs(cwd); return ''; }
  if (sub === 'run' && script === 'build:llms-txt') { tailLlmsTxt(cwd); return ''; }
  throw new Error(`unexpected npm command: ${args.join(' ')}`);
}

let tailSeq = 0;

function makeTailFixture({ version = VERSION } = {}) {
  const dir = fs.mkdtempSync(path.join(OWNER, `tail-${++tailSeq}-`));
  const remoteDir = path.join(dir, 'remotes');
  const parentDir = path.join(dir, 'parent');
  fs.mkdirSync(remoteDir);
  fs.mkdirSync(parentDir);
  const bare = (name) => {
    const target = path.join(remoteDir, name);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', target]);
    return target;
  };
  const desktopBare = bare(`${REPO_NAME}.git`);
  const siblingBares = new Map();
  for (const repo of DOC_REPOS) siblingBares.set(repo, bare(`${repo}.git`));

  const repo = path.join(parentDir, REPO_NAME);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', ORIGIN]);
  writeWithMode(repo, 'package.json', packageFixture(version));
  writeWithMode(repo, 'README.md', sizedReadme(MB_OLD));
  writeWithMode(repo, 'website/index.html', sizedWebsite(MB_OLD));
  writeWithMode(repo, 'website/wrangler.jsonc', WEBSITE_CONFIG);
  writeWithMode(repo, 'website/.assetsignore', WEBSITE_IGNORE);
  writeWithMode(repo, 'website/assets/app-popover.png', BINARY_PNG);
  writeWithMode(repo, 'website/assets/open graph image.png', BINARY_FONT);
  writeWithMode(repo, 'website/assets/deep/nested/leaf.txt', 'leaf\n');
  writeWithMode(repo, 'website/fonts/DepartureMono-1.500/LICENSE', 'license\n');
  writeWithMode(repo, 'website/scripts/serve.sh', '#!/bin/sh\nexit 0\n', 0o755);
  writeWithMode(repo, 'src/app.js', 'module.exports = {};\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'release source']);
  const sourceSha = git(repo, ['rev-parse', 'HEAD']).trim();
  git(repo, ['push', '-q', desktopBare, 'main']);

  const siblingRoots = new Map();
  for (const repo of DOC_REPOS) {
    const root = path.join(parentDir, repo);
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['remote', 'add', 'origin', siblingBares.get(repo)]);
    if (repo === 'hyperclay') {
      writeWithMode(root, 'README.md', 'hyperclay readme\n');
      writeWithMode(root, EDGE_PATH, edgeBody(OLD_VERSION));
    } else {
      writeWithMode(root, VAULT_PATH, vaultBody(OLD_VERSION));
      writeWithMode(root, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
      writeWithMode(root, 'package.json', `${JSON.stringify({
        name: 'hyperclay-website',
        version: '0.0.0',
        scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
      }, null, 2)}\n`);
      tailSyncDocs(root);
      tailLlmsTxt(root);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'fixture']);
    git(root, ['push', '-q', 'origin', 'main']);
    siblingRoots.set(repo, root);
  }

  const cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(dir, 'cache-')));
  const cacheRoot = path.join(cacheBase, 'releases');
  const identity = resolveRepoIdentity(repo, { readGit: createLocalGitReader().readGit, fs });
  const paths = statePaths(identity, { cacheRoot, fs });
  let clockMs = TAIL_WALL0;
  let uuidCount = 0;
  const fixture = {
    dir, remoteDir, parentDir, repo, desktopBare, siblingBares, siblingRoots,
    cacheBase, cacheRoot, identity, repoDir: paths.repoDir, sourceSha,
    manifest: releaseInfoManifest(sourceSha),
    deployStatuses: [],
    deployReports: [],
    now: () => { clockMs += 1000; return clockMs; },
    wallNow: () => { clockMs += 1000; return clockMs; },
    randomUUID: () => {
      uuidCount += 1;
      return `00000000-0000-4000-8000-${uuidCount.toString(16).padStart(12, '0')}`;
    }
  };
  fixture.evidenceRoot = path.join(fixture.repoDir, 'records', RELEASE_ID);
  fixture.proofFile = path.join(fixture.evidenceRoot, 'artifacts',
    publicationAttemptDirectoryName(ATTEMPT_ID), 'publication.json');
  return fixture;
}

function tailManifestResponse(bytes) {
  let index = 0;
  const chunks = [bytes];
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      getReader() {
        return {
          read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }),
          cancel: async () => {}
        };
      }
    }
  };
}

function tailRun(fixture, log, overrides) {
  return (command, args, options = {}) => {
    log.run.push({ command, args: args.slice(), cwd: options.cwd });
    if (typeof overrides.onRun === 'function') {
      const injected = overrides.onRun(command, args, options);
      if (injected !== undefined) return injected;
    }
    if (command === 'npm') return tailNpm(fixture, options.cwd, args);
    if (command !== 'git' && command !== 'tar') {
      throw new Error(`acting must not run ${command}`);
    }
    for (const value of args) {
      if (typeof value === 'string' && path.isAbsolute(value) && !tailOwned(fixture, value)) {
        throw new Error(`${command} argument escaped the owned fixture: ${value}`);
      }
    }
    if (options.cwd !== undefined && !tailOwned(fixture, options.cwd)) {
      throw new Error(`${command} ran outside the owned fixture: ${options.cwd}`);
    }
    return execFileCaptured(command, args, { ...options, echoStdout: false, env: { ...GIT_ENV, ...(options.env || {}) } });
  };
}

function tailSpawn(fixture, log) {
  return (command, args, options = {}) => {
    log.spawn.push({ command, args: args.slice(), cwd: options.cwd });
    if (command !== 'git') throw new Error(`acting must not spawn ${command}`);
    for (const value of args) {
      if (typeof value === 'string' && path.isAbsolute(value) && !tailOwned(fixture, value)) {
        throw new Error(`${command} argument escaped the owned fixture: ${value}`);
      }
    }
    if (options.cwd !== undefined && !tailOwned(fixture, options.cwd)) {
      throw new Error(`${command} ran outside the owned fixture: ${options.cwd}`);
    }
    return childProcess.spawnSync(command, args, { ...options, env: { ...GIT_ENV, ...(options.env || {}) } });
  };
}

function tailHarness(fixture, overrides = {}) {
  const log = {
    run: [], spawn: [], remote: [], ferry: [], gates: [], installs: [], deploy: [],
    deployChecks: [], provider: [], preflight: [], bumps: [], routes: [], manifests: []
  };
  const state = { routes: overrides.routes === undefined ? [] : overrides.routes, manifestBytes: null };
  const harness = {
    log,
    fixture,
    state,
    routes(routes) { state.routes = routes; return harness; },
    manifest(bytes) { state.manifestBytes = bytes; return harness; },
    supplied: {}
  };
  const route = (args) => {
    const method = args[4];
    const endpoint = args[10];
    for (const candidate of state.routes) {
      if (candidate.method !== method) continue;
      const matched = typeof candidate.match === 'string' ? endpoint.startsWith(candidate.match) : candidate.match.test(endpoint);
      if (matched) return typeof candidate.reply === 'function' ? candidate.reply(args, endpoint) : candidate.reply;
    }
    throw new Error(`unexpected gh call ${method} ${endpoint}`);
  };
  const run = tailRun(fixture, log, overrides);
  const spawn = tailSpawn(fixture, log);
  const spawnRemote = (command, args, options = {}) => {
    if (command !== 'git') throw new Error(`unexpected remote transport: ${command}`);
    if (!Array.isArray(args) || !['ls-remote', 'push', 'fetch'].includes(args[0])) {
      throw new Error(`unexpected remote verb: ${args && args.join(' ')}`);
    }
    const tokens = args.filter((value) => value === ORIGIN);
    if (tokens.length > 1) throw new Error('the desktop origin token appeared more than once');
    const mapped = args.map((value) => (value === ORIGIN ? fixture.desktopBare : value));
    const destinations = mapped.filter((value) => typeof value === 'string'
      && (path.isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith('git@')));
    for (const destination of destinations) {
      if (!tailOwned(fixture, destination)) throw new Error(`remote destination is not owned: ${destination}`);
    }
    if (options.cwd !== undefined && !tailOwned(fixture, options.cwd)) {
      throw new Error(`remote transport ran outside the owned fixture: ${options.cwd}`);
    }
    log.remote.push({ args: mapped.slice(), original: args.slice(), cwd: options.cwd });
    if (typeof overrides.onRemote === 'function') {
      const injected = overrides.onRemote(mapped, options, args);
      if (injected !== undefined) return injected;
    }
    return childProcess.spawnSync(command, mapped, { ...options, env: GIT_ENV });
  };
  const providerRun = (file, args, options = {}) => {
    if (file === 'git') {
      if (!(args[0] === 'ls-remote' && args[1] === '--exit-code' && args[2] === 'origin')) {
        throw new Error(`unexpected provider git call ${args.join(' ')}`);
      }
      if (options.cwd !== fixture.repo) throw new Error('provider git call escaped its owned checkout');
      log.preflight.push(args.slice());
      return childProcess.spawnSync(file, args.map((value) => (value === 'origin' ? fixture.desktopBare : value)),
        { ...options, env: GIT_ENV });
    }
    if (file !== 'gh') throw new Error(`unexpected executable ${file}`);
    log.provider.push({ args: args.slice(), options });
    return route(args, options);
  };
  const deploy = overrides.deploy === undefined ? (deployDir) => {
    log.deploy.push(deployDir);
    let attempt = null;
    try {
      attempt = readSiteAttempt({ state: readLaneOf(fixture), repoDir: fixture.repoDir },
        { run: createLocalGitReader().run, spawn: createLocalGitReader().spawn, fs }).descriptor;
    } catch (error) {
      attempt = { error };
    }
    log.deployChecks.push(attempt);
    const status = fixture.deployStatuses.length > 0 ? fixture.deployStatuses.shift() : 0;
    const report = path.join(fixture.dir, `deploy-report-${log.deploy.length}.json`);
    fixture.deployReports.push(report);
    childProcess.execFileSync(process.execPath, [DEPLOY_CHILD, report, String(status)], {
      cwd: deployDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV
    });
    return undefined;
  } : overrides.deploy;

  harness.supplied = {
    run,
    spawn,
    spawnRemote,
    providerRun,
    manifestFetch: (url, options) => {
      if (state.manifestBytes === null) throw new Error(`unexpected release-info fetch ${url}`);
      log.manifests.push(url);
      return Promise.resolve(tailManifestResponse(state.manifestBytes));
    },
    wallNow: overrides.wallNow === undefined ? fixture.wallNow : overrides.wallNow,
    now: overrides.now === undefined ? fixture.now : overrides.now,
    randomUUID: overrides.randomUUID === undefined ? fixture.randomUUID : overrides.randomUUID,
    newBuildGates: async (input) => { log.gates.push(input); },
    withFerryRepoLock: async (root, callback, options) => {
      log.ferry.push({ root, options });
      return withNativeFerryRepoLock(root, callback);
    },
    ferryOptions: {},
    log: (message) => { log.bumps.push(String(message)); },
    sleep: async () => {},
    deploy
  };
  if (overrides.chooseBump !== undefined) harness.supplied.chooseBump = overrides.chooseBump;
  if (overrides.install !== undefined) harness.supplied.install = overrides.install;
  if (overrides.fs !== undefined) harness.supplied.fs = overrides.fs;
  if (overrides.ferry !== undefined) harness.supplied.withFerryRepoLock = overrides.ferry;
  if (overrides.deploy === null) delete harness.supplied.deploy;
  return harness;
}

function readLaneOf(fixture, mode = 'publish') {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, mode, fs });
}

function tailRelease(fixture, overrides, harness) {
  return runRelease({ repoRoot: fixture.repo, cacheRoot: fixture.cacheRoot, flags: flagsFor(overrides) }, harness.supplied);
}

function snapshotTree(root) {
  const entries = [];
  const walk = (dir) => {
    const stat = fs.lstatSync(dir);
    entries.push({ rel: path.relative(root, dir), type: 'dir', mode: stat.mode & 0o777 });
    for (const name of fs.readdirSync(dir).sort()) {
      const child = path.join(dir, name);
      const childStat = fs.lstatSync(child);
      const rel = path.relative(root, child);
      if (childStat.isSymbolicLink()) {
        throw new Error('Snapshot fixtures require ordinary files and directories');
      } else if (childStat.isDirectory()) {
        walk(child);
      } else {
        entries.push({ rel, type: 'file', mode: childStat.mode & 0o777, bytes: fs.readFileSync(child) });
      }
    }
  };
  walk(root);
  return entries;
}

function restoreTree(root, entries) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const entry of entries) {
    const target = entry.rel === '' ? root : path.join(root, entry.rel);
    if (entry.type === 'dir') {
      fs.mkdirSync(target, { recursive: true, mode: entry.mode });
      fs.chmodSync(target, entry.mode);
    } else if (entry.type === 'symlink') {
      throw new Error('Snapshot fixtures require ordinary files and directories');
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.bytes, { mode: entry.mode });
    }
  }
}

function tailPublishChain(fixture, { releaseId = RELEASE_ID, attemptId = ATTEMPT_ID, version = VERSION } = {}) {
  const base = createReleaseState({
    releaseId,
    version,
    mode: 'publish',
    at: at(0),
    sourceSha: fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId,
    sourceSha: fixture.sourceSha,
    dispatchRef: `v${version}`
  });
  const ready = transitionRelease(base, { type: 'attempt-ready', at: at(1), attempt }, fixture.identity, { repoDir: fixture.repoDir });
  const requested = transitionRelease(ready, { type: 'dispatch-requested', at: at(2) }, fixture.identity, { repoDir: fixture.repoDir });
  const observed = transitionRelease(requested, {
    type: 'run-observed', at: at(3), runId: RUN_ID, runAttempt: 1,
    runStatus: 'completed', conclusion: 'success'
  }, fixture.identity, { repoDir: fixture.repoDir });
  return [base, ready, requested, observed];
}

function tailPublishState(fixture, options) {
  const chain = tailPublishChain(fixture, options);
  return chain[chain.length - 1];
}

function tailObservationRoutes(fixture, { attemptId = ATTEMPT_ID, version = VERSION, runId = RUN_ID, jobs } = {}) {
  const repo = REPO;
  return [
    {
      method: 'GET',
      match: new RegExp(`^repos/${repo}/actions/runs/${runId}$`),
      reply: ghOk(runBody({ attemptId, sourceSha: fixture.sourceSha, mode: 'publish', version, runId }))
    },
    {
      method: 'GET',
      match: `repos/${repo}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=1`,
      reply: ghOk(jobs === undefined
        ? { total_count: 2, jobs: [{ id: 4241, name: 'build', status: 'completed', conclusion: 'success' },
          { id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' }] }
        : jobs)
    }
  ];
}

let completedTailBaseline = null;
async function getCompletedTailBaseline() {
  if (completedTailBaseline !== null) return completedTailBaseline;
  const fixture = makeTailFixture();
  const harness = tailHarness(fixture);
  putChain(fixture, tailPublishChain(fixture));
  harness.routes(tailObservationRoutes(fixture));
  harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
  harness.supplied.install = async version => { harness.log.installs.push(version); };
  const result = await tailRelease(fixture, {}, harness);
  expect(result.outcome).toBe('complete');
  expect(FERRY_CHILDREN.size).toBe(0);
  completedTailBaseline = { fixture, harness, result, tree: snapshotTree(fixture.dir) };
  return completedTailBaseline;
}

let pendingTailBaseline = null;
async function getPendingTailBaseline() {
  if (pendingTailBaseline !== null) return pendingTailBaseline;
  const fixture = makeTailFixture();
  let injected = false;
  let proofBeforeAction = null;
  const harness = tailHarness(fixture, {
    onRun: () => {
      if (proofBeforeAction === null) {
        const state = readLaneOf(fixture);
        expect(state.phase).toBe('tail');
        expect(state.artifacts.state).toBe('complete');
        proofBeforeAction = readPublicationEvidence({ state, repoDir: fixture.repoDir },
          { run: createLocalGitReader().run, fs });
        expect(proofBeforeAction.sourceSha).toBe(fixture.sourceSha);
      }
      return undefined;
    },
    onRemote: mapped => {
      if (!injected && mapped[0] === 'ls-remote' && mapped.includes(fixture.desktopBare)) {
        injected = true;
        return { status: 1, signal: null, stdout: '', stderr: 'offline fixture transport\n' };
      }
      return undefined;
    },
  });
  putChain(fixture, tailPublishChain(fixture));
  harness.routes(tailObservationRoutes(fixture));
  harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
  const result = await tailRelease(fixture, {}, harness);
  expect(injected).toBe(true);
  expect(proofBeforeAction).not.toBeNull();
  expect(result.outcome).toBe('pending');
  expect(result.error.code).toBe('DOCS_REMOTE_UNREADABLE');
  expect(result.state.phase).toBe('tail');
  expect(result.state.sizes.state).toBe('pending-push');
  expect(result.state.sizes.commit).not.toBeNull();
  expect(result.state.site.state).toBe('pending');
  expect(result.state.site.attemptId).toBeNull();
  expect(harness.log.deploy).toEqual([]);
  expect(FERRY_CHILDREN.size).toBe(0);
  expect(readLaneOf(fixture)).toEqual(result.state);
  for (const repo of DOC_REPOS) {
    const target = result.state.docs[repo];
    expect(target.state).toBe('complete');
    expect(target.journalFile).not.toBeNull();
    expect(target.commit).not.toBeNull();
    readCompletedTargetEvidence({
      journalFile: target.journalFile,
      evidenceRoot: fixture.evidenceRoot,
      repo,
      version: VERSION,
      commit: target.commit
    }, { run: createLocalGitReader().run, spawn: createLocalGitReader().spawn, fs });
  }
  pendingTailBaseline = { fixture, harness, result, proofBeforeAction, tree: snapshotTree(fixture.dir) };
  return pendingTailBaseline;
}

function assertNoHistoricalActions(harness) {
  for (const key of ['run', 'spawn', 'remote', 'ferry', 'gates', 'installs', 'deploy',
    'provider', 'preflight', 'manifests']) {
    expect(harness.log[key]).toEqual([]);
  }
}

describePosix('caller publication and history', () => {
  testPosix('caller publication and history: one actual publish run completes through publication, sizes, site and both documentation producers', async () => {
    const { fixture, harness, result } = await getCompletedTailBaseline();

    expect(result.outcome).toBe('complete');
    const lane = readLaneOf(fixture);
    expect(lane.phase).toBe('complete');
    expect(lane.artifacts.state).toBe('complete');
    expect(lane.sizes.state).toBe('complete');
    expect(lane.site.state).toBe('complete');
    expect(lane.docs.hyperclay.state).toBe('complete');
    expect(lane.docs['hyperclay-website'].state).toBe('complete');
    expect(harness.log.deploy).toHaveLength(1);
    expect(harness.log.installs).toEqual([VERSION]);
  }, 900000);

  testPosix('caller publication and history: historical completion ignores later HEAD and working README changes', async () => {
    const baseline = await getCompletedTailBaseline();
    const { fixture } = baseline;
    try {
      for (const flags of [{ resume: true }, { reconcileOnly: true }]) {
        restoreTree(fixture.dir, baseline.tree);
        writeWithMode(fixture.repo, 'later.txt', 'later unrelated work\n');
        git(fixture.repo, ['add', '--', 'later.txt']);
        git(fixture.repo, ['commit', '-q', '-m', 'later unrelated work']);
        fs.appendFileSync(path.join(fixture.repo, 'README.md'), '\nUncommitted reader note.\n');
        expect(git(fixture.repo, ['rev-parse', 'HEAD']).trim()).not.toBe(baseline.result.state.sourceSha);
        const readme = fs.readFileSync(path.join(fixture.repo, 'README.md'));
        const before = readLaneOf(fixture);
        const harness = tailHarness(fixture, {
          install: async version => { harness.log.installs.push(version); throw new Error('unexpected install'); },
          chooseBump: async () => { throw new Error('unexpected version advice'); },
        });
        const result = await tailRelease(fixture, flags, harness);
        expect(result.outcome).toBe('complete');
        expect(result.state).toEqual(before);
        expect(readLaneOf(fixture)).toEqual(before);
        expect(fs.readFileSync(path.join(fixture.repo, 'README.md'))).toEqual(readme);
        assertNoHistoricalActions(harness);
      }
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: retained proof refusal precedes all acting or provider work', async () => {
    const baseline = await getCompletedTailBaseline();
    const { fixture } = baseline;
    try {
      for (const mutation of ['missing', 'invalid-json']) {
        restoreTree(fixture.dir, baseline.tree);
        const before = readLaneOf(fixture);
        expect(fs.statSync(fixture.proofFile).isFile()).toBe(true);
        expect(fs.statSync(fixture.proofFile).size).toBeGreaterThan(0);
        const verified = readPublicationEvidence({ state: before, repoDir: fixture.repoDir },
          { run: createLocalGitReader().run, fs });
        expect(verified.sourceSha).toBe(before.sourceSha);
        if (mutation === 'missing') fs.unlinkSync(fixture.proofFile);
        else fs.writeFileSync(fixture.proofFile, '{');
        const harness = tailHarness(fixture);
        const error = await refusal(tailRelease(fixture, { resume: true }, harness));
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('PUBLICATION_EVIDENCE_INVALID');
        expect(error.message).toBe(mutation === 'missing'
          ? 'retained publication proof is missing'
          : 'retained publication proof is not valid JSON');
        expect(readLaneOf(fixture)).toEqual(before);
        assertNoHistoricalActions(harness);
      }
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: snapshots restore ordinary bytes and modes', () => {
    const root = fs.mkdtempSync(path.join(OWNER, 'snapshot-proof-'));
    fs.chmodSync(root, 0o700);
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested, { mode: 0o750 });
    fs.chmodSync(nested, 0o750);
    const file = path.join(nested, 'bytes.bin');
    const bytes = Buffer.from([0, 1, 127, 128, 255]);
    fs.writeFileSync(file, bytes, { mode: 0o640 });
    fs.chmodSync(file, 0o640);
    const original = snapshotTree(root);
    expect(original).toHaveLength(3);
    expect(original.filter(entry => entry.type === 'file')).toHaveLength(1);
    fs.chmodSync(root, 0o755);
    fs.chmodSync(nested, 0o700);
    fs.writeFileSync(file, 'changed');
    restoreTree(root, original);
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(nested).mode & 0o777).toBe(0o750);
    expect(fs.statSync(file).mode & 0o777).toBe(0o640);
    expect(fs.readFileSync(file)).toEqual(bytes);
    expect(snapshotTree(root)).toEqual(original);
    fs.symlinkSync('bytes.bin', path.join(nested, 'link'));
    expect(() => snapshotTree(root)).toThrow('Snapshot fixtures require ordinary files and directories');
  });

  testPosix('caller publication and history: pending sizes retain publication proof and independent docs', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture, harness, result, proofBeforeAction } = baseline;

    expect(proofBeforeAction.sourceSha).toBe(fixture.sourceSha);
    expect(result.state.artifacts.state).toBe('complete');
    expect(result.state.releaseId).toBe(RELEASE_ID);
    expect(result.state.sourceSha).toBe(fixture.sourceSha);
    expect(result.state.version).toBe(VERSION);
    expect(result.state.sizes.state).toBe('pending-push');
    expect(result.state.sizes.reason.code).toBe('DOCS_REMOTE_UNREADABLE');
    for (const repo of DOC_REPOS) {
      expect(result.state.docs[repo].state).toBe('complete');
      expect(result.state.docs[repo].journalFile).not.toBeNull();
      expect(result.state.docs[repo].commit).not.toBeNull();
    }
    expect(result.state.site.state).toBe('pending');
    expect(result.state.site.attemptId).toBeNull();
    expect(harness.log.deploy).toEqual([]);
    expect(harness.log.installs).toEqual([]);
    expect(harness.log.gates).toEqual([]);
    expect(harness.log.run.length).toBeGreaterThan(0);
    expect(harness.log.ferry.length).toBeGreaterThan(0);

    const lane = readLaneOf(fixture);
    expect(lane).toEqual(result.state);
    expect(fs.statSync(fixture.proofFile).isFile()).toBe(true);
    expect(fs.statSync(fixture.proofFile).size).toBeGreaterThan(0);
    const verified = readPublicationEvidence({ state: lane, repoDir: fixture.repoDir },
      { run: createLocalGitReader().run, fs });
    expect(verified.sourceSha).toBe(fixture.sourceSha);
  }, 900000);

  testPosix('caller publication and history: pending tail resumes without build gates or version advice', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture } = baseline;
    const pending = baseline.result.state;
    const localReads = { run: createLocalGitReader().run, spawn: createLocalGitReader().spawn, fs };
    try {
      restoreTree(fixture.dir, baseline.tree);
      const harness = tailHarness(fixture, {
        chooseBump: async () => { throw new Error('unexpected version advice'); },
        install: async version => {
          const lane = readLaneOf(fixture);
          expect(lane.phase).toBe('complete');
          expect(lane.artifacts.state).toBe('complete');
          readSizeEvidence({ state: lane, repoDir: fixture.repoDir }, localReads);
          readSiteEvidence({ state: lane, repoDir: fixture.repoDir }, localReads);
          for (const repo of DOC_REPOS) {
            expect(lane.docs[repo].state).toBe('complete');
            readCompletedTargetEvidence({
              journalFile: lane.docs[repo].journalFile,
              evidenceRoot: fixture.evidenceRoot,
              repo,
              version: VERSION,
              commit: lane.docs[repo].commit
            }, localReads);
          }
          harness.log.installs.push(version);
        },
      });
      harness.supplied.newBuildGates = async () => { throw new Error('unexpected build gate'); };
      harness.routes(tailObservationRoutes(fixture));
      harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));

      const result = await tailRelease(fixture, { resume: true }, harness);

      expect(result.outcome).toBe('complete');
      expect(result.error).toBeNull();
      expect(result.state.phase).toBe('complete');
      expect(result.state.releaseId).toBe(pending.releaseId);
      expect(result.state.version).toBe(pending.version);
      expect(result.state.sourceSha).toBe(pending.sourceSha);
      expect(result.state.activeAttemptId).toBe(pending.activeAttemptId);
      expect(result.state.attempts).toEqual(pending.attempts);
      expect(result.state.sizes.commit).toBe(pending.sizes.commit);
      expect(result.state.docs).toEqual(pending.docs);
      expect(result.state.install.state).toBe('complete');
      expect(harness.log.installs).toEqual([VERSION]);
      expect(harness.log.gates).toEqual([]);
      expect(harness.log.deploy).toHaveLength(1);

      const settled = readLaneOf(fixture);
      expect(settled).toEqual(result.state);

      const again = tailHarness(fixture, {
        chooseBump: async () => { throw new Error('unexpected version advice'); },
        install: async version => { again.log.installs.push(version); throw new Error('unexpected install'); },
      });
      again.supplied.newBuildGates = async () => { throw new Error('unexpected build gate'); };
      const resumed = await tailRelease(fixture, { resume: true }, again);

      expect(resumed.outcome).toBe('complete');
      expect(resumed.state).toEqual(settled);
      expect(readLaneOf(fixture)).toEqual(settled);
      assertNoHistoricalActions(again);
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: higher planned version waits for a later invocation', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture } = baseline;
    try {
      restoreTree(fixture.dir, baseline.tree);
      const first = tailHarness(fixture, {
        chooseBump: async () => { throw new Error('unexpected version advice'); },
      });
      first.routes(tailObservationRoutes(fixture));
      first.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
      first.supplied.newBuildGates = async () => { throw new Error('unexpected build gate'); };
      const completed = await tailRelease(fixture, { version: HIGHER_VERSION }, first);
      expect(completed.outcome).toBe('complete');
      expect(completed.deferredVersion).toBe(HIGHER_VERSION);
      expect(completed.state.version).toBe(VERSION);
      expect(completed.state.releaseId).toBe(baseline.result.state.releaseId);
      expect(completed.state.sourceSha).toBe(baseline.result.state.sourceSha);
      expect(completed.state.attempts).toEqual(baseline.result.state.attempts);
      expect(completed.state.versionIntent).toBeNull();
      expect(JSON.parse(fs.readFileSync(path.join(fixture.repo, 'package.json'), 'utf8')).version).toBe(VERSION);
      expect(first.log.gates).toEqual([]);
      expect(first.log.provider.every(call => call.args[4] === 'GET')).toBe(true);
      expect(first.log.bumps).toContain(`Finishing v${VERSION}; v${HIGHER_VERSION} remains deferred until a later invocation`);
      const stop = new Error('fixture stop after durable higher version intent');
      let interrupted = false;
      const later = tailHarness(fixture, {
        onRun: () => {
          if (readLaneOf(fixture).phase === 'version-preparing') {
            interrupted = true;
            throw stop;
          }
          return undefined;
        },
        chooseBump: async () => { throw new Error('unexpected version advice'); },
      });
      const error = await refusal(tailRelease(fixture, { version: HIGHER_VERSION }, later));
      expect(interrupted).toBe(true);
      const causes = [];
      for (let current = error; current && !causes.includes(current); current = current.cause) causes.push(current);
      expect(causes).toContain(stop);
      const intent = readLaneOf(fixture);
      expect(intent.phase).toBe('version-preparing');
      expect(intent.version).toBe(HIGHER_VERSION);
      expect(intent.versionIntent.previousVersion).toBe(VERSION);
      expect(intent.releaseId).not.toBe(completed.state.releaseId);
      expect(intent.sourceSha).toBeNull();
      expect(intent.activeAttemptId).toBeNull();
      expect(intent.attempts).toEqual([]);
      expect(later.log.gates).toHaveLength(1);
      expect(later.log.gates[0].kind).toBe('fresh');
      expect(later.log.provider).toEqual([]);
      expect(later.log.deploy).toEqual([]);
      expect(later.log.installs).toEqual([]);
      expect(FERRY_CHILDREN.size).toBe(0);
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: absent lane adopts a proven legacy release without a version bump', async () => {
    const fixture = makeTailFixture();
    expect(readLaneOf(fixture)).toBeNull();
    expect(git(fixture.repo, ['tag', '--list']).trim()).toBe('');
    const row = {
      id: RUN_ID,
      display_title: `release v${VERSION} publish sha=${fixture.sourceSha}`,
      repository: { full_name: REPO },
      workflow_id: WORKFLOW_ID,
      event: 'workflow_dispatch',
      head_sha: fixture.sourceSha,
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-10-03T19:01:00.000Z',
      updated_at: '2026-10-03T19:05:00.000Z',
      html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
    };
    const harness = tailHarness(fixture, {
      chooseBump: async () => { throw new Error('unexpected version advice'); },
      install: async version => {
        expect(readLaneOf(fixture).phase).toBe('complete');
        harness.log.installs.push(version);
      },
    });
    harness.supplied.newBuildGates = async () => { throw new Error('unexpected build gate'); };
    harness.routes([
      { method: 'GET', match: new RegExp(`^repos/${REPO}/actions/workflows/release\\.yml$`),
        reply: ghOk({ id: WORKFLOW_ID, path: WORKFLOW_PATH }) },
      { method: 'GET', match: `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100&page=1`,
        reply: ghOk({ total_count: 1, workflow_runs: [row] }) },
      { method: 'GET', match: new RegExp(`^repos/${REPO}/actions/runs/${RUN_ID}$`), reply: ghOk(row) },
      { method: 'GET', match: `repos/${REPO}/actions/runs/${RUN_ID}/attempts/2/jobs?per_page=100&page=1`,
        reply: ghOk({ total_count: 2, jobs: [
          { id: 4241, name: 'build', status: 'completed', conclusion: 'success' },
          { id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' },
        ] }) },
    ]);
    harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
    const result = await tailRelease(fixture, {}, harness);
    expect(result.outcome).toBe('complete');
    expect(result.error).toBeNull();
    expect(result.deferredVersion).toBeNull();
    expect(result.state.version).toBe(VERSION);
    expect(result.state.sourceSha).toBe(fixture.sourceSha);
    expect(result.state.versionIntent).toBeNull();
    expect(result.state.attempts).toHaveLength(1);
    const attempt = result.state.attempts[0];
    expect(attempt.id).toBe(`legacy:${RUN_ID}:2`);
    expect(attempt.identityKind).toBe('legacy-upload-proof');
    expect(attempt.legacyProof.uploadJobId).toBe(UPLOAD_JOB_ID);
    expect(result.state.activeAttemptId).toBe(attempt.id);
    expect(readLaneOf(fixture)).toEqual(result.state);
    expect(result.state.artifacts.state).toBe('complete');
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.site.state).toBe('complete');
    for (const repo of DOC_REPOS) expect(result.state.docs[repo].state).toBe('complete');
    const proof = readPublicationEvidence({ state: result.state, repoDir: fixture.repoDir },
      { run: createLocalGitReader().run, fs });
    expect(proof.sourceSha).toBe(fixture.sourceSha);
    expect(JSON.parse(fs.readFileSync(path.join(fixture.repo, 'package.json'), 'utf8')).version).toBe(VERSION);
    expect(git(fixture.repo, ['tag', '--list']).trim()).toBe('');
    expect(harness.log.provider.length).toBeGreaterThan(0);
    expect(harness.log.provider.every(call => call.args[4] === 'GET')).toBe(true);
    expect(harness.log.gates).toEqual([]);
    expect(harness.log.bumps).toEqual([]);
    expect(harness.log.deploy).toHaveLength(1);
    expect(harness.log.installs).toEqual([VERSION]);
    expect(FERRY_CHILDREN.size).toBe(0);
  }, 900000);

  testPosix('caller publication and history: unknown site requires explicit retry of a new attempt', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture } = baseline;
    const observe = () => {
      const harness = tailHarness(fixture);
      harness.routes(tailObservationRoutes(fixture));
      harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
      harness.supplied.newBuildGates = async () => { throw new Error('unexpected build gate'); };
      return harness;
    };
    try {
      restoreTree(fixture.dir, baseline.tree);
      fixture.deployStatuses = [1];
      const first = observe();
      const unresolved = await tailRelease(fixture, { resume: true }, first);
      expect(unresolved.outcome).toBe('pending');
      expect(unresolved.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
      expect(unresolved.state.phase).toBe('tail');
      expect(unresolved.state.sizes.state).toBe('complete');
      expect(unresolved.state.site.state).toBe('unknown');
      expect(unresolved.state.site.receiptSha).toBeNull();
      expect(first.log.deploy).toHaveLength(1);
      const firstAttempt = unresolved.state.site.attemptId;
      expect(firstAttempt).not.toBeNull();
      const noRetry = observe();
      const pending = await tailRelease(fixture, { resume: true }, noRetry);
      expect(pending.outcome).toBe('pending');
      expect(pending.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
      expect(pending.state).toEqual(unresolved.state);
      expect(noRetry.log.deploy).toEqual([]);
      expect(fs.existsSync(path.join(fixture.repo, '.deploy'))).toBe(false);
      const retry = observe();
      const completed = await tailRelease(fixture, { resume: true, retrySite: true }, retry);
      expect(completed.outcome).toBe('complete');
      expect(completed.error).toBeNull();
      expect(completed.state.site.state).toBe('complete');
      expect(completed.state.site.attemptId).not.toBe(firstAttempt);
      expect(retry.log.deploy).toHaveLength(1);
      expect(completed.state.version).toBe(unresolved.state.version);
      expect(completed.state.sourceSha).toBe(unresolved.state.sourceSha);
      expect(completed.state.releaseId).toBe(unresolved.state.releaseId);
      expect(completed.state.attempts).toEqual(unresolved.state.attempts);
      expect(completed.state.sizes.commit).toBe(unresolved.state.sizes.commit);
      expect(completed.state.docs).toEqual(unresolved.state.docs);
      expect(readLaneOf(fixture)).toEqual(completed.state);
      const verified = readSiteEvidence({ state: completed.state, repoDir: fixture.repoDir },
        { run: createLocalGitReader().run, spawn: createLocalGitReader().spawn, fs });
      expect(verified.attemptId).toBe(completed.state.site.attemptId);
      expect(first.log.gates).toEqual([]);
      expect(noRetry.log.gates).toEqual([]);
      expect(retry.log.gates).toEqual([]);
    } finally {
      fixture.deployStatuses = [];
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: failed local install preserves durable completion', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture } = baseline;
    try {
      restoreTree(fixture.dir, baseline.tree);
      const harness = tailHarness(fixture, {
        install: async version => {
          expect(readLaneOf(fixture).phase).toBe('complete');
          harness.log.installs.push(version);
          throw new Error('fixture local installer failed');
        },
      });
      harness.routes(tailObservationRoutes(fixture));
      harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
      const result = await tailRelease(fixture, { resume: true }, harness);
      expect(result.outcome).toBe('complete');
      expect(result.error).toBeNull();
      expect(result.state.phase).toBe('complete');
      expect(result.state.install).toEqual({ state: 'failed', error: {
        code: 'LOCAL_INSTALL_FAILED', message: 'fixture local installer failed',
      } });
      expect(readLaneOf(fixture)).toEqual(result.state);
      expect(harness.log.installs).toEqual([VERSION]);
      const again = tailHarness(fixture, {
        install: async version => { again.log.installs.push(version); throw new Error('unexpected retry'); },
      });
      const resumed = await tailRelease(fixture, { resume: true }, again);
      expect(resumed.outcome).toBe('complete');
      expect(resumed.state).toEqual(result.state);
      assertNoHistoricalActions(again);
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);

  testPosix('caller publication and history: install observation storage failure escapes the installer catch', async () => {
    const baseline = await getPendingTailBaseline();
    const { fixture } = baseline;
    try {
      restoreTree(fixture.dir, baseline.tree);
      const stateFile = statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs }).stateFile;
      const injected = Object.assign(new Error('fixture install observation storage failed'), { code: 'EIO' });
      let fired = false;
      const io = new Proxy(fs, {
        get(target, key) {
          if (key === 'renameSync') return (from, to) => {
            if (to === stateFile) {
              const next = JSON.parse(fs.readFileSync(from, 'utf8'));
              if (next.phase === 'complete' && next.install.state === 'complete') {
                fired = true;
                throw injected;
              }
            }
            return target.renameSync(from, to);
          };
          return Reflect.get(target, key);
        },
      });
      const harness = tailHarness(fixture, {
        fs: io,
        install: async version => {
          expect(readLaneOf(fixture).phase).toBe('complete');
          harness.log.installs.push(version);
        },
      });
      harness.routes(tailObservationRoutes(fixture));
      harness.manifest(Buffer.from(JSON.stringify(fixture.manifest), 'utf8'));
      const error = await refusal(tailRelease(fixture, { resume: true }, harness));
      expect(fired).toBe(true);
      expect(error.code).toBe('STATE_IO_FAILED');
      expect(error.cause).toBe(injected);
      expect(harness.log.installs).toEqual([VERSION]);
      const lane = readLaneOf(fixture);
      expect(lane.phase).toBe('complete');
      expect(lane.install).toEqual({ state: 'not-attempted', error: null });
      expect(lane.artifacts.state).toBe('complete');
      expect(lane.sizes.state).toBe('complete');
      expect(lane.site.state).toBe('complete');
      for (const repo of DOC_REPOS) expect(lane.docs[repo].state).toBe('complete');
      expect(FERRY_CHILDREN.size).toBe(0);
    } finally {
      restoreTree(fixture.dir, baseline.tree);
    }
  }, 900000);
});

describePosix('caller explicit repair', () => {
  const DEFINITION_ENDPOINT = `repos/${REPO}/actions/workflows/release.yml`;
  const WORKFLOW_ENDPOINT = `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`;
  const OLD_RUN_ENDPOINT = `repos/${REPO}/actions/runs/${RUN_ID}`;
  const NEW_RUN_ENDPOINT = `repos/${REPO}/actions/runs/${NEW_RUN_ID}`;
  const DISPATCH_ENDPOINT = `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`;
  const LEGACY_HISTORY_ENDPOINT = `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100&page=1`;

  function modernFailureRun(fixture) {
    return runBody({
      attemptId: ATTEMPT_ID,
      sourceSha: fixture.sourceSha,
      mode: 'publish',
      version: VERSION,
      conclusion: 'failure'
    });
  }

  function pendingRepairRun(sourceSha, attemptId = REPAIR_ATTEMPT_ID) {
    return runBody({
      attemptId,
      sourceSha,
      mode: 'publish',
      version: VERSION,
      runId: NEW_RUN_ID,
      status: 'in_progress'
    });
  }

  function repairRoutes({ fixture, repairedSourceSha, oldRun = modernFailureRun(fixture),
    onReady, onPost, legacy = false }) {
    let repairReads = 0;
    const routes = [
      { method: 'GET', match: DEFINITION_ENDPOINT, reply: ghOk(definitionBody()) },
      { method: 'GET', match: OLD_RUN_ENDPOINT, reply: ghOk(oldRun) }
    ];
    if (legacy) {
      routes.splice(1, 0, {
        method: 'GET',
        match: LEGACY_HISTORY_ENDPOINT,
        reply: ghOk({ total_count: 1, workflow_runs: [oldRun] })
      });
    }
    routes.push(
      {
        method: 'GET', match: WORKFLOW_ENDPOINT, reply: () => {
          if (onReady) onReady();
          return ghOk(definitionBody());
        }
      },
      {
        method: 'POST', match: DISPATCH_ENDPOINT, reply: () => {
          if (onPost) onPost();
          return postHint(NEW_RUN_ID);
        }
      },
      {
        method: 'GET', match: NEW_RUN_ENDPOINT, reply: () => {
          repairReads += 1;
          return repairReads === 1
            ? ghOk(pendingRepairRun(repairedSourceSha))
            : ghStatus(403);
        }
      }
    );
    return routeGh(routes);
  }

  testPosix('caller explicit repair: modern failure allocates only after gates and persists before one POST', async () => {
    const setup = setupModernRepair();
    const { fixture, failed, repairedSourceSha, originalTag } = setup;
    const originalAttempt = structuredClone(failed.attempts[0]);
    let gateState = null;
    let readyState = null;
    let requestedState = null;
    const harness = makeHarness(fixture, {
      uuids: [REPAIR_ATTEMPT_ID],
      wall: WALL0 + 10 * 60000,
      onGate: () => { gateState = readLane(fixture); },
      onUuid: () => { expect(gateState).not.toBeNull(); }
    });
    harness.supplied.gh = repairRoutes({
      fixture,
      repairedSourceSha,
      onReady: () => { readyState = readLane(fixture); },
      onPost: () => { requestedState = readLane(fixture); }
    });

    const result = await release(fixture, { resume: true, resumeSource: repairedSourceSha }, harness);

    expect(result.outcome).toBe('pending');
    expect(harness.gates).toEqual([{
      kind: 'repair', version: VERSION, sourceSha: repairedSourceSha, skipUiPass: false
    }]);
    expect(gateState.phase).toBe('failed-ci');
    expect(gateState.attempts).toEqual([originalAttempt]);
    expect(readyState.phase).toBe('workflow');
    expect(readyState.activeAttemptId).toBe(REPAIR_ATTEMPT_ID);
    expect(readyState.attempts[1].dispatch).toBe('ready');
    expect(requestedState.phase).toBe('workflow');
    expect(requestedState.activeAttemptId).toBe(REPAIR_ATTEMPT_ID);
    expect(requestedState.attempts[1].dispatch).toBe('requested');
    expect(harness.posts()).toHaveLength(1);
    expect(JSON.parse(harness.posts()[0].options.input)).toEqual({
      ref: 'main',
      inputs: {
        version: VERSION,
        dry_run: false,
        source_sha: repairedSourceSha,
        attempt_id: REPAIR_ATTEMPT_ID
      }
    });
    expect(result.state.phase).toBe('unknown');
    expect(result.state.sourceSha).toBe(repairedSourceSha);
    expect(result.state.attempts[0]).toEqual(originalAttempt);
    expect(result.state.attempts[1]).toMatchObject({
      id: REPAIR_ATTEMPT_ID,
      sourceSha: repairedSourceSha,
      dispatchRef: 'main',
      dispatch: 'identified',
      runId: NEW_RUN_ID,
      runStatus: 'in_progress',
      conclusion: null
    });
    expect(tagSnapshot(fixture)).toEqual(originalTag);
    expect(harness.uuidCalls).toEqual([REPAIR_ATTEMPT_ID]);
    expect(FERRY_CHILDREN.size).toBe(0);
  });

  testPosix('caller explicit repair: actual legacy importer retains failure proof before one repair POST', async () => {
    const fixture = makeFixture();
    const originalTag = tagOriginalSource(fixture);
    const repairedSourceSha = commitRepairSource(fixture);
    const oldRun = legacyRunBody(fixture);
    let gateState = null;
    let originalAttempt = null;
    let proofPath = null;
    let proofBytes = null;
    let readyState = null;
    let requestedState = null;
    const harness = makeHarness(fixture, {
      uuids: [FRESH_RELEASE_ID, REPAIR_ATTEMPT_ID],
      wall: WALL0 + 10 * 60000,
      onGate: () => {
        gateState = readLane(fixture);
        originalAttempt = structuredClone(gateState.attempts[0]);
        proofPath = failureEvidenceFile(fixture, gateState);
        proofBytes = fs.readFileSync(proofPath);
      },
      onUuid: (value, index) => {
        if (index === 1) expect(gateState).not.toBeNull();
      }
    });
    harness.supplied.gh = repairRoutes({
      fixture,
      repairedSourceSha,
      oldRun,
      legacy: true,
      onReady: () => { readyState = readLane(fixture); },
      onPost: () => { requestedState = readLane(fixture); }
    });

    const result = await release(fixture, { resume: true, resumeSource: repairedSourceSha }, harness);

    expect(result.outcome).toBe('pending');
    expect(gateState.phase).toBe('failed-ci');
    expect(gateState.revision).toBe(0);
    expect(gateState.activeAttemptId).toBe(`legacy-failed:${RUN_ID}:2`);
    expect(originalAttempt.identityKind).toBe('legacy-failed-run');
    expect(originalAttempt.legacyFailureProof).toEqual({
      observedHeadSha: fixture.sourceSha,
      observedConclusion: 'failure'
    });
    expect(readyState.attempts[0]).toEqual(originalAttempt);
    expect(readyState.attempts[1].dispatch).toBe('ready');
    expect(requestedState.attempts[1].dispatch).toBe('requested');
    expect(harness.posts()).toHaveLength(1);
    expect(result.state.attempts[0]).toEqual(originalAttempt);
    expect(result.state.attempts[1]).toMatchObject({
      id: REPAIR_ATTEMPT_ID,
      sourceSha: repairedSourceSha,
      dispatch: 'identified',
      runId: NEW_RUN_ID,
      runStatus: 'in_progress'
    });
    expect(fs.readFileSync(proofPath)).toEqual(proofBytes);
    expect(tagSnapshot(fixture)).toEqual(originalTag);
    expect(harness.uuidCalls).toEqual([FRESH_RELEASE_ID, REPAIR_ATTEMPT_ID]);
    const endpoints = harness.ghCalls.map(call => call.args[10]);
    expect(endpoints.filter(endpoint => endpoint === LEGACY_HISTORY_ENDPOINT)).toHaveLength(1);
    expect(endpoints.filter(endpoint => endpoint === OLD_RUN_ENDPOINT)).toHaveLength(2);
    expect(FERRY_CHILDREN.size).toBe(0);
  });

  testPosix('caller explicit repair: every failed gate or binding check proves zero POST', async () => {
    const cases = [
      {
        label: 'different package version',
        setup: () => setupModernRepair({ version: '1.30.0' })
      },
      {
        label: 'identical source',
        setup: () => setupModernRepair({ identical: true })
      },
      {
        label: 'different remote main tip',
        setup: () => setupModernRepair({ push: false })
      },
      {
        label: 'HEAD moves during the build gate',
        setup: () => setupModernRepair(),
        onGate: setup => { commitRepairSource(setup.fixture, { push: false, label: 'gate drift' }); }
      },
      {
        label: 'workflow definition drifts',
        setup: () => setupModernRepair(),
        definition: { id: WORKFLOW_ID + 1, path: WORKFLOW_PATH, state: 'active' }
      },
      {
        label: 'direct failure read is denied',
        setup: () => setupModernRepair(),
        oldReply: ghStatus(403)
      },
      {
        label: 'build gate fails',
        setup: () => setupModernRepair(),
        gateError: Object.assign(new Error('fixture build gate failed'), { code: 'FIXTURE_GATE_FAILED' })
      },
      {
        label: 'repair state persistence fails',
        setup: () => setupModernRepair(),
        storageFailure: true
      }
    ];

    for (const row of cases) {
      const setup = row.setup();
      const { fixture, repairedSourceSha } = setup;
      const harness = makeHarness(fixture, {
        uuids: [REPAIR_ATTEMPT_ID],
        wall: WALL0 + 10 * 60000,
        fs: row.storageFailure ? stalledLaneFs(stateFileOf(fixture)) : undefined,
        onGate: async () => {
          if (row.gateError) throw row.gateError;
          if (row.onGate) row.onGate(setup);
        }
      });
      harness.supplied.gh = routeGh([
        {
          method: 'GET',
          match: OLD_RUN_ENDPOINT,
          reply: row.oldReply || ghOk(modernFailureRun(fixture))
        },
        {
          method: 'GET',
          match: DEFINITION_ENDPOINT,
          reply: ghOk(row.definition || definitionBody())
        }
      ]);

      const error = await refusal(release(fixture, {
        resume: true,
        resumeSource: repairedSourceSha
      }, harness));

      expect({ label: row.label, refused: error !== null }).toEqual({ label: row.label, refused: true });
      expect(harness.posts()).toHaveLength(0);
      expect(readLane(fixture).attempts).toHaveLength(1);
      expect(readLane(fixture).activeAttemptId).toBe(ATTEMPT_ID);
      expect(FERRY_CHILDREN.size).toBe(0);
    }
  });

  testPosix('caller explicit repair: interrupted ready and requested repairs resume the same attempt', async () => {
    for (const interruptedAt of ['ready', 'requested']) {
      const setup = setupModernRepair();
      const { fixture, failed, repairedSourceSha } = setup;
      const attempt = makeWorkflowAttempt({
        state: failed,
        repoDir: fixture.repoDir,
        workflowId: WORKFLOW_ID,
        attemptId: REPAIR_ATTEMPT_ID,
        sourceSha: repairedSourceSha,
        dispatchRef: 'main'
      });
      const ready = transitionRelease(failed, {
        type: 'begin-repair-attempt', at: at(5), previousRunId: RUN_ID, attempt
      }, fixture.identity, { repoDir: fixture.repoDir });
      putOne(fixture, ready, failed.revision);
      if (interruptedAt === 'requested') {
        putOne(fixture, transitionRelease(ready, { type: 'dispatch-requested', at: at(6) },
          fixture.identity, { repoDir: fixture.repoDir }), ready.revision);
      }
      let requestedAtPost = null;
      let repairReads = 0;
      const harness = makeHarness(fixture, { uuids: [], wall: WALL0 + 10 * 60000 });
      const repairRun = pendingRepairRun(repairedSourceSha);
      harness.supplied.gh = routeGh([
        {
          method: 'GET',
          match: new RegExp(`^repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs\\?`),
          reply: ghOk({ total_count: 1, workflow_runs: [repairRun] })
        },
        { method: 'GET', match: WORKFLOW_ENDPOINT, reply: ghOk(definitionBody()) },
        {
          method: 'POST', match: DISPATCH_ENDPOINT, reply: () => {
            requestedAtPost = readLane(fixture);
            return postHint(NEW_RUN_ID);
          }
        },
        {
          method: 'GET', match: NEW_RUN_ENDPOINT, reply: () => {
            repairReads += 1;
            return repairReads === 1 ? ghOk(repairRun) : ghStatus(403);
          }
        }
      ]);

      const result = await release(fixture, { resume: true }, harness);

      expect(result.outcome).toBe('pending');
      expect(result.state.attempts).toHaveLength(2);
      expect(result.state.activeAttemptId).toBe(REPAIR_ATTEMPT_ID);
      expect(result.state.attempts[1].id).toBe(REPAIR_ATTEMPT_ID);
      expect(harness.uuidCalls).toHaveLength(0);
      expect(harness.ghCalls.map(call => call.args[10])).not.toContain(OLD_RUN_ENDPOINT);
      expect(harness.ghCalls.map(call => call.args[10])).not.toContain(LEGACY_HISTORY_ENDPOINT);
      if (interruptedAt === 'ready') {
        expect(harness.posts()).toHaveLength(1);
        expect(requestedAtPost.attempts[1].dispatch).toBe('requested');
        expect(harness.gates).toEqual([{
          kind: 'dispatch', version: VERSION, sourceSha: repairedSourceSha, skipUiPass: false
        }]);
      } else {
        expect(harness.posts()).toHaveLength(0);
        expect(requestedAtPost).toBeNull();
        expect(harness.gates).toHaveLength(0);
      }
      expect(FERRY_CHILDREN.size).toBe(0);
    }
  });

  testPosix('caller explicit repair: successful legacy publication cannot enter failed repair', async () => {
    const fixture = makeFixture();
    tagOriginalSource(fixture);
    const repairedSourceSha = commitRepairSource(fixture);
    const attempt = {
      id: `legacy:${RUN_ID}:2`,
      identityKind: 'legacy-upload-proof',
      version: VERSION,
      mode: 'publish',
      sourceSha: fixture.sourceSha,
      dispatchRef: null,
      workflowPath: WORKFLOW_PATH,
      workflowId: WORKFLOW_ID,
      expectedTitle: null,
      dispatch: 'identified',
      requestedAt: null,
      watchDeadlineAt: null,
      runId: RUN_ID,
      runAttempt: 2,
      runStatus: 'completed',
      conclusion: 'success',
      lastObservedAt: at(4),
      error: null,
      legacyProof: {
        uploadJobId: 789,
        uploadJobConclusion: 'success',
        observedHeadSha: fixture.sourceSha,
        observedMode: 'publish'
      }
    };
    putOne(fixture, createLegacyPublicationState({
      releaseId: RELEASE_ID,
      version: VERSION,
      sourceSha: fixture.sourceSha,
      at: at(4),
      attempt
    }, fixture.identity, { repoDir: fixture.repoDir }), null);
    const harness = makeHarness(fixture, { uuids: [], wall: WALL0 + 10 * 60000 });

    const error = await refusal(release(fixture, {
      resume: true,
      resumeSource: repairedSourceSha
    }, harness));

    expect(error.code).toBe('RELEASE_COORDINATOR_INVALID');
    expect(harness.posts()).toHaveLength(0);
    expect(harness.ghCalls).toHaveLength(0);
    expect(harness.gates).toHaveLength(0);
    expect(readLane(fixture).attempts).toEqual([attempt]);
    expect(FERRY_CHILDREN.size).toBe(0);
  });
});
