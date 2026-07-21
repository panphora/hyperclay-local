// A7: createBackup used to build its filename from generateTimestamp() alone and
// write it with a plain fs.writeFile — no exclusive-creation flag, no collision
// suffix. Two backups in the same millisecond meant the second silently
// overwrote the first. Reproduced on the shipped build: 11 rapid saves produced
// 10 version files.
//
// Freezing the clock turns "sometimes collides" into "always collides", so these
// assert the guarantee rather than sampling for it.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { createBackup, createBinaryBackup, generateTimestamp } = require('../../src/main/utils/backup');
const { pruneSiteVersions, compareNewestFirst, parseVersionTimestamp } = require('../../src/main/utils/prune-versions');

describe('A7: backup filename collisions', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'backup-burst-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // Fake ONLY the clock. Faking the timer functions too would stall the fs
  // promises these backups are made of.
  function freezeClock() {
    jest.useFakeTimers({
      now: new Date('2026-07-19T14:22:08.431Z'),
      doNotFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
        'performance', 'requestAnimationFrame', 'cancelAnimationFrame'
      ]
    });
  }

  test('11 saves in the same millisecond produce 11 version files', async () => {
    freezeClock();

    for (let i = 0; i < 11; i++) {
      await createBackup(dir, 'my-site', `<html>version ${i}</html>`);
    }

    const files = (await fs.readdir(path.join(dir, 'sites-versions', 'my-site'))).sort();
    expect(files).toHaveLength(11);

    // Every version survived, none overwrote another.
    const bodies = await Promise.all(
      files.map((f) => fs.readFile(path.join(dir, 'sites-versions', 'my-site', f), 'utf8'))
    );
    expect(new Set(bodies).size).toBe(11);
  });

  test('11 concurrent saves also produce 11 version files', async () => {
    freezeClock();

    await Promise.all(
      Array.from({ length: 11 }, (_, i) => createBackup(dir, 'my-site', `<html>concurrent ${i}</html>`))
    );

    const files = await fs.readdir(path.join(dir, 'sites-versions', 'my-site'));
    expect(files).toHaveLength(11);
  });

  test('the collision suffix is zero-padded, so -002 sorts before -010', async () => {
    freezeClock();

    for (let i = 0; i < 12; i++) {
      await createBackup(dir, 'my-site', `<html>version ${i}</html>`);
    }

    // Names are local time plus offset, so derive the stamp from the frozen
    // clock rather than hard-coding one machine's zone.
    const stamp = generateTimestamp();
    const files = (await fs.readdir(path.join(dir, 'sites-versions', 'my-site'))).sort();

    expect(files).toContain(`${stamp}.html`);
    expect(files).toContain(`${stamp}-001.html`);
    expect(files).toContain(`${stamp}-011.html`);
    // Zero-padded to three digits, which is the whole point: unpadded, "-10"
    // sorts between "-1" and "-2" and the pruner deletes the wrong file.
    expect(files).not.toContain(`${stamp}-1.html`);
    expect(files).not.toContain(`${stamp}-11.html`);

    // Among the suffixed names a lexical sort agrees with the numeric one, so
    // any consumer that sorts names still gets the write order.
    const suffixed = files.filter((f) => /-\d{3}\.html$/.test(f));
    expect(suffixed).toHaveLength(11);
    const numeric = suffixed.map((f) => Number(/-(\d{3})\.html$/.exec(f)[1]));
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });

  test('binary backups collide-protect the same way', async () => {
    freezeClock();

    for (let i = 0; i < 5; i++) {
      await createBinaryBackup(dir, 'images/logo.png', Buffer.from([i]));
    }

    const files = await fs.readdir(path.join(dir, 'sites-versions', 'images', 'logo'));
    expect(files).toHaveLength(5);
    expect(files.every((f) => f.endsWith('.png'))).toBe(true);
  });
});

describe('A7: the pruner handles collision-suffixed names', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-suffix-')));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a suffixed name is recognised as a version, not left untouched forever', () => {
    // The pruner refuses to delete anything it does not recognise, so failing to
    // parse the suffixed form would let those versions accumulate without bound.
    expect(parseVersionTimestamp('2026-07-19-14-22-08-431Z-002.html'))
      .toBe(Date.UTC(2026, 6, 19, 14, 22, 8, 431));
  });

  test('same-millisecond versions are ranked newest-first by their suffix', () => {
    const entries = [
      { name: '2026-07-19-14-22-08-431Z-002.html', mtimeMs: 0 },
      { name: '2026-07-19-14-22-08-431Z.html', mtimeMs: 0 },
      { name: '2026-07-19-14-22-08-431Z-010.html', mtimeMs: 0 },
      { name: '2026-07-19-14-22-08-431Z-001.html', mtimeMs: 0 }
    ];

    expect([...entries].sort(compareNewestFirst).map((e) => e.name)).toEqual([
      '2026-07-19-14-22-08-431Z-010.html',
      '2026-07-19-14-22-08-431Z-002.html',
      '2026-07-19-14-22-08-431Z-001.html',
      '2026-07-19-14-22-08-431Z.html'
    ]);
  });

  test('a same-millisecond burst is pruned down to the newest 20, keeping the newest', async () => {
    const siteDir = path.join(dir, 'sites-versions', 'burst');
    await fs.mkdir(siteDir, { recursive: true });

    // 25 versions in one long-expired millisecond: past the 60-day window, so
    // only the "newest 20" rule protects anything.
    const stamp = '2020-01-01-00-00-00-000Z';
    await fs.writeFile(path.join(siteDir, `${stamp}.html`), 'v0');
    for (let i = 1; i < 25; i++) {
      await fs.writeFile(path.join(siteDir, `${stamp}-${String(i).padStart(3, '0')}.html`), `v${i}`);
    }

    const { deleted } = await pruneSiteVersions(dir, siteDir);

    const left = await fs.readdir(siteDir);
    expect(left).toHaveLength(20);
    expect(deleted).toHaveLength(5);

    // The newest (highest suffix) must survive; the oldest must be the ones cut.
    expect(left).toContain(`${stamp}-024.html`);
    expect(left).toContain(`${stamp}-005.html`);
    expect(left).not.toContain(`${stamp}.html`);
    expect(left).not.toContain(`${stamp}-004.html`);
  });
});
