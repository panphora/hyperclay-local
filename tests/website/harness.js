/**
 * Test harness for the hyperclaylocal.com marketing page (website/index.html).
 *
 * The repo runs Jest in the `node` test environment with no jsdom, so this
 * harness leans on cheerio (already a dependency) for static structure and, for
 * the two behavior-bearing inline scripts, executes the *real* extracted script
 * text against a tiny recording DOM. The DOM stubs are deliberately small and
 * obviously correct; the data they hand the script (download hrefs, version) is
 * pulled from the actual markup, so the behavioral tests exercise the shipped
 * code, not a re-implementation of it.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const PAGE_PATH = path.join(__dirname, '..', '..', 'website', 'index.html');
const WEBSITE_DIR = path.dirname(PAGE_PATH);

function readPage() {
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

function load() {
  return cheerio.load(readPage());
}

/**
 * Return the source text of the single inline <script> whose body contains
 * `marker`. Throws if zero or more than one match, so a test fails loudly if the
 * page is restructured rather than silently testing the wrong script.
 */
function inlineScriptContaining(marker) {
  const $ = load();
  const matches = [];
  $('script').each((_, el) => {
    if ($(el).attr('src')) return;
    const code = $(el).html() || '';
    if (code.includes(marker)) matches.push(code);
  });
  if (matches.length === 0) throw new Error(`No inline <script> contains marker: "${marker}"`);
  if (matches.length > 1) throw new Error(`Marker "${marker}" matched ${matches.length} scripts (ambiguous)`);
  return matches[0];
}

/** Execute IIFE source with the given globals shadowed as function params. */
function runScript(code, scope) {
  const names = Object.keys(scope);
  const values = names.map((n) => scope[n]);
  // eslint-disable-next-line no-new-func
  new Function(...names, code)(...values);
}

// --------------------------------------------------------------------------
// Minimal recording DOM
// --------------------------------------------------------------------------

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...cls) { cls.forEach((c) => set.add(c)); },
    remove(...cls) { cls.forEach((c) => set.delete(c)); },
    contains(c) { return set.has(c); },
    toArray() { return [...set]; },
  };
}

function makeEl(props = {}) {
  const listeners = {};
  return {
    href: props.href,
    textContent: props.textContent != null ? props.textContent : '',
    innerHTML: props.innerHTML != null ? props.innerHTML : '',
    hidden: props.hidden || false,
    dataset: props.dataset || {},
    classList: makeClassList(props.classes),
    attrs: {},
    querySelector: props.querySelector || (() => null),
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === 'href') this.href = String(value);
    },
    getAttribute(name) {
      if (name === 'href') return this.href == null ? null : this.href;
      return name in this.attrs ? this.attrs[name] : null;
    },
    hasAttribute(name) { return name in this.attrs; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt || {})); },
    focus() {},
  };
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

/**
 * Controllable matchMedia. `matches` is read through a getter so every object it
 * returns reflects the current OS preference; `.set(bool)` flips it and fires
 * every registered `change` listener, simulating the OS theme changing.
 */
function makeMatchMedia(initialMatches) {
  const state = { matches: initialMatches, handlers: [] };
  const mm = (query) => ({
    media: query,
    get matches() { return state.matches; },
    addEventListener(type, fn) { if (type === 'change') state.handlers.push(fn); },
    removeEventListener(type, fn) { state.handlers = state.handlers.filter((h) => h !== fn); },
    addListener(fn) { state.handlers.push(fn); },
    removeListener(fn) { state.handlers = state.handlers.filter((h) => h !== fn); },
  });
  mm.set = (v) => {
    state.matches = v;
    state.handlers.slice().forEach((h) => h({ matches: v }));
  };
  return mm;
}

// --------------------------------------------------------------------------
// Real data pulled from the page (keeps behavioral tests honest)
// --------------------------------------------------------------------------

/** { version, hrefs: { 'mac-arm', 'mac-intel', 'windows', 'linux' } } */
function realDownloadData() {
  const $ = load();
  const section = $('#downloads');
  const hrefs = {};
  section.find('.dl-row').each((_, row) => {
    const os = $(row).attr('data-os');
    hrefs[os] = $(row).find('a.dl-file').attr('href');
  });
  return { version: section.attr('data-version'), hrefs };
}

/**
 * Build the DOM surface the download-detection script touches. `#downloads`
 * resolves `.dl-row[data-os="X"] a` selectors to the real hrefs so the test can
 * assert the button href is *cloned* from the source-of-truth list.
 */
function makeDownloadDom({ version, hrefs }) {
  const section = makeEl({ dataset: { version } });
  section.querySelector = (sel) => {
    const m = /data-os="([^"]+)"/.exec(sel);
    if (!m) return null;
    const href = hrefs[m[1]];
    return href == null ? null : makeEl({ href });
  };
  const btn = makeEl({ href: '#downloads' });
  btn.setAttribute('download', ''); // static markup ships with the attribute present
  const text = makeEl({ textContent: 'Download' });
  const sub = makeEl();
  const tag = makeEl();
  const byId = {
    downloads: section,
    'download-btn': btn,
    'download-btn-text': text,
    'download-subtext': sub,
    'version-tag': tag,
  };
  return {
    document: { getElementById: (id) => byId[id] || null },
    els: { section, btn, text, sub, tag },
  };
}

/** Build the DOM surface the theme-toggle script touches. */
function makeThemeDom({ rootClasses = [] } = {}) {
  const sun = makeEl({ hidden: true });
  const moon = makeEl({ hidden: false });
  const btn = makeEl();
  btn.querySelector = (sel) => {
    if (sel.includes('sun')) return sun;
    if (sel.includes('moon')) return moon;
    return null;
  };
  const root = makeEl({ classes: rootClasses });
  const byId = { 'theme-toggle': btn };
  return {
    document: { documentElement: root, getElementById: (id) => byId[id] || null },
    els: { root, btn, sun, moon },
  };
}

module.exports = {
  PAGE_PATH,
  WEBSITE_DIR,
  readPage,
  load,
  inlineScriptContaining,
  runScript,
  makeEl,
  makeStorage,
  makeMatchMedia,
  realDownloadData,
  makeDownloadDom,
  makeThemeDom,
};
