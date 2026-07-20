// A1 at the route level: concurrent saves must not interleave their reads, and
// the guard's pinned recovery body must live in the guard's own storage.

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

// createBackup names versions with millisecond precision and no collision
// suffix, so two backups inside one millisecond silently overwrite each other.
// That would make a count-based assertion flaky for reasons that have nothing
// to do with serialization, so record the calls instead of counting files.
const backupCalls = [];
jest.mock('../../src/main/utils/backup', () => {
  const actual = jest.requireActual('../../src/main/utils/backup');
  return {
    ...actual,
    createBackup: jest.fn(async (baseDir, siteName, content, ...rest) => {
      backupCalls.push({ siteName, content });
      return actual.createBackup(baseDir, siteName, content, ...rest);
    })
  };
});

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { createBackup } = require('../../src/main/utils/backup');
const dataGuard = require('../../src/main/data-loss-guard');

describe('A1: concurrent /save requests', () => {
  let dir;
  let app;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'save-race-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    backupCalls.length = 0;
    app = createApp(dir);
    await fs.writeFile(path.join(dir, 'index.html'), '<html><body>base</body></html>');
  });

  afterEach(async () => {
    // The data-loss guard runs detached by design, so it can still be writing
    // into .hyperclay/guard when the request has already responded. Let it
    // settle, and retry the removal if it lands mid-teardown.
    await new Promise((r) => setTimeout(r, 50));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const save = (body) => request(app)
    .post('/_/save')
    .set('Page-URL', 'http://localhost:4321/index.html')
    .set('Content-Type', 'text/plain')
    .send(body);

  test('two concurrent saves both complete and the file is one of them, never a blend', async () => {
    const a = '<html><body>' + 'A'.repeat(5000) + '</body></html>';
    const b = '<html><body>' + 'B'.repeat(5000) + '</body></html>';

    const [resA, resB] = await Promise.all([save(a), save(b)]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const onDisk = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    const hasA = onDisk.includes('AAAA');
    const hasB = onDisk.includes('BBBB');
    expect(hasA || hasB).toBe(true);
    expect(hasA && hasB).toBe(false);
  });

  test('the interleaved-read window is closed: the first-save branch runs once', async () => {
    // THE bug this item exists to prevent. The handler reads sites-versions to
    // decide isFirstSave, then writes to it. Serializing only the write would
    // let both requests read "no versions yet", both take the isFirstSave
    // branch, and both back up the pre-existing body from the same stale base.
    await Promise.all([save('<html>one</html>'), save('<html>two</html>')]);

    const originals = backupCalls.filter((c) => c.content.includes('base'));
    expect(originals).toHaveLength(1);

    // One initial existing-content backup plus one per incoming save.
    expect(backupCalls).toHaveLength(3);
  });

  test('ten concurrent saves each get versioned exactly once', async () => {
    const saves = [];
    for (let i = 0; i < 10; i++) saves.push(save(`<html>v${i}</html>`));
    const results = await Promise.all(saves);

    for (const res of results) expect(res.status).toBe(200);

    expect(backupCalls.filter((c) => c.content.includes('base'))).toHaveLength(1);
    for (let i = 0; i < 10; i++) {
      expect(backupCalls.filter((c) => c.content.includes(`v${i}`))).toHaveLength(1);
    }
    expect(backupCalls).toHaveLength(11); // 10 incoming + 1 initial
  });

  test('a save leaves no stray temp files in the served folder', async () => {
    await save('<html>done</html>');

    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});

describe('A5: the guard pins its recovery body in its own storage', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard-pin-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('the pinned path is under the guard directory, never sites-versions', async () => {
    // With no pre-write body available, the guard used to pin a sites-versions
    // path — a file the retention pruner is free to delete out from under it.
    await createBackup(dir, 'index', '<html><body>LAST GOOD</body></html>');

    const pinned = await dataGuard._captureRecoverPath(dir, 'index.html', null);

    expect(pinned).toBeTruthy();
    expect(pinned).toContain(path.join('.hyperclay', 'guard'));
    expect(pinned).not.toContain('sites-versions');
    expect(await fs.readFile(pinned, 'utf8')).toBe('<html><body>LAST GOOD</body></html>');
  });

  test('the pinned copy survives the pruner deleting every version', async () => {
    await createBackup(dir, 'index', '<html><body>LAST GOOD</body></html>');
    const pinned = await dataGuard._captureRecoverPath(dir, 'index.html', null);

    await fs.rm(path.join(dir, 'sites-versions'), { recursive: true, force: true });

    expect(await fs.readFile(pinned, 'utf8')).toBe('<html><body>LAST GOOD</body></html>');
  });

  test('a pre-write body is still preferred and stored in the guard directory', async () => {
    const pinned = await dataGuard._captureRecoverPath(dir, 'index.html', '<html>PREV</html>');

    expect(pinned).toContain(path.join('.hyperclay', 'guard'));
    expect(await fs.readFile(pinned, 'utf8')).toBe('<html>PREV</html>');
  });

  test('no body and no versions yields null rather than a dangling path', async () => {
    expect(await dataGuard._captureRecoverPath(dir, 'index.html', null)).toBeNull();
  });
});
