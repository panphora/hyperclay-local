const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const {
  generateTimestamp,
  createBackup,
  createBackupIfExists,
  createBinaryBackup,
  createBinaryBackupIfExists
} = require('../../src/main/utils/backup');

describe('generateTimestamp', () => {
  test('returns correctly formatted timestamp', () => {
    const timestamp = generateTimestamp();

    // Format: YYYY-MM-DD-HH-MM-SS-mmm
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}$/);
  });

  test('generates unique timestamps', async () => {
    const timestamps = new Set();
    for (let i = 0; i < 10; i++) {
      timestamps.add(generateTimestamp());
      await new Promise(r => setTimeout(r, 5)); // Small delay
    }

    // Most should be unique (might get duplicates within same ms)
    expect(timestamps.size).toBeGreaterThan(5);
  });
});

describe('createBackup', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates backup file in correct location', async () => {
    const content = '<html>test</html>';
    const siteName = 'my-site';

    const backupPath = await createBackup(tempDir, siteName, content);

    expect(backupPath).toBeTruthy();
    expect(backupPath).toContain('sites-versions');
    expect(backupPath).toContain(siteName);
    expect(backupPath).toEndWith('.html');

    // Verify file exists and has correct content
    const savedContent = await fs.readFile(backupPath, 'utf8');
    expect(savedContent).toBe(content);
  });

  test('creates nested directory structure for paths', async () => {
    const content = '<html>test</html>';
    const siteName = 'folder1/folder2/my-site';

    const backupPath = await createBackup(tempDir, siteName, content);

    expect(backupPath).toContain('folder1');
    expect(backupPath).toContain('folder2');
    expect(backupPath).toContain('my-site');
  });

  test('emits backup-created event', async () => {
    const events = [];
    const emit = (event, data) => events.push({ event, data });

    await createBackup(tempDir, 'test-site', 'content', emit);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('backup-created');
    expect(events[0].data.original).toBe('test-site');
    expect(events[0].data.backup).toBeTruthy();
  });
});

describe('createBackupIfExists', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates backup when file exists', async () => {
    const filePath = path.join(tempDir, 'existing.html');
    const content = '<html>existing content</html>';
    await fs.writeFile(filePath, content, 'utf8');

    const backupPath = await createBackupIfExists(filePath, 'existing', tempDir);

    expect(backupPath).toBeTruthy();
    const backupContent = await fs.readFile(backupPath, 'utf8');
    expect(backupContent).toBe(content);
  });

  test('returns null when file does not exist', async () => {
    const filePath = path.join(tempDir, 'nonexistent.html');

    const backupPath = await createBackupIfExists(filePath, 'nonexistent', tempDir);

    expect(backupPath).toBeNull();
  });
});

describe('createBinaryBackup', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates backup with correct extension', async () => {
    const content = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG header
    const uploadPath = 'image.png';

    const backupPath = await createBinaryBackup(tempDir, uploadPath, content);

    expect(backupPath).toBeTruthy();
    expect(backupPath).toEndWith('.png');

    // Verify binary content preserved
    const savedContent = await fs.readFile(backupPath);
    expect(Buffer.compare(savedContent, content)).toBe(0);
  });

  test('preserves folder structure in backup path', async () => {
    const content = Buffer.from('test');
    const uploadPath = 'folder/subfolder/file.pdf';

    const backupPath = await createBinaryBackup(tempDir, uploadPath, content);

    expect(backupPath).toContain('uploads');
    expect(backupPath).toContain('folder');
    expect(backupPath).toContain('subfolder');
    expect(backupPath).toEndWith('.pdf');
  });

  test('handles root-level uploads', async () => {
    const content = Buffer.from('test');
    const uploadPath = 'document.txt';

    const backupPath = await createBinaryBackup(tempDir, uploadPath, content);

    expect(backupPath).toBeTruthy();
    expect(backupPath).toContain('uploads');
    expect(backupPath).toEndWith('.txt');
  });

  test('emits backup-created event with type', async () => {
    const events = [];
    const emit = (event, data) => events.push({ event, data });

    await createBinaryBackup(tempDir, 'test.png', Buffer.from('test'), emit);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('backup-created');
    expect(events[0].data.type).toBe('upload');
  });
});

describe('createBinaryBackupIfExists', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('creates backup when file exists', async () => {
    const filePath = path.join(tempDir, 'existing.png');
    const content = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    await fs.writeFile(filePath, content);

    const backupPath = await createBinaryBackupIfExists(filePath, 'existing.png', tempDir);

    expect(backupPath).toBeTruthy();
    const backupContent = await fs.readFile(backupPath);
    expect(Buffer.compare(backupContent, content)).toBe(0);
  });

  test('returns null when file does not exist', async () => {
    const filePath = path.join(tempDir, 'nonexistent.png');

    const backupPath = await createBinaryBackupIfExists(filePath, 'nonexistent.png', tempDir);

    expect(backupPath).toBeNull();
  });
});

// Custom matcher for endsWith
expect.extend({
  toEndWith(received, expected) {
    const pass = received.endsWith(expected);
    return {
      pass,
      message: () => `expected ${received} to ${pass ? 'not ' : ''}end with ${expected}`
    };
  }
});
