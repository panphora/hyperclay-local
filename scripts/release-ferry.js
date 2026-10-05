'use strict';

// Coordinate the docs critical section with Ferry: a cooperating updater runs its
// exact docs apply/ref update under Ferry's own per-repository lock, so Ferry's
// autosave cannot race it. The installed lock protocol is reused as-is -- this
// module owns no lock format of its own, never writes or removes FERRY_HOLD, and
// never invokes the Ferry CLI or its autosave lane. When Ferry is missing the
// caller still runs under the separate updater lock, and that fallback is logged
// as an absence of Ferry exclusion rather than proof of it.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const UNAVAILABLE = 'FERRY_COORDINATION_UNAVAILABLE';
const INVALID = 'FERRY_COORDINATION_INVALID';
const LOCK_COMMAND = 'desktop-release-docs';
const UNAVAILABLE_MESSAGE = 'Ferry is unavailable; continuing with the updater lock and Git checks.';
const CORE_MODULES = ['config.js', 'paths.js', 'lock.js'];

function stateError(code, message) {
  return Object.assign(new Error(message), { code });
}

function invalidError(message) {
  return stateError(INVALID, message);
}

function unavailableError(message, cause) {
  const error = stateError(UNAVAILABLE, message);
  if (cause !== undefined) error.cause = cause;
  return error;
}

function defaultLog(message) {
  process.stderr.write(`${message}\n`);
}

function coreModulePath(packageRoot, name) {
  return path.join(packageRoot, 'src', 'core', name);
}

async function defaultLoadModules(packageRoot) {
  const [config, paths, lock] = await Promise.all(
    CORE_MODULES.map((name) => import(pathToFileURL(coreModulePath(packageRoot, name)).href))
  );
  return { loadConfig: config.loadConfig, root: paths.root, withRepoLock: lock.withRepoLock };
}

function resolveCallback(callback) {
  if (typeof callback !== 'function') throw invalidError('Ferry coordination callback must be a function');
  return callback;
}

function resolveRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw invalidError('Ferry coordination repository root must be an absolute path');
  }
  let stat;
  try {
    stat = fs.statSync(repoRoot);
  } catch {
    throw invalidError('Ferry coordination repository root must be an existing directory');
  }
  if (!stat.isDirectory()) throw invalidError('Ferry coordination repository root must be a directory');
  return repoRoot;
}

function resolveOptions(options) {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidError('Ferry coordination options must be an object');
  }
  const rawPath = options.pathEnv === undefined ? process.env.PATH : options.pathEnv;
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    throw invalidError('Ferry coordination PATH must be a string');
  }
  const log = options.log === undefined ? defaultLog : options.log;
  if (typeof log !== 'function') throw invalidError('Ferry coordination log must be a function');
  const loadModules = options.loadModules === undefined ? defaultLoadModules : options.loadModules;
  if (typeof loadModules !== 'function') throw invalidError('Ferry coordination loadModules must be a function');
  return { pathEnv: rawPath === undefined ? '' : rawPath, log, loadModules };
}

function findFerryExecutable(pathEnv) {
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir === '') continue;
    const candidate = path.join(dir, 'ferry');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    return candidate;
  }
  return null;
}

function resolvePackageRoot(executable) {
  let resolved;
  try {
    resolved = fs.realpathSync(executable);
  } catch (error) {
    throw unavailableError(`Ferry executable ${executable} could not be resolved`, error);
  }
  const binDir = path.dirname(resolved);
  if (path.basename(resolved) !== 'ferry.js' || path.basename(binDir) !== 'bin') {
    throw unavailableError(`Ferry at ${resolved} does not use the supported bin/ferry.js layout`);
  }
  const packageRoot = path.dirname(binDir);
  for (const name of CORE_MODULES) {
    let stat;
    try {
      stat = fs.lstatSync(coreModulePath(packageRoot, name));
    } catch (error) {
      throw unavailableError(`Ferry installation at ${packageRoot} is missing src/core/${name}`, error);
    }
    if (!stat.isFile()) {
      throw unavailableError(`Ferry installation at ${packageRoot} has a non-file src/core/${name}`);
    }
  }
  return packageRoot;
}

async function loadFerryApi(packageRoot, loadModules) {
  let modules;
  try {
    modules = await loadModules(packageRoot);
  } catch (error) {
    throw unavailableError(`Ferry modules at ${packageRoot} could not be imported`, error);
  }
  const apiMissing = typeof modules !== 'object' || modules === null
    || typeof modules.loadConfig !== 'function'
    || typeof modules.root !== 'function'
    || typeof modules.withRepoLock !== 'function';
  if (apiMissing) throw unavailableError(`Ferry at ${packageRoot} does not expose the supported lock API`);
  try {
    modules.loadConfig();
  } catch (error) {
    throw unavailableError('Ferry configuration could not be loaded', error);
  }
  let ferryRoot;
  try {
    ferryRoot = modules.root();
  } catch (error) {
    throw unavailableError('Ferry repository root could not be read', error);
  }
  if (typeof ferryRoot !== 'string' || ferryRoot === '' || !path.isAbsolute(ferryRoot)) {
    throw unavailableError('Ferry did not report an absolute repository root');
  }
  let stat;
  try {
    stat = fs.statSync(ferryRoot);
  } catch (error) {
    throw unavailableError('Ferry reported a repository root that does not exist', error);
  }
  if (!stat.isDirectory()) throw unavailableError('Ferry reported a repository root that is not a directory');
  return { withRepoLock: modules.withRepoLock, ferryRoot };
}

function relativeRepoKey(ferryRoot, repoRoot) {
  const relative = path.relative(ferryRoot, repoRoot);
  if (relative === '') throw unavailableError('Ferry cannot lock the repository that is its own root');
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative;
}

async function withFerryRepoLock(repoRoot, callback, options = {}) {
  const run = resolveCallback(callback);
  const root = resolveRepoRoot(repoRoot);
  const { pathEnv, log, loadModules } = resolveOptions(options);
  const executable = findFerryExecutable(pathEnv);
  if (executable === null) {
    log(UNAVAILABLE_MESSAGE);
    return await run();
  }
  const { withRepoLock, ferryRoot } = await loadFerryApi(resolvePackageRoot(executable), loadModules);
  const relative = relativeRepoKey(ferryRoot, root);
  if (relative === null) return await run();
  return withRepoLock(relative, LOCK_COMMAND, run);
}

module.exports = { withFerryRepoLock };
