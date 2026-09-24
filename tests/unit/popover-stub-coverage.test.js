// C4 §6.4: the screenshot tooling's electronAPI stub must stay a superset of the real
// preload, or a popover change that starts calling a new method would silently no-op
// in the marketing captures. Requiring the engine must not launch a browser.
const { assertStubCoversPreload, preloadMethodNames } = require('../../scripts/screenshot-popover');

describe('screenshot popover stub', () => {
  test('covers every method src/main/popover-preload.js exposes', () => {
    expect(() => assertStubCoversPreload()).not.toThrow();
  });

  test('preloadMethodNames collects more than 20 methods', () => {
    expect(preloadMethodNames().size).toBeGreaterThan(20);
  });
});
