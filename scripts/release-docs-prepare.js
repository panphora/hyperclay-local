'use strict';

// Prepare version-doc updates in isolated snapshots so a later step can apply
// them without mutating either sibling checkout.
//
// Nothing in here writes to a sibling repository: every generator runs against
// a git-archive copy of the recorded HEAD, and prepared.json is written only
// after the live repositories are re-checked byte for byte.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { execFileCaptured } = require('./release-command');
const { detectOldVersion, updateVersionInContent } = require('./update-external-docs');

const SCHEMA = 1;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const DOWNLOAD_REFERENCE_SOURCE = 'HyperclayLocal-(?:Setup-)?(\\d+\\.\\d+\\.\\d+)';
const NODE_MODULES = 'node_modules';

const HYPERCLAY_REPO = 'hyperclay';
const WEBSITE_REPO = 'hyperclay-website';
const HYPERCLAY_EDGE = 'server-pages/hyperclay-local.edge';
const VAULT_DOCS = 'vault/DOCS';
const CONTENT_DOCS = 'content/docs';
const LLMS_TXT = 'public/llms.txt';

const NPM_INSTALL = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--include=dev'];
const WEBSITE_GENERATORS = [['run', 'sync-docs'], ['run', 'build:llms-txt']];

const targetNames = [HYPERCLAY_REPO, WEBSITE_REPO];

function requestedTargets(targets) {
  if (targets === undefined) return targetNames;
  if (!Array.isArray(targets) || !targets.length ||
      targets.some((name) => !targetNames.includes(name)) ||
      new Set(targets).size !== targets.length) {
    throw new Error('targets must be a nonempty unique subset of hyperclay and hyperclay-website');
  }
  return targetNames.filter((name) => targets.includes(name));
}

function defaultRun(command, args, options = {}) {
  return execFileCaptured(command, args, {
    stdio: 'pipe', maxBuffer: 16 * 1024 * 1024,
    echoStdout: false, ...options
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  return sha256(fs.readFileSync(file));
}

function fileMode(stat) {
  return (stat.mode & 0o777).toString(8);
}

function requireVersion(version, label) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must look like 1.2.3, received ${JSON.stringify(version)}`);
  }
}

function isInside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function requireDirectory(dir, label) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch (error) {
    throw new Error(`${label} is missing: ${dir}`);
  }
  if (!fs.statSync(real).isDirectory()) throw new Error(`${label} is not a directory: ${real}`);
  return real;
}

function requireRepoRoot(root, label) {
  let real;
  try {
    real = fs.realpathSync(root);
  } catch (error) {
    throw new Error(`${label} is missing: ${root}`);
  }
  if (!fs.existsSync(path.join(real, '.git'))) {
    throw new Error(`${label} is not a git repository: ${real}`);
  }
  return real;
}

function requireRegularFile(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    throw new Error(`${label} is missing: ${file}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink: ${file}`);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
  return stat;
}

function git(run, cwd, args, options = {}) {
  return run('git', args, { cwd, ...options });
}

function treeFiles(root) {
  const files = [];
  const visit = (relDir) => {
    const dir = relDir ? path.join(root, relDir) : root;
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(root, rel);
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) throw new Error(`snapshot entry is a symlink: ${rel}`);
      if (stat.isDirectory()) {
        if (name !== NODE_MODULES) visit(rel);
        continue;
      }
      if (!stat.isFile()) throw new Error(`snapshot entry is not a regular file: ${rel}`);
      files.push({ path: rel, abs, mode: fileMode(stat) });
    }
  };
  visit('');
  return files;
}

function treeManifest(root) {
  const manifest = new Map();
  for (const entry of treeFiles(root)) {
    manifest.set(entry.path, { sha256: hashFile(entry.abs), mode: entry.mode });
  }
  return manifest;
}

function manifestDiff(base, next) {
  const changes = [];
  for (const [rel, entry] of base) {
    const found = next.get(rel);
    if (!found) changes.push({ path: rel, status: 'deleted' });
    else if (found.mode !== entry.mode) changes.push({ path: rel, status: 'mode' });
    else if (found.sha256 !== entry.sha256) changes.push({ path: rel, status: 'modified' });
  }
  for (const rel of next.keys()) {
    if (!base.has(rel)) changes.push({ path: rel, status: 'added' });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function describeChanges(changes) {
  return changes.map((change) => `${change.status} ${change.path}`).join(', ');
}

function downloadVersions(content) {
  const pattern = new RegExp(DOWNLOAD_REFERENCE_SOURCE, 'g');
  const versions = new Set();
  let match;
  while ((match = pattern.exec(content)) !== null) versions.add(match[1]);
  return versions;
}

// Same rules as hyperclay-website scripts/sync-docs.js cleanFileName.
function cleanFileName(filename) {
  return filename
    .replace(/^\d+\s+/, '')
    .replace(/\.md$/, '')
    .replace(/\s+-\s+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .toLowerCase();
}

function prepareVersion(content, version) {
  requireVersion(version, 'prepareVersion version');
  const oldVersion = detectOldVersion(content);
  if (!oldVersion) {
    throw new Error('prepareVersion found no HyperclayLocal download version in the content');
  }
  const versions = downloadVersions(content);
  if (versions.size > 1) {
    throw new Error(`prepareVersion refuses mixed HyperclayLocal versions: ${[...versions].sort().join(', ')}`);
  }
  if (oldVersion === version) {
    return { oldVersion, updated: content, proseChanges: [] };
  }
  const { updated, proseChanges } = updateVersionInContent(content, oldVersion, version);
  return { oldVersion, updated, proseChanges };
}

function snapshotRepo(run, repo, repoRoot, runRoot) {
  const branch = git(run, repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') {
    throw new Error(`${repo} is on branch ${branch}; main is required`);
  }
  const staged = git(run, repoRoot, ['diff', '--cached', '--name-only', '-z']);
  if (staged.length > 0) {
    const names = staged.split('\0').filter(Boolean).join(', ');
    throw new Error(`${repo} has staged changes: ${names}`);
  }
  const beforeHead = git(run, repoRoot, ['rev-parse', 'HEAD']).trim();
  const indexFingerprint = sha256(git(run, repoRoot, ['ls-files', '--stage', '-z']));

  const repoDir = path.join(runRoot, repo);
  const sourceDir = path.join(repoDir, 'source');
  const beforeDir = path.join(repoDir, 'before');
  const archive = path.join(repoDir, 'source.tar');
  fs.mkdirSync(repoDir, { mode: 0o700 });
  fs.mkdirSync(sourceDir, { mode: 0o700 });
  fs.mkdirSync(beforeDir, { mode: 0o700 });

  git(run, repoRoot, ['archive', '--format=tar', `--output=${archive}`, beforeHead], { stdio: 'inherit' });
  run('tar', ['-xf', archive, '-C', sourceDir], { cwd: repoRoot, stdio: 'inherit' });
  run('tar', ['-xf', archive, '-C', beforeDir], { cwd: repoRoot, stdio: 'inherit' });

  const manifest = treeManifest(sourceDir);

  return {
    repo,
    repoRoot,
    repoDir,
    sourceDir,
    beforeDir,
    beforeHead,
    indexFingerprint,
    manifest,
    allowed: [],
    liveState: null,
    prepared: null,
    paths: []
  };
}

function selectTargets(hyperclay, website) {
  if (hyperclay) {
    hyperclay.allowed = [HYPERCLAY_EDGE];
    hyperclay.sourcePath = HYPERCLAY_EDGE;
    requireRegularFile(path.join(hyperclay.beforeDir, HYPERCLAY_EDGE), 'hyperclay target');
  }
  if (!website) return;

  const vaultDir = path.join(website.beforeDir, VAULT_DOCS);
  const names = fs.existsSync(vaultDir)
    ? fs.readdirSync(vaultDir).filter((name) => name.endsWith('.md') && /hyperclay local/i.test(name))
    : [];
  const candidates = names.filter((name) => {
    const file = path.join(vaultDir, name);
    if (!fs.lstatSync(file).isFile()) return false;
    return detectOldVersion(fs.readFileSync(file, 'utf8')) !== null;
  });
  if (candidates.length !== 1) {
    throw new Error(
      `${WEBSITE_REPO} needs exactly one ${VAULT_DOCS} doc for Hyperclay Local with a download version, found ${candidates.length}: ${candidates.join(', ')}`
    );
  }

  website.sourcePath = `${VAULT_DOCS}/${candidates[0]}`;
  const mdxPath = `${CONTENT_DOCS}/${cleanFileName(candidates[0])}.mdx`;
  website.allowed = [website.sourcePath, mdxPath, LLMS_TXT];
  requireRegularFile(path.join(website.beforeDir, mdxPath), 'generated doc target');
  requireRegularFile(path.join(website.beforeDir, LLMS_TXT), 'llms.txt target');
}

function readLiveState(run, snapshot) {
  const branch = git(run, snapshot.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') {
    throw new Error(`${snapshot.repo} is on branch ${branch}; main is required`);
  }
  const head = git(run, snapshot.repoRoot, ['rev-parse', 'HEAD']).trim();
  const indexFingerprint = sha256(git(run, snapshot.repoRoot, ['ls-files', '--stage', '-z']));
  const status = git(run, snapshot.repoRoot, ['status', '--porcelain=v1', '-z', '--', ...snapshot.allowed]);
  if (status.length > 0) {
    const names = status.split('\0').filter(Boolean).join(', ');
    throw new Error(`${snapshot.repo} has pending changes for ${snapshot.allowed.join(', ')}: ${names}`);
  }
  const preimages = new Map();
  for (const rel of snapshot.allowed) {
    const abs = path.join(snapshot.repoRoot, rel);
    const stat = requireRegularFile(abs, `live target ${rel}`);
    preimages.set(rel, { sha256: hashFile(abs), mode: fileMode(stat) });
  }
  return { branch, head, indexFingerprint, preimages };
}

function requireLiveMatchesSnapshot(snapshot, live) {
  if (live.head !== snapshot.beforeHead) {
    throw new Error(`${snapshot.repo} HEAD moved from ${snapshot.beforeHead} to ${live.head} during snapshot capture`);
  }
  if (live.indexFingerprint !== snapshot.indexFingerprint) {
    throw new Error(`${snapshot.repo} index changed during snapshot capture`);
  }
  for (const [rel, preimage] of live.preimages) {
    const recorded = snapshot.manifest.get(rel);
    if (!recorded) {
      throw new Error(`${snapshot.repo} ${rel} is not part of the recorded HEAD snapshot`);
    }
    if (recorded.sha256 !== preimage.sha256 || recorded.mode !== preimage.mode) {
      throw new Error(`${snapshot.repo} ${rel} on disk does not match the recorded HEAD snapshot`);
    }
  }
}

function requireLiveUnchanged(snapshot, before, after) {
  if (after.head !== before.head) {
    throw new Error(`${snapshot.repo} HEAD moved from ${before.head} to ${after.head} during preparation`);
  }
  if (after.indexFingerprint !== before.indexFingerprint) {
    throw new Error(`${snapshot.repo} index changed during preparation`);
  }
  for (const [rel, preimage] of before.preimages) {
    const now = after.preimages.get(rel);
    if (!now || now.sha256 !== preimage.sha256 || now.mode !== preimage.mode) {
      throw new Error(`${snapshot.repo} ${rel} changed on disk during preparation`);
    }
  }
}

function runWebsiteGenerators(run, website) {
  for (const args of WEBSITE_GENERATORS) {
    run('npm', args, { cwd: website.sourceDir, stdio: 'inherit' });
  }
}

function copyCandidate(snapshot) {
  const afterDir = path.join(snapshot.repoDir, 'after');
  fs.mkdirSync(afterDir, { mode: 0o700 });
  const finalManifest = treeManifest(snapshot.sourceDir);
  snapshot.paths = snapshot.allowed.map((rel) => {
    const before = snapshot.manifest.get(rel);
    const after = finalManifest.get(rel);
    const beforeFile = path.join(snapshot.beforeDir, rel);
    const afterFile = path.join(afterDir, rel);
    fs.mkdirSync(path.dirname(afterFile), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(snapshot.sourceDir, rel), afterFile);
    return {
      path: rel,
      beforeSha256: before.sha256,
      afterSha256: after.sha256,
      mode: after.mode,
      beforeFile,
      afterFile,
      changed: before.sha256 !== after.sha256 || before.mode !== after.mode
    };
  });
}

function prepareExternalDocs({ version, parentDir, runDir, targets }, { run = defaultRun } = {}) {
  requireVersion(version, 'version');
  if (typeof parentDir !== 'string' || typeof runDir !== 'string') {
    throw new Error('parentDir and runDir are required');
  }
  const selected = requestedTargets(targets);

  const parentRoot = requireDirectory(parentDir, 'parentDir');
  const roots = selected.map((repo) => [
    repo,
    requireRepoRoot(path.join(parentRoot, repo), `${repo} repo`)
  ]);

  const requestedRunDir = path.resolve(runDir);
  if (fs.existsSync(requestedRunDir)) {
    throw new Error(`run dir already exists: ${requestedRunDir}`);
  }
  let runParent;
  try {
    runParent = fs.realpathSync(path.dirname(requestedRunDir));
  } catch (error) {
    throw new Error(`run dir parent is missing: ${path.dirname(requestedRunDir)}`);
  }
  const runRoot = path.join(runParent, path.basename(requestedRunDir));
  for (const [label, root] of [...roots.map(([repo, repoRoot]) => [`${repo} repo`, repoRoot]), ['parentDir', parentRoot]]) {
    if (isInside(runRoot, root)) {
      throw new Error(`run dir ${runRoot} must live outside ${label} ${root}`);
    }
  }
  fs.mkdirSync(runRoot, { mode: 0o700 });

  const snapshots = roots.map(([repo, repoRoot]) => snapshotRepo(run, repo, repoRoot, runRoot));
  const hyperclay = snapshots.find((snapshot) => snapshot.repo === HYPERCLAY_REPO);
  const website = snapshots.find((snapshot) => snapshot.repo === WEBSITE_REPO);
  selectTargets(hyperclay, website);

  for (const snapshot of snapshots) {
    const live = readLiveState(run, snapshot);
    requireLiveMatchesSnapshot(snapshot, live);
    snapshot.liveState = live;
  }

  if (website) {
    run('npm', NPM_INSTALL, { cwd: website.sourceDir, stdio: 'inherit' });
    const installed = treeManifest(website.sourceDir);
    const installChanges = manifestDiff(website.manifest, installed);
    if (installChanges.length > 0) {
      throw new Error(`npm ci modified the ${WEBSITE_REPO} snapshot: ${describeChanges(installChanges)}`);
    }

    runWebsiteGenerators(run, website);
  }
  for (const snapshot of snapshots) snapshot.baselineManifest = treeManifest(snapshot.sourceDir);
  if (website) {
    const baselineChanges = manifestDiff(website.manifest, website.baselineManifest);
    if (baselineChanges.length > 0) {
      throw new Error(`generator baseline mismatch in ${WEBSITE_REPO}: ${describeChanges(baselineChanges)}`);
    }
  }

  for (const snapshot of snapshots) {
    const beforeContent = fs.readFileSync(path.join(snapshot.beforeDir, snapshot.sourcePath), 'utf8');
    snapshot.prepared = prepareVersion(beforeContent, version);
    if (snapshot.prepared.updated !== beforeContent) {
      fs.writeFileSync(path.join(snapshot.sourceDir, snapshot.sourcePath), snapshot.prepared.updated);
    }
  }

  if (website) runWebsiteGenerators(run, website);

  for (const snapshot of snapshots) {
    const finalManifest = treeManifest(snapshot.sourceDir);
    const changes = manifestDiff(snapshot.baselineManifest, finalManifest);
    const allowed = new Set(snapshot.allowed);
    for (const change of changes) {
      if (change.status !== 'modified') {
        throw new Error(`${snapshot.repo} ${change.status} ${change.path} is not permitted`);
      }
      if (!allowed.has(change.path)) {
        throw new Error(`${snapshot.repo} changed ${change.path}, which is outside the release targets`);
      }
    }
    for (const rel of snapshot.allowed) {
      const content = fs.readFileSync(path.join(snapshot.sourceDir, rel), 'utf8');
      const versions = [...downloadVersions(content)].sort();
      if (versions.length === 0) continue;
      if (versions.length > 1 || versions[0] !== version) {
        throw new Error(`${snapshot.repo} ${rel} references ${versions.join(', ')} instead of ${version}`);
      }
    }
    copyCandidate(snapshot);
  }

  for (const snapshot of snapshots) {
    requireLiveUnchanged(snapshot, snapshot.liveState, readLiveState(run, snapshot));
  }

  const prepared = {
    schema: SCHEMA,
    version,
    runDir: runRoot,
    targets: snapshots.map((snapshot) => ({
      repo: snapshot.repo,
      repoRoot: snapshot.repoRoot,
      beforeHead: snapshot.beforeHead,
      indexFingerprint: snapshot.indexFingerprint,
      sourcePath: snapshot.sourcePath,
      oldVersion: snapshot.prepared.oldVersion,
      paths: snapshot.paths,
      state: 'prepared'
    }))
  };

  const preparedFile = path.join(runRoot, 'prepared.json');
  const staging = `${preparedFile}.staging`;
  fs.writeFileSync(staging, `${JSON.stringify(prepared, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(staging, preparedFile);
  return prepared;
}

module.exports = { prepareExternalDocs, prepareVersion };
