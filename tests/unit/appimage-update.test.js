const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  RESTART_SCRIPT,
  verifyAppImageSignature,
  stagedPathFor,
  stageAppImage,
  commitAppImage,
  restartAppImage
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

  test('a signature from the release key verifies', () => {
    expect(signer.publicKey).toBe(publicKey);
    expect(verifyAppImageSignature({ fileName: name, sha512: digest, signature: signer.sign(name, digest), publicKeys: [publicKey] })).toBe(true);
  });

  test('a signature for other bytes, another file name or another key does not', () => {
    const other = keygen();
    const signature = signer.sign(name, digest);
    expect(verifyAppImageSignature({ fileName: name, sha512: sha512('other'), signature, publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ fileName: 'HyperclayLocal-1.31.0-arm64.AppImage', sha512: digest, signature, publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ fileName: name, sha512: digest, signature, publicKeys: [other.publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ fileName: name, sha512: digest, signature: 'not a signature', publicKeys: [publicKey] })).toBe(false);
    expect(verifyAppImageSignature({ fileName: name, sha512: digest, signature, publicKeys: [] })).toBe(false);
  });

  test('either of two listed keys is accepted during a rotation', () => {
    const next = keygen();
    expect(verifyAppImageSignature({ fileName: name, sha512: digest, signature: signer.sign(name, digest), publicKeys: [next.publicKey, publicKey] })).toBe(true);
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

  function stage(overrides = {}) {
    const fetchText = jest.fn().mockResolvedValue(signer.sign('HyperclayLocal-1.31.0.AppImage', sha512('new image')));
    const options = { appImage, downloadedFile: downloaded, info: info(), feedUrl: FEED_URL, fetchText, publicKeys: [publicKey], ...overrides };
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
    await expect(stage({ fetchText: jest.fn().mockResolvedValue(signer.sign('HyperclayLocal-1.31.0.AppImage', sha512('other'))) }).promise)
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

  test('commit keeps the old image as .prev and puts the new one under the same name', async () => {
    const staged = await stage().promise;
    const previous = commitAppImage({ appImage, staged });
    expect(previous).toBe(`${appImage}.prev`);
    expect(fs.readFileSync(appImage, 'utf8')).toBe('new image');
    expect(fs.readFileSync(previous, 'utf8')).toBe('old image');
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.statSync(appImage).mode & 0o777).toBe(0o755);
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
      spawn: spawnMock,
      env: { HOME: '/home/ana', APPIMAGE: '/old', APPDIR: '/tmp/.mount_x', ARGV0: 'x', OWD: '/home/ana', DISPLAY: ':0' }
    });
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('/bin/bash');
    expect(args).toEqual(['-c', RESTART_SCRIPT, 'hyperclay-local-restart', '4242', '/home/ana/Apps/Hyperclay Local.AppImage']);
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
      const script = spawn('/bin/bash', ['-c', RESTART_SCRIPT, 'hyperclay-local-restart', String(old.pid), image], { stdio: 'ignore' });
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
