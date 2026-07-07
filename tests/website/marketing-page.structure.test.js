/**
 * Static structure and cross-reference invariants for the hyperclaylocal.com
 * marketing page. These lock the contracts that release tooling, the OS-aware
 * download button, screen readers, the live sap demos, and social scrapers all
 * depend on. No behavior is executed here (see marketing-page.behavior.test.js
 * for that); everything is asserted against the parsed markup with cheerio.
 */

const fs = require('fs');
const path = require('path');
const { load, readPage, WEBSITE_DIR } = require('./harness');

const html = readPage();
const $ = load();

const DOWNLOAD_HOST = 'https://local.hyperclay.com/';
const CANONICAL = 'https://hyperclaylocal.com/';

describe('download list: single source of truth (version <-> filenames)', () => {
  const section = $('#downloads');
  const version = section.attr('data-version');

  test('the downloads section carries a semver data-version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('exactly the four expected OS rows are present, in order', () => {
    const osList = section.find('.dl-row').map((_, r) => $(r).attr('data-os')).get();
    expect(osList).toEqual(['mac-arm', 'mac-intel', 'windows', 'linux']);
  });

  // The whole page bumps version by editing these four filenames + data-version.
  // A version bump that misses one filename is the exact failure this guards.
  const expectedFile = (v) => ({
    'mac-arm': `HyperclayLocal-${v}-arm64.dmg`,
    'mac-intel': `HyperclayLocal-${v}.dmg`,
    windows: `HyperclayLocal-Setup-${v}.exe`,
    linux: `HyperclayLocal-${v}.AppImage`,
  });

  test.each(['mac-arm', 'mac-intel', 'windows', 'linux'])(
    '%s row: href, visible text, and filename all agree and embed the version',
    (os) => {
      const row = section.find(`.dl-row[data-os="${os}"]`);
      expect(row.length).toBe(1);
      const link = row.find('a.dl-file');
      const href = link.attr('href');
      const filename = expectedFile(version)[os];

      expect(href).toBe(DOWNLOAD_HOST + filename);
      expect(link.text().trim()).toBe(filename);
      expect(href).toContain(version);
      expect(link.is('[download]')).toBe(true);
    }
  );

  test('every row shows a plausible size', () => {
    section.find('.dl-row').each((_, r) => {
      expect($(r).find('.dl-size').text().trim()).toMatch(/^\d+(\.\d+)?\s?MB$/);
    });
  });
});

describe('tab/panel ARIA contract', () => {
  // Both the demo gallery and the code example use the same roving-tabindex
  // pattern; a broken aria-controls/labelledby pair silently breaks a11y.
  const groups = [
    { name: 'demo gallery', tablist: '#demo-tabs', tabSel: '.demo-tab', panelScope: '#demo-panels', panelSel: '.demo-panel' },
    { name: 'code example', tablist: '#code-tabs .tablist', tabSel: '.code-tab', panelScope: '#code-tabs', panelSel: '.code-panel' },
  ];

  describe.each(groups)('$name', ({ tablist, tabSel, panelScope, panelSel }) => {
    const tabs = $(`${tablist} ${tabSel}`);
    const panels = $(`${panelScope} ${panelSel}`);

    test('tablist has role=tablist and at least two tabs', () => {
      expect($(tablist).attr('role')).toBe('tablist');
      expect(tabs.length).toBeGreaterThanOrEqual(2);
    });

    test('each tab controls an existing panel that labels it back', () => {
      tabs.each((_, tab) => {
        const $tab = $(tab);
        expect($tab.attr('role')).toBe('tab');
        const panelId = $tab.attr('aria-controls');
        const panel = $(`#${panelId}`);
        expect(panel.length).toBe(1);
        expect(panel.attr('role')).toBe('tabpanel');
        expect(panel.attr('aria-labelledby')).toBe($tab.attr('id'));
      });
    });

    test('exactly one tab is selected and it is the only one with tabindex 0', () => {
      const selected = tabs.filter((_, t) => $(t).attr('aria-selected') === 'true');
      expect(selected.length).toBe(1);
      tabs.each((_, t) => {
        const on = $(t).attr('aria-selected') === 'true';
        expect($(t).attr('tabindex')).toBe(on ? '0' : '-1');
      });
    });

    test('panel count matches tab count', () => {
      expect(panels.length).toBe(tabs.length);
    });
  });

  test('demo tab data-app values pair 1:1 with panel data-app values', () => {
    const tabApps = $('#demo-tabs .demo-tab').map((_, t) => $(t).attr('data-app')).get().sort();
    const panelApps = $('#demo-panels .demo-panel').map((_, p) => $(p).attr('data-app')).get().sort();
    expect(tabApps).toEqual(panelApps);
    expect(new Set(tabApps).size).toBe(tabApps.length); // no duplicates
  });
});

describe('sap live-demo wiring', () => {
  test('every collection list ships exactly one template item, and it is first', () => {
    const collections = $('[items]');
    expect(collections.length).toBeGreaterThan(0);
    collections.each((_, coll) => {
      const $coll = $(coll);
      const templates = $coll.find('[item][template]');
      expect(templates.length).toBe(1);
      const firstItem = $coll.find('[item]').first();
      expect(firstItem.is('[template]')).toBe(true);
    });
  });

  test('every trigger-add form targets a real collection', () => {
    const names = new Set($('[items]').map((_, c) => $(c).attr('items')).get());
    $('[trigger-add]').each((_, form) => {
      expect(names.has($(form).attr('trigger-add'))).toBe(true);
    });
  });

  test('every detail pane binds a real collection', () => {
    const names = new Set($('[items]').map((_, c) => $(c).attr('items')).get());
    const details = $('[detail]');
    expect(details.length).toBeGreaterThan(0);
    details.each((_, d) => {
      const collection = $(d).attr('detail').trim().split(/\s+/)[0]; // "pages by state.selected"
      expect(names.has(collection)).toBe(true);
    });
  });

  test('budget total is computed, not hardcoded', () => {
    // Colon attributes (calc:total, text:usd) don't play well with CSS selectors,
    // so match on the raw attribute map instead.
    const total = $('*').filter((_, el) => el.attribs && 'calc:total' in el.attribs);
    expect(total.length).toBe(1);
    expect(total.attr('text:usd')).toBeTruthy();
  });

  test('there are seven mounted sap apps', () => {
    expect($('main[sap]').length).toBe(7);
  });
});

describe('SEO and social metadata', () => {
  test('html declares a language', () => {
    expect($('html').attr('lang')).toBe('en');
  });

  test('title and meta description are present and non-trivial', () => {
    expect($('title').text().trim().length).toBeGreaterThan(10);
    expect($('meta[name="description"]').attr('content').trim().length).toBeGreaterThan(20);
  });

  test('responsive viewport is declared', () => {
    expect($('meta[name="viewport"]').attr('content')).toContain('width=device-width');
  });

  test('canonical and og:url agree', () => {
    expect($('link[rel="canonical"]').attr('href')).toBe(CANONICAL);
    expect($('meta[property="og:url"]').attr('content')).toBe(CANONICAL);
  });

  test.each([
    'og:type', 'og:title', 'og:description', 'og:image',
  ])('%s is present', (prop) => {
    expect($(`meta[property="${prop}"]`).attr('content').trim()).toBeTruthy();
  });

  test('twitter card is a summary_large_image with an absolute https image', () => {
    expect($('meta[name="twitter:card"]').attr('content')).toBe('summary_large_image');
    expect($('meta[property="og:image"]').attr('content')).toMatch(/^https:\/\//);
    expect($('meta[name="twitter:image"]').attr('content')).toMatch(/^https:\/\//);
  });
});

describe('local assets resolve on disk (self-contained bundle)', () => {
  // Collect every non-remote, non-inline reference the page makes.
  const refs = new Set();
  $('link[href], script[src], img[src]').each((_, el) => {
    const url = $(el).attr('href') || $(el).attr('src');
    if (url && !/^(https?:|data:|#|mailto:)/.test(url)) refs.add(url.split(/[?#]/)[0]);
  });

  test('the page references its local assets', () => {
    expect(refs.has('mirk.css')).toBe(true);
    expect(refs.has('mirk.js')).toBe(true);
    expect(refs.has('sap.min.js')).toBe(true);
    expect(refs.has('assets/app-popover.png')).toBe(true);
  });

  test.each([...refs])('local reference exists: %s', (ref) => {
    expect(fs.existsSync(path.join(WEBSITE_DIR, ref))).toBe(true);
  });

  test('the @font-face url in mirk.css resolves', () => {
    const css = fs.readFileSync(path.join(WEBSITE_DIR, 'mirk.css'), 'utf8');
    const m = /url\(['"]?([^'")]+\.woff2)['"]?\)/.exec(css);
    expect(m).not.toBeNull();
    expect(fs.existsSync(path.join(WEBSITE_DIR, m[1]))).toBe(true);
  });

  test('the hero screenshot has alt text and intrinsic dimensions', () => {
    const img = $('.hero-shot img');
    expect(img.length).toBe(1);
    expect(img.attr('alt').trim().length).toBeGreaterThan(10);
    expect(img.attr('width')).toBeTruthy();
    expect(img.attr('height')).toBeTruthy();
  });
});

describe('link safety and in-page navigation', () => {
  test('every target=_blank link is rel=noopener', () => {
    const external = $('a[target="_blank"]');
    expect(external.length).toBeGreaterThan(0);
    external.each((_, a) => {
      expect(($(a).attr('rel') || '')).toContain('noopener');
    });
  });

  test('every in-page anchor resolves to an element id on the page', () => {
    $('a[href^="#"]').each((_, a) => {
      const id = $(a).attr('href').slice(1);
      if (!id) return; // bare "#" not used, but ignore if it appears
      expect($(`#${id}`).length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('progressive-enhancement baseline (works before JS runs)', () => {
  test('hero download button falls back to the full download list', () => {
    expect($('#download-btn').attr('href')).toBe('#downloads');
  });

  test('version tag is empty in static markup (JS fills it)', () => {
    expect($('#version-tag').text()).toBe('');
  });

  test('all download rows are plain links usable without JS', () => {
    $('#downloads .dl-row a.dl-file').each((_, a) => {
      expect($(a).attr('href')).toMatch(/^https:\/\//);
    });
  });
});

describe('theme system static invariants', () => {
  test('the flash-of-wrong-theme guard runs before mirk.css loads', () => {
    const guardIdx = html.indexOf("localStorage.getItem('hcl-theme')");
    const cssIdx = html.indexOf('href="mirk.css"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(cssIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(cssIdx);
  });

  test('guard and toggle scripts agree on the storage key', () => {
    // Two independent scripts read/write the mode; a drifted key would desync them.
    const occurrences = html.match(/hcl-theme/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  test('toggle button ships accessible defaults and both icons', () => {
    const btn = $('#theme-toggle');
    expect(btn.attr('aria-label')).toBeTruthy();
    expect(btn.attr('aria-pressed')).toBe('false');
    const moon = btn.find('[data-icon="moon"]');
    const sun = btn.find('[data-icon="sun"]');
    expect(moon.length).toBe(1);
    expect(sun.length).toBe(1);
    expect(moon.is('[hidden]')).toBe(false); // moon shown by default
    expect(sun.is('[hidden]')).toBe(true);   // sun hidden by default
  });
});
