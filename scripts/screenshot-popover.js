#!/usr/bin/env node
// Capture retina screenshots of the REAL tray popover UI.
//
// It loads the actual src/renderer/popover.html (real bundle, CSS, fonts) in
// headless Chromium, injects a stubbed window.electronAPI seeded to a named
// scenario's state payload, and screenshots #root at the real window size x
// deviceScaleFactor. Nothing about the shipping UI is duplicated, so the shots
// can't drift.
//
//   npm run screenshot:popover                 # the five marketing states -> website/assets
//   node scripts/screenshot-popover.js --scenario teams
//   node scripts/screenshot-popover.js --scenario all --outdir /tmp --scale 2
//
// The development states (scripts/popover-scenarios.js entries with `dev: true`, one
// per C4 §4 mockup) are captured by name only: `--scenario all` skips them.
//
// First run needs the browser: npm run screenshot:setup  (playwright install chromium)

const path = require('path');
const fs = require('fs');
const { PANEL_WIDTH, PANEL_HEIGHT } = require('../src/main/popover-dimensions');
const { SCENARIOS } = require('./popover-scenarios');

const REPO = path.resolve(__dirname, '..');
const POPOVER_HTML = 'file://' + path.join(REPO, 'src/renderer/popover.html');
const PRELOAD = path.join(REPO, 'src/main/popover-preload.js');
const DEFAULT_OUTDIR = path.join(REPO, 'website', 'assets');

function parseArgs(argv) {
  const args = { scenario: 'all', outdir: DEFAULT_OUTDIR, scale: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--outdir') args.outdir = path.resolve(argv[++i]);
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--no-build') { /* the npm script owns building; no-op here */ }
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

// The real preload's exposed method names — the stub must cover every one, or a
// UI change that starts calling a new electronAPI method would silently no-op.
function preloadMethodNames() {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  const block = src.slice(src.indexOf('exposeInMainWorld'));
  const names = new Set();
  for (const m of block.matchAll(/^ {2}(\w+):/gm)) names.add(m[1]);
  return names;
}

// Runs IN THE PAGE before the bundle. Builds window.electronAPI from cfg (a scenario:
// the state payload main sends, plus that view's hints) and exposes window.__emit so
// the engine can drive events the way Electron would after mount.
function installStub(cfg) {
  try { localStorage.clear(); } catch (e) { /* file:// can throw */ }
  const now = Date.now();
  // Scenarios say how long ago a sync happened; the payload carries a timestamp.
  const cards = (cfg.cards || []).map(({ syncAgoMs, ...card }) => (
    syncAgoMs == null ? card : { ...card, lastSyncAt: now - syncAgoMs }
  ));
  const activity = (cfg.activity || []).map(({ agoMs, ...line }) => ({ ...line, time: now - (agoMs || 0) }));
  const setup = cfg.setup || null;
  const profile = (cfg.actor && cfg.actor.username) || null;
  const statePayload = () => ({
    serverEnabled: cfg.serverEnabled,
    syncEnabled: cfg.syncEnabled,
    hasApiKey: cfg.hasApiKey,
    actor: cfg.actor || null,
    banner: cfg.banner || null,
    cards,
    sublines: cfg.sublines,
    conflicts: cfg.conflicts || [],
    home: cfg.home,
    activity,
    availableUpdate: null,
    appVersion: cfg.appVersion || null,
  });

  const listeners = {};
  const on = (ch) => (cb) => { (listeners[ch] = listeners[ch] || []).push(cb); };
  const emit = (ch, data) => (listeners[ch] || []).forEach((cb) => cb(data));
  const noop = async () => {};
  const ok = async () => ({ ok: true });

  window.electronAPI = {
    selectFolder: async () => ({ success: true, folder: cfg.personalFolder || null }),
    getState: async () => statePayload(),
    openLogs: noop,
    openBrowser: noop,
    copyText: noop,

    setApiKey: async () => ({ success: true, username: profile }),
    getApiKeyInfo: async () => (cfg.hasApiKey ? { hasApiKey: true, username: profile } : null),
    removeApiKey: ok,

    setServerEnabled: noop,
    setSyncEnabled: noop,
    refreshAccounts: noop,
    getTeamSetup: async (accountId) => (setup && setup.accountId === accountId ? { ...setup, ok: true } : { ok: false }),
    chooseTeamFolder: async () => (setup
      ? { ok: true, folder: cfg.setupNotEmpty ? setup.chosenFolder : setup.suggestedFolder, empty: !cfg.setupNotEmpty }
      : { ok: false }),
    setupTeam: ok,
    resolveConflict: ok,
    disconnect: ok,
    removeFolder: ok,
    retryPort: ok,
    changePort: ok,
    openInBrowser: noop,
    revealFolder: noop,
    openBackups: noop,
    openWeb: noop,
    showCardMenu: noop,

    showOptionsMenu: noop,
    quitApp: noop,

    onStateUpdate: on('update-state'),
    onSyncUpdate: on('sync-update'),
    onFileSynced: on('file-synced'),
    onSyncStats: on('sync-stats'),
    onSyncRetry: on('sync-retry'),
    onSyncFailed: on('sync-failed'),
    onUpdateAvailable: on('update-available'),
    onArrowX: on('popover-arrow-x'),
    onArrowPosition: on('popover-arrow-position'),
    onShowCredentials: on('show-credentials'),
    onShowTeamSetup: on('show-team-setup'),
    removeAllListeners: (ch) => { listeners[ch] = []; },
  };
  window.__emit = emit;
}

function assertStubCoversPreload() {
  const required = preloadMethodNames();
  // Every electronAPI method appears as an object key in installStub's source.
  // Extra identifiers matched here are harmless; we only assert required ⊆ have.
  const src = installStub.toString();
  const have = new Set();
  for (const m of src.matchAll(/(\w+)\s*:/g)) have.add(m[1]);
  const missing = [...required].filter((n) => !have.has(n));
  if (missing.length) {
    throw new Error(
      `Stub is missing electronAPI methods the real preload exposes: ${missing.join(', ')}.\n` +
      `Update installStub() in scripts/screenshot-popover.js to match src/main/popover-preload.js.`
    );
  }
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function capture(browser, sc, args) {
  const context = await browser.newContext({
    viewport: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
    deviceScaleFactor: args.scale,
  });
  const page = await context.newPage();

  await page.addInitScript(installStub, sc);
  await page.goto(POPOVER_HTML, { waitUntil: 'load' });

  // Wait for React to mount, then drive the events main and Electron would send.
  await page.waitForFunction(() => document.querySelector('#root') && document.querySelector('#root').childElementCount > 0);
  await page.evaluate((s) => {
    window.__emit('popover-arrow-position', 'bottom'); // clean rounded rect, no arrow/top pad
    if (s.gotoSetup != null) window.__emit('show-team-setup', { accountId: s.gotoSetup });
    const now = Date.now();
    (s.notices || []).forEach((n) => window.__emit('sync-update', {
      error: n.error, priority: n.priority, dismissable: n.dismissable, file: n.file,
      timestamp: now - (n.agoMs || 0),
    }));
  }, sc);

  if (sc.gotoNotices) {
    await page.locator('button[aria-label^="Notices"]').click();
  }
  if (sc.gotoSetup != null) {
    await page.getByText('FOLDER', { exact: true }).waitFor(); // the setup view has replaced the home view
  }
  if (sc.setupNotEmpty) {
    // §4.8: the native picker answered with a folder that already has files.
    await page.getByText('Choose another folder…').click();
    await page.getByText("This folder isn't empty. A team folder has to start empty.").waitFor();
  }

  // Determinism: real fonts loaded, and the expected content actually painted.
  await page.evaluate(async () => {
    try {
      await document.fonts.load('14px "Berkeley Mono"');
      await document.fonts.load('12px "Fixedsys"');
    } catch (e) { /* ignore */ }
    await document.fonts.ready;
  });
  await page.waitForFunction(() => {
    const t = document.body.innerText || '';
    return t.includes('Options') && t.includes('Quit');
  });
  if (!sc.gotoNotices && sc.gotoSetup == null && sc.cards && sc.cards.length) {
    await page.getByText(sc.cards[0].title, { exact: false }).first().waitFor();
  }
  if (sc.gotoNotices && sc.notices && sc.notices.length) {
    await page.getByText(sc.notices[0].error).waitFor();
  }
  await page.waitForTimeout(300); // let any enter transitions settle

  fs.mkdirSync(args.outdir, { recursive: true });
  const outPath = path.join(args.outdir, sc.out);
  await page.locator('#root').screenshot({ path: outPath, omitBackground: true });

  const size = pngSize(outPath);
  const want = { width: PANEL_WIDTH * args.scale, height: PANEL_HEIGHT * args.scale };
  if (size.width !== want.width || size.height !== want.height) {
    throw new Error(`${sc.out}: expected ${want.width}x${want.height}, got ${size.width}x${size.height}`);
  }
  for (const alias of sc.aliases || []) {
    fs.copyFileSync(outPath, path.join(args.outdir, alias));
  }
  await context.close();
  return { out: sc.out, size, aliases: sc.aliases || [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertStubCoversPreload();

  const list = args.scenario === 'all'
    ? SCENARIOS.filter((s) => !s.dev)
    : SCENARIOS.filter((s) => s.name === args.scenario);
  if (!list.length) {
    throw new Error(`No scenario named "${args.scenario}". Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('Playwright is not installed. Run: npm install (then) npm run screenshot:setup');
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error('Could not launch Chromium. Run once: npm run screenshot:setup');
    console.error(String(e.message || e));
    process.exit(1);
  }

  try {
    for (const sc of list) {
      const r = await capture(browser, sc, args);
      const extra = r.aliases.length ? ` (+ ${r.aliases.join(', ')})` : '';
      console.log(`✓ ${r.out}  ${r.size.width}x${r.size.height}${extra}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`Done → ${args.outdir}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { installStub, assertStubCoversPreload, preloadMethodNames };
