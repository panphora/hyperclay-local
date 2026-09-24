// Data-only marketing and development states for the popover screenshot workflow.
// The engine (screenshot-popover.js) turns each entry into the state payload main
// sends (C4 §5.2 `buildStatePayload`) over the REAL src/renderer/popover.html, so
// these only describe state.
//
// Fields per scenario:
//   name           identifier (also usable via --scenario <name>)
//   out            output filename written into the outdir
//   dev            true = development state; `--scenario all` skips it (stage B only)
//   aliases        extra filenames to copy the PNG to (e.g. the legacy static hero)
//   serverEnabled  SERVER rocker on/off
//   syncEnabled    SYNC rocker on/off
//   hasApiKey      key stored; false swaps the rocker for `Connect →`
//   actor          { username } the sync subline prints
//   banner         global banner: 'reconnect' | 'server-update' | null (§4.7)
//   home           home directory the renderer shortens folder paths with
//   personalFolder what the native folder picker answers with
//   cards          the Card[] main would send (§5.1); `syncAgoMs` seeds lastSyncAt
//   activity       the Line[] feed; `agoMs` seeds each line's time
//   conflicts      conflict notices ({ sessionId, path }) for §4.9's conflict card
//   notices        sync-update errors emitted after mount (fills the Notices view)
//   gotoNotices    click the bell after load and capture the notifications view
//   gotoSetup      accountId whose setup view (§4.8) to open
//   setup          the get-team-setup payload for that account
//   setupNotEmpty  the native folder picker answers with a folder that has files

const { switchSublines } = require('../src/main/ui/card-model');

const FOLDER = '/Users/panphora/HyperclayApps/local-hyperclay-apps';
const USERNAME = 'panphora';
const APP_VERSION = '1.24.1';

const HOME = '/Users/panphora';
const DEV_HOME = '/Users/alex';

// A Card exactly as src/main/ui/card-model.js builds one (§5.1).
const card = (fields) => ({
  rootId: null,
  sessionId: null,
  accountId: null,
  kind: 'team',
  port: null,
  nextPort: null,
  webUrl: null,
  lastSyncAt: null,
  title: null,
  subtitle: null,
  folder: null,
  url: null,
  state: 'serve-only',
  detail: null,
  detailLong: null,
  actions: [],
  ...fields,
});

// A Line exactly as card-model.js `toLine` builds one; `agoMs` becomes its time.
const line = (verb, path, agoMs) => ({ verb, path, agoMs, sessionId: null });

// The personal root: one per popover, so the first-run bay stays out of the shots.
const personal = (fields) => card({
  kind: 'personal',
  rootId: 'root-personal',
  sessionId: 'session-personal',
  accountId: 'account-personal',
  title: 'alex',
  subtitle: 'personal',
  port: 4321,
  folder: '~/hyperclay',
  url: 'http://localhost:4321',
  state: 'synced',
  syncAgoMs: 12 * 1000,
  detail: 'synced',
  detailLong: 'synced',
  actions: ['open', 'reveal', 'backups'],
  ...fields,
});

// A team root: the healthy default, then whatever state the scenario mocks up.
// `port` drives `url` unless the scenario names one (a stopped server means url: null).
const team = (username, displayName, fields) => {
  const { port = 5432, url, ...rest } = fields;
  return card({
    rootId: `root-${username}`,
    sessionId: `session-${username}`,
    accountId: `account-${username}`,
    title: username,
    subtitle: `${displayName} · editor`,
    folder: `~/hyperclay-teams/${username}`,
    state: 'synced',
    syncAgoMs: 60 * 1000,
    detail: 'synced',
    detailLong: 'synced',
    actions: ['open', 'reveal', 'backups', 'disconnect', 'remove'],
    ...rest,
    port,
    url: url === undefined ? `http://localhost:${port}` : url,
  });
};

const marketingPersonal = (fields) => card({
  kind: 'personal',
  rootId: 'root-personal',
  sessionId: 'session-personal',
  accountId: 'account-personal',
  title: USERNAME,
  subtitle: 'personal',
  port: 4321,
  folder: '~/HyperclayApps/local-hyperclay-apps',
  url: 'http://localhost:4321',
  state: 'synced',
  syncAgoMs: 2 * 60 * 1000,
  detail: 'synced',
  detailLong: 'synced',
  actions: ['open', 'reveal', 'backups'],
  ...fields,
});

const MARKETING_ACTIVITY = [
  line('uploaded', `${USERNAME}/rate-calc.html`, 60 * 1000),
  line('uploaded', `${USERNAME}/index.html`, 3 * 60 * 1000),
  line('uploaded', `${USERNAME}/notes/journal.html`, 4 * 60 * 1000),
  line('downloaded', `${USERNAME}/blog/field-notes.html`, 7 * 60 * 1000),
  line('downloaded', `${USERNAME}/kanban.html`, 12 * 60 * 1000),
  line('uploaded', `${USERNAME}/writer.html`, 21 * 60 * 1000),
];

const ACTIVITY = [
  line('uploaded', 'acme/board.html', 60 * 1000),
  line('downloaded', 'alex/notes/journal.html', 4 * 60 * 1000),
  line('uploaded', 'acme/assets/logo.png', 9 * 60 * 1000),
];

const CALM_NOTICES = [
  { error: 'Sync resumed after a brief disconnect', agoMs: 2 * 60 * 1000, priority: 2, dismissable: true },
  { error: 'Backed up 6 files before syncing', agoMs: 15 * 60 * 1000, priority: 3, dismissable: true },
];

const SETUP = {
  accountId: 42,
  username: 'acme',
  displayName: 'Acme',
  role: 'editor',
  port: 5432,
  suggestedFolder: `${DEV_HOME}/hyperclay-teams/acme`,
  folderIsNew: true,
  files: 34,
  bytes: 2.1 * 1024 * 1024,
};

function scenario(entry) {
  const cards = entry.cards || [];
  return {
    actor: null,
    banner: null,
    home: DEV_HOME,
    appVersion: APP_VERSION,
    activity: [],
    conflicts: [],
    ...entry,
    cards,
    // Main derives the switch sublines from the same cards (§5.1 switchSublines).
    sublines: switchSublines(entry, cards),
  };
}

const SCENARIOS = [
  // The five marketing states: one personal card, output names unchanged.
  scenario({
    name: 'on-on',
    out: 'app-popover-on-on.png',
    aliases: ['app-popover.png'], // keeps the current static hero reference working
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: USERNAME }, home: HOME, personalFolder: FOLDER,
    cards: [marketingPersonal({})],
    activity: MARKETING_ACTIVITY,
  }),
  scenario({
    name: 'on-off',
    out: 'app-popover-on-off.png',
    serverEnabled: true, syncEnabled: false, hasApiKey: true,
    actor: { username: USERNAME }, home: HOME, personalFolder: FOLDER,
    cards: [marketingPersonal({ state: 'serve-only', detail: 'sync off', detailLong: 'Sync is off for all folders.' })],
    activity: MARKETING_ACTIVITY,
  }),
  scenario({
    name: 'off-off',
    out: 'app-popover-off-off.png',
    serverEnabled: false, syncEnabled: false, hasApiKey: true,
    actor: { username: USERNAME }, home: HOME, personalFolder: FOLDER,
    cards: [marketingPersonal({ url: null, state: 'serve-only', detail: 'sync off', detailLong: 'Sync is off for all folders.' })],
    activity: MARKETING_ACTIVITY,
  }),
  scenario({
    name: 'off-on',
    out: 'app-popover-off-on.png',
    serverEnabled: false, syncEnabled: true, hasApiKey: true,
    actor: { username: USERNAME }, home: HOME, personalFolder: FOLDER,
    cards: [marketingPersonal({ url: null })],
    activity: MARKETING_ACTIVITY,
  }),
  scenario({
    name: 'notices',
    out: 'app-popover-notices.png',
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: USERNAME }, home: HOME, personalFolder: FOLDER,
    cards: [marketingPersonal({})],
    activity: MARKETING_ACTIVITY,
    gotoNotices: true, notices: CALM_NOTICES,
  }),

  // Development states: one per §4 mockup, captured by name (dev-*.png).
  scenario({
    name: 'teams', // §4.1
    out: 'dev-popover-teams.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      team('acme', 'Acme', { syncAgoMs: 60 * 1000 }),
      card({
        accountId: 'account-gamma',
        title: 'gamma',
        subtitle: 'Gamma · editor',
        state: 'setup',
        detail: 'not on this computer',
        detailLong: "You're an editor on Gamma. Set up a folder to sync it here.",
        actions: ['setup'],
      }),
      card({
        accountId: 'account-beta-co',
        title: 'beta-co',
        subtitle: 'Beta Co · viewer',
        webUrl: 'https://hyperclay.com/beta-co',
        state: 'viewer',
        detail: 'viewers use the site',
        detailLong: "You're a viewer on Beta Co. Viewers open team documents on hyperclay.com.",
        actions: ['web'],
      }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'server-off', // §4.2
    out: 'dev-popover-server-off.png',
    dev: true,
    serverEnabled: false, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [personal({ url: null }), team('acme', 'Acme', { url: null })],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'sync-off', // §4.3
    out: 'dev-popover-sync-off.png',
    dev: true,
    serverEnabled: true, syncEnabled: false, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({ state: 'serve-only', detail: 'sync off', detailLong: 'Sync is off for all folders.' }),
      team('acme', 'Acme', { state: 'serve-only', detail: 'sync off', detailLong: 'Sync is off for all folders.' }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'no-key', // §4.4
    out: 'dev-popover-no-key.png',
    dev: true,
    serverEnabled: true, syncEnabled: false, hasApiKey: false,
    actor: null, personalFolder: `${DEV_HOME}/HyperclayApps`,
    cards: [
      card({
        kind: 'personal',
        rootId: 'root-personal',
        title: 'my-apps',
        subtitle: 'personal',
        port: 4321,
        folder: '~/HyperclayApps/my-apps',
        url: 'http://localhost:4321',
        state: 'serve-only',
        detail: 'not synced',
        detailLong: 'Served locally. Connect to sync it with hyperclay.com.',
        actions: ['open', 'reveal', 'backups'],
      }),
    ],
  }),
  scenario({
    name: 'paused-each', // §4.5, one card per reason
    out: 'dev-popover-paused-each.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      team('acme', 'Acme', {
        subtitle: 'Acme · viewer',
        port: 5432,
        state: 'paused',
        detail: "paused: you're a viewer",
        detailLong: "You're now a viewer on Acme. Your files are still here and still served at localhost:5432. Sync resumes if you're made an editor again.",
      }),
      team('beta', 'Beta', {
        port: 5433,
        state: 'paused',
        detail: 'paused: plan inactive',
        detailLong: "beta's plan isn't active. Your files are still here and still served. Sync resumes when the plan is active again.",
      }),
      team('gamma', 'Gamma', {
        port: 5434,
        state: 'paused',
        detail: 'paused: not on gamma',
        detailLong: "You're no longer on Gamma. Your files are still here and still served. Sync resumes if you're added back.",
      }),
      team('zeta', 'Zeta', {
        port: 5435,
        state: 'paused',
        detail: 'paused: team unavailable',
        detailLong: 'Zeta was deleted or is unavailable on hyperclay.com. Your files are still here and still served.',
      }),
      team('delta', 'Delta', {
        port: 5436,
        state: 'paused',
        detail: 'paused: reconnect',
        detailLong: 'Your sync key no longer works. Reconnect to resume.',
      }),
      team('omega', 'Omega', {
        subtitle: 'Omega · viewer',
        port: 5437,
        state: 'paused',
        detail: 'paused: no sync access',
        detailLong: "Your role on Omega doesn't allow syncing right now. Your files are still here and still served.",
      }),
      team('sigma', 'Sigma', {
        port: 5438,
        state: 'paused',
        detail: 'paused: waiting for hyperclay.com',
        detailLong: "hyperclay.com needs an update before this folder can sync. It's still served.",
      }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'port-taken', // §4.6
    out: 'dev-popover-port-taken.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      team('acme', 'Acme', {
        port: 5432,
        nextPort: 5433,
        url: null,
        state: 'port-taken',
        detail: 'Not served. Another program has :5432.',
        detailLong: 'Not served. Another program has :5432.',
        actions: ['open', 'reveal', 'backups', 'disconnect', 'remove', 'retry', 'change-port'],
      }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'conflict', // §4.9 conflict copy
    out: 'dev-popover-conflict.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      team('acme', 'Acme', {
        state: 'conflict',
        detail: '1 conflict',
        detailLong: 'A file changed here and on hyperclay.com. Both copies are kept; see Notices.',
      }),
    ],
    conflicts: [{ sessionId: 'session-acme', path: 'board.html' }],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'reconnect', // §4.7, key revoked
    out: 'dev-popover-reconnect.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    banner: 'reconnect',
    cards: [
      personal({ state: 'paused', detail: 'paused: reconnect', detailLong: 'Your sync key no longer works. Reconnect to resume.' }),
      team('acme', 'Acme', { state: 'paused', detail: 'paused: reconnect', detailLong: 'Your sync key no longer works. Reconnect to resume.' }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'server-update', // §4.7, hyperclay.com needs an update
    out: 'dev-popover-server-update.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    banner: 'server-update',
    cards: [
      personal({
        state: 'paused',
        detail: 'paused: waiting for hyperclay.com',
        detailLong: "hyperclay.com needs an update before this folder can sync. It's still served.",
      }),
      team('acme', 'Acme', {
        state: 'paused',
        detail: 'paused: waiting for hyperclay.com',
        detailLong: "hyperclay.com needs an update before this folder can sync. It's still served.",
      }),
    ],
    activity: ACTIVITY,
  }),
  scenario({
    name: 'setup', // §4.8
    out: 'dev-popover-setup.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      card({
        accountId: SETUP.accountId,
        title: SETUP.username,
        subtitle: 'Acme · editor',
        state: 'setup',
        detail: 'not on this computer',
        detailLong: "You're an editor on Acme. Set up a folder to sync it here.",
        actions: ['setup'],
      }),
    ],
    gotoSetup: SETUP.accountId,
    setup: SETUP,
  }),
  scenario({
    name: 'setup-not-empty', // §4.8, a chosen folder that already has files
    out: 'dev-popover-setup-not-empty.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      card({
        accountId: SETUP.accountId,
        title: SETUP.username,
        subtitle: 'Acme · editor',
        state: 'setup',
        detail: 'not on this computer',
        detailLong: "You're an editor on Acme. Set up a folder to sync it here.",
        actions: ['setup'],
      }),
    ],
    gotoSetup: SETUP.accountId,
    setup: { ...SETUP, chosenFolder: `${DEV_HOME}/Desktop/stuff` },
    setupNotEmpty: true,
  }),
  scenario({
    name: 'first-run',
    out: 'dev-popover-first-run.png',
    dev: true,
    serverEnabled: false, syncEnabled: false, hasApiKey: false,
    actor: null, personalFolder: `${DEV_HOME}/HyperclayApps`,
    cards: [],
  }),
  scenario({
    name: 'many-teams', // proves the card list scrolls
    out: 'dev-popover-many-teams.png',
    dev: true,
    serverEnabled: true, syncEnabled: true, hasApiKey: true,
    actor: { username: 'alex' },
    cards: [
      personal({}),
      team('acme', 'Acme', { port: 5432 }),
      team('beta-co', 'Beta Co', { port: 5433 }),
      team('delta', 'Delta', { port: 5434 }),
      team('gamma', 'Gamma', { port: 5435 }),
      team('omega', 'Omega', { port: 5436 }),
      team('sigma', 'Sigma', { port: 5437 }),
      team('zeta', 'Zeta', { port: 5438 }),
    ],
    activity: ACTIVITY,
  }),
];

module.exports = { FOLDER, USERNAME, APP_VERSION, SCENARIOS, scenarios: SCENARIOS };
