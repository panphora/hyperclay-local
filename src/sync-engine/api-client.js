/**
 * API client for server communication.
 *
 * All functions except getServerStatus mirror the unified /sync/nodes endpoints
 * from hyperclay/ Step 2. Each function is stateless — pass serverUrl + apiKey
 * on every call.
 */

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

    try {
      const errorData = await response.clone().json();
      errorMessage = errorData.msg || errorData.message || errorData.error || errorMessage;
      errorDetails = errorData.details;
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
 * @param {string} serverUrl
 * @param {string} apiKey
 * @returns {Promise<Array<{ id, type, name, parentId, path, size?, modifiedAt?, checksum? }>>}
 */
async function listNodes(serverUrl, apiKey) {
  const url = `${serverUrl}/sync/nodes`;
  console.log(`[API] Listing nodes from: ${url}`);

  const data = await apiFetch(url, {
    headers: { 'X-API-Key': apiKey }
  }, { errorPrefix: 'List nodes failed' });

  const nodes = data.nodes || [];
  console.log(`[API] Fetched ${nodes.length} nodes from server`);
  return nodes;
}

/**
 * Create a new Node (site, upload, or folder). Optionally writes content in the
 * same request for sites/uploads.
 *
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {Object} options
 * @param {'site'|'upload'|'folder'} options.type
 * @param {string} options.name
 * @param {number|string} options.parentId - numeric Node id or 'root' / 0 for root
 * @param {string|Buffer} [options.content] - HTML string for sites, Buffer or base64 for uploads, omitted for folders
 * @param {string|Date} [options.modifiedAt] - file modification time
 * @returns {Promise<{ id, type, name, parentId, path }>}
 */
async function createNode(serverUrl, apiKey, { type, name, parentId, content, modifiedAt }) {
  const url = `${serverUrl}/sync/nodes`;
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
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(body)
  }, { errorPrefix: `Create ${type} failed` });

  return data.node;
}

/**
 * Download a Node's content by id.
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {number} nodeId
 * @returns {Promise<{ content: string|Buffer, nodeType: string, modifiedAt: string, checksum: string, size: number }>}
 */
async function getNodeContent(serverUrl, apiKey, nodeId) {
  const url = `${serverUrl}/sync/nodes/${nodeId}/content`;
  console.log(`[API] Downloading content for node ${nodeId}`);

  const data = await apiFetch(url, {
    headers: { 'X-API-Key': apiKey }
  }, { errorPrefix: `Download node ${nodeId} failed` });

  return {
    content: decodeContent(data.content, data.nodeType),
    nodeType: data.nodeType,
    modifiedAt: data.modifiedAt,
    checksum: data.checksum,
    size: data.size
  };
}

/**
 * Write/replace a Node's content by id.
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {number} nodeId
 * @param {string|Buffer} content - HTML string for sites, Buffer or base64 for uploads
 * @param {Object} [options]
 * @param {string|Date} [options.modifiedAt]
 * @param {string} [options.snapshotHtml] - for platform live-sync (sites only)
 * @param {string} [options.senderId] - for platform live-sync attribution
 * @returns {Promise<{ nodeId: number, checksum: string, size?: number }>}
 */
async function putNodeContent(serverUrl, apiKey, nodeId, content, options = {}) {
  const url = `${serverUrl}/sync/nodes/${nodeId}/content`;
  console.log(`[API] Writing content for node ${nodeId}`);

  const body = { content: encodeContent(content) };
  if (options.modifiedAt) {
    body.modifiedAt = options.modifiedAt instanceof Date
      ? options.modifiedAt.toISOString()
      : options.modifiedAt;
  }
  if (options.snapshotHtml) body.snapshotHtml = options.snapshotHtml;
  if (options.senderId) body.senderId = options.senderId;

  return apiFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(body)
  }, { errorPrefix: `Write node ${nodeId} failed` });
}

/**
 * Rename a Node.
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {number} nodeId
 * @param {string} newName
 * @returns {Promise<{ nodeId: number, oldName: string, newName: string }>}
 */
async function renameNode(serverUrl, apiKey, nodeId, newName) {
  const url = `${serverUrl}/sync/nodes/${nodeId}/rename`;
  console.log(`[API] Renaming node ${nodeId} → ${newName}`);

  return apiFetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ newName })
  }, { errorPrefix: `Rename node ${nodeId} failed` });
}

/**
 * Move a Node to a new parent folder.
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {number} nodeId
 * @param {number|string} targetParentId - numeric Node id, or 0 / 'root' for root
 * @returns {Promise<{ nodeId: number, fromPath: string, toPath: string }>}
 */
async function moveNode(serverUrl, apiKey, nodeId, targetParentId) {
  const url = `${serverUrl}/sync/nodes/${nodeId}/move`;
  console.log(`[API] Moving node ${nodeId} → parent ${targetParentId}`);

  return apiFetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ targetParentId })
  }, { errorPrefix: `Move node ${nodeId} failed` });
}

/**
 * Delete a Node.
 * @param {string} serverUrl
 * @param {string} apiKey
 * @param {number} nodeId
 * @returns {Promise<{ nodeId: number, type: string }>}
 */
async function deleteNode(serverUrl, apiKey, nodeId) {
  const url = `${serverUrl}/sync/nodes/${nodeId}`;
  console.log(`[API] Deleting node ${nodeId}`);

  return apiFetch(url, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey }
  }, { errorPrefix: `Delete node ${nodeId} failed` });
}

// ============================================================================
// STATUS (unchanged from the old API)
// ============================================================================

/**
 * Get server status and time (for clock calibration).
 */
async function getServerStatus(serverUrl, apiKey) {
  const url = `${serverUrl}/sync/status`;
  console.log(`[API] Getting server status from: ${url}`);

  const data = await apiFetch(url, {
    headers: { 'X-API-Key': apiKey }
  }, { errorPrefix: 'Get status failed' });

  console.log(`[API] Server time: ${data.serverTime}`);
  return data;
}

module.exports = {
  listNodes,
  createNode,
  getNodeContent,
  putNodeContent,
  renameNode,
  moveNode,
  deleteNode,
  getServerStatus
};
