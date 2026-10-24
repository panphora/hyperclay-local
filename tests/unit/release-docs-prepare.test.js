// The external docs update is prepared inside git-archive snapshots, so the
// sibling checkout is never touched and a later step can apply a verified
// result. Every fixture repo here is local scratch under one owned temp root.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareExternalDocs, prepareVersion } = require('../../scripts/release-docs-prepare');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const OLD = '1.28.0';
const NEW = '1.29.0';

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

function makeFixture({ omitEdge = false } = {}) {
  const parentDir = fs.mkdtempSync(path.join(OWNER, `parent-${++fixtureSeq}-`));
  const hyperclay = path.join(parentDir, 'hyperclay');

  fs.mkdirSync(hyperclay, { recursive: true });
  git(hyperclay, ['init', '-q', '-b', 'main']);
  write(hyperclay, 'README.md', 'hyperclay readme\n');
  write(hyperclay, 'src/app.js', 'module.exports = {};\n');
  if (!omitEdge) write(hyperclay, EDGE_PATH, EDGE_HEAD);
  git(hyperclay, ['add', '-A']);
  git(hyperclay, ['commit', '-q', '-m', 'fixture']);

  return { parentDir, hyperclay, runDir: path.join(RUNS, `run-${++runSeq}`) };
}

function makeRun() {
  return (command, args, options = {}) => {
    if (command === 'npm') throw new Error('docs preparation must not run npm');
    return childProcess.execFileSync(command, args, { encoding: 'utf8', env: GIT_ENV, ...options });
  };
}

function invoke(fixture, version, targets) {
  const run = makeRun();
  const input = { version, parentDir: fixture.parentDir, runDir: fixture.runDir };
  if (targets !== undefined) input.targets = targets;
  const prepared = prepareExternalDocs(input, { run });
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

function expectRefusal(fixture, version, pattern) {
  return expectRefusalWithRun(fixture, version, makeRun(), pattern);
}

function expectTargetRefusal(fixture, version, targets, pattern) {
  const run = makeRun();
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
  return (command, args, options = {}) => {
    const output = run(command, args, options);
    after(command, args, options);
    return output;
  };
}

function expectLiveUntouched(fixture) {
  expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe('');
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
    const result = prepareVersion(EDGE_HEAD, OLD);
    expect(result.oldVersion).toBe(OLD);
    expect(result.updated).toBe(EDGE_HEAD);
    expect(result.proseChanges).toEqual([]);
  });

  test('refuses mixed download versions instead of fixing the first match', () => {
    const content = `HyperclayLocal-${OLD}.dmg HyperclayLocal-1.27.0.dmg\n`;
    expect(() => prepareVersion(content, NEW)).toThrow(/mixed HyperclayLocal versions/);
  });

  test('refuses a missing download version and a malformed target version', () => {
    expect(() => prepareVersion('no downloads here\n', NEW)).toThrow(/no HyperclayLocal download version/);
    expect(() => prepareVersion(EDGE_HEAD, '1.29')).toThrow(/must look like 1\.2\.3/);
  });
});

describe('prepareExternalDocs', () => {
  test('prepares the hyperclay target file with exact bytes', () => {
    const fixture = makeFixture();
    const { prepared } = invoke(fixture, NEW);

    expect(prepared.schema).toBe(1);
    expect(prepared.version).toBe(NEW);
    expect(prepared.runDir).toBe(fixture.runDir);
    expect(prepared.runDir.startsWith(fixture.parentDir)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(fixture.runDir, 'prepared.json'), 'utf8'))).toEqual(prepared);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay']);

    const hyperclay = prepared.targets[0];
    expect(hyperclay.state).toBe('prepared');
    expect(hyperclay.repoRoot).toBe(fs.realpathSync(fixture.hyperclay));
    expect(hyperclay.beforeHead).toBe(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim());
    expect(hyperclay.indexFingerprint).toBe(sha256(git(fixture.hyperclay, ['ls-files', '--stage', '-z'])));
    expect(hyperclay.sourcePath).toBe(EDGE_PATH);
    expect(hyperclay.oldVersion).toBe(OLD);

    expect(hyperclay.paths.map((entry) => entry.path)).toEqual([EDGE_PATH]);
    expect(hyperclay.paths[0].changed).toBe(true);

    const updatedEdge = EDGE_HEAD.split(OLD).join(NEW);
    expect(fs.readFileSync(hyperclay.paths[0].beforeFile, 'utf8')).toBe(EDGE_HEAD);
    expect(hyperclay.paths[0].beforeSha256).toBe(sha256(EDGE_HEAD));
    expect(fs.readFileSync(hyperclay.paths[0].afterFile, 'utf8')).toBe(updatedEdge);
    expect(hyperclay.paths[0].afterSha256).toBe(sha256(updatedEdge));

    expect(fs.existsSync(path.join(fixture.runDir, 'hyperclay', 'source', '.git'))).toBe(false);
    expectLiveUntouched(fixture);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
  });

  testPosix('the prepared run directory is private', () => {
    const fixture = makeFixture();
    const { prepared } = invoke(fixture, NEW);

    expect((fs.statSync(prepared.runDir).mode & 0o777).toString(8)).toBe('700');
  });

  test('keeps unrelated unstaged work out of the snapshot', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.hyperclay, 'README.md'), 'sentinel local edit\n');

    const { prepared } = invoke(fixture, NEW);

    const snapshot = fs.readFileSync(path.join(fixture.runDir, 'hyperclay', 'source', 'README.md'), 'utf8');
    expect(snapshot).toBe('hyperclay readme\n');
    expect(snapshot).not.toMatch(/sentinel/);
    expect(fs.readFileSync(path.join(fixture.hyperclay, 'README.md'), 'utf8')).toMatch(/sentinel local edit/);
    expect(prepared.targets[0].paths[0].changed).toBe(true);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
    expect(git(fixture.hyperclay, ['status', '--porcelain=v1', '-z'])).toBe(' M README.md\0');
  });

  test('refuses a staged unrelated file', () => {
    const fixture = makeFixture();
    write(fixture.hyperclay, 'notes.md', 'staged scratch\n');
    git(fixture.hyperclay, ['add', 'notes.md']);

    const { error } = expectRefusal(fixture, NEW, /staged changes: notes\.md/);
    expect(error.message).toMatch(/hyperclay has staged changes/);
    expect(git(fixture.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
  });

  test('refuses a dirty intended file in the live repo', () => {
    const fixture = makeFixture();
    fs.appendFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'local edit\n');

    expectRefusal(fixture, NEW, /has pending changes/);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(`${EDGE_HEAD}local edit\n`);
  });

  test('refuses when a required target is missing', () => {
    const fixture = makeFixture({ omitEdge: true });
    expectRefusal(fixture, NEW, /hyperclay target is missing/);
  });

  test('refuses a live head that moves immediately after the archive is captured', () => {
    const fixture = makeFixture();
    const beforeHead = git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim();
    let archiveCalls = 0;
    const run = wrapRun(makeRun(), (command, args, options) => {
      if (command !== 'git' || args[0] !== 'archive' || options.cwd !== fixture.hyperclay) return;
      archiveCalls += 1;
      git(fixture.hyperclay, ['commit', '-q', '--allow-empty', '-m', 'user commit']);
    });

    const { error } = expectRefusalWithRun(fixture, NEW, run, /HEAD moved/);

    expect(archiveCalls).toBe(1);
    expect(error.message).toMatch(/during snapshot capture/);
    expect(git(fixture.hyperclay, ['rev-parse', 'HEAD']).trim()).not.toBe(beforeHead);
    expect(fs.readFileSync(path.join(fixture.hyperclay, EDGE_PATH), 'utf8')).toBe(EDGE_HEAD);
  });

  test('refuses a live index that changes immediately after the archive is captured', () => {
    const fixture = makeFixture();
    const readme = write(fixture.hyperclay, 'README.md', 'hyperclay readme\nlater\n');
    let archiveCalls = 0;
    const run = wrapRun(makeRun(), (command, args, options) => {
      if (command !== 'git' || args[0] !== 'archive' || options.cwd !== fixture.hyperclay) return;
      archiveCalls += 1;
      git(fixture.hyperclay, ['add', 'README.md']);
    });

    const { error } = expectRefusalWithRun(fixture, NEW, run, /index changed/);

    expect(archiveCalls).toBe(1);
    expect(error.message).toMatch(/during snapshot capture/);
    expect(git(fixture.hyperclay, ['diff', '--cached', '--name-only'])).toBe('README.md\n');
    expect(fs.readFileSync(readme, 'utf8')).toBe('hyperclay readme\nlater\n');
  });

  test('treats an equal version as an unchanged prepared no-op', () => {
    const fixture = makeFixture();
    const { prepared } = invoke(fixture, OLD);

    expect(prepared.schema).toBe(1);
    expect(prepared.targets.map((target) => target.state)).toEqual(['prepared']);
    const hyperclay = prepared.targets[0];
    expect(hyperclay.oldVersion).toBe(OLD);
    for (const entry of hyperclay.paths) {
      expect(entry.changed).toBe(false);
      expect(entry.afterSha256).toBe(entry.beforeSha256);
      expect(fs.readFileSync(entry.afterFile, 'utf8')).toBe(fs.readFileSync(entry.beforeFile, 'utf8'));
    }
    expect(fs.existsSync(path.join(fixture.runDir, 'prepared.json'))).toBe(true);
    expectLiveUntouched(fixture);
  });

  testPosix('records a tracked hyperclay symlink without following it', () => {
    const fixture = makeFixture();
    fs.mkdirSync(path.join(fixture.hyperclay, 'public-assets/js/vendor'), { recursive: true });
    fs.symlinkSync('/etc', path.join(fixture.hyperclay, 'public-assets/js/vendor/outside'));
    git(fixture.hyperclay, ['add', '-A']);
    git(fixture.hyperclay, ['commit', '-q', '-m', 'tracked symlink']);

    const { prepared } = invoke(fixture, NEW);
    expect(prepared.targets.map((target) => target.repo)).toEqual(['hyperclay']);
    expect(prepared.targets.map((target) => target.state)).toEqual(['prepared']);
    expect(prepared.targets[0].paths.map((entry) => entry.path)).toEqual([EDGE_PATH]);
    expectLiveUntouched(fixture);
    expect(fs.lstatSync(path.join(fixture.hyperclay, 'public-assets/js/vendor/outside')).isSymbolicLink()).toBe(true);
  });

  test('rejects a run dir inside the parent dir or the sibling repo', () => {
    const fixture = makeFixture();
    const run = makeRun();

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

  test('rejects an invalid selection before creating the run dir', () => {
    const fixture = makeFixture();
    const run = makeRun();

    for (const targets of [[], ['hyperclay', 'hyperclay'], ['hyperclay', 'nope'], 'hyperclay', {}, null]) {
      expect(() =>
        prepareExternalDocs({ version: NEW, parentDir: fixture.parentDir, runDir: fixture.runDir, targets }, { run })
      ).toThrow(/targets must be a nonempty unique subset of hyperclay/);
      expect(fs.existsSync(fixture.runDir)).toBe(false);
    }

    expectLiveUntouched(fixture);
  });

  test('still refuses a missing dirty or staged selected target', () => {
    const missing = makeFixture({ omitEdge: true });
    expectTargetRefusal(missing, NEW, ['hyperclay'], /hyperclay target is missing/);
    expect(fs.readFileSync(path.join(missing.hyperclay, 'README.md'), 'utf8')).toBe('hyperclay readme\n');

    const dirty = makeFixture();
    fs.appendFileSync(path.join(dirty.hyperclay, EDGE_PATH), 'local edit\n');
    expectTargetRefusal(dirty, NEW, ['hyperclay'], /has pending changes/);
    expect(fs.readFileSync(path.join(dirty.hyperclay, EDGE_PATH), 'utf8')).toBe(`${EDGE_HEAD}local edit\n`);

    const staged = makeFixture();
    write(staged.hyperclay, 'notes.md', 'staged scratch\n');
    git(staged.hyperclay, ['add', 'notes.md']);
    const stagedRefusal = expectTargetRefusal(staged, NEW, ['hyperclay'], /staged changes: notes\.md/);
    expect(stagedRefusal.error.message).toMatch(/hyperclay has staged changes/);
    expect(git(staged.hyperclay, ['diff', '--cached', '--name-only'])).toBe('notes.md\n');
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
