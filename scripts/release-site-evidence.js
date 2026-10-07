'use strict';

// Read-only site evidence. One shared immutable inventory check serves the
// producer, the historical verifier and the acting reconciler: the recorded size
// commit names a website subtree, that subtree is read as immutable Git objects,
// and a retained snapshot directory must still hold exactly those bytes and modes.

const fs = require('fs');
const path = require('path');

const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { observeObjectStore } = require('./release-target-evidence');
const { validateReleaseState } = require('./release-state');

const localReader = createLocalGitReader();

const FAILURE_CODE = 'SITE_EVIDENCE_INVALID';
const OBJECT_STORE_FIELDS = ['root', 'commonDir', 'key', 'objectFormat'];
const DESCRIPTOR_SCHEMA = 1;
const DESCRIPTOR_FILE = 'site.json';
const SNAPSHOT_NAME = 'snapshot';
const RECORDS_DIR = 'records';
const SITE_DIR = 'site';
const WEBSITE_DIR = 'website';
const PHASES = ['prepared', 'requested', 'unknown', 'complete'];
const DESCRIPTOR_KEYS = [
  'schema', 'releaseId', 'version', 'attemptId', 'sourceSha', 'treeSha', 'snapshotDir',
  'phase', 'requestedAt', 'completedAt', 'receiptSha', 'receiptBeforeSha256'
];
const TREE_MODES = { '100644': 0o644, '100755': 0o755 };
const TREE_TYPES = ['blob', 'tree', 'commit'];
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const TREE_MODE_PATTERN = /^[0-7]{6}$/;
const COMPATIBILITY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_COMPONENTS = ['.git', '.wrangler', '.env', '.dev.vars'];
const FORBIDDEN_PREFIXES = ['.env.', '.dev.vars.'];
const REQUIRED_FILES = ['index.html', 'wrangler.jsonc', '.assetsignore'];
const CONFIG_KEYS = ['name', 'compatibility_date', 'assets', 'routes'];
const WORKER_NAME = 'hyperclaylocal';
const ASSET_ROUTES = ['hyperclaylocal.com', 'www.hyperclaylocal.com'];
const IGNORE_EXCLUSIONS = ['.DS_Store', '.assetsignore', 'wrangler.jsonc', '.wrangler'];
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 4096;
const DESCRIPTOR_MAX_BYTES = 64 * 1024;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const EXECUTABLE_BITS = 0o111;

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function siteInvalid(message, cause) {
  const error = new Error(message);
  error.code = FAILURE_CODE;
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function isSiteFailure(value) {
  return Boolean(value) && typeof value === 'object' && value.code === FAILURE_CODE;
}

function siteFailure(message, cause) {
  if (isSiteFailure(cause)) return cause;
  return siteInvalid(message, cause);
}

function requireExactKeys(value, keys, label) {
  if (!isPlainRecord(value) || Object.keys(value).length !== keys.length) {
    throw siteInvalid(`${label} must carry exactly the supported fields`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw siteInvalid(`${label} is missing ${key}`);
  }
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function requireRepoRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || CONTROL_PATTERN.test(value) ||
      path.normalize(value) !== value || value.endsWith(path.sep) || path.dirname(value) === value) {
    throw siteInvalid('Site evidence needs an absolute repository root');
  }
  return value;
}

function requireOid(value, label) {
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) throw siteInvalid(`${label} is not a Git object identifier`);
  return value;
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '' || CONTROL_PATTERN.test(value)) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function isForbiddenComponent(part) {
  if (FORBIDDEN_COMPONENTS.includes(part)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => part.startsWith(prefix));
}

function requireSitePath(value) {
  if (!isSafeRelativePath(value)) throw siteInvalid(`The recorded site tree holds an unsafe path: ${value}`);
  if (value.split('/').some(isForbiddenComponent)) {
    throw siteInvalid(`The recorded site tree holds a forbidden path: ${value}`);
  }
  return value;
}

function resolveRun(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw siteInvalid('Site evidence dependencies must be a plain object');
  if (provided.run === undefined || provided.run === null) return localReader.run;
  if (typeof provided.run !== 'function') throw siteInvalid('Site evidence needs a local Git runner');
  return provided.run;
}

function resolveIo(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw siteInvalid('Site evidence dependencies must be a plain object');
  if (provided.fs === undefined || provided.fs === null) return fs;
  if (typeof provided.fs !== 'object' || Array.isArray(provided.fs)) {
    throw siteInvalid('Site evidence needs a filesystem object');
  }
  return provided.fs;
}

function runGit(run, repoRoot, args, options = {}) {
  const encoding = options.encoding === undefined ? 'utf8' : options.encoding;
  const maxBuffer = options.maxBuffer === undefined ? MAX_METADATA_BYTES : options.maxBuffer;
  try {
    return run('git', args, { cwd: repoRoot, encoding, maxBuffer });
  } catch (error) {
    throw siteInvalid(`Site evidence Git read failed: git ${args.join(' ')}`, error);
  }
}

function decodeMetadata(record, label) {
  const text = record.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(record)) throw siteInvalid(`${label} entry name is not valid UTF-8`);
  return text;
}

function parseTreeEntry(record, label) {
  const text = decodeMetadata(record, label);
  const tab = text.indexOf('\t');
  if (tab < 0) throw siteInvalid(`${label} entry has no path separator`);
  const header = text.slice(0, tab).split(' ');
  if (header.length !== 3) throw siteInvalid(`${label} entry header is malformed`);
  const mode = header[0];
  const type = header[1];
  const oid = header[2];
  if (!TREE_MODE_PATTERN.test(mode)) throw siteInvalid(`${label} entry mode is malformed`);
  if (!TREE_TYPES.includes(type)) throw siteInvalid(`${label} entry type is malformed`);
  if (!OID_PATTERN.test(oid)) throw siteInvalid(`${label} entry object is malformed`);
  const entryPath = text.slice(tab + 1);
  if (CONTROL_PATTERN.test(entryPath)) throw siteInvalid(`${label} entry name holds a control character`);
  if (entryPath === '') throw siteInvalid(`${label} entry has an empty path`);
  return { mode, type, oid, path: entryPath };
}

function parseTreeListing(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw siteInvalid(`${label} did not return binary output`);
  const records = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    records.push(bytes.subarray(start, index));
    start = index + 1;
  }
  if (start !== bytes.length) throw siteInvalid(`${label} is not NUL terminated`);
  return records.map((record) => parseTreeEntry(record, label));
}

function validateSiteConfiguration(bytes) {
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw siteInvalid('The committed site configuration is not valid JSON', error);
  }
  if (!isPlainRecord(config) || Object.keys(config).length !== CONFIG_KEYS.length) {
    throw siteInvalid('The committed site configuration carries unsupported fields');
  }
  for (const key of CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      throw siteInvalid('The committed site configuration is missing a required field');
    }
  }
  if (config.name !== WORKER_NAME) throw siteInvalid('The committed site configuration names a different worker');
  if (typeof config.compatibility_date !== 'string' || !COMPATIBILITY_PATTERN.test(config.compatibility_date) ||
      Number.isNaN(Date.parse(config.compatibility_date))) {
    throw siteInvalid('The committed site configuration has an invalid compatibility date');
  }
  if (!isPlainRecord(config.assets) || Object.keys(config.assets).length !== 1 ||
      config.assets.directory !== './') {
    throw siteInvalid('The committed site configuration must serve the site root');
  }
  if (!Array.isArray(config.routes) || config.routes.length !== ASSET_ROUTES.length) {
    throw siteInvalid('The committed site configuration must carry the two fixed custom-domain routes');
  }
  const patterns = [];
  for (const route of config.routes) {
    if (!isPlainRecord(route) || Object.keys(route).length !== 2 || route.custom_domain !== true ||
        typeof route.pattern !== 'string') {
      throw siteInvalid('The committed site configuration carries an unsupported route');
    }
    patterns.push(route.pattern);
  }
  for (const pattern of ASSET_ROUTES) {
    if (!patterns.includes(pattern)) {
      throw siteInvalid('The committed site configuration must carry the two fixed custom-domain routes');
    }
  }
  if (new Set(patterns).size !== patterns.length) {
    throw siteInvalid('The committed site configuration repeats a custom-domain route');
  }
}

function validateAssetsIgnore(bytes) {
  const lines = bytes.toString('utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length !== IGNORE_EXCLUSIONS.length) {
    throw siteInvalid('The committed ignore file must carry exactly the four fixed exclusions');
  }
  const seen = new Set();
  for (const line of lines) {
    if (!IGNORE_EXCLUSIONS.includes(line)) {
      throw siteInvalid(`The committed ignore file carries an unsupported exclusion: ${line}`);
    }
    if (seen.has(line)) throw siteInvalid('The committed ignore file repeats an exclusion');
    seen.add(line);
  }
}

function readCommittedSite(input, deps) {
  const request = isPlainRecord(input) ? input : {};
  const run = resolveRun(deps);
  const repoRoot = requireRepoRoot(request.repoRoot);
  const sourceSha = requireOid(request.sourceSha, 'The site source');

  const commit = runGit(run, repoRoot, ['rev-parse', '--verify', `${sourceSha}^{commit}`], { encoding: 'utf8' });
  if (typeof commit !== 'string' || commit.trim() !== sourceSha) {
    throw siteInvalid('Site source is not the recorded commit');
  }

  const websiteEntries = parseTreeListing(
    runGit(run, repoRoot, ['ls-tree', '-z', sourceSha, '--', WEBSITE_DIR], { encoding: null }),
    'The site source listing'
  );
  if (websiteEntries.length !== 1) {
    throw siteInvalid('The recorded site source must hold exactly one website tree');
  }
  const websiteEntry = websiteEntries[0];
  if (websiteEntry.mode !== '040000' || websiteEntry.type !== 'tree' || websiteEntry.path !== WEBSITE_DIR) {
    throw siteInvalid('The recorded site source has no website tree');
  }
  const treeSha = websiteEntry.oid;
  if (treeSha.length !== sourceSha.length) throw siteInvalid('The recorded site tree is not a Git object identifier');

  const records = parseTreeListing(
    runGit(run, repoRoot, ['ls-tree', '-r', '--full-tree', '-z', treeSha], { encoding: null }),
    'The site tree listing'
  );
  if (records.length === 0) throw siteInvalid('The recorded site tree is empty');
  if (records.length > MAX_FILES) throw siteInvalid('The recorded site tree exceeds the retained file count bound');

  const files = [];
  const seen = new Set();
  const folded = new Set();
  let total = 0;
  for (const entry of records) {
    if (entry.type !== 'blob') throw siteInvalid(`The recorded site tree holds a non-blob entry: ${entry.path}`);
    const mode = TREE_MODES[entry.mode];
    if (mode === undefined) throw siteInvalid(`The recorded site tree holds an unsupported mode: ${entry.path}`);
    requireSitePath(entry.path);
    if (seen.has(entry.path)) throw siteInvalid(`The recorded site tree repeats a path: ${entry.path}`);
    const lower = entry.path.toLowerCase();
    if (folded.has(lower)) throw siteInvalid(`The recorded site tree collides by case: ${entry.path}`);
    seen.add(entry.path);
    folded.add(lower);
    const bytes = runGit(run, repoRoot, ['cat-file', 'blob', entry.oid], {
      encoding: null, maxBuffer: MAX_FILE_BYTES
    });
    if (!Buffer.isBuffer(bytes)) throw siteInvalid('Site blob read did not return exact bytes');
    if (bytes.length > MAX_FILE_BYTES) {
      throw siteInvalid(`The recorded site tree holds an oversized file: ${entry.path}`);
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw siteInvalid('The recorded site tree exceeds the retained byte bound');
    files.push({ path: entry.path, mode, oid: entry.oid, bytes });
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const required of REQUIRED_FILES) {
    if (!byPath.has(required)) throw siteInvalid(`The recorded site tree is missing ${required}`);
  }
  validateSiteConfiguration(byPath.get('wrangler.jsonc').bytes);
  validateAssetsIgnore(byPath.get('.assetsignore').bytes);
  return { sourceSha, treeSha, files };
}

function lstatOrMissing(io, target) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error && (error.code === 'ENOTDIR' || error.code === 'ELOOP')) {
      throw siteInvalid('A retained site path component is not a directory', error);
    }
    throw siteInvalid('A retained site path is not readable', error);
  }
}

function requirePrivateDirectory(io, target, label) {
  const stat = lstatOrMissing(io, target);
  if (stat === null) throw siteInvalid(`${label} is missing`);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw siteInvalid(`${label} must be a real directory`);
  if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) throw siteInvalid(`${label} is writable by group or other`);
  return stat;
}

function verifyMaterializedTree(root, files, io) {
  requirePrivateDirectory(io, root, 'The retained site snapshot');
  const expectedFiles = new Map(files.map((file) => [file.path, file]));
  const expectedDirectories = new Set(['']);
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join('/'));
    }
  }
  const foundFiles = new Map();
  const foundDirectories = new Set(['']);
  const visit = (dir, prefix) => {
    let names;
    try {
      names = io.readdirSync(dir);
    } catch (error) {
      throw siteInvalid('The retained site snapshot is not readable', error);
    }
    if (!Array.isArray(names)) throw siteInvalid('The retained site snapshot is not readable');
    for (const name of names.slice().sort()) {
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      const target = path.join(dir, name);
      const stat = lstatOrMissing(io, target);
      if (stat === null) throw siteInvalid(`The retained site snapshot changed while it was read: ${relative}`);
      if (stat.isSymbolicLink()) throw siteInvalid(`The retained site snapshot holds a symlink: ${relative}`);
      if (stat.isDirectory()) {
        foundDirectories.add(relative);
        visit(target, relative);
        continue;
      }
      if (!stat.isFile()) throw siteInvalid(`The retained site snapshot holds a special file: ${relative}`);
      if ((stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
        throw siteInvalid(`The retained site snapshot permissions are unsafe: ${relative}`);
      }
      foundFiles.set(relative, stat);
    }
  };
  visit(root, '');

  for (const [relative, stat] of foundFiles) {
    const expected = expectedFiles.get(relative);
    if (expected === undefined) throw siteInvalid(`The retained site snapshot holds an unexpected file: ${relative}`);
    if (((stat.mode & EXECUTABLE_BITS) !== 0) !== (expected.mode === 0o755)) {
      throw siteInvalid(`The retained site snapshot executable mode changed: ${relative}`);
    }
    let bytes;
    try {
      bytes = readBoundedOrdinaryFile(path.join(root, relative), { maxBytes: MAX_FILE_BYTES, fs: io });
    } catch (error) {
      throw siteFailure(`The retained site snapshot file is not readable: ${relative}`, error);
    }
    if (bytes === null) throw siteInvalid(`The retained site snapshot is missing ${relative}`);
    if (!bytes.equals(expected.bytes)) throw siteInvalid(`The retained site snapshot bytes changed: ${relative}`);
  }
  for (const relative of expectedFiles.keys()) {
    if (!foundFiles.has(relative)) throw siteInvalid(`The retained site snapshot is missing ${relative}`);
  }
  for (const relative of foundDirectories) {
    if (!expectedDirectories.has(relative)) {
      throw siteInvalid(`The retained site snapshot holds an unexpected directory: ${relative}`);
    }
  }
  for (const relative of expectedDirectories) {
    if (!foundDirectories.has(relative)) {
      throw siteInvalid(`The retained site snapshot is missing a directory: ${relative}`);
    }
  }
}

function verifySiteSnapshot(input, deps) {
  const request = isPlainRecord(input) ? input : {};
  const io = resolveIo(deps);
  const run = resolveRun(deps);
  const committed = readCommittedSite({ repoRoot: request.repoRoot, sourceSha: request.sourceSha }, { run });
  if (committed.treeSha !== request.treeSha) {
    throw siteInvalid('The retained site tree is not the recorded subtree');
  }
  verifyMaterializedTree(request.snapshotDir, committed.files, io);
  return { sourceSha: committed.sourceSha, treeSha: committed.treeSha };
}

function requireOwnedDirectory(io, target, label) {
  const stat = requirePrivateDirectory(io, target, label);
  return stat;
}

function requireOwnedAttempt(repoDir, state, attemptId, io) {
  for (const protectedRoot of [state.repo.root, state.repo.commonDir]) {
    if (typeof protectedRoot === 'string' && protectedRoot.length > 0 &&
        (repoDir === protectedRoot || repoDir.startsWith(protectedRoot + path.sep))) {
      throw siteInvalid('Site evidence must stay outside the checkout');
    }
  }
  let real;
  try {
    real = io.realpathSync(repoDir);
  } catch (error) {
    throw siteInvalid('The release cache directory is missing', error);
  }
  if (real !== repoDir) throw siteInvalid('The release cache directory is not canonical');
  requireOwnedDirectory(io, repoDir, 'The release cache directory');
  let current = repoDir;
  for (const segment of [RECORDS_DIR, state.releaseId, SITE_DIR, attemptId]) {
    current = path.join(current, segment);
    requireOwnedDirectory(io, current, 'A retained site attempt directory');
  }
  return current;
}

function validateDescriptor(descriptor, context) {
  requireExactKeys(descriptor, DESCRIPTOR_KEYS, 'The retained site descriptor');
  if (descriptor.schema !== DESCRIPTOR_SCHEMA) throw siteInvalid('The retained site descriptor has an unsupported schema');
  if (descriptor.releaseId !== context.state.releaseId) {
    throw siteInvalid('The retained site descriptor names a different release');
  }
  if (descriptor.version !== context.state.version) {
    throw siteInvalid('The retained site descriptor names a different version');
  }
  if (descriptor.attemptId !== context.attemptId) {
    throw siteInvalid('The retained site descriptor names a different attempt');
  }
  if (descriptor.sourceSha !== context.state.site.sourceSha) {
    throw siteInvalid('The retained site descriptor names a different site source');
  }
  if (descriptor.sourceSha !== context.state.sizes.commit) {
    throw siteInvalid('The retained site descriptor is not the completed size source');
  }
  if (descriptor.treeSha !== context.state.site.treeSha) {
    throw siteInvalid('The retained site descriptor names a different site tree');
  }
  if (descriptor.snapshotDir !== path.join(context.attemptDir, SNAPSHOT_NAME)) {
    throw siteInvalid('The retained site descriptor names a different snapshot');
  }
  if (!PHASES.includes(descriptor.phase)) throw siteInvalid('The retained site descriptor has an unsupported phase');
  if (descriptor.phase === 'prepared') {
    if (descriptor.requestedAt !== null || descriptor.completedAt !== null ||
        descriptor.receiptSha !== null || descriptor.receiptBeforeSha256 !== null) {
      throw siteInvalid('A prepared site descriptor must carry no request identity');
    }
    return descriptor;
  }
  if (!isCanonicalTimestamp(descriptor.requestedAt)) {
    throw siteInvalid('A requested site descriptor must carry a canonical request time');
  }
  if (descriptor.receiptBeforeSha256 !== null && !DIGEST_PATTERN.test(descriptor.receiptBeforeSha256)) {
    throw siteInvalid('A requested site descriptor carries an invalid receipt preimage digest');
  }
  if (descriptor.phase !== 'complete') {
    if (descriptor.completedAt !== null || descriptor.receiptSha !== null) {
      throw siteInvalid('An unresolved site descriptor must carry no completion identity');
    }
    return descriptor;
  }
  if (!isCanonicalTimestamp(descriptor.completedAt)) {
    throw siteInvalid('A complete site descriptor must carry a canonical completion time');
  }
  if (new Date(descriptor.completedAt).getTime() < new Date(descriptor.requestedAt).getTime()) {
    throw siteInvalid('A complete site descriptor must not complete before it was requested');
  }
  if (descriptor.receiptSha !== descriptor.sourceSha) {
    throw siteInvalid('A complete site descriptor must name the captured receipt');
  }
  return descriptor;
}

function readSiteAttempt(input, deps) {
  const request = isPlainRecord(input) ? input : {};
  const io = resolveIo(deps);
  const run = resolveRun(deps);
  const state = request.state;
  const repoDir = request.repoDir;
  if (!isPlainRecord(state) || !isPlainRecord(state.repo)) {
    throw siteInvalid('Site evidence needs a validated release state');
  }
  let validated;
  try {
    validated = validateReleaseState(state, state.repo, { repoDir });
  } catch (error) {
    throw siteFailure('Site evidence needs a validated release state', error);
  }
  if (validated.mode !== 'publish') throw siteInvalid('Site evidence requires a publish release');
  if (validated.sizes.state !== 'complete' || validated.sizes.commit === null) {
    throw siteInvalid('Site evidence requires the completed size source');
  }
  const attemptId = validated.site.attemptId;
  if (typeof attemptId !== 'string' || !UUID_PATTERN.test(attemptId)) {
    throw siteInvalid('Site evidence requires a recorded site attempt');
  }
  let objectStore;
  try {
    objectStore = observeObjectStore(run, validated.repo.root);
  } catch (error) {
    throw siteFailure('Site evidence could not observe the recorded object store', error);
  }
  for (const field of OBJECT_STORE_FIELDS) {
    if (objectStore[field] !== validated.repo[field]) {
      throw siteInvalid('Site evidence uses a different object store');
    }
  }
  const attemptDir = requireOwnedAttempt(repoDir, validated, attemptId, io);
  const descriptorFile = path.join(attemptDir, DESCRIPTOR_FILE);
  const leaf = lstatOrMissing(io, descriptorFile);
  if (leaf === null) throw siteInvalid('The retained site descriptor is missing');
  if (leaf.isSymbolicLink() || !leaf.isFile()) throw siteInvalid('The retained site descriptor must be an ordinary file');
  if ((leaf.mode & SPECIAL_MODE_BITS) !== 0 || (leaf.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw siteInvalid('The retained site descriptor permissions are unsafe');
  }
  if (leaf.size > DESCRIPTOR_MAX_BYTES) throw siteInvalid('The retained site descriptor exceeds the read bound');
  let descriptorBytes;
  try {
    descriptorBytes = readBoundedOrdinaryFile(descriptorFile, { maxBytes: DESCRIPTOR_MAX_BYTES, fs: io });
  } catch (error) {
    throw siteFailure('The retained site descriptor is not readable', error);
  }
  if (descriptorBytes === null) throw siteInvalid('The retained site descriptor is missing');
  let descriptor;
  try {
    descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  } catch (error) {
    throw siteInvalid('The retained site descriptor is not valid JSON', error);
  }
  validateDescriptor(descriptor, { state: validated, attemptId, attemptDir });
  verifySiteSnapshot({
    repoRoot: validated.repo.root,
    sourceSha: descriptor.sourceSha,
    treeSha: descriptor.treeSha,
    snapshotDir: descriptor.snapshotDir
  }, { run, fs: io });
  return { descriptor, descriptorBytes, attemptDir };
}

function readSiteEvidence(input, deps) {
  const request = isPlainRecord(input) ? input : {};
  const state = request.state;
  if (!isPlainRecord(state) || !isPlainRecord(state.site) || state.site.state !== 'complete') {
    throw siteInvalid('Complete site evidence is required');
  }
  const { descriptor } = readSiteAttempt(request, deps);
  if (descriptor.phase !== 'complete' || descriptor.receiptSha !== state.site.receiptSha ||
      descriptor.completedAt !== state.site.verifiedAt) {
    throw siteInvalid('Site completion differs from its retained descriptor');
  }
  return {
    sourceSha: descriptor.sourceSha,
    treeSha: descriptor.treeSha,
    attemptId: descriptor.attemptId,
    receiptSha: descriptor.receiptSha,
    verifiedAt: descriptor.completedAt
  };
}

module.exports = { readCommittedSite, readSiteAttempt, readSiteEvidence, verifySiteSnapshot };
