// A prepared documentation target is turned into a verified patch and an
// immutable expected tree inside a fresh out dir, so the sibling checkouts and
// their shared index never move. Every fixture repo here is local scratch under
// one owned temp root, and the generators only ever run against snapshots.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication, verifyDocsApplication } = require('../../scripts/release-docs-plan');
const { execFileCaptured } = require('../../scripts/release-command');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const OLD = '1.28.0';
const NEW = '1.29.0';

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-docs-plan-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const RUNS = path.join(OWNER, 'runs');
const OUTS = path.join(OWNER, 'outs');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

fs.mkdirSync(NO_HOOKS, { recursive: true });
fs.mkdirSync(RUNS, { recursive: true });
fs.mkdirSync(OUTS, { recursive: true });
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

const EDGE_HEAD = [
  "@component('components/layout/app', { title: 'Hyperclay Local' })",
  '  <script>',
  '    var downloads = {',
  "      macArm: { url: 'https://local.hyperclay.com/HyperclayLocal-1.28.0-arm64.dmg' },",
  "      windows: { url: 'https://local.hyperclay.com/HyperclayLocal-Setup-1.28.0.exe' }",
  '    };',
  "    var version = '1.28.0';",
  '  </script>',
  '@end',
  ''
].join('\n');

const VAULT_HEAD = [
  '---',
  'title: Hyperclay Local App',
  '---',
  '',
  'Download Hyperclay Local:',
  '',
  '   - **macOS**: [HyperclayLocal-1.28.0-arm64.dmg](https://local.hyperclay.com/HyperclayLocal-1.28.0-arm64.dmg)',
  '   - **Windows**: [HyperclayLocal-Setup-1.28.0.exe](https://local.hyperclay.com/HyperclayLocal-Setup-1.28.0.exe)',
  '',
  'Install with `chmod +x HyperclayLocal-1.28.0.AppImage` after downloading.',
  '',
  'This release is 1.28.0.',
  ''
].join('\n');

const PLATFORM_VAULT = ['---', 'title: Platform', '---', '', 'Platform notes.', ''].join('\n');

const VAULT_PATH = 'vault/DOCS/15 Hyperclay Local App.md';
const MDX_PATH = 'content/docs/hyperclay-local-app.mdx';
const LLMS_PATH = 'public/llms.txt';
const EDGE_PATH = 'server-pages/hyperclay-local.edge';

const QUOTED_VAULT = '15 Hyperclay Local App "Desktop".md';
const QUOTED_MDX = 'content/docs/hyperclay-local-app-desktop.mdx';

let fixtureSeq = 0;
let runSeq = 0;
let outSeq = 0;

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

function gitBytes(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: null, env: GIT_ENV });
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

function canonicalMdx(title, vaultContent) {
  return `---\ntitle: ${title}\npublish: true\n---\n\n${bodyOf(vaultContent)}`;
}

function canonicalSyncDocs(cwd) {
  const vaultDir = path.join(cwd, 'vault/DOCS');
  for (const name of fs.readdirSync(vaultDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const title = name.replace(/^\d+\s+/, '').replace(/\.md$/, '');
    write(cwd, `content/docs/${cleanName(name)}.mdx`, canonicalMdx(title, fs.readFileSync(path.join(vaultDir, name), 'utf8')));
  }
}

function canonicalLlmsTxt(cwd) {
  const docsDir = path.join(cwd, 'content/docs');
  const blocks = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith('.mdx'))
    .sort()
    .map((name) => `## ${name.replace(/\.mdx$/, '')}\n\n${bodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8'))}`);
  write(cwd, 'public/llms.txt', blocks.join('\n---\n\n'));
}

function binaryLlmsTxt(cwd) {
  const docsDir = path.join(cwd, 'content/docs');
  const blocks = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith('.mdx'))
    .sort()
    .map((name) => bodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8')));
  write(cwd, 'public/llms.txt', Buffer.concat([
    Buffer.from([0, 1, 2, 255, 254, 10]),
    Buffer.from(blocks.join('\n---\n\n'), 'utf8')
  ]));
}

function makeFixture({ vaultName = '15 Hyperclay Local App.md', vault = VAULT_HEAD, vaultMode = null, extraVaultDocs = {}, llms = canonicalLlmsTxt } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const hyperclay = path.join(parentDir, 'hyperclay');
  const website = path.join(parentDir, 'hyperclay-website');

  fs.mkdirSync(hyperclay, { recursive: true });
  git(hyperclay, ['init', '-q', '-b', 'main']);
  write(hyperclay, 'README.md', 'hyperclay readme\n');
  write(hyperclay, 'src/app.js', 'module.exports = {};\n');
  write(hyperclay, EDGE_PATH, EDGE_HEAD);
  git(hyperclay, ['add', '-A']);
  git(hyperclay, ['commit', '-q', '-m', 'fixture']);

  fs.mkdirSync(website, { recursive: true });
  git(website, ['init', '-q', '-b', 'main']);
  const vaultPath = `vault/DOCS/${vaultName}`;
  write(website, vaultPath, vault);
  if (vaultMode !== null) fs.chmodSync(path.join(website, vaultPath), vaultMode);
  write(website, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
  for (const [name, content] of Object.entries(extraVaultDocs)) write(website, `vault/DOCS/${name}`, content);
  write(website, 'package.json', `${JSON.stringify({
    name: 'hyperclay-website',
    version: '0.0.0',
    scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
  }, null, 2)}\n`);
  canonicalSyncDocs(website);
  llms(website);
  git(website, ['add', '-A']);
  git(website, ['commit', '-q', '-m', 'fixture']);

  return {
    parentDir,
    hyperclay,
    website,
    vaultPath,
    runDir: path.join(RUNS, `run-${++runSeq}`),
    outDir: path.join(OUTS, `out-${++outSeq}`)
  };
}

function makeRun({ liveWebsite, onSyncDocs, onLlmsTxt } = {}) {
  const npmCalls = [];
  const run = (command, args, options = {}) => {
    if (command !== 'npm') return childProcess.execFileSync(command, args, { encoding: 'utf8', env: GIT_ENV, ...options });
    const cwd = options.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      throw new Error(`npm needs an absolute snapshot cwd, received ${String(cwd)}`);
    }
    if (cwd === liveWebsite || cwd.startsWith(`${liveWebsite}${path.sep}`)) {
      throw new Error(`npm was pointed at the live website repo: ${cwd}`);
    }
    npmCalls.push({ argv: args.slice(), cwd });
    const [sub, script] = args;
    if (sub === 'ci') return '';
    if (sub === 'run' && script === 'sync-docs') {
      (onSyncDocs || canonicalSyncDocs)(cwd);
      return '';
    }
    if (sub === 'run' && script === 'build:llms-txt') {
      (onLlmsTxt || canonicalLlmsTxt)(cwd);
      return '';
    }
    throw new Error(`unexpected npm command: ${args.join(' ')}`);
  };
  run.npmCalls = npmCalls;
  return run;
}

function prepareFixture(fixture, version, runOptions) {
  const run = makeRun({ liveWebsite: fixture.website, ...runOptions });
  const prepared = prepareExternalDocs(
    { version, parentDir: fixture.parentDir, runDir: fixture.runDir },
    { run }
  );
  fixture.pristineDescriptor = fs.readFileSync(descriptorPath(fixture), 'utf8');
  return { run, prepared };
}

function planRun() {
  return (command, args, options = {}) => execFileCaptured(command, args, {
    ...options,
    env: { ...GIT_ENV, ...(options.env || {}) }
  });
}

const VERIFY_FORBIDDEN_COMMANDS = ['write-tree', 'read-tree', 'apply', 'update-index', 'hash-object'];

function wrappedRun(hook) {
  const run = planRun();
  return (command, args, options = {}) => {
    hook(command, args, options);
    return run(command, args, options);
  };
}

function verifyAttempt(applicationFile, options = {}) {
  try {
    return { ok: true, record: verifyDocsApplication(applicationFile, options) };
  } catch (error) {
    return { ok: false, error };
  }
}

function commandSpy() {
  const calls = [];
  const run = (command, args, options = {}) => {
    if (command === 'git' && VERIFY_FORBIDDEN_COMMANDS.includes(args[0])) {
      throw new Error(`forbidden read-only command: git ${args[0]}`);
    }
    calls.push([command, ...args]);
    return planRun()(command, args, options);
  };
  run.calls = calls;
  return run;
}

function directoryInventory(root) {
  const entries = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const stat = fs.lstatSync(abs);
      if (stat.isDirectory()) {
        entries.push({ rel: `${rel}/`, mode: (stat.mode & 0o7777).toString(8) });
        visit(abs);
      } else {
        entries.push({ rel, mode: (stat.mode & 0o7777).toString(8), sha256: sha256(fs.readFileSync(abs)) });
      }
    }
  };
  visit(root);
  return entries;
}

function repoInventory(repoRoot) {
  return {
    git: directoryInventory(path.join(repoRoot, '.git')),
    status: git(repoRoot, ['status', '--porcelain=v1', '-z']),
    head: git(repoRoot, ['rev-parse', 'HEAD']).trim()
  };
}

function evidenceInventory(record) {
  return {
    out: directoryInventory(path.dirname(record.applicationFile)),
    index: sha256(fs.readFileSync(record.privateIndexFile)),
    files: record.files.map((file) => ({
      path: file.path,
      before: sha256(fs.readFileSync(file.beforeFile)),
      after: sha256(fs.readFileSync(file.afterFile))
    }))
  };
}

function patchBytesFor(fixture, repo, rel) {
  const result = childProcess.spawnSync('git', [
    'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv',
    '--', `before/${rel}`, `after/${rel}`
  ], { cwd: path.join(fixture.runDir, repo), encoding: null, maxBuffer: 16 * 1024 * 1024, env: GIT_ENV, shell: false });
  expect(result.status).toBe(1);
  return result.stdout;
}

function descriptorPath(fixture) {
  return path.join(fixture.runDir, 'prepared.json');
}

function readDescriptor(fixture) {
  return JSON.parse(fs.readFileSync(descriptorPath(fixture), 'utf8'));
}

function mutateDescriptor(fixture, repo, mutate) {
  const descriptor = JSON.parse(fixture.pristineDescriptor);
  const target = descriptor.targets.find((entry) => entry.repo === repo);
  mutate(descriptor, target);
  fs.writeFileSync(descriptorPath(fixture), `${JSON.stringify(descriptor, null, 2)}\n`);
}

function planAttempt(fixture, repo, version, { mutate, run, outDir } = {}) {
  if (mutate) mutateDescriptor(fixture, repo, mutate);
  try {
    const record = prepareDocsApplication({
      preparedFile: descriptorPath(fixture),
      repo,
      parentDir: fixture.parentDir,
      version,
      outDir: outDir || fixture.outDir
    }, { run: run || planRun() });
    return { ok: true, record };
  } catch (error) {
    return { ok: false, error };
  }
}

function expectRefusal(attempt, pattern, code) {
  expect(attempt.ok).toBe(false);
  expect(attempt.error.message).toMatch(pattern);
  if (code) expect(attempt.error.code).toBe(code);
  return attempt.error;
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

function replayPatch(repoRoot, patchFile, beforeHead) {
  const scratch = fs.mkdtempSync(path.join(OWNER, 'replay-'));
  const env = { ...GIT_ENV, GIT_INDEX_FILE: path.join(scratch, 'index'), GIT_OPTIONAL_LOCKS: '0' };
  git(repoRoot, ['read-tree', beforeHead], { env });
  if (fs.statSync(patchFile).size > 0) git(repoRoot, ['apply', '--cached', '-p1', patchFile], { env });
  return git(repoRoot, ['write-tree'], { env }).trim();
}

function treeEntryOf(repoRoot, treeish, rel) {
  const line = git(repoRoot, ['ls-tree', '-z', treeish, '--', rel]).split('\0').filter(Boolean)[0];
  const tab = line.indexOf('\t');
  const [mode, type, oid] = line.slice(0, tab).split(' ');
  return { mode, type, oid };
}

function withoutApplicationFile(record) {
  const { applicationFile, ...rest } = record;
  return rest;
}

describePosix('prepareDocsApplication', () => {
  test('plans both targets with nonzero changes and leaves the live repositories untouched', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const hyperclayBefore = liveSnapshot(fixture.hyperclay);
    const websiteBefore = liveSnapshot(fixture.website);

    const hyperclayOut = path.join(OUTS, `h-${++outSeq}`);
    const websiteOut = path.join(OUTS, `w-${++outSeq}`);
    const hyperclay = planAttempt(fixture, 'hyperclay', NEW, { outDir: hyperclayOut });
    const website = planAttempt(fixture, 'hyperclay-website', NEW, { outDir: websiteOut });
    expect(hyperclay.ok).toBe(true);
    expect(website.ok).toBe(true);

    const record = hyperclay.record;
    expect(record.schema).toBe(1);
    expect(record.version).toBe(NEW);
    expect(record.repo).toBe('hyperclay');
    expect(record.repoRoot).toBe(fs.realpathSync(fixture.hyperclay));
    expect(record.preparedFile).toBe(descriptorPath(fixture));
    expect(record.preparedSha256).toBe(sha256(fs.readFileSync(descriptorPath(fixture))));
    expect(record.beforeHead).toBe(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim());
    expect(record.beforeIndexFingerprint).toBe(sha256(git(fixture.hyperclay, ['ls-files', '--stage', '-z'])));
    expect(record.sourcePath).toBe(EDGE_PATH);
    expect(record.paths).toEqual([EDGE_PATH]);
    expect(record.requiredPaths).toEqual([EDGE_PATH]);
    expect(record.files).toEqual([{
      path: EDGE_PATH,
      beforeSha256: sha256(EDGE_HEAD),
      afterSha256: sha256(EDGE_HEAD.split(OLD).join(NEW)),
      mode: '644',
      beforeFile: path.join(fixture.runDir, 'hyperclay', 'before', EDGE_PATH),
      afterFile: path.join(fixture.runDir, 'hyperclay', 'after', EDGE_PATH),
      changed: true
    }]);
    expect(record.applicationFile).toBe(path.join(hyperclayOut, 'application.json'));
    expect(JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'))).toEqual(withoutApplicationFile(record));
    expect(fs.readdirSync(path.dirname(record.applicationFile)).sort()).toEqual(['application.json', 'candidate.patch', 'index']);
    expect((fs.statSync(path.dirname(record.applicationFile)).mode & 0o777).toString(8)).toBe('700');
    expect((fs.statSync(record.patchFile).mode & 0o777).toString(8)).toBe('600');
    expect(record.patchSha256).toBe(sha256(fs.readFileSync(record.patchFile)));
    expect(fs.statSync(record.patchFile).size).toBeGreaterThan(0);
    expect(record.expectedTree).not.toBe(git(fixture.hyperclay, ['rev-parse', 'HEAD^{tree}']).trim());
    expect(record.expectedTree).toBe(replayPatch(fixture.hyperclay, record.patchFile, record.beforeHead));
    expect(record.expectedIndexFingerprint).not.toBe(record.beforeIndexFingerprint);
    expect(record.privateIndexFile).toBe(path.join(hyperclayOut, 'index'));

    const edgeBlob = treeEntryOf(fixture.hyperclay, record.expectedTree, EDGE_PATH);
    expect(edgeBlob.mode).toBe('100644');
    expect(gitBytes(fixture.hyperclay, ['cat-file', 'blob', edgeBlob.oid]).equals(fs.readFileSync(record.files[0].afterFile))).toBe(true);

    const websiteRecord = website.record;
    expect(websiteRecord.repo).toBe('hyperclay-website');
    expect(websiteRecord.repoRoot).toBe(fs.realpathSync(fixture.website));
    expect(websiteRecord.sourcePath).toBe(VAULT_PATH);
    expect(websiteRecord.paths).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(websiteRecord.requiredPaths).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(websiteRecord.expectedTree).not.toBe(git(fixture.website, ['rev-parse', 'HEAD^{tree}']).trim());
    expect(websiteRecord.expectedTree).toBe(replayPatch(fixture.website, websiteRecord.patchFile, websiteRecord.beforeHead));
    for (const file of websiteRecord.files.filter((entry) => entry.changed)) {
      const blob = treeEntryOf(fixture.website, websiteRecord.expectedTree, file.path);
      expect(blob.mode).toBe(`100${file.mode}`);
      expect(gitBytes(fixture.website, ['cat-file', 'blob', blob.oid]).equals(fs.readFileSync(file.afterFile))).toBe(true);
    }

    const hyperclayVerified = verifyAttempt(record.applicationFile, { run: planRun() });
    expect(hyperclayVerified.ok).toBe(true);
    expect(withoutApplicationFile(hyperclayVerified.record)).toEqual(withoutApplicationFile(record));
    const websiteVerified = verifyAttempt(websiteRecord.applicationFile, { run: planRun() });
    expect(websiteVerified.ok).toBe(true);
    expect(withoutApplicationFile(websiteVerified.record)).toEqual(withoutApplicationFile(websiteRecord));

    expect(liveSnapshot(fixture.hyperclay)).toEqual(hyperclayBefore);
    expect(liveSnapshot(fixture.website)).toEqual(websiteBefore);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  test('preserves unrelated unstaged work in the live repositories', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const scratchFile = write(fixture.website, 'notes.md', 'scratch notes\n');
    fs.appendFileSync(path.join(fixture.website, 'package.json'), '\n');

    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);

    expect(attempt.ok).toBe(true);
    expect(fs.readFileSync(scratchFile, 'utf8')).toBe('scratch notes\n');
    expect(fs.readFileSync(path.join(fixture.website, 'package.json'), 'utf8')).toMatch(/\n\n$/);
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z', '--', VAULT_PATH, MDX_PATH, LLMS_PATH])).toBe('');
    expect(git(fixture.website, ['diff', '--cached', '--name-only', '-z'])).toBe('');
  });

  test('refuses staged changes anywhere in the live repository', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    write(fixture.hyperclay, 'notes.md', 'notes\n');
    git(fixture.hyperclay, ['add', 'notes.md']);

    const attempt = planAttempt(fixture, 'hyperclay', NEW);

    expectRefusal(attempt, /hyperclay index changed at entry/, 'DOCS_PREIMAGE_CONFLICT');
    expect(git(fixture.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
  });

  test('refuses a selected path that changed on disk', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    fs.appendFileSync(path.join(fixture.website, VAULT_PATH), 'local edit\n');

    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);

    expectRefusal(attempt, /has pending changes for the release targets at entry/, 'DOCS_PREIMAGE_CONFLICT');
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toMatch(/local edit/);
  });

  test('refuses a HEAD that moved after preparation', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const beforeHead = git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim();
    git(fixture.hyperclay, ['commit', '-q', '--allow-empty', '-m', 'user commit']);

    const attempt = planAttempt(fixture, 'hyperclay', NEW);

    expectRefusal(attempt, /HEAD moved from .* at entry/, 'DOCS_PREIMAGE_CONFLICT');
    expect(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
  });

  test('refuses an unsupported target repo and a mismatched prepared version', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor) => { descriptor.targets[0].repo = 'somewhere-else'; }
    }), /is not a supported repo/);
    expectRefusal(planAttempt(fixture, 'hyperclay', OLD), /prepared version .* does not match/);
    expectRefusal(planAttempt(fixture, 'not-a-repo', NEW), /repo must be hyperclay or hyperclay-website/);
  });

  test('refuses a website source path outside the vault docs', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay-website', NEW, {
      mutate: (descriptor, target) => { target.sourcePath = 'vault/DOCS/07 Platform.md'; }
    }), /sourcePath must be a Hyperclay Local markdown document/);
    expectRefusal(planAttempt(fixture, 'hyperclay-website', NEW, {
      mutate: (descriptor, target) => { target.sourcePath = 'content/docs/hyperclay-local-app.mdx'; }
    }), /sourcePath must be a direct vault\/DOCS document/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.sourcePath = 'README.md'; }
    }), /hyperclay sourcePath must be/);
  });

  test('refuses a generated set that does not match the release targets', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay-website', NEW, {
      mutate: (descriptor, target) => { target.paths = target.paths.slice(0, 2); }
    }), /do not match the release targets/);
    expectRefusal(planAttempt(fixture, 'hyperclay-website', NEW, {
      mutate: (descriptor, target) => {
        target.paths = target.paths.concat([{ ...target.paths[2], path: 'public/robots.txt' }]);
      }
    }), /do not match the release targets/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => {
        target.paths = target.paths.concat([{ ...target.paths[0], path: 'src/app.js' }]);
      }
    }), /do not match the release targets/);
  });

  test('refuses a snapshot path that escapes the prepared run dir', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].beforeFile = '/etc/hosts'; }
    }), /beforeFile must be/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].path = '../escape'; }
    }), /has an invalid component/);
  });

  test('refuses a symlinked snapshot file', () => {
    const fixture = makeFixture();
    const { prepared } = prepareFixture(fixture, NEW);
    const entry = prepared.targets[0].paths[0];
    fs.rmSync(entry.afterFile);
    fs.symlinkSync('/etc/hosts', entry.afterFile);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW), /afterFile is a symlink/);
    expect(fs.lstatSync(entry.afterFile).isSymbolicLink()).toBe(true);
  });

  test('refuses a tampered snapshot mode, hash and changed flag', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].mode = '755'; }
    }), /mode 644 does not match 755/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].mode = '4755'; }
    }), /must not carry special bits/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].afterSha256 = 'a'.repeat(64); }
    }), /afterFile does not match afterSha256/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => { target.paths[0].changed = false; }
    }), /changed flag does not match the snapshot hashes/);
  });

  test('refuses snapshot bytes that no longer match the recorded head', () => {
    const fixture = makeFixture();
    const { prepared } = prepareFixture(fixture, NEW);
    const entry = prepared.targets[0].paths[0];
    const tampered = fs.readFileSync(entry.beforeFile, 'utf8').replace(OLD, '1.27.0');
    fs.writeFileSync(entry.beforeFile, tampered);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, {
      mutate: (descriptor, target) => {
        target.paths[0].beforeSha256 = sha256(tampered);
        target.paths[0].changed = sha256(tampered) !== target.paths[0].afterSha256;
      }
    }), /beforeFile does not match the Git blob at/);
  });

  test('refuses a prepared run dir that still holds a staging file', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    fs.writeFileSync(path.join(fixture.runDir, 'prepared.json.staging'), '{}\n');

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW), /unpublished staging file/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { mutate: () => {} }), /unpublished staging file/);
  });

  test('refuses an out dir inside the parent dir, a live repo or the prepared run dir', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);

    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: path.join(fixture.parentDir, `nested-${++outSeq}`) }),
      /must live outside parentDir/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: path.join(fixture.hyperclay, `nested-${++outSeq}`) }),
      /must live outside/);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: path.join(fixture.runDir, `nested-${++outSeq}`) }),
      /must live outside prepared run dir/);
    const existing = path.join(OUTS, `existing-${++outSeq}`);
    fs.mkdirSync(existing);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: existing }), /outDir already exists/);
    expect(fs.readdirSync(fixture.runDir)).toEqual(['hyperclay', 'hyperclay-website', 'prepared.json']);
  });

  test('refuses a descriptor that changes while the plan is being built', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const run = planRun();
    let mutated = false;
    const wrapped = (command, args, options = {}) => {
      const output = run(command, args, options);
      if (!mutated && command === 'git' && args[0] === 'write-tree') {
        mutated = true;
        mutateDescriptor(fixture, 'hyperclay', (descriptor) => { descriptor.targets[0].oldVersion = '1.0.0'; });
      }
      return output;
    };

    const attempt = planAttempt(fixture, 'hyperclay', NEW, { run: wrapped });

    expect(mutated).toBe(true);
    expectRefusal(attempt, /changed while the plan was being built/);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.outDir, 'candidate.patch'))).toBe(true);
    expect(fs.existsSync(path.join(fixture.outDir, 'index'))).toBe(true);
  });

  test('plans an exact empty patch when the version already matches', () => {
    const fixture = makeFixture();
    const { prepared } = prepareFixture(fixture, OLD);
    expect(prepared.targets.every((target) => target.paths.every((entry) => !entry.changed))).toBe(true);

    const hyperclay = planAttempt(fixture, 'hyperclay', OLD, { outDir: path.join(OUTS, `e-h-${++outSeq}`) });
    const website = planAttempt(fixture, 'hyperclay-website', OLD, { outDir: path.join(OUTS, `e-w-${++outSeq}`) });
    expect(hyperclay.ok).toBe(true);
    expect(website.ok).toBe(true);

    for (const [record, repoRoot] of [[hyperclay.record, fixture.hyperclay], [website.record, fixture.website]]) {
      expect(record.paths).toEqual([]);
      expect(record.files.every((entry) => entry.changed === false)).toBe(true);
      expect(fs.statSync(record.patchFile).size).toBe(0);
      expect(record.patchSha256).toBe(sha256(Buffer.alloc(0)));
      expect(record.expectedTree).toBe(git(repoRoot, ['rev-parse', 'HEAD^{tree}']).trim());
      expect(record.expectedTree).toBe(replayPatch(repoRoot, record.patchFile, record.beforeHead));
      expect(record.expectedIndexFingerprint).toBe(record.beforeIndexFingerprint);
    }
    for (const record of [hyperclay.record, website.record]) {
      const verified = verifyAttempt(record.applicationFile, { run: planRun() });
      expect(verified.ok).toBe(true);
      expect(withoutApplicationFile(verified.record)).toEqual(withoutApplicationFile(record));
    }
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  test('handles quoted filenames and an executable source', () => {
    const fixture = makeFixture({ vaultName: QUOTED_VAULT, vaultMode: 0o755 });
    prepareFixture(fixture, NEW);

    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);
    expect(attempt.ok).toBe(true);

    const record = attempt.record;
    expect(record.paths).toEqual([`vault/DOCS/${QUOTED_VAULT}`, QUOTED_MDX, LLMS_PATH]);
    const source = record.files.find((entry) => entry.path === `vault/DOCS/${QUOTED_VAULT}`);
    expect(source.mode).toBe('755');
    expect(record.expectedTree).toBe(replayPatch(fixture.website, record.patchFile, record.beforeHead));
    expect(treeEntryOf(fixture.website, record.expectedTree, source.path).mode).toBe('100755');
    const patch = fs.readFileSync(record.patchFile, 'utf8');
    expect(patch.split('\n')[0].startsWith('diff --git "before/')).toBe(true);
    expect(patch).toContain('+++ "after/vault/DOCS/15 Hyperclay Local App');
    const verified = verifyAttempt(record.applicationFile, { run: planRun() });
    expect(verified.ok).toBe(true);
    expect(withoutApplicationFile(verified.record)).toEqual(withoutApplicationFile(record));
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  test('handles a binary generated file while the source stays real doc text', () => {
    const fixture = makeFixture({ llms: binaryLlmsTxt });
    prepareFixture(fixture, NEW, { onLlmsTxt: binaryLlmsTxt });

    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);
    expect(attempt.ok).toBe(true);

    const record = attempt.record;
    expect(record.paths).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    const llms = record.files.find((entry) => entry.path === LLMS_PATH);
    expect(fs.readFileSync(llms.beforeFile).includes(0)).toBe(true);
    expect(fs.readFileSync(llms.afterFile).includes(0)).toBe(true);
    expect(fs.readFileSync(record.files[0].beforeFile, 'utf8')).toBe(VAULT_HEAD);
    expect(fs.readFileSync(record.patchFile, 'utf8')).toContain('GIT binary patch');
    expect(record.expectedTree).toBe(replayPatch(fixture.website, record.patchFile, record.beforeHead));
    const blob = treeEntryOf(fixture.website, record.expectedTree, LLMS_PATH);
    expect(gitBytes(fixture.website, ['cat-file', 'blob', blob.oid]).equals(fs.readFileSync(llms.afterFile))).toBe(true);
    const verified = verifyAttempt(record.applicationFile, { run: planRun() });
    expect(verified.ok).toBe(true);
    expect(withoutApplicationFile(verified.record)).toEqual(withoutApplicationFile(record));
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  testPosix('keeps a preexisting temporary file when exclusive publication collides', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const uuid = '00000000-0000-4000-8000-000000000000';
    const sentinel = Buffer.from('someone else owns this temp file\n');
    const temporary = path.join(fixture.outDir, `${uuid}.tmp`);
    const spy = jest.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    let placed = false;
    const run = wrappedRun((command, args) => {
      if (!placed && command === 'git' && args[0] === 'status' && fs.existsSync(fixture.outDir)) {
        placed = true;
        fs.writeFileSync(temporary, sentinel);
      }
    });
    let attempt;
    try {
      attempt = planAttempt(fixture, 'hyperclay', NEW, { run });
    } finally {
      spy.mockRestore();
    }

    expect(placed).toBe(true);
    expect(attempt.ok).toBe(false);
    expect(attempt.error.code).toBe('EEXIST');
    expect(fs.readFileSync(temporary).equals(sentinel)).toBe(true);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.outDir, 'candidate.patch'))).toBe(true);
    expect(fs.existsSync(path.join(fixture.outDir, 'index'))).toBe(true);
  });

  testPosix('refuses special permission bits on snapshot and live selected files', () => {
    const fixture = makeFixture();
    const { prepared } = prepareFixture(fixture, NEW);
    const entry = prepared.targets[0].paths[0];
    expect(entry.mode).toBe('644');
    const live = path.join(fixture.hyperclay, EDGE_PATH);

    fs.chmodSync(live, 0o4644);
    const liveOut = path.join(OUTS, `bits-live-${++outSeq}`);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: liveOut }),
      /live target .* must not carry special bits: 4644/);
    expect(fs.existsSync(path.join(liveOut, 'application.json'))).toBe(false);
    fs.chmodSync(live, 0o644);

    fs.chmodSync(entry.beforeFile, 0o4644);
    const snapshotOut = path.join(OUTS, `bits-snap-${++outSeq}`);
    expectRefusal(planAttempt(fixture, 'hyperclay', NEW, { outDir: snapshotOut }),
      /beforeFile must not carry special bits: 4644/);
    expect(fs.existsSync(path.join(snapshotOut, 'application.json'))).toBe(false);
    fs.chmodSync(entry.beforeFile, 0o644);

    const planned = planAttempt(fixture, 'hyperclay', NEW, { outDir: path.join(OUTS, `bits-ok-${++outSeq}`) });
    expect(planned.ok).toBe(true);
    fs.chmodSync(entry.beforeFile, 0o4644);
    expectRefusal(verifyAttempt(planned.record.applicationFile, { run: planRun() }),
      /beforeFile must not carry special bits: 4644/, 'DOCS_APPLICATION_INVALID');
    fs.chmodSync(entry.beforeFile, 0o644);
  });

  testPosix('refuses a live special-bit change injected before the final check', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const live = path.join(fixture.hyperclay, EDGE_PATH);
    let injected = false;
    const run = wrappedRun((command, args) => {
      if (!injected && command === 'git' && args[0] === 'write-tree') {
        injected = true;
        fs.chmodSync(live, 0o4644);
      }
    });

    const attempt = planAttempt(fixture, 'hyperclay', NEW, { run });

    expect(injected).toBe(true);
    expectRefusal(attempt, /live target .* must not carry special bits: 4644/);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
    fs.chmodSync(live, 0o644);
  });

  testPosix('refuses a snapshot special-bit change injected before the final check', () => {
    const fixture = makeFixture();
    const { prepared } = prepareFixture(fixture, NEW);
    const afterFile = prepared.targets[0].paths[0].afterFile;
    let injected = false;
    const run = wrappedRun((command, args) => {
      if (!injected && command === 'git' && args[0] === 'write-tree') {
        injected = true;
        fs.chmodSync(afterFile, 0o4644);
      }
    });

    const attempt = planAttempt(fixture, 'hyperclay', NEW, { run });

    expect(injected).toBe(true);
    expectRefusal(attempt, /afterFile must not carry special bits: 4644/);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
    fs.chmodSync(afterFile, 0o644);
  });
});

describePosix('verifyDocsApplication', () => {
  test('revalidates the recorded plan after the change is applied', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;
    const beforeHead = record.beforeHead;

    fs.writeFileSync(path.join(fixture.hyperclay, EDGE_PATH), fs.readFileSync(record.files[0].afterFile));
    git(fixture.hyperclay, ['add', '-A']);
    git(fixture.hyperclay, ['commit', '-q', '-m', 'apply docs']);
    expect(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);

    const verified = verifyDocsApplication(record.applicationFile, { run: planRun() });

    expect(withoutApplicationFile(verified)).toEqual(withoutApplicationFile(record));
    expect(verified.applicationFile).toBe(record.applicationFile);
    expect(git(fixture.hyperclay, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(record.expectedTree);

    write(fixture.hyperclay, 'notes-after-release.md', 'unrelated later work\n');
    git(fixture.hyperclay, ['add', 'notes-after-release.md']);
    git(fixture.hyperclay, ['commit', '-q', '-m', 'unrelated later commit']);
    const rechecked = verifyAttempt(record.applicationFile, { run: planRun() });
    expect(rechecked.ok).toBe(true);
    expect(withoutApplicationFile(rechecked.record)).toEqual(withoutApplicationFile(record));
  });

  test('refuses tampered application evidence', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;

    const corrupt = (label, mutate) => {
      const original = fs.readFileSync(record.applicationFile);
      const value = JSON.parse(original.toString('utf8'));
      mutate(value);
      fs.writeFileSync(record.applicationFile, `${JSON.stringify(value, null, 2)}\n`);
      let error = null;
      try {
        verifyDocsApplication(record.applicationFile, { run: planRun() });
      } catch (caught) {
        error = caught;
      } finally {
        fs.writeFileSync(record.applicationFile, original);
      }
      if (error === null) throw new Error(`corrupt ${label} application was accepted`);
      expect(error.code).toBe('DOCS_APPLICATION_INVALID');
      return error;
    };

    expect(corrupt('tree', (value) => { value.expectedTree = 'b'.repeat(40); }).message)
      .toMatch(/expectedTree is not an existing tree/);
    expect(corrupt('patch', (value) => { value.patchSha256 = 'c'.repeat(64); }).message).toMatch(/patchSha256/);
    expect(corrupt('prepared', (value) => { value.preparedSha256 = 'd'.repeat(64); }).message).toMatch(/preparedSha256/);
    expect(corrupt('paths', (value) => { value.paths = []; }).message).toMatch(/paths do not match/);
    expect(corrupt('files', (value) => { value.files[0].afterSha256 = 'e'.repeat(64); }).message)
      .toMatch(/afterSha256 does not match the prepared target/);
    expect(corrupt('target', (value) => {
      value.files[0].path = 'src/app.js';
      value.requiredPaths = ['src/app.js'];
      value.paths = ['src/app.js'];
    }).message).toMatch(/do not match the prepared target paths/);
    expect(corrupt('patch-location', (value) => {
      value.patchFile = path.join(fixture.parentDir, 'candidate.patch');
    }).message).toMatch(/patchFile must be exactly/);
    expect(corrupt('index-location', (value) => {
      value.privateIndexFile = path.join(fixture.parentDir, 'index');
    }).message).toMatch(/privateIndexFile must be exactly/);
    expect(corrupt('extra', (value) => { value.applicationFile = record.applicationFile; }).message)
      .toMatch(/fields do not match schema 1/);
  });

  test('refuses a tampered private index', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;

    const env = { ...GIT_ENV, GIT_INDEX_FILE: record.privateIndexFile, GIT_OPTIONAL_LOCKS: '0' };
    git(fixture.hyperclay, ['update-index', '--add', '--cacheinfo', `100644,${'a'.repeat(40)},intruder.txt`], { env });

    let error = null;
    try {
      verifyDocsApplication(record.applicationFile, { run: planRun() });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeNull();
    expect(error.code).toBe('DOCS_APPLICATION_INVALID');
    expect(error.message).toMatch(/private index fingerprint/);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  testPosix('refuses a substituted patch whose recorded hash was rewritten', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;

    const substitute = Buffer.from('not a Git patch\n', 'utf8');
    fs.writeFileSync(record.patchFile, substitute);
    const value = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    value.patchSha256 = sha256(substitute);
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(value, null, 2)}\n`);

    const repoBefore = repoInventory(fixture.hyperclay);
    const evidenceBefore = evidenceInventory(record);
    const run = commandSpy();
    expectRefusal(verifyAttempt(record.applicationFile, { run }), /does not match the regenerated patch/,
      'DOCS_APPLICATION_INVALID');
    expect(run.calls.filter(([command, sub]) => command === 'git' && VERIFY_FORBIDDEN_COMMANDS.includes(sub)))
      .toEqual([]);
    expect(repoInventory(fixture.hyperclay)).toEqual(repoBefore);
    expect(evidenceInventory(record)).toEqual(evidenceBefore);
  });

  testPosix('refuses an unmerged private index even when its fingerprint was rewritten', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;

    const env = { ...GIT_ENV, GIT_INDEX_FILE: record.privateIndexFile, GIT_OPTIONAL_LOCKS: '0' };
    childProcess.execFileSync('git', ['update-index', '--index-info'], {
      cwd: fixture.hyperclay,
      env,
      input: `100644 ${'a'.repeat(40)} 1\tsrc/app.js\n`,
      encoding: 'utf8'
    });
    const fingerprint = sha256(git(fixture.hyperclay, ['ls-files', '--stage', '-z'], { env }));
    const value = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    value.expectedIndexFingerprint = fingerprint;
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(value, null, 2)}\n`);

    expectRefusal(verifyAttempt(record.applicationFile, { run: planRun() }),
      /not a stage0 file/, 'DOCS_APPLICATION_INVALID');
  });

  testPosix('refuses a valid patch for a different selected path', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay-website', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;
    const other = record.files.find((file) => file.path === MDX_PATH);
    const replacement = patchBytesFor(fixture, 'hyperclay-website', other.path);
    expect(replacement.length).toBeGreaterThan(0);
    fs.writeFileSync(record.patchFile, replacement);
    const value = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    value.patchSha256 = sha256(replacement);
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(value, null, 2)}\n`);

    const repoBefore = repoInventory(fixture.website);
    const evidenceBefore = evidenceInventory(record);
    expectRefusal(verifyAttempt(record.applicationFile, { run: commandSpy() }),
      /does not match the regenerated patch/, 'DOCS_APPLICATION_INVALID');
    expect(repoInventory(fixture.website)).toEqual(repoBefore);
    expect(evidenceInventory(record)).toEqual(evidenceBefore);
  });

  testPosix('refuses a wrong application basename or a relative application path', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;

    const copy = path.join(path.dirname(record.applicationFile), 'application-copy.json');
    fs.copyFileSync(record.applicationFile, copy);
    expectRefusal(verifyAttempt(copy, { run: planRun() }), /applicationFile must be exactly/,
      'DOCS_APPLICATION_INVALID');

    const relative = path.relative(process.cwd(), record.applicationFile);
    expect(path.isAbsolute(relative)).toBe(false);
    expectRefusal(verifyAttempt(relative, { run: planRun() }), /must be an absolute path/,
      'DOCS_APPLICATION_INVALID');

    const nestedParent = path.join(fixture.parentDir, 'nested');
    fs.mkdirSync(nestedParent);
    fs.copyFileSync(record.applicationFile, path.join(nestedParent, 'application.json'));
    expectRefusal(verifyAttempt(path.join(nestedParent, 'application.json'), { run: planRun() }),
      /must live outside parentDir/, 'DOCS_APPLICATION_INVALID');

    const nestedRun = path.join(fixture.runDir, 'nested');
    fs.mkdirSync(nestedRun);
    fs.copyFileSync(record.applicationFile, path.join(nestedRun, 'application.json'));
    expectRefusal(verifyAttempt(path.join(nestedRun, 'application.json'), { run: planRun() }),
      /must live outside prepared run dir/, 'DOCS_APPLICATION_INVALID');
  });

  testPosix('refuses a symlinked prepared descriptor', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);

    const descriptor = descriptorPath(fixture);
    const moved = path.join(fixture.runDir, 'prepared-real.json');
    fs.renameSync(descriptor, moved);
    fs.symlinkSync(moved, descriptor);
    expectRefusal(verifyAttempt(attempt.record.applicationFile, { run: planRun() }),
      /preparedFile is a symlink/, 'DOCS_APPLICATION_INVALID');
    fs.rmSync(descriptor);
    fs.renameSync(moved, descriptor);
  });

  testPosix('refuses a rehashed record that points at a different target path', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const attempt = planAttempt(fixture, 'hyperclay', NEW);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;
    const alternate = 'src/app.js';

    const descriptor = readDescriptor(fixture);
    const entry = descriptor.targets[0].paths[0];
    entry.path = alternate;
    entry.beforeFile = path.join(fixture.runDir, 'hyperclay', 'before', alternate);
    entry.afterFile = path.join(fixture.runDir, 'hyperclay', 'after', alternate);
    fs.writeFileSync(descriptorPath(fixture), `${JSON.stringify(descriptor, null, 2)}\n`);

    const value = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    value.preparedSha256 = sha256(fs.readFileSync(descriptorPath(fixture)));
    value.files[0].path = alternate;
    value.files[0].beforeFile = entry.beforeFile;
    value.files[0].afterFile = entry.afterFile;
    value.requiredPaths = [alternate];
    value.paths = [alternate];
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(value, null, 2)}\n`);

    expectRefusal(verifyAttempt(record.applicationFile, { run: planRun() }),
      /do not match the release targets/, 'DOCS_APPLICATION_INVALID');
  });

  testPosix('verifies both targets without writing Git objects or touching the repositories', () => {
    const fixture = makeFixture();
    prepareFixture(fixture, NEW);
    const hyperclay = planAttempt(fixture, 'hyperclay', NEW, { outDir: path.join(OUTS, `ro-h-${++outSeq}`) });
    const website = planAttempt(fixture, 'hyperclay-website', NEW, { outDir: path.join(OUTS, `ro-w-${++outSeq}`) });
    expect(hyperclay.ok).toBe(true);
    expect(website.ok).toBe(true);

    const repoBefore = { hyperclay: repoInventory(fixture.hyperclay), website: repoInventory(fixture.website) };
    const evidenceBefore = {
      hyperclay: evidenceInventory(hyperclay.record),
      website: evidenceInventory(website.record)
    };
    const run = commandSpy();
    const spawnCalls = [];
    const spawn = (command, args, options) => {
      spawnCalls.push([command, ...args]);
      return childProcess.spawnSync(command, args, options);
    };

    const hyperclayVerified = verifyDocsApplication(hyperclay.record.applicationFile, { run, spawn });
    const websiteVerified = verifyDocsApplication(website.record.applicationFile, { run, spawn });

    expect(withoutApplicationFile(hyperclayVerified)).toEqual(withoutApplicationFile(hyperclay.record));
    expect(withoutApplicationFile(websiteVerified)).toEqual(withoutApplicationFile(website.record));
    expect(run.calls.filter(([command, sub]) => command === 'git' && VERIFY_FORBIDDEN_COMMANDS.includes(sub)))
      .toEqual([]);
    expect(spawnCalls.length).toBe(4);
    expect(spawnCalls.every(([command, sub]) => command === 'git' && sub === 'diff')).toBe(true);
    expect({ hyperclay: repoInventory(fixture.hyperclay), website: repoInventory(fixture.website) }).toEqual(repoBefore);
    expect({
      hyperclay: evidenceInventory(hyperclay.record),
      website: evidenceInventory(website.record)
    }).toEqual(evidenceBefore);
  });
});
