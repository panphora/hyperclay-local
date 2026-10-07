// The actual copied desktop release CLI, watched by the observation guard while it
// reads one real retained-evidence bundle, plus the actual Hypersave Python consumer
// that parses those exact wire bytes. The CLI is never run from the real checkout:
// each fixture owns a copied scripts tree, a private HOME whose cache alias reaches
// the accepted producer's evidence root, and a copied observation guard. One
// beforeAll builds the bundle once and collects the complete, blocked and
// producer-error captures serially, restoring every changed byte in finally.
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  VERSION, RELEASE_ID, createBundle, completeBundle
} = require('../helpers/release-status-fixture');
const { isWindows, describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(900000);

const CHILD_TIMEOUT_MS = 180000;
const CHILD_MAX_BUFFER = 16 * 1024 * 1024;
const GUARD_EXIT_CODE = 97;
const GUARD_FAILURE_LINE = 'release status cli guard violation\n';
const FLAGS_MESSAGE = '--status-json must be used alone\n';
const STATUS_READ_FAILED = { code: 'STATUS_READ_FAILED', message: 'Desktop release status could not be read' };
const PACKAGE_INVALID = { code: 'STATUS_PACKAGE_INVALID', message: 'Desktop package.json has no usable release version' };
const STATUS_ARGV = ['node', 'scripts/release.js', '--status-json'];
const SOURCE_SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const SOURCE_GUARD = path.join(__dirname, '..', 'fixtures', 'release-status-cli-guard.js');
const PYTHON_ROOT = '/Users/davidmiranda/Documents/GitHub/bash_commands/hypersave-py';
const PYTHON_BIN = path.join(PYTHON_ROOT, '.venv', 'bin', 'python');
const PYTHON_REQUIRED = process.env.HYPERCLAY_REQUIRE_PYTHON_CONSUMER === '1';
const PYTHON_AVAILABLE = fs.existsSync(PYTHON_ROOT) && fs.existsSync(PYTHON_BIN);
const RUN_DIR = typeof process.env.FLASHIMP_RUN_DIR === 'string' && process.env.FLASHIMP_RUN_DIR !== ''
  ? process.env.FLASHIMP_RUN_DIR
  : null;

const PYTHON_PROGRAM = [
  'import json',
  'import sys',
  'from dataclasses import asdict',
  'from hypersave.ports import RunResult',
  'from hypersave.scan.desktop_status import parse_status',
  '',
  'items = json.load(sys.stdin)',
  'results = [asdict(parse_status(RunResult(',
  '    argv=tuple(item["argv"]),',
  '    returncode=item["returncode"],',
  '    stdout=item["stdout"],',
  '    stderr=item["stderr"],',
  '    timed_out=False,',
  '))) for item in items]',
  'print(json.dumps(results))',
  ''
].join('\n');

if (!PYTHON_AVAILABLE && !PYTHON_REQUIRED) {
  console.warn(`skipping the Hypersave Python consumer: ${PYTHON_BIN} is not available`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Path, content, mode and mtime of everything under one fixture root, symlinks
// included and never followed. atime is deliberately absent: a read updates it,
// and this snapshot exists to catch writes.
function snapshotTree(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full, { bigint: true });
      const mode = String(stat.mode);
      const mtime = String(stat.mtimeNs);
      if (stat.isSymbolicLink()) {
        entries.push([full, 'link', fs.readlinkSync(full), mode, mtime]);
      } else if (stat.isDirectory()) {
        entries.push([full, 'dir', '', mode, mtime]);
        walk(full);
      } else if (stat.isFile()) {
        entries.push([full, 'file', sha256(fs.readFileSync(full)), mode, mtime]);
      } else {
        entries.push([full, 'other', '', mode, mtime]);
      }
    }
  };
  walk(root);
  return entries;
}

// A child environment with no inherited NODE_OPTIONS, no release-worker bypass
// variables and no production cache override: the private HOME is the only alias
// that reaches the evidence root.
function cliEnv(home, options = {}) {
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    TMPDIR: process.env.TMPDIR || os.tmpdir()
  };
  if (typeof process.env.LANG === 'string') env.LANG = process.env.LANG;
  if (options.mode !== undefined) env.HYPERCLAY_STATUS_CLI_GUARD_MODE = options.mode;
  if (options.forbidStatus === true) env.HYPERCLAY_STATUS_CLI_GUARD_FORBID_STATUS = '1';
  return env;
}

function runCopiedCli({ releaseScript, cwd, env, guardPath = null, args = ['--status-json'] }) {
  const argv = guardPath === null
    ? [releaseScript, ...args]
    : ['--require', guardPath, releaseScript, ...args];
  const result = childProcess.spawnSync(process.execPath, argv, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: CHILD_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return {
    argv: [process.execPath, ...argv],
    cwd,
    returncode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function parseWire(stdout) {
  expect(stdout.endsWith('\n')).toBe(true);
  const body = stdout.slice(0, -1);
  expect(body.includes('\n')).toBe(false);
  const value = JSON.parse(body);
  expect(`${JSON.stringify(value)}\n`).toBe(stdout);
  return value;
}

describePosix('desktop status CLI', () => {
  let bundle = null;
  let completed = null;
  let cliHome = null;
  let guardPath = null;
  let scriptsDir = null;
  let releaseScript = null;
  let noState = null;
  let noStateGuard = null;
  let noStateHome = null;
  let noStateScriptsDir = null;
  let noStateReleaseScript = null;
  let captures = null;
  const runLog = [];

  function record(entry) {
    runLog.push(entry);
    if (RUN_DIR === null) return;
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RUN_DIR, 'release-status-cli-run.log'),
      `${runLog.map(item => JSON.stringify(item)).join('\n')}\n`
    );
  }

  function writeArtifact(name, value) {
    if (RUN_DIR === null) return;
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUN_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
  }

  function observedRun(name, root, run) {
    const before = snapshotTree(root);
    const result = run();
    record({
      case: name,
      argv: result.argv,
      cwd: result.cwd,
      returncode: result.returncode,
      stdout: result.stdout,
      stderr: result.stderr
    });
    const after = snapshotTree(root);
    expect(after).toEqual(before);
    return result;
  }

  beforeAll(async () => {
    bundle = createBundle();
    completed = await completeBundle(bundle);

    guardPath = path.join(bundle.owner, 'guard.js');
    fs.copyFileSync(SOURCE_GUARD, guardPath);
    scriptsDir = path.join(bundle.desktopRoot, 'scripts');
    fs.cpSync(SOURCE_SCRIPTS, scriptsDir, { recursive: true });
    releaseScript = path.join(scriptsDir, 'release.js');

    cliHome = path.join(bundle.owner, 'cli-home');
    fs.mkdirSync(path.join(cliHome, '.cache', 'hyperclay-local'), { recursive: true });
    fs.symlinkSync(bundle.cacheRoot, path.join(cliHome, '.cache', 'hyperclay-local', 'releases'));

    noState = createBundle();
    noStateGuard = path.join(noState.owner, 'guard.js');
    fs.copyFileSync(SOURCE_GUARD, noStateGuard);
    noStateScriptsDir = path.join(noState.desktopRoot, 'scripts');
    fs.cpSync(SOURCE_SCRIPTS, noStateScriptsDir, { recursive: true });
    noStateReleaseScript = path.join(noStateScriptsDir, 'release.js');
    noStateHome = path.join(noState.owner, 'cli-home');

    captures = {};

    captures.complete = observedRun('complete', bundle.owner, () => runCopiedCli({
      releaseScript, cwd: scriptsDir, env: cliEnv(cliHome, { mode: 'positive-read' }), guardPath
    }));

    const journalFile = completed.complete.docs.hyperclay.journalFile;
    const journalBytes = fs.readFileSync(journalFile);
    try {
      fs.writeFileSync(journalFile, '{invalid journal\n');
      captures.blocked = observedRun('blocked', bundle.owner, () => runCopiedCli({
        releaseScript, cwd: scriptsDir, env: cliEnv(cliHome, { mode: 'positive-read' }), guardPath
      }));
    } finally {
      fs.writeFileSync(journalFile, journalBytes);
    }

    const packageFile = path.join(bundle.desktopRoot, 'package.json');
    const packageBytes = fs.readFileSync(packageFile);
    try {
      fs.writeFileSync(packageFile, '{invalid-json');
      captures.producerError = observedRun('producer-error', bundle.owner, () => runCopiedCli({
        releaseScript, cwd: scriptsDir, env: cliEnv(cliHome, { mode: 'positive-read' }), guardPath
      }));
      captures.producerErrorControl = observedRun('producer-error-control', bundle.owner, () => runCopiedCli({
        releaseScript, cwd: bundle.desktopRoot, env: cliEnv(cliHome), guardPath: null
      }));
    } finally {
      fs.writeFileSync(packageFile, packageBytes);
    }

    writeArtifact('release-status-cli-complete.json', captures.complete);
    writeArtifact('release-status-cli-blocked.json', captures.blocked);
    writeArtifact('release-status-cli-producer-error.json', captures.producerError);
    writeArtifact('release-status-cli-producer-error-control.json', captures.producerErrorControl);
    writeArtifact('release-status-cli-captures.json', captures);
  }, 900000);

  afterAll(() => {
    if (bundle !== null) fs.rmSync(bundle.owner, { recursive: true, force: true });
    if (noState !== null) fs.rmSync(noState.owner, { recursive: true, force: true });
  });

  testPosix('answers a state-free checkout without creating cache or logs', () => {
    const before = snapshotTree(noState.owner);
    const result = runCopiedCli({
      releaseScript: noStateReleaseScript,
      cwd: noStateScriptsDir,
      env: cliEnv(noStateHome, { mode: 'positive-read' }),
      guardPath: noStateGuard
    });
    record({
      case: 'no-state',
      argv: result.argv,
      cwd: result.cwd,
      returncode: result.returncode,
      stdout: result.stdout,
      stderr: result.stderr
    });
    expect(snapshotTree(noState.owner)).toEqual(before);

    expect(result.returncode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseWire(result.stdout)).toEqual({
      schema: 1,
      repoKey: noState.identity.key,
      currentVersion: VERSION,
      publish: null,
      siteReceipt: null,
      dryRun: null,
      readError: null
    });
    expect(fs.existsSync(noStateHome)).toBe(false);
    expect(fs.existsSync(noState.cacheRoot)).toBe(false);
  });

  testPosix('rejects mixed status flags before any status work', () => {
    const cases = [
      ['--status-json', '--resume'],
      ['--resume', '--status-json'],
      ['--status-json', '--version=1.2.3'],
      ['--status-json', '--status-json']
    ];
    for (const args of cases) {
      const before = snapshotTree(noState.owner);
      const result = runCopiedCli({
        releaseScript: noStateReleaseScript,
        cwd: noStateScriptsDir,
        env: cliEnv(noStateHome, { mode: 'no-work', forbidStatus: true }),
        guardPath: noStateGuard,
        args
      });
      record({
        case: `flags:${args.join(' ')}`,
        argv: result.argv,
        cwd: result.cwd,
        returncode: result.returncode,
        stdout: result.stdout,
        stderr: result.stderr
      });
      expect(snapshotTree(noState.owner)).toEqual(before);

      expect(result.returncode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(FLAGS_MESSAGE);
    }
  });

  testPosix('reports the safe envelope when the status module cannot be imported', () => {
    const moduleFile = path.join(noStateScriptsDir, 'release-status.js');
    const movedFile = `${moduleFile}.disabled`;
    fs.renameSync(moduleFile, movedFile);
    try {
      const before = snapshotTree(noState.owner);
      const result = runCopiedCli({
        releaseScript: noStateReleaseScript,
        cwd: noStateScriptsDir,
        env: cliEnv(noStateHome, { mode: 'no-work' }),
        guardPath: noStateGuard
      });
      record({
        case: 'import-failure',
        argv: result.argv,
        cwd: result.cwd,
        returncode: result.returncode,
        stdout: result.stdout,
        stderr: result.stderr
      });
      expect(snapshotTree(noState.owner)).toEqual(before);

      expect(result.returncode).toBe(2);
      expect(result.stderr).toBe('');
      expect(parseWire(result.stdout)).toEqual({
        schema: 1,
        repoKey: null,
        currentVersion: null,
        publish: null,
        siteReceipt: null,
        dryRun: null,
        readError: STATUS_READ_FAILED
      });
    } finally {
      fs.renameSync(movedFile, moduleFile);
    }
  });

  testPosix('the observation guard fails a child that reads Git when it should not', () => {
    const before = snapshotTree(noState.owner);
    const result = runCopiedCli({
      releaseScript: noStateReleaseScript,
      cwd: noStateScriptsDir,
      env: cliEnv(noStateHome, { mode: 'no-work' }),
      guardPath: noStateGuard
    });
    record({
      case: 'guard-stickiness',
      argv: result.argv,
      cwd: result.cwd,
      returncode: result.returncode,
      stdout: result.stdout,
      stderr: result.stderr
    });
    expect(snapshotTree(noState.owner)).toEqual(before);

    expect(result.returncode).toBe(GUARD_EXIT_CODE);
    expect(result.stderr).toBe(`${GUARD_FAILURE_LINE}  native git reads were issued before any status work\n`);
  });

  testPosix('reads the complete retained bundle through the copied CLI', () => {
    const result = captures.complete;
    expect(result.returncode).toBe(0);
    expect(result.stderr).toBe('');
    const status = parseWire(result.stdout);

    expect(status.readError).toBeNull();
    expect(status.schema).toBe(1);
    expect(status.repoKey).toBe(bundle.identity.key);
    expect(status.currentVersion).toBe(VERSION);
    expect(status.dryRun).toBeNull();
    expect(status.siteReceipt).toEqual({ sha: completed.complete.sizes.commit, matchesHead: true });
    expect(status.publish).toMatchObject({
      releaseId: RELEASE_ID,
      version: VERSION,
      sourceSha: bundle.sourceSha,
      phase: 'complete',
      action: 'new-release-or-current',
      pending: false,
      needsSigning: false,
      pendingStages: [],
      remoteVerification: 'not-performed',
      reason: null
    });
    expect(typeof status.publish.lastVerifiedAt).toBe('string');
    expect(Number.isNaN(Date.parse(status.publish.lastVerifiedAt))).toBe(false);
  });

  testPosix('reports the blocked conflict when only the completed docs journal is invalid', () => {
    const result = captures.blocked;
    expect(result.returncode).toBe(0);
    expect(result.stderr).toBe('');
    const status = parseWire(result.stdout);

    expect(status.readError).toBeNull();
    expect(status.publish).toMatchObject({
      releaseId: RELEASE_ID,
      version: VERSION,
      sourceSha: bundle.sourceSha,
      phase: 'unknown',
      action: 'blocked-conflict',
      pending: true,
      needsSigning: null,
      pendingStages: ['docs.hyperclay']
    });
  });

  testPosix('reports STATUS_PACKAGE_INVALID for malformed live package JSON', () => {
    const result = captures.producerError;
    expect(result.returncode).toBe(2);
    expect(result.stderr).toBe('');
    expect(parseWire(result.stdout)).toEqual({
      schema: 1,
      repoKey: null,
      currentVersion: null,
      publish: null,
      siteReceipt: null,
      dryRun: null,
      readError: PACKAGE_INVALID
    });

    const control = captures.producerErrorControl;
    expect(control.returncode).toBe(result.returncode);
    expect(control.stdout).toBe(result.stdout);
    expect(control.stderr).toBe(result.stderr);
  });

  const pythonCase = !isWindows && !PYTHON_AVAILABLE && !PYTHON_REQUIRED ? test.skip : testPosix;

  pythonCase('is parsed by the actual Hypersave Python consumer', () => {
    if (!PYTHON_AVAILABLE) {
      throw new Error(`HYPERCLAY_REQUIRE_PYTHON_CONSUMER=1 but the Python checkout is missing: ${PYTHON_BIN}`);
    }
    const payload = [captures.complete, captures.blocked, captures.producerError].map(item => ({
      argv: STATUS_ARGV,
      returncode: item.returncode,
      stdout: item.stdout,
      stderr: item.stderr
    }));
    const result = childProcess.spawnSync(PYTHON_BIN, ['-B', '-c', PYTHON_PROGRAM], {
      cwd: PYTHON_ROOT,
      env: {
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        PYTHONDONTWRITEBYTECODE: '1'
      },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: CHILD_TIMEOUT_MS,
      maxBuffer: CHILD_MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const results = JSON.parse(result.stdout);
    expect(results).toHaveLength(3);

    const complete = results[0];
    expect(complete.read_error).toBeNull();
    expect(complete.repo_key).toBe(bundle.identity.key);
    expect(complete.current_version).toBe(VERSION);
    expect(complete.site_receipt_sha).toBe(completed.complete.sizes.commit);
    expect(complete.site_receipt_matches_head).toBe(true);
    expect(complete.publish).toEqual({
      release_id: RELEASE_ID,
      version: VERSION,
      source_sha: bundle.sourceSha,
      phase: 'complete',
      action: 'new-release-or-current',
      pending: false,
      needs_signing: false,
      pending_stages: []
    });

    const blocked = results[1];
    expect(blocked.read_error).toBeNull();
    expect(blocked.publish).toMatchObject({
      release_id: RELEASE_ID,
      version: VERSION,
      source_sha: bundle.sourceSha,
      phase: 'unknown',
      action: 'blocked-conflict',
      pending: true,
      needs_signing: null,
      pending_stages: ['docs.hyperclay']
    });

    const producerError = results[2];
    expect(producerError.read_error).toEqual(PACKAGE_INVALID);
    expect(producerError.repo_key).toBeNull();
    expect(producerError.current_version).toBeNull();
    expect(producerError.publish).toBeNull();
    expect(producerError.site_receipt_sha).toBeNull();
    expect(producerError.site_receipt_matches_head).toBeNull();

    record({
      case: 'python-consumer',
      command: `${PYTHON_BIN} -B -c <program>`,
      cwd: PYTHON_ROOT,
      returncode: result.status,
      stderr: result.stderr,
      count: results.length
    });
    writeArtifact('release-status-cli-python.json', {
      command: `${PYTHON_BIN} -B -c <program>`,
      cwd: PYTHON_ROOT,
      returncode: result.status,
      stderr: result.stderr,
      count: results.length,
      results
    });
  });
});
