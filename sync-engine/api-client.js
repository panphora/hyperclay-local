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
 * @param {string} filename - Full path WITHOUT .html extension (may include folders)
 */
async function downloadFromServer(serverUrl, apiKey, filename) {
  // NO encoding - send raw path with slashes
  const response = await fetch(`${serverUrl}/sync/download/${filename}`, {
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.statusText}`);
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
 */
async function uploadToServer(serverUrl, apiKey, filename, content, modifiedAt) {
  const response = await fetch(`${serverUrl}/sync/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      filename: filename, // Full path WITHOUT .html
      content,
      modifiedAt: modifiedAt.toISOString()
    })
  });

  if (!response.ok) {
    let errorMessage = `Server returned ${response.status}`;
    let errorDetails = null;

    try {
      // Clone response so we can try multiple parsing strategies
      const errorData = await response.clone().json();
      errorMessage = errorData.message || errorData.error || errorMessage;
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