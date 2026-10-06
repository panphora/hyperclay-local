'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');

const readPolicy = require('./release-read-policy');
const publication = require('./release-publication');
const { publicationAttemptDirectoryName } = require('./release-publication-path');
const localRead = require('./release-local-read');
const releaseState = require('./release-state');
const releaseStateStore = require('./release-state-store');
const transitions = require('./release-transitions');
const workflowIdentity = require('./release-workflow-identity');

const FAILURE_CODE = 'PUBLICATION_EVIDENCE_INVALID';
const PUBLISH_MODE = 'publish';
const UPLOAD_JOB_NAME = 'upload';
const UPLOAD_JOB_STATUS = 'completed';
const UPLOAD_JOB_CONCLUSION = 'success';
const PROOF_SCHEMA = 1;
const MANIFEST_FILE = 'release-info.json';
const PROOF_FILE = 'publication.json';
const RECORDS_DIR = 'records';
const ARTIFACTS_DIR = 'artifacts';
const EVIDENCE_DIRECTORY_MODE = 0o700;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const NEW_FORMAT_ATTEMPT_TOKEN = /^attempt=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPO_FIELDS = [
  'key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'
];
const INCOMPLETE_ARTIFACT_STATES = ['pending', 'failed', 'unknown', 'conflict'];
const MAX_TOTAL_MS = 90000;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const PROOF_MAX_BYTES = 256 * 1024;
const MAX_JOB_ROWS_PER_PAGE = 100;
const MAX_JOB_PAGES = 100;
const MAX_JOB_ROWS = MAX_JOB_ROWS_PER_PAGE * MAX_JOB_PAGES;
const REMOTE_PREFIX = 'github.com/';

function publicationInvalid(message) {
  const error = new Error(message);
  error.code = FAILURE_CODE;
  return error;
}

function evidenceInvalid(message, cause) {
  const error = publicationInvalid(message);
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function publicationCause(message, cause) {
  return evidenceInvalid(message, cause);
}

function isPublicationFailure(value) {
  return Boolean(value) && typeof value === 'object' && value.code === FAILURE_CODE;
}

function evidenceFailure(message, cause) {
  if (isPublicationFailure(cause)) return cause;
  return evidenceInvalid(message, cause);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function digestOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function defaultNow() {
  return performance.now();
}

let defaultLocalRun = null;

function localRunDefault() {
  if (defaultLocalRun === null) defaultLocalRun = localRead.createLocalGitReader().run;
  return defaultLocalRun;
}

function requireGroup(group, label) {
  if (group === undefined || group === null) return {};
  if (!isPlainRecord(group)) throw publicationInvalid(`publication observation ${label} dependencies must be a plain object`);
  return group;
}

function resolveDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw publicationInvalid('publication observation dependencies must be a plain object');
  const shared = {
    now: provided.now === undefined ? defaultNow : provided.now,
    wallNow: provided.wallNow === undefined ? Date.now : provided.wallNow
  };
  if (typeof shared.now !== 'function') throw publicationInvalid('publication observation now must be a function');
  if (typeof shared.wallNow !== 'function') throw publicationInvalid('publication observation wallNow must be a function');
  for (const key of ['sleep', 'logReadFailure']) {
    if (provided[key] !== undefined) {
      if (typeof provided[key] !== 'function') throw publicationInvalid(`publication observation ${key} must be a function`);
      shared[key] = provided[key];
    }
  }
  if (provided.signal !== undefined) shared.signal = provided.signal;

  const github = Object.assign({}, requireGroup(provided.github, 'github'), shared);
  const manifest = Object.assign({}, requireGroup(provided.manifest, 'manifest'), shared);

  const localGroup = requireGroup(provided.local, 'local');
  const run = localGroup.run === undefined ? localRunDefault() : localGroup.run;
  if (typeof run !== 'function') throw publicationInvalid('publication observation local run must be a function');
  const io = localGroup.fs === undefined ? fs : localGroup.fs;
  if (io === null || typeof io !== 'object' || Array.isArray(io)) {
    throw publicationInvalid('publication observation local filesystem must be an object');
  }
  const readGit = (root, args) => {
    const output = run('git', args, { cwd: root });
    return typeof output === 'string' ? output.trim() : String(output).trim();
  };
  return { github, manifest, local: { run, fs: io, readGit }, now: shared.now, wallNow: shared.wallNow };
}

function freezeDeadline(options, now) {
  const settings = options === undefined || options === null ? {} : options;
  if (!isPlainRecord(settings)) throw publicationInvalid('publication observation options must be a plain object');
  if (settings.deadline === undefined) return now() + MAX_TOTAL_MS;
  if (typeof settings.deadline !== 'number' || !Number.isFinite(settings.deadline)) {
    throw publicationInvalid('publication observation deadline must be a finite absolute time');
  }
  return Math.min(now() + MAX_TOTAL_MS, settings.deadline);
}

function requireEvidenceRoot(repoDir, repo) {
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || path.normalize(repoDir) !== repoDir ||
      repoDir.endsWith(path.sep) || path.dirname(repoDir) === repoDir) {
    throw publicationInvalid('release evidence root must be a normalized absolute directory');
  }
  if (path.basename(repoDir) !== repo.key) {
    throw publicationInvalid('release evidence root is not the recorded repository cache directory');
  }
  for (const protectedRoot of [repo.root, repo.commonDir]) {
    if (typeof protectedRoot === 'string' && protectedRoot.length > 0 &&
        (repoDir === protectedRoot || repoDir.startsWith(protectedRoot + path.sep))) {
      throw publicationInvalid('release evidence must stay outside the checkout');
    }
  }
  return repoDir;
}

function requireObservationState(state, repoDir) {
  if (!isPlainRecord(state) || !isPlainRecord(state.repo)) {
    throw publicationInvalid('publication observation needs a validated release state');
  }
  if (typeof repoDir !== 'string' || repoDir.length === 0) {
    throw publicationInvalid('publication observation needs the release cache directory');
  }
  let validated;
  try {
    validated = releaseState.validateReleaseState(state, state.repo, { repoDir });
  } catch (error) {
    throw evidenceFailure('release state is not a valid publication state', error);
  }
  if (validated.mode !== PUBLISH_MODE) throw publicationInvalid('publication observation requires a publish release');
  const activeId = validated.activeAttemptId;
  const attempt = validated.attempts.find(
    (candidate) => isPlainRecord(candidate) && candidate.id === activeId
  );
  if (attempt === undefined) throw publicationInvalid('publication observation needs the active release attempt');
  if (attempt.dispatch !== 'identified') throw publicationInvalid('publication observation requires an identified attempt');
  if (attempt.runStatus !== 'completed' || attempt.conclusion !== 'success') {
    throw publicationInvalid('publication observation requires a completed successful attempt');
  }
  requireEvidenceRoot(repoDir, validated.repo);
  return { state: validated, attempt };
}

function requireCurrentIdentity(state, local) {
  let identity;
  try {
    identity = releaseState.resolveRepoIdentity(state.repo.root, { readGit: local.readGit, fs: local.fs });
  } catch (error) {
    throw evidenceFailure('current release repository identity is not readable', error);
  }
  for (const field of REPO_FIELDS) {
    if (identity[field] !== state.repo[field]) {
      throw publicationInvalid(`current release repository ${field} is not the recorded identity`);
    }
  }
  return identity;
}

function carriesNewFormatAttemptToken(title) {
  return typeof title === 'string' && title.split(/\s+/).some((token) => NEW_FORMAT_ATTEMPT_TOKEN.test(token));
}

function requireRun({ attempt, remoteRepo, run }) {
  let observation;
  try {
    observation = attempt.identityKind === 'legacy-upload-proof'
      ? workflowIdentity.requireWorkflowRunFacts({
        remoteRepo,
        workflowId: attempt.workflowId,
        sourceSha: attempt.sourceSha,
        runId: attempt.runId,
        runAttempt: attempt.runAttempt,
        run
      })
      : workflowIdentity.requireWorkflowRun({ attempt, remoteRepo, run });
  } catch (error) {
    throw publicationCause('observed workflow run does not satisfy the accepted workflow identity', error);
  }
  if (observation.runStatus !== 'completed' || observation.conclusion !== 'success') {
    throw publicationInvalid('observed workflow run is not a completed successful run');
  }
  if (attempt.identityKind === 'legacy-upload-proof' && carriesNewFormatAttemptToken(run.display_title)) {
    throw publicationInvalid('observed legacy workflow run title carries a new-format attempt token');
  }
  return observation;
}

async function collectJobPages({ repo, attempt, github, end }) {
  const base = `repos/${repo}/actions/runs/${attempt.runId}/attempts/${attempt.runAttempt}/jobs`;
  const pages = [];
  let total = null;
  let rows = 0;
  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const record = await readPolicy.readGithubJson(
      'github.run-jobs-page',
      { repo, endpoint: `${base}?per_page=100&page=${page}` },
      github,
      { deadline: end }
    );
    if (!isPlainRecord(record)) throw publicationInvalid('release upload jobs page must be a plain record');
    if (!isNonNegativeInteger(record.total_count) || record.total_count > MAX_JOB_ROWS) {
      throw publicationInvalid('release upload jobs page total_count must be a nonnegative whole job count');
    }
    if (total === null) total = record.total_count;
    else if (record.total_count !== total) throw publicationInvalid('release upload jobs pages must agree on total_count');
    if (!Array.isArray(record.jobs) || record.jobs.length > MAX_JOB_ROWS_PER_PAGE) {
      throw publicationInvalid('release upload jobs page must carry at most one hundred rows');
    }
    rows += record.jobs.length;
    if (rows > total) throw publicationInvalid('release upload jobs pages carry more rows than total_count');
    pages.push(record);
    if (rows === total) break;
    if (record.jobs.length < MAX_JOB_ROWS_PER_PAGE) {
      throw publicationInvalid('release upload jobs page ended before the complete total_count');
    }
    if (page === MAX_JOB_PAGES) throw publicationInvalid('release upload jobs pages exceeded the bounded page count');
  }
  if (rows !== total) throw publicationInvalid('release upload jobs pages must carry exactly the complete total_count rows');
  return pages;
}

async function readManifest({ state, manifest, end }) {
  const evidence = await readPolicy.readReleaseInfoEvidence(manifest, { deadline: end });
  if (!isPlainRecord(evidence) || !Buffer.isBuffer(evidence.bytes)) {
    throw publicationInvalid('release manifest read did not return exact bytes');
  }
  if (evidence.bytes.length > MANIFEST_MAX_BYTES) {
    throw publicationInvalid('release manifest exceeds the retained read bound');
  }
  const bytes = Buffer.from(evidence.bytes);
  let value;
  try {
    value = publication.validateReleaseManifest(evidence.value, {
      version: state.version,
      sourceSha: state.sourceSha
    });
  } catch (error) {
    throw publicationCause('release manifest is not valid release evidence', error);
  }
  return { bytes, value, digest: digestOf(bytes) };
}

async function collectPublicationFacts(input, deps) {
  const { state, attempt, repoDir, end } = input;
  requireEvidenceRoot(repoDir, state.repo);
  const remoteRepo = state.repo.remoteRepo;
  const repo = remoteRepo.slice(REMOTE_PREFIX.length);
  const runEndpoint = `repos/${repo}/actions/runs/${attempt.runId}`;

  const firstRun = await readPolicy.readGithubJson(
    'github.run', { repo, endpoint: runEndpoint }, deps.github, { deadline: end }
  );
  requireRun({ attempt, remoteRepo, run: firstRun });

  const pages = await collectJobPages({ repo, attempt, github: deps.github, end });
  const uploadJob = publication.selectUploadJob(pages, {
    runId: attempt.runId,
    runAttempt: attempt.runAttempt,
    sourceSha: attempt.sourceSha
  });

  const manifest = await readManifest({ state, manifest: deps.manifest, end });

  const finalRun = await readPolicy.readGithubJson(
    'github.run', { repo, endpoint: runEndpoint }, deps.github, { deadline: end }
  );
  requireRun({ attempt, remoteRepo, run: finalRun });

  const source = publication.readPublishedSourceVersion(
    { repoRoot: state.repo.root, sourceSha: state.sourceSha, version: state.version },
    { run: deps.local.run, fs: deps.local.fs }
  );

  requireCurrentIdentity(state, deps.local);

  return {
    run: finalRun,
    uploadJob,
    manifestBytes: manifest.bytes,
    manifest: manifest.value,
    manifestSha256: manifest.digest,
    source
  };
}

function projectRun(run) {
  return {
    id: run.id,
    run_attempt: run.run_attempt,
    workflow_id: run.workflow_id,
    event: run.event,
    display_title: run.display_title,
    head_sha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
    repository: { full_name: run.repository.full_name }
  };
}

function projectUploadJob(job) {
  return { id: job.id, name: job.name, status: job.status, conclusion: job.conclusion };
}

function buildProof({ state, attempt, facts, verifiedAt }) {
  return {
    schema: PROOF_SCHEMA,
    releaseId: state.releaseId,
    attemptId: attempt.id,
    version: state.version,
    mode: PUBLISH_MODE,
    sourceSha: state.sourceSha,
    manifestSha256: facts.manifestSha256,
    verifiedAt,
    run: projectRun(facts.run),
    uploadJobsRequest: { runId: facts.run.id, runAttempt: facts.run.run_attempt },
    uploadJob: projectUploadJob(facts.uploadJob)
  };
}

function validateRetainedProof(proof, context) {
  return context.attempt.identityKind === 'legacy-upload-proof'
    ? publication.validateLegacyPublicationProof(proof, context)
    : publication.validatePublicationProof(proof, context);
}

function readProofAt({ state, attempt, local, proofFile, manifestSha256 }) {
  let bytes;
  try {
    bytes = localRead.readBoundedOrdinaryFile(proofFile, { maxBytes: PROOF_MAX_BYTES, fs: local.fs });
  } catch (error) {
    throw evidenceFailure('retained publication proof is not readable', error);
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw evidenceInvalid('retained publication proof is not valid JSON', error);
  }
  if (!isPlainRecord(parsed)) throw publicationInvalid('retained publication proof must be a plain JSON record');
  try {
    validateRetainedProof(parsed, { state, attempt, manifestSha256 });
  } catch (error) {
    throw evidenceFailure('retained publication proof is not valid evidence', error);
  }
  return parsed;
}

function readRetainedProofDetail({ state, attempt, local }) {
  return readProofAt({
    state,
    attempt,
    local,
    proofFile: path.join(path.dirname(state.artifacts.manifestFile), PROOF_FILE),
    manifestSha256: state.artifacts.manifestSha256
  });
}

function sameInstallerSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const seen = new Set(left);
  if (seen.size !== right.length) return false;
  return right.every((name) => seen.has(name));
}

function sameSizeMap(left, right) {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => right[key] === left[key]);
}

function sameManifest(observed, retained) {
  if (observed.version !== retained.version) return false;
  if (observed.commit !== retained.commit) return false;
  if (observed.date !== retained.date) return false;
  if (!sameInstallerSet(observed.files, retained.files)) return false;
  return sameSizeMap(observed.sizes, retained.sizes);
}

function compareFacts(facts, retained, historical, state) {
  if (facts.run.id !== retained.run.id) {
    throw publicationInvalid('observed workflow run is not the retained publication run');
  }
  if (facts.run.run_attempt !== retained.run.run_attempt) {
    throw publicationInvalid('observed workflow run attempt is not the retained publication attempt');
  }
  if (facts.run.workflow_id !== retained.run.workflow_id) {
    throw publicationInvalid('observed workflow is not the retained publication workflow');
  }
  if (facts.run.head_sha !== retained.run.head_sha) {
    throw publicationInvalid('observed workflow source is not the retained publication source');
  }
  if (facts.uploadJob.id !== retained.uploadJob.id) {
    throw publicationInvalid('observed upload job is not the retained publication upload job');
  }
  if (facts.source.sourceSha !== state.sourceSha || historical.sourceSha !== state.sourceSha) {
    throw publicationInvalid('observed source is not the retained publication source');
  }
  if (!sameManifest(facts.manifest, historical.manifest)) {
    throw publicationInvalid('observed manifest is not the retained publication manifest');
  }
}

async function observePublication(input, deps, options) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const { state, attempt } = requireObservationState(request.state, request.repoDir);
  if (state.artifacts.state === 'complete') {
    throw publicationInvalid('publication observation requires artifacts that are not yet complete');
  }
  if (!INCOMPLETE_ARTIFACT_STATES.includes(state.artifacts.state)) {
    throw publicationInvalid('publication observation requires incomplete artifact evidence');
  }
  requireCurrentIdentity(state, resolved.local);
  const end = freezeDeadline(options, resolved.now);
  const facts = await collectPublicationFacts({ state, attempt, repoDir: request.repoDir, end }, resolved);
  const verifiedAt = new Date(resolved.wallNow()).toISOString();
  const proof = buildProof({ state, attempt, facts, verifiedAt });
  validateRetainedProof(proof, { state, attempt, manifestSha256: facts.manifestSha256 });
  return { manifestBytes: Buffer.from(facts.manifestBytes), manifest: facts.manifest, proof };
}

async function verifyCurrentPublication(input, deps, options) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const { state, attempt } = requireObservationState(request.state, request.repoDir);
  if (state.artifacts.state !== 'complete') {
    throw publicationInvalid('publication verification requires complete artifact evidence');
  }
  const historical = publication.readPublicationEvidence(
    { state, repoDir: request.repoDir },
    { run: resolved.local.run, fs: resolved.local.fs }
  );
  const retained = readRetainedProofDetail({ state, attempt, local: resolved.local });
  requireCurrentIdentity(state, resolved.local);
  const end = freezeDeadline(options, resolved.now);
  const facts = await collectPublicationFacts({ state, attempt, repoDir: request.repoDir, end }, resolved);
  compareFacts(facts, retained, historical, state);
  return historical;
}

function lstatOrMissing(io, target) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error && (error.code === 'ENOTDIR' || error.code === 'ELOOP')) {
      throw publicationInvalid('release evidence path component must be a real directory');
    }
    throw evidenceFailure('release evidence path inspection failed', error);
  }
}

function requirePrivateDirectory(io, target, label) {
  let stat;
  try {
    stat = io.lstatSync(target);
  } catch (error) {
    throw evidenceInvalid(`${label} is missing`, error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw publicationInvalid(`${label} must be a real directory`);
  if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) throw publicationInvalid(`${label} is writable by group or other`);
  return stat;
}

function fsyncEvidenceDirectory(io, directory) {
  try {
    releaseStateStore.fsyncDirectory(directory, io);
  } catch (error) {
    throw evidenceFailure('release evidence directory flush failed', error);
  }
}

function requireEvidenceDirectories(io, repoDir, state, attempt) {
  requireEvidenceRoot(repoDir, state.repo);
  let real;
  try {
    real = io.realpathSync(repoDir);
  } catch (error) {
    throw evidenceInvalid('release evidence root is missing', error);
  }
  if (real !== repoDir) throw publicationInvalid('release evidence root must be canonical');
  requirePrivateDirectory(io, repoDir, 'release evidence root');
  let current = repoDir;
  for (const segment of [RECORDS_DIR, state.releaseId, ARTIFACTS_DIR, publicationAttemptDirectoryName(attempt.id)]) {
    const parent = current;
    current = path.join(current, segment);
    let stat = lstatOrMissing(io, current);
    if (stat === null) {
      try {
        io.mkdirSync(current, EVIDENCE_DIRECTORY_MODE);
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          throw evidenceFailure('release evidence directory creation failed', error);
        }
      }
      stat = lstatOrMissing(io, current);
      if (stat === null) throw publicationInvalid('release evidence directory was not created');
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw publicationInvalid('release evidence path component must be a real directory');
    }
    if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
      throw publicationInvalid('release evidence directory is writable by group or other');
    }
    fsyncEvidenceDirectory(io, parent);
  }
  return {
    attemptDir: current,
    manifestFile: path.join(current, MANIFEST_FILE),
    proofFile: path.join(current, PROOF_FILE)
  };
}

function lstatEvidenceLeaf(io, target, maxBytes, label) {
  let stat;
  try {
    stat = io.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error && error.code === 'ELOOP') throw publicationInvalid(`${label} must not be a symlink`);
    throw evidenceFailure(`${label} is not readable`, error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw publicationInvalid(`${label} must be an ordinary file`);
  if ((stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw publicationInvalid(`${label} permissions are unsafe`);
  }
  if (stat.size > maxBytes) throw publicationInvalid(`${label} exceeds the read bound`);
  return stat;
}

function readEvidenceLeaf(io, target, maxBytes, label) {
  let bytes;
  try {
    bytes = localRead.readBoundedOrdinaryFile(target, { maxBytes, fs: io });
  } catch (error) {
    throw evidenceFailure(`${label} is not readable`, error);
  }
  if (bytes.length > maxBytes) throw publicationInvalid(`${label} exceeds the read bound`);
  return bytes;
}

function parseEvidenceManifest(bytes, state, label) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw evidenceInvalid(`${label} is not valid JSON`, error);
  }
  try {
    return publication.validateReleaseManifest(parsed, { version: state.version, sourceSha: state.sourceSha });
  } catch (error) {
    throw publicationCause(`${label} is not valid release evidence`, error);
  }
}

function requireObservationManifest(state, observation) {
  const bytes = observation.manifestBytes;
  if (!Buffer.isBuffer(bytes)) throw publicationInvalid('publication persistence requires exact observed manifest bytes');
  if (bytes.length > MANIFEST_MAX_BYTES) throw publicationInvalid('observed release manifest exceeds the retained read bound');
  if (!isPlainRecord(observation.manifest)) {
    throw publicationInvalid('publication persistence requires a validated observed manifest');
  }
  const value = parseEvidenceManifest(bytes, state, 'observed release manifest');
  let agreement;
  try {
    agreement = sameManifest(value, observation.manifest);
  } catch (error) {
    throw evidenceFailure('observed release manifest is not comparable release evidence', error);
  }
  if (!agreement) {
    throw publicationInvalid('observed release manifest does not match its exact bytes');
  }
  const retained = Buffer.from(bytes);
  return { bytes: retained, value, digest: digestOf(retained) };
}

function cloneProof(proof) {
  return JSON.parse(JSON.stringify(proof));
}

function serializeProof(proof) {
  const payload = Buffer.from(`${JSON.stringify(proof)}\n`, 'utf8');
  if (payload.length > PROOF_MAX_BYTES) throw publicationInvalid('retained publication proof exceeds the write bound');
  return payload;
}

function publishEvidenceFile(io, target, payload, label) {
  try {
    releaseStateStore.publishDurableFile(target, payload, io);
  } catch (error) {
    throw evidenceFailure(`${label} publication failed`, error);
  }
}

function flushRetainedLeaf(io, target, label) {
  const constants = io.constants || fs.constants;
  let fd = null;
  let primary = null;
  try {
    fd = io.openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    throw evidenceFailure(`${label} is not readable`, error);
  }
  try {
    const stat = io.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
      throw publicationInvalid(`${label} permissions are unsafe`);
    }
    io.fsyncSync(fd);
  } catch (error) {
    primary = isPublicationFailure(error) ? error : evidenceFailure(`${label} flush failed`, error);
  }
  if (fd !== null) {
    try {
      io.closeSync(fd);
    } catch (error) {
      if (primary === null) primary = evidenceFailure(`${label} close failed`, error);
    }
  }
  if (primary !== null) throw primary;
}

function selectRetainedEvidence(input) {
  const { io, local, state, attempt, layout, manifest, observation, run } = input;
  const retainedManifest = lstatEvidenceLeaf(io, layout.manifestFile, MANIFEST_MAX_BYTES, 'retained manifest');
  const retainedProof = lstatEvidenceLeaf(io, layout.proofFile, PROOF_MAX_BYTES, 'retained publication proof');
  if (retainedProof !== null && retainedManifest === null) {
    throw publicationInvalid('retained publication proof has no companion manifest');
  }
  if (retainedManifest === null) {
    return {
      manifestDigest: manifest.digest,
      proof: cloneProof(observation.proof),
      manifestRetained: false,
      proofRetained: false
    };
  }
  const savedBytes = readEvidenceLeaf(io, layout.manifestFile, MANIFEST_MAX_BYTES, 'retained manifest');
  const savedValue = parseEvidenceManifest(savedBytes, state, 'retained manifest');
  if (!sameManifest(savedValue, manifest.value)) {
    throw publicationInvalid('retained manifest is not the freshly observed release manifest');
  }
  const manifestDigest = digestOf(savedBytes);
  if (retainedProof === null) {
    const proof = cloneProof(observation.proof);
    proof.manifestSha256 = manifestDigest;
    validateRetainedProof(proof, { state, attempt, manifestSha256: manifestDigest });
    return { manifestDigest, proof, manifestRetained: true, proofRetained: false };
  }
  const saved = publication.readPublicationPair(
    { state, repoDir: input.repoDir, manifestSha256: manifestDigest },
    { run, fs: io }
  );
  const savedProof = readProofAt({
    state, attempt, local, proofFile: layout.proofFile, manifestSha256: manifestDigest
  });
  if (!sameManifest(saved.manifest, manifest.value)) {
    throw publicationInvalid('retained manifest is not the freshly observed release manifest');
  }
  if (saved.sourceSha !== state.sourceSha || saved.runId !== attempt.runId) {
    throw publicationInvalid('retained publication evidence is not the observed release identity');
  }
  if (savedProof.run.id !== attempt.runId || savedProof.run.run_attempt !== attempt.runAttempt ||
      savedProof.run.workflow_id !== attempt.workflowId) {
    throw publicationInvalid('retained publication proof is not the observed workflow attempt');
  }
  if (savedProof.uploadJob.id !== observation.proof.uploadJob.id) {
    throw publicationInvalid('retained publication proof is not the observed upload job');
  }
  return { manifestDigest, proof: savedProof, manifestRetained: true, proofRetained: true };
}

function persistPublication(input, deps) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const { state, attempt } = requireObservationState(request.state, request.repoDir);
  const io = resolved.local.fs;
  if (state.phase !== 'workflow') {
    throw publicationInvalid('publication persistence requires a workflow release phase');
  }
  if (!INCOMPLETE_ARTIFACT_STATES.includes(state.artifacts.state)) {
    throw publicationInvalid('publication persistence requires incomplete artifact evidence');
  }
  const cacheRoot = path.dirname(request.repoDir);
  let paths;
  try {
    paths = releaseState.statePaths(state.repo, { cacheRoot, fs: io });
  } catch (error) {
    throw evidenceFailure('release cache directory is not the recorded repository cache', error);
  }
  if (paths.repoDir !== request.repoDir) {
    throw publicationInvalid('publication persistence requires the exact release cache directory');
  }
  const stored = releaseStateStore.readReleaseState(state.repo, { cacheRoot, fs: io });
  if (!isDeepStrictEqual(stored, state)) {
    throw publicationInvalid('publication persistence input is not the persisted release state');
  }
  requireCurrentIdentity(state, resolved.local);

  const observation = isPlainRecord(request.observation) ? request.observation : null;
  if (observation === null) throw publicationInvalid('publication persistence requires an observation');
  const manifest = requireObservationManifest(state, observation);
  if (!isPlainRecord(observation.proof)) {
    throw publicationInvalid('publication persistence requires a validated publication proof');
  }
  validateRetainedProof(observation.proof, { state, attempt, manifestSha256: manifest.digest });
  publication.readPublishedSourceVersion(
    { repoRoot: state.repo.root, sourceSha: state.sourceSha, version: state.version },
    { run: resolved.local.run, fs: io }
  );

  const layout = requireEvidenceDirectories(io, request.repoDir, state, attempt);
  const selected = selectRetainedEvidence({
    io,
    local: resolved.local,
    run: resolved.local.run,
    repoDir: request.repoDir,
    state,
    attempt,
    layout,
    manifest,
    observation
  });

  if (!selected.manifestRetained) {
    publishEvidenceFile(io, layout.manifestFile, manifest.bytes, 'release manifest');
  }
  if (!selected.proofRetained) {
    publishEvidenceFile(io, layout.proofFile, serializeProof(selected.proof), 'retained publication proof');
  }

  flushRetainedLeaf(io, layout.manifestFile, 'retained manifest');
  flushRetainedLeaf(io, layout.proofFile, 'retained publication proof');
  fsyncEvidenceDirectory(io, layout.attemptDir);

  const pair = publication.readPublicationPair(
    { state, repoDir: request.repoDir, manifestSha256: selected.manifestDigest },
    { run: resolved.local.run, fs: io }
  );
  requireCurrentIdentity(state, resolved.local);

  const next = transitions.transitionRelease(state, {
    type: 'artifacts-verified',
    at: new Date(resolved.wallNow()).toISOString(),
    artifacts: {
      state: 'complete',
      sourceSha: pair.sourceSha,
      runId: pair.runId,
      manifestFile: layout.manifestFile,
      manifestSha256: selected.manifestDigest,
      verifiedAt: pair.verifiedAt
    }
  }, state.repo, { repoDir: request.repoDir });

  return releaseStateStore.writeReleaseState(next, state.repo, {
    cacheRoot,
    expectedRevision: state.revision,
    fs: io
  });
}

module.exports = { observePublication, persistPublication, verifyCurrentPublication };
