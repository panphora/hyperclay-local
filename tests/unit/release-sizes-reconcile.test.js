// The size coordinator composes the desktop size renderer with the existing docs
// apply/push engines into one recoverable release-tail operation. Every fixture is
// a real scratch repository under one owned temp root with an isolated Git config
// and a local bare push destination, and the only simulated remote transport maps
// one exact fake GitHub destination token to that bare repository, so no provider,
// Ferry installation, sibling checkout or release is touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { reconcileReleaseSizes } = require('../../scripts/release-sizes');
const { renderDownloadSizes } = require('../../scripts/write-download-sizes');
const { prepareDownloadSizes } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication, verifyDocsApplication, readPreparedTarget } = require('../../scripts/release-docs-plan');
const { readTargetEvidence } = require('../../scripts/release-target-evidence');
const { readSizeEvidence } = require('../../scripts/release-size-evidence');
const { persistPublication } = require('../../scripts/release-publication-write');
const { withReleaseLock } = require('../../scripts/release-lock');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { execFileCaptured } = require('../../scripts/release-command');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const VERSION = '1.29.0';
const DATE = '2026-01-02T03:04:05.678Z';
const DESKTOP_REPO = 'hyperclay-local';
const SIZE_PATHS = ['README.md', 'website/index.html'];
const MESSAGE = `Update desktop download sizes for v${VERSION}`;
const OWNED_COMMANDS = ['git', 'tar'];
const REMOTE_VERBS = ['ls-remote', 'fetch', 'push'];

const NAMES = [
  `HyperclayLocal-${VERSION}-arm64.dmg`,
  `HyperclayLocal-${VERSION}.dmg`,
  `HyperclayLocal-Setup-${VERSION}.exe`,
  `HyperclayLocal-${VERSION}.AppImage`,
  `HyperclayLocal-${VERSION}-arm64.AppImage`
];
const LABELS = ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux (x86_64)', 'Linux (ARM64)'];
const OS_KEYS = ['mac-arm', 'mac-intel', 'windows', 'linux', 'linux-arm'];
const MB_OLD = [102.3, 108.8, 90.1, 123.7, 123.4];
const MB_NEW = [103.0, 109.7, 90.6, 124.0, 123.5];

const HISTORY_RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const HISTORY_ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const HISTORY_RUN_ID = 456;
const HISTORY_WORKFLOW_ID = 12345;
const HISTORY_UPLOAD_JOB_ID = 4242;
const HISTORY_REMOTE_REPO = 'fixture-owner/hyperclay-local';
const HISTORY_ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const HISTORY_OTHER_ORIGIN = 'https://elsewhere.invalid/hyperclay-local.git';
const HISTORY_CHANGED_ORIGIN = 'git@github.com:other-owner/hyperclay-local.git';
const HISTORY_RUN_CREATED_AT = '2026-01-02T02:00:00Z';
const HISTORY_RUN_UPDATED_AT = '2026-01-02T02:30:00Z';
const HISTORY_REQUESTED_AT = '2026-01-02T01:00:00.000Z';
const HISTORY_DEADLINE_AT = '2026-01-02T04:00:00.000Z';
const HISTORY_OBSERVED_AT = '2026-01-02T01:20:00.000Z';
const HISTORY_CREATED_AT = '2026-01-02T00:30:00.000Z';
const HISTORY_UPDATED_AT = '2026-01-02T01:30:00.000Z';
const HISTORY_VERIFIED_AT = '2026-01-02T03:04:06.000Z';
const HISTORY_SIZE_OBSERVED_AT = '2026-02-03T04:05:06.000Z';

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-size-reconcile-'));
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

const localReader = createLocalGitReader();

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

let fixtureSeq = 0;
let cacheSeq = 0;

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

function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function readmeFixture(mb) {
  const lines = ['# HyperclayLocal ' + VERSION, '', 'Download the app for your platform:', ''];
  for (let index = 0; index < NAMES.length; index += 1) {
    lines.push(
      `   - **${LABELS[index]}**: [${NAMES[index]}](https://local.hyperclay.com/${NAMES[index]}) (${Number(mb[index]).toFixed(1)}MB)`
    );
  }
  lines.push('', 'Install and run the app.', '');
  return lines.join('\n');
}

function websiteFixture(mb) {
  const lines = [
    `<section class="section" id="downloads" data-version="${VERSION}">`,
    '  <ul class="dl-list">'
  ];
  for (let index = 0; index < NAMES.length; index += 1) {
    lines.push(
      `    <li class="dl-row" data-os="${OS_KEYS[index]}">`,
      `      <a class="dl-file" download href="https://local.hyperclay.com/${NAMES[index]}">${NAMES[index]}</a>`,
      `      <span class="dl-size">${Number(mb[index]).toFixed(1)} MB</span>`,
      '    </li>'
    );
  }
  lines.push('  </ul>', '</section>', '');
  return lines.join('\n');
}

function historyAttempt(sourceSha) {
  return {
    id: HISTORY_ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: HISTORY_WORKFLOW_ID,
    expectedTitle: `release v${VERSION} publish sha=${sourceSha} attempt=${HISTORY_ATTEMPT_ID}`,
    dispatch: 'identified',
    requestedAt: HISTORY_REQUESTED_AT,
    watchDeadlineAt: HISTORY_DEADLINE_AT,
    runId: HISTORY_RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: HISTORY_OBSERVED_AT,
    error: null
  };
}

function historyManifest(sourceSha, mb = MB_NEW) {
  const sizes = {};
  NAMES.forEach((name, index) => { sizes[name] = Math.round(mb[index] * 1024 * 1024); });
  return { version: VERSION, commit: sourceSha, date: DATE, files: NAMES.slice(), sizes };
}

function historyProof(fixture, manifestSha256) {
  return {
    schema: 1,
    releaseId: HISTORY_RELEASE_ID,
    attemptId: HISTORY_ATTEMPT_ID,
    version: VERSION,
    mode: 'publish',
    sourceSha: fixture.sourceSha,
    manifestSha256,
    verifiedAt: HISTORY_VERIFIED_AT,
    run: {
      id: HISTORY_RUN_ID,
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      workflow_id: HISTORY_WORKFLOW_ID,
      display_title: fixture.attempt.expectedTitle,
      head_sha: fixture.sourceSha,
      run_attempt: 1,
      created_at: HISTORY_RUN_CREATED_AT,
      updated_at: HISTORY_RUN_UPDATED_AT,
      repository: { full_name: HISTORY_REMOTE_REPO },
      html_url: `https://github.com/${HISTORY_REMOTE_REPO}/actions/runs/${HISTORY_RUN_ID}`
    },
    uploadJobsRequest: { runId: HISTORY_RUN_ID, runAttempt: 1 },
    uploadJob: { id: HISTORY_UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' }
  };
}

function historyState(fixture) {
  const pendingTarget = () => ({ state: 'pending', journalFile: null, commit: null, reason: null });
  return {
    schema: 1,
    revision: 0,
    repo: fixture.identity,
    releaseId: HISTORY_RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: HISTORY_CREATED_AT,
    updatedAt: HISTORY_UPDATED_AT,
    versionIntent: null,
    sourceSha: fixture.sourceSha,
    activeAttemptId: HISTORY_ATTEMPT_ID,
    attempts: [fixture.attempt],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: {
      state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
      receiptSha: null, verifiedAt: null, error: null
    },
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null
  };
}

function makeFixture() {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remote-${++fixtureSeq}-`));
  const pushRemote = path.join(remoteDir, `${DESKTOP_REPO}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', pushRemote]);

  const repoRoot = path.join(parentDir, DESKTOP_REPO);
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['remote', 'add', 'origin', HISTORY_ORIGIN]);
  write(repoRoot, 'package.json', `${JSON.stringify({
    name: 'hyperclay-local-electron', version: VERSION, private: true
  }, null, 2)}\n`);
  write(repoRoot, 'README.md', readmeFixture(MB_OLD));
  write(repoRoot, 'website/index.html', websiteFixture(MB_OLD));
  write(repoRoot, 'src/app.js', 'module.exports = {};\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'release source']);

  const sourceSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const identity = resolveRepoIdentity(repoRoot, { readGit: createLocalGitReader().readGit, fs });
  const cacheBase = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, `cache-${++cacheSeq}-`)));
  const cacheRoot = path.join(cacheBase, 'releases');
  const repoDir = statePaths(identity, { cacheRoot, fs }).repoDir;
  const sizesRoot = path.join(repoDir, 'records', HISTORY_RELEASE_ID, 'sizes');
  return {
    parentDir,
    remoteDir,
    repoRoot,
    pushRemote,
    sourceSha,
    identity,
    cacheBase,
    cacheRoot,
    repoDir,
    attempt: historyAttempt(sourceSha),
    sizes: {
      root: sizesRoot,
      prepareDir: path.join(sizesRoot, 'prepare'),
      applyDir: path.join(sizesRoot, 'apply'),
      preparedFile: path.join(sizesRoot, 'prepare', 'prepared.json'),
      applicationFile: path.join(sizesRoot, 'apply', 'application.json'),
      journalFile: path.join(sizesRoot, 'apply', 'target.json'),
      patchFile: path.join(sizesRoot, 'apply', 'candidate.patch'),
      privateIndexFile: path.join(sizesRoot, 'apply', 'index')
    }
  };
}

function seedRemote(fixture, commit) {
  git(fixture.repoRoot, ['push', '-q', fixture.pushRemote, `${commit}:refs/heads/main`]);
}

function remoteHead(fixture) {
  return git(fixture.remoteDir, ['--git-dir', fixture.pushRemote, 'rev-parse', 'refs/heads/main']).trim();
}

function loadState(fixture) {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
}

async function publishHistory(fixture, manifestValue) {
  const manifestBytes = Buffer.from(JSON.stringify(manifestValue), 'utf8');
  const state = historyState(fixture);
  writeReleaseState(state, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision: null, fs
  });
  await withReleaseLock(fixture.identity, async () => persistPublication({
    state,
    repoDir: fixture.repoDir,
    observation: {
      manifestBytes,
      manifest: manifestValue,
      proof: historyProof(fixture, sha256(manifestBytes))
    }
  }, {
    local: { fs },
    wallNow: () => Date.parse(HISTORY_VERIFIED_AT)
  }), { cacheRoot: fixture.cacheRoot });
  fixture.manifestFile = path.join(fixture.repoDir, 'records', HISTORY_RELEASE_ID, 'artifacts',
    `attempt=${HISTORY_ATTEMPT_ID}`, 'release-info.json');
  fixture.manifestSha256 = sha256(manifestBytes);
  fixture.published = loadState(fixture);
  return fixture.published;
}

function clock() {
  let current = Date.parse(HISTORY_SIZE_OBSERVED_AT);
  return () => {
    current += 1000;
    return current;
  };
}

function owned(value, fixture) {
  return typeof value === 'string' && path.isAbsolute(value)
    && (value.startsWith(fixture.parentDir + path.sep)
      || value.startsWith(fixture.cacheBase + path.sep)
      || value.startsWith(fixture.remoteDir + path.sep));
}

function confine(fixture, command, args, options) {
  if (!OWNED_COMMANDS.includes(command)) {
    throw new Error(`size acting must not run ${command}`);
  }
  for (const value of args) {
    if (typeof value === 'string' && path.isAbsolute(value) && !owned(value, fixture)) {
      throw new Error(`${command} argument escaped the owned fixture: ${value}`);
    }
  }
  const cwd = options === undefined ? undefined : options.cwd;
  if (cwd !== undefined && !owned(cwd, fixture)) {
    throw new Error(`${command} ran outside the owned fixture: ${cwd}`);
  }
}

function actingRun(fixture, calls, onCommitTree) {
  return (command, args, options = {}) => {
    confine(fixture, command, args, options);
    calls.push({ command, args: args.slice() });
    if (command === 'git' && args[0] === 'commit-tree' && typeof onCommitTree === 'function') onCommitTree();
    return execFileCaptured(command, args, {
      echoStdout: false,
      ...options,
      env: { ...(options.env || {}), ...GIT_ENV }
    });
  };
}

function actingSpawn(fixture, calls) {
  return (command, args, options = {}) => {
    confine(fixture, command, args, options);
    calls.push({ command, args: args.slice() });
    return childProcess.spawnSync(command, args, {
      ...options,
      env: { ...(options.env || {}), ...GIT_ENV }
    });
  };
}

function remoteSpawn(fixture, calls, destination = fixture.pushRemote) {
  return (command, args, options = {}) => {
    if (command !== 'git' || !REMOTE_VERBS.includes(args[0])) {
      throw new Error(`unexpected remote transport call: ${command} ${args.join(' ')}`);
    }
    const occurrences = args.filter((value) => value === HISTORY_ORIGIN).length;
    if (occurrences !== 1) {
      throw new Error(`remote destination token appeared ${occurrences} times in git ${args.join(' ')}`);
    }
    if (!owned(destination, fixture)) {
      throw new Error(`remote transport destination is not owned by the fixture: ${destination}`);
    }
    const mapped = args.map((value) => (value === HISTORY_ORIGIN ? destination : value));
    calls.push(args.slice());
    return childProcess.spawnSync(command, mapped, {
      ...options,
      env: { ...GIT_ENV, ...(options.env || {}) }
    });
  };
}

function ferrySeam(fixture, calls) {
  return async (root, callback, options) => {
    calls.push({ root, options });
    return callback();
  };
}

function harness(fixture, overrides = {}) {
  const log = { run: [], spawn: [], remote: [], ferry: [], guard: [] };
  const deps = {
    run: overrides.run === undefined ? actingRun(fixture, log.run, overrides.onCommitTree) : overrides.run,
    spawn: overrides.spawn === undefined ? actingSpawn(fixture, log.spawn) : overrides.spawn,
    spawnRemote: overrides.spawnRemote === undefined
      ? remoteSpawn(fixture, log.remote, overrides.remoteDestination || fixture.pushRemote)
      : overrides.spawnRemote,
    fs: overrides.fs === undefined ? fs : overrides.fs,
    now: overrides.now === undefined ? clock() : overrides.now,
    randomUUID: overrides.randomUUID === undefined ? () => crypto.randomUUID() : overrides.randomUUID,
    withFerryRepoLock: overrides.withFerryRepoLock === undefined
      ? ferrySeam(fixture, log.ferry)
      : overrides.withFerryRepoLock
  };
  if (overrides.assertPublishWindow !== null) {
    deps.assertPublishWindow = overrides.assertPublishWindow === undefined
      ? () => { log.guard.push(true); }
      : overrides.assertPublishWindow;
  }
  return { log, deps };
}

function invoke(fixture, state, h) {
  return withReleaseLock(
    fixture.identity,
    () => reconcileReleaseSizes({ state, repoDir: fixture.repoDir }, h.deps),
    { cacheRoot: fixture.cacheRoot }
  );
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the size coordinator to reject');
}

function readJournal(fixture) {
  return readTargetEvidence(fixture.sizes.journalFile, {
    run: localReader.run, spawn: localReader.spawn, fs
  }).journal;
}

function readEvidence(fixture, state) {
  return readSizeEvidence({ state, repoDir: fixture.repoDir }, {
    run: localReader.run, spawn: localReader.spawn, fs
  });
}

function evidenceDigest(fixture) {
  const files = [
    fixture.sizes.preparedFile,
    fixture.sizes.applicationFile,
    fixture.sizes.patchFile,
    fixture.sizes.privateIndexFile,
    ...SIZE_PATHS.map((rel) => path.join(fixture.sizes.prepareDir, DESKTOP_REPO, 'before', rel)),
    ...SIZE_PATHS.map((rel) => path.join(fixture.sizes.prepareDir, DESKTOP_REPO, 'after', rel))
  ];
  return files.map((file) => [file, sha256(fs.readFileSync(file))]);
}

function captureEvidence(fixture) {
  const captured = { errors: [], journalExists: null };
  try {
    captured.lane = loadState(fixture);
  } catch (error) {
    captured.errors.push(`lane: ${error.message}`);
  }
  try {
    captured.descriptor = readPreparedTarget(fixture.sizes.preparedFile, { repo: DESKTOP_REPO, version: VERSION });
  } catch (error) {
    captured.errors.push(`descriptor: ${error.message}`);
  }
  try {
    captured.application = verifyDocsApplication(fixture.sizes.applicationFile, {
      run: localReader.run, spawn: localReader.spawn
    });
  } catch (error) {
    captured.errors.push(`application: ${error.message}`);
  }
  captured.journalExists = fs.existsSync(fixture.sizes.journalFile);
  return captured;
}

function verbs(calls, names) {
  return calls.filter((call) => names.includes(call.args[0]));
}

function liveApply(calls) {
  return calls.filter((call) => call.command === 'git'
    && call.args[0] === 'apply' && !call.args.includes('--cached'));
}

function liveMutations(calls) {
  return calls.filter((call) => call.command === 'git' && (
    call.args[0] === 'commit-tree'
    || call.args[0] === 'update-ref'
    || (call.args[0] === 'apply' && !call.args.includes('--cached'))
  ));
}

function snapshotEvidence(fixture) {
  return SIZE_PATHS.flatMap((rel) => [
    path.join(fixture.sizes.prepareDir, DESKTOP_REPO, 'before', rel),
    path.join(fixture.sizes.prepareDir, DESKTOP_REPO, 'after', rel)
  ]);
}

function byteDigest(files) {
  return files.map((file) => [file, fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null]);
}

function preparedDigest(fixture) {
  return byteDigest([fixture.sizes.preparedFile, ...snapshotEvidence(fixture)]);
}

function stateFileOf(fixture) {
  return path.join(fixture.repoDir, 'state.json');
}

function ancestorsThrough(file, boundary) {
  const list = [];
  let dir = path.dirname(file);
  for (;;) {
    list.push(dir);
    if (dir === boundary) break;
    dir = path.dirname(dir);
  }
  return list;
}

function stateRecordOf(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function faultFs(predicate) {
  const descriptors = new Map();
  const fsynced = [];
  const io = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') {
        return (file, flags, mode) => {
          const fd = mode === undefined ? target.openSync(file, flags) : target.openSync(file, flags, mode);
          descriptors.set(fd, file);
          return fd;
        };
      }
      if (property === 'fsyncSync') {
        return (fd) => {
          const file = descriptors.get(fd);
          if (file !== undefined && !fsynced.includes(file)) fsynced.push(file);
          return target.fsyncSync(fd);
        };
      }
      if (property === 'closeSync') {
        return (fd) => {
          descriptors.delete(fd);
          return target.closeSync(fd);
        };
      }
      if (property === 'renameSync') {
        return (from, to) => {
          if (predicate(from, to)) {
            throw Object.assign(new Error(`fixture fault refused to publish ${to}`), { code: 'EIO' });
          }
          return target.renameSync(from, to);
        };
      }
      return target[property];
    }
  });
  return { io, fsynced };
}

function publicationOf(state) {
  return {
    manifestFile: state.artifacts.manifestFile,
    manifestSha256: state.artifacts.manifestSha256,
    sourceSha: state.sourceSha
  };
}

function prepareRetained(fixture, publication, calls) {
  fs.mkdirSync(fixture.sizes.root, { recursive: true, mode: 0o700 });
  return prepareDownloadSizes({
    version: VERSION,
    parentDir: fixture.parentDir,
    runDir: fixture.sizes.prepareDir,
    publication
  }, { run: actingRun(fixture, calls) });
}

function planRetained(fixture, calls) {
  return prepareDocsApplication({
    preparedFile: fixture.sizes.preparedFile,
    repo: DESKTOP_REPO,
    parentDir: fixture.parentDir,
    version: VERSION,
    outDir: fixture.sizes.applyDir
  }, { run: actingRun(fixture, calls), spawn: actingSpawn(fixture, calls) });
}

describePosix('size coordinator native core', () => {
  testPosix('binds the recorded publication and applies the fixed size files from a later source commit', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { changed: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'unrelated later source change']);
    const laterHead = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    expect(laterHead).not.toBe(fixture.sourceSha);
    seedRemote(fixture, laterHead);
    const packageDigest = sha256(fs.readFileSync(path.join(fixture.repoRoot, 'package.json')));

    let atCommitTree = null;
    let commitTrees = 0;
    const h = harness(fixture, {
      onCommitTree: () => {
        commitTrees += 1;
        if (atCommitTree === null) atCommitTree = captureEvidence(fixture);
      }
    });

    const result = await invoke(fixture, before, h);

    expect(commitTrees).toBe(1);
    expect(atCommitTree).not.toBeNull();
    expect(atCommitTree.errors).toEqual([]);
    expect(atCommitTree.journalExists).toBe(false);
    expect(atCommitTree.lane.revision).toBe(before.revision + 1);
    expect(atCommitTree.lane.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });
    expect(atCommitTree.descriptor.prepared.targets[0].publication).toEqual({
      manifestFile: before.artifacts.manifestFile,
      manifestSha256: before.artifacts.manifestSha256,
      sourceSha: fixture.sourceSha
    });
    expect(atCommitTree.descriptor.prepared.targets[0].paths.map((entry) => entry.path)).toEqual(SIZE_PATHS);
    expect(atCommitTree.application.repo).toBe(DESKTOP_REPO);
    expect(atCommitTree.application.requiredPaths).toEqual(SIZE_PATHS);
    expect(atCommitTree.application.paths).toEqual(SIZE_PATHS);

    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sizes.journalFile).toBe(fixture.sizes.journalFile);
    expect(result.state.sizes.reason).toBeNull();
    expect(result.state.sizes.commit).not.toBe(fixture.sourceSha);
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(result.state.repo).toEqual(before.repo);
    expect(result.state.site).toEqual(before.site);
    expect(result.state.docs).toEqual(before.docs);
    expect(result.state.install).toEqual(before.install);
    expect(result.state.versionIntent).toBeNull();

    const journal = readJournal(fixture);
    expect(journal.commit).toBe(result.state.sizes.commit);
    expect(journal.beforeHead).toBe(laterHead);
    expect(git(fixture.repoRoot, ['diff', '--name-only', laterHead, journal.commit]).trim().split('\n'))
      .toEqual(SIZE_PATHS);
    expect(fs.readdirSync(fixture.sizes.root).sort()).toEqual(['apply', 'prepare']);
    expect(sha256(fs.readFileSync(path.join(fixture.repoRoot, 'package.json')))).toBe(packageDigest);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
    expect(remoteHead(fixture)).toBe(result.state.sizes.commit);
    expect(h.log.guard.length).toBeGreaterThan(0);
    expect(h.log.ferry.length).toBeGreaterThan(0);
    expect(h.log.run.every((call) => OWNED_COMMANDS.includes(call.command))).toBe(true);
    expect(h.log.run.some(call => ['npm', 'npx', 'gh', 'wrangler'].includes(call.command))).toBe(false);
  });

  testPosix('replays a completed journal historically without acting calls', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const first = harness(fixture);
    const completed = await invoke(fixture, before, first);
    expect(completed.error).toBeNull();
    expect(completed.state.sizes.state).toBe('complete');
    const lane = loadState(fixture);
    expect(lane.sizes.state).toBe('complete');
    expect(lane.revision).toBe(completed.state.revision);

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { later: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'later unrelated commit']);
    fs.appendFileSync(path.join(fixture.repoRoot, 'README.md'), '\nDirty selected file\n');
    git(fixture.repoRoot, ['remote', 'set-url', 'origin', HISTORY_OTHER_ORIGIN]);
    git(fixture.repoRoot, ['checkout', '-q', '--detach']);
    expect(git(fixture.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD');

    const refuse = (label) => () => { throw new Error(`${label} must not be used for a completed journal`); };
    const h = harness(fixture, {
      run: refuse('run'),
      spawn: refuse('spawn'),
      spawnRemote: refuse('spawnRemote'),
      now: refuse('now'),
      randomUUID: refuse('randomUUID'),
      withFerryRepoLock: refuse('withFerryRepoLock'),
      assertPublishWindow: null
    });

    const result = await invoke(fixture, lane, h);

    expect(result.error).toBeNull();
    expect(result.state).toEqual(lane);
    expect(result.state.revision).toBe(lane.revision);
    expect(result.state.sizes.commit).toBe(completed.state.sizes.commit);
    expect(result.state.sizes.state).toBe('complete');
    expect(readEvidence(fixture, result.state)).toBeTruthy();
  });

  testPosix('persists a real remote pending result and resumes the same application', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const absent = path.join(fixture.parentDir, 'absent-destination.git');
    const now = clock();
    const first = harness(fixture, { remoteDestination: absent, now });
    const pending = await invoke(fixture, before, first);

    expect(pending.error).not.toBeNull();
    expect(pending.error.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(pending.state.sizes.state).toBe('pending-push');
    expect(pending.state.sizes.journalFile).toBe(fixture.sizes.journalFile);
    expect(pending.state.sizes.commit).not.toBeNull();
    expect(pending.state.sizes.reason.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(pending.state.sourceSha).toBe(before.sourceSha);
    expect(pending.state.artifacts).toEqual(before.artifacts);
    expect(pending.state.revision).toBe(before.revision + 2);
    expect(first.log.remote.map((args) => args[0])).toEqual(['ls-remote']);
    expect(verbs(first.log.run, ['push'])).toEqual([]);
    expect(fs.existsSync(absent)).toBe(false);

    const journalBefore = readJournal(fixture);
    const digestBefore = evidenceDigest(fixture);
    expect(journalBefore.commit).toBe(pending.state.sizes.commit);
    expect(journalBefore.candidateCommit).not.toBeNull();

    const second = harness(fixture, { now });
    const completed = await invoke(fixture, pending.state, second);

    expect(completed.error).toBeNull();
    expect(completed.state.sizes.state).toBe('complete');
    expect(completed.state.sizes.commit).toBe(journalBefore.commit);
    expect(completed.state.sizes.commit).toBe(pending.state.sizes.commit);
    expect(completed.state.revision).toBe(pending.state.revision + 1);
    expect(completed.state.sourceSha).toBe(before.sourceSha);
    expect(completed.state.artifacts).toEqual(before.artifacts);
    expect(evidenceDigest(fixture)).toEqual(digestBefore);
    const journalAfter = readJournal(fixture);
    expect(journalAfter.candidateCommit).toBe(journalBefore.candidateCommit);
    expect(journalAfter.operationId).toBe(journalBefore.operationId);
    expect(verbs(second.log.run, ['commit-tree'])).toEqual([]);
    expect(verbs(second.log.run, ['archive'])).toEqual([]);
    expect(second.log.run.every((call) => call.command !== 'tar')).toBe(true);
    expect(second.log.remote.map((args) => args[0])).toEqual(['ls-remote', 'push', 'ls-remote']);
    expect(remoteHead(fixture)).toBe(completed.state.sizes.commit);
    expect(readEvidence(fixture, completed.state)).toBeTruthy();
  });

  testPosix('returns a real preimage conflict and then completes the retained application', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const closed = Object.assign(new Error('fixture release window is closed'), { code: 'RELEASE_WINDOW_CLOSED' });
    const first = harness(fixture, { assertPublishWindow: () => { throw closed; } });
    const guardError = await rejection(invoke(fixture, before, first));

    expect(guardError).toBe(closed);
    expect(guardError.code).toBe('RELEASE_WINDOW_CLOSED');
    expect(verbs(first.log.run, ['commit-tree'])).toEqual([]);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
    const pointer = loadState(fixture);
    expect(pointer.revision).toBe(before.revision + 1);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    const digestBefore = evidenceDigest(fixture);
    const readmeFile = path.join(fixture.repoRoot, 'README.md');
    const pristine = fs.readFileSync(readmeFile);
    fs.appendFileSync(readmeFile, '\nConcurrent live change\n');

    const second = harness(fixture);
    const conflict = await invoke(fixture, pointer, second);

    expect(conflict.error).not.toBeNull();
    expect(conflict.error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(conflict.state.sizes.state).toBe('conflict');
    expect(conflict.state.sizes.commit).toBeNull();
    expect(conflict.state.sizes.journalFile).toBe(fixture.sizes.journalFile);
    expect(conflict.state.sizes.reason.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(conflict.state.revision).toBe(pointer.revision + 1);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
    expect(verbs(second.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(second.log.remote).toEqual([]);
    expect(evidenceDigest(fixture)).toEqual(digestBefore);

    fs.writeFileSync(readmeFile, pristine);
    const third = harness(fixture);
    const completed = await invoke(fixture, conflict.state, third);

    expect(completed.error).toBeNull();
    expect(completed.state.sizes.state).toBe('complete');
    expect(completed.state.sizes.commit).not.toBeNull();
    expect(completed.state.sourceSha).toBe(before.sourceSha);
    expect(evidenceDigest(fixture)).toEqual(digestBefore);
    expect(remoteHead(fixture)).toBe(completed.state.sizes.commit);
    expect(readEvidence(fixture, completed.state)).toBeTruthy();
  });

  testPosix('adopts the proven zero-change boundary instead of today HEAD', async () => {
    const fixture = makeFixture();
    const manifestValue = historyManifest(fixture.sourceSha);
    await publishHistory(fixture, manifestValue);

    const rendered = renderDownloadSizes({
      readme: fs.readFileSync(path.join(fixture.repoRoot, 'README.md'), 'utf8'),
      website: fs.readFileSync(path.join(fixture.repoRoot, 'website/index.html'), 'utf8'),
      manifest: manifestValue
    }, { version: VERSION, sourceSha: fixture.sourceSha });
    write(fixture.repoRoot, 'README.md', rendered.readme);
    write(fixture.repoRoot, 'website/index.html', rendered.website);
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', MESSAGE]);
    const boundary = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { later: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'unrelated later source change']);
    const laterHead = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    expect(laterHead).not.toBe(boundary);
    seedRemote(fixture, laterHead);

    const before = loadState(fixture);
    const h = harness(fixture, {
      assertPublishWindow: () => { throw new Error('a zero-change adoption must not open a work window'); }
    });
    const result = await invoke(fixture, before, h);

    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sizes.commit).toBe(boundary);
    expect(result.state.sizes.commit).not.toBe(laterHead);
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(h.log.guard).toEqual([]);
    expect(verbs(h.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    const journal = readJournal(fixture);
    expect(journal.commit).toBe(boundary);
    expect(journal.candidateCommit).toBeNull();
    expect(journal.beforeHead).toBe(laterHead);
    expect(remoteHead(fixture)).toBe(laterHead);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
  });
});

describePosix('size coordinator recovery boundaries', () => {
  testPosix('retained: resumes prepared-only evidence', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const now = clock();
    const setup = [];
    const descriptor = prepareRetained(fixture, publicationOf(before), setup);
    expect(descriptor.runDir).toBe(fixture.sizes.prepareDir);
    expect(descriptor.targets[0].publication).toEqual(publicationOf(before));
    expect(fs.statSync(fixture.sizes.prepareDir).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(fixture.sizes.applyDir)).toBe(false);
    const preparedBefore = preparedDigest(fixture);

    let atCommitTree = null;
    let commitTrees = 0;
    const h = harness(fixture, {
      now,
      onCommitTree: () => {
        commitTrees += 1;
        if (atCommitTree === null) atCommitTree = captureEvidence(fixture);
      }
    });
    const result = await invoke(fixture, before, h);

    expect(commitTrees).toBe(1);
    expect(atCommitTree).not.toBeNull();
    expect(atCommitTree.errors).toEqual([]);
    expect(atCommitTree.journalExists).toBe(false);
    expect(atCommitTree.lane.revision).toBe(before.revision + 1);
    expect(atCommitTree.lane.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });
    expect(atCommitTree.descriptor.prepared.targets[0].publication).toEqual(publicationOf(before));
    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(preparedDigest(fixture)).toEqual(preparedBefore);
    expect(h.log.run.every((call) => call.command !== 'tar')).toBe(true);
    expect(verbs(h.log.run, ['archive'])).toEqual([]);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
    expect(remoteHead(fixture)).toBe(result.state.sizes.commit);
  });

  testPosix('retained: resumes application-only evidence', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const now = clock();
    const setup = [];
    prepareRetained(fixture, publicationOf(before), setup);
    const application = planRetained(fixture, setup);
    expect(application.applicationFile).toBe(fixture.sizes.applicationFile);
    const descriptorBefore = fs.readFileSync(fixture.sizes.preparedFile);
    const evidenceBefore = evidenceDigest(fixture);

    let atCommitTree = null;
    let commitTrees = 0;
    const h = harness(fixture, {
      now,
      onCommitTree: () => {
        commitTrees += 1;
        if (atCommitTree === null) atCommitTree = captureEvidence(fixture);
      }
    });
    const result = await invoke(fixture, before, h);

    expect(commitTrees).toBe(1);
    expect(atCommitTree).not.toBeNull();
    expect(atCommitTree.errors).toEqual([]);
    expect(atCommitTree.journalExists).toBe(false);
    expect(atCommitTree.lane.revision).toBe(before.revision + 1);
    expect(atCommitTree.lane.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });
    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(evidenceDigest(fixture)).toEqual(evidenceBefore);
    expect(fs.readFileSync(fixture.sizes.preparedFile)).toEqual(descriptorBefore);
    expect(h.log.spawn.every((call) => call.command === 'git'
      && call.args[0] === 'diff' && call.args[1] === '--no-index')).toBe(true);
    expect(h.log.run.every((call) => call.command !== 'tar')).toBe(true);
    expect(verbs(h.log.run, ['read-tree', 'write-tree', 'archive'])).toEqual([]);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
    expect(remoteHead(fixture)).toBe(result.state.sizes.commit);
  });

  testPosix('retained: refuses a partial prepare directory', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    fs.mkdirSync(fixture.sizes.prepareDir, { recursive: true, mode: 0o700 });
    const partial = write(fixture.sizes.prepareDir, 'partial-evidence.txt', 'partial prepare window\n');
    const partialBytes = fs.readFileSync(partial);
    const partialMode = fs.statSync(partial).mode & 0o777;
    const prepareMode = fs.statSync(fixture.sizes.prepareDir).mode & 0o777;
    const rootMode = fs.statSync(fixture.sizes.root).mode & 0o777;

    const h = harness(fixture, { now: clock() });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(verbs(h.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(h.log.spawn).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(h.log.ferry).toEqual([]);
    expect(loadState(fixture)).toEqual(before);
    expect(fs.existsSync(fixture.sizes.preparedFile)).toBe(false);
    expect(fs.existsSync(fixture.sizes.applyDir)).toBe(false);
    expect(fs.readdirSync(fixture.sizes.prepareDir)).toEqual(['partial-evidence.txt']);
    expect(fs.readFileSync(partial)).toEqual(partialBytes);
    expect(fs.statSync(partial).mode & 0o777).toBe(partialMode);
    expect(fs.statSync(fixture.sizes.prepareDir).mode & 0o777).toBe(prepareMode);
    expect(fs.statSync(fixture.sizes.root).mode & 0o777).toBe(rootMode);
  });

  testPosix('retained: refuses a partial apply directory', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const setup = [];
    prepareRetained(fixture, publicationOf(before), setup);
    const preparedBefore = preparedDigest(fixture);

    fs.mkdirSync(fixture.sizes.applyDir, { recursive: true, mode: 0o700 });
    const partial = write(fixture.sizes.applyDir, 'partial-application.txt', 'partial apply window\n');
    const partialBytes = fs.readFileSync(partial);
    const applyMode = fs.statSync(fixture.sizes.applyDir).mode & 0o777;
    const applyListing = fs.readdirSync(fixture.sizes.applyDir).sort();

    const h = harness(fixture, { now: clock() });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(verbs(h.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(h.log.spawn).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(h.log.ferry).toEqual([]);
    expect(loadState(fixture)).toEqual(before);
    expect(preparedDigest(fixture)).toEqual(preparedBefore);
    expect(fs.readdirSync(fixture.sizes.applyDir).sort()).toEqual(applyListing);
    expect(fs.readFileSync(partial)).toEqual(partialBytes);
    expect(fs.statSync(fixture.sizes.applyDir).mode & 0o777).toBe(applyMode);
    expect(fs.existsSync(fixture.sizes.applicationFile)).toBe(false);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
  });

  testPosix('retained: refuses a missing patch after pointer publication', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const now = clock();
    const closed = Object.assign(new Error('fixture release window is closed'), { code: 'RELEASE_WINDOW_CLOSED' });
    const first = harness(fixture, { now, assertPublishWindow: () => { throw closed; } });
    const guardError = await rejection(invoke(fixture, before, first));

    expect(guardError).toBe(closed);
    expect(verbs(first.log.run, ['commit-tree'])).toEqual([]);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
    const pointer = loadState(fixture);
    expect(pointer.revision).toBe(before.revision + 1);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });
    expect(fs.existsSync(fixture.sizes.patchFile)).toBe(true);

    fs.rmSync(fixture.sizes.patchFile);
    const remaining = [
      fixture.sizes.preparedFile,
      fixture.sizes.applicationFile,
      fixture.sizes.privateIndexFile,
      ...snapshotEvidence(fixture)
    ];
    const bytesBefore = byteDigest(remaining);
    const applyListing = fs.readdirSync(fixture.sizes.applyDir).sort();

    const second = harness(fixture, { now });
    const error = await rejection(invoke(fixture, pointer, second));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(verbs(second.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(second.log.spawn).toEqual([]);
    expect(second.log.remote).toEqual([]);
    expect(second.log.ferry).toEqual([]);
    expect(fs.existsSync(fixture.sizes.patchFile)).toBe(false);
    expect(loadState(fixture)).toEqual(pointer);
    expect(byteDigest(remaining)).toEqual(bytesBefore);
    expect(fs.readdirSync(fixture.sizes.applyDir).sort()).toEqual(applyListing);
  });

  testPosix('retained: refuses a symlinked evidence directory', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const sentinel = fs.mkdtempSync(path.join(fixture.cacheBase, 'sentinel-'));
    fs.chmodSync(sentinel, 0o700);
    const sentinelFile = write(sentinel, 'sentinel.txt', 'sentinel bytes\n');
    const sentinelBytes = fs.readFileSync(sentinelFile);
    const sentinelFileMode = fs.statSync(sentinelFile).mode & 0o777;
    const sentinelMode = fs.statSync(sentinel).mode & 0o777;
    const sentinelListing = fs.readdirSync(sentinel).sort();

    fs.symlinkSync(sentinel, fixture.sizes.root, 'dir');

    const h = harness(fixture, { now: clock() });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(verbs(h.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(h.log.spawn).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(h.log.ferry).toEqual([]);
    expect(loadState(fixture)).toEqual(before);
    expect(fs.lstatSync(fixture.sizes.root).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(fixture.sizes.root)).toBe(sentinel);
    expect(fs.readdirSync(sentinel).sort()).toEqual(sentinelListing);
    expect(fs.readFileSync(sentinelFile)).toEqual(sentinelBytes);
    expect(fs.statSync(sentinelFile).mode & 0o777).toBe(sentinelFileMode);
    expect(fs.statSync(sentinel).mode & 0o777).toBe(sentinelMode);
    expect(fs.existsSync(path.join(sentinel, 'prepare'))).toBe(false);
    expect(fs.existsSync(path.join(sentinel, 'apply'))).toBe(false);
  });

  testPosix('persistence: refuses pointer publication failure and resumes flushed evidence', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const now = clock();
    let atPointerFailure = null;
    let tracker = null;
    tracker = faultFs((from, to) => {
      if (to !== stateFileOf(fixture)) return false;
      const record = stateRecordOf(from);
      if (!record || !record.sizes || record.sizes.journalFile === null) return false;
      atPointerFailure = tracker.fsynced.slice();
      return true;
    });

    const h = harness(fixture, { fs: tracker.io, now });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('STATE_IO_FAILED');
    expect(atPointerFailure).not.toBeNull();
    expect(liveMutations(h.log.run)).toEqual([]);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(fixture.sourceSha);
    expect(h.log.remote).toEqual([]);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);

    const lane = loadState(fixture);
    expect(lane).toEqual(before);
    expect(lane.sizes).toEqual({ state: 'pending', journalFile: null, commit: null, reason: null });

    const flushed = new Set(atPointerFailure);
    const required = [
      fixture.sizes.preparedFile,
      fixture.sizes.applicationFile,
      fixture.sizes.patchFile,
      fixture.sizes.privateIndexFile,
      ...snapshotEvidence(fixture)
    ];
    const missing = required.flatMap((file) => [file, ...ancestorsThrough(file, fixture.repoDir)])
      .filter((file) => !flushed.has(file));
    expect(missing).toEqual([]);

    const digestBefore = evidenceDigest(fixture);
    const resume = harness(fixture, { now });
    const result = await invoke(fixture, lane, resume);

    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sizes.commit).not.toBeNull();
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(evidenceDigest(fixture)).toEqual(digestBefore);
    expect(remoteHead(fixture)).toBe(result.state.sizes.commit);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
  });

  testPosix('persistence: refuses target journal publication failure', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const now = clock();
    let journalFaults = 0;
    const tracker = faultFs((from, to) => {
      if (to !== fixture.sizes.journalFile) return false;
      if (journalFaults > 0) return false;
      journalFaults += 1;
      return true;
    });

    const h = harness(fixture, { fs: tracker.io, now });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('DOCS_JOURNAL_WRITE_FAILED');
    expect(journalFaults).toBe(1);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(fixture.sourceSha);
    expect(verbs(h.log.run, ['commit-tree'])).toHaveLength(1);
    expect(verbs(h.log.run, ['update-ref'])).toEqual([]);
    expect(liveApply(h.log.run)).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);

    const pointer = loadState(fixture);
    expect(pointer.revision).toBe(before.revision + 1);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    const digestBefore = evidenceDigest(fixture);
    const resume = harness(fixture, { now });
    const result = await invoke(fixture, pointer, resume);

    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sizes.journalFile).toBe(fixture.sizes.journalFile);
    expect(verbs(resume.log.run, ['commit-tree'])).toHaveLength(1);
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(evidenceDigest(fixture)).toEqual(digestBefore);
    expect(remoteHead(fixture)).toBe(result.state.sizes.commit);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
  });

  testPosix('persistence: recovers a completed journal ahead of public state', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    const now = clock();
    let completeFaults = 0;
    const tracker = faultFs((from, to) => {
      if (to !== stateFileOf(fixture)) return false;
      const record = stateRecordOf(from);
      if (!record || !record.sizes || record.sizes.state !== 'complete') return false;
      completeFaults += 1;
      return true;
    });

    const h = harness(fixture, { fs: tracker.io, now });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('STATE_IO_FAILED');
    expect(completeFaults).toBe(1);
    expect(verbs(h.log.run, ['update-ref'])).toHaveLength(1);

    const journal = readJournal(fixture);
    expect(journal.phase).toBe('complete');
    expect(journal.state).toBe('complete');
    expect(remoteHead(fixture)).toBe(journal.commit);

    const lane = loadState(fixture);
    expect(lane.revision).toBe(before.revision + 1);
    expect(lane.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { later: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'later unrelated commit']);
    const laterHead = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    fs.appendFileSync(path.join(fixture.repoRoot, 'README.md'), '\nDirty selected file\n');

    const refuse = (label) => () => { throw new Error(`${label} must not run`); };
    const resume = harness(fixture, {
      run: refuse('run'),
      spawn: refuse('spawn'),
      spawnRemote: refuse('spawnRemote'),
      randomUUID: refuse('randomUUID'),
      withFerryRepoLock: refuse('withFerryRepoLock'),
      assertPublishWindow: null,
      now
    });
    const result = await invoke(fixture, lane, resume);

    expect(result.error).toBeNull();
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.sizes.commit).toBe(journal.commit);
    expect(result.state.sizes.commit).not.toBe(laterHead);
    expect(result.state.revision).toBe(lane.revision + 1);
    expect(result.state.sourceSha).toBe(before.sourceSha);
    expect(result.state.artifacts).toEqual(before.artifacts);
    expect(remoteHead(fixture)).toBe(journal.commit);
    expect(readEvidence(fixture, result.state)).toBeTruthy();
    expect(resume.log.run).toEqual([]);
    expect(resume.log.spawn).toEqual([]);
    expect(resume.log.remote).toEqual([]);
    expect(resume.log.ferry).toEqual([]);
  });

  testPosix('fatal: preserves tampered application evidence', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const now = clock();
    const closed = Object.assign(new Error('fixture release window is closed'), { code: 'RELEASE_WINDOW_CLOSED' });
    const first = harness(fixture, { now, assertPublishWindow: () => { throw closed; } });
    expect(await rejection(invoke(fixture, before, first))).toBe(closed);

    const pointer = loadState(fixture);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    const record = JSON.parse(fs.readFileSync(fixture.sizes.applicationFile, 'utf8'));
    record.patchSha256 = (record.patchSha256.startsWith('a') ? 'b' : 'a') + record.patchSha256.slice(1);
    const tampered = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.writeFileSync(fixture.sizes.applicationFile, tampered);
    const listingBefore = fs.readdirSync(fixture.sizes.applyDir).sort();

    const second = harness(fixture, { now });
    const error = await rejection(invoke(fixture, pointer, second));

    expect(error.code).toBe('DOCS_APPLICATION_INVALID');
    expect(verbs(second.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(second.log.remote).toEqual([]);
    expect(fs.readFileSync(fixture.sizes.applicationFile)).toEqual(tampered);
    expect(fs.readdirSync(fixture.sizes.applyDir).sort()).toEqual(listingBefore);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
    expect(loadState(fixture)).toEqual(pointer);
  });

  testPosix('fatal: rejects changed origin before acting', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    git(fixture.repoRoot, ['remote', 'set-url', 'origin', HISTORY_CHANGED_ORIGIN]);
    expect(git(fixture.repoRoot, ['remote', 'get-url', 'origin']).trim()).toBe(HISTORY_CHANGED_ORIGIN);

    const h = harness(fixture, { now: clock() });
    const error = await rejection(invoke(fixture, before, h));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(error.message).toBe('Size acting identity changed: remoteRepo');
    expect(error.code).not.toBe('DOCS_PREIMAGE_CONFLICT');
    expect(verbs(h.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(h.log.spawn).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(fs.existsSync(fixture.sizes.root)).toBe(false);
    expect(loadState(fixture)).toEqual(before);
  });

  testPosix('fatal: propagates closed work window', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const now = clock();
    let guardCalls = 0;
    const closed = Object.assign(new Error('fixture release window is closed'), { code: 'RELEASE_WINDOW_CLOSED' });
    const h = harness(fixture, { now, assertPublishWindow: () => { guardCalls += 1; throw closed; } });
    const error = await rejection(invoke(fixture, before, h));

    expect(error).toBe(closed);
    expect(error.code).toBe('RELEASE_WINDOW_CLOSED');
    expect(guardCalls).toBe(1);
    expect(liveMutations(h.log.run)).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);

    const pointer = loadState(fixture);
    expect(pointer.revision).toBe(before.revision + 1);
    expect(pointer.sourceSha).toBe(before.sourceSha);
    expect(pointer.artifacts).toEqual(before.artifacts);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    const retained = captureEvidence(fixture);
    expect(retained.errors).toEqual([]);
    expect(retained.journalExists).toBe(false);
    expect(retained.descriptor.prepared.targets[0].publication).toEqual(publicationOf(before));
    expect(retained.application.requiredPaths).toEqual(SIZE_PATHS);
  });

  testPosix('fatal: preserves cleanup failure attached to real preimage conflict', async () => {
    const fixture = makeFixture();
    await publishHistory(fixture, historyManifest(fixture.sourceSha));
    const before = loadState(fixture);

    const now = clock();
    const closed = Object.assign(new Error('fixture release window is closed'), { code: 'RELEASE_WINDOW_CLOSED' });
    const first = harness(fixture, { now, assertPublishWindow: () => { throw closed; } });
    expect(await rejection(invoke(fixture, before, first))).toBe(closed);

    const pointer = loadState(fixture);
    expect(pointer.sizes).toEqual({
      state: 'pending', journalFile: fixture.sizes.journalFile, commit: null, reason: null
    });

    const readmeFile = path.join(fixture.repoRoot, 'README.md');
    fs.appendFileSync(readmeFile, '\nConcurrent live change\n');
    const edited = fs.readFileSync(readmeFile);

    let ferryEntries = 0;
    let originalError = null;
    const second = harness(fixture, {
      now,
      withFerryRepoLock: async (_root, callback) => {
        ferryEntries += 1;
        try {
          return await callback();
        } catch (error) {
          originalError = error;
          error.cleanupError = Object.assign(new Error('fixture cleanup failure'), { code: 'DOCS_LOCK_IO_FAILED' });
          throw error;
        }
      }
    });
    const error = await rejection(invoke(fixture, pointer, second));

    expect(originalError).not.toBeNull();
    expect(error).toBe(originalError);
    expect(ferryEntries).toBe(1);
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(error.cleanupError).toBeInstanceOf(Error);
    expect(error.cleanupError.message).toBe('fixture cleanup failure');
    expect(error.cleanupError.code).toBe('DOCS_LOCK_IO_FAILED');
    expect(verbs(second.log.run, ['commit-tree', 'apply', 'update-ref'])).toEqual([]);
    expect(second.log.remote).toEqual([]);
    expect(fs.readFileSync(readmeFile)).toEqual(edited);
    expect(fs.existsSync(fixture.sizes.journalFile)).toBe(false);
    expect(loadState(fixture)).toEqual(pointer);
  });
});

describe('size coordinator portable boundary', () => {
  test('rejects a malformed dependency before any acting call', async () => {
    const calls = [];
    const primitive = (label) => (...args) => {
      calls.push({ label, args });
      throw new Error(`${label} must not run`);
    };
    const deps = {
      run: primitive('run'),
      spawn: primitive('spawn'),
      readRun: primitive('readRun'),
      readSpawn: primitive('readSpawn'),
      spawnRemote: primitive('spawnRemote'),
      randomUUID: primitive('randomUUID'),
      withFerryRepoLock: primitive('withFerryRepoLock'),
      now: 'not a clock'
    };

    const error = await rejection(reconcileReleaseSizes({
      state: { repo: {} },
      repoDir: path.join(TMP_BASE, 'hc-size-reconcile-portable')
    }, deps));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(error.message).toBe('Size dependency now must be callable');
    expect(calls).toEqual([]);
  });

  test('rejects a non-canonical cache directory before any acting call', async () => {
    const calls = [];
    const primitive = (label) => (...args) => {
      calls.push({ label, args });
      throw new Error(`${label} must not run`);
    };
    const deps = {
      run: primitive('run'),
      spawn: primitive('spawn'),
      readRun: primitive('readRun'),
      readSpawn: primitive('readSpawn'),
      spawnRemote: primitive('spawnRemote'),
      randomUUID: primitive('randomUUID'),
      withFerryRepoLock: primitive('withFerryRepoLock'),
      now: primitive('now')
    };

    const error = await rejection(reconcileReleaseSizes({
      state: { repo: {} },
      repoDir: 'relative/cache'
    }, deps));

    expect(error.code).toBe('RELEASE_SIZES_INVALID');
    expect(error.message).toBe('Size cache directory must be canonical');
    expect(calls).toEqual([]);
  });
});
