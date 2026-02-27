/**
 * API client for server communication
 */

/**
 * Parse error message from server response
 * Server may return JSON with msg, message, or error field
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
 * Fetch list of files from server
 */
async function fetchServerFiles(serverUrl, apiKey) {
  const url = `${serverUrl}/sync/files`;
  console.log(`[API] Fetching files from: ${url}`);
  console.log(`[API] Using API key: ${apiKey.substring(0, 12)}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    console.log(`[API] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[API] Error response: ${errorText}`);
      throw new Error(parseErrorMessage(errorText, `Server returned ${response.status}`));
    }

    const data = await response.json();
    console.log(`[API] Fetched ${data.files?.length || 0} files from server`);

    // Log each file for debugging
    if (data.files && data.files.length > 0) {
      console.log(`[API] Server files:`);
      data.files.forEach(file => {
        console.log(`[API]   - ${file.filename} (path: ${file.path}, checksum: ${file.checksum})`);
      });
    }

    return data.files || [];
  } catch (error) {
    console.error(`[API] Fetch failed:`, error);
    console.error(`[API] Error type: ${error.name}`);
    console.error(`[API] Error message: ${error.message}`);
    console.error(`[API] Full error:`, error);
    throw error;
  }
}

/**
 * Download file content from server
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filename - Full path WITHOUT .html extension (may include folders)
 */
async function downloadFromServer(serverUrl, apiKey, filename) {
  // NO encoding - send raw path with slashes
  const downloadUrl = `${serverUrl}/sync/download/${filename}`;
  console.log(`[API] Downloading from: ${downloadUrl}`);

  const response = await fetch(downloadUrl, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error(`[API] Download failed (${response.status}): ${errorText}`);
    throw new Error(`Failed to download ${filename}: ${errorText}`);
  }

  const data = await response.json();

  return {
    content: data.content,
    modifiedAt: data.modifiedAt,
    checksum: data.checksum
  };
}

/**
 * Upload file content to server
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filename - Full path WITHOUT .html extension (may include folders)
 * @param {string} content - File content
 * @param {Date} modifiedAt - Modification time
 * @param {Object} options - Additional options
 * @param {string} options.snapshotHtml - Full HTML for platform live sync (optional)
 * @param {string} options.senderId - Sender ID for live sync attribution (optional)
 */
async function uploadToServer(serverUrl, apiKey, filename, content, modifiedAt, options = {}) {
  const { snapshotHtml, senderId } = options;

  const payload = {
    filename: filename, // Full path WITHOUT .html
    content,
    modifiedAt: modifiedAt.toISOString()
  };

  // Include snapshot for platform live sync (if available)
  if (snapshotHtml) {
    payload.snapshotHtml = snapshotHtml;
    payload.senderId = senderId || 'hyperclay-local';
  }

  const response = await fetch(`${serverUrl}/sync/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorMessage = `Server returned ${response.status}`;
    let errorDetails = null;

    try {
      // Clone response so we can try multiple parsing strategies
      const errorData = await response.clone().json();
      errorMessage = errorData.msg || errorData.message || errorData.error || errorMessage;
      errorDetails = errorData.details;

      // Log the parsed error for debugging
      console.error(`[API] Upload error (${response.status}):`, errorMessage);
      if (errorDetails) {
        console.error(`[API] Error details:`, errorDetails);
      }
    } catch (parseError) {
      // If JSON parsing fails, try to get text
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = errorText;
          console.error(`[API] Upload error (${response.status}):`, errorText);
        }
      } catch (textError) {
        // Use default error message
        console.error(`[API] Upload error (${response.status}): Unable to parse response`);
      }
    }

    const error = new Error(errorMessage);
    error.statusCode = response.status;
    if (errorDetails) {
      error.details = errorDetails;
    }
    throw error;
  }

  return response.json();
}

/**
 * Get server status and time (for clock calibration)
 */
async function getServerStatus(serverUrl, apiKey) {
  const url = `${serverUrl}/sync/status`;
  console.log(`[API] Getting server status from: ${url}`);
  console.log(`[API] Using API key: ${apiKey.substring(0, 12)}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    console.log(`[API] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[API] Error response: ${errorText}`);
      throw new Error(parseErrorMessage(errorText, `Server returned ${response.status}`));
    }

    const data = await response.json();
    console.log(`[API] Server time: ${data.serverTime}`);
    return data;
  } catch (error) {
    console.error(`[API] Fetch failed:`, error);
    console.error(`[API] Error type: ${error.name}`);
    console.error(`[API] Error message: ${error.message}`);
    console.error(`[API] Full error:`, error);
    throw error;
  }
}

// =============================================================================
// UPLOAD SYNC API FUNCTIONS
// =============================================================================

/**
 * Fetch list of uploads from server
 */
async function fetchServerUploads(serverUrl, apiKey) {
  const url = `${serverUrl}/sync/uploads`;
  console.log(`[API] Fetching uploads from: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[API] Error response: ${errorText}`);
      throw new Error(parseErrorMessage(errorText, `Server returned ${response.status}`));
    }

    const data = await response.json();
    console.log(`[API] Fetched ${data.uploads?.length || 0} uploads from server`);

    return data.uploads || [];
  } catch (error) {
    console.error(`[API] Fetch uploads failed:`, error);
    throw error;
  }
}

/**
 * Encode path segments for URL (preserves slashes, encodes each segment)
 */
function encodePathSegments(filePath) {
  return filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Download upload content from server
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filePath - Full path including filename
 * @returns {Promise<{content: Buffer, modifiedAt: string, checksum: string}>}
 */
async function downloadUpload(serverUrl, apiKey, filePath) {
  const encodedPath = encodePathSegments(filePath);
  const downloadUrl = `${serverUrl}/sync/uploads/${encodedPath}`;
  console.log(`[API] Downloading upload from: ${downloadUrl}`);

  const response = await fetch(downloadUrl, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error(`[API] Download upload failed (${response.status}): ${errorText}`);
    throw new Error(`Failed to download upload ${filePath}: ${errorText}`);
  }

  const data = await response.json();

  // Decode base64 content to Buffer
  return {
    content: Buffer.from(data.content, 'base64'),
    modifiedAt: data.modifiedAt,
    checksum: data.checksum
  };
}

/**
 * Upload file content to server (for uploads, not sites)
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filePath - Full path including filename
 * @param {Buffer} content - File content as Buffer
 * @param {Date} modifiedAt - Modification time
 */
async function uploadUploadToServer(serverUrl, apiKey, filePath, content, modifiedAt) {
  console.log(`[API] Uploading upload to server: ${filePath}`);

  const response = await fetch(`${serverUrl}/sync/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      path: filePath,
      content: content.toString('base64'),
      modifiedAt: modifiedAt.toISOString()
    })
  });

  if (!response.ok) {
    let errorMessage = `Server returned ${response.status}`;

    try {
      const errorData = await response.clone().json();
      errorMessage = errorData.msg || errorData.message || errorData.error || errorMessage;
      console.error(`[API] Upload error (${response.status}):`, errorMessage);
    } catch (parseError) {
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = errorText;
          console.error(`[API] Upload error (${response.status}):`, errorText);
        }
      } catch (textError) {
        console.error(`[API] Upload error (${response.status}): Unable to parse response`);
      }
    }

    const error = new Error(errorMessage);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

async function deleteFileOnServer(serverUrl, apiKey, nodeId) {
  const res = await fetch(`${serverUrl}/sync/file`, {
    method: 'DELETE',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId })
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Delete failed (${res.status}): ${parseErrorMessage(errorText, res.statusText)}`);
  }
  return res.json();
}

async function renameFileOnServer(serverUrl, apiKey, nodeId, newName) {
  const res = await fetch(`${serverUrl}/sync/file/rename`, {
    method: 'PATCH',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, newName })
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Rename failed (${res.status}): ${parseErrorMessage(errorText, res.statusText)}`);
  }
  return res.json();
}

async function moveFileOnServer(serverUrl, apiKey, nodeId, targetFolderPath) {
  const res = await fetch(`${serverUrl}/sync/file/move`, {
    method: 'PATCH',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId, targetFolderPath })
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Move failed (${res.status}): ${parseErrorMessage(errorText, res.statusText)}`);
  }
  return res.json();
}

module.exports = {
  fetchServerFiles,
  downloadFromServer,
  uploadToServer,
  getServerStatus,
  deleteFileOnServer,
  renameFileOnServer,
  moveFileOnServer,
  // Upload sync
  fetchServerUploads,
  downloadUpload,
  uploadUploadToServer
};