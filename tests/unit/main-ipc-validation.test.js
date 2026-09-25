const {
  isAllowedExternalUrl,
  requireRoot,
  requireSession,
  requireAccount,
  disconnectDialog,
  removeFolderDialog,
  movePortDialog,
  cardMenuModel,
  flattenConflicts,
  createThrottle,
} = require('../../src/main/ui/main-ipc');

const HOME = '/Users/alex';
const ROOTS = [
  { id: 'root-personal', kind: 'personal', path: `${HOME}/hyperclay`, port: 4321 },
  { id: 'root-acme', kind: 'team', path: `${HOME}/hyperclay/acme`, port: 5432 },
];
const SESSIONS = [
  { id: 'session-personal', rootId: 'root-personal', accountId: 17 },
  { id: 'session-acme', rootId: 'root-acme', accountId: 42 },
];
const ACCOUNTS = [
  { id: 17, kind: 'personal', username: 'alex' },
  { id: 42, kind: 'team', username: 'acme', displayName: 'Acme' },
];

describe('IPC ids are validated against settings', () => {
  test('an unknown rootId is unknown', () => {
    expect(requireRoot(ROOTS, 'root-nope')).toEqual({ ok: false, error: 'unknown' });
  });

  test('an unknown sessionId is unknown', () => {
    expect(requireSession(SESSIONS, 'session-nope')).toEqual({ ok: false, error: 'unknown' });
  });

  test('an unknown accountId is unknown', () => {
    expect(requireAccount(ACCOUNTS, 99)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a missing id is unknown, never a throw', () => {
    expect(requireRoot(ROOTS, undefined)).toEqual({ ok: false, error: 'unknown' });
    expect(requireSession(SESSIONS, null)).toEqual({ ok: false, error: 'unknown' });
    expect(requireAccount(ACCOUNTS, null)).toEqual({ ok: false, error: 'unknown' });
    expect(requireRoot([], 'root-acme')).toEqual({ ok: false, error: 'unknown' });
    expect(requireSession([], 'session-acme')).toEqual({ ok: false, error: 'unknown' });
    expect(requireAccount([], 42)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a known id answers with the record', () => {
    expect(requireRoot(ROOTS, 'root-acme')).toEqual({ ok: true, root: ROOTS[1] });
    expect(requireSession(SESSIONS, 'session-acme')).toEqual({ ok: true, session: SESSIONS[1] });
    expect(requireAccount(ACCOUNTS, 42)).toEqual({ ok: true, account: ACCOUNTS[1] });
  });

  test('an accountId of another type is not the account', () => {
    expect(requireAccount(ACCOUNTS, '42')).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('open-browser accepts only the two hyperclay https prefixes', () => {
  test('rejects a local port', () => {
    expect(isAllowedExternalUrl('http://localhost:4321')).toBe(false);
    expect(isAllowedExternalUrl('http://localhost:5432/board.html')).toBe(false);
  });

  test('rejects another host', () => {
    expect(isAllowedExternalUrl('https://evil.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://hyperclay.com.evil.com/')).toBe(false);
    expect(isAllowedExternalUrl('http://hyperclay.com/x')).toBe(false);
  });

  test('rejects anything that is not a URL string', () => {
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl(undefined)).toBe(false);
    expect(isAllowedExternalUrl(5432)).toBe(false);
  });

  test('accepts the two the app builds', () => {
    expect(isAllowedExternalUrl('https://hyperclay.com/x')).toBe(true);
    expect(isAllowedExternalUrl('https://hyperclay.com/dashboard')).toBe(true);
    expect(isAllowedExternalUrl('https://hyperclaylocal.com/')).toBe(true);
  });
});

describe('native dialog copy (C4 §4.9)', () => {
  test('disconnect names the team, keeps the folder and the port', () => {
    expect(disconnectDialog({ team: 'Acme', folder: `${HOME}/hyperclay/acme`, port: 5432 })).toEqual({
      type: 'question',
      message: 'Disconnect Acme?',
      detail: `Sync stops. The folder ${HOME}/hyperclay/acme stays on your computer and is still served at localhost:5432.`,
      buttons: ['Disconnect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
  });

  test('remove-folder says the port stops answering and the files stay', () => {
    expect(removeFolderDialog({ folder: `${HOME}/hyperclay/acme`, port: 5432 })).toEqual({
      type: 'question',
      message: `Remove ${HOME}/hyperclay/acme?`,
      detail: 'Sync stops and localhost:5432 stops answering. The folder and its files stay on your computer.',
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
  });

  test('use port proposes the next port and warns about the old one', () => {
    expect(movePortDialog({ title: 'acme', port: 5432, nextPort: 6543 })).toEqual({
      type: 'question',
      message: 'Move acme to localhost:6543?',
      detail: 'Links and bookmarks to localhost:5432 will stop working. The htmlclay wire command finds the new port by itself.',
      buttons: ['Move', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
  });
});

describe('card menu model', () => {
  const teamCard = {
    rootId: 'root-acme', sessionId: 'session-acme', kind: 'team',
    folder: '~/hyperclay-teams/acme', url: 'http://localhost:5432',
    actions: ['open', 'reveal', 'backups', 'disconnect', 'remove'],
  };
  const personalCard = {
    rootId: 'root-personal', sessionId: 'session-personal', kind: 'personal',
    folder: '~/HyperclayApps/local-hyperclay-apps', url: 'http://localhost:4321',
    actions: ['open', 'reveal', 'backups'],
  };

  test('a served team card: the folder, open, copy, reveal, backups, then disconnect and remove', () => {
    expect(cardMenuModel(teamCard, 'darwin')).toEqual([
      { label: '~/hyperclay-teams/acme', enabled: false },
      { type: 'separator' },
      { label: 'Open in Browser', action: 'open' },
      { label: 'Copy Address', action: 'copy' },
      { label: 'Reveal Folder', action: 'reveal' },
      { label: 'Backups', action: 'backups' },
      { type: 'separator' },
      { label: 'Disconnect…', action: 'disconnect' },
      { label: 'Remove Folder…', action: 'remove' },
    ]);
  });

  test('a personal card has no disconnect and no remove', () => {
    expect(cardMenuModel(personalCard, 'darwin')).toEqual([
      { label: '~/HyperclayApps/local-hyperclay-apps', enabled: false },
      { type: 'separator' },
      { label: 'Open in Browser', action: 'open' },
      { label: 'Copy Address', action: 'copy' },
      { label: 'Reveal Folder', action: 'reveal' },
      { label: 'Backups', action: 'backups' },
    ]);
  });

  test('a folder that is not served cannot be opened and has no address to copy', () => {
    expect(cardMenuModel({ ...personalCard, url: null }, 'darwin')).toEqual([
      { label: '~/HyperclayApps/local-hyperclay-apps', enabled: false },
      { type: 'separator' },
      { label: 'Open in Browser', action: 'open', enabled: false },
      { label: 'Reveal Folder', action: 'reveal' },
      { label: 'Backups', action: 'backups' },
    ]);
  });

  test('a card without a folder has no header', () => {
    expect(cardMenuModel({ ...personalCard, folder: null }, 'darwin')[0])
      .toEqual({ label: 'Open in Browser', action: 'open' });
  });

  test('outside macOS an ampersand in the path is doubled so it is not an accelerator', () => {
    expect(cardMenuModel({ ...personalCard, folder: '~/Tom & Jerry' }, 'win32')[0])
      .toEqual({ label: '~/Tom && Jerry', enabled: false });
    expect(cardMenuModel({ ...personalCard, folder: '~/Tom & Jerry' }, 'darwin')[0])
      .toEqual({ label: '~/Tom & Jerry', enabled: false });
  });
});

describe('state payload (C4 §5.4)', () => {
  test('flattens conflicts from every session with their sessionId', () => {
    const statuses = [
      { sessionId: 'session-personal', conflicts: [{ path: 'index.html', kind: 'both-edited' }] },
      { sessionId: 'session-acme', conflicts: [] },
      { sessionId: 'session-west', conflicts: [{ path: 'notes/a.md', kind: 'both-edited' }, { path: 'b.md', kind: 'remote-deleted' }] },
      { sessionId: 'session-north' },
    ];

    expect(flattenConflicts(statuses)).toEqual([
      { sessionId: 'session-personal', path: 'index.html', kind: 'both-edited' },
      { sessionId: 'session-west', path: 'notes/a.md', kind: 'both-edited' },
      { sessionId: 'session-west', path: 'b.md', kind: 'remote-deleted' },
    ]);
    expect(flattenConflicts([])).toEqual([]);
    expect(flattenConflicts(undefined)).toEqual([]);
  });

  test('throttle sends at most once per 250 ms and always sends the trailing call', () => {
    jest.useFakeTimers();

    try {
      const sends = [];
      const throttled = createThrottle(() => sends.push(Date.now()));

      throttled();
      expect(sends).toHaveLength(1);
      const first = sends[0];

      for (let i = 0; i < 5; i += 1) {
        jest.advanceTimersByTime(20);
        throttled();
      }

      expect(sends).toHaveLength(1);
      expect(Date.now() - first).toBe(100);

      jest.advanceTimersByTime(200);
      expect(sends).toHaveLength(2);
      expect(sends[1] - first).toBe(250);

      jest.advanceTimersByTime(5000);
      expect(sends).toHaveLength(2);

      jest.advanceTimersByTime(250);
      throttled();
      expect(sends).toHaveLength(3);
      expect(sends[2] - sends[1]).toBe(5300);

      throttled.cancel();
      jest.advanceTimersByTime(1000);
      expect(sends).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
