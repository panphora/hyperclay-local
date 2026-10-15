const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  RESTART_SCRIPT,
  takeHealthFile,
  markHealthy,
  readSkippedVersion,
  verifyAppImageSignature,
  stagedPathFor,
  stageAppImage,
  commitAppImage,
  restartAppImage,
  readSeenVersion,
  appImageArch
} = require('../../src/main/appimage-update');
const { createSigner, keygen } = require('../../build-scripts/update-signing');

const FEED_URL = 'https://local.hyperclay.com/updates/stable';
const describeShell = process.platform === 'win32' ? describe.skip : describe;
const testShell = process.platform === 'win32' ? test.skip : test;

function sha512(content) {
  return crypto.createHash('sha512').update(content).digest('base64');
}

describe('AppImage update signatures', () => {
  const { seed, publicKey } = keygen();
  const signer = createSigner(seed, [publicKey]);
  const name = 'HyperclayLocal-1.31.0.AppImage';
  const digest = sha512('new image');
  const signed = { fileName: name, version: '1.31.0', arch: 'x64', sha512: digest };

  test('a signature from the release key verifies', () => {
    expect(signer.publicKey).toBe(publicKey);
    expect(verifyAppImageSignature({ ...signed, signature: signer.sign(signed), publicKeys: [publicKey] })).toBe(true);
  });

  test('a signature for other bytes, another file name or another key does not', () => {
    const other = keygen();
    const signature = signer.sign(signed);
    expect(verifyAppImageSignature({ ...signed, sha512: sha512('other'), signature, publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ ...signed, fileName: 'HyperclayLocal-1.31.0-arm64.AppImage', signature, publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ ...signed, signature, publicKeys: [other.publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ ...signed, signature: 'not a signature', publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ ...signed, signature, publicKeys: [] })).toBe(false);
  });

  test('the signature binds the architecture and the version', () => {
    const signature = signer.sign(signed);
    expect(verifyAppImageSignature({ ...signed, arch: 'arm64', signature, publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ ...signed, version: '1.32.0', signature, publicKeys: [publicKey] })).toBe(false);
    expect(appImageArch('HyperclayLocal-1.31.0-arm64.AppImage')).toBe('arm64');
    expect(appImageArch(name)).toBe('x64');
  });

  test('either of two listed keys is accepted during a rotation', () => {
    const next = keygen();
    expect(verifyAppImageSignature({ ...signed, signature: signer.sign(signed), publicKeys: [next.publicKey, publicKey] })).toBe(true);
  });

  test('no seed means no signer, and a seed the app does not know fails', () => {
    expect(createSigner('', [publicKey])).toBeNull();
    expect(createSigner(undefined, [publicKey])).toBeNull();
    expect(() => createSigner(seed, [keygen().publicKey])).toThrow(/not in src\/main\/update-keys\.js/);
    expect(() => createSigner(Buffer.from('short').toString('base64'), [publicKey])).toThrow(/32-byte/);
  });
});

describeShell('staging and swapping an AppImage', () => {
  const { seed, publicKey } = keygen();
  const signer = createSigner(seed, [publicKey]);
  let dir;
  let appImage;
  let downloaded;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-update-'));
    fs.mkdirSync(path.join(dir, 'Apps'));
    fs.mkdirSync(path.join(dir, 'cache'));
    appImage = path.join(dir, 'Apps', 'Hyperclay Local.AppImage');
    fs.writeFileSync(appImage, 'old image', { mode: 0o755 });
    downloaded = path.join(dir, 'cache', 'HyperclayLocal-1.31.0.AppImage');
    fs.writeFileSync(downloaded, 'new image');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function info(digest = sha512('new image'), url = 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0.AppImage') {
    return { version: '1.31.0', downloadedFile: downloaded, files: [{ url, sha512: digest, size: 9 }] };
  }

  const sign = (digest = sha512('new image'), { version = '1.31.0', arch = 'x64', fileName = 'HyperclayLocal-1.31.0.AppImage' } = {}) =>
    signer.sign({ fileName, version, arch, sha512: digest });

  function stage(overrides = {}) {
    const fetchText = jest.fn().mockResolvedValue(sign());
    const options = { appImage, downloadedFile: downloaded, info: info(), feedUrl: FEED_URL, fetchText, publicKeys: [publicKey], arch: 'x64', ...overrides };
    return { promise: stageAppImage(options), fetchText };
  }

  test('stages a verified, executable copy beside the running image', async () => {
    const { promise, fetchText } = stage();
    const staged = await promise;
    expect(staged).toBe(path.join(dir, 'Apps', '.Hyperclay Local.AppImage.new'));
    expect(fs.readFileSync(staged, 'utf8')).toBe('new image');
    expect(fs.statSync(staged).mode & 0o777).toBe(0o755);
    expect(fetchText).toHaveBeenCalledWith('https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0.AppImage.sig');
  });

  test('resolves a relative feed url against the feed', async () => {
    const { promise, fetchText } = stage({ info: info(undefined, 'HyperclayLocal-1.31.0.AppImage') });
    await promise;
    expect(fetchText).toHaveBeenCalledWith('https://local.hyperclay.com/updates/stable/HyperclayLocal-1.31.0.AppImage.sig');
  });

  test('a copy that does not match the feed sha512 is refused and removed', async () => {
    await expect(stage({ info: info(sha512('something else')) }).promise).rejects.toThrow(/sha512/);
    expect(fs.existsSync(stagedPathFor(appImage))).toBe(false);
  });

  test('a bad signature is refused and the staged copy removed', async () => {
    await expect(stage({ fetchText: jest.fn().mockResolvedValue(sign(sha512('other'))) }).promise)
      .rejects.toThrow(/signature/);
    expect(fs.existsSync(stagedPathFor(appImage))).toBe(false);
    await expect(stage({ fetchText: jest.fn().mockRejectedValue(new Error('HTTP 404')) }).promise).rejects.toThrow(/404/);
    expect(fs.existsSync(stagedPathFor(appImage))).toBe(false);
  });

  test('a file the feed does not name, or named for another version, is refused', async () => {
    await expect(stage({ info: info(undefined, 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0-arm64.AppImage') }).promise)
      .rejects.toThrow(/does not list/);
    await expect(stage({ info: { ...info(), version: '1.32.0' } }).promise).rejects.toThrow(/Unexpected update file/);
  });

  test('the signature file keeps the feed url query and goes after the path', async () => {
    const { promise, fetchText } = stage({ info: info(undefined, 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0.AppImage?sha512=abc123') });
    await promise;
    expect(fetchText).toHaveBeenCalledWith('https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0.AppImage.sig?sha512=abc123');
  });

  test('an image for the other architecture is refused, even validly signed for it', async () => {
    const armName = 'HyperclayLocal-1.31.0-arm64.AppImage';
    const armDownload = path.join(dir, 'cache', armName);
    fs.writeFileSync(armDownload, 'new image');
    const armInfo = { version: '1.31.0', downloadedFile: armDownload, files: [{ url: `https://local.hyperclay.com/releases/1.31.0/${armName}`, sha512: sha512('new image'), size: 9 }] };
    const armSignature = sign(undefined, { arch: 'arm64', fileName: armName });
    await expect(stage({ downloadedFile: armDownload, info: armInfo, fetchText: jest.fn().mockResolvedValue(armSignature) }).promise)
      .rejects.toThrow(/Unexpected update file/);
    await expect(stage({ arch: 'arm64', downloadedFile: armDownload, info: armInfo, fetchText: jest.fn().mockResolvedValue(armSignature) }).promise)
      .resolves.toBe(stagedPathFor(appImage));
    await expect(stage({ arch: 'arm64', downloadedFile: armDownload, info: armInfo, fetchText: jest.fn().mockResolvedValue(sign(undefined, { fileName: armName })) }).promise)
      .rejects.toThrow(/signature/);
  });

  test('records the highest verified version and refuses an older feed after it', async () => {
    const seenFile = path.join(dir, 'update-seen');
    fs.rmSync(await stage({ seenFile }).promise);
    expect(readSeenVersion(seenFile)).toBe('1.31.0');

    fs.writeFileSync(seenFile, '1.32.0\n');
    await expect(stage({ seenFile }).promise).rejects.toThrow(/older than v1\.32\.0/);
    expect(fs.existsSync(stagedPathFor(appImage))).toBe(false);
    expect(readSeenVersion(seenFile)).toBe('1.32.0');
  });

  test('a failed signature records nothing as seen', async () => {
    const seenFile = path.join(dir, 'update-seen');
    await expect(stage({ seenFile, fetchText: jest.fn().mockResolvedValue(sign(sha512('other'))) }).promise).rejects.toThrow(/signature/);
    expect(readSeenVersion(seenFile)).toBeNull();
  });

  test('commit keeps the old image as .prev and puts the new one under the same name', async () => {
    const staged = await stage().promise;
    const previous = commitAppImage({ appImage, staged });
    expect(previous).toBe(`${appImage}.prev`);
    expect(fs.readFileSync(appImage, 'utf8')).toBe('new image');
    expect(fs.readFileSync(previous, 'utf8')).toBe('old image');
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.statSync(appImage).mode & 0o777).toBe(0o755);
  });

  test('a failed directory sync after the rename still returns the backup', async () => {
    const staged = await stage().promise;
    const fsync = jest.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      throw Object.assign(new Error('directory fsync failed'), { code: 'EIO' });
    });
    const logger = { error: jest.fn() };
    try {
      expect(commitAppImage({ appImage, staged, logger })).toBe(`${appImage}.prev`);
    } finally {
      fsync.mockRestore();
    }
    expect(fs.readFileSync(appImage, 'utf8')).toBe('new image');
    expect(fs.readFileSync(`${appImage}.prev`, 'utf8')).toBe('old image');
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Could not sync/), 'directory fsync failed');
  });

  test('commit replaces an older .prev and refuses with nothing staged', async () => {
    fs.writeFileSync(`${appImage}.prev`, 'ancient image');
    const staged = await stage().promise;
    commitAppImage({ appImage, staged });
    expect(fs.readFileSync(`${appImage}.prev`, 'utf8')).toBe('old image');
    expect(() => commitAppImage({ appImage, staged: null })).toThrow(/No staged/);
  });
});

describe('restarting the AppImage', () => {
  test('starts a detached bash outside the AppImage with a clean environment', () => {
    const child = { unref: jest.fn() };
    const spawnMock = jest.fn(() => child);
    restartAppImage({
      appImage: '/home/ana/Apps/Hyperclay Local.AppImage',
      pid: 4242,
      previous: '/home/ana/Apps/Hyperclay Local.AppImage.prev',
      healthFile: '/home/ana/.config/Hyperclay Local/update-healthy',
      skipFile: '/home/ana/.config/Hyperclay Local/update-skip',
      version: '1.31.0',
      spawn: spawnMock,
      env: { HOME: '/home/ana', APPIMAGE: '/old', APPDIR: '/tmp/.mount_x', ARGV0: 'x', OWD: '/home/ana', DISPLAY: ':0' }
    });
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('/bin/bash');
    expect(args).toEqual([
      '-c', RESTART_SCRIPT, 'hyperclay-local-restart', '4242',
      '/home/ana/Apps/Hyperclay Local.AppImage',
      '/home/ana/Apps/Hyperclay Local.AppImage.prev',
      '/home/ana/.config/Hyperclay Local/update-healthy',
      '/home/ana/.config/Hyperclay Local/update-skip',
      '1.31.0',
      '30'
    ]);
    expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(options.env).toEqual({ HOME: '/home/ana', DISPLAY: ':0' });
    expect(child.unref).toHaveBeenCalled();
  });

  testShell('the script launches the image only after the old process has exited', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-restart-'));
    try {
      const marker = path.join(dir, 'launched');
      const image = path.join(dir, 'Fake.AppImage');
      fs.writeFileSync(image, `#!/bin/sh\necho "$APPIMAGE" > "${marker}"\n`, { mode: 0o755 });
      const old = spawn('sleep', ['1']);
      const exited = new Promise((resolve) => old.on('exit', () => resolve(Date.now())));
      const script = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', String(old.pid), image, '', '', '', '', '30'], { stdio: 'ignore' });
      const done = new Promise((resolve) => script.on('exit', resolve));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fs.existsSync(marker)).toBe(false);
      const oldExitedAt = await exited;
      expect(await done).toBe(0);
      expect(fs.statSync(marker).mtimeMs).toBeGreaterThanOrEqual(oldExitedAt - 50);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describeShell('the update supervisor', () => {
  let dir;
  let image;
  let previous;
  let healthy;
  let skip;
  let goneProcess;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-supervise-'));
    image = path.join(dir, 'Hyperclay Local.AppImage');
    previous = `${image}.prev`;
    healthy = path.join(dir, 'update-healthy');
    skip = path.join(dir, 'update-skip');
    fs.writeFileSync(previous, `#!/bin/sh\necho "old \${HCL_UPDATE_HEALTHY:-unsupervised}" > "${dir}/old-ran"\n`, { mode: 0o755 });
    const done = spawn('true');
    goneProcess = done.pid;
    await new Promise((resolve) => done.on('exit', resolve));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function newImage(body) {
    fs.writeFileSync(image, `#!/bin/sh\necho $$ > "${dir}/new-pid"\n${body}\n`, { mode: 0o755 });
  }

  function supervise(timeout = 30) {
    const script = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', String(goneProcess), image, previous, healthy, skip, '1.31.0', String(timeout)], { stdio: 'ignore' });
    return new Promise((resolve) => script.on('exit', resolve));
  }

  function isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  test('a new version that reports healthy stays, and keeps .prev for later', async () => {
    newImage('touch "$HCL_UPDATE_HEALTHY"; sleep 1');
    expect(await supervise()).toBe(0);
    expect(fs.readFileSync(image, 'utf8')).toContain('new-pid');
    expect(fs.existsSync(previous)).toBe(true);
    expect(fs.existsSync(skip)).toBe(false);
    expect(fs.existsSync(healthy)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'old-ran'))).toBe(false);
  });

  test('a new version that exits before healthy is rolled back and skipped', async () => {
    newImage('exit 1');
    expect(await supervise()).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'old-ran'), 'utf8')).toBe('old unsupervised\n');
    expect(fs.readFileSync(image, 'utf8')).toContain('old-ran');
    expect(fs.existsSync(previous)).toBe(false);
    expect(fs.readFileSync(skip, 'utf8')).toBe('1.31.0\n');
  });

  test('a new version that hangs past the timeout is stopped, rolled back and skipped', async () => {
    newImage('exec sleep 60');
    expect(await supervise(1)).toBe(0);
    const hungPid = Number(fs.readFileSync(path.join(dir, 'new-pid'), 'utf8'));
    expect(isAlive(hungPid)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'old-ran'))).toBe(true);
    expect(fs.readFileSync(skip, 'utf8')).toBe('1.31.0\n');
  }, 15000);

  test('when the swap never happened it just starts the image, unsupervised', async () => {
    newImage('echo "$HCL_UPDATE_HEALTHY" > "' + dir + '/env"');
    const script = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', String(goneProcess), image, '', healthy, skip, '1.31.0', '30'], { stdio: 'ignore' });
    expect(await new Promise((resolve) => script.on('exit', resolve))).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'env'), 'utf8')).toBe('\n');
    expect(fs.existsSync(skip)).toBe(false);
  });
});

describe('health and skip files', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-health-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the health file is taken out of the environment and written once healthy', () => {
    const env = { HCL_UPDATE_HEALTHY: path.join(dir, 'update-healthy'), HOME: '/home/ana' };
    const file = takeHealthFile(env);
    expect(env).toEqual({ HOME: '/home/ana' });
    markHealthy(file, '1.31.0');
    expect(fs.readFileSync(file, 'utf8')).toBe('1.31.0\n');
    expect(takeHealthFile({})).toBeNull();
    expect(() => markHealthy(null, '1.31.0')).not.toThrow();
  });

  test('the skipped version is read back, or null when there is none', () => {
    expect(readSkippedVersion(path.join(dir, 'update-skip'))).toBeNull();
    fs.writeFileSync(path.join(dir, 'update-skip'), '1.31.0\n');
    expect(readSkippedVersion(path.join(dir, 'update-skip'))).toBe('1.31.0');
  });
});
