// Test-only observation guard for a copied desktop release CLI. It is loaded with
// `--require` ahead of the release entry point and never answers a status of its own:
// it watches which modules the CLI loads, which child processes it starts and which
// filesystem entry points it reaches, records every violation in memory, and forces a
// distinctive failing exit at process exit so a caught error cannot pass as purity.
//
// The allowed surface is exactly the read-only status path: the inert release-command
// module stays loadable, the strict local Git reader stays callable, and the only
// writes the CLI may make are stdout/stderr writes to file descriptors 1 and 2.
'use strict';

const Module = require('module');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const nativeLoad = Module._load;
const nativeSpawnSync = childProcess.spawnSync;
const nativeWriteSync = fs.writeSync;

const MODE_ENV = 'HYPERCLAY_STATUS_CLI_GUARD_MODE';
const FORBID_STATUS_ENV = 'HYPERCLAY_STATUS_CLI_GUARD_FORBID_STATUS';
const POSITIVE_READ = 'positive-read';
const FAILURE_EXIT_CODE = 97;
const FAILURE_LINE = 'release status cli guard violation\n';

const mode = process.env[MODE_ENV] === POSITIVE_READ ? POSITIVE_READ : 'no-work';
const forbidStatusModule = process.env[FORBID_STATUS_ENV] === '1';

const FORBIDDEN_MODULES = [
  'release-transcript',
  'release-docs-apply',
  'release-lock',
  'release-publication-write',
  'release-site'
];

const PERMITTED_GIT_VERBS = [
  'rev-parse', 'symbolic-ref', 'remote', 'rev-list', 'ls-tree', 'cat-file',
  'ls-files', 'merge-base', 'diff'
];
const GIT_GLOBAL_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];
const GIT_STDIO = ['ignore', 'pipe', 'pipe'];
const BASE_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'TMPDIR', 'TEMP', 'TMP', 'SystemRoot'
];
const FORCED_ENV = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null'
};
const MAX_CHILD_OUTPUT_BYTES = 16 * 1024 * 1024;

const FORBIDDEN_CHILD_CALLS = ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork'];
const FORBIDDEN_PROMISE_CALLS = ['exec', 'execFile', 'spawn', 'fork'];

const MUTATING_FS_CALLS = [
  'appendFile', 'appendFileSync', 'chmod', 'chmodSync', 'chown', 'chownSync',
  'copyFile', 'copyFileSync', 'cp', 'cpSync', 'createWriteStream',
  'fchmod', 'fchmodSync', 'fchown', 'fchownSync', 'fdatasyncSync', 'fsyncSync',
  'ftruncate', 'ftruncateSync', 'futimes', 'futimesSync', 'lchmod', 'lchmodSync',
  'lchown', 'lchownSync', 'link', 'linkSync', 'lutimes', 'lutimesSync',
  'mkdir', 'mkdirSync', 'mkdtemp', 'mkdtempSync', 'rename', 'renameSync',
  'rm', 'rmSync', 'rmdir', 'rmdirSync', 'symlink', 'symlinkSync',
  'truncate', 'truncateSync', 'unlink', 'unlinkSync', 'utimes', 'utimesSync',
  'write', 'writeFile', 'writeFileSync', 'writev', 'writevSync'
];

const WRITE_OPEN_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT
  | fs.constants.O_TRUNC | fs.constants.O_APPEND | fs.constants.O_EXCL;
const READ_ONLY_FLAGS = [fs.constants.O_RDONLY, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW];
const READ_ONLY_STRING_FLAGS = ['r', 'rs'];

const violations = [];
let gitReads = 0;

function record(detail) {
  violations.push(detail);
}

function refuse(detail) {
  record(detail);
  throw new Error('release status cli guard violation');
}

function isExactList(value, expected) {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (value[index] !== expected[index]) return false;
  }
  return true;
}

function resolvedModuleName(request, parent, isMain) {
  try {
    const resolved = Module._resolveFilename(request, parent, isMain);
    return path.basename(resolved, path.extname(resolved));
  } catch {
    return null;
  }
}

Module._load = function (request, parent, isMain) {
  if (request === 'dotenv' || request.startsWith('dotenv/')) refuse('imported dotenv');
  if (request === './release-status') {
    if (forbidStatusModule) refuse('imported release-status before the flags were rejected');
  } else if (request.startsWith('./') || request.startsWith('../')) {
    const name = resolvedModuleName(request, parent, isMain);
    if (name !== null && FORBIDDEN_MODULES.includes(name)) refuse(`imported ${name}`);
  }
  return nativeLoad.apply(this, arguments);
};

function gitArgvProblem(args) {
  if (!Array.isArray(args)) return 'git was called without an argument list';
  if (args.length <= GIT_GLOBAL_ARGS.length) return 'git was called without a read verb';
  for (let index = 0; index < GIT_GLOBAL_ARGS.length; index += 1) {
    if (args[index] !== GIT_GLOBAL_ARGS[index]) return 'git global arguments changed';
  }
  const argv = args.slice(GIT_GLOBAL_ARGS.length);
  const verb = argv[0];
  if (!PERMITTED_GIT_VERBS.includes(verb)) return `git verb ${String(verb)} is not a read`;
  if (verb === 'remote' && argv[1] !== 'get-url') return 'git remote may only read a url';
  if (verb === 'diff' && (!argv.includes('--no-ext-diff') || !argv.includes('--no-textconv'))) {
    return 'git diff must disable external helpers and textconv';
  }
  return null;
}

function gitOptionProblem(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return 'git was called without options';
  }
  if (options.shell !== false) return 'git was called through a shell';
  if (!isExactList(options.stdio, GIT_STDIO)) return 'git stdin was not ignored';
  if (options.input !== undefined && options.input !== null) return 'git was fed input';
  if (options.timeout !== 30000 || options.killSignal !== 'SIGKILL') {
    return 'git timeout or termination signal changed';
  }
  if (!Number.isSafeInteger(options.maxBuffer) || options.maxBuffer <= 0
      || options.maxBuffer > MAX_CHILD_OUTPUT_BYTES) {
    return 'git output bound is not bounded';
  }
  if (options.cwd !== undefined
      && (typeof options.cwd !== 'string' || !path.isAbsolute(options.cwd))) {
    return 'git cwd is not an absolute path';
  }
  const env = options.env;
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    return 'git ran with an inherited environment';
  }
  const allowed = BASE_ENV_KEYS.concat(Object.keys(FORCED_ENV), 'GIT_INDEX_FILE');
  for (const key of Object.keys(env)) {
    if (!allowed.includes(key)) return 'git ran with an unsanitized environment key';
  }
  for (const key of Object.keys(FORCED_ENV)) {
    if (env[key] !== FORCED_ENV[key]) return 'git ran with an unsanitized environment';
  }
  return null;
}

childProcess.spawnSync = function (command, args, options) {
  if (command !== 'git') refuse('a subprocess other than the read-only git adapter was attempted');
  const problem = gitArgvProblem(args) || gitOptionProblem(options);
  if (problem !== null) refuse(problem);
  gitReads += 1;
  return nativeSpawnSync.apply(this, arguments);
};

for (const name of FORBIDDEN_CHILD_CALLS) {
  childProcess[name] = function () {
    refuse(`called child_process.${name}`);
  };
}
for (const name of FORBIDDEN_PROMISE_CALLS) {
  if (childProcess.promises && typeof childProcess.promises[name] === 'function') {
    childProcess.promises[name] = function () {
      refuse(`called child_process.promises.${name}`);
    };
  }
}

function guardWriteSync(name) {
  fs[name] = function (fd) {
    if (fd !== 1 && fd !== 2) {
      refuse(`fs.${name} wrote to a descriptor other than stdout or stderr`);
    }
    return nativeWriteSync.apply(null, arguments);
  };
}

function guardOpen(io, name) {
  const nativeOpen = io[name];
  io[name] = function (target, flags) {
    if (typeof flags === 'number') {
      if ((flags & WRITE_OPEN_FLAGS) !== 0 || !READ_ONLY_FLAGS.includes(flags)) {
        refuse(`${name} opened a file for writing`);
      }
    } else if (!READ_ONLY_STRING_FLAGS.includes(flags)) {
      refuse(`${name} opened a file for writing`);
    }
    return nativeOpen.apply(io, arguments);
  };
}

for (const name of MUTATING_FS_CALLS) {
  if (typeof fs[name] === 'function') {
    fs[name] = function () {
      refuse(`called fs.${name}`);
    };
  }
  if (fs.promises && typeof fs.promises[name] === 'function') {
    fs.promises[name] = function () {
      refuse(`called fs.promises.${name}`);
    };
  }
}
guardWriteSync('writeSync');
guardOpen(fs, 'openSync');
if (typeof fs.open === 'function') guardOpen(fs, 'open');
if (typeof fs.promises.open === 'function') guardOpen(fs.promises, 'open');

process.on('exit', () => {
  if (mode === POSITIVE_READ && gitReads === 0) record('no native git read was issued');
  if (mode !== POSITIVE_READ && gitReads !== 0) record('native git reads were issued before any status work');
  if (violations.length === 0) return;
  let text = FAILURE_LINE;
  for (const detail of violations) text += `  ${detail}\n`;
  try {
    nativeWriteSync(2, text);
  } catch {
    // A failing guard still has to fail: the exit code carries the verdict.
  }
  process.exitCode = FAILURE_EXIT_CODE;
});
