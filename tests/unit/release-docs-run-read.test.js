// readDocsRun only locates the control record a crashed updater left behind. It
// decodes and validates the existing schema against the requested identity,
// refuses orphan evidence without a run record, and never creates, rewrites,
// deletes or adopts anything. Every fixture here is a real scratch tree under one
// owned temp root built by the real openDocsRun producer, so no Git repository,
// sibling checkout, provider or release path is touched.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDocsRun, readDocsRun, RUN_FILE } = require('../../scripts/release-docs-run');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const VERSION = '1.29.0';
const TMP_BASE = fs.realpathSync(os.tmpdir());
const ROOT = fs.mkdtempSync(path.join(TMP_BASE, 'hc-docs-run-read-'));
const OWNER_ROOT = path.join(ROOT, 'desktop');
const COMMON_DIR = path.join(OWNER_ROOT, '.git');
const PARENT_DIR = path.join(ROOT, 'siblings');
const ALT_PARENT = path.join(ROOT, 'alt-siblings');
const OTHER_ROOT = path.join(ROOT, 'other-desktop');
const OTHER_COMMON = path.join(OTHER_ROOT, '.git');
const RUNS = path.join(ROOT, 'runs');
const SENTINEL = path.join(ROOT, 'orphan-sentinel');
const SENTINEL_BYTES = 'untouched orphan sentinel\n';
const RESULT_BYTES = '{ not the aggregate\n';

for (const dir of [OWNER_ROOT, COMMON_DIR, PARENT_DIR, ALT_PARENT, OTHER_ROOT, OTHER_COMMON, RUNS]) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
fs.writeFileSync(SENTINEL, SENTINEL_BYTES, { mode: 0o600 });

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

let runSeq = 0;

function newRunDir() {
  runSeq += 1;
  return path.join(RUNS, `run-${runSeq}`);
}

function baseOptions(runDir) {
  return {
    version: VERSION,
    parentDir: PARENT_DIR,
    runDir,
    resultFile: path.join(runDir, 'result.json'),
    owner: { root: OWNER_ROOT, commonDir: COMMON_DIR, key: sha256(COMMON_DIR) }
  };
}

function uuidFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

function produceRun(runDir) {
  return openDocsRun(baseOptions(runDir), { fs, randomUUID: uuidFactory() });
}

function readOnlyFs() {
  const reads = new Set(['lstatSync', 'realpathSync', 'readdirSync', 'fstatSync', 'readFileSync', 'closeSync']);
  return new Proxy(fs, {
    get(target, name) {
      if (name === 'constants') return target.constants;
      if (name === 'openSync') {
        return (file, flags, ...rest) => {
          expect(typeof flags).toBe('number');
          expect(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT
            | fs.constants.O_TRUNC | fs.constants.O_APPEND)).toBe(0);
          return fs.openSync(file, flags, ...rest);
        };
      }
      if (!reads.has(name)) throw new Error(`readDocsRun attempted unsupported filesystem access: ${String(name)}`);
      return target[name].bind(target);
    }
  });
}

function interceptOpen(base, log) {
  return new Proxy(base, {
    get(inner, name) {
      if (name === 'openSync') {
        return (file, flags, ...rest) => {
          log.push(file);
          return inner.openSync(file, flags, ...rest);
        };
      }
      return inner[name];
    }
  });
}

function failingOpenFs(targetPath, error) {
  const base = readOnlyFs();
  return new Proxy(base, {
    get(inner, name) {
      if (name === 'openSync') {
        return (file, flags, ...rest) => {
          if (file === targetPath) throw error;
          return inner.openSync(file, flags, ...rest);
        };
      }
      return inner[name];
    }
  });
}

function readRun(options, deps = {}) {
  return readDocsRun(options, { fs: deps.fs === undefined ? readOnlyFs() : deps.fs });
}

function inventory(dir) {
  const found = [];
  const walk = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        found.push(`${relative} -> ${fs.readlinkSync(full)}`);
        continue;
      }
      if (stat.isDirectory()) {
        found.push(`${relative}/:${(stat.mode & 0o777).toString(8)}`);
        walk(full);
        continue;
      }
      found.push(`${relative}:${sha256(fs.readFileSync(full))}:${(stat.mode & 0o777).toString(8)}`);
    }
  };
  walk(dir);
  return found;
}

function captureError(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describePosix('docs run read-only record', () => {
  testPosix('returns null only for a missing run and its permitted safe temporary files', () => {
    const absent = path.join(RUNS, 'absent', VERSION, 'docs');
    expect(readRun(baseOptions(absent))).toBeNull();
    expect(fs.existsSync(path.join(RUNS, 'absent'))).toBe(false);
    expect(fs.existsSync(absent)).toBe(false);

    const empty = newRunDir();
    fs.mkdirSync(empty, { mode: 0o700 });
    expect(readRun(baseOptions(empty))).toBeNull();
    expect(inventory(empty)).toEqual([]);

    const retained = newRunDir();
    fs.mkdirSync(retained, { mode: 0o700 });
    const temporary = path.join(retained, 'docs-run.33333333-3333-4333-8333-333333333333.tmp');
    fs.writeFileSync(temporary, 'interrupted publish bytes\n', { mode: 0o600 });
    const before = inventory(retained);
    expect(readRun(baseOptions(retained))).toBeNull();
    expect(inventory(retained)).toEqual(before);
    expect(fs.readFileSync(temporary, 'utf8')).toBe('interrupted publish bytes\n');
    for (const runDir of [empty, retained]) {
      expect(fs.existsSync(path.join(runDir, RUN_FILE))).toBe(false);
      expect(fs.existsSync(path.join(runDir, 'result.json'))).toBe(false);
    }
  });

  testPosix('reopens the real selected attempt and journal operation without writing', () => {
    const runDir = newRunDir();
    const handle = produceRun(runDir);
    const attemptId = '11111111-1111-4111-8111-111111111111';
    const operationId = '22222222-2222-4222-8222-222222222222';
    expect(handle.selectAttempt('hyperclay', attemptId)).toBe(true);
    expect(handle.bindJournal('hyperclay', attemptId, operationId)).toBe(true);
    const expected = handle.snapshotRun();

    const before = inventory(runDir);
    const record = readRun(baseOptions(runDir));
    expect(record).toEqual(expected);
    expect(record.targets[0].attemptId).toBe(attemptId);
    expect(record.targets[0].journalOperationId).toBe(operationId);
    expect(record.targets[1].attemptId).toBeNull();
    expect(inventory(runDir)).toEqual(before);

    record.targets[0].attemptId = null;
    record.targets[0].journalOperationId = null;
    record.version = '1.30.0';
    expect(readRun(baseOptions(runDir))).toEqual(expected);
    expect(inventory(runDir)).toEqual(before);
  });

  testPosix('refuses orphan evidence that has no run record and preserves every byte', () => {
    const rows = [
      {
        name: 'attempts directory holding a sentinel',
        build(runDir) {
          const attempts = path.join(runDir, 'attempts');
          fs.mkdirSync(attempts, { mode: 0o700 });
          fs.writeFileSync(path.join(attempts, 'sentinel'), 'orphan attempt bytes\n', { mode: 0o600 });
        }
      },
      {
        name: 'result record without a run record',
        build(runDir) {
          fs.writeFileSync(path.join(runDir, 'result.json'), RESULT_BYTES, { mode: 0o600 });
        }
      },
      {
        name: 'foreign file',
        build(runDir) {
          fs.writeFileSync(path.join(runDir, 'notes.txt'), 'foreign bytes\n', { mode: 0o600 });
        }
      },
      {
        name: 'unsupported temporary name',
        build(runDir) {
          fs.writeFileSync(path.join(runDir, 'docs-run.11111111-1111-3111-8111-111111111111.tmp'),
            'unsupported temporary bytes\n', { mode: 0o600 });
        }
      },
      {
        name: 'symlink using an otherwise valid temporary name',
        build(runDir) {
          fs.symlinkSync(SENTINEL, path.join(runDir, 'docs-run.11111111-1111-4111-8111-111111111111.tmp'));
        }
      }
    ];

    for (const row of rows) {
      const runDir = newRunDir();
      fs.mkdirSync(runDir, { mode: 0o700 });
      row.build(runDir);
      const before = inventory(runDir);
      const error = captureError(() => readRun(baseOptions(runDir)));
      expect({ row: row.name, code: error === null ? null : error.code })
        .toEqual({ row: row.name, code: 'DOCS_RUN_INVALID' });
      expect(inventory(runDir)).toEqual(before);
      expect(fs.existsSync(path.join(runDir, RUN_FILE))).toBe(false);
      expect(fs.lstatSync(SENTINEL).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(SENTINEL, 'utf8')).toBe(SENTINEL_BYTES);
    }
  });

  testPosix('refuses another identity and malformed record bytes using the existing validators', () => {
    const runDir = newRunDir();
    produceRun(runDir);
    const before = inventory(runDir);

    const rows = [
      { name: 'mismatched version', options: { ...baseOptions(runDir), version: '1.30.0' } },
      {
        name: 'another valid owner',
        options: {
          ...baseOptions(runDir),
          owner: { root: OTHER_ROOT, commonDir: OTHER_COMMON, key: sha256(OTHER_COMMON) }
        }
      },
      { name: 'alternate sibling parent', options: { ...baseOptions(runDir), parentDir: ALT_PARENT } },
      { name: 'alternate result basename', options: { ...baseOptions(runDir), resultFile: path.join(runDir, 'outcome.json') } }
    ];

    for (const row of rows) {
      const error = captureError(() => readRun(row.options));
      expect({ row: row.name, code: error === null ? null : error.code })
        .toEqual({ row: row.name, code: 'DOCS_RUN_CONFLICT' });
    }
    expect(inventory(runDir)).toEqual(before);

    const runFile = path.join(runDir, RUN_FILE);
    const original = fs.readFileSync(runFile);
    const malformed = [
      { name: 'malformed JSON', bytes: '{ not json\n' },
      { name: 'missing schema fields', bytes: '{"schema":1}\n' }
    ];
    for (const row of malformed) {
      fs.writeFileSync(runFile, row.bytes);
      const written = inventory(runDir);
      const error = captureError(() => readRun(baseOptions(runDir)));
      expect({ row: row.name, code: error === null ? null : error.code })
        .toEqual({ row: row.name, code: 'DOCS_RUN_INVALID' });
      expect(inventory(runDir)).toEqual(written);
    }
    fs.writeFileSync(runFile, original);
  });

  testPosix('never reads aggregate bytes and refuses a symlinked result path', () => {
    const runDir = newRunDir();
    const expected = produceRun(runDir).snapshotRun();
    const resultFile = path.join(runDir, 'result.json');
    fs.writeFileSync(resultFile, RESULT_BYTES, { mode: 0o600 });

    const opened = [];
    const record = readRun(baseOptions(runDir), { fs: interceptOpen(readOnlyFs(), opened) });
    expect(record).toEqual(expected);
    expect(opened).toEqual([path.join(runDir, RUN_FILE)]);
    expect(fs.readFileSync(resultFile, 'utf8')).toBe(RESULT_BYTES);

    const symlinkRunDir = newRunDir();
    produceRun(symlinkRunDir);
    const outside = path.join(ROOT, 'outside-result.json');
    fs.writeFileSync(outside, '{}\n', { mode: 0o600 });
    const link = path.join(symlinkRunDir, 'result.json');
    fs.symlinkSync(outside, link);

    const symlinkOpened = [];
    const error = captureError(() => readRun(baseOptions(symlinkRunDir), { fs: interceptOpen(readOnlyFs(), symlinkOpened) }));
    expect(error === null ? null : error.code).toBe('DOCS_RUN_INVALID');
    expect(symlinkOpened).toEqual([]);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outside, 'utf8')).toBe('{}\n');
  });

  testPosix('keeps operational failures typed instead of reporting absence', () => {
    const runDir = newRunDir();
    produceRun(runDir);
    const runFile = path.join(runDir, RUN_FILE);
    const denied = Object.assign(new Error('injected EACCES at the run record'), { code: 'EACCES' });
    const error = captureError(() => readRun(baseOptions(runDir), { fs: failingOpenFs(runFile, denied) }));
    expect(error).not.toBeNull();
    expect(error.code).toBe('DOCS_RUN_WRITE_FAILED');
    expect(error.cause).toBe(denied);
    expect(fs.existsSync(runFile)).toBe(true);

    const unsafeRunDir = newRunDir();
    produceRun(unsafeRunDir);
    const unsafeRunFile = path.join(unsafeRunDir, RUN_FILE);
    const unsafeBytes = fs.readFileSync(unsafeRunFile);
    fs.chmodSync(unsafeRunFile, 0o666);
    const unsafeError = captureError(() => readRun(baseOptions(unsafeRunDir)));
    expect(unsafeError === null ? null : unsafeError.code).toBe('DOCS_RUN_INVALID');
    expect(fs.readFileSync(unsafeRunFile)).toEqual(unsafeBytes);
    expect(fs.lstatSync(unsafeRunFile).mode & 0o777).toBe(0o666);

    const symlinkRunDir = newRunDir();
    fs.mkdirSync(symlinkRunDir, { mode: 0o700 });
    const outsideRecord = path.join(ROOT, 'outside-record.json');
    fs.writeFileSync(outsideRecord, '{}\n', { mode: 0o600 });
    fs.symlinkSync(outsideRecord, path.join(symlinkRunDir, RUN_FILE));
    const symlinkError = captureError(() => readRun(baseOptions(symlinkRunDir)));
    expect(symlinkError === null ? null : symlinkError.code).toBe('DOCS_RUN_INVALID');
    expect(fs.readFileSync(outsideRecord, 'utf8')).toBe('{}\n');
  });
});
