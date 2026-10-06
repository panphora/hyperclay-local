// The updater prepares, plans, applies and pushes each documentation repository
// separately, keeps a small fsynced control record for the selected attempt and
// adopted journal operation, and only reports complete after a fresh remote
// observation. Every fixture repository here is a local scratch checkout with its
// own local bare remotes, HOME/config and hooks, so no network, sibling checkout,
// browser, release or production path is touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { updateExternalDocs } = require('../../scripts/update-external-docs');
const { openDocsRun, attemptPaths, RUN_FILE } = require('../../scripts/release-docs-run');
const { prepareExternalDocs } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const { prepareCommitIntent, reconcileTarget } = require('../../scripts/release-docs-apply');
const { resolveRepoIdentity } = require('../../scripts/release-state');
const { withDocsLock, withReleaseLock } = require('../../scripts/release-lock');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(300000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_NAME = '15 Hyperclay Local App.md';
const VAULT_PATH = `vault/DOCS/${VAULT_NAME}`;
const MDX_PATH = 'content/docs/hyperclay-local-app.mdx';
const LLMS_PATH = 'public/llms.txt';
const REPOS = ['hyperclay', 'hyperclay-website'];
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-docs-updater-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const RUNS = path.join(OWNER, 'runs');
const CACHES = path.join(OWNER, 'caches');
const DESKTOPS = path.join(OWNER, 'desktops');
const PARENTS = path.join(OWNER, 'parents');
const REMOTES = path.join(OWNER, 'remotes');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

for (const dir of [NO_HOOKS, RUNS, CACHES, DESKTOPS, PARENTS, REMOTES]) {
  fs.mkdirSync(dir, { recursive: true });
}
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
let cacheSeq = 0;
let desktopSeq = 0;

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
    write(cwd, `content/docs/${cleanName(name)}.mdx`,
      `---\ntitle: ${title}\npublish: true\n---\n\n${bodyOf(fs.readFileSync(path.join(vaultDir, name), 'utf8'))}`);
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

function makeDesktop({ withModules = false } = {}) {
  const root = path.join(DESKTOPS, `desktop-${++desktopSeq}`);
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/hyperclay-fixture/desktop.git']);
  write(root, 'package.json', `${JSON.stringify({ name: 'desktop-fixture', version: NEW }, null, 2)}\n`);
  if (withModules) {
    const scripts = path.join(root, 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    const sourceScripts = path.join(__dirname, '..', '..', 'scripts');
    for (const name of fs.readdirSync(sourceScripts).filter((name) => name.endsWith('.js'))) {
      fs.copyFileSync(path.join(sourceScripts, name), path.join(scripts, name));
    }
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture']);
  return root;
}

function readGit(repoRoot, args) {
  return childProcess.execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', env: GIT_ENV }).trim();
}

function makeFixture({ repos = REPOS, docsVersion = OLD } = {}) {
  const parentDir = fs.mkdtempSync(path.join(PARENTS, `parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(REMOTES, `remotes-${++fixtureSeq}-`));
  const remotes = new Map();
  for (const repo of repos) {
    const push = path.join(remoteDir, `${repo}.git`);
    const fetch = path.join(remoteDir, `${repo}-fetch.git`);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', push]);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', fetch]);
    remotes.set(repo, { push, fetch });
  }
  const roots = new Map();
  for (const repo of repos) {
    const root = path.join(parentDir, repo);
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['remote', 'add', 'origin', remotes.get(repo).fetch]);
    git(root, ['remote', 'set-url', '--push', 'origin', remotes.get(repo).push]);
    if (repo === 'hyperclay') {
      write(root, 'README.md', 'hyperclay readme\n');
      write(root, EDGE_PATH, edgeBody(docsVersion));
    } else {
      write(root, VAULT_PATH, vaultBody(docsVersion));
      write(root, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
      write(root, 'package.json', `${JSON.stringify({
        name: 'hyperclay-website',
        version: '0.0.0',
        scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
      }, null, 2)}\n`);
      canonicalSyncDocs(root);
      canonicalLlmsTxt(root);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'fixture']);
    git(root, ['push', '-q', 'origin', 'main']);
    roots.set(repo, root);
  }
  return {
    parentDir,
    remotes,
    roots,
    runDir: path.join(RUNS, `run-${++runSeq}`),
    resultFile: path.join(RUNS, `run-${runSeq}`, 'result.json')
  };
}

function siblingLockIdentity(root) {
  const commonDir = fs.realpathSync(path.join(root, '.git'));
  return {
    key: sha256(commonDir),
    root: fs.realpathSync(root),
    commonDir,
    branch: 'main',
    remote: 'origin',
    remoteRef: 'refs/heads/main',
    pushUrlSha256: sha256(git(root, ['remote', 'get-url', '--push', 'origin']).trim()),
    objectFormat: 'sha1'
  };
}

function uuidFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

function newCache() {
  return path.join(CACHES, `cache-${++cacheSeq}`);
}

function fakeNpm(liveWebsite, cwd, args) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('npm needs an absolute snapshot cwd');
  if (liveWebsite && (cwd === liveWebsite || cwd.startsWith(`${liveWebsite}${path.sep}`))) {
    throw new Error('npm was pointed at the live website');
  }
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
}

function depsFor(options = {}) {
  const calls = [];
  const spawnCalls = [];
  const remoteCalls = [];
  const run = (command, args, opts = {}) => {
    calls.push({ command, args: args.slice(), cwd: opts.cwd });
    if (options.hook) {
      const injected = options.hook(command, args, opts);
      if (injected !== undefined) return injected;
    }
    if (command === 'npm') return fakeNpm(options.liveWebsite, opts.cwd, args);
    if (command !== 'git' && command !== 'tar') {
      throw new Error(`unexpected production command: ${command} ${args.join(' ')}`);
    }
    const { echoStdout, ...rest } = opts;
    return childProcess.execFileSync(command, args, {
      encoding: 'utf8',
      ...rest,
      env: { ...GIT_ENV, ...(rest.env || {}) }
    });
  };
  run.calls = calls;
  const spawn = (command, args, opts = {}) => {
    spawnCalls.push({ command, args: args.slice() });
    if (command !== 'git') throw new Error(`unexpected production spawn: ${command}`);
    return childProcess.spawnSync(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
  };
  spawn.calls = spawnCalls;
  const spawnRemote = (command, args, spawnOptions = {}) => {
    remoteCalls.push([command, ...args]);
    if (options.spawnHook) {
      const injected = options.spawnHook(command, args, spawnOptions);
      if (injected !== undefined) return injected;
    }
    if (command !== 'git') throw new Error(`unexpected remote command: ${command}`);
    return childProcess.spawnSync(command, args, spawnOptions);
  };
  spawnRemote.calls = remoteCalls;
  return {
    repoRoot: options.desktop || makeDesktop(),
    run,
    spawn,
    spawnRemote,
    fs: options.fs,
    now: options.now,
    randomUUID: options.randomUUID || uuidFactory(),
    cacheRoot: options.cacheRoot || newCache(),
    assertPublishWindow: options.assertPublishWindow || (() => {}),
    withFerryRepoLock: options.withFerryRepoLock || (async (root, callback) => callback()),
    readGit: options.readGit || readGit
  };
}

function applyDepsFor(deps) {
  const resolved = {
    run: deps.run,
    spawnRemote: deps.spawnRemote,
    fs: deps.fs,
    now: deps.now,
    randomUUID: deps.randomUUID,
    cacheRoot: deps.cacheRoot,
    assertPublishWindow: deps.assertPublishWindow,
    withFerryRepoLock: deps.withFerryRepoLock
  };
  return resolved;
}

function ownerOf(desktopRoot) {
  const identity = resolveRepoIdentity(desktopRoot, { readGit });
  return { root: identity.root, commonDir: identity.commonDir, key: identity.key };
}

function openRun(fixture, deps, options = {}) {
  return openDocsRun({
    version: options.version || NEW,
    parentDir: fixture.parentDir,
    runDir: fixture.runDir,
    resultFile: fixture.resultFile,
    owner: ownerOf(deps.repoRoot)
  }, { fs: options.fs || fs, randomUUID: deps.randomUUID });
}

function readRun(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixture.runDir, RUN_FILE), 'utf8'));
}

function readResult(fixture) {
  return JSON.parse(fs.readFileSync(fixture.resultFile, 'utf8'));
}

function slotOf(record, repo) {
  return record.targets[REPOS.indexOf(repo)];
}

function attemptRoot(fixture, repo, attemptId) {
  return attemptPaths(fixture.runDir, repo, attemptId).root;
}

function liveSnapshot(root) {
  const reflog = path.join(root, '.git', 'logs', 'HEAD');
  return {
    branch: git(root, ['symbolic-ref', '-q', 'HEAD']).trim(),
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    status: git(root, ['status', '--porcelain=v1', '-z']),
    remoteRefs: git(root, ['for-each-ref', 'refs/remotes']).trim(),
    reflog: fs.existsSync(reflog) ? sha256(fs.readFileSync(reflog)) : null,
    untracked: git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    worktree: git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
      .map((name) => `${name}:${sha256(fs.readFileSync(path.join(root, name)))}`)
  };
}

function treeSnapshot(root) {
  const entries = [];
  const visit = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const stat = fs.lstatSync(abs);
      if (stat.isDirectory()) {
        entries.push(`${childRel}/`);
        visit(abs, childRel);
        continue;
      }
      entries.push(`${childRel}:${stat.isFile() ? sha256(fs.readFileSync(abs)) : 'other'}`);
    }
  };
  if (!fs.existsSync(root)) return entries;
  visit(root, '');
  return entries;
}

function remoteMain(remote) {
  const probe = gitProbe(remote, ['rev-parse', '--verify', 'refs/heads/main']);
  return probe.status === 0 ? probe.stdout.trim() : null;
}

function commitCount(root) {
  return Number(git(root, ['rev-list', '--all', '--count']).trim());
}

function pushes(deps) {
  return deps.spawnRemote.calls.filter((call) => call[1] === 'push').length;
}

function npmCalls(deps) {
  return deps.run.calls.filter((call) => call.command === 'npm').length;
}

function archiveCalls(deps, cwd) {
  return deps.run.calls.filter((call) => call.command === 'git' && call.args[0] === 'archive'
    && (cwd === undefined || call.cwd === cwd)).length;
}

function hookFs(hook) {
  return new Proxy(fs, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => hook(prop, args, () => value.apply(target, args));
    }
  });
}

function failRenameAt(target, nth, error) {
  let seen = 0;
  return hookFs((prop, args, next) => {
    if (prop === 'renameSync' && args[1] === target) {
      seen += 1;
      if (seen === nth) throw error || new Error(`injected rename failure for ${target}`);
    }
    return next();
  });
}

function failOn(predicate, error) {
  return hookFs((prop, args, next) => {
    if (predicate(prop, args)) throw error || new Error(`injected ${prop} failure`);
    return next();
  });
}

function refusal(promise) {
  return Promise.resolve(promise).then(() => null, (error) => error);
}

async function runUpdater(fixture, deps, options = {}) {
  return updateExternalDocs({
    version: options.version || NEW,
    parentDir: options.parentDir || fixture.parentDir,
    runDir: options.runDir || fixture.runDir,
    resultFile: options.resultFile || fixture.resultFile
  }, deps);
}

function completeEntries(result) {
  return result.targets.filter((entry) => entry.state === 'complete').length;
}

describe('documentation updater', () => {
  testPosix('completes both independent targets with exact paths and fresh local bare remote proof', async () => {
    const fixture = makeFixture();
    const deps = depsFor({ liveWebsite: fixture.roots.get('hyperclay-website') });
    write(fixture.roots.get('hyperclay'), 'notes.txt', 'unrelated work\n');
    write(fixture.roots.get('hyperclay'), 'README.md', 'hyperclay readme with local edit\n');
    write(fixture.roots.get('hyperclay-website'), 'scratch.txt', 'unrelated website work\n');
    const before = new Map(REPOS.map((repo) => [repo, liveSnapshot(fixture.roots.get(repo))]));

    const result = await runUpdater(fixture, deps);

    expect(result.schema).toBe(1);
    expect(result.version).toBe(NEW);
    expect(result.targets.map((entry) => entry.repo)).toEqual(REPOS);
    expect(completeEntries(result)).toBe(2);

    const record = readRun(fixture);
    expect(readResult(fixture)).toEqual(result);
    for (const repo of REPOS) {
      const entry = result.targets[REPOS.indexOf(repo)];
      const slot = slotOf(record, repo);
      const paths = attemptPaths(fixture.runDir, repo, slot.attemptId);
      const journal = JSON.parse(fs.readFileSync(paths.journalFile, 'utf8'));
      const root = fixture.roots.get(repo);

      expect(entry.state).toBe('complete');
      expect(entry.reason).toBeNull();
      expect(entry.journalFile).toBe(paths.journalFile);
      expect(entry.paths).toEqual(journal.requiredPaths);
      expect(entry.paths.length).toBeGreaterThan(0);
      expect(entry.beforeHead).toBe(journal.beforeHead);
      expect(entry.commit).toBe(journal.commit);
      expect(entry.commit).toMatch(OID_PATTERN);
      expect(entry.remoteHead).toBe(entry.commit);
      expect(Number.isNaN(Date.parse(entry.verifiedAt))).toBe(false);
      expect(journal.state).toBe('complete');
      expect(journal.operationId).toBe(slot.journalOperationId);
      expect(journal.remoteObservation.head).toBe(entry.commit);
      expect(journal.remoteObservation.containsCommit).toBe(true);
      expect(journal.remoteObservation.postimagesMatch).toBe(true);
      expect(remoteMain(fixture.remotes.get(repo).push)).toBe(entry.commit);
      expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(entry.commit);

      const prepared = JSON.parse(fs.readFileSync(paths.preparedFile, 'utf8'));
      expect(prepared.targets.map((target) => target.repo)).toEqual([repo]);
      expect(fs.readdirSync(paths.prepareDir).filter((name) => name !== 'prepared.json')).toEqual([repo]);
      expect(archiveCalls(deps, root)).toBe(1);
    }

    expect(npmCalls(deps)).toBe(5);
    expect(pushes(deps)).toBe(2);
    for (const repo of REPOS) {
      const root = fixture.roots.get(repo);
      const after = liveSnapshot(root);
      expect(after.head).not.toBe(before.get(repo).head);
      expect(after.status).toBe(before.get(repo).status);
      expect(after.untracked).toBe(before.get(repo).untracked);
      expect(after.remoteRefs).toBe(before.get(repo).remoteRefs);
      expect(after.worktree.length).toBe(before.get(repo).worktree.length);
      expect(fs.existsSync(path.join(root, '.git', 'FETCH_HEAD'))).toBe(false);
    }
    expect(fs.readFileSync(path.join(fixture.roots.get('hyperclay'), 'README.md'), 'utf8'))
      .toBe('hyperclay readme with local edit\n');
    expect(fs.readFileSync(path.join(fixture.roots.get('hyperclay-website'), 'scratch.txt'), 'utf8'))
      .toBe('unrelated website work\n');
    expect(git(fixture.roots.get('hyperclay'), ['status', '--porcelain=v1', '-z']))
      .toContain('README.md');
    expect(fs.existsSync(path.join(fixture.roots.get('hyperclay'), 'notes.txt'))).toBe(true);
  });
});

function expectCode(promise, code) {
  return refusal(promise).then((error) => {
    expect(error).not.toBeNull();
    expect(error.code).toBe(code);
    return error;
  });
}

function expectRejection(promise) {
  return refusal(promise).then((error) => {
    expect(error).not.toBeNull();
    return error;
  });
}

function readJournalFor(fixture, repo) {
  const slot = slotOf(readRun(fixture), repo);
  return JSON.parse(fs.readFileSync(attemptPaths(fixture.runDir, repo, slot.attemptId).journalFile, 'utf8'));
}

function writeJournalFor(fixture, repo, journal) {
  const slot = slotOf(readRun(fixture), repo);
  fs.writeFileSync(attemptPaths(fixture.runDir, repo, slot.attemptId).journalFile, `${JSON.stringify(journal, null, 2)}\n`);
}

function attemptFor(fixture, repo) {
  const slot = slotOf(readRun(fixture), repo);
  return attemptPaths(fixture.runDir, repo, slot.attemptId);
}

function headOf(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function emptyParent() {
  return fs.mkdtempSync(path.join(PARENTS, `empty-${++fixtureSeq}-`));
}

function failDirFsync(dir, nth) {
  let seen = 0;
  const owned = new Set();
  return hookFs((prop, args, next) => {
    if (prop === 'openSync' && args[0] === dir) {
      const fd = next();
      owned.add(fd);
      return fd;
    }
    if (prop === 'closeSync') {
      owned.delete(args[0]);
      return next();
    }
    if (prop === 'fsyncSync' && owned.has(args[0])) {
      seen += 1;
      if (seen === nth) throw new Error(`injected directory fsync failure for ${dir}`);
    }
    return next();
  });
}

function runCli(desktop, args, home) {
  return childProcess.spawnSync(process.execPath, [path.join(desktop, 'scripts', 'update-external-docs.js'), ...args], {
    env: { ...GIT_ENV, HOME: home },
    encoding: 'utf8'
  });
}

testPosix('keeps a durably complete target when the independent sibling is missing', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const deps = depsFor();
  const result = await runUpdater(fixture, deps);

  expect(result.targets[0].state).toBe('complete');
  expect(result.targets[1].state).toBe('missing');
  expect(result.targets[1].reason.code).toBe('DOCS_REPO_MISSING');
  expect(readResult(fixture)).toEqual(result);
  const journal = readJournalFor(fixture, 'hyperclay');
  expect(journal.state).toBe('complete');
  expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(journal.commit);
  expect(readRun(fixture).targets[1].attemptId).toBeNull();
});

testPosix('keeps the website complete when the hyperclay sibling is missing', async () => {
  const fixture = makeFixture({ repos: ['hyperclay-website'] });
  const deps = depsFor();
  const result = await runUpdater(fixture, deps);

  expect(result.targets[0].state).toBe('missing');
  expect(result.targets[0].reason.code).toBe('DOCS_REPO_MISSING');
  expect(result.targets[1].state).toBe('complete');
  expect(readResult(fixture)).toEqual(result);
  expect(remoteMain(fixture.remotes.get('hyperclay-website').push)).toBe(result.targets[1].commit);
  expect(readRun(fixture).targets[0].attemptId).toBeNull();
});

testPosix('records both preparation failures without touching either live repository', async () => {
  const fixture = makeFixture();
  const hyperclayRoot = fixture.roots.get('hyperclay');
  const before = new Map(REPOS.map((repo) => [repo, headOf(fixture.roots.get(repo))]));
  const deps = depsFor({
    hook: (command, args, opts) => {
      if (command === 'npm') throw new Error('injected website generator failure');
      if (command === 'git' && opts.cwd === hyperclayRoot && args[0] === 'rev-parse') {
        throw new Error('injected hyperclay preparation failure');
      }
      return undefined;
    }
  });
  const result = await runUpdater(fixture, deps);

  expect(completeEntries(result)).toBe(0);
  expect(result.targets.map((entry) => entry.state)).toEqual(['failed', 'failed']);
  expect(result.targets[0].reason.code).toBe('DOCS_PREPARE_FAILED');
  expect(result.targets[0].reason.message).toBe('injected hyperclay preparation failure');
  expect(result.targets[1].reason.code).toBe('DOCS_PREPARE_FAILED');
  expect(result.targets[1].reason.message).toBe('injected website generator failure');
  expect(pushes(deps)).toBe(0);
  for (const repo of REPOS) expect(headOf(fixture.roots.get(repo))).toBe(before.get(repo));
  expect(readResult(fixture)).toEqual(result);
});

testPosix('loads the pure exports without acting and runs the real require.main entry', async () => {
  const scratch = fs.mkdtempSync(path.join(OWNER, 'inert-'));
  const bin = path.join(scratch, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['git', 'npm']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho ran > "${path.join(scratch, `${name}-ran`)}"\nexit 7\n`, { mode: 0o755 });
  }
  const before = treeSnapshot(scratch);
  const modulePath = path.join(__dirname, '..', '..', 'scripts', 'update-external-docs.js');
  const probe = childProcess.spawnSync(process.execPath, ['-e', `
    const m = require(${JSON.stringify(modulePath)});
    const updated = m.updateVersionInContent('HyperclayLocal-1.2.3-arm64.dmg', '1.2.3', '1.2.4');
    console.log(JSON.stringify({
      old: m.detectOldVersion('HyperclayLocal-1.2.3-arm64.dmg'),
      updated: updated.updated.includes('HyperclayLocal-1.2.4')
    }));
  `], { cwd: scratch, env: { ...GIT_ENV, HOME: scratch, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });

  expect(probe.status).toBe(0);
  expect(JSON.parse(probe.stdout.trim())).toEqual({ old: '1.2.3', updated: true });
  expect(fs.existsSync(path.join(scratch, 'git-ran'))).toBe(false);
  expect(fs.existsSync(path.join(scratch, 'npm-ran'))).toBe(false);
  expect(treeSnapshot(scratch)).toEqual(before);

  const desktop = makeDesktop({ withModules: true });
  const cli = runCli(desktop, ['--bogus'], scratch);
  expect(cli.status).toBe(1);
  expect(cli.stderr).toContain('Unknown option --bogus');
});

testPosix('reuses a selected attempt with no evidence and rotates an unpublished prepare directory', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const deps = depsFor();
  const chosen = '11111111-1111-4111-8111-111111111111';
  const handle = openRun(fixture, deps);
  handle.selectAttempt('hyperclay', chosen);
  expect(readRun(fixture).targets[0].attemptId).toBe(chosen);

  const result = await runUpdater(fixture, deps);
  expect(result.targets[0].state).toBe('complete');
  expect(readRun(fixture).targets[0].attemptId).toBe(chosen);
  expect(fs.existsSync(attemptPaths(fixture.runDir, 'hyperclay', chosen).preparedFile)).toBe(true);

  const rotatedFixture = makeFixture({ repos: ['hyperclay'] });
  const rotatedDeps = depsFor();
  const stale = '22222222-2222-4222-8222-222222222222';
  const rotatedHandle = openRun(rotatedFixture, rotatedDeps);
  rotatedHandle.selectAttempt('hyperclay', stale);
  const stalePaths = attemptPaths(rotatedFixture.runDir, 'hyperclay', stale);
  fs.mkdirSync(stalePaths.prepareDir, { recursive: true });
  const retained = treeSnapshot(stalePaths.root);
  const rotatedResult = await runUpdater(rotatedFixture, rotatedDeps);

  expect(rotatedResult.targets[0].state).toBe('complete');
  expect(readRun(rotatedFixture).targets[0].attemptId).not.toBe(stale);
  expect(treeSnapshot(stalePaths.root)).toEqual(retained);
  expect(fs.existsSync(stalePaths.preparedFile)).toBe(false);
});

testPosix('rotates an unpublished apply directory to a fresh attempt', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const deps = depsFor();
  const stale = '33333333-3333-4333-8333-333333333333';
  const handle = openRun(fixture, deps);
  handle.selectAttempt('hyperclay', stale);
  const stalePaths = attemptPaths(fixture.runDir, 'hyperclay', stale);
  fs.mkdirSync(stalePaths.applyDir, { recursive: true });
  const retained = treeSnapshot(stalePaths.root);

  const result = await runUpdater(fixture, deps);
  expect(result.targets[0].state).toBe('complete');
  expect(readRun(fixture).targets[0].attemptId).not.toBe(stale);
  expect(treeSnapshot(stalePaths.root)).toEqual(retained);
  expect(fs.existsSync(stalePaths.applicationFile)).toBe(false);
});

testPosix('reuses a published preparation and a published application without rerunning preparation', async () => {
  const prepared = makeFixture({ repos: ['hyperclay'] });
  const preparedDeps = depsFor();
  const preparedId = '44444444-4444-4444-8444-444444444444';
  const preparedHandle = openRun(prepared, preparedDeps);
  preparedHandle.selectAttempt('hyperclay', preparedId);
  const preparedPaths = attemptPaths(prepared.runDir, 'hyperclay', preparedId);
  fs.mkdirSync(preparedPaths.root, { recursive: true });
  prepareExternalDocs(
    { version: NEW, parentDir: prepared.parentDir, runDir: preparedPaths.prepareDir, targets: ['hyperclay'] },
    { run: preparedDeps.run }
  );
  expect(archiveCalls(preparedDeps, prepared.roots.get('hyperclay'))).toBe(1);
  const preparedResult = await runUpdater(prepared, preparedDeps);
  expect(preparedResult.targets[0].state).toBe('complete');
  expect(archiveCalls(preparedDeps, prepared.roots.get('hyperclay'))).toBe(1);
  expect(npmCalls(preparedDeps)).toBe(0);

  const applied = makeFixture({ repos: ['hyperclay'] });
  const appliedDeps = depsFor();
  const appliedId = '55555555-5555-4555-8555-555555555555';
  const appliedHandle = openRun(applied, appliedDeps);
  appliedHandle.selectAttempt('hyperclay', appliedId);
  const appliedPaths = attemptPaths(applied.runDir, 'hyperclay', appliedId);
  fs.mkdirSync(appliedPaths.root, { recursive: true });
  prepareExternalDocs(
    { version: NEW, parentDir: applied.parentDir, runDir: appliedPaths.prepareDir, targets: ['hyperclay'] },
    { run: appliedDeps.run }
  );
  prepareDocsApplication(
    { preparedFile: appliedPaths.preparedFile, repo: 'hyperclay', parentDir: applied.parentDir, version: NEW, outDir: appliedPaths.applyDir },
    { run: appliedDeps.run, spawn: appliedDeps.spawn }
  );
  const applicationBytes = fs.readFileSync(appliedPaths.applicationFile);
  const appliedResult = await runUpdater(applied, appliedDeps);
  expect(appliedResult.targets[0].state).toBe('complete');
  expect(archiveCalls(appliedDeps, applied.roots.get('hyperclay'))).toBe(1);
  expect(fs.readFileSync(appliedPaths.applicationFile).equals(applicationBytes)).toBe(true);
});

testPosix('adopts a published journal that was never bound to the run record', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  const desktop = makeDesktop();
  const deps = depsFor({ desktop, fs: failRenameAt(path.join(fixture.runDir, RUN_FILE), 3) });
  const beforeHead = headOf(root);
  await expectCode(runUpdater(fixture, deps), 'DOCS_RUN_WRITE_FAILED');

  const interrupted = readRun(fixture);
  expect(interrupted.targets[0].attemptId).not.toBeNull();
  expect(interrupted.targets[0].journalOperationId).toBeNull();
  const paths = attemptFor(fixture, 'hyperclay');
  const journal = JSON.parse(fs.readFileSync(paths.journalFile, 'utf8'));
  expect(journal.candidateCommit).not.toBeNull();
  expect(journal.commit).toBeNull();
  expect(headOf(root)).toBe(beforeHead);
  expect(pushes(deps)).toBe(0);
  const commits = commitCount(root);

  const resumedDeps = depsFor({ desktop });
  const result = await runUpdater(fixture, resumedDeps);
  expect(result.targets[0].state).toBe('complete');
  expect(readRun(fixture).targets[0].journalOperationId).toBe(journal.operationId);
  const resumedJournal = JSON.parse(fs.readFileSync(paths.journalFile, 'utf8'));
  expect(resumedJournal.operationId).toBe(journal.operationId);
  expect(resumedJournal.commit).toBe(journal.candidateCommit);
  expect(commitCount(root)).toBe(commits + 1);
  expect(archiveCalls(resumedDeps, root)).toBe(0);
  expect(npmCalls(resumedDeps)).toBe(0);
});

testPosix('adopts an unchanged journal created directly by prepareCommitIntent', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'], docsVersion: NEW });
  const desktop = makeDesktop();
  const deps = depsFor({ desktop });
  const chosen = '66666666-6666-4666-8666-666666666666';
  const handle = openRun(fixture, deps);
  handle.selectAttempt('hyperclay', chosen);
  const paths = attemptPaths(fixture.runDir, 'hyperclay', chosen);
  fs.mkdirSync(paths.root, { recursive: true });
  prepareExternalDocs(
    { version: NEW, parentDir: fixture.parentDir, runDir: paths.prepareDir, targets: ['hyperclay'] },
    { run: deps.run }
  );
  prepareDocsApplication(
    { preparedFile: paths.preparedFile, repo: 'hyperclay', parentDir: fixture.parentDir, version: NEW, outDir: paths.applyDir },
    { run: deps.run, spawn: deps.spawn }
  );
  await prepareCommitIntent(
    { applicationFile: paths.applicationFile, journalFile: paths.journalFile, message: `chore: update Hyperclay Local download links to v${NEW}` },
    applyDepsFor(deps)
  );
  const journal = JSON.parse(fs.readFileSync(paths.journalFile, 'utf8'));
  expect(journal.candidateCommit).toBeNull();
  expect(journal.commit).not.toBeNull();
  expect(journal.paths).toEqual([]);
  const commits = commitCount(fixture.roots.get('hyperclay'));

  const resumedDeps = depsFor({ desktop });
  const result = await runUpdater(fixture, resumedDeps);
  expect(result.targets[0].state).toBe('complete');
  expect(readRun(fixture).targets[0].journalOperationId).toBe(journal.operationId);
  const resumedJournal = JSON.parse(fs.readFileSync(paths.journalFile, 'utf8'));
  expect(resumedJournal.operationId).toBe(journal.operationId);
  expect(resumedJournal.candidateCommit).toBeNull();
  expect(resumedJournal.commit).toBe(journal.commit);
  expect(commitCount(fixture.roots.get('hyperclay'))).toBe(commits);
  expect(archiveCalls(resumedDeps, fixture.roots.get('hyperclay'))).toBe(0);
  expect(npmCalls(resumedDeps)).toBe(0);
});

testPosix('fails a bound target journal without rotating the attempt or mutating the live branch', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  const desktop = makeDesktop();
  const deps = depsFor({ desktop });
  const first = await runUpdater(fixture, deps);
  expect(first.targets[0].state).toBe('complete');

  const slot = readRun(fixture).targets[0];
  const paths = attemptPaths(fixture.runDir, 'hyperclay', slot.attemptId);
  const original = fs.readFileSync(paths.journalFile);
  const originalHead = headOf(root);
  const originalRemote = remoteMain(fixture.remotes.get('hyperclay').push);
  const originalCommit = first.targets[0].commit;

  const variants = [
    ['missing', () => fs.rmSync(paths.journalFile)],
    ['corrupt', () => fs.writeFileSync(paths.journalFile, '{not json\n')],
    ['swapped version', () => {
      const journal = JSON.parse(original.toString());
      journal.version = OLD;
      writeJournalFor(fixture, 'hyperclay', journal);
    }],
    ['swapped root', () => {
      const journal = JSON.parse(original.toString());
      journal.repoRoot = fixture.parentDir;
      writeJournalFor(fixture, 'hyperclay', journal);
    }],
    ['swapped operation', () => {
      const journal = JSON.parse(original.toString());
      journal.operationId = '77777777-7777-4777-8777-777777777777';
      writeJournalFor(fixture, 'hyperclay', journal);
    }]
  ];

  for (const [label, mutate] of variants) {
    fs.writeFileSync(paths.journalFile, original);
    mutate();
    const rerunDeps = depsFor({ desktop });
    const rerun = await runUpdater(fixture, rerunDeps);
    expect([label, rerun.targets[0].state]).toEqual([label, 'failed']);
    expect(['DOCS_JOURNAL_INVALID', 'DOCS_RUN_TARGET_MISMATCH', 'DOCS_APPLICATION_INVALID'])
      .toContain(rerun.targets[0].reason.code);
    expect(readRun(fixture).targets[0].attemptId).toBe(slot.attemptId);
    expect(headOf(root)).toBe(originalHead);
    expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(originalRemote);
    expect(pushes(rerunDeps)).toBe(0);
    expect(npmCalls(rerunDeps)).toBe(0);
    expect(archiveCalls(rerunDeps, root)).toBe(0);
  }

  fs.writeFileSync(paths.journalFile, original);
  write(root, 'later.txt', 'later work\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'later unrelated work']);
  const laterHead = headOf(root);
  const advancedDeps = depsFor({ desktop });
  const advanced = await runUpdater(fixture, advancedDeps);
  expect(advanced.targets[0].state).toBe('complete');
  expect(advanced.targets[0].commit).toBe(originalCommit);
  expect(readJournalFor(fixture, 'hyperclay').commit).toBe(originalCommit);
  expect(headOf(root)).toBe(laterHead);
  expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(originalCommit);
});

testPosix('resumes the same local commit after a crash before the aggregate update', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  const desktop = makeDesktop();
  const deps = depsFor({ desktop, fs: failRenameAt(fixture.resultFile, 3) });
  await expectCode(runUpdater(fixture, deps), 'DOCS_RESULT_WRITE_FAILED');

  const journal = readJournalFor(fixture, 'hyperclay');
  expect(journal.commit).not.toBeNull();
  expect(headOf(root)).toBe(journal.commit);
  expect(pushes(deps)).toBe(0);
  const commits = commitCount(root);

  const resumedDeps = depsFor({ desktop });
  const resumed = await runUpdater(fixture, resumedDeps);
  expect(resumed.targets[0].state).toBe('complete');
  expect(resumed.targets[0].commit).toBe(journal.commit);
  expect(commitCount(root)).toBe(commits);
  expect(pushes(resumedDeps)).toBe(1);
  expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(journal.commit);
});

testPosix('observes an already-accepted remote without another documentation commit', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  const desktop = makeDesktop();
  const deps = depsFor({ desktop, fs: failRenameAt(fixture.resultFile, 4) });
  await expectCode(runUpdater(fixture, deps), 'DOCS_RESULT_WRITE_FAILED');

  expect(pushes(deps)).toBe(1);
  const journal = readJournalFor(fixture, 'hyperclay');
  expect(journal.state).toBe('complete');
  expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(journal.commit);
  const commits = commitCount(root);

  const resumedDeps = depsFor({ desktop });
  const resumed = await runUpdater(fixture, resumedDeps);
  expect(resumed.targets[0].state).toBe('complete');
  expect(resumed.targets[0].commit).toBe(journal.commit);
  expect(pushes(resumedDeps)).toBe(0);
  expect(commitCount(root)).toBe(commits);
});

testPosix('re-verifies a previously complete target against a fresh remote observation', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const pushRemote = fixture.remotes.get('hyperclay').push;
  const desktop = makeDesktop();
  const deps = depsFor({ desktop });
  const first = await runUpdater(fixture, deps);
  expect(first.targets[0].state).toBe('complete');
  const originalCommit = first.targets[0].commit;

  const freshDeps = depsFor({ desktop });
  const fresh = await runUpdater(fixture, freshDeps);
  expect(fresh.targets[0].state).toBe('complete');
  expect(fresh.targets[0].commit).toBe(originalCommit);
  expect(fresh.targets[0].verifiedAt).not.toBe(first.targets[0].verifiedAt);
  expect(readJournalFor(fixture, 'hyperclay').remoteObservation.observedAt).toBe(fresh.targets[0].verifiedAt);
  expect(pushes(freshDeps)).toBe(0);

  const divergent = path.join(OWNER, `remote-edit-${++fixtureSeq}`);
  fs.mkdirSync(divergent, { recursive: true });
  git(divergent, ['init', '-q', '-b', 'main']);
  write(divergent, 'other.txt', 'someone else changed the site\n');
  git(divergent, ['add', '-A']);
  git(divergent, ['commit', '-q', '-m', 'unrelated remote change']);
  git(divergent, ['push', '-q', '--force', pushRemote, 'main']);
  const divergedDeps = depsFor({ desktop });
  const diverged = await runUpdater(fixture, divergedDeps);
  expect(diverged.targets[0].state).toBe('conflict');
  expect(diverged.targets[0].commit).toBe(originalCommit);
  expect(diverged.targets[0].verifiedAt).toBeNull();

  fs.renameSync(pushRemote, `${pushRemote}.gone`);
  const unreadableDeps = depsFor({ desktop });
  const unreadable = await runUpdater(fixture, unreadableDeps);
  expect(unreadable.targets[0].state).toBe('pending-push');
  expect(unreadable.targets[0].commit).toBe(originalCommit);
  expect(unreadable.targets[0].verifiedAt).toBeNull();
});

testPosix('stops before target work when the run record or initial result cannot be published', async () => {
  const recordFailure = makeFixture({ repos: ['hyperclay'] });
  const recordDeps = depsFor({ fs: failRenameAt(path.join(recordFailure.runDir, RUN_FILE), 1) });
  await expectCode(runUpdater(recordFailure, recordDeps), 'DOCS_RUN_WRITE_FAILED');
  expect(npmCalls(recordDeps)).toBe(0);
  expect(pushes(recordDeps)).toBe(0);
  expect(fs.existsSync(path.join(recordFailure.runDir, RUN_FILE))).toBe(false);
  expect(fs.existsSync(path.join(recordFailure.runDir, 'attempts'))).toBe(false);
  expect(fs.existsSync(recordFailure.resultFile)).toBe(false);

  const rotation = makeFixture({ repos: ['hyperclay'] });
  const rotationDesktop = makeDesktop();
  const rotationDeps = depsFor({ desktop: rotationDesktop });
  const stale = '88888888-8888-4888-8888-888888888888';
  const rotationHandle = openRun(rotation, rotationDeps);
  rotationHandle.selectAttempt('hyperclay', stale);
  const stalePaths = attemptPaths(rotation.runDir, 'hyperclay', stale);
  fs.mkdirSync(stalePaths.prepareDir, { recursive: true });
  const rotationDeps2 = depsFor({ desktop: rotationDesktop, fs: failRenameAt(path.join(rotation.runDir, RUN_FILE), 1) });
  await expectCode(runUpdater(rotation, rotationDeps2), 'DOCS_RUN_WRITE_FAILED');
  expect(readRun(rotation).targets[0].attemptId).toBe(stale);
  expect(npmCalls(rotationDeps2)).toBe(0);
  expect(fs.existsSync(stalePaths.preparedFile)).toBe(false);

  const resultFailure = makeFixture({ repos: ['hyperclay'] });
  const resultDeps = depsFor({ fs: failRenameAt(resultFailure.resultFile, 1) });
  await expectCode(runUpdater(resultFailure, resultDeps), 'DOCS_RESULT_WRITE_FAILED');
  const durable = readRun(resultFailure);
  expect(durable.targets.map((slot) => slot.attemptId)).toEqual([null, null]);
  expect(durable.targets.map((slot) => slot.journalOperationId)).toEqual([null, null]);
  expect(fs.existsSync(resultFailure.resultFile)).toBe(false);
  expect(fs.existsSync(path.join(resultFailure.runDir, 'attempts'))).toBe(false);
  expect(npmCalls(resultDeps)).toBe(0);
  expect(pushes(resultDeps)).toBe(0);
});

testPosix('stops at journal binding or a result checkpoint before the corresponding mutation', async () => {
  const binding = makeFixture({ repos: ['hyperclay'] });
  const bindingRoot = binding.roots.get('hyperclay');
  const bindingDeps = depsFor({ fs: failRenameAt(path.join(binding.runDir, RUN_FILE), 3) });
  const beforeHead = headOf(bindingRoot);
  await expectCode(runUpdater(binding, bindingDeps), 'DOCS_RUN_WRITE_FAILED');
  expect(pushes(bindingDeps)).toBe(0);
  expect(headOf(bindingRoot)).toBe(beforeHead);
  expect(readJournalFor(binding, 'hyperclay').commit).toBeNull();
  expect(readRun(binding).targets[0].journalOperationId).toBeNull();

  const prePush = makeFixture({ repos: ['hyperclay'] });
  const prePushRoot = prePush.roots.get('hyperclay');
  const prePushDeps = depsFor({ fs: failRenameAt(prePush.resultFile, 3) });
  await expectCode(runUpdater(prePush, prePushDeps), 'DOCS_RESULT_WRITE_FAILED');
  expect(pushes(prePushDeps)).toBe(0);
  const prePushJournal = readJournalFor(prePush, 'hyperclay');
  expect(prePushJournal.commit).not.toBeNull();
  expect(headOf(prePushRoot)).toBe(prePushJournal.commit);

  const final = makeFixture({ repos: ['hyperclay'] });
  const finalDeps = depsFor({ fs: failRenameAt(final.resultFile, 4) });
  await expectCode(runUpdater(final, finalDeps), 'DOCS_RESULT_WRITE_FAILED');
  expect(pushes(finalDeps)).toBe(1);
  const finalJournal = readJournalFor(final, 'hyperclay');
  expect(finalJournal.state).toBe('complete');
  expect(remoteMain(final.remotes.get('hyperclay').push)).toBe(finalJournal.commit);

  const second = makeFixture();
  const secondDeps = depsFor({ fs: failRenameAt(second.resultFile, 3) });
  await expectCode(runUpdater(second, secondDeps), 'DOCS_RESULT_WRITE_FAILED');
  expect(npmCalls(secondDeps)).toBe(0);
  expect(pushes(secondDeps)).toBe(0);
});

testPosix('stops after a parent-directory fsync failure and preserves retained evidence', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const desktop = makeDesktop();
  const deps = depsFor({ desktop, fs: failDirFsync(fixture.runDir, 1) });
  await expectCode(runUpdater(fixture, deps), 'DOCS_RUN_WRITE_FAILED');
  const runFile = path.join(fixture.runDir, RUN_FILE);
  const visible = fs.readFileSync(runFile);
  const retained = JSON.parse(visible.toString());
  expect(retained).toMatchObject({ schema: 1, version: NEW });
  expect(retained.targets.map((slot) => slot.attemptId)).toEqual([null, null]);
  expect(fs.readdirSync(fixture.runDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  expect(openRun(fixture, depsFor({ desktop })).snapshotRun()).toEqual(retained);

  const resumedDeps = depsFor({ desktop });
  const resumed = await runUpdater(fixture, resumedDeps);
  expect(resumed.targets[0].state).toBe('complete');
  expect(readRun(fixture).version).toBe(NEW);
  expect(readRun(fixture).targets[0].attemptId).not.toBeNull();

  const collision = makeFixture({ repos: ['hyperclay'] });
  const firstUuid = '99999999-9999-4999-8999-999999999998';
  const uuid = '99999999-9999-4999-8999-999999999999';
  let uuidSeq = 0;
  const collisionDeps = depsFor({
    randomUUID: () => {
      uuidSeq += 1;
      return uuidSeq === 1 ? firstUuid : uuid;
    }
  });
  fs.mkdirSync(collision.runDir, { recursive: true });
  const colliding = path.join(collision.runDir, `docs-run.${firstUuid}.tmp`);
  fs.writeFileSync(colliding, 'colliding writer bytes\n', { mode: 0o600 });
  const error = await expectCode(runUpdater(collision, collisionDeps), 'DOCS_RUN_WRITE_FAILED');
  expect(error.cause && error.cause.code).toBe('EEXIST');
  expect(fs.readFileSync(colliding, 'utf8')).toBe('colliding writer bytes\n');
  expect(fs.existsSync(path.join(collision.runDir, RUN_FILE))).toBe(false);
  expect(fs.existsSync(collision.resultFile)).toBe(false);
});

testPosix('updater ordering and resume: persists the initial run record for a no-target fixture and reuses it on rerun', async () => {
  const fixture = makeFixture({ repos: [] });
  fs.mkdirSync(fixture.runDir, { recursive: true });
  const retained = path.join(fixture.runDir, 'docs-run.11111111-1111-4111-8111-111111111111.tmp');
  fs.writeFileSync(retained, 'interrupted initial publish bytes\n', { mode: 0o600 });
  const desktop = makeDesktop();
  const firstDeps = depsFor({ desktop });
  const first = await runUpdater(fixture, firstDeps);

  expect(first.targets.map((entry) => entry.state)).toEqual(['missing', 'missing']);
  const runFile = path.join(fixture.runDir, RUN_FILE);
  const persisted = fs.readFileSync(runFile);
  const record = JSON.parse(persisted.toString());
  expect(record.targets.map((slot) => slot.attemptId)).toEqual([null, null]);
  expect(record.targets.map((slot) => slot.journalOperationId)).toEqual([null, null]);
  expect(readResult(fixture)).toEqual(first);
  expect(fs.readFileSync(retained, 'utf8')).toBe('interrupted initial publish bytes\n');
  expect(npmCalls(firstDeps)).toBe(0);

  const secondDeps = depsFor({ desktop });
  const second = await runUpdater(fixture, secondDeps);
  expect(second).toEqual(first);
  expect(fs.readFileSync(runFile)).toEqual(persisted);
  expect(fs.existsSync(path.join(fixture.runDir, 'attempts'))).toBe(false);
  expect(npmCalls(secondDeps)).toBe(0);

  const foreignTemp = makeFixture({ repos: [] });
  fs.mkdirSync(foreignTemp.runDir, { recursive: true });
  const foreign = path.join(foreignTemp.runDir, 'docs-run.json.22222222-2222-4222-8222-222222222222.tmp');
  fs.writeFileSync(foreign, 'foreign temporary bytes\n', { mode: 0o600 });
  await expectCode(runUpdater(foreignTemp, depsFor()), 'DOCS_RUN_INVALID');
  expect(fs.readFileSync(foreign, 'utf8')).toBe('foreign temporary bytes\n');
  expect(fs.existsSync(path.join(foreignTemp.runDir, RUN_FILE))).toBe(false);
});

testPosix('updater ordering and resume: reopens an existing result regular file and refuses symlink or file-as-directory leaves', async () => {
  const reopen = makeFixture({ repos: [] });
  const reopenDeps = depsFor();
  const first = await runUpdater(reopen, reopenDeps);
  expect(fs.statSync(reopen.resultFile).isFile()).toBe(true);
  const reopened = openRun(reopen, reopenDeps);
  expect(reopened.snapshotResult()).toEqual(first);
  expect(reopened.snapshotRun().targets.map((slot) => slot.attemptId)).toEqual([null, null]);

  const symlinkRun = makeFixture({ repos: [] });
  const linkTarget = fs.mkdtempSync(path.join(OWNER, `resume-link-target-${++fixtureSeq}-`));
  const link = path.join(OWNER, `resume-link-${++fixtureSeq}`);
  fs.symlinkSync(linkTarget, link);
  await expectCode(runUpdater(symlinkRun, depsFor(), { runDir: link, resultFile: path.join(link, 'result.json') }), 'DOCS_RUN_INVALID');
  expect(fs.readdirSync(linkTarget)).toEqual([]);

  const symlinkResult = makeFixture({ repos: [] });
  fs.mkdirSync(symlinkResult.runDir, { recursive: true });
  const resultTarget = path.join(OWNER, `resume-result-target-${++fixtureSeq}.json`);
  fs.writeFileSync(resultTarget, '{}\n');
  fs.symlinkSync(resultTarget, symlinkResult.resultFile);
  await expectCode(runUpdater(symlinkResult, depsFor()), 'DOCS_RUN_INVALID');
  expect(fs.readFileSync(resultTarget, 'utf8')).toBe('{}\n');

  const fileFixture = makeFixture({ repos: [] });
  const fileLeaf = path.join(OWNER, `resume-file-leaf-${++fixtureSeq}`);
  fs.writeFileSync(fileLeaf, 'not a directory\n');
  const fileDeps = depsFor();
  const openWith = (options) => (async () => openDocsRun({
    version: NEW,
    parentDir: fileFixture.parentDir,
    runDir: fileFixture.runDir,
    resultFile: fileFixture.resultFile,
    owner: ownerOf(fileDeps.repoRoot),
    ...options
  }, { fs, randomUUID: fileDeps.randomUUID }))();

  await expectCode(openWith({ parentDir: fileLeaf }), 'DOCS_RUN_INVALID');
  await expectCode(openWith({ owner: { ...ownerOf(fileDeps.repoRoot), root: fileLeaf } }), 'DOCS_RUN_INVALID');
  await expectCode(openWith({ runDir: fileLeaf, resultFile: path.join(fileLeaf, 'result.json') }), 'DOCS_RUN_INVALID');
  expect(fs.readFileSync(fileLeaf, 'utf8')).toBe('not a directory\n');
  expect(fs.existsSync(fileFixture.runDir)).toBe(false);
});

testPosix('updater ordering and resume: initial run-record write failure creates no result and starts no preparation', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  const beforeHead = headOf(root);
  const deps = depsFor({ fs: failRenameAt(path.join(fixture.runDir, RUN_FILE), 1) });
  await expectCode(runUpdater(fixture, deps), 'DOCS_RUN_WRITE_FAILED');
  expect(fs.existsSync(path.join(fixture.runDir, RUN_FILE))).toBe(false);
  expect(fs.existsSync(fixture.resultFile)).toBe(false);
  expect(fs.existsSync(path.join(fixture.runDir, 'attempts'))).toBe(false);
  expect(fs.readdirSync(fixture.runDir)).toEqual([]);
  expect(npmCalls(deps)).toBe(0);
  expect(pushes(deps)).toBe(0);
  expect(archiveCalls(deps, root)).toBe(0);
  expect(headOf(root)).toBe(beforeHead);
});

testPosix('updater ordering and resume: awaits a delayed lock-backed journal operation before the next operation and checkpoints results in order', async () => {
  const fixture = makeFixture({ repos: ['hyperclay'] });
  const root = fixture.roots.get('hyperclay');
  let openGate;
  const gate = new Promise((resolve) => { openGate = resolve; });
  let signalGate;
  const reachedGate = new Promise((resolve) => { signalGate = resolve; });
  let ferryCalls = 0;
  let reconcileClosed = false;
  let finished = false;
  let finishedError = null;
  const checkpoints = [];
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  const deps = depsFor({
    withFerryRepoLock: async (lockRoot, callback) => {
      ferryCalls += 1;
      if (ferryCalls === 2) {
        signalGate();
        await gate;
        try {
          return await callback();
        } finally {
          reconcileClosed = true;
        }
      }
      return callback();
    },
    fs: hookFs((prop, args, next) => {
      const value = next();
      if (prop === 'renameSync' && args[1] === fixture.resultFile) {
        checkpoints.push({
          result: JSON.parse(fs.readFileSync(fixture.resultFile, 'utf8')),
          reconcileClosed
        });
      }
      return value;
    })
  });
  try {
    const pending = runUpdater(fixture, deps);
    const settled = pending.then(
      () => { finished = true; },
      (error) => { finished = true; finishedError = error; }
    );
    await Promise.race([reachedGate, settled]);
    if (finished) throw finishedError || new Error('the updater finished without reaching the deferred reconcile operation');
    expect(ferryCalls).toBe(2);
    expect(reconcileClosed).toBe(false);
    expect(pushes(deps)).toBe(0);
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0].result.targets[0].state).toBe('pending');
    expect(checkpoints[1].result.targets[0].state).toBe('failed');
    expect(checkpoints[1].result.targets[0].commit).toBeNull();
    expect(readRun(fixture).targets[0].journalOperationId).not.toBeNull();
    expect(readJournalFor(fixture, 'hyperclay').commit).toBeNull();

    openGate();
    const result = await pending;
    expect(result.targets[0].state).toBe('complete');
    expect(pushes(deps)).toBe(1);
    expect(ferryCalls).toBe(2);
    expect(checkpoints.map((entry) => entry.result.targets.map((target) => target.state))).toEqual([
      ['pending', 'pending'],
      ['failed', 'pending'],
      ['pending-push', 'pending'],
      ['complete', 'pending'],
      ['complete', 'missing']
    ]);
    expect(checkpoints.map((entry) => entry.reconcileClosed)).toEqual([false, false, true, true, true]);
    expect(checkpoints[3].result.targets[0].commit).toBe(headOf(root));
    expect(remoteMain(fixture.remotes.get('hyperclay').push)).toBe(headOf(root));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  expect(unhandled).toEqual([]);
});

testPosix('composes with the release lock and refuses a busy docs lock without touching bytes', async () => {
  const free = makeFixture({ repos: [] });
  const freeDeps = depsFor();
  const identity = resolveRepoIdentity(freeDeps.repoRoot, { readGit });
  await withReleaseLock(identity, async () => {
    const result = await runUpdater(free, freeDeps);
    expect(result.targets.map((entry) => entry.state)).toEqual(['missing', 'missing']);
  }, { cacheRoot: freeDeps.cacheRoot });

  const busy = makeFixture({ repos: [] });
  const busyDeps = depsFor();
  const busyIdentity = resolveRepoIdentity(busyDeps.repoRoot, { readGit });
  let release;
  const held = withDocsLock(busyIdentity, () => new Promise((resolve) => { release = resolve; }), { cacheRoot: busyDeps.cacheRoot });
  await expectCode(runUpdater(busy, busyDeps), 'DOCS_LOCK_BUSY');
  expect(fs.existsSync(busy.runDir)).toBe(false);
  expect(fs.existsSync(busy.resultFile)).toBe(false);
  release();
  await held;

  const sibling = makeFixture();
  const siblingDeps = depsFor();
  const websiteIdentity = siblingLockIdentity(sibling.roots.get('hyperclay-website'));
  let releaseSibling;
  const heldSibling = withDocsLock(websiteIdentity, () => new Promise((resolve) => { releaseSibling = resolve; }), { cacheRoot: siblingDeps.cacheRoot });
  const siblingResult = await runUpdater(sibling, siblingDeps);
  releaseSibling();
  await heldSibling;
  expect(siblingResult.targets[0].state).toBe('complete');
  expect(siblingResult.targets[1].state).toBe('conflict');
  expect(siblingResult.targets[1].reason.code).toBe('DOCS_LOCK_BUSY');
});

testPosix('rejects conflicting run records, unowned paths and a nested desktop identity', async () => {
  const version = makeFixture({ repos: [] });
  const versionDeps = depsFor();
  openRun(version, versionDeps).selectAttempt('hyperclay', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await expectCode(runUpdater(version, versionDeps, { version: OLD }), 'DOCS_RUN_CONFLICT');
  expect(npmCalls(versionDeps)).toBe(0);
  expect(fs.existsSync(path.join(version.runDir, 'attempts'))).toBe(false);

  const parent = makeFixture({ repos: [] });
  const parentDeps = depsFor();
  openRun(parent, parentDeps).selectAttempt('hyperclay', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  await expectCode(runUpdater(parent, parentDeps, { parentDir: emptyParent() }), 'DOCS_RUN_CONFLICT');

  const owner = makeFixture({ repos: [] });
  const ownerDeps = depsFor();
  openRun(owner, ownerDeps).selectAttempt('hyperclay', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const otherDeps = depsFor({ desktop: makeDesktop() });
  await expectCode(runUpdater(owner, otherDeps), 'DOCS_RUN_CONFLICT');

  const result = makeFixture({ repos: [] });
  const resultDeps = depsFor();
  openRun(result, resultDeps).selectAttempt('hyperclay', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  await expectCode(runUpdater(result, resultDeps, { resultFile: path.join(result.runDir, 'other.json') }), 'DOCS_RUN_CONFLICT');

  const symlinkRun = makeFixture({ repos: [] });
  const symlinkRunDeps = depsFor();
  const linkTarget = fs.mkdtempSync(path.join(OWNER, 'link-target-'));
  const link = path.join(OWNER, `link-${++fixtureSeq}`);
  fs.symlinkSync(linkTarget, link);
  await expectCode(runUpdater(symlinkRun, symlinkRunDeps, { runDir: link, resultFile: path.join(link, 'result.json') }), 'DOCS_RUN_INVALID');

  const symlinkResult = makeFixture({ repos: [] });
  const symlinkResultDeps = depsFor();
  fs.mkdirSync(symlinkResult.runDir, { recursive: true });
  const resultTarget = path.join(OWNER, `result-target-${++fixtureSeq}.json`);
  fs.writeFileSync(resultTarget, '{}\n');
  fs.symlinkSync(resultTarget, symlinkResult.resultFile);
  await expectCode(runUpdater(symlinkResult, symlinkResultDeps), 'DOCS_RUN_INVALID');

  const foreign = makeFixture({ repos: [] });
  const foreignDeps = depsFor();
  fs.mkdirSync(foreign.runDir, { recursive: true });
  fs.writeFileSync(path.join(foreign.runDir, 'foreign.txt'), 'not ours\n');
  await expectCode(runUpdater(foreign, foreignDeps), 'DOCS_RUN_INVALID');

  const evidenceLink = makeFixture({ repos: ['hyperclay'] });
  const evidenceDeps = depsFor();
  const evidenceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  openRun(evidenceLink, evidenceDeps).selectAttempt('hyperclay', evidenceId);
  const evidencePaths = attemptPaths(evidenceLink.runDir, 'hyperclay', evidenceId);
  const evidenceTarget = fs.mkdtempSync(path.join(OWNER, 'evidence-target-'));
  fs.mkdirSync(evidencePaths.root, { recursive: true });
  fs.symlinkSync(evidenceTarget, evidencePaths.prepareDir);
  const evidenceResult = await runUpdater(evidenceLink, evidenceDeps);
  expect(evidenceResult.targets[0].state).toBe('failed');
  expect(npmCalls(evidenceDeps)).toBe(0);
  expect(treeSnapshot(evidenceTarget)).toEqual([]);

  const nested = makeFixture({ repos: ['hyperclay'] });
  const nestedRoot = nested.roots.get('hyperclay');
  git(nestedRoot, ['remote', 'set-url', 'origin', 'https://github.com/hyperclay-fixture/hyperclay.git']);
  git(nestedRoot, ['remote', 'set-url', '--push', 'origin', 'https://github.com/hyperclay-fixture/hyperclay.git']);
  const nestedDeps = depsFor({ desktop: nestedRoot });
  await expectCode(runUpdater(nested, nestedDeps), 'DOCS_RUN_CONFLICT');
  expect(npmCalls(nestedDeps)).toBe(0);
});

testPosix('classifies untyped preparation diagnostics and typed conflicts without message matching', async () => {
  const prep = makeFixture({ repos: ['hyperclay'] });
  const prepRoot = prep.roots.get('hyperclay');
  const prepDeps = depsFor({
    hook: (command, args, opts) => {
      if (command === 'git' && opts.cwd === prepRoot && args[0] === 'rev-parse') {
        throw new Error('injected conflict-looking preparation diagnostic');
      }
      return undefined;
    }
  });
  const prepResult = await runUpdater(prep, prepDeps);
  expect(prepResult.targets[0].state).toBe('failed');
  expect(prepResult.targets[0].reason.code).toBe('DOCS_PREPARE_FAILED');
  expect(prepResult.targets[0].reason.message).toBe('injected conflict-looking preparation diagnostic');

  const plan = makeFixture({ repos: ['hyperclay'] });
  const planRoot = plan.roots.get('hyperclay');
  let mutated = false;
  const planDeps = depsFor({
    fs: hookFs((prop, args, next) => {
      if (!mutated && prop === 'readFileSync' && path.basename(String(args[0])) === 'prepared.json') {
        mutated = true;
        fs.appendFileSync(path.join(planRoot, EDGE_PATH), '\nlocal edit during planning\n');
      }
      return next();
    })
  });
  const planResult = await runUpdater(plan, planDeps);
  expect(planResult.targets[0].state).toBe('conflict');
  expect(planResult.targets[0].reason.code).toBe('DOCS_PREIMAGE_CONFLICT');

  const apply = makeFixture({ repos: ['hyperclay'] });
  const applyRoot = apply.roots.get('hyperclay');
  let applyMutated = false;
  const applyDeps = depsFor({
    hook: (command, args, opts) => {
      if (!applyMutated && command === 'git' && opts.cwd === applyRoot && args[0] === 'commit-tree') {
        applyMutated = true;
        fs.appendFileSync(path.join(applyRoot, EDGE_PATH), '\nlocal edit during apply\n');
      }
      return undefined;
    }
  });
  const applyResult = await runUpdater(apply, applyDeps);
  expect(applyResult.targets[0].state).toBe('conflict');
  expect(applyResult.targets[0].reason.code).toBe('DOCS_PREIMAGE_CONFLICT');
});

testPosix('stops globally on a nested journal-write failure or lock-cleanup failure', async () => {
  const journal = makeFixture();
  const journalDeps = depsFor({
    fs: hookFs((prop, args, next) => {
      if (prop === 'renameSync' && path.basename(String(args[1])) === 'target.json') {
        throw new Error('injected journal publication failure');
      }
      return next();
    })
  });
  await expectCode(runUpdater(journal, journalDeps), 'DOCS_JOURNAL_WRITE_FAILED');
  expect(npmCalls(journalDeps)).toBe(0);
  expect(pushes(journalDeps)).toBe(0);

  const cleanup = makeFixture({ repos: ['hyperclay'] });
  const cleanupRoot = cleanup.roots.get('hyperclay');
  const cleanupDeps = depsFor();
  const cleanupIdentity = siblingLockIdentity(cleanupRoot);
  const siblingLockDir = path.join(cleanupDeps.cacheRoot, 'locks', 'docs', `${cleanupIdentity.key}.lock`);
  const originalRmdir = fs.rmdirSync;
  fs.rmdirSync = (target, ...rest) => {
    if (target === siblingLockDir) throw new Error('injected lock cleanup failure');
    return originalRmdir.call(fs, target, ...rest);
  };
  try {
    await expectCode(runUpdater(cleanup, cleanupDeps), 'DOCS_LOCK_IO_FAILED');
    expect(npmCalls(cleanupDeps)).toBe(0);
    expect(pushes(cleanupDeps)).toBe(0);
  } finally {
    fs.rmdirSync = originalRmdir;
  }
});

testPosix('parses CLI options, falls back to the package version and exits nonzero for incomplete targets', async () => {
  const desktop = makeDesktop({ withModules: true });
  const home = fs.mkdtempSync(path.join(OWNER, 'cli-home-'));
  const parent = emptyParent();
  const runDir = path.join(OWNER, `cli-run-${++runSeq}`);
  const resultFile = path.join(runDir, 'result.json');
  const fallback = runCli(desktop, ['--parent-dir', parent, '--run-dir', runDir, '--result', resultFile], home);
  expect(fallback.status).toBe(1);
  expect(fallback.stderr).toBe('');
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  expect(result.version).toBe(NEW);
  expect(result.targets.map((entry) => entry.state)).toEqual(['missing', 'missing']);

  const positionalRun = path.join(OWNER, `cli-run-${++runSeq}`);
  const positionalResult = path.join(positionalRun, 'result.json');
  const explicit = runCli(desktop, ['9.9.9', '--parent-dir', parent, '--run-dir', positionalRun, '--result', positionalResult], home);
  expect(explicit.status).toBe(1);
  expect(explicit.stderr).toBe('');
  expect(JSON.parse(fs.readFileSync(positionalResult, 'utf8')).version).toBe('9.9.9');

  expect(runCli(desktop, ['--bogus'], home).stderr).toContain('Unknown option --bogus');
  expect(runCli(desktop, ['--run-dir', '/tmp/a', '--run-dir', '/tmp/b'], home).stderr).toContain('Duplicate option --run-dir');
  expect(runCli(desktop, ['--result'], home).stderr).toContain('needs an absolute value');
  expect(runCli(desktop, ['1.2.3', 'extra'], home).stderr).toContain('Unexpected extra argument extra');

  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'update-external-docs.js'), 'utf8');
  expect(source).not.toMatch(/stashRepo|commitAndPushFile|popStash/);
  expect(source).not.toMatch(/'stash'/);
  expect(source).not.toMatch(/git add -A|add', '-A'/);
});
