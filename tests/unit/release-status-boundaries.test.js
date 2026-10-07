// Boundary proof for the read-only desktop status assembler. One owned scratch
// desktop checkout with a real source commit, a GitHub-shaped origin and an external
// owned cache carries the malformed package and receipt input, the HEAD cases, the
// state validator cases, the current-identity refusals, the sanitized low-level
// failure, the win32 seam and the change-during-read races. Every record under test
// comes from the real state producer and is persisted by the real store, and every
// lane read between state APIs is an actual persisted JSON reread.
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readStatus } = require('../../scripts/release-status');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('../../scripts/release-state');
const { writeReleaseState } = require('../../scripts/release-state-store');
const { createReleaseState } = require('../../scripts/release-transitions');
const { createLocalGitReader } = require('../../scripts/release-local-read');
const { isWindows, testPosix } = require('../helpers/platform');

jest.setTimeout(180000);

const VERSION = '1.29.0';
const ORIGIN = 'git@github.com:fixture-owner/hyperclay-local.git';
const OTHER_ORIGIN = 'git@github.com:other-owner/other-repo.git';
const CREATED_AT = '2026-10-04T10:00:00.000Z';
const RELEASE_ID = '3f2a1c0d-5e6b-4a7c-9d8e-1f2a3b4c5d6e';
const OTHER_RELEASE_ID = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const DRY_RUN_REASON = 'Local dry-run record; no publication evidence';
const SECRET = 'SENTINEL-DO-NOT-LEAK-9f3c';

const WIRE_KEYS = ['schema', 'repoKey', 'currentVersion', 'publish', 'siteReceipt', 'dryRun', 'readError'];
const STAGES = ['artifacts', 'sizes', 'site', 'docs.hyperclay', 'docs.hyperclay-website'];

const MESSAGES = {
  RELEASE_HOST_UNSUPPORTED: 'Desktop release status requires a POSIX host',
  REPO_BRANCH_MISMATCH: 'Desktop releases require main',
  REPO_IDENTITY_UNREADABLE: 'Could not read local release repository identity',
  REPO_PUSH_MISMATCH: 'Release origin fetch and push destinations differ',
  REPO_ROOT_MISMATCH: 'Release root must be the checkout root',
  STATE_CACHE_IN_CHECKOUT: 'Release state must stay outside the checkout',
  STATE_INVALID: 'Release state record is invalid',
  STATUS_PACKAGE_INVALID: 'Desktop package.json has no usable release version',
  STATUS_HEAD_INVALID: 'The desktop checkout HEAD could not be resolved',
  STATUS_RECEIPT_INVALID: 'The live site receipt could not be read',
  STATUS_CHANGED_DURING_READ: 'Desktop release state changed while it was being read',
  STATUS_READ_FAILED: 'Desktop release status could not be read'
};

const OWNER = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hc-status-boundaries-')));
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
  '[core]',
  `\thooksPath = ${JSON.stringify(NO_HOOKS.replace(/\\/g, '/'))}`,
  '\tautocrlf = false',
  ''
].join('\n'));

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_CONFIG, GIT_OPTIONAL_LOCKS: '0' };

const PERMISSIONS_ENFORCED = (() => {
  if (isWindows) return false;
  const probe = path.join(OWNER, 'permission-probe');
  fs.writeFileSync(probe, 'probe\n', { mode: 0o600 });
  fs.chmodSync(probe, 0o000);
  try {
    fs.readFileSync(probe);
    return false;
  } catch {
    return true;
  } finally {
    fs.chmodSync(probe, 0o600);
    fs.unlinkSync(probe);
  }
})();

function git(cwd, args) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function packageBytes(version) {
  return `${JSON.stringify({ name: 'hyperclay-local-electron', version, private: true }, null, 2)}\n`;
}

function makeRepo(label, { origin = ORIGIN, branch = 'main', commit = true } = {}) {
  const root = path.join(OWNER, label);
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', branch]);
  git(root, ['remote', 'add', 'origin', origin]);
  fs.writeFileSync(path.join(root, 'package.json'), packageBytes(VERSION));
  if (!commit) return root;
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'release source']);
  return root;
}

function identityOf(root) {
  return resolveRepoIdentity(root, { readGit: createLocalGitReader().readGit, fs });
}

function snapshotTree(root) {
  const entries = [];
  const visit = (dir, prefix) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full, { bigint: true });
      const key = prefix === '' ? name : `${prefix}/${name}`;
      const directory = stat.isDirectory();
      const link = stat.isSymbolicLink();
      let digest = null;
      if (!directory && !link) {
        try {
          digest = sha256(fs.readFileSync(full));
        } catch {
          digest = 'unreadable';
        }
      }
      entries.push([key, directory ? 'dir' : link ? 'link' : 'file',
        String(stat.mode), String(stat.size), String(stat.mtimeNs), digest]);
      if (directory) visit(full, key);
    }
  };
  visit(root, '');
  return entries;
}

function expectReadOnly(roots, run) {
  const before = roots.map((root) => snapshotTree(root));
  const result = run();
  const after = roots.map((root) => snapshotTree(root));
  expect(after).toEqual(before);
  return result;
}

function expectRefusal(status, code, label = 'status') {
  expect({
    label,
    code: status.readError === null ? null : status.readError.code,
    message: status.readError === null ? null : status.readError.message
  }).toEqual({ label, code, message: MESSAGES[code] });
  expect(Object.keys(status)).toEqual(WIRE_KEYS);
  expect(status.schema).toBe(1);
  expect(status.repoKey).toBeNull();
  expect(status.currentVersion).toBeNull();
  expect(status.publish).toBeNull();
  expect(status.siteReceipt).toBeNull();
  expect(status.dryRun).toBeNull();
}

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

describe('desktop status boundaries', () => {
  let desktopRoot = null;
  let identity = null;
  let cacheBase = null;
  let cacheRoot = null;
  let repoDir = null;
  let stateFile = null;
  let dryRunFile = null;
  let packagePath = null;
  let receiptPath = null;
  let head = null;
  let publishRecord = null;
  let dryRunRecord = null;
  let roots = null;

  const laneBytes = (record) => Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  const writeLane = (file, record) => fs.writeFileSync(file, laneBytes(record), { mode: 0o600 });
  const clearLane = (file) => fs.rmSync(file, { force: true });
  const persistLane = (record) => writeReleaseState(record, identity, { cacheRoot, expectedRevision: null, fs });

  beforeAll(() => {
    if (isWindows) return;
    desktopRoot = makeRepo('desktop');
    identity = identityOf(desktopRoot);
    head = git(desktopRoot, ['rev-parse', 'HEAD']);
    cacheBase = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, 'cache-')));
    cacheRoot = path.join(cacheBase, 'releases');
    const paths = statePaths(identity, { cacheRoot, fs });
    repoDir = paths.repoDir;
    stateFile = paths.stateFile;
    dryRunFile = paths.dryRunFile;
    packagePath = path.join(desktopRoot, 'package.json');
    receiptPath = path.join(desktopRoot, '.deploy');
    roots = [desktopRoot, cacheBase];
    publishRecord = createReleaseState({
      releaseId: RELEASE_ID, version: VERSION, mode: 'publish', at: CREATED_AT, sourceSha: head, versionIntent: null
    }, identity, { repoDir });
    dryRunRecord = createReleaseState({
      releaseId: OTHER_RELEASE_ID, version: VERSION, mode: 'dry-run', at: CREATED_AT, sourceSha: head, versionIntent: null
    }, identity, { repoDir });
  });

  testPosix('both absent lanes report the seven-key wire shape without creating a cache or log path', () => {
    clearLane(stateFile);
    clearLane(dryRunFile);
    const freshCache = path.join(OWNER, 'absent-cache', 'releases');
    const status = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot: freshCache }));

    expect(Object.keys(status)).toEqual(WIRE_KEYS);
    expect(Object.keys(status)).toHaveLength(7);
    expect(status.schema).toBe(1);
    expect(status.repoKey).toBe(identity.key);
    expect(status.currentVersion).toBe(VERSION);
    expect(status.publish).toBeNull();
    expect(status.dryRun).toBeNull();
    expect(status.siteReceipt).toBeNull();
    expect(status.readError).toBeNull();
    expect(fs.existsSync(path.join(OWNER, 'absent-cache'))).toBe(false);
    expect(fs.existsSync(path.join(desktopRoot, 'release.log'))).toBe(false);
  });

  testPosix('a publish source-ready record projects every pending stage and leaves the dry-run lane null', () => {
    clearLane(dryRunFile);
    persistLane(publishRecord);
    try {
      const status = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));

      expect(status.readError).toBeNull();
      expect(status.repoKey).toBe(identity.key);
      expect(status.currentVersion).toBe(VERSION);
      expect(status.publish).toEqual({
        releaseId: RELEASE_ID,
        version: VERSION,
        sourceSha: head,
        phase: 'source-ready',
        action: 'reconcile-workflow',
        pending: true,
        needsSigning: null,
        pendingStages: STAGES,
        lastVerifiedAt: null,
        remoteVerification: 'not-performed',
        reason: null
      });
      expect(status.dryRun).toBeNull();
      expect(status.siteReceipt).toBeNull();
    } finally {
      clearLane(stateFile);
    }
  });

  testPosix('a dry-run-only source-ready record leaves publish null and carries the dry-run reason', () => {
    clearLane(stateFile);
    persistLane(dryRunRecord);
    try {
      const status = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));

      expect(status.readError).toBeNull();
      expect(status.publish).toBeNull();
      expect(status.dryRun).toEqual({
        releaseId: OTHER_RELEASE_ID,
        version: VERSION,
        sourceSha: head,
        phase: 'source-ready',
        action: 'reconcile-workflow',
        pending: true,
        needsSigning: null,
        pendingStages: [],
        lastVerifiedAt: null,
        remoteVerification: 'not-performed',
        reason: DRY_RUN_REASON
      });
      expect(status.siteReceipt).toBeNull();
    } finally {
      clearLane(dryRunFile);
    }
  });

  testPosix('package input refuses malformed, nonobject, unsupported and oversized versions', () => {
    clearLane(stateFile);
    clearLane(dryRunFile);
    const original = fs.readFileSync(packagePath);
    const cases = [
      ['malformed JSON', Buffer.from('{not json')],
      ['nonobject JSON', Buffer.from('[1,2,3]')],
      ['missing version', Buffer.from('{"name":"hyperclay-local-electron"}')],
      ['nonstring version', Buffer.from('{"version":1}')],
      ['leading zeros', Buffer.from('{"version":"01.29.0"}')],
      ['suffix', Buffer.from('{"version":"1.29.0-beta.1"}')],
      ['component above 65535', Buffer.from('{"version":"1.65536.0"}')],
      ['oversized ordinary file', Buffer.from(`{"version":"${VERSION}","pad":"${'x'.repeat(1024 * 1024)}"}`)]
    ];
    try {
      for (const [label, bytes] of cases) {
        fs.writeFileSync(packagePath, bytes, { mode: 0o644 });
        const status = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
        expectRefusal(status, 'STATUS_PACKAGE_INVALID', label);
      }
    } finally {
      fs.writeFileSync(packagePath, original, { mode: 0o644 });
    }
    expect(fs.readFileSync(packagePath)).toEqual(original);
  });

  (PERMISSIONS_ENFORCED ? testPosix : test.skip)('package input refuses a symlink and an unreadable ordinary file', () => {
    clearLane(stateFile);
    clearLane(dryRunFile);
    const original = fs.readFileSync(packagePath);
    const target = path.join(OWNER, 'package-target.json');
    fs.writeFileSync(target, original, { mode: 0o644 });
    try {
      fs.rmSync(packagePath, { force: true });
      fs.symlinkSync(target, packagePath);
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATUS_PACKAGE_INVALID', 'symlink');

      fs.rmSync(packagePath, { force: true });
      fs.writeFileSync(packagePath, original, { mode: 0o600 });
      fs.chmodSync(packagePath, 0o000);
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATUS_PACKAGE_INVALID', 'unreadable file');
    } finally {
      fs.rmSync(packagePath, { force: true });
      fs.writeFileSync(packagePath, original, { mode: 0o644 });
    }
    expect(fs.readFileSync(packagePath)).toEqual(original);
  });

  testPosix('receipt input accepts only a current-HEAD object ID and refuses every other byte shape', () => {
    clearLane(stateFile);
    clearLane(dryRunFile);
    expect(identity.objectFormat).toBe('sha1');
    const other = 'b'.repeat(40);
    expect(other).not.toBe(head);

    const absent = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
    expect(absent.readError).toBeNull();
    expect(absent.siteReceipt).toBeNull();

    try {
      for (const [label, bytes] of [['no newline', Buffer.from(head)], ['one newline', Buffer.from(`${head}\n`)]]) {
        fs.writeFileSync(receiptPath, bytes, { mode: 0o600 });
        const status = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
        expect({ label, readError: status.readError, siteReceipt: status.siteReceipt })
          .toEqual({ label, readError: null, siteReceipt: { sha: head, matchesHead: true } });
      }

      fs.writeFileSync(receiptPath, Buffer.from(`${other}\n`), { mode: 0o600 });
      const different = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
      expect(different.readError).toBeNull();
      expect(different.siteReceipt).toEqual({ sha: other, matchesHead: false });

      const negatives = [
        ['extra newline', Buffer.from(`${head}\n\n`)],
        ['extra whitespace', Buffer.from(`${head} \n`)],
        ['nonhex', Buffer.from(`${'z'.repeat(40)}\n`)],
        ['oversized file', Buffer.from('a'.repeat(129))],
        ['64 hex in a sha1 repository', Buffer.from('c'.repeat(64))]
      ];
      for (const [label, bytes] of negatives) {
        fs.writeFileSync(receiptPath, bytes, { mode: 0o600 });
        expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
          'STATUS_RECEIPT_INVALID', label);
      }

      fs.rmSync(receiptPath, { force: true });
      fs.mkdirSync(receiptPath, { mode: 0o700 });
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATUS_RECEIPT_INVALID', 'directory');
      fs.rmdirSync(receiptPath);

      const target = path.join(OWNER, 'receipt-target');
      fs.writeFileSync(target, `${head}\n`, { mode: 0o600 });
      fs.symlinkSync(target, receiptPath);
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATUS_RECEIPT_INVALID', 'symlink');
      fs.rmSync(receiptPath, { force: true });

      if (PERMISSIONS_ENFORCED) {
        fs.writeFileSync(receiptPath, `${head}\n`, { mode: 0o600 });
        fs.chmodSync(receiptPath, 0o000);
        expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
          'STATUS_RECEIPT_INVALID', 'read failure');
      }
    } finally {
      fs.rmSync(receiptPath, { force: true });
    }
    expect(fs.existsSync(receiptPath)).toBe(false);
  });

  testPosix('HEAD resolution refuses an unborn repository and malformed or mismatched Git answers', () => {
    clearLane(stateFile);
    clearLane(dryRunFile);
    const unbornRoot = makeRepo('unborn', { commit: false });
    const unbornCache = path.join(OWNER, 'unborn-cache', 'releases');
    expectRefusal(readStatus({ repoRoot: unbornRoot, cacheRoot: unbornCache }), 'STATUS_HEAD_INVALID', 'unborn repository');
    expect(fs.existsSync(path.join(OWNER, 'unborn-cache'))).toBe(false);

    const reader = createLocalGitReader();
    const malformed = (cwd, args) => (args.length === 2 && args[1] === 'HEAD'
      ? 'not-an-object-id'
      : reader.readGit(cwd, args));
    expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }, { readGit: malformed })),
      'STATUS_HEAD_INVALID', 'malformed HEAD OID');

    const mismatched = (cwd, args) => (args.length === 3 && args[1] === '--verify'
      ? 'd'.repeat(40)
      : reader.readGit(cwd, args));
    expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }, { readGit: mismatched })),
      'STATUS_HEAD_INVALID', 'different peeled commit');
  });

  testPosix('state validation refuses malformed bytes, a wrong-lane record and an invalid identity', () => {
    clearLane(dryRunFile);
    clearLane(stateFile);
    persistLane(publishRecord);
    const realBytes = fs.readFileSync(stateFile);
    expect(validateReleaseState(JSON.parse(realBytes.toString('utf8')), identity, { repoDir })).toEqual(publishRecord);

    try {
      fs.writeFileSync(stateFile, Buffer.from('{not json'), { mode: 0o600 });
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATE_INVALID', 'malformed publish bytes');
      fs.writeFileSync(stateFile, realBytes, { mode: 0o600 });

      fs.writeFileSync(dryRunFile, Buffer.from('{not json'), { mode: 0o600 });
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATE_INVALID', 'malformed dry-run bytes');
      fs.rmSync(dryRunFile, { force: true });

      fs.writeFileSync(dryRunFile, realBytes, { mode: 0o600 });
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATE_INVALID', 'publish record in the dry-run lane');
      fs.rmSync(dryRunFile, { force: true });

      const foreign = JSON.parse(realBytes.toString('utf8'));
      foreign.repo = { ...foreign.repo, key: sha256('another common dir') };
      fs.writeFileSync(stateFile, laneBytes(foreign), { mode: 0o600 });
      expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot })),
        'STATE_INVALID', 'invalid recorded identity');
      fs.writeFileSync(stateFile, realBytes, { mode: 0o600 });

      clearLane(stateFile);
      const missing = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
      expect(missing.readError).toBeNull();
      expect(missing.publish).toBeNull();
      expect(missing.dryRun).toBeNull();

      persistLane(publishRecord);
      const onlyPublish = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }));
      expect(onlyPublish.readError).toBeNull();
      expect(onlyPublish.publish.phase).toBe('source-ready');
      expect(onlyPublish.dryRun).toBeNull();
    } finally {
      clearLane(stateFile);
      clearLane(dryRunFile);
    }
  });

  testPosix('current identity refuses another branch, a split push destination, a non-root root and an in-checkout cache', () => {
    const featureRoot = makeRepo('feature-branch', { branch: 'feature' });
    expectRefusal(readStatus({ repoRoot: featureRoot, cacheRoot: path.join(OWNER, 'feature-cache', 'releases') }),
      'REPO_BRANCH_MISMATCH', 'wrong branch');

    const splitRoot = makeRepo('split-push');
    git(splitRoot, ['remote', 'set-url', '--push', 'origin', OTHER_ORIGIN]);
    expectRefusal(readStatus({ repoRoot: splitRoot, cacheRoot: path.join(OWNER, 'split-cache', 'releases') }),
      'REPO_PUSH_MISMATCH', 'mismatched push destination');

    const sub = path.join(desktopRoot, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    expectRefusal(readStatus({ repoRoot: sub, cacheRoot: path.join(OWNER, 'sub-cache', 'releases') }),
      'REPO_ROOT_MISMATCH', 'non-root repoRoot');

    const inside = path.join(desktopRoot, 'cache-inside');
    expectRefusal(expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot: inside })),
      'STATE_CACHE_IN_CHECKOUT', 'cache inside the checkout');
    expect(fs.existsSync(inside)).toBe(false);
  });

  testPosix('an unexpected low-level failure is sanitized and an allowlisted code keeps its fixed message', () => {
    const boom = Object.assign(new Error(`low-level failure ${SECRET}`), {
      code: 'EACCES',
      stdout: `stdout ${SECRET}`,
      stderr: `stderr ${SECRET}`,
      cause: new Error(`cause ${SECRET}`)
    });
    const io = Object.create(fs);
    io.realpathSync = Object.assign(() => { throw boom; }, { native: () => { throw boom; } });
    const lowLevel = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }, { fs: io }));
    expectRefusal(lowLevel, 'STATUS_READ_FAILED', 'unexpected low-level failure');
    expect(Object.keys(lowLevel.readError)).toEqual(['code', 'message']);
    expect(JSON.stringify(lowLevel)).not.toContain(SECRET);

    const readGit = () => { throw Object.assign(new Error(`private ${SECRET}`), { code: 'REPO_IDENTITY_UNREADABLE' }); };
    const allowlisted = expectReadOnly(roots, () => readStatus({ repoRoot: desktopRoot, cacheRoot }, { readGit }));
    expectRefusal(allowlisted, 'REPO_IDENTITY_UNREADABLE', 'allowlisted code with a private message');
    expect(JSON.stringify(allowlisted)).not.toContain(SECRET);
  });

  test('win32 refuses before any filesystem, Git, run or spawn access', () => {
    const accesses = { fs: 0, readGit: 0, run: 0, spawn: 0 };
    const io = new Proxy({}, {
      get() { accesses.fs += 1; throw new Error('injected fs was accessed'); },
      has() { accesses.fs += 1; throw new Error('injected fs was accessed'); }
    });
    const readGit = () => { accesses.readGit += 1; throw new Error('readGit was called'); };
    const run = () => { accesses.run += 1; throw new Error('run was called'); };
    const spawn = () => { accesses.spawn += 1; throw new Error('spawn was called'); };
    const deps = { platform: 'win32', fs: io, readGit, run, spawn };
    const requests = [
      ['object request', { repoRoot: desktopRoot, cacheRoot }],
      ['null request', null],
      ['string request', 'not a record'],
      ['array request', [1, 2]],
      ['nonrecord request fields', { repoRoot: 42, cacheRoot: {} }]
    ];
    for (const [label, request] of requests) {
      expectRefusal(readStatus(request, deps), 'RELEASE_HOST_UNSUPPORTED', label);
    }
    expect(accesses).toEqual({ fs: 0, readGit: 0, run: 0, spawn: 0 });
  });

  testPosix('both lanes report a change during read for every race without retrying', () => {
    const lanes = [['publish', stateFile, publishRecord], ['dry-run', dryRunFile, dryRunRecord]];
    const bump = (record) => ({ ...record, revision: record.revision + 1 });
    const rename = (record) => ({ ...record, releaseId: record.releaseId === RELEASE_ID ? OTHER_RELEASE_ID : RELEASE_ID });
    for (const candidate of [bump(publishRecord), rename(publishRecord), bump(dryRunRecord), rename(dryRunRecord)]) {
      expect(validateReleaseState(candidate, identity, { repoDir })).toEqual(candidate);
    }

    const race = (laneFile, mutate) => {
      const counters = { laneReads: 0, changes: 0 };
      const io = Object.create(fs);
      io.lstatSync = function (file, ...args) {
        if (file === laneFile && ++counters.laneReads === 2) {
          counters.changes += 1;
          mutate();
        }
        return fs.lstatSync(file, ...args);
      };
      return { status: readStatus({ repoRoot: desktopRoot, cacheRoot }, { fs: io }), counters };
    };

    persistLane(publishRecord);
    clearLane(stateFile);
    clearLane(dryRunFile);

    for (const [lane, laneFile, record] of lanes) {
      const mutations = [
        ['revision changes', () => writeLane(laneFile, bump(record)), laneBytes(bump(record))],
        ['releaseId changes', () => writeLane(laneFile, rename(record)), laneBytes(rename(record))],
        ['present becomes absent', () => clearLane(laneFile), null]
      ];
      for (const [label, mutate, expected] of mutations) {
        clearLane(stateFile);
        clearLane(dryRunFile);
        writeLane(laneFile, record);
        try {
          const { status, counters } = race(laneFile, mutate);
          expectRefusal(status, 'STATUS_CHANGED_DURING_READ', `${lane}: ${label}`);
          expect(counters.changes).toBe(1);
          expect(counters.laneReads).toBe(2);
          if (expected === null) expect(fs.existsSync(laneFile)).toBe(false);
          else expect(fs.readFileSync(laneFile)).toEqual(expected);
        } finally {
          clearLane(stateFile);
          clearLane(dryRunFile);
        }
      }

      try {
        const { status, counters } = race(laneFile, () => writeLane(laneFile, record));
        expectRefusal(status, 'STATUS_CHANGED_DURING_READ', `${lane}: absent becomes present`);
        expect(counters.changes).toBe(1);
        expect(counters.laneReads).toBe(2);
        expect(fs.readFileSync(laneFile)).toEqual(laneBytes(record));
      } finally {
        clearLane(stateFile);
        clearLane(dryRunFile);
      }
    }
  });
});
