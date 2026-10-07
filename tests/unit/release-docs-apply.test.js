// One verified documentation application is applied to a real scratch checkout and
// committed under the updater lock and an injected Ferry repo lock. Every fixture is
// its own local repository under one owned temp root with an isolated HOME/config and
// hooks disabled, so no sibling checkout, remote, browser or release is touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const { updateVersionInContent } = require('../../scripts/update-external-docs');
const {
  prepareCommitIntent, applyPreparedTarget, reconcileTarget, readTargetJournal
} = require('../../scripts/release-docs-apply');
const { execFileCaptured } = require('../../scripts/release-command');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const MESSAGE = `chore: update Hyperclay Local download links to v${NEW}`;
const JOURNAL_FIELDS = [
  'schema', 'operationId', 'version', 'repo', 'repoRoot', 'repoKey', 'remote', 'remoteRef', 'pushUrlSha256',
  'applicationFile', 'applicationSha256', 'preparedFile', 'preparedSha256', 'paths', 'requiredPaths', 'beforeHead',
  'beforeIndexFingerprint', 'expectedTree', 'expectedIndexFingerprint', 'candidateCommit', 'commit', 'phase', 'state',
  'reason', 'remoteObservation', 'updatedAt'
];
const FIXED_UUID = '11111111-2222-4333-8444-555555555555';
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-docs-apply-'));
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

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_NAME = '15 Hyperclay Local App.md';
const VAULT_PATH = `vault/DOCS/${VAULT_NAME}`;
const LLMS_PATH = 'public/llms.txt';

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

function addOrigin(repoRoot, name) {
  git(repoRoot, ['remote', 'add', 'origin', `https://fetch.invalid/${name}.git`]);
  git(repoRoot, ['remote', 'set-url', '--push', 'origin', `https://push.invalid/${name}.git`]);
}

function makeFixture({ docsVersion = OLD } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const hyperclay = path.join(parentDir, 'hyperclay');
  const website = path.join(parentDir, 'hyperclay-website');

  fs.mkdirSync(hyperclay, { recursive: true });
  git(hyperclay, ['init', '-q', '-b', 'main']);
  addOrigin(hyperclay, 'hyperclay');
  write(hyperclay, 'README.md', 'hyperclay readme\n');
  write(hyperclay, 'src/app.js', 'module.exports = {};\n');
  write(hyperclay, EDGE_PATH, edgeBody(docsVersion));
  git(hyperclay, ['add', '-A']);
  git(hyperclay, ['commit', '-q', '-m', 'fixture']);

  fs.mkdirSync(website, { recursive: true });
  git(website, ['init', '-q', '-b', 'main']);
  addOrigin(website, 'hyperclay-website');
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

  return {
    parentDir,
    hyperclay,
    website,
    runDir: path.join(RUNS, `run-${++runSeq}`),
    outDir: path.join(OUTS, `out-${++outSeq}`)
  };
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
  return (command, args, options = {}) => execFileCaptured(command, args, {
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

function repoRootOf(fixture, repo) {
  return repo === 'hyperclay' ? fixture.hyperclay : fixture.website;
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
  const calls = [];
  const run = (command, args, opts = {}) => {
    calls.push([command, ...args]);
    const result = execFileCaptured(command, args, { ...opts, env: { ...GIT_ENV, ...(opts.env || {}) } });
    if (options.hook) options.hook(command, args, opts);
    return result;
  };
  run.calls = calls;
  return {
    run,
    fs: options.fs,
    now: options.now,
    randomUUID: options.randomUUID,
    cacheRoot: options.cacheRoot || newCache(),
    assertPublishWindow: options.assertPublishWindow || (() => {}),
    withFerryRepoLock: options.withFerryRepoLock || (async (root, callback) => callback())
  };
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
    reflog: fs.existsSync(reflog) ? sha256(fs.readFileSync(reflog)) : null,
    worktree: git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
      .map((name) => `${name}:${sha256(fs.readFileSync(path.join(repoRoot, name)))}`)
  };
}

function directoryInventory(root) {
  return fs.readdirSync(root).sort().map((name) => {
    const abs = path.join(root, name);
    const stat = fs.lstatSync(abs);
    return stat.isDirectory() ? `${name}/` : `${name}:${sha256(fs.readFileSync(abs))}`;
  });
}

function treeEntryOf(repoRoot, treeish, rel) {
  const line = git(repoRoot, ['ls-tree', '-z', treeish, '--', rel]).split('\0').filter(Boolean)[0];
  const tab = line.indexOf('\t');
  const [mode, type, oid] = line.slice(0, tab).split(' ');
  return { mode, type, oid };
}

function readJournal(journalFile) {
  return JSON.parse(fs.readFileSync(journalFile, 'utf8'));
}

function rewriteJournal(journalFile, patch) {
  const payload = `${JSON.stringify({ ...readJournal(journalFile), ...patch }, null, 2)}\n`;
  fs.writeFileSync(journalFile, payload);
  return payload;
}

function applyPatchByHand(repoRoot, patchFile) {
  git(repoRoot, ['apply', '--check', '--index', '-p1', patchFile]);
  git(repoRoot, ['apply', '--index', '-p1', patchFile]);
}

function commitByHand(repoRoot, tree, parent, message, extraEnv = {}) {
  return git(repoRoot, ['commit-tree', tree, '-p', parent, '-m', message], { env: extraEnv }).trim();
}

function moveMain(repoRoot, next, previous) {
  git(repoRoot, ['update-ref', '--no-deref', '-m', 'fixture move', 'refs/heads/main', next, previous]);
}

function fastForwardChain(repoRoot, count) {
  const base = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const lines = [];
  for (let index = 1; index <= count; index += 1) {
    lines.push('commit refs/heads/main');
    lines.push(`mark :${index}`);
    lines.push(`committer Fixture <fixture@example.com> ${1700000000 + index} +0000`);
    const message = Buffer.from(`filler ${index}`, 'utf8');
    lines.push(`data ${message.length}`);
    lines.push(message.toString('utf8'));
    lines.push(`from ${index === 1 ? base : `:${index - 1}`}`);
    lines.push('');
  }
  lines.push('done');
  childProcess.execFileSync('git', ['fast-import', '--quiet', '--done'], {
    cwd: repoRoot,
    env: GIT_ENV,
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8'
  });
  return git(repoRoot, ['rev-parse', 'HEAD']).trim();
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

function prepare(record, deps) {
  return prepareCommitIntent({
    applicationFile: record.applicationFile,
    journalFile: journalFileFor(record),
    message: MESSAGE
  }, deps);
}

function docsLockDir(cacheRoot, repoRoot) {
  const commonDir = fs.realpathSync(path.join(repoRoot, '.git'));
  return path.join(cacheRoot, 'locks/docs', `${sha256(commonDir)}.lock`);
}

function freshTarget(fixture, repo) {
  const record = planTarget(fixture, repo, NEW);
  return { record, journalFile: journalFileFor(record) };
}

describe('release docs apply', () => {
  testPosix('prepares and applies the exact expected tree for both docs targets', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const deps = depsFor({});

    for (const repo of ['hyperclay', 'hyperclay-website']) {
      const repoRoot = repoRootOf(fixture, repo);
      const record = planTarget(fixture, repo, NEW);
      const journalFile = journalFileFor(record);
      const before = liveSnapshot(repoRoot);
      const beforeCommits = commitCount(repoRoot);
      expect(beforeCommits).toBeGreaterThan(0);
      expect(record.paths.length).toBeGreaterThan(0);

      const prepared = await prepareCommitIntent({
        applicationFile: record.applicationFile,
        journalFile,
        message: MESSAGE
      }, deps);

      expect(prepared.commit).toBeNull();
      expect(prepared.phase).toBe('apply-intent');
      expect(prepared.state).toBe('failed');
      expect(prepared.reason.code).toBe('APPLY_NOT_FINISHED');
      expect(prepared.candidateCommit).toMatch(OID_PATTERN);
      expect(prepared.candidateCommit).not.toBe(record.beforeHead);
      expect(prepared.applicationSha256).toBe(sha256(fs.readFileSync(record.applicationFile)));
      expect(liveSnapshot(repoRoot)).toEqual(before);
      expect(commitCount(repoRoot)).toBe(beforeCommits);
      expect(git(repoRoot, ['rev-parse', `${prepared.candidateCommit}^{tree}`]).trim()).toBe(record.expectedTree);

      const result = await applyPreparedTarget({ journalFile }, deps);

      expect(result.commit).toBe(prepared.candidateCommit);
      expect(result.phase).toBe('committed');
      expect(result.state).toBe('pending-push');
      expect(result.reason).toBeNull();
      expect(result.journalFile).toBe(journalFile);
      expect(commitCount(repoRoot)).toBe(beforeCommits + 1);
      expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(result.commit);
      expect(git(repoRoot, ['rev-parse', `${result.commit}^{tree}`]).trim()).toBe(record.expectedTree);
      expect(git(repoRoot, ['status', '--porcelain=v1', '-z'])).toBe('');
      for (const file of record.files) {
        expect(sha256(fs.readFileSync(path.join(repoRoot, file.path)))).toBe(file.afterSha256);
      }

      const onDisk = readJournal(journalFile);
      expect(Object.keys(onDisk).sort()).toEqual(JOURNAL_FIELDS.slice().sort());
      expect(onDisk).not.toHaveProperty('journalFile');
      expect(onDisk.commit).toBe(result.commit);
      expect(onDisk.phase).toBe('committed');
      expect(onDisk.state).toBe('pending-push');
      expect(onDisk.reason).toBeNull();
      expect(sha256(fs.readFileSync(record.applicationFile))).toBe(onDisk.applicationSha256);
      expect(fs.existsSync(path.join(path.dirname(journalFile), 'target.json.tmp'))).toBe(false);
    }

    expect(deps.run.calls.filter((call) => ['push', 'ls-remote', 'fetch'].includes(call[1]))).toEqual([]);
  });

  testPosix('keeps an unrelated unstaged edit and commits only the required paths', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});

    write(repoRoot, 'README.md', 'unrelated work in progress\n');
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
    const result = await applyPreparedTarget({ journalFile }, deps);

    expect(result.state).toBe('pending-push');
    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe('unrelated work in progress\n');
    const changed = git(repoRoot, ['diff', '--name-only', '-z', record.beforeHead, result.commit]).split('\0').filter(Boolean).sort();
    expect(changed).toEqual(record.paths.slice().sort());
  });

  testPosix('refuses an unrelated staged change before the first apply and mutates nothing', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    write(repoRoot, 'README.md', 'staged unrelated work\n');
    git(repoRoot, ['add', 'README.md']);
    const before = liveSnapshot(repoRoot);

    expect((fs.statSync(journalFile).mode & 0o777).toString(8)).toBe('600');

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(error.journalFile).toBe(journalFile);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
    expect(readJournal(journalFile).phase).toBe('conflict');
    expect(readJournal(journalFile).state).toBe('conflict');
    expect(readJournal(journalFile).commit).toBeNull();
  });

  testPosix('refuses a dirty before state before writing any journal', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);

    write(repoRoot, EDGE_PATH, `${edgeBody(OLD)}edited after preparation\n`);

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({})));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(before.head);
    expect(sha256(git(repoRoot, ['ls-files', '--stage', '-z']))).toBe(before.indexFingerprint);
  });

  testPosix('rejects an existing journal and a missing time policy', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    const existing = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({})));
    expect(existing.code).toBe('DOCS_JOURNAL_INVALID');

    const foreign = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile: path.join(path.dirname(record.applicationFile), 'other.json'),
      message: MESSAGE
    }, deps));
    expect(foreign.code).toBe('DOCS_JOURNAL_INVALID');

    const emptyMessage = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: ''
    }, deps));
    expect(emptyMessage.code).toBe('DOCS_APPLY_DEPS_INVALID');
  });

  testPosix('recovers an apply that finished before the journal advanced', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const beforeCommits = commitCount(repoRoot);

    applyPatchByHand(repoRoot, record.patchFile);
    expect(readJournal(journalFile).phase).toBe('apply-intent');

    const result = await applyPreparedTarget({ journalFile }, deps);
    expect(result.commit).toBe(prepared.candidateCommit);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(commitCount(repoRoot)).toBe(beforeCommits + 1);
    expect(deps.run.calls.filter((call) => call[1] === 'apply')).toEqual([]);
  });

  testPosix('recovers a ref update that finished before the journal advanced', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const beforeCommits = commitCount(repoRoot);

    applyPatchByHand(repoRoot, record.patchFile);
    moveMain(repoRoot, prepared.candidateCommit, record.beforeHead);

    const result = await reconcileTarget({ journalFile }, deps);
    expect(result.commit).toBe(prepared.candidateCommit);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(commitCount(repoRoot)).toBe(beforeCommits + 1);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
  });

  testPosix('adopts the candidate under an unrelated committed descendant', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const beforeCommits = commitCount(repoRoot);

    applyPatchByHand(repoRoot, record.patchFile);
    moveMain(repoRoot, prepared.candidateCommit, record.beforeHead);
    write(repoRoot, 'README.md', 'unrelated later commit\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated later commit']);
    const laterHead = git(repoRoot, ['rev-parse', 'HEAD']).trim();

    const result = await reconcileTarget({ journalFile }, deps);
    expect(result.commit).toBe(prepared.candidateCommit);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(laterHead);
    expect(commitCount(repoRoot)).toBe(beforeCommits + 2);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
  });

  testPosix('adopts a different commit that carries exactly the expected tree', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const beforeCommits = commitCount(repoRoot);

    applyPatchByHand(repoRoot, record.patchFile);
    const equivalent = commitByHand(repoRoot, record.expectedTree, record.beforeHead, 'ferry committed the same tree', {
      GIT_AUTHOR_DATE: '2021-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2021-01-01T00:00:00Z'
    });
    expect(equivalent).not.toBe(prepared.candidateCommit);
    moveMain(repoRoot, equivalent, record.beforeHead);

    const result = await reconcileTarget({ journalFile }, deps);
    expect(result.commit).toBe(equivalent);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(commitCount(repoRoot)).toBe(beforeCommits + 1);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
  });

  testPosix('reports a conflict for a different commit with extra changes', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    applyPatchByHand(repoRoot, record.patchFile);
    write(repoRoot, 'README.md', 'extra change in the same commit\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'docs plus extra']);
    const before = liveSnapshot(repoRoot);

    const error = await refusal(reconcileTarget({ journalFile }, deps));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(error.journal.commit).toBeNull();
    expect(liveSnapshot(repoRoot)).toEqual(before);
    const journal = readJournal(journalFile);
    expect(journal.phase).toBe('conflict');
    expect(journal.state).toBe('conflict');
    expect(journal.commit).toBeNull();
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
  });

  testPosix('keeps a selected edit that raced the apply out of the branch', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({
      hook: (command, args) => {
        if (command === 'git' && args[0] === 'apply' && args[1] === '--index') {
          write(repoRoot, EDGE_PATH, 'editor bytes during the apply\n');
        }
      }
    });
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(record.beforeHead);
    expect(sha256(git(repoRoot, ['ls-files', '--stage', '-z']))).toBe(record.expectedIndexFingerprint);
    expect(fs.readFileSync(path.join(repoRoot, EDGE_PATH), 'utf8')).toBe('editor bytes during the apply\n');
    expect(deps.run.calls.filter((call) => call[1] === 'update-ref')).toEqual([]);
    expect(readJournal(journalFile).phase).toBe('conflict');
  });

  testPosix('retains the real commit when an editor races the ref update', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({
      hook: (command, args) => {
        if (command === 'git' && args[0] === 'update-ref') {
          write(repoRoot, EDGE_PATH, 'editor bytes after the ref update\n');
        }
      }
    });
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(error.journal.commit).toBe(prepared.candidateCommit);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(prepared.candidateCommit);
    expect(fs.readFileSync(path.join(repoRoot, EDGE_PATH), 'utf8')).toBe('editor bytes after the ref update\n');
    const committed = treeEntryOf(repoRoot, prepared.candidateCommit, EDGE_PATH);
    const afterFile = record.files.find((file) => file.path === EDGE_PATH);
    expect(sha256(git(repoRoot, ['cat-file', 'blob', committed.oid], { encoding: 'buffer' }))).toBe(afterFile.afterSha256);
    const journal = readJournal(journalFile);
    expect(journal.commit).toBe(prepared.candidateCommit);
    expect(journal.phase).toBe('committed');
    expect(journal.state).toBe('conflict');
  });

  testPosix('refreshes restored selected preimage metadata without staging unrelated edits', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});

    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const candidateCommit = prepared.candidateCommit;
    const requiredPaths = record.requiredPaths.slice();
    const selected = record.files.find((file) => file.path === EDGE_PATH);
    const preimage = fs.readFileSync(path.join(repoRoot, EDGE_PATH));

    write(repoRoot, EDGE_PATH, `${preimage.toString('utf8')}editor edit restored below\n`);
    fs.writeFileSync(path.join(repoRoot, EDGE_PATH), preimage);
    write(repoRoot, 'README.md', 'unrelated editor README during the refresh\n');

    const past = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(repoRoot, EDGE_PATH), past, past);
    const future = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(repoRoot, '.git', 'index'), future, future);

    const staged = git(repoRoot, ['ls-files', '--stage', '-z', '--', EDGE_PATH]).split('\0').filter(Boolean)[0];
    expect(staged.split(' ')[1]).toBe(git(repoRoot, ['rev-parse', `${record.beforeHead}:${EDGE_PATH}`]).trim());
    expect(sha256(git(repoRoot, ['ls-files', '--stage', '-z']))).toBe(record.beforeIndexFingerprint);
    expect(sha256(fs.readFileSync(path.join(repoRoot, EDGE_PATH)))).toBe(selected.beforeSha256);

    let staleStat = null;
    try {
      git(repoRoot, ['apply', '--check', '--index', '-p1', record.patchFile]);
    } catch (error) {
      staleStat = error;
    }
    expect(staleStat).not.toBeNull();
    expect(staleStat.stderr).toMatch(/does not match index/);

    const result = await applyPreparedTarget({ journalFile }, deps);

    expect(result.candidateCommit).toBe(candidateCommit);
    expect(result.commit).toBe(candidateCommit);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(result.reason).toBeNull();
    expect(git(repoRoot, ['rev-parse', `${result.commit}^{tree}`]).trim()).toBe(record.expectedTree);
    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe('unrelated editor README during the refresh\n');
    const changed = git(repoRoot, ['diff', '--name-only', '-z', record.beforeHead, result.commit]).split('\0').filter(Boolean).sort();
    expect(changed).toEqual(record.paths.slice().sort());
    const refreshes = deps.run.calls.filter((call) => call[0] === 'git' && call[1] === 'add' && call[2] === '--refresh');
    expect(refreshes).toEqual([['git', 'add', '--refresh', '--', ...requiredPaths]]);
  });

  testPosix('keeps editor bytes that race the metadata refresh out of the index', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    const original = deps.run;
    const calls = original.calls;
    const editorBytes = 'editor bytes racing the metadata refresh\n';
    const run = (command, args, opts = {}) => {
      if (command === 'git' && args[0] === 'add' && args[1] === '--refresh') {
        write(repoRoot, EDGE_PATH, editorBytes);
      }
      return original(command, args, opts);
    };
    run.calls = calls;
    deps.run = run;

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));

    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(record.beforeHead);
    expect(fs.readFileSync(path.join(repoRoot, EDGE_PATH), 'utf8')).toBe(editorBytes);
    expect(sha256(git(repoRoot, ['ls-files', '--stage', '-z']))).toBe(record.beforeIndexFingerprint);
    expect(calls.filter((call) => call[1] === 'update-ref')).toEqual([]);
    const journal = readJournal(journalFile);
    expect(journal.phase).toBe('conflict');
    expect(journal.state).toBe('conflict');
    expect(journal.commit).toBeNull();
  });

  testPosix('adopts an older unpushed docs boundary under unrelated commits', async () => {
    const fixture = makeFixture({ docsVersion: OLD });
    const repoRoot = fixture.hyperclay;
    write(repoRoot, EDGE_PATH, updateVersionInContent(edgeBody(OLD), OLD, NEW).updated);
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'docs to 1.29.0']);
    const docsCommit = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    write(repoRoot, 'README.md', 'unrelated one\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated one']);
    write(repoRoot, 'src/app.js', 'module.exports = { one: 1 };\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated two']);
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    expect(beforeCommits).toBeGreaterThan(2);
    expect(record.paths).toEqual([]);
    expect(record.patchSha256).toBe(sha256(Buffer.alloc(0)));

    const result = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({}));

    expect(result.candidateCommit).toBeNull();
    expect(result.commit).toBe(docsCommit);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(result.reason).toBeNull();
    expect(commitCount(repoRoot)).toBe(beforeCommits);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(treeEntryOf(repoRoot, docsCommit, EDGE_PATH).oid)
      .toBe(treeEntryOf(repoRoot, record.expectedTree, EDGE_PATH).oid);
  });

  testPosix('adopts the root commit as the documentation boundary', async () => {
    const fixture = makeFixture({ docsVersion: NEW });
    const repoRoot = fixture.hyperclay;
    write(repoRoot, 'README.md', 'unrelated after the docs\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated']);
    const root = git(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']).trim();
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const beforeCommits = commitCount(repoRoot);

    const result = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile: journalFileFor(record),
      message: MESSAGE
    }, depsFor({}));

    expect(record.paths).toEqual([]);
    expect(result.commit).toBe(root);
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('refuses to guess a documentation boundary beyond the history limit', async () => {
    const fixture = makeFixture({ docsVersion: NEW });
    const repoRoot = fixture.hyperclay;
    fastForwardChain(repoRoot, 1200);
    expect(Number(git(repoRoot, ['rev-list', '--first-parent', '--count', 'HEAD']).trim())).toBeGreaterThan(1000);
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({})));

    expect(error.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(error.journal.phase).toBe('conflict');
    expect(error.journal.reason.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(readJournal(journalFile).phase).toBe('conflict');
    expect(readJournal(journalFile).commit).toBeNull();
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('refuses another writer temporary path and preserves it', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const tempPath = path.join(path.dirname(journalFile), `target.json.${FIXED_UUID}.tmp`);
    fs.writeFileSync(tempPath, 'other writer bytes\n');
    const before = liveSnapshot(repoRoot);

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({ randomUUID: () => FIXED_UUID })));

    expect(error.code).toBe('DOCS_JOURNAL_WRITE_FAILED');
    expect(fs.readFileSync(tempPath, 'utf8')).toBe('other writer bytes\n');
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(liveSnapshot(repoRoot)).toEqual(before);
  });

  testPosix('stops without live mutation when the journal cannot be published', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    const deps = depsFor({
      fs: failingFs({ renameSync: () => { throw new Error('injected rename failure'); } })
    });

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps));

    expect(error.code).toBe('DOCS_JOURNAL_WRITE_FAILED');
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(directoryInventory(path.dirname(journalFile)).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('refuses a malformed, symlinked or foreign journal', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const target = freshTarget(fixture, 'hyperclay');
    const journalFile = target.journalFile;
    const dir = path.dirname(journalFile);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: target.record.applicationFile, journalFile, message: MESSAGE }, deps);
    const pristine = fs.readFileSync(journalFile, 'utf8');

    expect(readRefusal(journalFile, { run: deps.run }).ok).toBe(true);

    fs.writeFileSync(journalFile, '{ not json');
    expect(readRefusal(journalFile, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');
    expect((await refusal(applyPreparedTarget({ journalFile }, deps))).code).toBe('DOCS_JOURNAL_INVALID');

    const extra = JSON.parse(pristine);
    extra.unexpected = true;
    fs.writeFileSync(journalFile, `${JSON.stringify(extra, null, 2)}\n`);
    expect(readRefusal(journalFile, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');

    fs.writeFileSync(journalFile, pristine);
    const link = path.join(OWNER, `link-${++fixtureSeq}.json`);
    fs.symlinkSync(journalFile, link);
    expect(readRefusal(link, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');

    const foreign = path.join(OUTS, `foreign-${++outSeq}`, 'target.json');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, pristine);
    expect(readRefusal(foreign, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');

    const wrongRoot = JSON.parse(pristine);
    wrongRoot.repoRoot = fixture.website;
    fs.writeFileSync(journalFile, `${JSON.stringify(wrongRoot, null, 2)}\n`);
    expect(readRefusal(journalFile, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');

    fs.writeFileSync(journalFile, pristine);
    expect(readRefusal(journalFile, { run: deps.run }).journal.commit).toBeNull();
    expect(directoryInventory(dir).length).toBeGreaterThan(0);
  });

  testPosix('refuses a tampered application digest and a changed push destination', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const target = freshTarget(fixture, 'hyperclay');
    const journalFile = target.journalFile;
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: target.record.applicationFile, journalFile, message: MESSAGE }, deps);

    const applicationBytes = fs.readFileSync(target.record.applicationFile);
    fs.writeFileSync(target.record.applicationFile, `${applicationBytes.toString('utf8')}\n`);
    expect(readRefusal(journalFile, { run: deps.run }).error.code).toBe('DOCS_JOURNAL_INVALID');
    expect((await refusal(reconcileTarget({ journalFile }, deps))).code).toBe('DOCS_JOURNAL_INVALID');
    fs.writeFileSync(target.record.applicationFile, applicationBytes);

    git(repoRoot, ['remote', 'set-url', '--push', 'origin', 'https://elsewhere.invalid/hyperclay.git']);
    const changed = readRefusal(journalFile, { run: deps.run }).error;
    expect(changed.code).toBe('DOCS_JOURNAL_INVALID');
    expect(changed.message).toMatch(/pushUrlSha256/);
  });

  testPosix('refuses a live selected mode change without applying anything', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const target = freshTarget(fixture, 'hyperclay');
    const journalFile = target.journalFile;
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: target.record.applicationFile, journalFile, message: MESSAGE }, deps);

    fs.chmodSync(path.join(repoRoot, EDGE_PATH), 0o755);
    const before = liveSnapshot(repoRoot);

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
  });

  testPosix('rechecks the runtime window before the candidate and before the ref update', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const cacheRoot = newCache();
    const blocked = Object.assign(new Error('outside the publish window'), { code: 'PUBLISH_WINDOW_BLOCKED' });

    const always = depsFor({ cacheRoot, assertPublishWindow: () => { throw blocked; } });
    const before = liveSnapshot(repoRoot);
    const first = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, always));
    expect(first.code).toBe('PUBLISH_WINDOW_BLOCKED');
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(always.run.calls.filter((call) => call[1] === 'commit-tree')).toEqual([]);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(fs.existsSync(docsLockDir(cacheRoot, repoRoot))).toBe(false);

    let calls = 0;
    const late = depsFor({
      cacheRoot,
      assertPublishWindow: () => {
        calls += 1;
        if (calls > 2) throw blocked;
      }
    });
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, late);
    const second = await refusal(applyPreparedTarget({ journalFile }, late));
    expect(second.code).toBe('PUBLISH_WINDOW_BLOCKED');
    expect(late.run.calls.filter((call) => call[1] === 'update-ref')).toEqual([]);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(record.beforeHead);
    expect(readJournal(journalFile).phase).toBe('ref-intent');
    expect(readJournal(journalFile).commit).toBeNull();
    expect(fs.existsSync(docsLockDir(cacheRoot, repoRoot))).toBe(false);

    const resumed = await reconcileTarget({ journalFile }, depsFor({ cacheRoot }));
    expect(resumed.commit).toBe(prepared.candidateCommit);
    expect(resumed.state).toBe('pending-push');
  });

  testPosix('holds the docs lock and the Ferry repo lock around the whole critical section', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const cacheRoot = newCache();
    const order = [];
    const ferryRoots = [];
    let nested = null;
    const deps = depsFor({
      cacheRoot,
      hook: (command, args) => {
        if (command !== 'git') return;
        if (args[0] === 'apply' && args[1] === '--index') {
          order.push('apply');
          if (nested === null) nested = refusal(applyPreparedTarget({ journalFile }, deps));
        }
        if (args[0] === 'update-ref') order.push('update-ref');
      },
      withFerryRepoLock: async (root, callback) => {
        ferryRoots.push(root);
        order.push('ferry-enter');
        try {
          return await callback();
        } finally {
          order.push('ferry-exit');
        }
      }
    });
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
    expect(order).toEqual(['ferry-enter', 'ferry-exit']);

    const result = await applyPreparedTarget({ journalFile }, deps);
    expect(result.state).toBe('pending-push');
    expect(order).toEqual(['ferry-enter', 'ferry-exit', 'ferry-enter', 'apply', 'update-ref', 'ferry-exit']);
    expect(ferryRoots).toEqual([repoRoot, repoRoot]);

    const error = await nested;
    expect(error.code).toBe('DOCS_LOCK_BUSY');
    expect(fs.existsSync(docsLockDir(cacheRoot, repoRoot))).toBe(false);

    const again = await reconcileTarget({ journalFile }, depsFor({ cacheRoot }));
    expect(again.commit).toBe(result.commit);
    expect(fs.existsSync(docsLockDir(cacheRoot, repoRoot))).toBe(false);
  });

  testPosix('refuses same-tree journal commits with a wrong parent (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const beforeCommits = commitCount(repoRoot);

    const substitutedRoot = git(repoRoot, ['commit-tree', record.expectedTree, '-m', 'unrelated root with the same tree']).trim();
    const substitutedChild = commitByHand(repoRoot, record.expectedTree, substitutedRoot, 'wrong parent with the same tree');
    const equivalent = commitByHand(repoRoot, record.expectedTree, record.beforeHead, 'equivalent documentation commit', {
      GIT_AUTHOR_DATE: '2021-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2021-01-01T00:00:00Z'
    });
    expect(substitutedRoot).toMatch(OID_PATTERN);
    expect(substitutedChild).toMatch(OID_PATTERN);
    expect(substitutedRoot).not.toBe(prepared.candidateCommit);
    expect(substitutedChild).not.toBe(prepared.candidateCommit);
    expect(equivalent).not.toBe(prepared.candidateCommit);
    expect(git(repoRoot, ['rev-parse', `${substitutedRoot}^{tree}`]).trim()).toBe(record.expectedTree);
    expect(git(repoRoot, ['rev-parse', `${substitutedChild}^{tree}`]).trim()).toBe(record.expectedTree);
    expect(git(repoRoot, ['rev-list', '--parents', '-n', '1', substitutedRoot]).trim()).toBe(substitutedRoot);
    expect(git(repoRoot, ['rev-list', '--parents', '-n', '1', substitutedChild]).trim()).toBe(`${substitutedChild} ${substitutedRoot}`);

    const expectRefusal = (patch) => {
      const payload = rewriteJournal(journalFile, patch);
      const result = readRefusal(journalFile, { run: deps.run });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('DOCS_JOURNAL_INVALID');
      expect(fs.readFileSync(journalFile, 'utf8')).toBe(payload);
    };

    expectRefusal({ commit: substitutedRoot, phase: 'committed', state: 'pending-push', reason: null });
    expectRefusal({ commit: substitutedChild, phase: 'committed', state: 'pending-push', reason: null });

    const acting = await refusal(reconcileTarget({ journalFile }, deps));
    expect(acting.code).toBe('DOCS_JOURNAL_INVALID');
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);

    const validPayload = rewriteJournal(journalFile, {
      commit: equivalent,
      phase: 'committed',
      state: 'pending-push',
      reason: null
    });
    const valid = readRefusal(journalFile, { run: deps.run });
    expect(valid.ok).toBe(true);
    expect(valid.journal.commit).toBe(equivalent);
    expect(valid.journal.candidateCommit).toBe(prepared.candidateCommit);
    expect(valid.journal.phase).toBe('committed');
    expect(valid.journal.state).toBe('pending-push');
    expect(fs.readFileSync(journalFile, 'utf8')).toBe(validPayload);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('refuses a shallow tip whose true documentation boundary is earlier (recovery boundary)', async () => {
    const fixture = makeFixture({ docsVersion: NEW });
    const repoRoot = fixture.hyperclay;
    const trueBoundary = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    write(repoRoot, 'README.md', 'later unrelated bytes\n');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-q', '-m', 'later unrelated']);
    const shallowTip = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    expect(shallowTip).not.toBe(trueBoundary);
    fs.writeFileSync(path.join(repoRoot, '.git', 'shallow'), `${shallowTip}\n`);
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    expect(record.paths).toEqual([]);
    expect(treeEntryOf(repoRoot, trueBoundary, EDGE_PATH).oid)
      .toBe(treeEntryOf(repoRoot, record.expectedTree, EDGE_PATH).oid);

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({})));

    expect(error.code).toBe('DOCS_HISTORY_UNRESOLVED');
    expect(error.journal.commit).toBeNull();
    expect(readJournal(journalFile).phase).toBe('conflict');
    expect(readJournal(journalFile).commit).toBeNull();
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('adopts a boundary proven by its raw parent inside shallow history (recovery boundary)', async () => {
    const fixture = makeFixture({ docsVersion: OLD });
    const repoRoot = fixture.hyperclay;
    write(repoRoot, EDGE_PATH, updateVersionInContent(edgeBody(OLD), OLD, NEW).updated);
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'docs to 1.29.0']);
    const boundary = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const earlier = git(repoRoot, ['rev-parse', `${boundary}^`]).trim();
    expect(earlier).not.toBe(boundary);
    fs.writeFileSync(path.join(repoRoot, '.git', 'shallow'), `${boundary}\n`);
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    expect(record.paths).toEqual([]);
    expect(treeEntryOf(repoRoot, boundary, EDGE_PATH).oid)
      .toBe(treeEntryOf(repoRoot, record.expectedTree, EDGE_PATH).oid);
    expect(treeEntryOf(repoRoot, earlier, EDGE_PATH).oid)
      .not.toBe(treeEntryOf(repoRoot, record.expectedTree, EDGE_PATH).oid);

    const result = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({}));

    expect(result.commit).toBe(boundary);
    expect(result.candidateCommit).toBeNull();
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(result.reason).toBeNull();
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('adopts a real root boundary in a shallow repository (recovery boundary)', async () => {
    const fixture = makeFixture({ docsVersion: NEW });
    const repoRoot = fixture.hyperclay;
    write(repoRoot, 'README.md', 'unrelated after the docs\n');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-q', '-m', 'unrelated']);
    const root = git(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']).trim();
    fs.writeFileSync(path.join(repoRoot, '.git', 'shallow'), `${root}\n`);
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    expect(record.paths).toEqual([]);

    const result = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({}));

    expect(result.commit).toBe(root);
    expect(result.candidateCommit).toBeNull();
    expect(result.phase).toBe('committed');
    expect(result.state).toBe('pending-push');
    expect(git(repoRoot, ['cat-file', '-p', root])).not.toMatch(/^parent /m);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('keeps a journal published before the docs lock and creates no candidate (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    const sentinel = 'other process journal\n';
    let injected = false;
    const deps = depsFor({
      hook: (command, args) => {
        if (!injected && command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
          injected = true;
          fs.writeFileSync(journalFile, sentinel);
        }
      }
    });

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps));

    expect(injected).toBe(true);
    expect(error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(fs.readFileSync(journalFile, 'utf8')).toBe(sentinel);
    expect(deps.run.calls.filter((call) => call[1] === 'commit-tree')).toEqual([]);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('does not treat an EACCES journal lstat as absence (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const before = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    const denied = Object.assign(new Error('injected permission failure'), { code: 'EACCES' });
    const deps = depsFor({
      fs: failingFs({
        lstatSync: (target, ...rest) => {
          if (target === journalFile) throw denied;
          return fs.lstatSync(target, ...rest);
        }
      })
    });

    const error = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps));

    expect(error.code).toBe('EACCES');
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(deps.run.calls.filter((call) => call[1] === 'commit-tree')).toEqual([]);
    expect(deps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
    expect(liveSnapshot(repoRoot)).toEqual(before);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('refuses selected editor bytes inserted just before the ref update (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const editor = 'editor bytes before the ref update\n';
    await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, depsFor({}));

    let windows = 0;
    const deps = depsFor({
      assertPublishWindow: () => {
        windows += 1;
        if (windows === 2) write(repoRoot, EDGE_PATH, editor);
      }
    });

    const error = await refusal(applyPreparedTarget({ journalFile }, deps));

    expect(windows).toBe(2);
    expect(error.code).toBe('DOCS_PREIMAGE_CONFLICT');
    expect(deps.run.calls.filter((call) => call[1] === 'apply').length).toBe(2);
    expect(deps.run.calls.filter((call) => call[1] === 'update-ref')).toEqual([]);
    expect(git(repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(record.beforeHead);
    expect(fs.readFileSync(path.join(repoRoot, EDGE_PATH), 'utf8')).toBe(editor);
    const journal = readJournal(journalFile);
    expect(journal.phase).toBe('conflict');
    expect(journal.state).toBe('conflict');
    expect(journal.commit).toBeNull();
  });

  testPosix('uses the journal refreshed before the locked callback (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    const prepared = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    const applied = await applyPreparedTarget({ journalFile }, deps);
    expect(applied.commit).toBe(prepared.candidateCommit);

    const substituted = git(repoRoot, ['commit-tree', record.expectedTree, '-m', 'unrelated root with the same tree']).trim();
    expect(substituted).toMatch(OID_PATTERN);
    expect(substituted).not.toBe(applied.commit);
    expect(git(repoRoot, ['rev-parse', `${substituted}^{tree}`]).trim()).toBe(record.expectedTree);
    const live = liveSnapshot(repoRoot);
    const beforeCommits = commitCount(repoRoot);
    let injected = false;
    let refreshedPayload = null;
    const refreshDeps = depsFor({
      hook: (command, args) => {
        if (!injected && command === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
          injected = true;
          refreshedPayload = rewriteJournal(journalFile, {
            commit: substituted,
            phase: 'committed',
            state: 'pending-push',
            reason: null
          });
        }
      }
    });

    const error = await refusal(reconcileTarget({ journalFile }, refreshDeps));

    expect(injected).toBe(true);
    expect(error.code).toBe('DOCS_JOURNAL_INVALID');
    expect(fs.readFileSync(journalFile, 'utf8')).toBe(refreshedPayload);
    expect(refreshDeps.run.calls.filter((call) => call[1] === 'apply' || call[1] === 'update-ref')).toEqual([]);
    expect(liveSnapshot(repoRoot)).toEqual(live);
    expect(commitCount(repoRoot)).toBe(beforeCommits);
  });

  testPosix('reads a committed journal without a time policy or live preimages (recovery boundary)', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const repoRoot = fixture.hyperclay;
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);
    const result = await applyPreparedTarget({ journalFile }, deps);

    const journalBytes = fs.readFileSync(journalFile);
    const before = directoryInventory(path.dirname(journalFile));
    const indexBytes = sha256(fs.readFileSync(path.join(repoRoot, '.git', 'index')));
    const edited = write(repoRoot, EDGE_PATH, 'live bytes changed after the journal was committed\n');
    const live = liveSnapshot(repoRoot);

    const journal = readTargetJournal(journalFile, { run: deps.run });

    expect(journal.journalFile).toBe(journalFile);
    expect(journal.commit).toBe(result.commit);
    expect(journal.phase).toBe('committed');
    expect(journal.state).toBe('pending-push');
    expect(journal.requiredPaths.length).toBeGreaterThan(0);
    expect(fs.readFileSync(edited, 'utf8')).toBe('live bytes changed after the journal was committed\n');
    expect(liveSnapshot(repoRoot)).toEqual(live);
    expect(sha256(fs.readFileSync(path.join(repoRoot, '.git', 'index')))).toBe(indexBytes);
    expect(fs.readFileSync(journalFile)).toEqual(journalBytes);
    expect(directoryInventory(path.dirname(journalFile))).toEqual(before);
  });

  testPosix('rejects an acting call without the injected time policy', async () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const record = planTarget(fixture, 'hyperclay', NEW);
    const journalFile = journalFileFor(record);
    const deps = depsFor({});
    await prepareCommitIntent({ applicationFile: record.applicationFile, journalFile, message: MESSAGE }, deps);

    const prepareError = await refusal(prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile: path.join(OUTS, `nopolicy-${++outSeq}`, 'target.json'),
      message: MESSAGE
    }, { run: deps.run, cacheRoot: newCache() }));
    expect(prepareError.code).toBe('DOCS_APPLY_DEPS_INVALID');

    const applyError = await refusal(applyPreparedTarget({ journalFile }, { run: deps.run, cacheRoot: newCache() }));
    expect(applyError.code).toBe('DOCS_APPLY_DEPS_INVALID');

    const reconcileError = await refusal(reconcileTarget({ journalFile }, { run: deps.run, cacheRoot: newCache() }));
    expect(reconcileError.code).toBe('DOCS_APPLY_DEPS_INVALID');
  });
});
