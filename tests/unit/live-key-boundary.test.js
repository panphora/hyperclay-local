// The live-sync channel key belongs to the root, not to the process. Every key
// is built in one place (src/main/utils/root-live.js) so two roots holding the
// same file name can never share a channel; a second module reaching for
// livesync-hyperclay directly would silently break that. Reads the tree itself
// (not a shell out to ripgrep) so the guard cannot pass by enumerating nothing.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ALLOWED = path.join('src', 'main', 'utils', 'root-live.js');
const EXTENSIONS = new Set(['.js', '.cjs', '.jsx']);

function collectFiles(dir, found = []) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) collectFiles(full, found);
    else if (EXTENSIONS.has(path.extname(dirent.name))) found.push(full);
  }
  return found;
}

describe('live-sync key boundary', () => {
  it('reaches livesync-hyperclay from root-live.js and nowhere else', () => {
    const files = collectFiles(SRC_ROOT);
    console.log(`[live-key-boundary] scanned ${files.length} files under src/`);
    expect(files.length).toBeGreaterThan(50);

    const offenders = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('liveSync.')) offenders.push(path.relative(REPO_ROOT, file));
    }

    expect(offenders).toEqual([ALLOWED]);
  });
});
