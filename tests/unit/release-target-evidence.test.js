// A completed documentation target leaves immutable evidence behind: its target
// journal, its verified application, the prepared snapshots it recorded and the Git
// objects those references name. These tests read that evidence through the real
// reader after the live checkout moved on, and prove that every missing, tampered or
// escaped reference is refused without touching a remote. Every fixture is a real
// scratch repository under one owned temp root with an isolated Git config and a
// local bare push remote, so no sibling checkout, network, provider or release is
// touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const { updateVersionInContent } = require('../../scripts/update-external-docs');
const {
  prepareCommitIntent, applyPreparedTarget, reconcileTargetPush, readTargetJournal
} = require('../../scripts/release-docs-apply');
const { execFileCaptured } = require('../../scripts/release-command');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { readCompletedTargetEvidence, observeObjectStore } = require('../../scripts/release-target-evidence');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const MESSAGE = `chore: update Hyperclay Local download links to v${NEW}`;
const REPO = 'hyperclay';
const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const FIXED_UUID = '11111111-2222-4333-8444-555555555555';
const GLOBAL_PREFIX = ['-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
const READ_SUBCOMMANDS = ['rev-parse', 'cat-file', 'ls-tree', 'rev-list', 'merge-base', 'ls-files', 'diff'];
const FORBIDDEN_MODULES = [
  'release.js', 'release-docs-apply.js', 'release-docs-run.js', 'release-lock.js',
  'release-ferry.js', 'release-transcript.js', 'release-state.js', 'release-state-store.js'
];

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-target-evidence-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const CACHES = path.join(OWNER, 'caches');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

for (const dir of [NO_HOOKS, CACHES]) fs.mkdirSync(dir, { recursive: true });
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

function makeFixture({ docsVersion = OLD } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remote-${++fixtureSeq}-`));
  const pushRemote = path.join(remoteDir, `${REPO}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', pushRemote]);

  const evidenceRoot = fs.mkdtempSync(path.join(OWNER, `evidence-${++fixtureSeq}-`));
  const repoRoot = path.join(parentDir, REPO);
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['remote', 'add', 'origin', pushRemote]);
  write(repoRoot, 'README.md', 'hyperclay readme\n');
  write(repoRoot, 'src/app.js', 'module.exports = {};\n');
  write(repoRoot, EDGE_PATH, edgeBody(docsVersion));
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'fixture']);
  git(repoRoot, ['push', '-q', 'origin', 'main']);

  return {
    parentDir,
    remoteDir,
    pushRemote,
    evidenceRoot,
    repoRoot,
    runDir: path.join(evidenceRoot, 'run'),
    outDir: path.join(evidenceRoot, 'out')
  };
}

function prepareRun() {
  return (command, args, options = {}) => childProcess.execFileSync(command, args, {
    encoding: 'utf8',
    env: GIT_ENV,
    ...options
  });
}

function prepareFixture(fixture, version) {
  prepareExternalDocs(
    { version, parentDir: fixture.parentDir, runDir: fixture.runDir, targets: [REPO] },
    { run: prepareRun() }
  );
}

function planRun() {
  return (command, args, options = {}) => execFileCaptured(command, args, {
    ...options,
    env: { ...GIT_ENV, ...(options.env || {}) }
  });
}

function planTarget(fixture, version) {
  return prepareDocsApplication({
    preparedFile: path.join(fixture.runDir, 'prepared.json'),
    repo: REPO,
    parentDir: fixture.parentDir,
    version,
    outDir: fixture.outDir
  }, { run: planRun() });
}

function journalFileFor(record) {
  return path.join(path.dirname(record.applicationFile), 'target.json');
}

function depsFor() {
  const calls = [];
  const run = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    return execFileCaptured(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  run.calls = calls;
  return {
    run,
    cacheRoot: path.join(CACHES, `cache-${++cacheSeq}`),
    assertPublishWindow: () => {},
    withFerryRepoLock: async (root, callback) => callback()
  };
}

function pushDeps(cacheRoot) {
  const deps = depsFor();
  deps.cacheRoot = cacheRoot;
  deps.withFerryRepoLock = async () => {
    throw new Error('Ferry must not be entered while reconciling a documentation push');
  };
  return deps;
}

function commitOnTop(repoRoot, rel, body, message) {
  write(repoRoot, rel, body);
  git(repoRoot, ['add', '--', rel]);
  git(repoRoot, ['commit', '-q', '-m', message]);
  return git(repoRoot, ['rev-parse', 'HEAD']).trim();
}

async function buildChangedTarget() {
  const fixture = makeFixture({ docsVersion: OLD });
  prepareFixture(fixture, NEW);
  const record = planTarget(fixture, NEW);
  const journalFile = journalFileFor(record);
  const deps = depsFor();
  const prepared = await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
  const applied = await applyPreparedTarget({ journalFile }, deps);
  const completed = await reconcileTargetPush({ journalFile }, pushDeps(deps.cacheRoot));
  return { fixture, record, journalFile, commit: applied.commit, prepared, applied, completed, deps };
}

async function buildUnchangedBoundaryTarget() {
  const fixture = makeFixture({ docsVersion: OLD });
  const repoRoot = fixture.repoRoot;
  write(repoRoot, EDGE_PATH, updateVersionInContent(edgeBody(OLD), OLD, NEW).updated);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', `docs to ${NEW}`]);
  const boundary = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  write(repoRoot, 'README.md', 'unrelated one\n');
  git(repoRoot, ['add', 'README.md']);
  git(repoRoot, ['commit', '-q', '-m', 'unrelated one']);
  write(repoRoot, 'src/app.js', 'module.exports = { one: 1 };\n');
  git(repoRoot, ['add', 'src/app.js']);
  git(repoRoot, ['commit', '-q', '-m', 'unrelated two']);
  prepareFixture(fixture, NEW);
  const record = planTarget(fixture, NEW);
  const journalFile = journalFileFor(record);
  const deps = depsFor();
  const prepared = await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
  const completed = await reconcileTargetPush({ journalFile }, pushDeps(deps.cacheRoot));
  return { fixture, record, journalFile, commit: boundary, boundary, prepared, completed, deps };
}

async function buildRootBoundaryTarget() {
  const fixture = makeFixture({ docsVersion: NEW });
  const repoRoot = fixture.repoRoot;
  write(repoRoot, 'README.md', 'unrelated after the docs\n');
  git(repoRoot, ['add', 'README.md']);
  git(repoRoot, ['commit', '-q', '-m', 'unrelated']);
  const root = git(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']).trim();
  fs.writeFileSync(path.join(repoRoot, '.git', 'shallow'), `${root}\n`);
  prepareFixture(fixture, NEW);
  const record = planTarget(fixture, NEW);
  const journalFile = journalFileFor(record);
  const deps = depsFor();
  const prepared = await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
  const completed = await reconcileTargetPush({ journalFile }, pushDeps(deps.cacheRoot));
  return { fixture, record, journalFile, commit: root, root, prepared, completed, deps };
}

async function buildShallowBoundaryTarget() {
  const source = makeFixture({ docsVersion: NEW });
  write(source.repoRoot, 'README.md', 'unrelated after the docs\n');
  git(source.repoRoot, ['add', 'README.md']);
  git(source.repoRoot, ['commit', '-q', '-m', 'unrelated']);
  const tip = git(source.repoRoot, ['rev-parse', 'HEAD']).trim();
  const parent = git(source.repoRoot, ['rev-parse', 'HEAD^']).trim();

  const cloneParent = fs.mkdtempSync(path.join(OWNER, `clone-${++fixtureSeq}-`));
  const repoRoot = path.join(cloneParent, REPO);
  git(OWNER, ['clone', '-q', '--depth', '1', '--branch', 'main', `file://${source.repoRoot}`, repoRoot]);
  const evidenceRoot = fs.mkdtempSync(path.join(OWNER, `evidence-${++fixtureSeq}-`));
  const fixture = {
    parentDir: cloneParent,
    repoRoot,
    evidenceRoot,
    runDir: path.join(evidenceRoot, 'run'),
    outDir: path.join(evidenceRoot, 'out')
  };
  prepareFixture(fixture, NEW);
  const record = planTarget(fixture, NEW);
  const seeded = seedCompleteJournal(record, { commit: tip, head: tip });
  return { fixture, record, journalFile: journalFileFor(record), commit: tip, tip, parent, seeded };
}

function seedCompleteJournal(record, { commit, head }) {
  const payload = {
    schema: 1,
    operationId: FIXED_UUID,
    version: record.version,
    repo: record.repo,
    repoRoot: record.repoRoot,
    repoKey: sha256(fs.realpathSync(path.join(record.repoRoot, '.git'))),
    remote: 'origin',
    remoteRef: 'refs/heads/main',
    pushUrlSha256: sha256('https://push.invalid/hyperclay.git'),
    applicationFile: record.applicationFile,
    applicationSha256: sha256(fs.readFileSync(record.applicationFile)),
    preparedFile: record.preparedFile,
    preparedSha256: sha256(fs.readFileSync(record.preparedFile)),
    paths: record.paths.slice(),
    requiredPaths: record.requiredPaths.slice(),
    beforeHead: record.beforeHead,
    beforeIndexFingerprint: record.beforeIndexFingerprint,
    expectedTree: record.expectedTree,
    expectedIndexFingerprint: record.expectedIndexFingerprint,
    candidateCommit: null,
    commit,
    phase: 'complete',
    state: 'complete',
    reason: null,
    remoteObservation: { head, observedAt: new Date().toISOString(), containsCommit: true, postimagesMatch: true },
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(journalFileFor(record), `${JSON.stringify(payload, null, 2)}\n`);
  return { journalFile: journalFileFor(record), record: payload };
}

let changedPromise = null;
let unchangedPromise = null;

function sharedChanged() {
  if (!changedPromise) changedPromise = buildChangedTarget();
  return changedPromise;
}

function sharedUnchanged() {
  if (!unchangedPromise) unchangedPromise = buildUnchangedBoundaryTarget();
  return unchangedPromise;
}

function readEvidence(ctx, deps) {
  return readCompletedTargetEvidence({
    journalFile: ctx.journalFile,
    evidenceRoot: ctx.fixture.evidenceRoot,
    repo: REPO,
    version: NEW,
    commit: ctx.commit
  }, deps);
}

function readFailure(ctx, deps, overrides = {}) {
  try {
    readCompletedTargetEvidence({
      journalFile: ctx.journalFile,
      evidenceRoot: ctx.fixture.evidenceRoot,
      repo: REPO,
      version: NEW,
      commit: ctx.commit,
      ...overrides
    }, deps);
    return null;
  } catch (error) {
    return error;
  }
}

function readRefusal(journalFile, deps) {
  try {
    return { ok: true, journal: readTargetJournal(journalFile, deps) };
  } catch (error) {
    return { ok: false, error };
  }
}

function recordingReader() {
  const calls = [];
  const reader = createLocalGitReader({
    spawnSync: (file, args, options) => {
      calls.push({ file, args: args.slice(), options });
      return childProcess.spawnSync(file, args, options);
    }
  });
  return { run: reader.run, spawn: reader.spawn, calls };
}

function injectingReader(inject) {
  const calls = [];
  const reader = createLocalGitReader({
    spawnSync: (file, args, options) => {
      calls.push({ file, args: args.slice() });
      const injected = inject(args);
      if (injected !== undefined) return injected;
      return childProcess.spawnSync(file, args, options);
    }
  });
  return { run: reader.run, spawn: reader.spawn, calls };
}

function argvOf(call) {
  expect(call.args.slice(0, GLOBAL_PREFIX.length)).toEqual(GLOBAL_PREFIX);
  return call.args.slice(GLOBAL_PREFIX.length);
}

function captureWrites(callback) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  const originalWriteSync = fs.writeSync;
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  fs.writeSync = (fd, ...rest) => {
    if (fd === 1 || fd === 2) {
      const chunk = rest[0];
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (fd === 1) stdout.push(text);
      else stderr.push(text);
      return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(text);
    }
    return originalWriteSync.call(fs, fd, ...rest);
  };
  try {
    return { value: callback(), stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    fs.writeSync = originalWriteSync;
  }
}

function watchFile(file) {
  return { bytes: sha256(fs.readFileSync(file)), mtimeMs: fs.statSync(file).mtimeMs };
}

function watchLive(repoRoot, journalFile) {
  return {
    index: watchFile(path.join(repoRoot, '.git', 'index')),
    selected: watchFile(path.join(repoRoot, EDGE_PATH)),
    mainRef: watchFile(path.join(repoRoot, '.git', 'refs', 'heads', 'main')),
    journal: watchFile(journalFile)
  };
}

function withoutFile(file, callback) {
  const moved = `${file}.missing`;
  fs.renameSync(file, moved);
  try {
    return callback();
  } finally {
    fs.renameSync(moved, file);
  }
}

function withBytes(file, bytes, callback) {
  const pristine = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, bytes);
    return callback();
  } finally {
    fs.writeFileSync(file, pristine);
  }
}

function withSeededObservation(journalFile, observation, callback) {
  const pristine = fs.readFileSync(journalFile);
  try {
    const record = JSON.parse(pristine.toString('utf8'));
    fs.writeFileSync(journalFile, `${JSON.stringify({ ...record, remoteObservation: observation }, null, 2)}\n`);
    return callback();
  } finally {
    fs.writeFileSync(journalFile, pristine);
  }
}

function withTamperedJournal(journalFile, patch, callback) {
  const pristine = fs.readFileSync(journalFile);
  try {
    const record = JSON.parse(pristine.toString('utf8'));
    fs.writeFileSync(journalFile, `${JSON.stringify({ ...record, ...patch }, null, 2)}\n`);
    return callback();
  } finally {
    fs.writeFileSync(journalFile, pristine);
  }
}

function withApplicationRecord(applicationFile, mutate, callback) {
  const pristine = fs.readFileSync(applicationFile, 'utf8');
  try {
    const record = JSON.parse(pristine);
    mutate(record);
    fs.writeFileSync(applicationFile, `${JSON.stringify(record, null, 2)}\n`);
    return callback();
  } finally {
    fs.writeFileSync(applicationFile, pristine);
  }
}

function observationFor(ctx, head) {
  return { ...ctx.completed.remoteObservation, head };
}

describe('historical target evidence', () => {
  testPosix('keeps a complete changed target readable after later branch, head, index and push changes', async () => {
    const ctx = await buildChangedTarget();
    const { fixture, record, journalFile, deps } = ctx;
    const repoRoot = fixture.repoRoot;
    const reader = recordingReader();

    expect(record.paths.length).toBeGreaterThan(0);
    expect(record.requiredPaths.length).toBeGreaterThan(0);
    expect(record.files.length).toBeGreaterThan(0);
    expect(ctx.completed.remoteObservation.head).toBe(ctx.commit);
    expect(readRefusal(journalFile, { run: deps.run }).ok).toBe(true);

    const first = readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs });
    expect(first.journalFile).toBe(journalFile);
    expect(first.repo).toBe(REPO);
    expect(first.version).toBe(NEW);
    expect(first.commit).toBe(ctx.commit);
    expect(first.observedHead).toBe(ctx.commit);
    expect(first.verifiedAt).toBe(ctx.completed.remoteObservation.observedAt);
    expect(reader.calls.length).toBeGreaterThan(0);

    write(repoRoot, EDGE_PATH, 'later selected bytes\n');
    write(repoRoot, 'README.md', 'later unrelated bytes\n');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['remote', 'set-url', '--push', 'origin', 'https://elsewhere.invalid/hyperclay.git']);
    const pushRefusal = readRefusal(journalFile, { run: deps.run });
    expect(pushRefusal.ok).toBe(false);
    expect(pushRefusal.error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(pushRefusal.error.message).toMatch(/pushUrlSha256/);
    expect(readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs })).toEqual(first);

    git(repoRoot, ['checkout', '-q', '-b', 'later']);
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'later work']);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(ctx.commit);
    const branchRefusal = readRefusal(journalFile, { run: deps.run });
    expect(branchRefusal.ok).toBe(false);
    expect(branchRefusal.error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(branchRefusal.error.message).toMatch(/refs\/heads\/main/);

    const beforeWatch = watchLive(repoRoot, journalFile);
    expect(readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs })).toEqual(first);
    expect(watchLive(repoRoot, journalFile)).toEqual(beforeWatch);
  });

  testPosix('keeps an unchanged older content boundary readable and reports nonzero counts', async () => {
    const ctx = await buildUnchangedBoundaryTarget();
    const reader = recordingReader();

    expect(ctx.record.paths).toEqual([]);
    expect(ctx.record.requiredPaths.length).toBeGreaterThan(0);
    expect(ctx.record.files.length).toBeGreaterThan(0);
    expect(ctx.prepared.commit).toBe(ctx.boundary);
    expect(ctx.completed.remoteObservation.head).toBe(ctx.boundary);
    expect(git(ctx.fixture.repoRoot, ['rev-parse', `${ctx.boundary}^`]).trim()).not.toBe(ctx.boundary);

    const result = readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs });
    expect(result.commit).toBe(ctx.boundary);
    expect(result.observedHead).toBe(ctx.boundary);
    expect(result.verifiedAt).toBe(ctx.completed.remoteObservation.observedAt);
    expect(reader.calls.length).toBeGreaterThan(0);

    write(ctx.fixture.repoRoot, EDGE_PATH, 'later selected bytes\n');
    expect(readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs })).toEqual(result);
  });

  testPosix('accepts a genuine root boundary in a shallow repository', async () => {
    const ctx = await buildRootBoundaryTarget();
    const reader = recordingReader();

    expect(ctx.record.paths).toEqual([]);
    expect(ctx.prepared.commit).toBe(ctx.root);
    expect(git(ctx.fixture.repoRoot, ['cat-file', '-p', ctx.root])).not.toMatch(/^parent /m);

    const result = readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs });
    expect(result.commit).toBe(ctx.root);
    expect(result.observedHead).toBe(ctx.root);
    expect(reader.calls.length).toBeGreaterThan(0);
  });

  testPosix('refuses a shallow boundary whose raw parent object is missing', async () => {
    const ctx = await buildShallowBoundaryTarget();
    const reader = recordingReader();
    const repoRoot = ctx.fixture.repoRoot;

    expect(git(repoRoot, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    expect(git(repoRoot, ['rev-list', '--parents', '-n', '1', ctx.tip]).trim()).toBe(ctx.tip);
    expect(git(repoRoot, ['cat-file', 'commit', ctx.tip])).toContain(`parent ${ctx.parent}`);
    expect(() => git(repoRoot, ['rev-parse', '--verify', `${ctx.parent}^{commit}`])).toThrow();
    expect(observeObjectStore(reader.run, repoRoot).key).toBe(ctx.seeded.record.repoKey);

    const error = readFailure(ctx, { run: reader.run, spawn: reader.spawn, fs });
    expect(error).not.toBeNull();
    expect(error.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(error.message).toMatch(/shallow boundary/);
    expect(error.message).toMatch(/not available/);
    expect(reader.calls.some((call) => argvOf(call).includes('fetch'))).toBe(false);
    expect(reader.calls.some((call) => argvOf(call).includes('ls-remote'))).toBe(false);
  });

  testPosix('uses the supplied filesystem for the journal and application reads', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const applicationFile = path.join(path.dirname(ctx.journalFile), 'application.json');
    const seen = [];
    const io = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'lstatSync' || prop === 'openSync') {
          return (file, ...rest) => {
            if (typeof file === 'string') seen.push([String(prop), file]);
            return target[prop](file, ...rest);
          };
        }
        return target[prop];
      }
    });

    const result = readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs: io });
    expect(result.commit).toBe(ctx.commit);
    expect(seen.filter(([method, file]) => method === 'lstatSync' && file === ctx.journalFile).length)
      .toBeGreaterThanOrEqual(2);
    expect(seen.filter(([method, file]) => method === 'openSync' && file === ctx.journalFile).length)
      .toBeGreaterThanOrEqual(2);
    expect(seen.filter(([method, file]) => method === 'lstatSync' && file === applicationFile).length)
      .toBeGreaterThanOrEqual(2);
    expect(seen.filter(([method, file]) => method === 'openSync' && file === applicationFile).length)
      .toBeGreaterThanOrEqual(2);
  });

  testPosix('accepts a recorded unrelated descendant that still carries the postimages', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const descendant = commitOnTop(ctx.fixture.repoRoot, 'README.md', 'unrelated remote descendant\n', 'unrelated remote descendant');
    expect(descendant).not.toBe(ctx.commit);
    expect(() => git(ctx.fixture.repoRoot, ['merge-base', '--is-ancestor', ctx.commit, descendant])).not.toThrow();

    const result = withSeededObservation(ctx.journalFile, observationFor(ctx, descendant), () =>
      readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs }));
    expect(result.commit).toBe(ctx.commit);
    expect(result.observedHead).toBe(descendant);
  });

  testPosix('refuses a recorded descendant that reverts a required path despite ancestry', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const repoRoot = ctx.fixture.repoRoot;
    commitOnTop(repoRoot, 'README.md', 'descendant before the revert\n', 'descendant before the revert');
    const reverted = commitOnTop(repoRoot, EDGE_PATH, edgeBody(OLD), 'revert the documentation');
    expect(() => git(repoRoot, ['merge-base', '--is-ancestor', ctx.commit, reverted])).not.toThrow();

    const error = withSeededObservation(ctx.journalFile, observationFor(ctx, reverted), () =>
      readFailure(ctx, { run: reader.run, spawn: reader.spawn, fs }));
    expect(error.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(error.message).toMatch(/does not carry the prepared documentation set/);
  });

  testPosix('refuses a recorded observation outside the recorded history or missing from the object store', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const repoRoot = ctx.fixture.repoRoot;
    const beforeTree = git(repoRoot, ['rev-parse', `${ctx.record.beforeHead}^{tree}`]).trim();
    const nonancestor = git(repoRoot, ['commit-tree', beforeTree, '-p', ctx.record.beforeHead, '-m', 'unrelated nonancestor']).trim();
    expect(() => git(repoRoot, ['merge-base', '--is-ancestor', ctx.commit, nonancestor])).toThrow();

    const outside = withSeededObservation(ctx.journalFile, observationFor(ctx, nonancestor), () =>
      readFailure(ctx, { run: reader.run, spawn: reader.spawn, fs }));
    expect(outside.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(outside.message).toMatch(/does not contain/);

    const absent = withSeededObservation(ctx.journalFile, observationFor(ctx, '0'.repeat(40)), () =>
      readFailure(ctx, { run: reader.run, spawn: reader.spawn, fs }));
    expect(absent.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(absent.message).toMatch(/is not present/);
  });

  testPosix('refuses wrong repo, version and commit bindings', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const deps = { run: reader.run, spawn: reader.spawn, fs };

    const wrongRepo = readFailure(ctx, deps, { repo: 'hyperclay-website' });
    expect(wrongRepo.code).toBe('DOCS_JOURNAL_INVALID');
    expect(wrongRepo.message).toMatch(/repo does not match/);

    const wrongVersion = readFailure(ctx, deps, { version: OLD });
    expect(wrongVersion.code).toBe('DOCS_JOURNAL_INVALID');
    expect(wrongVersion.message).toMatch(/version does not match/);

    const wrongCommit = readFailure(ctx, deps, { commit: ctx.record.beforeHead });
    expect(wrongCommit.code).toBe('DOCS_JOURNAL_INVALID');
    expect(wrongCommit.message).toMatch(/commit does not match/);

    expect(readEvidence(ctx, deps).commit).toBe(ctx.commit);
  });

  testPosix('refuses a tampered application digest', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const deps = { run: reader.run, spawn: reader.spawn, fs };
    const applicationFile = path.join(path.dirname(ctx.journalFile), 'application.json');
    const pristine = fs.readFileSync(applicationFile);

    const error = withBytes(applicationFile, Buffer.concat([pristine, Buffer.from('\n')]), () => readFailure(ctx, deps));
    expect(error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(error.message).toMatch(/applicationSha256/);
    expect(readEvidence(ctx, deps).commit).toBe(ctx.commit);
  });

  testPosix('refuses missing or corrupt prepared, patch, index and snapshot evidence', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const deps = { run: reader.run, spawn: reader.spawn, fs };
    const applicationFile = path.join(path.dirname(ctx.journalFile), 'application.json');
    const application = JSON.parse(fs.readFileSync(applicationFile, 'utf8'));
    const snapshot = application.files[0];

    const cases = [
      {
        label: 'missing application',
        run: () => withoutFile(applicationFile, () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /application file is missing/
      },
      {
        label: 'missing prepared descriptor',
        run: () => withoutFile(application.preparedFile, () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /prepared descriptor is missing/
      },
      {
        label: 'corrupt prepared descriptor',
        run: () => withBytes(application.preparedFile, Buffer.from('{ not json'), () => readFailure(ctx, deps)),
        code: 'DOCS_APPLICATION_INVALID',
        message: /preparedFile is not valid JSON/
      },
      {
        label: 'missing patch file',
        run: () => withoutFile(application.patchFile, () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /patch file is missing/
      },
      {
        label: 'corrupt patch file',
        run: () => withBytes(application.patchFile, Buffer.from('not the recorded patch\n'), () => readFailure(ctx, deps)),
        code: 'DOCS_APPLICATION_INVALID',
        message: /patch file does not match/
      },
      {
        label: 'missing private index',
        run: () => withoutFile(application.privateIndexFile, () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /private index is missing/
      },
      {
        label: 'corrupt private index',
        run: () => withBytes(application.privateIndexFile, Buffer.from('corrupt index bytes\n'), () => readFailure(ctx, deps)),
        code: 'DOCS_APPLICATION_INVALID',
        message: /index|ls-files/
      },
      {
        label: 'missing before snapshot',
        run: () => withoutFile(snapshot.beforeFile, () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /before snapshot is missing/
      },
      {
        label: 'corrupt after snapshot',
        run: () => withBytes(snapshot.afterFile, Buffer.from('changed after bytes\n'), () => readFailure(ctx, deps)),
        code: 'DOCS_APPLICATION_INVALID',
        message: /afterFile does not match afterSha256/
      },
      {
        label: 'corrupt target journal',
        run: () => withBytes(ctx.journalFile, Buffer.from('{ not json'), () => readFailure(ctx, deps)),
        code: 'DOCS_JOURNAL_INVALID',
        message: /not valid JSON/
      }
    ];

    for (const item of cases) {
      const error = item.run();
      expect(`${item.label}: ${error && error.code}`).toBe(`${item.label}: ${item.code}`);
      expect(error.message).toMatch(item.message);
    }
    expect(readEvidence(ctx, deps).commit).toBe(ctx.commit);
  });

  testPosix('refuses escaped, nonnormalized, NUL and symlinked evidence references', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const deps = { run: reader.run, spawn: reader.spawn, fs };
    const applicationFile = path.join(path.dirname(ctx.journalFile), 'application.json');
    const outDir = path.dirname(applicationFile);

    const escaped = withApplicationRecord(applicationFile, (record) => {
      record.patchFile = path.join(OWNER, 'outside.patch');
    }, () => readFailure(ctx, deps));
    expect(escaped.code).toBe('DOCS_JOURNAL_INVALID');
    expect(escaped.message).toMatch(/outside the evidence root/);

    const nonnormalized = withApplicationRecord(applicationFile, (record) => {
      record.patchFile = `${outDir}${path.sep}..${path.sep}${path.basename(outDir)}${path.sep}candidate.patch`;
    }, () => readFailure(ctx, deps));
    expect(nonnormalized.code).toBe('DOCS_JOURNAL_INVALID');
    expect(nonnormalized.message).toMatch(/normalized/);

    const nul = withApplicationRecord(applicationFile, (record) => {
      record.patchFile = `${path.join(outDir, 'candidate.patch')}\0`;
    }, () => readFailure(ctx, deps));
    expect(nul.code).toBe('DOCS_JOURNAL_INVALID');
    expect(nul.message).toMatch(/NUL/);

    const patchFile = path.join(outDir, 'candidate.patch');
    const realPatch = path.join(outDir, 'candidate.patch.real');
    fs.renameSync(patchFile, realPatch);
    fs.symlinkSync(realPatch, patchFile);
    let symlinked;
    try {
      symlinked = readFailure(ctx, deps);
    } finally {
      fs.unlinkSync(patchFile);
      fs.renameSync(realPatch, patchFile);
    }
    expect(symlinked.code).toBe('DOCS_JOURNAL_INVALID');
    expect(symlinked.message).toMatch(/must not be a symlink/);

    const foreign = path.join(OWNER, 'foreign', 'target.json');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.copyFileSync(ctx.journalFile, foreign);
    const foreignError = readFailure(ctx, deps, { journalFile: foreign });
    expect(foreignError.code).toBe('DOCS_JOURNAL_INVALID');
    expect(foreignError.message).toMatch(/outside the evidence root/);

    const spelling = `${ctx.fixture.evidenceRoot}${path.sep}..${path.sep}${path.basename(ctx.fixture.evidenceRoot)}${path.sep}out${path.sep}target.json`;
    const spellingError = readFailure(ctx, deps, { journalFile: spelling });
    expect(spellingError.code).toBe('DOCS_JOURNAL_INVALID');
    expect(spellingError.message).toMatch(/normalized/);

    expect(readEvidence(ctx, deps).commit).toBe(ctx.commit);
  });

  testPosix('refuses a journal whose recorded repository identity is not canonical', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const deps = { run: reader.run, spawn: reader.spawn, fs };

    const wrongKey = withTamperedJournal(ctx.journalFile, { repoKey: sha256('not the common directory') }, () => readFailure(ctx, deps));
    expect(wrongKey.code).toBe('DOCS_JOURNAL_INVALID');
    expect(wrongKey.message).toMatch(/repoKey/);

    const wrongRoot = withTamperedJournal(ctx.journalFile, { repoRoot: path.join(OWNER, 'not-a-repo') }, () => readFailure(ctx, deps));
    expect(wrongRoot.code).toBe('DOCS_JOURNAL_INVALID');
    expect(wrongRoot.message).toMatch(/repoRoot/);

    expect(readEvidence(ctx, deps).commit).toBe(ctx.commit);
  });

  testPosix('keeps injected Git failures and unreadable evidence silent', async () => {
    const ctx = await sharedChanged();
    const unchanged = await sharedUnchanged();
    const SECRET = 'injected credential https://user:secret@example.invalid/repo.git';

    const patchReader = injectingReader((args) =>
      (args.includes('--no-index') ? { stdout: '', stderr: SECRET, status: 2, signal: null } : undefined));
    const patchCapture = captureWrites(() => readFailure(ctx, { run: patchReader.run, spawn: patchReader.spawn, fs }));
    expect(patchCapture.value.code).toBe('DOCS_APPLICATION_INVALID');
    expect(patchCapture.value.message).toMatch(/diff --no-index failed/);
    expect(patchCapture.value.message).not.toContain(SECRET);
    expect(patchCapture.stdout).toBe('');
    expect(patchCapture.stderr).toBe('');
    expect(patchReader.calls.some((call) => call.args.includes('--no-index'))).toBe(true);

    const headerReader = injectingReader((args) =>
      (args.includes('cat-file') && args.includes('commit') ? { stdout: '', stderr: SECRET, status: 2, signal: null } : undefined));
    const headerCapture = captureWrites(() => readFailure(unchanged, { run: headerReader.run, spawn: headerReader.spawn, fs }));
    expect(headerCapture.value.message).toMatch(/git cat-file commit/);
    expect(headerCapture.value.message).not.toContain(SECRET);
    expect(headerCapture.stdout).toBe('');
    expect(headerCapture.stderr).toBe('');

    const applicationFile = path.join(path.dirname(ctx.journalFile), 'application.json');
    const unreadable = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'openSync') {
          return (file, ...rest) => {
            if (file === applicationFile) throw Object.assign(new Error(SECRET), { code: 'EACCES' });
            return target.openSync(file, ...rest);
          };
        }
        return target[prop];
      }
    });
    const readCapture = captureWrites(() => readFailure(ctx, { run: recordingReader().run, spawn: recordingReader().spawn, fs: unreadable }));
    expect(readCapture.value.code).toBe('DOCS_JOURNAL_INVALID');
    expect(readCapture.value.message).toMatch(/application file could not be read/);
    expect(readCapture.value.message).not.toContain(SECRET);
    expect(readCapture.stdout).toBe('');
    expect(readCapture.stderr).toBe('');
  });

  testPosix('ignores inherited Git redirection and never fetches', async () => {
    const ctx = await sharedChanged();
    const poisonConfig = path.join(OWNER, 'poison.gitconfig');
    fs.writeFileSync(poisonConfig, [
      '[core]',
      '\trepositoryformatversion = 1',
      '[remote "origin"]',
      '\tpromisor = true',
      ''
    ].join('\n'));
    const poisoned = {
      GIT_DIR: path.join(OWNER, 'poisoned-git-dir'),
      GIT_CONFIG_GLOBAL: poisonConfig,
      GIT_OBJECT_DIRECTORY: path.join(OWNER, 'poisoned-objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(OWNER, 'poisoned-alternates'),
      GIT_NO_LAZY_FETCH: '0'
    };
    const saved = new Map(Object.keys(poisoned).map((name) => [name, process.env[name]]));
    for (const [name, value] of Object.entries(poisoned)) process.env[name] = value;
    try {
      const reader = recordingReader();
      const result = readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs });
      expect(result.commit).toBe(ctx.commit);
      expect(reader.calls.length).toBeGreaterThan(0);
      for (const call of reader.calls) {
        const argv = argvOf(call);
        expect(argv).not.toContain('fetch');
        expect(argv).not.toContain('ls-remote');
        expect(argv).not.toContain('push');
      }
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test('loads no acting apply, lock, Ferry or transcript module', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const script = [
      "const path = require('path');",
      "const root = process.env.TARGET_EVIDENCE_ROOT;",
      "require(path.join(root, 'scripts', 'release-target-evidence.js'));",
      "const loaded = Object.keys(require.cache)",
      "  .filter((file) => file.startsWith(path.join(root, 'scripts') + path.sep))",
      "  .map((file) => path.basename(file));",
      "process.stdout.write(JSON.stringify(loaded));"
    ].join('\n');
    const output = childProcess.execFileSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...GIT_ENV, TARGET_EVIDENCE_ROOT: repoRoot }
    });
    const loaded = JSON.parse(output);
    expect(loaded).toContain('release-target-evidence.js');
    expect(loaded).toContain('release-docs-plan.js');
    expect(loaded).toContain('release-command.js');
    for (const name of FORBIDDEN_MODULES) expect(loaded).not.toContain(name);
  });

  testPosix('runs only allowed local Git reads and emits nothing', async () => {
    const ctx = await sharedChanged();
    const reader = recordingReader();
    const captured = captureWrites(() => readEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs }));

    expect(captured.value.commit).toBe(ctx.commit);
    expect(captured.stdout).toBe('');
    expect(captured.stderr).toBe('');
    expect(reader.calls.length).toBeGreaterThan(0);

    const subcommands = new Set();
    for (const call of reader.calls) {
      expect(call.file).toBe('git');
      const argv = argvOf(call);
      subcommands.add(argv[0]);
      expect(READ_SUBCOMMANDS).toContain(argv[0]);
    }
    expect(subcommands.has('diff')).toBe(true);

    const diffCalls = reader.calls.map(argvOf).filter((argv) => argv[0] === 'diff' && argv.includes('--no-index'));
    expect(diffCalls.length).toBeGreaterThan(0);
    expect(diffCalls[0].slice(1, 7)).toEqual(['--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--']);

    const application = JSON.parse(fs.readFileSync(path.join(path.dirname(ctx.journalFile), 'application.json'), 'utf8'));
    const indexCalls = reader.calls.filter((call) => argvOf(call)[0] === 'ls-files');
    expect(indexCalls.length).toBeGreaterThan(0);
    for (const call of indexCalls) {
      expect(call.options.env.GIT_INDEX_FILE).toBe(application.privateIndexFile);
    }
  });
});
