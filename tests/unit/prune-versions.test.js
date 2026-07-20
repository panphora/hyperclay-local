const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const {
  MAX_AGE_MS,
  KEEP_NEWEST,
  parseVersionTimestamp,
  sortKey,
  pruneSiteVersions,
  pruneAllVersions
} = require('../../src/main/utils/prune-versions');

const DAY = 24 * 60 * 60 * 1000;

describe('parseVersionTimestamp', () => {
  test('parses a UTC name as UTC', () => {
    expect(parseVersionTimestamp('2026-07-19-14-22-08-431Z.html'))
      .toBe(Date.UTC(2026, 6, 19, 14, 22, 8, 431));
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

    const { deleted } = await pruneSiteVersions(dir, now);

    expect(deleted).toEqual([]);
    expect((await fs.readdir(dir))).toHaveLength(5);
  });

  test('deletes versions older than 60 days once the 20-floor is satisfied', async () => {
    // The floor is a floor, not a cap: with fewer than 20 files nothing is
    // deleted however old it is. Seed 25 fresh ones so the age rule can bite.
    for (let i = 0; i < 25; i++) await writeVersion(now - i * 60 * 1000);
    const stale = await writeVersion(now - 61 * DAY);

    const { deleted } = await pruneSiteVersions(dir, now);

    expect(deleted).toEqual([stale]);
    expect(await fs.readdir(dir)).toHaveLength(25);
  });

  test('fewer than 20 versions are never deleted, however old', async () => {
    await writeVersion(now - 400 * DAY);
    await writeVersion(now - 401 * DAY);

    const { deleted } = await pruneSiteVersions(dir, now);

    expect(deleted).toEqual([]);
    expect(await fs.readdir(dir)).toHaveLength(2);
  });

  test('always keeps the newest 20 even when all are older than 60 days', async () => {
    for (let i = 0; i < 30; i++) await writeVersion(now - (100 + i) * DAY);

    await pruneSiteVersions(dir, now);

    const left = await fs.readdir(dir);
    expect(left).toHaveLength(KEEP_NEWEST);
  });

  test('retains the UNION of the two rules', async () => {
    // 25 fresh (all inside the window) plus 10 ancient. The union keeps all 25
    // fresh ones, not just 20.
    for (let i = 0; i < 25; i++) await writeVersion(now - i * DAY);
    for (let i = 0; i < 10; i++) await writeVersion(now - (200 + i) * DAY);

    await pruneSiteVersions(dir, now);

    expect(await fs.readdir(dir)).toHaveLength(25);
  });

  test('the 20 it keeps are the NEWEST 20, ranked by instant', async () => {
    const names = [];
    for (let i = 0; i < 30; i++) names.push(await writeVersion(now - (100 + i) * DAY));

    await pruneSiteVersions(dir, now);

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

    await pruneSiteVersions(dir, now);

    const left = await fs.readdir(dir);
    expect(left).toContain(newName);
    expect(left).not.toContain(oldName);
  });

  test('never touches files it did not write', async () => {
    await fs.writeFile(path.join(dir, 'README.md'), 'notes');
    await fs.writeFile(path.join(dir, 'index.html'), 'not a version name');
    for (let i = 0; i < 30; i++) await writeVersion(now - (100 + i) * DAY);

    await pruneSiteVersions(dir, now);

    const left = await fs.readdir(dir);
    expect(left).toContain('README.md');
    expect(left).toContain('index.html');
  });

  test('a missing directory is not an error', async () => {
    await expect(pruneSiteVersions(path.join(dir, 'nope'), now))
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
