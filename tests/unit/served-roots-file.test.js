const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { servedRootsPath, writeServedRoots, removeServedRoots } = require('../../src/main/served-roots-file');

describe('served-roots file', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'served-roots-')));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  const read = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

  test('writes v1, pid, realpaths and ports', async () => {
    const realDir = path.join(dir, 'team');
    await fs.mkdir(realDir);
    const linkDir = path.join(dir, 'team-link');
    await fs.symlink(realDir, linkDir);

    const filePath = servedRootsPath(dir);
    await writeServedRoots(filePath, [{ path: linkDir, port: 5432 }]);

    const body = await read(filePath);
    expect(body.v).toBe(1);
    expect(body.pid).toBe(process.pid);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
    expect(body.roots).toEqual([{ path: realDir, port: 5432 }]);
  });

  test('rewrites atomically: a reader never sees a partial file', async () => {
    const filePath = servedRootsPath(dir);
    await writeServedRoots(filePath, [{ path: dir, port: 1001 }]);
    expect((await read(filePath)).roots).toHaveLength(1);

    const seen = [];
    const reader = (async () => {
      for (let i = 0; i < 100; i++) {
        seen.push((await read(filePath)).roots.length);
      }
    })();
    await writeServedRoots(filePath, [{ path: dir, port: 1001 }, { path: dir, port: 1002 }]);
    await reader;

    expect((await read(filePath)).roots).toHaveLength(2);
    expect(seen.every((count) => count === 1 || count === 2)).toBe(true);
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('removeServedRoots deletes only a file this process wrote', async () => {
    const filePath = servedRootsPath(dir);
    await fs.writeFile(filePath, JSON.stringify({ v: 1, pid: process.pid + 1, updatedAt: new Date().toISOString(), roots: [] }));

    removeServedRoots(filePath);
    await expect(fs.access(filePath)).resolves.toBeUndefined();

    await writeServedRoots(filePath, [{ path: dir, port: 1001 }]);
    removeServedRoots(filePath);
    await expect(fs.access(filePath)).rejects.toThrow();

    expect(() => removeServedRoots(filePath)).not.toThrow();
  });

  test('skips a root whose path does not exist and writes the others', async () => {
    const filePath = servedRootsPath(dir);
    await writeServedRoots(filePath, [
      { path: path.join(dir, 'gone'), port: 1001 },
      { path: dir, port: 5432 }
    ]);

    const body = await read(filePath);
    expect(body.roots).toEqual([{ path: dir, port: 5432 }]);
  });
});
