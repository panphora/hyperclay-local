// D2 storage step: publish and dry-run records are persisted outside the checkout by
// one synchronous store that validates before it creates anything, revalidates the
// canonical cache chain before every syscall, and reports a truthful persistence
// boundary (STATE_INVALID for data, STATE_CONFLICT for revision/lane/history
// mismatches, STATE_CACHE_INVALID for path shape, STATE_IO_FAILED for IO). Every
// fixture is its own canonical temporary root with a fake identity, and every injected
// io is a thin wrapper around the real filesystem.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { statePaths } = require('../../scripts/release-state');
const { readReleaseState, writeReleaseState } = require('../../scripts/release-state-store');
const { isWindows, testPosix } = require('../helpers/platform');

const MAX_STATE_BYTES = 8 * 1024 * 1024;
const OWNER = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-store-')));

const VERSION = '1.29.0';
const SOURCE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);
const SITE_SHA = 'd'.repeat(40);
const SITE_TREE = 'e'.repeat(40);
const DIGEST = 'f'.repeat(64);
const CREATED_AT = '2026-10-03T19:00:00.000Z';
const UPDATED_AT = '2026-10-03T20:30:00.000Z';
const LATER_AT = '2026-10-03T21:30:00.000Z';
const REQUESTED_AT = '2026-10-03T20:00:00.000Z';
const WATCH_DEADLINE_AT = '2026-10-03T23:00:00.000Z';
const RUN_ID = 456;
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

let fixtureSeq = 0;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function uuidFor(value) {
  return `${value.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function makeFixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, 'fixture-')));
  const checkout = path.join(dir, `checkout-${++fixtureSeq}`);
  const commonDir = path.join(checkout, '.git');
  const identity = {
    key: sha256(commonDir),
    root: checkout,
    commonDir,
    branch: 'main',
    remote: 'origin',
    remoteRepo: 'github.com/fixture-owner/hyperclay-local',
    pushUrlSha256: sha256(`git@github.com:fixture-owner/hyperclay-local.git#${fixtureSeq}`),
    objectFormat: 'sha1'
  };
  const cacheRoot = path.join(dir, 'cache', 'releases');
  return { dir, identity, cacheRoot, paths: statePaths(identity, { cacheRoot }) };
}

function refusalError(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function refusalCode(invoke) {
  return refusalError(invoke).code;
}

function snapshotTree(dir) {
  const entries = [];
  const visit = (current, prefix) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const key = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(full);
      entries.push({
        key, ino: stat.ino, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs,
        type: stat.isDirectory() ? 'dir' : 'file'
      });
      if (stat.isDirectory()) visit(full, key);
    }
  };
  visit(dir, '');
  return entries;
}

function pendingTarget() {
  return { state: 'pending', journalFile: null, commit: null, reason: null };
}

function recordsDir(fixture, releaseId) {
  return path.join(fixture.paths.repoDir, 'records', releaseId);
}

function dispatchAttempt(mode) {
  const attemptId = uuidFor(1);
  return {
    id: attemptId,
    identityKind: 'dispatch',
    version: VERSION,
    mode,
    sourceSha: SOURCE_SHA,
    dispatchRef: `v${VERSION}`,
    workflowPath: '.github/workflows/release.yml',
    workflowId: 12345,
    expectedTitle: `release v${VERSION} ${mode} sha=${SOURCE_SHA} attempt=${attemptId}`,
    dispatch: 'identified',
    requestedAt: REQUESTED_AT,
    watchDeadlineAt: WATCH_DEADLINE_AT,
    runId: RUN_ID,
    runAttempt: 1,
    runStatus: 'completed',
    conclusion: 'success',
    lastObservedAt: UPDATED_AT,
    error: null
  };
}

function baseRecord(fixture, releaseId, patch) {
  return Object.assign({
    schema: 1,
    revision: 0,
    repo: { ...fixture.identity },
    releaseId,
    version: VERSION,
    mode: 'publish',
    phase: 'source-ready',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    versionIntent: null,
    sourceSha: SOURCE_SHA,
    activeAttemptId: null,
    attempts: [],
    artifacts: { state: 'pending' },
    sizes: pendingTarget(),
    site: { state: 'pending', sourceSha: null, treeSha: null, attemptId: null, receiptSha: null, verifiedAt: null, error: null },
    docs: { hyperclay: pendingTarget(), 'hyperclay-website': pendingTarget() },
    install: { state: 'not-attempted', error: null },
    lastError: null
  }, patch);
}

function sourceReadyRecord(fixture, releaseId, revision = 0, patch = {}) {
  return baseRecord(fixture, releaseId, Object.assign({ revision }, patch));
}

function completedRecord(fixture, releaseId, patch = {}) {
  const releaseDir = recordsDir(fixture, releaseId);
  const evidence = name => path.join(releaseDir, name);
  const completeTarget = name => ({
    state: 'complete', journalFile: evidence(name), commit: COMMIT_SHA, reason: null
  });
  return baseRecord(fixture, releaseId, Object.assign({
    phase: 'complete',
    activeAttemptId: uuidFor(1),
    attempts: [dispatchAttempt('publish')],
    artifacts: {
      state: 'complete', sourceSha: SOURCE_SHA, runId: RUN_ID, manifestFile: evidence('release-info.json'),
      manifestSha256: DIGEST, verifiedAt: UPDATED_AT
    },
    sizes: completeTarget('sizes/journal.json'),
    site: {
      state: 'complete', sourceSha: SITE_SHA, treeSha: SITE_TREE, attemptId: uuidFor(2),
      receiptSha: SITE_SHA, verifiedAt: UPDATED_AT, error: null
    },
    docs: { hyperclay: completeTarget('docs/hyperclay.json'), 'hyperclay-website': completeTarget('docs/website.json') }
  }, patch));
}

function dryRunRecord(fixture, releaseId, patch = {}) {
  return baseRecord(fixture, releaseId, Object.assign({
    mode: 'dry-run',
    phase: 'complete',
    activeAttemptId: uuidFor(1),
    attempts: [dispatchAttempt('dry-run')]
  }, patch));
}

function probeIo(extra = {}) {
  const opened = [];
  const closed = [];
  const io = {
    ...fs,
    openSync(target, flags, mode) {
      const fd = fs.openSync(target, flags, mode);
      opened.push(fd);
      return fd;
    },
    closeSync(fd) {
      closed.push(fd);
      return fs.closeSync(fd);
    },
    ...extra
  };
  return { io, opened, closed };
}

function injected(extra) {
  return { ...fs, ...extra };
}

function trackingIo(beforeDirectoryFsync) {
  const events = [];
  const targets = new Map();
  const io = injected({
    openSync(target, flags, mode) {
      const fd = fs.openSync(target, flags, mode);
      targets.set(fd, target);
      return fd;
    },
    closeSync(fd) {
      try {
        return fs.closeSync(fd);
      } finally {
        targets.delete(fd);
      }
    },
    mkdirSync(target, mode) {
      events.push({ op: 'mkdir', target });
      return fs.mkdirSync(target, mode);
    },
    fsyncSync(fd) {
      const target = targets.get(fd);
      const directory = fs.fstatSync(fd).isDirectory();
      if (directory && beforeDirectoryFsync) beforeDirectoryFsync(target);
      events.push({ op: 'fsync', target, directory });
      return fs.fsyncSync(fd);
    },
    renameSync(from, to) {
      events.push({ op: 'rename', from, to });
      return fs.renameSync(from, to);
    }
  });
  return { io, events };
}

function write(fixture, value, expectedRevision, io) {
  return writeReleaseState(value, fixture.identity, {
    cacheRoot: fixture.cacheRoot, expectedRevision, fs: io
  });
}

function read(fixture, mode, io) {
  return readReleaseState(fixture.identity, { cacheRoot: fixture.cacheRoot, mode, fs: io });
}

describe('release state storage', () => {
  testPosix('a new record is written, read back and updated in place with owned modes', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(11);
    const first = sourceReadyRecord(fixture, releaseId);

    expect(write(fixture, first, null)).toEqual(first);
    expect(fs.readFileSync(fixture.paths.stateFile, 'utf8')).toBe(`${JSON.stringify(first)}\n`);
    expect(fs.statSync(fixture.paths.stateFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(fixture.paths.repoDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(fixture.paths.releasesDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(fixture.dir, 'cache')).mode & 0o777).toBe(0o700);
    expect(read(fixture)).toEqual(first);

    const second = sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT });
    expect(write(fixture, second, 0)).toEqual(second);
    expect(read(fixture)).toEqual(second);
    expect(fs.readdirSync(fixture.paths.repoDir)).toEqual(['state.json']);
    expect(fs.existsSync(fixture.paths.historyDir)).toBe(false);
  });

  test('a missing lane reads as null and reading creates nothing', () => {
    const fixture = makeFixture();
    const before = snapshotTree(fixture.dir);

    expect(read(fixture)).toBeNull();
    expect(read(fixture, 'dry-run')).toBeNull();
    expect(snapshotTree(fixture.dir)).toEqual(before);
    expect(fs.existsSync(path.join(fixture.dir, 'cache'))).toBe(false);
  });

  testPosix('an existing empty cache directory still reads as null without creating a record', () => {
    const fixture = makeFixture();

    fs.mkdirSync(fixture.paths.repoDir, { recursive: true });
    expect(read(fixture)).toBeNull();
    expect(fs.readdirSync(fixture.paths.repoDir)).toEqual([]);
  });

  testPosix('publish and dry-run lanes stay independent and never fall back to each other', () => {
    const fixture = makeFixture();
    const publish = sourceReadyRecord(fixture, uuidFor(21));
    const dryRun = dryRunRecord(fixture, uuidFor(22));

    write(fixture, dryRun, null);
    expect(read(fixture)).toBeNull();
    expect(read(fixture, 'dry-run')).toEqual(dryRun);

    write(fixture, publish, null);
    expect(read(fixture)).toEqual(publish);
    expect(read(fixture, 'dry-run')).toEqual(dryRun);
    expect(fs.readdirSync(fixture.paths.repoDir).sort()).toEqual(['dry-run.json', 'state.json']);

    fs.writeFileSync(fixture.paths.stateFile, `${JSON.stringify(dryRun)}\n`);
    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');
    expect(read(fixture, 'dry-run')).toEqual(dryRun);
  });

  testPosix('corrupt, stale-schema and wrong-identity records refuse instead of reading as missing', () => {
    const fixture = makeFixture();
    const other = makeFixture();
    const releaseId = uuidFor(31);
    const record = sourceReadyRecord(fixture, releaseId);
    write(fixture, record, null);

    fs.writeFileSync(fixture.paths.stateFile, '{"schema":1,');
    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');

    fs.writeFileSync(fixture.paths.stateFile, `${JSON.stringify({ ...record, schema: 2 })}\n`);
    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');

    fs.writeFileSync(fixture.paths.stateFile, `${JSON.stringify(sourceReadyRecord(other, releaseId))}\n`);
    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');

    fs.writeFileSync(fixture.paths.stateFile, `${JSON.stringify({ ...record, extra: true })}\n`);
    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT }), 0)))
      .toBe('STATE_INVALID');
  });

  test('an invalid value refuses before any directory or record is created', () => {
    const fixture = makeFixture();
    const before = snapshotTree(fixture.dir);
    const bad = sourceReadyRecord(fixture, uuidFor(41));
    bad.schema = 7;

    expect(refusalCode(() => write(fixture, bad, null))).toBe('STATE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(42)), undefined))).toBe('STATE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(43)), 0.5))).toBe('STATE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(44)), -1))).toBe('STATE_INVALID');
    expect(refusalCode(() => read(fixture, 'dryrun'))).toBe('STATE_INVALID');
    expect(snapshotTree(fixture.dir)).toEqual(before);
  });

  testPosix('a symlinked record refuses and never touches the linked target', () => {
    const fixture = makeFixture();
    const secret = path.join(fixture.dir, 'external-record.json');
    const secretBytes = `${JSON.stringify(completedRecord(fixture, uuidFor(51)))}\n`;
    fs.writeFileSync(secret, secretBytes);
    fs.mkdirSync(fixture.paths.repoDir, { recursive: true });

    fs.symlinkSync(secret, fixture.paths.stateFile);
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(52)), null))).toBe('STATE_CACHE_INVALID');
    expect(fs.readFileSync(secret, 'utf8')).toBe(secretBytes);
    expect(fs.lstatSync(fixture.paths.stateFile).isSymbolicLink()).toBe(true);

    fs.unlinkSync(fixture.paths.stateFile);
    fs.mkdirSync(fixture.paths.stateFile);
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');

    fs.rmdirSync(fixture.paths.stateFile);
    fs.writeFileSync(fixture.paths.stateFile, secretBytes);
    fs.chmodSync(fixture.paths.stateFile, 0o666);
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
    expect(fs.readFileSync(secret, 'utf8')).toBe(secretBytes);

    fs.chmodSync(fixture.paths.stateFile, 0o4600);
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
  });

  testPosix('a symlinked or file cache descendant refuses reads and writes without touching the external record', () => {
    const fixture = makeFixture();
    const external = path.join(fixture.dir, 'external-repo');
    fs.mkdirSync(external, { recursive: true });
    const externalBytes = `${JSON.stringify(sourceReadyRecord(fixture, uuidFor(61)))}\n`;
    fs.writeFileSync(path.join(external, 'state.json'), externalBytes);

    fs.mkdirSync(fixture.paths.releasesDir, { recursive: true });
    fs.symlinkSync(external, fixture.paths.repoDir);
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(62)), null))).toBe('STATE_CACHE_INVALID');
    expect(fs.readFileSync(path.join(external, 'state.json'), 'utf8')).toBe(externalBytes);

    fs.unlinkSync(fixture.paths.repoDir);
    fs.writeFileSync(fixture.paths.repoDir, 'not a directory\n');
    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => read(fixture, 'dry-run'))).toBe('STATE_CACHE_INVALID');

    const insideCheckout = refusalCode(() => readReleaseState(fixture.identity, {
      cacheRoot: path.join(fixture.identity.root, 'releases')
    }));
    expect(insideCheckout).toBe('STATE_CACHE_IN_CHECKOUT');
  });

  testPosix('a stale expected revision leaves the exact previous bytes', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(71);
    const first = sourceReadyRecord(fixture, releaseId);
    write(fixture, first, null);
    const before = fs.readFileSync(fixture.paths.stateFile);
    const next = sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT });

    expect(refusalCode(() => write(fixture, next, null))).toBe('STATE_CONFLICT');
    expect(refusalCode(() => write(fixture, next, 7))).toBe('STATE_CONFLICT');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);

    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 5, { updatedAt: LATER_AT }), 0)))
      .toBe('STATE_CONFLICT');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: CREATED_AT }), 0)))
      .toBe('STATE_CONFLICT');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT, version: '1.30.0' }), 0)))
      .toBe('STATE_CONFLICT');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT, createdAt: LATER_AT }), 0)))
      .toBe('STATE_CONFLICT');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);

    const fresh = makeFixture();
    expect(refusalCode(() => write(fresh, sourceReadyRecord(fresh, uuidFor(72), 3), null))).toBe('STATE_CONFLICT');
    expect(refusalCode(() => write(fresh, sourceReadyRecord(fresh, uuidFor(73)), 0))).toBe('STATE_CONFLICT');
    expect(fs.existsSync(fresh.paths.stateFile)).toBe(false);
  });

  testPosix('an incomplete previous record cannot be replaced and no history is created', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(81);
    write(fixture, sourceReadyRecord(fixture, releaseId), null);
    const before = fs.readFileSync(fixture.paths.stateFile);

    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(82)), 0))).toBe('STATE_CONFLICT');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
    expect(fs.existsSync(fixture.paths.historyDir)).toBe(false);
  });

  testPosix('a completed record is archived byte-for-byte before the replacement lands', () => {
    const fixture = makeFixture();
    const firstId = uuidFor(91);
    write(fixture, completedRecord(fixture, firstId), null);
    const firstBytes = fs.readFileSync(fixture.paths.stateFile);

    const second = sourceReadyRecord(fixture, uuidFor(92));
    write(fixture, second, 0);

    const archived = path.join(fixture.paths.historyDir, `${firstId}.json`);
    expect(fs.readFileSync(archived)).toEqual(firstBytes);
    expect(fs.statSync(archived).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(fixture.paths.historyDir)).toEqual([`${firstId}.json`]);
    expect(fs.readFileSync(fixture.paths.stateFile, 'utf8')).toBe(`${JSON.stringify(second)}\n`);
    expect(read(fixture)).toEqual(second);
  });

  testPosix('a replacement retry after a failed lane write accepts the archived bytes', () => {
    const fixture = makeFixture();
    const firstId = uuidFor(101);
    write(fixture, completedRecord(fixture, firstId), null);
    const firstBytes = fs.readFileSync(fixture.paths.stateFile);
    const archived = path.join(fixture.paths.historyDir, `${firstId}.json`);
    const replacement = sourceReadyRecord(fixture, uuidFor(102));
    const failing = injected({
      renameSync() {
        const error = new Error('injected rename failure');
        error.code = 'EIO';
        throw error;
      }
    });

    expect(refusalCode(() => write(fixture, replacement, 0, failing))).toBe('STATE_IO_FAILED');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(firstBytes);
    expect(fs.readFileSync(archived)).toEqual(firstBytes);
    expect(fs.readdirSync(fixture.paths.historyDir)).toEqual([`${firstId}.json`]);

    write(fixture, replacement, 0);
    expect(read(fixture)).toEqual(replacement);
    expect(fs.readdirSync(fixture.paths.historyDir)).toEqual([`${firstId}.json`]);
  });

  testPosix('a conflicting or corrupt history record refuses and keeps both records', () => {
    const fixture = makeFixture();
    const firstId = uuidFor(111);
    write(fixture, completedRecord(fixture, firstId), null);
    const laneBytes = fs.readFileSync(fixture.paths.stateFile);
    const archived = path.join(fixture.paths.historyDir, `${firstId}.json`);
    const planted = Buffer.from(`${JSON.stringify(completedRecord(fixture, uuidFor(112)))}\n`);
    fs.mkdirSync(fixture.paths.historyDir, { recursive: true });
    fs.writeFileSync(archived, planted);

    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(113)), 0))).toBe('STATE_CONFLICT');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(laneBytes);
    expect(fs.readFileSync(archived)).toEqual(planted);

    fs.writeFileSync(archived, 'not json at all\n');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(113)), 0))).toBe('STATE_INVALID');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(laneBytes);
    expect(read(fixture)).toEqual(completedRecord(fixture, firstId));
  });

  testPosix('publish and dry-run release ids share one history without overwriting it', () => {
    const fixture = makeFixture();
    const sharedId = uuidFor(121);
    write(fixture, completedRecord(fixture, sharedId), null);
    const publishBytes = fs.readFileSync(fixture.paths.stateFile);
    write(fixture, dryRunRecord(fixture, sharedId), null);

    write(fixture, sourceReadyRecord(fixture, uuidFor(122)), 0);
    expect(fs.readFileSync(path.join(fixture.paths.historyDir, `${sharedId}.json`))).toEqual(publishBytes);

    expect(refusalCode(() => write(fixture, dryRunRecord(fixture, uuidFor(123)), 0))).toBe('STATE_CONFLICT');
    expect(read(fixture, 'dry-run')).toEqual(dryRunRecord(fixture, sharedId));
    expect(fs.readdirSync(fixture.paths.historyDir)).toEqual([`${sharedId}.json`]);
  });

  testPosix('a record beyond the size limit refuses from its size and from the bounded read', () => {
    const fixture = makeFixture();
    fs.mkdirSync(fixture.paths.repoDir, { recursive: true });
    fs.writeFileSync(fixture.paths.stateFile, '{}');
    fs.truncateSync(fixture.paths.stateFile, MAX_STATE_BYTES + 1);

    expect(refusalCode(() => read(fixture))).toBe('STATE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(131)), null))).toBe('STATE_INVALID');
    expect(fs.statSync(fixture.paths.stateFile).size).toBe(MAX_STATE_BYTES + 1);

    fs.truncateSync(fixture.paths.stateFile, 16);
    const growing = injected({
      readSync(fd, buffer, offset, length) {
        buffer.fill(0x61, offset, offset + length);
        return length;
      }
    });
    expect(refusalCode(() => read(fixture, 'publish', growing))).toBe('STATE_INVALID');
  });

  testPosix('injected write, flush, rename and directory flush failures report the true boundary', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(141);
    write(fixture, sourceReadyRecord(fixture, releaseId), null);
    const before = fs.readFileSync(fixture.paths.stateFile);
    const next = sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT });
    const lanesOnly = () => expect(fs.readdirSync(fixture.paths.repoDir)).toEqual(['state.json']);

    const partial = refusalError(() => write(fixture, next, 0, injected({
      writeFileSync(fd, payload) {
        fs.writeSync(fd, payload.subarray(0, Math.floor(payload.length / 2)));
      }
    })));
    expect(partial.code).toBe('STATE_IO_FAILED');
    expect(partial.message).toContain('serialization');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
    lanesOnly();

    const serialization = refusalError(() => write(fixture, next, 0, injected({
      writeFileSync() {
        const error = new Error('injected write failure');
        error.code = 'EIO';
        throw error;
      }
    })));
    expect(serialization.code).toBe('STATE_IO_FAILED');
    expect(serialization.cause.code).toBe('EIO');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
    lanesOnly();

    const flush = refusalError(() => write(fixture, next, 0, injected({
      fsyncSync(fd) {
        if (fs.fstatSync(fd).isDirectory()) return fs.fsyncSync(fd);
        const error = new Error('injected file fsync failure');
        error.code = 'EIO';
        throw error;
      }
    })));
    expect(flush.code).toBe('STATE_IO_FAILED');
    expect(flush.message).toContain('flush');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
    lanesOnly();

    const renamed = refusalError(() => write(fixture, next, 0, injected({
      renameSync() {
        const error = new Error('injected rename failure');
        error.code = 'EXDEV';
        throw error;
      }
    })));
    expect(renamed.code).toBe('STATE_IO_FAILED');
    expect(renamed.cause.code).toBe('EXDEV');
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
    lanesOnly();

    let laneRenamed = false;
    const directoryFlush = refusalError(() => write(fixture, next, 0, injected({
      renameSync(...args) {
        const result = fs.renameSync(...args);
        laneRenamed = true;
        return result;
      },
      fsyncSync(fd) {
        if (!laneRenamed || !fs.fstatSync(fd).isDirectory()) return fs.fsyncSync(fd);
        const error = new Error('injected directory fsync failure');
        error.code = 'EIO';
        throw error;
      }
    })));
    expect(directoryFlush.code).toBe('STATE_IO_FAILED');
    expect(directoryFlush.message).toContain('directory flush');
    expect(fs.readFileSync(fixture.paths.stateFile, 'utf8')).toBe(`${JSON.stringify(next)}\n`);
    expect(read(fixture)).toEqual(next);
    lanesOnly();
  });

  testPosix('a planted exclusive-create collision keeps the other writer file', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(151);
    write(fixture, sourceReadyRecord(fixture, releaseId), null);
    const before = fs.readFileSync(fixture.paths.stateFile);
    const planted = [];
    let renames = 0;
    const io = injected({
      openSync(target, flags, mode) {
        if (flags === 'wx') {
          fs.writeFileSync(target, 'planted by another writer\n', { mode: 0o600 });
          planted.push(target);
        }
        return fs.openSync(target, flags, mode);
      },
      renameSync(...args) {
        renames += 1;
        return fs.renameSync(...args);
      }
    });

    const error = refusalError(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT }), 0, io));
    expect(error.code).toBe('STATE_IO_FAILED');
    expect(error.cause.code).toBe('EEXIST');
    expect(planted).toHaveLength(1);
    expect(fs.readFileSync(planted[0], 'utf8')).toBe('planted by another writer\n');
    expect(renames).toBe(0);
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(before);
  });

  testPosix('every opened descriptor is closed exactly once on success and failure', () => {
    const fixture = makeFixture();
    const releaseId = uuidFor(161);
    const probes = [];
    const track = (extra = {}) => {
      const probe = probeIo(extra);
      probes.push(probe);
      return probe;
    };

    const writing = track();
    write(fixture, sourceReadyRecord(fixture, releaseId), null, writing.io);
    const reading = track();
    read(fixture, 'publish', reading.io);
    const failing = track({
      renameSync() {
        const error = new Error('injected rename failure');
        error.code = 'EIO';
        throw error;
      }
    });
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, releaseId, 1, { updatedAt: LATER_AT }), 0, failing.io)))
      .toBe('STATE_IO_FAILED');

    for (const { opened, closed } of probes) {
      expect(opened.length).toBeGreaterThan(0);
      expect(closed.slice().sort()).toEqual(opened.slice().sort());
    }
  });

  (PERMISSIONS_ENFORCED ? testPosix : test.skip)('an unreadable record refuses instead of reporting missing', () => {
    const fixture = makeFixture();
    write(fixture, sourceReadyRecord(fixture, uuidFor(171)), null);
    fs.chmodSync(fixture.paths.stateFile, 0o000);
    try {
      const error = refusalError(() => read(fixture));
      expect(error.code).toBe('STATE_IO_FAILED');
      expect(error.cause.code).toBe('EACCES');
      expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(172)), null))).toBe('STATE_IO_FAILED');
    } finally {
      fs.chmodSync(fixture.paths.stateFile, 0o600);
    }
  });

  testPosix('a thrown write leaves the next workflow action unstarted', () => {
    const fixture = makeFixture();
    const workflow = { nextActions: 0 };
    const io = injected({
      renameSync() {
        const error = new Error('injected rename failure');
        error.code = 'EIO';
        throw error;
      }
    });

    try {
      write(fixture, sourceReadyRecord(fixture, uuidFor(181)), null, io);
      workflow.nextActions += 1;
    } catch (error) {
      expect(error.code).toBe('STATE_IO_FAILED');
    }

    expect(workflow.nextActions).toBe(0);
    expect(fs.existsSync(fixture.paths.stateFile)).toBe(false);
    expect(read(fixture)).toBeNull();
  });
});

describe('storage boundary corrections', () => {
  testPosix('an unsafe cache root refuses reads and writes without changing its mode or creating state', () => {
    const fixture = makeFixture();
    fs.mkdirSync(fixture.paths.releasesDir, { recursive: true });
    fs.chmodSync(fixture.paths.releasesDir, 0o777);
    const before = snapshotTree(fixture.dir);

    expect(refusalCode(() => read(fixture))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => read(fixture, 'dry-run'))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => write(fixture, sourceReadyRecord(fixture, uuidFor(201)), null)))
      .toBe('STATE_CACHE_INVALID');

    expect(fs.statSync(fixture.paths.releasesDir).mode & 0o777).toBe(0o777);
    expect(snapshotTree(fixture.dir)).toEqual(before);
    expect(fs.existsSync(fixture.paths.repoDir)).toBe(false);
    expect(fs.existsSync(fixture.paths.stateFile)).toBe(false);
  });

  test('inherited object keys are not valid lanes', () => {
    const fixture = makeFixture();
    const record = sourceReadyRecord(fixture, uuidFor(211));

    for (const lane of ['constructor', 'toString', '__proto__']) {
      expect(refusalCode(() => read(fixture, lane))).toBe('STATE_INVALID');
      expect(refusalCode(() => write(fixture, { ...record, mode: lane }, null))).toBe('STATE_INVALID');
    }

    expect(fs.existsSync(path.join(fixture.dir, 'cache'))).toBe(false);
    expect(fs.existsSync(fixture.paths.stateFile)).toBe(false);
  });

  testPosix('a fresh write keeps every created directory parent flushed before the lane rename', () => {
    const fixture = makeFixture();
    const record = sourceReadyRecord(fixture, uuidFor(221));
    const tracker = trackingIo();

    write(fixture, record, null, tracker.io);

    const created = tracker.events.filter(event => event.op === 'mkdir').map(event => event.target);
    expect(created).toEqual([
      path.join(fixture.dir, 'cache'),
      fixture.paths.releasesDir,
      fixture.paths.repoDir
    ]);

    const renameIndex = tracker.events.findIndex(event => event.op === 'rename' && event.to === fixture.paths.stateFile);
    expect(renameIndex).toBeGreaterThan(-1);
    const directoryFlushes = tracker.events.slice(0, renameIndex)
      .filter(event => event.op === 'fsync' && event.directory)
      .map(event => event.target);

    expect(directoryFlushes.length).toBeGreaterThan(0);
    expect(directoryFlushes).toHaveLength(created.length + 1);
    expect(directoryFlushes[0]).toBe(path.dirname(fixture.dir));
    for (const dir of created) {
      expect(directoryFlushes).toContain(path.dirname(dir));
    }
    expect(read(fixture)).toEqual(record);
  });

  testPosix('a failed parent flush refuses the record and the retry flushes the surviving boundary parent first', () => {
    const fixture = makeFixture();
    const record = sourceReadyRecord(fixture, uuidFor(231));
    const workflow = { nextActions: 0 };
    const cacheDir = path.join(fixture.dir, 'cache');
    const failing = trackingIo(target => {
      if (target === cacheDir) {
        const error = new Error('injected parent flush failure');
        error.code = 'EIO';
        throw error;
      }
    });

    try {
      write(fixture, record, null, failing.io);
      workflow.nextActions += 1;
    } catch (error) {
      expect(error.code).toBe('STATE_IO_FAILED');
      expect(error.message).toContain('cache directory flush');
    }

    expect(workflow.nextActions).toBe(0);
    expect(fs.existsSync(fixture.paths.releasesDir)).toBe(true);
    expect(fs.existsSync(fixture.paths.repoDir)).toBe(false);
    expect(fs.existsSync(fixture.paths.stateFile)).toBe(false);

    const retry = trackingIo();
    write(fixture, record, null, retry.io);

    const renameIndex = retry.events.findIndex(event => event.op === 'rename' && event.to === fixture.paths.stateFile);
    expect(renameIndex).toBeGreaterThan(-1);
    expect(retry.events.filter(event => event.op === 'mkdir').map(event => event.target))
      .toEqual([fixture.paths.repoDir]);
    const directoryFlushes = retry.events.slice(0, renameIndex)
      .filter(event => event.op === 'fsync' && event.directory)
      .map(event => event.target);
    expect(directoryFlushes).toEqual([cacheDir, fixture.paths.releasesDir]);
    expect(read(fixture)).toEqual(record);
  });

  testPosix('a matching history archive still refuses when its directory flush fails', () => {
    const fixture = makeFixture();
    const firstId = uuidFor(241);
    write(fixture, completedRecord(fixture, firstId), null);
    const laneBytes = fs.readFileSync(fixture.paths.stateFile);
    const archived = path.join(fixture.paths.historyDir, `${firstId}.json`);
    fs.mkdirSync(fixture.paths.historyDir, { recursive: true });
    fs.writeFileSync(archived, laneBytes);
    const workflow = { nextActions: 0 };
    const failing = trackingIo(target => {
      if (target === fixture.paths.historyDir) {
        const error = new Error('injected history directory flush failure');
        error.code = 'EIO';
        throw error;
      }
    });

    try {
      write(fixture, sourceReadyRecord(fixture, uuidFor(242)), 0, failing.io);
      workflow.nextActions += 1;
    } catch (error) {
      expect(error.code).toBe('STATE_IO_FAILED');
      expect(error.message).toContain('history directory flush');
    }

    expect(workflow.nextActions).toBe(0);
    expect(fs.readFileSync(fixture.paths.stateFile)).toEqual(laneBytes);
    expect(fs.readFileSync(archived)).toEqual(laneBytes);
    expect(read(fixture)).toEqual(completedRecord(fixture, firstId));
  });
});

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});
