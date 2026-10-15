const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const SIGNATURE_DOMAIN = 'hyperclay-local-appimage-update';

// Waits for the old process to be gone, so the single-instance lock is free, then starts
// the AppImage at its usual path. It runs from bash, not from the AppImage mount, which
// disappears when the old process exits, and it closes every fd it inherited so the old
// mount's keepalive pipe does not outlive the old process.
const RESTART_SCRIPT = `
alive() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) || return 1; case $s in Z*|'') return 1;; esac; return 0; }
if [ -d "/proc/$$/fd" ]; then
  for fd in /proc/$$/fd/*; do fd=\${fd##*/}; [ "$fd" -gt 2 ] && eval "exec $fd>&-"; done
fi
while alive "$1"; do sleep 0.2; done
exec "$2"
`;

function signedMessage(fileName, sha512) {
  return Buffer.from(`${SIGNATURE_DOMAIN}\n${fileName}\n${sha512}\n`, 'utf8');
}

function publicKeyFromBase64(raw) {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'base64').toString('base64url') },
    format: 'jwk'
  });
}

function verifyAppImageSignature({ fileName, sha512, signature, publicKeys }) {
  const sig = Buffer.from(String(signature || '').trim(), 'base64');
  if (sig.length !== 64) return false;
  const message = signedMessage(fileName, sha512);
  return publicKeys.some((key) => {
    try {
      return crypto.verify(null, message, publicKeyFromBase64(key), sig);
    } catch {
      return false;
    }
  });
}

function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

function stagedPathFor(appImage) {
  return path.join(path.dirname(appImage), `.${path.basename(appImage)}.new`);
}

// Copies the download next to the running AppImage (same filesystem, so the later rename
// is atomic), then checks the copy itself: the feed's sha512 and our ed25519 signature.
async function stageAppImage({ appImage, downloadedFile, info, feedUrl, fetchText, publicKeys }) {
  const fileName = path.basename(downloadedFile);
  const expectedName = new RegExp(`^HyperclayLocal-${String(info.version).replace(/\./g, '\\.')}(-arm64)?\\.AppImage$`);
  if (!expectedName.test(fileName)) throw new Error(`Unexpected update file ${fileName} for v${info.version}`);
  const entry = (info.files || [])
    .map((file) => ({ sha512: file.sha512, url: new URL(file.url, `${feedUrl}/`) }))
    .find((file) => path.posix.basename(file.url.pathname) === fileName);
  if (!entry) throw new Error(`The update feed does not list ${fileName}`);

  const staged = stagedPathFor(appImage);
  try {
    await fs.promises.copyFile(downloadedFile, staged);
    const handle = await fs.promises.open(staged, 'r+');
    try {
      await handle.chmod(0o755);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const sha512 = await sha512File(staged);
    if (sha512 !== entry.sha512) throw new Error(`${fileName} does not match the sha512 in the update feed`);
    const signature = await fetchText(`${entry.url.href}.sig`);
    if (!verifyAppImageSignature({ fileName, sha512, signature, publicKeys })) {
      throw new Error(`${fileName} does not carry a valid Hyperclay Local signature`);
    }
    return staged;
  } catch (error) {
    await fs.promises.rm(staged, { force: true });
    throw error;
  }
}

// Keeps the running image as <name>.prev (a hard link, so no copy when it can), then
// renames the staged image over the user's filename, so desktop entries keep working.
function commitAppImage({ appImage, staged }) {
  if (!staged) throw new Error('No staged AppImage to install');
  const previous = `${appImage}.prev`;
  fs.rmSync(previous, { force: true });
  try {
    fs.linkSync(appImage, previous);
  } catch {
    fs.copyFileSync(appImage, previous);
  }
  fs.renameSync(staged, appImage);
  const dir = fs.openSync(path.dirname(appImage), 'r');
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
  return previous;
}

function restartEnv(env) {
  const clean = { ...env };
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete clean[name];
  return clean;
}

function restartAppImage({ appImage, pid, spawn = childProcess.spawn, env = process.env }) {
  const child = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', String(pid), appImage], {
    detached: true,
    stdio: 'ignore',
    cwd: os.homedir(),
    env: restartEnv(env)
  });
  child.unref();
}

module.exports = {
  RESTART_SCRIPT,
  signedMessage,
  verifyAppImageSignature,
  sha512File,
  stagedPathFor,
  stageAppImage,
  commitAppImage,
  restartAppImage
};
