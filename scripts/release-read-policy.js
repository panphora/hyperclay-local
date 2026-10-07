'use strict';

const { spawnSync } = require('child_process');

const { writeOutput } = require('./release-command');

const GITHUB_OPERATIONS = [
  'github.workflow-definition',
  'github.workflow-runs-page',
  'github.run',
  'github.run-jobs-page'
];

const DESKTOP_OPERATIONS = ['desktop.release-info', 'desktop.release-info-visible'];
const ALLOWED_OPERATIONS = GITHUB_OPERATIONS.concat(DESKTOP_OPERATIONS);

const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_ACCEPT = 'application/vnd.github+json';
const RELEASE_INFO_URL = 'https://local.hyperclay.com/release-info.json';

const MAX_ATTEMPTS = 3;
const MAX_REQUEST_MS = 30000;
const MAX_TOTAL_MS = 90000;
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const TRANSIENT_HTTP_STATUSES = [502, 503, 504];
const PERMANENT_HTTP_STATUSES = [400, 401, 404, 409, 410, 422];
const PERMANENT_KINDS = ['operator-abort', 'invalid-json', 'schema', 'identity', 'ci-failed', 'signal'];
const TRANSIENT_TRANSPORT_CODES = [
  'ECONNRESET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
];
const RETRY_HEADER_NAMES = ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining'];
const CLOUDFLARE_DENIAL = /\b10013\b/;
const STATUS_LINE = /^HTTP\/\d(?:\.\d)?[ \t]+\d{3}(?:[ \t]|$)/;
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;
const POSITIVE_INTEGER = '[1-9][0-9]*';
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FAILURE_FIELDS = [
  'httpStatus',
  'code',
  'requestOwned',
  'body',
  'stdout',
  'stderr',
  'headers',
  'responseHeaders',
  'retryAfterMs',
  'retryAt',
  'throttleSource',
  'runnerStatus',
  'runnerSignal',
  'abortedByOperator',
  'bodyTooLarge'
];

function readError(kind, message, fields) {
  const error = new Error(message);
  error.kind = kind;
  if (fields) Object.assign(error, fields);
  return error;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function isAborted(signal) {
  return Boolean(signal && signal.aborted === true);
}

function httpStatusOf(error) {
  if (!error || typeof error !== 'object') return null;
  if (Number.isInteger(error.httpStatus)) return error.httpStatus;
  if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) return error.status;
  return null;
}

function usesCloudflareDenial(error) {
  if (!error || typeof error !== 'object') return false;
  return [error.body, error.stderr, error.stdout, error.message].some(
    (value) => typeof value === 'string' && CLOUDFLARE_DENIAL.test(value)
  );
}

function parseRetryAfter(value, wallNow) {
  const text = String(value).trim();
  if (text === '') return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return wallNow + Number(text) * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function deadlineFromHeaders(headers, wallNow) {
  if (!headers || typeof headers !== 'object') return null;
  const retryAfter = headers['retry-after'];
  if (retryAfter !== undefined && retryAfter !== null && String(retryAfter).trim() !== '') {
    const at = parseRetryAfter(retryAfter, wallNow);
    if (at !== null) return { source: 'retry-after', at, ms: at - wallNow, usable: at - wallNow >= 0 };
  }
  if (String(headers['x-ratelimit-remaining']) === '0') {
    const reset = headers['x-ratelimit-reset'];
    if (reset !== undefined && reset !== null && String(reset).trim() !== '' && Number.isFinite(Number(reset))) {
      const at = Number(reset) * 1000;
      return { source: 'x-ratelimit-reset', at, ms: at - wallNow, usable: at - wallNow >= 0 };
    }
  }
  return null;
}

function throttleDeadline(error) {
  const wallNow = Number.isFinite(error.wallNow) ? error.wallNow : Date.now();
  if (Number.isFinite(error.retryAfterMs)) {
    return {
      source: typeof error.throttleSource === 'string' ? error.throttleSource : 'retry-after',
      at: Number.isFinite(error.retryAt) ? error.retryAt : wallNow + error.retryAfterMs,
      ms: error.retryAfterMs,
      usable: error.retryAfterMs >= 0
    };
  }
  return deadlineFromHeaders(error.headers || error.responseHeaders, wallNow);
}

function classifyReadFailure(error) {
  if (!error || typeof error !== 'object') return 'unknown';
  if (PERMANENT_KINDS.indexOf(error.kind) !== -1) return 'permanent';
  const status = httpStatusOf(error);
  if (status !== null) {
    if (TRANSIENT_HTTP_STATUSES.indexOf(status) !== -1) return 'transient';
    if (usesCloudflareDenial(error)) return 'permanent';
    if (status === 429) {
      const deadline = throttleDeadline(error);
      return deadline && deadline.usable ? 'transient' : 'unknown';
    }
    if (status === 403) {
      const deadline = throttleDeadline(error);
      if (!deadline) return 'permanent';
      return deadline.usable ? 'transient' : 'unknown';
    }
    if (PERMANENT_HTTP_STATUSES.indexOf(status) !== -1) return 'permanent';
    return 'unknown';
  }
  if (error.kind === 'transport') {
    if (TRANSIENT_TRANSPORT_CODES.indexOf(error.code) !== -1) return 'transient';
    if (error.code === 'ETIMEDOUT') return error.requestOwned === true ? 'transient' : 'unknown';
    return 'unknown';
  }
  return 'unknown';
}

function describeFailure(error) {
  if (!error) return 'no attempt completed';
  if (typeof error === 'object' && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

function diagnosticText(error) {
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error : '';
  const parts = [];
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  if (message) parts.push(message);
  for (const field of ['stderr', 'body', 'stdout']) {
    const text = textOf(error[field]).trim();
    if (text && parts.indexOf(text) === -1) parts.push(text);
  }
  return parts.join('\n');
}

function logFailedAttempt(operation, attempt, error, classification, delayMs, retrying, logger) {
  const diagnostic = diagnosticText(error);
  const record = {
    operation,
    attempt,
    diagnostic,
    kind: error && typeof error === 'object' ? error.kind : undefined,
    code: error && typeof error === 'object' ? error.code : undefined,
    httpStatus: httpStatusOf(error),
    message: describeFailure(error),
    stderr: textOf(error && error.stderr),
    body: textOf(error && error.body),
    stdout: textOf(error && error.stdout),
    classification,
    delayMs,
    retrying,
    retryAt: error && Number.isFinite(error.retryAt) ? error.retryAt : null,
    error
  };
  if (typeof logger === 'function') {
    logger(record);
    return;
  }
  const details = [];
  if (record.kind) details.push(`kind=${record.kind}`);
  if (record.code) details.push(`code=${record.code}`);
  if (record.httpStatus !== null) details.push(`http=${record.httpStatus}`);
  const lines = [];
  if (diagnostic) lines.push(diagnostic);
  lines.push(
    `[release-read] ${operation} attempt ${attempt}/${MAX_ATTEMPTS} ${classification}` +
      (details.length ? ` (${details.join(' ')})` : '') +
      (retrying ? ` retrying in ${delayMs}ms` : ' stopping')
  );
  writeOutput(2, lines.join('\n') + '\n');
}

function operatorAbortFailure(operation, signal) {
  const error = readError('operator-abort', `Read ${operation} aborted by the operator`);
  error.abortedByOperator = true;
  if (signal && signal.reason instanceof Error) error.cause = signal.reason;
  return error;
}

function deadlineFailure(operation) {
  return readError('deadline', `Read ${operation} exhausted its ${MAX_TOTAL_MS}ms read budget`);
}

function readFailure(operation, failures, override) {
  const attemptErrors = Array.isArray(failures) ? failures.slice() : [];
  const last = attemptErrors.length ? attemptErrors[attemptErrors.length - 1] : null;
  const prefix = override && typeof override.message === 'string' && override.message
    ? override.message
    : `Read ${operation} failed`;
  const message = attemptErrors.length
    ? `${prefix} after ${attemptErrors.length} attempt${attemptErrors.length === 1 ? '' : 's'}: ${describeFailure(last)}`
    : prefix;
  const error = new Error(message);
  error.kind = override && override.kind ? override.kind : (last && last.kind) || 'unknown';
  error.operation = operation;
  error.attempts = attemptErrors.length;
  error.attemptErrors = attemptErrors;
  for (const field of FAILURE_FIELDS) {
    if (override && override[field] !== undefined) error[field] = override[field];
    else if (last && last[field] !== undefined) error[field] = last[field];
  }
  error.cause = last || override || null;
  if (Number.isFinite(error.retryAt)) {
    error.message = `${error.message}; retry at ${new Date(error.retryAt).toISOString()}`;
  }
  return error;
}

function defaultNow() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Number(process.hrtime.bigint() / 1000000n);
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (isAborted(signal)) {
      reject(operatorAbortFailure('read', signal));
      return;
    }
    let settled = false;
    const finish = () => {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(operatorAbortFailure('read', signal));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finish();
      resolve();
    }, delayMs);
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function normalizeRetryDeadline(error, wallNow) {
  if (!error || typeof error !== 'object') return null;
  if (Number.isFinite(error.retryAfterMs)) {
    return {
      source: typeof error.throttleSource === 'string' ? error.throttleSource : 'retry-after',
      at: Number.isFinite(error.retryAt) ? error.retryAt : wallNow + error.retryAfterMs,
      ms: error.retryAfterMs,
      usable: error.retryAfterMs >= 0
    };
  }
  const deadline = deadlineFromHeaders(error.headers || error.responseHeaders, wallNow);
  if (!deadline) return null;
  error.throttleSource = deadline.source;
  if (deadline.usable) {
    error.retryAfterMs = deadline.ms;
    error.retryAt = deadline.at;
  }
  return deadline;
}

function requireAllowedRead(operation) {
  if (ALLOWED_OPERATIONS.indexOf(operation) === -1) {
    throw readError(
      'invalid-operation',
      `Read operation ${JSON.stringify(operation)} is not allowlisted for bounded reads`
    );
  }
}

function retryRead(operation, readOnce, deps = {}, options = {}) {
  return (async () => {
    requireAllowedRead(operation);
    if (typeof readOnce !== 'function') {
      throw readError('invalid-operation', `Read ${operation} requires a read callback`);
    }
    const runtime = deps || {};
    const settings = options || {};
    const now = typeof runtime.now === 'function' ? runtime.now : defaultNow;
    const sleep = typeof runtime.sleep === 'function'
      ? runtime.sleep
      : (delayMs) => defaultSleep(delayMs, runtime.signal);
    const logger = typeof runtime.logReadFailure === 'function' ? runtime.logReadFailure : null;
    const wallNow = typeof runtime.wallNow === 'function' ? runtime.wallNow : Date.now;
    const signal = runtime.signal;
    const deadline = Number.isFinite(settings.deadline) ? settings.deadline : Infinity;
    const end = Math.min(now() + MAX_TOTAL_MS, deadline);
    const failures = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (isAborted(signal)) {
        throw readFailure(operation, failures, operatorAbortFailure(operation, signal));
      }
      const remaining = end - now();
      if (remaining <= 0) {
        throw readFailure(operation, failures, deadlineFailure(operation));
      }
      try {
        return await readOnce({ attempt, timeoutMs: Math.min(MAX_REQUEST_MS, remaining) });
      } catch (error) {
        failures.push(error);
        const wallAt = error && Number.isFinite(error.wallNow) ? error.wallNow : wallNow();
        const retryDeadline = normalizeRetryDeadline(error, wallAt);
        const classification = classifyReadFailure(error);
        const serverMinimum = retryDeadline && retryDeadline.usable && retryDeadline.ms > 0 ? retryDeadline.ms : 0;
        const delayMs = Math.max(RETRY_DELAYS_MS[attempt - 1] || 0, serverMinimum);
        const retrying = classification === 'transient' && attempt < MAX_ATTEMPTS && now() + delayMs < end;
        logFailedAttempt(operation, attempt, error, classification, delayMs, retrying, logger);
        if (!retrying) throw readFailure(operation, failures);
        if (isAborted(signal)) {
          throw readFailure(operation, failures, operatorAbortFailure(operation, signal));
        }
        try {
          await sleep(delayMs);
        } catch (sleepError) {
          if (sleepError && sleepError.kind === 'operator-abort') {
            throw readFailure(operation, failures, sleepError);
          }
          throw sleepError;
        }
      }
    }
    throw readFailure(operation, failures);
  })();
}

function splitEnvelope(text) {
  const crlf = text.indexOf('\r\n\r\n');
  const lf = text.indexOf('\n\n');
  let index = -1;
  let separator = 0;
  if (crlf >= 0 && (lf < 0 || crlf < lf)) {
    index = crlf;
    separator = 4;
  } else if (lf >= 0) {
    index = lf;
    separator = 2;
  }
  if (index < 0) return null;
  return { headerBlock: text.slice(0, index), body: text.slice(index + separator) };
}

function parseGithubResponse(stdout) {
  const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : typeof stdout === 'string' ? stdout : null;
  if (text === null) {
    throw readError('invalid-response', 'GitHub response output was neither a string nor a Buffer');
  }
  const envelope = splitEnvelope(text);
  if (!envelope) {
    throw readError('invalid-response', 'GitHub response carried no complete HTTP envelope', { stdout: text });
  }
  const headerLines = envelope.headerBlock.split(/\r?\n/);
  const statusLine = headerLines[0];
  if (typeof statusLine !== 'string' || !STATUS_LINE.test(statusLine)) {
    throw readError('invalid-response', 'GitHub response began without an HTTP status line', {
      stdout: text,
      body: envelope.body
    });
  }
  const httpStatus = Number(statusLine.split(/[ \t]+/)[1]);
  const headers = {};
  for (const line of headerLines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw readError('invalid-response', 'GitHub response carried a malformed header line', { stdout: text });
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(name)) {
      throw readError('invalid-response', `GitHub response header name ${JSON.stringify(name)} is malformed`, {
        stdout: text
      });
    }
    if (headers[name] === undefined) {
      headers[name] = value;
    } else if (RETRY_HEADER_NAMES.indexOf(name) !== -1) {
      if (headers[name] !== value) {
        throw readError('invalid-response', `GitHub response repeated ${name} with conflicting values`, {
          stdout: text
        });
      }
    } else {
      headers[name] = `${headers[name]}, ${value}`;
    }
  }
  if (/^HTTP\/\d(?:\.\d)?[ \t]+\d{3}(?:[ \t]|$)/.test(envelope.body)) {
    throw readError('invalid-response', 'GitHub response carried more than one HTTP envelope', { stdout: text });
  }
  return { httpStatus, headers, body: envelope.body };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_NAME.test(repo)) {
    throw readError('invalid-request', `GitHub read needs an explicit owner/repo, received ${JSON.stringify(repo)}`);
  }
  return repo;
}

function endpointPatterns(operation, repo) {
  const base = `repos/${escapeRegExp(repo)}/actions/`;
  if (operation === 'github.workflow-definition') {
    return [new RegExp(`^${base}workflows/(release\\.yml|${POSITIVE_INTEGER})$`)];
  }
  if (operation === 'github.workflow-runs-page') {
    return [
      new RegExp(
        `^${base}workflows/${POSITIVE_INTEGER}/runs\\?event=workflow_dispatch&per_page=100&page=${POSITIVE_INTEGER}$`
      ),
      new RegExp(
        `^${base}workflows/${POSITIVE_INTEGER}/runs\\?event=workflow_dispatch&per_page=100&page=${POSITIVE_INTEGER}` +
        '&created=%3E%3D[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}%3A[0-9]{2}%3A[0-9]{2}Z$'
      )
    ];
  }
  if (operation === 'github.run') {
    return [new RegExp(`^${base}runs/${POSITIVE_INTEGER}$`)];
  }
  if (operation === 'github.run-jobs-page') {
    return [
      new RegExp(`^${base}runs/${POSITIVE_INTEGER}/attempts/${POSITIVE_INTEGER}/jobs\\?per_page=100&page=${POSITIVE_INTEGER}$`)
    ];
  }
  return [];
}

function validateEndpoint(operation, repo, endpoint) {
  if (typeof endpoint !== 'string' || endpoint === '') {
    throw readError('invalid-endpoint', `Read ${operation} needs a relative GitHub endpoint`);
  }
  const patterns = endpointPatterns(operation, repo);
  if (!patterns.some((pattern) => pattern.test(endpoint))) {
    throw readError(
      'invalid-endpoint',
      `Read ${operation} does not allow endpoint ${JSON.stringify(endpoint)} for ${repo}`
    );
  }
  if (operation === 'github.workflow-runs-page' && endpoint.includes('&created=')) {
    const encoded = endpoint.slice(endpoint.indexOf('&created=') + '&created='.length);
    const timestamp = decodeURIComponent(encoded).slice(2);
    const instant = new Date(timestamp);
    if (!Number.isFinite(instant.getTime()) ||
        instant.toISOString().replace(/\.000Z$/, 'Z') !== timestamp) {
      throw readError('invalid-endpoint', 'Workflow discovery requires a canonical UTC creation bound');
    }
  }
  return endpoint;
}

function ghArgs(endpoint) {
  return [
    'api',
    '--hostname',
    'github.com',
    '--method',
    'GET',
    '--include',
    '-H',
    `Accept: ${GITHUB_ACCEPT}`,
    '-H',
    `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
    endpoint
  ];
}

function ghOptions(timeoutMs) {
  return {
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: MAX_BODY_BYTES,
    env: Object.assign({}, process.env, { GH_FORCE_TTY: '0', NO_COLOR: '1' })
  };
}

function defaultRun(file, args, options) {
  return spawnSync(file, args, options);
}

function transportCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === 'string' && current.code) return current.code;
    if (current.name === 'AbortError') return 'ABORT_ERR';
    current = current.cause;
  }
  return null;
}

function normalizeTransportFailure(error, operation) {
  if (error && typeof error === 'object' && typeof error.kind === 'string' && error.kind) return error;
  const failure = readError('transport', `Read ${operation} failed: ${describeFailure(error)}`, {
    code: transportCode(error)
  });
  if (error && typeof error === 'object') failure.cause = error;
  return failure;
}

function applyRetryDeadline(error, headers, wallNow) {
  const deadline = deadlineFromHeaders(headers, wallNow);
  if (!deadline) return error;
  error.throttleSource = deadline.source;
  if (deadline.usable) {
    error.retryAfterMs = deadline.ms;
    error.retryAt = deadline.at;
  }
  return error;
}

function httpFailure(operation, message, httpStatus, headers, body, wallNow, fields) {
  const error = readError('http', message, Object.assign({
    httpStatus,
    headers,
    responseHeaders: headers,
    body: body === undefined ? '' : body
  }, fields));
  return applyRetryDeadline(error, headers, wallNow);
}

function parseJsonBody(body, fields) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw readError('invalid-json', `Read returned malformed JSON: ${describeFailure(error)}`, Object.assign({
      body,
      cause: error
    }, fields));
  }
}

function ghReadOnce(operation, endpoint, deps, timeoutMs) {
  const run = typeof deps.run === 'function' ? deps.run : defaultRun;
  const wallNow = typeof deps.wallNow === 'function' ? deps.wallNow : Date.now;
  const startedAt = Date.now();
  let result;
  try {
    result = run('gh', ghArgs(endpoint), ghOptions(timeoutMs));
  } catch (error) {
    const failure = normalizeTransportFailure(error, operation);
    failure.stdout = textOf(error && error.stdout);
    failure.stderr = textOf(error && error.stderr);
    throw failure;
  }
  const elapsed = Date.now() - startedAt;
  if (!result || typeof result !== 'object') {
    throw readError('unknown', `Read ${operation} returned no process result`);
  }
  const stdout = textOf(result.stdout);
  const stderr = textOf(result.stderr);
  const runnerStatus = result.status === undefined ? null : result.status;
  const runnerSignal = result.signal === undefined ? null : result.signal;
  const runError = result.error && typeof result.error === 'object' ? result.error : null;
  const processFields = { stdout, stderr, runnerStatus, runnerSignal };
  if (runError) processFields.cause = runError;
  let envelope = null;
  let parseFailure = null;
  if (stdout !== '') {
    try {
      envelope = parseGithubResponse(stdout);
    } catch (error) {
      parseFailure = error;
    }
  }
  if (runError || runnerSignal) {
    if (envelope && !(envelope.httpStatus >= 200 && envelope.httpStatus < 300)) {
      throw httpFailure(
        operation,
        `Read ${operation} returned HTTP ${envelope.httpStatus}`,
        envelope.httpStatus,
        envelope.headers,
        envelope.body,
        wallNow(),
        processFields
      );
    }
    if (runError) {
      const failure = readError('transport', `Read ${operation} failed: ${describeFailure(runError)}`, {
        code: runError.code,
        cause: runError,
        stdout,
        stderr,
        runnerStatus,
        runnerSignal
      });
      failure.requestOwned = runError.code === 'ETIMEDOUT';
      throw failure;
    }
    throw readError('signal', `Read ${operation} was terminated by signal ${runnerSignal}`, {
      runnerStatus,
      runnerSignal,
      stdout,
      stderr
    });
  }
  if (result.status === null && elapsed >= timeoutMs) {
    const failure = readError('transport', `Read ${operation} exceeded its ${timeoutMs}ms request cap`, {
      code: 'ETIMEDOUT',
      stdout,
      stderr,
      runnerStatus,
      runnerSignal
    });
    failure.requestOwned = true;
    throw failure;
  }
  if (envelope) {
    const succeeded = envelope.httpStatus >= 200 && envelope.httpStatus < 300;
    if (!succeeded) {
      throw httpFailure(
        operation,
        `Read ${operation} returned HTTP ${envelope.httpStatus}`,
        envelope.httpStatus,
        envelope.headers,
        envelope.body,
        wallNow(),
        processFields
      );
    }
    if (result.status !== 0) {
      throw readError('unknown', `Read ${operation} reported HTTP ${envelope.httpStatus} with a failing process exit`, {
        httpStatus: envelope.httpStatus,
        headers: envelope.headers,
        responseHeaders: envelope.headers,
        body: envelope.body,
        cause: runError,
        stdout,
        stderr,
        runnerStatus,
        runnerSignal
      });
    }
    return parseJsonBody(envelope.body, {
      httpStatus: envelope.httpStatus,
      headers: envelope.headers,
      responseHeaders: envelope.headers,
      stdout,
      stderr
    });
  }
  throw readError(
    'unknown',
    `Read ${operation} produced no HTTP envelope${result.status ? ` (exit ${result.status})` : ''}`,
    {
      cause: parseFailure,
      stdout,
      stderr,
      runnerStatus,
      runnerSignal
    }
  );
}

function readGithubJson(operation, request = {}, deps = {}, options = {}) {
  try {
    if (GITHUB_OPERATIONS.indexOf(operation) === -1) {
      throw readError(
        'invalid-operation',
        `Read ${JSON.stringify(operation)} is not a GitHub read operation`
      );
    }
    const repo = validateRepo(request && request.repo);
    const endpoint = validateEndpoint(operation, repo, request && request.endpoint);
    return retryRead(
      operation,
      ({ timeoutMs }) => ghReadOnce(operation, endpoint, deps || {}, timeoutMs),
      deps,
      options
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

function headerMap(headers) {
  const map = {};
  if (!headers) return map;
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, name) => {
      const key = String(name).toLowerCase();
      const text = String(value);
      map[key] = map[key] === undefined ? text : `${map[key]}, ${text}`;
    });
    return map;
  }
  if (typeof headers === 'object') {
    for (const name of Object.keys(headers)) {
      map[String(name).toLowerCase()] = String(headers[name]);
    }
  }
  return map;
}

function declaredBodyLength(headers) {
  if (!headers) return null;
  let raw;
  if (typeof headers.get === 'function') {
    raw = headers.get('content-length');
  } else if (typeof headers === 'object') {
    raw = headers['content-length'] !== undefined ? headers['content-length'] : headers['Content-Length'];
  }
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function bufferOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.from(String(value));
}

function oversizeFailure(size) {
  return readError('schema', `Read body exceeded ${MAX_BODY_BYTES} bytes (saw ${size})`, {
    bodyTooLarge: true
  });
}

function cancelReader(reader) {
  try {
    const canceled = reader.cancel();
    if (canceled && typeof canceled.catch === 'function') canceled.catch(() => {});
  } catch (error) {}
}

function cancelResponseBody(stream) {
  if (!stream) return;
  if (typeof stream.cancel === 'function') {
    try {
      const canceled = stream.cancel();
      if (canceled && typeof canceled.catch === 'function') canceled.catch(() => {});
    } catch (error) {}
    return;
  }
  if (typeof stream.getReader === 'function') {
    try {
      cancelReader(stream.getReader());
    } catch (error) {}
  }
}

function isPreservedReadFailure(error) {
  if (!error || typeof error !== 'object') return false;
  return error.kind === 'schema' || error.kind === 'operator-abort' || error.abortedByOperator === true;
}

async function readBoundedBody(response, cancels) {
  const declared = declaredBodyLength(response.headers);
  const stream = response.body;
  if (declared !== null && declared > MAX_BODY_BYTES) {
    cancels.push(() => cancelResponseBody(stream));
    throw oversizeFailure(declared);
  }
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    cancels.push(() => cancelReader(reader));
    const chunks = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (!chunk || chunk.done) break;
      const bytes = bufferOf(chunk.value);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        cancelReader(reader);
        throw oversizeFailure(size);
      }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    return { bytes, text: bytes.toString('utf8') };
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    const size = Buffer.byteLength(text);
    if (size > MAX_BODY_BYTES) throw oversizeFailure(size);
    return { bytes: null, text };
  }
  throw readError('schema', 'Read response carried no readable body');
}

async function performReleaseInfoRead(operation, fetchFn, url, controller, cancels, wallNow, abortFailure, requireBytes) {
  const response = await fetchFn(url, { method: 'GET', signal: controller.signal });
  if (controller.signal.aborted) throw abortFailure();
  if (!response || !Number.isInteger(response.status)) {
    throw readError('schema', `Read ${operation} returned no HTTP status`);
  }
  const headers = headerMap(response.headers);
  if (response.status < 200 || response.status >= 300) {
    let body = '';
    let bodyFailure = null;
    try {
      const bounded = await readBoundedBody(response, cancels);
      body = bounded.text;
    } catch (error) {
      bodyFailure = error || null;
      body = textOf(error && error.body);
    }
    if (isPreservedReadFailure(bodyFailure)) throw bodyFailure;
    const failure = httpFailure(
      operation,
      `Read ${operation} returned HTTP ${response.status}`,
      response.status,
      headers,
      body,
      wallNow()
    );
    if (bodyFailure) failure.cause = bodyFailure;
    throw failure;
  }
  const body = await readBoundedBody(response, cancels);
  if (controller.signal.aborted) throw abortFailure();
  if (requireBytes && body.bytes === null) {
    throw readError(
      'schema',
      `Read ${operation} returned a text-only response that cannot certify the response bytes`
    );
  }
  const value = parseJsonBody(body.text, { httpStatus: response.status, headers, responseHeaders: headers });
  return { value, bytes: body.bytes };
}

function readReleaseInfoOnce(operation, deps, wallNow, timeoutMs, requireBytes) {
  return (async () => {
    const fetchFn = typeof deps.fetch === 'function' ? deps.fetch : globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw readError('transport', 'No fetch implementation is available for the release-info read');
    }
    const url = `${RELEASE_INFO_URL}?t=${wallNow()}`;
    const controller = new AbortController();
    const cancels = [];
    let operatorAborted = false;
    let lastError = null;
    const runCancels = () => {
      const pending = cancels.splice(0);
      for (const cancel of pending) {
        try {
          cancel();
        } catch (error) {}
      }
    };
    const abortFailure = () => {
      if (operatorAborted) return operatorAbortFailure(operation, deps.signal);
      const failure = readError(
        'transport',
        `Read ${operation} exceeded ${timeoutMs}ms while waiting for ${RELEASE_INFO_URL}`
      );
      failure.code = 'ETIMEDOUT';
      failure.requestOwned = true;
      if (lastError) failure.cause = lastError;
      return failure;
    };
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const operatorSignal = deps.signal;
    const forward = () => {
      operatorAborted = true;
      controller.abort();
    };
    try {
      if (operatorSignal) {
        if (isAborted(operatorSignal)) operatorAborted = true;
        else if (typeof operatorSignal.addEventListener === 'function') {
          operatorSignal.addEventListener('abort', forward, { once: true });
        }
      }
      const aborted = new Promise((resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            runCancels();
            reject(abortFailure());
          },
          { once: true }
        );
      });
      if (operatorAborted) controller.abort();
      if (controller.signal.aborted) throw abortFailure();
      const work = (async () => {
        try {
          return await performReleaseInfoRead(
            operation,
            fetchFn,
            url,
            controller,
            cancels,
            wallNow,
            abortFailure,
            requireBytes
          );
        } catch (error) {
          lastError = error;
          if (controller.signal.aborted) throw abortFailure();
          throw normalizeTransportFailure(error, operation);
        }
      })();
      return await Promise.race([work, aborted]);
    } finally {
      clearTimeout(timer);
      runCancels();
      if (operatorSignal && typeof operatorSignal.removeEventListener === 'function') {
        operatorSignal.removeEventListener('abort', forward);
      }
    }
  })();
}

async function readReleaseInfoResult(requireBytes, deps = {}, options = {}) {
  const runtime = deps || {};
  const settings = options || {};
  const operation = settings.operation === undefined ? 'desktop.release-info' : settings.operation;
  if (DESKTOP_OPERATIONS.indexOf(operation) === -1) {
    throw readError('invalid-operation', `Read ${JSON.stringify(operation)} is not a desktop release read operation`);
  }
  const wallNow = typeof runtime.wallNow === 'function' ? runtime.wallNow : Date.now;
  return retryRead(
    operation,
    ({ timeoutMs }) => readReleaseInfoOnce(operation, runtime, wallNow, timeoutMs, requireBytes),
    runtime,
    settings
  );
}

async function readReleaseInfo(deps = {}, options = {}) {
  const result = await readReleaseInfoResult(false, deps, options);
  return result.value;
}

async function readReleaseInfoEvidence(deps = {}, options = {}) {
  return readReleaseInfoResult(true, deps, options);
}

module.exports = {
  classifyReadFailure,
  retryRead,
  parseGithubResponse,
  readGithubJson,
  readReleaseInfo,
  readReleaseInfoEvidence
};
