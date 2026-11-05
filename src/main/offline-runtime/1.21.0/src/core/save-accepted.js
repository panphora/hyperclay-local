// The hook every accepted save reports to, in a module of its own so a reader can
// listen for accepted bytes without loading the save code.
const saveAcceptedHooks = [];

/**
 * Run a callback with the bytes the host just accepted.
 *
 * Called once per accepted save, after the response, with the exact body that was
 * sent. Never called for a refused, failed or skipped save, and never in test mode,
 * where nothing reached a host.
 *
 * @param {Function} callback - Receives the accepted HTML string
 */
export function onSaveAccepted(callback) {
  saveAcceptedHooks.push(callback);
}

export function notifySaveAccepted(html, captureId, artifact = null) {
  for (const hook of saveAcceptedHooks) {
    try {
      // The artifact is the capture's own private model of these bytes, and it is
      // offered only when it exists: a raw save and a capture without one keep the
      // shape they had.
      const accepted = artifact
        ? { captureId: captureId ?? null, artifact }
        : { captureId: captureId ?? null };
      hook(html, accepted);
    } catch (err) {
      console.error('clayjs: onSaveAccepted hook failed:', err);
    }
  }
}

