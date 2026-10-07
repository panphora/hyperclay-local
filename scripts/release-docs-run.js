'use strict';

// The updater's tiny control record. It remembers which attempt each target
// selected and which target journal operation that attempt adopted, which is the
// recovery authority the aggregate result cannot carry: target.json stays the
// authority for live mutations and the result stays a projection that may lag a
// crash. This module validates only the exact docs-run/result schemas and exposes
// no generic JSON transaction writer.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUN_FILE = 'docs-run.json';
const TEMP_PREFIX = 'docs-run';
const DEFAULT_RESULT_FILE = 'result.json';
const ATTEMPTS_DIR = 'attempts';
const SCHEMA = 1;
const TARGET_REPOS = ['hyperclay', 'hyperclay-website'];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RESULT_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
const TEMP_PATTERN = /^docs-run\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const RECORD_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const GROUP_OR_OTHER_WRITE = 0o022;
const SPECIAL_MODE_BITS = 0o7000;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const RESULT_STATES = ['pending', 'complete', 'pending-push', 'conflict', 'missing', 'failed', 'unknown'];
const RUN_FIELDS = ['schema', 'version', 'parentDir', 'runDir', 'resultFile', 'owner', 'targets'];
const OWNER_FIELDS = ['root', 'commonDir', 'key'];
const RUN_TARGET_FIELDS = ['repo', 'repoRoot', 'attemptId', 'journalOperationId'];
const RESULT_FIELDS = ['schema', 'version', 'targets'];
const RESULT_TARGET_FIELDS = [
  'repo', 'paths', 'beforeHead', 'commit', 'state', 'reason', 'journalFile', 'remoteHead', 'verifiedAt'
];

function runError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause !== undefined && cause !== null) error.cause = cause;
  return error;
}

function invalid(message, cause) {
  return runError('DOCS_RUN_INVALID', message, cause);
}

function conflict(message, cause) {
  return runError('DOCS_RUN_CONFLICT', message, cause);
}

function runWriteFailed(message, cause) {
  return runError('DOCS_RUN_WRITE_FAILED', message, cause);
}

function resultInvalid(message, cause) {
  return runError('DOCS_RESULT_INVALID', message, cause);
}

function resultWriteFailed(message, cause) {
  return runError('DOCS_RESULT_WRITE_FAILED', message, cause);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function attemptPaths(runDir, repo, attemptId) {
  const root = path.join(runDir, ATTEMPTS_DIR, repo, attemptId);
  const prepareDir = path.join(root, 'prepare');
  const applyDir = path.join(root, 'apply');
  return {
    root,
    prepareDir,
    preparedFile: path.join(prepareDir, 'prepared.json'),
    applyDir,
    applicationFile: path.join(applyDir, 'application.json'),
    journalFile: path.join(applyDir, 'target.json')
  };
}

function lstatOrNull(target, io) {
  try {
    return io.lstatSync(target);
  } catch (error) {
    const code = error && error.code;
    if (code === 'ENOENT') return null;
    if (code === 'ENOTDIR' || code === 'ELOOP' || code === 'ENAMETOOLONG') {
      throw invalid(`docs run path component is not a real directory: ${target}`, error);
    }
    throw runWriteFailed(`docs run path could not be inspected: ${target}`, error);
  }
}

function canonicalPath(input, io, label) {
  if (typeof input !== 'string' || input.length === 0 || !path.isAbsolute(input)) {
    throw invalid(`${label} must be an absolute path`);
  }
  const requested = path.normalize(input);
  const leaf = lstatOrNull(requested, io);
  if (leaf !== null && leaf.isSymbolicLink()) throw invalid(`${label} must not be a symlink: ${requested}`);
  const suffix = [];
  let current = requested;
  for (;;) {
    const stat = lstatOrNull(current, io);
    if (stat !== null) {
      let real;
      try {
        real = io.realpathSync(current);
      } catch (error) {
        throw invalid(`${label} has no real parent: ${requested}`, error);
      }
      if (io.lstatSync(real).isDirectory()) return path.join(real, ...suffix);
      suffix.unshift(path.basename(current));
      current = path.dirname(current);
      continue;
    }
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) throw invalid(`${label} has no existing parent: ${requested}`);
    current = parent;
  }
}

function requireDirectoryPath(real, io, label) {
  const stat = lstatOrNull(real, io);
  if (stat === null || !stat.isDirectory()) {
    throw invalid(`${label} must be a real directory: ${real}`);
  }
  return real;
}

function isInside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function createRunDir(runDir, io) {
  const missing = [];
  let current = runDir;
  for (;;) {
    const stat = lstatOrNull(current, io);
    if (stat !== null) {
      if (!stat.isDirectory()) throw invalid(`docs run directory is not a real directory: ${current}`);
      break;
    }
    missing.unshift(current);
    current = path.dirname(current);
  }
  for (const dir of missing) {
    try {
      io.mkdirSync(dir, DIRECTORY_MODE);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw runWriteFailed(`docs run directory could not be created: ${dir}`, error);
      }
    }
    const stat = lstatOrNull(dir, io);
    if (stat === null || !stat.isDirectory()) throw invalid(`docs run directory is not a real directory: ${dir}`);
    if ((stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
      throw invalid(`docs run directory is writable by group or other: ${dir}`);
    }
    fsyncDirectory(path.dirname(dir), io);
  }
}

function fsyncDirectory(dir, io) {
  const constants = io.constants || fs.constants;
  const fd = io.openSync(dir, constants.O_RDONLY);
  try {
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
}

function assertRecordStat(stat, label) {
  if (stat.isSymbolicLink()) throw invalid(`${label} must not be a symlink`);
  if (!stat.isFile()) throw invalid(`${label} must be a regular file`);
  if ((stat.mode & SPECIAL_MODE_BITS) !== 0 || (stat.mode & GROUP_OR_OTHER_WRITE) !== 0) {
    throw invalid(`${label} permissions are unsafe`);
  }
}

function readRecordBytes(target, io, label) {
  const stat = lstatOrNull(target, io);
  if (stat === null) return null;
  assertRecordStat(stat, label);
  if (stat.size > MAX_RECORD_BYTES) throw invalid(`${label} exceeds the maximum size`);
  const constants = io.constants || fs.constants;
  let fd;
  try {
    fd = io.openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error && error.code === 'ELOOP') throw invalid(`${label} must not be a symlink`);
    throw runWriteFailed(`${label} could not be opened`, error);
  }
  try {
    const opened = io.fstatSync(fd);
    assertRecordStat(opened, label);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw runWriteFailed(`${label} changed while it was being opened`);
    }
    return io.readFileSync(fd);
  } finally {
    io.closeSync(fd);
  }
}

function exactKeys(value, wanted, label, fail) {
  const keys = Object.keys(value).slice().sort();
  const expected = wanted.slice().sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw fail(`${label} fields do not match schema ${SCHEMA}`);
  }
}

function requireVersion(value, label, fail) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw fail(`${label} must look like 1.2.3`);
  }
}

function requireUuid(value, label, fail) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw fail(`${label} must be a version 4 UUID`);
  }
}

function requireCanonicalPath(value, label, fail) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw fail(`${label} must be a canonical absolute path`);
  }
}

function decodeJson(bytes, label, fail) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw fail(`${label} is not valid JSON`, error);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail(`${label} must hold a record object`);
  }
  return parsed;
}

function validateRunRecord(record, expected) {
  exactKeys(record, RUN_FIELDS, 'docs run record', invalid);
  if (record.schema !== SCHEMA) throw invalid(`docs run record schema must be ${SCHEMA}`);
  requireVersion(record.version, 'docs run record version', invalid);
  if (record.version !== expected.version) {
    throw conflict(`docs run record belongs to version ${record.version}, not ${expected.version}`);
  }
  for (const field of ['parentDir', 'runDir', 'resultFile']) {
    requireCanonicalPath(record[field], `docs run record ${field}`, invalid);
  }
  if (record.parentDir !== expected.parentDir) throw conflict('docs run record belongs to another parent directory');
  if (record.runDir !== expected.runDir) throw conflict('docs run record belongs to another run directory');
  if (record.resultFile !== expected.resultFile) throw conflict('docs run record belongs to another result file');

  const owner = record.owner;
  if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) {
    throw invalid('docs run record owner must be an object');
  }
  exactKeys(owner, OWNER_FIELDS, 'docs run record owner', invalid);
  requireCanonicalPath(owner.root, 'docs run record owner root', invalid);
  requireCanonicalPath(owner.commonDir, 'docs run record owner commonDir', invalid);
  if (typeof owner.key !== 'string' || !HASH_PATTERN.test(owner.key) || owner.key !== sha256(owner.commonDir)) {
    throw invalid('docs run record owner key is not the canonical common directory digest');
  }
  if (owner.root !== expected.owner.root || owner.commonDir !== expected.owner.commonDir || owner.key !== expected.owner.key) {
    throw conflict('docs run record belongs to another desktop repository');
  }

  if (!Array.isArray(record.targets) || record.targets.length !== TARGET_REPOS.length) {
    throw invalid(`docs run record must hold exactly ${TARGET_REPOS.length} targets`);
  }
  record.targets.forEach((slot, index) => {
    const repo = TARGET_REPOS[index];
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      throw invalid(`docs run record target ${repo} must be an object`);
    }
    exactKeys(slot, RUN_TARGET_FIELDS, `docs run record target ${repo}`, invalid);
    if (slot.repo !== repo) throw invalid(`docs run record target ${index} must be ${repo}`);
    requireCanonicalPath(slot.repoRoot, `docs run record target ${repo} repoRoot`, invalid);
    if (slot.repoRoot !== path.join(expected.parentDir, repo)) {
      throw invalid(`docs run record target ${repo} repoRoot is not the exact sibling checkout`);
    }
    if (slot.attemptId === null) {
      if (slot.journalOperationId !== null) {
        throw invalid(`docs run record target ${repo} cannot bind a journal without a selected attempt`);
      }
      return;
    }
    requireUuid(slot.attemptId, `docs run record target ${repo} attemptId`, invalid);
    if (slot.journalOperationId !== null) {
      requireUuid(slot.journalOperationId, `docs run record target ${repo} journalOperationId`, invalid);
    }
  });
  return record;
}

function validateResult(result, expected) {
  exactKeys(result, RESULT_FIELDS, 'docs result', resultInvalid);
  if (result.schema !== SCHEMA) throw resultInvalid(`docs result schema must be ${SCHEMA}`);
  requireVersion(result.version, 'docs result version', resultInvalid);
  if (result.version !== expected.version) throw resultInvalid('docs result version does not match the run');
  if (!Array.isArray(result.targets) || result.targets.length !== TARGET_REPOS.length) {
    throw resultInvalid(`docs result must hold exactly ${TARGET_REPOS.length} targets`);
  }
  result.targets.forEach((entry, index) => {
    const repo = TARGET_REPOS[index];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw resultInvalid(`docs result target ${repo} must be an object`);
    }
    exactKeys(entry, RESULT_TARGET_FIELDS, `docs result target ${repo}`, resultInvalid);
    if (entry.repo !== repo) throw resultInvalid(`docs result target ${index} must be ${repo}`);
    if (!Array.isArray(entry.paths)) throw resultInvalid(`docs result target ${repo} paths must be an array`);
    for (const name of entry.paths) {
      if (typeof name !== 'string' || name.length === 0 || path.isAbsolute(name) ||
          name.split('/').includes('..') || path.normalize(name) !== name) {
        throw resultInvalid(`docs result target ${repo} path is not a plain repository-relative path`);
      }
    }
    if (new Set(entry.paths).size !== entry.paths.length) {
      throw resultInvalid(`docs result target ${repo} paths must be unique`);
    }
    for (const field of ['beforeHead', 'commit', 'remoteHead']) {
      const value = entry[field];
      if (value !== null && (typeof value !== 'string' || !OID_PATTERN.test(value))) {
        throw resultInvalid(`docs result target ${repo} ${field} must be null or a full object id`);
      }
    }
    if (!RESULT_STATES.includes(entry.state)) {
      throw resultInvalid(`docs result target ${repo} state is unknown: ${JSON.stringify(entry.state)}`);
    }
    if (entry.reason !== null) {
      if (typeof entry.reason !== 'object' || Array.isArray(entry.reason)) {
        throw resultInvalid(`docs result target ${repo} reason must be null or an object`);
      }
      exactKeys(entry.reason, ['code', 'message'], `docs result target ${repo} reason`, resultInvalid);
      if (typeof entry.reason.code !== 'string' || entry.reason.code.length === 0) {
        throw resultInvalid(`docs result target ${repo} reason code must be a nonempty string`);
      }
      if (typeof entry.reason.message !== 'string' || entry.reason.message.length === 0) {
        throw resultInvalid(`docs result target ${repo} reason message must be a nonempty string`);
      }
    }
    const slot = expected.run.targets[index];
    if (entry.journalFile !== null) {
      if (typeof entry.journalFile !== 'string' || !path.isAbsolute(entry.journalFile)) {
        throw resultInvalid(`docs result target ${repo} journalFile must be null or absolute`);
      }
      if (slot.attemptId === null ||
          entry.journalFile !== attemptPaths(expected.run.runDir, repo, slot.attemptId).journalFile) {
        throw resultInvalid(`docs result target ${repo} journalFile is not the selected attempt journal`);
      }
    }
    if (entry.verifiedAt !== null) {
      if (typeof entry.verifiedAt !== 'string' || Number.isNaN(Date.parse(entry.verifiedAt))) {
        throw resultInvalid(`docs result target ${repo} verifiedAt must be null or an ISO timestamp`);
      }
    }
    if (entry.state === 'complete') {
      if (entry.commit === null || entry.remoteHead === null || entry.verifiedAt === null || entry.reason !== null) {
        throw resultInvalid(`docs result target ${repo} cannot claim complete without fresh remote proof`);
      }
      return;
    }
    if (entry.verifiedAt !== null) {
      throw resultInvalid(`docs result target ${repo} cannot carry a verification time without completing`);
    }
  });
  return result;
}

function createTemporary(dir, payload, io, randomUUID, fail) {
  const target = path.join(dir, `${TEMP_PREFIX}.${randomUUID()}.tmp`);
  let fd = null;
  let owned = false;
  try {
    fd = io.openSync(target, 'wx', RECORD_MODE);
    owned = true;
    io.writeFileSync(fd, payload);
    if (io.fstatSync(fd).size !== payload.length) {
      throw fail(`temporary control record was written incompletely: ${target}`);
    }
    io.fsyncSync(fd);
    const handle = fd;
    fd = null;
    io.closeSync(handle);
  } catch (error) {
    if (fd !== null) {
      try {
        io.closeSync(fd);
      } catch {
        fd = null;
      }
    }
    if (owned) {
      try {
        io.unlinkSync(target);
      } catch {
        // Only a temporary file this invocation created may be removed.
      }
    }
    throw error;
  }
  return target;
}

function publicationError(error, fail, message) {
  if (error && typeof error.code === 'string' && error.code.startsWith('DOCS_')) return error;
  return fail(message, error);
}

function publishRecord(target, payload, io, expected, randomUUID, fail) {
  const dir = path.dirname(target);
  const label = path.basename(target);
  let temporary;
  try {
    temporary = createTemporary(dir, payload, io, randomUUID, fail);
  } catch (error) {
    throw publicationError(error, fail, `${label} temporary file could not be created`);
  }
  try {
    const current = readRecordBytes(target, io, label);
    if (expected === null) {
      if (current !== null) throw fail(`${label} appeared while this invocation held the lock`);
    } else if (current === null || !current.equals(expected)) {
      throw fail(`${label} changed while this invocation held the lock`);
    }
    io.renameSync(temporary, target);
  } catch (error) {
    try {
      io.unlinkSync(temporary);
    } catch {
      // The temporary file is this invocation's own.
    }
    throw publicationError(error, fail, `${label} could not be published`);
  }
  try {
    fsyncDirectory(dir, io);
  } catch (error) {
    throw fail(`${label} directory could not be flushed: ${dir}`, error);
  }
}

function initializeRunDir(runDir, io) {
  const entries = io.readdirSync(runDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const stat = lstatOrNull(path.join(runDir, name), io);
    if (stat === null) continue;
    if (stat.isFile() && !stat.isSymbolicLink() && TEMP_PATTERN.test(name) &&
        (stat.mode & SPECIAL_MODE_BITS) === 0 && (stat.mode & GROUP_OR_OTHER_WRITE) === 0) {
      continue;
    }
    throw invalid(`docs run directory holds evidence without a run record: ${path.join(runDir, name)}`);
  }
}

function resolveRunOptions(provided, io) {
  requireVersion(provided.version, 'docs run version', invalid);
  if (provided.owner === null || typeof provided.owner !== 'object' || Array.isArray(provided.owner)) {
    throw invalid('docs run owner must be an object');
  }
  exactKeys(provided.owner, OWNER_FIELDS, 'docs run owner', invalid);
  const owner = {
    root: requireDirectoryPath(canonicalPath(provided.owner.root, io, 'docs run owner root'), io, 'docs run owner root'),
    commonDir: requireDirectoryPath(canonicalPath(provided.owner.commonDir, io, 'docs run owner commonDir'), io, 'docs run owner commonDir'),
    key: provided.owner.key
  };
  if (typeof owner.key !== 'string' || !HASH_PATTERN.test(owner.key) || owner.key !== sha256(owner.commonDir)) {
    throw invalid('docs run owner key is not the canonical common directory digest');
  }
  const parentDir = requireDirectoryPath(canonicalPath(provided.parentDir, io, 'docs run parentDir'), io, 'docs run parentDir');
  const runDir = canonicalPath(provided.runDir, io, 'docs run runDir');
  const runDirLeaf = lstatOrNull(runDir, io);
  if (runDirLeaf !== null && !runDirLeaf.isDirectory()) {
    throw invalid(`docs run runDir is not a real directory: ${runDir}`);
  }
  const resultFile = canonicalPath(provided.resultFile, io, 'docs run resultFile');

  for (const [label, root] of [['parentDir', parentDir], ['the desktop checkout', owner.root], ['the desktop common directory', owner.commonDir]]) {
    if (isInside(runDir, root)) throw invalid(`runDir must live outside ${label}: ${runDir}`);
  }
  if (path.dirname(resultFile) !== runDir) {
    throw invalid(`resultFile must be a direct child of runDir: ${resultFile}`);
  }
  const basename = path.basename(resultFile);
  if (!RESULT_BASENAME_PATTERN.test(basename) || basename === RUN_FILE || basename.endsWith('.tmp')) {
    throw invalid(`resultFile must be a safe JSON basename in runDir: ${basename}`);
  }

  return { version: provided.version, parentDir, runDir, resultFile, owner };
}

function readDocsRun(options, deps = {}) {
  const provided = options || {};
  const io = deps.fs === undefined ? fs : deps.fs;
  if (typeof io !== 'object' || io === null) throw invalid('docs run fs must be an object');
  const expected = resolveRunOptions(provided, io);
  if (lstatOrNull(expected.runDir, io) === null) return null;
  const bytes = readRecordBytes(path.join(expected.runDir, RUN_FILE), io, RUN_FILE);
  if (bytes === null) {
    initializeRunDir(expected.runDir, io);
    return null;
  }
  return validateRunRecord(decodeJson(bytes, 'docs run record', invalid), expected);
}

function openDocsRun(options, deps = {}) {
  const provided = options || {};
  const io = deps.fs === undefined ? fs : deps.fs;
  const randomUUID = deps.randomUUID === undefined ? () => crypto.randomUUID() : deps.randomUUID;
  if (typeof io !== 'object' || io === null) throw invalid('docs run fs must be an object');
  if (typeof randomUUID !== 'function') throw invalid('docs run randomUUID must be a function');

  const expected = resolveRunOptions(provided, io);
  const { parentDir, runDir, resultFile, owner } = expected;
  const basename = path.basename(resultFile);
  createRunDir(runDir, io);

  const runFile = path.join(runDir, RUN_FILE);
  const runBytes = readRecordBytes(runFile, io, RUN_FILE);
  let run;
  let runPreimage;
  if (runBytes === null) {
    initializeRunDir(runDir, io);
    run = {
      schema: SCHEMA,
      version: provided.version,
      parentDir,
      runDir,
      resultFile,
      owner,
      targets: TARGET_REPOS.map((repo) => ({
        repo, repoRoot: path.join(parentDir, repo), attemptId: null, journalOperationId: null
      }))
    };
    runPreimage = null;
  } else {
    run = validateRunRecord(decodeJson(runBytes, 'docs run record', invalid), expected);
    runPreimage = runBytes;
  }

  const resultBytes = readRecordBytes(resultFile, io, basename);
  let result = null;
  let resultPreimage = resultBytes;
  if (resultBytes !== null) {
    result = validateResult(decodeJson(resultBytes, 'docs result', resultInvalid), { version: provided.version, run });
  }

  const writeRun = () => {
    const payload = Buffer.from(`${JSON.stringify(run, null, 2)}\n`, 'utf8');
    publishRecord(runFile, payload, io, runPreimage, randomUUID, runWriteFailed);
    runPreimage = payload;
  };

  if (runBytes === null) writeRun();

  const slotFor = (repo) => {
    const index = TARGET_REPOS.indexOf(repo);
    if (index < 0) throw invalid(`docs run target must be one of ${TARGET_REPOS.join(', ')}`);
    return run.targets[index];
  };

  return {
    snapshotRun() {
      return JSON.parse(JSON.stringify(run));
    },
    snapshotResult() {
      return result === null ? null : JSON.parse(JSON.stringify(result));
    },
    selectAttempt(repo, attemptId) {
      const slot = slotFor(repo);
      requireUuid(attemptId, `docs run target ${repo} attemptId`, invalid);
      if (slot.journalOperationId !== null) {
        throw runError('DOCS_RUN_TARGET_MISMATCH',
          `the ${repo} attempt cannot change after its target journal was bound`);
      }
      if (slot.attemptId === attemptId) return false;
      slot.attemptId = attemptId;
      writeRun();
      return true;
    },
    bindJournal(repo, attemptId, operationId) {
      const slot = slotFor(repo);
      requireUuid(operationId, `docs run target ${repo} journalOperationId`, invalid);
      if (slot.attemptId !== attemptId) {
        throw runError('DOCS_RUN_TARGET_MISMATCH',
          `the ${repo} selected attempt changed before its target journal was bound`);
      }
      if (slot.journalOperationId === operationId) return false;
      if (slot.journalOperationId !== null) {
        throw runError('DOCS_RUN_TARGET_MISMATCH', `the ${repo} target journal operation changed`);
      }
      slot.journalOperationId = operationId;
      writeRun();
      return true;
    },
    writeResult(next) {
      validateResult(next, { version: provided.version, run });
      const payload = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
      if (resultPreimage !== null && resultPreimage.equals(payload)) return false;
      publishRecord(resultFile, payload, io, resultPreimage, randomUUID, resultWriteFailed);
      resultPreimage = payload;
      result = JSON.parse(JSON.stringify(next));
      return true;
    }
  };
}

module.exports = { openDocsRun, readDocsRun, attemptPaths, canonicalRunPath: canonicalPath, DEFAULT_RESULT_FILE, RUN_FILE, TARGET_REPOS };
