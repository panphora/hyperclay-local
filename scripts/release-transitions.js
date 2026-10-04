'use strict';

const { stateError, validateReleaseState } = require('./release-state');

const STATE_SCHEMA = 1;
const WATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
const DISPATCH_REF_MAIN = 'main';

const CONSTRUCTOR_KEYS = ['releaseId', 'version', 'mode', 'at', 'sourceSha', 'versionIntent'];

const EVENT_KEYS = {
  'source-bound': ['type', 'at', 'sourceSha'],
  'attempt-ready': ['type', 'at', 'attempt'],
  'dispatch-requested': ['type', 'at'],
  'dispatch-unknown': ['type', 'at', 'error'],
  'run-observed': ['type', 'at', 'runId', 'runAttempt', 'runStatus', 'conclusion'],
  'ci-failed': ['type', 'at', 'error'],
  'dry-run-complete': ['type', 'at'],
  'artifacts-verified': ['type', 'at', 'artifacts'],
  'target-observed': ['type', 'at', 'target', 'result'],
  'install-observed': ['type', 'at', 'install'],
  'tail-complete': ['type', 'at'],
  'begin-repair-attempt': ['type', 'at', 'previousRunId', 'attempt'],
};

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(message) {
  throw stateError('STATE_TRANSITION_INVALID', message);
}

function requireExactKeys(value, keys, label) {
  if (!isObject(value) || Object.keys(value).length !== keys.length) {
    refuse(`${label} must carry exactly the supported fields`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) refuse(`${label} is missing ${key}`);
  }
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function pendingSite() {
  return {
    state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
    receiptSha: null, verifiedAt: null, error: null,
  };
}

function activeAttempt(state) {
  if (state.activeAttemptId === null) return null;
  return state.attempts.find((attempt) => attempt.id === state.activeAttemptId) || null;
}

function requireActiveDispatch(state, label) {
  const attempt = activeAttempt(state);
  if (attempt === null) refuse(`${label} requires a recorded active attempt`);
  if (attempt.identityKind !== 'dispatch') refuse(`${label} cannot operate on a legacy upload proof attempt`);
  return attempt;
}

function isCompletedSuccess(attempt) {
  return attempt.dispatch === 'identified' && attempt.runStatus === 'completed' && attempt.conclusion === 'success';
}

function isCompletedNonSuccess(attempt) {
  return attempt.dispatch === 'identified' && attempt.runStatus === 'completed' &&
    attempt.conclusion !== null && attempt.conclusion !== 'success';
}

function carriesNoIdentity(attempt) {
  return attempt.requestedAt === null && attempt.watchDeadlineAt === null &&
    attempt.runId === null && attempt.runAttempt === null && attempt.runStatus === null &&
    attempt.conclusion === null && attempt.lastObservedAt === null;
}

function requireFreshAttempt(attempt, state, { dispatchRef, sourceChanged }) {
  if (!isObject(attempt)) refuse('A recorded dispatch attempt must be an object');
  if (attempt.identityKind !== 'dispatch') refuse('A recorded attempt must be a dispatch');
  if (attempt.dispatch !== 'ready') refuse('A recorded attempt must start ready');
  if (attempt.version !== state.version) refuse('Attempt version must match the release version');
  if (attempt.mode !== state.mode) refuse('Attempt mode must match the release mode');
  if (sourceChanged ? attempt.sourceSha === state.sourceSha : attempt.sourceSha !== state.sourceSha) {
    refuse(sourceChanged
      ? 'A repair attempt must record a different source'
      : 'Attempt source must match the recorded source');
  }
  if (attempt.dispatchRef !== dispatchRef) refuse('Attempt dispatch ref is not the ref allowed for this release');
  if (!carriesNoIdentity(attempt)) refuse('A new attempt must not carry request or run identity');
  if (state.attempts.some((existing) => existing.id === attempt.id)) {
    refuse('Attempt id must be unique within the release');
  }
}

function createReleaseState(input, identity, options) {
  requireExactKeys(input, CONSTRUCTOR_KEYS, 'Release construction input');
  const hasSource = input.sourceSha !== null;
  const hasIntent = input.versionIntent !== null;
  if (hasSource === hasIntent) {
    refuse('Release construction requires exactly one of sourceSha or versionIntent');
  }

  const record = {
    schema: STATE_SCHEMA,
    revision: 0,
    repo: structuredClone(identity),
    releaseId: input.releaseId,
    version: input.version,
    mode: input.mode,
    phase: hasIntent ? 'version-preparing' : 'source-ready',
    createdAt: input.at,
    updatedAt: input.at,
    versionIntent: hasIntent ? structuredClone(input.versionIntent) : null,
    sourceSha: hasSource ? input.sourceSha : null,
    activeAttemptId: null,
    attempts: [],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: pendingSite(),
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null,
  };

  return validateReleaseState(record, identity, options);
}

function transitionRelease(state, event, identity, options) {
  validateReleaseState(state, identity, options);

  if (!isObject(event) || typeof event.type !== 'string' ||
      !Object.prototype.hasOwnProperty.call(EVENT_KEYS, event.type)) {
    refuse('Release transition requires a supported event type');
  }
  requireExactKeys(event, EVENT_KEYS[event.type], 'Release transition event');
  if (!isCanonicalTimestamp(event.at)) refuse('Release transition requires a canonical event timestamp');
  if (new Date(event.at).getTime() < new Date(state.updatedAt).getTime()) {
    refuse('Release transition timestamp cannot precede the current record');
  }
  if (state.revision >= Number.MAX_SAFE_INTEGER) refuse('Release state revision cannot advance');

  const at = event.at;
  const next = structuredClone(state);
  next.revision = state.revision + 1;
  next.updatedAt = at;

  switch (event.type) {
    case 'source-bound': {
      if (next.phase !== 'version-preparing') refuse('source-bound requires a version-preparing release');
      if (next.attempts.length !== 0 || next.activeAttemptId !== null) {
        refuse('source-bound requires a release without attempts');
      }
      next.sourceSha = event.sourceSha;
      next.versionIntent = null;
      next.phase = 'source-ready';
      break;
    }

    case 'attempt-ready': {
      if (next.phase !== 'source-ready') refuse('attempt-ready requires a source-ready release');
      if (next.attempts.length !== 0 || next.activeAttemptId !== null) {
        refuse('attempt-ready requires a release without attempts');
      }
      requireFreshAttempt(event.attempt, next, {
        dispatchRef: next.mode === 'dry-run' ? DISPATCH_REF_MAIN : `v${next.version}`,
        sourceChanged: false,
      });
      next.attempts = [structuredClone(event.attempt)];
      next.activeAttemptId = event.attempt.id;
      next.phase = 'workflow';
      break;
    }

    case 'dispatch-requested': {
      if (next.phase !== 'workflow') refuse('dispatch-requested requires a workflow release phase');
      const attempt = requireActiveDispatch(next, 'dispatch-requested');
      if (attempt.dispatch !== 'ready') refuse('dispatch-requested requires a ready attempt');
      if (!carriesNoIdentity(attempt)) {
        refuse('dispatch-requested requires an attempt without request or run identity');
      }
      attempt.dispatch = 'requested';
      attempt.requestedAt = at;
      attempt.watchDeadlineAt = new Date(new Date(at).getTime() + WATCH_WINDOW_MS).toISOString();
      break;
    }

    case 'dispatch-unknown': {
      if (next.phase !== 'workflow' && next.phase !== 'unknown') {
        refuse('dispatch-unknown requires a workflow or unknown release phase');
      }
      const attempt = requireActiveDispatch(next, 'dispatch-unknown');
      if (attempt.dispatch !== 'requested' && attempt.dispatch !== 'unknown') {
        refuse('dispatch-unknown requires an unresolved dispatch request');
      }
      if (attempt.runId !== null || attempt.runAttempt !== null || attempt.runStatus !== null ||
          attempt.conclusion !== null || attempt.lastObservedAt !== null) {
        refuse('dispatch-unknown requires an attempt without a run identity');
      }
      attempt.dispatch = 'unknown';
      attempt.error = structuredClone(event.error);
      next.phase = 'unknown';
      next.lastError = structuredClone(event.error);
      break;
    }

    case 'run-observed': {
      if (next.phase !== 'workflow' && next.phase !== 'unknown') {
        refuse('run-observed requires a workflow or unknown release phase');
      }
      const attempt = requireActiveDispatch(next, 'run-observed');
      if (attempt.dispatch !== 'requested' && attempt.dispatch !== 'unknown' && attempt.dispatch !== 'identified') {
        refuse('run-observed requires an issued dispatch request');
      }
      if (event.runAttempt !== 1) refuse('run-observed requires the first attempt of a dispatched run');
      if (attempt.dispatch === 'identified') {
        if (event.runId !== attempt.runId || event.runAttempt !== attempt.runAttempt) {
          refuse('run-observed cannot replace the identified run');
        }
        if (attempt.runStatus === 'completed') {
          if (event.runStatus !== 'completed') refuse('run-observed cannot regress a completed run');
          if (event.conclusion !== attempt.conclusion) {
            refuse('run-observed cannot change a completed conclusion');
          }
        }
      }
      attempt.dispatch = 'identified';
      attempt.runId = event.runId;
      attempt.runAttempt = event.runAttempt;
      attempt.runStatus = event.runStatus;
      attempt.conclusion = event.conclusion;
      attempt.lastObservedAt = at;
      next.phase = 'workflow';
      break;
    }

    case 'ci-failed': {
      if (next.phase !== 'workflow' && next.phase !== 'unknown') {
        refuse('ci-failed requires a workflow or unknown release phase');
      }
      const attempt = requireActiveDispatch(next, 'ci-failed');
      if (!isCompletedNonSuccess(attempt)) {
        refuse('ci-failed requires an identified completed nonsuccess run');
      }
      attempt.error = structuredClone(event.error);
      next.phase = 'failed-ci';
      next.lastError = structuredClone(event.error);
      break;
    }

    case 'dry-run-complete': {
      if (next.mode !== 'dry-run') refuse('dry-run-complete requires a dry-run release');
      if (next.phase !== 'workflow') refuse('dry-run-complete requires a workflow release phase');
      const attempt = requireActiveDispatch(next, 'dry-run-complete');
      if (!isCompletedSuccess(attempt)) refuse('dry-run-complete requires a successful identified run');
      next.phase = 'complete';
      break;
    }

    case 'artifacts-verified': {
      if (next.mode !== 'publish') refuse('artifacts-verified requires a publish release');
      if (next.phase !== 'workflow') refuse('artifacts-verified requires a workflow release phase');
      const attempt = requireActiveDispatch(next, 'artifacts-verified');
      if (!isCompletedSuccess(attempt)) refuse('artifacts-verified requires a successful identified run');
      if (!isObject(event.artifacts)) refuse('artifacts-verified requires an artifacts record');
      if (event.artifacts.state !== 'complete') refuse('artifacts-verified requires complete artifacts');
      if (event.artifacts.sourceSha !== next.sourceSha) {
        refuse('Verified artifacts must be bound to the recorded source');
      }
      if (event.artifacts.runId !== attempt.runId) {
        refuse('Verified artifacts must be bound to the identified run');
      }
      next.artifacts = structuredClone(event.artifacts);
      next.phase = 'tail';
      break;
    }

    case 'target-observed': {
      if (next.mode !== 'publish') refuse('target-observed requires a publish release');
      if (next.phase !== 'tail') refuse('target-observed requires a tail release phase');
      if (next.artifacts.state !== 'complete') refuse('target-observed requires verified publish artifacts');
      switch (event.target) {
        case 'sizes': next.sizes = structuredClone(event.result); break;
        case 'site': next.site = structuredClone(event.result); break;
        case 'docs.hyperclay': next.docs.hyperclay = structuredClone(event.result); break;
        case 'docs.hyperclay-website': next.docs['hyperclay-website'] = structuredClone(event.result); break;
        default: refuse('target-observed requires one of the four required release targets');
      }
      break;
    }

    case 'install-observed': {
      if (next.mode !== 'publish') refuse('install-observed requires a publish release');
      if (next.phase !== 'tail' && next.phase !== 'complete') {
        refuse('install-observed requires a tail or complete release phase');
      }
      next.install = structuredClone(event.install);
      break;
    }

    case 'tail-complete': {
      if (next.mode !== 'publish') refuse('tail-complete requires a publish release');
      if (next.phase !== 'tail') refuse('tail-complete requires a tail release phase');
      if (next.artifacts.state !== 'complete') refuse('tail-complete requires verified publish artifacts');
      const targets = [next.sizes, next.site, next.docs.hyperclay, next.docs['hyperclay-website']];
      if (!targets.every((target) => isObject(target) && target.state === 'complete')) {
        refuse('tail-complete requires every required tail target to be complete');
      }
      next.phase = 'complete';
      break;
    }

    case 'begin-repair-attempt': {
      if (next.mode !== 'publish') refuse('begin-repair-attempt requires a publish release');
      if (next.phase !== 'failed-ci') refuse('begin-repair-attempt requires a failed-ci release phase');
      const previous = requireActiveDispatch(next, 'begin-repair-attempt');
      if (!isCompletedNonSuccess(previous)) {
        refuse('begin-repair-attempt requires an identified completed nonsuccess run');
      }
      if (event.previousRunId !== previous.runId) {
        refuse('begin-repair-attempt must name the recorded failing run');
      }
      requireFreshAttempt(event.attempt, next, {
        dispatchRef: DISPATCH_REF_MAIN,
        sourceChanged: true,
      });
      next.attempts = next.attempts.concat([structuredClone(event.attempt)]);
      next.activeAttemptId = event.attempt.id;
      next.sourceSha = event.attempt.sourceSha;
      next.phase = 'workflow';
      next.artifacts = { state: 'pending' };
      next.sizes = pendingTarget();
      next.site = pendingSite();
      next.docs = { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() };
      next.install = { state: 'not-attempted', error: null };
      next.lastError = null;
      break;
    }

    default:
      refuse('Release transition requires a supported event type');
  }

  return validateReleaseState(next, identity, options);
}

module.exports = { createReleaseState, transitionRelease };
