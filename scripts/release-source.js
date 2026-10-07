'use strict';

// Persist the exact prepared desktop version operation before any live version
// file or Git ref changes. Preparation and planning stay with the accepted
// modules; this wrapper owns only the private retained evidence of the version
// application and the publish-lane record that binds it, so a later invocation can
// recover the same operation without regenerating anything from live files.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');

const { execFileCaptured } = require('./release-command');
const { createLocalGitReader, readBoundedOrdinaryFile } = require('./release-local-read');
const { resolveRepoIdentity, statePaths, validateReleaseState } = require('./release-state');
const { readReleaseState, writeReleaseState, fsyncDirectory } = require('./release-state-store');
const { createReleaseState, transitionRelease } = require('./release-transitions');
const { prepareCommitIntent, reconcileTarget, reconcileTargetPush } = require('./release-docs-apply');
const { readTargetEvidence, readCompletedTargetEvidence } = require('./release-target-evidence');
const { readPublishedSourceVersion } = require('./release-publication');
const { withFerryRepoLock } = require('./release-ferry');
const { prepareReleaseVersion } = require('./release-docs-prepare');
const { prepareDocsApplication, readPreparedTarget, verifyDocsApplication } = require('./release-docs-plan');

const localReader = createLocalGitReader();

const DESKTOP_REPO = 'hyperclay-local';
const RECORDS_DIR = 'records';
const VERSION_DIR = 'version';
const PREPARE_DIR = 'prepare';
const APPLY_DIR = 'apply';
const BEFORE_DIR = 'before';
const AFTER_DIR = 'after';
const PREPARED_FILE = 'prepared.json';
const APPLICATION_FILE = 'application.json';
const JOURNAL_FILE = 'target.json';
const SOURCE_PATH = 'package.json';
const REQUIRED_PATHS = ['README.md', 'package.json', 'website/index.html'];

const EVIDENCE_JSON_BYTES = 8 * 1024 * 1024;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const VERSION_COMPONENT_MAX = 65535;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const REPO_FIELDS = [
  'key', 'root', 'commonDir', 'branch', 'remote', 'remoteRepo', 'pushUrlSha256', 'objectFormat'
];

const DIRECTORY_MODE = 0o700;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const INVALID_CODE = 'RELEASE_SOURCE_INVALID';
const IO_FAILED_CODE = 'RELEASE_SOURCE_IO_FAILED';

function sourceError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function invalid(message, cause) {
  return sourceError(INVALID_CODE, message, cause);
}

function ioFailed(message, cause) {
  return sourceError(IO_FAILED_CODE, message, cause);
}

function isSourceError(error) {
  return Boolean(error) && typeof error === 'object'
    && (error.code === INVALID_CODE || error.code === IO_FAILED_CODE);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contains(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function isVersion(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) return false;
  return value.split('.').every((part) => Number(part) <= VERSION_COMPONENT_MAX);
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function resolveDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw invalid('Release source dependencies must be a plain object');
  const run = provided.run === undefined ? execFileCaptured : provided.run;
  const spawn = provided.spawn === undefined ? childProcess.spawnSync : provided.spawn;
  const io = provided.fs === undefined ? fs : provided.fs;
  const now = provided.now === undefined ? () => Date.now() : provided.now;
  const randomUUID = provided.randomUUID === undefined ? () => crypto.randomUUID() : provided.randomUUID;
  const ferry = provided.withFerryRepoLock === undefined ? withFerryRepoLock : provided.withFerryRepoLock;
  const spawnRemote = provided.spawnRemote === undefined ? childProcess.spawnSync : provided.spawnRemote;
  if (typeof run !== 'function') throw invalid('Release source run must be a function');
  if (typeof spawn !== 'function') throw invalid('Release source spawn must be a function');
  if (typeof now !== 'function') throw invalid('Release source now must be a function');
  if (typeof randomUUID !== 'function') throw invalid('Release source randomUUID must be a function');
  if (typeof ferry !== 'function') throw invalid('Release source withFerryRepoLock must be a function');
  if (typeof spawnRemote !== 'function') throw invalid('Release source spawnRemote must be a function');
  if (io === null || typeof io !== 'object' || Array.isArray(io)) {
    throw invalid('Release source filesystem must be an object');
  }
  const readGit = (root, args) => {
    const output = run('git', args, { cwd: root });
    return typeof output === 'string' ? output.trim() : String(output).trim();
  };
  return {
    run,
    spawn,
    io,
    now,
    randomUUID,
    ferry,
    ferryOptions: provided.ferryOptions === undefined ? {} : provided.ferryOptions,
    spawnRemote,
    assertPublishWindow: provided.assertPublishWindow,
    readGit
  };
}

function resolveReadDeps(deps) {
  const provided = deps === undefined || deps === null ? {} : deps;
  if (!isPlainRecord(provided)) throw invalid('Release source read dependencies must be a plain object');
  const run = provided.run === undefined ? localReader.run : provided.run;
  const spawn = provided.spawn === undefined ? localReader.spawn : provided.spawn;
  const io = provided.fs === undefined ? fs : provided.fs;
  if (typeof run !== 'function') throw invalid('Release source read run must be a function');
  if (typeof spawn !== 'function') throw invalid('Release source read spawn must be a function');
  if (io === null || typeof io !== 'object' || Array.isArray(io)) {
    throw invalid('Release source read filesystem must be an object');
  }
  return { run, spawn, io };
}

function canonicalTime(now) {
  let value;
  try {
    value = now();
  } catch (error) {
    throw invalid('Release source clock is not readable', error);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid('Release source now must produce milliseconds');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('Release source now must produce a valid timestamp');
  return date.toISOString();
}

function requireSelectedVersions(previousVersion, version) {
  if (!isVersion(previousVersion)) throw invalid('Release source previousVersion must look like 1.2.3');
  if (!isVersion(version)) throw invalid('Release source version must look like 1.2.3');
  if (compareVersions(version, previousVersion) <= 0) {
    throw invalid('Release source version must be greater than previousVersion');
  }
}

function requireIdentity(identity, resolved) {
  if (!isPlainRecord(identity)) throw invalid('Release source needs a canonical repository identity');
  for (const field of REPO_FIELDS) {
    if (typeof identity[field] !== 'string' || identity[field].length === 0) {
      throw invalid(`Release source identity is missing ${field}`);
    }
  }
  if (!path.isAbsolute(identity.root) || CONTROL_PATTERN.test(identity.root)
    || path.normalize(identity.root) !== identity.root) {
    throw invalid('Release source identity root must be a canonical absolute path');
  }
  if (path.basename(identity.root) !== DESKTOP_REPO) {
    throw invalid(`Release source requires a ${DESKTOP_REPO} checkout`);
  }
  let observed;
  try {
    observed = resolveRepoIdentity(identity.root, { readGit: resolved.readGit, fs: resolved.io });
  } catch (error) {
    throw invalid('Release source repository identity is not readable', error);
  }
  for (const field of REPO_FIELDS) {
    if (identity[field] !== observed[field]) {
      throw invalid(`Release source identity ${field} is not the canonical repository identity`);
    }
  }
  return observed;
}

function versionPaths(repoDir, releaseId) {
  const releaseDir = path.join(repoDir, RECORDS_DIR, releaseId);
  const versionRoot = path.join(releaseDir, VERSION_DIR);
  const prepareDir = path.join(versionRoot, PREPARE_DIR);
  const applyDir = path.join(versionRoot, APPLY_DIR);
  return {
    repoDir,
    releaseDir,
    versionRoot,
    prepareDir,
    applyDir,
    preparedFile: path.join(prepareDir, PREPARED_FILE),
    applicationFile: path.join(applyDir, APPLICATION_FILE),
    journalFile: path.join(applyDir, JOURNAL_FILE)
  };
}

function requireRelativePath(value, label) {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)
    || CONTROL_PATTERN.test(value)
    || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw invalid(`${label} must be a relative selected path`);
  }
  return value;
}

function beforeEvidenceFile(paths, relative) {
  return path.join(paths.prepareDir, DESKTOP_REPO, BEFORE_DIR, requireRelativePath(relative, 'A retained version selected path'));
}

function afterEvidenceFile(paths, relative) {
  return path.join(paths.prepareDir, DESKTOP_REPO, AFTER_DIR, requireRelativePath(relative, 'A retained version selected path'));
}

function evidenceFiles(paths, application) {
  const files = [paths.preparedFile, paths.applicationFile, application.patchFile, application.privateIndexFile];
  for (const file of application.files) {
    files.push(file.beforeFile, file.afterFile);
  }
  return [...new Set(files)];
}

function intentMode(value) {
  if (typeof value !== 'string' || !/^[0-7]{3,4}$/.test(value)) {
    throw invalid(`A retained version application mode is not an octal permission string: ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value, 8);
}

function intentFromApplication(application, previousVersion, journalFile) {
  return {
    previousVersion,
    version: application.version,
    baseHead: application.beforeHead,
    journalFile,
    files: application.files.map((file) => ({
      path: file.path,
      beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256,
      beforeMode: intentMode(file.mode),
      afterMode: intentMode(file.mode),
      preparedFile: file.afterFile
    }))
  };
}

function lstatOrMissing(io, target) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') return null;
    if (code === 'ENOTDIR' || code === 'ELOOP') {
      throw invalid(`Release source path component is not a directory: ${target}`, error);
    }
    throw ioFailed(`Release source path could not be inspected: ${target}`, error);
  }
}

function requireOwnedComponent(io, dir, label, owned) {
  if (owned) {
    const stat = lstatOrMissing(io, dir);
    if (stat === null) return null;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw invalid(`${label} must be a real directory: ${dir}`);
    }
    if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
      throw invalid(`${label} is writable by group or other: ${dir}`);
    }
    if ((stat.mode & SPECIAL_MODE_BITS) !== 0) {
      throw invalid(`${label} has unsupported mode bits: ${dir}`);
    }
    return stat;
  }
  let stat;
  try {
    stat = io.statSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw ioFailed(`Release source path could not be inspected: ${dir}`, error);
  }
  if (!stat.isDirectory()) throw invalid(`${label} is not a directory: ${dir}`);
  return stat;
}

function flushDirectory(io, dir, label) {
  try {
    fsyncDirectory(dir, io);
  } catch (error) {
    throw ioFailed(`${label} could not be flushed: ${dir}`, error);
  }
}

function ensureDirectory(io, dir, ownedRoot, label) {
  const owned = (target) => target === ownedRoot || contains(ownedRoot, target);
  const missing = [];
  let current = path.normalize(dir);
  for (;;) {
    if (requireOwnedComponent(io, current, label, owned(current)) !== null) break;
    missing.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) throw invalid(`${label} has no existing parent: ${dir}`);
    current = parent;
  }
  for (const component of missing) {
    try {
      io.mkdirSync(component, DIRECTORY_MODE);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw ioFailed(`${label} could not be created: ${component}`, error);
    }
    if (requireOwnedComponent(io, component, label, owned(component)) === null) {
      throw invalid(`${label} was not created: ${component}`);
    }
    flushDirectory(io, path.dirname(component), `The parent of ${label}`);
  }
  return dir;
}

function createOwnedDirectory(io, dir, label) {
  if (lstatOrMissing(io, dir) !== null) throw invalid(`${label} already exists: ${dir}`);
  try {
    io.mkdirSync(dir, DIRECTORY_MODE);
  } catch (error) {
    throw ioFailed(`${label} could not be created: ${dir}`, error);
  }
  if (requireOwnedComponent(io, dir, label, true) === null) {
    throw invalid(`${label} was not created: ${dir}`);
  }
  flushDirectory(io, path.dirname(dir), `The parent of ${label}`);
  return dir;
}

function requireEvidenceLeaf(root, file, label, io) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file
    || CONTROL_PATTERN.test(file)) {
    throw invalid(`${label} must be a canonical absolute path`);
  }
  const relative = path.relative(root, file);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw invalid(`${label} is outside the retained version evidence: ${file}`);
  }
  let current = root;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    const stat = lstatOrMissing(io, current);
    if (stat === null) throw invalid(`${label} parent is missing: ${current}`);
    if (stat.isSymbolicLink()) throw invalid(`${label} parent is a symlink: ${current}`);
    if (!stat.isDirectory()) throw invalid(`${label} parent is not a directory: ${current}`);
  }
  const leaf = lstatOrMissing(io, file);
  if (leaf === null) throw invalid(`${label} is missing: ${file}`);
  if (leaf.isSymbolicLink()) throw invalid(`${label} must not be a symlink: ${file}`);
  if (!leaf.isFile()) throw invalid(`${label} must be a regular file: ${file}`);
  return leaf;
}

function flushOrdinaryFile(io, root, file, label) {
  const constants = io.constants === undefined || io.constants === null ? fs.constants : io.constants;
  const stat = requireEvidenceLeaf(root, file, label, io);
  let fd = null;
  let primary = null;
  try {
    fd = io.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = io.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile()) {
      throw invalid(`${label} changed while it was flushed: ${file}`);
    }
    io.fsyncSync(fd);
  } catch (error) {
    primary = isSourceError(error) ? error : ioFailed(`${label} could not be flushed: ${file}`, error);
  }
  if (fd !== null) {
    try {
      io.closeSync(fd);
    } catch (error) {
      if (primary === null) primary = ioFailed(`${label} could not be closed: ${file}`, error);
      else primary.closeError = error;
    }
  }
  if (primary !== null) throw primary;
}

function flushVersionEvidence(paths, application, io) {
  const files = evidenceFiles(paths, application);
  for (const file of files) {
    flushOrdinaryFile(io, paths.versionRoot, file, 'A retained version evidence file');
  }
  const directories = new Set();
  for (const file of files) {
    let dir = path.dirname(file);
    for (;;) {
      directories.add(dir);
      if (dir === paths.repoDir || !contains(paths.repoDir, dir)) break;
      dir = path.dirname(dir);
    }
  }
  const ordered = [...directories].sort((left, right) => {
    const difference = right.split(path.sep).length - left.split(path.sep).length;
    if (difference !== 0) return difference;
    return left < right ? -1 : 1;
  });
  for (const dir of ordered) flushDirectory(io, dir, 'A retained version evidence directory');
}

function readEvidenceRecord(io, root, file, label) {
  requireEvidenceLeaf(root, file, label, io);
  const bytes = readBoundedOrdinaryFile(file, {
    maxBytes: EVIDENCE_JSON_BYTES,
    fs: io
  });
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw invalid(`${label} is not valid JSON: ${file}`, error);
  }
  if (!isPlainRecord(record)) throw invalid(`${label} must hold a record object: ${file}`);
  return record;
}

function requireApplicationPreflight(record, state, paths, io) {
  if (record.repo !== DESKTOP_REPO) {
    throw invalid('The retained version application is not the hyperclay-local target');
  }
  if (record.repoRoot !== state.repo.root) {
    throw invalid('The retained version application does not name the canonical repository root');
  }
  if (record.sourcePath !== SOURCE_PATH) {
    throw invalid(`The retained version application sourcePath is not ${SOURCE_PATH}`);
  }
  if (!isDeepStrictEqual(record.requiredPaths, REQUIRED_PATHS)) {
    throw invalid('The retained version application requiredPaths are not the fixed version targets');
  }
  if (record.preparedFile !== paths.preparedFile) {
    throw invalid('The retained version application does not name the fixed prepared descriptor');
  }
  if (typeof record.patchFile !== 'string' || typeof record.privateIndexFile !== 'string'
    || path.dirname(record.patchFile) !== paths.applyDir || path.dirname(record.privateIndexFile) !== paths.applyDir) {
    throw invalid('The retained version application references evidence outside the fixed apply directory');
  }
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw invalid('The retained version application has no selected files');
  }
  const seen = new Set();
  for (const file of record.files) {
    if (!isPlainRecord(file)) throw invalid('A retained version application file entry must be an object');
    const relative = requireRelativePath(file.path, 'A retained version application file path');
    if (seen.has(relative)) throw invalid(`The retained version application lists ${relative} more than once`);
    seen.add(relative);
    if (file.beforeFile !== beforeEvidenceFile(paths, relative)) {
      throw invalid(`The retained version application ${relative} before snapshot is not the retained evidence path`);
    }
    if (file.afterFile !== afterEvidenceFile(paths, relative)) {
      throw invalid(`The retained version application ${relative} after snapshot is not the retained evidence path`);
    }
  }
  for (const file of evidenceFiles(paths, record)) {
    requireEvidenceLeaf(paths.versionRoot, file, 'A retained version evidence file', io);
  }
}

function requireDescriptorPreflight(record, paths) {
  if (record.runDir !== paths.prepareDir) {
    throw invalid('The retained prepared descriptor does not name the fixed prepare directory');
  }
  if (!Array.isArray(record.targets)) return;
  for (const target of record.targets) {
    if (!isPlainRecord(target) || !Array.isArray(target.paths)) continue;
    for (const entry of target.paths) {
      if (!isPlainRecord(entry)) continue;
      if (entry.beforeFile !== beforeEvidenceFile(paths, entry.path)
        || entry.afterFile !== afterEvidenceFile(paths, entry.path)) {
        throw invalid('The retained prepared descriptor does not name the derived before and after evidence');
      }
    }
  }
}

function requireVersionVariant(target, intent, paths, repoRoot) {
  if (!isPlainRecord(target)) throw invalid('The retained prepared target must be an object');
  if (target.repo !== DESKTOP_REPO) throw invalid('The retained prepared target is not hyperclay-local');
  if (target.repoRoot !== repoRoot) {
    throw invalid('The retained prepared target does not name the canonical repository root');
  }
  if (target.state !== 'prepared') throw invalid('The retained prepared target is not prepared');
  if (target.sourcePath !== SOURCE_PATH) throw invalid(`The retained prepared target sourcePath is not ${SOURCE_PATH}`);
  if (!isPlainRecord(target.versionPreparation)) {
    throw invalid('The retained prepared target is not the version preparation variant');
  }
  if (target.versionPreparation.previousVersion !== intent.previousVersion
    || target.oldVersion !== intent.previousVersion) {
    throw invalid('The retained prepared target does not record the selected previous version');
  }
  const selected = Array.isArray(target.paths) ? target.paths.map((entry) => (isPlainRecord(entry) ? entry.path : null)) : [];
  if (!isDeepStrictEqual(selected, REQUIRED_PATHS)) {
    throw invalid('The retained prepared target paths are not the fixed version targets');
  }
}

function requireVersionDirectories(paths, cacheRoot, io) {
  const directories = [
    cacheRoot,
    paths.repoDir,
    path.join(paths.repoDir, RECORDS_DIR),
    paths.releaseDir,
    paths.versionRoot,
    paths.prepareDir,
    paths.applyDir
  ];
  for (const dir of directories) {
    if (requireOwnedComponent(io, dir, 'Retained version evidence', true) === null) {
      throw invalid('A retained version evidence directory is missing');
    }
  }
}

function readVersionApplication(state, paths, readDeps) {
  const resolved = resolveReadDeps(readDeps);
  let validated;
  try {
    validated = validateReleaseState(state, state.repo, { repoDir: paths.repoDir });
  } catch (error) {
    throw invalid('The retained version intent is not a valid release state', error);
  }
  if (validated.phase !== 'version-preparing' && validated.phase !== 'source-ready') {
    throw invalid('The retained version intent is not a version-preparing or source-ready release');
  }
  if (validated.mode !== 'publish') throw invalid('The retained version intent is not a publish release');
  if (validated.activeAttemptId !== null || validated.attempts.length !== 0) {
    throw invalid('A version-preparing release must not carry an attempt');
  }
  const preparing = validated.phase === 'version-preparing';
  const intent = validated.versionIntent;
  if (preparing) {
    if (intent === null) throw invalid('The retained version intent is missing');
    if (intent.journalFile !== paths.journalFile) {
      throw invalid('The retained version intent does not name the derived target journal');
    }
  } else if (intent !== null) {
    throw invalid('A source-ready release must not retain a version intent');
  }

  const record = readEvidenceRecord(
    resolved.io, paths.versionRoot, paths.applicationFile, 'The retained version application'
  );
  requireApplicationPreflight(record, validated, paths, resolved.io);
  const descriptor = readEvidenceRecord(
    resolved.io, paths.versionRoot, paths.preparedFile, 'The retained version prepared descriptor'
  );
  requireDescriptorPreflight(descriptor, paths);

  const application = verifyDocsApplication(paths.applicationFile, {
    run: resolved.run, spawn: resolved.spawn
  });
  const prepared = readPreparedTarget(paths.preparedFile, { repo: DESKTOP_REPO, version: validated.version });
  const selectedIntent = preparing
    ? intent
    : { previousVersion: prepared.target.versionPreparation?.previousVersion };
  requireSelectedVersions(selectedIntent.previousVersion, validated.version);
  requireVersionVariant(prepared.target, selectedIntent, paths, validated.repo.root);
  if (application.version !== validated.version) {
    throw invalid('The retained version application version is not the recorded release version');
  }
  if (application.repoRoot !== validated.repo.root) {
    throw invalid('The retained version application repoRoot is not the recorded repository root');
  }
  if (application.preparedFile !== paths.preparedFile) {
    throw invalid('The retained version application preparedFile is not the fixed prepared descriptor');
  }
  if (!isDeepStrictEqual(application.requiredPaths, REQUIRED_PATHS)) {
    throw invalid('The retained version application requiredPaths are not the fixed version targets');
  }
  const regenerated = intentFromApplication(application, selectedIntent.previousVersion, paths.journalFile);
  if (preparing && !isDeepStrictEqual(regenerated, intent)) {
    throw invalid('The persisted version intent does not match the verified version application');
  }
  return { state: validated, application, prepared };
}

function readVersionJournal(state, paths, application, readDeps) {
  const io = readDeps.fs;
  if (lstatOrMissing(io, paths.journalFile) === null) return null;
  const record = readEvidenceRecord(
    io, paths.versionRoot, paths.journalFile, 'The retained version target journal'
  );
  if (record.applicationFile !== paths.applicationFile
    || record.preparedFile !== paths.preparedFile) {
    throw invalid('The version journal does not name the fixed retained evidence');
  }
  const evidence = readTargetEvidence(paths.journalFile, readDeps);
  const journal = evidence.journal;
  if (journal.repo !== DESKTOP_REPO || journal.repoRoot !== state.repo.root
    || journal.repoKey !== state.repo.key
    || journal.pushUrlSha256 !== state.repo.pushUrlSha256
    || journal.version !== state.version
    || journal.beforeHead !== application.beforeHead
    || !isDeepStrictEqual(evidence.application, application)) {
    throw invalid('The version journal does not match the recorded version operation');
  }
  return journal;
}

function isCompletedVersionJournal(journal) {
  return journal !== null && journal.phase === 'complete' && journal.state === 'complete';
}

function requireCompletedVersion(state, paths, application, readDeps) {
  const journal = readVersionJournal(state, paths, application, readDeps);
  if (!isCompletedVersionJournal(journal)) {
    throw invalid('The retained version operation is not complete');
  }
  if (state.phase === 'source-ready' && journal.commit !== state.sourceSha) {
    throw invalid('The completed version commit does not match the recorded source');
  }
  readCompletedTargetEvidence({
    journalFile: paths.journalFile,
    evidenceRoot: paths.versionRoot,
    repo: DESKTOP_REPO,
    version: state.version,
    commit: journal.commit
  }, readDeps);
  readPublishedSourceVersion({
    repoRoot: state.repo.root,
    sourceSha: journal.commit,
    version: state.version
  }, readDeps);
  return journal.commit;
}

function prepareVersionIntent(input, deps) {
  const resolved = resolveDeps(deps);
  const request = isPlainRecord(input) ? input : {};
  const { identity, repoDir, releaseId, previousVersion, version } = request;
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir) || path.normalize(repoDir) !== repoDir
    || CONTROL_PATTERN.test(repoDir)) {
    throw invalid('Release source needs a canonical release cache directory');
  }
  if (typeof releaseId !== 'string' || !UUID_PATTERN.test(releaseId)) {
    throw invalid('Release source releaseId must be the release state identifier');
  }
  requireSelectedVersions(previousVersion, version);
  const canonical = requireIdentity(identity, resolved);
  const cacheRoot = path.dirname(repoDir);
  let paths;
  try {
    paths = statePaths(canonical, { cacheRoot, fs: resolved.io });
  } catch (error) {
    throw invalid('Release source cache root is not the recorded repository cache', error);
  }
  if (paths.repoDir !== repoDir) {
    throw invalid('Release source cache directory does not match the canonical repository cache');
  }
  const parentDir = path.dirname(canonical.root);
  const evidence = versionPaths(repoDir, releaseId);

  const previous = readReleaseState(canonical, { cacheRoot, mode: 'publish', fs: resolved.io });
  if (previous !== null) {
    if (previous.phase !== 'complete') {
      throw invalid(`Release source refuses the pending ${previous.phase} release ${previous.releaseId}`);
    }
    if (previous.releaseId === releaseId) {
      throw invalid('A replacement release requires a fresh release identifier');
    }
    if (compareVersions(version, previous.version) <= 0) {
      throw invalid(`Release source version ${version} must be greater than the completed release ${previous.version}`);
    }
  }

  ensureDirectory(resolved.io, cacheRoot, cacheRoot, 'The release cache root');
  ensureDirectory(resolved.io, paths.repoDir, cacheRoot, 'The release cache directory');
  ensureDirectory(resolved.io, path.join(paths.repoDir, RECORDS_DIR), cacheRoot, 'The release records directory');
  ensureDirectory(resolved.io, evidence.releaseDir, cacheRoot, 'The release record directory');
  createOwnedDirectory(resolved.io, evidence.versionRoot, 'The version evidence directory');

  prepareReleaseVersion({
    previousVersion, version, parentDir, runDir: evidence.prepareDir
  }, { run: resolved.run });
  prepareDocsApplication({
    preparedFile: evidence.preparedFile,
    repo: DESKTOP_REPO,
    parentDir,
    version,
    outDir: evidence.applyDir
  }, { run: resolved.run, spawn: resolved.spawn });

  const application = verifyDocsApplication(evidence.applicationFile, {
    run: resolved.run, spawn: resolved.spawn
  });
  const prepared = readPreparedTarget(evidence.preparedFile, { repo: DESKTOP_REPO, version });
  const intent = intentFromApplication(application, previousVersion, evidence.journalFile);
  requireVersionVariant(prepared.target, intent, evidence, canonical.root);

  flushVersionEvidence(evidence, application, resolved.io);

  const reverified = verifyDocsApplication(evidence.applicationFile, {
    run: resolved.run, spawn: resolved.spawn
  });
  if (!isDeepStrictEqual(reverified, application)
    || !isDeepStrictEqual(intentFromApplication(reverified, previousVersion, evidence.journalFile), intent)) {
    throw invalid('The retained version evidence changed while it was flushed');
  }

  const at = canonicalTime(resolved.now);
  const state = createReleaseState({
    releaseId,
    version,
    mode: 'publish',
    at,
    sourceSha: null,
    versionIntent: intent
  }, canonical, { repoDir });

  const persisted = writeReleaseState(state, canonical, {
    cacheRoot,
    expectedRevision: previous === null ? null : previous.revision,
    fs: resolved.io
  });

  const stored = readReleaseState(canonical, { cacheRoot, mode: 'publish', fs: resolved.io });
  readVersionApplication(stored, evidence, { run: resolved.run, spawn: resolved.spawn, fs: resolved.io });
  if (stored.releaseId !== releaseId || stored.revision !== 0 || stored.version !== version) {
    throw invalid('The persisted version intent is not the record that was published');
  }
  return persisted;
}

async function reconcileVersionIntent(input, deps) {
  if (!isPlainRecord(input)) throw invalid('Release source recovery input must be a plain object');
  const { identity, repoDir } = input;
  const reconcileOnly = input.reconcileOnly === undefined ? false : input.reconcileOnly;
  if (typeof reconcileOnly !== 'boolean') throw invalid('reconcileOnly must be a boolean');
  if (typeof repoDir !== 'string' || !path.isAbsolute(repoDir)
    || path.normalize(repoDir) !== repoDir || CONTROL_PATTERN.test(repoDir)) {
    throw invalid('Release source needs a canonical release cache directory');
  }

  const resolved = resolveDeps(deps);
  const reads = resolveReadDeps(deps);
  const readDeps = { run: reads.run, spawn: reads.spawn, fs: reads.io };
  if (!reconcileOnly && typeof resolved.assertPublishWindow !== 'function') {
    throw invalid('Release source recovery needs a callable assertPublishWindow time policy');
  }
  const canonical = requireIdentity(identity, {
    io: reads.io,
    readGit: (root, args) => reads.run('git', args, { cwd: root }).trim()
  });
  const cacheRoot = path.dirname(repoDir);
  const cachePaths = statePaths(canonical, { cacheRoot, fs: reads.io });
  if (cachePaths.repoDir !== repoDir) {
    throw invalid('Release source cache directory does not match the canonical repository cache');
  }
  const loaded = readReleaseState(canonical, {
    cacheRoot, mode: 'publish', fs: reads.io
  });
  if (loaded === null || !['version-preparing', 'source-ready'].includes(loaded.phase)) {
    throw invalid('Release source recovery requires a retained version operation');
  }
  const paths = versionPaths(repoDir, loaded.releaseId);
  requireVersionDirectories(paths, cacheRoot, reads.io);
  const { state, application } = readVersionApplication(loaded, paths, readDeps);

  if (state.phase === 'source-ready') {
    requireCompletedVersion(state, paths, application, readDeps);
    return state;
  }

  let journal = readVersionJournal(state, paths, application, readDeps);
  if (reconcileOnly && !isCompletedVersionJournal(journal)) {
    throw sourceError('RELEASE_SOURCE_PENDING', 'The recorded version operation requires acting recovery');
  }
  if (!reconcileOnly) {
    const applyDeps = {
      run: resolved.run,
      spawn: resolved.spawn,
      spawnRemote: resolved.spawnRemote,
      fs: resolved.io,
      now: resolved.now,
      randomUUID: resolved.randomUUID,
      withFerryRepoLock: resolved.ferry,
      ferryOptions: resolved.ferryOptions,
      cacheRoot,
      assertPublishWindow: resolved.assertPublishWindow
    };
    if (journal === null) {
      await prepareCommitIntent({
        applicationFile: paths.applicationFile,
        journalFile: paths.journalFile,
        message: `chore: release v${state.version}`
      }, applyDeps);
      journal = readVersionJournal(state, paths, application, readDeps);
      if (journal === null) throw invalid('Version candidate preparation did not retain its journal');
    }
    if (!isCompletedVersionJournal(journal)) {
      await reconcileTarget({ journalFile: paths.journalFile }, applyDeps);
      await reconcileTargetPush({ journalFile: paths.journalFile }, applyDeps);
    }
  }

  const sourceSha = requireCompletedVersion(state, paths, application, readDeps);
  const next = transitionRelease(state, {
    type: 'source-bound',
    at: canonicalTime(resolved.now),
    sourceSha
  }, canonical, { repoDir });
  return writeReleaseState(next, canonical, {
    cacheRoot,
    expectedRevision: state.revision,
    fs: resolved.io
  });
}

module.exports = { prepareVersionIntent, reconcileVersionIntent };
