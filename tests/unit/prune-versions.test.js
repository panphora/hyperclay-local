const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const {
  MAX_AGE_MS,
  KEEP_NEWEST,
  parseVersionTimestamp,
  sortKey,
  collisionSuffix,
  compareNewestFirst,
  pruneSiteVersions,
  pruneAllVersions
} = require('../../src/main/utils/prune-versions');
const { generateTimestamp } = require('../../src/main/utils/backup');

const DAY = 24 * 60 * 60 * 1000;

describe('parseVersionTimestamp', () => {
  test('parses a UTC name as UTC', () => {
    expect(parseVersionTimestamp('2026-07-19-14-22-08-431Z.html'))
      .toBe(Date.UTC(2026, 6, 19, 14, 22, 8, 431));
  });

  test('parses a negative offset by adding it back', () => {
    // 01:30:00.431 at UTC-4 is 05:30:00.431Z. The `-` before `0400` is the
    // sign, not a separator: the offset group is fixed width and positional.
    expect(parseVersionTimestamp('2026-11-01-01-30-00-431-0400.html'))
      .toBe(Date.UTC(2026, 10, 1, 5, 30, 0, 431));
  });

  test('parses a positive offset by subtracting it', () => {
    // 01:30:00.431 at UTC+5:30 is the previous day, 20:00:00.431Z.
    expect(parseVersionTimestamp('2026-11-01-01-30-00-431+0530.html'))
      .toBe(Date.UTC(2026, 9, 31, 20, 0, 0, 431));
  });

  test('a zero offset is written +0000 and parses as UTC', () => {
    expect(parseVersionTimestamp('2026-07-19-14-22-08-431+0000.html'))
      .toBe(parseVersionTimestamp('2026-07-19-14-22-08-431Z.html'));
  });

  test('an offset survives the collision suffix', () => {
    expect(parseVersionTimestamp('2026-11-01-01-30-00-431-0400-002.html'))
      .toBe(Date.UTC(2026, 10, 1, 5, 30, 0, 431));
  });

  test('refuses to guess at a legacy local-time name', () => {
    // No zone: local wall time repeats every DST fall-back, so this is not a
    // trustworthy instant and the caller must use mtime instead.
    expect(parseVersionTimestamp('2026-07-19-14-22-08-431.html')).toBeNull();
  });

  test('ignores anything that is not a version filename', () => {
    expect(parseVersionTimestamp('notes.html')).toBeNull();
    expect(parseVersionTimestamp('2026-07-19.html')).toBeNull();
    expect(parseVersionTimestamp('.DS_Store')).toBeNull();
  });
});

describe('sortKey', () => {
  test('a UTC name outranks by its parsed instant, not its mtime', () => {
    const key = sortKey({ name: '2026-07-19-14-22-08-431Z.html', mtimeMs: 0 });
    expect(key).toBe(Date.UTC(2026, 6, 19, 14, 22, 8, 431));
  });

  test('a legacy name falls back to mtime', () => {
    expect(sortKey({ name: '2026-07-19-14-22-08-431.html', mtimeMs: 12345 })).toBe(12345);
  });

  test('DST fall-back: the newer legacy version never sorts as the oldest', async () => {
    // Both files claim 01:30 local — the hour that happens twice. A lexical sort
    // ranks them by their millisecond field alone, so the one written SECOND can
    // be ranked first and deleted. mtime keeps them honest.
    const older = { name: '2026-11-01-01-30-00-900.html', mtimeMs: 1000 };
    const newer = { name: '2026-11-01-01-30-00-100.html', mtimeMs: 2000 };

    const lexical = [older, newer].sort((a, b) => b.name.localeCompare(a.name))[0];
    expect(lexical).toBe(older); // the lexical sort gets it wrong

    const byInstant = [older, newer].sort((a, b) => sortKey(b) - sortKey(a))[0];
    expect(byInstant).toBe(newer);
  });
});

// THE REASON THE OFFSET IS NOT OPTIONAL.
//
// Across an autumn fall-back local wall time repeats for an hour. A collision
// suffix cannot rescue that: it only fires when two names are byte-identical,
// and 01:30 EDT and 01:30 EST are the same wall clock in two different offsets.
// This is the delete path, so mis-ranking here destroys data.
describe('DST fall-back with recorded offsets', () => {
  // Written in this real-time order. C is genuinely the newest even though it
  // wears the same wall clock as A.
  const a = { name: '2026-11-01-01-30-00-431-0400.html', mtimeMs: 0 }; // 05:30:00.431Z
  const b = { name: '2026-11-01-01-45-00-123-0400.html', mtimeMs: 0 }; // 05:45:00.123Z
  const c = { name: '2026-11-01-01-30-00-431-0500.html', mtimeMs: 0 }; // 06:30:00.431Z

  test('the three names resolve to their real instants', () => {
    expect(sortKey(a)).toBe(Date.UTC(2026, 10, 1, 5, 30, 0, 431));
    expect(sortKey(b)).toBe(Date.UTC(2026, 10, 1, 5, 45, 0, 123));
    expect(sortKey(c)).toBe(Date.UTC(2026, 10, 1, 6, 30, 0, 431));
  });

  test('newest-first ranks C, B, A', () => {
    expect([a, b, c].sort(compareNewestFirst).map((e) => e.name)).toEqual([
      c.name, b.name, a.name
    ]);
  });

  // The pruner deletes and the guard restores. If they disagreed about which
  // version is newest, the guard would hand back content the pruner had already
  // decided was expendable — so pin them against the same real files.
  test('the pruner and the data-loss guard pick the same newest file', async () => {
    const { _newestVersionPath } = require('../../src/main/data-loss-guard');

    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard-dst-')));
    const siteDir = path.join(base, 'sites-versions', 'notes');
    await fs.mkdir(siteDir, { recursive: true });
    for (const entry of [a, b, c]) {
      await fs.writeFile(path.join(siteDir, entry.name), entry.name);
    }

    const recovered = await _newestVersionPath(base, 'notes.html');
    expect(path.basename(recovered)).toBe(c.name);

    const ranked = [];
    for (const name of await fs.readdir(siteDir)) {
      ranked.push({ name, mtimeMs: (await fs.stat(path.join(siteDir, name))).mtimeMs });
    }
    expect(ranked.sort(compareNewestFirst)[0].name).toBe(path.basename(recovered));

    await fs.rm(base, { recursive: true, force: true });
  });

  test('without the offset the same sequence ranks B as newest, which is wrong', () => {
    // Strip the offsets and the wall clock is all that is left to go on: B's
    // 01:45 outranks both 01:30s, so B looks newest when C is. That is exactly
    // the bug the offset exists to prevent.
    const strip = (name) => name.replace(/[+-]\d{4}(?=(-\d{3})?\.html$)/, '');
    const newestByWallClock = [a, b, c]
      .map((entry) => strip(entry.name))
      .sort((x, y) => y.localeCompare(x))[0];

    expect(newestByWallClock).toBe(strip(b.name));
    // A and C collapse onto one name once the offset is gone, which is why a
    // collision suffix could never have separated them either.
    expect(strip(a.name)).toBe(strip(c.name));
  });
});

describe('collision suffix ordering', () => {
  test('-002 ranks before -010 and breaks ties inside one millisecond', () => {
    const stamp = '2026-11-01-01-30-00-431-0400';
    const entries = [
      { name: `${stamp}-002.html`, mtimeMs: 0 },
      { name: `${stamp}.html`, mtimeMs: 0 },
      { name: `${stamp}-010.html`, mtimeMs: 0 },
      { name: `${stamp}-001.html`, mtimeMs: 0 }
    ];

    // Every one of these is the same instant, so only the suffix orders them.
    expect(new Set(entries.map(sortKey)).size).toBe(1);
    expect(entries.map((e) => collisionSuffix(e.name)).sort((x, y) => x - y))
      .toEqual([0, 1, 2, 10]);

    expect([...entries].sort(compareNewestFirst).map((e) => e.name)).toEqual([
      `${stamp}-010.html`,
      `${stamp}-002.html`,
      `${stamp}-001.html`,
      `${stamp}.html`
    ]);
  });
});

describe('generateTimestamp', () => {
  test('emits local wall time with a signed four-digit offset', () => {
    const stamp = generateTimestamp();
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}[+-]\d{4}$/);
  });

  test('the name round-trips back to the instant it was written at', () => {
    const before = Date.now();
    const stamp = generateTimestamp();
    const after = Date.now();

    const parsed = parseVersionTimestamp(`${stamp}.html`);
    expect(parsed).not.toBeNull();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  // getTimezoneOffset() returns POSITIVE minutes for zones BEHIND UTC — New
  // York in summer returns 240 and must render as `-0400`. Backwards here and
  // every ordering inverts, so pin the sign directly. Node caches the process
  // timezone on first use, so switching process.env.TZ mid-run does not take;
  // stubbing the accessor is the only reading that stays honest on any host.
  describe('the offset sign is inverted from getTimezoneOffset', () => {
    afterEach(() => jest.restoreAllMocks());

    function stampWithOffset(minutes) {
      jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(minutes);
      return generateTimestamp().slice(-5);
    }

    test('a zone BEHIND UTC (positive minutes) renders a NEGATIVE offset', () => {
      expect(stampWithOffset(240)).toBe('-0400'); // America/New_York, summer
      expect(stampWithOffset(480)).toBe('-0800'); // America/Los_Angeles, winter
    });

    test('a zone AHEAD of UTC (negative minutes) renders a POSITIVE offset', () => {
      expect(stampWithOffset(-60)).toBe('+0100');  // Europe/Berlin, winter
      expect(stampWithOffset(-330)).toBe('+0530'); // Asia/Kolkata, half hour
      expect(stampWithOffset(-345)).toBe('+0545'); // Asia/Kathmandu, quarter hour
    });

    test('UTC itself is written +0000, never omitted and never Z', () => {
      expect(stampWithOffset(0)).toBe('+0000');
    });
  });

  test('the wall-clock part really is local, not UTC', () => {
    const stamp = generateTimestamp();
    const local = new Date(parseVersionTimestamp(`${stamp}.html`));
    const p = (n, w = 2) => String(n).padStart(w, '0');

    // Read the name back against the local fields of the instant it encodes,
    // rather than against a second clock reading that could tick over.
    expect(stamp).toBe(
      `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}-` +
      `${p(local.getHours())}-${p(local.getMinutes())}-${p(local.getSeconds())}-` +
      `${p(local.getMilliseconds(), 3)}${stamp.slice(-5)}`
    );
  });
});

describe('pruneSiteVersions', () => {
  let dir;
  const now = Date.UTC(2026, 6, 19, 12, 0, 0, 0);

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // Write a version file whose UTC name encodes `at`, with mtime to match.
  async function writeVersion(at) {
    const d = new Date(at);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const name = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-` +
      `${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-` +
      `${p(d.getUTCMilliseconds(), 3)}Z.html`;
    const full = path.join(dir, name);
    await fs.writeFile(full, `<html>${at}</html>`);
    await fs.utimes(full, new Date(at), new Date(at));
    return name;
  }

  test('keeps everything inside the 60-day window', async () => {
    for (let i = 0; i < 5; i++) await writeVersion(now - i * DAY);

    const { deleted } = await pruneSiteVersions(dir, dir, now);

    expect(deleted).toEqual([]);
    expect((await fs.readdir(dir))).toHaveLength(5);
  });

  test('deletes versions older than 60 days once the 20-floor is satisfied', async () => {
    // The floor is a floor, not a cap: with fewer than 20 files nothing is
    // deleted however old it is. Seed 25 fresh ones so the age rule can bite.
    for (let i = 0; i < 25; i++) await writeVersion(now - i * 60 * 1000);
    const stale = await writeVersion(now - 61 * DAY);

    const { deleted } = await pruneSiteVersions(dir, dir, now);

    expect(deleted).toEqual([stale]);
    expect(await fs.readdir(dir)).toHaveLength(25);
  });

  test('fewer than 20 versions are never deleted, however old', async () => {
    await writeVersion(now - 400 * DAY);
    await writeVersion(now - 401 * DAY);

    const { deleted } = await pruneSiteVersions(dir, dir, now);

    expect(deleted).toEqual([]);
    expect(await fs.readdir(dir)).toHaveLength(2);
  });

  test('always keeps the newest 20 even when all are older than 60 days', async () => {
    for (let i = 0; i < 30; i++) await writeVersion(now - (100 + i) * DAY);

    await pruneSiteVersions(dir, dir, now);

    const left = await fs.readdir(dir);
    expect(left).toHaveLength(KEEP_NEWEST);
  });

  test('retains the UNION of the two rules', async () => {
    // 25 fresh (all inside the window) plus 10 ancient. The union keeps all 25
    // fresh ones, not just 20.
    for (let i = 0; i < 25; i++) await writeVersion(now - i * DAY);
    for (let i = 0; i < 10; i++) await writeVersion(now - (200 + i) * DAY);

    await pruneSiteVersions(dir, dir, now);

    expect(await fs.readdir(dir)).toHaveLength(25);
  });

  test('the 20 it keeps are the NEWEST 20, ranked by instant', async () => {
    const names = [];
    for (let i = 0; i < 30; i++) names.push(await writeVersion(now - (100 + i) * DAY));

    await pruneSiteVersions(dir, dir, now);

    const left = new Set(await fs.readdir(dir));
    // names[0] is the newest, names[29] the oldest.
    for (let i = 0; i < KEEP_NEWEST; i++) expect(left.has(names[i])).toBe(true);
    for (let i = KEEP_NEWEST; i < 30; i++) expect(left.has(names[i])).toBe(false);
  });

  test('legacy local-time names are ranked by mtime, so the newest survives', async () => {
    // Both names claim the same repeated DST hour; only mtime separates them.
    const oldName = '2026-11-01-01-30-00-900.html';
    const newName = '2026-11-01-01-30-00-100.html';
    await fs.writeFile(path.join(dir, oldName), 'OLD');
    await fs.utimes(path.join(dir, oldName), new Date(now - 100 * DAY), new Date(now - 100 * DAY));
    await fs.writeFile(path.join(dir, newName), 'NEW');
    await fs.utimes(path.join(dir, newName), new Date(now - DAY), new Date(now - DAY));

    // Force the 20-floor out of the way so the age rule alone decides.
    for (let i = 0; i < 25; i++) await writeVersion(now - i * 60 * 1000);

    await pruneSiteVersions(dir, dir, now);

    const left = await fs.readdir(dir);
    expect(left).toContain(newName);
    expect(left).not.toContain(oldName);
  });

  test('never touches files it did not write', async () => {
    await fs.writeFile(path.join(dir, 'README.md'), 'notes');
    await fs.writeFile(path.join(dir, 'index.html'), 'not a version name');
    for (let i = 0; i < 30; i++) await writeVersion(now - (100 + i) * DAY);

    await pruneSiteVersions(dir, dir, now);

    const left = await fs.readdir(dir);
    expect(left).toContain('README.md');
    expect(left).toContain('index.html');
  });

  test('a missing directory is not an error', async () => {
    await expect(pruneSiteVersions(dir, path.join(dir, 'nope'), now))
      .resolves.toEqual({ kept: 0, deleted: [] });
  });

  test('MAX_AGE_MS is 60 days', () => {
    expect(MAX_AGE_MS).toBe(60 * DAY);
  });
});

describe('pruneAllVersions', () => {
  let base;
  const now = Date.UTC(2026, 6, 19, 12, 0, 0, 0);

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pruneall-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  async function seed(relDir, ageDays) {
    const dir = path.join(base, 'sites-versions', relDir);
    await fs.mkdir(dir, { recursive: true });
    const at = now - ageDays * DAY;
    const d = new Date(at);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const name = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-` +
      `${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}Z.html`;
    await fs.writeFile(path.join(dir, name), 'x');
    await fs.utimes(path.join(dir, name), new Date(at), new Date(at));
    return path.join(dir, name);
  }

  test('prunes nested site directories', async () => {
    const staleA = await seed('sitea', 200);
    const staleB = await seed('blog/post', 200);
    const fresh = await seed('sitec', 1);

    // Each of those dirs has one file, so the 20-floor keeps it; add enough
    // siblings that the floor is exceeded.
    for (let i = 1; i <= 25; i++) await seed('sitea', 200 + i);
    for (let i = 1; i <= 25; i++) await seed('blog/post', 200 + i);

    const result = await pruneAllVersions(base, now);

    expect(result.sites).toBe(3);
    expect(result.deleted).toBeGreaterThan(0);
    await expect(fs.access(fresh)).resolves.toBeUndefined();
    // The newest of each stale set survives via the 20-floor.
    await expect(fs.access(staleA)).resolves.toBeUndefined();
    await expect(fs.access(staleB)).resolves.toBeUndefined();
  });

  test('a missing sites-versions directory is not an error', async () => {
    await expect(pruneAllVersions(base, now)).resolves.toEqual({ sites: 0, deleted: 0 });
  });
});

// C1: the pruner's containment used to be a lexical prefix check, then the
// destructive readdir/unlink re-resolved the path through whatever symlinks
// existed at use time. A directory symlink planted at sites-versions (or at a
// site subdirectory) therefore redirected the delete out of tree. The chain
// check lstat's every directory component immediately before the delete and
// refuses a symlinked one.
describe('C1: prune refuses a symlinked chain', () => {
  const nodeFs = require('fs');
  let symlinksOk = true;
  try {
    const probe = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'symprobe-'));
    nodeFs.symlinkSync(probe, path.join(probe, 'lnk'));
    nodeFs.rmSync(probe, { recursive: true, force: true });
  } catch {
    symlinksOk = false;
  }
  const symlinkTest = symlinksOk ? test : test.skip;

  let base;
  let outside;
  const now = Date.UTC(2026, 6, 19, 12, 0, 0, 0);

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-c1-')));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-c1-out-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    await fs.rm(outside, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  // `count` long-expired version-shaped files, so a WORKING prune would delete
  // everything past the newest-20 floor (25 -> deletes 5).
  async function seedOldVersions(dir, count) {
    await fs.mkdir(dir, { recursive: true });
    const names = [];
    for (let i = 0; i < count; i++) {
      const at = now - (400 + i) * DAY;
      const d = new Date(at);
      const p = (n, w = 2) => String(n).padStart(w, '0');
      const name = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-` +
        `${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}Z.html`;
      await fs.writeFile(path.join(dir, name), `v${i}`);
      await fs.utimes(path.join(dir, name), new Date(at), new Date(at));
      names.push(name);
    }
    return names;
  }

  symlinkTest('pruneAllVersions leaves a symlinked sites-versions target exactly unchanged', async () => {
    await seedOldVersions(outside, 25);
    await fs.symlink(outside, path.join(base, 'sites-versions'));

    const before = (await fs.readdir(outside)).sort();
    expect(before).toHaveLength(25);

    const result = await pruneAllVersions(base, now);

    // Deletes 5 today; refused entirely with the chain check.
    expect(result).toEqual({ sites: 0, deleted: 0 });
    expect((await fs.readdir(outside)).sort()).toEqual(before);
  });

  symlinkTest('pruneSiteVersions refuses when the site subdirectory is the symlink (the maybePrune path)', async () => {
    // A real sites-versions, but the per-site directory maybePrune targets is a
    // symlink out of tree — exactly the argument backup.js:maybePrune forwards.
    await fs.mkdir(path.join(base, 'sites-versions'), { recursive: true });
    await seedOldVersions(outside, 25);
    const siteVersionsDir = path.join(base, 'sites-versions', 'notes');
    await fs.symlink(outside, siteVersionsDir);

    const before = (await fs.readdir(outside)).sort();
    expect(before).toHaveLength(25);

    const { deleted } = await pruneSiteVersions(base, siteVersionsDir, now);

    expect(deleted).toEqual([]);
    expect((await fs.readdir(outside)).sort()).toEqual(before);
  });
});
