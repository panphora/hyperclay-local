const { makeIsKnownPath } = require('../../src/main/utils/known-path');

function buildFs({ exists = true, throws = false } = {}) {
  return {
    existsSync: jest.fn((_p) => {
      if (throws) throw new Error('boom');
      return exists;
    })
  };
}

function buildSync({ isRunning = true, knownPaths = [], tombstones = [] } = {}) {
  const map = new Map(knownPaths.map((p, i) => [String(i + 1), { path: p }]));
  const tomb = new Set(tombstones);
  return {
    isRunning,
    repo: {
      getByPath: jest.fn((rel) => {
        for (const [nid, entry] of map) {
          if (entry.path === rel) return { nodeId: nid, entry };
        }
        return null;
      }),
      isTombstoned: jest.fn((p) => tomb.has(p))
    }
  };
}

describe('makeIsKnownPath', () => {
  test('allows save when sync engine is not running', () => {
    const isKnown = makeIsKnownPath(buildSync({ isRunning: false }), buildFs({ exists: true }));
    expect(isKnown('renamed.html', '/sync/renamed.html')).toBe(true);
  });

  test('allows save when file does not yet exist on disk (first write)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: [] }),
      buildFs({ exists: false })
    );
    expect(isKnown('new.html', '/sync/new.html')).toBe(true);
  });

  test('allows save when path is tracked in repo', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: ['site.html'] }),
      buildFs({ exists: true })
    );
    expect(isKnown('site.html', '/sync/site.html')).toBe(true);
  });

  test('blocks save when sync running, file exists on disk, but path not in repo (stale path)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: ['b/stale.html'] }),
      buildFs({ exists: true })
    );
    expect(isKnown('a/stale.html', '/sync/a/stale.html')).toBe(false);
  });

  test('allows save when fs.existsSync throws (treat as new file)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: [] }),
      buildFs({ throws: true })
    );
    expect(isKnown('weird.html', '/sync/weird.html')).toBe(true);
  });

  test('allows save when sync engine reference is missing', () => {
    const isKnown = makeIsKnownPath(null, buildFs({ exists: true }));
    expect(isKnown('any.html', '/sync/any.html')).toBe(true);
  });

  // Stale tab after a real `mv`: the old path is gone from disk AND from the repo,
  // but tombstoned so we remember it was there. Without the tombstone check, the
  // absent file would look identical to a genuinely-new-file save and be allowed,
  // creating a ghost node at the old URL.
  test('blocks save when path is tombstoned and file is gone from disk (stale tab after mv)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: ['b/stale.html'], tombstones: ['a/stale.html'] }),
      buildFs({ exists: false })
    );
    expect(isKnown('a/stale.html', '/sync/a/stale.html')).toBe(false);
  });

  test('blocks save when path is tombstoned even if a file still exists on disk', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: ['b/stale.html'], tombstones: ['a/stale.html'] }),
      buildFs({ exists: true })
    );
    expect(isKnown('a/stale.html', '/sync/a/stale.html')).toBe(false);
  });

  test('allows save when tombstone absent and file not on disk (genuinely new file)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: [], tombstones: [] }),
      buildFs({ exists: false })
    );
    expect(isKnown('new-page.html', '/sync/new-page.html')).toBe(true);
  });

  test('tracked path wins over tombstone check (defensive — tombstone should have been cleared)', () => {
    const isKnown = makeIsKnownPath(
      buildSync({ isRunning: true, knownPaths: ['x.html'], tombstones: ['x.html'] }),
      buildFs({ exists: true })
    );
    expect(isKnown('x.html', '/sync/x.html')).toBe(true);
  });
});
