const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { superviseRelease } = require('../../scripts/release-transcript');

const TMP = os.tmpdir();
const HELPER = path.join(__dirname, '..', '..', 'scripts', 'release-command.js');
const ownedDirs = new Set();

const RUNNER_SOURCE = [
  "const fs = require('fs');",
  `const { execCaptured, execFileCaptured } = require(${JSON.stringify(HELPER)});`,
  '',
  'function encode(value) {',
  "  if (Buffer.isBuffer(value)) return { kind: 'buffer', base64: value.toString('base64') };",
  "  if (typeof value === 'string') return { kind: 'string', value };",
  "  if (value === null) return { kind: 'null', value: null };",
  "  return { kind: typeof value, value: typeof value === 'undefined' ? null : value };",
  '}',
  '',
  'const spec = JSON.parse(process.env.EXEC_SPEC);',
  "const invoke = spec.target === 'execFileCaptured'",
  '  ? () => execFileCaptured(spec.file, spec.args, spec.options || {})',
  '  : () => execCaptured(spec.command, spec.options || {});',
  'let record;',
  'try {',
  '  const value = invoke();',
  '  record = { ok: true, value: encode(value) };',
  '} catch (error) {',
  '  record = {',
  '    ok: false,',
  '    message: error.message,',
  "    status: error.status === undefined ? null : error.status,",
  "    signal: error.signal === undefined ? null : error.signal,",
  "    code: error.code === undefined ? null : error.code,",
  "    cause: error.cause ? String(error.cause.message) : null,",
  '    stdout: encode(error.stdout),',
  '    stderr: encode(error.stderr),',
  '    output: Array.isArray(error.output) ? error.output.map(encode) : null',
  '  };',
  '}',
  'fs.writeFileSync(process.argv[2], JSON.stringify(record));'
];

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(TMP, `hc-command-${label}-`));
  ownedDirs.add(dir);
  return dir;
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

function withDeadline(promise, label, ms = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no result within ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function runHelper(dir, spec) {
  const runner = path.join(dir, 'runner.js');
  const recordPath = path.join(dir, 'record.json');
  fs.writeFileSync(runner, RUNNER_SOURCE.join('\n') + '\n');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, recordPath], {
      cwd: dir,
      env: Object.assign({}, process.env, { EXEC_SPEC: JSON.stringify(spec) })
    });
    const out = [];
    const err = [];

    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        record: JSON.parse(fs.readFileSync(recordPath, 'utf8'))
      });
    });
  });
}

const BIG = 250000;

function bigOutputFixture(dir, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [
    "const fs = require('fs');",
    `fs.writeSync(1, Buffer.alloc(${BIG}, 'o'));`,
    `fs.writeSync(2, Buffer.alloc(${BIG}, 'e'));`,
    'process.exitCode = 3;'
  ].join('\n') + '\n');
  return file;
}

function exitOnFailureFixture(dir, name, command) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [
    `const { execCaptured } = require(${JSON.stringify(HELPER)});`,
    'try {',
    `  execCaptured(${JSON.stringify(command)});`,
    '  process.exitCode = 0;',
    '} catch (error) {',
    '  process.exit(3);',
    '}'
  ].join('\n') + '\n');
  return file;
}

function fileExitOnFailureFixture(dir, name, file, args) {
  const script = path.join(dir, name);
  fs.writeFileSync(script, [
    `const { execFileCaptured } = require(${JSON.stringify(HELPER)});`,
    'try {',
    `  execFileCaptured(${JSON.stringify(file)}, ${JSON.stringify(args)});`,
    '  process.exitCode = 0;',
    '} catch (error) {',
    '  process.exit(3);',
    '}'
  ].join('\n') + '\n');
  return script;
}

function spawnNode(dir, scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: dir });
    const out = [];
    const err = [];
    const swallow = () => {};
    child.stdout.on('error', swallow);
    child.stderr.on('error', swallow);
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => resolve({
      code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8')
    }));
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

describe('execCaptured', () => {
  test('keeps a JSON stdout parseable byte for byte while forwarding both streams', async () => {
    const dir = tempDir('json');
    const command = `node -e "process.stdout.write(JSON.stringify({version:'1.2.3',ok:true}));process.stderr.write('note: reading the release channel')"`;
    const run = await runHelper(dir, { command });

    expect(run.code).toBe(0);
    expect(run.record.ok).toBe(true);
    expect(run.record.value.kind).toBe('string');
    expect(run.record.value.value).toBe('{"version":"1.2.3","ok":true}');
    expect(JSON.parse(run.record.value.value)).toEqual({ version: '1.2.3', ok: true });
    expect(run.stdout).toBe('{"version":"1.2.3","ok":true}');
    expect(run.stderr).toBe('note: reading the release channel');
  });

  test('retains captured stdout far past 8 KiB', async () => {
    const dir = tempDir('large');
    const run = await runHelper(dir, { command: `node -e "process.stdout.write('x'.repeat(9000))"` });

    expect(run.code).toBe(0);
    expect(run.record.ok).toBe(true);
    expect(run.record.value.kind).toBe('string');
    expect(run.record.value.value).toHaveLength(9000);
    expect(run.stdout).toHaveLength(9000);
  });

  test('preserves status, stdout and stderr on a nonzero exit and prints stderr once', async () => {
    const dir = tempDir('failure');
    const command = `node -e "process.stdout.write('partial build output');process.stderr.write('boom: the signature check failed');process.exit(3)"`;
    const run = await runHelper(dir, { command });

    expect(run.record.ok).toBe(false);
    expect(run.record.status).toBe(3);
    expect(run.record.signal).toBeNull();
    expect(run.record.stdout).toEqual({ kind: 'string', value: 'partial build output' });
    expect(run.record.stderr).toEqual({ kind: 'string', value: 'boom: the signature check failed' });
    expect(run.record.message).toContain(`Command failed: ${command}`);
    expect(run.record.message).toContain('Exit 3');
    expect(run.stdout).toBe('partial build output');
    expect(run.stderr.split('boom: the signature check failed')).toHaveLength(2);
  });

  test('preserves a timeout as ETIMEDOUT with its signal', async () => {
    const dir = tempDir('timeout');
    const run = await runHelper(dir, {
      command: `node -e "setTimeout(() => {}, 5000)"`,
      options: { timeout: 300 }
    });

    expect(run.record.ok).toBe(false);
    expect(run.record.status).toBeNull();
    expect(run.record.code).toBe('ETIMEDOUT');
    expect(run.record.signal).toBe('SIGTERM');
    expect(run.record.cause).toContain('ETIMEDOUT');
  });

  test('leaves inherited stdio inherited and returns nothing for it', async () => {
    const dir = tempDir('inherit');
    const run = await runHelper(dir, {
      command: `node -e "process.stdout.write('inherited out\\n');process.stderr.write('inherited err\\n')"`,
      options: { stdio: 'inherit' }
    });

    expect(run.record.ok).toBe(true);
    expect(run.record.value.kind).toBe('null');
    expect(run.record.value.value).toBeNull();
    expect(run.stdout).toBe('inherited out\n');
    expect(run.stderr).toBe('inherited err\n');
  });

  test('forwards a Buffer result without altering it', async () => {
    const dir = tempDir('buffer');
    const run = await runHelper(dir, {
      command: `node -e "process.stdout.write('raw bytes')"`,
      options: { encoding: 'buffer' }
    });

    expect(run.record.ok).toBe(true);
    expect(run.record.value.kind).toBe('buffer');
    expect(Buffer.from(run.record.value.base64, 'base64').toString('utf8')).toBe('raw bytes');
    expect(run.stdout).toBe('raw bytes');
  });

  test('delivers every forwarded stream into the transcript the supervisor writes', async () => {
    const dir = tempDir('transcript');
    const child = path.join(dir, 'child.js');
    const okCommand = `node -e "process.stdout.write(JSON.stringify({captured:true}));process.stderr.write('captured stderr note')"`;
    const failCommand = `node -e "process.stderr.write('failed stderr note');process.exit(4)"`;

    fs.writeFileSync(child, [
      `const { execCaptured } = require(${JSON.stringify(HELPER)});`,
      "process.stdout.write('pointer=' + process.env.HYPERCLAY_RELEASE_LOG + '\\n');",
      `const value = execCaptured(${JSON.stringify(okCommand)});`,
      "process.stdout.write('parsed=' + JSON.parse(value).captured + '\\n');",
      'try {',
      `  execCaptured(${JSON.stringify(failCommand)});`,
      '} catch (error) {',
      "  process.stdout.write('caught=' + error.status + ' ' + error.message.split('\\n').pop() + '\\n');",
      '}'
    ].join('\n') + '\n');

    const out = collector();
    const err = collector();
    const result = await withDeadline(superviseRelease({
      scriptPath: child,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'transcript');

    expect(result.code).toBe(0);
    expect(result.complete).toBe(true);

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain(`pointer=${result.logPath}`);
    expect(text).toContain('"captured":true');
    expect(text).toContain('parsed=true');
    expect(text).toContain('captured stderr note');
    expect(text).toContain('failed stderr note');
    expect(text).toContain('caught=4 Exit 4');
    expect(out.text()).toContain('"captured":true');
    expect(err.text()).toContain('captured stderr note');
  });

  test('delivers all 250000 stdout bytes and all 250000 stderr bytes when the wrapper exits immediately', async () => {
    const dir = tempDir('immediate-exit');
    const inner = bigOutputFixture(dir, 'inner.js');
    const wrapper = exitOnFailureFixture(dir, 'wrapper.js', `node ${inner}`);
    const run = await spawnNode(dir, wrapper);

    expect(run.code).toBe(3);
    expect(run.stdout).toBe('o'.repeat(BIG));
    expect(run.stderr).toBe('e'.repeat(BIG));
  });

  test('keeps both 250000 byte streams whole in the supervisor transcript and reports status 3', async () => {
    const dir = tempDir('immediate-exit-transcript');
    const inner = bigOutputFixture(dir, 'inner.js');
    const wrapper = exitOnFailureFixture(dir, 'wrapper.js', `node ${inner}`);
    const out = collector();
    const err = collector();

    const result = await withDeadline(superviseRelease({
      scriptPath: wrapper,
      cwd: dir,
      logRoot: path.join(dir, 'logs'),
      stdout: out.stream,
      stderr: err.stream
    }), 'immediate-exit-transcript');

    expect(result.code).toBe(3);
    expect(result.complete).toBe(true);

    const text = fs.readFileSync(result.logPath, 'utf8');
    expect(text).toContain('o'.repeat(BIG));
    expect(text).toContain('e'.repeat(BIG));
    expect(out.text()).toBe('o'.repeat(BIG));
    expect(err.text()).toContain('e'.repeat(BIG));
  });

  test('hands inherited stdio straight through for output larger than a pipe buffer', async () => {
    const dir = tempDir('inherit-large');
    const command = `node -e "process.stdout.write('o'.repeat(${BIG}));process.stderr.write('e'.repeat(${BIG}))"`;
    const run = await runHelper(dir, { command, options: { stdio: 'inherit' } });

    expect(run.code).toBe(0);
    expect(run.record.ok).toBe(true);
    expect(run.record.value).toEqual({ kind: 'null', value: null });
    expect(run.stdout).toBe('o'.repeat(BIG));
    expect(run.stderr).toBe('e'.repeat(BIG));
  });

  test('returns the command exit status when the receiving pipe is already broken', async () => {
    const dir = tempDir('broken-pipe');
    const go = path.join(dir, 'go');
    const recordPath = path.join(dir, 'record.json');
    const inner = bigOutputFixture(dir, 'inner.js');
    const runner = path.join(dir, 'runner.js');

    fs.writeFileSync(runner, [
      "const fs = require('fs');",
      `const { execCaptured } = require(${JSON.stringify(HELPER)});`,
      'const wait = new Int32Array(new SharedArrayBuffer(4));',
      'const deadline = Date.now() + 10000;',
      `while (!fs.existsSync(${JSON.stringify(go)})) {`,
      '  if (Date.now() > deadline) process.exit(98);',
      '  Atomics.wait(wait, 0, 0, 5);',
      '}',
      'let record;',
      'try {',
      `  execCaptured(${JSON.stringify(`node ${inner}`)});`,
      '  record = { ok: true };',
      '} catch (error) {',
      '  record = { ok: false, status: error.status === undefined ? null : error.status, message: error.message };',
      '}',
      `fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record));`
    ].join('\n') + '\n');

    const run = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runner], { cwd: dir });
      const out = [];
      const err = [];
      const swallow = () => {};
      child.stdout.on('error', swallow);
      child.stderr.on('error', swallow);
      child.stdout.on('data', chunk => out.push(chunk));
      child.stderr.on('data', chunk => err.push(chunk));
      child.on('error', reject);
      child.stdout.destroy();
      fs.writeFileSync(go, '1');
      child.on('close', code => resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8')
      }));
    });

    expect(run.code).toBe(0);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    expect(record.ok).toBe(false);
    expect(record.status).toBe(3);
    expect(record.message).toContain('Exit 3');
    expect(run.stdout).toBe('');
  });
});

describe('execFileCaptured', () => {
  test('keeps a literal argument that looks like shell syntax inert even when shell is requested', async () => {
    const dir = tempDir('file-shell');
    const sentinel = path.join(dir, 'sentinel');
    const run = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', "process.stdout.write('literal')", `; touch ${sentinel}`],
      options: { shell: true }
    });

    expect(run.code).toBe(0);
    expect(run.record.ok).toBe(true);
    expect(run.record.value).toEqual({ kind: 'string', value: 'literal' });
    expect(run.stdout).toBe('literal');
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  test('returns the exact captured string and the exact captured Buffer', async () => {
    const dir = tempDir('file-capture');
    const asString = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', "process.stdout.write('exact bytes')"]
    });

    expect(asString.code).toBe(0);
    expect(asString.record.ok).toBe(true);
    expect(asString.record.value).toEqual({ kind: 'string', value: 'exact bytes' });
    expect(asString.stdout).toBe('exact bytes');

    const asBuffer = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', 'process.stdout.write(Buffer.from([104, 105, 255, 106]))'],
      options: { encoding: null }
    });

    expect(asBuffer.code).toBe(0);
    expect(asBuffer.record.ok).toBe(true);
    expect(asBuffer.record.value.kind).toBe('buffer');
    expect(Buffer.from(asBuffer.record.value.base64, 'base64')).toEqual(Buffer.from([104, 105, 255, 106]));
  });

  test('stays quiet about successful metadata stdout while forwarding stderr and the captured value', async () => {
    const dir = tempDir('file-quiet');
    const run = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', "process.stdout.write('{\"version\":\"1.2.3\"}');process.stderr.write('diagnostic note')"],
      options: { echoStdout: false }
    });

    expect(run.code).toBe(0);
    expect(run.record.ok).toBe(true);
    expect(run.record.value).toEqual({ kind: 'string', value: '{"version":"1.2.3"}' });
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('diagnostic note');
  });

  test('still prints the failed stdout the caller asked to keep quiet', async () => {
    const dir = tempDir('file-failure-quiet');
    const run = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', "process.stdout.write('partial metadata');process.stderr.write('boom: metadata read failed');process.exit(3)"],
      options: { echoStdout: false }
    });

    expect(run.record.ok).toBe(false);
    expect(run.record.status).toBe(3);
    expect(run.record.signal).toBeNull();
    expect(run.record.stdout).toEqual({ kind: 'string', value: 'partial metadata' });
    expect(run.record.stderr).toEqual({ kind: 'string', value: 'boom: metadata read failed' });
    expect(run.record.message).toContain(`Command failed: ${process.execPath}`);
    expect(run.record.message).toContain('Exit 3');
    expect(run.stdout).toBe('partial metadata');
    expect(run.stderr.split('boom: metadata read failed')).toHaveLength(2);
  });

  test('delivers every captured byte when the caller exits immediately on failure', async () => {
    const dir = tempDir('file-immediate-exit');
    const inner = bigOutputFixture(dir, 'inner.js');
    const wrapper = fileExitOnFailureFixture(dir, 'wrapper.js', process.execPath, [inner]);
    const run = await spawnNode(dir, wrapper);

    expect(run.code).toBe(3);
    expect(run.stdout).toBe('o'.repeat(BIG));
    expect(run.stderr).toBe('e'.repeat(BIG));
  });

  test('retains ENOENT metadata for a missing executable', async () => {
    const dir = tempDir('file-enoent');
    const missing = path.join(dir, 'missing-binary');
    const run = await runHelper(dir, {
      target: 'execFileCaptured',
      file: missing,
      args: [],
      options: { echoStdout: false }
    });

    expect(run.record.ok).toBe(false);
    expect(run.record.status).toBeNull();
    expect(run.record.signal).toBeNull();
    expect(run.record.code).toBe('ENOENT');
    expect(run.record.cause).toContain('ENOENT');
    expect(run.record.message).toContain(`Command failed: ${missing}`);
    expect(run.record.stdout).toEqual({ kind: 'undefined', value: null });
    expect(run.record.stderr).toEqual({ kind: 'undefined', value: null });
    expect(run.record.output).toBeNull();
  });

  test('retains timeout metadata for a subprocess that never returns', async () => {
    const dir = tempDir('file-timeout');
    const run = await runHelper(dir, {
      target: 'execFileCaptured',
      file: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      options: { timeout: 300 }
    });

    expect(run.record.ok).toBe(false);
    expect(run.record.status).toBeNull();
    expect(run.record.code).toBe('ETIMEDOUT');
    expect(run.record.signal).toBe('SIGTERM');
    expect(run.record.cause).toContain('ETIMEDOUT');
    expect(run.record.message).toContain(`Command failed: ${process.execPath}`);
  });
});
