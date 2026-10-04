const crypto = require('crypto');
const path = require('path');

const { validateReleaseState } = require('../../scripts/release-state');
const { createReleaseState, transitionRelease } = require('../../scripts/release-transitions');

const CHECKOUT_ROOT = '/Users/fixture/checkout/hyperclay-local';
const COMMON_DIR = path.join(CHECKOUT_ROOT, '.git');
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
const OPTIONS = { repoDir: REPO_DIR };
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const VERSION = '1.29.0';
const PREVIOUS_VERSION = '1.28.0';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const REPAIR_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const SITE_ATTEMPT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';
const WORKFLOW_PATH = '.github/workflows/release.yml';
const SOURCE_SHA = 'a'.repeat(40);
const REPAIR_SOURCE_SHA = '9'.repeat(40);
const BASE_HEAD = 'b'.repeat(40);
const SIZE_COMMIT = 'c'.repeat(40);
const SITE_COMMIT = 'd'.repeat(40);
const SITE_TREE = 'e'.repeat(40);
const DOCS_COMMIT = '1'.repeat(40);
const DOCS_SITE_COMMIT = '2'.repeat(40);
const DIGEST = 'f'.repeat(64);
const RUN_ID = 456;
const REPAIR_RUN_ID = 789;
const RECORDS_DIR = path.join(REPO_DIR, 'records', RELEASE_ID);
const T0 = Date.parse('2026-10-03T19:00:00.000Z');

function at(minutes) {
  return new Date(T0 + minutes * 60000).toISOString();
}

const TIMES = {
  created: at(0),
  bound: at(1),
  ready: at(2),
  requested: at(3),
  unknown: at(4),
  running: at(5),
  completed: at(6),
  artifacts: at(7),
  sizes: at(8),
  site: at(9),
  docs: at(10),
  docsSite: at(11),
  complete: at(12),
  later: at(30),
  earlier: at(-5)
};
const WATCH_DEADLINE = at(183);
const NON_CANONICAL_AT = '2026-10-03T19:00:00Z';

const DISPATCH_ERROR = {
  code: 'DISPATCH_REQUEST_UNRESOLVED',
  message: 'Release dispatch request was not identified'
};
const CI_ERROR = { code: 'WORKFLOW_FAILED', message: 'Release workflow concluded failure' };
const INSTALL_ERROR = { code: 'INSTALL_FAILED', message: 'Installer exited nonzero' };

function evidence(name) {
  return path.join(RECORDS_DIR, name);
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function pendingSite() {
  return {
    state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
    receiptSha: null, verifiedAt: null, error: null
  };
}

function target(name, patch = {}) {
  return Object.assign({
    state: 'complete', journalFile: evidence(name), commit: SIZE_COMMIT, reason: null
  }, patch);
}

function docsTarget(name, commit, patch = {}) {
  return target(name, Object.assign({ commit }, patch));
}

function completeSite(patch = {}) {
  return Object.assign({
    state: 'complete', sourceSha: SITE_COMMIT, treeSha: SITE_TREE, attemptId: SITE_ATTEMPT_ID,
    receiptSha: SITE_COMMIT, verifiedAt: TIMES.site, error: null
  }, patch);
}

function unknownSite() {
  return {
    state: 'unknown', sourceSha: SITE_COMMIT, treeSha: SITE_TREE, attemptId: SITE_ATTEMPT_ID,
    receiptSha: null, verifiedAt: null, error: null
  };
}

function completeArtifacts(patch = {}) {
  return Object.assign({
    state: 'complete', sourceSha: SOURCE_SHA, runId: RUN_ID, manifestFile: evidence('release-info.json'),
    manifestSha256: DIGEST, verifiedAt: TIMES.completed
  }, patch);
}

function versionIntent(patch = {}) {
  return Object.assign({
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
  }, patch);
}

function createInput(patch = {}) {
  return Object.assign({
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    at: TIMES.created,
    sourceSha: null,
    versionIntent: versionIntent()
  }, patch);
}

function sourceInput(patch = {}) {
  return createInput(Object.assign({ sourceSha: SOURCE_SHA, versionIntent: null }, patch));
}

function readyAttempt({ id = ATTEMPT_ID, version = VERSION, mode = 'publish', sourceSha = SOURCE_SHA, dispatchRef } = {}, patch = {}) {
  const ref = dispatchRef === undefined ? (mode === 'dry-run' ? 'main' : `v${version}`) : dispatchRef;
  return Object.assign({
    id,
    identityKind: 'dispatch',
    version,
    mode,
    sourceSha,
    dispatchRef: ref,
    workflowPath: WORKFLOW_PATH,
    workflowId: 12345,
    expectedTitle: `release v${version} ${mode} sha=${sourceSha} attempt=${id}`,
    dispatch: 'ready',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: null,
    runAttempt: null,
    runStatus: null,
    conclusion: null,
    lastObservedAt: null,
    error: null
  }, patch);
}

function repairAttempt(patch = {}) {
  return readyAttempt({
    id: REPAIR_ATTEMPT_ID,
    sourceSha: REPAIR_SOURCE_SHA,
    dispatchRef: 'main'
  }, patch);
}

function advance(state, event) {
  return transitionRelease(state, event, IDENTITY, OPTIONS);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refusal(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function expectRefusal(invoke, code) {
  const error = refusal(invoke);
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe(code);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function preparingRecord() {
  return createReleaseState(createInput(), IDENTITY, OPTIONS);
}

function sourceReadyRecord() {
  return advance(preparingRecord(), { type: 'source-bound', at: TIMES.bound, sourceSha: SOURCE_SHA });
}

function readyRecord() {
  return advance(sourceReadyRecord(), { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt() });
}

function workflowRecord() {
  return advance(readyRecord(), { type: 'dispatch-requested', at: TIMES.requested });
}

function observedRecord(patch = {}) {
  return advance(workflowRecord(), Object.assign({
    type: 'run-observed',
    at: TIMES.completed,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success'
  }, patch));
}

function identifiedRecord() {
  return observedRecord();
}

function failedCiRecord() {
  return advance(observedRecord({ conclusion: 'failure' }), {
    type: 'ci-failed', at: TIMES.later, error: CI_ERROR
  });
}

function tailRecord() {
  return advance(identifiedRecord(), {
    type: 'artifacts-verified', at: TIMES.artifacts, artifacts: completeArtifacts()
  });
}

function completeRecord() {
  let state = advance(tailRecord(), { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: target('sizes/journal.json') });
  state = advance(state, { type: 'target-observed', at: TIMES.site, target: 'site', result: completeSite() });
  state = advance(state, { type: 'target-observed', at: TIMES.docs, target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
  state = advance(state, { type: 'target-observed', at: TIMES.docsSite, target: 'docs.hyperclay-website', result: docsTarget('docs/hyperclay-website.json', DOCS_SITE_COMMIT) });
  return advance(state, { type: 'tail-complete', at: TIMES.complete });
}

function dryRunRecord() {
  let state = createReleaseState(sourceInput({ mode: 'dry-run' }), IDENTITY, OPTIONS);
  state = advance(state, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ mode: 'dry-run', dispatchRef: 'main' }) });
  state = advance(state, { type: 'dispatch-requested', at: TIMES.requested });
  state = advance(state, { type: 'run-observed', at: TIMES.completed, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success' });
  return advance(state, { type: 'dry-run-complete', at: TIMES.later });
}

function legacyProofRecord(base = workflowRecord()) {
  const record = clone(base);
  record.attempts = [{
    id: `legacy:${RUN_ID}:1`,
    identityKind: 'legacy-upload-proof',
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA,
    dispatchRef: null,
    workflowPath: WORKFLOW_PATH,
    workflowId: 12345,
    expectedTitle: null,
    dispatch: 'identified',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: TIMES.completed,
    error: null,
    legacyProof: {
      uploadJobId: 789,
      uploadJobConclusion: 'success',
      observedHeadSha: SOURCE_SHA,
      observedMode: 'publish'
    }
  }];
  record.activeAttemptId = record.attempts[0].id;
  return record;
}

describe('release construction', () => {
  test('a version intent opens a version-preparing release at revision zero', () => {
    const record = createReleaseState(createInput(), IDENTITY, OPTIONS);
    expect(record.phase).toBe('version-preparing');
    expect(record.revision).toBe(0);
    expect(record.createdAt).toBe(TIMES.created);
    expect(record.updatedAt).toBe(TIMES.created);
    expect(record.sourceSha).toBeNull();
    expect(record.versionIntent).toEqual(versionIntent());
    expect(record.activeAttemptId).toBeNull();
    expect(record.attempts).toEqual([]);
    expect(record.artifacts).toEqual({ state: 'pending' });
    expect(record.sizes).toEqual(pendingTarget());
    expect(record.site).toEqual(pendingSite());
    expect(record.docs).toEqual({ hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() });
    expect(record.install).toEqual({ state: 'not-attempted', error: null });
    expect(record.lastError).toBeNull();
    expect(record.schema).toBe(1);
    expect(validateReleaseState(record, IDENTITY, OPTIONS)).toBe(record);
  });

  test('a bound source opens a source-ready release without dispatch permission', () => {
    const record = createReleaseState(sourceInput(), IDENTITY, OPTIONS);
    expect(record.phase).toBe('source-ready');
    expect(record.revision).toBe(0);
    expect(record.sourceSha).toBe(SOURCE_SHA);
    expect(record.versionIntent).toBeNull();
    expect(record.attempts).toEqual([]);
    expect(validateReleaseState(record, IDENTITY, OPTIONS)).toBe(record);
  });

  test('a dry-run construction keeps its own lane', () => {
    const record = createReleaseState(sourceInput({ mode: 'dry-run' }), IDENTITY, OPTIONS);
    expect(record.mode).toBe('dry-run');
    expect(record.phase).toBe('source-ready');
    expect(validateReleaseState(record, IDENTITY, OPTIONS)).toBe(record);
  });

  test('the record never aliases the supplied identity or intent', () => {
    const input = createInput();
    const record = createReleaseState(input, IDENTITY, OPTIONS);
    expect(record.repo).toEqual(IDENTITY);
    expect(record.repo).not.toBe(IDENTITY);
    expect(record.versionIntent).not.toBe(input.versionIntent);

    record.repo.root = '/Users/attacker/checkout';
    record.repo.key = sha256('elsewhere');
    record.versionIntent.files[0].path = '../package.json';
    record.versionIntent.files.length = 0;

    expect(IDENTITY.root).toBe(CHECKOUT_ROOT);
    expect(IDENTITY.key).toBe(sha256(COMMON_DIR));
    expect(input.versionIntent.files).toHaveLength(2);
    expect(input.versionIntent.files[0].path).toBe('package.json');
  });

  const CONSTRUCTION_REFUSALS = [
    ['an unknown construction key', () => createReleaseState(Object.assign(createInput(), { notes: 'x' }), IDENTITY, OPTIONS), 'STATE_TRANSITION_INVALID'],
    ['a missing construction key', () => {
      const input = createInput();
      delete input.versionIntent;
      return createReleaseState(input, IDENTITY, OPTIONS);
    }, 'STATE_TRANSITION_INVALID'],
    ['both a source and an intent', () => createReleaseState(createInput({ sourceSha: SOURCE_SHA }), IDENTITY, OPTIONS), 'STATE_TRANSITION_INVALID'],
    ['neither a source nor an intent', () => createReleaseState(createInput({ versionIntent: null }), IDENTITY, OPTIONS), 'STATE_TRANSITION_INVALID'],
    ['an invalid repository identity', () => createReleaseState(createInput(), Object.assign({}, IDENTITY, { branch: 'release' }), OPTIONS), 'STATE_INVALID'],
    ['a non-numeric version', () => createReleaseState(createInput({ version: '1.29' }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['an abbreviated source', () => createReleaseState(sourceInput({ sourceSha: 'abc' }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['a non-uuid release id', () => createReleaseState(createInput({ releaseId: 'release-1' }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['a non-canonical construction timestamp', () => createReleaseState(createInput({ at: NON_CANONICAL_AT }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['an intent for another version', () => createReleaseState(createInput({ versionIntent: versionIntent({ version: '1.30.0' }) }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['an intent that does not advance the version', () => createReleaseState(createInput({ versionIntent: versionIntent({ previousVersion: VERSION }) }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['an intent with evidence outside the release records', () => createReleaseState(createInput({ versionIntent: versionIntent({ journalFile: '/Users/fixture/elsewhere/journal.json' }) }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['an intent without files', () => createReleaseState(createInput({ versionIntent: versionIntent({ files: [] }) }), IDENTITY, OPTIONS), 'STATE_INVALID'],
    ['a missing repository directory', () => createReleaseState(createInput(), IDENTITY, {}), 'STATE_INVALID']
  ];

  test.each(CONSTRUCTION_REFUSALS)('%s is refused', (name, invoke, code) => {
    expectRefusal(invoke, code);
  });
});

describe('a full publish release', () => {
  test('walks version intent to a completed publish release', () => {
    const created = createReleaseState(createInput(), IDENTITY, OPTIONS);

    const bound = advance(created, { type: 'source-bound', at: TIMES.bound, sourceSha: SOURCE_SHA });
    expect(bound.phase).toBe('source-ready');
    expect(bound.sourceSha).toBe(SOURCE_SHA);
    expect(bound.versionIntent).toBeNull();

    const ready = advance(bound, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt() });
    expect(ready.phase).toBe('workflow');
    expect(ready.activeAttemptId).toBe(ATTEMPT_ID);
    expect(ready.attempts).toHaveLength(1);
    expect(ready.attempts[0].dispatch).toBe('ready');
    expect(ready.attempts[0].dispatchRef).toBe(`v${VERSION}`);

    const requested = advance(ready, { type: 'dispatch-requested', at: TIMES.requested });
    expect(requested.attempts[0].dispatch).toBe('requested');
    expect(requested.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(requested.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);

    const unresolved = advance(requested, { type: 'dispatch-unknown', at: TIMES.unknown, error: DISPATCH_ERROR });
    expect(unresolved.phase).toBe('unknown');
    expect(unresolved.attempts[0].dispatch).toBe('unknown');
    expect(unresolved.attempts[0].error).toEqual(DISPATCH_ERROR);
    expect(unresolved.lastError).toEqual(DISPATCH_ERROR);

    const running = advance(unresolved, {
      type: 'run-observed', at: TIMES.running, runId: RUN_ID, runAttempt: 1, runStatus: 'in_progress', conclusion: null
    });
    expect(running.phase).toBe('workflow');
    expect(running.attempts[0].dispatch).toBe('identified');
    expect(running.attempts[0].error).toEqual(DISPATCH_ERROR);
    expect(running.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(running.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);

    const succeeded = advance(running, {
      type: 'run-observed', at: TIMES.completed, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    });
    expect(succeeded.attempts[0].conclusion).toBe('success');
    expect(succeeded.attempts[0].error).toEqual(DISPATCH_ERROR);
    expect(succeeded.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(succeeded.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);

    const artifacts = advance(succeeded, {
      type: 'artifacts-verified', at: TIMES.artifacts, artifacts: completeArtifacts()
    });
    expect(artifacts.phase).toBe('tail');
    expect(artifacts.artifacts).toEqual(completeArtifacts());

    const sizes = advance(artifacts, { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: target('sizes/journal.json') });
    const site = advance(sizes, { type: 'target-observed', at: TIMES.site, target: 'site', result: completeSite() });
    const docs = advance(site, { type: 'target-observed', at: TIMES.docs, target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
    const docsSite = advance(docs, {
      type: 'target-observed', at: TIMES.docsSite, target: 'docs.hyperclay-website',
      result: docsTarget('docs/hyperclay-website.json', DOCS_SITE_COMMIT)
    });
    const complete = advance(docsSite, { type: 'tail-complete', at: TIMES.complete });

    expect(complete.phase).toBe('complete');
    expect(complete.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(complete.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);
    expect(complete.attempts[0].error).toEqual(DISPATCH_ERROR);

    const records = [created, bound, ready, requested, unresolved, running, succeeded, artifacts, sizes, site, docs, docsSite, complete];
    records.forEach((record, index) => {
      expect(record.revision).toBe(index);
      expect(record.schema).toBe(1);
      expect(record.releaseId).toBe(RELEASE_ID);
      expect(record.version).toBe(VERSION);
      expect(record.mode).toBe('publish');
      expect(record.createdAt).toBe(TIMES.created);
      expect(record.repo).toEqual(IDENTITY);
      expect(validateReleaseState(record, IDENTITY, OPTIONS)).toBe(record);
    });
    expect(records.map((record) => record.updatedAt)).toEqual([
      TIMES.created, TIMES.bound, TIMES.ready, TIMES.requested, TIMES.unknown, TIMES.running,
      TIMES.completed, TIMES.artifacts, TIMES.sizes, TIMES.site, TIMES.docs, TIMES.docsSite, TIMES.complete
    ]);
    expect(complete.lastError).toEqual(DISPATCH_ERROR);
  });

  test('every record in the trace is an independent object', () => {
    const requested = workflowRecord();
    const unresolved = advance(requested, { type: 'dispatch-unknown', at: TIMES.unknown, error: DISPATCH_ERROR });
    expect(unresolved).not.toBe(requested);
    expect(unresolved.attempts[0]).not.toBe(requested.attempts[0]);
    expect(requested.attempts[0].dispatch).toBe('requested');
    expect(requested.attempts[0].error).toBeNull();
    expect(requested.phase).toBe('workflow');
  });

  test('the requested dispatch fixes exactly the three hour watch window', () => {
    const requested = advance(readyRecord(), { type: 'dispatch-requested', at: TIMES.requested });
    const deadline = new Date(requested.attempts[0].requestedAt).getTime() + 3 * 60 * 60 * 1000;
    expect(new Date(requested.attempts[0].watchDeadlineAt).getTime()).toBe(deadline);
    expect(requested.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);
  });
});

describe('an unresolved dispatch', () => {
  test('survives a JSON reload without granting another dispatch', () => {
    const unresolved = advance(workflowRecord(), { type: 'dispatch-unknown', at: TIMES.unknown, error: DISPATCH_ERROR });
    const reloaded = JSON.parse(JSON.stringify(unresolved));
    expect(validateReleaseState(reloaded, IDENTITY, OPTIONS)).toBe(reloaded);
    expect(reloaded.phase).toBe('unknown');
    expect(reloaded.attempts[0].dispatch).toBe('unknown');

    expectRefusal(() => advance(reloaded, { type: 'attempt-ready', at: TIMES.later, attempt: readyAttempt() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(reloaded, { type: 'source-bound', at: TIMES.later, sourceSha: REPAIR_SOURCE_SHA }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(reloaded, { type: 'dispatch-requested', at: TIMES.later }), 'STATE_TRANSITION_INVALID');

    const identified = advance(reloaded, {
      type: 'run-observed', at: TIMES.completed, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    });
    expect(identified.phase).toBe('workflow');
    expectRefusal(() => advance(identified, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID + 1, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    }), 'STATE_TRANSITION_INVALID');
    expect(identified.attempts[0].error).toEqual(DISPATCH_ERROR);
  });

  test('an ambiguous dispatch never falls back to a ready attempt', () => {
    const requested = workflowRecord();
    const unresolved = advance(requested, { type: 'dispatch-unknown', at: TIMES.unknown, error: DISPATCH_ERROR });
    const repeated = advance(unresolved, { type: 'dispatch-unknown', at: TIMES.running, error: DISPATCH_ERROR });
    expect(repeated.attempts[0].dispatch).toBe('unknown');
    expect(repeated.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(repeated.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);
    expect(repeated.revision).toBe(unresolved.revision + 1);
    expectRefusal(() => advance(repeated, { type: 'dispatch-requested', at: TIMES.completed }), 'STATE_TRANSITION_INVALID');
  });

  test('refuses to observe a legacy upload proof as a dispatch', () => {
    const legacy = legacyProofRecord();
    expect(validateReleaseState(legacy, IDENTITY, OPTIONS)).toBe(legacy);
    expect(legacy.activeAttemptId).toBe(`legacy:${RUN_ID}:1`);
    expectRefusal(() => advance(legacy, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(legacy, { type: 'dispatch-requested', at: TIMES.later }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(legacy, { type: 'artifacts-verified', at: TIMES.later, artifacts: completeArtifacts() }), 'STATE_TRANSITION_INVALID');
  });

  test('a legacy proof release can still finish its independent tail', () => {
    const legacy = legacyProofRecord(tailRecord());
    expect(validateReleaseState(legacy, IDENTITY, OPTIONS)).toBe(legacy);
    expect(legacy.phase).toBe('tail');
    const sizes = advance(legacy, { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: target('sizes/journal.json') });
    const site = advance(sizes, { type: 'target-observed', at: TIMES.site, target: 'site', result: completeSite() });
    const docs = advance(site, { type: 'target-observed', at: TIMES.docs, target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
    const docsSite = advance(docs, {
      type: 'target-observed', at: TIMES.docsSite, target: 'docs.hyperclay-website',
      result: docsTarget('docs/hyperclay-website.json', DOCS_SITE_COMMIT)
    });
    expect(advance(docsSite, { type: 'tail-complete', at: TIMES.complete }).phase).toBe('complete');
  });
});

describe('a failed CI run', () => {
  test('repairs on an explicit different source and keeps the failed attempt', () => {
    const failed = failedCiRecord();
    expect(failed.phase).toBe('failed-ci');
    expect(failed.attempts[0].conclusion).toBe('failure');
    expect(failed.attempts[0].error).toEqual(CI_ERROR);
    expect(failed.lastError).toEqual(CI_ERROR);

    const repaired = advance(failed, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt()
    });
    expect(repaired.phase).toBe('workflow');
    expect(repaired.revision).toBe(failed.revision + 1);
    expect(repaired.version).toBe(VERSION);
    expect(repaired.mode).toBe('publish');
    expect(repaired.createdAt).toBe(failed.createdAt);
    expect(repaired.sourceSha).toBe(REPAIR_SOURCE_SHA);
    expect(repaired.activeAttemptId).toBe(REPAIR_ATTEMPT_ID);
    expect(repaired.attempts).toHaveLength(2);
    expect(repaired.attempts[0].id).toBe(ATTEMPT_ID);
    expect(repaired.attempts[0].runId).toBe(RUN_ID);
    expect(repaired.attempts[0].conclusion).toBe('failure');
    expect(repaired.attempts[0].error).toEqual(CI_ERROR);
    expect(repaired.attempts[1].dispatch).toBe('ready');
    expect(repaired.attempts[1].dispatchRef).toBe('main');
    expect(repaired.lastError).toBeNull();
    expect(repaired.artifacts).toEqual({ state: 'pending' });
    expect(repaired.sizes).toEqual(pendingTarget());
    expect(repaired.site).toEqual(pendingSite());
    expect(repaired.docs).toEqual({ hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() });
    expect(repaired.install).toEqual({ state: 'not-attempted', error: null });
    expect(validateReleaseState(repaired, IDENTITY, OPTIONS)).toBe(repaired);

    const requested = advance(repaired, { type: 'dispatch-requested', at: at(31) });
    expect(requested.attempts[1].dispatch).toBe('requested');
    expect(requested.attempts[1].watchDeadlineAt).toBe(at(31 + 180));

    const observed = advance(requested, {
      type: 'run-observed', at: at(32), runId: REPAIR_RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    });
    expect(observed.activeAttemptId).toBe(REPAIR_ATTEMPT_ID);
    expect(observed.attempts[1].runId).toBe(REPAIR_RUN_ID);
    expect(observed.attempts[0].runId).toBe(RUN_ID);
    expect(observed.attempts[0].error).toEqual(CI_ERROR);
    expect(advance(observed, { type: 'artifacts-verified', at: at(33), artifacts: completeArtifacts({ runId: REPAIR_RUN_ID, sourceSha: REPAIR_SOURCE_SHA }) }).phase).toBe('tail');
  });

  test('keeps the base attempt free of the repair mutation', () => {
    const failed = failedCiRecord();
    const repaired = advance(failed, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt()
    });
    repaired.attempts[0].error.message = 'mutated';
    repaired.attempts[1].expectedTitle = 'mutated';
    expect(failed.attempts).toHaveLength(1);
    expect(failed.attempts[0].error).toEqual(CI_ERROR);
    expect(failed.phase).toBe('failed-ci');
  });

  const REPAIR_REFUSALS = [
    ['a repair that names another run', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: REPAIR_RUN_ID, attempt: repairAttempt()
    }],
    ['a repair of the recorded source', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ sourceSha: SOURCE_SHA })
    }],
    ['a repair with the recorded attempt id', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ id: ATTEMPT_ID })
    }],
    ['a repair from a version tag', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ dispatchRef: `v${VERSION}` })
    }],
    ['a repair from another branch', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ dispatchRef: 'develop' })
    }],
    ['a repair without a dispatch ref', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ dispatchRef: null })
    }],
    ['a repair for another version', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ version: '1.30.0' })
    }],
    ['a dry-run repair', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ mode: 'dry-run' })
    }],
    ['a repair that already holds a request', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt({ requestedAt: TIMES.later, watchDeadlineAt: at(210) })
    }],
    ['a repair with a legacy attempt', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: Object.assign(repairAttempt(), { identityKind: 'legacy-upload-proof' })
    }],
    ['a repair while the dispatch is unidentified', () => advance(workflowRecord(), {
      type: 'dispatch-unknown', at: TIMES.unknown, error: DISPATCH_ERROR
    }), { type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt() }],
    ['a repair after a running run', () => observedRecord({ runStatus: 'in_progress', conclusion: null }), {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt()
    }],
    ['a repair after a successful run', identifiedRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt()
    }],
    ['a direct ready attempt after a failed run', failedCiRecord, {
      type: 'attempt-ready', at: TIMES.later, attempt: repairAttempt()
    }],
    ['a repair from an unrelated workflow run', failedCiRecord, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID + 1, attempt: repairAttempt()
    }]
  ];

  test.each(REPAIR_REFUSALS)('%s is refused', (name, buildState, event) => {
    expectRefusal(() => advance(buildState(), event), 'STATE_TRANSITION_INVALID');
  });

  test('refuses a failed-ci record whose active run never failed', () => {
    const running = clone(observedRecord({ runStatus: 'in_progress', conclusion: null }));
    running.phase = 'failed-ci';
    expectRefusal(() => advance(running, {
      type: 'begin-repair-attempt', at: TIMES.later, previousRunId: RUN_ID, attempt: repairAttempt()
    }), 'STATE_INVALID');
  });
});

describe('a dry run', () => {
  test('finishes from main without publication or tail proof', () => {
    const complete = dryRunRecord();
    expect(complete.phase).toBe('complete');
    expect(complete.mode).toBe('dry-run');
    expect(complete.attempts[0].dispatchRef).toBe('main');
    expect(complete.attempts[0].conclusion).toBe('success');
    expect(complete.artifacts).toEqual({ state: 'pending' });
    expect(complete.sizes).toEqual(pendingTarget());
    expect(complete.site).toEqual(pendingSite());
    expect(complete.docs).toEqual({ hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() });
    expect(complete.install).toEqual({ state: 'not-attempted', error: null });
    expect(validateReleaseState(complete, IDENTITY, OPTIONS)).toBe(complete);
  });

  test('refuses publication, tail and install proof on a dry run', () => {
    const complete = dryRunRecord();
    expectRefusal(() => advance(complete, { type: 'artifacts-verified', at: at(31), artifacts: completeArtifacts() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(complete, { type: 'target-observed', at: at(31), target: 'sizes', result: target('sizes/journal.json') }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(complete, { type: 'tail-complete', at: at(31) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(complete, { type: 'install-observed', at: at(31), install: { state: 'complete', error: null } }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(complete, { type: 'dry-run-complete', at: at(31) }), 'STATE_TRANSITION_INVALID');
  });

  test('a new dry run dispatches main and never a version tag', () => {
    const bound = createReleaseState(sourceInput({ mode: 'dry-run' }), IDENTITY, OPTIONS);
    expectRefusal(() => advance(bound, {
      type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ mode: 'dry-run', dispatchRef: `v${VERSION}` })
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(sourceReadyRecord(), {
      type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ dispatchRef: 'main' })
    }), 'STATE_TRANSITION_INVALID');
    expect(bound.attempts).toEqual([]);
  });
});

describe('the required tail', () => {
  test('an unknown site leaves the tail open while independent docs complete', () => {
    const site = advance(tailRecord(), { type: 'target-observed', at: TIMES.site, target: 'site', result: unknownSite() });
    expect(site.phase).toBe('tail');
    expect(site.site.state).toBe('unknown');

    const docs = advance(site, { type: 'target-observed', at: TIMES.docs, target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
    const docsSite = advance(docs, {
      type: 'target-observed', at: TIMES.docsSite, target: 'docs.hyperclay-website',
      result: docsTarget('docs/hyperclay-website.json', DOCS_SITE_COMMIT)
    });
    expect(docsSite.docs.hyperclay.state).toBe('complete');
    expect(docsSite.docs['hyperclay-website'].state).toBe('complete');

    const sizes = advance(docsSite, { type: 'target-observed', at: TIMES.complete, target: 'sizes', result: target('sizes/journal.json') });
    expectRefusal(() => advance(sizes, { type: 'tail-complete', at: at(20) }), 'STATE_TRANSITION_INVALID');

    const certified = advance(sizes, { type: 'target-observed', at: at(21), target: 'site', result: completeSite() });
    expect(advance(certified, { type: 'tail-complete', at: at(22) }).phase).toBe('complete');
  });

  test('a pending push keeps the release incomplete until the push lands', () => {
    let state = advance(tailRecord(), { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: target('sizes/journal.json') });
    state = advance(state, { type: 'target-observed', at: TIMES.site, target: 'site', result: completeSite() });
    state = advance(state, { type: 'target-observed', at: TIMES.docs, target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
    state = advance(state, {
      type: 'target-observed', at: TIMES.docsSite, target: 'docs.hyperclay-website',
      result: docsTarget('docs.hyperclay-website.json', DOCS_SITE_COMMIT, { state: 'pending-push' })
    });
    expect(state.docs['hyperclay-website'].state).toBe('pending-push');
    expect(state.phase).toBe('tail');
    expectRefusal(() => advance(state, { type: 'tail-complete', at: at(20) }), 'STATE_TRANSITION_INVALID');

    state = advance(state, {
      type: 'target-observed', at: at(21), target: 'docs.hyperclay-website',
      result: docsTarget('docs.hyperclay-website.json', DOCS_SITE_COMMIT)
    });
    expect(advance(state, { type: 'tail-complete', at: at(22) }).phase).toBe('complete');
  });

  test('a failed install is recorded without blocking completion', () => {
    let state = advance(tailRecord(), { type: 'install-observed', at: at(13), install: { state: 'failed', error: INSTALL_ERROR } });
    expect(state.phase).toBe('tail');
    expect(state.install).toEqual({ state: 'failed', error: INSTALL_ERROR });

    state = advance(state, { type: 'target-observed', at: at(14), target: 'sizes', result: target('sizes/journal.json') });
    state = advance(state, { type: 'target-observed', at: at(15), target: 'site', result: completeSite() });
    state = advance(state, { type: 'target-observed', at: at(16), target: 'docs.hyperclay', result: docsTarget('docs/hyperclay.json', DOCS_COMMIT) });
    state = advance(state, {
      type: 'target-observed', at: at(17), target: 'docs.hyperclay-website',
      result: docsTarget('docs.hyperclay-website.json', DOCS_SITE_COMMIT)
    });
    const complete = advance(state, { type: 'tail-complete', at: at(18) });
    expect(complete.phase).toBe('complete');
    expect(complete.install.state).toBe('failed');

    const recorded = advance(complete, { type: 'install-observed', at: at(20), install: { state: 'complete', error: null } });
    expect(recorded.phase).toBe('complete');
    expect(recorded.install).toEqual({ state: 'complete', error: null });
    expect(recorded.artifacts).toEqual(completeArtifacts());
  });

  test('a complete publish release validates after every tail step', () => {
    const complete = completeRecord();
    expect(complete.phase).toBe('complete');
    expect(complete.revision).toBe(10);
    expect(complete.sizes.state).toBe('complete');
    expect(complete.site.state).toBe('complete');
    expect(complete.docs.hyperclay.state).toBe('complete');
    expect(complete.docs['hyperclay-website'].state).toBe('complete');
    expectRefusal(() => advance(complete, { type: 'tail-complete', at: at(30) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(complete, { type: 'target-observed', at: at(30), target: 'sizes', result: target('sizes/journal.json') }), 'STATE_TRANSITION_INVALID');
  });
});

describe('pure state transitions', () => {
  test('frozen inputs are never mutated and results are detached', () => {
    const state = deepFreeze(tailRecord());
    const before = clone(state);
    const result = deepFreeze(target('sizes/journal.json'));
    const event = deepFreeze({ type: 'target-observed', at: TIMES.sizes, target: 'sizes', result });

    const next = advance(state, event);
    expect(clone(state)).toEqual(before);
    expect(next.sizes).toEqual(result);
    expect(next.sizes).not.toBe(result);

    next.sizes.commit = '3'.repeat(40);
    next.sizes.state = 'failed';
    expect(result.commit).toBe(SIZE_COMMIT);
    expect(result.state).toBe('complete');
    expect(next.attempts[0]).not.toBe(state.attempts[0]);
  });

  test('a frozen workflow state accepts a fresh attempt without mutation', () => {
    const state = deepFreeze(sourceReadyRecord());
    const before = clone(state);
    const payload = deepFreeze(readyAttempt());
    const next = advance(state, { type: 'attempt-ready', at: TIMES.ready, attempt: payload });

    expect(clone(state)).toEqual(before);
    expect(next.attempts[0]).toEqual(payload);
    expect(next.attempts[0]).not.toBe(payload);
    next.attempts[0].expectedTitle = 'mutated';
    expect(payload.expectedTitle).toBe(`release v${VERSION} publish sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`);
  });

  test('refuses unknown events, unknown keys, unknown targets and prototype paths', () => {
    const ready = sourceReadyRecord();
    const tail = tailRecord();
    const identified = identifiedRecord();

    expectRefusal(() => advance(ready, { type: 'set-phase', at: TIMES.ready, phase: 'complete' }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'set-state', at: TIMES.ready, state: {} }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'constructor', at: TIMES.ready }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: '__proto__', at: TIMES.ready }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'toString', at: TIMES.ready }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { at: TIMES.ready }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 7, at: TIMES.ready }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(identified, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success', patch: 1
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(identified, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'completed'
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'source-bound', at: TIMES.ready, sourceSha: SOURCE_SHA, phase: 'complete' }), 'STATE_TRANSITION_INVALID');

    ['docs', 'artifacts', 'lastError', 'install', '__proto__', 'constructor', '', 'docs.hyperclay.extra'].forEach((name) => {
      expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: name, result: pendingTarget() }), 'STATE_TRANSITION_INVALID');
    });
    expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: ['sizes'], result: pendingTarget() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: { toString: () => 'sizes' }, result: pendingTarget() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: 'sizes' }), 'STATE_TRANSITION_INVALID');
  });

  test('keeps schema refusals for malformed data', () => {
    const tail = tailRecord();

    expectRefusal(() => advance(tail, {
      type: 'target-observed', at: TIMES.sizes, target: 'sizes',
      result: { state: 'complete', journalFile: null, commit: null, reason: null }
    }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: 'complete' }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, { type: 'target-observed', at: TIMES.sizes, target: 'sizes', result: target('sizes/journal.json', { commit: 'abc' }) }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, {
      type: 'target-observed', at: TIMES.site, target: 'site',
      result: Object.assign(pendingSite(), { state: 'complete' })
    }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, { type: 'install-observed', at: TIMES.sizes, install: { state: 'bogus', error: null } }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, { type: 'install-observed', at: TIMES.sizes, install: { state: 'failed', error: null } }), 'STATE_INVALID');
    expectRefusal(() => advance(tail, { type: 'install-observed', at: TIMES.sizes, install: { state: 'not-attempted', error: INSTALL_ERROR } }), 'STATE_INVALID');
    expectRefusal(() => advance(identifiedRecord(), {
      type: 'artifacts-verified', at: TIMES.artifacts, artifacts: completeArtifacts({ manifestSha256: 'nope' })
    }), 'STATE_INVALID');
    expectRefusal(() => advance(identifiedRecord(), {
      type: 'artifacts-verified', at: TIMES.artifacts, artifacts: completeArtifacts({ manifestFile: '/Users/fixture/elsewhere/release-info.json' })
    }), 'STATE_INVALID');
    expectRefusal(() => advance(workflowRecord(), {
      type: 'run-observed', at: TIMES.running, runId: RUN_ID, runAttempt: 1, runStatus: 'in_progress', conclusion: 'success'
    }), 'STATE_INVALID');
    expectRefusal(() => advance(workflowRecord(), {
      type: 'run-observed', at: TIMES.running, runId: RUN_ID, runAttempt: 1, runStatus: 'merged', conclusion: null
    }), 'STATE_INVALID');
    expectRefusal(() => advance(observedRecord({ conclusion: 'failure' }), {
      type: 'ci-failed', at: TIMES.later, error: { code: 'WORKFLOW_FAILED' }
    }), 'STATE_INVALID');

    const extraKey = clone(sourceReadyRecord());
    extraKey.notes = 'left over from another writer';
    expectRefusal(() => advance(extraKey, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt() }), 'STATE_INVALID');

    const unknownPhase = clone(preparingRecord());
    unknownPhase.phase = 'set-me';
    expectRefusal(() => advance(unknownPhase, { type: 'source-bound', at: TIMES.bound, sourceSha: SOURCE_SHA }), 'STATE_INVALID');

    const mismatchedRepo = clone(sourceReadyRecord());
    mismatchedRepo.repo.root = '/Users/other/checkout';
    expectRefusal(() => advance(mismatchedRepo, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt() }), 'STATE_INVALID');
  });

  test('refuses supplied attempts that do not describe a fresh dispatch', () => {
    const ready = sourceReadyRecord();

    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: 'ready' }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({}, { dispatch: 'requested' }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ version: '1.30.0' }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ sourceSha: '8'.repeat(40) }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({ id: 'attempt-1' }) }), 'STATE_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({}, { identityKind: 'other' }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, {
      type: 'attempt-ready', at: TIMES.ready,
      attempt: readyAttempt({}, { runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success', lastObservedAt: TIMES.completed })
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.ready, attempt: readyAttempt({}, { watchDeadlineAt: TIMES.requested }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(workflowRecord(), {
      type: 'attempt-ready', at: TIMES.later, attempt: repairAttempt()
    }), 'STATE_TRANSITION_INVALID');
  });

  test('refuses backward, non-canonical and overflowing increments', () => {
    const ready = sourceReadyRecord();

    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: TIMES.earlier, attempt: readyAttempt() }), 'STATE_TRANSITION_INVALID');
    expect(advance(ready, { type: 'attempt-ready', at: ready.updatedAt, attempt: readyAttempt() }).updatedAt).toBe(ready.updatedAt);
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: Date.parse(TIMES.ready), attempt: readyAttempt() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: null, attempt: readyAttempt() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(ready, { type: 'attempt-ready', at: '2026-10-03T18:59:60.000Z', attempt: readyAttempt() }), 'STATE_TRANSITION_INVALID');

    const overflow = clone(tailRecord());
    overflow.revision = Number.MAX_SAFE_INTEGER;
    expectRefusal(() => advance(overflow, { type: 'install-observed', at: at(30), install: { state: 'complete', error: null } }), 'STATE_TRANSITION_INVALID');

    const beyond = clone(overflow);
    beyond.revision = Number.MAX_SAFE_INTEGER + 1;
    expectRefusal(() => advance(beyond, { type: 'install-observed', at: at(30), install: { state: 'complete', error: null } }), 'STATE_INVALID');

    const tail = tailRecord();
    const sameInstant = advance(tail, { type: 'install-observed', at: tail.updatedAt, install: { state: 'complete', error: null } });
    expect(sameInstant.revision).toBe(tail.revision + 1);
    expect(sameInstant.updatedAt).toBe(tail.updatedAt);
  });

  test('never rebinds an identified run or rewrites a terminal conclusion', () => {
    const running = observedRecord({ runStatus: 'in_progress', conclusion: null });
    expectRefusal(() => advance(running, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID + 1, runAttempt: 1, runStatus: 'in_progress', conclusion: null
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(running, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 2, runStatus: 'in_progress', conclusion: null
    }), 'STATE_TRANSITION_INVALID');

    const success = identifiedRecord();
    expectRefusal(() => advance(success, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'in_progress', conclusion: null
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(success, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'failure'
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(workflowRecord(), {
      type: 'run-observed', at: TIMES.completed, runId: RUN_ID, runAttempt: 2, runStatus: 'completed', conclusion: 'success'
    }), 'STATE_TRANSITION_INVALID');

    const repeated = advance(success, {
      type: 'run-observed', at: TIMES.later, runId: RUN_ID, runAttempt: 1, runStatus: 'completed', conclusion: 'success'
    });
    expect(repeated.revision).toBe(success.revision + 1);
    expect(repeated.attempts[0].lastObservedAt).toBe(TIMES.later);
    expect(repeated.attempts[0].requestedAt).toBe(TIMES.requested);
    expect(repeated.attempts[0].watchDeadlineAt).toBe(WATCH_DEADLINE);
  });

  test('refuses repeated steps instead of turning them into no-ops', () => {
    expectRefusal(() => advance(sourceReadyRecord(), { type: 'source-bound', at: TIMES.ready, sourceSha: REPAIR_SOURCE_SHA }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(workflowRecord(), { type: 'attempt-ready', at: TIMES.later, attempt: readyAttempt({ id: REPAIR_ATTEMPT_ID }) }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(workflowRecord(), { type: 'dispatch-requested', at: TIMES.later }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(tailRecord(), { type: 'artifacts-verified', at: TIMES.later, artifacts: completeArtifacts() }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(dryRunRecord(), { type: 'dry-run-complete', at: TIMES.later }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(identifiedRecord(), { type: 'ci-failed', at: TIMES.later, error: CI_ERROR }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(observedRecord({ runStatus: 'in_progress', conclusion: null }), {
      type: 'ci-failed', at: TIMES.later, error: CI_ERROR
    }), 'STATE_TRANSITION_INVALID');
    expectRefusal(() => advance(sourceReadyRecord(), { type: 'dry-run-complete', at: TIMES.later }), 'STATE_TRANSITION_INVALID');

    const tail = tailRecord();
    expectRefusal(() => advance(tail, { type: 'artifacts-verified', at: TIMES.later, artifacts: completeArtifacts({ sourceSha: '8'.repeat(40) }) }), 'STATE_TRANSITION_INVALID');
  });
});
