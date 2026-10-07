'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { describePosix } = require('../helpers/platform');

const {
  discoverLegacyPublication, observePublication, persistPublication, reconcileLegacyFailure,
  reconcileLegacyRelease, reobserveFailedRelease, verifyCurrentPublication
} = require('../../scripts/release-publication-write');
const { readPublicationEvidence } = require('../../scripts/release-publication');
const { publicationAttemptDirectoryName } = require('../../scripts/release-publication-path');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { withReleaseLock } = require('../../scripts/release-lock');
const { resolveRepoIdentity } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { createReleaseState, transitionRelease } = require('../../scripts/release-transitions');
const { makeWorkflowAttempt } = require('../../scripts/release-workflow-identity');

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

const OWNER = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hc-publication-observe-'));
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
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `checkout-${++seq}-`)));
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
    commonDir: fs.realpathSync.native(path.join(root, '.git')),
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
  const dir = path.join(fixture.repoDir, 'records', RELEASE_ID, 'artifacts', publicationAttemptDirectoryName(fixture.attempt.id));
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
          '--hostname',
          'github.com',
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

  describePosix('verifyCurrentPublication', () => {
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

  describe('legacy publication discovery', () => {
    const OTHER_SHA = 'b'.repeat(40);

    function legacyBase(options = {}) {
      return base(Object.assign({ legacy: true }, options));
    }

    function runsPageEndpoint(page) {
      return `repos/${OWNER_REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100&page=${page}`;
    }

    function listedRow(fixture, patch = {}) {
      return runObject(fixture, Object.assign({ id: LEGACY_RUN_ID, run_attempt: LEGACY_RUN_ATTEMPT }, patch));
    }

    function serveRunPages(gh, pages) {
      for (const page of pages) {
        gh.push(runsPageEndpoint(page.page), ghOk({ total_count: page.total, workflow_runs: page.runs }));
      }
    }

    function serveCandidate(gh, fixture, options = {}) {
      const id = options.id === undefined ? LEGACY_RUN_ID : options.id;
      const attempt = options.attempt === undefined ? LEGACY_RUN_ATTEMPT : options.attempt;
      const listed = { runId: id, runAttempt: attempt };
      const run = options.run === undefined ? runObject(fixture, { id, run_attempt: attempt }) : options.run;
      gh.push(runEndpoint(listed), ghOk(run));
      const pages = options.pages === undefined
        ? [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow()] } }]
        : options.pages;
      for (const page of pages) gh.push(jobsEndpoint(listed, page.page), ghOk(page.body));
    }

    function discoveryDepsFor(fixture, options = {}) {
      const gh = options.gh === undefined ? ghRunner() : options.gh;
      const fetch = options.fetch === undefined ? fetchServer() : options.fetch;
      const local = options.local === undefined ? recordingLocalRun() : options.local;
      const clock = options.clock === undefined ? fakeClock() : options.clock;
      fetch.push(streamResponse(options.manifestBytes === undefined ? fixture.manifestBytes : options.manifestBytes));
      return {
        gh,
        fetch,
        local,
        clock,
        deps: observationDeps({ gh, fetch, localRun: local.run, clock, signal: options.signal })
      };
    }

    function discover(fixture, options = {}) {
      return discoverLegacyPublication(
        {
          identity: fixture.identity,
          workflowId: options.workflowId === undefined ? WORKFLOW_ID : options.workflowId,
          version: VERSION,
          repoDir: fixture.repoDir
        },
        options.deps,
        options.settings
      );
    }

    function expectLegacyUnresolved(error) {
      expect(error).toBeTruthy();
      expect(error.code).toBe('LEGACY_PUBLICATION_UNRESOLVED');
      expect(error.message.length).toBeGreaterThan(0);
      return error;
    }

    function expectNoWrites(fixture, before) {
      expect(snapshotDir(fixture.repoDir)).toEqual(before);
      expect(fs.existsSync(path.join(fixture.repoDir, 'state.json'))).toBe(false);
      expect(fs.existsSync(path.join(fixture.repoDir, 'records'))).toBe(false);
    }

    test('selects exactly one proven legacy upload and ignores unrelated rows', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      serveRunPages(context.gh, [{
        page: 1,
        total: 3,
        runs: [
          runObject(fixture, { id: 1001, head_sha: OTHER_SHA }),
          listedRow(fixture),
          listedRow(fixture, { id: 1002, run_attempt: 1, conclusion: 'skipped' })
        ]
      }]);
      serveCandidate(context.gh, fixture);
      const before = snapshotDir(fixture.repoDir);

      const result = await discover(fixture, { deps: context.deps });

      expect(result.manifestBytes.equals(fixture.manifestBytes)).toBe(true);
      expect(result.manifest).toEqual(fixture.manifestValue);
      expect(result.attempt).toEqual({
        id: `legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`,
        identityKind: 'legacy-upload-proof',
        version: VERSION,
        mode: 'publish',
        sourceSha: fixture.sourceSha,
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
        lastObservedAt: new Date(context.clock.wall).toISOString(),
        error: null,
        legacyProof: {
          uploadJobId: UPLOAD_JOB_ID,
          uploadJobConclusion: 'success',
          observedHeadSha: fixture.sourceSha,
          observedMode: 'publish'
        }
      });
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runsPageEndpoint(1),
        runEndpoint({ runId: LEGACY_RUN_ID }),
        jobsEndpoint({ runId: LEGACY_RUN_ID, runAttempt: LEGACY_RUN_ATTEMPT }, 1)
      ]);
      expect(context.gh.calls.filter((call) => call.endpoint === runEndpoint({ runId: LEGACY_RUN_ID }))).toHaveLength(1);
      expect(context.fetch.calls).toHaveLength(1);
      expect(context.fetch.calls[0].url).toBe(`${RELEASE_INFO_URL}?t=${context.clock.wall}`);
      const commands = context.local.calls.map((call) => call.args.join(' '));
      expect(commands).toContain('rev-parse HEAD');
      expect(commands).toContain(`rev-parse --verify ${fixture.sourceSha}^{commit}`);
      expect(commands.some((command) => command.startsWith('cat-file blob '))).toBe(true);
      for (const call of context.local.calls) {
        expect(call.file).toBe('git');
        expect(['push', 'commit', 'tag', 'fetch', 'update-ref', 'add', 'reset']).not.toContain(call.args[0]);
      }
      expectNoWrites(fixture, before);
    });

    test('reports no qualifying legacy publication as unresolved', async () => {
      const fixture = legacyBase();

      const empty = discoveryDepsFor(fixture);
      serveRunPages(empty.gh, [{ page: 1, total: 0, runs: [] }]);
      const emptyError = expectLegacyUnresolved(await capture(discover(fixture, { deps: empty.deps })));
      expect(emptyError.message).toContain('observed 0');
      expect(empty.gh.calls.map((call) => call.endpoint)).toEqual([runsPageEndpoint(1)]);
      expect(empty.fetch.calls).toHaveLength(1);

      const failed = discoveryDepsFor(fixture);
      serveRunPages(failed.gh, [{
        page: 1,
        total: 1,
        runs: [listedRow(fixture, { conclusion: 'failure' })]
      }]);
      const failedError = expectLegacyUnresolved(await capture(discover(fixture, { deps: failed.deps })));
      expect(failedError.message).toContain('observed 0');
      expect(failed.gh.calls).toHaveLength(1);

      const skipped = discoveryDepsFor(fixture);
      serveRunPages(skipped.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
      serveCandidate(skipped.gh, fixture, {
        pages: [{ page: 1, body: { total_count: 1, jobs: [uploadRow({ conclusion: 'skipped' })] } }]
      });
      const skippedError = expectLegacyUnresolved(await capture(discover(fixture, { deps: skipped.deps })));
      expect(skippedError.message).toContain('observed 0');
      expect(skipped.gh.calls.map((call) => call.endpoint)).toEqual([
        runsPageEndpoint(1),
        runEndpoint({ runId: LEGACY_RUN_ID }),
        jobsEndpoint({ runId: LEGACY_RUN_ID, runAttempt: LEGACY_RUN_ATTEMPT }, 1)
      ]);
    });

    test('reports two qualifying successes as ambiguous', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      serveRunPages(context.gh, [{
        page: 1,
        total: 2,
        runs: [listedRow(fixture), listedRow(fixture, { id: 790 })]
      }]);
      serveCandidate(context.gh, fixture);
      serveCandidate(context.gh, fixture, { id: 790 });
      const before = snapshotDir(fixture.repoDir);

      const error = expectLegacyUnresolved(await capture(discover(fixture, { deps: context.deps })));

      expect(error.message).toContain('observed 2');
      expect(context.gh.calls.filter((call) => call.endpoint === runEndpoint({ runId: LEGACY_RUN_ID }))).toHaveLength(1);
      expect(context.gh.calls.filter((call) => call.endpoint === runEndpoint({ runId: 790 }))).toHaveLength(1);
      expectNoWrites(fixture, before);
    });

    test('reports a running or modern same-source workflow as unresolved', async () => {
      const fixture = legacyBase();

      const running = discoveryDepsFor(fixture);
      serveRunPages(running.gh, [{
        page: 1,
        total: 1,
        runs: [listedRow(fixture, { status: 'in_progress', conclusion: null })]
      }]);
      expectLegacyUnresolved(await capture(discover(fixture, { deps: running.deps })));
      expect(running.gh.calls.map((call) => call.endpoint)).toEqual([runsPageEndpoint(1)]);

      const modern = discoveryDepsFor(fixture);
      serveRunPages(modern.gh, [{
        page: 1,
        total: 1,
        runs: [listedRow(fixture, { display_title: `${fixture.title} attempt=${ATTEMPT_ID}` })]
      }]);
      expectLegacyUnresolved(await capture(discover(fixture, { deps: modern.deps })));
      expect(modern.gh.calls.map((call) => call.endpoint)).toEqual([runsPageEndpoint(1)]);
    });

    test('refuses a direct run that drifts from the listed attempt', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      serveRunPages(context.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
      serveCandidate(context.gh, fixture, {
        run: runObject(fixture, { id: LEGACY_RUN_ID, run_attempt: LEGACY_RUN_ATTEMPT + 1 })
      });
      const before = snapshotDir(fixture.repoDir);

      const error = expectPublicationFailure(await capture(discover(fixture, { deps: context.deps })));

      expect(error.cause.reason).toBe('runAttempt');
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runsPageEndpoint(1),
        runEndpoint({ runId: LEGACY_RUN_ID })
      ]);
      expectNoWrites(fixture, before);
    });

    test('refuses a selected direct run contradicting repository, workflow, event or source', async () => {
      const cases = [
        { patch: { repository: { full_name: 'other-owner/other-repo' } }, reason: 'repository' },
        { patch: { workflow_id: WORKFLOW_ID + 1 }, reason: 'workflowId' },
        { patch: { event: 'push' }, reason: 'event' },
        { patch: { head_sha: 'c'.repeat(40) }, reason: 'source' }
      ];
      for (const row of cases) {
        const fixture = legacyBase();
        const context = discoveryDepsFor(fixture);
        serveRunPages(context.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
        serveCandidate(context.gh, fixture, {
          run: runObject(
            fixture,
            Object.assign({ id: LEGACY_RUN_ID, run_attempt: LEGACY_RUN_ATTEMPT }, row.patch)
          )
        });
        const error = expectPublicationFailure(await capture(discover(fixture, { deps: context.deps })));
        expect(error.cause.reason).toBe(row.reason);
        expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
          runsPageEndpoint(1),
          runEndpoint({ runId: LEGACY_RUN_ID })
        ]);
      }
    });

    test('refuses a workflow page count above the bounded total', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      serveRunPages(context.gh, [{ page: 1, total: 10001, runs: [] }]);
      const before = snapshotDir(fixture.repoDir);

      expectPublicationFailure(await capture(discover(fixture, { deps: context.deps })));

      expect(context.gh.calls).toHaveLength(1);
      expectNoWrites(fixture, before);
    });

    test('refuses incomplete, over-declared and repeated workflow pages', async () => {
      const fixture = legacyBase();

      const short = discoveryDepsFor(fixture);
      serveRunPages(short.gh, [{
        page: 1,
        total: 5,
        runs: [listedRow(fixture, { id: 3001 }), listedRow(fixture, { id: 3002 }), listedRow(fixture, { id: 3003 })]
      }]);
      expectPublicationFailure(await capture(discover(fixture, { deps: short.deps })));
      expect(short.gh.calls).toHaveLength(1);

      const excess = discoveryDepsFor(fixture);
      serveRunPages(excess.gh, [{
        page: 1,
        total: 1,
        runs: [listedRow(fixture, { id: 3001 }), listedRow(fixture, { id: 3002 })]
      }]);
      expectPublicationFailure(await capture(discover(fixture, { deps: excess.deps })));
      expect(excess.gh.calls).toHaveLength(1);

      const repeated = discoveryDepsFor(fixture);
      serveRunPages(repeated.gh, [{ page: 1, total: 2, runs: [listedRow(fixture), listedRow(fixture)] }]);
      expectPublicationFailure(await capture(discover(fixture, { deps: repeated.deps })));
      expect(repeated.gh.calls).toHaveLength(1);
    });

    test('refuses a changed page total after a complete first page', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      const filler = Array.from({ length: 100 }, (value, index) => runObject(fixture, { id: 2000 + index, head_sha: OTHER_SHA }));
      serveRunPages(context.gh, [
        { page: 1, total: 101, runs: filler },
        { page: 2, total: 102, runs: [listedRow(fixture)] }
      ]);
      const before = snapshotDir(fixture.repoDir);

      expectPublicationFailure(await capture(discover(fixture, { deps: context.deps })));

      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([runsPageEndpoint(1), runsPageEndpoint(2)]);
      expectNoWrites(fixture, before);
    });

    test('reads a second page after an exact hundred-row first page', async () => {
      const fixture = legacyBase();
      const context = discoveryDepsFor(fixture);
      const filler = Array.from({ length: 100 }, (value, index) => runObject(fixture, { id: 2000 + index, head_sha: OTHER_SHA }));
      serveRunPages(context.gh, [
        { page: 1, total: 101, runs: filler },
        { page: 2, total: 101, runs: [listedRow(fixture)] }
      ]);
      serveCandidate(context.gh, fixture);

      const result = await discover(fixture, { deps: context.deps });

      expect(result.attempt.runId).toBe(LEGACY_RUN_ID);
      expect(result.attempt.runAttempt).toBe(LEGACY_RUN_ATTEMPT);
      expect(result.attempt.legacyProof.uploadJobId).toBe(UPLOAD_JOB_ID);
      expect(context.gh.calls.map((call) => call.endpoint)).toEqual([
        runsPageEndpoint(1),
        runsPageEndpoint(2),
        runEndpoint({ runId: LEGACY_RUN_ID }),
        jobsEndpoint({ runId: LEGACY_RUN_ID, runAttempt: LEGACY_RUN_ATTEMPT }, 1)
      ]);
    });

    test('validates every job row beside a successful upload', async () => {
      const fixture = legacyBase();

      const contradictory = discoveryDepsFor(fixture);
      serveRunPages(contradictory.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
      serveCandidate(contradictory.gh, fixture, {
        pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow({ run_id: 9999 }), uploadRow()] } }]
      });
      expectPublicationFailure(await capture(discover(fixture, { deps: contradictory.deps })));

      const malformed = discoveryDepsFor(fixture);
      serveRunPages(malformed.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
      serveCandidate(malformed.gh, fixture, {
        pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow({ conclusion: 'exploded' }), uploadRow()] } }]
      });
      expectPublicationFailure(await capture(discover(fixture, { deps: malformed.deps })));

      const absent = discoveryDepsFor(fixture);
      serveRunPages(absent.gh, [{ page: 1, total: 1, runs: [listedRow(fixture)] }]);
      serveCandidate(absent.gh, fixture, {
        pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow(), buildRow({ id: 5002 })] } }]
      });
      const absentError = expectLegacyUnresolved(await capture(discover(fixture, { deps: absent.deps })));
      expect(absentError.message).toContain('observed 0');
    });

    test('refuses a manifest for another version, source format or installer set before run discovery', async () => {
      const wrongVersion = legacyBase({ manifest: { version: '1.27.0' } });
      const versionContext = discoveryDepsFor(wrongVersion);
      expectPublicationFailure(await capture(discover(wrongVersion, { deps: versionContext.deps })));
      expect(versionContext.gh.calls).toHaveLength(0);
      expect(versionContext.fetch.calls).toHaveLength(1);

      const wrongFormat = legacyBase({ manifest: { commit: 'a'.repeat(64) } });
      const formatContext = discoveryDepsFor(wrongFormat);
      expectPublicationFailure(await capture(discover(wrongFormat, { deps: formatContext.deps })));
      expect(formatContext.gh.calls).toHaveLength(0);

      const sizes = sizeMap();
      delete sizes[NAMES[0]];
      const wrongSizes = legacyBase({ manifest: { sizes } });
      const sizesContext = discoveryDepsFor(wrongSizes);
      expectPublicationFailure(await capture(discover(wrongSizes, { deps: sizesContext.deps })));
      expect(sizesContext.gh.calls).toHaveLength(0);

      const malformedBytes = legacyBase({ manifestBytes: Buffer.from('{ not json', 'utf8') });
      const malformedContext = discoveryDepsFor(malformedBytes);
      const malformedError = await capture(discover(malformedBytes, { deps: malformedContext.deps }));
      expect(malformedError.kind).toBe('invalid-json');
      expect(malformedError.attempts).toBe(1);
      expect(malformedContext.gh.calls).toHaveLength(0);

      const notAManifest = legacyBase({ manifestBytes: Buffer.from('[]', 'utf8') });
      const recordContext = discoveryDepsFor(notAManifest);
      expectPublicationFailure(await capture(discover(notAManifest, { deps: recordContext.deps })));
      expect(recordContext.gh.calls).toHaveLength(0);
    });

    test('refuses provider denial, exhausted retries, abort and a missing local source without writing', async () => {
      const fixture = legacyBase();
      const before = snapshotDir(fixture.repoDir);

      const denied = discoveryDepsFor(fixture);
      denied.gh.push(runsPageEndpoint(1), ghHttp(404, '{"message":"Not Found"}'));
      const deniedError = await capture(discover(fixture, { deps: denied.deps }));
      expect(deniedError.kind).toBe('http');
      expect(deniedError.httpStatus).toBe(404);
      expect(deniedError.attempts).toBe(1);
      expect(denied.gh.calls).toHaveLength(1);

      const retried = discoveryDepsFor(fixture);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        retried.gh.push(runsPageEndpoint(1), ghHttp(503, '<html>upstream exploded</html>', { 'retry-after': '1' }));
      }
      const retriedError = await capture(discover(fixture, { deps: retried.deps }));
      expect(retriedError.kind).toBe('http');
      expect(retriedError.httpStatus).toBe(503);
      expect(retriedError.attempts).toBe(3);
      expect(retried.clock.sleeps).toEqual([1000, 3000]);
      expect(retried.gh.calls).toHaveLength(3);

      const controller = new AbortController();
      const aborted = discoveryDepsFor(fixture, { signal: controller.signal });
      aborted.gh.push(runsPageEndpoint(1), () => {
        controller.abort();
        return ghOk({ total_count: 1, workflow_runs: [listedRow(fixture)] });
      });
      const abortError = await capture(discover(fixture, { deps: aborted.deps }));
      expect(abortError.kind).toBe('operator-abort');
      expect(aborted.gh.calls).toHaveLength(1);

      const missing = legacyBase({ manifest: { commit: 'f'.repeat(40) } });
      const missingBefore = snapshotDir(missing.repoDir);
      const missingContext = discoveryDepsFor(missing);
      const missingError = expectPublicationFailure(await capture(discover(missing, { deps: missingContext.deps })));
      expect(missingError.cause).toBeTruthy();
      expect(missingContext.gh.calls).toHaveLength(0);
      expect(missingContext.fetch.calls).toHaveLength(1);

      expectNoWrites(fixture, before);
      expectNoWrites(missing, missingBefore);
    });

    test('refuses an absent or contradictory legacy request identity before any provider read', async () => {
      const fixture = legacyBase();
      const before = snapshotDir(fixture.repoDir);

      const noWorkflow = discoveryDepsFor(fixture);
      expectPublicationFailure(
        await capture(discover(fixture, { deps: noWorkflow.deps, workflowId: 0 }))
      );
      expect(noWorkflow.gh.calls).toHaveLength(0);
      expect(noWorkflow.fetch.calls).toHaveLength(0);

      const noInput = discoveryDepsFor(fixture);
      expectPublicationFailure(await capture(discoverLegacyPublication(null, noInput.deps)));
      expect(noInput.gh.calls).toHaveLength(0);
      expect(noInput.fetch.calls).toHaveLength(0);

      const otherRepoDir = discoveryDepsFor(fixture);
      expectPublicationFailure(await capture(discoverLegacyPublication({
        identity: fixture.identity,
        workflowId: WORKFLOW_ID,
        version: VERSION,
        repoDir: path.join(fixture.repoDir, 'nested')
      }, otherRepoDir.deps)));
      expect(otherRepoDir.gh.calls).toHaveLength(0);
      expect(otherRepoDir.fetch.calls).toHaveLength(0);

      expectNoWrites(fixture, before);
    });
  });

  describePosix('legacy publication import native', () => {
    const DEFINITION_ENDPOINT = `repos/${OWNER_REPO}/actions/workflows/release.yml`;
    const IMPORT_RELEASE_ID = 'a1b2c3d4-1111-4222-8333-444455556666';
    const OTHER_RELEASE_ID = 'b2c3d4e5-2222-4333-8444-555566667777';
    const SKIPPED_RUN_ID = 790;
    const LEGACY_ATTEMPT_ID = `legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`;

    function cacheRootFor(fixture) {
      return path.dirname(fixture.repoDir);
    }

    function runsPageEndpoint(page) {
      return `repos/${OWNER_REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100&page=${page}`;
    }

    function definitionResponse(patch = {}) {
      return ghOk(Object.assign(
        { id: WORKFLOW_ID, path: '.github/workflows/release.yml', name: 'release' },
        patch
      ));
    }

    function listedRow(fixture, patch = {}) {
      return runObject(fixture, Object.assign({ id: LEGACY_RUN_ID, run_attempt: LEGACY_RUN_ATTEMPT }, patch));
    }

    function listed(id, attempt) {
      return { runId: id, runAttempt: attempt };
    }

    function importPaths(fixture) {
      const attemptDir = path.join(
        fixture.repoDir, 'records', IMPORT_RELEASE_ID, 'artifacts',
        publicationAttemptDirectoryName(LEGACY_ATTEMPT_ID)
      );
      return {
        repoDir: fixture.repoDir,
        stateFile: path.join(fixture.repoDir, 'state.json'),
        recordsDir: path.join(fixture.repoDir, 'records'),
        attemptDir,
        manifestFile: path.join(attemptDir, 'release-info.json'),
        proofFile: path.join(attemptDir, 'publication.json')
      };
    }

    function serveCandidate(gh, fixture, options = {}) {
      const id = options.id === undefined ? LEGACY_RUN_ID : options.id;
      const attempt = options.attempt === undefined ? LEGACY_RUN_ATTEMPT : options.attempt;
      const request = listed(id, attempt);
      gh.push(runEndpoint(request), options.run === undefined
        ? ghOk(runObject(fixture, { id, run_attempt: attempt }))
        : options.run);
      const pages = options.pages === undefined
        ? [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow()] } }]
        : options.pages;
      for (const page of pages) gh.push(jobsEndpoint(request, page.page), ghOk(page.body));
    }

    function serveObservation(gh, fetch, fixture, options = {}) {
      const request = listed(
        options.id === undefined ? LEGACY_RUN_ID : options.id,
        options.attempt === undefined ? LEGACY_RUN_ATTEMPT : options.attempt
      );
      const runs = options.runs === undefined
        ? [
          ghOk(runObject(fixture, { id: request.runId, run_attempt: request.runAttempt })),
          ghOk(runObject(fixture, { id: request.runId, run_attempt: request.runAttempt }))
        ]
        : options.runs;
      for (const run of runs) gh.push(runEndpoint(request), run);
      if (options.pages !== false) {
        const pages = options.pages === undefined
          ? [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow()] } }]
          : options.pages;
        for (const page of pages) gh.push(jobsEndpoint(request, page.page), ghOk(page.body));
      }
      if (options.fetch !== false) {
        fetch.push(options.fetchResponse === undefined
          ? streamResponse(fixture.manifestBytes)
          : options.fetchResponse);
      }
    }

    function serveImport(context, fixture, options = {}) {
      context.gh.push(DEFINITION_ENDPOINT, options.definition === undefined
        ? definitionResponse()
        : options.definition);
      context.fetch.push(streamResponse(options.manifestBytes === undefined
        ? fixture.manifestBytes
        : options.manifestBytes));
      const listing = options.listing === undefined ? [listedRow(fixture)] : options.listing;
      context.gh.push(runsPageEndpoint(1), ghOk({
        total_count: options.total === undefined ? listing.length : options.total,
        workflow_runs: listing
      }));
      serveCandidate(context.gh, fixture, options.candidate);
      serveObservation(context.gh, context.fetch, fixture, options.observation);
    }

    function importContext(fixture, options = {}) {
      const gh = options.gh === undefined ? ghRunner() : options.gh;
      const fetch = options.fetch === undefined ? fetchServer() : options.fetch;
      const local = options.local === undefined ? recordingLocalRun() : options.local;
      const clock = options.clock === undefined ? fakeClock() : options.clock;
      const deps = observationDeps({ gh, fetch, localRun: local.run, clock, signal: options.signal });
      deps.local.fs = options.io === undefined ? fs : options.io;
      deps.randomUUID = options.randomUUID === undefined ? () => IMPORT_RELEASE_ID : options.randomUUID;
      return { gh, fetch, local, clock, deps };
    }

    function runImport(fixture, context, options = {}) {
      return withReleaseLock(fixture.identity, async () => reconcileLegacyRelease({
        identity: fixture.identity,
        repoDir: fixture.repoDir,
        currentVersion: VERSION
      }, context.deps, options.settings), { cacheRoot: cacheRootFor(fixture) });
    }

    function storedState(fixture) {
      return readReleaseState(fixture.identity, { cacheRoot: cacheRootFor(fixture), fs });
    }

    function resumeBoundRelease(fixture, context) {
      const state = storedState(fixture);
      return withReleaseLock(fixture.identity, async () => {
        const observation = await observePublication({ state, repoDir: fixture.repoDir }, context.deps);
        return persistPublication({ state, repoDir: fixture.repoDir, observation }, context.deps);
      }, { cacheRoot: cacheRootFor(fixture) });
    }

    function faultIo(hooks = {}) {
      const events = [];
      const opened = new Map();
      const io = {
        ...fs,
        openSync(target, flags, mode) {
          const fd = fs.openSync(target, flags, mode);
          opened.set(fd, { target, flags });
          events.push({ op: 'open', target, flags });
          return fd;
        },
        closeSync(fd) {
          const entry = opened.get(fd);
          events.push({ op: 'close', target: entry === undefined ? null : entry.target });
          try {
            return fs.closeSync(fd);
          } finally {
            opened.delete(fd);
          }
        },
        mkdirSync(target, mode) {
          events.push({ op: 'mkdir', target });
          return fs.mkdirSync(target, mode);
        },
        renameSync(from, to) {
          const payload = fs.readFileSync(from);
          events.push({ op: 'rename', from, to, payload });
          if (hooks.rename !== undefined && hooks.rename({ from, to, events, payload }) === true) {
            throw new Error('injected rename failure');
          }
          return fs.renameSync(from, to);
        },
        fsyncSync(fd) {
          const entry = opened.get(fd);
          const directory = fs.fstatSync(fd).isDirectory();
          const event = {
            op: 'fsync',
            target: entry === undefined ? null : entry.target,
            flags: entry === undefined ? null : entry.flags,
            directory
          };
          events.push(event);
          if (hooks.fsync !== undefined && hooks.fsync(event) === true) {
            throw new Error('injected fsync failure');
          }
          return fs.fsyncSync(fd);
        }
      };
      return { io, events };
    }

    function renameTargets(faults) {
      return faults.events.filter((event) => event.op === 'rename').map((event) => event.to);
    }

    function expectNoLane(fixture, paths) {
      expect(fs.existsSync(paths.stateFile)).toBe(false);
      expect(storedState(fixture)).toBeNull();
      expect(fs.existsSync(paths.recordsDir)).toBe(false);
    }

    test('imports a reconfirmed legacy publication and keeps its historical source', async () => {
      const fixture = base({ legacy: true });
      const sourceSha = fixture.checkout.sourceSha;
      const sourcePackage = git(fixture.checkout.root, ['cat-file', 'blob', `${sourceSha}:package.json`]);
      const workingPackage = fs.readFileSync(path.join(fixture.checkout.root, 'package.json'));
      fs.writeFileSync(path.join(fixture.checkout.root, 'README.md'), 'hyperclay local later work\n');
      git(fixture.checkout.root, ['add', '-A']);
      git(fixture.checkout.root, ['commit', '-q', '-m', 'later work']);
      const headSha = git(fixture.checkout.root, ['rev-parse', 'HEAD']).trim();
      expect(headSha).not.toBe(sourceSha);
      fs.writeFileSync(path.join(fixture.checkout.root, '.deploy'), `${headSha}\n`);
      const deployBytes = fs.readFileSync(path.join(fixture.checkout.root, '.deploy'));
      const paths = importPaths(fixture);
      const faults = faultIo();
      const context = importContext(fixture, { io: faults.io });
      serveImport(context, fixture, {
        total: 2,
        listing: [
          listedRow(fixture),
          runObject(fixture, { id: SKIPPED_RUN_ID, run_attempt: 1 })
        ]
      });
      serveCandidate(context.gh, fixture, {
        id: SKIPPED_RUN_ID,
        attempt: 1,
        pages: [{ page: 1, body: { total_count: 2, jobs: [buildRow(), uploadRow({ conclusion: 'skipped' })] } }]
      });
      serveObservation(context.gh, context.fetch, fixture);
      const refsBefore = git(fixture.checkout.root, ['for-each-ref', '--format=%(refname) %(objectname)']);
      const statusBefore = git(fixture.checkout.root, ['status', '--porcelain']);

      const result = await runImport(fixture, context);

      expect(result.outcome).toBe('imported-publish');
      expect(result.error).toBeNull();
      const state = result.state;
      expect(state.revision).toBe(1);
      expect(state.phase).toBe('tail');
      expect(state.releaseId).toBe(IMPORT_RELEASE_ID);
      expect(state.version).toBe(VERSION);
      expect(state.sourceSha).toBe(sourceSha);
      expect(state.activeAttemptId).toBe(LEGACY_ATTEMPT_ID);
      expect(state.attempts).toHaveLength(1);
      expect(state.attempts[0].id).toBe(LEGACY_ATTEMPT_ID);
      expect(state.attempts[0].runId).toBe(LEGACY_RUN_ID);
      expect(state.attempts[0].runAttempt).toBe(LEGACY_RUN_ATTEMPT);
      expect(state.attempts[0].legacyProof).toEqual({
        uploadJobId: UPLOAD_JOB_ID,
        uploadJobConclusion: 'success',
        observedHeadSha: sourceSha,
        observedMode: 'publish'
      });
      expect(state.artifacts.state).toBe('complete');
      expect(state.artifacts.sourceSha).toBe(sourceSha);
      expect(state.artifacts.runId).toBe(LEGACY_RUN_ID);
      expect(state.artifacts.manifestFile).toBe(paths.manifestFile);
      expect(state.artifacts.manifestSha256).toBe(sha256(fixture.manifestBytes));
      expect(state.sizes).toEqual(pendingTarget());
      expect(state.site.state).toBe('pending');
      expect(state.docs).toEqual({ hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() });
      expect(state.install).toEqual({ state: 'not-attempted', error: null });
      expect(storedState(fixture)).toEqual(state);

      const endpoints = context.gh.calls.map((call) => call.endpoint);
      const candidateReads = endpoints.filter((endpoint) => /\/actions\/runs\/[0-9]+$/.test(endpoint));
      const candidateCount = new Set(candidateReads).size;
      const qualifyingCount = state.attempts.filter(
        (attempt) => attempt.identityKind === 'legacy-upload-proof'
      ).length;
      expect(candidateCount).toBe(2);
      expect(qualifyingCount).toBe(1);
      expect(endpoints).toEqual([
        DEFINITION_ENDPOINT,
        runsPageEndpoint(1),
        runEndpoint(listed(LEGACY_RUN_ID, LEGACY_RUN_ATTEMPT)),
        jobsEndpoint(listed(LEGACY_RUN_ID, LEGACY_RUN_ATTEMPT), 1),
        runEndpoint(listed(SKIPPED_RUN_ID, 1)),
        jobsEndpoint(listed(SKIPPED_RUN_ID, 1), 1),
        runEndpoint(listed(LEGACY_RUN_ID, LEGACY_RUN_ATTEMPT)),
        jobsEndpoint(listed(LEGACY_RUN_ID, LEGACY_RUN_ATTEMPT), 1),
        runEndpoint(listed(LEGACY_RUN_ID, LEGACY_RUN_ATTEMPT))
      ]);
      expect(context.fetch.calls).toHaveLength(2);
      for (const call of context.gh.calls) {
        expect(call.file).toBe('gh');
        expect(call.args).toContain('GET');
        expect(call.args).not.toContain('POST');
      }
      for (const call of context.local.calls) {
        expect(call.file).toBe('git');
        expect(['push', 'tag', 'fetch', 'commit', 'add', 'reset', 'update-ref', 'checkout', 'branch'])
          .not.toContain(call.args[0]);
      }

      expect(renameTargets(faults)).toEqual([
        paths.stateFile,
        paths.manifestFile,
        paths.proofFile,
        paths.stateFile
      ]);
      const renames = faults.events.filter((event) => event.op === 'rename');
      const initial = JSON.parse(renames[0].payload.toString('utf8'));
      expect(initial.revision).toBe(0);
      expect(initial.phase).toBe('workflow');
      expect(initial.releaseId).toBe(IMPORT_RELEASE_ID);
      const complete = JSON.parse(renames[3].payload.toString('utf8'));
      expect(complete.revision).toBe(1);
      expect(complete.phase).toBe('tail');
      expect(fs.readFileSync(paths.manifestFile).equals(fixture.manifestBytes)).toBe(true);
      const evidence = readPublicationEvidence(
        { state, repoDir: fixture.repoDir },
        { run: context.local.run, fs }
      );
      expect(evidence.sourceSha).toBe(sourceSha);
      expect(evidence.runId).toBe(LEGACY_RUN_ID);
      expect(evidence.manifest).toEqual(fixture.manifestValue);

      expect(git(fixture.checkout.root, ['rev-parse', 'HEAD']).trim()).toBe(headSha);
      expect(git(fixture.checkout.root, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(refsBefore);
      expect(git(fixture.checkout.root, ['status', '--porcelain'])).toBe(statusBefore);
      expect(git(fixture.checkout.root, ['cat-file', 'blob', `${sourceSha}:package.json`])).toBe(sourcePackage);
      expect(fs.readFileSync(path.join(fixture.checkout.root, 'package.json'))).toEqual(workingPackage);
      expect(fs.readFileSync(path.join(fixture.checkout.root, '.deploy'))).toEqual(deployBytes);
    });

    test('refuses an interrupted initial lane write and recovers the visible state', async () => {
      const rows = [
        {
          label: 'before rename',
          hooks: (paths) => ({ rename: (event) => event.to === paths.stateFile }),
          visible: false
        },
        {
          label: 'after rename before fsync',
          hooks: (paths) => ({ fsync: (event) => event.directory && event.target === paths.repoDir }),
          visible: true
        }
      ];
      for (const row of rows) {
        const fixture = base({ legacy: true });
        const paths = importPaths(fixture);
        const faults = faultIo(row.hooks(paths));
        const context = importContext(fixture, { io: faults.io });
        serveImport(context, fixture);

        const error = await capture(runImport(fixture, context));

        expect(row.label).toBeTruthy();
        expect(error.code).toBe('STATE_IO_FAILED');
        expect(renameTargets(faults)).toEqual([paths.stateFile]);
        expect(fs.existsSync(paths.recordsDir)).toBe(false);
        expect(fs.existsSync(paths.manifestFile)).toBe(false);
        expect(fs.existsSync(paths.proofFile)).toBe(false);

        if (!row.visible) {
          expectNoLane(fixture, paths);
          continue;
        }

        expect(fs.existsSync(paths.stateFile)).toBe(true);
        const visible = storedState(fixture);
        expect(visible.revision).toBe(0);
        expect(visible.phase).toBe('workflow');
        expect(visible.releaseId).toBe(IMPORT_RELEASE_ID);
        expect(visible.activeAttemptId).toBe(LEGACY_ATTEMPT_ID);
        expect(visible.attempts).toHaveLength(1);
        expect(visible.attempts[0].runAttempt).toBe(LEGACY_RUN_ATTEMPT);

        const recovery = importContext(fixture);
        serveObservation(recovery.gh, recovery.fetch, fixture);

        const persisted = await resumeBoundRelease(fixture, recovery);

        expect(persisted.revision).toBe(1);
        expect(persisted.phase).toBe('tail');
        expect(persisted.releaseId).toBe(IMPORT_RELEASE_ID);
        expect(persisted.activeAttemptId).toBe(LEGACY_ATTEMPT_ID);
        expect(persisted.attempts).toHaveLength(1);
        expect(persisted.attempts[0].id).toBe(LEGACY_ATTEMPT_ID);
        expect(persisted.attempts[0].runAttempt).toBe(LEGACY_RUN_ATTEMPT);
        expect(persisted.attempts[0].legacyProof.uploadJobId).toBe(UPLOAD_JOB_ID);
        const endpoints = recovery.gh.calls.map((call) => call.endpoint);
        expect(endpoints).not.toContain(DEFINITION_ENDPOINT);
        expect(endpoints.every((endpoint) => !endpoint.includes('/runs?'))).toBe(true);
        expect(renameTargets(faults)).toEqual([paths.stateFile]);
        const evidence = readPublicationEvidence(
          { state: storedState(fixture), repoDir: fixture.repoDir },
          { run: recovery.local.run, fs }
        );
        expect(evidence.sourceSha).toBe(fixture.checkout.sourceSha);
        expect(evidence.runId).toBe(LEGACY_RUN_ID);
      }
    });

    test('keeps the initial lane when publication persistence fails and resumes it', async () => {
      const fixture = base({ legacy: true });
      const paths = importPaths(fixture);
      const faults = faultIo({ rename: ({ to }) => to === paths.proofFile });
      const context = importContext(fixture, { io: faults.io });
      serveImport(context, fixture);

      const error = await capture(runImport(fixture, context));

      expectPublicationFailure(error);
      expect(error.cause.code).toBe('STATE_IO_FAILED');
      const initial = storedState(fixture);
      expect(initial.revision).toBe(0);
      expect(initial.phase).toBe('workflow');
      expect(initial.releaseId).toBe(IMPORT_RELEASE_ID);
      expect(initial.activeAttemptId).toBe(LEGACY_ATTEMPT_ID);
      expect(initial.attempts[0].runAttempt).toBe(LEGACY_RUN_ATTEMPT);
      expect(initial.sizes).toEqual(pendingTarget());
      expect(initial.site.state).toBe('pending');
      expect(initial.install.state).toBe('not-attempted');
      expect(fs.existsSync(paths.manifestFile)).toBe(true);
      expect(fs.existsSync(paths.proofFile)).toBe(false);
      const retainedBytes = fs.readFileSync(paths.manifestFile);
      expect(retainedBytes.equals(fixture.manifestBytes)).toBe(true);

      const recovery = importContext(fixture);
      serveObservation(recovery.gh, recovery.fetch, fixture);

      const persisted = await resumeBoundRelease(fixture, recovery);

      expect(persisted.revision).toBe(1);
      expect(persisted.phase).toBe('tail');
      expect(persisted.releaseId).toBe(IMPORT_RELEASE_ID);
      expect(persisted.activeAttemptId).toBe(LEGACY_ATTEMPT_ID);
      expect(persisted.attempts[0].id).toBe(LEGACY_ATTEMPT_ID);
      expect(fs.readdirSync(paths.recordsDir)).toEqual([IMPORT_RELEASE_ID]);
      expect(fs.readFileSync(paths.manifestFile).equals(retainedBytes)).toBe(true);
      expect(fs.existsSync(paths.proofFile)).toBe(true);
      const endpoints = recovery.gh.calls.map((call) => call.endpoint);
      expect(endpoints).not.toContain(DEFINITION_ENDPOINT);
      expect(endpoints.every((endpoint) => !endpoint.includes('/runs?'))).toBe(true);
      const evidence = readPublicationEvidence(
        { state: storedState(fixture), repoDir: fixture.repoDir },
        { run: recovery.local.run, fs }
      );
      expect(evidence.sourceSha).toBe(fixture.checkout.sourceSha);
      expect(evidence.runId).toBe(LEGACY_RUN_ID);
      expect(evidence.manifest).toEqual(fixture.manifestValue);
    });

    test('writes no lane when confirmation or the final read refuses', async () => {
      const drift = base({ legacy: true });
      const driftPaths = importPaths(drift);
      const driftContext = importContext(drift);
      serveImport(driftContext, drift, {
        observation: {
          runs: [ghOk(runObject(drift, { id: LEGACY_RUN_ID, run_attempt: LEGACY_RUN_ATTEMPT + 1 }))],
          pages: false,
          fetch: false
        }
      });
      const driftError = expectPublicationFailure(await capture(runImport(drift, driftContext)));
      expect(driftError.cause.reason).toBe('runAttempt');
      expect(driftContext.fetch.calls).toHaveLength(1);
      expectNoLane(drift, driftPaths);

      const changed = base({ legacy: true });
      const changedPaths = importPaths(changed);
      const changedContext = importContext(changed);
      const changedBytes = Buffer.from(JSON.stringify(manifestFor(changed.checkout.sourceSha, {
        date: '2026-02-02T00:00:00.000Z'
      })), 'utf8');
      expect(changedBytes.equals(changed.manifestBytes)).toBe(false);
      serveImport(changedContext, changed, {
        observation: { fetchResponse: streamResponse(changedBytes) }
      });
      const changedError = expectPublicationFailure(await capture(runImport(changed, changedContext)));
      expect(changedError.message).toContain('changed during discovery and confirmation');
      expectNoLane(changed, changedPaths);

      const raced = base({ legacy: true });
      const racedPaths = importPaths(raced);
      const racedContext = importContext(raced);
      const other = createReleaseState({
        releaseId: OTHER_RELEASE_ID,
        version: VERSION,
        mode: 'publish',
        at: OBSERVED_AT,
        sourceSha: raced.checkout.sourceSha,
        versionIntent: null
      }, raced.identity, { repoDir: raced.repoDir });
      serveImport(racedContext, raced, {
        observation: {
          fetchResponse: () => {
            writeReleaseState(other, raced.identity, {
              cacheRoot: cacheRootFor(raced), expectedRevision: null, fs
            });
            return streamResponse(raced.manifestBytes);
          }
        }
      });
      const racedError = expectPublicationFailure(await capture(runImport(raced, racedContext)));
      expect(racedError.message).toContain('appeared before initialization');
      const visible = storedState(raced);
      expect(visible.releaseId).toBe(OTHER_RELEASE_ID);
      expect(visible.revision).toBe(0);
      expect(visible.phase).toBe('source-ready');
      expect(visible.activeAttemptId).toBeNull();
      expect(fs.existsSync(racedPaths.recordsDir)).toBe(false);
    });
  });

  describePosix('legacy failed collector retention', () => {
    const DEFINITION_ENDPOINT = `repos/${OWNER_REPO}/actions/workflows/release.yml`;
    const OTHER_SHA = 'b'.repeat(40);
    const REPAIR_AT = '2026-01-02T04:00:00.000Z';
    const LATER_UPDATED_AT = '2026-01-02T05:00:00.000Z';

    function failureFixture() {
      const fixture = base({ legacy: true });
      git(fixture.checkout.root, ['tag', '-a', `v${VERSION}`, fixture.sourceSha, '-m', `v${VERSION}`]);
      fs.appendFileSync(path.join(fixture.checkout.root, 'README.md'), 'same-version repair\n');
      git(fixture.checkout.root, ['add', 'README.md']);
      git(fixture.checkout.root, ['commit', '-q', '-m', 'same-version repair']);
      const repairedSourceSha = git(fixture.checkout.root, ['rev-parse', 'HEAD']).trim();
      expect(repairedSourceSha).not.toBe(fixture.sourceSha);
      const row = runObject(fixture, { conclusion: 'failure' });
      return { ...fixture, repairedSourceSha, row, cacheRoot: path.dirname(fixture.repoDir) };
    }

    function failureContext(options = {}) {
      const gh = ghRunner();
      const fetch = fetchServer();
      const local = recordingLocalRun();
      const clock = fakeClock();
      clock.wall = Date.parse(DATE);
      const uuid = jest.fn(() => RELEASE_ID);
      const deps = observationDeps({ gh, fetch, localRun: local.run, clock, signal: options.signal });
      deps.randomUUID = uuid;
      if (options.io) deps.local.fs = options.io;
      return { gh, fetch, local, clock, uuid, deps };
    }

    function failureHistoryEndpoint(page = 1) {
      return `repos/${OWNER_REPO}/actions/workflows/${WORKFLOW_ID}/runs?event=workflow_dispatch&per_page=100&page=${page}`;
    }

    function serveFailure(context, fixture, rows = [fixture.row], direct = fixture.row) {
      context.gh.push(DEFINITION_ENDPOINT, ghOk({
        id: WORKFLOW_ID, path: '.github/workflows/release.yml', state: 'active'
      }));
      context.gh.push(failureHistoryEndpoint(), ghOk({ total_count: rows.length, workflow_runs: rows }));
      if (direct !== null) context.gh.push(runEndpoint(fixture), ghOk(direct));
    }

    function importFailure(fixture, context) {
      return withReleaseLock(fixture.identity, () => reconcileLegacyFailure({
        identity: fixture.identity, repoDir: fixture.repoDir, currentVersion: VERSION,
        repairedSourceSha: fixture.repairedSourceSha
      }, context.deps), { cacheRoot: fixture.cacheRoot });
    }

    function readFailureState(fixture) {
      return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, mode: 'publish' });
    }

    function failureFile(fixture, state) {
      return path.join(fixture.repoDir, 'records', state.releaseId, 'artifacts',
        publicationAttemptDirectoryName(state.activeAttemptId), 'failure.json');
    }

    function reobserveFailure(fixture, context, state = readFailureState(fixture)) {
      return withReleaseLock(fixture.identity, () => reobserveFailedRelease({
        state, repoDir: fixture.repoDir
      }, context.deps), { cacheRoot: fixture.cacheRoot });
    }

    function errno(code) {
      return Object.assign(new Error(`injected ${code}`), { code });
    }

    function overlayFs(overrides) {
      return Object.assign(Object.create(fs), overrides);
    }

    function expectNoFailureLane(fixture) {
      expect(readFailureState(fixture)).toBeNull();
      expect(fs.existsSync(path.join(fixture.repoDir, 'records'))).toBe(false);
    }

    function causeCodes(error) {
      const codes = [];
      let current = error;
      while (current && typeof current === 'object') {
        if (typeof current.code === 'string') codes.push(current.code);
        current = current.cause;
      }
      return codes;
    }

    function otherSourceRows(fixture, count, start) {
      return Array.from({ length: count }, (value, index) =>
        runObject(fixture, { id: start + index, head_sha: OTHER_SHA }));
    }

    function importedFixture() {
      const fixture = failureFixture();
      const context = failureContext();
      serveFailure(context, fixture);
      return importFailure(fixture, context).then((result) => ({ fixture, context, result }));
    }

    test('retains exactly one independently confirmed historical failure', async () => {
      const fixture = failureFixture();
      const context = failureContext();
      const unrelated = runObject(fixture, { id: 1001, head_sha: OTHER_SHA });
      serveFailure(context, fixture, [unrelated, fixture.row]);
      const result = await importFailure(fixture, context);
      const saved = readFailureState(fixture);
      expect(result.outcome).toBe('imported-failure');
      expect(result.error).toBeNull();
      expect(result.state).toEqual(saved);
      expect(saved.revision).toBe(0);
      expect(saved.phase).toBe('failed-ci');
      expect(saved.sourceSha).toBe(fixture.sourceSha);
      expect(saved.version).toBe(VERSION);
      expect(saved.activeAttemptId).toBe(`legacy-failed:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
      expect(saved.attempts).toHaveLength(1);
      expect(saved.attempts[0].legacyFailureProof).toEqual({
        observedHeadSha: fixture.sourceSha, observedConclusion: 'failure'
      });
      expect(saved.artifacts).toEqual({ state: 'pending' });
      expect([saved.sizes, saved.site, ...Object.values(saved.docs)].map(value => value.state))
        .toEqual(['pending', 'pending', 'pending', 'pending']);
      expect(saved.install).toEqual({ state: 'not-attempted', error: null });
      expect(context.uuid).toHaveBeenCalledTimes(1);
      expect(context.gh.calls.map(call => call.endpoint)).toEqual([
        DEFINITION_ENDPOINT, failureHistoryEndpoint(), runEndpoint(fixture)
      ]);
      expect(context.fetch.calls).toHaveLength(0);
      const proofPath = failureFile(fixture, saved);
      const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
      expect(Object.keys(proof).sort()).toEqual([
        'schema', 'releaseId', 'attemptId', 'version', 'sourceSha', 'observedAt', 'run', 'runSha256'
      ].sort());
      expect(proof.run.id).toBe(LEGACY_RUN_ID);
      expect(proof.run.run_attempt).toBe(2);
      expect(proof.run.head_sha).toBe(fixture.sourceSha);
      expect(proof.run.conclusion).toBe('failure');
      expect(proof.runSha256).toBe(sha256(Buffer.from(JSON.stringify(proof.run))));
      expect(fs.statSync(proofPath).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(path.dirname(proofPath))).toEqual(['failure.json']);
      expect(git(fixture.checkout.root, ['rev-parse', 'HEAD']).trim()).toBe(fixture.repairedSourceSha);
      expect(git(fixture.checkout.root, ['rev-parse', `v${VERSION}^{commit}`]).trim()).toBe(fixture.sourceSha);
      expect(context.local.calls.some(call => call.args[0] === 'cat-file' && call.args[1] === 'tag')).toBe(true);
    });

    test('restores a missing proof by direct stored identity without discovery', async () => {
      const fixture = failureFixture();
      const records = path.join(fixture.repoDir, 'records');
      const io = overlayFs({
        mkdirSync(target, ...args) {
          if (target === records) throw errno('EIO');
          return fs.mkdirSync(target, ...args);
        }
      });
      const initial = failureContext({ io });
      serveFailure(initial, fixture);
      const error = await capture(importFailure(fixture, initial));
      expect(error.code).toBe(FAILURE_CODE);
      const saved = readFailureState(fixture);
      expect(saved.phase).toBe('failed-ci');
      expect(saved.revision).toBe(0);
      expect(fs.existsSync(failureFile(fixture, saved))).toBe(false);
      const before = fs.readFileSync(path.join(fixture.repoDir, 'state.json'));
      git(fixture.checkout.root, ['update-ref', '-d', `refs/tags/v${VERSION}`]);
      const resumed = failureContext();
      resumed.gh.push(runEndpoint(fixture), ghOk(fixture.row));
      const result = await reobserveFailure(fixture, resumed, saved);
      expect(result.state).toEqual(saved);
      expect(result.run).toEqual(fixture.row);
      expect(fs.readFileSync(path.join(fixture.repoDir, 'state.json'))).toEqual(before);
      expect(fs.existsSync(failureFile(fixture, saved))).toBe(true);
      expect(resumed.gh.calls.map(call => call.endpoint)).toEqual([runEndpoint(fixture)]);
      expect(resumed.uuid).not.toHaveBeenCalled();
      expect(resumed.fetch.calls).toHaveLength(0);
      expect(resumed.local.calls.some(call => call.args[0] === 'for-each-ref')).toBe(false);
    });

    test('a thrown state publication stays primary even when renamed bytes exist', async () => {
      const fixture = failureFixture();
      const stateFile = path.join(fixture.repoDir, 'state.json');
      const io = overlayFs({
        renameSync(from, to) {
          fs.renameSync(from, to);
          if (to === stateFile) throw errno('EIO');
        }
      });
      const context = failureContext({ io });
      serveFailure(context, fixture);
      const error = await capture(importFailure(fixture, context));
      expect(error.code).toBe('STATE_IO_FAILED');
      expect(error.cause.code).toBe('EIO');
      expect(readFailureState(fixture).phase).toBe('failed-ci');
      expect(fs.existsSync(path.join(fixture.repoDir, 'records'))).toBe(false);
      expect(context.gh.calls).toHaveLength(3);
    });

    test.each([
      { label: 'empty', rows: () => [] },
      { label: 'ambiguous', rows: fixture => [fixture.row, runObject(fixture, { id: 1002, run_attempt: 1, conclusion: 'failure' })] },
      { label: 'successful', rows: fixture => [runObject(fixture, { conclusion: 'success' })] },
      { label: 'running', rows: fixture => [runObject(fixture, { status: 'in_progress', conclusion: null })] },
      { label: 'mixed', rows: fixture => [fixture.row, runObject(fixture, { id: 1002, run_attempt: 1, conclusion: 'success' })] },
      { label: 'modern', rows: fixture => [runObject(fixture, { conclusion: 'failure', display_title: `${fixture.title} attempt=${ATTEMPT_ID}` })] }
    ])('refuses $label same-source history', async ({ rows }) => {
      const fixture = failureFixture();
      const context = failureContext();
      serveFailure(context, fixture, rows(fixture), null);
      const error = await capture(importFailure(fixture, context));
      expect(error.code).toBe('LEGACY_FAILURE_UNRESOLVED');
      expect(context.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint()]);
      expect(context.uuid).not.toHaveBeenCalled();
      expect(context.fetch.calls).toHaveLength(0);
      expectNoFailureLane(fixture);
    });

    test.each([
      { label: 'run attempt', patch: { run_attempt: 3 }, code: 'WORKFLOW_IDENTITY_CONFLICT' },
      { label: 'source', patch: { head_sha: OTHER_SHA }, code: 'WORKFLOW_IDENTITY_CONFLICT' },
      { label: 'workflow', patch: { workflow_id: WORKFLOW_ID + 1 }, code: 'WORKFLOW_IDENTITY_CONFLICT' },
      { label: 'repository', patch: { repository: { full_name: 'other-owner/other-repo' } }, code: 'WORKFLOW_IDENTITY_CONFLICT' },
      { label: 'event', patch: { event: 'push' }, code: 'WORKFLOW_IDENTITY_CONFLICT' },
      { label: 'cancelled', patch: { conclusion: 'cancelled' }, code: 'LEGACY_FAILURE_UNRESOLVED' },
      { label: 'successful', patch: { conclusion: 'success' }, code: 'LEGACY_FAILURE_UNRESOLVED' },
      { label: 'running', patch: { status: 'in_progress', conclusion: null }, code: 'LEGACY_FAILURE_UNRESOLVED' },
      { label: 'modern title', patch: { display_title: `legacy attempt=${ATTEMPT_ID}` }, code: 'LEGACY_FAILURE_UNRESOLVED' }
    ])('confirms exact listed identity and failure before saving for $label', async ({ patch, code }) => {
      const fixture = failureFixture();
      const context = failureContext();
      serveFailure(context, fixture, [fixture.row], runObject(fixture, patch));
      const error = await capture(importFailure(fixture, context));
      expect(error.code).toBe(code);
      expect(context.gh.calls).toHaveLength(3);
      expect(context.fetch.calls).toHaveLength(0);
      expectNoFailureLane(fixture);
    });

    test('requires complete history and keeps the only failed candidate from page two', async () => {
      const fixture = failureFixture();
      const context = failureContext();
      context.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      context.gh.push(failureHistoryEndpoint(1), ghOk({ total_count: 101, workflow_runs: otherSourceRows(fixture, 100, 10000) }));
      context.gh.push(failureHistoryEndpoint(2), ghOk({ total_count: 101, workflow_runs: [fixture.row] }));
      context.gh.push(runEndpoint(fixture), ghOk(fixture.row));

      const result = await importFailure(fixture, context);

      expect(result.outcome).toBe('imported-failure');
      const saved = readFailureState(fixture);
      expect(saved.activeAttemptId).toBe(`legacy-failed:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
      expect(fs.existsSync(failureFile(fixture, saved))).toBe(true);
      expect(context.gh.calls.map(call => call.endpoint)).toEqual([
        DEFINITION_ENDPOINT, failureHistoryEndpoint(1), failureHistoryEndpoint(2), runEndpoint(fixture)
      ]);
      expect(context.fetch.calls).toHaveLength(0);

      const incomplete = failureFixture();
      const short = failureContext();
      short.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      short.gh.push(failureHistoryEndpoint(1), ghOk({ total_count: 2, workflow_runs: [otherSourceRows(incomplete, 1, 1001)[0]] }));
      expect((await capture(importFailure(incomplete, short))).code).toBe(FAILURE_CODE);
      expect(short.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint(1)]);
      expectNoFailureLane(incomplete);

      const repeated = failureFixture();
      const duplicate = failureContext();
      duplicate.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      duplicate.gh.push(failureHistoryEndpoint(1), ghOk({
        total_count: 2, workflow_runs: [otherSourceRows(repeated, 1, 1001)[0], otherSourceRows(repeated, 1, 1001)[0]]
      }));
      expect((await capture(importFailure(repeated, duplicate))).code).toBe(FAILURE_CODE);
      expect(duplicate.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint(1)]);
      expectNoFailureLane(repeated);

      const changed = failureFixture();
      const totals = failureContext();
      totals.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      totals.gh.push(failureHistoryEndpoint(1), ghOk({ total_count: 101, workflow_runs: otherSourceRows(changed, 100, 10000) }));
      totals.gh.push(failureHistoryEndpoint(2), ghOk({ total_count: 102, workflow_runs: [changed.row] }));
      expect((await capture(importFailure(changed, totals))).code).toBe(FAILURE_CODE);
      expect(totals.gh.calls.map(call => call.endpoint)).toEqual([
        DEFINITION_ENDPOINT, failureHistoryEndpoint(1), failureHistoryEndpoint(2)
      ]);
      expectNoFailureLane(changed);

      const overDeclared = failureFixture();
      const huge = failureContext();
      huge.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      huge.gh.push(failureHistoryEndpoint(1), ghOk({ total_count: 10001, workflow_runs: [overDeclared.row] }));
      expect((await capture(importFailure(overDeclared, huge))).code).toBe(FAILURE_CODE);
      expect(huge.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint(1)]);
      expectNoFailureLane(overDeclared);

      const malformed = failureFixture();
      const bad = failureContext();
      bad.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      bad.gh.push(failureHistoryEndpoint(1), ghOk({
        total_count: 1, workflow_runs: [runObject(malformed, { id: 1001, head_sha: 'nope' })]
      }));
      expect((await capture(importFailure(malformed, bad))).code).toBe('WORKFLOW_RESPONSE_INVALID');
      expect(bad.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint(1)]);
      expectNoFailureLane(malformed);
    });

    test('refuses missing lightweight nested and wrong-version source locators', async () => {
      const missing = failureFixture();
      git(missing.checkout.root, ['update-ref', '-d', `refs/tags/v${VERSION}`]);
      const missingContext = failureContext();
      expect((await capture(importFailure(missing, missingContext))).code).toBe('LEGACY_FAILURE_UNRESOLVED');
      expect(missingContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(missing);

      const lightweight = failureFixture();
      git(lightweight.checkout.root, ['tag', '-f', `v${VERSION}`, lightweight.sourceSha]);
      const lightweightContext = failureContext();
      expect((await capture(importFailure(lightweight, lightweightContext))).code).toBe('LEGACY_FAILURE_UNRESOLVED');
      expect(lightweightContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(lightweight);

      const nested = failureFixture();
      git(nested.checkout.root, ['tag', '-a', 'inner-fixture', nested.sourceSha, '-m', 'inner-fixture']);
      git(nested.checkout.root, ['tag', '-f', '-a', `v${VERSION}`, 'inner-fixture', '-m', `v${VERSION}`]);
      const tagObject = git(nested.checkout.root, ['rev-parse', `v${VERSION}`]).trim();
      expect(git(nested.checkout.root, ['cat-file', 'tag', tagObject])).toContain('type tag');
      const nestedContext = failureContext();
      expect((await capture(importFailure(nested, nestedContext))).code).toBe('LEGACY_FAILURE_UNRESOLVED');
      expect(nestedContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(nested);

      const wrong = failureFixture();
      const repairSha = wrong.repairedSourceSha;
      fs.writeFileSync(path.join(wrong.checkout.root, 'package.json'), packageBody('1.28.0'));
      git(wrong.checkout.root, ['add', 'package.json']);
      git(wrong.checkout.root, ['commit', '-q', '-m', 'wrong version source']);
      const wrongSha = git(wrong.checkout.root, ['rev-parse', 'HEAD']).trim();
      git(wrong.checkout.root, ['tag', '-f', '-a', `v${VERSION}`, wrongSha, '-m', `v${VERSION}`]);
      git(wrong.checkout.root, ['reset', '--hard', repairSha]);
      const wrongContext = failureContext();
      expect((await capture(importFailure(wrong, wrongContext))).code).toBe(FAILURE_CODE);
      expect(wrongContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(wrong);
    });

    test('requires a distinct full repair source and an absent current lane', async () => {
      const same = failureFixture();
      same.repairedSourceSha = same.sourceSha;
      const sameContext = failureContext();
      expect((await capture(importFailure(same, sameContext))).code).toBe('LEGACY_FAILURE_UNRESOLVED');
      expect(sameContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(same);

      const short = failureFixture();
      short.repairedSourceSha = 'abc';
      const shortContext = failureContext();
      expect((await capture(importFailure(short, shortContext))).code).toBe(FAILURE_CODE);
      expect(shortContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(short);

      const fixture = failureFixture();
      const first = failureContext();
      serveFailure(first, fixture);
      const result = await importFailure(fixture, first);
      expect(result.outcome).toBe('imported-failure');
      const stateFile = path.join(fixture.repoDir, 'state.json');
      const proofPath = failureFile(fixture, result.state);
      const stateBefore = fs.readFileSync(stateFile);
      const proofBefore = fs.readFileSync(proofPath);
      const second = failureContext();
      const error = await capture(importFailure(fixture, second));
      expect(error.code).toBe(FAILURE_CODE);
      expect(second.gh.calls).toHaveLength(0);
      expect(fs.readFileSync(stateFile)).toEqual(stateBefore);
      expect(fs.readFileSync(proofPath)).toEqual(proofBefore);
    });

    test('preserves classified denied transient exhausted and aborted reads', async () => {
      const denied = failureFixture();
      const forbidden = failureContext();
      forbidden.gh.push(DEFINITION_ENDPOINT, ghHttp(403, '{"message":"Forbidden"}'));
      const forbiddenError = await capture(importFailure(denied, forbidden));
      expect(forbiddenError.kind).toBe('http');
      expect(forbiddenError.httpStatus).toBe(403);
      expect(forbiddenError.attempts).toBe(1);
      expect(forbidden.gh.calls).toHaveLength(1);
      expect(forbidden.fetch.calls).toHaveLength(0);
      expectNoFailureLane(denied);

      const absent = failureFixture();
      const missing = failureContext();
      missing.gh.push(DEFINITION_ENDPOINT, ghHttp(404, '{"message":"Not Found"}'));
      const missingError = await capture(importFailure(absent, missing));
      expect(missingError.kind).toBe('http');
      expect(missingError.httpStatus).toBe(404);
      expect(missingError.attempts).toBe(1);
      expect(missing.gh.calls).toHaveLength(1);
      expectNoFailureLane(absent);

      const fixture = failureFixture();
      const context = failureContext();
      for (let i = 0; i < 3; i += 1) context.gh.push(DEFINITION_ENDPOINT, ghHttp(503, '{"message":"fixture unavailable"}'));
      const error = await capture(importFailure(fixture, context));
      expect(error.attemptErrors).toHaveLength(3);
      expect(context.gh.calls).toHaveLength(3);
      expect(context.clock.sleeps).toHaveLength(2);
      expectNoFailureLane(fixture);

      const aborted = failureFixture();
      const controller = new AbortController();
      controller.abort(new Error('fixture stop'));
      const abortContext = failureContext({ signal: controller.signal });
      const abortError = await capture(importFailure(aborted, abortContext));
      expect(abortError.kind).toBe('operator-abort');
      expect(abortContext.gh.calls).toHaveLength(0);
      expectNoFailureLane(aborted);

      const deadline = failureFixture();
      const shared = failureContext();
      shared.gh.push(DEFINITION_ENDPOINT, ghOk({ id: WORKFLOW_ID, path: '.github/workflows/release.yml' }));
      shared.gh.push(failureHistoryEndpoint(1), () => {
        shared.clock.advance(90001);
        return ghOk({ total_count: 101, workflow_runs: otherSourceRows(deadline, 100, 10000) });
      });
      const deadlineError = await capture(importFailure(deadline, shared));
      expect(deadlineError.kind).toBe('deadline');
      expect(shared.gh.calls.map(call => call.endpoint)).toEqual([DEFINITION_ENDPOINT, failureHistoryEndpoint(1)]);
      expect(shared.fetch.calls).toHaveLength(0);
      expectNoFailureLane(deadline);
    });

    test('retains exact original proof through reobservation and explicit repair', async () => {
      const fixture = failureFixture();
      const context = failureContext();
      serveFailure(context, fixture);
      const imported = await importFailure(fixture, context);
      expect(imported.outcome).toBe('imported-failure');
      const saved = readFailureState(fixture);
      const stateFile = path.join(fixture.repoDir, 'state.json');
      const proofPath = failureFile(fixture, saved);
      const stateBefore = fs.readFileSync(stateFile);
      const proofBefore = fs.readFileSync(proofPath);
      const attemptBefore = JSON.parse(JSON.stringify(saved.attempts[0]));

      const later = runObject(fixture, { conclusion: 'failure', updated_at: LATER_UPDATED_AT });
      const observed = failureContext();
      observed.gh.push(runEndpoint(fixture), ghOk(later));
      const result = await reobserveFailure(fixture, observed, saved);
      expect(result.state).toEqual(saved);
      expect(result.run).toEqual(later);
      expect(observed.gh.calls.map(call => call.endpoint)).toEqual([runEndpoint(fixture)]);
      expect(observed.uuid).not.toHaveBeenCalled();
      expect(fs.readFileSync(stateFile)).toEqual(stateBefore);
      expect(fs.readFileSync(proofPath)).toEqual(proofBefore);

      await withReleaseLock(fixture.identity, () => {
        const current = readFailureState(fixture);
        const repair = makeWorkflowAttempt({
          state: current, repoDir: fixture.repoDir, workflowId: WORKFLOW_ID,
          attemptId: ATTEMPT_ID, sourceSha: fixture.repairedSourceSha, dispatchRef: 'main'
        });
        const next = transitionRelease(current, {
          type: 'begin-repair-attempt', at: REPAIR_AT, previousRunId: current.attempts[0].runId, attempt: repair
        }, fixture.identity, { repoDir: fixture.repoDir });
        writeReleaseState(next, fixture.identity, { cacheRoot: fixture.cacheRoot, expectedRevision: current.revision });
      }, { cacheRoot: fixture.cacheRoot });

      const repaired = readFailureState(fixture);
      expect(repaired.revision).toBe(1);
      expect(repaired.sourceSha).toBe(fixture.repairedSourceSha);
      expect(repaired.activeAttemptId).toBe(ATTEMPT_ID);
      expect(repaired.attempts[0]).toEqual(attemptBefore);
      expect(repaired.attempts[1].identityKind).toBe('dispatch');
      expect(repaired.attempts[1].dispatch).toBe('ready');
      expect(fs.readFileSync(proofPath)).toEqual(proofBefore);

      const stale = failureContext();
      const staleError = await capture(reobserveFailure(fixture, stale, saved));
      expect(staleError.code).toBe(FAILURE_CODE);
      expect(stale.gh.calls).toHaveLength(0);
      expect(stale.fetch.calls).toHaveLength(0);
    });

    test('refuses corrupt unsafe and unflushed retained failure without overwriting it', async () => {
      const variations = [
        { label: 'digest', code: FAILURE_CODE, mutate: proof => { proof.runSha256 = sha256(Buffer.from('changed')); } },
        { label: 'observed', code: FAILURE_CODE, mutate: proof => { proof.observedAt = 'not-a-timestamp'; } },
        { label: 'extra key', code: FAILURE_CODE, mutate: proof => { proof.extra = 1; } },
        { label: 'extra run key', code: FAILURE_CODE, mutate: proof => { proof.run.extra = 1; } },
        {
          label: 'source', code: 'WORKFLOW_IDENTITY_CONFLICT',
          mutate: proof => {
            proof.run.head_sha = OTHER_SHA;
            proof.runSha256 = sha256(Buffer.from(JSON.stringify(proof.run)));
          }
        },
        {
          label: 'attempt', code: 'WORKFLOW_IDENTITY_CONFLICT',
          mutate: proof => {
            proof.run.run_attempt = 3;
            proof.runSha256 = sha256(Buffer.from(JSON.stringify(proof.run)));
          }
        }
      ];
      for (const variation of variations) {
        const { fixture, result } = await importedFixture();
        const proofPath = failureFile(fixture, result.state);
        const corrupted = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
        variation.mutate(corrupted);
        fs.writeFileSync(proofPath, Buffer.from(`${JSON.stringify(corrupted)}\n`, 'utf8'), { mode: 0o600 });
        const bytesBefore = fs.readFileSync(proofPath);
        const context = failureContext();
        context.gh.push(runEndpoint(fixture), ghOk(fixture.row));
        const error = await capture(reobserveFailure(fixture, context, result.state));
        expect(error.code).toBe(variation.code);
        expect(fs.readFileSync(proofPath)).toEqual(bytesBefore);
      }

      const symlinked = await importedFixture();
      const symlinkProof = failureFile(symlinked.fixture, symlinked.result.state);
      fs.unlinkSync(symlinkProof);
      const referent = path.join(symlinked.fixture.repoDir, 'referent.json');
      fs.writeFileSync(referent, Buffer.from('{}\n'), { mode: 0o600 });
      fs.symlinkSync(referent, symlinkProof);
      const referentBefore = fs.readFileSync(referent);
      const symlinkContext = failureContext();
      symlinkContext.gh.push(runEndpoint(symlinked.fixture), ghOk(symlinked.fixture.row));
      const symlinkError = await capture(reobserveFailure(symlinked.fixture, symlinkContext, symlinked.result.state));
      expect(symlinkError.code).toBe(FAILURE_CODE);
      expect(fs.lstatSync(symlinkProof).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(referent)).toEqual(referentBefore);

      const fixture = failureFixture();
      let publishedFailure = false;
      let injected = false;
      const io = overlayFs({
        renameSync(from, to) {
          fs.renameSync(from, to);
          if (path.basename(to) === 'failure.json') publishedFailure = true;
        },
        fsyncSync(fd) {
          if (publishedFailure && !injected) {
            injected = true;
            throw errno('EIO');
          }
          return fs.fsyncSync(fd);
        }
      });
      const initial = failureContext({ io });
      serveFailure(initial, fixture);
      const error = await capture(importFailure(fixture, initial));
      expect(injected).toBe(true);
      expect(error.code).toBe(FAILURE_CODE);
      expect(causeCodes(error)).toContain('EIO');
      const saved = readFailureState(fixture);
      expect(saved.phase).toBe('failed-ci');
      expect(saved.revision).toBe(0);
      const stateFile = path.join(fixture.repoDir, 'state.json');
      const proofPath = failureFile(fixture, saved);
      expect(fs.existsSync(proofPath)).toBe(true);
      const stateBefore = fs.readFileSync(stateFile);
      const proofBefore = fs.readFileSync(proofPath);
      const resumed = failureContext();
      resumed.gh.push(runEndpoint(fixture), ghOk(fixture.row));
      const result = await reobserveFailure(fixture, resumed, saved);
      expect(result.state).toEqual(saved);
      expect(fs.readFileSync(stateFile)).toEqual(stateBefore);
      expect(fs.readFileSync(proofPath)).toEqual(proofBefore);
      expect(resumed.gh.calls.map(call => call.endpoint)).toEqual([runEndpoint(fixture)]);
      expect(resumed.uuid).not.toHaveBeenCalled();
    });

    test('reobserves an exact modern failed attempt without legacy evidence', async () => {
      const fixture = failureFixture();
      let saved;
      await withReleaseLock(fixture.identity, () => {
        const persist = value => {
          writeReleaseState(value, fixture.identity, {
            cacheRoot: fixture.cacheRoot, expectedRevision: saved ? saved.revision : null
          });
          saved = readFailureState(fixture);
          return saved;
        };
        persist(createReleaseState({ releaseId: RELEASE_ID, version: VERSION, mode: 'publish',
          at: DATE, sourceSha: fixture.sourceSha, versionIntent: null
        }, fixture.identity, { repoDir: fixture.repoDir }));
        const attempt = makeWorkflowAttempt({ state: saved, repoDir: fixture.repoDir,
          workflowId: WORKFLOW_ID, attemptId: ATTEMPT_ID, sourceSha: fixture.sourceSha,
          dispatchRef: `v${VERSION}` });
        const advance = event => persist(transitionRelease(saved, { ...event, at: DATE },
          fixture.identity, { repoDir: fixture.repoDir }));
        advance({ type: 'attempt-ready', attempt });
        advance({ type: 'dispatch-requested' });
        advance({ type: 'run-observed', runId: RUN_ID, runAttempt: 1,
          runStatus: 'completed', conclusion: 'failure' });
        advance({ type: 'ci-failed', error: { code: 'WORKFLOW_CI_FAILED', message: 'Fixture CI failure' } });
      }, { cacheRoot: fixture.cacheRoot });
      expect(saved.revision).toBe(4);
      const stateFile = path.join(fixture.repoDir, 'state.json');
      const before = fs.readFileSync(stateFile);
      const context = failureContext();
      const attempt = saved.attempts[0];
      const row = runObject(fixture, { id: RUN_ID, run_attempt: 1,
        display_title: attempt.expectedTitle, conclusion: 'failure' });
      const endpoint = `repos/${OWNER_REPO}/actions/runs/${RUN_ID}`;
      context.gh.push(endpoint, ghOk(row));
      const result = await reobserveFailure(fixture, context, saved);
      expect(result.state).toEqual(saved);
      expect(result.run).toEqual(row);
      expect(context.gh.calls.map(call => call.endpoint)).toEqual([endpoint]);
      expect(fs.readFileSync(stateFile)).toEqual(before);
      expect(fs.existsSync(path.join(fixture.repoDir, 'records'))).toBe(false);
      expect(context.fetch.calls).toHaveLength(0);
      expect(context.uuid).not.toHaveBeenCalled();

      const changed = failureContext();
      const changedTitle = attempt.expectedTitle.replace(`sha=${fixture.sourceSha}`, `sha=${'c'.repeat(40)}`);
      changed.gh.push(endpoint, ghOk(runObject(fixture, { id: RUN_ID, run_attempt: 1,
        display_title: changedTitle, conclusion: 'failure' })));
      const conflict = await capture(reobserveFailure(fixture, changed, saved));
      expect(conflict.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
      expect(fs.readFileSync(stateFile)).toEqual(before);
      expect(fs.existsSync(path.join(fixture.repoDir, 'records'))).toBe(false);
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
