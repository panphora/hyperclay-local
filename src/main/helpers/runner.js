// One structured helper invocation, the way htmlclay/internal/helper/runner.go
// runs it: the login shell's PATH, the stamped envelope on stdin, the JSONL
// records of jsonl.js, and a host error for anything the protocol does not
// accept. Raw mode belongs to external handlers, so only structured mode lives
// here.
//
// run() emits each status as it arrives and the one terminal event last, and
// also resolves with that terminal, so a caller can wire frames as they are
// produced and still know how the request ended.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  ByteReader,
  RecordTooLargeError,
  readRecord,
  stampProtocol,
  failureDetails,
  limitDetails,
  MAX_RECORD,
  MAX_TERMINAL_RECORD,
  STRUCTURED_DEADLINE_MS,
} = require('./jsonl');

const KILL_DELAY_MS = 5000;
const CHILD_DRAIN_MS = 2000;
const LOGIN_PATH_BUDGET_MS = 3000;
const LOGIN_PATH_WAIT_DELAY_MS = 1000;

let loginPathPromise = null;

// loginPath, path.go:13-21: resolved once per process, because a Finder-launched
// app inherits launchd's short PATH and a helper installed by Homebrew or npm
// would not be found.
function loginPath() {
  if (!loginPathPromise) loginPathPromise = resolveLoginPath();
  return loginPathPromise;
}

function refreshLoginPath() {
  loginPathPromise = resolveLoginPath();
  return loginPathPromise;
}

// resolveLoginPath, path_other.go:20-44. The budget covers the login shell's
// stdout reaching EOF, not just the shell exiting: a profile that backgrounds
// something inheriting stdout keeps that pipe open after the shell is gone, and
// the extra wait is what closes it.
async function resolveLoginPath() {
  if (process.platform === 'win32') return '';
  const shell = process.env.SHELL;
  if (!shell) return '';
  const child = spawn(shell, ['-l', '-c', 'printf %s "$PATH"'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks = [];
  let drained = false;
  child.stdout.on('data', chunk => chunks.push(chunk));
  const outputDone = new Promise(resolve => {
    child.stdout.once('end', () => { drained = true; resolve(); });
    child.stdout.once('close', resolve);
    child.stdout.once('error', resolve);
  });
  const budget = setTimeout(() => child.kill('SIGKILL'), LOGIN_PATH_BUDGET_MS);
  const code = await new Promise(resolve => child.once('exit', resolve));
  const waitDelay = setTimeout(() => child.stdout.destroy(), LOGIN_PATH_WAIT_DELAY_MS);
  await outputDone;
  clearTimeout(budget);
  clearTimeout(waitDelay);
  if (code !== 0 || !drained) return '';
  return Buffer.concat(chunks).toString('utf8').trim();
}

// helper.go:366: the child gets the file it is working on and the id of the
// request, so a helper that writes its own log can say which request it served.
// The request envelope carries both; spec.file and spec.id override it.
function wireEnv(baseEnv, spec) {
  const request = requestFields(spec.stdin);
  const env = { ...baseEnv };
  const file = spec.file === undefined ? request.file : spec.file;
  const id = spec.id === undefined ? request.id : spec.id;
  if (typeof file === 'string') env.HTMLCLAY_WIRE_FILE = file;
  if (typeof id === 'string') env.HTMLCLAY_WIRE_ID = id;
  return env;
}

function requestFields(stdin) {
  if (stdin && typeof stdin === 'object' && !Buffer.isBuffer(stdin) && !Array.isArray(stdin)) return stdin;
  if (typeof stdin !== 'string' && !Buffer.isBuffer(stdin)) return {};
  try {
    const parsed = JSON.parse(Buffer.isBuffer(stdin) ? stdin.toString('utf8') : stdin);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// withPath, path.go:28-42.
function withPath(env, value) {
  if (!value) return env;
  const out = { ...env };
  const key = Object.keys(out).find(name => name.toUpperCase() === 'PATH');
  out[key || 'PATH'] = value;
  return out;
}

function hostError(code, text, details = null) {
  return { kind: 'error', text, code, details, source: 'host' };
}

// contextError, runner.go:481-486.
function contextError(stop) {
  if (stop === 'timeout') return hostError('helper_timeout', 'helper timed out');
  return hostError('helper_cancelled', 'helper cancelled');
}

// retryablePathFailure, runner.go:468-479. The source is part of the test: both
// codes are valid application codes too, and a helper that exits zero having
// reported one would otherwise run a second time and repeat every side effect.
function retryablePathFailure(event) {
  return event.kind === 'error' && event.source === 'host'
    && (event.code === 'helper_start_failed' || event.code === 'helper_interpreter_missing');
}

function loginPathEnabled(spec) {
  return spec.loginPath !== false;
}

async function run(spec, emit = () => {}) {
  const deadlineMs = spec.deadlineMs === undefined ? STRUCTURED_DEADLINE_MS : spec.deadlineMs;
  const baseEnv = spec.env === undefined ? process.env : spec.env;
  const refreshPath = loginPathEnabled(spec) && process.platform !== 'win32';
  const state = { stop: null };
  const attempt = { ...spec, deadlineMs };

  // The deadline covers both attempts, the way Run's context does: the retry
  // after a start failure does not get a second budget.
  const deadlineAt = deadlineMs > 0 ? Date.now() + deadlineMs : 0;
  const wire = wireEnv(baseEnv, spec);
  let env = wire;
  if (refreshPath) env = withPath(wire, await loginPath());
  let terminal = await runOnce({ ...attempt, env }, emit, state, deadlineAt);
  if (refreshPath && !state.stop && retryablePathFailure(terminal)) {
    terminal = await runOnce({ ...attempt, env: withPath(wire, await refreshLoginPath()) }, emit, state, deadlineAt);
  }
  emit(terminal);
  if (spec.stderr) spec.stderr.write(`${terminal.kind === 'error' ? `error: ${terminal.text}` : 'done'}\n`);
  return terminal;
}

async function runOnce(spec, emit, state, deadlineAt) {
  let argv;
  try {
    argv = resolveArgv(spec.argv);
  } catch (err) {
    return structuredStartFailure(spec, state, (spec.argv && spec.argv[0]) || '', err);
  }

  let input;
  try {
    input = stampProtocol(spec.stdin === undefined ? {} : spec.stdin, spec.document || 'none');
  } catch (err) {
    return hostError('helper_bad_output', 'cannot prepare the helper request', failureDetails('request', err.message));
  }

  const child = spawn(argv[0], argv.slice(1), {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', spec.stderr ? 'pipe' : 'ignore'],
    windowsHide: true,
  });
  if (spec.stderr && child.stderr) child.stderr.pipe(spec.stderr, { end: false });

  const startError = await new Promise(resolve => {
    let settled = false;
    child.once('spawn', () => { if (!settled) { settled = true; resolve(null); } });
    child.once('error', err => { if (!settled) { settled = true; resolve(err); } });
  });
  if (startError) {
    if (child.stdin) child.stdin.destroy();
    return structuredStartFailure(spec, state, argv[0], startError);
  }

  child.stdin.on('error', () => {});
  child.stdin.end(input);

  const reader = new ByteReader(child.stdout);
  let terminalRecord = null;
  let cleanEof = false;
  let stopEvent = null;
  let committed = false;
  let killTimer = null;
  let killed = false;

  const stopChild = () => {
    if (killed || child.exitCode !== null || child.signalCode !== null) return;
    killed = true;
    if (process.platform === 'win32') {
      child.kill();
      return;
    }
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_DELAY_MS);
  };

  // stopLatch, runner.go:153-179: the first host stop is the one that wins.
  const stop = event => {
    if (stopEvent || committed) return false;
    stopEvent = event;
    stopChild();
    child.stdout.destroy();
    return true;
  };
  const commit = event => {
    committed = true;
    return stopEvent || event;
  };

  const readDone = (async () => {
    for (;;) {
      let record;
      try {
        record = await readRecord(reader, MAX_RECORD);
      } catch (err) {
        const details = err instanceof RecordTooLargeError
          ? limitDetails('record', MAX_RECORD)
          : failureDetails('record', err.message);
        stop(hostError('helper_bad_output', `invalid helper output: ${err.message}`, details));
        return;
      }
      if (record === null) {
        cleanEof = true;
        return;
      }
      if (terminalRecord) {
        stop(hostError('helper_bad_output', 'helper wrote a record after its terminal record', failureDetails('record', record.type)));
        return;
      }
      if (record.type === 'status') {
        emit({ kind: 'status', text: record.text, progress: record.progress || undefined });
      } else if (record.type === 'result') {
        terminalRecord = { kind: 'result', value: record.value };
      } else {
        terminalRecord = { kind: 'error', text: record.message, code: record.code, details: record.details, source: 'application' };
      }
    }
  })();

  const deadlineTimer = deadlineAt > 0
    ? setTimeout(() => {
      state.stop = 'timeout';
      stop(contextError('timeout'));
    }, Math.max(deadlineAt - Date.now(), 0))
    : null;
  const onAbort = () => {
    state.stop = 'cancelled';
    stop(contextError('cancelled'));
  };
  if (spec.signal) {
    if (spec.signal.aborted) onAbort();
    else spec.signal.addEventListener('abort', onAbort, { once: true });
  }

  const exit = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  if (killTimer) clearTimeout(killTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (spec.signal) spec.signal.removeEventListener('abort', onAbort);

  if (state.stop) stop(contextError(state.stop));
  const exitZero = exit.code === 0;
  const waitText = exit.signal ? `signal ${exit.signal}` : `exit status ${exit.code}`;
  if (!exitZero && !state.stop) {
    if (loginPathEnabled(spec) && exit.code === 127) {
      const interpreter = missingEnvInterpreter(argv[0], spec.env, spec.cwd);
      stop(interpreter ? interpreterFailure(argv[0], interpreter) : hostError('helper_crashed', waitText));
    } else {
      stop(hostError('helper_crashed', waitText));
    }
  }

  const drained = await withTimeout(readDone, CHILD_DRAIN_MS);
  if (!drained) {
    stop(hostError('helper_bad_output', 'helper stdout did not reach clean EOF', failureDetails('stdout', `${CHILD_DRAIN_MS / 1000}s`)));
    child.stdout.destroy();
    await readDone;
  }

  let terminal;
  if (terminalRecord && cleanEof && exitZero) terminal = terminalRecord;
  else if (exitZero) terminal = hostError('helper_no_result', 'helper exited without a terminal record');
  else terminal = hostError('helper_crashed', waitText);

  if (state.stop) stop(contextError(state.stop));
  return applyResultLimit(commit(terminal), spec.resultLimit);
}

// helperEventEnvelope, internal/server/helper.go:431-434: a result past the
// request's cap reaches the page as helper_result_too_large. Structured requests
// use the terminal-record limit, describe requests the 8 KiB one, so this only
// fires on its own for a request that declares a smaller cap.
function applyResultLimit(terminal, resultLimit) {
  const limit = resultLimit === undefined ? MAX_TERMINAL_RECORD : resultLimit;
  if (terminal.kind !== 'result' || !(limit > 0)) return terminal;
  if (Buffer.byteLength(terminal.value, 'utf8') <= limit) return terminal;
  return hostError('helper_result_too_large', 'helper result exceeds its byte limit', limitDetails('result', limit));
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([promise.then(() => true), timeout]).finally(() => clearTimeout(timer));
}

// resolveArgv, runner.go:313-329: a relative program is resolved against the
// host's PATH, not the login PATH handed to the child.
function resolveArgv(argv) {
  if (!argv || argv.length === 0) throw new Error('no helper command');
  const resolved = argv.slice();
  if (!path.isAbsolute(resolved[0])) {
    const found = lookPath(resolved[0]);
    if (!found) throw new Error(`exec: "${resolved[0]}": executable file not found in $PATH`);
    resolved[0] = path.resolve(found);
  }
  return resolved;
}

function lookPath(name) {
  const list = process.env.PATH || '';
  for (const base of list.split(path.delimiter)) {
    if (!base) continue;
    const candidate = path.join(base, name);
    try {
      if (fs.statSync(candidate).isFile() && hasExecuteBit(candidate)) return candidate;
    } catch { /* not in this entry */ }
  }
  return null;
}

function hasExecuteBit(target) {
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function structuredStartFailure(spec, state, target, err) {
  if (!loginPathEnabled(spec)) {
    if (state.stop) return contextError(state.stop);
    return hostError('helper_start_failed', err.message);
  }
  return startFailure(spec, state, target, err);
}

// startFailure, runner.go:364-386: name what the user can act on — a missing
// program, one without its execute bit, and the interpreter its shebang asks for.
function startFailure(spec, state, target, err) {
  if (state.stop) return contextError(state.stop);
  if (!target) return hostError('helper_start_failed', err.message);
  let info = null;
  try {
    info = fs.statSync(target);
  } catch {
    info = null;
  }
  if (!info) return hostError('helper_start_failed', `helper program does not exist: ${target}`);
  if (process.platform !== 'win32' && (info.mode & 0o111) === 0) {
    return hostError('helper_start_failed', `helper program is not executable: ${target}`);
  }
  if (err.code === 'ENOENT') {
    const interpreter = interpreterName(target);
    if (interpreter) return interpreterFailure(target, interpreter);
  }
  return hostError('helper_start_failed', `could not start helper ${target}: ${err.message}`);
}

function interpreterFailure(target, interpreter) {
  return hostError('helper_interpreter_missing', `helper interpreter ${JSON.stringify(interpreter)} is unavailable for ${target}`);
}

function interpreterName(target) {
  const fields = shebangFields(target);
  if (fields.length === 0) return '';
  if (path.basename(fields[0]) !== 'env') return path.basename(fields[0]);
  return envInterpreter(fields);
}

function missingEnvInterpreter(target, env, dir) {
  const fields = shebangFields(target);
  if (fields.length === 0 || path.basename(fields[0]) !== 'env') return '';
  const name = envInterpreter(fields);
  if (!name || executableInEnv(name, env, dir)) return '';
  return name;
}

// shebangFields, runner.go:415-427: the first 4 KiB of the program, which is all
// a shebang can occupy.
function shebangFields(target) {
  let text;
  try {
    const fd = fs.openSync(target, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
      text = buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const line = text.split('\n')[0].trim();
  if (!line.startsWith('#!')) return [];
  return line.slice(2).trim().split(/\s+/).filter(Boolean);
}

function envInterpreter(fields) {
  for (const field of fields.slice(1)) {
    if (field.startsWith('-') || field.includes('=')) continue;
    return path.basename(field);
  }
  return '';
}

function executableInEnv(name, env, dir) {
  const list = (env && env.PATH) || '';
  for (let base of list.split(path.delimiter)) {
    if (!path.isAbsolute(base) && dir) base = path.join(dir, base);
    try {
      const info = fs.statSync(path.join(base, name));
      if (!info.isDirectory() && (info.mode & 0o111) !== 0) return true;
    } catch { /* not in this entry */ }
  }
  return false;
}

module.exports = {
  run,
  loginPath,
  refreshLoginPath,
  loginPathEnabled,
  withPath,
  KILL_DELAY_MS,
  CHILD_DRAIN_MS,
};
