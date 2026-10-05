'use strict';

// A silent, read-only local evidence adapter. Status and historical evidence
// readers share it so no read can inherit external Git configuration, start a
// lazy fetch, or echo a captured stream into the operator's terminal.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync: nodeSpawnSync } = require('child_process');

const FAILURE_CODE = 'LOCAL_EVIDENCE_READ_FAILED';
const FAILURE_MESSAGE = 'Local evidence read failed';

const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const READ_TIMEOUT_MS = 30000;
const KILL_SIGNAL = 'SIGKILL';
const READ_STDIO = ['ignore', 'pipe', 'pipe'];
const READ_CHUNK_BYTES = 64 * 1024;

const GIT_GLOBAL_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

const BASE_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot'
];

const FORCED_ENV = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_CONFIG_NOSYSTEM: '1'
};

const OPTION_KEYS = [
  'cwd', 'env', 'encoding', 'echoStdout', 'maxBuffer', 'shell', 'stdio', 'timeout', 'killSignal', 'input'
];

function localReadError(cause) {
  const error = new Error(FAILURE_MESSAGE);
  error.code = FAILURE_CODE;
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function isLocalReadError(error) {
  return Boolean(error) && typeof error === 'object' && error.code === FAILURE_CODE;
}

function isExact(values, expected) {
  if (!values || values.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (values[index] !== expected[index]) return false;
  }
  return true;
}

function isOid(value) {
  return typeof value === 'string' && OID_PATTERN.test(value);
}

function isPeeledOid(value, type) {
  const suffix = `^{${type}}`;
  return typeof value === 'string' && value.endsWith(suffix) && isOid(value.slice(0, -suffix.length));
}

function isSafeRelativePath(value, options) {
  const directory = Boolean(options && options.directory);
  if (typeof value !== 'string' || value === '' || CONTROL_PATTERN.test(value)) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  let text = value;
  if (text.endsWith('/')) {
    if (!directory) return false;
    text = text.slice(0, -1);
    if (text.endsWith('/')) return false;
  }
  return text.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isDiffPair(before, after) {
  if (!isSafeRelativePath(before) || !isSafeRelativePath(after)) return false;
  if (!before.startsWith('before/') || !after.startsWith('after/')) return false;
  return before.slice('before/'.length) === after.slice('after/'.length);
}

function normalizeRevParse(argv) {
  if (argv.length === 2 && argv[1] === 'HEAD') return argv;
  if (isExact(argv, ['rev-parse', '--show-toplevel'])) return argv;
  if (isExact(argv, ['rev-parse', '--git-common-dir'])) return argv;
  if (isExact(argv, ['rev-parse', '--show-object-format'])) return argv;
  if (isExact(argv, ['rev-parse', '--is-shallow-repository'])) return argv;
  if (argv.length === 3 && argv[1] === '--verify'
      && (isPeeledOid(argv[2], 'commit') || isPeeledOid(argv[2], 'tree'))) {
    return argv;
  }
  if (argv.length === 2 && isPeeledOid(argv[1], 'tree')) return argv;
  return null;
}

function normalizeLsTree(argv) {
  if (argv.length >= 5 && argv[1] === '-z' && argv[3] === '--' && isOid(argv[2])) {
    const paths = argv.slice(4);
    return paths.every((value) => isSafeRelativePath(value, { directory: true })) ? argv : null;
  }
  if (argv.length === 5 && argv[1] === '-r' && argv[2] === '--full-tree' && argv[3] === '-z' && isOid(argv[4])) {
    return argv;
  }
  return null;
}

function normalizeDiff(argv) {
  if (argv.length === 5 && argv[1] === '--name-only' && argv[2] === '-z' && isOid(argv[3]) && isOid(argv[4])) {
    return ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', argv[3], argv[4]];
  }
  if (argv.length === 7 && argv[1] === '--name-only' && argv[2] === '-z' && argv[3] === '--no-ext-diff'
      && argv[4] === '--no-textconv' && isOid(argv[5]) && isOid(argv[6])) {
    return argv;
  }
  if (argv.length === 9 && argv[1] === '--no-index' && argv[2] === '--binary' && argv[3] === '--no-prefix'
      && argv[4] === '--no-ext-diff' && argv[5] === '--no-textconv' && argv[6] === '--'
      && isDiffPair(argv[7], argv[8])) {
    return argv;
  }
  return null;
}

function validateGitArgs(args, privateIndex) {
  if (!Array.isArray(args) || args.length === 0) return null;
  const argv = args.slice();
  switch (argv[0]) {
    case 'rev-parse':
      return normalizeRevParse(argv);
    case 'symbolic-ref':
      return isExact(argv, ['symbolic-ref', '-q', 'HEAD'])
        || isExact(argv, ['symbolic-ref', '--quiet', '--short', 'HEAD']) ? argv : null;
    case 'remote':
      return isExact(argv, ['remote', 'get-url', 'origin'])
        || isExact(argv, ['remote', 'get-url', '--push', '--all', 'origin']) ? argv : null;
    case 'rev-list':
      return isExact(argv, ['rev-list', '--parents', '-n', '1', argv[4]]) && isOid(argv[4]) ? argv : null;
    case 'ls-tree':
      return normalizeLsTree(argv);
    case 'cat-file':
      return argv.length === 3 && ['blob', 'commit'].includes(argv[1]) && isOid(argv[2]) ? argv : null;
    case 'ls-files':
      return privateIndex && isExact(argv, ['ls-files', '--stage', '-z']) ? argv : null;
    case 'merge-base':
      return isExact(argv, ['merge-base', '--is-ancestor', argv[2], argv[3]]) && isOid(argv[2]) && isOid(argv[3])
        ? argv : null;
    case 'diff':
      return normalizeDiff(argv);
    default:
      return null;
  }
}

function requirePrivateIndex(providedEnv, io) {
  if (providedEnv === undefined || providedEnv === null) return null;
  if (typeof providedEnv !== 'object' || Array.isArray(providedEnv)) throw localReadError();
  const value = providedEnv.GIT_INDEX_FILE;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw localReadError();
  let stat;
  try {
    stat = io.lstatSync(value);
  } catch (error) {
    throw localReadError(error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw localReadError();
  const parent = path.dirname(value);
  let realParent;
  try {
    realParent = io.realpathSync(parent);
  } catch (error) {
    throw localReadError(error);
  }
  if (realParent !== parent) throw localReadError();
  return value;
}

function buildChildEnv(baseEnv, indexFile) {
  const env = {};
  for (const name of BASE_ENV_KEYS) {
    const value = baseEnv ? baseEnv[name] : undefined;
    if (typeof value === 'string') env[name] = value;
  }
  for (const name of Object.keys(FORCED_ENV)) env[name] = FORCED_ENV[name];
  env.GIT_CONFIG_GLOBAL = os.devNull;
  if (indexFile !== null) env.GIT_INDEX_FILE = indexFile;
  return env;
}

function buildSpawnOptions(options) {
  if (typeof options !== 'object' || Array.isArray(options)) throw localReadError();
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) throw localReadError();
  }
  if (typeof options.cwd !== 'string' || !path.isAbsolute(options.cwd)) throw localReadError();
  const encoding = options.encoding === undefined ? 'utf8' : options.encoding;
  if (encoding !== null && encoding !== 'utf8' && encoding !== 'utf-8') throw localReadError();
  const maxBuffer = options.maxBuffer === undefined ? MAX_BUFFER_BYTES : options.maxBuffer;
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0 || maxBuffer > MAX_BUFFER_BYTES) throw localReadError();
  if (options.shell !== undefined && options.shell !== false) throw localReadError();
  if (options.stdio !== undefined && !isExact(options.stdio, READ_STDIO)) throw localReadError();
  if (options.input !== undefined && options.input !== null) throw localReadError();
  return { encoding, maxBuffer };
}

function createLocalGitReader({ spawnSync = nodeSpawnSync, env = process.env } = {}) {
  if (typeof spawnSync !== 'function') throw localReadError();
  const baseEnv = env !== null && typeof env === 'object' ? env : {};

  function execute(command, args, options) {
    const provided = options === undefined || options === null ? {} : options;
    if (command !== 'git') throw localReadError();
    const indexFile = requirePrivateIndex(provided.env, fs);
    const argv = validateGitArgs(args, indexFile !== null);
    if (argv === null) throw localReadError();
    const spawnOptions = buildSpawnOptions(provided);
    return spawnSync('git', GIT_GLOBAL_ARGS.concat(argv), {
      cwd: provided.cwd,
      env: buildChildEnv(baseEnv, indexFile),
      encoding: spawnOptions.encoding,
      maxBuffer: spawnOptions.maxBuffer,
      shell: false,
      stdio: READ_STDIO.slice(),
      timeout: READ_TIMEOUT_MS,
      killSignal: KILL_SIGNAL
    });
  }

  function run(command, args, options) {
    const result = execute(command, args, options);
    if (result.error || result.signal || result.status !== 0) {
      const error = localReadError();
      error.status = result.status === undefined ? null : result.status;
      error.signal = result.signal === undefined ? null : result.signal;
      error.stdout = result.stdout === undefined ? null : result.stdout;
      error.stderr = result.stderr === undefined ? null : result.stderr;
      if (result.error) error.cause = result.error;
      throw error;
    }
    return result.stdout === undefined ? null : result.stdout;
  }

  function spawn(command, args, options) {
    return execute(command, args, options);
  }

  function readGit(cwd, args) {
    const text = run('git', args, { cwd });
    return typeof text === 'string' ? text.trim() : String(text).trim();
  }

  return { readGit, run, spawn };
}

function readBoundedOrdinaryFile(file, { maxBytes, missing = false, fs: io = fs } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw localReadError();
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw localReadError();

  let stat;
  try {
    stat = io.lstatSync(file);
  } catch (error) {
    if (missing && error && error.code === 'ENOENT') return null;
    throw localReadError(error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw localReadError();

  let fd = null;
  let primaryError = null;
  try {
    try {
      fd = io.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (error) {
      if (missing && error && error.code === 'ENOENT') return null;
      throw localReadError(error);
    }
    const opened = io.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile()) throw localReadError();

    const limit = maxBytes + 1;
    const chunks = [];
    let total = 0;
    while (total < limit) {
      const want = Math.min(READ_CHUNK_BYTES, limit - total);
      const chunk = Buffer.allocUnsafe(want);
      const read = io.readSync(fd, chunk, 0, want, total);
      if (!Number.isInteger(read) || read <= 0) break;
      total += read;
      chunks.push(read === want ? chunk : chunk.subarray(0, read));
    }
    if (total > maxBytes) throw localReadError();
    return Buffer.concat(chunks, total);
  } catch (error) {
    primaryError = isLocalReadError(error) ? error : localReadError(error);
    throw primaryError;
  } finally {
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch (closeError) {
        if (primaryError === null) throw localReadError(closeError);
      }
    }
  }
}

module.exports = { createLocalGitReader, readBoundedOrdinaryFile };
