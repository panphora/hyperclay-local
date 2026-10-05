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
const { withDocsLock } = require('./release-lock');
const { withFerryRepoLock } = require('./release-ferry');
const { verifyDocsApplication } = require('./release-docs-plan');

const SCHEMA = 1;
const JOURNAL_FILE = 'target.json';
const APPLICATION_FILE = 'application.json';
const REMOTE = 'origin';
const BRANCH_REF = 'refs/heads/main';
const REMOTE_REF = 'refs/heads/main';
const COMMIT_MESSAGE = 'release documentation';
const HISTORY_LIMIT = 1000;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const GIT_MODE_PATTERN = /^[0-7]{6}$/;
const PERMISSION_BITS = 0o777;
const SPECIAL_BITS = 0o7000;
const REPO_NAMES = ['hyperclay', 'hyperclay-website'];
const OBJECT_FORMATS = ['sha1', 'sha256'];
const UNFINISHED_PHASES = ['prepared', 'apply-intent', 'applied', 'ref-intent'];
const COMMITTED_PHASES = ['committed', 'push-intent'];
const PHASES = UNFINISHED_PHASES.concat(COMMITTED_PHASES, ['complete', 'conflict']);
const STATES = ['failed', 'pending-push', 'conflict', 'complete'];
const REASON_FIELDS = ['code', 'message'];
const JOURNAL_FIELDS = [
  'schema', 'operationId', 'version', 'repo', 'repoRoot', 'repoKey', 'remote', 'remoteRef', 'pushUrlSha256',
  'applicationFile', 'applicationSha256', 'preparedFile', 'preparedSha256', 'paths', 'requiredPaths', 'beforeHead',
  'beforeIndexFingerprint', 'expectedTree', 'expectedIndexFingerprint', 'candidateCommit', 'commit', 'phase', 'state',
  'reason', 'remoteObservation', 'updatedAt'
];
const APPLY_NOT_FINISHED = { code: 'APPLY_NOT_FINISHED', message: 'prepared application has not completed' };
const REF_NOT_ADVANCED = { code: 'REF_NOT_ADVANCED', message: 'documentation is applied but main has not advanced' };
const REMOTE_READ_TIMEOUT_MS = 30000;
const REMOTE_PUSH_TIMEOUT_MS = 120000;
const REMOTE_OUTPUT_LIMIT = 1024 * 1024;
const OBSERVATION_FIELDS = ['head', 'observedAt', 'containsCommit', 'postimagesMatch'];
const OBSERVATION_COMPLETE = 'complete';
const OBSERVATION_CONTENT_CONFLICT = 'content-conflict';
const OBSERVATION_DIVERGED = 'diverged';
const OBSERVATION_BEHIND = 'behind';
const OBSERVATION_UNRESOLVED = 'unresolved';
const DESTINATION_PLACEHOLDER = '<push-destination>';
const CREDENTIAL_PLACEHOLDER = '<redacted>';
const USERINFO_PATTERN = /([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)[^/@\s]*@/g;

function stateError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function journalInvalid(message, cause) {
  return stateError('DOCS_JOURNAL_INVALID', message, cause);
}

function journalWriteFailed(message, cause) {
  return stateError('DOCS_JOURNAL_WRITE_FAILED', message, cause);
}

function identityInvalid(message, cause) {
  return stateError('DOCS_TARGET_IDENTITY_INVALID', message, cause);
}

function applicationInvalid(message, cause) {
  return stateError('DOCS_APPLICATION_INVALID', message, cause);
}

function depsInvalid(message) {
  return stateError('DOCS_APPLY_DEPS_INVALID', message);
}

function preimageConflict(message, cause) {
  return stateError('DOCS_PREIMAGE_CONFLICT', message, cause);
}

function historyUnresolved(message, cause) {
  return stateError('DOCS_HISTORY_UNRESOLVED', message, cause);
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

function commandFailure(label, cause) {
  const error = new Error(`${label} failed`);
  error.status = cause === undefined ? undefined : cause.status;
  error.signal = cause === undefined ? undefined : cause.signal;
  error.stdout = cause === undefined ? undefined : cause.stdout;
  error.stderr = cause === undefined ? undefined : cause.stderr;
  error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileMode(stat) {
  return (stat.mode & PERMISSION_BITS).toString(8);
}

function requireRelativePath(rel, label) {
  if (typeof rel !== 'string' || rel.length === 0) throw new Error(`${label} must be a nonempty string`);
  if (rel.includes('\0')) throw new Error(`${label} must not contain NUL`);
  if (rel.startsWith('/') || path.isAbsolute(rel)) throw new Error(`${label} must be relative: ${rel}`);
  for (const part of rel.split('/')) {
    if (part === '' || part === '.' || part === '..') throw new Error(`${label} has an invalid component: ${rel}`);
  }
  return rel;
}

function observeEnv() {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
}

function git(run, cwd, env, args, options = {}) {
  try {
    return run('git', args, { cwd, env, echoStdout: false, ...options });
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('DOCS_')) throw error;
    throw commandFailure(`git ${args.join(' ')}`, error);
  }
}

function gitProbe(run, cwd, env, args) {
  try {
    return { ok: true, stdout: run('git', args, { cwd, env, echoStdout: false }) };
  } catch (error) {
    return { ok: false, error };
  }
}

function cleanMiss(error) {
  return Boolean(error) && error.cause === undefined && !error.signal && typeof error.status === 'number' && error.status !== 0;
}

function isAncestor(run, cwd, env, ancestor, descendant) {
  const probe = gitProbe(run, cwd, env, ['merge-base', '--is-ancestor', ancestor, descendant]);
  if (probe.ok) return true;
  if (probe.error && probe.error.status === 1 && probe.error.cause === undefined && !probe.error.signal) return false;
  throw commandFailure(`git merge-base --is-ancestor ${ancestor} ${descendant}`, probe.error);
}

function requireRealDirectory(dir, label) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (error) {
    throw identityInvalid(`${label} is missing: ${dir}`, error);
  }
  if (!fs.statSync(real).isDirectory()) throw identityInvalid(`${label} is not a directory: ${real}`);
  return real;
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
  const io = provided.fs === undefined ? fs : provided.fs;
  if (typeof run !== 'function') throw depsInvalid('docs apply run must be a function');
  if (typeof io !== 'object' || io === null) throw depsInvalid('docs apply fs must be an object');
  return { run, io };
}

function resolveActingDeps(deps) {
  const { run, io } = resolveReadDeps(deps);
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

function readApplicationEvidence(applicationFile, io) {
  if (typeof applicationFile !== 'string' || applicationFile.length === 0) {
    throw journalInvalid('applicationFile is required');
  }
  if (!path.isAbsolute(applicationFile)) throw journalInvalid('applicationFile must be an absolute path');
  if (path.basename(applicationFile) !== APPLICATION_FILE) {
    throw journalInvalid(`applicationFile must be exactly <outDir>/${APPLICATION_FILE}`);
  }
  let stat;
  try {
    stat = io.lstatSync(applicationFile);
  } catch (error) {
    throw journalInvalid(`application file is missing: ${applicationFile}`, error);
  }
  if (stat.isSymbolicLink()) throw journalInvalid(`application file must not be a symlink: ${applicationFile}`);
  if (!stat.isFile()) throw journalInvalid(`application file must be a regular file: ${applicationFile}`);
  let bytes;
  try {
    bytes = io.readFileSync(applicationFile);
  } catch (error) {
    throw journalInvalid(`application file could not be read: ${applicationFile}`, error);
  }
  return { bytes, sha256: sha256(bytes) };
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

function requireReason(reason, label) {
  if (reason === null) return null;
  if (typeof reason !== 'object' || Array.isArray(reason)) throw journalInvalid(`${label} must be null or an object`);
  const keys = Object.keys(reason).slice().sort();
  const wanted = REASON_FIELDS.slice().sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw journalInvalid(`${label} fields do not match schema 1`);
  }
  if (typeof reason.code !== 'string' || reason.code.length === 0) throw journalInvalid(`${label} code must be a nonempty string`);
  if (typeof reason.message !== 'string' || reason.message.length === 0) {
    throw journalInvalid(`${label} message must be a nonempty string`);
  }
  return { code: reason.code, message: reason.message };
}

function requireRemoteObservation(observation) {
  if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) {
    throw journalInvalid('target journal remoteObservation must be null or an object');
  }
  const keys = Object.keys(observation).slice().sort();
  const wanted = OBSERVATION_FIELDS.slice().sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw journalInvalid('target journal remoteObservation fields do not match schema 1');
  }
  if (typeof observation.head !== 'string' || !OID_PATTERN.test(observation.head)) {
    throw journalInvalid('target journal remoteObservation head must be a full object id');
  }
  if (typeof observation.observedAt !== 'string' || Number.isNaN(Date.parse(observation.observedAt))) {
    throw journalInvalid('target journal remoteObservation observedAt must be an ISO timestamp');
  }
  for (const field of ['containsCommit', 'postimagesMatch']) {
    if (typeof observation[field] !== 'boolean') {
      throw journalInvalid(`target journal remoteObservation ${field} must be a boolean`);
    }
  }
}

function requireCompletedJournal(record) {
  if (record.commit === null) throw journalInvalid('a complete target journal must record its commit');
  if (record.reason !== null) throw journalInvalid('a complete target journal must not record a reason');
  if (record.remoteObservation === null || record.remoteObservation.containsCommit !== true ||
      record.remoteObservation.postimagesMatch !== true) {
    throw journalInvalid('a complete target journal must record remote proof that contains the commit and matches the required content');
  }
}

function requireJournalShape(record, journalFile) {
  if (record.schema !== SCHEMA) throw journalInvalid('target journal schema must be 1');
  if (typeof record.operationId !== 'string' || !UUID_PATTERN.test(record.operationId)) {
    throw journalInvalid('target journal operationId must be a UUID');
  }
  if (typeof record.version !== 'string' || !VERSION_PATTERN.test(record.version)) {
    throw journalInvalid('target journal version must look like 1.2.3');
  }
  if (!REPO_NAMES.includes(record.repo)) {
    throw journalInvalid('target journal repo must be hyperclay or hyperclay-website');
  }
  if (typeof record.repoRoot !== 'string' || !path.isAbsolute(record.repoRoot)) {
    throw journalInvalid('target journal repoRoot must be absolute');
  }
  if (typeof record.repoKey !== 'string' || !HASH_PATTERN.test(record.repoKey)) {
    throw journalInvalid('target journal repoKey must be a sha256 hex digest');
  }
  if (record.remote !== REMOTE) throw journalInvalid(`target journal remote must be ${REMOTE}`);
  if (record.remoteRef !== REMOTE_REF) throw journalInvalid(`target journal remoteRef must be ${REMOTE_REF}`);
  if (typeof record.pushUrlSha256 !== 'string' || !HASH_PATTERN.test(record.pushUrlSha256)) {
    throw journalInvalid('target journal pushUrlSha256 must be a sha256 hex digest');
  }
  if (typeof record.applicationFile !== 'string' || !path.isAbsolute(record.applicationFile) ||
      path.basename(record.applicationFile) !== APPLICATION_FILE) {
    throw journalInvalid(`target journal applicationFile must be exactly <outDir>/${APPLICATION_FILE}`);
  }
  if (record.applicationFile !== path.join(path.dirname(journalFile), APPLICATION_FILE)) {
    throw journalInvalid('target journal must live beside its application file');
  }
  if (typeof record.applicationSha256 !== 'string' || !HASH_PATTERN.test(record.applicationSha256)) {
    throw journalInvalid('target journal applicationSha256 must be a sha256 hex digest');
  }
  if (typeof record.preparedFile !== 'string' || !path.isAbsolute(record.preparedFile)) {
    throw journalInvalid('target journal preparedFile must be absolute');
  }
  if (typeof record.preparedSha256 !== 'string' || !HASH_PATTERN.test(record.preparedSha256)) {
    throw journalInvalid('target journal preparedSha256 must be a sha256 hex digest');
  }
  if (!Array.isArray(record.paths)) throw journalInvalid('target journal paths must be an array');
  for (const name of record.paths) requireRelativePath(name, 'target journal path');
  if (new Set(record.paths).size !== record.paths.length) throw journalInvalid('target journal paths must be unique');
  if (!Array.isArray(record.requiredPaths) || record.requiredPaths.length === 0) {
    throw journalInvalid('target journal requiredPaths must be a nonempty array');
  }
  for (const name of record.requiredPaths) requireRelativePath(name, 'target journal required path');
  if (new Set(record.requiredPaths).size !== record.requiredPaths.length) {
    throw journalInvalid('target journal requiredPaths must be unique');
  }
  for (const name of record.paths) {
    if (!record.requiredPaths.includes(name)) throw journalInvalid(`target journal path ${name} is not a required path`);
  }
  for (const [field, label] of [['beforeHead', 'beforeHead'], ['expectedTree', 'expectedTree']]) {
    if (typeof record[field] !== 'string' || !OID_PATTERN.test(record[field])) {
      throw journalInvalid(`target journal ${label} must be a full object id`);
    }
  }
  for (const field of ['beforeIndexFingerprint', 'expectedIndexFingerprint']) {
    if (typeof record[field] !== 'string' || !HASH_PATTERN.test(record[field])) {
      throw journalInvalid(`target journal ${field} must be a sha256 hex digest`);
    }
  }
  for (const field of ['candidateCommit', 'commit']) {
    if (record[field] !== null && (typeof record[field] !== 'string' || !OID_PATTERN.test(record[field]))) {
      throw journalInvalid(`target journal ${field} must be null or a full object id`);
    }
  }
  if (record.paths.length > 0 && record.candidateCommit === null) {
    throw journalInvalid('a target journal with changed paths must record its candidate commit');
  }
  if (record.paths.length === 0 && record.candidateCommit !== null) {
    throw journalInvalid('a target journal without changed paths must not record a candidate commit');
  }
  if (!PHASES.includes(record.phase)) throw journalInvalid(`target journal phase is unknown: ${JSON.stringify(record.phase)}`);
  if (!STATES.includes(record.state)) throw journalInvalid(`target journal state is unknown: ${JSON.stringify(record.state)}`);
  if (UNFINISHED_PHASES.includes(record.phase) && record.commit !== null) {
    throw journalInvalid('an unfinished target journal must not record a commit');
  }
  if (COMMITTED_PHASES.includes(record.phase) && record.commit === null) {
    throw journalInvalid('a committed target journal must record its commit');
  }
  if (UNFINISHED_PHASES.includes(record.phase) && !['failed', 'conflict'].includes(record.state)) {
    throw journalInvalid('an unfinished target journal must be failed or conflicted');
  }
  if (COMMITTED_PHASES.includes(record.phase) && !['pending-push', 'conflict'].includes(record.state)) {
    throw journalInvalid('a committed target journal is pending-push or conflicted');
  }
  if (record.phase === 'complete' && record.state !== 'complete') {
    throw journalInvalid('a complete target journal must be complete');
  }
  if (record.phase === 'conflict' && record.state !== 'conflict') {
    throw journalInvalid('a conflicted target journal must report conflict');
  }
  requireReason(record.reason, 'target journal reason');
  if (record.state === 'failed' && record.reason === null) {
    throw journalInvalid('a failed target journal must record a reason');
  }
  if (record.remoteObservation !== null) requireRemoteObservation(record.remoteObservation);
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) {
    throw journalInvalid('target journal updatedAt must be an ISO timestamp');
  }
  if (record.phase === 'complete') requireCompletedJournal(record);
}

function requireJournalApplicationMatch(record, application) {
  const wanted = {
    repo: application.repo,
    version: application.version,
    repoRoot: application.repoRoot,
    preparedFile: application.preparedFile,
    preparedSha256: application.preparedSha256,
    beforeHead: application.beforeHead,
    beforeIndexFingerprint: application.beforeIndexFingerprint,
    expectedTree: application.expectedTree,
    expectedIndexFingerprint: application.expectedIndexFingerprint
  };
  for (const [field, value] of Object.entries(wanted)) {
    if (record[field] !== value) throw journalInvalid(`target journal ${field} does not match the application`);
  }
  if (record.applicationFile !== application.applicationFile) {
    throw journalInvalid('target journal applicationFile does not match the application');
  }
  for (const field of ['paths', 'requiredPaths']) {
    const mine = record[field];
    const theirs = application[field];
    if (mine.length !== theirs.length || mine.some((name, index) => name !== theirs[index])) {
      throw journalInvalid(`target journal ${field} do not match the application`);
    }
  }
}

function requireJournalIdentityMatch(record, identity) {
  if (record.repoRoot !== identity.root) throw journalInvalid('target journal repoRoot is not the canonical repository root');
  if (record.repoKey !== identity.key) throw journalInvalid('target journal repoKey is not the canonical common directory digest');
  if (record.pushUrlSha256 !== identity.pushUrlSha256) {
    throw journalInvalid(`target journal pushUrlSha256 does not match the current ${REMOTE} push destination`);
  }
}

function commitParents(run, cwd, env, oid) {
  return git(run, cwd, env, ['rev-list', '--parents', '-n', '1', oid]).trim().split(' ').filter(Boolean);
}

function commitTree(run, cwd, env, oid) {
  return git(run, cwd, env, ['rev-parse', `${oid}^{tree}`]).trim();
}

function commitExists(run, cwd, env, oid) {
  const probe = gitProbe(run, cwd, env, ['rev-parse', '--verify', `${oid}^{commit}`]);
  if (!probe.ok) {
    if (cleanMiss(probe.error)) return false;
    throw commandFailure(`git rev-parse --verify ${oid}^{commit}`, probe.error);
  }
  return probe.stdout.trim() === oid;
}

function treeEntries(run, cwd, env, treeish, paths, strict) {
  const listing = git(run, cwd, env, ['ls-tree', '-z', treeish, '--', ...paths]);
  const entries = new Map();
  for (const line of listing.split('\0')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw applicationInvalid(`${treeish} listing is malformed`);
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    const name = line.slice(tab + 1);
    if (!GIT_MODE_PATTERN.test(mode) || !OID_PATTERN.test(oid)) throw applicationInvalid(`${treeish} entry is malformed: ${name}`);
    if (entries.has(name)) throw applicationInvalid(`${treeish} lists ${name} more than once`);
    entries.set(name, { mode, type, oid });
  }
  if (strict) {
    for (const name of paths) {
      const entry = entries.get(name);
      if (!entry) throw applicationInvalid(`${name} is missing from ${treeish}`);
      if (entry.type !== 'blob') throw applicationInvalid(`${name} must be a blob in ${treeish}`);
      if (entry.mode !== '100644' && entry.mode !== '100755') {
        throw applicationInvalid(`${name} must be a regular Git file in ${treeish}`);
      }
    }
  }
  return entries;
}

function entriesMatch(entries, expected) {
  if (entries.size !== expected.size) return false;
  for (const [name, entry] of expected) {
    const other = entries.get(name);
    if (!other || other.mode !== entry.mode || other.oid !== entry.oid) return false;
  }
  return true;
}

function requireExactChangedSet(run, cwd, env, from, tree, paths, label) {
  const names = git(run, cwd, env, ['diff', '--name-only', '-z', from, tree]).split('\0').filter(Boolean).sort();
  const wanted = paths.slice().sort();
  if (names.length !== wanted.length || names.some((name, index) => name !== wanted[index])) {
    throw applicationInvalid(`${label} changed set does not match the prepared paths`);
  }
}

function requireCandidateInvariants(record, run, cwd, env) {
  if (!commitExists(run, cwd, env, record.candidateCommit)) {
    throw applicationInvalid(`candidate commit ${record.candidateCommit} does not exist`);
  }
  const parents = commitParents(run, cwd, env, record.candidateCommit);
  if (parents.length !== 2 || parents[1] !== record.beforeHead) {
    throw applicationInvalid('candidate commit must have exactly one parent: beforeHead');
  }
  if (commitTree(run, cwd, env, record.candidateCommit) !== record.expectedTree) {
    throw applicationInvalid('candidate commit tree does not match expectedTree');
  }
  requireExactChangedSet(run, cwd, env, record.beforeHead, record.expectedTree, record.paths, 'candidate commit');
}

function requireJournalCommit(record, run, cwd, env) {
  if (record.candidateCommit !== null) requireCandidateInvariants(record, run, cwd, env);
  if (record.commit === null) return;
  if (!commitExists(run, cwd, env, record.commit)) {
    throw journalInvalid(`target journal commit ${record.commit} does not exist`);
  }
  if (record.paths.length > 0) {
    const parents = commitParents(run, cwd, env, record.commit);
    if (parents.length !== 2 || parents[1] !== record.beforeHead) {
      throw journalInvalid('target journal commit must have exactly one parent: beforeHead');
    }
    if (commitTree(run, cwd, env, record.commit) !== record.expectedTree) {
      throw journalInvalid('target journal commit does not carry expectedTree');
    }
    return;
  }
  const expected = treeEntries(run, cwd, env, record.expectedTree, record.requiredPaths, true);
  const actual = treeEntries(run, cwd, env, record.commit, record.requiredPaths, false);
  if (!entriesMatch(actual, expected)) {
    throw journalInvalid('target journal commit does not carry the prepared documentation set');
  }
}

function loadTargetRecord(journalFile, deps) {
  if (typeof journalFile !== 'string' || journalFile.length === 0) throw journalInvalid('journalFile is required');
  if (!path.isAbsolute(journalFile)) throw journalInvalid('journalFile must be an absolute path');
  if (path.basename(journalFile) !== JOURNAL_FILE) {
    throw journalInvalid(`journalFile must be exactly <outDir>/${JOURNAL_FILE}`);
  }
  let stat;
  try {
    stat = deps.io.lstatSync(journalFile);
  } catch (error) {
    throw journalInvalid(`target journal is missing: ${journalFile}`, error);
  }
  if (stat.isSymbolicLink()) throw journalInvalid(`target journal must not be a symlink: ${journalFile}`);
  if (!stat.isFile()) throw journalInvalid(`target journal must be a regular file: ${journalFile}`);
  let record;
  try {
    record = JSON.parse(deps.io.readFileSync(journalFile, 'utf8'));
  } catch (error) {
    throw journalInvalid('target journal is not valid JSON', error);
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw journalInvalid('target journal must hold a record object');
  }
  const keys = Object.keys(record).slice().sort();
  const wanted = JOURNAL_FIELDS.slice().sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw journalInvalid('target journal fields do not match schema 1');
  }
  requireJournalShape(record, journalFile);
  const evidence = readApplicationEvidence(record.applicationFile, deps.io);
  if (evidence.sha256 !== record.applicationSha256) {
    throw journalInvalid('target journal applicationSha256 does not match application.json');
  }
  const application = verifyDocsApplication(record.applicationFile, { run: deps.run });
  requireJournalApplicationMatch(record, application);
  let identity;
  try {
    identity = observeTargetIdentity(deps.run, record.repoRoot);
  } catch (error) {
    throw journalInvalid(error && error.message ? String(error.message) : String(error), error);
  }
  requireJournalIdentityMatch(record, identity);
  requireJournalCommit(record, deps.run, identity.root, observeEnv());
  return { journal: record, application, identity };
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

function requireProvenBoundary(run, root, env, record, expected, boundary) {
  if (!entriesMatch(treeEntries(run, root, env, boundary, record.requiredPaths, false), expected)) {
    throw historyUnresolved(`${boundary} does not carry the prepared documentation set for ${record.repo}`);
  }
  const header = git(run, root, env, ['cat-file', '-p', boundary]);
  const blank = header.indexOf('\n\n');
  const parents = [];
  for (const line of (blank < 0 ? header : header.slice(0, blank)).split('\n')) {
    if (!line.startsWith('parent ')) continue;
    const oid = line.slice('parent '.length).trim();
    if (!OID_PATTERN.test(oid)) throw historyUnresolved(`${boundary} has a malformed parent header`);
    parents.push(oid);
  }
  if (parents.length === 0) return boundary;
  const parent = parents[0];
  if (!commitExists(run, root, env, parent)) {
    throw historyUnresolved(`${boundary} is a shallow boundary: its parent ${parent} is not available`);
  }
  if (entriesMatch(treeEntries(run, root, env, parent, record.requiredPaths, false), expected)) {
    throw historyUnresolved(`${boundary} is not a proven documentation boundary for ${record.repo}`);
  }
  return boundary;
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

function expectedOidLength(objectFormat) {
  return objectFormat === 'sha256' ? 64 : 40;
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
