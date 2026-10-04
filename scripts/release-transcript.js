'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const RELEASE_LABEL = 'Hyperclay release transcript';
const WORKER_ENV = 'HYPERCLAY_RELEASE_LOG_WORKER';
const POINTER_ENV = 'HYPERCLAY_RELEASE_LOG';
const CAPTURE_ENV = 'HYPERSAVE_RELEASE_CAPTURE';
const CAPTURE_LOG_ENV = 'HYPERSAVE_RELEASE_LOG';
const LOG_FILENAME = 'release.log';
const DEFAULT_LOG_ROOT = path.join(os.homedir(), '.cache', 'hyperclay-local', 'releases');

const REDACTIONS = [
  [/npm_[A-Za-z0-9]{20,}/g, '<redacted:npm_token>'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, '<redacted:github_token>'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '<redacted:github_token>'],
  [/sk-[A-Za-z0-9_-]{16,}/g, '<redacted:api_key>'],
  [/AKIA[0-9A-Z]{12,}/g, '<redacted:aws_key>'],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1<redacted:bearer_token>'],
  [/(--(?:token|password|passwd|auth|authtoken|_authtoken|api-key|apikey|secret)=)\S+/gi,
    '$1<redacted:flag_value>']
];

const DEFAULT_FS = {
  mkdirSync: fs.mkdirSync,
  mkdtempSync: fs.mkdtempSync,
  chmodSync: fs.chmodSync,
  openSync: fs.openSync,
  writeSync: fs.writeSync,
  closeSync: fs.closeSync
};

function describeError(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function externalCapturePath(env) {
  if (!env || env[CAPTURE_ENV] !== '1') return null;
  const target = env[CAPTURE_LOG_ENV];
  if (typeof target !== 'string' || target === '' || !path.isAbsolute(target)) return null;
  return target;
}

function terminalWriter(stream) {
  const onError = () => {};
  let listening = false;
  if (stream && typeof stream.on === 'function' && typeof stream.removeListener === 'function') {
    stream.on('error', onError);
    listening = true;
  }
  return {
    write(chunk) {
      if (!stream || typeof stream.write !== 'function') return;
      try {
        stream.write(chunk);
      } catch (error) {}
    },
    detach() {
      if (!listening) return;
      try {
        stream.removeListener('error', onError);
      } catch (error) {}
    }
  };
}

function openFileSink(root, fsOps) {
  fsOps.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = fsOps.mkdtempSync(path.join(root, utcStamp(new Date()) + '-'));
  fsOps.chmodSync(dir, 0o700);
  const logPath = path.join(dir, LOG_FILENAME);
  const fd = fsOps.openSync(logPath, 'w', 0o600);
  return { fd, logPath };
}

function openTranscript(logRoot, fsOps) {
  let lastError = null;
  for (const root of [logRoot, os.tmpdir()]) {
    try {
      return openFileSink(root, fsOps);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function createSink(fd, fsOps, onFailure) {
  let disabled = false;
  let closed = false;
  const closeDescriptor = () => {
    if (closed) return;
    closed = true;
    fsOps.closeSync(fd);
  };
  return {
    get disabled() {
      return disabled;
    },
    line(text) {
      if (disabled || closed || text === '') return;
      try {
        const bytes = Buffer.from(text, 'utf8');
        let offset = 0;
        while (offset < bytes.length) {
          const written = fsOps.writeSync(fd, bytes, offset, bytes.length - offset);
          if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
            throw new Error('Transcript write made no valid progress');
          }
          offset += written;
        }
      } catch (error) {
        disabled = true;
        try {
          closeDescriptor();
        } catch (ignored) {}
        onFailure(error);
      }
    },
    close() {
      try {
        closeDescriptor();
      } catch (error) {
        disabled = true;
        onFailure(error);
      }
      return !disabled;
    }
  };
}

function superviseRelease(options) {
  const opts = options || {};
  if (typeof opts.scriptPath !== 'string' || opts.scriptPath === '') {
    return Promise.reject(new Error('superviseRelease needs a scriptPath'));
  }

  const args = Array.isArray(opts.args) ? opts.args : [];
  const cwd = opts.cwd === undefined ? process.cwd() : opts.cwd;
  const env = opts.env === undefined ? process.env : opts.env;
  const stdout = opts.stdout === undefined ? process.stdout : opts.stdout;
  const stderr = opts.stderr === undefined ? process.stderr : opts.stderr;
  const logRoot = opts.logRoot === undefined ? DEFAULT_LOG_ROOT : opts.logRoot;
  const fsOps = Object.assign({}, DEFAULT_FS, opts.fs);
  const posix = process.platform !== 'win32';

  const outTerminal = terminalWriter(stdout);
  const errTerminal = terminalWriter(stderr);
  const warn = (message) => errTerminal.write(`Warning: ${message}\n`);

  let sink = null;
  let logPath = null;
  let captureOwner = 'none';
  let sinkFailed = false;
  let sinkWarned = false;

  const external = externalCapturePath(env);
  if (external) {
    logPath = external;
    captureOwner = 'external';
  } else {
    try {
      const opened = openTranscript(logRoot, fsOps);
      logPath = opened.logPath;
      captureOwner = 'file';
      sink = createSink(opened.fd, fsOps, (error) => {
        sinkFailed = true;
        if (sinkWarned) return;
        sinkWarned = true;
        warn(`Could not write the release transcript: ${describeError(error)}. Continuing with console output.`);
      });
    } catch (error) {
      warn(`Could not open a release transcript: ${describeError(error)}. Continuing with console output.`);
    }
  }

  if (sink) {
    sink.line(`# ${RELEASE_LABEL}\n`);
    sink.line(`# started ${new Date().toISOString()}\n`);
  }

  if (logPath) {
    errTerminal.write(captureOwner === 'external'
      ? `Release transcript delegated to the parent sink: ${logPath}\n`
      : `Release transcript: ${logPath}\n`);
  }

  return new Promise((resolve) => {
    const partial = { 1: '', 2: '' };
    const decoders = { 1: new StringDecoder('utf8'), 2: new StringDecoder('utf8') };
    let child = null;
    let settled = false;

    const writeLine = (line) => {
      if (!sink) return;
      sink.line(redact(line) + '\n');
    };

    const pump = (fd, chunk, terminal) => {
      terminal.write(chunk);
      const text = decoders[fd].write(chunk);
      if (!text) return;
      const lines = (partial[fd] + text).split('\n');
      partial[fd] = lines.pop();
      for (const line of lines) writeLine(line);
    };

    const flushTail = () => {
      for (const fd of [1, 2]) {
        let tail = '';
        try {
          tail = decoders[fd].end();
        } catch (error) {
          tail = '';
        }
        if (tail) partial[fd] += tail;
        if (partial[fd]) {
          writeLine(partial[fd]);
          partial[fd] = '';
        }
      }
    };

    const onSignal = (signal) => {
      if (!child || child.pid === undefined) return;
      try {
        if (posix) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {}
    };

    const installSignalHandlers = () => {
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    };

    const removeSignalHandlers = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      removeSignalHandlers();
      flushTail();
      if (sink) {
        sink.line(redact(`# finished ${new Date().toISOString()} exit code=${code} signal=${signal}\n`));
        if (!sink.close()) sinkFailed = true;
      }
      const complete = captureOwner === 'external' ? null : captureOwner === 'file' && !sinkFailed;
      if (captureOwner === 'external') {
        errTerminal.write(`Release transcript owned by the parent sink: ${logPath}\n`);
      } else if (captureOwner === 'file') {
        errTerminal.write(`Release transcript ${complete ? 'complete' : 'incomplete'}: ${logPath}\n`);
      } else {
        errTerminal.write('Release transcript unavailable: console output only\n');
      }
      outTerminal.detach();
      errTerminal.detach();
      resolve({ code, signal, logPath, complete, captureOwner });
    };

    const childEnv = Object.assign({}, env);
    childEnv[WORKER_ENV] = '1';
    if (logPath) childEnv[POINTER_ENV] = logPath;
    else delete childEnv[POINTER_ENV];

    try {
      child = spawn(process.execPath, [opts.scriptPath].concat(args), {
        cwd,
        env: childEnv,
        stdio: ['inherit', 'pipe', 'pipe'],
        detached: posix
      });
    } catch (error) {
      writeLine(`# failed to start: ${describeError(error)}`);
      errTerminal.write(`Could not start ${opts.scriptPath}: ${describeError(error)}\n`);
      finish(1, null);
      return;
    }

    installSignalHandlers();
    const swallow = () => {};
    child.stdout.on('error', swallow);
    child.stderr.on('error', swallow);
    child.stdout.on('data', (chunk) => pump(1, chunk, outTerminal));
    child.stderr.on('data', (chunk) => pump(2, chunk, errTerminal));
    child.on('error', (error) => {
      writeLine(`# failed to start: ${describeError(error)}`);
      errTerminal.write(`Could not start ${opts.scriptPath}: ${describeError(error)}\n`);
      finish(1, null);
    });
    child.on('close', (code, signal) => {
      finish(code === null ? null : code, signal || null);
    });
  });
}

module.exports = { superviseRelease, externalCapturePath };
