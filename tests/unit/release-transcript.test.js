// The release transcript supervisor captures one complete log of a release
// child, wherever it was started from, without changing what the release does.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { superviseRelease } = require('../../scripts/release-transcript');

const TMP = os.tmpdir();
const ownedDirs = new Set();
const ownedPids = new Set();

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(TMP, `hc-transcript-${label}-`));
  ownedDirs.add(dir);
  return dir;
}

function fixture(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Array.isArray(body) ? body.join('\n') + '\n' : body);
  return file;
}

function collector() {
  const chunks = [];
  const stream = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    }
  };
  return { stream, text: () => chunks.join('') };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline(promise, label, ms = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no result within ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function waitFor(check, label, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`${label}: condition was never met within ${ms}ms`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function manifest(dir) {
  const entries = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.lstatSync(full).isDirectory()) {
        entries.push(`d ${path.relative(dir, full)}`);
        walk(full);
      } else {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        entries.push(`f ${path.relative(dir, full)} ${hash}`);
      }
    }
  };
  walk(dir);
  return entries;
}

function childEnv(extra) {
  const env = Object.assign({}, process.env, extra);
  delete env.HYPERCLAY_RELEASE_LOG_WORKER;
  delete env.HYPERSAVE_RELEASE_CAPTURE;
  delete env.HYPERSAVE_RELEASE_LOG;
  return Object.assign(env, extra);
}

afterEach(() => {
  for (const pid of ownedPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      // Already gone.
    }
  }
  ownedPids.clear();
  for (const dir of ownedDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // Already gone.
    }
  }
  ownedDirs.clear();
});

describe('release transcript supervisor', () => {
  test('writes one combined transcript and forwards each stream to its own terminal', async () => {
    const dir = tempDir('basic');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('stdout line\\n');",
      "process.stderr.write('stderr line\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'basic');

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.complete).toBe(true);
    expect(result.captureOwner).toBe('file');
    expect(result.logPath.startsWith(path.join(dir, 'logs'))).toBe(true);

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('# Hyperclay release transcript');
    expect(text).toContain('stdout line');
    expect(text).toContain('stderr line');
    expect(text).toMatch(/# finished \S+ exit code=0 signal=null/);

    expect(out.text()).toContain('stdout line');
    expect(out.text()).not.toContain('stderr line');
    expect(err.text()).toContain('stderr line');
    expect(err.text()).not.toContain('stdout line');

    expect(fs.statSync(result.logPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(result.logPath)).mode & 0o777).toBe(0o700);
  });

  test('captures output inherited from the child and from a grandchild', async () => {
    const dir = tempDir('inherit');
    const grand = fixture(dir, 'grand.js', [
      "process.stdout.write('grandchild out\\n');",
      "process.stderr.write('grandchild err\\n');"
    ]);
    const script = fixture(dir, 'child.js', [
      "const { spawn } = require('child_process');",
      `const grand = spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'inherit' });`,
      "grand.on('close', () => process.stdout.write('child tail\\n'));"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'inherit');

    expect(result.code).toBe(0);
    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('grandchild out');
    expect(text).toContain('grandchild err');
    expect(text).toContain('child tail');
  });

  test('keeps a line far longer than 8 KiB without clipping it', async () => {
    const dir = tempDir('longline');
    const long = 'q'.repeat(20000);
    const script = fixture(dir, 'child.js', [
      `process.stdout.write('${long}' + '\\n');`
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'longline');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain(long + '\n');
    expect(text).not.toContain('omitted');
    expect(text).not.toContain('truncated');
  });

  test('flushes a final line that never got a newline before the footer', async () => {
    const dir = tempDir('tail');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('no trailing newline');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'tail');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toMatch(/no trailing newline\n# finished /);
  });

  test('keeps UTF-8 whole across chunk boundaries', async () => {
    const dir = tempDir('utf8');
    const script = fixture(dir, 'child.js', [
      "const bytes = Array.from(Buffer.from('\\u20ac snowman \\u2603', 'utf8'));",
      "let i = 0;",
      "const tick = () => {",
      "  if (i < bytes.length) {",
      "    process.stdout.write(Buffer.from([bytes[i]]));",
      "    i += 1;",
      "    setTimeout(tick, 5);",
      "  } else {",
      "    process.stdout.write('\\n');",
      "  }",
      "};",
      "tick();"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'utf8');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('\u20ac snowman \u2603');
    expect(text).not.toContain('\uFFFD');
  });

  test('redacts every known secret shape, even split across writes', async () => {
    const dir = tempDir('redact');
    const npmToken = 'npm_' + 'A'.repeat(24);
    const githubToken = 'github_pat_' + 'B'.repeat(24);
    const ghToken = 'ghp_' + 'C'.repeat(24);
    const apiKey = 'sk-' + 'd'.repeat(24);
    const awsKey = 'AKIA' + 'EFGHIJKLMNOP';
    const bearer = 'Authorization: Bearer ' + 'e'.repeat(24);
    const flag = 'npm run deploy --token=supersecretvalue';
    const script = fixture(dir, 'child.js', [
      `const npmToken = ${JSON.stringify(npmToken)};`,
      `process.stdout.write(npmToken.slice(0, 8));`,
      "setTimeout(() => {",
      "  process.stdout.write(npmToken.slice(8) + '\\n');",
      `  process.stdout.write(${JSON.stringify(githubToken)} + '\\n');`,
      `  process.stdout.write(${JSON.stringify(ghToken)} + '\\n');`,
      `  process.stdout.write(${JSON.stringify(apiKey)} + '\\n');`,
      `  process.stdout.write(${JSON.stringify(awsKey)} + '\\n');`,
      `  process.stdout.write(${JSON.stringify(flag)} + '\\n');`,
      "}, 30);",
      `process.stderr.write(${JSON.stringify(bearer)}.slice(0, 12));`,
      `setTimeout(() => process.stderr.write(${JSON.stringify(bearer)}.slice(12) + '\\n'), 30);`
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'redact');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('\u003credacted:npm_token>');
    expect(text).toContain('\u003credacted:github_token>');
    expect(text).toContain('\u003credacted:api_key>');
    expect(text).toContain('\u003credacted:aws_key>');
    expect(text).toContain('\u003credacted:bearer_token>');
    expect(text).toContain('\u003credacted:flag_value>');
    for (const secret of [npmToken, githubToken, ghToken, apiKey, awsKey, bearer, 'supersecretvalue']) {
      expect(text).not.toContain(secret);
    }
    // The terminal is the live view, not the archival boundary.
    expect(out.text()).toContain(npmToken);
  });

  test('returns the child exit code and keeps the transcript complete', async () => {
    const dir = tempDir('nonzero');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('about to fail\\n');",
      'process.exit(7);'
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'nonzero');

    expect(result.code).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.complete).toBe(true);
    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('about to fail');
    expect(text).toMatch(/# finished \S+ exit code=7 signal=null/);
  });

  test('keeps a child that cannot be started non-zero with its diagnostic', async () => {
    const dir = tempDir('missing');
    const script = path.join(dir, 'not-a-script.js');
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'missing');

    expect(result.code).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(result.complete).toBe(true);
    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('Cannot find module');
  });

  test('reports a spawn failure with a diagnostic and a nonzero code', async () => {
    const dir = tempDir('spawn');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('never runs\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: path.join(dir, 'missing-cwd'),
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'spawn');

    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.complete).toBe(true);
    expect(err.text()).toContain('Could not start');
    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('# failed to start:');
    expect(text).toMatch(/# finished \S+ exit code=1 signal=null/);
  });

  test('forwards SIGTERM to the child process group and removes its handlers', async () => {
    const dir = tempDir('signal');
    const grand = fixture(dir, 'grand.js', [
      'setInterval(() => {}, 1000);'
    ]);
    const script = fixture(dir, 'child.js', [
      "const { spawn } = require('child_process');",
      `const grand = spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'inherit' });`,
      "process.stdout.write('ready ' + process.pid + ' ' + grand.pid + '\\n');",
      'setInterval(() => {}, 1000);'
    ]);
    const harness = fixture(dir, 'harness.js', [
      `const { superviseRelease } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'scripts', 'release-transcript.js'))});`,
      "superviseRelease({ scriptPath: process.argv[2], cwd: __dirname, logRoot: process.argv[3] })",
      "  .then((result) => process.stdout.write('RESULT ' + JSON.stringify(result)"
        + " + ' HANDLERS ' + process.listenerCount('SIGTERM')"
        + " + ' INT ' + process.listenerCount('SIGINT') + '\\n'));"
    ]);

    const proc = spawn(process.execPath, [harness, script, path.join(dir, 'logs')], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    ownedPids.add(proc.pid);
    let text = '';
    proc.stdout.on('data', (chunk) => { text += chunk.toString('utf8'); });

    await waitFor(() => /ready \d+ \d+/.test(text), 'signal fixture ready');
    const match = text.match(/ready (\d+) (\d+)/);
    const pids = [Number(match[1]), Number(match[2])];
    for (const pid of pids) ownedPids.add(pid);

    proc.kill('SIGTERM');

    const exitCode = await withDeadline(new Promise((resolve) => proc.on('close', resolve)), 'signal harness');
    expect(exitCode).toBe(0);

    const line = text.split('\n').find((entry) => entry.startsWith('RESULT '));
    expect(line).toBeDefined();
    const result = JSON.parse(line.slice('RESULT '.length).split(' HANDLERS ')[0]);
    expect(result.signal).toBe('SIGTERM');
    expect(result.code).toBeNull();
    expect(line).toContain('HANDLERS 0');
    expect(line).toContain('INT 0');

    await waitFor(() => pids.every((pid) => !alive(pid)), 'the forwarded signal reached the child group');
  });

  test('leaves capture to a parent sink and writes no local files', async () => {
    const dir = tempDir('external');
    const external = path.join(dir, 'external-transcript.log');
    const logRoot = path.join(dir, 'logs');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('delegated line\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot,
      env: childEnv({ HYPERSAVE_RELEASE_CAPTURE: '1', HYPERSAVE_RELEASE_LOG: external }),
      stdout: out.stream,
      stderr: err.stream
    }), 'external');

    expect(result.logPath).toBe(external);
    expect(result.captureOwner).toBe('external');
    expect(result.complete).toBeNull();
    expect(result.code).toBe(0);
    expect(fs.existsSync(logRoot)).toBe(false);
    expect(fs.existsSync(external)).toBe(false);
    expect(out.text()).toContain('delegated line');
  });

  test('does not read capture ownership out of HYPERSAVE_MARKERS', async () => {
    const dir = tempDir('markers');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('marker line\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      env: childEnv({ HYPERSAVE_MARKERS: '1' }),
      stdout: out.stream,
      stderr: err.stream
    }), 'markers');

    expect(result.captureOwner).toBe('file');
    expect(result.complete).toBe(true);
    expect(fs.readFileSync(result.logPath, 'utf8')).toContain('marker line');
  });

  test('still writes its own file when the capture flag has no absolute log path', async () => {
    const dir = tempDir('halfcapture');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('half capture line\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      env: childEnv({ HYPERSAVE_RELEASE_CAPTURE: '1', HYPERSAVE_RELEASE_LOG: 'relative/transcript.log' }),
      stdout: out.stream,
      stderr: err.stream
    }), 'halfcapture');

    expect(result.captureOwner).toBe('file');
    expect(result.complete).toBe(true);
    expect(result.logPath.startsWith(path.join(dir, 'logs'))).toBe(true);
    expect(fs.readFileSync(result.logPath, 'utf8')).toContain('half capture line');
  });

  test('falls back to a private directory under tmpdir when the log root is unusable', async () => {
    const dir = tempDir('fallbackroot');
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'a file, not a directory\n');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('fallback line\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(blocker, 'releases'),
      stdout: out.stream,
      stderr: err.stream
    }), 'fallbackroot');

    ownedDirs.add(path.dirname(result.logPath));
    expect(result.complete).toBe(true);
    expect(result.captureOwner).toBe('file');
    expect(result.logPath.startsWith(TMP)).toBe(true);
    expect(fs.readFileSync(result.logPath, 'utf8')).toContain('fallback line');
  });

  test('falls back to the console when no transcript can be opened at all', async () => {
    const dir = tempDir('nofile');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('console only line\\n');",
      'process.exit(4);'
    ]);
    const out = collector();
    const err = collector();
    const fsOps = {
      mkdirSync() { throw new Error('permission denied'); },
      mkdtempSync() { throw new Error('permission denied'); }
    };

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      fs: fsOps,
      stdout: out.stream,
      stderr: err.stream
    }), 'nofile');

    expect(result.logPath).toBeNull();
    expect(result.captureOwner).toBe('none');
    expect(result.complete).toBe(false);
    expect(result.code).toBe(4);
    expect(out.text()).toContain('console only line');
    expect(err.text().match(/Could not open a release transcript/g)).toHaveLength(1);
    expect(err.text()).toContain('console output only');
  });

  test('marks the transcript incomplete when a write fails, closes the descriptor once, and keeps the child draining', async () => {
    const dir = tempDir('midfailure');
    const script = fixture(dir, 'child.js', [
      'let n = 0;',
      'const tick = () => {',
      '  n += 1;',
      "  process.stdout.write('line ' + n + '\\n');",
      '  if (n < 6) setTimeout(tick, 40);',
      '  else process.exit(3);',
      '};',
      'tick();'
    ]);
    const out = collector();
    const err = collector();
    const realWrite = fs.writeSync;
    const realClose = fs.closeSync;
    let writes = 0;
    let closes = 0;
    const fsOps = {
      writeSync(fd, buffer, offset, length) {
        writes += 1;
        if (writes > 4) throw new Error('no space left on device');
        return realWrite(fd, buffer, offset, length);
      },
      closeSync(fd) {
        closes += 1;
        return realClose(fd);
      }
    };

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      fs: fsOps,
      stdout: out.stream,
      stderr: err.stream
    }), 'midfailure');

    expect(result.code).toBe(3);
    expect(result.captureOwner).toBe('file');
    expect(result.complete).toBe(false);
    expect(closes).toBe(1);
    expect(err.text().match(/Could not write the release transcript/g)).toHaveLength(1);
    expect(out.text()).toContain('line 6');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('line 1');
    expect(text).toContain('line 2');
    expect(text).not.toContain('line 3');
    expect(text).not.toContain('# finished');
  });

  test('reassembles a multibyte line from short writes without losing bytes', async () => {
    const dir = tempDir('shortwrite');
    const line = '\u20ac snowman \u2603 at caf\u00e9';
    const script = fixture(dir, 'child.js', [
      `process.stdout.write(${JSON.stringify(line)} + '\\n');`
    ]);
    const out = collector();
    const err = collector();
    const realWrite = fs.writeSync;
    let writes = 0;
    let maxWritten = 0;
    const fsOps = {
      writeSync(fd, buffer, offset, length) {
        writes += 1;
        const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
        const start = Number.isInteger(offset) ? offset : 0;
        const remaining = Number.isInteger(length) ? length : bytes.length - start;
        const written = realWrite(fd, bytes, start, Math.min(3, remaining));
        maxWritten = Math.max(maxWritten, written);
        return written;
      }
    };

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      fs: fsOps,
      stdout: out.stream,
      stderr: err.stream
    }), 'shortwrite');

    expect(result.code).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.captureOwner).toBe('file');
    expect(writes).toBeGreaterThan(1);
    expect(maxWritten).toBe(3);
    expect(err.text()).not.toContain('Could not write the release transcript');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain(line + '\n');
    expect(text).toMatch(/# finished \S+ exit code=0 signal=null/);
    expect(out.text()).toContain(line);
  });

  test('treats a zero-byte write as a failure, settles, and closes the descriptor once', async () => {
    const dir = tempDir('zerowrite');
    const script = fixture(dir, 'child.js', [
      'let n = 0;',
      'const tick = () => {',
      '  n += 1;',
      "  process.stdout.write('line ' + n + '\\n');",
      '  if (n < 6) setTimeout(tick, 40);',
      '  else process.exit(5);',
      '};',
      'tick();'
    ]);
    const out = collector();
    const err = collector();
    const realWrite = fs.writeSync;
    const realClose = fs.closeSync;
    let writes = 0;
    let closes = 0;
    const fsOps = {
      writeSync(fd, buffer, offset, length) {
        writes += 1;
        if (writes === 3) return 0;
        return realWrite(fd, buffer, offset, length);
      },
      closeSync(fd) {
        closes += 1;
        return realClose(fd);
      }
    };

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      fs: fsOps,
      stdout: out.stream,
      stderr: err.stream
    }), 'zerowrite');

    expect(result.code).toBe(5);
    expect(result.signal).toBeNull();
    expect(result.captureOwner).toBe('file');
    expect(result.complete).toBe(false);
    expect(closes).toBe(1);
    expect(err.text().match(/Could not write the release transcript/g)).toHaveLength(1);
    expect(out.text()).toContain('line 6');

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('# Hyperclay release transcript');
    expect(text).not.toContain('line 1');
    expect(text).not.toContain('# finished');
  });

  test('leaves the checkout it runs from byte for byte unchanged', async () => {
    const dir = tempDir('checkout');
    const checkout = path.join(dir, 'checkout');
    fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
    fs.mkdirSync(path.join(checkout, 'nested'));
    fs.writeFileSync(path.join(checkout, 'nested', 'notes.txt'), 'hello\n');
    const script = fixture(checkout, 'child.js', [
      "process.stdout.write('checkout child\\n');"
    ]);
    const before = manifest(checkout);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: checkout,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'checkout');

    expect(result.code).toBe(0);
    expect(result.logPath.startsWith(path.join(dir, 'logs'))).toBe(true);
    expect(manifest(checkout)).toEqual(before);
    expect(fs.existsSync(path.join(checkout, 'release.log'))).toBe(false);
  });

  test('adds the worker marker to the child environment', async () => {
    const dir = tempDir('worker');
    const script = fixture(dir, 'child.js', [
      "process.stdout.write('worker=' + process.env.HYPERCLAY_RELEASE_LOG_WORKER + '\\n');"
    ]);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: script,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      env: childEnv({}),
      stdout: out.stream,
      stderr: err.stream
    }), 'worker');

    expect(fs.readFileSync(result.logPath, 'utf8')).toContain('worker=1');
  });
});
