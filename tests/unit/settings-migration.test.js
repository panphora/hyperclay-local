const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateSettings, legacyMetaDirName, LEGACY_KEYS } = require('../../src/main/settings-v2');
const { PERSONAL_PORT } = require('../../src/main/roots');

const sha12 = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

function makeUuid() {
  let n = 0;
  return () => `id-${++n}`;
}

describe('migrateSettings', () => {
  test('turns a v1 folder, key and syncEnabled into one personal root and one personal session', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      apiKey: 'ciphertext-blob',
      syncEnabled: true,
      syncUsername: 'alex'
    };

    const { settings, migrated } = migrateSettings(legacy, { uuid: makeUuid() });

    expect(migrated).toBe(true);
    expect(settings.settingsVersion).toBe(2);
    expect(settings.roots).toEqual([
      { id: 'id-1', kind: 'personal', path: '/Users/alex/Sites', port: PERSONAL_PORT, trustedAt: null }
    ]);
    expect(settings.syncSessions).toEqual([
      {
        id: 'id-2',
        rootId: 'id-1',
        accountId: null,
        kind: 'personal',
        cached: { username: 'alex', displayName: 'alex', role: 'owner' },
        paused: null,
        legacyMetaDir: sha12('/Users/alex/Sites')
      }
    ]);
    expect(settings.syncSessions[0].legacyMetaDir).toBe(legacyMetaDirName('/Users/alex/Sites'));
    expect(settings.actor).toEqual({ id: null, username: 'alex' });
    expect(settings.syncEnabled).toBe(true);
    expect(settings.serverEnabled).toBe(false);
    expect(settings.seenTeamIds).toEqual([]);
    expect(settings.deviceId).toBeTruthy();
  });

  test('a selectedFolder without an API key gives a root and no session', () => {
    const { settings } = migrateSettings({ selectedFolder: '/Users/alex/Sites' }, { uuid: makeUuid() });

    expect(settings.roots).toHaveLength(1);
    expect(settings.roots[0]).toMatchObject({ kind: 'personal', path: '/Users/alex/Sites', port: PERSONAL_PORT });
    expect(settings.syncSessions).toEqual([]);
    expect(settings.actor).toBeNull();
  });

  test('a v1 file with no folder gives no roots and no sessions', () => {
    const { settings, migrated } = migrateSettings({ deviceId: 'device-1' }, { uuid: makeUuid() });

    expect(migrated).toBe(true);
    expect(settings.roots).toEqual([]);
    expect(settings.syncSessions).toEqual([]);
    expect(settings.deviceId).toBe('device-1');
  });

  test('a syncFolder alone becomes the personal root and its session metadata dir', () => {
    const legacy = { syncFolder: '/Users/alex/Other', apiKey: 'ciphertext-blob', syncUsername: 'alex' };

    const { settings } = migrateSettings(legacy, { uuid: makeUuid() });

    expect(settings.roots).toHaveLength(1);
    expect(settings.roots[0]).toMatchObject({ kind: 'personal', path: '/Users/alex/Other', port: PERSONAL_PORT });
    expect(settings.syncSessions).toHaveLength(1);
    expect(settings.syncSessions[0].rootId).toBe(settings.roots[0].id);
    expect(settings.syncSessions[0].legacyMetaDir).toBe(sha12('/Users/alex/Other'));
  });

  test('a v1 install that synced syncFolder while serving selectedFolder keeps syncFolder as the personal root', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      syncFolder: '/Users/alex/Abandoned',
      apiKey: 'ciphertext-blob',
      syncEnabled: true
    };

    const { settings } = migrateSettings(legacy, { uuid: makeUuid() });

    expect(settings.roots[0].path).toBe('/Users/alex/Abandoned');
    expect(settings.syncSessions[0].rootId).toBe(settings.roots[0].id);
    expect(settings.syncSessions[0].legacyMetaDir).toBe(sha12('/Users/alex/Abandoned'));
  });

  test('selectedFolder wins over syncFolder while sync was off', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      syncFolder: '/Users/alex/Abandoned',
      apiKey: 'ciphertext-blob',
      syncEnabled: false
    };

    const { settings } = migrateSettings(legacy, { uuid: makeUuid() });

    expect(settings.roots[0].path).toBe('/Users/alex/Sites');
    expect(settings.syncSessions[0].rootId).toBe(settings.roots[0].id);
    expect(settings.syncSessions[0].legacyMetaDir).toBe(sha12('/Users/alex/Sites'));
  });

  test('a migrated root under a symlink is stored realpath\'d while legacyMetaDir hashes the v1 string', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperclay-migrate-'));
    const real = path.join(base, 'real');
    const link = path.join(base, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);

    try {
      const { settings } = migrateSettings({
        selectedFolder: link,
        apiKey: 'ciphertext-blob',
        syncEnabled: true
      }, { uuid: makeUuid() });

      expect(settings.roots[0].path).toBe(fs.realpathSync.native(real));
      expect(settings.roots[0].path).not.toBe(link);
      expect(settings.syncSessions[0].legacyMetaDir).toBe(sha12(link));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  test('removes the legacy keys', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      serverFolder: '/Users/alex/Sites',
      syncFolder: '/Users/alex/Sites',
      syncUsername: 'alex',
      hasApiKey: true,
      apiKey: 'ciphertext-blob'
    };

    const { settings } = migrateSettings(legacy, { uuid: makeUuid() });

    for (const key of LEGACY_KEYS) {
      expect(settings[key]).toBeUndefined();
    }
  });

  test('preserves aiEdit, autoStartEnabled, deviceId and the apiKey ciphertext', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      apiKey: 'ciphertext-blob',
      serverUrl: 'https://hyperclay.com',
      deviceId: 'device-1',
      autoStartEnabled: true,
      aiEdit: { enabled: false }
    };

    const { settings } = migrateSettings(legacy, { uuid: makeUuid() });

    expect(settings.deviceId).toBe('device-1');
    expect(settings.autoStartEnabled).toBe(true);
    expect(settings.aiEdit).toEqual({ enabled: false });
    expect(settings.apiKey).toBe('ciphertext-blob');
    expect(settings.serverUrl).toBe('https://hyperclay.com');
    expect(settings.serverEnabled).toBe(false);
    expect(settings.syncEnabled).toBe(false);
  });

  test('returns v2 settings untouched', () => {
    const v2 = {
      settingsVersion: 2,
      deviceId: 'device-1',
      apiKey: 'ciphertext-blob',
      actor: { id: 17, username: 'alex' },
      serverEnabled: true,
      syncEnabled: true,
      roots: [
        { id: 'root-1', kind: 'personal', path: '/Users/alex/Sites', port: PERSONAL_PORT, trustedAt: null },
        { id: 'root-2', kind: 'team', path: '/Users/alex/hyperclay/acme', port: 5432, trustedAt: '2026-09-23T12:00:00.000Z', formerAccount: null }
      ],
      syncSessions: [
        {
          id: 'session-1',
          rootId: 'root-2',
          accountId: 42,
          kind: 'team',
          cached: { username: 'acme', displayName: 'Acme', role: 'editor' },
          paused: null,
          legacyMetaDir: null
        }
      ],
      seenTeamIds: [42, 51],
      autoStartEnabled: true,
      aiEdit: { enabled: false }
    };
    const snapshot = JSON.parse(JSON.stringify(v2));

    const { settings, migrated } = migrateSettings(v2, { uuid: makeUuid() });

    expect(migrated).toBe(false);
    expect(settings).toBe(v2);
    expect(settings).toEqual(snapshot);
  });

  test('running the migration twice yields the same settings', () => {
    const legacy = {
      selectedFolder: '/Users/alex/Sites',
      apiKey: 'ciphertext-blob',
      syncEnabled: true,
      syncUsername: 'alex',
      deviceId: 'device-1',
      autoStartEnabled: true
    };
    const uuid = makeUuid();

    const first = migrateSettings(legacy, { uuid });
    const second = migrateSettings(first.settings, { uuid });

    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });
});
