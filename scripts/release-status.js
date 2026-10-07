'use strict';

// Read-only desktop release status. One assembler answers what a release journal
// still holds unfinished, so the routing step never has to guess from a receipt,
// a cache file or a `.deploy` marker. Nothing here writes, locks, fetches or
// dispatches: every fact is a local file or an immutable Git object, and every
// failure becomes a fixed code with no routing facts attached.

const fs = require('fs');
const path = require('path');

const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { resolveRepoIdentity, statePaths } = require('./release-state');
const { readReleaseState } = require('./release-state-store');
const { readPublicationEvidence } = require('./release-publication');
const { readSizeEvidence } = require('./release-size-evidence');
const { readSiteAttempt, readSiteEvidence } = require('./release-site-evidence');
const { readCompletedTargetEvidence, readTargetEvidence } = require('./release-target-evidence');

const SCHEMA = 1;
const DESKTOP_REPO = 'hyperclay-local';
const STAGES = ['artifacts', 'sizes', 'site', 'docs.hyperclay', 'docs.hyperclay-website'];
const DOC_REPOS = ['hyperclay', 'hyperclay-website'];
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const VERSION_COMPONENT_MAX = 65535;
const PACKAGE_MAX_BYTES = 1024 * 1024;
const RECEIPT_MAX_BYTES = 128;
const RECEIPT_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})\n?$/;
const OID_PATTERN = /^[0-9a-f]+$/;
const DRY_RUN_REASON = 'Local dry-run record; no publication evidence';
const READ_FAILED_MESSAGE = 'Desktop release status could not be read';

const SAFE_MESSAGES = {
  RELEASE_HOST_UNSUPPORTED: 'Desktop release status requires a POSIX host',
  REPO_BRANCH_MISMATCH: 'Desktop releases require main',
  REPO_IDENTITY_INVALID: 'Release cache needs a canonical repository identity',
  REPO_IDENTITY_UNREADABLE: 'Could not read local release repository identity',
  REPO_OBJECT_FORMAT: 'Unsupported Git object format',
  REPO_PUSH_AMBIGUOUS: 'Release origin must have one push destination',
  REPO_PUSH_MISMATCH: 'Release origin fetch and push destinations differ',
  REPO_REMOTE_INVALID: 'Release origin must identify a GitHub repository',
  REPO_ROOT_MISMATCH: 'Release root must be the checkout root',
  STATE_CACHE_INVALID: 'Release cache root is not usable',
  STATE_CACHE_IN_CHECKOUT: 'Release state must stay outside the checkout',
  STATE_INVALID: 'Release state record is invalid',
  STATE_IO_FAILED: 'Release state could not be read',
  STATE_CONFLICT: 'Release state conflicts with its recorded history',
  LOCAL_EVIDENCE_READ_FAILED: 'Local evidence read failed',
  STATUS_PACKAGE_INVALID: 'Desktop package.json has no usable release version',
  STATUS_HEAD_INVALID: 'The desktop checkout HEAD could not be resolved',
  STATUS_RECEIPT_INVALID: 'The live site receipt could not be read',
  STATUS_CHANGED_DURING_READ: 'Desktop release state changed while it was being read'
};

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function statusError(code) {
  const error = new Error(SAFE_MESSAGES[code]);
  error.code = code;
  return error;
}

function errorStatus(code, message) {
  return {
    schema: SCHEMA,
    repoKey: null,
    currentVersion: null,
    publish: null,
    siteReceipt: null,
    dryRun: null,
    readError: { code, message }
  };
}

function classify(error) {
  const code = error !== null && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : null;
  if (code !== null && Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, code)) {
    return errorStatus(code, SAFE_MESSAGES[code]);
  }
  return errorStatus('STATUS_READ_FAILED', READ_FAILED_MESSAGE);
}

function isObjectOid(identity, value) {
  const length = identity.objectFormat === 'sha256' ? 64 : 40;
  return typeof value === 'string' && value.length === length && OID_PATTERN.test(value);
}

function readPackageVersion(file, io) {
  let bytes;
  try {
    bytes = readBoundedOrdinaryFile(file, { maxBytes: PACKAGE_MAX_BYTES, fs: io });
  } catch {
    throw statusError('STATUS_PACKAGE_INVALID');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw statusError('STATUS_PACKAGE_INVALID');
  }
  if (!isPlainRecord(value) || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) {
    throw statusError('STATUS_PACKAGE_INVALID');
  }
  if (value.version.split('.').some(part => Number(part) > VERSION_COMPONENT_MAX)) {
    throw statusError('STATUS_PACKAGE_INVALID');
  }
  return value.version;
}

function readHead(identity, readGit) {
  let head;
  let resolved;
  try {
    head = readGit(identity.root, ['rev-parse', 'HEAD']);
    if (!isObjectOid(identity, head)) throw statusError('STATUS_HEAD_INVALID');
    resolved = readGit(identity.root, ['rev-parse', '--verify', `${head}^{commit}`]);
  } catch {
    throw statusError('STATUS_HEAD_INVALID');
  }
  if (resolved !== head) throw statusError('STATUS_HEAD_INVALID');
  return head;
}

function readReceiptSha(identity, io) {
  let bytes;
  try {
    bytes = readBoundedOrdinaryFile(path.join(identity.root, '.deploy'), {
      maxBytes: RECEIPT_MAX_BYTES, missing: true, fs: io
    });
  } catch {
    throw statusError('STATUS_RECEIPT_INVALID');
  }
  if (bytes === null) return null;
  const match = RECEIPT_PATTERN.exec(bytes.toString('utf8'));
  if (match === null || !isObjectOid(identity, match[1])) {
    throw statusError('STATUS_RECEIPT_INVALID');
  }
  return match[1];
}

function artifactsObservation(state, repoDir, deps) {
  const stage = 'artifacts';
  if (state.artifacts.state === 'complete') {
    try {
      const evidence = readPublicationEvidence({ state, repoDir }, deps);
      return { stage, complete: true, conflict: false, verifiedAt: evidence.verifiedAt };
    } catch {
      return { stage, complete: false, conflict: true, verifiedAt: null };
    }
  }
  return { stage, complete: false, conflict: state.artifacts.state === 'conflict', verifiedAt: null };
}

function targetObservation(stage, repo, target, state, repoDir, deps) {
  if (target.state === 'complete') {
    try {
      const evidence = readCompletedTargetEvidence({
        journalFile: target.journalFile,
        evidenceRoot: path.join(repoDir, 'records', state.releaseId),
        repo,
        version: state.version,
        commit: target.commit
      }, deps);
      return { stage, complete: true, conflict: false, verifiedAt: evidence.verifiedAt };
    } catch {
      return { stage, complete: false, conflict: true, verifiedAt: null };
    }
  }
  let conflict = target.state === 'conflict';
  if (target.journalFile !== null) {
    try {
      const { journal } = readTargetEvidence(target.journalFile, deps);
      if (journal.repo !== repo || journal.version !== state.version) conflict = true;
      if (target.commit !== null && journal.commit !== target.commit) conflict = true;
    } catch {
      conflict = true;
    }
  }
  return { stage, complete: false, conflict, verifiedAt: null };
}

function sizesObservation(state, repoDir, deps) {
  const stage = 'sizes';
  const target = state.sizes;
  if (target.state === 'complete') {
    try {
      const evidence = readSizeEvidence({ state, repoDir }, deps);
      return { stage, complete: true, conflict: false, verifiedAt: evidence.verifiedAt };
    } catch {
      return { stage, complete: false, conflict: true, verifiedAt: null };
    }
  }
  return targetObservation(stage, DESKTOP_REPO, target, state, repoDir, deps);
}

function siteObservation(state, repoDir, deps) {
  const stage = 'site';
  const site = state.site;
  if (site.state === 'complete') {
    try {
      const evidence = readSiteEvidence({ state, repoDir }, deps);
      return { stage, complete: true, conflict: false, verifiedAt: evidence.verifiedAt };
    } catch {
      return { stage, complete: false, conflict: true, verifiedAt: null };
    }
  }
  if (site.state === 'unknown' || site.state === 'conflict') {
    return { stage, complete: false, conflict: true, verifiedAt: null };
  }
  if (site.attemptId !== null) {
    try {
      const { descriptor } = readSiteAttempt({ state, repoDir }, deps);
      if (descriptor.phase === 'requested' || descriptor.phase === 'unknown') {
        return { stage, complete: false, conflict: true, verifiedAt: null };
      }
    } catch {
      return { stage, complete: false, conflict: true, verifiedAt: null };
    }
  }
  return { stage, complete: false, conflict: false, verifiedAt: null };
}

function observeStages(state, repoDir, deps) {
  const byStage = new Map();
  byStage.set('artifacts', artifactsObservation(state, repoDir, deps));
  byStage.set('sizes', sizesObservation(state, repoDir, deps));
  byStage.set('site', siteObservation(state, repoDir, deps));
  for (const repo of DOC_REPOS) {
    byStage.set(`docs.${repo}`, targetObservation(`docs.${repo}`, repo, state.docs[repo], state, repoDir, deps));
  }
  return STAGES.map(stage => byStage.get(stage));
}

function latestVerifiedAt(observations) {
  let latest = null;
  for (const item of observations) {
    if (item.verifiedAt === null) continue;
    if (latest === null || Date.parse(item.verifiedAt) > Date.parse(latest)) latest = item.verifiedAt;
  }
  return latest;
}

function projectPublish(state, observations) {
  const pendingStages = observations.filter(item => !item.complete).map(item => item.stage);
  const anyConflict = observations.some(item => item.conflict);
  const artifactsComplete = observations[0].complete;
  let phase = state.phase;
  let action = 'reconcile-workflow';
  let pending = true;
  let needsSigning = null;
  let reason = null;
  if (anyConflict) {
    phase = 'unknown';
    action = 'blocked-conflict';
    reason = `Retained evidence requires attention: ${observations.find(item => item.conflict).stage}`;
  } else if (state.phase === 'failed-ci') {
    action = 'blocked-failed-ci';
    reason = 'The recorded workflow failed; explicit recovery is required';
  } else if (state.phase === 'complete' && pendingStages.length === 0) {
    action = 'new-release-or-current';
    pending = false;
    needsSigning = false;
  } else if (state.phase === 'tail' && artifactsComplete) {
    action = 'resume-tail';
    needsSigning = false;
  } else if (state.phase === 'complete') {
    phase = 'unknown';
    action = 'blocked-conflict';
    reason = 'Recorded completion lacks required evidence';
  }
  return {
    releaseId: state.releaseId,
    version: state.version,
    sourceSha: state.sourceSha,
    phase,
    action,
    pending,
    needsSigning,
    pendingStages,
    lastVerifiedAt: latestVerifiedAt(observations),
    remoteVerification: 'not-performed',
    reason
  };
}

function projectDryRun(state) {
  let action = 'reconcile-workflow';
  let pending = true;
  let needsSigning = null;
  if (state.phase === 'complete') {
    action = 'new-release-or-current';
    pending = false;
    needsSigning = false;
  } else if (state.phase === 'failed-ci') {
    action = 'blocked-failed-ci';
  }
  return {
    releaseId: state.releaseId,
    version: state.version,
    sourceSha: state.sourceSha,
    phase: state.phase,
    action,
    pending,
    needsSigning,
    pendingStages: [],
    lastVerifiedAt: null,
    remoteVerification: 'not-performed',
    reason: DRY_RUN_REASON
  };
}

function sameLane(before, after) {
  return before === null || after === null
    ? before === after
    : before.releaseId === after.releaseId && before.revision === after.revision;
}

function observe(request, options) {
  const io = options.fs === undefined || options.fs === null ? fs : options.fs;
  const platform = options.platform === undefined ? process.platform : options.platform;
  if (platform === 'win32') throw statusError('RELEASE_HOST_UNSUPPORTED');

  const reader = createLocalGitReader();
  const run = options.run === undefined || options.run === null ? reader.run : options.run;
  const spawn = options.spawn === undefined || options.spawn === null ? reader.spawn : options.spawn;
  let readGit = reader.readGit;
  if (options.readGit !== undefined && options.readGit !== null) {
    readGit = options.readGit;
  } else if (options.run !== undefined && options.run !== null) {
    readGit = (cwd, args) => run('git', args, { cwd }).trim();
  }

  const repoRoot = request.repoRoot === undefined || request.repoRoot === null
    ? path.resolve(__dirname, '..')
    : request.repoRoot;
  const cacheRoot = request.cacheRoot === undefined ? undefined : request.cacheRoot;

  const identity = resolveRepoIdentity(repoRoot, { readGit, fs: io });
  const currentVersion = readPackageVersion(path.join(identity.root, 'package.json'), io);
  const head = readHead(identity, readGit);
  const receiptSha = readReceiptSha(identity, io);

  const paths = statePaths(identity, { cacheRoot, fs: io });
  const publishBefore = readReleaseState(identity, { cacheRoot, mode: 'publish', fs: io });
  const dryRunBefore = readReleaseState(identity, { cacheRoot, mode: 'dry-run', fs: io });

  const deps = { run, spawn, fs: io };
  const observations = publishBefore === null ? null : observeStages(publishBefore, paths.repoDir, deps);
  const publish = publishBefore === null ? null : projectPublish(publishBefore, observations);
  const dryRun = dryRunBefore === null ? null : projectDryRun(dryRunBefore);

  const publishAfter = readReleaseState(identity, { cacheRoot, mode: 'publish', fs: io });
  const dryRunAfter = readReleaseState(identity, { cacheRoot, mode: 'dry-run', fs: io });
  if (!sameLane(publishBefore, publishAfter) || !sameLane(dryRunBefore, dryRunAfter)) {
    throw statusError('STATUS_CHANGED_DURING_READ');
  }

  return {
    schema: SCHEMA,
    repoKey: identity.key,
    currentVersion,
    publish,
    siteReceipt: receiptSha === null ? null : { sha: receiptSha, matchesHead: receiptSha === head },
    dryRun,
    readError: null
  };
}

function readStatus(input, deps) {
  const request = isPlainRecord(input) ? input : {};
  const options = isPlainRecord(deps) ? deps : {};
  try {
    return observe(request, options);
  } catch (error) {
    return classify(error);
  }
}

module.exports = { readStatus };
