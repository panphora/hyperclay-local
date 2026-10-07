// Status and historical evidence readers share one silent, read-only adapter, so
// these tests pin the exact Git argv it will spawn, the child environment it
// builds, and the fact that it neither echoes a captured stream nor writes into
// the repository it reads. Every Git fixture is a scratch repo under one owned
// temp root, and the hostile Git configuration lives under a scratch HOME, never
// the operator's own config.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLocalGitReader, readBoundedOrdinaryFile } = require('../../scripts/release-local-read');
const { describePosix, testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const TMP_BASE = fs.realpathSync(os.tmpdir());
const OWNER = fs.mkdtempSync(path.join(TMP_BASE, 'hc-release-local-read-'));

const FAILURE_CODE = 'LOCAL_EVIDENCE_READ_FAILED';
const FAILURE_MESSAGE = 'Local evidence read failed';
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const GIT_GLOBAL_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0'];

const OID_A = '0123456789abcdef0123456789abcdef01234567';
const OID_B = 'fedcba9876543210fedcba9876543210fedcba98';
const ZERO_OID = '0'.repeat(40);

const NO_INDEX_FORM = ['ls-files', '--stage', '-z'];
const NO_INDEX_LISTING = `100644 ${OID_A} 0\tdocs/a.txt\0`;

const INDEX_FIXTURE = path.join(OWNER, 'index-fixture');
fs.writeFileSync(INDEX_FIXTURE, 'fixture index bytes\n');

afterAll(() => {
  fs.rmSync(OWNER, { recursive: true, force: true });
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function recordingSpawn(result) {
  const calls = [];
  const spawnSync = (file, args, options) => {
    calls.push({ file, args, options });
    return typeof result === 'function' ? result(file, args, options) : result;
  };
  return { calls, spawnSync };
}

function statusResult(status, stdout = '', stderr = '') {
  return { status, signal: null, stdout, stderr };
}

function failureOf(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a LOCAL_EVIDENCE_READ_FAILED failure');
}

const ALLOWED_FORMS = [
  { label: 'rev-parse --show-toplevel', args: ['rev-parse', '--show-toplevel'], stdout: '/scratch/repo\n' },
  { label: 'rev-parse --git-common-dir', args: ['rev-parse', '--git-common-dir'], stdout: '.git\n' },
  { label: 'rev-parse --show-object-format', args: ['rev-parse', '--show-object-format'], stdout: 'sha1\n' },
  { label: 'rev-parse --is-shallow-repository', args: ['rev-parse', '--is-shallow-repository'], stdout: 'false\n' },
  { label: 'rev-parse HEAD', args: ['rev-parse', 'HEAD'], stdout: `${OID_A}\n` },
  { label: 'rev-parse --verify commit', args: ['rev-parse', '--verify', `${OID_A}^{commit}`], stdout: `${OID_A}\n` },
  { label: 'rev-parse --verify tree', args: ['rev-parse', '--verify', `${OID_B}^{tree}`], stdout: `${OID_B}\n` },
  { label: 'rev-parse peeled tree', args: ['rev-parse', `${OID_B}^{tree}`], stdout: `${OID_B}\n` },
  { label: 'symbolic-ref -q HEAD', args: ['symbolic-ref', '-q', 'HEAD'], stdout: 'refs/heads/main\n' },
  {
    label: 'symbolic-ref --quiet --short HEAD',
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    stdout: 'main\n'
  },
  { label: 'remote get-url origin', args: ['remote', 'get-url', 'origin'], stdout: 'https://example.invalid/repo.git\n' },
  {
    label: 'remote get-url --push --all origin',
    args: ['remote', 'get-url', '--push', '--all', 'origin'],
    stdout: 'https://example.invalid/repo.git\n'
  },
  { label: 'rev-list --parents -n 1', args: ['rev-list', '--parents', '-n', '1', OID_A], stdout: `${OID_A}\n` },
  {
    label: 'ls-tree one document path',
    args: ['ls-tree', '-z', OID_A, '--', 'vault/DOCS/15 Hyperclay Local App.md'],
    stdout: `100644 blob ${OID_B}\tvault/DOCS/15 Hyperclay Local App.md\0`
  },
  {
    label: 'ls-tree a directory and a file',
    args: ['ls-tree', '-z', OID_A, '--', 'vault/DOCS/', 'docs/a.txt'],
    stdout: `100644 blob ${OID_B}\tdocs/a.txt\0`
  },
  {
    label: 'ls-tree -r --full-tree',
    args: ['ls-tree', '-r', '--full-tree', '-z', OID_A],
    stdout: `100644 blob ${OID_B}\tdocs/a.txt\0`
  },
  { label: 'cat-file blob', args: ['cat-file', 'blob', OID_A], stdout: 'hello\n' },
  { label: 'merge-base --is-ancestor', args: ['merge-base', '--is-ancestor', OID_A, OID_B], stdout: '' },
  {
    label: 'diff --name-only -z',
    args: ['diff', '--name-only', '-z', OID_A, OID_B],
    stdout: 'docs/a.txt\0',
    spawned: ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', OID_A, OID_B]
  },
  {
    label: 'diff --name-only -z already normalized',
    args: ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', OID_A, OID_B],
    stdout: 'docs/a.txt\0'
  },
  {
    label: 'diff --no-index',
    args: [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--',
      'before/docs/a.txt', 'after/docs/a.txt'
    ],
    stdout: ''
  }
];

const REFUSED_FORMS = [
  { label: 'a different command', args: ['push', 'origin', 'main'] },
  { label: 'rev-parse --verify HEAD', args: ['rev-parse', '--verify', 'HEAD^{commit}'] },
  { label: 'rev-parse --verify a short oid', args: ['rev-parse', '--verify', `${OID_A.slice(0, 8)}^{commit}`] },
  { label: 'rev-parse --verify a revision expression', args: ['rev-parse', '--verify', 'main~1^{commit}'] },
  { label: 'rev-parse an uppercase oid', args: ['rev-parse', '--verify', `${OID_A.toUpperCase()}^{commit}`] },
  { label: 'rev-parse a bare oid', args: ['rev-parse', OID_A] },
  { label: 'rev-parse --short HEAD', args: ['rev-parse', '--short', 'HEAD'] },
  { label: 'rev-parse --abbrev-ref HEAD', args: ['rev-parse', '--abbrev-ref', 'HEAD'] },
  { label: 'rev-parse with a trailing option', args: ['rev-parse', '--show-toplevel', '--quiet'] },
  { label: 'rev-parse with a bare trailing word', args: ['rev-parse', 'HEAD', 'extra'] },
  { label: 'rev-parse a blob peel', args: ['rev-parse', `${OID_A}^{blob}`] },
  { label: 'symbolic-ref HEAD without -q', args: ['symbolic-ref', 'HEAD'] },
  { label: 'symbolic-ref with a trailing word', args: ['symbolic-ref', '-q', 'HEAD', 'extra'] },
  { label: 'remote get-url upstream', args: ['remote', 'get-url', 'upstream'] },
  { label: 'remote add', args: ['remote', 'add', 'origin', 'https://example.invalid/repo.git'] },
  { label: 'remote set-url', args: ['remote', 'set-url', 'origin', 'https://example.invalid/repo.git'] },
  { label: 'remote prune', args: ['remote', 'prune', 'origin'] },
  { label: 'rev-list --parents -n 2', args: ['rev-list', '--parents', '-n', '2', OID_A] },
  { label: 'rev-list --all', args: ['rev-list', '--all'] },
  { label: 'rev-list --first-parent HEAD', args: ['rev-list', '--first-parent', 'HEAD'] },
  { label: 'ls-tree without a path separator', args: ['ls-tree', '-z', OID_A] },
  { label: 'ls-tree with no paths', args: ['ls-tree', '-z', OID_A, '--'] },
  { label: 'ls-tree with an absolute path', args: ['ls-tree', '-z', OID_A, '--', '/etc/passwd'] },
  { label: 'ls-tree with a parent component', args: ['ls-tree', '-z', OID_A, '--', 'vault/../etc/passwd'] },
  { label: 'ls-tree with a dot component', args: ['ls-tree', '-z', OID_A, '--', 'vault/./DOCS'] },
  { label: 'ls-tree with an empty component', args: ['ls-tree', '-z', OID_A, '--', 'vault//DOCS'] },
  { label: 'ls-tree with a doubled trailing slash', args: ['ls-tree', '-z', OID_A, '--', 'vault/DOCS//'] },
  { label: 'ls-tree with a backslash', args: ['ls-tree', '-z', OID_A, '--', 'vault\\DOCS'] },
  { label: 'ls-tree with a NUL byte', args: ['ls-tree', '-z', OID_A, '--', 'vault/\u0000DOCS'] },
  { label: 'ls-tree with a control character', args: ['ls-tree', '-z', OID_A, '--', 'vault/D\u0001OCS'] },
  { label: 'ls-tree an option before the separator', args: ['ls-tree', '-z', OID_A, '--full-name', '--', 'docs/a.txt'] },
  { label: 'ls-tree -r without a full tree', args: ['ls-tree', '-r', '-z', OID_A] },
  { label: 'ls-tree -r with a path list', args: ['ls-tree', '-r', '--full-tree', '-z', OID_A, '--', 'docs/a.txt'] },
  { label: 'cat-file -p', args: ['cat-file', '-p', OID_A] },
  { label: 'cat-file --batch', args: ['cat-file', '--batch', OID_A] },
  { label: 'cat-file with a filter', args: ['cat-file', 'blob', OID_A, '--filters'] },
  { label: 'cat-file a tree', args: ['cat-file', 'tree', OID_A] },
  { label: 'ls-files without a private index', args: NO_INDEX_FORM, index: null },
  { label: 'ls-files with extra flags', args: ['ls-files', '--stage', '-z', '--error-unmatch'] },
  { label: 'ls-files --others', args: ['ls-files', '--others'] },
  { label: 'merge-base without --is-ancestor', args: ['merge-base', OID_A, OID_B] },
  { label: 'merge-base with a revision', args: ['merge-base', '--is-ancestor', 'HEAD', OID_B] },
  { label: 'merge-base with one oid', args: ['merge-base', '--is-ancestor', OID_A] },
  { label: 'diff --name-only with one oid', args: ['diff', '--name-only', '-z', OID_A] },
  { label: 'diff --name-only with an output file', args: ['diff', '--name-only', '-z', OID_A, OID_B, '--output=x'] },
  { label: 'diff --cached', args: ['diff', '--cached', '--name-only', '-z'] },
  { label: 'diff --stat', args: ['diff', '--stat', OID_A, OID_B] },
  {
    label: 'diff --no-index with different sides',
    args: [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--',
      'before/docs/a.txt', 'after/docs/b.txt'
    ]
  },
  {
    label: 'diff --no-index with absolute paths',
    args: [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--',
      '/tmp/before/a.txt', '/tmp/after/a.txt'
    ]
  },
  {
    label: 'diff --no-index without the safe flags',
    args: ['diff', '--no-index', '--binary', '--no-prefix', '--', 'before/docs/a.txt', 'after/docs/a.txt']
  },
  { label: 'an empty argv', args: [] },
  { label: 'a non array argv', args: 'rev-parse HEAD' },
  { label: 'a null argv', args: null }
];

describe('bounded silent git argv', () => {
  for (const form of ALLOWED_FORMS) {
    test(`spawns ${form.label} behind the bounded silent prefix`, () => {
      const recorder = recordingSpawn(statusResult(0, form.stdout));
      const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: { PATH: '/usr/bin', HOME: '/scratch' } });
      const text = reader.run('git', form.args, { cwd: OWNER });
      expect(text).toBe(form.stdout);
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].file).toBe('git');
      expect(recorder.calls[0].args).toEqual(GIT_GLOBAL_ARGS.concat(form.spawned || form.args));
    });

    test(`types a nonzero ${form.label} as a clean miss with the same argv`, () => {
      const recorder = recordingSpawn(statusResult(1, form.stdout, 'ignored diagnostic'));
      const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: { PATH: '/usr/bin', HOME: '/scratch' } });
      const error = failureOf(() => reader.run('git', form.args, { cwd: OWNER }));
      expect(error.code).toBe(FAILURE_CODE);
      expect(error.message).toBe(FAILURE_MESSAGE);
      expect(error.status).toBe(1);
      expect(error.signal).toBeNull();
      expect(error.stdout).toBe(form.stdout);
      expect(error.stderr).toBe('ignored diagnostic');
      expect('cause' in error).toBe(false);
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].args).toEqual(GIT_GLOBAL_ARGS.concat(form.spawned || form.args));
    });
  }

  test('trims the text readGit returns', () => {
    const recorder = recordingSpawn(statusResult(0, 'refs/heads/main\n'));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(reader.readGit(OWNER, ['symbolic-ref', '-q', 'HEAD'])).toBe('refs/heads/main');
  });

  test('returns a Buffer when the caller asks for raw bytes', () => {
    const payload = Buffer.from([0, 1, 2, 255, 254]);
    const recorder = recordingSpawn({ status: 0, signal: null, stdout: payload, stderr: '' });
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const bytes = reader.run('git', ['cat-file', 'blob', OID_A], { cwd: OWNER, encoding: null });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.equals(payload)).toBe(true);
    expect(recorder.calls[0].options.encoding).toBeNull();
  });

  test('returns the captured result from spawn even when it is nonzero', () => {
    const captured = statusResult(1, 'patch bytes', '');
    const recorder = recordingSpawn(captured);
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const args = [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--',
      'before/docs/a.txt', 'after/docs/a.txt'
    ];
    expect(reader.spawn('git', args, { cwd: OWNER, encoding: null })).toBe(captured);
    expect(recorder.calls).toHaveLength(1);
  });

  for (const form of REFUSED_FORMS) {
    test(`refuses ${form.label} before spawning`, () => {
      const recorder = recordingSpawn(statusResult(0, ''));
      const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
      const options = { cwd: OWNER };
      if (form.index === undefined) options.env = { GIT_INDEX_FILE: INDEX_FIXTURE };
      const error = failureOf(() => reader.run('git', form.args, options));
      expect(error.code).toBe(FAILURE_CODE);
      expect(error.message).toBe(FAILURE_MESSAGE);
      expect('cause' in error).toBe(false);
      const spawnError = failureOf(() => reader.spawn('git', form.args, options));
      expect(spawnError.code).toBe(FAILURE_CODE);
      expect(recorder.calls).toHaveLength(0);
    });
  }

  test('refuses a command other than git', () => {
    const recorder = recordingSpawn(statusResult(0, ''));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    for (const command of ['sh', 'git2', 'GIT', '', null, undefined, 7]) {
      expect(failureOf(() => reader.run(command, ['rev-parse', 'HEAD'], { cwd: OWNER })).code).toBe(FAILURE_CODE);
      expect(failureOf(() => reader.spawn(command, ['rev-parse', 'HEAD'], { cwd: OWNER })).code).toBe(FAILURE_CODE);
    }
    expect(recorder.calls).toHaveLength(0);
  });

  test('refuses a reader without a spawnSync function', () => {
    expect(failureOf(() => createLocalGitReader({ spawnSync: 'nope' })).code).toBe(FAILURE_CODE);
  });

  test('exposes exactly the read, run and spawn calls', () => {
    const reader = createLocalGitReader({ spawnSync: recordingSpawn(statusResult(0, '')).spawnSync });
    expect(Object.keys(reader).sort()).toEqual(['readGit', 'run', 'spawn']);
    expect(typeof reader.readGit).toBe('function');
    expect(typeof reader.run).toBe('function');
    expect(typeof reader.spawn).toBe('function');
  });
});

describe('source ref read shapes', () => {
  const format = '--format=%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(refname)';
  const tagRef = 'refs/tags/v1.2.3';
  const args = ['for-each-ref', '--count=2', format, tagRef];

  test('forwards the exact bounded source tag read with the safe environment', () => {
    const recorder = recordingSpawn(statusResult(0, ''));
    const reader = createLocalGitReader({
      spawnSync: recorder.spawnSync,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/scratch/home',
        GIT_DIR: '/poisoned/git-dir',
        GIT_CONFIG_GLOBAL: '/poisoned/gitconfig'
      }
    });
    expect(reader.run('git', args, { cwd: OWNER })).toBe('');
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].file).toBe('git');
    expect(recorder.calls[0].args).toEqual(GIT_GLOBAL_ARGS.concat(args));
    expect(recorder.calls[0].options.env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/scratch/home',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null'
    });
  });

  test.each([
    ['a malformed count', ['for-each-ref', '--count=1', format, tagRef]],
    ['a malformed format', ['for-each-ref', '--count=2', '--format=%(objectname)', tagRef]],
    ['a different namespace', ['for-each-ref', '--count=2', format, 'refs/heads/v1.2.3']],
    ['a leading zero version', ['for-each-ref', '--count=2', format, 'refs/tags/v01.2.3']],
    ['an over-limit version component', ['for-each-ref', '--count=2', format, 'refs/tags/v1.65536.3']],
    ['an extra argument', args.concat('--sort=refname')],
    ['an object id instead of a tag ref', ['for-each-ref', '--count=2', format, OID_A]],
    ['a tag body read by mutable ref', ['cat-file', 'tag', tagRef]]
  ])('refuses %s before spawning', (label, refusedArgs) => {
    const recorder = recordingSpawn(statusResult(0, ''));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(failureOf(() => reader.run('git', refusedArgs, { cwd: OWNER })).code).toBe(FAILURE_CODE);
    expect(failureOf(() => reader.spawn('git', refusedArgs, { cwd: OWNER })).code).toBe(FAILURE_CODE);
    expect(recorder.calls).toHaveLength(0);
  });

  test('reads an immutable tag header with the requested small bound', () => {
    const body = `object ${OID_B}\ntype commit\ntag v1.2.3\n\nfixture\n`;
    const recorder = recordingSpawn(statusResult(0, body));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const args = ['cat-file', 'tag', OID_A];
    expect(reader.run('git', args, {
      cwd: OWNER, encoding: 'utf8', maxBuffer: 256 * 1024
    })).toBe(body);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].args).toEqual(GIT_GLOBAL_ARGS.concat(args));
    expect(recorder.calls[0].options.maxBuffer).toBe(256 * 1024);
    expect(recorder.calls[0].options.shell).toBe(false);
    expect(recorder.calls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(recorder.calls[0].options.env.GIT_NO_LAZY_FETCH).toBe('1');
    expect(recorder.calls[0].options.env.GIT_NO_REPLACE_OBJECTS).toBe('1');
    for (const refused of [
      ['cat-file', 'tag', OID_A.slice(0, 8)],
      ['cat-file', 'tag', `${OID_A}^{}`],
      ['cat-file', 'tag', OID_A, '--filters'],
      ['cat-file', '-p', OID_A]
    ]) {
      expect(failureOf(() => reader.run('git', refused, { cwd: OWNER })).code).toBe(FAILURE_CODE);
    }
    expect(recorder.calls).toHaveLength(1);
  });
});

describe('bounded silent child environment', () => {
  const POISON = {
    PATH: '/usr/bin:/bin',
    HOME: '/scratch/home',
    USER: 7,
    LOGNAME: null,
    LANG: 'en_US.UTF-8',
    LC_ALL: '',
    LC_CTYPE: 'UTF-8',
    TZ: 'UTC',
    TMPDIR: '/scratch/tmp',
    TEMP: '/scratch/tmp',
    TMP: '/scratch/tmp',
    SystemRoot: 'C:\\Windows',
    GIT_DIR: '/poisoned/git-dir',
    GIT_WORK_TREE: '/poisoned/work-tree',
    GIT_INDEX_FILE: '/poisoned/index',
    GIT_CONFIG_GLOBAL: '/poisoned/gitconfig',
    GIT_CONFIG_SYSTEM: '/poisoned/system-gitconfig',
    GIT_OBJECT_DIRECTORY: '/poisoned/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/poisoned/alternates',
    GIT_CEILING_DIRECTORIES: '/poisoned/ceiling',
    GIT_SSH_COMMAND: 'sh -c touch /tmp/poisoned',
    GIT_ASKPASS: '/poisoned/askpass',
    GIT_PAGER: 'sh -c touch /tmp/poisoned',
    NODE_OPTIONS: '--require /poisoned',
    LD_PRELOAD: '/poisoned/preload.so',
    BASH_ENV: '/poisoned/env'
  };

  const EXPECTED_ENV = {
    PATH: '/usr/bin:/bin',
    HOME: '/scratch/home',
    LANG: 'en_US.UTF-8',
    LC_ALL: '',
    LC_CTYPE: 'UTF-8',
    TZ: 'UTC',
    TMPDIR: '/scratch/tmp',
    TEMP: '/scratch/tmp',
    TMP: '/scratch/tmp',
    SystemRoot: 'C:\\Windows',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null'
  };

  test('builds a clean environment from a poisoned inherited env', () => {
    const recorder = recordingSpawn(statusResult(0, `${OID_A}\n`));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: POISON });
    reader.run('git', ['rev-parse', 'HEAD'], { cwd: OWNER });
    expect(recorder.calls[0].options.env).toEqual(EXPECTED_ENV);
    expect(Object.keys(recorder.calls[0].options.env).filter((name) => name.startsWith('GIT_'))).toEqual([
      'GIT_OPTIONAL_LOCKS',
      'GIT_NO_LAZY_FETCH',
      'GIT_NO_REPLACE_OBJECTS',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_CONFIG_GLOBAL'
    ]);
  });

  test('falls back to an empty base environment for a non object env', () => {
    const recorder = recordingSpawn(statusResult(0, `${OID_A}\n`));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: 'poisoned' });
    reader.run('git', ['rev-parse', 'HEAD'], { cwd: OWNER });
    expect(recorder.calls[0].options.env).toEqual({
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null'
    });
  });

  test('ignores every supplied env value except a deliberate private index', () => {
    const indexFile = INDEX_FIXTURE;
    const recorder = recordingSpawn(statusResult(0, NO_INDEX_LISTING));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: POISON });
    reader.run('git', NO_INDEX_FORM, {
      cwd: OWNER,
      env: {
        GIT_INDEX_FILE: indexFile,
        GIT_DIR: '/poisoned/git-dir',
        GIT_WORK_TREE: '/poisoned/work-tree',
        GIT_CONFIG_GLOBAL: '/poisoned/gitconfig',
        PATH: '/poisoned/bin'
      }
    });
    expect(recorder.calls[0].options.env).toEqual(Object.assign({}, EXPECTED_ENV, { GIT_INDEX_FILE: indexFile }));
  });

  test('forces bounded silent spawn options whatever the caller supplies', () => {
    const recorder = recordingSpawn(statusResult(0, `${OID_A}\n`));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    reader.run('git', ['rev-parse', 'HEAD'], {
      cwd: OWNER,
      echoStdout: true,
      maxBuffer: 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 1000,
      killSignal: 'SIGTERM'
    });
    const options = recorder.calls[0].options;
    expect(options.cwd).toBe(OWNER);
    expect(options.shell).toBe(false);
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(options.timeout).toBe(30000);
    expect(options.killSignal).toBe('SIGKILL');
    expect(options.maxBuffer).toBe(1024);
    expect(options.encoding).toBe('utf8');
    expect(Object.keys(options).sort()).toEqual(
      ['cwd', 'env', 'encoding', 'maxBuffer', 'shell', 'stdio', 'timeout', 'killSignal'].sort()
    );
  });

  test('defaults maxBuffer to the module bound', () => {
    const recorder = recordingSpawn(statusResult(0, `${OID_A}\n`));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    reader.run('git', ['rev-parse', 'HEAD'], { cwd: OWNER });
    expect(recorder.calls[0].options.maxBuffer).toBe(MAX_BUFFER_BYTES);
  });

  const UNSAFE_OPTIONS = [
    { label: 'shell true', options: { cwd: OWNER, shell: true } },
    { label: 'custom stdio', options: { cwd: OWNER, stdio: 'inherit' } },
    { label: 'inherited stderr', options: { cwd: OWNER, stdio: ['ignore', 'pipe', 'inherit'] } },
    { label: 'stdin pipe', options: { cwd: OWNER, stdio: ['pipe', 'pipe', 'pipe'] } },
    { label: 'input', options: { cwd: OWNER, input: 'HEAD' } },
    { label: 'a relative cwd', options: { cwd: 'relative/dir' } },
    { label: 'a missing cwd', options: {} },
    { label: 'a non string cwd', options: { cwd: 7 } },
    { label: 'an unknown key', options: { cwd: OWNER, detached: true } },
    { label: 'a nested options object', options: { cwd: OWNER, env2: {} } },
    { label: 'an oversize maxBuffer', options: { cwd: OWNER, maxBuffer: MAX_BUFFER_BYTES + 1 } },
    { label: 'a zero maxBuffer', options: { cwd: OWNER, maxBuffer: 0 } },
    { label: 'a negative maxBuffer', options: { cwd: OWNER, maxBuffer: -1 } },
    { label: 'a fractional maxBuffer', options: { cwd: OWNER, maxBuffer: 1.5 } },
    { label: 'a string maxBuffer', options: { cwd: OWNER, maxBuffer: '1024' } },
    { label: 'a foreign encoding', options: { cwd: OWNER, encoding: 'ascii' } },
    { label: 'a string env', options: { cwd: OWNER, env: 'GIT_DIR=/poisoned' } },
    { label: 'an array env', options: { cwd: OWNER, env: [] } },
    { label: 'a non string index', options: { cwd: OWNER, env: { GIT_INDEX_FILE: 7 } } },
    { label: 'a relative index', options: { cwd: OWNER, env: { GIT_INDEX_FILE: 'index' } } },
    { label: 'a missing index', options: { cwd: OWNER, env: { GIT_INDEX_FILE: path.join(OWNER, 'absent-index') } } },
    { label: 'a directory index', options: { cwd: OWNER, env: { GIT_INDEX_FILE: OWNER } } },
    { label: 'a null options value', options: null }
  ];

  for (const entry of UNSAFE_OPTIONS) {
    test(`refuses ${entry.label} before spawning`, () => {
      const recorder = recordingSpawn(statusResult(0, `${OID_A}\n`));
      const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
      const options = entry.options;
      const error = failureOf(() => reader.run('git', ['rev-parse', 'HEAD'], options));
      expect(error.code).toBe(FAILURE_CODE);
      expect(error.message).toBe(FAILURE_MESSAGE);
      expect(failureOf(() => reader.spawn('git', ['rev-parse', 'HEAD'], options)).code).toBe(FAILURE_CODE);
      expect(recorder.calls).toHaveLength(0);
    });
  }
});

describePosix('private index and symlink refusals', () => {
  const INDEX_SYMLINK = path.join(OWNER, 'index-symlink');
  const INDEX_DIR = path.join(OWNER, 'index-dir');
  const LINKED_DIR = path.join(OWNER, 'linked-dir');
  const LINKED_INDEX = path.join(LINKED_DIR, 'index-fixture');

  beforeAll(() => {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_SYMLINK)) fs.symlinkSync(INDEX_FIXTURE, INDEX_SYMLINK);
    if (!fs.existsSync(LINKED_DIR)) fs.symlinkSync(OWNER, LINKED_DIR);
  });

  test('accepts a deliberate ordinary private index', () => {
    const recorder = recordingSpawn(statusResult(0, NO_INDEX_LISTING));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(reader.run('git', NO_INDEX_FORM, { cwd: OWNER, env: { GIT_INDEX_FILE: INDEX_FIXTURE } }))
      .toBe(NO_INDEX_LISTING);
    expect(recorder.calls[0].options.env.GIT_INDEX_FILE).toBe(INDEX_FIXTURE);
  });

  test('refuses a symlinked private index', () => {
    const recorder = recordingSpawn(statusResult(0, NO_INDEX_LISTING));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(failureOf(() => reader.run('git', NO_INDEX_FORM, { cwd: OWNER, env: { GIT_INDEX_FILE: INDEX_SYMLINK } })).code)
      .toBe(FAILURE_CODE);
    expect(recorder.calls).toHaveLength(0);
  });

  test('refuses a private index under a symlinked parent', () => {
    const recorder = recordingSpawn(statusResult(0, NO_INDEX_LISTING));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(failureOf(() => reader.run('git', NO_INDEX_FORM, { cwd: OWNER, env: { GIT_INDEX_FILE: LINKED_INDEX } })).code)
      .toBe(FAILURE_CODE);
    expect(recorder.calls).toHaveLength(0);
  });

  test('refuses a private index that is a directory', () => {
    const recorder = recordingSpawn(statusResult(0, NO_INDEX_LISTING));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(failureOf(() => reader.run('git', NO_INDEX_FORM, { cwd: OWNER, env: { GIT_INDEX_FILE: INDEX_DIR } })).code)
      .toBe(FAILURE_CODE);
    expect(recorder.calls).toHaveLength(0);
  });
});

describe('typed failures and caller state', () => {
  test('keeps the captured streams on a real subprocess failure without interpolating them', () => {
    const recorder = recordingSpawn(statusResult(128, 'stdout text', 'fatal: https://token@example.invalid/repo.git HOME=/scratch'));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const error = failureOf(() => reader.run('git', ['rev-parse', '--verify', `${ZERO_OID}^{commit}`], { cwd: OWNER }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.message).not.toContain('fatal');
    expect(error.message).not.toContain('example.invalid');
    expect(error.message).not.toContain('/scratch');
    expect(error.status).toBe(128);
    expect(error.stdout).toBe('stdout text');
    expect(error.stderr).toBe('fatal: https://token@example.invalid/repo.git HOME=/scratch');
    expect('cause' in error).toBe(false);
  });

  test('attaches the spawn error as a cause and retains its code', () => {
    const spawnError = Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' });
    const recorder = recordingSpawn({ status: null, signal: null, error: spawnError, stdout: '', stderr: '' });
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const error = failureOf(() => reader.run('git', ['rev-parse', 'HEAD'], { cwd: OWNER }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.message).not.toContain('ENOENT');
    expect(error.cause).toBe(spawnError);
    expect(error.cause.code).toBe('ENOENT');
    expect(error.status).toBeNull();
    expect(error.signal).toBeNull();
  });

  test('handles a fake timeout result without waiting for the real bound', () => {
    const timeoutError = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const recorder = recordingSpawn({ status: null, signal: 'SIGKILL', error: timeoutError, stdout: '', stderr: '' });
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    const error = failureOf(() => reader.run('git', ['rev-parse', 'HEAD'], { cwd: OWNER }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.status).toBeNull();
    expect(error.signal).toBe('SIGKILL');
    expect(error.cause).toBe(timeoutError);
    expect(error.cause.code).toBe('ETIMEDOUT');
  });

  test('writes neither stream on success or failure', () => {
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const recorder = recordingSpawn((file, args) => (
        args.some((arg) => typeof arg === 'string' && arg.startsWith(ZERO_OID))
          ? statusResult(128, '', 'fatal: Needed a single revision')
          : statusResult(0, 'main\n')
      ));
      const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
      reader.readGit(OWNER, ['symbolic-ref', '-q', 'HEAD']);
      failureOf(() => reader.readGit(OWNER, ['rev-parse', '--verify', `${ZERO_OID}^{commit}`]));
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });

  test('does not mutate the caller argv, env or options', () => {
    const recorder = recordingSpawn(statusResult(0, 'main\n'));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync, env: { PATH: '/usr/bin' } });
    const args = ['symbolic-ref', '--quiet', '--short', 'HEAD'];
    const suppliedEnv = { GIT_INDEX_FILE: INDEX_FIXTURE, GIT_DIR: '/poisoned' };
    const options = { cwd: OWNER, env: suppliedEnv, maxBuffer: 4096 };
    const argsBefore = JSON.stringify(args);
    const envBefore = JSON.stringify(suppliedEnv);
    const optionsBefore = JSON.stringify(options);
    reader.readGit(OWNER, args);
    reader.run('git', args, options);
    reader.spawn('git', args, options);
    expect(JSON.stringify(args)).toBe(argsBefore);
    expect(JSON.stringify(suppliedEnv)).toBe(envBefore);
    expect(JSON.stringify(options)).toBe(optionsBefore);
    expect(recorder.calls).toHaveLength(3);
    expect(recorder.calls[0].options.env).not.toBe(suppliedEnv);
  });
});

describe('isolated Git configuration across platforms', () => {
  test('reads a real checkout using the Git null configuration path', () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(OWNER, 'portable-git-')));
    const init = childProcess.spawnSync('git', ['init', '-q', '-b', 'main', root], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    expect(init.error).toBeUndefined();
    expect(init.stderr).toBe('');
    expect(init.status).toBe(0);
    const reader = createLocalGitReader();
    const top = reader.readGit(root, ['rev-parse', '--show-toplevel']);
    expect(fs.realpathSync.native(top)).toBe(root);
  });
});

describePosix('a real scratch repository', () => {
  const ROOT = path.join(OWNER, 'real');
  const REPO = path.join(ROOT, 'repo');
  const CONTROL_REPO = path.join(ROOT, 'control-repo');
  const SCRATCH_HOME = path.join(ROOT, 'home');
  const FIXTURE_CONFIG = path.join(ROOT, 'fixture.gitconfig');
  const HOSTILE_CONFIG = path.join(SCRATCH_HOME, '.gitconfig');
  const NO_HOOKS = path.join(ROOT, 'no-hooks');
  const HELPER = path.join(ROOT, 'hostile-helper.sh');
  const MARKER = path.join(ROOT, 'hostile-helper-touched');
  const PRIVATE_INDEX = path.join(ROOT, 'private-index');
  const DIFF_PAIR = path.join(ROOT, 'diff-pair');
  const DOCS_PATH = 'docs/a.txt';
  const VAULT_PATH = 'vault/DOCS/15 Hyperclay Local App.md';
  const ORIGIN = 'https://example.invalid/example.git';

  const FIRST_BODY = 'hello\n';
  const SECOND_BODY = 'hello world\n';
  const VAULT_BODY = 'doc body\n';

  let reader = null;
  let head = null;
  let secondHead = null;
  let blob = null;
  let tree = null;
  let beforeTree = null;
  let beforeIndex = null;

  function fixtureGit(cwd, args, env) {
    return childProcess.execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: FIXTURE_CONFIG
      }, env || {})
    });
  }

  function initRepo(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fixtureGit(dir, ['init', '-q', '-b', 'main', '.']);
    fixtureGit(dir, ['config', 'user.name', 'Fixture']);
    fixtureGit(dir, ['config', 'user.email', 'fixture@example.com']);
    fixtureGit(dir, ['config', 'commit.gpgsign', 'false']);
  }

  function writeFile(root, rel, body) {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  }

  function treeSnapshot(root) {
    const rows = [];
    const visit = (dir, rel) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        const stat = fs.lstatSync(abs);
        const key = rel ? `${rel}/${name}` : name;
        if (stat.isDirectory()) {
          rows.push(`${key} dir ${stat.mtimeMs}`);
          visit(abs, key);
        } else {
          rows.push(`${key} ${stat.size} ${stat.mtimeMs} ${sha256(fs.readFileSync(abs))}`);
        }
      }
    };
    visit(root, '');
    return rows;
  }

  beforeAll(() => {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(NO_HOOKS, { recursive: true });
    fs.mkdirSync(SCRATCH_HOME, { recursive: true });
    fs.writeFileSync(HELPER, `#!/bin/sh\ntouch ${MARKER}\necho '{}'\n`);
    fs.chmodSync(HELPER, 0o755);
    fs.writeFileSync(FIXTURE_CONFIG, [
      '[user]',
      '\tname = Fixture',
      '\temail = fixture@example.com',
      '[init]',
      '\tdefaultBranch = main',
      '[commit]',
      '\tgpgsign = false',
      '[core]',
      `\thooksPath = ${JSON.stringify(NO_HOOKS)}`,
      '[maintenance]',
      '\tauto = false',
      '[gc]',
      '\tauto = 0',
      ''
    ].join('\n'));
    fs.writeFileSync(HOSTILE_CONFIG, [
      '[core]',
      `\tfsmonitor = ${HELPER}`,
      `\thooksPath = ${JSON.stringify(NO_HOOKS)}`,
      '[user]',
      '\tname = Hostile',
      '\temail = hostile@example.com',
      '[init]',
      '\tdefaultBranch = main',
      '[commit]',
      '\tgpgsign = false',
      '[maintenance]',
      '\tauto = true',
      '[gc]',
      '\tauto = 1',
      '[diff]',
      `\texternal = ${HELPER}`,
      ''
    ].join('\n'));

    initRepo(REPO);
    writeFile(REPO, DOCS_PATH, FIRST_BODY);
    writeFile(REPO, VAULT_PATH, VAULT_BODY);
    fixtureGit(REPO, ['add', '-A']);
    fixtureGit(REPO, ['commit', '-q', '-m', 'one']);
    head = fixtureGit(REPO, ['rev-parse', 'HEAD']).trim();
    tree = fixtureGit(REPO, ['rev-parse', `${head}^{tree}`]).trim();
    blob = fixtureGit(REPO, ['rev-parse', `${head}:${DOCS_PATH}`]).trim();
    fixtureGit(REPO, ['remote', 'add', 'origin', ORIGIN]);
    fixtureGit(REPO, ['remote', 'set-url', '--push', 'origin', ORIGIN]);

    fixtureGit(REPO, ['read-tree', head], { GIT_INDEX_FILE: PRIVATE_INDEX });

    writeFile(REPO, DOCS_PATH, SECOND_BODY);
    fixtureGit(REPO, ['add', '-A']);
    fixtureGit(REPO, ['commit', '-q', '-m', 'two']);
    secondHead = fixtureGit(REPO, ['rev-parse', 'HEAD']).trim();

    initRepo(CONTROL_REPO);
    writeFile(CONTROL_REPO, DOCS_PATH, FIRST_BODY);
    fixtureGit(CONTROL_REPO, ['add', '-A']);
    fixtureGit(CONTROL_REPO, ['commit', '-q', '-m', 'one']);

    writeFile(DIFF_PAIR, 'before/docs/a.txt', FIRST_BODY);
    writeFile(DIFF_PAIR, 'after/docs/a.txt', SECOND_BODY);

    reader = createLocalGitReader({ env: { PATH: process.env.PATH, HOME: SCRATCH_HOME } });
    beforeTree = treeSnapshot(REPO);
    beforeIndex = sha256(fs.readFileSync(PRIVATE_INDEX));
  });

  test('the planted hostile configuration is live without isolation', () => {
    fs.rmSync(MARKER, { force: true });
    childProcess.spawnSync('git', ['ls-files', '--stage', '-z'], {
      cwd: CONTROL_REPO,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: SCRATCH_HOME, GIT_CONFIG_NOSYSTEM: '1' }
    });
    expect(fs.existsSync(MARKER)).toBe(true);
    fs.rmSync(MARKER, { force: true });
    childProcess.spawnSync('git', ['diff', '--no-index', 'before/docs/a.txt', 'after/docs/a.txt'], {
      cwd: DIFF_PAIR,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: SCRATCH_HOME, GIT_CONFIG_NOSYSTEM: '1' }
    });
    expect(fs.existsSync(MARKER)).toBe(true);
    fs.rmSync(MARKER, { force: true });
  });

  test('reads checkout identity, branch and object format', () => {
    fs.rmSync(MARKER, { force: true });
    expect(reader.readGit(REPO, ['rev-parse', '--show-toplevel'])).toBe(REPO);
    expect(reader.readGit(REPO, ['rev-parse', '--git-common-dir'])).toBe('.git');
    expect(reader.readGit(REPO, ['rev-parse', '--show-object-format'])).toBe('sha1');
    expect(reader.readGit(REPO, ['rev-parse', '--is-shallow-repository'])).toBe('false');
    expect(reader.readGit(REPO, ['symbolic-ref', '-q', 'HEAD'])).toBe('refs/heads/main');
    expect(reader.readGit(REPO, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).toBe('main');
    expect(reader.readGit(REPO, ['rev-parse', 'HEAD'])).toBe(secondHead);
    expect(reader.readGit(REPO, ['rev-parse', '--verify', `${secondHead}^{commit}`])).toBe(secondHead);
    expect(reader.readGit(REPO, ['rev-parse', '--verify', `${tree}^{tree}`])).toBe(tree);
    expect(reader.readGit(REPO, ['rev-parse', `${tree}^{tree}`])).toBe(tree);
    expect(reader.readGit(REPO, ['remote', 'get-url', 'origin'])).toBe(ORIGIN);
    expect(reader.readGit(REPO, ['remote', 'get-url', '--push', '--all', 'origin'])).toBe(ORIGIN);
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test('reads trees, ancestry and a tree diff', () => {
    fs.rmSync(MARKER, { force: true });
    expect(reader.readGit(REPO, ['rev-list', '--parents', '-n', '1', secondHead])).toBe(`${secondHead} ${head}`);
    expect(reader.readGit(REPO, ['ls-tree', '-z', secondHead, '--', DOCS_PATH]))
      .toBe(`100644 blob ${fixtureGit(REPO, ['rev-parse', `${secondHead}:${DOCS_PATH}`]).trim()}\t${DOCS_PATH}\0`);
    const directory = reader.readGit(REPO, ['ls-tree', '-z', head, '--', 'vault/DOCS/']);
    expect(directory.split('\0').filter(Boolean)).toEqual([`100644 blob ${fixtureGit(REPO, ['rev-parse', `${head}:${VAULT_PATH}`]).trim()}\t${VAULT_PATH}`]);
    const full = reader.readGit(REPO, ['ls-tree', '-r', '--full-tree', '-z', head]).split('\0').filter(Boolean);
    expect(full).toHaveLength(2);
    expect(full.some((row) => row.endsWith(`\t${VAULT_PATH}`))).toBe(true);
    expect(full.some((row) => row.endsWith(`\t${DOCS_PATH}`))).toBe(true);
    expect(reader.readGit(REPO, ['diff', '--name-only', '-z', head, secondHead]).split('\0').filter(Boolean))
      .toEqual([DOCS_PATH]);
    expect(reader.readGit(REPO, ['diff', '--name-only', '-z', head, head])).toBe('');
    expect(reader.run('git', ['merge-base', '--is-ancestor', head, secondHead], { cwd: REPO })).toBe('');
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test('reads a blob as a Buffer and the deliberate private index', () => {
    fs.rmSync(MARKER, { force: true });
    const bytes = reader.run('git', ['cat-file', 'blob', blob], { cwd: REPO, encoding: null });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.equals(Buffer.from(FIRST_BODY, 'utf8'))).toBe(true);
    const listing = reader.run('git', NO_INDEX_FORM, { cwd: REPO, env: { GIT_INDEX_FILE: PRIVATE_INDEX } });
    expect(listing.split('\0').filter(Boolean).map((row) => row.split('\t')[1]).sort())
      .toEqual([DOCS_PATH, VAULT_PATH].sort());
    expect(failureOf(() => reader.run('git', NO_INDEX_FORM, { cwd: REPO })).code).toBe(FAILURE_CODE);
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test('accepts a no-index diff status 1 through spawn and types it through run', () => {
    fs.rmSync(MARKER, { force: true });
    const args = [
      'diff', '--no-index', '--binary', '--no-prefix', '--no-ext-diff', '--no-textconv', '--',
      'before/docs/a.txt', 'after/docs/a.txt'
    ];
    const result = reader.spawn('git', args, { cwd: DIFF_PAIR, encoding: null, maxBuffer: MAX_BUFFER_BYTES });
    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.error).toBeUndefined();
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout.toString('utf8')).toContain('before/docs/a.txt');
    const error = failureOf(() => reader.run('git', args, { cwd: DIFF_PAIR, encoding: null, maxBuffer: MAX_BUFFER_BYTES }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.status).toBe(1);
    expect(error.signal).toBeNull();
    expect('cause' in error).toBe(false);
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test('captures a real subprocess failure with its streams and no cause', () => {
    fs.rmSync(MARKER, { force: true });
    const error = failureOf(() => reader.readGit(REPO, ['rev-parse', '--verify', `${ZERO_OID}^{commit}`]));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.message).not.toContain('fatal');
    expect(error.status).toBe(128);
    expect(error.signal).toBeNull();
    expect('cause' in error).toBe(false);
    expect(error.stdout).toBe('');
    expect(error.stderr).toContain('fatal');
    expect(fs.existsSync(MARKER)).toBe(false);
  });

  test('reads with a hostile HOME without touching the planted helper or the repository', () => {
    fs.rmSync(MARKER, { force: true });
    expect(reader.run('git', NO_INDEX_FORM, { cwd: REPO, env: { GIT_INDEX_FILE: PRIVATE_INDEX } })).toContain(DOCS_PATH);
    expect(reader.readGit(REPO, ['diff', '--name-only', '-z', head, secondHead]).split('\0').filter(Boolean))
      .toEqual([DOCS_PATH]);
    expect(fs.existsSync(MARKER)).toBe(false);
    expect(treeSnapshot(REPO)).toEqual(beforeTree);
    expect(sha256(fs.readFileSync(PRIVATE_INDEX))).toBe(beforeIndex);
    expect(fs.existsSync(path.join(REPO, '.git', 'gc.log'))).toBe(false);
  });
});

describePosix('readBoundedOrdinaryFile', () => {
  const FILES = path.join(OWNER, 'files');
  const ORDINARY = path.join(FILES, 'ordinary.bin');
  const SYMLINK = path.join(FILES, 'ordinary-symlink');
  const DANGLING = path.join(FILES, 'dangling-symlink');
  const DIRECTORY = path.join(FILES, 'directory');
  const MISSING = path.join(FILES, 'missing.bin');
  const BODY = Buffer.from([0, 1, 2, 3, 255, 254, 10]);

  function fakeFs({ stat, opened, chunks, openError, readError, closeError }) {
    const calls = [];
    let reads = 0;
    return {
      calls,
      lstatSync(file) {
        calls.push({ method: 'lstatSync', file });
        if (stat && stat.error) throw stat.error;
        return stat && stat.value;
      },
      openSync(file, flags) {
        calls.push({ method: 'openSync', file, flags });
        if (openError) throw openError;
        return 42;
      },
      fstatSync(fd) {
        calls.push({ method: 'fstatSync', fd });
        return opened;
      },
      readSync(fd, buffer, offset, length, position) {
        calls.push({ method: 'readSync', fd, offset, length, position });
        if (readError) throw readError;
        const chunk = (chunks || [])[reads] || Buffer.alloc(0);
        reads += 1;
        const slice = chunk.subarray(0, length);
        slice.copy(buffer, offset);
        return slice.length;
      },
      closeSync(fd) {
        calls.push({ method: 'closeSync', fd });
        if (closeError) throw closeError;
      }
    };
  }

  function methodsOf(io) {
    return io.calls.map((call) => call.method);
  }

  function ordinaryStat() {
    return { dev: 7, ino: 11, isFile: () => true, isSymbolicLink: () => false };
  }

  beforeAll(() => {
    fs.mkdirSync(FILES, { recursive: true });
    fs.mkdirSync(DIRECTORY, { recursive: true });
    fs.writeFileSync(ORDINARY, BODY);
    if (!fs.existsSync(SYMLINK)) fs.symlinkSync(ORDINARY, SYMLINK);
    if (!fs.existsSync(DANGLING)) fs.symlinkSync(path.join(FILES, 'nowhere.bin'), DANGLING);
  });

  test('reads an ordinary file exactly up to its size', () => {
    const bytes = readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.equals(BODY)).toBe(true);
    expect(fs.readFileSync(ORDINARY).equals(BODY)).toBe(true);
  });

  test('reads an ordinary file below the bound without writing anything', () => {
    const siblings = fs.readdirSync(FILES).sort();
    const stat = fs.statSync(ORDINARY);
    const bytes = readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length + 64 });
    expect(bytes.equals(BODY)).toBe(true);
    expect(fs.readdirSync(FILES).sort()).toEqual(siblings);
    expect(fs.statSync(ORDINARY).mtimeMs).toBe(stat.mtimeMs);
    expect(fs.statSync(ORDINARY).size).toBe(stat.size);
  });

  test('rejects an ordinary file larger than the bound', () => {
    const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length - 1 }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.message).not.toContain(ORDINARY);
  });

  test('returns null only for a missing file when missing is set', () => {
    expect(failureOf(() => readBoundedOrdinaryFile(MISSING, { maxBytes: 16 })).code).toBe(FAILURE_CODE);
    expect(readBoundedOrdinaryFile(MISSING, { maxBytes: 16, missing: true })).toBeNull();
    const error = failureOf(() => readBoundedOrdinaryFile(MISSING, { maxBytes: 16 }));
    expect(error.cause.code).toBe('ENOENT');
  });

  test('rejects a symlink even when it points at an ordinary file', () => {
    expect(failureOf(() => readBoundedOrdinaryFile(SYMLINK, { maxBytes: 1024 })).code).toBe(FAILURE_CODE);
    expect(failureOf(() => readBoundedOrdinaryFile(SYMLINK, { maxBytes: 1024, missing: true })).code)
      .toBe(FAILURE_CODE);
    expect(failureOf(() => readBoundedOrdinaryFile(DANGLING, { maxBytes: 1024, missing: true })).code)
      .toBe(FAILURE_CODE);
  });

  test('rejects a directory', () => {
    expect(failureOf(() => readBoundedOrdinaryFile(DIRECTORY, { maxBytes: 1024 })).code).toBe(FAILURE_CODE);
  });

  test('rejects a relative or non string file', () => {
    expect(failureOf(() => readBoundedOrdinaryFile('ordinary.bin', { maxBytes: 16 })).code).toBe(FAILURE_CODE);
    expect(failureOf(() => readBoundedOrdinaryFile(7, { maxBytes: 16 })).code).toBe(FAILURE_CODE);
  });

  const BAD_BOUNDS = [
    { label: 'a missing maxBytes', options: {} },
    { label: 'a zero maxBytes', options: { maxBytes: 0 } },
    { label: 'a negative maxBytes', options: { maxBytes: -8 } },
    { label: 'a fractional maxBytes', options: { maxBytes: 1.5 } },
    { label: 'a NaN maxBytes', options: { maxBytes: NaN } },
    { label: 'an infinite maxBytes', options: { maxBytes: Infinity } },
    { label: 'an unsafe maxBytes', options: { maxBytes: Number.MAX_SAFE_INTEGER + 2 } },
    { label: 'a string maxBytes', options: { maxBytes: '8' } }
  ];

  for (const entry of BAD_BOUNDS) {
    test(`refuses ${entry.label} before touching the filesystem`, () => {
      const io = fakeFs({ stat: { value: ordinaryStat() }, opened: ordinaryStat() });
      const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, Object.assign({ fs: io }, entry.options)));
      expect(error.code).toBe(FAILURE_CODE);
      expect(error.message).toBe(FAILURE_MESSAGE);
      expect(io.calls).toHaveLength(0);
    });
  }

  test('bounds the read and closes the handle exactly once', () => {
    const io = fakeFs({ stat: { value: ordinaryStat() }, opened: ordinaryStat(), chunks: [BODY] });
    const bytes = readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io });
    expect(bytes.equals(BODY)).toBe(true);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
    expect(methodsOf(io).filter((method) => method === 'readSync').length).toBeGreaterThan(0);
    expect(methodsOf(io)).toEqual(['lstatSync', 'openSync', 'fstatSync', 'readSync', 'readSync', 'closeSync']);
    const open = io.calls.find((call) => call.method === 'openSync');
    expect(open.flags).toBe(fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    expect(open.file).toBe(ORDINARY);
  });

  test('rejects a file that grows past the bound after lstat', () => {
    const grown = Buffer.concat([BODY, Buffer.from([9, 9, 9, 9])]);
    const io = fakeFs({ stat: { value: ordinaryStat() }, opened: ordinaryStat(), chunks: [grown] });
    const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(methodsOf(io).filter((method) => method === 'readSync').length).toBeGreaterThan(0);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('rejects a handle whose dev or ino changed after lstat', () => {
    const io = fakeFs({
      stat: { value: ordinaryStat() },
      opened: { dev: 7, ino: 12, isFile: () => true, isSymbolicLink: () => false },
      chunks: [BODY]
    });
    expect(failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io })).code)
      .toBe(FAILURE_CODE);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('rejects a handle that is no longer an ordinary file', () => {
    const io = fakeFs({
      stat: { value: ordinaryStat() },
      opened: { dev: 7, ino: 11, isFile: () => false, isSymbolicLink: () => false },
      chunks: [BODY]
    });
    expect(failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io })).code)
      .toBe(FAILURE_CODE);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('returns null when the open loses the race to ENOENT and closes nothing', () => {
    const io = fakeFs({
      stat: { value: ordinaryStat() },
      opened: ordinaryStat(),
      openError: Object.assign(new Error('open ENOENT'), { code: 'ENOENT' })
    });
    expect(readBoundedOrdinaryFile(ORDINARY, { maxBytes: 16, missing: true, fs: io })).toBeNull();
    expect(methodsOf(io)).toEqual(['lstatSync', 'openSync']);
  });

  test('refuses the read when closing the handle fails', () => {
    const closeFailure = Object.assign(new Error('close EIO'), { code: 'EIO' });
    const io = fakeFs({
      stat: { value: ordinaryStat() },
      opened: ordinaryStat(),
      chunks: [BODY],
      closeError: closeFailure
    });
    const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.cause).toBe(closeFailure);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('preserves the original read failure when closing the handle also fails', () => {
    const readFailure = Object.assign(new Error('read EIO'), { code: 'EIO' });
    const closeFailure = Object.assign(new Error('close EBADF'), { code: 'EBADF' });
    const io = fakeFs({
      stat: { value: ordinaryStat() },
      opened: ordinaryStat(),
      chunks: [BODY],
      readError: readFailure,
      closeError: closeFailure
    });
    const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: BODY.length, fs: io }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.cause).toBe(readFailure);
    expect(error.cause.code).toBe('EIO');
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('reads an empty ordinary file as an empty Buffer', () => {
    const io = fakeFs({ stat: { value: ordinaryStat() }, opened: ordinaryStat(), chunks: [] });
    const bytes = readBoundedOrdinaryFile(ORDINARY, { maxBytes: 16, fs: io });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBe(0);
    expect(methodsOf(io).filter((method) => method === 'closeSync')).toHaveLength(1);
  });

  test('retains the filesystem error as a cause', () => {
    const io = fakeFs({ stat: { error: Object.assign(new Error('lstat EACCES'), { code: 'EACCES' }) } });
    const error = failureOf(() => readBoundedOrdinaryFile(ORDINARY, { maxBytes: 16, fs: io }));
    expect(error.code).toBe(FAILURE_CODE);
    expect(error.message).toBe(FAILURE_MESSAGE);
    expect(error.cause.code).toBe('EACCES');
    expect(io.calls).toHaveLength(1);
  });

  test('mutates neither the environment nor the caller options', () => {
    const envBefore = JSON.stringify(process.env);
    const options = { maxBytes: BODY.length };
    const optionsBefore = JSON.stringify(options);
    readBoundedOrdinaryFile(ORDINARY, options);
    expect(JSON.stringify(process.env)).toBe(envBefore);
    expect(JSON.stringify(options)).toBe(optionsBefore);
  });
});

describe('immutable commit headers', () => {
  const ROOT = path.join(OWNER, 'immutable-headers');
  const SCRATCH = path.join(ROOT, 'repo');
  const FIXTURE_CONFIG = path.join(ROOT, 'fixture.gitconfig');
  const GIT_TIMEOUT_MS = 30000;

  let rootOid = null;
  let childOid = null;

  function fixtureGit(cwd, args, env) {
    return childProcess.execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      env: Object.assign({}, process.env, {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: FIXTURE_CONFIG
      }, env || {})
    });
  }

  function headerParents(header) {
    return header.split('\n')
      .filter((line) => line.startsWith('parent '))
      .map((line) => line.slice('parent '.length).trim());
  }

  test('permits only a full typed commit object and refuses every other cat-file form', () => {
    const header = [
      `tree ${OID_B}`,
      `parent ${OID_A}`,
      'author Fixture <fixture@example.com> 0 +0000',
      'committer Fixture <fixture@example.com> 0 +0000',
      '',
      'message',
      ''
    ].join('\n');
    const recorder = recordingSpawn(statusResult(0, header));
    const reader = createLocalGitReader({ spawnSync: recorder.spawnSync });
    expect(reader.run('git', ['cat-file', 'commit', OID_A], { cwd: OWNER })).toBe(header);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].file).toBe('git');
    expect(recorder.calls[0].args).toEqual(GIT_GLOBAL_ARGS.concat(['cat-file', 'commit', OID_A]));

    for (const args of [
      ['cat-file', '-p', OID_A],
      ['cat-file', 'tree', OID_A],
      ['cat-file', 'tag', 'HEAD'],
      ['cat-file', 'commit', 'HEAD'],
      ['cat-file', 'commit', OID_A.slice(0, 8)],
      ['cat-file', 'commit', `${OID_A}~1`],
      ['cat-file', 'commit', OID_A, '--filters']
    ]) {
      const error = failureOf(() => reader.run('git', args, { cwd: OWNER }));
      expect(error.code).toBe(FAILURE_CODE);
      expect(error.message).toBe(FAILURE_MESSAGE);
    }
    expect(recorder.calls).toHaveLength(1);
  });

  testPosix('keeps the raw parent of a declared shallow boundary that rev-list hides', () => {
    const shallowFile = path.join(SCRATCH, '.git', 'shallow');
    try {
      fs.mkdirSync(SCRATCH, { recursive: true });
      fs.writeFileSync(FIXTURE_CONFIG, [
        '[user]',
        '\tname = Fixture',
        '\temail = fixture@example.com',
        '[commit]',
        '\tgpgsign = false',
        ''
      ].join('\n'));
      fixtureGit(SCRATCH, ['init', '-q', '-b', 'main', '.']);
      fs.writeFileSync(path.join(SCRATCH, 'root.txt'), 'root\n');
      fixtureGit(SCRATCH, ['add', '-A']);
      fixtureGit(SCRATCH, ['commit', '-q', '-m', 'root']);
      rootOid = fixtureGit(SCRATCH, ['rev-parse', 'HEAD']).trim();
      fs.writeFileSync(path.join(SCRATCH, 'child.txt'), 'child\n');
      fixtureGit(SCRATCH, ['add', '-A']);
      fixtureGit(SCRATCH, ['commit', '-q', '-m', 'child']);
      childOid = fixtureGit(SCRATCH, ['rev-parse', 'HEAD']).trim();
      fs.writeFileSync(shallowFile, `${childOid}\n`);
      const reader = createLocalGitReader();
      expect(rootOid).not.toBe(childOid);
      expect(reader.run('git', ['rev-parse', '--is-shallow-repository'], { cwd: SCRATCH }).trim()).toBe('true');
      expect(reader.run('git', ['rev-list', '--parents', '-n', '1', childOid], { cwd: SCRATCH }).trim()).toBe(childOid);
      const childHeader = reader.run('git', ['cat-file', 'commit', childOid], { cwd: SCRATCH });
      expect(headerParents(childHeader)).toEqual([rootOid]);
      expect(childHeader).toContain(`parent ${rootOid}`);
      const rootHeader = reader.run('git', ['cat-file', 'commit', rootOid], { cwd: SCRATCH });
      expect(headerParents(rootHeader)).toEqual([]);
      expect(rootHeader).not.toMatch(/^parent /m);
    } finally {
      fs.rmSync(ROOT, { recursive: true, force: true });
    }
  });
});
