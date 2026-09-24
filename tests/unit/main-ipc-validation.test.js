const {
  isAllowedExternalUrl,
  requireRoot,
  requireSession,
  requireAccount,
  disconnectDialog,
  removeFolderDialog,
  movePortDialog,
  cardMenuModel,
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
  const teamCard = { rootId: 'root-acme', sessionId: 'session-acme', kind: 'team', actions: ['open', 'reveal', 'backups', 'disconnect', 'remove'] };
  const personalCard = { rootId: 'root-personal', sessionId: 'session-personal', kind: 'personal', actions: ['open', 'reveal', 'backups'] };

  test('a team card offers open, reveal, backups, then disconnect and remove', () => {
    expect(cardMenuModel(teamCard)).toEqual([
      { label: 'Open in Browser', action: 'open' },
      { label: 'Reveal Folder', action: 'reveal' },
      { label: 'Backups', action: 'backups' },
      { type: 'separator' },
      { label: 'Disconnect…', action: 'disconnect' },
      { label: 'Remove Folder…', action: 'remove' },
    ]);
  });

  test('a personal card has no disconnect and no remove', () => {
    expect(cardMenuModel(personalCard)).toEqual([
      { label: 'Open in Browser', action: 'open' },
      { label: 'Reveal Folder', action: 'reveal' },
      { label: 'Backups', action: 'backups' },
    ]);
  });
});
