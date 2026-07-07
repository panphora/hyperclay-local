/**
 * Behavior of the two logic-bearing inline scripts on the marketing page:
 *   1. OS-aware download button (UA sniffing -> clone the matching download row)
 *   2. Light/dark theme toggle (follow-OS-until-click, persist, sync a11y state)
 *
 * The *actual* script text is extracted from index.html and run against a tiny
 * recording DOM, so these tests exercise the shipped code. Download data (hrefs,
 * version) comes from the real markup, so a passing test also proves the button
 * href is cloned from the source-of-truth list rather than hardcoded.
 */

const {
  inlineScriptContaining,
  runScript,
  realDownloadData,
  makeDownloadDom,
  makeThemeDom,
  makeStorage,
  makeMatchMedia,
} = require('./harness');

// --------------------------------------------------------------------------
// Download detection
// --------------------------------------------------------------------------

describe('download button: OS detection', () => {
  const script = inlineScriptContaining('#downloads is the single source of truth');
  const { version, hrefs } = realDownloadData();

  function run(navigator) {
    const { document, els } = makeDownloadDom({ version, hrefs });
    runScript(script, { document, navigator });
    return els;
  }

  const UA = {
    macArm: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    unknown: 'SomeBot/1.0 (+http://example.com/bot)',
  };

  test('macOS defaults to the Apple Silicon build, cloned from the download row', () => {
    const els = run({ userAgent: UA.macArm });
    expect(els.btn.href).toBe(hrefs['mac-arm']);
    expect(els.btn.hasAttribute('download')).toBe(true);
    expect(els.text.textContent).toBe('Download for macOS (Apple Silicon)');
    expect(els.sub.innerHTML).toContain(hrefs['mac-intel']); // offers the Intel build
  });

  test('macOS reporting an x86 CPU switches to the Intel build (best effort)', async () => {
    const navigator = {
      userAgent: UA.macArm,
      userAgentData: { getHighEntropyValues: () => Promise.resolve({ architecture: 'x86' }) },
    };
    const els = run(navigator);
    await new Promise((r) => setImmediate(r)); // let the getHighEntropyValues promise resolve
    expect(els.btn.href).toBe(hrefs['mac-intel']);
    expect(els.text.textContent).toBe('Download for macOS (Intel)');
    expect(els.sub.innerHTML).toContain(hrefs['mac-arm']); // now offers Apple Silicon
  });

  test('iPhone is not treated as macOS: falls back to the download list', () => {
    const els = run({ userAgent: UA.iphone });
    expect(els.btn.href).toBe('#downloads');
    expect(els.btn.hasAttribute('download')).toBe(false);
    expect(els.text.textContent).toBe('Download');
  });

  test('Windows gets the Windows installer', () => {
    const els = run({ userAgent: UA.windows });
    expect(els.btn.href).toBe(hrefs.windows);
    expect(els.text.textContent).toBe('Download for Windows');
    expect(els.btn.hasAttribute('download')).toBe(true);
  });

  test('desktop Linux gets the AppImage', () => {
    const els = run({ userAgent: UA.linux });
    expect(els.btn.href).toBe(hrefs.linux);
    expect(els.text.textContent).toBe('Download for Linux');
  });

  test('Android is not treated as desktop Linux: falls back to the list', () => {
    const els = run({ userAgent: UA.android });
    expect(els.btn.href).toBe('#downloads');
    expect(els.btn.hasAttribute('download')).toBe(false);
  });

  test('unknown platform falls back to the list with no forced download', () => {
    const els = run({ userAgent: UA.unknown });
    expect(els.btn.href).toBe('#downloads');
    expect(els.btn.hasAttribute('download')).toBe(false);
    expect(els.text.textContent).toBe('Download');
  });

  test('version tag renders v<version> from data-version', () => {
    const els = run({ userAgent: UA.windows });
    expect(els.tag.textContent).toBe('v' + version);
  });
});

// --------------------------------------------------------------------------
// Theme toggle
// --------------------------------------------------------------------------

describe('theme toggle', () => {
  const script = inlineScriptContaining('First click flips away from what is shown now');

  function run({ osDark = false, rootClasses = [], storage = {} } = {}) {
    const { document, els } = makeThemeDom({ rootClasses });
    const localStorage = makeStorage(storage);
    const matchMedia = makeMatchMedia(osDark);
    runScript(script, { document, localStorage, matchMedia });
    return { els, localStorage, matchMedia };
  }

  test('with no stored choice, the initial icon follows the OS and storage stays untouched', () => {
    const { els, localStorage } = run({ osDark: true }); // OS = dark, nothing saved
    expect(els.btn.getAttribute('aria-pressed')).toBe('true');
    expect(els.sun.hidden).toBe(false); // dark mode shows the sun (what you'd switch to)
    expect(els.moon.hidden).toBe(true);
    expect(localStorage.dump()).not.toHaveProperty('hcl-theme'); // never writes on load
  });

  test('first click flips away from the effective mode and persists it', () => {
    const { els, localStorage } = run({ osDark: true }); // effective = dark
    els.btn.dispatch('click');
    expect(els.root.classList.contains('light')).toBe(true);
    expect(els.root.classList.contains('dark')).toBe(false);
    expect(localStorage.dump()['hcl-theme']).toBe('light');
    expect(els.btn.getAttribute('aria-pressed')).toBe('false');
    expect(els.sun.hidden).toBe(true);
    expect(els.moon.hidden).toBe(false);
  });

  test('a stored choice overrides the OS preference', () => {
    // Flash guard already put .light on <html>; OS says dark, but stored wins.
    const { els } = run({ osDark: true, rootClasses: ['light'], storage: { 'hcl-theme': 'light' } });
    expect(els.btn.getAttribute('aria-pressed')).toBe('false'); // light, not OS dark
    els.btn.dispatch('click'); // flips to dark
    expect(els.root.classList.contains('dark')).toBe(true);
  });

  test('setMode never leaves both mode classes on the root at once', () => {
    const { els } = run({ osDark: false });
    els.btn.dispatch('click'); // -> dark
    els.btn.dispatch('click'); // -> light
    expect(els.root.classList.toArray().filter((c) => c === 'light' || c === 'dark')).toEqual(['light']);
  });

  test('while following the OS, an OS theme change updates the icon', () => {
    const { els, matchMedia } = run({ osDark: false }); // no stored choice
    expect(els.btn.getAttribute('aria-pressed')).toBe('false');
    matchMedia.set(true); // OS flips to dark
    expect(els.btn.getAttribute('aria-pressed')).toBe('true');
  });

  test('once a choice is stored, OS changes no longer move the icon', () => {
    const { els, matchMedia } = run({ osDark: false });
    els.btn.dispatch('click'); // stores 'dark'
    expect(els.btn.getAttribute('aria-pressed')).toBe('true');
    matchMedia.set(false); // OS flips to light, but the user chose dark
    expect(els.btn.getAttribute('aria-pressed')).toBe('true'); // unchanged
  });
});
