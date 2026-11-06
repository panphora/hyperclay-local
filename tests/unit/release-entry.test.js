const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(REPO, 'scripts', 'release.js');
const HELPERS = ['release-transcript.js', 'release-command.js', 'release-options.js'];
const SENTINEL = '# sentinel release.log written before the transcript existed\nkept byte for byte\n';
const TMP = os.tmpdir();
const ownedDirs = new Set();

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(TMP, `hc-entry-${label}-`));
  ownedDirs.add(dir);
  return dir;
}

function scratchRepo(label) {
  const dir = tempDir(label);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(ENTRY, path.join(dir, 'scripts', 'release.js'));
  for (const name of HELPERS) {
    fs.copyFileSync(path.join(REPO, 'scripts', name), path.join(dir, 'scripts', name));
  }
  fs.writeFileSync(path.join(dir, 'release.log'), SENTINEL);
  return dir;
}

function fixtureEnv(home, extra) {
  const env = Object.assign({}, process.env);
  delete env.HYPERCLAY_RELEASE_LOG_WORKER;
  delete env.HYPERCLAY_RELEASE_LOG;
  delete env.HYPERSAVE_RELEASE_CAPTURE;
  delete env.HYPERSAVE_RELEASE_LOG;
  delete env.HYPERSAVE_MARKERS;
  delete env.NODE_OPTIONS;
  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_CACHE_HOME = path.join(home, '.cache');
  env.XDG_CONFIG_HOME = path.join(home, '.config');
  env.XDG_DATA_HOME = path.join(home, '.local', 'share');
  return Object.assign(env, extra);
}

function transcriptDir(home) {
  return path.join(home, '.cache', 'hyperclay-local', 'releases');
}

function transcriptPaths(home) {
  const root = transcriptDir(home);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().map(name => path.join(root, name, 'release.log'));
}

function findNamed(root, name) {
  const found = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function runEntry(scratch, args, options) {
  return new Promise((resolve, reject) => {
    const piped = options.stdio === undefined;
    const child = spawn(process.execPath, [path.join('scripts', 'release.js')].concat(args), {
      cwd: scratch,
      env: fixtureEnv(options.home, options.env),
      ...(piped ? {} : { stdio: options.stdio })
    });
    const out = [];
    const err = [];

    if (piped) {
      child.stdout.on('data', chunk => out.push(chunk));
      child.stderr.on('data', chunk => err.push(chunk));
    }
    child.on('error', reject);
    child.on('close', code => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8')
      });
    });
  });
}

afterEach(() => {
  for (const dir of ownedDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // Already gone.
    }
  }
  ownedDirs.clear();
});

describe('release.js entry', () => {
  test('captures a standalone --help run outside the checkout and never touches the old log', async () => {
    const scratch = scratchRepo('help');
    const home = tempDir('help-home');
    const run = await runEntry(scratch, ['--help'], { home });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Usage: node scripts/release.js');
    expect(fs.existsSync(path.join(scratch, '.env'))).toBe(false);

    const transcripts = transcriptPaths(home);
    expect(transcripts).toHaveLength(1);
    const text = fs.readFileSync(transcripts[0], 'utf8');
    expect(text).toContain('Usage: node scripts/release.js');
    expect(text.split('# Hyperclay release transcript')).toHaveLength(2);
    expect(text).toMatch(/# finished \S+ exit code=0 signal=null/);

    expect(fs.readFileSync(path.join(scratch, 'release.log'), 'utf8')).toBe(SENTINEL);
    expect(findNamed(scratch, 'release.log')).toEqual([path.join(scratch, 'release.log')]);
  });

  test('keeps a malformed version diagnostic in the standalone transcript and exits nonzero', async () => {
    const scratch = scratchRepo('badversion');
    const home = tempDir('badversion-home');
    const run = await runEntry(scratch, ['--version=1.2'], { home });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('Version must be X.Y.Z with plain numeric components from 0 through 65535');

    const transcripts = transcriptPaths(home);
    expect(transcripts).toHaveLength(1);
    const text = fs.readFileSync(transcripts[0], 'utf8');
    expect(text).toContain('Version must be X.Y.Z with plain numeric components from 0 through 65535');
    const prefix = `Release transcript: ${transcripts[0]}\n`;
    const suffix = `Release transcript complete: ${transcripts[0]}\n`;
    expect(run.stderr.startsWith(prefix)).toBe(true);
    expect(run.stderr.endsWith(suffix)).toBe(true);
    const childStderr = run.stderr.slice(prefix.length, -suffix.length);
    expect(childStderr.length).toBeGreaterThan(0);
    expect(text).toContain(childStderr);
    expect(text).toContain('Use --help for usage information');
    expect(text).toMatch(/exit code=1/);

    expect(fs.readFileSync(path.join(scratch, 'release.log'), 'utf8')).toBe(SENTINEL);
    expect(findNamed(scratch, 'release.log')).toEqual([path.join(scratch, 'release.log')]);
  });

  test('reuses an already opened capture sink instead of opening a standalone one', async () => {
    const scratch = scratchRepo('handshake');
    const home = tempDir('handshake-home');
    const capturePath = path.join(home, 'capture.log');
    const fd = fs.openSync(capturePath, 'w', 0o600);
    let run;

    try {
      run = await runEntry(scratch, ['--version=1.2'], {
        home,
        env: { HYPERSAVE_RELEASE_CAPTURE: '1', HYPERSAVE_RELEASE_LOG: capturePath },
        stdio: ['ignore', fd, fd]
      });
    } finally {
      fs.closeSync(fd);
    }

    expect(run.code).toBe(1);
    const text = fs.readFileSync(capturePath, 'utf8');
    expect(text).toContain('Version must be X.Y.Z with plain numeric components from 0 through 65535');
    expect(text).toContain('Use --help for usage information');
    expect(text).not.toContain('# Hyperclay release transcript');

    expect(fs.existsSync(transcriptDir(home))).toBe(false);
    expect(fs.readFileSync(path.join(scratch, 'release.log'), 'utf8')).toBe(SENTINEL);
    expect(findNamed(scratch, 'release.log')).toEqual([path.join(scratch, 'release.log')]);
  });

  test('keeps the npm release entry pointing at the same script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

    expect(pkg.scripts.release).toBe('node scripts/release.js');
  });

  test.each(['standalone', 'parent capture'])('keeps a size preparation failure in the %s release log', async mode => {
    const scratch = scratchRepo('size-failure');
    const home = tempDir('size-failure-home');
    const message = 'README.md has no size to update';
    fs.writeFileSync(path.join(scratch, 'scripts', 'release-coordinator.js'),
      `exports.runRelease = async () => { throw new Error(${JSON.stringify(message)}); };\n`);
    const capturePath = path.join(home, 'capture.log');
    let run;
    if (mode === 'parent capture') {
      const fd = fs.openSync(capturePath, 'w', 0o600);
      try {
        run = await runEntry(scratch, ['--resume'], {
          home,
          env: { HYPERSAVE_RELEASE_CAPTURE: '1', HYPERSAVE_RELEASE_LOG: capturePath },
          stdio: ['ignore', fd, fd]
        });
      } finally {
        fs.closeSync(fd);
      }
    } else {
      run = await runEntry(scratch, ['--resume'], { home });
    }
    expect(run.code).toBe(1);
    const logPath = mode === 'parent capture' ? capturePath : transcriptPaths(home)[0];
    expect(fs.readFileSync(logPath, 'utf8')).toContain(message);
  });

  test('keeps the real missing README size error in parent output and the worker transcript', async () => {
    const scratch = scratchRepo('real-size-failure');
    const home = tempDir('real-size-failure-home');
    const version = '1.2.3';
    const sourceSha = 'a'.repeat(40);
    const { expectedInstallerNames } = require('../../scripts/release-publication');
    const files = expectedInstallerNames(version);
    const manifest = {
      version,
      commit: sourceSha,
      date: '2026-11-05T00:00:00.000Z',
      files,
      sizes: Object.fromEntries(files.map(name => [name, 1048576]))
    };
    const readme = files.map(name => `[${name}](https://example.invalid/${name})`).join('\n');
    fs.writeFileSync(path.join(scratch, 'README.md'), readme);
    fs.writeFileSync(path.join(scratch, 'release-info.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scratch, 'scripts', 'release-coordinator.js'), [
      "const fs = require('fs');",
      `const { renderDownloadSizes } = require(${JSON.stringify(path.join(REPO, 'scripts', 'write-download-sizes.js'))});`,
      'exports.runRelease = async ({ repoRoot }) => renderDownloadSizes({',
      "  readme: fs.readFileSync(require('path').join(repoRoot, 'README.md'), 'utf8'),",
      "  website: '',",
      "  manifest: JSON.parse(fs.readFileSync(require('path').join(repoRoot, 'release-info.json'), 'utf8'))",
      `}, ${JSON.stringify({ version, sourceSha })});`,
      ''
    ].join('\n'));
    const capturePath = path.join(home, 'hypersave.log');
    const fd = fs.openSync(capturePath, 'w', 0o600);
    let run;
    try {
      run = await runEntry(scratch, ['--resume'], { home, stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    const message = `README.md has no size to update for ${files[0]}`;
    expect(run.code).toBe(1);
    expect(fs.readFileSync(capturePath, 'utf8')).toContain(message);
    const transcripts = transcriptPaths(home);
    expect(transcripts).toHaveLength(1);
    const transcript = fs.readFileSync(transcripts[0], 'utf8');
    expect(transcript).toContain(message);
    expect(transcript).toMatch(/# finished \S+ exit code=1 signal=null/);
    expect(fs.readFileSync(path.join(scratch, 'README.md'), 'utf8')).toBe(readme);
  });
});
