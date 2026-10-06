'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function stateError(code, message) {
  return Object.assign(new Error(message), { code });
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function defaultReadGit(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
      timeout: 30000,
      shell: false,
    }).trim();
  } catch {
    throw stateError('REPO_IDENTITY_UNREADABLE', 'Could not read local release repository identity');
  }
}

function githubIdentity(raw) {
  let host;
  let pathname;
  const scp = /^git@([^:]+):(.+)$/.exec(raw);
  if (scp) {
    host = scp[1];
    pathname = scp[2];
  } else {
    let url;
    try { url = new URL(raw); } catch {
      throw stateError('REPO_REMOTE_INVALID', 'Release origin must identify a GitHub repository');
    }
    if (!['https:', 'ssh:'].includes(url.protocol) || url.search || url.hash || url.port) {
      throw stateError('REPO_REMOTE_INVALID', 'Release origin must identify a GitHub repository');
    }
    host = url.hostname;
    pathname = url.pathname.replace(/^\//, '');
  }
  pathname = pathname.replace(/\.git$/, '');
  if (host.toLowerCase() !== 'github.com' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pathname) ||
      pathname.split('/').some(part => part === '.' || part === '..')) {
    throw stateError('REPO_REMOTE_INVALID', 'Release origin must identify a GitHub repository');
  }
  return `github.com/${pathname.toLowerCase()}`;
}

function resolveRepoIdentity(repoRoot, { readGit = defaultReadGit, fs: io = fs } = {}) {
  const root = io.realpathSync(repoRoot);
  const top = io.realpathSync(readGit(root, ['rev-parse', '--show-toplevel']));
  if (path.relative(root, top) !== '') throw stateError('REPO_ROOT_MISMATCH', 'Release root must be the checkout root');
  const commonDir = io.realpathSync(path.resolve(root, readGit(root, ['rev-parse', '--git-common-dir'])));
  const branch = readGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== 'main') throw stateError('REPO_BRANCH_MISMATCH', 'Desktop releases require main');
  const objectFormat = readGit(root, ['rev-parse', '--show-object-format']);
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw stateError('REPO_OBJECT_FORMAT', 'Unsupported Git object format');
  }
  const origin = readGit(root, ['remote', 'get-url', 'origin']);
  const pushUrls = readGit(root, ['remote', 'get-url', '--push', '--all', 'origin']).split('\n');
  if (pushUrls.length !== 1 || !pushUrls[0]) {
    throw stateError('REPO_PUSH_AMBIGUOUS', 'Release origin must have one push destination');
  }
  const remoteRepo = githubIdentity(origin);
  if (githubIdentity(pushUrls[0]) !== remoteRepo) {
    throw stateError('REPO_PUSH_MISMATCH', 'Release origin fetch and push destinations differ');
  }
  return {
    key: digest(commonDir), root, commonDir, branch, remote: 'origin', remoteRepo,
    pushUrlSha256: digest(pushUrls[0]), objectFormat,
  };
}

function canonicalFuturePath(input, io) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) {
    throw stateError('STATE_CACHE_INVALID', 'Release cache root must be absolute');
  }
  const suffix = [];
  let current = path.normalize(input);
  while (true) {
    try { io.lstatSync(current); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw stateError('STATE_CACHE_INVALID', 'Release cache has no existing parent');
      current = parent;
      continue;
    }
    const real = io.realpathSync(current);
    if (!io.statSync(real).isDirectory()) {
      throw stateError('STATE_CACHE_INVALID', 'Release cache parent is not a directory');
    }
    return path.join(real, ...suffix);
  }
}

function statePaths(identity, { cacheRoot = path.join(os.homedir(), '.cache/hyperclay-local/releases'), fs: io = fs } = {}) {
  if (!identity || !/^[a-f0-9]{64}$/.test(identity.key) || identity.key !== digest(identity.commonDir)) {
    throw stateError('REPO_IDENTITY_INVALID', 'Release cache needs a canonical repository identity');
  }
  const releasesDir = canonicalFuturePath(cacheRoot, io);
  for (const protectedRoot of [identity.root, identity.commonDir]) {
    if (releasesDir === protectedRoot || releasesDir.startsWith(protectedRoot + path.sep)) {
      throw stateError('STATE_CACHE_IN_CHECKOUT', 'Release state must stay outside the checkout');
    }
  }
  const repoDir = path.join(releasesDir, identity.key);
  return {
    releasesDir, repoDir,
    stateFile: path.join(repoDir, 'state.json'),
    dryRunFile: path.join(repoDir, 'dry-run.json'),
    historyDir: path.join(repoDir, 'history'),
    releaseLock: path.join(releasesDir, 'locks/releases', `${identity.key}.lock`),
    docsLocksDir: path.join(releasesDir, 'locks/docs'),
  };
}

const STATE_SCHEMA = 1;
const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const WATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const VERSION_COMPONENT_MAX = 65535;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const REMOTE_REPO_PATTERN = /^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const MODES = ['publish', 'dry-run'];
const PHASES = ['version-preparing', 'source-ready', 'workflow', 'tail', 'complete', 'failed-ci', 'unknown'];
const IDENTITY_KINDS = ['dispatch', 'legacy-upload-proof'];
const DISPATCH_STATES = ['ready', 'requested', 'identified', 'unknown', 'rejected'];
const RUN_STATES = ['queued', 'requested', 'waiting', 'pending', 'in_progress', 'completed'];
const CONCLUSIONS = [
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure',
];
const TARGET_STATES = ['pending', 'complete', 'pending-push', 'conflict', 'missing', 'failed', 'unknown'];
const INCOMPLETE_ARTIFACT_STATES = ['pending', 'failed', 'unknown', 'conflict'];
const INSTALL_STATES = ['not-attempted', 'complete', 'failed'];
const COMPLETED_TAIL_STATES = ['complete', 'pending-push'];
const ATTEMPT_PHASES = ['workflow', 'tail', 'complete', 'failed-ci'];

const STATE_KEYS = [
  'schema', 'revision', 'repo', 'releaseId', 'version', 'mode', 'phase', 'createdAt', 'updatedAt',
  'versionIntent', 'sourceSha', 'activeAttemptId', 'attempts', 'artifacts', 'sizes', 'site', 'docs',
  'install', 'lastError',
];
const REPO_KEYS = ['key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'];
const ATTEMPT_KEYS = [
  'id', 'identityKind', 'version', 'mode', 'sourceSha', 'dispatchRef', 'workflowPath', 'workflowId',
  'expectedTitle', 'dispatch', 'requestedAt', 'watchDeadlineAt', 'runId', 'runAttempt', 'runStatus',
  'conclusion', 'lastObservedAt', 'error',
];
const LEGACY_PROOF_KEYS = ['uploadJobId', 'uploadJobConclusion', 'observedHeadSha', 'observedMode'];
const VERSION_INTENT_KEYS = ['previousVersion', 'version', 'baseHead', 'journalFile', 'files'];
const FILE_INTENT_KEYS = ['path', 'beforeSha256', 'afterSha256', 'beforeMode', 'afterMode', 'preparedFile'];
const TARGET_KEYS = ['state', 'journalFile', 'commit', 'reason'];
const SITE_KEYS = ['state', 'sourceSha', 'treeSha', 'attemptId', 'receiptSha', 'verifiedAt', 'error'];
const INSTALL_KEYS = ['state', 'error'];
const ERROR_KEYS = ['code', 'message'];
const DOC_KEYS = ['hyperclay', 'hyperclay-website'];
const ARTIFACT_COMPLETE_KEYS = ['state', 'sourceSha', 'runId', 'manifestFile', 'manifestSha256', 'verifiedAt'];
const ARTIFACT_INCOMPLETE_KEYS = ['state'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(field) {
  throw stateError('STATE_INVALID', `Release state is invalid at ${field}`);
}

function requireExactKeys(value, keys, field) {
  if (!isObject(value)) invalid(field);
  if (Object.keys(value).length !== keys.length) invalid(field);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) invalid(field);
  }
}

function isVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) return false;
  return value.split('.').every(part => Number(part) <= VERSION_COMPONENT_MAX);
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString() === value;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isObjectSha(value, identity) {
  if (typeof value !== 'string') return false;
  const length = identity.objectFormat === 'sha256' ? 64 : 40;
  return value.length === length && /^[a-f0-9]+$/.test(value);
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRevision(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFileMode(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0o777;
}

function validateError(value, field) {
  if (value === null) return;
  requireExactKeys(value, ERROR_KEYS, field);
  if (typeof value.code !== 'string' || value.code.length === 0 || value.code.length > 256) {
    invalid(`${field}.code`);
  }
  if (typeof value.message !== 'string' || value.message.length === 0 || value.message.length > 4096) {
    invalid(`${field}.message`);
  }
}

function validateIdentity(identity) {
  if (!isObject(identity)) invalid('identity');
  if (!isDigest(identity.key)) invalid('identity');
  if (identity.branch !== 'main') invalid('identity');
  if (identity.remote !== 'origin') invalid('identity');
  if (typeof identity.remoteRepo !== 'string' || !REMOTE_REPO_PATTERN.test(identity.remoteRepo)) invalid('identity');
  if (!isDigest(identity.pushUrlSha256)) invalid('identity');
  if (identity.objectFormat !== 'sha1' && identity.objectFormat !== 'sha256') invalid('identity');
  for (const key of ['root', 'commonDir']) {
    if (typeof identity[key] !== 'string' || !path.isAbsolute(identity[key]) || CONTROL_PATTERN.test(identity[key])) {
      invalid('identity');
    }
  }
}

function validateEvidencePath(value, releaseDir, field) {
  if (typeof value !== 'string' || value.length === 0) invalid(field);
  if (CONTROL_PATTERN.test(value)) invalid(field);
  if (!path.isAbsolute(value)) invalid(field);
  if (value.endsWith(path.sep)) invalid(field);
  if (path.normalize(value) !== value) invalid(field);
  if (value === path.parse(value).root) invalid(field);
  if (!value.startsWith(releaseDir + path.sep)) invalid(field);
}

function validateVersionIntent(intent, state, identity, releaseDir) {
  requireExactKeys(intent, VERSION_INTENT_KEYS, 'versionIntent');
  if (!isVersion(intent.previousVersion)) invalid('versionIntent.previousVersion');
  if (!isVersion(intent.version) || intent.version !== state.version) invalid('versionIntent.version');
  if (compareVersions(intent.version, intent.previousVersion) <= 0) invalid('versionIntent.version');
  if (!isObjectSha(intent.baseHead, identity)) invalid('versionIntent.baseHead');
  validateEvidencePath(intent.journalFile, releaseDir, 'versionIntent.journalFile');
  if (!Array.isArray(intent.files) || intent.files.length === 0) invalid('versionIntent.files');
  const seen = new Set();
  intent.files.forEach((file, index) => {
    const field = `versionIntent.files[${index}]`;
    requireExactKeys(file, FILE_INTENT_KEYS, field);
    const parts = typeof file.path === 'string' ? file.path.split('/') : [];
    if (typeof file.path !== 'string' || file.path.length === 0 || path.isAbsolute(file.path) ||
        CONTROL_PATTERN.test(file.path) || parts.some(part => part === '' || part === '.' || part === '..')) {
      invalid(`${field}.path`);
    }
    if (seen.has(file.path)) invalid(`${field}.path`);
    seen.add(file.path);
    if (!isDigest(file.beforeSha256)) invalid(`${field}.beforeSha256`);
    if (!isDigest(file.afterSha256)) invalid(`${field}.afterSha256`);
    if (!isFileMode(file.beforeMode)) invalid(`${field}.beforeMode`);
    if (!isFileMode(file.afterMode)) invalid(`${field}.afterMode`);
    validateEvidencePath(file.preparedFile, releaseDir, `${field}.preparedFile`);
  });
}

function validateWatchWindow(attempt, field) {
  if (!isTimestamp(attempt.requestedAt)) invalid(`${field}.requestedAt`);
  if (!isTimestamp(attempt.watchDeadlineAt)) invalid(`${field}.watchDeadlineAt`);
  const deadline = new Date(attempt.requestedAt).getTime() + WATCH_WINDOW_MS;
  if (new Date(attempt.watchDeadlineAt).getTime() !== deadline) invalid(`${field}.watchDeadlineAt`);
}

function validateAttempt(attempt, index, state, identity) {
  const field = `attempts[${index}]`;
  if (!isObject(attempt)) invalid(field);
  if (!IDENTITY_KINDS.includes(attempt.identityKind)) invalid(`${field}.identityKind`);
  const keys = attempt.identityKind === 'legacy-upload-proof'
    ? ATTEMPT_KEYS.concat(['legacyProof'])
    : ATTEMPT_KEYS;
  requireExactKeys(attempt, keys, field);
  if (!isVersion(attempt.version) || attempt.version !== state.version) invalid(`${field}.version`);
  if (!MODES.includes(attempt.mode) || attempt.mode !== state.mode) invalid(`${field}.mode`);
  if (!isObjectSha(attempt.sourceSha, identity)) invalid(`${field}.sourceSha`);
  if (attempt.workflowPath !== RELEASE_WORKFLOW_PATH) invalid(`${field}.workflowPath`);
  if (!isPositiveInteger(attempt.workflowId)) invalid(`${field}.workflowId`);
  if (!DISPATCH_STATES.includes(attempt.dispatch)) invalid(`${field}.dispatch`);
  validateError(attempt.error, `${field}.error`);

  if (attempt.identityKind === 'dispatch') {
    if (!isUuid(attempt.id)) invalid(`${field}.id`);
    const previous = index > 0 ? state.attempts[index - 1] : null;
    const repairedSource = previous && previous.dispatch === 'identified' &&
      previous.runStatus === 'completed' && previous.conclusion !== null &&
      previous.conclusion !== 'success' && previous.sourceSha !== attempt.sourceSha;
    const mainAllowed = attempt.mode === 'dry-run' || repairedSource;
    if (attempt.dispatchRef !== `v${attempt.version}` && !(attempt.dispatchRef === 'main' && mainAllowed)) {
      invalid(`${field}.dispatchRef`);
    }
    const title = `release v${attempt.version} ${attempt.mode} sha=${attempt.sourceSha} attempt=${attempt.id}`;
    if (attempt.expectedTitle !== title) invalid(`${field}.expectedTitle`);
    if (attempt.dispatch === 'ready') {
      if (attempt.requestedAt !== null || attempt.watchDeadlineAt !== null || attempt.runId !== null ||
          attempt.runAttempt !== null || attempt.runStatus !== null || attempt.conclusion !== null ||
          attempt.lastObservedAt !== null) {
        invalid(field);
      }
      return;
    }
    if (attempt.dispatch === 'identified') {
      validateWatchWindow(attempt, field);
      if (!isPositiveInteger(attempt.runId)) invalid(`${field}.runId`);
      if (attempt.runAttempt !== 1) invalid(`${field}.runAttempt`);
      if (typeof attempt.runStatus !== 'string' || !RUN_STATES.includes(attempt.runStatus)) {
        invalid(`${field}.runStatus`);
      }
      if (!isTimestamp(attempt.lastObservedAt)) invalid(`${field}.lastObservedAt`);
      if (attempt.runStatus === 'completed') {
        if (typeof attempt.conclusion !== 'string' || !CONCLUSIONS.includes(attempt.conclusion)) {
          invalid(`${field}.conclusion`);
        }
      } else if (attempt.conclusion !== null) {
        invalid(`${field}.conclusion`);
      }
      return;
    }
    validateWatchWindow(attempt, field);
    if (attempt.runId !== null || attempt.runAttempt !== null || attempt.runStatus !== null ||
        attempt.conclusion !== null || attempt.lastObservedAt !== null) {
      invalid(field);
    }
    return;
  }

  if (!isPositiveInteger(attempt.runId)) invalid(`${field}.runId`);
  if (!isPositiveInteger(attempt.runAttempt)) invalid(`${field}.runAttempt`);
  if (attempt.id !== `legacy:${attempt.runId}:${attempt.runAttempt}`) invalid(`${field}.id`);
  if (attempt.mode !== 'publish') invalid(`${field}.mode`);
  if (attempt.dispatch !== 'identified') invalid(`${field}.dispatch`);
  if (attempt.runStatus !== 'completed') invalid(`${field}.runStatus`);
  if (attempt.conclusion !== 'success') invalid(`${field}.conclusion`);
  if (attempt.dispatchRef !== null) invalid(`${field}.dispatchRef`);
  if (attempt.expectedTitle !== null) invalid(`${field}.expectedTitle`);
  if (attempt.requestedAt !== null) invalid(`${field}.requestedAt`);
  if (attempt.watchDeadlineAt !== null) invalid(`${field}.watchDeadlineAt`);
  if (!isTimestamp(attempt.lastObservedAt)) invalid(`${field}.lastObservedAt`);
  const proof = attempt.legacyProof;
  requireExactKeys(proof, LEGACY_PROOF_KEYS, `${field}.legacyProof`);
  if (!isPositiveInteger(proof.uploadJobId)) invalid(`${field}.legacyProof.uploadJobId`);
  if (proof.uploadJobConclusion !== 'success') invalid(`${field}.legacyProof.uploadJobConclusion`);
  if (!isObjectSha(proof.observedHeadSha, identity)) invalid(`${field}.legacyProof.observedHeadSha`);
  if (proof.observedHeadSha !== attempt.sourceSha) invalid(`${field}.legacyProof.observedHeadSha`);
  if (proof.observedMode !== 'publish') invalid(`${field}.legacyProof.observedMode`);
}

function validateTarget(target, field, identity, releaseDir) {
  requireExactKeys(target, TARGET_KEYS, field);
  if (!TARGET_STATES.includes(target.state)) invalid(`${field}.state`);
  if (target.journalFile !== null) validateEvidencePath(target.journalFile, releaseDir, `${field}.journalFile`);
  if (target.commit !== null && !isObjectSha(target.commit, identity)) invalid(`${field}.commit`);
  validateError(target.reason, `${field}.reason`);
  if (COMPLETED_TAIL_STATES.includes(target.state) && (target.journalFile === null || target.commit === null)) {
    invalid(field);
  }
  if (target.state === 'complete' && target.reason !== null) invalid(`${field}.reason`);
}

function validateSite(site, identity) {
  requireExactKeys(site, SITE_KEYS, 'site');
  if (!TARGET_STATES.includes(site.state)) invalid('site.state');
  for (const key of ['sourceSha', 'treeSha', 'receiptSha']) {
    if (site[key] !== null && !isObjectSha(site[key], identity)) invalid(`site.${key}`);
  }
  if (site.attemptId !== null && !isUuid(site.attemptId)) invalid('site.attemptId');
  if (site.verifiedAt !== null && !isTimestamp(site.verifiedAt)) invalid('site.verifiedAt');
  validateError(site.error, 'site.error');
  if (site.state === 'complete') {
    if (site.sourceSha === null || site.treeSha === null || site.attemptId === null ||
        site.receiptSha === null || site.verifiedAt === null) {
      invalid('site');
    }
    if (site.receiptSha !== site.sourceSha) invalid('site.receiptSha');
    if (site.error !== null) invalid('site.error');
  }
  if (site.state === 'unknown') {
    if (site.sourceSha === null || site.treeSha === null || site.attemptId === null) invalid('site');
    if (site.verifiedAt !== null) invalid('site.verifiedAt');
  }
}

function isCompletedSuccess(attempt) {
  return Boolean(attempt) && attempt.dispatch === 'identified' && attempt.runStatus === 'completed' &&
    attempt.conclusion === 'success';
}

function validateArtifacts(artifacts, state, activeAttempt, identity, releaseDir) {
  if (!isObject(artifacts)) invalid('artifacts');
  if (artifacts.state !== 'complete') {
    requireExactKeys(artifacts, ARTIFACT_INCOMPLETE_KEYS, 'artifacts');
    if (!INCOMPLETE_ARTIFACT_STATES.includes(artifacts.state)) invalid('artifacts.state');
    return;
  }
  requireExactKeys(artifacts, ARTIFACT_COMPLETE_KEYS, 'artifacts');
  if (state.mode !== 'publish') invalid('artifacts');
  if (state.phase !== 'tail' && state.phase !== 'complete') invalid('artifacts');
  if (!isCompletedSuccess(activeAttempt)) invalid('artifacts');
  if (!isObjectSha(artifacts.sourceSha, identity) || artifacts.sourceSha !== state.sourceSha) {
    invalid('artifacts.sourceSha');
  }
  if (!isPositiveInteger(artifacts.runId) || artifacts.runId !== activeAttempt.runId) invalid('artifacts.runId');
  validateEvidencePath(artifacts.manifestFile, releaseDir, 'artifacts.manifestFile');
  if (!isDigest(artifacts.manifestSha256)) invalid('artifacts.manifestSha256');
  if (!isTimestamp(artifacts.verifiedAt)) invalid('artifacts.verifiedAt');
}

function validateInstall(install) {
  requireExactKeys(install, INSTALL_KEYS, 'install');
  if (!INSTALL_STATES.includes(install.state)) invalid('install.state');
  validateError(install.error, 'install.error');
  if (install.state === 'failed' && install.error === null) invalid('install.error');
  if (install.state !== 'failed' && install.error !== null) invalid('install.error');
}

function validateReleaseState(value, identity, options) {
  if (!isObject(value)) invalid('state');

  const repoDir = isObject(options) ? options.repoDir : null;
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || CONTROL_PATTERN.test(repoDir) ||
      repoDir.endsWith(path.sep) || path.normalize(repoDir) !== repoDir ||
      path.dirname(repoDir) === repoDir) {
    invalid('repoDir');
  }
  validateIdentity(identity);
  if (path.basename(repoDir) !== identity.key) invalid('repoDir');

  requireExactKeys(value, STATE_KEYS, 'state');
  if (value.schema !== STATE_SCHEMA) invalid('schema');
  if (!isRevision(value.revision)) invalid('revision');
  if (!isVersion(value.version)) invalid('version');
  if (!isUuid(value.releaseId)) invalid('releaseId');
  if (!MODES.includes(value.mode)) invalid('mode');
  if (!PHASES.includes(value.phase)) invalid('phase');
  if (!isTimestamp(value.createdAt)) invalid('createdAt');
  if (!isTimestamp(value.updatedAt)) invalid('updatedAt');
  if (new Date(value.updatedAt).getTime() < new Date(value.createdAt).getTime()) invalid('updatedAt');

  requireExactKeys(value.repo, REPO_KEYS, 'repo');
  for (const key of REPO_KEYS) {
    if (value.repo[key] !== identity[key]) invalid(`repo.${key}`);
  }

  const releaseDir = path.join(repoDir, 'records', value.releaseId);

  if (value.phase === 'version-preparing') {
    if (value.sourceSha !== null) invalid('sourceSha');
    if (value.versionIntent === null) invalid('versionIntent');
    validateVersionIntent(value.versionIntent, value, identity, releaseDir);
  } else {
    if (value.versionIntent !== null) invalid('versionIntent');
    if (!isObjectSha(value.sourceSha, identity)) invalid('sourceSha');
  }

  if (!Array.isArray(value.attempts)) invalid('attempts');
  if (value.phase === 'version-preparing' && value.attempts.length !== 0) invalid('attempts');
  const attemptIds = new Set();
  value.attempts.forEach((attempt, index) => {
    validateAttempt(attempt, index, value, identity);
    if (attemptIds.has(attempt.id)) invalid(`attempts[${index}].id`);
    attemptIds.add(attempt.id);
  });

  if (ATTEMPT_PHASES.includes(value.phase) && value.activeAttemptId === null) invalid('activeAttemptId');
  if (value.attempts.length > 0 && value.activeAttemptId === null) invalid('activeAttemptId');
  if (value.phase === 'version-preparing' && value.activeAttemptId !== null) invalid('activeAttemptId');
  let activeAttempt = null;
  if (value.activeAttemptId !== null) {
    if (typeof value.activeAttemptId !== 'string') invalid('activeAttemptId');
    const matches = value.attempts.filter(attempt => attempt.id === value.activeAttemptId);
    if (matches.length !== 1) invalid('activeAttemptId');
    activeAttempt = matches[0];
    if (value.sourceSha !== activeAttempt.sourceSha) invalid('sourceSha');
  }

  validateArtifacts(value.artifacts, value, activeAttempt, identity, releaseDir);
  validateTarget(value.sizes, 'sizes', identity, releaseDir);
  validateSite(value.site, identity);
  requireExactKeys(value.docs, DOC_KEYS, 'docs');
  validateTarget(value.docs.hyperclay, 'docs.hyperclay', identity, releaseDir);
  validateTarget(value.docs['hyperclay-website'], 'docs.hyperclay-website', identity, releaseDir);
  validateInstall(value.install);
  validateError(value.lastError, 'lastError');

  const tailTargets = [
    ['sizes', value.sizes],
    ['site', value.site],
    ['docs.hyperclay', value.docs.hyperclay],
    ['docs.hyperclay-website', value.docs['hyperclay-website']],
  ];

  if (value.mode === 'dry-run') {
    if (value.phase === 'tail') invalid('phase');
    if (value.artifacts.state === 'complete') invalid('artifacts');
    for (const [field, target] of tailTargets) {
      if (COMPLETED_TAIL_STATES.includes(target.state)) invalid(field);
    }
    if (value.phase === 'complete' && !isCompletedSuccess(activeAttempt)) invalid('phase');
  } else {
    for (const [field, target] of tailTargets) {
      if (COMPLETED_TAIL_STATES.includes(target.state) && value.artifacts.state !== 'complete') invalid(field);
    }
    if (value.phase === 'tail' && value.artifacts.state !== 'complete') invalid('artifacts');
    if (value.phase === 'complete') {
      if (value.artifacts.state !== 'complete') invalid('artifacts');
      if (value.sizes.state !== 'complete') invalid('sizes');
      if (value.site.state !== 'complete') invalid('site');
      if (value.docs.hyperclay.state !== 'complete' ||
          value.docs['hyperclay-website'].state !== 'complete') invalid('docs');
    }
  }

  if (value.phase === 'failed-ci' && (!activeAttempt || activeAttempt.dispatch !== 'identified' ||
      activeAttempt.runStatus !== 'completed' || activeAttempt.conclusion === null ||
      activeAttempt.conclusion === 'success')) invalid('phase');

  return value;
}

module.exports = { resolveRepoIdentity, statePaths, stateError, validateReleaseState };
