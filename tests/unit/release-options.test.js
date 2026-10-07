// Pure flag and time-policy contracts for the durable desktop caller. The module
// under test is release-options.js: no filesystem, process or environment access at
// import, the last repeated selector category wins, and the Tue-Fri 09:00-18:00
// America/New_York mutation guard consults only the clock it is handed. The
// import-inertness proof copies the source into an isolated child that installs
// primitive fs/spawn/process traps after reading its own source bytes, so the
// compiled module never goes through the loader.
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseReleaseOptions, validateOptions, requireVersion, above, bumpVersion, assertPublishWindow
} = require('../../scripts/release-options');

const MODULE_PATH = path.join(__dirname, '..', '..', 'scripts', 'release-options.js');
const WINDOW_MESSAGE = 'Release mutations wait until after 18:00 America/New_York, or Sat through Mon';

const DEFAULT_OPTIONS = Object.freeze({
  version: null, bump: null, resume: false, dryRun: false, reconcileOnly: false,
  resumeSource: null, retrySite: false, ignoreWindow: false, skipUiPass: false, help: false
});

const SHA40 = 'a1b2c3d4e5f6'.repeat(3) + 'a1b2';
const SHA64 = 'a1b2c3d4e5f6'.repeat(5) + 'a1b2';

function options(argv) {
  return parseReleaseOptions(argv);
}

function invalidFrom(argv) {
  try {
    parseReleaseOptions(argv);
  } catch (error) {
    return error;
  }
  return null;
}

function expectInvalid(argv, message) {
  const error = invalidFrom(argv);
  expect(error).not.toBeNull();
  expect(error.code).toBe('RELEASE_OPTIONS_INVALID');
  expect(error.message).toMatch(message);
}

function windowRefusal(instant) {
  try {
    assertPublishWindow(instant);
  } catch (error) {
    return error;
  }
  return null;
}

function expectRefused(iso) {
  const error = windowRefusal(new Date(iso));
  expect(error).not.toBeNull();
  expect(error.code).toBe('RELEASE_WINDOW_CLOSED');
  expect(error.message).toBe(WINDOW_MESSAGE);
}

function expectAccepted(iso) {
  expect(windowRefusal(new Date(iso))).toBeNull();
}

const IMPORT_PROBE = [
  "'use strict';",
  '',
  "const childProcess = require('child_process');",
  "const fs = require('fs');",
  "const path = require('path');",
  "const vm = require('vm');",
  '',
  "const target = process.argv[2] || 'release-options.js';",
  'const modulePath = path.join(__dirname, target);',
  "const source = fs.readFileSync(modulePath, 'utf8');",
  '',
  'const fsHits = [];',
  'const spawnHits = [];',
  'const processHits = [];',
  'const envReads = [];',
  'const requireCalls = [];',
  '',
  'function trap(target, name, hits) {',
  "  if (typeof target[name] !== 'function') return;",
  '  const original = target[name];',
  '  target[name] = function (...args) {',
  '    hits.push(name);',
  '    return original.apply(this, args);',
  '  };',
  '}',
  '',
  "for (const name of ['readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'openSync',",
  "  'readdirSync', 'statSync', 'mkdirSync', 'unlinkSync', 'createReadStream', 'createWriteStream']) {",
  '  trap(fs, name, fsHits);',
  '}',
  "for (const name of ['spawn', 'spawnSync', 'exec', 'execFile', 'execFileSync', 'execSync', 'fork']) {",
  '  trap(childProcess, name, spawnHits);',
  '}',
  "process.exit = function () { processHits.push('process.exit'); throw new Error('process.exit called during import'); };",
  'const realEnv = process.env;',
  "Object.defineProperty(process, 'env', {",
  '  configurable: true,',
  "  get() { envReads.push('process.env'); return realEnv; }",
  '});',
  '',
  'function trappingRequire(id) {',
  '  requireCalls.push(String(id));',
  '  return require(id);',
  '}',
  '',
  'let exportedKeys = null;',
  'let importError = null;',
  'try {',
  '  const moduleObject = { exports: {} };',
  "  const wrapper = vm.compileFunction(source, ['module', 'exports', 'require', '__filename', '__dirname'],",
  '    { filename: modulePath });',
  '  wrapper(moduleObject, moduleObject.exports, trappingRequire, modulePath, __dirname);',
  '  exportedKeys = Object.keys(moduleObject.exports).sort();',
  '} catch (error) {',
  '  importError = String(error && error.message);',
  '}',
  "process.stdout.write(JSON.stringify({ exportedKeys, importError, fsHits, spawnHits, processHits, envReads, requireCalls }) + '\\n');",
  ''
].join('\n');

describe('release caller options', () => {
  test('parses the supported flags and the empty default', () => {
    expect(parseReleaseOptions([])).toEqual(DEFAULT_OPTIONS);
    expect(options(['--major'])).toEqual({ ...DEFAULT_OPTIONS, bump: 'major' });
    expect(options(['--minor'])).toEqual({ ...DEFAULT_OPTIONS, bump: 'minor' });
    expect(options(['--patch'])).toEqual({ ...DEFAULT_OPTIONS, bump: 'patch' });
    expect(options(['--version=1.24.0'])).toEqual({ ...DEFAULT_OPTIONS, version: '1.24.0' });
    expect(options(['--resume'])).toEqual({ ...DEFAULT_OPTIONS, resume: true });
    expect(options(['--dry-run'])).toEqual({ ...DEFAULT_OPTIONS, dryRun: true });
    expect(options(['--reconcile-only'])).toEqual({ ...DEFAULT_OPTIONS, reconcileOnly: true });
    expect(options(['--resume', '--retry-site'])).toEqual({ ...DEFAULT_OPTIONS, resume: true, retrySite: true });
    expect(options(['--resume', `--resume-source=${SHA40}`]))
      .toEqual({ ...DEFAULT_OPTIONS, resume: true, resumeSource: SHA40 });
    expect(options(['--ignore-window'])).toEqual({ ...DEFAULT_OPTIONS, ignoreWindow: true });
    expect(options(['--skip-ui-pass'])).toEqual({ ...DEFAULT_OPTIONS, skipUiPass: true });
    expect(options(['--version=0.0.0'])).toEqual({ ...DEFAULT_OPTIONS, version: '0.0.0' });
    expect(parseReleaseOptions([])).not.toBe(parseReleaseOptions([]));
  });

  test('keeps the last repeated version or bump selector', () => {
    expect(options(['--version=1.2.3', '--version=1.2.4']).version).toBe('1.2.4');
    expect(options(['--major', '--minor', '--patch']).bump).toBe('patch');
    expect(options(['--patch', '--major']).bump).toBe('major');
    expect(options(['--version=1.2.3', '--version=9.9.9']).version).toBe('9.9.9');
    expect(options(['--dry-run', '--ignore-window', '--dry-run']))
      .toEqual({ ...DEFAULT_OPTIONS, dryRun: true, ignoreWindow: true });
  });

  test('refuses conflicting selector categories', () => {
    expectInvalid(['--version=1.2.3', '--major'], /Choose an exact version or a bump, not both/);
    expectInvalid(['--patch', '--version=1.2.3'], /Choose an exact version or a bump, not both/);
    expectInvalid(['--resume', '--major'], /Version selectors cannot accompany resume, dry-run or reconcile-only/);
    expectInvalid(['--resume', '--version=1.2.3'], /Version selectors cannot accompany resume, dry-run or reconcile-only/);
    expectInvalid(['--dry-run', '--patch'], /Version selectors cannot accompany resume, dry-run or reconcile-only/);
    expectInvalid(['--dry-run', '--version=1.2.3'], /Version selectors cannot accompany resume, dry-run or reconcile-only/);
    expectInvalid(['--reconcile-only', '--minor'], /Version selectors cannot accompany resume, dry-run or reconcile-only/);
    expectInvalid(['--reconcile-only', '--dry-run'], /Incompatible reconcile-only flags/);
    expectInvalid(['--reconcile-only', '--retry-site'], /Incompatible reconcile-only flags/);
    expectInvalid(['--reconcile-only', `--resume-source=${SHA40}`], /Incompatible reconcile-only flags/);
  });

  test('requires resume for resume-source and retry-site', () => {
    expectInvalid([`--resume-source=${SHA40}`], /--resume-source requires --resume/);
    expectInvalid(['--retry-site'], /--retry-site requires --resume/);
    expectInvalid(['--resume', `--resume-source=${SHA40}`, '--dry-run'], /excludes dry-run\/retry-site/);
    expectInvalid(['--resume', `--resume-source=${SHA40}`, '--retry-site'], /excludes dry-run\/retry-site/);
    expectInvalid(['--resume', '--retry-site', '--dry-run'], /--retry-site requires --resume and excludes dry-run/);
    expectInvalid(['--resume', '--retry-site', `--resume-source=${SHA40}`], /--resume-source requires --resume and excludes dry-run\/retry-site/);
    expect(options(['--resume', `--resume-source=${SHA64}`]).resumeSource).toBe(SHA64);
  });

  test('accepts only full lowercase object ids for resume-source', () => {
    expect(options(['--resume', `--resume-source=${SHA40}`]).resumeSource).toBe(SHA40);
    expect(options(['--resume', `--resume-source=${SHA64}`]).resumeSource).toBe(SHA64);
    for (const bad of [
      SHA40.slice(0, 39), `${SHA40}a`, SHA64.slice(0, 63), `${SHA64}a`, SHA40.toUpperCase(),
      'g'.repeat(40), '', 'HEAD', SHA40.slice(0, 12)
    ]) {
      expectInvalid(['--resume', `--resume-source=${bad}`], /--resume-source requires a full lowercase object id/);
    }
    expectInvalid([`--resume-source=${SHA40}`], /--resume-source requires --resume/);
  });

  test('parses help without acting flags', () => {
    expect(options(['--help'])).toEqual({ ...DEFAULT_OPTIONS, help: true });
    expect(options(['-h'])).toEqual({ ...DEFAULT_OPTIONS, help: true });
    expect(options(['--help']).resume).toBe(false);
    expect(options(['--help']).dryRun).toBe(false);
  });

  test('refuses malformed arguments and explicit version overflow', () => {
    expectInvalid(null, /Arguments must be strings/);
    expectInvalid('--help', /Arguments must be strings/);
    expectInvalid(['--help', 7], /Arguments must be strings/);
    expectInvalid(['--version'], /Unknown or incomplete argument: --version/);
    expectInvalid(['--resume-source'], /Unknown or incomplete argument: --resume-source/);
    expectInvalid(['--dryrun'], /Unknown or incomplete argument: --dryrun/);
    expectInvalid([''], /Unknown or incomplete argument/);
    expectInvalid(['--version='], /Version must be X.Y.Z with plain numeric components from 0 through 65535/);
    expectInvalid(['--version=1.2'], /Version must be X.Y.Z/);
    expectInvalid(['--version=v1.2.3'], /Version must be X.Y.Z/);
    expectInvalid(['--version=01.2.3'], /Version must be X.Y.Z/);
    expectInvalid(['--version=1.2.3.4'], /Version must be X.Y.Z/);
    expectInvalid(['--version=65536.0.0'], /Version must be X.Y.Z/);
    expectInvalid(['--version=0.0.65536'], /Version must be X.Y.Z/);
    expect(options(['--version=65535.65535.65535']).version).toBe('65535.65535.65535');
    expectInvalid(['--reconcile-only', '--version=1.2'], /Version must be X.Y.Z/);
  });

  test('refuses computed version overflow past the uint16 component', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(() => bumpVersion('65535.65535.65535', 'patch')).toThrow(/Version must be X.Y.Z/);
    expect(() => bumpVersion('65535.0.0', 'major')).toThrow(/Version must be X.Y.Z/);
    expect(() => bumpVersion('1.65535.0', 'minor')).toThrow(/Version must be X.Y.Z/);
    expect(() => bumpVersion('1.2.3', 'nonsense')).toThrow(/Version must be X.Y.Z/);
    expect(requireVersion('65535.65535.65535')).toBe('65535.65535.65535');
    expect(() => requireVersion('65536.0.0')).toThrow(/Version must be X.Y.Z/);
    expect(above('1.2.4', '1.2.3')).toBe(true);
    expect(above('1.2.3', '1.2.3')).toBe(false);
    expect(above('1.2.3', '1.2.4')).toBe(false);
    expect(above('2.0.0', '1.99.99')).toBe(true);
    expect(above('0.9.9', '1.0.0')).toBe(false);
    expect(() => above('1.2', '1.2.3')).toThrow(/Version must be X.Y.Z/);
  });

  test('does not turn dry-run into an implicit resume', () => {
    expect(options(['--dry-run']).resume).toBe(false);
    expect(options(['--dry-run', '--ignore-window']).resume).toBe(false);
    expect(options(['--dry-run', '--skip-ui-pass']).resume).toBe(false);
    expect(options(['--resume']).dryRun).toBe(false);
  });

  test('validates complete flag objects only', () => {
    const error = (value) => {
      try {
        validateOptions(value);
      } catch (thrown) {
        return thrown;
      }
      return null;
    };
    expect(error(null).code).toBe('RELEASE_OPTIONS_INVALID');
    expect(error({}).message).toBe('Invalid release flags');
    expect(error([]).message).toBe('Invalid release flags');
    expect(error({ ...DEFAULT_OPTIONS, extra: true }).message).toBe('Invalid release flags');
    expect(error({ ...DEFAULT_OPTIONS, resume: 'yes' }).message).toBe('Invalid resume flag');
    expect(error({ ...DEFAULT_OPTIONS, help: 1 }).message).toBe('Invalid help flag');
    expect(error({ ...DEFAULT_OPTIONS, version: '1.2' }).message).toMatch(/Version must be X.Y.Z/);
    expect(error({ ...DEFAULT_OPTIONS, bump: 'huge' }).message).toBe('Invalid bump');
    const copied = validateOptions({ ...DEFAULT_OPTIONS });
    expect(copied).toEqual(DEFAULT_OPTIONS);
    expect(copied).not.toBe(DEFAULT_OPTIONS);
  });

  test('loads in an isolated child with no filesystem, process or environment access', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-options-import-'));
    const runProbe = (target) => JSON.parse(childProcess.execFileSync(
      process.execPath, [path.join(dir, 'import-probe.js'), target], { cwd: dir, env: {}, encoding: 'utf8' }
    ));
    try {
      fs.copyFileSync(MODULE_PATH, path.join(dir, 'release-options.js'));
      fs.writeFileSync(path.join(dir, 'import-probe.js'), IMPORT_PROBE);
      const result = runProbe('release-options.js');
      expect(result.importError).toBeNull();
      expect(result.exportedKeys).toEqual(
        ['above', 'assertPublishWindow', 'bumpVersion', 'parseReleaseOptions', 'requireVersion', 'validateOptions']
      );
      expect(result.fsHits).toEqual([]);
      expect(result.spawnHits).toEqual([]);
      expect(result.processHits).toEqual([]);
      expect(result.envReads).toEqual([]);
      expect(result.requireCalls).toEqual([]);
      fs.writeFileSync(path.join(dir, 'violating.js'),
        "require('fs').readFileSync(__filename, 'utf8');\nprocess.env.HOME;\nmodule.exports = {};\n");
      const control = runProbe('violating.js');
      expect(control.fsHits).toEqual(['readFileSync']);
      expect(control.envReads).toEqual(['process.env']);
      expect(control.requireCalls).toEqual(['fs']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release caller window', () => {
  test('refuses Tuesday 09:00 and 17:59 in winter and summer', () => {
    expectRefused('2026-01-06T14:00:00Z');
    expectRefused('2026-01-06T22:59:00Z');
    expectRefused('2026-07-07T13:00:00Z');
    expectRefused('2026-07-07T21:59:00Z');
  });

  test('accepts Tuesday 18:00 and the hour before 09:00 in winter and summer', () => {
    expectAccepted('2026-01-06T23:00:00Z');
    expectAccepted('2026-07-07T22:00:00Z');
    expectAccepted('2026-01-06T13:59:00Z');
    expectAccepted('2026-07-07T12:59:00Z');
  });

  test('accepts Friday 18:00 and Saturday and Monday', () => {
    expectAccepted('2026-07-10T22:00:00Z');
    expectAccepted('2026-01-09T23:00:00Z');
    expectAccepted('2026-07-11T15:00:00Z');
    expectAccepted('2026-01-10T15:00:00Z');
    expectAccepted('2026-07-13T15:00:00Z');
    expectAccepted('2026-01-12T15:00:00Z');
    expectRefused('2026-07-10T21:59:00Z');
  });

  test('follows Eastern daylight offsets across winter and summer UTC stamps', () => {
    expectAccepted('2026-01-06T13:00:00Z');
    expectRefused('2026-07-07T13:00:00Z');
    expectRefused('2026-01-06T22:00:00Z');
    expectAccepted('2026-07-07T22:00:00Z');
    expectRefused('2026-01-06T14:00:00Z');
    expectAccepted('2026-01-06T23:00:00Z');
  });

  test('is not bypassed by dry-run or ignore-window flags', () => {
    const dryRun = options(['--dry-run']);
    const ignoreWindow = options(['--ignore-window']);
    expect(dryRun.dryRun).toBe(true);
    expect(ignoreWindow.ignoreWindow).toBe(true);
    expect(assertPublishWindow.length).toBe(0);
    expectRefused('2026-07-07T13:00:00Z');
    expectRefused('2026-01-06T22:00:00Z');
    expectRefused('2026-07-07T21:59:00Z');
    expectAccepted('2026-07-07T22:00:00Z');
  });
});
