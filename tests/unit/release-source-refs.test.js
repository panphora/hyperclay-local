// One recorded desktop release source, its annotated tag and its single push
// destination, verified against real scratch checkouts, real local bare remotes and
// a private release cache outside them. The explicit remote seam maps only the exact
// recorded fixture destination to its owned bare path, so the GitHub-looking origin
// in the scratch config is never contacted.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileCaptured } = require('../../scripts/release-command');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { withReleaseLock } = require('../../scripts/release-lock');
const { ensureSourceRefs } = require('../../scripts/release-source-refs');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createReleaseState, transitionRelease } = require('../../scripts/release-transitions');
const { makeWorkflowAttempt } = require('../../scripts/release-workflow-identity');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(240000);

const VERSION = '1.29.0';
const NEXT_VERSION = '1.30.0';
const TAG_NAME = `v${VERSION}`;
const TAG_REF = `refs/tags/${TAG_NAME}`;
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const SAME_REPO_HTTPS = 'https://github.com/fixture-owner/hyperclay-local.git';
const REPO_NAME = 'hyperclay-local';
const TAG_FORMAT = '--format=%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(refname)';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const REPAIR_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const WORKFLOW_ID = 12345;
const RUN_ID = 456;
const CI_ERROR = { code: 'WORKFLOW_FAILED', message: 'Release workflow concluded failure' };
const TIMES = {
  created: '2026-01-02T00:30:00.000Z',
  ready: '2026-01-02T00:40:00.000Z',
  requested: '2026-01-02T01:00:00.000Z',
  observed: '2026-01-02T01:20:00.000Z',
  verified: '2026-01-02T01:25:00.000Z',
  failed: '2026-01-02T01:30:00.000Z',
  repair: '2026-01-02T01:40:00.000Z'
};

const PURE_ROOT = path.join('/nonexistent', REPO_NAME);
const PURE_COMMON = path.join(PURE_ROOT, '.git');
const PURE_IDENTITY = {
  key: sha256(PURE_COMMON),
  root: PURE_ROOT,
  commonDir: PURE_COMMON,
  branch: 'main',
  remote: 'origin',
  remoteRepo: 'github.com/fixture-owner/hyperclay-local',
  pushUrlSha256: sha256(ORIGIN),
  objectFormat: 'sha1'
};

const TMP_BASE = fs.realpathSync.native(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-source-refs-'));
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
const RESTORE_ENV = new Map();
for (const name of ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_OPTIONAL_LOCKS']) {
  RESTORE_ENV.set(name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : null);
  process.env[name] = GIT_ENV[name];
}

afterAll(() => {
  for (const [name, value] of RESTORE_ENV) {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(OWNER, { recursive: true, force: true });
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

function gitProbe(cwd, args) {
  return childProcess.spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function packageJson(version) {
  return `${JSON.stringify({ name: 'hyperclay-local-electron', version, private: true }, null, 2)}\n`;
}

function listFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.lstatSync(full).isDirectory()) walk(full);
      else found.push(path.relative(root, full));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found.sort();
}

function tagFacts(cwd, tagRef) {
  const probe = gitProbe(cwd, ['for-each-ref', '--count=2', TAG_FORMAT, tagRef]);
  const text = probe.status === 0 ? probe.stdout.trim() : '';
  if (text === '') return null;
  const [objectName, objectType, peeledName, peeledType, refName] = text.split('\t');
  return { objectName, objectType, peeledName, peeledType, refName };
}

function refList(cwd) {
  return git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)']).trim().split('\n').filter((line) => line.length > 0);
}

function annotatedTag(cwd, sha, message) {
  git(cwd, ['-c', 'tag.gpgSign=false', 'tag', '-a', TAG_NAME, sha, '-m', message]);
}

async function outcomeOf(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function remoteRow(oid, ref) {
  return `${oid}\t${ref}\n`;
}

function transportFailure(stderr) {
  return { status: 128, signal: null, stdout: '', stderr };
}

function forbiddenDeps() {
  const refuse = (name) => () => {
    throw new Error(`${name} must not be called`);
  };
  return {
    run: refuse('run'),
    runMutation: refuse('runMutation'),
    spawnRemote: refuse('spawnRemote'),
    withFerryRepoLock: refuse('withFerryRepoLock'),
    assertPublishWindow: refuse('assertPublishWindow'),
    fs
  };
}

let fixtureSeq = 0;

function makeFixture() {
  const owner = fs.mkdtempSync(path.join(OWNER, `fixture-${++fixtureSeq}-`));
  const remoteDir = path.join(owner, 'remotes');
  const parentDir = path.join(owner, 'parent');
  fs.mkdirSync(remoteDir);
  fs.mkdirSync(parentDir);

  const bare = path.join(remoteDir, `${REPO_NAME}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', bare]);

  const repo = path.join(parentDir, REPO_NAME);
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', ORIGIN]);
  write(repo, 'package.json', packageJson(VERSION));
  write(repo, 'README.md', 'hyperclay local\n');
  write(repo, 'src/app.js', 'module.exports = {};\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'release source']);
  const sourceSha = git(repo, ['rev-parse', 'HEAD']).trim();

  write(repo, 'src/app.js', 'module.exports = { repair: true };\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'repair source']);
  const repairSha = git(repo, ['rev-parse', 'HEAD']).trim();

  write(repo, 'package.json', packageJson(NEXT_VERSION));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'later work']);
  const headSha = git(repo, ['rev-parse', 'HEAD']).trim();

  git(repo, ['push', '-q', bare, 'main']);

  const cacheRoot = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(owner, 'cache-'))), 'releases');
  const identity = resolveRepoIdentity(repo, { readGit: createLocalGitReader().readGit, fs });
  const repoDir = statePaths(identity, { cacheRoot, fs }).repoDir;

  return { owner, repo, bare, cacheRoot, repoDir, identity, sourceSha, repairSha, headSha };
}

function makeDeps(fixture, options = {}) {
  const localCalls = [];
  const mutationCalls = [];
  const remoteCalls = [];
  const ferryCalls = [];
  const windowCalls = [];
  const reader = createLocalGitReader();
  const run = (command, args, opts = {}) => {
    localCalls.push([command, ...args]);
    return reader.run(command, args, opts);
  };
  const runMutation = (command, args, opts = {}) => {
    if (command !== 'git' || opts.cwd !== fixture.repo) {
      throw new Error('Fixture mutation escaped its owned Git checkout');
    }
    mutationCalls.push([command, ...args]);
    if (options.mutationHook) {
      const injected = options.mutationHook({ args, opts, calls: mutationCalls });
      if (injected !== undefined) return injected;
    }
    return execFileCaptured(command, args, { ...opts, env: GIT_ENV });
  };
  const spawnRemote = (command, args, spawnOptions = {}) => {
    if (command !== 'git' || !Array.isArray(args) ||
        !['ls-remote', 'push'].includes(args[0]) ||
        args.filter(value => value === ORIGIN).length !== 1 ||
        spawnOptions.cwd !== fixture.repo) {
      throw new Error('Fixture remote command must use the exact owned origin mapping');
    }
    const kind = args[0];
    if (args[2] !== ORIGIN ||
        (kind === 'push' && (args.length !== 4 || args[1] !== '--porcelain')) ||
        (kind === 'ls-remote' && !(
          (args.length === 5 && args[1] === '--tags') ||
          (args.length === 4 && args[1] === '--refs')
        ))) {
      throw new Error('Fixture remote argv does not match the accepted transport shape');
    }
    const mapped = args.map(value => value === ORIGIN ? fixture.bare : value);
    const call = {
      kind,
      args: [...args],
      mapped: [...mapped],
      index: remoteCalls.length + 1
    };
    remoteCalls.push(call);
    const nativeOptions = { ...spawnOptions, env: GIT_ENV };
    const spawn = () => childProcess.spawnSync(command, mapped, nativeOptions);
    if (options.remoteHook) {
      const injected = options.remoteHook({ ...call, spawnOptions: nativeOptions, spawn });
      if (injected !== undefined) return injected;
    }
    return spawn();
  };
  const withFerryRepoLock = async (root, callback) => {
    const entry = { root, remoteAtEntry: remoteCalls.length, exited: false };
    ferryCalls.push(entry);
    try {
      return await callback();
    } finally {
      entry.remoteAtExit = remoteCalls.length;
      entry.exited = true;
    }
  };
  return {
    run,
    runMutation,
    spawnRemote,
    withFerryRepoLock,
    fs,
    assertPublishWindow: options.assertPublishWindow || (() => {
      windowCalls.push(remoteCalls.length);
    }),
    localCalls,
    mutationCalls,
    remoteCalls,
    ferryCalls,
    windowCalls
  };
}

function pushes(deps) {
  return deps.remoteCalls.filter((call) => call.kind === 'push');
}

function writes(deps) {
  return deps.localCalls.filter((call) => ['fetch', 'update-ref', 'commit', 'push', 'rev-list'].includes(call[1]));
}

function sourceReady(fixture, options = {}) {
  return createReleaseState({
    releaseId: RELEASE_ID,
    version: options.version || VERSION,
    mode: options.mode || 'publish',
    at: TIMES.created,
    sourceSha: options.sourceSha || fixture.sourceSha,
    versionIntent: null
  }, fixture.identity, { repoDir: fixture.repoDir });
}

function fixturePaths(fixture) {
  if (!fixture || typeof fixture.cacheRoot !== 'string' ||
      !path.isAbsolute(fixture.cacheRoot) ||
      !fixture.cacheRoot.startsWith(OWNER + path.sep)) {
    throw new Error('Fixture requires an explicit cacheRoot beneath its owned scratch directory');
  }
  const paths = statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
  if (paths.repoDir !== fixture.repoDir) {
    throw new Error('Fixture repoDir must match its owned cacheRoot');
  }
  return paths;
}

function persist(fixture, state, expectedRevision = null) {
  fixturePaths(fixture);
  writeReleaseState(state, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision, fs
  });
  const stored = readReleaseState(fixture.identity, {
    cacheRoot: fixture.cacheRoot, mode: state.mode, fs
  });
  expect(stored).not.toBeNull();
  expect(stored).toEqual(JSON.parse(JSON.stringify(state)));
  return stored;
}

function persistChain(fixture, states) {
  fixturePaths(fixture);
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error('Fixture persistence requires a nonempty consecutive state chain');
  }
  for (let index = 0; index < states.length; index += 1) {
    if (!states[index] || states[index].revision !== index ||
        states[index].releaseId !== states[0].releaseId || states[index].mode !== states[0].mode) {
      throw new Error('Fixture chain must contain every revision from zero in one release lane');
    }
  }
  let previous = null;
  for (const state of states) {
    previous = persist(fixture, state, previous === null ? null : previous.revision);
  }
  return previous;
}

function withFixtureLock(fixture, callback) {
  fixturePaths(fixture);
  return withReleaseLock(fixture.identity, callback, { cacheRoot: fixture.cacheRoot, fs });
}

function persistLocked(fixture, state) {
  return withFixtureLock(fixture, () => persist(fixture, state));
}

function ensureLocked(fixture, state, deps, allowTagMutation = false) {
  return withFixtureLock(fixture, () => ensureSourceRefs({
    state, repoDir: fixture.repoDir, allowTagMutation
  }, deps));
}

function readyAttempt(fixture, state, options = {}) {
  return makeWorkflowAttempt({
    state,
    repoDir: fixture.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId: options.attemptId || ATTEMPT_ID,
    sourceSha: options.sourceSha || state.sourceSha,
    dispatchRef: options.dispatchRef || `v${state.version}`
  });
}

function readyWorkflow(fixture, state) {
  const attempt = readyAttempt(fixture, state, {
    dispatchRef: state.mode === 'dry-run' ? 'main' : `v${state.version}`
  });
  return transitionRelease(state, { type: 'attempt-ready', at: TIMES.ready, attempt }, fixture.identity, {
    repoDir: fixture.repoDir
  });
}

function requestedWorkflow(fixture, state) {
  return transitionRelease(readyWorkflow(fixture, state), {
    type: 'dispatch-requested', at: TIMES.requested
  }, fixture.identity, { repoDir: fixture.repoDir });
}

function identifiedWorkflow(fixture, state, conclusion) {
  return transitionRelease(requestedWorkflow(fixture, state), {
    type: 'run-observed', at: TIMES.observed, runId: RUN_ID, runAttempt: 1,
    runStatus: 'completed', conclusion
  }, fixture.identity, { repoDir: fixture.repoDir });
}

function repairStates(fixture) {
  const initial = sourceReady(fixture);
  const ready = readyWorkflow(fixture, initial);
  const requested = transitionRelease(ready, {
    type: 'dispatch-requested', at: TIMES.requested
  }, fixture.identity, { repoDir: fixture.repoDir });
  const observed = transitionRelease(requested, {
    type: 'run-observed', at: TIMES.observed, runId: RUN_ID, runAttempt: 1,
    runStatus: 'completed', conclusion: 'failure'
  }, fixture.identity, { repoDir: fixture.repoDir });
  const failed = transitionRelease(observed, {
    type: 'ci-failed', at: TIMES.failed, error: CI_ERROR
  }, fixture.identity, { repoDir: fixture.repoDir });
  const attempt = readyAttempt(fixture, failed, {
    attemptId: REPAIR_ATTEMPT_ID, sourceSha: fixture.repairSha, dispatchRef: 'main'
  });
  const repair = transitionRelease(failed, {
    type: 'begin-repair-attempt', at: TIMES.repair, previousRunId: RUN_ID, attempt
  }, fixture.identity, { repoDir: fixture.repoDir });
  return [initial, ready, requested, observed, failed, repair];
}

describe('source refs', () => {
  test('refuses an unresolved attempt and an acting tail or complete release before touching anything', async () => {
    const pureCache = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, 'pure-cache-')));
    const pureRepoDir = statePaths(PURE_IDENTITY, { cacheRoot: pureCache, fs }).repoDir;
    const fixture = {
      identity: PURE_IDENTITY,
      cacheRoot: pureCache,
      repoDir: pureRepoDir,
      sourceSha: 'a'.repeat(40)
    };

    const sourceReadyState = sourceReady(fixture);
    const requested = requestedWorkflow(fixture, sourceReadyState);
    const identified = identifiedWorkflow(fixture, sourceReadyState, 'success');
      const rejected = transitionRelease(requested, {
        type: 'dispatch-rejected',
        at: TIMES.observed,
        error: { code: 'WORKFLOW_DISPATCH_REJECTED', message: 'Fixture dispatch rejected' }
      }, PURE_IDENTITY, { repoDir: pureRepoDir });
    const unknown = transitionRelease(requestedWorkflow(fixture, sourceReadyState), {
      type: 'dispatch-unknown', at: TIMES.observed, error: CI_ERROR
    }, PURE_IDENTITY, { repoDir: pureRepoDir });
    const complete = transitionRelease(
      identifiedWorkflow(fixture, sourceReady(fixture, { mode: 'dry-run' }), 'success'),
      { type: 'dry-run-complete', at: TIMES.verified }, PURE_IDENTITY, { repoDir: pureRepoDir }
    );
    const tail = transitionRelease(identifiedWorkflow(fixture, sourceReady(fixture), 'success'), {
      type: 'artifacts-verified', at: TIMES.verified,
      artifacts: {
        state: 'complete',
        sourceSha: fixture.sourceSha,
        runId: RUN_ID,
        manifestFile: path.join(pureRepoDir, 'records', RELEASE_ID, 'manifest.json'),
        manifestSha256: sha256('manifest'),
        verifiedAt: TIMES.verified
      }
    }, PURE_IDENTITY, { repoDir: pureRepoDir });

    const refusals = [requested, identified, rejected, unknown, complete, tail];
    for (const state of refusals) {
      const deps = forbiddenDeps();
      const error = await outcomeOf(ensureSourceRefs({ state, repoDir: pureRepoDir }, deps));
      expect(error).not.toBeNull();
      expect(error.code).toBe('SOURCE_REF_INVALID');
    }
  });

  test('requires a boolean mutation flag and the exact dependency interfaces', async () => {
    const pureCache = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, 'pure-deps-')));
    const pureRepoDir = statePaths(PURE_IDENTITY, { cacheRoot: pureCache, fs }).repoDir;
    const fixture = {
      identity: PURE_IDENTITY,
      cacheRoot: pureCache,
      repoDir: pureRepoDir,
      sourceSha: 'a'.repeat(40)
    };
    const state = sourceReady(fixture);

    const flag = await outcomeOf(ensureSourceRefs({ state, repoDir: pureRepoDir, allowTagMutation: 'yes' }, forbiddenDeps()));
    expect(flag.code).toBe('SOURCE_REF_INVALID');

    const missingWindow = await outcomeOf(ensureSourceRefs(
      { state, repoDir: pureRepoDir, allowTagMutation: true },
      { ...forbiddenDeps(), assertPublishWindow: undefined }
    ));
    expect(missingWindow.code).toBe('SOURCE_REF_INVALID');

    const badRun = await outcomeOf(ensureSourceRefs(
      { state, repoDir: pureRepoDir }, { ...forbiddenDeps(), run: 'git' }
    ));
    expect(badRun.code).toBe('SOURCE_REF_INVALID');

    const badMutation = await outcomeOf(ensureSourceRefs(
      { state, repoDir: pureRepoDir, allowTagMutation: true },
      { ...forbiddenDeps(), runMutation: null }
    ));
    expect(badMutation.code).toBe('SOURCE_REF_INVALID');

    const badFerry = await outcomeOf(ensureSourceRefs(
      { state, repoDir: pureRepoDir }, { ...forbiddenDeps(), withFerryRepoLock: null }
    ));
    expect(badFerry.code).toBe('SOURCE_REF_INVALID');

    const badCache = await outcomeOf(ensureSourceRefs(
      { state, repoDir: `${pureRepoDir}/` }, forbiddenDeps()
    ));
    expect(badCache.code).toBe('SOURCE_REF_INVALID');
  });

  testPosix('refuses a state that is not the persisted record before reading the repository', async () => {
    const pureCache = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, 'pure-stale-')));
    const pureRepoDir = statePaths(PURE_IDENTITY, { cacheRoot: pureCache, fs }).repoDir;
    const fixture = {
      identity: PURE_IDENTITY,
      cacheRoot: pureCache,
      repoDir: pureRepoDir,
      sourceSha: 'a'.repeat(40)
    };
    const state = await persistLocked(fixture, sourceReady(fixture));
    const stale = { ...structuredClone(state), sourceSha: 'b'.repeat(40) };

    const error = await outcomeOf(ensureLocked(fixture, stale, forbiddenDeps()));
    expect(error.code).toBe('SOURCE_REF_CONFLICT');
  });

  describePosix('native fixtures', () => {
    testPosix('creates the annotated tag at the recorded source and pushes that source once', async () => {
      const fixture = makeFixture();
      const state = await persistLocked(fixture, sourceReady(fixture));
      const deps = makeDeps(fixture);
      const head = git(fixture.repo, ['rev-parse', 'HEAD']).trim();
      const index = git(fixture.repo, ['write-tree']).trim();
      const cache = listFiles(fixture.repoDir);
      expect(head).toBe(fixture.headSha);
      expect(head).not.toBe(fixture.sourceSha);

      const result = await ensureLocked(fixture, state, deps, true);

      expect(result).toEqual({ sourceSha: fixture.sourceSha, dispatchRef: TAG_NAME });
      const local = tagFacts(fixture.repo, TAG_REF);
      expect(local.objectType).toBe('tag');
      expect(local.peeledType).toBe('commit');
      expect(local.refName).toBe(TAG_REF);
      expect(local.peeledName).toBe(fixture.sourceSha);
      const remote = tagFacts(fixture.bare, TAG_REF);
      expect(remote.peeledName).toBe(fixture.sourceSha);
      expect(remote.objectName).toBe(local.objectName);

      expect(git(fixture.repo, ['rev-parse', 'HEAD']).trim()).toBe(head);
      expect(git(fixture.repo, ['write-tree']).trim()).toBe(index);
      expect(git(fixture.repo, ['status', '--porcelain'])).toBe('');
      expect(fs.readFileSync(path.join(fixture.repo, 'package.json'), 'utf8')).toContain(NEXT_VERSION);
      expect(refList(fixture.repo)).toEqual([
        `refs/heads/main ${fixture.headSha}`,
        `refs/tags/${TAG_NAME} ${local.objectName}`
      ]);

      expect(deps.mutationCalls).toEqual([
        ['git', '-c', 'tag.gpgSign=false', 'tag', '-a', TAG_NAME, fixture.sourceSha, '-m', TAG_NAME]
      ]);
      expect(pushes(deps)).toHaveLength(1);
      expect(pushes(deps)[0].args).toEqual(['push', '--porcelain', ORIGIN, `${local.objectName}:${TAG_REF}`]);
      expect(pushes(deps)[0].args.join(' ')).not.toContain('--force');
      expect(pushes(deps)[0].args.join(' ')).not.toContain('--tags');
      expect(writes(deps)).toEqual([]);
      expect(deps.remoteCalls.map(call => call.args)).toEqual([
        ['ls-remote', '--tags', ORIGIN, TAG_REF, `${TAG_REF}^{}`],
        ['ls-remote', '--tags', ORIGIN, TAG_REF, `${TAG_REF}^{}`],
        ['push', '--porcelain', ORIGIN, `${local.objectName}:${TAG_REF}`],
        ['ls-remote', '--tags', ORIGIN, TAG_REF, `${TAG_REF}^{}`]
      ]);
      expect(listFiles(fixture.repoDir)).toEqual(cache);
      expect(listFiles(fixture.repoDir)).not.toContain('tag.json');
      expect(deps.ferryCalls).toEqual([
        { root: fixture.repo, remoteAtEntry: 1, exited: true, remoteAtExit: 1 }
      ]);
      expect(deps.windowCalls).toEqual([1, 2]);
    });

    testPosix('reuses the existing local annotation and pushes it without a second creation', async () => {
      const fixture = makeFixture();
      const state = await persistLocked(fixture, sourceReady(fixture));
      annotatedTag(fixture.repo, fixture.sourceSha, 'first creation');
      const created = tagFacts(fixture.repo, TAG_REF);
      const head = git(fixture.repo, ['rev-parse', 'HEAD']).trim();
      const index = git(fixture.repo, ['write-tree']).trim();
      const cache = listFiles(fixture.repoDir);
      expect(tagFacts(fixture.bare, TAG_REF)).toBeNull();

      const deps = makeDeps(fixture);
      const result = await ensureLocked(fixture, state, deps, true);

      expect(result).toEqual({ sourceSha: fixture.sourceSha, dispatchRef: TAG_NAME });
      expect(deps.mutationCalls).toEqual([]);
      expect(deps.ferryCalls).toEqual([]);
      expect(pushes(deps)).toHaveLength(1);
      expect(pushes(deps)[0].args).toEqual(['push', '--porcelain', ORIGIN, `${created.objectName}:${TAG_REF}`]);
      expect(tagFacts(fixture.repo, TAG_REF)).toEqual(created);
      expect(tagFacts(fixture.bare, TAG_REF).peeledName).toBe(fixture.sourceSha);
      expect(tagFacts(fixture.bare, TAG_REF).objectName).toBe(created.objectName);
      expect(deps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote', 'push', 'ls-remote']);
      expect(deps.windowCalls).toEqual([2]);
      expect(writes(deps)).toEqual([]);
      expect(git(fixture.repo, ['rev-parse', 'HEAD']).trim()).toBe(head);
      expect(git(fixture.repo, ['write-tree']).trim()).toBe(index);
      expect(listFiles(fixture.repoDir)).toEqual(cache);
    });

    testPosix('accepts a matching remote tag and a different remote annotation with zero pushes', async () => {
      const fixture = makeFixture();
      const state = await persistLocked(fixture, sourceReady(fixture));
      annotatedTag(fixture.repo, fixture.sourceSha, 'local annotation');
      const localObject = tagFacts(fixture.repo, TAG_REF).objectName;

      const clone = path.join(fixture.owner, 'clone');
      git(fixture.owner, ['clone', '-q', fixture.bare, clone]);
      annotatedTag(clone, fixture.sourceSha, 'remote annotation');
      const remoteObject = tagFacts(clone, TAG_REF).objectName;
      expect(remoteObject).not.toBe(localObject);
      git(clone, ['push', '-q', 'origin', TAG_REF]);
      expect(gitProbe(fixture.repo, ['cat-file', '-t', remoteObject]).status).not.toBe(0);
      expect(tagFacts(fixture.bare, TAG_REF).objectName).toBe(remoteObject);

      const deps = makeDeps(fixture);
      const result = await ensureLocked(fixture, state, deps, true);

      expect(result).toEqual({ sourceSha: fixture.sourceSha, dispatchRef: TAG_NAME });
      expect(deps.mutationCalls).toEqual([]);
      expect(pushes(deps)).toEqual([]);
      expect(deps.ferryCalls).toEqual([]);
      expect(tagFacts(fixture.repo, TAG_REF).objectName).toBe(localObject);
      expect(deps.remoteCalls).toHaveLength(1);
      expect(deps.windowCalls).toEqual([]);
      expect(gitProbe(fixture.repo, ['cat-file', '-t', remoteObject]).status).not.toBe(0);
    });

    testPosix('refuses a wrong local source, a wrong remote source and a missing local tag', async () => {
      const wrongLocal = makeFixture();
      const wrongLocalState = await persistLocked(wrongLocal, sourceReady(wrongLocal));
      annotatedTag(wrongLocal.repo, wrongLocal.headSha, 'wrong source');
      const wrongLocalDeps = makeDeps(wrongLocal);
      const wrongLocalError = await outcomeOf(ensureLocked(wrongLocal, wrongLocalState, wrongLocalDeps, true));
      expect(wrongLocalError.code).toBe('SOURCE_REF_CONFLICT');
      expect(wrongLocalDeps.mutationCalls).toEqual([]);
      expect(pushes(wrongLocalDeps)).toEqual([]);
      expect(tagFacts(wrongLocal.repo, TAG_REF).peeledName).toBe(wrongLocal.headSha);
      expect(tagFacts(wrongLocal.bare, TAG_REF)).toBeNull();

      const wrongRemote = makeFixture();
      const wrongRemoteState = await persistLocked(wrongRemote, sourceReady(wrongRemote));
      annotatedTag(wrongRemote.repo, wrongRemote.sourceSha, 'recorded source');
      const localObject = tagFacts(wrongRemote.repo, TAG_REF).objectName;
      const clone = path.join(wrongRemote.owner, 'clone');
      git(wrongRemote.owner, ['clone', '-q', wrongRemote.bare, clone]);
      annotatedTag(clone, wrongRemote.headSha, 'wrong remote source');
      git(clone, ['push', '-q', 'origin', TAG_REF]);
      const wrongRemoteDeps = makeDeps(wrongRemote);
      const wrongRemoteError = await outcomeOf(ensureLocked(wrongRemote, wrongRemoteState, wrongRemoteDeps, true));
      expect(wrongRemoteError.code).toBe('SOURCE_REF_CONFLICT');
      expect(pushes(wrongRemoteDeps)).toEqual([]);
      expect(wrongRemoteDeps.mutationCalls).toEqual([]);
      expect(tagFacts(wrongRemote.repo, TAG_REF).objectName).toBe(localObject);

      const orphan = makeFixture();
      const orphanState = await persistLocked(orphan, sourceReady(orphan));
      annotatedTag(orphan.repo, orphan.sourceSha, 'temporary');
      git(orphan.repo, ['push', '-q', orphan.bare, TAG_REF]);
      git(orphan.repo, ['tag', '-d', TAG_NAME]);
      expect(tagFacts(orphan.repo, TAG_REF)).toBeNull();
      expect(tagFacts(orphan.bare, TAG_REF)).not.toBeNull();
      const orphanDeps = makeDeps(orphan);
      const orphanError = await outcomeOf(ensureLocked(orphan, orphanState, orphanDeps, true));
      expect(orphanError.code).toBe('SOURCE_REF_CONFLICT');
      expect(orphanDeps.mutationCalls).toEqual([]);
      expect(pushes(orphanDeps)).toEqual([]);
      expect(tagFacts(orphan.repo, TAG_REF)).toBeNull();
    });

    testPosix('refuses a local lightweight or nested tag and a remote lightweight tag', async () => {
      const lightweight = makeFixture();
      const lightweightState = await persistLocked(lightweight, sourceReady(lightweight));
      git(lightweight.repo, ['tag', TAG_NAME, lightweight.sourceSha]);
      const lightweightFacts = tagFacts(lightweight.repo, TAG_REF);
      expect(lightweightFacts.objectType).toBe('commit');
      expect(lightweightFacts.peeledName).toBe('');
      const lightweightDeps = makeDeps(lightweight);
      const lightweightError = await outcomeOf(ensureLocked(lightweight, lightweightState, lightweightDeps, true));
      expect(lightweightError).not.toBeNull();
      expect(lightweightError.code).toBe('SOURCE_REF_CONFLICT');
      expect(lightweightDeps.mutationCalls).toEqual([]);
      expect(pushes(lightweightDeps)).toEqual([]);
      expect(lightweightDeps.remoteCalls).toEqual([]);
      expect(lightweightDeps.ferryCalls).toEqual([]);
      expect(lightweightDeps.windowCalls).toEqual([]);
      expect(tagFacts(lightweight.repo, TAG_REF)).toEqual(lightweightFacts);

      const nested = makeFixture();
      const nestedState = await persistLocked(nested, sourceReady(nested));
      git(nested.repo, [
        '-c', 'tag.gpgSign=false', 'tag', '-a', 'inner-fixture', nested.sourceSha, '-m', 'inner'
      ]);
      const inner = git(nested.repo, ['rev-parse', '--verify', 'refs/tags/inner-fixture']).trim();
      expect(git(nested.repo, ['cat-file', '-t', inner]).trim()).toBe('tag');
      annotatedTag(nested.repo, inner, 'outer');
      const nestedFacts = tagFacts(nested.repo, TAG_REF);
      expect(nestedFacts.objectType).toBe('tag');
      const outerBody = git(nested.repo, ['cat-file', 'tag', nestedFacts.objectName]);
      const outerHeader = outerBody.split('\n', 3).slice(0, 2);
      process.stdout.write(`${JSON.stringify({
        nestedTagEvidence: {
          outer: nestedFacts.objectName,
          inner,
          source: nested.sourceSha,
          directHeader: outerHeader,
          listedPeeledName: nestedFacts.peeledName,
          listedPeeledType: nestedFacts.peeledType
        }
      })}\n`);
      expect(outerHeader).toEqual([`object ${inner}`, 'type tag']);
      const innerBody = git(nested.repo, ['cat-file', 'tag', inner]);
      expect(innerBody.split('\n', 3).slice(0, 2)).toEqual([
        `object ${nested.sourceSha}`, 'type commit'
      ]);
      const nestedDeps = makeDeps(nested);
      const nestedError = await outcomeOf(ensureLocked(nested, nestedState, nestedDeps, true));
      expect(nestedError).not.toBeNull();
      expect(nestedError.code).toBe('SOURCE_REF_CONFLICT');
      expect(nestedDeps.mutationCalls).toEqual([]);
      expect(pushes(nestedDeps)).toEqual([]);
      expect(nestedDeps.remoteCalls).toEqual([]);
      expect(nestedDeps.ferryCalls).toEqual([]);
      expect(nestedDeps.windowCalls).toEqual([]);
      expect(tagFacts(nested.repo, TAG_REF)).toEqual(nestedFacts);
      expect(git(nested.repo, ['rev-parse', '--verify', 'refs/tags/inner-fixture']).trim()).toBe(inner);

      const remoteLight = makeFixture();
      const remoteLightState = await persistLocked(remoteLight, sourceReady(remoteLight));
      annotatedTag(remoteLight.repo, remoteLight.sourceSha, 'local annotation');
      const localFacts = tagFacts(remoteLight.repo, TAG_REF);
      git(remoteLight.bare, ['update-ref', TAG_REF, remoteLight.sourceSha]);
      const remoteFacts = tagFacts(remoteLight.bare, TAG_REF);
      const remoteLightDeps = makeDeps(remoteLight);
      const remoteLightError = await outcomeOf(ensureLocked(remoteLight, remoteLightState, remoteLightDeps, true));
      expect(remoteLightError).not.toBeNull();
      expect(remoteLightError.code).toBe('SOURCE_REF_CONFLICT');
      expect(remoteLightDeps.mutationCalls).toEqual([]);
      expect(pushes(remoteLightDeps)).toEqual([]);
      expect(remoteLightDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote']);
      expect(remoteLightDeps.ferryCalls).toEqual([]);
      expect(remoteLightDeps.windowCalls).toEqual([]);
      expect(tagFacts(remoteLight.repo, TAG_REF)).toEqual(localFacts);
      expect(tagFacts(remoteLight.bare, TAG_REF)).toEqual(remoteFacts);
      expect(remoteFacts.objectType).toBe('commit');
    });

    testPosix('refuses existing matching tags when the recorded source has another package version', async () => {
      const fixture = makeFixture();
      const state = await persistLocked(fixture, sourceReady(fixture, { sourceSha: fixture.headSha }));
      expect(state.version).toBe(VERSION);
      expect(state.sourceSha).toBe(fixture.headSha);
      expect(JSON.parse(git(fixture.repo, ['show', `${fixture.headSha}:package.json`])).version).toBe(NEXT_VERSION);
      annotatedTag(fixture.repo, fixture.headSha, 'wrong package version');
      git(fixture.repo, ['push', '-q', fixture.bare, TAG_REF]);
      const local = tagFacts(fixture.repo, TAG_REF);
      const remote = tagFacts(fixture.bare, TAG_REF);
      const refs = refList(fixture.repo);
      const cache = listFiles(fixture.repoDir);
      expect(local.objectType).toBe('tag');
      expect(remote.objectType).toBe('tag');
      expect(local.peeledName).toBe(fixture.headSha);
      expect(remote.peeledName).toBe(fixture.headSha);
      expect(remote.objectName).toBe(local.objectName);

      const deps = makeDeps(fixture);
      const error = await outcomeOf(ensureLocked(fixture, state, deps, true));

      expect(error).not.toBeNull();
      expect(error.code).toBe('SOURCE_REF_CONFLICT');
      expect(error.message).toBe('The recorded release source does not carry the release version');
      expect(deps.remoteCalls).toEqual([]);
      expect(deps.mutationCalls).toEqual([]);
      expect(deps.ferryCalls).toEqual([]);
      expect(deps.windowCalls).toEqual([]);
      expect(tagFacts(fixture.repo, TAG_REF)).toEqual(local);
      expect(tagFacts(fixture.bare, TAG_REF)).toEqual(remote);
      expect(refList(fixture.repo)).toEqual(refs);
      expect(listFiles(fixture.repoDir)).toEqual(cache);
    });

    testPosix('treats a malformed, duplicate or unavailable tag listing as unresolved', async () => {
      const oid = 'a'.repeat(40);
      const cases = [
        remoteRow(oid.slice(0, 7), TAG_REF),
        remoteRow(oid, `${TAG_REF}^{}`),
        remoteRow(oid, TAG_REF) + remoteRow(oid, TAG_REF),
        `${oid} ${TAG_REF}\n`,
        `not-an-oid\t${TAG_REF}\nnot-an-oid\t${TAG_REF}^{}\n`
      ];
      for (const stdout of cases) {
        const fixture = makeFixture();
        const fixtureState = await persistLocked(fixture, sourceReady(fixture));
        const deps = makeDeps(fixture, {
          remoteHook: ({ index }) => (index === 1 ? { status: 0, signal: null, stdout, stderr: '' } : undefined)
        });
        const error = await outcomeOf(ensureLocked(fixture, fixtureState, deps, true));
        expect(error.code).toBe('SOURCE_REF_UNRESOLVED');
        expect(deps.remoteCalls).toHaveLength(1);
        expect(deps.windowCalls).toEqual([]);
        expect(deps.ferryCalls).toEqual([]);
        expect(deps.mutationCalls).toEqual([]);
        expect(pushes(deps)).toEqual([]);
        expect(tagFacts(fixture.repo, TAG_REF)).toBeNull();
      }

      const unavailable = makeFixture();
      const unavailableState = await persistLocked(unavailable, sourceReady(unavailable));
      const failingDeps = makeDeps(unavailable, {
        remoteHook: ({ index }) => (index === 1 ? transportFailure('fatal: could not read from remote repository') : undefined)
      });
      const failingError = await outcomeOf(ensureLocked(unavailable, unavailableState, failingDeps, true));
      expect(failingError.code).toBe('SOURCE_REF_UNRESOLVED');
      expect(failingDeps.mutationCalls).toEqual([]);
      expect(pushes(failingDeps)).toEqual([]);
      expect(tagFacts(unavailable.repo, TAG_REF)).toBeNull();
      expect(tagFacts(unavailable.bare, TAG_REF)).toBeNull();

      const thrown = makeFixture();
      const thrownState = await persistLocked(thrown, sourceReady(thrown));
      const thrownDeps = makeDeps(thrown, {
        remoteHook: ({ index }) => {
          if (index === 1) throw new Error(`spawn git failed for ${ORIGIN}`);
          return undefined;
        }
      });
      const thrownError = await outcomeOf(ensureLocked(thrown, thrownState, thrownDeps, true));
      expect(thrownError.code).toBe('SOURCE_REF_UNRESOLVED');
      expect(thrownError.message).not.toContain('github.com');
      expect(thrownDeps.mutationCalls).toEqual([]);
      expect(pushes(thrownDeps)).toEqual([]);
    });

    testPosix('refuses a stale state, a changed destination and a changed local object', async () => {
      const stale = makeFixture();
      const staleState = await persistLocked(stale, sourceReady(stale));
      const ready = readyWorkflow(stale, staleState);
      await withFixtureLock(stale, () => persist(stale, ready, staleState.revision));
      const staleDeps = makeDeps(stale);
      const staleError = await outcomeOf(ensureLocked(stale, staleState, staleDeps, true));
      expect(staleError.code).toBe('SOURCE_REF_CONFLICT');
      expect(staleDeps.remoteCalls).toEqual([]);
      expect(staleDeps.mutationCalls).toEqual([]);
      expect(staleDeps.ferryCalls).toEqual([]);

      const moved = makeFixture();
      const movedState = await persistLocked(moved, sourceReady(moved));
      annotatedTag(moved.repo, moved.sourceSha, 'recorded source');
      const movedObject = tagFacts(moved.repo, TAG_REF).objectName;
      const movedDeps = makeDeps(moved, {
        remoteHook: ({ index }) => {
          if (index !== 2) return undefined;
          git(moved.repo, ['remote', 'set-url', '--push', 'origin', SAME_REPO_HTTPS]);
          return { status: 0, signal: null, stdout: '', stderr: '' };
        }
      });
      const movedError = await outcomeOf(ensureLocked(moved, movedState, movedDeps, true));
      expect(movedError.code).toBe('SOURCE_REF_CONFLICT');
      expect(movedDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote']);
      expect(movedDeps.windowCalls).toEqual([]);
      expect(pushes(movedDeps)).toEqual([]);
      expect(movedDeps.mutationCalls).toEqual([]);
      expect(tagFacts(moved.repo, TAG_REF).objectName).toBe(movedObject);
      expect(tagFacts(moved.bare, TAG_REF)).toBeNull();

      const swapped = makeFixture();
      const swappedState = await persistLocked(swapped, sourceReady(swapped));
      annotatedTag(swapped.repo, swapped.sourceSha, 'recorded source');
      const original = tagFacts(swapped.repo, TAG_REF).objectName;
      const swappedDeps = makeDeps(swapped, {
        remoteHook: ({ index }) => {
          if (index !== 2) return undefined;
          git(swapped.repo, ['tag', '-d', TAG_NAME]);
          annotatedTag(swapped.repo, swapped.sourceSha, 'replacement annotation');
          return { status: 0, signal: null, stdout: '', stderr: '' };
        }
      });
      const swappedError = await outcomeOf(ensureLocked(swapped, swappedState, swappedDeps, true));
      expect(swappedError.code).toBe('SOURCE_REF_CONFLICT');
      expect(swappedDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote']);
      expect(swappedDeps.windowCalls).toEqual([]);
      expect(pushes(swappedDeps)).toEqual([]);
      expect(swappedDeps.mutationCalls).toEqual([]);
      const replacement = tagFacts(swapped.repo, TAG_REF);
      expect(replacement.objectName).not.toBe(original);
      expect(replacement.peeledName).toBe(swapped.sourceSha);
      expect(tagFacts(swapped.bare, TAG_REF)).toBeNull();
    });

    testPosix('completes from the observation when the push outcome is lost or the follow-up read fails', async () => {
      const lost = makeFixture();
      const lostState = await persistLocked(lost, sourceReady(lost));
      annotatedTag(lost.repo, lost.sourceSha, 'recorded source');
      const lostTag = tagFacts(lost.repo, TAG_REF).objectName;
      const lostDeps = makeDeps(lost, {
        remoteHook: ({ kind, spawn }) => {
          if (kind !== 'push') return undefined;
          const landed = spawn();
          expect(landed.status).toBe(0);
          return { status: null, signal: null, stdout: '', stderr: '', error: new Error('lost response') };
        }
      });
      const lostResult = await ensureLocked(lost, lostState, lostDeps, true);
      expect(lostResult).toEqual({ sourceSha: lost.sourceSha, dispatchRef: TAG_NAME });
      expect(pushes(lostDeps)).toHaveLength(1);
      expect(lostDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote', 'push', 'ls-remote']);
      expect(lostDeps.windowCalls).toEqual([2]);
      expect(tagFacts(lost.bare, TAG_REF).peeledName).toBe(lost.sourceSha);
      expect(tagFacts(lost.bare, TAG_REF).objectName).toBe(lostTag);

      const unconfirmed = makeFixture();
      const unconfirmedState = await persistLocked(unconfirmed, sourceReady(unconfirmed));
      annotatedTag(unconfirmed.repo, unconfirmed.sourceSha, 'recorded source');
      const unconfirmedDeps = makeDeps(unconfirmed, {
        remoteHook: ({ index }) => (
          index === 4 ? transportFailure(`fatal: could not read from ${ORIGIN}`) : undefined
        )
      });
      const unconfirmedError = await outcomeOf(ensureLocked(unconfirmed, unconfirmedState, unconfirmedDeps, true));
      expect(unconfirmedError.code).toBe('SOURCE_REF_UNRESOLVED');
      expect(unconfirmedError.diagnostic.stderr).toContain('<push-destination>');
      expect(unconfirmedError.diagnostic.stderr).not.toContain('github.com');
      expect(pushes(unconfirmedDeps)).toHaveLength(1);
      expect(unconfirmedDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote', 'push', 'ls-remote']);
      expect(unconfirmedDeps.windowCalls).toEqual([2]);
      expect(unconfirmedError.message).not.toContain('still absent');
      expect(tagFacts(unconfirmed.bare, TAG_REF).peeledName).toBe(unconfirmed.sourceSha);

      const resumedDeps = makeDeps(unconfirmed);
      const resumed = await ensureLocked(unconfirmed, unconfirmedState, resumedDeps, true);
      expect(resumed).toEqual({ sourceSha: unconfirmed.sourceSha, dispatchRef: TAG_NAME });
      expect(pushes(resumedDeps)).toEqual([]);
      expect(resumedDeps.mutationCalls).toEqual([]);
      expect(resumedDeps.remoteCalls).toHaveLength(1);
      expect(resumedDeps.windowCalls).toEqual([]);

      const absent = makeFixture();
      const absentState = await persistLocked(absent, sourceReady(absent));
      annotatedTag(absent.repo, absent.sourceSha, 'recorded source');
      const absentDeps = makeDeps(absent, {
        remoteHook: ({ kind }) => (
          kind === 'push' ? transportFailure('fatal: could not read from remote repository') : undefined
        )
      });
      const absentError = await outcomeOf(ensureLocked(absent, absentState, absentDeps, true));
      expect(absentError.code).toBe('SOURCE_REF_UNRESOLVED');
      expect(pushes(absentDeps)).toHaveLength(1);
      expect(absentDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote', 'push', 'ls-remote']);
      expect(absentDeps.windowCalls).toEqual([2]);
      expect(tagFacts(absent.bare, TAG_REF)).toBeNull();
      const retryDeps = makeDeps(absent);
      const retry = await ensureLocked(absent, absentState, retryDeps, true);
      expect(retry).toEqual({ sourceSha: absent.sourceSha, dispatchRef: TAG_NAME });
      expect(pushes(retryDeps)).toHaveLength(1);
      expect(retryDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote', 'push', 'ls-remote']);
      expect(retryDeps.windowCalls).toEqual([2]);
      expect(tagFacts(absent.bare, TAG_REF).peeledName).toBe(absent.sourceSha);
    });

    testPosix('retains the thrown publish-window error before the tag command and before the push', async () => {
      const creation = makeFixture();
      const creationState = await persistLocked(creation, sourceReady(creation));
      const closed = new Error('publish window closed');
      let creationGuards = 0;
      const creationDeps = makeDeps(creation, { assertPublishWindow: () => {
        creationGuards += 1;
        throw closed;
      } });
      const creationError = await outcomeOf(ensureLocked(creation, creationState, creationDeps, true));
      expect(creationError).toBe(closed);
      expect(creationGuards).toBe(1);
      expect(creationDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote']);
      expect(creationDeps.mutationCalls).toEqual([]);
      expect(pushes(creationDeps)).toEqual([]);
      expect(tagFacts(creation.repo, TAG_REF)).toBeNull();
      expect(tagFacts(creation.bare, TAG_REF)).toBeNull();
      expect(creationDeps.ferryCalls).toHaveLength(1);
      expect(creationDeps.ferryCalls[0]).toEqual({
        root: creation.repo, remoteAtEntry: 1, exited: true, remoteAtExit: 1
      });

      const pushing = makeFixture();
      const pushingState = await persistLocked(pushing, sourceReady(pushing));
      annotatedTag(pushing.repo, pushing.sourceSha, 'recorded source');
      const blocked = new Error('publish window closed');
      let pushingGuards = 0;
      const pushingDeps = makeDeps(pushing, { assertPublishWindow: () => {
        pushingGuards += 1;
        throw blocked;
      } });
      const pushingError = await outcomeOf(ensureLocked(pushing, pushingState, pushingDeps, true));
      expect(pushingError).toBe(blocked);
      expect(pushingGuards).toBe(1);
      expect(pushingDeps.remoteCalls.map(call => call.kind)).toEqual(['ls-remote', 'ls-remote']);
      expect(pushingDeps.mutationCalls).toEqual([]);
      expect(pushes(pushingDeps)).toEqual([]);
      expect(tagFacts(pushing.repo, TAG_REF)).not.toBeNull();
      expect(tagFacts(pushing.bare, TAG_REF)).toBeNull();
      expect(pushingDeps.ferryCalls).toEqual([]);
    });

    testPosix('verifies main for an initial dry-run and a persisted ready repair without touching the tag', async () => {
      const dryRun = makeFixture();
      const dryRunState = await persistLocked(dryRun, sourceReady(dryRun, { mode: 'dry-run' }));
      git(dryRun.bare, ['update-ref', 'refs/heads/main', dryRun.sourceSha]);
      const dryRunDeps = makeDeps(dryRun);
      const dryRunResult = await ensureLocked(dryRun, dryRunState, dryRunDeps, true);
      expect(dryRunResult).toEqual({ sourceSha: dryRun.sourceSha, dispatchRef: 'main' });
      expect(dryRunDeps.remoteCalls).toHaveLength(1);
      expect(dryRunDeps.remoteCalls[0].args).toEqual(['ls-remote', '--refs', ORIGIN, 'refs/heads/main']);
      expect(dryRunDeps.mutationCalls).toEqual([]);
      expect(pushes(dryRunDeps)).toEqual([]);
      expect(dryRunDeps.ferryCalls).toEqual([]);
      expect(tagFacts(dryRun.repo, TAG_REF)).toBeNull();
      expect(tagFacts(dryRun.bare, TAG_REF)).toBeNull();
      expect(git(dryRun.repo, ['rev-parse', 'HEAD']).trim()).toBe(dryRun.headSha);

      const descendant = makeFixture();
      const descendantState = await persistLocked(descendant, sourceReady(descendant, { mode: 'dry-run' }));
      git(descendant.bare, ['update-ref', 'refs/heads/main', descendant.headSha]);
      const descendantDeps = makeDeps(descendant);
      const descendantError = await outcomeOf(ensureLocked(descendant, descendantState, descendantDeps, true));
      expect(descendantError.code).toBe('SOURCE_REF_CONFLICT');
      expect(descendantDeps.mutationCalls).toEqual([]);
      expect(pushes(descendantDeps)).toEqual([]);

      const repair = makeFixture();
      const repairChain = repairStates(repair);
      expect(repairChain.map(value => value.revision)).toEqual([0, 1, 2, 3, 4, 5]);
      const repairState = await withFixtureLock(repair, () => persistChain(repair, repairChain));
      git(repair.bare, ['update-ref', 'refs/heads/main', repair.repairSha]);
      const repairDeps = makeDeps(repair);
      const repairResult = await ensureLocked(repair, repairState, repairDeps, true);
      expect(repairResult).toEqual({ sourceSha: repair.repairSha, dispatchRef: 'main' });
      expect(repairState.revision).toBe(5);
      expect(repairState.attempts).toHaveLength(2);
      expect(repairState.attempts[0].sourceSha).toBe(repair.sourceSha);
      expect(repairDeps.remoteCalls.map(call => call.args)).toEqual([
        ['ls-remote', '--refs', ORIGIN, 'refs/heads/main']
      ]);
      expect(repairDeps.windowCalls).toEqual([]);
      expect(repairDeps.ferryCalls).toEqual([]);
      expect(repairDeps.mutationCalls).toEqual([]);
      expect(pushes(repairDeps)).toEqual([]);
      expect(tagFacts(repair.repo, TAG_REF)).toBeNull();
      expect(tagFacts(repair.bare, TAG_REF)).toBeNull();

      const repairDescendant = makeFixture();
      const repairDescendantState = await withFixtureLock(
        repairDescendant, () => persistChain(repairDescendant, repairStates(repairDescendant))
      );
      git(repairDescendant.bare, ['update-ref', 'refs/heads/main', repairDescendant.headSha]);
      const repairDescendantDeps = makeDeps(repairDescendant);
      const repairDescendantError = await outcomeOf(ensureLocked(repairDescendant, repairDescendantState, repairDescendantDeps, true));
      expect(repairDescendantError.code).toBe('SOURCE_REF_CONFLICT');
      expect(repairDescendantDeps.mutationCalls).toEqual([]);
      expect(pushes(repairDescendantDeps)).toEqual([]);
    });

    testPosix('observes without mutation and reports pending missing work', async () => {
      const pending = makeFixture();
      const pendingState = await persistLocked(pending, sourceReady(pending));
      const pendingCache = listFiles(pending.repoDir);
      const pendingDeps = makeDeps(pending);
      const pendingError = await outcomeOf(ensureLocked(pending, pendingState, pendingDeps));
      expect(pendingError.code).toBe('SOURCE_REF_PENDING');
      expect(pendingDeps.mutationCalls).toEqual([]);
      expect(pendingDeps.remoteCalls).toHaveLength(1);
      expect(pendingDeps.ferryCalls).toEqual([]);
      expect(tagFacts(pending.repo, TAG_REF)).toBeNull();
      expect(listFiles(pending.repoDir)).toEqual(pendingCache);

      const unpushed = makeFixture();
      const unpushedState = await persistLocked(unpushed, sourceReady(unpushed));
      annotatedTag(unpushed.repo, unpushed.sourceSha, 'recorded source');
      const unpushedDeps = makeDeps(unpushed);
      const unpushedError = await outcomeOf(ensureLocked(unpushed, unpushedState, unpushedDeps));
      expect(unpushedError.code).toBe('SOURCE_REF_PENDING');
      expect(unpushedDeps.mutationCalls).toEqual([]);
      expect(pushes(unpushedDeps)).toEqual([]);
      expect(unpushedDeps.remoteCalls).toHaveLength(1);
      expect(unpushedDeps.ferryCalls).toEqual([]);
      expect(unpushedDeps.windowCalls).toEqual([]);
      expect(tagFacts(unpushed.bare, TAG_REF)).toBeNull();

      const verified = makeFixture();
      const verifiedState = await persistLocked(verified, sourceReady(verified));
      annotatedTag(verified.repo, verified.sourceSha, 'recorded source');
      git(verified.repo, ['push', '-q', verified.bare, TAG_REF]);
      const verifiedCache = listFiles(verified.repoDir);
      const verifiedDeps = makeDeps(verified);
      const verifiedResult = await ensureLocked(verified, verifiedState, verifiedDeps);
      expect(verifiedResult).toEqual({ sourceSha: verified.sourceSha, dispatchRef: TAG_NAME });
      expect(verifiedDeps.mutationCalls).toEqual([]);
      expect(pushes(verifiedDeps)).toEqual([]);
      expect(verifiedDeps.ferryCalls).toEqual([]);
      expect(verifiedDeps.remoteCalls).toHaveLength(1);
      expect(verifiedDeps.windowCalls).toEqual([]);
      expect(listFiles(verified.repoDir)).toEqual(verifiedCache);
      expect(listFiles(verified.repoDir)).not.toContain('tag.json');
    });
  });
});
