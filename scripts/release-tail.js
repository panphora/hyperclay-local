'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { execFileCaptured } = require('./release-command');
const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState, writeReleaseState } = require('./release-state-store');
const { transitionRelease } = require('./release-transitions');
const { readPublicationEvidence } = require('./release-publication');
const { readSizeEvidence } = require('./release-size-evidence');
const { reconcileReleaseSizes } = require('./release-sizes');
const { prepareSiteAttempt, runSiteAttempt, reconcileSiteAttempt } = require('./release-site');
const { readSiteAttempt, readSiteEvidence } = require('./release-site-evidence');
const { readTargetEvidence, readCompletedTargetEvidence } = require('./release-target-evidence');
const { readPreparedTarget } = require('./release-docs-plan');
const { readDocsRun, attemptPaths } = require('./release-docs-run');
const { updateExternalDocs } = require('./update-external-docs');
const { withFerryRepoLock } = require('./release-ferry');

const reader = createLocalGitReader();
const DOC_REPOS = ['hyperclay', 'hyperclay-website'];
const IDENTITY_KEYS = ['key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'];
const DOC_OUTCOMES = new Map([
  ['DOCS_REPO_MISSING', 'missing'],
  ['DOCS_PREIMAGE_CONFLICT', 'conflict'],
  ['DOCS_LOCAL_CONFLICT', 'conflict'],
  ['DOCS_REMOTE_CONTENT_CONFLICT', 'conflict'],
  ['DOCS_REMOTE_DIVERGED', 'conflict'],
  ['DOCS_REMOTE_UNREADABLE', 'pending-push'],
  ['DOCS_REMOTE_OBJECT_MISSING', 'pending-push'],
  ['DOCS_REMOTE_HISTORY_UNRESOLVED', 'pending-push'],
  ['DOCS_REMOTE_PUSH_FAILED', 'pending-push'],
  ['DOCS_REMOTE_PUSH_UNCONFIRMED', 'pending-push']
]);

function error(code, message, cause) {
  const result = Object.assign(new Error(message), { code });
  if (cause !== undefined) result.cause = cause;
  return result;
}

function need(condition, message) {
  if (!condition) throw error('RELEASE_TAIL_INVALID', message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return isDeepStrictEqual(left, right);
}

function stateInput(input) {
  need(object(input) && object(input.state) && object(input.state.repo), 'Tail requires a release state');
  const { repoDir } = input;
  need(typeof repoDir === 'string' && path.isAbsolute(repoDir) && path.normalize(repoDir) === repoDir
    && !/[\u0000-\u001f\u007f]/.test(repoDir), 'Tail cache directory must be canonical');
  validateReleaseState(input.state, input.state.repo, { repoDir });
  const state = copy(input.state);
  need(state.mode === 'publish' && ['tail', 'complete'].includes(state.phase)
    && state.artifacts.state === 'complete', 'Tail requires verified publish artifacts');
  return { state, repoDir };
}

function reads(deps = {}) {
  need(object(deps), 'Tail read dependencies must be an object');
  const result = {
    run: deps.run === undefined ? reader.run : deps.run,
    spawn: deps.spawn === undefined ? reader.spawn : deps.spawn,
    fs: deps.fs === undefined ? fs : deps.fs
  };
  need(typeof result.run === 'function' && typeof result.spawn === 'function' && object(result.fs),
    'Tail read dependencies are invalid');
  return result;
}

function resolveDeps(deps = {}) {
  need(object(deps), 'Tail dependencies must be an object');
  const local = reads({ run: deps.readRun, spawn: deps.readSpawn, fs: deps.fs });
  const d = {
    local, io: local.fs,
    run: deps.run === undefined ? execFileCaptured : deps.run,
    spawn: deps.spawn === undefined ? childProcess.spawnSync : deps.spawn,
    spawnRemote: deps.spawnRemote === undefined ? childProcess.spawnSync : deps.spawnRemote,
    now: deps.now === undefined ? () => Date.now() : deps.now,
    randomUUID: deps.randomUUID === undefined ? () => crypto.randomUUID() : deps.randomUUID,
    ferry: deps.withFerryRepoLock === undefined ? withFerryRepoLock : deps.withFerryRepoLock,
    ferryOptions: deps.ferryOptions === undefined ? {} : deps.ferryOptions,
    guard: deps.assertPublishWindow,
    deploy: deps.deploy
  };
  for (const key of ['run', 'spawn', 'spawnRemote', 'now', 'randomUUID', 'ferry']) {
    need(typeof d[key] === 'function', `Tail dependency ${key} must be callable`);
  }
  need(d.deploy === undefined || typeof d.deploy === 'function', 'Tail deploy must be callable');
  return d;
}

function stamp(d) {
  const value = d.now();
  need(typeof value === 'number' && Number.isFinite(value), 'Tail clock must return milliseconds');
  const date = new Date(value);
  need(!Number.isNaN(date.getTime()), 'Tail clock must return a valid time');
  return date.toISOString();
}

function current(state, repoDir, d) {
  need(statePaths(state.repo, { cacheRoot: path.dirname(repoDir), fs: d.io }).repoDir === repoDir,
    'Tail cache directory belongs to another repository');
  const loaded = readReleaseState(state.repo, { cacheRoot: path.dirname(repoDir), mode: 'publish', fs: d.io });
  need(loaded !== null && same(loaded, state), 'Tail input is not the persisted release state');
  return loaded;
}

function acknowledge(before, returned, repoDir, d) {
  const expected = stateInput({ state: returned, repoDir }).state;
  for (const key of ['repo', 'releaseId', 'version', 'mode', 'sourceSha', 'activeAttemptId', 'attempts', 'artifacts']) {
    need(same(expected[key], before[key]), `Tail helper changed immutable release identity: ${key}`);
  }
  return current(expected, repoDir, d);
}

function persist(state, repoDir, event, d) {
  current(state, repoDir, d);
  const next = transitionRelease(state, { ...event, at: stamp(d) }, state.repo, { repoDir });
  writeReleaseState(next, state.repo, {
    cacheRoot: path.dirname(repoDir), expectedRevision: state.revision, fs: d.io
  });
  return acknowledge(state, next, repoDir, d);
}

function acting(state, repoDir, d) {
  need(typeof d.guard === 'function', 'Acting tail work requires a publish-window guard');
  current(state, repoDir, d);
  const observed = resolveRepoIdentity(state.repo.root, {
    fs: d.io, readGit: (root, args) => d.local.run('git', args, { cwd: root }).trim()
  });
  for (const key of IDENTITY_KEYS) need(observed[key] === state.repo[key], `Tail repository identity changed: ${key}`);
}

function evidenceRoot(state, repoDir) {
  return path.join(repoDir, 'records', state.releaseId);
}

function statOrNull(file, io) {
  try { return io.lstatSync(file); }
  catch (cause) {
    if (cause && cause.code === 'ENOENT') return null;
    throw cause;
  }
}

function leaf(root, file, io, allowMissing = false) {
  need(typeof file === 'string' && path.isAbsolute(file) && path.normalize(file) === file
    && !/[\u0000-\u001f\u007f]/.test(file), 'Docs evidence path is not canonical');
  const relative = path.relative(root, file);
  need(relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Docs evidence path escaped the release record');
  need(io.realpathSync(root) === root, 'Docs release evidence root is not canonical');
  let dir = root;
  const rootStat = io.lstatSync(dir);
  need(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Docs release evidence root is not ordinary');
  for (const part of relative.split(path.sep).slice(0, -1)) {
    dir = path.join(dir, part);
    const stat = statOrNull(dir, io);
    if (stat === null && allowMissing) return false;
    need(stat !== null && stat.isDirectory() && !stat.isSymbolicLink(), 'Docs evidence parent is not ordinary');
  }
  const stat = statOrNull(file, io);
  if (stat === null && allowMissing) return false;
  need(stat !== null && stat.isFile() && !stat.isSymbolicLink(), 'Docs evidence file is not ordinary');
  return true;
}

function jsonRecord(root, file, io) {
  leaf(root, file, io);
  const bytes = readBoundedOrdinaryFile(file, { maxBytes: 8 * 1024 * 1024, fs: io });
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch (cause) { throw error('RELEASE_TAIL_EVIDENCE_INVALID', 'Docs evidence JSON is invalid', cause); }
  need(object(parsed), 'Docs evidence must hold an object');
  return parsed;
}

function docEvidence(state, repoDir, repo, journalFile, local, allowMissing = false) {
  const root = evidenceRoot(state, repoDir);
  if (!leaf(root, journalFile, local.fs, allowMissing)) return null;
  const raw = jsonRecord(root, journalFile, local.fs);
  const applicationFile = path.join(path.dirname(journalFile), 'application.json');
  need(raw.applicationFile === applicationFile && raw.repo === repo && raw.version === state.version
    && raw.repoRoot === path.join(path.dirname(state.repo.root), repo), 'Docs journal belongs to another target');
  const app = jsonRecord(root, applicationFile, local.fs);
  need(app.preparedFile === raw.preparedFile, 'Docs application and journal disagree on their preparation');
  leaf(root, raw.preparedFile, local.fs);
  const prepared = readPreparedTarget(raw.preparedFile, { repo, version: state.version });
  for (const file of [app.patchFile, app.privateIndexFile]) leaf(root, file, local.fs);
  need(Array.isArray(app.files) && app.files.length > 0, 'Docs application has no selected evidence');
  for (const file of app.files) {
    need(object(file), 'Docs application file is malformed');
    leaf(root, file.beforeFile, local.fs);
    leaf(root, file.afterFile, local.fs);
  }
  need(Array.isArray(prepared.target.paths), 'Docs prepared target is malformed');
  for (const file of prepared.target.paths) {
    need(object(file), 'Docs prepared file is malformed');
    leaf(root, file.beforeFile, local.fs);
    leaf(root, file.afterFile, local.fs);
  }
  const verified = readTargetEvidence(journalFile, local);
  need(same(verified.journal, raw), 'Docs journal changed during validation');
  return verified;
}

function isComplete(journal) {
  return journal.phase === 'complete' && journal.state === 'complete' && journal.reason === null;
}

function completedDoc(state, repoDir, repo, journalFile, commit, local) {
  const evidence = docEvidence(state, repoDir, repo, journalFile, local);
  need(isComplete(evidence.journal) && evidence.journal.commit === commit, 'Docs target has no matching completed journal');
  const proof = readCompletedTargetEvidence({
    journalFile, evidenceRoot: evidenceRoot(state, repoDir), repo, version: state.version, commit
  }, local);
  need(proof.observedHead === evidence.journal.remoteObservation.head
    && proof.verifiedAt === evidence.journal.remoteObservation.observedAt,
    'Docs completion changed during verification');
  return { proof, evidence };
}

function verifyRetainedRelease(input, deps) {
  const { state, repoDir } = stateInput(input);
  const local = reads(deps);
  need([state.sizes, state.site, ...DOC_REPOS.map(repo => state.docs[repo])]
    .every(target => target.state === 'complete'), 'Required tail targets are not all complete');
  readPublicationEvidence({ state, repoDir }, local);
  readSizeEvidence({ state, repoDir }, local);
  readSiteEvidence({ state, repoDir }, local);
  for (const repo of DOC_REPOS) {
    const target = state.docs[repo];
    completedDoc(state, repoDir, repo, target.journalFile, target.commit, local);
  }
}

function docsOptions(state, repoDir) {
  const runDir = path.join(evidenceRoot(state, repoDir), 'docs');
  return {
    version: state.version, parentDir: path.dirname(state.repo.root), runDir,
    resultFile: path.join(runDir, 'result.json'),
    owner: { root: state.repo.root, commonDir: state.repo.commonDir, key: state.repo.key }
  };
}

function historicalDoc(state, repoDir, repo, d) {
  const target = state.docs[repo];
  if (target.state === 'complete') {
    completedDoc(state, repoDir, repo, target.journalFile, target.commit, d.local);
    return state;
  }
  let retained = null;
  if (target.journalFile !== null) {
    retained = docEvidence(state, repoDir, repo, target.journalFile, d.local);
    need(target.commit === null || target.commit === retained.journal.commit, 'Docs journal changed its recorded commit');
    if (isComplete(retained.journal)) {
      completedDoc(state, repoDir, repo, target.journalFile, retained.journal.commit, d.local);
      return persist(state, repoDir, { type: 'target-observed', target: `docs.${repo}`, result: {
        state: 'complete', journalFile: target.journalFile, commit: retained.journal.commit, reason: null
      } }, d);
    }
  }
  const options = docsOptions(state, repoDir);
  const run = readDocsRun(options, { fs: d.io });
  if (run === null) {
    need(target.journalFile === null, 'A pending public docs journal has lost its run record');
    return state;
  }
  const slot = run.targets[DOC_REPOS.indexOf(repo)];
  if (slot.attemptId === null) {
    need(target.journalFile === null, 'A pending public docs journal has lost its selected attempt');
    return state;
  }
  const paths = attemptPaths(options.runDir, repo, slot.attemptId);
  need(target.journalFile === null || target.journalFile === paths.journalFile,
    'Public docs state and the selected attempt disagree');
  if (retained === null) retained = docEvidence(state, repoDir, repo, paths.journalFile, d.local, true);
  if (retained === null) {
    need(slot.journalOperationId === null, 'A bound docs operation has lost its journal');
    return state;
  }
  const journal = retained.journal;
  need(journal.applicationFile === paths.applicationFile && journal.preparedFile === paths.preparedFile
    && (slot.journalOperationId === null || slot.journalOperationId === journal.operationId),
    'Docs journal does not match its selected run slot');
  if (!isComplete(journal)) return state;
  completedDoc(state, repoDir, repo, paths.journalFile, journal.commit, d.local);
  return persist(state, repoDir, { type: 'target-observed', target: `docs.${repo}`, result: {
    state: 'complete', journalFile: paths.journalFile, commit: journal.commit, reason: null
  } }, d);
}

function ordinaryDeployFailure(failure) {
  if (!object(failure) || failure.code !== 'SITE_DEPLOY_UNRESOLVED') return false;
  const queue = [failure];
  const seen = new Set();
  while (queue.length > 0) {
    const item = queue.shift();
    if (!object(item) || seen.has(item)) continue;
    seen.add(item);
    if (item.cleanupError != null || item.closeError != null) return false;
    if (item !== failure && typeof item.code === 'string'
      && /^(?:STATE_|REPO_|RELEASE_|DOCS_|LOCK_|FERRY_|PUBLICATION_|SIZE_|SITE_|LOCAL_EVIDENCE_)/.test(item.code)) return false;
    queue.push(item.cause);
  }
  return true;
}

function siteDeps(d) {
  return { ...d.local, now: () => stamp(d) };
}

function recoverDeployFailure(before, repoDir, d) {
  const loaded = readReleaseState(before.repo, { cacheRoot: path.dirname(repoDir), mode: 'publish', fs: d.io });
  need(loaded !== null && loaded.site.state === 'unknown' && loaded.site.error !== null
    && loaded.site.error.code === 'SITE_DEPLOY_UNRESOLVED'
    && loaded.site.sourceSha === before.site.sourceSha && loaded.site.treeSha === before.site.treeSha
    && loaded.site.attemptId === before.site.attemptId
    && loaded.site.receiptSha === null && loaded.site.verifiedAt === null,
    'Deployment failure has no matching durable unknown checkpoint');
  const expected = transitionRelease(before, { type: 'target-observed', target: 'site',
    at: loaded.updatedAt, result: loaded.site }, before.repo, { repoDir });
  need(same(loaded, copy(expected)), 'Deployment failure changed more than the site checkpoint');
  const attempt = readSiteAttempt({ state: loaded, repoDir }, d.local);
  need(attempt.descriptor.phase === 'requested', 'Deployment failure did not retain its requested descriptor');
  return loaded;
}

function finishSite(state, repoDir, retrySite, d) {
  if (state.site.state === 'complete') {
    readSiteEvidence({ state, repoDir }, d.local);
    return { state, error: null };
  }
  need(['pending', 'unknown'].includes(state.site.state), 'Site target is not an ordinary pending or unresolved attempt');
  need(state.site.state !== 'unknown' || state.site.attemptId !== null, 'An unknown site requires its retained attempt');
  if (state.site.attemptId === null) {
    need(state.site.sourceSha === null && state.site.treeSha === null && state.site.receiptSha === null
      && state.site.verifiedAt === null && state.site.error === null, 'A new pending site has unexpected attempt evidence');
  }
  if (state.site.attemptId !== null) {
    state = acknowledge(state, reconcileSiteAttempt({ state, repoDir }, siteDeps(d)), repoDir, d);
  }
  if (state.site.state === 'complete') {
    readSiteEvidence({ state, repoDir }, d.local);
    return { state, error: null };
  }
  if (state.site.state === 'unknown' && !retrySite) {
    return { state, error: error('SITE_DEPLOY_UNRESOLVED', 'The recorded site deployment remains unresolved') };
  }
  acting(state, repoDir, d);
  if (state.site.attemptId === null || state.site.state === 'unknown') {
    state = acknowledge(state, prepareSiteAttempt({ state, repoDir, attemptId: d.randomUUID(),
      retrySite: state.site.state === 'unknown' }, siteDeps(d)), repoDir, d);
  }
  let result;
  try {
    result = runSiteAttempt({ state, repoDir }, { ...siteDeps(d), deploy: d.deploy, assertPublishWindow: d.guard });
  } catch (failure) {
    if (!ordinaryDeployFailure(failure)) throw failure;
    return { state: recoverDeployFailure(state, repoDir, d), error: failure };
  }
  state = acknowledge(state, result, repoDir, d);
  readSiteEvidence({ state, repoDir }, d.local);
  return { state, error: null };
}

function sizeDeps(d) {
  return {
    run: d.run, spawn: d.spawn, readRun: d.local.run, readSpawn: d.local.spawn,
    spawnRemote: d.spawnRemote, fs: d.io, now: d.now, randomUUID: d.randomUUID,
    withFerryRepoLock: d.ferry, ferryOptions: d.ferryOptions, assertPublishWindow: d.guard
  };
}

async function finishDoc(state, repoDir, repo, d) {
  state = historicalDoc(state, repoDir, repo, d);
  if (state.docs[repo].state === 'complete') return { state, error: null };
  acting(state, repoDir, d);
  const options = docsOptions(state, repoDir);
  const aggregate = await updateExternalDocs({ version: state.version, parentDir: options.parentDir,
    runDir: options.runDir, resultFile: options.resultFile, targets: [repo] }, {
    repoRoot: state.repo.root, cacheRoot: path.dirname(repoDir), fs: d.io,
    readGit: (root, args) => d.local.run('git', args, { cwd: root }).trim(),
    run: d.run, spawn: d.spawn, spawnRemote: d.spawnRemote, now: d.now,
    randomUUID: d.randomUUID, assertPublishWindow: d.guard, withFerryRepoLock: d.ferry
  });
  current(state, repoDir, d);
  need(object(aggregate) && aggregate.schema === 1 && aggregate.version === state.version
    && Array.isArray(aggregate.targets) && aggregate.targets.length === 2
    && aggregate.targets.every((entry, index) => object(entry) && entry.repo === DOC_REPOS[index]),
    'Docs updater returned a mismatched aggregate');
  const entry = aggregate.targets[DOC_REPOS.indexOf(repo)];
  const prior = state.docs[repo];
  need(prior.journalFile === null || prior.journalFile === entry.journalFile, 'Docs updater replaced its public journal');
  need(prior.commit === null || prior.commit === entry.commit, 'Docs updater replaced its public commit');
  let failure = null;
  if (entry.state === 'complete') {
    const { proof, evidence } = completedDoc(state, repoDir, repo, entry.journalFile, entry.commit, d.local);
    need(entry.reason === null && entry.beforeHead === evidence.journal.beforeHead
      && same(entry.paths, evidence.journal.requiredPaths)
      && entry.remoteHead === proof.observedHead && entry.verifiedAt === proof.verifiedAt,
      'Docs aggregate completion differs from its retained proof');
  } else {
    need(object(entry.reason) && typeof entry.reason.code === 'string'
      && typeof entry.reason.message === 'string' && entry.reason.message.length > 0,
      'Incomplete docs target has no usable reason');
    failure = error(entry.reason.code, entry.reason.message);
    if (DOC_OUTCOMES.get(entry.reason.code) !== entry.state) throw failure;
    need(entry.state !== 'pending-push' || (entry.journalFile !== null && entry.commit !== null),
      'A pending docs push requires its retained commit');
    if (entry.journalFile !== null) {
      const evidence = docEvidence(state, repoDir, repo, entry.journalFile, d.local);
      need(!isComplete(evidence.journal) && evidence.journal.commit === entry.commit,
        'Incomplete docs aggregate contradicts its journal');
    } else {
      need(entry.commit === null, 'Docs target has a commit without its journal');
    }
  }
  const result = { state: entry.state, journalFile: entry.journalFile, commit: entry.commit,
    reason: entry.reason === null ? null : {
      code: entry.reason.code.slice(0, 256), message: entry.reason.message.slice(0, 4096)
    } };
  state = persist(state, repoDir, { type: 'target-observed', target: `docs.${repo}`, result }, d);
  return { state, error: failure };
}

async function finishReleaseTail(input, deps) {
  const parsed = stateInput(input);
  const repoDir = parsed.repoDir;
  const d = resolveDeps(deps);
  let state = current(parsed.state, repoDir, d);
  const retrySite = input.retrySite === undefined ? false : input.retrySite;
  need(typeof retrySite === 'boolean', 'retrySite must be a boolean');
  need(!retrySite || (state.site.state === 'unknown' && state.site.attemptId !== null),
    'Site retry requires an unresolved attempt on entry');
  if (state.phase === 'complete') {
    verifyRetainedRelease({ state, repoDir }, d.local);
    return { state, error: null };
  }
  readPublicationEvidence({ state, repoDir }, d.local);
  if (state.site.state === 'complete') readSiteEvidence({ state, repoDir }, d.local);
  for (const repo of DOC_REPOS) {
    const target = state.docs[repo];
    if (target.state === 'complete') completedDoc(state, repoDir, repo, target.journalFile, target.commit, d.local);
  }
  need(state.site.attemptId === null || state.sizes.state === 'complete',
    'A retained site attempt requires completed size evidence');
  let firstError = null;
  const sizes = await reconcileReleaseSizes({ state, repoDir }, sizeDeps(d));
  state = acknowledge(state, sizes.state, repoDir, d);
  if (sizes.error !== null) firstError = sizes.error;
  if (state.sizes.state === 'complete') {
    const site = finishSite(state, repoDir, retrySite, d);
    state = site.state;
    if (firstError === null && site.error !== null) firstError = site.error;
  }
  for (const repo of DOC_REPOS) {
    const docs = await finishDoc(state, repoDir, repo, d);
    state = docs.state;
    if (firstError === null && docs.error !== null) firstError = docs.error;
  }
  const complete = [state.sizes, state.site, ...DOC_REPOS.map(repo => state.docs[repo])]
    .every(target => target.state === 'complete');
  if (firstError !== null || !complete) {
    return { state, error: firstError || error('RELEASE_TAIL_PENDING', 'Required release targets remain incomplete') };
  }
  verifyRetainedRelease({ state, repoDir }, d.local);
  state = persist(state, repoDir, { type: 'tail-complete' }, d);
  verifyRetainedRelease({ state, repoDir }, d.local);
  return { state, error: null };
}

module.exports = { finishReleaseTail, verifyRetainedRelease };
