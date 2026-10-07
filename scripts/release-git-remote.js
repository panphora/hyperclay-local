'use strict';

const releaseCommand = require('./release-command');
const { observeEnv } = require('./release-target-evidence');

const REMOTE_OUTPUT_LIMIT = 1024 * 1024;
const DESTINATION_PLACEHOLDER = '<push-destination>';
const CREDENTIAL_PLACEHOLDER = '<redacted>';
const USERINFO_PATTERN = /([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)[^/@\s]*@/g;

function remoteEnv() {
  return { ...observeEnv(), GIT_TERMINAL_PROMPT: '0' };
}

function redactRemoteText(destination, value) {
  const text = value === undefined || value === null
    ? ''
    : (Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
  let redacted = text;
  if (typeof destination === 'string' && destination.length > 0) {
    redacted = redacted.split(destination).join(DESTINATION_PLACEHOLDER);
  }
  return redacted.replace(USERINFO_PATTERN, `$1${CREDENTIAL_PLACEHOLDER}@`);
}

function remoteDiagnostic(destination, result) {
  const outcome = result === undefined || result === null ? {} : result;
  const failure = outcome.error;
  return {
    status: typeof outcome.status === 'number' ? outcome.status : null,
    signal: typeof outcome.signal === 'string' && outcome.signal.length > 0 ? outcome.signal : null,
    code: failure && typeof failure.code === 'string' ? failure.code : null,
    stdout: redactRemoteText(destination, outcome.stdout),
    stderr: redactRemoteText(destination, outcome.stderr)
  };
}

function remoteLabel(destination, args) {
  return redactRemoteText(destination, `git ${args.join(' ')}`);
}

function remoteFailureMessage(destination, args, diagnostic) {
  const details = [];
  if (diagnostic.status !== null) details.push(`exit ${diagnostic.status}`);
  if (diagnostic.signal !== null) details.push(`signal ${diagnostic.signal}`);
  if (diagnostic.code !== null) details.push(`code ${diagnostic.code}`);
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `${remoteLabel(destination, args)} failed${suffix}`;
}

function runGitRemote({ repoRoot, destination, args, timeoutMs }, { spawnRemote }) {
  let result;
  try {
    result = spawnRemote('git', args, {
      cwd: repoRoot,
      env: remoteEnv(),
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
      maxBuffer: REMOTE_OUTPUT_LIMIT
    });
  } catch (error) {
    result = { status: null, signal: null, stdout: '', stderr: '', error };
  }
  const diagnostic = remoteDiagnostic(destination, result);
  releaseCommand.writeOutput(1, diagnostic.stdout);
  releaseCommand.writeOutput(2, diagnostic.stderr);
  const failed = diagnostic.code !== null || diagnostic.signal !== null || diagnostic.status !== 0;
  return { failed, diagnostic };
}

module.exports = { runGitRemote, redactRemoteText, remoteLabel, remoteFailureMessage };
