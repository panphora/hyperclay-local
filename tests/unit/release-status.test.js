'use strict';

const fs = require('fs');
const path = require('path');

const { readStatus } = require('../../scripts/release-status');
const { readPublicationEvidence } = require('../../scripts/release-publication');
const { readSizeEvidence } = require('../../scripts/release-size-evidence');
const { readSiteEvidence } = require('../../scripts/release-site-evidence');
const { readCompletedTargetEvidence } = require('../../scripts/release-target-evidence');
const { testPosix } = require('../helpers/platform');
const {
  VERSION, RELEASE_ID, ATTEMPT_ID, DOC_REPOS, ORIGIN,
  sha256, createBundle, completeBundle, siteDeps
} = require('../helpers/release-status-fixture');

jest.setTimeout(900000);

const STAGES = ['artifacts', 'sizes', 'site', 'docs.hyperclay', 'docs.hyperclay-website'];
const NEXT_VERSION = '1.30.0';

function siteDescriptorFile(bundle) {
  return path.join(bundle.repoDir, 'records', RELEASE_ID, 'site', ATTEMPT_ID, 'site.json');
}

function attempt(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

function verifiedObservations(state, repoDir, deps) {
  const observations = new Map();
  const artifacts = attempt(() => readPublicationEvidence({ state, repoDir }, deps));
  if (artifacts !== null) observations.set('artifacts', artifacts.verifiedAt);
  const sizes = attempt(() => readSizeEvidence({ state, repoDir }, deps));
  if (sizes !== null) observations.set('sizes', sizes.verifiedAt);
  const site = attempt(() => readSiteEvidence({ state, repoDir }, deps));
  if (site !== null) observations.set('site', site.verifiedAt);
  for (const repo of DOC_REPOS) {
    const docs = attempt(() => readCompletedTargetEvidence({
      journalFile: state.docs[repo].journalFile,
      evidenceRoot: path.join(repoDir, 'records', state.releaseId),
      repo,
      version: state.version,
      commit: state.docs[repo].commit
    }, deps));
    if (docs !== null) observations.set(`docs.${repo}`, docs.verifiedAt);
  }
  return observations;
}

function latestStamp(stamps) {
  let latest = null;
  for (const stamp of stamps) {
    if (latest === null || Date.parse(stamp) > Date.parse(latest)) latest = stamp;
  }
  return latest;
}

function isCanonicalTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function snapshotFiles(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full, { bigint: true });
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) entries.push([full, sha256(fs.readFileSync(full)), String(stat.mtimeNs)]);
    }
  };
  walk(root);
  return entries;
}

describe('desktop status retained evidence', () => {
  let bundle = null;
  let completedState = null;

  beforeAll(async () => {
    if (process.platform === 'win32') return;
    bundle = createBundle();
    completedState = (await completeBundle(bundle)).complete;
  }, 600000);

  afterAll(() => {
    if (bundle !== null) fs.rmSync(bundle.owner, { recursive: true, force: true });
  });

  testPosix('certifies the retained complete bundle from its real records', () => {
    const deps = siteDeps(bundle);
    const observations = verifiedObservations(completedState, bundle.repoDir, deps);
    const expectedMax = latestStamp(observations.values());
    const status = readStatus({ repoRoot: bundle.desktopRoot, cacheRoot: bundle.cacheRoot });

    expect([...observations.keys()]).toEqual(STAGES);
    expect(expectedMax).not.toBeNull();
    expect(isCanonicalTimestamp(expectedMax)).toBe(true);

    expect(fs.statSync(completedState.artifacts.manifestFile).size).toBeGreaterThan(0);
    expect(fs.statSync(siteDescriptorFile(bundle)).size).toBeGreaterThan(0);
    for (const repo of DOC_REPOS) {
      expect(fs.statSync(completedState.docs[repo].journalFile).size).toBeGreaterThan(0);
    }

    expect(status.readError).toBeNull();
    expect(status.schema).toBe(1);
    expect(status.repoKey).toBe(bundle.identity.key);
    expect(status.currentVersion).toBe(VERSION);
    expect(status.dryRun).toBeNull();
    expect(status.siteReceipt).toEqual({ sha: completedState.sizes.commit, matchesHead: true });
    expect(status.publish).toEqual({
      releaseId: RELEASE_ID,
      version: VERSION,
      sourceSha: bundle.sourceSha,
      phase: 'complete',
      action: 'new-release-or-current',
      pending: false,
      needsSigning: false,
      pendingStages: [],
      lastVerifiedAt: expectedMax,
      remoteVerification: 'not-performed',
      reason: null
    });
    expect(isCanonicalTimestamp(status.publish.lastVerifiedAt)).toBe(true);
  });

  testPosix('reports unknown and blocked-conflict for each corrupted evidence domain', () => {
    const deps = siteDeps(bundle);
    const files = {
      artifacts: completedState.artifacts.manifestFile,
      sizes: completedState.sizes.journalFile,
      site: siteDescriptorFile(bundle),
      'docs.hyperclay': completedState.docs.hyperclay.journalFile,
      'docs.hyperclay-website': completedState.docs['hyperclay-website'].journalFile
    };
    const completeStamps = verifiedObservations(completedState, bundle.repoDir, deps);
    expect([...completeStamps.keys()]).toEqual(STAGES);

    let corruptions = 0;
    for (const stage of STAGES) {
      const file = files[stage];
      const bytes = fs.readFileSync(file);
      try {
        fs.writeFileSync(file, Buffer.from('{invalid-json'));
        const status = readStatus({ repoRoot: bundle.desktopRoot, cacheRoot: bundle.cacheRoot });
        const valid = verifiedObservations(completedState, bundle.repoDir, deps);
        const expectedPending = STAGES.filter((name) => !valid.has(name));
        const expectedMax = latestStamp(valid.values());

        expect(status.readError).toBeNull();
        expect(status.publish.phase).toBe('unknown');
        expect(status.publish.action).toBe('blocked-conflict');
        expect(status.publish.pending).toBe(true);
        expect(status.publish.pendingStages).toContain(stage);
        expect(status.publish.pendingStages.length).toBeGreaterThan(0);
        expect(valid.has(stage)).toBe(false);
        expect(status.publish.pendingStages).toEqual(expectedPending);
        expect(status.publish.pendingStages).toEqual(
          STAGES.filter((name) => status.publish.pendingStages.includes(name))
        );
        expect(status.publish.lastVerifiedAt).toBe(expectedMax);
        expect(status.publish.lastVerifiedAt).not.toBe(completeStamps.get(stage));
        expect(status.publish.reason).toBe(`Retained evidence requires attention: ${expectedPending[0]}`);
        expect(status.publish.sourceSha).toBe(bundle.sourceSha);
        expect(status.publish.needsSigning).toBeNull();
        expect(status.currentVersion).toBe(VERSION);
        corruptions += 1;
      } finally {
        fs.writeFileSync(file, bytes);
      }
    }
    expect(corruptions).toBe(STAGES.length);
  });

  testPosix('keeps historical completion when the checkout, version, receipt and sibling remotes move on', () => {
    bundle.write(bundle.desktopRoot, 'UNRELATED.md', 'unrelated desktop work\n');
    bundle.git(bundle.desktopRoot, ['add', 'UNRELATED.md']);
    bundle.git(bundle.desktopRoot, ['commit', '-q', '-m', 'unrelated desktop change']);
    const advancedHead = bundle.git(bundle.desktopRoot, ['rev-parse', 'HEAD']).trim();
    expect(advancedHead).not.toBe(bundle.sourceSha);

    bundle.write(bundle.desktopRoot, 'package.json', `${JSON.stringify({
      name: 'hyperclay-local-electron', version: NEXT_VERSION, private: true
    }, null, 2)}\n`);
    const receiptFile = path.join(bundle.desktopRoot, '.deploy');
    expect(fs.existsSync(receiptFile)).toBe(true);
    fs.rmSync(receiptFile, { force: true });

    const siblingRoots = {
      hyperclay: bundle.hyperclayRoot,
      'hyperclay-website': bundle.websiteRoot
    };
    const altRemotes = new Map();
    for (const repo of DOC_REPOS) {
      const bare = path.join(bundle.remoteDir, `alternate-${repo}.git`);
      bundle.git(bundle.remoteDir, ['init', '-q', '--bare', '-b', 'main', bare]);
      altRemotes.set(repo, bare);
      bundle.git(siblingRoots[repo], ['remote', 'set-url', 'origin', bare]);
      bundle.git(siblingRoots[repo], ['remote', 'set-url', '--push', 'origin', bare]);
      bundle.write(siblingRoots[repo], 'UNRELATED.md', `unrelated ${repo} work\n`);
      bundle.git(siblingRoots[repo], ['add', 'UNRELATED.md']);
      bundle.git(siblingRoots[repo], ['commit', '-q', '-m', 'unrelated sibling change']);
      bundle.git(siblingRoots[repo], ['push', '-q', 'origin', 'main']);
    }
    expect(bundle.git(bundle.desktopRoot, ['remote', 'get-url', 'origin']).trim()).toBe(ORIGIN);
    for (const repo of DOC_REPOS) {
      expect(bundle.git(siblingRoots[repo], ['remote', 'get-url', 'origin']).trim()).toBe(altRemotes.get(repo));
    }

    const before = snapshotFiles(bundle.owner);
    const status = readStatus({ repoRoot: bundle.desktopRoot, cacheRoot: bundle.cacheRoot });
    const after = snapshotFiles(bundle.owner);
    const historical = verifiedObservations(completedState, bundle.repoDir, siteDeps(bundle));

    expect(status.readError).toBeNull();
    expect(status.currentVersion).toBe(NEXT_VERSION);
    expect(status.siteReceipt).toBeNull();
    expect(status.publish.releaseId).toBe(RELEASE_ID);
    expect(status.publish.version).toBe(VERSION);
    expect(status.publish.phase).toBe('complete');
    expect(status.publish.action).toBe('new-release-or-current');
    expect(status.publish.pending).toBe(false);
    expect(status.publish.needsSigning).toBe(false);
    expect(status.publish.pendingStages).toEqual([]);
    expect(status.publish.sourceSha).toBe(bundle.sourceSha);
    expect(status.publish.remoteVerification).toBe('not-performed');
    expect([...historical.keys()]).toEqual(STAGES);
    expect(status.publish.lastVerifiedAt).toBe(latestStamp(historical.values()));
    expect(isCanonicalTimestamp(status.publish.lastVerifiedAt)).toBe(true);
    expect(after).toEqual(before);
  });
});
