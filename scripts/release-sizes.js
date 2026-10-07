'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { execFileCaptured } = require('./release-command');
const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState, writeReleaseState, fsyncDirectory } = require('./release-state-store');
const { transitionRelease } = require('./release-transitions');
const { readPublicationEvidence } = require('./release-publication');
const { prepareDownloadSizes } = require('./release-docs-prepare');
const { prepareDocsApplication, verifyDocsApplication, readPreparedTarget } = require('./release-docs-plan');
const { prepareCommitIntent, reconcileTarget, reconcileTargetPush } = require('./release-docs-apply');
const { readTargetEvidence } = require('./release-target-evidence');
const { readSizeEvidence } = require('./release-size-evidence');
const { withFerryRepoLock } = require('./release-ferry');

const localReader = createLocalGitReader();
const REPO = 'hyperclay-local';
const SELECTED = ['README.md', 'website/index.html'];
const IDENTITY_KEYS = ['key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'];
const OBJECT_KEYS = ['key', 'root', 'commonDir', 'objectFormat'];
const ORDINARY = new Map([
  ['DOCS_PREIMAGE_CONFLICT', 'conflict'],
  ['DOCS_LOCAL_CONFLICT', 'conflict'],
  ['DOCS_REMOTE_CONTENT_CONFLICT', 'conflict'],
  ['DOCS_REMOTE_DIVERGED', 'conflict'],
  ['DOCS_APPLY_NOT_FINISHED', 'pending'],
  ['DOCS_REMOTE_UNREADABLE', 'pending-push'],
  ['DOCS_REMOTE_OBJECT_MISSING', 'pending-push'],
  ['DOCS_REMOTE_HISTORY_UNRESOLVED', 'pending-push'],
  ['DOCS_REMOTE_PUSH_FAILED', 'pending-push'],
  ['DOCS_REMOTE_PUSH_UNCONFIRMED', 'pending-push']
]);

function failure(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined) error.cause = cause;
  return error;
}

function invalid(message) {
  return failure('RELEASE_SIZES_INVALID', message);
}

function requireValue(condition, message) {
  if (!condition) throw invalid(message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left, right) {
  return isDeepStrictEqual(left, right);
}

function resolveDeps(deps = {}) {
  requireValue(object(deps), 'Size dependencies must be an object');
  const d = {
    run: deps.run === undefined ? execFileCaptured : deps.run,
    spawn: deps.spawn === undefined ? childProcess.spawnSync : deps.spawn,
    readRun: deps.readRun === undefined ? localReader.run : deps.readRun,
    readSpawn: deps.readSpawn === undefined ? localReader.spawn : deps.readSpawn,
    spawnRemote: deps.spawnRemote === undefined ? childProcess.spawnSync : deps.spawnRemote,
    io: deps.fs === undefined ? fs : deps.fs,
    now: deps.now === undefined ? () => Date.now() : deps.now,
    randomUUID: deps.randomUUID === undefined ? () => crypto.randomUUID() : deps.randomUUID,
    ferry: deps.withFerryRepoLock === undefined ? withFerryRepoLock : deps.withFerryRepoLock,
    ferryOptions: deps.ferryOptions === undefined ? {} : deps.ferryOptions,
    guard: deps.assertPublishWindow
  };
  for (const key of ['run', 'spawn', 'readRun', 'readSpawn', 'spawnRemote', 'now', 'randomUUID', 'ferry']) {
    requireValue(typeof d[key] === 'function', `Size dependency ${key} must be callable`);
  }
  requireValue(object(d.io), 'Size filesystem must be an object');
  d.reads = { run: d.readRun, spawn: d.readSpawn, fs: d.io };
  return d;
}

function stamp(d) {
  const value = d.now();
  requireValue(typeof value === 'number' && Number.isFinite(value), 'Size clock must return milliseconds');
  const date = new Date(value);
  requireValue(!Number.isNaN(date.getTime()), 'Size clock must return a valid timestamp');
  return date.toISOString();
}

function layout(repoDir, releaseId) {
  const releaseDir = path.join(repoDir, 'records', releaseId);
  const root = path.join(releaseDir, 'sizes');
  const prepareDir = path.join(root, 'prepare');
  const applyDir = path.join(root, 'apply');
  return {
    repoDir, releaseDir, root, prepareDir, applyDir,
    preparedFile: path.join(prepareDir, 'prepared.json'),
    applicationFile: path.join(applyDir, 'application.json'),
    journalFile: path.join(applyDir, 'target.json'),
    patchFile: path.join(applyDir, 'candidate.patch'),
    privateIndexFile: path.join(applyDir, 'index')
  };
}

function snapshotFile(p, side, rel) {
  return path.join(p.prepareDir, REPO, side, rel);
}

function statOrMissing(file, d) {
  try { return d.io.lstatSync(file); }
  catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function directory(dir, d, allowMissing = false) {
  const stat = statOrMissing(dir, d);
  if (stat === null && allowMissing) return false;
  requireValue(stat !== null && stat.isDirectory() && !stat.isSymbolicLink(), `Size directory is not ordinary: ${dir}`);
  requireValue((stat.mode & 0o7022) === 0, `Size directory has unsafe write permissions or special mode bits: ${dir}`);
  return true;
}

function requireParents(p, d) {
  for (const dir of [path.dirname(p.repoDir), p.repoDir, path.join(p.repoDir, 'records'), p.releaseDir]) {
    directory(dir, d);
  }
}

function flushDir(dir, d) {
  try { fsyncDirectory(dir, d.io); }
  catch (cause) { throw failure('RELEASE_SIZES_IO_FAILED', `Cannot flush size directory: ${dir}`, cause); }
}

function createRoot(p, d) {
  requireParents(p, d);
  if (directory(p.root, d, true)) return;
  try { d.io.mkdirSync(p.root, { mode: 0o700 }); }
  catch (cause) { throw failure('RELEASE_SIZES_IO_FAILED', 'Cannot create size evidence directory', cause); }
  directory(p.root, d);
  flushDir(p.releaseDir, d);
}

function leaf(p, file, d) {
  requireValue(typeof file === 'string' && path.isAbsolute(file) && path.normalize(file) === file
    && !/[\u0000-\u001f\u007f]/.test(file), 'Size evidence path is not canonical');
  const rel = path.relative(p.root, file);
  requireValue(rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel),
    'Size evidence escaped its fixed directory');
  requireParents(p, d);
  directory(p.root, d);
  let dir = p.root;
  for (const part of rel.split(path.sep).slice(0, -1)) {
    dir = path.join(dir, part);
    directory(dir, d);
  }
  const stat = statOrMissing(file, d);
  requireValue(stat !== null && stat.isFile() && !stat.isSymbolicLink(), `Size evidence is not an ordinary file: ${file}`);
  return stat;
}

function record(p, file, d) {
  leaf(p, file, d);
  const bytes = readBoundedOrdinaryFile(file, { maxBytes: 8 * 1024 * 1024, fs: d.io });
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch (cause) { throw failure('RELEASE_SIZES_INVALID', 'Size evidence is not JSON', cause); }
  requireValue(object(value), 'Size evidence must be an object');
  return value;
}

function binding(state) {
  return {
    manifestFile: state.artifacts.manifestFile,
    manifestSha256: state.artifacts.manifestSha256,
    sourceSha: state.sourceSha
  };
}

function readPrepared(state, p, d) {
  const raw = record(p, p.preparedFile, d);
  requireValue(raw.runDir === p.prepareDir && Array.isArray(raw.targets) && raw.targets.length === 1,
    'Size descriptor must use the fixed prepare directory and one target');
  const target = raw.targets[0];
  requireValue(object(target) && Array.isArray(target.paths), 'Size descriptor target is malformed');
  requireValue(equal(target.paths.map(entry => entry && entry.path), SELECTED), 'Size descriptor must select exactly two size files');
  requireValue(equal(target.publication, binding(state)) && !Object.hasOwn(target, 'versionPreparation'),
    'Size descriptor must preserve the recorded publication binding');
  for (const entry of target.paths) {
    requireValue(object(entry) && entry.beforeFile === snapshotFile(p, 'before', entry.path)
      && entry.afterFile === snapshotFile(p, 'after', entry.path), 'Size snapshots must use the fixed retained paths');
    leaf(p, entry.beforeFile, d);
    leaf(p, entry.afterFile, d);
  }
  const prepared = readPreparedTarget(p.preparedFile, { repo: REPO, version: state.version });
  requireValue(equal(prepared.prepared, raw), 'Size descriptor changed during validation');
  requireValue(prepared.target.repoRoot === state.repo.root && prepared.target.sourcePath === SELECTED[0]
    && prepared.target.oldVersion === state.version, 'Size descriptor target identity is wrong');
  return prepared;
}

function applicationFiles(p, app) {
  return [p.preparedFile, p.applicationFile, p.patchFile, p.privateIndexFile,
    ...app.files.flatMap(file => [file.beforeFile, file.afterFile])];
}

function readApplication(state, p, d) {
  const raw = record(p, p.applicationFile, d);
  requireValue(raw.repo === REPO && raw.repoRoot === state.repo.root && raw.version === state.version
    && raw.sourcePath === SELECTED[0] && raw.preparedFile === p.preparedFile
    && raw.patchFile === p.patchFile && raw.privateIndexFile === p.privateIndexFile
    && equal(raw.requiredPaths, SELECTED), 'Size application must use the fixed target and layout');
  requireValue(Array.isArray(raw.files) && equal(raw.files.map(file => file && file.path), SELECTED),
    'Size application must retain exactly two selected files');
  for (const file of raw.files) {
    requireValue(object(file) && file.beforeFile === snapshotFile(p, 'before', file.path)
      && file.afterFile === snapshotFile(p, 'after', file.path), 'Size application snapshots escaped the fixed layout');
  }
  for (const file of applicationFiles(p, raw)) leaf(p, file, d);
  const prepared = readPrepared(state, p, d);
  const app = verifyDocsApplication(p.applicationFile, { run: d.readRun, spawn: d.readSpawn });
  const { applicationFile, ...verified } = app;
  requireValue(applicationFile === p.applicationFile && equal(verified, raw)
    && app.preparedSha256 === prepared.sha256, 'Size application changed during validation');
  return app;
}

function flushFile(p, file, d) {
  const before = leaf(p, file, d);
  const constants = d.io.constants || fs.constants;
  let fd = null;
  let primary = null;
  try {
    fd = d.io.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = d.io.fstatSync(fd);
    requireValue(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino,
      'Size evidence changed while opening for flush');
    d.io.fsyncSync(fd);
  } catch (cause) {
    primary = cause && cause.code === 'RELEASE_SIZES_INVALID' ? cause
      : failure('RELEASE_SIZES_IO_FAILED', 'Cannot flush retained size evidence', cause);
  }
  if (fd !== null) {
    try { d.io.closeSync(fd); }
    catch (cause) {
      if (primary === null) primary = failure('RELEASE_SIZES_IO_FAILED', 'Cannot close retained size evidence', cause);
      else primary.closeError = cause;
    }
  }
  if (primary !== null) throw primary;
}

function flushEvidence(p, app, d) {
  const dirs = new Set();
  for (const file of applicationFiles(p, app)) {
    flushFile(p, file, d);
    let dir = path.dirname(file);
    for (;;) {
      dirs.add(dir);
      if (dir === p.repoDir) break;
      dir = path.dirname(dir);
    }
  }
  for (const dir of [...dirs].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)) {
    flushDir(dir, d);
  }
}

function loadCurrent(state, p, d) {
  const loaded = readReleaseState(state.repo, { cacheRoot: path.dirname(p.repoDir), mode: 'publish', fs: d.io });
  requireValue(loaded !== null && equal(loaded, state), 'Size caller state is stale');
  return loaded;
}

function requireActing(state, p, d) {
  requireValue(typeof d.guard === 'function', 'Acting size reconciliation requires a work-window guard');
  loadCurrent(state, p, d);
  const identity = resolveRepoIdentity(state.repo.root, {
    fs: d.io, readGit: (root, args) => d.readRun('git', args, { cwd: root }).trim()
  });
  for (const key of IDENTITY_KEYS) {
    requireValue(identity[key] === state.repo[key], `Size acting identity changed: ${key}`);
  }
}

function readJournal(state, p, d) {
  if (statOrMissing(p.journalFile, d) === null) {
    requireValue(state.sizes.commit === null, 'Recorded size commit has lost its journal');
    return null;
  }
  const raw = record(p, p.journalFile, d);
  requireValue(raw.applicationFile === p.applicationFile && raw.preparedFile === p.preparedFile
    && raw.repo === REPO && raw.repoRoot === state.repo.root && raw.repoKey === state.repo.key
    && raw.version === state.version && raw.pushUrlSha256 === state.repo.pushUrlSha256,
    'Size journal identity or evidence references changed');
  const evidence = readTargetEvidence(p.journalFile, d.reads);
  requireValue(equal(evidence.journal, raw), 'Size journal changed during validation');
  for (const key of OBJECT_KEYS) {
    requireValue(evidence.objectStore[key] === state.repo[key], 'Size journal uses another object store');
  }
  requireValue(state.sizes.commit === null || state.sizes.commit === raw.commit,
    'Size journal replaced its recorded commit');
  return evidence.journal;
}

function complete(journal) {
  return journal !== null && journal.phase === 'complete' && journal.state === 'complete' && journal.reason === null;
}

function persist(state, p, result, d) {
  loadCurrent(state, p, d);
  const next = transitionRelease(state, { type: 'target-observed', target: 'sizes', at: stamp(d), result },
    state.repo, { repoDir: p.repoDir });
  writeReleaseState(next, state.repo, {
    cacheRoot: path.dirname(p.repoDir), expectedRevision: state.revision, fs: d.io
  });
  const acknowledged = readReleaseState(state.repo, {
    cacheRoot: path.dirname(p.repoDir), mode: 'publish', fs: d.io
  });
  requireValue(acknowledged !== null && equal(acknowledged, JSON.parse(JSON.stringify(next))),
    'Size checkpoint acknowledgement differs from the requested state');
  return acknowledged;
}

function finish(state, p, journal, d) {
  requireValue(complete(journal), 'Size completion requires a completed journal');
  const result = { state: 'complete', journalFile: p.journalFile, commit: journal.commit, reason: null };
  const proposed = JSON.parse(JSON.stringify({ ...state, sizes: result }));
  readSizeEvidence({ state: proposed, repoDir: p.repoDir }, d.reads);
  const acknowledged = persist(state, p, result, d);
  readSizeEvidence({ state: acknowledged, repoDir: p.repoDir }, d.reads);
  return { state: acknowledged, error: null };
}

function ordinary(error) {
  if (!error || !ORDINARY.has(error.code)) return false;
  const seen = new Set();
  let item = error;
  while (object(item) && !seen.has(item)) {
    seen.add(item);
    if (item.cleanupError != null || item.closeError != null) return false;
    const code = typeof item.code === 'string' ? item.code : '';
    if (/^(?:STATE_|REPO_|RELEASE_|PUBLICATION_|SIZE_EVIDENCE_|FERRY_|LOCAL_EVIDENCE_)/.test(code)
      || /(?:_LOCK_|_DEPS_INVALID$|_JOURNAL_WRITE_FAILED$|_JOURNAL_INVALID$|_APPLICATION_INVALID$|_TARGET_IDENTITY_INVALID$)/.test(code)
      || code === 'DOCS_HISTORY_UNRESOLVED' || code === 'DOCS_PUBLISH_WINDOW_CLOSED'
      || /^(?:EACCES|EPERM|EIO|ENOSPC|EROFS|EMFILE|ENFILE|ENOENT|ENOTDIR|ELOOP)$/.test(code)) return false;
    item = item.cause;
  }
  return true;
}

function targetFailure(state, p, error, d) {
  requireActing(state, p, d);
  readPublicationEvidence({ state, repoDir: p.repoDir }, d.reads);
  readApplication(state, p, d);
  const journal = readJournal(state, p, d);
  requireValue(!complete(journal), 'An ordinary size error contradicts a completed journal');
  const code = error.code;
  requireValue(ORDINARY.get(code) !== 'pending-push' || (journal !== null && journal.commit !== null),
    'Pending size push requires a retained commit');
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message.slice(0, 4096) : code;
  const result = {
    state: ORDINARY.get(code), journalFile: p.journalFile,
    commit: journal === null ? null : journal.commit,
    reason: { code, message }
  };
  return { state: persist(state, p, result, d), error };
}

async function reconcileReleaseSizes(input, deps) {
  requireValue(object(input), 'Size input must be an object');
  const d = resolveDeps(deps);
  const { repoDir } = input;
  requireValue(typeof repoDir === 'string' && path.isAbsolute(repoDir) && path.normalize(repoDir) === repoDir
    && !/[\u0000-\u001f\u007f]/.test(repoDir), 'Size cache directory must be canonical');
  requireValue(object(input.state) && object(input.state.repo), 'Size input requires release state');
  validateReleaseState(input.state, input.state.repo, { repoDir });
  let state = JSON.parse(JSON.stringify(input.state));
  requireValue(state.mode === 'publish' && ['tail', 'complete'].includes(state.phase)
    && state.artifacts.state === 'complete', 'Sizes require verified publish artifacts and tail state');
  requireValue(path.basename(state.repo.root) === REPO, 'Sizes require the hyperclay-local checkout');
  requireValue(statePaths(state.repo, { cacheRoot: path.dirname(repoDir), fs: d.io }).repoDir === repoDir,
    'Size cache directory does not match its repository');
  const p = layout(repoDir, state.releaseId);
  state = loadCurrent(state, p, d);
  readPublicationEvidence({ state, repoDir }, d.reads);
  requireValue(state.sizes.journalFile === null || state.sizes.journalFile === p.journalFile,
    'Sizes must use the fixed journal path');
  if (state.sizes.state === 'complete') {
    readSizeEvidence({ state, repoDir }, d.reads);
    return { state, error: null };
  }
  requireValue(state.phase === 'tail', 'Only an incomplete tail can reconcile sizes');
  requireParents(p, d);

  if (state.sizes.journalFile === null) {
    requireValue(state.sizes.state === 'pending' && state.sizes.commit === null && state.sizes.reason === null,
      'Unbound sizes must be a new pending target');
    requireActing(state, p, d);
    createRoot(p, d);
    const hasPrepare = directory(p.prepareDir, d, true);
    const hasApply = directory(p.applyDir, d, true);
    requireValue(statOrMissing(p.journalFile, d) === null, 'A size journal cannot precede its durable release pointer');
    if (!hasPrepare) {
      requireValue(!hasApply, 'An orphan size apply directory cannot be regenerated');
      prepareDownloadSizes({ version: state.version, parentDir: path.dirname(state.repo.root),
        runDir: p.prepareDir, publication: binding(state) }, { run: d.run });
    }
    readPrepared(state, p, d);
    if (!hasApply) {
      prepareDocsApplication({ preparedFile: p.preparedFile, repo: REPO,
        parentDir: path.dirname(state.repo.root), version: state.version, outDir: p.applyDir },
      { run: d.run, spawn: d.spawn });
    }
    const app = readApplication(state, p, d);
    flushEvidence(p, app, d);
    readApplication(state, p, d);
    state = persist(state, p, { state: 'pending', journalFile: p.journalFile, commit: null, reason: null }, d);
  } else {
    readApplication(state, p, d);
  }

  let journal = readJournal(state, p, d);
  if (complete(journal)) return finish(state, p, journal, d);
  requireActing(state, p, d);
  const acting = {
    run: d.run, spawn: d.spawn, spawnRemote: d.spawnRemote, fs: d.io,
    now: d.now, randomUUID: d.randomUUID, withFerryRepoLock: d.ferry,
    ferryOptions: d.ferryOptions, cacheRoot: path.dirname(repoDir), assertPublishWindow: d.guard
  };
  try {
    if (journal === null) {
      await prepareCommitIntent({ applicationFile: p.applicationFile, journalFile: p.journalFile,
        message: `Update desktop download sizes for v${state.version}` }, acting);
    }
    requireActing(state, p, d);
    await reconcileTarget({ journalFile: p.journalFile }, acting);
    requireActing(state, p, d);
    await reconcileTargetPush({ journalFile: p.journalFile }, acting);
  } catch (error) {
    if (!ordinary(error)) throw error;
    return targetFailure(state, p, error, d);
  }
  readApplication(state, p, d);
  journal = readJournal(state, p, d);
  return finish(state, p, journal, d);
}

module.exports = { reconcileReleaseSizes };
