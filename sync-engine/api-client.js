/**
 * API client for server communication
 */

/**
 * Fetch list of files from server
 */
async function fetchServerFiles(serverUrl, apiKey) {
  const response = await fetch(`${serverUrl}/sync/files`, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const data = await response.json();
  return data.files || [];
}

/**
 * Download file content from server
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filename - Filename WITHOUT .html extension
 */
async function downloadFromServer(serverUrl, apiKey, filename) {
  // Server expects filename WITHOUT .html
  const nameWithoutExt = filename.replace('.html', '');

  const response = await fetch(`${serverUrl}/sync/download/${nameWithoutExt}`, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.content,
    modifiedAt: data.modifiedAt
  };
}

/**
 * Upload file content to server
 * @param {string} serverUrl - Server base URL
 * @param {string} apiKey - API key for authentication
 * @param {string} filename - Filename WITH .html extension (will be stripped for API)
 * @param {string} content - File content
 * @param {Date} modifiedAt - Modification time
 */
async function uploadToServer(serverUrl, apiKey, filename, content, modifiedAt) {
  // Strip .html extension for server API
  const nameWithoutExt = filename.replace('.html', '');

  const response = await fetch(`${serverUrl}/sync/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      filename: nameWithoutExt, // Send WITHOUT .html
      content,
      modifiedAt: modifiedAt.toISOString()
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      message: `Server error ${response.status}`
    }));

    // Check for detailed error structure (name conflicts, etc)
    if (errorData.details) {
      const error = new Error(errorData.error || errorData.message);
      error.details = errorData.details;
      error.statusCode = response.status;
      throw error;
    }

    throw new Error(errorData.message || errorData.error || `Server returned ${response.status}`);
  }

  return response.json();
}

/**
 * Get server status and time (for clock calibration)
 */
async function getServerStatus(serverUrl, apiKey) {
  const response = await fetch(`${serverUrl}/sync/status`, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  return response.json();
}

module.exports = {
  fetchServerFiles,
  downloadFromServer,
  uploadToServer,
  getServerStatus
};