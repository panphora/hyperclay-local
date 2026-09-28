const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyRoot, readRootMarker, writeRootMarker, rootIsEmpty, flagIdentity, markerPath } = require('../../src/sync-engine/root-marker');

let root;
let metaDir;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'root-marker-root-'));
  metaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-marker-meta-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(metaDir, { recursive: true, force: true });
});

describe('the marker file', () => {
  test('write then read round-trips the root id under .hyperclay/', () => {
    writeRootMarker(root, 'root-1', { now: () => Date.parse('2026-09-25T10:00:00.000Z') });
    expect(markerPath(root)).toBe(path.posix.join(root.split(path.sep).join('/'), '.hyperclay', 'sync-root.json'));
    expect(readRootMarker(root)).toEqual({ rootId: 'root-1', createdAt: '2026-09-25T10:00:00.000Z' });
    expect(fs.existsSync(`${markerPath(root)}.tmp`)).toBe(false);
  });

  test('a missing or corrupt marker reads as null', () => {
    expect(readRootMarker(root)).toBeNull();
    fs.mkdirSync(path.join(root, '.hyperclay'));
    fs.writeFileSync(path.join(root, '.hyperclay', 'sync-root.json'), '{not json');
    expect(readRootMarker(root)).toBeNull();
  });
});

describe('rootIsEmpty', () => {
  test('dot entries and OS junk do not count', () => {
    fs.mkdirSync(path.join(root, '.hyperclay'));
    fs.mkdirSync(path.join(root, '.trash'));
    fs.writeFileSync(path.join(root, '.DS_Store'), '');
    fs.writeFileSync(path.join(root, 'Thumbs.db'), '');
    expect(rootIsEmpty(root)).toBe(true);
    fs.writeFileSync(path.join(root, 'board.html'), 'x');
    expect(rootIsEmpty(root)).toBe(false);
  });

  test('an unreadable root reads as empty', () => {
    expect(rootIsEmpty(path.join(root, 'nope'))).toBe(true);
  });
});

describe('classifyRoot', () => {
  const marked = { rootId: 'root-1', required: true, baselineSize: 3 };
  const unmarked = { rootId: 'root-1', required: false, baselineSize: 3 };

  test('no root id means no marker check', () => {
    expect(classifyRoot(root, { rootId: null, required: true, baselineSize: 3 })).toEqual({ refusal: null, adopt: false });
  });

  test('a matching marker passes, even on an empty root', () => {
    writeRootMarker(root, 'root-1');
    expect(classifyRoot(root, marked)).toEqual({ refusal: null, adopt: false });
    expect(classifyRoot(root, unmarked)).toEqual({ refusal: null, adopt: false });
  });

  test('required and absent: empty root is folder-missing, root with files is folder-replaced', () => {
    expect(classifyRoot(root, marked)).toEqual({ refusal: 'folder-missing', adopt: false });
    fs.writeFileSync(path.join(root, 'board.html'), 'x');
    expect(classifyRoot(root, marked)).toEqual({ refusal: 'folder-replaced', adopt: false });
  });

  test('required and another root\'s marker is folder-replaced, empty or not', () => {
    writeRootMarker(root, 'root-2');
    expect(classifyRoot(root, marked)).toEqual({ refusal: 'folder-replaced', adopt: false });
    fs.writeFileSync(path.join(root, 'board.html'), 'x');
    expect(classifyRoot(root, marked)).toEqual({ refusal: 'folder-replaced', adopt: false });
  });

  test('not yet required: a root with files is adopted', () => {
    fs.writeFileSync(path.join(root, 'board.html'), 'x');
    expect(classifyRoot(root, unmarked)).toEqual({ refusal: null, adopt: true });
  });

  test('not yet required: another root\'s marker on a root with files is adopted', () => {
    writeRootMarker(root, 'root-2');
    fs.writeFileSync(path.join(root, 'board.html'), 'x');
    expect(classifyRoot(root, unmarked)).toEqual({ refusal: null, adopt: true });
  });

  test('not yet required: an empty root against a non-empty baseline is folder-missing, not adopted', () => {
    expect(classifyRoot(root, unmarked)).toEqual({ refusal: 'folder-missing', adopt: false });
  });

  test('not yet required: an empty root against an empty baseline is adopted', () => {
    expect(classifyRoot(root, { ...unmarked, baselineSize: 0 })).toEqual({ refusal: null, adopt: true });
  });
});

describe('flagIdentity', () => {
  test('sets rootMarker on an existing identity and keeps the other fields', () => {
    const file = path.join(metaDir, 'identity.json');
    fs.writeFileSync(file, JSON.stringify({ serverUrl: 'https://hyperclay.test', rootId: 'root-1' }));
    expect(flagIdentity(metaDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ serverUrl: 'https://hyperclay.test', rootId: 'root-1', rootMarker: true });
    expect(flagIdentity(metaDir)).toBe(false);
  });

  test('writes nothing when there is no identity', () => {
    expect(flagIdentity(metaDir)).toBe(false);
    expect(fs.existsSync(path.join(metaDir, 'identity.json'))).toBe(false);
    expect(flagIdentity(null)).toBe(false);
  });
});
