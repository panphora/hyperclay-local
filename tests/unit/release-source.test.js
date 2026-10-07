// Step A of the desktop source intent wrapper: one scratch hyperclay-local checkout
// under an owned temp root, its release cache outside the checkout, an isolated Git
// config and the real release lock. Every version artifact is produced by the
// accepted renderer, preparation and application modules; nothing here contacts a
// remote, provider or sibling checkout.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const applyModule = require('../../scripts/release-docs-apply');

const ACTING_NAMES = ['prepareCommitIntent', 'reconcileTarget', 'reconcileTargetPush'];
const actingOriginal = {};
const actingSpy = {};
for (const name of ACTING_NAMES) {
  actingOriginal[name] = applyModule[name];
  actingSpy[name] = jest.spyOn(applyModule, name);
}

const { prepareVersionIntent, reconcileVersionIntent } = require('../../scripts/release-source');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createReleaseState } = require('../../scripts/release-transitions');
const { withReleaseLock } = require('../../scripts/release-lock');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { execFileCaptured } = require('../../scripts/release-command');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(300000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const DESKTOP_REPO = 'hyperclay-local';
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const PRIOR_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';
const SITE_ATTEMPT_ID = '22222222-3333-4444-8555-666666666666';
const SOURCE_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const NOW = Date.parse('2026-02-03T04:05:06.000Z');
const CREATED_AT = '2026-01-02T00:30:00.000Z';
const UPDATED_AT = '2026-01-02T01:20:00.000Z';
const REQUESTED_AT = '2026-01-02T01:00:00.000Z';
const DEADLINE_AT = '2026-01-02T04:00:00.000Z';
const VERIFIED_AT = '2026-01-02T03:04:06.000Z';
const REQUIRED_PATHS = ['README.md', 'package.json', 'website/index.html'];
const FORBIDDEN_COMMANDS = ['commit', 'commit-tree', 'update-ref', 'push', 'fetch', 'tag'];

const TMP_BASE = fs.realpathSync.native(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-source-'));
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
  '[core]',
  `\thooksPath = ${JSON.stringify(NO_HOOKS.replace(/\\/g, '/'))}`,
  '\tautocrlf = false',
  ''
].join('\n'));

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG, GIT_OPTIONAL_LOCKS: '0' };

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

let seq = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(cwd, args, options = {}) {
  const { env, ...rest } = options;
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...rest,
    env: { ...GIT_ENV, ...(env || {}) }
  });
}

function write(root, rel, body, mode) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode === undefined) fs.writeFileSync(file, body);
  else fs.writeFileSync(file, body, { mode });
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

function makeRepo({ directory = DESKTOP_REPO, version = OLD, origin = ORIGIN, files = {} } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++seq}-`));
  const repoRoot = path.join(parentDir, directory);
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  if (origin !== null) git(repoRoot, ['remote', 'add', 'origin', origin]);
  write(repoRoot, 'README.md', readmeFixture(version));
  write(repoRoot, 'package.json', packageFixture(version));
  write(repoRoot, 'website/index.html', websiteFixture(version));
  write(repoRoot, 'src/app.js', 'module.exports = {};\n');
  for (const [rel, body] of Object.entries(files)) write(repoRoot, rel, body);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'release source']);

  const cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `cache-${++seq}-`)));
  const cacheRoot = path.join(cacheBase, 'releases');
  const identity = resolveRepoIdentity(repoRoot, { readGit: createLocalGitReader().readGit, fs });
  return {
    parentDir,
    repoRoot,
    cacheRoot,
    identity,
    repoDir: statePaths(identity, { cacheRoot, fs }).repoDir
  };
}

function makeFixture(options) {
  return makeRepo(options);
}

function makeFs(overrides = {}) {
  const events = [];
  const handles = new Map();
  const base = {
    openSync(target, ...rest) {
      const fd = fs.openSync(target, ...rest);
      handles.set(fd, target);
      events.push(`open:${target}`);
      return fd;
    },
    fsyncSync(fd) {
      events.push(`fsync:${handles.has(fd) ? handles.get(fd) : 'unknown'}`);
      return fs.fsyncSync(fd);
    },
    closeSync(fd) {
      handles.delete(fd);
      return fs.closeSync(fd);
    },
    renameSync(from, to) {
      events.push(`rename:${to}`);
      return fs.renameSync(from, to);
    }
  };
  const proxy = new Proxy(fs, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
        const override = overrides[prop];
        return (...args) => override(base[prop] || target[prop], ...args);
      }
      if (Object.prototype.hasOwnProperty.call(base, prop)) return base[prop];
      return target[prop];
    }
  });
  return { fs: proxy, events, handles, base };
}

function fixtureDeps(fixture, options = {}) {
  const calls = [];
  const run = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    return execFileCaptured(command, args, {
      ...opts,
      echoStdout: opts.echoStdout === undefined ? false : opts.echoStdout,
      env: { ...GIT_ENV, ...(opts.env || {}) }
    });
  };
  const spawn = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    return childProcess.spawnSync(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  return {
    run,
    spawn,
    calls,
    fs: options.fs,
    now: options.now || (() => NOW),
    randomUUID: options.randomUUID,
    assertPublishWindow: options.assertPublishWindow || (() => {}),
    withFerryRepoLock: options.withFerryRepoLock || (async (root, callback) => callback())
  };
}

function evidenceOf(fixture, releaseId = RELEASE_ID) {
  const root = path.join(fixture.repoDir, 'records', releaseId, 'version');
  const prepareDir = path.join(root, 'prepare');
  const applyDir = path.join(root, 'apply');
  return {
    root,
    prepareDir,
    applyDir,
    preparedFile: path.join(prepareDir, 'prepared.json'),
    applicationFile: path.join(applyDir, 'application.json'),
    journalFile: path.join(applyDir, 'target.json'),
    patchFile: path.join(applyDir, 'candidate.patch'),
    indexFile: path.join(applyDir, 'index'),
    beforeDir: path.join(prepareDir, DESKTOP_REPO, 'before'),
    afterDir: path.join(prepareDir, DESKTOP_REPO, 'after'),
    beforeFile: (rel) => path.join(prepareDir, DESKTOP_REPO, 'before', rel),
    afterFile: (rel) => path.join(prepareDir, DESKTOP_REPO, 'after', rel)
  };
}

function stateFileOf(fixture) {
  return statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs }).stateFile;
}

function readState(fixture) {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function invoke(fixture, options = {}) {
  const request = {
    identity: options.identity === undefined ? fixture.identity : options.identity,
    repoDir: options.repoDir === undefined ? fixture.repoDir : options.repoDir,
    releaseId: options.releaseId === undefined ? RELEASE_ID : options.releaseId,
    previousVersion: options.previousVersion === undefined ? OLD : options.previousVersion,
    version: options.version === undefined ? NEW : options.version
  };
  return withReleaseLock(fixture.identity, async () => prepareVersionIntent(request, options.deps), {
    cacheRoot: fixture.cacheRoot
  });
}

function refusal(promise) {
  return Promise.resolve(promise).then(() => null, (error) => error);
}

function liveSnapshot(repoRoot) {
  const reflog = path.join(repoRoot, '.git', 'logs', 'HEAD');
  return {
    branch: git(repoRoot, ['symbolic-ref', '-q', 'HEAD']).trim(),
    head: git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    indexFingerprint: sha256(git(repoRoot, ['ls-files', '--stage', '-z'])),
    indexBytes: sha256(fs.readFileSync(path.join(repoRoot, '.git', 'index'))),
    status: git(repoRoot, ['status', '--porcelain=v1', '-z']),
    reflog: fs.existsSync(reflog) ? sha256(fs.readFileSync(reflog)) : null,
    worktree: git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
      .map((name) => `${name}:${sha256(fs.readFileSync(path.join(repoRoot, name)))}`)
  };
}

function gitMutations(calls) {
  return calls
    .filter(([command]) => command === 'git')
    .map(([, ...args]) => args)
    .filter((args) => FORBIDDEN_COMMANDS.includes(args[0]));
}

function expectNoLiveMutation(calls) {
  expect(gitMutations(calls)).toEqual([]);
}

function completeState(fixture) {
  const releaseDir = path.join(fixture.repoDir, 'records', PRIOR_ID);
  return {
    schema: 1,
    revision: 0,
    repo: fixture.identity,
    releaseId: PRIOR_ID,
    version: OLD,
    mode: 'publish',
    phase: 'complete',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    versionIntent: null,
    sourceSha: SOURCE_SHA,
    activeAttemptId: ATTEMPT_ID,
    attempts: [{
      id: ATTEMPT_ID,
      identityKind: 'dispatch',
      version: OLD,
      mode: 'publish',
      sourceSha: SOURCE_SHA,
      dispatchRef: `v${OLD}`,
      workflowPath: '.github/workflows/release.yml',
      workflowId: 12345,
      expectedTitle: `release v${OLD} publish sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`,
      dispatch: 'identified',
      requestedAt: REQUESTED_AT,
      watchDeadlineAt: DEADLINE_AT,
      runId: 456,
      runAttempt: 1,
      runStatus: 'completed',
      conclusion: 'success',
      lastObservedAt: UPDATED_AT,
      error: null
    }],
    artifacts: {
      state: 'complete',
      sourceSha: SOURCE_SHA,
      runId: 456,
      manifestFile: path.join(releaseDir, 'release-info.json'),
      manifestSha256: 'd'.repeat(64),
      verifiedAt: VERIFIED_AT
    },
    sizes: {
      state: 'complete',
      journalFile: path.join(releaseDir, 'sizes', 'target.json'),
      commit: SOURCE_SHA,
      reason: null
    },
    site: {
      state: 'complete',
      sourceSha: SOURCE_SHA,
      treeSha: SOURCE_SHA,
      attemptId: SITE_ATTEMPT_ID,
      receiptSha: SOURCE_SHA,
      verifiedAt: VERIFIED_AT,
      error: null
    },
    docs: {
      hyperclay: {
        state: 'complete',
        journalFile: path.join(releaseDir, 'docs', 'hyperclay', 'target.json'),
        commit: SOURCE_SHA,
        reason: null
      },
      'hyperclay-website': {
        state: 'complete',
        journalFile: path.join(releaseDir, 'docs', 'hyperclay-website', 'target.json'),
        commit: SOURCE_SHA,
        reason: null
      }
    },
    install: { state: 'not-attempted', error: null },
    lastError: null
  };
}

function pendingState(fixture, releaseId) {
  const releaseDir = path.join(fixture.repoDir, 'records', releaseId);
  return createReleaseState({
    releaseId,
    version: NEW,
    mode: 'publish',
    at: CREATED_AT,
    sourceSha: null,
    versionIntent: {
      previousVersion: OLD,
      version: NEW,
      baseHead: 'b'.repeat(40),
      journalFile: path.join(releaseDir, 'version', 'apply', 'target.json'),
      files: [{
        path: 'package.json',
        beforeSha256: 'c'.repeat(64),
        afterSha256: 'e'.repeat(64),
        beforeMode: 0o644,
        afterMode: 0o644,
        preparedFile: path.join(releaseDir, 'version', 'prepare', DESKTOP_REPO, 'after', 'package.json')
      }]
    }
  }, fixture.identity, { repoDir: fixture.repoDir });
}

describe('desktop source intent', () => {
  test('exports only the version intent entry point', () => {
    expect(Object.keys(require('../../scripts/release-source'))).toEqual(['prepareVersionIntent', 'reconcileVersionIntent']);
  });

  test('refuses invalid dependencies, release ids, versions and cache paths before touching a checkout', async () => {
    const deps = { run: () => '', spawn: () => ({}), fs, now: () => NOW };
    const cases = [
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: OLD, version: NEW }, deps],
      [{ identity: {}, repoDir: 'relative/cache', releaseId: RELEASE_ID, previousVersion: OLD, version: NEW }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: 'not-a-uuid', previousVersion: OLD, version: NEW }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: '../escape', previousVersion: OLD, version: NEW }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: OLD, version: OLD }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: OLD, version: '1.27.9' }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: '1.28', version: NEW }, deps],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: OLD, version: NEW }, { ...deps, run: 'git' }],
      [{ identity: {}, repoDir: '/tmp/nowhere', releaseId: RELEASE_ID, previousVersion: OLD, version: NEW }, null]
    ];
    for (const [input, injected] of cases) {
      const error = await refusal(Promise.resolve().then(() => prepareVersionIntent(input, injected)));
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('RELEASE_SOURCE_INVALID');
    }
  });

  testPosix('persists the exact version intent and its retained evidence without touching the checkout', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    const recorder = makeFs();
    const deps = fixtureDeps(fixture, { fs: recorder.fs });

    expect(readState(fixture)).toBeNull();
    expect(fs.existsSync(evidence.root)).toBe(false);
    const before = liveSnapshot(fixture.repoRoot);

    const state = await invoke(fixture, { deps });

    const application = readJson(evidence.applicationFile);
    const descriptor = readJson(evidence.preparedFile);

    expect(state.phase).toBe('version-preparing');
    expect(state.revision).toBe(0);
    expect(state.sourceSha).toBeNull();
    expect(state.createdAt).toBe(new Date(NOW).toISOString());
    expect(readState(fixture)).toEqual(state);

    expect(descriptor.runDir).toBe(evidence.prepareDir);
    expect(descriptor.targets).toHaveLength(1);
    expect(descriptor.targets[0].repo).toBe(DESKTOP_REPO);
    expect(descriptor.targets[0].sourcePath).toBe('package.json');
    expect(descriptor.targets[0].versionPreparation).toEqual({ previousVersion: OLD });
    expect(descriptor.targets[0].paths.map((entry) => entry.path)).toEqual(REQUIRED_PATHS);
    for (const entry of descriptor.targets[0].paths) {
      expect(entry.beforeFile).toBe(evidence.beforeFile(entry.path));
      expect(entry.afterFile).toBe(evidence.afterFile(entry.path));
    }

    expect(application.repo).toBe(DESKTOP_REPO);
    expect(application.repoRoot).toBe(fixture.repoRoot);
    expect(application.sourcePath).toBe('package.json');
    expect(application.requiredPaths).toEqual(REQUIRED_PATHS);
    expect(application.preparedFile).toBe(evidence.preparedFile);
    expect(application.patchFile).toBe(evidence.patchFile);
    expect(application.privateIndexFile).toBe(evidence.indexFile);
    expect(application.files.map((file) => file.path)).toEqual(REQUIRED_PATHS);
    expect(application.files.find((file) => file.path === 'package.json').changed).toBe(true);
    expect(application.paths).toContain('package.json');
    expect(application.paths.length).toBeGreaterThan(0);
    expect(fs.statSync(evidence.patchFile).size).toBeGreaterThan(0);
    expect(fs.statSync(evidence.indexFile).size).toBeGreaterThan(0);
    expect(fs.readFileSync(evidence.afterFile('package.json'), 'utf8')).toContain(`"version": "${NEW}"`);
    expect(fs.readFileSync(evidence.beforeFile('package.json'), 'utf8')).toContain(`"version": "${OLD}"`);
    expect(fs.readdirSync(evidence.root).sort()).toEqual(['apply', 'prepare']);

    const expectedIntent = {
      previousVersion: OLD,
      version: NEW,
      baseHead: application.beforeHead,
      journalFile: evidence.journalFile,
      files: application.files.map((file) => ({
        path: file.path,
        beforeSha256: file.beforeSha256,
        afterSha256: file.afterSha256,
        beforeMode: 0o644,
        afterMode: 0o644,
        preparedFile: file.afterFile
      }))
    };
    expect(state.versionIntent).toEqual(expectedIntent);
    expect(application.beforeHead).toBe(before.head);

    expect(fs.existsSync(evidence.journalFile)).toBe(false);
    expectNoLiveMutation(deps.calls);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);

    const evidenceFiles = [
      evidence.preparedFile,
      evidence.applicationFile,
      evidence.patchFile,
      evidence.indexFile,
      evidence.beforeFile('README.md'),
      evidence.afterFile('README.md'),
      evidence.beforeFile('package.json'),
      evidence.afterFile('package.json'),
      evidence.beforeFile('website/index.html'),
      evidence.afterFile('website/index.html')
    ];
    const renameIndex = recorder.events.indexOf(`rename:${stateFile}`);
    expect(renameIndex).toBeGreaterThan(-1);
    for (const file of evidenceFiles) {
      const flushIndex = recorder.events.indexOf(`fsync:${file}`);
      expect(flushIndex).toBeGreaterThan(-1);
      expect(flushIndex).toBeLessThan(renameIndex);
    }
    for (const dir of [
      evidence.prepareDir,
      evidence.applyDir,
      evidence.afterDir,
      evidence.beforeDir,
      evidence.root,
      path.join(fixture.repoDir, 'records'),
      fixture.repoDir
    ]) {
      expect(recorder.events).toContain(`fsync:${dir}`);
    }
    expect(recorder.events.lastIndexOf(`fsync:${fixture.repoDir}`)).toBeGreaterThan(renameIndex);
    expect(fs.existsSync(path.join(fixture.cacheRoot, 'locks/releases'))).toBe(true);
  });

  testPosix('refuses a pending lane and an orphaned evidence directory', async () => {
    const fixture = makeFixture();
    const deps = fixtureDeps(fixture);
    writeReleaseState(pendingState(fixture, PRIOR_ID), fixture.identity, {
      cacheRoot: fixture.cacheRoot, expectedRevision: null, fs
    });

    const pending = await refusal(invoke(fixture, { deps }));
    expect(pending.code).toBe('RELEASE_SOURCE_INVALID');
    expect(pending.message).toContain('version-preparing');
    expect(fs.existsSync(evidenceOf(fixture).root)).toBe(false);
    expectNoLiveMutation(deps.calls);

    const orphan = makeFixture();
    const orphanEvidence = evidenceOf(orphan);
    fs.mkdirSync(orphanEvidence.root, { recursive: true });
    write(orphanEvidence.root, 'stale.txt', 'interrupted preparation\n');
    const orphanBytes = fs.readFileSync(path.join(orphanEvidence.root, 'stale.txt'));
    const orphanDeps = fixtureDeps(orphan);

    const refused = await refusal(invoke(orphan, { deps: orphanDeps }));
    expect(refused.code).toBe('RELEASE_SOURCE_INVALID');
    expect(refused.message).toContain('already exists');
    expect(fs.readFileSync(path.join(orphanEvidence.root, 'stale.txt'))).toEqual(orphanBytes);
    expect(readState(orphan)).toBeNull();
    expectNoLiveMutation(orphanDeps.calls);
  });

  testPosix('refuses a mismatched identity, cache path and repository name', async () => {
    const fixture = makeFixture();
    const other = makeFixture();
    const deps = fixtureDeps(fixture);

    const drifted = await refusal(invoke(fixture, {
      deps,
      identity: { ...fixture.identity, pushUrlSha256: 'f'.repeat(64) }
    }));
    expect(drifted.code).toBe('RELEASE_SOURCE_INVALID');
    expect(drifted.message).toContain('pushUrlSha256');

    const elsewhere = await refusal(invoke(fixture, { deps, identity: other.identity }));
    expect(elsewhere.code).toBe('RELEASE_SOURCE_INVALID');

    const wrongDir = await refusal(invoke(fixture, {
      deps,
      repoDir: path.join(fixture.cacheRoot, 'other-repository')
    }));
    expect(wrongDir.code).toBe('RELEASE_SOURCE_INVALID');
    expect(wrongDir.message).toContain('cache directory');

    const renamed = makeFixture({ directory: 'hyperclay' });
    const renamedDeps = fixtureDeps(renamed);
    const wrongName = await refusal(invoke(renamed, { deps: renamedDeps }));
    expect(wrongName.code).toBe('RELEASE_SOURCE_INVALID');
    expect(wrongName.message).toContain(DESKTOP_REPO);

    expect(fs.existsSync(evidenceOf(fixture).root)).toBe(false);
    expect(readState(fixture)).toBeNull();
    expectNoLiveMutation(deps.calls);
  });

  testPosix('archives a completed release before replacing the lane with a fresh intent', async () => {
    const fixture = makeFixture();
    const deps = fixtureDeps(fixture);
    writeReleaseState(completeState(fixture), fixture.identity, {
      cacheRoot: fixture.cacheRoot, expectedRevision: null, fs
    });
    const completedBytes = fs.readFileSync(stateFileOf(fixture));

    const reused = await refusal(invoke(fixture, { deps, releaseId: PRIOR_ID }));
    expect(reused.code).toBe('RELEASE_SOURCE_INVALID');
    expect(reused.message).toContain('fresh release identifier');
    expect(fs.readFileSync(stateFileOf(fixture))).toEqual(completedBytes);

    const lowered = await refusal(invoke(fixture, { deps, previousVersion: '1.27.0', version: OLD }));
    expect(lowered.code).toBe('RELEASE_SOURCE_INVALID');
    expect(lowered.message).toContain('greater than the completed release');
    expect(fs.readFileSync(stateFileOf(fixture))).toEqual(completedBytes);

    const state = await invoke(fixture, { deps });

    expect(state.releaseId).toBe(RELEASE_ID);
    expect(state.revision).toBe(0);
    expect(state.phase).toBe('version-preparing');
    expect(readState(fixture)).toEqual(state);
    const archived = path.join(fixture.repoDir, 'history', `${PRIOR_ID}.json`);
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.readFileSync(archived)).toEqual(completedBytes);
    expect(fs.existsSync(evidenceOf(fixture).applicationFile)).toBe(true);
    expectNoLiveMutation(deps.calls);
  });

  testPosix('refuses dirty selected files without publishing an intent', async () => {
    const fixture = makeFixture();
    const deps = fixtureDeps(fixture);
    write(fixture.repoRoot, 'README.md', `${readmeFixture(OLD)}extra\n`);

    const error = await refusal(invoke(fixture, { deps }));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/pending changes|does not match the recorded HEAD snapshot/);
    expect(readState(fixture)).toBeNull();
    expect(fs.existsSync(evidenceOf(fixture).applicationFile)).toBe(false);
    expectNoLiveMutation(deps.calls);
  });

  testPosix('stops on a selected evidence flush failure before any lane write', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const recorder = makeFs({
      fsyncSync(next, fd) {
        if (recorder.handles.get(fd) === evidence.afterFile('package.json')) {
          throw Object.assign(new Error('injected fsync failure'), { code: 'EIO' });
        }
        return next(fd);
      }
    });
    const deps = fixtureDeps(fixture, { fs: recorder.fs });
    const before = liveSnapshot(fixture.repoRoot);

    const error = await refusal(invoke(fixture, { deps }));

    expect(error.code).toBe('RELEASE_SOURCE_IO_FAILED');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.code).toBe('EIO');
    expect(fs.existsSync(stateFileOf(fixture))).toBe(false);
    expect(readState(fixture)).toBeNull();
    expect(recorder.events.some((event) => event.startsWith('rename:'))).toBe(false);
    expectNoLiveMutation(deps.calls);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('stops on a lane rename or directory flush failure without returning an intent', async () => {
    const renameFixture = makeFixture();
    const stateFile = stateFileOf(renameFixture);
    const renameFs = makeFs({
      renameSync(next, from, to) {
        if (to === stateFile) throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
        return next(from, to);
      }
    });
    const renameDeps = fixtureDeps(renameFixture, { fs: renameFs.fs });

    const renameError = await refusal(invoke(renameFixture, { deps: renameDeps }));
    expect(renameError.code).toBe('STATE_IO_FAILED');
    expect(fs.existsSync(stateFile)).toBe(false);
    expect(readState(renameFixture)).toBeNull();
    expectNoLiveMutation(renameDeps.calls);

    const flushFixture = makeFixture();
    const flushStateFile = stateFileOf(flushFixture);
    let published = false;
    const flushFs = makeFs({
      renameSync(next, from, to) {
        if (to === flushStateFile) published = true;
        return next(from, to);
      },
      fsyncSync(next, fd) {
        if (published && flushFs.handles.get(fd) === flushFixture.repoDir) {
          throw Object.assign(new Error('injected directory flush failure'), { code: 'EIO' });
        }
        return next(fd);
      }
    });
    const flushDeps = fixtureDeps(flushFixture, { fs: flushFs.fs });

    const flushError = await refusal(invoke(flushFixture, { deps: flushDeps }));
    expect(flushError.code).toBe('STATE_IO_FAILED');
    expect(fs.existsSync(flushStateFile)).toBe(true);
    expectNoLiveMutation(flushDeps.calls);
  });

  testPosix('refuses altered retained evidence before publication', async () => {
    const bytesFixture = makeFixture();
    const bytesEvidence = evidenceOf(bytesFixture);
    const bytesFs = makeFs({
      openSync(next, target, ...rest) {
        if (target === bytesEvidence.afterFile('package.json')) {
          fs.writeFileSync(target, 'tampered after image\n');
        }
        return next(target, ...rest);
      }
    });
    const bytesDeps = fixtureDeps(bytesFixture, { fs: bytesFs.fs });

    const bytesError = await refusal(invoke(bytesFixture, { deps: bytesDeps }));
    expect(bytesError.code).toBe('DOCS_APPLICATION_INVALID');
    expect(fs.existsSync(stateFileOf(bytesFixture))).toBe(false);
    expectNoLiveMutation(bytesDeps.calls);

    const referenceFixture = makeFixture();
    const referenceEvidence = evidenceOf(referenceFixture);
    const referenceFs = makeFs({
      openSync(next, target, ...rest) {
        if (target === referenceEvidence.applicationFile) {
          const record = readJson(target);
          record.preparedFile = path.join(referenceEvidence.prepareDir, 'prepared-copy.json');
          fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
        }
        return next(target, ...rest);
      }
    });
    const referenceDeps = fixtureDeps(referenceFixture, { fs: referenceFs.fs });

    const referenceError = await refusal(invoke(referenceFixture, { deps: referenceDeps }));
    expect(referenceError.code).toBe('DOCS_APPLICATION_INVALID');
    expect(fs.existsSync(stateFileOf(referenceFixture))).toBe(false);
    expectNoLiveMutation(referenceDeps.calls);
  });

  testPosix('refuses a symlinked evidence component before publication', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const moved = path.join(OWNER, `moved-after-${++seq}`);
    let swapped = false;
    const deps = fixtureDeps(fixture, {
      fs: makeFs({
        lstatSync(next, target) {
          if (target === evidence.afterDir && !swapped) {
            swapped = true;
            fs.renameSync(evidence.afterDir, moved);
            fs.symlinkSync(moved, evidence.afterDir);
          }
          return next(target);
        }
      }).fs
    });

    const error = await refusal(invoke(fixture, { deps }));

    expect(swapped).toBe(true);
    expect(error.code).toBe('RELEASE_SOURCE_INVALID');
    expect(error.message).toContain('symlink');
    expect(fs.existsSync(stateFileOf(fixture))).toBe(false);
    expectNoLiveMutation(deps.calls);
  });

  testPosix('refuses an altered durable intent or reference after publication', async () => {
    const hashFixture = makeFixture();
    const hashStateFile = stateFileOf(hashFixture);
    const hashDeps = fixtureDeps(hashFixture, {
      fs: makeFs({
        renameSync(next, from, to) {
          const result = next(from, to);
          if (to === hashStateFile) {
            const record = readJson(hashStateFile);
            record.versionIntent.files[0].afterSha256 = '9'.repeat(64);
            fs.writeFileSync(hashStateFile, `${JSON.stringify(record)}\n`);
          }
          return result;
        }
      }).fs
    });

    const hashError = await refusal(invoke(hashFixture, { deps: hashDeps }));
    expect(hashError.code).toBe('RELEASE_SOURCE_INVALID');
    expect(hashError.message).toContain('does not match the verified version application');
    expect(readJson(hashStateFile).versionIntent.files[0].afterSha256).toBe('9'.repeat(64));
    expectNoLiveMutation(hashDeps.calls);

    const referenceFixture = makeFixture();
    const referenceStateFile = stateFileOf(referenceFixture);
    const referenceDeps = fixtureDeps(referenceFixture, {
      fs: makeFs({
        renameSync(next, from, to) {
          const result = next(from, to);
          if (to === referenceStateFile) {
            const record = readJson(referenceStateFile);
            record.versionIntent.journalFile = path.join(
              referenceFixture.repoDir, 'records', RELEASE_ID, 'version', 'apply', 'other.json'
            );
            fs.writeFileSync(referenceStateFile, `${JSON.stringify(record)}\n`);
          }
          return result;
        }
      }).fs
    });

    const referenceError = await refusal(invoke(referenceFixture, { deps: referenceDeps }));
    expect(referenceError.code).toBe('RELEASE_SOURCE_INVALID');
    expect(referenceError.message).toContain('derived target journal');
    expectNoLiveMutation(referenceDeps.calls);
  });
});

// Step B of the desktop source wrapper: recover one retained version operation
// through the accepted application and target-evidence engines. Every remote
// invocation is routed to an owned local bare repository; the GitHub-shaped
// origin identity is never handed to a native child.

const MUTATING_GIT = ['commit', 'commit-tree', 'update-ref', 'apply', 'push', 'fetch', 'tag'];

function actingCalls() {
  return ACTING_NAMES.map((name) => actingSpy[name].mock.calls.length);
}

function makeBare(fixture) {
  const bare = path.join(OWNER, `bare-${++seq}.git`);
  git(OWNER, ['init', '-q', '--bare', bare]);
  git(fixture.repoRoot, ['push', '-q', bare, 'main:refs/heads/main']);
  return bare;
}

function bareMain(bare) {
  return git(bare, ['rev-parse', 'refs/heads/main']).trim();
}

function remoteAdapter(options = {}) {
  const calls = [];
  const counts = { 'ls-remote': 0, fetch: 0, push: 0 };
  const guard = options.guard === true;
  const spawnRemote = (command, args, opts = {}) => {
    const argv = Array.isArray(args) ? args.slice() : [];
    calls.push([command, ...argv]);
    if (command !== 'git') throw new Error(`unexpected remote command: ${command}`);
    const verb = argv[0];
    if (!Object.prototype.hasOwnProperty.call(counts, verb)) {
      throw new Error(`unexpected remote invocation: git ${argv.join(' ')}`);
    }
    counts[verb] += 1;
    if (verb === 'ls-remote') {
      if (argv.length !== 4 || argv[1] !== '--refs' || argv[2] !== ORIGIN || argv[3] !== 'refs/heads/main') {
        throw new Error(`unexpected remote listing: git ${argv.join(' ')}`);
      }
    } else if (verb === 'fetch') {
      if (argv.length !== 5 || argv[1] !== '--no-tags' || argv[2] !== '--no-write-fetch-head'
        || argv[3] !== ORIGIN || !/^[0-9a-f]{40,64}$/.test(argv[4])) {
        throw new Error(`unexpected remote fetch: git ${argv.join(' ')}`);
      }
    } else if (argv.length !== 4 || argv[1] !== '--porcelain' || argv[2] !== ORIGIN
      || !/^[0-9a-f]{40,64}:refs\/heads\/main$/.test(argv[3])) {
      throw new Error(`unexpected remote push: git ${argv.join(' ')}`);
    }
    if (guard) throw new Error(`guarded remote call: git ${argv.join(' ')}`);
    if (options.fail !== undefined) {
      const failure = options.fail(verb, counts);
      if (failure !== null && failure !== undefined) throw failure;
    }
    const rewritten = argv.slice();
    rewritten[verb === 'fetch' ? 3 : 2] = options.bare;
    if (rewritten.includes(ORIGIN)) {
      throw new Error(`provider identity reached a native child: git ${rewritten.join(' ')}`);
    }
    return childProcess.spawnSync('git', rewritten, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  return { calls, counts, spawnRemote, bare: options.bare };
}

function recoveryDeps(fixture, options = {}) {
  const remote = options.remote === undefined
    ? remoteAdapter({
      bare: options.bare === undefined ? makeBare(fixture) : options.bare,
      guard: options.guard,
      fail: options.fail
    })
    : options.remote;
  const ferryCalls = options.ferryCalls === undefined ? [] : options.ferryCalls;
  const ferry = options.withFerryRepoLock === undefined
    ? async (root, callback) => {
      ferryCalls.push(root);
      return callback();
    }
    : options.withFerryRepoLock;
  const base = fixtureDeps(fixture, {
    fs: options.fs,
    now: options.now,
    randomUUID: options.randomUUID,
    assertPublishWindow: options.assertPublishWindow,
    withFerryRepoLock: ferry
  });
  const guard = options.guard === true;
  const guarded = (command, args) => guard && command === 'git'
    && Array.isArray(args) && MUTATING_GIT.includes(args[0]);
  const run = (command, args, opts = {}) => {
    if (guarded(command, args)) throw new Error(`guarded mutation: git ${args.join(' ')}`);
    const result = base.run(command, args, opts);
    if (options.afterRun !== undefined) options.afterRun(command, args, result);
    return result;
  };
  const spawn = (command, args, opts = {}) => {
    if (guarded(command, args)) throw new Error(`guarded mutation: git ${args.join(' ')}`);
    const result = base.spawn(command, args, opts);
    if (options.afterSpawn !== undefined) options.afterSpawn(command, args, result);
    return result;
  };
  return {
    run,
    spawn,
    calls: base.calls,
    fs: base.fs,
    now: base.now,
    randomUUID: base.randomUUID,
    assertPublishWindow: base.assertPublishWindow,
    withFerryRepoLock: base.withFerryRepoLock,
    spawnRemote: remote.spawnRemote,
    remote,
    bare: remote.bare,
    ferryCalls
  };
}

function recoveryOnlyDeps(fixture, options = {}) {
  const deps = recoveryDeps(fixture, { ...options, guard: options.guard === undefined ? true : options.guard });
  delete deps.assertPublishWindow;
  return deps;
}

function recover(fixture, options = {}) {
  const request = {
    identity: options.identity === undefined ? fixture.identity : options.identity,
    repoDir: options.repoDir === undefined ? fixture.repoDir : options.repoDir
  };
  if (options.reconcileOnly !== undefined) request.reconcileOnly = options.reconcileOnly;
  return withReleaseLock(fixture.identity, async () => reconcileVersionIntent(request, options.deps), {
    cacheRoot: fixture.cacheRoot
  });
}

function gitVerb(calls, verb) {
  return calls.filter(([command, ...args]) => command === 'git' && args[0] === verb).length;
}

function stalledLaneFs(stateFile) {
  return makeFs({
    renameSync(next, from, to) {
      if (to === stateFile) throw Object.assign(new Error('injected lane failure'), { code: 'EIO' });
      return next(from, to);
    }
  }).fs;
}

async function stallStateLane(fixture) {
  const deps = recoveryDeps(fixture, { fs: stalledLaneFs(stateFileOf(fixture)) });
  const error = await refusal(recover(fixture, { deps }));
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('STATE_IO_FAILED');
  return deps;
}

describe('desktop source recovery', () => {
  testPosix('binds a missing-journal operation once', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const prepared = await invoke(fixture, { deps: fixtureDeps(fixture) });
    expect(prepared.phase).toBe('version-preparing');
    expect(fs.existsSync(evidence.journalFile)).toBe(false);

    const deps = recoveryDeps(fixture);
    const state = await recover(fixture, { deps });

    expect(state.phase).toBe('source-ready');
    expect(state.revision).toBe(1);
    expect(state.versionIntent).toBeNull();
    expect(readState(fixture)).toEqual(state);

    const journal = readJson(evidence.journalFile);
    expect(journal.phase).toBe('complete');
    expect(journal.state).toBe('complete');
    expect(state.sourceSha).toBe(journal.commit);
    expect(bareMain(deps.bare)).toBe(journal.commit);

    expect(gitVerb(deps.calls, 'commit-tree')).toBe(1);
    expect(gitVerb(deps.calls, 'update-ref')).toBe(1);
    expect(deps.remote.counts.push).toBe(1);
    expect(deps.remote.counts['ls-remote']).toBe(2);
    expect(deps.remote.counts.fetch).toBe(0);
    expect(deps.calls.filter(([command]) => command !== 'git')).toEqual([]);
    expect(deps.calls.filter(([, ...args]) => ['tag', 'workflow', 'gh'].includes(args[0]))).toEqual([]);
  });

  testPosix('resumes a durable candidate without a second commit', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });

    const marker = { advanced: false, armed: true };
    const deps = recoveryDeps(fixture, {
      fs: makeFs({
        renameSync(next, from, to) {
          if (to === evidence.journalFile && marker.armed && marker.advanced) {
            throw Object.assign(new Error('injected journal publication failure'), { code: 'EIO' });
          }
          return next(from, to);
        }
      }).fs,
      afterRun(command, args) {
        if (command === 'git' && args[0] === 'update-ref') marker.advanced = true;
      }
    });

    const first = await refusal(recover(fixture, { deps }));
    expect(first).toBeInstanceOf(Error);
    expect(first.code).toBe('DOCS_JOURNAL_WRITE_FAILED');

    const durable = readJson(evidence.journalFile);
    expect(durable.phase).toBe('ref-intent');
    expect(durable.state).toBe('failed');
    expect(durable.commit).toBeNull();
    expect(durable.candidateCommit).not.toBeNull();
    expect(gitVerb(deps.calls, 'commit-tree')).toBe(1);
    expect(deps.remote.counts.push).toBe(0);

    marker.armed = false;
    const state = await recover(fixture, { deps });

    expect(state.phase).toBe('source-ready');
    expect(state.revision).toBe(1);
    expect(state.sourceSha).toBe(durable.candidateCommit);
    expect(readState(fixture)).toEqual(state);
    expect(readJson(evidence.journalFile).commit).toBe(durable.candidateCommit);
    expect(gitVerb(deps.calls, 'commit-tree')).toBe(1);
    expect(deps.remote.counts.push).toBe(1);
  });

  testPosix('completes a push that was not recorded', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });

    const marker = { armed: true };
    const deps = recoveryDeps(fixture, {
      fail(verb, counts) {
        if (marker.armed && verb === 'ls-remote' && counts.push > 0) {
          return Object.assign(new Error('injected observation failure'), { code: 'EIO' });
        }
        return null;
      }
    });

    const first = await refusal(recover(fixture, { deps }));
    expect(first).toBeInstanceOf(Error);
    expect(first.code).toBe('DOCS_REMOTE_PUSH_UNCONFIRMED');
    expect(deps.remote.counts.push).toBe(1);

    const durable = readJson(evidence.journalFile);
    expect(durable.phase).toBe('push-intent');
    expect(durable.state).toBe('pending-push');
    expect(durable.commit).not.toBeNull();
    expect(bareMain(deps.bare)).toBe(durable.commit);

    marker.armed = false;
    const state = await recover(fixture, { deps });

    expect(state.phase).toBe('source-ready');
    expect(state.sourceSha).toBe(durable.commit);
    expect(readState(fixture)).toEqual(state);
    expect(deps.remote.counts.push).toBe(1);
    expect(gitVerb(deps.calls, 'commit-tree')).toBe(1);
  });

  testPosix('preserves a state-store rename failure after target completion', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });

    const first = await refusal(recover(fixture, { deps: recoveryDeps(fixture, { fs: stalledLaneFs(stateFile) }) }));
    expect(first).toBeInstanceOf(Error);
    expect(first.code).toBe('STATE_IO_FAILED');
    expect(first.message).toContain('record publication');
    expect(fs.existsSync(stateFile)).toBe(true);

    const journal = readJson(evidence.journalFile);
    expect(journal.phase).toBe('complete');
    expect(journal.state).toBe('complete');
    expect(readState(fixture).phase).toBe('version-preparing');

    const next = recoveryDeps(fixture);
    const state = await recover(fixture, { deps: next });

    expect(state.phase).toBe('source-ready');
    expect(state.revision).toBe(1);
    expect(state.sourceSha).toBe(journal.commit);
    expect(readState(fixture)).toEqual(state);
    expect(gitVerb(next.calls, 'commit-tree')).toBe(0);
    expect(gitVerb(next.calls, 'update-ref')).toBe(0);
    expect(gitVerb(next.calls, 'apply')).toBe(0);
    expect(next.remote.calls).toEqual([]);
  });

  testPosix('preserves a state-store flush failure after target completion', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    const laneDir = path.dirname(stateFile);
    await invoke(fixture, { deps: fixtureDeps(fixture) });

    let published = false;
    const recorder = makeFs({
      renameSync(next, from, to) {
        const result = next(from, to);
        if (to === stateFile) published = true;
        return result;
      },
      fsyncSync(next, fd) {
        if (published && recorder.handles.get(fd) === laneDir) {
          throw Object.assign(new Error('injected directory flush failure'), { code: 'EIO' });
        }
        return next(fd);
      },
      closeSync(next, fd) {
        const target = recorder.handles.get(fd);
        const result = next(fd);
        if (published && target === laneDir) {
          throw Object.assign(new Error('injected close failure'), { code: 'EIO' });
        }
        return result;
      }
    });

    const first = await refusal(recover(fixture, { deps: recoveryDeps(fixture, { fs: recorder.fs }) }));
    expect(first).toBeInstanceOf(Error);
    expect(first.code).toBe('STATE_IO_FAILED');
    expect(first.message).toContain('record directory flush');
    expect(first.cause).toBeInstanceOf(Error);
    expect(first.cause.message).toBe('injected directory flush failure');
    expect(fs.existsSync(stateFile)).toBe(true);

    const journal = readJson(evidence.journalFile);
    expect(journal.phase).toBe('complete');
    expect(readState(fixture).phase).toBe('source-ready');

    const bytes = fs.readFileSync(stateFile);
    const next = recoveryDeps(fixture);
    const state = await recover(fixture, { deps: next });

    expect(state.phase).toBe('source-ready');
    expect(state.revision).toBe(1);
    expect(state.sourceSha).toBe(journal.commit);
    expect(fs.readFileSync(stateFile)).toEqual(bytes);
    expect(gitVerb(next.calls, 'commit-tree')).toBe(0);
    expect(gitVerb(next.calls, 'update-ref')).toBe(0);
    expect(gitVerb(next.calls, 'apply')).toBe(0);
    expect(next.remote.calls).toEqual([]);
  });

  testPosix('reports pending without acting for reconciliation-only', async () => {
    const missing = makeFixture();
    const missingEvidence = evidenceOf(missing);
    const missingStateFile = stateFileOf(missing);
    await invoke(missing, { deps: fixtureDeps(missing) });
    const missingBytes = fs.readFileSync(missingStateFile);
    const missingDeps = recoveryOnlyDeps(missing);
    const before = actingCalls();

    const pending = await refusal(recover(missing, { deps: missingDeps, reconcileOnly: true }));
    expect(pending).toBeInstanceOf(Error);
    expect(pending.code).toBe('RELEASE_SOURCE_PENDING');
    expect(fs.existsSync(missingEvidence.journalFile)).toBe(false);
    expect(fs.readFileSync(missingStateFile)).toEqual(missingBytes);
    expect(gitVerb(missingDeps.calls, 'commit-tree')).toBe(0);
    expect(gitVerb(missingDeps.calls, 'apply')).toBe(0);
    expect(gitVerb(missingDeps.calls, 'update-ref')).toBe(0);
    expect(missingDeps.remote.calls).toEqual([]);
    expect(missingDeps.ferryCalls).toEqual([]);
    expect(actingCalls()).toEqual(before);

    const unfinished = makeFixture();
    const unfinishedEvidence = evidenceOf(unfinished);
    const unfinishedStateFile = stateFileOf(unfinished);
    await invoke(unfinished, { deps: fixtureDeps(unfinished) });
    const candidateDeps = fixtureDeps(unfinished);
    candidateDeps.cacheRoot = unfinished.cacheRoot;
    await withReleaseLock(unfinished.identity, async () => actingOriginal.prepareCommitIntent({
      applicationFile: unfinishedEvidence.applicationFile,
      journalFile: unfinishedEvidence.journalFile,
      message: `chore: release v${NEW}`
    }, candidateDeps), { cacheRoot: unfinished.cacheRoot });
    const journalBytes = fs.readFileSync(unfinishedEvidence.journalFile);
    const unfinishedBytes = fs.readFileSync(unfinishedStateFile);
    expect(readJson(unfinishedEvidence.journalFile).phase).toBe('apply-intent');

    const unfinishedDeps = recoveryOnlyDeps(unfinished);
    const held = await refusal(recover(unfinished, { deps: unfinishedDeps, reconcileOnly: true }));
    expect(held).toBeInstanceOf(Error);
    expect(held.code).toBe('RELEASE_SOURCE_PENDING');
    expect(fs.readFileSync(unfinishedEvidence.journalFile)).toEqual(journalBytes);
    expect(fs.readFileSync(unfinishedStateFile)).toEqual(unfinishedBytes);
    expect(gitVerb(unfinishedDeps.calls, 'commit-tree')).toBe(0);
    expect(gitVerb(unfinishedDeps.calls, 'apply')).toBe(0);
    expect(gitVerb(unfinishedDeps.calls, 'update-ref')).toBe(0);
    expect(unfinishedDeps.remote.calls).toEqual([]);
    expect(unfinishedDeps.ferryCalls).toEqual([]);
    expect(actingCalls()).toEqual(before);
  });

  testPosix('binds a completed journal without acting', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });
    await stallStateLane(fixture);

    const journal = readJson(evidence.journalFile);
    expect(journal.phase).toBe('complete');
    expect(readState(fixture).phase).toBe('version-preparing');

    write(fixture.repoRoot, 'src/unrelated.txt', 'unrelated\n');
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'unrelated change']);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(journal.commit);
    write(fixture.repoRoot, 'README.md', `${readmeFixture(NEW)}extra\n`);

    const before = actingCalls();
    const bindDeps = recoveryOnlyDeps(fixture);
    const state = await recover(fixture, { deps: bindDeps, reconcileOnly: true });

    expect(state.phase).toBe('source-ready');
    expect(state.revision).toBe(1);
    expect(state.sourceSha).toBe(journal.commit);
    expect(state.versionIntent).toBeNull();
    expect(readState(fixture)).toEqual(state);
    expect(actingCalls()).toEqual(before);
    expect(bindDeps.remote.calls).toEqual([]);
    expect(bindDeps.ferryCalls).toEqual([]);

    const bytes = fs.readFileSync(stateFile);
    const againDeps = recoveryOnlyDeps(fixture);
    const again = await recover(fixture, { deps: againDeps, reconcileOnly: true });

    expect(again).toEqual(state);
    expect(readState(fixture)).toEqual(state);
    expect(fs.readFileSync(stateFile)).toEqual(bytes);
    expect(actingCalls()).toEqual(before);
    expect(againDeps.remote.calls).toEqual([]);
  });

  testPosix('refuses a source-ready release without its completed journal', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });
    await stallStateLane(fixture);
    const journalBytes = fs.readFileSync(evidence.journalFile);
    const bound = await recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true });
    expect(bound.phase).toBe('source-ready');
    const before = actingCalls();

    fs.unlinkSync(evidence.journalFile);
    const missing = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(missing).toBeInstanceOf(Error);
    expect(missing.code).toBe('RELEASE_SOURCE_INVALID');
    expect(missing.code).not.toBe('RELEASE_SOURCE_PENDING');
    expect(missing.message).toContain('not complete');
    expect(readState(fixture)).toEqual(bound);

    const truncated = { ...JSON.parse(journalBytes.toString('utf8')), phase: 'committed', state: 'pending-push', reason: null };
    fs.writeFileSync(evidence.journalFile, `${JSON.stringify(truncated)}\n`);
    const unfinished = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(unfinished).toBeInstanceOf(Error);
    expect(unfinished.code).toBe('RELEASE_SOURCE_INVALID');
    expect(unfinished.code).not.toBe('RELEASE_SOURCE_PENDING');
    expect(unfinished.message).toContain('not complete');
    expect(readState(fixture)).toEqual(bound);
    expect(actingCalls()).toEqual(before);
  });

  testPosix('refuses malformed and altered retained evidence before acting', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });
    const stateBytes = fs.readFileSync(stateFile);
    const before = actingCalls();

    write(evidence.applyDir, 'target.json', '{ not json');
    const malformed = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(malformed).toBeInstanceOf(Error);
    expect(malformed.code).toBe('RELEASE_SOURCE_INVALID');
    expect(malformed.message).toContain('not valid JSON');
    expect(fs.readFileSync(evidence.journalFile)).toEqual(Buffer.from('{ not json'));

    const readFailure = recoveryOnlyDeps(fixture, {
      fs: makeFs({
        openSync(next, target, ...rest) {
          if (target === evidence.journalFile) {
            throw Object.assign(new Error('injected journal read failure'), { code: 'EIO' });
          }
          return next(target, ...rest);
        }
      }).fs
    });
    const unreadable = await refusal(recover(fixture, { deps: readFailure, reconcileOnly: true }));
    expect(unreadable).toBeInstanceOf(Error);
    expect(unreadable.code).toBe('LOCAL_EVIDENCE_READ_FAILED');
    expect(unreadable.cause).toBeInstanceOf(Error);
    expect(unreadable.cause.code).toBe('EIO');
    fs.unlinkSync(evidence.journalFile);

    const altered = readJson(stateFile);
    altered.versionIntent.files[0].afterSha256 = '9'.repeat(64);
    fs.writeFileSync(stateFile, `${JSON.stringify(altered)}\n`);
    const intent = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(intent).toBeInstanceOf(Error);
    expect(intent.code).toBe('RELEASE_SOURCE_INVALID');
    expect(intent.message).toContain('does not match the verified version application');
    fs.writeFileSync(stateFile, stateBytes);

    expect(readState(fixture).phase).toBe('version-preparing');
    expect(fs.existsSync(evidence.journalFile)).toBe(false);
    expect(fs.readdirSync(evidence.root).sort()).toEqual(['apply', 'prepare']);
    expect(actingCalls()).toEqual(before);
  });

  testPosix('refuses substituted references, mismatched sources and unsafe evidence directories', async () => {
    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });
    await stallStateLane(fixture);
    const journalBytes = fs.readFileSync(evidence.journalFile);
    const stateBytes = fs.readFileSync(stateFile);
    const before = actingCalls();

    const substitutedJournal = readJson(evidence.journalFile);
    substitutedJournal.applicationFile = path.join(evidence.applyDir, 'application-copy.json');
    fs.writeFileSync(evidence.journalFile, `${JSON.stringify(substitutedJournal)}\n`);
    const substituted = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(substituted).toBeInstanceOf(Error);
    expect(substituted.code).toBe('RELEASE_SOURCE_INVALID');
    expect(substituted.message).toContain('fixed retained evidence');
    fs.writeFileSync(evidence.journalFile, journalBytes);

    const drifted = readJson(stateFile);
    drifted.revision = 1;
    drifted.phase = 'source-ready';
    drifted.sourceSha = SOURCE_SHA;
    drifted.versionIntent = null;
    fs.writeFileSync(stateFile, `${JSON.stringify(drifted)}\n`);
    const mismatch = await refusal(recover(fixture, { deps: recoveryOnlyDeps(fixture), reconcileOnly: true }));
    expect(mismatch).toBeInstanceOf(Error);
    expect(mismatch.code).toBe('RELEASE_SOURCE_INVALID');
    expect(mismatch.message).toContain('does not match the recorded source');
    fs.writeFileSync(stateFile, stateBytes);

    const prepared = makeFixture();
    const preparedEvidence = evidenceOf(prepared);
    await invoke(prepared, { deps: fixtureDeps(prepared) });
    const releaseDir = path.dirname(preparedEvidence.root);
    const rows = [
      ['records', path.join(prepared.repoDir, 'records')],
      ['releaseId', releaseDir],
      ['versionRoot', preparedEvidence.root]
    ];
    for (const [label, target] of rows) {
      const moved = path.join(OWNER, `moved-${label}-${++seq}`);
      fs.renameSync(target, moved);
      fs.symlinkSync(moved, target);
      try {
        const error = await refusal(recover(prepared, { deps: recoveryOnlyDeps(prepared), reconcileOnly: true }));
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('RELEASE_SOURCE_INVALID');
        expect(error.message).toContain('real directory');
      } finally {
        fs.unlinkSync(target);
        fs.renameSync(moved, target);
      }
    }

    const versionRoot = preparedEvidence.root;
    const originalMode = fs.statSync(versionRoot).mode & 0o777;
    fs.chmodSync(versionRoot, 0o777);
    try {
      const error = await refusal(recover(prepared, { deps: recoveryOnlyDeps(prepared), reconcileOnly: true }));
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('RELEASE_SOURCE_INVALID');
      expect(error.message).toContain('writable by group or other');
    } finally {
      fs.chmodSync(versionRoot, originalMode);
    }

    expect(readState(prepared).phase).toBe('version-preparing');
    expect(fs.readdirSync(preparedEvidence.root).sort()).toEqual(['apply', 'prepare']);
    expect(fs.existsSync(preparedEvidence.journalFile)).toBe(false);
    expect(actingCalls()).toEqual(before);
  });

  for (const boundary of [1, 2, 3, 4]) {
    testPosix(`stops at publish window boundary ${boundary}`, async () => {
      const fixture = makeFixture();
      await invoke(fixture, { deps: fixtureDeps(fixture) });

      let window = 0;
      const deps = recoveryDeps(fixture, {
        assertPublishWindow() {
          window += 1;
          if (window === boundary) {
            throw Object.assign(new Error('publish window closed'), { code: 'PUBLISH_WINDOW_CLOSED' });
          }
        }
      });

      const error = await refusal(recover(fixture, { deps }));
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('publish window closed');
      expect(window).toBe(boundary);
      expect(readState(fixture).phase).toBe('version-preparing');
      expect(deps.remote.counts.push).toBe(0);
      expect(gitVerb(deps.calls, 'commit-tree')).toBe(boundary > 1 ? 1 : 0);
      expect(gitVerb(deps.calls, 'apply')).toBe(boundary > 2 ? 2 : 0);
      expect(gitVerb(deps.calls, 'update-ref')).toBe(boundary > 3 ? 1 : 0);

      const next = recoveryDeps(fixture, { bare: deps.bare });
      const state = await recover(fixture, { deps: next });
      expect(state.phase).toBe('source-ready');
      expect(state.revision).toBe(1);
      expect(readState(fixture)).toEqual(state);
      expect(next.remote.counts.push).toBe(1);
    });
  }

  testPosix('refuses unrelated lanes, inputs and a backward clock', async () => {
    const absent = makeFixture();
    const absentDeps = recoveryDeps(absent);
    const noLane = await refusal(recover(absent, { deps: absentDeps }));
    expect(noLane).toBeInstanceOf(Error);
    expect(noLane.code).toBe('RELEASE_SOURCE_INVALID');
    expect(noLane.message).toContain('retained version operation');

    const completed = makeFixture();
    writeReleaseState(completeState(completed), completed.identity, {
      cacheRoot: completed.cacheRoot, expectedRevision: null, fs
    });
    const unrelated = await refusal(recover(completed, { deps: recoveryDeps(completed) }));
    expect(unrelated.code).toBe('RELEASE_SOURCE_INVALID');
    expect(unrelated.message).toContain('retained version operation');

    const fixture = makeFixture();
    const evidence = evidenceOf(fixture);
    const stateFile = stateFileOf(fixture);
    await invoke(fixture, { deps: fixtureDeps(fixture) });
    const deps = recoveryDeps(fixture);

    const nonBoolean = await refusal(recover(fixture, { deps, reconcileOnly: 'yes' }));
    expect(nonBoolean.code).toBe('RELEASE_SOURCE_INVALID');
    expect(nonBoolean.message).toContain('boolean');

    const drifted = await refusal(recover(fixture, {
      deps,
      identity: { ...fixture.identity, pushUrlSha256: 'f'.repeat(64) }
    }));
    expect(drifted.code).toBe('RELEASE_SOURCE_INVALID');
    expect(drifted.message).toContain('pushUrlSha256');

    const elsewhere = await refusal(recover(fixture, {
      deps,
      repoDir: path.join(fixture.cacheRoot, 'other-repository')
    }));
    expect(elsewhere.code).toBe('RELEASE_SOURCE_INVALID');
    expect(elsewhere.message).toContain('cache directory');

    const unguarded = recoveryDeps(fixture);
    unguarded.assertPublishWindow = 'later';
    const guard = await refusal(recover(fixture, { deps: unguarded }));
    expect(guard.code).toBe('RELEASE_SOURCE_INVALID');
    expect(guard.message).toContain('assertPublishWindow');

    expect(readState(fixture).phase).toBe('version-preparing');
    expect(fs.existsSync(evidence.journalFile)).toBe(false);

    await stallStateLane(fixture);
    const journal = readJson(evidence.journalFile);
    expect(journal.phase).toBe('complete');
    const bytes = fs.readFileSync(stateFile);
    const backward = await refusal(recover(fixture, { deps: recoveryDeps(fixture, { now: () => NOW - 60000 }) }));
    expect(backward).toBeInstanceOf(Error);
    expect(backward.code).toBe('STATE_TRANSITION_INVALID');
    expect(readState(fixture).phase).toBe('version-preparing');
    expect(readState(fixture).revision).toBe(0);
    expect(readState(fixture).sourceSha).toBeNull();
    expect(fs.readFileSync(stateFile)).toEqual(bytes);
  });
});
