const {
  buildCards,
  worstState,
  trayIconVariant,
  trayTooltip,
  switchSublines,
  toLine,
  trayMenuModel,
  STATE_ORDER,
} = require('../../src/main/ui/card-model');

const HOME = '/Users/alex';

function snapshot(overrides = {}) {
  return {
    serverEnabled: true,
    syncEnabled: true,
    hasApiKey: true,
    actor: { id: 17, username: 'alex' },
    serverUpdateRequired: false,
    keyInvalid: false,
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

describe('buildCards', () => {
  test('personal only, no key: one serve-only card with the folder name', () => {
    const cards = buildCards(snapshot({
      hasApiKey: false,
      actor: null,
      roots: [personalRoot({ path: `${HOME}/HyperclayApps/my-apps` })],
    }));

    expect(cards).toHaveLength(1);
    expect(cards[0].state).toBe('serve-only');
    expect(cards[0].detail).toBe('not synced');
    expect(cards[0].detailLong).toBe('Served locally. Connect to sync it with hyperclay.com.');
    expect(cards[0].actions).toEqual(['open', 'reveal', 'backups']);
    expect(cards[0].folder).toBe('~/HyperclayApps/my-apps');
    expect(cards[0].folder.startsWith('~/')).toBe(true);
    expect(cards[0].title).toBe('my-apps');
  });

  test('ordering: personal first, then teams by displayName, case-insensitively', () => {
    const accounts = [
      teamAccount({ id: 61, username: 'zeta', displayName: 'Zeta', webUrl: 'https://hyperclay.com/zeta' }),
      teamAccount({ id: 51, username: 'beta-co', displayName: 'Beta' }),
      teamAccount(),
    ];
    const cards = buildCards(snapshot({
      roots: [teamRoot(), personalRoot()],
      sessions: [session()],
      accounts,
    }));

    expect(cards.map((card) => card.title)).toEqual(['alex', 'acme', 'beta-co', 'zeta']);
  });

  test('ordering: a team keeps its place when it moves from setup to synced', () => {
    const accounts = [
      teamAccount({ id: 61, username: 'zeta', displayName: 'Zeta', webUrl: 'https://hyperclay.com/zeta' }),
      teamAccount(),
    ];

    const setup = buildCards(snapshot({ roots: [personalRoot()], accounts }));
    expect(setup.map((card) => card.state)).toEqual(['serve-only', 'setup', 'setup']);
    expect(setup.map((card) => card.title)).toEqual(['alex', 'acme', 'zeta']);

    const synced = buildCards(snapshot({ roots: [personalRoot(), teamRoot()], accounts, sessions: [session()] }));
    expect(synced.map((card) => card.title)).toEqual(['alex', 'acme', 'zeta']);
    expect(synced[1].state).toBe('synced');
  });

  test('setup card: an enabled team without a session', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot()],
      accounts: [teamAccount({ id: 61, username: 'gamma', displayName: 'Gamma' })],
    }));

    const card = cards[1];
    expect(card.state).toBe('setup');
    expect(card.rootId).toBeUndefined();
    expect(card.accountId).toBe(61);
    expect(card.actions).toEqual(['setup']);
    expect(card.folder).toBeNull();
    expect(card.url).toBeNull();
    expect(card.detail).toBe('not on this computer');
    expect(card.detailLong).toBe("You're an editor on Gamma. Set up a folder to sync it here.");
  });

  test('viewer card: reason viewer, webUrl copied, and no tray item', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot()],
      accounts: [teamAccount({
        id: 51,
        username: 'beta-co',
        displayName: 'Beta Co',
        role: 'viewer',
        sync: { enabled: false, reason: 'viewer' },
        webUrl: 'https://hyperclay.com/beta-co',
      })],
    }));

    const card = cards[1];
    expect(card.state).toBe('viewer');
    expect(card.webUrl).toBe('https://hyperclay.com/beta-co');
    expect(card.actions).toEqual(['web']);
    expect(card.rootId).toBeUndefined();
    expect(card.detail).toBe('viewers use the site');
    expect(card.detailLong).toBe("You're a viewer on Beta Co. Viewers open team documents on hyperclay.com.");

    const menu = trayMenuModel(cards, { serverEnabled: true, syncEnabled: true, hasApiKey: true, aiEditEnabled: false });
    expect(menu.some((item) => String(item.label).includes('beta-co'))).toBe(false);
  });

  const PAUSED_COPY = {
    viewer: {
      detail: "paused: you're a viewer",
      detailLong: "You're now a viewer on Acme. Your files are still here and still served at localhost:5432. Sync resumes if you're made an editor again.",
    },
    'plan-lapsed': {
      detail: 'paused: plan inactive',
      detailLong: "acme's plan isn't active. Your files are still here and still served. Sync resumes when the plan is active again.",
    },
    removed: {
      detail: 'paused: not on acme',
      detailLong: "You're no longer on Acme. Your files are still here and still served. Sync resumes if you're added back.",
    },
    unavailable: {
      detail: 'paused: team unavailable',
      detailLong: 'Acme was deleted or is unavailable on hyperclay.com. Your files are still here and still served.',
    },
    'key-revoked': {
      detail: 'paused: reconnect',
      detailLong: 'Your sync key no longer works. Reconnect to resume.',
    },
    forbidden: {
      detail: 'paused: no sync access',
      detailLong: "Your role on Acme doesn't allow syncing right now. Your files are still here and still served.",
    },
    'server-update-required': {
      detail: 'paused: waiting for hyperclay.com',
      detailLong: "hyperclay.com needs an update before this folder can sync. It's still served.",
    },
    'folder-missing': {
      detail: 'paused: folder missing',
      detailLong: "This folder isn't there any more, so nothing syncs and nothing was deleted on hyperclay.com. Put it back, or Disconnect.",
    },
    'identity-mismatch': {
      detail: 'paused: set up again',
      detailLong: "This folder's sync records belong to a different account or folder, so nothing syncs. Disconnect, then set it up again.",
    },
  };

  for (const [reason, copy] of Object.entries(PAUSED_COPY)) {
    test(`paused copy: ${reason}`, () => {
      const cards = buildCards(snapshot({
        roots: [personalRoot(), teamRoot()],
        sessions: [session({ status: 'paused', paused: { reason, since: '2026-09-23T12:00:00.000Z' } })],
      }));

      const card = cards[1];
      expect(card.state).toBe('paused');
      expect(card.detail).toBe(copy.detail);
      expect(card.detailLong).toBe(copy.detailLong);
      expect(card.actions).toContain('disconnect');
    });
  }

  test('personal plan-lapsed wording says your hyperclay.com plan', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot()],
      sessions: [session({
        id: 'session-personal',
        rootId: 'root-personal',
        accountId: 17,
        kind: 'personal',
        cached: { username: 'alex', displayName: 'alex', role: 'owner' },
        status: 'paused',
        paused: { reason: 'plan-lapsed', since: '2026-09-23T12:00:00.000Z' },
      })],
    }));

    expect(cards[0].state).toBe('paused');
    expect(cards[0].detail).toBe('paused: plan inactive');
    expect(cards[0].detailLong).toBe("your hyperclay.com plan isn't active. Your files are still here and still served. Sync resumes when the plan is active again.");
  });

  test('personal folder-missing and identity-mismatch reach the same copy', () => {
    for (const reason of ['folder-missing', 'identity-mismatch']) {
      const cards = buildCards(snapshot({
        roots: [personalRoot()],
        sessions: [session({
          id: 'session-personal',
          rootId: 'root-personal',
          accountId: 17,
          kind: 'personal',
          cached: { username: 'alex', displayName: 'alex', role: 'owner' },
          status: 'paused',
          paused: { reason, since: '2026-09-23T12:00:00.000Z' },
        })],
      }));

      expect(cards[0].state).toBe('paused');
      expect(cards[0].detail).toBe(PAUSED_COPY[reason].detail);
      expect(cards[0].detailLong).toBe(PAUSED_COPY[reason].detailLong);
      expect(cards[0].actions).toContain('disconnect');
    }
  });

  test('port-taken: the root wins over a paused session and offers both actions', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot(), teamRoot({ portTaken: true, running: false, nextPort: 6543 })],
      sessions: [session({ status: 'paused', paused: { reason: 'viewer', since: '2026-09-23T12:00:00.000Z' } })],
    }));

    const card = cards[1];
    expect(card.state).toBe('port-taken');
    expect(card.port).toBe(5432);
    expect(card.nextPort).toBe(6543);
    expect(card.url).toBeNull();
    expect(card.detail).toBe('Not served. Another program has :5432.');
    expect(card.detailLong).toBe('Not served. Another program has :5432.');
    expect(card.actions).toContain('retry');
    expect(card.actions).toContain('change-port');
  });

  test('server off: url null, port present', () => {
    const cards = buildCards(snapshot({
      serverEnabled: false,
      roots: [personalRoot({ running: false }), teamRoot({ running: false })],
      sessions: [session()],
    }));

    expect(cards[0].url).toBeNull();
    expect(cards[0].port).toBe(4321);
    expect(cards[1].url).toBeNull();
    expect(cards[1].port).toBe(5432);
    expect(cards[1].state).toBe('synced');
  });

  test('sync off globally: a healthy team session is serve-only / sync off', () => {
    const cards = buildCards(snapshot({
      syncEnabled: false,
      roots: [personalRoot(), teamRoot()],
      sessions: [session()],
    }));

    expect(cards[1].state).toBe('serve-only');
    expect(cards[1].detail).toBe('sync off');
    expect(cards[1].detailLong).toBe('Sync is off for all folders.');
  });

  test('disconnected team root: local only, still served, removable', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot(), teamRoot({ formerAccount: { id: 42, username: 'acme' } })],
      sessions: [],
      accounts: [teamAccount()],
    }));

    expect(cards).toHaveLength(2);
    const card = cards[1];
    expect(card.state).toBe('serve-only');
    expect(card.sessionId).toBeNull();
    expect(card.accountId).toBe(42);
    expect(card.detail).toBe('local only · was acme');
    expect(card.detailLong).toBe('Disconnected from acme. Still served here; nothing syncs.');
    expect(card.actions).toEqual(['open', 'reveal', 'backups', 'remove']);
  });

  test('no secrets: cards carry no key and no server url', () => {
    const cards = buildCards(snapshot({
      apiKey: 'hcsk_live_1234567890',
      serverUrl: 'https://hyperclay.com',
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ lastError: 'boom' })],
    }));

    const json = JSON.stringify(cards);
    expect(json).not.toContain('hcsk_');
    expect(json).not.toContain('https://');
    expect(json).not.toContain('serverUrl');
  });

  test('syncing uses the pending count, or no count at all', () => {
    const counted = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ status: 'syncing', pendingCount: 3 })],
    }));
    expect(counted[1].state).toBe('syncing');
    expect(counted[1].detail).toBe('syncing 3 files…');

    const unknown = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ status: 'syncing', pendingCount: null })],
    }));
    expect(unknown[1].detail).toBe('syncing…');
  });

  test('conflict counts files and points at the notices', () => {
    const one = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ status: 'conflict', conflicts: [{ path: 'board.html', kind: 'content' }] })],
    }));
    expect(one[1].state).toBe('conflict');
    expect(one[1].detail).toBe('1 conflict');

    const many = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({
        status: 'conflict',
        conflicts: [{ path: 'a.html', kind: 'content' }, { path: 'b.html', kind: 'content' }],
      })],
    }));
    expect(many[1].detail).toBe('2 conflicts');
    expect(many[1].detailLong).toBe('A file changed here and on hyperclay.com. Both copies are kept; see Notices.');
  });

  test('offline and error carry their own copy', () => {
    const offline = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ status: 'offline' })],
    }));
    expect(offline[1].state).toBe('offline');
    expect(offline[1].detail).toBe('offline');
    expect(offline[1].detailLong).toBe("Can't reach hyperclay.com. Changes sync when you're back online.");

    const failed = buildCards(snapshot({
      roots: [personalRoot(), teamRoot()],
      sessions: [session({ status: 'error', lastError: 'Failed to sync board.html' })],
    }));
    expect(failed[1].state).toBe('error');
    expect(failed[1].detail).toBe('sync error');
    expect(failed[1].detailLong).toBe('Failed to sync board.html');
  });

  test('subtitle is the account, the role and the folder', () => {
    const cards = buildCards(snapshot({ roots: [personalRoot(), teamRoot()], sessions: [session()] }));

    expect(cards[0].subtitle).toBe('personal');
    expect(cards[1].subtitle).toBe('Acme · editor');
    expect(cards[1].folder).toBe('~/hyperclay-teams/acme');
    expect(cards[1].url).toBe('http://localhost:5432');
    expect(cards[1].lastSyncAt).toBe('2026-09-23T12:00:00.000Z');
  });
});

describe('worstState', () => {
  test('conflict outranks synced and paused', () => {
    expect(worstState([{ state: 'synced' }, { state: 'paused' }, { state: 'conflict' }])).toBe('conflict');
  });

  test('port-taken outranks conflict, error outranks port-taken', () => {
    expect(worstState([{ state: 'conflict' }, { state: 'port-taken' }])).toBe('port-taken');
    expect(worstState([{ state: 'port-taken' }, { state: 'error' }])).toBe('error');
  });

  test('no cards is serve-only', () => {
    expect(worstState([])).toBe('serve-only');
  });

  test('every state in STATE_ORDER is reachable', () => {
    for (const state of STATE_ORDER) expect(worstState([{ state }])).toBe(state);
  });
});

describe('trayIconVariant', () => {
  test('error, port-taken and conflict ask for alert', () => {
    expect(trayIconVariant('error')).toBe('alert');
    expect(trayIconVariant('port-taken')).toBe('alert');
    expect(trayIconVariant('conflict')).toBe('alert');
  });

  test('paused and offline are dim', () => {
    expect(trayIconVariant('paused')).toBe('dim');
    expect(trayIconVariant('offline')).toBe('dim');
  });

  test('the rest, and an empty list, stay normal', () => {
    for (const state of ['synced', 'syncing', 'setup', 'viewer', 'serve-only', undefined]) {
      expect(trayIconVariant(state)).toBe('normal');
    }
  });
});

describe('trayTooltip', () => {
  test('all healthy is the plain name', () => {
    expect(trayTooltip([{ state: 'synced' }, { state: 'serve-only' }])).toBe('Hyperclay Local');
    expect(trayTooltip([])).toBe('Hyperclay Local');
  });

  test('one paused of three names the count and the worst state', () => {
    expect(trayTooltip([{ state: 'synced' }, { state: 'synced' }, { state: 'paused' }]))
      .toBe('Hyperclay Local: 3 folders, 1 paused');
  });

  test('one folder is singular', () => {
    expect(trayTooltip([{ state: 'offline' }])).toBe('Hyperclay Local: 1 folder, 1 offline');
  });
});

describe('switchSublines', () => {
  test('server on counts what is served, off counts what starts', () => {
    const roots = [personalRoot(), teamRoot()];
    const on = buildCards(snapshot({ roots, sessions: [session()] }));
    expect(switchSublines(snapshot({ roots }), on)).toEqual({ server: '2 folders served', sync: '@alex' });

    const stopped = snapshot({ serverEnabled: false, roots: [personalRoot()] });
    expect(switchSublines(stopped, buildCards(stopped)))
      .toEqual({ server: 'starts 1 folder', sync: '@alex' });
  });

  test('sync off with a stored key is paused, no key syncs with the website', () => {
    const cards = buildCards(snapshot({ roots: [personalRoot()] }));
    expect(switchSublines(snapshot({ syncEnabled: false }), cards).sync).toBe('@alex · paused');
    expect(switchSublines(snapshot({ hasApiKey: false }), cards).sync).toBe('syncs with hyperclay.com');
  });

  test('cards without a root are not served folders', () => {
    const cards = buildCards(snapshot({
      roots: [personalRoot()],
      accounts: [teamAccount({ id: 61, username: 'gamma', displayName: 'Gamma' })],
    }));
    expect(switchSublines(snapshot(), cards).server).toBe('1 folder served');
  });
});

describe('toLine', () => {
  const sessionsById = new Map([
    ['session-acme', { id: 'session-acme', kind: 'team', cached: { username: 'acme' } }],
    ['session-personal', { id: 'session-personal', kind: 'personal', cached: { username: 'alex' } }],
  ]);

  test('a team session event is namespaced by the team username', () => {
    expect(toLine({
      file: 'board.html',
      action: 'upload',
      sessionId: 'session-acme',
      timestamp: '2026-09-23T12:00:00.000Z',
    }, sessionsById, 'alex')).toEqual({
      time: '2026-09-23T12:00:00.000Z',
      path: 'acme/board.html',
      verb: 'uploaded',
      sessionId: 'session-acme',
    });
  });

  test('a personal session event is namespaced by the personal username', () => {
    expect(toLine({
      file: 'notes/a.html',
      action: 'download',
      sessionId: 'session-personal',
      timestamp: '2026-09-23T12:04:00.000Z',
    }, sessionsById, 'alex')).toEqual({
      time: '2026-09-23T12:04:00.000Z',
      path: 'alex/notes/a.html',
      verb: 'downloaded',
      sessionId: 'session-personal',
    });
  });

  test('upload, download, create, trash, relocate and conflict map to their verbs', () => {
    const verbs = {
      upload: 'uploaded',
      download: 'downloaded',
      create: 'downloaded',
      trash: 'deleted',
      relocate: 'renamed',
      conflict: 'conflict',
    };
    for (const [action, verb] of Object.entries(verbs)) {
      const line = toLine({ file: 'a.html', action, sessionId: 'session-acme' }, sessionsById, 'alex');
      expect(line.verb).toBe(verb);
      expect(line.path).toBe('acme/a.html');
    }
  });

  test('an unknown action gives null', () => {
    expect(toLine({ file: 'a.html', action: 'noop', sessionId: 'session-acme' }, sessionsById, 'alex')).toBeNull();
  });

  test('an unknown session falls back to the personal username', () => {
    expect(toLine({ file: 'a.html', action: 'upload', sessionId: 'gone' }, sessionsById, 'alex').path).toBe('alex/a.html');
  });
});
