const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { macFeed, macUpdateZips, windowsFeed, windowsInstallers, linuxFeeds, linuxAppImages } = require('../../build-scripts/update-feed');

describe('mac update feed', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-feed-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name, content) {
    fs.writeFileSync(path.join(dir, name), content);
    return crypto.createHash('sha512').update(content).digest('base64');
  }

  test('hashes the final bytes of both zips with absolute versioned urls', () => {
    const x64Hash = write('HyperclayLocal-1.31.0-mac.zip', 'x64 bytes');
    const armHash = write('HyperclayLocal-1.31.0-arm64-mac.zip', 'arm64 bytes!');
    write('HyperclayLocal-1.31.0.dmg', 'dmg');

    const feed = yaml.load(macFeed({
      dir,
      version: '1.31.0',
      baseUrl: 'https://local.hyperclay.com/releases/1.31.0',
      releaseDate: '2026-10-15T00:00:00.000Z'
    }));

    expect(feed.version).toBe('1.31.0');
    expect(feed.files).toEqual([
      { url: 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0-mac.zip', sha512: x64Hash, size: 9 },
      { url: 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0-arm64-mac.zip', sha512: armHash, size: 12 }
    ]);
    expect(feed.path).toBe(feed.files[0].url);
    expect(feed.sha512).toBe(x64Hash);
    expect(feed.releaseDate).toBe('2026-10-15T00:00:00.000Z');
  });

  test('refuses a release missing one architecture', () => {
    write('HyperclayLocal-1.31.0-mac.zip', 'x64 bytes');
    expect(() => macFeed({ dir, version: '1.31.0', baseUrl: 'https://x', releaseDate: 'd' }))
      .toThrow(/one x64 and one arm64/);
  });

  test('ignores zips from another version', () => {
    expect(macUpdateZips([
      'HyperclayLocal-1.30.3-mac.zip',
      'HyperclayLocal-1.31.0-arm64-mac.zip',
      'HyperclayLocal-1.31.0.dmg'
    ], '1.31.0')).toEqual(['HyperclayLocal-1.31.0-arm64-mac.zip']);
  });
});

describe('windows update feed', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-feed-win-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('hashes the signed installer with an absolute versioned url', () => {
    const bytes = 'signed installer bytes';
    fs.writeFileSync(path.join(dir, 'HyperclayLocal-Setup-1.31.0.exe'), bytes);
    fs.writeFileSync(path.join(dir, 'HyperclayLocal-Setup-1.31.0.exe.blockmap'), 'stale');
    fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 1.31.0\nsha512: stale-from-electron-builder\n');
    const hash = crypto.createHash('sha512').update(bytes).digest('base64');

    const feed = yaml.load(windowsFeed({
      dir,
      version: '1.31.0',
      baseUrl: 'https://local.hyperclay.com/releases/1.31.0',
      releaseDate: '2026-10-15T00:00:00.000Z'
    }));

    expect(feed).toEqual({
      version: '1.31.0',
      files: [{ url: 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe', sha512: hash, size: bytes.length }],
      path: 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-Setup-1.31.0.exe',
      sha512: hash,
      releaseDate: '2026-10-15T00:00:00.000Z'
    });
  });

  test('refuses a release without its installer', () => {
    fs.writeFileSync(path.join(dir, 'HyperclayLocal-Setup-1.30.3.exe'), 'old');
    expect(() => windowsFeed({ dir, version: '1.31.0', baseUrl: 'https://x', releaseDate: 'd' }))
      .toThrow(/HyperclayLocal-Setup-1\.31\.0\.exe/);
  });

  test('picks only this version installer', () => {
    expect(windowsInstallers([
      'HyperclayLocal-Setup-1.30.3.exe',
      'HyperclayLocal-Setup-1.31.0.exe',
      'HyperclayLocal-Setup-1.31.0.exe.blockmap'
    ], '1.31.0')).toEqual(['HyperclayLocal-Setup-1.31.0.exe']);
  });
});

describe('linux update feeds', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-feed-linux-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('one feed per arch, hashed from the AppImage bytes on disk', () => {
    fs.writeFileSync(path.join(dir, 'HyperclayLocal-1.31.0.AppImage'), 'x64 after the runtime swap');
    fs.writeFileSync(path.join(dir, 'HyperclayLocal-1.31.0-arm64.AppImage'), 'arm64 after the runtime swap');
    fs.writeFileSync(path.join(dir, 'latest-linux.yml'), 'sha512: stale-from-electron-builder\n');
    const feeds = Object.fromEntries(linuxFeeds({
      dir,
      version: '1.31.0',
      baseUrl: 'https://local.hyperclay.com/releases/1.31.0',
      releaseDate: '2026-10-15T00:00:00.000Z'
    }).map(([name, content]) => [name, yaml.load(content)]));

    expect(Object.keys(feeds).sort()).toEqual(['latest-linux-arm64.yml', 'latest-linux.yml']);
    expect(feeds['latest-linux.yml'].files).toEqual([{
      url: 'https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0.AppImage',
      sha512: crypto.createHash('sha512').update('x64 after the runtime swap').digest('base64'),
      size: 26
    }]);
    expect(feeds['latest-linux-arm64.yml'].path).toBe('https://local.hyperclay.com/releases/1.31.0/HyperclayLocal-1.31.0-arm64.AppImage');
    expect(feeds['latest-linux-arm64.yml'].sha512).toBe(crypto.createHash('sha512').update('arm64 after the runtime swap').digest('base64'));
  });

  test('picks only this version AppImages', () => {
    expect(linuxAppImages([
      'HyperclayLocal-1.30.3.AppImage',
      'HyperclayLocal-1.31.0-arm64.AppImage',
      'HyperclayLocal-1.31.0.AppImage',
      'HyperclayLocal-1.31.0.AppImage.sig'
    ], '1.31.0')).toEqual(['HyperclayLocal-1.31.0-arm64.AppImage', 'HyperclayLocal-1.31.0.AppImage']);
  });
});
