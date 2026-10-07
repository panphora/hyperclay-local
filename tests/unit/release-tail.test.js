// The desktop release tail composes the accepted size coordinator, the retained site
// attempt and the documentation updater into one recoverable finish step. Every
// fixture here is a real scratch repository under one owned temp root with an
// isolated Git config and owned local bare destinations, so no provider, installed
// Ferry, real Wrangler, registry, sibling checkout or release is touched. The
// deployment boundary is an offline local Node child; the site module still owns the
// live receipt, and every tail call runs under the one real release lock.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { finishReleaseTail } = require('../../scripts/release-tail');
const { persistPublication } = require('../../scripts/release-publication-write');
const { readPublicationEvidence } = require('../../scripts/release-publication');
const { readSizeEvidence } = require('../../scripts/release-size-evidence');
const { readSiteAttempt, readSiteEvidence } = require('../../scripts/release-site-evidence');
const { readCompletedTargetEvidence } = require('../../scripts/release-target-evidence');
const { withReleaseLock } = require('../../scripts/release-lock');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { reconcileReleaseSizes } = require('../../scripts/release-sizes');
const { prepareSiteAttempt, runSiteAttempt } = require('../../scripts/release-site');
const { attemptPaths } = require('../../scripts/release-docs-run');
const { updateExternalDocs } = require('../../scripts/update-external-docs');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(600000);

const VERSION = '1.29.0';
const OLD_VERSION = '1.28.0';
const DATE = '2026-01-02T03:04:05.678Z';
const DESKTOP_REPO = 'hyperclay-local';
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const REMOTE_REPO = 'fixture-owner/hyperclay-local';
const DOC_REPOS = ['hyperclay', 'hyperclay-website'];
const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_PATH = 'vault/DOCS/15 Hyperclay Local App.md';
const LLMS_PATH = 'public/llms.txt';
const REMOTE_VERBS = ['ls-remote', 'fetch', 'push'];
const OWNED_COMMANDS = ['git', 'tar'];
const CLOCK_START = '2026-02-03T04:05:06.000Z';

const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const RUN_ID = 456;
const WORKFLOW_ID = 12345;
const UPLOAD_JOB_ID = 4242;
const REQUESTED_AT = '2026-01-02T01:00:00.000Z';
const DEADLINE_AT = '2026-01-02T04:00:00.000Z';
const OBSERVED_AT = '2026-01-02T01:20:00.000Z';
const CREATED_AT = '2026-01-02T00:30:00.000Z';
const VERIFIED_AT = '2026-01-02T03:04:06.000Z';

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

const TMP_BASE = fs.realpathSync.native(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-tail-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');
const DEPLOY_CHILD = path.join(OWNER, 'deploy-child.js');

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

const localReader = createLocalGitReader();

function localDeps() {
  return { run: localReader.run, spawn: localReader.spawn, fs };
}

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

function gitBytes(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
}

function write(root, rel, body, mode) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode === undefined) fs.writeFileSync(file, body);
  else fs.writeFileSync(file, body, { mode });
  return file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readmeFixture(mb) {
  const lines = ['# HyperclayLocal ' + VERSION, '', 'Download the app for your platform:', ''];
  NAMES.forEach((name, index) => {
    lines.push(
      `   - **${LABELS[index]}**: [${name}](https://local.hyperclay.com/${name}) (${Number(mb[index]).toFixed(1)}MB)`
    );
  });
  lines.push('', 'Install and run the app.', '');
  return lines.join('\n');
}

function websiteFixture(mb) {
  const lines = [
    `<section class="section" id="downloads" data-version="${VERSION}">`,
    '  <ul class="dl-list">'
  ];
  NAMES.forEach((name, index) => {
    lines.push(
      `    <li class="dl-row" data-os="${OS_KEYS[index]}">`,
      `      <a class="dl-file" download href="https://local.hyperclay.com/${name}">${name}</a>`,
      `      <span class="dl-size">${Number(mb[index]).toFixed(1)} MB</span>`,
      '    </li>'
    );
  });
  lines.push('  </ul>', '</section>', '');
  return lines.join('\n');
}

function manifestFor(sourceSha, mb = MB_NEW) {
  const sizes = {};
  NAMES.forEach((name, index) => { sizes[name] = Math.round(mb[index] * 1024 * 1024); });
  return { version: VERSION, commit: sourceSha, date: DATE, files: NAMES.slice(), sizes };
}

function siteAttempt(sourceSha) {
  return {
    id: ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: WORKFLOW_ID,
    expectedTitle: `release v${VERSION} publish sha=${sourceSha} attempt=${ATTEMPT_ID}`,
    dispatch: 'identified',
    requestedAt: REQUESTED_AT,
    watchDeadlineAt: DEADLINE_AT,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: OBSERVED_AT,
    error: null
  };
}

function publicationProof(fixture, manifestSha256) {
  return {
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: ATTEMPT_ID,
    version: VERSION,
    mode: 'publish',
    sourceSha: fixture.sourceSha,
    manifestSha256,
    verifiedAt: VERIFIED_AT,
    run: {
      id: RUN_ID,
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      workflow_id: WORKFLOW_ID,
      display_title: fixture.attempt.expectedTitle,
      head_sha: fixture.sourceSha,
      run_attempt: 1,
      created_at: '2026-01-02T02:00:00Z',
      updated_at: '2026-01-02T02:30:00Z',
      repository: { full_name: REMOTE_REPO },
      html_url: `https://github.com/${REMOTE_REPO}/actions/runs/${RUN_ID}`
    },
    uploadJobsRequest: { runId: RUN_ID, runAttempt: 1 },
    uploadJob: { id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' }
  };
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function pendingSite() {
  return {
    state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
    receiptSha: null, verifiedAt: null, error: null
  };
}

function workflowState(fixture) {
  return {
    schema: 1,
    revision: 0,
    repo: fixture.identity,
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: CREATED_AT,
    updatedAt: OBSERVED_AT,
    versionIntent: null,
    sourceSha: fixture.sourceSha,
    activeAttemptId: ATTEMPT_ID,
    attempts: [fixture.attempt],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: pendingSite(),
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null
  };
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

function bodyOf(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
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

function fakeNpm(fixture, cwd, args) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('npm needs an absolute snapshot cwd');
  if (!owned(fixture, cwd)) throw new Error('npm cwd escaped the owned fixture');
  for (const root of fixture.siblingRoots.values()) {
    if (cwd === root || cwd.startsWith(`${root}${path.sep}`)) {
      throw new Error('npm was pointed at a live sibling checkout');
    }
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

function owned(fixture, value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.startsWith(OWNER + path.sep);
}

function confine(fixture, command, args, options) {
  if (!OWNED_COMMANDS.includes(command)) throw new Error(`acting must not run ${command}`);
  for (const value of args) {
    if (typeof value === 'string' && path.isAbsolute(value) && !owned(fixture, value)) {
      throw new Error(`${command} argument escaped the owned fixture: ${value}`);
    }
  }
  const cwd = options === undefined ? undefined : options.cwd;
  if (cwd !== undefined && !owned(fixture, cwd)) {
    throw new Error(`${command} ran outside the owned fixture: ${cwd}`);
  }
}

function makeFixture() {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++seq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remote-${++seq}-`));
  const bare = (name) => {
    const target = path.join(remoteDir, name);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', target]);
    return target;
  };

  const desktopRemote = bare(`${DESKTOP_REPO}.git`);
  const siblingRemotes = new Map();
  for (const repo of DOC_REPOS) siblingRemotes.set(repo, bare(`${repo}.git`));

  const repoRoot = path.join(parentDir, DESKTOP_REPO);
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['remote', 'add', 'origin', ORIGIN]);
  write(repoRoot, 'package.json', `${JSON.stringify({
    name: 'hyperclay-local-electron', version: VERSION, private: true
  }, null, 2)}\n`);
  write(repoRoot, 'README.md', readmeFixture(MB_OLD));
  write(repoRoot, 'website/index.html', websiteFixture(MB_OLD));
  write(repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG);
  write(repoRoot, 'website/.assetsignore', WEBSITE_IGNORE);
  write(repoRoot, 'website/assets/app-popover.png', BINARY_PNG);
  write(repoRoot, 'website/assets/open graph image.png', BINARY_FONT);
  write(repoRoot, 'website/assets/deep/nested/leaf.txt', 'leaf\n');
  write(repoRoot, 'website/fonts/DepartureMono-1.500/LICENSE', 'license\n');
  write(repoRoot, 'website/scripts/serve.sh', '#!/bin/sh\nexit 0\n', 0o755);
  write(repoRoot, 'src/app.js', 'module.exports = {};\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'release source']);

  const siblingRoots = new Map();
  for (const repo of DOC_REPOS) {
    const root = path.join(parentDir, repo);
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['remote', 'add', 'origin', siblingRemotes.get(repo)]);
    if (repo === 'hyperclay') {
      write(root, 'README.md', 'hyperclay readme\n');
      write(root, EDGE_PATH, edgeBody(OLD_VERSION));
    } else {
      write(root, VAULT_PATH, vaultBody(OLD_VERSION));
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
    siblingRoots.set(repo, root);
  }

  const sourceSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const identity = resolveRepoIdentity(repoRoot, { readGit: localReader.readGit, fs });
  const cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `cache-${++seq}-`)));
  const cacheRoot = path.join(cacheBase, 'releases');
  const fixture = {
    parentDir,
    remoteDir,
    repoRoot,
    desktopRemote,
    siblingRemotes,
    siblingRoots,
    sourceSha,
    identity,
    cacheBase,
    cacheRoot,
    repoDir: statePaths(identity, { cacheRoot, fs }).repoDir,
    attempt: siteAttempt(sourceSha),
    deployStatuses: [],
    now: clock(),
    randomUUID: uuidFactory(),
    reportFile: path.join(OWNER, `deploy-report-${++seq}.json`)
  };
  fixture.evidenceRoot = path.join(fixture.repoDir, 'records', RELEASE_ID);
  fixture.siteDir = path.join(fixture.evidenceRoot, 'site');
  fixture.docsRunDir = path.join(fixture.evidenceRoot, 'docs');
  return fixture;
}

function loadState(fixture) {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
}

function seedRemote(fixture, commit) {
  git(fixture.repoRoot, ['push', '-q', fixture.desktopRemote, `${commit}:refs/heads/main`]);
}

function remoteHead(fixture) {
  return git(fixture.remoteDir, ['--git-dir', fixture.desktopRemote, 'rev-parse', 'refs/heads/main']).trim();
}

async function publish(fixture) {
  const state = workflowState(fixture);
  writeReleaseState(state, fixture.identity, { cacheRoot: fixture.cacheRoot, expectedRevision: null, fs });
  const published = await withReleaseLock(fixture.identity, async () => {
    const manifestValue = manifestFor(fixture.sourceSha);
    const manifestBytes = Buffer.from(JSON.stringify(manifestValue), 'utf8');
    return persistPublication({
      state,
      repoDir: fixture.repoDir,
      observation: {
        manifestBytes,
        manifest: manifestValue,
        proof: publicationProof(fixture, sha256(manifestBytes))
      }
    }, { local: { fs }, wallNow: () => Date.parse(VERIFIED_AT) });
  }, { cacheRoot: fixture.cacheRoot });
  fixture.manifestFile = published.artifacts.manifestFile;
  fixture.manifestSha256 = published.artifacts.manifestSha256;
  fixture.published = published;
  return published;
}

function clock() {
  let current = Date.parse(CLOCK_START);
  return () => {
    current += 1000;
    return current;
  };
}

function uuidFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

function actingRun(fixture, log, hooks = {}) {
  return (command, args, options = {}) => {
    log.run.push({ command, args: args.slice(), cwd: options.cwd });
    if (typeof hooks.onRun === 'function') {
      const injected = hooks.onRun(command, args, options);
      if (injected !== undefined) return injected;
    }
    if (command === 'npm') return fakeNpm(fixture, options.cwd, args);
    confine(fixture, command, args, options);
    const { echoStdout, ...rest } = options;
    return childProcess.execFileSync(command, args, {
      encoding: 'utf8',
      ...rest,
      env: { ...GIT_ENV, ...(rest.env || {}) }
    });
  };
}

function actingSpawn(fixture, log) {
  return (command, args, options = {}) => {
    log.spawn.push({ command, args: args.slice(), cwd: options.cwd });
    if (command !== 'git') throw new Error(`unexpected acting spawn: ${command}`);
    confine(fixture, command, args, options);
    return childProcess.spawnSync(command, args, {
      ...options,
      env: { ...GIT_ENV, ...(options.env || {}) }
    });
  };
}

function remoteSpawn(fixture, log, overrides = {}) {
  return (command, args, options = {}) => {
    if (command !== 'git') throw new Error(`unexpected remote transport: ${command}`);
    if (!REMOTE_VERBS.includes(args[0])) throw new Error(`unexpected remote verb: ${args[0]}`);
    const tokens = args.filter((value) => value === ORIGIN);
    if (tokens.length > 1) throw new Error('the desktop origin token appeared more than once');
    const mapped = args.map((value) => (value === ORIGIN ? fixture.desktopRemote : value));
    const destinations = mapped.filter((value) => typeof value === 'string'
      && (path.isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith('git@')));
    if (destinations.length === 0) throw new Error(`remote transport without a destination: git ${args.join(' ')}`);
    for (const destination of destinations) {
      if (!owned(fixture, destination)) {
        throw new Error(`remote transport destination is not owned: ${destination}`);
      }
    }
    if (options.cwd !== undefined && !owned(fixture, options.cwd)) {
      throw new Error(`remote transport ran outside the owned fixture: ${options.cwd}`);
    }
    log.remote.push({ args: mapped.slice(), original: args.slice(), cwd: options.cwd });
    if (typeof overrides.onRemote === 'function') {
      const injected = overrides.onRemote(mapped, options);
      if (injected !== undefined) return injected;
    }
    return childProcess.spawnSync(command, mapped, {
      ...options,
      env: { ...GIT_ENV, ...(options.env || {}) }
    });
  };
}

function ferrySeam(log) {
  return async (root, callback, options) => {
    log.ferry.push({ root, options });
    return callback();
  };
}

function deployAdapter(fixture, log) {
  return (deployDir) => {
    log.deploy.push(deployDir);
    const state = loadState(fixture);
    const check = { site: state.site, attempt: null, error: null };
    try {
      check.attempt = readSiteAttempt({ state, repoDir: fixture.repoDir }, localDeps()).descriptor;
    } catch (error) {
      check.error = error;
    }
    log.deployChecks.push(check);
    const status = fixture.deployStatuses.length > 0 ? fixture.deployStatuses.shift() : 0;
    childProcess.execFileSync(process.execPath, [DEPLOY_CHILD, fixture.reportFile, String(status)], {
      cwd: deployDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...GIT_ENV }
    });
    return undefined;
  };
}

function harness(fixture, overrides = {}) {
  const log = {
    run: [], spawn: [], remote: [], ferry: [], guard: [], deploy: [], deployChecks: [], laneAtWebsite: []
  };
  const deps = {
    run: overrides.run === undefined ? actingRun(fixture, log, overrides) : overrides.run,
    spawn: overrides.spawn === undefined ? actingSpawn(fixture, log) : overrides.spawn,
    spawnRemote: overrides.spawnRemote === undefined ? remoteSpawn(fixture, log, overrides) : overrides.spawnRemote,
    fs: overrides.fs === undefined ? fs : overrides.fs,
    now: overrides.now === undefined ? fixture.now : overrides.now,
    randomUUID: overrides.randomUUID === undefined ? fixture.randomUUID : overrides.randomUUID,
    withFerryRepoLock: overrides.withFerryRepoLock === undefined ? ferrySeam(log) : overrides.withFerryRepoLock,
    ferryOptions: {},
    deploy: overrides.deploy === undefined ? deployAdapter(fixture, log) : overrides.deploy
  };
  if (overrides.assertPublishWindow === null) deps.assertPublishWindow = undefined;
  else if (overrides.assertPublishWindow !== undefined) deps.assertPublishWindow = overrides.assertPublishWindow;
  else deps.assertPublishWindow = () => { log.guard.push(true); };
  return { log, deps };
}

function runTail(fixture, state, h, options = {}) {
  const input = { state, repoDir: fixture.repoDir };
  if (options.retrySite !== undefined) input.retrySite = options.retrySite;
  return withReleaseLock(
    fixture.identity,
    () => finishReleaseTail(input, h.deps),
    { cacheRoot: fixture.cacheRoot }
  );
}

function refusingSeams(log) {
  const refuse = (label) => () => {
    log.calls.push(label);
    throw new Error(`${label} must not run`);
  };
  return {
    run: refuse('run'),
    spawn: refuse('spawn'),
    spawnRemote: refuse('spawnRemote'),
    now: refuse('now'),
    randomUUID: refuse('randomUUID'),
    withFerryRepoLock: refuse('ferry'),
    deploy: refuse('deploy'),
    assertPublishWindow: refuse('guard'),
    fs
  };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the release tail to reject');
}

function verbs(calls, names) {
  return calls.filter((call) => names.includes(call.args[0]));
}

describePosix('desktop tail native composition', () => {
  testPosix('finishes every target from retained evidence and replays the complete lane', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    const before = loadState(fixture);
    const sourceSha = before.sourceSha;

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { later: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'unrelated later source change']);
    const laterHead = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    expect(laterHead).not.toBe(sourceSha);
    seedRemote(fixture, laterHead);

    const websiteRoot = fixture.siblingRoots.get('hyperclay-website');
    const h = harness(fixture, {
      onRun: (command, args, options) => {
        if (command === 'git' && args[0] === 'commit-tree' && options.cwd === websiteRoot
          && h.log.laneAtWebsite.length === 0) {
          h.log.laneAtWebsite.push(loadState(fixture));
        }
        return undefined;
      }
    });

    const result = await runTail(fixture, before, h);

    expect(result.error).toBeNull();
    expect(result.state.phase).toBe('complete');
    expect(result.state.sourceSha).toBe(sourceSha);
    expect(result.state.revision).toBeGreaterThan(before.revision);

    const sizesCommit = result.state.sizes.commit;
    expect(result.state.sizes.state).toBe('complete');
    expect(sizesCommit).not.toBe(laterHead);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(sizesCommit);
    expect(remoteHead(fixture)).toBe(sizesCommit);
    expect(readSizeEvidence({ state: result.state, repoDir: fixture.repoDir }, localDeps()).commit).toBe(sizesCommit);

    expect(result.state.site.state).toBe('complete');
    expect(result.state.site.sourceSha).toBe(sizesCommit);
    expect(fs.readFileSync(path.join(fixture.repoRoot, '.deploy'), 'utf8')).toBe(`${sizesCommit}\n`);
    expect(readSiteEvidence({ state: result.state, repoDir: fixture.repoDir }, localDeps()).receiptSha).toBe(sizesCommit);

    const attemptDir = path.join(fixture.siteDir, result.state.site.attemptId);
    expect(h.log.deploy).toEqual([path.join(attemptDir, 'deploy')]);
    const report = readJson(fixture.reportFile);
    expect(report.cwd).toBe(path.join(attemptDir, 'deploy'));
    expect(report.index).toBe(sha256(gitBytes(fixture.repoRoot, ['show', `${sizesCommit}:website/index.html`])));
    expect(report.wrangler).toBe(sha256(gitBytes(fixture.repoRoot, ['show', `${sizesCommit}:website/wrangler.jsonc`])));

    expect(h.log.deployChecks.length).toBe(1);
    expect(h.log.deployChecks[0].error).toBeNull();
    expect(h.log.deployChecks[0].site.state).toBe('unknown');
    expect(h.log.deployChecks[0].site.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(h.log.deployChecks[0].attempt.phase).toBe('requested');

    for (const repo of DOC_REPOS) {
      const target = result.state.docs[repo];
      expect(target.state).toBe('complete');
      const proof = readCompletedTargetEvidence({
        journalFile: target.journalFile,
        evidenceRoot: fixture.evidenceRoot,
        repo,
        version: VERSION,
        commit: target.commit
      }, localDeps());
      expect(proof.observedHead.length).toBeGreaterThan(0);
      expect(proof.verifiedAt).toBeTruthy();
    }
    readPublicationEvidence({ state: result.state, repoDir: fixture.repoDir }, localDeps());

    expect(h.log.laneAtWebsite.length).toBe(1);
    expect(h.log.laneAtWebsite[0].docs.hyperclay.state).toBe('complete');
    expect(h.log.laneAtWebsite[0].docs['hyperclay-website'].state).toBe('pending');

    expect(h.log.run.length).toBeGreaterThan(0);
    expect(h.log.remote.length).toBeGreaterThan(0);
    expect(h.log.ferry.length).toBeGreaterThan(0);
    expect(h.log.guard.length).toBeGreaterThan(0);
    expect(h.log.run.some((call) => ['gh', 'npx', 'wrangler', 'node'].includes(call.command))).toBe(false);
    expect(h.log.run.some((call) => call.command === 'npm'
      && ['install', 'i', 'add', 'publish', 'pack'].includes(call.args[0]))).toBe(false);
    expect(h.log.run.some((call) => call.command === 'git' && call.args[0] === 'tag')).toBe(false);

    const complete = result.state;
    const revision = complete.revision;
    const historical = {
      sizes: complete.sizes.commit,
      hyperclay: complete.docs.hyperclay.commit,
      'hyperclay-website': complete.docs['hyperclay-website'].commit
    };

    write(fixture.repoRoot, 'src/app.js', 'module.exports = { replay: true };\n');
    git(fixture.repoRoot, ['add', '--', 'src/app.js']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'later replay source change']);
    fs.appendFileSync(path.join(fixture.repoRoot, 'README.md'), '\nDirty replay file\n');
    fs.writeFileSync(path.join(fixture.repoRoot, '.deploy'), `${'0'.repeat(40)}\n`);
    for (const repo of DOC_REPOS) {
      const root = fixture.siblingRoots.get(repo);
      const elsewhere = path.join(fixture.remoteDir, `${repo}-elsewhere.git`);
      git(fixture.remoteDir, ['init', '-q', '--bare', '-b', 'main', elsewhere]);
      fs.appendFileSync(path.join(root, repo === 'hyperclay' ? EDGE_PATH : VAULT_PATH), '\nDirty replay sibling\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'later sibling change']);
      git(root, ['remote', 'set-url', 'origin', elsewhere]);
    }

    const replayLog = { calls: [] };
    const replay = await withReleaseLock(fixture.identity, () => finishReleaseTail(
      { state: complete, repoDir: fixture.repoDir }, refusingSeams(replayLog)
    ), { cacheRoot: fixture.cacheRoot });

    expect(replay.error).toBeNull();
    expect(replay.state).toEqual(complete);
    expect(replay.state.revision).toBe(revision);
    expect(replay.state.sizes.commit).toBe(historical.sizes);
    expect(replay.state.docs.hyperclay.commit).toBe(historical.hyperclay);
    expect(replay.state.docs['hyperclay-website'].commit).toBe(historical['hyperclay-website']);
    expect(replayLog.calls).toEqual([]);

    const snapshotFile = path.join(attemptDir, 'snapshot', 'index.html');
    const pristine = fs.readFileSync(snapshotFile);
    fs.appendFileSync(snapshotFile, '\n');
    const corruptLog = { calls: [] };
    const corrupt = await rejection(withReleaseLock(fixture.identity, () => finishReleaseTail(
      { state: complete, repoDir: fixture.repoDir }, refusingSeams(corruptLog)
    ), { cacheRoot: fixture.cacheRoot }));
    expect(corrupt).toBeTruthy();
    expect(corruptLog.calls).toEqual([]);
    fs.writeFileSync(snapshotFile, pristine);
    expect(readSiteEvidence({ state: complete, repoDir: fixture.repoDir }, localDeps()).receiptSha).toBe(sizesCommit);
  });

  testPosix('keeps ordinary pending sizes separate from independently completed docs', async () => {
    const fixture = makeFixture();
    expect(() => fakeNpm(fixture, path.dirname(OWNER), ['run', 'sync-docs']))
      .toThrow(/escaped the owned fixture/);
    expect(() => fakeNpm(fixture, fixture.siblingRoots.get('hyperclay-website'), ['run', 'sync-docs']))
      .toThrow(/live sibling checkout/);
    await publish(fixture);
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);

    let injected = false;
    const h = harness(fixture, {
      onRemote: (mapped) => {
        if (!injected && mapped[0] === 'ls-remote' && mapped.includes(fixture.desktopRemote)) {
          injected = true;
          return { status: 1, signal: null, stdout: '', stderr: 'offline fixture transport\n' };
        }
        return undefined;
      }
    });

    const result = await runTail(fixture, before, h);

    expect(injected).toBe(true);
    expect(result.error).not.toBeNull();
    expect(result.error.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(result.state.sizes.state).toBe('pending-push');
    expect(result.state.sizes.commit).not.toBeNull();
    expect(result.state.sizes.reason.code).toBe('DOCS_REMOTE_UNREADABLE');
    expect(result.state.site).toEqual(before.site);
    expect(fs.existsSync(fixture.siteDir)).toBe(false);
    expect(h.log.deploy).toEqual([]);
    expect(h.log.remote.filter((entry) => entry.original.includes(ORIGIN)).map((entry) => entry.original[0]))
      .toEqual(['ls-remote']);
    expect(verbs(h.log.run.filter((call) => call.cwd === fixture.repoRoot), ['commit-tree']).length).toBe(1);

    for (const repo of DOC_REPOS) {
      expect(result.state.docs[repo].state).toBe('complete');
      expect(result.state.docs[repo].journalFile).not.toBeNull();
      expect(result.state.docs[repo].commit).not.toBeNull();
      readCompletedTargetEvidence({
        journalFile: result.state.docs[repo].journalFile,
        evidenceRoot: fixture.evidenceRoot,
        repo,
        version: VERSION,
        commit: result.state.docs[repo].commit
      }, localDeps());
    }
    expect(loadState(fixture)).toEqual(result.state);

    const sizeCommit = result.state.sizes.commit;
    const docsRun = path.join(fixture.docsRunDir, 'docs-run.json');
    const docsResult = path.join(fixture.docsRunDir, 'result.json');
    const runBytes = fs.readFileSync(docsRun);
    const resultBytes = fs.readFileSync(docsResult);

    for (const repo of DOC_REPOS) {
      const root = fixture.siblingRoots.get(repo);
      fs.appendFileSync(path.join(root, repo === 'hyperclay' ? EDGE_PATH : VAULT_PATH), '\nDirty completed sibling\n');
    }

    const resume = harness(fixture);
    const completed = await runTail(fixture, result.state, resume);

    expect(completed.error).toBeNull();
    expect(completed.state.phase).toBe('complete');
    expect(completed.state.sizes.state).toBe('complete');
    expect(completed.state.sizes.commit).toBe(sizeCommit);
    expect(completed.state.sourceSha).toBe(before.sourceSha);
    expect(verbs(resume.log.run, ['commit-tree'])).toEqual([]);
    expect(resume.log.remote.map((entry) => entry.original[0])).toEqual(['ls-remote', 'push', 'ls-remote']);
    expect(resume.log.remote.every((entry) => entry.original.includes(ORIGIN))).toBe(true);
    expect(resume.log.ferry.every((entry) => entry.root === fixture.repoRoot)).toBe(true);
    expect(resume.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(resume.log.run.some((call) => call.cwd !== undefined
      && [...fixture.siblingRoots.values()].some((root) => call.cwd === root || call.cwd.startsWith(`${root}${path.sep}`))))
      .toBe(false);
    expect(fs.readFileSync(docsRun).equals(runBytes)).toBe(true);
    expect(fs.readFileSync(docsResult).equals(resultBytes)).toBe(true);
    expect(completed.state.docs.hyperclay).toEqual(result.state.docs.hyperclay);
    expect(completed.state.docs['hyperclay-website']).toEqual(result.state.docs['hyperclay-website']);
    expect(fs.readFileSync(path.join(fixture.repoRoot, '.deploy'), 'utf8')).toBe(`${sizeCommit}\n`);
    expect(readSizeEvidence({ state: completed.state, repoDir: fixture.repoDir }, localDeps()).commit).toBe(sizeCommit);
  });

  testPosix('never repeats an ambiguous deployment without explicit authorization', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    const before = loadState(fixture);
    seedRemote(fixture, fixture.sourceSha);
    fixture.deployStatuses = [1, 1];

    const h = harness(fixture);
    const result = await runTail(fixture, before, h);

    expect(result.error).not.toBeNull();
    expect(result.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(result.state.sizes.state).toBe('complete');
    expect(result.state.site.state).toBe('unknown');
    expect(result.state.site.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(result.state.site.receiptSha).toBeNull();
    expect(result.state.site.verifiedAt).toBeNull();
    expect(h.log.deploy.length).toBe(1);
    const firstAttempt = result.state.site.attemptId;
    expect(firstAttempt).not.toBeNull();
    expect(fs.readFileSync(path.join(fixture.siteDir, firstAttempt, 'site.json'), 'utf8'))
      .toContain('"requested"');
    for (const repo of DOC_REPOS) {
      expect(result.state.docs[repo].state).toBe('complete');
      readCompletedTargetEvidence({
        journalFile: result.state.docs[repo].journalFile,
        evidenceRoot: fixture.evidenceRoot,
        repo,
        version: VERSION,
        commit: result.state.docs[repo].commit
      }, localDeps());
    }
    expect(h.log.deployChecks.length).toBe(1);
    expect(h.log.deployChecks[0].attempt.phase).toBe('requested');

    const observed = harness(fixture);
    const pending = await runTail(fixture, result.state, observed);

    expect(pending.error).not.toBeNull();
    expect(pending.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(pending.state).toEqual(result.state);
    expect(pending.state.site.attemptId).toBe(firstAttempt);
    expect(observed.log.deploy).toEqual([]);
    expect(fs.existsSync(path.join(fixture.repoRoot, '.deploy'))).toBe(false);

    const retried = harness(fixture);
    const attempt = await runTail(fixture, result.state, retried, { retrySite: true });

    expect(retried.log.deploy.length).toBe(1);
    expect(attempt.error).not.toBeNull();
    expect(attempt.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(attempt.state.site.state).toBe('unknown');
    const secondAttempt = attempt.state.site.attemptId;
    expect(secondAttempt).not.toBe(firstAttempt);
    expect(fs.existsSync(path.join(fixture.siteDir, firstAttempt))).toBe(true);
    expect(fs.existsSync(path.join(fixture.siteDir, secondAttempt))).toBe(true);
    expect(attempt.state.sourceSha).toBe(before.sourceSha);
    expect(attempt.state.version).toBe(VERSION);
    expect(attempt.state.sizes.commit).toBe(result.state.sizes.commit);
    expect(attempt.state.docs).toEqual(result.state.docs);

    const final = harness(fixture);
    const settled = await runTail(fixture, attempt.state, final);

    expect(final.log.deploy).toEqual([]);
    expect(settled.error).not.toBeNull();
    expect(settled.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(settled.state).toEqual(attempt.state);
    expect(settled.state.site.attemptId).toBe(secondAttempt);
    expect(settled.state.site.state).toBe('unknown');
    expect(readPublicationEvidence({ state: settled.state, repoDir: fixture.repoDir }, localDeps()).sourceSha)
      .toBe(before.sourceSha);
  });
});

function insideRoot(root, value) {
  return typeof value === 'string' && (value === root || value.startsWith(`${root}${path.sep}`));
}

function lanePredicate(fixture, matches) {
  const stateFile = statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs }).stateFile;
  return (from, to) => {
    if (to !== stateFile) return false;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(from, 'utf8'));
    } catch {
      return false;
    }
    return matches(payload);
  };
}

function faultFs(predicate, at) {
  const descriptors = new Map();
  let armed = null;
  return new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') {
        return (file, flags, mode) => {
          const fd = mode === undefined ? target.openSync(file, flags) : target.openSync(file, flags, mode);
          descriptors.set(fd, file);
          return fd;
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
          const hit = predicate(from, to);
          if (hit && at === 'rename') {
            throw Object.assign(new Error(`fixture refused to publish ${to}`), { code: 'EIO' });
          }
          if (hit) armed = path.dirname(to);
          return target.renameSync(from, to);
        };
      }
      if (property === 'fsyncSync') {
        return (fd) => {
          if (armed !== null && descriptors.get(fd) === armed) {
            const dir = armed;
            armed = null;
            throw Object.assign(new Error(`fixture refused to flush ${dir}`), { code: 'EIO' });
          }
          return target.fsyncSync(fd);
        };
      }
      return target[property];
    }
  });
}

function sizeDepsOf(h) {
  const d = h.deps;
  return {
    run: d.run, spawn: d.spawn, readRun: localReader.run, readSpawn: localReader.spawn,
    spawnRemote: d.spawnRemote, fs: d.fs, now: d.now, randomUUID: d.randomUUID,
    withFerryRepoLock: d.withFerryRepoLock, ferryOptions: d.ferryOptions,
    assertPublishWindow: d.assertPublishWindow
  };
}

function siteDepsOf(fixture, h, extra = {}) {
  return {
    run: h.deps.run, spawn: h.deps.spawn, fs: h.deps.fs,
    now: () => new Date(fixture.now()).toISOString(),
    ...extra
  };
}

function docsDepsOf(fixture, h) {
  const d = h.deps;
  return {
    repoRoot: fixture.repoRoot, cacheRoot: fixture.cacheRoot, fs: d.fs,
    readGit: (root, args) => localReader.run('git', args, { cwd: root }).trim(),
    run: d.run, spawn: d.spawn, spawnRemote: d.spawnRemote, now: d.now,
    randomUUID: d.randomUUID, assertPublishWindow: d.assertPublishWindow,
    withFerryRepoLock: d.withFerryRepoLock
  };
}

async function completeSizes(fixture, h) {
  const sizes = await withReleaseLock(fixture.identity, () => reconcileReleaseSizes(
    { state: loadState(fixture), repoDir: fixture.repoDir }, sizeDepsOf(h)
  ), { cacheRoot: fixture.cacheRoot });
  expect(sizes.error).toBeNull();
  expect(sizes.state.sizes.state).toBe('complete');
  return sizes.state;
}

async function prepareSite(fixture, h) {
  const prepared = await withReleaseLock(fixture.identity, () => prepareSiteAttempt(
    { state: loadState(fixture), repoDir: fixture.repoDir, attemptId: h.deps.randomUUID() },
    siteDepsOf(fixture, h)
  ), { cacheRoot: fixture.cacheRoot });
  expect(prepared.site.attemptId).not.toBeNull();
  return prepared;
}

async function completeSite(fixture, h) {
  await prepareSite(fixture, h);
  const complete = await withReleaseLock(fixture.identity, () => runSiteAttempt(
    { state: loadState(fixture), repoDir: fixture.repoDir },
    siteDepsOf(fixture, h, { deploy: h.deps.deploy, assertPublishWindow: h.deps.assertPublishWindow })
  ), { cacheRoot: fixture.cacheRoot });
  expect(complete.site.state).toBe('complete');
  return complete;
}

function runDocs(fixture, h, repo) {
  return withReleaseLock(fixture.identity, () => updateExternalDocs({
    version: VERSION,
    parentDir: path.dirname(fixture.repoRoot),
    runDir: fixture.docsRunDir,
    resultFile: path.join(fixture.docsRunDir, 'result.json'),
    targets: [repo]
  }, docsDepsOf(fixture, h)), { cacheRoot: fixture.cacheRoot });
}

function hyperclayRefusal(fixture, log) {
  const root = fixture.siblingRoots.get('hyperclay');
  const remote = fixture.siblingRemotes.get('hyperclay');
  const run = actingRun(fixture, log);
  const spawn = actingSpawn(fixture, log);
  const spawnRemote = remoteSpawn(fixture, log);
  return {
    run: (command, args, options = {}) => {
      const startup = command === 'git' && args[0] === 'rev-parse' && args[1] === '--git-common-dir';
      if (insideRoot(root, options.cwd) && !startup) {
        throw new Error(`hyperclay acting must not run: ${command} ${args.join(' ')}`);
      }
      return run(command, args, options);
    },
    spawn: (command, args, options = {}) => {
      if (insideRoot(root, options.cwd)) throw new Error(`hyperclay acting must not run: ${command}`);
      return spawn(command, args, options);
    },
    spawnRemote: (command, args, options = {}) => {
      const mapped = args.map((value) => (value === ORIGIN ? fixture.desktopRemote : value));
      if (mapped.includes(remote)) throw new Error('hyperclay remote transport must not run');
      return spawnRemote(command, args, options);
    }
  };
}

function siblingCalls(log, fixture, repo) {
  const root = fixture.siblingRoots.get(repo);
  return log.run.filter((call) => insideRoot(root, call.cwd));
}

function siblingStartupReads(log, fixture, repo) {
  return siblingCalls(log, fixture, repo).filter((call) => call.command === 'git'
    && call.args[0] === 'rev-parse' && call.args[1] === '--git-common-dir');
}

function resultReason(fixture, repo) {
  const result = readJson(path.join(fixture.docsRunDir, 'result.json'));
  return result.targets[DOC_REPOS.indexOf(repo)].reason;
}

function treeDigest(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.lstatSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      files.push([path.relative(root, file), sha256(fs.readFileSync(file))]);
    }
  };
  walk(root);
  return files;
}

function remoteMain(fixture, remote) {
  return git(fixture.remoteDir, ['--git-dir', remote, 'rev-parse', 'refs/heads/main']).trim();
}

function completeEvidence(fixture, state, repo) {
  const target = state.docs[repo];
  expect(target.state).toBe('complete');
  return readCompletedTargetEvidence({
    journalFile: target.journalFile,
    evidenceRoot: fixture.evidenceRoot,
    repo,
    version: VERSION,
    commit: target.commit
  }, localDeps());
}

describePosix('desktop tail recovery boundaries', () => {
  testPosix('rejects a fatal first size pointer write without starting later targets', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    const before = loadState(fixture);
    const h = harness(fixture, {
      fs: faultFs(lanePredicate(fixture, (payload) => payload.sizes.state === 'pending'
        && payload.sizes.journalFile !== null && payload.sizes.commit === null), 'rename')
    });

    const error = await rejection(runTail(fixture, before, h));

    expect(error.code).toBe('STATE_IO_FAILED');
    expect(error.cause.code).toBe('EIO');
    expect(loadState(fixture)).toEqual(before);
    expect(fs.existsSync(fixture.siteDir)).toBe(false);
    expect(fs.existsSync(fixture.docsRunDir)).toBe(false);
    expect(h.log.deploy).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(h.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(verbs(h.log.run, ['commit-tree', 'update-ref', 'push'])).toEqual([]);
    expect(siblingCalls(h.log, fixture, 'hyperclay')).toEqual([]);
    expect(siblingCalls(h.log, fixture, 'hyperclay-website')).toEqual([]);
  });

  testPosix('rejects a fatal site checkpoint and a nested fatal deploy cause without starting docs', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    seedRemote(fixture, fixture.sourceSha);
    const setup = harness(fixture);
    await completeSizes(fixture, setup);
    await prepareSite(fixture, setup);
    const before = loadState(fixture);
    expect(before.site.state).toBe('pending');
    expect(before.sizes.state).toBe('complete');

    const h = harness(fixture, {
      fs: faultFs(lanePredicate(fixture, (payload) => payload.site.state === 'unknown'), 'rename')
    });
    const error = await rejection(runTail(fixture, before, h));

    expect(error.code).toBe('SITE_ATTEMPT_FAILED');
    expect(error.cause.code).toBe('STATE_IO_FAILED');
    expect(loadState(fixture)).toEqual(before);
    expect(readSiteAttempt({ state: before, repoDir: fixture.repoDir }, localDeps()).descriptor.phase)
      .toBe('requested');
    expect(h.log.deploy).toEqual([]);
    expect(fs.existsSync(fixture.docsRunDir)).toBe(false);
    expect(h.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(siblingCalls(h.log, fixture, 'hyperclay')).toEqual([]);
    expect(siblingCalls(h.log, fixture, 'hyperclay-website')).toEqual([]);
    expect(readSizeEvidence({ state: before, repoDir: fixture.repoDir }, localDeps()).commit)
      .toBe(before.sizes.commit);

    const second = makeFixture();
    await publish(second);
    seedRemote(second, second.sourceSha);
    const setup2 = harness(second);
    await completeSizes(second, setup2);
    await prepareSite(second, setup2);
    const before2 = loadState(second);
    const injected = Object.assign(new Error('offline provider refused the fixture deployment'),
      { code: 'STATE_IO_FAILED' });
    const h2 = harness(second, {
      deploy: (deployDir) => {
        h2.log.deploy.push(deployDir);
        throw injected;
      }
    });

    const error2 = await rejection(runTail(second, before2, h2));

    expect(error2.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(error2.cause).toBe(injected);
    expect(error2.cause.code).toBe('STATE_IO_FAILED');
    expect(h2.log.deploy.length).toBe(1);
    const after2 = loadState(second);
    expect(after2.site.state).toBe('unknown');
    expect(after2.site.error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(after2.site.receiptSha).toBeNull();
    expect(after2.site.verifiedAt).toBeNull();
    expect(after2.docs).toEqual(before2.docs);
    expect(readSiteAttempt({ state: after2, repoDir: second.repoDir }, localDeps()).descriptor.phase)
      .toBe('requested');
    expect(fs.existsSync(second.docsRunDir)).toBe(false);
    expect(h2.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(siblingCalls(h2.log, second, 'hyperclay')).toEqual([]);
    expect(siblingCalls(h2.log, second, 'hyperclay-website')).toEqual([]);
  });

  testPosix('rejects actual preparation refusals without starting the website target', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    seedRemote(fixture, fixture.sourceSha);
    const setup = harness(fixture);
    await completeSizes(fixture, setup);
    await completeSite(fixture, setup);
    const before = loadState(fixture);
    expect(before.sizes.state).toBe('complete');
    expect(before.site.state).toBe('complete');

    const hyperclayRoot = fixture.siblingRoots.get('hyperclay');
    fs.rmSync(path.join(hyperclayRoot, EDGE_PATH));

    const h = harness(fixture);
    const error = await rejection(runTail(fixture, before, h));

    expect(error.code).toBe('DOCS_PREPARE_FAILED');
    expect(error.message).toMatch(/pending changes/);
    expect(resultReason(fixture, 'hyperclay')).toMatchObject({ code: 'DOCS_PREPARE_FAILED' });
    expect(resultReason(fixture, 'hyperclay').message).toMatch(/pending changes/);
    expect(resultReason(fixture, 'hyperclay-website').code).toBe('DOCS_NOT_ATTEMPTED');
    const websiteReads = siblingStartupReads(h.log, fixture, 'hyperclay-website');
    expect(websiteReads.length).toBe(1);
    expect(siblingCalls(h.log, fixture, 'hyperclay-website')).toEqual(websiteReads);
    expect(h.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(h.log.remote).toEqual([]);
    expect(h.log.deploy).toEqual([]);

    git(hyperclayRoot, ['checkout', '--', EDGE_PATH]);
    expect(git(hyperclayRoot, ['status', '--porcelain']).trim()).toBe('');
    git(hyperclayRoot, ['checkout', '-q', '--detach']);

    const h2 = harness(fixture);
    const error2 = await rejection(runTail(fixture, loadState(fixture), h2));

    expect(error2.code).toBe('DOCS_PREPARE_FAILED');
    expect(error2.message).toMatch(/main is required/);
    expect(resultReason(fixture, 'hyperclay')).toMatchObject({ code: 'DOCS_PREPARE_FAILED' });
    expect(resultReason(fixture, 'hyperclay').message).toMatch(/main is required/);
    const websiteReads2 = siblingStartupReads(h2.log, fixture, 'hyperclay-website');
    expect(websiteReads2.length).toBe(1);
    expect(siblingCalls(h2.log, fixture, 'hyperclay-website')).toEqual(websiteReads2);
    expect(h2.log.run.some((call) => call.command === 'npm')).toBe(false);
    expect(h2.log.remote).toEqual([]);
    expect(h2.log.deploy).toEqual([]);

    const after = loadState(fixture);
    expect(after.phase).toBe('tail');
    expect(after.docs).toEqual(before.docs);
    expect(after.sizes).toEqual(before.sizes);
    expect(after.site).toEqual(before.site);
    expect(readSizeEvidence({ state: after, repoDir: fixture.repoDir }, localDeps()).commit)
      .toBe(before.sizes.commit);
    expect(readSiteEvidence({ state: after, repoDir: fixture.repoDir }, localDeps()).receiptSha)
      .toBe(before.site.receiptSha);
  });

  testPosix('rejects a retained docs journal binding contradiction before the actor', async () => {
    const fixture = makeFixture();
    await publish(fixture);
    seedRemote(fixture, fixture.sourceSha);
    const setup = harness(fixture);
    await completeSizes(fixture, setup);
    await completeSite(fixture, setup);
    const before = loadState(fixture);

    const docs = await runDocs(fixture, setup, 'hyperclay');
    expect(docs.targets[0].state).toBe('complete');
    const runFile = path.join(fixture.docsRunDir, 'docs-run.json');
    const run = readJson(runFile);
    const attemptId = run.targets[0].attemptId;
    expect(attemptId).not.toBeNull();
    expect(run.targets[1].attemptId).toBeNull();
    const journalFile = attemptPaths(fixture.docsRunDir, 'hyperclay', attemptId).journalFile;
    const journal = readJson(journalFile);
    expect(journal.state).toBe('complete');
    expect(run.targets[0].journalOperationId).toBe(journal.operationId);
    expect(loadState(fixture).docs.hyperclay.journalFile).toBeNull();

    const laneBefore = loadState(fixture);
    const originalRun = fs.readFileSync(runFile, 'utf8');

    run.targets[0].journalOperationId = '11111111-1111-4111-8111-111111111111';
    fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
    const evidenceBefore = treeDigest(fixture.evidenceRoot);

    const h = harness(fixture);
    const error = await rejection(runTail(fixture, laneBefore, h));

    expect(error.code).toBe('RELEASE_TAIL_INVALID');
    expect(error.message).toMatch(/does not match its selected run slot/);
    expect(h.log.run).toEqual([]);
    expect(h.log.remote).toEqual([]);
    expect(h.log.deploy).toEqual([]);
    expect(loadState(fixture)).toEqual(laneBefore);
    expect(loadState(fixture).phase).toBe('tail');
    expect(treeDigest(fixture.evidenceRoot)).toEqual(evidenceBefore);

    fs.writeFileSync(runFile, originalRun);
    expect(readJson(runFile).targets[0].journalOperationId).toBe(journal.operationId);
    fs.rmSync(journalFile);

    const h2 = harness(fixture);
    const error2 = await rejection(runTail(fixture, laneBefore, h2));

    expect(error2.code).toBe('RELEASE_TAIL_INVALID');
    expect(error2.message).toMatch(/lost its journal/);
    expect(h2.log.run).toEqual([]);
    expect(h2.log.remote).toEqual([]);
    expect(h2.log.deploy).toEqual([]);
    expect(loadState(fixture)).toEqual(laneBefore);
    expect(fs.existsSync(journalFile)).toBe(false);
    expect(fs.readdirSync(path.join(fixture.docsRunDir, 'attempts', 'hyperclay'))).toEqual([attemptId]);
  });

  testPosix('fails the first docs checkpoint on both sides of the pointer rename and reuses the retained work',
    async () => {
      const fixture = makeFixture();
      await publish(fixture);
      const before = loadState(fixture);
      seedRemote(fixture, fixture.sourceSha);

      const h = harness(fixture, {
        fs: faultFs(lanePredicate(fixture, (payload) => payload.docs.hyperclay.state === 'complete'), 'rename')
      });
      const error = await rejection(runTail(fixture, before, h));

      expect(error.code).toBe('STATE_IO_FAILED');
      const interrupted = loadState(fixture);
      expect(interrupted.docs).toEqual(before.docs);
      expect(interrupted.sizes.state).toBe('complete');
      expect(interrupted.site.state).toBe('complete');
      expect(interrupted.phase).toBe('tail');
      expect(h.log.deploy.length).toBe(1);

      const runFile = path.join(fixture.docsRunDir, 'docs-run.json');
      const run = readJson(runFile);
      const attemptId = run.targets[0].attemptId;
      expect(attemptId).not.toBeNull();
      expect(run.targets[0].journalOperationId).not.toBeNull();
      expect(run.targets[1].attemptId).toBeNull();
      expect(fs.existsSync(path.join(fixture.docsRunDir, 'attempts', 'hyperclay-website'))).toBe(false);
      expect(h.log.run.some((call) => call.command === 'npm')).toBe(false);
      const websiteReads = siblingStartupReads(h.log, fixture, 'hyperclay-website');
      expect(websiteReads.length).toBe(1);
      expect(siblingCalls(h.log, fixture, 'hyperclay-website')).toEqual(websiteReads);
      expect(siblingCalls(h.log, fixture, 'hyperclay').length).toBeGreaterThan(0);

      const journalFile = attemptPaths(fixture.docsRunDir, 'hyperclay', attemptId).journalFile;
      const journal = readJson(journalFile);
      expect(journal.state).toBe('complete');
      expect(journal.operationId).toBe(run.targets[0].journalOperationId);
      const oldCommit = journal.commit;
      const hyperclayRemote = fixture.siblingRemotes.get('hyperclay');
      expect(remoteMain(fixture, hyperclayRemote)).toBe(oldCommit);
      expect(readCompletedTargetEvidence({
        journalFile, evidenceRoot: fixture.evidenceRoot, repo: 'hyperclay', version: VERSION, commit: oldCommit
      }, localDeps()).observedHead).toBe(oldCommit);

      const hyperclayRoot = fixture.siblingRoots.get('hyperclay');
      write(hyperclayRoot, 'README.md', 'hyperclay readme\nlater\n');
      git(hyperclayRoot, ['add', '--', 'README.md']);
      git(hyperclayRoot, ['commit', '-q', '-m', 'later hyperclay change']);
      fs.appendFileSync(path.join(hyperclayRoot, EDGE_PATH), '\nDirty after the interrupted checkpoint\n');

      const h2 = harness(fixture, {
        fs: faultFs(lanePredicate(fixture, (payload) => payload.docs.hyperclay.state === 'complete'), 'fsync')
      });
      const error2 = await rejection(runTail(fixture, interrupted, h2));

      expect(error2.code).toBe('STATE_IO_FAILED');
      const renamed = loadState(fixture);
      expect(renamed.docs.hyperclay.state).toBe('complete');
      expect(renamed.docs.hyperclay.journalFile).toBe(journalFile);
      expect(renamed.docs.hyperclay.commit).toBe(oldCommit);
      expect(renamed.docs['hyperclay-website']).toEqual(before.docs['hyperclay-website']);
      expect(h2.log.deploy).toEqual([]);
      expect(h2.log.run.some((call) => call.command === 'npm')).toBe(false);
      expect(siblingCalls(h2.log, fixture, 'hyperclay-website')).toEqual([]);
      expect(fs.existsSync(path.join(fixture.docsRunDir, 'attempts', 'hyperclay-website'))).toBe(false);

      const h3 = harness(fixture);
      const refusal = hyperclayRefusal(fixture, h3.log);
      h3.deps.run = refusal.run;
      h3.deps.spawn = refusal.spawn;
      h3.deps.spawnRemote = refusal.spawnRemote;

      const result = await runTail(fixture, renamed, h3);

      expect(result.error).toBeNull();
      expect(result.state.phase).toBe('complete');
      expect(result.state.sourceSha).toBe(before.sourceSha);
      expect(result.state.sizes.commit).toBe(interrupted.sizes.commit);
      expect(result.state.site).toEqual(renamed.site);
      expect(result.state.docs.hyperclay.state).toBe('complete');
      expect(result.state.docs.hyperclay.commit).toBe(oldCommit);
      expect(result.state.docs.hyperclay.journalFile).toBe(journalFile);
      expect(remoteMain(fixture, hyperclayRemote)).toBe(oldCommit);
      expect(h3.log.deploy).toEqual([]);

      const hyperclayCalls = siblingCalls(h3.log, fixture, 'hyperclay');
      expect(hyperclayCalls.length).toBeGreaterThan(0);
      expect(hyperclayCalls.every((call) => call.command === 'git' && call.args[0] === 'rev-parse'
        && call.args[1] === '--git-common-dir')).toBe(true);
      expect(h3.log.remote.some((entry) => entry.args.includes(hyperclayRemote))).toBe(false);
      expect(h3.log.run.some((call) => call.command === 'npm')).toBe(true);

      const website = completeEvidence(fixture, result.state, 'hyperclay-website');
      expect(website.observedHead).toBe(result.state.docs['hyperclay-website'].commit);
      expect(remoteMain(fixture, fixture.siblingRemotes.get('hyperclay-website')))
        .toBe(result.state.docs['hyperclay-website'].commit);
      completeEvidence(fixture, result.state, 'hyperclay');
      expect(loadState(fixture)).toEqual(result.state);
    });
});
