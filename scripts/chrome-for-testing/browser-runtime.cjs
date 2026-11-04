const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const pin = require('./browser-runtime.json');

const verified = new Map();

function cacheRoot() {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  return configured && configured !== '0'
    ? path.join(path.resolve(configured), 'chrome-for-testing')
    : path.join(__dirname, '.chrome-for-testing');
}

function platformKey(platform = process.platform, arch = process.arch) {
  const keys = {
    'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64',
    'linux-arm64': 'linux-arm64', 'linux-x64': 'linux64',
    'win32-x64': 'win64', 'win32-arm64': 'win64', 'win32-ia32': 'win32',
  };
  const key = keys[`${platform}-${arch}`];
  if (!key || !pin.platforms[key]) throw new Error(`No pinned Chrome for ${platform}/${arch}.`);
  return key;
}

function assertVersion(actual) {
  if (actual !== pin.version) throw new Error(`Chrome ${actual || 'unknown'} does not match the pinned ${pin.version}. Run node ${__filename} install.`);
}

function executableVersion(executable) {
  let text;
  if (process.platform === 'darwin') {
    const plist = path.join(path.dirname(path.dirname(executable)), 'Info.plist');
    text = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8', timeout: 10000 });
  } else if (process.platform === 'win32') {
    text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:HYPER_CHROME_VERSION_FILE).VersionInfo.ProductVersion'], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, HYPER_CHROME_VERSION_FILE: executable },
    });
  } else {
    text = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000 });
  }
  return text.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
}

function chromePath() {
  const cache = cacheRoot();
  const key = platformKey();
  const spec = pin.platforms[key];
  const root = path.join(cache, pin.version, key);
  const executable = path.join(root, spec.executable);
  if (!fs.existsSync(executable)) throw new Error(`Pinned Chrome ${pin.version} is missing. Run node ${__filename} install.`);
  const stat = fs.statSync(executable);
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  if (verified.get(executable) !== stamp) {
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.install.json'), 'utf8'));
    if (receipt.version !== pin.version || receipt.sha256 !== spec.sha256) throw new Error(`Chrome installation receipt does not match ${pin.version}.`);
    assertVersion(executableVersion(executable));
    verified.set(executable, stamp);
  }
  return executable;
}

function mergeOptions(options, executable, sandbox = true) {
  if (options.executablePath || options.channel) throw new Error('Pinned Chrome cannot be combined with another executablePath or channel.');
  const chromiumSandbox = options.chromiumSandbox ?? sandbox;
  if (chromiumSandbox && (options.args || []).some(arg => arg === '--no-sandbox' || arg === '--disable-setuid-sandbox')) {
    throw new Error('Sandboxed Chrome cannot use sandbox-disabling arguments.');
  }
  return { ...options, executablePath: executable, chromiumSandbox };
}

function chromeOptions(options = {}) {
  return mergeOptions(options, chromePath(), process.env.HYPER_CHROME_SANDBOX !== '0');
}

async function install() {
  const cache = cacheRoot();
  const key = platformKey();
  const spec = pin.platforms[key];
  const destination = path.join(cache, pin.version, key);
  if (fs.existsSync(destination)) {
    console.log(`${pin.version} ${chromePath()}`);
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(spec.sha256)) throw new Error(`Missing archive checksum for ${key}.`);
  const expectedUrl = `https://storage.googleapis.com/chrome-for-testing-public/${pin.version}/${key}/chrome-${key}.zip`;
  if (spec.url !== expectedUrl) throw new Error('Unexpected Chrome download URL.');
  fs.mkdirSync(cache, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cache, '.install-'));
  try {
    const archive = path.join(temporary, 'chrome.zip');
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(300000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Chrome download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== spec.sha256) throw new Error('Chrome archive checksum mismatch.');
    const extracted = path.join(temporary, 'extracted');
    fs.mkdirSync(extracted);
    if (process.platform === 'darwin') {
      execFileSync('ditto', ['-x', '-k', archive, extracted], { stdio: 'inherit' });
    } else if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:HYPER_CHROME_ARCHIVE -DestinationPath $env:HYPER_CHROME_EXTRACT'], {
        stdio: 'inherit', env: { ...process.env, HYPER_CHROME_ARCHIVE: archive, HYPER_CHROME_EXTRACT: extracted },
      });
    } else {
      execFileSync('python3', ['-c', [
        'import os, sys, zipfile',
        'with zipfile.ZipFile(sys.argv[1]) as archive:',
        '    for entry in archive.infolist():',
        '        target = archive.extract(entry, sys.argv[2])',
        '        mode = (entry.external_attr >> 16) & 0o777',
        '        if mode: os.chmod(target, mode)',
      ].join('\n'), archive, extracted], { stdio: 'inherit' });
    }
    const root = path.join(extracted, `chrome-${key}`);
    assertVersion(executableVersion(path.join(root, spec.executable)));
    fs.writeFileSync(path.join(root, '.install.json'), JSON.stringify({ version: pin.version, sha256: spec.sha256 }) + '\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      fs.renameSync(root, destination);
    } catch (error) {
      if (!fs.existsSync(destination)) throw error;
    }
    console.log(`${pin.version} ${chromePath()}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { chromePath, chromeOptions, platformKey, assertVersion, mergeOptions, cacheRoot, version: pin.version };

if (require.main === module) {
  const command = process.argv[2];
  const run = command === 'install' ? install : command === 'check' ? () => console.log(`${pin.version} ${chromePath()}`) : () => { throw new Error('Usage: node browser-runtime.cjs install|check'); };
  Promise.resolve().then(run).catch(error => { console.error(error.message); process.exitCode = 1; });
}
