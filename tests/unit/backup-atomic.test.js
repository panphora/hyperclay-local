// H4 + H5: atomic, monotonic version publication.
//
// H4 — a backup must never leave a partial version file. The content is written
// to a dot-prefixed temp, fsynced, then link-or-rename'd into the final name, so
// a mid-write ENOSPC leaves NO version-named file and the guard still recovers
// the last good one. On a filesystem without hard links the rename fallback keeps
// backups working (exFAT USB sticks) rather than failing closed.
//
// H5 — a clock rollback must never mis-rank the newest version. When the wall
// clock lands at-or-before the newest committed instant, publication reuses that
// instant's timestamp string and the next collision suffix, so the actual newest
// write still sorts first under the ONE shared comparator and survives a prune.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { createBackup } = require('../../src/main/utils/backup');
const { VERSION_NAME, compareNewestFirst, pruneSiteVersions } = require('../../src/main/utils/prune-versions');
const { _newestVersionPath } = require('../../src/main/data-loss-guard');

const DAY = 24 * 60 * 60 * 1000;

const versionsIn = async (siteDir) =>
  (await fs.readdir(siteDir)).filter((f) => VERSION_NAME.test(f));

describe('H4: a backup never publishes a partial version file', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'backup-atomic-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  test('a mid-write ENOSPC leaves no version file and the guard still returns the good backup', async () => {
    // A known-good version already exists.
    await createBackup(dir, 'notes', '<html>GOOD</html>');
    const siteDir = path.join(dir, 'sites-versions', 'notes');
    const good = await versionsIn(siteDir);
    expect(good).toHaveLength(1);

    // Fail the version write mid-write with ENOSPC. open() really runs (so any
    // file the publisher creates DOES appear on disk — that is the partial-file
    // hazard this pins), but writeFile rejects. Keyed on the site directory so it
    // catches whichever name the publisher opens (the dot-prefixed temp today, a
    // direct final name in the old broken design).
    const realOpen = fs.open.bind(fs);
    const siteNeedle = path.join('sites-versions', 'notes');
    jest.spyOn(fs, 'open').mockImplementation(async (p, ...rest) => {
      const handle = await realOpen(p, ...rest);
      if (String(p).includes(siteNeedle)) {
        const err = new Error('ENOSPC: no space left on device, write');
        err.code = 'ENOSPC';
        return {
          writeFile: () => Promise.reject(err),
          sync: handle.sync.bind(handle),
          chmod: handle.chmod.bind(handle),
          close: handle.close.bind(handle),
        };
      }
      return handle;
    });

    const result = await createBackup(dir, 'notes', '<html>DOOMED</html>');
    expect(result).toBeNull();

    fs.open.mockRestore();

    // Exactly the one good version remains; no partial/empty version name.
    expect(await versionsIn(siteDir)).toEqual(good);
    // No dot-prefixed temp lingered either.
    expect((await fs.readdir(siteDir)).filter((f) => f.startsWith('.hyperclay-ver-'))).toEqual([]);

    // The guard recovers the good bytes, never a partial file.
    const recovered = await _newestVersionPath(dir, 'notes.html');
    expect(path.basename(recovered)).toBe(good[0]);
    expect(await fs.readFile(recovered, 'utf8')).toBe('<html>GOOD</html>');
  });

  test('link EPERM/ENOTSUP falls back to an atomic rename with the full content', async () => {
    // Simulate a filesystem with no hard links (exFAT USB stick).
    jest.spyOn(fs, 'link').mockImplementation(() => {
      const err = new Error('ENOTSUP: operation not supported');
      err.code = 'ENOTSUP';
      return Promise.reject(err);
    });

    const result = await createBackup(dir, 'notes', '<html>ON A USB STICK</html>');
    expect(result).not.toBeNull();

    fs.link.mockRestore();

    const siteDir = path.join(dir, 'sites-versions', 'notes');
    const versions = await versionsIn(siteDir);
    expect(versions).toHaveLength(1);
    // Rename moved the fully-written temp, so the published file is whole.
    expect(await fs.readFile(path.join(siteDir, versions[0]), 'utf8')).toBe('<html>ON A USB STICK</html>');
    // No temp left behind (the rename consumed it).
    expect((await fs.readdir(siteDir)).filter((f) => f.startsWith('.hyperclay-ver-'))).toEqual([]);
  });
});

describe('H5: a clock rollback never mis-ranks the newest version', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'backup-h5-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  // Fake ONLY the clock; the fs promises these backups are made of must keep
  // running on the real event loop.
  function useFrozenClock() {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
        'performance', 'requestAnimationFrame', 'cancelAnimationFrame'
      ]
    });
  }

  test('a July->January rollback still ranks and keeps the actual newest write', async () => {
    useFrozenClock();
    const siteDir = path.join(dir, 'sites-versions', 'notes');

    // 20 versions written in July.
    jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    for (let i = 0; i < 20; i++) {
      await createBackup(dir, 'notes', `<html>july ${i}</html>`);
    }

    // The genuinely newest write happens in January — the wall clock rolled back.
    jest.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
    await createBackup(dir, 'notes', '<html>ACTUAL NEWEST</html>');

    jest.useRealTimers();

    const files = await versionsIn(siteDir);
    expect(files).toHaveLength(21);

    // The shared comparator must rank the January write first, by content.
    const ranked = [];
    for (const name of files) {
      ranked.push({ name, mtimeMs: (await fs.stat(path.join(siteDir, name))).mtimeMs });
    }
    ranked.sort(compareNewestFirst);
    const newestFile = ranked[0].name;
    expect(await fs.readFile(path.join(siteDir, newestFile), 'utf8')).toBe('<html>ACTUAL NEWEST</html>');

    // The data-loss guard picks the same newest file.
    const recovered = await _newestVersionPath(dir, 'notes.html');
    expect(path.basename(recovered)).toBe(newestFile);
    expect(await fs.readFile(recovered, 'utf8')).toBe('<html>ACTUAL NEWEST</html>');

    // And it survives a prune run well past the July retention window: the age
    // rule would expire the July-stamped files, but the newest-20 floor keeps
    // this write.
    const pruneNow = Date.UTC(2026, 6, 15, 12, 0, 0, 0) + 61 * DAY;
    await pruneSiteVersions(dir, siteDir, pruneNow);
    const survivors = await versionsIn(siteDir);
    expect(survivors).toContain(newestFile);
    expect(await fs.readFile(path.join(siteDir, newestFile), 'utf8')).toBe('<html>ACTUAL NEWEST</html>');
  });
});
