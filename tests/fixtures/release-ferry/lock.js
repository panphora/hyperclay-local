import fs from 'node:fs';
import path from 'node:path';
import { machineId, repoLockFile, stateLockFile, daemonLockFile, generationLockFile } from './paths.js';

// Advisory file locks. Four uses share one primitive:
//   - per-repo locks (locks/<hash>.lock): held by switch/clear/auto-save while a
//     repo's tree is mutated; the backup lane skips a repo whose lock is held so
//     the daemon and the CLI never fight over one tree.
//   - the generation lock (locks/generation.lock): held across the model call that
//     groups one repo's changes, so two processes never ask the provider at once.
//   - the state lock (locks/state.lock): a tiny critical section around every
//     read-modify-write of state2.json, so concurrent writers can't lose an update.
//   - the daemon lock (locks/daemon.lock): single-instance guard for `daemon run`.
// Each lock file records pid/host/time so a crash recovers instead of blocking.
// They nest in one order everywhere — repo, generation, state — and the state lock is
// never held across a model call.

const STALE_TTL_MS = 2 * 60 * 60 * 1000; // 2h backstop for cross-host staleness
const ACQUIRE_RETRIES = 30;
const RETRY_MS = 100;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    return false;
  }
}

function isStale(info) {
  if (!info) return true;
  // On this host the pid is the whole answer: a live process holds its lock for as
  // long as it runs, and a dead one frees it immediately. Ageing out a same-host
  // lock declared the daemon dead every 2h, since it is meant to run for days.
  // The TTL is only for a lock left behind by another host, whose pids we cannot check.
  if (info.host === machineId()) return !processAlive(info.pid);
  return Date.now() - (info.startedAtMs ?? 0) > STALE_TTL_MS;
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function tryAcquire(file, command) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({
    pid: process.pid,
    host: machineId(),
    command,
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, payload);
      fs.closeSync(fd);
      return { file };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const held = readLock(file);
      if (isStale(held)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      return null;
    }
  }
  return null;
}

function release(handle) {
  if (!handle) return;
  const held = readLock(handle.file);
  if (held && held.pid === process.pid && held.host === machineId()) {
    fs.rmSync(handle.file, { force: true });
  }
}

function busyError(file) {
  const held = readLock(file);
  const who = held ? `pid ${held.pid} on ${held.host} (${held.command})` : 'another process';
  const err = new Error(`locked by ${who}`);
  err.code = 'LOCK_BUSY';
  return err;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn while holding `file`, blocking-retry briefly. Throws LOCK_BUSY on timeout. */
export async function withLock(file, command, fn) {
  let handle = null;
  for (let i = 0; i < ACQUIRE_RETRIES && !handle; i++) {
    handle = tryAcquire(file, command);
    if (!handle) await delay(RETRY_MS);
  }
  if (!handle) throw busyError(file);
  try {
    return await fn();
  } finally {
    release(handle);
  }
}

/** Non-blocking: if held, return null WITHOUT running fn; else run under the lock. */
export async function tryWithLock(file, command, fn) {
  const handle = tryAcquire(file, command);
  if (!handle) return null;
  try {
    return await fn();
  } finally {
    release(handle);
  }
}

export function isLocked(file) {
  if (!fs.existsSync(file)) return false;
  return !isStale(readLock(file));
}

/** Acquire a lock and keep the handle (caller releases). For the daemon guard. */
export function acquireOnce(file, command) {
  return tryAcquire(file, command);
}
export { release };

// --- convenience wrappers -----------------------------------------------------
export const withRepoLock = (repoRel, command, fn) => withLock(repoLockFile(repoRel), command, fn);
export const tryRepoLock = (repoRel, command, fn) => tryWithLock(repoLockFile(repoRel), command, fn);
export const isRepoLocked = (repoRel) => isLocked(repoLockFile(repoRel));
export const tryGenerationLock = (command, fn) => tryWithLock(generationLockFile(), command, fn);
export const withStateLock = (fn) => withLock(stateLockFile(), 'state', fn);
export const acquireDaemonLock = () => acquireOnce(daemonLockFile(), 'daemon');
export const isDaemonRunning = () => isLocked(daemonLockFile());
