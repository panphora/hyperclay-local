const { rootAccountFor } = require('../../src/main/helpers/root-account');

const TEAM_ROOT = { id: 'team-1', kind: 'team', path: '/Users/alex/Acme' };

const session = (overrides = {}) => ({
  id: 'session-1',
  rootId: TEAM_ROOT.id,
  accountId: 42,
  kind: 'team',
  cached: { username: 'alex', displayName: 'Acme', role: 'editor' },
  ...overrides,
});

describe('rootAccountFor', () => {
  test('a personal root is personal whatever its bound session says', () => {
    const personal = { id: 'personal', kind: 'personal', path: '/Users/alex/Sites' };
    const settings = { syncSessions: [session({ rootId: 'personal', kind: 'personal' })] };

    expect(rootAccountFor(personal, settings)).toEqual({ accountId: null, teamName: null });
  });

  test('a connected team root answers its session account and display name', () => {
    expect(rootAccountFor(TEAM_ROOT, { syncSessions: [session()] }))
      .toEqual({ accountId: 42, teamName: 'Acme' });
  });

  test('a team root whose session is gone still answers its former account', () => {
    const root = { ...TEAM_ROOT, formerAccount: { id: 42, username: 'acme' } };

    expect(rootAccountFor(root, { syncSessions: [] })).toEqual({ accountId: 42, teamName: 'acme' });
  });

  test('a team root with no session and no former account answers a stable placeholder', () => {
    expect(rootAccountFor(TEAM_ROOT, {})).toEqual({ accountId: 'root:team-1', teamName: null });
  });

  test('a missing root is personal', () => {
    expect(rootAccountFor(null, { syncSessions: [session()] })).toEqual({ accountId: null, teamName: null });
  });
});
