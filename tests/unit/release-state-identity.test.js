// D2 identity step: durable desktop state gets one canonical repository identity
// (checkout root on main, one GitHub fetch/push destination, a sha256 of the git
// common dir) and a cache root that can never resolve inside the checkout. Every
// fixture here is a local scratch repo under one owned temp root, with hooks,
// signing and global config disabled, and no command contacts a remote.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveRepoIdentity, statePaths } = require('../../scripts/release-state');
const { testPosix } = require('../helpers/platform');

jest.setTimeout(60000);

const OWNER = fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'hc-release-state-')));
const NO_HOOKS = path.join(OWNER, 'no-hooks');
const GIT_GLOBAL = path.join(OWNER, 'empty-gitconfig');
const SAVED_ENV = {
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL
};

fs.mkdirSync(NO_HOOKS, { recursive: true });
fs.writeFileSync(GIT_GLOBAL, '');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = GIT_GLOBAL;

const IDENTITY_READS = [
  ['rev-parse', '--show-toplevel'],
  ['rev-parse', '--git-common-dir'],
  ['symbolic-ref', '--quiet', '--short', 'HEAD'],
  ['rev-parse', '--show-object-format'],
  ['remote', 'get-url', 'origin'],
  ['remote', 'get-url', '--push', '--all', 'origin']
];

let scratchSeq = 0;

function scratchPath(label) {
  return path.join(OWNER, `${label}-${++scratchSeq}`);
}

function git(cwd, args) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function setOrigin(root, url) {
  git(root, ['config', 'remote.origin.url', url]);
  git(root, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
}

function makeRepo({ url = 'https://github.com/Owner/Repo.git', branch = 'main' } = {}) {
  const root = scratchPath('repo');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', branch]);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.hooksPath', NO_HOOKS]);
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture']);
  setOrigin(root, url);
  return root;
}

function refusalCode(invoke) {
  try {
    invoke();
  } catch (error) {
    return error.code;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function refusalError(invoke) {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function withoutPushDigest(identity) {
  const copy = { ...identity };
  delete copy.pushUrlSha256;
  return copy;
}

function snapshotTree(dir) {
  const entries = [];
  const visit = (current, prefix) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const key = prefix ? `${prefix}/${name}` : name;
      const stat = fs.lstatSync(full);
      entries.push({
        key, ino: stat.ino, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs,
        type: stat.isDirectory() ? 'dir' : 'file'
      });
      if (stat.isDirectory()) visit(full, key);
    }
  };
  visit(dir, '');
  return entries;
}

function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync.native(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

afterAll(() => {
  for (const name of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[name] === undefined) delete process.env[name];
    else process.env[name] = SAVED_ENV[name];
  }
  fs.rmSync(OWNER, { recursive: true, force: true });
});

describe('release repository identity', () => {
  test('native canonicalization unifies short and long Windows aliases', () => {
    const shortRoot = 'C:\\Users\\RUNNER~1\\checkout';
    const longRoot = 'C:\\Users\\runneradmin\\checkout';
    const root = path.resolve('native-checkout');
    const commonDir = path.join(root, '.git');
    const plain = jest.fn(() => { throw new Error('plain realpath must not be used'); });
    plain.native = jest.fn((value) => {
      if (value === shortRoot || value === longRoot) return root;
      if (value === commonDir) return commonDir;
      throw new Error('unexpected identity path');
    });
    const answers = ['rev-parse --show-toplevel', 'rev-parse --git-common-dir',
      'symbolic-ref --quiet --short HEAD', 'rev-parse --show-object-format',
      'remote get-url origin', 'remote get-url --push --all origin'];
    const values = [longRoot, '.git', 'main', 'sha1',
      'https://github.com/Owner/Repo.git', 'https://github.com/Owner/Repo.git'];
    const readGit = jest.fn((cwd, args) => {
      expect(cwd).toBe(root);
      const index = answers.indexOf(args.join(' '));
      if (index < 0) throw new Error('unexpected Git read');
      return values[index];
    });
    const identity = resolveRepoIdentity(shortRoot, { readGit, fs: { realpathSync: plain } });
    expect(identity.root).toBe(root);
    expect(identity.commonDir).toBe(commonDir);
    expect(identity.key).toBe(sha256(commonDir));
    expect(plain).not.toHaveBeenCalled();
    expect(plain.native.mock.calls).toEqual([[shortRoot], [longRoot], [commonDir]]);
    expect(readGit).toHaveBeenCalledTimes(6);
  });

  test('HTTPS and SCP/SSH origins yield one canonical credential-free identity', () => {
    const https = makeRepo({ url: 'https://GitHub.com/Owner/Repo.git' });
    const httpsIdentity = resolveRepoIdentity(https);
    const commonDir = fs.realpathSync.native(path.join(https, '.git'));
    const httpsPushUrl = git(https, ['remote', 'get-url', '--push', '--all', 'origin']);

    expect(httpsPushUrl).toBe('https://GitHub.com/Owner/Repo.git');
    expect(httpsIdentity).toEqual({
      key: sha256(commonDir),
      root: https,
      commonDir,
      branch: 'main',
      remote: 'origin',
      remoteRepo: 'github.com/owner/repo',
      pushUrlSha256: sha256(httpsPushUrl),
      objectFormat: git(https, ['rev-parse', '--show-object-format'])
    });
    expect(['sha1', 'sha256']).toContain(httpsIdentity.objectFormat);

    const scp = makeRepo({ url: 'git@github.com:Owner/Repo.git' });
    const scpIdentity = resolveRepoIdentity(scp);
    expect(scpIdentity.remoteRepo).toBe('github.com/owner/repo');
    expect(scpIdentity.key).toBe(sha256(fs.realpathSync.native(path.join(scp, '.git'))));
    expect(scpIdentity.pushUrlSha256).toBe(sha256('git@github.com:Owner/Repo.git'));
    expect(scpIdentity.root).toBe(scp);

    const ssh = makeRepo({ url: 'ssh://git@github.com/Owner/Repo.git' });
    const sshIdentity = resolveRepoIdentity(ssh);
    expect(sshIdentity.remoteRepo).toBe('github.com/owner/repo');
    expect(sshIdentity.key).toBe(sha256(fs.realpathSync.native(path.join(ssh, '.git'))));

    expect(new Set([httpsIdentity.key, scpIdentity.key, sshIdentity.key]).size).toBe(3);
  });

  test('a subdirectory refuses', () => {
    const root = makeRepo();

    fs.mkdirSync(path.join(root, 'sub/deeper'), { recursive: true });
    expect(refusalCode(() => resolveRepoIdentity(path.join(root, 'sub')))).toBe('REPO_ROOT_MISMATCH');
    expect(refusalCode(() => resolveRepoIdentity(path.join(root, 'sub/deeper')))).toBe('REPO_ROOT_MISMATCH');
  });

  testPosix('a checkout symlink alias shares the identity', () => {
    const root = makeRepo();
    const alias = scratchPath('alias');
    fs.symlinkSync(root, alias);

    const direct = resolveRepoIdentity(root);
    const viaAlias = resolveRepoIdentity(alias);
    expect(viaAlias).toEqual(direct);
    expect(viaAlias.root).toBe(root);
    expect(viaAlias.key).toBe(direct.key);
  });

  test('a second checkout differs and a linked worktree shares the key with its own root', () => {
    const first = makeRepo();
    const second = makeRepo();
    const firstIdentity = resolveRepoIdentity(first);
    const secondIdentity = resolveRepoIdentity(second);

    expect(secondIdentity.key).not.toBe(firstIdentity.key);
    expect(secondIdentity.commonDir).not.toBe(firstIdentity.commonDir);
    expect(secondIdentity.remoteRepo).toBe(firstIdentity.remoteRepo);

    const worktree = scratchPath('worktree');
    git(first, ['worktree', 'add', '--detach', '-q', worktree, 'main']);
    git(worktree, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    try {
      const linked = resolveRepoIdentity(worktree);
      expect(linked.key).toBe(firstIdentity.key);
      expect(linked.commonDir).toBe(firstIdentity.commonDir);
      expect(linked.root).toBe(fs.realpathSync.native(worktree));
      expect(linked.root).not.toBe(firstIdentity.root);
      expect(linked.branch).toBe('main');
    } finally {
      git(first, ['worktree', 'remove', '--force', worktree]);
    }

    expect(fs.existsSync(worktree)).toBe(false);
    expect(git(first, ['worktree', 'list']).split('\n')).toHaveLength(1);
  });

  test('another branch, a detached HEAD, foreign hosts, split or several push URLs and malformed origins refuse', () => {
    expect(refusalCode(() => resolveRepoIdentity(makeRepo({ branch: 'feature' })))).toBe('REPO_BRANCH_MISMATCH');

    const detached = makeRepo();
    git(detached, ['checkout', '-q', '--detach']);
    expect(refusalCode(() => resolveRepoIdentity(detached))).toBe('REPO_IDENTITY_UNREADABLE');

    expect(refusalCode(() => resolveRepoIdentity(makeRepo({ url: 'https://gitlab.com/owner/repo.git' })))).toBe('REPO_REMOTE_INVALID');
    expect(refusalCode(() => resolveRepoIdentity(makeRepo({ url: 'git@gitlab.com:owner/repo.git' })))).toBe('REPO_REMOTE_INVALID');

    const conflicting = makeRepo({ url: 'https://github.com/owner/repo.git' });
    git(conflicting, ['config', 'remote.origin.pushurl', 'git@github.com:owner/other.git']);
    expect(refusalCode(() => resolveRepoIdentity(conflicting))).toBe('REPO_PUSH_MISMATCH');

    const ambiguous = makeRepo({ url: 'https://github.com/owner/repo.git' });
    git(ambiguous, ['config', '--add', 'remote.origin.pushurl', 'https://github.com/owner/one.git']);
    git(ambiguous, ['config', '--add', 'remote.origin.pushurl', 'https://github.com/owner/two.git']);
    expect(git(ambiguous, ['remote', 'get-url', '--push', '--all', 'origin']).split('\n')).toHaveLength(2);
    expect(refusalCode(() => resolveRepoIdentity(ambiguous))).toBe('REPO_PUSH_AMBIGUOUS');

    const malformed = [
      'not a url',
      'https://github.com/owner',
      'ftp://github.com/owner/repo.git',
      'ssh://git@github.com:22/owner/repo.git',
      'https://github.com/owner/repo.git?ref=main',
      'https://github.com/owner/repo.git#main',
      'git@github.com:owner/../repo.git',
      'git@github.com:repo.git'
    ];
    for (const url of malformed) {
      expect(refusalCode(() => resolveRepoIdentity(makeRepo({ url })))).toBe('REPO_REMOTE_INVALID');
    }
  });

  test('credentials in an origin URL never reach the identity or an error', () => {
    const user = 'release-user';
    const password = 'p4ssw0rd-token';
    const credentialed = `https://${user}:${password}@github.com/Owner/Repo.git`;
    const root = makeRepo({ url: credentialed });
    const rawPushUrl = git(root, ['remote', 'get-url', '--push', '--all', 'origin']);

    expect(rawPushUrl).toBe(credentialed);
    const identity = resolveRepoIdentity(root);
    expect(identity.remoteRepo).toBe('github.com/owner/repo');
    expect(identity.pushUrlSha256).toBe(sha256(rawPushUrl));

    const serialized = JSON.stringify(identity);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(user);
    expect(identity.remoteRepo).not.toContain('@');

    setOrigin(root, 'https://github.com/Owner/Repo.git');
    const bare = resolveRepoIdentity(root);
    expect(bare.pushUrlSha256).toBe(sha256('https://github.com/Owner/Repo.git'));
    expect(bare.pushUrlSha256).not.toBe(identity.pushUrlSha256);
    expect(withoutPushDigest(bare)).toEqual(withoutPushDigest(identity));

    const foreign = makeRepo({ url: `https://${user}:${password}@gitlab.com/owner/repo.git` });
    const remoteError = refusalError(() => resolveRepoIdentity(foreign));
    expect(remoteError.code).toBe('REPO_REMOTE_INVALID');

    const split = makeRepo({ url: `https://${user}:${password}@github.com/owner/repo.git` });
    git(split, ['config', 'remote.origin.pushurl', `https://${user}:${password}@github.com/owner/other.git`]);
    const splitError = refusalError(() => resolveRepoIdentity(split));
    expect(splitError.code).toBe('REPO_PUSH_MISMATCH');

    for (const error of [remoteError, splitError]) {
      const text = `${error.message} ${String(error.stack)} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
      expect(text).not.toContain(password);
      expect(text).not.toContain(user);
    }
  });
});

describe('release state paths', () => {
  test('state, dry-run, history and locks stay separate, the docs lock is shared and nothing is created', () => {
    const root = makeRepo();
    const cacheParent = scratchPath('cache-missing');
    const cacheRoot = path.join(cacheParent, 'nested', 'releases');
    expect(fs.existsSync(cacheParent)).toBe(false);

    const before = snapshotTree(root);
    const indexBefore = fs.statSync(path.join(root, '.git', 'index'));

    const identity = resolveRepoIdentity(root);
    const paths = statePaths(identity, { cacheRoot });

    expect(snapshotTree(root)).toEqual(before);
    const indexAfter = fs.statSync(path.join(root, '.git', 'index'));
    expect({ ino: indexAfter.ino, size: indexAfter.size, mtimeMs: indexAfter.mtimeMs })
      .toEqual({ ino: indexBefore.ino, size: indexBefore.size, mtimeMs: indexBefore.mtimeMs });

    expect(paths.releasesDir).toBe(path.join(OWNER, path.basename(cacheParent), 'nested', 'releases'));
    expect(fs.existsSync(cacheParent)).toBe(false);
    expect(paths.repoDir).toBe(path.join(paths.releasesDir, identity.key));
    expect(paths.stateFile).toBe(path.join(paths.repoDir, 'state.json'));
    expect(paths.dryRunFile).toBe(path.join(paths.repoDir, 'dry-run.json'));
    expect(paths.historyDir).toBe(path.join(paths.repoDir, 'history'));
    expect(paths.releaseLock).toBe(path.join(paths.releasesDir, 'locks', 'releases', `${identity.key}.lock`));
    expect(paths.docsLocksDir).toBe(path.join(paths.releasesDir, 'locks', 'docs'));
    expect(new Set([
      paths.repoDir, paths.stateFile, paths.dryRunFile, paths.historyDir, paths.releaseLock, paths.docsLocksDir
    ]).size).toBe(6);

    const otherPaths = statePaths(resolveRepoIdentity(makeRepo()), { cacheRoot });
    expect(otherPaths.docsLocksDir).toBe(paths.docsLocksDir);
    expect(otherPaths.releaseLock).not.toBe(paths.releaseLock);
    expect(otherPaths.repoDir).not.toBe(paths.repoDir);
    expect(fs.existsSync(cacheParent)).toBe(false);
  });

  test('identity and path reads only ever read the filesystem', () => {
    const root = makeRepo();
    const cacheRoot = path.join(scratchPath('read-only-cache'), 'releases');
    const seen = new Set();
    const readOnlyFs = new Proxy(fs, {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        const wrapped = (...args) => {
          if (typeof property === 'string') seen.add(property);
          return value.apply(target, args);
        };
        if (typeof value.native === 'function') {
          wrapped.native = (...args) => {
            if (typeof property === 'string') seen.add(property);
            return value.native.apply(target, args);
          };
        }
        return wrapped;
      }
    });

    const identity = resolveRepoIdentity(root, { fs: readOnlyFs });
    const paths = statePaths(identity, { cacheRoot, fs: readOnlyFs });

    expect([...seen].sort()).toEqual(['lstatSync', 'realpathSync', 'statSync']);
    expect(identity).toEqual(resolveRepoIdentity(root));
    expect(fs.existsSync(paths.releasesDir)).toBe(false);
  });

  test('a cache resolving into the checkout and file paths refuse', () => {
    const root = makeRepo();
    const identity = resolveRepoIdentity(root);
    const cache = (cacheRoot) => () => statePaths(identity, { cacheRoot });

    expect(refusalCode(cache(root))).toBe('STATE_CACHE_IN_CHECKOUT');
    expect(refusalCode(cache(path.join(root, 'cache')))).toBe('STATE_CACHE_IN_CHECKOUT');
    expect(refusalCode(cache(path.join(root, '.git', 'release-cache')))).toBe('STATE_CACHE_IN_CHECKOUT');
    expect(refusalCode(cache(path.join(root, 'cache', 'nested')))).toBe('STATE_CACHE_IN_CHECKOUT');
    expect(refusalCode(cache(identity.commonDir))).toBe('STATE_CACHE_IN_CHECKOUT');

    const plainFile = scratchPath('plain-file');
    fs.writeFileSync(plainFile, 'not a directory\n');
    expect(refusalCode(cache(plainFile))).toBe('STATE_CACHE_INVALID');
    expect(fs.statSync(plainFile).isFile()).toBe(true);
    expect(refusalCode(cache('relative/cache'))).toBe('STATE_CACHE_INVALID');
    expect(refusalCode(() => statePaths(
      { ...identity, key: 'a'.repeat(64) }, { cacheRoot: scratchPath('unkeyed') }
    ))).toBe('REPO_IDENTITY_INVALID');
  });

  testPosix('a cache alias into the checkout, a dangling alias and an external alias refuse', () => {
    const root = makeRepo();
    const identity = resolveRepoIdentity(root);
    const cache = (cacheRoot) => () => statePaths(identity, { cacheRoot });

    const inside = path.join(root, 'cache');
    fs.mkdirSync(inside);
    const aliasToInside = scratchPath('alias-inside');
    fs.symlinkSync(inside, aliasToInside);
    expect(refusalCode(cache(aliasToInside))).toBe('STATE_CACHE_IN_CHECKOUT');
    expect(refusalCode(cache(path.join(aliasToInside, 'nested')))).toBe('STATE_CACHE_IN_CHECKOUT');

    const dangling = scratchPath('dangling');
    fs.symlinkSync(path.join(OWNER, 'missing-target'), dangling);
    const danglingError = refusalError(cache(dangling));
    expect(danglingError.code).toBe('ENOENT');
    expect(fs.lstatSync(dangling).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(OWNER, 'missing-target'))).toBe(false);

    const outside = scratchPath('outside-cache');
    const aliasToOutside = scratchPath('alias-outside');
    fs.symlinkSync(OWNER, aliasToOutside);
    const future = statePaths(identity, {
      cacheRoot: path.join(aliasToOutside, path.basename(outside), 'deep', 'releases')
    });
    expect(future.releasesDir).toBe(path.join(outside, 'deep', 'releases'));
    expect(fs.existsSync(outside)).toBe(false);
  });

  testPosix('a cache descendant of a plain file refuses with the native errno', () => {
    const root = makeRepo();
    const identity = resolveRepoIdentity(root);
    const plainFile = scratchPath('plain-file');
    fs.writeFileSync(plainFile, 'not a directory\n');

    expect(refusalCode(() => statePaths(identity, { cacheRoot: path.join(plainFile, 'child') }))).toBe('ENOTDIR');
  });

  test('a readGit spy sees only the six read-only identity reads', () => {
    const root = makeRepo();
    const calls = [];
    const spy = (cwd, args) => {
      calls.push(args.slice());
      return git(cwd, args);
    };

    const identity = resolveRepoIdentity(root, { readGit: spy });

    expect(calls).toEqual(IDENTITY_READS);
    for (const args of calls) expect(['rev-parse', 'symbolic-ref', 'remote']).toContain(args[0]);
    expect(identity.remoteRepo).toBe('github.com/owner/repo');
  });

  testPosix('the git child runs lock-free through an extensionless shell shim', () => {
    const root = makeRepo();
    const identity = resolveRepoIdentity(root);

    const realGit = findOnPath('git');
    expect(typeof realGit).toBe('string');
    const shimDir = scratchPath('shim');
    const logFile = path.join(OWNER, 'shim-log.txt');
    fs.mkdirSync(shimDir);
    fs.writeFileSync(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      'echo "${GIT_OPTIONAL_LOCKS-}" >> ' + JSON.stringify(logFile),
      'exec ' + JSON.stringify(realGit) + ' "$@"'
    ].join('\n'));
    fs.chmodSync(path.join(shimDir, 'git'), 0o755);

    const savedPath = process.env.PATH;
    process.env.PATH = shimDir + path.delimiter + savedPath;
    try {
      expect(resolveRepoIdentity(root)).toEqual(identity);
    } finally {
      process.env.PATH = savedPath;
    }

    const observed = fs.readFileSync(logFile, 'utf8').split('\n').slice(0, -1);
    expect(observed).toEqual(IDENTITY_READS.map(() => '0'));
    expect(observed).toHaveLength(IDENTITY_READS.length);
  });
});
