const { makeIsKnownPath } = require('../../src/main/utils/known-path');

function buildFs({ exists = true, throws = false } = {}) {
  return {
    existsSync: jest.fn((_p) => {
      if (throws) throw new Error('boom');
      return exists;
    })
  };
}

function buildSync({ isRunning = true, knownPaths = [] } = {}) {
  const map = new Map(knownPaths.map((p, i) => [String(i + 1), { path: p }]));
  return {
    isRunning,
    repo: {
      getByPath: jest.fn((rel) => {
        for (const [nid, entry] of map) {
          if (entry.path === rel) return { nodeId: nid, entry };
        }
        return null;
      })
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
});
