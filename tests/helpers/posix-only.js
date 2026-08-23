// A few guarantees this app relies on are POSIX filesystem guarantees, not portable
// ones. Windows has no POSIX permission bits, refuses to rename over a file another
// handle holds open, ignores O_NOFOLLOW, and rejects filenames containing the
// characters NTFS reserves. Tests pinning those describe real behavior on macOS and
// Linux and describe nothing at all on Windows.
//
// They are skipped there rather than deleted or loosened: the guarantee still holds
// on the platforms that can offer it, and weakening the assertion to something true
// everywhere would quietly stop testing the thing worth testing. Each call site says
// which platform difference applies.
const isWindows = process.platform === 'win32';

module.exports = {
  isWindows,
  describePosix: isWindows ? describe.skip : describe,
  testPosix: isWindows ? test.skip : test,
};
