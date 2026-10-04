'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { statePaths } = require('./release-state');

const DIRECTORY_MODE = 0o700;
const RECORD_MODE = 0o600;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const MAX_RECORD_BYTES = 4 * 1024;
const READ_CHUNK_BYTES = 1024;
const OWNER_SCHEMA = 1;
const OWNER_PATTERN = /^owner-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;
const RECORD_KEYS = ['schema', 'pid', 'host', 'token', 'createdAt'];

function lockError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function busyError(prefix) {
  return lockError(`${prefix}_LOCK_BUSY`, 'Ownership lock is held by another caller');
}

function ioError(prefix, label, cause) {
  return lockError(`${prefix}_LOCK_IO_FAILED`, `Ownership lock operation failed during ${label}`, cause === undefined ? null : cause);
}

function pathError(prefix, message) {
  return lockError(`${prefix}_LOCK_PATH_UNSAFE`, message);
}

function lostError(prefix, message) {
  return lockError(`${prefix}_LOCK_LOST`, message);
}

function depsError(message) {
  return lockError('LOCK_DEPS_INVALID', message);
}

function lstatFor(prefix, target, io) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') return null;
    if (code === 'ENOTDIR' || code === 'ELOOP' || code === 'ENAMETOOLONG') {
      throw pathError(prefix, 'Ownership lock path component is not a real directory');
    }
    throw ioError(prefix, 'path inspection', error);
  }
}

function relativeParts(prefix, base, target) {
  const relative = path.relative(base, target);
  if (relative === '') return [];
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw pathError(prefix, 'Ownership lock path escapes the release cache');
  }
  return relative.split(path.sep);
}

function isOwned(releasesDir, current) {
  return current === releasesDir || current.startsWith(releasesDir + path.sep);
}

function assertOwnedDirectory(prefix, stat, owned) {
  if (!owned) return;
  if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw pathError(prefix, 'Ownership lock cache directory is writable by group or other');
  }
  if ((stat.mode & SPECIAL_MODE_BITS) !== 0) {
    throw pathError(prefix, 'Ownership lock cache directory has unsafe mode bits');
  }
}

function deepestExistingAncestor(prefix, target, io) {
  const suffix = [];
  let current = path.normalize(target);
  for (;;) {
    const stat = lstatFor(prefix, current, io);
    if (stat !== null) return { ancestor: current, stat, suffix };
    const parent = path.dirname(current);
    if (parent === current) throw pathError(prefix, 'Ownership lock path has no existing ancestor');
    suffix.unshift(path.basename(current));
    current = parent;
  }
}

function prepareOwnedDirectories(prefix, releasesDir, targetDir, io) {
  const boundary = deepestExistingAncestor(prefix, releasesDir, io);
  if (!boundary.stat.isDirectory()) {
    throw pathError(prefix, 'Ownership lock cache path is not a real directory');
  }
  assertOwnedDirectory(prefix, boundary.stat, isOwned(releasesDir, boundary.ancestor));
  const names = boundary.suffix.concat(relativeParts(prefix, releasesDir, targetDir));
  let current = boundary.ancestor;
  for (const name of names) {
    current = path.join(current, name);
    let stat = lstatFor(prefix, current, io);
    if (stat === null) {
      try {
        io.mkdirSync(current, DIRECTORY_MODE);
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw ioError(prefix, 'cache directory creation', error);
      }
      stat = lstatFor(prefix, current, io);
      if (stat === null) throw pathError(prefix, 'Ownership lock cache directory was not created');
    }
    if (!stat.isDirectory()) {
      throw pathError(prefix, 'Ownership lock cache path component is not a real directory');
    }
    assertOwnedDirectory(prefix, stat, isOwned(releasesDir, current));
  }
  return targetDir;
}

function decodeOwner(bytes, uuid) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).length !== RECORD_KEYS.length) return null;
  for (const key of RECORD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) return null;
  }
  if (parsed.schema !== OWNER_SCHEMA) return null;
  if (!Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) return null;
  if (typeof parsed.host !== 'string' || parsed.host.length === 0) return null;
  if (typeof parsed.token !== 'string' || parsed.token !== uuid) return null;
  if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt))) return null;
  return parsed;
}

function readOwnerBytes(fd, io) {
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  const parts = [];
  let total = 0;
  for (;;) {
    const read = io.readSync(fd, chunk, 0, chunk.length, total);
    if (read === 0) break;
    total += read;
    if (total > MAX_RECORD_BYTES) throw new Error('Ownership lock owner record exceeds the maximum size');
    parts.push(Buffer.from(chunk.subarray(0, read)));
  }
  return Buffer.concat(parts, total);
}

function probeOwnerRecord(lockDir, name, io) {
  const match = OWNER_PATTERN.exec(name);
  if (!match) return { ok: false };
  const ownerFile = path.join(lockDir, name);
  let before;
  try {
    before = io.lstatSync(ownerFile);
  } catch {
    return { ok: false };
  }
  if (!before.isFile() || before.nlink !== 1) return { ok: false };
  if ((before.mode & SPECIAL_MODE_BITS) !== 0 || (before.mode & GROUP_OR_OTHER_WRITE) !== 0) return { ok: false };
  if (before.size > MAX_RECORD_BYTES) return { ok: false };
  const constants = io.constants || fs.constants;
  let fd;
  try {
    fd = io.openSync(ownerFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch {
    return { ok: false };
  }
  let result;
  try {
    const stat = io.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino ||
        stat.size > MAX_RECORD_BYTES) {
      result = { ok: false };
    } else {
      const bytes = readOwnerBytes(fd, io);
      const record = decodeOwner(bytes, match[1]);
      result = record === null ? { ok: false } : { ok: true, name, ownerFile, stat, record, bytes };
    }
  } catch {
    result = { ok: false };
  }
  try {
    io.closeSync(fd);
  } catch {
    return result;
  }
  return result;
}

function inspectExistingLock(lockDir, io, resolved) {
  let dirStat;
  try {
    dirStat = io.lstatSync(lockDir);
  } catch {
    return { status: 'busy' };
  }
  if (!dirStat.isDirectory()) return { status: 'busy' };
  let names;
  try {
    names = io.readdirSync(lockDir);
  } catch {
    return { status: 'busy' };
  }
  if (names.length !== 1) return { status: 'busy' };
  const probe = probeOwnerRecord(lockDir, names[0], io);
  if (!probe.ok) return { status: 'busy' };
  if (probe.record.host !== resolved.host) return { status: 'busy' };
  let dead = false;
  try {
    resolved.kill(probe.record.pid, 0);
  } catch (error) {
    if (error && error.code === 'ESRCH') dead = true;
  }
  if (!dead) return { status: 'busy' };
  return { status: 'dead', dirStat, name: probe.name, ownerFile: probe.ownerFile, stat: probe.stat, bytes: probe.bytes };
}

function reclaimDeadOwner(lockDir, inspection, io) {
  let currentDir;
  try {
    currentDir = io.lstatSync(lockDir);
  } catch {
    return;
  }
  if (!currentDir.isDirectory() || currentDir.dev !== inspection.dirStat.dev ||
      currentDir.ino !== inspection.dirStat.ino) {
    return;
  }
  const probe = probeOwnerRecord(lockDir, inspection.name, io);
  if (!probe.ok) return;
  if (probe.stat.dev !== inspection.stat.dev || probe.stat.ino !== inspection.stat.ino) return;
  if (!probe.bytes.equals(inspection.bytes)) return;
  try {
    io.unlinkSync(probe.ownerFile);
  } catch {
    return;
  }
  try {
    io.rmdirSync(lockDir);
  } catch {
    return;
  }
}

function setupFailure(prefix, error) {
  if (error && (error.code === `${prefix}_LOCK_IO_FAILED` || error.code === 'LOCK_DEPS_INVALID')) return error;
  return ioError(prefix, 'owner record setup', error);
}

function cleanupFailedSetup(lockDir, dirStat, ownerFile, ownerStat, io) {
  let currentDir;
  try {
    currentDir = io.lstatSync(lockDir);
  } catch {
    return;
  }
  if (!currentDir.isDirectory() || currentDir.dev !== dirStat.dev || currentDir.ino !== dirStat.ino) return;
  if (ownerStat !== null) {
    let currentOwner;
    try {
      currentOwner = io.lstatSync(ownerFile);
    } catch {
      currentOwner = null;
    }
    if (currentOwner !== null && currentOwner.dev === ownerStat.dev && currentOwner.ino === ownerStat.ino) {
      try {
        io.unlinkSync(ownerFile);
      } catch {
        /* record already gone */
      }
    }
  }
  try {
    io.rmdirSync(lockDir);
  } catch {
    /* directory not exclusively ours */
  }
}

function confirmOwnership(prefix, lockDir, dirStat, ownerFile, token, ownerStat, io) {
  let current;
  try {
    current = io.lstatSync(lockDir);
  } catch (error) {
    throw ioError(prefix, 'lock directory confirmation', error);
  }
  if (!current.isDirectory() || current.dev !== dirStat.dev || current.ino !== dirStat.ino) {
    throw ioError(prefix, 'lock directory changed during acquisition', null);
  }
  let names;
  try {
    names = io.readdirSync(lockDir);
  } catch (error) {
    throw ioError(prefix, 'lock directory confirmation', error);
  }
  if (names.length !== 1 || names[0] !== path.basename(ownerFile)) {
    throw ioError(prefix, 'lock directory is not exclusively owned', null);
  }
  const probe = probeOwnerRecord(lockDir, names[0], io);
  if (!probe.ok || probe.record.token !== token ||
      probe.stat.dev !== ownerStat.dev || probe.stat.ino !== ownerStat.ino) {
    throw ioError(prefix, 'lock owner record is not exclusively owned', null);
  }
}

function createOwner(prefix, lockDir, dirStat, resolved) {
  const io = resolved.io;
  const token = resolved.randomUUID();
  if (typeof token !== 'string' || !OWNER_PATTERN.test(`owner-${token}.json`)) {
    throw depsError('Ownership lock randomUUID must return a valid UUID');
  }
  const ownerFile = path.join(lockDir, `owner-${token}.json`);
  const payload = Buffer.from(`${JSON.stringify({
    schema: OWNER_SCHEMA, pid: resolved.pid, host: resolved.host, token, createdAt: resolved.createdAt
  })}\n`, 'utf8');
  if (payload.length > MAX_RECORD_BYTES) throw depsError('Ownership lock owner record exceeds the maximum size');
  let fd = null;
  let ownerStat = null;
  try {
    fd = io.openSync(ownerFile, 'wx', RECORD_MODE);
    ownerStat = io.fstatSync(fd);
    io.writeFileSync(fd, payload);
    if (io.fstatSync(fd).size !== payload.length) {
      throw ioError(prefix, 'owner record serialization', null);
    }
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
  } catch (error) {
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch {
        /* descriptor already released */
      }
    }
    cleanupFailedSetup(lockDir, dirStat, ownerFile, ownerStat, io);
    throw setupFailure(prefix, error);
  }
  try {
    confirmOwnership(prefix, lockDir, dirStat, ownerFile, token, ownerStat, io);
  } catch (error) {
    cleanupFailedSetup(lockDir, dirStat, ownerFile, ownerStat, io);
    throw error;
  }
  return { token, ownerFile, ownerStat, dirStat };
}

function createLockDirectory(prefix, lockDir, io) {
  try {
    io.mkdirSync(lockDir, DIRECTORY_MODE);
  } catch (error) {
    if (error && error.code === 'EEXIST') return null;
    throw ioError(prefix, 'lock directory creation', error);
  }
  const stat = lstatFor(prefix, lockDir, io);
  if (stat === null || !stat.isDirectory()) throw ioError(prefix, 'lock directory creation', null);
  return stat;
}

function acquireLock(config, resolved) {
  const io = resolved.io;
  const { prefix, lockDir } = config;
  prepareOwnedDirectories(prefix, config.releasesDir, path.dirname(lockDir), io);
  let dirStat = createLockDirectory(prefix, lockDir, io);
  if (dirStat === null) {
    const inspection = inspectExistingLock(lockDir, io, resolved);
    if (inspection.status !== 'dead') throw busyError(prefix);
    reclaimDeadOwner(lockDir, inspection, io);
    dirStat = createLockDirectory(prefix, lockDir, io);
    if (dirStat === null) throw busyError(prefix);
  }
  return createOwner(prefix, lockDir, dirStat, resolved);
}

function releaseLock(config, ownership, io) {
  const { prefix, lockDir } = config;
  let currentDir;
  try {
    currentDir = io.lstatSync(lockDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw lostError(prefix, 'Ownership lock directory disappeared before release');
    }
    throw ioError(prefix, 'release inspection', error);
  }
  if (!currentDir.isDirectory() || currentDir.dev !== ownership.dirStat.dev ||
      currentDir.ino !== ownership.dirStat.ino) {
    throw lostError(prefix, 'Ownership lock directory was replaced before release');
  }
  const probe = probeOwnerRecord(lockDir, path.basename(ownership.ownerFile), io);
  if (!probe.ok || probe.record.token !== ownership.token ||
      probe.stat.dev !== ownership.ownerStat.dev || probe.stat.ino !== ownership.ownerStat.ino) {
    throw lostError(prefix, 'Ownership lock record was replaced before release');
  }
  try {
    io.unlinkSync(ownership.ownerFile);
  } catch (error) {
    throw ioError(prefix, 'owner record removal', error);
  }
  try {
    io.rmdirSync(lockDir);
  } catch (error) {
    if (error && (error.code === 'ENOTEMPTY' || error.code === 'EEXIST')) {
      throw lostError(prefix, 'Ownership lock directory is not empty after release');
    }
    throw ioError(prefix, 'lock directory removal', error);
  }
}

function resolveDeps(prefix, callback, deps) {
  if (typeof callback !== 'function') throw depsError('Ownership lock callback must be a function');
  const provided = deps === undefined ? {} : deps;
  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    throw depsError('Ownership lock deps must be an object');
  }
  const io = provided.fs === undefined ? fs : provided.fs;
  const hostname = provided.hostname === undefined ? () => os.hostname() : provided.hostname;
  const kill = provided.kill === undefined ? (pid, signal) => process.kill(pid, signal) : provided.kill;
  const randomUUID = provided.randomUUID === undefined ? () => crypto.randomUUID() : provided.randomUUID;
  const now = provided.now === undefined ? () => Date.now() : provided.now;
  const pid = provided.pid === undefined ? process.pid : provided.pid;
  if (typeof io !== 'object' || io === null) throw depsError('Ownership lock fs must be an object');
  if (typeof hostname !== 'function') throw depsError('Ownership lock hostname must be a function');
  if (typeof kill !== 'function') throw depsError('Ownership lock kill must be a function');
  if (typeof randomUUID !== 'function') throw depsError('Ownership lock randomUUID must be a function');
  if (typeof now !== 'function') throw depsError('Ownership lock now must be a function');
  if (!Number.isSafeInteger(pid) || pid <= 0) throw depsError('Ownership lock pid must be a positive integer');
  let host;
  try {
    host = hostname();
  } catch (error) {
    throw ioError(prefix, 'hostname resolution', error);
  }
  if (typeof host !== 'string' || host.length === 0) {
    throw depsError('Ownership lock hostname must be a non-empty string');
  }
  let createdAt;
  try {
    createdAt = new Date(now()).toISOString();
  } catch (error) {
    throw depsError('Ownership lock now must produce a valid timestamp');
  }
  return { io, host, pid, kill, randomUUID, createdAt, cacheRoot: provided.cacheRoot };
}

function resolveConfig(kind, prefix, identity, resolved) {
  const paths = statePaths(identity, { cacheRoot: resolved.cacheRoot, fs: resolved.io });
  const lockDir = kind === 'release'
    ? paths.releaseLock
    : path.join(paths.docsLocksDir, `${identity.key}.lock`);
  return { prefix, lockDir, releasesDir: paths.releasesDir };
}

async function withLock(kind, identity, callback, deps) {
  const prefix = kind === 'release' ? 'RELEASE' : 'DOCS';
  const resolved = resolveDeps(prefix, callback, deps);
  const config = resolveConfig(kind, prefix, identity, resolved);
  const ownership = acquireLock(config, resolved);
  let result;
  let callbackError;
  let callbackFailed = false;
  try {
    result = await callback();
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }
  let cleanupError = null;
  try {
    releaseLock(config, ownership, resolved.io);
  } catch (error) {
    cleanupError = error;
  }
  if (callbackFailed) {
    if (cleanupError !== null) {
      try {
        callbackError.cleanupError = cleanupError;
      } catch {
        /* error object is not extensible */
      }
    }
    throw callbackError;
  }
  if (cleanupError !== null) throw cleanupError;
  return result;
}

function withReleaseLock(identity, callback, deps = {}) {
  return withLock('release', identity, callback, deps);
}

function withDocsLock(identity, callback, deps = {}) {
  return withLock('docs', identity, callback, deps);
}

module.exports = { withReleaseLock, withDocsLock };
