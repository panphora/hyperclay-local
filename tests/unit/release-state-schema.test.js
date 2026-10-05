// D2 schema step: durable desktop release records are validated before any reader
// or writer may treat them as routing evidence. Every fixture here is an in-memory
// record with a hand-built canonical identity: no Git, no commands, no filesystem.
const crypto = require('crypto');
const path = require('path');

const { validateReleaseState } = require('../../scripts/release-state');

const CHECKOUT_ROOT = '/Users/fixture/checkout/hyperclay-local';
const COMMON_DIR = '/Users/fixture/checkout/hyperclay-local/.git';
const CACHE_ROOT = '/Users/fixture/.cache/hyperclay-local/releases';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const IDENTITY = {
  key: sha256(COMMON_DIR),
  root: CHECKOUT_ROOT,
  commonDir: COMMON_DIR,
  branch: 'main',
  remote: 'origin',
  remoteRepo: 'github.com/fixture-owner/hyperclay-local',
  pushUrlSha256: sha256('git@github.com:fixture-owner/hyperclay-local.git'),
  objectFormat: 'sha1'
};

const REPO_DIR = path.join(CACHE_ROOT, IDENTITY.key);

const VERSION = '1.29.0';
const PREVIOUS_VERSION = '1.28.0';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const OTHER_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const SITE_ATTEMPT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';
const LEGACY_ATTEMPT_ID = 'legacy:456:1';
const RUN_ID = 456;
const SOURCE_SHA = 'a'.repeat(40);
const BASE_HEAD = 'b'.repeat(40);
const SIZE_COMMIT = 'c'.repeat(40);
const SITE_COMMIT = 'd'.repeat(40);
const SITE_TREE = 'e'.repeat(40);
const DIGEST = 'f'.repeat(64);
const CREATED_AT = '2026-10-03T19:00:00.000Z';
const REQUESTED_AT = '2026-10-03T20:00:00.000Z';
const WATCH_DEADLINE_AT = '2026-10-03T23:00:00.000Z';
const OBSERVED_AT = '2026-10-03T20:30:00.000Z';
const RECORDS_DIR = path.join(REPO_DIR, 'records', RELEASE_ID);

function evidence(name) {
  return path.join(RECORDS_DIR, name);
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function completeTarget(name) {
  return { state: 'complete', journalFile: evidence(name), commit: SIZE_COMMIT, reason: null };
}

function pendingSite() {
  return {
    state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
    receiptSha: null, verifiedAt: null, error: null
  };
}

function completeSite() {
  return {
    state: 'complete', sourceSha: SITE_COMMIT, treeSha: SITE_TREE, attemptId: SITE_ATTEMPT_ID,
    receiptSha: SITE_COMMIT, verifiedAt: OBSERVED_AT, error: null
  };
}

function completeArtifacts() {
  return {
    state: 'complete', sourceSha: SOURCE_SHA, runId: RUN_ID, manifestFile: evidence('release-info.json'),
    manifestSha256: DIGEST, verifiedAt: OBSERVED_AT
  };
}

function dispatchAttempt(patch = {}) {
  return Object.assign({
    id: ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: 12345,
    expectedTitle: `release v${VERSION} publish sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`,
    dispatch: 'identified',
    requestedAt: REQUESTED_AT,
    watchDeadlineAt: WATCH_DEADLINE_AT,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: OBSERVED_AT,
    error: null
  }, patch);
}

function dryRunAttempt(patch = {}) {
  return dispatchAttempt(Object.assign({
    mode: 'dry-run',
    expectedTitle: `release v${VERSION} dry-run sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`
  }, patch));
}

function requestedAttempt() {
  return dispatchAttempt({
    dispatch: 'requested',
    runId: null,
    runAttempt: null,
    runStatus: null,
    conclusion: null,
    lastObservedAt: null
  });
}

function runningAttempt() {
  return dispatchAttempt({ runStatus: 'in_progress', conclusion: null });
}

function legacyAttempt() {
  return {
    id: LEGACY_ATTEMPT_ID,
    identityKind: 'legacy-upload-proof',
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA,
    dispatchRef: null,
    workflowPath: '.github/workflows/release.yml',
    workflowId: 12345,
    expectedTitle: null,
    dispatch: 'identified',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: OBSERVED_AT,
    error: null,
    legacyProof: {
      uploadJobId: 789,
      uploadJobConclusion: 'success',
      observedHeadSha: SOURCE_SHA,
      observedMode: 'publish'
    }
  };
}

function versionIntent() {
  return {
    previousVersion: PREVIOUS_VERSION,
    version: VERSION,
    baseHead: BASE_HEAD,
    journalFile: evidence('version-intent/journal.json'),
    files: [
      {
        path: 'package.json',
        beforeSha256: DIGEST,
        afterSha256: sha256('package.json after'),
        beforeMode: 0o644,
        afterMode: 0o644,
        preparedFile: evidence('version-intent/package.json')
      },
      {
        path: 'CHANGELOG.md',
        beforeSha256: sha256('CHANGELOG.md before'),
        afterSha256: sha256('CHANGELOG.md after'),
        beforeMode: 0o644,
        afterMode: 0o644,
        preparedFile: evidence('version-intent/CHANGELOG.md')
      }
    ]
  };
}

function newState() {
  return {
    schema: 1,
    revision: 4,
    repo: { ...IDENTITY },
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: CREATED_AT,
    updatedAt: OBSERVED_AT,
    versionIntent: null,
    sourceSha: SOURCE_SHA,
    activeAttemptId: ATTEMPT_ID,
    attempts: [runningAttempt()],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: pendingSite(),
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null
  };
}

function versionPreparingRecord() {
  return Object.assign(newState(), {
    phase: 'version-preparing',
    sourceSha: null,
    activeAttemptId: null,
    attempts: [],
    versionIntent: versionIntent()
  });
}

function sourceReadyRecord() {
  return Object.assign(newState(), { phase: 'source-ready', activeAttemptId: null, attempts: [] });
}

function requestedWorkflowRecord() {
  return Object.assign(newState(), { attempts: [requestedAttempt()] });
}

function identifiedWorkflowRecord() {
  return newState();
}

function failedCiRecord() {
  return Object.assign(newState(), {
    phase: 'failed-ci',
    attempts: [dispatchAttempt({ conclusion: 'failure' })],
    lastError: { code: 'WORKFLOW_FAILED', message: 'Release workflow concluded failure' }
  });
}

function partialTailRecord() {
  return Object.assign(newState(), {
    phase: 'tail',
    attempts: [dispatchAttempt()],
    artifacts: completeArtifacts(),
    sizes: completeTarget('sizes/journal.json'),
    docs: { hyperclay: completeTarget('docs/hyperclay.json'), 'hyperclay-website': pendingTarget() }
  });
}

function completedTailRecord() {
  return Object.assign(newState(), {
    phase: 'complete',
    attempts: [dispatchAttempt()],
    artifacts: completeArtifacts(),
    sizes: completeTarget('sizes/journal.json'),
    site: completeSite(),
    docs: {
      hyperclay: completeTarget('docs/hyperclay.json'),
      'hyperclay-website': completeTarget('docs/hyperclay-website.json')
    },
    install: { state: 'failed', error: { code: 'INSTALL_FAILED', message: 'Installer exited nonzero' } }
  });
}

function completedDryRunRecord() {
  return Object.assign(newState(), {
    mode: 'dry-run',
    phase: 'complete',
    attempts: [dryRunAttempt()]
  });
}

function legacyImportRecord() {
  return Object.assign(newState(), {
    phase: 'tail',
    activeAttemptId: LEGACY_ATTEMPT_ID,
    attempts: [legacyAttempt()],
    artifacts: completeArtifacts()
  });
}

const RECORD_BUILDERS = {
  prepare: versionPreparingRecord,
  source: sourceReadyRecord,
  running: identifiedWorkflowRecord,
  requested: requestedWorkflowRecord,
  'failed-ci': failedCiRecord,
  'tail-partial': partialTailRecord,
  'tail-complete': completedTailRecord,
  'dry-run': completedDryRunRecord,
  legacy: legacyImportRecord
};

const VALID_RECORDS = [
  ['version-preparing', versionPreparingRecord],
  ['source-ready', sourceReadyRecord],
  ['workflow-ready', () => Object.assign(newState(), {
    attempts: [dispatchAttempt({
      dispatch: 'ready',
      requestedAt: null,
      watchDeadlineAt: null,
      runId: null,
      runAttempt: null,
      runStatus: null,
      conclusion: null,
      lastObservedAt: null
    })]
  })],
  ['workflow-requested', requestedWorkflowRecord],
  ['workflow-identified-running', identifiedWorkflowRecord],
  ['failed-ci', failedCiRecord],
  ['tail-partial', partialTailRecord],
  ['tail-complete-install-failed', completedTailRecord],
  ['dry-run-complete', completedDryRunRecord],
  ['legacy-import', legacyImportRecord]
];

const INVALID_CASES = [
  ['unknown schema version', 'running', s => { s.schema = 2; }],
  ['schema as a string', 'running', s => { s.schema = '1'; }],
  ['unknown top-level field', 'running', s => { s.notes = 'left over from another writer'; }],
  ['missing top-level field', 'running', s => { delete s.updatedAt; }],
  ['artifacts not an object', 'running', s => { s.artifacts = 'pending'; }],
  ['repo root is another checkout', 'running', s => { s.repo.root = '/Users/other/checkout/hyperclay-local'; }],
  ['repo common dir mismatch', 'running', s => { s.repo.commonDir = '/Users/other/checkout/hyperclay-local/.git'; }],
  ['repo branch mismatch', 'running', s => { s.repo.branch = 'release'; }],
  ['repo remote mismatch', 'running', s => { s.repo.remote = 'upstream'; }],
  ['repo identity mismatch', 'running', s => { s.repo.remoteRepo = 'github.com/other-owner/other-repo'; }],
  ['repo push digest mismatch', 'running', s => { s.repo.pushUrlSha256 = sha256('https://github.com/other-owner/other-repo.git'); }],
  ['repo key mismatch', 'running', s => { s.repo.key = sha256('/Users/other/checkout/hyperclay-local/.git'); }],
  ['repo object format mismatch', 'running', s => { s.repo.objectFormat = 'sha256'; }],
  ['repo field missing', 'running', s => { delete s.repo.remote; }],
  ['repo field unknown', 'running', s => { s.repo.worktree = CHECKOUT_ROOT; }],
  ['revision negative', 'running', s => { s.revision = -1; }],
  ['revision fractional', 'running', s => { s.revision = 1.5; }],
  ['revision not a number', 'running', s => { s.revision = '4'; }],
  ['revision NaN', 'running', s => { s.revision = Number.NaN; }],
  ['createdAt not canonical', 'running', s => { s.createdAt = '2026-10-03T19:00:00Z'; }],
  ['createdAt not a date', 'running', s => { s.createdAt = 'yesterday'; }],
  ['createdAt not a string', 'running', s => { s.createdAt = 1790000000000; }],
  ['updatedAt before createdAt', 'running', s => { s.updatedAt = '2026-10-03T18:00:00.000Z'; }],
  ['unknown mode', 'running', s => { s.mode = 'shadow'; }],
  ['unknown phase', 'running', s => { s.phase = 'shipping'; }],
  ['malformed version', 'source', s => { s.version = '1.29'; }],
  ['version with a leading zero', 'source', s => { s.version = '01.29.0'; }],
  ['version component above the bound', 'source', s => { s.version = '1.29.70000'; }],
  ['version with a suffix', 'source', s => { s.version = '1.29.0-rc.1'; }],
  ['release id is not a version 4 uuid', 'running', s => { s.releaseId = '3f2a1c0d-5e6b-1a7c-9d8e-1f2a3b4c5d6e'; }],
  ['release id uppercase', 'running', s => { s.releaseId = RELEASE_ID.toUpperCase(); }],
  ['source sha uppercase', 'running', s => { s.sourceSha = SOURCE_SHA.toUpperCase(); }],
  ['source sha abbreviation', 'running', s => { s.sourceSha = 'abc123'; }],
  ['source sha wrong object format length', 'running', s => { s.sourceSha = 'a'.repeat(64); }],
  ['source sha missing outside preparation', 'running', s => { s.sourceSha = null; }],
  ['source sha is not the active attempt source', 'running', s => { s.sourceSha = '9'.repeat(40); }],
  ['active attempt missing in a workflow phase', 'running', s => { s.activeAttemptId = null; }],
  ['active attempt matches no attempt', 'running', s => { s.activeAttemptId = OTHER_ATTEMPT_ID; }],
  ['active attempt id is not a string', 'running', s => { s.activeAttemptId = 12; }],
  ['duplicate attempt ids', 'running', s => { s.attempts.push(dispatchAttempt({ runId: 999 })); }],
  ['attempt id is not a version 4 uuid', 'running', s => { s.attempts[0].id = 'not-an-attempt'; }],
  ['attempt version differs from the release', 'running', s => { s.attempts[0].version = PREVIOUS_VERSION; }],
  ['attempt mode differs from the release', 'running', s => { s.attempts[0].mode = 'dry-run'; }],
  ['attempt unknown field', 'running', s => { s.attempts[0].runStatusExtra = true; }],
  ['attempt missing field', 'running', s => { delete s.attempts[0].lastObservedAt; }],
  ['attempt identity kind unknown', 'running', s => { s.attempts[0].identityKind = 'legacy'; }],
  ['attempt dispatch ref wrong version', 'running', s => { s.attempts[0].dispatchRef = `v${PREVIOUS_VERSION}`; }],
  ['attempt expected title mismatch', 'running', s => { s.attempts[0].expectedTitle = `release v${VERSION} publish sha=${SOURCE_SHA}`; }],
  ['attempt workflow path mismatch', 'running', s => { s.attempts[0].workflowPath = '.github/workflows/ci.yml'; }],
  ['attempt workflow id zero', 'running', s => { s.attempts[0].workflowId = 0; }],
  ['attempt workflow id fractional', 'running', s => { s.attempts[0].workflowId = 1.5; }],
  ['attempt dispatch state unknown', 'running', s => { s.attempts[0].dispatch = 'waiting'; }],
  ['identified attempt without a run id', 'running', s => { s.attempts[0].runId = null; }],
  ['identified attempt without a run attempt', 'running', s => { s.attempts[0].runAttempt = null; }],
  ['identified attempt with an unknown run status', 'running', s => { s.attempts[0].runStatus = 'running'; }],
  ['running attempt carrying a conclusion', 'running', s => { s.attempts[0].conclusion = 'success'; }],
  ['completed attempt without a conclusion', 'failed-ci', s => { s.attempts[0].conclusion = null; }],
  ['completed attempt with an unknown conclusion', 'running', s => { s.attempts[0].conclusion = 'passed'; }],
  ['identified attempt without an observation time', 'running', s => { s.attempts[0].lastObservedAt = null; }],
  ['watch deadline extended past three hours', 'running', s => { s.attempts[0].watchDeadlineAt = '2026-10-04T00:00:00.000Z'; }],
  ['watch deadline shortened', 'running', s => { s.attempts[0].watchDeadlineAt = '2026-10-03T22:00:00.000Z'; }],
  ['watch deadline not canonical', 'running', s => { s.attempts[0].watchDeadlineAt = '2026-10-03T23:00:00Z'; }],
  ['watch deadline without a request time', 'running', s => { s.attempts[0].requestedAt = null; }],
  ['requested attempt carrying a successful run', 'requested', s => {
    Object.assign(s.attempts[0], { runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success' });
  }],
  ['requested attempt without timestamps', 'requested', s => {
    s.attempts[0].requestedAt = null;
    s.attempts[0].watchDeadlineAt = null;
  }],
  ['ready attempt carrying a run identity', 'running', s => {
    Object.assign(s.attempts[0], { dispatch: 'ready', runId: RUN_ID });
  }],
  ['ready attempt carrying a request time', 'running', s => {
    Object.assign(s.attempts[0], { dispatch: 'ready', requestedAt: REQUESTED_AT });
  }],
  ['legacy attempt with a dispatch ref', 'legacy', s => { s.attempts[0].dispatchRef = `v${VERSION}`; }],
  ['legacy attempt with an expected title', 'legacy', s => { s.attempts[0].expectedTitle = `release v${VERSION} publish`; }],
  ['legacy attempt with a request time', 'legacy', s => { s.attempts[0].requestedAt = REQUESTED_AT; }],
  ['legacy attempt id not derived from the run', 'legacy', s => { s.attempts[0].id = 'legacy:999:1'; }],
  ['legacy attempt with a uuid id', 'legacy', s => { s.attempts[0].id = ATTEMPT_ID; s.activeAttemptId = ATTEMPT_ID; }],
  ['legacy attempt without a proof', 'legacy', s => { delete s.attempts[0].legacyProof; }],
  ['legacy proof with an unknown field', 'legacy', s => { s.attempts[0].legacyProof.observedVersion = VERSION; }],
  ['legacy proof head different from the source', 'legacy', s => { s.attempts[0].legacyProof.observedHeadSha = '7'.repeat(40); }],
  ['legacy proof upload job failed', 'legacy', s => { s.attempts[0].legacyProof.uploadJobConclusion = 'failure'; }],
  ['legacy proof observed mode dry run', 'legacy', s => { s.attempts[0].legacyProof.observedMode = 'dry-run'; }],
  ['legacy proof upload job id zero', 'legacy', s => { s.attempts[0].legacyProof.uploadJobId = 0; }],
  ['legacy attempt on a dry run release', 'legacy', s => { s.mode = 'dry-run'; }],
  ['dispatch attempt carrying a legacy id', 'legacy', s => { s.attempts[0].identityKind = 'dispatch'; }],
  ['artifacts state unknown', 'running', s => { s.artifacts = { state: 'done' }; }],
  ['artifacts incomplete with extra proof', 'running', s => { s.artifacts = { state: 'pending', runId: RUN_ID }; }],
  ['artifacts complete in a dry run', 'dry-run', s => { s.artifacts = completeArtifacts(); }],
  ['artifacts complete source mismatch', 'tail-partial', s => { s.artifacts.sourceSha = '7'.repeat(40); }],
  ['artifacts complete run mismatch', 'tail-partial', s => { s.artifacts.runId = 999; }],
  ['artifacts complete without a successful attempt', 'tail-partial', s => {
    s.attempts[0] = dispatchAttempt({ runStatus: 'completed', conclusion: 'failure' });
  }],
  ['artifacts complete with an escaping manifest path', 'tail-partial', s => { s.artifacts.manifestFile = '/tmp/release-info.json'; }],
  ['artifacts complete with a relative manifest path', 'tail-partial', s => { s.artifacts.manifestFile = 'release-info.json'; }],
  ['artifacts complete with a malformed manifest digest', 'tail-partial', s => { s.artifacts.manifestSha256 = 'not-a-digest'; }],
  ['artifacts complete with a non-canonical time', 'tail-partial', s => { s.artifacts.verifiedAt = '2026-10-03T20:30:00Z'; }],
  ['artifacts complete without an active attempt', 'tail-partial', s => { s.activeAttemptId = null; }],
  ['tail phase without complete artifacts', 'running', s => { s.phase = 'tail'; }],
  ['tail target complete without artifacts', 'tail-partial', s => { s.artifacts = { state: 'pending' }; }],
  ['unknown field on a target', 'tail-partial', s => { s.sizes.verifiedAt = OBSERVED_AT; }],
  ['unknown target state', 'tail-partial', s => { s.sizes.state = 'done'; }],
  ['pending push without a commit', 'tail-partial', s => {
    s.docs['hyperclay-website'] = {
      state: 'pending-push', journalFile: evidence('docs/hyperclay-website.json'), commit: null, reason: null
    };
  }],
  ['pending push without a journal', 'tail-partial', s => {
    s.docs['hyperclay-website'] = {
      state: 'pending-push', journalFile: null, commit: SIZE_COMMIT, reason: null
    };
  }],
  ['complete target with a reason', 'tail-complete', s => {
    s.docs.hyperclay.reason = { code: 'DOCS_UNPUSHED', message: 'Docs commit was not pushed' };
  }],
  ['target commit is not an object sha', 'tail-partial', s => { s.sizes.commit = 'deadbeef'; }],
  ['target escaping journal path', 'tail-partial', s => { s.sizes.journalFile = '/tmp/sizes-journal.json'; }],
  ['target relative journal path', 'tail-partial', s => { s.sizes.journalFile = 'journal.json'; }],
  ['target journal path with a parent segment', 'tail-partial', s => { s.sizes.journalFile = path.join(RECORDS_DIR, '..', 'journal.json'); }],
  ['target journal path equal to the release directory', 'tail-partial', s => { s.sizes.journalFile = RECORDS_DIR; }],
  ['target journal path beside the release directory', 'tail-partial', s => { s.sizes.journalFile = `${RECORDS_DIR}-other/journal.json`; }],
  ['target journal path at the filesystem root', 'tail-partial', s => { s.sizes.journalFile = '/'; }],
  ['target journal path with control characters', 'tail-partial', s => { s.sizes.journalFile = evidence('journal\n.json'); }],
  ['target journal path unnormalized', 'tail-partial', s => { s.sizes.journalFile = `${RECORDS_DIR}/sizes/../journal.json`; }],
  ['target journal path with a trailing separator', 'tail-partial', s => { s.sizes.journalFile = `${RECORDS_DIR}/journal.json/`; }],
  ['target reason not a typed error', 'tail-partial', s => { s.sizes.reason = 'failed to push'; }],
  ['docs target missing', 'tail-partial', s => { delete s.docs['hyperclay-website']; }],
  ['docs unknown target', 'tail-partial', s => { s.docs['hyperclay-blog'] = pendingTarget(); }],
  ['complete release missing website docs', 'tail-complete', s => { s.docs['hyperclay-website'] = pendingTarget(); }],
  ['complete release missing sizes', 'tail-complete', s => { s.sizes = pendingTarget(); }],
  ['complete release missing the site receipt', 'tail-complete', s => { s.site = pendingSite(); }],
  ['complete site receipt different source', 'tail-complete', s => { s.site.receiptSha = '3'.repeat(40); }],
  ['complete site without a verification time', 'tail-complete', s => { s.site.verifiedAt = null; }],
  ['complete site carrying an error', 'tail-complete', s => { s.site.error = { code: 'SITE_FAILED', message: 'Deploy failed' }; }],
  ['site attempt id is not a uuid', 'tail-complete', s => { s.site.attemptId = 'site-attempt'; }],
  ['site state unknown', 'tail-partial', s => { s.site.state = 'shipped'; }],
  ['site unknown field', 'tail-partial', s => { s.site.receiptPath = 'receipt.json'; }],
  ['ambiguous site without recorded intent', 'tail-partial', s => {
    s.site = {
      state: 'unknown', sourceSha: null, treeSha: null, attemptId: null,
      receiptSha: null, verifiedAt: null, error: null
    };
  }],
  ['ambiguous site with a verification time', 'tail-partial', s => {
    s.site = {
      state: 'unknown', sourceSha: SITE_COMMIT, treeSha: SITE_TREE, attemptId: SITE_ATTEMPT_ID,
      receiptSha: null, verifiedAt: OBSERVED_AT, error: null
    };
  }],
  ['site source malformed', 'tail-partial', s => { s.site.sourceSha = 'zz'; }],
  ['dry run with a completed docs target', 'dry-run', s => { s.docs.hyperclay = completeTarget('docs/hyperclay.json'); }],
  ['dry run with a pending push target', 'dry-run', s => {
    s.sizes = { state: 'pending-push', journalFile: evidence('sizes/journal.json'), commit: SIZE_COMMIT, reason: null };
  }],
  ['dry run in the tail phase', 'dry-run', s => { s.phase = 'tail'; }],
  ['dry run complete without a successful run', 'dry-run', s => { s.attempts[0] = dryRunAttempt({ conclusion: 'failure' }); }],
  ['install failed without an error', 'tail-complete', s => { s.install = { state: 'failed', error: null }; }],
  ['install complete with an error', 'tail-complete', s => {
    s.install = { state: 'complete', error: { code: 'INSTALL_FAILED', message: 'Installer exited nonzero' } };
  }],
  ['install unknown state', 'tail-complete', s => { s.install = { state: 'skipped', error: null }; }],
  ['install unknown field', 'tail-complete', s => { s.install = { state: 'not-attempted', error: null, warning: 'x' }; }],
  ['last error with an unknown field', 'running', s => {
    s.lastError = { code: 'STATE_IO_FAILED', message: 'Could not write release state', detail: 'ENOSPC' };
  }],
  ['last error with an empty message', 'running', s => { s.lastError = { code: 'STATE_IO_FAILED', message: '' }; }],
  ['last error with an overlong message', 'running', s => { s.lastError = { code: 'STATE_IO_FAILED', message: 'x'.repeat(4097) }; }],
  ['last error is an array', 'running', s => { s.lastError = []; }],
  ['failed ci phase with a successful run', 'running', s => { s.phase = 'failed-ci'; }],
  ['failed ci phase with a requested dispatch', 'requested', s => { s.phase = 'failed-ci'; }],
  ['failed ci phase with a running run', 'running', s => {
    s.phase = 'failed-ci';
    s.attempts[0] = runningAttempt();
  }],
  ['failed ci phase without an attempt', 'failed-ci', s => { s.activeAttemptId = null; }],
  ['failed ci phase without an attempt list', 'failed-ci', s => { s.attempts = []; }],
  ['preparation with a bound source', 'prepare', s => { s.sourceSha = SOURCE_SHA; }],
  ['preparation with an active attempt', 'prepare', s => { s.activeAttemptId = ATTEMPT_ID; }],
  ['preparation with an attempt', 'prepare', s => { s.attempts = [dispatchAttempt()]; }],
  ['preparation with an attempt and no active id', 'prepare', s => { s.attempts = [dispatchAttempt()]; s.activeAttemptId = null; }],
  ['preparation without version intent', 'prepare', s => { s.versionIntent = null; }],
  ['bound source with version intent', 'running', s => { s.versionIntent = versionIntent(); }],
  ['version intent unknown field', 'prepare', s => { s.versionIntent.message = 'bump'; }],
  ['version intent missing field', 'prepare', s => { delete s.versionIntent.baseHead; }],
  ['version intent different selected version', 'prepare', s => { s.versionIntent.version = '1.30.0'; }],
  ['version intent previous version equal', 'prepare', s => { s.versionIntent.previousVersion = VERSION; }],
  ['version intent previous version newer', 'prepare', s => { s.versionIntent.previousVersion = '1.30.0'; }],
  ['version intent malformed previous version', 'prepare', s => { s.versionIntent.previousVersion = '1.28'; }],
  ['version intent base head malformed', 'prepare', s => { s.versionIntent.baseHead = 'zz'; }],
  ['version intent journal escaping', 'prepare', s => { s.versionIntent.journalFile = '/tmp/version-journal.json'; }],
  ['version intent journal relative', 'prepare', s => { s.versionIntent.journalFile = 'journal.json'; }],
  ['version intent journal with a trailing separator', 'prepare', s => { s.versionIntent.journalFile = `${RECORDS_DIR}/journal.json/`; }],
  ['version intent journal equal to the release directory', 'prepare', s => { s.versionIntent.journalFile = RECORDS_DIR; }],
  ['version intent without files', 'prepare', s => { s.versionIntent.files = []; }],
  ['version intent files not an array', 'prepare', s => { s.versionIntent.files = {}; }],
  ['version intent absolute file path', 'prepare', s => { s.versionIntent.files[0].path = '/etc/passwd'; }],
  ['version intent dot file path', 'prepare', s => { s.versionIntent.files[0].path = './package.json'; }],
  ['version intent parent file path', 'prepare', s => { s.versionIntent.files[0].path = '../package.json'; }],
  ['version intent empty file path', 'prepare', s => { s.versionIntent.files[0].path = ''; }],
  ['version intent duplicate file paths', 'prepare', s => { s.versionIntent.files[1].path = 'package.json'; }],
  ['version intent file hash malformed', 'prepare', s => { s.versionIntent.files[0].beforeSha256 = 'abc'; }],
  ['version intent file mode negative', 'prepare', s => { s.versionIntent.files[0].beforeMode = -1; }],
  ['version intent file mode above the bound', 'prepare', s => { s.versionIntent.files[0].afterMode = 0o1000; }],
  ['version intent file mode fractional', 'prepare', s => { s.versionIntent.files[0].afterMode = 420.5; }],
  ['version intent file unknown field', 'prepare', s => { s.versionIntent.files[0].renamed = true; }],
  ['version intent file missing prepared path', 'prepare', s => { delete s.versionIntent.files[0].preparedFile; }],
  ['version intent prepared path escaping', 'prepare', s => { s.versionIntent.files[0].preparedFile = '/tmp/prepared/package.json'; }]
];

const PARAMETER_CASES = [
  ['missing options', () => validateReleaseState(newState(), IDENTITY)],
  ['repo dir relative', () => validateReleaseState(newState(), IDENTITY, { repoDir: `releases/${IDENTITY.key}` })],
  ['repo dir basename not the identity key', () => validateReleaseState(newState(), IDENTITY, { repoDir: CACHE_ROOT })],
  ['repo dir unnormalized', () => validateReleaseState(newState(), IDENTITY, { repoDir: `${REPO_DIR}/` })],
  ['repo dir is the filesystem root', () => validateReleaseState(newState(), IDENTITY, { repoDir: '/' })],
  ['repo dir with control characters', () => validateReleaseState(newState(), IDENTITY, { repoDir: `${REPO_DIR}\n` })],
  ['identity object format unknown', () => validateReleaseState(newState(), { ...IDENTITY, objectFormat: 'sha512' }, { repoDir: REPO_DIR })],
  ['identity key malformed', () => validateReleaseState(newState(), { ...IDENTITY, key: 'short' }, { repoDir: REPO_DIR })],
  ['identity remote repo malformed', () => validateReleaseState(newState(), { ...IDENTITY, remoteRepo: 'gitlab.com/owner/repo' }, { repoDir: REPO_DIR })],
  ['identity branch not main', () => validateReleaseState(newState(), { ...IDENTITY, branch: 'release' }, { repoDir: REPO_DIR })],
  ['identity missing', () => validateReleaseState(newState(), null, { repoDir: REPO_DIR })]
];

function refusal(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

describe('release state schema', () => {
  test.each(VALID_RECORDS)('%s validates and is returned unchanged', (name, build) => {
    const value = build();
    const snapshot = JSON.parse(JSON.stringify(value));
    const result = validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR });
    expect(result).toBe(value);
    expect(value).toEqual(snapshot);
  });

  test('a sha256 object format repository uses 64 character object ids', () => {
    const identity = { ...IDENTITY, objectFormat: 'sha256' };
    const value = newState();
    value.repo = { ...identity };
    value.sourceSha = 'a'.repeat(64);
    value.attempts[0].sourceSha = value.sourceSha;
    value.attempts[0].expectedTitle = `release v${VERSION} publish sha=${value.sourceSha} attempt=${ATTEMPT_ID}`;
    expect(validateReleaseState(value, identity, { repoDir: path.join(CACHE_ROOT, identity.key) })).toBe(value);
  });

  test.each(INVALID_CASES)('%s is refused', (name, baseName, patch) => {
    expect(RECORD_BUILDERS[baseName]).toBeDefined();
    const value = RECORD_BUILDERS[baseName]();
    patch(value);
    const error = refusal(() => validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR }));
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('STATE_INVALID');
    expect(typeof error.message).toBe('string');
    expect(error.message.length).toBeGreaterThan(0);
  });

  test.each(PARAMETER_CASES)('%s is refused', (name, invoke) => {
    const error = refusal(invoke);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('STATE_INVALID');
  });

  test.each([[null], [[]], ['state'], [42], [true], [undefined]])('a %p record is refused', (value) => {
    const error = refusal(() => validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR }));
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('STATE_INVALID');
  });

  test('refusals stay generic and never echo supplied values', () => {
    const value = newState();
    value.repo.pushUrlSha256 = sha256('https://user:secret-token@github.com/fixture-owner/hyperclay-local.git');
    const error = refusal(() => validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR }));
    expect(error.code).toBe('STATE_INVALID');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain(value.repo.pushUrlSha256);
    expect(error.message.length).toBeLessThan(200);
  });

  test('the schema suite exercises nonzero valid and invalid case counts', () => {
    expect(VALID_RECORDS.length).toBe(10);
    expect(INVALID_CASES.length).toBeGreaterThan(100);
    expect(PARAMETER_CASES.length).toBeGreaterThan(5);
  });
});

describe('active attempt ownership', () => {
  const ATTEMPT_FREE_PHASES = ['source-ready', 'unknown'];

  test.each(ATTEMPT_FREE_PHASES)(
    '%s refuses a recorded attempt with no active id',
    (phase) => {
      const value = requestedWorkflowRecord();
      value.phase = phase;
      value.activeAttemptId = null;
      const error = refusal(() => validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR }));
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('STATE_INVALID');
    }
  );

  test.each(ATTEMPT_FREE_PHASES)(
    '%s accepts an empty attempt list with no active id',
    (phase) => {
      const value = sourceReadyRecord();
      value.phase = phase;
      expect(value.attempts).toEqual([]);
      expect(value.activeAttemptId).toBeNull();
      expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
    }
  );

  test.each(ATTEMPT_FREE_PHASES)(
    '%s accepts a recorded attempt selected by its active id',
    (phase) => {
      const value = requestedWorkflowRecord();
      value.phase = phase;
      expect(value.activeAttemptId).toBe(ATTEMPT_ID);
      expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
    }
  );
});

describe('workflow dispatch refs', () => {
  const PRIOR_SOURCE_SHA = '1'.repeat(40);
  const REPAIR_SOURCE_SHA = '2'.repeat(40);
  const REPAIR_ATTEMPT_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081';

  function dryRunMainRecord() {
    return Object.assign(newState(), {
      mode: 'dry-run',
      phase: 'complete',
      attempts: [dryRunAttempt({ dispatchRef: 'main' })]
    });
  }

  function priorAttempt(patch = {}) {
    return dispatchAttempt(Object.assign({
      sourceSha: PRIOR_SOURCE_SHA,
      expectedTitle: `release v${VERSION} publish sha=${PRIOR_SOURCE_SHA} attempt=${ATTEMPT_ID}`
    }, patch));
  }

  function repairAttempt(patch = {}) {
    return dispatchAttempt(Object.assign({
      id: REPAIR_ATTEMPT_ID,
      sourceSha: REPAIR_SOURCE_SHA,
      expectedTitle: `release v${VERSION} publish sha=${REPAIR_SOURCE_SHA} attempt=${REPAIR_ATTEMPT_ID}`,
      dispatch: 'requested',
      runId: null,
      runAttempt: null,
      runStatus: null,
      conclusion: null,
      lastObservedAt: null
    }, patch));
  }

  function repairRecord(previous, attempt) {
    return Object.assign(newState(), {
      sourceSha: REPAIR_SOURCE_SHA,
      activeAttemptId: REPAIR_ATTEMPT_ID,
      attempts: [previous, attempt]
    });
  }

  const REFUSALS = [
    ['an initial publish dispatch from main', () => Object.assign(newState(), {
      attempts: [dispatchAttempt({ dispatchRef: 'main' })]
    })],
    ['a publish repair after a running attempt', () => repairRecord(
      priorAttempt({ runStatus: 'in_progress', conclusion: null }),
      repairAttempt({ dispatchRef: 'main' })
    )],
    ['a publish repair after an unidentified attempt', () => repairRecord(
      priorAttempt({
        dispatch: 'unknown',
        runId: null,
        runAttempt: null,
        runStatus: null,
        conclusion: null,
        lastObservedAt: null
      }),
      repairAttempt({ dispatchRef: 'main' })
    )],
    ['a publish repair after a successful attempt', () => repairRecord(
      priorAttempt({ conclusion: 'success' }),
      repairAttempt({ dispatchRef: 'main' })
    )],
    ['a publish repair of the same source', () => repairRecord(
      priorAttempt({
        sourceSha: REPAIR_SOURCE_SHA,
        expectedTitle: `release v${VERSION} publish sha=${REPAIR_SOURCE_SHA} attempt=${ATTEMPT_ID}`
      }),
      repairAttempt({ dispatchRef: 'main' })
    )],
    ['a publish repair from a previous version tag', () => repairRecord(
      priorAttempt({ conclusion: 'failure' }),
      repairAttempt({ dispatchRef: `v${PREVIOUS_VERSION}` })
    )],
    ['a dry run from an arbitrary branch', () => Object.assign(newState(), {
      mode: 'dry-run',
      phase: 'complete',
      attempts: [dryRunAttempt({ dispatchRef: 'release' })]
    })],
    ['a publish repair from an arbitrary branch', () => repairRecord(
      priorAttempt({ conclusion: 'failure' }),
      repairAttempt({ dispatchRef: 'develop' })
    )],
    ['a dry run with a null dispatch ref', () => Object.assign(newState(), {
      mode: 'dry-run',
      phase: 'complete',
      attempts: [dryRunAttempt({ dispatchRef: null })]
    })],
    ['a publish repair with an empty dispatch ref', () => repairRecord(
      priorAttempt({ conclusion: 'failure' }),
      repairAttempt({ dispatchRef: '' })
    )]
  ];

  test('a new dry run dispatches from main', () => {
    const value = dryRunMainRecord();
    expect(value.attempts[0].dispatchRef).toBe('main');
    expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
  });

  test('an existing tag-ref dry run record stays readable', () => {
    const value = completedDryRunRecord();
    expect(value.attempts[0].dispatchRef).toBe(`v${VERSION}`);
    expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
  });

  test('a same-version repair requests main after a failed attempt on another source', () => {
    const value = repairRecord(priorAttempt({ conclusion: 'failure' }), repairAttempt({ dispatchRef: 'main' }));
    expect(value.attempts[0].conclusion).toBe('failure');
    expect(value.attempts[1].sourceSha).not.toBe(value.attempts[0].sourceSha);
    expect(value.attempts[1].dispatchRef).toBe('main');
    expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
  });

  test('a same-version repair observes main after a failed attempt on another source', () => {
    const value = repairRecord(
      priorAttempt({ conclusion: 'timed_out' }),
      repairAttempt({
        dispatch: 'identified',
        dispatchRef: 'main',
        runId: 457,
        runAttempt: 1,
        runStatus: 'in_progress',
        lastObservedAt: OBSERVED_AT
      })
    );
    expect(validateReleaseState(value, IDENTITY, { repoDir: REPO_DIR })).toBe(value);
  });

  test.each(REFUSALS)('%s is refused', (name, build) => {
    const error = refusal(() => validateReleaseState(build(), IDENTITY, { repoDir: REPO_DIR }));
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('STATE_INVALID');
  });
});
