/**
 * API client for server communication.
 *
 * All functions except getServerStatus mirror the unified /sync/nodes endpoints
 * from hyperclay/ Step 2. Each function is stateless — pass the connection
 * object on every call: { serverUrl, syncBase, apiKey, accountId, protocol }.
 */

/**
 * Build a request URL from the connection. The sync base is validated so a
 * malformed or off-origin base can never escape to another host.
 */
function syncUrl(conn, suffix) {
  const base = conn.syncBase || '/_/sync';
  if (!/^\/_\/[a-z0-9/_-]*sync$/i.test(base) || base.includes('//') || base.includes('..')) {
    throw new Error(`Refusing sync base ${base}`);
  }
  return `${conn.serverUrl}${base}${suffix}`;
}

/**
 * Auth headers for the connection. Protocol 1 carries only the API key;
 * protocol 2 adds the sync protocol marker and, when known, the account id.
 */
function authHeaders(conn, extra = {}) {
  const headers = { 'X-API-Key': conn.apiKey, ...extra };
  if (conn.protocol === 2) {
    headers['X-Sync-Protocol'] = '2';
    if (conn.accountId != null) headers['X-Sync-Account-ID'] = String(conn.accountId);
  }
  return headers;
}

/**
 * Parse error message from server response. Server may return JSON with
 * msg/message/error field, or plain text.
 */
function parseErrorMessage(errorText, fallback) {
  try {
    const data = JSON.parse(errorText);
    return data.msg || data.message || data.error || fallback;
  } catch {
    return errorText || fallback;
  }
}

/**
 * Standard fetch wrapper: throws on non-2xx with a parsed error message,
 * attaches statusCode + details to the thrown Error.
 */
async function apiFetch(url, init, { errorPrefix } = {}) {
  const response = await fetch(url, init);

  if (!response.ok) {
    let errorMessage = `Server returned ${response.status}`;
    let errorDetails = null;
    let errorBody = null;

    try {
      errorBody = await response.clone().json();
      errorMessage = errorBody.msg || errorBody.message || errorBody.error || errorMessage;
      errorDetails = errorBody.details;
    } catch {
      try {
        const errorText = await response.text();
        if (errorText) errorMessage = errorText;
      } catch {
        // Use default message
      }
    }

    const prefixedMessage = errorPrefix ? `${errorPrefix}: ${errorMessage}` : errorMessage;
    console.error(`[API] ${prefixedMessage} (${response.status})`);
    const error = new Error(prefixedMessage);
    error.statusCode = response.status;
    if (errorDetails) error.details = errorDetails;
    if (errorBody?.code) error.code = errorBody.code;
    if (errorBody?.etag) error.etag = errorBody.etag;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) error.retryAfterMs = Number(retryAfter) * 1000 || null;
    throw error;
  }

  return response.json();
}

/**
 * Content encoding helpers. The unified API carries both strings (sites) and
 * binary (uploads) over the same endpoints.
 *
 * - On send: Buffer → base64 string; string passes through unchanged.
 * - On receive: if the response's nodeType is 'upload', decode base64 to Buffer.
 */
function encodeContent(content) {
  if (Buffer.isBuffer(content)) return content.toString('base64');
  return content;  // string passes through
}

function decodeContent(content, nodeType) {
  if (nodeType === 'upload') return Buffer.from(content, 'base64');
  return content;
}

// ============================================================================
// NODE OPERATIONS (mirror the /sync/nodes/* endpoints)
// ============================================================================

/**
 * List all nodes (sites + uploads + folders) owned by the authenticated user.
 * @param {Object} conn
 * @returns {Promise<Array<{ id, type, name, parentId, path, size?, modifiedAt?, checksum? }>>}
 */
async function listNodes(conn, { signal } = {}) {
  const url = syncUrl(conn, '/nodes');
  console.log(`[API] Listing nodes from: ${url}`);

  const init = { headers: authHeaders(conn) };
  if (signal) init.signal = signal;

  const data = await apiFetch(url, init, { errorPrefix: 'List nodes failed' });

  const nodes = data.nodes || [];
  // `complete: true` (protocol 2) is the server's promise that this list is the
  // whole inventory; only such a list may ever justify a delete. A legacy
  // (protocol 1) response has no such field, so the list is not evidence.
  Object.defineProperty(nodes, 'complete', {
    value: data.complete === true,
    enumerable: false,
    configurable: true
  });
  console.log(`[API] Fetched ${nodes.length} nodes from server`);
  return nodes;
}

/**
 * Account discovery (CONTRACTS §1). Human-scoped and unprefixed: the person's
 * own key, protocol 2 always, so a client that predates discovery sees a 404
 * and reads it as "server update required" rather than guessing.
 *
 * @param {Object} options
 * @param {string} options.serverUrl
 * @param {string} options.apiKey
 * @returns {Promise<{protocol?:number, features?:Object, actor?:Object, accounts?:Array}>}
 */
async function getAccounts({ serverUrl, apiKey }) {
  const url = `${serverUrl}/_/sync/accounts`;
  console.log(`[API] Discovering accounts from: ${url}`);

  try {
    return await apiFetch(url, {
      headers: { 'X-API-Key': apiKey, 'X-Sync-Protocol': '2' }
    }, { errorPrefix: 'Account discovery failed' });
  } catch (error) {
    // An old server has no discovery route: no features are on, so every
    // session pauses with server-update-required instead of syncing blind.
    if (error.statusCode === 404) return { success: false, features: {}, accounts: [] };
    throw error;
  }
}

/**
 * Create a new Node (site, upload, or folder). Optionally writes content in the
 * same request for sites/uploads.
 *
 * @param {Object} conn
 * @param {Object} options
 * @param {'site'|'upload'|'folder'} options.type
 * @param {string} options.name
 * @param {number|string} options.parentId - numeric Node id or 'root' / 0 for root
 * @param {string|Buffer} [options.content] - HTML string for sites, Buffer or base64 for uploads, omitted for folders
 * @param {string|Date} [options.modifiedAt] - file modification time
 * @returns {Promise<{ id, type, name, parentId, path }>}
 */
async function createNode(conn, { type, name, parentId, content, modifiedAt }) {
  const url = syncUrl(conn, '/nodes');
  console.log(`[API] Creating ${type} node: ${name} (parentId=${parentId})`);

  const body = { type, name, parentId };
  if (content !== undefined && content !== null) {
    body.content = encodeContent(content);
  }
  if (modifiedAt) {
    body.modifiedAt = modifiedAt instanceof Date ? modifiedAt.toISOString() : modifiedAt;
  }

  const data = await apiFetch(url, {
    method: 'POST',
    headers: authHeaders(conn, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  }, { errorPrefix: `Create ${type} failed` });

  return data.node;
}

/**
 * Download a Node's content by id.
 * @param {Object} conn
 * @param {number} nodeId
 * @returns {Promise<{ content: string|Buffer, nodeType: string, modifiedAt: string, checksum: string, size: number }>}
 */
async function getNodeContent(conn, nodeId) {
  const url = syncUrl(conn, `/nodes/${nodeId}/content`);
  console.log(`[API] Downloading content for node ${nodeId}`);

  const data = await apiFetch(url, {
    headers: authHeaders(conn)
  }, { errorPrefix: `Download node ${nodeId} failed` });

  return {
    content: decodeContent(data.content, data.nodeType),
    nodeType: data.nodeType,
    modifiedAt: data.modifiedAt,
    checksum: data.checksum,
    etag: data.etag || data.checksum,
    structureVersion: data.structureVersion,
    size: data.size
  };
}

/**
 * Write/replace a Node's content by id.
 * @param {Object} conn
 * @param {number} nodeId
 * @param {string|Buffer} content - HTML string for sites, Buffer or base64 for uploads
 * @param {Object} [options]
 * @param {string|Date} [options.modifiedAt]
 * @param {string} [options.snapshotHtml] - for platform live-sync (sites only)
 * @param {string} [options.senderId] - for platform live-sync attribution
 * @param {string} [options.ifMatch] - protocol 2 precondition: the etag the local
 *   bytes were last known to match. Sent as the `If-Match` header.
 * @returns {Promise<{ nodeId: number, checksum: string, size?: number }>}
 */
async function putNodeContent(conn, nodeId, content, options = {}) {
  const url = syncUrl(conn, `/nodes/${nodeId}/content`);
  console.log(`[API] Writing content for node ${nodeId}`);

  const body = { content: encodeContent(content) };
  if (options.modifiedAt) {
    body.modifiedAt = options.modifiedAt instanceof Date
      ? options.modifiedAt.toISOString()
      : options.modifiedAt;
  }
  if (options.snapshotHtml) body.snapshotHtml = options.snapshotHtml;
  if (options.senderId) body.senderId = options.senderId;
  if (options.userDriven !== undefined) body.userDriven = options.userDriven;

  const headers = authHeaders(conn, { 'Content-Type': 'application/json' });
  if (options.ifMatch) headers['If-Match'] = `"${options.ifMatch}"`;

  return apiFetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body)
  }, { errorPrefix: `Write node ${nodeId} failed` });
}

/**
 * Rename a Node.
 * @param {Object} conn
 * @param {number} nodeId
 * @param {string} newName
 * @param {{ expectedVersion?: string }} [options] - protocol 2 precondition: the
 *   node's structureVersion. Stale is 409 node-changed with nothing mutated.
 * @returns {Promise<{ nodeId: number, oldName: string, newName: string }>}
 */
async function renameNode(conn, nodeId, newName, { expectedVersion } = {}) {
  const url = syncUrl(conn, `/nodes/${nodeId}/rename`);
  console.log(`[API] Renaming node ${nodeId} → ${newName}`);

  return apiFetch(url, {
    method: 'PATCH',
    headers: authHeaders(conn, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(expectedVersion ? { newName, expectedVersion } : { newName })
  }, { errorPrefix: `Rename node ${nodeId} failed` });
}

/**
 * Move a Node to a new parent folder. Optionally rename it in the same call so
 * the server treats the whole thing as a single atomic operation — this is how
 * the watcher handles local `mv foo/a.html bar/b.html` without hitting
 * intermediate-state 409s.
 *
 * @param {Object} conn
 * @param {number} nodeId
 * @param {number|string} targetParentId - numeric Node id, or 0 / 'root' for root
 * @param {string|null} [newName] - Optional new basename. If provided, rename happens atomically with the move.
 * @param {{ expectedVersion?: string }} [options] - protocol 2 precondition: the
 *   node's structureVersion. Stale is 409 node-changed with nothing mutated.
 * @returns {Promise<{ nodeId: number, fromPath: string, toPath: string, oldName: string, newName: string }>}
 */
async function moveNode(conn, nodeId, targetParentId, newName = null, { expectedVersion } = {}) {
  const url = syncUrl(conn, `/nodes/${nodeId}/move`);
  if (newName) {
    console.log(`[API] Moving node ${nodeId} → parent ${targetParentId} (rename → ${newName})`);
  } else {
    console.log(`[API] Moving node ${nodeId} → parent ${targetParentId}`);
  }

  const body = { targetParentId };
  if (newName) body.newName = newName;
  if (expectedVersion) body.expectedVersion = expectedVersion;

  return apiFetch(url, {
    method: 'PATCH',
    headers: authHeaders(conn, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  }, { errorPrefix: `Move node ${nodeId} failed` });
}

/**
 * Delete a Node.
 * @param {Object} conn
 * @param {number} nodeId
 * @param {{ cascade?: boolean, expectedVersion?: string }} [options] - cascade=true
 *   deletes folder + all descendants; expectedVersion is the protocol 2
 *   precondition for a team delete (stale is 409 node-changed, nothing mutates).
 * @returns {Promise<{ nodeId: number, type: string }>}
 */
async function deleteNode(conn, nodeId, { cascade = false, expectedVersion } = {}) {
  const params = [];
  if (cascade) params.push('cascade=true');
  if (expectedVersion) params.push(`expectedVersion=${encodeURIComponent(expectedVersion)}`);
  const url = syncUrl(conn, `/nodes/${nodeId}${params.length ? `?${params.join('&')}` : ''}`);
  console.log(`[API] Deleting node ${nodeId}${cascade ? ' (cascade)' : ''}`);

  return apiFetch(url, {
    method: 'DELETE',
    headers: authHeaders(conn)
  }, { errorPrefix: `Delete node ${nodeId} failed` });
}

// ============================================================================
// STATUS (unchanged from the old API)
// ============================================================================

/**
 * Get server status and time (for clock calibration).
 */
async function getServerStatus(conn) {
  const url = syncUrl(conn, '/status');
  console.log(`[API] Getting server status from: ${url}`);

  const data = await apiFetch(url, {
    headers: authHeaders(conn)
  }, { errorPrefix: 'Get status failed' });

  console.log(`[API] Server time: ${data.serverTime}`);
  return data;
}

/**
 * Best-effort control-lane poster. Unlike apiFetch it NEVER throws: 200 is
 * delivered:true, and 400/404/409/500/network/abort are delivered:false with no
 * throw (a no-match remote resolution is expected success, not an error). Bound
 * by a 4s AbortController so a slow POST never hangs the caller's resolve path.
 */
async function postControlMessage(conn, envelope) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(syncUrl(conn, '/control'), {
      method: 'POST',
      headers: authHeaders(conn, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(envelope),
      signal: ctrl.signal,
    });
    return { delivered: r.ok };
  } catch {
    return { delivered: false };
  } finally {
    clearTimeout(t); // always clear — fetch reject / abort / stringify throw too
  }
}

module.exports = {
  syncUrl,
  authHeaders,
  listNodes,
  getAccounts,
  createNode,
  getNodeContent,
  putNodeContent,
  renameNode,
  moveNode,
  deleteNode,
  getServerStatus,
  postControlMessage
};
