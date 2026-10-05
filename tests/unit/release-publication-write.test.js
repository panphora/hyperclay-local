'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { observePublication, verifyCurrentPublication } = require('../../scripts/release-publication-write');
const { readPublicationEvidence } = require('../../scripts/release-publication');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { resolveRepoIdentity } = require('../../scripts/release-state');

const FAILURE_CODE = 'PUBLICATION_EVIDENCE_INVALID';
const VERSION = '1.28.1';
const DATE = '2026-01-02T03:04:05.678Z';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const WORKFLOW_ID = 12345;
const RUN_ID = 456;
const LEGACY_RUN_ID = 789;
const LEGACY_RUN_ATTEMPT = 2;
const UPLOAD_JOB_ID = 4242;
const BUILD_JOB_ID = 9001;
const RUN_CREATED_AT = '2026-01-02T02:00:00Z';
const RUN_UPDATED_AT = '2026-01-02T02:30:00Z';
const REQUESTED_AT = '2026-01-02T01:59:00.000Z';
const WATCH_DEADLINE_AT = '2026-01-02T04:59:00.000Z';
const OBSERVED_AT = '2026-01-02T02:31:00.000Z';
const VERIFIED_AT = '2026-01-02T03:04:06.000Z';
const OWNER_REPO = 'fixture-owner/hyperclay-local';
const REMOTE_REPO = `github.com/${OWNER_REPO}`;
const ORIGIN_URL = 'git@github.com:fixture-owner/hyperclay-local.git';
const OTHER_ORIGIN_URL = 'git@github.com:other-owner/other-repo.git';
const RELEASE_INFO_URL = 'https://local.hyperclay.com/release-info.json';
const GITHUB_API_VERSION = '2026-03-10';

const NAMES = [
  `HyperclayLocal-${VERSION}-arm64.dmg`,
  `HyperclayLocal-${VERSION}.dmg`,
  `HyperclayLocal-${VERSION}-arm64.AppImage`,
  `HyperclayLocal-Setup-${VERSION}.exe`,
  `HyperclayLocal-${VERSION}.AppImage`
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sizeMap() {
  const sizes = {};
  NAMES.forEach((name, index) => {
    sizes[name] = 1000 * (index + 1) + 7;
  });
  return sizes;
}

function shuffledFiles() {
  return [NAMES[3], NAMES[0], NAMES[4], NAMES[1], NAMES[2]];
}

function manifestFor(commit, options = {}) {
  return {
    version: options.version === undefined ? VERSION : options.version,
    commit: options.commit === undefined ? commit : options.commit,
    date: options.date === undefined ? DATE : options.date,
    files: options.files === undefined ? shuffledFiles() : options.files,
    sizes: options.sizes === undefined ? sizeMap() : options.sizes
  };
}

const OWNER = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-publication-observe-'));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');
const READ_STDIO = ['ignore', 'pipe', 'pipe'];

fs.mkdirSync(NO_HOOKS, { recursive: true });
fs.writeFileSync(GIT_CONFIG, [
  '[user]',
  '\tname = Fixture',
  '\temail = fixture@example.com',
  '[init]',
  '\tdefaultBranch = main',
  '[commit]',
  '\tgpgsign = false',
  '[tag]',
  '\tgpgsign = false',
  '[core]',
  `\thooksPath = ${JSON.stringify(NO_HOOKS.replace(/\\/g, '/'))}`,
  '\tautocrlf = false',
  ''
].join('\n'));

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_CONFIG,
  GIT_OPTIONAL_LOCKS: '0'
};

jest.setTimeout(60000);

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

let seq = 0;

function git(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

function packageBody(version) {
  return `${JSON.stringify({ name: 'hyperclay-local-electron', version, private: true }, null, 2)}\n`;
}

function makeCheckout(options = {}) {
  const branch = options.branch === undefined ? 'main' : options.branch;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, `checkout-${++seq}-`)));
  git(root, ['init', '-q', '-b', branch]);
  fs.writeFileSync(path.join(root, 'package.json'), packageBody(options.version === undefined ? VERSION : options.version));
  fs.writeFileSync(path.join(root, 'README.md'), 'hyperclay local\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'release source']);
  if (options.remote !== null) {
    git(root, ['remote', 'add', 'origin', options.remote === undefined ? ORIGIN_URL : options.remote]);
  }
  return {
    root,
    commonDir: fs.realpathSync(path.join(root, '.git')),
    sourceSha: git(root, ['rev-parse', 'HEAD']).trim()
  };
}

function identityFor(checkout, options = {}) {
  return {
    key: sha256(checkout.commonDir),
    root: checkout.root,
    commonDir: checkout.commonDir,
    branch: 'main',
    remote: 'origin',
    remoteRepo: options.remoteRepo === undefined ? REMOTE_REPO : options.remoteRepo,
    pushUrlSha256: sha256(options.pushUrl === undefined ? ORIGIN_URL : options.pushUrl),
    objectFormat: 'sha1'
  };
}

function resolvedIdentity(checkout) {
  return resolveRepoIdentity(checkout.root, { readGit: createLocalGitReader().readGit, fs });
}

function dispatchAttempt(patch = {}) {
  return Object.assign({
    id: ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha: null,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: WORKFLOW_ID,
    expectedTitle: null,
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

function legacyAttempt(patch = {}) {
  return Object.assign({
    id: `legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`,
    identityKind: 'legacy-upload-proof',
    version: VERSION,
    mode: 'publish',
    sourceSha: null,
    dispatchRef: null,
    workflowPath: '.github/workflows/release.yml',
    workflowId: WORKFLOW_ID,
    expectedTitle: null,
    dispatch: 'identified',
    requestedAt: null,
    watchDeadlineAt: null,
    runId: LEGACY_RUN_ID,
    runAttempt: LEGACY_RUN_ATTEMPT,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: OBSERVED_AT,
    error: null,
    legacyProof: {
      uploadJobId: UPLOAD_JOB_ID,
      uploadJobConclusion: 'success',
      observedHeadSha: null,
      observedMode: 'publish'
    }
  }, patch);
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function releaseState(attempt, patch = {}) {
  return Object.assign({
    schema: 1,
    revision: 4,
    repo: null,
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: '2026-01-02T01:00:00.000Z',
    updatedAt: '2026-01-02T01:30:00.000Z',
    versionIntent: null,
    sourceSha: attempt.sourceSha,
    activeAttemptId: attempt.id,
    attempts: [attempt],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: {
      state: 'pending', sourceSha: null, treeSha: null, attemptId: null,
      receiptSha: null, verifiedAt: null, error: null
    },
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null
  }, patch);
}

function base(options = {}) {
  const checkout = options.checkout === undefined ? makeCheckout(options) : options.checkout;
  const identity = options.identity === undefined ? resolvedIdentity(checkout) : options.identity;
  const repoDir = path.join(fs.mkdtempSync(path.join(OWNER, `cache-${++seq}-`)), identity.key);
  fs.mkdirSync(repoDir, { recursive: true, mode: 0o700 });
  const sourceSha = options.sourceSha === undefined ? checkout.sourceSha : options.sourceSha;
  const legacy = Boolean(options.legacy);
  const attempt = legacy
    ? legacyAttempt({ sourceSha, legacyProof: { uploadJobId: UPLOAD_JOB_ID, uploadJobConclusion: 'success', observedHeadSha: sourceSha, observedMode: 'publish' } })
    : dispatchAttempt({ sourceSha });
  const runId = legacy ? LEGACY_RUN_ID : RUN_ID;
  const runAttempt = legacy ? LEGACY_RUN_ATTEMPT : 1;
  const mode = options.dryRun ? 'dry-run' : 'publish';
  if (options.dryRun) {
    attempt.mode = 'dry-run';
  }
  const title = legacy
    ? `release v${VERSION} ${mode} sha=${sourceSha}`
    : `release v${VERSION} ${mode} sha=${sourceSha} attempt=${ATTEMPT_ID}`;
  if (!legacy) attempt.expectedTitle = title;
  const manifestValue = manifestFor(sourceSha, options.manifest);
  const manifestBytes = options.manifestBytes === undefined
    ? Buffer.from(JSON.stringify(manifestValue), 'utf8')
    : options.manifestBytes;
  const state = releaseState(attempt, {
    repo: identity,
    sourceSha,
    mode,
    phase: 'workflow',
    artifacts: { state: 'pending' }
  });
  return { checkout, identity, repoDir, sourceSha, legacy, attempt, runId, runAttempt, mode, title, manifestValue, manifestBytes, state };
}

function runObject(baseValue, patch = {}) {
  const row = Object.assign({
    id: baseValue.runId,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    workflow_id: WORKFLOW_ID,
    display_title: baseValue.title,
    head_sha: baseValue.sourceSha,
    run_attempt: baseValue.runAttempt,
    created_at: RUN_CREATED_AT,
    updated_at: RUN_UPDATED_AT,
    repository: { full_name: OWNER_REPO }
  }, patch);
  if (!Object.prototype.hasOwnProperty.call(patch, 'html_url')) {
    row.html_url = `https://github.com/${OWNER_REPO}/actions/runs/${row.id}`;
  }
  return row;
}

function buildRow(patch = {}) {
  return Object.assign({ id: BUILD_JOB_ID, name: 'build', status: 'completed', conclusion: 'success' }, patch);
}

function uploadRow(patch = {}) {
  return Object.assign({ id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' }, patch);
}

function buildRows(count, start = 1000) {
  return Array.from({ length: count }, (value, index) => buildRow({ id: start + index }));
}

function runEndpoint(baseValue) {
  return `repos/${OWNER_REPO}/actions/runs/${baseValue.runId}`;
}

function jobsEndpoint(baseValue, page) {
  return `${runEndpoint(baseValue)}/attempts/${baseValue.runAttempt}/jobs?per_page=100&page=${page}`;
}

const REASONS = { 200: 'OK', 404: 'Not Found', 503: 'Service Unavailable' };

function envelope(status, headers, body) {
  const lines = [`HTTP/2.0 ${status} ${REASONS[status] || 'Status'}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  return `${lines.join('\r\n')}\r\n\r\n${body}`;
}

function ghOk(value) {
  return {
    status: 0,
    signal: null,
    stdout: envelope(200, { 'content-type': 'application/json' }, JSON.stringify(value)),
    stderr: ''
  };
}

function ghHttp(status, body, headers = {}) {
  return { status: 1, signal: null, stdout: envelope(status, headers, body), stderr: `gh: HTTP ${status}` };
}

function ghRunner() {
  const queues = new Map();
  const calls = [];
  return {
    calls,
    push(endpoint, response) {
      if (!queues.has(endpoint)) queues.set(endpoint, []);
      queues.get(endpoint).push(response);
    },
    run(file, args, options) {
      const endpoint = args[args.length - 1];
      calls.push({ file, args, options, endpoint });
      const queue = queues.get(endpoint);
      if (!queue || queue.length === 0) throw new Error(`unexpected gh call ${endpoint}`);
      const next = queue.shift();
      return typeof next === 'function' ? next({ file, args, options }) : next;
    }
  };
}

function streamResponse(bytes, options = {}) {
  const chunks = Array.isArray(bytes) ? bytes : [bytes];
  let index = 0;
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: options.headers || {},
    body: {
      getReader() {
        return {
          read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }),
          cancel: async () => {
            if (options.onCancel) options.onCancel();
          }
        };
      }
    }
  };
}

function fetchServer() {
  const queue = [];
  const calls = [];
  return {
    calls,
    push(response) {
      queue.push(response);
    },
    fetch(url, options) {
      calls.push({ url, options });
      if (queue.length === 0) throw new Error(`unexpected fetch ${url}`);
      const next = queue.shift();
      return Promise.resolve(typeof next === 'function' ? next(url, options) : next);
    }
  };
}

function fakeClock(start = 0) {
  const clock = { ms: start, wall: 1_700_000_000_000, sleeps: [], events: [] };
  clock.now = () => clock.ms;
  clock.wallNow = () => clock.wall;
  clock.sleep = (delayMs) => {
    clock.sleeps.push(delayMs);
    clock.ms += delayMs;
    return Promise.resolve();
  };
  clock.log = (event) => clock.events.push(event);
  clock.advance = (ms) => {
    clock.ms += ms;
  };
  return clock;
}

function recordingLocalRun() {
  const inner = createLocalGitReader().run;
  const calls = [];
  return {
    calls,
    run(file, args, options) {
      calls.push({ file, args, options });
      return inner(file, args, options);
    }
  };
}

function driftingLocalRun(afterOriginReads, url = OTHER_ORIGIN_URL) {
  const inner = createLocalGitReader().run;
  const calls = [];
  let originReads = 0;
  return {
    calls,
    run(file, args, options) {
      calls.push({ file, args, options });
      if (file === 'git' && args.join(' ') === 'remote get-url origin') {
        originReads += 1;
        if (originReads > afterOriginReads) return `${url}\n`;
      }
      return inner(file, args, options);
    }
  };
}

function observationDeps(options = {}) {
  const deps = {
    github: { run: options.gh.run },
    manifest: { fetch: options.fetch.fetch },
    local: {}
  };
  if (options.localRun !== undefined) deps.local.run = options.localRun;
  if (options.clock !== undefined) {
    deps.now = options.clock.now;
    deps.wallNow = options.clock.wallNow;
    deps.sleep = options.clock.sleep;
    deps.logReadFailure = options.clock.log;
  }
  if (options.signal !== undefined) deps.signal = options.signal;
  return deps;
}

function serveRun(gh, baseValue, responses) {
  for (const response of responses) gh.push(runEndpoint(baseValue), response);
}

function serveDefault(gh, fetch, baseValue, options = {}) {
  const runs = options.runs === undefined
    ? [ghOk(runObject(baseValue)), ghOk(runObject(baseValue))]
    : options.runs;
  serveRun(gh, baseValue, runs);
  const pages = options.pages === undefined
    ? [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow()] } }]
    : options.pages;
  for (const page of pages) gh.push(jobsEndpoint(baseValue, page.page), ghOk(page.body));
  if (fetch !== undefined) {
    fetch.push(options.fetchResponse === undefined ? streamResponse(baseValue.manifestBytes) : options.fetchResponse);
  }
}

async function capture(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

function expectPublicationFailure(error) {
  expect(error).toBeTruthy();
  expect(error.code).toBe(FAILURE_CODE);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
  return error;
}

function noisyManifestBytes(value) {
  const json = JSON.stringify(value, null, 2);
  const noisy = json.replace('"version":', '"version": "caf\u00e9 \u2014 \u2615",\n  "version":');
  return Buffer.from(`\t${noisy}\r\n`, 'utf8');
}

function retainedPaths(fixture) {
  const dir = path.join(fixture.repoDir, 'records', RELEASE_ID, 'artifacts', fixture.attempt.id);
  return {
    dir,
    manifestFile: path.join(dir, 'release-info.json'),
    proofFile: path.join(dir, 'publication.json')
  };
}

function retainedProof(fixture, digest, patch = {}) {
  return Object.assign({
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: fixture.attempt.id,
    version: VERSION,
    mode: 'publish',
    sourceSha: fixture.sourceSha,
    manifestSha256: digest,
    verifiedAt: VERIFIED_AT,
    run: runObject(fixture),
    uploadJobsRequest: { runId: fixture.attempt.runId, runAttempt: fixture.attempt.runAttempt },
    uploadJob: uploadRow()
  }, patch);
}

function writeRetained(fixture, options = {}) {
  const paths = retainedPaths(fixture);
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const manifestBytes = options.manifestBytes === undefined ? fixture.manifestBytes : options.manifestBytes;
  const digest = sha256(manifestBytes);
  fs.writeFileSync(paths.manifestFile, manifestBytes, { mode: 0o600 });
  fs.writeFileSync(
    paths.proofFile,
    Buffer.from(JSON.stringify(retainedProof(fixture, digest, options.proof)), 'utf8'),
    { mode: 0o600 }
  );
  const state = releaseState(fixture.attempt, {
    repo: fixture.identity,
    sourceSha: fixture.sourceSha,
    phase: 'tail',
    artifacts: {
      state: 'complete',
      sourceSha: fixture.sourceSha,
      runId: fixture.attempt.runId,
      manifestFile: paths.manifestFile,
      manifestSha256: digest,
      verifiedAt: VERIFIED_AT
    }
  });
  return { paths, digest, state };
}

function completeState(fixture, options = {}) {
  const paths = retainedPaths(fixture);
  return releaseState(fixture.attempt, {
    repo: fixture.identity,
    sourceSha: fixture.sourceSha,
    phase: 'tail',
    artifacts: {
      state: 'complete',
      sourceSha: fixture.sourceSha,
      runId: fixture.attempt.runId,
      manifestFile: options.manifestFile === undefined ? paths.manifestFile : options.manifestFile,
      manifestSha256: options.digest === undefined ? sha256(fixture.manifestBytes) : options.digest,
      verifiedAt: options.verifiedAt === undefined ? VERIFIED_AT : options.verifiedAt
    }
  });
}

function fileStat(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function snapshotDir(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      entries.push(`${path.relative(root, full)} ${stat.isDirectory() ? 'dir' : `file:${stat.size}:${stat.mtimeMs}`}`);
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(root);
  return entries;
}

async function observe(fixture, options = {}) {
  return observePublication(
    { state: options.state === undefined ? fixture.state : options.state, repoDir: fixture.repoDir },
    options.deps,
    options.settings
  );
}

async function verify(fixture, state, options = {}) {
  return verifyCurrentPublication(
    { state, repoDir: fixture.repoDir },
    options.deps,
    options.settings
  );
}

function observeDepsFor(fixture, options = {}) {
  const gh = options.gh === undefined ? ghRunner() : options.gh;
  const fetch = options.fetch === undefined ? fetchServer() : options.fetch;
  const local = options.local === undefined ? recordingLocalRun() : options.local;
  const clock = options.clock === undefined ? fakeClock() : options.clock;
  if (options.serve !== false) {
    serveDefault(gh, fetch, fixture, options.serveOptions);
  }
  return {
    gh,
    fetch,
    local,
    clock,
    deps: observationDeps({ gh, fetch, localRun: local.run, clock, signal: options.signal })
  };
}

describe('publication observation', () => {
  describe('ordered reads', () => {
    test('reads the run, every job page, the manifest and the run again', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture);
      const result = await observe(fixture, { deps: context.deps });

      expect(Buffer.isBuffer(result.manifestBytes)).toBe(true);
      expect(result.manifestBytes.equals(fixture.manifestBytes)).toBe(true);
      expect(result.manifest).toEqual(fixture.manifestValue);
      expect(result.proof.schema).toBe(1);
      expect(result.proof.releaseId).toBe(RELEASE_ID);
      expect(result.proof.attemptId).toBe(ATTEMPT_ID);
      expect(result.proof.version).toBe(VERSION);
      expect(result.proof.mode).toBe('publish');
      expect(result.proof.sourceSha).toBe(fixture.sourceSha);
      expect(result.proof.manifestSha256).toBe(sha256(fixture.manifestBytes));
      expect(result.proof.verifiedAt).toBe(new Date(context.clock.wall).toISOString());
      expect(result.proof.run).toEqual(runObject(fixture));
      expect(result.proof.uploadJobsRequest).toEqual({ runId: RUN_ID, runAttempt: 1 });
      expect(result.proof.uploadJob).toEqual(uploadRow());
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runEndpoint(fixture),
        jobsEndpoint(fixture, 1),
        runEndpoint(fixture)
      ]);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
      expect(context.clock.events).toEqual([]);
    });

    test('pins the exact gh command, headers and request bounds', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture);
      await observe(fixture, { deps: context.deps });

      for (const call of context.gh.calls) {
        expect(call.file).toBe('gh');
        expect(call.args.slice(0, -1)).toEqual([
          'api',
          '--method',
          'GET',
          '--include',
          '-H',
          'Accept: application/vnd.github+json',
          '-H',
          `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`
        ]);
        expect(call.args).not.toContain('--paginate');
        expect(call.options).toMatchObject({
          shell: false,
          encoding: 'utf8',
          stdio: READ_STDIO,
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024
        });
        expect(call.options.env.GH_FORCE_TTY).toBe('0');
        expect(call.options.env.NO_COLOR).toBe('1');
      }
      expect(context.fetch.calls[0].url).toBe(`${RELEASE_INFO_URL}?t=${context.clock.wall}`);
    });

    test('reads the original source commit and never asks local Git for HEAD', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture);
      await observe(fixture, { deps: context.deps });

      const commands = context.local.calls.map((call) => call.args.join(' '));
      expect(commands).not.toContain('rev-parse HEAD');
      expect(commands.some((command) => command === 'symbolic-ref --quiet --short HEAD')).toBe(true);
      expect(commands).toContain(`rev-parse --verify ${fixture.sourceSha}^{commit}`);
      expect(commands).toContain(`ls-tree -z ${fixture.sourceSha} -- package.json`);
      expect(commands.some((command) => command.startsWith('cat-file blob '))).toBe(true);
    });
  });

  describe('upload job selection', () => {
    test('selects a later successful upload job from the second page', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [
            { page: 1, body: { total_count: 101, jobs: buildRows(100) } },
            { page: 2, body: { total_count: 101, jobs: [uploadRow()] } }
          ]
        }
      });
      const result = await observe(fixture, { deps: context.deps });
      expect(result.proof.uploadJob).toEqual(uploadRow());
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runEndpoint(fixture),
        jobsEndpoint(fixture, 1),
        jobsEndpoint(fixture, 2),
        runEndpoint(fixture)
      ]);
    });

    test('refuses a duplicate successful upload after the first success', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [
            { page: 1, body: { total_count: 101, jobs: buildRows(99).concat([uploadRow()]) } },
            { page: 2, body: { total_count: 101, jobs: [uploadRow({ id: 5001 })] } }
          ]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses a page sequence that stops before the complete total_count', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [
            { page: 1, body: { total_count: 101, jobs: buildRows(100) } },
            { page: 2, body: { total_count: 101, jobs: [] } }
          ]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses pages that disagree on total_count', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [
            { page: 1, body: { total_count: 101, jobs: buildRows(100) } },
            { page: 2, body: { total_count: 102, jobs: [uploadRow()] } }
          ]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses pages that carry more rows than total_count', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [{ page: 1, body: { total_count: 1, jobs: [buildRow(), uploadRow()] } }]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses a zero-row early page while more rows remain', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: { pages: [{ page: 1, body: { total_count: 101, jobs: [] } }] }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses a page that carries more than one hundred rows', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: { pages: [{ page: 1, body: { total_count: 101, jobs: buildRows(101) } }] }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });

    test('refuses a jobs response without a completed successful upload', async () => {
      const fixture = base();
      const missing = observeDepsFor(fixture, {
        serveOptions: { pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow(), buildRow({ id: 5002 })] } }] }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: missing.deps })));

      const failed = observeDepsFor(fixture, {
        serveOptions: {
          pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow({ conclusion: 'failure' })] } }]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: failed.deps })));
    });
  });

  describe('manifest evidence', () => {
    test('retains the exact whitespace and non-ASCII bytes and hashes those bytes', async () => {
      const fixture = base();
      const bytes = noisyManifestBytes(fixture.manifestValue);
      expect(bytes.includes(Buffer.from('caf\u00e9', 'utf8'))).toBe(true);
      fixture.manifestBytes = bytes;
      const context = observeDepsFor(fixture);
      const result = await observe(fixture, { deps: context.deps });

      expect(result.manifestBytes.equals(bytes)).toBe(true);
      expect(result.manifestBytes.length).toBe(bytes.length);
      expect(result.proof.manifestSha256).toBe(sha256(bytes));
      expect(result.manifest).toEqual(fixture.manifestValue);
    });

    test('refuses a manifest that exceeds the retained one mebibyte bound', async () => {
      const fixture = base();
      const oversized = Buffer.concat([fixture.manifestBytes, Buffer.from(' '.repeat(1024 * 1024 + 16))]);
      expect(oversized.length).toBeGreaterThan(1024 * 1024);
      const context = observeDepsFor(fixture, { serveOptions: { fetchResponse: streamResponse(oversized) } });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(context.fetch.calls).toHaveLength(1);
    });

    test('refuses a manifest for another version, source or installer set', async () => {
      const wrongVersion = base({ manifest: { version: '1.27.0' } });
      const versionContext = observeDepsFor(wrongVersion);
      expectPublicationFailure(await capture(observe(wrongVersion, { deps: versionContext.deps })));

      const wrongCommit = base({ manifest: { commit: 'a'.repeat(40) } });
      const commitContext = observeDepsFor(wrongCommit);
      expectPublicationFailure(await capture(observe(wrongCommit, { deps: commitContext.deps })));

      const partial = base({ manifest: { files: shuffledFiles().slice(0, 4) } });
      const partialContext = observeDepsFor(partial);
      expectPublicationFailure(await capture(observe(partial, { deps: partialContext.deps })));
    });
  });

  describe('legacy attempts', () => {
    test('observes a legacy attempt whose run attempt is two', async () => {
      const fixture = base({ legacy: true });
      const context = observeDepsFor(fixture);
      const result = await observe(fixture, { deps: context.deps });

      expect(result.proof.attemptId).toBe(`legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
      expect(result.proof.run.run_attempt).toBe(LEGACY_RUN_ATTEMPT);
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runEndpoint(fixture),
        jobsEndpoint(fixture, 1),
        runEndpoint(fixture)
      ]);
    });

    test('refuses a legacy run title that carries a new-format attempt token', async () => {
      const fixture = base({ legacy: true });
      const titled = runObject(fixture, { display_title: `${fixture.title} attempt=${ATTEMPT_ID}` });
      const context = observeDepsFor(fixture, { serveOptions: { runs: [ghOk(titled), ghOk(titled)] } });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
    });
  });

  describe('refusals', () => {
    test('refuses a rerun that appears between the two run reads', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          runs: [ghOk(runObject(fixture)), ghOk(runObject(fixture, { run_attempt: 2 }))]
        }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(context.gh.calls).toHaveLength(3);
    });

    test('refuses a run whose source or title is not the bound attempt', async () => {
      const fixture = base();
      const foreignSource = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(runObject(fixture, { head_sha: 'a'.repeat(40) })), ghOk(runObject(fixture, { head_sha: 'a'.repeat(40) }))] }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: foreignSource.deps })));
      expect(foreignSource.gh.calls).toHaveLength(1);

      const foreignTitle = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(runObject(fixture, { display_title: `release v${VERSION} publish sha=${fixture.sourceSha} attempt=${RELEASE_ID}` }))] }
      });
      expectPublicationFailure(await capture(observe(fixture, { deps: foreignTitle.deps })));
    });

    test('refuses a dry-run release before any provider call', async () => {
      const fixture = base({ dryRun: true });
      const context = observeDepsFor(fixture, { serve: false });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(context.gh.calls).toHaveLength(0);
      expect(context.fetch.calls).toHaveLength(0);
    });

    test('refuses a complete artifacts record', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, { serve: false });
      const state = completeState(fixture);
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps, state })));
      expect(context.gh.calls).toHaveLength(0);
    });

    test('refuses a missing local source object after the provider reads', async () => {
      const fixture = base({ sourceSha: 'f'.repeat(40) });
      const context = observeDepsFor(fixture);
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
    });

    test('refuses a repository branch drift before any provider call', async () => {
      const checkout = makeCheckout({ branch: 'feature' });
      const fixture = base({ checkout, identity: identityFor(checkout) });
      const context = observeDepsFor(fixture, { serve: false });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(context.gh.calls).toHaveLength(0);
      expect(context.fetch.calls).toHaveLength(0);
    });

    test('refuses a repository identity drift after the provider reads', async () => {
      const fixture = base();
      const local = driftingLocalRun(1);
      const context = observeDepsFor(fixture, { local });
      const error = expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(error.cause).toBeTruthy();
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
    });

    test('refuses an invalid explicit deadline instead of resetting it', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, { serve: false });
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps, settings: { deadline: Infinity } })));
      expectPublicationFailure(await capture(observe(fixture, { deps: context.deps, settings: { deadline: Number.NaN } })));
      expect(context.gh.calls).toHaveLength(0);
    });
  });

  describe('publication metadata regression', () => {
    function allowedRunProjection(run) {
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

    test('observes the same attempt when only unrelated response metadata changes', async () => {
      const fixture = base();
      const marker = 'unrelated provider metadata marker';
      const firstRun = runObject(fixture);
      const finalRun = runObject(fixture, {
        repository: { full_name: OWNER_REPO, description: marker },
        run_started_at: '2026-01-02T02:00:01Z'
      });
      const context = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(firstRun), ghOk(finalRun)] }
      });

      const result = await observe(fixture, { deps: context.deps });

      expect(result.proof.run).toEqual(allowedRunProjection(finalRun));
      expect(Object.keys(result.proof.run).sort()).toEqual([
        'conclusion', 'created_at', 'display_title', 'event', 'head_sha', 'html_url',
        'id', 'repository', 'run_attempt', 'status', 'updated_at', 'workflow_id'
      ]);
      expect(result.proof.run.repository).toEqual({ full_name: OWNER_REPO });
      expect(JSON.stringify(result.proof)).not.toContain(marker);
      expect(context.gh.calls.filter((call) => call.endpoint === runEndpoint(fixture))).toHaveLength(2);
      expect(context.gh.calls.filter((call) => call.endpoint === jobsEndpoint(fixture, 1))).toHaveLength(1);
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });

    test('retains the final updated_at after a valid timestamp change', async () => {
      const fixture = base();
      const finalUpdatedAt = '2026-01-02T02:45:00Z';
      const firstRun = runObject(fixture);
      const finalRun = runObject(fixture, { updated_at: finalUpdatedAt });
      const context = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(firstRun), ghOk(finalRun)] }
      });

      const result = await observe(fixture, { deps: context.deps });

      expect(result.proof.run.updated_at).toBe(finalUpdatedAt);
      expect(result.proof.run).toEqual(allowedRunProjection(finalRun));
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });

    test('refuses a final read with a changed run_attempt', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(runObject(fixture)), ghOk(runObject(fixture, { run_attempt: 2 }))] }
      });
      const error = expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(error.cause.reason).toBe('runAttempt');
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });

    test('refuses a final read with a changed head_sha', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(runObject(fixture)), ghOk(runObject(fixture, { head_sha: 'a'.repeat(40) }))] }
      });
      const error = expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(error.cause.reason).toBe('source');
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });

    test('refuses a final read with a changed workflow_id', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: { runs: [ghOk(runObject(fixture)), ghOk(runObject(fixture, { workflow_id: WORKFLOW_ID + 1 }))] }
      });
      const error = expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(error.cause.reason).toBe('workflowId');
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });

    test('refuses a final read with a changed repository.full_name', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          runs: [
            ghOk(runObject(fixture)),
            ghOk(runObject(fixture, { repository: { full_name: 'other-owner/other-repo' } }))
          ]
        }
      });
      const error = expectPublicationFailure(await capture(observe(fixture, { deps: context.deps })));
      expect(error.cause.reason).toBe('repository');
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.local.calls.length).toBeGreaterThan(0);
    });
  });

  describe('deadline and cancellation', () => {
    test('keeps one shared deadline so a later page cannot reset ninety seconds', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, { serve: false });
      context.gh.push(runEndpoint(fixture), () => {
        context.clock.advance(95000);
        return ghOk(runObject(fixture));
      });

      const error = await capture(observe(fixture, { deps: context.deps }));
      expect(error.kind).toBe('deadline');
      expect(context.gh.calls).toHaveLength(1);
      expect(context.fetch.calls).toHaveLength(0);
    });

    test('takes a transient retry only from the existing reader', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture, {
        serveOptions: {
          runs: [
            ghHttp(503, '<html>upstream exploded</html>', { 'retry-after': '1' }),
            ghOk(runObject(fixture)),
            ghOk(runObject(fixture))
          ]
        }
      });

      const result = await observe(fixture, { deps: context.deps });
      expect(result.proof.run).toEqual(runObject(fixture));
      expect(context.clock.sleeps).toEqual([1000]);
      expect(context.clock.events).toHaveLength(1);
      expect(context.clock.events[0]).toMatchObject({
        operation: 'github.run',
        attempt: 1,
        classification: 'transient',
        delayMs: 1000,
        retrying: true
      });
      expect(context.gh.calls.filter((call) => call.endpoint === runEndpoint(fixture))).toHaveLength(3);
    });

    test('attempts a permanent 404 or an unknown response exactly once', async () => {
      const fixture = base();
      const missing = observeDepsFor(fixture, { serve: false });
      missing.gh.push(runEndpoint(fixture), ghHttp(404, '{"message":"Not Found"}'));

      const httpError = await capture(observe(fixture, { deps: missing.deps }));
      expect(httpError.kind).toBe('http');
      expect(httpError.httpStatus).toBe(404);
      expect(httpError.attempts).toBe(1);
      expect(missing.gh.calls).toHaveLength(1);

      const unknown = observeDepsFor(fixture, { serve: false });
      unknown.gh.push(runEndpoint(fixture), { status: 1, signal: null, stdout: '', stderr: 'gh: could not resolve host' });

      const unknownError = await capture(observe(fixture, { deps: unknown.deps }));
      expect(unknownError.kind).toBe('unknown');
      expect(unknownError.attempts).toBe(1);
      expect(unknown.gh.calls).toHaveLength(1);
    });

    test('stops the remaining reads when the operator aborts', async () => {
      const fixture = base();
      const controller = new AbortController();
      const context = observeDepsFor(fixture, { serve: false, signal: controller.signal });
      context.gh.push(runEndpoint(fixture), () => {
        controller.abort();
        return ghOk(runObject(fixture));
      });

      const error = await capture(observe(fixture, { deps: context.deps }));
      expect(error.kind).toBe('operator-abort');
      expect(context.gh.calls).toHaveLength(1);
      expect(context.fetch.calls).toHaveLength(0);
    });
  });

  describe('verifyCurrentPublication', () => {
    test('verifies a saved historical pair and returns the original result', async () => {
      const fixture = base();
      const retained = writeRetained(fixture);
      const context = observeDepsFor(fixture);

      const result = await verify(fixture, retained.state, { deps: context.deps });
      const historical = readPublicationEvidence(
        { state: retained.state, repoDir: fixture.repoDir },
        { run: createLocalGitReader().run, fs }
      );
      expect(result).toEqual(historical);
      expect(result.verifiedAt).toBe(VERIFIED_AT);
      expect(result.runId).toBe(RUN_ID);
      expect(result.sourceSha).toBe(fixture.sourceSha);
    });

    test('tolerates whitespace and file order while preserving the retained bytes', async () => {
      const fixture = base();
      const retainedFiles = [NAMES[0], NAMES[1], NAMES[2], NAMES[3], NAMES[4]];
      const retainedBytes = Buffer.from(
        JSON.stringify(manifestFor(fixture.sourceSha, { files: retainedFiles }), null, 4),
        'utf8'
      );
      const retained = writeRetained(fixture, { manifestBytes: retainedBytes });
      const freshBytes = Buffer.from(
        `\n${JSON.stringify(manifestFor(fixture.sourceSha, { files: shuffledFiles() }))}\t`,
        'utf8'
      );
      const context = observeDepsFor(fixture, { serveOptions: { fetchResponse: streamResponse(freshBytes) } });
      const before = [fileStat(retained.paths.manifestFile), fileStat(retained.paths.proofFile)];

      const result = await verify(fixture, retained.state, { deps: context.deps });
      expect(result.verifiedAt).toBe(VERIFIED_AT);
      expect(result.manifest.files.slice().sort()).toEqual(retainedFiles.slice().sort());
      expect(result.manifest.sizes).toEqual(sizeMap());
      expect([fileStat(retained.paths.manifestFile), fileStat(retained.paths.proofFile)]).toEqual(before);
      expect(sha256(fs.readFileSync(retained.paths.manifestFile))).toBe(retained.digest);
    });

    test('refuses a conflicting size map, date or source', async () => {
      const fixture = base();
      const retained = writeRetained(fixture);

      const sizes = sizeMap();
      sizes[NAMES[0]] = sizes[NAMES[0]] + 1;
      const sizesContext = observeDepsFor(fixture, {
        serveOptions: { fetchResponse: streamResponse(Buffer.from(JSON.stringify(manifestFor(fixture.sourceSha, { sizes })), 'utf8')) }
      });
      expectPublicationFailure(await capture(verify(fixture, retained.state, { deps: sizesContext.deps })));

      const dateContext = observeDepsFor(fixture, {
        serveOptions: { fetchResponse: streamResponse(Buffer.from(JSON.stringify(manifestFor(fixture.sourceSha, { date: '2026-02-02T03:04:05.678Z' })), 'utf8')) }
      });
      expectPublicationFailure(await capture(verify(fixture, retained.state, { deps: dateContext.deps })));

      const sourceContext = observeDepsFor(fixture, {
        serveOptions: { fetchResponse: streamResponse(Buffer.from(JSON.stringify(manifestFor('b'.repeat(40))), 'utf8')) }
      });
      expectPublicationFailure(await capture(verify(fixture, retained.state, { deps: sourceContext.deps })));
    });

    test('refuses a changed upload job id', async () => {
      const fixture = base();
      const retained = writeRetained(fixture);
      const context = observeDepsFor(fixture, {
        serveOptions: {
          pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow({ id: 5001 })] } }]
        }
      });
      expectPublicationFailure(await capture(verify(fixture, retained.state, { deps: context.deps })));
    });
  });

  describe('purity', () => {
    test('creates no files, mutates no refs and leaves globals untouched', async () => {
      const fixture = base();
      const context = observeDepsFor(fixture);
      const refsBefore = git(fixture.checkout.root, ['for-each-ref', '--format=%(refname) %(objectname)']);
      const statusBefore = git(fixture.checkout.root, ['status', '--porcelain']);
      const filesBefore = snapshotDir(fixture.repoDir);
      const fetchBefore = globalThis.fetch;
      const spawnBefore = childProcess.spawnSync;

      const result = await observe(fixture, { deps: context.deps });
      expect(result.proof.manifestSha256).toBe(sha256(fixture.manifestBytes));

      expect(git(fixture.checkout.root, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(refsBefore);
      expect(git(fixture.checkout.root, ['status', '--porcelain'])).toBe(statusBefore);
      expect(snapshotDir(fixture.repoDir)).toEqual(filesBefore);
      expect(globalThis.fetch).toBe(fetchBefore);
      expect(childProcess.spawnSync).toBe(spawnBefore);
      expect(fs.existsSync(path.join(fixture.repoDir, 'state.json'))).toBe(false);
      expect(context.gh.calls.length).toBeGreaterThan(0);
      expect(context.fetch.calls).toHaveLength(1);
    });
  });
});
