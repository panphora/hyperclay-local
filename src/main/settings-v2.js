const crypto = require('crypto');
const fs = require('fs');
const { PERSONAL_PORT } = require('./roots');

const LEGACY_KEYS = ['selectedFolder', 'serverFolder', 'syncFolder', 'syncUsername', 'hasApiKey'];

function legacyMetaDirName(folder) {
  return crypto.createHash('sha256').update(folder).digest('hex').slice(0, 12);
}

function realpathOr(folder) {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return folder;
  }
}

function migrateSettings(legacy, { uuid = crypto.randomUUID } = {}) {
  const s = legacy || {};
  if (s.settingsVersion === 2) return { settings: s, migrated: false };

  const synced = s.apiKey && s.syncEnabled === true && s.syncFolder ? s.syncFolder : null;
  const folder = synced || s.selectedFolder || s.serverFolder || s.syncFolder || null;
  const roots = [];
  const syncSessions = [];

  if (folder) {
    const root = { id: uuid(), kind: 'personal', path: realpathOr(folder), port: PERSONAL_PORT, trustedAt: null };
    roots.push(root);
    if (s.apiKey && (s.syncFolder || s.syncEnabled)) {
      syncSessions.push({
        id: uuid(),
        rootId: root.id,
        accountId: null,
        kind: 'personal',
        cached: { username: s.syncUsername || null, displayName: s.syncUsername || null, role: 'owner' },
        paused: null,
        legacyMetaDir: legacyMetaDirName(folder),
      });
    }
  }

  const next = {};
  for (const [key, value] of Object.entries(s)) {
    if (!LEGACY_KEYS.includes(key)) next[key] = value;
  }
  Object.assign(next, {
    settingsVersion: 2,
    deviceId: s.deviceId || uuid(),
    actor: s.syncUsername ? { id: null, username: s.syncUsername } : null,
    serverEnabled: s.serverEnabled === true,
    syncEnabled: s.syncEnabled === true,
    roots,
    syncSessions,
    seenTeamIds: [],
  });
  return { settings: next, migrated: true };
}

module.exports = { migrateSettings, legacyMetaDirName, LEGACY_KEYS };
