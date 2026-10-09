'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');
const { readGithubJson, parseGithubResponse } = require('./release-read-policy');
const { createLocalGitReader } = require('./release-local-read');
const { readPublishedSourceVersion } = require('./release-publication');
const { classifyWorkflowRun, requireWorkflowRun } = require('./release-workflow-identity');
const { validateReleaseState, resolveRepoIdentity, statePaths } = require('./release-state');
const { transitionRelease } = require('./release-transitions');
const { readReleaseState, writeReleaseState } = require('./release-state-store');
const { writeOutput } = require('./release-command');

const READ_MS = 90000;
const REQUEST_MS = 30000;
const UNTITLED_WAIT_MS = 2000;
const MAX_BYTES = 8 * 1024 * 1024;
const WORKFLOW_PATH = '.github/workflows/release.yml';
const REPO_FIELDS = [
  'key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'
];
const DEP_KEYS = [
  'run', 'localRun', 'fs', 'now', 'wallNow', 'sleep', 'signal', 'logReadFailure', 'assertPublishWindow'
];
const DIAGNOSTICS = {
  WORKFLOW_DISPATCH_UNKNOWN: 'Workflow dispatch has no verified run identity',
  WORKFLOW_DISPATCH_REJECTED: 'GitHub definitively rejected the workflow dispatch',
  WORKFLOW_DISCOVERY_INCOMPLETE: 'Workflow discovery did not produce a complete bounded result',
  WORKFLOW_DISCOVERY_AMBIGUOUS: 'More than one workflow run claims the recorded attempt',
  WORKFLOW_NOT_VISIBLE: 'The recorded workflow attempt was not visible within the discovery bound',
  WORKFLOW_READ_UNAVAILABLE: 'The recorded workflow outcome could not be read',
  WORKFLOW_RESPONSE_INVALID: 'GitHub returned an invalid workflow response',
  WORKFLOW_IDENTITY_CONFLICT: 'Workflow evidence conflicts with the recorded attempt',
  WORKFLOW_DEADLINE: 'The original workflow observation deadline has expired',
  WORKFLOW_ABORTED: 'Workflow observation was aborted by the operator'
};

function workflowError(code, message, fields) {
  return Object.assign(new Error(message), { code }, fields);
}

function invalid(message) {
  return workflowError('WORKFLOW_INPUT_INVALID', message);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownDataKeys(value, allowed, exact, label) {
  if (!record(value)) throw invalid(`${label} must be an object`);
  const keys = Reflect.ownKeys(value);
  if (exact && keys.length !== allowed.length) throw invalid(`${label} has invalid fields`);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)
      || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw invalid(`${label} has invalid fields`);
    }
  }
  if (exact && allowed.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw invalid(`${label} has missing fields`);
  }
}

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function aborted(signal) {
  return Boolean(signal && signal.aborted);
}

function abortError(signal) {
  return workflowError('WORKFLOW_ABORTED', DIAGNOSTICS.WORKFLOW_ABORTED, {
    kind: 'operator-abort', cause: signal && signal.reason
  });
}

function checkAbort(signal) {
  if (aborted(signal)) throw abortError(signal);
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (aborted(signal)) {
      reject(abortError(signal));
      return;
    }
    let settled = false;
    let timer;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError(signal));
    timer = setTimeout(() => finish(null), delayMs);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (aborted(signal)) onAbort();
    }
  });
}

function resolveDeps(value, allowDispatch) {
  const supplied = value === undefined ? {} : value;
  ownDataKeys(supplied, DEP_KEYS, false, 'Workflow dependencies');
  const local = createLocalGitReader();
  const deps = {
    run: supplied.run === undefined ? spawnSync : supplied.run,
    localRun: supplied.localRun === undefined ? local.run : supplied.localRun,
    fs: supplied.fs === undefined ? fs : supplied.fs,
    now: supplied.now === undefined ? () => performance.now() : supplied.now,
    wallNow: supplied.wallNow === undefined ? () => Date.now() : supplied.wallNow,
    sleep: supplied.sleep === undefined ? defaultSleep : supplied.sleep,
    signal: supplied.signal,
    logReadFailure: supplied.logReadFailure,
    assertPublishWindow: supplied.assertPublishWindow
  };
  for (const name of ['run', 'localRun', 'now', 'wallNow', 'sleep']) {
    if (typeof deps[name] !== 'function') throw invalid(`Workflow ${name} must be callable`);
  }
  for (const name of ['logReadFailure', 'assertPublishWindow']) {
    if (deps[name] !== undefined && typeof deps[name] !== 'function') {
      throw invalid(`Workflow ${name} must be callable`);
    }
  }
  if (!record(deps.fs)) throw invalid('Workflow filesystem must be an object');
  if (deps.signal !== undefined && (!record(deps.signal)
    || typeof deps.signal.aborted !== 'boolean'
    || typeof deps.signal.addEventListener !== 'function'
    || typeof deps.signal.removeEventListener !== 'function')) {
    throw invalid('Workflow signal must be an AbortSignal');
  }
  if (allowDispatch && typeof deps.assertPublishWindow !== 'function') {
    throw invalid('Workflow dispatch needs a callable assertPublishWindow time policy');
  }
  return deps;
}

function clockError(cause) {
  return workflowError('WORKFLOW_CLOCK_INVALID', 'Workflow clock is invalid', { cause });
}

function finiteClock(clock) {
  let value;
  try { value = clock(); } catch (cause) { throw clockError(cause); }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw clockError();
  return value;
}

function fatalError(error, depth = 0) {
  if (!record(error) || depth > 8) return null;
  if (['WORKFLOW_CLOCK_INVALID', 'WORKFLOW_STATE_WRITE_FAILED'].includes(error.code)) return error;
  const cause = fatalError(error.cause, depth + 1);
  if (cause) return cause;
  if (Array.isArray(error.attemptErrors)) {
    for (const attemptError of error.attemptErrors) {
      const found = fatalError(attemptError, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function compactDiagnostic(error) {
  let code;
  if (error && Object.prototype.hasOwnProperty.call(DIAGNOSTICS, error.code)) code = error.code;
  else if (error && error.kind === 'operator-abort') code = 'WORKFLOW_ABORTED';
  else if (error && error.kind === 'deadline') code = 'WORKFLOW_DEADLINE';
  else if (error && ['invalid-json', 'invalid-response', 'schema'].includes(error.kind)) {
    code = 'WORKFLOW_RESPONSE_INVALID';
  } else code = 'WORKFLOW_READ_UNAVAILABLE';
  return { code, message: DIAGNOSTICS[code] };
}

function requireObservedRun(attempt, remoteRepo, run, expectedRunId) {
  if (!Number.isSafeInteger(expectedRunId) || expectedRunId <= 0) {
    throw workflowError('WORKFLOW_RESPONSE_INVALID', DIAGNOSTICS.WORKFLOW_RESPONSE_INVALID);
  }
  if (attempt.runId !== null && attempt.runId !== expectedRunId) {
    throw workflowError('WORKFLOW_IDENTITY_CONFLICT', DIAGNOSTICS.WORKFLOW_IDENTITY_CONFLICT);
  }
  const observation = requireWorkflowRun({
    attempt: { ...attempt, runId: expectedRunId }, remoteRepo, run
  });
  if (attempt.runStatus === 'completed'
    && (observation.runStatus !== 'completed' || observation.conclusion !== attempt.conclusion)) {
    throw workflowError('WORKFLOW_IDENTITY_CONFLICT', DIAGNOSTICS.WORKFLOW_IDENTITY_CONFLICT);
  }
  return observation;
}

function dispatchHint(body, repo) {
  let value;
  try { value = JSON.parse(body); } catch { return null; }
  if (!record(value) || !Number.isSafeInteger(value.workflow_run_id) || value.workflow_run_id <= 0) return null;
  const id = value.workflow_run_id;
  if (value.run_url !== `https://api.github.com/repos/${repo}/actions/runs/${id}`
    || value.html_url !== `https://github.com/${repo}/actions/runs/${id}`) return null;
  return id;
}

function postOnce(deps, repo, attempt, timeout) {
  const args = [
    'api', '--hostname', 'github.com', '--method', 'POST', '--include',
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2026-03-10',
    `repos/${repo}/actions/workflows/${attempt.workflowId}/dispatches`, '--input', '-'
  ];
  const input = JSON.stringify({
    ref: attempt.dispatchRef,
    inputs: {
      version: attempt.version,
      dry_run: attempt.mode === 'dry-run',
      source_sha: attempt.sourceSha,
      attempt_id: attempt.id
    }
  });
  let result;
  let thrown = null;
  try {
    result = deps.run('gh', args, {
      shell: false, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout, maxBuffer: MAX_BYTES, killSignal: 'SIGKILL',
      env: { ...process.env, GH_FORCE_TTY: '0', NO_COLOR: '1' }
    });
  } catch (error) {
    thrown = error;
  }
  const raw = thrown || result;
  const stdout = text(raw && raw.stdout);
  const stderr = text(raw && raw.stderr);
  let envelope = null;
  let parseError = null;
  try { envelope = parseGithubResponse(stdout); } catch (error) { parseError = error; }
  const clean = thrown === null && record(result) && !result.error && !result.signal
    && Number.isInteger(result.status) && result.status >= 0
    && Buffer.byteLength(stdout) <= MAX_BYTES && Buffer.byteLength(stderr) <= MAX_BYTES;
  const fields = {
    cause: thrown || (result && result.error) || parseError,
    result, stdout, stderr, envelope, parseError
  };
  if (clean && envelope && [400, 401, 403, 404, 422].includes(envelope.httpStatus)) {
    writeOutput(1, stdout);
    writeOutput(2, stderr);
    return {
      kind: 'rejected',
      error: workflowError('WORKFLOW_DISPATCH_REJECTED', DIAGNOSTICS.WORKFLOW_DISPATCH_REJECTED, fields)
    };
  }
  if (clean && result.status === 0 && envelope && envelope.httpStatus === 200) {
    const id = dispatchHint(envelope.body, repo);
    if (id !== null) return { kind: 'hint', id, error: null };
  }
  const acceptedWithoutId = clean && result.status === 0 && envelope && envelope.httpStatus === 204;
  if (!acceptedWithoutId) {
    writeOutput(1, stdout);
    writeOutput(2, stderr);
  }
  return {
    kind: 'unknown',
    error: workflowError('WORKFLOW_DISPATCH_UNKNOWN', DIAGNOSTICS.WORKFLOW_DISPATCH_UNKNOWN, fields)
  };
}

function remoteOptions(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  return {
    cwd: root, env, shell: false, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: REQUEST_MS, maxBuffer: MAX_BYTES, killSignal: 'SIGKILL'
  };
}

function requireRemoteRef(deps, identity, attempt) {
  const main = attempt.dispatchRef === 'main';
  const direct = main ? 'refs/heads/main' : `refs/tags/v${attempt.version}`;
  const refs = main ? [direct] : [direct, `${direct}^{}`];
  let result;
  try {
    result = deps.run('git', ['ls-remote', '--exit-code', 'origin', ...refs], remoteOptions(identity.root));
  } catch (cause) {
    throw workflowError('WORKFLOW_PREFLIGHT_INVALID', 'Recorded dispatch ref could not be observed', { cause });
  }
  const stdout = text(result && result.stdout);
  const stderr = text(result && result.stderr);
  if (!record(result) || result.error || result.signal || result.status !== 0
    || Buffer.byteLength(stdout) > MAX_BYTES || Buffer.byteLength(stderr) > MAX_BYTES) {
    throw workflowError('WORKFLOW_PREFLIGHT_INVALID', 'Recorded dispatch ref could not be observed', {
      result, stdout, stderr, cause: result && result.error
    });
  }
  const lines = stdout.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const values = new Map();
  const oid = new RegExp(`^[0-9a-f]{${identity.objectFormat === 'sha256' ? 64 : 40}}$`);
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 2 || !oid.test(fields[0]) || !refs.includes(fields[1]) || values.has(fields[1])) {
      throw workflowError('WORKFLOW_PREFLIGHT_INVALID', 'Recorded dispatch ref returned invalid evidence');
    }
    values.set(fields[1], fields[0]);
  }
  if (!values.has(direct) || (values.get(`${direct}^{}`) || values.get(direct)) !== attempt.sourceSha) {
    throw workflowError('WORKFLOW_PREFLIGHT_INVALID', 'Recorded dispatch ref does not point to the recorded source');
  }
}

async function reconcileWorkflowAttempt(input, suppliedDeps) {
  ownDataKeys(input, ['state', 'repoDir', 'allowDispatch'], true, 'Workflow input');
  const { state, repoDir, allowDispatch } = input;
  if (typeof allowDispatch !== 'boolean') throw invalid('allowDispatch must be an explicit boolean');
  if (!record(state)) throw invalid('Workflow state must be a record');
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir)
    || path.normalize(repoDir) !== repoDir || /[\u0000-\u001f\u007f]/.test(repoDir)) {
    throw invalid('Workflow repoDir must be a canonical absolute path');
  }
  const deps = resolveDeps(suppliedDeps, allowDispatch);
  const io = deps.fs;
  validateReleaseState(state, state.repo, { repoDir });
  const supplied = JSON.parse(JSON.stringify(state));
  const cacheRoot = path.dirname(repoDir);
  if (statePaths(supplied.repo, { cacheRoot, fs: io }).repoDir !== repoDir) {
    throw invalid('Workflow repoDir does not match its repository identity');
  }
  const stored = readReleaseState(supplied.repo, { cacheRoot, mode: supplied.mode, fs: io });
  if (stored === null || !isDeepStrictEqual(stored, supplied)) {
    throw workflowError('WORKFLOW_STATE_STALE', 'Workflow state is not the current durable lane');
  }
  let current = stored;
  let lastObservation = null;
  let previousMono = -Infinity;
  const now = () => {
    const value = finiteClock(deps.now);
    if (value < previousMono) throw clockError();
    previousMono = value;
    return value;
  };
  const wallNow = () => finiteClock(deps.wallNow);
  const stamp = () => {
    const value = wallNow();
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || value < Date.parse(current.updatedAt)) throw clockError();
    return date.toISOString();
  };
  const githubDeps = {
    run: deps.run, now, wallNow, signal: deps.signal, logReadFailure: deps.logReadFailure,
    sleep: delayMs => deps.sleep(delayMs, deps.signal)
  };
  const localDeps = { run: deps.localRun, fs: io };
  const attempt = () => current.attempts.find(item => item.id === current.activeAttemptId);
  const remoteRepo = current.repo.remoteRepo;
  const repo = remoteRepo.slice('github.com/'.length);

  function requireCurrentIdentity() {
    const observed = resolveRepoIdentity(current.repo.root, {
      readGit: (root, args) => deps.localRun('git', args, { cwd: root }).trim(), fs: io
    });
    if (REPO_FIELDS.some(key => observed[key] !== current.repo[key])) {
      throw workflowError('WORKFLOW_IDENTITY_CONFLICT', 'Current repository identity differs from the recorded release');
    }
    return observed;
  }

  function persist(event) {
    const next = transitionRelease(current, event, current.repo, { repoDir });
    try {
      writeReleaseState(next, current.repo, {
        cacheRoot, expectedRevision: current.revision, fs: io
      });
    } catch (cause) {
      throw workflowError('WORKFLOW_STATE_WRITE_FAILED', 'Workflow state persistence is unresolved', { cause });
    }
    current = JSON.parse(JSON.stringify(next));
    return current;
  }

  function outcome(name, error = null) {
    return { state: current, outcome: name, observation: lastObservation, error };
  }

  function finishUnresolved(error) {
    const fatal = fatalError(error);
    if (fatal) throw fatal;
    if (current.phase !== 'failed-ci') {
      persist({
        type: attempt().dispatch === 'identified' ? 'workflow-unresolved' : 'dispatch-unknown',
        at: stamp(), error: compactDiagnostic(error)
      });
    }
    return outcome('unresolved', error);
  }

  function deadlineError() {
    return workflowError('WORKFLOW_DEADLINE', DIAGNOSTICS.WORKFLOW_DEADLINE);
  }

  function requireTime(end) {
    checkAbort(deps.signal);
    if (now() >= end) throw deadlineError();
  }

  async function readRun(id, end) {
    for (;;) {
      requireTime(end);
      const run = await readGithubJson('github.run', {
        repo, endpoint: `repos/${repo}/actions/runs/${id}`
      }, githubDeps, { deadline: end });
      checkAbort(deps.signal);
      try {
        return requireObservedRun(attempt(), remoteRepo, run, id);
      } catch (error) {
        const untitled = error && error.code === 'WORKFLOW_IDENTITY_CONFLICT' && error.reason === 'untitled'
          && run.status !== 'completed';
        if (!untitled || now() + UNTITLED_WAIT_MS >= end) throw error;
      }
      await wait(UNTITLED_WAIT_MS);
    }
  }

  async function wait(delay) {
    checkAbort(deps.signal);
    await deps.sleep(delay, deps.signal);
    checkAbort(deps.signal);
  }

  async function scan(end) {
    const active = attempt();
    const lower = new Date(Date.parse(active.requestedAt) - 60000)
      .toISOString().replace(/\.\d{3}Z$/, 'Z');
    let total = null;
    const ids = new Set();
    const matches = [];
    for (let page = 1; page <= 10; page += 1) {
      requireTime(end);
      const endpoint = `repos/${repo}/actions/workflows/${active.workflowId}/runs`
        + `?event=workflow_dispatch&per_page=100&page=${page}`
        + `&created=${encodeURIComponent(`>=${lower}`)}`;
      const body = await readGithubJson('github.workflow-runs-page', {
        repo, endpoint
      }, githubDeps, { deadline: end });
      checkAbort(deps.signal);
      if (!record(body) || !Number.isSafeInteger(body.total_count) || body.total_count < 0
        || !Array.isArray(body.workflow_runs) || body.workflow_runs.length > 100) {
        throw workflowError('WORKFLOW_RESPONSE_INVALID', DIAGNOSTICS.WORKFLOW_RESPONSE_INVALID);
      }
      if (body.total_count >= 1000 || (total !== null && body.total_count !== total)) {
        throw workflowError('WORKFLOW_DISCOVERY_INCOMPLETE', DIAGNOSTICS.WORKFLOW_DISCOVERY_INCOMPLETE);
      }
      total = body.total_count;
      if (body.workflow_runs.length !== Math.min(100, total - ids.size)) {
        throw workflowError('WORKFLOW_DISCOVERY_INCOMPLETE', DIAGNOSTICS.WORKFLOW_DISCOVERY_INCOMPLETE);
      }
      for (const run of body.workflow_runs) {
        if (!record(run) || !Number.isSafeInteger(run.id) || run.id <= 0) {
          throw workflowError('WORKFLOW_RESPONSE_INVALID', DIAGNOSTICS.WORKFLOW_RESPONSE_INVALID);
        }
        if (ids.has(run.id)) {
          throw workflowError('WORKFLOW_DISCOVERY_INCOMPLETE', DIAGNOSTICS.WORKFLOW_DISCOVERY_INCOMPLETE);
        }
        ids.add(run.id);
        const classification = classifyWorkflowRun({ attempt: active, remoteRepo, run });
        if (classification.kind === 'conflict') {
          throw workflowError('WORKFLOW_IDENTITY_CONFLICT', DIAGNOSTICS.WORKFLOW_IDENTITY_CONFLICT, {
            reason: classification.reason, candidateId: classification.candidateId
          });
        }
        if (classification.kind === 'match') matches.push(classification.observation.runId);
      }
      if (ids.size === total) {
        if (matches.length > 1) {
          throw workflowError('WORKFLOW_DISCOVERY_AMBIGUOUS', DIAGNOSTICS.WORKFLOW_DISCOVERY_AMBIGUOUS, {
            candidateIds: matches.slice(0, 2)
          });
        }
        return matches.length === 1 ? matches[0] : null;
      }
    }
    throw workflowError('WORKFLOW_DISCOVERY_INCOMPLETE', DIAGNOSTICS.WORKFLOW_DISCOVERY_INCOMPLETE);
  }

  async function discover(end, repeatEmpty) {
    for (;;) {
      const id = await scan(end);
      if (id !== null) return readRun(id, end);
      if (!repeatEmpty || now() + 2000 >= end) {
        throw workflowError('WORKFLOW_NOT_VISIBLE', DIAGNOSTICS.WORKFLOW_NOT_VISIBLE);
      }
      await wait(2000);
    }
  }

  requireCurrentIdentity();
  if (!['workflow', 'unknown', 'failed-ci'].includes(current.phase)
    || !attempt() || attempt().identityKind !== 'dispatch') {
    throw invalid('Workflow reconciliation requires an active dispatch attempt');
  }
  if (attempt().dispatch === 'ready' && current.phase !== 'workflow') {
    throw invalid('A ready workflow attempt requires the workflow phase');
  }
  if (attempt().dispatch === 'rejected') return outcome('rejected', attempt().error);
  if (attempt().dispatch === 'ready' && !allowDispatch) return outcome('ready');

  function freezeWatch(allowExpiredObservation) {
    const enteredMono = now();
    const remaining = Math.max(0, Date.parse(attempt().watchDeadlineAt) - wallNow());
    const watchEnd = enteredMono + remaining;
    const expiredOnEntry = allowExpiredObservation && remaining === 0;
    return {
      watchEnd,
      expiredOnEntry,
      observationEnd: expiredOnEntry ? enteredMono + READ_MS : watchEnd
    };
  }

  let budget = attempt().dispatch === 'ready' ? null : freezeWatch(true);
  let hint = null;
  if (attempt().dispatch === 'ready') {
    checkAbort(deps.signal);
    const end = now() + READ_MS;
    const definition = await readGithubJson('github.workflow-definition', {
      repo, endpoint: `repos/${repo}/actions/workflows/${attempt().workflowId}`
    }, githubDeps, { deadline: end });
    checkAbort(deps.signal);
    if (!record(definition) || definition.id !== attempt().workflowId
      || definition.path !== WORKFLOW_PATH || definition.state !== 'active') {
      throw workflowError('WORKFLOW_PREFLIGHT_INVALID', 'Recorded release workflow is not the active expected workflow');
    }
    readPublishedSourceVersion({
      repoRoot: current.repo.root, sourceSha: attempt().sourceSha, version: attempt().version
    }, localDeps);
    checkAbort(deps.signal);
    requireRemoteRef(deps, current.repo, attempt());
    requireCurrentIdentity();
    checkAbort(deps.signal);
    deps.assertPublishWindow();
    persist({ type: 'dispatch-requested', at: stamp() });
    budget = freezeWatch(false);
    checkAbort(deps.signal);
    deps.assertPublishWindow();
    checkAbort(deps.signal);
    const postRemaining = budget.watchEnd - now();
    if (postRemaining <= 0) return finishUnresolved(deadlineError());
    const posted = postOnce(deps, repo, attempt(), Math.max(1, Math.floor(Math.min(REQUEST_MS, postRemaining))));
    if (posted.kind === 'rejected') {
      persist({ type: 'dispatch-rejected', at: stamp(), error: compactDiagnostic(posted.error) });
      return outcome('rejected', posted.error);
    }
    if (posted.kind === 'hint') hint = posted.id;
    else persist({ type: 'dispatch-unknown', at: stamp(), error: compactDiagnostic(posted.error) });
  }

  const { watchEnd, expiredOnEntry, observationEnd } = budget;
  let observation;
  try {
    if (hint !== null) observation = await readRun(hint, observationEnd);
    else if (attempt().dispatch === 'identified') observation = await readRun(attempt().runId, observationEnd);
    else observation = await discover(Math.min(now() + READ_MS, observationEnd), !expiredOnEntry);
  } catch (error) {
    return finishUnresolved(error);
  }

  for (;;) {
    lastObservation = observation;
    if (current.phase === 'failed-ci') {
      return outcome('failed-ci', workflowError('WORKFLOW_CI_FAILED',
        `Workflow ${observation.conclusion}: ${observation.url}`));
    }
    persist({
      type: 'run-observed', at: stamp(),
      runId: observation.runId, runAttempt: observation.runAttempt,
      runStatus: observation.runStatus, conclusion: observation.conclusion
    });
    if (observation.runStatus === 'completed') {
      if (observation.conclusion !== 'success') {
        const error = workflowError('WORKFLOW_CI_FAILED', `Workflow ${observation.conclusion}: ${observation.url}`);
        persist({
          type: 'ci-failed', at: stamp(),
          error: { code: error.code, message: error.message.slice(0, 4096) }
        });
        return outcome('failed-ci', error);
      }
      if (current.mode === 'dry-run') persist({ type: 'dry-run-complete', at: stamp() });
      return outcome('succeeded');
    }
    const pollRemaining = watchEnd - now();
    if (expiredOnEntry || pollRemaining <= 0) return finishUnresolved(deadlineError());
    try {
      await wait(Math.min(15000, pollRemaining));
      requireTime(watchEnd);
      observation = await readRun(attempt().runId, watchEnd);
    } catch (error) {
      return finishUnresolved(error);
    }
  }
}

module.exports = { reconcileWorkflowAttempt };
