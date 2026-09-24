const { buildCards, trayMenuModel } = require('../../src/main/ui/card-model');

const HOME = '/Users/alex';

function snapshot(overrides = {}) {
  return {
    serverEnabled: true,
    syncEnabled: true,
    hasApiKey: true,
    actor: { id: 17, username: 'alex' },
    roots: [],
    sessions: [],
    accounts: [],
    home: HOME,
    ...overrides,
  };
}

function personalRoot(overrides = {}) {
  return {
    id: 'root-personal',
    kind: 'personal',
    path: `${HOME}/hyperclay`,
    port: 4321,
    running: true,
    portTaken: false,
    nextPort: null,
    ...overrides,
  };
}

function teamRoot(overrides = {}) {
  return {
    id: 'root-acme',
    kind: 'team',
    path: `${HOME}/hyperclay-teams/acme`,
    port: 5432,
    running: true,
    portTaken: false,
    nextPort: null,
    formerAccount: null,
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: 'session-acme',
    rootId: 'root-acme',
    accountId: 42,
    kind: 'team',
    cached: { username: 'acme', displayName: 'Acme', role: 'editor' },
    paused: null,
    status: 'idle',
    pendingCount: 0,
    conflicts: [],
    lastSyncAt: '2026-09-23T12:00:00.000Z',
    lastError: null,
    ...overrides,
  };
}

function teamAccount(overrides = {}) {
  return {
    id: 42,
    kind: 'team',
    username: 'acme',
    displayName: 'Acme',
    role: 'editor',
    syncBase: '/_/team/acme/sync',
    lifecycle: 'active',
    sync: { enabled: true, reason: null },
    webUrl: 'https://hyperclay.com/acme',
    ...overrides,
  };
}

const FLAGS = { serverEnabled: true, syncEnabled: true, hasApiKey: true, aiEditEnabled: false };
const submenus = (items) => items.filter((item) => item.submenu);

// personal, one team with a root, one team to set up, one viewer team
function mixedCards(overrides = {}) {
  return buildCards(snapshot({
    roots: [personalRoot(), teamRoot()],
    sessions: [session()],
    accounts: [
      teamAccount({ id: 61, username: 'gamma', displayName: 'Gamma' }),
      teamAccount({
        id: 51,
        username: 'beta-co',
        displayName: 'Beta Co',
        role: 'viewer',
        sync: { enabled: false, reason: 'viewer' },
        webUrl: 'https://hyperclay.com/beta-co',
      }),
    ],
    ...overrides,
  }));
}

describe('trayMenuModel', () => {
  test('one submenu per non-viewer card, in card order', () => {
    const items = trayMenuModel(mixedCards(), FLAGS);

    expect(submenus(items).map((item) => item.label)).toEqual([
      'alex  localhost:4321',
      'acme  localhost:5432',
      'gamma  (not set up)',
    ]);
    expect(items.some((item) => String(item.label).includes('beta-co'))).toBe(false);
  });

  test('a viewer-only list has no card submenus at all', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot()],
      accounts: [teamAccount({
        id: 51,
        username: 'beta-co',
        displayName: 'Beta Co',
        role: 'viewer',
        sync: { enabled: false, reason: 'viewer' },
      })],
    }));

    expect(cards.map((card) => card.state)).toEqual(['serve-only', 'viewer']);
    expect(submenus(trayMenuModel(cards, FLAGS)).map((item) => item.label)).toEqual(['alex  localhost:4321']);
  });

  test('Open in Browser is disabled when url is null', () => {
    const stopped = trayMenuModel(mixedCards({ serverEnabled: false }), { ...FLAGS, serverEnabled: false });
    const acme = submenus(stopped).find((item) => item.label === 'acme  (not served)');
    const open = acme.submenu.find((item) => item.label === 'Open in Browser');
    expect(open.enabled).toBe(false);

    const serving = submenus(trayMenuModel(mixedCards(), FLAGS)).find((item) => item.label === 'acme  localhost:5432');
    expect(serving.submenu.find((item) => item.label === 'Open in Browser').enabled).toBe(true);
  });

  test('a setup card offers Set Up…', () => {
    const gamma = submenus(trayMenuModel(mixedCards(), FLAGS)).find((item) => item.label === 'gamma  (not set up)');

    expect(gamma.submenu).toEqual([{ label: 'Set Up…', enabled: true }]);
  });

  test('the singleton Open Folder, Backups and Open Browser items are gone', () => {
    const items = trayMenuModel(mixedCards(), FLAGS);
    const top = items.filter((item) => !item.type).map((item) => item.label);

    expect(top).not.toContain('Open Folder');
    expect(top).not.toContain('Backups');
    expect(top).not.toContain('Open Browser');
    expect(top).toContain('View Sync Logs');
    expect(top).toContain('Quit');
  });

  test('the switch lines are disabled and Enable Sync needs a key', () => {
    const items = trayMenuModel([], { serverEnabled: true, syncEnabled: false, hasApiKey: false, aiEditEnabled: true });

    expect(items[0]).toEqual({ label: 'Server: On', enabled: false });
    expect(items[1]).toEqual({ label: 'Sync: Off', enabled: false });
    expect(items[2]).toEqual({ label: 'AI Editing: On', enabled: false });
    expect(items.find((item) => item.label === 'Stop Server')).toEqual({ label: 'Stop Server' });
    expect(items.find((item) => item.label === 'Enable Sync')).toEqual({ label: 'Enable Sync', enabled: false });
    expect(items.find((item) => item.label === 'Disable AI Editing')).toEqual({ label: 'Disable AI Editing' });
    expect(submenus(items)).toEqual([]);
  });

  test('a team card offers its folder actions and a personal card does not offer remove', () => {
    const items = trayMenuModel(mixedCards(), FLAGS);
    const acme = submenus(items).find((item) => item.label === 'acme  localhost:5432');
    const alex = submenus(items).find((item) => item.label === 'alex  localhost:4321');

    expect(acme.submenu.map((item) => item.label)).toEqual([
      'Open in Browser', 'Reveal Folder', 'Backups', 'Disconnect…', 'Remove Folder…',
    ]);
    expect(alex.submenu.map((item) => item.label)).toEqual(['Open in Browser', 'Reveal Folder', 'Backups']);
  });
});
