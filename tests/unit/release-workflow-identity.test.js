// Identity boundary step: one release attempt is bound to one exact workflow run.
// Every fixture is pure in-memory data with deterministic ids: no Git, no clock, no
// subprocess, no network. Classification distinguishes a foreign attempt from a
// contradictory claim instead of treating every mismatch alike.
const crypto = require('crypto');
const path = require('path');

const { createReleaseState, transitionRelease } = require('../../scripts/release-transitions');
const {
  makeWorkflowAttempt,
  classifyWorkflowRun,
  requireWorkflowRun,
  requireWorkflowRunFacts
} = require('../../scripts/release-workflow-identity');

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
const WORKFLOW_PATH = '.github/workflows/release.yml';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const VERSION = '1.29.0';
const PREVIOUS_VERSION = '1.28.0';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const REPAIR_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_ATTEMPT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';
const LEGACY_ATTEMPT_ID = 'legacy:456:1';
const WORKFLOW_ID = 12345;
const SOURCE_SHA = 'a'.repeat(40);
const REPAIR_SOURCE_SHA = '9'.repeat(40);
const RUN_ID = 456;
const REPAIR_RUN_ID = 789;
const SERVER_CREATED_AT = '2026-10-03T19:05:00Z';
const SERVER_UPDATED_AT = '2026-10-03T19:20:00Z';
const OBSERVED_WALL = '2026-10-03T20:30:00.000Z';

const TIMES = {
  created: '2026-10-03T19:00:00.000Z',
  ready: '2026-10-03T19:02:00.000Z',
  requested: '2026-10-03T19:03:00.000Z',
  observed: '2026-10-03T19:06:00.000Z',
  failed: '2026-10-03T19:30:00.000Z',
  repair: '2026-10-03T19:32:00.000Z',
  repairRequested: '2026-10-03T19:33:00.000Z',
  repairObserved: '2026-10-03T19:36:00.000Z',
  complete: '2026-10-03T21:00:00.000Z'
};

const CI_ERROR = { code: 'WORKFLOW_FAILED', message: 'Release workflow concluded failure' };
const CANONICAL_URL = `https://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`;

const ATTEMPT_KEYS = [
  'id', 'identityKind', 'version', 'mode', 'sourceSha', 'dispatchRef', 'workflowPath', 'workflowId',
  'expectedTitle', 'dispatch', 'requestedAt', 'watchDeadlineAt', 'runId', 'runAttempt', 'runStatus',
  'conclusion', 'lastObservedAt', 'error'
];

const OBSERVATION_KEYS = ['runId', 'runAttempt', 'runStatus', 'conclusion', 'createdAt', 'updatedAt', 'url'];

const MATCH_OBSERVATION = {
  runId: RUN_ID,
  runAttempt: 1,
  runStatus: 'completed',
  conclusion: 'success',
  createdAt: SERVER_CREATED_AT,
  updatedAt: SERVER_UPDATED_AT,
  url: CANONICAL_URL
};

function createInput(patch = {}) {
  return Object.assign({
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    at: TIMES.created,
    sourceSha: SOURCE_SHA,
    versionIntent: null
  }, patch);
}

function sourceReadyState(mode = 'publish') {
  return createReleaseState(createInput({ mode }), IDENTITY, OPTIONS);
}

function unboundAttempt() {
  return makeWorkflowAttempt({
    state: sourceReadyState(), repoDir: REPO_DIR, workflowId: WORKFLOW_ID,
    attemptId: ATTEMPT_ID, sourceSha: SOURCE_SHA, dispatchRef: `v${VERSION}`
  });
}

function dryRunAttempt() {
  return makeWorkflowAttempt({
    state: sourceReadyState('dry-run'), repoDir: REPO_DIR, workflowId: WORKFLOW_ID,
    attemptId: ATTEMPT_ID, sourceSha: SOURCE_SHA, dispatchRef: 'main'
  });
}

function workflowState() {
  return transitionRelease(sourceReadyState(), {
    type: 'attempt-ready', at: TIMES.ready, attempt: unboundAttempt()
  }, IDENTITY, OPTIONS);
}

function requestedState() {
  return transitionRelease(workflowState(), { type: 'dispatch-requested', at: TIMES.requested }, IDENTITY, OPTIONS);
}

function observedState(patch = {}) {
  return transitionRelease(requestedState(), Object.assign({
    type: 'run-observed', at: TIMES.observed, runId: RUN_ID, runAttempt: 1,
    runStatus: 'completed', conclusion: 'success'
  }, patch), IDENTITY, OPTIONS);
}

function failedCiState() {
  return transitionRelease(observedState({ conclusion: 'failure' }), {
    type: 'ci-failed', at: TIMES.failed, error: CI_ERROR
  }, IDENTITY, OPTIONS);
}

function repairAttempt(patch = {}) {
  const state = patch.state === undefined ? failedCiState() : patch.state;
  return makeWorkflowAttempt(Object.assign({
    state, repoDir: REPO_DIR, workflowId: WORKFLOW_ID, attemptId: REPAIR_ATTEMPT_ID,
    sourceSha: REPAIR_SOURCE_SHA, dispatchRef: 'main'
  }, patch));
}

function repairRequestedState() {
  const failed = failedCiState();
  const attempt = repairAttempt({ state: failed });
  const repaired = transitionRelease(failed, {
    type: 'begin-repair-attempt', at: TIMES.repair, previousRunId: RUN_ID, attempt
  }, IDENTITY, OPTIONS);
  return transitionRelease(repaired, { type: 'dispatch-requested', at: TIMES.repairRequested }, IDENTITY, OPTIONS);
}

function legacyProofAttempt() {
  return {
    id: LEGACY_ATTEMPT_ID,
    identityKind: 'legacy-upload-proof',
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA,
    dispatchRef: null,
    workflowPath: WORKFLOW_PATH,
    workflowId: WORKFLOW_ID,
    expectedTitle: null,
    dispatch: 'identified',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: TIMES.observed,
    error: null,
    legacyProof: {
      uploadJobId: 789,
      uploadJobConclusion: 'success',
      observedHeadSha: SOURCE_SHA,
      observedMode: 'publish'
    }
  };
}

function legacyState() {
  const record = structuredClone(workflowState());
  record.attempts = [legacyProofAttempt()];
  record.activeAttemptId = LEGACY_ATTEMPT_ID;
  return record;
}

function title(patch = {}) {
  const { version = VERSION, mode = 'publish', sourceSha = SOURCE_SHA, attemptId = ATTEMPT_ID } = patch;
  return `release v${version} ${mode} sha=${sourceSha} attempt=${attemptId}`;
}

function runRow(patch = {}) {
  const row = Object.assign({
    id: RUN_ID,
    name: 'Release',
    head_branch: 'main',
    run_number: 512,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    workflow_id: WORKFLOW_ID,
    display_title: title(),
    head_sha: SOURCE_SHA,
    run_attempt: 1,
    created_at: SERVER_CREATED_AT,
    updated_at: SERVER_UPDATED_AT,
    repository: { full_name: 'fixture-owner/hyperclay-local' }
  }, patch);
  if (!Object.prototype.hasOwnProperty.call(patch, 'html_url')) {
    row.html_url = `https://github.com/fixture-owner/hyperclay-local/actions/runs/${row.id}`;
  }
  return row;
}

function classify(attempt, run, remoteRepo = IDENTITY.remoteRepo) {
  return classifyWorkflowRun({ attempt, remoteRepo, run });
}

function observationEvent(observation, at) {
  return {
    type: 'run-observed',
    at,
    runId: observation.runId,
    runAttempt: observation.runAttempt,
    runStatus: observation.runStatus,
    conclusion: observation.conclusion
  };
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
  return error;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const MATCH_CASES = [
  ['an initial publish run', unboundAttempt, () => runRow()],
  ['an initial dry-run run', dryRunAttempt, () => runRow({ display_title: title({ mode: 'dry-run' }) })],
  ['a repair run', repairAttempt, () => runRow({
    display_title: title({ sourceSha: REPAIR_SOURCE_SHA, attemptId: REPAIR_ATTEMPT_ID }),
    head_sha: REPAIR_SOURCE_SHA
  })],
  ['a bound identified run', () => observedState().attempts[0], () => runRow()],
  ['a run whose repository case is not canonical', unboundAttempt, () => runRow({
    repository: { full_name: 'Fixture-Owner/Hyperclay-Local' },
    html_url: `https://github.com/Fixture-Owner/Hyperclay-Local/actions/runs/${RUN_ID}`
  })]
];

const IRRELEVANT_CASES = [
  ['a minimal row for another version', unboundAttempt, () => ({
    id: 999, display_title: title({ version: '1.30.0', attemptId: OTHER_ATTEMPT_ID })
  })],
  ['a full row for another attempt', unboundAttempt, () => runRow({
    id: 998, display_title: title({ attemptId: OTHER_ATTEMPT_ID }), head_sha: '7'.repeat(40)
  })],
  ['a row carrying a truncated attempt token', unboundAttempt, () => runRow({
    display_title: `release v${VERSION} publish sha=${SOURCE_SHA} attempt=${ATTEMPT_ID.slice(0, 30)}`
  })],
  ['a row whose title carries no attempt token', unboundAttempt, () => runRow({ id: 997, display_title: 'Release' })],
  ['a row with malformed fields that does not claim the attempt', unboundAttempt, () => ({
    id: 996, display_title: 'Release', head_sha: 42, status: null, html_url: 'https://evil.example.com/steal'
  })],
  ['another attempt while this attempt is bound', () => observedState().attempts[0], () => runRow({
    id: 998, display_title: title({ attemptId: OTHER_ATTEMPT_ID })
  })]
];

const CONFLICT_CASES = [
  ['a run from another repository', unboundAttempt, () => runRow({
    repository: { full_name: 'other-owner/hyperclay-local' }
  }), 'repository'],
  ['a run of another workflow id', unboundAttempt, () => runRow({ workflow_id: 54321 }), 'workflowId'],
  ['a run that was not workflow dispatched', unboundAttempt, () => runRow({ event: 'push' }), 'event'],
  ['a run whose title carries another version', unboundAttempt, () => runRow({
    display_title: title({ version: '1.30.0' })
  }), 'title'],
  ['a run whose title carries another mode', unboundAttempt, () => runRow({
    display_title: title({ mode: 'dry-run' })
  }), 'title'],
  ['a run whose title carries another source for the same attempt', unboundAttempt, () => runRow({
    display_title: title({ sourceSha: REPAIR_SOURCE_SHA })
  }), 'title'],
  ['a run whose head sha is another source', unboundAttempt, () => runRow({
    head_sha: REPAIR_SOURCE_SHA
  }), 'source'],
  ['a rerun of the dispatched run', unboundAttempt, () => runRow({ run_attempt: 2 }), 'runAttempt'],
  ['a bound attempt whose run id changed', () => observedState().attempts[0], () => runRow({
    id: 457
  }), 'runId'],
  ['a bound run id carrying a rewritten title', () => observedState().attempts[0], () => runRow({
    display_title: title({ version: '1.30.0' })
  }), 'title'],
  ['a bound run id carrying another source', () => observedState().attempts[0], () => runRow({
    head_sha: REPAIR_SOURCE_SHA
  }), 'source'],
  ['a run whose url points at another run', unboundAttempt, () => runRow({
    html_url: `https://github.com/fixture-owner/hyperclay-local/actions/runs/457`
  }), 'url'],
  ['a run whose url points at another repository', unboundAttempt, () => runRow({
    html_url: `https://github.com/other-owner/hyperclay-local/actions/runs/${RUN_ID}`
  }), 'url']
];

const INVALID_CASES = [
  ['a missing attempt', () => classify(null, runRow())],
  ['an attempt that is not an object', () => classify('attempt', runRow())],
  ['an attempt id that is not a version 4 uuid', () => classify({ ...unboundAttempt(), id: 'attempt-1' }, runRow())],
  ['an uppercase attempt id', () => classify({ ...unboundAttempt(), id: ATTEMPT_ID.toUpperCase() }, runRow())],
  ['an attempt without an expected title', () => classify({ ...unboundAttempt(), expectedTitle: null }, runRow())],
  ['an attempt without a source', () => classify({ ...unboundAttempt(), sourceSha: null }, runRow())],
  ['an attempt without a workflow id', () => classify({ ...unboundAttempt(), workflowId: 0 }, runRow())],
  ['an attempt with a string bound run id', () => classify({ ...unboundAttempt(), runId: '456' }, runRow())],
  ['a remote repository that is not canonical', () => classify(
    unboundAttempt(), runRow(), 'github.com/Fixture-Owner/hyperclay-local'
  )],
  ['a remote repository outside github', () => classify(
    unboundAttempt(), runRow(), 'gitlab.com/fixture-owner/hyperclay-local'
  )],
  ['a remote repository without an owner', () => classify(
    unboundAttempt(), runRow(), 'github.com/hyperclay-local'
  )],
  ['a missing run', () => classify(unboundAttempt(), null)],
  ['a run that is not an object', () => classify(unboundAttempt(), 'run')],
  ['a run array', () => classify(unboundAttempt(), [])],
  ['a run without an id', () => classify(unboundAttempt(), runRow({ id: undefined }))],
  ['a zero run id', () => classify(unboundAttempt(), runRow({ id: 0 }))],
  ['a negative run id', () => classify(unboundAttempt(), runRow({ id: -1 }))],
  ['a fractional run id', () => classify(unboundAttempt(), runRow({ id: 1.5 }))],
  ['a string run id', () => classify(unboundAttempt(), runRow({ id: '456' }))],
  ['a run without a display title', () => classify(unboundAttempt(), runRow({ display_title: undefined }))],
  ['a numeric display title', () => classify(unboundAttempt(), runRow({ display_title: 42 }))],
  ['a minimal row without an id', () => classify(unboundAttempt(), { id: 0, display_title: 'Release' })],
  ['a minimal row with a non-string display title', () => classify(unboundAttempt(), { id: 999, display_title: null })],
  ['a claiming run without a repository', () => classify(unboundAttempt(), runRow({ repository: undefined }))],
  ['a claiming run with a string repository', () => classify(
    unboundAttempt(), runRow({ repository: 'fixture-owner/hyperclay-local' })
  )],
  ['a claiming run without a repository full name', () => classify(unboundAttempt(), runRow({ repository: {} }))],
  ['a claiming run without a workflow id', () => classify(unboundAttempt(), runRow({ workflow_id: undefined }))],
  ['a claiming run with a zero workflow id', () => classify(unboundAttempt(), runRow({ workflow_id: 0 }))],
  ['a claiming run without an event', () => classify(unboundAttempt(), runRow({ event: undefined }))],
  ['a claiming run without a head sha', () => classify(unboundAttempt(), runRow({ head_sha: undefined }))],
  ['a claiming run with a numeric head sha', () => classify(unboundAttempt(), runRow({ head_sha: 42 }))],
  ['a claiming run without a run attempt', () => classify(unboundAttempt(), runRow({ run_attempt: undefined }))],
  ['a claiming run with a zero run attempt', () => classify(unboundAttempt(), runRow({ run_attempt: 0 }))],
  ['a claiming run without a status', () => classify(unboundAttempt(), runRow({ status: undefined }))],
  ['a claiming run with a null status', () => classify(unboundAttempt(), runRow({ status: null }))],
  ['a claiming run with an unknown status', () => classify(unboundAttempt(), runRow({ status: 'running' }))],
  ['a completed claiming run without a conclusion', () => classify(unboundAttempt(), runRow({ conclusion: null }))],
  ['a completed claiming run with an unknown conclusion', () => classify(
    unboundAttempt(), runRow({ conclusion: 'passed' })
  )],
  ['an unfinished claiming run carrying a conclusion', () => classify(
    unboundAttempt(), runRow({ status: 'in_progress', conclusion: 'success' })
  )],
  ['a claiming run without a creation date', () => classify(unboundAttempt(), runRow({ created_at: undefined }))],
  ['a claiming run with an impossible creation date', () => classify(
    unboundAttempt(), runRow({ created_at: 'yesterday' })
  )],
  ['a claiming run with an empty creation date', () => classify(unboundAttempt(), runRow({ created_at: '' }))],
  ['a claiming run with a numeric creation date', () => classify(
    unboundAttempt(), runRow({ created_at: 1790000000000 })
  )],
  ['a claiming run without an update date', () => classify(unboundAttempt(), runRow({ updated_at: null }))],
  ['a claiming run updated before it was created', () => classify(
    unboundAttempt(), runRow({ updated_at: '2026-10-03T19:00:00Z' })
  )],
  ['a claiming run without a url', () => classify(unboundAttempt(), runRow({ html_url: undefined }))],
  ['a claiming run with an insecure url', () => classify(unboundAttempt(), runRow({
    html_url: `http://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`
  }))],
  ['a claiming run with a credentialed url', () => classify(unboundAttempt(), runRow({
    html_url: `https://user:secret-token@github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`
  }))],
  ['a claiming run with a query url', () => classify(unboundAttempt(), runRow({
    html_url: `https://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}?page=2`
  }))],
  ['a claiming run with a fragment url', () => classify(unboundAttempt(), runRow({
    html_url: `https://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}#jobs`
  }))],
  ['a claiming run with a foreign host url', () => classify(unboundAttempt(), runRow({
    html_url: `https://evil.example.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`
  }))],
  ['a claiming run with a port url', () => classify(unboundAttempt(), runRow({
    html_url: `https://github.com:8443/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`
  }))],
  ['a claiming run with a non-url url', () => classify(unboundAttempt(), runRow({ html_url: 'not a url' }))],
  ['a claiming run with a trailing separator url', () => classify(unboundAttempt(), runRow({
    html_url: `https://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}/`
  }))],
  ['a claiming run with a padded run id url', () => classify(unboundAttempt(), runRow({
    html_url: 'https://github.com/fixture-owner/hyperclay-local/actions/runs/0456'
  }))]
];

const ATTEMPT_REFUSALS = [
  ['a source that is not the recorded source', () => makeAttempt({ sourceSha: REPAIR_SOURCE_SHA })],
  ['a publish dispatch from main', () => makeAttempt({ dispatchRef: 'main' })],
  ['a publish dispatch from an arbitrary branch', () => makeAttempt({ dispatchRef: 'release' })],
  ['a publish dispatch from a previous version tag', () => makeAttempt({ dispatchRef: `v${PREVIOUS_VERSION}` })],
  ['a dry run from the version tag', () => makeAttempt({
    state: sourceReadyState('dry-run'), dispatchRef: `v${VERSION}`
  })],
  ['a dry run from an arbitrary branch', () => makeAttempt({
    state: sourceReadyState('dry-run'), dispatchRef: 'develop'
  })],
  ['a missing source', () => makeAttempt({ sourceSha: undefined })],
  ['an abbreviated source', () => makeAttempt({ sourceSha: 'abc123' })],
  ['an uppercase source', () => makeAttempt({ sourceSha: SOURCE_SHA.toUpperCase() })],
  ['a source with the wrong object format length', () => makeAttempt({ sourceSha: 'a'.repeat(64) })],
  ['a missing dispatch ref', () => makeAttempt({ dispatchRef: undefined })],
  ['an empty dispatch ref', () => makeAttempt({ dispatchRef: '' })],
  ['a non-string dispatch ref', () => makeAttempt({ dispatchRef: 42 })],
  ['a missing attempt id', () => makeAttempt({ attemptId: undefined })],
  ['an attempt id that is not a uuid', () => makeAttempt({ attemptId: 'attempt-1' })],
  ['an attempt id that is not version 4', () => makeAttempt({ attemptId: '3f2a1c0d-5e6b-1a7c-9d8e-1f2a3b4c5d6e' })],
  ['an uppercase attempt id', () => makeAttempt({ attemptId: ATTEMPT_ID.toUpperCase() })],
  ['a zero workflow id', () => makeAttempt({ workflowId: 0 })],
  ['a fractional workflow id', () => makeAttempt({ workflowId: 1.5 })],
  ['a string workflow id', () => makeAttempt({ workflowId: '12345' })],
  ['an unsafe workflow id', () => makeAttempt({ workflowId: Number.MAX_SAFE_INTEGER + 1 })],
  ['a missing workflow id', () => makeAttempt({ workflowId: undefined })],
  ['a release that is still preparing versions', () => makeAttempt({
    state: createReleaseState(createInput({ sourceSha: null, versionIntent: versionIntent() }), IDENTITY, OPTIONS)
  })],
  ['a release that already has an active attempt', () => makeAttempt({ state: workflowState() })],
  ['a release whose identified run already succeeded', () => makeAttempt({ state: observedState() })],
  ['a repair of the same source', () => repairAttempt({ sourceSha: SOURCE_SHA })],
  ['a repair from the version tag', () => repairAttempt({ dispatchRef: `v${VERSION}` })],
  ['a repair from an arbitrary branch', () => repairAttempt({ dispatchRef: 'develop' })],
  ['a repair without an explicit source', () => repairAttempt({ sourceSha: undefined })],
  ['a legacy upload proof attempt', () => makeAttempt({
    state: legacyState(), attemptId: REPAIR_ATTEMPT_ID, sourceSha: REPAIR_SOURCE_SHA, dispatchRef: 'main'
  })]
];

function versionIntent() {
  return {
    previousVersion: PREVIOUS_VERSION,
    version: VERSION,
    baseHead: 'b'.repeat(40),
    journalFile: path.join(REPO_DIR, 'records', RELEASE_ID, 'version-intent/journal.json'),
    files: [{
      path: 'package.json',
      beforeSha256: 'f'.repeat(64),
      afterSha256: sha256('package.json after'),
      beforeMode: 0o644,
      afterMode: 0o644,
      preparedFile: path.join(REPO_DIR, 'records', RELEASE_ID, 'version-intent/package.json')
    }]
  };
}

function makeAttempt(patch = {}) {
  const state = patch.state === undefined ? sourceReadyState() : patch.state;
  return makeWorkflowAttempt(Object.assign({
    state,
    repoDir: REPO_DIR,
    workflowId: WORKFLOW_ID,
    attemptId: ATTEMPT_ID,
    sourceSha: state.sourceSha,
    dispatchRef: state.mode === 'dry-run' ? 'main' : `v${state.version}`
  }, patch));
}

describe('workflow attempt construction', () => {
  test('an initial publish attempt carries exactly the dispatch attempt fields', () => {
    const attempt = unboundAttempt();
    expect(Object.keys(attempt)).toEqual(ATTEMPT_KEYS);
    expect(attempt).toEqual({
      id: ATTEMPT_ID,
      identityKind: 'dispatch',
      version: VERSION,
      mode: 'publish',
      sourceSha: SOURCE_SHA,
      dispatchRef: `v${VERSION}`,
      workflowPath: WORKFLOW_PATH,
      workflowId: WORKFLOW_ID,
      expectedTitle: `release v${VERSION} publish sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`,
      dispatch: 'ready',
      requestedAt: null,
      watchDeadlineAt: null,
      runId: null,
      runAttempt: null,
      runStatus: null,
      conclusion: null,
      lastObservedAt: null,
      error: null
    });
  });

  test('an initial dry run dispatches main with the dry-run title', () => {
    const attempt = dryRunAttempt();
    expect(attempt.mode).toBe('dry-run');
    expect(attempt.dispatchRef).toBe('main');
    expect(attempt.expectedTitle).toBe(`release v${VERSION} dry-run sha=${SOURCE_SHA} attempt=${ATTEMPT_ID}`);
  });

  test('a repair dispatches a different source from main with the repair title', () => {
    const attempt = repairAttempt();
    expect(attempt.id).toBe(REPAIR_ATTEMPT_ID);
    expect(attempt.sourceSha).toBe(REPAIR_SOURCE_SHA);
    expect(attempt.dispatchRef).toBe('main');
    expect(attempt.expectedTitle).toBe(
      `release v${VERSION} publish sha=${REPAIR_SOURCE_SHA} attempt=${REPAIR_ATTEMPT_ID}`
    );
  });

  test('a sha256 repository attempt requires a 64 character source', () => {
    const identity = { ...IDENTITY, objectFormat: 'sha256' };
    const sha = 'a'.repeat(64);
    const state = createReleaseState(createInput({ sourceSha: sha }), identity, OPTIONS);
    const attempt = makeWorkflowAttempt({
      state, repoDir: REPO_DIR, workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID,
      sourceSha: sha, dispatchRef: `v${VERSION}`
    });
    expect(attempt.sourceSha).toBe(sha);
    expect(attempt.expectedTitle).toBe(`release v${VERSION} publish sha=${sha} attempt=${ATTEMPT_ID}`);
    expectRefusal(() => makeWorkflowAttempt({
      state, repoDir: REPO_DIR, workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID,
      sourceSha: 'a'.repeat(40), dispatchRef: `v${VERSION}`
    }), 'WORKFLOW_ATTEMPT_INVALID');
  });

  test('construction returns fresh data and never mutates its inputs', () => {
    const state = deepFreeze(sourceReadyState());
    const input = deepFreeze({
      state, repoDir: REPO_DIR, workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID,
      sourceSha: SOURCE_SHA, dispatchRef: `v${VERSION}`
    });
    const snapshot = JSON.parse(JSON.stringify(state));
    const attempt = makeWorkflowAttempt(input);
    expect(state).toEqual(snapshot);
    expect(state.attempts).toEqual([]);
    expect(state.activeAttemptId).toBeNull();
    expect(state.phase).toBe('source-ready');
    expect(attempt).not.toBe(state);
    expect(Object.isFrozen(attempt)).toBe(false);
  });

  test('a constructed attempt is accepted by the real attempt-ready transition', () => {
    const ready = sourceReadyState();
    const attempt = unboundAttempt();
    const next = transitionRelease(ready, { type: 'attempt-ready', at: TIMES.ready, attempt }, IDENTITY, OPTIONS);
    expect(next.attempts).toEqual([attempt]);
    expect(next.activeAttemptId).toBe(ATTEMPT_ID);
    expect(next.phase).toBe('workflow');
  });

  test('a constructed repair attempt is accepted by the real repair transition', () => {
    const failed = failedCiState();
    const attempt = repairAttempt({ state: failed });
    const next = transitionRelease(failed, {
      type: 'begin-repair-attempt', at: TIMES.repair, previousRunId: RUN_ID, attempt
    }, IDENTITY, OPTIONS);
    expect(next.attempts.length).toBe(2);
    expect(next.attempts[1]).toEqual(attempt);
    expect(next.sourceSha).toBe(REPAIR_SOURCE_SHA);
    expect(next.phase).toBe('workflow');
  });

  test('construction validates the release state before building an attempt', () => {
    expectRefusal(() => makeWorkflowAttempt({
      state: sourceReadyState(), repoDir: undefined, workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID,
      sourceSha: SOURCE_SHA, dispatchRef: `v${VERSION}`
    }), 'STATE_INVALID');
    const tampered = sourceReadyState();
    tampered.sourceSha = null;
    expectRefusal(() => makeWorkflowAttempt({
      state: tampered, repoDir: REPO_DIR, workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID,
      sourceSha: SOURCE_SHA, dispatchRef: `v${VERSION}`
    }), 'STATE_INVALID');
    expectRefusal(() => makeWorkflowAttempt(null), 'WORKFLOW_ATTEMPT_INVALID');
  });

  test('a repair cannot reuse the failed attempt id', () => {
    expectRefusal(() => repairAttempt({ attemptId: ATTEMPT_ID }), 'STATE_TRANSITION_INVALID');
  });

  test.each(ATTEMPT_REFUSALS)('%s is refused', (name, invoke) => {
    expectRefusal(invoke, 'WORKFLOW_ATTEMPT_INVALID');
  });

  test('a legacy upload proof is never presented as a dispatch identity', () => {
    expectRefusal(() => classifyWorkflowRun({
      attempt: legacyProofAttempt(), remoteRepo: IDENTITY.remoteRepo, run: runRow()
    }), 'WORKFLOW_RESPONSE_INVALID');
  });
});

describe('workflow run classification', () => {
  test.each(MATCH_CASES)('%s matches exactly', (name, buildAttempt, buildRun) => {
    const result = classifyWorkflowRun({
      attempt: buildAttempt(), remoteRepo: IDENTITY.remoteRepo, run: buildRun()
    });
    expect(result.kind).toBe('match');
    expect(result.observation).toEqual(MATCH_OBSERVATION);
    expect(Object.keys(result.observation)).toEqual(OBSERVATION_KEYS);
  });

  test.each(IRRELEVANT_CASES)('%s is irrelevant', (name, buildAttempt, buildRun) => {
    const result = classifyWorkflowRun({
      attempt: buildAttempt(), remoteRepo: IDENTITY.remoteRepo, run: buildRun()
    });
    expect(result).toEqual({ kind: 'irrelevant' });
  });

  test.each(CONFLICT_CASES)('%s is a conflict', (name, buildAttempt, buildRun, reason) => {
    const run = buildRun();
    const result = classifyWorkflowRun({ attempt: buildAttempt(), remoteRepo: IDENTITY.remoteRepo, run });
    expect(result.kind).toBe('conflict');
    expect(result.reason).toBe(reason);
    expect(result.candidateId).toBe(run.id);
  });

  test.each(INVALID_CASES)('%s is an invalid response', (name, invoke) => {
    expectRefusal(invoke, 'WORKFLOW_RESPONSE_INVALID');
  });

  test('an unfinished run matches with a null conclusion', () => {
    const state = requestedState();
    const result = classifyWorkflowRun({
      attempt: state.attempts[0], remoteRepo: IDENTITY.remoteRepo,
      run: runRow({ status: 'in_progress', conclusion: null })
    });
    expect(result.kind).toBe('match');
    expect(result.observation).toEqual({
      ...MATCH_OBSERVATION, runStatus: 'in_progress', conclusion: null
    });
  });

  test('a queued run matches with a null conclusion', () => {
    const state = requestedState();
    const result = classifyWorkflowRun({
      attempt: state.attempts[0], remoteRepo: IDENTITY.remoteRepo,
      run: runRow({ status: 'queued', conclusion: null, updated_at: SERVER_CREATED_AT })
    });
    expect(result.kind).toBe('match');
    expect(result.observation.runStatus).toBe('queued');
    expect(result.observation.conclusion).toBeNull();
  });

  test('a refusal never echoes supplied values', () => {
    const error = expectRefusal(() => classify(unboundAttempt(), runRow({
      html_url: `https://user:secret-token@github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}`
    })), 'WORKFLOW_RESPONSE_INVALID');
    expect(error.message).not.toContain('secret-token');
    expect(error.message.length).toBeLessThan(200);
  });

  test('the identity suite pins its exact nonzero matching fixture count', () => {
    expect(MATCH_CASES.length).toBe(5);
    expect(IRRELEVANT_CASES.length).toBeGreaterThan(3);
    expect(CONFLICT_CASES.length).toBeGreaterThan(8);
    expect(INVALID_CASES.length).toBeGreaterThan(40);
    expect(ATTEMPT_REFUSALS.length).toBeGreaterThan(20);
  });
});

describe('strict run requirement', () => {
  test('returns the observation for an exact match', () => {
    const attempt = unboundAttempt();
    const run = runRow();
    const observation = requireWorkflowRun({ attempt, remoteRepo: IDENTITY.remoteRepo, run });
    expect(observation).toEqual(MATCH_OBSERVATION);
    expect(observation).toEqual(classify(attempt, run).observation);
  });

  test('throws a typed conflict for a contradictory claiming row', () => {
    const error = expectRefusal(() => requireWorkflowRun({
      attempt: unboundAttempt(), remoteRepo: IDENTITY.remoteRepo, run: runRow({ head_sha: REPAIR_SOURCE_SHA })
    }), 'WORKFLOW_IDENTITY_CONFLICT');
    expect(error.reason).toBe('source');
    expect(error.candidateId).toBe(RUN_ID);
  });

  test('throws a typed conflict for a rerun of the same run', () => {
    const error = expectRefusal(() => requireWorkflowRun({
      attempt: unboundAttempt(), remoteRepo: IDENTITY.remoteRepo, run: runRow({ run_attempt: 2 })
    }), 'WORKFLOW_IDENTITY_CONFLICT');
    expect(error.reason).toBe('runAttempt');
    expect(error.candidateId).toBe(RUN_ID);
  });

  test('throws a typed conflict for a row that is not this attempt', () => {
    const error = expectRefusal(() => requireWorkflowRun({
      attempt: unboundAttempt(), remoteRepo: IDENTITY.remoteRepo,
      run: runRow({ id: 998, display_title: title({ attemptId: OTHER_ATTEMPT_ID }) })
    }), 'WORKFLOW_IDENTITY_CONFLICT');
    expect(error.reason).toBe('irrelevant');
    expect(error.candidateId).toBe(998);
  });

  test('throws invalid for unknown data instead of a conflict', () => {
    expectRefusal(() => requireWorkflowRun({
      attempt: unboundAttempt(), remoteRepo: IDENTITY.remoteRepo, run: runRow({ status: 'running' })
    }), 'WORKFLOW_RESPONSE_INVALID');
  });
});

describe('run observation compatibility', () => {
  test('a matched observation drives the real run-observed transition', () => {
    const state = requestedState();
    const result = classify(state.attempts[0], runRow());
    expect(result.kind).toBe('match');
    const next = transitionRelease(state, observationEvent(result.observation, OBSERVED_WALL), IDENTITY, OPTIONS);
    expect(next.attempts[0].dispatch).toBe('identified');
    expect(next.attempts[0].runId).toBe(RUN_ID);
    expect(next.attempts[0].runAttempt).toBe(1);
    expect(next.attempts[0].runStatus).toBe('completed');
    expect(next.attempts[0].conclusion).toBe('success');
    expect(next.attempts[0].lastObservedAt).toBe(OBSERVED_WALL);
    expect(result.observation.updatedAt).toBe(SERVER_UPDATED_AT);
    expect(next.attempts[0].lastObservedAt).not.toBe(result.observation.updatedAt);
    expect(next.phase).toBe('workflow');
  });

  test('an unfinished observation binds without a conclusion', () => {
    const state = requestedState();
    const result = classify(state.attempts[0], runRow({ status: 'in_progress', conclusion: null }));
    const next = transitionRelease(state, observationEvent(result.observation, OBSERVED_WALL), IDENTITY, OPTIONS);
    expect(next.attempts[0].runStatus).toBe('in_progress');
    expect(next.attempts[0].conclusion).toBeNull();
    expect(next.attempts[0].lastObservedAt).toBe(OBSERVED_WALL);
  });

  test('the observation is not itself a transition event', () => {
    const state = requestedState();
    const result = classify(state.attempts[0], runRow());
    const error = refusal(() => transitionRelease(
      state, { type: 'run-observed', at: OBSERVED_WALL, ...result.observation }, IDENTITY, OPTIONS
    ));
    expect(error.code).toBe('STATE_TRANSITION_INVALID');
  });

  test('a repair observation binds through the real transition', () => {
    const state = repairRequestedState();
    const attempt = state.attempts[1];
    expect(attempt.id).toBe(REPAIR_ATTEMPT_ID);
    const result = classify(attempt, runRow({
      id: REPAIR_RUN_ID,
      display_title: title({ sourceSha: REPAIR_SOURCE_SHA, attemptId: REPAIR_ATTEMPT_ID }),
      head_sha: REPAIR_SOURCE_SHA
    }));
    expect(result.kind).toBe('match');
    const next = transitionRelease(state, observationEvent(result.observation, TIMES.repairObserved), IDENTITY, OPTIONS);
    expect(next.attempts[1].runId).toBe(REPAIR_RUN_ID);
    expect(next.attempts[1].runAttempt).toBe(1);
    expect(next.attempts[1].sourceSha).toBe(REPAIR_SOURCE_SHA);
    expect(next.phase).toBe('workflow');
  });

  test('a dry-run observation completes through the real transition', () => {
    const ready = sourceReadyState('dry-run');
    const attempt = dryRunAttempt();
    const dispatched = transitionRelease(transitionRelease(ready, {
      type: 'attempt-ready', at: TIMES.ready, attempt
    }, IDENTITY, OPTIONS), { type: 'dispatch-requested', at: TIMES.requested }, IDENTITY, OPTIONS);
    const result = classify(attempt, runRow({ display_title: title({ mode: 'dry-run' }) }));
    expect(result.kind).toBe('match');
    const observed = transitionRelease(dispatched, observationEvent(result.observation, OBSERVED_WALL), IDENTITY, OPTIONS);
    const complete = transitionRelease(observed, { type: 'dry-run-complete', at: TIMES.complete }, IDENTITY, OPTIONS);
    expect(complete.phase).toBe('complete');
    expect(complete.attempts[0].runId).toBe(RUN_ID);
  });
});

function factsInput(patch = {}) {
  return Object.assign({
    remoteRepo: IDENTITY.remoteRepo,
    workflowId: WORKFLOW_ID,
    sourceSha: SOURCE_SHA,
    runId: RUN_ID,
    runAttempt: 1,
    run: runRow()
  }, patch);
}

const FACTS_REFUSALS = [
  ['a missing facts input', () => requireWorkflowRunFacts(null), 'WORKFLOW_RESPONSE_INVALID'],
  ['a non-canonical remote repository', () => requireWorkflowRunFacts(
    factsInput({ remoteRepo: 'github.com/Fixture-Owner/hyperclay-local' })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a remote repository outside github', () => requireWorkflowRunFacts(
    factsInput({ remoteRepo: 'gitlab.com/fixture-owner/hyperclay-local' })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a non-positive workflow id', () => requireWorkflowRunFacts(factsInput({ workflowId: 0 })), 'WORKFLOW_RESPONSE_INVALID'],
  ['a non-positive run id', () => requireWorkflowRunFacts(factsInput({ runId: 0 })), 'WORKFLOW_RESPONSE_INVALID'],
  ['a non-positive run attempt', () => requireWorkflowRunFacts(factsInput({ runAttempt: 0 })), 'WORKFLOW_RESPONSE_INVALID'],
  ['a partial source object id', () => requireWorkflowRunFacts(
    factsInput({ sourceSha: SOURCE_SHA.slice(0, 39) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a missing run', () => requireWorkflowRunFacts(factsInput({ run: null })), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run without a positive id', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ id: 0 }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run without a display title', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ display_title: null }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run without a repository name', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ repository: {} }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run without a workflow id', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ workflow_id: undefined }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run whose head sha is not a full object id', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ head_sha: 'main' }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run with an unknown status', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ status: 'running' }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a completed run without a conclusion', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ conclusion: null }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['an unfinished run carrying a conclusion', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ status: 'in_progress', conclusion: 'success' }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run with an impossible creation date', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ created_at: 'yesterday' }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run updated before it was created', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ updated_at: '2026-10-03T18:00:00Z' }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run without a url', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ html_url: undefined }) })
  ), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run with a credentialed url', () => requireWorkflowRunFacts(factsInput({
    run: runRow({ html_url: `https://user:secret-token@github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}` })
  })), 'WORKFLOW_RESPONSE_INVALID'],
  ['a run of another repository', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ repository: { full_name: 'other-owner/hyperclay-local' } }) })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run of another workflow', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ workflow_id: 54321 }) })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run that was not workflow dispatched', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ event: 'push' }) })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run of another source', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ head_sha: REPAIR_SOURCE_SHA }) })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run of another run id', () => requireWorkflowRunFacts(
    factsInput({ run: runRow({ id: 457 }) })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run of another attempt', () => requireWorkflowRunFacts(
    factsInput({ runAttempt: 2, run: runRow() })
  ), 'WORKFLOW_IDENTITY_CONFLICT'],
  ['a run whose url points at another run', () => requireWorkflowRunFacts(factsInput({
    run: runRow({ html_url: 'https://github.com/fixture-owner/hyperclay-local/actions/runs/457' })
  })), 'WORKFLOW_IDENTITY_CONFLICT']
];

describe('shared workflow run facts', () => {
  test('accepts the generic facts of a legacy attempt beyond one', () => {
    const observation = requireWorkflowRunFacts(factsInput({ runAttempt: 2, run: runRow({ run_attempt: 2 }) }));
    expect(observation).toEqual({ ...MATCH_OBSERVATION, runAttempt: 2 });
    expect(observation.runAttempt).toBeGreaterThan(1);
    expect(Object.keys(observation)).toEqual(OBSERVATION_KEYS);
  });

  test('accepts the generic facts of an arbitrary positive attempt', () => {
    const observation = requireWorkflowRunFacts(factsInput({ runAttempt: 7, run: runRow({ run_attempt: 7 }) }));
    expect(observation.runAttempt).toBe(7);
    expect(observation.url).toBe(CANONICAL_URL);
  });

  test('agrees with the accepted matcher observation for a dispatch row', () => {
    const attempt = unboundAttempt();
    const run = runRow();
    expect(requireWorkflowRunFacts(factsInput({ run }))).toEqual(
      requireWorkflowRun({ attempt, remoteRepo: IDENTITY.remoteRepo, run })
    );
  });

  test('grants no title identity to the generic facts', () => {
    const observation = requireWorkflowRunFacts(factsInput({ run: runRow({ display_title: 'Release' }) }));
    expect(observation.runId).toBe(RUN_ID);
    expect(observation.runAttempt).toBe(1);
  });

  test('returns a fresh observation without mutating its input', () => {
    const input = deepFreeze(factsInput({ runAttempt: 2, run: runRow({ run_attempt: 2 }) }));
    const observation = requireWorkflowRunFacts(input);
    expect(observation).not.toBe(input.run);
    expect(observation).not.toBe(input);
    expect(input.run.run_attempt).toBe(2);
  });

  test('a dispatch rerun of attempt two remains a conflict', () => {
    const result = classify(unboundAttempt(), runRow({ run_attempt: 2 }));
    expect(result.kind).toBe('conflict');
    expect(result.reason).toBe('runAttempt');
    expect(result.candidateId).toBe(RUN_ID);
  });

  test.each(FACTS_REFUSALS)('%s is refused', (name, invoke, code) => {
    const error = expectRefusal(invoke, code);
    expect(error.message).not.toContain('secret-token');
    expect(error.message.length).toBeLessThan(200);
  });

  test('the shared facts refusal table is nonzero', () => {
    expect(FACTS_REFUSALS.length).toBeGreaterThan(20);
  });
});
