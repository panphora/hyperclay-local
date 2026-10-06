'use strict';

// Read the immutable evidence one documentation target left behind: its target
// journal, its verified application, the prepared snapshots it recorded and the
// immutable Git objects those references name. This leaf never inspects the acting
// checkout's branch, HEAD, origin, live index or selected working files, and it
// never writes anything. Acting recovery keeps its own strict identity checks.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { verifyDocsApplication } = require('./release-docs-plan');

const localReader = createLocalGitReader();

const EVIDENCE_JSON_BYTES = 8 * 1024 * 1024;

const SCHEMA = 1;
const JOURNAL_FILE = 'target.json';
const APPLICATION_FILE = 'application.json';
const REMOTE = 'origin';
const REMOTE_REF = 'refs/heads/main';
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const GIT_MODE_PATTERN = /^[0-7]{6}$/;
const REPO_NAMES = ['hyperclay', 'hyperclay-website', 'hyperclay-local'];
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
const OBSERVATION_FIELDS = ['head', 'observedAt', 'containsCommit', 'postimagesMatch'];

function stateError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function journalInvalid(message, cause) {
  return stateError('DOCS_JOURNAL_INVALID', message, cause);
}

function applicationInvalid(message, cause) {
  return stateError('DOCS_APPLICATION_INVALID', message, cause);
}

function identityInvalid(message, cause) {
  return stateError('DOCS_TARGET_IDENTITY_INVALID', message, cause);
}

function historyUnresolved(message, cause) {
  return stateError('DOCS_HISTORY_UNRESOLVED', message, cause);
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
    real = fs.realpathSync.native(dir);
  } catch (error) {
    throw identityInvalid(`${label} is missing: ${dir}`, error);
  }
  if (!fs.statSync(real).isDirectory()) throw identityInvalid(`${label} is not a directory: ${real}`);
  return real;
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
    bytes = readBoundedOrdinaryFile(applicationFile, { maxBytes: EVIDENCE_JSON_BYTES, fs: io });
  } catch (error) {
    throw journalInvalid(`application file could not be read: ${applicationFile}`, error);
  }
  return { bytes, sha256: sha256(bytes) };
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

function requireProvenBoundary(run, root, env, record, expected, boundary) {
  if (!entriesMatch(treeEntries(run, root, env, boundary, record.requiredPaths, false), expected)) {
    throw historyUnresolved(`${boundary} does not carry the prepared documentation set for ${record.repo}`);
  }
  const parents = commitHeaderParents(run, root, env, boundary);
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

function expectedOidLength(objectFormat) {
  return objectFormat === 'sha256' ? 64 : 40;
}

function depsInvalid(message) {
  return stateError('DOCS_TARGET_EVIDENCE_DEPS_INVALID', message);
}

function resolveEvidenceDeps(options) {
  const provided = options === undefined ? {} : options;
  if (typeof provided !== 'object' || provided === null || Array.isArray(provided)) {
    throw depsInvalid('target evidence deps must be an object');
  }
  const run = provided.run === undefined ? localReader.run : provided.run;
  const spawn = provided.spawn === undefined ? localReader.spawn : provided.spawn;
  const io = provided.fs === undefined ? fs : provided.fs;
  if (typeof run !== 'function') throw depsInvalid('target evidence run must be a function');
  if (typeof spawn !== 'function') throw depsInvalid('target evidence spawn must be a function');
  if (typeof io !== 'object' || io === null) throw depsInvalid('target evidence fs must be an object');
  return { run, spawn, io };
}

function readJournalRecord(journalFile, io) {
  if (typeof journalFile !== 'string' || journalFile.length === 0) throw journalInvalid('journalFile is required');
  if (!path.isAbsolute(journalFile)) throw journalInvalid('journalFile must be an absolute path');
  if (path.basename(journalFile) !== JOURNAL_FILE) {
    throw journalInvalid(`journalFile must be exactly <outDir>/${JOURNAL_FILE}`);
  }
  let stat;
  try {
    stat = io.lstatSync(journalFile);
  } catch (error) {
    throw journalInvalid(`target journal is missing: ${journalFile}`, error);
  }
  if (stat.isSymbolicLink()) throw journalInvalid(`target journal must not be a symlink: ${journalFile}`);
  if (!stat.isFile()) throw journalInvalid(`target journal must be a regular file: ${journalFile}`);
  let bytes;
  try {
    bytes = readBoundedOrdinaryFile(journalFile, { maxBytes: EVIDENCE_JSON_BYTES, fs: io });
  } catch (error) {
    throw journalInvalid(`target journal could not be read: ${journalFile}`, error);
  }
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
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
  return record;
}

function observeObjectStore(run, repoRoot) {
  const root = requireRealDirectory(repoRoot, 'target repository root');
  const env = observeEnv();
  const top = fs.realpathSync.native(git(run, root, env, ['rev-parse', '--show-toplevel']).trim());
  if (path.relative(root, top) !== '') throw identityInvalid(`target repository root is not the Git checkout root: ${root}`);
  const commonDir = fs.realpathSync.native(path.resolve(root, git(run, root, env, ['rev-parse', '--git-common-dir']).trim()));
  const objectFormat = git(run, root, env, ['rev-parse', '--show-object-format']).trim();
  if (!OBJECT_FORMATS.includes(objectFormat)) {
    throw identityInvalid(`target repository object format is unsupported: ${objectFormat}`);
  }
  return { root, commonDir, key: sha256(commonDir), objectFormat };
}

function commitHeaderParents(run, cwd, env, oid) {
  const probe = gitProbe(run, cwd, env, ['cat-file', 'commit', oid]);
  if (!probe.ok) {
    throw commandFailure(`git cat-file commit ${oid}`, probe.error);
  }
  const header = probe.stdout;
  const blank = header.indexOf('\n\n');
  const parents = [];
  for (const line of (blank < 0 ? header : header.slice(0, blank)).split('\n')) {
    if (!line.startsWith('parent ')) continue;
    const parent = line.slice('parent '.length).trim();
    if (!OID_PATTERN.test(parent)) throw historyUnresolved(`${oid} has a malformed parent header`);
    parents.push(parent);
  }
  return parents;
}

function readTargetEvidence(journalFile, options = {}) {
  const deps = resolveEvidenceDeps(options);
  const record = readJournalRecord(journalFile, deps.io);
  const evidence = readApplicationEvidence(record.applicationFile, deps.io);
  if (evidence.sha256 !== record.applicationSha256) {
    throw journalInvalid('target journal applicationSha256 does not match application.json');
  }
  const application = verifyDocsApplication(record.applicationFile, { run: deps.run, spawn: deps.spawn });
  requireJournalApplicationMatch(record, application);
  let objectStore;
  try {
    objectStore = observeObjectStore(deps.run, record.repoRoot);
  } catch (error) {
    throw journalInvalid(error && error.message ? String(error.message) : String(error), error);
  }
  if (record.repoRoot !== objectStore.root) {
    throw journalInvalid('target journal repoRoot is not the canonical repository root');
  }
  if (record.repoKey !== objectStore.key) {
    throw journalInvalid('target journal repoKey is not the canonical common directory digest');
  }
  requireJournalCommit(record, deps.run, objectStore.root, observeEnv());
  return { journal: record, application, objectStore };
}

function isInside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function requireEvidenceRoot(evidenceRoot, io) {
  if (typeof evidenceRoot !== 'string' || !path.isAbsolute(evidenceRoot)) {
    throw journalInvalid('evidenceRoot must be an absolute path');
  }
  let real;
  try {
    real = io.realpathSync(evidenceRoot);
  } catch (error) {
    throw journalInvalid(`evidence root is missing: ${evidenceRoot}`, error);
  }
  if (real !== evidenceRoot) throw journalInvalid(`evidence root must be canonical: ${evidenceRoot}`);
  if (!io.statSync(real).isDirectory()) throw journalInvalid(`evidence root is not a directory: ${evidenceRoot}`);
  return real;
}

function requireEvidenceLeaf(evidenceRoot, file, label, io) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw journalInvalid(`${label} must be an absolute path`);
  if (path.normalize(file) !== file) throw journalInvalid(`${label} must be a normalized path: ${file}`);
  if (file.includes('\0')) throw journalInvalid(`${label} must not contain NUL: ${file}`);
  const relative = path.relative(evidenceRoot, file);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw journalInvalid(`${label} is outside the evidence root: ${file}`);
  }
  let current = evidenceRoot;
  const parts = relative.split(path.sep);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = io.lstatSync(current);
    } catch (error) {
      throw journalInvalid(`${label} parent is missing: ${current}`, error);
    }
    if (stat.isSymbolicLink()) throw journalInvalid(`${label} parent is a symlink: ${current}`);
    if (!stat.isDirectory()) throw journalInvalid(`${label} parent is not a directory: ${current}`);
  }
  let leaf;
  try {
    leaf = io.lstatSync(file);
  } catch (error) {
    throw journalInvalid(`${label} is missing: ${file}`, error);
  }
  if (leaf.isSymbolicLink()) throw journalInvalid(`${label} must not be a symlink: ${file}`);
  if (!leaf.isFile()) throw journalInvalid(`${label} must be a regular file: ${file}`);
  return file;
}

function parseApplicationPreflight(bytes) {
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw journalInvalid('application file is not valid JSON', error);
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw journalInvalid('application file must hold a record object');
  }
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw journalInvalid('application files must be a nonempty array');
  }
  for (const file of record.files) {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) {
      throw journalInvalid('application file entries must be objects');
    }
  }
  return record;
}

function requireEvidenceReferences(evidenceRoot, journal, application, io) {
  requireEvidenceLeaf(evidenceRoot, journal.applicationFile, 'application file', io);
  requireEvidenceLeaf(evidenceRoot, journal.preparedFile, 'prepared descriptor', io);
  requireEvidenceLeaf(evidenceRoot, application.patchFile, 'patch file', io);
  requireEvidenceLeaf(evidenceRoot, application.privateIndexFile, 'private index', io);
  for (const file of application.files) {
    requireEvidenceLeaf(evidenceRoot, file.beforeFile, `${file.path} before snapshot`, io);
    requireEvidenceLeaf(evidenceRoot, file.afterFile, `${file.path} after snapshot`, io);
  }
}

function requireCanonicalTimestamp(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw journalInvalid(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function readCompletedTargetEvidence(input, options = {}) {
  const { journalFile, evidenceRoot, repo, version, commit } = input || {};
  const deps = resolveEvidenceDeps(options);
  const root = requireEvidenceRoot(evidenceRoot, deps.io);
  requireEvidenceLeaf(root, journalFile, 'target journal', deps.io);
  const confined = readJournalRecord(journalFile, deps.io);
  requireEvidenceLeaf(root, confined.applicationFile, 'application file', deps.io);
  requireEvidenceLeaf(root, confined.preparedFile, 'prepared descriptor', deps.io);
  const applicationEvidence = readApplicationEvidence(confined.applicationFile, deps.io);
  const preflight = parseApplicationPreflight(applicationEvidence.bytes);
  if (preflight.preparedFile !== confined.preparedFile) {
    throw journalInvalid('application preparedFile does not match the target journal');
  }
  requireEvidenceReferences(root, confined, preflight, deps.io);
  const { journal, application, objectStore } = readTargetEvidence(journalFile, { run: deps.run, spawn: deps.spawn, fs: deps.io });
  if (journal.repo !== repo) throw journalInvalid('target journal repo does not match the requesting target');
  if (journal.version !== version) throw journalInvalid('target journal version does not match the requesting target');
  if (journal.commit !== commit) throw journalInvalid('target journal commit does not match the requesting target');
  if (journal.phase !== 'complete') throw journalInvalid(`target journal phase is not complete: ${JSON.stringify(journal.phase)}`);
  if (journal.state !== 'complete') throw journalInvalid(`target journal state is not complete: ${JSON.stringify(journal.state)}`);
  if (journal.reason !== null) throw journalInvalid('a complete target journal must not record a reason');
  requireEvidenceReferences(root, journal, application, deps.io);
  if (isInside(root, objectStore.root) || isInside(objectStore.root, root)) {
    throw journalInvalid(`evidence root must live outside the target checkout: ${root}`);
  }
  const env = observeEnv();
  const expected = treeEntries(deps.run, objectStore.root, env, journal.expectedTree, journal.requiredPaths, true);
  if (journal.paths.length === 0) {
    requireProvenBoundary(deps.run, objectStore.root, env, journal, expected, journal.commit);
  }
  const observation = journal.remoteObservation;
  const head = observation.head;
  if (head.length !== expectedOidLength(objectStore.objectFormat)) {
    throw journalInvalid(`target journal remoteObservation head must be a full ${objectStore.objectFormat} object id`);
  }
  if (!commitExists(deps.run, objectStore.root, env, head)) {
    throw historyUnresolved(`the observed remote commit ${head} is not present in ${journal.repo}`);
  }
  if (!isAncestor(deps.run, objectStore.root, env, journal.commit, head)) {
    throw historyUnresolved(`the observed remote commit ${head} does not contain ${journal.commit}`);
  }
  const actual = treeEntries(deps.run, objectStore.root, env, head, journal.requiredPaths, false);
  if (!entriesMatch(actual, expected)) {
    throw historyUnresolved(`the observed remote commit ${head} does not carry the prepared documentation set for ${journal.repo}`);
  }
  const verifiedAt = requireCanonicalTimestamp(observation.observedAt, 'target journal remoteObservation observedAt');
  return { journalFile, repo: journal.repo, version: journal.version, commit: journal.commit, observedHead: head, verifiedAt };
}


module.exports = {
  readTargetEvidence, readCompletedTargetEvidence, observeObjectStore, stateError, journalInvalid, applicationInvalid, identityInvalid, historyUnresolved, commandFailure, sha256, observeEnv, git, gitProbe, cleanMiss, isAncestor, requireRealDirectory, readApplicationEvidence, requireReason, requireRemoteObservation, requireCompletedJournal, requireJournalShape, requireJournalApplicationMatch, commitParents, commitTree, commitExists, treeEntries, entriesMatch, requireExactChangedSet, requireCandidateInvariants, requireJournalCommit, requireProvenBoundary, expectedOidLength, SCHEMA, JOURNAL_FILE, APPLICATION_FILE, REMOTE, REMOTE_REF, OID_PATTERN, HASH_PATTERN, UUID_PATTERN, VERSION_PATTERN, GIT_MODE_PATTERN, REPO_NAMES, OBJECT_FORMATS, UNFINISHED_PHASES, COMMITTED_PHASES, PHASES, STATES, REASON_FIELDS, JOURNAL_FIELDS, OBSERVATION_FIELDS
};
