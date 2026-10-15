const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { macFeed, macUpdateZips } = require('../../build-scripts/update-feed');

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
