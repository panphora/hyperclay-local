// ed25519 public keys (base64 of the raw 32 bytes) whose signatures a Linux AppImage
// update must carry. `node build-scripts/update-signing.js keygen` makes a pair: the
// public half goes here, the seed only into 1Password and the HLOCAL_UPDATE_SEED secret.
// Keep the old key listed beside a new one for a release or two when rotating.
// While this is empty, AppImages never update in place and keep the download link.
module.exports = { UPDATE_PUBLIC_KEYS: [] };
