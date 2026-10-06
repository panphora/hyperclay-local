'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { describePosix, isWindows } = require('../helpers/platform');

const {
  validateReleaseManifest,
  validatePublicationProof,
  validateLegacyPublicationProof,
  selectUploadJob,
  readPublishedSourceVersion,
  readPublicationPair,
  readPublicationEvidence
} = require('../../scripts/release-publication');
const { publicationAttemptDirectoryName } = require('../../scripts/release-publication-path');
const { createLocalGitReader } = require('../../scripts/release-local-read');

const FAILURE_CODE = 'PUBLICATION_EVIDENCE_INVALID';
const VERSION = '1.28.1';
const SOURCE_SHA1 = '3f9c1d7a4b2e5f8091a2b3c4d5e6f708192a3b4c';
const SOURCE_SHA256 = '3f9c1d7a4b2e5f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708';
const DATE = '2026-01-02T03:04:05.678Z';
const EXPECTED_SHA1 = { version: VERSION, sourceSha: SOURCE_SHA1 };
const FORBIDDEN_MODULES = [
  'release.js', 'post-build.js', 'write-download-sizes.js', 'release-command.js',
  'release-ferry.js', 'release-lock.js', 'release-state.js', 'release-state-store.js',
  'release-transcript.js', 'release-docs-apply.js', 'release-docs-run.js', 'release-target-evidence.js'
];

function installerNames(version = VERSION) {
  return [
    `HyperclayLocal-${version}-arm64.dmg`,
    `HyperclayLocal-${version}.dmg`,
    `HyperclayLocal-Setup-${version}.exe`,
    `HyperclayLocal-${version}.AppImage`,
    `HyperclayLocal-${version}-arm64.AppImage`
  ];
}

const NAMES = installerNames();

function shuffledFiles() {
  return [NAMES[2], NAMES[0], NAMES[4], NAMES[1], NAMES[3]];
}

function sizesFor(files, order) {
  const sizes = {};
  const sequence = order || files;
  for (const name of sequence) {
    const position = files.indexOf(name);
    sizes[name] = 1000 * (position + 1) + 7;
  }
  return sizes;
}

function manifest(overrides = {}) {
  const files = 'files' in overrides ? overrides.files : shuffledFiles();
  const sizes = 'sizes' in overrides ? overrides.sizes : sizesFor(files);
  return Object.assign({}, overrides, {
    version: 'version' in overrides ? overrides.version : VERSION,
    commit: 'commit' in overrides ? overrides.commit : SOURCE_SHA1,
    date: 'date' in overrides ? overrides.date : DATE,
    files,
    sizes
  });
}

function withFiles(files) {
  return manifest({ files, sizes: sizesFor(shuffledFiles()) });
}

const CHECKOUT_ROOT = '/Users/fixture/checkout/hyperclay-local';
const COMMON_DIR = path.join(CHECKOUT_ROOT, '.git');
const CACHE_ROOT = '/Users/fixture/.cache/hyperclay-local/releases';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const REPO = {
  key: sha256(COMMON_DIR),
  root: CHECKOUT_ROOT,
  commonDir: COMMON_DIR,
  branch: 'main',
  remote: 'origin',
  remoteRepo: 'github.com/fixture-owner/hyperclay-local',
  pushUrlSha256: sha256('git@github.com:fixture-owner/hyperclay-local.git'),
  objectFormat: 'sha1'
};

const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const OTHER_RELEASE_ID = '5c4b3a29-1d0e-4f6a-8b7c-2d1e0f9a8b7c';
const ATTEMPT_ID = '8b7c6d5e-4f3a-4b2c-9d1e-0a9b8c7d6e5f';
const OTHER_ATTEMPT_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const WORKFLOW_PATH = '.github/workflows/release.yml';
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
const MANIFEST_BYTES = JSON.stringify(manifest());
const MANIFEST_SHA256 = sha256(MANIFEST_BYTES);
const OTHER_DIGEST = 'a'.repeat(64);
const EXPECTED_TITLE = `release v${VERSION} publish sha=${SOURCE_SHA1} attempt=${ATTEMPT_ID}`;

function manifestPath(attemptId) {
  return path.join(CACHE_ROOT, REPO.key, 'records', RELEASE_ID, 'artifacts', attemptId, 'release-info.json');
}

function dispatchAttempt(patch = {}) {
  return Object.assign({
    id: ATTEMPT_ID,
    identityKind: 'dispatch',
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA1,
    dispatchRef: `v${VERSION}`,
    workflowPath: WORKFLOW_PATH,
    workflowId: WORKFLOW_ID,
    expectedTitle: EXPECTED_TITLE,
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
    sourceSha: SOURCE_SHA1,
    dispatchRef: null,
    workflowPath: WORKFLOW_PATH,
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
      observedHeadSha: SOURCE_SHA1,
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
    repo: REPO,
    releaseId: RELEASE_ID,
    version: VERSION,
    mode: 'publish',
    phase: 'workflow',
    createdAt: '2026-01-02T01:00:00.000Z',
    updatedAt: '2026-01-02T01:30:00.000Z',
    versionIntent: null,
    sourceSha: SOURCE_SHA1,
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

function dispatchState(patch = {}) {
  return releaseState(dispatchAttempt(), patch);
}

function legacyState(patch = {}) {
  return releaseState(legacyAttempt(), Object.assign({ phase: 'tail' }, patch));
}

function runRow(patch = {}) {
  const row = Object.assign({
    id: RUN_ID,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    workflow_id: WORKFLOW_ID,
    display_title: EXPECTED_TITLE,
    head_sha: SOURCE_SHA1,
    run_attempt: 1,
    created_at: RUN_CREATED_AT,
    updated_at: RUN_UPDATED_AT,
    repository: { full_name: 'fixture-owner/hyperclay-local' }
  }, patch);
  if (!Object.prototype.hasOwnProperty.call(patch, 'html_url')) {
    row.html_url = `https://github.com/fixture-owner/hyperclay-local/actions/runs/${row.id}`;
  }
  return row;
}

function legacyRunRow(patch = {}) {
  return runRow(Object.assign({
    id: LEGACY_RUN_ID,
    display_title: `release v${VERSION} publish sha=${SOURCE_SHA1}`,
    run_attempt: LEGACY_RUN_ATTEMPT
  }, patch));
}

function uploadJobRecord(patch = {}) {
  return Object.assign({
    id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success'
  }, patch);
}

function dispatchProof(patch = {}) {
  return Object.assign({
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: ATTEMPT_ID,
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA1,
    manifestSha256: MANIFEST_SHA256,
    verifiedAt: VERIFIED_AT,
    run: runRow(),
    uploadJobsRequest: { runId: RUN_ID, runAttempt: 1 },
    uploadJob: uploadJobRecord()
  }, patch);
}

function legacyProofRecord(patch = {}) {
  return Object.assign({
    schema: 1,
    releaseId: RELEASE_ID,
    attemptId: `legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`,
    version: VERSION,
    mode: 'publish',
    sourceSha: SOURCE_SHA1,
    manifestSha256: MANIFEST_SHA256,
    verifiedAt: VERIFIED_AT,
    run: legacyRunRow(),
    uploadJobsRequest: { runId: LEGACY_RUN_ID, runAttempt: LEGACY_RUN_ATTEMPT },
    uploadJob: uploadJobRecord()
  }, patch);
}

function context(state, attempt, digest = MANIFEST_SHA256) {
  return { state, attempt, manifestSha256: digest };
}

function proofRefusal(invoke) {
  let thrown = null;
  try {
    invoke();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).not.toBeNull();
  expect(thrown.code).toBe(FAILURE_CODE);
  expect(thrown.message).toEqual(expect.any(String));
  expect(thrown.message.length).toBeGreaterThan(0);
  return thrown;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function jobRow(patch = {}) {
  return Object.assign({
    id: BUILD_JOB_ID, name: 'build', status: 'completed', conclusion: 'success'
  }, patch);
}

const UPLOAD_REQUEST = { runId: RUN_ID, runAttempt: 1, sourceSha: SOURCE_SHA1 };

function refusal(info, expected = EXPECTED_SHA1) {
  let thrown = null;
  try {
    validateReleaseManifest(info, expected);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).not.toBeNull();
  expect(thrown.code).toBe(FAILURE_CODE);
  expect(thrown.message).toEqual(expect.any(String));
  expect(thrown.message.length).toBeGreaterThan(0);
  return thrown;
}

describe('validateReleaseManifest acceptance', () => {
  test('publication directory names encode legacy IDs only on Windows', () => {
    const legacyId = 'legacy:789:2';
    expect(publicationAttemptDirectoryName(legacyId, 'win32')).toBe('legacy%3A789%3A2');
    expect(publicationAttemptDirectoryName(legacyId, 'linux')).toBe(legacyId);
    expect(publicationAttemptDirectoryName(legacyId, 'darwin')).toBe(legacyId);
    const dispatchId = '00000000-0000-4000-8000-000000000001';
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(publicationAttemptDirectoryName(dispatchId, platform)).toBe(dispatchId);
    }
  });

  test.each([
    ['sha1', SOURCE_SHA1],
    ['sha256', SOURCE_SHA256]
  ])('accepts a complete five-installer manifest for %s', (label, sourceSha) => {
    const info = manifest({ commit: sourceSha });
    const result = validateReleaseManifest(info, { version: VERSION, sourceSha });

    expect(result).toEqual({ version: VERSION, commit: sourceSha, date: DATE, files: info.files, sizes: info.sizes });
    expect(result.files).toHaveLength(5);
    expect(result.files.length).toBeGreaterThan(0);
    expect(new Set(result.files).size).toBe(5);
    expect(Object.keys(result.sizes)).toHaveLength(5);
  });

  test('preserves the provided file order, sizes order and byte counts', () => {
    const files = shuffledFiles();
    const sizes = sizesFor(files, NAMES);
    const info = manifest({ files, sizes });
    const result = validateReleaseManifest(info, EXPECTED_SHA1);

    expect(result.files).toEqual([NAMES[2], NAMES[0], NAMES[4], NAMES[1], NAMES[3]]);
    expect(Object.keys(result.sizes)).toEqual(NAMES);
    expect(result.sizes).toEqual(sizes);
    for (const name of NAMES) {
      expect(Number.isSafeInteger(result.sizes[name])).toBe(true);
      expect(result.sizes[name]).toBeGreaterThan(0);
      expect(result.sizes[name]).toBe(sizes[name]);
    }
  });

  test('accepts a one-byte installer without a minimum download-size guess', () => {
    const sizes = {};
    for (const name of NAMES) sizes[name] = 1;
    expect(validateReleaseManifest(manifest({ sizes }), EXPECTED_SHA1).sizes).toEqual(sizes);
  });

  test('returns fresh nested data and leaves the supplied manifest untouched', () => {
    const info = manifest();
    const originalFiles = info.files.slice();
    const originalSizes = Object.assign({}, info.sizes);
    const before = JSON.stringify(info);

    const result = validateReleaseManifest(info, EXPECTED_SHA1);
    expect(result).not.toBe(info);
    expect(result.files).not.toBe(info.files);
    expect(result.sizes).not.toBe(info.sizes);

    result.files.push('HyperclayLocal-9.9.9.dmg');
    result.sizes[NAMES[0]] = 1;
    delete result.sizes[NAMES[1]];

    expect(info.files).toEqual(originalFiles);
    expect(info.sizes).toEqual(originalSizes);
    expect(JSON.stringify(info)).toBe(before);

    const second = validateReleaseManifest(info, EXPECTED_SHA1);
    expect(second).toEqual({ version: VERSION, commit: SOURCE_SHA1, date: DATE, files: originalFiles, sizes: originalSizes });
    expect(second.files).not.toBe(result.files);
    expect(second.sizes).not.toBe(result.sizes);
  });
});

describe('validateReleaseManifest record refusals', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['string', 'release-info'],
    ['number', 5],
    ['boolean', true],
    ['date instance', new Date()]
  ])('refuses a non-record manifest: %s', (label, info) => {
    refusal(info);
  });

  test.each([
    ['missing sizes', { version: VERSION, commit: SOURCE_SHA1, date: DATE, files: shuffledFiles() }],
    ['missing files', { version: VERSION, commit: SOURCE_SHA1, date: DATE, sizes: sizesFor(shuffledFiles()) }],
    ['missing date', { version: VERSION, commit: SOURCE_SHA1, files: shuffledFiles(), sizes: sizesFor(shuffledFiles()) }],
    ['missing commit', { version: VERSION, date: DATE, files: shuffledFiles(), sizes: sizesFor(shuffledFiles()) }],
    ['extra url', manifest({ url: 'https://local.hyperclay.com' })],
    ['extra bytes', manifest({ bytes: 12 })],
    ['renamed field', { release: VERSION, commit: SOURCE_SHA1, date: DATE, files: shuffledFiles(), sizes: sizesFor(shuffledFiles()) }]
  ])('refuses wrong exact fields: %s', (label, info) => {
    refusal(info);
  });
});

describe('validateReleaseManifest identity refusals', () => {
  test('refuses a manifest whose version is not the expected release', () => {
    const error = refusal(manifest({ version: '1.28.0' }));
    expect(error.message).not.toContain('1.28.0');
  });

  test('refuses a manifest whose commit is not the expected source', () => {
    const error = refusal(manifest({ commit: SOURCE_SHA256 }));
    expect(error.message).not.toContain(SOURCE_SHA256);
  });

  test.each([
    ['null expected', null],
    ['array expected', []],
    ['string expected', 'release'],
    ['missing sourceSha', { version: VERSION }],
    ['missing version', { sourceSha: SOURCE_SHA1 }],
    ['two-digit version', { version: '1.28', sourceSha: SOURCE_SHA1 }],
    ['prefixed version', { version: 'v1.28.1', sourceSha: SOURCE_SHA1 }],
    ['suffixed version', { version: '1.28.1-beta', sourceSha: SOURCE_SHA1 }],
    ['non-string version', { version: 128, sourceSha: SOURCE_SHA1 }],
    ['uppercase sourceSha', { version: VERSION, sourceSha: SOURCE_SHA1.toUpperCase() }],
    ['short sourceSha', { version: VERSION, sourceSha: SOURCE_SHA1.slice(0, 39) }],
    ['long sourceSha', { version: VERSION, sourceSha: SOURCE_SHA1 + 'a' }],
    ['non-hex sourceSha', { version: VERSION, sourceSha: 'z'.repeat(40) }],
    ['non-string sourceSha', { version: VERSION, sourceSha: null }]
  ])('refuses a malformed expected identity: %s', (label, expected) => {
    refusal(manifest(), expected);
  });
});

describe('validateReleaseManifest date refusals', () => {
  test.each([
    ['date only', '2026-01-02'],
    ['no milliseconds', '2026-01-02T03:04:05Z'],
    ['no zone', '2026-01-02T03:04:05.678'],
    ['offset zone', '2026-01-02T03:04:05.678+00:00'],
    ['non-zero offset', '2026-01-02T04:04:05.678+01:00'],
    ['unpadded', '2026-1-2T03:04:05.678Z'],
    ['invalid', 'not-a-date'],
    ['empty', ''],
    ['number', 1767323045678],
    ['null', null],
    ['array', [DATE]]
  ])('refuses a non-canonical date: %s', (label, date) => {
    refusal(manifest({ date }));
  });
});

describe('validateReleaseManifest file refusals', () => {
  test.each([
    ['missing the arm64 dmg', [NAMES[1], NAMES[2], NAMES[3], NAMES[4]]],
    ['missing the x64 dmg', [NAMES[0], NAMES[2], NAMES[3], NAMES[4]]],
    ['missing the exe', [NAMES[0], NAMES[1], NAMES[3], NAMES[4]]],
    ['missing the AppImage', [NAMES[0], NAMES[1], NAMES[2], NAMES[4]]],
    ['missing the arm64 AppImage', [NAMES[0], NAMES[1], NAMES[2], NAMES[3]]],
    ['extra sixth entry', NAMES.concat(['HyperclayLocal-1.28.1.dmg.blockmap'])],
    ['extra release-info.json', NAMES.concat(['release-info.json'])],
    ['duplicated entry', [NAMES[0], NAMES[0], NAMES[2], NAMES[3], NAMES[4]]],
    ['wrong version', installerNames('1.27.0')],
    ['wrong extension', [NAMES[0], NAMES[1], NAMES[2], NAMES[3], NAMES[4].replace('.AppImage', '.appimage')]],
    ['wrong dmg suffix', [NAMES[0], NAMES[1].replace('.dmg', '-x64.dmg'), NAMES[2], NAMES[3], NAMES[4]]],
    ['filename with path', [NAMES[0], NAMES[1], `executables/${NAMES[2]}`, NAMES[3], NAMES[4]]],
    ['filename with absolute path', [NAMES[0], NAMES[1], `/tmp/${NAMES[2]}`, NAMES[3], NAMES[4]]],
    ['non-string entry', [NAMES[0], NAMES[1], NAMES[2], NAMES[3], 5]],
    ['null entry', [NAMES[0], NAMES[1], NAMES[2], NAMES[3], null]],
    ['empty entry', [NAMES[0], NAMES[1], NAMES[2], NAMES[3], '']],
    ['not an array', NAMES.join(',')],
    ['record instead of array', Object.fromEntries(NAMES.map((name) => [name, true]))]
  ])('refuses files that are not exactly the five installers: %s', (label, files) => {
    refusal(withFiles(files));
  });
});

describe('validateReleaseManifest size refusals', () => {
  test.each([
    ['missing one key', NAMES.slice(1)],
    ['extra unknown key', NAMES.concat(['release-info.json'])],
    ['wrong-version key', installerNames('1.27.0')],
    ['path key', NAMES.slice(1).concat([`executables/${NAMES[0]}`])]
  ])('refuses a sizes record that does not cover exactly the five installers: %s', (label, order) => {
    const files = shuffledFiles();
    refusal(manifest({ files, sizes: sizesFor(files, order) }));
  });

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['float', 1024.5],
    ['null', null],
    ['undefined', undefined],
    ['string', '1024'],
    ['numeric string', '0'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative Infinity', -Infinity],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['array', [1024]],
    ['record', { bytes: 1024 }]
  ])('refuses a %s byte count', (label, bytes) => {
    const sizes = sizesFor(shuffledFiles());
    sizes[NAMES[0]] = bytes;
    refusal(manifest({ sizes }));
  });

  test.each([
    ['null', null],
    ['array', NAMES.map((name) => [name, 1024])],
    ['string', 'sizes'],
    ['number', 1024],
    ['boolean', false]
  ])('refuses a non-record sizes field: %s', (label, sizes) => {
    refusal(manifest({ sizes }));
  });
});

describe('validateReleaseManifest purity', () => {
  test('loads no acting, network or build helper on ordinary require', () => {
    const modulePath = require.resolve('../../scripts/release-publication');
    expect(require.cache[modulePath]).toBeDefined();

    const scriptsDir = path.join(path.resolve(__dirname, '..', '..'), 'scripts') + path.sep;
    const loaded = Object.keys(require.cache)
      .filter((file) => file.startsWith(scriptsDir))
      .map((file) => path.basename(file));

    expect(loaded).toContain('release-publication.js');
    for (const name of FORBIDDEN_MODULES) expect(loaded).not.toContain(name);
    expect(Object.keys(require('../../scripts/release-publication'))).toEqual([
      'validateReleaseManifest', 'validatePublicationProof', 'validateLegacyPublicationProof', 'selectUploadJob',
      'readPublishedSourceVersion', 'readPublicationPair', 'readPublicationEvidence'
    ]);
  });

  test('emits field-specific diagnostics that never echo supplied values', () => {
    const leaky = [
      [manifest({ version: '1.28.0' }), EXPECTED_SHA1],
      [manifest({ commit: SOURCE_SHA256 }), EXPECTED_SHA1],
      [manifest({ date: 'not-a-date' }), EXPECTED_SHA1],
      [withFiles([NAMES[0], NAMES[1], NAMES[2], NAMES[3], 'secret-installer.dmg']), EXPECTED_SHA1],
      [manifest(), { version: VERSION, sourceSha: 'f'.repeat(40) }]
    ];
    for (const [info, expected] of leaky) {
      const error = refusal(info, expected);
      expect(error.message).not.toContain(VERSION);
      expect(error.message).not.toContain(SOURCE_SHA1);
      expect(error.message).not.toContain(SOURCE_SHA256);
      expect(error.message).not.toContain('1.28.0');
      expect(error.message).not.toContain(DATE);
      expect(error.message).not.toContain('not-a-date');
      expect(error.message).not.toContain('secret-installer.dmg');
      expect(error.message).not.toContain('f'.repeat(40));
      expect(error.message).toMatch(/release-info|expected|version|commit|date|files|sizes|sourceSha/);
    }
  });
});

const COMPLETE_ARTIFACTS = {
  state: 'complete',
  sourceSha: SOURCE_SHA1,
  runId: RUN_ID,
  manifestFile: manifestPath(ATTEMPT_ID),
  manifestSha256: MANIFEST_SHA256,
  verifiedAt: VERIFIED_AT
};

const DISPATCH_REFUSALS = [
  ['a proof for another release', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ releaseId: OTHER_RELEASE_ID }), context(state, state.attempts[0]));
  }],
  ['a proof for another attempt', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ attemptId: OTHER_ATTEMPT_ID }), context(state, state.attempts[0]));
  }],
  ['a proof for another version', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ version: '1.27.0' }), context(state, state.attempts[0]));
  }],
  ['a proof that claims a dry run', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ mode: 'dry-run' }), context(state, state.attempts[0]));
  }],
  ['a dry-run release state', () => {
    const state = dispatchState({ mode: 'dry-run' });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['a proof for another source', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ sourceSha: SOURCE_SHA256 }), context(state, state.attempts[0]));
  }],
  ['a proof for another digest', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ manifestSha256: OTHER_DIGEST }), context(state, state.attempts[0]));
  }],
  ['a digest that is not the retained manifest digest', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0], OTHER_DIGEST));
  }],
  ['a proof with an extra field', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ url: 'https://local.hyperclay.com' }), context(state, state.attempts[0]));
  }],
  ['a proof missing its run', () => {
    const state = dispatchState();
    const proof = dispatchProof();
    delete proof.run;
    return validatePublicationProof(proof, context(state, state.attempts[0]));
  }],
  ['a proof with a non-canonical verifiedAt', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ verifiedAt: '2026-01-02T03:04:05Z' }), context(state, state.attempts[0]));
  }],
  ['a proof whose run is not the bound run', () => {
    const state = dispatchState();
    return validatePublicationProof(dispatchProof({ run: runRow({ id: 457 }) }), context(state, state.attempts[0]));
  }],
  ['a proof whose run attempt is not the bound attempt', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ run_attempt: 2 }) }), context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload jobs request is another run', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJobsRequest: { runId: 457, runAttempt: 1 } }), context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload jobs request is another attempt', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJobsRequest: { runId: RUN_ID, runAttempt: 2 } }), context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload job is named differently', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJob: uploadJobRecord({ name: 'test' }) }), context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload job is not completed', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJob: uploadJobRecord({ status: 'in_progress', conclusion: null }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload job did not succeed', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJob: uploadJobRecord({ conclusion: 'failure' }) }), context(state, state.attempts[0])
    );
  }],
  ['a proof whose upload job has no positive id', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ uploadJob: uploadJobRecord({ id: 0 }) }), context(state, state.attempts[0])
    );
  }],
  ['a failed run', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ conclusion: 'failure' }) }), context(state, state.attempts[0])
    );
  }],
  ['an unfinished run', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ status: 'in_progress', conclusion: null }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a run whose title is not the exact dispatch title', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ display_title: 'Release' }) }), context(state, state.attempts[0])
    );
  }],
  ['a run whose title carries another attempt', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ display_title: `release v${VERSION} publish sha=${SOURCE_SHA1} attempt=${OTHER_ATTEMPT_ID}` }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a run of another source', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ head_sha: SOURCE_SHA256 }) }), context(state, state.attempts[0])
    );
  }],
  ['a run of another repository', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ repository: { full_name: 'other-owner/hyperclay-local' } }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a run of another workflow', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ workflow_id: 54321 }) }), context(state, state.attempts[0])
    );
  }],
  ['a run that was not workflow dispatched', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ event: 'push' }) }), context(state, state.attempts[0])
    );
  }],
  ['a run whose url points at another run', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ html_url: 'https://github.com/fixture-owner/hyperclay-local/actions/runs/457' }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a run with an impossible creation date', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ created_at: 'yesterday' }) }), context(state, state.attempts[0])
    );
  }],
  ['a run updated before it was created', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ updated_at: '2026-01-02T01:00:00Z' }) }), context(state, state.attempts[0])
    );
  }],
  ['a run with an insecure url', () => {
    const state = dispatchState();
    return validatePublicationProof(
      dispatchProof({ run: runRow({ html_url: `http://github.com/fixture-owner/hyperclay-local/actions/runs/${RUN_ID}` }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a release state without an active attempt', () => {
    const state = dispatchState({ activeAttemptId: null });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['a release state whose active attempt is absent', () => {
    const state = dispatchState({ activeAttemptId: OTHER_ATTEMPT_ID });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['an attempt that is not the active entry', () => {
    const first = dispatchAttempt();
    const second = dispatchAttempt({ id: OTHER_ATTEMPT_ID });
    const state = releaseState(second, { attempts: [first, second] });
    return validatePublicationProof(dispatchProof({ attemptId: OTHER_ATTEMPT_ID }), context(state, first));
  }],
  ['an attempt that only shares the active attempt id', () => {
    const state = dispatchState();
    const lookalike = Object.assign({}, state.attempts[0], { sourceSha: SOURCE_SHA256 });
    return validatePublicationProof(dispatchProof(), context(state, lookalike));
  }],
  ['an attempt that was never identified', () => {
    const state = dispatchState();
    const attempt = Object.assign({}, state.attempts[0], { dispatch: 'ready' });
    return validatePublicationProof(dispatchProof(), context(state, attempt));
  }],
  ['an attempt that did not conclude success', () => {
    const state = dispatchState();
    const attempt = Object.assign({}, state.attempts[0], { conclusion: 'failure' });
    return validatePublicationProof(dispatchProof(), context(state, attempt));
  }],
  ['complete artifacts recording another source', () => {
    const state = dispatchState({ phase: 'tail', artifacts: Object.assign({}, COMPLETE_ARTIFACTS, { sourceSha: SOURCE_SHA256 }) });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['complete artifacts recording another run', () => {
    const state = dispatchState({ phase: 'tail', artifacts: Object.assign({}, COMPLETE_ARTIFACTS, { runId: 457 }) });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['complete artifacts recording another digest', () => {
    const state = dispatchState({ phase: 'tail', artifacts: Object.assign({}, COMPLETE_ARTIFACTS, { manifestSha256: OTHER_DIGEST }) });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['complete artifacts recording another time', () => {
    const state = dispatchState({
      phase: 'tail',
      artifacts: Object.assign({}, COMPLETE_ARTIFACTS, { verifiedAt: '2026-01-02T05:06:07.000Z' })
    });
    return validatePublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['a legacy attempt presented as a dispatch proof', () => {
    const state = legacyState();
    return validatePublicationProof(legacyProofRecord(), context(state, state.attempts[0]));
  }]
];

const LEGACY_REFUSALS = [
  ['a dispatch attempt presented as a legacy proof', () => {
    const state = dispatchState();
    return validateLegacyPublicationProof(dispatchProof(), context(state, state.attempts[0]));
  }],
  ['a legacy attempt id that is not its derived id', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], { id: `legacy:${LEGACY_RUN_ID}:1` });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy attempt carrying a dispatch title', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], { expectedTitle: EXPECTED_TITLE });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy attempt carrying a dispatch ref', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], { dispatchRef: 'main' });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy attempt carrying dispatch request times', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], { requestedAt: REQUESTED_AT });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy proof whose job is not the recorded upload job', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ uploadJob: uploadJobRecord({ id: BUILD_JOB_ID }) }), context(state, state.attempts[0])
    );
  }],
  ['a legacy attempt whose recorded upload job did not succeed', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], {
      legacyProof: Object.assign({}, state.attempts[0].legacyProof, { uploadJobConclusion: 'failure' })
    });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy attempt whose recorded source is not its source', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], {
      legacyProof: Object.assign({}, state.attempts[0].legacyProof, { observedHeadSha: SOURCE_SHA256 })
    });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy attempt whose recorded mode is not publish', () => {
    const state = legacyState();
    const attempt = Object.assign({}, state.attempts[0], {
      legacyProof: Object.assign({}, state.attempts[0].legacyProof, { observedMode: 'dry-run' })
    });
    return validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt));
  }],
  ['a legacy run whose observed title carries a new-format attempt token', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ display_title: `release v${VERSION} publish attempt=${ATTEMPT_ID}` }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a failed legacy run', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ conclusion: 'failure' }) }), context(state, state.attempts[0])
    );
  }],
  ['a legacy run observed at another attempt', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ run_attempt: 3 }) }), context(state, state.attempts[0])
    );
  }],
  ['a legacy proof whose run is not the recorded run', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ id: RUN_ID }) }), context(state, state.attempts[0])
    );
  }],
  ['a legacy run of another source', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ head_sha: SOURCE_SHA256 }) }), context(state, state.attempts[0])
    );
  }],
  ['a legacy run of another repository', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ run: legacyRunRow({ repository: { full_name: 'other-owner/hyperclay-local' } }) }),
      context(state, state.attempts[0])
    );
  }],
  ['a legacy proof for another digest', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ manifestSha256: OTHER_DIGEST }), context(state, state.attempts[0])
    );
  }],
  ['a legacy proof that claims a dry run', () => {
    const state = legacyState();
    return validateLegacyPublicationProof(
      legacyProofRecord({ mode: 'dry-run' }), context(state, state.attempts[0])
    );
  }],
  ['a legacy attempt that is not the active entry', () => {
    const first = legacyAttempt();
    const second = legacyAttempt({ id: `legacy:${LEGACY_RUN_ID}:3`, runAttempt: 3 });
    const state = releaseState(second, { phase: 'tail', attempts: [first, second] });
    return validateLegacyPublicationProof(
      legacyProofRecord({ attemptId: second.id, uploadJobsRequest: { runId: LEGACY_RUN_ID, runAttempt: 3 }, run: legacyRunRow({ run_attempt: 3 }) }),
      context(state, first)
    );
  }]
];

describe('publication proof acceptance', () => {
  test('accepts a deterministic dispatch proof beside the real manifest validator', () => {
    const state = dispatchState();
    const proof = dispatchProof();

    expect(validateReleaseManifest(JSON.parse(MANIFEST_BYTES), EXPECTED_SHA1)).toEqual(JSON.parse(MANIFEST_BYTES));
    expect(MANIFEST_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(MANIFEST_SHA256).not.toBe('0'.repeat(64));

    const result = validatePublicationProof(proof, context(state, state.attempts[0]));
    expect(result).toEqual({ verifiedAt: VERIFIED_AT });
    expect(Object.keys(result)).toEqual(['verifiedAt']);
  });

  test('accepts a real legacy proof whose run attempt is beyond one', () => {
    const state = legacyState();
    const attempt = state.attempts[0];

    expect(attempt.identityKind).toBe('legacy-upload-proof');
    expect(attempt.id).toBe(`legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
    expect(attempt.runAttempt).toBeGreaterThan(1);
    expect(attempt.expectedTitle).toBeNull();
    expect(attempt.dispatchRef).toBeNull();

    expect(validateLegacyPublicationProof(legacyProofRecord(), context(state, attempt))).toEqual({ verifiedAt: VERIFIED_AT });
  });

  test('accepts a legacy proof whose observed attempt is an arbitrary positive attempt', () => {
    const attempt = legacyAttempt({ id: `legacy:${LEGACY_RUN_ID}:7`, runAttempt: 7 });
    const state = releaseState(attempt, { phase: 'tail' });
    const proof = legacyProofRecord({
      attemptId: attempt.id,
      run: legacyRunRow({ run_attempt: 7 }),
      uploadJobsRequest: { runId: LEGACY_RUN_ID, runAttempt: 7 }
    });

    expect(validateLegacyPublicationProof(proof, context(state, attempt))).toEqual({ verifiedAt: VERIFIED_AT });
  });

  test('accepts the same proof while artifacts are pending and once they are complete', () => {
    const pending = dispatchState();
    expect(validatePublicationProof(dispatchProof(), context(pending, pending.attempts[0]))).toEqual({ verifiedAt: VERIFIED_AT });

    const complete = dispatchState({ phase: 'tail', artifacts: COMPLETE_ARTIFACTS });
    expect(validatePublicationProof(dispatchProof(), context(complete, complete.attempts[0]))).toEqual({ verifiedAt: VERIFIED_AT });
    expect(COMPLETE_ARTIFACTS.manifestFile).toBe(manifestPath(ATTEMPT_ID));
  });

  test('returns fresh results and leaves the supplied proof, state and attempt untouched', () => {
    const state = deepFreeze(dispatchState());
    const proof = deepFreeze(dispatchProof());
    const proofBefore = JSON.stringify(proof);
    const stateBefore = JSON.stringify(state);

    const result = validatePublicationProof(proof, context(state, state.attempts[0]));
    expect(result).not.toBe(proof);
    expect(JSON.stringify(proof)).toBe(proofBefore);
    expect(JSON.stringify(state)).toBe(stateBefore);

    result.verifiedAt = 'tampered';
    expect(validatePublicationProof(proof, context(state, state.attempts[0])).verifiedAt).toBe(VERIFIED_AT);
  });
});

describe('publication proof refusals', () => {
  test.each(DISPATCH_REFUSALS)('%s is refused', (label, invoke) => {
    proofRefusal(invoke);
  });

  test.each(LEGACY_REFUSALS)('%s is refused', (label, invoke) => {
    proofRefusal(invoke);
  });

  test('a refusal never echoes supplied provider values', () => {
    const state = dispatchState();
    const error = proofRefusal(() => validatePublicationProof(
      dispatchProof({
        manifestSha256: OTHER_DIGEST,
        run: runRow({
          display_title: 'secret-title',
          html_url: 'https://user:secret-token@github.com/fixture-owner/hyperclay-local/actions/runs/457'
        })
      }),
      context(state, state.attempts[0])
    ));
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain('secret-title');
    expect(error.message).not.toContain(OTHER_DIGEST);
    expect(error.message).not.toContain(SOURCE_SHA1);
    expect(error.message.length).toBeLessThan(200);
  });

  test('a refusal retains the shared workflow cause without dumping provider data', () => {
    const state = dispatchState();
    const error = proofRefusal(() => validatePublicationProof(
      dispatchProof({ run: runRow({ head_sha: SOURCE_SHA256 }) }), context(state, state.attempts[0])
    ));
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.code).toBe('WORKFLOW_IDENTITY_CONFLICT');
    expect(error.cause.reason).toBe('source');
    expect(error.cause.candidateId).toBe(RUN_ID);
  });
});

describe('publication proof upload job selection', () => {
  test('selects the single completed upload row from the complete multi-page response', () => {
    const pages = [
      {
        total_count: 3,
        jobs: [
          jobRow({ id: BUILD_JOB_ID, name: 'build' }),
          jobRow({
            id: UPLOAD_JOB_ID, name: 'upload', run_id: RUN_ID, run_attempt: 1,
            head_sha: SOURCE_SHA1, started_at: RUN_CREATED_AT
          })
        ]
      },
      { total_count: 3, jobs: [jobRow({ id: 5001, name: 'release', conclusion: 'failure' })] }
    ];
    expect(pages[0].total_count).toBeGreaterThan(0);
    expect(pages.reduce((count, page) => count + page.jobs.length, 0)).toBe(pages[0].total_count);

    const selected = selectUploadJob(pages, UPLOAD_REQUEST);
    expect(selected).toEqual({ id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' });
    expect(Object.keys(selected)).toEqual(['id', 'name', 'status', 'conclusion']);
  });

  test('returns a fresh result and leaves the supplied pages untouched', () => {
    const pages = deepFreeze([{ total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', extra: { provider: true } })] }]);
    const before = JSON.stringify(pages);
    const selected = selectUploadJob(pages, UPLOAD_REQUEST);
    expect(selected).not.toBe(pages[0].jobs[0]);
    expect(JSON.stringify(pages)).toBe(before);
    expect(Object.keys(selected)).toEqual(['id', 'name', 'status', 'conclusion']);
    expect(selected.extra).toBeUndefined();
    expect(selected.provider).toBeUndefined();
  });

  test('a refusal never echoes a supplied page value', () => {
    const error = proofRefusal(() => selectUploadJob(
      [{ total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'secret-upload-name', conclusion: 'failure' })] }],
      UPLOAD_REQUEST
    ));
    expect(error.message).not.toContain('secret-upload-name');
  });
});

describe('publication proof response page identity', () => {
  const MATCHING_IDENTITY = { run_id: RUN_ID, run_attempt: 1, head_sha: SOURCE_SHA1 };
  const CONTRADICTIONS = [
    ['run id', { run_id: RUN_ID + 1 }],
    ['run attempt', { run_attempt: 2 }],
    ['head sha', { head_sha: SOURCE_SHA256 }]
  ];
  const MALFORMED = [
    ['a null run id', { run_id: null }],
    ['a zero run id', { run_id: 0 }],
    ['a string run id', { run_id: String(RUN_ID) }],
    ['a null run attempt', { run_attempt: null }],
    ['a zero run attempt', { run_attempt: 0 }],
    ['a string run attempt', { run_attempt: String(1) }],
    ['a null head sha', { head_sha: null }],
    ['a head sha that is not an object id', { head_sha: 'main' }],
    ['a numeric head sha', { head_sha: 42 }]
  ];

  function firstPage(identity) {
    return [Object.assign({
      total_count: 2,
      jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' }), jobRow({ id: BUILD_JOB_ID, name: 'build' })]
    }, identity)];
  }

  function laterPage(identity) {
    return [
      { total_count: 2, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] },
      Object.assign({ total_count: 2, jobs: [jobRow({ id: BUILD_JOB_ID, name: 'build' })] }, identity)
    ];
  }

  const REFUSALS = [];
  CONTRADICTIONS.forEach(([field, identity]) => {
    REFUSALS.push(
      [`a first page whose ${field} contradicts the request`, firstPage(identity)],
      [`a later page whose ${field} contradicts the request after a successful upload`, laterPage(identity)]
    );
  });
  MALFORMED.forEach(([label, identity]) => {
    REFUSALS.push(
      [`a first page carrying ${label}`, firstPage(identity)],
      [`a later page carrying ${label} after a successful upload`, laterPage(identity)]
    );
  });

  const CONTROLS = [
    ['a first page carrying matching optional identity', firstPage(MATCHING_IDENTITY)],
    ['a later page carrying matching optional identity', laterPage(MATCHING_IDENTITY)],
    ['a first page without optional identity', firstPage()],
    ['a later page without optional identity', laterPage()]
  ];

  test.each(REFUSALS)('%s is refused', (label, pages) => {
    proofRefusal(() => selectUploadJob(pages, UPLOAD_REQUEST));
  });

  test.each(CONTROLS)('%s still selects the exact upload', (label, pages) => {
    const selected = selectUploadJob(pages, UPLOAD_REQUEST);
    expect(selected).toEqual({ id: UPLOAD_JOB_ID, name: 'upload', status: 'completed', conclusion: 'success' });
    expect(Object.keys(selected)).toEqual(['id', 'name', 'status', 'conclusion']);
  });

  test('the page identity case tables are nonzero', () => {
    expect(REFUSALS.length).toBe(24);
    expect(CONTROLS.length).toBe(4);
    expect(REFUSALS.length).toBeGreaterThan(0);
    expect(CONTROLS.length).toBeGreaterThan(0);
  });
});

const UPLOAD_REFUSALS = [
  ['a duplicate upload row beside a successful one', () => selectUploadJob([
    { total_count: 2, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' }), jobRow({ id: 5002, name: 'upload', conclusion: 'skipped' })] }
  ], UPLOAD_REQUEST)],
  ['a duplicate upload row beside a failed one', () => selectUploadJob([
    { total_count: 2, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', conclusion: 'failure' }), jobRow({ id: 5002, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a lone failed upload row', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', conclusion: 'failure' })] }
  ], UPLOAD_REQUEST)],
  ['a lone skipped upload row', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', conclusion: 'skipped' })] }
  ], UPLOAD_REQUEST)],
  ['a response without an upload row', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: BUILD_JOB_ID, name: 'build' })] }
  ], UPLOAD_REQUEST)],
  ['pages that disagree on total_count', () => selectUploadJob([
    { total_count: 2, jobs: [jobRow({ id: BUILD_JOB_ID }), jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] },
    { total_count: 3, jobs: [jobRow({ id: 5003, name: 'release' })] }
  ], UPLOAD_REQUEST)],
  ['a partial page that drops a later row', () => selectUploadJob([
    { total_count: 4, jobs: [jobRow({ id: BUILD_JOB_ID }), jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a partial page that drops a later page', () => selectUploadJob([
    { total_count: 200, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a page with more than one hundred rows', () => selectUploadJob([
    {
      total_count: 101,
      jobs: Array.from({ length: 101 }, (value, index) => jobRow({
        id: index + 1, name: index === 100 ? 'upload' : 'build'
      }))
    }
  ], UPLOAD_REQUEST)],
  ['more than one hundred pages', () => selectUploadJob(
    Array.from({ length: 101 }, (value, index) => ({ total_count: 101, jobs: [jobRow({ id: index + 1, name: 'build' })] })),
    UPLOAD_REQUEST
  )],
  ['an empty page sequence', () => selectUploadJob([], UPLOAD_REQUEST)],
  ['duplicate job ids across pages', () => selectUploadJob([
    { total_count: 2, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] },
    { total_count: 2, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'build' })] }
  ], UPLOAD_REQUEST)],
  ['a negative total_count', () => selectUploadJob([
    { total_count: -1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a fractional total_count', () => selectUploadJob([
    { total_count: 1.5, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a string total_count', () => selectUploadJob([
    { total_count: '1', jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a page that is not a record', () => selectUploadJob(['page'], UPLOAD_REQUEST)],
  ['a page without a jobs array', () => selectUploadJob([
    { total_count: 1, jobs: { 0: jobRow({ id: UPLOAD_JOB_ID, name: 'upload' }) } }
  ], UPLOAD_REQUEST)],
  ['a row that is not a record', () => selectUploadJob([
    { total_count: 1, jobs: ['row'] }
  ], UPLOAD_REQUEST)],
  ['a row without a positive job id', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: 0, name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a row with a string job id', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: '4242', name: 'upload' })] }
  ], UPLOAD_REQUEST)],
  ['a row without a name', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: '' })] }
  ], UPLOAD_REQUEST)],
  ['a row with a numeric name', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 42 })] }
  ], UPLOAD_REQUEST)],
  ['a row with an unknown status', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', status: 'running' })] }
  ], UPLOAD_REQUEST)],
  ['a completed row without a conclusion', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', conclusion: null })] }
  ], UPLOAD_REQUEST)],
  ['an unfinished row carrying a conclusion', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', status: 'in_progress', conclusion: 'success' })] }
  ], UPLOAD_REQUEST)],
  ['a row whose own run id contradicts the requested run', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', run_id: 457 })] }
  ], UPLOAD_REQUEST)],
  ['a row whose own run attempt contradicts the requested attempt', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', run_attempt: 2 })] }
  ], UPLOAD_REQUEST)],
  ['a row whose own head sha contradicts the requested source', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', head_sha: SOURCE_SHA256 })] }
  ], UPLOAD_REQUEST)],
  ['a row whose own head sha is not an object id', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload', head_sha: 'main' })] }
  ], UPLOAD_REQUEST)],
  ['a request without a positive run id', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], Object.assign({}, UPLOAD_REQUEST, { runId: 0 }))],
  ['a request without a positive run attempt', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], Object.assign({}, UPLOAD_REQUEST, { runAttempt: null }))],
  ['a request without a full source object id', () => selectUploadJob([
    { total_count: 1, jobs: [jobRow({ id: UPLOAD_JOB_ID, name: 'upload' })] }
  ], Object.assign({}, UPLOAD_REQUEST, { sourceSha: 'main' }))]
];

describe('publication proof upload job refusals', () => {
  test.each(UPLOAD_REFUSALS)('%s is refused', (label, invoke) => {
    proofRefusal(invoke);
  });

  test('the refusal table is nonzero and covers every required class', () => {
    expect(UPLOAD_REFUSALS.length).toBeGreaterThan(20);
    expect(DISPATCH_REFUSALS.length).toBeGreaterThan(30);
    expect(LEGACY_REFUSALS.length).toBeGreaterThan(12);
  });
});

jest.setTimeout(60000);

const HISTORY_OWNER = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hc-release-publication-history-'));
const HISTORY_NO_HOOKS = path.join(HISTORY_OWNER, 'no-hooks');
const HISTORY_GIT_CONFIG = path.join(HISTORY_OWNER, 'gitconfig');
const HISTORY_STDIO = ['ignore', 'pipe', 'pipe'];

fs.mkdirSync(HISTORY_NO_HOOKS, { recursive: true });
fs.writeFileSync(HISTORY_GIT_CONFIG, [
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
  `\thooksPath = ${JSON.stringify(HISTORY_NO_HOOKS.replace(/\\/g, '/'))}`,
  '\tautocrlf = false',
  ''
].join('\n'));

const HISTORY_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: HISTORY_GIT_CONFIG,
  GIT_OPTIONAL_LOCKS: '0'
};

afterAll(() => {
  fs.rmSync(HISTORY_OWNER, { recursive: true, force: true });
});

let historySeq = 0;

function historyGit(cwd, args, options = {}) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...options,
    env: { ...HISTORY_ENV, ...(options.env || {}) }
  });
}

function packageBody(version) {
  return `${JSON.stringify({ name: 'hyperclay-local-electron', version, private: true }, null, 2)}\n`;
}

function historyTitle(sourceSha) {
  return `release v${VERSION} publish sha=${sourceSha} attempt=${ATTEMPT_ID}`;
}

function historyCheckout({ packageText = packageBody(VERSION), symlinkTo = null } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(HISTORY_OWNER, `checkout-${++historySeq}-`)));
  historyGit(root, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'README.md'), 'hyperclay local\n');
  if (symlinkTo === null) {
    fs.writeFileSync(path.join(root, 'package.json'), packageText);
  } else {
    fs.writeFileSync(path.join(root, symlinkTo), packageText);
    fs.symlinkSync(symlinkTo, path.join(root, 'package.json'));
  }
  historyGit(root, ['add', '-A']);
  historyGit(root, ['commit', '-q', '-m', 'release source']);
  return {
    root,
    commonDir: fs.realpathSync.native(path.join(root, '.git')),
    sourceSha: historyGit(root, ['rev-parse', 'HEAD']).trim()
  };
}

function historyIdentity(checkout) {
  return {
    key: sha256(checkout.commonDir),
    root: checkout.root,
    commonDir: checkout.commonDir,
    branch: 'main',
    remote: 'origin',
    remoteRepo: 'github.com/fixture-owner/hyperclay-local',
    pushUrlSha256: sha256('git@github.com:fixture-owner/hyperclay-local.git'),
    objectFormat: 'sha1'
  };
}

function historyBase(options = {}) {
  const checkout = options.checkout === undefined ? historyCheckout(options) : options.checkout;
  const identity = historyIdentity(checkout);
  const repoDir = path.join(fs.mkdtempSync(path.join(HISTORY_OWNER, `cache-${++historySeq}-`)), identity.key);
  fs.mkdirSync(repoDir, { recursive: true, mode: 0o700 });
  const sourceSha = options.sourceSha === undefined ? checkout.sourceSha : options.sourceSha;
  const legacy = Boolean(options.legacy);
  const attempt = legacy
    ? legacyAttempt({
      sourceSha,
      legacyProof: {
        uploadJobId: UPLOAD_JOB_ID,
        uploadJobConclusion: 'success',
        observedHeadSha: sourceSha,
        observedMode: 'publish'
      }
    })
    : dispatchAttempt({ sourceSha, expectedTitle: historyTitle(sourceSha) });
  const manifestBytes = Buffer.from(JSON.stringify(manifest({ commit: sourceSha })), 'utf8');
  const digest = sha256(manifestBytes);
  const proof = legacy
    ? legacyProofRecord({ sourceSha, manifestSha256: digest, run: legacyRunRow({ head_sha: sourceSha }) })
    : dispatchProof({ sourceSha, manifestSha256: digest, run: historyRunRow(sourceSha) });
  return { checkout, identity, repoDir, sourceSha, attempt, manifestBytes, digest, proof };
}

function historyRunRow(sourceSha) {
  return runRow({ head_sha: sourceSha, display_title: historyTitle(sourceSha) });
}

function historyAttemptDir(repoDir, attemptId) {
  return path.join(repoDir, 'records', RELEASE_ID, 'artifacts', publicationAttemptDirectoryName(attemptId));
}

function historyManifestPath(base) {
  return path.join(historyAttemptDir(base.repoDir, base.attempt.id), 'release-info.json');
}

function historyState(base, { phase = 'workflow', artifacts = { state: 'pending' } } = {}) {
  return releaseState(base.attempt, { repo: base.identity, sourceSha: base.sourceSha, phase, artifacts });
}

function historyCompleteArtifacts(base, patch = {}) {
  return Object.assign({
    state: 'complete',
    sourceSha: base.sourceSha,
    runId: base.attempt.runId,
    manifestFile: historyManifestPath(base),
    manifestSha256: base.digest,
    verifiedAt: VERIFIED_AT
  }, patch);
}

function historyCompleteState(base, patch = {}) {
  return historyState(base, { phase: 'tail', artifacts: historyCompleteArtifacts(base, patch) });
}

function historyWrite(base, files = {}) {
  const dir = historyAttemptDir(base.repoDir, base.attempt.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const manifestFile = path.join(dir, 'release-info.json');
  const proofFile = path.join(dir, 'publication.json');
  fs.writeFileSync(manifestFile, files.manifest === undefined ? base.manifestBytes : files.manifest, { mode: 0o600 });
  fs.writeFileSync(
    proofFile,
    files.proof === undefined ? Buffer.from(JSON.stringify(base.proof), 'utf8') : files.proof,
    { mode: 0o600 }
  );
  return { dir, manifestFile, proofFile };
}

function historyRead(base, options = {}) {
  return readPublicationPair({
    state: options.state === undefined ? historyCompleteState(base) : options.state,
    repoDir: options.repoDir === undefined ? base.repoDir : options.repoDir,
    manifestSha256: options.digest === undefined ? base.digest : options.digest
  }, options.deps);
}

function historyProofBytes(base, patch) {
  return Buffer.from(JSON.stringify(Object.assign({}, base.proof, patch)), 'utf8');
}

function historyRefusal(invoke) {
  let thrown = null;
  try {
    invoke();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).not.toBeNull();
  expect(thrown.code).toBe(FAILURE_CODE);
  expect(thrown.message).toEqual(expect.any(String));
  expect(thrown.message.length).toBeGreaterThan(0);
  expect(thrown.message.length).toBeLessThan(200);
  expect(thrown.message).not.toContain(HISTORY_OWNER);
  return thrown;
}

function historyStat(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function sentinelFs() {
  const seen = { lstat: 0, open: 0, read: 0, realpath: 0 };
  const io = Object.create(fs);
  io.lstatSync = (...args) => { seen.lstat += 1; return fs.lstatSync(...args); };
  io.openSync = (...args) => { seen.open += 1; return fs.openSync(...args); };
  io.readSync = (...args) => { seen.read += 1; return fs.readSync(...args); };
  io.realpathSync = (...args) => { seen.realpath += 1; return fs.realpathSync.native(...args); };
  return { io, seen };
}

const HISTORY_REFUSALS = [
  ['a source commit the object store does not hold', () => {
    const base = historyBase({ sourceSha: 'f'.repeat(40) });
    historyWrite(base);
    return historyRead(base);
  }],
  ['a source commit whose package.json records another version', () => {
    const base = historyBase({ packageText: packageBody('1.29.0') });
    historyWrite(base);
    return historyRead(base);
  }],
  ['a source commit whose package.json is a symlink', () => {
    const base = historyBase({ symlinkTo: 'real-package.json' });
    historyWrite(base);
    return historyRead(base);
  }],
  ['a source commit whose package.json is not valid JSON', () => {
    const base = historyBase({ packageText: '{ not json\n' });
    historyWrite(base);
    return historyRead(base);
  }],
  ['a release repository identity that is not the observed object store', () => {
    const base = historyBase();
    historyWrite(base);
    const state = Object.assign(historyCompleteState(base), {
      repo: Object.assign({}, base.identity, { commonDir: path.join(base.identity.root, 'other-git-dir') })
    });
    return historyRead(base, { state });
  }],
  ['a missing retained proof', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.rmSync(written.proofFile);
    return historyRead(base);
  }],
  ['a retained proof that is not valid JSON', () => {
    const base = historyBase();
    historyWrite(base, { proof: Buffer.from('{ not json', 'utf8') });
    return historyRead(base);
  }],
  ['a retained proof that is not a plain record', () => {
    const base = historyBase();
    historyWrite(base, { proof: Buffer.from('[1, 2, 3]', 'utf8') });
    return historyRead(base);
  }],
  ['a retained proof whose digest is not the recorded digest', () => {
    const base = historyBase();
    historyWrite(base, { proof: historyProofBytes(base, { manifestSha256: OTHER_DIGEST }) });
    return historyRead(base);
  }],
  ['a retained proof for another active attempt', () => {
    const base = historyBase();
    historyWrite(base, { proof: historyProofBytes(base, { attemptId: OTHER_ATTEMPT_ID }) });
    return historyRead(base);
  }],
  ['a retained proof for another source', () => {
    const base = historyBase();
    historyWrite(base, { proof: historyProofBytes(base, { sourceSha: SOURCE_SHA256 }) });
    return historyRead(base);
  }],
  ['a retained proof whose run is not the bound attempt run', () => {
    const base = historyBase();
    historyWrite(base, {
      proof: historyProofBytes(base, {
        run: runRow({ id: RUN_ID + 1, head_sha: base.sourceSha, display_title: historyTitle(base.sourceSha) })
      })
    });
    return historyRead(base);
  }],
  ['a missing retained manifest', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.rmSync(written.manifestFile);
    return historyRead(base);
  }],
  ['a retained manifest that is not valid JSON', () => {
    const base = historyBase();
    const manifestBytes = Buffer.from('{ not json', 'utf8');
    const digest = sha256(manifestBytes);
    historyWrite(base, {
      manifest: manifestBytes,
      proof: historyProofBytes(base, { manifestSha256: digest })
    });
    return historyRead(base, { state: historyCompleteState(base, { manifestSha256: digest }), digest });
  }],
  ['retained manifest bytes that no longer match the recorded digest', () => {
    const base = historyBase();
    historyWrite(base, {
      manifest: Buffer.from(
        JSON.stringify(manifest({ commit: base.sourceSha, date: '2026-02-02T00:00:00.000Z' })), 'utf8'
      )
    });
    return historyRead(base);
  }],
  ['a retained manifest larger than its read bound', () => {
    const base = historyBase();
    historyWrite(base, { manifest: Buffer.alloc(1024 * 1024 + 1, 0x78) });
    return historyRead(base);
  }],
  ['a retained proof larger than its read bound', () => {
    const base = historyBase();
    historyWrite(base, { proof: Buffer.alloc(256 * 1024 + 1, 0x78) });
    return historyRead(base);
  }],
  ['complete artifacts naming an alternate manifest path', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, {
      state: historyCompleteState(base, {
        manifestFile: path.join(historyAttemptDir(base.repoDir, base.attempt.id), 'alternate.json')
      })
    });
  }],
  ['complete artifacts recording another source', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, { state: historyCompleteState(base, { sourceSha: SOURCE_SHA256 }) });
  }],
  ['complete artifacts recording another run', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, { state: historyCompleteState(base, { runId: RUN_ID + 1 }) });
  }],
  ['complete artifacts recording another digest', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, { state: historyCompleteState(base, { manifestSha256: OTHER_DIGEST }) });
  }],
  ['complete artifacts recording another verification time', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, {
      state: historyCompleteState(base, { verifiedAt: '2026-01-02T05:06:07.000Z' })
    });
  }],
  ['a retained proof reached through a symlink', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.rmSync(written.proofFile);
    fs.symlinkSync(written.manifestFile, written.proofFile);
    return historyRead(base);
  }],
  ['retained evidence reached through a symlinked ancestor', () => {
    const base = historyBase();
    const realRecords = path.join(HISTORY_OWNER, `records-${++historySeq}-`);
    const dir = path.join(realRecords, RELEASE_ID, 'artifacts', base.attempt.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'release-info.json'), base.manifestBytes, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'publication.json'), Buffer.from(JSON.stringify(base.proof), 'utf8'), { mode: 0o600 });
    fs.symlinkSync(realRecords, path.join(base.repoDir, 'records'));
    return historyRead(base);
  }],
  ['a retained manifest writable by group or other', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.chmodSync(written.manifestFile, 0o666);
    return historyRead(base);
  }],
  ['a retained evidence directory writable by group or other', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.chmodSync(written.dir, 0o777);
    return historyRead(base);
  }],
  ['a retained proof carrying special mode bits', () => {
    const base = historyBase();
    const written = historyWrite(base);
    fs.chmodSync(written.proofFile, 0o4600);
    return historyRead(base);
  }],
  ['a release state that is not a valid publication state', () => {
    const base = historyBase();
    historyWrite(base);
    return historyRead(base, { state: Object.assign(historyCompleteState(base), { version: '1.29.0' }) });
  }]
];

describe('Windows release-cache boundary', () => {
  (isWindows ? test : test.skip)('refuses Windows release-cache metadata without changing retained files', () => {
    const base = historyBase({ legacy: true });
    const files = historyWrite(base);
    const before = [
      fs.readFileSync(files.manifestFile),
      fs.readFileSync(files.proofFile),
      historyStat(files.manifestFile),
      historyStat(files.proofFile)
    ];
    expect(fs.statSync(base.repoDir).mode & 0o022).not.toBe(0);
    const error = historyRefusal(() => historyRead(base));
    expect(error.message).toMatch(/writable by group or other/);
    expect([
      fs.readFileSync(files.manifestFile),
      fs.readFileSync(files.proofFile),
      historyStat(files.manifestFile),
      historyStat(files.proofFile)
    ]).toEqual(before);
  });
});

describePosix('historical publication', () => {
  test('accepts a real retained dispatch pair and its complete wrapper', () => {
    const base = historyBase();
    historyWrite(base);
    const state = historyCompleteState(base);

    const pair = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
    expect(pair.sourceSha).toBe(base.sourceSha);
    expect(pair.runId).toBe(RUN_ID);
    expect(pair.verifiedAt).toBe(VERIFIED_AT);
    expect(pair.manifest.version).toBe(VERSION);
    expect(pair.manifest.commit).toBe(base.sourceSha);
    expect(pair.manifest.files).toHaveLength(5);
    expect(new Set(pair.manifest.files).size).toBe(5);
    expect(pair.manifest.files.slice().sort()).toEqual(installerNames().slice().sort());
    expect(Object.keys(pair.manifest.sizes)).toHaveLength(5);

    const wrapper = readPublicationEvidence({ state, repoDir: base.repoDir });
    expect(wrapper).toEqual(pair);
    expect(wrapper).not.toBe(pair);
    expect(wrapper.manifest).not.toBe(pair.manifest);
  });

  test('accepts a real retained legacy pair whose attempt is beyond the first', () => {
    const base = historyBase({ legacy: true });
    expect(base.attempt.identityKind).toBe('legacy-upload-proof');
    expect(base.attempt.id).toBe(`legacy:${LEGACY_RUN_ID}:${LEGACY_RUN_ATTEMPT}`);
    expect(base.attempt.runAttempt).toBe(2);
    historyWrite(base);
    const state = historyCompleteState(base);

    const pair = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
    expect(pair.runId).toBe(LEGACY_RUN_ID);
    expect(pair.sourceSha).toBe(base.sourceSha);
    expect(readPublicationEvidence({ state, repoDir: base.repoDir })).toEqual(pair);
  });

  test('reads a pending pair while the complete wrapper refuses it', () => {
    const base = historyBase();
    historyWrite(base);
    const state = historyState(base, { phase: 'workflow', artifacts: { state: 'pending' } });

    const pair = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
    expect(pair.runId).toBe(RUN_ID);
    expect(pair.manifest.files).toHaveLength(5);

    const error = historyRefusal(() => readPublicationEvidence({ state, repoDir: base.repoDir }));
    expect(error.message).toMatch(/complete/);
  });

  test.each(['pending', 'failed', 'unknown', 'conflict'])(
    'reads a valid %s artifacts pair while the complete wrapper refuses it',
    (artifactsState) => {
      const base = historyBase();
      historyWrite(base);
      const state = historyState(base, { phase: 'workflow', artifacts: { state: artifactsState } });

      const pair = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
      expect(pair.sourceSha).toBe(base.sourceSha);
      historyRefusal(() => readPublicationEvidence({ state, repoDir: base.repoDir }));
    }
  );

  test('reads the same retained pair after the checkout advances and leaves it untouched', () => {
    const base = historyBase();
    const written = historyWrite(base);
    const state = historyCompleteState(base);
    const before = [historyStat(written.manifestFile), historyStat(written.proofFile)];

    fs.writeFileSync(path.join(base.checkout.root, 'package.json'), packageBody('9.9.9'));
    historyGit(base.checkout.root, ['add', 'package.json']);
    historyGit(base.checkout.root, ['commit', '-q', '-m', 'later version']);
    historyGit(base.checkout.root, ['checkout', '-q', '-b', 'later']);
    fs.writeFileSync(path.join(base.checkout.root, 'staged.txt'), 'staged\n');
    historyGit(base.checkout.root, ['add', 'staged.txt']);
    fs.writeFileSync(path.join(base.checkout.root, 'README.md'), 'later working tree\n');
    historyGit(base.checkout.root, ['remote', 'add', 'origin', 'https://example.invalid/other.git']);

    expect(historyGit(base.checkout.root, ['rev-parse', 'HEAD']).trim()).not.toBe(base.sourceSha);
    expect(historyGit(base.checkout.root, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('later');

    const first = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
    const second = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest });
    const third = readPublicationEvidence({ state, repoDir: base.repoDir });
    expect(first.manifest.commit).toBe(base.sourceSha);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect([historyStat(written.manifestFile), historyStat(written.proofFile)]).toEqual(before);
  });

  test('reads retained evidence through a recording seam without asking for HEAD, branch or remote', () => {
    const base = historyBase();
    historyWrite(base);
    const state = historyCompleteState(base);

    const calls = [];
    const spawnSync = (file, args, options) => {
      calls.push({ file, args, options });
      return childProcess.spawnSync(file, args, options);
    };
    const { run } = createLocalGitReader({ spawnSync });

    const pair = readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest }, { run });
    expect(pair.sourceSha).toBe(base.sourceSha);
    expect(calls.length).toBeGreaterThan(0);

    const commands = [];
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.args.join(' ')).not.toMatch(/HEAD|symbolic-ref|remote|fetch|ls-remote|branch/);
      expect(call.options.stdio).toEqual(HISTORY_STDIO);
      commands.push(call.args.join(' '));
    }
    const joined = commands.join('\n');
    expect(joined).toMatch(/rev-parse --verify [0-9a-f]{40}\^\{commit\}/);
    expect(joined).toMatch(/ls-tree -z [0-9a-f]{40} -- package\.json/);
    expect(joined).toMatch(/cat-file blob [0-9a-f]{40}/);
  });

  test('honors an injected filesystem for the retained evidence read', () => {
    const base = historyBase();
    historyWrite(base);
    const state = historyCompleteState(base);
    const sentinel = sentinelFs();

    const pair = readPublicationPair(
      { state, repoDir: base.repoDir, manifestSha256: base.digest }, { fs: sentinel.io }
    );
    expect(pair.sourceSha).toBe(base.sourceSha);
    expect(sentinel.seen.realpath).toBeGreaterThan(0);
    expect(sentinel.seen.lstat).toBeGreaterThan(0);
    expect(sentinel.seen.open).toBe(2);
    expect(sentinel.seen.read).toBeGreaterThan(0);

    expect(readPublicationPair({ state, repoDir: base.repoDir, manifestSha256: base.digest })).toEqual(pair);
  });

  test('the historical refusal table is nonzero and covers every required class', () => {
    expect(HISTORY_REFUSALS.length).toBeGreaterThan(20);
  });

  test.each(HISTORY_REFUSALS)('%s is refused', (label, invoke) => {
    historyRefusal(invoke);
  });
});

describe('historical publication source reader', () => {
  test('reads the committed package version of an earlier source', () => {
    const checkout = historyCheckout();
    const result = readPublishedSourceVersion({
      repoRoot: checkout.root, sourceSha: checkout.sourceSha, version: VERSION
    });
    expect(result).toEqual({ sourceSha: checkout.sourceSha, version: VERSION });
  });

  test('refuses a repository root that is not canonical', () => {
    const checkout = historyCheckout();
    const alias = path.join(HISTORY_OWNER, `alias-${++historySeq}-`);
    fs.symlinkSync(checkout.root, alias);
    historyRefusal(() => readPublishedSourceVersion({
      repoRoot: alias, sourceSha: checkout.sourceSha, version: VERSION
    }));
  });

  test('refuses a source that is not the requested commit, version or object', () => {
    const checkout = historyCheckout();
    historyRefusal(() => readPublishedSourceVersion({
      repoRoot: checkout.root, sourceSha: 'f'.repeat(40), version: VERSION
    }));
    historyRefusal(() => readPublishedSourceVersion({
      repoRoot: checkout.root, sourceSha: checkout.sourceSha, version: '1.29.0'
    }));
    historyRefusal(() => readPublishedSourceVersion({
      repoRoot: checkout.root, sourceSha: checkout.sourceSha.slice(0, 8), version: VERSION
    }));
  });
});
