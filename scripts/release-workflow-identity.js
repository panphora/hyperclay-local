'use strict';

const { stateError, validateReleaseState } = require('./release-state');
const { transitionRelease } = require('./release-transitions');

const RELEASE_WORKFLOW_PATH = '.github/workflows/release.yml';
const WORKFLOW_EVENT = 'workflow_dispatch';
const WORKFLOW_RUN_ATTEMPT = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REMOTE_REPO_PATTERN = /^github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/;
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RUN_URL_PATH = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([1-9][0-9]*)$/;
const RUN_STATES = ['queued', 'requested', 'waiting', 'pending', 'in_progress', 'completed'];
const CONCLUSIONS = [
  'success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure',
];

function attemptError(message) {
  return stateError('WORKFLOW_ATTEMPT_INVALID', message);
}

function responseInvalid(field) {
  return stateError('WORKFLOW_RESPONSE_INVALID', `Release workflow response is invalid at ${field}`);
}

function identityConflict(reason, candidateId) {
  const error = stateError('WORKFLOW_IDENTITY_CONFLICT', `Release workflow run does not carry the bound attempt identity (${reason})`);
  error.reason = reason;
  error.candidateId = candidateId;
  return error;
}

function factsConflict(reason, candidateId) {
  const error = stateError('WORKFLOW_IDENTITY_CONFLICT', `Release workflow run facts contradict the required identity (${reason})`);
  error.reason = reason;
  error.candidateId = candidateId;
  return error;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isObjectSha(value, objectFormat) {
  if (typeof value !== 'string') return false;
  const length = objectFormat === 'sha256' ? 64 : 40;
  return value.length === length && /^[a-f0-9]+$/.test(value);
}

function isFiniteTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function attemptTitle(version, mode, sourceSha, attemptId) {
  return `release v${version} ${mode} sha=${sourceSha} attempt=${attemptId}`;
}

function isCompletedNonSuccess(attempt) {
  return attempt.dispatch === 'identified' && attempt.runStatus === 'completed' &&
    attempt.conclusion !== null && attempt.conclusion !== 'success';
}

function makeWorkflowAttempt(input) {
  if (!isObject(input)) throw attemptError('A workflow attempt needs an explicit construction input');
  const { state, repoDir, workflowId, attemptId, sourceSha, dispatchRef } = input;
  if (!isObject(state)) throw attemptError('A workflow attempt needs a validated release state');
  validateReleaseState(state, state.repo, { repoDir });

  if (!isPositiveInteger(workflowId)) throw attemptError('A workflow attempt needs a positive workflow id');
  if (!isUuid(attemptId)) throw attemptError('A workflow attempt needs a version 4 uuid id');
  if (!isObjectSha(sourceSha, state.repo.objectFormat)) {
    throw attemptError('A workflow attempt needs a full source object id for this repository');
  }
  if (typeof dispatchRef !== 'string' || dispatchRef.length === 0) {
    throw attemptError('A workflow attempt needs an explicit dispatch ref');
  }

  const active = state.activeAttemptId === null
    ? null
    : state.attempts.find((candidate) => candidate.id === state.activeAttemptId) || null;
  let event;
  if (state.phase === 'source-ready') {
    if (active !== null || state.attempts.length !== 0) {
      throw attemptError('An initial attempt requires a source-ready release without attempts');
    }
    if (sourceSha !== state.sourceSha) throw attemptError('An initial attempt must dispatch the recorded source');
    const requiredRef = state.mode === 'dry-run' ? 'main' : `v${state.version}`;
    if (dispatchRef !== requiredRef) throw attemptError('An initial attempt must dispatch the ref allowed for its mode');
    event = { type: 'attempt-ready', at: state.updatedAt };
  } else if (state.phase === 'failed-ci' && active !== null &&
      ['dispatch', 'legacy-failed-run'].includes(active.identityKind) &&
      isCompletedNonSuccess(active)) {
    if (state.mode !== 'publish') throw attemptError('A repair attempt requires a publish release');
    if (sourceSha === active.sourceSha) throw attemptError('A repair attempt must dispatch a different source');
    if (dispatchRef !== 'main') throw attemptError('A repair attempt must dispatch main');
    event = { type: 'begin-repair-attempt', at: state.updatedAt, previousRunId: active.runId };
  } else {
    throw attemptError('A workflow attempt requires a source-ready release or a failed-ci repair');
  }

  const attempt = {
    id: attemptId,
    identityKind: 'dispatch',
    version: state.version,
    mode: state.mode,
    sourceSha,
    dispatchRef,
    workflowPath: RELEASE_WORKFLOW_PATH,
    workflowId,
    expectedTitle: attemptTitle(state.version, state.mode, sourceSha, attemptId),
    dispatch: 'ready',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: null,
    runAttempt: null,
    runStatus: null,
    conclusion: null,
    lastObservedAt: null,
    error: null,
  };

  transitionRelease(structuredClone(state), { ...event, attempt }, state.repo, { repoDir });
  return attempt;
}

function requireIdentityTarget(attempt, remoteRepo) {
  if (!isObject(attempt)) throw responseInvalid('attempt');
  if (!isUuid(attempt.id)) throw responseInvalid('attempt.id');
  if (typeof attempt.expectedTitle !== 'string' || attempt.expectedTitle.length === 0) {
    throw responseInvalid('attempt.expectedTitle');
  }
  if (typeof attempt.sourceSha !== 'string' || attempt.sourceSha.length === 0) {
    throw responseInvalid('attempt.sourceSha');
  }
  if (!isPositiveInteger(attempt.workflowId)) throw responseInvalid('attempt.workflowId');
  if (attempt.runId !== null && attempt.runId !== undefined && !isPositiveInteger(attempt.runId)) {
    throw responseInvalid('attempt.runId');
  }
  if (typeof remoteRepo !== 'string' || !REMOTE_REPO_PATTERN.test(remoteRepo)) {
    throw responseInvalid('remoteRepo');
  }
  const [owner, repo] = remoteRepo.slice('github.com/'.length).split('/');
  return {
    attemptId: attempt.id,
    expectedTitle: attempt.expectedTitle,
    sourceSha: attempt.sourceSha,
    workflowId: attempt.workflowId,
    boundRunId: attempt.runId === undefined ? null : attempt.runId,
    owner,
    repo,
    remoteRepo,
  };
}

function carriesAttemptToken(title, attemptId) {
  return title.split(/\s+/).some((token) => token === `attempt=${attemptId}`);
}

function canonicalRunUrl(raw, target, runId) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw responseInvalid('run.html_url');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port !== '' ||
      parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw responseInvalid('run.html_url');
  }
  const parts = RUN_URL_PATH.exec(parsed.pathname);
  if (parts === null) throw responseInvalid('run.html_url');
  if (parts[1].toLowerCase() !== target.owner || parts[2].toLowerCase() !== target.repo || parts[3] !== String(runId)) {
    return null;
  }
  return `https://${target.remoteRepo}/actions/runs/${runId}`;
}

function requireWorkflowRunFacts(input) {
  if (!isObject(input)) throw responseInvalid('facts');
  const { remoteRepo, workflowId, sourceSha, runId, runAttempt, run } = input;
  if (typeof remoteRepo !== 'string' || !REMOTE_REPO_PATTERN.test(remoteRepo)) throw responseInvalid('remoteRepo');
  if (!isPositiveInteger(workflowId)) throw responseInvalid('workflowId');
  if (typeof sourceSha !== 'string' || !OBJECT_ID_PATTERN.test(sourceSha)) throw responseInvalid('sourceSha');
  if (!isPositiveInteger(runId)) throw responseInvalid('runId');
  if (!isPositiveInteger(runAttempt)) throw responseInvalid('runAttempt');
  if (!isObject(run)) throw responseInvalid('run');
  if (!isPositiveInteger(run.id)) throw responseInvalid('run.id');
  if (typeof run.display_title !== 'string') throw responseInvalid('run.display_title');
  if (!isObject(run.repository) || typeof run.repository.full_name !== 'string') {
    throw responseInvalid('run.repository.full_name');
  }
  if (!isPositiveInteger(run.workflow_id)) throw responseInvalid('run.workflow_id');
  if (typeof run.event !== 'string') throw responseInvalid('run.event');
  if (typeof run.head_sha !== 'string' || !OBJECT_ID_PATTERN.test(run.head_sha)) {
    throw responseInvalid('run.head_sha');
  }
  if (!isPositiveInteger(run.run_attempt)) throw responseInvalid('run.run_attempt');
  if (typeof run.status !== 'string' || !RUN_STATES.includes(run.status)) throw responseInvalid('run.status');
  if (run.status === 'completed') {
    if (typeof run.conclusion !== 'string' || !CONCLUSIONS.includes(run.conclusion)) {
      throw responseInvalid('run.conclusion');
    }
  } else if (run.conclusion !== null) {
    throw responseInvalid('run.conclusion');
  }
  if (!isFiniteTimestamp(run.created_at)) throw responseInvalid('run.created_at');
  if (!isFiniteTimestamp(run.updated_at)) throw responseInvalid('run.updated_at');
  if (new Date(run.updated_at).getTime() < new Date(run.created_at).getTime()) {
    throw responseInvalid('run.updated_at');
  }
  if (typeof run.html_url !== 'string') throw responseInvalid('run.html_url');

  const [owner, repo] = remoteRepo.slice('github.com/'.length).split('/');
  if (run.repository.full_name.toLowerCase() !== `${owner}/${repo}`) throw factsConflict('repository', run.id);
  if (run.workflow_id !== workflowId) throw factsConflict('workflowId', run.id);
  if (run.event !== WORKFLOW_EVENT) throw factsConflict('event', run.id);
  if (run.head_sha !== sourceSha) throw factsConflict('source', run.id);
  if (run.run_attempt !== runAttempt) throw factsConflict('runAttempt', run.id);
  if (run.id !== runId) throw factsConflict('runId', run.id);
  const url = canonicalRunUrl(run.html_url, { owner, repo, remoteRepo }, run.id);
  if (url === null) throw factsConflict('url', run.id);

  return {
    runId: run.id,
    runAttempt,
    runStatus: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    url,
  };
}

function classifyWorkflowRun(input) {
  if (!isObject(input)) throw responseInvalid('input');
  const target = requireIdentityTarget(input.attempt, input.remoteRepo);
  const run = input.run;
  if (!isObject(run)) throw responseInvalid('run');
  if (!isPositiveInteger(run.id)) throw responseInvalid('run.id');
  if (typeof run.display_title !== 'string') throw responseInvalid('run.display_title');

  const claimsTitle = run.display_title === target.expectedTitle ||
    carriesAttemptToken(run.display_title, target.attemptId);
  const claimsBoundId = target.boundRunId !== null && run.id === target.boundRunId;
  if (!claimsTitle && !claimsBoundId) return { kind: 'irrelevant' };

  let observation;
  try {
    observation = requireWorkflowRunFacts({
      remoteRepo: target.remoteRepo,
      workflowId: target.workflowId,
      sourceSha: target.sourceSha,
      runId: target.boundRunId === null ? run.id : target.boundRunId,
      runAttempt: WORKFLOW_RUN_ATTEMPT,
      run,
    });
  } catch (error) {
    if (error.code !== 'WORKFLOW_IDENTITY_CONFLICT') throw error;
    return { kind: 'conflict', reason: error.reason, candidateId: run.id };
  }
  if (run.display_title !== target.expectedTitle) {
    return { kind: 'conflict', reason: 'title', candidateId: run.id };
  }
  return { kind: 'match', observation };
}

function requireWorkflowRun(input) {
  const result = classifyWorkflowRun(input);
  if (result.kind === 'match') return result.observation;
  if (result.kind === 'conflict') throw identityConflict(result.reason, result.candidateId);
  const candidateId = isObject(input) && isObject(input.run) && isPositiveInteger(input.run.id)
    ? input.run.id
    : null;
  throw identityConflict('irrelevant', candidateId);
}

module.exports = { makeWorkflowAttempt, classifyWorkflowRun, requireWorkflowRun, requireWorkflowRunFacts };
