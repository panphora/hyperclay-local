// E1a: the test preload hook in main.js is unpackaged-only and fire early. It
// must sit after the `if (isDev)` block and before the first read of the
// userData path and before the single-instance lock, or the suite's temp
// userData and pinned server arrive too late to matter.
const fs = require('fs');
const path = require('path');

const MAIN = path.resolve(__dirname, '../../src/main/main.js');
// A Windows checkout has CRLF line endings; the positions below are compared on LF text.
const source = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');

function at(needle) {
  const index = source.indexOf(needle);
  if (index === -1) throw new Error(`src/main/main.js no longer contains: ${needle}`);
  return index;
}

function lineAt(index) {
  return source.slice(source.lastIndexOf('\n', index - 1) + 1, source.indexOf('\n', index));
}

const HOOK = at('if (isDev && process.env.HYPERCLAY_TEST_PRELOAD) {');
const HOOK_REQUIRE = at('require(process.env.HYPERCLAY_TEST_PRELOAD);');

const DEV_BLOCK_START = at('if (isDev) {');
const DEV_BLOCK_END = source.indexOf('\n}\n', DEV_BLOCK_START);

// The `app.getPath('userData')` inside `app.setPath` establishes the path; every
// other mention reads it.
const reads = [...source.matchAll(/app\.getPath\('userData'\)/g)]
  .map((match) => match.index)
  .filter((index) => !lineAt(index).includes('app.setPath('));

describe('main.js test preload hook', () => {
  it('loads the preload named by HYPERCLAY_TEST_PRELOAD', () => {
    expect(HOOK_REQUIRE).toBeGreaterThan(HOOK);
    expect(lineAt(HOOK_REQUIRE)).toBe("  require(process.env.HYPERCLAY_TEST_PRELOAD);");
  });

  it('is guarded by isDev, so packaged builds never load it', () => {
    expect(lineAt(HOOK)).toContain('isDev &&');
  });

  it('sits after the if (isDev) block that sets the -dev userData path', () => {
    expect(DEV_BLOCK_END).toBeGreaterThan(DEV_BLOCK_START);
    expect(HOOK).toBeGreaterThan(DEV_BLOCK_END);
  });

  it('runs before anything reads the userData path', () => {
    expect(reads.length).toBeGreaterThan(0);
    expect(HOOK).toBeLessThan(reads[0]);
  });

  it('runs before the single-instance lock', () => {
    expect(HOOK).toBeLessThan(at('app.requestSingleInstanceLock()'));
  });
});
