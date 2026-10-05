// Reconcile one recorded documentation commit with its single push destination in
// real scratch checkouts and real local bare remotes. Every fixture owns its own
// repositories, HOME/config and hooks, so no network, sibling checkout, browser or
// release is touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const {
  prepareCommitIntent, applyPreparedTarget, readTargetJournal, reconcileTargetPush
} = require('../../scripts/release-docs-apply');
const releaseCommand = require('../../scripts/release-command');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const MESSAGE = `chore: update Hyperclay Local download links to v${NEW}`;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHORT_OID = 'abcdef';

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-docs-push-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const RUNS = path.join(OWNER, 'runs');
const OUTS = path.join(OWNER, 'outs');
const CACHES = path.join(OWNER, 'caches');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

for (const dir of [NO_HOOKS, RUNS, OUTS, CACHES]) fs.mkdirSync(dir, { recursive: true });
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
const RESTORE_ENV = new Map();
for (const name of ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_OPTIONAL_LOCKS']) {
  RESTORE_ENV.set(name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : null);
}
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG;
process.env.GIT_OPTIONAL_LOCKS = '0';

afterAll(() => {
  for (const [name, value] of RESTORE_ENV) {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(OWNER, { recursive: true, force: true });
});

const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_NAME = '15 Hyperclay Local App.md';
const VAULT_PATH = `vault/DOCS/${VAULT_NAME}`;
const LLMS_PATH = 'public/llms.txt';
const REPOS = ['hyperclay', 'hyperclay-website'];

const PLATFORM_VAULT = ['---', 'title: Platform', '---', '', 'Platform notes.', ''].join('\n');

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

let fixtureSeq = 0;
let runSeq = 0;
let outSeq = 0;
let cacheSeq = 0;
let cloneSeq = 0;

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

function gitProbe(cwd, args) {
  return childProcess.spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function bodyOf(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
}

function cleanName(name) {
  return name
    .replace(/^\d+\s+/, '')
    .replace(/\.md$/, '')
    .replace(/\s+-\s+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .toLowerCase();
}

function canonicalSyncDocs(cwd) {
  const vaultDir = path.join(cwd, 'vault/DOCS');
  for (const name of fs.readdirSync(vaultDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const title = name.replace(/^\d+\s+/, '').replace(/\.md$/, '');
    write(cwd, `content/docs/${cleanName(name)}.mdx`, `---\ntitle: ${title}\npublish: true\n---\n\n${bodyOf(fs.readFileSync(path.join(vaultDir, name), 'utf8'))}`);
  }
}

function canonicalLlmsTxt(cwd) {
  const docsDir = path.join(cwd, 'content/docs');
  const blocks = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith('.mdx'))
    .sort()
    .map((name) => `## ${name.replace(/\.mdx$/, '')}\n\n${bodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8'))}`);
  write(cwd, LLMS_PATH, blocks.join('\n---\n\n'));
}

function makeRun(liveWebsite) {
  return (command, args, options = {}) => {
    if (command !== 'npm') return childProcess.execFileSync(command, args, { encoding: 'utf8', env: GIT_ENV, ...options });
    const cwd = options.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('npm needs an absolute snapshot cwd');
    if (cwd === liveWebsite || cwd.startsWith(`${liveWebsite}${path.sep}`)) throw new Error('npm was pointed at the live website');
    const [sub, script] = args;
    if (sub === 'ci') return '';
    if (sub === 'run' && script === 'sync-docs') {
      canonicalSyncDocs(cwd);
      return '';
    }
    if (sub === 'run' && script === 'build:llms-txt') {
      canonicalLlmsTxt(cwd);
      return '';
    }
    throw new Error(`unexpected npm command: ${args.join(' ')}`);
  };
}

function makeFixture({ docsVersion = OLD } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remotes-${++fixtureSeq}-`));
  const remotes = new Map();
  for (const repo of REPOS) {
    const push = path.join(remoteDir, `${repo}.git`);
    const fetch = path.join(remoteDir, `${repo}-fetch.git`);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', push]);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', fetch]);
    remotes.set(repo, { push, fetch });
  }

  const hyperclay = path.join(parentDir, 'hyperclay');
  const website = path.join(parentDir, 'hyperclay-website');

  fs.mkdirSync(hyperclay, { recursive: true });
  git(hyperclay, ['init', '-q', '-b', 'main']);
  git(hyperclay, ['remote', 'add', 'origin', remotes.get('hyperclay').fetch]);
  git(hyperclay, ['remote', 'set-url', '--push', 'origin', remotes.get('hyperclay').push]);
  write(hyperclay, 'README.md', 'hyperclay readme\n');
  write(hyperclay, 'src/app.js', 'module.exports = {};\n');
  write(hyperclay, EDGE_PATH, edgeBody(docsVersion));
  git(hyperclay, ['add', '-A']);
  git(hyperclay, ['commit', '-q', '-m', 'fixture']);
  git(hyperclay, ['push', '-q', 'origin', 'main']);

  fs.mkdirSync(website, { recursive: true });
  git(website, ['init', '-q', '-b', 'main']);
  git(website, ['remote', 'add', 'origin', remotes.get('hyperclay-website').fetch]);
  git(website, ['remote', 'set-url', '--push', 'origin', remotes.get('hyperclay-website').push]);
  write(website, VAULT_PATH, vaultBody(docsVersion));
  write(website, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
  write(website, 'package.json', `${JSON.stringify({
    name: 'hyperclay-website',
    version: '0.0.0',
    scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
  }, null, 2)}\n`);
  canonicalSyncDocs(website);
  canonicalLlmsTxt(website);
  git(website, ['add', '-A']);
  git(website, ['commit', '-q', '-m', 'fixture']);
  git(website, ['push', '-q', 'origin', 'main']);

  return {
    parentDir,
    remotes,
    hyperclay,
    website,
    runDir: path.join(RUNS, `run-${++runSeq}`),
    outDir: path.join(OUTS, `out-${++outSeq}`)
  };
}

function repoRootOf(fixture, repo) {
  return repo === 'hyperclay' ? fixture.hyperclay : fixture.website;
}

function remoteOf(fixture, repo) {
  return fixture.remotes.get(repo).push;
}

function fetchRemoteOf(fixture, repo) {
  return fixture.remotes.get(repo).fetch;
}

function descriptorPath(fixture) {
  return path.join(fixture.runDir, 'prepared.json');
}

function prepareFixture(fixture, version) {
  prepareExternalDocs(
    { version, parentDir: fixture.parentDir, runDir: fixture.runDir },
    { run: makeRun(fixture.website) }
  );
}

function planRun() {
  return (command, args, options = {}) => releaseCommand.execFileCaptured(command, args, {
    ...options,
    env: { ...GIT_ENV, ...(options.env || {}) }
  });
}

function planTarget(fixture, repo, version) {
  const outDir = path.join(OUTS, `out-${++outSeq}`);
  return prepareDocsApplication({
    preparedFile: descriptorPath(fixture),
    repo,
    parentDir: fixture.parentDir,
    version,
    outDir
  }, { run: planRun() });
}

function journalFileFor(record) {
  return path.join(path.dirname(record.applicationFile), 'target.json');
}

function newCache() {
  return path.join(CACHES, `cache-${++cacheSeq}`);
}

function failingFs(overrides) {
  return new Proxy(fs, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop];
      return target[prop];
    }
  });
}

function depsFor(options = {}) {
  const localCalls = [];
  const remoteCalls = [];
  const run = (command, args, opts = {}) => {
    localCalls.push([command, ...args]);
    const result = releaseCommand.execFileCaptured(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
    if (options.hook) options.hook(command, args, opts);
    return result;
  };
  run.calls = localCalls;
  const spawnRemote = (command, args, spawnOptions = {}) => {
    remoteCalls.push([command, ...args]);
    if (options.spawnHook) {
      const injected = options.spawnHook(command, args, spawnOptions);
      if (injected !== undefined) return injected;
    }
    return childProcess.spawnSync(command, args, spawnOptions);
  };
  spawnRemote.calls = remoteCalls;
  return {
    run,
    spawnRemote,
    fs: options.fs,
    now: options.now,
    randomUUID: options.randomUUID,
    cacheRoot: options.cacheRoot || newCache(),
    assertPublishWindow: options.assertPublishWindow || (() => {}),
    withFerryRepoLock: options.withFerryRepoLock || (async (root, callback) => callback())
  };
}

function pushDeps(options = {}) {
  const ferryCalls = [];
  const deps = depsFor({
    ...options,
    withFerryRepoLock: options.withFerryRepoLock || ((root) => {
      ferryCalls.push(root);
      throw new Error('Ferry must not be entered while reconciling a documentation push');
    })
  });
  deps.ferryCalls = ferryCalls;
  return deps;
}

function pushes(deps) {
  return deps.spawnRemote.calls.filter((call) => call[1] === 'push').length;
}

function remoteMain(remote) {
  return git(remote, ['rev-parse', '--verify', 'refs/heads/main']).trim();
}

function tryRemoteMain(remote) {
  const probe = gitProbe(remote, ['rev-parse', '--verify', 'refs/heads/main']);
  return probe.status === 0 ? probe.stdout.trim() : null;
}

function remoteHas(remote, oid) {
  return gitProbe(remote, ['cat-file', '-e', `${oid}^{commit}`]).status === 0;
}

function configValue(repoRoot, key) {
  const probe = gitProbe(repoRoot, ['config', '--get', key]);
  return probe.status === 0 ? probe.stdout.trim() : null;
}

function commitCount(repoRoot) {
  return Number(git(repoRoot, ['rev-list', '--all', '--count']).trim());
}

function liveSnapshot(repoRoot) {
  const reflog = path.join(repoRoot, '.git', 'logs', 'HEAD');
  return {
    branch: git(repoRoot, ['symbolic-ref', '-q', 'HEAD']).trim(),
    head: git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    indexFingerprint: sha256(git(repoRoot, ['ls-files', '--stage', '-z'])),
    indexBytes: sha256(fs.readFileSync(path.join(repoRoot, '.git', 'index'))),
    status: git(repoRoot, ['status', '--porcelain=v1', '-z']),
    remoteRefs: git(repoRoot, ['for-each-ref', 'refs/remotes']).trim(),
    reflog: fs.existsSync(reflog) ? sha256(fs.readFileSync(reflog)) : null,
    worktree: git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
      .map((name) => `${name}:${sha256(fs.readFileSync(path.join(repoRoot, name)))}`)
  };
}

function readJournal(journalFile) {
  return JSON.parse(fs.readFileSync(journalFile, 'utf8'));
}

function rewriteJournal(journalFile, patch) {
  const payload = `${JSON.stringify({ ...readJournal(journalFile), ...patch }, null, 2)}\n`;
  fs.writeFileSync(journalFile, payload);
  return payload;
}

function refusal(promise) {
  return Promise.resolve(promise).then(() => null, (error) => error);
}

function readRefusal(journalFile, deps) {
  try {
    return { ok: true, journal: readTargetJournal(journalFile, deps) };
  } catch (error) {
    return { ok: false, error };
  }
}

function docsLockDir(cacheRoot, repoRoot) {
  const commonDir = fs.realpathSync(path.join(repoRoot, '.git'));
  return path.join(cacheRoot, 'locks/docs', `${sha256(commonDir)}.lock`);
}

async function readyFixture({ repo = 'hyperclay', pushUrl = null } = {}) {
  const fixture = makeFixture();
  const repoRoot = repoRootOf(fixture, repo);
  if (pushUrl !== null) git(repoRoot, ['remote', 'set-url', '--push', 'origin', pushUrl]);
  prepareFixture(fixture, NEW);
  const record = planTarget(fixture, repo, NEW);
  const journalFile = journalFileFor(record);
  const deps = depsFor({});
  await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
  const applied = await applyPreparedTarget({ journalFile }, deps);
  return { fixture, repo, repoRoot, record, journalFile, applied, deps };
}

function remoteDescendant(ctx) {
  const repoRoot = ctx.repoRoot;
  write(repoRoot, 'README.md', 'unrelated remote descendant\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'unrelated remote descendant']);
  const descendant = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  git(repoRoot, ['push', '-q', 'origin', 'main']);
  return descendant;
}

function localDivergentCommit(ctx) {
  const repoRoot = ctx.repoRoot;
  const tree = git(repoRoot, ['rev-parse', `${ctx.record.beforeHead}^{tree}`]).trim();
  return git(repoRoot, ['commit-tree', tree, '-p', ctx.record.beforeHead, '-m', 'divergent work']).trim();
}

function cloneDivergentCommit(ctx) {
  const remote = remoteOf(ctx.fixture, ctx.repo);
  const cloneDir = path.join(OWNER, `divergent-${++cloneSeq}`);
  git(OWNER, ['clone', '-q', '--branch', 'main', remote, cloneDir]);
  write(cloneDir, 'divergent.txt', 'divergent work\n');
  git(cloneDir, ['add', '-A']);
  git(cloneDir, ['commit', '-q', '-m', 'divergent work']);
  const divergent = git(cloneDir, ['rev-parse', 'HEAD']).trim();
  git(cloneDir, ['push', '-q', 'origin', 'main']);
  return divergent;
}

describe('release docs push', () => {
  testPosix('pushes the one recorded commit to the push destination for both targets', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    for (const repo of REPOS) {
      const repoRoot = repoRootOf(fixture, repo);
      const record = planTarget(fixture, repo, NEW);
      const journalFile = journalFileFor(record);
      const applyDeps = depsFor({});
      await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, applyDeps);
      const applied = await applyPreparedTarget({ journalFile }, applyDeps);
      const before = liveSnapshot(repoRoot);
      const remote = remoteOf(fixture, repo);
      expect(remoteMain(remote)).toBe(record.beforeHead);
      expect(applied.commit).toMatch(OID_PATTERN);
      expect(applied.commit).not.toBe(record.beforeHead);

      const deps = pushDeps({ cacheRoot: applyDeps.cacheRoot });
      const result = await reconcileTargetPush({ journalFile }, deps);

      expect(result.phase).toBe('complete');
      expect(result.state).toBe('complete');
      expect(result.reason).toBeNull();
      expect(result.commit).toBe(applied.commit);
      expect(result.journalFile).toBe(journalFile);
      expect(result.remoteObservation.head).toBe(applied.commit);
      expect(result.remoteObservation.containsCommit).toBe(true);
      expect(result.remoteObservation.postimagesMatch).toBe(true);
      expect(Number.isNaN(Date.parse(result.remoteObservation.observedAt))).toBe(false);
      expect(pushes(deps)).toBe(1);
      expect(remoteMain(remote)).toBe(applied.commit);
      expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(applied.commit);
      expect(liveSnapshot(repoRoot)).toEqual(before);
      expect(fs.existsSync(path.join(repoRoot, '.git', 'FETCH_HEAD'))).toBe(false);
    }
  });

  testPosix('leaves a newer unrelated local commit out of the remote', async () => {
    const ctx = await readyFixture();
    const repoRoot = ctx.repoRoot;
    write(repoRoot, 'README.md', 'unrelated later work\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated later commit']);
    const localHead = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);

    const remote = remoteOf(ctx.fixture, 'hyperclay');
    expect(result.phase).toBe('complete');
    expect(result.commit).toBe(ctx.applied.commit);
    expect(result.remoteObservation.head).toBe(ctx.applied.commit);
    expect(pushes(deps)).toBe(1);
    expect(remoteMain(remote)).toBe(ctx.applied.commit);
    expect(remoteHas(remote, localHead)).toBe(false);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(localHead);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
    expect(liveSnapshot(repoRoot)).toEqual(before);
  });

  testPosix('reads and updates only the push destination', async () => {
    const ctx = await readyFixture();
    const repoRoot = ctx.repoRoot;
    const pushRemote = remoteOf(ctx.fixture, 'hyperclay');
    const fetchRemote = fetchRemoteOf(ctx.fixture, 'hyperclay');
    expect(tryRemoteMain(fetchRemote)).toBeNull();
    const fetchRefs = git(fetchRemote, ['for-each-ref']).trim();
    const originFetch = configValue(repoRoot, 'remote.origin.fetch');
    const before = liveSnapshot(repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);

    expect(result.phase).toBe('complete');
    expect(pushes(deps)).toBe(1);
    expect(remoteMain(pushRemote)).toBe(ctx.applied.commit);
    expect(tryRemoteMain(fetchRemote)).toBeNull();
    expect(git(fetchRemote, ['for-each-ref']).trim()).toBe(fetchRefs);
    expect(configValue(repoRoot, 'remote.origin.fetch')).toBe(originFetch);
    expect(configValue(repoRoot, 'branch.main.remote')).toBeNull();
    expect(configValue(repoRoot, 'branch.main.merge')).toBeNull();
    expect(fs.existsSync(path.join(repoRoot, '.git', 'FETCH_HEAD'))).toBe(false);
    expect(git(repoRoot, ['for-each-ref', 'refs/remotes']).trim()).toBe(before.remoteRefs);
    expect(liveSnapshot(repoRoot)).toEqual(before);
  });

  testPosix('completes an already reachable commit under a remote descendant with no push', async () => {
    const ctx = await readyFixture();
    const descendant = remoteDescendant(ctx);
    const before = liveSnapshot(ctx.repoRoot);
    const beforeCommits = commitCount(ctx.repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);

    expect(result.phase).toBe('complete');
    expect(result.commit).toBe(ctx.applied.commit);
    expect(result.remoteObservation.head).toBe(descendant);
    expect(result.remoteObservation.containsCommit).toBe(true);
    expect(result.remoteObservation.postimagesMatch).toBe(true);
    expect(pushes(deps)).toBe(0);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(descendant);
    expect(commitCount(ctx.repoRoot)).toBe(beforeCommits);
    expect(liveSnapshot(ctx.repoRoot)).toEqual(before);
  });

  testPosix('conflicts when a remote descendant reverts a required path', async () => {
    const ctx = await readyFixture();
    const repoRoot = ctx.repoRoot;
    write(repoRoot, EDGE_PATH, edgeBody(OLD));
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'revert the documentation']);
    const reverted = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    git(repoRoot, ['push', '-q', 'origin', 'main']);
    const before = liveSnapshot(repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_REMOTE_CONTENT_CONFLICT');
    expect(error.journal.commit).toBe(ctx.applied.commit);
    expect(error.journal.phase).toBe('conflict');
    expect(error.journal.state).toBe('conflict');
    expect(error.journal.remoteObservation.head).toBe(reverted);
    expect(error.journal.remoteObservation.containsCommit).toBe(true);
    expect(error.journal.remoteObservation.postimagesMatch).toBe(false);
    expect(pushes(deps)).toBe(0);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(reverted);
    expect(liveSnapshot(repoRoot)).toEqual(before);

    const persisted = readJournal(ctx.journalFile);
    expect(persisted.reason.code).toBe('DOCS_REMOTE_CONTENT_CONFLICT');
    const read = readTargetJournal(ctx.journalFile, { run: deps.run });
    expect(read.phase).toBe('conflict');
    expect(read.commit).toBe(ctx.applied.commit);
    expect(read.remoteObservation.postimagesMatch).toBe(false);
  });

  testPosix('completes after a lost push response with exactly one push', async () => {
    const ctx = await readyFixture();
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      spawnHook: (command, args, options) => {
        if (args[0] !== 'push') return undefined;
        const real = childProcess.spawnSync(command, args, options);
        return { ...real, status: 1, stderr: `${real.stderr}fatal: the remote end hung up unexpectedly\n` };
      }
    });

    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);

    expect(result.phase).toBe('complete');
    expect(result.state).toBe('complete');
    expect(result.commit).toBe(ctx.applied.commit);
    expect(result.push.status).toBe(1);
    expect(result.push.stderr).toMatch(/hung up/);
    expect(pushes(deps)).toBe(1);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(ctx.applied.commit);
    expect(readJournal(ctx.journalFile).remoteObservation.containsCommit).toBe(true);
  });

  testPosix('stays pending-push when the push succeeds but the follow-up read is unavailable', async () => {
    const ctx = await readyFixture();
    let listings = 0;
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      spawnHook: (command, args) => {
        if (args[0] !== 'ls-remote') return undefined;
        listings += 1;
        if (listings === 1) return undefined;
        return { status: 128, signal: null, stdout: '', stderr: 'fatal: unable to access the push destination\n' };
      }
    });

    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_REMOTE_PUSH_UNCONFIRMED');
    expect(error.status).toBe(0);
    expect(error.journal.phase).toBe('push-intent');
    expect(error.journal.state).toBe('pending-push');
    expect(error.journal.commit).toBe(ctx.applied.commit);
    expect(error.journal.reason.code).toBe('DOCS_REMOTE_PUSH_UNCONFIRMED');
    expect(pushes(deps)).toBe(1);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(ctx.applied.commit);

    const persisted = readJournal(ctx.journalFile);
    expect(persisted.phase).toBe('push-intent');
    expect(persisted.state).toBe('pending-push');
    expect(persisted.commit).toBe(ctx.applied.commit);
    expect(persisted.reason.code).toBe('DOCS_REMOTE_PUSH_UNCONFIRMED');
    expect(persisted.remoteObservation.containsCommit).toBe(false);
    const read = readTargetJournal(ctx.journalFile, { run: deps.run });
    expect(read.state).toBe('pending-push');
    expect(read.commit).toBe(ctx.applied.commit);
  });

  testPosix('conflicts on a diverged remote without pushing', async () => {
    const ctx = await readyFixture();
    const divergent = cloneDivergentCommit(ctx);
    const remote = remoteOf(ctx.fixture, 'hyperclay');
    expect(remoteMain(remote)).toBe(divergent);
    expect(gitProbe(ctx.repoRoot, ['cat-file', '-e', `${divergent}^{commit}`]).status).not.toBe(0);
    const before = liveSnapshot(ctx.repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_REMOTE_DIVERGED');
    expect(error.journal.commit).toBe(ctx.applied.commit);
    expect(error.journal.phase).toBe('conflict');
    expect(error.journal.remoteObservation.head).toBe(divergent);
    expect(error.journal.remoteObservation.containsCommit).toBe(false);
    expect(pushes(deps)).toBe(0);
    expect(remoteMain(remote)).toBe(divergent);
    expect(liveSnapshot(ctx.repoRoot)).toEqual(before);
    expect(fs.existsSync(path.join(ctx.repoRoot, '.git', 'FETCH_HEAD'))).toBe(false);
    expect(git(ctx.repoRoot, ['for-each-ref', 'refs/remotes']).trim()).toBe(before.remoteRefs);
    expect(gitProbe(ctx.repoRoot, ['cat-file', '-e', `${divergent}^{commit}`]).status).toBe(0);
    const read = readTargetJournal(ctx.journalFile, { run: deps.run });
    expect(read.phase).toBe('conflict');
    expect(read.remoteObservation.head).toBe(divergent);
  });

  testPosix('refuses a missing branch and malformed remote listings without pushing', async () => {
    const ctx = await readyFixture();
    const remote = remoteOf(ctx.fixture, 'hyperclay');
    const head = git(ctx.repoRoot, ['rev-parse', 'HEAD']).trim();
    const cases = [
      { stdout: `${head}\trefs/heads/main\n${head}\trefs/heads/main\n` },
      { stdout: `${head} refs/heads/main\n` },
      { stdout: `${head}\trefs/heads/other\n` },
      { stdout: `${SHORT_OID}\trefs/heads/main\n` },
      { stdout: '' }
    ];

    for (const listed of cases) {
      const deps = pushDeps({
        cacheRoot: ctx.deps.cacheRoot,
        spawnHook: (command, args) => {
          if (args[0] !== 'ls-remote') return undefined;
          return { status: 0, signal: null, stdout: listed.stdout, stderr: '' };
        }
      });
      const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));
      expect(error.code).toBe('DOCS_REMOTE_UNREADABLE');
      expect(error.journal.state).toBe('pending-push');
      expect(error.journal.commit).toBe(ctx.applied.commit);
      expect(error.journal.reason.code).toBe('DOCS_REMOTE_UNREADABLE');
      expect(pushes(deps)).toBe(0);
    }

    git(remote, ['update-ref', '-d', 'refs/heads/main']);
    expect(tryRemoteMain(remote)).toBeNull();
    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));
    expect(error.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(error.journal.state).toBe('pending-push');
    expect(pushes(deps)).toBe(0);
  });

  testPosix('stays pending-push when the observed object cannot be fetched', async () => {
    const ctx = await readyFixture();
    const divergent = cloneDivergentCommit(ctx);
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      spawnHook: (command, args) => {
        if (args[0] !== 'fetch') return undefined;
        return { status: 128, signal: null, stdout: '', stderr: 'fatal: could not fetch the object\n' };
      }
    });

    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_REMOTE_OBJECT_MISSING');
    expect(error.status).toBe(128);
    expect(error.journal.phase).toBe('committed');
    expect(error.journal.state).toBe('pending-push');
    expect(error.journal.commit).toBe(ctx.applied.commit);
    expect(error.journal.reason.code).toBe('DOCS_REMOTE_OBJECT_MISSING');
    expect(pushes(deps)).toBe(0);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(divergent);
    expect(gitProbe(ctx.repoRoot, ['cat-file', '-e', `${divergent}^{commit}`]).status).not.toBe(0);
  });

  testPosix('stays pending-push in a shallow repository instead of declaring divergence', async () => {
    const ctx = await readyFixture();
    const divergent = localDivergentCommit(ctx);
    git(ctx.repoRoot, ['push', '-q', 'origin', `${divergent}:refs/heads/main`]);
    fs.writeFileSync(path.join(ctx.repoRoot, '.git', 'shallow'), `${ctx.record.beforeHead}\n`);
    expect(git(ctx.repoRoot, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(divergent);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_REMOTE_HISTORY_UNRESOLVED');
    expect(error.journal.state).toBe('pending-push');
    expect(error.journal.commit).toBe(ctx.applied.commit);
    expect(error.journal.reason.code).toBe('DOCS_REMOTE_HISTORY_UNRESOLVED');
    expect(pushes(deps)).toBe(0);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(divergent);
  });

  testPosix('refuses a changed push destination before any remote command', async () => {
    const ctx = await readyFixture();
    const elsewhere = path.join(ctx.fixture.parentDir, 'elsewhere.git');
    git(ctx.repoRoot, ['remote', 'set-url', '--push', 'origin', elsewhere]);
    const before = liveSnapshot(ctx.repoRoot);

    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(error.message).toMatch(/pushUrlSha256/);
    expect(deps.spawnRemote.calls).toEqual([]);
    expect(pushes(deps)).toBe(0);
    expect(liveSnapshot(ctx.repoRoot)).toEqual(before);
  });

  testPosix('calls the publish window only at the push boundary', async () => {
    const ctx = await readyFixture();
    const blocked = Object.assign(new Error('outside the publish window'), { code: 'PUBLISH_WINDOW_BLOCKED' });
    let windows = 0;
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      assertPublishWindow: () => {
        windows += 1;
        throw blocked;
      }
    });

    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('PUBLISH_WINDOW_BLOCKED');
    expect(windows).toBe(1);
    expect(pushes(deps)).toBe(0);
    expect(readJournal(ctx.journalFile).phase).toBe('push-intent');
    expect(readJournal(ctx.journalFile).state).toBe('pending-push');
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(ctx.record.beforeHead);

    git(ctx.repoRoot, ['push', '-q', 'origin', `${ctx.applied.commit}:refs/heads/main`]);
    const ready = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      assertPublishWindow: () => {
        throw blocked;
      }
    });
    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, ready);
    expect(result.phase).toBe('complete');
    expect(pushes(ready)).toBe(0);
    expect(windows).toBe(1);
  });

  testPosix('stops before pushing when the push intent cannot be written', async () => {
    const ctx = await readyFixture();
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      fs: failingFs({ renameSync: () => { throw new Error('injected rename failure'); } })
    });

    const error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));

    expect(error.code).toBe('DOCS_JOURNAL_WRITE_FAILED');
    expect(pushes(deps)).toBe(0);
    const journal = readJournal(ctx.journalFile);
    expect(journal.phase).toBe('committed');
    expect(journal.state).toBe('pending-push');
    expect(journal.commit).toBe(ctx.applied.commit);
    expect(remoteMain(remoteOf(ctx.fixture, 'hyperclay'))).toBe(ctx.record.beforeHead);
    expect(fs.existsSync(path.join(ctx.repoRoot, '.git', 'FETCH_HEAD'))).toBe(false);
  });

  testPosix('reobserves after one push and never pushes twice', async () => {
    const containing = await readyFixture();
    let raced = null;
    const containingDeps = pushDeps({
      cacheRoot: containing.deps.cacheRoot,
      spawnHook: (command, args) => {
        if (args[0] !== 'push') return undefined;
        raced = remoteDescendant(containing);
        return { status: 0, signal: null, stdout: '', stderr: '' };
      }
    });

    const completed = await reconcileTargetPush({ journalFile: containing.journalFile }, containingDeps);

    expect(completed.phase).toBe('complete');
    expect(completed.commit).toBe(containing.applied.commit);
    expect(completed.remoteObservation.head).toBe(raced);
    expect(completed.remoteObservation.containsCommit).toBe(true);
    expect(completed.remoteObservation.postimagesMatch).toBe(true);
    expect(pushes(containingDeps)).toBe(1);
    expect(remoteMain(remoteOf(containing.fixture, 'hyperclay'))).toBe(raced);

    const diverging = await readyFixture();
    let divergent = null;
    const divergingDeps = pushDeps({
      cacheRoot: diverging.deps.cacheRoot,
      spawnHook: (command, args) => {
        if (args[0] !== 'push') return undefined;
        divergent = localDivergentCommit(diverging);
        git(diverging.repoRoot, ['push', '-q', 'origin', `${divergent}:refs/heads/main`]);
        return { status: 0, signal: null, stdout: '', stderr: '' };
      }
    });

    const error = await refusal(reconcileTargetPush({ journalFile: diverging.journalFile }, divergingDeps));

    expect(error.code).toBe('DOCS_REMOTE_DIVERGED');
    expect(error.journal.commit).toBe(diverging.applied.commit);
    expect(error.journal.remoteObservation.head).toBe(divergent);
    expect(pushes(divergingDeps)).toBe(1);
    expect(remoteMain(remoteOf(diverging.fixture, 'hyperclay'))).toBe(divergent);
  });

  testPosix('serializes the same journal on the docs lock and never enters Ferry', async () => {
    const ctx = await readyFixture();
    let nested = null;
    const deps = pushDeps({
      cacheRoot: ctx.deps.cacheRoot,
      spawnHook: (command, args) => {
        if (args[0] === 'ls-remote' && nested === null) {
          nested = refusal(reconcileTargetPush(
            { journalFile: ctx.journalFile },
            pushDeps({ cacheRoot: ctx.deps.cacheRoot })
          ));
        }
        return undefined;
      }
    });

    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);

    expect(result.phase).toBe('complete');
    expect(pushes(deps)).toBe(1);
    expect(deps.ferryCalls).toEqual([]);
    const error = await nested;
    expect(error.code).toBe('DOCS_LOCK_BUSY');
    expect(fs.existsSync(docsLockDir(ctx.deps.cacheRoot, ctx.repoRoot))).toBe(false);
  });

  testPosix('keeps a credential destination out of logs, errors and the journal', async () => {
    const sentinel = 's3ntinel-credential-9f2b';
    const credentialDestination = `https://release:${sentinel}@push.invalid/hyperclay.git`;
    const ctx = await readyFixture({ pushUrl: credentialDestination });
    const logs = [];
    const originalWrite = releaseCommand.writeOutput;
    releaseCommand.writeOutput = (fd, value) => {
      logs.push(`${fd}:${value === undefined || value === null ? '' : String(value)}`);
    };
    let error;
    let deps;
    try {
      deps = pushDeps({
        cacheRoot: ctx.deps.cacheRoot,
        spawnHook: (command, args) => {
          if (args[0] !== 'ls-remote') return undefined;
          return {
            status: 128,
            signal: null,
            stdout: '',
            stderr: `fatal: could not read Username for '${credentialDestination}': terminal prompts disabled\n`
              + `fatal: also tried 'https://release:${sentinel}@push.invalid/other.git'\n`
          };
        }
      });
      error = await refusal(reconcileTargetPush({ journalFile: ctx.journalFile }, deps));
    } finally {
      releaseCommand.writeOutput = originalWrite;
    }

    expect(error.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(error.status).toBe(128);
    expect(error.signal).toBeNull();
    expect(error.stderr).toMatch(/could not read Username/);
    expect(error.stderr).toMatch(/https:\/\/<redacted>@push\.invalid\/other\.git/);
    expect(error.stderr).toMatch(/<push-destination>/);
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(sentinel);
    expect(JSON.stringify(error.journal)).not.toMatch(sentinel);
    expect(JSON.stringify(error.cause)).not.toMatch(sentinel);
    expect(logs.join('\n')).toMatch(/could not read Username/);
    expect(logs.join('\n')).not.toMatch(sentinel);
    expect(fs.readFileSync(ctx.journalFile, 'utf8')).not.toMatch(sentinel);
    expect(pushes(deps)).toBe(0);
    expect(readJournal(ctx.journalFile).reason.code).toBe('DOCS_REMOTE_UNREADABLE');
  });

  testPosix('refuses an unfinished or locally conflicted journal without remote commands', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    const unfinished = pushDeps({ cacheRoot: deps.cacheRoot });
    const unfinishedError = await refusal(reconcileTargetPush({ journalFile }, unfinished));
    expect(unfinishedError.code).toBe('DOCS_APPLY_NOT_FINISHED');
    expect(unfinished.spawnRemote.calls).toEqual([]);
    expect(unfinished.ferryCalls).toEqual([]);

    const applied = await applyPreparedTarget({ journalFile }, deps);
    expect(applied.state).toBe('pending-push');
    const payload = rewriteJournal(journalFile, {
      phase: 'conflict',
      state: 'conflict',
      reason: { code: 'DOCS_PREIMAGE_CONFLICT', message: 'injected local conflict' }
    });

    const conflicted = pushDeps({ cacheRoot: deps.cacheRoot });
    const conflictError = await refusal(reconcileTargetPush({ journalFile }, conflicted));
    expect(conflictError.code).toBe('DOCS_LOCAL_CONFLICT');
    expect(conflicted.spawnRemote.calls).toEqual([]);
    expect(conflicted.ferryCalls).toEqual([]);
    expect(fs.readFileSync(journalFile, 'utf8')).toBe(payload);
    expect(remoteMain(remoteOf(fixture, 'hyperclay'))).toBe(record.beforeHead);
  });

  testPosix('reads back completed journals and refuses a false completion', async () => {
    const ctx = await readyFixture();
    const deps = pushDeps({ cacheRoot: ctx.deps.cacheRoot });
    const result = await reconcileTargetPush({ journalFile: ctx.journalFile }, deps);
    expect(result.phase).toBe('complete');

    const read = readTargetJournal(ctx.journalFile, { run: deps.run });
    expect(read.phase).toBe('complete');
    expect(read.state).toBe('complete');
    expect(read.reason).toBeNull();
    expect(read.commit).toBe(ctx.applied.commit);
    expect(read.remoteObservation).toEqual(result.remoteObservation);
    expect(Object.keys(read.remoteObservation).sort()).toEqual(['containsCommit', 'head', 'observedAt', 'postimagesMatch']);

    const pristine = fs.readFileSync(ctx.journalFile, 'utf8');
    const observation = read.remoteObservation;
    const refused = (patch) => {
      const payload = rewriteJournal(ctx.journalFile, patch);
      const outcome = readRefusal(ctx.journalFile, { run: deps.run });
      expect(outcome.ok).toBe(false);
      expect(outcome.error.code).toBe('DOCS_JOURNAL_INVALID');
      expect(fs.readFileSync(ctx.journalFile, 'utf8')).toBe(payload);
    };

    refused({ remoteObservation: null });
    refused({ remoteObservation: { ...observation, containsCommit: false } });
    refused({ remoteObservation: { ...observation, postimagesMatch: false } });
    refused({ remoteObservation: { ...observation, extra: true } });
    refused({ remoteObservation: { ...observation, head: SHORT_OID } });
    refused({ remoteObservation: { ...observation, observedAt: 'not a timestamp' } });
    refused({ remoteObservation: { ...observation, containsCommit: 'yes' } });
    refused({ reason: { code: 'DOCS_REMOTE_DIVERGED', message: 'tampered' } });
    refused({ state: 'pending-push' });
    refused({ commit: null });
    refused({ unexpected: true });

    fs.writeFileSync(ctx.journalFile, pristine);
    const restored = readRefusal(ctx.journalFile, { run: deps.run });
    expect(restored.ok).toBe(true);
    expect(restored.journal.phase).toBe('complete');
  });
});
