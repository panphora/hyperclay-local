'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { publicationAttemptDirectoryName } = require('./release-publication-path');

const FAILURE_CODE = 'PUBLICATION_EVIDENCE_INVALID';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SOURCE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const INFO_FIELDS = ['version', 'commit', 'date', 'files', 'sizes'];
const INSTALLER_COUNT = 5;
const PROOF_SCHEMA = 1;
const PUBLISH_MODE = 'publish';
const UPLOAD_JOB_NAME = 'upload';
const UPLOAD_JOB_STATUS = 'completed';
const UPLOAD_JOB_CONCLUSION = 'success';
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const RUN_STATES = ['queued', 'requested', 'waiting', 'pending', 'in_progress', 'completed'];
const CONCLUSIONS = [
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure',
];
const PROOF_KEYS = [
  'schema', 'releaseId', 'attemptId', 'version', 'mode', 'sourceSha', 'manifestSha256', 'verifiedAt',
  'run', 'uploadJobsRequest', 'uploadJob',
];
const PROOF_RUN_KEYS = [
  'id', 'run_attempt', 'workflow_id', 'event', 'display_title', 'head_sha', 'status', 'conclusion',
  'created_at', 'updated_at', 'html_url', 'repository',
];
const PROOF_RUN_REPOSITORY_KEYS = ['full_name'];
const UPLOAD_REQUEST_KEYS = ['runId', 'runAttempt'];
const UPLOAD_JOB_KEYS = ['id', 'name', 'status', 'conclusion'];
const NEW_FORMAT_ATTEMPT_TOKEN = /^attempt=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_JOB_ROWS_PER_PAGE = 100;
const MAX_JOB_PAGES = 100;
const MAX_JOB_ROWS = MAX_JOB_ROWS_PER_PAGE * MAX_JOB_PAGES;

const PACKAGE_FILE = 'package.json';
const MANIFEST_FILE = 'release-info.json';
const PROOF_FILE = 'publication.json';
const RECORDS_DIR = 'records';
const ARTIFACTS_DIR = 'artifacts';
const SOURCE_MAX_BYTES = 1024 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const PROOF_MAX_BYTES = 256 * 1024;
const BLOB_MODES = ['100644', '100755'];
const OBJECT_STORE_FIELDS = ['root', 'commonDir', 'key', 'objectFormat'];
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;

function publicationInvalid(message) {
  const error = new Error(message);
  error.code = FAILURE_CODE;
  return error;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function expectedInstallerNames(version) {
  return [
    `HyperclayLocal-${version}-arm64.dmg`,
    `HyperclayLocal-${version}.dmg`,
    `HyperclayLocal-Setup-${version}.exe`,
    `HyperclayLocal-${version}.AppImage`,
    `HyperclayLocal-${version}-arm64.AppImage`
  ];
}

function requireExpectedIdentity(expected) {
  if (!isPlainRecord(expected)) throw publicationInvalid('expected release identity must be a plain object');
  if (typeof expected.version !== 'string' || !VERSION_PATTERN.test(expected.version)) {
    throw publicationInvalid('expected version must be digits.digits.digits');
  }
  if (typeof expected.sourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(expected.sourceSha)) {
    throw publicationInvalid('expected sourceSha must be a full lowercase 40 or 64 hex object id');
  }
  return { version: expected.version, sourceSha: expected.sourceSha };
}

function requireManifestFields(info) {
  if (!isPlainRecord(info)) throw publicationInvalid('release-info must be a plain JSON record');
  const fields = Object.keys(info);
  if (fields.length !== INFO_FIELDS.length || !INFO_FIELDS.every((field) => fields.includes(field))) {
    throw publicationInvalid('release-info must carry exactly version, commit, date, files and sizes');
  }
}

function requireCanonicalDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw publicationInvalid('release-info date must be a canonical ISO timestamp');
  }
}

function requireInstallerFiles(files, names) {
  if (!Array.isArray(files)) throw publicationInvalid('release-info files must be an array of installer filenames');
  if (files.length !== INSTALLER_COUNT) throw publicationInvalid('release-info files must name exactly the five installers');
  const seen = new Set();
  for (const name of files) {
    if (typeof name !== 'string' || !names.includes(name)) {
      throw publicationInvalid('release-info files names something that is not one of the five installers');
    }
    if (seen.has(name)) throw publicationInvalid('release-info files repeats an installer filename');
    seen.add(name);
  }
}

function requireInstallerSizes(sizes, names) {
  if (!isPlainRecord(sizes)) throw publicationInvalid('release-info sizes must be a plain JSON record of installer byte counts');
  const keys = Object.keys(sizes);
  if (keys.length !== INSTALLER_COUNT) throw publicationInvalid('release-info sizes must cover exactly the five installers');
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(sizes, name)) {
      throw publicationInvalid('release-info sizes is missing an installer filename');
    }
  }
  for (const key of keys) {
    if (!names.includes(key)) throw publicationInvalid('release-info sizes covers something that is not one of the five installers');
    const bytes = sizes[key];
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw publicationInvalid('release-info sizes must map every installer to a positive whole byte count');
    }
  }
}

function validateReleaseManifest(info, expected) {
  const identity = requireExpectedIdentity(expected);
  requireManifestFields(info);
  if (info.version !== identity.version) throw publicationInvalid('release-info version is not the expected release version');
  if (info.commit !== identity.sourceSha) throw publicationInvalid('release-info commit is not the expected release source commit');
  requireCanonicalDate(info.date);
  const names = expectedInstallerNames(identity.version);
  requireInstallerFiles(info.files, names);
  requireInstallerSizes(info.sizes, names);
  return {
    version: info.version,
    commit: info.commit,
    date: info.date,
    files: info.files.slice(),
    sizes: Object.assign({}, info.sizes)
  };
}

function publicationCause(message, cause) {
  const error = publicationInvalid(message);
  error.cause = cause;
  return error;
}

function workflowIdentity() {
  return require('./release-workflow-identity');
}

function requireExactRecord(value, keys, message) {
  if (!isPlainRecord(value)) throw publicationInvalid(message);
  const names = Object.keys(value);
  if (names.length !== keys.length || !keys.every((key) => names.includes(key))) {
    throw publicationInvalid(message);
  }
  return value;
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function canonicalRecord(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalRecord).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalRecord(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) === undefined ? 'null' : JSON.stringify(value);
}

function requireActiveAttempt(state, attempt) {
  const activeId = state.activeAttemptId;
  if (typeof activeId !== 'string' || activeId.length === 0) {
    throw publicationInvalid('publication proof needs an active release attempt');
  }
  if (!Array.isArray(state.attempts)) throw publicationInvalid('publication proof needs an active release attempt');
  const active = state.attempts.find((candidate) => isPlainRecord(candidate) && candidate.id === activeId);
  if (active === undefined) throw publicationInvalid('publication proof needs an active release attempt');
  if (!isPlainRecord(attempt)) throw publicationInvalid('publication proof attempt must be the active attempt record');
  if (canonicalRecord(attempt) !== canonicalRecord(active)) {
    throw publicationInvalid('publication proof attempt is not the active release attempt');
  }
  return active;
}

function requireProofContext(options) {
  if (!isPlainRecord(options)) throw publicationInvalid('publication proof needs an explicit state, attempt and digest');
  const { state, attempt, manifestSha256 } = options;
  if (!isPlainRecord(state)) throw publicationInvalid('publication proof needs a validated release state');
  if (typeof manifestSha256 !== 'string' || !DIGEST_PATTERN.test(manifestSha256)) {
    throw publicationInvalid('publication proof needs the exact retained manifest digest');
  }
  if (!isPlainRecord(state.repo) || typeof state.repo.remoteRepo !== 'string') {
    throw publicationInvalid('publication proof needs the validated release repository identity');
  }
  return { state, attempt: requireActiveAttempt(state, attempt), manifestSha256 };
}

function requireArtifactsAgreement(state, proof) {
  if (!isPlainRecord(state.artifacts)) throw publicationInvalid('publication proof needs the release artifacts record');
  if (state.artifacts.state !== 'complete') return;
  if (state.artifacts.sourceSha !== proof.sourceSha) {
    throw publicationInvalid('publication proof source contradicts the complete artifacts record');
  }
  if (state.artifacts.runId !== proof.run.id) {
    throw publicationInvalid('publication proof run contradicts the complete artifacts record');
  }
  if (state.artifacts.manifestSha256 !== proof.manifestSha256) {
    throw publicationInvalid('publication proof digest contradicts the complete artifacts record');
  }
  if (state.artifacts.verifiedAt !== proof.verifiedAt) {
    throw publicationInvalid('publication proof time contradicts the complete artifacts record');
  }
}

function requireProofEnvelope(proof, context) {
  requireExactRecord(proof, PROOF_KEYS, 'publication proof must carry exactly the retained evidence fields');
  const { state, attempt, manifestSha256 } = context;
  if (proof.schema !== PROOF_SCHEMA) throw publicationInvalid('publication proof schema must be the retained evidence schema');
  if (proof.releaseId !== state.releaseId) {
    throw publicationInvalid('publication proof release id is not the active release');
  }
  if (proof.attemptId !== attempt.id) throw publicationInvalid('publication proof attempt id is not the active attempt');
  if (proof.version !== state.version || proof.version !== attempt.version) {
    throw publicationInvalid('publication proof version is not the active release version');
  }
  if (proof.mode !== PUBLISH_MODE || state.mode !== PUBLISH_MODE || attempt.mode !== PUBLISH_MODE) {
    throw publicationInvalid('publication proof requires a publish release');
  }
  if (typeof proof.sourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(proof.sourceSha)) {
    throw publicationInvalid('publication proof source must be a full object id');
  }
  if (proof.sourceSha !== state.sourceSha || proof.sourceSha !== attempt.sourceSha) {
    throw publicationInvalid('publication proof source is not the original release source');
  }
  if (proof.manifestSha256 !== manifestSha256) {
    throw publicationInvalid('publication proof digest is not the retained manifest digest');
  }
  if (!isCanonicalTimestamp(proof.verifiedAt)) {
    throw publicationInvalid('publication proof verifiedAt must be a canonical observation time');
  }
  if (attempt.dispatch !== 'identified') throw publicationInvalid('publication proof requires an identified attempt');
  if (attempt.runStatus !== 'completed' || attempt.conclusion !== 'success') {
    throw publicationInvalid('publication proof requires a completed successful attempt');
  }

  const run = requireExactRecord(
    proof.run, PROOF_RUN_KEYS, 'publication proof run must carry exactly the observed run fields'
  );
  requireExactRecord(
    run.repository, PROOF_RUN_REPOSITORY_KEYS, 'publication proof run repository must carry exactly the observed name'
  );
  if (!isPositiveInteger(run.id) || !isPositiveInteger(run.run_attempt)) {
    throw publicationInvalid('publication proof run must carry positive run identities');
  }
  if (typeof run.display_title !== 'string') {
    throw publicationInvalid('publication proof run must carry its observed display title');
  }
  if (attempt.runId !== run.id) throw publicationInvalid('publication proof run id is not the bound attempt run');
  if (attempt.runAttempt !== run.run_attempt) {
    throw publicationInvalid('publication proof run attempt is not the bound attempt run attempt');
  }

  const request = requireExactRecord(
    proof.uploadJobsRequest, UPLOAD_REQUEST_KEYS, 'publication proof upload jobs request must carry exactly the requested identities'
  );
  if (!isPositiveInteger(request.runId) || !isPositiveInteger(request.runAttempt)) {
    throw publicationInvalid('publication proof upload jobs request needs positive identities');
  }
  if (request.runId !== run.id || request.runAttempt !== run.run_attempt) {
    throw publicationInvalid('publication proof upload jobs request is not the observed run attempt');
  }

  const job = requireExactRecord(
    proof.uploadJob, UPLOAD_JOB_KEYS, 'publication proof upload job must carry exactly the selected job fields'
  );
  if (!isPositiveInteger(job.id)) throw publicationInvalid('publication proof upload job needs a positive job id');
  if (job.name !== UPLOAD_JOB_NAME) throw publicationInvalid('publication proof upload job is not named upload');
  if (job.status !== UPLOAD_JOB_STATUS || job.conclusion !== UPLOAD_JOB_CONCLUSION) {
    throw publicationInvalid('publication proof upload job is not a completed successful upload');
  }

  requireArtifactsAgreement(state, proof);
  return { verifiedAt: proof.verifiedAt, run, job };
}

function validatePublicationProof(proof, options) {
  const context = requireProofContext(options);
  if (context.attempt.identityKind !== 'dispatch') {
    throw publicationInvalid('publication proof requires a dispatch attempt');
  }
  const envelope = requireProofEnvelope(proof, context);
  let observation;
  try {
    observation = workflowIdentity().requireWorkflowRun({
      attempt: context.attempt,
      remoteRepo: context.state.repo.remoteRepo,
      run: envelope.run,
    });
  } catch (error) {
    throw publicationCause('publication proof run does not satisfy the accepted workflow identity', error);
  }
  if (observation.runStatus !== 'completed' || observation.conclusion !== 'success') {
    throw publicationInvalid('publication proof run is not a completed successful workflow run');
  }
  if (observation.runId !== envelope.run.id || observation.runAttempt !== envelope.run.run_attempt) {
    throw publicationInvalid('publication proof observation is not the observed run attempt');
  }
  return { verifiedAt: envelope.verifiedAt };
}

function carriesNewFormatAttemptToken(title) {
  return title.split(/\s+/).some((token) => NEW_FORMAT_ATTEMPT_TOKEN.test(token));
}

function validateLegacyPublicationProof(proof, options) {
  const context = requireProofContext(options);
  const attempt = context.attempt;
  if (attempt.identityKind !== 'legacy-upload-proof') {
    throw publicationInvalid('legacy publication proof requires a legacy upload proof attempt');
  }
  if (attempt.id !== `legacy:${attempt.runId}:${attempt.runAttempt}`) {
    throw publicationInvalid('legacy publication proof attempt id is not the derived legacy id');
  }
  if (attempt.expectedTitle !== null || attempt.dispatchRef !== null) {
    throw publicationInvalid('legacy publication proof attempt must not carry a dispatch title or ref');
  }
  if (attempt.requestedAt !== null || attempt.watchDeadlineAt !== null) {
    throw publicationInvalid('legacy publication proof attempt must not carry dispatch request times');
  }
  if (!isPositiveInteger(attempt.runAttempt)) {
    throw publicationInvalid('legacy publication proof attempt needs a positive run attempt');
  }
  const legacyProof = attempt.legacyProof;
  if (!isPlainRecord(legacyProof)) {
    throw publicationInvalid('legacy publication proof attempt needs its recorded legacy proof');
  }
  const envelope = requireProofEnvelope(proof, context);
  if (envelope.job.id !== legacyProof.uploadJobId) {
    throw publicationInvalid('legacy publication proof job is not the recorded legacy upload job');
  }
  if (legacyProof.uploadJobConclusion !== UPLOAD_JOB_CONCLUSION) {
    throw publicationInvalid('legacy publication proof recorded upload job did not conclude success');
  }
  if (legacyProof.observedHeadSha !== attempt.sourceSha) {
    throw publicationInvalid('legacy publication proof recorded source is not the attempt source');
  }
  if (legacyProof.observedMode !== PUBLISH_MODE) {
    throw publicationInvalid('legacy publication proof recorded mode is not publish');
  }
  if (carriesNewFormatAttemptToken(envelope.run.display_title)) {
    throw publicationInvalid('legacy publication proof title carries a new-format attempt token');
  }
  let observation;
  try {
    observation = workflowIdentity().requireWorkflowRunFacts({
      remoteRepo: context.state.repo.remoteRepo,
      workflowId: attempt.workflowId,
      sourceSha: attempt.sourceSha,
      runId: attempt.runId,
      runAttempt: attempt.runAttempt,
      run: envelope.run,
    });
  } catch (error) {
    throw publicationCause('legacy publication proof run does not satisfy the shared workflow run facts', error);
  }
  if (observation.runStatus !== 'completed' || observation.conclusion !== 'success') {
    throw publicationInvalid('legacy publication proof run is not a completed successful workflow run');
  }
  return { verifiedAt: envelope.verifiedAt };
}

function requireJobStatus(status, conclusion) {
  if (typeof status !== 'string' || !RUN_STATES.includes(status)) {
    throw publicationInvalid('upload jobs row status is not a known run state');
  }
  if (status === 'completed') {
    if (typeof conclusion !== 'string' || !CONCLUSIONS.includes(conclusion)) {
      throw publicationInvalid('upload jobs row conclusion is not a known conclusion');
    }
  } else if (conclusion !== null) {
    throw publicationInvalid('upload jobs row carries a conclusion before it completed');
  }
}

function requireJobRequestIdentity(job, request) {
  if (Object.prototype.hasOwnProperty.call(job, 'run_id') &&
      (!isPositiveInteger(job.run_id) || job.run_id !== request.runId)) {
    throw publicationInvalid('upload jobs row run id contradicts the requested run');
  }
  if (Object.prototype.hasOwnProperty.call(job, 'run_attempt') &&
      (!isPositiveInteger(job.run_attempt) || job.run_attempt !== request.runAttempt)) {
    throw publicationInvalid('upload jobs row run attempt contradicts the requested attempt');
  }
  if (Object.prototype.hasOwnProperty.call(job, 'head_sha') &&
      (typeof job.head_sha !== 'string' || job.head_sha !== request.sourceSha)) {
    throw publicationInvalid('upload jobs row head sha contradicts the requested source');
  }
}

function selectUploadJob(pages, options) {
  if (!isPlainRecord(options)) throw publicationInvalid('upload job selection needs an explicit request identity');
  const request = {
    runId: options.runId,
    runAttempt: options.runAttempt,
    sourceSha: options.sourceSha,
  };
  if (!isPositiveInteger(request.runId)) throw publicationInvalid('upload job selection needs a positive run id');
  if (!isPositiveInteger(request.runAttempt)) throw publicationInvalid('upload job selection needs a positive run attempt');
  if (typeof request.sourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(request.sourceSha)) {
    throw publicationInvalid('upload job selection needs a full source object id');
  }
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > MAX_JOB_PAGES) {
    throw publicationInvalid('upload jobs pages must be a nonempty bounded sequence');
  }

  let total = null;
  let rows = 0;
  let named = 0;
  let upload = null;
  const ids = new Set();
  pages.forEach((page) => {
    if (!isPlainRecord(page)) throw publicationInvalid('upload jobs page must be a plain record');
    requireJobRequestIdentity(page, request);
    if (!isNonNegativeInteger(page.total_count) || page.total_count > MAX_JOB_ROWS) {
      throw publicationInvalid('upload jobs page total_count must be a nonnegative whole job count');
    }
    if (total === null) total = page.total_count;
    else if (page.total_count !== total) throw publicationInvalid('upload jobs pages must agree on total_count');
    if (!Array.isArray(page.jobs) || page.jobs.length > MAX_JOB_ROWS_PER_PAGE) {
      throw publicationInvalid('upload jobs page must carry at most one hundred rows');
    }
    rows += page.jobs.length;
    page.jobs.forEach((job) => {
      if (!isPlainRecord(job)) throw publicationInvalid('upload jobs row must be a plain record');
      if (!isPositiveInteger(job.id)) throw publicationInvalid('upload jobs row needs a positive job id');
      if (ids.has(job.id)) throw publicationInvalid('upload jobs rows must carry unique job ids');
      ids.add(job.id);
      if (typeof job.name !== 'string' || job.name.length === 0) {
        throw publicationInvalid('upload jobs row needs a name');
      }
      requireJobStatus(job.status, job.conclusion);
      requireJobRequestIdentity(job, request);
      if (job.name !== UPLOAD_JOB_NAME) return;
      named += 1;
      if (job.status === UPLOAD_JOB_STATUS && job.conclusion === UPLOAD_JOB_CONCLUSION) {
        upload = { id: job.id, name: job.name, status: job.status, conclusion: job.conclusion };
      }
    });
  });

  if (rows !== total) throw publicationInvalid('upload jobs pages must carry exactly the complete total_count rows');
  if (named !== 1 || upload === null) {
    throw publicationInvalid('upload jobs response must carry exactly one completed successful upload job');
  }
  return upload;
}


let defaultGitRun = null;

function localRead() {
  return require('./release-local-read');
}

function releaseStateModule() {
  return require('./release-state');
}

function evidenceInvalid(message, cause) {
  const error = publicationInvalid(message);
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function isPublicationFailure(value) {
  return Boolean(value) && typeof value === 'object' && value.code === FAILURE_CODE;
}

function evidenceFailure(message, cause) {
  if (isPublicationFailure(cause)) return cause;
  return evidenceInvalid(message, cause);
}

function digestOf(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function defaultRun() {
  if (defaultGitRun === null) defaultGitRun = localRead().createLocalGitReader().run;
  return defaultGitRun;
}

function resolveReadDeps(options) {
  const provided = options === undefined || options === null ? {} : options;
  if (!isPlainRecord(provided)) throw publicationInvalid('publication evidence options must be a plain object');
  const run = provided.run === undefined ? defaultRun() : provided.run;
  const io = provided.fs === undefined ? fs : provided.fs;
  if (typeof run !== 'function') throw publicationInvalid('publication evidence needs a Git run function');
  if (io === null || typeof io !== 'object' || Array.isArray(io)) {
    throw publicationInvalid('publication evidence needs a filesystem');
  }
  return { run, io };
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value === null || value === undefined) return Buffer.alloc(0);
  return Buffer.from(String(value), 'utf8');
}

function requireCanonicalRoot(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0 || !path.isAbsolute(repoRoot)) {
    throw publicationInvalid('published source repository root must be an absolute path');
  }
  let real;
  try {
    real = fs.realpathSync(repoRoot);
  } catch (error) {
    throw evidenceInvalid('published source repository root is missing', error);
  }
  if (real !== repoRoot) throw publicationInvalid('published source repository root must be canonical');
  let stat;
  try {
    stat = fs.lstatSync(repoRoot);
  } catch (error) {
    throw evidenceInvalid('published source repository root is missing', error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw publicationInvalid('published source repository root must be an ordinary directory');
  }
}

function requireSourceCommit(run, repoRoot, sourceSha) {
  let output;
  try {
    output = run('git', ['rev-parse', '--verify', `${sourceSha}^{commit}`], { cwd: repoRoot });
  } catch (error) {
    throw evidenceFailure('published source commit is not readable from the object store', error);
  }
  if (toBytes(output).toString('utf8').trim() !== sourceSha) {
    throw publicationInvalid('published source does not resolve to its own commit');
  }
}

function requireSourcePackageBlob(run, repoRoot, sourceSha) {
  let output;
  try {
    output = run('git', ['ls-tree', '-z', sourceSha, '--', PACKAGE_FILE], {
      cwd: repoRoot, encoding: null, maxBuffer: SOURCE_MAX_BYTES
    });
  } catch (error) {
    throw evidenceFailure('published source package.json tree entry is not readable', error);
  }
  const bytes = toBytes(output);
  if (bytes.length > SOURCE_MAX_BYTES) {
    throw publicationInvalid('published source package.json tree entry exceeds the read bound');
  }
  const terminator = bytes.indexOf(0);
  if (terminator < 0) throw publicationInvalid('published source package.json tree entry is not NUL terminated');
  if (terminator !== bytes.length - 1) {
    throw publicationInvalid('published source must carry exactly one package.json tree entry');
  }
  const fields = bytes.subarray(0, terminator).toString('utf8').split('\t');
  if (fields.length !== 2 || fields[1] !== PACKAGE_FILE) {
    throw publicationInvalid('published source package.json tree entry is not the package file');
  }
  const parts = fields[0].split(' ');
  if (parts.length !== 3) throw publicationInvalid('published source package.json tree entry is malformed');
  if (parts[1] !== 'blob') throw publicationInvalid('published source package.json must be an ordinary blob');
  if (!BLOB_MODES.includes(parts[0])) {
    throw publicationInvalid('published source package.json mode is not an ordinary file mode');
  }
  if (!SOURCE_SHA_PATTERN.test(parts[2]) || parts[2].length !== sourceSha.length) {
    throw publicationInvalid('published source package.json object id is not a full object id');
  }
  return parts[2];
}

function requireSourcePackageBytes(run, repoRoot, blobOid) {
  let output;
  try {
    output = run('git', ['cat-file', 'blob', blobOid], {
      cwd: repoRoot, encoding: null, maxBuffer: SOURCE_MAX_BYTES
    });
  } catch (error) {
    throw evidenceFailure('published source package.json blob is not readable', error);
  }
  const bytes = toBytes(output);
  if (bytes.length > SOURCE_MAX_BYTES) {
    throw publicationInvalid('published source package.json blob exceeds the read bound');
  }
  return bytes;
}

function requireSourcePackageVersion(bytes, version) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw evidenceInvalid('published source package.json is not valid JSON', error);
  }
  if (!isPlainRecord(parsed)) {
    throw publicationInvalid('published source package.json must be a plain JSON record');
  }
  if (parsed.version !== version) {
    throw publicationInvalid('published source package.json version is not the expected release version');
  }
}

function readPublishedSourceVersion(input, options) {
  const expected = requireExpectedIdentity(input);
  const deps = resolveReadDeps(options);
  requireCanonicalRoot(input.repoRoot);
  requireSourceCommit(deps.run, input.repoRoot, expected.sourceSha);
  const blobOid = requireSourcePackageBlob(deps.run, input.repoRoot, expected.sourceSha);
  requireSourcePackageVersion(requireSourcePackageBytes(deps.run, input.repoRoot, blobOid), expected.version);
  return { sourceSha: expected.sourceSha, version: expected.version };
}

function requirePublicationState(state, repoDir) {
  if (!isPlainRecord(state) || !isPlainRecord(state.repo)) {
    throw publicationInvalid('publication evidence needs a validated release state');
  }
  if (typeof repoDir !== 'string' || repoDir.length === 0) {
    throw publicationInvalid('publication evidence needs the release cache directory');
  }
  let validated;
  try {
    validated = releaseStateModule().validateReleaseState(state, state.repo, { repoDir });
  } catch (error) {
    throw evidenceFailure('release state is not a valid publication state', error);
  }
  if (validated.mode !== PUBLISH_MODE) {
    throw publicationInvalid('publication evidence requires a publish release');
  }
  const activeId = validated.activeAttemptId;
  const attempt = validated.attempts.find(
    (candidate) => isPlainRecord(candidate) && candidate.id === activeId
  );
  if (attempt === undefined) throw publicationInvalid('publication evidence needs the active release attempt');
  if (attempt.dispatch !== 'identified') {
    throw publicationInvalid('publication evidence requires an identified attempt');
  }
  if (attempt.runStatus !== 'completed' || attempt.conclusion !== 'success') {
    throw publicationInvalid('publication evidence requires a completed successful attempt');
  }
  return { state: validated, attempt };
}

function requireRetainedDigest(manifestSha256) {
  if (typeof manifestSha256 !== 'string' || !DIGEST_PATTERN.test(manifestSha256)) {
    throw publicationInvalid('publication evidence needs the exact retained manifest digest');
  }
  return manifestSha256;
}

function requireRecordedObjectStore(state, run) {
  let observed;
  try {
    observed = require('./release-target-evidence').observeObjectStore(run, state.repo.root);
  } catch (error) {
    throw evidenceFailure('release repository object store is not readable', error);
  }
  for (const field of OBJECT_STORE_FIELDS) {
    if (observed[field] !== state.repo[field]) {
      throw publicationInvalid('release repository identity is not the recorded object store');
    }
  }
  return observed;
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

function requireOrdinaryDirectory(io, target, label) {
  let stat;
  try {
    stat = io.lstatSync(target);
  } catch (error) {
    throw evidenceInvalid(`${label} is missing`, error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw publicationInvalid(`${label} must be a real directory`);
  }
  if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw publicationInvalid(`${label} is writable by group or other`);
  }
}

function requireEvidenceLayout(io, state, attempt, repoDir) {
  const root = requireEvidenceRoot(repoDir, state.repo);
  let real;
  try {
    real = io.realpathSync(root);
  } catch (error) {
    throw evidenceInvalid('release evidence root is missing', error);
  }
  if (real !== root) throw publicationInvalid('release evidence root must be canonical');
  requireOrdinaryDirectory(io, root, 'release evidence root');
  let attemptDir = root;
  for (const segment of [RECORDS_DIR, state.releaseId, ARTIFACTS_DIR, publicationAttemptDirectoryName(attempt.id)]) {
    attemptDir = path.join(attemptDir, segment);
    requireOrdinaryDirectory(io, attemptDir, 'release evidence path');
  }
  return {
    manifestFile: path.join(attemptDir, MANIFEST_FILE),
    proofFile: path.join(attemptDir, PROOF_FILE)
  };
}

function requireEvidenceLeaf(io, target, maxBytes, label) {
  let stat;
  try {
    stat = io.lstatSync(target);
  } catch (error) {
    throw evidenceInvalid(`${label} is missing`, error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw publicationInvalid(`${label} must be an ordinary file`);
  if ((stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw publicationInvalid(`${label} permissions are unsafe`);
  }
  if (stat.size > maxBytes) throw publicationInvalid(`${label} exceeds the read bound`);
  let bytes;
  try {
    bytes = localRead().readBoundedOrdinaryFile(target, { maxBytes, fs: io });
  } catch (error) {
    throw evidenceFailure(`${label} is not readable`, error);
  }
  if (bytes.length > maxBytes) throw publicationInvalid(`${label} exceeds the read bound`);
  return bytes;
}

function requireRetainedManifest(io, layout, digest, state) {
  const bytes = requireEvidenceLeaf(io, layout.manifestFile, MANIFEST_MAX_BYTES, 'retained manifest');
  if (digestOf(bytes) !== digest) {
    throw publicationInvalid('retained manifest bytes do not match the recorded digest');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw evidenceInvalid('retained manifest is not valid JSON', error);
  }
  try {
    return validateReleaseManifest(parsed, { version: state.version, sourceSha: state.sourceSha });
  } catch (error) {
    throw evidenceFailure('retained manifest is not valid release evidence', error);
  }
}

function requireRetainedProof(io, layout, state, attempt, digest) {
  const bytes = requireEvidenceLeaf(io, layout.proofFile, PROOF_MAX_BYTES, 'retained publication proof');
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw evidenceInvalid('retained publication proof is not valid JSON', error);
  }
  if (!isPlainRecord(parsed)) {
    throw publicationInvalid('retained publication proof must be a plain JSON record');
  }
  const context = { state, attempt, manifestSha256: digest };
  let result;
  try {
    result = attempt.identityKind === 'legacy-upload-proof'
      ? validateLegacyPublicationProof(parsed, context)
      : validatePublicationProof(parsed, context);
  } catch (error) {
    throw evidenceFailure('retained publication proof is not valid evidence', error);
  }
  return { runId: parsed.run.id, verifiedAt: result.verifiedAt };
}

function readPublicationPair(input, options) {
  if (!isPlainRecord(input)) {
    throw publicationInvalid('publication evidence needs a validated release state and cache directory');
  }
  const deps = resolveReadDeps(options);
  const validated = requirePublicationState(input.state, input.repoDir);
  const digest = requireRetainedDigest(input.manifestSha256);
  const complete = validated.state.artifacts.state === 'complete';
  if (complete && validated.state.artifacts.manifestSha256 !== digest) {
    throw publicationInvalid('complete artifacts record does not carry the supplied manifest digest');
  }
  const store = requireRecordedObjectStore(validated.state, deps.run);
  const layout = requireEvidenceLayout(deps.io, validated.state, validated.attempt, input.repoDir);
  if (complete && validated.state.artifacts.manifestFile !== layout.manifestFile) {
    throw publicationInvalid('complete artifacts record names an alternate manifest path');
  }
  const manifest = requireRetainedManifest(deps.io, layout, digest, validated.state);
  const proof = requireRetainedProof(deps.io, layout, validated.state, validated.attempt, digest);
  const source = readPublishedSourceVersion({
    repoRoot: store.root, sourceSha: validated.state.sourceSha, version: validated.state.version
  }, { run: deps.run });
  return { manifest, sourceSha: source.sourceSha, runId: proof.runId, verifiedAt: proof.verifiedAt };
}

function readPublicationEvidence(input, options) {
  if (!isPlainRecord(input) || !isPlainRecord(input.state) || !isPlainRecord(input.state.artifacts)) {
    throw publicationInvalid('publication evidence needs a validated release state');
  }
  if (input.state.artifacts.state !== 'complete') {
    throw publicationInvalid('publication evidence requires complete artifact evidence');
  }
  return readPublicationPair({
    state: input.state,
    repoDir: input.repoDir,
    manifestSha256: input.state.artifacts.manifestSha256
  }, options);
}

module.exports = {
  validateReleaseManifest,
  validatePublicationProof,
  validateLegacyPublicationProof,
  selectUploadJob,
  readPublishedSourceVersion,
  readPublicationPair,
  readPublicationEvidence,
};
