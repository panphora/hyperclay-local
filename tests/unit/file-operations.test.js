const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const {
  getLocalFiles,
  getLocalUploads,
  readFile,
  writeFile,
  fileExists,
  getFileStats,
  ensureDirectory,
  readFileBuffer,
  writeFileBuffer,
  calculateBufferChecksum
} = require('../../src/sync-engine/file-operations');

describe('getLocalFiles', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('finds HTML files at root level', async () => {
    await fs.writeFile(path.join(tempDir, 'site1.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'site2.html'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(2);
    expect(files.has('site1.html')).toBe(true);
    expect(files.has('site2.html')).toBe(true);
  });

  test('finds HTML files in subdirectories', async () => {
    await fs.mkdir(path.join(tempDir, 'folder1'));
    await fs.mkdir(path.join(tempDir, 'folder1', 'folder2'));
    await fs.writeFile(path.join(tempDir, 'folder1', 'nested.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'folder1', 'folder2', 'deep.html'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(2);
    expect(files.has('folder1/nested.html')).toBe(true);
    expect(files.has('folder1/folder2/deep.html')).toBe(true);
  });

  test('ignores non-HTML files', async () => {
    await fs.writeFile(path.join(tempDir, 'site.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'image.png'), 'content');
    await fs.writeFile(path.join(tempDir, 'styles.css'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('site.html')).toBe(true);
  });

  test('ignores hidden directories', async () => {
    await fs.mkdir(path.join(tempDir, '.hidden'));
    await fs.writeFile(path.join(tempDir, '.hidden', 'secret.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'visible.html'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('visible.html')).toBe(true);
  });

  test('ignores node_modules and sites-versions', async () => {
    await fs.mkdir(path.join(tempDir, 'node_modules'));
    await fs.mkdir(path.join(tempDir, 'sites-versions'));
    await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'sites-versions', 'backup.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'site.html'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('site.html')).toBe(true);
  });

  test('finds HTML files inside uploads directory', async () => {
    await fs.mkdir(path.join(tempDir, 'uploads'));
    await fs.writeFile(path.join(tempDir, 'uploads', 'file.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'site.html'), 'content');

    const files = await getLocalFiles(tempDir);

    expect(files.size).toBe(2);
    expect(files.has('site.html')).toBe(true);
    expect(files.has('uploads/file.html')).toBe(true);
  });

  test('returns file metadata', async () => {
    await fs.writeFile(path.join(tempDir, 'site.html'), 'test content');

    const files = await getLocalFiles(tempDir);
    const fileInfo = files.get('site.html');

    expect(fileInfo).toHaveProperty('path');
    expect(fileInfo).toHaveProperty('relativePath', 'site.html');
    expect(fileInfo).toHaveProperty('mtime');
    expect(fileInfo).toHaveProperty('size');
    expect(typeof fileInfo.mtime.getTime).toBe('function');
    expect(typeof fileInfo.mtime.getTime()).toBe('number');
  });

  test('returns empty map for empty directory', async () => {
    const files = await getLocalFiles(tempDir);
    expect(files.size).toBe(0);
  });
});

describe('getLocalUploads', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uploads-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('finds non-HTML files in sync folder', async () => {
    await fs.writeFile(path.join(tempDir, 'image.png'), 'content');
    await fs.writeFile(path.join(tempDir, 'document.pdf'), 'content');

    const files = await getLocalUploads(tempDir);

    expect(files.size).toBe(2);
    expect(files.has('image.png')).toBe(true);
    expect(files.has('document.pdf')).toBe(true);
  });

  test('finds files in subdirectories', async () => {
    await fs.mkdir(path.join(tempDir, 'folder'));
    await fs.writeFile(path.join(tempDir, 'folder', 'nested.png'), 'content');

    const files = await getLocalUploads(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('folder/nested.png')).toBe(true);
  });

  test('ignores hidden files', async () => {
    await fs.writeFile(path.join(tempDir, '.DS_Store'), 'content');
    await fs.writeFile(path.join(tempDir, '.hidden'), 'content');
    await fs.writeFile(path.join(tempDir, 'visible.png'), 'content');

    const files = await getLocalUploads(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('visible.png')).toBe(true);
  });

  test('excludes HTML files', async () => {
    await fs.writeFile(path.join(tempDir, 'site.html'), 'content');
    await fs.writeFile(path.join(tempDir, 'image.png'), 'content');

    const files = await getLocalUploads(tempDir);

    expect(files.size).toBe(1);
    expect(files.has('image.png')).toBe(true);
  });

  test('returns empty map for empty directory', async () => {
    const files = await getLocalUploads(tempDir);
    expect(files.size).toBe(0);
  });
});

describe('readFileBuffer and writeFileBuffer', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buffer-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('writeFileBuffer creates directories and writes buffer', async () => {
    const filePath = path.join(tempDir, 'nested', 'dir', 'file.bin');
    const content = Buffer.from([0x00, 0x01, 0x02, 0xFF]);

    await writeFileBuffer(filePath, content);

    const read = await readFileBuffer(filePath);
    expect(Buffer.compare(read, content)).toBe(0);
  });

  test('writeFileBuffer sets modification time', async () => {
    const filePath = path.join(tempDir, 'file.bin');
    const content = Buffer.from('test');
    const mtime = new Date('2024-01-15T12:00:00Z');

    await writeFileBuffer(filePath, content, mtime);

    const stats = await fs.stat(filePath);
    expect(Math.abs(stats.mtime.getTime() - mtime.getTime())).toBeLessThan(1000);
  });

  test('readFileBuffer returns Buffer', async () => {
    const filePath = path.join(tempDir, 'file.bin');
    await fs.writeFile(filePath, Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]));

    const content = await readFileBuffer(filePath);

    expect(Buffer.isBuffer(content)).toBe(true);
    expect(content.length).toBe(4);
  });
});

describe('calculateBufferChecksum', () => {
  test('returns 16-character hex string', () => {
    const checksum = calculateBufferChecksum(Buffer.from('test'));
    expect(checksum).toMatch(/^[a-f0-9]{16}$/);
  });

  test('returns consistent checksum', () => {
    const buffer = Buffer.from([0x01, 0x02, 0x03]);
    const checksum1 = calculateBufferChecksum(buffer);
    const checksum2 = calculateBufferChecksum(buffer);
    expect(checksum1).toBe(checksum2);
  });

  test('returns different checksum for different content', () => {
    const checksum1 = calculateBufferChecksum(Buffer.from([0x01]));
    const checksum2 = calculateBufferChecksum(Buffer.from([0x02]));
    expect(checksum1).not.toBe(checksum2);
  });
});

describe('fileExists', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exists-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('returns true for existing file', async () => {
    const filePath = path.join(tempDir, 'exists.txt');
    await fs.writeFile(filePath, 'content');

    expect(fileExists(filePath)).toBe(true);
  });

  test('returns false for non-existing file', () => {
    const filePath = path.join(tempDir, 'nonexistent.txt');
    expect(fileExists(filePath)).toBe(false);
  });
});

describe('ensureDirectory', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensure-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates nested directories', async () => {
    const dirPath = path.join(tempDir, 'a', 'b', 'c');

    await ensureDirectory(dirPath);

    const stats = await fs.stat(dirPath);
    expect(stats.isDirectory()).toBe(true);
  });

  test('does not error on existing directory', async () => {
    const dirPath = path.join(tempDir, 'existing');
    await fs.mkdir(dirPath);

    await expect(ensureDirectory(dirPath)).resolves.not.toThrow();
  });
});
