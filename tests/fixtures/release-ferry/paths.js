import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// -----------------------------------------------------------------------------
// The single source of truth for every path ferry builds and every name it
// encodes. Directory roots come from the environment (or a baked default);
// config.js hydrates FERRY_ROOT / FERRY_DROPBOX_DIR from ~/.ferry/config.json at
// startup, so this stays a dependency-free leaf. Tests set the env directly.
// -----------------------------------------------------------------------------

export const NAME = 'ferry';
const HOME = os.homedir();

export function expandTilde(p) {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

// --- roots (env or default; config.js may hydrate the env from config.json) ---
export function root() {
  return process.env.FERRY_ROOT || path.join(HOME, 'Documents', 'GitHub');
}
export function dropboxDir() {
  return (
    process.env.FERRY_DROPBOX_DIR ||
    path.join(HOME, 'Library', 'CloudStorage', 'Dropbox', 'ferry')
  );
}
export function stateDir() {
  return process.env.FERRY_STATE_DIR || path.join(HOME, `.${NAME}`);
}

// --- local state home layout --------------------------------------------------
export const configFile = () => path.join(stateDir(), 'config.json');
export const stateFile = () => path.join(stateDir(), 'state2.json');
export const locksDir = () => path.join(stateDir(), 'locks');
export const journalsDir = () => path.join(stateDir(), 'journals');
export const localTrashRoot = () => path.join(stateDir(), 'trash');
export const logFile = () => path.join(stateDir(), 'log');
// Printed by the shell on startup while something is wrong. A file, not a ferry
// call, so an interactive shell never pays for a node process to learn all is well.
export const alertFile = () => path.join(stateDir(), 'alert');
export const daemonLogFile = () => path.join(stateDir(), 'daemon.log');
export const daemonLockFile = () => path.join(locksDir(), 'daemon.lock');
// The launch shim (see src/daemon/ferry-exec.c) lives beside the state, not in
// the repo, so it survives a `git clean` and is rebuilt by `ferry daemon install`.
export const shimDir = () => path.join(stateDir(), 'bin');
export const shimBin = () => path.join(shimDir(), 'ferry-exec');
export const stateLockFile = () => path.join(locksDir(), 'state.lock');
// Held across a model call, so only one process is ever waiting on the provider.
export const generationLockFile = () => path.join(locksDir(), 'generation.lock');

// Only lock.js uses this, to decide whether a lock's pid is one it can check.
// The bare hostname is wrong for that on macOS: with no HostName set it is
// derived per-network, so one machine answers `panphora.local` on one network
// and `panphora.localdomain` on another. A flip mid-run turned ferry's own live
// lock into a foreign one, which then aged out and reported the running daemon
// as dead. Locks are local to this disk, so the short name cannot collide.
export function machineId() {
  return os.hostname().split('.')[0];
}

// --- hashing / collision ------------------------------------------------------
export function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}
export function collisionSuffix(raw) {
  return sha1(raw).slice(0, 8);
}
export const repoKeyHash = (repoRel) => sha1(repoRel).slice(0, 16);
export const repoLockFile = (repoRel) => path.join(locksDir(), `${repoKeyHash(repoRel)}.lock`);
export const journalFile = (repoRel) => path.join(journalsDir(), `${repoKeyHash(repoRel)}.json`);

// --- name encoding ------------------------------------------------------------
// A branch name can't legally contain "^" in git, so "/"->"^" is injective for
// free. Reject the handful of characters Dropbox refuses to sync in a name.
const BRANCH_SEP = '^';
const DROPBOX_UNSAFE = /["<>|\\:*?]/;
export const DETACHED = '_detached';

/** Repo path relative to root -> a single mirror folder component. */
export function encodeRepo(rel) {
  if (typeof rel !== 'string' || rel === '') throw new Error('empty repo path');
  return rel.split('/').join('__');
}

/** Git branch short-name -> a single mirror folder component. */
export function encodeBranch(branch) {
  if (branch == null || branch === DETACHED) return DETACHED;
  if (typeof branch !== 'string' || branch === '') throw new Error('empty branch name');
  if (branch.includes('\0')) throw new Error(`branch name contains NUL: ${branch}`);
  if (path.isAbsolute(branch)) throw new Error(`branch name is absolute: ${branch}`);
  if (branch.includes(BRANCH_SEP)) {
    throw new Error(`branch '${branch}' contains the reserved separator "${BRANCH_SEP}"`);
  }
  if (DROPBOX_UNSAFE.test(branch)) {
    throw new Error(`branch '${branch}' has a character Dropbox can't sync`);
  }
  const enc = branch.split('/').join(BRANCH_SEP);
  if (enc === '.' || enc === '..' || enc.startsWith('.')) {
    throw new Error(`branch name maps to an unsafe directory: ${branch}`);
  }
  return enc;
}

/** Reverse encodeBranch (used to label branches with saved mirror work). */
export function decodeBranch(enc) {
  if (enc === DETACHED) return null;
  return enc.split(BRANCH_SEP).join('/');
}

/**
 * Resolve a collision: `base` is the pure encoding, `claimedLower` is the set of
 * already-registered encoded names (lowercased for APFS case-insensitivity) owned
 * by OTHER raw inputs. If `base` collides, suffix with a deterministic hash of the
 * raw name so the later-registered input gets the disambiguated folder.
 */
export function resolveEnc(raw, base, claimedLower) {
  if (claimedLower.has(base.toLowerCase())) return `${base}-${collisionSuffix(raw)}`;
  return base;
}

// --- mirror layout (dropboxDir is the ferry root itself) ----------------------
export const mirrorRoot = (dbx = dropboxDir()) => dbx;
export const repoMirrorDir = (repoEnc, dbx = dropboxDir()) => path.join(dbx, repoEnc);
export const branchMirrorDir = (repoEnc, branchEnc, dbx = dropboxDir()) =>
  path.join(dbx, repoEnc, branchEnc);
export const mirrorMetaDir = (repoEnc, dbx = dropboxDir()) => path.join(dbx, repoEnc, `.${NAME}`);
export const manifestFile = (repoEnc, branchEnc, dbx = dropboxDir()) =>
  path.join(mirrorMetaDir(repoEnc, dbx), `${branchEnc}.manifest.json`);
export const mirrorTrashDir = (repoEnc, dbx = dropboxDir()) =>
  path.join(mirrorMetaDir(repoEnc, dbx), 'trash');

// --- local (pre-mutation) trash -----------------------------------------------
export const localTrashRepoDir = (repoEnc) => path.join(localTrashRoot(), repoEnc);

// FERRY_* keys the daemon needs baked into its plist (launchd inherits no shell
// environment). Whichever are set at install time are captured.
export const ENV_KEYS = [
  'FERRY_ROOT',
  'FERRY_DROPBOX_DIR',
  'FERRY_STATE_DIR',
  'FERRY_MAX_FILE_BYTES',
  'FERRY_DEBOUNCE_MS',
  'FERRY_SWEEP_MS',
  'FERRY_MODEL_BIN',
];
