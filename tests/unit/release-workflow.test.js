// Workflow attempt step: one durably requested attempt issues at most one POST, is
// reconciled by exact attempt identity, and records its truthful observed outcome under
// the original deadline. Every fixture is a real scratch checkout with real committed
// package objects, the real state constructors/store/lock and primitive raw-runner fakes
// that return realistic HTTP envelopes and reject any unexpected executable or argv.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('node:vm');
const { spawnSync } = require('child_process');

const { createLocalGitReader } = require('../../scripts/release-local-read');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('../../scripts/release-state');
const { createReleaseState, transitionRelease } = require('../../scripts/release-transitions');
const { makeWorkflowAttempt } = require('../../scripts/release-workflow-identity');
const { withReleaseLock } = require('../../scripts/release-lock');
const { reconcileWorkflowAttempt } = require('../../scripts/release-workflow');
const { describePosix } = require('../helpers/platform');

const OWNER = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-workflow-')));

const VERSION = '1.29.0';
const PREVIOUS_PACKAGE_VERSION = '1.28.0';
const WORKFLOW_ID = 12345;
const WORKFLOW_PATH = '.github/workflows/release.yml';
const REPO = 'fixture-owner/hyperclay-local';
const REMOTE_REPO = `github.com/${REPO}`;
const REMOTE_URL = `git@github.com:${REPO}.git`;
const RUN_ID = 456;
const HINT_ID = 654;
const T0 = Date.parse('2026-10-03T19:00:00.000Z');
const WALL = (minutes) => new Date(T0 + minutes * 60000).toISOString();

const GH_GET_PREFIX = [
  'api', '--hostname', 'github.com', '--method', 'GET', '--include',
  '-H', 'Accept: application/vnd.github+json',
  '-H', 'X-GitHub-Api-Version: 2026-03-10'
];
const GH_POST_PREFIX = [
  'api', '--hostname', 'github.com', '--method', 'POST', '--include',
  '-H', 'Accept: application/vnd.github+json',
  '-H', 'X-GitHub-Api-Version: 2026-03-10'
];
const MAX_BYTES = 8 * 1024 * 1024;

let fixtureSeq = 0;

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    shell: false
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error || result.stderr}`);
  }
  return result.stdout.trim();
}

function makeFixture({ mode = 'publish', version = VERSION, packageVersion = version } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, 'fixture-')));
  const checkout = path.join(dir, `checkout-${++fixtureSeq}`);
  fs.mkdirSync(checkout);
  git(checkout, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(checkout, 'package.json'),
    `${JSON.stringify({ name: 'hyperclay-local', version: packageVersion }, null, 2)}\n`);
  git(checkout, ['add', 'package.json']);
  git(checkout, ['-c', 'user.email=fixture@example.com', '-c', 'user.name=Fixture', 'commit', '-m', 'fixture']);
  git(checkout, ['remote', 'add', 'origin', REMOTE_URL]);

  const reader = createLocalGitReader();
  const identity = resolveRepoIdentity(checkout, { readGit: reader.readGit, fs });
  const cacheRoot = path.join(dir, 'cache', 'releases');
  const repoDir = statePaths(identity, { cacheRoot, fs }).repoDir;
  return {
    dir,
    checkout,
    cacheRoot,
    repoDir,
    identity,
    reader,
    sourceSha: git(checkout, ['rev-parse', 'HEAD']),
    version,
    mode,
    releaseId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    dispatchRef: mode === 'dry-run' ? 'main' : `v${version}`
  };
}

function advance(fx, state, event) {
  return transitionRelease(state, event, fx.identity, { repoDir: fx.repoDir });
}

function readyChain(fx) {
  const base = createReleaseState({
    releaseId: fx.releaseId,
    version: fx.version,
    mode: fx.mode,
    at: WALL(0),
    sourceSha: fx.sourceSha,
    versionIntent: null
  }, fx.identity, { repoDir: fx.repoDir });
  const attempt = makeWorkflowAttempt({
    state: base,
    repoDir: fx.repoDir,
    workflowId: WORKFLOW_ID,
    attemptId: fx.attemptId,
    sourceSha: fx.sourceSha,
    dispatchRef: fx.dispatchRef
  });
  return [base, advance(fx, base, { type: 'attempt-ready', at: WALL(1), attempt })];
}

function requestedChain(fx, at = WALL(1)) {
  const chain = readyChain(fx);
  return chain.concat([advance(fx, chain[chain.length - 1], { type: 'dispatch-requested', at })]);
}

function observedEvent({ runId = RUN_ID, runAttempt = 1, runStatus = 'in_progress', conclusion = null, at = WALL(4) } = {}) {
  return { type: 'run-observed', at, runId, runAttempt, runStatus, conclusion };
}

function identifiedChain(fx, observation) {
  const chain = requestedChain(fx);
  return chain.concat([advance(fx, chain[chain.length - 1], observedEvent(observation))]);
}

function failedCiChain(fx) {
  const chain = identifiedChain(fx, { runStatus: 'completed', conclusion: 'failure', at: WALL(4) });
  return chain.concat([advance(fx, chain[chain.length - 1], {
    type: 'ci-failed', at: WALL(5), error: { code: 'WORKFLOW_CI_FAILED', message: 'Release workflow failed' }
  })]);
}

function put(fx, chain) {
  let expected = null;
  for (const state of chain) {
    writeReleaseState(state, fx.identity, { cacheRoot: fx.cacheRoot, expectedRevision: expected });
    expected = state.revision;
  }
  return chain[chain.length - 1];
}

function putOne(fx, state, expectedRevision) {
  writeReleaseState(state, fx.identity, { cacheRoot: fx.cacheRoot, expectedRevision });
  return state;
}

function lane(fx, mode = fx.mode) {
  return readReleaseState(fx.identity, { cacheRoot: fx.cacheRoot, mode });
}

function makeClock({ mono = 1000, wall = Date.parse(WALL(3)) } = {}) {
  const state = { mono, wall };
  return {
    now: () => state.mono,
    wallNow: () => state.wall,
    advance(ms) {
      state.mono += ms;
      state.wall += ms;
    }
  };
}

function abortFailure() {
  const error = new Error('Workflow observation was aborted by the operator');
  error.kind = 'operator-abort';
  error.abortedByOperator = true;
  return error;
}

function check(problems, condition, message) {
  if (!condition) problems.push(message);
}

function envelope(status, body, reason = '') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return `HTTP/2.0 ${status}${reason === '' ? '' : ` ${reason}`}\r\ncontent-type: application/json\r\n\r\n${payload}`;
}

function ghResult(status, body, exit = 0, reason = '') {
  return { status: exit, stdout: envelope(status, body, reason), stderr: '', error: null, signal: null };
}

function transportFailure(code = 'ECONNRESET') {
  const error = new Error(`socket failure ${code}`);
  error.code = code;
  return { status: null, stdout: '', stderr: `gh: ${code}\r\n`, error, signal: null };
}

function matches(endpoint, matcher) {
  return typeof matcher === 'string' ? endpoint === matcher : matcher.test(endpoint);
}

function ghGet(problems, matcher, result) {
  return (args, options) => {
    check(problems, args.length === 11, `gh GET argv length ${args.length}`);
    check(problems, JSON.stringify(args.slice(0, 10)) === JSON.stringify(GH_GET_PREFIX), 'gh GET argv prefix');
    check(problems, matches(args[10], matcher), `gh GET endpoint ${args[10]}`);
    check(problems, options.shell === false, 'gh GET shell');
    check(problems, options.env && options.env.GH_FORCE_TTY === '0', 'gh GET GH_FORCE_TTY');
    check(problems, options.env && options.env.NO_COLOR === '1', 'gh GET NO_COLOR');
    check(problems, Number.isInteger(options.timeout) && options.timeout > 0, 'gh GET timeout');
    return result;
  };
}

function ghPost(problems, fx, result, inspect) {
  return (args, options) => {
    check(problems, args.length === 13, `gh POST argv length ${args.length}`);
    check(problems, JSON.stringify(args.slice(0, 10)) === JSON.stringify(GH_POST_PREFIX), 'gh POST argv prefix');
    check(problems, args[10] === `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, `gh POST endpoint ${args[10]}`);
    check(problems, args[11] === '--input' && args[12] === '-', 'gh POST input flags');
    check(problems, options.shell === false, 'gh POST shell');
    check(problems, options.killSignal === 'SIGKILL', 'gh POST kill signal');
    check(problems, options.maxBuffer === MAX_BYTES, 'gh POST maxBuffer');
    check(problems, options.env && options.env.GH_FORCE_TTY === '0', 'gh POST GH_FORCE_TTY');
    check(problems, options.env && options.env.NO_COLOR === '1', 'gh POST NO_COLOR');
    check(problems, typeof options.input === 'string', 'gh POST stdin body');
    if (typeof options.input === 'string') {
      let body = null;
      try {
        body = JSON.parse(options.input);
      } catch {
        body = null;
      }
      check(problems, body !== null, 'gh POST body is JSON');
      if (body !== null) {
        check(problems, body.ref === fx.dispatchRef, `gh POST ref ${body.ref}`);
        check(problems, body.inputs && body.inputs.version === fx.version, 'gh POST version input');
        check(problems, body.inputs && body.inputs.dry_run === (fx.mode === 'dry-run'), 'gh POST dry_run input');
        check(problems, body.inputs && body.inputs.source_sha === fx.sourceSha, 'gh POST source_sha input');
        check(problems, body.inputs && body.inputs.attempt_id === fx.attemptId, 'gh POST attempt_id input');
      }
    }
    if (typeof inspect === 'function') inspect();
    return result;
  };
}

function remoteRef(fx, problems, refs, stdout) {
  return (args, options) => {
    check(problems, JSON.stringify(args) === JSON.stringify(['ls-remote', '--exit-code', 'origin', ...refs]),
      `raw git argv ${args.join(' ')}`);
    check(problems, options.cwd === fx.checkout, 'raw git cwd');
    check(problems, options.shell === false, 'raw git shell');
    check(problems, options.timeout === 30000, 'raw git timeout');
    check(problems, options.killSignal === 'SIGKILL', 'raw git kill signal');
    check(problems, options.maxBuffer === MAX_BYTES, 'raw git maxBuffer');
    check(problems, JSON.stringify(options.stdio) === JSON.stringify(['ignore', 'pipe', 'pipe']), 'raw git stdio');
    check(problems, options.env && options.env.GIT_TERMINAL_PROMPT === '0', 'raw git GIT_TERMINAL_PROMPT');
    check(problems, options.env && options.env.GIT_OPTIONAL_LOCKS === '0', 'raw git GIT_OPTIONAL_LOCKS');
    return { status: 0, stdout, stderr: '', error: null, signal: null };
  };
}

function tagRemote(fx, problems, { direct = null, peeled = fx.sourceSha } = {}) {
  const directRef = `refs/tags/v${fx.version}`;
  const lines = [`${direct === null ? fx.sourceSha : direct}\t${directRef}`];
  if (peeled !== null) lines.push(`${peeled}\t${directRef}^{}`);
  return remoteRef(fx, problems, peeled === null ? [directRef] : [directRef, `${directRef}^{}`], `${lines.join('\n')}\n`);
}

function mainRemote(fx, problems, oid = fx.sourceSha) {
  return remoteRef(fx, problems, ['refs/heads/main'], `${oid}\trefs/heads/main\n`);
}

function harness(fx, { gh = [], remote = null, clock = makeClock(), signal, sleep, fs: io, assertPublishWindow, problems = [] } = {}) {
  const calls = [];
  const sleeps = [];
  let index = 0;
  const run = (file, args, options) => {
    calls.push({ file, args: args.slice(), options });
    if (file === 'git') {
      if (typeof remote !== 'function') {
        problems.push(`unexpected raw git call ${args.join(' ')}`);
        throw new Error('unexpected raw git call');
      }
      return remote(args, options);
    }
    if (file !== 'gh') {
      problems.push(`unexpected executable ${file}`);
      throw new Error(`unexpected executable ${file}`);
    }
    if (index >= gh.length) {
      problems.push(`unexpected gh call ${args.join(' ')}`);
      throw new Error('unexpected gh call');
    }
    const handler = gh[index];
    index += 1;
    return handler(args, options);
  };
  const defaultSleep = async (delayMs, activeSignal) => {
    if (activeSignal && activeSignal.aborted) throw abortFailure();
    clock.advance(delayMs);
  };
  const sleepImpl = sleep === undefined ? defaultSleep : sleep;
  const deps = {
    run,
    localRun: fx.reader.run,
    fs: io === undefined ? fs : io,
    now: clock.now,
    wallNow: clock.wallNow,
    sleep: async (delayMs, activeSignal) => {
      sleeps.push(delayMs);
      return sleepImpl(delayMs, activeSignal);
    },
    signal,
    assertPublishWindow: assertPublishWindow === undefined ? () => {} : assertPublishWindow
  };
  return {
    deps,
    calls,
    sleeps,
    clock,
    problems,
    posts: () => calls.filter((call) => call.file === 'gh' && call.args.includes('POST')),
    gets: () => calls.filter((call) => call.file === 'gh' && call.args.includes('GET')),
    remotes: () => calls.filter((call) => call.file === 'git')
  };
}

function withFixtureLock(fx, callback) {
  return withReleaseLock(fx.identity, callback, { cacheRoot: fx.cacheRoot, fs });
}

async function reconcile(fx, deps, allowDispatch = true) {
  return reconcileState(fx, lane(fx), deps, allowDispatch);
}

async function reconcileState(fx, state, deps, allowDispatch = true) {
  return withFixtureLock(fx, () => reconcileWorkflowAttempt({
    state, repoDir: fx.repoDir, allowDispatch
  }, deps));
}

function definitionResult(overrides = {}) {
  return ghResult(200, {
    id: WORKFLOW_ID, path: WORKFLOW_PATH, state: 'active', ...overrides
  });
}

function definitionEndpoint(fx) {
  return `repos/${REPO}/actions/workflows/${WORKFLOW_ID}`;
}

function runEndpoint(id) {
  return `repos/${REPO}/actions/runs/${id}`;
}

function pageEndpoint(requestedAt, page) {
  const lower = new Date(Date.parse(requestedAt) - 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`
    + `?event=workflow_dispatch&per_page=100&page=${page}`
    + `&created=${encodeURIComponent(`>=${lower}`)}`;
}

function attemptTitle(fx) {
  return `release v${fx.version} ${fx.mode} sha=${fx.sourceSha} attempt=${fx.attemptId}`;
}

function runBody(fx, overrides = {}) {
  const id = overrides.id === undefined ? RUN_ID : overrides.id;
  const status = overrides.status === undefined ? 'completed' : overrides.status;
  return {
    id,
    display_title: overrides.display_title === undefined ? attemptTitle(fx) : overrides.display_title,
    repository: { full_name: REPO },
    workflow_id: WORKFLOW_ID,
    event: 'workflow_dispatch',
    head_sha: overrides.head_sha === undefined ? fx.sourceSha : overrides.head_sha,
    run_attempt: overrides.run_attempt === undefined ? 1 : overrides.run_attempt,
    status,
    conclusion: status === 'completed'
      ? (overrides.conclusion === undefined ? 'success' : overrides.conclusion)
      : null,
    created_at: '2026-10-03T19:04:00Z',
    updated_at: '2026-10-03T19:05:00Z',
    html_url: `https://github.com/${REPO}/actions/runs/${id}`
  };
}

function pageBody(total, runs) {
  return { total_count: total, workflow_runs: runs };
}

function rows(from, count) {
  const list = [];
  for (let index = 0; index < count; index += 1) {
    list.push({ id: from + index, display_title: `unrelated run ${from + index}` });
  }
  return list;
}

function hintBody(id) {
  return {
    workflow_run_id: id,
    run_url: `https://api.github.com/repos/${REPO}/actions/runs/${id}`,
    html_url: `https://github.com/${REPO}/actions/runs/${id}`
  };
}

function ioRenameFailure({ index = 1, after = false } = {}) {
  let remaining = index;
  const io = Object.create(fs);
  io.renameSync = (from, to) => {
    remaining -= 1;
    if (remaining > 0) return fs.renameSync(from, to);
    if (after) fs.renameSync(from, to);
    const error = new Error('injected rename failure');
    error.code = 'EIO';
    throw error;
  };
  return io;
}

describePosix('workflow attempt orchestration', () => {
  test('returns ready without any provider request when dispatch is not authorized', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, { problems });

    const result = await reconcile(fx, h.deps, false);

    expect(result.outcome).toBe('ready');
    expect(result.observation).toBeNull();
    expect(result.error).toBeNull();
    expect(result.state.revision).toBe(1);
    expect(result.state.attempts[0].dispatch).toBe('ready');
    expect(h.calls).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('persists requested before the single POST and records the accepted run', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, hintBody(RUN_ID)), () => {
          const persisted = lane(fx);
          check(problems, persisted.attempts[0].dispatch === 'requested', 'POST ran before the request was durable');
          check(problems, persisted.attempts[0].requestedAt === WALL(3), 'POST ran before its requested timestamp');
          check(problems, persisted.attempts[0].watchDeadlineAt === WALL(183), 'POST ran without the watch deadline');
          check(problems, persisted.revision === 2, 'POST ran before the requested revision was durable');
        }),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('succeeded');
    expect(result.error).toBeNull();
    expect(result.state.phase).toBe('workflow');
    expect(result.state.revision).toBe(3);
    expect(result.state.artifacts.state).toBe('pending');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(result.state.attempts[0].runAttempt).toBe(1);
    expect(result.state.attempts[0].runStatus).toBe('completed');
    expect(result.state.attempts[0].conclusion).toBe('success');
    expect(result.state.attempts[0].requestedAt).toBe(WALL(3));
    expect(result.observation.runId).toBe(RUN_ID);
    expect(result.observation.url).toBe(`https://${REMOTE_REPO}/actions/runs/${RUN_ID}`);
    expect(h.posts()).toHaveLength(1);
    expect(h.gets()).toHaveLength(2);
    expect(h.remotes()).toHaveLength(1);
    expect(lane(fx)).toEqual(result.state);
    expect(validateReleaseState(lane(fx), fx.identity, { repoDir: fx.repoDir })).toEqual(lane(fx));
    expect(problems).toEqual([]);
  });

  test('keeps one POST across a lost response and resumes by discovery', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, transportFailure()),
        ghGet(problems, pageEndpoint(WALL(3), 1), ghResult(404, { message: 'Not Found' }, 1, 'Not Found'))
      ]
    });

    const first = await reconcile(fx, h.deps);

    expect(first.outcome).toBe('unresolved');
    expect(first.error.code).toBeUndefined();
    expect(first.state.phase).toBe('unknown');
    expect(first.state.attempts[0].dispatch).toBe('unknown');
    expect(first.state.attempts[0].error.code).toBe('WORKFLOW_READ_UNAVAILABLE');
    expect(first.state.attempts[0].requestedAt).toBe(WALL(3));
    expect(first.state.attempts[0].watchDeadlineAt).toBe(WALL(183));
    expect(h.posts()).toHaveLength(1);
    expect(lane(fx)).toEqual(first.state);

    const resumedProblems = [];
    const resumed = harness(fx, {
      problems: resumedProblems,
      clock: makeClock({ wall: Date.parse(WALL(5)) }),
      gh: [
        ghGet(resumedProblems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(fx)]))),
        ghGet(resumedProblems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const second = await reconcile(fx, resumed.deps, true);

    expect(second.outcome).toBe('succeeded');
    expect(second.state.attempts[0].dispatch).toBe('identified');
    expect(second.state.attempts[0].runId).toBe(RUN_ID);
    expect(second.state.attempts[0].requestedAt).toBe(WALL(3));
    expect(second.state.attempts[0].watchDeadlineAt).toBe(WALL(183));
    expect(resumed.posts()).toHaveLength(0);
    expect(resumed.remotes()).toHaveLength(0);
    expect(resumedProblems).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('stops before any POST when the requested write fails before publication', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      fs: ioRenameFailure({ index: 1 }),
      gh: [ghGet(problems, definitionEndpoint(fx), definitionResult())]
    });

    await expect(reconcile(fx, h.deps)).rejects.toMatchObject({ code: 'WORKFLOW_STATE_WRITE_FAILED' });

    expect(h.posts()).toHaveLength(0);
    expect(h.gets()).toHaveLength(1);
    expect(lane(fx).revision).toBe(1);
    expect(lane(fx).attempts[0].dispatch).toBe('ready');

    const resumed = harness(fx, { problems });
    const result = await reconcile(fx, resumed.deps, false);
    expect(result.outcome).toBe('ready');
    expect(resumed.calls).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test('never replays a POST when the requested write is visible but its flush failed', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      fs: ioRenameFailure({ index: 1, after: true }),
      gh: [ghGet(problems, definitionEndpoint(fx), definitionResult())]
    });

    await expect(reconcile(fx, h.deps)).rejects.toMatchObject({ code: 'WORKFLOW_STATE_WRITE_FAILED' });

    expect(h.posts()).toHaveLength(0);
    const visible = lane(fx);
    expect(visible.revision).toBe(2);
    expect(visible.attempts[0].dispatch).toBe('requested');
    expect(visible.attempts[0].requestedAt).toBe(WALL(3));
    expect(visible.attempts[0].watchDeadlineAt).toBe(WALL(183));

    const resumedProblems = [];
    const resumed = harness(fx, {
      problems: resumedProblems,
      clock: makeClock({ wall: Date.parse(WALL(5)) }),
      gh: [
        ghGet(resumedProblems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(fx)]))),
        ghGet(resumedProblems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const second = await reconcile(fx, resumed.deps, true);
    expect(second.outcome).toBe('succeeded');
    expect(resumed.posts()).toHaveLength(0);
    expect(resumedProblems).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('stops without another request when the run-observed write fails', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      fs: ioRenameFailure({ index: 2 }),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, hintBody(RUN_ID))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    await expect(reconcile(fx, h.deps)).rejects.toMatchObject({ code: 'WORKFLOW_STATE_WRITE_FAILED' });

    expect(h.posts()).toHaveLength(1);
    expect(h.gets()).toHaveLength(2);
    expect(h.sleeps).toEqual([]);
    const visible = lane(fx);
    expect(visible.revision).toBe(2);
    expect(visible.attempts[0].dispatch).toBe('requested');
    expect(visible.attempts[0].runId).toBeNull();
    expect(visible.phase).toBe('workflow');
    expect(problems).toEqual([]);
  });

  test('discovers an exact match only after a complete two-page scan', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(204, '')),
        ghGet(problems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(101, rows(1000, 100)))),
        ghGet(problems, pageEndpoint(WALL(3), 2), ghResult(200, pageBody(101, [runBody(fx)]))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('succeeded');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(result.state.artifacts.state).toBe('pending');
    expect(h.posts()).toHaveLength(1);
    expect(h.gets()).toHaveLength(4);
    expect(h.gets()[2].args[10]).toBe(pageEndpoint(WALL(3), 2));
    expect(h.gets()[3].args[10]).toBe(runEndpoint(RUN_ID));
    expect(problems).toEqual([]);
  });

  test('refuses duplicate ids, changed totals, early short pages and the result ceiling', async () => {
    const cases = [
      {
        name: 'ceiling',
        pages: [[1, 1000, rows(1000, 100)]]
      },
      {
        name: 'early short page',
        pages: [[1, 5, rows(1000, 4)]]
      },
      {
        name: 'duplicate ids',
        pages: [[1, 101, rows(1000, 100)], [2, 101, [{ id: 1000, display_title: 'unrelated repeat' }]]]
      },
      {
        name: 'changed totals',
        pages: [[1, 101, rows(1000, 100)], [2, 102, [{ id: 9000, display_title: 'unrelated run' }]]]
      }
    ];

    for (const item of cases) {
      const fx = makeFixture();
      put(fx, readyChain(fx));
      const problems = [];
      const h = harness(fx, {
        problems,
        remote: tagRemote(fx, problems),
        gh: [
          ghGet(problems, definitionEndpoint(fx), definitionResult()),
          ghPost(problems, fx, ghResult(204, '')),
          ...item.pages.map(([page, total, pageRows]) =>
            ghGet(problems, pageEndpoint(WALL(3), page), ghResult(200, pageBody(total, pageRows))))
        ]
      });

      const result = await reconcile(fx, h.deps);

      expect(result.outcome).toBe('unresolved');
      expect(result.state.attempts[0].error.code).toBe('WORKFLOW_DISCOVERY_INCOMPLETE');
      expect(result.state.phase).toBe('unknown');
      expect(result.state.attempts[0].dispatch).toBe('unknown');
      expect(h.posts()).toHaveLength(1);
      expect(h.gets()).toHaveLength(1 + item.pages.length);
      expect(h.gets().slice(1).map((call) => call.args[10]))
        .toEqual(item.pages.map(([page]) => pageEndpoint(WALL(3), page)));
      expect(problems).toEqual([]);
    }
  });

  test('pins the github.com host and the exact encoded creation bound', async () => {
    const fx = makeFixture();
    put(fx, requestedChain(fx));
    const problems = [];
    const expected = `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs`
      + '?event=workflow_dispatch&per_page=100&page=1&created=%3E%3D2026-10-03T19%3A00%3A00Z';
    expect(pageEndpoint(WALL(1), 1)).toBe(expected);
    const h = harness(fx, {
      problems,
      gh: [ghGet(problems, expected, ghResult(404, { message: 'Not Found' }, 1, 'Not Found'))]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_READ_UNAVAILABLE');
    expect(h.gets()).toHaveLength(1);
    expect(h.gets()[0].args.slice(0, 3)).toEqual(['api', '--hostname', 'github.com']);
    expect(h.gets()[0].args[10]).toBe(expected);
    expect(problems).toEqual([]);
  });

  test('treats a structured rejection as definitive and a transport failure as unknown', async () => {
    const rejected = makeFixture();
    put(rejected, readyChain(rejected));
    const rejectedProblems = [];
    const rejectedHarness = harness(rejected, {
      problems: rejectedProblems,
      remote: tagRemote(rejected, rejectedProblems),
      gh: [
        ghGet(rejectedProblems, definitionEndpoint(rejected), definitionResult()),
        ghPost(rejectedProblems, rejected, ghResult(422, { message: 'Invalid request' }, 1, 'Unprocessable Entity'))
      ]
    });

    const rejectedResult = await reconcile(rejected, rejectedHarness.deps);

    expect(rejectedResult.outcome).toBe('rejected');
    expect(rejectedResult.error.code).toBe('WORKFLOW_DISPATCH_REJECTED');
    expect(rejectedResult.error.envelope.httpStatus).toBe(422);
    expect(rejectedResult.error.stdout).toContain('HTTP/2.0 422');
    expect(rejectedHarness.posts()).toHaveLength(1);
    expect(rejectedHarness.posts()[0].args.slice(0, 3)).toEqual(['api', '--hostname', 'github.com']);
    expect(rejectedHarness.gets()).toHaveLength(1);

    const rejectedLane = lane(rejected);
    expect(rejectedLane.phase).toBe('unknown');
    expect(rejectedLane.revision).toBe(3);
    expect(rejectedLane.attempts[0].dispatch).toBe('rejected');
    expect(rejectedLane.attempts[0].error.code).toBe('WORKFLOW_DISPATCH_REJECTED');
    expect(rejectedLane.attempts[0].runId).toBeNull();
    expect(rejectedLane.attempts[0].requestedAt).toBe(WALL(3));
    expect(rejectedLane.attempts[0].watchDeadlineAt).toBe(WALL(183));

    const rejectedResume = harness(rejected, { problems: rejectedProblems });
    const resumed = await reconcile(rejected, rejectedResume.deps, true);
    expect(resumed.outcome).toBe('rejected');
    expect(resumed.state.revision).toBe(3);
    expect(rejectedResume.calls).toHaveLength(0);

    const ambiguous = makeFixture();
    put(ambiguous, readyChain(ambiguous));
    const ambiguousProblems = [];
    const failed = ghResult(422, { message: 'Invalid request' }, 1, 'Unprocessable Entity');
    failed.error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const ambiguousHarness = harness(ambiguous, {
      problems: ambiguousProblems,
      remote: tagRemote(ambiguous, ambiguousProblems),
      gh: [
        ghGet(ambiguousProblems, definitionEndpoint(ambiguous), definitionResult()),
        ghPost(ambiguousProblems, ambiguous, failed),
        ghGet(ambiguousProblems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(ambiguous)]))),
        ghGet(ambiguousProblems, runEndpoint(RUN_ID), ghResult(200, runBody(ambiguous)))
      ]
    });

    const ambiguousResult = await reconcile(ambiguous, ambiguousHarness.deps);

    expect(ambiguousResult.outcome).toBe('succeeded');
    expect(ambiguousResult.state.attempts[0].dispatch).toBe('identified');
    expect(ambiguousHarness.posts()).toHaveLength(1);
    expect(lane(ambiguous).attempts[0].dispatch).toBe('identified');
    expect(ambiguousProblems).toEqual([]);
    expect(rejectedProblems).toEqual([]);
  });

  test('rejects a hint whose direct confirmation carries a different run id', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, hintBody(HINT_ID))),
        ghGet(problems, runEndpoint(HINT_ID), ghResult(200, runBody(fx, { id: RUN_ID })))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
    expect(result.state.attempts[0].dispatch).toBe('unknown');
    expect(result.state.attempts[0].runId).toBeNull();
    expect(result.state.phase).toBe('unknown');
    expect(h.posts()).toHaveLength(1);
    expect(h.gets().map((call) => call.args[10])).toEqual([definitionEndpoint(fx), runEndpoint(HINT_ID)]);
    expect(problems).toEqual([]);
  });

  test('reads a hinted run again until GitHub gives it its title', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, hintBody(RUN_ID))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx, { display_title: 'Release', status: 'queued' }))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('succeeded');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(h.posts()).toHaveLength(1);
    expect(h.sleeps).toEqual([2000]);
    expect(h.gets().map((call) => call.args[10])).toEqual([
      definitionEndpoint(fx), runEndpoint(RUN_ID), runEndpoint(RUN_ID)
    ]);
    expect(problems).toEqual([]);
  });

  test('still refuses a hinted run whose title names another attempt', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const otherTitle = attemptTitle(fx).replace(fx.attemptId, '00000000-0000-4000-8000-000000000000');
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, hintBody(RUN_ID))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx, { display_title: otherTitle, status: 'queued' })))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
    expect(h.sleeps).toEqual([]);
    expect(h.gets()).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test('falls back to discovery when the accepted response carries no usable hint', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(200, { workflow_run_id: 0 })),
        ghGet(problems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(fx)]))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('succeeded');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(h.posts()).toHaveLength(1);
    expect(h.gets().map((call) => call.args[10])).toEqual([
      definitionEndpoint(fx), pageEndpoint(WALL(3), 1), runEndpoint(RUN_ID)
    ]);
    expect(problems).toEqual([]);
  });

  test('keeps a completed conclusion when the bound run contradicts it', async () => {
    const fx = makeFixture();
    put(fx, identifiedChain(fx, { runStatus: 'completed', conclusion: 'success' }));
    const problems = [];
    const h = harness(fx, {
      problems,
      clock: makeClock({ wall: Date.parse(WALL(6)) }),
      gh: [ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx, { conclusion: 'failure' })))]
    });

    const result = await reconcile(fx, h.deps, true);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.phase).toBe('unknown');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(result.state.attempts[0].runAttempt).toBe(1);
    expect(result.state.attempts[0].runStatus).toBe('completed');
    expect(result.state.attempts[0].conclusion).toBe('success');
    expect(result.state.artifacts.state).toBe('pending');
    expect(result.state.revision).toBe(4);
    expect(h.posts()).toHaveLength(0);
    expect(h.gets()).toHaveLength(1);

    const drifted = makeFixture();
    put(drifted, identifiedChain(drifted, { runStatus: 'in_progress', conclusion: null }));
    const driftedProblems = [];
    const driftedHarness = harness(drifted, {
      problems: driftedProblems,
      clock: makeClock({ wall: Date.parse(WALL(6)) }),
      gh: [ghGet(driftedProblems, runEndpoint(RUN_ID),
        ghResult(200, runBody(drifted, { status: 'in_progress', head_sha: '9'.repeat(40) })))]
    });

    const driftedResult = await reconcile(drifted, driftedHarness.deps, true);

    expect(driftedResult.outcome).toBe('unresolved');
    expect(driftedResult.state.attempts[0].error.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
    expect(driftedResult.state.attempts[0].sourceSha).toBe(drifted.sourceSha);
    expect(driftedHarness.posts()).toHaveLength(0);
    expect(driftedProblems).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('stops after the adapter exhausts three transient reads with two waits', async () => {
    const fx = makeFixture();
    put(fx, requestedChain(fx));
    const problems = [];
    const unavailable = () => ghResult(503, { message: 'Service Unavailable' }, 1, 'Service Unavailable');
    const h = harness(fx, {
      problems,
      gh: [
        ghGet(problems, pageEndpoint(WALL(1), 1), unavailable()),
        ghGet(problems, pageEndpoint(WALL(1), 1), unavailable()),
        ghGet(problems, pageEndpoint(WALL(1), 1), unavailable())
      ]
    });

    const result = await reconcile(fx, h.deps, true);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_READ_UNAVAILABLE');
    expect(result.error.attempts).toBe(3);
    expect(result.error.attemptErrors).toHaveLength(3);
    expect(h.gets()).toHaveLength(3);
    expect(h.sleeps).toEqual([1000, 3000]);
    expect(h.posts()).toHaveLength(0);
    const visible = lane(fx);
    expect(visible.phase).toBe('unknown');
    expect(visible.attempts[0].dispatch).toBe('unknown');
    expect(visible.attempts[0].requestedAt).toBe(WALL(1));
    expect(visible.attempts[0].watchDeadlineAt).toBe(WALL(181));
    expect(problems).toEqual([]);
  });

  test('allows one bounded observation for an attempt that expired on entry', async () => {
    const bound = makeFixture();
    put(bound, requestedChain(bound));
    const boundProblems = [];
    const boundHarness = harness(bound, {
      problems: boundProblems,
      clock: makeClock({ wall: Date.parse(WALL(200)) }),
      gh: [
        ghGet(boundProblems, pageEndpoint(WALL(1), 1), ghResult(200, pageBody(1, [runBody(bound)]))),
        ghGet(boundProblems, runEndpoint(RUN_ID), ghResult(200, runBody(bound)))
      ]
    });

    const boundResult = await reconcile(bound, boundHarness.deps, true);

    expect(boundResult.outcome).toBe('succeeded');
    expect(boundResult.state.attempts[0].runId).toBe(RUN_ID);
    expect(boundResult.state.attempts[0].watchDeadlineAt).toBe(WALL(181));
    expect(boundResult.state.attempts[0].requestedAt).toBe(WALL(1));
    expect(boundHarness.gets()).toHaveLength(2);
    expect(boundHarness.sleeps).toEqual([]);

    const empty = makeFixture();
    put(empty, requestedChain(empty));
    const emptyProblems = [];
    const emptyHarness = harness(empty, {
      problems: emptyProblems,
      clock: makeClock({ wall: Date.parse(WALL(200)) }),
      gh: [ghGet(emptyProblems, pageEndpoint(WALL(1), 1), ghResult(200, pageBody(0, [])))]
    });

    const emptyResult = await reconcile(empty, emptyHarness.deps, true);

    expect(emptyResult.outcome).toBe('unresolved');
    expect(emptyResult.state.attempts[0].error.code).toBe('WORKFLOW_NOT_VISIBLE');
    expect(emptyHarness.gets()).toHaveLength(1);
    expect(emptyHarness.sleeps).toEqual([]);

    const running = makeFixture();
    put(running, identifiedChain(running, { runStatus: 'in_progress', conclusion: null }));
    const runningProblems = [];
    const runningHarness = harness(running, {
      problems: runningProblems,
      clock: makeClock({ wall: Date.parse(WALL(200)) }),
      gh: [ghGet(runningProblems, runEndpoint(RUN_ID), ghResult(200, runBody(running, { status: 'in_progress' })))]
    });

    const runningResult = await reconcile(running, runningHarness.deps, true);

    expect(runningResult.outcome).toBe('unresolved');
    expect(runningResult.state.attempts[0].error.code).toBe('WORKFLOW_DEADLINE');
    expect(runningResult.state.attempts[0].runId).toBe(RUN_ID);
    expect(runningResult.state.attempts[0].runStatus).toBe('in_progress');
    expect(runningResult.state.attempts[0].watchDeadlineAt).toBe(WALL(181));
    expect(runningHarness.gets()).toHaveLength(1);
    expect(runningHarness.sleeps).toEqual([]);
    expect(runningProblems).toEqual([]);
    expect(emptyProblems).toEqual([]);
    expect(boundProblems).toEqual([]);
  });

  test('does not refresh the discovery budget after an empty scan', async () => {
    const fx = makeFixture();
    put(fx, requestedChain(fx));
    const problems = [];
    const pages = [];
    for (let scan = 0; scan < 45; scan += 1) {
      pages.push(ghGet(problems, pageEndpoint(WALL(1), 1), ghResult(200, pageBody(0, []))));
    }
    const h = harness(fx, { problems, gh: pages });

    const result = await reconcile(fx, h.deps, true);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_NOT_VISIBLE');
    expect(h.gets()).toHaveLength(45);
    expect(h.sleeps).toEqual(new Array(44).fill(2000));
    expect(h.gets()[0].options.timeout).toBe(30000);
    expect(h.gets()[44].options.timeout).toBeLessThan(30000);
    expect(new Set(h.gets().map((call) => call.args[10])).size).toBe(1);
    expect(problems).toEqual([]);
  });

  test('completes a dry run without touching the publish lane', async () => {
    const fx = makeFixture({ mode: 'dry-run' });
    put(fx, readyChain(fx));
    const problems = [];
    const h = harness(fx, {
      problems,
      remote: mainRemote(fx, problems),
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(204, '')),
        ghGet(problems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(fx)]))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('succeeded');
    expect(result.state.mode).toBe('dry-run');
    expect(result.state.phase).toBe('complete');
    expect(result.state.revision).toBe(5);
    expect(result.state.artifacts.state).toBe('pending');
    expect(result.state.attempts[0].dispatchRef).toBe('main');
    expect(lane(fx, 'publish')).toBeNull();
    expect(lane(fx, 'dry-run')).toEqual(result.state);
    expect(h.posts()).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test('preserves failed-ci state when the bound reread is unavailable', async () => {
    const fx = makeFixture();
    put(fx, failedCiChain(fx));
    const problems = [];
    const unavailable = () => ghResult(503, { message: 'Service Unavailable' }, 1, 'Service Unavailable');
    const h = harness(fx, {
      problems,
      clock: makeClock({ wall: Date.parse(WALL(200)) }),
      gh: [
        ghGet(problems, runEndpoint(RUN_ID), unavailable()),
        ghGet(problems, runEndpoint(RUN_ID), unavailable()),
        ghGet(problems, runEndpoint(RUN_ID), unavailable())
      ]
    });

    const first = await reconcile(fx, h.deps, true);

    expect(first.outcome).toBe('unresolved');
    expect(first.state.phase).toBe('failed-ci');
    expect(first.state.revision).toBe(4);
    expect(first.state.attempts[0].dispatch).toBe('identified');
    expect(first.state.attempts[0].conclusion).toBe('failure');
    expect(first.state.attempts[0].error.code).toBe('WORKFLOW_CI_FAILED');
    expect(h.posts()).toHaveLength(0);
    expect(h.gets()).toHaveLength(3);

    const identicalProblems = [];
    const identical = harness(fx, {
      problems: identicalProblems,
      clock: makeClock({ wall: Date.parse(WALL(200)) }),
      gh: [ghGet(identicalProblems, runEndpoint(RUN_ID), ghResult(200, runBody(fx, { conclusion: 'failure' })))]
    });

    const second = await reconcile(fx, identical.deps, true);

    expect(second.outcome).toBe('failed-ci');
    expect(second.error.code).toBe('WORKFLOW_CI_FAILED');
    expect(second.error.message).toBe(`Workflow failure: https://${REMOTE_REPO}/actions/runs/${RUN_ID}`);
    expect(second.state.phase).toBe('failed-ci');
    expect(second.state.revision).toBe(4);
    expect(second.state.attempts[0].conclusion).toBe('failure');
    expect(identical.posts()).toHaveLength(0);
    expect(identical.gets()).toHaveLength(1);
    expect(identicalProblems).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('accepts a foreign-realm-equal state and refuses stale state without any request', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const stored = lane(fx);
    const foreign = vm.runInNewContext(`(${JSON.stringify(stored)})`);
    expect(foreign).not.toBe(stored);
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.getPrototypeOf(stored));
    expect(Object.keys(foreign)).toEqual(Object.keys(stored));
    const problems = [];
    const equalHarness = harness(fx, { problems });

    const equalResult = await reconcileState(fx, foreign, equalHarness.deps, false);

    expect(equalResult.outcome).toBe('ready');
    expect(equalResult.state.revision).toBe(1);
    expect(equalHarness.calls).toHaveLength(0);

    const mutated = vm.runInNewContext(`(${JSON.stringify(stored)})`);
    mutated.lastError = { code: 'STALE_MARKER', message: 'a different durable lane' };
    const mutatedHarness = harness(fx, { problems });
    await expect(reconcileState(fx, mutated, mutatedHarness.deps, false))
      .rejects.toMatchObject({ code: 'WORKFLOW_STATE_STALE' });
    expect(mutatedHarness.calls).toHaveLength(0);

    putOne(fx, requestedChain(fx)[2], 1);
    const olderHarness = harness(fx, { problems });
    await expect(reconcileState(fx, stored, olderHarness.deps, true))
      .rejects.toMatchObject({ code: 'WORKFLOW_STATE_STALE' });
    expect(olderHarness.calls).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test('refuses every preflight failure before the single POST', async () => {
    const cases = [
      {
        name: 'definition identity',
        code: 'WORKFLOW_PREFLIGHT_INVALID',
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult({ id: WORKFLOW_ID + 1 }))]
      },
      {
        name: 'definition path',
        code: 'WORKFLOW_PREFLIGHT_INVALID',
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult({ path: '.github/workflows/other.yml' }))]
      },
      {
        name: 'definition state',
        code: 'WORKFLOW_PREFLIGHT_INVALID',
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult({ state: 'disabled' }))]
      },
      {
        name: 'source package version',
        fixture: { packageVersion: PREVIOUS_PACKAGE_VERSION },
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult())]
      },
      {
        name: 'tag peel',
        code: 'WORKFLOW_PREFLIGHT_INVALID',
        remote: (fx, problems) => tagRemote(fx, problems, { direct: '8'.repeat(40), peeled: '8'.repeat(40) }),
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult())]
      },
      {
        name: 'main tip',
        fixture: { mode: 'dry-run' },
        code: 'WORKFLOW_PREFLIGHT_INVALID',
        remote: (fx, problems) => mainRemote(fx, problems, '7'.repeat(40)),
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult())]
      },
      {
        name: 'repository drift',
        code: 'WORKFLOW_IDENTITY_CONFLICT',
        drift: true,
        gh: (fx, problems) => [ghGet(problems, definitionEndpoint(fx), definitionResult())]
      }
    ];

    for (const item of cases) {
      const fx = makeFixture(item.fixture === undefined ? {} : item.fixture);
      put(fx, readyChain(fx));
      if (item.drift) git(fx.checkout, ['remote', 'set-url', 'origin', 'git@github.com:other/other.git']);
      const problems = [];
      const h = harness(fx, {
        problems,
        remote: item.remote === undefined
          ? (fx.mode === 'dry-run' ? mainRemote(fx, problems) : tagRemote(fx, problems))
          : item.remote(fx, problems),
        gh: item.gh(fx, problems)
      });

      if (item.code === undefined) {
        await expect(reconcile(fx, h.deps)).rejects.toThrow();
      } else {
        await expect(reconcile(fx, h.deps)).rejects.toMatchObject({ code: item.code });
      }

      expect(h.posts()).toHaveLength(0);
      expect(h.remotes().length).toBeLessThanOrEqual(1);
      const visible = lane(fx);
      expect(visible.revision).toBe(1);
      expect(visible.attempts[0].dispatch).toBe('ready');
      expect(visible.phase).toBe('workflow');
      expect(problems).toEqual([]);
    }
  });

  test('stops before the POST when the publish window closes', async () => {
    const first = makeFixture();
    put(first, readyChain(first));
    const firstProblems = [];
    let opened = 0;
    const closed = () => {
      opened += 1;
      throw Object.assign(new Error('Release window is closed'), { code: 'PUBLISH_WINDOW_CLOSED' });
    };
    const firstHarness = harness(first, {
      problems: firstProblems,
      remote: tagRemote(first, firstProblems),
      assertPublishWindow: closed,
      gh: [ghGet(firstProblems, definitionEndpoint(first), definitionResult())]
    });

    await expect(reconcile(first, firstHarness.deps)).rejects.toMatchObject({ code: 'PUBLISH_WINDOW_CLOSED' });

    expect(opened).toBe(1);
    expect(firstHarness.posts()).toHaveLength(0);
    expect(lane(first).revision).toBe(1);
    expect(lane(first).attempts[0].dispatch).toBe('ready');

    const second = makeFixture();
    put(second, readyChain(second));
    const secondProblems = [];
    let checks = 0;
    const closesLater = () => {
      checks += 1;
      if (checks === 2) throw Object.assign(new Error('Release window closed after the request'), { code: 'PUBLISH_WINDOW_CLOSED' });
    };
    const secondHarness = harness(second, {
      problems: secondProblems,
      remote: tagRemote(second, secondProblems),
      assertPublishWindow: closesLater,
      gh: [ghGet(secondProblems, definitionEndpoint(second), definitionResult())]
    });

    await expect(reconcile(second, secondHarness.deps)).rejects.toMatchObject({ code: 'PUBLISH_WINDOW_CLOSED' });

    expect(checks).toBe(2);
    expect(secondHarness.posts()).toHaveLength(0);
    const visible = lane(second);
    expect(visible.revision).toBe(2);
    expect(visible.attempts[0].dispatch).toBe('requested');
    expect(visible.attempts[0].requestedAt).toBe(WALL(3));
    expect(visible.attempts[0].watchDeadlineAt).toBe(WALL(183));
    expect(secondProblems).toEqual([]);
    expect(firstProblems).toEqual([]);
  });

  test('aborts during adapter backoff without another request', async () => {
    const fx = makeFixture();
    put(fx, requestedChain(fx));
    const problems = [];
    const controller = new AbortController();
    const h = harness(fx, {
      problems,
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
        throw abortFailure();
      },
      gh: [ghGet(problems, pageEndpoint(WALL(1), 1), ghResult(503, { message: 'Service Unavailable' }, 1, 'Service Unavailable'))]
    });

    const result = await reconcile(fx, h.deps, true);

    expect(result.outcome).toBe('unresolved');
    expect(result.error.kind).toBe('operator-abort');
    expect(result.state.phase).toBe('unknown');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_ABORTED');
    expect(result.state.attempts[0].dispatch).toBe('unknown');
    expect(h.gets()).toHaveLength(1);
    expect(h.sleeps).toEqual([1000]);
    expect(h.posts()).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test('aborts while polling a successful run without losing its identity', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];
    const controller = new AbortController();
    const h = harness(fx, {
      problems,
      remote: tagRemote(fx, problems),
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
        throw abortFailure();
      },
      gh: [
        ghGet(problems, definitionEndpoint(fx), definitionResult()),
        ghPost(problems, fx, ghResult(204, '')),
        ghGet(problems, pageEndpoint(WALL(3), 1), ghResult(200, pageBody(1, [runBody(fx, { status: 'in_progress' })]))),
        ghGet(problems, runEndpoint(RUN_ID), ghResult(200, runBody(fx, { status: 'in_progress' })))
      ]
    });

    const result = await reconcile(fx, h.deps);

    expect(result.outcome).toBe('unresolved');
    expect(result.state.phase).toBe('unknown');
    expect(result.state.attempts[0].dispatch).toBe('identified');
    expect(result.state.attempts[0].runId).toBe(RUN_ID);
    expect(result.state.attempts[0].runStatus).toBe('in_progress');
    expect(result.state.attempts[0].error.code).toBe('WORKFLOW_ABORTED');
    expect(result.state.attempts[0].watchDeadlineAt).toBe(WALL(183));
    expect(h.posts()).toHaveLength(1);
    expect(h.gets()).toHaveLength(3);
    expect(h.sleeps).toEqual([15000]);
    expect(problems).toEqual([]);
  });

  test('serializes on the real release lock and refuses a stale revision', async () => {
    const fx = makeFixture();
    put(fx, readyChain(fx));
    const problems = [];

    const busy = withFixtureLock(fx, () => withFixtureLock(fx, async () => {}));
    await expect(busy).rejects.toMatchObject({ code: 'RELEASE_LOCK_BUSY' });

    const heldHarness = harness(fx, { problems });
    const held = await withFixtureLock(fx, async () => {
      expect(fs.existsSync(statePaths(fx.identity, { cacheRoot: fx.cacheRoot, fs }).releaseLock)).toBe(true);
      return reconcileWorkflowAttempt({
        state: lane(fx), repoDir: fx.repoDir, allowDispatch: false
      }, heldHarness.deps);
    });

    expect(fs.existsSync(statePaths(fx.identity, { cacheRoot: fx.cacheRoot, fs }).releaseLock)).toBe(false);
    expect(held.outcome).toBe('ready');
    expect(heldHarness.calls).toHaveLength(0);

    const readyRecord = lane(fx);
    putOne(fx, requestedChain(fx)[2], 1);
    const staleHarness = harness(fx, { problems });
    await expect(reconcileState(fx, readyRecord, staleHarness.deps, true))
      .rejects.toMatchObject({ code: 'WORKFLOW_STATE_STALE' });
    expect(staleHarness.posts()).toHaveLength(0);

    const resumedProblems = [];
    const resumed = harness(fx, {
      problems: resumedProblems,
      clock: makeClock({ wall: Date.parse(WALL(5)) }),
      gh: [
        ghGet(resumedProblems, pageEndpoint(WALL(1), 1), ghResult(200, pageBody(1, [runBody(fx)]))),
        ghGet(resumedProblems, runEndpoint(RUN_ID), ghResult(200, runBody(fx)))
      ]
    });

    const second = await reconcile(fx, resumed.deps, true);

    expect(second.outcome).toBe('succeeded');
    expect(second.state.attempts[0].dispatch).toBe('identified');
    expect(resumed.posts()).toHaveLength(0);
    expect(resumedProblems).toEqual([]);
    expect(problems).toEqual([]);
  });
});
