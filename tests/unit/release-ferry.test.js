// Ferry coordination: the future exact docs apply/ref update nests inside Ferry's
// installed per-repository lock so Ferry's autosave cannot race it. Discovery walks PATH
// directories with X_OK, resolves the selected executable's symlink, requires the
// bin/ferry.js layout with all three core modules, loads the real API by dynamic import,
// and derives the lock key exactly as Ferry's save.js does (path.relative(root(), repo)).
// Anything missing or out of protocol is reported as FERRY_COORDINATION_UNAVAILABLE, a
// missing Ferry binary is an approved logged fallback, a busy lock and every callback
// value -- including null, undefined, false, 0 and '' -- pass through unchanged, and no
// FERRY_HOLD file is ever created, written or removed. Every fixture is its own
// temporary root and no real Ferry configuration or ~/.ferry lock is touched.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { withFerryRepoLock } = require('../../scripts/release-ferry');
const { testPosix } = require('../helpers/platform');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'release-ferry.js');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'release-ferry');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-ferry-coordination-')));
const UNAVAILABLE = 'FERRY_COORDINATION_UNAVAILABLE';
const INVALID = 'FERRY_COORDINATION_INVALID';
const LOCK_COMMAND = 'desktop-release-docs';
const UNAVAILABLE_MESSAGE = 'Ferry is unavailable; continuing with the updater lock and Git checks.';

const FIXTURE_CANCELLED = 'FIXTURE_CANCELLED';

let fixtureSeq = 0;
const activeScopes = new Set();

function stopActiveScopes() {
  return Promise.all([...activeScopes].map((scope) => scope.stop()));
}

afterEach(async () => {
  await stopActiveScopes();
});

afterAll(async () => {
  await stopActiveScopes();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function fixtureDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(TMP, `fixture-${++fixtureSeq}-`)));
}

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode === undefined ? {} : { mode });
}

function writeExecutable(file, content) {
  writeFile(file, content, 0o755);
  fs.chmodSync(file, 0o755);
}

function makeFerryPackage(parent, { name = 'ferry-package', modules = ['config.js', 'paths.js', 'lock.js'] } = {}) {
  const packageRoot = path.join(parent, name);
  writeExecutable(path.join(packageRoot, 'bin', 'ferry.js'), '#!/usr/bin/env node\n');
  for (const moduleName of modules) {
    writeFile(path.join(packageRoot, 'src', 'core', moduleName), 'export {};\n');
  }
  return packageRoot;
}

function makePathDir(parent, name, target) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  if (target !== undefined) fs.symlinkSync(target, path.join(dir, 'ferry'));
  return dir;
}

function makeRoots(parent) {
  const ferryRoot = path.join(parent, 'ferry-root');
  const repoRoot = path.join(ferryRoot, 'repo-alpha');
  fs.mkdirSync(repoRoot, { recursive: true });
  return { ferryRoot, repoRoot };
}

function recordingSeam(ferryRoot, overrides = {}) {
  const calls = { packageRoots: [], loadConfigs: 0, locks: [] };
  const base = {
    loadConfig: () => ({}),
    root: () => ferryRoot,
    withRepoLock: async (relative, command, callback) => callback(),
    ...overrides
  };
  const modules = {
    ...base,
    loadConfig: () => {
      calls.loadConfigs += 1;
      return base.loadConfig();
    },
    withRepoLock: (relative, command, callback) => {
      calls.locks.push({ relative, command, callback });
      return base.withRepoLock(relative, command, callback);
    }
  };
  return {
    calls,
    loadModules: async (packageRoot) => {
      calls.packageRoots.push(packageRoot);
      return modules;
    }
  };
}

function quietLog() {
  return () => {};
}

async function outcomeOf(promise) {
  return promise.then(() => null, (error) => error);
}

function listing(dir) {
  const entries = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.lstatSync(full).isDirectory()) walk(full);
      else entries.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return entries.sort();
}

function executablePathDir(dir) {
  const packageRoot = makeFerryPackage(dir);
  return { packageRoot, binDir: makePathDir(dir, 'path-bin', path.join(packageRoot, 'bin', 'ferry.js')) };
}

testPosix('an executable symlink resolves to the package root and the exact key and label are used', async () => {
  const dir = fixtureDir();
  const { packageRoot, binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  const callback = async () => 'applied';
  const result = await withFerryRepoLock(repoRoot, callback, { pathEnv: binDir, log: quietLog(), loadModules });
  expect(result).toBe('applied');
  expect(calls.packageRoots).toEqual([packageRoot]);
  expect(calls.loadConfigs).toBe(1);
  expect(calls.locks).toHaveLength(1);
  expect(calls.locks[0].relative).toBe('repo-alpha');
  expect(calls.locks[0].command).toBe(LOCK_COMMAND);
  expect(calls.locks[0].callback).toBe(callback);
});

testPosix('paths with spaces survive discovery and lock key derivation', async () => {
  const dir = fixtureDir();
  const packageRoot = makeFerryPackage(dir, { name: 'ferry package' });
  const binDir = makePathDir(dir, 'bin path', path.join(packageRoot, 'bin', 'ferry.js'));
  const ferryRoot = path.join(dir, 'ferry root');
  const repoRoot = path.join(ferryRoot, 'repo alpha');
  fs.mkdirSync(repoRoot, { recursive: true });
  const { calls, loadModules } = recordingSeam(ferryRoot);
  const result = await withFerryRepoLock(repoRoot, async () => 'applied', { pathEnv: binDir, log: quietLog(), loadModules });
  expect(result).toBe('applied');
  expect(calls.packageRoots).toEqual([packageRoot]);
  expect(calls.locks).toHaveLength(1);
  expect(calls.locks[0].relative).toBe('repo alpha');
  expect(calls.locks[0].command).toBe(LOCK_COMMAND);
});

testPosix('a nested repository is locked under its relative key', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const ferryRoot = path.join(dir, 'root');
  const repoRoot = path.join(ferryRoot, 'nested', 'repo-one');
  fs.mkdirSync(repoRoot, { recursive: true });
  const { calls, loadModules } = recordingSeam(ferryRoot);
  await withFerryRepoLock(repoRoot, async () => 'applied', { pathEnv: binDir, log: quietLog(), loadModules });
  expect(calls.locks[0].relative).toBe(path.join('nested', 'repo-one'));
});

testPosix('a repository outside the effective root runs the callback without a Ferry lock', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const ferryRoot = path.join(dir, 'root');
  fs.mkdirSync(path.join(ferryRoot, 'inner'), { recursive: true });
  const sibling = path.join(dir, 'root-other');
  fs.mkdirSync(sibling, { recursive: true });
  const { calls, loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const result = await withFerryRepoLock(sibling, async () => {
    runs += 1;
    return 'without-ferry';
  }, { pathEnv: binDir, log: quietLog(), loadModules });
  expect(result).toBe('without-ferry');
  expect(runs).toBe(1);
  expect(calls.locks).toEqual([]);
});

testPosix('the effective root itself is refused rather than locked under an empty key', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(ferryRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(runs).toBe(0);
  expect(calls.locks).toEqual([]);
});

test('a missing ferry executable logs the approved message and runs the callback once', async () => {
  const dir = fixtureDir();
  const emptyBin = path.join(dir, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const { repoRoot } = makeRoots(dir);
  const messages = [];
  let runs = 0;
  const loadModules = async () => {
    throw new Error('modules must not be loaded without an executable');
  };
  const pathEnv = [path.join(dir, 'absent-bin'), '', emptyBin].join(path.delimiter);
  const result = await withFerryRepoLock(repoRoot, async () => {
    runs += 1;
    return 'fallback';
  }, { pathEnv, log: (message) => messages.push(message), loadModules });
  expect(result).toBe('fallback');
  expect(runs).toBe(1);
  expect(messages).toEqual([UNAVAILABLE_MESSAGE]);
});

testPosix('a non-executable ferry candidate is skipped in favor of a later executable', async () => {
  const dir = fixtureDir();
  const notExecutable = path.join(dir, 'first-bin');
  writeFile(path.join(notExecutable, 'ferry'), '#!/bin/sh\n', 0o644);
  const { packageRoot, binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  const pathEnv = [notExecutable, binDir].join(path.delimiter);
  const result = await withFerryRepoLock(repoRoot, async () => 'applied', { pathEnv, log: quietLog(), loadModules });
  expect(result).toBe('applied');
  expect(calls.packageRoots).toEqual([packageRoot]);
});

testPosix('a PATH with no executable candidate falls back rather than failing', async () => {
  const dir = fixtureDir();
  const notExecutable = path.join(dir, 'first-bin');
  writeFile(path.join(notExecutable, 'ferry'), '#!/bin/sh\n', 0o644);
  const { repoRoot } = makeRoots(dir);
  const messages = [];
  const loadModules = async () => {
    throw new Error('modules must not be loaded without an executable');
  };
  const result = await withFerryRepoLock(repoRoot, async () => 'fallback', {
    pathEnv: notExecutable,
    log: (message) => messages.push(message),
    loadModules
  });
  expect(result).toBe('fallback');
  expect(messages).toEqual([UNAVAILABLE_MESSAGE]);
});

testPosix('a present executable with an unsupported layout fails instead of falling through', async () => {
  const dir = fixtureDir();
  const badPackage = path.join(dir, 'bad-package');
  writeExecutable(path.join(badPackage, 'bin', 'ferry'), '#!/bin/sh\n');
  const badBin = makePathDir(dir, 'bad-bin', path.join(badPackage, 'bin', 'ferry'));
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const pathEnv = [badBin, binDir].join(path.delimiter);
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(runs).toBe(0);
  expect(calls.packageRoots).toEqual([]);
});

testPosix('a core module missing from the package root puts the installation out of protocol', async () => {
  const dir = fixtureDir();
  const shortPackage = makeFerryPackage(dir, { name: 'short-package', modules: ['config.js', 'paths.js'] });
  const shortBin = makePathDir(dir, 'short-bin', path.join(shortPackage, 'bin', 'ferry.js'));
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: shortBin, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(error.message).toContain('src/core/lock.js');
  expect(runs).toBe(0);
  expect(calls.packageRoots).toEqual([]);
});

testPosix('a non-file core module path puts the installation out of protocol', async () => {
  const dir = fixtureDir();
  const packageRoot = makeFerryPackage(dir, { name: 'directory-module-package', modules: ['config.js', 'paths.js'] });
  fs.mkdirSync(path.join(packageRoot, 'src', 'core', 'lock.js'), { recursive: true });
  const binDir = makePathDir(dir, 'directory-module-bin', path.join(packageRoot, 'bin', 'ferry.js'));
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(error.message).toContain('non-file src/core/lock.js');
  expect(runs).toBe(0);
});

testPosix.each([
  ['a module object that is null', () => null],
  ['an api missing withRepoLock', () => ({ loadConfig: () => ({}), root: () => '/tmp' })],
  ['a non-callable API member', () => ({ loadConfig: () => ({}), root: () => '/tmp', withRepoLock: 'nope' })]
])('malformed Ferry exports are refused for %s', async (_name, makeModules) => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { repoRoot } = makeRoots(dir);
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules: async () => makeModules() }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(runs).toBe(0);
});

testPosix('a Ferry configuration failure keeps its cause and never reaches the callback', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const boom = new Error('config.json holds "private-provider-token"');
  const { calls, loadModules } = recordingSeam(ferryRoot, {
    loadConfig: () => {
      throw boom;
    }
  });
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(error.cause).toBe(boom);
  expect(error.message).not.toContain('private-provider-token');
  expect(runs).toBe(0);
  expect(calls.locks).toEqual([]);
});

testPosix('a failing Ferry module import is reported without reaching the callback', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { repoRoot } = makeRoots(dir);
  const boom = new Error('cannot import');
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules: async () => { throw boom; } }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(error.cause).toBe(boom);
  expect(runs).toBe(0);
});

testPosix('an unusable effective Ferry root is refused and never reaches the callback', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const repoRoot = path.join(dir, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const notADirectory = path.join(dir, 'root-file');
  fs.writeFileSync(notADirectory, 'not a directory\n');
  const unusable = ['', 'relative/root', notADirectory, path.join(dir, 'absent-root')];
  for (const ferryRoot of unusable) {
    const { calls, loadModules } = recordingSeam(ferryRoot);
    let runs = 0;
    const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
      runs += 1;
    }, { pathEnv: binDir, log: quietLog(), loadModules }));
    expect(error.code).toBe(UNAVAILABLE);
    expect(runs).toBe(0);
    expect(calls.locks).toEqual([]);
  }
});

testPosix('a Ferry root read failure is refused and never reaches the callback', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const boom = new Error('root unavailable');
  const { loadModules } = recordingSeam(ferryRoot, {
    root: () => {
      throw boom;
    }
  });
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules }));
  expect(error.code).toBe(UNAVAILABLE);
  expect(error.cause).toBe(boom);
  expect(runs).toBe(0);
});

testPosix('a busy Ferry lock propagates unchanged and the callback never runs', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const busy = Object.assign(new Error('locked by pid 4242 on host (ferry save)'), { code: 'LOCK_BUSY' });
  const { calls, loadModules } = recordingSeam(ferryRoot, {
    withRepoLock: async () => {
      throw busy;
    }
  });
  let runs = 0;
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => {
    runs += 1;
  }, { pathEnv: binDir, log: quietLog(), loadModules }));
  expect(error).toBe(busy);
  expect(error.code).toBe('LOCK_BUSY');
  expect(runs).toBe(0);
  expect(calls.locks).toHaveLength(1);
});

testPosix('a Ferry lock release failure is not reported as discovery failure', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const releaseBoom = new Error('lock file could not be removed');
  const { loadModules } = recordingSeam(ferryRoot, {
    withRepoLock: async (relative, command, callback) => {
      await callback();
      throw releaseBoom;
    }
  });
  const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => 'applied', {
    pathEnv: binDir,
    log: quietLog(),
    loadModules
  }));
  expect(error).toBe(releaseBoom);
});

test('the callback is not invoked when the repository root argument is unusable', async () => {
  const dir = fixtureDir();
  const { ferryRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  const file = path.join(dir, 'repo-file');
  fs.writeFileSync(file, 'x\n');
  const cases = [['a relative root', path.relative(process.cwd(), ferryRoot)], ['a file', file], ['a missing directory', path.join(dir, 'absent')]];
  for (const [name, repoRoot] of cases) {
    const error = await outcomeOf(withFerryRepoLock(repoRoot, async () => 'applied', {
      pathEnv: '',
      log: quietLog(),
      loadModules
    }));
    expect([name, error.code]).toEqual([name, INVALID]);
  }
  const error = await outcomeOf(withFerryRepoLock(ferryRoot, 'not-a-function', {
    pathEnv: '',
    log: quietLog(),
    loadModules
  }));
  expect(error.code).toBe(INVALID);
  expect(calls.packageRoots).toEqual([]);
});

test('invalid coordination options are refused before the callback', async () => {
  const dir = fixtureDir();
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const { calls, loadModules } = recordingSeam(ferryRoot);
  let runs = 0;
  const callback = async () => {
    runs += 1;
    return 'applied';
  };
  const optionSets = [null, [], { log: null, pathEnv: '' }, { loadModules: 'nope', pathEnv: '' }, { pathEnv: 7 }];
  for (const options of optionSets) {
    const error = await outcomeOf(withFerryRepoLock(repoRoot, callback, options));
    expect(error.code).toBe(INVALID);
  }
  expect(runs).toBe(0);
  expect(calls.packageRoots).toEqual([]);
});

describe('callback results', () => {
  testPosix.each([
    ['applied'],
    [''],
    [0],
    [false],
    [null],
    [undefined],
    [{ schema: 1 }],
    [['a', 'b']]
  ])('returns %p unchanged under the Ferry lock', async (value) => {
    const dir = fixtureDir();
    const { binDir } = executablePathDir(dir);
    const { ferryRoot, repoRoot } = makeRoots(dir);
    const { calls, loadModules } = recordingSeam(ferryRoot);
    let runs = 0;
    const result = await withFerryRepoLock(repoRoot, async () => {
      runs += 1;
      return value;
    }, { pathEnv: binDir, log: quietLog(), loadModules });
    expect(result).toBe(value);
    expect(runs).toBe(1);
    expect(calls.locks).toHaveLength(1);
  });

  test.each([
    ['applied'],
    [0]
  ])('returns %p unchanged when Ferry is unavailable', async (value) => {
    const dir = fixtureDir();
    const emptyBin = path.join(dir, 'empty-bin');
    fs.mkdirSync(emptyBin, { recursive: true });
    const { repoRoot } = makeRoots(dir);
    let runs = 0;
    const result = await withFerryRepoLock(repoRoot, async () => {
      runs += 1;
      return value;
    }, { pathEnv: emptyBin, log: quietLog() });
    expect(result).toBe(value);
    expect(runs).toBe(1);
  });
});

describe('callback rejection values', () => {
  testPosix.each([null, undefined, false, 0, ''])('preserves a %p rejection under the Ferry lock', async (value) => {
    const dir = fixtureDir();
    const { binDir } = executablePathDir(dir);
    const { ferryRoot, repoRoot } = makeRoots(dir);
    const { calls, loadModules } = recordingSeam(ferryRoot);
    let runs = 0;
    const outcome = await withFerryRepoLock(repoRoot, async () => {
      runs += 1;
      throw value;
    }, { pathEnv: binDir, log: quietLog(), loadModules }).then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toBe(value);
    expect(runs).toBe(1);
    expect(calls.locks).toHaveLength(1);
  });

  test.each([null, undefined, false, 0, ''])('preserves a %p rejection when Ferry is unavailable', async (value) => {
    const dir = fixtureDir();
    const emptyBin = path.join(dir, 'empty-bin');
    fs.mkdirSync(emptyBin, { recursive: true });
    const { repoRoot } = makeRoots(dir);
    const outcome = await withFerryRepoLock(repoRoot, async () => {
      throw value;
    }, { pathEnv: emptyBin, log: quietLog() }).then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toBe(value);
  });

  testPosix('preserves an Error rejection identity under the Ferry lock', async () => {
    const dir = fixtureDir();
    const { binDir } = executablePathDir(dir);
    const { ferryRoot, repoRoot } = makeRoots(dir);
    const { loadModules } = recordingSeam(ferryRoot);
    const boom = new Error('docs apply failed');
    const outcome = await withFerryRepoLock(repoRoot, async () => {
      throw boom;
    }, { pathEnv: binDir, log: quietLog(), loadModules }).then(
      () => ({ rejected: false }),
      (error) => ({ rejected: true, error })
    );
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toBe(boom);
  });
});

testPosix('no FERRY_HOLD file and no unrelated environment variable is touched', async () => {
  const dir = fixtureDir();
  const { binDir } = executablePathDir(dir);
  const { ferryRoot, repoRoot } = makeRoots(dir);
  const holdFile = path.join(repoRoot, 'FERRY_HOLD');
  fs.writeFileSync(holdFile, 'held by the operator\n');
  const before = listing(repoRoot);
  const envBefore = { ...process.env };
  const { calls, loadModules } = recordingSeam(ferryRoot);
  await withFerryRepoLock(repoRoot, async () => 'applied', { pathEnv: binDir, log: quietLog(), loadModules });
  await withFerryRepoLock(repoRoot, async () => 'applied', { pathEnv: binDir, log: quietLog(), loadModules });
  expect(fs.readFileSync(holdFile, 'utf8')).toBe('held by the operator\n');
  expect(listing(repoRoot)).toEqual(before);
  const unlocked = path.join(ferryRoot, 'repo-beta');
  fs.mkdirSync(unlocked, { recursive: true });
  await withFerryRepoLock(unlocked, async () => 'applied', { pathEnv: binDir, log: quietLog(), loadModules });
  expect(fs.existsSync(path.join(unlocked, 'FERRY_HOLD'))).toBe(false);
  expect(listing(unlocked)).toEqual([]);
  expect({ ...process.env }).toEqual(envBefore);
  expect(calls.locks).toHaveLength(3);
});

function makeFerryFixture() {
  const dir = fixtureDir();
  const packageRoot = path.join(dir, 'ferry package');
  writeExecutable(path.join(packageRoot, 'bin', 'ferry.js'), '#!/usr/bin/env node\n');
  writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({ name: 'ferry-fixture', type: 'module' }, null, 2)}\n`);
  const core = path.join(packageRoot, 'src', 'core');
  fs.mkdirSync(core, { recursive: true });
  for (const name of ['lock.js', 'paths.js']) {
    fs.copyFileSync(path.join(FIXTURE_ROOT, name), path.join(core, name));
  }
  writeFile(path.join(core, 'config.js'), [
    'export function loadConfig() {',
    '  return { root: process.env.FERRY_ROOT, dropboxDir: process.env.FERRY_DROPBOX_DIR };',
    '}',
    ''
  ].join('\n'));
  const binDir = path.join(dir, 'bin path');
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(path.join(packageRoot, 'bin', 'ferry.js'), path.join(binDir, 'ferry'));
  const ferryRoot = path.join(dir, 'ferry root');
  const repoRoot = path.join(ferryRoot, 'repo alpha');
  fs.mkdirSync(repoRoot, { recursive: true });
  const stateDir = path.join(dir, 'ferry state');
  fs.mkdirSync(stateDir, { recursive: true });
  const relative = 'repo alpha';
  const lockFile = path.join(stateDir, 'locks', `${crypto.createHash('sha1').update(relative).digest('hex').slice(0, 16)}.lock`);
  return { dir, packageRoot, binDir, ferryRoot, repoRoot, stateDir, relative, lockFile };
}

function fixtureEnv(fixture) {
  return {
    ...process.env,
    PATH: fixture.binDir,
    FERRY_ROOT: fixture.ferryRoot,
    FERRY_STATE_DIR: fixture.stateDir
  };
}

function fixtureCancelled() {
  return Object.assign(new Error('fixture cancelled: the owned child scope was stopped'), { code: FIXTURE_CANCELLED });
}

function createChildScope() {
  const scope = {
    cancelled: false,
    stopping: null,
    children: new Set(),
    assertActive() {
      if (scope.cancelled) throw fixtureCancelled();
    },
    spawn(command, args, options) {
      scope.assertActive();
      const child = spawn(command, args, options);
      const entry = { child, closed: null };
      let spawnError = null;
      entry.closed = new Promise((resolve) => {
        child.on('error', (error) => { spawnError = error; });
        child.on('close', (code, signal) => resolve({ code, signal, error: spawnError }));
      });
      scope.children.add(entry);
      child.on('close', () => { scope.children.delete(entry); });
      return entry;
    },
    stop() {
      scope.cancelled = true;
      if (scope.stopping === null) {
        scope.stopping = (async () => {
          const entries = [...scope.children];
          for (const { child } of entries) {
            if (child.stdin) child.stdin.destroy();
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          }
          await Promise.all(entries.map((entry) => entry.closed));
          activeScopes.delete(scope);
        })();
      }
      return scope.stopping;
    }
  };
  activeScopes.add(scope);
  return scope;
}

function waitForLine(child, expected) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes(expected)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`child exited early code=${code} signal=${signal} output=${buffer}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

const HOLDER_SCRIPT = `
const { withFerryRepoLock } = require(process.argv[2]);
const payload = JSON.parse(process.argv[1]);
withFerryRepoLock(payload.repoRoot, async () => {
  process.stdout.write('LOCKED\\n');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  if (payload.fail) {
    const error = new Error('docs apply failed');
    error.code = 'DOCS_APPLY_FAILED';
    throw error;
  }
  return 'applied';
}).then((value) => {
  process.stdout.write('DONE ' + value + '\\n');
  process.exit(0);
}, (error) => {
  process.stdout.write('FAILED ' + ((error && error.code) || 'NONE') + ' ' + ((error && error.message) || '') + '\\n');
  process.exit(1);
});
`;

const CONTENDER_SCRIPT = `
import(process.argv[1]).then(async (lock) => {
  const outcome = await lock.withRepoLock(process.argv[2], 'contender', async () => 'contender')
    .then(() => 'ACQUIRED', (error) => (error && error.code) || 'UNKNOWN');
  process.stdout.write('OUTCOME ' + outcome + ' IS_LOCKED ' + lock.isRepoLocked(process.argv[2]) + '\\n');
}).catch((error) => {
  process.stdout.write('IMPORT_FAILED ' + error.message + '\\n');
  process.exitCode = 1;
});
`;

const READY_SCRIPT = `
process.stdout.write('READY\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`;

async function runContender(scope, fixture) {
  scope.assertActive();
  const lockUrl = pathToFileURL(path.join(fixture.packageRoot, 'src', 'core', 'lock.js')).href;
  const { child, closed } = scope.spawn(process.execPath, ['-e', CONTENDER_SCRIPT, lockUrl, fixture.relative], {
    cwd: REPO_ROOT,
    env: fixtureEnv(fixture),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const { code, signal, error } = await closed;
  if (error) throw error;
  if (signal) throw new Error(`contender terminated by signal ${signal} output=${stdout}`);
  scope.assertActive();
  return { code, signal, stdout, stderr };
}

async function holdAndInspect(fixture, fail) {
  const scope = createChildScope();
  try {
    const { child, closed } = scope.spawn(process.execPath, ['-e', HOLDER_SCRIPT, JSON.stringify({ repoRoot: fixture.repoRoot, fail }), MODULE_PATH], {
      cwd: REPO_ROOT,
      env: fixtureEnv(fixture),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const observed = { stdout, stderr, lockedWhileRunning: false, contender: null };
    try {
      await waitForLine(child, 'LOCKED');
      scope.assertActive();
      observed.lockedWhileRunning = fs.existsSync(fixture.lockFile);
      observed.contender = await runContender(scope, fixture);
      scope.assertActive();
      child.stdin.write('continue\n');
      observed.exit = await closed;
      scope.assertActive();
    } finally {
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
    scope.assertActive();
    observed.stdout = stdout;
    observed.stderr = stderr;
    observed.code = child.exitCode;
    observed.released = !fs.existsSync(fixture.lockFile);
    observed.afterRelease = await runContender(scope, fixture);
    return observed;
  } finally {
    await scope.stop();
  }
}

testPosix('the copied Ferry lock is held for the callback, refuses a real contender, and is released', async () => {
  const fixture = makeFerryFixture();
  const observed = await holdAndInspect(fixture, false);
  expect(observed.lockedWhileRunning).toBe(true);
  expect(observed.contender.code).toBe(0);
  expect(observed.contender.stdout).toContain('OUTCOME LOCK_BUSY IS_LOCKED true');
  expect(observed.contender.stderr).toBe('');
  expect(observed.code).toBe(0);
  expect(observed.stdout).toContain('DONE applied');
  expect(observed.stderr).toBe('');
  expect(observed.released).toBe(true);
  expect(observed.afterRelease.stdout).toContain('OUTCOME ACQUIRED IS_LOCKED false');
  expect(fs.readdirSync(fixture.repoRoot)).toEqual([]);
  expect(fs.readdirSync(fixture.stateDir)).toEqual(['locks']);
}, 60000);

testPosix('the copied Ferry lock is released after a failing callback and the failure stays unwrapped', async () => {
  const fixture = makeFerryFixture();
  const observed = await holdAndInspect(fixture, true);
  expect(observed.lockedWhileRunning).toBe(true);
  expect(observed.contender.stdout).toContain('OUTCOME LOCK_BUSY IS_LOCKED true');
  expect(observed.code).toBe(1);
  expect(observed.stdout).toContain('FAILED DOCS_APPLY_FAILED docs apply failed');
  expect(observed.stderr).toBe('');
  expect(observed.released).toBe(true);
  expect(observed.afterRelease.stdout).toContain('OUTCOME ACQUIRED IS_LOCKED false');
  expect(fs.readdirSync(fixture.repoRoot)).toEqual([]);
}, 60000);

testPosix('owned fixture children close on cancellation and cannot respawn', async () => {
  const scope = createChildScope();
  try {
    const { child, closed } = scope.spawn(process.execPath, ['-e', READY_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    await waitForLine(child, 'READY');
    expect(scope.children.size).toBe(1);
    await scope.stop();
    const record = await closed;
    expect(record.error).toBeFalsy();
    expect(record.code === null && record.signal === null).toBe(false);
    expect(record.signal).toBe('SIGKILL');
    expect(stderr).toBe('');
    expect(scope.children.size).toBe(0);
    expect(activeScopes.has(scope)).toBe(false);
    expect(() => scope.spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })).toThrow(/cancelled/);
  } finally {
    await scope.stop();
  }
}, 60000);

test('the pinned Ferry fixture hashes match the real copied lock and paths modules', () => {
  const pinned = {
    'lock.js': 'f4fde4db5456553d88928ee209fd7fa3d55f78a16ffa4a9458f0065cbaa53ceb',
    'paths.js': '9caee85279d7f3eb787041ae230fc6bff18966d8d50c1b1a4c89b31307186a10'
  };
  const readme = fs.readFileSync(path.join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const [name, digest] of Object.entries(pinned)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(FIXTURE_ROOT, name))).digest('hex');
    expect(actual).toBe(digest);
    expect(readme).toContain(digest);
  }
});
