// D2 lock step: acting releases serialize on a per-repo directory lock keyed by the
// canonical Git common directory, docs mutations serialize on a per-target lock keyed by
// the docs common directory, and both derive their path from statePaths so separate
// checkouts that share a common directory share one lock. A lock is a 0700 directory whose
// single 0600 child is a unique owner-<uuid>.json record; acquisition is no-wait and
// reclaims only a same-host owner whose PID is demonstrably gone, never by age, and never
// removes a successor's unique record. Every fixture is its own canonical temporary root.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { withReleaseLock, withDocsLock } = require('../../scripts/release-lock');
const { statePaths } = require('../../scripts/release-state');
const { describePosix, testPosix } = require('../helpers/platform');

const OWNER = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-lock-')));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOST = 'fixture-host';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const DEAD_PID = 2147483000;

let fixtureSeq = 0;

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ioWith(overrides) {
  return Object.assign(Object.create(fs), overrides);
}

function makeFixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(OWNER, 'fixture-')));
  const cacheRoot = path.join(dir, 'cache', 'releases');
  const commonDir = path.join(dir, `checkout-${++fixtureSeq}`, '.git');
  const identity = {
    key: sha256(commonDir),
    root: path.dirname(commonDir),
    commonDir,
    branch: 'main',
    remote: 'origin',
    remoteRepo: 'github.com/fixture-owner/hyperclay-local',
    pushUrlSha256: sha256(`push-${fixtureSeq}`),
    objectFormat: 'sha1'
  };
  return { dir, cacheRoot, identity, paths: statePaths(identity, { cacheRoot }) };
}

function recordName(token) {
  return `owner-${token}.json`;
}

function ownerRecord(overrides = {}) {
  return {
    schema: 1,
    pid: process.pid,
    host: HOST,
    token: UUID_A,
    createdAt: '2026-10-03T19:00:00.000Z',
    ...overrides
  };
}

function writeOwner(lockDir, name, record) {
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(lockDir, name), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function ownerFiles(lockDir) {
  if (!fs.existsSync(lockDir)) return [];
  return fs.readdirSync(lockDir).sort();
}

function readOwnerFile(lockDir) {
  const name = fs.readdirSync(lockDir).sort()[0];
  return { name, record: JSON.parse(fs.readFileSync(path.join(lockDir, name), 'utf8')) };
}

function baseDeps(fixture, extra = {}) {
  return { cacheRoot: fixture.cacheRoot, hostname: () => HOST, ...extra };
}

function attempt(fixture, extra = {}) {
  return withReleaseLock(fixture.identity, async () => 'acquired', baseDeps(fixture, extra))
    .then(() => null, error => error);
}

function killFor(deadPids) {
  const dead = new Set(deadPids);
  return pid => {
    if (dead.has(pid)) {
      const error = new Error(`kill ESRCH ${pid}`);
      error.code = 'ESRCH';
      throw error;
    }
  };
}

function killThrowing(code) {
  return () => {
    const error = new Error(`kill ${code}`);
    error.code = code;
    throw error;
  };
}

testPosix('callback return value is adopted and the release lock is released', async () => {
  const fixture = makeFixture();
  const result = await withReleaseLock(fixture.identity, async () => 'value', baseDeps(fixture));
  expect(result).toBe('value');
  expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
});

testPosix('callback exception is rethrown and the release lock is released', async () => {
  const fixture = makeFixture();
  const boom = new Error('callback failed');
  await expect(withReleaseLock(fixture.identity, async () => { throw boom; }, baseDeps(fixture)))
    .rejects.toBe(boom);
  expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
});

testPosix('a concurrent same-process attempt is busy while the first async callback waits', async () => {
  const fixture = makeFixture();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const first = withReleaseLock(fixture.identity, () => hold, baseDeps(fixture));
  const second = await attempt(fixture);
  expect(second.code).toBe('RELEASE_LOCK_BUSY');
  expect(ownerFiles(fixture.paths.releaseLock)).toHaveLength(1);
  release('held');
  await expect(first).resolves.toBe('held');
  expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
});

testPosix('distinct repository keys coexist on the same cache root', async () => {
  const first = makeFixture();
  const second = makeFixture();
  const sharedCache = path.join(first.dir, 'shared-cache', 'releases');
  let release;
  const held = withReleaseLock(first.identity, () => new Promise(resolve => { release = resolve; }),
    baseDeps(first, { cacheRoot: sharedCache }));
  const result = await withReleaseLock(second.identity, async () => 'other', baseDeps(second, { cacheRoot: sharedCache }));
  expect(result).toBe('other');
  expect(statePaths(first.identity, { cacheRoot: sharedCache }).releaseLock)
    .not.toBe(statePaths(second.identity, { cacheRoot: sharedCache }).releaseLock);
  release();
  await held;
});

testPosix('a symlinked common directory resolves to the same release lock and excludes the other checkout', async () => {
  const fixture = makeFixture();
  const realCommon = path.join(fixture.dir, 'shared.git');
  fs.mkdirSync(realCommon, { recursive: true, mode: 0o700 });
  const link = path.join(fixture.dir, 'linked.git');
  fs.symlinkSync(realCommon, link);
  const canonical = fs.realpathSync(realCommon);
  const first = {
    ...fixture.identity,
    root: path.join(fixture.dir, 'repo-a'),
    commonDir: canonical,
    key: sha256(canonical)
  };
  const second = {
    ...fixture.identity,
    root: path.join(fixture.dir, 'repo-b'),
    commonDir: fs.realpathSync(link),
    key: sha256(fs.realpathSync(link))
  };
  expect(statePaths(first, { cacheRoot: fixture.cacheRoot }).releaseLock)
    .toBe(statePaths(second, { cacheRoot: fixture.cacheRoot }).releaseLock);
  let release;
  const held = withReleaseLock(first, () => new Promise(resolve => { release = resolve; }), baseDeps(fixture));
  const blocked = await withReleaseLock(second, async () => 'second', baseDeps(fixture))
    .then(() => null, error => error);
  expect(blocked.code).toBe('RELEASE_LOCK_BUSY');
  release();
  await held;
});

testPosix('the docs target lock derives from the docs identity and is independent of the release lock', async () => {
  const docs = makeFixture();
  const release = makeFixture();
  const docsLock = path.join(statePaths(docs.identity, { cacheRoot: docs.cacheRoot }).docsLocksDir, `${docs.identity.key}.lock`);
  expect(docsLock).not.toBe(statePaths(release.identity, { cacheRoot: release.cacheRoot }).releaseLock);

  let releaseDocs;
  const held = withDocsLock(docs.identity, () => new Promise(resolve => { releaseDocs = resolve; }), baseDeps(docs));
  const blocked = await withDocsLock(docs.identity, async () => 'docs', baseDeps(docs))
    .then(() => null, error => error);
  expect(blocked.code).toBe('DOCS_LOCK_BUSY');
  const releaseResult = await withReleaseLock(release.identity, async () => 'release', baseDeps(release));
  expect(releaseResult).toBe('release');
  expect(fs.existsSync(docsLock)).toBe(true);
  releaseDocs();
  await held;
  expect(fs.existsSync(docsLock)).toBe(false);
});

testPosix('an active PID and an EPERM probe both stay busy', async () => {
  const fixture = makeFixture();
  writeOwner(fixture.paths.releaseLock, recordName(UUID_A), ownerRecord({ pid: process.pid, token: UUID_A }));
  const active = await attempt(fixture);
  expect(active.code).toBe('RELEASE_LOCK_BUSY');
  expect(ownerFiles(fixture.paths.releaseLock)).toEqual([recordName(UUID_A)]);

  fs.rmSync(fixture.paths.releaseLock, { recursive: true, force: true });
  writeOwner(fixture.paths.releaseLock, recordName(UUID_B), ownerRecord({ pid: DEAD_PID, token: UUID_B }));
  const eperm = await attempt(fixture, { kill: killThrowing('EPERM') });
  expect(eperm.code).toBe('RELEASE_LOCK_BUSY');
  expect(ownerFiles(fixture.paths.releaseLock)).toEqual([recordName(UUID_B)]);
});

testPosix('a dead same-host owner is reclaimed and replaced by the caller', async () => {
  const fixture = makeFixture();
  writeOwner(fixture.paths.releaseLock, recordName(UUID_A), ownerRecord({ pid: DEAD_PID, token: UUID_A }));
  const observed = await withReleaseLock(fixture.identity, async () => ownerFiles(fixture.paths.releaseLock),
    baseDeps(fixture, { kill: killFor([DEAD_PID]) }));
  expect(observed).toHaveLength(1);
  expect(observed[0]).not.toBe(recordName(UUID_A));
  expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
});

testPosix('foreign hosts, malformed, empty and multiple records, and unknown kill errors stay busy', async () => {
  const foreign = makeFixture();
  writeOwner(foreign.paths.releaseLock, recordName(UUID_A), ownerRecord({ host: 'other-host', token: UUID_A }));
  expect((await attempt(foreign)).code).toBe('RELEASE_LOCK_BUSY');

  const malformed = makeFixture();
  fs.mkdirSync(malformed.paths.releaseLock, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(malformed.paths.releaseLock, recordName(UUID_A)), 'not json', { mode: 0o600 });
  expect((await attempt(malformed)).code).toBe('RELEASE_LOCK_BUSY');

  const wrongKeys = makeFixture();
  writeOwner(wrongKeys.paths.releaseLock, recordName(UUID_A), ownerRecord({ extra: true, token: UUID_A }));
  expect((await attempt(wrongKeys)).code).toBe('RELEASE_LOCK_BUSY');

  const unnamed = makeFixture();
  writeOwner(unnamed.paths.releaseLock, 'owner.json', ownerRecord());
  expect((await attempt(unnamed)).code).toBe('RELEASE_LOCK_BUSY');

  const empty = makeFixture();
  fs.mkdirSync(empty.paths.releaseLock, { recursive: true, mode: 0o700 });
  expect((await attempt(empty)).code).toBe('RELEASE_LOCK_BUSY');

  const multiple = makeFixture();
  writeOwner(multiple.paths.releaseLock, recordName(UUID_A), ownerRecord({ pid: DEAD_PID, token: UUID_A }));
  writeOwner(multiple.paths.releaseLock, recordName(UUID_B), ownerRecord({ pid: DEAD_PID, token: UUID_B }));
  expect((await attempt(multiple, { kill: killFor([DEAD_PID]) })).code).toBe('RELEASE_LOCK_BUSY');

  const unknown = makeFixture();
  writeOwner(unknown.paths.releaseLock, recordName(UUID_A), ownerRecord({ pid: DEAD_PID, token: UUID_A }));
  expect((await attempt(unknown, { kill: killThrowing('EIO') })).code).toBe('RELEASE_LOCK_BUSY');
});

testPosix('a very old owner record is never reclaimed by age while its PID is alive', async () => {
  const fixture = makeFixture();
  writeOwner(fixture.paths.releaseLock, recordName(UUID_A), ownerRecord({
    pid: process.pid,
    token: UUID_A,
    createdAt: '2000-01-01T00:00:00.000Z'
  }));
  expect((await attempt(fixture)).code).toBe('RELEASE_LOCK_BUSY');
  expect(ownerFiles(fixture.paths.releaseLock)).toEqual([recordName(UUID_A)]);
});

testPosix('an unsafe owned directory and a symlinked owned path are rejected', async () => {
  const unsafe = makeFixture();
  fs.mkdirSync(unsafe.paths.releasesDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(unsafe.paths.releasesDir, 0o777);
  try {
    expect((await attempt(unsafe)).code).toBe('RELEASE_LOCK_PATH_UNSAFE');
  } finally {
    fs.chmodSync(unsafe.paths.releasesDir, 0o700);
  }

  const linked = makeFixture();
  fs.mkdirSync(linked.paths.releasesDir, { recursive: true, mode: 0o700 });
  const decoy = path.join(linked.dir, 'decoy-locks');
  fs.mkdirSync(decoy, { recursive: true, mode: 0o700 });
  fs.symlinkSync(decoy, path.join(linked.paths.releasesDir, 'locks'));
  expect((await attempt(linked)).code).toBe('RELEASE_LOCK_PATH_UNSAFE');
  expect(ownerFiles(path.join(decoy, 'releases'))).toEqual([]);
});

testPosix('a replaced owner record is reported as lost and never removed on release', async () => {
  const fixture = makeFixture();
  const error = await withReleaseLock(fixture.identity, async () => {
    const current = readOwnerFile(fixture.paths.releaseLock);
    const file = path.join(fixture.paths.releaseLock, current.name);
    fs.writeFileSync(file, `${JSON.stringify({ ...current.record, token: UUID_B })}\n`, { mode: 0o600 });
  }, baseDeps(fixture)).then(() => null, thrown => thrown);
  expect(error.code).toBe('RELEASE_LOCK_LOST');
  expect(ownerFiles(fixture.paths.releaseLock)).toHaveLength(1);
});

testPosix('a stale reclaimer cannot unlink a successor unique owner record', async () => {
  const fixture = makeFixture();
  const lockDir = fixture.paths.releaseLock;
  const stalePath = path.join(lockDir, recordName(UUID_A));
  writeOwner(lockDir, recordName(UUID_A), ownerRecord({ pid: DEAD_PID, token: UUID_A }));
  let injected = false;
  const io = ioWith({
    unlinkSync(target) {
      if (!injected && target === stalePath) {
        injected = true;
        fs.writeFileSync(path.join(lockDir, recordName(UUID_B)), `${JSON.stringify(ownerRecord({ pid: process.pid, token: UUID_B }))}\n`, { mode: 0o600 });
      }
      return fs.unlinkSync(target);
    }
  });
  const result = await attempt(fixture, { fs: io, kill: killFor([DEAD_PID]) });
  expect(result.code).toBe('RELEASE_LOCK_BUSY');
  expect(ownerFiles(lockDir)).toEqual([recordName(UUID_B)]);
});

testPosix('a directory replaced during owner setup prevents the callback', async () => {
  const fixture = makeFixture();
  const lockDir = fixture.paths.releaseLock;
  const stale = `${lockDir}.stale`;
  let callbackRan = false;
  const io = ioWith({
    writeFileSync(fd, data) {
      fs.writeFileSync(fd, data);
      fs.renameSync(lockDir, stale);
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(path.join(lockDir, recordName(UUID_B)), `${JSON.stringify(ownerRecord({ token: UUID_B }))}\n`, { mode: 0o600 });
    }
  });
  const error = await withReleaseLock(fixture.identity, async () => { callbackRan = true; }, baseDeps(fixture, { fs: io }))
    .then(() => null, thrown => thrown);
  expect(callbackRan).toBe(false);
  expect(error.code).toBe('RELEASE_LOCK_IO_FAILED');
  expect(ownerFiles(lockDir)).toEqual([recordName(UUID_B)]);
});

testPosix('a setup write error leaves no falsely acquired lock', async () => {
  const fixture = makeFixture();
  let callbackRan = false;
  const io = ioWith({
    writeFileSync() {
      const error = new Error('ENOSPC: no space left on device');
      error.code = 'ENOSPC';
      throw error;
    }
  });
  const error = await withReleaseLock(fixture.identity, async () => { callbackRan = true; }, baseDeps(fixture, { fs: io }))
    .then(() => null, thrown => thrown);
  expect(callbackRan).toBe(false);
  expect(error.code).toBe('RELEASE_LOCK_IO_FAILED');
  expect(error.cause.code).toBe('ENOSPC');
  expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
});

testPosix('callback and cleanup failures retain both errors', async () => {
  const failingCleanup = ioWith({
    unlinkSync() {
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      throw error;
    }
  });

  const first = makeFixture();
  const boom = new Error('callback boom');
  const both = await withReleaseLock(first.identity, async () => { throw boom; }, baseDeps(first, { fs: failingCleanup }))
    .then(() => null, thrown => thrown);
  expect(both).toBe(boom);
  expect(both.cleanupError.code).toBe('RELEASE_LOCK_IO_FAILED');

  const second = makeFixture();
  const cleanupOnly = await withReleaseLock(second.identity, async () => 'ok', baseDeps(second, { fs: failingCleanup }))
    .then(() => null, thrown => thrown);
  expect(cleanupOnly.code).toBe('RELEASE_LOCK_IO_FAILED');
});

describePosix('callback rejection values', () => {
  test.each([null, undefined, false, 0, ''])('preserves a %p rejection and releases the lock', async value => {
    const fixture = makeFixture();
    let callbackCount = 0;
    const outcome = await withReleaseLock(fixture.identity, async () => {
      callbackCount += 1;
      throw value;
    }, baseDeps(fixture)).then(() => ({ rejected: false }), error => ({ rejected: true, error }));
    expect(outcome.rejected).toBe(true);
    expect(outcome.error).toBe(value);
    expect(callbackCount).toBe(1);
    expect(fs.existsSync(fixture.paths.releaseLock)).toBe(false);
  });
});

function waitForLine(child, expected) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString();
      if (buffer.includes(expected)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`child exited early code=${code} signal=${signal} output=${buffer}`));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function completionOf(child) {
  return new Promise(resolve => {
    const settle = (code, signal, error) => resolve({ code, signal, error });
    child.once('exit', (code, signal) => settle(code, signal, null));
    child.once('error', error => settle(null, null, error));
  });
}

testPosix('a real child process excludes a second process and then releases cleanly', async () => {
  const fixture = makeFixture();
  const script = `
    const { withReleaseLock } = require(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'release-lock.js'))});
    const payload = JSON.parse(process.argv[1]);
    withReleaseLock(payload.identity, async () => {
      process.stdout.write('LOCKED\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));
      return 'child';
    }, { cacheRoot: payload.cacheRoot }).then(value => {
      process.stdout.write('RELEASED ' + value + '\\n');
      process.exit(0);
    }).catch(error => {
      process.stdout.write('ERROR ' + error.code + '\\n');
      process.exit(1);
    });
  `;
  const child = spawn(process.execPath, ['-e', script, JSON.stringify({ identity: fixture.identity, cacheRoot: fixture.cacheRoot })], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const completion = completionOf(child);
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForLine(child, 'LOCKED');
    const blocked = await withReleaseLock(fixture.identity, async () => 'parent', { cacheRoot: fixture.cacheRoot })
      .then(() => null, error => error);
    expect(blocked.code).toBe('RELEASE_LOCK_BUSY');
    child.stdin.write('release\n');
    await waitForLine(child, 'RELEASED');
    const after = await withReleaseLock(fixture.identity, async () => 'after', { cacheRoot: fixture.cacheRoot });
    expect(after).toBe('after');
  } finally {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await completion;
  }
  expect(stderr).toBe('');
}, 30000);
