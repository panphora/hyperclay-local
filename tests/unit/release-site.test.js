// The desktop site target retains the exact `website` subtree of the recorded
// completed size commit as a private immutable snapshot and checkpoints the public
// site target as pending. Every fixture is a real scratch repository under one owned
// temp root with an isolated Git config and a local bare push destination, so no
// sibling checkout, provider, Ferry, deployment or release is touched. The recorded
// size/publication history is produced by the real accepted writers, not a stub.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readCommittedSite, readSiteAttempt, readSiteEvidence, verifySiteSnapshot
} = require('../../scripts/release-site-evidence');
const { prepareSiteAttempt, reconcileSiteAttempt, runSiteAttempt } = require('../../scripts/release-site');
const { prepareDownloadSizes } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication } = require('../../scripts/release-docs-plan');
const { renderDownloadSizes } = require('../../scripts/write-download-sizes');
const {
  prepareCommitIntent, applyPreparedTarget, reconcileTargetPush
} = require('../../scripts/release-docs-apply');
const { persistPublication } = require('../../scripts/release-publication-write');
const { withReleaseLock } = require('../../scripts/release-lock');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { execFileCaptured } = require('../../scripts/release-command');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(300000);

const VERSION = '1.29.0';
const DATE = '2026-01-02T03:04:05.678Z';
const DESKTOP_REPO = 'hyperclay-local';
const MESSAGE = `Update desktop download sizes for v${VERSION}`;
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const REMOTE_REPO = 'fixture-owner/hyperclay-local';

const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const ATTEMPT_ID_2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const ATTEMPT_ID_3 = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
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

const TMP_BASE = fs.realpathSync.native(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-site-'));
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

function siteState(fixture) {
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

function makeRepoFixture() {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++seq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remote-${++seq}-`));
  const pushRemote = path.join(remoteDir, `${DESKTOP_REPO}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', pushRemote]);

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

  const sourceSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const identity = resolveRepoIdentity(repoRoot, { readGit: createLocalGitReader().readGit, fs });
  const cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `cache-${++seq}-`)));
  const cacheRoot = path.join(cacheBase, 'releases');
  return {
    parentDir,
    repoRoot,
    pushRemote,
    sourceSha,
    identity,
    cacheRoot,
    repoDir: statePaths(identity, { cacheRoot, fs }).repoDir,
    attempt: siteAttempt(sourceSha)
  };
}

function prepareRun() {
  return (command, args, options = {}) => {
    if (command === 'npm') throw new Error('site preparation must not run npm');
    return childProcess.execFileSync(command, args, { encoding: 'utf8', env: GIT_ENV, ...options });
  };
}

function planRun() {
  return (command, args, options = {}) => execFileCaptured(command, args, {
    ...options,
    env: { ...GIT_ENV, ...(options.env || {}) }
  });
}

function spawnRun() {
  return (command, args, options = {}) => childProcess.spawnSync(command, args, {
    ...options,
    env: { ...GIT_ENV, ...(options.env || {}) }
  });
}

function actingDeps(fixture) {
  return {
    run: (command, args, opts = {}) => execFileCaptured(command, args, {
      ...opts,
      env: { ...GIT_ENV, ...(opts.env || {}) }
    }),
    cacheRoot: path.dirname(fixture.repoDir),
    now: () => Date.parse(NOW),
    assertPublishWindow: () => {},
    withFerryRepoLock: async (root, callback) => callback()
  };
}

function pushDeps(fixture) {
  const deps = actingDeps(fixture);
  deps.withFerryRepoLock = async () => {
    throw new Error('Ferry must not be entered for a site preparation');
  };
  return deps;
}

function prepareSize(fixture) {
  const sizesRoot = path.join(fixture.repoDir, 'records', RELEASE_ID, 'sizes');
  fs.mkdirSync(sizesRoot, { recursive: true });
  const runDir = path.join(sizesRoot, `run-${++seq}`);
  const outDir = path.join(sizesRoot, `out-${++seq}`);
  const publication = {
    manifestFile: fixture.manifestFile,
    manifestSha256: fixture.manifestSha256,
    sourceSha: fixture.sourceSha
  };
  const prepared = prepareDownloadSizes({
    version: VERSION, parentDir: fixture.parentDir, runDir, publication
  }, { run: prepareRun() });
  const record = prepareDocsApplication({
    preparedFile: path.join(runDir, 'prepared.json'),
    repo: DESKTOP_REPO,
    parentDir: fixture.parentDir,
    version: VERSION,
    outDir
  }, { run: planRun() });
  return { runDir, outDir, publication, prepared, record, journalFile: path.join(outDir, 'target.json') };
}

async function completeSiteFixture() {
  const fixture = makeRepoFixture();
  const manifestValue = manifestFor(fixture.sourceSha);
  const manifestBytes = Buffer.from(JSON.stringify(manifestValue), 'utf8');
  const initial = siteState(fixture);
  writeReleaseState(initial, fixture.identity, { cacheRoot: fixture.cacheRoot, expectedRevision: null, fs });
  const published = await withReleaseLock(fixture.identity, async () => persistPublication({
    state: initial,
    repoDir: fixture.repoDir,
    observation: {
      manifestBytes,
      manifest: manifestValue,
      proof: publicationProof(fixture, sha256(manifestBytes))
    }
  }, {
    local: { fs },
    wallNow: () => Date.parse(VERIFIED_AT)
  }), { cacheRoot: fixture.cacheRoot });
  fixture.manifestFile = published.artifacts.manifestFile;
  fixture.manifestSha256 = published.artifacts.manifestSha256;
  fixture.published = published;

  const size = prepareSize(fixture);
  git(fixture.repoRoot, ['remote', 'set-url', 'origin', fixture.pushRemote]);
  git(fixture.repoRoot, ['push', '-q', fixture.pushRemote, `${fixture.sourceSha}:refs/heads/main`]);

  const deps = actingDeps(fixture);
  const preparedIntent = await prepareCommitIntent({
    applicationFile: size.record.applicationFile,
    journalFile: size.journalFile,
    message: MESSAGE
  }, deps);
  const applied = await applyPreparedTarget({ journalFile: size.journalFile }, deps);
  const completed = await reconcileTargetPush({ journalFile: size.journalFile }, pushDeps(fixture));
  git(fixture.repoRoot, ['remote', 'set-url', 'origin', ORIGIN]);

  const tail = {
    ...published,
    revision: published.revision + 1,
    sizes: { state: 'complete', journalFile: size.journalFile, commit: completed.commit, reason: null }
  };
  writeReleaseState(tail, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision: published.revision, fs
  });
  const state = readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
  return { fixture, published, size, preparedIntent, applied, completed, state };
}

function siteDeps(now = NOW) {
  const reader = createLocalGitReader();
  return { run: reader.run, spawn: reader.spawn, fs, now: () => now };
}

function attemptDirOf(fixture, attemptId) {
  return path.join(fixture.repoDir, 'records', RELEASE_ID, 'site', attemptId);
}

function readDescriptorFile(fixture, attemptId) {
  return path.join(attemptDirOf(fixture, attemptId), 'site.json');
}

function writeDescriptorFile(fixture, attemptId, descriptor) {
  fs.writeFileSync(readDescriptorFile(fixture, attemptId), `${JSON.stringify(descriptor)}\n`);
}

function readDescriptor(fixture, attemptId) {
  return JSON.parse(fs.readFileSync(readDescriptorFile(fixture, attemptId), 'utf8'));
}

function liveSnapshot(fixture) {
  const root = fixture.repoRoot;
  return {
    branch: git(root, ['symbolic-ref', '-q', 'HEAD']).trim(),
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    index: sha256(git(root, ['ls-files', '--stage', '-z'])),
    status: git(root, ['status', '--porcelain=v1', '-z']),
    refs: git(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    config: git(root, ['config', '--local', '--list']),
    origin: git(root, ['remote', 'get-url', 'origin']).trim(),
    originPush: git(root, ['remote', 'get-url', '--push', 'origin']).trim(),
    tree: liveTreeDigest(root)
  };
}

function liveTreeDigest(root) {
  const parts = [];
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (prefix === '' && name === '.git') continue;
      const target = path.join(dir, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) {
        walk(target, relative);
        continue;
      }
      parts.push(`${relative} ${stat.mode & 0o777} ${sha256(fs.readFileSync(target))}`);
    }
  };
  walk(root, '');
  return sha256(parts.join('\n'));
}

function refusal(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function expectSiteRefusal(invoke) {
  const error = refusal(invoke);
  expect(error.code).toBe('SITE_EVIDENCE_INVALID');
  return error;
}

function expectAttemptRefusal(invoke) {
  const error = refusal(invoke);
  expect(error.code).toBe('SITE_ATTEMPT_FAILED');
  return error;
}

function causeChain(error) {
  const chain = [];
  let current = error;
  while (current !== undefined && current !== null) {
    chain.push(`${current.code === undefined ? '' : current.code}:${current.message}`);
    current = current.cause;
  }
  return chain.join(' | ');
}

function expectNoSiteDirectory(fixture) {
  expect(fs.existsSync(path.join(fixture.repoDir, 'records', RELEASE_ID, 'site'))).toBe(false);
}

function label(target) {
  return String(target);
}

// A primitive filesystem adapter: only the operations the site code is allowed to
// use are present, every call is recorded in order, and any operation can be made to
// fail independently. A call to an operation that is not listed here fails loudly.
function recordingFs({ fail = () => false } = {}) {
  const events = [];
  const descriptors = new Map();
  let faultMatches = 0;
  const record = (op, target) => {
    events.push({ op, target });
    if (fail(op, target)) {
      faultMatches += 1;
      const error = new Error(`injected ${op} failure at ${target}`);
      error.code = 'EIO';
      throw error;
    }
  };
  const byDescriptor = (op, fd) => {
    record(op, descriptors.has(fd) ? descriptors.get(fd) : `fd:${fd}`);
  };
  const realpathSync = (target) => { record('realpath', label(target)); return fs.realpathSync.native(target); };
  realpathSync.native = realpathSync;
  return {
    events,
    get faultMatches() { return faultMatches; },
    constants: fs.constants,
    lstatSync: (target) => { record('lstat', label(target)); return fs.lstatSync(target); },
    statSync: (target) => { record('stat', label(target)); return fs.statSync(target); },
    realpathSync,
    readdirSync: (target) => { record('readdir', label(target)); return fs.readdirSync(target); },
    mkdirSync: (target, mode) => {
      record('mkdir', label(target));
      return mode === undefined ? fs.mkdirSync(target) : fs.mkdirSync(target, mode);
    },
    openSync: (target, flags, mode) => {
      record('open', label(target));
      const fd = mode === undefined ? fs.openSync(target, flags) : fs.openSync(target, flags, mode);
      descriptors.set(fd, label(target));
      return fd;
    },
    writeFileSync: (fd, bytes) => { byDescriptor('write', fd); return fs.writeFileSync(fd, bytes); },
    fstatSync: (fd) => { byDescriptor('fstat', fd); return fs.fstatSync(fd); },
    fsyncSync: (fd) => { byDescriptor('fsync', fd); return fs.fsyncSync(fd); },
    closeSync: (fd) => { byDescriptor('close', fd); descriptors.delete(fd); return fs.closeSync(fd); },
    renameSync: (from, to) => { record('rename', label(to)); return fs.renameSync(from, to); },
    unlinkSync: (target) => { record('unlink', label(target)); return fs.unlinkSync(target); },
    readSync: (fd, buffer, offset, length, position) => {
      byDescriptor('read', fd);
      return fs.readSync(fd, buffer, offset, length, position);
    }
  };
}

function opsOf(adapter) {
  return adapter.events.map((event) => `${event.op}:${event.target}`);
}

const CRAFTED_SOURCE = '1'.repeat(40);
const CRAFTED_TREE = '2'.repeat(40);

function treeRecord(mode, type, oid, name) {
  return Buffer.concat([Buffer.from(`${mode} ${type} ${oid}\t${name}`, 'utf8'), Buffer.from([0])]);
}

function craftedTree(files) {
  const blobs = new Map();
  const records = [];
  files.forEach(([filePath, bytes], index) => {
    const oid = String(index + 1).padStart(40, '0');
    blobs.set(oid, bytes);
    records.push(treeRecord('100644', 'blob', oid, filePath));
  });
  return { listing: Buffer.concat(records), blobs };
}

function craftedReader({ listing, blobs = new Map() }) {
  const calls = [];
  return {
    calls,
    run: (command, args, options = {}) => {
      calls.push({ args: args.slice(), options });
      if (command !== 'git') throw new Error('site evidence must only read Git');
      if (args[0] === 'rev-parse') return `${CRAFTED_SOURCE}\n`;
      if (args[0] === 'ls-tree' && args[1] === '-z') {
        return Buffer.concat([treeRecord('040000', 'tree', CRAFTED_TREE, 'website')]);
      }
      if (args[0] === 'ls-tree' && args[1] === '-r') return listing;
      if (args[0] === 'cat-file') {
        const oid = args[2];
        if (!blobs.has(oid)) throw new Error(`missing Git object ${oid}`);
        return blobs.get(oid);
      }
      throw new Error(`unexpected Git read: ${args.join(' ')}`);
    }
  };
}

function baseSiteFiles() {
  return [
    ['index.html', Buffer.from('<html></html>\n')],
    ['wrangler.jsonc', Buffer.from(WEBSITE_CONFIG)],
    ['.assetsignore', Buffer.from(WEBSITE_IGNORE)]
  ];
}

function craftedRead(files, extra = []) {
  const { listing, blobs } = craftedTree(files);
  const reader = craftedReader({ listing: Buffer.concat([listing, ...extra]), blobs });
  return {
    reader,
    read: () => readCommittedSite({ repoRoot: path.resolve('/tmp/site-evidence'), sourceSha: CRAFTED_SOURCE }, { run: reader.run })
  };
}

function hostileCommit(fixture, entries) {
  const indexFile = path.join(OWNER, `hostile-index-${++seq}`);
  const env = { ...GIT_ENV, GIT_INDEX_FILE: indexFile };
  git(fixture.repoRoot, ['read-tree', `${git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()}^{tree}`], { env });
  for (const entry of entries) {
    if (entry.remove === true) {
      git(fixture.repoRoot, ['update-index', '--force-remove', entry.path], { env });
      continue;
    }
    const oid = entry.bytes === undefined
      ? entry.oid
      : git(fixture.repoRoot, ['hash-object', '-w', '--stdin'], { input: entry.bytes, env }).trim();
    git(fixture.repoRoot, ['update-index', '--add', '--cacheinfo', `${entry.mode || '100644'},${oid},${entry.path}`], { env });
  }
  const tree = git(fixture.repoRoot, ['write-tree'], { env }).trim();
  return git(fixture.repoRoot, ['commit-tree', tree, '-p', 'HEAD', '-m', 'hostile site tree'], { env }).trim();
}

function amendCommit(fixture, mutate) {
  const pristine = new Map();
  for (const relative of mutate.touch) {
    const file = path.join(fixture.repoRoot, relative);
    pristine.set(relative, fs.existsSync(file) ? fs.readFileSync(file) : null);
  }
  try {
    mutate.apply();
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'altered site tree']);
    const commit = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    return commit;
  } finally {
    for (const [relative, bytes] of pristine) {
      const file = path.join(fixture.repoRoot, relative);
      if (bytes === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, bytes);
    }
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '--allow-empty', '-m', 'restore site tree']);
  }
}

function expectedInventory(fixture, commit) {
  const tree = git(fixture.repoRoot, ['rev-parse', `${commit}^{tree}`]).trim();
  const website = git(fixture.repoRoot, ['ls-tree', '-z', commit, '--', 'website']).split('\0').filter(Boolean)[0];
  const treeSha = website.split('\t')[0].split(' ')[2];
  const paths = git(fixture.repoRoot, ['ls-tree', '-r', '--full-tree', '-z', treeSha])
    .split('\0').filter(Boolean).map((line) => line.split('\t')[1]).sort();
  return { tree, treeSha, paths };
}

async function preparedContext(attemptId = ATTEMPT_ID) {
  const ctx = await completeSiteFixture();
  const prepared = prepareSiteAttempt(
    { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId },
    siteDeps()
  );
  return {
    ...ctx,
    prepared: persistedSiteState(ctx.fixture, prepared),
    attemptDir: attemptDirOf(ctx.fixture, attemptId)
  };
}

function persistedSiteState(fixture, returned) {
  const stored = readReleaseState(fixture.identity, {
    cacheRoot: fixture.cacheRoot,
    fs
  });
  expect(stored).toEqual(returned);
  return stored;
}

function expectNoDescriptor(attemptDir) {
  expect(fs.existsSync(path.join(attemptDir, 'site.json'))).toBe(false);
}

function expectNoSnapshot(attemptDir) {
  expect(fs.existsSync(path.join(attemptDir, 'snapshot'))).toBe(false);
}

describe('site snapshot', () => {
  test('exposes only the shared read leaf and the preparation entry point', () => {
    expect(Object.keys(require('../../scripts/release-site-evidence')).sort())
      .toEqual(['readCommittedSite', 'readSiteAttempt', 'readSiteEvidence', 'verifySiteSnapshot']);
    expect(Object.keys(require('../../scripts/release-site')).sort())
      .toEqual(['prepareSiteAttempt', 'reconcileSiteAttempt', 'runSiteAttempt']);
  });

  test('loads no acting entry, lock, Ferry or state-store module from the read leaf', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const script = [
      "const path = require('path');",
      "const childProcess = require('child_process');",
      "const fs = require('fs');",
      "const root = process.env.SITE_EVIDENCE_ROOT;",
      'const calls = [];',
      'const block = (owner, prefix, names) => {',
      '  for (const name of names) {',
      "    if (typeof owner[name] !== 'function') continue;",
      '    owner[name] = () => {',
      '      calls.push(`${prefix}.${name}`);',
      '      throw new Error(`blocked executable side effect: ${prefix}.${name}`);',
      '    };',
      '  }',
      '};',
      "block(childProcess, 'child_process', ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync']);",
      "const fsMutations = ['appendFile', 'appendFileSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'createWriteStream', 'fchmod', 'fchmodSync', 'fchown', 'fchownSync', 'ftruncate', 'ftruncateSync', 'futimes', 'futimesSync', 'lchmod', 'lchmodSync', 'lchown', 'lchownSync', 'link', 'linkSync', 'lutimes', 'lutimesSync', 'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rename', 'renameSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'symlink', 'symlinkSync', 'truncate', 'truncateSync', 'unlink', 'unlinkSync', 'utimes', 'utimesSync', 'write', 'writeFile', 'writeFileSync', 'writeSync'];",
      "block(fs, 'fs', fsMutations);",
      "block(fs.promises, 'fs.promises', ['appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'lchown', 'link', 'lutimes', 'mkdir', 'mkdtemp', 'rename', 'rm', 'rmdir', 'symlink', 'truncate', 'unlink', 'utimes', 'writeFile']);",
      'let loadError = null;',
      'try {',
      "  require(path.join(root, 'scripts', 'release-site-evidence.js'));",
      '} catch (error) {',
      '  loadError = error.message;',
      '}',
      'const loaded = Object.keys(require.cache)',
      "  .filter((file) => file.startsWith(path.join(root, 'scripts') + path.sep))",
      "  .map((file) => path.basename(file));",
      'process.stdout.write(JSON.stringify({ calls, loadError, loaded }));'
    ].join('\n');
    const output = childProcess.execFileSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...GIT_ENV, SITE_EVIDENCE_ROOT: repoRoot }
    });
    const probe = JSON.parse(output);
    expect(probe.loadError).toBeNull();
    expect(probe.calls).toEqual([]);
    const loaded = probe.loaded;
    for (const name of ['release-site-evidence.js', 'release-local-read.js', 'release-target-evidence.js']) {
      expect(loaded).toContain(name);
    }
    for (const name of [
      'release.js', 'release-site.js', 'release-lock.js', 'release-ferry.js', 'release-transcript.js',
      'release-state-store.js', 'release-transitions.js', 'release-publication-write.js'
    ]) {
      expect(loaded).not.toContain(name);
    }
  });

  test('refuses an unvalidated state before touching the filesystem', () => {
    const forbiddenFs = new Proxy({}, {
      get(target, prop) {
        throw new Error(`filesystem ${String(prop)} must not be touched`);
      }
    });
    const forbiddenRun = () => {
      throw new Error('Git must not be read');
    };
    for (const state of [undefined, null, {}, { repo: null }]) {
      const error = expectSiteRefusal(
        () => readSiteAttempt({ state, repoDir: path.resolve('/tmp/site-evidence') }, { run: forbiddenRun, fs: forbiddenFs })
      );
      expect(error.message).toMatch(/validated release state/);
    }
    expect(expectSiteRefusal(
      () => verifySiteSnapshot(
        { repoRoot: 'relative', sourceSha: CRAFTED_SOURCE, treeSha: CRAFTED_TREE, snapshotDir: path.resolve('/tmp') },
        { run: forbiddenRun, fs: forbiddenFs }
      )
    ).message).toMatch(/absolute repository root/);
    expect(expectSiteRefusal(
      () => readCommittedSite({ repoRoot: path.resolve('/tmp'), sourceSha: 'not-an-oid' }, { run: forbiddenRun })
    ).message).toMatch(/Git object identifier/);
    expect(expectSiteRefusal(
      () => verifySiteSnapshot({ repoRoot: path.resolve('/tmp'), sourceSha: CRAFTED_SOURCE, treeSha: CRAFTED_TREE, snapshotDir: path.resolve('/tmp') }, {
        run: forbiddenRun, fs: forbiddenFs
      })
    )).toBeTruthy();
  });

  test('refuses a preparation request without a fresh attempt identifier', () => {
    const forbiddenFs = new Proxy({}, {
      get(target, prop) {
        throw new Error(`filesystem ${String(prop)} must not be touched`);
      }
    });
    for (const attemptId of [undefined, null, 'not-a-uuid', ATTEMPT_ID.toUpperCase(), '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5']) {
      const error = expectAttemptRefusal(
        () => prepareSiteAttempt({ state: {}, repoDir: path.resolve('/tmp/site-evidence'), attemptId }, { fs: forbiddenFs })
      );
      expect(error.message).toMatch(/fresh attempt identifier/);
    }
    const retry = expectAttemptRefusal(() => prepareSiteAttempt(
      { state: {}, repoDir: path.resolve('/tmp/site-evidence'), attemptId: ATTEMPT_ID, retrySite: 'yes' },
      { fs: forbiddenFs }
    ));
    expect(retry.message).toMatch(/retrySite must be a boolean/);
  });

  describe('crafted committed inventory', () => {
    test('refuses a path traversal, a forbidden component or an unusual name', () => {
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [treeRecord('100644', 'blob', '9'.repeat(40), '../escape')]).read())
        .message).toMatch(/unsafe path/);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [treeRecord('100644', 'blob', '9'.repeat(40), '/absolute')]).read())
        .message).toMatch(/unsafe path/);
      for (const name of ['nested/.env', 'nested/.env.local', '.dev.vars', 'nested/.dev.vars.production', '.git/config', '.wrangler/tmp']) {
        expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [treeRecord('100644', 'blob', '9'.repeat(40), name)]).read())
          .message).toMatch(/forbidden path/);
      }
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [treeRecord('100644', 'blob', '9'.repeat(40), 'odd\u0001name')]).read())
        .message).toMatch(/control character/);
      const undecodable = Buffer.concat([
        Buffer.from('100644 blob 9999999999999999999999999999999999999999\t', 'utf8'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from([0])
      ]);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [undecodable]).read())
        .message).toMatch(/not valid UTF-8/);
    });

    test('refuses duplicate and case-colliding paths', () => {
      const duplicate = craftedRead(baseSiteFiles(), [treeRecord('100644', 'blob', '0'.repeat(39) + '1', 'index.html')]);
      expect(expectSiteRefusal(() => duplicate.read()).message).toMatch(/repeats a path/);
      const collision = craftedRead(baseSiteFiles(), [
        treeRecord('100644', 'blob', '0'.repeat(39) + '1', 'assets/A.txt'),
        treeRecord('100644', 'blob', '0'.repeat(39) + '2', 'assets/a.txt')
      ]);
      expect(expectSiteRefusal(() => collision.read()).message).toMatch(/collides by case/);
    });

    test('refuses a symlink, a submodule or a non-blob entry', () => {
      const symlink = craftedRead(baseSiteFiles(), [treeRecord('120000', 'blob', '9'.repeat(40), 'link')]);
      expect(expectSiteRefusal(() => symlink.read()).message).toMatch(/unsupported mode/);
      const submodule = craftedRead(baseSiteFiles(), [treeRecord('160000', 'commit', '9'.repeat(40), 'sub')]);
      expect(expectSiteRefusal(() => submodule.read()).message).toMatch(/non-blob entry/);
      const nested = craftedRead(baseSiteFiles(), [treeRecord('040000', 'tree', '9'.repeat(40), 'assets')]);
      expect(expectSiteRefusal(() => nested.read()).message).toMatch(/non-blob entry/);
    });

    test('refuses malformed metadata, a missing website tree and an empty tree', () => {
      const noTab = Buffer.concat([Buffer.from('100644 blob 9999999999999999999999999999999999999999 index.html', 'utf8'), Buffer.from([0])]);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [noTab]).read()).message).toMatch(/no path separator/);
      const shortHeader = Buffer.concat([Buffer.from('100644 blob\tshort.txt', 'utf8'), Buffer.from([0])]);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [shortHeader]).read()).message).toMatch(/header is malformed/);
      const badOid = Buffer.concat([Buffer.from('100644 blob zz\tshort.txt', 'utf8'), Buffer.from([0])]);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [badOid]).read()).message).toMatch(/object is malformed/);
      const badMode = Buffer.concat([Buffer.from('99999 blob 9999999999999999999999999999999999999999\tshort.txt', 'utf8'), Buffer.from([0])]);
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [badMode]).read()).message).toMatch(/mode is malformed/);
      const unterminated = Buffer.concat(baseSiteFiles().map(([filePath], index) =>
        Buffer.from(`100644 blob ${String(index + 1).padStart(40, '0')}\t${filePath}`, 'utf8')));
      expect(expectSiteRefusal(() => craftedRead(baseSiteFiles(), [unterminated]).read()).message).toMatch(/not NUL terminated/);
      const empty = craftedRead(baseSiteFiles());
      empty.reader.run = (command, args, options = {}) => {
        if (args[0] === 'rev-parse') return `${CRAFTED_SOURCE}\n`;
        if (args[0] === 'ls-tree' && args[1] === '-z') return Buffer.alloc(0);
        if (args[0] === 'ls-tree') return Buffer.alloc(0);
        throw new Error('unexpected Git read');
      };
      expect(expectSiteRefusal(() => empty.read()).message).toMatch(/exactly one website tree/);
    });

    test('refuses a tree beyond the file count and per-file byte bounds', () => {
      const many = [];
      for (let index = 0; index < 4097; index += 1) {
        many.push(treeRecord('100644', 'blob', String(index + 1).padStart(40, '0'), `file-${index}.txt`));
      }
      const reader = craftedReader({ listing: Buffer.concat(many) });
      const error = expectSiteRefusal(
        () => readCommittedSite({ repoRoot: path.resolve('/tmp/site-evidence'), sourceSha: CRAFTED_SOURCE }, { run: reader.run })
      );
      expect(error.message).toMatch(/file count bound/);
      expect(reader.calls.filter((call) => call.args[0] === 'cat-file')).toHaveLength(0);

      const oversized = craftedRead([['index.html', Buffer.alloc(16 * 1024 * 1024 + 1)], ...baseSiteFiles().slice(1)]);
      expect(expectSiteRefusal(() => oversized.read()).message).toMatch(/oversized file/);
    });

    test('refuses a missing Git object and a missing required file', () => {
      const { listing } = craftedTree(baseSiteFiles());
      const missing = craftedReader({ listing });
      expect(expectSiteRefusal(
        () => readCommittedSite({ repoRoot: path.resolve('/tmp/site-evidence'), sourceSha: CRAFTED_SOURCE }, { run: missing.run })
      ).message).toMatch(/Git read failed/);

      const noIndex = craftedRead([['wrangler.jsonc', Buffer.from(WEBSITE_CONFIG)], ['.assetsignore', Buffer.from(WEBSITE_IGNORE)]]);
      expect(expectSiteRefusal(() => noIndex.read()).message).toMatch(/missing index.html/);
      const noIgnore = craftedRead([['index.html', Buffer.from('<html></html>\n')], ['wrangler.jsonc', Buffer.from(WEBSITE_CONFIG)]]);
      expect(expectSiteRefusal(() => noIgnore.read()).message).toMatch(/missing .assetsignore/);
    });

    test('refuses an altered committed configuration or ignore file', () => {
      const alteredName = WEBSITE_CONFIG.replace('"hyperclaylocal"', '"otherworker"');
      expect(expectSiteRefusal(() => craftedRead([
        ['index.html', Buffer.from('<html></html>\n')],
        ['wrangler.jsonc', Buffer.from(alteredName)],
        ['.assetsignore', Buffer.from(WEBSITE_IGNORE)]
      ]).read()).message).toMatch(/different worker/);

      const expanded = WEBSITE_CONFIG.replace('"routes"', '"main": "src/index.js",\n  "routes"');
      expect(expectSiteRefusal(() => craftedRead([
        ['index.html', Buffer.from('<html></html>\n')],
        ['wrangler.jsonc', Buffer.from(expanded)],
        ['.assetsignore', Buffer.from(WEBSITE_IGNORE)]
      ]).read()).message).toMatch(/unsupported fields/);

      const extraExclusion = `${WEBSITE_IGNORE}assets/\n`;
      expect(expectSiteRefusal(() => craftedRead([
        ['index.html', Buffer.from('<html></html>\n')],
        ['wrangler.jsonc', Buffer.from(WEBSITE_CONFIG)],
        ['.assetsignore', Buffer.from(extraExclusion)]
      ]).read()).message).toMatch(/exactly the four fixed exclusions/);

      const missingExclusion = WEBSITE_IGNORE.replace('.DS_Store\n', '');
      expect(expectSiteRefusal(() => craftedRead([
        ['index.html', Buffer.from('<html></html>\n')],
        ['wrangler.jsonc', Buffer.from(WEBSITE_CONFIG)],
        ['.assetsignore', Buffer.from(missingExclusion)]
      ]).read()).message).toMatch(/exactly the four fixed exclusions/);
    });
  });

  describePosix('native preparation', () => {
    testPosix('reads the immutable website inventory from the recorded commit', async () => {
      const ctx = await completeSiteFixture();
      const reader = createLocalGitReader();
      const commit = ctx.state.sizes.commit;
      const { treeSha, paths } = expectedInventory(ctx.fixture, commit);
      expect(commit).not.toBe(ctx.fixture.sourceSha);

      const calls = [];
      const committed = readCommittedSite({ repoRoot: ctx.fixture.repoRoot, sourceSha: commit }, {
        run: (command, args, options = {}) => {
          calls.push({ args: args.slice(), options });
          return reader.run(command, args, options);
        }
      });
      expect(committed.sourceSha).toBe(commit);
      expect(committed.treeSha).toBe(treeSha);
      expect(committed.files.map((file) => file.path)).toEqual(paths);

      const byPath = new Map(committed.files.map((file) => [file.path, file]));
      expect(byPath.get('.assetsignore').bytes.equals(fs.readFileSync(path.join(ctx.fixture.repoRoot, 'website/.assetsignore'))))
        .toBe(true);
      expect(byPath.get('.assetsignore').mode).toBe(0o644);
      expect(byPath.get('wrangler.jsonc').bytes.toString('utf8')).toBe(WEBSITE_CONFIG);
      expect(byPath.get('assets/app-popover.png').bytes.equals(BINARY_PNG)).toBe(true);
      expect(byPath.get('assets/app-popover.png').bytes.includes(0)).toBe(true);
      expect(byPath.get('assets/open graph image.png').bytes.equals(BINARY_FONT)).toBe(true);
      expect(byPath.get('assets/deep/nested/leaf.txt').bytes.toString('utf8')).toBe('leaf\n');
      expect(byPath.get('scripts/serve.sh').mode).toBe(0o755);
      expect(byPath.get('index.html').bytes.toString('utf8')).toBe(websiteFixture(MB_NEW));

      const older = readCommittedSite({ repoRoot: ctx.fixture.repoRoot, sourceSha: ctx.fixture.sourceSha }, { run: reader.run });
      expect(older.treeSha).not.toBe(treeSha);
      expect(older.files.find((file) => file.path === 'index.html').bytes.toString('utf8')).toBe(websiteFixture(MB_OLD));

      const shapes = calls.map((call) => call.args.join(' '));
      expect(shapes).toContain(`rev-parse --verify ${commit}^{commit}`);
      expect(shapes).toContain(`ls-tree -z ${commit} -- website`);
      expect(shapes).toContain(`ls-tree -r --full-tree -z ${treeSha}`);
      expect(shapes.filter((shape) => /^cat-file blob [0-9a-f]{40}$/.test(shape))).toHaveLength(paths.length);
      for (const call of calls) {
        expect(call.options.cwd).toBe(ctx.fixture.repoRoot);
        if (call.args[0] === 'cat-file') {
          expect(call.options.encoding).toBe(null);
          expect(call.options.maxBuffer).toBe(16 * 1024 * 1024);
        } else {
          expect(call.options.maxBuffer).toBe(1024 * 1024);
        }
      }
    });

    testPosix('prepares a private retained snapshot and checkpoints the pending site target', async () => {
      const ctx = await completeSiteFixture();
      const { treeSha } = expectedInventory(ctx.fixture, ctx.state.sizes.commit);
      const before = liveSnapshot(ctx.fixture);
      const commit = ctx.state.sizes.commit;

      const next = prepareSiteAttempt(
        { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID },
        siteDeps()
      );

      expect(next.revision).toBe(ctx.state.revision + 1);
      expect(next.updatedAt).toBe(NOW);
      expect(next.site).toEqual({
        state: 'pending',
        sourceSha: commit,
        treeSha,
        attemptId: ATTEMPT_ID,
        receiptSha: null,
        verifiedAt: null,
        error: null
      });

      const attemptDir = attemptDirOf(ctx.fixture, ATTEMPT_ID);
      expect(fs.readdirSync(attemptDir).sort()).toEqual(['site.json', 'snapshot']);
      const snapshotDir = path.join(attemptDir, 'snapshot');
      expect(fs.statSync(attemptDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(snapshotDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(attemptDir, 'site.json')).mode & 0o777).toBe(0o600);
      expect(fs.existsSync(path.join(attemptDir, 'snapshot.pending'))).toBe(false);
      expect(fs.existsSync(path.join(attemptDir, 'deploy'))).toBe(false);

      const descriptorBytes = fs.readFileSync(path.join(attemptDir, 'site.json'));
      expect(descriptorBytes.toString('utf8')).toBe(`${JSON.stringify({
        schema: 1,
        releaseId: RELEASE_ID,
        version: VERSION,
        attemptId: ATTEMPT_ID,
        sourceSha: commit,
        treeSha,
        snapshotDir,
        phase: 'prepared',
        requestedAt: null,
        completedAt: null,
        receiptSha: null,
        receiptBeforeSha256: null
      })}\n`);

      const committed = readCommittedSite({ repoRoot: ctx.fixture.repoRoot, sourceSha: commit }, { run: createLocalGitReader().run });
      for (const file of committed.files) {
        const retained = fs.readFileSync(path.join(snapshotDir, file.path));
        expect(retained.equals(file.bytes)).toBe(true);
      }
      expect(fs.statSync(path.join(snapshotDir, 'scripts/serve.sh')).mode & 0o111).not.toBe(0);
      expect(fs.statSync(path.join(snapshotDir, 'assets/app-popover.png')).mode & 0o111).toBe(0);
      expect(fs.readFileSync(path.join(snapshotDir, '.assetsignore')).toString('utf8')).toBe(WEBSITE_IGNORE);

      const storedNext = persistedSiteState(ctx.fixture, next);
      const attempt = readSiteAttempt({ state: storedNext, repoDir: ctx.fixture.repoDir }, siteDeps());
      expect(attempt.descriptor.phase).toBe('prepared');
      expect(attempt.attemptDir).toBe(attemptDir);
      expect(attempt.descriptorBytes.equals(descriptorBytes)).toBe(true);
      expect(verifySiteSnapshot(
        { repoRoot: ctx.fixture.repoRoot, sourceSha: commit, treeSha, snapshotDir },
        { run: createLocalGitReader().run, fs }
      )).toEqual({ sourceSha: commit, treeSha });

      expect(readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs })).toEqual(next);
      expect(fs.readdirSync(path.join(ctx.fixture.repoDir, 'records', RELEASE_ID, 'site'))).toEqual([ATTEMPT_ID]);
      expect(fs.existsSync(path.join(ctx.fixture.repoDir, '.deploy'))).toBe(false);
      expect(fs.existsSync(path.join(ctx.fixture.repoRoot, '.deploy'))).toBe(false);
      expect(fs.existsSync(path.join(ctx.fixture.repoRoot, 'website/.wrangler'))).toBe(false);
      expect(liveSnapshot(ctx.fixture)).toEqual(before);
    });

    testPosix('refuses a retained snapshot with an extra file, an empty directory or a missing file', async () => {
      const ctx = await preparedContext();
      const { treeSha } = expectedInventory(ctx.fixture, ctx.state.sizes.commit);
      const reader = createLocalGitReader();
      const copy = path.join(OWNER, `snapshot-copy-${++seq}`);
      fs.cpSync(path.join(ctx.attemptDir, 'snapshot'), copy, { recursive: true });
      const args = { repoRoot: ctx.fixture.repoRoot, sourceSha: ctx.state.sizes.commit, treeSha, snapshotDir: copy };
      const deps = { run: reader.run, fs };
      expect(verifySiteSnapshot(args, deps)).toEqual({ sourceSha: ctx.state.sizes.commit, treeSha });

      write(copy, 'extra.txt', 'extra\n');
      expect(expectSiteRefusal(() => verifySiteSnapshot(args, deps)).message).toMatch(/unexpected file/);
      fs.rmSync(path.join(copy, 'extra.txt'));

      fs.mkdirSync(path.join(copy, 'empty'));
      expect(expectSiteRefusal(() => verifySiteSnapshot(args, deps)).message).toMatch(/unexpected directory/);
      fs.rmdirSync(path.join(copy, 'empty'));

      fs.rmSync(path.join(copy, 'index.html'));
      expect(expectSiteRefusal(() => verifySiteSnapshot(args, deps)).message).toMatch(/missing index.html/);

      expect(expectSiteRefusal(() => verifySiteSnapshot({ ...args, treeSha: '3'.repeat(40) }, deps)).message)
        .toMatch(/not the recorded subtree/);
      expect(expectSiteRefusal(() => verifySiteSnapshot({ ...args, snapshotDir: path.join(copy, 'missing') }, deps)).message)
        .toMatch(/missing/);
    });

    testPosix('refuses altered snapshot bytes, an altered executable mode and a symlinked leaf', async () => {
      const ctx = await preparedContext();
      const snapshotDir = path.join(ctx.attemptDir, 'snapshot');
      const deps = siteDeps();
      const readAttempt = () => readSiteAttempt({ state: ctx.prepared, repoDir: ctx.fixture.repoDir }, deps);
      expect(readAttempt().descriptor.phase).toBe('prepared');

      fs.appendFileSync(path.join(snapshotDir, 'index.html'), '\n');
      expect(expectSiteRefusal(readAttempt).message).toMatch(/bytes changed/);
      fs.writeFileSync(path.join(snapshotDir, 'index.html'), fs.readFileSync(path.join(ctx.fixture.repoRoot, 'website/index.html')));

      fs.chmodSync(path.join(snapshotDir, 'scripts/serve.sh'), 0o644);
      expect(expectSiteRefusal(readAttempt).message).toMatch(/executable mode changed/);
      fs.chmodSync(path.join(snapshotDir, 'scripts/serve.sh'), 0o755);

      const leaf = path.join(snapshotDir, 'assets/app-popover.png');
      fs.rmSync(leaf);
      fs.symlinkSync(path.join(ctx.fixture.repoRoot, 'website/assets/app-popover.png'), leaf);
      expect(expectSiteRefusal(readAttempt).message).toMatch(/symlink/);
      fs.rmSync(leaf);
      fs.writeFileSync(leaf, BINARY_PNG, { mode: 0o644 });
      expect(readAttempt().descriptor.phase).toBe('prepared');

      const descriptorFile = readDescriptorFile(ctx.fixture, ATTEMPT_ID);
      const pristine = fs.readFileSync(descriptorFile);
      fs.rmSync(descriptorFile);
      fs.symlinkSync(path.join(ctx.fixture.repoRoot, 'website/wrangler.jsonc'), descriptorFile);
      expect(expectSiteRefusal(readAttempt).message).toMatch(/ordinary file/);
      fs.rmSync(descriptorFile);
      fs.writeFileSync(descriptorFile, pristine, { mode: 0o600 });
      expect(readAttempt().descriptor.phase).toBe('prepared');
    });

    testPosix('accepts an unresolved descriptor and refuses a malformed or off-path one', async () => {
      const ctx = await preparedContext();
      const descriptorFile = readDescriptorFile(ctx.fixture, ATTEMPT_ID);
      const pristine = fs.readFileSync(descriptorFile);
      const base = JSON.parse(pristine.toString('utf8'));
      const readAttempt = () => readSiteAttempt({ state: ctx.prepared, repoDir: ctx.fixture.repoDir }, siteDeps());
      expect(readAttempt().descriptor).toEqual(base);

      writeDescriptorFile(ctx.fixture, ATTEMPT_ID, {
        ...base, phase: 'requested', requestedAt: REQUESTED_AT, receiptBeforeSha256: sha256(Buffer.from('preexisting\n'))
      });
      expect(readAttempt().descriptor.phase).toBe('requested');
      writeDescriptorFile(ctx.fixture, ATTEMPT_ID, { ...base, phase: 'unknown', requestedAt: REQUESTED_AT });
      expect(readAttempt().descriptor.phase).toBe('unknown');
      writeDescriptorFile(ctx.fixture, ATTEMPT_ID, {
        ...base, phase: 'complete', requestedAt: REQUESTED_AT, completedAt: NOW, receiptSha: base.sourceSha
      });
      expect(readAttempt().descriptor.phase).toBe('complete');

      const cases = [
        [{ phase: 'prepared', requestedAt: REQUESTED_AT }, /no request identity/],
        [{ phase: 'prepared', receiptBeforeSha256: sha256(Buffer.from('x')) }, /no request identity/],
        [{ phase: 'requested' }, /canonical request time/],
        [{ phase: 'requested', requestedAt: '2026-02-03T04:05:06Z' }, /canonical request time/],
        [{ phase: 'requested', requestedAt: REQUESTED_AT, completedAt: NOW }, /no completion identity/],
        [{ phase: 'requested', requestedAt: REQUESTED_AT, receiptBeforeSha256: 'ZZ' }, /invalid receipt preimage digest/],
        [{ phase: 'complete', requestedAt: REQUESTED_AT }, /canonical completion time/],
        [{ phase: 'complete', requestedAt: NOW_3, completedAt: REQUESTED_AT, receiptSha: base.sourceSha }, /must not complete before/],
        [{ phase: 'complete', requestedAt: REQUESTED_AT, completedAt: NOW, receiptSha: '9'.repeat(40) }, /captured receipt/],
        [{ phase: 'bogus' }, /unsupported phase/],
        [{ schema: 2 }, /unsupported schema/],
        [{ releaseId: ATTEMPT_ID_2 }, /different release/],
        [{ version: '9.9.9' }, /different version/],
        [{ attemptId: ATTEMPT_ID_2 }, /different attempt/],
        [{ sourceSha: '9'.repeat(40) }, /different site source/],
        [{ treeSha: '9'.repeat(40) }, /different site tree/],
        [{ snapshotDir: path.resolve('/tmp/elsewhere') }, /different snapshot/],
        [{ snapshotDir: path.join(ctx.attemptDir, 'elsewhere') }, /different snapshot/],
        [{ extra: true }, /exactly the supported fields/],
        [{ phase: undefined }, /exactly the supported fields/]
      ];
      for (const [patch, pattern] of cases) {
        writeDescriptorFile(ctx.fixture, ATTEMPT_ID, { ...base, ...patch });
        expect(expectSiteRefusal(readAttempt).message).toMatch(pattern);
      }

      fs.writeFileSync(descriptorFile, 'not json\n');
      expect(expectSiteRefusal(readAttempt).message).toMatch(/not valid JSON/);
      fs.rmSync(descriptorFile);
      expect(expectSiteRefusal(readAttempt).message).toMatch(/descriptor is missing/);
      fs.writeFileSync(descriptorFile, pristine, { mode: 0o600 });
      expect(readAttempt().descriptor).toEqual(base);

      fs.rmSync(path.join(ctx.attemptDir, 'snapshot'), { recursive: true });
      expect(expectSiteRefusal(readAttempt).message).toMatch(/snapshot is missing/);
      fs.chmodSync(ctx.attemptDir, 0o777);
      expect(expectSiteRefusal(readAttempt).message).toMatch(/group or other/);
    });

    testPosix('refuses an unresolved recorded attempt and retries only with a fresh identifier', async () => {
      const ctx = await preparedContext();
      const descriptorFile = readDescriptorFile(ctx.fixture, ATTEMPT_ID);
      const base = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
      writeDescriptorFile(ctx.fixture, ATTEMPT_ID, { ...base, phase: 'requested', requestedAt: REQUESTED_AT });
      const unknown = writeReleaseState({
        ...ctx.prepared,
        revision: ctx.prepared.revision + 1,
        updatedAt: NOW_2,
        site: {
          ...ctx.prepared.site,
          state: 'unknown',
          error: { code: 'SITE_DEPLOY_UNRESOLVED', message: 'The site deployment is unresolved.' }
        }
      }, ctx.fixture.identity, {
        cacheRoot: ctx.fixture.cacheRoot, expectedRevision: ctx.prepared.revision, fs
      });

      const unresolved = expectAttemptRefusal(() => prepareSiteAttempt(
        { state: unknown, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID_2 }, siteDeps(NOW_3)
      ));
      expect(unresolved.message).toMatch(/refuses an unresolved recorded site attempt/);
      const sameId = expectAttemptRefusal(() => prepareSiteAttempt(
        { state: unknown, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID, retrySite: true }, siteDeps(NOW_3)
      ));
      expect(sameId.message).toMatch(/fresh attempt identifier/);
      expectNoDescriptor(attemptDirOf(ctx.fixture, ATTEMPT_ID_2));
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');

      const retried = prepareSiteAttempt(
        { state: unknown, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID_2, retrySite: true }, siteDeps(NOW_3)
      );
      expect(retried.site.state).toBe('pending');
      expect(retried.site.attemptId).toBe(ATTEMPT_ID_2);
      expect(retried.site.treeSha).toBe(ctx.prepared.site.treeSha);
      expect(retried.site.sourceSha).toBe(ctx.state.sizes.commit);
      expect(retried.updatedAt).toBe(NOW_3);
      expect(fs.readdirSync(path.join(ctx.fixture.repoDir, 'records', RELEASE_ID, 'site')).sort())
        .toEqual([ATTEMPT_ID, ATTEMPT_ID_2].sort());
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID).requestedAt).toBe(REQUESTED_AT);

      const storedRetried = persistedSiteState(ctx.fixture, retried);
      const lateRetry = expectAttemptRefusal(() => prepareSiteAttempt(
        { state: storedRetried, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID_3, retrySite: true }, siteDeps(NOW_4)
      ));
      expect(lateRetry.message).toMatch(/retry requires an unresolved site target/);

      const abandoned = prepareSiteAttempt(
        { state: storedRetried, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID_3 }, siteDeps(NOW_4)
      );
      expect(abandoned.site.attemptId).toBe(ATTEMPT_ID_3);
      expect(fs.readdirSync(path.join(ctx.fixture.repoDir, 'records', RELEASE_ID, 'site')).sort())
        .toEqual([ATTEMPT_ID, ATTEMPT_ID_2, ATTEMPT_ID_3].sort());
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID_2).phase).toBe('prepared');
    });

    testPosix('refuses a recorded source that is not the completed size commit', async () => {
      const ctx = await completeSiteFixture();
      const older = writeReleaseState({
        ...ctx.state,
        revision: ctx.state.revision + 1,
        updatedAt: NOW_2,
        sizes: { ...ctx.state.sizes, commit: ctx.fixture.sourceSha }
      }, ctx.fixture.identity, {
        cacheRoot: ctx.fixture.cacheRoot, expectedRevision: ctx.state.revision, fs
      });
      const error = expectAttemptRefusal(() => prepareSiteAttempt(
        { state: older, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID }, siteDeps(NOW_3)
      ));
      expect(causeChain(error)).toMatch(/SIZE_EVIDENCE_INVALID/);
      expectNoSiteDirectory(ctx.fixture);
      expect(readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs })).toEqual(older);
    });

    testPosix('refuses a state that is not the persisted publish tail', async () => {
      const ctx = await completeSiteFixture();
      const cases = [
        [{ ...ctx.state, revision: ctx.state.revision + 4 }, /not the persisted release state/],
        [{ ...ctx.state, mode: 'dry-run' }, /state is invalid/],
        [{ ...ctx.state, phase: 'complete' }, /state is invalid/],
        [{ ...ctx.state, artifacts: { state: 'pending' } }, /state is invalid/],
        [{ ...ctx.state, site: { ...ctx.state.site, attemptId: ATTEMPT_ID } }, /not the persisted release state/]
      ];
      for (const [state, pattern] of cases) {
        const error = expectAttemptRefusal(() => prepareSiteAttempt(
          { state, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID }, siteDeps(NOW_3)
        ));
        expect(causeChain(error)).toMatch(pattern);
      }
      expectNoSiteDirectory(ctx.fixture);
    });

    testPosix('refuses a backwards or non-canonical clock before writing anything', async () => {
      const ctx = await completeSiteFixture();
      const backwards = expectAttemptRefusal(() => prepareSiteAttempt(
        { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID }, siteDeps('2026-01-01T00:00:00.000Z')
      ));
      expect(backwards.message).toMatch(/clock moved backwards/);
      for (const clock of [() => 'not-a-time', () => 12345, () => '2026-02-03T04:05:06Z']) {
        const reader = createLocalGitReader();
        const error = expectAttemptRefusal(() => prepareSiteAttempt(
          { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID },
          { run: reader.run, spawn: reader.spawn, fs, now: clock }
        ));
        expect(error.message).toMatch(/canonical timestamp/);
      }
      expectNoSiteDirectory(ctx.fixture);
    });

    testPosix('proves file fsync, nested directory flush, snapshot rename and descriptor-last ordering', async () => {
      const ctx = await completeSiteFixture();
      const adapter = recordingFs();
      const reader = createLocalGitReader();
      const next = prepareSiteAttempt(
        { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId: ATTEMPT_ID },
        { run: reader.run, spawn: reader.spawn, fs: adapter, now: () => NOW }
      );
      expect(next.site.attemptId).toBe(ATTEMPT_ID);

      const ops = opsOf(adapter);
      const attemptDir = attemptDirOf(ctx.fixture, ATTEMPT_ID);
      const staging = path.join(attemptDir, 'snapshot.pending');
      const snapshot = path.join(attemptDir, 'snapshot');
      const descriptor = path.join(attemptDir, 'site.json');
      const stateFile = path.join(ctx.fixture.repoDir, 'state.json');
      const committed = readCommittedSite(
        { repoRoot: ctx.fixture.repoRoot, sourceSha: ctx.state.sizes.commit }, { run: reader.run }
      );

      const snapshotRename = ops.indexOf(`rename:${snapshot}`);
      const descriptorRename = ops.indexOf(`rename:${descriptor}`);
      const stateRename = ops.indexOf(`rename:${stateFile}`);
      expect(snapshotRename).toBeGreaterThan(-1);
      expect(descriptorRename).toBeGreaterThan(snapshotRename);
      expect(stateRename).toBeGreaterThan(descriptorRename);
      expect(ops).toContain(`fsync:${attemptDir}`);
      expect(ops.indexOf(`fsync:${attemptDir}`)).toBeLessThan(descriptorRename);

      for (const file of committed.files) {
        const target = path.join(staging, file.path);
        const open = ops.indexOf(`open:${target}`);
        const written = ops.indexOf(`write:${target}`);
        const flushed = ops.indexOf(`fsync:${target}`);
        expect(open).toBeGreaterThan(-1);
        expect(written).toBeGreaterThan(open);
        expect(flushed).toBeGreaterThan(written);
        expect(flushed).toBeLessThan(snapshotRename);
        expect(ops.indexOf(`close:${target}`)).toBeGreaterThan(flushed);
      }

      const nested = path.join(staging, 'assets/deep/nested');
      expect(ops.indexOf(`mkdir:${nested}`)).toBeGreaterThan(-1);
      expect(ops.indexOf(`fsync:${path.join(staging, 'assets/deep')}`)).toBeGreaterThan(ops.indexOf(`mkdir:${nested}`));
      expect(ops.indexOf(`fsync:${path.join(staging, 'assets')}`)).toBeGreaterThan(-1);
      const lastFile = committed.files[committed.files.length - 1];
      expect(ops.lastIndexOf(`fsync:${staging}`)).toBeGreaterThan(ops.indexOf(`write:${path.join(staging, lastFile.path)}`));
      expect(ops.lastIndexOf(`fsync:${staging}`)).toBeLessThan(snapshotRename);

      expect(ops).toContain(`fsync:${attemptDir}`);
      expect(ops.indexOf(`rename:${descriptor}`)).toBeGreaterThan(ops.lastIndexOf(`fsync:${staging}`));
      expect(ops.indexOf(`rename:${path.join(ctx.fixture.repoDir, 'state.json')}`))
        .toBeGreaterThan(ops.indexOf(`rename:${descriptor}`));
    });

    testPosix('stops before the descriptor, before the snapshot and before the checkpoint on independent failures', async () => {
      const ctx = await completeSiteFixture();
      const reader = createLocalGitReader();
      const deps = (io) => ({ run: reader.run, spawn: reader.spawn, fs: io, now: () => NOW });
      const runPrepare = (attemptId, io) => refusal(() => prepareSiteAttempt(
        { state: ctx.state, repoDir: ctx.fixture.repoDir, attemptId }, deps(io)
      ));
      const stateOnDisk = () => readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });

      const first = attemptDirOf(ctx.fixture, ATTEMPT_ID);
      const flushFailure = recordingFs({
        fail: (op, target) => op === 'fsync' && target === path.join(first, 'snapshot.pending/index.html')
      });
      const flushError = runPrepare(ATTEMPT_ID, flushFailure);
      expect(flushError.code).toBe('SITE_ATTEMPT_FAILED');
      expect(causeChain(flushError)).toMatch(/EIO/);
      expect(flushFailure.faultMatches).toBeGreaterThan(0);
      expectNoDescriptor(first);
      expectNoSnapshot(first);
      expect(fs.existsSync(path.join(first, 'snapshot.pending/index.html'))).toBe(false);
      expect(stateOnDisk()).toEqual(ctx.state);

      const second = attemptDirOf(ctx.fixture, ATTEMPT_ID_2);
      const renameFailure = recordingFs({
        fail: (op, target) => op === 'rename' && target === path.join(second, 'site.json')
      });
      const renameError = runPrepare(ATTEMPT_ID_2, renameFailure);
      expect(renameError.code).toBe('SITE_ATTEMPT_FAILED');
      expect(causeChain(renameError)).toMatch(/STATE_IO_FAILED/);
      expect(renameFailure.faultMatches).toBeGreaterThan(0);
      expectNoDescriptor(second);
      expect(fs.existsSync(path.join(second, 'snapshot'))).toBe(true);
      expect(stateOnDisk()).toEqual(ctx.state);

      const third = attemptDirOf(ctx.fixture, ATTEMPT_ID_3);
      const stateFailure = recordingFs({
        fail: (op, target) => op === 'rename' && target === path.join(ctx.fixture.repoDir, 'state.json')
      });
      const stateError = runPrepare(ATTEMPT_ID_3, stateFailure);
      expect(stateError.code).toBe('SITE_ATTEMPT_FAILED');
      expect(causeChain(stateError)).toMatch(/STATE_IO_FAILED/);
      expect(stateFailure.faultMatches).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(third, 'site.json'))).toBe(true);
      expect(fs.existsSync(path.join(third, 'snapshot'))).toBe(true);
      expect(stateOnDisk()).toEqual(ctx.state);
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID_3).phase).toBe('prepared');
      expect(fs.readdirSync(path.join(ctx.fixture.repoDir, 'records', RELEASE_ID, 'site')).sort())
        .toEqual([ATTEMPT_ID, ATTEMPT_ID_2, ATTEMPT_ID_3].sort());
    });

    testPosix('refuses a committed tree with a symlink, a submodule or a case collision', async () => {
      const ctx = await completeSiteFixture();
      const head = git(ctx.fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
      const cases = [
        [hostileCommit(ctx.fixture, [{ mode: '120000', oid: head, path: 'website/link' }]), /unsupported mode/],
        [hostileCommit(ctx.fixture, [{ mode: '160000', oid: head, path: 'website/sub' }]), /non-blob entry/],
        [hostileCommit(ctx.fixture, [
          { bytes: 'A\n', path: 'website/assets/A.txt' },
          { bytes: 'a\n', path: 'website/assets/a.txt' }
        ]), /collides by case/],
        [hostileCommit(ctx.fixture, [{ bytes: 'x\n', path: 'website/.env' }]), /forbidden path/],
        [hostileCommit(ctx.fixture, [{ bytes: 'x\n', path: 'website/.dev.vars.local' }]), /forbidden path/],
        [hostileCommit(ctx.fixture, [{ remove: true, path: 'website/.assetsignore' }]), /missing .assetsignore/]
      ];
      for (const [commit, pattern] of cases) {
        const error = expectSiteRefusal(() => readCommittedSite(
          { repoRoot: ctx.fixture.repoRoot, sourceSha: commit }, { run: createLocalGitReader().run }
        ));
        expect(error.message).toMatch(pattern);
      }
      expect(liveSnapshot(ctx.fixture).status).toBe('');
    });

    testPosix('refuses an altered committed configuration or ignore file', async () => {
      const ctx = await completeSiteFixture();
      const cases = [
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG.replace('"hyperclaylocal"', '"otherworker"')),
          /different worker/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG.replace('"routes"', '"main": "src/index.js",\n  "routes"')),
          /unsupported fields/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG.replace('"compatibility_date": "2026-07-19"', '"compatibility_date": "july"')),
          /invalid compatibility date/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG.replace('"directory": "./"', '"directory": "./public"')),
          /serve the site root/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', WEBSITE_CONFIG.replace('"www.hyperclaylocal.com"', '"other.example.com"')),
          /two fixed custom-domain routes/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/wrangler.jsonc', '{ "name": "hyperclaylocal", }'),
          /not valid JSON/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/.assetsignore', `${WEBSITE_IGNORE}assets/\n`),
          /exactly the four fixed exclusions/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/.assetsignore', WEBSITE_IGNORE.replace('.DS_Store\n', '')),
          /exactly the four fixed exclusions/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/.assetsignore', `${WEBSITE_IGNORE}.assetsignore\n`),
          /exactly the four fixed exclusions/
        ],
        [
          () => write(ctx.fixture.repoRoot, 'website/.assetsignore', WEBSITE_IGNORE.replace('.DS_Store\n', '.assetsignore\n')),
          /repeats an exclusion/
        ]
      ];
      for (const [apply, pattern] of cases) {
        const commit = amendCommit(ctx.fixture, {
          touch: ['website/wrangler.jsonc', 'website/.assetsignore'],
          apply
        });
        const error = expectSiteRefusal(() => readCommittedSite(
          { repoRoot: ctx.fixture.repoRoot, sourceSha: commit }, { run: createLocalGitReader().run }
        ));
        expect(error.message).toMatch(pattern);
      }
      expect(git(ctx.fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
    });

    testPosix('refuses a source commit that is not in the object store or holds no website tree', async () => {
      const ctx = await completeSiteFixture();
      const reader = createLocalGitReader();
      expect(expectSiteRefusal(() => readCommittedSite(
        { repoRoot: ctx.fixture.repoRoot, sourceSha: '0'.repeat(40) }, { run: reader.run }
      )).message).toMatch(/Git read failed/);

      fs.rmSync(path.join(ctx.fixture.repoRoot, 'website'), { recursive: true, force: true });
      git(ctx.fixture.repoRoot, ['add', '-A']);
      git(ctx.fixture.repoRoot, ['commit', '-q', '-m', 'drop website']);
      const commit = git(ctx.fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
      expect(expectSiteRefusal(() => readCommittedSite(
        { repoRoot: ctx.fixture.repoRoot, sourceSha: commit }, { run: reader.run }
      )).message).toMatch(/exactly one website tree/);
    });
  });

function siteActingDeps(fixture, { deploy, guard, now = NOW, fs: io = fs } = {}) {
  const reader = createLocalGitReader();
  return {
    run: reader.run,
    spawn: reader.spawn,
    fs: io,
    now: () => now,
    assertPublishWindow: guard === undefined ? () => {} : guard,
    deploy
  };
}

async function runDefaultDeployChild(ctx, status) {
  const root = path.resolve(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(OWNER, `default-deploy-${++seq}-`));
  const bin = path.join(dir, 'bin');
  const resultFile = path.join(dir, 'result.json');
  const invocationFile = path.join(dir, 'invocation.json');
  const stdoutFile = path.join(dir, 'stdout.log');
  const stderrFile = path.join(dir, 'stderr.log');
  const runner = path.join(dir, 'runner.js');
  const shim = path.join(bin, 'npx');
  const outputBytes = (2 * 1024 * 1024) + 137;
  const stdoutMarker = `STDOUT-END-${status}`;
  const stderrMarker = `STDERR-END-${status}`;

  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(shim, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "fs.writeFileSync(process.env.INVOCATION_FILE, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));",
    "if (process.argv.slice(2).join(' ') !== 'wrangler deploy') process.exit(91);",
    "if (process.cwd() !== process.env.EXPECTED_DEPLOY_DIR) process.exit(92);",
    "process.stdout.write('o'.repeat(Number(process.env.OUTPUT_BYTES)));",
    "process.stdout.write(process.env.STDOUT_MARKER);",
    "process.stderr.write('e'.repeat(Number(process.env.OUTPUT_BYTES)));",
    "process.stderr.write(process.env.STDERR_MARKER);",
    'process.exitCode = Number(process.env.SHIM_STATUS);',
    ''
  ].join('\n'), { mode: 0o755 });
  fs.writeFileSync(runner, [
    "const fs = require('fs');",
    "const { runSiteAttempt } = require(process.env.RELEASE_SITE);",
    "const { createLocalGitReader } = require(process.env.RELEASE_LOCAL_READ);",
    'const input = JSON.parse(process.env.SITE_INPUT);',
    'const reader = createLocalGitReader();',
    'try {',
    '  const state = runSiteAttempt(input, {',
    '    run: reader.run,',
    '    spawn: reader.spawn,',
    '    fs,',
    '    now: () => process.env.NOW,',
    '    assertPublishWindow: () => {}',
    '  });',
    "  fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify({ ok: true, state }));",
    '} catch (error) {',
    '  const cause = error.cause;',
    '  fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify({',
    '    ok: false,',
    '    error: { code: error.code, message: error.message },',
    '    cause: cause && { code: cause.code, status: cause.status, signal: cause.signal, message: cause.message }',
    '  }));',
    '}',
    ''
  ].join('\n'));

  const stdout = fs.createWriteStream(stdoutFile);
  const stderr = fs.createWriteStream(stderrFile);
  const child = childProcess.spawn(process.execPath, [runner], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...GIT_ENV,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      RELEASE_SITE: path.join(root, 'scripts/release-site.js'),
      RELEASE_LOCAL_READ: path.join(root, 'scripts/release-local-read.js'),
      SITE_INPUT: JSON.stringify({ state: ctx.prepared, repoDir: ctx.fixture.repoDir }),
      RESULT_FILE: resultFile,
      INVOCATION_FILE: invocationFile,
      EXPECTED_DEPLOY_DIR: deployDirOf(ctx.fixture),
      OUTPUT_BYTES: String(outputBytes),
      STDOUT_MARKER: stdoutMarker,
      STDERR_MARKER: stderrMarker,
      SHIM_STATUS: String(status),
      NOW
    }
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const finished = (stream) => new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
  });
  const [exit] = await Promise.all([exitPromise, finished(stdout), finished(stderr)]);

  return {
    exit,
    outputBytes,
    stdoutMarker,
    stderrMarker,
    stdout: fs.readFileSync(stdoutFile),
    stderr: fs.readFileSync(stderrFile),
    result: JSON.parse(fs.readFileSync(resultFile, 'utf8')),
    invocation: JSON.parse(fs.readFileSync(invocationFile, 'utf8'))
  };
}

function receiptPathOf(fixture) {
  return path.join(fixture.repoRoot, '.deploy');
}

function deployDirOf(fixture, attemptId = ATTEMPT_ID) {
  return path.join(attemptDirOf(fixture, attemptId), 'deploy');
}

function stateFileOf(fixture) {
  return statePaths(fixture.identity, { cacheRoot: fixture.cacheRoot, fs }).stateFile;
}

function topLevelNames(files) {
  return Array.from(new Set(files.map((file) => file.path.split('/')[0]))).sort();
}

function expectStoppedAfter(adapter, entry) {
  const ops = opsOf(adapter);
  const index = ops.lastIndexOf(entry);
  expect(index).toBeGreaterThan(-1);
  expect(ops.slice(index + 1).every((next) =>
    next.startsWith('close:') || next.startsWith('unlink:')
  )).toBe(true);
}

const UNRESOLVED_SITE = {
  code: 'SITE_DEPLOY_UNRESOLVED',
  message: 'The site deployment is unresolved.'
};

describe('site acting', () => {
  testPosix('default deploy inherits complete output larger than the command capture limit and completes', async () => {
    const ctx = await preparedContext();
    const observed = await runDefaultDeployChild(ctx, 0);

    expect(observed.exit).toEqual({ code: 0, signal: null });
    expect(observed.invocation).toEqual({ args: ['wrangler', 'deploy'], cwd: deployDirOf(ctx.fixture) });
    expect(observed.stdout.length).toBe(observed.outputBytes + Buffer.byteLength(observed.stdoutMarker));
    expect(observed.stderr.length).toBe(observed.outputBytes + Buffer.byteLength(observed.stderrMarker));
    expect(observed.stdout.subarray(-Buffer.byteLength(observed.stdoutMarker)).toString()).toBe(observed.stdoutMarker);
    expect(observed.stderr.subarray(-Buffer.byteLength(observed.stderrMarker)).toString()).toBe(observed.stderrMarker);
    expect(observed.result.ok).toBe(true);
    expect(observed.result.state.site.state).toBe('complete');
    expect(observed.result.state.site.receiptSha).toBe(ctx.state.sizes.commit);
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${ctx.state.sizes.commit}\n`);
  });

  testPosix('default deploy retains complete diagnostic tails and leaves a nonzero command unresolved', async () => {
    const ctx = await preparedContext();
    const observed = await runDefaultDeployChild(ctx, 17);

    expect(observed.exit).toEqual({ code: 0, signal: null });
    expect(observed.invocation).toEqual({ args: ['wrangler', 'deploy'], cwd: deployDirOf(ctx.fixture) });
    expect(observed.stdout.length).toBe(observed.outputBytes + Buffer.byteLength(observed.stdoutMarker));
    expect(observed.stderr.length).toBe(observed.outputBytes + Buffer.byteLength(observed.stderrMarker));
    expect(observed.stdout.subarray(-Buffer.byteLength(observed.stdoutMarker)).toString()).toBe(observed.stdoutMarker);
    expect(observed.stderr.subarray(-Buffer.byteLength(observed.stderrMarker)).toString()).toBe(observed.stderrMarker);
    expect(observed.result).toMatchObject({
      ok: false,
      error: { code: 'SITE_DEPLOY_UNRESOLVED', message: 'The site deployment outcome is unresolved' },
      cause: { status: 17 }
    });
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.site.error).toEqual(UNRESOLVED_SITE);
  });

  testPosix('deploys once from the recorded snapshot and completes from the captured source receipt', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const deployDir = deployDirOf(ctx.fixture);
    const committed = readCommittedSite(
      { repoRoot: ctx.fixture.repoRoot, sourceSha }, { run: createLocalGitReader().run }
    );
    const calls = [];
    const order = [];
    const observed = [];
    const deploy = (dir) => {
      order.push('deploy');
      calls.push(dir);
      const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
      const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
      observed.push({
        dir,
        descriptor,
        site: live.site,
        revision: live.revision,
        updatedAt: live.updatedAt,
        receipt: fs.existsSync(receiptPathOf(ctx.fixture)),
        entries: fs.readdirSync(dir).sort(),
        index: fs.readFileSync(path.join(dir, 'index.html')),
        snapshotIndex: fs.readFileSync(path.join(ctx.attemptDir, 'snapshot', 'index.html'))
      });
      fs.mkdirSync(path.join(dir, '.wrangler/tmp'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, '.wrangler/tmp/deployment.json'), '{}\n');
      write(ctx.fixture.repoRoot, 'unrelated.txt', 'unrelated\n');
      git(ctx.fixture.repoRoot, ['add', '-A']);
      git(ctx.fixture.repoRoot, ['commit', '-q', '-m', 'unrelated work']);
    };

    const next = runSiteAttempt({ state: ctx.prepared, repoDir: ctx.fixture.repoDir }, siteActingDeps(ctx.fixture, {
      deploy,
      guard: () => order.push('guard')
    }));

    expect(order).toEqual(['guard', 'deploy']);
    expect(calls).toEqual([deployDir]);
    const seen = observed[0];
    expect(seen.dir).toBe(deployDir);
    expect(seen.descriptor.phase).toBe('requested');
    expect(seen.descriptor.requestedAt).toBe(NOW);
    expect(seen.descriptor.completedAt).toBeNull();
    expect(seen.descriptor.receiptBeforeSha256).toBeNull();
    expect(seen.site).toEqual({
      state: 'unknown',
      sourceSha,
      treeSha: ctx.prepared.site.treeSha,
      attemptId: ATTEMPT_ID,
      receiptSha: null,
      verifiedAt: null,
      error: UNRESOLVED_SITE
    });
    expect(seen.revision).toBe(ctx.prepared.revision + 1);
    expect(seen.updatedAt).toBe(NOW);
    expect(seen.receipt).toBe(false);
    expect(seen.entries).toEqual(topLevelNames(committed.files));
    expect(seen.index.equals(committed.files.find((file) => file.path === 'index.html').bytes)).toBe(true);
    expect(seen.snapshotIndex.equals(seen.index)).toBe(true);

    expect(next.site.state).toBe('complete');
    expect(next.site.sourceSha).toBe(sourceSha);
    expect(next.site.treeSha).toBe(ctx.prepared.site.treeSha);
    expect(next.site.attemptId).toBe(ATTEMPT_ID);
    expect(next.site.receiptSha).toBe(sourceSha);
    expect(next.site.verifiedAt).toBe(NOW);
    expect(next.site.error).toBeNull();
    expect(next.revision).toBe(ctx.prepared.revision + 2);
    persistedSiteState(ctx.fixture, next);

    const completed = readSiteAttempt({ state: next, repoDir: ctx.fixture.repoDir }, siteDeps());
    expect(completed.descriptor.phase).toBe('complete');
    expect(completed.descriptor.completedAt).toBe(NOW);
    expect(completed.descriptor.receiptSha).toBe(sourceSha);
    expect(completed.descriptor.receiptBeforeSha256).toBeNull();
    expect(completed.attemptDir).toBe(ctx.attemptDir);

    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    expect(git(ctx.fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(sourceSha);
    expect(git(ctx.fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('?? .deploy');

    const settled = reconcileSiteAttempt({ state: next, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(settled).toEqual(next);
    expect(calls).toEqual([deployDir]);

    const again = expectAttemptRefusal(() => runSiteAttempt(
      { state: next, repoDir: ctx.fixture.repoDir }, siteActingDeps(ctx.fixture, { deploy })
    ));
    expect(again.message).toMatch(/pending site target|persisted release state/);
    expect(calls).toEqual([deployDir]);
  });

  testPosix('records the request and the unresolved checkpoint without calling a closed publish window', async () => {
    const ctx = await preparedContext();
    const calls = [];
    const error = refusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, {
        deploy: (dir) => { calls.push(dir); },
        guard: () => { throw new Error('the release window is closed'); }
      })
    ));
    expect(error.message).toBe('the release window is closed');
    expect(calls).toEqual([]);
    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(descriptor.phase).toBe('requested');
    expect(descriptor.requestedAt).toBe(NOW);
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.site.error).toEqual(UNRESOLVED_SITE);
    expect(live.revision).toBe(ctx.prepared.revision + 1);
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    expect(fs.readdirSync(deployDirOf(ctx.fixture)).sort()).toEqual(['index.html', 'wrangler.jsonc', '.assetsignore', 'assets', 'fonts', 'scripts'].sort());

    const unresolved = reconcileSiteAttempt({ state: live, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(unresolved).toEqual(live);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(calls).toEqual([]);
  });

  testPosix('site acting boundary refuses copy drift after the unknown checkpoint', async () => {
    const ctx = await preparedContext();
    const deployDir = deployDirOf(ctx.fixture);
    const snapshotDir = path.join(ctx.attemptDir, 'snapshot');
    const retainedBefore = liveTreeDigest(snapshotDir);
    const laneFile = stateFileOf(ctx.fixture);
    const adapter = recordingFs();
    const realRename = adapter.renameSync;
    let injections = 0;
    adapter.renameSync = (from, to) => {
      const outcome = realRename(from, to);
      if (to === laneFile && injections === 0) {
        injections += 1;
        fs.appendFileSync(path.join(deployDir, 'index.html'), '\n');
      }
      return outcome;
    };
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { fs: adapter, deploy: (dir) => { calls.push(dir); } })
    ));
    expect(injections).toBe(1);
    expect(calls).toEqual([]);
    expect(error.message).toBe('The site deployment copy changed before the deployment');
    expect(causeChain(error)).toMatch(/bytes changed: index.html/);
    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(descriptor.phase).toBe('requested');
    expect(descriptor.requestedAt).toBe(NOW);
    expect(descriptor.completedAt).toBeNull();
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.site.error).toEqual(UNRESOLVED_SITE);
    expect(live.revision).toBe(ctx.prepared.revision + 1);
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    expect(liveTreeDigest(snapshotDir)).toBe(retainedBefore);
  });

  testPosix('site acting boundary retains the thrown deployment error', async () => {
    const ctx = await preparedContext();
    const deployDir = deployDirOf(ctx.fixture);
    const calls = [];
    const thrown = new Error('wrangler deploy failed');
    thrown.status = 17;
    thrown.signal = 'SIGKILL';
    thrown.stdout = 'deployed stdout marker';
    thrown.stderr = 'deployed stderr marker';
    const error = refusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { deploy: (dir) => { calls.push(dir); throw thrown; } })
    ));
    expect(calls).toEqual([deployDir]);
    expect(error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(error.message).toBe('The site deployment outcome is unresolved');
    expect(error.cause).toBe(thrown);
    expect(error.cause.status).toBe(17);
    expect(error.cause.signal).toBe('SIGKILL');
    expect(error.cause.stdout).toBe('deployed stdout marker');
    expect(error.cause.stderr).toBe('deployed stderr marker');
    for (const detail of ['17', 'SIGKILL', 'deployed stdout marker', 'deployed stderr marker']) {
      expect(error.message).not.toContain(detail);
    }
    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(descriptor.phase).toBe('requested');
    expect(descriptor.requestedAt).toBe(NOW);
    expect(descriptor.completedAt).toBeNull();
    expect(descriptor.receiptSha).toBeNull();
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.site.error).toEqual(UNRESOLVED_SITE);
    expect(live.revision).toBe(ctx.prepared.revision + 1);
    expect(live.site.receiptSha).toBeNull();
  });

  testPosix('calls no deployment when the unresolved checkpoint cannot be published', async () => {
    const ctx = await preparedContext();
    const laneFile = stateFileOf(ctx.fixture);
    const adapter = recordingFs({ fail: (op, target) => op === 'rename' && target === laneFile });
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { fs: adapter, deploy: (dir) => { calls.push(dir); } })
    ));
    expect(error.code).toBe('SITE_ATTEMPT_FAILED');
    expect(causeChain(error)).toMatch(/STATE_IO_FAILED/);
    expect(calls).toEqual([]);
    expectStoppedAfter(adapter, `rename:${laneFile}`);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    expect(readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs })).toEqual(ctx.prepared);

    const unresolved = reconcileSiteAttempt({ state: ctx.prepared, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(unresolved.site.state).toBe('unknown');
    expect(unresolved.site.error).toEqual(UNRESOLVED_SITE);
    expect(unresolved.revision).toBe(ctx.prepared.revision + 1);
    expect(unresolved.updatedAt).toBe(NOW_2);
    persistedSiteState(ctx.fixture, unresolved);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    expect(calls).toEqual([]);
  });

  const interruptions = [
    ['a thrown command failure', { mode: 'throw', status: 1, message: 'wrangler deploy failed' }, /^The site deployment outcome is unresolved$/],
    ['a killed command', { mode: 'throw', signal: 'SIGKILL', message: 'wrangler deploy was killed' }, /^The site deployment outcome is unresolved$/],
    ['a thenable return', { mode: 'thenable' }, /synchronously without a return value/],
    ['an unexpected status return', { mode: 'return' }, /synchronously without a return value/]
  ];

  testPosix.each(interruptions)('leaves an unresolved attempt for every interrupted deployment without retrying: %s', async (name, shape, pattern) => {
    const ctx = await preparedContext();
    const deployDir = deployDirOf(ctx.fixture);
    const calls = [];
    const thrown = new Error(shape.message);
    if (shape.status !== undefined) thrown.status = shape.status;
    if (shape.signal !== undefined) thrown.signal = shape.signal;
    const deploy = (dir) => {
      calls.push(dir);
      if (shape.mode === 'throw') throw thrown;
      if (shape.mode === 'thenable') return Promise.resolve('deployed');
      return { status: 0, stdout: 'deployed' };
    };

    const error = refusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir }, siteActingDeps(ctx.fixture, { deploy })
    ));
    expect(error.code).toBe(shape.mode === 'throw' ? 'SITE_DEPLOY_UNRESOLVED' : 'SITE_ATTEMPT_FAILED');
    expect(error.message).toMatch(pattern);
    if (shape.mode === 'throw') {
      expect(error.message).toBe('The site deployment outcome is unresolved');
      expect(error.cause).toBe(thrown);
    }
    expect(calls).toEqual([deployDir]);

    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(`${name}: ${descriptor.phase}`).toBe(`${name}: requested`);
    expect(descriptor.completedAt).toBeNull();
    expect(descriptor.receiptSha).toBeNull();
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);

    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site).toEqual({
      state: 'unknown',
      sourceSha: ctx.state.sizes.commit,
      treeSha: ctx.prepared.site.treeSha,
      attemptId: ATTEMPT_ID,
      receiptSha: null,
      verifiedAt: null,
      error: UNRESOLVED_SITE
    });
    expect(live.revision).toBe(ctx.prepared.revision + 1);

    const reconciled = reconcileSiteAttempt({ state: live, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(reconciled).toEqual(live);
    const again = expectAttemptRefusal(() => runSiteAttempt(
      { state: live, repoDir: ctx.fixture.repoDir }, siteActingDeps(ctx.fixture, { deploy })
    ));
    expect(`${name}: ${again.message}`).toMatch(/pending site target|persisted release state/);
    expect(calls).toEqual([deployDir]);
  });

  testPosix('cannot reconcile a stale receipt that predates the request but recovers a distinguishable one', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const receiptFile = receiptPathOf(ctx.fixture);
    fs.writeFileSync(receiptFile, `${sourceSha}\n`, { mode: 0o600 });
    const calls = [];
    const thrown = new Error('wrangler deploy was interrupted');
    thrown.status = 1;
    const error = refusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { deploy: (dir) => { calls.push(dir); throw thrown; } })
    ));
    expect(error.code).toBe('SITE_DEPLOY_UNRESOLVED');
    expect(error.message).toBe('The site deployment outcome is unresolved');
    expect(error.cause).toBe(thrown);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
    const recorded = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(recorded.phase).toBe('requested');
    expect(recorded.receiptBeforeSha256).toBe(sha256(Buffer.from(`${sourceSha}\n`)));
    const unknown = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(unknown.site.state).toBe('unknown');

    const stale = reconcileSiteAttempt({ state: unknown, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(stale).toEqual(unknown);
    expect(stale.revision).toBe(unknown.revision);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(fs.readFileSync(receiptFile, 'utf8')).toBe(`${sourceSha}\n`);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);

    fs.writeFileSync(receiptFile, sourceSha, { mode: 0o600 });
    const recovered = reconcileSiteAttempt({ state: unknown, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(recovered.site.state).toBe('complete');
    expect(recovered.site.sourceSha).toBe(sourceSha);
    expect(recovered.site.treeSha).toBe(ctx.prepared.site.treeSha);
    expect(recovered.site.attemptId).toBe(ATTEMPT_ID);
    expect(recovered.site.receiptSha).toBe(sourceSha);
    expect(recovered.site.verifiedAt).toBe(NOW_2);
    expect(recovered.site.error).toBeNull();
    expect(recovered.revision).toBe(unknown.revision + 1);
    persistedSiteState(ctx.fixture, recovered);
    const completed = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(completed.phase).toBe('complete');
    expect(completed.completedAt).toBe(NOW_2);
    expect(completed.requestedAt).toBe(NOW);
    expect(completed.receiptSha).toBe(sourceSha);
    expect(fs.readFileSync(receiptFile, 'utf8')).toBe(sourceSha);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
  });

  testPosix('stops before the descriptor and the complete checkpoint when the receipt flush fails, then recovers', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const adapter = recordingFs({ fail: (op, target) => op === 'fsync' && target === ctx.fixture.repoRoot });
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { fs: adapter, deploy: (dir) => { calls.push(dir); } })
    ));
    expect(causeChain(error)).toMatch(/STATE_IO_FAILED/);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
    expectStoppedAfter(adapter, `fsync:${ctx.fixture.repoRoot}`);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    const unknown = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(unknown.site.state).toBe('unknown');
    expect(unknown.revision).toBe(ctx.prepared.revision + 1);

    const recovered = reconcileSiteAttempt({ state: unknown, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(recovered.site.state).toBe('complete');
    expect(recovered.site.receiptSha).toBe(sourceSha);
    expect(recovered.site.verifiedAt).toBe(NOW_2);
    persistedSiteState(ctx.fixture, recovered);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('complete');
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
  });

  testPosix('stops before the complete checkpoint when the complete descriptor cannot be published, then recovers', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const descriptorFile = readDescriptorFile(ctx.fixture, ATTEMPT_ID);
    let renames = 0;
    const adapter = recordingFs({
      fail: (op, target) => {
        if (op !== 'rename' || target !== descriptorFile) return false;
        renames += 1;
        return renames === 2;
      }
    });
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { fs: adapter, deploy: (dir) => { calls.push(dir); } })
    ));
    expect(causeChain(error)).toMatch(/STATE_IO_FAILED/);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
    expect(renames).toBe(2);
    expectStoppedAfter(adapter, `rename:${descriptorFile}`);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    const unknown = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(unknown.site.state).toBe('unknown');

    const recovered = reconcileSiteAttempt({ state: unknown, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(recovered.site.state).toBe('complete');
    expect(recovered.site.verifiedAt).toBe(NOW_2);
    persistedSiteState(ctx.fixture, recovered);
    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(descriptor.phase).toBe('complete');
    expect(descriptor.completedAt).toBe(NOW_2);
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
  });

  testPosix('replays a completed descriptor into the state when the complete checkpoint cannot be published', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const laneFile = stateFileOf(ctx.fixture);
    let renames = 0;
    const adapter = recordingFs({
      fail: (op, target) => {
        if (op !== 'rename' || target !== laneFile) return false;
        renames += 1;
        return renames === 2;
      }
    });
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { fs: adapter, deploy: (dir) => { calls.push(dir); } })
    ));
    expect(causeChain(error)).toMatch(/STATE_IO_FAILED/);
    expect(renames).toBe(2);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
    expectStoppedAfter(adapter, `rename:${laneFile}`);
    const complete = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(complete.phase).toBe('complete');
    expect(complete.completedAt).toBe(NOW);
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(`${sourceSha}\n`);
    const unknown = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(unknown.site.state).toBe('unknown');
    expect(unknown.revision).toBe(ctx.prepared.revision + 1);

    const replayed = reconcileSiteAttempt({ state: unknown, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2));
    expect(replayed.site.state).toBe('complete');
    expect(replayed.site.sourceSha).toBe(sourceSha);
    expect(replayed.site.receiptSha).toBe(sourceSha);
    expect(replayed.site.verifiedAt).toBe(NOW);
    expect(replayed.updatedAt).toBe(NOW_2);
    expect(replayed.revision).toBe(unknown.revision + 1);
    persistedSiteState(ctx.fixture, replayed);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('complete');
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
  });

  const mutations = [
    ['an extra file', (dir) => fs.writeFileSync(path.join(dir, 'extra.txt'), 'extra\n'), /unexpected file: extra.txt/],
    ['an environment file', (dir) => fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n'), /unexpected file: .env/],
    ['changed bytes', (dir) => fs.appendFileSync(path.join(dir, 'index.html'), '\n'), /bytes changed: index.html/],
    [
      'a file in place of generated metadata',
      (dir) => fs.writeFileSync(path.join(dir, '.wrangler'), '{}\n'),
      /Wrangler working directory must be a real directory/
    ],
    [
      'nested generated metadata',
      (dir) => fs.mkdirSync(path.join(dir, 'assets', '.wrangler', 'tmp'), { recursive: true }),
      /unexpected directory: assets\/.wrangler/
    ]
  ];

  testPosix.each(mutations)('refuses a deployment copy or receipt that changed while the site was deployed: %s', async (name, mutate, pattern) => {
    const ctx = await preparedContext();
    const deployDir = deployDirOf(ctx.fixture);
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { deploy: (dir) => { calls.push(dir); mutate(dir); } })
    ));
    expect(`${name}: ${causeChain(error)}`).toMatch(pattern);
    expect(calls).toEqual([deployDir]);
    const descriptor = readDescriptor(ctx.fixture, ATTEMPT_ID);
    expect(`${name}: ${descriptor.phase}`).toBe(`${name}: requested`);
    expect(descriptor.completedAt).toBeNull();
    expect(fs.existsSync(receiptPathOf(ctx.fixture))).toBe(false);
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.site.receiptSha).toBeNull();
    expect(live.revision).toBe(ctx.prepared.revision + 1);
  });

  testPosix('refuses to overwrite a receipt that changed while the site was deployed', async () => {
    const ctx = await preparedContext();
    const sourceSha = ctx.state.sizes.commit;
    const changed = `${'9'.repeat(40)}\n`;
    const calls = [];
    const error = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, {
        deploy: (dir) => {
          calls.push(dir);
          fs.writeFileSync(receiptPathOf(ctx.fixture), changed, { mode: 0o600 });
        }
      })
    ));
    expect(error.message).toMatch(/receipt changed while the site was deployed/);
    expect(calls).toEqual([deployDirOf(ctx.fixture)]);
    expect(fs.readFileSync(receiptPathOf(ctx.fixture), 'utf8')).toBe(changed);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('requested');
    const live = readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs });
    expect(live.site.state).toBe('unknown');
    expect(live.revision).toBe(ctx.prepared.revision + 1);
    expect(live.site.receiptSha).toBeNull();
    expect(sourceSha).toBe(ctx.state.sizes.commit);
  });

  testPosix('refuses an altered retained snapshot and an existing deployment directory before recording a request', async () => {
    const altered = await preparedContext();
    fs.appendFileSync(path.join(altered.attemptDir, 'snapshot', 'index.html'), '\n');
    const alteredCalls = [];
    const alteredError = expectAttemptRefusal(() => runSiteAttempt(
      { state: altered.prepared, repoDir: altered.fixture.repoDir },
      siteActingDeps(altered.fixture, { deploy: (dir) => { alteredCalls.push(dir); } })
    ));
    expect(causeChain(alteredError)).toMatch(/SITE_EVIDENCE_INVALID:.*bytes changed/);
    expect(alteredCalls).toEqual([]);
    expect(fs.existsSync(deployDirOf(altered.fixture))).toBe(false);
    expect(readDescriptor(altered.fixture, ATTEMPT_ID).phase).toBe('prepared');
    expect(fs.existsSync(receiptPathOf(altered.fixture))).toBe(false);
    expect(readReleaseState(altered.fixture.identity, { cacheRoot: altered.fixture.cacheRoot, fs }))
      .toEqual(altered.prepared);

    const leftover = await preparedContext();
    const leftoverDir = deployDirOf(leftover.fixture);
    fs.mkdirSync(leftoverDir, { mode: 0o700 });
    write(leftoverDir, 'partial.txt', 'partial\n');
    const leftoverCalls = [];
    const leftoverError = expectAttemptRefusal(() => runSiteAttempt(
      { state: leftover.prepared, repoDir: leftover.fixture.repoDir },
      siteActingDeps(leftover.fixture, { deploy: (dir) => { leftoverCalls.push(dir); } })
    ));
    expect(leftoverError.message).toMatch(/already exists/);
    expect(leftoverCalls).toEqual([]);
    expect(fs.readFileSync(path.join(leftoverDir, 'partial.txt'), 'utf8')).toBe('partial\n');
    expect(readDescriptor(leftover.fixture, ATTEMPT_ID).phase).toBe('prepared');
    expect(fs.existsSync(receiptPathOf(leftover.fixture))).toBe(false);

    const unchanged = reconcileSiteAttempt({ state: leftover.prepared, repoDir: leftover.fixture.repoDir }, siteDeps(NOW_2));
    expect(unchanged).toEqual(leftover.prepared);
    expect(fs.readFileSync(path.join(leftoverDir, 'partial.txt'), 'utf8')).toBe('partial\n');
    expect(readDescriptor(leftover.fixture, ATTEMPT_ID).phase).toBe('prepared');
    expect(leftoverCalls).toEqual([]);
  });

  testPosix('refuses a malformed, oversized or symlinked live receipt without a deployment', async () => {
    const ctx = await preparedContext();
    const receiptFile = receiptPathOf(ctx.fixture);
    const cases = [
      ['plain text', 'not an object identifier\n', /not one recorded object identifier/],
      ['uppercase digits', `${'A'.repeat(40)}\n`, /not one recorded object identifier/],
      ['two newlines', `${ctx.state.sizes.commit}\n\n`, /not one recorded object identifier/],
      ['an oversized body', `${'9'.repeat(200)}\n`, /receipt is not readable/]
    ];
    for (const [name, body, pattern] of cases) {
      fs.writeFileSync(receiptFile, body, { mode: 0o600 });
      const calls = [];
      const error = expectAttemptRefusal(() => runSiteAttempt(
        { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
        siteActingDeps(ctx.fixture, { deploy: (dir) => { calls.push(dir); } })
      ));
      expect(`${name}: ${causeChain(error)}`).toMatch(pattern);
      expect(calls).toEqual([]);
      expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('prepared');
      expect(fs.readFileSync(receiptFile, 'utf8')).toBe(body);
      const reconcileError = expectAttemptRefusal(() => reconcileSiteAttempt(
        { state: ctx.prepared, repoDir: ctx.fixture.repoDir }, siteDeps(NOW_2)
      ));
      expect(`${name}: ${causeChain(reconcileError)}`).toMatch(pattern);
      expect(readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs })).toEqual(ctx.prepared);
      const abandonedCopy = deployDirOf(ctx.fixture);
      if (fs.existsSync(abandonedCopy)) fs.rmSync(abandonedCopy, { recursive: true });
    }

    fs.rmSync(receiptFile);
    fs.symlinkSync(path.join(ctx.fixture.repoRoot, 'website/index.html'), receiptFile);
    const symlinkCalls = [];
    const symlinkError = expectAttemptRefusal(() => runSiteAttempt(
      { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
      siteActingDeps(ctx.fixture, { deploy: (dir) => { symlinkCalls.push(dir); } })
    ));
    expect(causeChain(symlinkError)).toMatch(/receipt is not readable/);
    expect(symlinkCalls).toEqual([]);
    expect(readDescriptor(ctx.fixture, ATTEMPT_ID).phase).toBe('prepared');
    expect(readReleaseState(ctx.fixture.identity, { cacheRoot: ctx.fixture.cacheRoot, fs })).toEqual(ctx.prepared);
  });
});

// Historical site evidence is certified from the retained descriptor, the retained
// snapshot and the recorded size commit alone. The live checkout, the origin, the
// live receipt and the current clock are all irrelevant to that proof, so the read
// boundary below exposes only the immutable local Git reads and the read-only
// filesystem calls a pure read needs: anything else fails loudly.
const READ_GIT_COMMANDS = ['cat-file', 'ls-tree', 'rev-parse'];

function historicalFs(events) {
  const realpathSync = (target) => { events.push(`realpath:${label(target)}`); return fs.realpathSync.native(target); };
  realpathSync.native = realpathSync;
  const allowed = {
    constants: fs.constants,
    lstatSync: (target) => { events.push(`lstat:${label(target)}`); return fs.lstatSync(target); },
    statSync: (target) => { events.push(`stat:${label(target)}`); return fs.statSync(target); },
    realpathSync,
    readdirSync: (target) => { events.push(`readdir:${label(target)}`); return fs.readdirSync(target); },
    openSync: (target, flags) => { events.push(`open:${label(target)}`); return fs.openSync(target, flags); },
    fstatSync: (fd) => { events.push(`fstat:fd:${fd}`); return fs.fstatSync(fd); },
    readSync: (fd, buffer, offset, length, position) => {
      events.push(`read:fd:${fd}`);
      return fs.readSync(fd, buffer, offset, length, position);
    },
    closeSync: (fd) => { events.push(`close:fd:${fd}`); return fs.closeSync(fd); }
  };
  return new Proxy(allowed, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      throw new Error(`Historical site evidence must not use filesystem ${String(prop)}`);
    }
  });
}

function historicalDeps(fixture) {
  const reader = createLocalGitReader();
  const calls = [];
  const objectReads = [];
  const events = [];
  const forbidden = (name) => () => {
    throw new Error(`${name} must not be entered for a historical site read`);
  };
  return {
    calls,
    objectReads,
    events,
    deps: {
      run: (command, args, options) => {
        calls.push(args.slice());
        if (args[0] === 'cat-file') objectReads.push(args[2]);
        if (args[0] === 'ls-tree' && args.includes('-r')) objectReads.push(args[args.length - 1]);
        return reader.run(command, args, options);
      },
      fs: historicalFs(events),
      spawn: forbidden('spawn'),
      now: forbidden('now'),
      deploy: forbidden('deploy'),
      fetch: forbidden('fetch'),
      withReleaseLock: forbidden('withReleaseLock'),
      withFerryRepoLock: forbidden('withFerryRepoLock')
    }
  };
}

async function completedSiteFixture() {
  const ctx = await preparedContext();
  const completed = runSiteAttempt(
    { state: ctx.prepared, repoDir: ctx.fixture.repoDir },
    siteActingDeps(ctx.fixture, { deploy: () => {} })
  );
  return { ...ctx, completed, state: persistedSiteState(ctx.fixture, completed) };
}

function stateVariant(state, mutate) {
  const copy = JSON.parse(JSON.stringify(state));
  mutate(copy);
  return copy;
}

describe('site historical', () => {
  let completed;

  beforeAll(async () => {
    if (process.platform === 'win32') return;
    completed = await completedSiteFixture();
  });

  testPosix('certifies the retained completion without reading the current checkout', async () => {
    const fixture = completed.fixture;
    const state = completed.state;
    const descriptorFile = readDescriptorFile(fixture, ATTEMPT_ID);
    const descriptor = readDescriptor(fixture, ATTEMPT_ID);
    const descriptorBytes = fs.readFileSync(descriptorFile);
    const { deps, calls, objectReads, events } = historicalDeps(fixture);
    const worktreeBefore = liveSnapshot(fixture);
    const cacheBefore = liveTreeDigest(fixture.cacheRoot);
    const receiptBefore = fs.readFileSync(receiptPathOf(fixture), 'utf8');

    const proof = readSiteEvidence({ state, repoDir: fixture.repoDir }, deps);

    expect(Object.keys(proof)).toEqual(['sourceSha', 'treeSha', 'attemptId', 'receiptSha', 'verifiedAt']);
    expect(proof).toEqual({
      sourceSha: descriptor.sourceSha,
      treeSha: descriptor.treeSha,
      attemptId: descriptor.attemptId,
      receiptSha: descriptor.receiptSha,
      verifiedAt: descriptor.completedAt
    });
    expect(proof).toEqual({
      sourceSha: state.site.sourceSha,
      treeSha: state.site.treeSha,
      attemptId: state.site.attemptId,
      receiptSha: state.site.receiptSha,
      verifiedAt: state.site.verifiedAt
    });
    expect(descriptor.phase).toBe('complete');
    expect(proof.sourceSha).toBe(state.sizes.commit);
    expect(proof.verifiedAt).toBe(NOW);
    expect(proof.attemptId).toBe(ATTEMPT_ID);

    expect(objectReads.length).toBe(expectedInventory(fixture, state.sizes.commit).paths.length + 1);
    expect(objectReads.length).toBeGreaterThan(0);
    expect(calls.every((args) => READ_GIT_COMMANDS.includes(args[0]))).toBe(true);
    expect(calls.map((args) => args[0])).toEqual(expect.arrayContaining(['cat-file', 'ls-tree', 'rev-parse']));
    expect(events.some((event) => event.startsWith('read:fd:'))).toBe(true);
    expect(events).toContain(`readdir:${path.join(completed.attemptDir, 'snapshot')}`);
    expect(events.every((event) =>
      /^(lstat|stat|realpath|readdir|open|fstat|read|close):/.test(event)
    )).toBe(true);

    expect(fs.readFileSync(descriptorFile)).toEqual(descriptorBytes);
    expect(fs.readFileSync(receiptPathOf(fixture), 'utf8')).toBe(receiptBefore);
    expect(liveSnapshot(fixture)).toEqual(worktreeBefore);
    expect(liveTreeDigest(fixture.cacheRoot)).toBe(cacheBefore);
  });

  test('requires a complete saved site target before touching a read dependency', () => {
    const forbiddenFs = new Proxy({}, {
      get(target, prop) {
        throw new Error(`filesystem ${String(prop)} must not be touched`);
      }
    });
    const forbiddenRun = () => {
      throw new Error('Git must not be read');
    };
    const repoDir = path.resolve('/tmp/site-evidence');
    const states = [undefined, null, {}, { site: null }, { site: {} }, { site: { state: 'pending' } }, { site: { state: 'unknown' } }];
    for (const state of states) {
      const error = expectSiteRefusal(
        () => readSiteEvidence({ state, repoDir }, { run: forbiddenRun, fs: forbiddenFs })
      );
      expect(error.message).toMatch(/Complete site evidence is required/);
    }
  });

  testPosix('keeps the retained completion when the checkout, the origin and the live receipt move on', async () => {
    const ctx = await completedSiteFixture();
    const fixture = ctx.fixture;
    const state = ctx.state;
    const descriptorFile = readDescriptorFile(fixture, ATTEMPT_ID);
    const descriptorBytes = fs.readFileSync(descriptorFile);
    const first = readSiteEvidence({ state, repoDir: fixture.repoDir }, historicalDeps(fixture).deps);

    write(fixture.repoRoot, 'website/index.html', websiteFixture(MB_NEW));
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'later website']);
    git(fixture.repoRoot, ['checkout', '-q', '-b', 'feature']);
    git(fixture.repoRoot, ['remote', 'set-url', 'origin', fixture.pushRemote]);
    fs.writeFileSync(receiptPathOf(fixture), 'not an object identifier\n', { mode: 0o600 });

    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(state.sizes.commit);
    expect(git(fixture.repoRoot, ['symbolic-ref', '-q', 'HEAD']).trim()).toBe('refs/heads/feature');
    expect(git(fixture.repoRoot, ['remote', 'get-url', 'origin']).trim()).toBe(fixture.pushRemote);

    const worktreeBefore = liveSnapshot(fixture);
    const cacheBefore = liveTreeDigest(fixture.cacheRoot);
    const malformed = historicalDeps(fixture);
    const despiteReceipt = readSiteEvidence({ state, repoDir: fixture.repoDir }, malformed.deps);
    expect(liveSnapshot(fixture)).toEqual(worktreeBefore);
    expect(liveTreeDigest(fixture.cacheRoot)).toBe(cacheBefore);
    expect(despiteReceipt).toEqual(first);
    expect(despiteReceipt.verifiedAt).toBe(NOW);
    expect(despiteReceipt).toEqual({
      sourceSha: state.site.sourceSha,
      treeSha: state.site.treeSha,
      attemptId: ATTEMPT_ID,
      receiptSha: state.site.receiptSha,
      verifiedAt: NOW
    });
    expect(malformed.objectReads.length).toBeGreaterThan(0);
    expect(fs.readFileSync(receiptPathOf(fixture), 'utf8')).toBe('not an object identifier\n');

    fs.rmSync(receiptPathOf(fixture));
    const withoutWorktree = liveSnapshot(fixture);
    const withoutCache = liveTreeDigest(fixture.cacheRoot);
    const withoutReceipt = readSiteEvidence({ state, repoDir: fixture.repoDir }, historicalDeps(fixture).deps);
    expect(withoutReceipt).toEqual(first);
    expect(withoutReceipt.verifiedAt).toBe(NOW);
    expect(fs.existsSync(receiptPathOf(fixture))).toBe(false);
    expect(liveSnapshot(fixture)).toEqual(withoutWorktree);
    expect(liveTreeDigest(fixture.cacheRoot)).toBe(withoutCache);

    expect(fs.readFileSync(descriptorFile)).toEqual(descriptorBytes);
  });

  testPosix('refuses missing, altered or mismatched retained site evidence', async () => {
    const fixture = completed.fixture;
    const state = completed.state;
    const attemptDir = completed.attemptDir;
    const snapshotDir = path.join(attemptDir, 'snapshot');
    const descriptorFile = readDescriptorFile(fixture, ATTEMPT_ID);
    const descriptorBytes = fs.readFileSync(descriptorFile);
    const descriptor = readDescriptor(fixture, ATTEMPT_ID);
    const restoreDescriptor = () => fs.writeFileSync(descriptorFile, descriptorBytes, { mode: 0o600 });
    const noop = () => {};
    const retained = (relative) => {
      const file = path.join(snapshotDir, relative);
      const bytes = fs.readFileSync(file);
      const mode = fs.lstatSync(file).mode & 0o777;
      return {
        file,
        bytes,
        mode,
        remove: () => fs.rmSync(file),
        restore: () => {
          fs.rmSync(file, { force: true });
          fs.writeFileSync(file, bytes, { mode });
        }
      };
    };
    const index = retained('index.html');
    const serve = retained('scripts/serve.sh');
    const moved = `${snapshotDir}.moved`;
    const absent = 'f'.repeat(40);
    const movedCommonDir = path.join(fixture.parentDir, 'other-common');
    const worktreeBefore = liveSnapshot(fixture);
    const snapshotBefore = liveTreeDigest(snapshotDir);
    const proof = readSiteEvidence({ state, repoDir: fixture.repoDir }, historicalDeps(fixture).deps);

    const scenarios = [
      {
        name: 'a missing descriptor',
        pattern: /descriptor is missing/,
        state: () => state,
        apply: () => fs.rmSync(descriptorFile),
        restore: restoreDescriptor
      },
      {
        name: 'a missing snapshot',
        pattern: /snapshot is missing/,
        state: () => state,
        apply: () => fs.renameSync(snapshotDir, moved),
        restore: () => fs.renameSync(moved, snapshotDir)
      },
      {
        name: 'a source object that is not in the object store',
        pattern: /Git read failed/,
        state: () => stateVariant(state, (copy) => {
          copy.site.sourceSha = absent;
          copy.site.receiptSha = absent;
          copy.sizes.commit = absent;
        }),
        apply: () => writeDescriptorFile(fixture, ATTEMPT_ID, {
          ...descriptor, sourceSha: absent, receiptSha: absent
        }),
        restore: restoreDescriptor
      },
      {
        name: 'changed retained file bytes',
        pattern: /bytes changed: index.html/,
        state: () => state,
        apply: () => fs.appendFileSync(index.file, '\n'),
        restore: index.restore
      },
      {
        name: 'an extra retained file',
        pattern: /unexpected file: extra.txt/,
        state: () => state,
        apply: () => write(snapshotDir, 'extra.txt', 'extra\n', 0o644),
        restore: () => fs.rmSync(path.join(snapshotDir, 'extra.txt'))
      },
      {
        name: 'an extra retained directory',
        pattern: /unexpected directory: extra-dir/,
        state: () => state,
        apply: () => fs.mkdirSync(path.join(snapshotDir, 'extra-dir'), { mode: 0o700 }),
        restore: () => fs.rmdirSync(path.join(snapshotDir, 'extra-dir'))
      },
      {
        name: 'a missing retained file',
        pattern: /missing scripts\/serve.sh/,
        state: () => state,
        apply: () => serve.remove(),
        restore: serve.restore
      },
      {
        name: 'a symlinked retained leaf',
        pattern: /holds a symlink: index.html/,
        state: () => state,
        apply: () => {
          index.remove();
          fs.symlinkSync(path.join(snapshotDir, 'wrangler.jsonc'), index.file);
        },
        restore: index.restore
      },
      {
        name: 'a descriptor naming a different site tree',
        pattern: /different site tree/,
        state: () => stateVariant(state, (copy) => { copy.site.treeSha = '3'.repeat(40); }),
        apply: noop,
        restore: noop
      },
      {
        name: 'a descriptor that is not the completed size source',
        pattern: /not the completed size source/,
        state: () => stateVariant(state, (copy) => { copy.sizes.commit = '4'.repeat(40); }),
        apply: noop,
        restore: noop
      },
      {
        name: 'an unresolved descriptor phase',
        pattern: /Site completion differs from its retained descriptor/,
        state: () => state,
        apply: () => writeDescriptorFile(fixture, ATTEMPT_ID, {
          ...descriptor, phase: 'requested', requestedAt: NOW, completedAt: null, receiptSha: null
        }),
        restore: restoreDescriptor
      },
      {
        name: 'a stale completion timestamp',
        pattern: /Site completion differs from its retained descriptor/,
        state: () => state,
        apply: () => writeDescriptorFile(fixture, ATTEMPT_ID, {
          ...descriptor, completedAt: '2026-02-03T09:00:00.000Z'
        }),
        restore: restoreDescriptor
      },
      {
        name: 'a different recorded object store',
        pattern: /different object store/,
        state: () => stateVariant(state, (copy) => { copy.repo.commonDir = movedCommonDir; }),
        apply: noop,
        restore: noop
      },
      {
        name: 'a different recorded cache key',
        pattern: /validated release state/,
        state: () => stateVariant(state, (copy) => { copy.repo.key = '5'.repeat(64); }),
        apply: noop,
        restore: noop
      },
      {
        name: 'an unresolved saved site target',
        pattern: /Complete site evidence is required/,
        state: () => stateVariant(state, (copy) => {
          copy.site.state = 'unknown';
          copy.site.verifiedAt = null;
          copy.site.error = UNRESOLVED_SITE;
        }),
        apply: noop,
        restore: noop
      }
    ];

    for (const scenario of scenarios) {
      scenario.apply();
      try {
        const error = expectSiteRefusal(() => readSiteEvidence(
          { state: scenario.state(), repoDir: fixture.repoDir }, historicalDeps(fixture).deps
        ));
        expect(`${scenario.name}: ${error.message}`).toMatch(scenario.pattern);
      } finally {
        scenario.restore();
      }
    }

    expect(fs.readFileSync(descriptorFile)).toEqual(descriptorBytes);
    expect(liveTreeDigest(snapshotDir)).toBe(snapshotBefore);
    expect(liveSnapshot(fixture)).toEqual(worktreeBefore);
    expect(readSiteEvidence({ state, repoDir: fixture.repoDir }, historicalDeps(fixture).deps)).toEqual(proof);
  });
});
});
