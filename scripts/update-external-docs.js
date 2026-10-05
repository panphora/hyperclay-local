#!/usr/bin/env node

/**
 * Update version numbers in external documentation files.
 *
 * Usage:
 *   node scripts/update-external-docs.js           # Uses version from package.json
 *   node scripts/update-external-docs.js 1.2.0    # Uses specified version
 *
 * Optional exact-path control:
 *   --parent-dir <absolute>  sibling checkout parent
 *   --run-dir <absolute>     resumable run directory
 *   --result <absolute>      aggregate result file inside runDir
 */

'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');
const PARENT_DIR = path.join(ROOT_DIR, '..');

const TARGET_REPOS = ['hyperclay', 'hyperclay-website'];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RESULT_SCHEMA = 1;
const RESULT_STATES = ['pending', 'complete', 'pending-push', 'conflict', 'missing', 'failed', 'unknown'];
const DEFAULT_RESULT_FILE = 'result.json';

const SHARED_CODES = new Set([
  'DOCS_RUN_INVALID',
  'DOCS_RUN_CONFLICT',
  'DOCS_RUN_WRITE_FAILED',
  'DOCS_RESULT_INVALID',
  'DOCS_RESULT_WRITE_FAILED',
  'DOCS_JOURNAL_WRITE_FAILED',
  'DOCS_LOCK_IO_FAILED',
  'DOCS_LOCK_LOST',
  'DOCS_LOCK_PATH_UNSAFE',
  'DOCS_APPLY_DEPS_INVALID',
  'LOCK_DEPS_INVALID'
]);

const CONFLICT_CODES = new Set([
  'DOCS_PREIMAGE_CONFLICT',
  'DOCS_HISTORY_UNRESOLVED',
  'DOCS_LOCAL_CONFLICT',
  'DOCS_TARGET_IDENTITY_INVALID',
  'DOCS_REMOTE_CONTENT_CONFLICT',
  'DOCS_REMOTE_DIVERGED',
  'DOCS_LOCK_BUSY'
]);

const PENDING_CODES = new Set([
  'DOCS_REMOTE_UNREADABLE',
  'DOCS_REMOTE_OBJECT_MISSING',
  'DOCS_REMOTE_HISTORY_UNRESOLVED',
  'DOCS_REMOTE_PUSH_FAILED',
  'DOCS_REMOTE_PUSH_UNCONFIRMED'
]);

const FAILED_CODES = new Set([
  'DOCS_APPLICATION_INVALID',
  'DOCS_JOURNAL_INVALID',
  'DOCS_RUN_TARGET_MISMATCH'
]);

const PHASE_CODES = {
  prepare: 'DOCS_PREPARE_FAILED',
  plan: 'DOCS_PLAN_FAILED',
  operation: 'DOCS_OPERATION_FAILED'
};

const RECHECK_PENDING = Object.freeze({
  code: 'DOCS_RECHECK_PENDING',
  message: 'this invocation has not re-verified the target yet'
});
const NOT_ATTEMPTED = Object.freeze({
  code: 'DOCS_NOT_ATTEMPTED',
  message: 'this invocation has not attempted the target yet'
});

// ============================================
// COLORS
// ============================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function logSuccess(msg) { console.log(`${colors.green}\u2713${colors.reset} ${msg}`); }
function logWarn(msg) { console.log(`${colors.yellow}\u26a0${colors.reset} ${msg}`); }
function logError(msg) { console.log(`${colors.red}\u2717${colors.reset} ${msg}`); }
function logInfo(msg) { console.log(`${colors.blue}\u2192${colors.reset} ${msg}`); }

// ============================================
// VERSION DETECTION
// ============================================

function detectOldVersion(content) {
  // Look for version pattern in download URLs
  const match = content.match(/HyperclayLocal-(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

// ============================================
// UPDATE LOGIC
// ============================================

function updateVersionInContent(content, oldVersion, newVersion) {
  // Replace every mention of the old version, not just the ones inside download
  // URLs and filenames. Prose like "install the latest version (1.18.0)" matched
  // no download pattern, so it went stale on every release.
  //
  // The old version was detected from a HyperclayLocal-X.X.X link in this same
  // file, so a bare mention of that exact version here is the same release.
  // Changes outside a download reference are returned so they show up in the
  // output instead of being silently committed.
  const oldEscaped = oldVersion.replace(/\./g, '\\.');
  const proseChanges = [];

  const updated = content
    .split('\n')
    .map(line => {
      const next = line.replace(new RegExp(`(?<!\\d)${oldEscaped}(?!\\d)`, 'g'), newVersion);
      if (next !== line && !line.includes('HyperclayLocal-')) {
        proseChanges.push(next.trim());
      }
      return next;
    })
    .join('\n');

  return { updated, proseChanges };
}

// ============================================
// ACTING PATH
// ============================================

function docsError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function messageOf(error) {
  if (error && error.message !== undefined && error.message !== null) return String(error.message);
  return String(error);
}

function commitMessage(version) {
  return `chore: update Hyperclay Local download links to v${version}`;
}

// Documentation commits and pushes wait for the release window. Acting apply and
// push primitives require this callable and do not supply a safe default; it
// throws a typed error instead of exiting the process.
function assertDocsPublishWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  if (['Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday)
      && Number(parts.hour) >= 9 && Number(parts.hour) < 18) {
    throw docsError('DOCS_PUBLISH_WINDOW_CLOSED',
      'Documentation commits and pushes wait until after 18:00 America/New_York, or Sat through Mon');
  }
}

function resolveUpdaterDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (typeof provided !== 'object' || Array.isArray(provided)) {
    throw docsError('DOCS_APPLY_DEPS_INVALID', 'docs updater deps must be an object');
  }
  const command = require('./release-command');
  const prepare = require('./release-docs-prepare');
  const plan = require('./release-docs-plan');
  const apply = require('./release-docs-apply');
  const runRecord = require('./release-docs-run');
  const locks = require('./release-lock');
  const state = require('./release-state');

  const run = provided.run === undefined ? command.execFileCaptured : provided.run;
  const spawn = provided.spawn === undefined ? childProcess.spawnSync : provided.spawn;
  const spawnRemote = provided.spawnRemote === undefined ? childProcess.spawnSync : provided.spawnRemote;
  const io = provided.fs === undefined ? fs : provided.fs;
  const now = provided.now === undefined ? () => Date.now() : provided.now;
  const randomUUID = provided.randomUUID === undefined ? () => crypto.randomUUID() : provided.randomUUID;
  const assertPublishWindow = provided.assertPublishWindow === undefined
    ? assertDocsPublishWindow
    : provided.assertPublishWindow;

  for (const [label, value] of [
    ['run', run], ['spawn', spawn], ['spawnRemote', spawnRemote],
    ['now', now], ['randomUUID', randomUUID], ['assertPublishWindow', assertPublishWindow]
  ]) {
    if (typeof value !== 'function') {
      throw docsError('DOCS_APPLY_DEPS_INVALID', `docs updater ${label} must be a function`);
    }
  }
  if (typeof io !== 'object' || io === null) {
    throw docsError('DOCS_APPLY_DEPS_INVALID', 'docs updater fs must be an object');
  }
  if (provided.readGit !== undefined && typeof provided.readGit !== 'function') {
    throw docsError('DOCS_APPLY_DEPS_INVALID', 'docs updater readGit must be a function');
  }
  if (provided.withFerryRepoLock !== undefined && typeof provided.withFerryRepoLock !== 'function') {
    throw docsError('DOCS_APPLY_DEPS_INVALID', 'docs updater withFerryRepoLock must be a function');
  }

  const applyDeps = {
    run,
    spawnRemote,
    fs: io,
    now,
    randomUUID,
    assertPublishWindow,
    cacheRoot: provided.cacheRoot
  };
  if (provided.withFerryRepoLock !== undefined) applyDeps.withFerryRepoLock = provided.withFerryRepoLock;

  return {
    run,
    spawn,
    spawnRemote,
    io,
    now,
    randomUUID,
    cacheRoot: provided.cacheRoot,
    repoRoot: provided.repoRoot,
    readGit: provided.readGit,
    prepare,
    plan,
    apply,
    runRecord,
    locks,
    state,
    applyDeps
  };
}

function realDirectory(dir, label) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (error) {
    throw docsError('DOCS_RUN_INVALID', `${label} is missing: ${dir}`, error);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw docsError('DOCS_RUN_INVALID', `${label} is not a directory: ${real}`);
  }
  return real;
}

function inspectEntry(target, io, label, kind) {
  let stat;
  try {
    stat = io.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { present: false };
    throw docsError('DOCS_OPERATION_FAILED', `the ${label} could not be inspected: ${target}`, error);
  }
  if (stat.isSymbolicLink()) {
    throw docsError('DOCS_OPERATION_FAILED', `the ${label} must not be a symlink: ${target}`);
  }
  if (kind === 'directory' && !stat.isDirectory()) {
    throw docsError('DOCS_OPERATION_FAILED', `the ${label} is not a directory: ${target}`);
  }
  if (kind === 'file' && !stat.isFile()) {
    throw docsError('DOCS_OPERATION_FAILED', `the ${label} is not a regular file: ${target}`);
  }
  return { present: true, stat };
}

function inspectTargetEvidence(paths, io) {
  return {
    prepareDir: inspectEntry(paths.prepareDir, io, 'attempt prepare directory', 'directory').present,
    prepared: inspectEntry(paths.preparedFile, io, 'attempt prepared descriptor', 'file').present,
    applyDir: inspectEntry(paths.applyDir, io, 'attempt apply directory', 'directory').present,
    application: inspectEntry(paths.applicationFile, io, 'attempt application descriptor', 'file').present,
    journal: inspectEntry(paths.journalFile, io, 'attempt target journal', 'file').present
  };
}

const NO_EVIDENCE = Object.freeze({
  prepareDir: false, prepared: false, applyDir: false, application: false, journal: false
});

function recoveryAction(slot, present) {
  if (slot.attemptId === null) return 'select-attempt';
  if (slot.journalOperationId !== null || present.journal) return 'journal';
  if (present.application) return 'application';
  if (present.applyDir || (present.prepareDir && !present.prepared)) {
    return 'select-attempt';
  }
  if (present.prepared) return 'plan';
  return 'prepare';
}

function ensureAttemptRoot(root, io) {
  try {
    io.mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw docsError('DOCS_OPERATION_FAILED', `the attempt directory could not be created: ${root}`, error);
  }
  const stat = io.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw docsError('DOCS_OPERATION_FAILED', `the attempt directory is not a real directory: ${root}`);
  }
}

function slotFor(run, repo) {
  return run.targets[TARGET_REPOS.indexOf(repo)];
}

function assertJournalBinding(journal, run, slot, paths) {
  if (journal.version !== run.version || journal.repo !== slot.repo
      || journal.repoRoot !== slot.repoRoot
      || journal.journalFile !== paths.journalFile
      || journal.applicationFile !== paths.applicationFile
      || journal.preparedFile !== paths.preparedFile) {
    throw docsError('DOCS_RUN_TARGET_MISMATCH', 'The target journal does not belong to the selected docs attempt');
  }
  if (slot.journalOperationId !== null
      && journal.operationId !== slot.journalOperationId) {
    throw docsError('DOCS_RUN_TARGET_MISMATCH', 'The selected target journal operation changed');
  }
}

function assertApplicationBinding(application, expected) {
  if (application.version !== expected.version || application.repo !== expected.repo
      || application.repoRoot !== expected.repoRoot
      || application.preparedFile !== expected.paths.preparedFile
      || application.applicationFile !== expected.paths.applicationFile) {
    throw docsError('DOCS_APPLICATION_INVALID',
      'The prepared application does not belong to the selected docs attempt');
  }
}

function inspectShared(error) {
  const seen = new Set();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (typeof current.code === 'string' && SHARED_CODES.has(current.code)) return current.code;
    queue.push(current.cause, current.cleanupError);
  }
  return null;
}

function classifyTargetError(error, phase, journal) {
  const code = error && typeof error.code === 'string' ? error.code : null;
  const message = messageOf(error);
  if (code !== null && CONFLICT_CODES.has(code)) return { state: 'conflict', reason: { code, message } };
  if (code !== null && PENDING_CODES.has(code)) return { state: 'pending-push', reason: { code, message } };
  if (code !== null && FAILED_CODES.has(code)) return { state: 'failed', reason: { code, message } };
  if (code === 'DOCS_PUBLISH_WINDOW_CLOSED') {
    const state = journal !== null && journal.commit !== null ? 'pending-push' : 'failed';
    return { state, reason: { code, message } };
  }
  return { state: 'failed', reason: { code: PHASE_CODES[phase], message } };
}

function emptyTarget(repo) {
  return {
    repo,
    paths: [],
    beforeHead: null,
    commit: null,
    state: 'pending',
    reason: null,
    journalFile: null,
    remoteHead: null,
    verifiedAt: null
  };
}

function projectJournal(entry, journal, journalFile) {
  entry.paths = journal.requiredPaths.slice();
  entry.beforeHead = journal.beforeHead;
  entry.commit = journal.commit;
  entry.journalFile = journalFile;
  entry.state = journal.state === 'complete' ? 'pending' : journal.state;
  entry.reason = journal.reason === null && entry.state === 'pending' ? RECHECK_PENDING : journal.reason;
  entry.remoteHead = null;
  entry.verifiedAt = null;
  return entry;
}

function requireFreshRemoteProof(journal, repo) {
  const observation = journal.remoteObservation;
  if (journal.state !== 'complete' || journal.commit === null || observation === null
      || observation.containsCommit !== true || observation.postimagesMatch !== true) {
    throw docsError('DOCS_OPERATION_FAILED',
      `the ${repo} push reconciliation returned without fresh remote proof for its recorded commit`);
  }
}

function invocationStartResult(run, prior, version) {
  return {
    schema: RESULT_SCHEMA,
    version,
    targets: TARGET_REPOS.map((repo, index) => {
      const entry = emptyTarget(repo);
      const previous = prior === null ? null : prior.targets[index];
      if (previous === null) {
        entry.reason = NOT_ATTEMPTED;
        return entry;
      }
      const evidence = previous.journalFile !== null || previous.commit !== null
        || previous.beforeHead !== null || previous.paths.length > 0
        || (previous.state !== 'unknown' && previous.state !== 'pending');
      if (!evidence) {
        entry.reason = NOT_ATTEMPTED;
        return entry;
      }
      entry.paths = previous.paths.slice();
      entry.beforeHead = previous.beforeHead;
      entry.commit = previous.commit;
      entry.journalFile = previous.journalFile;
      entry.state = 'unknown';
      entry.reason = RECHECK_PENDING;
      return entry;
    })
  };
}

function commitMessageFor(version) {
  return commitMessage(version);
}

async function attemptTarget(context, repo, index) {
  const { resolved, handle, aggregate, version, parentDir, runDir, io } = context;
  const entry = aggregate.targets[index];
  const root = path.join(parentDir, repo);

  const rootEntry = inspectEntry(root, io, `${repo} checkout`, 'directory');
  if (!rootEntry.present) {
    entry.state = 'missing';
    entry.reason = { code: 'DOCS_REPO_MISSING', message: `the ${repo} sibling checkout is missing: ${root}` };
    entry.remoteHead = null;
    entry.verifiedAt = null;
    handle.writeResult(aggregate);
    return;
  }

  let slot = slotFor(handle.snapshotRun(), repo);
  let present = slot.attemptId === null ? NO_EVIDENCE : inspectTargetEvidence(context.pathsFor(slot), io);
  let action = recoveryAction(slot, present);
  if (action === 'select-attempt') {
    handle.selectAttempt(repo, resolved.randomUUID());
    slot = slotFor(handle.snapshotRun(), repo);
    action = 'prepare';
  }
  const paths = context.pathsFor(slot);
  if (action !== 'journal') ensureAttemptRoot(paths.root, io);

  context.phase = 'prepare';
  if (action === 'prepare') {
    resolved.prepare.prepareExternalDocs(
      { version, parentDir, runDir: paths.prepareDir, targets: [repo] },
      { run: resolved.run }
    );
  }
  context.phase = 'plan';
  if (action === 'prepare' || action === 'plan') {
    resolved.plan.prepareDocsApplication(
      { preparedFile: paths.preparedFile, repo, parentDir, version, outDir: paths.applyDir },
      { run: resolved.run, spawn: resolved.spawn }
    );
  }
  if (action !== 'journal') {
    const verified = resolved.plan.verifyDocsApplication(
      paths.applicationFile,
      { run: resolved.run, spawn: resolved.spawn }
    );
    assertApplicationBinding(verified, { version, repo, repoRoot: root, paths });
    resolved.apply.prepareCommitIntent(
      { applicationFile: paths.applicationFile, journalFile: paths.journalFile, message: commitMessageFor(version) },
      resolved.applyDeps
    );
  }

  context.phase = 'operation';
  const journal = resolved.apply.readTargetJournal(paths.journalFile, { run: resolved.run, fs: io });
  assertJournalBinding(journal, handle.snapshotRun(), slot, paths);
  if (slot.journalOperationId === null) {
    handle.bindJournal(repo, slot.attemptId, journal.operationId);
  }

  projectJournal(entry, journal, paths.journalFile);
  handle.writeResult(aggregate);

  resolved.apply.reconcileTarget({ journalFile: paths.journalFile }, resolved.applyDeps);
  const settled = resolved.apply.readTargetJournal(paths.journalFile, { run: resolved.run, fs: io });
  assertJournalBinding(settled, handle.snapshotRun(), slot, paths);
  projectJournal(entry, settled, paths.journalFile);
  handle.writeResult(aggregate);

  resolved.apply.reconcileTargetPush({ journalFile: paths.journalFile }, resolved.applyDeps);
  const verifiedRemote = resolved.apply.readTargetJournal(paths.journalFile, { run: resolved.run, fs: io });
  assertJournalBinding(verifiedRemote, handle.snapshotRun(), slot, paths);
  requireFreshRemoteProof(verifiedRemote, repo);

  entry.paths = verifiedRemote.requiredPaths.slice();
  entry.beforeHead = verifiedRemote.beforeHead;
  entry.commit = verifiedRemote.commit;
  entry.journalFile = paths.journalFile;
  entry.state = 'complete';
  entry.reason = null;
  entry.remoteHead = verifiedRemote.remoteObservation.head;
  entry.verifiedAt = verifiedRemote.remoteObservation.observedAt;
  handle.writeResult(aggregate);
}

function recordTargetFailure(context, repo, index, error, phase) {
  const { handle, aggregate } = context;
  const entry = aggregate.targets[index];
  const slot = slotFor(handle.snapshotRun(), repo);
  let journal = null;
  if (slot.attemptId !== null && entry.journalFile !== null) {
    try {
      const paths = context.pathsFor(slot);
      const candidate = context.resolved.apply.readTargetJournal(paths.journalFile, {
        run: context.resolved.run, fs: context.io
      });
      assertJournalBinding(candidate, handle.snapshotRun(), slot, paths);
      journal = candidate;
    } catch (readError) {
      if (inspectShared(readError) !== null) throw readError;
      journal = null;
    }
  }
  const classification = classifyTargetError(error, phase, journal);
  if (journal !== null) projectJournal(entry, journal, entry.journalFile);
  entry.state = classification.state;
  entry.reason = classification.reason;
  entry.remoteHead = journal !== null && journal.remoteObservation !== null
    ? journal.remoteObservation.head
    : null;
  entry.verifiedAt = null;
  handle.writeResult(aggregate);
}

async function runTarget(context, repo, index) {
  try {
    await attemptTarget(context, repo, index);
  } catch (error) {
    if (inspectShared(error) !== null) throw error;
    recordTargetFailure(context, repo, index, error, context.phase);
  }
}

async function updateExternalDocs(input, deps) {
  const provided = input === undefined || input === null ? {} : input;
  if (typeof provided !== 'object' || Array.isArray(provided)) {
    throw docsError('DOCS_RUN_INVALID', 'docs updater options must be an object');
  }
  const version = provided.version;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw docsError('DOCS_RUN_INVALID', `version must look like 1.2.3, received ${JSON.stringify(version)}`);
  }
  const parentDir = provided.parentDir === undefined ? PARENT_DIR : provided.parentDir;

  const resolved = resolveUpdaterDeps(deps);
  const io = resolved.io;

  let identity;
  try {
    identity = resolved.state.resolveRepoIdentity(
      resolved.repoRoot === undefined ? ROOT_DIR : resolved.repoRoot,
      { readGit: resolved.readGit, fs: io }
    );
  } catch (error) {
    throw docsError('DOCS_RUN_INVALID',
      `the desktop release repository identity could not be resolved: ${messageOf(error)}`, error);
  }

  const parentRoot = realDirectory(parentDir, 'parentDir');
  let statePaths;
  try {
    statePaths = resolved.state.statePaths(identity, { cacheRoot: resolved.cacheRoot, fs: io });
  } catch (error) {
    throw docsError('DOCS_RUN_INVALID', messageOf(error), error);
  }

  const siblingInfo = new Map();
  for (const repo of TARGET_REPOS) {
    const root = path.join(parentRoot, repo);
    let stat = null;
    try {
      stat = io.lstatSync(root);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        siblingInfo.set(repo, { missing: true, root });
        continue;
      }
      throw docsError('DOCS_RUN_INVALID', `the ${repo} sibling could not be inspected: ${root}`, error);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      siblingInfo.set(repo, { unsafe: true, root });
      continue;
    }
    const real = io.realpathSync(root);
    let commonDir = null;
    try {
      commonDir = io.realpathSync(path.resolve(real,
        String(resolved.run('git', ['rev-parse', '--git-common-dir'], { cwd: real, encoding: 'utf8', echoStdout: false })).trim()));
    } catch (error) {
      commonDir = null;
    }
    siblingInfo.set(repo, { root: real, commonDir });
  }
  for (const repo of TARGET_REPOS) {
    const info = siblingInfo.get(repo);
    if (!info || !info.commonDir) continue;
    if (info.commonDir === identity.commonDir) {
      throw docsError('DOCS_RUN_CONFLICT',
        `the ${repo} sibling shares the desktop repository common directory; nested docs locks are not allowed`);
    }
  }
  const first = siblingInfo.get(TARGET_REPOS[0]);
  const second = siblingInfo.get(TARGET_REPOS[1]);
  if (first && second && first.commonDir && second.commonDir && first.commonDir === second.commonDir) {
    throw docsError('DOCS_RUN_CONFLICT',
      'the two sibling checkouts share one common directory; nested docs locks are not allowed');
  }

  const requestedRunDir = provided.runDir === undefined
    ? path.join(statePaths.repoDir, 'docs', version)
    : provided.runDir;
  const requestedResultFile = provided.resultFile === undefined
    ? path.join(requestedRunDir, DEFAULT_RESULT_FILE)
    : provided.resultFile;
  const runRoot = resolved.runRecord.canonicalRunPath(requestedRunDir, io, 'runDir');
  const resultRoot = resolved.runRecord.canonicalRunPath(requestedResultFile, io, 'resultFile');
  for (const [label, root] of [
    ['parentDir', parentRoot],
    ['the desktop checkout', identity.root],
    ['the desktop common directory', identity.commonDir],
    ...[...siblingInfo].map(([repo, info]) => [`the ${repo} checkout`, info.root]),
    ...[...siblingInfo].filter(([, info]) => info.commonDir).map(([repo, info]) => [`the ${repo} common directory`, info.commonDir])
  ]) {
    if (runRoot === root || runRoot.startsWith(root + path.sep)) {
      throw docsError('DOCS_RUN_INVALID', `runDir must live outside ${label}: ${runRoot}`);
    }
  }

  const owner = { root: identity.root, commonDir: identity.commonDir, key: identity.key };

  return resolved.locks.withDocsLock(identity, async () => {
    const handle = resolved.runRecord.openDocsRun(
      { version, parentDir: parentRoot, runDir: runRoot, resultFile: resultRoot, owner },
      { fs: io, randomUUID: resolved.randomUUID }
    );
    const aggregate = invocationStartResult(handle.snapshotRun(), handle.snapshotResult(), version);
    handle.writeResult(aggregate);

    const context = {
      resolved,
      handle,
      aggregate,
      io,
      version,
      parentDir: parentRoot,
      runDir: runRoot,
      phase: 'prepare',
      pathsFor: (slot) => resolved.runRecord.attemptPaths(runRoot, slot.repo, slot.attemptId)
    };
    for (let index = 0; index < TARGET_REPOS.length; index += 1) {
      await runTarget(context, TARGET_REPOS[index], index);
    }
    handle.writeResult(aggregate);
    return aggregate;
  }, { cacheRoot: resolved.cacheRoot, fs: io });
}

// ============================================
// CLI
// ============================================

function parseArguments(argv) {
  const options = { runDir: undefined, resultFile: undefined, parentDir: undefined };
  const known = new Map([
    ['--run-dir', 'runDir'],
    ['--result', 'resultFile'],
    ['--parent-dir', 'parentDir']
  ]);
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg === 'string' && arg.startsWith('--')) {
      const key = known.get(arg);
      if (key === undefined) throw docsError('DOCS_RUN_INVALID', `Unknown option ${arg}`);
      if (options[key] !== undefined) throw docsError('DOCS_RUN_INVALID', `Duplicate option ${arg}`);
      const value = argv[index + 1];
      if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
        throw docsError('DOCS_RUN_INVALID', `Option ${arg} needs an absolute value`);
      }
      options[key] = value;
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  if (positional.length > 1) {
    throw docsError('DOCS_RUN_INVALID', `Unexpected extra argument ${positional[1]}`);
  }
  return { version: positional[0], ...options };
}

function getCurrentVersion() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const version = parsed.version === undefined ? getCurrentVersion() : parsed.version;

  console.log('');
  console.log(`${colors.cyan}Updating external docs to version ${version}${colors.reset}`);
  console.log('');

  const result = await updateExternalDocs({
    version,
    parentDir: parsed.parentDir,
    runDir: parsed.runDir,
    resultFile: parsed.resultFile
  });

  let complete = true;
  for (const target of result.targets) {
    if (target.state === 'complete') {
      logSuccess(`${target.repo} documentation is complete at ${target.commit}`);
      continue;
    }
    complete = false;
    logError(`${target.repo} documentation is ${target.state}: ${target.reason.message}`);
    if (target.journalFile !== null) logInfo(`  Evidence: ${target.journalFile}`);
  }
  console.log('');
  if (!complete) {
    logWarn('Documentation targets remain incomplete; rerun the same version to resume');
    process.exitCode = 1;
  }
}

module.exports = {
  detectOldVersion,
  updateVersionInContent,
  updateExternalDocs,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
