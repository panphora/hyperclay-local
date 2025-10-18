/**
 * API client for server communication
 */

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
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`[API] Fetched ${data.files?.length || 0} files from server`);
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
      throw new Error(`Server returned ${response.status}: ${errorText}`);
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

module.exports = {
  fetchServerFiles,
  downloadFromServer,
  uploadToServer,
  getServerStatus
};