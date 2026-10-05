# Ferry lock snapshot fixture

Byte-for-byte copies of two modules from the Ferry source repository, taken at the
source HEAD recorded below:

- `/Users/davidmiranda/Documents/GitHub/ferry-v2/src/core/lock.js`
- `/Users/davidmiranda/Documents/GitHub/ferry-v2/src/core/paths.js`

Source HEAD at copy time (read only, not part of this repository):
`0b987849245f3830d3ed50af9d09db34e0513c9f`

SHA256:

- `lock.js`: `f4fde4db5456553d88928ee209fd7fa3d55f78a16ffa4a9458f0065cbaa53ceb`
- `paths.js`: `9caee85279d7f3eb787041ae230fc6bff18966d8d50c1b1a4c89b31307186a10`

Purpose: `tests/unit/release-ferry.test.js` exercises the release coordination path
against a snapshot of Ferry's installed lock API contract at the version above, so
the real copied lock proof does not require Ferry (or a developer PATH, home
directory or sibling checkout) to exist on the test runner. Each test copies these
files into a temporary synthetic package with a minimal `config.js`, and points
`FERRY_ROOT` / `FERRY_STATE_DIR` at the fixture's own directories. Production still
loads the installed Ferry dynamically through the default `loadModules` in
`scripts/release-ferry.js`; nothing in this directory is shipped or run against a
real Ferry installation.

`tests/unit/release-ferry.test.js` pins both hashes and the copies recorded here, so
silently replacing a snapshot file with a toy stub fails the suite.
