// Step 5b: a discovery answer describes the human whose key asked for it, so an answer
// that arrives after the key changed or was removed is dropped rather than cached as the
// person now signed in here.

jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  getAccounts: jest.fn(),
}));

const apiClient = require('../../src/sync-engine/api-client');
const { SyncManager } = require('../../src/main/sync-manager');

function makeManager(serverUrl, overrides = {}) {
  const settings = { roots: [], syncSessions: [], ...overrides };
  return new SyncManager({
    userData: '/tmp/unused',
    deviceId: 'device-1',
    serverUrl,
    getApiKey: () => 'hcsk_test',
    settingsStore: { get: () => settings, save: () => {} },
    observerFor: () => ({ setRemoteApplyCheck() {} }),
  });
}

describe('SyncManager key generation', () => {
  beforeEach(() => {
    apiClient.getAccounts.mockReset();
  });

  test('an answer that arrives after adoptKey is dropped', async () => {
    let resolveAccounts;
    apiClient.getAccounts.mockReturnValue(new Promise((resolve) => { resolveAccounts = resolve; }));

    const manager = makeManager('https://hyperclay.com');
    const events = [];
    manager.on('accounts', (discovery) => events.push(discovery));

    const pending = manager.refreshAccounts();
    manager.adoptKey({ serverUrl: 'https://hyperclay.com' });
    resolveAccounts({ actor: { id: 1 }, accounts: [] });

    expect(await pending).toBeNull();
    expect(manager.discovery).toBeNull();
    expect(events).toEqual([]);
  });

  test('an answer that arrives after forgetKey is dropped', async () => {
    let resolveAccounts;
    apiClient.getAccounts.mockReturnValue(new Promise((resolve) => { resolveAccounts = resolve; }));

    const manager = makeManager('https://hyperclay.com');
    const events = [];
    manager.on('accounts', (discovery) => events.push(discovery));

    const pending = manager.refreshAccounts();
    manager.forgetKey();
    resolveAccounts({ actor: { id: 1 }, accounts: [] });

    expect(await pending).toBeNull();
    expect(manager.discovery).toBeNull();
    expect(events).toEqual([]);
  });

  test('forgetKey clears the discovery already cached', async () => {
    apiClient.getAccounts.mockResolvedValue({ actor: { id: 1 }, accounts: [{ id: 7 }] });
    const manager = makeManager('https://hyperclay.com');

    await manager.refreshAccounts();
    expect(manager.discovery).toEqual({ actor: { id: 1 }, accounts: [{ id: 7 }] });

    manager.forgetKey();
    expect(manager.discovery).toBeNull();
    expect(manager.lastDiscoveryAt).toBe(0);
  });

  test('an answer with no key change in between is applied', async () => {
    const discovery = { actor: { id: 1 }, accounts: [{ id: 7 }] };
    apiClient.getAccounts.mockResolvedValue(discovery);
    const manager = makeManager('https://hyperclay.com');
    const events = [];
    manager.on('accounts', (answer) => events.push(answer));

    expect(await manager.refreshAccounts()).toBe(discovery);
    expect(manager.discovery).toBe(discovery);
    expect(events).toEqual([discovery]);
  });

  test('a pending failure from an old key is dropped, not announced', async () => {
    let rejectAccounts;
    apiClient.getAccounts.mockReturnValue(new Promise((resolve, reject) => { rejectAccounts = reject; }));

    const manager = makeManager('https://hyperclay.com');
    const rejected = [];
    manager.on('credentials-rejected', (error) => rejected.push(error));

    const pending = manager.refreshAccounts();
    manager.adoptKey({ serverUrl: 'https://hyperclay.com' });
    const error = new Error('unauthorized');
    error.statusCode = 401;
    rejectAccounts(error);

    await expect(pending).resolves.toBeNull();
    expect(rejected).toEqual([]);
  });

  test('a rejection with the key unchanged is announced', async () => {
    const manager = makeManager('https://hyperclay.com');
    const rejected = [];
    manager.on('credentials-rejected', (error) => rejected.push(error));
    const error = new Error('unauthorized');
    error.statusCode = 401;
    apiClient.getAccounts.mockRejectedValue(error);

    await expect(manager.refreshAccounts()).rejects.toBe(error);
    expect(rejected).toEqual([error]);
  });

  test('a failure that is not a rejection is not announced', async () => {
    const manager = makeManager('https://hyperclay.com');
    const rejected = [];
    manager.on('credentials-rejected', (error) => rejected.push(error));
    const error = new Error('server error');
    error.statusCode = 500;
    apiClient.getAccounts.mockRejectedValue(error);

    await expect(manager.refreshAccounts()).rejects.toBe(error);
    expect(rejected).toEqual([]);
  });

  test('the discovery timer runs with the profile on and sync off', () => {
    jest.useFakeTimers();
    try {
      const manager = makeManager('https://hyperclay.com', { syncEnabled: false, profile: { enabled: true } });
      manager.startDiscoveryTimer();
      expect(manager.discoveryTimer).not.toBeNull();
      manager.stopDiscoveryTimer();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the discovery timer stays off with sync and the profile off', () => {
    jest.useFakeTimers();
    try {
      const manager = makeManager('https://hyperclay.com', { syncEnabled: false, profile: { enabled: false } });
      manager.startDiscoveryTimer();
      expect(manager.discoveryTimer).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
