/**
 * C3.1: classifyError maps every CONTRACTS §3 refusal to one client reaction
 * kind, and apiFetch carries the server's machine fields onto the error.
 */

const { classifyError } = require('../../src/sync-engine/reconcile/classify-error');
const apiClient = require('../../src/sync-engine/api-client');

const CONTRACTS_ROWS = [
  ['401', 'invalid-key', { kind: 'pause-all', reason: 'key-revoked' }],
  ['402', 'payment-required', { kind: 'pause', reason: 'plan-lapsed' }],
  ['403', 'viewer', { kind: 'pause', reason: 'viewer' }],
  ['403', 'forbidden', { kind: 'rediscover', reason: 'forbidden' }],
  ['404', 'not-found', { kind: 'rediscover', reason: 'not-found' }],
  ['404', 'node-not-found', { kind: 'refresh-node' }],
  ['409', 'account-changed', { kind: 'rediscover', reason: 'account-changed' }],
  ['409', 'node-changed', { kind: 'refresh-node' }],
  ['409', 'name-conflict', { kind: 'conflict', conflictKind: 'name-taken' }],
  ['409', 'storage-changing', { kind: 'backoff', retryAfterMs: null }],
  ['412', 'conflict', { kind: 'conflict', conflictKind: 'rejected', etag: null }],
  ['413', 'too-large', { kind: 'skip', reason: 'too-large' }],
  ['413', 'quota-exceeded', { kind: 'uploads-blocked', reason: 'quota-exceeded' }],
  ['423', 'existing', { kind: 'backoff', retryAfterMs: null }],
  ['426', 'server-update-required', { kind: 'fatal', reason: 'server-update-required' }],
  ['428', 'account-identity-required', { kind: 'fatal', reason: 'account-identity-required' }],
  ['428', 'precondition-required', { kind: 'fatal', reason: 'precondition-required' }],
  ['503', 'existing', { kind: 'backoff', retryAfterMs: null }],
  ['503', 'inventory-incomplete', { kind: 'backoff', retryAfterMs: null }],
];

describe('classifyError', () => {
  it.each(CONTRACTS_ROWS)('%s %s gets its client reaction', (status, code, expected) => {
    expect(classifyError({ statusCode: Number(status), code })).toEqual(expected);
  });

  it('a status-less error is offline', () => {
    expect(classifyError(new Error('fetch failed'))).toEqual({ kind: 'offline' });
  });

  it('backoff carries Retry-After in ms', () => {
    expect(classifyError({ statusCode: 503, code: 'inventory-incomplete', retryAfterMs: 7000 }))
      .toEqual({ kind: 'backoff', retryAfterMs: 7000 });
    expect(classifyError({ statusCode: 409, code: 'storage-changing', retryAfterMs: 3000 }))
      .toEqual({ kind: 'backoff', retryAfterMs: 3000 });
    expect(classifyError({ statusCode: 423, code: 'lifecycle', retryAfterMs: 15000 }))
      .toEqual({ kind: 'backoff', retryAfterMs: 15000 });
  });

  it('409 managed is skip', () => {
    expect(classifyError({ statusCode: 409, code: 'managed' }))
      .toEqual({ kind: 'skip', reason: 'managed' });
  });

  it('429 is backoff', () => {
    expect(classifyError({ statusCode: 429 })).toEqual({ kind: 'backoff', retryAfterMs: null });
    expect(classifyError({ statusCode: 429, retryAfterMs: 30000 }))
      .toEqual({ kind: 'backoff', retryAfterMs: 30000 });
  });

  it('any 5xx is a backoff', () => {
    expect(classifyError({ statusCode: 500 })).toEqual({ kind: 'backoff', retryAfterMs: null });
    expect(classifyError({ statusCode: 502 })).toEqual({ kind: 'backoff', retryAfterMs: null });
  });

  it('412 keeps the server etag for the conflict', () => {
    expect(classifyError({ statusCode: 412, code: 'conflict', etag: '3f9a0c1d2b4e5f60' }))
      .toEqual({ kind: 'conflict', conflictKind: 'rejected', etag: '3f9a0c1d2b4e5f60' });
  });

  it('an unmapped status is fatal with the http status as its reason', () => {
    expect(classifyError({ statusCode: 418 })).toEqual({ kind: 'fatal', reason: 'http-418' });
    expect(classifyError({ statusCode: 400, code: 'bad-request' }))
      .toEqual({ kind: 'fatal', reason: 'bad-request' });
  });
});

describe('apiFetch keeps the server code', () => {
  const conn = { serverUrl: 'http://test', syncBase: '/_/sync', apiKey: 'k', protocol: 2, accountId: 7 };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function jsonResponse({ status, body, headers = {} }) {
    return {
      ok: false,
      status,
      clone: () => ({ json: async () => body }),
      text: async () => '',
      headers: { get: (name) => headers[name] ?? null },
    };
  }

  async function fetchError(response) {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => response);
    let caught = null;
    try {
      await apiClient.listNodes(conn);
    } catch (error) {
      caught = error;
    } finally {
      global.fetch = originalFetch;
    }
    return caught;
  }

  it('409 storage-changing keeps code, status and Retry-After in ms', async () => {
    const error = await fetchError(jsonResponse({
      status: 409,
      body: { msg: 'Storage is changing', msgType: 'error', code: 'storage-changing' },
      headers: { 'retry-after': '7' },
    }));

    expect(error).not.toBeNull();
    expect(error.code).toBe('storage-changing');
    expect(error.statusCode).toBe(409);
    expect(error.retryAfterMs).toBe(7000);
    expect(error.message).toBe('List nodes failed: Storage is changing');
  });

  it('412 keeps the body etag', async () => {
    const error = await fetchError(jsonResponse({
      status: 412,
      body: { msg: 'Precondition failed', msgType: 'error', code: 'conflict', etag: '3f9a0c1d2b4e5f60', details: { nodeId: 901 } },
    }));

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(412);
    expect(error.code).toBe('conflict');
    expect(error.etag).toBe('3f9a0c1d2b4e5f60');
    expect(error.details).toEqual({ nodeId: 901 });
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('a non-JSON refusal keeps the text message and invents no code', async () => {
    const error = await fetchError({
      ok: false,
      status: 500,
      clone: () => ({ json: async () => { throw new Error('not json'); } }),
      text: async () => 'boom',
      headers: { get: () => null },
    });

    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('List nodes failed: boom');
    expect(error.code).toBeUndefined();
    expect(error.etag).toBeUndefined();
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('classifies the thrown error by its machine fields', async () => {
    const error = await fetchError(jsonResponse({
      status: 409,
      body: { msg: 'Storage is changing', msgType: 'error', code: 'storage-changing' },
      headers: { 'retry-after': '7' },
    }));

    expect(classifyError(error)).toEqual({ kind: 'backoff', retryAfterMs: 7000 });
  });
});
