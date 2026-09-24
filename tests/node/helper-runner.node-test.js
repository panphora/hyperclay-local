// The structured helper runner (src/main/helpers/runner.js) against the six
// fixtures in tests/fixtures/helpers, plus the start-failure and login-PATH
// paths. Where a case answers to a Go case, the Go test name leads its title
// (htmlclay/cmd/htmlclay/jsonl_test.go, htmlclay/internal/helper/runner.go).
//
// Every child a case starts is gone when the case ends: the cancel and timeout
// cases read the pid the fixture wrote and watch it disappear.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, loginPath } = require('../../src/main/helpers/runner');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'helpers');
const NODE = process.execPath;
const DESCRIBE_RESULT_LIMIT = 8 * 1024;

function fixture(name) {
  return path.join(FIXTURES, name);
}

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-runner-')));
}

function env(extra = {}) {
  return { ...process.env, ...extra };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// A cold node start is normally tens of milliseconds, but these tests run in
// parallel with every other node test file, so the wait is generous: a child
// that has not written its pid within five seconds did not start.
async function readPid(file) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return Number(fs.readFileSync(file, 'utf8'));
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  throw new Error(`the fixture never wrote ${file}`);
}

async function assertGone(pid) {
  const deadline = Date.now() + 3000;
  while (alive(pid)) {
    if (Date.now() > deadline) assert.fail(`child ${pid} is still running`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('TestRunStructuredCompletionState: a result record is the terminal and carries its value', async () => {
  const events = [];
  const terminal = await run({
    argv: [NODE, fixture('echo-result.js'), '--flag'],
    cwd: tempDir(),
    env: env(),
    stdin: { v: 1, type: 'wire/request', id: 'req-1', helper: 'echo' },
    deadlineMs: 10000,
  }, event => events.push(event));

  assert.equal(terminal.kind, 'result');
  assert.deepEqual(JSON.parse(terminal.value).argv, ['--flag']);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'result');
});

test('a status is emitted as it arrives, before the held terminal record', async () => {
  const events = [];
  const terminal = await run({
    argv: [NODE, fixture('status-then-result.js')],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  }, event => events.push(event));

  assert.deepEqual(events.map(event => event.kind), ['status', 'result']);
  assert.equal(events[0].text, 'Scanning');
  assert.deepEqual(JSON.parse(events[0].progress), { completed: 1, total: 2, unit: 'files' });
  assert.deepEqual(JSON.parse(terminal.value), { matches: ['notes/a.txt:12:needle'] });
});

test('a record after the terminal record is helper_bad_output', async () => {
  const terminal = await run({
    argv: [NODE, fixture('two-terminals.js')],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_bad_output');
  assert.equal(terminal.source, 'host');
  assert.deepEqual(JSON.parse(terminal.details), { field: 'record', reason: 'result' });
});

test('TestRunStructuredCompletionState: a nonzero exit is helper_crashed', async () => {
  const terminal = await run({
    argv: [NODE, fixture('exit-nonzero.js')],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_crashed');
  assert.equal(terminal.source, 'host');
  assert.match(terminal.text, /exit status 3/);
});

test('TestRunStructuredCompletionState: a zero exit with no terminal record is helper_no_result', async () => {
  const terminal = await run({
    argv: [NODE, '-e', ''],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_no_result');
  assert.equal(terminal.source, 'host');
});

test('TestRunStructuredUsesDocumentDirectory: the child runs in the document directory', async () => {
  const cwd = tempDir();
  const terminal = await run({
    argv: [NODE, fixture('echo-result.js')],
    cwd,
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(JSON.parse(terminal.value).cwd, cwd);
});

test('the runner sets HTMLCLAY_WIRE_FILE and HTMLCLAY_WIRE_ID from the request', async () => {
  const terminal = await run({
    argv: [NODE, fixture('echo-result.js')],
    cwd: tempDir(),
    env: env(),
    stdin: { v: 1, type: 'wire/request', id: 'req-42', file: '/tmp/page.htmlclay', helper: 'echo' },
    deadlineMs: 10000,
  });

  const value = JSON.parse(terminal.value);
  assert.equal(value.wireFile, '/tmp/page.htmlclay');
  assert.equal(value.wireId, 'req-42');
});

test('stdin carries the stamped envelope with helperProtocol 1 and the document mode', async () => {
  const terminal = await run({
    argv: [NODE, fixture('echo-result.js')],
    cwd: tempDir(),
    env: env(),
    stdin: { v: 1, type: 'wire/request', id: 'req-7', helper: 'echo', payload: { query: 'needle' } },
    document: 'edit',
    deadlineMs: 10000,
  });

  assert.deepEqual(JSON.parse(terminal.value).envelope, {
    v: 1,
    type: 'wire/request',
    id: 'req-7',
    helper: 'echo',
    payload: { query: 'needle' },
    helperProtocol: 1,
    document: 'edit',
  });
});

test('the login shell PATH replaces the one the host was started with', { skip: process.platform === 'win32' }, async () => {
  const resolved = await loginPath();
  const terminal = await run({
    argv: [NODE, fixture('echo-result.js')],
    cwd: tempDir(),
    env: env({ PATH: '/nonexistent-path-entry' }),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(JSON.parse(terminal.value).path, resolved || '/nonexistent-path-entry');
});

test('TestRunStructuredDeadlineHasItsOwnHostCode: the deadline is helper_timeout and the child is gone', async () => {
  const pidFile = path.join(tempDir(), 'pid');
  const terminal = await run({
    argv: [NODE, fixture('sleep-forever.js')],
    cwd: tempDir(),
    env: env({ HTMLCLAY_TEST_PID_FILE: pidFile }),
    stdin: {},
    deadlineMs: 5000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_timeout');
  assert.equal(terminal.source, 'host');
  await assertGone(await readPid(pidFile));
});

test('TestRunStructuredExternalCancellationBeatsAHeldResult: a cancel is helper_cancelled and the child is gone', async () => {
  const pidFile = path.join(tempDir(), 'pid');
  const controller = new AbortController();
  const running = run({
    argv: [NODE, fixture('sleep-forever.js')],
    cwd: tempDir(),
    env: env({ HTMLCLAY_TEST_PID_FILE: pidFile }),
    stdin: {},
    deadlineMs: 30000,
    signal: controller.signal,
  });

  const pid = await readPid(pidFile);
  controller.abort();
  const terminal = await running;

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_cancelled');
  assert.equal(terminal.source, 'host');
  await assertGone(pid);
});

test('a helper that ignores SIGTERM is killed, and the child is gone', async () => {
  const pidFile = path.join(tempDir(), 'pid');
  const controller = new AbortController();
  const running = run({
    argv: [NODE, fixture('sleep-forever.js')],
    cwd: tempDir(),
    env: env({ HTMLCLAY_TEST_PID_FILE: pidFile, HTMLCLAY_TEST_IGNORE_SIGTERM: '1' }),
    stdin: {},
    deadlineMs: 30000,
    signal: controller.signal,
  });

  const pid = await readPid(pidFile);
  controller.abort();
  const terminal = await running;

  assert.equal(terminal.code, 'helper_cancelled');
  await assertGone(pid);
});

test('TestRunStructuredStopsAChildAfterAnOversizedRecord: a result past the 512 KiB record limit is helper_bad_output', async () => {
  const terminal = await run({
    argv: [NODE, fixture('big-result.js')],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_bad_output');
  assert.equal(terminal.source, 'host');
  assert.deepEqual(JSON.parse(terminal.details), { field: 'record', limit: 512 * 1024 });
});

test('a result past the request result limit is helper_result_too_large', async () => {
  const terminal = await run({
    argv: [NODE, fixture('big-result.js')],
    cwd: tempDir(),
    env: env({ HTMLCLAY_TEST_RESULT_BYTES: '32768' }),
    stdin: {},
    deadlineMs: 10000,
    resultLimit: DESCRIBE_RESULT_LIMIT,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_result_too_large');
  assert.equal(terminal.source, 'host');
  assert.deepEqual(JSON.parse(terminal.details), { field: 'result', limit: DESCRIBE_RESULT_LIMIT });
});

test('a result under the request result limit is kept whole', async () => {
  const terminal = await run({
    argv: [NODE, fixture('big-result.js')],
    cwd: tempDir(),
    env: env({ HTMLCLAY_TEST_RESULT_BYTES: '4096' }),
    stdin: {},
    deadlineMs: 10000,
    resultLimit: DESCRIBE_RESULT_LIMIT,
  });

  assert.equal(terminal.kind, 'result');
  assert.equal(JSON.parse(terminal.value).length, 4096);
});

test('a program that cannot start is helper_start_failed, naming the path', async () => {
  const missing = path.join(tempDir(), 'no-such-helper.js');
  const terminal = await run({
    argv: [missing],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.kind, 'error');
  assert.equal(terminal.code, 'helper_start_failed');
  assert.equal(terminal.source, 'host');
  assert.ok(terminal.text.includes(missing));
});

test('a program without its execute bit is helper_start_failed', { skip: process.platform === 'win32' }, async () => {
  const file = path.join(tempDir(), 'not-executable.js');
  fs.writeFileSync(file, '#!/usr/bin/env node\nprocess.stdout.write(\'{"type":"result","value":true}\\n\');\n');
  const terminal = await run({
    argv: [file],
    cwd: tempDir(),
    env: env(),
    stdin: {},
    deadlineMs: 10000,
  });

  assert.equal(terminal.code, 'helper_start_failed');
  assert.match(terminal.text, /not executable/);
});
