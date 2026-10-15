const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { compareVersions } = require('./updater');

const SIGNATURE_DOMAIN = 'hyperclay-local-appimage-update-v2';
const HEALTH_ENV = 'HCL_UPDATE_HEALTHY';

// Waits for the old process to be gone, so the single-instance lock is free, then starts
// the AppImage at its usual path. It runs from bash, not from the AppImage mount, which
// disappears when the old process exits, and it closes every fd it inherited so the old
// mount's keepalive pipe does not outlive the old process.
//
// After an update it supervises: the new version must create the HCL_UPDATE_HEALTHY file
// within the timeout. If it exits or hangs first, the script stops it, records its version
// as skipped, moves <name>.prev back and starts that. This script ships in version N and
// drives version N+1, so its arguments and the env var name are frozen.
const RESTART_SCRIPT = `
alive() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) || return 1; case $s in Z*|'') return 1;; esac; return 0; }
if [ -d "/proc/$$/fd" ]; then
  for fd in /proc/$$/fd/*; do fd=\${fd##*/}; [ "$fd" -gt 2 ] && eval "exec $fd>&-"; done
fi
pid=$1 image=$2 previous=$3 healthy=$4 skip=$5 version=$6 timeout=$7
while alive "$pid"; do sleep 0.2; done
[ -n "$previous" ] || exec "$image"
rm -f "$healthy"
HCL_UPDATE_HEALTHY="$healthy" "$image" &
child=$!
ticks=0
while [ ! -e "$healthy" ]; do
  if ! alive "$child" || [ "$ticks" -ge $((timeout * 5)) ]; then
    kill "$child" 2>/dev/null
    n=0
    while alive "$child" && [ "$n" -lt 25 ]; do sleep 0.2; n=$((n + 1)); done
    kill -9 "$child" 2>/dev/null
    sleep 1
    printf '%s\\n' "$version" > "$skip"
    mv -f "$previous" "$image" && exec "$image"
    exit 1
  fi
  sleep 0.2
  ticks=$((ticks + 1))
done
rm -f "$healthy"
`;

// The architecture and version are signed with the bytes, so a validly signed image
// for another architecture, or an older signed release, never passes for this one.
function signedMessage({ fileName, version, arch, sha512 }) {
  return Buffer.from(`${SIGNATURE_DOMAIN}\n${version}\n${arch}\n${fileName}\n${sha512}\n`, 'utf8');
}

function appImageArch(fileName) {
  return /-arm64\.AppImage$/.test(fileName) ? 'arm64' : 'x64';
}

function appImageFileName(version, arch) {
  return `HyperclayLocal-${version}${arch === 'arm64' ? '-arm64' : ''}.AppImage`;
}

function publicKeyFromBase64(raw) {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'base64').toString('base64url') },
    format: 'jwk'
  });
}

function verifyAppImageSignature({ fileName, version, arch, sha512, signature, publicKeys }) {
  const sig = Buffer.from(String(signature || '').trim(), 'base64');
  if (sig.length !== 64) return false;
  const message = signedMessage({ fileName, version, arch, sha512 });
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

// The highest version a verified signature has carried. A feed offering less is a
// replay of an older signed release, however much newer than this build it is.
function readSeenVersion(seenFile) {
  try {
    const version = fs.readFileSync(seenFile, 'utf8').trim();
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}

function recordSeenVersion(seenFile, version) {
  const seen = readSeenVersion(seenFile);
  if (seen && compareVersions(version, seen) <= 0) return;
  const temp = `${seenFile}.tmp`;
  try {
    fs.writeFileSync(temp, `${version}\n`);
    fs.renameSync(temp, seenFile);
  } catch (error) {
    console.error('[UPDATE] Could not record the highest update version seen:', error.message);
  }
}

// Copies the download next to the running AppImage (same filesystem, so the later rename
// is atomic), then checks the copy itself: the feed's sha512 and our ed25519 signature
// over this version and architecture.
async function stageAppImage({ appImage, downloadedFile, info, feedUrl, fetchText, publicKeys, arch = process.arch, seenFile = null }) {
  const version = String(info.version);
  const seen = seenFile ? readSeenVersion(seenFile) : null;
  if (seen && compareVersions(version, seen) < 0) throw new Error(`The update feed offers v${version}, older than v${seen} already seen`);
  const fileName = path.basename(downloadedFile);
  if (fileName !== appImageFileName(version, arch)) throw new Error(`Unexpected update file ${fileName} for v${version} on ${arch}`);
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
    const sigUrl = new URL(entry.url.href);
    sigUrl.pathname += '.sig';
    const signature = await fetchText(sigUrl.href);
    if (!verifyAppImageSignature({ fileName, version, arch, sha512, signature, publicKeys })) {
      throw new Error(`${fileName} does not carry a valid Hyperclay Local signature for v${version} on ${arch}`);
    }
    if (seenFile) recordSeenVersion(seenFile, version);
    return staged;
  } catch (error) {
    await fs.promises.rm(staged, { force: true });
    throw error;
  }
}

// Keeps the running image as <name>.prev (a hard link, so no copy when it can), then
// renames the staged image over the user's filename, so desktop entries keep working.
// It throws only before the rename. Once the rename has happened the new image is in
// place and the caller must restart under supervision with the backup, so a failed
// directory sync is logged, not thrown.
function commitAppImage({ appImage, staged, logger = console }) {
  if (!staged) throw new Error('No staged AppImage to install');
  const previous = `${appImage}.prev`;
  fs.rmSync(previous, { force: true });
  try {
    fs.linkSync(appImage, previous);
  } catch {
    fs.copyFileSync(appImage, previous);
  }
  fs.renameSync(staged, appImage);
  try {
    const dir = fs.openSync(path.dirname(appImage), 'r');
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } catch (error) {
    logger.error('[UPDATE] Could not sync the AppImage folder after the swap:', error.message);
  }
  return previous;
}

function restartEnv(env) {
  const clean = { ...env };
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete clean[name];
  return clean;
}

function restartAppImage({ appImage, pid, previous = null, healthFile, skipFile, version, timeoutSeconds = 30, spawn = childProcess.spawn, env = process.env }) {
  const args = [String(pid), appImage, previous || '', healthFile, skipFile, String(version || ''), String(timeoutSeconds)];
  const child = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: os.homedir(),
    env: restartEnv(env)
  });
  child.unref();
}

// Read once at startup and removed from the environment, so helpers this process
// starts never inherit it.
function takeHealthFile(env) {
  const file = env[HEALTH_ENV] || null;
  delete env[HEALTH_ENV];
  return file;
}

function markHealthy(healthFile, version) {
  if (!healthFile) return;
  try {
    fs.writeFileSync(healthFile, `${version}\n`);
  } catch (error) {
    console.error('[UPDATE] Could not report a healthy start:', error.message);
  }
}

function readSkippedVersion(skipFile) {
  try {
    return fs.readFileSync(skipFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

module.exports = {
  RESTART_SCRIPT,
  HEALTH_ENV,
  takeHealthFile,
  markHealthy,
  readSkippedVersion,
  readSeenVersion,
  recordSeenVersion,
  signedMessage,
  appImageArch,
  appImageFileName,
  verifyAppImageSignature,
  sha512File,
  stagedPathFor,
  stageAppImage,
  commitAppImage,
  restartAppImage
};
