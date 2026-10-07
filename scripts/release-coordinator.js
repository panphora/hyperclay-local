'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { performance } = require('node:perf_hooks');
const { isDeepStrictEqual } = require('node:util');
const { execFileCaptured } = require('./release-command');
const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState, writeReleaseState } = require('./release-state-store');
const { withReleaseLock } = require('./release-lock');
const { createReleaseState, transitionRelease } = require('./release-transitions');
const { prepareVersionIntent, reconcileVersionIntent } = require('./release-source');
const { ensureSourceRefs } = require('./release-source-refs');
const { makeWorkflowAttempt } = require('./release-workflow-identity');
const { reconcileWorkflowAttempt } = require('./release-workflow');
const { readGithubJson } = require('./release-read-policy');
const { readPublishedSourceVersion } = require('./release-publication');
const { observePublication, persistPublication, verifyCurrentPublication,
  reconcileLegacyRelease, reconcileLegacyFailure, reobserveFailedRelease } = require('./release-publication-write');
const { finishReleaseTail, verifyRetainedRelease } = require('./release-tail');
const { runGitRemote } = require('./release-git-remote');
const { validateOptions, requireVersion, above, bumpVersion, assertPublishWindow } = require('./release-options');

const REPO_KEYS = ['key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'];
const copy = value => JSON.parse(JSON.stringify(value));
const active = state => state.attempts.find(attempt => attempt.id === state.activeAttemptId);
function fail(code, message, cause) { return Object.assign(new Error(message), { code, cause }); }
function need(value, message) { if (!value) throw fail('RELEASE_COORDINATOR_INVALID', message); }

async function runRelease({ repoRoot, cacheRoot, flags }, supplied = {}) {
  const f = validateOptions(flags);
  need(!f.help, 'Help belongs to the CLI entry');
  const reader = createLocalGitReader();
  const d = {
    fs: supplied.fs === undefined ? fs : supplied.fs,
    run: supplied.run === undefined ? execFileCaptured : supplied.run,
    spawn: supplied.spawn === undefined ? spawnSync : supplied.spawn,
    spawnRemote: supplied.spawnRemote === undefined ? spawnSync : supplied.spawnRemote,
    providerRun: supplied.providerRun === undefined ? spawnSync : supplied.providerRun,
    readRun: supplied.readRun === undefined ? reader.run : supplied.readRun,
    readSpawn: supplied.readSpawn === undefined ? reader.spawn : supplied.readSpawn,
    wallNow: supplied.wallNow === undefined ? () => Date.now() : supplied.wallNow,
    now: supplied.now === undefined ? () => performance.now() : supplied.now,
    randomUUID: supplied.randomUUID === undefined ? () => crypto.randomUUID() : supplied.randomUUID,
    signal: supplied.signal,
    chooseBump: supplied.chooseBump,
    newBuildGates: supplied.newBuildGates,
    install: supplied.install,
    log: supplied.log === undefined ? () => {} : supplied.log
  };
  for (const key of ['run', 'spawn', 'spawnRemote', 'providerRun', 'readRun', 'readSpawn',
    'wallNow', 'now', 'randomUUID', 'log']) need(typeof d[key] === 'function', `Invalid ${key} primitive`);
  const checkAbort = () => {
    if (d.signal && d.signal.aborted) throw fail('RELEASE_ABORTED', 'Release aborted', d.signal.reason);
  };
  const wall = () => {
    const value = d.wallNow();
    need(typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()), 'Invalid wall clock');
    return value;
  };
  const stamp = () => new Date(wall()).toISOString();
  const guard = () => { checkAbort(); assertPublishWindow(new Date(wall())); };
  const git = args => d.readRun('git', args, { cwd: repoRoot }).trim();
  const identify = () => resolveRepoIdentity(repoRoot, {
    readGit: (root, args) => d.readRun('git', args, { cwd: root }).trim(), fs: d.fs
  });
  const identity = identify();
  const paths = statePaths(identity, { cacheRoot, fs: d.fs });
  const repoDir = paths.repoDir;
  const root = path.dirname(repoDir);
  const local = { run: d.readRun, fs: d.fs };
  const readDeps = { run: d.readRun, spawn: d.readSpawn, fs: d.fs };
  const sharedRead = { now: d.now, wallNow: d.wallNow, signal: d.signal };
  for (const key of ['sleep', 'logReadFailure']) if (supplied[key] !== undefined) sharedRead[key] = supplied[key];
  const publicationDeps = { ...sharedRead, github: { run: d.providerRun }, local,
    manifest: supplied.manifestFetch === undefined ? {} : { fetch: supplied.manifestFetch }, randomUUID: d.randomUUID };
  const workflowDeps = { ...sharedRead, run: d.providerRun, localRun: d.readRun,
    fs: d.fs, assertPublishWindow: guard };
  const acting = { run: d.run, spawn: d.spawn, spawnRemote: d.spawnRemote, fs: d.fs,
    now: d.wallNow, randomUUID: d.randomUUID, assertPublishWindow: guard };
  for (const key of ['withFerryRepoLock', 'ferryOptions']) if (supplied[key] !== undefined) acting[key] = supplied[key];
  const tailDeps = { ...acting, readRun: d.readRun, readSpawn: d.readSpawn };
  if (supplied.deploy !== undefined) tailDeps.deploy = supplied.deploy;
  const refsDeps = { ...acting, run: d.readRun, runMutation: d.run };
  const readLane = mode => readReleaseState(identity, { cacheRoot: root, mode, fs: d.fs });
  const assertIdentity = () => {
    const found = identify();
    need(REPO_KEYS.every(key => found[key] === identity[key]), 'Repository identity changed during release');
  };
  const acknowledge = value => {
    validateReleaseState(value, identity, { repoDir });
    const saved = readLane(value.mode);
    if (saved === null || !isDeepStrictEqual(saved, copy(value))) {
      throw fail('RELEASE_COORDINATOR_STATE_STALE', 'Returned state is not the current durable lane');
    }
    return saved;
  };
  const write = (value, previous) => {
    writeReleaseState(value, identity, { cacheRoot: root,
      expectedRevision: previous === null ? null : previous.revision, fs: d.fs });
    return acknowledge(value);
  };
  const event = (state, change) => write(transitionRelease(state, { ...change, at: stamp() }, identity, { repoDir }), state);
  const currentVersion = () => {
    const bytes = readBoundedOrdinaryFile(path.join(identity.root, 'package.json'), { fs: d.fs, maxBytes: 1024 * 1024 });
    return requireVersion(JSON.parse(bytes.toString('utf8')).version);
  };
  const requireHeadVersion = version => {
    const head = git(['rev-parse', 'HEAD']);
    readPublishedSourceVersion({ repoRoot: identity.root, sourceSha: head, version }, local);
    need(currentVersion() === version, 'Working package version differs from the selected release');
    return head;
  };
  const workflowDefinition = async expectedId => {
    const repo = identity.remoteRepo.slice('github.com/'.length);
    const definition = await readGithubJson('github.workflow-definition', {
      repo, endpoint: `repos/${repo}/actions/workflows/release.yml`
    }, { ...sharedRead, run: d.providerRun }, { deadline: d.now() + 90000 });
    need(definition && Number.isSafeInteger(definition.id) && definition.id > 0 &&
      definition.path === '.github/workflows/release.yml' && definition.state === 'active' &&
      (expectedId === undefined || definition.id === expectedId), 'Release workflow definition changed or is inactive');
    return definition.id;
  };
  const remoteMain = sourceSha => {
    assertIdentity();
    const destination = git(['remote', 'get-url', '--push', '--all', 'origin']);
    const result = runGitRemote({ repoRoot: identity.root, destination,
      args: ['ls-remote', '--exit-code', destination, 'refs/heads/main'], timeoutMs: 30000 },
    { spawnRemote: d.spawnRemote });
    const text = result.diagnostic.stdout;
    if (result.failed || (text !== `${sourceSha}\trefs/heads/main\n` && text !== `${sourceSha}\trefs/heads/main`)) {
      throw fail('RELEASE_REPAIR_SOURCE_UNRESOLVED', 'Remote main does not prove the selected repair source');
    }
    assertIdentity();
  };
  let gatesDone = false;
  const gates = async (kind, state, sourceSha = null) => {
    if (gatesDone) return;
    checkAbort();
    need(typeof d.newBuildGates === 'function', 'New work needs the actual CLI build gates');
    await d.newBuildGates({ kind, version: state ? state.version : currentVersion(), sourceSha,
      skipUiPass: f.skipUiPass });
    checkAbort();
    assertIdentity();
    gatesDone = true;
  };

  return withReleaseLock(identity, async () => {
    assertIdentity();
    checkAbort();
    let state = readLane(f.dryRun ? 'dry-run' : 'publish');
    let deferredVersion = null;
    const result = (outcome, error = null) => ({ state, outcome, error, deferredVersion });
    const pending = message => result('pending', fail('RELEASE_PENDING', message));
    const oid = new RegExp(`^[0-9a-f]{${identity.objectFormat === 'sha256' ? 64 : 40}}$`);
    if (f.resumeSource !== null) need(oid.test(f.resumeSource), 'Repair source has the wrong repository object format');
    if (f.retrySite) need(state && state.phase === 'tail' && state.site.state === 'unknown',
      '--retry-site needs the recorded unknown site attempt');
    if (f.resumeSource !== null && state !== null) need(state.phase === 'failed-ci',
      '--resume-source needs the existing failed-ci publish lane');

    if (f.dryRun) {
      const publish = readLane('publish');
      const attempt = publish && active(publish);
      need(!attempt || !['requested', 'unknown'].includes(attempt.dispatch) &&
        !(attempt.dispatch === 'identified' && attempt.runStatus !== 'completed'),
      'An unresolved or running publish attempt blocks another rehearsal');
      if (state && state.phase === 'complete' && f.resume) return result('dry-run-complete');
      if (state && state.phase === 'failed-ci' && !f.resume) {
        const checked = await reconcileWorkflowAttempt({ state, repoDir, allowDispatch: false }, workflowDeps);
        state = acknowledge(checked.state);
        if (checked.outcome !== 'failed-ci') return result('pending', checked.error);
      }
      if (state === null || state.phase === 'complete' || state.phase === 'failed-ci' && !f.resume) {
        const version = currentVersion();
        const sourceSha = requireHeadVersion(version);
        await gates('dry-run', null, sourceSha);
        need(requireHeadVersion(version) === sourceSha, 'Dry-run source changed during build gates');
        const next = createReleaseState({ releaseId: d.randomUUID(), version, mode: 'dry-run',
          at: stamp(), sourceSha, versionIntent: null }, identity, { repoDir });
        state = write(next, state);
      }
    } else {
      if (state && state.phase === 'complete') {
        verifyRetainedRelease({ state, repoDir }, readDeps);
        if (f.resume || f.reconcileOnly) return result('complete');
        need(currentVersion() === state.version, 'Current version conflicts with the completed release');
        const bump = f.bump || (f.version === null ? await choose() : null);
        const version = f.version || bumpVersion(state.version, bump);
        need(above(version, state.version), 'A new release version must be above the completed release');
        await gates('fresh', state);
        guard();
        state = acknowledge(prepareVersionIntent({ identity, repoDir, releaseId: d.randomUUID(),
          previousVersion: state.version, version }, acting));
      } else if (state === null) {
        const version = currentVersion();
        defer(version);
        if (f.resumeSource !== null) {
          const imported = await reconcileLegacyFailure({ identity, repoDir, currentVersion: version,
            repairedSourceSha: f.resumeSource }, publicationDeps);
          state = acknowledge(imported.state);
        } else {
          const imported = await reconcileLegacyRelease({ identity, repoDir, currentVersion: version }, publicationDeps);
          if (imported.state === null) return result('pending', imported.error);
          state = acknowledge(imported.state);
        }
      } else {
        defer(state.version);
      }
    }

    if (state.phase === 'version-preparing') {
      if (!f.reconcileOnly) await gates('source-recovery', state);
      state = acknowledge(await reconcileVersionIntent({ identity, repoDir, reconcileOnly: f.reconcileOnly },
        f.reconcileOnly ? { ...acting, run: d.readRun, spawn: d.readSpawn } : acting));
    }
    if (state.phase !== 'complete') need(currentVersion() === state.version,
      'Working package version differs from the pending release');

    if (state.phase === 'failed-ci') {
      if (f.resumeSource === null) {
        if (active(state).identityKind === 'dispatch') {
          const observed = await reconcileWorkflowAttempt({ state, repoDir, allowDispatch: false }, workflowDeps);
          state = acknowledge(observed.state);
          return result(observed.outcome === 'failed-ci' ? 'failed-ci' : 'pending', observed.error);
        }
        const observed = await reobserveFailedRelease({ state, repoDir }, publicationDeps);
        state = acknowledge(observed.state);
        return result('failed-ci', fail('WORKFLOW_CI_FAILED', 'Recorded CI failed; repair requires --resume --resume-source=<full SHA>'));
      }
      const observed = await reobserveFailedRelease({ state, repoDir }, publicationDeps);
      state = acknowledge(observed.state);
      need(f.resumeSource !== state.sourceSha, 'Repair requires a different source');
      need(requireHeadVersion(state.version) === f.resumeSource, 'Repair source must be the selected checkout HEAD');
      remoteMain(f.resumeSource);
      await gates('repair', state, f.resumeSource);
      need(requireHeadVersion(state.version) === f.resumeSource, 'Repair source changed during build gates');
      remoteMain(f.resumeSource);
      const workflowId = await workflowDefinition(active(state).workflowId);
      const attempt = makeWorkflowAttempt({ state, repoDir, workflowId, attemptId: d.randomUUID(),
        sourceSha: f.resumeSource, dispatchRef: 'main' });
      state = event(state, { type: 'begin-repair-attempt', previousRunId: active(state).runId, attempt });
    }

    if (state.phase === 'source-ready') {
      if (f.reconcileOnly) return pending('Source is bound; a new workflow attempt needs an acting resume');
      await gates('dispatch', state, state.sourceSha);
      const refs = await ensureSourceRefs({ state, repoDir, allowTagMutation: state.mode === 'publish' }, refsDeps);
      const workflowId = await workflowDefinition();
      const attempt = makeWorkflowAttempt({ state, repoDir, workflowId, attemptId: d.randomUUID(),
        sourceSha: refs.sourceSha, dispatchRef: refs.dispatchRef });
      state = event(state, { type: 'attempt-ready', attempt });
    }

    let attempt = active(state);
    if (attempt && attempt.dispatch === 'rejected') {
      if (!f.resume || f.reconcileOnly) return result('rejected', attempt.error);
      await gates('dispatch', state, state.sourceSha);
      state = event(state, { type: 'begin-rejected-attempt', previousAttemptId: attempt.id,
        attemptId: d.randomUUID() });
      attempt = active(state);
    }
    if (['workflow', 'unknown'].includes(state.phase) && attempt && attempt.identityKind === 'dispatch') {
      const allowDispatch = attempt.dispatch === 'ready' && !f.reconcileOnly;
      if (allowDispatch) {
        await gates('dispatch', state, state.sourceSha);
        await ensureSourceRefs({ state, repoDir, allowTagMutation: state.mode === 'publish' }, refsDeps);
      }
      const observed = await reconcileWorkflowAttempt({ state, repoDir, allowDispatch }, workflowDeps);
      state = acknowledge(observed.state);
      if (observed.outcome !== 'succeeded') {
        return result(observed.outcome === 'failed-ci' ? 'failed-ci'
          : observed.outcome === 'rejected' ? 'rejected' : 'pending', observed.error);
      }
    }
    if (state.mode === 'dry-run') {
      need(state.phase === 'complete', 'Dry-run did not prove completion');
      return result('dry-run-complete');
    }
    if (state.artifacts.state !== 'complete') {
      const observation = await observePublication({ state, repoDir }, publicationDeps);
      state = acknowledge(persistPublication({ state, repoDir, observation }, publicationDeps));
    } else {
      await verifyCurrentPublication({ state, repoDir }, publicationDeps);
    }
    const tail = await finishReleaseTail({ state, repoDir, retrySite: f.retrySite }, tailDeps);
    state = acknowledge(tail.state);
    if (tail.error || state.phase !== 'complete') return result('pending', tail.error);
    verifyRetainedRelease({ state, repoDir }, readDeps);
    if (state.install.state === 'not-attempted' && typeof d.install === 'function') {
      checkAbort();
      let install;
      try {
        await d.install(state.version);
        install = { state: 'complete', error: null };
      } catch (cause) {
        install = { state: 'failed', error: { code: 'LOCAL_INSTALL_FAILED',
          message: String(cause && cause.message || 'Local installation failed').slice(0, 4096) } };
      }
      state = event(state, { type: 'install-observed', install });
    }
    return result('complete');

    async function choose() {
      need(typeof d.chooseBump === 'function', 'A fresh automatic release needs the CLI version adviser');
      const bump = await d.chooseBump();
      need(['major', 'minor', 'patch'].includes(bump), 'Version adviser returned an invalid bump');
      return bump;
    }
    function defer(version) {
      if (f.version !== null) {
        need(f.version === version || above(f.version, version), 'Requested version is below the pending release');
        if (above(f.version, version)) deferredVersion = f.version;
      } else if (f.bump !== null) deferredVersion = bumpVersion(version, f.bump);
      if (deferredVersion !== null) d.log(`Finishing v${version}; v${deferredVersion} remains deferred until a later invocation`);
    }
  }, { cacheRoot: root, fs: d.fs, now: d.wallNow });
}

module.exports = { runRelease };
