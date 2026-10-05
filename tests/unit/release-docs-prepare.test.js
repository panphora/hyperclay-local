// The external docs update is prepared inside git-archive snapshots, so the
// sibling checkouts are never touched and a later step can apply a verified
// result. Every fixture repo here is local scratch under one owned temp root.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs, prepareVersion } = require('../../scripts/release-docs-prepare');
const { superviseRelease } = require('../../scripts/release-transcript');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const OLD = '1.28.0';
const NEW = '1.29.0';
const NPM_INSTALL = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'];

// The default run path is exercised with a fake npm on PATH, so the fake npm has
// to push more than a pipe buffer through both inherited streams itself.
const BIG_BLOCK = 2 * 1024 * 1024 + 4096;
const STDOUT_TAIL = 'FAKE-NPM-STDOUT-TAIL\n';
const STDERR_TAIL = 'FAKE-NPM-STDERR-TAIL\n';
const PER_CALL_STDOUT = `${'O'.repeat(BIG_BLOCK)}\n${STDOUT_TAIL}`;
const PER_CALL_STDERR = `${'E'.repeat(BIG_BLOCK)}\n${STDERR_TAIL}`;
const PREPARE_MODULE = require.resolve('../../scripts/release-docs-prepare');

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-docs-prepare-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const RUNS = path.join(OWNER, 'runs');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

fs.mkdirSync(NO_HOOKS, { recursive: true });
fs.mkdirSync(RUNS, { recursive: true });
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

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG };

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

let fixtureSeq = 0;
let runSeq = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function git(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
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
    const vault = fs.readFileSync(path.join(vaultDir, name), 'utf8');
    write(cwd, `content/docs/${cleanName(name)}.mdx`, canonicalMdx(title, vault));
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

function makeFixture({ omitEdge = false, omitMdx = false, vault = VAULT_HEAD, extraVaultDocs = {} } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const hyperclay = path.join(parentDir, 'hyperclay');
  const website = path.join(parentDir, 'hyperclay-website');

  fs.mkdirSync(hyperclay, { recursive: true });
  git(hyperclay, ['init', '-q', '-b', 'main']);
  write(hyperclay, 'README.md', 'hyperclay readme\n');
  write(hyperclay, 'src/app.js', 'module.exports = {};\n');
  if (!omitEdge) write(hyperclay, `server-pages/${path.basename(EDGE_PATH)}`, EDGE_HEAD);
  git(hyperclay, ['add', '-A']);
  git(hyperclay, ['commit', '-q', '-m', 'fixture']);

  fs.mkdirSync(website, { recursive: true });
  git(website, ['init', '-q', '-b', 'main']);
  write(website, VAULT_PATH, vault);
  write(website, 'vault/DOCS/07 Platform.md', PLATFORM_VAULT);
  for (const [name, content] of Object.entries(extraVaultDocs)) write(website, `vault/DOCS/${name}`, content);
  write(website, 'package.json', `${JSON.stringify({
    name: 'hyperclay-website',
    version: '0.0.0',
    scripts: { 'sync-docs': 'node scripts/sync-docs.js', 'build:llms-txt': 'node scripts/build-llms-txt.js' }
  }, null, 2)}\n`);
  canonicalSyncDocs(website);
  if (omitMdx) fs.rmSync(path.join(website, MDX_PATH));
  canonicalLlmsTxt(website);
  git(website, ['add', '-A']);
  git(website, ['commit', '-q', '-m', 'fixture']);

  return { parentDir, hyperclay, website, runDir: path.join(RUNS, `run-${++runSeq}`) };
}

function makeRun({ liveWebsite, onInstall, onSyncDocs, onLlmsTxt } = {}) {
  const npmCalls = [];
  const run = (command, args, options = {}) => {
    if (command !== 'npm') {
      return childProcess.execFileSync(command, args, { encoding: 'utf8', env: GIT_ENV, ...options });
    }
    const cwd = options.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      throw new Error(`npm needs an absolute snapshot cwd, received ${String(cwd)}`);
    }
    if (cwd === liveWebsite || cwd.startsWith(`${liveWebsite}${path.sep}`)) {
      throw new Error(`npm was pointed at the live website repo: ${cwd}`);
    }
    npmCalls.push({ argv: args.slice(), cwd });
    const [sub, script] = args;
    if (sub === 'ci') {
      if (onInstall) onInstall(cwd);
      return '';
    }
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

function invoke(fixture, version, runOptions) {
  const run = makeRun({ liveWebsite: fixture.website, ...runOptions });
  const prepared = prepareExternalDocs({ version, parentDir: fixture.parentDir, runDir: fixture.runDir }, { run });
  return { run, prepared };
}

function expectRefusalWithRun(fixture, version, run, pattern) {
  let error = null;
  try {
    prepareExternalDocs({ version, parentDir: fixture.parentDir, runDir: fixture.runDir }, { run });
  } catch (caught) {
    error = caught;
  }
  expect(error).not.toBeNull();
  expect(error.message).toMatch(pattern);
  expect(fs.existsSync(path.join(fixture.runDir, 'prepared.json'))).toBe(false);
  return { run, error };
}

function expectRefusal(fixture, version, runOptions, pattern) {
  const run = makeRun({ liveWebsite: fixture.website, ...runOptions });
  return expectRefusalWithRun(fixture, version, run, pattern);
}

function invokeTargets(fixture, version, targets, runOptions) {
  const run = makeRun({ liveWebsite: fixture.website, ...runOptions });
  const prepared = prepareExternalDocs(
    { version, parentDir: fixture.parentDir, runDir: fixture.runDir, targets },
    { run }
  );
  return { run, prepared };
}

function expectTargetRefusal(fixture, version, targets, runOptions, pattern) {
  const run = makeRun({ liveWebsite: fixture.website, ...runOptions });
  let error = null;
  try {
    prepareExternalDocs({ version, parentDir: fixture.parentDir, runDir: fixture.runDir, targets }, { run });
  } catch (caught) {
    error = caught;
  }
  expect(error).not.toBeNull();
  expect(error.message).toMatch(pattern);
  expect(fs.existsSync(path.join(fixture.runDir, 'prepared.json'))).toBe(false);
  return { run, error };
}

function wrapRun(run, after) {
  const wrapped = (command, args, options = {}) => {
    const output = run(command, args, options);
    after(command, args, options);
    return output;
  };
  wrapped.npmCalls = run.npmCalls;
  return wrapped;
}

function expectLiveUntouched(fixture) {
  expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
  expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
}

function collector() {
  const chunks = [];
  const stream = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    }
  };
  return { stream, text: () => chunks.join('') };
}

function generatorsModuleSource() {
  return [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    write.toString(),
    bodyOf.toString(),
    cleanName.toString(),
    canonicalMdx.toString(),
    canonicalSyncDocs.toString(),
    canonicalLlmsTxt.toString(),
    'module.exports = { canonicalSyncDocs, canonicalLlmsTxt };',
    ''
  ].join('\n');
}

function fakeNpmSource(generatorsFile, failAt) {
  return [
    `#!${process.execPath}`,
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    `const generators = require(${JSON.stringify(generatorsFile)});`,
    `const BLOCK = ${BIG_BLOCK};`,
    `const STDOUT_TAIL = ${JSON.stringify(STDOUT_TAIL)};`,
    `const STDERR_TAIL = ${JSON.stringify(STDERR_TAIL)};`,
    `const FAIL_AT = ${failAt === null ? 'null' : failAt};`,
    'const argv = process.argv.slice(2);',
    "const record = path.join(process.env.FAKE_NPM_RECORD, 'calls.jsonl');",
    "fs.appendFileSync(record, JSON.stringify({ exe: process.argv[1], argv, cwd: process.cwd() }) + '\\n');",
    "const call = fs.readFileSync(record, 'utf8').trim().split('\\n').length;",
    "fs.writeSync(1, 'O'.repeat(BLOCK) + '\\n' + STDOUT_TAIL);",
    "fs.writeSync(2, 'E'.repeat(BLOCK) + '\\n' + STDERR_TAIL);",
    'if (FAIL_AT !== null && call >= FAIL_AT) process.exit(3);',
    'const [sub, script] = argv;',
    'const cwd = process.cwd();',
    "if (sub === 'ci') process.exit(0);",
    "if (sub === 'run' && script === 'sync-docs') { generators.canonicalSyncDocs(cwd); process.exit(0); }",
    "if (sub === 'run' && script === 'build:llms-txt') { generators.canonicalLlmsTxt(cwd); process.exit(0); }",
    "process.stderr.write('fake npm: unexpected command ' + argv.join(' ') + '\\n');",
    'process.exit(9);',
    ''
  ].join('\n');
}

function prepareChildSource() {
  return [
    "'use strict';",
    "const fs = require('fs');",
    `const { prepareExternalDocs } = require(${JSON.stringify(PREPARE_MODULE)});`,
    'const resultFile = process.env.PREP_RESULT;',
    'try {',
    '  const prepared = prepareExternalDocs({',
    '    version: process.env.PREP_VERSION,',
    '    parentDir: process.env.PREP_PARENT,',
    '    runDir: process.env.PREP_RUN',
    '  });',
    "  fs.writeFileSync(resultFile, JSON.stringify({ ok: true, targets: prepared.targets.map((target) => target.state) }));",
    '} catch (error) {',
    "  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, message: error && error.message ? String(error.message) : String(error) }));",
    '  process.exit(3);',
    '}',
    ''
  ].join('\n');
}

function defaultRunFixture({ failAt = null } = {}) {
  const fixture = makeFixture();
  const bin = fs.mkdtempSync(path.join(OWNER, 'fake-npm-'));
  const recordDir = fs.mkdtempSync(path.join(OWNER, 'fake-npm-record-'));
  const generatorsFile = path.join(bin, 'generators.js');
  const npmFile = path.join(bin, 'npm');
  const child = path.join(bin, 'prepare-child.js');
  const resultFile = path.join(bin, 'result.json');

  fs.writeFileSync(generatorsFile, generatorsModuleSource());
  fs.writeFileSync(npmFile, fakeNpmSource(generatorsFile, failAt), { mode: 0o755 });
  fs.writeFileSync(child, prepareChildSource());

  const callsFile = path.join(recordDir, 'calls.jsonl');
  const env = Object.assign({}, GIT_ENV, {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPM_RECORD: recordDir,
    PREP_VERSION: NEW,
    PREP_PARENT: fixture.parentDir,
    PREP_RUN: fixture.runDir,
    PREP_RESULT: resultFile
  });

  return { fixture, bin, npmFile, child, resultFile, callsFile, env };
}

function readFakeNpmCalls(callsFile) {
  if (!fs.existsSync(callsFile)) return [];
  return fs
    .readFileSync(callsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function superviseDefaultRun(setup, label) {
  const out = collector();
  const err = collector();
  return superviseRelease({
    scriptPath: setup.child,
    cwd: setup.fixture.parentDir,
    env: setup.env,
    logRoot: path.join(OWNER, 'logs', label),
    stdout: out.stream,
    stderr: err.stream
  }).then((result) => ({ result, out, err }));
}

function expectStreamTails(result, out, err, calls) {
  const expectedStdout = PER_CALL_STDOUT.repeat(calls);
  const expectedStderr = PER_CALL_STDERR.repeat(calls);
  const errText = err.text();
  const prefix = `Release transcript: ${result.logPath}\n`;

  expect(out.text() === expectedStdout).toBe(true);
  expect(Buffer.byteLength(out.text(), 'utf8')).toBe(expectedStdout.length);
  expect(errText.startsWith(prefix)).toBe(true);
  expect(errText.slice(prefix.length, prefix.length + expectedStderr.length) === expectedStderr).toBe(true);
  expect(errText.slice(prefix.length + expectedStderr.length).startsWith('Release transcript complete: ')).toBe(true);

  const log = fs.readFileSync(result.logPath, 'utf8');
  expect(log.includes(STDOUT_TAIL)).toBe(true);
  expect(log.includes(STDERR_TAIL)).toBe(true);
  expect(log.split(STDOUT_TAIL).length - 1).toBe(calls);
  expect(log.split(STDERR_TAIL).length - 1).toBe(calls);
}

describe('prepareVersion', () => {
  test('rewrites every download reference and the prose version', () => {
    const content = `HyperclayLocal-${OLD}.dmg HyperclayLocal-Setup-${OLD}.exe\nrelease ${OLD}\n`;
    const result = prepareVersion(content, NEW);
    expect(result.oldVersion).toBe(OLD);
    expect(result.updated).toContain(`HyperclayLocal-${NEW}.dmg`);
    expect(result.updated).toContain(`HyperclayLocal-Setup-${NEW}.exe`);
    expect(result.updated).toContain(`release ${NEW}`);
    expect(result.proseChanges).toEqual([`release ${NEW}`]);
  });

  test('leaves bytes untouched when the version already matches', () => {
    const result = prepareVersion(VAULT_HEAD, OLD);
    expect(result.oldVersion).toBe(OLD);
    expect(result.updated).toBe(VAULT_HEAD);
    expect(result.proseChanges).toEqual([]);
  });

  test('refuses mixed download versions instead of fixing the first match', () => {
    const content = `HyperclayLocal-${OLD}.dmg HyperclayLocal-1.27.0.dmg\n`;
    expect(() => prepareVersion(content, NEW)).toThrow(/mixed HyperclayLocal versions/);
  });

  test('refuses a missing download version and a malformed target version', () => {
    expect(() => prepareVersion('no downloads here\n', NEW)).toThrow(/no HyperclayLocal download version/);
    expect(() => prepareVersion(VAULT_HEAD, '1.29')).toThrow(/must look like 1\.2\.3/);
  });
});

describe('prepareExternalDocs', () => {
  test('prepares four changed files across both repos with exact bytes', () => {
    const fixture = makeFixture();
    const { run, prepared } = invoke(fixture, NEW);

    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(NEW);
    expect(prepared.runDir).toBe(fixture.runDir);
    expect(prepared.runDir.startsWith(fixture.parentDir)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(fixture.runDir, 'prepared.json'), 'utf8'))).toEqual(prepared);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay', 'hyperclay-website']);

    const hyperclay = prepared.targets[0];
    const website = prepared.targets[1];
    expect(hyperclay.state).toBe('prepared');
    expect(website.state).toBe('prepared');
    expect(hyperclay.repoRoot).toBe(fs.realpathSync(fixture.hyperclay));
    expect(website.repoRoot).toBe(fs.realpathSync(fixture.website));
    expect(hyperclay.beforeHead).toBe(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim());
    expect(website.beforeHead).toBe(git(fixture.website, ['rev-parse', 'HEAD']).trim());
    expect(hyperclay.indexFingerprint).toBe(sha256(git(fixture.hyperclay, ['ls-files', '--stage', '-z'])));
    expect(website.indexFingerprint).toBe(sha256(git(fixture.website, ['ls-files', '--stage', '-z'])));
    expect(hyperclay.sourcePath).toBe(EDGE_PATH);
    expect(website.sourcePath).toBe(VAULT_PATH);
    expect(hyperclay.oldVersion).toBe(OLD);
    expect(website.oldVersion).toBe(OLD);

    expect(hyperclay.paths.map((entry) => entry.path)).toEqual([EDGE_PATH]);
    expect(website.paths.map((entry) => entry.path)).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(hyperclay.paths.concat(website.paths).every((entry) => entry.changed)).toBe(true);

    const updatedEdge = EDGE_HEAD.split(OLD).join(NEW);
    const updatedVault = VAULT_HEAD.split(OLD).join(NEW);
    expect(fs.readFileSync(hyperclay.paths[0].beforeFile, 'utf8')).toBe(EDGE_HEAD);
    expect(fs.readFileSync(website.paths[0].beforeFile, 'utf8')).toBe(VAULT_HEAD);
    expect(hyperclay.paths[0].beforeSha256).toBe(sha256(EDGE_HEAD));
    expect(website.paths[0].beforeSha256).toBe(sha256(VAULT_HEAD));
    expect(fs.readFileSync(hyperclay.paths[0].afterFile, 'utf8')).toBe(updatedEdge);
    expect(fs.readFileSync(website.paths[0].afterFile, 'utf8')).toBe(updatedVault);
    expect(fs.readFileSync(website.paths[1].afterFile, 'utf8')).toBe(canonicalMdx('Hyperclay Local App', updatedVault));
    expect(hyperclay.paths[0].afterSha256).toBe(sha256(updatedEdge));
    expect(website.paths[0].afterSha256).toBe(sha256(updatedVault));

    const expectedHead = fs.mkdtempSync(path.join(OWNER, 'expected-head-'));
    write(expectedHead, MDX_PATH, canonicalMdx('Hyperclay Local App', VAULT_HEAD));
    write(expectedHead, 'content/docs/platform.mdx', canonicalMdx('Platform', PLATFORM_VAULT));
    canonicalLlmsTxt(expectedHead);
    const expectedNext = fs.mkdtempSync(path.join(OWNER, 'expected-next-'));
    write(expectedNext, MDX_PATH, canonicalMdx('Hyperclay Local App', updatedVault));
    write(expectedNext, 'content/docs/platform.mdx', canonicalMdx('Platform', PLATFORM_VAULT));
    canonicalLlmsTxt(expectedNext);
    expect(fs.readFileSync(website.paths[2].afterFile, 'utf8')).toBe(
      fs.readFileSync(path.join(expectedNext, LLMS_PATH), 'utf8')
    );
    expect(fs.readFileSync(website.paths[2].beforeFile, 'utf8')).toBe(
      fs.readFileSync(path.join(expectedHead, LLMS_PATH), 'utf8')
    );

    const websiteSnapshot = path.join(fixture.runDir, 'hyperclay-website', 'source');
    expect(run.npmCalls.map((call) => call.argv)).toEqual([
      NPM_INSTALL,
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt'],
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt']
    ]);
    expect(run.npmCalls.every((call) => call.cwd === websiteSnapshot)).toBe(true);
    expect(fs.existsSync(path.join(websiteSnapshot, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.runDir, 'hyperclay', 'source', '.git'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.runDir, 'hyperclay-website', 'source', 'node_modules'))).toBe(false);
    expectLiveUntouched(fixture);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toBe(VAULT_HEAD);
    expect(fs.readFileSync(path.join(fixture.website, MDX_PATH), 'utf8')).toBe(canonicalMdx('Hyperclay Local App', VAULT_HEAD));
    expect(fs.readFileSync(path.join(fixture.website, LLMS_PATH), 'utf8')).toBe(
      fs.readFileSync(path.join(expectedHead, LLMS_PATH), 'utf8')
    );
  });

  testPosix('the prepared run directory is private', () => {
    const fixture = makeFixture();
    const { prepared } = invoke(fixture, NEW);

    expect((fs.statSync(prepared.runDir).mode & 0o777).toString(8)).toBe('700');
  });

  test('keeps unrelated unstaged work out of the snapshot', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.hyperclay, 'README.md'), 'sentinel local edit\n');
    fs.appendFileSync(path.join(fixture.website, 'vault/DOCS/07 Platform.md'), 'sentinel local edit\n');

    const { prepared } = invoke(fixture, NEW);

    const hyperclaySnapshot = fs.readFileSync(path.join(fixture.runDir, 'hyperclay', 'source', 'README.md'), 'utf8');
    const websiteSnapshot = fs.readFileSync(
      path.join(fixture.runDir, 'hyperclay-website', 'source', 'vault/DOCS/07 Platform.md'),
      'utf8'
    );
    expect(hyperclaySnapshot).toBe('hyperclay readme\n');
    expect(websiteSnapshot).toBe(PLATFORM_VAULT);
    expect(hyperclaySnapshot).not.toMatch(/sentinel/);
    expect(websiteSnapshot).not.toMatch(/sentinel/);
    expect(fs.readFileSync(path.join(fixture.hyperclay, 'README.md'), 'utf8')).toMatch(/sentinel local edit/);
    expect(fs.readFileSync(path.join(fixture.website, 'vault/DOCS/07 Platform.md'), 'utf8')).toMatch(/sentinel local edit/);
    expect(prepared.targets[0].paths[0].changed).toBe(true);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe(' M README.md\0');
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe(' M vault/DOCS/07 Platform.md\0');
  });

  test('refuses a staged unrelated file', () => {
    const fixture = makeFixture();
    write(fixture.hyperclay, 'notes.md', 'staged scratch\n');
    git(fixture.hyperclay, ['add', 'notes.md']);

    const { error } = expectRefusal(fixture, NEW, {}, /staged changes: notes\.md/);
    expect(error.message).toMatch(/hyperclay has staged changes/);
    expect(git(fixture.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
  });

  test('refuses a dirty intended file in the live repo', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.website, VAULT_PATH), 'local edit\n');

    expectRefusal(fixture, NEW, {}, /has pending changes/);
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toMatch(/local edit/);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
  });

  test('refuses when a required target is missing', () => {
    const fixture = makeFixture({ omitEdge: true });
    expectRefusal(fixture, NEW, {}, /hyperclay target is missing/);
  });

  test('refuses when the generated target is missing from the recorded head', () => {
    const fixture = makeFixture({ omitMdx: true });
    expectRefusal(fixture, NEW, {}, /generated doc target is missing/);
  });

  test('refuses a generator run that drops the generated target', () => {
    const fixture = makeFixture();
    let syncCalls = 0;
    expectRefusal(
      fixture,
      NEW,
      {
        onSyncDocs: (cwd) => {
          syncCalls += 1;
          if (syncCalls === 1) {
            canonicalSyncDocs(cwd);
            return;
          }
          fs.rmSync(path.join(cwd, MDX_PATH));
        }
      },
      /deleted content\/docs\/hyperclay-local-app\.mdx/
    );
    expect(syncCalls).toBe(2);
    expect(fs.existsSync(path.join(fixture.website, MDX_PATH))).toBe(true);
  });

  testPosix('refuses a mode change on a generated target during the second generator pass', () => {
    const fixture = makeFixture();
    const liveMdx = path.join(fixture.website, MDX_PATH);
    const liveMode = (fs.statSync(liveMdx).mode & 0o777).toString(8);
    const liveBytes = fs.readFileSync(liveMdx, 'utf8');
    let syncCalls = 0;

    const { run } = expectRefusal(
      fixture,
      NEW,
      {
        onSyncDocs: (cwd) => {
          syncCalls += 1;
          canonicalSyncDocs(cwd);
          if (syncCalls === 2) fs.chmodSync(path.join(cwd, MDX_PATH), 0o755);
        }
      },
      /mode content\/docs\/hyperclay-local-app\.mdx/
    );

    expect(syncCalls).toBe(2);
    expect(run.npmCalls).toHaveLength(5);
    expect((fs.statSync(liveMdx).mode & 0o777).toString(8)).toBe(liveMode);
    expect(fs.readFileSync(liveMdx, 'utf8')).toBe(liveBytes);
    expectLiveUntouched(fixture);
  });

  test('refuses ambiguous vault documents', () => {
    const fixture = makeFixture({ extraVaultDocs: { '20 Hyperclay Local Notes.md': 'HyperclayLocal-1.27.0 notes\n' } });
    expectRefusal(fixture, NEW, {}, /exactly one vault\/DOCS doc for Hyperclay Local/);
  });

  test('refuses mixed download versions in the source document', () => {
    const fixture = makeFixture({ vault: VAULT_HEAD.replace(`HyperclayLocal-${OLD}-arm64`, 'HyperclayLocal-1.27.0-arm64') });
    expectRefusal(fixture, NEW, {}, /mixed HyperclayLocal versions/);
  });

  test('refuses generator changes outside the release targets', () => {
    const fixture = makeFixture();
    expectRefusal(
      fixture,
      NEW,
      {
        onSyncDocs: (cwd) => {
          canonicalSyncDocs(cwd);
          fs.appendFileSync(path.join(cwd, 'content/docs/platform.mdx'), '\nRewritten title.\n');
          write(cwd, 'public/images/logo.png', 'stray image\n');
        }
      },
      /generator baseline mismatch in hyperclay-website/
    );
  });

  test('refuses an npm install that modifies a source file', () => {
    const fixture = makeFixture();
    expectRefusal(
      fixture,
      NEW,
      { onInstall: (cwd) => fs.appendFileSync(path.join(cwd, 'package.json'), '\n') },
      /npm ci modified the hyperclay-website snapshot: modified package\.json/
    );
  });

  test('refuses a live intended edit injected during generation and preserves it', () => {
    const fixture = makeFixture();
    const liveVault = path.join(fixture.website, VAULT_PATH);
    let injected = false;
    expectRefusal(
      fixture,
      NEW,
      {
        onSyncDocs: (cwd) => {
          canonicalSyncDocs(cwd);
          if (injected) return;
          injected = true;
          fs.appendFileSync(liveVault, 'user typed this during the generator run\n');
        }
      },
      /has pending changes/
    );
    expect(injected).toBe(true);
    expect(fs.readFileSync(liveVault, 'utf8')).toBe(`${VAULT_HEAD}user typed this during the generator run\n`);
    expect(fs.readFileSync(path.join(fixture.website, MDX_PATH), 'utf8')).toBe(canonicalMdx('Hyperclay Local App', VAULT_HEAD));
  });

  test('refuses when the live head moves during generation', () => {
    const fixture = makeFixture();
    const beforeHead = git(fixture.website, ['rev-parse', 'HEAD']).trim();
    expectRefusal(
      fixture,
      NEW,
      {
        onLlmsTxt: (cwd) => {
          canonicalLlmsTxt(cwd);
          git(fixture.website, ['commit', '-q', '--allow-empty', '-m', 'user commit']);
        }
      },
      /HEAD moved/
    );
    expect(git(fixture.website, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toBe(VAULT_HEAD);
  });

  test('refuses a live head that moves immediately after the archive is captured', () => {
    const fixture = makeFixture();
    const beforeHead = git(fixture.website, ['rev-parse', 'HEAD']).trim();
    let archiveCalls = 0;
    const run = wrapRun(makeRun({ liveWebsite: fixture.website }), (command, args, options) => {
      if (command !== 'git' || args[0] !== 'archive' || options.cwd !== fixture.website) return;
      archiveCalls += 1;
      git(fixture.website, ['commit', '-q', '--allow-empty', '-m', 'user commit']);
    });

    const { error } = expectRefusalWithRun(fixture, NEW, run, /HEAD moved/);

    expect(archiveCalls).toBe(1);
    expect(error.message).toMatch(/during snapshot capture/);
    expect(run.npmCalls).toEqual([]);
    expect(git(fixture.website, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toBe(VAULT_HEAD);
  });

  test('refuses a live index that changes immediately after the archive is captured', () => {
    const fixture = makeFixture();
    const readme = write(fixture.website, 'README.md', 'website readme\n');
    let archiveCalls = 0;
    const run = wrapRun(makeRun({ liveWebsite: fixture.website }), (command, args, options) => {
      if (command !== 'git' || args[0] !== 'archive' || options.cwd !== fixture.website) return;
      archiveCalls += 1;
      git(fixture.website, ['add', 'README.md']);
    });

    const { error } = expectRefusalWithRun(fixture, NEW, run, /index changed/);

    expect(archiveCalls).toBe(1);
    expect(error.message).toMatch(/during snapshot capture/);
    expect(run.npmCalls).toEqual([]);
    expect(git(fixture.website, ['diff', '--cached', '--name-only'])).toBe('README.md\n');
    expect(fs.readFileSync(readme, 'utf8')).toBe('website readme\n');
  });

  test('treats an equal version as an unchanged prepared no-op', () => {
    const fixture = makeFixture();
    const { run, prepared } = invoke(fixture, OLD);

    expect(prepared.schema).toBe(1);
    expect(prepared.targets.map((target) => target.state)).toEqual(['prepared', 'prepared']);
    const hyperclay = prepared.targets[0];
    const website = prepared.targets[1];
    expect(hyperclay.oldVersion).toBe(OLD);
    expect(website.oldVersion).toBe(OLD);
    for (const entry of hyperclay.paths.concat(website.paths)) {
      expect(entry.changed).toBe(false);
      expect(entry.afterSha256).toBe(entry.beforeSha256);
      expect(fs.readFileSync(entry.afterFile, 'utf8')).toBe(fs.readFileSync(entry.beforeFile, 'utf8'));
    }
    expect(run.npmCalls).toHaveLength(5);
    expect(fs.existsSync(path.join(fixture.runDir, 'prepared.json'))).toBe(true);
    expectLiveUntouched(fixture);
  });

  testPosix('rejects a symlink in the source snapshot before running npm', () => {
    const fixture = makeFixture();
    fs.symlinkSync('/etc/hosts', path.join(fixture.website, 'vault/DOCS/link.md'));
    git(fixture.website, ['add', '-A']);
    git(fixture.website, ['commit', '-q', '-m', 'symlink']);

    const { run } = expectRefusal(fixture, NEW, {}, /snapshot entry is a symlink: vault\/DOCS\/link\.md/);
    expect(run.npmCalls).toEqual([]);
    expect(fs.lstatSync(path.join(fixture.website, 'vault/DOCS/link.md')).isSymbolicLink()).toBe(true);
  });

  test('rejects a run dir inside the parent dir or a sibling repo', () => {
    const fixture = makeFixture();
    const run = makeRun({ liveWebsite: fixture.website });

    expect(() => prepareExternalDocs({ version: NEW, parentDir: fixture.parentDir, runDir: path.join(fixture.hyperclay, 'tmp-run') }, { run })).toThrow(
      /must live outside hyperclay repo/
    );
    expect(() => prepareExternalDocs({ version: NEW, parentDir: fixture.parentDir, runDir: path.join(fixture.parentDir, 'tmp-run') }, { run })).toThrow(
      /must live outside parentDir/
    );
    expect(fs.existsSync(path.join(fixture.hyperclay, 'tmp-run'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.parentDir, 'tmp-run'))).toBe(false);
    expectLiveUntouched(fixture);
  });

  test('independent targets hyperclay-only succeeds while the website sibling is absent', () => {
    const fixture = makeFixture();
    const hidden = path.join(fixture.parentDir, 'website-moved-away');
    fs.renameSync(fixture.website, hidden);

    const { run, prepared } = invokeTargets(fixture, NEW, ['hyperclay']);

    expect(run.npmCalls).toEqual([]);
    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(NEW);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay']);
    expect(JSON.parse(fs.readFileSync(path.join(fixture.runDir, 'prepared.json'), 'utf8'))).toEqual(prepared);
    expect(fs.existsSync(path.join(fixture.runDir, 'hyperclay-website'))).toBe(false);

    const hyperclay = prepared.targets[0];
    expect(hyperclay.state).toBe('prepared');
    expect(hyperclay.sourcePath).toBe(EDGE_PATH);
    expect(hyperclay.oldVersion).toBe(OLD);
    expect(hyperclay.paths.map((entry) => entry.path)).toEqual([EDGE_PATH]);
    expect(hyperclay.paths[0].changed).toBe(true);
    expect(fs.readFileSync(hyperclay.paths[0].afterFile, 'utf8')).toBe(EDGE_HEAD.split(OLD).join(NEW));

    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
    expect(fs.existsSync(fixture.website)).toBe(false);
    expect(fs.existsSync(hidden)).toBe(true);
    expect(fs.readFileSync(path.join(hidden, VAULT_PATH), 'utf8')).toBe(VAULT_HEAD);
  });

  test('independent targets website-only succeeds while the hyperclay sibling is absent', () => {
    const fixture = makeFixture();
    const hidden = path.join(fixture.parentDir, 'hyperclay-moved-away');
    fs.renameSync(fixture.hyperclay, hidden);

    const { run, prepared } = invokeTargets(fixture, NEW, ['hyperclay-website']);

    const websiteSnapshot = path.join(fixture.runDir, 'hyperclay-website', 'source');
    expect(run.npmCalls.map((call) => call.argv)).toEqual([
      NPM_INSTALL,
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt'],
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt']
    ]);
    expect(run.npmCalls.every((call) => call.cwd === websiteSnapshot)).toBe(true);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay-website']);
    expect(fs.existsSync(path.join(fixture.runDir, 'hyperclay'))).toBe(false);

    const website = prepared.targets[0];
    expect(website.state).toBe('prepared');
    expect(website.sourcePath).toBe(VAULT_PATH);
    expect(website.paths.map((entry) => entry.path)).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(website.paths.every((entry) => entry.changed)).toBe(true);
    const updatedVault = VAULT_HEAD.split(OLD).join(NEW);
    expect(fs.readFileSync(website.paths[0].beforeFile, 'utf8')).toBe(VAULT_HEAD);
    expect(fs.readFileSync(website.paths[0].afterFile, 'utf8')).toBe(updatedVault);
    expect(fs.readFileSync(website.paths[1].afterFile, 'utf8')).toBe(canonicalMdx('Hyperclay Local App', updatedVault));

    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toBe(VAULT_HEAD);
    expect(fs.existsSync(fixture.hyperclay)).toBe(false);
    expect(fs.existsSync(hidden)).toBe(true);
    expect(fs.readFileSync(path.join(hidden, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
  });

  test('independent targets hyperclay-only ignores a dirty and staged website sibling', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.website, VAULT_PATH), 'sentinel local edit\n');
    write(fixture.website, 'notes.md', 'staged scratch\n');
    git(fixture.website, ['add', 'notes.md']);
    const beforeStatus = git(fixture.website, ['status', '--porcelain=v1', '-z']);
    const beforeVault = fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8');

    const { run, prepared } = invokeTargets(fixture, NEW, ['hyperclay']);

    expect(run.npmCalls).toEqual([]);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay']);
    expect(prepared.targets[0].paths[0].changed).toBe(true);
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe(beforeStatus);
    expect(git(fixture.website, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
    expect(fs.readFileSync(path.join(fixture.website, VAULT_PATH), 'utf8')).toBe(beforeVault);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  test('independent targets website-only ignores a dirty and staged hyperclay sibling', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'sentinel local edit\n');
    write(fixture.hyperclay, 'notes.md', 'staged scratch\n');
    git(fixture.hyperclay, ['add', 'notes.md']);
    const beforeStatus = git(fixture.hyperclay, ['status', '--porcelain=v1', '-z']);
    const beforeEdge = fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8');

    const { run, prepared } = invokeTargets(fixture, NEW, ['hyperclay-website']);

    expect(run.npmCalls).toHaveLength(5);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay-website']);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe(beforeStatus);
    expect(git(fixture.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(beforeEdge);
    expect(git(fixture.website, ['status', '--porcelain=v1', '-z'])).toBe('');
  });

  test('independent targets still refuses a missing dirty or staged selected target', () => {
    const missing = makeFixture({ omitEdge: true });
    const missingRefusal = expectTargetRefusal(missing, NEW, ['hyperclay'], {}, /hyperclay target is missing/);
    expect(missingRefusal.run.npmCalls).toEqual([]);
    expect(fs.readFileSync(path.join(missing.hyperclay, 'README.md'), 'utf8')).toBe('hyperclay readme\n');

    const dirty = makeFixture();
    fs.appendFileSync(path.join(dirty.hyperclay, EDGE_PATH), 'local edit\n');
    const dirtyRefusal = expectTargetRefusal(dirty, NEW, ['hyperclay'], {}, /has pending changes/);
    expect(dirtyRefusal.run.npmCalls).toEqual([]);
    expect(fs.readFileSync(path.join(dirty.hyperclay, EDGE_PATH), 'utf8')).toBe(`${EDGE_HEAD}local edit\n`);

    const staged = makeFixture();
    write(staged.hyperclay, 'notes.md', 'staged scratch\n');
    git(staged.hyperclay, ['add', 'notes.md']);
    const stagedRefusal = expectTargetRefusal(staged, NEW, ['hyperclay'], {}, /staged changes: notes\.md/);
    expect(stagedRefusal.error.message).toMatch(/hyperclay has staged changes/);
    expect(stagedRefusal.run.npmCalls).toEqual([]);
    expect(git(staged.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');

    const websiteDirty = makeFixture();
    fs.appendFileSync(path.join(websiteDirty.website, VAULT_PATH), 'local edit\n');
    const websiteRefusal = expectTargetRefusal(websiteDirty, NEW, ['hyperclay-website'], {}, /has pending changes/);
    expect(websiteRefusal.run.npmCalls).toEqual([]);
    expect(fs.readFileSync(path.join(websiteDirty.website, VAULT_PATH), 'utf8')).toBe(`${VAULT_HEAD}local edit\n`);
    expect(fs.readFileSync(path.join(websiteDirty.website, MDX_PATH), 'utf8')).toBe(canonicalMdx('Hyperclay Local App', VAULT_HEAD));
    expect(fs.readFileSync(path.join(websiteDirty.website, LLMS_PATH), 'utf8')).toMatch(/1\.28\.0/);

    const websiteStaged = makeFixture();
    write(websiteStaged.website, 'notes.md', 'staged scratch\n');
    git(websiteStaged.website, ['add', 'notes.md']);
    expectTargetRefusal(websiteStaged, NEW, ['hyperclay-website'], {}, /staged changes: notes\.md/);
    expect(git(websiteStaged.website, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
  });

  test('independent targets rejects an invalid selection before creating the run dir', () => {
    const fixture = makeFixture();
    const run = makeRun({ liveWebsite: fixture.website });

    for (const targets of [[], ['hyperclay', 'hyperclay'], ['hyperclay', 'nope'], 'hyperclay', {}, null]) {
      expect(() =>
        prepareExternalDocs({ version: NEW, parentDir: fixture.parentDir, runDir: fixture.runDir, targets }, { run })
      ).toThrow(/targets must be a nonempty unique subset of hyperclay and hyperclay-website/);
      expect(fs.existsSync(fixture.runDir)).toBe(false);
    }

    expect(run.npmCalls).toEqual([]);
    expectLiveUntouched(fixture);
  });

  test('independent targets canonicalizes a reversed both-target selection', () => {
    const fixture = makeFixture();

    const { run, prepared } = invokeTargets(fixture, NEW, ['hyperclay-website', 'hyperclay']);

    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay', 'hyperclay-website']);
    const hyperclay = prepared.targets[0];
    const website = prepared.targets[1];
    expect(hyperclay.state).toBe('prepared');
    expect(website.state).toBe('prepared');
    expect(hyperclay.paths.map((entry) => entry.path)).toEqual([EDGE_PATH]);
    expect(website.paths.map((entry) => entry.path)).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(hyperclay.paths.concat(website.paths)).toHaveLength(4);
    expect(hyperclay.paths.concat(website.paths).every((entry) => entry.changed)).toBe(true);

    const updatedEdge = EDGE_HEAD.split(OLD).join(NEW);
    const updatedVault = VAULT_HEAD.split(OLD).join(NEW);
    expect(fs.readFileSync(hyperclay.paths[0].afterFile, 'utf8')).toBe(updatedEdge);
    expect(fs.readFileSync(website.paths[0].afterFile, 'utf8')).toBe(updatedVault);
    expect(fs.readFileSync(website.paths[1].afterFile, 'utf8')).toBe(canonicalMdx('Hyperclay Local App', updatedVault));

    const expectedNext = fs.mkdtempSync(path.join(OWNER, 'expected-next-'));
    write(expectedNext, MDX_PATH, canonicalMdx('Hyperclay Local App', updatedVault));
    write(expectedNext, 'content/docs/platform.mdx', canonicalMdx('Platform', PLATFORM_VAULT));
    canonicalLlmsTxt(expectedNext);
    expect(fs.readFileSync(website.paths[2].afterFile, 'utf8')).toBe(
      fs.readFileSync(path.join(expectedNext, LLMS_PATH), 'utf8')
    );

    expect(run.npmCalls).toHaveLength(5);
    expectLiveUntouched(fixture);
  });

  testPosix('prepares with the default run path while a PATH fake npm streams both tails', async () => {
    const setup = defaultRunFixture();
    const { result, out, err } = await superviseDefaultRun(setup, 'default-run-success');

    expect(result.code).toBe(0);
    expect(result.complete).toBe(true);

    const calls = readFakeNpmCalls(setup.callsFile);
    expect(calls.length).toBe(5);
    expect(calls.every((call) => call.exe === setup.npmFile)).toBe(true);
    expect(calls.map((call) => call.argv)).toEqual([
      NPM_INSTALL,
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt'],
      ['run', 'sync-docs'],
      ['run', 'build:llms-txt']
    ]);
    const websiteSnapshot = path.join(setup.fixture.runDir, 'hyperclay-website', 'source');
    expect(calls.every((call) => call.cwd === websiteSnapshot)).toBe(true);

    expect(JSON.parse(fs.readFileSync(setup.resultFile, 'utf8'))).toEqual({
      ok: true,
      targets: ['prepared', 'prepared']
    });

    const prepared = JSON.parse(fs.readFileSync(path.join(setup.fixture.runDir, 'prepared.json'), 'utf8'));
    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(NEW);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay', 'hyperclay-website']);
    expect(prepared.targets.map((target) => target.state)).toEqual(['prepared', 'prepared']);

    const hyperclay = prepared.targets[0];
    const website = prepared.targets[1];
    const updatedEdge = EDGE_HEAD.split(OLD).join(NEW);
    const updatedVault = VAULT_HEAD.split(OLD).join(NEW);
    expect(website.paths.map((entry) => entry.path)).toEqual([VAULT_PATH, MDX_PATH, LLMS_PATH]);
    expect(hyperclay.paths.concat(website.paths).every((entry) => entry.changed)).toBe(true);
    expect(fs.readFileSync(hyperclay.paths[0].afterFile, 'utf8')).toBe(updatedEdge);
    expect(fs.readFileSync(website.paths[0].afterFile, 'utf8')).toBe(updatedVault);
    expect(fs.readFileSync(website.paths[1].afterFile, 'utf8')).toBe(canonicalMdx('Hyperclay Local App', updatedVault));
    expectLiveUntouched(setup.fixture);

    expectStreamTails(result, out, err, calls.length);
  });

  testPosix('keeps both stream tails and publishes no descriptor when the fake npm fails', async () => {
    const setup = defaultRunFixture({ failAt: 3 });
    const { result, out, err } = await superviseDefaultRun(setup, 'default-run-failure');

    expect(result.code).toBe(3);
    expect(result.complete).toBe(true);

    const calls = readFakeNpmCalls(setup.callsFile);
    expect(calls.length).toBe(3);
    expect(calls.every((call) => call.exe === setup.npmFile)).toBe(true);
    expect(fs.existsSync(path.join(setup.fixture.runDir, 'prepared.json'))).toBe(false);

    const record = JSON.parse(fs.readFileSync(setup.resultFile, 'utf8'));
    expect(record.ok).toBe(false);
    expect(record.message).toContain('Command failed: npm');
    expect(record.message).toContain('Exit 3');
    expectLiveUntouched(setup.fixture);

    expectStreamTails(result, out, err, calls.length);
  });

  test('requiring the updater performs no main work', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const exec = jest.spyOn(childProcess, 'execSync').mockImplementation(() => {
      throw new Error('execSync must not run while importing the updater');
    });
    try {
      let updater = null;
      jest.isolateModules(() => {
        updater = require('../../scripts/update-external-docs');
      });
      expect(typeof updater.detectOldVersion).toBe('function');
      expect(typeof updater.updateVersionInContent).toBe('function');
      expect(updater.detectOldVersion('x HyperclayLocal-1.2.3.dmg')).toBe('1.2.3');
      expect(log).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      exec.mockRestore();
    }
  });
});
