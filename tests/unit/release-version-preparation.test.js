'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderReleaseVersion } = require('../../scripts/release-version-render');
const { prepareDownloadSizes, prepareReleaseVersion } = require('../../scripts/release-docs-prepare');
const { prepareDocsApplication, verifyDocsApplication } = require('../../scripts/release-docs-plan');
const { execFileCaptured } = require('../../scripts/release-command');
const { testPosix } = require('../helpers/platform');

const OLD = '1.28.0';
const NEW = '1.29.0';
const RENDERER_PATH = path.join(__dirname, '..', '..', 'scripts', 'release-version-render.js');

const PKG_BEFORE = `{
  "name": "hyperclay-local-electron",
  "productName": "HyperclayLocal",
  "version": "${OLD}",
  "description": "Hyperclay Local Server - Desktop App",
  "build": {
    "artifactName": "HyperclayLocal-Setup-\${version}.\${ext}"
  },
  "hyper": {
    "status": "active"
  }
}
`;

const README_FORMS = [
  `HyperclayLocal-Setup-${OLD}.exe`,
  `HyperclayLocal-${OLD}-arm64.dmg`,
  `HyperclayLocal-${OLD}.dmg`,
  `HyperclayLocal-${OLD}.AppImage`,
  `HyperclayLocal-${OLD}-arm64.AppImage`,
];

const README_BEFORE = [
  '# Hyperclay Local',
  '',
  '## Download',
  '',
  ...README_FORMS.map(form => `- [${form}](https://local.hyperclay.com/${form})`),
  '',
].join('\n');

const WEBSITE_BEFORE = [
  '<!DOCTYPE html>',
  '<html>',
  '  <body>',
  '    <section class="section" id="downloads" data-version="1.20.1">',
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1-arm64.dmg">HyperclayLocal-1.20.1-arm64.dmg</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1.dmg">HyperclayLocal-1.20.1.dmg</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-Setup-1.20.1.exe">HyperclayLocal-Setup-1.20.1.exe</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1.AppImage">HyperclayLocal-1.20.1.AppImage</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1-arm64.AppImage">HyperclayLocal-1.20.1-arm64.AppImage</a>`,
  '    </section>',
  '    <svg viewBox="0 0 100 100">',
  '      <path d="M1.02.08L2.33.66L3.44.77z"/>',
  '      <text x="1">1.02.08</text>',
  '    </svg>',
  '  </body>',
  '</html>',
  '',
].join('\n');

function input(overrides) {
  return Object.assign(
    { packageJson: PKG_BEFORE, readme: README_BEFORE, website: WEBSITE_BEFORE },
    overrides
  );
}

function options(overrides) {
  return Object.assign({ previousVersion: OLD, version: NEW }, overrides);
}

function render(overrides, optionOverrides) {
  return renderReleaseVersion(input(overrides), options(optionOverrides));
}

function expectInvalid(run) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('RELEASE_VERSION_INVALID');
  return error;
}

const SENTINEL_SOURCE = `'use strict';

const fs = require('fs');
const childProcess = require('child_process');

const record = [];
const note = (name, target) => record.push(target === undefined ? name : name + ':' + target);

const FS_METHODS = [
  'readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'openSync', 'open', 'createReadStream', 'createWriteStream', 'mkdirSync', 'readdirSync',
  'existsSync', 'statSync', 'rmSync'
];
for (const name of FS_METHODS) {
  const original = fs[name];
  if (typeof original !== 'function') continue;
  fs[name] = function (...args) {
    note('fs.' + name, typeof args[0] === 'string' ? args[0] : undefined);
    return original.apply(this, args);
  };
}

const COMMAND_METHODS = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'];
for (const name of COMMAND_METHODS) {
  const original = childProcess[name];
  if (typeof original !== 'function') continue;
  childProcess[name] = function (...args) {
    note('child_process.' + name);
    return original.apply(this, args);
  };
}

const { renderReleaseVersion } = require(process.argv[2]);
const rendered = renderReleaseVersion(
  {
    packageJson: JSON.stringify({ version: '1.28.0' }),
    readme: 'HyperclayLocal-1.28.0.dmg',
    website: 'data-version="1.28.0"'
  },
  { previousVersion: '1.28.0', version: '1.29.0' }
);
if (rendered.packageJson.indexOf('"version": "1.29.0"') < 0) note('unexpected-result');
process.stdout.write(JSON.stringify(record));
`;

describe('desktop version renderer', () => {
  const owner = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-version-render-'));
  const sentinelPath = path.join(owner, 'sentinel.cjs');

  beforeAll(() => {
    fs.writeFileSync(sentinelPath, SENTINEL_SOURCE);
  });

  afterAll(() => {
    fs.rmSync(owner, { recursive: true, force: true });
  });

  test('rewrites package.json with exact formatting, final newline and unrelated fields', () => {
    const result = render();
    const expected = JSON.parse(PKG_BEFORE);
    expected.version = NEW;
    expect(result.packageJson).toBe(JSON.stringify(expected, null, 2) + '\n');
    expect(result.packageJson.endsWith('\n')).toBe(true);
    expect(result.packageJson).toContain('"description": "Hyperclay Local Server - Desktop App"');
    expect(result.packageJson).toContain('"artifactName": "HyperclayLocal-Setup-${version}.${ext}"');
    expect(result.packageJson).toContain('"status": "active"');
    expect(result.packageJson).not.toContain(`"version": "${OLD}"`);
  });

  test('rewrites all five installer filename forms in the README', () => {
    const result = render();
    for (const form of README_FORMS) {
      expect(result.readme).toContain(form.replace(OLD, NEW));
      expect(result.readme).not.toContain(form);
    }
  });

  test('rewrites stale differing versions in README and website', () => {
    const result = render({
      readme: 'HyperclayLocal-1.20.1.dmg and HyperclayLocal-Setup-1.19.7.exe',
      website: 'HyperclayLocal-1.20.1.AppImage',
    });
    expect(result.readme).toBe(`HyperclayLocal-${NEW}.dmg and HyperclayLocal-Setup-${NEW}.exe`);
    expect(result.website).toBe(`HyperclayLocal-${NEW}.AppImage`);
  });

  test('rewrites data-version attributes', () => {
    const result = render({ website: '<section id="downloads" data-version="1.20.1"></section>' });
    expect(result.website).toBe(`<section id="downloads" data-version="${NEW}"></section>`);
  });

  test('leaves SVG numeric text untouched', () => {
    const result = render();
    expect(result.website).toContain('<path d="M1.02.08L2.33.66L3.44.77z"/>');
    expect(result.website).toContain('<text x="1">1.02.08</text>');
  });

  test('replaces every repeated anchor', () => {
    const result = render({
      readme: `HyperclayLocal-${OLD}.dmg ${OLD} HyperclayLocal-${OLD}.dmg`,
      website: `data-version="${OLD}" data-version="${OLD}"`,
    });
    expect(result.readme).toBe(`HyperclayLocal-${NEW}.dmg ${OLD} HyperclayLocal-${NEW}.dmg`);
    expect(result.website).toBe(`data-version="${NEW}" data-version="${NEW}"`);
  });

  test('leaves text with no matching anchor unchanged', () => {
    const readme = 'Download the app from the website.';
    const website = '<svg><path d="M1.02.08"/></svg>';
    const result = render({ readme, website });
    expect(result.readme).toBe(readme);
    expect(result.website).toBe(website);
  });

  test('leaves the caller input and options objects unchanged', () => {
    const inputObject = input();
    const optionsObject = options();
    const before = { ...inputObject, ...optionsObject };
    const result = renderReleaseVersion(inputObject, optionsObject);
    expect(inputObject).toEqual({
      packageJson: before.packageJson,
      readme: before.readme,
      website: before.website,
    });
    expect(optionsObject).toEqual({ previousVersion: OLD, version: NEW });
    expect(result.packageJson).not.toBe(inputObject.packageJson);
  });

  test('accepts major, minor and patch increases', () => {
    expect(render({}, { version: '2.0.0' }).packageJson).toContain('"version": "2.0.0"');
    expect(render({}, { version: '1.29.0' }).packageJson).toContain('"version": "1.29.0"');
    expect(render({}, { version: '1.28.1' }).packageJson).toContain('"version": "1.28.1"');
  });

  test('refuses equal, lower, invalid and oversized versions', () => {
    expectInvalid(() => render({}, { version: OLD }));
    expectInvalid(() => render({}, { version: '1.27.9' }));
    expectInvalid(() => render({}, { version: '2.0' }));
    expectInvalid(() => render({}, { version: 'v1.29.0' }));
    expectInvalid(() => render({}, { version: '1.29.0-beta' }));
    expectInvalid(() => render({}, { version: '01.29.0' }));
    expectInvalid(() => render({}, { version: '1.29.65536' }));
    expectInvalid(() => render({}, { previousVersion: '1.28' }));
    expectInvalid(() => render({}, { previousVersion: '1.28.65536' }));
  });

  test('refuses a package.json that does not match the previous version', () => {
    expectInvalid(() => render({ packageJson: PKG_BEFORE.replace(OLD, '1.27.0') }));
  });

  test('refuses JSON primitives, arrays, null and malformed JSON', () => {
    expectInvalid(() => render({ packageJson: '123' }));
    expectInvalid(() => render({ packageJson: '"text"' }));
    expectInvalid(() => render({ packageJson: '[]' }));
    expectInvalid(() => render({ packageJson: 'null' }));
    expectInvalid(() => render({ packageJson: '{' }));
  });

  test('refuses input that is not three text files', () => {
    expectInvalid(() => render({ readme: null }));
    expectInvalid(() => render({ website: undefined }));
    expectInvalid(() => renderReleaseVersion(null, options()));
  });

  test('import and render touch no filesystem or command surface', () => {
    const env = { ...process.env, HC_VERSION_RENDER_SENTINEL: '1' };
    delete env.NODE_OPTIONS;
    const result = childProcess.spawnSync(process.execPath, [sentinelPath, RENDERER_PATH], {
      encoding: 'utf8',
      env,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout);
    const unexpected = entries.filter(entry => entry !== `fs.readFileSync:${RENDERER_PATH}`);
    expect(unexpected).toEqual([]);
  });
});

jest.setTimeout(180000);

describe('desktop version preparation', () => {
  const DESKTOP_REPO = 'hyperclay-local';
  const VERSION_PATHS = ['README.md', 'package.json', 'website/index.html'];
  const SIZE_PATHS = ['README.md', 'website/index.html'];
  const SOURCE_SHA = '3f9c1d7a4b2e5f8091a2b3c4d5e6f708192a3b4c';
  const DATE = '2026-01-02T03:04:05.678Z';
  const INSTALLER_NAMES = [
    `HyperclayLocal-${NEW}-arm64.dmg`,
    `HyperclayLocal-${NEW}.dmg`,
    `HyperclayLocal-Setup-${NEW}.exe`,
    `HyperclayLocal-${NEW}.AppImage`,
    `HyperclayLocal-${NEW}-arm64.AppImage`
  ];
  const INSTALLER_LABELS = ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux (x86_64)', 'Linux (ARM64)'];
  const INSTALLER_KEYS = ['mac-arm', 'mac-intel', 'windows', 'linux', 'linux-arm'];
  const MB_OLD = [102.3, 108.8, 90.1, 123.7, 123.4];
  const MB_NEW = [103.0, 109.7, 90.6, 124.0, 123.5];
  const PLAIN_README = '# Hyperclay Local\n\nDownload the app from the website.\n';
  const PLAIN_WEBSITE = '<!DOCTYPE html>\n<html>\n  <body>\n    <p>Download the app from the website.</p>\n  </body>\n</html>\n';

  let owner;
  let GIT_ENV;

  beforeAll(() => {
    owner = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-version-prep-'));
    const noHooks = path.join(owner, 'no-hooks');
    const gitConfig = path.join(owner, 'gitconfig');

    fs.mkdirSync(noHooks, { recursive: true });
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

    GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, GIT_OPTIONAL_LOCKS: '0' };
  });

  afterAll(() => {
    if (owner) fs.rmSync(owner, { recursive: true, force: true });
  });

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

  function write(root, rel, body) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  }

  function packageFixture(version) {
    return [
      '{',
      '  "name": "hyperclay-local-electron",',
      '  "productName": "HyperclayLocal",',
      `  "version": "${version}",`,
      '  "description": "Hyperclay Local Server - Desktop App",',
      '  "build": {',
      '    "artifactName": "HyperclayLocal-Setup-${version}.${ext}"',
      '  },',
      '  "hyper": {',
      '    "status": "active"',
      '  }',
      '}',
      ''
    ].join('\n');
  }

  function readmeFixture(version) {
    const forms = [
      `HyperclayLocal-Setup-${version}.exe`,
      `HyperclayLocal-${version}.dmg`,
      `HyperclayLocal-${version}-arm64.dmg`,
      `HyperclayLocal-${version}.AppImage`,
      `HyperclayLocal-${version}-arm64.AppImage`
    ];
    return [
      '# Hyperclay Local',
      '',
      '## Download',
      '',
      ...forms.map((form) => `- [${form}](https://local.hyperclay.com/${form})`),
      ''
    ].join('\n');
  }

  function websiteFixture(version) {
    return [
      '<!DOCTYPE html>',
      '<html>',
      '  <body>',
      `    <section class="section" id="downloads" data-version="${version}">`,
      ...INSTALLER_NAMES.map((name) => `      <a class="dl-file" href="https://local.hyperclay.com/${name}">${name}</a>`),
      '    </section>',
      '  </body>',
      '</html>',
      ''
    ].join('\n');
  }

  function sizeReadmeFixture(mb) {
    const lines = [`# Hyperclay Local ${NEW}`, '', 'Download the app for your platform:', ''];
    INSTALLER_NAMES.forEach((name, index) => {
      lines.push(`   - **${INSTALLER_LABELS[index]}**: [${name}](https://local.hyperclay.com/${name}) (${Number(mb[index]).toFixed(1)}MB)`);
    });
    lines.push('', 'Install and run the app.', '');
    return lines.join('\n');
  }

  function sizeWebsiteFixture(mb) {
    const lines = [
      `<section class="section" id="downloads" data-version="${NEW}">`,
      '  <ul class="dl-list">'
    ];
    INSTALLER_NAMES.forEach((name, index) => {
      lines.push(
        `    <li class="dl-row" data-os="${INSTALLER_KEYS[index]}">`,
        `      <a class="dl-file" download href="https://local.hyperclay.com/${name}">${name}</a>`,
        `      <span class="dl-size">${Number(mb[index]).toFixed(1)} MB</span>`,
        '    </li>'
      );
    });
    lines.push('  </ul>', '</section>', '');
    return lines.join('\n');
  }

  function sizeManifest(mb) {
    const sizes = {};
    INSTALLER_NAMES.forEach((name, index) => { sizes[name] = Math.round(mb[index] * 1024 * 1024); });
    return { version: NEW, commit: SOURCE_SHA, date: DATE, files: INSTALLER_NAMES.slice(), sizes };
  }

  function publicationFor(manifest) {
    const dir = fs.mkdtempSync(path.join(owner, `manifest-${++fixtureSeq}-`));
    const manifestFile = path.join(dir, 'release-info.json');
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.writeFileSync(manifestFile, bytes);
    return { manifestFile, manifestSha256: sha256(bytes), sourceSha: manifest.commit };
  }

  function makeRepo(files) {
    const parentDir = fs.mkdtempSync(path.join(owner, `parent-${++fixtureSeq}-`));
    const repoRoot = path.join(parentDir, DESKTOP_REPO);
    fs.mkdirSync(repoRoot, { recursive: true });
    git(repoRoot, ['init', '-q', '-b', 'main']);
    for (const [rel, body] of Object.entries(files)) {
      if (body !== null) write(repoRoot, rel, body);
    }
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'fixture']);
    const evidenceRoot = fs.mkdtempSync(path.join(owner, `evidence-${++fixtureSeq}-`));
    return {
      parentDir,
      repoRoot,
      evidenceRoot,
      runDir: path.join(evidenceRoot, `run-${++runSeq}`),
      outDir: path.join(evidenceRoot, `out-${++outSeq}`)
    };
  }

  function makeFixture(overrides = {}) {
    return makeRepo(Object.assign({
      'README.md': readmeFixture(OLD),
      'package.json': packageFixture(OLD),
      'website/index.html': websiteFixture(OLD),
      'src/app.js': 'module.exports = {};\n'
    }, overrides));
  }

  function makeSizeFixture() {
    return makeRepo({
      'README.md': sizeReadmeFixture(MB_OLD),
      'package.json': packageFixture(NEW),
      'website/index.html': sizeWebsiteFixture(MB_OLD),
      'src/app.js': 'module.exports = {};\n'
    });
  }

  function prepareRun() {
    return (command, args, options = {}) => {
      if (command === 'npm') throw new Error('desktop version preparation must not run npm');
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

  function readDescriptor(fixture) {
    return JSON.parse(fs.readFileSync(descriptorPath(fixture), 'utf8'));
  }

  function prepareCandidate(fixture, { previousVersion = OLD, version = NEW, run = prepareRun() } = {}) {
    return prepareReleaseVersion({
      previousVersion,
      version,
      parentDir: fixture.parentDir,
      runDir: fixture.runDir
    }, { run });
  }

  function prepareSize(fixture, publication, { version = NEW, run = prepareRun() } = {}) {
    return prepareDownloadSizes({
      version,
      parentDir: fixture.parentDir,
      runDir: fixture.runDir,
      publication
    }, { run });
  }

  function attemptPrepare(fixture, options = {}) {
    try {
      return { ok: true, prepared: prepareCandidate(fixture, options) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function planAttempt(fixture, { repo = DESKTOP_REPO, version = NEW, mutate, outDir, run = planRun() } = {}) {
    if (mutate) {
      const descriptor = readDescriptor(fixture);
      mutate(descriptor.targets[0], descriptor);
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

  function expectPlanRefusal(attempt, pattern, label) {
    if (attempt.ok) throw new Error(`${label} was accepted`);
    expect(attempt.error.message).toMatch(pattern);
  }

  function planFixture(fixture) {
    const attempt = planAttempt(fixture);
    expect(attempt.ok).toBe(true);
    return attempt.record;
  }

  function prepareAndPlan(fixture) {
    prepareCandidate(fixture);
    return planFixture(fixture);
  }

  function verifyFixture(record) {
    return verifyDocsApplication(record.applicationFile, { run: planRun(), spawn: spawnRun() });
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

  function expectedRender(repoRoot, previousVersion = OLD, version = NEW) {
    return renderReleaseVersion({
      packageJson: fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
      readme: fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'),
      website: fs.readFileSync(path.join(repoRoot, 'website/index.html'), 'utf8')
    }, { previousVersion, version });
  }

  function tamperAfterRender(fixture, tamper) {
    const original = fs.writeFileSync;
    const sourceDir = path.join(fixture.runDir, DESKTOP_REPO, 'source');
    let writes = 0;
    fs.writeFileSync = function (file, ...args) {
      const result = original.call(this, file, ...args);
      if (typeof file === 'string' && file.startsWith(sourceDir + path.sep)) {
        writes += 1;
        if (writes === VERSION_PATHS.length) tamper(sourceDir);
      }
      return result;
    };
    return () => { fs.writeFileSync = original; };
  }

  function descriptorValue(dir) {
    return {
      schema: 1,
      version: NEW,
      runDir: dir,
      targets: [{
        repo: DESKTOP_REPO,
        repoRoot: path.join(dir, DESKTOP_REPO),
        beforeHead: 'a'.repeat(40),
        indexFingerprint: 'b'.repeat(64),
        sourcePath: 'package.json',
        oldVersion: OLD,
        paths: [{ path: 'README.md' }, { path: 'package.json' }, { path: 'website/index.html' }],
        state: 'prepared',
        versionPreparation: { previousVersion: OLD }
      }]
    };
  }

  function descriptorAttempt(dir, { repo = DESKTOP_REPO, mutate, version = NEW } = {}) {
    const descriptorFile = path.join(dir, 'prepared.json');
    const value = descriptorValue(dir);
    mutate(value.targets[0], value);
    fs.writeFileSync(descriptorFile, `${JSON.stringify(value, null, 2)}\n`);
    try {
      const record = prepareDocsApplication({
        preparedFile: descriptorFile,
        repo,
        parentDir: owner,
        version,
        outDir: path.join(dir, `out-${++outSeq}`)
      }, { run: planRun() });
      return { ok: true, record };
    } catch (error) {
      return { ok: false, error };
    }
  }

  test('refuses ambiguous, incomplete and unknown desktop preparation variants', () => {
    const dir = fs.mkdtempSync(path.join(owner, 'descriptor-cases-'));
    const cases = [
      ['both variants', (target) => {
        target.publication = { manifestFile: path.join(dir, 'release-info.json'), manifestSha256: 'a'.repeat(64), sourceSha: 'a'.repeat(40) };
      }, /desktop target needs exactly one preparation variant/],
      ['neither variant', (target) => { delete target.versionPreparation; }, /desktop target needs exactly one preparation variant/],
      ['unknown extra field', (target) => { target.extra = true; }, /desktop target fields do not match its preparation variant/],
      ['extra versionPreparation field', (target) => {
        target.versionPreparation = { previousVersion: OLD, extra: true };
      }, /versionPreparation must contain exactly previousVersion/],
      ['missing previousVersion', (target) => { target.versionPreparation = {}; }, /versionPreparation must contain exactly previousVersion/],
      ['null versionPreparation', (target) => { target.versionPreparation = null; }, /versionPreparation must contain exactly previousVersion/],
      ['array versionPreparation', (target) => { target.versionPreparation = []; }, /versionPreparation must contain exactly previousVersion/],
      ['text versionPreparation', (target) => { target.versionPreparation = '1.28.0'; }, /versionPreparation must contain exactly previousVersion/],
      ['previousVersion mismatch', (target) => {
        target.versionPreparation = { previousVersion: '1.27.0' };
      }, /versionPreparation previousVersion must match oldVersion/],
      ['mixed desktop and docs targets', (target, value) => {
        value.targets.push(Object.assign({}, target, { repo: 'hyperclay', sourcePath: 'server-pages/hyperclay-local.edge' }));
      }, /a desktop descriptor must contain only the hyperclay-local target/]
    ];
    for (const [label, mutate, pattern] of cases) {
      const attempt = descriptorAttempt(dir, { mutate });
      expect(attempt.ok).toBe(false);
      expect(attempt.error.message).toMatch(pattern);
    }
    expect(descriptorAttempt(dir, {
      repo: 'hyperclay',
      mutate: (target, value) => {
        value.targets.push(Object.assign({}, target, { repo: 'hyperclay', sourcePath: 'server-pages/hyperclay-local.edge' }));
      }
    }).error.message).toMatch(/a desktop descriptor must contain only the hyperclay-local target/);
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('out-'))).toEqual([]);
  });

  testPosix('prepares, plans and verifies the exact three-file version candidate', () => {
    const fixture = makeFixture();
    const before = liveSnapshot(fixture.repoRoot);
    const expected = expectedRender(fixture.repoRoot);

    const prepared = prepareCandidate(fixture);

    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(NEW);
    expect(prepared.runDir).toBe(path.join(fs.realpathSync(path.dirname(fixture.runDir)), path.basename(fixture.runDir)));
    expect(prepared.targets).toHaveLength(1);
    const target = prepared.targets[0];
    expect(Object.keys(target).sort()).toEqual([
      'beforeHead', 'indexFingerprint', 'oldVersion', 'paths', 'repo', 'repoRoot', 'sourcePath', 'state', 'versionPreparation'
    ]);
    expect(target.repo).toBe(DESKTOP_REPO);
    expect(target.repoRoot).toBe(fixture.repoRoot);
    expect(target.beforeHead).toBe(before.head);
    expect(target.indexFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(target.sourcePath).toBe('package.json');
    expect(target.oldVersion).toBe(OLD);
    expect(target.state).toBe('prepared');
    expect(target.versionPreparation).toEqual({ previousVersion: OLD });
    expect(target.paths.map((entry) => entry.path)).toEqual(VERSION_PATHS);
    for (const entry of target.paths) {
      expect(entry.changed).toBe(true);
      expect(entry.mode).toBe('644');
      expect(entry.beforeSha256).toBe(sha256(fs.readFileSync(entry.beforeFile)));
      expect(entry.afterSha256).toBe(sha256(fs.readFileSync(entry.afterFile)));
    }
    const byPath = new Map(target.paths.map((entry) => [entry.path, entry]));
    expect(fs.readFileSync(byPath.get('package.json').afterFile, 'utf8')).toBe(expected.packageJson);
    expect(fs.readFileSync(byPath.get('README.md').afterFile, 'utf8')).toBe(expected.readme);
    expect(fs.readFileSync(byPath.get('website/index.html').afterFile, 'utf8')).toBe(expected.website);
    expect(JSON.parse(fs.readFileSync(descriptorPath(fixture), 'utf8'))).toEqual(prepared);
    expect(fs.existsSync(`${descriptorPath(fixture)}.staging`)).toBe(false);
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);

    const record = planFixture(fixture);

    expect(record.repo).toBe(DESKTOP_REPO);
    expect(record.sourcePath).toBe('package.json');
    expect(record.requiredPaths).toEqual(VERSION_PATHS);
    expect(record.paths).toEqual(VERSION_PATHS);
    expect(record.files.find((file) => file.path === 'package.json').changed).toBe(true);
    expect(fs.statSync(record.patchFile).size).toBeGreaterThan(0);
    expect(record.expectedTree).not.toBe(git(fixture.repoRoot, ['rev-parse', 'HEAD^{tree}']).trim());
    for (const file of record.files) {
      expect(sha256(fs.readFileSync(file.afterFile))).toBe(file.afterSha256);
      expect(git(fixture.repoRoot, ['cat-file', 'blob', `${record.expectedTree}:${file.path}`]))
        .toBe(fs.readFileSync(file.afterFile, 'utf8'));
    }
    expect(git(fixture.repoRoot, ['cat-file', 'blob', `${record.expectedTree}:package.json`])).toBe(expected.packageJson);

    const verified = verifyFixture(record);
    expect(verified.expectedTree).toBe(record.expectedTree);
    expect(verified.requiredPaths).toEqual(VERSION_PATHS);
    expect(git(fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
    expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
  });

  testPosix('keeps an unchanged README or website as a prepared no-op entry', () => {
    const readmeNoop = makeFixture({ 'README.md': PLAIN_README });
    const prepared = prepareCandidate(readmeNoop);
    const readme = prepared.targets[0].paths.find((entry) => entry.path === 'README.md');
    expect(readme.changed).toBe(false);
    expect(readme.afterSha256).toBe(readme.beforeSha256);
    expect(fs.readFileSync(readme.afterFile, 'utf8')).toBe(PLAIN_README);
    const readmeRecord = planFixture(readmeNoop);
    expect(readmeRecord.requiredPaths).toEqual(VERSION_PATHS);
    expect(readmeRecord.paths).toEqual(['package.json', 'website/index.html']);
    expect(readmeRecord.files.find((file) => file.path === 'README.md').changed).toBe(false);
    expect(verifyFixture(readmeRecord).requiredPaths).toEqual(VERSION_PATHS);

    const websiteNoop = makeFixture({ 'website/index.html': PLAIN_WEBSITE });
    const websitePrepared = prepareCandidate(websiteNoop);
    const website = websitePrepared.targets[0].paths.find((entry) => entry.path === 'website/index.html');
    expect(website.changed).toBe(false);
    expect(website.afterSha256).toBe(website.beforeSha256);
    expect(fs.readFileSync(website.afterFile, 'utf8')).toBe(PLAIN_WEBSITE);
    const websiteRecord = planFixture(websiteNoop);
    expect(websiteRecord.requiredPaths).toEqual(VERSION_PATHS);
    expect(websiteRecord.paths).toEqual(['README.md', 'package.json']);
    expect(websiteRecord.files.find((file) => file.path === 'website/index.html').changed).toBe(false);
    expect(verifyFixture(websiteRecord).requiredPaths).toEqual(VERSION_PATHS);
  });

  testPosix('revalidates the version application after HEAD advances', () => {
    const fixture = makeFixture();
    const record = prepareAndPlan(fixture);
    const beforeHead = record.beforeHead;

    write(fixture.repoRoot, 'notes.md', 'unrelated later work\n');
    git(fixture.repoRoot, ['add', 'notes.md']);
    git(fixture.repoRoot, ['commit', '-q', '-m', 'unrelated later commit']);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);

    const verified = verifyFixture(record);

    expect(verified.beforeHead).toBe(beforeHead);
    expect(verified.expectedTree).toBe(record.expectedTree);
    expect(verified.requiredPaths).toEqual(VERSION_PATHS);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD^{tree}']).trim()).not.toBe(record.expectedTree);
  });

  testPosix('verifies a real two-file size control through the same union', () => {
    const fixture = makeSizeFixture();
    const publication = publicationFor(sizeManifest(MB_NEW));

    const prepared = prepareSize(fixture, publication);
    const target = prepared.targets[0];
    expect(Object.keys(target).sort()).toEqual([
      'beforeHead', 'indexFingerprint', 'oldVersion', 'paths', 'publication', 'repo', 'repoRoot', 'sourcePath', 'state'
    ]);
    expect(target.sourcePath).toBe('README.md');
    expect(target.oldVersion).toBe(NEW);
    expect(target.publication).toEqual(publication);
    expect(target.paths.map((entry) => entry.path)).toEqual(SIZE_PATHS);

    const record = planFixture(fixture);

    expect(record.repo).toBe(DESKTOP_REPO);
    expect(record.sourcePath).toBe('README.md');
    expect(record.requiredPaths).toEqual(SIZE_PATHS);
    expect(record.paths).toEqual(SIZE_PATHS);
    expect(record.files.map((file) => file.changed)).toEqual([true, true]);
    expect(fs.statSync(record.patchFile).size).toBeGreaterThan(0);

    const verified = verifyFixture(record);
    expect(verified.requiredPaths).toEqual(SIZE_PATHS);
    expect(readDescriptor(fixture).targets[0].oldVersion).toBe(NEW);
    expect(git(fixture.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(record.beforeHead);
    expect(git(fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });

  testPosix('refuses a mismatched package version, ordering and sourcePath on the version variant', () => {
    const fixture = makeFixture();
    prepareCandidate(fixture);
    const pristine = fs.readFileSync(descriptorPath(fixture), 'utf8');

    const cases = [
      ['package version', (target) => {
        target.oldVersion = '1.27.0';
        target.versionPreparation = { previousVersion: '1.27.0' };
      }, /Release package\.json must match the previous version/],
      ['lower version', (target) => {
        target.oldVersion = '1.30.0';
        target.versionPreparation = { previousVersion: '1.30.0' };
      }, /Release version must be greater than the previous version/],
      ['equal version', (target) => {
        target.oldVersion = NEW;
        target.versionPreparation = { previousVersion: NEW };
      }, /Release version must be greater than the previous version/],
      ['wrong sourcePath', (target) => { target.sourcePath = 'README.md'; }, /hyperclay-local sourcePath must be package\.json/],
      ['malformed oldVersion', (target) => {
        target.oldVersion = 'not-a-version';
        target.versionPreparation = { previousVersion: 'not-a-version' };
      }, /hyperclay-local oldVersion must look like 1\.2\.3/]
    ];
    for (const [label, mutate, pattern] of cases) {
      expectPlanRefusal(planAttempt(fixture, { mutate }), pattern, label);
      fs.writeFileSync(descriptorPath(fixture), pristine);
    }

    expect(fs.existsSync(path.join(fixture.outDir, 'application.json'))).toBe(false);
    expect(git(fixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });

  testPosix('refuses a third file on the size variant and a missing third file on the version variant', () => {
    const sizeFixture = makeSizeFixture();
    prepareSize(sizeFixture, publicationFor(sizeManifest(MB_NEW)));
    const sizePristine = fs.readFileSync(descriptorPath(sizeFixture), 'utf8');

    const sizeCases = [
      ['third size path', (target) => { target.paths.push({ path: 'package.json' }); }, /prepared paths .* do not match the release targets/],
      ['size sourcePath', (target) => { target.sourcePath = 'website/index.html'; }, /hyperclay-local sourcePath must be README\.md/],
      ['size without publication', (target) => { delete target.publication; }, /desktop target needs exactly one preparation variant/],
      ['size with versionPreparation', (target) => { target.versionPreparation = { previousVersion: NEW }; }, /desktop target needs exactly one preparation variant/]
    ];
    for (const [label, mutate, pattern] of sizeCases) {
      expectPlanRefusal(planAttempt(sizeFixture, { mutate }), pattern, label);
      fs.writeFileSync(descriptorPath(sizeFixture), sizePristine);
    }
    expect(fs.existsSync(path.join(sizeFixture.outDir, 'application.json'))).toBe(false);

    const versionFixture = makeFixture();
    prepareCandidate(versionFixture);
    const versionPristine = fs.readFileSync(descriptorPath(versionFixture), 'utf8');

    expectPlanRefusal(planAttempt(versionFixture, {
      mutate: (target) => { target.paths = target.paths.filter((entry) => entry.path !== 'website/index.html'); }
    }), /prepared paths .* do not match the release targets/, 'missing third version path');
    fs.writeFileSync(descriptorPath(versionFixture), versionPristine);

    expectPlanRefusal(planAttempt(versionFixture, {
      mutate: (target, descriptor) => {
        descriptor.targets.push(Object.assign({}, target, { repo: 'hyperclay', sourcePath: 'server-pages/hyperclay-local.edge' }));
      }
    }), /a desktop descriptor must contain only the hyperclay-local target/, 'mixed version descriptor');
    fs.writeFileSync(descriptorPath(versionFixture), versionPristine);

    expect(fs.existsSync(path.join(versionFixture.outDir, 'application.json'))).toBe(false);
    expect(git(versionFixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });

  testPosix('refuses added, deleted, nonselected and mode-changed prepared output', () => {
    const cases = [
      ['added fourth path', (sourceDir) => {
        fs.writeFileSync(path.join(sourceDir, 'release-notes.md'), 'generated notes\n');
      }, /hyperclay-local added release-notes\.md is not permitted/],
      ['deleted selected path', (sourceDir) => {
        fs.rmSync(path.join(sourceDir, 'website/index.html'));
      }, /hyperclay-local deleted website\/index\.html is not permitted/],
      ['nonselected change', (sourceDir) => {
        fs.writeFileSync(path.join(sourceDir, 'src/app.js'), 'module.exports = { generated: true };\n');
      }, /hyperclay-local changed src\/app\.js, which is outside the release targets/],
      ['mode change', (sourceDir) => {
        fs.chmodSync(path.join(sourceDir, 'package.json'), 0o755);
      }, /hyperclay-local mode package\.json is not permitted/]
    ];
    for (const [label, tamper, pattern] of cases) {
      const fixture = makeFixture();
      const before = liveSnapshot(fixture.repoRoot);
      const restore = tamperAfterRender(fixture, tamper);
      let error = null;
      try {
        prepareCandidate(fixture);
      } catch (caught) {
        error = caught;
      } finally {
        restore();
      }
      if (error === null) throw new Error(`${label} was accepted`);
      expect(error.message).toMatch(pattern);
      expect(fs.existsSync(descriptorPath(fixture))).toBe(false);
      expect(liveSnapshot(fixture.repoRoot)).toEqual(before);
    }
  });

  testPosix('refuses a dirty selected file, a staged file and a missing or symlinked selected file', () => {
    const dirty = makeFixture();
    const dirtyBefore = liveSnapshot(dirty.repoRoot);
    write(dirty.repoRoot, 'package.json', '{"version":"1.28.0"}\n');
    const dirtyAttempt = attemptPrepare(dirty);
    expect(dirtyAttempt.ok).toBe(false);
    expect(dirtyAttempt.error.message).toMatch(/hyperclay-local has pending changes for README\.md, package\.json, website\/index\.html/);
    expect(fs.existsSync(descriptorPath(dirty))).toBe(false);
    expect(fs.readFileSync(path.join(dirty.repoRoot, 'package.json'), 'utf8')).toBe('{"version":"1.28.0"}\n');
    expect(git(dirty.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(dirtyBefore.head);

    const staged = makeFixture();
    write(staged.repoRoot, 'src/app.js', 'module.exports = { staged: true };\n');
    git(staged.repoRoot, ['add', 'src/app.js']);
    const stagedAttempt = attemptPrepare(staged);
    expect(stagedAttempt.ok).toBe(false);
    expect(stagedAttempt.error.message).toMatch(/hyperclay-local has staged changes: src\/app\.js/);
    expect(fs.existsSync(descriptorPath(staged))).toBe(false);
    expect(git(staged.repoRoot, ['diff', '--cached', '--name-only']).trim()).toBe('src/app.js');

    const missing = makeFixture({ 'package.json': null });
    const missingAttempt = attemptPrepare(missing);
    expect(missingAttempt.ok).toBe(false);
    expect(missingAttempt.error.message).toMatch(/hyperclay-local version target package\.json is missing/);
    expect(fs.existsSync(descriptorPath(missing))).toBe(false);

    const symlinked = makeFixture();
    fs.rmSync(path.join(symlinked.repoRoot, 'package.json'));
    fs.symlinkSync('README.md', path.join(symlinked.repoRoot, 'package.json'));
    git(symlinked.repoRoot, ['add', '-A']);
    git(symlinked.repoRoot, ['commit', '-q', '-m', 'symlinked package']);
    const symlinkAttempt = attemptPrepare(symlinked);
    expect(symlinkAttempt.ok).toBe(false);
    expect(symlinkAttempt.error.message).toMatch(/snapshot entry is a symlink: package\.json/);
    expect(fs.existsSync(descriptorPath(symlinked))).toBe(false);
    expect(fs.lstatSync(path.join(symlinked.repoRoot, 'package.json')).isSymbolicLink()).toBe(true);
  });

  testPosix('refuses consistently tampered version after bytes with rewritten digests', () => {
    const rewrite = (entry) => {
      const tampered = fs.readFileSync(entry.afterFile, 'utf8').replace(`data-version="${NEW}"`, 'data-version="1.29.1"');
      fs.writeFileSync(entry.afterFile, tampered);
      const bytes = fs.readFileSync(entry.afterFile);
      entry.afterSha256 = sha256(bytes);
      entry.changed = true;
      return bytes;
    };

    const preparedFixture = makeFixture();
    prepareCandidate(preparedFixture);
    const descriptor = readDescriptor(preparedFixture);
    rewrite(descriptor.targets[0].paths.find((entry) => entry.path === 'website/index.html'));
    fs.writeFileSync(descriptorPath(preparedFixture), `${JSON.stringify(descriptor, null, 2)}\n`);

    expectPlanRefusal(planAttempt(preparedFixture),
      /desktop version after bytes do not match renderReleaseVersion/, 'tampered after bytes');
    expect(fs.existsSync(path.join(preparedFixture.outDir, 'application.json'))).toBe(false);

    const appliedFixture = makeFixture();
    const record = prepareAndPlan(appliedFixture);
    const tampered = rewrite(record.files.find((file) => file.path === 'website/index.html'));
    const application = JSON.parse(fs.readFileSync(record.applicationFile, 'utf8'));
    application.files.find((file) => file.path === 'website/index.html').afterSha256 = sha256(tampered);
    fs.writeFileSync(record.applicationFile, `${JSON.stringify(application, null, 2)}\n`);
    const tamperedDescriptor = readDescriptor(appliedFixture);
    const tamperedEntry = tamperedDescriptor.targets[0].paths.find((entry) => entry.path === 'website/index.html');
    tamperedEntry.afterSha256 = sha256(tampered);
    tamperedEntry.changed = true;
    fs.writeFileSync(descriptorPath(appliedFixture), `${JSON.stringify(tamperedDescriptor, null, 2)}\n`);

    let error = null;
    try {
      verifyFixture(record);
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeNull();
    expect(error.code).toBe('DOCS_APPLICATION_INVALID');
    expect(error.message).toMatch(/desktop version after bytes do not match renderReleaseVersion/);
    expect(git(appliedFixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });

  testPosix('refuses an altered private index and a substituted patch', () => {
    const indexFixture = makeFixture();
    const indexRecord = prepareAndPlan(indexFixture);
    const env = { ...GIT_ENV, GIT_INDEX_FILE: indexRecord.privateIndexFile, GIT_OPTIONAL_LOCKS: '0' };
    git(indexFixture.repoRoot, ['update-index', '--add', '--cacheinfo', `100644,${'a'.repeat(40)},intruder.txt`], { env });

    let indexError = null;
    try {
      verifyFixture(indexRecord);
    } catch (caught) {
      indexError = caught;
    }
    expect(indexError).not.toBeNull();
    expect(indexError.code).toBe('DOCS_APPLICATION_INVALID');
    expect(indexError.message).toMatch(/private index fingerprint/);
    expect(git(indexFixture.repoRoot, ['status', '--porcelain=v1', '-z'])).toBe('');

    const patchFixture = makeFixture();
    const patchRecord = prepareAndPlan(patchFixture);
    const substitute = Buffer.from('not a Git patch\n', 'utf8');
    fs.writeFileSync(patchRecord.patchFile, substitute);
    const application = JSON.parse(fs.readFileSync(patchRecord.applicationFile, 'utf8'));
    application.patchSha256 = sha256(substitute);
    fs.writeFileSync(patchRecord.applicationFile, `${JSON.stringify(application, null, 2)}\n`);

    let patchError = null;
    try {
      verifyFixture(patchRecord);
    } catch (caught) {
      patchError = caught;
    }
    expect(patchError).not.toBeNull();
    expect(patchError.code).toBe('DOCS_APPLICATION_INVALID');
    expect(patchError.message).toMatch(/does not match the regenerated patch/);
    expect(git(patchFixture.repoRoot, ['status', '--porcelain=v1']).trim()).toBe('');
  });
});
