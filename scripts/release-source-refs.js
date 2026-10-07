'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { execFileCaptured } = require('./release-command');
const { withFerryRepoLock } = require('./release-ferry');
const { runGitRemote, remoteFailureMessage } = require('./release-git-remote');
const { createLocalGitReader } = require('./release-local-read');
const { readPublishedSourceVersion } = require('./release-publication');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState } = require('./release-state-store');

const TAG_FORMAT = '--format=%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(refname)';
const READ_TIMEOUT_MS = 30000;
const PUSH_TIMEOUT_MS = 120000;
const MAIN_REF = 'refs/heads/main';
const DESTINATION_ARGS = ['remote', 'get-url', '--push', '--all', 'origin'];
const REPO_FIELDS = ['key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'];
const OID_PATTERN = /^[0-9a-f]+$/;
const UNRESOLVED = 'SOURCE_REF_UNRESOLVED';
const CONFLICT = 'SOURCE_REF_CONFLICT';

const localReader = createLocalGitReader();

function refError(code, message, diagnostic) {
  const error = new Error(message);
  error.code = code;
  if (diagnostic !== undefined) error.diagnostic = diagnostic;
  return error;
}

function invalidError(message) {
  return refError('SOURCE_REF_INVALID', message);
}

function conflictError(message) {
  return refError(CONFLICT, message);
}

function pendingError(message) {
  return refError('SOURCE_REF_PENDING', message);
}

function unresolvedError(message, diagnostic) {
  return refError(UNRESOLVED, message, diagnostic);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function oidLength(state) {
  return state.repo.objectFormat === 'sha256' ? 64 : 40;
}

function resolveDeps(deps, allowTagMutation) {
  const provided = deps === undefined ? {} : deps;
  if (!isRecord(provided)) throw invalidError('Source refs deps must be an object');
  const run = provided.run === undefined ? localReader.run : provided.run;
  const runMutation = provided.runMutation === undefined ? execFileCaptured : provided.runMutation;
  const spawnRemote = provided.spawnRemote === undefined ? childProcess.spawnSync : provided.spawnRemote;
  const ferry = provided.withFerryRepoLock === undefined ? withFerryRepoLock : provided.withFerryRepoLock;
  const io = provided.fs === undefined ? fs : provided.fs;
  const ferryOptions = provided.ferryOptions === undefined ? {} : provided.ferryOptions;
  const assertPublishWindow = provided.assertPublishWindow;
  if (typeof run !== 'function') throw invalidError('Source refs run must be a function');
  if (typeof runMutation !== 'function') throw invalidError('Source refs runMutation must be a function');
  if (typeof spawnRemote !== 'function') throw invalidError('Source refs spawnRemote must be a function');
  if (typeof ferry !== 'function') throw invalidError('Source refs withFerryRepoLock must be a function');
  if (!isRecord(io)) throw invalidError('Source refs fs must be an object');
  if (!isRecord(ferryOptions)) throw invalidError('Source refs ferryOptions must be an object');
  if (assertPublishWindow !== undefined && typeof assertPublishWindow !== 'function') {
    throw invalidError('Source refs assertPublishWindow must be a function');
  }
  if (allowTagMutation && typeof assertPublishWindow !== 'function') {
    throw invalidError('Source refs need a callable assertPublishWindow time policy to create or push the release tag');
  }
  return { run, runMutation, spawnRemote, ferry, io, ferryOptions, assertPublishWindow };
}

function selectedRef(state) {
  if (state.phase === 'source-ready' && state.activeAttemptId === null && state.attempts.length === 0) {
    return state.mode === 'dry-run' ? 'main' : `v${state.version}`;
  }
  const attempt = state.attempts.find(value => value.id === state.activeAttemptId);
  if (state.phase !== 'workflow' || !attempt || attempt.identityKind !== 'dispatch' ||
      attempt.dispatch !== 'ready' || attempt.sourceSha !== state.sourceSha ||
      attempt.version !== state.version || attempt.mode !== state.mode) {
    throw refError('SOURCE_REF_INVALID', 'Source refs require source-ready or a persisted ready attempt');
  }
  return attempt.dispatchRef;
}

function parseLocalTag(stdout, tagRef, sourceSha, length) {
  if (stdout === '') return null;
  if (typeof stdout !== 'string') throw unresolvedError('Local tag listing is not text');
  const rows = (stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout).split('\n');
  if (rows.length !== 1) throw unresolvedError('Local tag listing is not exactly one row');
  const columns = rows[0].split('\t');
  if (columns.length !== 5) throw unresolvedError('Local tag listing is not five columns');
  const [objectName, objectType, peeledName, peeledType, refName] = columns;
  if (!OID_PATTERN.test(objectName) || objectName.length !== length || refName !== tagRef) {
    throw unresolvedError('Local tag listing is malformed');
  }
  if (objectType !== 'tag' || peeledType !== 'commit') {
    throw conflictError('The local release tag is not an annotated tag naming a commit');
  }
  if (!OID_PATTERN.test(peeledName) || peeledName.length !== length) {
    throw unresolvedError('Local tag listing is malformed');
  }
  if (peeledName !== sourceSha) throw conflictError('The local release tag names a different source');
  return { tagObject: objectName, sourceSha: peeledName };
}

function requireDirectTagSource(text, sourceSha, length) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 256 * 1024) {
    throw unresolvedError('The local release tag object is not bounded text');
  }
  const lines = text.split('\n', 3);
  const object = /^object ([0-9a-f]+)$/.exec(lines[0]);
  const type = /^type (commit|tag|tree|blob)$/.exec(lines[1]);
  if (object === null || object[1].length !== length || type === null) {
    throw unresolvedError('The local release tag object header is malformed');
  }
  if (type[1] !== 'commit') {
    throw conflictError('The local release tag does not directly name a commit');
  }
  if (object[1] !== sourceSha) {
    throw conflictError('The local release tag directly names a different source');
  }
}

function parseRemoteTag(stdout, tagRef, sourceSha, length) {
  if (stdout === '') return null;
  if (typeof stdout !== 'string') throw refError(UNRESOLVED, 'Tag listing is not text');
  const rows = (stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout).split('\n');
  const refs = new Map();
  for (const row of rows) {
    const columns = row.split('\t');
    if (columns.length !== 2 || !/^[0-9a-f]+$/.test(columns[0]) || columns[0].length !== length ||
        ![tagRef, `${tagRef}^{}`].includes(columns[1]) || refs.has(columns[1])) {
      throw refError(UNRESOLVED, 'Tag listing is malformed');
    }
    refs.set(columns[1], columns[0]);
  }
  if (refs.size === 1 && refs.has(tagRef)) {
    throw refError(CONFLICT, 'Remote release tag is not annotated');
  }
  if (refs.size !== 2 || !refs.has(tagRef) || !refs.has(`${tagRef}^{}`)) {
    throw refError(UNRESOLVED, 'Tag listing is incomplete');
  }
  if (refs.get(`${tagRef}^{}`) !== sourceSha) {
    throw refError(CONFLICT, 'Remote release tag names a different source');
  }
  return { tagObject: refs.get(tagRef), sourceSha };
}

function parseRemoteMain(stdout, length) {
  if (stdout === '') return null;
  if (typeof stdout !== 'string') throw unresolvedError('Main listing is not text');
  const rows = (stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout).split('\n');
  if (rows.length !== 1) throw unresolvedError('Main listing is not exactly one row');
  const columns = rows[0].split('\t');
  if (columns.length !== 2 || !OID_PATTERN.test(columns[0]) || columns[0].length !== length ||
      columns[1] !== MAIN_REF) {
    throw unresolvedError('Main listing is malformed');
  }
  return columns[0];
}

function requirePersistedRecord(state, cacheRoot, io) {
  let saved;
  try {
    saved = readReleaseState(state.repo, { cacheRoot, mode: state.mode, fs: io });
  } catch (error) {
    throw conflictError('The persisted release record is not readable');
  }
  if (saved === null || !isDeepStrictEqual(saved, state)) {
    throw conflictError('The supplied release state is not the persisted record');
  }
}

function requireRecordedDestination(state, resolved) {
  const readGit = (root, args) => {
    const output = resolved.run('git', args, { cwd: root });
    return typeof output === 'string' ? output.trim() : String(output).trim();
  };
  let identity;
  try {
    identity = resolveRepoIdentity(state.repo.root, { readGit, fs: resolved.io });
  } catch (error) {
    throw conflictError('The release repository identity is not the recorded identity');
  }
  for (const field of REPO_FIELDS) {
    if (identity[field] !== state.repo[field]) {
      throw conflictError('The release repository identity is not the recorded identity');
    }
  }
  let text;
  try {
    text = resolved.run('git', DESTINATION_ARGS, { cwd: state.repo.root });
  } catch (error) {
    throw conflictError('The release push destination is not readable');
  }
  const destinations = String(text).split('\n').filter((line) => line.length > 0);
  if (destinations.length !== 1) {
    throw conflictError('The release origin must have exactly one push destination');
  }
  if (digest(destinations[0]) !== state.repo.pushUrlSha256) {
    throw conflictError('The release push destination is not the recorded destination');
  }
  return destinations[0];
}

function requirePublishedSource(context) {
  const { state, resolved } = context;
  try {
    readPublishedSourceVersion({
      repoRoot: state.repo.root, sourceSha: state.sourceSha, version: state.version
    }, { run: resolved.run, fs: resolved.io });
  } catch (error) {
    throw conflictError('The recorded release source does not carry the release version');
  }
}

function requireCurrentContext(context) {
  requirePersistedRecord(context.state, context.cacheRoot, context.io);
  return requireRecordedDestination(context.state, context.resolved);
}

function observeLocalTag(context) {
  const { state, tagRef, resolved } = context;
  let text;
  try {
    text = resolved.run('git', ['for-each-ref', '--count=2', TAG_FORMAT, tagRef], { cwd: state.repo.root });
  } catch (error) {
    throw unresolvedError('The local release tag is not readable');
  }
  const local = parseLocalTag(text, tagRef, state.sourceSha, oidLength(state));
  if (local === null) return null;
  let body;
  try {
    body = resolved.run('git', ['cat-file', 'tag', local.tagObject], {
      cwd: state.repo.root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024
    });
  } catch (error) {
    throw unresolvedError('The local release tag object is not readable');
  }
  requireDirectTagSource(body, state.sourceSha, oidLength(state));
  return local;
}

function observeRemoteTag(context, destination) {
  const { state, tagRef, resolved } = context;
  const args = ['ls-remote', '--tags', destination, tagRef, `${tagRef}^{}`];
  const result = runGitRemote({
    repoRoot: state.repo.root, destination, args, timeoutMs: READ_TIMEOUT_MS
  }, { spawnRemote: resolved.spawnRemote });
  if (result.failed) {
    throw unresolvedError(remoteFailureMessage(destination, args, result.diagnostic), result.diagnostic);
  }
  return parseRemoteTag(result.diagnostic.stdout, tagRef, state.sourceSha, oidLength(state));
}

function observeRemoteMain(context, destination) {
  const { state, resolved } = context;
  const args = ['ls-remote', '--refs', destination, MAIN_REF];
  const result = runGitRemote({
    repoRoot: state.repo.root, destination, args, timeoutMs: READ_TIMEOUT_MS
  }, { spawnRemote: resolved.spawnRemote });
  if (result.failed) {
    throw unresolvedError(remoteFailureMessage(destination, args, result.diagnostic), result.diagnostic);
  }
  return parseRemoteMain(result.diagnostic.stdout, oidLength(state));
}

async function verifyMainRef(context) {
  const { state } = context;
  requirePublishedSource(context);
  const observed = observeRemoteMain(context, requireCurrentContext(context));
  if (observed === null) throw conflictError('The remote main branch does not exist');
  if (observed !== state.sourceSha) throw conflictError('The remote main branch does not name the recorded source');
  return { sourceSha: state.sourceSha, dispatchRef: 'main' };
}

async function createReleaseTag(context) {
  const { state, tagName, resolved } = context;
  await resolved.ferry(state.repo.root, async () => {
    requireCurrentContext(context);
    requirePublishedSource(context);
    const appeared = observeLocalTag(context);
    if (appeared !== null) return;
    resolved.assertPublishWindow();
    resolved.runMutation('git', [
      '-c', 'tag.gpgSign=false', 'tag', '-a', tagName, state.sourceSha, '-m', tagName
    ], { cwd: state.repo.root, stdio: ['ignore', 'pipe', 'pipe'] });
    if (observeLocalTag(context) === null) {
      throw unresolvedError('The created release tag is not observable');
    }
  }, resolved.ferryOptions);
}

async function pushReleaseTag(context, tagObject) {
  const { state, tagRef, resolved } = context;
  let destination = requireCurrentContext(context);
  if (observeRemoteTag(context, destination) !== null) return;
  destination = requireCurrentContext(context);
  const current = observeLocalTag(context);
  if (current === null || current.tagObject !== tagObject) {
    throw conflictError('The local release tag changed before the push');
  }
  resolved.assertPublishWindow();
  const pushArgs = ['push', '--porcelain', destination, `${tagObject}:${tagRef}`];
  const pushed = runGitRemote({
    repoRoot: state.repo.root, destination, args: pushArgs, timeoutMs: PUSH_TIMEOUT_MS
  }, { spawnRemote: resolved.spawnRemote });
  requireCurrentContext(context);
  let observed = null;
  let observationError = null;
  try {
    observed = observeRemoteTag(context, destination);
  } catch (error) {
    observationError = error;
  }
  if (observed !== null) return;
  if (observationError !== null) throw observationError;
  const message = pushed.failed
    ? `${remoteFailureMessage(destination, pushArgs, pushed.diagnostic)} and the release tag is still absent`
    : 'The release tag push was not confirmed by the remote';
  throw unresolvedError(message, pushed.diagnostic);
}

async function verifyTagRef(context) {
  const { state, tagName, allowTagMutation } = context;
  const destination = requireCurrentContext(context);
  requirePublishedSource(context);
  let local = observeLocalTag(context);
  const remote = observeRemoteTag(context, destination);

  if (remote !== null) {
    if (local === null) {
      throw conflictError('The remote release tag exists without the local annotated tag; restore the local tag separately');
    }
    const recheck = observeLocalTag(context);
    if (recheck === null || recheck.tagObject !== local.tagObject) {
      throw conflictError('The local release tag changed during this invocation');
    }
    return { sourceSha: state.sourceSha, dispatchRef: tagName };
  }

  if (local === null) {
    if (!allowTagMutation) throw pendingError('The release tag must be created');
    await createReleaseTag(context);
    local = observeLocalTag(context);
    if (local === null) throw unresolvedError('The created release tag is not observable');
  }

  if (!allowTagMutation) throw pendingError('The release tag must be pushed');
  await pushReleaseTag(context, local.tagObject);
  return { sourceSha: state.sourceSha, dispatchRef: tagName };
}

async function ensureSourceRefs(input, deps) {
  if (!isRecord(input)) throw invalidError('Source refs need an explicit input');
  const allowTagMutation = input.allowTagMutation === undefined ? false : input.allowTagMutation;
  if (typeof allowTagMutation !== 'boolean') {
    throw invalidError('Source refs allowTagMutation must be a boolean');
  }
  const resolved = resolveDeps(deps, allowTagMutation);
  const { state, repoDir } = input;
  if (!isRecord(state)) throw invalidError('Source refs need a validated release state');
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || path.normalize(repoDir) !== repoDir ||
      repoDir.endsWith(path.sep) || path.dirname(repoDir) === repoDir) {
    throw invalidError('Source refs need the canonical release cache directory');
  }
  validateReleaseState(state, state.repo, { repoDir });
  const cacheRoot = path.dirname(repoDir);
  const paths = statePaths(state.repo, { cacheRoot, fs: resolved.io });
  if (paths.repoDir !== repoDir) {
    throw invalidError('Source refs cache directory is not the canonical repository cache');
  }

  const dispatchRef = selectedRef(state);
  const tagName = `v${state.version}`;
  if (dispatchRef !== 'main' && dispatchRef !== tagName) {
    throw invalidError('Source refs require main or the release version tag');
  }

  const context = {
    state,
    cacheRoot,
    io: resolved.io,
    resolved,
    tagName,
    tagRef: `refs/tags/${tagName}`,
    allowTagMutation
  };

  if (dispatchRef === 'main') return verifyMainRef(context);
  return verifyTagRef(context);
}

module.exports = { ensureSourceRefs };
