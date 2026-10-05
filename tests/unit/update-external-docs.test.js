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
    for (const name of [
      'release-command.js', 'release-docs-apply.js', 'release-docs-plan.js', 'release-docs-prepare.js',
      'release-docs-run.js', 'release-ferry.js', 'release-lock.js', 'release-state.js',
      'update-external-docs.js'
    ]) {
      fs.copyFileSync(path.join(__dirname, '..', '..', 'scripts', name), path.join(scripts, name));
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
