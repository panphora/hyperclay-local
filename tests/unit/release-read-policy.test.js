const fs = require('fs');

const {
  classifyReadFailure,
  retryRead,
  parseGithubResponse,
  readGithubJson,
  readReleaseInfo,
  readReleaseInfoEvidence
} = require('../../scripts/release-read-policy');

const REPO = 'hyper/hyperclay-local';
const RELEASE_INFO_URL = 'https://local.hyperclay.com/release-info.json';
const REASONS = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
};

function fakeClock(start = 0) {
  const clock = {
    ms: start,
    wall: 1_000_000,
    sleeps: [],
    events: [],
    now() {
      return clock.ms;
    },
    wallNow() {
      return clock.wall;
    },
    advance(ms) {
      clock.ms += ms;
    },
    sleep(ms) {
      clock.sleeps.push(ms);
      clock.ms += ms;
      return Promise.resolve();
    },
    log(event) {
      clock.events.push(event);
    }
  };
  return clock;
}

function envelope(status, headers = {}, body = '', options = {}) {
  const newline = options.newline || '\r\n';
  const statusLine = options.statusLine || `HTTP/2.0 ${status} ${REASONS[status] || 'Status'}`;
  const lines = [statusLine];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  return `${lines.join(newline)}${newline}${newline}${body}`;
}

function ghOk(value, headers = {}) {
  return {
    status: 0,
    signal: null,
    stdout: envelope(200, Object.assign({ 'content-type': 'application/json' }, headers), JSON.stringify(value)),
    stderr: ''
  };
}

function ghHttp(status, body, headers = {}) {
  return { status: 1, signal: null, stdout: envelope(status, headers, body), stderr: `gh: HTTP ${status}` };
}

function ghTimeout() {
  return {
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    stdout: '',
    stderr: ''
  };
}

function fakeRunner(responses) {
  const queue = responses.slice();
  const calls = [];
  return {
    calls,
    run(file, args, options) {
      calls.push({ file, args, options });
      if (!queue.length) throw new Error('unexpected gh invocation');
      const next = queue.shift();
      return typeof next === 'function' ? next({ file, args, options }) : next;
    }
  };
}

function textResponse(text, options = {}) {
  let done = false;
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: options.headers || {},
    body: {
      getReader() {
        return {
          read: async () => {
            if (done) return { done: true };
            done = true;
            return { done: false, value: Buffer.from(text) };
          },
          cancel: async () => {
            if (options.onCancel) options.onCancel();
          }
        };
      }
    }
  };
}

function textOnlyResponse(text, options = {}) {
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: options.headers || {},
    text: async () => text
  };
}

function chunkResponse(chunks, options = {}) {
  let index = 0;
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: options.headers || {},
    body: {
      getReader() {
        return {
          read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }),
          cancel: async () => {
            if (options.onCancel) options.onCancel();
          }
        };
      }
    }
  };
}

function pendingResponse(options = {}) {
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: options.headers || {},
    body: {
      getReader() {
        return {
          read: () => new Promise(() => {}),
          cancel: async () => {
            if (options.onCancel) options.onCancel();
          }
        };
      }
    }
  };
}

function httpError(status, extra = {}) {
  return Object.assign(new Error(`http ${status}: original diagnostic`), {
    kind: 'http',
    httpStatus: status,
    ...extra
  });
}

describe('parseGithubResponse', () => {
  test('accepts an LF status line with CRLF headers and keeps a non-JSON error body', () => {
    const stdout =
      'HTTP/2.0 503 Service Unavailable\n' +
      'Content-Type: text/html\r\n' +
      'Retry-After: 2\r\n' +
      '\r\n' +
      '<html>upstream exploded</html>';
    expect(parseGithubResponse(stdout)).toEqual({
      httpStatus: 503,
      headers: { 'content-type': 'text/html', 'retry-after': '2' },
      body: '<html>upstream exploded</html>'
    });
  });

  test('accepts a Buffer and lowercases every header name', () => {
    const parsed = parseGithubResponse(Buffer.from(envelope(200, { 'X-RateLimit-Remaining': '9' }, '{"a":1}')));
    expect(parsed.httpStatus).toBe(200);
    expect(parsed.headers['x-ratelimit-remaining']).toBe('9');
    expect(parsed.body).toBe('{"a":1}');
  });

  test('rejects output with no complete envelope instead of guessing a status from stderr', () => {
    expect(() => parseGithubResponse('gh: could not resolve host (HTTP 503)')).toThrow(/no complete HTTP envelope/);
    expect(() => parseGithubResponse('HTTP/2.0 200 OK')).toThrow(/no complete HTTP envelope/);
    expect(() => parseGithubResponse(null)).toThrow(/neither a string nor a Buffer/);
  });

  test('rejects a response that carries more than one HTTP envelope', () => {
    const stdout = envelope(200, {}, '', { newline: '\r\n' }) + envelope(500, {}, 'second');
    expect(() => parseGithubResponse(stdout)).toThrow(/more than one HTTP envelope/);
  });

  test('rejects a malformed status line and a malformed header line', () => {
    expect(() => parseGithubResponse('NOTHTTP 200\r\n\r\nbody')).toThrow(/HTTP status line/);
    expect(() => parseGithubResponse('HTTP/1.1 200 OK\r\nbroken header\r\n\r\nbody')).toThrow(/malformed header line/);
  });

  test('rejects ambiguous duplicate retry headers and collapses identical repeats', () => {
    const conflicting = 'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nretry-after: 9\r\n\r\nbody';
    expect(() => parseGithubResponse(conflicting)).toThrow(/repeated retry-after with conflicting values/);
    const identical = 'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 4\r\nRetry-After: 4\r\n\r\nbody';
    expect(parseGithubResponse(identical).headers['retry-after']).toBe('4');
  });
});

describe('classifyReadFailure', () => {
  test('classifies explicit permanent kinds as permanent', () => {
    for (const kind of ['operator-abort', 'invalid-json', 'schema', 'identity', 'ci-failed', 'signal']) {
      expect(classifyReadFailure({ kind })).toBe('permanent');
    }
  });

  test('treats only 502, 503 and 504 as transient server statuses', () => {
    for (const status of [502, 503, 504]) expect(classifyReadFailure(httpError(status))).toBe('transient');
    for (const status of [500, 501, 505, 507]) expect(classifyReadFailure(httpError(status))).toBe('unknown');
  });

  test('classifies named client statuses as permanent and unknown statuses as unknown', () => {
    for (const status of [400, 401, 404, 409, 410, 422]) {
      expect(classifyReadFailure(httpError(status))).toBe('permanent');
    }
    expect(classifyReadFailure(httpError(418))).toBe('unknown');
    expect(classifyReadFailure(httpError(451))).toBe('unknown');
  });

  test('requires a usable deadline before a 429 becomes transient', () => {
    expect(classifyReadFailure(httpError(429, { retryAfterMs: 5000 }))).toBe('transient');
    expect(classifyReadFailure(httpError(429))).toBe('unknown');
    expect(classifyReadFailure(httpError(429, { headers: { 'retry-after': '3' }, wallNow: 1000 }))).toBe('transient');
    expect(
      classifyReadFailure(httpError(429, { headers: { 'retry-after': 'Wed, 01 Jan 2020 00:00:00 GMT' }, wallNow: Date.parse('2026-03-10T00:00:00Z') }))
    ).toBe('unknown');
  });

  test('distinguishes an ordinary 403 from a proven throttled 403', () => {
    expect(classifyReadFailure(httpError(403))).toBe('permanent');
    expect(classifyReadFailure(httpError(403, { headers: { 'x-ratelimit-remaining': '55' }, wallNow: 1000 }))).toBe('permanent');
    expect(classifyReadFailure(httpError(403, { headers: { 'retry-after': '5' }, wallNow: 1000 }))).toBe('transient');
    expect(
      classifyReadFailure(httpError(403, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1005' }, wallNow: 1_000_000 }))
    ).toBe('transient');
    expect(
      classifyReadFailure(httpError(403, { headers: { 'x-ratelimit-remaining': '0' }, wallNow: 1000 }))
    ).toBe('permanent');
    expect(
      classifyReadFailure(
        httpError(403, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '10' }, wallNow: 1_000_000 })
      )
    ).toBe('unknown');
  });

  test('classifies only request-owned timeouts and specific transport codes as transient', () => {
    expect(classifyReadFailure({ kind: 'transport', code: 'ECONNRESET' })).toBe('transient');
    for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
      expect(classifyReadFailure({ kind: 'transport', code })).toBe('transient');
    }
    expect(classifyReadFailure({ kind: 'transport', code: 'ETIMEDOUT' })).toBe('unknown');
    expect(classifyReadFailure({ kind: 'transport', code: 'ETIMEDOUT', requestOwned: true })).toBe('transient');
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ECONNREFUSED', 'ENOBUFS']) {
      expect(classifyReadFailure({ kind: 'transport', code })).toBe('unknown');
    }
  });

  test('never treats a timeout sentence, an abort, or a Cloudflare 10013 denial as retryable', () => {
    expect(classifyReadFailure({ kind: 'unknown', message: 'request timeout while talking to gh' })).toBe('unknown');
    expect(classifyReadFailure({ kind: 'transport', code: null, stderr: 'connect ETIMEDOUT 1.2.3.4:443' })).toBe('unknown');
    expect(classifyReadFailure({ kind: 'operator-abort', message: 'aborted' })).toBe('permanent');
    expect(classifyReadFailure({ kind: 'http', httpStatus: 403, body: 'error code: 10013' })).toBe('permanent');
    expect(classifyReadFailure({ kind: 'http', httpStatus: 429, body: 'error code: 10013', retryAfterMs: 500 })).toBe('permanent');
  });
});

describe('retryRead', () => {
  const ALLOWED = [
    'github.workflow-definition',
    'github.workflow-runs-page',
    'github.run',
    'github.run-jobs-page',
    'desktop.release-info',
    'desktop.release-info-visible'
  ];

  test('accepts every allowlisted operation and refuses anything else before the callback', async () => {
    for (const operation of ALLOWED) {
      let calls = 0;
      const value = await retryRead(operation, async () => {
        calls++;
        return operation;
      }, {});
      expect(value).toBe(operation);
      expect(calls).toBe(1);
    }
    for (const operation of ['github.workflow-runs', 'shell.exec', 'desktop.release-info.extra', 'github.run-cancel', '', undefined]) {
      let calls = 0;
      await expect(
        retryRead(operation, async () => {
          calls++;
          return 'never';
        }, {})
      ).rejects.toMatchObject({ kind: 'invalid-operation' });
      expect(calls).toBe(0);
    }
  });

  test('retries a transient failure and reports the original diagnostic before the classification', async () => {
    const clock = fakeClock();
    let calls = 0;
    const value = await retryRead('github.run', async () => {
      calls++;
      if (calls === 1) throw httpError(503, { stderr: 'gh: 503 from upstream', body: 'origin down' });
      return 'run';
    }, { now: clock.now, sleep: clock.sleep, logReadFailure: clock.log });
    expect(value).toBe('run');
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.events).toHaveLength(1);
    expect(clock.events[0].classification).toBe('transient');
    expect(clock.events[0].retrying).toBe(true);
    expect(clock.events[0].delayMs).toBe(1000);
    expect(clock.events[0].diagnostic).toContain('gh: 503 from upstream');
    expect(clock.events[0].diagnostic).toContain('origin down');
    expect(Object.keys(clock.events[0]).indexOf('diagnostic')).toBeLessThan(
      Object.keys(clock.events[0]).indexOf('classification')
    );
  });

  test('permanent and unknown failures are attempted once', async () => {
    const cases = [httpError(404), httpError(401), httpError(500), { kind: 'unknown', message: 'no envelope' }, { kind: 'invalid-json' }];
    for (const failure of cases) {
      const clock = fakeClock();
      let calls = 0;
      let thrown = null;
      try {
        await retryRead('github.run', async () => {
          calls++;
          throw failure;
        }, { now: clock.now, sleep: clock.sleep, logReadFailure: clock.log });
      } catch (error) {
        thrown = error;
      }
      expect(thrown.attempts).toBe(1);
      expect(thrown.attemptErrors).toHaveLength(1);
      expect(thrown.attemptErrors[0]).toBe(failure);
      expect(thrown.cause).toBe(failure);
      expect(calls).toBe(1);
      expect(clock.sleeps).toEqual([]);
      expect(clock.events).toHaveLength(1);
      expect(clock.events[0].retrying).toBe(false);
    }
  });

  test('three transient timeouts exhaust the budget with caps 30000, 30000 and 26000', async () => {
    const clock = fakeClock();
    const caps = [];
    const events = [];
    await expect(
      retryRead('github.run', async ({ attempt, timeoutMs }) => {
        caps.push(timeoutMs);
        clock.advance(timeoutMs);
        throw Object.assign(new Error(`attempt ${attempt} timed out`), {
          kind: 'transport',
          code: 'ETIMEDOUT',
          requestOwned: true,
          stderr: `gh: request ${attempt} exceeded its cap`
        });
      }, { now: clock.now, sleep: clock.sleep, logReadFailure: (event) => events.push(event) })
    ).rejects.toMatchObject({ attempts: 3 });
    expect(caps).toEqual([30000, 30000, 26000]);
    expect(clock.sleeps).toEqual([1000, 3000]);
    expect(clock.ms).toBe(90000);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.classification)).toEqual(['transient', 'transient', 'transient']);
    expect(events[2].diagnostic).toContain('attempt 3 timed out');
  });

  test('retains ordered attempt errors, the original cause and the diagnostics of a final failure', async () => {
    const clock = fakeClock();
    const failures = [];
    let thrown = null;
    try {
      await retryRead('github.run', async ({ attempt }) => {
        const failure = Object.assign(new Error(`original diagnostic ${attempt}`), {
          kind: 'transport',
          code: 'ECONNRESET',
          stderr: `gh: connection reset ${attempt}`,
          stdout: `partial envelope ${attempt}`
        });
        failures.push(failure);
        return Promise.reject(failure);
      }, { now: clock.now, sleep: clock.sleep, logReadFailure: clock.log });
    } catch (error) {
      thrown = error;
    }
    expect(thrown.attempts).toBe(3);
    expect(thrown.attemptErrors).toEqual(failures);
    expect(thrown.cause).toBe(failures[2]);
    expect(thrown.attemptErrors[0]).not.toBe(thrown);
    expect(thrown.cause).not.toBe(thrown);
    expect(thrown.kind).toBe('transport');
    expect(thrown.code).toBe('ECONNRESET');
    expect(thrown.stderr).toContain('gh: connection reset 3');
    expect(thrown.message).not.toBe('retries exhausted');
    expect(thrown.message).toContain('original diagnostic 3');
    expect(thrown.message).toContain('3 attempts');
  });

  test('honours a bounded server Retry-After and stops on a delay that cannot fit', async () => {
    const bounded = fakeClock();
    let calls = 0;
    const value = await retryRead('github.run', async () => {
      calls++;
      if (calls === 1) throw httpError(429, { retryAfterMs: 2000, retryAt: bounded.wall + 2000 });
      return 'run';
    }, { now: bounded.now, sleep: bounded.sleep, logReadFailure: bounded.log });
    expect(value).toBe('run');
    expect(bounded.sleeps).toEqual([2000]);

    const tooLong = fakeClock();
    let attempts = 0;
    let thrown = null;
    try {
      await retryRead('github.run', async () => {
        attempts++;
        throw httpError(503, { retryAfterMs: 120000, retryAt: tooLong.wall + 120000 });
      }, { now: tooLong.now, sleep: tooLong.sleep, logReadFailure: tooLong.log });
    } catch (error) {
      thrown = error;
    }
    expect(attempts).toBe(1);
    expect(tooLong.sleeps).toEqual([]);
    expect(thrown.retryAfterMs).toBe(120000);
    expect(thrown.retryAt).toBe(tooLong.wall + 120000);
    expect(thrown.message).toContain('retry at');
    expect(thrown.message).toContain(new Date(tooLong.wall + 120000).toISOString());
  });

  test('parent correction: honors a raw retry-after header before classification and delay choice', async () => {
    const clock = fakeClock();
    const events = [];
    let calls = 0;
    let thrown = null;
    try {
      await retryRead(
        'github.run',
        async () => {
          calls++;
          throw { kind: 'http', httpStatus: 429, headers: { 'retry-after': '60' } };
        },
        { now: clock.now, wallNow: clock.wallNow, sleep: clock.sleep, logReadFailure: (event) => events.push(event) },
        { deadline: 90000 }
      );
    } catch (error) {
      thrown = error;
    }
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([60000]);
    expect(clock.ms).toBe(60000);
    expect(events[0].classification).toBe('transient');
    expect(events[0].delayMs).toBe(60000);
    expect(events[0].retryAt).toBe(clock.wall + 60000);
    expect(events[1].retrying).toBe(false);
    expect(thrown.attempts).toBe(2);
    expect(thrown.retryAfterMs).toBe(60000);
    expect(thrown.retryAt).toBe(clock.wall + 60000);
    expect(thrown.message).toContain('retry at');
  });

  test('parent correction: honors a proven 403 x-ratelimit reset for classification and wait', async () => {
    const clock = fakeClock();
    const events = [];
    let calls = 0;
    const value = await retryRead(
      'github.run',
      async () => {
        calls++;
        if (calls === 1) {
          throw {
            kind: 'http',
            httpStatus: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1030' }
          };
        }
        return 'run';
      },
      { now: clock.now, wallNow: clock.wallNow, sleep: clock.sleep, logReadFailure: (event) => events.push(event) }
    );
    expect(value).toBe('run');
    expect(clock.sleeps).toEqual([30000]);
    expect(events[0].classification).toBe('transient');
    expect(events[0].delayMs).toBe(30000);
    expect(events[0].retryAt).toBe(1_030_000);
  });

  test('parent correction: stops instead of truncating a server deadline that cannot fit the budget', async () => {
    const clock = fakeClock();
    const events = [];
    let calls = 0;
    let thrown = null;
    try {
      await retryRead(
        'github.run',
        async () => {
          calls++;
          throw { kind: 'http', httpStatus: 503, headers: { 'retry-after': '120' } };
        },
        { now: clock.now, wallNow: clock.wallNow, sleep: clock.sleep, logReadFailure: (event) => events.push(event) },
        { deadline: 90000 }
      );
    } catch (error) {
      thrown = error;
    }
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(events[0].classification).toBe('transient');
    expect(events[0].retrying).toBe(false);
    expect(events[0].retryAt).toBe(clock.wall + 120000);
    expect(thrown.attempts).toBe(1);
    expect(thrown.retryAfterMs).toBe(120000);
    expect(thrown.retryAt).toBe(clock.wall + 120000);
    expect(thrown.message).toContain('retry at');
  });

  test('parent correction: keeps the default delay when a header asks for less and honors larger server minimums', async () => {
    const shortClock = fakeClock();
    let shortCalls = 0;
    const shortValue = await retryRead(
      'github.run',
      async () => {
        shortCalls++;
        if (shortCalls === 1) {
          throw { kind: 'http', httpStatus: 429, headers: { 'retry-after': '0.5' } };
        }
        return 'run';
      },
      { now: shortClock.now, wallNow: shortClock.wallNow, sleep: shortClock.sleep, logReadFailure: shortClock.log }
    );
    expect(shortValue).toBe('run');
    expect(shortClock.sleeps).toEqual([1000]);

    for (const status of [502, 503, 504]) {
      const clock = fakeClock();
      const events = [];
      let calls = 0;
      const value = await retryRead(
        'github.run',
        async () => {
          calls++;
          if (calls === 1) {
            throw { kind: 'http', httpStatus: status, headers: { 'retry-after': '5' } };
          }
          return status;
        },
        { now: clock.now, wallNow: clock.wallNow, sleep: clock.sleep, logReadFailure: (event) => events.push(event) }
      );
      expect(value).toBe(status);
      expect(clock.sleeps).toEqual([5000]);
      expect(events[0].classification).toBe('transient');
      expect(events[0].delayMs).toBe(5000);
    }
  });

  test('parent correction: never waits on a permanent status even when a server header is present', async () => {
    const clock = fakeClock();
    const events = [];
    let calls = 0;
    await expect(
      retryRead(
        'github.run',
        async () => {
          calls++;
          throw { kind: 'http', httpStatus: 404, headers: { 'retry-after': '60' } };
        },
        { now: clock.now, wallNow: clock.wallNow, sleep: clock.sleep, logReadFailure: (event) => events.push(event) }
      )
    ).rejects.toMatchObject({ attempts: 1, httpStatus: 404 });
    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(events[0].classification).toBe('permanent');
    expect(events[0].retrying).toBe(false);
  });

  test('parent correction: still stops for unusable and missing header deadlines', async () => {
    const unusable = fakeClock();
    const events = [];
    let calls = 0;
    await expect(
      retryRead(
        'github.run',
        async () => {
          calls++;
          throw {
            kind: 'http',
            httpStatus: 403,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '10' }
          };
        },
        { now: unusable.now, wallNow: unusable.wallNow, sleep: unusable.sleep, logReadFailure: (event) => events.push(event) }
      )
    ).rejects.toMatchObject({ attempts: 1, httpStatus: 403 });
    expect(calls).toBe(1);
    expect(unusable.sleeps).toEqual([]);
    expect(events[0].classification).toBe('unknown');

    const missing = fakeClock();
    let missingCalls = 0;
    await expect(
      retryRead(
        'github.run',
        async () => {
          missingCalls++;
          throw { kind: 'http', httpStatus: 429 };
        },
        { now: missing.now, wallNow: missing.wallNow, sleep: missing.sleep, logReadFailure: missing.log }
      )
    ).rejects.toMatchObject({ attempts: 1, httpStatus: 429 });
    expect(missingCalls).toBe(1);
    expect(missing.sleeps).toEqual([]);
    expect(missing.events[0].classification).toBe('unknown');
  });

  test('clips every request to the injected workflow deadline and never calls past it', async () => {
    const clipped = fakeClock();
    const caps = [];
    let attempts = 0;
    await expect(
      retryRead('github.run', async ({ timeoutMs }) => {
        attempts++;
        caps.push(timeoutMs);
        clipped.advance(timeoutMs);
        throw httpError(503);
      }, { now: clipped.now, sleep: clipped.sleep, logReadFailure: clipped.log }, { deadline: 1000 })
    ).rejects.toMatchObject({ attempts: 1 });
    expect(caps).toEqual([1000]);
    expect(clipped.sleeps).toEqual([]);

    const expired = fakeClock();
    let calls = 0;
    await expect(
      retryRead('github.run', async () => {
        calls++;
        return 'never';
      }, { now: expired.now, sleep: expired.sleep, logReadFailure: expired.log }, { deadline: 0 })
    ).rejects.toMatchObject({ kind: 'deadline', attempts: 0, attemptErrors: [] });
    expect(calls).toBe(0);
  });

  test('stops before the first call when the operator signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const clock = fakeClock();
    let calls = 0;
    await expect(
      retryRead('github.run', async () => {
        calls++;
        return 'never';
      }, { now: clock.now, sleep: clock.sleep, signal: controller.signal, logReadFailure: clock.log })
    ).rejects.toMatchObject({ kind: 'operator-abort', attempts: 0, abortedByOperator: true });
    expect(calls).toBe(0);
    expect(clock.events).toEqual([]);
  });

  test('stops before the next wait and the next call when the operator aborts during a retry', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    let calls = 0;
    clock.sleep = (ms) => {
      clock.sleeps.push(ms);
      controller.abort();
      return Promise.resolve();
    };
    await expect(
      retryRead('github.run', async () => {
        calls++;
        throw httpError(503, { stderr: 'gh: 503' });
      }, { now: clock.now, sleep: clock.sleep, signal: controller.signal, logReadFailure: clock.log })
    ).rejects.toMatchObject({ kind: 'operator-abort', attempts: 1, abortedByOperator: true });
    expect(calls).toBe(1);
    expect(clock.events).toHaveLength(1);
  });

  test('logs every failed attempt through the canonical stderr drain when no logger is supplied', async () => {
    const original = fs.writeSync;
    const calls = [];
    const spy = jest.spyOn(fs, 'writeSync').mockImplementation((...args) => {
      calls.push(args);
      return original.apply(fs, args);
    });
    try {
      const clock = fakeClock();
      await expect(
        retryRead('github.run', async () => {
          throw httpError(503, { stderr: 'gh: wrote this to stderr', body: 'upstream body' });
        }, { now: clock.now, sleep: clock.sleep })
      ).rejects.toBeTruthy();
      const written = calls
        .filter((args) => args[0] === 2 && Buffer.isBuffer(args[1]))
        .map((args) => args[1].toString('utf8'))
        .join('');
      expect(written).toContain('gh: wrote this to stderr');
      expect(written).toContain('upstream body');
      expect(written).toMatch(/\[release-read\] github\.run attempt 1\/3 transient/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('readGithubJson', () => {
  const runEndpoint = `repos/${REPO}/actions/runs/1287`;

  test('pins the exact gh command, API version header and request bounds', async () => {
    const runner = fakeRunner([ghOk({ id: 1287 })]);
    const clock = fakeClock();
    const value = await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
      run: runner.run,
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ id: 1287 });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].file).toBe('gh');
    expect(runner.calls[0].args).toEqual([
      'api',
      '--method',
      'GET',
      '--include',
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2026-03-10',
      runEndpoint
    ]);
    expect(runner.calls[0].args).not.toContain('--verbose');
    expect(runner.calls[0].args).not.toContain('--paginate');
    expect(runner.calls[0].options).toMatchObject({
      shell: false,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024
    });
    expect(runner.calls[0].options.env.GH_FORCE_TTY).toBe('0');
    expect(runner.calls[0].options.env.NO_COLOR).toBe('1');
  });

  test('retries a realistic mixed-newline 503 envelope and keeps the non-JSON error body', async () => {
    const stdout =
      'HTTP/2.0 503 Service Unavailable\n' +
      'content-type: text/html\r\n' +
      'retry-after: 1\r\n' +
      '\r\n' +
      '<html>upstream exploded</html>';
    const runner = fakeRunner([
      { status: 1, signal: null, stdout, stderr: 'gh: 503 (https://api.github.com)' },
      ghOk({ id: 42 })
    ]);
    const clock = fakeClock();
    const value = await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
      run: runner.run,
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ id: 42 });
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.events[0].classification).toBe('transient');
    const first = clock.events[0];
    expect(first.httpStatus).toBe(503);
    expect(first.body).toBe('<html>upstream exploded</html>');
    expect(first.diagnostic).toContain('upstream exploded');
    expect(runner.calls[1].args[runner.calls[1].args.length - 1]).toBe(runEndpoint);
    expect(runner.calls[1].options.timeout).toBe(30000);
  });

  test('treats a missing envelope as unknown and attempts it once', async () => {
    const runner = fakeRunner([{ status: 1, signal: null, stdout: '', stderr: 'gh: could not resolve host' }]);
    const clock = fakeClock();
    await expect(
      readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: runner.run,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'unknown' });
    expect(runner.calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
    expect(clock.events[0].classification).toBe('unknown');
    expect(clock.events[0].stderr).toContain('could not resolve host');
  });

  test('retries only the runner ETIMEDOUT request cap as a request-owned timeout', async () => {
    const runner = fakeRunner([ghTimeout(), ghTimeout(), ghOk({ id: 7 })]);
    const caps = [];
    const clock = fakeClock();
    const value = await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
      run: (file, args, options) => {
        caps.push(options.timeout);
        clock.advance(options.timeout);
        return runner.run(file, args, options);
      },
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ id: 7 });
    expect(caps).toEqual([30000, 30000, 26000]);
    expect(clock.events.map((event) => event.classification)).toEqual(['transient', 'transient']);
  });

  test('treats a 2xx envelope with a failing process exit as unknown, and malformed JSON as permanent', async () => {
    const oddExit = fakeRunner([
      { status: 1, signal: null, stdout: envelope(200, { 'content-type': 'application/json' }, '{"id":1}'), stderr: 'gh: exited 1' }
    ]);
    const first = fakeClock();
    await expect(
      readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: oddExit.run,
        now: first.now,
        wallNow: first.wallNow,
        sleep: first.sleep,
        logReadFailure: first.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'unknown', httpStatus: 200 });
    expect(oddExit.calls).toHaveLength(1);

    const broken = fakeRunner([
      { status: 0, signal: null, stdout: envelope(200, { 'content-type': 'application/json' }, '{"id":'), stderr: '' }
    ]);
    const second = fakeClock();
    await expect(
      readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: broken.run,
        now: second.now,
        wallNow: second.wallNow,
        sleep: second.sleep,
        logReadFailure: second.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'invalid-json', body: '{"id":' });
    expect(broken.calls).toHaveLength(1);
    expect(second.sleeps).toEqual([]);
  });

  test('treats a signal-killed runner as permanent', async () => {
    const runner = fakeRunner([{ status: null, signal: 'SIGINT', stdout: '', stderr: '' }]);
    const clock = fakeClock();
    await expect(
      readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: runner.run,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'signal' });
    expect(runner.calls).toHaveLength(1);
  });

  test('parent correction: keeps the original gh stderr and stdout on an ordinary 403', async () => {
    const stdout = envelope(403, { 'content-type': 'application/json' }, JSON.stringify({ message: 'denied' }));
    const runner = fakeRunner([{ status: 1, signal: null, stdout, stderr: 'ORIGINAL GH DIAGNOSTIC' }]);
    const clock = fakeClock();
    let thrown = null;
    try {
      await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: runner.run,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(runner.calls).toHaveLength(1);
    expect(thrown.attempts).toBe(1);
    expect(thrown.httpStatus).toBe(403);
    expect(thrown.body).toBe(JSON.stringify({ message: 'denied' }));
    expect(thrown.stderr).toBe('ORIGINAL GH DIAGNOSTIC');
    expect(thrown.stdout).toBe(stdout);
    expect(thrown.runnerStatus).toBe(1);
    expect(thrown.runnerSignal).toBeNull();
    expect(thrown.attemptErrors[0].stderr).toBe('ORIGINAL GH DIAGNOSTIC');
    expect(thrown.attemptErrors[0].stdout).toBe(stdout);
    expect(thrown.attemptErrors[0].body).toBe(JSON.stringify({ message: 'denied' }));
    expect(clock.events).toHaveLength(1);
    expect(clock.events[0].stderr).toBe('ORIGINAL GH DIAGNOSTIC');
    expect(clock.events[0].stdout).toBe(stdout);
    expect(clock.events[0].body).toBe(JSON.stringify({ message: 'denied' }));
    expect(clock.events[0].httpStatus).toBe(403);
    expect(clock.events[0].classification).toBe('permanent');
    expect(clock.events[0].diagnostic).toContain('ORIGINAL GH DIAGNOSTIC');
  });

  test('parent correction: keeps original gh diagnostics across a transient 503 and the retry that follows', async () => {
    const firstStdout = envelope(503, { 'content-type': 'text/html' }, '<html>upstream down</html>');
    const secondStdout = envelope(503, { 'content-type': 'text/html' }, '<html>still down</html>');
    const runner = fakeRunner([
      { status: 1, signal: null, stdout: firstStdout, stderr: 'ORIGINAL GH DIAGNOSTIC one' },
      { status: 1, signal: null, stdout: secondStdout, stderr: 'ORIGINAL GH DIAGNOSTIC two' },
      ghOk({ id: 42 })
    ]);
    const clock = fakeClock();
    const value = await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
      run: runner.run,
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ id: 42 });
    expect(clock.sleeps).toEqual([1000, 3000]);
    expect(clock.events.map((event) => event.stderr)).toEqual(['ORIGINAL GH DIAGNOSTIC one', 'ORIGINAL GH DIAGNOSTIC two']);
    expect(clock.events.map((event) => event.stdout)).toEqual([firstStdout, secondStdout]);
    expect(clock.events.map((event) => event.body)).toEqual(['<html>upstream down</html>', '<html>still down</html>']);
    expect(clock.events.map((event) => event.classification)).toEqual(['transient', 'transient']);
    expect(clock.events[0].error.stderr).toBe('ORIGINAL GH DIAGNOSTIC one');
    expect(clock.events[0].error.runnerStatus).toBe(1);
  });

  test('parent correction: retains each original gh diagnostic in ordered attempt errors when 503 persists', async () => {
    const stdoutFor = (n) => envelope(503, { 'content-type': 'text/html' }, `<html>failure ${n}</html>`);
    const runner = fakeRunner([
      { status: 1, signal: null, stdout: stdoutFor(1), stderr: 'ORIGINAL GH DIAGNOSTIC 1' },
      { status: 1, signal: null, stdout: stdoutFor(2), stderr: 'ORIGINAL GH DIAGNOSTIC 2' },
      { status: 1, signal: null, stdout: stdoutFor(3), stderr: 'ORIGINAL GH DIAGNOSTIC 3' }
    ]);
    const clock = fakeClock();
    let thrown = null;
    try {
      await readGithubJson('github.run', { repo: REPO, endpoint: runEndpoint }, {
        run: runner.run,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(runner.calls).toHaveLength(3);
    expect(thrown.attempts).toBe(3);
    expect(thrown.attemptErrors.map((error) => error.stderr)).toEqual([
      'ORIGINAL GH DIAGNOSTIC 1',
      'ORIGINAL GH DIAGNOSTIC 2',
      'ORIGINAL GH DIAGNOSTIC 3'
    ]);
    expect(thrown.attemptErrors.map((error) => error.stdout)).toEqual([stdoutFor(1), stdoutFor(2), stdoutFor(3)]);
    expect(thrown.attemptErrors.map((error) => error.body)).toEqual([
      '<html>failure 1</html>',
      '<html>failure 2</html>',
      '<html>failure 3</html>'
    ]);
    expect(thrown.stderr).toBe('ORIGINAL GH DIAGNOSTIC 3');
    expect(thrown.body).toBe('<html>failure 3</html>');
    expect(clock.events).toHaveLength(3);
  });

  test('accepts only the endpoint each operation allows', async () => {
    const allowed = [
      ['github.workflow-definition', `repos/${REPO}/actions/workflows/release.yml`],
      ['github.workflow-definition', `repos/${REPO}/actions/workflows/73`],
      ['github.workflow-runs-page', `repos/${REPO}/actions/workflows/73/runs?event=workflow_dispatch&per_page=100&page=1`],
      ['github.run', runEndpoint],
      ['github.run-jobs-page', `repos/${REPO}/actions/runs/1287/attempts/2/jobs?per_page=100&page=3`]
    ];
    for (const [operation, endpoint] of allowed) {
      const runner = fakeRunner([ghOk({ ok: true })]);
      const clock = fakeClock();
      await readGithubJson(operation, { repo: REPO, endpoint }, {
        run: runner.run,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
      expect(runner.calls[0].args[runner.calls[0].args.length - 1]).toBe(endpoint);
    }
  });

  test('refuses absolute URLs, traversal, wrong queries and credentialed repositories', async () => {
    const rejected = [
      ['github.run', { repo: REPO, endpoint: `https://api.github.com/repos/${REPO}/actions/runs/1` }],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/1/../../../secrets` }],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/1#fragment` }],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/0` }],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/1287?per_page=100` }],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/workflows/73` }],
      ['github.workflow-runs-page', { repo: REPO, endpoint: `repos/${REPO}/actions/workflows/73/runs?event=workflow_dispatch&per_page=100&page=1&extra=1` }],
      ['github.workflow-runs-page', { repo: REPO, endpoint: `repos/${REPO}/actions/workflows/73/runs?event=push&per_page=100&page=1` }],
      ['github.run-jobs-page', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/1287/jobs?per_page=100&page=1` }],
      ['github.workflow-definition', { repo: REPO, endpoint: `repos/${REPO}/actions/workflows/other.yml` }],
      ['github.run', { repo: 'token@example/repo', endpoint: 'repos/token@example/repo/actions/runs/1' }],
      ['github.run', { repo: '../repo', endpoint: 'repos/../repo/actions/runs/1' }],
      ['github.run', { repo: REPO, endpoint: '' }],
      ['github.run', {}, ],
      ['github.run', { repo: REPO, endpoint: `repos/${REPO}/actions/runs/1\r\nX-Injected: 1` }]
    ];
    for (const [operation, request] of rejected) {
      const runner = fakeRunner([]);
      await expect(
        readGithubJson(operation, request, { run: runner.run, now: () => 0, sleep: () => Promise.resolve() })
      ).rejects.toMatchObject({ kind: expect.stringMatching(/^invalid-(endpoint|request)$/) });
      expect(runner.calls).toHaveLength(0);
    }
  });

  test('refuses desktop and unknown operations outright', async () => {
    for (const operation of ['desktop.release-info', 'desktop.release-info-visible', 'shell.exec']) {
      const runner = fakeRunner([]);
      await expect(
        readGithubJson(operation, { repo: REPO, endpoint: runEndpoint }, { run: runner.run })
      ).rejects.toMatchObject({ kind: 'invalid-operation' });
      expect(runner.calls).toHaveLength(0);
    }
  });
});

describe('readReleaseInfo', () => {
  test('reads the fixed URL with a cache-busting stamp and a strict GET', async () => {
    const clock = fakeClock();
    const seen = [];
    const fetchFn = async (url, options) => {
      seen.push({ url, options });
      clock.wall += 10;
      return textResponse(JSON.stringify({ version: '1.28.0', commit: 'a'.repeat(40) }), {
        headers: { 'content-type': 'application/json' }
      });
    };
    const value = await readReleaseInfo({
      fetch: fetchFn,
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ version: '1.28.0', commit: 'a'.repeat(40) });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${RELEASE_INFO_URL}?t=1000000`);
    expect(seen[0].options.method).toBe('GET');
    expect(seen[0].options.signal).toBeDefined();
    expect(seen[0].options.signal.aborted).toBe(false);
  });

  test('cache-busts every attempt and retries a transient 503 with the 1s delay', async () => {
    const clock = fakeClock();
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      clock.wall += 5;
      if (urls.length === 1) {
        return textResponse('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return textResponse(JSON.stringify({ version: '1.28.0' }), { headers: { 'content-type': 'application/json' } });
    };
    const value = await readReleaseInfo({
      fetch: fetchFn,
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(value).toEqual({ version: '1.28.0' });
    expect(clock.sleeps).toEqual([1000]);
    expect(urls[0]).toBe(`${RELEASE_INFO_URL}?t=1000000`);
    expect(urls[1]).toBe(`${RELEASE_INFO_URL}?t=1000005`);
  });

  test('does not make a 404 retryable for the immediate visibility operation', async () => {
    const clock = fakeClock();
    const seen = [];
    await expect(
      readReleaseInfo(
        {
          fetch: async (url) => {
            seen.push(url);
            clock.wall += 5;
            return textResponse('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
          },
          now: clock.now,
          wallNow: clock.wallNow,
          sleep: clock.sleep,
          logReadFailure: clock.log
        },
        { operation: 'desktop.release-info-visible' }
      )
    ).rejects.toMatchObject({
      attempts: 1,
      kind: 'http',
      httpStatus: 404,
      operation: 'desktop.release-info-visible',
      body: 'Not Found'
    });
    expect(seen).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
    expect(clock.events[0].classification).toBe('permanent');
  });

  test('preserves status, headers and body of a structured non-2xx failure', async () => {
    const clock = fakeClock();
    await expect(
      readReleaseInfo({
        fetch: async () => textResponse('{"message":"rate limited"}', {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '2' }
        }),
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '2' },
      retryAfterMs: 2000,
      retryAt: clock.wall + 2000
    });
  });

  test('treats malformed 2xx JSON as permanent and keeps the body', async () => {
    const clock = fakeClock();
    const seen = [];
    await expect(
      readReleaseInfo({
        fetch: async () => {
          seen.push(1);
          return textResponse('{"version":', { headers: { 'content-type': 'application/json' } });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'invalid-json', body: '{"version":' });
    expect(seen).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  test('refuses an oversized declared body without reading or retrying it', async () => {
    const clock = fakeClock();
    const seen = [];
    let canceled = false;
    await expect(
      readReleaseInfo({
        fetch: async () => {
          seen.push(1);
          return chunkResponse([Buffer.from('{}')], {
            headers: { 'content-length': String(9 * 1024 * 1024) },
            onCancel: () => {
              canceled = true;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'schema' });
    expect(seen).toHaveLength(1);
    expect(canceled).toBe(true);
  });

  test('aborts and cancels a stream that exceeds the body bound on its own', async () => {
    const clock = fakeClock();
    const seen = [];
    let canceled = false;
    await expect(
      readReleaseInfo({
        fetch: async () => {
          seen.push(1);
          return chunkResponse([Buffer.alloc(5 * 1024 * 1024, 120), Buffer.alloc(5 * 1024 * 1024, 120)], {
            onCancel: () => {
              canceled = true;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'schema' });
    expect(seen).toHaveLength(1);
    expect(canceled).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  test('parent correction: refuses a non-2xx declared oversize body once as a permanent schema failure', async () => {
    const clock = fakeClock();
    let fetches = 0;
    let canceled = 0;
    let thrown = null;
    try {
      await readReleaseInfo({
        fetch: async () => {
          fetches++;
          return chunkResponse([Buffer.from('{}')], {
            status: 503,
            headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) },
            onCancel: () => {
              canceled++;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown.attempts).toBe(1);
    expect(thrown.kind).toBe('schema');
    expect(thrown.bodyTooLarge).toBe(true);
    expect(thrown.attemptErrors[0].bodyTooLarge).toBe(true);
    expect(clock.events[0].classification).toBe('permanent');
    expect(canceled).toBe(1);
  });

  test('parent correction: cancels an unread declared-oversize body before failing', async () => {
    const clock = fakeClock();
    let canceled = 0;
    await expect(
      readReleaseInfo({
        fetch: async () => chunkResponse([], {
          headers: { 'content-length': String(9 * 1024 * 1024) },
          onCancel: () => {
            canceled++;
          }
        }),
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      })
    ).rejects.toMatchObject({ attempts: 1, kind: 'schema', bodyTooLarge: true });
    expect(canceled).toBe(1);
  });

  test('parent correction: retains the cause of a transient non-2xx body read failure', async () => {
    const clock = fakeClock();
    const readFailure = Object.assign(new Error('body stream failed mid-read'), { code: 'ECONNRESET' });
    let fetches = 0;
    let thrown = null;
    try {
      await readReleaseInfo({
        fetch: async () => {
          fetches++;
          return {
            status: 503,
            headers: { 'content-type': 'application/json' },
            body: {
              getReader() {
                return {
                  read: async () => {
                    throw readFailure;
                  },
                  cancel: async () => {}
                };
              }
            }
          };
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(3);
    expect(thrown.attempts).toBe(3);
    expect(thrown.kind).toBe('http');
    expect(thrown.httpStatus).toBe(503);
    expect(thrown.attemptErrors[0].cause).toBe(readFailure);
    expect(thrown.cause.cause).toBe(readFailure);
    expect(clock.events[0].classification).toBe('transient');
    expect(clock.events[0].error.cause).toBe(readFailure);
    expect(clock.sleeps).toEqual([1000, 3000]);
  });

  test('times out while the body is still pending, cancels the reader and clears its timer', async () => {
    jest.useFakeTimers();
    try {
      let canceled = false;
      const calls = [];
      const fetchFn = async () => {
        calls.push(calls.length + 1);
        if (calls.length === 1) {
          return pendingResponse({
            headers: { 'content-type': 'application/json' },
            onCancel: () => {
              canceled = true;
            }
          });
        }
        return textResponse('{"version":"1.28.0"}', { headers: { 'content-type': 'application/json' } });
      };
      const events = [];
      const pending = readReleaseInfo({
        fetch: fetchFn,
        now: () => Date.now(),
        wallNow: () => 7,
        sleep: async (ms) => {
          jest.advanceTimersByTime(ms);
        },
        logReadFailure: (event) => events.push(event)
      });
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(30000);
      await expect(pending).resolves.toEqual({ version: '1.28.0' });
      expect(calls).toHaveLength(2);
      expect(canceled).toBe(true);
      expect(events[0].classification).toBe('transient');
      expect(events[0].code).toBe('ETIMEDOUT');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('clears its request timer after a successful read', async () => {
    jest.useFakeTimers();
    try {
      const value = await readReleaseInfo({
        fetch: async () => textResponse('{"version":"1.28.0"}', { headers: { 'content-type': 'application/json' } }),
        now: () => Date.now(),
        wallNow: () => 7,
        sleep: async () => {},
        logReadFailure: () => {}
      });
      expect(value).toEqual({ version: '1.28.0' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('forwards the operator signal as an abort that is not a transient timeout', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    let seen = null;
    const pending = readReleaseInfo({
      fetch: (url, options) => {
        seen = options;
        return new Promise(() => {});
      },
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      signal: controller.signal,
      logReadFailure: clock.log
    });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'operator-abort', abortedByOperator: true, attempts: 1 });
    expect(seen.signal.aborted).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  test('distinguishes transport codes in the cause chain: ECONNRESET retries, DNS does not', async () => {
    const resetClock = fakeClock();
    let resets = 0;
    const reset = async () => {
      resets++;
      if (resets === 1) {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        });
      }
      return textResponse('{"version":"1.28.0"}', { headers: { 'content-type': 'application/json' } });
    };
    const value = await readReleaseInfo({
      fetch: reset,
      now: resetClock.now,
      wallNow: resetClock.wallNow,
      sleep: resetClock.sleep,
      logReadFailure: resetClock.log
    });
    expect(value).toEqual({ version: '1.28.0' });
    expect(resetClock.sleeps).toEqual([1000]);

    const dnsClock = fakeClock();
    let dns = 0;
    let thrown = null;
    try {
      await readReleaseInfo({
        fetch: async () => {
          dns++;
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND local.hyperclay.com'), { code: 'ENOTFOUND' })
          });
        },
        now: dnsClock.now,
        wallNow: dnsClock.wallNow,
        sleep: dnsClock.sleep,
        logReadFailure: dnsClock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(dns).toBe(1);
    expect(thrown.kind).toBe('transport');
    expect(thrown.code).toBe('ENOTFOUND');
    const chain = [];
    let current = thrown;
    while (current && typeof current === 'object') {
      chain.push(current);
      current = current.cause;
    }
    const original = chain[chain.length - 1];
    expect(original.code).toBe('ENOTFOUND');
    expect(original.message).toContain('getaddrinfo ENOTFOUND');
    expect(dnsClock.sleeps).toEqual([]);
  });

  test('refuses any operation other than the two desktop reads', async () => {
    for (const operation of ['github.run', 'shell.exec', 'desktop.release-info-latest']) {
      const runner = fakeRunner([]);
      await expect(
        readReleaseInfo({ fetch: async () => textResponse('{}'), run: runner.run }, { operation })
      ).rejects.toMatchObject({ kind: 'invalid-operation' });
      expect(runner.calls).toHaveLength(0);
    }
  });
});

describe('readReleaseInfoEvidence', () => {
  test('returns the exact response bytes across a split multibyte code point, escapes and whitespace', async () => {
    const clock = fakeClock();
    const source = Buffer.from(
      '  {"version":"1.28.0","notes":"caf\u00e9 \u2014 \u2615","escaped":"line\\n\\"quoted\\""}\n',
      'utf8'
    );
    const split = source.indexOf(Buffer.from('\u00e9', 'utf8')) + 1;
    expect(source[split - 1]).toBe(0xc3);
    expect(source[split]).toBe(0xa9);
    const urls = [];
    const result = await readReleaseInfoEvidence({
      fetch: async (url) => {
        urls.push(url);
        clock.wall += 5;
        return chunkResponse([source.subarray(0, split), source.subarray(split)], {
          headers: { 'content-type': 'application/json' }
        });
      },
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.bytes.length).toBe(source.length);
    expect(result.bytes.equals(source)).toBe(true);
    expect(result.value).toEqual({
      version: '1.28.0',
      notes: 'caf\u00e9 \u2014 \u2615',
      escaped: 'line\n"quoted"'
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(`${RELEASE_INFO_URL}?t=1000000`);
    expect(clock.sleeps).toEqual([]);
    expect(clock.events).toEqual([]);
  });

  test('returns only the successful body bytes after a transient 503 retry', async () => {
    const clock = fakeClock();
    const urls = [];
    const successBody = Buffer.from('\t{"version":"1.28.0"}\r\n', 'utf8');
    const failureBody = '{"error":"unavailable"}';
    const result = await readReleaseInfoEvidence({
      fetch: async (url) => {
        urls.push(url);
        clock.wall += 5;
        if (urls.length === 1) {
          return chunkResponse([Buffer.from(failureBody)], {
            status: 503,
            headers: { 'content-type': 'application/json' }
          });
        }
        return chunkResponse([successBody], { headers: { 'content-type': 'application/json' } });
      },
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(result.bytes.equals(successBody)).toBe(true);
    expect(result.bytes.toString('utf8')).not.toContain('unavailable');
    expect(result.value).toEqual({ version: '1.28.0' });
    expect(urls).toEqual([`${RELEASE_INFO_URL}?t=1000000`, `${RELEASE_INFO_URL}?t=1000005`]);
    expect(new Set(urls).size).toBe(2);
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.events).toHaveLength(1);
    expect(clock.events[0]).toMatchObject({
      operation: 'desktop.release-info',
      attempt: 1,
      kind: 'http',
      httpStatus: 503,
      body: failureBody,
      classification: 'transient',
      delayMs: 1000,
      retrying: true
    });
  });

  test('keeps a malformed 2xx JSON permanent and cancels the stream after one fetch', async () => {
    const clock = fakeClock();
    let fetches = 0;
    let canceled = 0;
    let thrown = null;
    try {
      await readReleaseInfoEvidence({
        fetch: async () => {
          fetches++;
          return chunkResponse([Buffer.from('{"version":')], {
            headers: { 'content-type': 'application/json' },
            onCancel: () => {
              canceled++;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown).toMatchObject({ attempts: 1, kind: 'invalid-json', body: '{"version":' });
    expect(clock.events[0].classification).toBe('permanent');
    expect(canceled).toBe(1);
  });

  test('refuses a declared oversize body once and cancels the stream without a second fetch', async () => {
    const clock = fakeClock();
    let fetches = 0;
    let canceled = 0;
    let thrown = null;
    try {
      await readReleaseInfoEvidence({
        fetch: async () => {
          fetches++;
          return chunkResponse([Buffer.from('{}')], {
            headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) },
            onCancel: () => {
              canceled++;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown).toMatchObject({ attempts: 1, kind: 'schema', bodyTooLarge: true });
    expect(clock.events[0].classification).toBe('permanent');
    expect(canceled).toBe(1);
  });

  test('cancels a stream that exceeds the body bound on its own before failing once', async () => {
    const clock = fakeClock();
    let fetches = 0;
    let canceled = 0;
    let thrown = null;
    try {
      await readReleaseInfoEvidence({
        fetch: async () => {
          fetches++;
          return chunkResponse([Buffer.alloc(5 * 1024 * 1024, 120), Buffer.alloc(5 * 1024 * 1024, 120)], {
            headers: { 'content-type': 'application/json' },
            onCancel: () => {
              canceled++;
            }
          });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown).toMatchObject({ attempts: 1, kind: 'schema', bodyTooLarge: true });
    expect(clock.events[0].classification).toBe('permanent');
    expect(canceled).toBeGreaterThan(0);
  });

  test('fails an operator abort once and cancels the pending evidence stream', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    let reading = false;
    let canceled = false;
    let seen = null;
    const pending = readReleaseInfoEvidence({
      fetch: (url, options) => {
        seen = options;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            getReader() {
              return {
                read: () => {
                  reading = true;
                  return new Promise(() => {});
                },
                cancel: async () => {
                  canceled = true;
                }
              };
            }
          }
        };
      },
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      signal: controller.signal,
      logReadFailure: clock.log
    });
    for (let tick = 0; tick < 20 && !reading; tick++) await Promise.resolve();
    expect(reading).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      kind: 'operator-abort',
      abortedByOperator: true,
      attempts: 1
    });
    expect(seen.signal.aborted).toBe(true);
    expect(canceled).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  test('rejects a text-only success once as a permanent schema failure while the legacy reader parses it', async () => {
    const clock = fakeClock();
    const urls = [];
    const body = '{"version":"1.28.0"}';
    let thrown = null;
    try {
      await readReleaseInfoEvidence(
        {
          fetch: async (url) => {
            urls.push(url);
            clock.wall += 5;
            return textOnlyResponse(body, { headers: { 'content-type': 'application/json' } });
          },
          now: clock.now,
          wallNow: clock.wallNow,
          sleep: clock.sleep,
          logReadFailure: clock.log
        },
        { requireBytes: false, evidence: false, bytes: false }
      );
    } catch (error) {
      thrown = error;
    }
    expect(urls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown).toMatchObject({ attempts: 1, kind: 'schema', operation: 'desktop.release-info' });
    expect(clock.events[0].classification).toBe('permanent');

    const legacyClock = fakeClock();
    const value = await readReleaseInfo({
      fetch: async () => textOnlyResponse(body, { headers: { 'content-type': 'application/json' } }),
      now: legacyClock.now,
      wallNow: legacyClock.wallNow,
      sleep: legacyClock.sleep,
      logReadFailure: legacyClock.log
    });
    expect(value).toEqual({ version: '1.28.0' });
    expect(legacyClock.events).toEqual([]);
  });

  test('keeps the status and body of a text-only non-2xx response for evidence reads', async () => {
    const clock = fakeClock();
    let fetches = 0;
    let thrown = null;
    try {
      await readReleaseInfoEvidence({
        fetch: async () => {
          fetches++;
          return textOnlyResponse('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
        },
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      });
    } catch (error) {
      thrown = error;
    }
    expect(fetches).toBe(1);
    expect(clock.sleeps).toEqual([]);
    expect(thrown).toMatchObject({ attempts: 1, kind: 'http', httpStatus: 404, body: 'Not Found' });
    expect(clock.events[0].classification).toBe('permanent');
  });

  test('retains the byteLength bound for a text-only body in both readers', async () => {
    const text = 'x'.repeat(9 * 1024 * 1024);
    for (const reader of [readReleaseInfoEvidence, readReleaseInfo]) {
      const clock = fakeClock();
      let fetches = 0;
      await expect(
        reader({
          fetch: async () => {
            fetches++;
            return textOnlyResponse(text, { headers: { 'content-type': 'application/json' } });
          },
          now: clock.now,
          wallNow: clock.wallNow,
          sleep: clock.sleep,
          logReadFailure: clock.log
        })
      ).rejects.toMatchObject({ attempts: 1, kind: 'schema', bodyTooLarge: true });
      expect(fetches).toBe(1);
      expect(clock.sleeps).toEqual([]);
      expect(clock.events[0].classification).toBe('permanent');
    }
  });

  test('returns bytes that own their storage instead of aliasing the source chunks', async () => {
    const clock = fakeClock();
    const source = Buffer.from('{"version":"1.28.0"}', 'utf8');
    const snapshot = Buffer.from(source);
    const result = await readReleaseInfoEvidence({
      fetch: async () => chunkResponse([source], { headers: { 'content-type': 'application/json' } }),
      now: clock.now,
      wallNow: clock.wallNow,
      sleep: clock.sleep,
      logReadFailure: clock.log
    });
    expect(result.bytes.equals(snapshot)).toBe(true);
    expect(result.bytes).not.toBe(source);
    expect(result.value).toEqual({ version: '1.28.0' });
    result.bytes.fill(0x20);
    expect(source.equals(snapshot)).toBe(true);
  });

  test('keeps the desktop operation allowlist for evidence reads', async () => {
    let fetches = 0;
    const fetchFn = async () => {
      fetches++;
      return chunkResponse([Buffer.from('{}')], { headers: { 'content-type': 'application/json' } });
    };
    for (const operation of ['github.run', 'shell.exec', 'desktop.release-info-latest']) {
      await expect(readReleaseInfoEvidence({ fetch: fetchFn }, { operation })).rejects.toMatchObject({
        kind: 'invalid-operation'
      });
    }
    expect(fetches).toBe(0);
    const clock = fakeClock();
    const visible = await readReleaseInfoEvidence(
      {
        fetch: fetchFn,
        now: clock.now,
        wallNow: clock.wallNow,
        sleep: clock.sleep,
        logReadFailure: clock.log
      },
      { operation: 'desktop.release-info-visible' }
    );
    expect(visible.value).toEqual({});
    expect(visible.bytes.equals(Buffer.from('{}'))).toBe(true);
    expect(fetches).toBe(1);
  });
});
