// Publication persistence: the retained manifest and proof are published before the
// artifacts-verified event, a crash at any file/state boundary leaves a resumable
// release, and an existing pair is never overwritten or repaired by replacement.
// Fixtures use a real scratch Git checkout, the real state store, the real transition
// module and the real pair reader; only the filesystem is wrapped to inject faults.
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { describePosix } = require('../helpers/platform');

const { persistPublication } = require('../../scripts/release-publication-write');
const { readPublicationPair } = require('../../scripts/release-publication');
const { publicationAttemptDirectoryName } = require('../../scripts/release-publication-path');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { withReleaseLock } = require('../../scripts/release-lock');

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
const OTHER_SHA = '9'.repeat(40);
const RUN_CREATED_AT = '2026-01-02T02:00:00Z';
const RUN_UPDATED_AT = '2026-01-02T02:30:00Z';
const REQUESTED_AT = '2026-01-02T01:00:00.000Z';
const WATCH_DEADLINE_AT = '2026-01-02T04:00:00.000Z';
const OBSERVED_AT = '2026-01-02T01:20:00.000Z';
const CREATED_AT = '2026-01-02T00:30:00.000Z';
const UPDATED_AT = '2026-01-02T01:30:00.000Z';
const VERIFIED_AT = '2026-01-02T03:04:06.000Z';
const SAVED_VERIFIED_AT = '2026-01-02T02:45:00.000Z';
const WALL_NOW = Date.parse(VERIFIED_AT);
const OWNER_REPO = 'fixture-owner/hyperclay-local';
const REMOTE_REPO = `github.com/${OWNER_REPO}`;
const ORIGIN_URL = 'git@github.com:fixture-owner/hyperclay-local.git';
const OTHER_ORIGIN_URL = 'git@github.com:other-owner/other-repo.git';
const MANIFEST_FILE = 'release-info.json';
const PROOF_FILE = 'publication.json';
const DIGEST = 'f'.repeat(64);

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

const OWNER = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hc-publication-persist-')));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const GIT_CONFIG = path.join(OWNER, 'gitconfig');

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
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `checkout-${++seq}-`)));
  git(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'package.json'), packageBody(VERSION));
  fs.writeFileSync(path.join(root, 'README.md'), 'hyperclay local\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'release source']);
  git(root, ['remote', 'add', 'origin', options.remote === undefined ? ORIGIN_URL : options.remote]);
  return {
    root,
    commonDir: fs.realpathSync.native(path.join(root, '.git')),
    sourceSha: git(root, ['rev-parse', 'HEAD']).trim()
  };
}

function resolvedIdentity(checkout) {
  return resolveRepoIdentity(checkout.root, { readGit: createLocalGitReader().readGit, fs });
}

function dispatchAttempt(sourceSha, patch = {}) {
  return Object.assign({
    id: ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: WORKFLOW_ID,
    expectedTitle: `release v${VERSION} publish sha=${sourceSha} attempt=${ATTEMPT_ID}`,
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

function legacyAttempt(sourceSha, patch = {}) {
  return Object.assign({
    id: `legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`,
    identityKind: 'legacy-upload-proof',
    version: VERSION,
    mode: 'publish',
    sourceSha,
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
      observedHeadSha: sourceSha,
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
    revision: 0,
    repo: null,
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
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

function runObject(fixture, patch = {}) {
  const legacy = fixture.attempt.identityKind === 'legacy-upload-proof';
  return Object.assign({
    id: fixture.attempt.runId,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    workflow_id: WORKFLOW_ID,
    display_title: legacy
      ? `release v${VERSION} publish sha=${fixture.checkout.sourceSha}`
      : fixture.attempt.expectedTitle,
    head_sha: fixture.checkout.sourceSha,
    run_attempt: fixture.attempt.runAttempt,
    created_at: RUN_CREATED_AT,
    updated_at: RUN_UPDATED_AT,
    repository: { full_name: OWNER_REPO },
    html_url: `https://github.com/${OWNER_REPO}/actions/runs/${fixture.attempt.runId}`
  }, patch);
}

function uploadRow(patch = {}) {
  return Object.assign({ id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' }, patch);
}

function proofFor(fixture, digest, patch = {}) {
  return Object.assign({
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: fixture.attempt.id,
    version: VERSION,
    mode: 'publish',
    sourceSha: fixture.checkout.sourceSha,
    manifestSha256: digest,
    verifiedAt: VERIFIED_AT,
    run: runObject(fixture),
    uploadJobsRequest: { runId: fixture.attempt.runId, runAttempt: fixture.attempt.runAttempt },
    uploadJob: uploadRow()
  }, patch);
}

function observationFor(fixture, options = {}) {
  const value = manifestFor(fixture.checkout.sourceSha, options.manifest);
  const bytes = options.manifestBytes === undefined
    ? Buffer.from(JSON.stringify(value), 'utf8')
    : options.manifestBytes;
  return { manifestBytes: bytes, manifest: value, proof: proofFor(fixture, sha256(bytes), options.proof) };
}

function noisyManifestBytes(value) {
  const json = JSON.stringify(value, null, 2);
  const noisy = json.replace('"version":', '"version": "caf\u00e9 \u2014 \u2615",\n  "version":');
  return Buffer.from(`\t${noisy}\r\n`, 'utf8');
}

function makeFixture(options = {}) {
  const checkout = makeCheckout(options);
  const identity = resolvedIdentity(checkout);
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, `persist-${++seq}-`)));
  const cacheRoot = path.join(dir, 'cache', 'releases');
  const repoDir = statePaths(identity, { cacheRoot }).repoDir;
  const attempt = options.legacy === true
    ? legacyAttempt(checkout.sourceSha)
    : dispatchAttempt(checkout.sourceSha);
  const fixture = {
    checkout,
    identity,
    cacheRoot,
    repoDir,
    attempt,
    attemptDir: path.join(repoDir, 'records', RELEASE_ID, 'artifacts', publicationAttemptDirectoryName(attempt.id))
  };
  fixture.manifestFile = path.join(fixture.attemptDir, MANIFEST_FILE);
  fixture.proofFile = path.join(fixture.attemptDir, PROOF_FILE);
  fixture.state = releaseState(attempt, {
    repo: identity,
    phase: options.complete === true ? 'tail' : 'workflow',
    artifacts: options.complete === true
      ? {
        state: 'complete',
        sourceSha: checkout.sourceSha,
        runId: attempt.runId,
        manifestFile: fixture.manifestFile,
        manifestSha256: DIGEST,
        verifiedAt: VERIFIED_AT
      }
      : { state: 'pending' }
  });
  fixture.observation = observationFor(fixture, options);
  writeReleaseState(fixture.state, identity, { cacheRoot, expectedRevision: null, fs });
  return fixture;
}

function persist(fixture, options = {}) {
  const local = {};
  if (options.fs !== undefined) local.fs = options.fs;
  if (options.run !== undefined) local.run = options.run;
  const deps = {};
  if (Object.keys(local).length > 0) deps.local = local;
  deps.wallNow = options.wallNow === undefined ? () => WALL_NOW : options.wallNow;
  const input = {
    state: options.state === undefined ? fixture.state : options.state,
    repoDir: options.repoDir === undefined ? fixture.repoDir : options.repoDir,
    observation: options.observation === undefined ? fixture.observation : options.observation
  };
  return withReleaseLock(fixture.identity, async () => persistPublication(input, deps), {
    cacheRoot: fixture.cacheRoot
  });
}

function storedState(fixture) {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, fs });
}

function mkdirEvidence(fixture) {
  let current = fixture.repoDir;
  for (const segment of ['records', RELEASE_ID, 'artifacts', publicationAttemptDirectoryName(fixture.attempt.id)]) {
    current = path.join(current, segment);
    fs.mkdirSync(current, { mode: 0o700 });
  }
  return current;
}

function writeLeaf(file, bytes, mode = 0o600) {
  fs.writeFileSync(file, bytes, { mode });
}

function fileStat(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 };
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
      events.push({ op: 'rename', from, to });
      if (hooks.rename !== undefined && hooks.rename({ from, to, events }) === true) {
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

function flushOrder(fixture, events) {
  return events
    .filter((event) => {
      if (event.op === 'mkdir') return true;
      if (event.op === 'rename') return true;
      if (event.op !== 'fsync') return false;
      if (event.target === null) return false;
      return event.directory || event.target === fixture.manifestFile || event.target === fixture.proofFile;
    })
    .filter((event) => {
      const target = event.op === 'rename' ? event.to : event.target;
      return target === fixture.repoDir || target.startsWith(fixture.repoDir + path.sep);
    })
    .map((event) => {
      if (event.op === 'rename') return `rename ${path.basename(event.to)}`;
      if (event.op === 'mkdir') {
        const relative = path.relative(fixture.repoDir, event.target).split(path.sep).join('/');
        return `mkdir ${relative === '' ? '.' : relative}`;
      }
      if (event.directory) {
        const relative = path.relative(fixture.repoDir, event.target).split(path.sep).join('/');
        return `fsync ${relative === '' ? '.' : relative}`;
      }
      return `fsync ${path.basename(event.target)}`;
    });
}

function driftingRun(url) {
  const inner = createLocalGitReader().run;
  const calls = [];
  return {
    calls,
    run(file, args, options) {
      calls.push({ file, args, options });
      const command = args.join(' ');
      if (file === 'git' &&
          (command === 'remote get-url origin' || command === 'remote get-url --push --all origin')) {
        return `${url}\n`;
      }
      return inner(file, args, options);
    }
  };
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function expectPublicationFailure(error) {
  expect(error).toBeTruthy();
  expect(error.code).toBe(FAILURE_CODE);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
  return error;
}

function evidencePaths(fixture) {
  return {
    records: path.join(fixture.repoDir, 'records'),
    manifest: fixture.manifestFile,
    proof: fixture.proofFile
  };
}

describePosix('publication persistence', () => {
  describe('initial publication', () => {
    test('publishes the manifest, then the proof, then the state, flushing every parent', async () => {
      const fixture = makeFixture();
      const { io, events } = faultIo();
      const result = await persist(fixture, { fs: io });

      expect(result.phase).toBe('tail');
      expect(result.revision).toBe(1);
      expect(result.artifacts).toEqual({
        state: 'complete',
        sourceSha: fixture.checkout.sourceSha,
        runId: RUN_ID,
        manifestFile: fixture.manifestFile,
        manifestSha256: sha256(fixture.observation.manifestBytes),
        verifiedAt: VERIFIED_AT
      });
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(storedState(fixture)).toEqual(result);

      expect(flushOrder(fixture, events)).toEqual([
        'mkdir records',
        'fsync .',
        `mkdir records/${RELEASE_ID}`,
        'fsync records',
        `mkdir records/${RELEASE_ID}/artifacts`,
        `fsync records/${RELEASE_ID}`,
        `mkdir records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `fsync records/${RELEASE_ID}/artifacts`,
        `rename ${MANIFEST_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `rename ${PROOF_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `fsync ${MANIFEST_FILE}`,
        `fsync ${PROOF_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        'rename state.json',
        'fsync .'
      ]);
      const leafOpens = events.filter(
        (event) => event.op === 'open' && typeof event.flags === 'number'
      );
      expect(leafOpens.length).toBeGreaterThan(0);
      expect(events.filter((event) => event.op === 'fsync').length).toBeGreaterThan(8);
    });

    test('persists a legacy attempt whose run attempt is two', async () => {
      const fixture = makeFixture({ legacy: true });
      const result = await persist(fixture);

      expect(result.phase).toBe('tail');
      expect(result.artifacts.runId).toBe(LEGACY_RUN_ID);
      expect(result.activeAttemptId).toBe(`legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
      const proof = JSON.parse(fs.readFileSync(fixture.proofFile, 'utf8'));
      expect(proof.run.run_attempt).toBe(LEGACY_RUN_ATTEMPT);
      expect(proof.uploadJob).toEqual(uploadRow());
      expect(proof.verifiedAt).toBe(VERIFIED_AT);
      const persisted = storedState(fixture);
      expect(persisted).toEqual(result);
      expect(readPublicationPair({
        state: persisted, repoDir: fixture.repoDir, manifestSha256: persisted.artifacts.manifestSha256
      })).toEqual({
        manifest: fixture.observation.manifest,
        sourceSha: fixture.checkout.sourceSha,
        runId: LEGACY_RUN_ID,
        verifiedAt: VERIFIED_AT
      });
    });
  });

  describe('crash recovery', () => {
    test('completes a companion proof from a retained manifest without replacing its bytes', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedBytes = noisyManifestBytes(fixture.observation.manifest);
      expect(savedBytes.equals(fixture.observation.manifestBytes)).toBe(false);
      writeLeaf(fixture.manifestFile, savedBytes);
      const before = fileStat(fixture.manifestFile);

      const result = await persist(fixture);

      expect(result.artifacts.manifestSha256).toBe(sha256(savedBytes));
      expect(fs.readFileSync(fixture.manifestFile).equals(savedBytes)).toBe(true);
      expect(fileStat(fixture.manifestFile)).toEqual(before);
      const proof = JSON.parse(fs.readFileSync(fixture.proofFile, 'utf8'));
      expect(proof.manifestSha256).toBe(sha256(savedBytes));
      expect(proof.verifiedAt).toBe(VERIFIED_AT);
      expect(readPublicationPair({
        state: storedState(fixture),
        repoDir: fixture.repoDir,
        manifestSha256: result.artifacts.manifestSha256
      }).manifest).toEqual(fixture.observation.manifest);
    });

    test('recovers a complete retained pair without overwriting hashes, mtimes or verifiedAt', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedBytes = noisyManifestBytes(fixture.observation.manifest);
      const savedDigest = sha256(savedBytes);
      const savedProof = proofFor(fixture, savedDigest, { verifiedAt: SAVED_VERIFIED_AT });
      writeLeaf(fixture.manifestFile, savedBytes);
      writeLeaf(fixture.proofFile, Buffer.from(`${JSON.stringify(savedProof, null, 2)}\n`, 'utf8'));
      const manifestBefore = fileStat(fixture.manifestFile);
      const proofBefore = fileStat(fixture.proofFile);

      const result = await persist(fixture);

      expect(result.artifacts.manifestSha256).toBe(savedDigest);
      expect(result.artifacts.verifiedAt).toBe(SAVED_VERIFIED_AT);
      expect(fs.readFileSync(fixture.manifestFile).equals(savedBytes)).toBe(true);
      expect(fileStat(fixture.manifestFile)).toEqual(manifestBefore);
      expect(fileStat(fixture.proofFile)).toEqual(proofBefore);
    });

    test('recovers the same release after a flush failure without overwriting retained files', async () => {
      const fixture = makeFixture();
      let leafFlushes = 0;
      const failing = faultIo({
        fsync: (event) => {
          if (event.directory || typeof event.flags !== 'number') return false;
          leafFlushes += 1;
          return leafFlushes === 1;
        }
      });
      const error = expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));
      expect(error.message.length).toBeGreaterThan(0);
      expect(storedState(fixture).phase).toBe('workflow');
      const manifestBefore = fileStat(fixture.manifestFile);
      const proofBefore = fileStat(fixture.proofFile);

      const result = await persist(fixture);

      expect(result.phase).toBe('tail');
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fileStat(fixture.manifestFile)).toEqual(manifestBefore);
      expect(fileStat(fixture.proofFile)).toEqual(proofBefore);
    });
  });

  describe('failure boundaries', () => {
    test('a manifest rename failure leaves no evidence and no state event', async () => {
      const fixture = makeFixture();
      const failing = faultIo({ rename: () => true });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(fs.existsSync(fixture.manifestFile)).toBe(false);
      expect(fs.existsSync(fixture.proofFile)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('a manifest directory flush failure keeps the visible rename without a state event', async () => {
      const fixture = makeFixture();
      let flushes = 0;
      const failing = faultIo({
        fsync: (event) => {
          if (!event.directory || event.target !== fixture.attemptDir) return false;
          flushes += 1;
          return flushes === 1;
        }
      });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.existsSync(fixture.proofFile)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('a proof rename failure preserves the published manifest bytes', async () => {
      const fixture = makeFixture();
      const failing = faultIo({ rename: ({ to }) => to === fixture.proofFile });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.existsSync(fixture.proofFile)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('a retained leaf flush failure preserves both published files without a state event', async () => {
      const fixture = makeFixture();
      const failing = faultIo({
        fsync: (event) => !event.directory && typeof event.flags === 'number'
      });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('a directory flush failure after both renames prevents the phase tail', async () => {
      const fixture = makeFixture();
      let flushes = 0;
      const failing = faultIo({
        fsync: (event) => {
          if (!event.directory || event.target !== fixture.attemptDir) return false;
          flushes += 1;
          return flushes === 3;
        }
      });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('publication persistence boundary regression: the second attempt-directory flush immediately after the proof rename retains both files and the workflow state', async () => {
      const fixture = makeFixture();
      let flushes = 0;
      const failing = faultIo({
        fsync: (event) => {
          if (!event.directory || event.target !== fixture.attemptDir) return false;
          flushes += 1;
          return flushes === 2;
        }
      });

      expectPublicationFailure(await refusal(persist(fixture, { fs: failing.io })));

      expect(flushes).toBe(2);
      expect(flushOrder(fixture, failing.events).slice(-2)).toEqual([
        `rename ${PROOF_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`
      ]);
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);

      const manifestBefore = fileStat(fixture.manifestFile);
      const proofBefore = fileStat(fixture.proofFile);
      const result = await persist(fixture);

      expect(result.phase).toBe('tail');
      expect(result.revision).toBe(1);
      expect(result.artifacts.manifestSha256).toBe(sha256(fixture.observation.manifestBytes));
      expect(result.artifacts.verifiedAt).toBe(VERIFIED_AT);
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fileStat(fixture.manifestFile)).toEqual(manifestBefore);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(fileStat(fixture.proofFile)).toEqual(proofBefore);
      expect(JSON.parse(fs.readFileSync(fixture.proofFile, 'utf8')).verifiedAt).toBe(VERIFIED_AT);
    });

    test('publication persistence boundary regression: a state rename failure after both evidence files are flushed keeps the saved state and validates the pair', async () => {
      const fixture = makeFixture();
      const stateFile = path.join(fixture.repoDir, 'state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
      const originalStateBytes = fs.readFileSync(stateFile);
      expect(originalStateBytes.length).toBeGreaterThan(0);
      let injected = 0;
      const failing = faultIo({
        rename: ({ to }) => {
          if (to !== stateFile) return false;
          injected += 1;
          return true;
        }
      });

      const error = await refusal(persist(fixture, { fs: failing.io }));
      expect(error.cause.message).toBe('injected rename failure');

      expect(injected).toBe(1);
      expect(flushOrder(fixture, failing.events)).toEqual([
        'mkdir records',
        'fsync .',
        `mkdir records/${RELEASE_ID}`,
        'fsync records',
        `mkdir records/${RELEASE_ID}/artifacts`,
        `fsync records/${RELEASE_ID}`,
        `mkdir records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `fsync records/${RELEASE_ID}/artifacts`,
        `rename ${MANIFEST_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `rename ${PROOF_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        `fsync ${MANIFEST_FILE}`,
        `fsync ${PROOF_FILE}`,
        `fsync records/${RELEASE_ID}/artifacts/${fixture.attempt.id}`,
        'rename state.json'
      ]);
      expect(fs.readFileSync(stateFile).equals(originalStateBytes)).toBe(true);
      const saved = storedState(fixture);
      expect(saved).toEqual(fixture.state);
      expect(saved.revision).toBe(fixture.state.revision);
      expect(saved.phase).toBe('workflow');
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(readPublicationPair({
        state: saved,
        repoDir: fixture.repoDir,
        manifestSha256: sha256(fixture.observation.manifestBytes)
      })).toEqual({
        manifest: fixture.observation.manifest,
        sourceSha: fixture.checkout.sourceSha,
        runId: RUN_ID,
        verifiedAt: VERIFIED_AT
      });

      const manifestBefore = fileStat(fixture.manifestFile);
      const proofBefore = fileStat(fixture.proofFile);
      const result = await persist(fixture);

      expect(result.phase).toBe('tail');
      expect(result.revision).toBe(1);
      expect(result.artifacts.verifiedAt).toBe(VERIFIED_AT);
      expect(fs.readFileSync(fixture.manifestFile).equals(fixture.observation.manifestBytes)).toBe(true);
      expect(fileStat(fixture.manifestFile)).toEqual(manifestBefore);
      expect(fs.readFileSync(fixture.proofFile).equals(
        Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8')
      )).toBe(true);
      expect(fileStat(fixture.proofFile)).toEqual(proofBefore);
      expect(JSON.parse(fs.readFileSync(fixture.proofFile, 'utf8')).verifiedAt).toBe(VERIFIED_AT);
    });
  });

  describe('refusals', () => {
    test('refuses a changed source, version, run, job or digest before any file mutation', async () => {
      const fixture = makeFixture();
      const legacy = makeFixture({ legacy: true });
      const changedRun = runObject(fixture, {
        id: RUN_ID + 1,
        html_url: `https://github.com/${OWNER_REPO}/actions/runs/${RUN_ID + 1}`
      });
      const observations = [
        observationFor(fixture, { proof: { sourceSha: OTHER_SHA } }),
        observationFor(fixture, { manifest: { version: '9.9.9' } }),
        observationFor(fixture, { proof: { run: changedRun } }),
        observationFor(fixture, { proof: { manifestSha256: 'a'.repeat(64) } })
      ];
      for (const observation of observations) {
        expectPublicationFailure(await refusal(persist(fixture, { observation })));
      }
      expectPublicationFailure(await refusal(persist(legacy, {
        observation: observationFor(legacy, { proof: { uploadJob: uploadRow({ id: UPLOAD_JOB_ID + 1 }) } })
      })));

      expect(fs.existsSync(evidencePaths(fixture).records)).toBe(false);
      expect(fs.existsSync(evidencePaths(legacy).records)).toBe(false);
    });

    test('refuses a proof without its companion manifest and preserves it', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedProof = Buffer.from(`${JSON.stringify(fixture.observation.proof)}\n`, 'utf8');
      writeLeaf(fixture.proofFile, savedProof);
      const before = fileStat(fixture.proofFile);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.existsSync(fixture.manifestFile)).toBe(false);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(fileStat(fixture.proofFile)).toEqual(before);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses a malformed retained proof and preserves both files', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedManifest = noisyManifestBytes(fixture.observation.manifest);
      const savedProof = Buffer.from('{"schema": 1,', 'utf8');
      writeLeaf(fixture.manifestFile, savedManifest);
      writeLeaf(fixture.proofFile, savedProof);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.readFileSync(fixture.manifestFile).equals(savedManifest)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses an unsafe retained proof permission and preserves both files', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedManifest = noisyManifestBytes(fixture.observation.manifest);
      const savedProof = Buffer.from(`${JSON.stringify(proofFor(fixture, sha256(savedManifest)))}\n`, 'utf8');
      writeLeaf(fixture.manifestFile, savedManifest);
      writeLeaf(fixture.proofFile, savedProof);
      fs.chmodSync(fixture.proofFile, 0o666);

      const error = expectPublicationFailure(await refusal(persist(fixture)));

      expect(error.message).toBe('retained publication proof permissions are unsafe');
      expect(fs.readFileSync(fixture.manifestFile).equals(savedManifest)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(fileStat(fixture.proofFile).mode).toBe(0o666);
      expect(storedState(fixture)).toEqual(fixture.state);

      fs.chmodSync(fixture.proofFile, 0o600);
      const result = await persist(fixture);

      expect(result.phase).toBe('tail');
      expect(result.revision).toBe(1);
      expect(result.artifacts.manifestSha256).toBe(sha256(savedManifest));
      expect(result.artifacts.verifiedAt).toBe(VERIFIED_AT);
      expect(fs.readFileSync(fixture.manifestFile).equals(savedManifest)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
    });

    test('refuses a contradictory retained manifest and preserves both files', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const sizes = sizeMap();
      sizes[NAMES[0]] = sizes[NAMES[0]] + 1;
      const savedBytes = Buffer.from(JSON.stringify(manifestFor(fixture.checkout.sourceSha, { sizes })), 'utf8');
      const savedDigest = sha256(savedBytes);
      const savedProof = Buffer.from(`${JSON.stringify(proofFor(fixture, savedDigest))}\n`, 'utf8');
      writeLeaf(fixture.manifestFile, savedBytes);
      writeLeaf(fixture.proofFile, savedProof);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.readFileSync(fixture.manifestFile).equals(savedBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses a retained proof for another upload job and preserves both files', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedBytes = noisyManifestBytes(fixture.observation.manifest);
      const savedDigest = sha256(savedBytes);
      const savedProof = Buffer.from(`${JSON.stringify(proofFor(fixture, savedDigest, {
        uploadJob: uploadRow({ id: UPLOAD_JOB_ID + 1 })
      }))}\n`, 'utf8');
      writeLeaf(fixture.manifestFile, savedBytes);
      writeLeaf(fixture.proofFile, savedProof);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.readFileSync(fixture.manifestFile).equals(savedBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses an inconsistent pair whose proof digest is not the manifest digest', async () => {
      const fixture = makeFixture();
      mkdirEvidence(fixture);
      const savedBytes = noisyManifestBytes(fixture.observation.manifest);
      const savedProof = Buffer.from(`${JSON.stringify(proofFor(fixture, DIGEST))}\n`, 'utf8');
      writeLeaf(fixture.manifestFile, savedBytes);
      writeLeaf(fixture.proofFile, savedProof);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.readFileSync(fixture.manifestFile).equals(savedBytes)).toBe(true);
      expect(fs.readFileSync(fixture.proofFile).equals(savedProof)).toBe(true);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses an unsafe evidence directory and preserves it', async () => {
      const fixture = makeFixture();
      const attemptDir = mkdirEvidence(fixture);
      fs.chmodSync(path.join(fixture.repoDir, 'records'), 0o770);

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.existsSync(path.join(attemptDir, MANIFEST_FILE))).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses a stale input before any file mutation', async () => {
      const fixture = makeFixture();
      const stale = Object.assign({}, fixture.state, { revision: fixture.state.revision + 1 });
      const before = snapshotDir(fixture.repoDir);

      expectPublicationFailure(await refusal(persist(fixture, { state: stale })));

      expect(snapshotDir(fixture.repoDir)).toEqual(before);
      expect(fs.existsSync(evidencePaths(fixture).records)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses a drifted current repository identity before any file mutation', async () => {
      const fixture = makeFixture();
      const drifting = driftingRun(OTHER_ORIGIN_URL);

      const error = expectPublicationFailure(await refusal(persist(fixture, { run: drifting.run })));

      expect(drifting.calls.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
      expect(fs.existsSync(evidencePaths(fixture).records)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });

    test('refuses a complete artifacts record instead of emitting another event', async () => {
      const fixture = makeFixture({ complete: true });

      expectPublicationFailure(await refusal(persist(fixture)));

      expect(fs.existsSync(evidencePaths(fixture).records)).toBe(false);
      expect(storedState(fixture)).toEqual(fixture.state);
    });
  });
});
