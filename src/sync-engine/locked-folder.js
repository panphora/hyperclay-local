// The root's top-level `uploads/` holds every document's attachments, and documents link them as
// `/_/uploads/...`. Deleting, renaming or moving it would break every attachment on every device,
// so the engine never sends any of those for it, and puts the folder back instead.
const LOCKED_FOLDER = 'uploads';

function isLockedFolder(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') === LOCKED_FOLDER;
}

function lockedFolderError() {
  const error = new Error('The uploads folder holds every attachment; it is never deleted, renamed or moved.');
  error.code = 'locked-folder';
  return error;
}

module.exports = { LOCKED_FOLDER, isLockedFolder, lockedFolderError };
