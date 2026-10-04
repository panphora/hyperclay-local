'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const writeWait = new Int32Array(new SharedArrayBuffer(4));

// Callers process.exit immediately after a captured failure, which kills the process
// with async stream writes still sitting in the pipe, so the tail of the output is lost.
function writeOutput(fd, value) {
  if (value === null || value === undefined) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    try {
      const written = fs.writeSync(fd, bytes, offset, Math.min(65536, bytes.length - offset));
      if (written <= 0) return;
      offset += written;
    } catch (error) {
      if (error.code === 'EINTR') continue;
      if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') {
        Atomics.wait(writeWait, 0, 0, 1);
        continue;
      }
      return;
    }
  }
}

function execCaptured(command, options = {}) {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', ...options });

  writeOutput(1, result.stdout);
  writeOutput(2, result.stderr);

  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : `Exit ${result.status}${result.signal ? ' signal ' + result.signal : ''}`;
    const error = new Error(`Command failed: ${command}\n${reason}`);
    error.status = result.status;
    error.signal = result.signal;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.output = result.output;
    if (result.error) {
      error.code = result.error.code;
      error.cause = result.error;
    }
    throw error;
  }

  return result.stdout;
}

function execFileCaptured(file, args, options = {}) {
  const { echoStdout = true, ...spawnOptions } = options;
  const result = spawnSync(file, args, {
    encoding: 'utf8', ...spawnOptions, shell: false
  });
  const failed = result.error || result.status !== 0;
  if (echoStdout || failed) writeOutput(1, result.stdout);
  writeOutput(2, result.stderr);
  if (failed) {
    const reason = result.error
      ? result.error.message
      : `Exit ${result.status}${result.signal ? ' signal ' + result.signal : ''}`;
    const error = new Error(`Command failed: ${file}\n${reason}`);
    error.status = result.status;
    error.signal = result.signal;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.output = result.output;
    if (result.error) {
      error.code = result.error.code;
      error.cause = result.error;
    }
    throw error;
  }
  return result.stdout;
}

module.exports = { execCaptured, execFileCaptured, writeOutput };
