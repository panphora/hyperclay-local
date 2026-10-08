// On macOS /usr/bin/git is the Xcode shim, which resolves the real binary through xcrun on every
// call and serializes across jest workers: measured 155 ms a call with nine workers, against 19 ms
// for the real binary. A globalSetup, so the PATH is set before jest starts its workers and every
// child process inherits it, not only the ones a test hands { ...process.env }. The PATH entry is a
// directory holding only a git symlink: Xcode's own bin directory would also shadow python3.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = () => {
  if (process.platform !== 'darwin') return;
  let git;
  try {
    git = execFileSync('/usr/bin/xcrun', ['-f', 'git'], { encoding: 'utf8' }).trim();
  } catch {
    return;
  }
  const dir = path.join(os.tmpdir(), 'hyperclay-local-real-git');
  const link = path.join(dir, 'git');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let current = null;
  try { current = fs.readlinkSync(link); } catch {}
  if (current !== git) {
    fs.rmSync(link, { force: true });
    try { fs.symlinkSync(git, link); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
};
