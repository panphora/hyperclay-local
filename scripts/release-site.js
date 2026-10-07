'use strict';

// Acting site work. Preparation materializes the immutable website subtree of the
// recorded completed size commit into a private retained snapshot, publishes the
// prepared descriptor last, and checkpoints the public site target as pending. The
// deployment records the requested descriptor and an unresolved public checkpoint
// before it makes its one provider invocation from a private deployment copy, and
// reconciliation recovers local completion from the captured-source receipt without
// deploying again. The read leaf stays authoritative for every inventory, descriptor
// and snapshot decision.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');

const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { execFileCaptured } = require('./release-command');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState, writeReleaseState, publishDurableFile, fsyncDirectory } = require('./release-state-store');
const { transitionRelease } = require('./release-transitions');
const { readSizeEvidence } = require('./release-size-evidence');
const { readCommittedSite, readSiteAttempt, verifySiteSnapshot } = require('./release-site-evidence');

const localReader = createLocalGitReader();

const FAILURE_CODE = 'SITE_ATTEMPT_FAILED';
const REPO_FIELDS = [
  'key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'
];
const RECORDS_DIR = 'records';
const SITE_DIR = 'site';
const SNAPSHOT_NAME = 'snapshot';
const SNAPSHOT_STAGING_NAME = 'snapshot.pending';
const DESCRIPTOR_FILE = 'site.json';
const DESCRIPTOR_SCHEMA = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const DIRECTORY_MODE = 0o700;
const GROUP_OR_OTHER_WRITE = 0o022;
const DEPLOY_DIR = 'deploy';
const WRANGLER_DIR = '.wrangler';
const RECEIPT_NAME = '.deploy';
const RECEIPT_MAX_BYTES = 128;
const HEX_PATTERN = /^[0-9a-f]+$/;
const SITE_DEPLOY_UNRESOLVED = {
  code: 'SITE_DEPLOY_UNRESOLVED',
  message: 'The site deployment is unresolved.'
};

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function siteAttemptError(message, cause) {
  const error = new Error(message);
  error.code = FAILURE_CODE;
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function isSiteAttemptFailure(value) {
  return Boolean(value) && typeof value === 'object' && value.code === FAILURE_CODE;
}

function attemptFailure(message, cause) {
  if (isSiteAttemptFailure(cause)) return cause;
  return siteAttemptError(message, cause);
}

function resolveDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw siteAttemptError('Site attempt dependencies must be a plain object');
  const run = provided.run === undefined || provided.run === null ? localReader.run : provided.run;
  const spawn = provided.spawn === undefined || provided.spawn === null ? localReader.spawn : provided.spawn;
  const io = provided.fs === undefined || provided.fs === null ? fs : provided.fs;
  const now = provided.now === undefined || provided.now === null
    ? () => new Date().toISOString()
    : provided.now;
  if (typeof run !== 'function') throw siteAttemptError('Site attempt run must be a function');
  if (typeof spawn !== 'function') throw siteAttemptError('Site attempt spawn must be a function');
  if (typeof now !== 'function') throw siteAttemptError('Site attempt now must be a function');
  if (io === null || typeof io !== 'object' || Array.isArray(io)) {
    throw siteAttemptError('Site attempt filesystem must be an object');
  }
  const readGit = (root, args) => {
    const output = run('git', args, { cwd: root });
    return typeof output === 'string' ? output.trim() : String(output).trim();
  };
  return { run, spawn, io, now, readGit };
}

function requireClock(now, floor) {
  let value;
  try {
    value = now();
  } catch (error) {
    throw siteAttemptError('Site attempt clock is not readable', error);
  }
  if (typeof value !== 'string') throw siteAttemptError('Site attempt clock must produce a canonical timestamp');
  const time = new Date(value).getTime();
  if (Number.isNaN(time) || new Date(time).toISOString() !== value) {
    throw siteAttemptError('Site attempt clock must produce a canonical timestamp');
  }
  if (floor !== null && floor !== undefined && time < new Date(floor).getTime()) {
    throw siteAttemptError('Site attempt clock moved backwards');
  }
  return value;
}

function requireActingState(state, repoDir, resolved) {
  if (!isPlainRecord(state) || !isPlainRecord(state.repo)) {
    throw siteAttemptError('Site attempt needs a validated release state');
  }
  let validated;
  try {
    validated = validateReleaseState(state, state.repo, { repoDir });
  } catch (error) {
    throw attemptFailure('Site attempt state is invalid', error);
  }
  if (validated.mode !== 'publish') throw siteAttemptError('Site attempt requires a publish release');
  const cacheRoot = path.dirname(repoDir);
  let paths;
  try {
    paths = statePaths(validated.repo, { cacheRoot, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('Site attempt cache is not the recorded repository cache', error);
  }
  if (paths.repoDir !== repoDir) throw siteAttemptError('Site cache does not match the recorded repository');
  let stored;
  try {
    stored = readReleaseState(validated.repo, { cacheRoot, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('Site attempt state is not readable', error);
  }
  if (!isDeepStrictEqual(stored, validated)) {
    throw siteAttemptError('Site input is not the persisted release state');
  }
  let identity;
  try {
    identity = resolveRepoIdentity(validated.repo.root, { readGit: resolved.readGit, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('Site repository identity is not readable', error);
  }
  for (const field of REPO_FIELDS) {
    if (identity[field] !== validated.repo[field]) {
      throw siteAttemptError('Site repository identity changed');
    }
  }
  return { state: validated, cacheRoot };
}

function selectAttempt(state, repoDir, { attemptId, retrySite }, resolved) {
  const recordedId = state.site.attemptId;
  if (recordedId === null) {
    if (retrySite) throw siteAttemptError('Site retry requires an unresolved recorded site attempt');
    if (state.site.state !== 'pending') {
      throw siteAttemptError(`Site preparation requires a pending site target, found ${state.site.state}`);
    }
    return null;
  }
  if (recordedId === attemptId) {
    throw siteAttemptError('Site preparation requires a fresh attempt identifier');
  }
  const existing = readSiteAttempt({ state, repoDir }, { run: resolved.run, fs: resolved.io });
  const phase = existing.descriptor.phase;
  if (retrySite) {
    if (state.site.state !== 'unknown') {
      throw siteAttemptError('Site retry requires an unresolved site target');
    }
    if (phase !== 'requested' && phase !== 'unknown') {
      throw siteAttemptError('Site retry requires an unresolved recorded site attempt');
    }
    return existing;
  }
  if (phase !== 'prepared') {
    throw siteAttemptError('Site preparation refuses an unresolved recorded site attempt');
  }
  if (state.site.state !== 'pending') {
    throw siteAttemptError(`Site preparation requires a pending site target, found ${state.site.state}`);
  }
  return existing;
}

function lstatOrMissing(io, target) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error && (error.code === 'ENOTDIR' || error.code === 'ELOOP')) {
      throw siteAttemptError('A site evidence path component is not a directory', error);
    }
    throw attemptFailure('A site evidence path is not readable', error);
  }
}

function fsyncDirectoryChecked(io, dir, label) {
  try {
    fsyncDirectory(dir, io);
  } catch (error) {
    throw attemptFailure(`${label} could not be flushed`, error);
  }
}

function assertOwnedDirectory(stat, label) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw siteAttemptError(`${label} must be a real directory`);
  if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) throw siteAttemptError(`${label} is writable by group or other`);
  return stat;
}

function ensureOwnedDirectory(io, dir, label) {
  let stat = lstatOrMissing(io, dir);
  if (stat === null) {
    try {
      io.mkdirSync(dir, DIRECTORY_MODE);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw attemptFailure(`${label} could not be created`, error);
    }
    stat = lstatOrMissing(io, dir);
    if (stat === null) throw siteAttemptError(`${label} was not created`);
    fsyncDirectoryChecked(io, path.dirname(dir), `The parent of ${label}`);
  }
  return assertOwnedDirectory(stat, label);
}

function createOwnedDirectory(io, dir, label) {
  if (lstatOrMissing(io, dir) !== null) throw siteAttemptError(`${label} already exists`);
  try {
    io.mkdirSync(dir, DIRECTORY_MODE);
  } catch (error) {
    throw attemptFailure(`${label} could not be created`, error);
  }
  const stat = lstatOrMissing(io, dir);
  if (stat === null) throw siteAttemptError(`${label} was not created`);
  assertOwnedDirectory(stat, label);
  fsyncDirectoryChecked(io, path.dirname(dir), `The parent of ${label}`);
  return dir;
}

function writeOwnedFile(io, target, bytes, mode, label) {
  let fd = null;
  let owned = false;
  try {
    fd = io.openSync(target, 'wx', mode);
    owned = true;
    io.writeFileSync(fd, bytes);
    const written = io.fstatSync(fd);
    if (!written.isFile() || written.size !== bytes.length) {
      throw siteAttemptError(`${label} was written incompletely`);
    }
    io.fsyncSync(fd);
    const handle = fd;
    fd = null;
    try {
      io.closeSync(handle);
    } catch (error) {
      throw attemptFailure(`${label} could not be closed`, error);
    }
  } catch (error) {
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch {
        fd = null;
      }
    }
    if (owned) {
      try {
        io.unlinkSync(target);
      } catch {
        owned = false;
      }
    }
    throw attemptFailure(`${label} could not be written`, error);
  }
}

function materializeFiles(io, root, files) {
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      dir = path.join(dir, parts[index]);
      ensureOwnedDirectory(io, dir, `A site snapshot directory: ${parts.slice(0, index + 1).join('/')}`);
    }
    writeOwnedFile(io, path.join(root, ...parts), file.bytes, file.mode, `A site snapshot file: ${file.path}`);
  }
}

function flushTree(io, dir) {
  let names;
  try {
    names = io.readdirSync(dir);
  } catch (error) {
    throw attemptFailure('A site snapshot directory is not readable', error);
  }
  if (!Array.isArray(names)) throw siteAttemptError('A site snapshot directory is not readable');
  for (const name of names.slice().sort()) {
    const target = path.join(dir, name);
    const stat = lstatOrMissing(io, target);
    if (stat === null) throw siteAttemptError('A site snapshot entry changed while it was flushed');
    if (stat.isSymbolicLink()) throw siteAttemptError('A site snapshot must not hold a symlink');
    if (stat.isDirectory()) flushTree(io, target);
  }
  fsyncDirectoryChecked(io, dir, 'A site snapshot directory');
}

function prepareAttemptDirectory(repoDir, state, attemptId, io) {
  let current = repoDir;
  for (const segment of [RECORDS_DIR, state.releaseId, SITE_DIR]) {
    current = path.join(current, segment);
    ensureOwnedDirectory(io, current, 'A site evidence directory');
  }
  const attemptDir = path.join(current, attemptId);
  createOwnedDirectory(io, attemptDir, 'The site attempt directory');
  return attemptDir;
}

function publishSnapshot(io, { repoRoot, sourceSha, treeSha, attemptDir, files, run }) {
  const pendingDir = path.join(attemptDir, SNAPSHOT_STAGING_NAME);
  const snapshotDir = path.join(attemptDir, SNAPSHOT_NAME);
  createOwnedDirectory(io, pendingDir, 'The site snapshot staging directory');
  materializeFiles(io, pendingDir, files);
  flushTree(io, pendingDir);
  verifySiteSnapshot({ repoRoot, sourceSha, treeSha, snapshotDir: pendingDir }, { run, fs: io });
  if (lstatOrMissing(io, snapshotDir) !== null) throw siteAttemptError('The site snapshot already exists');
  try {
    io.renameSync(pendingDir, snapshotDir);
  } catch (error) {
    throw attemptFailure('The site snapshot could not be published', error);
  }
  fsyncDirectoryChecked(io, attemptDir, 'The site attempt directory');
  return snapshotDir;
}

function publishDescriptor(io, attemptDir, descriptor) {
  const payload = Buffer.from(`${JSON.stringify(descriptor)}\n`, 'utf8');
  try {
    publishDurableFile(path.join(attemptDir, DESCRIPTOR_FILE), payload, io);
  } catch (error) {
    throw attemptFailure('The site descriptor could not be published', error);
  }
}

function defaultDeploy(deployDir) {
  execFileCaptured('npx', ['wrangler', 'deploy'], {
    cwd: deployDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function resolveRunDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  const resolved = resolveDeps(provided);
  const deploy = provided.deploy === undefined || provided.deploy === null ? defaultDeploy : provided.deploy;
  const assertPublishWindow = provided.assertPublishWindow;
  if (typeof deploy !== 'function') throw siteAttemptError('Site deployment must be a function');
  if (typeof assertPublishWindow !== 'function') {
    throw siteAttemptError('Site deployment requires a publish window guard');
  }
  return { ...resolved, deploy, assertPublishWindow };
}

function digestOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sameReceipt(left, right) {
  if (left === null || right === null) return left === right;
  return left.sha256 === right.sha256 && left.bytes.equals(right.bytes);
}

function receiptFile(root) {
  return path.join(root, RECEIPT_NAME);
}

function readLiveReceipt(state, resolved) {
  let bytes;
  try {
    bytes = readBoundedOrdinaryFile(receiptFile(state.repo.root), {
      maxBytes: RECEIPT_MAX_BYTES, missing: true, fs: resolved.io
    });
  } catch (error) {
    throw attemptFailure('The live site receipt is not readable', error);
  }
  if (bytes === null) return null;
  const length = state.repo.objectFormat === 'sha256' ? 64 : 40;
  const text = bytes.toString('latin1');
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (body.length !== length || !HEX_PATTERN.test(body)) {
    throw siteAttemptError('The live site receipt is not one recorded object identifier');
  }
  return { bytes, sha256: digestOf(bytes), oid: body };
}

function requireSameReceipt(current, preimage, message) {
  if (!sameReceipt(current, preimage)) throw siteAttemptError(message);
}

function flushOrdinaryFile(io, target, label) {
  const constants = io.constants === undefined || io.constants === null ? fs.constants : io.constants;
  let fd = null;
  let primary = null;
  try {
    fd = io.openSync(target, constants.O_RDONLY);
    io.fsyncSync(fd);
  } catch (error) {
    primary = attemptFailure(`${label} could not be flushed`, error);
  }
  if (fd !== null) {
    try {
      io.closeSync(fd);
    } catch (error) {
      if (primary === null) primary = attemptFailure(`${label} could not be closed`, error);
    }
  }
  if (primary !== null) throw primary;
}

function flushReceipt(io, target, label) {
  flushOrdinaryFile(io, target, label);
  fsyncDirectoryChecked(io, path.dirname(target), `The parent of ${label}`);
}

function requireSiteTuple(state, descriptor) {
  if (descriptor.sourceSha !== state.site.sourceSha || descriptor.treeSha !== state.site.treeSha ||
      descriptor.attemptId !== state.site.attemptId) {
    throw siteAttemptError('The retained site descriptor is not the recorded site attempt');
  }
}

function requireRetainedAttempt(state, repoDir, resolved) {
  let attempt;
  try {
    attempt = readSiteAttempt({ state, repoDir }, { run: resolved.run, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('The retained site attempt is not verifiable', error);
  }
  requireSiteTuple(state, attempt.descriptor);
  return attempt;
}

function checkpointSite(state, repoDir, result, at, resolved) {
  const next = transitionRelease(state, {
    type: 'target-observed', target: 'site', at, result
  }, state.repo, { repoDir });
  const cacheRoot = path.dirname(repoDir);
  writeReleaseState(next, state.repo, {
    cacheRoot, expectedRevision: state.revision, fs: resolved.io
  });
  const stored = readReleaseState(state.repo, { cacheRoot, fs: resolved.io });
  if (JSON.stringify(stored) !== JSON.stringify(next)) {
    throw siteAttemptError('Site checkpoint does not match the persisted release state');
  }
  return stored;
}

function persistSiteCheckpoint(state, repoDir, result, at, resolved, label) {
  try {
    return checkpointSite(state, repoDir, result, at, resolved);
  } catch (error) {
    throw attemptFailure(`${label} could not persist the site checkpoint`, error);
  }
}

function unresolvedSiteResult(descriptor) {
  return {
    state: 'unknown',
    sourceSha: descriptor.sourceSha,
    treeSha: descriptor.treeSha,
    attemptId: descriptor.attemptId,
    receiptSha: null,
    verifiedAt: null,
    error: { code: SITE_DEPLOY_UNRESOLVED.code, message: SITE_DEPLOY_UNRESOLVED.message }
  };
}

function completedSiteResult(descriptor, receiptSha, verifiedAt) {
  return {
    state: 'complete',
    sourceSha: descriptor.sourceSha,
    treeSha: descriptor.treeSha,
    attemptId: descriptor.attemptId,
    receiptSha,
    verifiedAt,
    error: null
  };
}

function prepareDeployDirectory(io, { repoRoot, sourceSha, treeSha, attemptDir, files, run }) {
  const deployDir = path.join(attemptDir, DEPLOY_DIR);
  createOwnedDirectory(io, deployDir, 'The site deployment directory');
  materializeFiles(io, deployDir, files);
  flushTree(io, deployDir);
  verifySiteSnapshot({ repoRoot, sourceSha, treeSha, snapshotDir: deployDir }, { run, fs: io });
  return deployDir;
}

function verifyDeployedCopy(state, descriptor, deployDir, resolved) {
  const metadata = path.join(deployDir, WRANGLER_DIR);
  const stat = lstatOrMissing(resolved.io, metadata);
  if (stat !== null) assertOwnedDirectory(stat, 'The Wrangler working directory');
  const postIo = Object.create(resolved.io);
  postIo.readdirSync = (dir) => {
    const names = resolved.io.readdirSync(dir);
    return dir === deployDir ? names.filter((name) => name !== WRANGLER_DIR) : names;
  };
  try {
    verifySiteSnapshot({
      repoRoot: state.repo.root,
      sourceSha: descriptor.sourceSha,
      treeSha: descriptor.treeSha,
      snapshotDir: deployDir
    }, { run: resolved.run, fs: postIo });
  } catch (error) {
    throw attemptFailure('The deployed site copy changed while it was deployed', error);
  }
}

function latestTimestamp(left, right) {
  if (right === null || right === undefined) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function requireRecordedSiteTarget(state, label) {
  if (state.site.sourceSha === null || state.site.treeSha === null || state.site.attemptId === null) {
    throw siteAttemptError(`${label} requires the recorded site attempt tuple`);
  }
}

function runSiteAttempt(input, deps) {
  const resolved = resolveRunDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const state = request.state;
  const repoDir = request.repoDir;
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || CONTROL_PATTERN.test(repoDir)) {
    throw siteAttemptError('Site deployment needs the release cache directory');
  }

  const validated = requireActingState(state, repoDir, resolved).state;
  if (validated.phase !== 'tail') throw siteAttemptError('Site deployment requires a tail release phase');
  if (validated.artifacts.state !== 'complete') {
    throw siteAttemptError('Site deployment requires verified publish artifacts');
  }
  if (validated.sizes.state !== 'complete' || validated.sizes.commit === null) {
    throw siteAttemptError('Site deployment requires the completed size source');
  }
  if (validated.site.state !== 'pending') {
    throw siteAttemptError(`Site deployment requires a pending site target, found ${validated.site.state}`);
  }
  requireRecordedSiteTarget(validated, 'Site deployment');

  const attempt = requireRetainedAttempt(validated, repoDir, resolved);
  const descriptor = attempt.descriptor;
  if (descriptor.phase !== 'prepared') {
    throw siteAttemptError('Site deployment requires the prepared site descriptor');
  }

  let committed;
  try {
    committed = readCommittedSite({ repoRoot: validated.repo.root, sourceSha: descriptor.sourceSha }, { run: resolved.run });
  } catch (error) {
    throw attemptFailure('Site deployment could not read the committed site subtree', error);
  }
  if (committed.treeSha !== descriptor.treeSha) {
    throw siteAttemptError('The committed site subtree is not the recorded site tree');
  }

  const at = requireClock(resolved.now, validated.updatedAt);
  let deployDir;
  try {
    deployDir = prepareDeployDirectory(resolved.io, {
      repoRoot: validated.repo.root,
      sourceSha: descriptor.sourceSha,
      treeSha: committed.treeSha,
      attemptDir: attempt.attemptDir,
      files: committed.files,
      run: resolved.run
    });
  } catch (error) {
    throw attemptFailure('Site deployment could not materialize the deployment copy', error);
  }

  const preimage = readLiveReceipt(validated, resolved);

  publishDescriptor(resolved.io, attempt.attemptDir, {
    ...descriptor,
    phase: 'requested',
    requestedAt: at,
    receiptBeforeSha256: preimage === null ? null : preimage.sha256
  });

  const unknown = persistSiteCheckpoint(
    validated, repoDir, unresolvedSiteResult(descriptor), at, resolved, 'Site deployment'
  );

  const confirmed = requireActingState(unknown, repoDir, resolved).state;
  const requested = requireRetainedAttempt(confirmed, repoDir, resolved);
  if (requested.descriptor.phase !== 'requested') {
    throw siteAttemptError('The recorded site request did not persist before the deployment');
  }
  try {
    verifySiteSnapshot({
      repoRoot: confirmed.repo.root,
      sourceSha: requested.descriptor.sourceSha,
      treeSha: requested.descriptor.treeSha,
      snapshotDir: deployDir
    }, { run: resolved.run, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('The site deployment copy changed before the deployment', error);
  }
  requireSameReceipt(
    readLiveReceipt(confirmed, resolved), preimage, 'The live site receipt changed before the deployment'
  );

  resolved.assertPublishWindow();
  let result;
  try {
    result = resolved.deploy(deployDir);
  } catch (error) {
    const failure = siteAttemptError('The site deployment outcome is unresolved', error);
    failure.code = 'SITE_DEPLOY_UNRESOLVED';
    throw failure;
  }
  if (result !== undefined) {
    throw siteAttemptError('Site deployment must complete synchronously without a return value');
  }

  verifyDeployedCopy(confirmed, requested.descriptor, deployDir, resolved);
  const retained = requireRetainedAttempt(confirmed, repoDir, resolved);

  const current = requireActingState(confirmed, repoDir, resolved).state;
  requireSameReceipt(
    readLiveReceipt(current, resolved), preimage, 'The live site receipt changed while the site was deployed'
  );

  const completedAt = requireClock(resolved.now, confirmed.updatedAt);
  try {
    publishDurableFile(receiptFile(current.repo.root), Buffer.from(`${descriptor.sourceSha}\n`, 'utf8'), resolved.io);
  } catch (error) {
    throw attemptFailure('The captured site receipt could not be published', error);
  }

  publishDescriptor(resolved.io, attempt.attemptDir, {
    ...retained.descriptor,
    phase: 'complete',
    completedAt,
    receiptSha: descriptor.sourceSha
  });

  return persistSiteCheckpoint(
    current, repoDir, completedSiteResult(descriptor, descriptor.sourceSha, completedAt), completedAt, resolved, 'Site deployment'
  );
}

function reconcileSiteAttempt(input, deps) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const state = request.state;
  const repoDir = request.repoDir;
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || CONTROL_PATTERN.test(repoDir)) {
    throw siteAttemptError('Site reconciliation needs the release cache directory');
  }

  const validated = requireActingState(state, repoDir, resolved).state;
  if (validated.phase !== 'tail' && validated.phase !== 'complete') {
    throw siteAttemptError('Site reconciliation requires a tail release phase');
  }
  if (validated.artifacts.state !== 'complete') {
    throw siteAttemptError('Site reconciliation requires verified publish artifacts');
  }
  if (validated.sizes.state !== 'complete' || validated.sizes.commit === null) {
    throw siteAttemptError('Site reconciliation requires the completed size source');
  }
  requireRecordedSiteTarget(validated, 'Site reconciliation');

  const attempt = requireRetainedAttempt(validated, repoDir, resolved);
  const descriptor = attempt.descriptor;
  const receipt = readLiveReceipt(validated, resolved);

  if (descriptor.phase === 'prepared') {
    if (validated.site.state !== 'pending') {
      throw siteAttemptError('A prepared site descriptor cannot reconcile a resolved site target');
    }
    return validated;
  }

  if (validated.site.state === 'complete') {
    if (descriptor.phase !== 'complete' || descriptor.receiptSha !== descriptor.sourceSha ||
        validated.site.receiptSha !== descriptor.receiptSha ||
        validated.site.verifiedAt !== descriptor.completedAt) {
      throw siteAttemptError('The completed site target does not match the retained site descriptor');
    }
    if (receipt === null || receipt.oid !== descriptor.receiptSha) {
      throw siteAttemptError('The completed site receipt changed');
    }
    return validated;
  }

  if (descriptor.phase === 'complete') {
    if (receipt === null || descriptor.receiptSha !== descriptor.sourceSha || receipt.oid !== descriptor.receiptSha) {
      throw siteAttemptError('The completed site descriptor does not match the live receipt');
    }
    flushOrdinaryFile(resolved.io, path.join(attempt.attemptDir, DESCRIPTOR_FILE), 'The retained site descriptor');
    fsyncDirectoryChecked(resolved.io, attempt.attemptDir, 'The site attempt directory');
    const again = readLiveReceipt(validated, resolved);
    requireSameReceipt(again, receipt, 'The live site receipt changed while it was flushed');
    const at = requireClock(resolved.now, validated.updatedAt);
    return persistSiteCheckpoint(
      validated, repoDir,
      completedSiteResult(descriptor, descriptor.receiptSha, descriptor.completedAt),
      at, resolved, 'Site reconciliation'
    );
  }

  if (receipt !== null && receipt.oid === descriptor.sourceSha && receipt.sha256 !== descriptor.receiptBeforeSha256) {
    flushReceipt(resolved.io, receiptFile(validated.repo.root), 'The live site receipt');
    const again = readLiveReceipt(validated, resolved);
    requireSameReceipt(again, receipt, 'The live site receipt changed while it was flushed');
    const at = requireClock(resolved.now, latestTimestamp(validated.updatedAt, descriptor.requestedAt));
    publishDescriptor(resolved.io, attempt.attemptDir, {
      ...descriptor,
      phase: 'complete',
      completedAt: at,
      receiptSha: descriptor.sourceSha
    });
    return persistSiteCheckpoint(
      validated, repoDir, completedSiteResult(descriptor, descriptor.sourceSha, at), at, resolved, 'Site reconciliation'
    );
  }

  if (validated.site.state === 'unknown') return validated;

  const at = requireClock(resolved.now, validated.updatedAt);
  return persistSiteCheckpoint(
    validated, repoDir, unresolvedSiteResult(descriptor), at, resolved, 'Site reconciliation'
  );
}

function prepareSiteAttempt(input, deps) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const state = request.state;
  const repoDir = request.repoDir;
  const attemptId = request.attemptId;
  const retrySite = request.retrySite === undefined ? false : request.retrySite;
  if (typeof retrySite !== 'boolean') throw siteAttemptError('Site attempt retrySite must be a boolean');
  if (typeof attemptId !== 'string' || !UUID_PATTERN.test(attemptId)) {
    throw siteAttemptError('Site attempt needs a fresh attempt identifier');
  }
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || CONTROL_PATTERN.test(repoDir)) {
    throw siteAttemptError('Site attempt needs the release cache directory');
  }

  const acting = requireActingState(state, repoDir, resolved);
  const validated = acting.state;
  if (validated.phase !== 'tail') throw siteAttemptError('Site preparation requires a tail release phase');
  if (validated.artifacts.state !== 'complete') {
    throw siteAttemptError('Site preparation requires verified publish artifacts');
  }

  selectAttempt(validated, repoDir, { attemptId, retrySite }, resolved);

  let size;
  try {
    size = readSizeEvidence({ state: validated, repoDir }, { run: resolved.run, spawn: resolved.spawn, fs: resolved.io });
  } catch (error) {
    throw attemptFailure('Site preparation could not verify the retained size evidence', error);
  }
  if (!isPlainRecord(size) || size.commit !== validated.sizes.commit) {
    throw siteAttemptError('Site preparation did not verify the recorded size commit');
  }
  const sourceSha = size.commit;

  const at = requireClock(resolved.now, validated.updatedAt);
  const committed = readCommittedSite({ repoRoot: validated.repo.root, sourceSha }, { run: resolved.run });
  const attemptDir = prepareAttemptDirectory(repoDir, validated, attemptId, resolved.io);
  const snapshotDir = publishSnapshot(resolved.io, {
    repoRoot: validated.repo.root,
    sourceSha,
    treeSha: committed.treeSha,
    attemptDir,
    files: committed.files,
    run: resolved.run
  });

  publishDescriptor(resolved.io, attemptDir, {
    schema: DESCRIPTOR_SCHEMA,
    releaseId: validated.releaseId,
    version: validated.version,
    attemptId,
    sourceSha,
    treeSha: committed.treeSha,
    snapshotDir,
    phase: 'prepared',
    requestedAt: null,
    completedAt: null,
    receiptSha: null,
    receiptBeforeSha256: null
  });

  const result = {
    state: 'pending',
    sourceSha,
    treeSha: committed.treeSha,
    attemptId,
    receiptSha: null,
    verifiedAt: null,
    error: null
  };
  let next;
  try {
    next = transitionRelease(validated, {
      type: 'target-observed',
      target: 'site',
      at,
      result
    }, validated.repo, { repoDir });
  } catch (error) {
    throw attemptFailure('Site preparation could not checkpoint the site target', error);
  }
  try {
    return writeReleaseState(next, validated.repo, {
      cacheRoot: acting.cacheRoot,
      expectedRevision: validated.revision,
      fs: resolved.io
    });
  } catch (error) {
    throw attemptFailure('Site preparation could not persist the site checkpoint', error);
  }
}

module.exports = { prepareSiteAttempt, runSiteAttempt, reconcileSiteAttempt };
