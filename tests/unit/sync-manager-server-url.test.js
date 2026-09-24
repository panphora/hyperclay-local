jest.mock('../../src/sync-engine/api-client', () => ({
  ...jest.requireActual('../../src/sync-engine/api-client'),
  getAccounts: jest.fn(),
}));

const apiClient = require('../../src/sync-engine/api-client');
const { SyncManager } = require('../../src/main/sync-manager');

function makeManager(serverUrl) {
  const settings = { roots: [], syncSessions: [] };
  return new SyncManager({
    userData: '/tmp/unused',
    deviceId: 'device-1',
    serverUrl,
    getApiKey: () => 'hcsk_test',
    settingsStore: { get: () => settings, save: () => {} },
    observerFor: () => ({ setRemoteApplyCheck() {} }),
  });
}

describe('SyncManager server URL', () => {
  test('a v1 install with no stored server discovers against hyperclay.com', async () => {
    apiClient.getAccounts.mockResolvedValue({ accounts: [{ id: 7, kind: 'personal' }], features: {} });
    const manager = makeManager(null);

    const accountId = await manager.resolveAccountId({ session: { kind: 'personal', accountId: null } });

    expect(accountId).toBe(7);
    expect(apiClient.getAccounts).toHaveBeenCalledWith({ serverUrl: 'https://hyperclay.com', apiKey: 'hcsk_test' });
  });

  test('a stored server wins', () => {
    expect(makeManager('https://localhyperclay.com').serverUrl).toBe('https://localhyperclay.com');
  });
});
