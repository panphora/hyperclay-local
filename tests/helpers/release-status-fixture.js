// One real, complete desktop release bundle built by the accepted producers: a
// retained publication, a completed size target, a completed site attempt and two
// completed documentation targets, all under one owned temp root with an isolated
// Git config and local bare push destinations. Nothing here is a stub of a reader
// or a hand-written journal: the state records and the retained evidence are what
// the real writers actually produced, so `readStatus` is asked to verify them.
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs, prepareDownloadSizes } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const {
  prepareCommitIntent, applyPreparedTarget, reconcileTargetPush
} = require('../../scripts/release-docs-apply');
const { persistPublication } = require('../../scripts/release-publication-write');
const { withReleaseLock } = require('../../scripts/release-lock');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { execFileCaptured } = require('../../scripts/release-command');
const { prepareSiteAttempt, runSiteAttempt } = require('../../scripts/release-site');

const VERSION = '1.29.0';
const OLD_VERSION = '1.28.0';
const DATE = '2026-01-02T03:04:05.678Z';
const DESKTOP_REPO = 'hyperclay-local';
const DOC_REPOS = ['hyperclay', 'hyperclay-website'];
const SIZE_MESSAGE = `Update desktop download sizes for v${VERSION}`;
const DOCS_MESSAGE = `chore: update Hyperclay Local download links to v${VERSION}`;
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const REMOTE_REPO = 'fixture-owner/hyperclay-local';

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
const NOW = '2026-02-03T04:05:06.000Z';
const NOW_2 = '2026-02-03T05:00:00.000Z';
const NOW_3 = '2026-02-03T06:00:00.000Z';
const NOW_4 = '2026-02-03T07:00:00.000Z';
const NOW_5 = '2026-02-03T08:00:00.000Z';

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

const EDGE_PATH = 'server-pages/hyperclay-local.edge';
const VAULT_NAME = '15 Hyperclay Local App.md';
const VAULT_PATH = `vault/DOCS/${VAULT_NAME}`;
const LLMS_PATH = 'public/llms.txt';
const PLATFORM_VAULT = ['---', 'title: Platform', '---', '', 'Platform notes.', ''].join('\n');

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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function createBundle() {
  const base = fs.realpathSync.native(os.tmpdir());
  const owner = fs.mkdtempSync(path.join(base, 'hc-release-status-'));
  const noHooks = path.join(owner, 'no-hooks');
  const gitConfig = path.join(owner, 'gitconfig');
  const parentDir = path.join(owner, 'parent');
  const remoteDir = path.join(owner, 'remotes');

  fs.mkdirSync(noHooks, { recursive: true });
  fs.mkdirSync(parentDir, { recursive: true });
  fs.mkdirSync(remoteDir, { recursive: true });
  fs.writeFileSync(gitConfig, [
    '[user]',
    '\tname = Fixture',
    '\temail = fixture@example.com',
    '[init]',
    '\tdefaultBranch = main',
    '[commit]',
    '\tgpgsign = false',
    '[core]',
    `\thooksPath = ${JSON.stringify(noHooks.replace(/\\/g, '/'))}`,
    '\tautocrlf = false',
    ''
  ].join('\n'));

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_OPTIONAL_LOCKS: '0'
  };
  const git = (cwd, args, options = {}) => {
    const { env, ...rest } = options;
    return childProcess.execFileSync('git', args, {
      cwd, encoding: 'utf8', ...rest, env: { ...gitEnv, ...(env || {}) }
    });
  };
  const write = (root, rel, body, mode) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (mode === undefined) fs.writeFileSync(file, body);
    else fs.writeFileSync(file, body, { mode });
    return file;
  };

  const remotes = new Map();
  for (const repo of [DESKTOP_REPO, ...DOC_REPOS]) {
    const push = path.join(remoteDir, `${repo}.git`);
    const fetch = path.join(remoteDir, `${repo}-fetch.git`);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', push]);
    git(remoteDir, ['init', '-q', '--bare', '-b', 'main', fetch]);
    remotes.set(repo, { push, fetch });
  }

  const desktopRoot = path.join(parentDir, DESKTOP_REPO);
  fs.mkdirSync(desktopRoot, { recursive: true });
  git(desktopRoot, ['init', '-q', '-b', 'main']);
  git(desktopRoot, ['remote', 'add', 'origin', ORIGIN]);
  write(desktopRoot, 'package.json', `${JSON.stringify({
    name: 'hyperclay-local-electron', version: VERSION, private: true
  }, null, 2)}\n`);
  write(desktopRoot, 'README.md', readmeFixture(MB_OLD));
  write(desktopRoot, 'website/index.html', websiteFixture(MB_OLD));
  write(desktopRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG);
  write(desktopRoot, 'website/.assetsignore', WEBSITE_IGNORE);
  write(desktopRoot, 'website/assets/app-popover.png', BINARY_PNG);
  write(desktopRoot, 'website/assets/open graph image.png', BINARY_FONT);
  write(desktopRoot, 'website/assets/deep/nested/leaf.txt', 'leaf\n');
  write(desktopRoot, 'website/fonts/DepartureMono-1.500/LICENSE', 'license\n');
  write(desktopRoot, 'website/scripts/serve.sh', '#!/bin/sh\nexit 0\n', 0o755);
  write(desktopRoot, 'src/app.js', 'module.exports = {};\n');
  git(desktopRoot, ['add', '-A']);
  git(desktopRoot, ['commit', '-q', '-m', 'release source']);
  const sourceSha = git(desktopRoot, ['rev-parse', 'HEAD']).trim();

  const hyperclayRoot = path.join(parentDir, 'hyperclay');
  fs.mkdirSync(hyperclayRoot, { recursive: true });
  git(hyperclayRoot, ['init', '-q', '-b', 'main']);
  git(hyperclayRoot, ['remote', 'add', 'origin', remotes.get('hyperclay').fetch]);
  git(hyperclayRoot, ['remote', 'set-url', '--push', 'origin', remotes.get('hyperclay').push]);
  write(hyperclayRoot, 'README.md', 'hyperclay readme\n');
  write(hyperclayRoot, 'src/app.js', 'module.exports = {};\n');
  write(hyperclayRoot, EDGE_PATH, edgeBody(OLD_VERSION));
  git(hyperclayRoot, ['add', '-A']);
  git(hyperclayRoot, ['commit', '-q', '-m', 'fixture']);
  git(hyperclayRoot, ['push', '-q', 'origin', 'main']);

  const websiteRoot = path.join(parentDir, 'hyperclay-website');
  fs.mkdirSync(websiteRoot, { recursive: true });
  git(websiteRoot, ['init', '-q', '-b', 'main']);
  git(websiteRoot, ['remote', 'add', 'origin', remotes.get('hyperclay-website').fetch]);
  git(websiteRoot, ['remote', 'set-url', '--push', 'origin', remotes.get('hyperclay-website').push]);
  write(websiteRoot, VAULT_PATH, vaultBody(OLD_VERSION));
  write(websiteRoot, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
  write(websiteRoot, 'package.json', `${JSON.stringify({
    name: 'hyperclay-website',
    version: '0.0.0',
    scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
  }, null, 2)}\n`);
  const canonicalSyncDocs = (cwd) => {
    const vaultDir = path.join(cwd, 'vault/DOCS');
    for (const name of fs.readdirSync(vaultDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const title = name.replace(/^\d+\s+/, '').replace(/\.md$/, '');
      write(cwd, `content/docs/${cleanName(name)}.mdx`,
        `---\ntitle: ${title}\npublish: true\n---\n\n${bodyOf(fs.readFileSync(path.join(vaultDir, name), 'utf8'))}`);
    }
  };
  const canonicalLlmsTxt = (cwd) => {
    const docsDir = path.join(cwd, 'content/docs');
    const blocks = fs.readdirSync(docsDir)
      .filter((name) => name.endsWith('.mdx'))
      .sort()
      .map((name) => `## ${name.replace(/\.mdx$/, '')}\n\n${bodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8'))}`);
    write(cwd, LLMS_PATH, blocks.join('\n---\n\n'));
  };
  canonicalSyncDocs(websiteRoot);
  canonicalLlmsTxt(websiteRoot);
  git(websiteRoot, ['add', '-A']);
  git(websiteRoot, ['commit', '-q', '-m', 'fixture']);
  git(websiteRoot, ['push', '-q', 'origin', 'main']);

  const identity = resolveRepoIdentity(desktopRoot, { readGit: createLocalGitReader().readGit, fs });
  const cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(owner, 'cache-')));
  const cacheRoot = path.join(cacheBase, 'releases');
  const repoDir = statePaths(identity, { cacheRoot, fs }).repoDir;

  const attempt = {
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

  const pendingTarget = () => ({ state: 'pending', journalFile: null, commit: null, reason: null });
  const state = {
    schema: 1,
    revision: 0,
    repo: identity,
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: CREATED_AT,
    updatedAt: OBSERVED_AT,
    versionIntent: null,
    sourceSha,
    activeAttemptId: ATTEMPT_ID,
    attempts: [attempt],
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

  return {
    owner,
    gitEnv,
    git,
    write,
    parentDir,
    remoteDir,
    remotes,
    desktopRoot,
    hyperclayRoot,
    websiteRoot,
    identity,
    cacheBase,
    cacheRoot,
    repoDir,
    sourceSha,
    attempt,
    state,
    releaseId: RELEASE_ID,
    attemptId: ATTEMPT_ID
  };
}

module.exports = {
  VERSION, OLD_VERSION, DATE, DESKTOP_REPO, DOC_REPOS, SIZE_MESSAGE, DOCS_MESSAGE,
  ORIGIN, REMOTE_REPO, RELEASE_ID, ATTEMPT_ID, RUN_ID, WORKFLOW_ID, UPLOAD_JOB_ID,
  REQUESTED_AT, DEADLINE_AT, OBSERVED_AT, CREATED_AT, VERIFIED_AT,
  NOW, NOW_2, NOW_3, NOW_4, NOW_5,
  NAMES, LABELS, OS_KEYS, MB_OLD, MB_NEW, EDGE_PATH, VAULT_PATH, LLMS_PATH,
  sha256, createBundle, manifestFor, readmeFixture, websiteFixture
};

function publicationProof(bundle, manifestSha256) {
  return {
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: ATTEMPT_ID,
    version: VERSION,
    mode: 'publish',
    sourceSha: bundle.sourceSha,
    manifestSha256,
    verifiedAt: VERIFIED_AT,
    run: {
      id: RUN_ID,
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      workflow_id: WORKFLOW_ID,
      display_title: bundle.attempt.expectedTitle,
      head_sha: bundle.sourceSha,
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

function actingDeps(bundle, options = {}) {
  const run = (command, args, opts = {}) => execFileCaptured(command, args, {
    ...opts,
    env: { ...bundle.gitEnv, ...(opts.env || {}) }
  });
  const spawnRemote = (command, args, spawnOptions = {}) => childProcess.spawnSync(command, args, {
    ...spawnOptions,
    env: { ...bundle.gitEnv, ...(spawnOptions.env || {}) }
  });
  return {
    run,
    spawn: createLocalGitReader().spawn,
    spawnRemote,
    fs,
    cacheRoot: bundle.cacheRoot,
    now: () => Date.parse(options.now || NOW),
    assertPublishWindow: () => {},
    withFerryRepoLock: async (root, callback) => callback()
  };
}

function siteDeps(bundle, options = {}) {
  const reader = createLocalGitReader();
  const deps = {
    run: reader.run,
    spawn: reader.spawn,
    fs,
    now: () => options.now || NOW,
    assertPublishWindow: () => {}
  };
  if (options.deploy !== undefined) deps.deploy = options.deploy;
  return deps;
}

function makeNpmRun(liveWebsite) {
  const canonicalSyncDocs = (cwd) => {
    const vaultDir = path.join(cwd, 'vault/DOCS');
    for (const name of fs.readdirSync(vaultDir).sort()) {
      if (!name.endsWith('.md')) continue;
      const title = name.replace(/^\d+\s+/, '').replace(/\.md$/, '');
      const file = path.join(cwd, `content/docs/${cleanName(name)}.mdx`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file,
        `---\ntitle: ${title}\npublish: true\n---\n\n${bodyOf(fs.readFileSync(path.join(vaultDir, name), 'utf8'))}`);
    }
  };
  const canonicalLlmsTxt = (cwd) => {
    const docsDir = path.join(cwd, 'content/docs');
    const blocks = fs.readdirSync(docsDir)
      .filter((name) => name.endsWith('.mdx'))
      .sort()
      .map((name) => `## ${name.replace(/\.mdx$/, '')}\n\n${bodyOf(fs.readFileSync(path.join(docsDir, name), 'utf8'))}`);
    fs.mkdirSync(path.dirname(path.join(cwd, LLMS_PATH)), { recursive: true });
    fs.writeFileSync(path.join(cwd, LLMS_PATH), blocks.join('\n---\n\n'));
  };
  return (command, args, options = {}) => {
    if (command !== 'npm') return execFileCaptured(command, args, options);
    const cwd = options.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('npm needs an absolute snapshot cwd');
    if (cwd === liveWebsite || cwd.startsWith(`${liveWebsite}${path.sep}`)) {
      throw new Error('npm was pointed at the live website');
    }
    const [sub, script] = args;
    if (sub === 'ci') return '';
    if (sub === 'run' && script === 'sync-docs') { canonicalSyncDocs(cwd); return ''; }
    if (sub === 'run' && script === 'build:llms-txt') { canonicalLlmsTxt(cwd); return ''; }
    throw new Error(`unexpected npm command: ${args.join(' ')}`);
  };
}

function prepareSizesTarget(bundle, publication) {
  const sizesRoot = path.join(bundle.repoDir, 'records', RELEASE_ID, 'sizes');
  fs.mkdirSync(sizesRoot, { recursive: true });
  const runDir = path.join(sizesRoot, 'run-1');
  const outDir = path.join(sizesRoot, 'out-1');
  const prepared = prepareDownloadSizes({
    version: VERSION, parentDir: bundle.parentDir, runDir, publication
  }, {
    run: (command, args, options = {}) => {
      if (command === 'npm') throw new Error('size preparation must not run npm');
      return childProcess.execFileSync(command, args, { encoding: 'utf8', env: bundle.gitEnv, ...options });
    }
  });
  const record = prepareDocsApplication({
    preparedFile: path.join(runDir, 'prepared.json'),
    repo: DESKTOP_REPO,
    parentDir: bundle.parentDir,
    version: VERSION,
    outDir
  }, { run: actingDeps(bundle).run });
  return { runDir, outDir, publication, prepared, record, journalFile: path.join(outDir, 'target.json') };
}

async function completeTarget(bundle, input) {
  const deps = actingDeps(bundle);
  await prepareCommitIntent({
    applicationFile: input.applicationFile, journalFile: input.journalFile, message: input.message
  }, deps);
  await applyPreparedTarget({ journalFile: input.journalFile }, deps);
  return reconcileTargetPush({ journalFile: input.journalFile }, deps);
}

async function completeBundle(bundle) {
  const manifestValue = manifestFor(bundle.sourceSha);
  const manifestBytes = Buffer.from(JSON.stringify(manifestValue), 'utf8');
  writeReleaseState(bundle.state, bundle.identity, {
    cacheRoot: bundle.cacheRoot, expectedRevision: null, fs
  });
  const published = await withReleaseLock(bundle.identity, async () => persistPublication({
    state: bundle.state,
    repoDir: bundle.repoDir,
    observation: {
      manifestBytes,
      manifest: manifestValue,
      proof: publicationProof(bundle, sha256(manifestBytes))
    }
  }, {
    local: { fs },
    wallNow: () => Date.parse(VERIFIED_AT)
  }), { cacheRoot: bundle.cacheRoot });

  const publication = {
    manifestFile: published.artifacts.manifestFile,
    manifestSha256: published.artifacts.manifestSha256,
    sourceSha: bundle.sourceSha
  };
  const size = prepareSizesTarget(bundle, publication);
  bundle.git(bundle.desktopRoot, ['remote', 'set-url', 'origin', bundle.remotes.get(DESKTOP_REPO).push]);
  bundle.git(bundle.desktopRoot, ['push', '-q', bundle.remotes.get(DESKTOP_REPO).push, `${bundle.sourceSha}:refs/heads/main`]);
  const sizeCompleted = await completeTarget(bundle, {
    applicationFile: size.record.applicationFile, journalFile: size.journalFile, message: SIZE_MESSAGE
  });
  bundle.git(bundle.desktopRoot, ['remote', 'set-url', 'origin', ORIGIN]);

  const tail = {
    ...published,
    revision: published.revision + 1,
    updatedAt: NOW,
    sizes: { state: 'complete', journalFile: size.journalFile, commit: sizeCompleted.commit, reason: null }
  };
  writeReleaseState(tail, bundle.identity, {
    cacheRoot: bundle.cacheRoot, expectedRevision: published.revision, fs
  });
  const tailState = readReleaseState(bundle.identity, { cacheRoot: bundle.cacheRoot, fs });

  prepareSiteAttempt(
    { state: tailState, repoDir: bundle.repoDir, attemptId: ATTEMPT_ID },
    siteDeps(bundle, { now: NOW_2 })
  );
  const preparedSite = readReleaseState(bundle.identity, { cacheRoot: bundle.cacheRoot, fs });
  runSiteAttempt(
    { state: preparedSite, repoDir: bundle.repoDir },
    siteDeps(bundle, {
      now: NOW_3,
      deploy: (dir) => {
        fs.mkdirSync(path.join(dir, '.wrangler/tmp'), { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, '.wrangler/tmp/deployment.json'), '{}\n');
      }
    })
  );
  const completedSite = readReleaseState(bundle.identity, { cacheRoot: bundle.cacheRoot, fs });

  const docsRunDir = path.join(bundle.repoDir, 'records', RELEASE_ID, 'docs', 'run');
  fs.mkdirSync(path.dirname(docsRunDir), { recursive: true });
  prepareExternalDocs(
    { version: VERSION, parentDir: bundle.parentDir, runDir: docsRunDir },
    { run: makeNpmRun(bundle.websiteRoot) }
  );

  const docs = { hyperclay: null, 'hyperclay-website': null };
  let current = completedSite;
  let updatedAt = NOW_3;
  const stamps = [NOW_4, NOW_5];
  for (let index = 0; index < DOC_REPOS.length; index += 1) {
    const repo = DOC_REPOS[index];
    const outDir = path.join(bundle.repoDir, 'records', RELEASE_ID, 'docs', repo, 'out-1');
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    const record = prepareDocsApplication({
      preparedFile: path.join(docsRunDir, 'prepared.json'),
      repo,
      parentDir: bundle.parentDir,
      version: VERSION,
      outDir
    }, { run: actingDeps(bundle).run });
    const journalFile = path.join(outDir, 'target.json');
    const pushed = await completeTarget(bundle, {
      applicationFile: record.applicationFile, journalFile, message: DOCS_MESSAGE
    });
    docs[repo] = { state: 'complete', journalFile, commit: pushed.commit, reason: null };
    updatedAt = stamps[index];
    const next = {
      ...current,
      revision: current.revision + 1,
      updatedAt,
      docs: { ...current.docs, [repo]: docs[repo] }
    };
    writeReleaseState(next, bundle.identity, {
      cacheRoot: bundle.cacheRoot, expectedRevision: current.revision, fs
    });
    current = readReleaseState(bundle.identity, { cacheRoot: bundle.cacheRoot, fs });
  }

  const complete = {
    ...current,
    revision: current.revision + 1,
    updatedAt: NOW_5,
    phase: 'complete'
  };
  writeReleaseState(complete, bundle.identity, {
    cacheRoot: bundle.cacheRoot, expectedRevision: current.revision, fs
  });
  const completeState = readReleaseState(bundle.identity, { cacheRoot: bundle.cacheRoot, fs });

  return {
    published,
    size,
    sizeCompleted,
    tail: tailState,
    preparedSite,
    completedSite,
    complete: completeState
  };
}

module.exports.completeBundle = completeBundle;
module.exports.actingDeps = actingDeps;
module.exports.siteDeps = siteDeps;
module.exports.makeNpmRun = makeNpmRun;
