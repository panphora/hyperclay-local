'use strict';

// Turn one accepted prepared documentation target into a verified patch and an
// immutable expected Git tree. The private index lives in a fresh out dir, so
// the shared index, working tree, HEAD and branch are never touched.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { execFileCaptured, writeOutput } = require('./release-command');
const { readBoundedOrdinaryFile } = require('./release-local-read');
const { detectOldVersion } = require('./update-external-docs');
const { prepareVersion, readSizeManifest } = require('./release-docs-prepare');

const SCHEMA = 1;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MODE_PATTERN = /^[0-7]{3,4}$/;
const GIT_MODE_PATTERN = /^[0-7]{6}$/;
const PERMISSION_BITS = 0o777;
const EXECUTABLE_BIT = 0o100;
const SPECIAL_BITS = 0o7000;
const PATCH_BUFFER_BYTES = 16 * 1024 * 1024;
const EVIDENCE_JSON_BYTES = 8 * 1024 * 1024;
const VERIFY_FORBIDDEN_COMMANDS = ['write-tree', 'read-tree', 'apply', 'update-index', 'hash-object'];

const PREPARED_FILE = 'prepared.json';
const STAGING_FILE = 'prepared.json.staging';
const APPLICATION_FILE = 'application.json';
const PATCH_FILE = 'candidate.patch';
const PRIVATE_INDEX_FILE = 'index';

const HYPERCLAY_REPO = 'hyperclay';
const WEBSITE_REPO = 'hyperclay-website';
const DESKTOP_REPO = 'hyperclay-local';
const REPO_NAMES = [HYPERCLAY_REPO, WEBSITE_REPO, DESKTOP_REPO];
const HYPERCLAY_EDGE = 'server-pages/hyperclay-local.edge';
const VAULT_DOCS = 'vault/DOCS';
const CONTENT_DOCS = 'content/docs';
const LLMS_TXT = 'public/llms.txt';
const SIZE_PATHS = ['README.md', 'website/index.html'];

const APPLICATION_FIELDS = [
  'schema', 'version', 'repo', 'repoRoot', 'preparedFile', 'preparedSha256', 'beforeHead',
  'beforeIndexFingerprint', 'sourcePath', 'paths', 'requiredPaths', 'files', 'patchFile',
  'patchSha256', 'expectedTree', 'expectedIndexFingerprint', 'privateIndexFile'
];
const FILE_FIELDS = [
  'path', 'beforeSha256', 'afterSha256', 'mode', 'beforeFile', 'afterFile', 'changed'
];

function docsInvalid(message, cause) {
  const error = Object.assign(new Error(message), { code: 'DOCS_APPLICATION_INVALID' });
  if (cause !== undefined && cause !== null) {
    error.cause = cause;
    error.status = cause.status;
    error.signal = cause.signal;
    error.stdout = cause.stdout;
    error.stderr = cause.stderr;
  }
  return error;
}

function preimageConflict(message) {
  return Object.assign(new Error(message), { code: 'DOCS_PREIMAGE_CONFLICT' });
}

function commandFailure(label, cause) {
  const error = new Error(`${label} failed`);
  error.status = cause === undefined ? undefined : cause.status;
  error.signal = cause === undefined ? undefined : cause.signal;
  error.stdout = cause === undefined ? undefined : cause.stdout;
  error.stderr = cause === undefined ? undefined : cause.stderr;
  error.cause = cause;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  return sha256(readBoundedOrdinaryFile(file, { maxBytes: PATCH_BUFFER_BYTES }));
}

function fileMode(stat) {
  return (stat.mode & PERMISSION_BITS).toString(8);
}

function requireOrdinaryMode(stat, label) {
  if ((stat.mode & SPECIAL_BITS) !== 0) {
    throw new Error(`${label} must not carry special bits: ${(stat.mode & 0o7777).toString(8)}`);
  }
}

function isInside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function requireVersion(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`version must look like 1.2.3, received ${JSON.stringify(version)}`);
  }
}

function realDirectory(dir, label) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    throw new Error(`${label} is missing: ${dir}`);
  }
  if (!fs.statSync(real).isDirectory()) throw new Error(`${label} is not a directory: ${real}`);
  return real;
}

function requireRegularLeaf(file, label) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    throw new Error(`${label} is missing: ${file}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink: ${file}`);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
  return stat;
}

function requirePlainParents(root, target, label) {
  const relative = path.relative(root, path.dirname(target));
  if (relative === '') return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes ${root}`);
  }
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw new Error(`${label} parent is missing: ${current}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} parent is a symlink: ${current}`);
    if (!stat.isDirectory()) throw new Error(`${label} parent is not a directory: ${current}`);
  }
}

function requireRelativePath(rel, label) {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error(`${label} must be a nonempty string`);
  }
  if (rel.includes('\0')) throw new Error(`${label} must not contain NUL`);
  if (rel.startsWith('/') || path.isAbsolute(rel)) throw new Error(`${label} must be relative: ${rel}`);
  for (const part of rel.split('/')) {
    if (part === '' || part === '.' || part === '..') {
      throw new Error(`${label} has an invalid component: ${rel}`);
    }
  }
  return rel;
}

function requireModeString(mode, label) {
  if (typeof mode !== 'string' || !MODE_PATTERN.test(mode)) {
    throw new Error(`${label} must be an octal permission string, received ${JSON.stringify(mode)}`);
  }
  if (parseInt(mode, 8) > PERMISSION_BITS) throw new Error(`${label} must not carry special bits: ${mode}`);
}

function observeEnv() {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
}

function indexEnv(indexFile) {
  return { ...process.env, GIT_INDEX_FILE: indexFile, GIT_OPTIONAL_LOCKS: '0' };
}

function git(run, cwd, env, args, options = {}) {
  try {
    return run('git', args, { cwd, env, echoStdout: false, ...options });
  } catch (error) {
    if (error && error.code === 'DOCS_APPLICATION_INVALID') throw error;
    throw commandFailure(`git ${args.join(' ')}`, error);
  }
}

function indexFingerprint(run, cwd, env) {
  return sha256(git(run, cwd, env, ['ls-files', '--stage', '-z']));
}

function blobBytes(run, cwd, env, oid) {
  return git(run, cwd, env, ['cat-file', 'blob', oid], { encoding: null });
}

function treeEntry(run, cwd, env, treeish, relPath) {
  const output = git(run, cwd, env, ['ls-tree', '-z', treeish, '--', relPath]);
  const entries = output.split('\0').filter((line) => line.length > 0);
  if (entries.length !== 1) throw new Error(`${relPath} must exist exactly once in ${treeish}`);
  const tab = entries[0].indexOf('\t');
  if (tab < 0 || entries[0].slice(tab + 1) !== relPath) {
    throw new Error(`${treeish} entry for ${relPath} is malformed`);
  }
  const [mode, type, oid] = entries[0].slice(0, tab).split(' ');
  return { mode, type, oid };
}

function gitModeForPermission(permission) {
  return (parseInt(permission, 8) & EXECUTABLE_BIT) === 0 ? '100644' : '100755';
}

function requireGitRegularMode(gitMode, permission, label) {
  if (gitMode !== '100644' && gitMode !== '100755') {
    throw new Error(`${label} must be a regular Git file, found mode ${gitMode}`);
  }
  if (gitMode !== gitModeForPermission(permission)) {
    throw new Error(`${label} mode ${permission} does not match Git mode ${gitMode}`);
  }
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

function readDescriptor(preparedFile) {
  if (typeof preparedFile !== 'string' || !path.isAbsolute(preparedFile)) {
    throw new Error('preparedFile must be an absolute path');
  }
  const directory = path.dirname(preparedFile);
  const runDir = realDirectory(directory, 'prepared run dir');
  if (directory !== runDir || path.basename(preparedFile) !== PREPARED_FILE) {
    throw new Error(`preparedFile must be exactly ${path.join(runDir, PREPARED_FILE)}`);
  }
  const staging = path.join(runDir, STAGING_FILE);
  if (fs.existsSync(staging)) throw new Error(`prepared run dir holds an unpublished staging file: ${staging}`);
  requireRegularLeaf(preparedFile, 'preparedFile');
  const bytes = readBoundedOrdinaryFile(preparedFile, { maxBytes: EVIDENCE_JSON_BYTES });
  let prepared;
  try {
    prepared = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('preparedFile is not valid JSON');
  }
  if (prepared === null || typeof prepared !== 'object' || Array.isArray(prepared)) {
    throw new Error('preparedFile must hold a prepared record object');
  }
  if (prepared.runDir !== runDir) {
    throw new Error(`prepared runDir ${JSON.stringify(prepared.runDir)} does not match ${runDir}`);
  }
  return { preparedFile, runDir, sha256: sha256(bytes), prepared };
}

function selectTarget(prepared, repo, version) {
  if (prepared.schema !== SCHEMA) throw new Error(`prepared schema must be ${SCHEMA}`);
  if (prepared.version !== version) {
    throw new Error(`prepared version ${JSON.stringify(prepared.version)} does not match ${version}`);
  }
  if (!Array.isArray(prepared.targets) || prepared.targets.length === 0) {
    throw new Error('prepared targets must be a nonempty array');
  }
  if (!REPO_NAMES.includes(repo)) {
    throw new Error(`repo must be hyperclay or hyperclay-website or hyperclay-local, received ${JSON.stringify(repo)}`);
  }
  const names = prepared.targets.map((target) => target && target.repo);
  for (const name of names) {
    if (!REPO_NAMES.includes(name)) {
      throw new Error(`prepared target ${JSON.stringify(name)} is not a supported repo`);
    }
  }
  if (new Set(names).size !== names.length) throw new Error('prepared targets must be unique');
  if (names.includes(DESKTOP_REPO) && (names.length !== 1 || repo !== DESKTOP_REPO)) {
    throw new Error('a desktop size descriptor must contain only the hyperclay-local target');
  }
  const matches = prepared.targets.filter((target) => target.repo === repo);
  if (matches.length !== 1) throw new Error(`prepared targets must hold exactly one ${repo} target`);
  const target = matches[0];
  if (target.state !== 'prepared') throw new Error(`${repo} prepared target state must be prepared`);
  return target;
}

function readPreparedTarget(preparedFile, { repo, version }) {
  const descriptor = readDescriptor(preparedFile);
  const target = selectTarget(descriptor.prepared, repo, version);
  return { ...descriptor, target };
}

function requireRepoRoot(target, repo, parentRoot, run) {
  if (typeof target.repoRoot !== 'string') throw new Error(`${repo} repoRoot must be a string`);
  const expected = path.join(parentRoot, repo);
  if (target.repoRoot !== expected) throw new Error(`${repo} repoRoot must be ${expected}`);
  const root = realDirectory(expected, `${repo} repoRoot`);
  if (root !== expected) throw new Error(`${repo} repoRoot must be canonical: ${expected}`);
  const top = git(run, root, observeEnv(), ['rev-parse', '--show-toplevel']).trim();
  if (fs.realpathSync(top) !== expected) throw new Error(`${repo} repoRoot is not the Git checkout root`);
  const head = git(run, root, observeEnv(), ['symbolic-ref', '-q', 'HEAD']).trim();
  if (head !== 'refs/heads/main') throw new Error(`${repo} HEAD must be on refs/heads/main`);
  return root;
}

function requireBeforeHead(target, repo, run, repoRoot) {
  if (typeof target.beforeHead !== 'string' || !OID_PATTERN.test(target.beforeHead)) {
    throw new Error(`${repo} beforeHead must be a full object id`);
  }
  const resolved = git(run, repoRoot, observeEnv(), ['rev-parse', '--verify', `${target.beforeHead}^{commit}`]).trim();
  if (resolved !== target.beforeHead) throw new Error(`${repo} beforeHead must be an existing commit`);
}

function requireEntries(target, repo) {
  if (!Array.isArray(target.paths) || target.paths.length === 0) {
    throw new Error(`${repo} prepared paths must be a nonempty array`);
  }
  const entries = target.paths.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${repo} prepared path entry must be an object`);
    }
    requireRelativePath(entry.path, `${repo} path`);
    return entry;
  });
  const names = entries.map((entry) => entry.path);
  if (new Set(names).size !== names.length) throw new Error(`${repo} prepared paths must be unique`);
  for (const outer of names) {
    for (const inner of names) {
      if (outer !== inner && inner.startsWith(`${outer}/`)) {
        throw new Error(`${repo} path ${inner} is nested under ${outer}`);
      }
    }
  }
  return entries;
}

function websiteSourceName(sourcePath) {
  const parts = sourcePath.split('/');
  if (parts.length !== 3 || parts[0] !== 'vault' || parts[1] !== 'DOCS') {
    throw new Error(`${WEBSITE_REPO} sourcePath must be a direct ${VAULT_DOCS} document: ${sourcePath}`);
  }
  const name = parts[2];
  if (!name.endsWith('.md') || !/hyperclay local/i.test(name)) {
    throw new Error(`${WEBSITE_REPO} sourcePath must be a Hyperclay Local markdown document: ${sourcePath}`);
  }
  return name;
}

function vaultCandidates(run, repoRoot, beforeHead, env) {
  const listing = git(run, repoRoot, env, ['ls-tree', '-z', beforeHead, '--', `${VAULT_DOCS}/`]);
  const candidates = [];
  for (const line of listing.split('\0')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    const name = line.slice(tab + 1);
    if (type !== 'blob') continue;
    if (mode !== '100644' && mode !== '100755') continue;
    const base = name.slice(name.lastIndexOf('/') + 1);
    if (!base.endsWith('.md') || !/hyperclay local/i.test(base)) continue;
    if (detectOldVersion(blobBytes(run, repoRoot, env, oid).toString('utf8')) !== null) candidates.push(name);
  }
  return candidates;
}

function expectedPathSet(target, repo, run, repoRoot) {
  if (typeof target.sourcePath !== 'string') throw new Error(`${repo} sourcePath must be a string`);
  requireRelativePath(target.sourcePath, `${repo} sourcePath`);
  if (repo === HYPERCLAY_REPO) {
    if (target.sourcePath !== HYPERCLAY_EDGE) {
      throw new Error(`${HYPERCLAY_REPO} sourcePath must be ${HYPERCLAY_EDGE}`);
    }
    return { required: [HYPERCLAY_EDGE] };
  }
  if (repo === DESKTOP_REPO) {
    if (target.sourcePath !== 'README.md') throw new Error('hyperclay-local sourcePath must be README.md');
    return { required: [...SIZE_PATHS] };
  }
  const name = websiteSourceName(target.sourcePath);
  const candidates = vaultCandidates(run, repoRoot, target.beforeHead, observeEnv());
  if (candidates.length !== 1 || candidates[0] !== target.sourcePath) {
    throw new Error(
      `${WEBSITE_REPO} needs exactly one ${VAULT_DOCS} doc for Hyperclay Local, found ${candidates.length}: ${candidates.join(', ')}`
    );
  }
  return {
    required: [target.sourcePath, `${CONTENT_DOCS}/${cleanFileName(name)}.mdx`, LLMS_TXT]
  };
}

function requirePathSet(entries, required, repo) {
  const actual = entries.map((entry) => entry.path).slice().sort();
  const wanted = required.slice().sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new Error(
      `${repo} prepared paths ${actual.join(', ')} do not match the release targets ${wanted.join(', ')}`
    );
  }
}

function requireSnapshotEntry(entry, repo, runDir, run, repoRoot, beforeHead) {
  const parts = entry.path.split('/');
  const beforeFile = path.join(runDir, repo, 'before', ...parts);
  const afterFile = path.join(runDir, repo, 'after', ...parts);
  if (entry.beforeFile !== beforeFile) throw new Error(`${repo} ${entry.path} beforeFile must be ${beforeFile}`);
  if (entry.afterFile !== afterFile) throw new Error(`${repo} ${entry.path} afterFile must be ${afterFile}`);
  requirePlainParents(runDir, beforeFile, `${repo} ${entry.path} beforeFile`);
  requirePlainParents(runDir, afterFile, `${repo} ${entry.path} afterFile`);
  const beforeStat = requireRegularLeaf(beforeFile, `${repo} ${entry.path} beforeFile`);
  const afterStat = requireRegularLeaf(afterFile, `${repo} ${entry.path} afterFile`);
  requireOrdinaryMode(beforeStat, `${repo} ${entry.path} beforeFile`);
  requireOrdinaryMode(afterStat, `${repo} ${entry.path} afterFile`);
  requireModeString(entry.mode, `${repo} ${entry.path} mode`);
  if (fileMode(beforeStat) !== entry.mode) {
    throw new Error(`${repo} ${entry.path} beforeFile mode ${fileMode(beforeStat)} does not match ${entry.mode}`);
  }
  if (fileMode(afterStat) !== entry.mode) {
    throw new Error(`${repo} ${entry.path} afterFile mode ${fileMode(afterStat)} does not match ${entry.mode}`);
  }
  const beforeBytes = readBoundedOrdinaryFile(beforeFile, { maxBytes: PATCH_BUFFER_BYTES });
  const afterBytes = readBoundedOrdinaryFile(afterFile, { maxBytes: PATCH_BUFFER_BYTES });
  const beforeHash = sha256(beforeBytes);
  const afterHash = sha256(afterBytes);
  if (beforeHash !== entry.beforeSha256) {
    throw new Error(`${repo} ${entry.path} beforeFile does not match beforeSha256`);
  }
  if (afterHash !== entry.afterSha256) {
    throw new Error(`${repo} ${entry.path} afterFile does not match afterSha256`);
  }
  if (entry.changed !== (beforeHash !== afterHash)) {
    throw new Error(`${repo} ${entry.path} changed flag does not match the snapshot hashes`);
  }
  const env = observeEnv();
  const tree = treeEntry(run, repoRoot, env, beforeHead, entry.path);
  if (tree.type !== 'blob') throw new Error(`${repo} ${entry.path} must be a Git blob at ${beforeHead}`);
  requireGitRegularMode(tree.mode, entry.mode, `${repo} ${entry.path}`);
  if (sha256(blobBytes(run, repoRoot, env, tree.oid)) !== entry.beforeSha256) {
    throw new Error(`${repo} ${entry.path} beforeFile does not match the Git blob at ${beforeHead}`);
  }
  return { entry, beforeBytes, afterBytes };
}

function requireSourceAfter(entries, snapshots, target, version) {
  if (typeof target.oldVersion !== 'string' || !VERSION_PATTERN.test(target.oldVersion)) {
    throw new Error(`${target.repo} oldVersion must look like 1.2.3`);
  }
  if (target.repo === DESKTOP_REPO) {
    if (target.oldVersion !== version) throw new Error('desktop size updates must preserve the version');
    const manifest = readSizeManifest(target.publication, { version });
    const byPath = new Map(snapshots.map((snapshot) => [snapshot.entry.path, snapshot]));
    const readme = byPath.get('README.md');
    const website = byPath.get('website/index.html');
    const { renderDownloadSizes } = require('./write-download-sizes');
    const output = renderDownloadSizes({
      readme: readme.beforeBytes.toString('utf8'),
      website: website.beforeBytes.toString('utf8'),
      manifest,
    }, { version, sourceSha: target.publication.sourceSha });
    if (!readme.afterBytes.equals(Buffer.from(output.readme, 'utf8'))
      || !website.afterBytes.equals(Buffer.from(output.website, 'utf8'))) {
      throw new Error('desktop size after bytes do not match renderDownloadSizes');
    }
    return;
  }
  const index = entries.findIndex((entry) => entry.path === target.sourcePath);
  if (index < 0) throw new Error(`${target.repo} sourcePath ${target.sourcePath} is not a release target`);
  const snapshot = snapshots[index];
  const prepared = prepareVersion(snapshot.beforeBytes.toString('utf8'), version);
  if (prepared.oldVersion !== target.oldVersion) {
    throw new Error(`${target.repo} oldVersion ${target.oldVersion} does not match ${prepared.oldVersion}`);
  }
  if (!snapshot.afterBytes.equals(Buffer.from(prepared.updated, 'utf8'))) {
    throw new Error(`${target.repo} ${target.sourcePath} after bytes do not match prepareVersion`);
  }
}

function readLiveState(run, repoRoot, env, entries) {
  const branch = git(run, repoRoot, env, ['symbolic-ref', '-q', 'HEAD']).trim();
  const head = git(run, repoRoot, env, ['rev-parse', 'HEAD']).trim();
  const fingerprint = indexFingerprint(run, repoRoot, env);
  const staged = git(run, repoRoot, env, ['diff', '--cached', '--name-only', '-z']);
  const names = entries.map((entry) => entry.path);
  const pending = git(run, repoRoot, env, ['status', '--porcelain=v1', '-z', '--', ...names]);
  const preimages = new Map();
  for (const entry of entries) {
    const abs = path.join(repoRoot, ...entry.path.split('/'));
    const stat = requireRegularLeaf(abs, `live target ${entry.path}`);
    requireOrdinaryMode(stat, `live target ${entry.path}`);
    preimages.set(entry.path, { sha256: hashFile(abs), mode: fileMode(stat) });
  }
  return { branch, head, fingerprint, staged, pending, preimages };
}

function requireLiveMatches(live, target, entries, repo, label) {
  const branch = live.branch.length > 0 ? live.branch : 'a detached HEAD';
  if (live.branch !== 'refs/heads/main') throw preimageConflict(`${repo} is on ${branch} at ${label}`);
  if (live.head !== target.beforeHead) {
    throw preimageConflict(`${repo} HEAD moved from ${target.beforeHead} to ${live.head} at ${label}`);
  }
  if (live.fingerprint !== target.indexFingerprint) throw preimageConflict(`${repo} index changed at ${label}`);
  if (live.staged.length > 0) {
    throw preimageConflict(`${repo} has staged changes at ${label}: ${live.staged.split('\0').filter(Boolean).join(', ')}`);
  }
  if (live.pending.length > 0) {
    throw preimageConflict(
      `${repo} has pending changes for the release targets at ${label}: ${live.pending.split('\0').filter(Boolean).join(', ')}`
    );
  }
  for (const entry of entries) {
    const now = live.preimages.get(entry.path);
    if (!now || now.sha256 !== entry.beforeSha256 || now.mode !== entry.mode) {
      throw preimageConflict(`${repo} ${entry.path} changed on disk at ${label}`);
    }
  }
}

function createOutDir(outDir, parentRoot, repoRoot, runDir) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('outDir is required');
  const requested = path.resolve(outDir);
  if (fs.existsSync(requested)) throw new Error(`outDir already exists: ${requested}`);
  const realParent = realDirectory(path.dirname(requested), 'outDir parent');
  const root = path.join(realParent, path.basename(requested));
  for (const [label, guard] of [
    ['parentDir', parentRoot],
    [`${HYPERCLAY_REPO} repo`, repoRoot],
    ['prepared run dir', runDir]
  ]) {
    if (isInside(root, guard)) throw new Error(`outDir ${root} must live outside ${label} ${guard}`);
  }
  fs.mkdirSync(root, { mode: 0o700 });
  return root;
}

function buildPatch(spawn, runDir, repo, entries, { echoStderr = true } = {}) {
  const cwd = path.join(runDir, repo);
  const parts = [];
  for (const entry of entries) {
    const result = spawn('git', [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv',
      '--', `before/${entry.path}`, `after/${entry.path}`
    ], { cwd, encoding: null, maxBuffer: PATCH_BUFFER_BYTES, shell: false });
    if (echoStderr) writeOutput(2, result.stderr);
    if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
      const error = new Error(`git diff --no-index failed for ${repo} ${entry.path}`);
      error.status = result.status;
      error.signal = result.signal;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      if (result.error) {
        error.code = result.error.code;
        error.cause = result.error;
        error.message = `${error.message}: ${result.error.message}`;
      }
      throw error;
    }
    const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
    if (entry.changed) {
      if (result.status !== 1 || bytes.length === 0) {
        throw new Error(`${repo} ${entry.path} is recorded as changed but produced no patch bytes`);
      }
      parts.push(bytes);
    } else if (result.status !== 0 || bytes.length !== 0) {
      throw new Error(`${repo} ${entry.path} is recorded as unchanged but produced patch bytes`);
    }
  }
  return Buffer.concat(parts);
}

function requireSnapshotUnchanged(entry, repo) {
  const beforeStat = requireRegularLeaf(entry.beforeFile, `${repo} ${entry.path} beforeFile`);
  const afterStat = requireRegularLeaf(entry.afterFile, `${repo} ${entry.path} afterFile`);
  requireOrdinaryMode(beforeStat, `${repo} ${entry.path} beforeFile`);
  requireOrdinaryMode(afterStat, `${repo} ${entry.path} afterFile`);
  if (fileMode(beforeStat) !== entry.mode || fileMode(afterStat) !== entry.mode) {
    throw new Error(`${repo} ${entry.path} snapshot mode changed while the plan was being built`);
  }
  if (hashFile(entry.beforeFile) !== entry.beforeSha256) {
    throw new Error(`${repo} ${entry.path} beforeFile changed while the plan was being built`);
  }
  if (hashFile(entry.afterFile) !== entry.afterSha256) {
    throw new Error(`${repo} ${entry.path} afterFile changed while the plan was being built`);
  }
}

function fsyncDirectory(dir) {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function publishApplication(outRoot, record) {
  const target = path.join(outRoot, APPLICATION_FILE);
  const temporary = path.join(outRoot, `${crypto.randomUUID()}.tmp`);
  const payload = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  let fd = null;
  let owned = false;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    owned = true;
    fs.writeFileSync(fd, payload);
    if (fs.fstatSync(fd).size !== payload.length) {
      throw new Error('application.json was written incompletely');
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, target);
    owned = false;
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        fd = null;
      }
    }
    if (owned) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // Only a temporary file this call created may be cleaned up.
      }
    }
    throw error;
  }
  fsyncDirectory(outRoot);
  return target;
}

function prepareDocsApplication(input, { run = execFileCaptured, spawn = spawnSync } = {}) {
  const { preparedFile, repo, parentDir, version, outDir } = input || {};
  requireVersion(version);

  const descriptor = readPreparedTarget(preparedFile, { repo, version });
  const target = descriptor.target;
  const parentRoot = realDirectory(parentDir, 'parentDir');
  const repoRoot = requireRepoRoot(target, repo, parentRoot, run);
  requireBeforeHead(target, repo, run, repoRoot);

  const entries = requireEntries(target, repo);
  const expected = expectedPathSet(target, repo, run, repoRoot);
  requirePathSet(entries, expected.required, repo);

  const snapshots = entries.map((entry) =>
    requireSnapshotEntry(entry, repo, descriptor.runDir, run, repoRoot, target.beforeHead));
  requireSourceAfter(entries, snapshots, target, version);

  const observe = observeEnv();
  requireLiveMatches(readLiveState(run, repoRoot, observe, entries), target, entries, repo, 'entry');

  const outRoot = createOutDir(outDir, parentRoot, repoRoot, descriptor.runDir);
  const privateIndexFile = path.join(outRoot, PRIVATE_INDEX_FILE);
  const privateEnv = indexEnv(privateIndexFile);
  git(run, repoRoot, privateEnv, ['read-tree', target.beforeHead]);
  if (indexFingerprint(run, repoRoot, privateEnv) !== target.indexFingerprint) {
    throw new Error(`${repo} index does not match the recorded stage0 fingerprint at ${target.beforeHead}`);
  }

  const patchBytes = buildPatch(spawn, descriptor.runDir, repo, entries);
  const patchFile = path.join(outRoot, PATCH_FILE);
  fs.writeFileSync(patchFile, patchBytes, { mode: 0o600, flag: 'wx' });

  const changed = entries.filter((entry) => entry.changed);
  const changedNames = changed.map((entry) => entry.path);
  if (changed.length > 0) {
    git(run, repoRoot, privateEnv, ['apply', '--cached', '-p1', patchFile]);
  }

  const expectedTree = git(run, repoRoot, privateEnv, ['write-tree']).trim();
  const expectedIndexFingerprint = indexFingerprint(run, repoRoot, privateEnv);
  const beforeTree = git(run, repoRoot, observe, ['rev-parse', `${target.beforeHead}^{tree}`]).trim();
  if (changed.length === 0) {
    if (expectedTree !== beforeTree) throw new Error(`${repo} an empty change set must yield the recorded tree`);
    if (expectedIndexFingerprint !== target.indexFingerprint) {
      throw new Error(`${repo} an empty change set must leave the private index unchanged`);
    }
  }

  const diffNames = git(run, repoRoot, privateEnv, ['diff', '--name-only', '-z', target.beforeHead, expectedTree])
    .split('\0').filter(Boolean).sort();
  const wantedNames = changedNames.slice().sort();
  if (diffNames.length !== wantedNames.length || diffNames.some((name, index) => name !== wantedNames[index])) {
    throw new Error(
      `${repo} expected tree diff ${diffNames.join(', ')} does not match the changed set ${wantedNames.join(', ')}`
    );
  }

  for (const entry of changed) {
    const tree = treeEntry(run, repoRoot, privateEnv, expectedTree, entry.path);
    if (tree.type !== 'blob') throw new Error(`${repo} ${entry.path} must be a blob in ${expectedTree}`);
    requireGitRegularMode(tree.mode, entry.mode, `${repo} ${entry.path}`);
    if (sha256(blobBytes(run, repoRoot, privateEnv, tree.oid)) !== entry.afterSha256) {
      throw new Error(`${repo} ${entry.path} expected tree blob does not match afterSha256`);
    }
  }
  for (const entry of entries.filter((candidate) => !candidate.changed)) {
    const before = treeEntry(run, repoRoot, observe, target.beforeHead, entry.path);
    const after = treeEntry(run, repoRoot, privateEnv, expectedTree, entry.path);
    if (before.oid !== after.oid || before.mode !== after.mode) {
      throw new Error(`${repo} ${entry.path} must keep its recorded blob in ${expectedTree}`);
    }
  }

  const record = {
    schema: SCHEMA,
    version,
    repo,
    repoRoot,
    preparedFile: descriptor.preparedFile,
    preparedSha256: descriptor.sha256,
    beforeHead: target.beforeHead,
    beforeIndexFingerprint: target.indexFingerprint,
    sourcePath: target.sourcePath,
    paths: changedNames,
    requiredPaths: entries.map((entry) => entry.path),
    files: entries.map((entry) => ({
      path: entry.path,
      beforeSha256: entry.beforeSha256,
      afterSha256: entry.afterSha256,
      mode: entry.mode,
      beforeFile: entry.beforeFile,
      afterFile: entry.afterFile,
      changed: entry.changed
    })),
    patchFile,
    patchSha256: sha256(patchBytes),
    expectedTree,
    expectedIndexFingerprint,
    privateIndexFile
  };

  if (hashFile(descriptor.preparedFile) !== descriptor.sha256) {
    throw new Error(`${descriptor.preparedFile} changed while the plan was being built`);
  }
  for (const entry of entries) requireSnapshotUnchanged(entry, repo);
  requireLiveMatches(readLiveState(run, repoRoot, observe, entries), target, entries, repo, 'publication');

  const applicationFile = publishApplication(outRoot, record);
  return { ...record, applicationFile };
}

function readApplication(applicationFile) {
  if (typeof applicationFile !== 'string' || applicationFile.length === 0) {
    throw docsInvalid('applicationFile is required');
  }
  if (!path.isAbsolute(applicationFile)) throw docsInvalid('applicationFile must be an absolute path');
  const resolved = applicationFile;
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw docsInvalid(`application file is missing: ${resolved}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw docsInvalid(`application file must be a regular file: ${resolved}`);
  }
  let bytes;
  try {
    bytes = readBoundedOrdinaryFile(resolved, { maxBytes: EVIDENCE_JSON_BYTES });
  } catch {
    throw docsInvalid(`application file could not be read: ${resolved}`);
  }
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw docsInvalid('application file is not valid JSON');
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw docsInvalid('application record must be an object');
  }
  const keys = Object.keys(record).slice().sort();
  const wanted = APPLICATION_FIELDS.slice().sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw docsInvalid('application record fields do not match schema 1');
  }
  return { applicationFile: resolved, record };
}

function requireApplicationShape(record) {
  if (record.schema !== SCHEMA) throw docsInvalid('application schema must be 1');
  if (typeof record.version !== 'string' || !VERSION_PATTERN.test(record.version)) {
    throw docsInvalid('application version must look like 1.2.3');
  }
  if (!REPO_NAMES.includes(record.repo)) {
    throw docsInvalid('application repo must be hyperclay or hyperclay-website');
  }
  if (typeof record.repoRoot !== 'string' || !path.isAbsolute(record.repoRoot)) {
    throw docsInvalid('application repoRoot must be absolute');
  }
  if (typeof record.preparedFile !== 'string' || !path.isAbsolute(record.preparedFile)) {
    throw docsInvalid('application preparedFile must be absolute');
  }
  if (typeof record.preparedSha256 !== 'string' || !HASH_PATTERN.test(record.preparedSha256)) {
    throw docsInvalid('application preparedSha256 must be a sha256 hex digest');
  }
  if (typeof record.beforeHead !== 'string' || !OID_PATTERN.test(record.beforeHead)) {
    throw docsInvalid('application beforeHead must be a full object id');
  }
  if (typeof record.beforeIndexFingerprint !== 'string' || !HASH_PATTERN.test(record.beforeIndexFingerprint)) {
    throw docsInvalid('application beforeIndexFingerprint must be a sha256 hex digest');
  }
  if (typeof record.patchFile !== 'string' || !path.isAbsolute(record.patchFile)) {
    throw docsInvalid('application patchFile must be absolute');
  }
  if (typeof record.patchSha256 !== 'string' || !HASH_PATTERN.test(record.patchSha256)) {
    throw docsInvalid('application patchSha256 must be a sha256 hex digest');
  }
  if (typeof record.expectedTree !== 'string' || !OID_PATTERN.test(record.expectedTree)) {
    throw docsInvalid('application expectedTree must be a full object id');
  }
  if (typeof record.expectedIndexFingerprint !== 'string' || !HASH_PATTERN.test(record.expectedIndexFingerprint)) {
    throw docsInvalid('application expectedIndexFingerprint must be a sha256 hex digest');
  }
  if (typeof record.privateIndexFile !== 'string' || !path.isAbsolute(record.privateIndexFile)) {
    throw docsInvalid('application privateIndexFile must be absolute');
  }
  requireRelativePath(record.sourcePath, 'application sourcePath');
  if (!Array.isArray(record.paths)) throw docsInvalid('application paths must be an array');
  for (const name of record.paths) requireRelativePath(name, 'application path');
  if (!Array.isArray(record.requiredPaths)) throw docsInvalid('application requiredPaths must be an array');
  for (const name of record.requiredPaths) requireRelativePath(name, 'application required path');
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw docsInvalid('application files must be a nonempty array');
  }
  for (const file of record.files) {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) {
      throw docsInvalid('application file record must be an object');
    }
    const keys = Object.keys(file).slice().sort();
    const wanted = FILE_FIELDS.slice().sort();
    if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
      throw docsInvalid('application file record fields do not match schema 1');
    }
    requireRelativePath(file.path, 'application file path');
    if (typeof file.beforeSha256 !== 'string' || !HASH_PATTERN.test(file.beforeSha256)) {
      throw docsInvalid(`application ${file.path} beforeSha256 must be a sha256 hex digest`);
    }
    if (typeof file.afterSha256 !== 'string' || !HASH_PATTERN.test(file.afterSha256)) {
      throw docsInvalid(`application ${file.path} afterSha256 must be a sha256 hex digest`);
    }
    requireModeString(file.mode, `application ${file.path} mode`);
    if (typeof file.beforeFile !== 'string' || !path.isAbsolute(file.beforeFile)) {
      throw docsInvalid(`application ${file.path} beforeFile must be absolute`);
    }
    if (typeof file.afterFile !== 'string' || !path.isAbsolute(file.afterFile)) {
      throw docsInvalid(`application ${file.path} afterFile must be absolute`);
    }
    if (typeof file.changed !== 'boolean') throw docsInvalid(`application ${file.path} changed must be a boolean`);
  }
}

function requireApplicationMatch(record, descriptor, target, entries) {
  if (descriptor.sha256 !== record.preparedSha256) {
    throw docsInvalid('prepared file does not match preparedSha256');
  }
  if (target.repoRoot !== record.repoRoot) throw docsInvalid('prepared repoRoot does not match the application');
  if (target.beforeHead !== record.beforeHead) throw docsInvalid('prepared beforeHead does not match the application');
  if (target.indexFingerprint !== record.beforeIndexFingerprint) {
    throw docsInvalid('prepared index fingerprint does not match the application');
  }
  if (target.sourcePath !== record.sourcePath) {
    throw docsInvalid('prepared sourcePath does not match the application');
  }
  const preparedNames = entries.map((entry) => entry.path);
  const recordedNames = record.files.map((file) => file.path);
  if (preparedNames.length !== recordedNames.length ||
      preparedNames.some((name, index) => name !== recordedNames[index])) {
    throw docsInvalid('application files do not match the prepared target paths');
  }
  for (const file of record.files) {
    const entry = entries.find((candidate) => candidate.path === file.path);
    for (const field of ['beforeSha256', 'afterSha256', 'mode', 'beforeFile', 'afterFile', 'changed']) {
      if (entry[field] !== file[field]) {
        throw docsInvalid(`application ${file.path} ${field} does not match the prepared target`);
      }
    }
  }
  if (record.requiredPaths.length !== recordedNames.length ||
      record.requiredPaths.some((name, index) => name !== recordedNames[index])) {
    throw docsInvalid('application requiredPaths do not match application files');
  }
  const changedNames = record.files.filter((file) => file.changed).map((file) => file.path);
  if (record.paths.length !== changedNames.length ||
      record.paths.some((name, index) => name !== changedNames[index])) {
    throw docsInvalid('application paths do not match the changed files');
  }
}

function requireOwnedOutRoot(applicationFile, record, repoRoot, runDir) {
  if (path.basename(applicationFile) !== APPLICATION_FILE) {
    throw docsInvalid(`applicationFile must be exactly <outDir>/${APPLICATION_FILE}`);
  }
  const outRoot = path.dirname(applicationFile);
  let real;
  try {
    real = fs.realpathSync(outRoot);
  } catch {
    throw docsInvalid(`application out dir is missing: ${outRoot}`);
  }
  if (real !== outRoot || !fs.statSync(real).isDirectory()) {
    throw docsInvalid(`application out dir must be a canonical directory: ${outRoot}`);
  }
  for (const [label, guard] of [
    ['parentDir', path.dirname(repoRoot)],
    [`${record.repo} repo`, repoRoot],
    ['prepared run dir', runDir]
  ]) {
    if (isInside(outRoot, guard)) {
      throw docsInvalid(`application out dir ${outRoot} must live outside ${label} ${guard}`);
    }
  }
  if (record.patchFile !== path.join(outRoot, PATCH_FILE)) {
    throw docsInvalid(`application patchFile must be exactly ${path.join(outRoot, PATCH_FILE)}`);
  }
  if (record.privateIndexFile !== path.join(outRoot, PRIVATE_INDEX_FILE)) {
    throw docsInvalid(`application privateIndexFile must be exactly ${path.join(outRoot, PRIVATE_INDEX_FILE)}`);
  }
  requirePlainParents(outRoot, record.patchFile, 'application patch file');
  requirePlainParents(outRoot, record.privateIndexFile, 'application private index');
  requireRegularLeaf(record.patchFile, 'application patch file');
  requireRegularLeaf(record.privateIndexFile, 'application private index');
}

function readStageZero(listing) {
  const entries = new Map();
  for (const line of listing.split('\0')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw docsInvalid('private index listing is malformed');
    const [mode, oid, stage] = line.slice(0, tab).split(' ');
    const name = line.slice(tab + 1);
    if (!GIT_MODE_PATTERN.test(mode) || !OID_PATTERN.test(oid) || stage !== '0') {
      throw docsInvalid(`private index entry is not a stage0 file: ${name}`);
    }
    if (entries.has(name)) throw docsInvalid(`private index lists ${name} more than once`);
    entries.set(name, { mode, oid });
  }
  if (entries.size === 0) throw docsInvalid('private index must not be empty');
  return entries;
}

function readExpectedTree(listing) {
  const entries = new Map();
  for (const line of listing.split('\0')) {
    if (line.length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw docsInvalid('expected tree listing is malformed');
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    const name = line.slice(tab + 1);
    if (!GIT_MODE_PATTERN.test(mode) || !OID_PATTERN.test(oid)) {
      throw docsInvalid(`expected tree entry is malformed: ${name}`);
    }
    if (entries.has(name)) throw docsInvalid(`expected tree lists ${name} more than once`);
    entries.set(name, { mode, type, oid });
  }
  if (entries.size === 0) throw docsInvalid('expected tree must not be empty');
  return entries;
}

function requireIndexMatchesTree(indexEntries, treeEntries) {
  if (indexEntries.size !== treeEntries.size) {
    throw docsInvalid('private index and expectedTree hold different inventories');
  }
  for (const [name, entry] of indexEntries) {
    const other = treeEntries.get(name);
    if (!other || other.mode !== entry.mode || other.oid !== entry.oid) {
      throw docsInvalid(`private index entry ${name} does not match expectedTree`);
    }
  }
}

function guardVerifyCommands(commandRunner) {
  return (command, args, options) => {
    if (command === 'git' && Array.isArray(args) && VERIFY_FORBIDDEN_COMMANDS.includes(args[0])) {
      throw docsInvalid(`verifyDocsApplication must not run git ${args[0]}`);
    }
    return commandRunner(command, args, options);
  };
}

function verifyDocsApplication(applicationFile, { run = execFileCaptured, spawn = spawnSync } = {}) {
  const { applicationFile: resolved, record } = readApplication(applicationFile);
  const gitRun = guardVerifyCommands(run);
  const patchRun = guardVerifyCommands(spawn);
  try {
    requireApplicationShape(record);
    const descriptor = readPreparedTarget(record.preparedFile, { repo: record.repo, version: record.version });
    const target = descriptor.target;
    const repoRoot = realDirectory(record.repoRoot, 'application repoRoot');
    const observe = observeEnv();
    const top = git(gitRun, repoRoot, observe, ['rev-parse', '--show-toplevel']).trim();
    if (fs.realpathSync(top) !== repoRoot) throw docsInvalid('application repoRoot is not the Git checkout root');
    requireBeforeHead(target, record.repo, gitRun, repoRoot);

    const entries = requireEntries(target, record.repo);
    const expected = expectedPathSet(target, record.repo, gitRun, repoRoot);
    requirePathSet(entries, expected.required, record.repo);
    const snapshots = entries.map((entry) =>
      requireSnapshotEntry(entry, record.repo, descriptor.runDir, gitRun, repoRoot, target.beforeHead));
    requireSourceAfter(entries, snapshots, target, record.version);
    requireApplicationMatch(record, descriptor, target, entries);
    requireOwnedOutRoot(resolved, record, repoRoot, descriptor.runDir);

    const recordedPatch = readBoundedOrdinaryFile(record.patchFile, { maxBytes: PATCH_BUFFER_BYTES });
    if (!buildPatch(patchRun, descriptor.runDir, record.repo, entries, { echoStderr: false }).equals(recordedPatch)) {
      throw docsInvalid('patch file does not match the regenerated patch');
    }
    if (sha256(recordedPatch) !== record.patchSha256) {
      throw docsInvalid('patch file does not match patchSha256');
    }

    let expectedTree = null;
    try {
      expectedTree = git(gitRun, repoRoot, observe, ['rev-parse', '--verify', `${record.expectedTree}^{tree}`]).trim();
    } catch {
      expectedTree = null;
    }
    if (expectedTree !== record.expectedTree) throw docsInvalid('application expectedTree is not an existing tree');

    const privateEnv = indexEnv(record.privateIndexFile);
    const indexListing = git(gitRun, repoRoot, privateEnv, ['ls-files', '--stage', '-z']);
    if (sha256(indexListing) !== record.expectedIndexFingerprint) {
      throw docsInvalid('private index fingerprint does not match expectedIndexFingerprint');
    }
    const treeListing = git(gitRun, repoRoot, privateEnv, ['ls-tree', '-r', '--full-tree', '-z', record.expectedTree]);
    requireIndexMatchesTree(readStageZero(indexListing), readExpectedTree(treeListing));

    const diffNames = git(gitRun, repoRoot, privateEnv, ['diff', '--name-only', '-z', record.beforeHead, record.expectedTree])
      .split('\0').filter(Boolean).sort();
    const wantedNames = record.paths.slice().sort();
    if (diffNames.length !== wantedNames.length || diffNames.some((name, index) => name !== wantedNames[index])) {
      throw docsInvalid('expected tree diff does not match the recorded changed paths');
    }
    for (const file of record.files.filter((entry) => entry.changed)) {
      const tree = treeEntry(gitRun, repoRoot, privateEnv, record.expectedTree, file.path);
      if (tree.type !== 'blob') throw docsInvalid(`application ${file.path} must be a blob in expectedTree`);
      requireGitRegularMode(tree.mode, file.mode, `application ${file.path}`);
      if (sha256(blobBytes(gitRun, repoRoot, privateEnv, tree.oid)) !== file.afterSha256) {
        throw docsInvalid(`application ${file.path} expected tree blob does not match afterSha256`);
      }
    }
    return { ...record, applicationFile: resolved };
  } catch (error) {
    if (error && error.code === 'DOCS_APPLICATION_INVALID') throw error;
    throw docsInvalid(error && error.message ? String(error.message) : String(error), error);
  }
}

module.exports = { prepareDocsApplication, readPreparedTarget, verifyDocsApplication };
