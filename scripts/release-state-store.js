'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { statePaths, stateError, validateReleaseState } = require('./release-state');

const MAX_STATE_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const LANE_FILES = { publish: 'stateFile', 'dry-run': 'dryRunFile' };
const COMPLETE_PHASE = 'complete';
const RECORD_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const REPO_FIELDS = [
  'key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'
];

function conflict(message) {
  return stateError('STATE_CONFLICT', message);
}

function failure(label, cause) {
  const error = stateError('STATE_IO_FAILED', `Release state operation failed during ${label}`);
  error.cause = cause === undefined ? null : cause;
  return error;
}

function phase(label, operation) {
  try {
    return operation();
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('STATE_')) throw error;
    throw failure(label, error);
  }
}

function requireLane(mode) {
  if (mode !== 'publish' && mode !== 'dry-run') {
    throw stateError('STATE_INVALID', 'Release state lane must be publish or dry-run');
  }
}

function laneFile(paths, mode) {
  requireLane(mode);
  return paths[LANE_FILES[mode]];
}

function relativeParts(base, target) {
  const relative = path.relative(base, target);
  if (relative === '') return [];
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw stateError('STATE_CACHE_INVALID', 'Release state path escapes the release cache');
  }
  return relative.split(path.sep);
}

function lstatOrMissing(target, io) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') return null;
    if (code === 'ENOTDIR' || code === 'ELOOP') {
      throw stateError('STATE_CACHE_INVALID', 'Release state path component is not a directory');
    }
    throw failure('cache inspection', error);
  }
}

function deepestExistingAncestor(target, io) {
  const suffix = [];
  let current = path.normalize(target);
  for (;;) {
    const stat = lstatOrMissing(current, io);
    if (stat !== null) return { ancestor: current, stat, suffix };
    const parent = path.dirname(current);
    if (parent === current) {
      throw stateError('STATE_CACHE_INVALID', 'Release state path has no existing ancestor');
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }
}

function createOwnedDirectory(target, io) {
  try {
    io.mkdirSync(target, DIRECTORY_MODE);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  }
}

function walkOwnedCache(releasesDir, targetDir, io, { create }) {
  const boundary = deepestExistingAncestor(releasesDir, io);
  if (!boundary.stat.isDirectory()) {
    throw stateError('STATE_CACHE_INVALID', 'Release cache path is not a directory');
  }
  const boundaryOwned = boundary.ancestor === releasesDir || boundary.ancestor.startsWith(releasesDir + path.sep);
  if (boundaryOwned && (boundary.stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw stateError('STATE_CACHE_INVALID', 'Release cache directory is writable by group or other');
  }
  if (create) {
    phase('cache directory flush', () => fsyncDirectory(path.dirname(boundary.ancestor), io));
  }
  const names = boundary.suffix.concat(relativeParts(releasesDir, targetDir));
  let current = boundary.ancestor;
  for (const name of names) {
    current = path.join(current, name);
    let stat = lstatOrMissing(current, io);
    if (stat === null) {
      if (!create) return null;
      phase('cache directory creation', () => createOwnedDirectory(current, io));
      stat = lstatOrMissing(current, io);
      if (stat === null) throw stateError('STATE_CACHE_INVALID', 'Release cache directory was not created');
      phase('cache directory flush', () => fsyncDirectory(path.dirname(current), io));
    }
    if (!stat.isDirectory()) {
      throw stateError('STATE_CACHE_INVALID', 'Release cache path component is not a real directory');
    }
    const owned = current === releasesDir || current.startsWith(releasesDir + path.sep);
    if (owned && (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
      throw stateError('STATE_CACHE_INVALID', 'Release cache directory is writable by group or other');
    }
  }
  return targetDir;
}

function assertCacheOutsideCheckout(releasesDir, identity) {
  for (const protectedRoot of [identity && identity.root, identity && identity.commonDir]) {
    if (typeof protectedRoot !== 'string' || protectedRoot.length === 0) continue;
    if (releasesDir === protectedRoot || releasesDir.startsWith(protectedRoot + path.sep)) {
      throw stateError('STATE_CACHE_IN_CHECKOUT', 'Release state must stay outside the checkout');
    }
  }
}

function assertRecordStat(stat) {
  if (!stat.isFile()) {
    throw stateError('STATE_CACHE_INVALID', 'Release state record must be a regular file');
  }
  if ((stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw stateError('STATE_CACHE_INVALID', 'Release state record permissions are unsafe');
  }
}

function lstatRecord(target, io) {
  const stat = lstatOrMissing(target, io);
  if (stat === null) return null;
  assertRecordStat(stat);
  return stat;
}

function openRecord(target, io) {
  const constants = io.constants || fs.constants;
  try {
    return io.openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') {
      throw stateError('STATE_CACHE_INVALID', 'Release state record must not be a symlink');
    }
    throw failure('record open', error);
  }
}

function withClosedDescriptor(io, openDescriptor, use) {
  const fd = openDescriptor();
  let primary = null;
  let result;
  try {
    result = use(fd);
  } catch (error) {
    primary = error;
  }
  try {
    io.closeSync(fd);
  } catch (error) {
    if (primary === null) primary = failure('record close', error);
  }
  if (primary !== null) throw primary;
  return result;
}

function readBounded(fd, io) {
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  const parts = [];
  let total = 0;
  for (;;) {
    const read = phase('record read', () => io.readSync(fd, chunk, 0, chunk.length, total));
    if (read === 0) break;
    total += read;
    if (total > MAX_STATE_BYTES) {
      throw stateError('STATE_INVALID', 'Release state record exceeds the maximum size');
    }
    parts.push(Buffer.from(chunk.subarray(0, read)));
  }
  return Buffer.concat(parts, total);
}

function readRecordBytes(target, io) {
  const before = lstatRecord(target, io);
  if (before === null) return null;
  const fd = openRecord(target, io);
  if (fd === null) return null;
  return withClosedDescriptor(io, () => fd, (handle) => {
    const stat = phase('record inspection', () => io.fstatSync(handle));
    assertRecordStat(stat);
    if (stat.dev !== before.dev || stat.ino !== before.ino) {
      throw stateError('STATE_IO_FAILED', 'Release state record changed while it was being opened');
    }
    if (stat.size > MAX_STATE_BYTES) {
      throw stateError('STATE_INVALID', 'Release state record exceeds the maximum size');
    }
    return readBounded(handle, io);
  });
}

function decodeRecord(bytes, identity, paths) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw stateError('STATE_INVALID', 'Release state record is not valid JSON');
  }
  return validateReleaseState(parsed, identity, { repoDir: paths.repoDir });
}

function readLaneRecord(paths, mode, identity, io) {
  const target = laneFile(paths, mode);
  assertCacheOutsideCheckout(paths.releasesDir, identity);
  if (walkOwnedCache(paths.releasesDir, path.dirname(target), io, { create: false }) === null) return null;
  const bytes = readRecordBytes(target, io);
  if (bytes === null) return null;
  const value = decodeRecord(bytes, identity, paths);
  if (value.mode !== mode) {
    throw stateError('STATE_INVALID', 'Release state record does not belong to the selected lane');
  }
  return { bytes, value };
}

function closeQuietly(io, fd) {
  try {
    io.closeSync(fd);
  } catch {
    return;
  }
}

function discardOwnedFile(target, io) {
  try {
    io.unlinkSync(target);
  } catch {
    return;
  }
}

function createTemporaryRecord(dir, payload, io) {
  const target = path.join(dir, `${crypto.randomUUID()}.tmp`);
  let fd = null;
  let owned = false;
  try {
    fd = phase('temporary file creation', () => io.openSync(target, 'wx', RECORD_MODE));
    owned = true;
    phase('temporary file serialization', () => io.writeFileSync(fd, payload));
    const written = phase('temporary file inspection', () => io.fstatSync(fd));
    if (written.size !== payload.length) {
      throw stateError('STATE_IO_FAILED', 'Release state operation failed during temporary file serialization: the record was written incompletely');
    }
    phase('temporary file flush', () => io.fsyncSync(fd));
    const handle = fd;
    fd = null;
    try {
      io.closeSync(handle);
    } catch (error) {
      throw failure('temporary file close', error);
    }
  } catch (error) {
    if (fd !== null) closeQuietly(io, fd);
    if (owned) discardOwnedFile(target, io);
    throw error;
  }
  return target;
}

function assertRegularDestination(target, io) {
  const stat = lstatOrMissing(target, io);
  if (stat === null) return;
  if (!stat.isFile()) {
    throw stateError('STATE_CACHE_INVALID', 'Release state destination is not a regular file');
  }
}

function fsyncDirectory(dir, io) {
  const constants = io.constants || fs.constants;
  return withClosedDescriptor(io, () => io.openSync(dir, constants.O_RDONLY), fd => io.fsyncSync(fd));
}

function writeLaneRecord(target, payload, io) {
  const dir = path.dirname(target);
  const temp = createTemporaryRecord(dir, payload, io);
  try {
    assertRegularDestination(target, io);
    phase('record publication', () => io.renameSync(temp, target));
  } catch (error) {
    discardOwnedFile(temp, io);
    throw error;
  }
  phase('record directory flush', () => fsyncDirectory(dir, io));
}

function normalizeExpectedRevision(value) {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw stateError('STATE_INVALID', 'Release state expectedRevision must be null or a non-negative safe integer');
}

function sameRepo(left, right) {
  return REPO_FIELDS.every(field => left[field] === right[field]);
}

function assertSameRelease(previous, value) {
  if (value.revision !== previous.revision + 1) {
    throw conflict('Release state revision must advance by exactly one');
  }
  if (value.createdAt !== previous.createdAt) throw conflict('Release state createdAt cannot change');
  if (value.version !== previous.version) throw conflict('Release state version cannot change');
  if (value.mode !== previous.mode) throw conflict('Release state mode cannot change');
  if (!sameRepo(previous.repo, value.repo)) throw conflict('Release state repo cannot change');
  if (new Date(value.updatedAt).getTime() < new Date(previous.updatedAt).getTime()) {
    throw conflict('Release state updatedAt cannot move backwards');
  }
}

function assertReplaceableRelease(previous, value) {
  if (previous.phase !== COMPLETE_PHASE) {
    throw conflict('Only a completed release record can be replaced');
  }
  if (value.revision !== 0) throw conflict('A replacement release record must start at revision 0');
}

function linkExclusive(temp, target, bytes, identity, paths, io) {
  try {
    io.linkSync(temp, target);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const raced = readHistoryRecord(target, identity, paths, io);
    if (raced === null) throw failure('history archive', error);
    if (!raced.equals(bytes)) {
      throw conflict('Release history already holds different bytes for this release');
    }
  }
}

function readHistoryRecord(target, identity, paths, io) {
  const bytes = readRecordBytes(target, io);
  if (bytes === null) return null;
  decodeRecord(bytes, identity, paths);
  return bytes;
}

function archivePreviousRecord(previous, paths, identity, io) {
  walkOwnedCache(paths.releasesDir, paths.historyDir, io, { create: true });
  const target = path.join(paths.historyDir, `${previous.value.releaseId}.json`);
  const existing = readHistoryRecord(target, identity, paths, io);
  if (existing !== null) {
    if (!existing.equals(previous.bytes)) {
      throw conflict('Release history already holds different bytes for this release');
    }
    phase('history directory flush', () => fsyncDirectory(paths.historyDir, io));
    return;
  }
  const temp = createTemporaryRecord(paths.historyDir, previous.bytes, io);
  try {
    phase('history archive', () => linkExclusive(temp, target, previous.bytes, identity, paths, io));
    phase('history directory flush', () => {
      io.unlinkSync(temp);
      fsyncDirectory(paths.historyDir, io);
    });
  } catch (error) {
    discardOwnedFile(temp, io);
    throw error;
  }
}

function readReleaseState(identity, { cacheRoot, mode = 'publish', fs: io = fs } = {}) {
  requireLane(mode);
  const paths = statePaths(identity, { cacheRoot, fs: io });
  const record = readLaneRecord(paths, mode, identity, io);
  return record === null ? null : record.value;
}

/**
 * Persist one validated release record for the lane named by value.mode.
 *
 * PRECONDITION: callers hold the per-repo release lock. expectedRevision is
 * stale-state protection against a lost update, not a cross-process
 * compare-and-swap. A thrown error means the durable intent is unresolved and no
 * later acting operation may run in this invocation; the next one reconciles it.
 */
function writeReleaseState(value, identity, { cacheRoot, expectedRevision, fs: io = fs } = {}) {
  const expected = normalizeExpectedRevision(expectedRevision);
  const paths = statePaths(identity, { cacheRoot, fs: io });
  validateReleaseState(value, identity, { repoDir: paths.repoDir });
  const mode = value.mode;
  requireLane(mode);
  const payload = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (payload.length > MAX_STATE_BYTES) {
    throw stateError('STATE_INVALID', 'Release state record exceeds the maximum size');
  }

  const previous = readLaneRecord(paths, mode, identity, io);
  if (previous === null) {
    if (expected !== null) throw conflict('Release state lane has no record at the expected revision');
    if (value.revision !== 0) throw conflict('A new release record must start at revision 0');
  } else {
    if (expected === null) throw conflict('Release state lane already holds a record');
    if (previous.value.revision !== expected) {
      throw conflict('Release state lane revision does not match the expected revision');
    }
    if (previous.value.releaseId === value.releaseId) {
      assertSameRelease(previous.value, value);
    } else {
      assertReplaceableRelease(previous.value, value);
      archivePreviousRecord(previous, paths, identity, io);
    }
  }

  assertCacheOutsideCheckout(paths.releasesDir, identity);
  const target = laneFile(paths, mode);
  walkOwnedCache(paths.releasesDir, path.dirname(target), io, { create: true });
  writeLaneRecord(target, payload, io);
  return value;
}

module.exports = { readReleaseState, writeReleaseState };
