// The desktop size target prepares the two documents that carry installer sizes
// inside a git-archive snapshot of the recorded HEAD, then plans, applies and
// pushes that exact change through the existing docs transaction machinery. Every
// fixture is a real scratch repository under one owned temp root with an isolated
// Git config and a local bare push destination, so no sibling checkout, provider,
// Ferry or release is touched.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareDownloadSizes, readSizeManifest } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication, verifyDocsApplication } = require('../../scripts/release-docs-plan');
const { renderDownloadSizes } = require('../../scripts/write-download-sizes');
const {
  prepareCommitIntent, applyPreparedTarget, reconcileTargetPush, readTargetJournal
} = require('../../scripts/release-docs-apply');
const { readTargetEvidence, readCompletedTargetEvidence } = require('../../scripts/release-target-evidence');
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
const OLD_VERSION = '1.28.0';
const SOURCE_SHA = '3f9c1d7a4b2e5f8091a2b3c4d5e6f708192a3b4c';
const DATE = '2026-01-02T03:04:05.678Z';
const DESKTOP_REPO = 'hyperclay-local';
const MESSAGE = `Update desktop download sizes for v${VERSION}`;
const SIZE_PATHS = ['README.md', 'website/index.html'];

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

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-sizes-'));
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

let fixtureSeq = 0;
let runSeq = 0;
let outSeq = 0;
let cacheSeq = 0;
let manifestSeq = 0;

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

function readmeFixture(mb, skip = []) {
  const lines = ['# HyperclayLocal ' + VERSION, '', 'Download the app for your platform:', ''];
  for (let index = 0; index < NAMES.length; index += 1) {
    if (skip.includes(NAMES[index])) continue;
    lines.push(
      `   - **${LABELS[index]}**: [${NAMES[index]}](https://local.hyperclay.com/${NAMES[index]}) (${Number(mb[index]).toFixed(1)}MB)`
    );
  }
  lines.push('', 'Install and run the app.', '');
  return lines.join('\n');
}

function websiteFixture(mb, skip = []) {
  const lines = [
    `<section class="section" id="downloads" data-version="${VERSION}">`,
    '  <ul class="dl-list">'
  ];
  for (let index = 0; index < NAMES.length; index += 1) {
    if (skip.includes(NAMES[index])) continue;
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

function manifestFor(mb) {
  const sizes = {};
  NAMES.forEach((name, index) => { sizes[name] = Math.round(mb[index] * 1024 * 1024); });
  return { version: VERSION, commit: SOURCE_SHA, date: DATE, files: NAMES.slice(), sizes };
}

function makeFixture({ readmeMb = MB_OLD, websiteMb = MB_OLD, skipReadme = [], skipWebsite = [] } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `remote-${++fixtureSeq}-`));
  const pushRemote = path.join(remoteDir, `${DESKTOP_REPO}.git`);
  git(remoteDir, ['init', '-q', '--bare', '-b', 'main', pushRemote]);

  const repoRoot = path.join(parentDir, DESKTOP_REPO);
  fs.mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['remote', 'add', 'origin', pushRemote]);
  write(repoRoot, 'README.md', readmeFixture(readmeMb, skipReadme));
  write(repoRoot, 'website/index.html', websiteFixture(websiteMb, skipWebsite));
  write(repoRoot, 'src/app.js', 'module.exports = {};\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'fixture']);
  git(repoRoot, ['push', '-q', 'origin', 'main']);

  const evidenceRoot = fs.mkdtempSync(path.join(OWNER, `evidence-${++fixtureSeq}-`));
  return {
    parentDir,
    repoRoot,
    pushRemote,
    evidenceRoot,
    runDir: path.join(evidenceRoot, `run-${++runSeq}`),
    outDir: path.join(evidenceRoot, `out-${++outSeq}`)
  };
}

function publicationFor(manifest = manifestFor(MB_NEW)) {
  const dir = fs.mkdtempSync(path.join(OWNER, `manifest-${++manifestSeq}-`));
  const manifestFile = path.join(dir, 'release-info.json');
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestFile, bytes);
  return { manifestFile, manifestSha256: sha256(bytes), sourceSha: manifest.commit };
}

function prepareRun() {
  return (command, args, options = {}) => {
    if (command === 'npm') throw new Error('desktop size preparation must not run npm');
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

function descriptorPath(fixture) {
  return path.join(fixture.runDir, 'prepared.json');
}

function prepareSize(fixture, publication, { run = prepareRun(), version = VERSION } = {}) {
  return prepareDownloadSizes({
    version,
    parentDir: fixture.parentDir,
    runDir: fixture.runDir,
    publication
  }, { run });
}

function sizeAttempt(fixture, publication, options = {}) {
  try {
    return { ok: true, prepared: prepareSize(fixture, publication, options), runDir: fixture.runDir };
  } catch (error) {
    return { ok: false, error, runDir: fixture.runDir };
  }
}

function expectSizeRefusal(attempt, pattern) {
  expect(attempt.ok).toBe(false);
  expect(attempt.error.message).toMatch(pattern);
  expect(fs.existsSync(path.join(attempt.runDir, 'prepared.json'))).toBe(false);
}

function readDescriptor(fixture) {
  return JSON.parse(fs.readFileSync(descriptorPath(fixture), 'utf8'));
}

function planAttempt(fixture, { repo = DESKTOP_REPO, version = VERSION, mutate, outDir, run = planRun() } = {}) {
  if (mutate) {
    const descriptor = readDescriptor(fixture);
    mutate(descriptor, descriptor.targets[0]);
    fs.writeFileSync(descriptorPath(fixture), `${JSON.stringify(descriptor, null, 2)}\n`);
  }
  try {
    const record = prepareDocsApplication({
      preparedFile: descriptorPath(fixture),
      repo,
      parentDir: fixture.parentDir,
      version,
      outDir: outDir || fixture.outDir
    }, { run });
    return { ok: true, record };
  } catch (error) {
    return { ok: false, error };
  }
}

function expectPlanRefusal(attempt, pattern) {
  expect(attempt.ok).toBe(false);
  expect(attempt.error.message).toMatch(pattern);
}

function liveSnapshot(repoRoot) {
  return {
    branch: git(repoRoot, ['symbolic-ref', '-q', 'HEAD']).trim(),
    head: git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    indexFingerprint: sha256(git(repoRoot, ['ls-files', '--stage', '-z'])),
    status: git(repoRoot, ['status', '--porcelain=v1', '-z']),
    files: git(repoRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
      .map((name) => `${name}:${sha256(fs.readFileSync(path.join(repoRoot, name)))}`)
  };
}

function depsFor(options = {}) {
  const run = (command, args, opts = {}) => execFileCaptured(command, args, {
    ...opts,
    env: { ...GIT_ENV, ...(opts.env || {}) }
  });
  return {
    run,
    cacheRoot: options.cacheRoot || path.join(CACHES, `cache-${++cacheSeq}`),
    assertPublishWindow: () => {},
    withFerryRepoLock: options.withFerryRepoLock || (async (root, callback) => callback())
  };
}

function journalFileFor(record) {
  return path.join(path.dirname(record.applicationFile), 'target.json');
}

function expectedRender(fixture, publication) {
  const manifest = JSON.parse(fs.readFileSync(publication.manifestFile, 'utf8'));
  return renderDownloadSizes({
    readme: fs.readFileSync(path.join(fixture.repoRoot, 'README.md'), 'utf8'),
    website: fs.readFileSync(path.join(fixture.repoRoot, 'website/index.html'), 'utf8'),
    manifest
  }, { version: VERSION, sourceSha: publication.sourceSha });
}

describe('desktop size target publication binding', () => {
  const forbiddenFs = new Proxy({}, {
    get(target, prop) {
      throw new Error(`filesystem ${String(prop)} must not be touched`);
    }
  });
  const binding = (overrides = {}) => Object.assign({
    manifestFile: path.join(TMP_BASE, 'desktop-size-target', 'release-info.json'),
    manifestSha256: 'a'.repeat(64),
    sourceSha: SOURCE_SHA
  }, overrides);

  test('desktop size target rejects a malformed publication binding without touching the filesystem', () => {
    const cases = [
      [null, /publication must contain exactly manifestFile, manifestSha256 and sourceSha/],
      [[], /publication must contain exactly/],
      ['release-info.json', /publication must contain exactly/],
      [binding({ extra: 1 }), /publication must contain exactly/],
      [{ manifestFile: binding().manifestFile, manifestSha256: binding().manifestSha256 }, /publication must contain exactly/],
      [binding({ manifestFile: 'release-info.json' }), /manifestFile must be a canonical absolute path/],
      [binding({ manifestFile: '/srv/../release-info.json' }), /manifestFile must be a canonical absolute path/],
      [binding({ manifestFile: `/srv/${'x'}\0.json` }), /manifestFile must be a canonical absolute path/],
      [binding({ manifestSha256: 'A'.repeat(64) }), /manifestSha256 must be a lowercase SHA-256/],
      [binding({ manifestSha256: 'abc' }), /manifestSha256 must be a lowercase SHA-256/],
      [binding({ sourceSha: 'abc' }), /sourceSha must be a complete object ID/],
      [binding({ sourceSha: 'A'.repeat(40) }), /sourceSha must be a complete object ID/]
    ];
    for (const [publication, pattern] of cases) {
      expect(() => readSizeManifest(publication, { version: VERSION, fs: forbiddenFs })).toThrow(pattern);
    }

    const accessor = binding();
    Object.defineProperty(accessor, 'manifestFile', { get: () => accessor.manifestSha256 });
    expect(() => readSizeManifest(accessor, { version: VERSION, fs: forbiddenFs }))
      .toThrow(/publication must contain exactly/);

    expect(() => readSizeManifest(binding(), { version: 'not-a-version', fs: forbiddenFs }))
      .toThrow(/version must look like 1.2.3/);
    expect(() => readSizeManifest(binding(), { fs: forbiddenFs })).toThrow(/version must look like 1.2.3/);
    expect(() => readSizeManifest(binding(), { version: VERSION, fs: forbiddenFs }))
      .toThrow(/filesystem realpathSync must not be touched/);
  });
});

describePosix('desktop size target', () => {
  testPosix('prepares both desktop documents with exact bytes and the fixed descriptor shape', () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    const before = liveSnapshot(fixture.repoRoot);
    const expected = expectedRender(fixture, publication);

    const prepared = prepareSize(fixture, publication);

    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(VERSION);
    expect(prepared.runDir).toBe(path.join(fs.realpathSync(path.dirname(fixture.runDir)), path.basename(fixture.runDir)));
    expect(prepared.targets).toHaveLength(1);
    const target = prepared.targets[0];
    expect(Object.keys(target).sort()).toEqual([
      'beforeHead', 'indexFingerprint', 'oldVersion', 'paths', 'publication', 'repo', 'repoRoot', 'sourcePath', 'state'
    ]);
    expect(target.repo).toBe(DESKTOP_REPO);
    expect(target.repoRoot).toBe(fixture.repoRoot);
    expect(target.beforeHead).toBe(before.head);
    expect(target.indexFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(target.sourcePath).toBe('README.md');
    expect(target.oldVersion).toBe(VERSION);
    expect(target.state).toBe('prepared');
    expect(target.publication).toEqual(publication);
    expect(target.paths.map((entry) => entry.path)).toEqual(SIZE_PATHS);

    for (const entry of target.paths) {
      const live = fs.readFileSync(path.join(fixture.repoRoot, entry.path));
      expect(entry.beforeSha256).toBe(sha256(live));
      expect(sha256(fs.readFileSync(entry.beforeFile))).toBe(sha256(live));
      expect(entry.afterSha256).toBe(sha256(fs.readFileSync(entry.afterFile)));
      expect(entry.changed).toBe(true);
      expect(entry.mode).toBe('644');
    }
    expect(fs.readFileSync(target.paths[0].afterFile, 'utf8')).toBe(expected.readme);
    expect(fs.readFileSync(target.paths[1].afterFile, 'utf8')).toBe(expected.website);

    expect(JSON.parse(fs.readFileSync(descriptorPath(fixture), 'utf8'))).toEqual(prepared);
    expect(fs.existsSync(`${descriptorPath(fixture)}.staging`)).toBe(false);
    expect(fs.existsSync(path.join(fixture.runDir, DESKTOP_REPO, 'after'))).toBe(true);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('keeps one unchanged desktop document as a prepared no-op', () => {
    const fixture = makeFixture({ websiteMb: MB_NEW });
    const publication = publicationFor();
    const expected = expectedRender(fixture, publication);

    const prepared = prepareSize(fixture, publication);
    const [readme, website] = prepared.targets[0].paths;

    expect(readme.changed).toBe(true);
    expect(website.changed).toBe(false);
    expect(website.afterSha256).toBe(website.beforeSha256);
    expect(fs.readFileSync(website.afterFile, 'utf8')).toBe(expected.website);
    expect(fs.readFileSync(website.afterFile, 'utf8'))
      .toBe(fs.readFileSync(path.join(fixture.repoRoot, 'website/index.html'), 'utf8'));

    const attempt = planAttempt(fixture);
    expect(attempt.ok).toBe(true);
    expect(attempt.record.paths).toEqual(['README.md']);
    expect(attempt.record.requiredPaths).toEqual(SIZE_PATHS);
    expect(attempt.record.files.find((file) => file.path === 'website/index.html').changed).toBe(false);
  });

  testPosix('plans both unchanged desktop documents as an exact empty patch', () => {
    const fixture = makeFixture({ readmeMb: MB_NEW, websiteMb: MB_NEW });
    const publication = publicationFor();

    const prepared = prepareSize(fixture, publication);
    expect(prepared.targets[0].paths.every((entry) => entry.changed === false)).toBe(true);

    const attempt = planAttempt(fixture);
    expect(attempt.ok).toBe(true);
    expect(attempt.record.paths).toEqual([]);
    expect(attempt.record.expectedTree).toBe(git(fixture.repoRoot, ['rev-parse', 'HEAD^{tree}']).trim());
    expect(fs.statSync(attempt.record.patchFile).size).toBe(0);
    expect(liveSnapshot(fixture.repoRoot).status).toBe('');
  });

  testPosix('refuses a manifest whose raw bytes no longer match the recorded digest', () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    const before = liveSnapshot(fixture.repoRoot);
    fs.appendFileSync(publication.manifestFile, ' ');

    const attempt = sizeAttempt(fixture, publication);

    expect(attempt.ok).toBe(false);
    expect(attempt.error.message).toMatch(/publication manifest digest does not match/);
    expect(fs.existsSync(fixture.runDir)).toBe(false);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('refuses a manifest replaced during preparation and publishes nothing', () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    const before = liveSnapshot(fixture.repoRoot);
    let statuses = 0;
    const base = prepareRun();
    const run = (command, args, options = {}) => {
      const output = base(command, args, options);
      if (command === 'git' && args[0] === 'status') {
        statuses += 1;
        if (statuses === 2) fs.appendFileSync(publication.manifestFile, '\n');
      }
      return output;
    };

    const attempt = sizeAttempt(fixture, publication, { run });

    expect(statuses).toBe(2);
    expect(attempt.ok).toBe(false);
    expect(attempt.error.message).toMatch(/publication manifest digest does not match/);
    expect(fs.existsSync(descriptorPath(fixture))).toBe(false);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('refuses malformed, mismatched and symlinked manifest bindings', () => {
    const fixture = makeFixture();
    const before = liveSnapshot(fixture.repoRoot);
    const dir = fs.mkdtempSync(path.join(OWNER, 'manifest-forms-'));
    const valid = manifestFor(MB_NEW);
    const writeManifest = (name, value) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
      return file;
    };
    const attemptFor = (file, version = VERSION) => sizeAttempt(fixture, {
      manifestFile: file,
      manifestSha256: sha256(fs.readFileSync(file)),
      sourceSha: SOURCE_SHA
    }, { version });

    const notJson = writeManifest('not-json.json', Buffer.from('{ this is not json\n', 'utf8'));
    expectSizeRefusal(attemptFor(notJson), /JSON/);

    const wrongFields = writeManifest('wrong-fields.json', { version: VERSION, commit: SOURCE_SHA, date: DATE, files: NAMES.slice() });
    expectSizeRefusal(attemptFor(wrongFields), /release-info must carry exactly version, commit, date, files and sizes/);

    const wrongVersion = writeManifest('wrong-version.json', Object.assign(manifestFor(MB_NEW), { version: OLD_VERSION }));
    expectSizeRefusal(attemptFor(wrongVersion), /release-info version is not the expected release version/);

    const wrongCommit = writeManifest('wrong-commit.json', Object.assign(manifestFor(MB_NEW), { commit: 'b'.repeat(40) }));
    expectSizeRefusal(attemptFor(wrongCommit), /release-info commit is not the expected release source commit/);

    const real = writeManifest('real.json', valid);
    const linked = path.join(dir, 'linked.json');
    fs.symlinkSync(real, linked);
    expectSizeRefusal(attemptFor(linked), /manifestFile must be canonical without symlink parents/);

    const realDir = fs.mkdtempSync(path.join(OWNER, 'manifest-parent-'));
    fs.writeFileSync(path.join(realDir, 'release-info.json'), `${JSON.stringify(valid, null, 2)}\n`);
    const linkedDir = path.join(dir, 'linked-dir');
    fs.symlinkSync(realDir, linkedDir);
    const viaLink = path.join(linkedDir, 'release-info.json');
    expectSizeRefusal(attemptFor(viaLink), /manifestFile must be canonical without symlink parents/);

    expect(fs.existsSync(fixture.runDir)).toBe(false);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('refuses a missing second anchor and preserves the live bytes', () => {
    const fixture = makeFixture({ skipWebsite: [NAMES[3]] });
    const publication = publicationFor();
    const before = liveSnapshot(fixture.repoRoot);

    const attempt = sizeAttempt(fixture, publication);

    expect(attempt.ok).toBe(false);
    expect(attempt.error.message).toMatch(/website\/index\.html has no size to update for HyperclayLocal-1\.29\.0\.AppImage/);
    expect(fs.existsSync(descriptorPath(fixture))).toBe(false);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
    expect(fs.readFileSync(path.join(fixture.repoRoot, 'website/index.html'), 'utf8'))
      .toBe(websiteFixture(MB_OLD, [NAMES[3]]));
  });

  testPosix('refuses a dirty selected file and a staged file while preserving unrelated work', () => {
    const publication = publicationFor();

    const dirty = makeFixture();
    const dirtyBefore = liveSnapshot(dirty.repoRoot);
    write(dirty.repoRoot, 'README.md', 'locally edited readme\n');
    const dirtyAttempt = sizeAttempt(dirty, publication);
    expect(dirtyAttempt.ok).toBe(false);
    expect(dirtyAttempt.error.message).toMatch(/hyperclay-local has pending changes for README\.md, website\/index\.html/);
    expect(fs.existsSync(descriptorPath(dirty))).toBe(false);
    expect(fs.readFileSync(path.join(dirty.repoRoot, 'README.md'), 'utf8')).toBe('locally edited readme\n');
    expect(git(dirty.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(dirtyBefore.head);

    const staged = makeFixture();
    write(staged.repoRoot, 'src/app.js', 'module.exports = { staged: true };\n');
    git(staged.repoRoot, ['add', 'src/app.js']);
    const stagedAttempt = sizeAttempt(staged, publication);
    expect(stagedAttempt.ok).toBe(false);
    expect(stagedAttempt.error.message).toMatch(/hyperclay-local has staged changes: src\/app\.js/);
    expect(fs.existsSync(descriptorPath(staged))).toBe(false);
    expect(git(staged.repoRoot, ['diff', '--cached', '--name-only']).trim()).toBe('src/app.js');

    const unrelated = makeFixture();
    write(unrelated.repoRoot, 'notes.md', 'unrelated work in progress\n');
    const prepared = prepareSize(unrelated, publication);
    expect(prepared.targets[0].paths.map((entry) => entry.path)).toEqual(SIZE_PATHS);
    expect(fs.readFileSync(path.join(unrelated.repoRoot, 'notes.md'), 'utf8')).toBe('unrelated work in progress\n');
    expect(git(unrelated.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('?? notes.md');
  });

  testPosix('refuses a third selected path and a malformed sourcePath or oldVersion', () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    prepareSize(fixture, publication);
    const pristine = fs.readFileSync(descriptorPath(fixture), 'utf8');

    const third = planAttempt(fixture, {
      mutate: (descriptor, target) => { target.paths.push({ path: 'src/app.js' }); }
    });
    expectPlanRefusal(third, /prepared paths .* do not match the release targets/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const source = planAttempt(fixture, {
      mutate: (descriptor, target) => { target.sourcePath = 'website/index.html'; }
    });
    expectPlanRefusal(source, /hyperclay-local sourcePath must be README\.md/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const oldVersion = planAttempt(fixture, {
      mutate: (descriptor, target) => { target.oldVersion = OLD_VERSION; }
    });
    expectPlanRefusal(oldVersion, /desktop size updates must preserve the version/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const malformed = planAttempt(fixture, {
      mutate: (descriptor, target) => { target.oldVersion = 'not-a-version'; }
    });
    expectPlanRefusal(malformed, /hyperclay-local oldVersion must look like 1\.2\.3/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const version = planAttempt(fixture, { version: OLD_VERSION });
    expectPlanRefusal(version, /prepared version .* does not match/);
    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
  });

  testPosix('refuses mixed, unknown and desktop-mixed target descriptors', () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    prepareSize(fixture, publication);
    const pristine = fs.readFileSync(descriptorPath(fixture), 'utf8');

    const mixed = planAttempt(fixture, {
      mutate: (descriptor, target) => {
        descriptor.targets.push(Object.assign({}, target, { repo: 'hyperclay', sourcePath: 'server-pages/hyperclay-local.edge' }));
      }
    });
    expectPlanRefusal(mixed, /a desktop size descriptor must contain only the hyperclay-local target/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const mixedDocs = planAttempt(fixture, {
      repo: 'hyperclay',
      mutate: (descriptor, target) => {
        descriptor.targets.push(Object.assign({}, target, { repo: 'hyperclay', sourcePath: 'server-pages/hyperclay-local.edge' }));
      }
    });
    expectPlanRefusal(mixedDocs, /a desktop size descriptor must contain only the hyperclay-local target/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const unknown = planAttempt(fixture, {
      mutate: (descriptor, target) => { target.repo = 'somewhere-else'; }
    });
    expectPlanRefusal(unknown, /is not a supported repo/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const unknownRepo = planAttempt(fixture, { repo: 'not-a-repo' });
    expectPlanRefusal(unknownRepo, /repo must be hyperclay or hyperclay-website/);
    fs.writeFileSync(descriptorPath(fixture), pristine);

    const desktopOnly = planAttempt(fixture);
    expect(desktopOnly.ok).toBe(true);
  });

  testPosix('refuses a tampered desktop after-image even when its digests are rewritten consistently', () => {
    const rewrite = (entry) => {
      fs.writeFileSync(entry.afterFile, `${fs.readFileSync(entry.afterFile, 'utf8')}\n<!-- inflated -->\n`);
      const bytes = fs.readFileSync(entry.afterFile);
      entry.afterSha256 = sha256(bytes);
      entry.changed = true;
      return bytes;
    };

    const preparedFixture = makeFixture();
    const preparedPublication = publicationFor();
    prepareSize(preparedFixture, preparedPublication);
    const descriptor = readDescriptor(preparedFixture);
    rewrite(descriptor.targets[0].paths[0]);
    fs.writeFileSync(descriptorPath(preparedFixture), `${JSON.stringify(descriptor, null, 2)}\n`);

    const preparedAttempt = planAttempt(preparedFixture);
    expectPlanRefusal(preparedAttempt, /desktop size after bytes do not match renderDownloadSizes/);
    expect(fs.existsSync(path.join(preparedFixture.outDir, 'application.json'))).toBe(false);

    const appliedFixture = makeFixture();
    const appliedPublication = publicationFor();
    prepareSize(appliedFixture, appliedPublication);
    const planned = planAttempt(appliedFixture);
    expect(planned.ok).toBe(true);
    const record = planned.record;
    const tampered = rewrite(record.files[0]);
    const application = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    application.files[0].afterSha256 = sha256(tampered);
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(application, null, 2)}\n`);
    const tamperedDescriptor = readDescriptor(appliedFixture);
    tamperedDescriptor.targets[0].paths[0].afterSha256 = sha256(tampered);
    tamperedDescriptor.targets[0].paths[0].changed = true;
    fs.writeFileSync(descriptorPath(appliedFixture), `${JSON.stringify(tamperedDescriptor, null, 2)}\n`);

    expect(() => verifyDocsApplication(record.applicationFile, { run: planRun(), spawn: spawnRun() }))
      .toThrow(/desktop size after bytes do not match renderDownloadSizes/);
  });

  testPosix('applies the desktop size target through the existing plan, apply and push APIs', async () => {
    const fixture = makeFixture();
    const publication = publicationFor();
    prepareSize(fixture, publication);

    const attempt = planAttempt(fixture);
    expect(attempt.ok).toBe(true);
    const record = attempt.record;
    expect(record.repo).toBe(DESKTOP_REPO);
    expect(record.paths).toEqual(SIZE_PATHS);

    const journalFile = journalFileFor(record);
    const deps = depsFor();
    const preparedIntent = await prepareCommitIntent({
      applicationFile: record.applicationFile,
      journalFile,
      message: MESSAGE
    }, deps);
    expect(preparedIntent.state).toBe('failed');

    const applied = await applyPreparedTarget({ journalFile }, deps);
    expect(applied.commit).toBe(preparedIntent.candidateCommit);
    expect(applied.state).toBe('pending-push');
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(applied.commit);
    for (const file of record.files) {
      expect(sha256(fs.readFileSync(path.join(fixture.repoRoot, file.path)))).toBe(file.afterSha256);
    }

    const pushDeps = depsFor({
      cacheRoot: deps.cacheRoot,
      withFerryRepoLock: async () => { throw new Error('Ferry must not be entered for a documentation push'); }
    });
    const completed = await reconcileTargetPush({ journalFile }, pushDeps);
    expect(completed.state).toBe('complete');
    expect(completed.phase).toBe('complete');
    expect(git(fixture.pushRemote, ['rev-parse', 'refs/heads/main']).trim()).toBe(applied.commit);

    const evidence = readTargetEvidence(journalFile, { run: deps.run, spawn: spawnRun(), fs });
    expect(evidence.journal.repo).toBe(DESKTOP_REPO);
    expect(evidence.journal.version).toBe(VERSION);
    expect(evidence.journal.commit).toBe(applied.commit);

    const historical = readCompletedTargetEvidence({
      journalFile,
      evidenceRoot: fixture.evidenceRoot,
      repo: DESKTOP_REPO,
      version: VERSION,
      commit: applied.commit
    }, { run: deps.run, spawn: spawnRun(), fs });
    expect(historical.repo).toBe(DESKTOP_REPO);
    expect(historical.commit).toBe(applied.commit);
    expect(historical.verifiedAt).toBe(evidence.journal.remoteObservation.observedAt);

    expect(() => verifyDocsApplication(record.applicationFile, { run: planRun(), spawn: spawnRun() })).not.toThrow();
    expect(git(fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });
});

const HISTORY_RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const HISTORY_ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const HISTORY_RUN_ID = 456;
const HISTORY_WORKFLOW_ID = 12345;
const HISTORY_UPLOAD_JOB_ID = 4242;
const HISTORY_REMOTE_REPO = 'fixture-owner/hyperclay-local';
const HISTORY_ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const HISTORY_OTHER_ORIGIN = 'https://elsewhere.invalid/hyperclay-local.git';
const HISTORY_RUN_CREATED_AT = '2026-01-02T02:00:00Z';
const HISTORY_RUN_UPDATED_AT = '2026-01-02T02:30:00Z';
const HISTORY_REQUESTED_AT = '2026-01-02T01:00:00.000Z';
const HISTORY_DEADLINE_AT = '2026-01-02T04:00:00.000Z';
const HISTORY_OBSERVED_AT = '2026-01-02T01:20:00.000Z';
const HISTORY_CREATED_AT = '2026-01-02T00:30:00.000Z';
const HISTORY_UPDATED_AT = '2026-01-02T01:30:00.000Z';
const HISTORY_VERIFIED_AT = '2026-01-02T03:04:06.000Z';
const HISTORY_SIZE_OBSERVED_AT = '2026-02-03T04:05:06.000Z';
const HISTORY_GLOBAL_ARGS = 6;
const HISTORY_READ_SUBCOMMANDS = [
  'rev-parse', 'symbolic-ref', 'remote', 'rev-list', 'ls-tree', 'cat-file', 'ls-files', 'merge-base', 'diff'
];
const HISTORY_FORBIDDEN_MODULES = [
  'release.js', 'release-docs-apply.js', 'release-lock.js', 'release-ferry.js',
  'release-transcript.js', 'release-state-store.js'
];

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

function makeHistoryFixture() {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `history-parent-${++fixtureSeq}-`));
  const remoteDir = fs.mkdtempSync(path.join(OWNER, `history-remote-${++fixtureSeq}-`));
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
  const cacheBase = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, `history-cache-${++cacheSeq}-`)));
  const cacheRoot = path.join(cacheBase, 'releases');
  return {
    parentDir,
    repoRoot,
    pushRemote,
    sourceSha,
    identity,
    cacheRoot,
    repoDir: statePaths(identity, { cacheRoot, fs }).repoDir,
    attempt: historyAttempt(sourceSha)
  };
}

function historyRender(fixture, manifestValue) {
  return renderDownloadSizes({
    readme: fs.readFileSync(path.join(fixture.repoRoot, 'README.md'), 'utf8'),
    website: fs.readFileSync(path.join(fixture.repoRoot, 'website/index.html'), 'utf8'),
    manifest: manifestValue
  }, { version: VERSION, sourceSha: fixture.sourceSha });
}

async function publishHistory(fixture, manifestValue) {
  const manifestBytes = Buffer.from(JSON.stringify(manifestValue), 'utf8');
  const state = historyState(fixture);
  writeReleaseState(state, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision: null, fs
  });
  const persisted = await withReleaseLock(fixture.identity, async () => persistPublication({
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
  fixture.manifestFile = persisted.artifacts.manifestFile;
  fixture.manifestSha256 = persisted.artifacts.manifestSha256;
  fixture.published = persisted;
  return persisted;
}

function prepareHistorySize(fixture) {
  const sizesRoot = path.join(fixture.repoDir, 'records', HISTORY_RELEASE_ID, 'sizes');
  fs.mkdirSync(sizesRoot, { recursive: true });
  const runDir = path.join(sizesRoot, `run-${++runSeq}`);
  const outDir = path.join(sizesRoot, `out-${++outSeq}`);
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

function historyDeps(fixture) {
  return {
    run: (command, args, opts = {}) => execFileCaptured(command, args, {
      ...opts,
      env: { ...GIT_ENV, ...(opts.env || {}) }
    }),
    cacheRoot: path.dirname(fixture.repoDir),
    now: () => Date.parse(HISTORY_SIZE_OBSERVED_AT),
    assertPublishWindow: () => {},
    withFerryRepoLock: async (root, callback) => callback()
  };
}

function historyPushDeps(fixture) {
  const deps = historyDeps(fixture);
  deps.withFerryRepoLock = async () => {
    throw new Error('Ferry must not be entered for a documentation push');
  };
  return deps;
}

async function completeHistoryTarget({ boundary = false } = {}) {
  const fixture = makeHistoryFixture();
  const manifestValue = historyManifest(fixture.sourceSha);
  if (boundary) {
    const rendered = historyRender(fixture, manifestValue);
    write(fixture.repoRoot, 'README.md', rendered.readme);
    write(fixture.repoRoot, 'website/index.html', rendered.website);
    git(fixture.repoRoot, ['add', '-A']);
    git(fixture.repoRoot, ['commit', '-q', '-m', MESSAGE]);
    fixture.boundary = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
  }
  await publishHistory(fixture, manifestValue);

  const size = prepareHistorySize(fixture);
  if (boundary) {
    fixture.preparationHead = size.record.beforeHead;
    const readmePath = path.join(fixture.repoRoot, 'README.md');
    const validReadme = fs.readFileSync(readmePath);
    fs.writeFileSync(readmePath, Buffer.concat([validReadme, Buffer.from('\nTemporary selected content\n')]));
    git(fixture.repoRoot, ['add', '--', 'README.md']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'temporary size content']);
    fixture.intermediate = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(readmePath, validReadme);
    git(fixture.repoRoot, ['add', '--', 'README.md']);
    git(fixture.repoRoot, ['commit', '-q', '-m', MESSAGE]);
    fixture.boundary = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
  }
  git(fixture.repoRoot, ['remote', 'set-url', 'origin', fixture.pushRemote]);
  git(fixture.repoRoot, ['push', '-q', fixture.pushRemote, `${fixture.sourceSha}:refs/heads/main`]);

  const deps = historyDeps(fixture);
  const preparedIntent = await prepareCommitIntent({
    applicationFile: size.record.applicationFile,
    journalFile: size.journalFile,
    message: MESSAGE
  }, deps);
  const applied = await applyPreparedTarget({ journalFile: size.journalFile }, deps);
  const completed = await reconcileTargetPush({ journalFile: size.journalFile }, historyPushDeps(fixture));

  const state = {
    ...fixture.published,
    revision: fixture.published.revision + 1,
    sizes: { state: 'complete', journalFile: size.journalFile, commit: completed.commit, reason: null }
  };
  writeReleaseState(state, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision: fixture.published.revision, fs
  });
  return {
    fixture,
    size,
    preparedIntent,
    applied,
    completed,
    state: readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs })
  };
}

function historyReader() {
  const calls = [];
  const reader = createLocalGitReader({
    spawnSync: (file, args, options) => {
      const result = childProcess.spawnSync(file, args, options);
      calls.push({
        file,
        argv: args.slice(HISTORY_GLOBAL_ARGS),
        status: result.status,
        stdout: result.stdout === null || result.stdout === undefined ? '' : String(result.stdout),
        stderr: result.stderr === null || result.stderr === undefined ? '' : String(result.stderr)
      });
      return result;
    }
  });
  return { run: reader.run, spawn: reader.spawn, calls };
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

function historyLiveSnapshot(fixture) {
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
    readme: sha256(fs.readFileSync(path.join(root, 'README.md'))),
    website: sha256(fs.readFileSync(path.join(root, 'website/index.html')))
  };
}

function historyRefusal(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function expectSizeEvidenceRefusal(invoke) {
  const error = historyRefusal(invoke);
  expect(error.code).toBe('SIZE_EVIDENCE_INVALID');
  expect(error.message).toMatch(/The retained size evidence is invalid/);
  expect(error.cause).toBeTruthy();
  return error;
}

function readHistoryEvidence(ctx, options) {
  return readSizeEvidence({ state: ctx.state, repoDir: ctx.fixture.repoDir }, options);
}

function withFileBytes(file, bytes, callback) {
  const pristine = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, bytes);
    return callback();
  } finally {
    fs.writeFileSync(file, pristine);
  }
}

function withRecord(file, mutate, callback) {
  const pristine = fs.readFileSync(file);
  try {
    const record = JSON.parse(pristine.toString('utf8'));
    mutate(record);
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    return callback();
  } finally {
    fs.writeFileSync(file, pristine);
  }
}

let historyPromise = null;

function sharedHistory() {
  if (!historyPromise) historyPromise = completeHistoryTarget();
  return historyPromise;
}

describe('historical size evidence', () => {
  const forbiddenFs = new Proxy({}, {
    get(target, prop) {
      throw new Error(`filesystem ${String(prop)} must not be touched`);
    }
  });

  test('exposes readSizeEvidence alone and refuses an unvalidated state with the fixed code', () => {
    expect(Object.keys(require('../../scripts/release-size-evidence'))).toEqual(['readSizeEvidence']);

    const incomplete = {
      mode: 'publish',
      releaseId: HISTORY_RELEASE_ID,
      version: VERSION,
      sourceSha: SOURCE_SHA,
      artifacts: { state: 'pending' },
      sizes: { state: 'pending', journalFile: null, commit: null, reason: null },
      repo: null
    };
    const cases = [
      [undefined, '/tmp/size-evidence'],
      [null, '/tmp/size-evidence'],
      [{}, '/tmp/size-evidence'],
      [{ mode: 'dry-run', artifacts: { state: 'complete' }, sizes: { state: 'complete' } }, '/tmp/size-evidence'],
      [incomplete, '/tmp/size-evidence'],
      [{ ...incomplete, artifacts: { state: 'complete' } }, '/tmp/size-evidence'],
      [{ ...incomplete, artifacts: { state: 'complete' }, sizes: { state: 'pending-push', journalFile: null, commit: null, reason: null } }, '/tmp/size-evidence'],
      [{ ...incomplete, artifacts: { state: 'complete' }, sizes: { state: 'complete', journalFile: null, commit: null, reason: null } }, '/tmp/size-evidence'],
      [{
        ...incomplete,
        artifacts: { state: 'complete' },
        sizes: { state: 'complete', journalFile: '/tmp/size-evidence/target.json', commit: SOURCE_SHA, reason: { code: 'X', message: 'y' } }
      }, '/tmp/size-evidence']
    ];
    for (const [state, repoDir] of cases) {
      const error = expectSizeEvidenceRefusal(() => readSizeEvidence({ state, repoDir }, { fs: forbiddenFs }));
      expect(error.cause.message).toMatch(/Complete publication and size evidence are required/);
    }

    const handedOff = {
      ...incomplete,
      artifacts: { state: 'complete' },
      sizes: { state: 'complete', journalFile: '/tmp/size-evidence/target.json', commit: SOURCE_SHA, reason: null }
    };
    const handedOffError = expectSizeEvidenceRefusal(
      () => readSizeEvidence({ state: handedOff, repoDir: '/tmp/size-evidence' }, { fs: forbiddenFs })
    );
    expect(handedOffError.cause.message).toMatch(/validated release state/);

    expect(() => readSizeEvidence(undefined, { fs: forbiddenFs })).toThrow(TypeError);
    expectSizeEvidenceRefusal(() => readSizeEvidence({}, { fs: forbiddenFs }));
  });

  test('loads no acting apply, lock, Ferry or transcript module', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const script = [
      "const path = require('path');",
      "const root = process.env.SIZE_EVIDENCE_ROOT;",
      "require(path.join(root, 'scripts', 'release-size-evidence.js'));",
      "const loaded = Object.keys(require.cache)",
      "  .filter((file) => file.startsWith(path.join(root, 'scripts') + path.sep))",
      "  .map((file) => path.basename(file));",
      "process.stdout.write(JSON.stringify(loaded));"
    ].join('\n');
    const output = childProcess.execFileSync(process.execPath, ['-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...GIT_ENV, SIZE_EVIDENCE_ROOT: repoRoot }
    });
    const loaded = JSON.parse(output);
    for (const name of ['release-size-evidence.js', 'release-publication.js', 'release-target-evidence.js', 'release-docs-plan.js', 'release-local-read.js']) {
      expect(loaded).toContain(name);
    }
    for (const name of HISTORY_FORBIDDEN_MODULES) expect(loaded).not.toContain(name);
  });

  describePosix('native journaling', () => {
    testPosix('reads the original commit and saved observation after the checkout moved on', async () => {
      const ctx = await completeHistoryTarget();
      const { fixture, size, completed } = ctx;
      const reader = historyReader();
      const expected = { commit: completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT };
      expect(ctx.applied.state).toBe('pending-push');
      expect(completed.state).toBe('complete');
      expect(completed.remoteObservation.head).toBe(completed.commit);
      expect(git(fixture.pushRemote, ['rev-parse', 'refs/heads/main']).trim()).toBe(completed.commit);

      const before = historyLiveSnapshot(fixture);
      const captured = captureWrites(() => readHistoryEvidence(ctx, {
        run: reader.run, spawn: reader.spawn, fs
      }));

      expect(captured.value).toEqual(expected);
      expect(captured.stdout).toBe('');
      expect(captured.stderr).toBe('');
      expect(reader.calls.length).toBeGreaterThan(0);
      expect(reader.calls.filter((call) => call.stdout.length > 0).length).toBeGreaterThan(0);
      const subcommands = new Set(reader.calls.map((call) => call.argv[0]));
      for (const name of ['cat-file', 'ls-tree', 'merge-base']) expect(subcommands.has(name)).toBe(true);
      for (const call of reader.calls) {
        expect(call.file).toBe('git');
        expect(HISTORY_READ_SUBCOMMANDS).toContain(call.argv[0]);
        expect(call.argv[0] === 'diff' ? [0, 1] : [0]).toContain(call.status);
        for (const forbidden of ['fetch', 'push', 'ls-remote', 'update-ref', 'gc', 'prune', 'lock']) {
          expect(call.argv).not.toContain(forbidden);
        }
      }
      expect(historyLiveSnapshot(fixture)).toEqual(before);

      expect(readHistoryEvidence(ctx)).toEqual(expected);
      expect(readHistoryEvidence(ctx, {})).toEqual(expected);

      write(fixture.repoRoot, 'README.md', 'later readme bytes\n');
      write(fixture.repoRoot, 'website/index.html', 'later website bytes\n');
      write(fixture.repoRoot, 'src/app.js', 'module.exports = { later: true };\n');
      git(fixture.repoRoot, ['add', '-A']);
      git(fixture.repoRoot, ['commit', '-q', '-m', 'later work']);
      const laterHead = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
      expect(laterHead).not.toBe(completed.commit);
      expect(readHistoryEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs })).toEqual(expected);

      git(fixture.repoRoot, ['remote', 'set-url', '--push', 'origin', HISTORY_OTHER_ORIGIN]);
      const pushRefusal = historyRefusal(() => readTargetJournal(size.journalFile, {
        run: depsFor().run, spawn: spawnRun(), fs
      }));
      expect(pushRefusal.code).toBe('DOCS_JOURNAL_INVALID');
      expect(pushRefusal.message).toMatch(/pushUrlSha256/);
      expect(readHistoryEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs })).toEqual(expected);

      git(fixture.repoRoot, ['checkout', '-q', '-b', 'later']);
      const branchRefusal = historyRefusal(() => readTargetJournal(size.journalFile, {
        run: depsFor().run, spawn: spawnRun(), fs
      }));
      expect(branchRefusal.code).toBe('DOCS_JOURNAL_INVALID');
      expect(branchRefusal.message).toMatch(/refs\/heads\/main/);

      const moved = historyLiveSnapshot(fixture);
      expect(moved.head).toBe(laterHead);
      expect(moved.branch).toBe('refs/heads/later');
      const after = captureWrites(() => readHistoryEvidence(ctx, { run: reader.run, spawn: reader.spawn, fs }));
      expect(after.value).toEqual(expected);
      expect(after.stdout).toBe('');
      expect(after.stderr).toBe('');
      expect(historyLiveSnapshot(fixture)).toEqual(moved);
    });

    testPosix('refuses a descriptor that rebinds a different publication', async () => {
      const ctx = await sharedHistory();
      const { fixture, size } = ctx;
      const expected = { commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT };
      expect(readHistoryEvidence(ctx)).toEqual(expected);

      const applicationFile = size.record.applicationFile;
      const journalFile = size.journalFile;
      const preparedFile = size.record.preparedFile;
      const pristine = {
        prepared: fs.readFileSync(preparedFile),
        application: fs.readFileSync(applicationFile),
        journal: fs.readFileSync(journalFile)
      };
      try {
        const descriptor = JSON.parse(pristine.prepared.toString('utf8'));
        descriptor.targets[0].publication.manifestSha256 = 'b'.repeat(64);
        fs.writeFileSync(preparedFile, `${JSON.stringify(descriptor, null, 2)}\n`);
        const preparedSha256 = sha256(fs.readFileSync(preparedFile));

        const application = JSON.parse(pristine.application.toString('utf8'));
        application.preparedSha256 = preparedSha256;
        fs.writeFileSync(applicationFile, `${JSON.stringify(application, null, 2)}\n`);
        const applicationSha256 = sha256(fs.readFileSync(applicationFile));

        const journal = JSON.parse(pristine.journal.toString('utf8'));
        journal.preparedSha256 = preparedSha256;
        journal.applicationSha256 = applicationSha256;
        fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);

        const error = expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx));
        expect(error.cause.code).toBe('DOCS_APPLICATION_INVALID');
        expect(error.cause.message).toMatch(/publication manifest digest does not match/);
      } finally {
        fs.writeFileSync(preparedFile, pristine.prepared);
        fs.writeFileSync(applicationFile, pristine.application);
        fs.writeFileSync(journalFile, pristine.journal);
      }
      expect(readHistoryEvidence(ctx)).toEqual(expected);
      expect(fixture.manifestSha256).toBe(sha256(fs.readFileSync(fixture.manifestFile)));

      const alternate = {
        ...ctx.state,
        artifacts: {
          ...ctx.state.artifacts,
          manifestFile: path.join(
            fixture.repoDir, 'records', HISTORY_RELEASE_ID, 'artifacts', HISTORY_ATTEMPT_ID, 'alternate-release-info.json'
          )
        }
      };
      const alternateError = expectSizeEvidenceRefusal(
        () => readSizeEvidence({ state: alternate, repoDir: fixture.repoDir })
      );
      expect(alternateError.cause.message).toMatch(/alternate manifest path/);
      expect(readHistoryEvidence(ctx)).toEqual(expected);
    });

    testPosix('refuses an otherwise valid target bound to another manifest path', async () => {
      const ctx = await sharedHistory();
      const { fixture, size } = ctx;
      const applicationFile = size.record.applicationFile;
      const journalFile = size.journalFile;
      const preparedFile = size.record.preparedFile;
      const alternateManifest = path.join(path.dirname(fixture.manifestFile), 'alternate-size-manifest.json');
      const pristine = {
        prepared: fs.readFileSync(preparedFile),
        application: fs.readFileSync(applicationFile),
        journal: fs.readFileSync(journalFile)
      };
      fs.writeFileSync(alternateManifest, fs.readFileSync(fixture.manifestFile), { flag: 'wx' });
      try {
        const descriptor = JSON.parse(pristine.prepared.toString('utf8'));
        descriptor.targets[0].publication.manifestFile = alternateManifest;
        fs.writeFileSync(preparedFile, `${JSON.stringify(descriptor, null, 2)}\n`);
        const preparedSha256 = sha256(fs.readFileSync(preparedFile));
        const application = JSON.parse(pristine.application.toString('utf8'));
        application.preparedSha256 = preparedSha256;
        fs.writeFileSync(applicationFile, `${JSON.stringify(application, null, 2)}\n`);
        const journal = JSON.parse(pristine.journal.toString('utf8'));
        journal.preparedSha256 = preparedSha256;
        journal.applicationSha256 = sha256(fs.readFileSync(applicationFile));
        fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
        expect(readTargetEvidence(journalFile).journal.commit).toBe(ctx.completed.commit);
        const error = expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx));
        expect(error.cause.message).toBe('The size descriptor uses different publication evidence.');
      } finally {
        fs.writeFileSync(preparedFile, pristine.prepared);
        fs.writeFileSync(applicationFile, pristine.application);
        fs.writeFileSync(journalFile, pristine.journal);
        fs.unlinkSync(alternateManifest);
      }
      expect(readHistoryEvidence(ctx)).toEqual({
        commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT
      });
    });

    testPosix('refuses a corrupted second after image', async () => {
      const ctx = await sharedHistory();
      const afterFile = ctx.size.record.files[1].afterFile;
      expect(ctx.size.record.files[1].path).toBe('website/index.html');
      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });

      const error = withFileBytes(afterFile, 'corrupted website after bytes\n', () => {
        return expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx));
      });
      expect(error.message).toMatch(/The retained size evidence is invalid/);
      expect(error.cause.code).toBe('DOCS_APPLICATION_INVALID');

      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
    });

    testPosix('refuses an application whose digest no longer matches the journal', async () => {
      const ctx = await sharedHistory();
      const applicationFile = ctx.size.record.applicationFile;
      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });

      const error = withRecord(applicationFile, () => {}, () => {
        fs.appendFileSync(applicationFile, '\n');
        return expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx));
      });
      expect(error.cause.code).toBe('DOCS_JOURNAL_INVALID');
      expect(error.cause.message).toMatch(/applicationSha256/);

      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
    });

    testPosix('refuses an observed commit that does not contain the size commit', async () => {
      const ctx = await sharedHistory();
      const journalFile = ctx.size.journalFile;
      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
      expect(ctx.fixture.sourceSha).not.toBe(ctx.completed.commit);

      const error = withRecord(journalFile, (record) => {
        record.remoteObservation.head = ctx.fixture.sourceSha;
      }, () => expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx)));
      expect(error.cause.code).toBe('DOCS_HISTORY_UNRESOLVED');
      expect(error.cause.message).toMatch(/does not contain/);

      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
    });

    testPosix('refuses a pending-push size stage whose retained bytes are complete', async () => {
      const ctx = await sharedHistory();
      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
      expect(readCompletedTargetEvidence({
        journalFile: ctx.size.journalFile,
        evidenceRoot: path.join(ctx.fixture.repoDir, 'records', HISTORY_RELEASE_ID),
        repo: DESKTOP_REPO,
        version: VERSION,
        commit: ctx.completed.commit
      }, { run: depsFor().run, spawn: spawnRun(), fs }).commit).toBe(ctx.completed.commit);

      const pending = {
        ...ctx.state,
        sizes: { state: 'pending-push', journalFile: ctx.size.journalFile, commit: ctx.completed.commit, reason: null }
      };
      const error = expectSizeEvidenceRefusal(() => readSizeEvidence({ state: pending, repoDir: ctx.fixture.repoDir }));
      expect(error.cause.message).toMatch(/Complete publication and size evidence are required/);
      expect(readHistoryEvidence(ctx)).toEqual({ commit: ctx.completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT });
    });

    testPosix('refuses an observed commit whose selected postimage changed', async () => {
      const ctx = await completeHistoryTarget();
      const { fixture, size, completed } = ctx;
      const expected = { commit: completed.commit, verifiedAt: HISTORY_SIZE_OBSERVED_AT };
      expect(readHistoryEvidence(ctx)).toEqual(expected);

      write(fixture.repoRoot, 'README.md', 'later selected bytes\n');
      git(fixture.repoRoot, ['add', '--', 'README.md']);
      git(fixture.repoRoot, ['commit', '-q', '-m', 'later selected work']);
      const later = git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim();
      expect(later).not.toBe(completed.commit);
      expect(git(fixture.repoRoot, ['merge-base', '--is-ancestor', completed.commit, later])).toBe('');
      expect(readHistoryEvidence(ctx)).toEqual(expected);

      const error = withRecord(size.journalFile, (record) => {
        record.remoteObservation.head = later;
      }, () => expectSizeEvidenceRefusal(() => readHistoryEvidence(ctx)));
      expect(error.cause.code).toBe('DOCS_HISTORY_UNRESOLVED');
      expect(error.cause.message).toMatch(/does not carry the prepared documentation set/);

      expect(readHistoryEvidence(ctx)).toEqual(expected);
    });

    testPosix('reads an unchanged size target whose boundary was committed after preparation', async () => {
      const ctx = await completeHistoryTarget({ boundary: true });
      const { fixture, size, completed } = ctx;
      const boundary = fixture.boundary;

      expect(size.record.paths).toEqual([]);
      expect(size.record.requiredPaths).toEqual(SIZE_PATHS);
      expect(ctx.preparedIntent.commit).toBe(boundary);
      expect(ctx.applied.commit).toBe(boundary);
      expect(completed.commit).toBe(boundary);
      expect(completed.remoteObservation.head).toBe(boundary);
      expect(size.record.beforeHead).toBe(fixture.preparationHead);
      expect(boundary).not.toBe(fixture.preparationHead);
      expect(git(fixture.repoRoot, ['merge-base', '--is-ancestor', fixture.preparationHead, boundary])).toBe('');
      expect(git(fixture.repoRoot, ['rev-parse', `${boundary}^`]).trim()).toBe(fixture.intermediate);
      for (const file of SIZE_PATHS) {
        expect(git(fixture.repoRoot, ['show', `${fixture.preparationHead}:${file}`]))
          .toBe(git(fixture.repoRoot, ['show', `${boundary}:${file}`]));
      }
      expect(git(fixture.repoRoot, ['show', `${boundary}^:README.md`]))
        .not.toBe(git(fixture.repoRoot, ['show', `${boundary}:README.md`]));
      expect(git(fixture.pushRemote, ['rev-parse', 'refs/heads/main']).trim()).toBe(boundary);

      const expected = { commit: boundary, verifiedAt: HISTORY_SIZE_OBSERVED_AT };
      expect(readHistoryEvidence(ctx)).toEqual(expected);

      write(fixture.repoRoot, 'README.md', 'later bytes after the boundary\n');
      git(fixture.repoRoot, ['add', '-A']);
      git(fixture.repoRoot, ['commit', '-q', '-m', 'later boundary work']);
      expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(boundary);
      expect(readHistoryEvidence(ctx)).toEqual(expected);
    });
  });
});
