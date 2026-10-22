const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const {
  pageStatePath,
  readPageState,
  writePageState,
  dropPageState,
  movePageState
} = require('../../src/main/page-state-store');

describe('page state sidecar store', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-state-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('reading a missing record returns null', async () => {
    await expect(readPageState(dir, 'notes.html')).resolves.toBeNull();
  });

  test('write then read returns the record beside the served file', async () => {
    await writePageState(dir, 'notes.html', { rev: 'r1', tag: '<script merge="page"></script>' });
    await expect(readPageState(dir, 'notes.html')).resolves.toEqual({
      v: 1,
      rev: 'r1',
      tag: '<script merge="page"></script>'
    });
    const file = path.join(dir, '.hyperclay', 'page-state', 'notes.json');
    const text = await fs.readFile(file, 'utf8');
    expect(JSON.parse(text)).toEqual({ v: 1, rev: 'r1', tag: '<script merge="page"></script>' });
  });

  test('a nested name keeps its subdirectories', async () => {
    await writePageState(dir, 'a/b/c.htmlclay', { rev: 'r2', tag: 't' });
    const file = path.join(dir, '.hyperclay', 'page-state', 'a', 'b', 'c.json');
    await expect(fs.readFile(file, 'utf8')).resolves.toBe(JSON.stringify({ v: 1, rev: 'r2', tag: 't' }));
  });

  test('corrupt JSON reads as null', async () => {
    const file = pageStatePath(dir, 'notes.html');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');
    await expect(readPageState(dir, 'notes.html')).resolves.toBeNull();
  });

  test('a record missing tag reads as null', async () => {
    const file = pageStatePath(dir, 'notes.html');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ v: 1, rev: 'r1' }));
    await expect(readPageState(dir, 'notes.html')).resolves.toBeNull();
  });

  test('drop removes the record and tolerates a missing one', async () => {
    await writePageState(dir, 'notes.html', { rev: 'r1', tag: 't' });
    await dropPageState(dir, 'notes.html');
    await expect(readPageState(dir, 'notes.html')).resolves.toBeNull();
    await expect(dropPageState(dir, 'notes.html')).resolves.toBeUndefined();
  });

  test('move renames the record and tolerates a missing one', async () => {
    await writePageState(dir, 'notes.html', { rev: 'r1', tag: 't' });
    await movePageState(dir, 'notes.html', 'renamed.html');
    await expect(readPageState(dir, 'notes.html')).resolves.toBeNull();
    await expect(readPageState(dir, 'renamed.html')).resolves.toEqual({ v: 1, rev: 'r1', tag: 't' });
    await expect(movePageState(dir, 'gone.html', 'other.html')).resolves.toBeUndefined();
  });

  test('a name that leaves the page-state folder throws', () => {
    expect(() => pageStatePath(dir, '../escape.html')).toThrow('Page state path escapes base directory');
    expect(() => pageStatePath(dir, '../guard/notes.html')).toThrow('Page state path escapes base directory');
    expect(() => pageStatePath(dir, '../../../escape.html')).toThrow('Page state path escapes base directory');
  });
});
