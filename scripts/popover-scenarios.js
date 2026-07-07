// Data-only marketing states for the popover screenshot workflow.
// The engine (screenshot-popover.js) turns each entry into a seeded electronAPI
// stub over the REAL src/renderer/popover.html, so these only describe state.
//
// Fields per scenario:
//   name       identifier (also usable via --scenario <name>)
//   out        output filename written into the outdir
//   aliases    extra filenames to copy the PNG to (e.g. the legacy static hero)
//   server     SERVER rocker on/off
//   sync       SYNC rocker on/off
//   syncAgoMs  how long ago the last sync was (drives "synced Nm ago")
//   activity   file-synced events to fill the ACTIVITY feed (omit for none)
//   notices    calm notices to seed (sync-update events); used with gotoNotices
//   gotoNotices click the bell after load and capture the notifications view

const FOLDER = '/Users/panphora/HyperclayApps/local-hyperclay-apps';
const USERNAME = 'panphora';
const APP_VERSION = '1.18.0';

const ACTIVITY = [
  { action: 'upload', file: 'rate-calc.html' },
  { action: 'upload', file: 'index.html' },
  { action: 'upload', file: 'notes/journal.html' },
  { action: 'download', file: 'blog/field-notes.html' },
  { action: 'download', file: 'kanban.html' },
  { action: 'upload', file: 'writer.html' },
];

const CALM_NOTICES = [
  { error: 'Sync resumed after a brief disconnect', agoMs: 2 * 60 * 1000, priority: 2, dismissable: true },
  { error: 'Backed up 6 files before syncing', agoMs: 15 * 60 * 1000, priority: 3, dismissable: true },
];

const SCENARIOS = [
  {
    name: 'on-on',
    out: 'app-popover-on-on.png',
    aliases: ['app-popover.png'], // keeps the current static hero reference working
    server: true, sync: true, syncAgoMs: 2 * 60 * 1000, activity: ACTIVITY,
  },
  { name: 'on-off', out: 'app-popover-on-off.png', server: true, sync: false },
  { name: 'off-off', out: 'app-popover-off-off.png', server: false, sync: false },
  {
    name: 'off-on',
    out: 'app-popover-off-on.png',
    server: false, sync: true, syncAgoMs: 2 * 60 * 1000, activity: ACTIVITY,
  },
  {
    name: 'notices',
    out: 'app-popover-notices.png',
    server: true, sync: true, syncAgoMs: 2 * 60 * 1000,
    gotoNotices: true, notices: CALM_NOTICES,
  },
];

module.exports = { FOLDER, USERNAME, APP_VERSION, SCENARIOS };
