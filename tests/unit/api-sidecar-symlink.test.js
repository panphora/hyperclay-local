// A3 consumer migration: every sidecar stat, read, write and unlink must go
// through the canonical resolver, not a lexical path.resolve containment check.
//
// A lexical check passes for BOTH shapes below, because neither URL-level path
// ever leaves the tree on paper. Only canonicalization catches them.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const {
  writeApiSidecarData,
  deleteApiSidecar,
  readFreshSidecar
} = require('../../src/main/utils/api-sidecar');

describe('A3: sidecar operations do not follow symlinks out of the served root', () => {
  let base;
  let outside;

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-base-')));
    outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sidecar-out-')));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // Escape 1: the sidecar FILE is a link to an external file. A lexical check
  // sees `.hyperclay/api/foo.json` inside the tree; fs.stat and fs.readFile
  // follow the link and hand back the external file's mtime and bytes, so
  // `/_/api/foo.html` serves them verbatim.
  describe('a sidecar file symlinked to an external file', () => {
    let secret;

    beforeEach(async () => {
      secret = path.join(outside, 'secret.json');
      await fs.writeFile(secret, '{"secret":"exfiltrated"}');
      await fs.mkdir(path.join(base, '.hyperclay/api'), { recursive: true });
      await fs.symlink(secret, path.join(base, '.hyperclay/api/foo.json'));
    });

    test('readFreshSidecar refuses it instead of returning the external bytes', async () => {
      // mtime 0 means "any sidecar counts as fresh", so only the containment
      // check can stop this.
      expect(await readFreshSidecar(base, 'foo.html', 0)).toBeNull();
    });

    test('a write replaces the link rather than writing through it', async () => {
      await writeApiSidecarData(base, 'foo.html', { ours: true });

      expect(await fs.readFile(secret, 'utf8')).toBe('{"secret":"exfiltrated"}');
      const link = path.join(base, '.hyperclay/api/foo.json');
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(link, 'utf8')).toBe('{"ours":true}');
    });
  });

  // Escape 2: an intermediate DIRECTORY is a link out of tree. `blog/post.html`
  // loses its api tag, cleanup unlinks `.hyperclay/api/blog/post.json`, and the
  // unlink traverses the link and deletes the external file.
  describe('a sidecar directory symlinked to an external directory', () => {
    let external;

    beforeEach(async () => {
      external = path.join(outside, 'post.json');
      await fs.writeFile(external, '{"external":true}');
      await fs.mkdir(path.join(base, '.hyperclay/api'), { recursive: true });
      await fs.symlink(outside, path.join(base, '.hyperclay/api/blog'));
    });

    test('deleteApiSidecar does not unlink the external file', async () => {
      await deleteApiSidecar(base, 'blog/post.html');
      expect(await fs.readFile(external, 'utf8')).toBe('{"external":true}');
    });

    test('the null-data delete path does not unlink it either', async () => {
      await writeApiSidecarData(base, 'blog/post.html', null);
      expect(await fs.readFile(external, 'utf8')).toBe('{"external":true}');
    });

    test('a write through the linked directory is refused', async () => {
      await writeApiSidecarData(base, 'blog/post.html', { ours: true });
      expect(await fs.readFile(external, 'utf8')).toBe('{"external":true}');
    });

    test('the freshness read does not reach through it', async () => {
      expect(await readFreshSidecar(base, 'blog/post.html', 0)).toBeNull();
    });
  });

  test('ordinary in-tree sidecars are untouched by the containment checks', async () => {
    await writeApiSidecarData(base, 'blog/post.html', { title: 'Hi' });

    const written = path.join(base, '.hyperclay/api/blog/post.json');
    const stat = await fs.stat(written);
    expect(await readFreshSidecar(base, 'blog/post.html', stat.mtimeMs)).toBe('{"title":"Hi"}');

    await deleteApiSidecar(base, 'blog/post.html');
    await expect(fs.access(written)).rejects.toThrow();
  });
});
