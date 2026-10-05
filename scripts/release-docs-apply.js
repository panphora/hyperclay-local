'use strict';

// Apply one verified documentation application to its live sibling checkout,
// recover the same immutable commit after an interruption, and reconcile that one
// recorded commit with its single push destination. The candidate commit is
// constructed before any live mutation, the target journal is published
// atomically before the apply, and every resume decides from observed facts
// instead of the recorded phase. The local apply never pushes and never reads a
// remote; only reconcileTargetPush talks to the push destination, over shell-free
// argv with redacted output. This module never imports the acting release CLI.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const releaseCommand = require('./release-command');
const { execFileCaptured } = releaseCommand;
const { createLocalGitReader } = require('./release-local-read');
const { withDocsLock } = require('./release-lock');
const { withFerryRepoLock } = require('./release-ferry');
const { verifyDocsApplication } = require('./release-docs-plan');
const {
  readTargetEvidence,
  stateError, journalInvalid, applicationInvalid, identityInvalid, historyUnresolved, commandFailure,
  sha256, observeEnv, git, gitProbe, cleanMiss, isAncestor, requireRealDirectory, readApplicationEvidence,
  commitParents, commitTree, commitExists, treeEntries, entriesMatch, requireCandidateInvariants,
  requireProvenBoundary, expectedOidLength,
  SCHEMA, JOURNAL_FILE, APPLICATION_FILE, REMOTE, REMOTE_REF, OID_PATTERN, OBJECT_FORMATS, JOURNAL_FIELDS
} = require('./release-target-evidence');

const BRANCH_REF = 'refs/heads/main';
const COMMIT_MESSAGE = 'release documentation';
const HISTORY_LIMIT = 1000;
const PERMISSION_BITS = 0o777;
const SPECIAL_BITS = 0o7000;
const APPLY_NOT_FINISHED = { code: 'APPLY_NOT_FINISHED', message: 'prepared application has not completed' };
const REF_NOT_ADVANCED = { code: 'REF_NOT_ADVANCED', message: 'documentation is applied but main has not advanced' };
const REMOTE_READ_TIMEOUT_MS = 30000;
const REMOTE_PUSH_TIMEOUT_MS = 120000;
const REMOTE_OUTPUT_LIMIT = 1024 * 1024;
const OBSERVATION_COMPLETE = 'complete';
const OBSERVATION_CONTENT_CONFLICT = 'content-conflict';
const OBSERVATION_DIVERGED = 'diverged';
const OBSERVATION_BEHIND = 'behind';
const OBSERVATION_UNRESOLVED = 'unresolved';
const DESTINATION_PLACEHOLDER = '<push-destination>';
const CREDENTIAL_PLACEHOLDER = '<redacted>';
const USERINFO_PATTERN = /([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)[^/@\s]*@/g;

const readOnlyPatchSpawn = createLocalGitReader().spawn;

function journalWriteFailed(message, cause) {
  return stateError('DOCS_JOURNAL_WRITE_FAILED', message, cause);
}

function depsInvalid(message) {
  return stateError('DOCS_APPLY_DEPS_INVALID', message);
}

function preimageConflict(message, cause) {
  return stateError('DOCS_PREIMAGE_CONFLICT', message, cause);
}

function applyNotFinished(message) {
  return stateError('DOCS_APPLY_NOT_FINISHED', message);
}

function localConflict(message) {
  return stateError('DOCS_LOCAL_CONFLICT', message);
}

function remoteFailure(code, message, diagnostic) {
  const error = stateError(code, message, diagnostic);
  if (diagnostic !== undefined && diagnostic !== null) {
    error.status = diagnostic.status;
    error.signal = diagnostic.signal;
    error.stdout = diagnostic.stdout;
    error.stderr = diagnostic.stderr;
  }
  return error;
}

function remoteUnreadable(message, diagnostic) {
  return remoteFailure('DOCS_REMOTE_UNREADABLE', message, diagnostic);
}

function remoteObjectMissing(message, diagnostic) {
  return remoteFailure('DOCS_REMOTE_OBJECT_MISSING', message, diagnostic);
}

function remoteHistoryUnresolved(message, cause) {
  return stateError('DOCS_REMOTE_HISTORY_UNRESOLVED', message, cause);
}

function remoteContentConflict(message) {
  return stateError('DOCS_REMOTE_CONTENT_CONFLICT', message);
}

function remoteDiverged(message) {
  return stateError('DOCS_REMOTE_DIVERGED', message);
}

function remotePushFailed(message, diagnostic) {
  return remoteFailure('DOCS_REMOTE_PUSH_FAILED', message, diagnostic);
}

function remotePushUnconfirmed(message, diagnostic) {
  return remoteFailure('DOCS_REMOTE_PUSH_UNCONFIRMED', message, diagnostic);
}

function fileMode(stat) {
  return (stat.mode & PERMISSION_BITS).toString(8);
}

function observeTargetIdentity(run, repoRoot) {
  const root = requireRealDirectory(repoRoot, 'target repository root');
  const env = observeEnv();
  const top = fs.realpathSync(git(run, root, env, ['rev-parse', '--show-toplevel']).trim());
  if (top !== root) throw identityInvalid(`target repository root is not the Git checkout root: ${root}`);
  const commonDir = fs.realpathSync(path.resolve(root, git(run, root, env, ['rev-parse', '--git-common-dir']).trim()));
  const branchProbe = gitProbe(run, root, env, ['symbolic-ref', '-q', 'HEAD']);
  if (!branchProbe.ok && !cleanMiss(branchProbe.error)) {
    throw commandFailure('git symbolic-ref -q HEAD', branchProbe.error);
  }
  const branch = branchProbe.ok ? branchProbe.stdout.trim() : '';
  if (branch !== BRANCH_REF) {
    throw identityInvalid(`target repository must be on ${BRANCH_REF}, found ${branch.length > 0 ? branch : 'a detached HEAD'}`);
  }
  const objectFormat = git(run, root, env, ['rev-parse', '--show-object-format']).trim();
  if (!OBJECT_FORMATS.includes(objectFormat)) {
    throw identityInvalid(`target repository object format is unsupported: ${objectFormat}`);
  }
  const urlProbe = gitProbe(run, root, env, ['remote', 'get-url', '--push', '--all', REMOTE]);
  if (!urlProbe.ok) {
    throw identityInvalid(`${REMOTE} has no readable push destination in ${root}`, urlProbe.error);
  }
  const pushDestinations = urlProbe.stdout.split('\n').filter((line) => line.length > 0);
  if (pushDestinations.length !== 1) {
    throw identityInvalid(`${REMOTE} must have exactly one push destination, found ${pushDestinations.length}`);
  }
  return {
    root,
    commonDir,
    key: sha256(commonDir),
    branch: 'main',
    remote: REMOTE,
    remoteRef: REMOTE_REF,
    pushUrlSha256: sha256(pushDestinations[0]),
    objectFormat,
    pushDestination: pushDestinations[0]
  };
}

function resolveReadDeps(deps) {
  const provided = deps === undefined ? {} : deps;
  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    throw depsInvalid('docs apply deps must be an object');
  }
  const run = provided.run === undefined ? execFileCaptured : provided.run;
  const spawn = provided.spawn === undefined ? readOnlyPatchSpawn : provided.spawn;
  const io = provided.fs === undefined ? fs : provided.fs;
  if (typeof run !== 'function') throw depsInvalid('docs apply run must be a function');
  if (typeof spawn !== 'function') throw depsInvalid('docs apply spawn must be a function');
  if (typeof io !== 'object' || io === null) throw depsInvalid('docs apply fs must be an object');
  return { run, spawn, io };
}

function resolveActingDeps(deps) {
  const { run, spawn, io } = resolveReadDeps(deps);
  const provided = deps === undefined ? {} : deps;
  const now = provided.now === undefined ? () => Date.now() : provided.now;
  const randomUUID = provided.randomUUID === undefined ? () => crypto.randomUUID() : provided.randomUUID;
  const ferry = provided.withFerryRepoLock === undefined ? withFerryRepoLock : provided.withFerryRepoLock;
  const spawnRemote = provided.spawnRemote === undefined ? childProcess.spawnSync : provided.spawnRemote;
  if (typeof spawnRemote !== 'function') throw depsInvalid('docs apply spawnRemote must be a function');
  if (typeof now !== 'function') throw depsInvalid('docs apply now must be a function');
  if (typeof randomUUID !== 'function') throw depsInvalid('docs apply randomUUID must be a function');
  if (typeof ferry !== 'function') throw depsInvalid('docs apply withFerryRepoLock must be a function');
  if (typeof provided.assertPublishWindow !== 'function') {
    throw depsInvalid('docs apply needs a callable assertPublishWindow time policy');
  }
  return {
    run,
    spawn,
    io,
    now,
    randomUUID,
    ferry,
    ferryOptions: provided.ferryOptions === undefined ? {} : provided.ferryOptions,
    cacheRoot: provided.cacheRoot,
    assertPublishWindow: provided.assertPublishWindow,
    spawnRemote
  };
}

function timestamp(deps) {
  let value;
  try {
    value = deps.now();
  } catch (error) {
    throw depsInvalid(`docs apply now must produce a timestamp: ${error && error.message ? error.message : String(error)}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw depsInvalid('docs apply now must produce a valid timestamp');
  return date.toISOString();
}

function requireMissingJournal(journalFile, io) {
  try {
    io.lstatSync(journalFile);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  throw journalInvalid(`target journal already exists: ${journalFile}`);
}

function requireJournalIdentityMatch(record, identity) {
  if (record.repoRoot !== identity.root) throw journalInvalid('target journal repoRoot is not the canonical repository root');
  if (record.repoKey !== identity.key) throw journalInvalid('target journal repoKey is not the canonical common directory digest');
  if (record.pushUrlSha256 !== identity.pushUrlSha256) {
    throw journalInvalid(`target journal pushUrlSha256 does not match the current ${REMOTE} push destination`);
  }
}

function loadTargetRecord(journalFile, deps) {
  const evidence = readTargetEvidence(journalFile, { run: deps.run, spawn: deps.spawn, fs: deps.io });
  const record = evidence.journal;
  let identity;
  try {
    identity = observeTargetIdentity(deps.run, record.repoRoot);
  } catch (error) {
    throw journalInvalid(error && error.message ? String(error.message) : String(error), error);
  }
  requireJournalIdentityMatch(record, identity);
  return { journal: record, application: evidence.application, identity };
}

function readTargetJournal(journalFile, deps) {
  const resolved = resolveReadDeps(deps);
  const { journal } = loadTargetRecord(journalFile, resolved);
  return { ...journal, journalFile };
}

function requireApplicationEvidence(record, deps) {
  const application = readApplicationEvidence(record.applicationFile, deps.io);
  if (application.sha256 !== record.applicationSha256) {
    throw preimageConflict('application.json changed while the target was being applied');
  }
  let bytes;
  try {
    bytes = deps.io.readFileSync(record.preparedFile);
  } catch (error) {
    throw preimageConflict(`prepared descriptor could not be read: ${record.preparedFile}`, error);
  }
  if (sha256(bytes) !== record.preparedSha256) {
    throw preimageConflict('the prepared descriptor changed while the target was being applied');
  }
}

function fsyncDirectory(dir, io) {
  const fd = io.openSync(dir, fs.constants.O_RDONLY);
  try {
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}

function writeTargetJournal(journalFile, record, deps) {
  const io = deps.io;
  const dir = path.dirname(journalFile);
  const temporary = path.join(dir, `${JOURNAL_FILE}.${deps.randomUUID()}.tmp`);
  const payload = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  let fd = null;
  let owned = false;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    owned = true;
    io.writeFileSync(fd, payload);
    if (io.fstatSync(fd).size !== payload.length) {
      throw new Error('the target journal was written incompletely');
    }
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
    io.renameSync(temporary, journalFile);
    owned = false;
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
        io.unlinkSync(temporary);
      } catch {
        // Only a temporary file this call created may be cleaned up.
      }
    }
    throw journalWriteFailed(`target journal could not be published: ${journalFile}`, error);
  }
  try {
    fsyncDirectory(dir, io);
  } catch (error) {
    throw journalWriteFailed(`target journal directory could not be flushed: ${dir}`, error);
  }
  return journalFile;
}

function buildJournal(current, patch, deps) {
  return {
    schema: current.schema,
    operationId: current.operationId,
    version: current.version,
    repo: current.repo,
    repoRoot: current.repoRoot,
    repoKey: current.repoKey,
    remote: current.remote,
    remoteRef: current.remoteRef,
    pushUrlSha256: current.pushUrlSha256,
    applicationFile: current.applicationFile,
    applicationSha256: current.applicationSha256,
    preparedFile: current.preparedFile,
    preparedSha256: current.preparedSha256,
    paths: current.paths.slice(),
    requiredPaths: current.requiredPaths.slice(),
    beforeHead: current.beforeHead,
    beforeIndexFingerprint: current.beforeIndexFingerprint,
    expectedTree: current.expectedTree,
    expectedIndexFingerprint: current.expectedIndexFingerprint,
    candidateCommit: patch.candidateCommit === undefined ? current.candidateCommit : patch.candidateCommit,
    commit: patch.commit === undefined ? current.commit : patch.commit,
    phase: patch.phase,
    state: patch.state,
    reason: patch.reason === undefined ? current.reason : patch.reason,
    remoteObservation: patch.remoteObservation === undefined ? current.remoteObservation : patch.remoteObservation,
    updatedAt: timestamp(deps)
  };
}

function sameJournal(left, right) {
  for (const field of JOURNAL_FIELDS) {
    if (field === 'updatedAt') continue;
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) return false;
  }
  return true;
}

function persist(context, patch) {
  const next = buildJournal(context.journal, patch, context.deps);
  if (sameJournal(context.journal, next)) return context.journal;
  requireApplicationEvidence(next, context.deps);
  writeTargetJournal(context.journalFile, next, context.deps);
  context.journal = next;
  return next;
}

function attachJournal(error, journal, journalFile) {
  try {
    error.journal = { ...journal, journalFile };
    error.journalFile = journalFile;
  } catch {
    // the error object is not extensible
  }
  return error;
}

function persistConflict(context, error) {
  const current = persist(context, {
    phase: 'conflict',
    state: 'conflict',
    reason: { code: error.code, message: error.message }
  });
  throw attachJournal(error, current, context.journalFile);
}

function readTargetFacts(run, root, files) {
  const env = observeEnv();
  const branchProbe = gitProbe(run, root, env, ['symbolic-ref', '-q', 'HEAD']);
  if (!branchProbe.ok && !cleanMiss(branchProbe.error)) {
    throw commandFailure('git symbolic-ref -q HEAD', branchProbe.error);
  }
  const branch = branchProbe.ok ? branchProbe.stdout.trim() : '';
  const head = git(run, root, env, ['rev-parse', 'HEAD']).trim();
  const indexListing = git(run, root, env, ['ls-files', '--stage', '-z']);
  const staged = git(run, root, env, ['diff', '--cached', '--name-only', '-z']);
  const required = new Map();
  for (const file of files) {
    const absolute = path.join(root, ...file.path.split('/'));
    let stat = null;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      stat = null;
    }
    if (stat === null || stat.isSymbolicLink() || !stat.isFile()) {
      required.set(file.path, { present: false });
      continue;
    }
    required.set(file.path, {
      present: true,
      special: (stat.mode & SPECIAL_BITS) !== 0,
      mode: fileMode(stat),
      sha256: sha256(fs.readFileSync(absolute))
    });
  }
  return { branch, head, indexListing, indexFingerprint: sha256(indexListing), staged, required };
}

function bytesMatch(files, facts, side) {
  for (const file of files) {
    const now = facts.required.get(file.path);
    if (!now || !now.present || now.special || now.mode !== file.mode) return false;
    if (now.sha256 !== file[side === 'before' ? 'beforeSha256' : 'afterSha256']) return false;
  }
  return true;
}

function beforeExact(record, files, facts) {
  return facts.branch === BRANCH_REF &&
    facts.head === record.beforeHead &&
    facts.indexFingerprint === record.beforeIndexFingerprint &&
    facts.staged.length === 0 &&
    bytesMatch(files, facts, 'before');
}

function afterExact(record, files, facts) {
  return facts.branch === BRANCH_REF &&
    facts.head === record.beforeHead &&
    facts.indexFingerprint === record.expectedIndexFingerprint &&
    bytesMatch(files, facts, 'after');
}

function indexMatchesHead(facts) {
  if (facts.staged.length > 0) return false;
  for (const line of facts.indexListing.split('\0')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) return false;
    const parts = line.slice(0, tab).split(' ');
    if (parts.length !== 3 || parts[2] !== '0') return false;
  }
  return true;
}

function findEquivalentCommit(run, root, env, record) {
  const commits = git(run, root, env, ['rev-list', '--first-parent', `--max-count=${HISTORY_LIMIT}`, 'HEAD'])
    .split('\n').filter(Boolean);
  for (const commit of commits) {
    if (commit === record.beforeHead) continue;
    const parents = commitParents(run, root, env, commit);
    if (parents.length !== 2 || parents[1] !== record.beforeHead) continue;
    if (commitTree(run, root, env, commit) !== record.expectedTree) continue;
    return commit;
  }
  return null;
}

function adoptUnchangedCommit(run, root, env, record) {
  const expected = treeEntries(run, root, env, record.expectedTree, record.requiredPaths, true);
  const head = git(run, root, env, ['rev-parse', 'HEAD']).trim();
  const commits = git(run, root, env, ['rev-list', '--first-parent', `--max-count=${HISTORY_LIMIT + 1}`, head])
    .split('\n').filter(Boolean);
  if (commits.length === 0) throw historyUnresolved(`${record.repo} main has no history to resolve`);
  if (!entriesMatch(treeEntries(run, root, env, head, record.requiredPaths, false), expected)) {
    throw historyUnresolved(`${head} does not carry the prepared documentation set for ${record.repo}`);
  }
  const newest = git(run, root, env, ['rev-list', '--first-parent', '-n', '1', head, '--', ...record.requiredPaths])
    .trim();
  const position = newest.length > 0 ? commits.indexOf(newest) : -1;
  if (position >= 0 && position < HISTORY_LIMIT) {
    if (entriesMatch(treeEntries(run, root, env, newest, record.requiredPaths, false), expected)) {
      return requireProvenBoundary(run, root, env, record, expected, newest);
    }
    if (position === 0) {
      throw historyUnresolved(`${head} does not carry the prepared documentation set for ${record.repo}`);
    }
    return requireProvenBoundary(run, root, env, record, expected, commits[position - 1]);
  }
  if (commits.length > HISTORY_LIMIT) {
    throw historyUnresolved(`the documentation boundary for ${record.repo} is beyond ${HISTORY_LIMIT} commits of main`);
  }
  return requireProvenBoundary(run, root, env, record, expected, commits[commits.length - 1]);
}

function settleAdoptedCommit(context, facts, cause) {
  const { journal, application, deps } = context;
  const run = deps.run;
  const root = journal.repoRoot;
  const env = observeEnv();
  let adopted = null;
  if (journal.candidateCommit !== null &&
      (facts.head === journal.candidateCommit || isAncestor(run, root, env, journal.candidateCommit, facts.head))) {
    adopted = journal.candidateCommit;
  } else {
    adopted = findEquivalentCommit(run, root, env, journal);
  }
  if (adopted === null) {
    return persistConflict(context, preimageConflict(
      `${journal.repo} main is at ${facts.head}, which is neither the prepared candidate nor an equivalent documentation commit`,
      cause
    ));
  }
  if (indexMatchesHead(facts) && bytesMatch(application.files, facts, 'after')) {
    persist(context, { commit: adopted, phase: 'committed', state: 'pending-push', reason: null });
    return context.journal;
  }
  const reason = preimageConflict(
    `${journal.repo} holds a concurrent change beside the committed documentation commit ${adopted}`,
    cause
  );
  const current = persist(context, {
    commit: adopted,
    phase: 'committed',
    state: 'conflict',
    reason: { code: reason.code, message: reason.message }
  });
  throw attachJournal(reason, current, context.journalFile);
}

function advanceToCandidate(context, facts) {
  const { journal, application, deps } = context;
  const run = deps.run;
  const root = journal.repoRoot;
  const env = observeEnv();
  persist(context, { phase: 'ref-intent', state: 'failed', reason: REF_NOT_ADVANCED });
  deps.assertPublishWindow();
  const recheck = readTargetFacts(run, root, application.files);
  if (recheck.head !== journal.beforeHead || !afterExact(journal, application.files, recheck)) {
    return persistConflict(context, preimageConflict(
      `${journal.repo} changed before main could advance to the prepared commit`
    ));
  }
  let updateError = null;
  try {
    git(run, root, env, [
      'update-ref', '--no-deref', '-m', COMMIT_MESSAGE, BRANCH_REF, journal.candidateCommit, journal.beforeHead
    ]);
  } catch (error) {
    updateError = error;
  }
  const post = readTargetFacts(run, root, application.files);
  if (post.head !== journal.beforeHead) return settleAdoptedCommit(context, post, updateError);
  return persistConflict(context, preimageConflict(
    `${journal.repo} main did not advance to the prepared documentation commit`,
    updateError
  ));
}

function applyAndAdvance(context, facts) {
  const { journal, application, deps } = context;
  const run = deps.run;
  const root = journal.repoRoot;
  const env = observeEnv();
  deps.assertPublishWindow();
  const recheck = readTargetFacts(run, root, application.files);
  if (recheck.head !== journal.beforeHead || !beforeExact(journal, application.files, recheck)) {
    return persistConflict(context, preimageConflict(
      `${journal.repo} changed before the prepared patch could be applied`
    ));
  }
  let applyError = null;
  try {
    git(run, root, env, ['apply', '--check', '--index', '-p1', application.patchFile]);
    git(run, root, env, ['apply', '--index', '-p1', application.patchFile]);
  } catch (error) {
    applyError = error;
  }
  const after = readTargetFacts(run, root, application.files);
  if (!afterExact(journal, application.files, after)) {
    return persistConflict(context, preimageConflict(
      `the prepared patch left ${journal.repo} with neither the exact preimage nor the exact postimage`,
      applyError
    ));
  }
  persist(context, { phase: 'applied', state: 'failed', reason: REF_NOT_ADVANCED });
  return advanceToCandidate(context, after);
}

function recoverChanged(context, facts) {
  const { journal, application } = context;
  if (facts.head === journal.beforeHead) {
    if (beforeExact(journal, application.files, facts)) return applyAndAdvance(context, facts);
    if (afterExact(journal, application.files, facts)) return advanceToCandidate(context, facts);
    return persistConflict(context, preimageConflict(
      `${journal.repo} has neither the exact preimage nor the exact postimage of the prepared application`
    ));
  }
  return settleAdoptedCommit(context, facts, null);
}

function recoverUnchanged(context, facts) {
  const { journal, application, deps } = context;
  const run = deps.run;
  const root = journal.repoRoot;
  const env = observeEnv();
  if (facts.branch !== BRANCH_REF) {
    return persistConflict(context, preimageConflict(`${journal.repo} is not on ${BRANCH_REF}`));
  }
  if (journal.commit !== null) {
    if (!commitExists(run, root, env, journal.commit) ||
        !isAncestor(run, root, env, journal.commit, facts.head)) {
      return persistConflict(context, preimageConflict(
        `the recorded documentation commit ${journal.commit} is not on ${journal.repo} main`
      ));
    }
    if (!bytesMatch(application.files, facts, 'after') || !indexMatchesHead(facts)) {
      const reason = preimageConflict(
        `${journal.repo} holds a concurrent change beside the committed documentation commit ${journal.commit}`
      );
      const current = persist(context, {
        commit: journal.commit,
        phase: 'committed',
        state: 'conflict',
        reason: { code: reason.code, message: reason.message }
      });
      throw attachJournal(reason, current, context.journalFile);
    }
    persist(context, { commit: journal.commit, phase: 'committed', state: 'pending-push', reason: null });
    return context.journal;
  }
  if (!bytesMatch(application.files, facts, 'after') || !indexMatchesHead(facts)) {
    return persistConflict(context, preimageConflict(
      `${journal.repo} does not hold the prepared documentation postimages`
    ));
  }
  let boundary;
  try {
    boundary = adoptUnchangedCommit(run, root, env, journal);
  } catch (error) {
    if (error && error.code === 'DOCS_HISTORY_UNRESOLVED') return persistConflict(context, error);
    throw error;
  }
  persist(context, { candidateCommit: null, commit: boundary, phase: 'committed', state: 'pending-push', reason: null });
  return context.journal;
}

function recoverTarget(context) {
  const { journal, application, deps } = context;
  const facts = readTargetFacts(deps.run, journal.repoRoot, application.files);
  if (journal.paths.length === 0) return recoverUnchanged(context, facts);
  return recoverChanged(context, facts);
}

function lockIdentity(identity) {
  return {
    key: identity.key,
    root: identity.root,
    commonDir: identity.commonDir,
    branch: identity.branch,
    remote: identity.remote,
    remoteRef: identity.remoteRef,
    pushUrlSha256: identity.pushUrlSha256,
    objectFormat: identity.objectFormat
  };
}

function runUnderLocks(identity, deps, callback) {
  return withDocsLock(lockIdentity(identity), () => deps.ferry(identity.root, callback, deps.ferryOptions), {
    cacheRoot: deps.cacheRoot
  });
}

async function prepareCommitIntent(input, deps) {
  const resolved = resolveActingDeps(deps);
  const { applicationFile, journalFile, message } = input || {};
  if (typeof message !== 'string' || message.length === 0) {
    throw depsInvalid('prepareCommitIntent message must be a nonempty string');
  }
  if (message.includes('\0')) throw depsInvalid('prepareCommitIntent message must not contain NUL');
  if (typeof journalFile !== 'string' || !path.isAbsolute(journalFile) || path.basename(journalFile) !== JOURNAL_FILE) {
    throw journalInvalid(`journalFile must be exactly <outDir>/${JOURNAL_FILE}`);
  }
  if (typeof applicationFile !== 'string' || !path.isAbsolute(applicationFile) ||
      path.basename(applicationFile) !== APPLICATION_FILE) {
    throw journalInvalid(`applicationFile must be exactly <outDir>/${APPLICATION_FILE}`);
  }
  if (path.dirname(journalFile) !== path.dirname(applicationFile)) {
    throw journalInvalid('journalFile must live beside its application file');
  }
  const application = verifyDocsApplication(applicationFile, { run: resolved.run });
  const identity = observeTargetIdentity(resolved.run, application.repoRoot);

  const buildBase = (verified, evidence, observed) => ({
    schema: SCHEMA,
    operationId: resolved.randomUUID(),
    version: verified.version,
    repo: verified.repo,
    repoRoot: observed.root,
    repoKey: observed.key,
    remote: REMOTE,
    remoteRef: REMOTE_REF,
    pushUrlSha256: observed.pushUrlSha256,
    applicationFile,
    applicationSha256: evidence.sha256,
    preparedFile: verified.preparedFile,
    preparedSha256: verified.preparedSha256,
    paths: verified.paths.slice(),
    requiredPaths: verified.requiredPaths.slice(),
    beforeHead: verified.beforeHead,
    beforeIndexFingerprint: verified.beforeIndexFingerprint,
    expectedTree: verified.expectedTree,
    expectedIndexFingerprint: verified.expectedIndexFingerprint,
    candidateCommit: null,
    commit: null,
    phase: 'apply-intent',
    state: 'failed',
    reason: APPLY_NOT_FINISHED,
    remoteObservation: null,
    updatedAt: timestamp(resolved)
  });

  return runUnderLocks(identity, resolved, () => {
    requireMissingJournal(journalFile, resolved.io);
    const lockedApplication = verifyDocsApplication(applicationFile, { run: resolved.run });
    const lockedEvidence = readApplicationEvidence(applicationFile, resolved.io);
    const lockedIdentity = observeTargetIdentity(resolved.run, lockedApplication.repoRoot);
    if (lockedIdentity.root !== identity.root || lockedIdentity.key !== identity.key ||
        lockedIdentity.pushUrlSha256 !== identity.pushUrlSha256) {
      throw identityInvalid('target repository identity changed before the docs lock was acquired');
    }
    const base = buildBase(lockedApplication, lockedEvidence, lockedIdentity);
    const context = { journalFile, journal: base, application: lockedApplication, deps: resolved };
    const facts = readTargetFacts(resolved.run, base.repoRoot, lockedApplication.files);
    if (facts.branch !== BRANCH_REF) {
      throw preimageConflict(`${base.repo} is not on ${BRANCH_REF}`);
    }
    if (base.paths.length === 0) {
      return recoverUnchanged(context, facts);
    }
    if (!beforeExact(base, lockedApplication.files, facts)) {
      throw preimageConflict(`${base.repo} does not hold the exact before state of the prepared application`);
    }
    resolved.assertPublishWindow();
    const candidateCommit = createCandidate(base, message, resolved);
    const journal = buildJournal(base, {
      candidateCommit,
      commit: null,
      phase: 'apply-intent',
      state: 'failed',
      reason: APPLY_NOT_FINISHED
    }, resolved);
    requireApplicationEvidence(journal, resolved);
    writeTargetJournal(journalFile, journal, resolved);
    context.journal = journal;
    return journal;
  }).then((journal) => ({ ...journal, journalFile }));
}

function createCandidate(record, message, deps) {
  const run = deps.run;
  const root = record.repoRoot;
  const env = observeEnv();
  const candidateCommit = git(run, root, env, [
    'commit-tree', record.expectedTree, '-p', record.beforeHead, '-m', message
  ]).trim();
  if (!OID_PATTERN.test(candidateCommit)) {
    throw applicationInvalid('commit-tree did not return a full object id');
  }
  requireCandidateInvariants({ ...record, candidateCommit }, run, root, env);
  return candidateCommit;
}

async function runTargetOperation(input, deps) {
  const resolved = resolveActingDeps(deps);
  const { journalFile } = input || {};
  const initial = loadTargetRecord(journalFile, resolved);
  return runUnderLocks(initial.identity, resolved, () => {
    const current = loadTargetRecord(journalFile, resolved);
    if (current.identity.root !== initial.identity.root || current.identity.key !== initial.identity.key ||
        current.identity.pushUrlSha256 !== initial.identity.pushUrlSha256) {
      throw identityInvalid('target repository identity changed before the docs lock was acquired');
    }
    const context = { journalFile, journal: current.journal, application: current.application, deps: resolved };
    return recoverTarget(context);
  }).then((result) => ({ ...result, journalFile }));
}

function applyPreparedTarget(input, deps) {
  return runTargetOperation(input, deps);
}

function reconcileTarget(input, deps) {
  return runTargetOperation(input, deps);
}

function remoteEnv() {
  return { ...observeEnv(), GIT_TERMINAL_PROMPT: '0' };
}

function redactRemoteText(destination, value) {
  const text = value === undefined || value === null
    ? ''
    : (Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  let redacted = text;
  if (typeof destination === 'string' && destination.length > 0) {
    redacted = redacted.split(destination).join(DESTINATION_PLACEHOLDER);
  }
  return redacted.replace(USERINFO_PATTERN, `$1${CREDENTIAL_PLACEHOLDER}@`);
}

function remoteDiagnostic(destination, result) {
  const outcome = result === undefined || result === null ? {} : result;
  const failure = outcome.error;
  return {
    status: typeof outcome.status === 'number' ? outcome.status : null,
    signal: typeof outcome.signal === 'string' && outcome.signal.length > 0 ? outcome.signal : null,
    code: failure && typeof failure.code === 'string' ? failure.code : null,
    stdout: redactRemoteText(destination, outcome.stdout),
    stderr: redactRemoteText(destination, outcome.stderr)
  };
}

function remoteLabel(destination, args) {
  return redactRemoteText(destination, `git ${args.join(' ')}`);
}

function remoteFailureMessage(destination, args, diagnostic) {
  const details = [];
  if (diagnostic.status !== null) details.push(`exit ${diagnostic.status}`);
  if (diagnostic.signal !== null) details.push(`signal ${diagnostic.signal}`);
  if (diagnostic.code !== null) details.push(`code ${diagnostic.code}`);
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `${remoteLabel(destination, args)} failed${suffix}`;
}

function runRemote(context, destination, args, timeoutMs) {
  let result;
  try {
    result = context.deps.spawnRemote('git', args, {
      cwd: context.journal.repoRoot,
      env: remoteEnv(),
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
      maxBuffer: REMOTE_OUTPUT_LIMIT
    });
  } catch (error) {
    result = { status: null, signal: null, stdout: '', stderr: '', error };
  }
  const diagnostic = remoteDiagnostic(destination, result);
  releaseCommand.writeOutput(1, diagnostic.stdout);
  releaseCommand.writeOutput(2, diagnostic.stderr);
  const failed = diagnostic.code !== null || diagnostic.signal !== null || diagnostic.status !== 0;
  return { failed, diagnostic };
}

function parseRemoteListing(stdout, objectFormat) {
  const rows = String(stdout === undefined || stdout === null ? '' : stdout)
    .split('\n')
    .filter((line) => line.length > 0);
  if (rows.length === 0) {
    return { ok: false, message: `the ${REMOTE} push destination does not advertise ${BRANCH_REF}` };
  }
  if (rows.length !== 1) {
    return { ok: false, message: `the ${REMOTE} push destination advertised ${rows.length} rows for ${BRANCH_REF}` };
  }
  const columns = rows[0].split('\t');
  if (columns.length !== 2) {
    return { ok: false, message: `the ${REMOTE} push destination listing is not tab delimited` };
  }
  if (columns[1] !== BRANCH_REF) {
    return { ok: false, message: `the ${REMOTE} push destination advertised ${columns[1]} instead of ${BRANCH_REF}` };
  }
  if (!OID_PATTERN.test(columns[0]) || columns[0].length !== expectedOidLength(objectFormat)) {
    return { ok: false, message: `the ${REMOTE} push destination advertised a malformed ${BRANCH_REF} object id` };
  }
  return { ok: true, head: columns[0] };
}

function ancestry(run, cwd, env, ancestor, descendant) {
  const probe = gitProbe(run, cwd, env, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (probe.ok) return { ok: true, value: true };
  if (probe.error && probe.error.status === 1 && probe.error.cause === undefined && !probe.error.signal) {
    return { ok: true, value: false };
  }
  return { ok: false, error: probe.error };
}

function isShallowRepository(run, cwd, env) {
  const probe = gitProbe(run, cwd, env, ['rev-parse', '--is-shallow-repository']);
  if (!probe.ok) return { ok: false, error: probe.error };
  const value = probe.stdout.trim();
  if (value !== 'true' && value !== 'false') return { ok: false, error: null };
  return { ok: true, value: value === 'true' };
}

function remotePostimagesMatch(run, cwd, env, record, head) {
  try {
    const expected = treeEntries(run, cwd, env, record.expectedTree, record.requiredPaths, true);
    const actual = treeEntries(run, cwd, env, head, record.requiredPaths, false);
    return { ok: true, value: entriesMatch(actual, expected) };
  } catch (error) {
    return { ok: false, error };
  }
}

function buildObservation(deps, head, containsCommit, postimagesMatch) {
  return { head, observedAt: timestamp(deps), containsCommit, postimagesMatch };
}

function observeRemote(context, destination) {
  const { deps, journal, identity } = context;
  const run = deps.run;
  const root = journal.repoRoot;
  const env = observeEnv();
  const listingArgs = ['ls-remote', '--refs', destination, BRANCH_REF];
  const listing = runRemote(context, destination, listingArgs, REMOTE_READ_TIMEOUT_MS);
  if (listing.failed) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteUnreadable(remoteFailureMessage(destination, listingArgs, listing.diagnostic), listing.diagnostic)
    };
  }
  const parsed = parseRemoteListing(listing.diagnostic.stdout, identity.objectFormat);
  if (!parsed.ok) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteUnreadable(redactRemoteText(destination, parsed.message), listing.diagnostic)
    };
  }
  const head = parsed.head;
  if (!commitExists(run, root, env, head)) {
    const fetchArgs = ['fetch', '--no-tags', '--no-write-fetch-head', destination, head];
    const fetched = runRemote(context, destination, fetchArgs, REMOTE_READ_TIMEOUT_MS);
    if (fetched.failed || !commitExists(run, root, env, head)) {
      const message = fetched.failed
        ? remoteFailureMessage(destination, fetchArgs, fetched.diagnostic)
        : `the observed ${REMOTE} commit ${head} is still missing from ${journal.repo}`;
      return { status: OBSERVATION_UNRESOLVED, error: remoteObjectMissing(message, fetched.diagnostic) };
    }
  }
  const contained = ancestry(run, root, env, journal.commit, head);
  if (!contained.ok) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteHistoryUnresolved(`the ancestry of the observed ${REMOTE} commit ${head} could not be resolved`, contained.error)
    };
  }
  const content = remotePostimagesMatch(run, root, env, journal, head);
  if (!content.ok) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteUnreadable(`the required content of the observed ${REMOTE} commit ${head} could not be read`, content.error)
    };
  }
  const observation = buildObservation(deps, head, contained.value, content.value);
  if (contained.value && content.value) return { status: OBSERVATION_COMPLETE, head, observation };
  if (contained.value) {
    return {
      status: OBSERVATION_CONTENT_CONFLICT,
      head,
      observation,
      error: remoteContentConflict(`the observed ${REMOTE} commit ${head} no longer carries the prepared documentation set`)
    };
  }
  const behind = ancestry(run, root, env, head, journal.commit);
  if (!behind.ok) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteHistoryUnresolved(`the ancestry of the recorded commit ${journal.commit} under ${head} could not be resolved`, behind.error)
    };
  }
  if (behind.value) return { status: OBSERVATION_BEHIND, head, observation };
  const shallow = isShallowRepository(run, root, env);
  if (!shallow.ok || shallow.value) {
    return {
      status: OBSERVATION_UNRESOLVED,
      error: remoteHistoryUnresolved(`the ${journal.repo} history cannot prove whether ${head} and ${journal.commit} diverge`, shallow.error)
    };
  }
  return {
    status: OBSERVATION_DIVERGED,
    head,
    observation,
    error: remoteDiverged(`the observed ${REMOTE} commit ${head} has diverged from the recorded documentation commit ${journal.commit}`)
  };
}

function persistPending(context, error, observation) {
  const current = persist(context, {
    phase: context.journal.phase === 'push-intent' ? 'push-intent' : 'committed',
    state: 'pending-push',
    reason: { code: error.code, message: error.message },
    remoteObservation: observation
  });
  throw attachJournal(error, current, context.journalFile);
}

function persistObservationConflict(context, error, observation) {
  const current = persist(context, {
    phase: 'conflict',
    state: 'conflict',
    reason: { code: error.code, message: error.message },
    remoteObservation: observation
  });
  throw attachJournal(error, current, context.journalFile);
}

function pushRecordedCommit(context, destination, first) {
  const { deps, journal, identity } = context;
  persist(context, {
    phase: 'push-intent',
    state: 'pending-push',
    reason: null,
    remoteObservation: first.observation
  });
  const current = observeTargetIdentity(deps.run, journal.repoRoot);
  if (current.root !== identity.root || current.key !== identity.key ||
      current.pushUrlSha256 !== identity.pushUrlSha256 || current.pushDestination !== destination) {
    throw identityInvalid(`the ${REMOTE} push destination of ${journal.repo} changed before the documentation push`);
  }
  deps.assertPublishWindow();
  const pushArgs = ['push', '--porcelain', destination, `${journal.commit}:${BRANCH_REF}`];
  const pushed = runRemote(context, destination, pushArgs, REMOTE_PUSH_TIMEOUT_MS);
  const second = observeRemote(context, destination);
  if (second.status === OBSERVATION_COMPLETE) {
    const completed = persist(context, {
      phase: 'complete',
      state: 'complete',
      reason: null,
      remoteObservation: second.observation
    });
    return { ...completed, push: pushed.diagnostic };
  }
  if (second.status === OBSERVATION_CONTENT_CONFLICT || second.status === OBSERVATION_DIVERGED) {
    return persistObservationConflict(context, second.error, second.observation);
  }
  const error = pushed.failed
    ? remotePushFailed(remoteFailureMessage(destination, pushArgs, pushed.diagnostic), pushed.diagnostic)
    : remotePushUnconfirmed(
      `${remoteLabel(destination, pushArgs)} exited 0 but ${REMOTE} does not show the recorded documentation commit ${journal.commit}`,
      pushed.diagnostic
    );
  return persistPending(context, error, second.observation);
}

function reconcilePush(context) {
  const { journal, identity } = context;
  if (journal.phase === 'conflict' || journal.state === 'conflict') {
    throw localConflict(`the ${journal.repo} target is locally conflicted; reconcile the local documentation state first`);
  }
  if (journal.commit === null) {
    throw applyNotFinished(`the ${journal.repo} target has no recorded documentation commit yet`);
  }
  const destination = identity.pushDestination;
  const first = observeRemote(context, destination);
  if (first.status === OBSERVATION_COMPLETE) {
    return persist(context, {
      phase: 'complete',
      state: 'complete',
      reason: null,
      remoteObservation: first.observation
    });
  }
  if (first.status === OBSERVATION_CONTENT_CONFLICT || first.status === OBSERVATION_DIVERGED) {
    return persistObservationConflict(context, first.error, first.observation);
  }
  if (first.status === OBSERVATION_BEHIND) {
    return pushRecordedCommit(context, destination, first);
  }
  return persistPending(context, first.error, first.observation);
}

async function reconcileTargetPush(input, deps) {
  const resolved = resolveActingDeps(deps);
  const { journalFile } = input || {};
  const initial = loadTargetRecord(journalFile, resolved);
  return withDocsLock(lockIdentity(initial.identity), () => {
    const current = loadTargetRecord(journalFile, resolved);
    if (current.identity.root !== initial.identity.root || current.identity.key !== initial.identity.key ||
        current.identity.pushUrlSha256 !== initial.identity.pushUrlSha256) {
      throw identityInvalid('target repository identity changed before the docs lock was acquired');
    }
    const context = {
      journalFile,
      journal: current.journal,
      application: current.application,
      identity: current.identity,
      deps: resolved
    };
    return reconcilePush(context);
  }, { cacheRoot: resolved.cacheRoot }).then((journal) => ({ ...journal, journalFile }));
}

module.exports = {
  prepareCommitIntent, applyPreparedTarget, reconcileTarget, readTargetJournal, reconcileTargetPush
};
