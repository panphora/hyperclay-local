const PAUSE_BY_CODE = {
  'invalid-key': 'key-revoked',
  'payment-required': 'plan-lapsed',
  'viewer': 'viewer',
};

function classifyError(error) {
  if (error && error.code === 'folder-missing') return { kind: 'pause', reason: 'folder-missing' };
  const status = error.statusCode;
  const code = error.code;
  if (!status) return { kind: 'offline' };
  if (status === 401) return { kind: 'pause-all', reason: 'key-revoked' };
  if (PAUSE_BY_CODE[code]) return { kind: 'pause', reason: PAUSE_BY_CODE[code] };
  if (status === 403 || status === 404 && code === 'not-found') return { kind: 'rediscover', reason: code || 'forbidden' };
  if (status === 409 && code === 'account-changed') return { kind: 'rediscover', reason: 'account-changed' };
  if (status === 409 && code === 'node-changed') return { kind: 'refresh-node' };
  if (status === 409 && code === 'managed') return { kind: 'skip', reason: 'managed' };
  if (status === 409 && code === 'name-conflict') return { kind: 'conflict', conflictKind: 'name-taken' };
  if (status === 409 && code === 'storage-changing') return { kind: 'backoff', retryAfterMs: error.retryAfterMs || null };
  if (status === 412) return { kind: 'conflict', conflictKind: 'rejected', etag: error.etag || null };
  if (status === 413 && code === 'quota-exceeded') return { kind: 'uploads-blocked', reason: 'quota-exceeded' };
  if (status === 413) return { kind: 'skip', reason: 'too-large' };
  if (status === 404 && code === 'node-not-found') return { kind: 'refresh-node' };
  if (status === 429) return { kind: 'backoff', retryAfterMs: error.retryAfterMs || null };
  if (status === 423 || status === 503 || status >= 500) {
    return { kind: 'backoff', retryAfterMs: error.retryAfterMs || null };
  }
  if (status === 428) return { kind: 'fatal', reason: code || 'precondition-required' };
  return { kind: 'fatal', reason: code || `http-${status}` };
}

module.exports = { classifyError };
